const assert = require("node:assert/strict");
const test = require("node:test");
const { displayStatus, patchPresenceStore } = require("../../client/mobile/src/status.ts");

class PresenceStore {
    constructor(statuses) {
        this.statuses = statuses;
    }
    getStatus(userId) {
        return this.statuses[userId] ?? "offline";
    }
    isMobileOnline() {
        return false;
    }
}

test("the testing status shows as Do Not Disturb in the mobile app", () => {
    assert.equal(displayStatus("testing"), "dnd");
    for (const status of ["online", "idle", "dnd", "offline", undefined]) assert.equal(displayStatus(status), status);
});

test("the presence store's getStatus is wrapped once, through the default export too", () => {
    const store = new PresenceStore({ 1: "testing", 2: "online" });
    assert.equal(patchPresenceStore({ default: store }), true);
    assert.equal(store.getStatus("1"), "dnd");
    assert.equal(store.getStatus("2"), "online");
    assert.equal(new PresenceStore({ 3: "testing" }).getStatus("3"), "dnd", "the class is patched, so every instance");
    assert.equal(patchPresenceStore(store), false, "a second module exporting the store doesn't wrap it again");
    assert.equal(store.getStatus("1"), "dnd");
});

test("lazy proxies that answer every property are left alone", () => {
    const proxy = new Proxy({}, { get: () => () => "testing" });
    assert.equal(patchPresenceStore(proxy), false);
    assert.equal(patchPresenceStore({ getStatus: () => "testing", isMobileOnline: () => false }), false, "plain objects aren't stores");
});
