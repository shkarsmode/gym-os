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

test("the hidden native date input never becomes interactive", () => {
    /**
     * `<gym-date>` keeps a real `<input type="date">` behind the field to hold the value
     * and the min/max bounds. It must never receive pointer events.
     *
     * It used to be given `pointer-events: auto` under (pointer: coarse), back when touch
     * screens were deliberately handed to the OS picker. When the JS half of that was
     * removed, this half stayed behind — so on every phone the invisible input still lay
     * across the whole field, swallowed the tap, opened the native dialog, and the custom
     * calendar flashed once and disappeared as the system dialog took focus. It read as
     * "the picker closes by itself".
     */
    const source = stripComments(fs.readFileSync(cssPath, "utf8"));
    const blocks = source.match(/\.gdate-native[^{]*\{[^}]*\}/g) || [];
    assert.notEqual(blocks.length, 0, "no .gdate-native rule found at all");
    for (const block of blocks) {
        assert.equal(
            /pointer-events\s*:\s*auto/.test(block),
            false,
            "A .gdate-native rule turns pointer events back on, which hands the field to "
            + "the OS date picker:\n" + block
        );
    }
});

test("the superset member rows can shrink below their own content", () => {
    /**
     * A GRID ITEM DEFAULTS TO `min-width: auto`, so it refuses to shrink under its
     * min-content — and `.ss-menu-member` holds an exercise name with `white-space:
     * nowrap`, whose min-content is the whole name. A long one therefore pushed the row
     * past the sheet and the whole superset menu scrolled sideways. Short names hid it
     * completely, which is why it shipped.
     */
    const source = stripComments(fs.readFileSync(cssPath, "utf8"));
    const container = (source.match(/\.ss-menu-members[^{]*\{[^}]*\}/g) || [])[0];
    const item = (source.match(/\.ss-menu-member[^-s][^{]*\{[^}]*\}/g) || [])[0];
    assert.ok(container, "no .ss-menu-members rule found");
    assert.ok(item, "no .ss-menu-member rule found");
    assert.ok(
        /minmax\(\s*0/.test(container) || /min-width\s*:\s*0/.test(item),
        "Neither .ss-menu-members (minmax(0, …)) nor .ss-menu-member (min-width: 0) lets "
        + "the row shrink, so a long exercise name will overflow the sheet horizontally."
    );
});

test("the focus-mode superset members stay on one row", () => {
    /**
     * Focus mode has to fit without scrolling. Three members wrapped the chip strip onto
     * a second line, which pushed the CTA and the round button off a 667px screen — the
     * exact complaint that started this. Equal columns keep them on one row at any member
     * count and ellipsise the names instead.
     */
    const source = stripComments(fs.readFileSync(cssPath, "utf8"));
    const block = (source.match(/\.focus-ss-members[^{]*\{[^}]*\}/g) || [])[0];
    assert.ok(block, "no .focus-ss-members rule found");
    assert.equal(
        /flex-wrap\s*:\s*wrap/.test(block),
        false,
        "The member strip wraps again; a three-exercise superset will not fit on a short "
        + "phone: " + block
    );
    assert.ok(
        /grid-auto-flow\s*:\s*column/.test(block),
        "The member strip is expected to lay its chips out as equal columns: " + block
    );
});
