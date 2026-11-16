const assert = require("node:assert/strict");
const test = require("node:test");
const { createWebCrypto } = require("../../client/mobile/src/e2ee/subtle.ts");
const { bytesToBase64, ciphertextUrl, createMobileAttachments, localName } = require("../../client/mobile/src/e2ee/attachments.ts");
const { encryptFile, FILE_CHUNK } = require("../../client/e2ee/src/files.ts");
const { toB64u } = require("../../client/e2ee/src/bytes.ts");

const native = globalThis.crypto;
const shim = createWebCrypto((length) => native.getRandomValues(new Uint8Array(length)));
const ORIGIN = "https://chat.example";
const CHANNEL = "111";

// the app decrypts with the noble shim, as Hermes has no WebCrypto
const withShim = async (task) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { value: shim, configurable: true, writable: true });
    try {
        return await task();
    } finally {
        Object.defineProperty(globalThis, "crypto", descriptor);
    }
};

const fakeFiles = () => {
    const written = new Map();
    return {
        written,
        getConstants: () => ({ CacheDirPath: "/app/Caches", DocumentsDirPath: "/app/Documents" }),
        fileExists: async (path) => written.has(path.replace("/app/Caches/", "")),
        writeFile: async (dir, name, data, encoding) => {
            assert.equal(dir, "cache");
            assert.equal(encoding, "base64");
            written.set(name, Buffer.from(data, "base64"));
        },
    };
};

const encrypted = async (plain) => {
    const key = native.getRandomValues(new Uint8Array(32));
    const iv = native.getRandomValues(new Uint8Array(12));
    const blob = await encryptFile(new Blob([plain]), key, iv);
    return { ciphertext: await blob.arrayBuffer(), key: toB64u(key), iv: toB64u(iv) };
};

const message = (name, url) => ({
    id: "900",
    channel_id: CHANNEL,
    content: "🔒 Encrypted message",
    attachments: [{ id: "222", filename: name, url, proxy_url: url, size: 9, content_type: "application/octet-stream", placeholder: "x" }],
});

test("bytesToBase64 matches Buffer for every padding length and across chunk boundaries", () => {
    for (const length of [0, 1, 2, 3, 4, 5, 0x8000 * 3 + 1]) {
        const bytes = native.getRandomValues(new Uint8Array(length));
        assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString("base64"), `length ${length}`);
    }
});

test("ciphertextUrl only takes this channel's attachment under its own name on the instance", () => {
    const own = `${ORIGIN}/attachments/${CHANNEL}/222/abc.bin?ex=1`;
    assert.equal(ciphertextUrl(own, CHANNEL, "abc.bin", ORIGIN), own);
    assert.equal(ciphertextUrl(`${ORIGIN}/attachments/999/222/abc.bin`, CHANNEL, "abc.bin", ORIGIN), null, "another channel");
    assert.equal(ciphertextUrl(`${ORIGIN}/attachments/${CHANNEL}/222/other.bin`, CHANNEL, "abc.bin", ORIGIN), null, "another file");
    assert.equal(ciphertextUrl(`${ORIGIN}/avatars/1/abc.bin`, CHANNEL, "abc.bin", ORIGIN), null, "not an attachment");
    assert.equal(ciphertextUrl(`https://user:pw@chat.example/attachments/${CHANNEL}/222/abc.bin`, CHANNEL, "abc.bin", ORIGIN), null, "credentials");
    assert.equal(ciphertextUrl("javascript:alert(1)", CHANNEL, "abc.bin", ORIGIN), null);
    const cdn = `https://cdn.example/attachments/${CHANNEL}/222/abc.bin`;
    assert.equal(ciphertextUrl(cdn, CHANNEL, "abc.bin", ORIGIN), cdn, "the instance's CDN on another host");
});

test("localName keeps a short extension and only the attachment id", () => {
    assert.equal(localName("222", "Cat Photo.JPG"), "meowcord-e2ee-files/222.jpg");
    assert.equal(localName("222", "../../x"), "meowcord-e2ee-files/222");
    assert.equal(localName("2/../22", "a.png"), "meowcord-e2ee-files/222.png");
});

test("an encrypted image is decrypted to the cache folder and the message is drawn again with the file", async () => {
    // more than one 64 KiB chunk, so the chunk nonces and the final-chunk flag are exercised
    const plain = native.getRandomValues(new Uint8Array(FILE_CHUNK * 2 + 123));
    const { ciphertext, key, iv } = await encrypted(plain);
    const files = fakeFiles();
    const redrawn = [];
    let fetched = 0;
    const attachments = createMobileAttachments({
        files: () => files,
        origin: `${ORIGIN}/api/v9`,
        redraw: (copy) => redrawn.push(copy),
        log: (line) => assert.fail(line),
        fetch: async (url) => {
            fetched++;
            assert.equal(url, `${ORIGIN}/attachments/${CHANNEL}/222/abc.bin`);
            return { ok: true, status: 200, arrayBuffer: async () => ciphertext };
        },
    });
    const meta = { name: "abc.bin", filename: "cat.png", content_type: "image/png", size: plain.length, key, iv, width: 640, height: 480 };
    const shown = message("abc.bin", `${ORIGIN}/attachments/${CHANNEL}/222/abc.bin`);

    await withShim(async () => {
        attachments.apply(shown, { content: "look", attachments: [meta] });
        assert.equal(shown.content, "look");
        const pending = shown.attachments[0];
        assert.equal(pending.filename, "cat.png");
        assert.equal(pending.content_type, "image/png");
        assert.equal(pending.width, 640);
        assert.equal(pending.url, "file:///app/Caches/meowcord-e2ee-files/222.png?pending=1");
        assert.equal(pending.placeholder, undefined);
        for (let i = 0; i < 200 && !redrawn.length; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    });

    assert.equal(redrawn.length, 1, "drawn again once the file is on disk");
    assert.equal(redrawn[0].attachments[0].url, "file:///app/Caches/meowcord-e2ee-files/222.png");
    assert.equal(redrawn[0].attachments[0].proxy_url, "file:///app/Caches/meowcord-e2ee-files/222.png");
    assert.deepEqual(new Uint8Array(files.written.get("meowcord-e2ee-files/222.png")), plain);

    // shown again later (channel reload): straight to the file, nothing fetched twice
    const again = message("abc.bin", `${ORIGIN}/attachments/${CHANNEL}/222/abc.bin`);
    attachments.apply(again, { content: "look", attachments: [meta] });
    assert.equal(again.attachments[0].url, "file:///app/Caches/meowcord-e2ee-files/222.png");
    assert.equal(fetched, 1);
});

test("a spoiler keeps its flag and prefix, and a file from another channel stays closed", async () => {
    const attachments = createMobileAttachments({
        files: () => fakeFiles(),
        origin: ORIGIN,
        redraw: () => {},
        log: () => {},
        fetch: async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }),
    });
    const meta = { name: "abc.bin", filename: "secret.png", content_type: "image/png", size: 9, key: "a", iv: "b", spoiler: true };
    const spoiler = message("abc.bin", `${ORIGIN}/attachments/${CHANNEL}/222/abc.bin`);
    attachments.apply(spoiler, { content: "", attachments: [meta] });
    assert.equal(spoiler.attachments[0].filename, "SPOILER_secret.png");
    assert.equal(spoiler.attachments[0].flags & 8, 8);

    const foreign = message("abc.bin", `${ORIGIN}/attachments/999/222/abc.bin`);
    attachments.apply(foreign, { content: "", attachments: [meta] });
    assert.equal(foreign.attachments[0].filename, "abc.bin", "left as the opaque file");
});
