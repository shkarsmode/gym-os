// The last copy of each workout the server confirmed to this device: the base of the
// three-way merge when a save is refused as stale.
import { snapshotWorkout } from "../lib/realtime.js";

const copies = new Map();

export function rememberServerCopy(workoutItem) {
    const snapshot = snapshotWorkout(workoutItem);
    if (workoutItem && workoutItem.id && snapshot) {
        copies.set(workoutItem.id, snapshot);
    }
}

export function rememberSentCopy(workoutId, snapshot) {
    if (workoutId && snapshot) {
        copies.set(workoutId, snapshot);
    }
}

export function serverCopyOf(workoutId) {
    return copies.get(workoutId) || null;
}

export function forgetServerCopy(workoutId) {
    copies.delete(workoutId);
}
