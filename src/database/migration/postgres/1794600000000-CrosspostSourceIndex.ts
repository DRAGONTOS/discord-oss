import { MigrationInterface, QueryRunner } from "typeorm";

export class CrosspostSourceIndex1794600000000 implements MigrationInterface {
    name = "CrosspostSourceIndex1794600000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_messages_crosspost_source" ON "messages" (("message_reference" ->> 'message_id')) WHERE "message_reference" IS NOT NULL`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_crosspost_source"`);
    }
}
