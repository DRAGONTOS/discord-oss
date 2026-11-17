import { Router, Response, Request } from "express";
import { storage, setCacheControl, setCacheControlNotFound, fetchUpstreamAsset, sendAsset } from "../../util";

// Nameplate art, at the path clients build from a nameplate's asset: /assets/collectibles/<asset>static.png
// and <asset>asset.webm. The admin panel's nameplates (asset nameplates/custom/<sku>/) come from the store's
// uploads, everything else from Discord's CDN, cached like the other collectible art.

const router = Router({ mergeParams: true });

const CUSTOM_SLOTS: Record<string, string> = { "static.png": "static", "asset.webm": "video" };

router.get("/*path", setCacheControl, async (req: Request, res: Response) => {
    const segments = [req.params.path].flat() as string[];
    if (segments.length < 2 || segments.length > 5 || !segments.every((x) => /^[a-z0-9_.-]{1,64}$/i.test(x) && !/^\.+$/.test(x))) return setCacheControlNotFound(req, res);
    const asset = segments.join("/");

    const custom = /^nameplates\/custom\/(\d{1,20})\/([a-z.]+)$/.exec(asset);
    if (custom) {
        const slot = CUSTOM_SLOTS[custom[2]];
        const file = slot ? await storage.get(`collectibles-shop/${custom[1]}/${slot}`) : null;
        if (!file) return setCacheControlNotFound(req, res);
        return sendAsset(res, file, custom[2]);
    }

    const file = await fetchUpstreamAsset(`collectibles-assets-upstream/${asset}`, `https://cdn.discordapp.com/assets/collectibles/${asset}`);
    if (!file) return setCacheControlNotFound(req, res);
    return sendAsset(res, file, asset);
});

export default router;
