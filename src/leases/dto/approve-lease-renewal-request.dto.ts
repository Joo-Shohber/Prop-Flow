import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class ApproveLeaseRenewalRequestDto {
  @ApiPropertyOptional({
    example: '2027-06-30',
    description:
      'Grant a different end date than the one requested; defaults to the requested date',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
