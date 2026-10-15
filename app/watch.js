// Watching somebody's session live.
import { escapeHtml, imageUrl } from "../lib/format.js";
import { emptyInline } from "./components.js";
import { storage } from "./data.js";
import { userById } from "./model.js";
import { closeOverlay, friendlyError, openDrawer, toast } from "./overlays.js";
import { partnerState } from "./partner.js";
import { liveState } from "./presence.js";
import { privateWorkoutPanel } from "./privacy.js";
import { state } from "./state.js";
import { iconsIn } from "./util.js";
import { workoutEditor } from "./workout-screen.js";

// ---- Watching somebody's session live ------------------------------------------------
//
// The SAME workout screen, in the read-only mode it already supports — not a bespoke
// panel and not focus mode. What makes it live is a hint from the server saying the
// session moved; the sets themselves are re-read through GET /workouts/:id, which is
// authorized on its own, so watching can never show something a plain request would
// refuse.
export const watchState = { workoutId: null, workout: null, previous: {}, token: null, timer: null, loading: false, opening: false, openTimer: null };

/**
 * A floating way in and out of somebody else's session.
 *
 * The point is peeking BETWEEN sets: one tap to see what they are on, one tap back to
 * your own screen exactly where you left it — not a navigation, which would lose your
 * scroll position and your place in the workout.
 *
 * Bottom-LEFT because the collapsed rest timer owns bottom-right for most of a
 * session and the centre belongs to the nav's own button. It only exists while there
 * is something to peek at, so it is never a mystery control.
 */
export function syncWatchFab() {
    const target = watchFabTarget();
    let fab = document.getElementById("watchFab");
    if (!target) {
        fab?.remove();
        return;
    }
    if (!fab) {
        fab = document.createElement("button");
        fab.id = "watchFab";
        fab.type = "button";
        fab.className = "watch-fab";
        document.body.appendChild(fab);
    }
    const open = isWatching();
    fab.dataset.action = open ? "close-watch" : "watch-workout";
    fab.dataset.workoutId = target.workoutId;
    fab.title = open ? "Повернутися до свого тренування" : `Подивитися тренування ${target.displayName}`;
    fab.setAttribute("aria-label", fab.title);
    fab.classList.toggle("is-open", open);
    // A circle, not a pill with a name in it: a round button is the shape a floating
    // action has everywhere, it cannot be clipped by a long name, and it needs no
    // width calculation to stay clear of the timer on the other side.
    const person = userById(target.userId);
    const face = imageUrl(person?.avatarUrl);
    fab.innerHTML = open
        ? `<i data-lucide="corner-up-left"></i>`
        : face
            ? `<img src="${escapeHtml(face)}" alt="" referrerpolicy="no-referrer" loading="eager" decoding="sync">`
            : `<span class="watch-fab-initials">${escapeHtml((target.displayName || "?").slice(0, 1).toUpperCase())}</span>`;
    iconsIn(fab);
}

/**
 * Whose session the button peeks at.
 *
 * A training partner first — that is the person you are deliberately alongside. Then
 * whoever is already being watched, so the button can bring you back. Nobody
 * otherwise: the strip is how you start watching someone you are not paired with.
 */
function watchFabTarget() {
    if (storage.mode !== "api" || !state.database?.currentUserId) {
        return null;
    }
    const partner = partnerState.partnership?.status === "active" ? partnerState.partnership.partner : null;
    if (partner) {
        const live = liveState.presence.find((item) => !item.divider && item.userId === partner.id);
        if (live) {
            return { workoutId: live.workoutId, userId: partner.id, displayName: partner.displayName };
        }
    }
    if (watchState.workoutId && watchState.workout) {
        const owner = userById(watchState.workout.userId);
        return {
            workoutId: watchState.workoutId,
            userId: watchState.workout.userId,
            displayName: owner?.displayName || "учасника"
        };
    }
    return null;
}

export function isWatching(workoutId) {
    return Boolean(watchState.workoutId) && (!workoutId || watchState.workoutId === workoutId);
}

/**
 * The peer's own previous performance, supplied by the server.
 *
 * The client cannot work this out for itself: peers arrive in the boot payload as
 * summaries with no sets at all, which is why `historyUserId` in the editor is null
 * for anyone but you. Consulted by lastExerciseSets when the workout being rendered
 * is the one being watched.
 */
export function watchedPrevious(workoutItem, exerciseId) {
    if (!workoutItem || workoutItem.id !== watchState.workoutId) {
        return null;
    }
    const entry = watchState.previous?.[exerciseId];
    return entry && entry.sets?.length ? entry : null;
}

export async function openWatch(workoutId) {
    if (!workoutId || storage.mode !== "api") {
        return;
    }
    watchState.workoutId = workoutId;
    watchState.workout = null;
    watchState.previous = {};
    // The sheet opens on a 260ms transform. Dropping a whole workout into it while
    // that is still running — dozens of cards, and iconsIn() swapping every lucide
    // placeholder for a sized SVG — is what made it judder and jump. The sheet itself
    // appears instantly; the heavy content waits for the animation to finish.
    watchState.opening = true;
    clearTimeout(watchState.openTimer);
    watchState.openTimer = setTimeout(() => {
        watchState.opening = false;
        renderWatchBody();
    }, 300);
    renderWatchLayer();
    syncWatchFab();
    await loadWatched(workoutId);
    registerWatch();
}

async function loadWatched(workoutId) {
    if (watchState.loading) {
        return;
    }
    watchState.loading = true;
    try {
        const answer = await storage.apiClient.watchWorkout(workoutId);
        // Guard against a stale response: the viewer may have closed this and opened
        // another session while the request was in flight.
        if (watchState.workoutId !== workoutId) {
            return;
        }
        watchState.workout = answer?.workout || null;
        watchState.previous = answer?.previous || {};
        watchState.error = null;
    } catch (error) {
        if (watchState.workoutId !== workoutId) {
            return;
        }
        watchState.workout = null;
        watchState.error = Number(error?.status) === 403 && error?.payload?.code === "WORKOUT_PRIVATE"
            ? { privateOwnerId: error.payload.ownerId }
            : { message: friendlyError(error) };
    } finally {
        watchState.loading = false;
        renderWatchBody();
    }
}

/**
 * Give up the registration and forget the session.
 *
 * Separate from closing the overlay so closeOverlay can call it without recursing —
 * the sheet lives in the shared drawer, so it can be dismissed by routes that never
 * go through closeWatch: the backdrop, Escape, or another overlay taking its place.
 */
export function releaseWatch() {
    const token = watchState.token;
    const had = Boolean(watchState.workoutId);
    watchState.workoutId = null;
    watchState.workout = null;
    watchState.previous = {};
    watchState.error = null;
    clearTimeout(watchState.timer);
    watchState.timer = null;
    clearTimeout(watchState.openTimer);
    watchState.openTimer = null;
    watchState.opening = false;
    syncWatchFab();
    if (token && had) {
        // Stop the server sending hints to a screen nobody is looking at.
        storage.apiClient.stopWatch(token).catch(() => undefined);
    }
}

export function closeWatch() {
    const wasOpen = Boolean(watchState.workoutId);
    releaseWatch();
    if (wasOpen) {
        closeOverlay();
    }
}

/**
 * Tell the server this connection is watching.
 *
 * The token identifies the CONNECTION, not the account, so a phone and a desktop can
 * watch different sessions and closing one does not tear down the other. Re-asserted
 * on every hello frame, because a reconnect gets a new connection and the old
 * registration died with the old one — without that the panel comes back looking live
 * and never updates again.
 */
export function registerWatch() {
    if (!watchState.workoutId || !watchState.token) {
        return;
    }
    storage.apiClient.registerWatch(watchState.token, watchState.workoutId).catch(() => undefined);
}

// Coalesced, because a save fires per autosave and the server already rate-limits its
// fan-out; this collapses whatever still arrives together into one re-read.
export function scheduleWatchRefresh() {
    if (!watchState.workoutId) {
        return;
    }
    clearTimeout(watchState.timer);
    watchState.timer = setTimeout(() => {
        watchState.timer = null;
        loadWatched(watchState.workoutId);
    }, 400);
}

/** Whether the thing just clicked belongs to the session being watched. */
/** The set behind a control inside the watch sheet. */
export function watchedSet(node) {
    const exercise = (watchState.workout?.exercises || [])
        .find((item) => item.id === node?.dataset?.workoutExerciseId);
    return exercise?.sets.find((item) => item.id === node?.dataset?.setId) || null;
}

export function isWatchedTarget(node) {
    return Boolean(watchState.workoutId) && Boolean(node?.closest?.("#watchBody"));
}

function canEditWatched() {
    const link = partnerState.partnership;
    return Boolean(
        link
        && link.status === "active"
        && link.iCanEditTheirs
        && watchState.workout
        && link.partner?.id === watchState.workout.userId
    );
}

/**
 * Change one set of the session being watched.
 *
 * Through the NARROW route, never the full save: that one deletes the workout's whole
 * tree and recreates it from the payload, and with status "active" also closes every
 * other session its owner has open — so pointing it at somebody else's workout would
 * be handing over "erase this person's session", not "tick their set".
 *
 * Painted optimistically and then re-read, because the person doing this is standing
 * next to the barbell and a round trip is not a thing they should watch.
 */
export async function editWatchedSet(workoutExerciseId, setId, patch) {
    const exercise = (watchState.workout?.exercises || []).find((item) => item.id === workoutExerciseId);
    const set = exercise?.sets.find((item) => item.id === setId);
    if (!set) {
        return;
    }
    const before = { ...set };
    Object.assign(set, patch);
    renderWatchBody();
    try {
        await storage.apiClient.updatePartnerSet(watchState.workoutId, workoutExerciseId, setId, patch);
    } catch (error) {
        Object.assign(set, before);
        renderWatchBody();
        toast("Не вдалося змінити", friendlyError(error), "error");
    }
}

// ---- The layer ----------------------------------------------------------------------

/**
 * Opened through the app's OWN overlay system, not a layer of its own.
 *
 * The hand-rolled version showed the page through it and let the background scroll
 * behind it — which is exactly what lockBackgroundScroll and the drawer's overscroll
 * containment already solve here, along with the safe-area treatment on a phone and
 * dismissing on the backdrop.
 */
function renderWatchLayer() {
    const owner = watchState.workout ? userById(watchState.workout.userId) : null;
    openDrawer(`<div class="watch-head">
                <span class="watch-live" aria-hidden="true"></span>
                <div class="watch-who">
                    <strong>${escapeHtml(owner ? owner.displayName : "Тренування")}</strong>
                    <span class="card-caption">наживо · лише перегляд</span>
                </div>
                <button class="icon-button" type="button" data-action="close-watch" aria-label="Закрити"><i data-lucide="x"></i></button>
            </div>
            <div class="watch-body" id="watchBody">${watchBodyMarkup()}</div>`, { fullscreen: true });
    syncWatchFab();
}

/**
 * Repaint only the body.
 *
 * The body is the scroller, so re-rendering the whole layer on every hint would send
 * the viewer back to the top and recreate every exercise thumbnail — once per set the
 * person they are watching ticks.
 */
function renderWatchBody() {
    const host = document.getElementById("watchBody");
    if (!host) {
        return;
    }
    // Still animating in. The deferred pass draws it once the transform has settled;
    // inserting a whole workout mid-transition is what made the sheet judder.
    if (watchState.opening) {
        return;
    }
    const anchor = host.scrollTop;
    host.innerHTML = watchBodyMarkup();
    iconsIn(host);
    host.scrollTop = anchor;
}

function watchBodyMarkup() {
    if (watchState.error?.privateOwnerId) {
        return privateWorkoutPanel(watchState.error.privateOwnerId);
    }
    if (watchState.error) {
        return emptyInline("Не вдалося відкрити", watchState.error.message);
    }
    if (!watchState.workout) {
        return emptyInline("Завантажуємо", "Підтягуємо тренування.");
    }
    const owner = userById(watchState.workout.userId);
    const name = owner ? owner.displayName : "учасника";
    // Said inside the scroller, not only in the header, because the header scrolls
    // out of sight and the screen below it is pixel-for-pixel your own workout
    // screen. Confusing the two is the failure mode worth spending a banner on.
    const editable = canEditWatched();
    const banner = `<div class="watch-banner${editable ? " can-edit" : ""}">
            <i data-lucide="${editable ? "pencil" : "eye"}"></i>
            <span>Це тренування <strong>${escapeHtml(name)}</strong> · ${editable ? "ти можеш редагувати" : "лише перегляд"}</span>
        </div>`;
    // The workout screen's own renderer, in the read-only mode it already supports:
    // same cards, same set rows, same «Минулого разу» — just nothing to press.
    return `${banner}<div class="workout-stack is-watched">${workoutEditor(watchState.workout, { forceReadonly: !canEditWatched() })}</div>`;
}
