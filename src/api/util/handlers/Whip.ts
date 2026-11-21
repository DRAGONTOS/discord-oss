import { resolveStreamIngestKey } from "@spacebar/database";
import { mediaServer } from "@spacebar/webrtc";
import type { Request, Response } from "express";

import type { PionMediaServer } from "../../../webrtc/pion/PionMediaServer";
import { announceExternalPublisher } from "../../../webrtc/opcodes/Video";

type Publisher = Awaited<ReturnType<PionMediaServer["registerExternalPublisher"]>>;

const getMedia = () => mediaServer as PionMediaServer;
const active = new Map<string, Publisher>();

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

function bindDisconnectHandler() {
    const media = getMedia();
    if (!media || media.onExternalDisconnected) return;
    media.onExternalDisconnected = (client) => {
        for (const [key, publisher] of active) {
            if (publisher.user_id === client.user_id && publisher.voiceRoomId === client.voiceRoomId) active.delete(key);
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
    const roomId = record.channel_id;

    let client: Publisher | undefined;
    try {
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

        active.set(key, client);
        await announceExternalPublisher(record.user_id, roomId, client.videoStream, audioSsrc, videoSsrc, rtxSsrc);
        return res.status(201).set("Content-Type", "application/sdp").send(answer.sdp);
    } catch (error) {
        if (client) getMedia().removeExternalPublisher(client);
        console.error(`[WHIP] failed to publish ${key}:`, error);
        return res.status(500).send();
    }
}

export function whipPatch(req: Request, res: Response) {
    const key = resolveKey(req);
    const client = active.get(key);
    const body = typeof req.body === "string" ? req.body : Buffer.isBuffer(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body ?? "");
    let count = 0;
    if (client) {
        for (const line of body.split(/\r?\n/)) {
            const candidate = line.trim().replace(/^a=/, "");
            if (candidate.startsWith("candidate:")) {
                getMedia().addExternalIceCandidate(client, candidate);
                count++;
            }
        }
    }
    console.log(`[WHIP PATCH] key=${key ? "present" : "missing"} client=${!!client} type=${req.get("content-type") ?? "none"} bytes=${body.length} candidates=${count}`);
    return res.sendStatus(204);
}

export function whipDelete(req: Request, res: Response) {
    const key = resolveKey(req);
    const client = active.get(key);
    if (client) {
        active.delete(key);
        getMedia().removeExternalPublisher(client);
    }
    return res.sendStatus(204);
}
