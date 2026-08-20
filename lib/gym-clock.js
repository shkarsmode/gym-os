// The gym clock: how long the current session has actually been running.
//
// It is anchored on the FIRST completed set rather than on the workout row's creation,
// because a session is routinely planned at home and lifted hours later — counting from
// creation would show "4:12" for a workout you started twenty minutes ago. It stops at
// the LAST completed set, so it does not keep running while you stretch or drive home.
//
// The span is deliberately never written to the workout's duration. Somebody who forgets
// to finish a session, or ticks the last set the next morning, would otherwise record a
// nonsense number that then feeds volume-per-hour, the feed card and every average. The
// clock is an at-a-glance affordance, not a measurement — which is also why it stops
// pretending to be live past GYM_CLOCK_MAX_MS and shows the start time instead.

export const GYM_CLOCK_MAX_MS = 5 * 60 * 60 * 1000;

function allSetsOf(workoutItem) {
    return (workoutItem.exercises || []).flatMap((exercise) => exercise.sets || []);
}

// Returns the marks a workout should carry after one of its sets changed completion.
// Pure: the caller assigns the result. `firstSetAt` is written once and never moves —
// re-ticking an earlier set must not rewind the session's start. Un-ticking everything
// clears both marks so a session emptied by mistake keeps no phantom start time.
export function nextGymClockMarks(workoutItem, now = new Date()) {
    const stamp = (now instanceof Date ? now : new Date(now)).toISOString();
    const anyCompleted = allSetsOf(workoutItem).some((set) => set.isCompleted);
    if (!anyCompleted) {
        return { firstSetAt: null, lastSetAt: null };
    }
    return {
        firstSetAt: workoutItem.firstSetAt || stamp,
        lastSetAt: stamp
    };
}

// { ms, live, overflow, startLabel } — or null when there is nothing to show yet.
export function gymClockState(workoutItem, now = Date.now()) {
    if (!workoutItem || !workoutItem.firstSetAt) {
        return null;
    }
    const start = new Date(workoutItem.firstSetAt).getTime();
    if (!Number.isFinite(start)) {
        return null;
    }
    const sets = allSetsOf(workoutItem);
    const allDone = sets.length > 0 && sets.every((set) => set.isCompleted);
    // Frozen once the work is done or the session is closed.
    const frozen = workoutItem.status !== "active" || allDone;
    const rawEnd = frozen
        ? new Date(workoutItem.lastSetAt || workoutItem.firstSetAt).getTime()
        : now;
    const end = Number.isFinite(rawEnd) ? rawEnd : (frozen ? start : now);
    const ms = Math.max(0, end - start);
    return {
        ms,
        live: !frozen && ms <= GYM_CLOCK_MAX_MS,
        overflow: ms > GYM_CLOCK_MAX_MS,
        startLabel: startedAtLabel(workoutItem.firstSetAt, new Date(now))
    };
}

// Local wall-clock HH:MM of an instant — what the athlete's watch said.
export function timeOfDay(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) {
        return "";
    }
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

// The label the overflow chip shows instead of a runaway number. A bare "18:30" reads as
// this evening, which is wrong in the very case this branch exists for — a session left
// open since yesterday — so the day is spelled out once it is not today.
export function startedAtLabel(value, now = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) {
        return "";
    }
    const sameDay = date.getFullYear() === now.getFullYear()
        && date.getMonth() === now.getMonth()
        && date.getDate() === now.getDate();
    if (sameDay) {
        return timeOfDay(date);
    }
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const isYesterday = date.getFullYear() === yesterday.getFullYear()
        && date.getMonth() === yesterday.getMonth()
        && date.getDate() === yesterday.getDate();
    return isYesterday
        ? `вчора ${timeOfDay(date)}`
        : `${date.toLocaleDateString("uk-UA", { day: "numeric", month: "short" })} ${timeOfDay(date)}`;
}

// M:SS below an hour, H:MM:SS above it. Never a bare seconds count — a session clock
// that reads "47" is unreadable at a glance.
export function formatClock(ms) {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours
        ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
        : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// What to offer as the session's duration when it is finished.
//
// The raw clock is too precise to be honest — nobody trains for exactly 95 minutes, and
// a log full of 1:37 / 2:11 / 1:52 reads like machine noise. So it is rounded to a value
// a person would actually say out loud: quarter-hours for a short session, half-hours
// once you are past an hour (1:35 -> 1:30, 2:10 -> 2:00, 2:20 -> 2:30).
//
// Returns minutes, or null when there is nothing worth offering — no clock at all, or a
// span so long it is almost certainly a session somebody forgot to close.
export function suggestedDurationMinutes(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value <= 0 || value > GYM_CLOCK_MAX_MS) {
        return null;
    }
    const minutes = value / 60000;
    const step = minutes < 60 ? 15 : 30;
    const rounded = Math.round(minutes / step) * step;
    // A session shorter than half a step would round to zero; call it one step instead —
    // "0 хв" is never the right thing to write into a log.
    return Math.max(step, rounded);
}

// "1 год 30 хв" / "45 хв" — how the suggestion is spoken to the user.
export function formatDurationLabel(minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    if (!hours) {
        return `${rest} хв`;
    }
    return rest ? `${hours} год ${rest} хв` : `${hours} год`;
}
