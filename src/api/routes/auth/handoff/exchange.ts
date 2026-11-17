import crypto from "node:crypto";
import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { ResponseError, readTicket } from "@spacebar/api/util";
import { User } from "@spacebar/database";
import { generateToken } from "@spacebar/util";
import { keyHash, validKey } from "./index";

const router = Router({ mergeParams: true });

// tickets already traded, until they expire; a ticket gives one session
const used = new Map<string, number>();
const invalid = () => new ResponseError(400, { message: "Invalid handoff token", code: 50035 });

router.post("/", route({ authentication: "never", responses: { 200: {} } }), async (req: Request, res: Response) => {
    const { key, handoff_token } = req.body as { key?: unknown; handoff_token?: unknown };
    if (!validKey(key)) throw invalid();
    const ticket = readTicket<{ typ: string; uid?: string; kh?: string; exp?: number }>(handoff_token, "handoff");
    if (!ticket?.uid || typeof ticket.kh !== "string" || typeof handoff_token !== "string") throw invalid();
    const expected = Buffer.from(keyHash(key));
    const actual = Buffer.from(ticket.kh);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) throw invalid();

    const now = Date.now();
    for (const [token, expires] of used) if (expires < now) used.delete(token);
    if (used.has(handoff_token)) throw invalid();
    used.set(handoff_token, (ticket.exp ?? 0) * 1000);

    const user = await User.findOne({ where: { id: ticket.uid }, select: { id: true, disabled: true, deleted: true } });
    if (!user || user.disabled || user.deleted) throw invalid();
    res.json({ token: await generateToken(user.id) });
});

export default router;
