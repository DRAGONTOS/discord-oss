import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { ReadState } from "@spacebar/database";
import { AckBulkSchema } from "@spacebar/schemas";
import { emitEvent, MessageAckEvent, Snowflake } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        requestBody: "AckBulkSchema",
        responses: {
            204: {},
            400: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as AckBulkSchema;

        // TODO: what is read_state_type ?

        if (body.read_states.length) {
            await ReadState.createQueryBuilder()
                .insert()
                .values(
                    body.read_states.map((x) => ({
                        id: Snowflake.generate(),
                        user_id: req.user_id,
                        channel_id: x.channel_id,
                        last_message_id: x.message_id,
                        mention_count: 0,
                    })),
                )
                .orUpdate(["last_message_id", "mention_count"], ["user_id", "channel_id"])
                .execute();
        }
        await Promise.all(
            body.read_states.map((x) =>
                emitEvent({
                    event: "MESSAGE_ACK",
                    user_id: req.user_id,
                    data: { channel_id: x.channel_id, message_id: x.message_id, version: Date.now() },
                } satisfies MessageAckEvent),
            ),
        );

        return res.sendStatus(204);
    },
);

export default router;
