import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator.js';
import { GoogleAuthGuard } from '../common/guards/google-auth.guard.js';
import { EmailDto } from './dto/email.dto.js';
import { AccessTokenDto, LoginResponseDto } from './dto/auth-response.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { MessageResponseDto } from './dto/message-response.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';
import { AuthService } from './auth.service.js';
import { GoogleProfile } from './google.service.js';
import { REFRESH_TOKEN_COOKIE } from './constants/auth.constants.js';
import {
  clearRefreshTokenCookie,
  setRefreshTokenCookie,
} from './utils/refresh-cookie.util.js';

@ApiTags('Auth')
@Public()
@Throttle({ default: { limit: 5, ttl: 60_000 } })
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a TENANT or OWNER account' })
  @ApiCreatedResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiConflictResponse({ description: 'Email is already registered' })
  register(@Body() dto: RegisterDto): Promise<MessageResponseDto> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in. The refresh token is set as an httpOnly cookie.',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  @ApiForbiddenResponse({ description: 'Account is deactivated' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshToken, ...body } = await this.authService.login(dto);

    setRefreshTokenCookie(res, refreshToken, this.config);

    return body;
  }

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Start Google sign-in (redirects to Google)' })
  googleLogin(): void {}

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({
    summary:
      'Google OAuth callback. Sets the session cookie and redirects to the frontend',
  })
  async googleCallback(
    @Req() req: Request & { user: GoogleProfile },
    @Res() res: Response,
  ): Promise<void> {
    const { refreshToken } = await this.authService.loginWithGoogle(req.user);

    setRefreshTokenCookie(res, refreshToken, this.config);

    res.redirect(this.config.getOrThrow<string>('FRONTEND_URL'));
  }

  // @Get('google/callback')
  // @UseGuards(GoogleAuthGuard)
  // @ApiOperation({ summary: 'Google OAuth callback' })
  // @ApiOkResponse({ type: LoginResponseDto })
  // async googleCallback(
  //   @Req() req: Request & { user: GoogleProfile },
  //   @Res({ passthrough: true }) res: Response,
  // ) {
  //   const { refreshToken, ...body } = await this.authService.loginWithGoogle(
  //     req.user,
  //   );
  //   setRefreshTokenCookie(res, refreshToken, this.config);
  //   return body;
  // }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the refresh token cookie and get a new access token',
  })
  @ApiOkResponse({ type: AccessTokenDto })
  @ApiUnauthorizedResponse({
    description:
      'Missing, invalid, expired or reused refresh token (reuse revokes the whole session family)',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = req.cookies?.[REFRESH_TOKEN_COOKIE];

    if (!token) {
      throw new UnauthorizedException('Missing refresh token');
    }

    const { refreshToken, ...body } = await this.authService.refresh(token);

    setRefreshTokenCookie(res, refreshToken, this.config);

    return body;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke the current session and clear the refresh token cookie',
  })
  @ApiOkResponse({ description: 'Always succeeds (idempotent)' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<null> {
    const token = req.cookies?.[REFRESH_TOKEN_COOKIE];

    if (token) {
      await this.authService.logout(token);
      clearRefreshTokenCookie(res, this.config);
    }

    return null;
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify the email address with the 6-digit code' })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({
    description:
      'Invalid or expired code (5 wrong attempts invalidate the code)',
  })
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<MessageResponseDto> {
    return this.authService.verifyEmail(dto);
  }

  @Post('resend-verification-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send a new verification code',
    description:
      'Always returns the same response. A code is only sent for an existing, unverified account, and at most once every 60 seconds.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  resendVerificationOtp(@Body() dto: EmailDto): Promise<MessageResponseDto> {
    return this.authService.resendVerificationOtp(dto);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Email a password reset code',
    description:
      'Always returns the same response, whether or not the email exists.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  forgotPassword(@Body() dto: EmailDto): Promise<MessageResponseDto> {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set a new password with the reset code',
    description: 'Revokes all refresh tokens of the user.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid or expired code, or validation failed',
  })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MessageResponseDto> {
    const result = await this.authService.resetPassword(dto);

    clearRefreshTokenCookie(res, this.config);

    return result;
  }
}
