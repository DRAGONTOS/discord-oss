import type { MigrationInterface, QueryRunner } from "typeorm";

const hasColumn = async (queryRunner: QueryRunner, table: string, name: string) => {
    const rows: { name: string }[] = await queryRunner.query(`PRAGMA table_info("${table}")`);
    return rows.some((row) => row.name === name);
};

export class RestrictAttachments1794470000000 implements MigrationInterface {
    name = "RestrictAttachments1794470000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await hasColumn(queryRunner, "guilds", "restrict_attachments")))
            await queryRunner.query(`ALTER TABLE "guilds" ADD COLUMN "restrict_attachments" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await hasColumn(queryRunner, "guilds", "restrict_attachments")) await queryRunner.query(`ALTER TABLE "guilds" DROP COLUMN "restrict_attachments"`);
    }
}
