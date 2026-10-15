// Exercise history: last-done sets, notes, bests, progress data, ranks, streak.
import { rankedExerciseNames, rankOrder } from "../lib/constants.js";
import { exerciseOneRepMax, muscleSetMap as kernelMuscleSetMap, streak as kernelStreak } from "../lib/scoring.js";
import { exerciseById, exerciseByName, workoutsFor } from "./model.js";
import { rankingFor, recordsFor } from "./scoring-bridge.js";
import { state } from "./state.js";
import { byDateAsc, byDateDesc, capitalize } from "./util.js";

// A row from the windowed payload is either HYDRATED (own workout, carries
// exercises/sets) or a PEER SUMMARY (aggregates only, no exercises key). Every
// set-level walker below must drop the summaries — they cannot answer "which
// exercises were in this session", and reading .exercises on them is what threw
// "undefined is not an object (evaluating 'i.exercises.filter')".
export function isHydratedWorkout(workoutItem) {
    return Boolean(workoutItem) && Array.isArray(workoutItem.exercises);
}

// All prior instances of an exercise for a user (most recent first), excluding a workout.
export function exerciseInstances(userId, exerciseId, excludedWorkoutId = null) {
    if (!userId) {
        return [];
    }
    return workoutsFor(userId)
        .filter((item) => item.id !== excludedWorkoutId && isHydratedWorkout(item))
        .sort(byDateDesc)
        .flatMap((workoutItem) => workoutItem.exercises
            .filter((workoutExercise) => workoutExercise.exerciseId === exerciseId)
            .map((workoutExercise) => ({ date: workoutItem.date, sets: workoutExercise.sets || [], notes: String(workoutExercise.notes || "").trim() })));
}

/**
 * Last time an exercise was actually DONE: finished sessions only, completed sets only,
 * most recent first. What "як минулого разу" means everywhere it is used to FILL a set —
 * lastExerciseSets() below walks every own workout, so a session planned for next week
 * (first by date) or one copied from months ago could stand in for last time.
 */
export function latestDoneSets(userId, exerciseId, excludedWorkoutId = null) {
    if (!userId) {
        return null;
    }
    return workoutsFor(userId)
        .filter((item) => item.id !== excludedWorkoutId && item.status === "completed" && isHydratedWorkout(item))
        .sort(byDateDesc)
        .flatMap((item) => item.exercises
            .filter((entry) => entry.exerciseId === exerciseId)
            .map((entry) => ({ date: item.date, sets: (entry.sets || []).filter((set) => set.isCompleted) })))
        .find((entry) => entry.sets.length) || null;
}

export function lastExerciseSets(userId, exerciseId, excludedWorkoutId = null) {
    return exerciseInstances(userId, exerciseId, excludedWorkoutId).find((entry) => entry.sets.length) || null;
}

export function lastExerciseNote(userId, exerciseId, excludedWorkoutId = null) {
    return exerciseInstances(userId, exerciseId, excludedWorkoutId).find((entry) => entry.notes) || null;
}

export function bestResult(userId, exerciseId) {
    return recordsFor(userId).find((record) => record.exerciseId === exerciseId) || null;
}

export function teamBestResult(exerciseId) {
    return state.database.users.map((user) => bestResult(user.id, exerciseId)).filter(Boolean).sort((left, right) => right.estimatedOneRepMax - left.estimatedOneRepMax)[0] || null;
}

export function progressData(userId, exerciseId) {
    return workoutsFor(userId).filter((item) => item.status === "completed" && isHydratedWorkout(item)).sort(byDateAsc).map((workoutItem) => {
        const workoutExercise = workoutItem.exercises.find((item) => item.exerciseId === exerciseId);
        const value = workoutExercise ? exerciseOneRepMax(workoutExercise) : 0;
        return value ? { date: workoutItem.date, value } : null;
    }).filter(Boolean);
}

export function relatedExercises(exerciseId) {
    const source = exerciseById(exerciseId);
    return state.database.exercises.filter((item) => item.id !== exerciseId).map((item) => ({ item, score: (item.primaryMuscleGroup === source.primaryMuscleGroup ? 4 : 0) + (item.movementPattern === source.movementPattern ? 3 : 0) + (item.equipment === source.equipment ? 1 : 0) })).filter((row) => row.score > 0).sort((left, right) => right.score - left.score).map((row) => row.item);
}

// exerciseUsageMap and topMap come straight from the kernel — identical signatures.
// muscleSetMap needs the catalog lookup injected, since the kernel closes over nothing.
export function muscleSetMap(workouts) {
    return kernelMuscleSetMap(workouts, exerciseById);
}

export function mainRank(userId) {
    const levels = rankedExerciseNames
        .map((name) => exerciseByName(name))
        .filter((exercise) => exercise && !String(exercise.id || "").startsWith("missing-"))
        .map((exercise) => rankingFor(userId, exercise.id).currentLevel?.level)
        .filter(Boolean);
    if (!levels.length) {
        return "Поки немає рівня";
    }
    return rankLabel(levels.sort((left, right) => rankOrder.indexOf(right) - rankOrder.indexOf(left))[0]);
}

function rankLabel(level) {
    return ({ beginner: "Початковий", novice: "Новачок", third_class: "3-й клас", second_class: "2-й клас", first_class: "1-й клас", candidate_master: "Кандидат у майстри", master: "Майстер" })[level] || capitalize(level);
}

function streak(completedWorkouts) {
    return kernelStreak(completedWorkouts, new Date());
}
