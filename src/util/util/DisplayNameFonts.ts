import fs from "node:fs";
import path from "node:path";
import { User_DisplayNameFont } from "discord-protos";

// The instance's own display name fonts live in the client plugin's fonts.json, which the plugin builds its font list from too, so both always agree. See docs/features/display-name-fonts.md.
export const FONT_REGISTRY_PATH = path.join(__dirname, "..", "..", "..", "client", "plugins", "fosscordDisplayNameFonts", "fonts.json");
export const FONT_FILES_PATH = path.join(__dirname, "..", "..", "..", "assets", "public", "fonts");

export interface InstanceFont {
    /** Must be unique and 100 or higher; Discord's own fonts use 0 to 17. */
    id: number;
    /** Name of the entry in the client's font enum, upper case letters, digits and underscores. */
    key: string;
    /** Label shown in the font picker. */
    name: string;
    /** CSS font-family name used in the generated @font-face. */
    family: string;
    /** File name inside assets/public/fonts. */
    file: string;
    format: string;
    /** Optional @font-face descriptors, e.g. "200 900" for a variable font. */
    weight?: string;
    stretch?: string;
    /** CSS declarations applied to the display name. */
    style?: string;
}

const SAFE = /^[\w .-]+$/;
const SAFE_DESCRIPTOR = /^[\w .%,-]+$/;
const KEY = /^[A-Z][A-Z0-9_]*$/;
const FORMATS = new Set(["truetype", "opentype", "woff", "woff2"]);

let cached: Set<number> | undefined;

function instanceFontIds() {
    if (cached) return cached;
    try {
        const fonts = JSON.parse(fs.readFileSync(FONT_REGISTRY_PATH, "utf8")) as { id: number }[];
        cached = new Set(fonts.map((font) => font.id).filter((id) => Number.isInteger(id)));
    } catch (error) {
        console.warn(`[display name fonts] could not read ${FONT_REGISTRY_PATH}, only Discord's own fonts are accepted:`, (error as Error).message);
        cached = new Set();
    }
    return cached;
}

const discordFontIds = new Set(Object.values(User_DisplayNameFont).filter((value): value is number => typeof value === "number"));

/** Whether `id` is one of Discord's display name fonts or one listed in the instance's fonts.json. */
export function isValidDisplayNameFontId(id: number) {
    return discordFontIds.has(id) || instanceFontIds().has(id);
}

export function validateInstanceFonts(fonts: InstanceFont[]) {
    const seen = new Set<number>();
    for (const font of fonts) {
        if (!Number.isInteger(font.id) || font.id < 100) throw new Error(`Display name font id ${font.id} must be an integer of 100 or higher`);
        if (seen.has(font.id)) throw new Error(`Display name font id ${font.id} is listed twice`);
        seen.add(font.id);
        if (!KEY.test(font.key)) throw new Error(`Display name font ${font.id} has an invalid key`);
        for (const value of [font.name, font.family, font.file, font.format])
            if (!SAFE.test(value ?? "")) throw new Error(`Display name font ${font.id} has an invalid name, family, file or format`);
        if (!FORMATS.has(font.format)) throw new Error(`Display name font ${font.id} has an invalid format`);
        for (const value of [font.weight, font.stretch])
            if (value && !SAFE_DESCRIPTOR.test(value)) throw new Error(`Display name font ${font.id} has an invalid weight or stretch`);
        if (/[{}<>]/.test(font.style ?? "")) throw new Error(`Display name font ${font.id} has an invalid style`);
    }
    return fonts;
}

export function instanceFonts(registryPath: string = FONT_REGISTRY_PATH) {
    return validateInstanceFonts(JSON.parse(fs.readFileSync(registryPath, "utf8")) as InstanceFont[]);
}

export function writeInstanceFonts(fonts: InstanceFont[], registryPath: string = FONT_REGISTRY_PATH) {
    validateInstanceFonts(fonts);
    const temporary = `${registryPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(fonts, null, 4)}\n`);
    fs.renameSync(temporary, registryPath);
    cached = undefined;
}

export function nextInstanceFontId(fonts: InstanceFont[]) {
    return fonts.length ? Math.max(...fonts.map((font) => font.id)) + 1 : 100;
}

export function uniqueFontKey(fonts: InstanceFont[], name: string) {
    let base = name
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    if (!/^[A-Z]/.test(base)) base = `F${base}`;
    if (!base) base = "FONT";
    const keys = new Set(fonts.map((font) => font.key));
    let key = base;
    for (let n = 2; keys.has(key); n++) key = `${base}_${n}`;
    return key;
}
