import { createHash } from "node:crypto";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseClass } from "./BaseClass";
import { User } from "./User";

@Entity({
    name: "stream_keys",
})
@Index("IDX_stream_key_user", ["user_id"], { unique: true })
export class StreamKey extends BaseClass {
    @Column({ type: "int8" })
    user_id: string;

    @JoinColumn({ name: "user_id", foreignKeyConstraintName: "FK_stream_key_user_id" })
    @ManyToOne(() => User, { onDelete: "CASCADE" })
    user: User;

    @Column({ type: "int8" })
    guild_id: string;

    @Column({ type: "int8" })
    channel_id: string;

    @Index("IDX_stream_key_hash", { unique: true })
    @Column({ type: "varchar" })
    key_hash: string;

    @Column({ type: "timestamptz", default: () => "now()" })
    created_at: Date;

    @Column({ type: "timestamptz", nullable: true })
    last_used_at: Date | null;

    @Column({ type: "timestamptz", nullable: true })
    expires_at: Date | null;
}

export const hashStreamKey = (key: string) => createHash("sha256").update(key).digest("base64url");

export async function resolveStreamIngestKey(key: string): Promise<{ user_id: string; guild_id: string; channel_id: string } | null> {
    if (typeof key !== "string" || key.length === 0) return null;
    const record = await StreamKey.findOne({ where: { key_hash: hashStreamKey(key) } });
    if (!record || (record.expires_at && new Date(record.expires_at).getTime() <= Date.now())) return null;
    await StreamKey.update({ id: record.id }, { last_used_at: new Date() });
    return { user_id: record.user_id, guild_id: record.guild_id, channel_id: record.channel_id };
}
