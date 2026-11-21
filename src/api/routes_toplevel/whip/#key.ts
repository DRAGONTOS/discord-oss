import { resolveStreamIngestKey } from "@spacebar/database";
import { route } from "@spacebar/api/middlewares";
import { mediaServer } from "@spacebar/webrtc";
import express, { Request, Response, Router } from "express";

import type { PionMediaServer } from "../../../webrtc/pion/PionMediaServer";
import { announceExternalPublisher } from "../../../webrtc/opcodes/Video";

const getMedia = () => mediaServer as PionMediaServer;
const router = Router({ mergeParams: true });
const active = new Map<string, Awaited<ReturnType<PionMediaServer["registerExternalPublisher"]>>>();

const ssrcsOf = (sdp: string) => {
    const all = [...sdp.matchAll(/^a=ssrc:(\d+)/gm)].map((match) => Number(match[1]));
    return { audio: all[0], video: all[1] };
};

router.post(
    "/",
    express.text({ type: "application/sdp", limit: "2mb" }),
    route({ authentication: "never", responses: { 201: {}, 400: {}, 404: {} } }),
    async (req: Request, res: Response) => {
        const key = req.params.key as string;
        const sdp = typeof req.body === "string" ? req.body : "";
        if (!sdp) return res.status(400).send();

        bindDisconnectHandler();
        const record = await resolveStreamIngestKey(key);
        if (!record) return res.status(404).send();
        if (active.has(key)) return res.status(409).send();

        const parsed = ssrcsOf(sdp);
        const audioSsrc = parsed.audio ?? 1;
        const videoSsrc = parsed.video ?? audioSsrc + 2;
        const rtxSsrc = videoSsrc + 1;
        const roomId = record.channel_id;

        let client: Awaited<ReturnType<PionMediaServer["registerExternalPublisher"]>> | undefined;
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
    },
);

router.patch(
    "/",
    express.text({ type: ["application/trickle-ice-sdpfrag", "application/sdp"], limit: "1mb" }),
    route({ authentication: "never", responses: { 204: {} } }),
    (req: Request, res: Response) => {
        const client = active.get(req.params.key as string);
        const body = typeof req.body === "string" ? req.body : "";
        if (client) {
            for (const line of body.split(/\r?\n/)) {
                const candidate = line.trim().replace(/^a=/, "");
                if (candidate.startsWith("candidate:")) getMedia().addExternalIceCandidate(client, candidate);
            }
        }
        return res.sendStatus(204);
    },
);

router.delete("/", route({ authentication: "never", responses: { 204: {} } }), async (req: Request, res: Response) => {
    const key = req.params.key as string;
    const client = active.get(key);
    if (client) {
        active.delete(key);
        getMedia().removeExternalPublisher(client);
    }
    return res.sendStatus(204);
});

function bindDisconnectHandler() {
    const media = getMedia();
    if (!media || media.onExternalDisconnected) return;
    media.onExternalDisconnected = (client) => {
        for (const [key, publisher] of active) {
            if (publisher.user_id === client.user_id && publisher.voiceRoomId === client.voiceRoomId) active.delete(key);
        }
    };
}

export default router;
