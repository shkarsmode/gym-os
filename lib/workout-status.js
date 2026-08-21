/**
 * What a workout's status ACTUALLY is, as opposed to what the row says.
 *
 * The stored status is a plan the person made, and plans go stale. A session opened on
 * Monday and never formally finished still says `active` on Friday; a peer's completed
 * workout can sit in the payload as `planned` because only its owner's client heals it,
 * and nobody else may write to their rows. Either way the badge ends up claiming a
 * workout with 1 520 kg and six sets in it is something that has not happened yet.
 *
 * The rule this encodes: «Заплановано» is only ever about the FUTURE. A dated day that
 * has already passed is either something you did or something you did not do.
 *
 * Display only. It never rewrites the row — for a peer that would be writing to somebody
 * else's data, and for your own rows `reconcileWorkoutStatuses` already persists the fix.
 */

/**
 * Did anything actually get logged?
 *
 * Answered for both payload shapes, because the calendar day sheet renders your own
 * hydrated rows and your teammates' summaries side by side. A summary's `setCount`
 * counts COMPLETED sets only (see the backend's workoutAggregates), which is exactly
 * the question being asked here.
 */
export function hasRecordedWork(workout) {
    if (!workout) {
        return false;
    }
    if (Array.isArray(workout.exercises)) {
        const lifted = workout.exercises.some((exercise) => (exercise.sets || []).some((set) => set.isCompleted));
        const cardio = (workout.cardioSessions || []).length > 0;
        return lifted || cardio;
    }
    return Number(workout.setCount) > 0
        || Number(workout.totalVolume) > 0
        || Number(workout.cardioMinutes) > 0
        || Number(workout.cardioCount) > 0;
}

/**
 * @param {object} workout  a hydrated row or a peer summary
 * @param {string} today    today as YYYY-MM-DD, in the viewer's timezone
 * @returns {"planned"|"active"|"completed"|"missed"}
 *
 * `missed` exists only here — it is never stored — for the one honest reading of a past
 * day that was planned and then had nothing logged against it.
 */
export function effectiveWorkoutStatus(workout, today) {
    const stored = workout?.status || "planned";
    if (stored === "completed") {
        return "completed";
    }
    const date = String(workout?.date || "").slice(0, 10);
    // No date, or one we cannot compare, leaves the row exactly as it claims to be.
    if (!date || !today || date >= today) {
        return stored;
    }
    return hasRecordedWork(workout) ? "completed" : "missed";
}

/**
 * Does this row still need its sets fetched from the server?
 *
 * A peer's session arrives as a summary with NO `exercises` key at all, so the drawer
 * asks the server for the real thing. Two answers end that: the sets themselves, or a
 * refusal — and a refusal on PRIVACY grounds is a final answer, not a failed request.
 *
 * That last part is why this exists. The private branch used to leave nothing behind that
 * said "already asked": it recorded `privateOwnerId` and DELETED `detailUnavailable`, so
 * this predicate answered "yes, fetch it" again, the drawer repainted, the repaint asked
 * again — a loop that re-fetched forever and rebuilt the drawer's markup on every pass.
 * The visible symptom was that the close button did nothing: the node it was dispatched
 * to had already been replaced by the next repaint.
 */
export function workoutNeedsDetail(workout) {
    if (!workout || Array.isArray(workout.exercises)) {
        return false;
    }
    if (workout.detailUnavailable) {
        return false;
    }
    // Known to be private: there is nothing to wait for and nothing a retry would change.
    return !workout.private && !workout.privateOwnerId;
}
