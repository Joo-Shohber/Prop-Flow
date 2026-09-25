import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ImageRef } from '../../common/uploads/image-ref.interface.js';
import { Unit } from '../../units/entities/unit.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { MaintenanceCategory } from '../enums/maintenance-category.enum.js';
import { MaintenancePriority } from '../enums/maintenance-priority.enum.js';
import { MaintenanceStatus } from '../enums/maintenance-status.enum.js';

@Entity('maintenance_requests')
export class MaintenanceRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'enum', enum: MaintenanceCategory })
  category: MaintenanceCategory;

  @Index()
  @Column({ type: 'enum', enum: MaintenancePriority })
  priority: MaintenancePriority;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  images: ImageRef[];

  @Index()
  @Column({ type: 'uuid' })
  unitId: string;

  @ManyToOne(() => Unit, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'unitId' })
  unit: Unit;

  @Column({ type: 'uuid' })
  tenantId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'tenantId' })
  tenant: User;

  @Index()
  @Column({
    type: 'enum',
    enum: MaintenanceStatus,
    default: MaintenanceStatus.OPEN,
  })
  status: MaintenanceStatus;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  assignedStaffId: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'assignedStaffId' })
  assignedStaff: User | null;

  @Column({ type: 'date', nullable: true })
  scheduledDate: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  completionImages: ImageRef[];

  @Column({ type: 'text', nullable: true })
  resolutionDescription: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
