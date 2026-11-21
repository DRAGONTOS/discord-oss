const { test } = require("node:test");
const assert = require("node:assert/strict");

const { ssrcsOf } = require("../../src/api/util/whip-ssrc.ts");

test("parses distinct audio and video SSRCs from an OBS style offer", () => {
    const sdp = [
        "v=0",
        "m=audio 9 UDP/TLS/RTP/SAVPF 111",
        "a=ssrc:312010769 cname:obs",
        "a=ssrc:312010769 msid:stream audio",
        "m=video 9 UDP/TLS/RTP/SAVPF 96 97",
        "a=ssrc:312010770 cname:obs",
        "a=ssrc:312010770 msid:stream video",
        "a=ssrc:312010771 cname:obs",
        "a=ssrc-group:FID 312010770 312010771",
        "",
    ].join("\r\n");
    assert.deepEqual(ssrcsOf(sdp), { audio: 312010769, video: 312010770, rtx: 312010771 });
});

test("falls back when the offer has no audio or FID line", () => {
    const sdp = ["v=0", "m=video 9 UDP/TLS/RTP/SAVPF 96", "a=ssrc:55 cname:obs", ""].join("\r\n");
    assert.deepEqual(ssrcsOf(sdp), { audio: undefined, video: 55, rtx: undefined });
});
