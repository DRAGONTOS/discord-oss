import fs from "node:fs";
import path from "node:path";
import { User_DisplayNameFont } from "discord-protos";

// The instance's own display name fonts live in the client plugin's fonts.json, which the plugin builds its font list from too, so both always agree.
const REGISTRY_PATH = path.join(__dirname, "..", "..", "..", "client", "plugins", "fosscordDisplayNameFonts", "fonts.json");

let cached: Set<number> | undefined;

function instanceFontIds() {
    if (cached) return cached;
    try {
        const fonts = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8")) as { id: number }[];
        cached = new Set(fonts.map((font) => font.id).filter((id) => Number.isInteger(id)));
    } catch (error) {
        console.warn(`[display name fonts] could not read ${REGISTRY_PATH}, only Discord's own fonts are accepted:`, (error as Error).message);
        cached = new Set();
    }
    return cached;
}

const discordFontIds = new Set(Object.values(User_DisplayNameFont).filter((value): value is number => typeof value === "number"));

/** Whether `id` is one of Discord's display name fonts or one listed in the instance's fonts.json. */
export function isValidDisplayNameFontId(id: number) {
    return discordFontIds.has(id) || instanceFontIds().has(id);
}
