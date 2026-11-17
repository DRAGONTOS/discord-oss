// Pure helpers for the instance's own display name fonts. Everything is generated from fonts.json, so adding a font never means touching this file.
// The server reads the same fonts.json (src/util/util/DisplayNameFonts.ts) to decide which ids it accepts. See docs/features/display-name-fonts.md.

export interface InstanceFont {
    /** Must be unique and 100 or higher; Discord's own fonts use 0 to 17. */
    id: number;
    /** Name of the entry in the client's font enum, upper case letters, digits and underscores. */
    key: string;
    /** Label shown in the font picker. */
    name: string;
    /** CSS font-family name used in the @font-face rule. */
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

export const fontClass = (font: InstanceFont) => `fosscordFont${font.id}`;

const SAFE = /^[\w .-]+$/;

export function validateFonts(fonts: InstanceFont[]) {
    const seen = new Set<number>();
    for (const font of fonts) {
        if (!Number.isInteger(font.id) || font.id < 100) throw new Error(`Display name font id ${font.id} must be an integer of 100 or higher`);
        if (seen.has(font.id)) throw new Error(`Display name font id ${font.id} is listed twice`);
        seen.add(font.id);
        if (!/^[A-Z][A-Z0-9_]*$/.test(font.key)) throw new Error(`Display name font ${font.id} has an invalid key`);
        for (const value of [font.name, font.family, font.file, font.format])
            if (!SAFE.test(value ?? "")) throw new Error(`Display name font ${font.id} has an invalid name, family, file or format`);
        if (/[{}<>]/.test(font.style ?? "")) throw new Error(`Display name font ${font.id} has an invalid style`);
    }
    return fonts;
}

export function fontCss(fonts: InstanceFont[]) {
    return fonts
        .map((font) => {
            const face = [
                `font-family:"${font.family}"`,
                `src:url("/assets/fonts/${font.file}") format("${font.format}")`,
                font.weight ? `font-weight:${font.weight}` : "",
                font.stretch ? `font-stretch:${font.stretch}` : "",
                "font-display:swap",
            ].filter(Boolean);
            const cls = fontClass(font);
            return `@font-face{${face.join(";")}}\n.${cls}.${cls}{font-family:"${font.family}","gg sans",Arial,sans-serif;${font.style ?? ""}}\n`;
        })
        .join("");
}

// Replacement strings for the three patches that put the fonts into the client's enum, picker list and class map. $1 and $& are String.replace references.
export const enumReplacement = (fonts: InstanceFont[]) => `$&${fonts.map((f) => `$1[$1.${f.key}=${f.id}]="${f.key}",`).join("")}`;
export const listReplacement = (fonts: InstanceFont[]) => `$1,${fonts.map((f) => f.id).join(",")}]`;
export const classMapReplacement = (fonts: InstanceFont[]) => `$1,${fonts.map((f) => `${f.id}:"${fontClass(f)}"`).join(",")}}`;
