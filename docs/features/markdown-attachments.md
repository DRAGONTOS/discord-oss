# Markdown attachments

A text file attached to a message shows as a preview card with the file name, its size, a language picker (the `<>` button), a button that opens the whole file in a dialog and a menu with Download, Wrap Text and Render Markdown. For files whose extension is `md`, `markdown`, `mkd` or `mkdown`, Discord's client renders the Markdown itself. Raw HTML in the file stays text, links go through the client's own link handling and only a fixed set of tags is drawn.

## Math

Discord's client typesets LaTeX math in that preview with its own copy of KaTeX since build 673869. Discord's preview splits math out of the text before the Markdown is parsed, so underscores, asterisks and backslashes inside a formula are left alone. Discord only knows the `$` delimiters. The FosscordMarkdownMath plugin in `client/plugins/fosscordMarkdownMath` adds `\(...\)` and `\[...\]` to its parser, which hands them to the same renderer, and keeps the collapsed card from cutting a formula in half.

| Written as           | Shown as                                   |
| -------------------- | ------------------------------------------ |
| `$...$`              | Inline math.                               |
| `\(...\)`            | Inline math.                               |
| `$$...$$` in a line  | Display math, on its own centred line.     |
| `$$...$$` on its own | A display block, centred.                  |
| `\[...\]`            | A display block, centred. It can span lines. |

`$` delimiters follow Discord's rules: no space just inside the delimiters and no digit right after the closing `$`, so `$5 and $10` stays text. `\\(` is an escaped backslash followed by a parenthesis, not math. Math inside inline code or a fenced code block stays code. A delimiter that never closes stays text. The collapsed card normally shows the first 6 lines. When a `$$` or `\[` block is still open at line 6, it shows up to 30 more lines so the whole formula fits, and when the block doesn't close within those, it stops just before the block instead of showing half of it. Math inside code doesn't count. `scripts/tests/markdown-math-preview.test.cjs` covers this.

The card and the whole-file dialog both render math. A display formula wider than the card scrolls sideways. Turning off Render Markdown in the menu, or picking another language with `<>`, shows the raw source.

## Safety

The file comes from whoever sent it, so it is treated as hostile.

- Discord's renderer builds React elements from the Markdown tokens. HTML in the file is never parsed as HTML, `javascript:`, `data:` and other unsafe links are shown as their Markdown source, and images become links instead of being loaded.
- Only a formula's KaTeX output is inserted as HTML. Discord runs KaTeX with `trust: false` and `strict: "error"`, at most 1000 macro expansions and boxes of at most 20 em, and disables a list of commands.
- A formula longer than 2,048 characters or nested more than 64 braces deep, or one that KaTeX can't parse, is shown as code. One preview renders at most 128 formulas, 16,384 characters of math, 50,000 HTML elements and 250 ms of KaTeX work. The client fetches at most the first 50,000 bytes of a file and walks at most 5,000 Markdown tokens.

`scripts/tests/markdown-math.test.cjs` covers the added delimiters with `markdown-it` and `markdown-it-dollarmath`, the libraries and options Discord's preview uses.
