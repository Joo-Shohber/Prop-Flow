import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity.js';
import { MaintenanceStatus } from '../enums/maintenance-status.enum.js';
import { MaintenanceRequest } from './maintenance-request.entity.js';

@Entity('maintenance_status_history')
export class MaintenanceStatusHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  requestId: string;

  @ManyToOne(() => MaintenanceRequest, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'requestId' })
  request: MaintenanceRequest;

  @Column({ type: 'enum', enum: MaintenanceStatus })
  previousStatus: MaintenanceStatus;

  @Column({ type: 'enum', enum: MaintenanceStatus })
  newStatus: MaintenanceStatus;

  @Column({ type: 'uuid' })
  changedById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'changedById' })
  changedBy: User;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
