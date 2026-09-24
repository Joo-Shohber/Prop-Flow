import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Exclusion,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Unit } from '../../units/entities/unit.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { LeaseStatus } from '../enums/lease-status.enum.js';

@Entity('leases')
@Check(`"startDate" < "endDate"`)
@Exclusion(
  `USING gist ("unitId" WITH =, daterange("startDate", "endDate", '[]') WITH &&)
  WHERE (status IN ('PENDING', 'ACTIVE'))`,
)
// At most one ACTIVE lease per unit at any time.
@Index(['unitId'], { unique: true, where: `status = 'ACTIVE'` })
@Index(['status', 'endDate'])
export class Lease {
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

  @Index()
  @Column({ type: 'enum', enum: LeaseStatus, default: LeaseStatus.PENDING })
  status: LeaseStatus;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
