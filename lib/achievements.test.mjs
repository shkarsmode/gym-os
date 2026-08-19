// Achievements are computed on the client, but their output leaves the device: the
// unlock set feeds the XP ledger, and POST /feed/achievements/sync writes the unlock
// DATES to the server so the feed's "achievements" scope can order them among real
// workouts. So an unlock date is not cosmetic — it is a stored value that two runtimes
// must agree on. Everything below exists to keep the engine deterministic: same input,
// same unlock set, same dates, forever, with no reads of the wall clock and no
// dependence on how many times it has been called.
//
//   node --test lib/achievements.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

import { ACHIEVEMENTS, evaluateAchievements } from "./achievements.js";

// A frozen "now" — the five tenure badges unlock on elapsed time alone, so anything
// that reads the real clock here would make the suite rot on its own.
const NOW = new Date("2026-08-20T12:00:00Z");

const CATALOG = {
    "ex-bench": { name: "Жим лежачи", primaryMuscleGroup: "Груди" },
    "ex-squat": { name: "Присідання зі штангою", primaryMuscleGroup: "Ноги" },
    "ex-row": { name: "Тяга в нахилі", primaryMuscleGroup: "Спина" }
};

function completedSet(weight, repetitions, extra = {}) {
    return { weight, repetitions, isCompleted: true, ...extra };
}

function workout(date, extra = {}) {
    return { id: `w-${date}-${extra.tag || "1"}`, date, status: "completed", exercises: [], ...extra };
}

// One barbell exercise with the given sets — the shape achievementData hands over.
function lift(exerciseId, sets) {
    return { exerciseId, sets };
}

function data(overrides = {}) {
    return {
        workouts: [],
        records: [],
        ideas: [],
        customExercises: [],
        joinedAt: null,
        now: NOW,
        exerciseInfo: (id) => CATALOG[id] || { name: "", primaryMuscleGroup: "" },
        ...overrides
    };
}

// id -> unlockedAt, unlocked ones only.
function unlocks(input) {
    return new Map(
        evaluateAchievements(input)
            .filter((item) => item.unlockedAt)
            .map((item) => [item.id, item.unlockedAt])
    );
}

function unlocked(input, id) {
    return unlocks(input).has(id);
}

// A run of plain one-set workouts, one per given date.
function historyOn(dates) {
    return dates.map((date, index) => workout(date, { tag: String(index), exercises: [lift("ex-row", [completedSet(60, 10)])] }));
}

// ---------------------------------------------------------------- determinism

test("the same history produces the same unlock set and the same dates on every call", () => {
    // The engine must be a pure function of its input. If a check ever accumulated
    // state across calls or reached for the clock, the second render of the Рівні page
    // would disagree with the first, and the sync endpoint would rewrite dates the
    // server had already stored.
    const input = data({
        workouts: historyOn(["2026-01-05", "2026-01-07", "2026-01-09", "2026-02-14"]),
        joinedAt: "2026-01-01T09:00:00.000Z",
        customExercises: [{ createdAt: "2026-01-06", likeCount: 2 }]
    });

    const first = evaluateAchievements(input).map((item) => ({ id: item.id, unlockedAt: item.unlockedAt }));
    const second = evaluateAchievements(input).map((item) => ({ id: item.id, unlockedAt: item.unlockedAt }));
    const third = evaluateAchievements(input).map((item) => ({ id: item.id, unlockedAt: item.unlockedAt }));

    assert.deepEqual(second, first, "a repeat call returned a different result — the engine is not pure");
    assert.deepEqual(third, first);
});

test("an achievement unlocks on the date of the workout that satisfied it, not today", () => {
    // The single most load-bearing property: the feed sorts achievement cards by this
    // date next to workouts and records. Stamping "now" would drag every historic badge
    // to the top of the стрічка and mislabel it "щойно".
    const result = unlocks(data({ workouts: historyOn(["2026-01-05", "2026-01-07"]) }));

    assert.equal(result.get("first-workout"), "2026-01-05");
    assert.notEqual(result.get("first-workout"), NOW.toISOString().slice(0, 10));
});

test("adding later workouts never moves an already-earned unlock date", () => {
    // Retroactive computation means the whole history is re-scanned on every boot. An
    // unlock that drifts forward re-fires the toast, re-awards XP in the ledger and
    // re-posts to the feed as if it just happened.
    const early = historyOn(["2026-03-02", "2026-03-04", "2026-03-06", "2026-03-08"]);
    const later = [...early, ...historyOn(["2026-05-11", "2026-05-13"]), workout("2026-06-01", { exercises: [lift("ex-bench", [completedSet(120, 5)])] })];

    const before = unlocks(data({ workouts: early }));
    const after = unlocks(data({ workouts: later }));

    for (const [id, unlockedAt] of before) {
        assert.equal(after.get(id), unlockedAt, `${id} moved from ${unlockedAt} to ${after.get(id)} because unrelated later workouts were added`);
    }
});

test("tenure badges follow the supplied `now`, never the wall clock", () => {
    // These five are the only badges that unlock with no user action, so they are the
    // ones most likely to make the browser and the server disagree simply by running a
    // moment apart. `now` is threaded in exactly to prevent that.
    const joinedAt = "2026-01-15T08:00:00.000Z";

    assert.equal(unlocked(data({ joinedAt, now: new Date("2026-02-15T08:00:00.000Z") }), "tenure-1m"), true, "one month elapsed, badge still locked");
    assert.equal(unlocked(data({ joinedAt, now: new Date("2026-02-14T08:00:00.000Z") }), "tenure-1m"), false, "a day short of a month already unlocked");
    assert.equal(unlocked(data({ joinedAt, now: new Date("2026-02-15T08:00:00.000Z") }), "tenure-6m"), false);
});

// ---------------------------------------------------------------- catalog integrity

test("every achievement carries a unique id, a title, a caption and an XP reward", () => {
    // Ids are the primary key on the server side (feed/achievements/sync upserts by id)
    // and the XP ledger multiplies by `xp`. A duplicate id silently overwrites a badge;
    // a missing xp turns an unlock into NaN XP and breaks the level for the whole account.
    const ids = ACHIEVEMENTS.map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length, "two achievements share an id");

    for (const achievement of ACHIEVEMENTS) {
        assert.ok(achievement.title && typeof achievement.title === "string", `${achievement.id} has no title`);
        assert.ok(achievement.caption && typeof achievement.caption === "string", `${achievement.id} has no caption`);
        assert.ok(Number.isFinite(achievement.xp) && achievement.xp > 0, `${achievement.id} has no XP reward`);
        assert.equal(typeof achievement.check, "function", `${achievement.id} has no check`);
    }
});

test("locked achievements are reported with unlockedAt null, not dropped", () => {
    // The Рівні grid renders locked badges greyed out; filtering them away here would
    // empty the page for a new account instead of showing them something to chase.
    const result = evaluateAchievements(data({ workouts: historyOn(["2026-04-01"]) }));

    assert.equal(result.length, ACHIEVEMENTS.length);
    assert.equal(result.find((item) => item.id === "workouts-50").unlockedAt, null);
    assert.equal(result.find((item) => item.id === "first-workout").unlockedAt, "2026-04-01");
});

// ---------------------------------------------------------------- thresholds

test("the tenth workout unlocks Десятка on its own date; nine do not", () => {
    const dates = ["2026-02-02", "2026-02-04", "2026-02-06", "2026-02-09", "2026-02-11", "2026-02-13", "2026-02-16", "2026-02-18", "2026-02-20", "2026-02-23"];

    assert.equal(unlocks(data({ workouts: historyOn(dates) })).get("workouts-10"), "2026-02-23");
    assert.equal(unlocked(data({ workouts: historyOn(dates.slice(0, 9)) }), "workouts-10"), false, "nine workouts unlocked a ten-workout badge");
});

test("three workouts inside one calendar week unlock Тижневий ритм; two do not", () => {
    // Weeks are Monday-anchored. 2026-08-03 is a Monday, 2026-08-10 the next one — the
    // negative case spreads the third session across the boundary on purpose.
    const sameWeek = unlocks(data({ workouts: historyOn(["2026-08-03", "2026-08-05", "2026-08-07"]) }));
    assert.equal(sameWeek.get("week-3"), "2026-08-07");

    assert.equal(unlocked(data({ workouts: historyOn(["2026-08-03", "2026-08-05", "2026-08-10"]) }), "week-3"), false, "two-per-week unlocked the three-per-week badge");
});

test("exactly 100 000 кг of volume unlocks 100 тонн; one kilogram short does not", () => {
    const at = [workout("2026-05-04", { exercises: [lift("ex-row", [completedSet(1, 100000)])] })];
    const under = [workout("2026-05-04", { exercises: [lift("ex-row", [completedSet(1, 99999)])] })];

    assert.equal(unlocks(data({ workouts: at })).get("volume-100k"), "2026-05-04");
    assert.equal(unlocked(data({ workouts: under }), "volume-100k"), false);
});

test("a 100 кг bench single unlocks Жим сотки; 99.5 кг does not", () => {
    const at = [workout("2026-06-10", { exercises: [lift("ex-bench", [completedSet(100, 1)])] })];
    const under = [workout("2026-06-10", { exercises: [lift("ex-bench", [completedSet(99.5, 1)])] })];

    assert.equal(unlocks(data({ workouts: at })).get("bench-100"), "2026-06-10");
    assert.equal(unlocked(data({ workouts: under }), "bench-100"), false);
});

test("a lift only counts toward its badge when the exercise name matches", () => {
    // The lift badges key off the exercise NAME, not the id, so a heavy squat must not
    // hand out Жим сотки just because it cleared the weight.
    const squatOnly = [workout("2026-06-10", { exercises: [lift("ex-squat", [completedSet(150, 3)])] })];

    assert.equal(unlocked(data({ workouts: squatOnly }), "bench-100"), false, "a squat unlocked the bench badge");
    assert.equal(unlocks(data({ workouts: squatOnly })).get("squat-140"), "2026-06-10");
});

test("a session over three hours unlocks Марафонець залу; exactly three hours does not", () => {
    const over = [workout("2026-07-02", { durationOverride: 181 })];
    const at = [workout("2026-07-02", { durationOverride: 180 })];

    assert.equal(unlocks(data({ workouts: over })).get("long-session"), "2026-07-02");
    assert.equal(unlocked(data({ workouts: at }), "long-session"), false, "a badge for «понад 3 години» fired at exactly three hours");
});

test("seven consecutive training days unlock Сім поспіль; six do not", () => {
    // Mid-July on purpose: a run that straddles a DST switch loses a day to the
    // 23-hour local date (see the KNOWN BUG note in scoring.parity.test.mjs).
    const week = ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11", "2026-07-12"];

    assert.equal(unlocks(data({ workouts: historyOn(week) })).get("streak-7"), "2026-07-12");
    assert.equal(unlocked(data({ workouts: historyOn(week.slice(0, 6)) }), "streak-7"), false);
});

// ---------------------------------------------------------------- hostile input

test("an empty history unlocks nothing and does not throw", () => {
    // This is what a brand-new account looks like on first boot, before any sync.
    const result = evaluateAchievements(data());

    assert.equal(result.length, ACHIEVEMENTS.length);
    assert.deepEqual(result.filter((item) => item.unlockedAt), []);
});

test("peer summary rows carrying no exercises key do not throw", () => {
    // The windowed payload sends PEER workouts as aggregates only — totalVolume /
    // setCount / cardioMinutes and NO "exercises" key at all. Anything that reaches
    // straight for .exercises on those rows dies with "undefined is not an object", and
    // the whole Рівні page renders empty for every teammate.
    const peers = [
        { id: "w-peer-1", date: "2026-07-01", status: "completed", totalVolume: 12000, setCount: 24, exerciseCount: 5, cardioMinutes: 30, seq: 7 },
        { id: "w-peer-2", date: "2026-07-03", status: "completed", totalVolume: 9000, setCount: 18, exerciseCount: 4, cardioMinutes: 0, seq: 8 }
    ];

    const result = unlocks(data({ workouts: peers }));

    assert.equal(result.get("first-workout"), "2026-07-01", "count-based badges must still work off summary rows");
});

test("a completed workout whose sets are not marked completed contributes no volume", () => {
    // Product rule: finishing a workout marks every set completed. Anything still
    // unmarked was genuinely skipped, so counting it would award volume badges for
    // weight nobody lifted.
    const skipped = [workout("2026-05-04", { exercises: [lift("ex-row", [{ weight: 1, repetitions: 100000, isCompleted: false }])] })];

    assert.equal(unlocked(data({ workouts: skipped }), "volume-100k"), false);
});

// ---------------------------------------------------------------- known bug

test("KNOWN BUG: beating your only personal record moves the Новий рекорд unlock date", () => {
    // `records` is the CURRENT best per exercise (recordsFor keeps one row per exercise
    // and overwrites it on a better 1RM), so the earliest record date is not the date of
    // the first PR ever — it is the date of the oldest PR that still stands. Beat it and
    // first-pr / pr-25 silently jump forward, which is exactly the "unlock dates never
    // move" rule broken by data the user cannot see.
    //
    // Asserted as-is so a fix is a deliberate, reviewable commit rather than a surprise:
    // fixing it re-dates badges already synced to the server.
    const firstPr = unlocks(data({ records: [{ exerciseId: "ex-bench", date: "2026-01-10" }] }));
    const afterBeatingIt = unlocks(data({ records: [{ exerciseId: "ex-bench", date: "2026-06-20" }] }));

    assert.equal(firstPr.get("first-pr"), "2026-01-10");
    assert.equal(afterBeatingIt.get("first-pr"), "2026-06-20", "first-pr stopped tracking the surviving record — intended? then this is fixed");
});
