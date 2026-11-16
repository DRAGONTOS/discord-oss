const assert = require("node:assert/strict");
const test = require("node:test");

test("the testing status reports online per platform, so the phone and headset icons follow the device", () => {
    const { aggregatePresence, clientStatusFor } = require("../../dist/util/util/Presence");
    assert.deepEqual(clientStatusFor("mobile", "testing"), { mobile: "online" });
    assert.deepEqual(clientStatusFor("vr", "dnd"), { vr: "dnd" });
    assert.deepEqual(clientStatusFor("desktop", "invisible"), {});

    const now = new Date();
    const session = (platform, status) => ({ user_id: "1", status, activities: [], client_status: {}, client_info: { platform }, last_seen: now });
    const phone = aggregatePresence([session("mobile", "testing")]);
    assert.equal(phone.status, "testing", "the status itself stays testing");
    assert.deepEqual(phone.client_status, { mobile: "online" });

    const both = aggregatePresence([session("mobile", "testing"), session("desktop", "idle")]);
    assert.equal(both.status, "testing");
    assert.deepEqual(both.client_status, { mobile: "online", desktop: "idle" });
});
