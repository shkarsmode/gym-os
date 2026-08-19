// Guards the release metadata in changelog.js.
//
//   node --test lib/changelog.test.mjs
//
// House rule in this project: every user-facing change bumps APP_VERSION and prepends a
// CHANGELOG entry. Nothing enforced it. The failure mode is quiet — a version that no
// longer matches package.json, a "Що нового" modal announcing a release the user is not
// running, or an entry with a typo'd type that renders with no label and no icon. All of
// it looks fine locally and only shows up in front of users.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { APP_VERSION, CHANGELOG, changelogTagLabels, changelogTagIcons } from "./changelog.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8"));

const SEMVER = /^\d+\.\d+\.\d+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const KNOWN_TYPES = ["feature", "fix", "improvement"];

// "0.10.0" sorts BEFORE "0.9.1" as a string. Comparing versions lexically would have
// declared the list out of order the moment the project crossed 0.9 — and, worse, would
// pass again once it left that range, so the rule has to be numeric from the start.
const versionParts = (v) => v.split(".").map(Number);
const compareVersions = (a, b) => {
    const left = versionParts(a);
    const right = versionParts(b);
    for (let i = 0; i < 3; i += 1) {
        if (left[i] !== right[i]) return left[i] - right[i];
    }
    return 0;
};

test("APP_VERSION is a plain x.y.z version", () => {
    // The value is compared against a stored string (gymos-last-seen-version) and shown
    // raw in the UI, so anything with a "v" prefix or a suffix silently re-fires the
    // what's-new modal for everyone.
    assert.match(APP_VERSION, SEMVER);
});

test("APP_VERSION matches the version in package.json", () => {
    assert.equal(
        APP_VERSION,
        pkg.version,
        "package.json and changelog.js disagree — one of the two bumps was forgotten"
    );
});

test("APP_VERSION is the version of the newest changelog entry", () => {
    // The "Що нового" modal renders CHANGELOG[0]. If it drifts ahead of APP_VERSION the
    // user reads about a release they do not have; behind it, the release ships unnoticed.
    assert.equal(CHANGELOG[0].version, APP_VERSION);
});

test("the changelog is not empty", () => {
    assert.ok(CHANGELOG.length > 0, "an empty changelog would render an empty what's-new modal");
});

test("versions run strictly downwards with no repeats", () => {
    // The list is rendered in array order and the newest entry is taken as CHANGELOG[0],
    // so a misplaced or duplicated version breaks both the timeline and the modal. A
    // duplicate is the classic parallel-session collision: two people take the same patch
    // number, and git merges both entries without complaint.
    for (let i = 1; i < CHANGELOG.length; i += 1) {
        const newer = CHANGELOG[i - 1].version;
        const older = CHANGELOG[i].version;
        assert.ok(
            compareVersions(newer, older) > 0,
            `${newer} is listed above ${older} but is not greater than it`
        );
    }
});

test("dates never move forward as you read down the list", () => {
    // Equal dates are fine — several patches ship in one day — but a later date below an
    // earlier one means an entry was inserted in the wrong place, and the timeline then
    // shows the project travelling backwards in time.
    for (let i = 1; i < CHANGELOG.length; i += 1) {
        const above = CHANGELOG[i - 1];
        const below = CHANGELOG[i];
        assert.ok(
            below.date <= above.date,
            `${below.version} (${below.date}) is dated after ${above.version} (${above.date})`
        );
    }
});

for (const entry of CHANGELOG) {
    test(`${entry.version}: the entry is complete and renderable`, () => {
        assert.match(entry.version, SEMVER, "version is not x.y.z");
        assert.match(entry.date, ISO_DATE, "date is not yyyy-mm-dd");

        // ISO-shaped but impossible dates ("2026-06-31") sort correctly and pass the regex,
        // then render as "Invalid Date" wherever the timeline formats them.
        assert.equal(
            new Date(`${entry.date}T00:00:00Z`).toISOString().slice(0, 10),
            entry.date,
            "date is well-formed but not a real calendar day"
        );

        assert.equal(typeof entry.title, "string");
        assert.ok(entry.title.trim().length > 0, "the timeline card would have a blank heading");
        assert.ok(Array.isArray(entry.items) && entry.items.length > 0, "an entry with no items says nothing");
    });

    test(`${entry.version}: every item has a known type and real text`, () => {
        entry.items.forEach((item, index) => {
            const where = `${entry.version} item #${index + 1}`;
            assert.ok(
                KNOWN_TYPES.includes(item.type),
                `${where}: type "${item.type}" is not one of ${KNOWN_TYPES.join("/")}`
            );
            assert.equal(typeof item.text, "string", `${where}: text is missing`);
            assert.ok(item.text.trim().length > 0, `${where}: text is blank`);
        });
    });
}

test("every type used in the changelog has a Ukrainian label", () => {
    // A type with no label renders an empty tag next to the bullet — visible to users,
    // invisible in review.
    for (const entry of CHANGELOG) {
        for (const item of entry.items) {
            const label = changelogTagLabels[item.type];
            assert.equal(typeof label, "string", `no label for type "${item.type}" (${entry.version})`);
            assert.ok(label.trim().length > 0, `blank label for type "${item.type}"`);
        }
    }
});

test("every type used in the changelog has an icon", () => {
    for (const entry of CHANGELOG) {
        for (const item of entry.items) {
            const icon = changelogTagIcons[item.type];
            assert.equal(typeof icon, "string", `no icon for type "${item.type}" (${entry.version})`);
            assert.ok(icon.trim().length > 0, `blank icon for type "${item.type}"`);
        }
    }
});

test("the tag label and icon maps cover exactly the same types", () => {
    // They are consulted separately when rendering a tag, so one map gaining a type
    // without the other produces a label with no icon (or vice versa) for the next
    // release that uses it.
    assert.deepEqual(Object.keys(changelogTagLabels).sort(), Object.keys(changelogTagIcons).sort());
});

test("the label and icon maps carry no types the changelog can use undeclared", () => {
    // KNOWN_TYPES is the contract this file enforces on items; if changelog.js grows a
    // fourth tag, this test is the reminder to widen the contract deliberately rather
    // than letting an unreviewed type slip into entries.
    assert.deepEqual(Object.keys(changelogTagLabels).sort(), [...KNOWN_TYPES].sort());
});
