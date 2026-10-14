import test from "node:test";
import assert from "node:assert/strict";
import {
    sessionSetLabels, nextSessionSet, sessionProgress, pairedLast, loadDelta, previousSetDelta,
    weightStep, fieldStep, stepValue, keypadPress, draftNumber, numberDraft,
    durationFromDigits, digitsFromDuration, durationDigitsPress, durationDigitsLabel,
    percentChange, sessionLengthLabel
} from "./session.js";

const set = (id, done, extra = {}) => ({ id, isCompleted: done, type: "working", weight: 80, repetitions: 8, durationSeconds: null, ...extra });
const exercise = (id, order, sets, groupId = null) => ({ id, order, supersetGroupId: groupId, sets });

test("every set counts, warm-ups included, and keeps its type for the colour", () => {
    const labels = sessionSetLabels([set("a", true, { type: "warmup" }), set("b", true), set("c", false, { type: "drop" }), set("d", false)]);
    assert.deepEqual(labels.map((item) => item.label), ["1", "2", "3", "4"]);
    assert.equal(labels[0].kind, "warmup");
    assert.equal(labels[2].kind, "drop");
});

test("the next set is the first open one, in exercise order", () => {
    const exercises = [
        exercise("e2", 2, [set("s3", false)]),
        exercise("e1", 1, [set("s1", true), set("s2", false)])
    ];
    assert.deepEqual(nextSessionSet(exercises), { workoutExerciseId: "e1", setId: "s2", index: 1, superset: null });
});

test("inside a superset the next set walks the round, A1 → A2, before round two", () => {
    const exercises = [
        exercise("a1", 1, [set("a1r1", true), set("a1r2", false)], "g"),
        exercise("a2", 2, [set("a2r1", false), set("a2r2", false)], "g")
    ];
    const next = nextSessionSet(exercises);
    assert.equal(next.setId, "a2r1");
    assert.deepEqual(next.superset, { groupId: "g", round: 0, memberIndex: 1 });
});

test("a finished session has no next set", () => {
    assert.equal(nextSessionSet([exercise("e", 1, [set("s", true)])]), null);
    assert.equal(nextSessionSet([]), null);
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

test("the delta compares like with like and hides zero", () => {
    assert.deepEqual(loadDelta(set("a", false, { weight: 92.5, repetitions: 6 }), { weight: 90, repetitions: 6, durationSeconds: null }), { weight: 2.5, reps: null, seconds: null });
    assert.deepEqual(loadDelta(set("a", false, { weight: 0, repetitions: 0, durationSeconds: 60 }), { weight: 0, repetitions: 0, durationSeconds: 45 }), { weight: null, reps: null, seconds: 15 });
    // a timed set is never compared with a rep set
    assert.deepEqual(loadDelta(set("a", false, { durationSeconds: 60 }), { weight: 80, repetitions: 8, durationSeconds: null }), { weight: null, reps: null, seconds: null });
});

test("the delta between sets is against the set before, and quiet when equal", () => {
    const sets = [set("a", true, { weight: 60 }), set("b", true, { weight: 70 }), set("c", false, { weight: 70 }), set("d", false, { weight: 62.5 })];
    assert.equal(previousSetDelta(sets, 0), null);
    assert.equal(previousSetDelta(sets, 1), 10);
    assert.equal(previousSetDelta(sets, 2), null);
    assert.equal(previousSetDelta(sets, 3), -7.5);
    assert.equal(previousSetDelta(sets, 4), null);
    assert.equal(previousSetDelta(null, 1), null);
});

test("steps follow the equipment and never go below zero", () => {
    assert.equal(weightStep("Штанга"), 2.5);
    assert.equal(weightStep("Гантелі"), 2);
    assert.equal(fieldStep("repetitions"), 1);
    assert.equal(stepValue(1, -2.5, "weight"), 0);
    assert.equal(stepValue(1999, 2.5, "weight"), 2000);
});

test("the first key replaces the stored value, later keys append", () => {
    assert.equal(keypadPress("92,5", "8", "weight", true), "8");
    assert.equal(keypadPress("8", "5", "weight"), "85");
    assert.equal(keypadPress("85", ",", "weight"), "85,");
    assert.equal(keypadPress("85,", "5", "weight"), "85,5");
});

test("the keypad refuses what the server would refuse", () => {
    assert.equal(keypadPress("200", "0", "weight"), "2000");
    assert.equal(keypadPress("2000", "1", "weight"), "2000");
    assert.equal(keypadPress("8", ",", "repetitions"), "8");
    assert.equal(keypadPress("85,25", "1", "weight"), "85,25");
    assert.equal(keypadPress("0", "7", "repetitions"), "7");
});

test("backspace on an untouched value clears it, otherwise drops one character", () => {
    assert.equal(keypadPress("92,5", "back", "weight", true), "");
    assert.equal(keypadPress("92,5", "back", "weight"), "92,");
});

test("drafts and numbers convert both ways with a decimal comma", () => {
    assert.equal(draftNumber("92,5"), 92.5);
    assert.equal(draftNumber(""), 0);
    assert.equal(numberDraft(92.5), "92,5");
    assert.equal(numberDraft(100), "100");
});

test("time is typed like a microwave", () => {
    assert.equal(durationFromDigits("130"), 90);
    assert.equal(durationFromDigits("45"), 45);
    assert.equal(durationFromDigits("200"), 120);
    assert.equal(digitsFromDuration(90), "130");
    assert.equal(digitsFromDuration(45), "45");
    assert.equal(durationDigitsPress("13", "0"), "130");
    assert.equal(durationDigitsPress("130", "5", true), "5");
    assert.equal(durationDigitsLabel("130"), "1:30");
});

test("change against last time is a whole percent, or nothing", () => {
    assert.equal(percentChange(6420, 6170), 4);
    assert.equal(percentChange(100, 0), null);
});

test("session length reads in minutes, then hours", () => {
    assert.equal(sessionLengthLabel(48 * 60000), "48 хв");
    assert.equal(sessionLengthLabel(72 * 60000), "1:12");
});
