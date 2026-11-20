import { MigrationInterface, QueryRunner } from "typeorm";

export class StreamKeys1794712847931 implements MigrationInterface {
    name = "StreamKeys1794712847931";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "stream_keys" ("id" bigint NOT NULL, "user_id" bigint NOT NULL, "guild_id" bigint NOT NULL, "channel_id" bigint NOT NULL, "key_hash" character varying NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "last_used_at" TIMESTAMP WITH TIME ZONE, "expires_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_stream_keys_id" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_stream_key_user" ON "stream_keys" ("user_id")`);
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_stream_key_hash" ON "stream_keys" ("key_hash")`);
        await queryRunner.query(`ALTER TABLE "stream_keys" DROP CONSTRAINT IF EXISTS "FK_stream_key_user_id"`);
        await queryRunner.query(
            `ALTER TABLE "stream_keys" ADD CONSTRAINT "FK_stream_key_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "stream_keys"`);
    }
}
