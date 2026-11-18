import fs from "node:fs";
import path from "node:path";
import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { AdminFontUpdateSchema } from "@spacebar/schemas";
import { FONT_FILES_PATH, InstanceFont, instanceFonts, writeInstanceFonts } from "@spacebar/util";
import { fontHolders, serializeFont } from "../index";

const router = Router({ mergeParams: true });

router.patch(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        requestBody: "AdminFontUpdateSchema",
        description: "Change a display name font's label or its weight, stretch and style declarations",
    }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminFontUpdateSchema;
        const fonts = instanceFonts();
        const index = fonts.findIndex((font) => font.id === Number(req.params.font_id));
        if (index === -1) throw new HTTPError("Unknown font", 404);
        const updated: InstanceFont = { ...fonts[index] };
        if (body.name !== undefined) updated.name = body.name.trim();
        for (const key of ["weight", "stretch", "style"] as const) {
            const value = body[key];
            if (value === undefined) continue;
            if (value === null || !value.trim()) delete updated[key];
            else updated[key] = value.trim();
        }
        writeInstanceFonts(fonts.map((font, i) => (i === index ? updated : font)));
        const holders = await fontHolders();
        res.json(serializeFont(updated, holders.get(String(updated.id)) ?? 0));
    },
);

router.delete(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        description: "Remove a display name font that no profile uses anymore",
    }),
    async (req: Request, res: Response) => {
        const id = Number(req.params.font_id);
        const fonts = instanceFonts();
        const font = fonts.find((font) => font.id === id);
        if (!font) throw new HTTPError("Unknown font", 404);
        const holders = (await fontHolders()).get(String(id)) ?? 0;
        if (holders) throw new HTTPError(`${holders} ${holders === 1 ? "profile" : "profiles"} still use this font. Change their font first.`, 400);
        writeInstanceFonts(fonts.filter((each) => each.id !== id));
        fs.rmSync(path.join(FONT_FILES_PATH, font.file), { force: true });
        res.status(204).end();
    },
);

export default router;
