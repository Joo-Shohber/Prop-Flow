import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateUnitAndProperty1791201331582 implements MigrationInterface {
    name = 'UpdateUnitAndProperty1791201331582'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "units" DROP CONSTRAINT "UQ_5280c1dd7a7b5b659cc57776fbc"`);
        await queryRunner.query(`ALTER TABLE "units" DROP COLUMN "building"`);
        await queryRunner.query(`ALTER TYPE "public"."properties_propertytype_enum" RENAME TO "properties_propertytype_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."properties_propertytype_enum" AS ENUM('BUILDING', 'VILLA', 'STUDIO', 'TOWNHOUSE', 'COMMERCIAL', 'OTHER')`);
        await queryRunner.query(`ALTER TABLE "properties" ALTER COLUMN "propertyType" TYPE "public"."properties_propertytype_enum" USING "propertyType"::"text"::"public"."properties_propertytype_enum"`);
        await queryRunner.query(`DROP TYPE "public"."properties_propertytype_enum_old"`);
        await queryRunner.query(`ALTER TABLE "properties" ALTER COLUMN "country" SET DEFAULT 'Egypt'`);
        await queryRunner.query(`ALTER TABLE "units" ADD CONSTRAINT "UQ_177f53e2c2545127efe2fe8a8d2" UNIQUE ("propertyId", "unitNumber")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "units" DROP CONSTRAINT "UQ_177f53e2c2545127efe2fe8a8d2"`);
        await queryRunner.query(`ALTER TABLE "properties" ALTER COLUMN "country" DROP DEFAULT`);
        await queryRunner.query(`CREATE TYPE "public"."properties_propertytype_enum_old" AS ENUM('APARTMENT', 'VILLA', 'STUDIO', 'TOWNHOUSE', 'COMMERCIAL', 'OTHER')`);
        await queryRunner.query(`ALTER TABLE "properties" ALTER COLUMN "propertyType" TYPE "public"."properties_propertytype_enum_old" USING "propertyType"::"text"::"public"."properties_propertytype_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."properties_propertytype_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."properties_propertytype_enum_old" RENAME TO "properties_propertytype_enum"`);
        await queryRunner.query(`ALTER TABLE "units" ADD "building" character varying(100) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "units" ADD CONSTRAINT "UQ_5280c1dd7a7b5b659cc57776fbc" UNIQUE ("unitNumber", "building", "propertyId")`);
    }

}
