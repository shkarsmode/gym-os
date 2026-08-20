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

// ---- live stream --------------------------------------------------------------------

import { backoffDelay, parseSseFrames, shouldApplyRemote } from "./realtime.js";

test("a complete frame is parsed into name and payload", () => {
    const { events, rest } = parseSseFrames('event: workout.changed\ndata: {"ids":["w1"]}\n\n');
    assert.deepEqual(events, [{ name: "workout.changed", data: { ids: ["w1"] } }]);
    assert.equal(rest, "");
});

test("a frame split across chunk boundaries survives", () => {
    // A chunk boundary can fall anywhere, including inside the JSON.
    const first = parseSseFrames('event: workout.changed\ndata: {"ids":["w');
    assert.deepEqual(first.events, []);

    const second = parseSseFrames(first.rest + '1"]}\n\n');
    assert.deepEqual(second.events, [{ name: "workout.changed", data: { ids: ["w1"] } }]);
});

test("several frames arriving in one chunk are all returned", () => {
    const { events } = parseSseFrames(
        'event: a\ndata: {"n":1}\n\nevent: b\ndata: {"n":2}\n\n'
    );
    assert.deepEqual(events.map((item) => item.data.n), [1, 2]);
});

test("heartbeat comments are ignored without ending the stream", () => {
    const { events, rest } = parseSseFrames(': keep-alive\n\nevent: ping\ndata: {"name":"ping"}\n\n');
    assert.deepEqual(events, [{ name: "ping", data: { name: "ping" } }]);
    assert.equal(rest, "");
});

test("CRLF and lone CR line endings parse the same as LF", () => {
    // The spec allows all three and a proxy may rewrite them.
    const { events } = parseSseFrames('event: workout.changed\r\ndata: {"ids":["w1"]}\r\n\r\n');
    assert.deepEqual(events, [{ name: "workout.changed", data: { ids: ["w1"] } }]);
});

test("an unreadable frame is dropped rather than killing the connection", () => {
    // A hint carries no data of its own, so losing one costs a refresh; throwing would
    // cost the whole stream.
    const { events } = parseSseFrames('event: workout.changed\ndata: {not json\n\nevent: ok\ndata: {"n":1}\n\n');
    assert.deepEqual(events, [{ name: "ok", data: { n: 1 } }]);
});

test("backoff grows, is capped, and is dithered", () => {
    // Undithered, a redeploy brings every device back in the same instant — the exact
    // spike the backoff exists to absorb.
    assert.equal(backoffDelay(1, () => 0), 500);
    assert.equal(backoffDelay(1, () => 1), 1000);
    assert.equal(backoffDelay(4, () => 1), 8000);
    assert.equal(backoffDelay(20, () => 1), 30000);
    assert.equal(backoffDelay(20, () => 0), 15000);
});

test("a hint is ignored while this device has a save in flight", () => {
    // The local copy is newer than anything the server can report; adopting the server's
    // would undo the edit being made right now.
    assert.equal(shouldApplyRemote({
        version: "2026-08-20T10:00:05.000Z",
        held: "2026-08-20T10:00:00.000Z",
        busy: true
    }), false);
});

test("a hint naming a newer version is acted on", () => {
    assert.equal(shouldApplyRemote({
        version: "2026-08-20T10:00:05.000Z",
        held: "2026-08-20T10:00:00.000Z",
        busy: false
    }), true);
});

test("a hint this device already has is ignored", () => {
    // Every device hears its own save echoed back; re-fetching on it would double every
    // write's cost for no change on screen.
    assert.equal(shouldApplyRemote({
        version: "2026-08-20T10:00:00.000Z",
        held: "2026-08-20T10:00:00.000Z",
        busy: false
    }), false);
});

test("a row this device has never seen is always fetched", () => {
    assert.equal(shouldApplyRemote({ version: "2026-08-20T10:00:00.000Z", held: null, busy: false }), true);
});

test("a hint with no version is fetched rather than guessed at", () => {
    assert.equal(shouldApplyRemote({ version: null, held: "2026-08-20T10:00:00.000Z", busy: false }), true);
});
