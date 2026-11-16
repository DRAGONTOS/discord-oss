// Starts scripts/ops/update-webhook.py with a stub update script and checks that only correctly signed pushes to the
// configured branch run it, and that a push during a run is not lost.
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const listener = path.join(__dirname, "..", "ops", "update-webhook.py");
const secret = "test-secret";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("update webhook runs the update for signed pushes to the branch", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "update-webhook-"));
    const runs = path.join(dir, "runs");
    const stub = path.join(dir, "update.sh");
    // each run takes a moment, so a second push can arrive while one is running
    fs.writeFileSync(stub, `#!/bin/sh\nsleep 0.3\necho run >> "${runs}"\n`, { mode: 0o755 });
    const port = 20000 + Math.floor(Math.random() * 20000);
    const child = spawn("python3", [listener], {
        env: { ...process.env, UPDATE_WEBHOOK_SECRET: secret, UPDATE_WEBHOOK_PORT: String(port), UPDATE_SCRIPT: stub },
        stdio: "ignore",
    });
    const count = () => (fs.existsSync(runs) ? fs.readFileSync(runs, "utf8").split("\n").filter(Boolean).length : 0);
    const post = (payload, { event = "push", key = secret } = {}) => {
        const body = JSON.stringify(payload);
        const signature = `sha256=${crypto.createHmac("sha256", key).update(body).digest("hex")}`;
        return fetch(`http://127.0.0.1:${port}/`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-github-event": event, "x-hub-signature-256": signature },
            body,
        });
    };
    try {
        for (let i = 0; i < 50; i++) {
            try {
                await fetch(`http://127.0.0.1:${port}/`, { method: "POST", body: "{}" });
                break;
            } catch {
                await sleep(100);
            }
        }

        assert.strictEqual((await post({ ref: "refs/heads/main" }, { key: "wrong" })).status, 401);
        assert.strictEqual((await post({ zen: "hi" }, { event: "ping" })).status, 200);
        assert.strictEqual((await post({ ref: "refs/heads/feature" })).status, 202);
        await sleep(500);
        assert.strictEqual(count(), 0, "a bad signature, a ping or another branch runs nothing");

        assert.strictEqual((await post({ ref: "refs/heads/main" })).status, 202);
        await sleep(100);
        // arrives while the first run is still going
        assert.strictEqual((await post({ ref: "refs/heads/main" })).status, 202);
        for (let i = 0; i < 30 && count() < 2; i++) await sleep(100);
        assert.strictEqual(count(), 2, "the push during a run gets a run of its own afterwards");
    } finally {
        child.kill();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
