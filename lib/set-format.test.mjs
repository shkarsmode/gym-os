import test from "node:test";
import assert from "node:assert/strict";
import { isTimedSet, formatDuration, setLoadText, describeSet } from "./set-format.js";

test("a set counts time only when durationSeconds is actually set", () => {
    assert.equal(isTimedSet({ durationSeconds: 45 }), true);
    // Zero is a real value: a plank you have added but not yet timed is still a plank.
    assert.equal(isTimedSet({ durationSeconds: 0 }), true);
    assert.equal(isTimedSet({ durationSeconds: null }), false);
    assert.equal(isTimedSet({ durationSeconds: undefined }), false);
    assert.equal(isTimedSet({ durationSeconds: "" }), false);
    assert.equal(isTimedSet({ repetitions: 10 }), false);
    assert.equal(isTimedSet(null), false);
});

test("durations read the way holds are prescribed", () => {
    assert.equal(formatDuration(0), "0 с");
    assert.equal(formatDuration(45), "45 с");
    assert.equal(formatDuration(59), "59 с");
    assert.equal(formatDuration(60), "1:00");
    assert.equal(formatDuration(90), "1:30");
    assert.equal(formatDuration(125), "2:05");
    assert.equal(formatDuration(600), "10:00");
});

test("durations never go negative or fractional", () => {
    assert.equal(formatDuration(-10), "0 с");
    assert.equal(formatDuration(44.6), "45 с");
    assert.equal(formatDuration("30"), "30 с");
    assert.equal(formatDuration(null), "0 с");
    assert.equal(formatDuration(undefined), "0 с");
    assert.equal(formatDuration("nonsense"), "0 с");
});

test("load text switches measure with the set kind", () => {
    assert.equal(setLoadText({ weight: 80, repetitions: 8, durationSeconds: null }), "80 кг · 8 повт");
    assert.equal(setLoadText({ weight: 20, durationSeconds: 45 }), "20 кг · 45 с");
});

test("a bodyweight hold does not lead with 0 кг", () => {
    assert.equal(setLoadText({ weight: 0, durationSeconds: 60 }), "1:00");
    assert.equal(setLoadText({ weight: 0, repetitions: 12, durationSeconds: null }), "12 повт");
});

test("describeSet joins only the parts that exist", () => {
    assert.equal(
        describeSet({ weight: 80, repetitions: 8, durationSeconds: null, isCompleted: true }, "Робочий"),
        "Робочий · 80 кг · 8 повт · виконано"
    );
    assert.equal(describeSet({ weight: 0, durationSeconds: 90 }, ""), "1:30");
    assert.equal(describeSet(null), "");
});

import { toTimedSet, toRepSet, timedTotals, DEFAULT_HOLD_SECONDS, DEFAULT_REPS } from "./set-format.js";

test("flipping to timed zeroes the reps", () => {
    // Volume is weight × reps. A plank that kept "8" would keep adding tonnage that was
    // never lifted to every chart reading it.
    const flipped = toTimedSet({ weight: 20, repetitions: 8, durationSeconds: null });
    assert.equal(flipped.durationSeconds, DEFAULT_HOLD_SECONDS);
    assert.equal(flipped.repetitions, 0);
    assert.equal(flipped.weight, 20);
});

test("flipping an already-timed set keeps the time it had", () => {
    assert.equal(toTimedSet({ durationSeconds: 75, repetitions: 0 }).durationSeconds, 75);
    // Zero is a real duration, not "unset".
    assert.equal(toTimedSet({ durationSeconds: 0, repetitions: 0 }).durationSeconds, 0);
});

test("flipping back to reps drops the duration entirely", () => {
    const back = toRepSet({ weight: 20, repetitions: 0, durationSeconds: 45 });
    assert.equal(back.durationSeconds, null);
    assert.equal(back.repetitions, 10);
    assert.equal(isTimedSet(back), false);
});

test("flipping back keeps reps that were already there", () => {
    assert.equal(toRepSet({ repetitions: 12, durationSeconds: 45 }).repetitions, 12);
});

test("neither flip mutates the set it was handed", () => {
    const original = { weight: 20, repetitions: 8, durationSeconds: null };
    toTimedSet(original);
    assert.equal(original.repetitions, 8);
    assert.equal(original.durationSeconds, null);
});

test("timed totals count only what was actually held", () => {
    const totals = timedTotals([
        { durationSeconds: 45, isCompleted: true },
        { durationSeconds: 60, isCompleted: true },
        { durationSeconds: 90, isCompleted: false },
        { repetitions: 8, durationSeconds: null, isCompleted: true }
    ]);
    assert.equal(totals.count, 3);
    assert.equal(totals.completed, 2);
    assert.equal(totals.totalSeconds, 105);
    // The best is the longest PRESCRIBED hold, done or not — it is the target.
    assert.equal(totals.bestSeconds, 90);
});

test("timed totals survive an empty or rep-only block", () => {
    assert.deepEqual(timedTotals([]), { count: 0, completed: 0, totalSeconds: 0, bestSeconds: 0 });
    assert.deepEqual(timedTotals(null), { count: 0, completed: 0, totalSeconds: 0, bestSeconds: 0 });
    assert.deepEqual(timedTotals([{ repetitions: 5, durationSeconds: null }]), { count: 0, completed: 0, totalSeconds: 0, bestSeconds: 0 });
});

test("a remembered rep count of zero beats the default", () => {
    // 0 is a real answer — a set that genuinely had no reps recorded. Treating it as
    // "nothing remembered" would invent 10 reps out of a blank.
    assert.equal(toRepSet({ repetitions: 0, durationSeconds: 45 }, 0).repetitions, 0);
    assert.equal(toRepSet({ repetitions: 0, durationSeconds: 45 }, 8).repetitions, 8);
    assert.equal(toRepSet({ repetitions: 0, durationSeconds: 45 }, undefined).repetitions, DEFAULT_REPS);
    assert.equal(toRepSet({ repetitions: 0, durationSeconds: 45 }, null).repetitions, DEFAULT_REPS);
});

import { weightFieldLabel, isBodyweightExercise } from "./set-format.js";

test("the weight field is called additional load where that is what it is", () => {
    // «Вага, кг» above a 0 on a plank reads as "this exercise weighs nothing".
    assert.equal(weightFieldLabel({ timed: true }), "Додаткова, кг");
    assert.equal(weightFieldLabel({ bodyweight: true }), "Додаткова, кг");
    assert.equal(weightFieldLabel({ timed: true, bodyweight: true }), "Додаткова, кг");
    assert.equal(weightFieldLabel({ timed: false, bodyweight: false }), "Вага, кг");
    assert.equal(weightFieldLabel(), "Вага, кг");
});

test("bodyweight is decided by the equipment, not by the number being zero", () => {
    // A barbell set that happens to be logged at 0 kg is still a barbell set.
    assert.equal(isBodyweightExercise({ equipment: "Вага тіла" }), true);
    assert.equal(isBodyweightExercise({ equipment: "Штанга" }), false);
    assert.equal(isBodyweightExercise(null), false);
    assert.equal(isBodyweightExercise({}), false);
});
