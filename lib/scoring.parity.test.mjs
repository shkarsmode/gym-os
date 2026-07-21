// Parity test for the scoring kernel.
//
//   TZ=Europe/Kyiv node --test lib/scoring.parity.test.mjs
//
// The kernel decides every number a user sees about their progress. Nothing in this
// repo will tell you if one of them changes — the UI renders a different number and
// looks entirely plausible. This file is the only thing standing between a refactor
// and somebody's level quietly moving.
//
// scoring.golden.json is a snapshot of the kernel's output over scoring.fixture.js,
// frozen at the moment of extraction. A diff means behaviour changed. That is
// sometimes correct and intended — in which case regenerate the snapshot IN ITS OWN
// COMMIT, with the reason in the message, so the change is reviewable rather than
// buried inside an unrelated refactor.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { scoreAll, oneRepMax, round, dayDiff } from "./scoring.js";
import { FIXTURE, NOW } from "./scoring.fixture.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(fs.readFileSync(path.join(here, "scoring.golden.json"), "utf8"));

// The fixture's expected output was frozen under Europe/Kyiv. startOfDay, startOfWeek,
// getHours and the streak arithmetic all read the host's local calendar, so running
// this suite anywhere else compares against numbers that were never valid here.
// Failing loudly beats a red diff that sends someone hunting a logic bug.
test("the host timezone matches the one the snapshot was frozen under", () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offsetMinutes = new Date("2026-07-21T12:00:00Z").getTimezoneOffset();
    assert.equal(
        offsetMinutes,
        -180,
        `Expected a UTC+3 summer offset (Europe/Kyiv), got ${zone} with offset ${offsetMinutes}. ` +
        "Run with TZ=Europe/Kyiv. This is the same divergence that would make the backend " +
        "and the browser disagree about streaks and weekly totals."
    );
});

const result = scoreAll(FIXTURE);

test("every user in the snapshot is still scored", () => {
    assert.deepEqual(Object.keys(result.users).sort(), Object.keys(golden.users).sort());
});

for (const userId of Object.keys(golden.users)) {
    const expected = golden.users[userId];

    test(`${userId}: XP and level are unchanged`, () => {
        const actual = result.users[userId];
        assert.equal(actual.xp, expected.xp, "total XP moved");
        assert.equal(actual.level.level ?? actual.level, expected.level, "level moved");
    });

    test(`${userId}: personal records are unchanged`, () => {
        const actual = result.users[userId].records.map((x) => ({
            exerciseId: x.exerciseId,
            date: x.date,
            estimatedOneRepMax: x.estimatedOneRepMax,
            weight: x.weight,
            repetitions: x.repetitions
        }));
        assert.deepEqual(actual, expected.records);
    });

    test(`${userId}: unlocked achievements and their dates are unchanged`, () => {
        const actual = result.users[userId].achievements
            .map((a) => ({ id: a.id, unlockedAt: a.unlockedAt }))
            .sort((a, b) => (a.id < b.id ? -1 : 1));
        assert.deepEqual(actual, expected.achievements);
    });

    test(`${userId}: all 20 stats fields are unchanged`, () => {
        assert.deepEqual(result.users[userId].stats, expected.stats);
    });
}

test("team aggregates are unchanged", () => {
    assert.deepEqual(result.team, golden.team);
});

// ---------------------------------------------------------------- targeted invariants
//
// The snapshot catches any change. These name the specific behaviours that are easy to
// break and hard to notice, so a failure says what broke rather than just "a number moved".

test("a tied 1RM resolves to the LATER date", () => {
    // recordsFor compares with a strict `>`, so the first row visited wins, and callers
    // feed newest-first. Sorting the input ascending instead would silently move this
    // date — and with it first-pr / pr-25 unlock dates and the XP ledger.
    const squat = result.users.u1.records.find((r) => r.exerciseId === "ex-squat");
    assert.equal(squat.date, "2026-07-18", "the tie-break flipped to the earlier workout");
});

test("warmup sets never produce a personal record", () => {
    // The fixture has a 200kg warmup single and a 90kg working set of five.
    const bench = result.users.u3.records.find((r) => r.exerciseId === "ex-bench");
    assert.equal(bench.weight, 90, "a warmup set was counted as a record");
});

test("incomplete sets contribute no volume, but warmups do", () => {
    // Two distinct rules that are easy to conflate: a warmup set is excluded from
    // RECORDS but still counts toward VOLUME, while an incomplete set counts toward
    // neither.
    //
    // u3's completed sets: 50x10 (missing exercise) + 200x1 (warmup) + 90x5 + 85x5
    // = 500 + 200 + 450 + 425 = 1575. The same workout carries a 300kg single that was
    // never completed; if it leaked in the total would be 1875.
    assert.equal(result.users.u3.stats.totalVolume, 1575);
});

test("a workout referencing a deleted exercise still scores", () => {
    const missing = result.users.u3.records.find((r) => r.exerciseId.startsWith("missing-"));
    assert.ok(missing, "the missing-exercise placeholder path stopped working");
});

test("a cardio-only workout with no exercises does not throw and counts its minutes", () => {
    assert.ok(result.users.u1.stats.cardioMinutes >= 45);
});

test("planned and active workouts are excluded from completed-only aggregates", () => {
    const stats = result.users.u3.stats;
    assert.ok(stats.totalWorkouts > stats.completedWorkouts, "non-completed workouts vanished from totalWorkouts");
    assert.ok(!result.users.u3.records.some((r) => r.weight === 999), "a planned workout produced a record");
});

test("a manual duration override wins over the clock", () => {
    // w-override ran two hours by the clock and declares 35 minutes.
    assert.ok(result.users.u3.stats.averageDurationMinutes < 120);
});

test("an undated idea awards no XP", () => {
    // xpEvents ends with .filter(event => event.date). Dropping that filter would
    // silently inflate totals for anyone with an undated record.
    assert.ok(!result.users.u2.xpLedger.some((e) => e.kind === "idea"));
});

test("the XP ledger carries all five event kinds", () => {
    const kinds = new Set(result.users.u1.xpLedger.map((e) => e.kind));
    for (const kind of ["workout", "record", "achievement", "idea", "exercise"]) {
        assert.ok(kinds.has(kind), `the "${kind}" XP event kind disappeared`);
    }
});

test("the XP ledger carries no rendered UI text", () => {
    // The kernel must stay presentation-free, or a wording change becomes a backend
    // deploy and the two runtimes can disagree on a string.
    for (const event of result.users.u1.xpLedger) {
        assert.ok(!("label" in event), "a rendered label leaked back into the kernel");
        assert.ok(!("icon" in event), "an icon name leaked back into the kernel");
    }
});

test("KNOWN BUG: a seven-day streak across the DST boundary does not unlock streak-7", () => {
    // u2 trained 26 March to 1 April 2026 — seven consecutive days. Europe/Kyiv springs
    // forward on 29 March, making that local day 23 hours;
    // consecutiveDaysUnlockDate divides by 86400000 and tests `gap === 1`, gets 0.9583,
    // and resets the run.
    //
    // Asserted as-is so the parity test proves the extraction changed nothing. Fixing
    // the arithmetic grants this badge to real users who lack it today, which is a
    // product decision and belongs in its own commit — at which point this assertion
    // flips and the snapshot is regenerated.
    //
    // In UTC the same gap is exactly 1, so a backend running in UTC would consider this
    // unlocked while the browser does not.
    const unlocked = result.users.u2.achievements.some((a) => a.id === "streak-7");
    assert.equal(unlocked, false, "DST streak behaviour changed — intended? then regenerate the snapshot");
});

// ---------------------------------------------------------------- primitives

test("oneRepMax is stable at the boundaries that feed every PR", () => {
    assert.equal(oneRepMax(100, 1), 100, "a single rep must return the load unchanged");
    assert.equal(oneRepMax(0, 5), 0);
    assert.equal(oneRepMax(100, 0), 0);
    assert.equal(oneRepMax(-50, 5), 0);
    // Reps are capped at 12: 15 reps must score identically to 12.
    assert.equal(oneRepMax(100, 15), oneRepMax(100, 12), "the 12-rep cap stopped applying");
    // Never below the load actually lifted.
    assert.ok(oneRepMax(100, 5) >= 100);
});

test("round matches the half-up behaviour the totals were built on", () => {
    assert.equal(round(1.25, 1), 1.3);
    assert.equal(round(1.24, 1), 1.2);
    assert.equal(round(-0, 1), 0);
    assert.equal(round("abc", 1), 0);
});

test("dayDiff counts calendar days, not elapsed hours", () => {
    assert.equal(dayDiff(new Date("2026-07-21T23:59:00"), new Date("2026-07-21T00:01:00")), 0);
    assert.equal(dayDiff(new Date("2026-07-22T00:01:00"), new Date("2026-07-21T23:59:00")), 1);
});

test("the frozen NOW is what the snapshot assumes", () => {
    assert.equal(NOW.toISOString(), "2026-07-21T12:00:00.000Z");
});
