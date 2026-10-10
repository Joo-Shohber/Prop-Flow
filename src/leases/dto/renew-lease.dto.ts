import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

export class RenewLeaseDto {
  @ApiProperty({
    example: '2027-12-31',
    description: 'The new end date; must be after the current end date',
  })
  @IsDateString()
  endDate: string;
}
