// The gym clock: the session stopwatch anchored on the first ticked set.
//
//   node --test lib/gym-clock.test.mjs
//
// This module decides what a number on the workout screen says, and every way it can be
// wrong is silent — nothing throws, the chip just tells the athlete a confident lie. Two
// lies in particular are what the design is built to prevent, so they are what this file
// pins down:
//
//   1. "Тренування йде 18:42:07." A session left active overnight must stop presenting
//      as live past GYM_CLOCK_MAX_MS and fall back to the start time instead. The whole
//      reason the span is never written to durationOverride is that the number cannot be
//      trusted; a runaway live clock would put that untrustworthy number on screen anyway.
//   2. A rewound start. `firstSetAt` is written once. Re-ticking an earlier set, or any
//      later set at all, must not move the anchor — the clock would visibly jump backwards.
//
// Plus the crash class this codebase keeps re-learning: peer rows under the windowed
// payload have NO `exercises` key at all, and anything that walks sets must survive one.
//
// Every case passes an explicit `now`. A stopwatch tested against the wall clock is a
// test that fails at 05:00:00.001 of elapsed time and nowhere else.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    GYM_CLOCK_MAX_MS,
    formatClock,
    formatDurationLabel,
    gymClockState,
    nextGymClockMarks,
    suggestedDurationMinutes,
    timeOfDay
} from "./gym-clock.js";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

// Built from local components: timeOfDay reads the LOCAL calendar, so a UTC literal would
// assert a wall-clock reading no user in Kyiv ever sees.
const START = new Date(2026, 7, 20, 18, 5, 0);
const iso = (date) => date.toISOString();
const after = (ms) => new Date(START.getTime() + ms);

// A hydrated own-workout row: `sets` is an array of { isCompleted }, nothing else here
// reads any other field.
function workout({ status = "active", marks = {}, sets = [false, false] } = {}) {
    return {
        id: "w-1",
        status,
        firstSetAt: marks.firstSetAt ?? null,
        lastSetAt: marks.lastSetAt ?? null,
        exercises: [{ id: "we-1", exerciseId: "ex-bench", sets: sets.map((isCompleted, index) => ({ id: `s-${index}`, isCompleted })) }]
    };
}

// ---------------------------------------------------------------- nextGymClockMarks

test("the first ticked set stamps both marks", () => {
    const marks = nextGymClockMarks(workout({ sets: [true, false] }), START);
    assert.equal(marks.firstSetAt, iso(START));
    assert.equal(marks.lastSetAt, iso(START));
});

test("firstSetAt is written once and never moves as later sets are ticked", () => {
    // The anchor rewinding is the one failure the user would actually see: the chip counts
    // up for twenty minutes and then snaps back to 0:00 the moment they finish a set.
    let item = workout({ sets: [true, false, false] });
    Object.assign(item, nextGymClockMarks(item, START));
    const anchor = item.firstSetAt;

    item.exercises[0].sets[1].isCompleted = true;
    Object.assign(item, nextGymClockMarks(item, after(12 * MINUTE)));
    assert.equal(item.firstSetAt, anchor, "the second set moved the session's start time");
    assert.equal(item.lastSetAt, iso(after(12 * MINUTE)), "lastSetAt did not advance");

    item.exercises[0].sets[2].isCompleted = true;
    Object.assign(item, nextGymClockMarks(item, after(47 * MINUTE)));
    assert.equal(item.firstSetAt, anchor, "the last set moved the session's start time");
    assert.equal(item.lastSetAt, iso(after(47 * MINUTE)));
});

test("lastSetAt advances even when the tick happens out of order", () => {
    // Athletes tick set 3 before set 2 all the time. The end mark tracks the latest ACTION,
    // not the position of the set in the list.
    const item = workout({ marks: { firstSetAt: iso(START), lastSetAt: iso(after(5 * MINUTE)) }, sets: [true, false, true] });
    const marks = nextGymClockMarks(item, after(9 * MINUTE));
    assert.equal(marks.firstSetAt, iso(START));
    assert.equal(marks.lastSetAt, iso(after(9 * MINUTE)));
});

test("un-ticking the last completed set clears BOTH marks", () => {
    // A session emptied by mistake must keep no phantom start time; otherwise the clock
    // reads "started at 18:05" for a workout with nothing done in it.
    const item = workout({ marks: { firstSetAt: iso(START), lastSetAt: iso(after(20 * MINUTE)) }, sets: [false, false] });
    assert.deepEqual(nextGymClockMarks(item, after(21 * MINUTE)), { firstSetAt: null, lastSetAt: null });
});

test("un-ticking one of several completed sets keeps the marks intact", () => {
    const item = workout({ marks: { firstSetAt: iso(START), lastSetAt: iso(after(20 * MINUTE)) }, sets: [true, false] });
    const marks = nextGymClockMarks(item, after(21 * MINUTE));
    assert.equal(marks.firstSetAt, iso(START), "a correction on one set wiped the whole session's clock");
    assert.equal(marks.lastSetAt, iso(after(21 * MINUTE)));
});

test("a peer summary row with no exercises key at all does not throw", () => {
    // Windowed payload: peer rows carry totalVolume/setCount aggregates and NO `exercises`.
    // Every set-walking function in this codebase has crashed on one at least once.
    const peer = { id: "w-peer", status: "completed", totalVolume: 4618, setCount: 21, exerciseCount: 5, seq: 3 };
    assert.deepEqual(nextGymClockMarks(peer, START), { firstSetAt: null, lastSetAt: null });
});

test("an exercise with no sets key, and an empty workout, are treated as empty not fatal", () => {
    assert.deepEqual(nextGymClockMarks({ exercises: [{ id: "we-1" }] }, START), { firstSetAt: null, lastSetAt: null });
    assert.deepEqual(nextGymClockMarks({ exercises: [] }, START), { firstSetAt: null, lastSetAt: null });
});

test("`now` may be a timestamp or an ISO string, not only a Date", () => {
    // Callers hand over whatever they have on hand; all three must stamp the same instant.
    const item = workout({ sets: [true] });
    assert.equal(nextGymClockMarks(item, START.getTime()).lastSetAt, iso(START));
    assert.equal(nextGymClockMarks(item, iso(START)).lastSetAt, iso(START));
});

// ---------------------------------------------------------------- gymClockState

test("there is nothing to show before the first set is ticked", () => {
    // The chip is absent, not "0:00" — a zeroed stopwatch invites the user to wonder why
    // it is not moving.
    assert.equal(gymClockState(workout({ sets: [false, false] }), START.getTime()), null);
    assert.equal(gymClockState(null, START.getTime()), null);
    assert.equal(gymClockState(undefined, START.getTime()), null);
});

test("a malformed firstSetAt yields no clock rather than a NaN one", () => {
    // Imported rows and hand-edited payloads reach this. `NaN:NaN` on screen is worse
    // than no chip.
    for (const bad of ["not-a-date", "0000-13-45", {}]) {
        assert.equal(gymClockState(workout({ marks: { firstSetAt: bad }, sets: [true, false] }), START.getTime()), null, `firstSetAt ${JSON.stringify(bad)} produced a clock`);
    }
});

test("an active workout with sets remaining ticks live off `now`", () => {
    const item = workout({ marks: { firstSetAt: iso(START), lastSetAt: iso(after(3 * MINUTE)) }, sets: [true, false] });
    const state = gymClockState(item, after(23 * MINUTE).getTime());
    assert.equal(state.ms, 23 * MINUTE, "a live clock must run to now, not to the last tick");
    assert.equal(state.live, true);
    assert.equal(state.overflow, false);
    assert.equal(state.startLabel, "18:05");
});

test("the clock FREEZES at the last tick once every set is done, even while still active", () => {
    // The session is not finished — the user has not pressed «Завершити» — but the work is.
    // Letting it keep running would count the shower and the drive home.
    const item = workout({ marks: { firstSetAt: iso(START), lastSetAt: iso(after(52 * MINUTE)) }, sets: [true, true] });
    const state = gymClockState(item, after(3 * HOUR).getTime());
    assert.equal(state.ms, 52 * MINUTE, "a fully completed workout kept counting past its last set");
    assert.equal(state.live, false);
    assert.equal(state.overflow, false, "a frozen 52-minute span is not an overflow");
});

test("a finished or planned workout is frozen regardless of its sets", () => {
    const marks = { firstSetAt: iso(START), lastSetAt: iso(after(64 * MINUTE)) };
    for (const status of ["completed", "planned"]) {
        const state = gymClockState(workout({ status, marks, sets: [true, false] }), after(9 * HOUR).getTime());
        assert.equal(state.ms, 64 * MINUTE, `status "${status}" was still counting up`);
        assert.equal(state.live, false, `status "${status}" presented as live`);
    }
});

test("a frozen workout with no lastSetAt collapses to a zero span", () => {
    // Rows saved before the marks existed have firstSetAt backfilled and lastSetAt NULL.
    const item = workout({ status: "completed", marks: { firstSetAt: iso(START) }, sets: [true, true] });
    const state = gymClockState(item, after(2 * HOUR).getTime());
    assert.equal(state.ms, 0);
    assert.equal(state.live, false);
    assert.equal(state.startLabel, "18:05", "the start time is the only thing left to show");
});

test("ms is clamped at zero when lastSetAt precedes firstSetAt", () => {
    // Two devices with skewed clocks writing the same session. A negative span would render
    // as "0:00" through formatClock anyway, but `ms` itself feeds comparisons.
    const item = workout({ status: "completed", marks: { firstSetAt: iso(after(30 * MINUTE)), lastSetAt: iso(START) }, sets: [true, true] });
    const state = gymClockState(item, after(31 * MINUTE).getTime());
    assert.equal(state.ms, 0);
    assert.equal(state.overflow, false, "a clamped span must not be mistaken for a 5-hour one");
});

test("a peer summary with a firstSetAt gets a frozen clock, not a crash", () => {
    // Peer rows have no `exercises`, so `allDone` is false and only `status` freezes them.
    const peer = { id: "w-peer", status: "completed", firstSetAt: iso(START), lastSetAt: iso(after(41 * MINUTE)), totalVolume: 4618, setCount: 21 };
    const state = gymClockState(peer, after(6 * HOUR).getTime());
    assert.equal(state.ms, 41 * MINUTE);
    assert.equal(state.live, false);
});

// ---------------------------------------------------------------- the overflow rule

test("exactly GYM_CLOCK_MAX_MS is still a live clock", () => {
    const item = workout({ marks: { firstSetAt: iso(START), lastSetAt: iso(after(HOUR)) }, sets: [true, false] });
    const state = gymClockState(item, START.getTime() + GYM_CLOCK_MAX_MS);
    assert.equal(state.ms, GYM_CLOCK_MAX_MS);
    assert.equal(state.live, true, "the boundary itself must not cut the clock off");
    assert.equal(state.overflow, false);
});

test("one millisecond past GYM_CLOCK_MAX_MS the clock stops pretending", () => {
    const item = workout({ marks: { firstSetAt: iso(START), lastSetAt: iso(after(HOUR)) }, sets: [true, false] });
    const state = gymClockState(item, START.getTime() + GYM_CLOCK_MAX_MS + 1);
    assert.equal(state.live, false, "past the cap the clock must stop ticking");
    assert.equal(state.overflow, true);
    assert.equal(state.startLabel, "18:05", "overflow renders «з HH:MM», so the label has to be there");
});

test("the forgotten session: an 18-hour-old active workout never presents as live", () => {
    // Ticked the last set at 18:05 yesterday, never pressed «Завершити», opens the app at
    // lunch today. This is the case the whole cap exists for — the chip must read «з 18:05»,
    // not count 18 hours of training.
    const item = workout({ status: "active", marks: { firstSetAt: iso(START), lastSetAt: iso(after(40 * MINUTE)) }, sets: [true, false] });
    const state = gymClockState(item, after(18 * HOUR).getTime());
    assert.equal(state.live, false, "an overnight session was rendered as a running stopwatch");
    assert.equal(state.overflow, true);
    assert.equal(state.ms, 18 * HOUR);
    assert.equal(state.startLabel, "18:05");
});

test("overflow is reported on a frozen workout too, so a bogus span is never shown as a duration", () => {
    // A finished row whose lastSetAt landed the next morning: 14 hours between the marks.
    // `live` was already false; `overflow` is what stops the UI printing "14:02:11".
    const item = workout({ status: "completed", marks: { firstSetAt: iso(START), lastSetAt: iso(after(14 * HOUR)) }, sets: [true, true] });
    const state = gymClockState(item, after(20 * HOUR).getTime());
    assert.equal(state.overflow, true);
    assert.equal(state.live, false);
});

test("GYM_CLOCK_MAX_MS is five hours", () => {
    // Pinned because both the freeze rule and the «з HH:MM» fallback hang off it, and it
    // has to stay longer than any plausible real session.
    assert.equal(GYM_CLOCK_MAX_MS, 5 * HOUR);
});

// ---------------------------------------------------------------- formatClock

test("under an hour renders M:SS with the seconds zero-padded", () => {
    assert.equal(formatClock(0), "0:00");
    assert.equal(formatClock(7 * SECOND), "0:07");
    assert.equal(formatClock(47 * SECOND), "0:47", "a bare seconds count is unreadable at a glance");
    assert.equal(formatClock(MINUTE), "1:00");
    assert.equal(formatClock(9 * MINUTE + 5 * SECOND), "9:05");
    assert.equal(formatClock(59 * MINUTE + 59 * SECOND), "59:59");
});

test("seconds floor, never round", () => {
    // Rounding up would make the chip show 1:00 while the stopwatch is still on 0:59.
    assert.equal(formatClock(999), "0:00");
    assert.equal(formatClock(59 * SECOND + 999), "0:59");
    assert.equal(formatClock(HOUR - 1), "59:59");
});

test("at and above an hour it switches to H:MM:SS with both fields padded", () => {
    assert.equal(formatClock(HOUR), "1:00:00", "the hour boundary must not render as 60:00");
    assert.equal(formatClock(HOUR + 5 * SECOND), "1:00:05");
    assert.equal(formatClock(HOUR + MINUTE + SECOND), "1:01:01");
    assert.equal(formatClock(90 * MINUTE), "1:30:00");
    assert.equal(formatClock(GYM_CLOCK_MAX_MS), "5:00:00");
});

test("garbage degrades to 0:00 instead of putting NaN on screen", () => {
    // `formatClock(state.ms)` is called straight from the renderer; "NaN:NaN" in the sticky
    // action bar is the visible form of any upstream date bug.
    for (const bad of [-1, -HOUR, NaN, undefined, null, "", "abc", {}, Infinity * 0]) {
        assert.equal(formatClock(bad), "0:00", `formatClock(${String(bad)}) leaked a non-clock`);
    }
});

test("no output of formatClock ever contains NaN", () => {
    for (const value of [0, 1, SECOND, MINUTE, HOUR, GYM_CLOCK_MAX_MS, -5, NaN, "x"]) {
        assert.ok(!/NaN/.test(formatClock(value)), `formatClock(${String(value)}) rendered NaN`);
    }
});

// ---------------------------------------------------------------- timeOfDay

test("timeOfDay renders zero-padded local HH:MM", () => {
    // Local, not UTC: this is what the athlete's own watch said when they started.
    assert.equal(timeOfDay(new Date(2026, 7, 20, 18, 5)), "18:05");
    assert.equal(timeOfDay(new Date(2026, 7, 20, 9, 5)), "09:05", "the hour lost its leading zero");
    assert.equal(timeOfDay(new Date(2026, 7, 20, 0, 0)), "00:00", "midnight must not render as 0:0");
    assert.equal(timeOfDay(new Date(2026, 7, 20, 23, 59)), "23:59");
});

test("timeOfDay accepts an ISO string, which is what the row actually stores", () => {
    assert.equal(timeOfDay(new Date(2026, 7, 20, 7, 30).toISOString()), "07:30");
    assert.equal(timeOfDay(new Date(2026, 7, 20, 7, 30).getTime()), "07:30");
});

test("an unparseable timestamp renders empty, never «Invalid Date» or NaN:NaN", () => {
    assert.equal(timeOfDay(undefined), "");
    assert.equal(timeOfDay(""), "");
    assert.equal(timeOfDay("not-a-date"), "");
    assert.equal(timeOfDay(new Date("nope")), "");
    assert.equal(timeOfDay({}), "");
});

test("KNOWN QUIRK: timeOfDay(null) is the epoch, not empty", () => {
    // `new Date(null)` is 1970-01-01T00:00:00Z — a valid date, so the isFinite guard lets it
    // through and the label reads the local midnight of the epoch. Harmless in practice:
    // gymClockState only calls timeOfDay with a firstSetAt it has already parsed, and
    // `!workoutItem.firstSetAt` rejects null one line earlier. Asserted rather than fixed so
    // that tightening the guard is a deliberate change, not a silent one.
    assert.equal(timeOfDay(null), timeOfDay(new Date(0)));
    assert.notEqual(timeOfDay(null), "");
});

// ---------------------------------------------------------------- duration suggestion

// The three cases the athlete named when asking for this, verbatim. If the rounding rule
// is ever "simplified", these are the numbers that must survive.
const MIN = 60 * 1000;

test("suggests the duration the athlete would say out loud", () => {
    assert.equal(suggestedDurationMinutes(95 * MIN), 90);    // 1:35 -> 1:30
    assert.equal(suggestedDurationMinutes(130 * MIN), 120);  // 2:10 -> 2:00
    assert.equal(suggestedDurationMinutes(140 * MIN), 150);  // 2:20 -> 2:30
});

test("rounds to quarter-hours below an hour and half-hours above it", () => {
    // A 52-minute session rounded to the nearest half hour would read "1 год", which
    // overstates it; quarter-hour steps keep short sessions honest.
    assert.equal(suggestedDurationMinutes(52 * MIN), 45);
    assert.equal(suggestedDurationMinutes(38 * MIN), 45);
    assert.equal(suggestedDurationMinutes(61 * MIN), 60);
    assert.equal(suggestedDurationMinutes(74 * MIN), 60);
    assert.equal(suggestedDurationMinutes(76 * MIN), 90);
});

test("never suggests zero minutes", () => {
    // Rounding a very short session down to 0 would write "0 хв" into the log, which is
    // strictly worse than the smallest honest value.
    assert.equal(suggestedDurationMinutes(1 * MIN), 15);
    assert.equal(suggestedDurationMinutes(8 * MIN), 15);
});

test("declines to suggest anything for an implausible or absent span", () => {
    // Same threshold the live chip uses: past it the number is almost certainly a session
    // somebody forgot to close, and offering to write it as the duration is the exact
    // mistake the whole design avoids.
    assert.equal(suggestedDurationMinutes(GYM_CLOCK_MAX_MS + 1), null);
    assert.equal(suggestedDurationMinutes(0), null);
    assert.equal(suggestedDurationMinutes(-5), null);
    assert.equal(suggestedDurationMinutes(Number.NaN), null);
    assert.equal(suggestedDurationMinutes(undefined), null);
});

test("exactly at the cap the suggestion still stands", () => {
    assert.equal(suggestedDurationMinutes(GYM_CLOCK_MAX_MS), 300);
});

test("formatDurationLabel speaks Ukrainian hours and minutes", () => {
    assert.equal(formatDurationLabel(90), "1 год 30 хв");
    assert.equal(formatDurationLabel(120), "2 год");
    assert.equal(formatDurationLabel(45), "45 хв");
    assert.equal(formatDurationLabel(0), "0 хв");
});

test("formatDurationLabel never puts NaN in front of the athlete", () => {
    assert.equal(formatDurationLabel(undefined), "0 хв");
    assert.equal(formatDurationLabel("не число"), "0 хв");
});

// The end-to-end shape the finish flow relies on: clock -> suggestion -> label.
test("a finished session hands the finish dialog a spoken duration", () => {
    const start = Date.parse("2026-08-20T18:30:00.000Z");
    const workout = {
        status: "active",
        firstSetAt: new Date(start).toISOString(),
        lastSetAt: new Date(start + 95 * MIN).toISOString(),
        exercises: [{ sets: [{ isCompleted: true }, { isCompleted: true }] }]
    };
    const clock = gymClockState(workout, start + 200 * MIN);
    assert.equal(clock.live, false, "every set done freezes the clock at the last tick");
    assert.equal(formatDurationLabel(suggestedDurationMinutes(clock.ms)), "1 год 30 хв");
});
