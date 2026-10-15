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
 * How each set is labelled in its row: every set counts, warm-ups included — 1, 2, 3.
 *
 * Warm-ups used to read «Р» and sit outside the count, which made the big button say
 * «підхід 1 з 1» for what was plainly the third set of three. The owner's rule: they are
 * all sets. The type still travels along (`kind`) for the colour of the number.
 */
export function sessionSetLabels(sets) {
    return (sets || []).map((set, index) => ({ label: String(index + 1), kind: (set && set.type) || "working" }));
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
 * What to offer first when adding an exercise to a session: exercises this person did in
 * their recent finished sessions that are NOT in this one yet.
 *
 * Each recent session votes for its exercises. A vote weighs more when the session is
 * newer, when it is the same type as this one (Pull after Pull), and when it shares
 * exercises with what is already in this session — "the session that had these also had
 * that". Returns the top `limit`, best first, with how often each appeared and when last.
 *
 * `workouts` — own sessions, hydrated, any order; `current` — {id, workoutType, exercises}.
 */
export function suggestExercises(workouts, current, options = {}) {
    const limit = options.limit ?? 6;
    const window = options.window ?? 12;
    const inSession = new Set(((current && current.exercises) || []).map((entry) => entry.exerciseId));
    const recent = (workouts || [])
        .filter((item) => item && item.status === "completed" && Array.isArray(item.exercises) && item.id !== (current && current.id))
        .sort((left, right) => String(right.date).localeCompare(String(left.date)))
        .slice(0, window);
    const scores = new Map();
    recent.forEach((item, rank) => {
        const ids = [...new Set(item.exercises.map((entry) => entry.exerciseId).filter(Boolean))];
        const sameType = Boolean(current && current.workoutType) && item.workoutType === current.workoutType;
        const overlap = ids.filter((id) => inSession.has(id)).length;
        const weight = (1 / (1 + rank * 0.35)) * (sameType ? 2 : 1) * (1 + overlap * 0.5);
        ids.forEach((id) => {
            if (inSession.has(id)) {
                return;
            }
            const entry = scores.get(id) || { exerciseId: id, score: 0, count: 0, sameTypeCount: 0, lastDate: null };
            entry.score += weight;
            entry.count += 1;
            if (sameType) {
                entry.sameTypeCount += 1;
            }
            if (!entry.lastDate || String(item.date) > String(entry.lastDate)) {
                entry.lastDate = item.date;
            }
            scores.set(id, entry);
        });
    });
    return [...scores.values()]
        .sort((left, right) => right.score - left.score || String(right.lastDate).localeCompare(String(left.lastDate)))
        .slice(0, limit);
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

/** A stored number as the keypad shows it: 92.5 → "92,5", 0 → "0". */
export function numberDraft(value) {
    const numeric = Number(value) || 0;
    return String(Math.round(numeric * 100) / 100).replace(".", ",");
}
