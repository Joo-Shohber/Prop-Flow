import { ApiProperty } from '@nestjs/swagger';
import { NotificationType } from '../enums/notification-type.enum.js';

export class NotificationResponseDto {
  @ApiProperty() id: string;

  @ApiProperty({ enum: NotificationType }) type: NotificationType;

  @ApiProperty() title: string;

  @ApiProperty() message: string;

  @ApiProperty() isRead: boolean;

  @ApiProperty({ nullable: true, type: String }) relatedEntityType: string | null;

  @ApiProperty({ nullable: true, type: String }) relatedEntityId: string | null;

  @ApiProperty() createdAt: Date;
}
