import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Unit } from '../../units/entities/unit.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { RentalRequestStatus } from '../enums/rental-request-status.enum.js';

@Entity('rental_requests')
@Check(`"startDate" < "endDate"`)
export class RentalRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  tenantId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'tenantId' })
  tenant: User;

  @Index()
  @Column({ type: 'uuid' })
  unitId: string;

  @ManyToOne(() => Unit, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'unitId' })
  unit: Unit;

  @Column({ type: 'date' })
  startDate: string;

  @Column({ type: 'date' })
  endDate: string;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Index()
  @Column({
    type: 'enum',
    enum: RentalRequestStatus,
    default: RentalRequestStatus.PENDING,
  })
  status: RentalRequestStatus;

  @Column({ type: 'integer' })
  rentAmount: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
