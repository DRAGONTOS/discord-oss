// Linux desktop audio for screenshares. Chromium cannot capture system audio on Linux,
// so the desktop app routes it into a PipeWire virtual microphone ("vencord-screen-share")
// and this adds that microphone's track to the stream getDisplayMedia returned.
const DEVICE = "vencord-screen-share";

interface LinuxAudioBridge {
    start(): Promise<boolean>;
    stop(): void;
}

const bridge = (): LinuxAudioBridge | undefined => (window as unknown as { DiscordOSS?: { linuxAudio?: LinuxAudioBridge } }).DiscordOSS?.linuxAudio;

async function findDevice(): Promise<MediaDeviceInfo | undefined> {
    for (let attempt = 0; attempt < 15; attempt++) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const found = devices.find((device) => device.kind === "audioinput" && device.label === DEVICE);
        if (found) return found;
        if (attempt === 0 && devices.every((device) => !device.label)) {
            // labels stay hidden until the page has had a successful getUserMedia
            try {
                (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((track) => track.stop());
            } catch {
                return undefined;
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return undefined;
}

export async function addLinuxDesktopAudio(stream: MediaStream): Promise<void> {
    const native = bridge();
    if (!native || stream.getAudioTracks().length) return;
    if (!(await native.start().catch(() => false))) return;

    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        native.stop();
    };
    try {
        const device = await findDevice();
        if (!device) return release();
        const capture = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: device.deviceId }, autoGainControl: false, echoCancellation: false, noiseSuppression: false, channelCount: 2, sampleRate: 48000 },
        });
        const [track] = capture.getAudioTracks();
        if (!track) return release();
        stream.addTrack(track);

        const stopAudio = track.stop.bind(track);
        track.stop = () => {
            stopAudio();
            release();
        };
        track.addEventListener("ended", release, { once: true });

        const video = stream.getVideoTracks()[0];
        if (video) {
            const stopVideo = video.stop.bind(video);
            video.stop = () => {
                stopVideo();
                track.stop();
            };
            video.addEventListener("ended", () => track.stop(), { once: true });
        }
    } catch {
        release();
    }
}
