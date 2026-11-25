import test from "node:test";
import assert from "node:assert/strict";
import { mergeWorkout, planResync, snapshotWorkout } from "./realtime.js";

const set = (id, weight, repetitions, extra = {}) => ({ id, type: "working", weight, repetitions, durationSeconds: null, rpe: 0, restSeconds: 120, isCompleted: false, notes: "", ...extra });
const exercise = (id, exerciseId, sets, extra = {}) => ({ id, exerciseId, order: 1, notes: "", sets, ...extra });

function workout(overrides = {}) {
    return {
        id: "w1",
        userId: "me",
        date: "2026-11-27",
        title: "Груди",
        status: "planned",
        workoutType: "push",
        notes: "",
        durationOverride: null,
        firstSetAt: null,
        lastSetAt: null,
        supersetGroups: [],
        cardioSessions: [],
        exercises: [
            exercise("e1", "bench", [set("s1", 60, 10), set("s2", 80, 8), set("s3", 80, 8)]),
            exercise("e2", "row", [set("s4", 70, 10)])
        ],
        ...overrides
    };
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const weights = (item) => item.exercises.map((entry) => entry.sets.map((s) => s.weight));

test("a change made elsewhere is taken when this device changed nothing", () => {
    const base = snapshotWorkout(workout());
    const local = workout();
    const server = clone(workout());
    server.exercises[0].sets[1].weight = 82.5;
    server.date = "2026-11-28";
    const result = mergeWorkout(base, local, server);
    assert.equal(result.changedLocally, false);
    assert.equal(result.conflicts, 0);
    assert.equal(result.workout.date, "2026-11-28");
    assert.deepEqual(weights(result.workout), [[60, 82.5, 80], [70]]);
});

test("an old copy with the same number of sets no longer overwrites a changed weight", () => {
    // The case the count-based check got wrong: equal counts, different values.
    const base = snapshotWorkout(workout());
    const local = workout();
    local.exercises[0].sets[0].isCompleted = true;
    const server = clone(workout());
    server.exercises[0].sets[2].weight = 85;
    server.notes = "deload";
    const result = mergeWorkout(base, local, server);
    assert.equal(result.changedLocally, true);
    assert.equal(result.conflicts, 0);
    assert.equal(result.workout.exercises[0].sets[0].isCompleted, true);
    assert.equal(result.workout.exercises[0].sets[2].weight, 85);
    assert.equal(result.workout.notes, "deload");
});

test("when both devices change the same field, this device's value stays and is counted", () => {
    const base = snapshotWorkout(workout());
    const local = workout();
    local.exercises[0].sets[1].weight = 90;
    const server = clone(workout());
    server.exercises[0].sets[1].weight = 85;
    const result = mergeWorkout(base, local, server);
    assert.equal(result.workout.exercises[0].sets[1].weight, 90);
    assert.equal(result.conflicts, 1);
});

test("a set performed on the other device keeps its logged numbers", () => {
    const base = snapshotWorkout(workout());
    const local = workout();
    local.exercises[0].sets[1].weight = 75;
    const server = clone(workout());
    Object.assign(server.exercises[0].sets[1], { weight: 85, repetitions: 6, isCompleted: true });
    const result = mergeWorkout(base, local, server);
    assert.deepEqual(
        { weight: result.workout.exercises[0].sets[1].weight, reps: result.workout.exercises[0].sets[1].repetitions, done: result.workout.exercises[0].sets[1].isCompleted },
        { weight: 85, reps: 6, done: true }
    );
});

test("additions and deletions from both sides are kept, by id", () => {
    const base = snapshotWorkout(workout());
    const local = workout();
    local.exercises[1].sets.push(set("s5", 70, 8));
    local.exercises[0].sets.splice(0, 1);
    const server = clone(workout());
    server.exercises.splice(1, 0, exercise("e3", "dip", [set("s6", 0, 12)]));
    server.exercises[0].sets.splice(2, 1);
    const result = mergeWorkout(base, local, server);
    assert.deepEqual(result.workout.exercises.map((entry) => entry.id), ["e1", "e3", "e2"]);
    assert.deepEqual(result.workout.exercises[0].sets.map((s) => s.id), ["s2"]);
    assert.deepEqual(result.workout.exercises[2].sets.map((s) => s.id), ["s4", "s5"]);
    assert.deepEqual(result.workout.exercises.map((entry) => entry.order), [1, 2, 3]);
});

test("an exercise deleted here but changed elsewhere is kept rather than lost", () => {
    const base = snapshotWorkout(workout());
    const local = workout();
    local.exercises.splice(1, 1);
    const server = clone(workout());
    server.exercises[1].sets[0].weight = 75;
    const result = mergeWorkout(base, local, server);
    assert.deepEqual(result.workout.exercises.map((entry) => entry.id), ["e1", "e2"]);
    assert.equal(result.workout.exercises[1].sets[0].weight, 75);
    assert.equal(result.conflicts, 1);
});

test("a reorder made here survives and an exercise added elsewhere is slotted in", () => {
    const base = snapshotWorkout(workout());
    const local = workout();
    local.exercises.reverse();
    const server = clone(workout());
    server.exercises.push(exercise("e3", "dip", [set("s6", 0, 12)]));
    const result = mergeWorkout(base, local, server);
    assert.deepEqual(result.workout.exercises.map((entry) => entry.id), ["e2", "e1", "e3"]);
});

test("the gym clock keeps the widest span when both devices moved it", () => {
    const base = snapshotWorkout(workout({ status: "active", firstSetAt: "2026-11-27T10:00:00.000Z", lastSetAt: "2026-11-27T10:05:00.000Z" }));
    const local = workout({ status: "active", firstSetAt: "2026-11-27T10:00:00.000Z", lastSetAt: "2026-11-27T10:20:00.000Z" });
    const server = workout({ status: "active", firstSetAt: "2026-11-27T10:00:00.000Z", lastSetAt: "2026-11-27T10:25:00.000Z" });
    const result = mergeWorkout(base, local, server);
    assert.equal(result.workout.lastSetAt, "2026-11-27T10:25:00.000Z");
});

test("superset rest and cardio follow the side that changed them, members stay together", () => {
    const grouped = () => workout({
        supersetGroups: [{ id: "g1", restSeconds: 90 }],
        exercises: [
            exercise("e1", "bench", [set("s1", 60, 10)], { supersetGroupId: "g1" }),
            exercise("e2", "fly", [set("s2", 20, 12)], { supersetGroupId: "g1" }),
            exercise("e3", "dip", [set("s3", 0, 12)])
        ],
        cardioSessions: [{ type: "treadmill", durationMinutes: 10 }]
    });
    const base = snapshotWorkout(grouped());
    const local = grouped();
    local.exercises = [local.exercises[0], local.exercises[2], local.exercises[1]];
    const server = clone(grouped());
    server.supersetGroups[0].restSeconds = 150;
    server.cardioSessions = [{ type: "bike", durationMinutes: 20 }];
    const result = mergeWorkout(base, local, server);
    assert.equal(result.workout.supersetGroups[0].restSeconds, 150);
    assert.equal(result.workout.cardioSessions[0].type, "bike");
    const order = result.workout.exercises.map((entry) => entry.id);
    assert.equal(Math.abs(order.indexOf("e1") - order.indexOf("e2")), 1);
});

test("copies that cannot be matched by id fall back to the old rule", () => {
    const base = snapshotWorkout(workout());
    const local = workout();
    delete local.exercises[0].sets[0].id;
    assert.equal(mergeWorkout(base, local, workout()), null);
    assert.equal(mergeWorkout(null, workout(), workout()), null);
    assert.equal(mergeWorkout(base, { title: "summary" }, workout()), null);
});

test("snapshots compare like the save payload, so a reloaded copy equals the saved one", () => {
    const saved = workout();
    const reloaded = clone(saved);
    reloaded.exercises[0].sets[0].rpe = null;
    reloaded.exercises[0].sets[0].restSeconds = 0;
    saved.exercises[0].sets[0].restSeconds = 90;
    assert.deepEqual(snapshotWorkout(reloaded), snapshotWorkout(saved));
});

// ---- resync after a gap ---------------------------------------------------------

const row = (id, date, updatedAt) => ({ id, date, updatedAt, exercises: [], cardioSessions: [] });
const held = (id, date, serverVersion, extra = {}) => ({ id, date, serverVersion, exercises: [], cardioSessions: [], ...extra });
const idle = () => false;

test("a newer server row is re-read, an unknown one added", () => {
    const plan = planResync({
        local: [held("a", "2026-11-27", "2026-11-25T10:00:00.000Z")],
        server: [row("b", "2026-11-28", "2026-11-25T11:00:00.000Z"), row("a", "2026-11-27", "2026-11-25T12:00:00.000Z")],
        complete: true,
        busy: idle
    });
    assert.deepEqual(plan.adopt.map((item) => item.id), ["a"]);
    assert.deepEqual(plan.add.map((item) => item.id), ["b"]);
    assert.deepEqual(plan.remove, []);
});

test("nothing is touched while this device has a save pending for it", () => {
    const plan = planResync({
        local: [held("a", "2026-11-27", "2026-11-25T10:00:00.000Z"), held("gone", "2026-11-28", "2026-11-25T10:00:00.000Z")],
        server: [row("a", "2026-11-27", "2026-11-25T12:00:00.000Z")],
        complete: true,
        busy: (id) => id === "a" || id === "gone"
    });
    assert.deepEqual(plan, { adopt: [], add: [], remove: [] });
});

test("a row missing from the page counts as deleted only inside the dates the page covers", () => {
    const plan = planResync({
        local: [
            held("newer-gone", "2026-11-29", "2026-11-25T10:00:00.000Z"),
            held("boundary", "2026-11-20", "2026-11-25T10:00:00.000Z"),
            held("older", "2026-11-01", "2026-11-25T10:00:00.000Z"),
            held("never-saved", "2026-11-28", null)
        ],
        server: [row("x", "2026-11-27", "2026-11-25T10:00:00.000Z"), row("y", "2026-11-20", "2026-11-25T10:00:00.000Z")],
        complete: false,
        busy: idle
    });
    assert.deepEqual(plan.remove, ["newer-gone"]);
});

test("a complete page proves every missing synced row was deleted", () => {
    const plan = planResync({
        local: [held("old", "2025-01-01", "2026-11-25T10:00:00.000Z")],
        server: [],
        complete: true,
        busy: idle
    });
    assert.deepEqual(plan.remove, ["old"]);
});

test("a summary row is replaced by the full one even at the same version", () => {
    const summary = { id: "a", date: "2026-11-27", serverVersion: "2026-11-25T10:00:00.000Z" };
    const plan = planResync({ local: [summary], server: [row("a", "2026-11-27", "2026-11-25T10:00:00.000Z")], complete: true, busy: idle });
    assert.deepEqual(plan.adopt.map((item) => item.id), ["a"]);
});
