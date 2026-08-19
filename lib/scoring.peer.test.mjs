// The scoring kernel against PEER SUMMARY rows.
//
//   node --test lib/scoring.peer.test.mjs
//
// Under the windowed payload only the CURRENT user's workouts are hydrated. Every other
// member's row arrives as a summary: totalVolume / setCount / exerciseCount /
// cardioMinutes / seq aggregates and NO `exercises` key anywhere — not an empty array,
// absent. Opening another member's profile fed those rows straight into the kernel and
// it died with "undefined is not an object (evaluating 'i.exercises.filter')", taking
// the whole #/user/:id screen with it.
//
// Two failure modes are being locked down here, and the second is the nastier one:
//
//   1. Anything that walks workouts must survive a row with no exercises and no sets.
//   2. The guard must treat a missing array as EMPTY, never as an excuse to zero the
//      run. A `|| []` that accidentally swallowed hydrated data would look calm in the
//      console and quietly halve somebody's volume, records and level — so every test
//      below pairs "did not throw" with "the hydrated numbers are still exact".
//
// The kernel deliberately does NOT read the peer aggregates (totalVolume and friends);
// callers that need those numbers use the summary-aware helpers in app.js. The peer's
// 4618 kg therefore must never turn up in a kernel total.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    autoDuration,
    duration,
    exerciseOneRepMax,
    exerciseUsageMap,
    exerciseVolume,
    muscleSetMap,
    recordsFor,
    scoreAll,
    streak,
    teamStats,
    userAchievements,
    userStats,
    workoutVolume,
    xpEvents
} from "./scoring.js";

// ---------------------------------------------------------------- fixture

const NOW = new Date("2026-07-22T12:00:00.000Z");

const EXERCISES = [
    { id: "ex-bench", name: "Жим лежачи", primaryMuscleGroup: "Груди", isCustom: false },
    { id: "ex-squat", name: "Присідання зі штангою", primaryMuscleGroup: "Ноги", isCustom: false },
    { id: "ex-row", name: "Тяга верхнього блока", primaryMuscleGroup: "Спина", isCustom: false }
];

const USERS = [
    { id: "u1", displayName: "Свій", createdAt: "2026-01-10T00:00:00.000Z" },
    { id: "u2", displayName: "Сусід", createdAt: "2026-01-11T00:00:00.000Z" }
];

const exerciseById = (id) => EXERCISES.find((item) => item.id === id)
    || { id: `missing-${id}`, name: "", primaryMuscleGroup: "" };
const userById = (id) => USERS.find((item) => item.id === id) || null;

// Copied from a real windowed payload. Keep it verbatim — the point of this file is
// that the kernel meets exactly these keys and no others.
const PEER = {
    id: "w-peer-1",
    userId: "u2",
    date: "2026-07-21",
    status: "completed",
    totalVolume: 4618,
    setCount: 20,
    exerciseCount: 6,
    cardioMinutes: 30,
    seq: 3
};

const PEER_PLANNED = {
    id: "w-peer-2",
    userId: "u2",
    date: "2026-07-20",
    status: "planned",
    totalVolume: 0,
    setCount: 0,
    exerciseCount: 2,
    cardioMinutes: 0,
    seq: 1
};

function set(weight, repetitions, extra = {}) {
    return { type: "working", weight, repetitions, isCompleted: true, restSeconds: 90, notes: "", ...extra };
}

// 560 + 450 = 1010 kg, 2 completed sets, 20 cardio minutes.
const OWN_LATEST = {
    id: "w-own-2", userId: "u1", date: "2026-07-22", status: "completed",
    title: "Тренування", notes: "легка сесія",
    startedAt: null, finishedAt: null, durationOverride: null,
    exercises: [
        { exerciseId: "ex-row", notes: "", sets: [set(70, 8)] },
        { exerciseId: "ex-bench", notes: "", sets: [set(90, 5)] }
    ],
    cardioSessions: [{ type: "treadmill", durationMinutes: 20, distance: 4, calories: 210 }]
};

// 500 + 315 + 600 + 700 = 2115 kg. The 110x1 is not completed and the 60x10 is a
// warmup: both are here so a lazy guard cannot fake the totals by counting everything.
const OWN_EARLIER = {
    id: "w-own-1", userId: "u1", date: "2026-07-21", status: "completed",
    title: "Тренування", notes: "",
    startedAt: null, finishedAt: null, durationOverride: null,
    exercises: [
        {
            exerciseId: "ex-bench", notes: "важко йшло",
            sets: [set(100, 5), set(105, 3), set(110, 1, { isCompleted: false })]
        },
        {
            exerciseId: "ex-squat", notes: "",
            sets: [set(60, 10, { type: "warmup" }), set(140, 5)]
        }
    ],
    cardioSessions: []
};

// Newest-first, which is the order recordsFor's tie-break depends on and the order
// /export and the windowed payload both deliver.
const MIXED = [OWN_LATEST, OWN_EARLIER, PEER];

const OWN_VOLUME = 3125;

// ---------------------------------------------------------------- the crash itself

test("userStats does not throw on a peer summary (the #/user/:id crash)", () => {
    // The literal reproduction: a completed row with no `exercises` key, handed to the
    // function that renders another member's profile header.
    const stats = userStats("u2", [PEER], { exerciseById, now: NOW });
    assert.equal(stats.totalWorkouts, 1);
    assert.equal(stats.completedWorkouts, 1);
    assert.equal(stats.totalSets, 0);
    assert.equal(stats.totalVolume, 0, "the kernel invented sets for a summary row");
});

test("userStats' notesCount survives a peer row with no exercises key", () => {
    // notesCount reaches into item.exercises INSIDE a reduce, which is the exact
    // expression that threw. Two notes live in the hydrated rows (one workout note,
    // one exercise note); the peer contributes nothing rather than exploding.
    assert.equal(userStats("u1", MIXED, { exerciseById, now: NOW }).notesCount, 2);
});

// ---------------------------------------------------------------- volume primitives

test("workoutVolume reports zero for a peer summary and the real total for a hydrated row", () => {
    assert.equal(workoutVolume(PEER), 0);
    assert.equal(workoutVolume(OWN_EARLIER), 2115, "the guard swallowed hydrated sets");
    assert.equal(workoutVolume(OWN_LATEST), 1010);
});

test("workoutVolume never reads the peer's totalVolume aggregate", () => {
    // Callers that want 4618 must use workoutVolumeOf in app.js. If the kernel ever
    // started reading the aggregate, team totals would double-count peers.
    assert.notEqual(workoutVolume(PEER), PEER.totalVolume);
});

test("exerciseVolume tolerates an exercise entry carrying no sets array", () => {
    assert.equal(exerciseVolume({ exerciseId: "ex-bench" }), 0);
    assert.equal(exerciseVolume(OWN_EARLIER.exercises[1]), 1300, "warmup volume was dropped");
});

test("exerciseOneRepMax returns 0 rather than -Infinity when there are no sets", () => {
    // Math.max() with no arguments is -Infinity; that would render as "-∞ кг" and
    // poison every comparison it touches.
    assert.equal(exerciseOneRepMax({ exerciseId: "ex-bench" }), 0);
    assert.equal(exerciseOneRepMax(OWN_EARLIER.exercises[0]), 114.9);
});

// ---------------------------------------------------------------- aggregation maps

test("muscleSetMap skips peer summaries and still counts every hydrated set", () => {
    const map = muscleSetMap(MIXED, exerciseById);
    assert.equal(map.get("Груди"), 3);
    // Warmups count toward sets-per-muscle even though they never make a record.
    assert.equal(map.get("Ноги"), 2);
    assert.equal(map.get("Спина"), 1);
    assert.equal(map.has(undefined), false, "a summary row leaked in as an unnamed muscle");
});

test("exerciseUsageMap skips peer summaries and still counts hydrated usage", () => {
    const map = exerciseUsageMap(MIXED);
    assert.equal(map.get("ex-bench"), 2);
    assert.equal(map.get("ex-squat"), 1);
    assert.equal(map.get("ex-row"), 1);
    assert.equal(map.size, 3, "the peer summary produced a phantom exercise");
});

test("streak counts a peer summary's date like any other training day", () => {
    // The date is the one field a summary always carries, so a peer row must still
    // extend the run — the team streak on the profile screen depends on it.
    assert.equal(streak([OWN_LATEST, OWN_EARLIER, PEER], NOW), 2);
    assert.equal(streak([PEER], NOW), 1);
});

// ---------------------------------------------------------------- records

test("recordsFor ignores peer summaries and still finds every hydrated record", () => {
    const records = recordsFor("u1", MIXED, exerciseById);
    assert.equal(records.length, 3);
    assert.deepEqual(records.map((item) => item.exerciseId), ["ex-squat", "ex-bench", "ex-row"]);
    // The bench record is the 100x5, not the heavier-looking 105x3 and not the 110x1
    // that was never completed.
    const bench = records.find((item) => item.exerciseId === "ex-bench");
    assert.equal(bench.weight, 100);
    assert.equal(bench.estimatedOneRepMax, 114.9);
    assert.ok(!records.some((item) => item.workoutId === PEER.id), "a summary row produced a record");
});

test("recordsFor over peer summaries alone returns an empty list", () => {
    assert.deepEqual(recordsFor("u2", [PEER, PEER_PLANNED], exerciseById), []);
});

// ---------------------------------------------------------------- per-user stats

test("userStats counts peer rows as workouts but takes none of its numbers from them", () => {
    const stats = userStats("u1", MIXED, { exerciseById, now: NOW });
    assert.equal(stats.totalWorkouts, 3);
    assert.equal(stats.completedWorkouts, 3);
    assert.equal(stats.totalVolume, OWN_VOLUME, "hydrated volume changed when a peer row joined the list");
    assert.equal(stats.totalSets, 6);
    assert.equal(stats.workingSets, 5);
    assert.equal(stats.warmupSets, 1);
    assert.equal(stats.personalRecords, 3);
    assert.equal(stats.mostUsedExerciseId, "ex-bench");
    assert.equal(stats.mostTrainedMuscleGroup, "Груди");
    assert.equal(stats.lastWorkoutDate, "2026-07-22");
    assert.equal(stats.trainingStreak, 2);
});

test("userStats' weekly totals ignore a peer summary sitting inside the same week", () => {
    // weekVolume and weekSets re-walk exercises for the current week only — a second
    // place the missing array reaches, and one the profile header renders directly.
    const stats = userStats("u1", MIXED, { exerciseById, now: NOW });
    assert.equal(stats.weekVolume, OWN_VOLUME);
    assert.equal(stats.weekSets, 6);
    assert.equal(stats.weekCardioMinutes, 20);
});

test("userStats reads cardio from sessions, not from the peer's cardioMinutes aggregate", () => {
    // The peer row advertises 30 cardio minutes and carries no cardioSessions. Reading
    // the aggregate here would inflate the current user's cardio by a stranger's run.
    const stats = userStats("u1", MIXED, { exerciseById, now: NOW });
    assert.equal(stats.cardioMinutes, 20);
    assert.equal(stats.cardioSessions, 1);
    assert.equal(stats.cardioDistance, 4);
});

test("a peer summary with no startedAt contributes 0 minutes instead of NaN", () => {
    // averageDurationMinutes divides by the workout count, so one NaN turns the whole
    // average into "NaN хв" on screen.
    assert.equal(autoDuration(PEER, NOW), 0);
    assert.equal(duration(PEER, NOW), 0);
    assert.equal(userStats("u1", MIXED, { exerciseById, now: NOW }).averageDurationMinutes, 0);
});

test("a planned peer summary stays out of the completed-only aggregates", () => {
    const stats = userStats("u2", [PEER, PEER_PLANNED], { exerciseById, now: NOW });
    assert.equal(stats.totalWorkouts, 2);
    assert.equal(stats.completedWorkouts, 1);
});

// ---------------------------------------------------------------- XP & achievements

test("xpEvents awards a peer summary the base workout XP and reports zero volume", () => {
    const events = xpEvents("u1", MIXED, { records: [], achievements: [], featureRequests: [], exercises: [] });
    assert.equal(events.length, 3);
    const peerEvent = events.find((event) => event.refId === PEER.id);
    assert.equal(peerEvent.meta.volume, 0, "the peer aggregate leaked into the XP ledger");
    // The hydrated row keeps its real volume bonus, which is what would silently shrink
    // if the guard were doing more than filling in an empty array.
    assert.equal(events.find((event) => event.refId === OWN_EARLIER.id).meta.volume, 2115);
    assert.ok(events.every((event) => Number.isFinite(event.amount)));
});

test("the achievement engine survives a corpus mixing summaries and hydrated rows", () => {
    // evaluateAchievements walks sets three different ways (volume, weekly counts, per
    // set visits); each one meets the missing array.
    const unlocked = userAchievements("u1", MIXED, {
        exerciseById, userById, featureRequests: [], exercises: EXERCISES,
        records: recordsFor("u1", MIXED, exerciseById), now: NOW
    }).filter((item) => item.unlockedAt);
    assert.ok(unlocked.some((item) => item.id === "first-workout"), "the hydrated history stopped unlocking anything");
});

// ---------------------------------------------------------------- corpus-wide

test("teamStats does not throw over a corpus mixing summaries and hydrated rows", () => {
    const summaries = [
        userStats("u1", [OWN_LATEST, OWN_EARLIER], { exerciseById, now: NOW }),
        userStats("u2", [PEER], { exerciseById, now: NOW })
    ];
    const team = teamStats(USERS, [OWN_LATEST, OWN_EARLIER, PEER], summaries, { exerciseById, now: NOW });
    assert.equal(team.totalWorkouts, 3);
    assert.equal(team.completedWorkouts, 3);
    assert.equal(team.totalVolume, OWN_VOLUME);
    assert.equal(team.mostActiveUserId, "u1");
    assert.equal(team.mostTrainedMuscleGroup, "Груди");
});

test("scoreAll scores a whole gym where one member is summaries only", () => {
    // The end-to-end shape: this is what the profile and Рівні screens call. A throw
    // anywhere inside takes down every user's numbers, not just the peer's.
    const result = scoreAll({
        users: USERS,
        workouts: MIXED,
        exercises: EXERCISES,
        featureRequests: [],
        now: NOW
    });

    assert.equal(result.users.u1.stats.totalVolume, OWN_VOLUME, "the hydrated user lost volume");
    assert.equal(result.users.u1.records.length, 3);
    assert.ok(result.users.u1.xp > 0);

    const peerScore = result.users.u2;
    assert.equal(peerScore.stats.completedWorkouts, 1);
    assert.equal(peerScore.stats.totalVolume, 0);
    assert.deepEqual(peerScore.records, []);
    assert.ok(Number.isFinite(peerScore.xp), "the peer's XP came out NaN");
    assert.equal(peerScore.level.level >= 1, true);
});

test("scoreAll survives a gym where NOTHING is hydrated", () => {
    // The degenerate case a fresh device hits before its own rows arrive.
    const result = scoreAll({
        users: USERS,
        workouts: [PEER, PEER_PLANNED],
        exercises: EXERCISES,
        featureRequests: [],
        now: NOW
    });
    assert.equal(result.team.totalVolume, 0);
    assert.equal(result.users.u1.stats.totalWorkouts, 0);
    assert.equal(result.users.u2.stats.totalWorkouts, 2);
});
