import { route } from "@spacebar/api/middlewares";
import { storefrontProductsBySku } from "@spacebar/api/util";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

const list = (value: unknown) =>
    [value]
        .flat()
        .flatMap((x) => (typeof x === "string" ? x.split(",") : []))
        .filter(Boolean);

// the Shop's search and paged browse tabs look up the products for the SKUs they were given
router.get("/", route({}), async (req: Request, res: Response) => {
    res.json({ products: await storefrontProductsBySku(list(req.query.sku_ids)) });
});

export default router;
