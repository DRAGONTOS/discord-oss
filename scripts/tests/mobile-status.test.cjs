const assert = require("node:assert/strict");
const test = require("node:test");
const { patchStatusExports, tintImages, TESTING_COLOR } = require("../../client/mobile/src/status.ts");

const element = (type, props) => ({ $$typeof: Symbol.for("react.transitional.element"), type, key: null, props });
const ICONS = { online: 335, offline: 334, dnd: 336 };
// shaped like the app's Status component: a container with the status icon image inside
function Status(props) {
    return element("View", { style: { width: 16 }, children: element("Image", { source: ICONS[props.status] ?? 0, style: { width: "100%" } }) });
}

test("the testing status draws the online icon tinted blue, with the device shape props passed through", () => {
    const replaced = patchStatusExports({ default: Status });
    const drawn = replaced.default({ status: "testing", isMobileOnline: true, size: 10 });
    const image = drawn.props.children;
    assert.equal(image.props.source, ICONS.online);
    assert.deepEqual(image.props.style, [{ width: "100%" }, { tintColor: TESTING_COLOR }]);
    assert.equal(drawn.$$typeof, Symbol.for("react.transitional.element"), "still a React element");
    assert.equal(replaced.default({ status: "dnd" }).props.children.props.source, ICONS.dnd, "other statuses are drawn as before");
});

test("tintImages only touches images", () => {
    const tree = element("View", { style: { a: 1 }, children: [element("Image", { source: 1 }), "text", null] });
    const tinted = tintImages(tree, "#000");
    assert.deepEqual(tinted.props.style, { a: 1 });
    assert.deepEqual(tinted.props.children[0].props.style, [undefined, { tintColor: "#000" }]);
    assert.equal(tinted.props.children[1], "text");
});

test("the status labels name it Testing, and modules are patched once", () => {
    function getStatusLabel(status) {
        return `label:${status}`;
    }
    function humanizeStatus(status) {
        return `human:${status}`;
    }
    const replaced = patchStatusExports({ getStatusLabel, humanizeStatus });
    assert.equal(replaced.getStatusLabel("testing"), "Testing");
    assert.equal(replaced.humanizeStatus("testing"), "Testing");
    assert.equal(replaced.getStatusLabel("idle"), "label:idle");
    assert.equal(patchStatusExports(replaced), null, "already patched functions aren't wrapped again");
    assert.equal(patchStatusExports({ default: function Other() {} }), null);
    assert.equal(patchStatusExports(new Proxy({}, { get: () => () => "x" })), null, "lazy proxies don't match");
});
