// Behaviour spec for the shared formatting helpers.
//
//   node --test lib/format.test.mjs
//
// Everything here renders straight into the DOM, so a regression is not a crash —
// it is a plausible-looking wrong number or a stray "NaN" in front of a user. The
// exact Ukrainian output is pinned on purpose: the group separator is a NO-BREAK
// SPACE (U+00A0) and the decimal mark is a comma, and a locale-data change that
// swaps either one is invisible in a screenshot but breaks copy-paste, CSV export
// and every string comparison downstream.
//
// Nothing below reads the clock, and every Date is built from local components so
// the file passes under any TZ. The one place UTC parsing genuinely leaks into the
// result is called out and derived from the host offset rather than assumed.
//
// Several tests are labelled KNOWN BUG. They assert what the code does TODAY so a
// refactor cannot change it by accident. Fixing one is a product change: flip the
// assertion in the same commit.

import assert from "node:assert/strict";
import { test } from "node:test";

import { escapeHtml, number, dateInput, formatDate, shortDate, seconds, splitCsv, unique, imageUrl } from "./format.js";

const NBSP = " ";

// ---------------------------------------------------------------- escapeHtml

test("escapeHtml neutralises the five characters that let user text break out of markup", () => {
    // Exercise names, notes and feed comments are interpolated into template strings.
    // Missing any one of these turns a comment box into stored XSS.
    assert.equal(escapeHtml(`<img src=x onerror="alert('x')">`), "&lt;img src=x onerror=&quot;alert(&#039;x&#039;)&quot;&gt;");
});

test("escapeHtml escapes the ampersand first, so entities are not double-escaped", () => {
    // If "&" were replaced after "<", the "&" this function just produced would be
    // escaped again and the page would literally show "&amp;lt;".
    assert.equal(escapeHtml("<"), "&lt;");
    assert.equal(escapeHtml("&"), "&amp;");
    assert.equal(escapeHtml("&lt;"), "&amp;lt;", "a user typing an entity must see it as text, escaped exactly once");
});

test("escapeHtml renders a missing value as empty text, never the word undefined", () => {
    assert.equal(escapeHtml(null), "");
    assert.equal(escapeHtml(undefined), "");
});

test("escapeHtml keeps falsy-but-real values, so a zero never disappears", () => {
    // The guard is `?? ""`, not `|| ""`. With `||` a set of 0 reps would render blank.
    assert.equal(escapeHtml(0), "0");
    assert.equal(escapeHtml(false), "false");
});

// ---------------------------------------------------------------- number

test("number groups thousands with a no-break space and marks decimals with a comma", () => {
    assert.equal(number(1000), `1${NBSP}000`);
    assert.equal(number(1234567.89), `1${NBSP}234${NBSP}567,9`);
    assert.equal(number(12345), `12${NBSP}345`);
});

test("number keeps at most one decimal and rounds half away from zero", () => {
    // Volume totals are summed as floats; the rendered value is what a user compares
    // against yesterday's, so the tie-break at .5 has to stay put.
    assert.equal(number(1.25), "1,3");
    assert.equal(number(2.45), "2,5");
    assert.equal(number(0.05), "0,1");
    assert.equal(number(999.95), `1${NBSP}000`, "rounding must carry into the grouped part");
});

test("number collapses a value below half a tenth to a bare zero", () => {
    assert.equal(number(0.04), "0");
});

test("number degrades unusable input to 0 instead of leaking NaN to the screen", () => {
    // Peer rows from the windowed payload arrive without set-level fields, so these
    // helpers are routinely handed undefined. "NaN кг" on a card is the failure mode.
    assert.equal(number(null), "0");
    assert.equal(number(undefined), "0");
    assert.equal(number(NaN), "0");
    assert.equal(number("abc"), "0");
    assert.equal(number({}), "0");
});

test("number formats a numeric string, because form inputs hand over strings", () => {
    assert.equal(number("1500"), `1${NBSP}500`);
});

test("number renders a negative total with an ASCII hyphen-minus, not a typographic one", () => {
    // The weight-delta tag (.set-delta) compares this output and CSS-classes on it;
    // a U+2212 would also break any code that strips "-" before parsing.
    assert.equal(number(-1234.5), `-1${NBSP}234,5`);
    assert.equal(number(-1234.5)[0], "-");
});

test("KNOWN BUG: a small negative value renders as -0", () => {
    // `Number(-0.04) || 0` keeps -0.04, and rounding to one decimal yields negative
    // zero. A body-weight or delta chip then reads "-0 кг". Fix by normalising
    // (`value + 0` after rounding, or `Object.is(x, -0)`) and flip this assertion.
    assert.equal(number(-0.04), "-0");
});

test("KNOWN BUG: an infinite value renders as the infinity glyph", () => {
    // Infinity is truthy, so the `|| 0` guard does not catch it. A divide-by-zero
    // upstream (average per set with zero sets) puts "∞" on the card.
    assert.equal(number(Infinity), "∞");
});

// ---------------------------------------------------------------- dateInput

test("dateInput zero-pads month and day so keys sort as text", () => {
    // This string is a map key and an <input type=date> value; an unpadded "2026-1-5"
    // would both break the picker and mis-sort every by-day grouping.
    assert.equal(dateInput(new Date(2026, 0, 5)), "2026-01-05");
    assert.equal(dateInput(new Date(2026, 11, 31)), "2026-12-31");
});

test("dateInput reads the LOCAL calendar day, so a late-evening session keeps its own date", () => {
    // A 23:30 workout must not slide onto the next day the way toISOString() would
    // push it. This is the same class of mistake as ordering the feed by finishedAt.
    assert.equal(dateInput(new Date(2026, 7, 19, 23, 30)), "2026-08-19");
    assert.equal(dateInput(new Date(2026, 7, 19, 0, 0)), "2026-08-19");
});

test("dateInput parses a bare ISO date string as UTC midnight, which shifts the day west of Greenwich", () => {
    // `new Date("2026-08-19")` is UTC midnight by spec, while getDate() is local — so
    // the round trip is lossy for any host behind UTC. Derived from the host offset
    // rather than assumed, so this documents the trap without pinning a timezone.
    const westOfGreenwich = new Date("2026-08-19T00:00:00Z").getTimezoneOffset() > 0;
    assert.equal(dateInput("2026-08-19"), westOfGreenwich ? "2026-08-18" : "2026-08-19");
});

test("KNOWN BUG: dateInput turns an unparseable value into the key NaN-NaN-NaN", () => {
    // No guard at all, so a corrupt row silently becomes a real-looking bucket key
    // that groups every bad date together instead of being rejected.
    assert.equal(dateInput("not a date"), "NaN-NaN-NaN");
    assert.equal(dateInput(undefined), "NaN-NaN-NaN");
});

// ---------------------------------------------------------------- formatDate

test("formatDate renders day, abbreviated Ukrainian month and the year suffix", () => {
    assert.equal(formatDate(new Date(2026, 7, 19)), "19 серп. 2026 р.");
});

test("formatDate uses the abbreviated Ukrainian month name for all twelve months", () => {
    // Locale data ships with the runtime, so these can change under the app without
    // any code change here. They are read aloud in the feed and the day sheet.
    const months = Array.from({ length: 12 }, (_, index) => formatDate(new Date(2026, index, 1)));
    assert.deepEqual(months, [
        "1 січ. 2026 р.",
        "1 лют. 2026 р.",
        "1 бер. 2026 р.",
        "1 квіт. 2026 р.",
        "1 трав. 2026 р.",
        "1 черв. 2026 р.",
        "1 лип. 2026 р.",
        "1 серп. 2026 р.",
        "1 вер. 2026 р.",
        "1 жовт. 2026 р.",
        "1 лист. 2026 р.",
        "1 груд. 2026 р."
    ]);
});

test("formatDate never leaks a time of day into the rendered date", () => {
    assert.equal(formatDate(new Date(2026, 7, 19, 23, 59, 59)), formatDate(new Date(2026, 7, 19, 0, 0, 0)));
});

test("formatDate renders a missing date as an em dash", () => {
    // The placeholder is U+2014, matched by CSS and by tests elsewhere — not a hyphen.
    assert.equal(formatDate(""), "—");
    assert.equal(formatDate(null), "—");
    assert.equal(formatDate(undefined), "—");
    assert.equal(formatDate(null).codePointAt(0), 0x2014, "the placeholder must stay an em dash");
});

test("formatDate treats the epoch timestamp 0 as missing", () => {
    // The guard is truthiness, so a genuine 1 Jan 1970 timestamp renders as the dash
    // rather than a date. Harmless today because no real row carries it — but any
    // code path that starts passing raw millisecond timestamps inherits this.
    assert.equal(formatDate(0), "—");
});

test("KNOWN BUG: formatDate throws on an unparseable value instead of falling back to the dash", () => {
    // A non-empty garbage string passes the truthiness guard and reaches Intl, which
    // throws RangeError. One bad row takes down the whole render pass — exactly the
    // failure shape as the peer-summary crash in the scoring kernel.
    assert.throws(() => formatDate("not a date"), RangeError);
    assert.throws(() => formatDate(new Date("not a date")), RangeError);
});

// ---------------------------------------------------------------- shortDate

test("shortDate drops the year and keeps day plus abbreviated month", () => {
    assert.equal(shortDate(new Date(2026, 4, 3)), "3 трав.");
    assert.equal(shortDate(new Date(2026, 7, 19)), "19 серп.");
});

test("KNOWN BUG: shortDate renders a missing date as 1 січ. instead of a placeholder", () => {
    // Unlike formatDate there is no falsy guard, so `new Date(null)` is the epoch and
    // a workout with no date reads as a real session on 1 January. A feed row that
    // silently invents a date is worse than one that shows a dash.
    assert.equal(shortDate(null), "1 січ.");
    assert.equal(shortDate(0), "1 січ.");
});

test("KNOWN BUG: shortDate throws on undefined and on an unparseable string", () => {
    assert.throws(() => shortDate(undefined), RangeError);
    assert.throws(() => shortDate("not a date"), RangeError);
});

// ---------------------------------------------------------------- seconds

test("seconds renders M:SS with the seconds zero-padded and the minutes bare", () => {
    // The rest timer is read at a glance mid-set; "10:5" would be misread as ten
    // minutes five seconds is fine, but "10:05" is the only unambiguous form.
    assert.equal(seconds(0), "0:00");
    assert.equal(seconds(9), "0:09");
    assert.equal(seconds(59), "0:59");
    assert.equal(seconds(60), "1:00");
    assert.equal(seconds(605), "10:05");
});

test("seconds keeps counting in minutes past an hour instead of rolling over", () => {
    // Deliberate: a long rest reads as 60:00, not 1:00:00, so the timer chip never
    // changes width class mid-count.
    assert.equal(seconds(3599), "59:59");
    assert.equal(seconds(3600), "60:00");
});

test("seconds accepts a numeric string, because stored durations are not always numbers", () => {
    assert.equal(seconds("90"), "1:30");
});

test("KNOWN BUG: a negative value renders as -1:-5 rather than a signed duration", () => {
    // The overtime timer only looks right because the CALLER negates first
    // (timerDisplayValue: `+${seconds(-remaining)}`). That guard is the only thing
    // between this function and "-1:-5" on screen, so it must not be removed.
    assert.equal(seconds(-5), "-1:-5");
    assert.equal(seconds(-65), "-2:-5");
});

test("KNOWN BUG: a fractional value leaks float noise into the seconds field", () => {
    // The caller rounds before calling. Anything that stops rounding renders
    // "1:30.700000000000003" in the timer chip.
    assert.equal(seconds(90.7), "1:30.700000000000003");
});

test("KNOWN BUG: seconds renders undefined as NaN:NaN but null as 0:00", () => {
    // null coerces to 0 through the arithmetic; undefined does not. A timer that has
    // not been initialised therefore prints NaN:NaN instead of a zeroed clock.
    assert.equal(seconds(null), "0:00");
    assert.equal(seconds(undefined), "NaN:NaN");
});

// ---------------------------------------------------------------- splitCsv

test("splitCsv trims each entry and drops the blanks a trailing comma leaves behind", () => {
    // Aliases and secondary muscles are typed by hand in the exercise editor; an
    // empty alias would match every search query.
    assert.deepEqual(splitCsv(" жим лежачи , ,  груди  "), ["жим лежачи", "груди"]);
    assert.deepEqual(splitCsv("a,b,"), ["a", "b"]);
});

test("splitCsv returns an empty array for a missing value", () => {
    // Callers iterate the result directly, so returning undefined would throw.
    assert.deepEqual(splitCsv(null), []);
    assert.deepEqual(splitCsv(undefined), []);
    assert.deepEqual(splitCsv(""), []);
});

test("splitCsv keeps a single entry that has no comma at all", () => {
    assert.deepEqual(splitCsv("присідання"), ["присідання"]);
});

// ---------------------------------------------------------------- unique

test("unique removes duplicates and sorts the result alphabetically", () => {
    // Feeds the muscle and equipment filter dropdowns, which must be stable between
    // renders or the selected option jumps.
    assert.deepEqual(unique(["груди", "спина", "груди"]), ["груди", "спина"]);
});

test("unique returns a new array and leaves the input untouched", () => {
    // .sort() mutates in place; the spread is what protects the caller's array,
    // which is usually a live .map() over state.database.exercises.
    const input = ["c", "a", "b"];
    const result = unique(input);
    assert.deepEqual(input, ["c", "a", "b"]);
    assert.notEqual(result, input);
});

test("unique handles an empty list", () => {
    assert.deepEqual(unique([]), []);
});

test("KNOWN BUG: unique sorts numbers as text", () => {
    // Default .sort() compares stringified values, so any numeric list (rep counts,
    // years) comes back in the wrong order. Only safe today because every caller
    // passes strings.
    assert.deepEqual(unique([3, 20, 100]), [100, 20, 3]);
});

// ---------------------------------------------------------------- imageUrl

test("imageUrl accepts http and https and trims surrounding whitespace", () => {
    // Pasted avatar and gif URLs almost always arrive with a trailing space.
    assert.equal(imageUrl("  https://cdn.example/a.png  "), "https://cdn.example/a.png");
    assert.equal(imageUrl("http://cdn.example/a.png"), "http://cdn.example/a.png");
});

test("imageUrl matches the scheme case-insensitively", () => {
    assert.equal(imageUrl("HTTPS://cdn.example/a.png"), "HTTPS://cdn.example/a.png");
});

test("imageUrl rejects every scheme that is not http(s), so a src cannot execute", () => {
    // This is the only guard between a user-supplied avatarUrl and an <img src>.
    // Rejecting means returning "" — callers fall back to initials.
    assert.equal(imageUrl("javascript:alert(1)"), "");
    assert.equal(imageUrl("data:image/svg+xml,<svg onload=alert(1)>"), "");
    assert.equal(imageUrl("//cdn.example/a.png"), "", "a protocol-relative URL is not accepted");
    assert.equal(imageUrl("/local/a.png"), "");
});

test("imageUrl returns an empty string for a missing value", () => {
    assert.equal(imageUrl(null), "");
    assert.equal(imageUrl(undefined), "");
    assert.equal(imageUrl(""), "");
});

test("imageUrl does not accept a scheme hidden mid-string", () => {
    // The regex is anchored; without the ^ a value like "x javascript:..." with an
    // http fragment later would pass through.
    assert.equal(imageUrl("not-a-url https://cdn.example/a.png"), "");
});
