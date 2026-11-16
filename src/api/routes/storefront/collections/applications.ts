import { route } from "@spacebar/api/middlewares";
import { COLLECTIBLES_APPLICATION_ID, storefrontCategories, storefrontCollection } from "@spacebar/api/util";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

const number = (value: unknown) => (typeof value === "string" && /^\d+$/.test(value) ? Number(value) : undefined);

// the Shop's Browse tab pages through these with offset and limit; anchor_collection_id asks for the ones after a
// collection, and no paging returns every collection
router.get("/", route({}), async (req: Request, res: Response) => {
    if (req.query.application_id !== undefined && req.query.application_id !== COLLECTIBLES_APPLICATION_ID) return res.json({ collections: [], total: 0 });
    const categories = await storefrontCategories();
    const includeProducts = req.query.include_products !== "false";
    let start = Math.max(0, number(req.query.offset) ?? 0);
    if (typeof req.query.anchor_collection_id === "string") {
        const anchor = categories.findIndex((category) => category.sku_id === req.query.anchor_collection_id);
        start = anchor < 0 ? categories.length : anchor + 1;
    }
    const limit = number(req.query.limit);
    const page = categories.slice(start, limit === undefined ? undefined : start + Math.min(limit, 100));
    res.json({ collections: page.map((category) => storefrontCollection(category, includeProducts)), total: categories.length });
});

export default router;
