import { route } from "@spacebar/api/middlewares";
import { attachmentChannelIdFromUrl, attachmentRequiresMembership, isGuildAttachmentMember } from "@spacebar/database";
import { getUrlSignature, NewUrlSignatureData, requestSignatureData } from "@spacebar/util";
import { Request, Response, Router } from "express";
import { RefreshUrlsRequestSchema } from "@spacebar/schemas";
const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        requestBody: "RefreshUrlsRequestSchema",
        responses: {
            200: {
                body: "RefreshUrlsResponse",
            },
            400: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { attachment_urls } = req.body as RefreshUrlsRequestSchema;

        const refreshed_urls = await Promise.all(
            attachment_urls.map(async (url) => {
                const guildId = await attachmentRequiresMembership(attachmentChannelIdFromUrl(url) ?? "");
                if (guildId && !(await isGuildAttachmentMember(guildId, req.user_id))) return url;
                return getUrlSignature(
                    new NewUrlSignatureData({
                        url: url,
                        ip: req.ip,
                        userAgent: req.headers["user-agent"] as string,
                    }),
                )
                    .applyToUrl(url)
                    .toString();
            }),
        );

        return res.status(200).json({
            refreshed_urls,
        });
    },
);

export default router;
