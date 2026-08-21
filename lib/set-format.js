/**
 * How a single set reads as text.
 *
 * Split out of app.js because three separate surfaces have to agree on it — the set row
 * in the editor, the «Минулого разу» line, and the "you deleted this" toast — and because
 * the timed/reps distinction is the kind of branch that quietly grows a fourth spelling
 * in every place it is re-implemented.
 */

/**
 * Is this set measured in seconds rather than repetitions?
 *
 * `durationSeconds` is nullable on purpose: null means "this set counts reps", and any
 * number — including 0, a plank you have not timed yet — means it counts time. Testing
 * truthiness instead would silently flip a freshly added timed set back to reps.
 */
export function isTimedSet(set) {
    return Boolean(set) && set.durationSeconds !== null && set.durationSeconds !== undefined && set.durationSeconds !== "";
}

/**
 * Seconds as a person would say them: 45 с, 1:30, 2:00.
 *
 * Under a minute stays in plain seconds because that is how holds are actually
 * prescribed; a minute and over switches to m:ss, where 90 reads as 1:30 rather than
 * asking the reader to divide.
 */
export function formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    if (total < 60) {
        return `${total} с`;
    }
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/**
 * The load half of a set: weight, and either time or reps.
 *
 * Bodyweight holds carry no weight at all, so a leading "0 кг" would be noise on the
 * most common timed exercise there is.
 */
export function setLoadText(set) {
    if (!set) {
        return "";
    }
    const weight = Number(set.weight) || 0;
    const measure = isTimedSet(set)
        ? formatDuration(set.durationSeconds)
        : `${Math.max(0, Math.round(Number(set.repetitions) || 0))} повт`;
    return weight ? `${weight} кг · ${measure}` : measure;
}

/**
 * A whole set in one line, for confirmations and toasts.
 *
 * `typeLabel` is passed in rather than imported so this file stays free of the app's
 * label tables and can be tested on its own.
 */
export function describeSet(set, typeLabel = "") {
    if (!set) {
        return "";
    }
    const parts = [];
    if (typeLabel) {
        parts.push(typeLabel);
    }
    const load = setLoadText(set);
    if (load) {
        parts.push(load);
    }
    if (set.isCompleted) {
        parts.push("виконано");
    }
    return parts.join(" · ");
}

/** What an untimed set becomes when you flip it to seconds and have nothing to go on. */
export const DEFAULT_HOLD_SECONDS = 30;

/** …and back the other way. */
export const DEFAULT_REPS = 10;

/**
 * Flip a set to seconds, in place-safe fashion (returns a new object).
 *
 * The reps are ZEROED rather than kept, because volume is weight × reps and a plank
 * that quietly remembers "8" from before the switch would keep adding phantom tonnage
 * to every chart that reads it.
 */
export function toTimedSet(set, fallbackSeconds = DEFAULT_HOLD_SECONDS) {
    if (!set) {
        return set;
    }
    const seconds = isTimedSet(set) ? Number(set.durationSeconds) || 0 : Math.max(0, Math.round(Number(fallbackSeconds) || 0));
    return { ...set, durationSeconds: seconds, repetitions: 0 };
}

/** The inverse: back to counting repetitions, with the hold time discarded. */
export function toRepSet(set, fallbackReps = DEFAULT_REPS) {
    if (!set) {
        return set;
    }
    // A remembered count of 0 is a real answer — a set that genuinely had no reps — so
    // it must beat the default rather than being treated as "nothing remembered".
    const remembered = fallbackReps === null || fallbackReps === undefined ? DEFAULT_REPS : Number(fallbackReps) || 0;
    const reps = Number(set.repetitions) || Math.max(0, Math.round(remembered));
    return { ...set, durationSeconds: null, repetitions: reps };
}

/**
 * Totals worth showing above a timed block: how many holds, how long altogether, and
 * the longest single one — the three numbers a person actually tracks on a plank.
 */
export function timedTotals(sets) {
    const list = (sets || []).filter(isTimedSet);
    let total = 0;
    let best = 0;
    let done = 0;
    for (const set of list) {
        const seconds = Math.max(0, Math.round(Number(set.durationSeconds) || 0));
        if (set.isCompleted) {
            total += seconds;
            done += 1;
        }
        if (seconds > best) {
            best = seconds;
        }
    }
    return { count: list.length, completed: done, totalSeconds: total, bestSeconds: best };
}
