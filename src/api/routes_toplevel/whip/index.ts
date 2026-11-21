import { route } from "@spacebar/api/middlewares";
import express, { Router } from "express";

import { whipDelete, whipPatch, whipPost } from "../../util/handlers/Whip";

const router = Router({ mergeParams: true });

router.post("/", express.text({ type: "application/sdp", limit: "2mb" }), route({ authentication: "never", responses: { 201: {}, 400: {}, 404: {} } }), whipPost);
router.patch(
    "/",
    express.text({ type: ["application/trickle-ice-sdpfrag", "application/sdp"], limit: "1mb" }),
    route({ authentication: "never", responses: { 204: {} } }),
    whipPatch,
);
router.delete("/", route({ authentication: "never", responses: { 204: {} } }), whipDelete);

export default router;
