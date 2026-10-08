import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateUnitAndProperty1791471413130 implements MigrationInterface {
    name = 'UpdateUnitAndProperty1791471413130'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "rental_requests" DROP CONSTRAINT "UQ_rental_request_tenant_unit"`);
        await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE 'UNIT_CREATED'`);
        await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE 'UNIT_DELETED'`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_381fef40388009b8598c6f0feb" ON "rental_requests"  ("tenantId", "unitId") WHERE "status" = 'PENDING'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_381fef40388009b8598c6f0feb"`);
        await queryRunner.query(`CREATE TYPE "public"."audit_logs_action_enum_old" AS ENUM('PROPERTY_CREATED', 'PROPERTY_DELETED', 'LEASE_CREATED', 'LEASE_ACTIVATED', 'LEASE_TERMINATED', 'USER_STATUS_CHANGED', 'UNIT_STATUS_CHANGED', 'MAINTENANCE_ASSIGNED', 'MAINTENANCE_COMPLETED', 'ROLE_CHANGED', 'RENTAL_REQUEST_CREATED', 'RENTAL_REQUEST_APPROVED', 'RENTAL_REQUEST_REJECTED')`);
        await queryRunner.query(`ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum_old" USING "action"::"text"::"public"."audit_logs_action_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum_old" RENAME TO "audit_logs_action_enum"`);
        await queryRunner.query(`ALTER TABLE "rental_requests" ADD CONSTRAINT "UQ_rental_request_tenant_unit" UNIQUE ("tenantId", "unitId")`);
    }

}
