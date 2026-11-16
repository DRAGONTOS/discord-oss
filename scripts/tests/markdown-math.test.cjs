const { test } = require("node:test");
const assert = require("node:assert/strict");
const MarkdownIt = require("markdown-it");
const { dollarmathPlugin } = require("markdown-it-dollarmath");
const { bracketMath } = require("../../client/plugins/fosscordMarkdownMath/math.ts");

const parser = () =>
    new MarkdownIt({ html: false, linkify: false, typographer: false }).use(dollarmathPlugin, { allow_space: false, allow_digits: false, allow_labels: false }).use(bracketMath);

const flatten = (tokens) => tokens.flatMap((token) => [token, ...flatten(token.children ?? [])]);
const mathTokens = (source) =>
    flatten(parser().parse(source, {}))
        .filter((token) => token.type.startsWith("math"))
        .map((token) => [token.type, token.content]);

test("every math delimiter becomes a math token before markdown touches it", () => {
    assert.deepEqual(mathTokens(String.raw`Inline $a_b + c_d$, \(x_1^2\) and $$e^{i\pi}$$ and \[y_*\].`), [
        ["math_inline", "a_b + c_d"],
        ["math_inline", "x_1^2"],
        ["math_inline_double", String.raw`e^{i\pi}`],
        ["math_inline_double", "y_*"],
    ]);
    assert.deepEqual(mathTokens(String.raw`$$\int_0^\infty e^{-x^2}\,dx$$`), [["math_block", String.raw`\int_0^\infty e^{-x^2}\,dx`]]);
    assert.deepEqual(mathTokens("\\[\n\\sum_{n=1}^\\infty \\frac{1}{n^2}\n\\]"), [["math_block", String.raw`\sum_{n=1}^\infty \frac{1}{n^2}`]]);
    assert.deepEqual(mathTokens("Text\n\\[ a_b \\]\nmore"), [["math_block", "a_b"]]);
});

test("escaped, unterminated and code delimiters stay text", () => {
    assert.deepEqual(mathTokens(String.raw`\\(not math\\) and \(open`), []);
    assert.deepEqual(mathTokens("\\[\nunterminated\n\nparagraph"), []);
    assert.deepEqual(mathTokens("`\\(code\\)` and\n```\n\\[fenced\\]\n```"), []);
    assert.deepEqual(mathTokens(String.raw`\( \) and \[ \]`), []);
    assert.deepEqual(mathTokens("costs $5 and $10, $ x $ and $x$5"), []);
});
