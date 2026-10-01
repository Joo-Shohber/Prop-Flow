import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRentalRequests1790874240358 implements MigrationInterface {
    name = 'AddRentalRequests1790874240358'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."rental_requests_status_enum" AS ENUM('PENDING', 'APPROVED', 'REJECTED')`);
        await queryRunner.query(`CREATE TABLE "rental_requests" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "unitId" uuid NOT NULL, "startDate" date NOT NULL, "endDate" date NOT NULL, "message" text, "status" "public"."rental_requests_status_enum" NOT NULL DEFAULT 'PENDING', "rentAmount" integer NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_794c7a9701af4c478268aaeb80" CHECK ("startDate" < "endDate"), CONSTRAINT "PK_4897ff9215e5b7bc66ecbf1a96d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_ff6e257d09da054388f7654697" ON "rental_requests"  ("tenantId") `);
        await queryRunner.query(`CREATE INDEX "IDX_b35dec10a86283f8b09fa711c0" ON "rental_requests"  ("unitId") `);
        await queryRunner.query(`CREATE INDEX "IDX_79b125b5da1f226ebf1e9db980" ON "rental_requests"  ("status") `);
        await queryRunner.query(`ALTER TABLE "units" ADD "rentAmount" integer NOT NULL`);
        await queryRunner.query(`ALTER TABLE "units" ADD "images" jsonb NOT NULL DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "leases" ADD "rentAmount" integer NOT NULL`);
        await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE 'RENTAL_REQUEST_CREATED'`);
        await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE 'RENTAL_REQUEST_APPROVED'`);
        await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE 'RENTAL_REQUEST_REJECTED'`);
        await queryRunner.query(`ALTER TYPE "public"."notifications_type_enum" ADD VALUE 'RENTAL_REQUEST_CREATED'`);
        await queryRunner.query(`ALTER TYPE "public"."notifications_type_enum" ADD VALUE 'RENTAL_REQUEST_APPROVED'`);
        await queryRunner.query(`ALTER TYPE "public"."notifications_type_enum" ADD VALUE 'RENTAL_REQUEST_REJECTED'`);
        await queryRunner.query(`ALTER TABLE "rental_requests" ADD CONSTRAINT "FK_ff6e257d09da054388f76546972" FOREIGN KEY ("tenantId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "rental_requests" ADD CONSTRAINT "FK_b35dec10a86283f8b09fa711c0b" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "rental_requests" DROP CONSTRAINT "FK_b35dec10a86283f8b09fa711c0b"`);
        await queryRunner.query(`ALTER TABLE "rental_requests" DROP CONSTRAINT "FK_ff6e257d09da054388f76546972"`);
        await queryRunner.query(`CREATE TYPE "public"."notifications_type_enum_old" AS ENUM('LEASE_CREATED', 'LEASE_ACTIVATED', 'LEASE_TERMINATED', 'MAINTENANCE_CREATED', 'MAINTENANCE_ASSIGNED', 'MAINTENANCE_RESOLVED')`);
        await queryRunner.query(`ALTER TABLE "notifications" ALTER COLUMN "type" TYPE "public"."notifications_type_enum_old" USING "type"::"text"::"public"."notifications_type_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."notifications_type_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."notifications_type_enum_old" RENAME TO "notifications_type_enum"`);
        await queryRunner.query(`CREATE TYPE "public"."audit_logs_action_enum_old" AS ENUM('PROPERTY_CREATED', 'PROPERTY_DELETED', 'LEASE_CREATED', 'LEASE_ACTIVATED', 'LEASE_TERMINATED', 'USER_STATUS_CHANGED', 'UNIT_STATUS_CHANGED', 'MAINTENANCE_ASSIGNED', 'MAINTENANCE_COMPLETED', 'ROLE_CHANGED')`);
        await queryRunner.query(`ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum_old" USING "action"::"text"::"public"."audit_logs_action_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum_old" RENAME TO "audit_logs_action_enum"`);
        await queryRunner.query(`ALTER TABLE "leases" DROP COLUMN "rentAmount"`);
        await queryRunner.query(`ALTER TABLE "units" DROP COLUMN "images"`);
        await queryRunner.query(`ALTER TABLE "units" DROP COLUMN "rentAmount"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_79b125b5da1f226ebf1e9db980"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b35dec10a86283f8b09fa711c0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ff6e257d09da054388f7654697"`);
        await queryRunner.query(`DROP TABLE "rental_requests"`);
        await queryRunner.query(`DROP TYPE "public"."rental_requests_status_enum"`);
    }

}
