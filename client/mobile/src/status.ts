type AnyRecord = Record<PropertyKey, any>;

// Discord OSS adds a "testing" status (client/plugins/fosscordTestingStatus): a blue dot that mutes notifications like
// Do Not Disturb. Discord's mobile apps only draw online, idle, dnd, streaming and offline and show nothing for any
// other status, so the bundle shows a testing user as Do Not Disturb, the status it behaves like.
const TESTING = "testing";
const PATCHED = Symbol.for("discordOss.testingStatus");

export const displayStatus = (status: unknown) => (status === TESTING ? "dnd" : status);

const isPresenceStore = (value: unknown): value is AnyRecord => {
    if (!value || typeof value !== "object") return false;
    const proto = Object.getPrototypeOf(value);
    if (!proto || proto === Object.prototype) return false;
    // own methods of the store's class; lazy module proxies answer every property name and must not match
    return Object.prototype.hasOwnProperty.call(proto, "getStatus") && Object.prototype.hasOwnProperty.call(proto, "isMobileOnline") && typeof proto.getStatus === "function";
};

// Wraps getStatus on the presence store's class, which every avatar, member list row and profile reads. Returns true
// when this call patched it.
export const patchPresenceStore = (exports: unknown): boolean => {
    for (const candidate of [exports, (exports as AnyRecord | null)?.default]) {
        if (!isPresenceStore(candidate)) continue;
        const proto = Object.getPrototypeOf(candidate);
        if (proto.getStatus[PATCHED]) return false;
        const original = proto.getStatus;
        const getStatus = function (this: unknown, ...args: unknown[]) {
            return displayStatus(original.apply(this, args));
        };
        Object.defineProperty(getStatus, PATCHED, { value: true });
        proto.getStatus = getStatus;
        return true;
    }
    return false;
};
