import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateRentalRequest1791632154317 implements MigrationInterface {
    name = 'UpdateRentalRequest1791632154317'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_381fef40388009b8598c6f0feb"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_rental_request_pending_tenant_unit" ON "rental_requests"  ("tenantId", "unitId") WHERE "status" = 'PENDING'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."UQ_rental_request_pending_tenant_unit"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_381fef40388009b8598c6f0feb" ON "rental_requests" USING btree ("tenantId", "unitId") WHERE (status = 'PENDING'::rental_requests_status_enum)`);
    }

}
