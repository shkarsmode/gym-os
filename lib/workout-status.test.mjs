import test from "node:test";
import assert from "node:assert/strict";
import { hasRecordedWork, effectiveWorkoutStatus, workoutNeedsDetail, todayPlannedWorkout, plannedSetCounts } from "./workout-status.js";

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

test("a private peer workout never asks for its detail twice", () => {
    /**
     * The loop this pins: openWorkout asked for the detail, the server refused on privacy
     * grounds, the refusal handler recorded `privateOwnerId` and DELETED the only flag
     * that said "already asked", and the repaint that followed asked again — forever.
     *
     * Each pass rebuilt the drawer's markup, so the close button was destroyed between
     * pointerdown and click and the drawer could not be closed at all. It also re-fetched
     * on every pass, against a per-user rate limit.
     */
    const summary = { id: "w1", userId: "peer", totalVolume: 0, setCount: 0 };
    assert.equal(workoutNeedsDetail(summary), true, "a bare peer summary does need fetching");

    // What the 403 handler leaves behind must end the cycle.
    const refused = { ...summary, privateOwnerId: "peer" };
    assert.equal(workoutNeedsDetail(refused), false, "a known-private workout must not be re-fetched");

    // The other private shape, straight from the boot payload.
    assert.equal(workoutNeedsDetail({ ...summary, private: true }), false);

    // The unchanged cases still behave.
    assert.equal(workoutNeedsDetail({ ...summary, detailUnavailable: true }), false);
    assert.equal(workoutNeedsDetail({ id: "w2", exercises: [] }), false, "hydrated rows are never re-fetched");
    assert.equal(workoutNeedsDetail(null), false);
});

test("today's plan is the own planned session dated today, and only that", () => {
    const sets = [{ type: "warmup" }, { type: "working" }];
    const plan = { id: "today", userId: "me", status: "planned", date: TODAY, exercises: [{ sets }] };
    const rows = [
        { id: "past", userId: "me", status: "planned", date: "2026-08-19", exercises: [{ sets }] },
        { id: "peer", userId: "peer", status: "planned", date: TODAY, exercises: [{ sets }] },
        { id: "summary", userId: "me", status: "planned", date: TODAY, setCount: 0 },
        { id: "done", userId: "me", status: "completed", date: TODAY, exercises: [] },
        { id: "next", userId: "me", status: "planned", date: "2026-08-22", exercises: [{ sets }] },
        plan
    ];
    assert.equal(todayPlannedWorkout(rows, "me", TODAY)?.id, "today");
    assert.equal(todayPlannedWorkout(rows.filter((row) => row !== plan), "me", TODAY), null, "a past or future plan is never today's");
    assert.equal(todayPlannedWorkout([{ ...plan, date: `${TODAY}T00:00:00.000Z` }], "me", TODAY)?.id, "today", "an ISO date still matches its day");
    assert.equal(todayPlannedWorkout(rows, "", TODAY), null);
});

test("planned set counts include un-ticked sets and split warm-ups out", () => {
    const plan = { exercises: [
        { sets: [{ type: "warmup" }, { type: "warmup" }, { type: "working" }, { type: "working", isCompleted: true }] },
        { sets: [{ type: "warmup" }, { type: "drop" }] }
    ] };
    assert.deepEqual(plannedSetCounts(plan), { exercises: 2, working: 3, warmup: 3 });
    assert.deepEqual(plannedSetCounts({ exercises: [] }), { exercises: 0, working: 0, warmup: 0 });
    assert.equal(plannedSetCounts({ setCount: 4 }), null, "a summary has nothing to count");
});
