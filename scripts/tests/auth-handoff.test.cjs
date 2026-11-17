const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

// Both routes with signing, users and sessions stubbed; tickets are plain JSON here.
class ResponseError extends Error {
    constructor(status, body) {
        super(body.message);
        this.status = status;
    }
}
const util = {
    ResponseError,
    signTicket: (payload, seconds) => JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + seconds }),
    readTicket: (token, typ) => {
        try {
            const ticket = JSON.parse(token);
            return ticket.typ === typ && ticket.exp * 1000 > Date.now() ? ticket : null;
        } catch {
            return null;
        }
    },
};

function load(file, users, modules = {}) {
    const module = { exports: {} };
    let handler;
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        }).outputText,
        {
            module,
            exports: module.exports,
            Buffer,
            Date,
            require: (name) => {
                if (name === "express") return { Router: () => ({ post: (_path, _route, fn) => (handler = fn) }) };
                if (name === "@spacebar/api/middlewares") return { route: () => null };
                if (name === "@spacebar/api/util") return util;
                if (name === "@spacebar/database") return { User: { findOne: async ({ where }) => users[where.id] ?? null } };
                if (name === "@spacebar/util") return { generateToken: async (id) => `session-for-${id}` };
                if (modules[name]) return modules[name];
                return require(name);
            },
        },
    );
    return { handler, exports: module.exports };
}

function routes(users = { 7: { id: "7" } }) {
    const handoff = load("src/api/routes/auth/handoff/index.ts", users);
    const exchange = load("src/api/routes/auth/handoff/exchange.ts", users, { "./index": handoff.exports });
    const call = async (handler, body, user_id) => {
        const res = { json: (value) => (res.body = value) };
        try {
            await handler({ body, user_id }, res);
            return { status: 200, body: res.body };
        } catch (error) {
            if (error instanceof ResponseError) return { status: error.status };
            throw error;
        }
    };
    return {
        start: (body, user) => call(handoff.handler, body, user),
        trade: (body) => call(exchange.handler, body),
    };
}

test("a handoff ticket gives one session to the app that holds the key", async () => {
    const { start, trade } = routes();
    const key = crypto.randomUUID();
    const { body } = await start({ key }, "7");
    assert.equal(typeof body.handoff_token, "string");
    assert.equal((await trade({ key: crypto.randomUUID(), handoff_token: body.handoff_token })).status, 400, "another key");
    assert.deepEqual(JSON.parse(JSON.stringify(await trade({ key, handoff_token: body.handoff_token }))), { status: 200, body: { token: "session-for-7" } });
    assert.equal((await trade({ key, handoff_token: body.handoff_token })).status, 400, "a second exchange");
});

test("malformed keys, forged or expired tickets and disabled accounts get no session", async () => {
    const { start, trade } = routes({ 7: { id: "7" }, 8: { id: "8", disabled: true } });
    for (const key of ["short", "x".repeat(200), "has spaces in it!!", 42]) assert.equal((await start({ key }, "7")).status, 400, String(key));
    const key = crypto.randomUUID();
    const kh = crypto.createHash("sha256").update(key).digest("base64url");
    const forged = JSON.stringify({ typ: "ra_login", uid: "7", kh, exp: Date.now() / 1000 + 60 });
    assert.equal((await trade({ key, handoff_token: forged })).status, 400, "another ticket type");
    const expired = JSON.stringify({ typ: "handoff", uid: "7", kh, exp: Date.now() / 1000 - 1 });
    assert.equal((await trade({ key, handoff_token: expired })).status, 400, "expired");
    const disabled = (await start({ key }, "8")).body.handoff_token;
    assert.equal((await trade({ key, handoff_token: disabled })).status, 400, "disabled account");
});
