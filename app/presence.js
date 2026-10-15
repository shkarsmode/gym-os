// Presence (who is training now) and cheering.
import { escapeHtml, imageUrl } from "../lib/format.js";
import { gymClockState, formatClock } from "../lib/gym-clock.js";
import { storage } from "./data.js";
import { userById } from "./model.js";
import { element, friendlyError, toast } from "./overlays.js";
import { partnerInviteButton } from "./partner.js";
import { accessTo } from "./privacy.js";
import { framedAvatar } from "./progression.js";
import { state } from "./state.js";
import { iconsIn } from "./util.js";
import { syncWatchFab } from "./watch.js";

// ---- Presence and cheering ---------------------------------------------------------
//
// The feed shows a session once it is FINISHED, which is exactly too late to encourage
// anybody. This is the surface that says who is in the gym right now — and without it
// there would be nothing to tap a 💪 on.
export const liveState = { presence: [], loadedAt: 0, loading: false, sentEmoji: new Map(), seenCheers: new Set(), pickerFor: null, pickerTimer: null };

// Mirrors CHEER_EMOJI on the server, which validates every one of these. Sending
// anything else is a 400, so the two lists must not drift.
const CHEER_CHOICES = ["💪", "🔥", "👏", "🚀", "🤘", "❤️"];

// What to show instead of a clock for somebody who has not started yet.
const PRESENCE_WORDS = { warmup: "розминається", planned: "збирається" };

const PRESENCE_TTL_MS = 60000;

function presenceIsStale() {
    return Date.now() - liveState.loadedAt > PRESENCE_TTL_MS;
}

export async function loadPresence(force = false) {
    if (liveState.loading || storage.mode !== "api" || !storage.apiClient.hasBaseUrl()) {
        return;
    }
    if (!force && !presenceIsStale()) {
        return;
    }
    liveState.loading = true;
    try {
        const result = await storage.apiClient.fetchPresence();
        const rows = Array.isArray(result?.training) ? result.training : [];
        // Same reason the feed guards its repaint: rebuilding the strip recreates
        // every avatar, and these refresh on a timer as well as on every team hint.
        // The clock is excluded from the signature on purpose — it ticks in place.
        const signature = (list) => list.map((item) => `${item.workoutId}:${item.state}`).join("|");
        const moved = signature(rows) !== signature(liveState.presence);
        liveState.presence = rows;
        liveState.loadedAt = Date.now();
        if (moved) {
            renderPresenceStrip();
        }
    } catch (error) {
        // Presence is decoration; a failure must never take a section down with it.
    } finally {
        liveState.loading = false;
    }
}

/**
 * Everyone else who is training, with the people you follow first.
 *
 * "Follow" here means an accepted access grant — you asked to see their training and
 * they said yes. Those are the people whose sessions you actually care about, so they
 * lead, and the rest come after a divider rather than being mixed in.
 */
function presenceOthers() {
    const me = state.database.currentUserId;
    const others = liveState.presence.filter((item) => item.userId !== me);
    const followed = others.filter((item) => accessTo(item.userId) === "accepted");
    if (!followed.length || followed.length === others.length) {
        return others;
    }
    const rest = others.filter((item) => accessTo(item.userId) !== "accepted");
    return [...followed, { divider: true }, ...rest];
}

function presenceStripMarkup() {
    const others = presenceOthers();
    if (!others.length) {
        return "";
    }
    return `<section class="card span-12 presence-card">
            <div class="presence-head">
                <span class="presence-dot" aria-hidden="true"></span>
                <h3>Зараз тренуються</h3>
            </div>
            <div class="presence-row">${others.map((item) => item.divider
            ? `<span class="presence-divider" aria-hidden="true"></span>`
            : presenceItemMarkup(item)).join("")}</div>
        </section>`;
}

function presenceItemMarkup(item) {
    // The same level frame the profile and the leaderboard draw, not a flat accent
    // ring: the frame IS someone's identity in this app, and a plain circle here made
    // the one place you see people live the only place they all look alike.
    const user = userById(item.userId);
    const face = user
        ? framedAvatar(user, "small")
        : `<span class="presence-initial">${escapeHtml((item.displayName || "?").slice(0, 1).toUpperCase())}</span>`;
    // A clock only for somebody who has actually started: the other two states have
    // no elapsed time to show, and a running timer next to them would be a number the
    // app invented. They get a word instead.
    const clock = item.state === "training" && item.firstSetAt
        ? gymClockState({ firstSetAt: item.firstSetAt, status: "active", exercises: [] })
        : null;
    const elapsed = clock && !clock.overflow ? formatClock(clock.ms) : PRESENCE_WORDS[item.state] || "";
    const sent = liveState.sentEmoji.get(item.workoutId);
    const open = liveState.pickerFor === item.workoutId;
    return `<div class="presence-person${open ? " is-picking" : ""}${item.partner ? " is-paired" : ""}" data-presence="${escapeHtml(item.workoutId)}">
            <button class="presence-face" type="button" data-action="open-user" data-user-id="${escapeHtml(item.userId)}" aria-label="${escapeHtml(item.displayName)}">${face}</button>
            <span class="presence-name">${escapeHtml(firstName(item.displayName))}</span>
            ${item.partner ? `<span class="presence-pair" title="Тренується разом з ${escapeHtml(item.partner.displayName)}"><i data-lucide="link-2"></i>${escapeHtml(firstName(item.partner.displayName))}</span>` : ""}
            ${clock
            ? `<button class="presence-clock is-watchable" type="button" data-action="watch-workout" data-workout-id="${escapeHtml(item.workoutId)}" data-presence-clock="${escapeHtml(item.workoutId)}" title="Подивитися тренування ${escapeHtml(item.displayName)}">${escapeHtml(elapsed)}</button>`
            : `<span class="presence-clock is-word">${escapeHtml(elapsed)}</span>`}
            <span class="presence-actions">${partnerInviteButton(item)}<button class="presence-cheer${sent ? " is-sent" : ""}" type="button" data-action="cheer" data-workout-id="${escapeHtml(item.workoutId)}" aria-label="Підбадьорити ${escapeHtml(item.displayName)}">${escapeHtml(sent || "💪")}</button></span>
        </div>`;
}

/**
 * The other emoji, drawn UNDER the strip rather than as a popover on the person.
 *
 * `.presence-row` scrolls sideways, and a box with `overflow-x: auto` clips its
 * vertical overflow too — there is no way to have one axis scroll and the other spill
 * out. A popover anchored to an avatar would simply be cut off, worst of all on the
 * last person in the row.
 */
function cheerPickerMarkup(target) {
    return `<div class="cheer-picker" data-workout-id="${escapeHtml(target.workoutId)}">
            <span class="cheer-picker-label">Надіслати ${escapeHtml(firstName(target.displayName))}:</span>
            <div class="cheer-picker-row">${CHEER_CHOICES.map((emoji) => `<button class="cheer-choice" type="button" data-action="cheer-pick" data-workout-id="${escapeHtml(target.workoutId)}" data-emoji="${escapeHtml(emoji)}" aria-label="Надіслати ${escapeHtml(emoji)}">${escapeHtml(emoji)}</button>`).join("")}</div>
        </div>`;
}

export function firstName(displayName) {
    return String(displayName || "").trim().split(/\s+/)[0] || "—";
}

export function renderPresenceStrip() {
    const host = element("presenceStrip");
    if (!host) {
        return;
    }
    // Never on the workout screen. That screen is YOUR session plus, if you are in
    // one, the partner panel — a list of everybody else in the gym belongs on the
    // feed and the dashboard, and here it just pushed the workout down the phone.
    // Decided HERE rather than only where the screen is built: presence refreshes on
    // a timer and on every team hint, and those repaints were filling the strip back
    // in after the screen had deliberately left it out.
    if (state.section === "workout") {
        host.innerHTML = "";
        return;
    }
    host.innerHTML = presenceStripMarkup();
    iconsIn(host);
    syncPresenceClocks();
    syncCheerPicker();
    syncWatchFab();
}

/**
 * Add, move or remove the emoji panel without ever rebuilding one that is already
 * open on the right person.
 *
 * The panel used to be part of the strip's markup, so every repaint of the strip
 * destroyed and recreated it — replaying its entrance animation and, worse, deleting
 * the button under the user's finger mid-tap. Presence repaints for reasons that have
 * nothing to do with the panel (a refresh every minute, somebody starting a session),
 * which is why this is a targeted update rather than part of the render.
 */
function syncCheerPicker() {
    const card = element("presenceStrip")?.querySelector(".presence-card");
    const existing = card?.querySelector(".cheer-picker");
    const target = presenceOthers().find((item) => !item.divider && item.workoutId === liveState.pickerFor);
    if (!target || !card) {
        existing?.remove();
        return;
    }
    if (existing && existing.dataset.workoutId === target.workoutId) {
        // Already showing for this person — leave the live node completely alone.
        return;
    }
    existing?.remove();
    card.insertAdjacentHTML("beforeend", cheerPickerMarkup(target));
}

// The presence clocks tick without redrawing the strip: a full repaint every second
// would swap every avatar element and make them blink.
let presenceClockTimer = null;

function syncPresenceClocks() {
    clearInterval(presenceClockTimer);
    presenceClockTimer = null;
    const tick = () => {
        const nodes = document.querySelectorAll("[data-presence-clock]");
        if (!nodes.length) {
            clearInterval(presenceClockTimer);
            presenceClockTimer = null;
            return;
        }
        nodes.forEach((node) => {
            const item = liveState.presence.find((row) => row.workoutId === node.dataset.presenceClock);
            if (!item || !item.firstSetAt) {
                return;
            }
            const clock = gymClockState({ firstSetAt: item.firstSetAt, status: "active", exercises: [] });
            node.textContent = clock && !clock.overflow ? formatClock(clock.ms) : "";
        });
    };
    if (document.querySelector("[data-presence-clock]")) {
        presenceClockTimer = setInterval(tick, 1000);
        tick();
    }
}

// Tapping opens the choices; nothing is sent until one is picked. Sending on the
// first tap meant choosing anything else was always a second, redundant cheer.
export function cheerTapped(workoutId) {
    if (liveState.pickerFor === workoutId) {
        closeCheerPicker();
        return;
    }
    openCheerPicker(workoutId);
}

function openCheerPicker(workoutId) {
    liveState.pickerFor = workoutId;
    clearTimeout(liveState.pickerTimer);
    // Stays open long enough to send several — the picker closing under your finger
    // after one tap is what makes a single emoji feel like the only option.
    liveState.pickerTimer = setTimeout(closeCheerPicker, 12000);
    syncCheerPicker();
}

function closeCheerPicker() {
    clearTimeout(liveState.pickerTimer);
    liveState.pickerTimer = null;
    liveState.pickerFor = null;
    syncCheerPicker();
}

export async function sendCheer(workoutId, emoji) {
    const chosen = CHEER_CHOICES.includes(emoji) ? emoji : "💪";
    // The emoji flies across the RECIPIENT's screen — which is the point, and also
    // means the sender sees nothing at all unless it is shown here too. Burst it out
    // of the chosen emoji so a tap visibly does something on the screen being tapped.
    burstFromChoice(workoutId, chosen);
    liveState.sentEmoji.set(workoutId, chosen);
    // Keep the picker open and re-arm its timer: several in a row is the intended way
    // to use this, and a picker that closed after one would forbid it.
    if (liveState.pickerFor === workoutId) {
        clearTimeout(liveState.pickerTimer);
        liveState.pickerTimer = setTimeout(closeCheerPicker, 12000);
    }
    try {
        await storage.apiClient.sendCheer({ workoutId, emoji: chosen });
    } catch (error) {
        liveState.sentEmoji.delete(workoutId);
        toast("Не вдалося підбадьорити", friendlyError(error), "error");
    }
}

// A handful of copies of the emoji lifting off the button and fading. Anchored to the
// button's real position so it reads as coming OUT of the thing that was pressed.
function burstFromChoice(workoutId, emoji) {
    const button = document.querySelector(`.cheer-choice[data-workout-id="${CSS.escape(workoutId)}"][data-emoji="${CSS.escape(emoji)}"]`)
        || document.querySelector(`.presence-cheer[data-workout-id="${CSS.escape(workoutId)}"]`);
    if (!button) {
        return;
    }
    const box = button.getBoundingClientRect();
    const layer = cheerLayer();
    for (let index = 0; index < 5; index += 1) {
        const node = document.createElement("span");
        node.className = "cheer-pop";
        node.textContent = emoji;
        node.style.left = `${box.left + box.width / 2}px`;
        node.style.top = `${box.top}px`;
        node.style.setProperty("--pop-x", `${Math.round(-40 + Math.random() * 80)}px`);
        node.style.setProperty("--pop-delay", `${index * 45}ms`);
        layer.appendChild(node);
        const drop = () => node.remove();
        node.addEventListener("animationend", drop, { once: true });
        setTimeout(drop, 1600);
    }
}

// ---- The flying emoji ---------------------------------------------------------------
//
// Deliberately not a toast. A cheer is not information to be read and dismissed; it is
// meant to land while you are between sets and looking at nothing in particular, so it
// comes in from the edges, crosses the screen and leaves.
export function flyCheer(emoji, actor) {
    const layer = cheerLayer();
    if (!layer) {
        return;
    }
    const node = document.createElement("span");
    node.className = "cheer-fly";
    node.textContent = emoji || "💪";
    // Each one enters from a random edge, so a burst reads as a crowd rather than a
    // queue. Custom properties feed a single CSS animation.
    const fromLeft = Math.random() < 0.5;
    node.style.setProperty("--cheer-x", `${fromLeft ? -12 : 112}vw`);
    node.style.setProperty("--cheer-y", `${15 + Math.random() * 60}vh`);
    node.style.setProperty("--cheer-x-end", `${fromLeft ? 20 + Math.random() * 60 : 80 - Math.random() * 60}vw`);
    node.style.setProperty("--cheer-y-end", `${10 + Math.random() * 40}vh`);
    node.style.setProperty("--cheer-rot", `${Math.round(-40 + Math.random() * 80)}deg`);
    layer.appendChild(node);
    // Remove on animationend, with a timer as the backstop: animations do not fire
    // their end event in a backgrounded tab, and without this the nodes accumulate.
    const drop = () => node.remove();
    node.addEventListener("animationend", drop, { once: true });
    setTimeout(drop, 4000);
    if (actor && actor.displayName) {
        showCheerName(layer, actor);
    }
}

// Who it was, with their face: a name on its own is weak at a glance, and the point
// of a cheer is knowing which of your people just sent it.
function showCheerName(layer, actor) {
    let banner = layer.querySelector(".cheer-name");
    if (!banner) {
        banner = document.createElement("div");
        banner.className = "cheer-name";
        layer.appendChild(banner);
    }
    const avatar = imageUrl(actor.avatarUrl);
    banner.innerHTML = `${avatar
        ? `<img class="cheer-name-face" src="${escapeHtml(avatar)}" alt="" referrerpolicy="no-referrer" loading="eager" decoding="sync">`
        : `<span class="cheer-name-face cheer-name-initial">${escapeHtml((actor.displayName || "?").slice(0, 1).toUpperCase())}</span>`}
            <span>${escapeHtml(actor.displayName)} підбадьорює</span>`;
    banner.classList.remove("is-out");
    clearTimeout(Number(banner.dataset.timer));
    banner.dataset.timer = String(setTimeout(() => banner.classList.add("is-out"), 3200));
}

function cheerLayer() {
    let layer = document.getElementById("cheerLayer");
    if (!layer) {
        layer = document.createElement("div");
        layer.id = "cheerLayer";
        layer.className = "cheer-layer";
        layer.setAttribute("aria-hidden", "true");
        document.body.appendChild(layer);
    }
    return layer;
}

function cheerSeenKey() {
    return `gymos-cheers-shown-${state.database.currentUserId || "anon"}`;
}

// How far back a cheer is still worth showing on opening the app. Long enough to
// cover a session and the trip home; short enough that a device signing in for the
// first time does not replay months of history at once.
const CHEER_REPLAY_WINDOW_MS = 12 * 60 * 60 * 1000;

const CHEER_SEEN_CAP = 200;

/**
 * Which cheers this device has already animated.
 *
 * IDS, not a timestamp. The timestamp version had a fatal flaw for the exact case
 * this exists to serve: it was seeded to "now" on first read, so everything that
 * arrived while the app was closed was immediately older than the watermark and
 * silently discarded — which is to say, the feature worked only for cheers you were
 * already looking at.
 */
function cheerSeenIds() {
    try {
        const raw = JSON.parse(localStorage.getItem(cheerSeenKey()) || "[]");
        return new Set(Array.isArray(raw) ? raw : []);
    } catch (error) {
        return new Set();
    }
}

function rememberCheerIds(ids) {
    try {
        const kept = [...cheerSeenIds(), ...ids].slice(-CHEER_SEEN_CAP);
        localStorage.setItem(cheerSeenKey(), JSON.stringify(kept));
    } catch (error) {
        // Private mode / full storage: the worst case is showing a cheer twice.
    }
}

/**
 * Cheers that landed while nobody was looking.
 *
 * The live event is fired once and lost if the tab was closed or the screen was off —
 * which is the common case, because between sets the phone is face-down on a bench.
 * The server keeps them, so they are collected on returning and played then.
 */
/**
 * Re-read everyone else's recent sessions and merge them in.
 *
 * Peers live in the same `state.database.workouts` array as your own rows but in a
 * different shape — summaries with aggregates and NO `exercises` key — so they are
 * replaced wholesale rather than merged field by field: assigning onto an existing
 * row could leave a stale `exercises` array behind and make a summary look hydrated.
 */
export async function refreshPeerWorkouts() {
    if (storage.mode !== "api" || !storage.apiClient.hasBaseUrl()) {
        return false;
    }
    let result = null;
    try {
        result = await storage.apiClient.fetchPeerWorkouts();
    } catch (error) {
        return false;
    }
    const rows = Array.isArray(result?.workouts) ? result.workouts : [];
    if (!rows.length) {
        return false;
    }
    const me = state.database.currentUserId;
    const incoming = new Map(rows.map((row) => [row.id, row]));
    // Did anything actually move? A hint fires for a session opening or closing, and
    // most of the time the row the viewer already holds is identical — repainting on
    // it is a flash of every avatar on screen in exchange for no change at all.
    const held = new Map(state.database.workouts.filter((row) => row.userId !== me).map((row) => [row.id, row]));
    const moved = rows.length !== held.size
        || rows.some((row) => {
            const previous = held.get(row.id);
            return !previous
                || previous.status !== row.status
                || previous.updatedAt !== row.updatedAt
                || Boolean(previous.private) !== Boolean(row.private);
        });
    if (!moved) {
        return false;
    }
    // Keep every row of mine untouched, plus any peer row the window no longer covers.
    const kept = state.database.workouts.filter((row) => row.userId === me || !incoming.has(row.id));
    state.database.workouts = [...kept, ...rows.filter((row) => row.userId !== me)];
    return true;
}

export async function replayMissedCheers() {
    if (storage.mode !== "api" || !storage.apiClient.hasBaseUrl()) {
        return;
    }
    // Not just the running session. A cheer sent in the last minutes of a workout
    // most often arrives after it was finished and the phone picked back up, and
    // looking only at an active session would silently drop exactly those.
    const me = state.database.currentUserId;
    const recent = state.database.workouts
        .filter((item) => item.userId === me && (item.status === "active" || item.status === "completed"))
        .sort((left, right) => String(right.date).localeCompare(String(left.date)))
        .slice(0, 3);
    if (!recent.length) {
        return;
    }
    const results = await Promise.all(recent.map((item) =>
        storage.apiClient.fetchCheers(item.id).catch(() => null)
    ));
    const result = { cheers: results.filter(Boolean).flatMap((item) => item.cheers || []) };
    // Survives a reload, because the server keeps every cheer a session ever received
    // and an in-memory set would replay the lot on every open.
    const seen = cheerSeenIds();
    const cutoff = Date.now() - CHEER_REPLAY_WINDOW_MS;
    const all = result.cheers || [];
    const fresh = all.filter((cheer) => {
        if (seen.has(cheer.id) || liveState.seenCheers.has(cheer.id)) {
            return false;
        }
        const at = new Date(cheer.at).getTime();
        return Number.isFinite(at) && at >= cutoff;
    });
    // Everything looked at is remembered, including what was too old to show, so a
    // stale cheer is not reconsidered on every single open.
    for (const cheer of all) {
        liveState.seenCheers.add(cheer.id);
    }
    rememberCheerIds(all.map((cheer) => cheer.id));
    if (!fresh.length) {
        return;
    }
    // Stagger so a backlog arrives as a shower rather than all in one frame.
    fresh.slice(0, 12).forEach((cheer, index) => {
        setTimeout(() => flyCheer(cheer.emoji, cheer.actor), index * 220);
    });
}
