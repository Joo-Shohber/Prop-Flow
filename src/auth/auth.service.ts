import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
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
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { AuthTokens, RefreshTokenPayload } from './types/token.types.js';
import { RefreshToken } from './entities/refresh-token.entity.js';
import { OtpService } from './otp.service.js';
import { EmailService } from '../common/mail/email.service.js';
import { OtpPurpose } from './enums/otp-purpose.enum.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';
import { MessageResponseDto } from './dto/message-response.dto.js';
import { EmailDto } from './dto/email.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { UsersService } from '../users/users.service.js';
import { User } from '../users/entities/user.entity.js';
import { PasswordService } from './password.service.js';

const INVALID_OTP_MESSAGE = 'Invalid or expired verification code';
const OTP_SENT_MESSAGE =
  'If the account exists, a verification code has been sent to the email address';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly otpService: OtpService,
    private readonly emailService: EmailService,
    private readonly jwtService: JwtService,
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
    if (await this.usersService.findByEmail(dto.email)) {
      throw new ConflictException('Email is already registered');
    }

    const { password, ...profile } = dto;
    const user = await this.usersService.create({
      ...profile,
      passwordHash: await this.passwordService.hash(password),
    });

    await this.sendOtp(user.email, OtpPurpose.EMAIL_VERIFICATION);
    return user;
  }

  /**
   * Verifies a user's email address using the provided OTP.
   * @param dto - Contains the user's email address and verification OTP.
   * @returns A success message when the email is successfully verified.
   * @throws BadRequestException If the OTP is invalid or the user does not exist.
   */
  async verifyEmail(dto: VerifyEmailDto): Promise<MessageResponseDto> {
    const valid = await this.otpService.verify(
      OtpPurpose.EMAIL_VERIFICATION,
      dto.email,
      dto.otp,
    );
    const user = valid ? await this.usersService.findByEmail(dto.email) : null;
    if (!user) throw new BadRequestException(INVALID_OTP_MESSAGE);

    await this.usersService.makeEmailVerified(user.id);
    return { message: 'Email verified successfully' };
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

    const credentials = await this.usersService.findCredentialsByEmail(
      dto.email,
    );

    if (!credentials) {
      await this.passwordService.verifyDummy(dto.password);
      throw invalid;
    }

    if (
      !(await this.passwordService.verify(
        credentials.passwordHash,
        dto.password,
      ))
    ) {
      throw invalid;
    }

    if (!credentials.isActive) {
      throw new ForbiddenException('This account has been deactivated');
    }

    if (!credentials.isEmailVerified) {
      throw new ForbiddenException(
        'Please verify your email before logging in',
      );
    }

    const family = randomUUID();
    const tokens = await this.issueTokens(credentials.id, family);
    const user = await this.usersService.findById(credentials.id);
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

    const user = await this.usersService.findById(refreshToken.userId);
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
   * Resends an email verification OTP to user.
   * @param dto - Contains the user's email address.
   * @returns A promise containing a generic OTP sent message.
   */
  async resendVerificationOtp(dto: EmailDto): Promise<MessageResponseDto> {
    const user = await this.usersService.findByEmail(dto.email);
    if (user && user.isActive && !user.isEmailVerified) {
      await this.sendOtp(user.email, OtpPurpose.EMAIL_VERIFICATION);
    }
    return { message: OTP_SENT_MESSAGE };
  }

  /**
   * Sends a password reset OTP to an eligible user.
   * @param dto - Contains the user's email address.
   * @returns A promise containing a generic OTP sent message.
   */
  async forgotPassword(dto: EmailDto): Promise<MessageResponseDto> {
    const user = await this.usersService.findByEmail(dto.email);
    if (user && user.isActive && user.isEmailVerified) {
      await this.sendOtp(user.email, OtpPurpose.PASSWORD_RESET);
    }
    return { message: OTP_SENT_MESSAGE };
  }

  /**
   * Resets a user's password after validating the password reset OTP.
   * @param dto - Contains the user's email, OTP, and new password.
   * @returns A promise containing a password reset confirmation message.
   * @throws BadRequestException If the OTP is invalid or the user is inactive.
   */
  async resetPassword(dto: ResetPasswordDto): Promise<MessageResponseDto> {
    const valid = await this.otpService.verify(
      OtpPurpose.PASSWORD_RESET,
      dto.email,
      dto.otp,
    );
    const user = valid ? await this.usersService.findByEmail(dto.email) : null;
    if (!user || !user.isActive)
      throw new BadRequestException(INVALID_OTP_MESSAGE);

    const passwordHash = await this.passwordService.hash(dto.newPassword);
    await this.dataSource.transaction(async (manager) => {
      await manager.update(User, { id: user.id }, { passwordHash });
      await manager.update(
        RefreshToken,
        { userId: user.id, revoked: false },
        { revoked: true },
      );
    });

    return {
      message: 'Password has been reset. Please log in with your new password',
    };
  }

  /**
   * Logs out the user by revoking the refresh token family.
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
      // Nothing to do || Silent
    }
  }

  private async sendOtp(email: string, purpose: OtpPurpose): Promise<void> {
    const code = await this.otpService.issue(purpose, email);
    if (code) await this.emailService.sendOtp(email, code, purpose);
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
      this.jwtService.signAsync(
        { userId },
        {
          secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
          expiresIn: accessTtl,
          algorithm: 'HS256',
        },
      ),
      this.jwtService.signAsync(
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
      const payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        token,
        {
          secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
          algorithms: ['HS256'],
        },
      );

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
    await this.refreshTokens.update(
      { family, revoked: false },
      { revoked: true },
    );
  }
}
