import crypto from "node:crypto";
import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { ResponseError, signTicket } from "@spacebar/api/util";

// Discord's desktop handoff: a desktop app opens /handoff?rpc=<port>&key=<key> in the browser, the
// signed-in web client posts the key here and hands the ticket to the app over its loopback port,
// and the app trades ticket and key for a session at /auth/handoff/exchange. The ticket only
// works with the key it was made for, for two minutes and once.

export const HANDOFF_TTL_SECONDS = 120;
export const keyHash = (key: string) => crypto.createHash("sha256").update(key).digest("base64url");
export const validKey = (key: unknown): key is string => typeof key === "string" && key.length >= 16 && key.length <= 128 && /^[\w-]+$/.test(key);

const router = Router({ mergeParams: true });

router.post("/", route({ responses: { 200: {} } }), async (req: Request, res: Response) => {
    const { key } = req.body as { key?: unknown };
    if (!validKey(key)) throw new ResponseError(400, { message: "Invalid handoff key", code: 50035 });
    res.json({ handoff_token: signTicket({ typ: "handoff", uid: req.user_id, kh: keyHash(key) }, HANDOFF_TTL_SECONDS) });
});

export default router;
