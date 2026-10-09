import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { User } from '../users/entities/user.entity.js';
import { AuthService } from './auth.service.js';
import { REFRESH_TOKEN_COOKIE } from './constants/auth.constants.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { MessageResponseDto } from './dto/message-response.dto.js';

@ApiTags('Auth')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, invalid or expired access token',
})
@Throttle({ default: { limit: 5, ttl: 60_000 } })
@Controller('auth')
export class AuthSessionController {
  constructor(private readonly authService: AuthService) {}

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change the password of the logged-in user',
    description:
      'Revokes every other session of the user. The current session (identified by the refresh token cookie) stays signed in. Accounts that only use Google sign-in have no password yet and must use "forgot password" to set one.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({
    description:
      'Wrong current password, new password equal to the current one, no password set on the account, or validation failed',
  })
  changePassword(
    @CurrentUser() user: User,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ): Promise<MessageResponseDto> {
    const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;

    return this.authService.changePassword(user, dto, refreshToken);
  }
}
