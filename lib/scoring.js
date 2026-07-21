// GymOS scoring kernel.
//
// Every number a user sees about their progress — XP, level, personal records,
// achievements, streaks, team totals — is computed here and NOWHERE else. This module
// is executed verbatim by both the browser and the backend, which is the entire point:
// two implementations of these rules would drift, and a drift here silently changes
// somebody's level rather than throwing.
//
// Rules for changing this file:
//
//   1. It must stay pure. No DOM, no window, no localStorage, no imports beyond the two
//      sibling data modules, no `new Date()` without an injected `now`. The backend
//      imports it directly.
//   2. No UI strings. `xpEvents` emits `{kind, meta}`; the caller renders the label.
//      `records` carry `exerciseId`; the caller attaches the exercise object.
//   3. Iteration order is load-bearing — see the note on `recordsFor`.
//
// TIMEZONE. `startOfDay` and `startOfWeek` below use the host's local calendar
// (getDay/setHours/setDate), because that is what the browser has always done and
// changing it would move every streak and weekly total. A server running in UTC will
// therefore disagree with a client in UTC+2 for workouts logged near midnight, and for
// the Monday boundary of `weekVolume`/`weekSets`. Pin the backend process to the same
// zone as the gym, or these numbers will differ by exactly one day at the edges.

import { evaluateAchievements } from "./achievements.js";
import { levelForXp, XP_REWARDS } from "./levels.js";

// ---------------------------------------------------------------- pure helpers

export function round(value, precision = 1) {
    const multiplier = 10 ** precision;
    return Math.round((Number(value) || 0) * multiplier) / multiplier;
}

function startOfDay(date) {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
}

export function dayDiff(left, right) {
    return Math.floor((startOfDay(left) - startOfDay(right)) / 86400000);
}

function startOfWeek(date) {
    const result = new Date(date);
    const day = result.getDay() || 7;
    result.setHours(0, 0, 0, 0);
    result.setDate(result.getDate() - day + 1);
    return result;
}

function byDateAsc(left, right) {
    return new Date(left.date || left.createdAt) - new Date(right.date || right.createdAt);
}

function byDateDesc(left, right) {
    return new Date(right.date || right.createdAt) - new Date(left.date || left.createdAt);
}

// ---------------------------------------------------------------- primitives

// Average of six validated 1RM formulas. Reps are capped at 12 because the estimates
// diverge sharply past that. Kept character-for-character as it was in app.js: this
// value feeds PR dates, which feed achievement unlock dates, which feed XP and level.
export function oneRepMax(weight, repetitions) {
    const load = Number(weight) || 0;
    const reps = Math.round(Number(repetitions) || 0);
    if (load <= 0 || reps <= 0) {
        return 0;
    }
    if (reps === 1) {
        return round(load, 1);
    }
    const cappedReps = Math.min(reps, 12);
    const estimates = [
        load * (1 + cappedReps / 30),                                 // Epley
        load * 36 / (37 - cappedReps),                                // Brzycki
        load * Math.pow(cappedReps, 0.10),                            // Lombardi
        load * (1 + cappedReps / 40),                                 // O'Conner
        100 * load / (48.8 + 53.8 * Math.exp(-0.075 * cappedReps)),   // Wathen
        100 * load / (101.3 - 2.67123 * cappedReps)                   // Lander
    ].filter((value) => Number.isFinite(value) && value > 0);
    if (!estimates.length) {
        return round(load, 1);
    }
    const average = estimates.reduce((sum, value) => sum + value, 0) / estimates.length;
    return round(Math.max(average, load), 1);
}

export function exerciseVolume(workoutExercise) {
    return round(workoutExercise.sets.filter((set) => set.isCompleted).reduce((sum, set) => sum + set.weight * set.repetitions, 0), 1);
}

export function workoutVolume(workoutItem) {
    return round(workoutItem.exercises.reduce((sum, item) => sum + exerciseVolume(item), 0), 1);
}

export function exerciseOneRepMax(workoutExercise) {
    return round(Math.max(0, ...workoutExercise.sets.filter((set) => set.isCompleted).map((set) => oneRepMax(set.weight, set.repetitions))), 1);
}

// Clock duration. `now` is injected so an unfinished workout is deterministic.
export function autoDuration(workoutItem, now) {
    if (!workoutItem.startedAt) {
        return 0;
    }
    const end = workoutItem.finishedAt ? new Date(workoutItem.finishedAt) : new Date(now);
    return Math.max(0, Math.round((end - new Date(workoutItem.startedAt)) / 60000));
}

export function duration(workoutItem, now) {
    if (workoutItem.durationOverride != null && workoutItem.durationOverride !== "") {
        return Math.max(0, Math.round(Number(workoutItem.durationOverride)));
    }
    return autoDuration(workoutItem, now);
}

// ---------------------------------------------------------------- aggregation maps

export function muscleSetMap(workouts, exerciseById) {
    const map = new Map();
    workouts.forEach((workoutItem) => workoutItem.exercises.forEach((workoutExercise) => {
        const muscle = exerciseById(workoutExercise.exerciseId).primaryMuscleGroup;
        map.set(muscle, (map.get(muscle) || 0) + workoutExercise.sets.filter((set) => set.isCompleted).length);
    }));
    return map;
}

export function exerciseUsageMap(workouts) {
    const map = new Map();
    workouts.forEach((workoutItem) => workoutItem.exercises.forEach((workoutExercise) => map.set(workoutExercise.exerciseId, (map.get(workoutExercise.exerciseId) || 0) + 1)));
    return map;
}

export function topMap(map, transform = null) {
    const entry = [...map.entries()].sort((left, right) => right[1] - left[1])[0];
    return entry ? (transform ? transform(entry[0]) : entry[0]) : null;
}

// Consecutive training days, walking backwards from `now`. The first date always
// counts (`count === 0`), so a streak that ended long ago still reports 1.
export function streak(completedWorkouts, now) {
    const dates = [...new Set(completedWorkouts.map((item) => item.date))].sort().reverse();
    if (!dates.length) {
        return 0;
    }
    let count = 0;
    let cursor = new Date(now);
    for (const date of dates) {
        const diff = dayDiff(cursor, new Date(date));
        if (diff <= 1 || count === 0) {
            count += 1;
            cursor = new Date(date);
        } else {
            break;
        }
    }
    return count;
}

// ---------------------------------------------------------------- records

// ITERATION ORDER IS LOAD-BEARING. The comparison below is a strict `>`, so when two
// sets tie on estimated 1RM the FIRST one visited wins. app.js has always fed this
// `state.database.workouts`, which arrives from /export ordered `date DESC` — so on a
// tie the LATEST date wins. Feeding rows date-ascending (the natural choice, and what
// achievementData uses) silently flips every tied PR to the earliest date, which moves
// displayed PR dates, the `first-pr` and `pr-25` unlock dates, and the XP ledger.
//
// Callers MUST pass `workouts` newest-first.
//
// Emits `exerciseId` rather than the exercise object; the caller re-attaches it.
export function recordsFor(userId, workouts, exerciseById) {
    const map = new Map();
    workouts.filter((item) => item.status === "completed").forEach((workoutItem) => {
        workoutItem.exercises.forEach((workoutExercise) => {
            const exercise = exerciseById(workoutExercise.exerciseId);
            workoutExercise.sets.filter((set) => set.isCompleted && set.type !== "warmup").forEach((set) => {
                const estimatedOneRepMax = oneRepMax(set.weight, set.repetitions);
                const current = map.get(exercise.id);
                if (!current || estimatedOneRepMax > current.estimatedOneRepMax) {
                    map.set(exercise.id, {
                        id: `record-${userId}-${exercise.id}`,
                        userId,
                        exerciseId: exercise.id,
                        date: workoutItem.date,
                        type: "estimated_one_rep_max",
                        value: estimatedOneRepMax,
                        estimatedOneRepMax,
                        weight: set.weight,
                        repetitions: set.repetitions,
                        workoutId: workoutItem.id,
                        isEstimated: set.repetitions !== 1
                    });
                }
            });
        });
    });
    return [...map.values()].sort((left, right) => right.estimatedOneRepMax - left.estimatedOneRepMax);
}

// ---------------------------------------------------------------- per-user stats

// `mostUsedExerciseId` and `mostTrainedMuscleGroup` are ids/strings, not objects — the
// caller resolves them. Every one of the 20 keys is consumed somewhere in the UI;
// dropping one prints the literal string "undefined" rather than failing.
export function userStats(userId, workouts, context) {
    const { exerciseById, now } = context;
    const completed = workouts.filter((item) => item.status === "completed");
    const allSets = completed.flatMap((item) => item.exercises.flatMap((exercise) => exercise.sets)).filter((set) => set.isCompleted);
    const cardioSessions = workouts.flatMap((item) => item.cardioSessions || []);
    const weekStart = startOfWeek(new Date(now));
    const week = completed.filter((item) => new Date(item.date) >= weekStart);
    const muscleMap = muscleSetMap(completed, exerciseById);
    const exerciseMap = exerciseUsageMap(completed);
    return {
        userId,
        totalWorkouts: workouts.length,
        completedWorkouts: completed.length,
        totalSets: allSets.length,
        workingSets: allSets.filter((set) => set.type !== "warmup").length,
        warmupSets: allSets.filter((set) => set.type === "warmup").length,
        totalVolume: round(allSets.reduce((sum, set) => sum + set.weight * set.repetitions, 0), 1),
        averageDurationMinutes: completed.length ? Math.round(completed.reduce((sum, item) => sum + duration(item, now), 0) / completed.length) : 0,
        cardioMinutes: cardioSessions.reduce((sum, session) => sum + session.durationMinutes, 0),
        cardioDistance: round(cardioSessions.reduce((sum, session) => sum + session.distance, 0), 1),
        cardioSessions: cardioSessions.length,
        weekVolume: round(week.reduce((sum, item) => sum + workoutVolume(item), 0), 1),
        weekSets: week.flatMap((item) => item.exercises.flatMap((exercise) => exercise.sets)).filter((set) => set.isCompleted).length,
        weekCardioMinutes: week.flatMap((item) => item.cardioSessions || []).reduce((sum, session) => sum + session.durationMinutes, 0),
        trainingStreak: streak(completed, now),
        lastWorkoutDate: [...completed].sort(byDateDesc)[0]?.date || null,
        mostUsedExerciseId: topMap(exerciseMap),
        mostTrainedMuscleGroup: topMap(muscleMap),
        personalRecords: recordsFor(userId, workouts, exerciseById).length,
        notesCount: completed.reduce((sum, item) => sum + (item.notes ? 1 : 0) + item.exercises.filter((exercise) => exercise.notes).length, 0)
    };
}

// Three of these cannot be reconstructed from per-user rows and must be computed over
// the merged corpus: cardioDays (a set-union of dates), teamStreak (consecutive days
// across everyone), and mostUsedExerciseId (first non-null in user order).
//
// `users` must be iterated in /export order (createdAt ASC) — mostUsedExerciseId
// depends on it.
export function teamStats(users, allWorkouts, summaries, context) {
    const { exerciseById, now } = context;
    const completed = allWorkouts.filter((item) => item.status === "completed");
    const cardioSessions = allWorkouts.flatMap((item) => item.cardioSessions || []);
    const mostActive = [...summaries].sort((left, right) => right.completedWorkouts - left.completedWorkouts)[0];
    return {
        totalWorkouts: allWorkouts.length,
        completedWorkouts: completed.length,
        totalSets: summaries.reduce((sum, item) => sum + item.totalSets, 0),
        workingSets: summaries.reduce((sum, item) => sum + item.workingSets, 0),
        totalVolume: round(summaries.reduce((sum, item) => sum + item.totalVolume, 0), 1),
        averageDurationMinutes: completed.length ? Math.round(completed.reduce((sum, item) => sum + duration(item, now), 0) / completed.length) : 0,
        cardioMinutes: cardioSessions.reduce((sum, session) => sum + session.durationMinutes, 0),
        cardioDistance: round(cardioSessions.reduce((sum, session) => sum + session.distance, 0), 1),
        cardioDays: new Set(allWorkouts.filter((item) => item.cardioSessions?.length).map((item) => item.date)).size,
        teamStreak: streak(completed, now),
        mostActiveUserId: mostActive ? mostActive.userId : null,
        mostUsedExerciseId: summaries.map((item) => item.mostUsedExerciseId).filter(Boolean)[0] || null,
        mostTrainedMuscleGroup: topMap(muscleSetMap(completed, exerciseById))
    };
}

// ---------------------------------------------------------------- achievements & XP

export function achievementData(userId, workouts, context) {
    const { exerciseById, userById, featureRequests, exercises, records } = context;
    const completed = workouts.filter((item) => item.status === "completed").sort(byDateAsc);
    const user = userById(userId);
    // Tenure counts from account creation, falling back to the first-ever workout.
    const joinedAt = user?.createdAt || completed[0]?.date || null;
    return {
        workouts: completed,
        joinedAt,
        records,
        ideas: (featureRequests || []).filter((item) => item.userId === userId),
        customExercises: (exercises || [])
            .filter((exercise) => exercise.isCustom && exercise.createdByUserId === userId)
            .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt)),
        exerciseInfo: (id) => {
            const exercise = exerciseById(id);
            return { name: exercise.name || "", primaryMuscleGroup: exercise.primaryMuscleGroup || "" };
        }
    };
}

export function userAchievements(userId, workouts, context) {
    return evaluateAchievements(achievementData(userId, workouts, context));
}

// Emits structured events, not rendered strings. `meta` carries what the caller needs
// to build a label (volume, whether the streak continued, the exercise id, and so on);
// the Ukrainian copy lives in app.js so a wording change is not a backend deploy.
export function xpEvents(userId, workouts, context) {
    const { records, achievements, featureRequests, exercises } = context;
    const events = [];
    let previousDate = null;

    workouts.filter((item) => item.status === "completed").sort(byDateAsc).forEach((workoutItem) => {
        const volume = workoutVolume(workoutItem);
        const volumeBonus = Math.min(XP_REWARDS.volumeCap, Math.floor(volume / XP_REWARDS.volumePerXp));
        const continues = previousDate && dayDiff(new Date(workoutItem.date), new Date(previousDate)) <= 2;
        events.push({
            date: workoutItem.date,
            amount: XP_REWARDS.workout + volumeBonus + (continues ? XP_REWARDS.streak : 0),
            kind: "workout",
            refId: workoutItem.id,
            meta: { volume, continues: Boolean(continues) }
        });
        previousDate = workoutItem.date;
    });

    (records || []).forEach((record) => {
        events.push({
            date: record.date,
            amount: XP_REWARDS.record,
            kind: "record",
            refId: record.exerciseId,
            meta: { estimatedOneRepMax: record.estimatedOneRepMax }
        });
    });

    // Ideas the user submitted that were later marked done. Community contribution,
    // and the single largest per-event award (500).
    (featureRequests || []).filter((item) => item.userId === userId && item.status === "done").forEach((item) => {
        events.push({
            date: item.updatedAt || item.createdAt,
            amount: XP_REWARDS.ideaDone,
            kind: "idea",
            refId: item.id,
            meta: { title: item.title }
        });
    });

    // Exercises the user contributed to the shared catalog.
    (exercises || []).filter((exercise) => exercise.isCustom && exercise.createdByUserId === userId).forEach((exercise) => {
        events.push({
            date: exercise.createdAt,
            amount: XP_REWARDS.exercise,
            kind: "exercise",
            refId: exercise.id,
            meta: { name: exercise.name }
        });
    });

    (achievements || []).filter((item) => item.unlockedAt).forEach((achievement) => {
        events.push({
            date: achievement.unlockedAt,
            amount: achievement.xp,
            kind: "achievement",
            refId: achievement.id,
            meta: { title: achievement.title }
        });
    });

    // Both steps are load-bearing. The filter drops undated events — an idea with
    // neither updatedAt nor createdAt, or a custom exercise with no createdAt — and
    // those dropped events do NOT count toward XP. The sort is date DESC because the
    // Прокачка tab renders this list newest-first.
    return events.filter((event) => event.date).sort((left, right) => new Date(right.date) - new Date(left.date));
}

export function userXp(events) {
    return events.reduce((sum, event) => sum + event.amount, 0);
}

export function userLevel(events) {
    return levelForXp(userXp(events));
}

// ---------------------------------------------------------------- entry point

// One pass over the whole gym. `workoutsByUser` must be newest-first per user (see the
// note on recordsFor). `users` must be in /export order (createdAt ASC).
export function scoreAll({ users, workouts, exercises, featureRequests, now }) {
    const exerciseIndex = new Map((exercises || []).map((item) => [item.id, item]));
    const userIndex = new Map((users || []).map((item) => [item.id, item]));
    // Mirrors app.js: an unknown exercise resolves to a placeholder rather than
    // throwing, so a workout referencing a deleted exercise still scores.
    const exerciseById = (id) => exerciseIndex.get(id) || { id: `missing-${id}`, name: "", primaryMuscleGroup: "" };
    const userById = (id) => userIndex.get(id) || null;

    const byUser = new Map();
    for (const workout of workouts || []) {
        if (!byUser.has(workout.userId)) {
            byUser.set(workout.userId, []);
        }
        byUser.get(workout.userId).push(workout);
    }

    const result = { users: {}, team: null };
    const summaries = [];

    for (const user of users || []) {
        const own = byUser.get(user.id) || [];
        const records = recordsFor(user.id, own, exerciseById);
        const stats = userStats(user.id, own, { exerciseById, now });
        const achievements = userAchievements(user.id, own, {
            exerciseById, userById, featureRequests, exercises, records
        });
        const events = xpEvents(user.id, own, { records, achievements, featureRequests, exercises });

        summaries.push(stats);
        result.users[user.id] = {
            stats,
            records,
            achievements: achievements.filter((item) => item.unlockedAt).map((item) => ({ id: item.id, unlockedAt: item.unlockedAt })),
            xpLedger: events,
            xp: userXp(events),
            level: userLevel(events)
        };
    }

    result.team = teamStats(users || [], workouts || [], summaries, { exerciseById, now });
    return result;
}
