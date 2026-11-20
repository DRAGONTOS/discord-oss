import type { MigrationInterface, QueryRunner } from "typeorm";

export class StreamKeys1794712847931 implements MigrationInterface {
    name = "StreamKeys1794712847931";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "stream_keys" ("id" int8 PRIMARY KEY NOT NULL, "user_id" int8 NOT NULL, "guild_id" int8 NOT NULL, "channel_id" int8 NOT NULL, "key_hash" varchar NOT NULL, "created_at" datetime NOT NULL DEFAULT ((strftime('%Y-%m-%d %H:%M:%f', 'now'))), "last_used_at" datetime, "expires_at" datetime, CONSTRAINT "FK_stream_key_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
        );
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_stream_key_user" ON "stream_keys" ("user_id")`);
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_stream_key_hash" ON "stream_keys" ("key_hash")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "stream_keys"`);
    }
}
