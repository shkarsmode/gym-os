import test from "node:test";
import assert from "node:assert/strict";
import {
    conflictVersion,
    isStaleConflict,
    isVersionBehind,
    localIsAhead,
    serverVersionOf
} from "./realtime.js";

const workout = (exercises, cardioSessions = []) => ({ exercises, cardioSessions });
const exercise = (exerciseId, sets) => ({ exerciseId, sets });
const set = (isCompleted = false) => ({ weight: 60, repetitions: 10, isCompleted });

test("serverVersionOf reads the wire field and nothing else", () => {
    assert.equal(serverVersionOf({ updatedAt: "2026-08-20T10:00:00.000Z" }), "2026-08-20T10:00:00.000Z");
    assert.equal(serverVersionOf({ updatedAt: null }), null);
    assert.equal(serverVersionOf({}), null);
    assert.equal(serverVersionOf(null), null);
});

test("a stale conflict is told apart from the other 409 the same endpoint raises", () => {
    // Both refusals are 409; only the code says whether to re-read or to confirm.
    assert.equal(isStaleConflict({ status: 409, body: { code: "STALE_WORKOUT" } }), true);
    assert.equal(isStaleConflict({ status: 409, body: { code: "WOULD_ERASE_EXERCISES" } }), false);
    assert.equal(isStaleConflict({ status: 500, body: { code: "STALE_WORKOUT" } }), false);
    assert.equal(isStaleConflict(null), false);
});

test("the conflict body is read whichever name the caller attached it under", () => {
    const version = "2026-08-20T10:00:00.000Z";
    for (const key of ["body", "data", "response", "payload"]) {
        const error = { status: 409, [key]: { code: "STALE_WORKOUT", currentUpdatedAt: version } };
        assert.equal(isStaleConflict(error), true, key);
        assert.equal(conflictVersion(error), version, key);
    }
    assert.equal(conflictVersion({ status: 409 }), null);
});

test("versions compare at second resolution, because the wire drops microseconds", () => {
    // A round-tripped timestamp is routinely a fraction behind the stored one; treating
    // that as stale would reject a save immediately after it succeeded.
    assert.equal(isVersionBehind("2026-08-20T10:00:00.000Z", "2026-08-20T10:00:00.812Z"), false);
    assert.equal(isVersionBehind("2026-08-20T10:00:00.000Z", "2026-08-20T10:00:01.000Z"), true);
    assert.equal(isVersionBehind("2026-08-20T10:00:02.000Z", "2026-08-20T10:00:01.000Z"), false);
    assert.equal(isVersionBehind(null, "2026-08-20T10:00:01.000Z"), false);
    assert.equal(isVersionBehind("nonsense", "also-nonsense"), false);
});

test("a local copy carrying everything the server has is safe to re-save", () => {
    const server = workout([exercise("bench", [set(true), set(true)])]);
    const local = workout([exercise("bench", [set(true), set(true), set(false)])]);
    assert.equal(localIsAhead(local, server), true);
});

test("a local copy missing sets the server has is NOT safe to re-save", () => {
    // This is the data-loss shape: the phone would recreate the tree without the two
    // sets ticked on the desktop.
    const server = workout([exercise("bench", [set(true), set(true), set(true)])]);
    const local = workout([exercise("bench", [set(true)])]);
    assert.equal(localIsAhead(local, server), false);
});

test("a local copy missing a whole exercise the server has is not safe", () => {
    const server = workout([exercise("bench", [set(true)]), exercise("row", [set(true)])]);
    const local = workout([exercise("bench", [set(true)])]);
    assert.equal(localIsAhead(local, server), false);
});

test("fewer completed sets means the other device ticked something this copy lacks", () => {
    // Same shape, different progress: re-saving would un-tick real work.
    const server = workout([exercise("bench", [set(true), set(true)])]);
    const local = workout([exercise("bench", [set(true), set(false)])]);
    assert.equal(localIsAhead(local, server), false);
});

test("the same exercise twice in a session is counted, not overwritten", () => {
    // A second bench block later in the workout is legitimate; treating the key as
    // unique would report the local copy as complete when it is missing a block.
    const server = workout([exercise("bench", [set(true), set(true)]), exercise("bench", [set(true), set(true)])]);
    const local = workout([exercise("bench", [set(true), set(true)])]);
    assert.equal(localIsAhead(local, server), false);
});

test("dropped cardio counts as loss", () => {
    const server = workout([], [{ durationMinutes: 20 }]);
    const local = workout([], []);
    assert.equal(localIsAhead(local, server), false);
});

test("an unhydrated copy is never treated as ahead", () => {
    // A peer summary carries no `exercises` key at all. Re-saving one would erase a
    // whole session, which is exactly what the server's other 409 guards against.
    const server = workout([exercise("bench", [set(true)])]);
    assert.equal(localIsAhead({ totalVolume: 1000 }, server), false);
    assert.equal(localIsAhead(workout([]), { totalVolume: 1000 }), false);
    assert.equal(localIsAhead(null, server), false);
});
