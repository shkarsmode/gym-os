// A new record, shown on the set the moment it is done.
//
// The bar is the person's best estimated 1RM for the exercise from earlier sessions —
// the same oneRepMax the records page and the exercise header use — and every record
// set today raises it for the next one, so a set is marked only if it was a record at
// the moment it was ticked. Only completed working sets with a weight count: a warm-up,
// a hold or a bodyweight set is never a record, and the first time doing an exercise is
// not one either (there is nothing to beat).

import { oneRepMax } from "./scoring.js";

/** Map setId → { e1rm, previous, gain } for the sets that beat the best before them. */
export function liveSetRecords(sets, previousBest) {
    const found = new Map();
    const baseline = Number(previousBest) || 0;
    if (baseline <= 0) {
        return found;
    }
    let best = baseline;
    for (const set of sets || []) {
        if (!set || !set.isCompleted || set.type === "warmup" || Number(set.durationSeconds) > 0) {
            continue;
        }
        const e1rm = oneRepMax(set.weight, set.repetitions);
        if (e1rm > best + 0.05) {
            found.set(set.id, { e1rm, previous: best, gain: Math.round((e1rm - best) * 10) / 10 });
            best = e1rm;
        }
    }
    return found;
}
