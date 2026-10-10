import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLeaseRentalRequest1791648215219 implements MigrationInterface {
    name = 'AddLeaseRentalRequest1791648215219'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."lease_renewal_requests_status_enum" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')`);
        await queryRunner.query(`CREATE TABLE "lease_renewal_requests" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "leaseId" uuid NOT NULL, "tenantId" uuid NOT NULL, "requestedEndDate" date NOT NULL, "message" text, "status" "public"."lease_renewal_requests_status_enum" NOT NULL DEFAULT 'PENDING', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_4b8ada58f67908b65934215fc5a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_041b64df1bc9105a33233bdf77" ON "lease_renewal_requests"  ("leaseId") `);
        await queryRunner.query(`CREATE INDEX "IDX_d00583595792dc0e6d114be897" ON "lease_renewal_requests"  ("tenantId") `);
        await queryRunner.query(`CREATE INDEX "IDX_a712ad4a95156bc1c078df189d" ON "lease_renewal_requests"  ("status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_lease_renewal_pending_lease" ON "lease_renewal_requests"  ("leaseId") WHERE "status" = 'PENDING'`);
        await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE 'LEASE_RENEWAL_REQUESTED'`);
        await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE 'LEASE_RENEWAL_REJECTED'`);
        await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE 'LEASE_RENEWAL_CANCELLED'`);
        await queryRunner.query(`ALTER TYPE "public"."notifications_type_enum" ADD VALUE 'LEASE_RENEWAL_REQUESTED'`);
        await queryRunner.query(`ALTER TYPE "public"."notifications_type_enum" ADD VALUE 'LEASE_RENEWAL_REJECTED'`);
        await queryRunner.query(`ALTER TYPE "public"."notifications_type_enum" ADD VALUE 'LEASE_RENEWAL_CANCELLED'`);
        await queryRunner.query(`ALTER TABLE "lease_renewal_requests" ADD CONSTRAINT "FK_041b64df1bc9105a33233bdf772" FOREIGN KEY ("leaseId") REFERENCES "leases"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "lease_renewal_requests" ADD CONSTRAINT "FK_d00583595792dc0e6d114be897f" FOREIGN KEY ("tenantId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "lease_renewal_requests" DROP CONSTRAINT "FK_d00583595792dc0e6d114be897f"`);
        await queryRunner.query(`ALTER TABLE "lease_renewal_requests" DROP CONSTRAINT "FK_041b64df1bc9105a33233bdf772"`);
        await queryRunner.query(`CREATE TYPE "public"."notifications_type_enum_old" AS ENUM('LEASE_CREATED', 'LEASE_ACTIVATED', 'LEASE_TERMINATED', 'MAINTENANCE_CREATED', 'MAINTENANCE_ASSIGNED', 'MAINTENANCE_RESOLVED', 'RENTAL_REQUEST_CREATED', 'RENTAL_REQUEST_APPROVED', 'RENTAL_REQUEST_REJECTED', 'LEASE_RENEWED', 'MAINTENANCE_STARTED', 'MAINTENANCE_CLOSED', 'MAINTENANCE_CANCELLED', 'RENTAL_REQUEST_CANCELLED')`);
        await queryRunner.query(`ALTER TABLE "notifications" ALTER COLUMN "type" TYPE "public"."notifications_type_enum_old" USING "type"::"text"::"public"."notifications_type_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."notifications_type_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."notifications_type_enum_old" RENAME TO "notifications_type_enum"`);
        await queryRunner.query(`CREATE TYPE "public"."audit_logs_action_enum_old" AS ENUM('PROPERTY_CREATED', 'PROPERTY_DELETED', 'LEASE_CREATED', 'LEASE_ACTIVATED', 'LEASE_TERMINATED', 'USER_STATUS_CHANGED', 'UNIT_STATUS_CHANGED', 'MAINTENANCE_ASSIGNED', 'MAINTENANCE_COMPLETED', 'ROLE_CHANGED', 'RENTAL_REQUEST_CREATED', 'RENTAL_REQUEST_APPROVED', 'RENTAL_REQUEST_REJECTED', 'UNIT_CREATED', 'UNIT_DELETED', 'LEASE_RENEWED', 'RENTAL_REQUEST_CANCELLED')`);
        await queryRunner.query(`ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum_old" USING "action"::"text"::"public"."audit_logs_action_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum_old" RENAME TO "audit_logs_action_enum"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_lease_renewal_pending_lease"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a712ad4a95156bc1c078df189d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d00583595792dc0e6d114be897"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_041b64df1bc9105a33233bdf77"`);
        await queryRunner.query(`DROP TABLE "lease_renewal_requests"`);
        await queryRunner.query(`DROP TYPE "public"."lease_renewal_requests_status_enum"`);
    }

}
