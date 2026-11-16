import type { Attachments } from "../../../e2ee/src/attachments";
import type { RawAttachment, RawMessage } from "../../../e2ee/src/engine";
import { decryptFile, type FileMeta, type Payload } from "../../../e2ee/src/files";

type AnyRecord = Record<PropertyKey, any>;

const SPOILER_FLAG = 1 << 3;
// decrypting runs in JavaScript on the app's only JS thread, so very large files stay closed
export const MAX_DECRYPTED_FILE = 50 * 1024 * 1024;
const FOLDER = "meowcord-e2ee-files";
const PARALLEL = 2;
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export interface MobileAttachmentOptions {
    /** the app's NativeFileModule, looked up when the first file is decrypted */
    files: () => AnyRecord | null;
    /** the instance's origin: ciphertext must come from it or from a host it names */
    origin: string;
    /** shows a message again once a file of it is on disk */
    redraw: (message: RawMessage) => void;
    log: (message: string) => void;
    fetch?: (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
}

// The web's attachmentCiphertextUrl with a regex instead of URL, which React Native implements only in part:
// a file on the instance must be this channel's attachment under its own name; another host is the instance's CDN.
export const ciphertextUrl = (value: string, channelId: string, filename: string, origin: string): string | null => {
    const url = /^(https?):\/\/([^/?#@\\]+)(\/[^?#]*)(\?[^#]*)?(#.*)?$/.exec(value);
    const home = /^https?:\/\/([^/?#@\\]+)/.exec(origin);
    if (!url || !home) return null;
    if (url[2].toLowerCase() !== home[1].toLowerCase()) return value;
    if (!/^\d+$/.test(channelId)) return null;
    const path = /^\/attachments\/(\d+)\/(\d+)\/([^/]+)$/.exec(url[3]);
    if (!path || path[1] !== channelId) return null;
    try {
        const decoded = decodeURIComponent(path[3]);
        if (/[/\\\0]/.test(decoded) || decoded !== filename) return null;
    } catch {
        return null;
    }
    return value;
};

export const bytesToBase64 = (bytes: Uint8Array) => {
    const out = new Uint8Array(Math.ceil(bytes.length / 3) * 4);
    let o = 0;
    for (let i = 0; i < bytes.length; i += 3) {
        const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
        out[o++] = BASE64.charCodeAt((n >> 18) & 63);
        out[o++] = BASE64.charCodeAt((n >> 12) & 63);
        out[o++] = i + 1 < bytes.length ? BASE64.charCodeAt((n >> 6) & 63) : 61;
        out[o++] = i + 2 < bytes.length ? BASE64.charCodeAt(n & 63) : 61;
    }
    let text = "";
    for (let i = 0; i < out.length; i += 0x8000) text += String.fromCharCode.apply(null, Array.from(out.subarray(i, i + 0x8000)));
    return text;
};

const join = (parts: ArrayBuffer[]) => {
    const bytes = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
    let offset = 0;
    for (const part of parts) {
        bytes.set(new Uint8Array(part), offset);
        offset += part.byteLength;
    }
    return bytes;
};

// the attachment id names the file; the extension lets the native image and video loaders pick a decoder
export const localName = (attachmentId: string, filename: string) => {
    const extension = /\.([A-Za-z0-9]{1,8})$/.exec(filename)?.[1]?.toLowerCase();
    return `${FOLDER}/${attachmentId.replace(/\D/g, "")}${extension ? `.${extension}` : ""}`;
};

// Encrypted attachments in DMs reach the server as opaque .bin files. The web client decrypts them in a service
// worker; the app has none, so the decrypted file goes to the app's cache folder and the attachment points there.
// Until a file is on disk the attachment carries a different URL, so the redraw loads the real file afresh.
export const createMobileAttachments = (options: MobileAttachmentOptions) => {
    const ready = new Set<string>();
    const failed = new Set<string>();
    const queued = new Map<string, () => Promise<void>>();
    let running = 0;
    let folder: { dir: "cache" | "documents"; path: string; files: AnyRecord } | null | undefined;

    const storage = () => {
        if (folder !== undefined) return folder;
        const files = options.files();
        const constants = files && typeof files.getConstants === "function" ? files.getConstants() : files;
        const cache = constants?.CacheDirPath;
        const documents = constants?.DocumentsDirPath;
        if (!files || typeof files.writeFile !== "function" || typeof files.fileExists !== "function") folder = null;
        else if (typeof cache === "string" && cache) folder = { dir: "cache", path: cache, files };
        else if (typeof documents === "string" && documents) folder = { dir: "documents", path: documents, files };
        else folder = null;
        if (!folder) options.log("no app folder for decrypted attachments, encrypted files stay closed");
        return folder;
    };

    const fileUrl = (name: string) => {
        const place = storage();
        return place ? `file://${encodeURI(`${place.path}/${name}`)}` : null;
    };

    const pump = () => {
        while (running < PARALLEL && queued.size) {
            const [id, job] = queued.entries().next().value as [string, () => Promise<void>];
            queued.delete(id);
            running++;
            job().finally(() => {
                running--;
                pump();
            });
        }
    };

    const open = (message: RawMessage, attachmentId: string, source: string, meta: FileMeta, name: string) => async () => {
        const place = storage();
        if (!place) return;
        const path = `${place.path}/${name}`;
        try {
            if (!(await place.files.fileExists(path))) {
                const response = await (options.fetch ?? fetch)(source);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const bytes = join(await decryptFile(await response.arrayBuffer(), meta.key, meta.iv));
                await place.files.writeFile(place.dir, name, bytesToBase64(bytes), "base64");
            }
            ready.add(attachmentId);
            const copy = JSON.parse(JSON.stringify(message)) as RawMessage;
            const url = fileUrl(name);
            for (const attachment of copy.attachments ?? []) if (attachment.id === attachmentId && url) Object.assign(attachment, { url, proxy_url: url });
            options.redraw(copy);
        } catch (error) {
            failed.add(attachmentId);
            options.log(`couldn't open encrypted attachment ${attachmentId}: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    const decrypted = (message: RawMessage, attachment: RawAttachment, meta: FileMeta): RawAttachment => {
        if (typeof attachment.url !== "string" || meta.size > MAX_DECRYPTED_FILE) return attachment;
        const source = ciphertextUrl(attachment.url, message.channel_id, meta.name, options.origin);
        if (!source) return attachment;
        const id = String(attachment.id);
        const name = localName(id, meta.filename);
        const url = fileUrl(name);
        if (!url) return attachment;
        if (!ready.has(id) && !failed.has(id) && !queued.has(id)) {
            queued.set(id, open(message, id, source, meta, name));
            pump();
        }
        const shown = ready.has(id) ? url : `${url}?pending=1`;
        const spoiler = meta.spoiler && !meta.filename.startsWith("SPOILER_");
        const result: Record<string, unknown> = {
            ...attachment,
            filename: spoiler ? `SPOILER_${meta.filename}` : meta.filename,
            content_type: meta.content_type,
            size: meta.size,
            url: shown,
            proxy_url: shown,
            width: meta.width,
            height: meta.height,
            flags: meta.spoiler ? (attachment.flags ?? 0) | SPOILER_FLAG : attachment.flags,
        };
        for (const field of ["duration_secs", "waveform", "description"] as const) if (meta[field] !== undefined) result[field] = meta[field];
        for (const field of ["placeholder", "placeholder_version"]) delete result[field];
        return result as RawAttachment;
    };

    const apply = (message: RawMessage, payload: Payload) => {
        message.content = payload.content;
        const metas = payload.attachments ?? [];
        if (metas.length && Array.isArray(message.attachments))
            message.attachments = message.attachments.map((attachment) => {
                const meta = metas.find((m) => m.name === attachment.filename);
                return meta ? decrypted(message, attachment, meta) : attachment;
            });
        if (payload.stickers?.length) message.sticker_items = payload.stickers.map(({ id, name, format_type }) => ({ id, name, format_type }));
    };

    // sending files in encrypted conversations needs an upload path that encrypts first; the app refuses them for now
    const refuse = () => {
        throw new Error("Files can't be encrypted in the app yet");
    };

    return {
        start: () => {},
        ready: () => Promise.resolve(false),
        prepareCreate: refuse,
        isUpload: () => false,
        prepareUpload: refuse,
        uploaded: () => {},
        metaFor: () => null,
        sent: () => {},
        apply,
        nameOf: () => undefined,
    } as unknown as Attachments;
};
