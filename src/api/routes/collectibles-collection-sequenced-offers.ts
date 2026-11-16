import { route } from "@spacebar/api/middlewares";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

// Discord's timed offers for a collection; everything here is free, so there are none
router.get("/", route({}), (req: Request, res: Response) => {
    res.json({ collection_id: null, starts_at: null, ends_at: null, promotions: [] });
});

export default router;
