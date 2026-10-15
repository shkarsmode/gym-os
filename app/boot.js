// Startup: initialize(), loading the database, preloading avatars.
import { imageUrl } from "../lib/format.js";
import { serverVersionOf } from "../lib/realtime.js";
import { captureAuthToken, storage } from "./data.js";
import { bindEvents } from "./events.js";
import { refreshUnreadCount, syncAchievementsToFeed, syncRecordsToFeed } from "./feed.js";
import { startLiveStream } from "./live.js";
import { maybeStartOnboarding } from "./onboarding.js";
import { friendlyError, hideBusyOverlay, showBusyOverlay, updateBusyOverlay } from "./overlays.js";
import { loadPartnerState } from "./partner.js";
import { flushOfflineQueue, persist, readOfflineQueue, showOfflineChip } from "./persistence.js";
import { applyPreferences, syncPreferencesFromServer } from "./prefs.js";
import { replayMissedCheers } from "./presence.js";
import { loadAccessState } from "./privacy.js";
import { checkAchievementUnlocks } from "./progression.js";
import { handleRoute } from "./router.js";
import { createEmptyDatabase } from "./seed.js";
import { applySidebarState, maybeShowWhatsNew } from "./settings.js";
import {
    renderApprovalGate, renderAuthGate, renderLoadFailure, renderSection, renderShell, requiresApproval
} from "./shell.js";
import { state } from "./state.js";
import { loadPersonalTemplates } from "./templates.js";
import { reconcileWorkoutStatuses } from "./workout-actions.js";

export async function initialize() {
    applyPreferences();
    captureAuthToken();
    const overlay = showBusyOverlay({
        title: "Запускаємо GymOS",
        message: "Перевіряємо backend і сесію.",
        detail: "Дані доступні після авторизації Google.",
        progress: 15
    });
    try {
        await storage.initialize();
        bindEvents();
        applySidebarState();
        state.authUser = storage.currentUser;
        // Push any offline-queued workout changes BEFORE loading, so /export
        // already includes them (snapshots survive reloads via localStorage).
        await flushOfflineQueue().catch(() => {});
        // Order matters: "backend unreachable" is checked BEFORE
        // requiresAuthentication(), because an unreachable backend leaves
        // currentUser null and would otherwise be misreported as "not signed in".
        //
        // But it must ALSO require a stored token. backendUnavailable always
        // implies currentUser === null (refreshCurrentUser only runs when the
        // backend answers), so an unguarded check here shadows the auth gate
        // entirely and strands a genuinely logged-out user on a screen that tells
        // them their session is fine and offers no way to sign in.
        let hasStoredSession = false;
        try {
            hasStoredSession = Boolean(localStorage.getItem("gymos-auth-token"));
        } catch (error) {
            hasStoredSession = false;
        }
        if (storage.backendUnavailable && hasStoredSession) {
            state.database = createEmptyDatabase();
            renderLoadFailure("Backend не відповідає. Сесія збережена.");
            return;
        }
        if (storage.requiresAuthentication()) {
            state.database = createEmptyDatabase();
            renderAuthGate();
            return;
        }
        if (requiresApproval()) {
            state.database = createEmptyDatabase();
            renderApprovalGate();
            return;
        }
        // Adopt this account's saved appearance/settings prefs before first paint.
        syncPreferencesFromServer();
        updateBusyOverlay(overlay, {
            message: "Завантажуємо тренування.",
            detail: "Каталог і історія приходять з backend.",
            progress: 60
        });
        // No `|| createSeedDatabase()`: a falsy load is a failure, not a cue to
        // invent three Ukrainian demo members and present them as the user's team.
        state.database = await loadDatabaseOrThrow();
    } catch (error) {
        console.error(error);
        state.database = createEmptyDatabase();
        // Only a genuine auth failure sends the user back to the login screen.
        // Everything else (5xx, 413, 429, timeout, malformed body, network) is a
        // load failure with the session still intact.
        if (Number(error?.status) === 401) {
            renderAuthGate(friendlyError(error));
        } else {
            renderLoadFailure(friendlyError(error));
        }
        return;
    } finally {
        hideBusyOverlay(overlay);
    }
    state.profileUserId = state.database.currentUserId;
    // Seeded from every payload install: null under the legacy shape (all history is
    // already present), a cursor under the windowed one.
    state.workoutsCursor = state.database.workoutsCursor || null;
    if (storage.mode !== "api") {
        await persist();
    }
    reconcileWorkoutStatuses();
    renderShell();
    handleRoute();
    // Open the live stream once there is a session and a payload to keep in step.
    // Started here rather than at module load: before this point there is no token,
    // and a stream opened without one just burns a reconnect cycle against a 401.
    startLiveStream();
    loadPartnerState().then(() => {
        if (state.section === "workout") {
            renderSection();
        }
    });
    loadAccessState().then(() => {
        if (state.section === "settings") {
            renderSection();
        }
        // Deliberately late: landing straight into a dialog on open is how a setting
        // gets dismissed without being read. Privacy is now one of the onboarding
        // questions rather than its own ambush, so there is a single entry point.
        setTimeout(maybeStartOnboarding, 2200);
    });
    // Cheers that arrived while the app was closed. This used to run only on
    // returning to an already-open tab, which is the rarer case: a phone in a gym is
    // locked and the app fully suspended, so the ones most worth seeing were exactly
    // the ones being dropped.
    setTimeout(replayMissedCheers, 1200);
    preloadAvatars();
    refreshUnreadCount();
    setTimeout(syncAchievementsToFeed, 2500);
    setTimeout(syncRecordsToFeed, 4000);
    requestAnimationFrame(maybeShowWhatsNew);
    // Toast achievements unlocked since the last visit (e.g. an idea marked
    // "done" while away); the very first run seeds silently.
    setTimeout(checkAchievementUnlocks, 1200);
    loadPersonalTemplates().then(() => {
        if (state.section === "workout") {
            renderSection();
        }
    });
    if (readOfflineQueue().length) {
        showOfflineChip();
    }
}

// Warm the browser cache with member avatars so they paint instantly (no flash)
// when switching tabs / re-rendering.
function preloadAvatars() {
    try {
        (state.database.users || []).forEach((user) => {
            const url = imageUrl(user && user.avatarUrl);
            if (url) {
                const img = new Image();
                img.decoding = "async";
                img.src = url;
            }
        });
    } catch (error) {
        // non-fatal
    }
}

// Returns a human-readable reason the payload is unusable, or "" when it is fine.
// Every /export consumer runs this before assigning to state.database — the app
// used to silently substitute demo seed data whenever a load returned something
// unexpected, so a backend problem looked like real (but wrong) training history.
export function databaseProblem(database) {
    if (!database || typeof database !== "object" || Array.isArray(database)) {
        return "Backend повернув порожню відповідь.";
    }
    if (!Array.isArray(database.users) || !Array.isArray(database.workouts) || !Array.isArray(database.exercises)) {
        return "Backend повернув дані у невідомому форматі.";
    }
    if (!Number(database.version) || Number(database.version) < 3) {
        return "Версія даних застаріла. Онови сторінку, щоб отримати свіжу версію застосунку.";
    }
    return "";
}

// Single funnel for every read of the backend snapshot. Refuses to install an
// unusable payload into state.database and throws a readable reason instead.
export async function loadDatabaseOrThrow() {
    const loaded = await storage.load();
    const problem = databaseProblem(loaded);
    if (problem) {
        throw new Error(problem);
    }
    adoptServerVersions(loaded.workouts);
    // A refused detail read is a fact about one moment, not about the workout. It was
    // being written onto the row and kept forever, so a session that became readable
    // — because its owner granted access, or simply because it finished — still said
    // "Деталі недоступні" until the cache was cleared by hand.
    for (const row of (Array.isArray(loaded.workouts) ? loaded.workouts : [])) {
        delete row.detailUnavailable;
    }
    return loaded;
}

// Remember which server revision each workout came from.
//
// Kept in its OWN field rather than reusing `updatedAt`: that one is a local "when
// did I last touch this" marker, written by every mutation site from the device's own
// clock, so it is never behind and would make the staleness check useless. This is
// the value the server minted, and the only thing worth sending back as the base of
// the next save.
function adoptServerVersions(rows) {
    for (const row of (Array.isArray(rows) ? rows : [])) {
        const version = serverVersionOf(row);
        if (version) {
            row.serverVersion = version;
        }
    }
}
