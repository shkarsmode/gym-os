// App shell: navigation, auth gates, sticky offsets, scroll anchoring, screen wake lock, renderSection().
import { escapeHtml, number, imageUrl } from "../lib/format.js";
import { sectionItems } from "../lib/constants.js";
import { infoTip, renderImpersonationBar } from "./account-admin.js";
import { aiStats } from "./ai-stats.js";
import { databaseProblem } from "./boot.js";
import { calendar } from "./calendar.js";
import { exercises } from "./catalog.js";
import { adminPanel, moderation, pendingExercises, userDetail } from "./components.js";
import { storage } from "./data.js";
import { feed, feedState, notifications, postSection } from "./feed.js";
import { feedback, newFeedbackCount } from "./feedback.js";
import { syncGymClockTicker } from "./gym-clock-ui.js";
import {
    activeWorkoutFor, backendStatusLabel, canManage, currentUser, editWorkout, hasUnlimited, isAdmin, userById
} from "./model.js";
import { element, toast } from "./overlays.js";
import { getPref } from "./prefs.js";
import { XP_HOWTO, frameTierFor, framedAvatar, levelBadge, userLevel } from "./progression.js";
import { defaultSection, handleRoute } from "./router.js";
import { userStats } from "./scoring-bridge.js";
import { levels, profile, rankings, stats, users } from "./screens.js";
import { SIDEBAR_GROUPS } from "./seed.js";
import { changelog, roleStatusBadge, settings, subscription } from "./settings.js";
import { state } from "./state.js";
import { dashboard } from "./today.js";
import { topbarHeight, updateLastResultsFocus, updateTopbarContext, updateTopbarOffset } from "./ui-helpers.js";
import { icons, iconsIn } from "./util.js";
import { destroyCharts } from "./workout-history.js";
import { workout } from "./workout-screen.js";

function sectionVisible(id) {
    if (id === "admin" || id === "moderation" || id === "aistats") {
        return isAdmin();
    }
    if (id === "subscription") {
        return !hasUnlimited();
    }
    return true;
}

function sidebarNavGroups() {
    return SIDEBAR_GROUPS
        .map((group) => ({
            label: group.label,
            items: group.items.filter(sectionVisible).map((id) => sectionItems.find((item) => item.id === id)).filter(Boolean)
        }))
        .filter((group) => group.items.length);
}

export function renderShell() {
    renderImpersonationBar();
    renderNavigation("sidebarNavigation", sidebarNavGroups());
    renderMobileNavigation();
    renderCurrentUserButton();
    renderSidebarProfile();
    icons(); // one pass converts sidebar nav + mobile nav + profile icons
}

// Mobile bottom bar: "Тренування" sits in the centre as an elevated accent
// button (pulses while a workout is active); the rest are icon+label tabs.
function renderMobileNavigation() {
    const container = element("mobileNavigation");
    const activeWorkout = activeWorkoutFor(currentUser().id);
    const order = ["feed", "calendar", "workout", "dashboard", "profile"];
    const mobileLabels = { workout: "Тренування" };
    container.innerHTML = order.map((id) => {
        const item = sectionItems.find((section) => section.id === id);
        if (!item) {
            return "";
        }
        const active = state.section === id ? "active" : "";
        const label = escapeHtml(mobileLabels[id] || item.title);
        if (id === "workout") {
            return `<button class="mnav-center ${active}" type="button" data-action="navigate" data-section="workout" aria-label="${escapeHtml(item.title)}">
                    <span class="mnav-center-btn"><i data-lucide="${item.icon}"></i>${activeWorkout ? `<span class="mnav-pulse" aria-hidden="true"></span>` : ""}</span>
                    <span class="mnav-label">${label}</span>
                </button>`;
        }
        return `<button class="mnav-item ${active}" type="button" data-action="navigate" data-section="${id}" aria-label="${escapeHtml(item.title)}">
                <span class="mnav-ico"><i data-lucide="${item.icon}"></i></span>
                <span class="mnav-label">${label}</span>
            </button>`;
    }).join("");
}

export function renderAuthGate(message = "") {
    element("sidebarNavigation").innerHTML = "";
    element("mobileNavigation").innerHTML = "";
    element("sidebarProfileCard").innerHTML = `<div class="profile-meta">Потрібна авторизація Google</div>`;
    element("openUserSwitcherButton").innerHTML = "GO";
    delete element("openUserSwitcherButton").dataset.avatarSig;
    delete element("sidebarProfileCard").dataset.sig;
    element("sectionEyebrow").textContent = "Авторизація";
    element("sectionTitle").textContent = "GymOS";
    element("pageContent").innerHTML = `
            <section class="empty-state auth-gate">
                <i data-lucide="shield-check"></i>
                <h2>Увійди через Google</h2>
                <p>GymOS працює через backend API. Дані тренувань доступні тільки після авторизації.</p>
                ${message ? `<p class="card-caption">${escapeHtml(message)}</p>` : ""}
                <div class="action-row auth-gate-actions" style="justify-content:center;margin-top:16px;">
                    <button class="button button-primary large-workout-button" type="button" data-action="login-google"><svg class="google-g" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" focusable="false"><path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/><path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/><path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/><path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/></svg>Увійти через Google</button>
                    <button class="button button-secondary large-workout-button" type="button" data-action="check-backend"><i data-lucide="server"></i>Перевірити backend</button>
                </div>
                <p class="profile-meta" style="margin-top:14px;">Backend: ${escapeHtml(storage.apiBaseUrl || "не налаштовано")} · статус: ${backendStatusLabel(storage.backendStatus)}</p>
            </section>
        `;
    icons();
}

// Shown when the session is valid but the data could not be loaded (backend down,
// 5xx, timeout, malformed response). Distinct from renderAuthGate on purpose: the
// user is signed in, their token is untouched, and the fix is to retry — not to
// log in again. Conflating the two is what made every backend hiccup read as
// "your account is gone".
export function renderLoadFailure(message = "") {
    element("sidebarNavigation").innerHTML = "";
    element("mobileNavigation").innerHTML = "";
    element("sidebarProfileCard").innerHTML = `<div class="profile-meta">Немає зв'язку з backend</div>`;
    element("openUserSwitcherButton").innerHTML = "GO";
    delete element("openUserSwitcherButton").dataset.avatarSig;
    delete element("sidebarProfileCard").dataset.sig;
    element("sectionEyebrow").textContent = "Помилка завантаження";
    element("sectionTitle").textContent = "GymOS";
    element("pageContent").innerHTML = `
            <section class="empty-state auth-gate">
                <i data-lucide="cloud-off"></i>
                <h2>Не вдалося завантажити дані</h2>
                <p>Backend недоступний. Спробуй ще раз або увійди через Google.</p>
                ${message ? `<p class="card-caption">${escapeHtml(message)}</p>` : ""}
                <div class="action-row auth-gate-actions" style="justify-content:center;margin-top:16px;">
                    <button class="button button-primary large-workout-button" type="button" data-action="retry-load"><i data-lucide="refresh-cw"></i>Спробувати ще раз</button>
                    <!-- Escape hatch: this screen is also reachable with a stale or
                         rejected token, and without this the user has no way out. -->
                    <button class="button button-secondary large-workout-button" type="button" data-action="login-google"><i data-lucide="log-in"></i>Увійти через Google</button>
                    <button class="button button-secondary large-workout-button" type="button" data-action="check-backend"><i data-lucide="server"></i>Перевірити backend</button>
                </div>
                <p class="profile-meta" style="margin-top:14px;">Backend: ${escapeHtml(storage.apiBaseUrl || "не налаштовано")} · статус: ${backendStatusLabel(storage.backendStatus)}</p>
            </section>
        `;
    icons();
}

export function requiresApproval() {
    if (!(storage.mode === "api" && storage.config.requireAuth)) {
        return false;
    }
    const user = storage.currentUser;
    if (!user || isAdmin()) {
        return false;
    }
    return user.approved === false;
}

export function renderApprovalGate() {
    const user = storage.currentUser || {};
    element("sidebarNavigation").innerHTML = "";
    element("mobileNavigation").innerHTML = "";
    element("sidebarProfileCard").innerHTML = `<div class="profile-meta">Очікування підтвердження</div>`;
    element("openUserSwitcherButton").innerHTML = "GO";
    delete element("openUserSwitcherButton").dataset.avatarSig;
    delete element("sidebarProfileCard").dataset.sig;
    element("sectionEyebrow").textContent = "Доступ";
    element("sectionTitle").textContent = "GymOS";
    element("pageContent").innerHTML = `
            <section class="empty-state auth-gate">
                <i data-lucide="hourglass"></i>
                <h2>Очікуйте підтвердження адміністратора</h2>
                <p>Ваш акаунт${user.email ? ` (${escapeHtml(user.email)})` : ""} зареєстровано. Доступ до GymOS відкриється після підтвердження адміністратором.</p>
                <div class="action-row" style="justify-content:center;margin-top:16px;">
                    <button class="button button-primary large-workout-button" type="button" data-action="recheck-approval"><i data-lucide="refresh-cw"></i>Перевірити ще раз</button>
                    <button class="button button-secondary large-workout-button" type="button" data-action="logout"><i data-lucide="log-out"></i>Вийти</button>
                </div>
            </section>
        `;
    icons();
}

export async function recheckApproval() {
    await storage.refreshCurrentUser(false);
    state.authUser = storage.currentUser;
    if (storage.requiresAuthentication()) {
        renderAuthGate();
        return;
    }
    if (requiresApproval()) {
        renderApprovalGate();
        toast("Ще не підтверджено", "Адміністратор поки не підтвердив доступ.");
        return;
    }
    const approvedDatabase = await storage.load();
    const approvedProblem = databaseProblem(approvedDatabase);
    if (approvedProblem) {
        renderLoadFailure(approvedProblem);
        return;
    }
    state.database = approvedDatabase;
    state.profileUserId = state.database.currentUserId;
    // Seeded from every payload install: null under the legacy shape (all history is
    // already present), a cursor under the windowed one.
    state.workoutsCursor = state.database.workoutsCursor || null;
    renderShell();
    handleRoute();
    toast("Доступ відкрито", "Ласкаво просимо до GymOS!");
}

function renderNavigation(containerId, items) {
    const activeWorkout = activeWorkoutFor(currentUser().id);
    const newFb = isAdmin() ? newFeedbackCount() : 0;
    const container = element(containerId);
    // Accepts either a flat item list or [{label, items}] groups.
    const groups = Array.isArray(items) && items.length && items[0] && Array.isArray(items[0].items)
        ? items
        : [{ label: "", items: items || [] }];
    const renderItem = (item) => {
        let badge = "";
        if (item.id === "workout" && activeWorkout) {
            badge = `<strong class="nav-badge">Активне</strong>`;
        } else if (item.id === "feedback" && newFb > 0) {
            badge = `<strong class="nav-badge">${newFb}</strong>`;
        } else if (item.id === "feed" && feedState.notifications.unread > 0) {
            badge = `<strong class="nav-badge">${feedState.notifications.unread > 99 ? "99+" : feedState.notifications.unread}</strong>`;
        } else if (item.id === "moderation" && isAdmin() && pendingExercises().length > 0) {
            badge = `<strong class="nav-badge">${pendingExercises().length}</strong>`;
        }
        return `
            <button class="nav-button ${state.section === item.id ? "active" : ""}" type="button" data-action="navigate" data-section="${item.id}" title="${escapeHtml(item.title)}">
                <span><i data-lucide="${item.icon}"></i><span class="nav-label">${escapeHtml(item.title)}</span></span>
                ${badge}
            </button>`;
    };
    container.innerHTML = groups.map((group) => `${group.label ? `<p class="nav-group-label">${escapeHtml(group.label)}</p>` : ""}${group.items.map(renderItem).join("")}`).join("");
}

export function renderCurrentUserButton() {
    const user = currentUser();
    const button = element("openUserSwitcherButton");
    const url = imageUrl(user.avatarUrl);
    const tier = frameTierFor(user, userLevel(user.id).level);
    button.style.background = user.avatarColor;
    button.style.setProperty("--fgi", tier.glow);
    button.style.setProperty("--fglowc", tier.glowColor);
    button.classList.add("has-frame");
    button.classList.toggle("is-anim", tier.conic);
    // Only rebuild the <img> when the avatar actually changed. Rebuilding it on
    // every tab switch / action recreated the element and made the photo blink.
    const avatarSig = `${user.id}|${url}`;
    if (button.dataset.avatarSig === avatarSig) {
        return;
    }
    button.dataset.avatarSig = avatarSig;
    button.innerHTML = `${escapeHtml(user.avatarInitials)}${url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(user.displayName || "")}" referrerpolicy="no-referrer" loading="eager" decoding="sync" onerror="this.remove()">` : ""}`;
}

export function renderSidebarProfile() {
    const user = currentUser();
    const stats = userStats(user.id);
    const info = userLevel(user.id);
    // Skip the innerHTML rebuild (which recreates the avatar <img> → blink) when
    // nothing shown here changed. Rebuild only when the user / avatar / level /
    // XP / stats / plan actually change.
    const profileCard = element("sidebarProfileCard");
    const profileSig = `${user.id}|${imageUrl(user.avatarUrl)}|${info.level}|${info.xpToNext}|${Math.round(info.progress * 100)}|${stats.completedWorkouts}|${stats.totalVolume}|${hasUnlimited()}`;
    if (profileCard.dataset.sig === profileSig) {
        return;
    }
    profileCard.dataset.sig = profileSig;
    profileCard.innerHTML = `
            <div class="profile-row">
                ${framedAvatar(user, "small", info.level)}
                <div>
                    <div class="profile-name">${escapeHtml(user.displayName)}</div>
                    <div class="profile-meta">${stats.completedWorkouts} тренувань · ${number(stats.totalVolume)} кг${infoTip("Загальний підсумок", "Загальний підсумок твоєї активності. Показує кількість проведених тренувань та сумарну вагу, яку ти підняв за весь час. Допомагає бачити глобальний масштаб твоєї роботи та мотивує не зупинятися.")}</div>
                </div>
            </div>
            <div class="sidebar-level" data-action="navigate" data-section="levels">
                ${levelBadge(info)}
                <span class="sidebar-level-caption">${info.isMax ? "Максимальний рівень" : `${number(info.xpToNext)} XP до Рів. ${info.level + 1}`}</span>
                ${infoTip("Рівні та XP", XP_HOWTO)}
            </div>
            <div class="progress-track" style="margin-top: 10px;"><div class="progress-fill" style="width: ${Math.round(info.progress * 100)}%;"></div></div>
            ${hasUnlimited()
            ? `<div class="sidebar-role" style="margin-top: 10px;">${roleStatusBadge(user)}</div>`
            : `<button class="button button-primary compact sidebar-upgrade" type="button" data-action="navigate" data-section="subscription"><i data-lucide="rocket"></i>Апгрейд до PRO</button>`}
        `;
}

let pendingExerciseScrollId = null;

let pendingNoteFocus = null;

/** Scroll to this freshly added exercise on the next render (null: don't). */
export function setPendingExerciseScroll(id) {
    pendingExerciseScrollId = id;
}

/** Focus this note's field on the next render. */
export function setPendingNoteFocus(noteKey) {
    pendingNoteFocus = noteKey;
}

// The topmost thing still visible below the sticky header, and where its top edge sits
// right now.
//
// Individual SET rows are preferred over exercise cards, because the things that
// change height on a tick happen INSIDE a card: the coach-mark above set 1 disappears
// the moment that set is done, and the card collapses once all of its sets are. An
// anchor on the card would hold the card still while its contents slid underneath.
/**
 * How much of the top of the screen is covered by sticky chrome right now.
 *
 * Three layers stack there on the workout screen — the topbar, the action bar and the
 * «Минулого разу» strip — and every one of them is `position: sticky`, so anything
 * measured against the viewport top is measured against the wrong line.
 */
function stickyTopOffset(node) {
    let offset = topbarHeight();
    const bar = document.querySelector(".workout-actionbar");
    if (bar) {
        offset += bar.offsetHeight;
    }
    const card = node && node.closest ? node.closest(".workout-exercise") : null;
    const strip = (card || document).querySelector(".last-results");
    if (strip) {
        offset += strip.offsetHeight;
    }
    return offset;
}

function captureScrollAnchor() {
    // Was topbarHeight() alone, which counts only the FIRST of three sticky layers —
    // so a row hidden behind the action bar and the «Минулого разу» strip still looked
    // like the topmost visible one, and every re-render faithfully restored it to
    // where it was: out of sight.
    const cutoff = stickyTopOffset(null);
    const nodes = document.querySelectorAll("[data-set-id], .workout-exercise[data-workout-exercise-id]");
    for (const node of nodes) {
        const rect = node.getBoundingClientRect();
        if (rect.bottom > cutoff) {
            return {
                key: node.dataset.setId ? `set:${node.dataset.setId}` : `ex:${node.dataset.workoutExerciseId}`,
                top: rect.top
            };
        }
    }
    return null;
}

/*
 * NOTHING HERE HANDLES THE ON-SCREEN KEYBOARD, ON PURPOSE.
 *
 * Four versions of that lived here and every one was worse than nothing: reserving the
 * sticky layers' height in scroll-margin (iOS takes those layers off screen when the
 * keyboard opens, so the reservation only overscrolled); scrolling the field into view
 * after focus (landed mid-way through the browser's own animation and snapped);
 * smoothing that; and finally restoring the pre-keyboard scroll position (a scroll back
 * is still a scroll the reader did not ask for).
 *
 * The browser already raises and lowers the page with the keyboard, smoothly, the way
 * every other app does. The correct amount of help is none. If this looks broken again,
 * the fix is somewhere else — a sticky offset, a viewport meta — not another scroll
 * from here.
 */

// Returns true when it handled the scroll, so the caller knows not to fall back.
function restoreScrollAnchor(anchor) {
    if (!anchor || !anchor.key) {
        return false;
    }
    const [kind, id] = [anchor.key.slice(0, anchor.key.indexOf(":")), anchor.key.slice(anchor.key.indexOf(":") + 1)];
    const node = kind === "set"
        ? document.querySelector(`[data-set-id="${CSS.escape(id)}"]`)
        : document.querySelector(`.workout-exercise[data-workout-exercise-id="${CSS.escape(id)}"]`);
    if (!node) {
        return false;
    }
    const delta = node.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) >= 1) {
        // "instant": a smooth scroll here would read as the page sliding on every tap.
        window.scrollTo({ top: window.scrollY + delta, behavior: "instant" });
    }
    return true;
}

// ---- Keep the screen on while training ------------------------------------------------
//
// Between sets the phone locks itself, and the next set starts with a passcode and
// chalky hands. A wake lock while a workout is ACTIVE (or focus mode is open) removes
// that entirely.
//
// Deliberately narrow: it follows the session, not the app. Nothing is held on the
// calendar, in the feed, or after «Завершити» — a lock that outlives its reason is a
// battery complaint nobody will connect back to this feature.
let screenWakeLock = null;

let wakeLockWanted = false;

function wantsScreenAwake() {
    if (getPref("keepAwake") !== "1") {
        return false;
    }
    if (state.focus) {
        return true;
    }
    const workoutItem = editWorkout();
    return Boolean(workoutItem && workoutItem.status === "active" && canManage(workoutItem));
}

export async function syncScreenWakeLock() {
    wakeLockWanted = wantsScreenAwake();
    if (!("wakeLock" in navigator)) {
        return; // iOS < 16.4, Firefox. Nothing to fall back to that is worth the battery.
    }
    if (!wakeLockWanted) {
        const held = screenWakeLock;
        screenWakeLock = null;
        if (held) {
            await held.release().catch(() => undefined);
        }
        return;
    }
    if (screenWakeLock) {
        return;
    }
    try {
        screenWakeLock = await navigator.wakeLock.request("screen");
        // The OS drops the lock whenever the tab is hidden, and does NOT restore it on
        // return — without this the screen stays on for exactly one trip to another app.
        screenWakeLock.addEventListener("release", () => {
            screenWakeLock = null;
        });
    } catch (error) {
        // Denied (low battery, a policy, an inactive document). Not worth telling
        // anybody about: the workout is unaffected.
        screenWakeLock = null;
    }
}

export function renderSection() {
    destroyCharts();
    if ((state.section === "admin" || state.section === "moderation" || state.section === "aistats") && !isAdmin()) {
        state.section = defaultSection();
    }
    renderShell();
    // Detail routes ("post", "user") are reachable but are not nav entries, so they
    // have no sectionItems row — without this they would inherit "Панель".
    const detailTitles = { post: "Пост", user: "Профіль учасника" };
    const item = sectionItems.find((section) => section.id === state.section)
        || (detailTitles[state.section] ? { id: state.section, title: detailTitles[state.section], icon: "file-text" } : sectionItems[0]);
    element("sectionEyebrow").textContent = "Gym Progress OS";
    if (state.section === "user") {
        const viewedUser = userById(state.viewUserId);
        element("sectionTitle").textContent = viewedUser ? viewedUser.displayName : "Користувач";
    } else {
        element("sectionTitle").textContent = item.title;
    }
    // The header's own identity, captured where it is actually decided. The scroll
    // handler borrows the header for the exercise you are on and restores from here;
    // letting it snapshot the DOM instead meant a first pass with nothing to show
    // could freeze the placeholder title ("GymOS") as the thing to restore.
    topbarContextBase = { eyebrow: element("sectionEyebrow").textContent, title: element("sectionTitle").textContent };
    const renderers = { dashboard, workout, calendar, exercises, stats, feed, notifications, post: postSection, rankings, levels, users, feedback, moderation, admin: adminPanel, aistats: aiStats, subscription, changelog, profile, settings, user: () => userDetail(state.viewUserId) };
    // An in-place re-render (ticking a set, editing a field) must not move the page.
    //
    // A pixel offset is not enough to hold it still: the re-render legitimately changes
    // heights ABOVE the viewport — an exercise collapses once its last set is ticked,
    // the action bar gains the clock chip the first time — and restoring the same
    // scrollY then shows different content. So anchor on a real element instead and
    // scroll by however far it actually moved.
    //
    // Keyed on the target, not just the section: opening a DIFFERENT workout is a
    // navigation and should start at the top, even though the section name is the same.
    const viewKey = `${state.section}|${state.editingWorkoutId || ""}|${state.viewUserId || ""}`;
    const keepScroll = renderSection.lastViewKey === viewKey;
    renderSection.lastViewKey = viewKey;
    const scrollBefore = window.scrollY;
    const anchor = keepScroll ? captureScrollAnchor() : null;
    (renderers[state.section] || dashboard)();
    // iconsIn swaps every <i data-lucide> placeholder for a sized <svg>, which changes
    // heights. Measuring the anchor before that ran would correct the scroll against a
    // layout that is about to change again — so restore AFTER the icons are in.
    iconsIn(element("pageContent")); // shell icons already converted in renderShell()
    if (keepScroll) {
        if (!restoreScrollAnchor(anchor) && window.scrollY !== scrollBefore) {
            window.scrollTo(0, scrollBefore);
        }
    }
    // Subtle enter animation only when the section actually changes (not on
    // in-place data re-renders), so navigation feels smooth, edits don't flash.
    if (renderSection.lastSection !== state.section) {
        renderSection.lastSection = state.section;
        const pageEl = element("pageContent");
        pageEl.classList.remove("page-enter");
        void pageEl.offsetWidth;
        pageEl.classList.add("page-enter");
        // Start each new tab at the top so the enter animation reads cleanly
        // (skip when we're about to scroll to a freshly added exercise).
        if (!pendingExerciseScrollId) {
            window.scrollTo(0, 0);
        }
    }
    updateTopbarOffset();
    requestAnimationFrame(updateTopbarOffset);
    updateLastResultsFocus();
    syncScreenWakeLock();
    // A re-render replaces the cards, so the remembered context key is stale.
    const topbarEl = document.querySelector(".topbar");
    if (topbarEl) {
        delete topbarEl.dataset.ctxKey;
    }
    updateTopbarContext();
    syncGymClockTicker();

    if (pendingNoteFocus) {
        const key = pendingNoteFocus;
        pendingNoteFocus = null;
        const field = document.querySelector(`textarea[data-note-key="${CSS.escape(key)}"]`);
        if (field) {
            field.focus();
            field.setSelectionRange(field.value.length, field.value.length);
        }
    }

    if (pendingExerciseScrollId) {
        const targetId = pendingExerciseScrollId;
        pendingExerciseScrollId = null;
        requestAnimationFrame(() => {
            const target = document.querySelector(`[data-workout-exercise-id="${targetId}"]`);
            if (!target) {
                return;
            }
            // Its TOP, under the sticky chrome — not its centre. Centring a tall card
            // scrolls past the heading to the first set, so you land on numbers with
            // no idea which exercise they belong to. The name is the point of
            // scrolling there at all.
            const offset = topbarHeight() + 12;
            const top = window.scrollY + target.getBoundingClientRect().top - offset;
            window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
        });
    }
}

// Plain-language explanations for every dashboard metric — "що це / що означає
// число / навіщо це мені". Surfaced via the info tooltips (see infoTip).
const dashboardTips = {
    volume: "Сумарний робочий обсяг (тоннаж). Це загальна вага, яку ти підняв за поточний тиждень (вага × повторення × підходи). Головний маркер прогресивного навантаження: якщо обсяг стабільно зростає без шкоди для техніки, твої м'язи стають сильнішими та адаптуються до навантажень.",
    cardio: "Час кардіонавантажень. Сумарний час у хвилинах, присвячений витривалості та здоров'ю серцево-судинної системи за поточний тиждень. Корисно для відстеження балансу між силовими тренуваннями та кардіо для відновлення або спалювання калорій.",
    volumeChart: "Розподіл навантаження за днями тижня. Показує, в які дні ти виклався на максимум, а коли відпочивав. Допомагає аналізувати періодизацію тренувань та уникати перетренованості.",
    muscleChart: "Аналітика м'язових груп. Показує відсоткове співвідношення підходів на різні частини тіла (груди, плечі, трицепс тощо). Допомагає контролювати баланс розвитку тіла, щоб уникати м'язових дисбалансів та рівномірно навантажувати всі цільові групи.",
    ops: "Швидка статистика поточної активності. «Завершено» — кількість тренувань, «Серія» — кількість днів регулярних тренувань поспіль (твій страйк), «Підходи» — сумарна кількість виконаних робочих серій. Тримай страйк, щоб будувати звичку!",
    pr: "Твій особистий рекорд (Personal Record). Розрахунковий максимум на 1 повторення (1ПМ) на основі твоїх останніх важких підходів. Головний показник твого пікового силового потенціалу в конкретній вправі.",
    team: "Спільний прогрес твого спортивного ком'юніті. Сума тренувань та кілограмів, піднятих усіма учасниками твоєї групи. Мотивує змагальним духом та показує силу командної роботи."
};

export let topbarContextBase = { eyebrow: "Gym Progress OS", title: "GymOS" };
