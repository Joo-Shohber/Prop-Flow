import { MigrationInterface, QueryRunner } from "typeorm";

export class Initial1790773883975 implements MigrationInterface {
    name = 'Initial1790773883975'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "avatar" SET DEFAULT '{"url":"https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460__480.png","publicId":"null","source":"default"}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "avatar" SET DEFAULT '{"url": "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460__480.png", "publicId": "null"}'`);
        await queryRunner.query(`CREATE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users" USING btree ("email") `);
    }

}
