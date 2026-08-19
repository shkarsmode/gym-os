// Presentation rules for Стрічка.
//
//   node --test lib/feed-ui.test.mjs
//
// These are pure functions, which is exactly why nothing else guards them: a wrong
// boundary here does not throw, it just prints a plausible-looking lie under someone's
// post. "вчора" on a workout done three days ago is the bug that started this file —
// the feed was ordered by the row's save time instead of the session's own date, and
// timeAgo faithfully rendered the wrong instant. Ordering is fixed on the server; this
// file pins the formatter so the two can never drift apart again.
//
// Every timeAgo/notificationBucket case passes an explicit `now`. Reading the wall
// clock would make the boundary cases flaky and untestable at exactly the boundary,
// which is where they break.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    timeAgo,
    notificationBucket,
    threadComments,
    urlBase64ToUint8Array,
    NOTIFICATION_ICONS,
    REPORT_REASON_LABELS,
    REPORT_TARGET_LABELS,
    FEED_SCOPE_TABS,
    PUSH_CATEGORIES
} from "./feed-ui.js";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Built from local components on purpose: notificationBucket reads the LOCAL calendar,
// so a UTC literal would test a different midnight than a user in Kyiv ever sees.
const NOW = new Date(2026, 7, 20, 14, 30, 0);
const ago = (ms) => new Date(NOW.getTime() - ms);

// ---------------------------------------------------------------- timeAgo

test("anything under a minute old reads «щойно»", () => {
    assert.equal(timeAgo(ago(0), NOW), "щойно");
    assert.equal(timeAgo(ago(59 * 1000), NOW), "щойно");
    assert.equal(timeAgo(ago(MINUTE - 1), NOW), "щойно");
});

test("a timestamp in the future reads «щойно» rather than a negative age", () => {
    // Phone clocks run ahead of the server's. `-3 хв` under a comment looks like a bug
    // to the user and there is nothing they can do about it.
    assert.equal(timeAgo(new Date(NOW.getTime() + 5 * MINUTE), NOW), "щойно");
});

test("minutes start exactly at the one-minute mark and floor, never round", () => {
    assert.equal(timeAgo(ago(MINUTE), NOW), "1 хв");
    assert.equal(timeAgo(ago(MINUTE + 59 * 1000), NOW), "1 хв", "59s past a minute must not round up to 2 хв");
    assert.equal(timeAgo(ago(14 * MINUTE), NOW), "14 хв");
    assert.equal(timeAgo(ago(HOUR - 1), NOW), "59 хв");
});

test("hours start exactly at the one-hour mark and run to the last millisecond of the day", () => {
    assert.equal(timeAgo(ago(HOUR), NOW), "1 год");
    assert.equal(timeAgo(ago(90 * MINUTE), NOW), "1 год", "an hour and a half must not read 2 год");
    assert.equal(timeAgo(ago(3 * HOUR), NOW), "3 год");
    assert.equal(timeAgo(ago(DAY - 1), NOW), "23 год");
});

test("«вчора» covers 24–48 hours old and nothing else", () => {
    assert.equal(timeAgo(ago(DAY), NOW), "вчора");
    assert.equal(timeAgo(ago(DAY + 13 * HOUR), NOW), "вчора");
    assert.equal(timeAgo(ago(2 * DAY - 1), NOW), "вчора");
    assert.equal(timeAgo(ago(2 * DAY), NOW), "2 дн", "48h exactly still said вчора");
});

test("a three-day-old session never reads «вчора»", () => {
    // The regression that shipped: the feed sorted by finishedAt, so a Monday session
    // saved on Wednesday was stamped Wednesday and told the user it happened вчора.
    // Whatever instant it is handed, the formatter must not compress three days into one.
    for (const hours of [72, 73, 84, 95]) {
        assert.equal(timeAgo(ago(hours * HOUR), NOW), "3 дн", `${hours}h old rendered as something other than 3 дн`);
    }
});

test("days run up to — but not including — a full week", () => {
    assert.equal(timeAgo(ago(6 * DAY), NOW), "6 дн");
    assert.equal(timeAgo(ago(7 * DAY - 1), NOW), "6 дн");
});

test("a week or older falls back to an absolute date", () => {
    // Past a week "N дн" stops being easier to read than the date itself, and unbounded
    // day counts ("34 дн") are what a stale feed looks like.
    const out = timeAgo(ago(7 * DAY), NOW);
    assert.match(out, /^13\b/, "the absolute fallback lost the day of month");
    assert.ok(!/щойно|хв|год|вчора|дн/.test(out), `still rendering a relative phrase: ${out}`);
    assert.match(timeAgo(ago(400 * DAY), NOW), /^16\b/, "a year-old post must still render a date, not 400 дн");
});

test("an ISO string is accepted, not just a Date", () => {
    // The feed hands over item.createdAt straight off the JSON payload.
    assert.equal(timeAgo(ago(2 * HOUR).toISOString(), NOW), "2 год");
});

test("an unparseable or missing timestamp renders as empty, never «Invalid Date»", () => {
    // Bug 2's neighbour: a completed workout with finishedAt = NULL reached the feed.
    // The card must degrade to no timestamp instead of printing NaN at the user.
    assert.equal(timeAgo(undefined, NOW), "");
    assert.equal(timeAgo("", NOW), "");
    assert.equal(timeAgo("not-a-date", NOW), "");
    assert.equal(timeAgo(new Date("nope"), NOW), "");
});

test("KNOWN BUG: a null timestamp renders as 1 January 1970 instead of empty", () => {
    // `new Date(null)` is the epoch, not an invalid date, so the Number.isFinite guard
    // lets it through and the card reads «1 січ.». JSON null is exactly what a row with
    // finishedAt = NULL serialises to — the same NULL that made bug 2 invisible.
    //
    // Asserted as-is rather than fixed: changing the guard to reject null is a one-line
    // product decision that belongs in its own commit, at which point this expectation
    // flips to "".
    assert.equal(timeAgo(null, NOW), "1 січ.");
});

// ---------------------------------------------------------------- notificationBucket

test("notifications are bucketed by the local calendar day, not by elapsed hours", () => {
    // 00:30 at night: a notification from two hours ago belongs to YESTERDAY's list even
    // though it is fresher than one from this morning would be.
    const justAfterMidnight = new Date(2026, 7, 20, 0, 30, 0);
    assert.equal(notificationBucket(new Date(2026, 7, 19, 22, 30, 0), justAfterMidnight), "earlier");
    assert.equal(notificationBucket(new Date(2026, 7, 20, 0, 5, 0), justAfterMidnight), "today");
});

test("local midnight itself is «today», the millisecond before it is «earlier»", () => {
    assert.equal(notificationBucket(new Date(2026, 7, 20, 0, 0, 0, 0), NOW), "today");
    assert.equal(notificationBucket(new Date(2026, 7, 19, 23, 59, 59, 999), NOW), "earlier");
});

test("a timestamp later today still buckets as «today»", () => {
    // Server clock skew puts notifications a few seconds in the future; they must stay
    // at the top of the list instead of falling into "earlier".
    assert.equal(notificationBucket(new Date(2026, 7, 20, 23, 0, 0), NOW), "today");
});

test("notificationBucket accepts an ISO string", () => {
    const iso = new Date(2026, 7, 20, 9, 0, 0).toISOString();
    assert.equal(notificationBucket(iso, NOW), "today");
});

// ---------------------------------------------------------------- threadComments

const comment = (id, parentId, body) => ({ id, parentId, body, author: { id: `u-${id}` } });

test("root comments keep the order the server sent them in", () => {
    // The server orders by createdAt asc; re-sorting here (or losing the order through a
    // Map) would shuffle a conversation every render.
    const roots = threadComments([comment("c3", null, "перший"), comment("c1", null, "другий"), comment("c2", null, "третій")]);
    assert.deepEqual(roots.map((r) => r.id), ["c3", "c1", "c2"]);
    assert.deepEqual(roots.map((r) => r.body), ["перший", "другий", "третій"]);
});

test("replies attach to their root, in order, and are not left at top level", () => {
    const roots = threadComments([
        comment("c1", null, "root one"),
        comment("c2", null, "root two"),
        comment("r1", "c1", "reply one"),
        comment("r2", "c1", "reply two"),
        comment("r3", "c2", "reply three")
    ]);
    assert.deepEqual(roots.map((r) => r.id), ["c1", "c2"], "a reply leaked into the root list");
    assert.deepEqual(roots[0].replies.map((r) => r.id), ["r1", "r2"]);
    assert.deepEqual(roots[1].replies.map((r) => r.id), ["r3"]);
});

test("every root carries a replies array even with no replies", () => {
    // The renderer maps over root.replies unconditionally.
    const [root] = threadComments([comment("c1", null, "самотній")]);
    assert.deepEqual(root.replies, []);
});

test("a reply whose parent was deleted survives as a root instead of vanishing", () => {
    // Moderation hard-deletes a root comment; its replies are still someone's messages
    // and dropping them silently loses user content.
    const roots = threadComments([comment("c1", null, "живий"), comment("orphan", "gone-forever", "сирота")]);
    assert.deepEqual(roots.map((r) => r.id), ["c1", "orphan"]);
    assert.equal(roots[1].body, "сирота");
    assert.deepEqual(roots[1].replies, [], "a promoted orphan must be a usable root node");
});

test("a reply pointing at another reply is kept, not dropped", () => {
    // The API collapses replies-to-replies onto the root before storing, but an older row
    // or a racing client can still send one. It must remain visible.
    const roots = threadComments([comment("c1", null, "root"), comment("r1", "c1", "reply"), comment("r2", "r1", "reply to a reply")]);
    const everyId = [...roots.map((r) => r.id), ...roots.flatMap((r) => r.replies.map((x) => x.id))];
    assert.ok(everyId.includes("r2"), "a nested reply disappeared from the thread entirely");
});

test("an empty, missing or null comment list yields an empty thread", () => {
    // The detail view calls this before the comments request resolves.
    assert.deepEqual(threadComments([]), []);
    assert.deepEqual(threadComments(undefined), []);
    assert.deepEqual(threadComments(null), []);
});

test("threading does not mutate the caller's comment objects", () => {
    // The same array is re-threaded on every re-render; writing `replies` onto the source
    // rows would make replies accumulate duplicates each time.
    const source = [comment("c1", null, "root"), comment("r1", "c1", "reply")];
    threadComments(source);
    threadComments(source);
    const roots = threadComments(source);
    assert.ok(!("replies" in source[0]), "the input row was mutated");
    assert.deepEqual(roots[0].replies.map((r) => r.id), ["r1"], "replies duplicated across renders");
});

// ---------------------------------------------------------------- urlBase64ToUint8Array

// A VAPID public key is 65 bytes (0x04 + two 32-byte coordinates) base64url-encoded to
// 87 characters, so it exercises the one-character padding case and both -/_ letters.
const VAPID_KEY = "BAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qhqK-2vcTL0tng5-71_AMKERgfJi00O0JJUFdeZWxzeoGIj5adpKuyucA";

test("a VAPID key converts to the exact 65 bytes the browser expects", () => {
    // pushManager.subscribe rejects a key of the wrong length with an opaque
    // InvalidAccessError, so a one-byte slip here reads as "push is broken".
    const bytes = urlBase64ToUint8Array(VAPID_KEY);
    assert.ok(bytes instanceof Uint8Array);
    assert.equal(bytes.length, 65);
    assert.equal(bytes[0], 0x04, "an uncompressed EC point must start with 0x04");
    // Cross-checked against Node's own decoder rather than a copy of this function's logic.
    assert.deepEqual(Array.from(bytes), Array.from(Buffer.from(VAPID_KEY, "base64url")));
});

test("all three padding cases decode correctly", () => {
    // The key length modulo 4 decides how many "=" have to be added back; getting the
    // formula wrong throws only for some keys, which is how it survives a smoke test.
    assert.deepEqual(Array.from(urlBase64ToUint8Array("QUJD")), [0x41, 0x42, 0x43]); // 0 padding
    assert.deepEqual(Array.from(urlBase64ToUint8Array("QUI")), [0x41, 0x42]); // 1 padding
    assert.deepEqual(Array.from(urlBase64ToUint8Array("QQ")), [0x41]); // 2 padding
    assert.deepEqual(Array.from(urlBase64ToUint8Array("")), []);
});

test("the url-safe alphabet is translated back to standard base64", () => {
    // "-" and "_" are the whole reason this helper exists; atob rejects them outright.
    assert.deepEqual(Array.from(urlBase64ToUint8Array("-_-_")), [0xfb, 0xff, 0xbf]);
    assert.deepEqual(Array.from(urlBase64ToUint8Array("_w")), [0xff]);
    assert.ok(VAPID_KEY.includes("-") && VAPID_KEY.includes("_"), "the sample key stopped covering the url-safe letters");
});

// ---------------------------------------------------------------- constants

test("push categories match the product decision about what is on by default", () => {
    // Mirrors PUSH_DEFAULTS on the server (src/modules/feed/feed.constants.ts). If the two
    // disagree, the settings screen shows a switch in a position the server ignores.
    const defaults = Object.fromEntries(PUSH_CATEGORIES.map((c) => [c.key, c.defaultOn]));
    assert.deepEqual(defaults, {
        comment: true,
        reply: true,
        reaction: true,
        moderation: true,
        achievement: false,
        team: false
    });
});

test("every push category has a unique key and a Ukrainian label", () => {
    // A duplicated key would make two switches write the same preference and one of them
    // would appear to do nothing.
    const keys = PUSH_CATEGORIES.map((c) => c.key);
    assert.equal(new Set(keys).size, keys.length, "duplicate push category key");
    for (const category of PUSH_CATEGORIES) {
        assert.ok(category.label && category.label.trim().length > 0, `${category.key} has no label`);
        assert.equal(typeof category.defaultOn, "boolean", `${category.key}.defaultOn must be a real boolean`);
    }
});

test("every notification type the server emits has an icon", () => {
    // NOTIFICATION_TYPES in src/modules/feed/feed.constants.ts. A missing entry silently
    // falls back to a generic bell, so nothing fails — the list just stops being scannable.
    for (const type of ["comment", "reply", "reaction", "mention", "achievement", "team", "moderation"]) {
        assert.ok(NOTIFICATION_ICONS[type], `no icon for notification type "${type}"`);
    }
});

test("every report reason the API accepts has a label", () => {
    // REPORT_REASONS on the server. Without a label the moderation queue prints the raw
    // enum ("unsafe") at a moderator.
    assert.deepEqual(Object.keys(REPORT_REASON_LABELS).sort(), ["abuse", "other", "spam", "unsafe"]);
    for (const label of Object.values(REPORT_REASON_LABELS)) {
        assert.ok(label && !/^[a-z]+$/.test(label), `"${label}" looks like a raw enum value`);
    }
});

test("every reportable target type has a label", () => {
    // FEED_TARGET_TYPES on the server: the three feed item kinds plus comments.
    assert.deepEqual(Object.keys(REPORT_TARGET_LABELS).sort(), ["achievement", "comment", "record", "workout"]);
    assert.equal(REPORT_TARGET_LABELS.workout, "Тренування");
    assert.equal(REPORT_TARGET_LABELS.comment, "Коментар");
});

test("the feed tabs are exactly the scopes the API accepts, in reading order", () => {
    // FEED_SCOPES on the server rejects anything else with a 400, so a typo here breaks
    // the tab rather than showing an empty feed.
    assert.deepEqual(FEED_SCOPE_TABS.map(([value]) => value), ["team", "records", "achievements", "mine"]);
    assert.deepEqual(FEED_SCOPE_TABS.map(([, label]) => label), ["Команда", "Рекорди", "Досягнення", "Мої"]);
});
