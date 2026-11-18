const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const client = require("../../src/util/config/types/ClientConfiguration.ts");

function sourceModule(file, resolve, extra = "") {
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
                esModuleInterop: true,
            },
        }).outputText + extra,
        { module, exports: module.exports, process: { env: {} }, console, require: resolve },
    );
    return module.exports;
}

const { GeneralConfiguration } = sourceModule("src/util/config/types/GeneralConfiguration.ts", (name) => {
    if (name === "@spacebar/util") return { Snowflake: { generate: () => "owned-id" } };
    if (name === "./ClientConfiguration") return client;
    return require(name);
});
const { migrate, dropUnknownSectionKeys } = sourceModule(
    "src/util/util/Config.ts",
    (name) => {
        if (name === "../config/types/ClientConfiguration") return client;
        if (name === "../config/types/AutomodConfiguration") return require("../../src/util/config/types/AutomodConfiguration.ts");
        if (name === "../config/types/ExternalRequestConfiguration") return require("../../src/util/config/types/ExternalRequestConfiguration.ts");
        if (name === "../config/types/subconfigurations/limits") return require("../../src/util/config/types/subconfigurations/limits/index.ts");
        if (name === "../imports" || name === "../config" || name === "../../database/entities") return {};
        return require(name);
    },
    "\nmodule.exports.migrate = replaceStaleDefaults;\nmodule.exports.dropUnknownSectionKeys = dropUnknownSectionKeys;",
);

function currentRevision() {
    const config = {};
    migrate(config);
    return config.defaultsRevision;
}

test("unknown keys in the fixed-shape settings sections are dropped", () => {
    const config = {
        externalRequests: { thirdParty: true, legacyFederationToggle: true },
        limits: { e2ee: { maxEnvelopeBytes: 123, legacyE2ee: "x" }, user: { maxGuilds: 10, legacyUserLimit: 5 } },
    };
    dropUnknownSectionKeys(config);
    assert.deepEqual(config.externalRequests, { thirdParty: true });
    assert.deepEqual(config.limits.e2ee, { maxEnvelopeBytes: 123 });
    assert.deepEqual(config.limits.user, { maxGuilds: 10 });
});

test("fresh client and general defaults use the Librecord name", () => {
    assert.equal(client.DEFAULT_INSTANCE_NAME, "Librecord");
    assert.equal(new client.ClientConfiguration().instanceName, "Librecord");
    assert.equal(new GeneralConfiguration().instanceName, "Librecord");
});

test("previous default names migrate once on a serialized older configuration", () => {
    const config = JSON.parse(
        JSON.stringify({
            defaultsRevision: currentRevision() - 4,
            client: { instanceName: "Fosscord", icon: "/owned.png" },
            general: { instanceName: "Fosscord" },
        }),
    );
    migrate(config);
    assert.equal(config.client.instanceName, "Librecord");
    assert.equal(config.general.instanceName, "Librecord");
    assert.equal(config.client.icon, "/owned.png");
    assert.equal(config.defaultsRevision, currentRevision());
    config.client.instanceName = "Fosscord";
    config.general.instanceName = "Fosscord";
    migrate(config);
    assert.equal(config.client.instanceName, "Fosscord");
    assert.equal(config.general.instanceName, "Fosscord");
});

test("the previous Meowcord default name migrates once", () => {
    const config = {
        defaultsRevision: currentRevision() - 2,
        client: { instanceName: "Meowcord" },
        general: { instanceName: "Meowcord" },
    };
    migrate(config);
    assert.equal(config.client.instanceName, "Librecord");
    assert.equal(config.general.instanceName, "Librecord");
    config.client.instanceName = "Meowcord";
    migrate(config);
    assert.equal(config.client.instanceName, "Meowcord");
});

test("default-name migration preserves custom client and general names independently", () => {
    for (const names of [
        ["Owned chat", "Owned server"],
        ["Owned chat", "Fosscord"],
        ["Fosscord", "Owned server"],
        ["Meowcord", "Owned server"],
        ["Owned chat", "Meowcord"],
    ]) {
        const config = { client: { instanceName: names[0] }, general: { instanceName: names[1] } };
        migrate(config);
        const defaulted = (name) => (name === "Fosscord" || name === "Meowcord" ? "Librecord" : name);
        assert.equal(config.client.instanceName, defaulted(names[0]));
        assert.equal(config.general.instanceName, defaulted(names[1]));
    }
});
