import { MigrationInterface, QueryRunner } from "typeorm";

export class RestrictAttachments1794470000000 implements MigrationInterface {
    name = "RestrictAttachments1794470000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "guilds" ADD COLUMN IF NOT EXISTS "restrict_attachments" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "guilds" DROP COLUMN IF EXISTS "restrict_attachments"`);
    }
}
