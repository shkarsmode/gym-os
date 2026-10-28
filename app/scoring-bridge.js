// Scoring bridge: stats, records, rankings, leaderboards, suggested sets, catalogue filtering and sorting.
import { searchExercises } from "../lib/exercise-search.js";
import { isTimedSet, DEFAULT_HOLD_SECONDS } from "../lib/set-format.js";
import {
    duration as kernelDuration, autoDuration as kernelAutoDuration, recordsFor as kernelRecordsFor,
    userStats as kernelUserStats, teamStats as kernelTeamStats
} from "../lib/scoring.js";
import { bestResult, isHydratedWorkout, latestDoneSets } from "./history.js";
import { editWorkout, exerciseById, seedWeight, userById, workoutsFor } from "./model.js";
import { userLevel } from "./progression.js";
import { createSet, createStandards } from "./seed.js";
import { state } from "./state.js";
import { round } from "./util.js";

// Both delegate to the kernel. The kernel emits ids where app.js historically
// carried objects (mostUsedExercise), so those are resolved back here — several
// renderers read summary.mostUsedExercise?.name and would print nothing otherwise.
// ---- Server scoring ---------------------------------------------------------
// Under the windowed payload the client no longer HOLDS the full lifetime corpus,
// so it cannot compute progression: XP, levels, records and all 39 achievements are
// derived from every set the user has ever logged. The server computes them with the
// identical kernel and ships the answer in `scoring`.
//
// Each accessor prefers that block and falls back to computing locally, so a v3
// payload from an older server still works unchanged.
export function serverScoring(userId) {
    const block = state.database?.scoring;
    return block && block.users ? block.users[userId] || null : null;
}

export function userStats(userId) {
    const fromServer = serverScoring(userId);
    const stats = fromServer
        ? fromServer.stats
        : kernelUserStats(userId, workoutsFor(userId), { exerciseById, now: new Date() });
    return { ...stats, mostUsedExercise: stats.mostUsedExerciseId ? exerciseById(stats.mostUsedExerciseId) : null };
}

export function teamStats() {
    // cardioDays, teamStreak and mostUsedExerciseId cannot be reconstructed from
    // per-user rows — they need the merged corpus — so the server's team block is
    // used whole rather than re-derived from the summaries it also sends.
    const serverTeam = state.database?.scoring?.team;
    const now = new Date();
    const summaries = serverTeam
        ? []
        : state.database.users.map((user) => kernelUserStats(user.id, workoutsFor(user.id), { exerciseById, now }));
    const team = serverTeam
        || kernelTeamStats(state.database.users, state.database.workouts, summaries, { exerciseById, now });
    return {
        ...team,
        // mostActiveUser is read nowhere today, but is kept so the shape of a team
        // summary does not silently change under any caller that starts using it.
        mostActiveUser: team.mostActiveUserId ? userById(team.mostActiveUserId) : null,
        mostUsedExercise: team.mostUsedExerciseId ? exerciseById(team.mostUsedExerciseId) : null
    };
}

// The kernel emits exerciseId only, so it carries no catalog objects and the backend
// can return records over the wire. Several renderers read record.exercise.name and
// record.exercise.primaryMuscleGroup, so the object is re-attached here.
function hydrateRecords(records) {
    return records.map((record) => ({ ...record, exercise: exerciseById(record.exerciseId) }));
}

export function recordsFor(userId) {
    const fromServer = serverScoring(userId);
    if (fromServer) {
        return hydrateRecords(fromServer.records);
    }
    // workoutsFor returns state.database.workouts order, which is /export's date DESC.
    // That is load-bearing: the kernel breaks 1RM ties by visit order, so feeding it
    // ascending would silently move PR dates. See the note in lib/scoring.js.
    return hydrateRecords(kernelRecordsFor(userId, workoutsFor(userId), exerciseById));
}

// Strength standards are no longer shipped in the backend payload. Regenerate
// the lightweight demo levels client-side on demand so the "Поточний рівень"
// indicator keeps working without bloating the API response.
function ensureStrengthStandards() {
    if (!Array.isArray(state.database.strengthStandards) || !state.database.strengthStandards.length) {
        state.database.strengthStandards = createStandards(state.database.exercises || []);
    }
    return state.database.strengthStandards;
}

export function rankingFor(userId, exerciseId) {
    const user = userById(userId);
    if (!user || !exerciseId) {
        return { best: null, currentLevel: null, nextLevel: null, progress: 0 };
    }

    const standards = ensureStrengthStandards().filter((standard) => standard.exerciseId === exerciseId && standard.gender === user.gender && user.bodyweight >= standard.bodyweightMin && user.bodyweight < standard.bodyweightMax).sort((left, right) => left.requiredWeight - right.requiredWeight);
    const best = bestResult(userId, exerciseId);
    if (!best || !standards.length) {
        return { best, currentLevel: null, nextLevel: standards[0] || null, progress: 0 };
    }
    const currentLevel = standards.filter((standard) => best.estimatedOneRepMax >= standard.requiredWeight).at(-1) || null;
    const nextLevel = standards.find((standard) => best.estimatedOneRepMax < standard.requiredWeight) || null;
    const lower = currentLevel?.requiredWeight || 0;
    const upper = nextLevel?.requiredWeight || best.estimatedOneRepMax;
    return { best, currentLevel, nextLevel, progress: upper === lower ? 100 : (best.estimatedOneRepMax - lower) / (upper - lower) * 100 };
}

function bestLiftByMuscle(userId, muscle, records = null) {
    const list = records || recordsFor(userId);
    if (!muscle || muscle === "all") {
        return list[0] || null;
    }
    return list.find((record) => record.exercise.primaryMuscleGroup === muscle) || null;
}

export function leaderboard(muscle = "all") {
    return state.database.users.map((user) => {
        const records = recordsFor(user.id);
        const summary = userStats(user.id);
        const info = userLevel(user.id, records);
        return { user, completedWorkouts: summary.completedWorkouts, totalVolume: summary.totalVolume, bestLift: bestLiftByMuscle(user.id, muscle, records), level: info.level, xp: info.xp };
    }).sort((left, right) => right.xp - left.xp);
}

export function suggestedSets(exercise) {
    if (exercise.movementPattern === "Кардіо") {
        return [];
    }
    const currentUserId = state.database?.currentUserId;
    // Carry over the exact same sets (count + weight + reps + type) from the last
    // time this exercise was done, just reset to not-completed.
    const last = currentUserId ? latestDoneSets(currentUserId, exercise.id, editWorkout()?.id || null) : null;
    if (last && last.sets.length) {
        // Carry the MEASURE over too, not just the numbers: without this a plank you
        // held for 45 s last week came back as a set of 45 repetitions.
        return last.sets.map((set) => createSet(
            set.type || "working",
            Number(set.weight) || 0,
            Number(set.repetitions) || 0,
            set.rpe,
            Number(set.restSeconds) || 90,
            false,
            isTimedSet(set) ? Number(set.durationSeconds) || 0 : null
        ));
    }
    const weight = seedWeight(exercise.name, 0);
    if (exercise.isTimed) {
        return [
            createSet("working", 0, 0, 7, 60, false, DEFAULT_HOLD_SECONDS),
            createSet("working", 0, 0, 8, 60, false, DEFAULT_HOLD_SECONDS)
        ];
    }
    if (exercise.movementPattern === "Кор") {
        return [createSet("working", 0, 45, 7, 60, false), createSet("working", 0, 45, 8, 60, false)];
    }
    return [createSet("warmup", round(weight * 0.55, 1), 10, 5, 60, false), createSet("working", round(weight, 1), 8, 8, 105, false), createSet("working", round(weight, 1), 8, 8.5, 120, false)];
}

/** How often the current user did each exercise — finished sessions — and when last. */
export function exerciseUsage() {
    const uses = new Map();
    const last = new Map();
    const userId = state.database?.currentUserId;
    if (!userId) {
        return { uses, last };
    }
    workoutsFor(userId).filter((item) => isHydratedWorkout(item) && item.status === "completed").forEach((item) => {
        new Set(item.exercises.map((entry) => entry.exerciseId)).forEach((id) => {
            uses.set(id, (uses.get(id) || 0) + 1);
            if (!last.has(id) || String(item.date) > String(last.get(id))) {
                last.set(id, item.date);
            }
        });
    });
    return { uses, last };
}

/**
 * The catalogue under the muscle / equipment filters and the search, in the same order
 * as «Додати вправу» (lib/exercise-search.js): typed Ukrainian, Russian or English, in
 * any word order, half a word or with a typo; without a search the team's most liked
 * first, then what you do most — your own dislikes last.
 */
export function filteredExercises() {
    const muscle = state.filters.pickerMuscle;
    const equip = state.filters.pickerEquipment;
    const items = state.database.exercises.filter((exercise) => (muscle === "all" || exercise.primaryMuscleGroup === muscle) && (equip === "all" || exercise.equipment === equip));
    return searchExercises(items, state.filters.exerciseSearch, { uses: exerciseUsage().uses });
}

// oneRepMax, workoutVolume, exerciseVolume and exerciseOneRepMax now come straight
// from lib/scoring.js — same names, same signatures, so every call site is unchanged.

// The kernel takes `now` explicitly so an unfinished workout is deterministic and
// the backend cannot disagree with the browser by running a moment later.
export function autoDuration(workoutItem) {
    return kernelAutoDuration(workoutItem, new Date());
}

export function duration(workoutItem) {
    return kernelDuration(workoutItem, new Date());
}
