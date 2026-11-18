import definePlugin from "@utils/types";
import type { Activity } from "@vencord/discord-types";
import { ApplicationAssetUtils, FluxDispatcher, RestAPI } from "@webpack/common";

import { FosscordAuthor } from "../fosscordCore/shared";

interface RpcActivity extends Omit<Activity, "assets"> {
    application_id: string;
    assets?: { large_image?: string; large_text?: string; small_image?: string; small_text?: string };
}

interface RpcMessage {
    activity: RpcActivity | null;
    pid?: number;
    socketId: string;
}

interface RpcBridge {
    watch(): void;
    onActivity(listener: (message: RpcMessage) => void): () => void;
}

// Each arRPC connection gets its own socket id, so several apps can show at once
// and none of them touches FosscordMusicPresence's own activity.
const SOCKET_PREFIX = "FosscordRpc:";
// Image keys that Discord already understands as-is.
const PASSTHROUGH = /^(mp|spotify|youtube|twitch):/;

const assetCache = new Map<string, string>();
const appNames = new Map<string, string>();
const latest = new Map<string, number>();
const active = new Set<string>();
let unsubscribe: (() => void) | null = null;
let sequence = 0;

const bridge = (): RpcBridge | undefined => (window as unknown as { Librecord?: { rpc?: RpcBridge } }).Librecord?.rpc;

async function resolveImage(applicationId: string | undefined, image: string | undefined): Promise<string | undefined> {
    if (!image || !applicationId || PASSTHROUGH.test(image)) return image;
    const key = `${applicationId}:${image}`;
    const cached = assetCache.get(key);
    if (cached) return cached;
    const [asset] = await ApplicationAssetUtils.fetchAssetIds(applicationId, [image]).catch(() => [] as string[]);
    if (asset) assetCache.set(key, asset);
    return asset || undefined;
}

async function appName(applicationId: string | undefined): Promise<string | undefined> {
    if (!applicationId) return undefined;
    const cached = appNames.get(applicationId);
    if (cached) return cached;
    try {
        const { body } = await RestAPI.get({ url: `/applications/${applicationId}/rpc` });
        const name = (body as { name?: string } | undefined)?.name;
        if (name) appNames.set(applicationId, name);
        return name;
    } catch {
        return undefined;
    }
}

function dispatch(socketId: string, activity: unknown, pid?: number): void {
    FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity, pid, socketId });
}

async function handle({ activity, pid, socketId }: RpcMessage): Promise<void> {
    const id = `${SOCKET_PREFIX}${socketId}`;
    const mine = ++sequence;
    latest.set(id, mine);

    if (!activity) {
        active.delete(id);
        dispatch(id, null, pid);
        return;
    }

    const applicationId = activity.application_id;
    const [large, small, name] = await Promise.all([
        resolveImage(applicationId, activity.assets?.large_image),
        resolveImage(applicationId, activity.assets?.small_image),
        activity.name ? Promise.resolve(activity.name) : appName(applicationId),
    ]);
    // a newer update (or a clear) for this connection arrived while images were resolving
    if (latest.get(id) !== mine) return;

    active.add(id);
    dispatch(
        id,
        {
            ...activity,
            name: name || "Rich Presence",
            assets: activity.assets && { ...activity.assets, large_image: large, small_image: small },
        },
        pid,
    );
}

export default definePlugin({
    name: "FosscordRpc",
    description: "Shows Rich Presence from apps on your computer (games, music players, scripts) as your activity, through the desktop app's built-in RPC server.",
    authors: [FosscordAuthor],
    required: true,

    start() {
        const rpc = bridge();
        if (!rpc) return;
        unsubscribe = rpc.onActivity((message) => void handle(message));
        rpc.watch();
    },

    stop() {
        unsubscribe?.();
        unsubscribe = null;
        for (const id of active) dispatch(id, null);
        active.clear();
        latest.clear();
    },
});
