import definePlugin from "@utils/types";

import { FosscordAuthor } from "../fosscordCore/shared";
import { addLinuxDesktopAudio } from "../fosscordDesktop/linuxAudio";

type GetDisplayMedia = MediaDevices["getDisplayMedia"];

let restore: (() => void) | null = null;

export default definePlugin({
    name: "FosscordLinuxAudio",
    description: "Adds desktop audio to screenshares on Linux, through the desktop app's PipeWire virtual microphone.",
    authors: [FosscordAuthor],
    required: true,

    start() {
        const devices = navigator.mediaDevices;
        const bridge = (window as unknown as { DiscordOSS?: { linuxAudio?: unknown } }).DiscordOSS?.linuxAudio;
        if (!devices?.getDisplayMedia || !bridge) return;
        const previous: GetDisplayMedia = devices.getDisplayMedia;
        const wrapped: GetDisplayMedia = async (...args: Parameters<GetDisplayMedia>) => {
            const stream = await previous.apply(devices, args);
            if (args[0]?.audio) {
                try {
                    await addLinuxDesktopAudio(stream);
                } catch {}
            }
            return stream;
        };
        devices.getDisplayMedia = wrapped;
        restore = () => {
            if (devices.getDisplayMedia === wrapped) devices.getDisplayMedia = previous;
        };
    },

    stop() {
        restore?.();
        restore = null;
    },
});
