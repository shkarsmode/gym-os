// Persisting: payloads, the per-workout saver, the offline queue.
import { SUPERSET_DEFAULT_REST } from "../lib/superset.js";
import { serverVersionOf, isStaleConflict, conflictVersion, localIsAhead } from "../lib/realtime.js";
import { storage } from "./data.js";
import { canManage } from "./model.js";
import { friendlyError, handleUserFacingError, showSyncIndicator, syncIndicatorTimeoutId, toast } from "./overlays.js";
import { renderSection } from "./shell.js";
import { state } from "./state.js";
import { iconsIn } from "./util.js";

export async function persist(options = {}) {
    state.database.updatedAt = new Date().toISOString();
    if (!options.silent) {
        showSyncIndicator("loading", "Зберігаємо зміни");
    }

    try {
        await storage.save(state.database);
        if (!options.silent) {
            showSyncIndicator("success", "Зміни збережено");
        }
    } catch (error) {
        showSyncIndicator("error", friendlyError(error));
        throw error;
    }
}

function workoutPayload(workoutItem, options = {}) {
    // POST /workouts/:id/save is a destructive full replace: the backend deletes
    // every set, exercise and cardio session of the workout and recreates them from
    // this payload. Both `exercises` and `cardioSessions` below fall back to [], so
    // serialising a workout that has no sets loaded would atomically and
    // permanently delete that workout's real sets, with no error surfaced.
    //
    // Nothing produces such an object today — every workout is fully hydrated. This
    // guard exists because the windowed/summary payload work is about to introduce
    // list-shaped workout rows, and this is the function they must never reach.
    //
    // status 400 is load-bearing, not decoration: this is called inside the
    // offline-queue flush, and isRetriableError() treats a status-less Error as
    // network loss. Without it the queue head is never shifted and the queue
    // deadlocks permanently on this entry.
    //
    // Array.isArray, not truthiness: a completed cardio-only workout legitimately
    // has exercises: [] and must still save.
    if (!Array.isArray(workoutItem.exercises) || !Array.isArray(workoutItem.cardioSessions)) {
        const error = new Error("Внутрішня помилка: спроба зберегти тренування без завантажених підходів.");
        error.status = 400;
        throw error;
    }

    return {
        date: workoutItem.date,
        title: workoutItem.title || "Тренування",
        status: workoutItem.status || "active",
        workoutType: workoutItem.workoutType || "custom",
        notes: workoutItem.notes || "",
        // undefined (not null) when unset → JSON.stringify drops the key, so an
        // older backend that hasn't deployed this field yet won't 400 on it.
        durationOverride: (workoutItem.durationOverride === undefined || workoutItem.durationOverride === null || workoutItem.durationOverride === "") ? undefined : Math.round(Number(workoutItem.durationOverride)),
        firstSetAt: workoutItem.firstSetAt || undefined,
        lastSetAt: workoutItem.lastSetAt || undefined,
        // The revision this payload was built from. The server refuses the write if
        // the row has moved on since — without it, saving from a device holding an
        // old copy silently deletes whatever another device added in the meantime,
        // because this endpoint replaces the whole tree. undefined (not null) so the
        // key is dropped for a workout that has never been saved.
        baseUpdatedAt: workoutItem.serverVersion || undefined,
        // Only ever sent for a save the user actually asked for, and only when the
        // list really is empty — so the server's guard keeps working for everything
        // else. undefined drops the key entirely.
        confirmEmpty: options.confirmEmpty && !(workoutItem.exercises || []).length ? true : undefined,
        exercises: (workoutItem.exercises || []).map((exercise, index) => ({
            // Send the ids this client already mints. The server keeps them, so a set
            // survives a save with the same identity — which is what makes it
            // possible to name one in a realtime event, or to edit exactly it rather
            // than whatever happens to be in that position by the time the request
            // lands. undefined (not null) so the key is dropped for a row that has
            // none yet.
            id: exercise.id || undefined,
            exerciseId: exercise.exerciseId,
            order: exercise.order || index + 1,
            // undefined, not null, so a client that never touched supersets sends a
            // payload byte-identical to the one it sent before the feature existed.
            supersetGroupId: exercise.supersetGroupId || undefined,
            notes: exercise.notes || "",
            sets: (exercise.sets || []).map((set) => ({
                id: set.id || undefined,
                type: set.type || "working",
                weight: Number(set.weight) || 0,
                repetitions: Number(set.repetitions) || 0,
                durationSeconds: set.durationSeconds === undefined || set.durationSeconds === null || set.durationSeconds === "" ? null : Math.round(Number(set.durationSeconds)) || null,
                rpe: Number(set.rpe) || 0,
                restSeconds: Number(set.restSeconds) || 90,
                isCompleted: Boolean(set.isCompleted),
                notes: set.notes || ""
            }))
        })),
        // Only the rest lives on a group — a round is the Nth set of each member, so
        // the rounds themselves are already inside `exercises`. Omitted entirely when
        // there are none, so nothing changes for a workout that has no supersets.
        supersetGroups: (workoutItem.supersetGroups || []).length
            ? workoutItem.supersetGroups.map((group) => ({
                id: group.id,
                restSeconds: Math.max(0, Math.round(Number(group.restSeconds) || SUPERSET_DEFAULT_REST))
            }))
            : undefined,
        cardioSessions: (workoutItem.cardioSessions || []).map((session) => ({
            type: session.type || "treadmill",
            durationMinutes: Number(session.durationMinutes) || 0,
            distance: Number(session.distance) || 0,
            calories: Number(session.calories) || 0,
            averageHeartRate: Number(session.averageHeartRate) || 0,
            intensity: session.intensity || "medium",
            notes: session.notes || ""
        }))
    };
}

// ---- Coalescing, serialized per-workout saver ----
// Each workout has at most ONE save in flight. Rapid edits collapse into a
// single trailing save that always sends the LATEST full state. The "saved"
// (green) indicator only appears once the queue is fully drained, so it never
// lies while later saves are still pending/failing. Failed saves retry a few
// times (covers transient 500s) before surfacing an error.
export const workoutSavers = new Map();

let localPersistTimeoutId = null;

function getWorkoutSaver(workoutId) {
    let saver = workoutSavers.get(workoutId);
    if (!saver) {
        saver = { running: false, dirty: false, retries: 0, timer: null, lastError: null, confirmEmpty: false };
        workoutSavers.set(workoutId, saver);
    }
    return saver;
}

// ---- Offline queue: failed workout writes wait locally and sync on reconnect ----
// Entries: {kind:"save", id, payload} | {kind:"delete", id}. Saves keep a payload
// snapshot so a reload while offline can still push; when the workout is still in
// memory the freshest state wins at flush time. localStorage-backed.
export function isNetworkError(error) {
    return Boolean(error) && !Number(error.status) && !/base url/i.test(String(error.message || ""));
}

// Is this worth trying again, or is the server telling us it never will be?
// 408 and 429 are the only 4xx worth a retry; the rest of that range is a
// permanent rejection (malformed payload, forbidden, gone) and retrying it only
// burns the per-user throttle budget — which is 200 requests per 60s, shared with
// every other call the session makes.
function isRetriableError(error) {
    const status = Number(error?.status) || 0;
    if (!status) {
        return true; // network loss or client-side timeout
    }
    return status === 408 || status === 429 || status >= 500;
}

// Honours Retry-After when the server sends one, so a 429 backs off by as much as
// the backend asked for rather than by our own guess.
function retryDelayMs(error, attempt) {
    const retryAfter = Number(error?.payload?.retryAfter || error?.retryAfter || 0);
    if (retryAfter > 0) {
        return Math.min(retryAfter * 1000, 30000);
    }
    return 1000 * attempt;
}

export function readOfflineQueue() {
    try {
        return JSON.parse(storage.readSetting("offline-queue") || "[]") || [];
    } catch (error) {
        return [];
    }
}

function writeOfflineQueue(queue) {
    storage.writeSetting("offline-queue", JSON.stringify(queue));
}

export function enqueueOffline(entry) {
    const queue = readOfflineQueue().filter((item) => !(item.id === entry.id && item.kind === entry.kind));
    // Stamped with the owner. The queue is a single un-scoped localStorage key that
    // logout never clears, and the backend's saveFull creates a workout with no
    // server row under whoever is currently signed in — so an unflushed entry could
    // be replayed into a different account on a shared device.
    queue.push({ ...entry, userId: storage.currentUser?.id || "", ts: Date.now() });
    writeOfflineQueue(queue);
    showOfflineChip();
}

export function showOfflineChip() {
    const chip = document.getElementById("syncChip");
    if (!chip) {
        return;
    }
    const count = readOfflineQueue().length;
    clearTimeout(syncIndicatorTimeoutId);
    chip.className = "sync-chip visible offline";
    chip.innerHTML = `<span class="sync-chip-ico" aria-hidden="true"><i data-lucide="wifi-off"></i></span><span class="sync-chip-text">Офлайн · ${count} ${count === 1 ? "зміна очікує" : "змін очікують"}</span>`;
    iconsIn(chip);
}

let offlineFlushRunning = false;

export async function flushOfflineQueue() {
    // storage.currentUser is required: a tokenless boot would otherwise 401 the
    // whole queue at startup, and entries now carry an owner to compare against.
    if (offlineFlushRunning || !(storage.mode === "api" && storage.apiClient.hasBaseUrl() && storage.currentUser)) {
        return;
    }
    let queue = readOfflineQueue();
    if (!queue.length) {
        return;
    }
    offlineFlushRunning = true;
    showSyncIndicator("loading", "Синхронізуємо офлайн-зміни…");
    try {
        while (queue.length) {
            const entry = queue[0];
            // Never replay another account's work into this one. Entries predating
            // this change carry no userId and stay eligible, which is the old
            // behaviour and correct for a single-account device.
            if (entry.userId && entry.userId !== (storage.currentUser?.id || "")) {
                queue.shift();
                writeOfflineQueue(queue);
                continue;
            }
            try {
                if (entry.kind === "delete") {
                    try {
                        await storage.apiClient.deleteWorkout(entry.id);
                    } catch (error) {
                        if (Number(error?.status) !== 404) {
                            throw error;
                        }
                    }
                } else {
                    // Prefer the live row so a replay carries any edits made since
                    // it was queued — but only when it is actually hydrated. Once
                    // the boot payload becomes windowed, the in-memory row for an
                    // older workout may be a summary, and workoutPayload refuses
                    // those. The snapshot captured at enqueue time is always whole.
                    const workoutItem = state.database?.workouts?.find((item) => item.id === entry.id);
                    const isHydrated = workoutItem && Array.isArray(workoutItem.exercises) && Array.isArray(workoutItem.cardioSessions);
                    const payload = isHydrated ? workoutPayload(workoutItem) : entry.payload;
                    if (payload) {
                        await storage.apiClient.saveWorkout(entry.id, payload);
                    }
                }
            } catch (error) {
                // Anything retriable — network loss, a cold-start 500, a 429, an
                // expired session — leaves the entry in the queue. This used to
                // drop on ANY error carrying a status, so a single 5xx silently
                // destroyed a workout logged offline in a basement gym: the one
                // scenario the queue exists for.
                if (isRetriableError(error) || Number(error?.status) === 401) {
                    showOfflineChip();
                    return;
                }
                // A permanent rejection (bad payload, quota) — drop it, or the
                // queue jams forever behind an entry that can never succeed.
                toast("Не вдалося синхронізувати", friendlyError(error), "error");
            }
            queue.shift();
            writeOfflineQueue(queue);
        }
        showSyncIndicator("success", "Офлайн-зміни синхронізовано");
    } finally {
        offlineFlushRunning = false;
    }
}

function requestWorkoutSave(workoutItem, debounceMs = 0, options = {}) {
    if (!workoutItem) {
        return;
    }
    if (options.confirmEmpty) {
        // Sticky until a save lands: the emptying save may be debounced, retried, or
        // superseded by another, and the intent has to survive all three.
        getWorkoutSaver(workoutItem.id).confirmEmpty = true;
    }
    state.database.updatedAt = new Date().toISOString();

    if (!(storage.mode === "api" && storage.apiClient.hasBaseUrl())) {
        clearTimeout(localPersistTimeoutId);
        localPersistTimeoutId = setTimeout(() => {
            persist({ silent: true }).catch((error) => {
                console.error(error);
                showSyncIndicator("error", friendlyError(error));
            });
        }, Math.max(150, debounceMs));
        return;
    }

    const saver = getWorkoutSaver(workoutItem.id);
    showSyncIndicator("loading", "Зберігаємо…");
    clearTimeout(saver.timer);
    // Cleared when it fires so `saver.timer` means "a save is still pending" —
    // flushPendingWorkoutSaves() relies on that to avoid re-saving on every
    // background/foreground cycle.
    saver.timer = setTimeout(() => {
        saver.timer = null;
        runWorkoutSave(workoutItem.id);
    }, debounceMs);
}

async function runWorkoutSave(workoutId) {
    const saver = getWorkoutSaver(workoutId);
    if (saver.running) {
        saver.dirty = true;
        return;
    }
    const workoutItem = state.database.workouts.find((item) => item.id === workoutId && canManage(item));
    if (!workoutItem) {
        return;
    }

    saver.running = true;
    saver.dirty = false;
    let ok = false;
    try {
        workoutItem.updatedAt = new Date().toISOString();
        const ack = await storage.apiClient.saveWorkout(workoutItem.id, workoutPayload(workoutItem, { confirmEmpty: saver.confirmEmpty }));
        // The revision this save produced becomes the base of the next one. Without
        // adopting it, the second save of a session would announce a version the
        // server had already moved past and be refused as stale.
        if (ack && ack.updatedAt) {
            workoutItem.serverVersion = ack.updatedAt;
        }
        storage.backendStatus = "online";
        ok = true;
        saver.retries = 0;
        saver.conflictRetries = 0;
        saver.confirmEmpty = false;
    } catch (error) {
        saver.lastError = error;
        console.error(error);
        if (Number(error?.status) === 401 && storage.config.requireAuth) {
            saver.running = false;
            handleUserFacingError(error, "save-workout");
            return;
        }
        // The row moved on somewhere else — most often this account's other device.
        // This endpoint replaces the whole tree, so the payload just refused would
        // have deleted whatever the other device added. Reconcile instead.
        if (isStaleConflict(error)) {
            saver.conflictRetries = (saver.conflictRetries || 0) + 1;
            // Two devices saving in a tight loop could ping-pong forever; after a
            // couple of rounds stop and let the user see what happened.
            if (saver.conflictRetries <= 2 && await reconcileStaleWorkout(workoutItem, error)) {
                saver.dirty = true;
                saver.lastError = null;
            }
        }
        // Network loss (gym basement mode): park the save in the offline queue
        // instead of burning retries — it syncs when the connection returns.
        if (isNetworkError(error)) {
            enqueueOffline({ kind: "save", id: workoutId, payload: workoutPayload(workoutItem) });
            saver.queued = true;
        }
    } finally {
        saver.running = false;
        if (saver.dirty) {
            runWorkoutSave(workoutId);
        } else if (ok) {
            showSyncIndicator("success", "Збережено");
            if (readOfflineQueue().length) {
                flushOfflineQueue();
            }
        } else if (saver.queued) {
            saver.queued = false;
            saver.retries = 0;
        } else if (!isRetriableError(saver.lastError)) {
            // Permanent rejection — retrying cannot change the outcome. Surface it
            // once instead of three times over six seconds.
            saver.retries = 0;
            showSyncIndicator("error", friendlyError(saver.lastError));
        } else if (saver.retries < 3) {
            saver.retries += 1;
            showSyncIndicator("loading", "Повтор збереження…");
            setTimeout(() => runWorkoutSave(workoutId), retryDelayMs(saver.lastError, saver.retries));
        } else {
            saver.retries = 0;
            showSyncIndicator("error", friendlyError(saver.lastError));
        }
    }
}

// Decide what to do when the server refuses a save because the row moved on.
//
// Returns true when the caller should retry the save, false when the local copy was
// replaced by the server's and there is nothing left to send.
//
// The conflict has two very different shapes and they need opposite handling:
//
//  - This device is merely BEHIND — it holds an older revision but nothing the newer
//    one has is missing from it (the usual case: a second tab, or a phone that was
//    idle while the desktop did nothing but bump the row). Re-sending is safe, so
//    re-base on the server's revision and retry silently.
//
//  - Both copies contain training the other lacks. Re-sending would delete the other
//    device's work, and no automatic rule can pick a winner honestly. Take the
//    server's copy — it is the one holding what this device has not seen — and say so
//    out loud, because a set that vanishes without a word is the exact failure this
//    whole mechanism exists to prevent.
async function reconcileStaleWorkout(workoutItem, error) {
    let fresh = null;
    try {
        fresh = await storage.apiClient.fetchWorkout(workoutItem.id);
    } catch (fetchError) {
        fresh = null;
    }
    if (!fresh || !Array.isArray(fresh.exercises)) {
        // Could not read the other side; adopt the version the refusal named so the
        // retry at least carries a current base, and let the normal retry path run.
        const named = conflictVersion(error);
        if (named) {
            workoutItem.serverVersion = named;
            return true;
        }
        return false;
    }
    if (localIsAhead(workoutItem, fresh)) {
        workoutItem.serverVersion = serverVersionOf(fresh) || conflictVersion(error) || workoutItem.serverVersion;
        return true;
    }
    const localTouchedAt = workoutItem.updatedAt;
    Object.assign(workoutItem, fresh);
    workoutItem.serverVersion = serverVersionOf(fresh);
    workoutItem.updatedAt = localTouchedAt || workoutItem.updatedAt;
    renderSection();
    // Deliberately loud. The local edit that triggered this save did not land, and a
    // set disappearing without a word is the exact failure the version check exists
    // to prevent — so it is said out loud rather than logged.
    toast(
        "Тренування змінилось на іншому пристрої",
        "Показано свіжу версію. Перевір останній підхід — можливо, його треба відмітити ще раз.",
        "error"
    );
    return false;
}

export function cancelWorkoutSave(workoutId) {
    const saver = workoutSavers.get(workoutId);
    if (saver) {
        clearTimeout(saver.timer);
        workoutSavers.delete(workoutId);
    }
}

/**
 * @param {{confirmEmpty?: boolean}} options
 *
 * `confirmEmpty` is how a DELIBERATE emptying is told apart from a client bug. The
 * server refuses to replace a workout that has exercises with an empty list, which
 * is exactly right — it is the last line of defence against a summary-shaped row
 * being saved over a real session. So removing the final exercise has to say so,
 * rather than the guard being switched off for every save.
 */
export function persistWorkout(workoutItem, options = {}) {
    requestWorkoutSave(workoutItem, 0, options);
    return Promise.resolve();
}

export function schedulePersistWorkout(workoutItem) {
    requestWorkoutSave(workoutItem, 650);
}

// Any debounced save still waiting when the app is backgrounded must fire now.
// Phones suspend a tab aggressively: without this, completing the last set and
// immediately locking the screen loses that set for up to 650ms of dead time.
// pagehide covers iOS Safari, where visibilitychange alone is unreliable.
export function flushPendingWorkoutSaves() {
    for (const [workoutId, saver] of workoutSavers) {
        if (saver.timer) {
            clearTimeout(saver.timer);
            saver.timer = null;
            runWorkoutSave(workoutId);
        }
    }
}
