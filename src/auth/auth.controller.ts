import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { UserResponseDto } from '../users/dto/user-response.dto.js';
import { User } from '../users/entities/user.entity.js';
import { REFRESH_TOKEN_COOKIE } from './auth.constants.js';
import { AuthService } from './auth.service.js';
import { AccessTokenDto, LoginResponseDto } from './dto/auth-response.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import {
  clearRefreshTokenCookie,
  setRefreshTokenCookie,
} from './utils/refresh-cookie.util.js';

@ApiTags('Auth')
@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a TENANT or OWNER account' })
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiConflictResponse({ description: 'Email is already registered' })
  register(@Body() dto: RegisterDto): Promise<User> {
    return this.auth.register(dto);
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
    const { refreshToken, ...body } = await this.auth.login(dto);
    setRefreshTokenCookie(res, refreshToken, this.config);
    return body;
  }

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
    if (!token) throw new UnauthorizedException('Missing refresh token');

    const { refreshToken, ...body } = await this.auth.refresh(token);
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
    if (token) await this.auth.logout(token);
    clearRefreshTokenCookie(res);
    return null;
  }
}
