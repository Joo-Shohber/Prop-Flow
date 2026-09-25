import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class DeleteImageDto {
  @ApiProperty({ description: 'publicId returned when the image was uploaded' })
  @IsString()
  @IsNotEmpty()
  publicId: string;
}
