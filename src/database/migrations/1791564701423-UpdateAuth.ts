import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateAuth1791564701423 implements MigrationInterface {
    name = 'UpdateAuth1791564701423'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "rental_requests" ADD "leaseId" uuid`);
        await queryRunner.query(`CREATE INDEX "IDX_56b91d98f71e3d1b649ed6e9f3" ON "refresh_tokens"  ("expiresAt") `);
        await queryRunner.query(`ALTER TABLE "rental_requests" ADD CONSTRAINT "FK_0b818145dd2a451ad33066e3afe" FOREIGN KEY ("leaseId") REFERENCES "leases"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "rental_requests" DROP CONSTRAINT "FK_0b818145dd2a451ad33066e3afe"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_56b91d98f71e3d1b649ed6e9f3"`);
        await queryRunner.query(`ALTER TABLE "rental_requests" DROP COLUMN "leaseId"`);
    }

}
