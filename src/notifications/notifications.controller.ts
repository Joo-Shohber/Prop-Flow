import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { User } from '../users/entities/user.entity.js';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto.js';
import { NotificationResponseDto } from './dto/notification-response.dto.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('Notifications')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, invalid or expired access token',
})
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List my notifications' })
  @ApiOkResponse({
    type: NotificationResponseDto,
    isArray: true,
    description: 'Paginated; `meta.unreadCount` is the total unread count',
  })
  findAll(
    @CurrentUser() actor: User,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notifications.findAll(actor, query);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  @ApiOkResponse({ description: 'Marked as read' })
  @ApiNotFoundResponse({ description: 'Notification not found' })
  async markRead(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<null> {
    await this.notifications.markRead(actor, id);
    return null;
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all my notifications as read' })
  @ApiOkResponse({ description: 'All marked as read' })
  async markAllRead(@CurrentUser() actor: User): Promise<null> {
    await this.notifications.markAllRead(actor);
    return null;
  }
}
