// The live stream (SSE) and team refresh.
import { serverVersionOf, parseSseFrames, backoffDelay, shouldApplyRemote } from "../lib/realtime.js";
import { adoptRenewedSession, storage, storedAuthToken } from "./data.js";
import { feedState, invalidateFeed, loadFeed } from "./feed.js";
import { dropRevokedDetail } from "./onboarding.js";
import { toast } from "./overlays.js";
import { loadPartnerState, refreshPartnerWorkout } from "./partner.js";
import { cancelWorkoutSave, workoutSavers } from "./persistence.js";
import { flyCheer, loadPresence, refreshPeerWorkouts, replayMissedCheers } from "./presence.js";
import { loadAccessState } from "./privacy.js";
import { renderSection } from "./shell.js";
import { state } from "./state.js";
import { closeWatch, isWatching, registerWatch, scheduleWatchRefresh, watchState } from "./watch.js";

// ---- Live stream -----------------------------------------------------------------
//
// A single server-sent-events connection carrying HINTS — "these workouts changed,
// here is the version" — never content. Acting on a hint means re-reading through the
// normal authorized route, so the stream can never show anything a plain refresh
// would not, and losing it degrades to exactly the previous behaviour.
//
// Read with fetch() rather than EventSource because EventSource cannot set an
// Authorization header, and the bearer token is this app's primary credential (the
// cookie is a fallback that iOS Safari drops on a cross-origin API). The alternative,
// a token in the query string, would be written into every proxy log on the way.
const liveStream = { controller: null, attempt: 0, timer: null, running: false };

function liveStreamSupported() {
    return storage.mode === "api"
        && storage.apiClient.hasBaseUrl()
        && Boolean(storedAuthToken())
        && typeof AbortController === "function"
        && typeof TextDecoder === "function";
}

export function stopLiveStream() {
    liveStream.running = false;
    clearTimeout(liveStream.timer);
    liveStream.timer = null;
    if (liveStream.controller) {
        liveStream.controller.abort();
        liveStream.controller = null;
    }
}

function scheduleLiveStream() {
    if (!liveStream.running) {
        return;
    }
    clearTimeout(liveStream.timer);
    liveStream.attempt += 1;
    liveStream.timer = setTimeout(runLiveStream, backoffDelay(liveStream.attempt));
}

export function startLiveStream() {
    if (liveStream.running || !liveStreamSupported()) {
        return;
    }
    liveStream.running = true;
    liveStream.attempt = 0;
    runLiveStream();
}

async function runLiveStream() {
    if (!liveStream.running || !liveStreamSupported()) {
        return;
    }
    const controller = new AbortController();
    liveStream.controller = controller;
    try {
        const response = await fetch(storage.apiClient.baseUrl + "/live/stream", {
            credentials: "include",
            headers: { Accept: "text/event-stream", Authorization: "Bearer " + storedAuthToken() },
            signal: controller.signal
        });
        if (!response.ok || !response.body) {
            // 401 means this token is finished; retrying cannot fix it and would just
            // hammer the API until the tab is closed.
            if (response.status === 401 || response.status === 403) {
                stopLiveStream();
                return;
            }
            throw new Error("live stream " + response.status);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
            const { value, done } = await reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });
            const parsed = parseSseFrames(buffer);
            buffer = parsed.rest;
            for (const frame of parsed.events) {
                // Reaching a real frame proves the connection works end to end, so
                // the next drop starts its backoff from scratch.
                liveStream.attempt = 0;
                if (frame.name === "hello") {
                    // Identifies THIS connection. A reconnect gets a new one, and the
                    // old watch registration died with the old connection — so it has
                    // to be re-asserted or the panel comes back looking live and never
                    // updates again.
                    watchState.token = frame.data?.token || null;
                    registerWatch();
                }
                if (frame.name === "hello" && liveStream.reconnected) {
                    // The connection had dropped; anything sent during that window
                    // was delivered to nobody. Go and collect it.
                    liveStream.reconnected = false;
                    replayMissedCheers();
                }
                await handleLiveEvent(frame);
            }
        }
    } catch (error) {
        // AbortError is this code closing the stream on purpose.
        if (error && error.name !== "AbortError") {
            console.debug("live stream dropped", error);
        }
    }
    if (liveStream.controller === controller) {
        liveStream.controller = null;
    }
    // The next "hello" is a RECONNECT, not a first connection — so whatever arrived
    // while this device was unreachable gets collected when it comes back.
    liveStream.reconnected = true;
    scheduleLiveStream();
}

async function handleLiveEvent(frame) {
    const payload = (frame && frame.data) || {};
    if (frame.name === "workout.deleted") {
        for (const workoutId of (payload.ids || [])) {
            applyRemoteWorkoutDeletion(workoutId);
        }
        repaintSection();
        return;
    }
    if (frame.name === "team.changed") {
        // Somebody else's session opened, closed or appeared. A hint like everything
        // else here: go and re-read the surfaces that show other people — but
        // COALESCED. Several of these arrive together (a save that closes another
        // session announces both), and acting on each one separately repainted the
        // screen once per event.
        scheduleTeamRefresh(payload.touches);
        return;
    }
    if (frame.name === "workout.watch") {
        scheduleWatchRefresh();
        return;
    }
    if (frame.name === "workout.deleted" && isWatching(payload.ids?.[0])) {
        closeWatch();
        toast("Тренування видалено", "Сесія, яку ти дивився, більше не існує");
        return;
    }
    if (frame.name === "partner.changed") {
        loadPartnerState().then(renderSection);
        return;
    }
    if (frame.name === "partner.workout") {
        // Their session moved. The sets are re-read through the normal authorized
        // route — this only said that something changed.
        refreshPartnerWorkout();
        return;
    }
    if (frame.name === "access.changed") {
        loadAccessState().then(renderSection);
        return;
    }
    if (frame.name === "access.revoked") {
        // Access this device HELD was withdrawn. A refresh is not enough: the detail
        // is already in memory and in the local cache, so it has to be dropped before
        // anything renders again.
        dropRevokedDetail();
        return;
    }
    if (frame.name === "cheer") {
        const cheer = payload.cheer || {};
        flyCheer(cheer.emoji, cheer.actor);
        return;
    }
    if (frame.name !== "workout.changed") {
        return;
    }
    let changed = false;
    for (const workoutId of (payload.ids || [])) {
        if (await applyRemoteWorkoutChange(workoutId, payload.version)) {
            changed = true;
        }
    }
    if (changed) {
        repaintSection();
    }
}

// Coalesce a burst of team hints into one refresh, and never repaint for a hint that
// turns out to change nothing on screen.
let teamRefreshTimer = null;

// What the coalesced events between now and the refresh actually touch. An event with
// no `touches` came from an older server and is treated as touching everything.
const NOTHING_TOUCHED = { presence: false, feed: false, peers: false };

let teamRefreshTouches = { ...NOTHING_TOUCHED };

function scheduleTeamRefresh(touches) {
    // A hint with no `touches` came from a server older than this field. Treat it as
    // touching everything rather than silently refreshing nothing.
    const wanted = touches && typeof touches === "object"
        ? touches
        : { presence: true, feed: true, peers: true };
    teamRefreshTouches = {
        presence: teamRefreshTouches.presence || Boolean(wanted.presence),
        feed: teamRefreshTouches.feed || Boolean(wanted.feed),
        peers: teamRefreshTouches.peers || Boolean(wanted.peers)
    };
    clearTimeout(teamRefreshTimer);
    teamRefreshTimer = setTimeout(runTeamRefresh, 400);
}

async function runTeamRefresh() {
    teamRefreshTimer = null;
    const touches = teamRefreshTouches;
    teamRefreshTouches = { ...NOTHING_TOUCHED };

    if (touches.presence) {
        await loadPresence(true);
    }
    if (!touches.peers && !touches.feed) {
        // Somebody is warming up: that moves the presence strip and nothing else.
        return;
    }
    // The calendar and day sheet hold PLANNED and ACTIVE sessions, so they move for
    // changes the feed will never mention.
    const moved = touches.peers ? await refreshPeerWorkouts() : false;
    if (touches.feed) {
        invalidateFeed();
        if (state.section === "feed") {
            loadFeed(feedState.scope, false);
            return;
        }
    }
    if (moved && sectionShowsPeers()) {
        repaintSection();
    }
}

// Which screens actually render other people's sessions. Repainting anything else
// because a teammate finished a workout is pure flicker: nothing on it would change.
function sectionShowsPeers() {
    return ["dashboard", "calendar", "rankings", "levels", "users", "user"].includes(state.section);
}

/**
 * Repaint the current section without the avatar flash.
 *
 * renderSection() replaces the whole section's innerHTML, which recreates every
 * <img> in it — and a recreated <img> repaints from scratch even when the browser
 * has the bytes cached. That is visible as a blink on any screen full of faces,
 * which is exactly the screens a team update touches. So a repaint driven by
 * somebody ELSE's activity is deferred to an idle moment and skipped entirely while
 * the user is interacting.
 */
function repaintSection() {
    if (document.visibilityState !== "visible") {
        return;
    }
    // An open dialog owns the screen; rebuilding underneath it is both pointless and
    // a good way to lose whatever is half-typed in it. The watch sheet counts too —
    // it is a fixed layer of its own rather than part of the drawer stack, so the
    // check above is blind to it.
    if (document.querySelector(".modal-layer, .drawer-layer")?.childElementCount) {
        return;
    }
    if (watchState.workoutId) {
        return;
    }
    renderSection();
}

function workoutSaverBusy(workoutId) {
    const saver = workoutSavers.get(workoutId);
    return Boolean(saver && (saver.running || saver.timer || saver.dirty));
}

async function applyRemoteWorkoutChange(workoutId, version) {
    const held = state.database.workouts.find((item) => item.id === workoutId);
    if (!shouldApplyRemote({ version, held: (held && held.serverVersion) || null, busy: workoutSaverBusy(workoutId) })) {
        return false;
    }
    let fresh = null;
    try {
        fresh = await storage.apiClient.fetchWorkout(workoutId);
    } catch (error) {
        return false;
    }
    if (!fresh || !Array.isArray(fresh.exercises)) {
        return false;
    }
    // Re-check after the await: the fetch can easily outlive the conditions that
    // allowed it. The user can have started editing this very workout while it was in
    // flight, in which case adopting the answer would wipe what they just typed.
    if (workoutSaverBusy(workoutId)) {
        return false;
    }
    const target = state.database.workouts.find((item) => item.id === workoutId);
    if (!target) {
        // A workout created on another device. Nothing local to protect.
        fresh.serverVersion = serverVersionOf(fresh);
        state.database.workouts.push(fresh);
        return true;
    }
    if (!shouldApplyRemote({ version: serverVersionOf(fresh), held: target.serverVersion || null, busy: false })) {
        return false;
    }
    const localTouchedAt = target.updatedAt;
    Object.assign(target, fresh);
    target.serverVersion = serverVersionOf(fresh);
    target.updatedAt = localTouchedAt || target.updatedAt;
    // A refused detail read is remembered; a row that just arrived is proof it is
    // readable again, so the flag must not survive.
    delete target.detailUnavailable;
    return true;
}

function applyRemoteWorkoutDeletion(workoutId) {
    // Cancel BEFORE removing: a pending save still holding this workout would
    // recreate it on the server, because saving upserts on the client-supplied id.
    cancelWorkoutSave(workoutId);
    const index = state.database.workouts.findIndex((item) => item.id === workoutId);
    if (index !== -1) {
        state.database.workouts.splice(index, 1);
    }
}

// A phone's app switcher or a desktop tab left open for weeks brings the app back
// without a fresh start, and the start is where the session slides forward. So coming
// back asks as well — at most every 6 hours (the server renews once a token is a day
// old anyway). Only the token is taken from the answer: who the user is was settled
// at boot and is not re-decided on a resume.
let lastSessionRenewalCheck = Date.now();

export function renewSessionOnResume() {
    if (storage.mode !== "api" || !storage.currentUser || storage.impersonation) {
        return;
    }
    if (Date.now() - lastSessionRenewalCheck < 6 * 60 * 60 * 1000) {
        return;
    }
    lastSessionRenewalCheck = Date.now();
    const sentToken = storedAuthToken();
    if (!sentToken) {
        return;
    }
    storage.apiClient.me().then((response) => adoptRenewedSession(sentToken, response?.token)).catch(() => undefined);
}
