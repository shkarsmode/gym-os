import test from "node:test";
import assert from "node:assert/strict";
import { liveSetRecords } from "./live-records.js";
import { oneRepMax } from "./scoring.js";

const set = (id, weight, repetitions, extra = {}) => ({ id, weight, repetitions, type: "working", isCompleted: true, durationSeconds: null, ...extra });

test("a completed set that beats the previous best is a record", () => {
    const best = oneRepMax(100, 5);
    const records = liveSetRecords([set("a", 100, 5), set("b", 102.5, 5)], best);
    assert.deepEqual([...records.keys()], ["b"]);
    assert.equal(records.get("b").e1rm, oneRepMax(102.5, 5));
    assert.ok(records.get("b").gain > 0);
});

test("equalling the record is not a record", () => {
    assert.equal(liveSetRecords([set("a", 100, 5)], oneRepMax(100, 5)).size, 0);
});

test("each record raises the bar for the next set today", () => {
    const records = liveSetRecords([set("a", 105, 5), set("b", 100, 6), set("c", 110, 5)], oneRepMax(100, 5));
    assert.deepEqual([...records.keys()], ["a", "c"]);
    assert.equal(records.get("c").previous, oneRepMax(105, 5));
});

test("only finished working sets with a weight count", () => {
    const sets = [
        set("open", 120, 5, { isCompleted: false }),
        set("warm", 120, 5, { type: "warmup" }),
        set("hold", 120, 0, { durationSeconds: 60 }),
        set("bodyweight", 0, 30)
    ];
    assert.equal(liveSetRecords(sets, oneRepMax(100, 5)).size, 0);
});

test("the first time doing an exercise is not a record", () => {
    assert.equal(liveSetRecords([set("a", 60, 8)], 0).size, 0);
    assert.equal(liveSetRecords([set("a", 60, 8)], null).size, 0);
});
