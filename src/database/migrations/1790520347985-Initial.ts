import { MigrationInterface, QueryRunner } from "typeorm";

export class Initial1790520347985 implements MigrationInterface {
    name = 'Initial1790520347985'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('TENANT', 'OWNER', 'MAINTENANCE_STAFF', 'ADMIN')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying(255) NOT NULL, "passwordHash" character varying(255), "googleId" character varying(255), "firstName" character varying(100) NOT NULL, "lastName" character varying(100) NOT NULL, "phone" character varying(30), "role" "public"."users_role_enum" NOT NULL DEFAULT 'TENANT', "avatar" jsonb NOT NULL DEFAULT '{"url":"https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460__480.png","publicId":"null"}', "isActive" boolean NOT NULL DEFAULT true, "isEmailVerified" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "UQ_f382af58ab36057334fb262efd5" UNIQUE ("googleId"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users"  ("email") `);
        await queryRunner.query(`CREATE TYPE "public"."audit_logs_action_enum" AS ENUM('PROPERTY_CREATED', 'PROPERTY_DELETED', 'LEASE_CREATED', 'LEASE_ACTIVATED', 'LEASE_TERMINATED', 'USER_STATUS_CHANGED', 'UNIT_STATUS_CHANGED', 'MAINTENANCE_ASSIGNED', 'MAINTENANCE_COMPLETED', 'ROLE_CHANGED')`);
        await queryRunner.query(`CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "action" "public"."audit_logs_action_enum" NOT NULL, "entity" character varying(50) NOT NULL, "entityId" uuid NOT NULL, "metadata" jsonb, "ipAddress" character varying(45), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_cfa83f61e4d27a87fcae1e025a" ON "audit_logs"  ("userId") `);
        await queryRunner.query(`CREATE INDEX "IDX_cee5459245f652b75eb2759b4c" ON "audit_logs"  ("action") `);
        await queryRunner.query(`CREATE INDEX "IDX_445557993007fefee3aa9f1117" ON "audit_logs"  ("entity") `);
        await queryRunner.query(`CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL, "userId" uuid NOT NULL, "family" uuid NOT NULL, "tokenHash" character varying(64) NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_610102b60fea1455310ccd299d" ON "refresh_tokens"  ("userId") `);
        await queryRunner.query(`CREATE INDEX "IDX_968936751ab847471635be8dc0" ON "refresh_tokens"  ("family") `);
        await queryRunner.query(`CREATE TYPE "public"."properties_propertytype_enum" AS ENUM('APARTMENT', 'VILLA', 'STUDIO', 'TOWNHOUSE', 'COMMERCIAL', 'OTHER')`);
        await queryRunner.query(`CREATE TABLE "properties" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(150) NOT NULL, "description" text, "propertyType" "public"."properties_propertytype_enum" NOT NULL, "address" character varying(255) NOT NULL, "city" character varying(100) NOT NULL, "country" character varying(100) NOT NULL, "ownerId" uuid NOT NULL, "images" jsonb NOT NULL DEFAULT '[]', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_2d83bfa0b9fcd45dee1785af44d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_b8a33773574f818b93eb6a78b4" ON "properties"  ("propertyType") `);
        await queryRunner.query(`CREATE INDEX "IDX_c7aea7f222acdb48e3422361f8" ON "properties"  ("city") `);
        await queryRunner.query(`CREATE INDEX "IDX_47b8bfd9c3165b8a53cd0c58df" ON "properties"  ("ownerId") `);
        await queryRunner.query(`CREATE TYPE "public"."units_status_enum" AS ENUM('AVAILABLE', 'RENTED', 'MAINTENANCE')`);
        await queryRunner.query(`CREATE TABLE "units" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "unitNumber" character varying(50) NOT NULL, "building" character varying(100) NOT NULL, "floor" integer, "area" numeric(10,2) NOT NULL, "bedrooms" smallint NOT NULL, "bathrooms" smallint NOT NULL, "description" text, "propertyId" uuid NOT NULL, "status" "public"."units_status_enum" NOT NULL DEFAULT 'AVAILABLE', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_5280c1dd7a7b5b659cc57776fbc" UNIQUE ("propertyId", "building", "unitNumber"), CONSTRAINT "PK_5a8f2f064919b587d93936cb223" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_9460e0db09188323b61e9bf4b4" ON "units"  ("bedrooms") `);
        await queryRunner.query(`CREATE INDEX "IDX_546f4aa111022d983a32103048" ON "units"  ("propertyId") `);
        await queryRunner.query(`CREATE INDEX "IDX_37768e6e1261ee85920f8a387d" ON "units"  ("status") `);
        await queryRunner.query(`CREATE TYPE "public"."leases_status_enum" AS ENUM('PENDING', 'ACTIVE', 'TERMINATED', 'EXPIRED')`);
        await queryRunner.query(`CREATE TABLE "leases" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "unitId" uuid NOT NULL, "startDate" date NOT NULL, "endDate" date NOT NULL, "status" "public"."leases_status_enum" NOT NULL DEFAULT 'PENDING', "notes" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_773b9499405186dc5ba679c6b5" CHECK ("startDate" < "endDate"), CONSTRAINT "XCL_46a5464bf78f340894f02625f9" EXCLUDE USING gist ("unitId" WITH =, daterange("startDate", "endDate", '[]') WITH &&)
  WHERE (status IN ('PENDING', 'ACTIVE')), CONSTRAINT "PK_2668e338ab2d27079170ea55ea2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_175030e58c0d1accdb888a431d" ON "leases"  ("tenantId") `);
        await queryRunner.query(`CREATE INDEX "IDX_41ddb25063485103a828efc408" ON "leases"  ("unitId") `);
        await queryRunner.query(`CREATE INDEX "IDX_f04ca7b565c329d2a6f1b73c0f" ON "leases"  ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_e2997c605acbdd5a568f5a65cb" ON "leases"  ("status", "endDate") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_2c410fb5acd7bea80786e93cbf" ON "leases"  ("unitId") WHERE status = 'ACTIVE'`);
        await queryRunner.query(`CREATE TYPE "public"."maintenance_requests_category_enum" AS ENUM('PLUMBING', 'ELECTRICITY', 'HVAC', 'CARPENTRY', 'APPLIANCES', 'OTHER')`);
        await queryRunner.query(`CREATE TYPE "public"."maintenance_requests_priority_enum" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT')`);
        await queryRunner.query(`CREATE TYPE "public"."maintenance_requests_status_enum" AS ENUM('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED')`);
        await queryRunner.query(`CREATE TABLE "maintenance_requests" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying(150) NOT NULL, "description" text NOT NULL, "category" "public"."maintenance_requests_category_enum" NOT NULL, "priority" "public"."maintenance_requests_priority_enum" NOT NULL, "images" jsonb NOT NULL DEFAULT '[]', "unitId" uuid NOT NULL, "tenantId" uuid NOT NULL, "status" "public"."maintenance_requests_status_enum" NOT NULL DEFAULT 'OPEN', "assignedStaffId" uuid, "scheduledDate" date, "completionImages" jsonb NOT NULL DEFAULT '[]', "resolutionDescription" text, "resolvedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c1521eb67c471accae8c531f9fe" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_7a25fdc08fed6c0c68a1ebc3f5" ON "maintenance_requests"  ("priority") `);
        await queryRunner.query(`CREATE INDEX "IDX_eb50b765c3312bfb18d99a5eaa" ON "maintenance_requests"  ("unitId") `);
        await queryRunner.query(`CREATE INDEX "IDX_0330e7473e867931548e20dc4a" ON "maintenance_requests"  ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_a5a941c18099865aa831447d9a" ON "maintenance_requests"  ("assignedStaffId") `);
        await queryRunner.query(`CREATE TYPE "public"."maintenance_status_history_previousstatus_enum" AS ENUM('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED')`);
        await queryRunner.query(`CREATE TYPE "public"."maintenance_status_history_newstatus_enum" AS ENUM('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED')`);
        await queryRunner.query(`CREATE TABLE "maintenance_status_history" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "requestId" uuid NOT NULL, "previousStatus" "public"."maintenance_status_history_previousstatus_enum" NOT NULL, "newStatus" "public"."maintenance_status_history_newstatus_enum" NOT NULL, "changedById" uuid NOT NULL, "notes" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_bbc3ddabc0aa6edd8b519208ab2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3eb65489d889972981fff2b897" ON "maintenance_status_history"  ("requestId") `);
        await queryRunner.query(`CREATE TYPE "public"."notifications_type_enum" AS ENUM('LEASE_CREATED', 'LEASE_ACTIVATED', 'LEASE_TERMINATED', 'MAINTENANCE_CREATED', 'MAINTENANCE_ASSIGNED', 'MAINTENANCE_RESOLVED')`);
        await queryRunner.query(`CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "recipientId" uuid NOT NULL, "type" "public"."notifications_type_enum" NOT NULL, "title" character varying(150) NOT NULL, "message" text NOT NULL, "isRead" boolean NOT NULL DEFAULT false, "relatedEntityType" character varying(50), "relatedEntityId" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_6b6fd86acbb2e2987ad8237b88" ON "notifications"  ("recipientId", "isRead") `);
        await queryRunner.query(`ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_cfa83f61e4d27a87fcae1e025ab" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_610102b60fea1455310ccd299de" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "properties" ADD CONSTRAINT "FK_47b8bfd9c3165b8a53cd0c58df0" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "units" ADD CONSTRAINT "FK_546f4aa111022d983a32103048b" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "leases" ADD CONSTRAINT "FK_175030e58c0d1accdb888a431d8" FOREIGN KEY ("tenantId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "leases" ADD CONSTRAINT "FK_41ddb25063485103a828efc4084" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "maintenance_requests" ADD CONSTRAINT "FK_eb50b765c3312bfb18d99a5eaa0" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "maintenance_requests" ADD CONSTRAINT "FK_0aea50a0b5a28267b8e793218f9" FOREIGN KEY ("tenantId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "maintenance_requests" ADD CONSTRAINT "FK_a5a941c18099865aa831447d9a5" FOREIGN KEY ("assignedStaffId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "maintenance_status_history" ADD CONSTRAINT "FK_3eb65489d889972981fff2b897e" FOREIGN KEY ("requestId") REFERENCES "maintenance_requests"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "maintenance_status_history" ADD CONSTRAINT "FK_0a5fd6c06e2090812aa28b95e14" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD CONSTRAINT "FK_db873ba9a123711a4bff527ccd5" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "notifications" DROP CONSTRAINT "FK_db873ba9a123711a4bff527ccd5"`);
        await queryRunner.query(`ALTER TABLE "maintenance_status_history" DROP CONSTRAINT "FK_0a5fd6c06e2090812aa28b95e14"`);
        await queryRunner.query(`ALTER TABLE "maintenance_status_history" DROP CONSTRAINT "FK_3eb65489d889972981fff2b897e"`);
        await queryRunner.query(`ALTER TABLE "maintenance_requests" DROP CONSTRAINT "FK_a5a941c18099865aa831447d9a5"`);
        await queryRunner.query(`ALTER TABLE "maintenance_requests" DROP CONSTRAINT "FK_0aea50a0b5a28267b8e793218f9"`);
        await queryRunner.query(`ALTER TABLE "maintenance_requests" DROP CONSTRAINT "FK_eb50b765c3312bfb18d99a5eaa0"`);
        await queryRunner.query(`ALTER TABLE "leases" DROP CONSTRAINT "FK_41ddb25063485103a828efc4084"`);
        await queryRunner.query(`ALTER TABLE "leases" DROP CONSTRAINT "FK_175030e58c0d1accdb888a431d8"`);
        await queryRunner.query(`ALTER TABLE "units" DROP CONSTRAINT "FK_546f4aa111022d983a32103048b"`);
        await queryRunner.query(`ALTER TABLE "properties" DROP CONSTRAINT "FK_47b8bfd9c3165b8a53cd0c58df0"`);
        await queryRunner.query(`ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_610102b60fea1455310ccd299de"`);
        await queryRunner.query(`ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_cfa83f61e4d27a87fcae1e025ab"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6b6fd86acbb2e2987ad8237b88"`);
        await queryRunner.query(`DROP TABLE "notifications"`);
        await queryRunner.query(`DROP TYPE "public"."notifications_type_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3eb65489d889972981fff2b897"`);
        await queryRunner.query(`DROP TABLE "maintenance_status_history"`);
        await queryRunner.query(`DROP TYPE "public"."maintenance_status_history_newstatus_enum"`);
        await queryRunner.query(`DROP TYPE "public"."maintenance_status_history_previousstatus_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a5a941c18099865aa831447d9a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0330e7473e867931548e20dc4a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_eb50b765c3312bfb18d99a5eaa"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7a25fdc08fed6c0c68a1ebc3f5"`);
        await queryRunner.query(`DROP TABLE "maintenance_requests"`);
        await queryRunner.query(`DROP TYPE "public"."maintenance_requests_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."maintenance_requests_priority_enum"`);
        await queryRunner.query(`DROP TYPE "public"."maintenance_requests_category_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2c410fb5acd7bea80786e93cbf"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e2997c605acbdd5a568f5a65cb"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f04ca7b565c329d2a6f1b73c0f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_41ddb25063485103a828efc408"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_175030e58c0d1accdb888a431d"`);
        await queryRunner.query(`DROP TABLE "leases"`);
        await queryRunner.query(`DROP TYPE "public"."leases_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_37768e6e1261ee85920f8a387d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_546f4aa111022d983a32103048"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9460e0db09188323b61e9bf4b4"`);
        await queryRunner.query(`DROP TABLE "units"`);
        await queryRunner.query(`DROP TYPE "public"."units_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_47b8bfd9c3165b8a53cd0c58df"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c7aea7f222acdb48e3422361f8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b8a33773574f818b93eb6a78b4"`);
        await queryRunner.query(`DROP TABLE "properties"`);
        await queryRunner.query(`DROP TYPE "public"."properties_propertytype_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_968936751ab847471635be8dc0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_610102b60fea1455310ccd299d"`);
        await queryRunner.query(`DROP TABLE "refresh_tokens"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_445557993007fefee3aa9f1117"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cee5459245f652b75eb2759b4c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cfa83f61e4d27a87fcae1e025a"`);
        await queryRunner.query(`DROP TABLE "audit_logs"`);
        await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    }

}
