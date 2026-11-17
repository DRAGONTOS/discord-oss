const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

// the route's handler with its storage and upstream fetch stubbed
function load({ stored = {}, upstream = {} }) {
    const module = { exports: {} };
    let handler;
    const calls = { upstream: [] };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/cdn/routes/assets/collectibles.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        }).outputText,
        {
            module,
            exports: module.exports,
            require: (name) => {
                if (name === "express") return { Router: () => ({ get: (_path, _cache, fn) => (handler = fn) }) };
                if (name === "../../util")
                    return {
                        storage: { get: async (path) => stored[path] ?? null },
                        setCacheControl: () => {},
                        setCacheControlNotFound: (_req, res) => res.status(404).send("not found"),
                        fetchUpstreamAsset: async (path, url) => {
                            calls.upstream.push({ path, url });
                            return upstream[url] ?? null;
                        },
                        sendAsset: (res, data, name) => res.status(200).send({ data, name }),
                    };
                return require(name);
            },
        },
    );
    const get = async (path) => {
        const res = {
            code: 200,
            status(code) {
                this.code = code;
                return this;
            },
            send(body) {
                this.body = body;
                return this;
            },
        };
        await handler({ params: { path: path.split("/") } }, res);
        return res;
    };
    return { get, calls };
}

test("Discord's nameplates are proxied from its CDN under their own path", async () => {
    const art = Buffer.from("png");
    const url = "https://cdn.discordapp.com/assets/collectibles/nameplates/witch_dust/155/static.png";
    const { get, calls } = load({ upstream: { [url]: art } });
    const res = await get("nameplates/witch_dust/155/static.png");
    assert.equal(res.code, 200);
    assert.equal(res.body.data, art);
    assert.deepEqual(calls.upstream, [{ path: "collectibles-assets-upstream/nameplates/witch_dust/155/static.png", url }]);
});

test("the admin panel's nameplates come from the store's uploads, never from Discord", async () => {
    const still = Buffer.from("still");
    const video = Buffer.from("video");
    const { get, calls } = load({ stored: { "collectibles-shop/42/static": still, "collectibles-shop/42/video": video } });
    assert.equal((await get("nameplates/custom/42/static.png")).body.data, still);
    assert.equal((await get("nameplates/custom/42/asset.webm")).body.data, video);
    assert.equal((await get("nameplates/custom/43/static.png")).code, 404);
    assert.equal((await get("nameplates/custom/42/other.png")).code, 404);
    assert.equal(calls.upstream.length, 0);
});

test("paths that could leave the folder are refused", async () => {
    const { get, calls } = load({});
    for (const path of ["nameplates/../../secret", "static.png", "a/b/c/d/e/f", "nameplates/x y/static.png"]) assert.equal((await get(path)).code, 404, path);
    assert.equal(calls.upstream.length, 0);
});
