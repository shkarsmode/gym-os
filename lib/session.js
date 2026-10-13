// The compact workout session ("новий інтерфейс"): the pure decisions behind it, kept
// out of app.js so they can be tested — which set is next, how sets are numbered, how a
// keypad press turns into a value, how a set compares with the same set last time.

import { workoutBlocks, roundCount, nextMemberInRound } from "./superset.js";
import { isTimedSet } from "./set-format.js";

/** The server rejects anything above these (workouts DTO), so the keypad stops there. */
export const FIELD_LIMITS = {
    weight: { max: 2000, decimals: 2 },
    repetitions: { max: 1000, decimals: 0 },
    durationSeconds: { max: 86400, decimals: 0 },
    restSeconds: { max: 86400, decimals: 0 }
};

/**
 * How each set is labelled in its row.
 *
 * Warm-ups read «Р» and do not take a number: lifters count WORKING sets ("третій
 * робочий"), and numbering the warm-up as 1 made every working set off by one from how
 * people actually talk about them. Every other type keeps its place in the count and
 * carries its type for the styling.
 */
export function sessionSetLabels(sets) {
    let n = 0;
    return (sets || []).map((set) => (set && set.type === "warmup"
        ? { label: "Р", kind: "warmup" }
        : { label: String(++n), kind: (set && set.type) || "working" }));
}

/**
 * The set the big button will tick: the first open one in the order they are done.
 *
 * Inside a superset that is NOT the first open set of the first member — a round is
 * A1 → A2 → A3, so the next set is the open member of the earliest unfinished round.
 */
export function nextSessionSet(exercises) {
    for (const block of workoutBlocks(exercises || [])) {
        if (block.kind === "exercise") {
            const sets = block.exercise.sets || [];
            const index = sets.findIndex((set) => !set.isCompleted);
            if (index !== -1) {
                return { workoutExerciseId: block.exercise.id, setId: sets[index].id, index, superset: null };
            }
            continue;
        }
        const rounds = roundCount(block.members);
        for (let round = 0; round < rounds; round += 1) {
            const memberIndex = nextMemberInRound(block.members, round);
            if (memberIndex !== null) {
                const member = block.members[memberIndex];
                return { workoutExerciseId: member.id, setId: member.sets[round].id, index: round, superset: { groupId: block.groupId, round, memberIndex } };
            }
        }
    }
    return null;
}

/** Done / total sets across the whole session. */
export function sessionProgress(exercises) {
    let done = 0;
    let total = 0;
    for (const exercise of exercises || []) {
        for (const set of exercise.sets || []) {
            total += 1;
            if (set.isCompleted) {
                done += 1;
            }
        }
    }
    return { done, total };
}

/** Last session's set in the same position — the pairing «1 з 1, 3 з 3». */
export function pairedLast(lastSets, index) {
    const sets = lastSets && Array.isArray(lastSets.sets) ? lastSets.sets : [];
    return index >= 0 && index < sets.length ? sets[index] : null;
}

/**
 * How this set differs from the same set last time.
 *
 * Only like is compared with like: a timed set against a timed one, reps against reps.
 * Zero differences come back as null so the row does not print "+0".
 */
export function loadDelta(set, last) {
    if (!set || !last) {
        return { weight: null, reps: null, seconds: null };
    }
    const diff = (a, b) => {
        const value = Math.round(((Number(a) || 0) - (Number(b) || 0)) * 100) / 100;
        return value === 0 ? null : value;
    };
    const timed = isTimedSet(set);
    if (timed !== isTimedSet(last)) {
        return { weight: null, reps: null, seconds: null };
    }
    return {
        weight: diff(set.weight, last.weight),
        reps: timed ? null : diff(set.repetitions, last.repetitions),
        seconds: timed ? diff(set.durationSeconds, last.durationSeconds) : null
    };
}

/** Plate step: dumbbells and kettlebells move in 2 kg, everything else in 2.5. */
export function weightStep(equipment) {
    return equipment === "Гантелі" || equipment === "Гиря" ? 2 : 2.5;
}

/** Step for the ± buttons of each field. */
export function fieldStep(field, equipment) {
    if (field === "weight") {
        return weightStep(equipment);
    }
    if (field === "durationSeconds") {
        return 5;
    }
    if (field === "restSeconds") {
        return 15;
    }
    return 1;
}

function clampValue(value, field) {
    const limit = FIELD_LIMITS[field] || { max: 100000, decimals: 0 };
    const factor = 10 ** limit.decimals;
    const rounded = Math.round((Number(value) || 0) * factor) / factor;
    return Math.min(limit.max, Math.max(0, rounded));
}

/** Apply ± to a value, never below zero, never past the server's limit. */
export function stepValue(value, delta, field) {
    return clampValue((Number(value) || 0) + delta, field);
}

/**
 * One keypad press on the text being typed.
 *
 * `fresh` means the value on screen is the stored one and nobody has typed yet: the
 * first digit REPLACES it, exactly like a selected field, because "type the new weight"
 * is the common case and "append to 92.5" never is.
 */
export function keypadPress(draft, key, field, fresh = false) {
    const limit = FIELD_LIMITS[field] || { max: 100000, decimals: 0 };
    let text = fresh && key !== "back" ? "" : String(draft ?? "");
    if (key === "back") {
        return fresh ? "" : text.slice(0, -1);
    }
    if (key === "clear") {
        return "";
    }
    if (key === "," || key === ".") {
        if (limit.decimals === 0 || text.includes(",")) {
            return text;
        }
        return `${text || "0"},`;
    }
    if (!/^\d$/.test(key)) {
        return text;
    }
    const [whole, fraction] = text.split(",");
    if (fraction !== undefined && fraction.length >= limit.decimals) {
        return text;
    }
    const next = text === "0" ? key : text + key;
    if (draftNumber(next) > limit.max) {
        return text;
    }
    return next;
}

/** The number a draft stands for ("92,5" → 92.5, "" → 0). */
export function draftNumber(draft) {
    const value = Number(String(draft ?? "").replace(",", "."));
    return Number.isFinite(value) ? value : 0;
}

/** A stored number as the keypad shows it: 92.5 → "92,5", 0 → "0". */
export function numberDraft(value) {
    const numeric = Number(value) || 0;
    return String(Math.round(numeric * 100) / 100).replace(".", ",");
}

/**
 * Time is typed like a microwave: digits fill m:ss from the right, so "1", "3", "0"
 * reads 1:30. Typing seconds as a raw number ("90") is how nobody thinks about a hold.
 */
export function durationFromDigits(digits) {
    const clean = String(digits || "").replace(/\D/g, "").slice(-5);
    if (!clean) {
        return 0;
    }
    const secondsPart = Number(clean.slice(-2));
    const minutesPart = Number(clean.slice(0, -2) || 0);
    return Math.min(FIELD_LIMITS.durationSeconds.max, minutesPart * 60 + secondsPart);
}

export function digitsFromDuration(totalSeconds) {
    const total = Math.max(0, Math.round(Number(totalSeconds) || 0));
    if (!total) {
        return "";
    }
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return minutes ? `${minutes}${String(rest).padStart(2, "0")}` : String(rest);
}

export function durationDigitsPress(digits, key, fresh = false) {
    let text = fresh && key !== "back" ? "" : String(digits || "");
    if (key === "back") {
        return fresh ? "" : text.slice(0, -1);
    }
    if (key === "clear") {
        return "";
    }
    if (!/^\d$/.test(key) || text.length >= 5) {
        return text;
    }
    return (text === "0" ? "" : text) + key;
}

/** m:ss for the keypad display while typing a duration. */
export function durationDigitsLabel(digits) {
    const seconds = durationFromDigits(digits);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Whole-percent change, or null when there is nothing to compare against. */
export function percentChange(current, previous) {
    const before = Number(previous) || 0;
    if (before <= 0) {
        return null;
    }
    return Math.round(((Number(current) || 0) - before) / before * 100);
}

/** A session's length the way it is said: "48 хв", "1:12". */
export function sessionLengthLabel(ms) {
    const minutes = Math.max(0, Math.round((Number(ms) || 0) / 60000));
    if (minutes < 60) {
        return `${minutes} хв`;
    }
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}
