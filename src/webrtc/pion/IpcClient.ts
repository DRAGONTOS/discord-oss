import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import net from "node:net";

const MAX_IN_FLIGHT_REQUESTS = 128;

export interface IpcPayload {
    type: string;
    clientId: string;
    sdp?: string;
    trackType?: "audio" | "video";
    publisherId?: string;
    ssrc?: number;
    blockAudio?: boolean;
    blockVideo?: boolean;
    deaf?: boolean;
    remote?: string;
    mode?: string;
    key?: string;
    rtxSsrc?: number;
    audioPayloadType?: number;
    videoPayloadType?: number;
    rtxPayloadType?: number;
}

interface IpcMessage {
    id: string;
    type: "request" | "response" | "ping" | "pong";
    payload: IpcPayload;
    error?: string;
}

export class IpcClient {
    private socket?: net.Socket;
    private chunks: Buffer[] = [];
    private bufferedLength = 0;
    private pending = new Map<
        string,
        {
            resolve: (payload: IpcPayload) => void;
            reject: (error: Error) => void;
            timeout: NodeJS.Timeout;
        }
    >();

    constructor(
        readonly socketPath: string,
        private readonly onEvent: (payload: IpcPayload) => void,
        private readonly onClose?: () => void,
    ) {}

    get connected() {
        return this.socket?.readyState === "open";
    }

    async connect(timeoutMs = 15000) {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            try {
                await this.tryConnect();
                return;
            } catch (error) {
                if (Date.now() > deadline) throw error;
                await sleep(250);
            }
        }
    }

    private tryConnect() {
        return new Promise<void>((resolve, reject) => {
            const socket = net.createConnection(this.socketPath);
            socket.once("connect", () => {
                this.socket = socket;
                this.chunks = [];
                this.bufferedLength = 0;
                socket.on("data", (chunk: Buffer) => this.onData(chunk));
                socket.on("close", () => {
                    this.rejectAll(new Error("IPC connection closed"));
                    if (this.socket === socket) this.socket = undefined;
                    this.onClose?.();
                });
                resolve();
            });
            socket.once("error", (error) => {
                socket.destroy();
                reject(error);
            });
        });
    }

    private onData(chunk: Buffer) {
        this.chunks.push(chunk);
        this.bufferedLength += chunk.length;
        while (this.bufferedLength >= 4) {
            const length = this.peekUInt32BE();
            if (this.bufferedLength < 4 + length) break;
            const frame = this.consume(4 + length);
            this.onMessage(JSON.parse(frame.subarray(4).toString()) as IpcMessage);
        }
    }

    private peekUInt32BE() {
        let remaining = 4;
        let value = 0;
        outer: for (const chunk of this.chunks) {
            for (let i = 0; i < chunk.length; i++) {
                value = (value << 8) | chunk[i];
                if (--remaining === 0) break outer;
            }
        }
        return value >>> 0;
    }

    private consume(count: number) {
        const pieces: Buffer[] = [];
        let remaining = count;
        while (remaining > 0) {
            const chunk = this.chunks[0];
            if (chunk.length <= remaining) {
                pieces.push(chunk);
                this.chunks.shift();
                remaining -= chunk.length;
            } else {
                pieces.push(chunk.subarray(0, remaining));
                this.chunks[0] = chunk.subarray(remaining);
                remaining = 0;
            }
        }
        this.bufferedLength -= count;
        return pieces.length === 1 ? pieces[0] : Buffer.concat(pieces, count);
    }

    private onMessage(message: IpcMessage) {
        const request = message.id ? this.pending.get(message.id) : undefined;
        if (message.type === "response" && request) {
            clearTimeout(request.timeout);
            this.pending.delete(message.id);
            if (message.error) request.reject(new Error(message.error));
            else request.resolve(message.payload);
            return;
        }
        if (message.type === "ping") return this.write({ type: "pong", clientId: message.payload?.clientId ?? "" }, message.id, "pong");
        if (message.payload) this.onEvent(message.payload);
    }

    async ping(timeoutMs = 2000) {
        const started = performance.now();
        await this.request({ type: "ping", clientId: "" }, timeoutMs, "ping");
        return performance.now() - started;
    }

    request(payload: IpcPayload, timeoutMs = 10000, type: IpcMessage["type"] = "request") {
        return new Promise<IpcPayload>((resolve, reject) => {
            if (!this.connected) {
                reject(new Error("SFU IPC socket is not connected"));
                return;
            }
            if (this.pending.size >= MAX_IN_FLIGHT_REQUESTS) {
                reject(new Error(`SFU IPC request ${payload.type} rejected: too many in-flight requests`));
                return;
            }
            const id = randomUUID();
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`SFU IPC request ${payload.type} timed out`));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timeout });
            this.write(payload, id, type);
        });
    }

    send(payload: IpcPayload) {
        if (this.connected) this.write(payload, randomUUID());
    }

    private write(payload: IpcPayload, id: string, type: IpcMessage["type"] = "request") {
        const body = Buffer.from(JSON.stringify({ id, type, payload } satisfies IpcMessage));
        const header = Buffer.alloc(4);
        header.writeUInt32BE(body.length);
        this.socket?.write(Buffer.concat([header, body]));
    }

    private rejectAll(error: Error) {
        for (const request of this.pending.values()) {
            clearTimeout(request.timeout);
            request.reject(error);
        }
        this.pending.clear();
    }

    close() {
        this.rejectAll(new Error("IPC connection closed"));
        this.socket?.end();
        this.socket = undefined;
    }
}
