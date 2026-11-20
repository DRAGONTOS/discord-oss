import { Payload, WebSocket } from "@spacebar/gateway";
import fs from "node:fs/promises";
import path from "node:path";

import { JSONStringify } from "@spacebar/util";
import { boundedDispatchPush, bufferForResume, notePayloadSize, rememberDispatch, resolveSocket } from "./SessionResume";
import { filterBotDispatch } from "./GatewayIntents";
import { packEtf } from "./Etf";

type DispatchCache = {
    t: string;
    dJson: string;
    prefix: string;
    suffix: string;
    baseBytes: number;
    parsed?: Record<string, unknown>;
};

const serializedData = new WeakMap<object, DispatchCache>();

function encodePayload(data: Payload): { json: string; bytes: number; cache?: DispatchCache } {
    const d = data.d;
    if (data.op !== 0 || typeof data.t !== "string" || typeof data.s !== "number" || typeof d !== "object" || d === null) {
        const json = JSONStringify(data);
        return { json, bytes: Buffer.byteLength(json) };
    }
    let cache = serializedData.get(d);
    if (!cache || cache.t !== data.t) {
        const dJson = JSONStringify(d);
        const prefix = `{"op":0,"t":${JSON.stringify(data.t)},"d":`;
        const suffix = `,"s":`;
        cache = {
            t: data.t,
            dJson,
            prefix,
            suffix,
            baseBytes: Buffer.byteLength(prefix) + Buffer.byteLength(dJson) + Buffer.byteLength(suffix) + 1,
        };
        serializedData.set(d, cache);
    }
    const s = `${data.s}`;
    return { json: `${cache.prefix}${cache.dJson}${cache.suffix}${s}}`, bytes: cache.baseBytes + s.length, cache };
}

export function serializePayload(data: Payload) {
    return encodePayload(data).json;
}

export async function Send(target: WebSocket, data: Payload, guildId?: string) {
    const socket = resolveSocket(target);
    const filtered = filterBotDispatch(socket, data, guildId);
    if (!filtered) return;
    data = filtered;
    if (socket.pendingDispatches && data.op === 0 && data.t !== "READY" && data.t !== "READY_SUPPLEMENTAL" && data.t !== "GUILD_CREATE") {
        if (!boundedDispatchPush(socket.pendingDispatches, data, 1000, 8 * 1024 * 1024)) {
            socket.pendingDispatches = undefined;
            socket.close(4008, "Pending dispatch limit exceeded");
        }
        return;
    }
    const encoded = encodePayload(data);
    const json = encoded.json;
    notePayloadSize(data, encoded.bytes);
    if (socket.readyState !== 1 && data.op === 0 && bufferForResume(socket, data)) return;
    rememberDispatch(socket, data);
    if (process.env.WS_VERBOSE) console.log(`[Websocket] Outgoing message: ${JSON.stringify(data)}`);
    if (socket.encoding !== "json" && socket.encoding !== "etf") return;

    let buffer: Buffer | string = json;
    if (socket.encoding === "etf") {
        let parsed = encoded.cache?.parsed;
        if (!parsed) {
            parsed = JSON.parse(json) as Record<string, unknown>;
            if (encoded.cache) encoded.cache.parsed = parsed;
        } else parsed.s = data.s;
        buffer = packEtf(parsed);
    }
    if (socket.compress === "zlib-stream") buffer = socket.deflate!.process(buffer) as Buffer;
    else if (socket.compress === "zstd-stream") buffer = socket.zstdEncoder!.process(buffer);

    if (process.env.WS_DUMP) {
        const id = socket.session_id || "unknown";

        await fs.mkdir(path.join("dump", id), {
            recursive: true,
        });
        await fs.writeFile(path.join("dump", id, `${Date.now()}.out.json`), JSON.stringify(data, null, 2));
    }

    return new Promise((res) => {
        if (socket.readyState === 1 && socket.bufferedAmount + (typeof buffer === "string" ? Buffer.byteLength(buffer) : buffer.byteLength) > 32 * 1024 * 1024) {
            socket.close(4008, "Outgoing dispatch limit exceeded");
            res(null);
        } else if (socket.readyState === 1) socket.send(buffer, () => res(null));
        else {
            socket.close();
            res(null);
        }
    });
}
