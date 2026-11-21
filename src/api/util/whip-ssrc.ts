export function ssrcsOf(sdp: string): { audio?: number; video?: number; rtx?: number } {
    let audio: number | undefined;
    let video: number | undefined;
    let rtx: number | undefined;
    for (const section of sdp.split(/^m=/m).slice(1)) {
        const kind = section.slice(0, section.indexOf(" "));
        const ssrc = Number(section.match(/^a=ssrc:(\d+)/m)?.[1]) || undefined;
        if (kind === "audio") audio ??= ssrc;
        if (kind === "video") {
            video ??= ssrc;
            rtx ??= Number(section.match(/^a=ssrc-group:FID\s+\d+\s+(\d+)/m)?.[1]) || undefined;
        }
    }
    return { audio, video, rtx };
}
