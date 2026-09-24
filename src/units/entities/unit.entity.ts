import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { decimalTransformer } from '../../common/utils/decimal.transformer.js';
import { Property } from '../../properties/entities/property.entity.js';
import { UnitStatus } from '../enums/unit-status.enum.js';

@Entity('units')
@Unique(['propertyId', 'building', 'unitNumber'])
export class Unit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  unitNumber: string;

  @Column({ type: 'varchar', length: 100 })
  building: string;

  @Column({ type: 'int', nullable: true })
  floor: number | null;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    transformer: decimalTransformer,
  })
  area: number;

  @Index()
  @Column({ type: 'smallint' })
  bedrooms: number;

  @Column({ type: 'smallint' })
  bathrooms: number;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Index()
  @Column({ type: 'uuid' })
  propertyId: string;

  @ManyToOne(() => Property, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'propertyId' })
  property: Property;

  @Index()
  @Column({ type: 'enum', enum: UnitStatus, default: UnitStatus.AVAILABLE })
  status: UnitStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
