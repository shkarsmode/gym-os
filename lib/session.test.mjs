import test from "node:test";
import assert from "node:assert/strict";
import {
    sessionSetLabels, sessionProgress, pairedLast, suggestExercises, weightStep, fieldStep, stepValue, numberDraft
} from "./session.js";

const set = (id, done, extra = {}) => ({ id, isCompleted: done, type: "working", weight: 80, repetitions: 8, durationSeconds: null, ...extra });
const exercise = (id, order, sets, groupId = null) => ({ id, order, supersetGroupId: groupId, sets });

test("every set counts, warm-ups included, and keeps its type for the colour", () => {
    const labels = sessionSetLabels([set("a", true, { type: "warmup" }), set("b", true), set("c", false, { type: "drop" }), set("d", false)]);
    assert.deepEqual(labels.map((item) => item.label), ["1", "2", "3", "4"]);
    assert.equal(labels[0].kind, "warmup");
    assert.equal(labels[2].kind, "drop");
});

test("progress counts every set of every exercise", () => {
    assert.deepEqual(sessionProgress([exercise("e", 1, [set("a", true), set("b", false)]), exercise("f", 2, [set("c", true)])]), { done: 2, total: 3 });
});

test("last time pairs by position, and runs out cleanly", () => {
    const last = { sets: [{ weight: 60 }, { weight: 85 }] };
    assert.equal(pairedLast(last, 1).weight, 85);
    assert.equal(pairedLast(last, 2), null);
    assert.equal(pairedLast(null, 0), null);
});

test("suggestions come from recent sessions, same type first, never what is already in", () => {
    const w = (id, date, type, ids, status = "completed") => ({ id, date, workoutType: type, status, exercises: ids.map((exerciseId) => ({ exerciseId })) });
    const workouts = [
        w("p1", "2026-10-07", "pull", ["pullup", "row", "curl"]),
        w("p2", "2026-09-30", "pull", ["pullup", "row", "hyper"]),
        w("x1", "2026-10-10", "push", ["bench", "dips"]),
        w("old", "2026-01-01", "pull", ["shrug"]),
        w("plan", "2026-10-20", "pull", ["facepull"], "planned")
    ];
    const current = { id: "now", workoutType: "pull", exercises: [{ exerciseId: "pullup" }] };
    const result = suggestExercises(workouts, current, { limit: 10 });
    const ids = result.map((item) => item.exerciseId);
    assert.equal(ids[0], "row");                 // in both recent Pull sessions
    assert.ok(!ids.includes("pullup"));          // already in the session
    assert.ok(!ids.includes("facepull"));        // a planned session is not history
    assert.ok(ids.indexOf("curl") < ids.indexOf("bench")); // same type outranks another type
    assert.equal(result[0].count, 2);
    assert.equal(result[0].lastDate, "2026-10-07");
    assert.deepEqual(suggestExercises([], current), []);
});

test("steps follow the equipment and never go below zero", () => {
    assert.equal(weightStep("Штанга"), 2.5);
    assert.equal(weightStep("Гантелі"), 2);
    assert.equal(fieldStep("repetitions"), 1);
    assert.equal(stepValue(1, -2.5, "weight"), 0);
    assert.equal(stepValue(1999, 2.5, "weight"), 2000);
});

test("a weight is written with a decimal comma and no trailing zeros", () => {
    assert.equal(numberDraft(92.5), "92,5");
    assert.equal(numberDraft(100), "100");
    assert.equal(numberDraft(12.345), "12,35");
    assert.equal(numberDraft(null), "0");
});
