interface InlineState {
    src: string;
    pos: number;
    push(type: string, tag: string, nesting: number): { content: string; markup: string };
}

interface BlockState {
    src: string;
    bMarks: number[];
    eMarks: number[];
    tShift: number[];
    sCount: number[];
    blkIndent: number;
    line: number;
    push(type: string, tag: string, nesting: number): { content: string; markup: string; block: boolean; map: [number, number] | null };
}

interface MarkdownIt {
    inline: { ruler: { before(name: string, rule: string, fn: (state: InlineState, silent: boolean) => boolean): void } };
    block: {
        ruler: {
            before(name: string, rule: string, fn: (state: BlockState, startLine: number, endLine: number, silent: boolean) => boolean, options?: { alt: string[] }): void;
        };
    };
}

const BACKSLASH = 0x5c;

function bracketInline(state: InlineState, silent: boolean) {
    const { src, pos } = state;
    if (src.charCodeAt(pos) !== BACKSLASH) return false;
    const open = src[pos + 1];
    if (open !== "(" && open !== "[") return false;
    const end = src.indexOf(open === "(" ? "\\)" : "\\]", pos + 2);
    if (end < 0) return false;
    const content = src.slice(pos + 2, end);
    if (!content.trim()) return false;
    if (!silent) {
        const token = state.push(open === "(" ? "math_inline" : "math_inline_double", "math", 0);
        token.content = content.trim();
        token.markup = `\\${open}`;
    }
    state.pos = end + 2;
    return true;
}

function bracketBlock(state: BlockState, startLine: number, endLine: number, silent: boolean) {
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;
    const start = state.bMarks[startLine] + state.tShift[startLine];
    if (!state.src.startsWith("\\[", start)) return false;
    const lines = [state.src.slice(start + 2, state.eMarks[startLine]).trimEnd()];
    let line = startLine;
    while (!lines[lines.length - 1].endsWith("\\]")) {
        line++;
        if (line >= endLine) return false;
        const lineStart = state.bMarks[line] + state.tShift[line];
        if (lineStart >= state.eMarks[line]) return false;
        lines.push(state.src.slice(lineStart, state.eMarks[line]).trimEnd());
    }
    const content = lines.join("\n").slice(0, -2).trim();
    if (!content) return false;
    if (silent) return true;
    state.line = line + 1;
    const token = state.push("math_block", "math", 0);
    token.block = true;
    token.content = content;
    token.markup = "\\[";
    token.map = [startLine, state.line];
    return true;
}

export function bracketMath(md: MarkdownIt) {
    md.inline.ruler.before("escape", "fosscord_math_bracket_inline", bracketInline);
    md.block.ruler.before("fence", "fosscord_math_bracket_block", bracketBlock, { alt: ["paragraph", "reference", "blockquote", "list"] });
    return md;
}
