import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto.js';

export class AccessTokenDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty({ description: 'Access token lifetime in seconds' })
  expiresIn: number;
}

export class LoginResponseDto extends AccessTokenDto {
  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;
}
