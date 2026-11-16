// Runs scripts/auto-update.sh against a throwaway git remote, with docker and curl replaced by stubs that log their
// arguments, to check which commits it deploys and what it does when a build or a client download fails.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const script = path.join(__dirname, "..", "auto-update.sh");

const dockerStub = `#!/bin/sh
echo "$*" >> "$STUB_DIR/docker.log"
case " $* " in
*" --entrypoint "*) printf '{"BUILD_NUMBER":"%s"}' "$(cat "$STUB_DIR/client_build" 2>/dev/null)" ;;
*" --force "*)
    [ -n "$STUB_CLIENT_FAIL" ] && exit 1
    grep -o '"buildNumber": *"[0-9]*"' client/release.json | grep -o '[0-9][0-9]*' > "$STUB_DIR/client_build" ;;
*" build "*) [ -n "$STUB_BUILD_FAIL" ] && exit 1 ;;
esac
exit 0
`;

function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-update-"));
    const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim();
    const origin = path.join(dir, "origin.git");
    const work = path.join(dir, "work");
    const deploy = path.join(dir, "deploy");
    const stubs = path.join(dir, "stubs");
    fs.mkdirSync(stubs);
    fs.writeFileSync(path.join(stubs, "docker"), dockerStub, { mode: 0o755 });
    fs.writeFileSync(path.join(stubs, "curl"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    git(dir, "init", "-q", "--bare", "-b", "main", origin);
    git(dir, "clone", "-q", origin, work);
    fs.mkdirSync(path.join(work, "scripts"));
    fs.mkdirSync(path.join(work, "client"));
    fs.copyFileSync(script, path.join(work, "scripts", "auto-update.sh"));
    const pin = (build) => fs.writeFileSync(path.join(work, "client", "release.json"), `{\n    "buildNumber": "${build}"\n}\n`);
    pin(100);
    git(work, "add", ".");
    git(work, "commit", "-q", "-m", "first");
    git(work, "push", "-q", "origin", "HEAD:main");
    git(dir, "clone", "-q", origin, deploy);
    fs.writeFileSync(path.join(stubs, "client_build"), "100");

    const commit = (message, build) => {
        if (build) pin(build);
        else fs.writeFileSync(path.join(work, message), message);
        git(work, "add", ".");
        git(work, "commit", "-q", "-m", message);
        git(work, "push", "-q", "origin", "HEAD:main");
        return git(work, "rev-parse", "HEAD");
    };
    const run = (env = {}) => {
        fs.rmSync(path.join(stubs, "docker.log"), { force: true });
        const result = spawnSync("bash", [path.join(deploy, "scripts", "auto-update.sh")], {
            encoding: "utf8",
            env: { ...process.env, PATH: `${stubs}:${process.env.PATH}`, STUB_DIR: stubs, LOCK_FILE: path.join(dir, "lock"), NOTIFY_WEBHOOK: "", ...env },
        });
        const docker = fs.existsSync(path.join(stubs, "docker.log")) ? fs.readFileSync(path.join(stubs, "docker.log"), "utf8") : "";
        return { status: result.status, out: result.stdout + result.stderr, docker };
    };
    const head = () => git(deploy, "rev-parse", "HEAD");
    return { dir, commit, run, head, stubs };
}

test("auto-update deploys new commits and leaves an up-to-date checkout alone", () => {
    const t = setup();
    try {
        let r = t.run();
        assert.strictEqual(r.status, 0, r.out);
        assert.match(r.out, /everything is up to date/);
        assert.doesNotMatch(r.docker, /compose build|--force/);

        const next = t.commit("feature");
        r = t.run();
        assert.strictEqual(r.status, 0, r.out);
        assert.strictEqual(t.head(), next);
        assert.match(r.docker, /compose build/);
        assert.match(r.docker, /compose up -d/);
        assert.doesNotMatch(r.docker, /--force/, "an unchanged pin downloads nothing");
    } finally {
        fs.rmSync(t.dir, { recursive: true, force: true });
    }
});

test("auto-update downloads the client when the pulled code pins a new build", () => {
    const t = setup();
    try {
        const next = t.commit("pin 200", 200);
        const r = t.run();
        assert.strictEqual(r.status, 0, r.out);
        assert.strictEqual(t.head(), next);
        assert.ok(r.docker.indexOf("client client --force") < r.docker.indexOf("compose up -d"), "the client is downloaded before the restart");
        assert.strictEqual(fs.readFileSync(path.join(t.stubs, "client_build"), "utf8").trim(), "200");
    } finally {
        fs.rmSync(t.dir, { recursive: true, force: true });
    }
});

test("auto-update stays on the running commit when the new pin can't be downloaded", () => {
    const t = setup();
    try {
        const before = t.head();
        t.commit("pin 300", 300);
        const r = t.run({ STUB_CLIENT_FAIL: "1" });
        assert.strictEqual(r.status, 1, r.out);
        assert.strictEqual(t.head(), before);
        assert.doesNotMatch(r.docker, /compose up -d/);
        assert.match(r.out, /staying on/);
    } finally {
        fs.rmSync(t.dir, { recursive: true, force: true });
    }
});

test("auto-update reports a failed build once and retries on the next commit", () => {
    const t = setup();
    try {
        const before = t.head();
        t.commit("broken");
        let r = t.run({ STUB_BUILD_FAIL: "1" });
        assert.strictEqual(r.status, 1, r.out);
        assert.strictEqual(t.head(), before);

        r = t.run();
        assert.strictEqual(r.status, 1, r.out);
        assert.match(r.out, /failed to update before/);
        assert.doesNotMatch(r.docker, /compose build/, "the same commit isn't rebuilt every run");

        const fixed = t.commit("fix");
        r = t.run();
        assert.strictEqual(r.status, 0, r.out);
        assert.strictEqual(t.head(), fixed);
    } finally {
        fs.rmSync(t.dir, { recursive: true, force: true });
    }
});
