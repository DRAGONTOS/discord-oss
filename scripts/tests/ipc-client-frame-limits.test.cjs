const { test } = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const { IpcClient } = require("../../src/webrtc/pion/IpcClient.ts");

const frame = (message) => {
    const body = Buffer.from(JSON.stringify(message));
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length);
    return Buffer.concat([header, body]);
};

async function withServer(handler) {
    const socketPath = path.join(os.tmpdir(), `ipc-frame-limits-${process.pid}-${Math.random().toString(16).slice(2)}.sock`);
    const server = net.createServer(handler);
    await new Promise((resolve) => server.listen(socketPath, resolve));
    return { socketPath, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("reassembles a frame whose length header and body arrive in separate chunks", async () => {
    const events = [];
    const { socketPath, close } = await withServer((socket) => {
        socket.on("data", (chunk) => {
            const message = JSON.parse(chunk.subarray(4).toString());
            if (message.type !== "request") return;
            const response = frame({ id: message.id, type: "response", payload: { type: "reply", clientId: "c", ok: true } });
            setTimeout(() => socket.write(response.subarray(0, 2)), 0);
            setTimeout(() => socket.write(response.subarray(2, 7)), 5);
            setTimeout(() => socket.write(response.subarray(7)), 10);
        });
    });
    const client = new IpcClient(socketPath, (payload) => events.push(payload));
    try {
        await client.connect();
        const result = await client.request({ type: "probe", clientId: "c" }, 2000);
        assert.equal(result.ok, true);
        assert.deepEqual(events, []);
    } finally {
        client.close();
        await close();
    }
});

test("delivers every frame when several arrive in one chunk", async () => {
    const events = [];
    const { socketPath, close } = await withServer((socket) => {
        socket.on("data", () => {
            for (let i = 0; i < 3; i++) socket.write(frame({ id: "", type: "event", payload: { type: "connected", clientId: `c${i}` } }));
        });
    });
    const client = new IpcClient(socketPath, (payload) => events.push(payload));
    try {
        await client.connect();
        client.send({ type: "trigger", clientId: "c" });
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.deepEqual(
            events.map((event) => event.clientId),
            ["c0", "c1", "c2"],
        );
    } finally {
        client.close();
        await close();
    }
});

test("rejects requests beyond the in-flight cap and frees capacity on responses", async () => {
    const { socketPath, close } = await withServer((socket) => {
        let buffer = Buffer.alloc(0);
        socket.on("data", (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
            while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32BE(0)) {
                const message = JSON.parse(buffer.subarray(4, 4 + buffer.readUInt32BE(0)).toString());
                buffer = buffer.subarray(4 + buffer.readUInt32BE(0));
                if (message.payload.type === "stalled") continue;
                socket.write(frame({ id: message.id, type: "response", payload: { type: "done", clientId: "c" } }));
            }
        });
    });
    const client = new IpcClient(socketPath, () => {});
    try {
        await client.connect();
        const firstBatch = await Promise.all(Array.from({ length: 128 }, () => client.request({ type: "done", clientId: "c" }, 1000)));
        assert.ok(firstBatch.every((result) => result.type === "done"));
        const stalled = Array.from({ length: 128 }, () =>
            client.request({ type: "stalled", clientId: "c" }, 1000).then(
                () => "resolved",
                () => "rejected",
            ),
        );
        const extra = await client.request({ type: "extra", clientId: "c" }, 1000).then(
            () => null,
            (error) => error,
        );
        assert.match(extra.message, /too many in-flight requests/);
        client.close();
        assert.deepEqual(await Promise.all(stalled), Array(128).fill("rejected"));
    } finally {
        client.close();
        await close();
    }
});
