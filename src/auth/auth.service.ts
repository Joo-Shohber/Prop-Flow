import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { durationToSeconds } from '../common/utils/duration.util.js';
import { safeEqual, sha256 } from '../common/utils/hash.util.js';
import { User } from '../users/entities/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
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

    const tokens = await this.issueTokens(credentials.id, randomUUID());
    const user = await this.users.findById(credentials.id);
    return { user, ...tokens };
  }

  async refresh(token: string): Promise<AuthTokens> {
    const payload = await this.verifyRefreshToken(token);
    const record = await this.refreshTokens.findOneBy({ id: payload.jti });

    if (
      !record ||
      record.userId !== payload.userId ||
      record.family !== payload.family
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (record.revoked || !safeEqual(record.tokenHash, sha256(token))) {
      await this.revokeFamily(record.family);
      throw new UnauthorizedException(
        'Refresh token reuse detected, please log in again',
      );
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = await this.users.findById(record.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account is not active');
    }

    const tokens = await this.dataSource.transaction(async (manager) => {
      const { affected } = await manager.update(
        RefreshToken,
        { id: record.id, revoked: false },
        { revoked: true },
      );
      if (!affected) return null;
      return this.issueTokens(user.id, record.family, manager);
    });

    if (!tokens) {
      await this.revokeFamily(record.family);
      throw new UnauthorizedException(
        'Refresh token reuse detected, please log in again',
      );
    }
    return tokens;
  }

  /** Idempotent: an unknown or expired token is simply ignored. */
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
        { sub: userId },
        {
          secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
          expiresIn: accessTtl,
          algorithm: 'HS256',
        },
      ),
      this.jwt.signAsync(
        { sub: userId, jti, family },
        {
          secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
          expiresIn: refreshTtl,
          algorithm: 'HS256',
        },
      ),
    ]);

    const repo = manager
      ? manager.getRepository(RefreshToken)
      : this.refreshTokens;
    await repo.insert({
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
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  private async revokeFamily(family: string): Promise<void> {
    await this.refreshTokens.update({ family }, { revoked: true });
  }
}
