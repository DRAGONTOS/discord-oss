const { test } = require("node:test");
const assert = require("node:assert/strict");

const { parseVideoFmtp } = require("../../src/webrtc/pion/PionMediaServer.ts");

const sdp = (fmtp) => ["v=0", "m=video 9 UDP/TLS/RTP/SAVPF 102 103", `a=fmtp:102 ${fmtp}`, "a=fmtp:103 apt=102", ""].join("\r\n");

test("keeps an allowlisted baseline profile and its max bitrate", () => {
    assert.deepEqual(parseVideoFmtp(sdp("level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f;x-google-max-bitrate=4000"), 102), {
        profile: "42e01f",
        maxBitrate: 4000,
    });
});

test("keeps main and high profiles and normalizes case", () => {
    for (const [profile, expected] of [
        ["4d0028", "4d0028"],
        ["4D0028", "4d0028"],
        ["64001f", "64001f"],
        ["640028", "640028"],
    ])
        assert.equal(parseVideoFmtp(sdp(`packetization-mode=1;profile-level-id=${profile}`), 102).profile, expected);
});

test("falls back to baseline when the profile is missing, malformed or not allowlisted", () => {
    for (const fmtp of ["packetization-mode=1", "packetization-mode=1;profile-level-id=badbad", "packetization-mode=1;profile-level-id=1f1f1f"]) {
        assert.equal(parseVideoFmtp(sdp(fmtp), 102).profile, "42e01f");
    }
    assert.equal(parseVideoFmtp(["v=0", "m=video 9 UDP/TLS/RTP/SAVPF 102 103", ""].join("\r\n"), 102).profile, "42e01f");
});

test("defaults and clamps the max bitrate", () => {
    const parsed = (bitrate) => parseVideoFmtp(sdp(`packetization-mode=1;profile-level-id=42e01f;x-google-max-bitrate=${bitrate}`), 102);
    assert.equal(parseVideoFmtp(sdp("packetization-mode=1;profile-level-id=42e01f"), 102).maxBitrate, 2500);
    assert.equal(parsed(100).maxBitrate, 500);
    assert.equal(parsed(20000).maxBitrate, 12000);
    assert.equal(parsed(6000).maxBitrate, 6000);
});

test("only reads fmtp for the requested payload type", () => {
    const session = [
        "v=0",
        "m=video 9 UDP/TLS/RTP/SAVPF 102 103",
        "a=fmtp:103 apt=102",
        "a=fmtp:102 packetization-mode=1;profile-level-id=4d0028;x-google-max-bitrate=9000",
        "",
    ].join("\r\n");
    assert.deepEqual(parseVideoFmtp(session, 102), { profile: "4d0028", maxBitrate: 9000 });
    assert.deepEqual(parseVideoFmtp(session, 103), { profile: "42e01f", maxBitrate: 2500 });
});
