// Стрічка: feed, posts, comments, reports, notifications, moderation queue, web push, achievement bridge.
import { escapeHtml, number, formatDate } from "../lib/format.js";
import {
    timeAgo, notificationBucket, threadComments, urlBase64ToUint8Array, NOTIFICATION_ICONS, REPORT_REASON_LABELS,
    FEED_SCOPE_TABS, PUSH_CATEGORIES, REPORT_TARGET_LABELS
} from "../lib/feed-ui.js";
import { emptyInline, exerciseThumb } from "./components.js";
import { storage } from "./data.js";
import {
    avatar, currentUser, exerciseByName, isAdmin, startWorkoutButton, userById, workoutTypeLabel
} from "./model.js";
import {
    closeOverlay, confirmDialog, content, element, friendlyError, handleUserFacingError, openModal, promptDialog,
    toast
} from "./overlays.js";
import { getPref, setPref } from "./prefs.js";
import { loadPresence, renderPresenceStrip } from "./presence.js";
import { userAchievements } from "./progression.js";
import { recordsFor } from "./scoring-bridge.js";
import { settingsGroup, settingsRow } from "./settings.js";
import { renderSection, renderShell } from "./shell.js";
import { state } from "./state.js";
import { iconsIn, inputValue } from "./util.js";
import { pluralUk } from "./workout-screen.js";

// ===== Стрічка: feed, threads, notifications, reports, push ================
// The feed replaces the old "Усі" history tab and the team screen's activity
// role. Everything is paged with the server's opaque cursors, and every
// interaction is optimistic — a like or a comment lands instantly and reconciles
// with the server's answer, because waiting a round-trip to see your own tap is
// what makes a social surface feel dead.
export const feedState = {
    scope: "team",
    items: [],
    cursor: null,
    loading: false,
    loadingMore: false,
    error: null,
    loaded: false,
    post: null,
    postLoading: false,
    postError: null,
    notifications: { items: [], unread: 0, cursor: null, loading: false, loaded: false },
    reports: { items: [], loading: false, loaded: false },
    loadedAt: 0,
    pushKey: null
};

export function feedApiReady() {
    return storage.mode === "api" && storage.apiClient.hasBaseUrl();
}

// ---- Feed list --------------------------------------------------------

// How long a loaded page stays fresh. Without this the list was frozen for the whole
// session: finishing a workout, coming back from a post, switching tabs — nothing
// refetched, so a session you had just logged never appeared until a hard reload.
const FEED_TTL_MS = 60 * 1000;

function feedIsStale() {
    return !feedState.loadedAt || Date.now() - feedState.loadedAt > FEED_TTL_MS;
}

// Called wherever something happens that the feed should show (finishing a session).
export function invalidateFeed() {
    feedState.loadedAt = 0;
}

export async function loadFeed(scope, append) {
    // Two callers used to race here — setFeedScope fired one request and the section
    // renderer's own guard fired an identical second — and both wrote items/cursor,
    // last response wins.
    if (append ? feedState.loadingMore : feedState.loading) {
        return;
    }
    if (!feedApiReady()) {
        feedState.error = "Стрічка доступна лише онлайн.";
        feedState.loaded = true;
        renderFeedList();
        return;
    }
    let unchanged = false;
    if (append) {
        feedState.loadingMore = true;
    } else {
        feedState.loading = true;
        feedState.error = null;
    }
    renderFeedList();
    try {
        const answer = await storage.apiClient.fetchFeed(scope, append ? feedState.cursor : null);
        const incoming = answer.items || [];
        // A refresh that returns the same page must not repaint: rebuilding the list
        // recreates every avatar <img>, and a recreated image blinks even when the
        // browser already holds the bytes.
        unchanged = !append && feedSignature(incoming) === feedSignature(feedState.items);
        feedState.items = append ? [...feedState.items, ...incoming] : incoming;
        feedState.cursor = answer.nextCursor || null;
        feedState.error = null;
    } catch (error) {
        feedState.error = friendlyError(error);
    } finally {
        feedState.loading = false;
        feedState.loadingMore = false;
        feedState.loaded = true;
        if (!append && !feedState.error) {
            feedState.loadedAt = Date.now();
        }
        if (!unchanged) {
            renderFeedList();
        }
    }
}

/**
 * What the rendered feed actually depends on.
 *
 * Reaction counts and comment counts are in it because they are drawn on the card;
 * anything else changing is invisible and must not cost a repaint.
 */
function feedSignature(items) {
    return (items || []).map((item) => [
        item.type,
        item.id,
        item.reactions?.count || 0,
        item.reactions?.mine ? 1 : 0,
        item.comments?.count ?? item.commentCount ?? 0
    ].join(":")).join("|");
}

export function setFeedScope(scope) {
    if (feedState.scope === scope) {
        return;
    }
    feedState.scope = scope;
    feedState.items = [];
    feedState.cursor = null;
    feedState.loaded = false;
    feedState.loadedAt = 0;
    // renderSection() runs feed(), whose own guard issues the request — calling it
    // here too just sent the same page twice.
    renderSection();
}

export function feed() {
    const unread = feedState.notifications.unread;
    content(`<div class="grid dashboard-grid">
            <section class="card span-12 feed-head">
                <div class="feed-head-row">
                    <div>
                        <h2>Стрічка</h2>
                        <p class="card-caption">Тренування, рекорди й досягнення команди.</p>
                    </div>
                    <button class="icon-button feed-bell" type="button" data-action="navigate" data-section="notifications" aria-label="Повідомлення"><i data-lucide="bell"></i>${unread ? `<span class="feed-bell-badge">${unread > 99 ? "99+" : unread}</span>` : ""}</button>
                </div>
                <div class="feed-tabs">${FEED_SCOPE_TABS.map(([value, label]) => `<button class="feed-tab ${feedState.scope === value ? "active" : ""}" type="button" data-action="feed-scope" data-scope="${value}">${label}</button>`).join("")}</div>
            </section>
            <div id="presenceStrip" class="span-12"></div>
            <section class="span-12"><div id="feedList" class="feed-list"></div></section>
        </div>`);
    renderPresenceStrip();
    loadPresence();
    renderFeedList();
    // Paint what we have, then refetch page 1 when it has gone stale — the cached
    // list stays on screen meanwhile, so revisiting the tab never flashes empty.
    if ((!feedState.loaded || feedIsStale()) && !feedState.loading) {
        loadFeed(feedState.scope, false);
    }
}

function renderFeedList() {
    const host = element("feedList");
    if (!host) {
        return;
    }
    // The skeleton is for a list that has nothing to show yet. Painting it over a
    // list already on screen is what made every background refresh — and there is one
    // now every time a teammate starts or finishes a session — flash the whole feed
    // away and back.
    if (feedState.loading && !feedState.items.length) {
        host.innerHTML = feedSkeleton(3);
        return;
    }
    if (feedState.error) {
        host.innerHTML = `<div class="feed-state feed-state-error">
                <span class="feed-state-ico"><i data-lucide="wifi-off"></i></span>
                <h3>Стрічка не завантажилась</h3>
                <p class="card-caption">${escapeHtml(feedState.error)} Твоє тренування працює офлайн і синхронізується автоматично.</p>
                <div class="action-row" style="justify-content:center;margin-top:14px;"><button class="button button-primary compact" type="button" data-action="feed-retry"><i data-lucide="refresh-cw"></i>Спробувати ще</button><button class="button button-secondary compact" type="button" data-action="navigate" data-section="workout">До тренування</button></div>
            </div>`;
        iconsIn(host);
        return;
    }
    if (!feedState.items.length) {
        host.innerHTML = feedEmptyState();
        iconsIn(host);
        return;
    }
    host.innerHTML = feedState.items.map(feedCard).join("")
        + (feedState.cursor
            ? `<div class="action-row" style="justify-content:center;margin-top:6px;"><button class="button button-secondary compact" type="button" data-action="feed-more" ${feedState.loadingMore ? "disabled" : ""}>${feedState.loadingMore ? "Вантажу…" : "Показати більше"}</button></div>`
            : "");
    iconsIn(host);
}

function feedEmptyState() {
    const copy = {
        team: ["Поки тихо", "Ніхто з команди ще не публікував сесій. Почни ти — і твоє тренування побачить уся команда."],
        records: ["Рекордів ще немає", "Заверши робочий підхід із новою вагою — і він зʼявиться тут."],
        achievements: ["Досягнень ще немає", "Вони відкриваються самі, коли ти тренуєшся. Загляни в «Прокачку»."],
        mine: ["Тут будуть твої пости", "Заверши тренування — воно одразу зʼявиться у стрічці."]
    }[feedState.scope] || ["Порожньо", ""];
    return `<div class="feed-state">
            <span class="feed-state-ico"><i data-lucide="users"></i></span>
            <h3>${escapeHtml(copy[0])}</h3>
            <p class="card-caption">${escapeHtml(copy[1])}</p>
            <div class="action-row" style="justify-content:center;margin-top:14px;">${startWorkoutButton(null, { compact: true })}<button class="button button-secondary compact" type="button" data-action="navigate" data-section="users">Хто в команді</button></div>
        </div>`;
}

function feedSkeleton(count) {
    return Array.from({ length: count }, () => `<article class="feed-card skeleton-card"><div class="feed-card-head"><span class="skeleton-dot"></span><span class="skeleton-line" style="width:38%"></span></div><span class="skeleton-line" style="width:100%;height:52px;border-radius:12px;"></span><span class="skeleton-line" style="width:52%"></span></article>`).join("");
}

function feedAuthor(item) {
    const author = item.author || { displayName: "Учасник", avatarInitials: "", avatarColor: "#333" };
    const local = author.id ? userById(author.id) : null;
    const avatarUser = local || { displayName: author.displayName, avatarInitials: initialsOf(author.displayName), avatarColor: "#2f3a44", avatarUrl: author.avatarUrl };
    return `<button class="feed-author" type="button" data-action="open-user" data-user-id="${escapeHtml(author.id || "")}">${avatar(avatarUser, "tiny")}<span class="feed-author-text"><strong>${escapeHtml(author.displayName || "Учасник")}</strong><span class="feed-meta">${timeAgo(item.createdAt)}${item.workoutType ? ` · ${workoutTypeLabel(item.workoutType)}` : ""}</span></span></button>`;
}

function initialsOf(name) {
    return String(name || "?").trim().slice(0, 2).toUpperCase();
}

function feedCard(item) {
    const key = `${item.type}:${item.id}`;
    const liked = item.reactions && item.reactions.mine;
    const likeCount = (item.reactions && item.reactions.count) || 0;
    const actions = `<div class="feed-actions">
            <button class="feed-act ${liked ? "liked" : ""}" type="button" data-action="feed-react" data-type="${item.type}" data-id="${item.id}"><i data-lucide="thumbs-up"></i><span data-like-count="${escapeHtml(key)}">${likeCount}</span></button>
            <button class="feed-act" type="button" data-action="open-post" data-type="${item.type}" data-id="${item.id}"><i data-lucide="message-circle"></i><span>${item.commentCount || 0}</span></button>
            ${item.author && item.author.id === state.database.currentUserId ? "" : `<button class="icon-button feed-more" type="button" title="Поскаржитись" data-action="open-report" data-type="${item.type}" data-id="${item.id}"><i data-lucide="more-horizontal"></i></button>`}
        </div>`;

    if (item.type === "record") {
        return `<article class="feed-card feed-record" data-action="open-post" data-type="record" data-id="${item.id}">
                ${feedAuthor(item)}
                <div class="feed-body feed-record-body"><span class="feed-record-ico"><i data-lucide="flame"></i></span><div><strong>Новий рекорд · ${escapeHtml(item.exercise || "")}</strong><p class="card-caption">${number(item.weightKg)} кг${item.repetitions ? ` × ${item.repetitions}` : ""}${item.estimatedOneRepMax ? ` · 1ПМ ${number(item.estimatedOneRepMax)} кг` : ""}</p></div></div>
                ${actions}
            </article>`;
    }
    if (item.type === "achievement") {
        return `<article class="feed-card feed-achievement" data-action="open-post" data-type="achievement" data-id="${item.id}">
                ${feedAuthor(item)}
                <div class="feed-body feed-ach-body"><span class="feed-ach-ico"><i data-lucide="award"></i></span><div><strong>Досягнення «${escapeHtml(item.title || "")}»</strong><p class="card-caption">${escapeHtml(item.description || "")}</p></div></div>
                ${actions}
            </article>`;
    }
    // A session whose owner keeps their details private. The card stays — that they
    // trained is public by design — but the numbers are ABSENT, not zero, so printing
    // them would render "undefined підходів" and a zero would be a lie.
    if (item.private) {
        return `<article class="feed-card feed-private" data-action="open-post" data-type="workout" data-id="${item.id}">
                ${feedAuthor(item)}
                <div class="feed-body feed-private-body">
                    <span class="feed-private-ico"><i data-lucide="lock"></i></span>
                    <div>
                        <strong>Тренування ${item.workoutType ? `· ${escapeHtml(workoutTypeLabel(item.workoutType))}` : ""}</strong>
                        <p class="card-caption">Деталі приховані власником${item.durationMinutes ? ` · ${item.durationMinutes} хв` : ""}</p>
                    </div>
                </div>
                ${actions}
            </article>`;
    }
    const preview = (item.exercises || []).map((exercise) => `<span class="feed-ex">${escapeHtml(exercise.name)}<em>${exercise.sets}</em></span>`).join("");
    return `<article class="feed-card" data-action="open-post" data-type="workout" data-id="${item.id}">
            ${feedAuthor(item)}
            <div class="feed-body">
                <div class="feed-stats">
                    <span><strong>${number(item.volumeKg)}</strong><em>кг</em></span>
                    <span><strong>${item.setCount}</strong><em>підходів</em></span>
                    <span><strong>${item.exerciseCount}</strong><em>вправ</em></span>
                    ${item.durationMinutes ? `<span><strong>${item.durationMinutes}</strong><em>хв</em></span>` : ""}
                    ${item.cardioMinutes ? `<span><strong>${item.cardioMinutes}</strong><em>хв кардіо</em></span>` : ""}
                </div>
                ${preview ? `<div class="feed-ex-row">${preview}${item.exerciseCount > (item.exercises || []).length ? `<span class="feed-ex more">ще ${item.exerciseCount - (item.exercises || []).length}</span>` : ""}</div>` : ""}
            </div>
            ${actions}
        </article>`;
}

// Optimistic: flip the button and the count immediately, then reconcile with the
// server's authoritative number. A failure rolls the UI back and says so.
export async function toggleFeedReaction(type, id, button) {
    if (!feedApiReady()) {
        return;
    }
    const key = `${type}:${id}`;
    // Re-queried after every await, never cached: a feed refresh landing mid-flight
    // replaces these nodes, and writing the server's count into a detached element
    // is invisible — the tap then looks like it did nothing.
    const paint = (count, liked) => {
        document.querySelectorAll(`[data-like-count="${CSS.escape(key)}"]`).forEach((node) => {
            node.textContent = String(count);
        });
        document.querySelectorAll(`[data-action="feed-react"][data-type="${CSS.escape(type)}"][data-id="${CSS.escape(id)}"]`).forEach((node) => {
            node.classList.toggle("liked", liked);
        });
    };
    // The same post can be held twice at once (a card in the list and the open post
    // screen). Updating only one of them let the other re-render the stale count.
    const holders = [
        feedState.items.find((entry) => entry.type === type && entry.id === id),
        feedState.post && feedState.post.id === id ? feedState.post : null
    ].filter(Boolean);
    const current = holders[0] || null;
    const button0 = button || document.querySelector(`[data-action="feed-react"][data-type="${CSS.escape(type)}"][data-id="${CSS.escape(id)}"]`);
    const wasLiked = current?.reactions ? Boolean(current.reactions.mine) : Boolean(button0 && button0.classList.contains("liked"));
    const baseCount = current?.reactions ? Number(current.reactions.count) || 0 : Number(button0?.querySelector("span")?.textContent) || 0;
    const optimistic = Math.max(0, baseCount + (wasLiked ? -1 : 1));

    // Update the model first so any re-render in flight already agrees with the UI.
    holders.forEach((holder) => { holder.reactions = { count: optimistic, mine: !wasLiked }; });
    paint(optimistic, !wasLiked);
    try {
        const answer = await storage.apiClient.toggleFeedReaction(type, id);
        holders.forEach((holder) => { holder.reactions = { count: answer.count, mine: Boolean(answer.mine) }; });
        paint(answer.count, Boolean(answer.mine));
    } catch (error) {
        holders.forEach((holder) => { holder.reactions = { count: baseCount, mine: wasLiked }; });
        paint(baseCount, wasLiked);
        toast("Не вдалося", friendlyError(error));
    }
}

// ---- Post detail ------------------------------------------------------
export function openPost(type, id) {
    window.location.hash = `#/post/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
}

export function postSection() {
    const target = state.postTarget;
    if (!target) {
        content(emptyInline("Пост не знайдено", "Повернись до стрічки."));
        return;
    }
    content(`<div class="grid dashboard-grid"><section class="span-12"><div id="postView"></div></section></div>`);
    renderPostView();
    if (!feedState.post || feedState.post.id !== target.id) {
        loadPost(target.type, target.id);
    }
}

async function loadPost(type, id) {
    if (!feedApiReady()) {
        feedState.postError = "Пост доступний лише онлайн.";
        renderPostView();
        return;
    }
    feedState.postLoading = true;
    feedState.postError = null;
    renderPostView();
    try {
        feedState.post = await storage.apiClient.fetchPost(type, id);
    } catch (error) {
        feedState.postError = friendlyError(error);
    } finally {
        feedState.postLoading = false;
        renderPostView();
    }
}

// A record and an achievement have no `title` of their own in the workout sense, so the
// post screen used to fall back to the literal word "Пост" with an empty caption.
function postHeadline(post) {
    if (post.type === "record") {
        return `Новий рекорд · ${post.exercise || "Вправа"}`;
    }
    if (post.type === "achievement") {
        return `Досягнення «${post.title || ""}»`;
    }
    return post.title || "Тренування";
}

/**
 * Who posted this, with the same framed avatar the rest of the app uses.
 *
 * The post screen was the one place a person appeared without their face — just a
 * name in a caption under the headline — which made the busiest screen in the app
 * the least recognisable.
 */
function postAuthorBlock(post) {
    const author = post.author || {};
    const local = author.id ? userById(author.id) : null;
    const person = local || {
        id: author.id,
        displayName: author.displayName,
        avatarInitials: initialsOf(author.displayName),
        avatarColor: "#2f3a44",
        avatarUrl: author.avatarUrl
    };
    const when = post.date ? formatDate(post.date) : timeAgo(post.createdAt);
    // A plain avatar, not the framed one. The level frame carries an aura and its own
    // wrapper sized for a profile header; dropped into a compact row it fights the
    // layout instead of decorating it.
    const meta = [author.displayName || "Учасник", when, post.workoutType ? workoutTypeLabel(post.workoutType) : ""].filter(Boolean).join(" · ");
    return `<div class="post-author">
            ${avatar(person, "tiny")}
            <div class="post-author-text">
                <h2 class="post-title-line">${escapeHtml(postHeadline(post))}</h2>
                <span class="post-author-meta">${escapeHtml(meta)}</span>
            </div>
        </div>`;
}

function postStatTile(icon, value, label) {
    return `<span class="post-stat"><i data-lucide="${icon}"></i><strong>${value}</strong><em>${escapeHtml(label)}</em></span>`;
}

/**
 * One exercise line, with the catalogue thumbnail.
 *
 * Matched by id when the payload carries one and by name otherwise, so a post
 * rendered from an older response still finds its picture.
 */
function postExerciseRow(entry) {
    const known = entry.exerciseId
        ? state.database.exercises.find((item) => item.id === entry.exerciseId)
        : null;
    const exercise = known || exerciseByName(entry.name);
    const detail = `${entry.sets} ${pluralUk(entry.sets, "підхід", "підходи", "підходів")}`
        + `${entry.topWeightKg ? ` · до ${number(entry.topWeightKg)} кг` : ""}`;
    return `<div class="post-ex">
            ${exerciseThumb(exercise)}
            <div class="post-ex-text">
                <span class="post-ex-name">${escapeHtml(entry.name)}</span>
                ${entry.muscleGroup ? `<span class="post-ex-muscle">${escapeHtml(entry.muscleGroup)}</span>` : ""}
            </div>
            <span class="post-ex-sets">${detail}</span>
        </div>`;
}

function renderPostView() {
    const host = element("postView");
    if (!host) {
        return;
    }
    if (feedState.postLoading) {
        host.innerHTML = feedSkeleton(1);
        return;
    }
    if (feedState.postError) {
        host.innerHTML = `<section class="card">${emptyInline("Не вдалося відкрити пост", feedState.postError)}<div class="action-row" style="justify-content:center;"><button class="button button-secondary compact" type="button" data-action="navigate" data-section="feed">До стрічки</button></div></section>`;
        iconsIn(host);
        return;
    }
    const post = feedState.post;
    if (!post) {
        return;
    }
    const liked = post.reactions && post.reactions.mine;
    const roots = threadComments(post.comments || []);
    host.innerHTML = `
            <section class="card post-head post-${post.type}">
                <div class="post-head-row">
                    <button class="icon-button" type="button" data-action="navigate" data-section="feed" aria-label="Назад"><i data-lucide="chevron-left"></i></button>
                    ${postAuthorBlock(post)}
                    <button class="icon-button" type="button" title="Поскаржитись" data-action="open-report" data-type="${post.type}" data-id="${post.id}"><i data-lucide="more-vertical"></i></button>
                </div>
                ${post.type === "workout" ? `<div class="post-stats">
                    ${postStatTile("boxes", number(post.volumeKg), "кг")}
                    ${postStatTile("list-checks", post.setCount, pluralUk(post.setCount, "підхід", "підходи", "підходів"))}
                    ${postStatTile("dumbbell", post.exerciseCount, pluralUk(post.exerciseCount, "вправа", "вправи", "вправ"))}
                    ${post.durationMinutes ? postStatTile("timer", post.durationMinutes, "хв") : ""}
                </div>
                <div class="post-exercises">${(post.exercises || []).map(postExerciseRow).join("")}</div>` : ""}
                ${post.type === "record" ? `<div class="feed-body feed-record-body"><span class="feed-record-ico"><i data-lucide="flame"></i></span><div><strong>${escapeHtml(post.exercise || "Вправа")}</strong><p class="card-caption">${number(post.weightKg)} кг${post.repetitions ? ` × ${post.repetitions}` : ""}${post.estimatedOneRepMax ? ` · 1ПМ ${number(post.estimatedOneRepMax)} кг` : ""}</p></div></div>` : ""}
                ${post.type === "achievement" ? `<div class="feed-body feed-ach-body"><span class="feed-ach-ico"><i data-lucide="award"></i></span><div><strong>${escapeHtml(post.title || "Досягнення")}</strong><p class="card-caption">${escapeHtml(post.description || "")}</p></div></div>` : ""}
                <div class="post-react-row">
                    <button class="feed-act big ${liked ? "liked" : ""}" type="button" data-action="feed-react" data-type="${post.type}" data-id="${post.id}"><i data-lucide="thumbs-up"></i><span data-like-count="${escapeHtml(`${post.type}:${post.id}`)}">${(post.reactions && post.reactions.count) || 0}</span></button>
                    ${post.type === "workout" ? `<button class="button button-secondary compact" type="button" data-action="copy-workout-start" data-workout-id="${post.id}"><i data-lucide="copy-plus"></i>Скопіювати</button>` : ""}
                </div>
            </section>
            <section class="card post-comments">
                <div class="card-header"><div><h3>Коменти</h3><p class="card-caption">${(post.comments || []).length} ${pluralUk((post.comments || []).length, "коментар", "коментарі", "коментарів")}</p></div></div>
                <div class="comment-list">${roots.length ? roots.map(commentNode).join("") : `<p class="card-caption">Ще ніхто не коментував. Будь першим.</p>`}</div>
                <div class="comment-composer">
                    <textarea id="commentInput" class="comment-input" rows="1" placeholder="Написати комент…"></textarea>
                    <button class="button button-primary comment-send" type="button" data-action="post-comment" aria-label="Надіслати"><i data-lucide="arrow-right"></i></button>
                </div>
            </section>`;
    iconsIn(host);
}

function commentNode(comment, isReply) {
    const author = comment.author || {};
    const local = author.id ? userById(author.id) : null;
    const avatarUser = local || { displayName: author.displayName, avatarInitials: initialsOf(author.displayName), avatarColor: "#2f3a44", avatarUrl: author.avatarUrl };
    const body = comment.body === null
        ? `<p class="comment-body hidden-note"><i data-lucide="eye-off"></i>Коментар приховано модератором</p>`
        : `<p class="comment-body">${escapeHtml(comment.body)}${comment.editedAt ? `<span class="comment-edited"> · змінено</span>` : ""}</p>`;
    const controls = `<div class="comment-controls">
            ${isReply ? "" : `<button class="comment-link" type="button" data-action="reply-comment" data-comment-id="${comment.id}" data-name="${escapeHtml(author.displayName || "")}">Відповісти</button>`}
            ${comment.mine ? `<button class="comment-link" type="button" data-action="edit-comment" data-comment-id="${comment.id}">Змінити</button><button class="comment-link danger" type="button" data-action="delete-comment" data-comment-id="${comment.id}">Видалити</button>` : `<button class="comment-link" type="button" data-action="open-report" data-type="comment" data-id="${comment.id}">Поскаржитись</button>`}
            ${comment.canModerate && !comment.mine ? `<button class="comment-link danger" type="button" data-action="delete-comment" data-comment-id="${comment.id}">Видалити (мод)</button>` : ""}
        </div>`;
    return `<article class="comment ${isReply ? "reply" : ""} ${comment.hidden ? "is-hidden" : ""}" data-comment-id="${comment.id}">
            ${avatar(avatarUser, "tiny")}
            <div class="comment-main">
                <div class="comment-head"><strong>${escapeHtml(author.displayName || "Учасник")}</strong>${comment.mine ? `<span class="comment-you">ти</span>` : ""}<span class="comment-time">${timeAgo(comment.createdAt)}</span></div>
                ${body}
                ${controls}
                ${(comment.replies || []).length ? `<div class="comment-replies">${comment.replies.map((reply) => commentNode(reply, true)).join("")}</div>` : ""}
            </div>
        </article>`;
}

// Optimistic comment: it appears immediately with a pending flag and is replaced
// by the server's row (real id, timestamps) when the request lands.
export async function submitComment() {
    const input = element("commentInput");
    const post = feedState.post;
    if (!input || !post) {
        return;
    }
    const body = String(input.value || "").trim();
    if (!body) {
        return;
    }
    const parentId = input.dataset.parentId || undefined;
    input.value = "";
    delete input.dataset.parentId;
    input.placeholder = "Написати комент…";
    const me = currentUser();
    const optimistic = {
        id: `pending-${Date.now()}`,
        parentId: parentId || null,
        body,
        hidden: false,
        editedAt: null,
        createdAt: new Date().toISOString(),
        author: { id: me.id, displayName: me.displayName, avatarUrl: me.avatarUrl },
        mine: true,
        canModerate: isAdmin(),
        pending: true
    };
    post.comments = [...(post.comments || []), optimistic];
    renderPostView();
    try {
        const created = await storage.apiClient.addFeedComment(post.type, post.id, { body, parentId });
        post.comments = post.comments.map((item) => (item.id === optimistic.id ? created : item));
    } catch (error) {
        post.comments = post.comments.filter((item) => item.id !== optimistic.id);
        toast("Комент не надіслано", friendlyError(error));
    } finally {
        renderPostView();
    }
}

export function replyToComment(commentId, name) {
    const input = element("commentInput");
    if (!input) {
        return;
    }
    input.dataset.parentId = commentId;
    input.placeholder = `Відповідь ${name || "у тред"}…`;
    input.focus();
}

export async function editCommentPrompt(commentId) {
    const post = feedState.post;
    const comment = (post?.comments || []).find((item) => item.id === commentId);
    if (!comment) {
        return;
    }
    const next = await promptDialog("Змінити коментар", comment.body || "");
    if (next === null) {
        return;
    }
    const clean = String(next).trim();
    if (!clean || clean === comment.body) {
        return;
    }
    const previous = comment.body;
    comment.body = clean;
    comment.editedAt = new Date().toISOString();
    renderPostView();
    try {
        await storage.apiClient.editFeedComment(commentId, clean);
    } catch (error) {
        comment.body = previous;
        renderPostView();
        toast("Не вдалося змінити", friendlyError(error));
    }
}

export async function removeComment(commentId) {
    const post = feedState.post;
    if (!post || !(await confirmDialog("Видалити цей коментар?", { confirmLabel: "Видалити" }))) {
        return;
    }
    const snapshot = post.comments;
    post.comments = post.comments.filter((item) => item.id !== commentId && item.parentId !== commentId);
    renderPostView();
    try {
        await storage.apiClient.deleteFeedComment(commentId);
    } catch (error) {
        post.comments = snapshot;
        renderPostView();
        toast("Не вдалося видалити", friendlyError(error));
    }
}

// ---- Reports ----------------------------------------------------------
export function openReportModal(targetType, targetId) {
    openModal(`<div class="modal-header"><div><h2>Поскаржитись</h2><p class="card-caption">Модератор побачить текст, автора й посилання.</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div>
            <div class="report-reasons">${Object.entries(REPORT_REASON_LABELS).map(([value, label], index) => `<label class="report-reason"><input type="radio" name="reportReason" value="${value}" ${index === 0 ? "checked" : ""}><span>${escapeHtml(label)}</span></label>`).join("")}</div>
            <div class="field" style="margin-top:12px;"><textarea id="reportDetails" rows="3" placeholder="Деталі (необовʼязково)"></textarea></div>
            <div class="form-actions" style="justify-content:flex-end;margin-top:16px;"><button class="button button-secondary" type="button" data-action="close-overlay">Скасувати</button><button class="button button-danger" type="button" data-action="submit-report" data-type="${escapeHtml(targetType)}" data-id="${escapeHtml(targetId)}"><i data-lucide="flag"></i>Надіслати скаргу</button></div>`);
}

export async function submitReport(targetType, targetId) {
    const checked = document.querySelector('input[name="reportReason"]:checked');
    const reason = checked ? checked.value : "other";
    const details = inputValue("reportDetails").trim();
    try {
        const answer = await storage.apiClient.reportContent({ targetType, targetId, reason, details: details || undefined });
        closeOverlay();
        toast(answer.duplicate ? "Скаргу вже надіслано" : "Скаргу надіслано", "Модератор перегляне найближчим часом.");
    } catch (error) {
        handleUserFacingError(error, "submit-report");
    }
}

// ---- Notifications ----------------------------------------------------
async function loadNotifications() {
    if (!feedApiReady()) {
        return;
    }
    feedState.notifications.loading = true;
    renderNotificationList();
    try {
        const answer = await storage.apiClient.fetchNotifications();
        feedState.notifications.items = answer.items || [];
        feedState.notifications.unread = answer.unread || 0;
        feedState.notifications.cursor = answer.nextCursor || null;
        feedState.notifications.loaded = true;
    } catch (error) {
        feedState.notifications.items = [];
    } finally {
        feedState.notifications.loading = false;
        renderNotificationList();
        renderShell();
    }
}

// Cheap poll so the bell badge is right without a socket. Replaced by a live
// channel once the backend moves off serverless.
export async function refreshUnreadCount() {
    if (!feedApiReady()) {
        return;
    }
    try {
        const answer = await storage.apiClient.fetchUnreadCount();
        if (answer.unread !== feedState.notifications.unread) {
            feedState.notifications.unread = answer.unread || 0;
            renderShell();
        }
    } catch (error) {
        // a failed badge refresh is not worth surfacing
    }
}

export function notifications() {
    content(`<div class="grid dashboard-grid">
            <section class="card span-12 feed-head">
                <div class="feed-head-row">
                    <div class="head-dup"><h2>Повідомлення</h2><p class="card-caption">Реакції, коменти й відповіді на твої пости.</p></div>
                    <button class="button button-secondary compact" type="button" data-action="mark-all-read"><i data-lucide="check-check"></i>Прочитати все</button>
                </div>
            </section>
            <section class="span-12"><div id="notificationList" class="notification-list"></div></section>
            <section class="card span-12 push-card">
                <div class="card-header"><div><h3>Що надсилати</h3><p class="card-caption">Пуші приходять, навіть коли застосунок закритий.</p></div><button class="button button-secondary compact" type="button" data-action="navigate" data-section="settings"><i data-lucide="settings"></i>Налаштувати</button></div>
            </section>
        </div>`);
    renderNotificationList();
    if (!feedState.notifications.loaded) {
        loadNotifications();
    }
}

function renderNotificationList() {
    const host = element("notificationList");
    if (!host) {
        return;
    }
    const items = feedState.notifications.items;
    if (feedState.notifications.loading && !items.length) {
        host.innerHTML = feedSkeleton(3);
        return;
    }
    if (!items.length) {
        host.innerHTML = `<div class="feed-state"><span class="feed-state-ico"><i data-lucide="inbox"></i></span><h3>Поки порожньо</h3><p class="card-caption">Тут зʼявляться реакції та коменти до твоїх тренувань.</p></div>`;
        iconsIn(host);
        return;
    }
    const buckets = { today: [], earlier: [] };
    items.forEach((item) => buckets[notificationBucket(item.createdAt)].push(item));
    host.innerHTML = ["today", "earlier"].map((bucket) => {
        if (!buckets[bucket].length) {
            return "";
        }
        return `<p class="notification-bucket">${bucket === "today" ? "Сьогодні" : "Раніше"}</p>${buckets[bucket].map(notificationRow).join("")}`;
    }).join("");
    iconsIn(host);
}

function notificationRow(item) {
    const actor = item.actor || null;
    const local = actor && actor.id ? userById(actor.id) : null;
    const avatarUser = local || (actor ? { displayName: actor.displayName, avatarInitials: initialsOf(actor.displayName), avatarColor: "#2f3a44", avatarUrl: actor.avatarUrl } : null);
    const clickable = item.targetType && item.targetId;
    return `<article class="notification ${item.read ? "" : "unread"}" ${clickable ? `data-action="open-post" data-type="${escapeHtml(item.targetType)}" data-id="${escapeHtml(item.targetId)}"` : ""}>
            <span class="notification-ico"><i data-lucide="${NOTIFICATION_ICONS[item.type] || "bell"}"></i></span>
            ${avatarUser ? avatar(avatarUser, "tiny") : ""}
            <div class="notification-main">
                <p class="notification-text">${escapeHtml(item.preview || "Нова активність")}</p>
                <span class="notification-time">${timeAgo(item.createdAt)}</span>
            </div>
            ${item.read ? "" : `<span class="notification-dot" aria-label="Непрочитане"></span>`}
        </article>`;
}

export async function markAllNotificationsRead() {
    feedState.notifications.items = feedState.notifications.items.map((item) => ({ ...item, read: true }));
    feedState.notifications.unread = 0;
    renderNotificationList();
    renderShell();
    try {
        await storage.apiClient.markNotificationsRead();
    } catch (error) {
        toast("Не вдалося оновити", friendlyError(error));
    }
}

// ---- Moderation queue (admin) ----------------------------------------
async function loadReports() {
    if (!feedApiReady() || !isAdmin()) {
        return;
    }
    feedState.reports.loading = true;
    try {
        const answer = await storage.apiClient.fetchReports();
        feedState.reports.items = answer.items || [];
        feedState.reports.loaded = true;
    } catch (error) {
        feedState.reports.items = [];
    } finally {
        feedState.reports.loading = false;
        renderSection();
    }
}

export function reportQueueSection() {
    if (!isAdmin()) {
        return "";
    }
    if (!feedState.reports.loaded && !feedState.reports.loading) {
        loadReports();
    }
    const items = feedState.reports.items;
    return `<section class="card span-12"><div class="card-header"><div><h2>Скарги на контент</h2><p class="card-caption">${items.length ? `${items.length} на розгляді` : "Нових скарг немає"}</p></div></div>
            ${items.length ? `<div class="report-list">${items.map(reportCard).join("")}</div>` : `<p class="card-caption">Порожньо — команда поводиться добре.</p>`}</section>`;
}

function reportCard(report) {
    const comment = report.comment;
    return `<article class="report-card">
            <div class="report-top"><span class="badge danger">Скарга</span><span class="card-caption">${escapeHtml(REPORT_REASON_LABELS[report.reason] || report.reason)} · ${report.reportCount} ${pluralUk(report.reportCount, "скаржник", "скаржники", "скаржників")} · ${timeAgo(report.createdAt)}</span></div>
            ${comment ? `<blockquote class="report-quote">«${escapeHtml(comment.body || "")}»</blockquote><p class="card-caption">Автор: ${escapeHtml(comment.author?.displayName || "—")}${comment.hidden ? " · вже приховано" : ""}</p>` : ""}
            <p class="card-caption">Обʼєкт: ${escapeHtml(REPORT_TARGET_LABELS[report.targetType] || report.targetType)}</p>
            ${report.details ? `<p class="card-caption report-details">${escapeHtml(report.details)}</p>` : ""}
            <div class="action-row wrap" style="margin-top:12px;">
                <button class="button button-secondary compact" type="button" data-action="open-post" data-type="${escapeHtml(report.postType || report.targetType)}" data-id="${escapeHtml(report.postId || report.targetId)}"><i data-lucide="external-link"></i>Відкрити</button>
                <button class="button button-secondary compact" type="button" data-action="resolve-report" data-report-id="${report.id}" data-resolve="keep">Залишити</button>
                <button class="button button-warning compact" type="button" data-action="resolve-report" data-report-id="${report.id}" data-resolve="hide">Приховати</button>
                <button class="button button-danger compact" type="button" data-action="resolve-report" data-report-id="${report.id}" data-resolve="delete">Видалити</button>
            </div>
        </article>`;
}

export async function resolveReport(reportId, action) {
    feedState.reports.items = feedState.reports.items.filter((item) => item.id !== reportId);
    renderSection();
    try {
        await storage.apiClient.resolveReport(reportId, action);
        toast("Готово", action === "keep" ? "Скаргу відхилено." : action === "hide" ? "Контент приховано." : "Контент видалено.");
    } catch (error) {
        feedState.reports.loaded = false;
        loadReports();
        toast("Не вдалося", friendlyError(error));
    }
}

// ---- Web Push ---------------------------------------------------------
async function ensurePushKey() {
    if (feedState.pushKey !== null) {
        return feedState.pushKey;
    }
    try {
        const answer = await storage.apiClient.fetchPushKey();
        feedState.pushKey = answer.configured ? answer.publicKey : "";
    } catch (error) {
        feedState.pushKey = "";
    }
    return feedState.pushKey;
}

export async function enablePush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        toast("Не підтримується", "Цей браузер не вміє пуш-сповіщення.");
        return false;
    }
    const key = await ensurePushKey();
    if (!key) {
        toast("Пуші вимкнено", "Ключі сповіщень ще не налаштовані на сервері.");
        return false;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
        toast("Дозвіл не надано", "Увімкни сповіщення в налаштуваннях браузера.");
        return false;
    }
    try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        const subscription = existing || await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(key)
        });
        const raw = subscription.toJSON();
        await storage.apiClient.pushSubscribe({ endpoint: subscription.endpoint, p256dh: raw.keys.p256dh, auth: raw.keys.auth });
        setPref("pushEnabled", "1");
        toast("Пуші увімкнено", "Сповіщатимемо про коменти й реакції на твої пости.");
        renderSection();
        return true;
    } catch (error) {
        toast("Не вдалося увімкнути", friendlyError(error));
        return false;
    }
}

export async function disablePush() {
    try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
            await storage.apiClient.pushUnsubscribe(subscription.endpoint);
            await subscription.unsubscribe();
        }
    } catch (error) {
        // the server row is what matters; a stale browser subscription is pruned
        // server-side on the first failed delivery
    }
    setPref("pushEnabled", "0");
    renderSection();
}

export function togglePushCategory(key, enabled) {
    const current = readPushPrefs();
    current[key] = enabled;
    setPref("pushCategories", JSON.stringify(current));
}

function readPushPrefs() {
    try {
        const parsed = JSON.parse(getPref("pushCategories") || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
        return {};
    }
}

export function pushSettingsSection() {
    const enabled = getPref("pushEnabled") === "1";
    const prefs = readPushPrefs();
    const rows = PUSH_CATEGORIES.map((category) => {
        const on = prefs[category.key] === undefined ? category.defaultOn : prefs[category.key] === true;
        return settingsRow(category.label, `<label class="settings-switch"><input type="checkbox" data-action="push-toggle" data-key="${category.key}" ${on ? "checked" : ""} ${enabled ? "" : "disabled"} aria-label="${escapeHtml(category.label)}"><span></span></label>`);
    });
    const master = settingsRow("Пуш-сповіщення", `<button class="button ${enabled ? "button-secondary" : "button-primary"} compact" type="button" data-action="${enabled ? "disable-push" : "enable-push"}"><i data-lucide="${enabled ? "bell-off" : "bell"}"></i>${enabled ? "Вимкнути" : "Увімкнути"}</button>`, {
        hint: enabled ? "Приходять, навіть коли застосунок закритий" : "Увімкни, щоб керувати категоріями"
    });
    return settingsGroup("Сповіщення", [master, ...(enabled ? rows : [])]);
}

// ---- Achievement bridge ----------------------------------------------
// Achievements are computed on this side; the server needs them to build the
// "Досягнення" scope. Fire-and-forget, deduped by the server.
// Personal records are computed here, not on the server, so the "Рекорди" scope has
// nothing to show unless we push them up. Best effort and idempotent: the server keeps
// only an improvement, so replaying the whole list never walks a record backwards.
export async function syncRecordsToFeed() {
    if (!feedApiReady()) {
        return;
    }
    try {
        const own = currentUser().id;
        const items = recordsFor(own).slice(0, 40).map((record) => ({
            exerciseId: record.exerciseId,
            weightKg: Number(record.weight) || 0,
            repetitions: Number(record.repetitions) || undefined,
            estimatedOneRepMax: Number(record.estimatedOneRepMax) || undefined,
            workoutId: record.workoutId || undefined,
            isEstimated: Boolean(record.isEstimated),
            // The record belongs next to the session that set it — a bare date would
            // land at midnight and tie with every achievement unlocked that day.
            recordedAt: record.date ? new Date(`${String(record.date).slice(0, 10)}T20:00:00`).toISOString() : undefined
        })).filter((item) => item.exerciseId && item.weightKg > 0);
        if (items.length) {
            await storage.apiClient.syncRecords(items);
        }
    } catch (error) {
        // best effort — the feed simply shows fewer record posts
    }
}

export async function syncAchievementsToFeed() {
    if (!feedApiReady()) {
        return;
    }
    try {
        const unlocked = userAchievements(currentUser().id)
            .filter((item) => item.unlockedAt)
            .map((item) => ({
                key: item.id,
                title: item.title,
                description: item.caption || "",
                unlockedAt: new Date(item.unlockedAt).toISOString()
            }));
        if (unlocked.length) {
            await storage.apiClient.syncAchievements(unlocked.slice(0, 60));
        }
    } catch (error) {
        // best effort — the feed simply shows fewer achievement posts
    }
}
