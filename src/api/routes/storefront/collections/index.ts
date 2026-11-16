import { route } from "@spacebar/api/middlewares";
import { storefrontCategories, storefrontCollection } from "@spacebar/api/util";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

const list = (value: unknown) => (Array.isArray(value) ? value : value === undefined ? [] : [value]).map(String);

// the collections the client asks for by id, such as the one a collection page shows
router.get("/", route({}), async (req: Request, res: Response) => {
    const wanted = new Set(list(req.query.collection_ids));
    const categories = await storefrontCategories();
    res.json({ collections: categories.filter((category) => wanted.has(category.sku_id)).map((category) => storefrontCollection(category)) });
});

export default router;
