// Workout mutations: start / copy / open / reopen / delete, exercises, sets, finish, cardio.
import { dateInput } from "../lib/format.js";
import { setTypeLabels } from "../lib/constants.js";
import {
    isTimedSet, formatDuration, describeSet, toTimedSet, toRepSet, timedTotals, DEFAULT_HOLD_SECONDS
} from "../lib/set-format.js";
import { storage } from "./data.js";
import { openWorkout } from "./exercise-detail.js";
import { invalidateFeed } from "./feed.js";
import { renderFocus } from "./focus.js";
import { touchGymClock } from "./gym-clock-ui.js";
import { isHydratedWorkout, latestDoneSets } from "./history.js";
import {
    activeWorkoutFor, canManage, currentUser, editSetByIds, editWorkout, editWorkoutExercise, exerciseById,
    ownWorkout, workoutLabel, workoutLimitState
} from "./model.js";
import { choiceDialog, closeOverlay, confirmDialog, friendlyError, showSyncIndicator, toast } from "./overlays.js";
import {
    cancelWorkoutSave, enqueueOffline, isNetworkError, persist, persistWorkout, schedulePersistWorkout
} from "./persistence.js";
import { getPref } from "./prefs.js";
import { checkAchievementUnlocks } from "./progression.js";
import { goToWorkoutEditor } from "./router.js";
import { suggestedSets } from "./scoring-bridge.js";
import { createSet } from "./seed.js";
import { renderSection, setPendingExerciseScroll } from "./shell.js";
import { state } from "./state.js";
import { supersetRoundRestFor } from "./supersets.js";
import { startTimer, stopTimer } from "./timer.js";
import { removeWithUndo, workoutRemovalSummary } from "./undo.js";
import { createId, inputValue, numberValue, round } from "./util.js";
import { refreshWarmupRow } from "./warmup-ui.js";
import { pluralUk } from "./workout-screen.js";

// The set ticked a moment ago: its record badge animates in once, later renders don't.
export let recordFlashSetId = null;

export async function startNewWorkout(dateOverride) {
    const now = new Date();
    const targetDate = dateOverride ? String(dateOverride).slice(0, 10) : dateInput(now);
    const isToday = targetDate === dateInput(now);
    const limit = workoutLimitState(currentUser().id, targetDate);
    if (!limit.allowed) {
        closeOverlay();
        renderSection();
        toast("Ліміт тренувань", limit.message);
        return;
    }
    if (isToday) {
        const canStart = await ensureSingleActiveWorkout();
        if (!canStart) {
            return;
        }
    }
    const defaultDur = getPref("defaultDuration");
    const workoutItem = {
        id: createId("workout"),
        userId: currentUser().id,
        date: targetDate,
        title: "Тренування",
        status: isToday ? "active" : "planned",
        workoutType: getPref("defaultWorkoutType"),
        durationOverride: (defaultDur === "auto" || defaultDur === "" || defaultDur == null) ? null : (Math.max(0, Math.round(Number(defaultDur))) || null),
        startedAt: isToday ? now.toISOString() : null,
        finishedAt: null,
        notes: "",
        exercises: [],
        supersetGroups: [],
        cardioSessions: [],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
    };
    state.database.workouts.push(workoutItem);
    state.editingWorkoutId = workoutItem.id;
    await persistWorkout(workoutItem);
    closeOverlay();
    goToWorkoutEditor(workoutItem.id);
}

// Clone ANY workout — your own or a teammate's — into a fresh session for today and
// open it, ready to train. Sets carry their weights/reps/rest but come in unticked,
// and notes are dropped: this is a starting point, not a copy of someone's log.
// A peer row (or any windowed summary) has no sets in memory, so it is hydrated
// from the backend first — GET /workouts/:id serves a peer's COMPLETED workout.
export async function copyWorkoutAndStart(workoutId) {
    const me = currentUser();
    const today = dateInput(new Date());
    const limit = workoutLimitState(me.id, today);
    if (!limit.allowed) {
        toast("Ліміт тренувань", limit.message);
        return;
    }
    let source = state.database.workouts.find((item) => item.id === workoutId);
    if (!source) {
        return;
    }
    if (!Array.isArray(source.exercises)) {
        if (storage.mode !== "api" || !storage.apiClient.hasBaseUrl()) {
            toast("Не вдалося скопіювати", "Підходи цього тренування недоступні офлайн.");
            return;
        }
        try {
            source = await storage.apiClient.fetchWorkout(workoutId);
        } catch (error) {
            toast("Не вдалося скопіювати", friendlyError(error));
            return;
        }
    }
    if (!(await ensureSingleActiveWorkout())) {
        return;
    }
    const now = new Date();
    const ordered = (source.exercises || []).slice().sort((left, right) => (left.order || 0) - (right.order || 0));
    const copy = {
        id: createId("workout"),
        userId: me.id,
        date: today,
        title: "Тренування",
        status: "active",
        workoutType: source.workoutType || getPref("defaultWorkoutType"),
        durationOverride: null,
        startedAt: now.toISOString(),
        finishedAt: null,
        notes: "",
        exercises: ordered.map((exercise, index) => ({
            id: createId("workout-exercise"),
            exerciseId: exercise.exerciseId,
            order: index + 1,
            notes: "",
            sets: (latestDoneSets(me.id, exercise.exerciseId)?.sets || exercise.sets || []).map((set) => ({
                id: createId("set"),
                type: set.type || "working",
                weight: Number(set.weight) || 0,
                repetitions: Number(set.repetitions) || 0,
                durationSeconds: set.durationSeconds ?? null,
                rpe: Number(set.rpe) || 0,
                restSeconds: Number(set.restSeconds) || 90,
                isCompleted: false,
                notes: ""
            }))
        })),
        cardioSessions: (source.cardioSessions || []).map((session) => ({
            id: createId("cardio"),
            type: session.type || "treadmill",
            durationMinutes: Number(session.durationMinutes) || 0,
            distance: Number(session.distance) || 0,
            calories: Number(session.calories) || 0,
            averageHeartRate: Number(session.averageHeartRate) || 0,
            intensity: session.intensity || "medium",
            notes: ""
        })),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
    };
    state.database.workouts.push(copy);
    state.editingWorkoutId = copy.id;
    await persistWorkout(copy);
    closeOverlay();
    goToWorkoutEditor(copy.id);
    toast("Тренування скопійовано", `${copy.exercises.length} ${pluralUk(copy.exercises.length, "вправа", "вправи", "вправ")} з вагами — можна починати.`);
}

export function openWorkoutEditor(workoutId) {
    const workoutItem = state.database.workouts.find((item) => item.id === workoutId);
    if (!workoutItem) {
        return;
    }
    if (!canManage(workoutItem)) {
        openWorkout(workoutId);
        return;
    }
    closeOverlay();
    goToWorkoutEditor(workoutId);
}

export async function reopenWorkout(workoutId) {
    const workoutItem = ownWorkout(workoutId);
    if (!workoutItem) {
        return;
    }
    const canStart = await ensureSingleActiveWorkout(workoutItem.id);
    if (!canStart) {
        return;
    }
    workoutItem.status = "active";
    workoutItem.finishedAt = null;
    if (!workoutItem.startedAt) {
        workoutItem.startedAt = new Date().toISOString();
    }
    workoutItem.updatedAt = new Date().toISOString();
    state.editingWorkoutId = workoutItem.id;
    await persistWorkout(workoutItem);
    goToWorkoutEditor(workoutItem.id);
}

export async function startExistingWorkout(workoutId) {
    await reopenWorkout(workoutId);
}

export async function deleteWorkout(workoutId) {
    const workoutItem = state.database.workouts.find((item) => item.id === workoutId);
    if (!workoutItem || !canManage(workoutItem)) {
        toast("Лише перегляд", "Видаляти можна тільки власні тренування.");
        return;
    }
    const summary = workoutRemovalSummary(workoutItem);
    const confirmed = await confirmDialog(workoutLabel(workoutItem), {
        title: "Видалити тренування?",
        detail: summary || "Порожня сесія",
        confirmLabel: "Видалити",
        note: "Матимеш 20 секунд, щоб повернути."
    });
    if (!confirmed) {
        return;
    }
    const removedLabel = workoutLabel(workoutItem);
    const wasEditing = state.editingWorkoutId === workoutId;
    // Where it sat, so putting it back does not reshuffle the list under the cursor.
    const index = state.database.workouts.findIndex((item) => item.id === workoutId);
    cancelWorkoutSave(workoutId);
    state.database.workouts = state.database.workouts.filter((item) => item.id !== workoutId);
    if (wasEditing) {
        state.editingWorkoutId = null;
    }
    closeOverlay();
    renderSection();

    removeWithUndo({
        key: `workout:${workoutId}`,
        title: "Тренування видалено",
        message: summary ? `${removedLabel} · ${summary}` : removedLabel,
        restore: () => {
            // Nothing was ever sent, so this is a plain put-it-back — no re-create,
            // no new id, no rows to stitch together again.
            if (!state.database.workouts.some((item) => item.id === workoutId)) {
                state.database.workouts.splice(index < 0 ? state.database.workouts.length : index, 0, workoutItem);
            }
            if (wasEditing) {
                state.editingWorkoutId = workoutId;
            }
            renderSection();
            showSyncIndicator("success", "Повернуто");
        },
        commit: async () => {
            if (storage.mode === "api" && storage.apiClient.hasBaseUrl()) {
                showSyncIndicator("loading", "Видаляємо тренування");
                try {
                    await storage.apiClient.deleteWorkout(workoutId);
                    showSyncIndicator("success", "Видалено");
                } catch (error) {
                    if (isNetworkError(error)) {
                        enqueueOffline({ kind: "delete", id: workoutId });
                    } else if (Number(error?.status) !== 404) {
                        showSyncIndicator("error", friendlyError(error));
                    }
                }
            } else {
                await persist({ silent: true });
            }
        }
    });
}

export async function ensureSingleActiveWorkout(excludedWorkoutId = null) {
    const existing = activeWorkoutFor(currentUser().id);
    if (!existing || existing.id === excludedWorkoutId) {
        return true;
    }
    if (!(await confirmDialog("У тебе вже є активне тренування. Завершити його і почати нове?", { confirmLabel: "Завершити і почати", danger: false }))) {
        return false;
    }
    existing.status = "completed";
    existing.finishedAt = new Date().toISOString();
    existing.updatedAt = new Date().toISOString();
    // MUST persist: this used to mutate memory only, so the finish was lost on the
    // next load and the old session came back with its pre-finish status.
    await persistWorkout(existing);
    return true;
}

// Self-heal statuses on boot. A PAST workout still marked «Заплановано»/«Активне»
// while carrying completed sets is a finished session that never got its finish tap
// (or whose finish never reached the server) — the backend defaults status to
// `planned`, so anything that dropped it left the session mislabelled forever.
// Future plans and today's session are deliberately untouched.
export function reconcileWorkoutStatuses() {
    const today = dateInput(new Date());
    const meId = state.database?.currentUserId;
    if (!meId) {
        return 0;
    }
    let healed = 0;
    (state.database.workouts || []).forEach((workoutItem) => {
        if (workoutItem.userId !== meId || workoutItem.status === "completed") {
            return;
        }
        if (String(workoutItem.date).slice(0, 10) >= today) {
            return;
        }
        const hasDoneSets = (workoutItem.exercises || []).some((exercise) => (exercise.sets || []).some((set) => set.isCompleted));
        if (!hasDoneSets) {
            return;
        }
        workoutItem.status = "completed";
        workoutItem.finishedAt = workoutItem.finishedAt || new Date(`${String(workoutItem.date).slice(0, 10)}T20:00:00`).toISOString();
        workoutItem.updatedAt = new Date().toISOString();
        healed += 1;
        schedulePersistWorkout(workoutItem);
    });
    return healed;
}

// Swap the exercise in a slot for another one picked from the "Замінити вправу"
// picker, keeping the existing sets as a starting point. The target slot id was
// stashed on state when the picker opened.
async function replaceExercise(exerciseId) {
    const targetId = state.replaceExerciseTarget;
    state.replaceExerciseTarget = null;
    const workoutItem = editWorkout();
    const workoutExercise = workoutItem && canManage(workoutItem) ? workoutItem.exercises.find((item) => item.id === targetId) : null;
    if (!workoutExercise) {
        closeOverlay();
        return;
    }
    workoutExercise.exerciseId = exerciseId;
    workoutItem.updatedAt = new Date().toISOString();
    state.editingWorkoutId = workoutItem.id;
    await persistWorkout(workoutItem);
    closeOverlay();
    renderSection();
}

export async function addExercise(exerciseId) {
    if (state.replaceExerciseTarget) {
        return replaceExercise(exerciseId);
    }
    const workoutItem = editWorkout();
    if (!workoutItem || !canManage(workoutItem)) {
        toast("Спочатку почни тренування", "Відкрий або почни тренування, щоб додати вправу.");
        return;
    }
    const exercise = exerciseById(exerciseId);
    const workoutExerciseId = createId("workout-exercise");
    workoutItem.exercises.push({ id: workoutExerciseId, exerciseId, order: workoutItem.exercises.length + 1, notes: "", sets: suggestedSets(exercise) });
    workoutItem.updatedAt = new Date().toISOString();
    state.editingWorkoutId = workoutItem.id;
    setPendingExerciseScroll(workoutExerciseId);
    await persistWorkout(workoutItem);
    closeOverlay();
    // If added from focus mode, jump the session straight into the new exercise
    // (finished one set, wanted the next lift — not to leave focus).
    if (state.focus) {
        const added = workoutItem.exercises.find((item) => item.id === workoutExerciseId);
        state.focus.exerciseId = workoutExerciseId;
        state.focus.setId = (added && added.sets[0]) ? added.sets[0].id : null;
        state.focus.view = "set";
        setPendingExerciseScroll(null);
        renderFocus();
        return;
    }
    if (state.section === "workout") {
        renderSection();
    } else {
        goToWorkoutEditor(workoutItem.id);
    }
}

export async function removeWorkoutExercise(workoutExerciseId) {
    const workoutItem = editWorkout();
    if (!workoutItem) {
        return;
    }
    const entry = workoutItem.exercises.find((item) => item.id === workoutExerciseId);
    if (!entry) {
        return;
    }
    const entryName = exerciseById(entry.exerciseId)?.name || "Вправа";
    const setCount = (entry.sets || []).length;
    const doneCount = (entry.sets || []).filter((set) => set.isCompleted).length;
    const detail = setCount
        ? `${setCount} ${pluralUk(setCount, "підхід", "підходи", "підходів")}${doneCount ? `, з них ${doneCount} виконано` : ", жодного не виконано"}`
        : "Підходів ще немає";
    if (!(await confirmDialog(`«${entryName}»`, {
        title: "Прибрати вправу з тренування?",
        detail,
        confirmLabel: "Прибрати",
        note: "Матимеш 20 секунд, щоб повернути."
    }))) {
        return;
    }
    const index = workoutItem.exercises.findIndex((item) => item.id === workoutExerciseId);
    workoutItem.exercises = workoutItem.exercises.filter((item) => item.id !== workoutExerciseId);
    touchGymClock(workoutItem);
    workoutItem.updatedAt = new Date().toISOString();
    // Removing the LAST exercise empties the workout, and the server refuses that
    // unless the emptying is declared. It is declared here because a person just
    // asked for it.
    await persistWorkout(workoutItem, { confirmEmpty: true });
    renderSection();

    // Saved straight away and restored the same way. Set ids are stable now, so
    // putting the entry back writes byte-identical rows; deferring the SAVE instead
    // would leave the server disagreeing with the screen for twenty seconds, and a
    // second device would show the exercise still there.
    removeWithUndo({
        key: `workout-exercise:${workoutExerciseId}`,
        title: "Вправу прибрано",
        message: `${entryName} · ${detail}`,
        restore: async () => {
            const live = state.database.workouts.find((item) => item.id === workoutItem.id);
            if (!live || !isHydratedWorkout(live) || live.exercises.some((item) => item.id === workoutExerciseId)) {
                return;
            }
            live.exercises.splice(Math.min(index < 0 ? live.exercises.length : index, live.exercises.length), 0, entry);
            touchGymClock(live);
            live.updatedAt = new Date().toISOString();
            await persistWorkout(live);
            renderSection();
            showSyncIndicator("success", "Повернуто");
        },
        // Already saved; the window is the only thing being waited on.
        commit: () => undefined
    });
}

// Rep counts parked across a reps → time → reps round trip, keyed by set id. Session
// scoped on purpose: it exists to make an accidental tap free to take back, not to
// be a second, invisible copy of the workout that outlives a reload.
const timedFlipMemory = new Map();

// «12 кг обсягу · 1ПМ …» says nothing about a plank. What a hold is tracked on is
// how long it was held and how long the longest one was.
export function timedBlockCaption(workoutExercise) {
    const totals = timedTotals(workoutExercise.sets);
    if (!totals.count) {
        return "На час";
    }
    return `На час · ${totals.completed}/${totals.count} ${pluralUk(totals.count, "утримання", "утримання", "утримань")}`
        + `${totals.totalSeconds ? ` · разом ${formatDuration(totals.totalSeconds)}` : ""}`
        + `${totals.bestSeconds ? ` · найдовше ${formatDuration(totals.bestSeconds)}` : ""}`;
}

/**
 * Flip a whole exercise block between counting reps and counting seconds.
 *
 * The whole block rather than one set: mixing the two measures inside one exercise
 * is almost always a slip, and per-set flipping makes it a slip you can make without
 * noticing. A set keeps its weight and its rest either way.
 */
export async function toggleTimedBlock(workoutExerciseId) {
    const workoutExercise = editWorkoutExercise(workoutExerciseId);
    if (!workoutExercise) {
        return;
    }
    const goingTimed = !(workoutExercise.sets || []).some(isTimedSet);
    // Seed from what this exercise was last held for, so flipping a plank on does
    // not start everyone at the same arbitrary 30 seconds forever.
    const seed = goingTimed
        ? (workoutExercise.sets || []).map((set) => Number(set.durationSeconds)).find((value) => value > 0) || DEFAULT_HOLD_SECONDS
        : 0;
    workoutExercise.sets = (workoutExercise.sets || []).map((set) => {
        if (goingTimed) {
            // Flipping to time ZEROES the reps, because volume is weight × reps and
            // a plank remembering "8" would keep adding tonnage nobody lifted. The
            // count is parked here so flipping straight back — the shape of an
            // accidental tap — restores 10/8/8 rather than a flat default.
            timedFlipMemory.set(set.id, Number(set.repetitions) || 0);
            return toTimedSet(set, seed);
        }
        const remembered = timedFlipMemory.get(set.id);
        timedFlipMemory.delete(set.id);
        return toRepSet(set, remembered);
    });
    const workoutItem = editWorkout();
    if (workoutItem) {
        workoutItem.updatedAt = new Date().toISOString();
    }
    await persistWorkout(workoutItem);
    renderSection();
    showSyncIndicator("success", goingTimed ? "Рахуємо час" : "Рахуємо повтори");
}

export async function addSet(workoutExerciseId) {
    const workoutExercise = editWorkoutExercise(workoutExerciseId);
    if (!workoutExercise) {
        return;
    }
    const previousSet = workoutExercise.sets.at(-1);
    if (previousSet) {
        workoutExercise.sets.push({ ...previousSet, id: createId("set"), isCompleted: false });
    } else {
        // First set of an empty block: a static exercise starts on the clock, so
        // adding a plank never means typing a rep count you have to undo.
        const exercise = exerciseById(workoutExercise.exerciseId);
        const fresh = createSet(getPref("defaultSetType"), 0, 8, 8, Number(getPref("defaultRest")) || 90, false);
        workoutExercise.sets.push(exercise?.isTimed ? toTimedSet(fresh) : fresh);
    }
    await persistWorkout(editWorkout());
    renderSection();
}

// Sets the person said «no» to closing along with a later one (see toggleSet).
const skippedEarlierSets = new Set();

export async function toggleSet(workoutExerciseId, setId) {
    const workoutExercise = editWorkoutExercise(workoutExerciseId);
    const set = workoutExercise ? workoutExercise.sets.find((item) => item.id === setId) : null;
    if (!set) {
        return;
    }
    const completing = !set.isCompleted;
    set.isCompleted = completing;
    touchGymClock(editWorkout());
    if (completing) {
        recordFlashSetId = setId;
        setTimeout(() => {
            if (recordFlashSetId === setId) {
                recordFlashSetId = null;
            }
        }, 2500);
    }
    // Inside a superset the rest belongs to the ROUND, not to the set: A1 is followed
    // by A2 immediately, and only the last exercise of the round earns a break. So the
    // per-set timer is suppressed for members and started once, with the group's own
    // rest, when the round closes.
    const roundRest = completing ? supersetRoundRestFor(workoutExercise, setId) : null;
    if (completing && editWorkout()?.status === "active" && getPref("autoStartRest") === "1") {
        if (!workoutExercise.supersetGroupId) {
            startTimer(set.restSeconds || 90);
        } else if (roundRest !== null) {
            startTimer(roundRest);
        }
    }
    // Ticking a set while EARLIER ones that carry numbers are still open → offer to
    // close them too, right away (the "did the warm-ups, forgot to tap them" case).
    // It used to ask only on the last set, by which time the timer and the session
    // clock had already run on the wrong picture. A «no» is remembered for those sets,
    // so one skipped on purpose is not brought up again with every later tick. Never
    // inside a superset: earlier rounds there stay open until their own turn.
    if (completing && !workoutExercise.supersetGroupId) {
        const idx = workoutExercise.sets.findIndex((item) => item.id === setId);
        const earlierPending = workoutExercise.sets.slice(0, idx).filter((item) => !item.isCompleted
            && !skippedEarlierSets.has(item.id)
            && (Number(item.weight) > 0 || Number(item.repetitions) > 0 || Number(item.durationSeconds) > 0));
        if (earlierPending.length > 0) {
            await persistWorkout(editWorkout());
            renderSection();
            const count = earlierPending.length;
            const numbers = earlierPending.map((item) => workoutExercise.sets.indexOf(item) + 1).join(", ");
            const choice = await choiceDialog(count === 1
                ? `Підхід ${numbers} ще не позначений. Позначити його теж виконаним?`
                : `Підходи ${numbers} ще не позначені. Позначити їх теж виконаними?`, {
                title: count === 1 ? "Закрити попередній підхід?" : "Закрити попередні підходи?",
                closable: true,
                choices: [
                    { label: count === 1 ? "Так, позначити" : "Так, усі", value: "all", variant: "primary" },
                    { label: "Ні, лише цей", value: "one" }
                ]
            });
            if (choice === "all") {
                earlierPending.forEach((item) => { item.isCompleted = true; });
                touchGymClock(editWorkout());
            } else {
                earlierPending.forEach((item) => skippedEarlierSets.add(item.id));
            }
        }
    }
    await persistWorkout(editWorkout());
    // If the exercise just became fully complete, animate it collapsed.
    state.expandedExercises = state.expandedExercises || new Set();
    const nowAllDone = workoutExercise.sets.length > 0 && workoutExercise.sets.every((item) => item.isCompleted);
    if (nowAllDone && !state.expandedExercises.has(workoutExerciseId)) {
        state.collapseAnimId = workoutExerciseId;
    }
    renderSection();
    if (state.collapseAnimId === workoutExerciseId) {
        requestAnimationFrame(() => {
            const id = state.collapseAnimId;
            state.collapseAnimId = null;
            const card = document.querySelector(`.workout-exercise[data-workout-exercise-id="${id}"]`);
            if (card) { void card.offsetHeight; card.classList.add("we-collapsed"); }
        });
    }
}

// `skipConfirm`: the new screen reaches this from a menu the user opened on purpose and
// already chose «Видалити» in; asking again is one tap too many when the undo is there.
export async function deleteSet(workoutExerciseId, setId, options = {}) {
    const workoutExercise = editWorkoutExercise(workoutExerciseId);
    if (!workoutExercise) {
        return;
    }
    const removed = workoutExercise.sets.find((item) => item.id === setId);
    if (!removed) {
        return;
    }
    const index = workoutExercise.sets.findIndex((item) => item.id === setId);
    const detail = describeSet(removed, setTypeLabels[removed.type] || "");
    if (!options.skipConfirm && !(await confirmDialog(`Підхід №${index + 1}`, {
        title: "Видалити підхід?",
        detail,
        confirmLabel: "Видалити",
        note: "Матимеш 12 секунд, щоб повернути."
    }))) {
        return;
    }
    workoutExercise.sets = workoutExercise.sets.filter((item) => item.id !== setId);
    touchGymClock(editWorkout());
    await persistWorkout(editWorkout());
    renderSection();

    removeWithUndo({
        key: `set:${setId}`,
        title: "Підхід видалено",
        message: detail,
        // Shorter than a workout: a set is one tap to re-add, and a banner sitting
        // over the action bar for twenty seconds is in the way of the next set.
        seconds: 12,
        restore: async () => {
            const live = editWorkoutExercise(workoutExerciseId);
            if (!live || live.sets.some((item) => item.id === setId)) {
                return;
            }
            live.sets.splice(Math.min(index, live.sets.length), 0, removed);
            touchGymClock(editWorkout());
            await persistWorkout(editWorkout());
            renderSection();
            showSyncIndicator("success", "Повернуто");
        },
        commit: () => undefined
    });
}

export async function updateSetField(workoutExerciseId, setId, field, value) {
    const set = editSetByIds(workoutExerciseId, setId);
    if (!set) {
        return;
    }
    set[field] = ["weight", "repetitions", "rpe", "restSeconds", "durationSeconds"].includes(field) ? Number(value) || 0 : value;
    schedulePersistWorkout(editWorkout());
    if (["weight", "repetitions", "durationSeconds", "type"].includes(field)) {
        refreshWarmupRow(workoutExerciseId);
    }
}

export async function updateWorkoutMeta(workoutId, field, value) {
    const workoutItem = ownWorkout(workoutId);
    if (!workoutItem) {
        return;
    }
    if (field === "date") {
        const limit = workoutLimitState(currentUser().id, value, workoutItem.id);
        if (!limit.allowed) {
            toast("Недоступна дата", `${limit.message} Оберіть іншу дату.`);
            renderSection();
            return;
        }
        workoutItem.date = value;
    } else if (field === "durationOverride") {
        workoutItem.durationOverride = (value === "auto" || value === "" || value == null) ? null : Math.max(0, Math.round(Number(value)) || 0);
    } else {
        workoutItem[field] = value;
    }
    workoutItem.updatedAt = new Date().toISOString();
    await persistWorkout(workoutItem);
    renderSection();
}

// `quiet`: the new screen follows up with its own summary, so no toast on top of it.
export async function finishWorkout(workoutId, options = {}) {
    const workoutItem = workoutId ? ownWorkout(workoutId) : (editWorkout() || activeWorkoutFor(currentUser().id));
    if (!workoutItem) {
        return;
    }
    // Product rule: a finished session has no half-done sets. Everything the user
    // wrote down counts as performed — no dialog, no exceptions. The server applies
    // the same rule on save, so a session can never come back with "0 підходів"
    // exercises in the feed or an under-counted volume.
    // The sweep completes whatever is left — those sets are being done RIGHT NOW, so
    // the clock's end moves with them. Only when something actually changes, though:
    // a session where every set was already ticked keeps the real last tick.
    const pendingSets = [];
    workoutItem.exercises.forEach((exercise) => {
        (exercise.sets || []).forEach((set) => {
            if (!set.isCompleted) {
                pendingSets.push(set);
            }
        });
    });
    pendingSets.forEach((set) => {
        set.isCompleted = true;
    });
    // The sweep completes whatever is left — those sets are being done RIGHT NOW, so
    // the clock's end moves with them. Never invent a START, though: a session closed
    // from the calendar days later was never timed, and a fabricated anchor would show
    // a meaningless 0:00 clock.
    if (pendingSets.length && workoutItem.firstSetAt) {
        workoutItem.lastSetAt = new Date().toISOString();
    }
    // Finishing asks nothing. The clock is there to be looked at, not to negotiate
    // with: duration is set deliberately, from the «Тривалість» picker in the editor,
    // and a dialog in the way of the finish button was one more thing to dismiss
    // while standing in a gym.
    workoutItem.status = "completed";
    workoutItem.finishedAt = new Date().toISOString();
    workoutItem.updatedAt = new Date().toISOString();
    stopTimer();
    await persistWorkout(workoutItem);
    invalidateFeed();
    renderSection();
    if (!options.quiet) {
        toast("Тренування завершено", "Статистику та рекорди перераховано.");
        checkAchievementUnlocks();
    }
}

// Rounded to something a person would say out loud (see suggestedDurationMinutes).
export async function saveCardio(workoutId, cardioId = null) {
    const workoutItem = ownWorkout(workoutId);
    if (!workoutItem) {
        return;
    }
    const duration = Math.max(1, Math.round(numberValue("cardioDuration", 0)));
    if (!duration) {
        toast("Вкажи час", "Тривалість кардіо обов'язкова.");
        return;
    }
    const data = {
        type: inputValue("cardioType") || "treadmill",
        durationMinutes: duration,
        distance: round(numberValue("cardioDistance", 0), 2),
        calories: Math.round(numberValue("cardioCalories", 0)),
        averageHeartRate: Math.round(numberValue("cardioHeartRate", 0)),
        intensity: inputValue("cardioIntensity") || "medium",
        notes: inputValue("cardioNotes").trim()
    };
    workoutItem.cardioSessions = workoutItem.cardioSessions || [];
    const existing = cardioId ? workoutItem.cardioSessions.find((item) => item.id === cardioId) : null;
    if (existing) {
        Object.assign(existing, data);
    } else {
        workoutItem.cardioSessions.push({ id: createId("cardio"), ...data });
    }
    workoutItem.updatedAt = new Date().toISOString();
    await persistWorkout(workoutItem);
    closeOverlay();
    renderSection();
}

export async function deleteCardio(workoutId, cardioId) {
    const workoutItem = ownWorkout(workoutId);
    if (!workoutItem) {
        return;
    }
    if (!(await confirmDialog("Видалити цей кардіо-блок?", { confirmLabel: "Видалити" }))) {
        return;
    }
    workoutItem.cardioSessions = (workoutItem.cardioSessions || []).filter((item) => item.id !== cardioId);
    workoutItem.updatedAt = new Date().toISOString();
    await persistWorkout(workoutItem);
    renderSection();
}
