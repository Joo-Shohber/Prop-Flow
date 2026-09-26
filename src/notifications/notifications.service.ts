import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, FindOptionsWhere, Repository } from 'typeorm';
import { Paginated, toSkip } from '../common/pagination/pagination.utils.js';
import { User } from '../users/entities/user.entity.js';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto.js';
import { Notification } from './entities/notification.entity.js';
import { NotificationType } from './enums/notification-type.enum.js';

interface CreateNotificationData {
  recipientId: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
  ) {}

  /**
   * Create a new notification.
   * This method called inside a business transaction using the transaction's Manager.
   * @param manager Transaction manager used to insert the notification.
   * @param data Notification data including recipient, type, title, message,
   * and optional related entity information.
   */
  async create(
    manager: EntityManager,
    data: CreateNotificationData,
  ): Promise<void> {
    await manager.insert(Notification, {
      recipientId: data.recipientId,
      type: data.type,
      title: data.title,
      message: data.message,
      relatedEntityType: data.relatedEntityType ?? null,
      relatedEntityId: data.relatedEntityId ?? null,
    });
  }

  /**
   * Get the authenticated user's notifications.
   * @param actor Authenticated user requesting the notifications.
   * @param query Pagination and unread filter options.
   * @returns Paginated notifications with the total unread count.
   */
  async findAll(
    actor: User,
    query: ListNotificationsQueryDto,
  ): Promise<Paginated<Notification>> {
    const where: FindOptionsWhere<Notification> = { recipientId: actor.id };
    if (query.unread) where.isRead = false;

    const [data, total] = await this.notificationRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: toSkip(query),
      take: query.limit,
    });
    const unreadCount = await this.notificationRepo.count({
      where: { recipientId: actor.id, isRead: false },
    });

    return Paginated.of(data, total, query, { unreadCount });
  }

  /**
   * Mark a specific notification as read.
   * @param actor Authenticated user.
   * @param id ID of the notification to mark as read.
   * @throws NotFoundException If the notification does not exist
   * or does not belong to the authenticated user.
   */
  async markRead(actor: User, id: string): Promise<void> {
    const result = await this.notificationRepo.update(
      { id, recipientId: actor.id },
      { isRead: true },
    );
    if (!result.affected) throw new NotFoundException('Notification not found');
  }

  /**
   * Mark all unread notifications belonging to the authenticated user as read.
   * @param actor Authenticated user.
   */
  async markAllRead(actor: User): Promise<void> {
    await this.notificationRepo.update(
      { recipientId: actor.id, isRead: false },
      { isRead: true },
    );
  }
}
