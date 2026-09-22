import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto.js';

export class AuthTokensDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  refreshToken: string;

  @ApiProperty({ description: 'Access token lifetime in seconds' })
  expiresIn: number;
}

export class LoginResponseDto extends AuthTokensDto {
  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;
}
