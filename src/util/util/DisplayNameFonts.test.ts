import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { instanceFonts, InstanceFont, nextInstanceFontId, uniqueFontKey, validateInstanceFonts, writeInstanceFonts } from "./DisplayNameFonts";

const font = (overrides: Partial<InstanceFont> = {}): InstanceFont => ({
    id: 100,
    key: "TEST_FONT",
    name: "Test Font",
    family: "Test Font",
    file: "TestFont.ttf",
    format: "truetype",
    ...overrides,
});

test("validation accepts the shipped style of entry, including stretch ranges and style declarations", () => {
    assert.deepEqual(
        validateInstanceFonts([
            font({
                weight: "200 900",
                stretch: "50% 200%",
                style: 'font-weight:700;font-variation-settings:"wdth" 200,"wght" 700;',
            }),
        ]),
        [font({ weight: "200 900", stretch: "50% 200%", style: 'font-weight:700;font-variation-settings:"wdth" 200,"wght" 700;' })],
    );
});

test("validation rejects ids below 100, duplicate ids, bad keys, bad formats, unsafe descriptors and styles", () => {
    for (const broken of [
        font({ id: 99 }),
        font({ key: "lower_case" }),
        font({ key: "2_FAST" }),
        font({ file: "bad name/font.ttf" }),
        font({ format: "eot" }),
        font({ weight: "700; color: red" }),
        font({ style: "font-weight:700}body{display:none" }),
    ])
        assert.throws(() => validateInstanceFonts([font(), broken]));
    assert.throws(() => validateInstanceFonts([font(), font()]));
});

test("font ids allocate from 100 and continue past the highest entry", () => {
    assert.equal(nextInstanceFontId([]), 100);
    assert.equal(nextInstanceFontId([font()]), 101);
    assert.equal(nextInstanceFontId([font({ id: 250, key: "OTHER_FONT", file: "Other.ttf" })]), 251);
});

test("keys derive from the label, start with a letter and stay unique", () => {
    assert.equal(uniqueFontKey([], "Comic Neue"), "COMIC_NEUE");
    assert.equal(uniqueFontKey([font({ key: "COMIC_NEUE" })], "Comic Neue!"), "COMIC_NEUE_2");
    assert.equal(uniqueFontKey([], "2 Fast 2 Furious"), "F2_FAST_2_FURIOUS");
    assert.equal(uniqueFontKey([], "増井"), "F");
});

test("fonts round trip through the registry file", () => {
    const registry = path.join(mkdtempSync(path.join(tmpdir(), "fonts-")), "fonts.json");
    const entries = [font({ weight: "200 900" }), font({ id: 101, key: "COMIC_NEUE", name: "Comic Neue", family: "Comic Neue", file: "ComicNeue.woff2", format: "woff2" })];
    writeInstanceFonts(entries, registry);
    assert.deepEqual(instanceFonts(registry), entries);
    assert.ok(fs.readFileSync(registry, "utf8").endsWith("]\n"));
});
