import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateUnitAndProperty1791287387632 implements MigrationInterface {
    name = 'UpdateUnitAndProperty1791287387632'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "rental_requests" ADD CONSTRAINT "UQ_rental_request_tenant_unit" UNIQUE ("tenantId", "unitId")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "rental_requests" DROP CONSTRAINT "UQ_rental_request_tenant_unit"`);
    }

}
