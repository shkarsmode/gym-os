// Take-it-back deletions.
import { number } from "../lib/format.js";
import { workoutCardioMinutes, workoutSetCount } from "./model.js";
import { toast } from "./overlays.js";
import { workoutExerciseCount, workoutVolumeOf } from "./workout-history.js";
import { pluralUk } from "./workout-screen.js";

// ---- Take-it-back deletions -----------------------------------------------------------
//
// Nothing reaches the server while the window is open. The row leaves the screen at
// once and the delete commits only when the countdown ends — the opposite order to
// "delete now, re-create if they change their mind", which has to rebuild the row
// from the client's copy and can fail halfway, leaving the person with neither their
// workout nor a clean error to act on.
const pendingRemovals = new Map();

export function removeWithUndo({ key, title, message, undoLabel = "Повернути", seconds = 20, restore, commit }) {
    // Deleting the same row twice would leave two timers racing to commit it; settle
    // the older one first so its work is not silently dropped.
    commitPendingRemovals(key);
    let settled = false;
    const settle = (run) => {
        if (settled) {
            return;
        }
        settled = true;
        pendingRemovals.delete(key);
        Promise.resolve()
            .then(run)
            .catch((error) => console.warn("Undo settle failed", error));
    };
    pendingRemovals.set(key, () => settle(commit));
    toast(title, message, "undo", {
        duration: seconds * 1000,
        action: { label: undoLabel, icon: "undo-2", onClick: () => settle(restore) },
        onExpire: () => settle(commit)
    });
}

/**
 * Settle outstanding windows now — one by key, or all of them.
 *
 * Called when the tab goes away, because an undo window is a promise to delete
 * LATER, and a promise nobody is left running is just a row that quietly came back
 * from the dead on the next boot.
 */
export function commitPendingRemovals(key) {
    for (const [id, commit] of [...pendingRemovals]) {
        if (key === undefined || id === key) {
            pendingRemovals.delete(id);
            try {
                commit();
            } catch (error) {
                console.warn("Undo commit failed", error);
            }
        }
    }
}

// Plain-language "what am I throwing away" for the confirm and the toast. Both read
// from the same function so the dialog cannot promise one thing and the toast report
// another.
export function workoutRemovalSummary(workoutItem) {
    const exercises = workoutExerciseCount(workoutItem);
    const sets = workoutSetCount(workoutItem);
    const volume = workoutVolumeOf(workoutItem);
    const cardio = workoutCardioMinutes(workoutItem);
    const parts = [];
    if (exercises) {
        parts.push(`${exercises} ${pluralUk(exercises, "вправа", "вправи", "вправ")}`);
    }
    if (sets) {
        parts.push(`${sets} ${pluralUk(sets, "підхід", "підходи", "підходів")}`);
    }
    if (volume) {
        parts.push(`${number(volume)} кг обсягу`);
    }
    if (cardio) {
        parts.push(`${cardio} хв кардіо`);
    }
    return parts.join(" · ");
}
