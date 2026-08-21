/**
 * Supersets: two or three exercises performed back to back, with one rest after the
 * whole round.
 *
 * THE MODEL, in one sentence: a round is the Nth set of each member. There is no round
 * object anywhere — rounds already exist as sets, so weight, reps, completion, volume,
 * personal records, history and statistics keep working through the code that already
 * reads sets. Everything in this file is therefore a view over `exercises[].sets[]`
 * rather than a second store that could disagree with it.
 */

export const SUPERSET_MIN_MEMBERS = 2;
export const SUPERSET_MAX_MEMBERS = 3;
export const SUPERSET_DEFAULT_ROUNDS = 3;
export const SUPERSET_DEFAULT_REST = 120;

/** A1 / A2 / A3 — the label a member is known by inside its group. */
export function positionLabel(index) {
    return `A${index + 1}`;
}

/**
 * The members of each group, in workout order.
 *
 * Returns a Map so callers can ask about one group without scanning the list again.
 * Order is the workout's own `order`, which is also the position inside the group —
 * members are contiguous, so one field serves both and they cannot drift apart.
 */
export function supersetMembers(exercises) {
    const groups = new Map();
    for (const exercise of [...(exercises || [])].sort((left, right) => (left.order || 0) - (right.order || 0))) {
        const groupId = exercise.supersetGroupId;
        if (!groupId) {
            continue;
        }
        if (!groups.has(groupId)) {
            groups.set(groupId, []);
        }
        groups.get(groupId).push(exercise);
    }
    return groups;
}

/**
 * The workout laid out as blocks: a lone exercise, or a whole superset.
 *
 * Built so the editor renders one card per block and a group moves as a unit. A group
 * takes the position of its FIRST member, which is what keeps "move the superset" and
 * "reorder inside it" from needing two ordering systems.
 */
export function workoutBlocks(exercises) {
    const ordered = [...(exercises || [])].sort((left, right) => (left.order || 0) - (right.order || 0));
    const blocks = [];
    const seen = new Set();
    for (const exercise of ordered) {
        const groupId = exercise.supersetGroupId;
        if (!groupId) {
            blocks.push({ kind: "exercise", exercise });
            continue;
        }
        if (seen.has(groupId)) {
            continue;
        }
        seen.add(groupId);
        // A group whose members are not adjacent is still ONE block: the members are
        // gathered here rather than left to draw two cards with the same heading.
        blocks.push({ kind: "superset", groupId, members: ordered.filter((item) => item.supersetGroupId === groupId) });
    }
    return blocks;
}

/**
 * How many rounds this group has.
 *
 * The longest member decides. Members should hold the same number of sets — every
 * mutation here keeps them level — but a payload edited elsewhere might not, and
 * showing fewer rounds than exist would hide work somebody did.
 */
export function roundCount(members) {
    return (members || []).reduce((most, member) => Math.max(most, (member.sets || []).length), 0);
}

/** The Nth set of each member, aligned so index 0 is A1. Missing sets come back null. */
export function roundSets(members, roundIndex) {
    return (members || []).map((member) => (member.sets || [])[roundIndex] || null);
}

/** A round is done when every set in it is. An empty round is not done. */
export function isRoundComplete(members, roundIndex) {
    const sets = roundSets(members, roundIndex).filter(Boolean);
    return sets.length > 0 && sets.every((set) => set.isCompleted);
}

/**
 * The round the athlete is on: the first one not finished.
 *
 * Returns the round count when everything is done, so callers can tell "finished" from
 * "on the last round" without a second question.
 */
export function currentRoundIndex(members) {
    const total = roundCount(members);
    for (let index = 0; index < total; index += 1) {
        if (!isRoundComplete(members, index)) {
            return index;
        }
    }
    return total;
}

/**
 * Which member to move to after ticking one off inside a round.
 *
 * Returns the index of the first unfinished member of the round, or null when the round
 * is done and the rest timer should take over instead.
 */
export function nextMemberInRound(members, roundIndex) {
    const sets = roundSets(members, roundIndex);
    const index = sets.findIndex((set) => set && !set.isCompleted);
    return index === -1 ? null : index;
}

/** How many sets a member needs so every member has `rounds` of them. */
export function missingSetCount(member, rounds) {
    return Math.max(0, rounds - ((member.sets || []).length));
}

/**
 * Can these exercises be merged into one superset?
 *
 * Returns a reason string when they cannot, so the caller can say why rather than just
 * refusing. Already-grouped exercises are excluded: merging a group into a group is a
 * different operation with different consequences, and silently doing it is worse than
 * declining.
 */
export function mergeProblem(exercises) {
    const list = exercises || [];
    if (list.length < SUPERSET_MIN_MEMBERS) {
        return `Обери щонайменше ${SUPERSET_MIN_MEMBERS} вправи`;
    }
    if (list.length > SUPERSET_MAX_MEMBERS) {
        return `У суперсеті максимум ${SUPERSET_MAX_MEMBERS} вправи`;
    }
    if (list.some((exercise) => exercise.supersetGroupId)) {
        return "Одна з вправ уже у суперсеті";
    }
    return null;
}

/**
 * A one-line summary of a member's round, for a collapsed round row.
 *
 * Weight is omitted when there is none, so a bodyweight round does not read as "0 кг".
 */
export function roundSummary(set) {
    if (!set) {
        return "—";
    }
    const weight = Number(set.weight) || 0;
    const timed = set.durationSeconds !== null && set.durationSeconds !== undefined && set.durationSeconds !== "";
    const measure = timed
        ? `${Math.max(0, Math.round(Number(set.durationSeconds) || 0))} с`
        : `${Math.max(0, Math.round(Number(set.repetitions) || 0))}`;
    return weight ? `${weight}×${measure}` : measure;
}
