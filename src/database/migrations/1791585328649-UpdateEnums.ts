import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateEnums1791585328649 implements MigrationInterface {
    name = 'UpdateEnums1791585328649'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE 'LEASE_RENEWED'`);
        await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE 'RENTAL_REQUEST_CANCELLED'`);
        await queryRunner.query(`ALTER TYPE "public"."notifications_type_enum" ADD VALUE 'LEASE_RENEWED'`);
        await queryRunner.query(`ALTER TYPE "public"."notifications_type_enum" ADD VALUE 'MAINTENANCE_STARTED'`);
        await queryRunner.query(`ALTER TYPE "public"."notifications_type_enum" ADD VALUE 'MAINTENANCE_CLOSED'`);
        await queryRunner.query(`ALTER TYPE "public"."notifications_type_enum" ADD VALUE 'MAINTENANCE_CANCELLED'`);
        await queryRunner.query(`ALTER TYPE "public"."notifications_type_enum" ADD VALUE 'RENTAL_REQUEST_CANCELLED'`);
        await queryRunner.query(`ALTER TYPE "public"."rental_requests_status_enum" ADD VALUE 'CANCELLED'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."rental_requests_status_enum_old" AS ENUM('PENDING', 'APPROVED', 'REJECTED')`);
        await queryRunner.query(`ALTER TABLE "rental_requests" ALTER COLUMN "status" TYPE "public"."rental_requests_status_enum_old" USING "status"::"text"::"public"."rental_requests_status_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."rental_requests_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."rental_requests_status_enum_old" RENAME TO "rental_requests_status_enum"`);
        await queryRunner.query(`CREATE TYPE "public"."notifications_type_enum_old" AS ENUM('LEASE_CREATED', 'LEASE_ACTIVATED', 'LEASE_TERMINATED', 'MAINTENANCE_CREATED', 'MAINTENANCE_ASSIGNED', 'MAINTENANCE_RESOLVED', 'RENTAL_REQUEST_CREATED', 'RENTAL_REQUEST_APPROVED', 'RENTAL_REQUEST_REJECTED')`);
        await queryRunner.query(`ALTER TABLE "notifications" ALTER COLUMN "type" TYPE "public"."notifications_type_enum_old" USING "type"::"text"::"public"."notifications_type_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."notifications_type_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."notifications_type_enum_old" RENAME TO "notifications_type_enum"`);
        await queryRunner.query(`CREATE TYPE "public"."audit_logs_action_enum_old" AS ENUM('PROPERTY_CREATED', 'PROPERTY_DELETED', 'LEASE_CREATED', 'LEASE_ACTIVATED', 'LEASE_TERMINATED', 'USER_STATUS_CHANGED', 'UNIT_STATUS_CHANGED', 'MAINTENANCE_ASSIGNED', 'MAINTENANCE_COMPLETED', 'ROLE_CHANGED', 'RENTAL_REQUEST_CREATED', 'RENTAL_REQUEST_APPROVED', 'RENTAL_REQUEST_REJECTED', 'UNIT_CREATED', 'UNIT_DELETED')`);
        await queryRunner.query(`ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum_old" USING "action"::"text"::"public"."audit_logs_action_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum_old" RENAME TO "audit_logs_action_enum"`);
    }

}
