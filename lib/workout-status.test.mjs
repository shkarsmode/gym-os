import test from "node:test";
import assert from "node:assert/strict";
import { hasRecordedWork, effectiveWorkoutStatus } from "./workout-status.js";

const TODAY = "2026-08-21";
const hydrated = (status, date, sets) => ({ status, date, exercises: [{ sets }], cardioSessions: [] });
const summary = (status, date, extra) => ({ status, date, setCount: 0, totalVolume: 0, cardioMinutes: 0, ...extra });

test("a completed workout is never re-judged", () => {
    assert.equal(effectiveWorkoutStatus(hydrated("completed", "2020-01-01", []), TODAY), "completed");
    assert.equal(effectiveWorkoutStatus(summary("completed", "2030-01-01", {}), TODAY), "completed");
});

test("planned stays planned for today and the future", () => {
    assert.equal(effectiveWorkoutStatus(hydrated("planned", TODAY, []), TODAY), "planned");
    assert.equal(effectiveWorkoutStatus(hydrated("planned", "2026-08-22", []), TODAY), "planned");
    assert.equal(effectiveWorkoutStatus(hydrated("planned", "2027-01-01", []), TODAY), "planned");
});

test("a past day with work logged reads as done, whatever the row claims", () => {
    assert.equal(effectiveWorkoutStatus(hydrated("planned", "2026-08-19", [{ isCompleted: true }]), TODAY), "completed");
    assert.equal(effectiveWorkoutStatus(hydrated("active", "2026-08-19", [{ isCompleted: true }]), TODAY), "completed");
});

test("the peer summary from the day sheet is judged the same way", () => {
    // The case from production: 19 Aug, «Заплановано», 1520 kg across 6 sets.
    assert.equal(effectiveWorkoutStatus(summary("planned", "2026-08-19", { setCount: 6, totalVolume: 1520 }), TODAY), "completed");
    assert.equal(effectiveWorkoutStatus(summary("planned", "2026-08-19", { cardioMinutes: 30 }), TODAY), "completed");
});

test("a past plan with nothing logged did not happen", () => {
    assert.equal(effectiveWorkoutStatus(hydrated("planned", "2026-08-19", [{ isCompleted: false }]), TODAY), "missed");
    assert.equal(effectiveWorkoutStatus(summary("planned", "2026-08-19", {}), TODAY), "missed");
    assert.equal(effectiveWorkoutStatus(hydrated("planned", "2026-08-19", []), TODAY), "missed");
});

test("an unusable date leaves the row exactly as it claims", () => {
    assert.equal(effectiveWorkoutStatus({ status: "planned" }, TODAY), "planned");
    assert.equal(effectiveWorkoutStatus(hydrated("active", "2026-08-19", []), ""), "active");
});

test("timestamped dates compare by day, not by string length", () => {
    assert.equal(effectiveWorkoutStatus(summary("planned", "2026-08-19T18:30:00.000Z", { setCount: 3 }), TODAY), "completed");
    assert.equal(effectiveWorkoutStatus(summary("planned", "2026-08-21T06:00:00.000Z", {}), TODAY), "planned");
});

test("hasRecordedWork reads both payload shapes", () => {
    assert.equal(hasRecordedWork({ exercises: [{ sets: [{ isCompleted: true }] }] }), true);
    assert.equal(hasRecordedWork({ exercises: [{ sets: [{ isCompleted: false }] }] }), false);
    assert.equal(hasRecordedWork({ exercises: [], cardioSessions: [{ durationMinutes: 20 }] }), true);
    assert.equal(hasRecordedWork({ setCount: 4 }), true);
    assert.equal(hasRecordedWork({ setCount: 0, totalVolume: 0, cardioMinutes: 0 }), false);
    assert.equal(hasRecordedWork(null), false);
});
