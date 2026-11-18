import fs from "node:fs";
import path from "node:path";
import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { Member, User } from "@spacebar/database";
import { AdminFontCreateSchema } from "@spacebar/schemas";
import { FONT_FILES_PATH, InstanceFont, instanceFonts, nextInstanceFontId, uniqueFontKey, validateInstanceFonts, writeInstanceFonts } from "@spacebar/util";

const router = Router({ mergeParams: true });

const MAX_FONT_BYTES = 6 * 1024 * 1024;
const MIME_FORMATS: Record<string, string> = {
    "font/ttf": "truetype",
    "font/sfnt": "truetype",
    "font/collection": "truetype",
    "application/x-font-ttf": "truetype",
    "font/otf": "opentype",
    "application/x-font-otf": "opentype",
    "font/woff": "woff",
    "application/font-woff": "woff",
    "font/woff2": "woff2",
};
const EXTENSION_FORMATS: Record<string, string> = { ttf: "truetype", otf: "opentype", woff: "woff", woff2: "woff2" };
const FORMAT_EXTENSIONS: Record<string, string> = { truetype: "ttf", opentype: "otf", woff: "woff", woff2: "woff2" };

export const serializeFont = (font: InstanceFont, holders: number) => ({ ...font, holders });

export const fontHolders = async () => {
    const holders = new Map<string, number>();
    const rows = [
        ...(await User.query(`SELECT display_name_styles->>'font_id' AS font_id, COUNT(*) AS holders FROM users WHERE display_name_styles IS NOT NULL GROUP BY 1`)),
        ...(await Member.query(`SELECT display_name_styles->>'font_id' AS font_id, COUNT(*) AS holders FROM members WHERE display_name_styles IS NOT NULL GROUP BY 1`)),
    ] as { font_id: string; holders: string }[];
    for (const row of rows) holders.set(row.font_id, (holders.get(row.font_id) ?? 0) + Number(row.holders));
    return holders;
};

const parseFontData = (data: string) => {
    const comma = data.indexOf(",");
    if (!data.startsWith("data:") || comma === -1) throw new HTTPError("font_data must be a data: URI", 400);
    const header = data.slice(5, comma).split(";");
    if (!header.includes("base64")) throw new HTTPError("font_data must be base64 encoded", 400);
    const buffer = Buffer.from(data.slice(comma + 1), "base64");
    if (!buffer.length) throw new HTTPError("font_data is empty", 400);
    if (buffer.length > MAX_FONT_BYTES) throw new HTTPError(`Fonts have to be under ${Math.round(MAX_FONT_BYTES / 1048576)} MB`, 400);
    return { mime: header[0] || "application/octet-stream", buffer };
};

const fontFormat = (mime: string, fileName: string | undefined) => {
    if (MIME_FORMATS[mime]) return MIME_FORMATS[mime];
    const extension = (fileName ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
    const format = extension ? EXTENSION_FORMATS[extension] : undefined;
    if (format) return format;
    throw new HTTPError("Fonts have to be TTF, OTF, WOFF or WOFF2", 400);
};

const fontFileName = (format: string, name: string, uploadName: string | undefined) => {
    const source = (uploadName?.replace(/\.[^.]*$/, "") || name).replace(/[^\w.-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "");
    return `${source || "font"}.${FORMAT_EXTENSIONS[format] ?? "ttf"}`;
};

router.get(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        description: "List the instance's own display name fonts with how many profiles use each",
    }),
    async (req: Request, res: Response) => {
        const holders = await fontHolders();
        res.json(instanceFonts().map((font) => serializeFont(font, holders.get(String(font.id)) ?? 0)));
    },
);

router.post(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        requestBody: "AdminFontCreateSchema",
        description: "Upload a display name font and add it to the instance's font list",
    }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminFontCreateSchema;
        const name = body.name.trim();
        if (!name) throw new HTTPError("A font needs a name", 400);
        const fonts = instanceFonts();
        const { mime, buffer } = parseFontData(body.font_data);
        const format = fontFormat(mime, body.file_name);
        const file = fontFileName(format, name, body.file_name);
        const registered = fonts.find((font) => font.file === file);
        if (registered)
            throw new HTTPError(
                `${file} is already the file of the font "${registered.name}" (#${registered.id}). Remove that font first, or upload this one with a different file name.`,
                400,
            );
        if (fs.existsSync(path.join(FONT_FILES_PATH, file)))
            throw new HTTPError(`assets/public/fonts already has a file named ${file} that no font lists. Upload the font with a different file name.`, 400);
        const font: InstanceFont = {
            id: nextInstanceFontId(fonts),
            key: uniqueFontKey(fonts, name),
            name,
            family: name,
            file,
            format,
        };
        if (body.weight?.trim()) font.weight = body.weight.trim();
        if (body.stretch?.trim()) font.stretch = body.stretch.trim();
        if (body.style?.trim()) font.style = body.style.trim();
        validateInstanceFonts([...fonts, font]);
        fs.mkdirSync(FONT_FILES_PATH, { recursive: true });
        const fontPath = path.join(FONT_FILES_PATH, file);
        fs.writeFileSync(fontPath, buffer);
        try {
            writeInstanceFonts([...fonts, font]);
        } catch (error) {
            fs.rmSync(fontPath, { force: true });
            throw error;
        }
        res.status(201).json(serializeFont(font, 0));
    },
);

export default router;
