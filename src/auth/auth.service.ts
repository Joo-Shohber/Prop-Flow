import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { durationToSeconds } from '../common/utils/duration.util.js';
import { safeEqual, sha256 } from '../common/utils/hash.util.js';
import { User } from '../users/entities/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { PasswordService } from './password.service.js';
import { AuthTokens, RefreshTokenPayload } from './types/token.types.js';
import { RefreshToken } from './entities/refresh-token.entity.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
  ) {}

  /**
   * Registers a new user account.
   * Checks whether the email is already registered, hashes the user's
   * password, and creates a new user with the remaining profile data.
   * @param dto Registration data containing the user's profile and password.
   * @returns The newly created user.
   * @throws ConflictException If the email is already registered.
   */
  async register(dto: RegisterDto): Promise<User> {
    if (await this.users.findByEmail(dto.email)) {
      throw new ConflictException('Email is already registered');
    }

    const { password, ...profile } = dto;
    return this.users.create({
      ...profile,
      passwordHash: await this.passwords.hash(password),
    });
  }

  /**
   * Authenticates a user and issues access and refresh tokens.
   * Uses a dummy password hash verification when the email does not exist
   * to reduce timing differences that could otherwise reveal whether an email is registered.
   * @param dto Login credentials containing email and password.
   * @returns The authenticated user and newly issued tokens.
   * @throws UnauthorizedException If the email or password is invalid.
   * @throws ForbiddenException If the account has been deactivated.
   */
  async login(dto: LoginDto): Promise<AuthTokens & { user: User }> {
    const invalid = new UnauthorizedException('Invalid email or password');

    const credentials = await this.users.findCredentialsByEmail(dto.email);
    if (!credentials) {
      await this.passwords.verifyDummy(dto.password);
      throw invalid;
    }

    if (
      !(await this.passwords.verify(credentials.passwordHash, dto.password))
    ) {
      throw invalid;
    }

    if (!credentials.isActive) {
      throw new ForbiddenException('This account has been deactivated');
    }

    const family = randomUUID();
    const tokens = await this.issueTokens(credentials.id, family);
    const user = await this.users.findById(credentials.id);
    return { user, ...tokens };
  }

  /**
   * Rotates a refresh token and issues a new access and refresh token pair.
   * The current refresh token is revoked before a new token is issued.
   * Refresh tokens belong to a token family, allowing the entire family
   * to be revoked if token reuse is detected.
   * @param token The refresh token provided by the client.
   * @returns A newly issued access and refresh token pair.
   * @throws UnauthorizedException If the token is invalid, expired, revoked,
   * mismatched, reused, or belongs to an inactive account.
   */
  async refresh(token: string): Promise<AuthTokens> {
    const payload = await this.verifyRefreshToken(token);
    const refreshToken = await this.refreshTokens.findOneBy({
      id: payload.jti,
    });

    if (
      !refreshToken ||
      refreshToken.userId !== payload.userId ||
      refreshToken.family !== payload.family
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (
      refreshToken.revoked ||
      !safeEqual(refreshToken.tokenHash, sha256(token))
    ) {
      await this.revokeFamily(refreshToken.family);
      throw new UnauthorizedException(
        'Refresh token reuse detected, please log in again',
      );
    }

    if (refreshToken.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = await this.users.findById(refreshToken.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account is not active');
    }

    const tokens = await this.dataSource.transaction(async (manager) => {
      const { affected } = await manager.update(
        RefreshToken,
        { id: refreshToken.id, revoked: false },
        { revoked: true },
      );
      if (!affected) return null;

      return this.issueTokens(user.id, refreshToken.family, manager);
    });

    if (!tokens) {
      await this.revokeFamily(refreshToken.family);
      throw new UnauthorizedException(
        'Refresh token reuse detected, please log in again',
      );
    }

    return tokens;
  }

  /**
   * Logs out the user by revoking the refresh token family.
   * Invalid or expired refresh tokens are silently ignored because logout
   * should remain idempotent and should not fail when the token is already
   * invalid or expired.
   * @param token The refresh token provided by the client.
   * @returns Resolves when the logout operation is completed.
   */
  async logout(token: string): Promise<void> {
    try {
      const payload = await this.verifyRefreshToken(token);

      await this.refreshTokens.update(
        { family: payload.family, userId: payload.userId },
        { revoked: true },
      );
    } catch {
      // nothing to revoke
    }
  }

  private async issueTokens(
    userId: string,
    family: string,
    manager?: EntityManager,
  ): Promise<AuthTokens> {
    const jti = randomUUID();

    const accessTtl = durationToSeconds(
      this.config.getOrThrow<string>('JWT_ACCESS_EXPIRES_IN'),
    );
    const refreshTtl = durationToSeconds(
      this.config.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN'),
    );

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { userId },
        {
          secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
          expiresIn: accessTtl,
          algorithm: 'HS256',
        },
      ),
      this.jwt.signAsync(
        { userId, jti, family },
        {
          secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
          expiresIn: refreshTtl,
          algorithm: 'HS256',
        },
      ),
    ]);

    const refreshTokensRepo = manager
      ? manager.getRepository(RefreshToken)
      : this.refreshTokens;

    await refreshTokensRepo.insert({
      id: jti,
      userId,
      family,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + refreshTtl * 1000),
    });

    return { accessToken, refreshToken, expiresIn: accessTtl };
  }

  private async verifyRefreshToken(
    token: string,
  ): Promise<RefreshTokenPayload> {
    try {
      const payload = await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        algorithms: ['HS256'],
      });

      if (
        typeof payload.userId !== 'string' ||
        typeof payload.jti !== 'string' ||
        typeof payload.family !== 'string'
      ) {
        throw new Error('malformed payload');
      }

      return payload;
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        throw new UnauthorizedException('Expired refresh token');
      }

      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private async revokeFamily(family: string): Promise<void> {
    await this.refreshTokens.update({ family }, { revoked: true });
  }
}
