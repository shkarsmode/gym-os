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


test("a list modal keeps a fixed height instead of following its results", () => {
    /**
     * The bug: the picker is vertically centred and its height followed its content, so
     * typing in the search resized it on every keystroke — 60 cards to 2 to none in three
     * characters — and the box visibly jumped up and down under the cursor you were still
     * typing into. `max-height` alone does not fix that; the height has to be DEFINITE.
     */
    const source = stripComments(fs.readFileSync(cssPath, "utf8"));
    const block = (source.match(/\.modal-layer\.modal-list\s*\{[^}]*\}/g) || [])[0];
    assert.ok(block, "no .modal-layer.modal-list rule found");
    assert.ok(/display\s*:\s*flex/.test(block), "a list modal has to be a flex column:\n" + block);
    assert.ok(
        /overflow\s*:\s*hidden/.test(block),
        "the modal itself must not scroll, or the header scrolls away with the results:\n" + block
    );
    // The definite height lives in the desktop media query; on a phone the full-bleed
    // .modal-fullscreen height:100% takes over instead.
    const desktop = source.match(/@media\s*\(min-width:\s*921px\)\s*\{[\s\S]*?\n\}/);
    assert.ok(desktop, "no (min-width: 921px) block found");
    assert.ok(
        /\.modal-layer\.modal-list\s*\{[^}]*height\s*:/.test(desktop[0]),
        "no definite height for .modal-list on desktop — max-height alone still lets the "
        + "box shrink to its content, which is the whole bug"
    );
});

test("the list modal's scroller can actually shrink", () => {
    /**
     * Two traps in one rule. A flex item will not shrink below its content without
     * `min-height: 0`, so the list would push the modal open again and nothing would
     * scroll. And these selectors must stay SCOPED under `.modal-list`: the blanket
     * `.modal-layer.modal-list > *` rule that pins the furniture in place is (0,2,0), so
     * an unscoped `.modal-list-body` at (0,1,0) loses to it — which is exactly what
     * happened, and the wrapper grew to nine thousand pixels while the modal clipped it.
     */
    const source = stripComments(fs.readFileSync(cssPath, "utf8"));
    for (const name of ["modal-list-body", "modal-list-scroll"]) {
        const scoped = new RegExp("\\.modal-layer\\.modal-list\\s+\\." + name + "\\s*\\{[^}]*\\}");
        const block = (source.match(scoped) || [])[0];
        assert.ok(block, `.${name} must be scoped under .modal-layer.modal-list to win on specificity`);
        assert.ok(/min-height\s*:\s*0/.test(block), `.${name} needs min-height: 0:\n` + block);
    }
    const scroller = (source.match(/\.modal-layer\.modal-list\s+\.modal-list-scroll\s*\{[^}]*\}/) || [])[0];
    assert.ok(/overflow-y\s*:\s*auto/.test(scroller), "the results list is the thing that scrolls:\n" + scroller);
});

test("the workout screen's grid tracks cannot be widened by one long string", () => {
    /**
     * A grid track defaults to `auto`, which is min-content — so ONE nowrap line anywhere
     * inside the column sets the floor for the whole column. A superset header reading
     * "Тяга однієї руки в нижньому блоці · Віджимання від підлоги" has a min-content of
     * 393px; on a 360px phone that pushed .workout-stack to 469px, every card stretched
     * with it, and the sticky action bar went with them — putting «Завершити» off the
     * right edge of the screen with no way to scroll to it. A user could not finish their
     * workout.
     *
     * Clamping the TRACK is what makes that impossible: `minmax(0, 1fr)` lets the column
     * be narrower than its content, so a long string ellipsises instead of resizing the
     * page. `min-width: 0` on the individual text nodes is not enough on its own — the
     * containers have to allow the shrink too.
     */
    const source = stripComments(fs.readFileSync(cssPath, "utf8"));
    const mustClamp = ["workout-stack", "workout-exercise-list", "ss-rounds", "ss-member"];
    for (const name of mustClamp) {
        const rule = new RegExp("\\.(" + name + ")\\s*\\{[^}]*\\}");
        const block = (source.match(rule) || [])[0];
        assert.ok(block, `no .${name} rule found`);
        assert.ok(
            /display\s*:\s*grid/.test(block),
            `.${name} is expected to be a grid; if that changed, this guard needs rewriting:\n` + block
        );
        assert.ok(
            /grid-template-columns\s*:\s*minmax\(\s*0/.test(block),
            `.${name} is a grid on the workout screen and must clamp its track with `
            + `minmax(0, …). Without it a single long exercise name widens the whole page `
            + `and pushes «Завершити» off a phone screen:\n` + block
        );
    }
});
