import { Member, Stream, VoiceState, resolveStreamIngestKey } from "@spacebar/database";
import { generateStreamKey } from "@spacebar/gateway";
import { Config, Snowflake, emitEvent } from "@spacebar/util";
import type { StreamDeleteEvent, VoiceStateUpdateEvent } from "@spacebar/util";
import { mediaServer } from "@spacebar/webrtc";
import type { Request, Response } from "express";

import type { PionMediaServer } from "../../../webrtc/pion/PionMediaServer";
import { announceExternalPublisher } from "../../../webrtc/opcodes/Video";

type Publisher = Awaited<ReturnType<PionMediaServer["registerExternalPublisher"]>>;

const getMedia = () => mediaServer as PionMediaServer;
const active = new Map<string, { client: Publisher; streamId: string }>();

export const resolveKey = (req: Request) => {
    const fromPath = typeof req.params.key === "string" ? req.params.key : "";
    if (fromPath) return fromPath;
    const authorization = req.get("authorization");
    return authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
};

const ssrcsOf = (sdp: string) => {
    const all = [...sdp.matchAll(/^a=ssrc:(\d+)/gm)].map((match) => Number(match[1]));
    return { audio: all[0], video: all[1] };
};

async function startExternalStream(userId: string, channelId: string) {
    const voiceState = await VoiceState.findOne({ where: { user_id: userId, channel_id: channelId } });
    if (!voiceState) throw new Error("not connected to the voice channel");
    const region = Config.get().regions.available.find((entry) => entry.id === Config.get().regions.default);
    if (!region) throw new Error("no default region configured");

    let stream = await Stream.findOne({ where: { owner_id: userId, channel_id: channelId } });
    if (!stream) {
        stream = Stream.create({ id: Snowflake.generate(), owner_id: userId, channel_id: channelId, endpoint: region.endpoint });
        await stream.save();
    }
    voiceState.self_stream = true;
    await voiceState.save();
    if (voiceState.guild_id)
        voiceState.member = await Member.findOneOrFail({
            where: { id: userId, guild_id: voiceState.guild_id },
            relations: { user: true, roles: true },
        });
    await emitEvent({
        event: "VOICE_STATE_UPDATE",
        user_id: userId,
        guild_id: voiceState.guild_id ?? undefined,
        channel_id: voiceState.guild_id ? undefined : channelId,
        data: { ...voiceState.toPublicVoiceState(), member: voiceState.member?.toPublicMember() },
    } satisfies VoiceStateUpdateEvent);

    return stream;
}

async function endExternalStream(streamId: string, userId: string) {
    const stream = await Stream.findOne({ where: { id: streamId }, relations: { channel: true } });
    if (!stream) return;
    const guildId = stream.channel?.guild_id ?? undefined;
    const channelId = stream.channel_id;
    const streamKey = generateStreamKey(guildId ? "guild" : "call", guildId, channelId, userId);
    await emitEvent({
        event: "STREAM_DELETE",
        guild_id: guildId,
        channel_id: guildId ? undefined : channelId,
        data: { stream_key: streamKey },
    } satisfies StreamDeleteEvent);
    await stream.remove();

    const voiceState = await VoiceState.findOne({ where: { user_id: userId, channel_id: channelId } });
    if (voiceState?.self_stream) {
        voiceState.self_stream = false;
        await voiceState.save();
        if (voiceState.guild_id)
            voiceState.member = await Member.findOneOrFail({
                where: { id: userId, guild_id: voiceState.guild_id },
                relations: { user: true, roles: true },
            });
        await emitEvent({
            event: "VOICE_STATE_UPDATE",
            user_id: userId,
            guild_id: voiceState.guild_id ?? undefined,
            channel_id: voiceState.guild_id ? undefined : channelId,
            data: { ...voiceState.toPublicVoiceState(), member: voiceState.member?.toPublicMember() },
        } satisfies VoiceStateUpdateEvent);
    }
}

function bindDisconnectHandler() {
    const media = getMedia();
    if (!media || media.onExternalDisconnected) return;
    media.onExternalDisconnected = async (client) => {
        for (const [key, session] of active) {
            if (session.client.user_id === client.user_id && session.client.voiceRoomId === client.voiceRoomId) {
                active.delete(key);
                await endExternalStream(session.streamId, session.client.user_id);
            }
        }
    };
}

export async function whipPost(req: Request, res: Response) {
    const key = resolveKey(req);
    const sdp = typeof req.body === "string" ? req.body : "";
    if (!sdp || !key) return res.status(400).send();

    bindDisconnectHandler();
    const record = await resolveStreamIngestKey(key);
    if (!record) return res.status(404).send();
    if (active.has(key)) return res.status(409).send();

    const parsed = ssrcsOf(sdp);
    const audioSsrc = parsed.audio ?? 1;
    const videoSsrc = parsed.video ?? audioSsrc + 2;
    const rtxSsrc = videoSsrc + 1;

    let client: Publisher | undefined;
    let streamId: string | undefined;
    try {
        const stream = await startExternalStream(record.user_id, record.channel_id);
        streamId = stream.id;
        const roomId = stream.id;
        client = await getMedia().registerExternalPublisher(roomId, record.user_id, { voiceProtocol: "webrtc" });
        client.initIncomingSSRCs({ audio_ssrc: audioSsrc, video_ssrc: videoSsrc, rtx_ssrc: rtxSsrc });
        client.videoStream = {
            type: "video",
            rid: "100",
            ssrc: videoSsrc,
            active: true,
            quality: 100,
            rtx_ssrc: rtxSsrc,
            max_bitrate: 2500000,
            max_framerate: 30,
            max_resolution: { type: "fixed", width: 1280, height: 720 },
        };
        client.publishTrack("audio", { audio_ssrc: audioSsrc });
        client.publishTrack("video", { video_ssrc: videoSsrc, rtx_ssrc: rtxSsrc });

        const answer = await getMedia().acceptExternalOffer(client, sdp, roomId, record.user_id);
        if (!answer?.sdp) throw new Error("SFU did not return an SDP answer");

        active.set(key, { client, streamId: stream.id });
        await announceExternalPublisher(record.user_id, roomId, client.videoStream, audioSsrc, videoSsrc, rtxSsrc);
        res.set("Location", `/whip/${encodeURIComponent(key)}`);
        res.set("Accept-Patch", "application/trickle-ice-sdpfrag");
        res.set("Access-Control-Expose-Headers", "Location, Accept-Patch, ETag");
        res.set("ETag", `W/"${key}"`);
        return res.status(201).set("Content-Type", "application/sdp").send(answer.sdp);
    } catch (error) {
        if (client) getMedia().removeExternalPublisher(client);
        if (streamId) await endExternalStream(streamId, record.user_id);
        console.error(`[WHIP] failed to publish ${key}:`, error);
        return res.status(500).send();
    }
}

export function whipPatch(req: Request, res: Response) {
    const key = resolveKey(req);
    const session = active.get(key);
    const body = typeof req.body === "string" ? req.body : Buffer.isBuffer(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body ?? "");
    let count = 0;
    if (session) {
        for (const line of body.split(/\r?\n/)) {
            const candidate = line.trim().replace(/^a=/, "");
            if (candidate.startsWith("candidate:")) {
                getMedia().addExternalIceCandidate(session.client, candidate);
                count++;
            }
        }
    }
    console.log(`[WHIP PATCH] key=${key ? "present" : "missing"} client=${!!session} type=${req.get("content-type") ?? "none"} bytes=${body.length} candidates=${count}`);
    return res.sendStatus(204);
}

export async function whipDelete(req: Request, res: Response) {
    const key = resolveKey(req);
    const session = active.get(key);
    if (session) {
        active.delete(key);
        getMedia().removeExternalPublisher(session.client);
        await endExternalStream(session.streamId, session.client.user_id);
    }
    return res.sendStatus(204);
}
