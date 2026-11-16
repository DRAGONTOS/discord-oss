import definePlugin from "@utils/types";

import { FosscordAuthor } from "../fosscordCore/shared";
import { bracketMath } from "./math";
import { mathSafeLineCount } from "./preview";

// Discord typesets $...$ and $$...$$ in Markdown attachment previews with its own KaTeX since build 673869. This adds
// the \(...\) and \[...\] delimiters to its parser, which emits the same math tokens, and keeps the collapsed preview
// from cutting a formula in half.
export default definePlugin({
    name: "FosscordMarkdownMath",
    description: "Adds \\(...\\) and \\[...\\] math to the preview of Markdown file attachments.",
    authors: [FosscordAuthor],
    required: true,
    bracketMath,
    previewLines: (lines: string[] | undefined, wanted: number, markdown: boolean) => (markdown ? mathSafeLineCount(lines, wanted) : wanted),
    patches: [
        {
            find: '"--custom-plaintext-preview-collapsed-lines":6',
            all: true,
            replacement: {
                match: /(\i)\?\.slice\(0,(\i)\)(?=\.join\("\\n"\)\?\?"",\i=\i\|\|\2<\i;return\(0,\i\.jsxs\)\("div",\{className:\i\(\)\(\i,\i\.\i\),children:\[\(0,\i\.jsx\)\(\i\.\i,\{className:\i\(\)\(\i\.\i,\{\[\i\.\i\]:!\i&&!(\i)\}\))/,
                replace: "$1?.slice(0,$self.previewLines($1,$2,$3))",
            },
        },
        {
            find: 'case"math_block":',
            replacement: {
                match: /allow_labels:!1\}\)/,
                replace: "$&.use($self.bracketMath)",
            },
        },
    ],
});
