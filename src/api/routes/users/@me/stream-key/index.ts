import { randomBytes } from "node:crypto";
import { route } from "@spacebar/api/middlewares";
import { StreamKey, VoiceState, hashStreamKey, resolveStreamIngestKey } from "@spacebar/database";
import { FieldErrors } from "@spacebar/util";
import { Request, Response, Router } from "express";

export { hashStreamKey, resolveStreamIngestKey };

const router: Router = Router({ mergeParams: true });

const STREAM_KEY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SNOWFLAKE = /^\d{1,20}$/;

interface StreamKeyCreateBody {
    guild_id: string;
    channel_id: string;
}

router.get(
    "/",
    route({
        responses: { 200: {} },
    }),
    async (req: Request, res: Response) => {
        const record = await StreamKey.findOne({ where: { user_id: req.user_id } });
        return res.json({
            has_key: !!record,
            created_at: record?.created_at ? new Date(record.created_at).toISOString() : null,
            last_used_at: record?.last_used_at ? new Date(record.last_used_at).toISOString() : null,
            guild_id: record?.guild_id ?? null,
            channel_id: record?.channel_id ?? null,
            expires_at: record?.expires_at ? new Date(record.expires_at).toISOString() : null,
        });
    },
);

router.post(
    "/",
    route({
        responses: { 200: {}, 400: { body: "APIErrorResponse" } },
    }),
    async (req: Request, res: Response) => {
        const { guild_id, channel_id } = req.body as StreamKeyCreateBody;
        const fields: Record<string, { code: string; message: string }> = {};
        if (typeof guild_id !== "string" || !SNOWFLAKE.test(guild_id)) fields.guild_id = { code: "BASE_TYPE_INVALID", message: "Invalid guild id." };
        if (typeof channel_id !== "string" || !SNOWFLAKE.test(channel_id)) fields.channel_id = { code: "BASE_TYPE_INVALID", message: "Invalid channel id." };
        if (Object.keys(fields).length) throw FieldErrors(fields);

        const voiceState = await VoiceState.findOne({ where: { user_id: req.user_id, channel_id } });
        if (!voiceState || (voiceState.guild_id ?? null) !== guild_id) throw FieldErrors({ channel_id: { code: "BASE_TYPE_INVALID", message: "Join the voice channel first." } });

        const key = randomBytes(32).toString("base64url");
        const created_at = new Date();
        const expires_at = new Date(created_at.getTime() + STREAM_KEY_TTL_MS);

        await StreamKey.delete({ user_id: req.user_id });
        await StreamKey.create({
            user_id: req.user_id,
            guild_id,
            channel_id,
            key_hash: hashStreamKey(key),
            created_at,
            last_used_at: null,
            expires_at,
        }).save();

        return res.json({
            key,
            created_at: created_at.toISOString(),
            guild_id,
            channel_id,
            expires_at: expires_at.toISOString(),
        });
    },
);

router.delete(
    "/",
    route({
        responses: { 204: {} },
    }),
    async (req: Request, res: Response) => {
        await StreamKey.delete({ user_id: req.user_id });
        return res.sendStatus(204);
    },
);

export default router;
