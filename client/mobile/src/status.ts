type AnyRecord = Record<PropertyKey, any>;
type Component = (props: AnyRecord, ...rest: unknown[]) => unknown;

// Discord OSS adds a "testing" status (client/plugins/fosscordTestingStatus): a blue dot that mutes notifications like
// Do Not Disturb. Discord's mobile apps draw a status with the `Status` component, which picks a coloured icon image
// per status (online, idle, dnd, streaming, offline) and draws nothing it doesn't know. For "testing" the bundle draws
// the online icon, which also takes the phone and headset shapes, tinted the plugin's blue, and names it "Testing".
export const TESTING = "testing";
export const TESTING_COLOR = "#3ba3e8";
export const TESTING_LABEL = "Testing";
const PATCHED = Symbol.for("discordOss.testingStatus");

const isElement = (value: unknown): value is AnyRecord => !!value && typeof value === "object" && "props" in value && "type" in value;

// Adds tintColor to every image in the tree the Status component returned; the status icons are its only images.
export const tintImages = (node: unknown, color: string): unknown => {
    if (Array.isArray(node)) return node.map((child) => tintImages(child, color));
    if (!isElement(node)) return node;
    const props = node.props as AnyRecord;
    const next: AnyRecord = { ...props };
    if (props.source !== undefined) next.style = [props.style, { tintColor: color }];
    if (props.children !== undefined) next.children = tintImages(props.children, color);
    return { ...node, props: next };
};

const mark = <T extends object>(value: T) => {
    Object.defineProperty(value, PATCHED, { value: true });
    return value;
};

const wrapStatus = (Status: Component) =>
    mark(function Status_discordOss(this: unknown, props: AnyRecord, ...rest: unknown[]) {
        if (props?.status !== TESTING) return Status.call(this, props, ...rest);
        return tintImages(Status.call(this, { ...props, status: "online" }, ...rest), TESTING_COLOR);
    });

const wrapLabel = (label: (...args: unknown[]) => unknown) =>
    mark(function (this: unknown, ...args: unknown[]) {
        return args[0] === TESTING ? TESTING_LABEL : label.apply(this, args);
    });

// Returns replacement exports for the modules that draw or name a status, or null for any other module. Hermes keeps
// function names, so the modules are found by them.
export const patchStatusExports = (exports: unknown): AnyRecord | null => {
    if (!exports || typeof exports !== "object") return null;
    const source = exports as AnyRecord;
    const replaced: AnyRecord = {};
    const status = source.default;
    if (typeof status === "function" && status.name === "Status" && !status[PATCHED]) replaced.default = wrapStatus(status);
    for (const name of ["getStatusLabel", "humanizeStatus"])
        if (typeof source[name] === "function" && source[name].name === name && !source[name][PATCHED]) replaced[name] = wrapLabel(source[name]);
    return Object.keys(replaced).length ? replaced : null;
};
