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
import { User } from '../../users/entities/user.entity.js';
import { LeaseRenewalRequestStatus } from '../enums/lease-renewal-request-status.enum.js';
import { Lease } from './lease.entity.js';

/**
 * A tenant's request to extend an ACTIVE lease to a later end date.
 * At most one request per lease can be PENDING at a time.
 */
@Entity('lease_renewal_requests')
@Index('UQ_lease_renewal_pending_lease', ['leaseId'], {
  unique: true,
  where: `"status" = 'PENDING'`,
})
export class LeaseRenewalRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  leaseId: string;

  @ManyToOne(() => Lease, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'leaseId' })
  lease: Lease;

  @Index()
  @Column({ type: 'uuid' })
  tenantId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'tenantId' })
  tenant: User;

  @Column({ type: 'date' })
  requestedEndDate: string;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Index()
  @Column({
    type: 'enum',
    enum: LeaseRenewalRequestStatus,
    default: LeaseRenewalRequestStatus.PENDING,
  })
  status: LeaseRenewalRequestStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
