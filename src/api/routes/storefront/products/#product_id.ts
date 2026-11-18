import { route } from "@spacebar/api/middlewares";
import { storefrontProductsBySku } from "@spacebar/api/util";
import { DiscordApiErrors } from "@spacebar/util";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

// a catalog product's storefront id is its SKU id
router.get("/", route({}), async (req: Request, res: Response) => {
    const [product] = await storefrontProductsBySku([req.params.product_id as string]);
    if (!product) throw DiscordApiErrors.UNKNOWN_SKU;
    res.json(product);
});

export default router;
