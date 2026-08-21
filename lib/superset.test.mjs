import test from "node:test";
import assert from "node:assert/strict";
import {
    SUPERSET_MAX_MEMBERS, SUPERSET_MIN_MEMBERS,
    positionLabel, supersetMembers, workoutBlocks, roundCount, roundSets,
    isRoundComplete, currentRoundIndex, nextMemberInRound, missingSetCount,
    mergeProblem, roundSummary
} from "./superset.js";

/**
 * A round is the Nth set of each member. Every function here is a VIEW over the sets
 * that already exist, which is what keeps volume, records, history and statistics
 * working without knowing supersets exist at all.
 */

const set = (done, extra = {}) => ({ isCompleted: done, weight: 60, repetitions: 10, durationSeconds: null, ...extra });
const member = (order, groupId, sets) => ({ id: `we-${order}`, order, supersetGroupId: groupId, sets });

const pair = () => [
    member(1, "g1", [set(true), set(false), set(false)]),
    member(2, "g1", [set(true), set(false), set(false)])
];

test("members are labelled A1, A2, A3", () => {
    assert.equal(positionLabel(0), "A1");
    assert.equal(positionLabel(2), "A3");
});

test("members come back grouped and in workout order", () => {
    const groups = supersetMembers([member(2, "g1", []), member(1, "g1", []), member(3, null, [])]);
    assert.deepEqual([...groups.keys()], ["g1"]);
    assert.deepEqual(groups.get("g1").map((item) => item.order), [1, 2]);
});

test("an ungrouped exercise belongs to no group", () => {
    assert.equal(supersetMembers([member(1, null, [])]).size, 0);
    assert.equal(supersetMembers([]).size, 0);
    assert.equal(supersetMembers(null).size, 0);
});

test("blocks put a whole superset in one place and keep loose exercises apart", () => {
    const blocks = workoutBlocks([...pair(), member(3, null, [set(false)])]);
    assert.deepEqual(blocks.map((block) => block.kind), ["superset", "exercise"]);
    assert.equal(blocks[0].members.length, 2);
    assert.equal(blocks[0].groupId, "g1");
});

test("a group takes the position of its first member", () => {
    // This is what lets a superset move as one block without a second ordering system.
    const blocks = workoutBlocks([member(1, null, []), member(2, "g1", []), member(3, "g1", [])]);
    assert.deepEqual(blocks.map((block) => block.kind), ["exercise", "superset"]);
});

test("members that ended up non-adjacent still draw ONE card", () => {
    // Two cards with the same heading would be worse than gathering them.
    const blocks = workoutBlocks([member(1, "g1", []), member(2, null, []), member(3, "g1", [])]);
    assert.deepEqual(blocks.map((block) => block.kind), ["superset", "exercise"]);
    assert.equal(blocks[0].members.length, 2);
});

test("the longest member decides the round count", () => {
    assert.equal(roundCount(pair()), 3);
    assert.equal(roundCount([member(1, "g1", [set(false)]), member(2, "g1", [set(false), set(false)])]), 2);
    assert.equal(roundCount([]), 0);
});

test("a round is the Nth set of each member, aligned to A1", () => {
    const members = pair();
    const round = roundSets(members, 0);
    assert.equal(round.length, 2);
    assert.equal(round[0], members[0].sets[0]);
    assert.equal(round[1], members[1].sets[0]);
});

test("a member missing that set contributes null rather than shifting the round", () => {
    const members = [member(1, "g1", [set(false), set(false)]), member(2, "g1", [set(false)])];
    assert.deepEqual(roundSets(members, 1).map(Boolean), [true, false]);
});

test("a round is complete only when every set in it is", () => {
    const members = pair();
    assert.equal(isRoundComplete(members, 0), true);
    assert.equal(isRoundComplete(members, 1), false);
    members[0].sets[1].isCompleted = true;
    assert.equal(isRoundComplete(members, 1), false, "A2 is still unfinished");
    members[1].sets[1].isCompleted = true;
    assert.equal(isRoundComplete(members, 1), true);
});

test("an empty round is not complete", () => {
    assert.equal(isRoundComplete([member(1, "g1", [])], 0), false);
});

test("the current round is the first unfinished one", () => {
    assert.equal(currentRoundIndex(pair()), 1);
});

test("a finished group reports the round count, so «done» is distinguishable", () => {
    const members = [member(1, "g1", [set(true)]), member(2, "g1", [set(true)])];
    assert.equal(currentRoundIndex(members), 1);
    assert.equal(roundCount(members), 1);
});

test("focus moves to the first unfinished member of the round", () => {
    const members = pair();
    assert.equal(nextMemberInRound(members, 1), 0);
    members[1].sets[1].isCompleted = true;
    assert.equal(nextMemberInRound(members, 1), 0);
    members[0].sets[1].isCompleted = true;
    // Round done — the caller starts the shared rest instead of moving on.
    assert.equal(nextMemberInRound(members, 1), null);
});

test("missing sets are counted so every member can be levelled to the round count", () => {
    assert.equal(missingSetCount(member(1, "g1", [set(false)]), 3), 2);
    assert.equal(missingSetCount(member(1, "g1", [set(false), set(false), set(false)]), 3), 0);
    assert.equal(missingSetCount(member(1, "g1", []), 0), 0);
    assert.equal(missingSetCount({ order: 1 }, 2), 2);
});

test("merging needs two or three loose exercises", () => {
    const loose = (order) => member(order, null, []);
    assert.equal(mergeProblem([loose(1), loose(2)]), null);
    assert.equal(mergeProblem([loose(1), loose(2), loose(3)]), null);
    assert.match(mergeProblem([loose(1)]), new RegExp(String(SUPERSET_MIN_MEMBERS)));
    assert.match(mergeProblem([loose(1), loose(2), loose(3), loose(4)]), new RegExp(String(SUPERSET_MAX_MEMBERS)));
});

test("an exercise already in a superset cannot be merged again", () => {
    // Merging a group into a group is a different operation with different consequences;
    // declining is better than silently doing it.
    assert.match(mergeProblem([member(1, "g1", []), member(2, null, [])]), /у суперсеті/);
});

test("a collapsed round shows weight by reps, and drops a weight of zero", () => {
    assert.equal(roundSummary(set(true, { weight: 60, repetitions: 10 })), "60×10");
    assert.equal(roundSummary(set(true, { weight: 0, repetitions: 12 })), "12");
    assert.equal(roundSummary(set(true, { weight: 0, durationSeconds: 45 })), "45 с");
    assert.equal(roundSummary(set(true, { weight: 20, durationSeconds: 45 })), "20×45 с");
    assert.equal(roundSummary(null), "—");
});
