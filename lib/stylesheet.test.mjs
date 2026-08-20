import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The stylesheet must be structurally sound.
 *
 * This exists because an unbalanced brace shipped and silently disabled EVERY rule after
 * it — a browser abandons the rest of the file at the first stray `}`. Nothing catches
 * that: the build succeeds, no warning is printed, and the only symptom is that some
 * component looks unstyled, which reads as a layout bug in that component rather than as
 * a syntax error two hundred lines above it. It cost several rounds of "fix the button"
 * before the actual cause turned out to be a brace.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.join(here, "..", "styles.css");

/** Blank out comments while preserving line numbers, so a reported line is the real one. */
function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, (match) => "\n".repeat((match.match(/\n/g) || []).length));
}

test("styles.css has balanced braces", () => {
    const source = stripComments(fs.readFileSync(cssPath, "utf8"));
    let depth = 0;
    let line = 1;
    let stray = null;
    for (const character of source) {
        if (character === "\n") {
            line += 1;
        } else if (character === "{") {
            depth += 1;
        } else if (character === "}") {
            depth -= 1;
            if (depth < 0 && stray === null) {
                stray = line;
            }
        }
    }
    assert.equal(
        stray,
        null,
        `Stray closing brace at styles.css:${stray}. A browser stops parsing at the first `
        + "unmatched } and drops every rule after it, so this silently disables the rest of "
        + "the file."
    );
    assert.equal(depth, 0, `${depth} unclosed block(s) at the end of styles.css.`);
});

test("styles.css has no unterminated comment", () => {
    const source = fs.readFileSync(cssPath, "utf8");
    const opens = (source.match(/\/\*/g) || []).length;
    const closes = (source.match(/\*\//g) || []).length;
    // An unterminated comment eats the rest of the file just as thoroughly as a stray
    // brace, and just as quietly.
    assert.equal(opens, closes, `${opens} comment openers and ${closes} closers.`);
});

test("every @media block in styles.css is closed", () => {
    // Checked separately from the brace count because two errors can cancel out: a
    // missing close and a stray one leave the total balanced while the file is wrong.
    const source = stripComments(fs.readFileSync(cssPath, "utf8"));
    const lines = source.split("\n");
    let depth = 0;
    const openMedia = [];
    lines.forEach((text, index) => {
        if (/@media[^{]*\{/.test(text)) {
            openMedia.push({ line: index + 1, depth });
        }
        depth += (text.match(/\{/g) || []).length;
        depth -= (text.match(/\}/g) || []).length;
        while (openMedia.length && depth <= openMedia[openMedia.length - 1].depth) {
            openMedia.pop();
        }
    });
    assert.deepEqual(openMedia, [], `Unclosed @media at line(s) ${openMedia.map((item) => item.line).join(", ")}.`);
});
