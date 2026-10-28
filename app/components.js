// Shared small renderers: metrics, cards, reactions, moderation / admin panels, user cards, exercise media.
import { escapeHtml, number, formatDate, imageUrl } from "../lib/format.js";
import { achievementBadges, impersonateButton, infoTip, sectionHeading } from "./account-admin.js";
import { storage } from "./data.js";
import { muscleIcon } from "./exercise-picker.js";
import { reportQueueSection } from "./feed.js";
import {
    adminEmails, avatar, canEditExercise, currentUser, exerciseById, exerciseOwnerName, isAdmin, isMyExercise,
    roleLabel, statusLabel, userById, workoutCardioMinutes, workoutNumber, workoutSetCount, workoutStatusOf,
    workoutTypeLabel, workoutsFor
} from "./model.js";
import { content, handleUserFacingError, toast } from "./overlays.js";
import { partnerProfileCta } from "./partner.js";
import { persist } from "./persistence.js";
import { detailHiddenFor, isWorkoutPrivate, lockedMetric, subscribeButton } from "./privacy.js";
import { framedAvatar, levelBadge, userLevel } from "./progression.js";
import { defaultSection } from "./router.js";
import { userStats } from "./scoring-bridge.js";
import { roleStatusBadge } from "./settings.js";
import { renderSection } from "./shell.js";
import { state } from "./state.js";
import { byDateDesc } from "./util.js";
import { durationOf, workoutExerciseCount, workoutHistoryList, workoutVolumeOf } from "./workout-history.js";
import { MONTH_SHORT, pluralUk, weekdayLabel } from "./workout-screen.js";

// ---- Skeletons -------------------------------------------------------------
// Each mirrors the real component's wrapper class and span so the placeholder
// occupies exactly the space the content will. A skeleton that is the wrong size
// is worse than none: the page reflows the moment data lands.
//
// The container carries aria-busy, so screen readers hear "busy" instead of
// reading out a fake structure. The shapes themselves are decorative.

// Appended below an existing list while the next page is in flight, so the rows
// already on screen stay put and readable.
export function skeletonMore(rows = 2) {
    const row = `<div class="sk-row"><span class="sk sk-avatar"></span><div class="sk-row-main"><span class="sk sk-line wide"></span><span class="sk sk-line short"></span></div></div>`;
    return `<div class="sk-wrap sk-more" aria-busy="true">${row.repeat(rows)}</div>`;
}

export function metric(title, value, icon, caption, span = "span-3", tip = "") {
    // Compact stat tile: icon + value + label. caption kept in the signature
    // for callers but rendered as a title attr only (minimalist, less height).
    const isText = typeof value === "string" && !/\d/.test(value) && value.trim().length > 6;
    return `<section class="metric-card ${span}${isText ? " is-text" : ""}"${caption ? ` title="${escapeHtml(caption)}"` : ""}><span class="metric-icon"><i data-lucide="${icon}"></i></span><div class="metric-body"><div class="metric-value">${escapeHtml(String(value))}</div><div class="metric-label"><span class="metric-label-text">${escapeHtml(title)}</span>${tip ? infoTip(title, tip) : ""}</div></div></section>`;
}

/** Volume as it fits a tile: up to 999 999 in full, then «1,76 млн кг». */
export function compactKg(value) {
    const kg = Number(value) || 0;
    if (kg >= 1000000) {
        return `${String(Math.round(kg / 10000) / 100).replace(".", ",")} млн кг`;
    }
    return `${number(kg)} кг`;
}

export function chartCard(title, caption, canvasId, span, tip = "") {
    return `<section class="card ${span} chart-card"><div class="card-header"><div>${sectionHeading(title, tip)}<p class="card-caption">${escapeHtml(caption)}</p></div></div><div class="chart-box"><canvas id="${canvasId}"></canvas></div></section>`;
}

function kpi(items) {
    return `<div class="kpi-strip">${items.map((item) => `<div class="kpi-item"><div class="kpi-value">${escapeHtml(String(item.value))}</div><div class="kpi-label">${escapeHtml(item.label)}</div></div>`).join("")}</div>`;
}

// Compact inline stat strip (small icon + value + muted label) for workout cards
// and the detail drawer — replaces the oversized KPI blocks there.
export function workoutStatStrip(items) {
    return `<div class="wstat-strip">${items.map((item) => `<span class="wstat"><i data-lucide="${item.icon}"></i><strong>${escapeHtml(String(item.value))}</strong>${item.label ? `<span class="wstat-lbl">${escapeHtml(item.label)}</span>` : ""}</span>`).join("")}</div>`;
}

export function recordCard(record) {
    return `<article class="activity-item"><div class="activity-dot"></div><div><strong>${escapeHtml(record.exercise.name)}</strong><p class="card-caption">${number(record.estimatedOneRepMax)} кг розрах. 1ПМ · ${record.weight} кг × ${record.repetitions} · ${formatDate(record.date)}</p></div></article>`;
}

export function exerciseCard(exercise) {
    const pending = exercise.status === "pending";
    const canEdit = canEditExercise(exercise);
    const added = exercise.createdAt ? formatDate(exercise.createdAt) : "";
    const owner = exercise.createdByUserId ? userById(exercise.createdByUserId) : null;
    const ownerName = exerciseOwnerName(exercise);
    const badges = `${isMyExercise(exercise) ? `<span class="pill-badge mine"><i data-lucide="bookmark-check"></i>Моя</span>` : ""}${pending ? `<span class="pill-badge pending"><i data-lucide="clock"></i>На модерації</span>` : ""}`;
    // Thumb is always present now (gif or muscle placeholder), so badges overlay it.
    const overlay = badges ? `<div class="exercise-card-tags">${badges}</div>` : "";
    const actions = canEdit
        ? `<div class="exercise-card-actions">${pending && isAdmin() ? `<button class="icon-button success" type="button" title="Схвалити" data-action="approve-exercise" data-exercise-id="${exercise.id}"><i data-lucide="check"></i></button>` : ""}<button class="icon-button" type="button" title="Редагувати" data-action="edit-exercise" data-exercise-id="${exercise.id}"><i data-lucide="pen-line"></i></button><button class="icon-button danger" type="button" title="Видалити" data-action="delete-exercise" data-exercise-id="${exercise.id}"><i data-lucide="trash-2"></i></button></div>`
        : "";
    const meta = `<div class="exercise-meta" title="${escapeHtml(ownerName)}${added ? ` · ${added}` : ""}">${owner ? avatar(owner, "tiny") : `<span class="exercise-meta-fallback"><i data-lucide="user-round"></i></span>`}<div class="exercise-meta-text"><span class="exercise-meta-name">${escapeHtml(ownerName)}</span>${added ? `<span class="exercise-meta-date">${added}</span>` : ""}</div></div>`;
    return `<article class="exercise-card has-thumb${pending ? " is-pending" : ""}${exercise.myReaction === "dislike" ? " is-disliked" : ""}" data-action="open-exercise" data-exercise-id="${exercise.id}">${exerciseThumb(exercise)}${overlay}<div class="exercise-card-body"><h3>${escapeHtml(exercise.name)}</h3><p class="card-caption exercise-card-desc">${escapeHtml(exercise.description)}</p><div class="tag-row">${exercise.isTimed ? `<span class="chip chip-timed"><i data-lucide="timer"></i>На час</span>` : ""}<span class="chip">${escapeHtml(exercise.primaryMuscleGroup)}</span><span class="chip">${escapeHtml(exercise.movementPattern)}</span><span class="chip">${escapeHtml(exercise.equipment)}</span></div></div><div class="exercise-card-footer">${meta}${actions}</div>${reactionBar(exercise)}</article>`;
}

// Like / dislike controls + shared counts. Lives in its own bottom row so it
// never collides with the admin edit/delete panel. Tapping a button is its own
// action (data-action wins over the card's open-exercise via closest()).
export function reactionBar(exercise) {
    const mine = exercise.myReaction || null;
    return `<div class="exercise-card-reactions">
            <button class="react-btn like${mine === "like" ? " active" : ""}" type="button" data-action="react-exercise" data-exercise-id="${exercise.id}" data-reaction="like" aria-pressed="${mine === "like"}" aria-label="Подобається"><i data-lucide="thumbs-up"></i><span class="react-count">${exercise.likeCount || 0}</span></button>
            <button class="react-btn dislike${mine === "dislike" ? " active" : ""}" type="button" data-action="react-exercise" data-exercise-id="${exercise.id}" data-reaction="dislike" aria-pressed="${mine === "dislike"}" aria-label="Не подобається"><i data-lucide="thumbs-down"></i><span class="react-count">${exercise.dislikeCount || 0}</span></button>
        </div>`;
}

function applyReactionLocally(exercise, next) {
    const previous = exercise.myReaction || "none";
    if (previous === "like") {
        exercise.likeCount = Math.max(0, (exercise.likeCount || 0) - 1);
    }
    if (previous === "dislike") {
        exercise.dislikeCount = Math.max(0, (exercise.dislikeCount || 0) - 1);
    }
    if (next === "like") {
        exercise.likeCount = (exercise.likeCount || 0) + 1;
    }
    if (next === "dislike") {
        exercise.dislikeCount = (exercise.dislikeCount || 0) + 1;
    }
    exercise.myReaction = next === "none" ? null : next;
}

// Update the card's buttons/counts in place — no re-sort, so the card doesn't
// jump under the finger. The liked-first order applies on the next list render.
function updateReactionUI(exercise) {
    document.querySelectorAll(`.react-btn[data-exercise-id="${exercise.id}"]`).forEach((button) => {
        const reaction = button.dataset.reaction;
        const active = exercise.myReaction === reaction;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
        const count = button.querySelector(".react-count");
        if (count) {
            count.textContent = reaction === "like" ? (exercise.likeCount || 0) : (exercise.dislikeCount || 0);
        }
    });
    document.querySelectorAll(`.exercise-card[data-exercise-id="${exercise.id}"]`).forEach((card) => {
        card.classList.toggle("is-disliked", exercise.myReaction === "dislike");
    });
}

const reactingExerciseIds = new Set();

export async function reactToExercise(exerciseId, reaction) {
    const exercise = exerciseById(exerciseId);
    if (!exercise || (reaction !== "like" && reaction !== "dislike")) {
        return;
    }
    // Serialize per exercise: ignore taps while a request is in flight so two
    // out-of-order responses can't leave the card in a stale/divergent state.
    if (reactingExerciseIds.has(exerciseId)) {
        return;
    }
    const previous = { myReaction: exercise.myReaction || null, likeCount: exercise.likeCount || 0, dislikeCount: exercise.dislikeCount || 0 };
    const next = exercise.myReaction === reaction ? "none" : reaction;
    reactingExerciseIds.add(exerciseId);
    applyReactionLocally(exercise, next);
    updateReactionUI(exercise);
    try {
        if (storage.mode === "api" && storage.apiClient.hasBaseUrl()) {
            const result = await storage.apiClient.reactExercise(exerciseId, next);
            exercise.likeCount = result.likeCount;
            exercise.dislikeCount = result.dislikeCount;
            exercise.myReaction = result.myReaction || null;
            updateReactionUI(exercise);
        } else {
            await persist({ silent: true });
        }
    } catch (error) {
        exercise.myReaction = previous.myReaction;
        exercise.likeCount = previous.likeCount;
        exercise.dislikeCount = previous.dislikeCount;
        updateReactionUI(exercise);
        handleUserFacingError(error, "react-exercise");
    } finally {
        reactingExerciseIds.delete(exerciseId);
    }
}

export function pendingExercises() {
    return state.database.exercises.filter((exercise) => exercise.status === "pending");
}

function approvalQueueCard() {
    const items = pendingExercises();
    const rows = items.length
        ? items.map((exercise) => `<div class="approval-row">${exerciseThumb(exercise)}<div class="approval-info"><strong>${escapeHtml(exercise.name)}</strong><p class="card-caption">${escapeHtml(exerciseOwnerName(exercise))}${exercise.createdAt ? ` · ${formatDate(exercise.createdAt)}` : ""} · ${escapeHtml(exercise.primaryMuscleGroup)}</p></div><div class="approval-actions"><button class="icon-button" type="button" title="Огляд" data-action="open-exercise" data-exercise-id="${exercise.id}"><i data-lucide="eye"></i></button><button class="icon-button success" type="button" title="Схвалити" data-action="approve-exercise" data-exercise-id="${exercise.id}"><i data-lucide="check"></i></button><button class="icon-button danger" type="button" title="Відхилити" data-action="reject-exercise" data-exercise-id="${exercise.id}"><i data-lucide="x"></i></button></div></div>`).join("")
        : emptyInline("Черга порожня", "Нові та відредаговані вправи учасників з'являтимуться тут.");
    return `<section class="card span-12 approval-card"><div class="card-header"><div><h2>Модерація вправ ${items.length ? `<span class="badge pending">${items.length}</span>` : ""}</h2><p class="card-caption">Підтверджуй нові та відредаговані вправи учасників команди.</p></div></div><div class="approval-list">${rows}</div></section>`;
}

// Dedicated admin section (in the nav, with a live count badge like Ідеї) so the
// moderation queue no longer clutters the profile page.
export function moderation() {
    if (!isAdmin()) {
        state.section = defaultSection();
        renderSection();
        return;
    }
    content(`<div class="grid dashboard-grid">${reportQueueSection()}${approvalQueueCard()}${contributorCard()}</div>`);
}

function exerciseContributors() {
    const counts = new Map();
    state.database.exercises.forEach((exercise) => {
        if (!exercise.createdByUserId) {
            return;
        }
        counts.set(exercise.createdByUserId, (counts.get(exercise.createdByUserId) || 0) + 1);
    });
    return [...counts.entries()]
        .map(([id, count]) => ({ user: userById(id), count }))
        .filter((row) => row.user)
        .sort((left, right) => right.count - left.count);
}

export function contributorCard() {
    const rows = exerciseContributors();
    const max = rows.length ? rows[0].count : 1;
    const body = rows.length
        ? rows.slice(0, 8).map((row, index) => `<div class="contrib-row"><span class="contrib-rank">${index + 1}</span>${avatar(row.user)}<div class="contrib-main"><strong>${escapeHtml(row.user.displayName)}</strong><div class="contrib-bar"><span style="width:${Math.max(6, Math.round((row.count / max) * 100))}%"></span></div></div><span class="contrib-count">${row.count}</span></div>`).join("")
        : emptyInline("Поки немає даних", "Додай вправи, щоб побачити рейтинг авторів.");
    return `<section class="card span-12"><div class="card-header"><div><h2>Автори вправ</h2><p class="card-caption">Хто скільки вправ додав у каталог (${state.database.exercises.length} усього).</p></div></div><div class="contrib-list">${body}</div></section>`;
}

function roleRank(role) {
    return ({ admin: 3, premium: 2, free: 1 })[String(role || "free").toLowerCase()] || 0;
}

function adminUserRow(user) {
    const summary = userStats(user.id);
    const exCount = state.database.exercises.filter((exercise) => exercise.createdByUserId === user.id).length;
    const isSuper = adminEmails.has(String(user.email || "").toLowerCase());
    const role = isSuper ? "admin" : String(user.role || "free").toLowerCase();
    const roleControl = isSuper
        ? `<span class="role-badge admin admin-owner-badge"><i data-lucide="shield"></i>Власник</span>`
        : `<label class="admin-role-field"><span class="admin-role-label">Роль</span><gym-select class="admin-role-select" data-action="set-role" data-user-id="${user.id}">${[["free", "Free"], ["premium", "PRO"], ["admin", "Адмін"]].map(([value, label]) => `<option value="${value}" ${role === value ? "selected" : ""}>${label}</option>`).join("")}</gym-select></label>`;
    const approveControl = user.approved === false
        ? `<button class="button button-primary compact" type="button" data-action="approve-user" data-user-id="${user.id}"><i data-lucide="check"></i>Дозволити</button>`
        : (isSuper ? "" : `<button class="button button-secondary compact" type="button" data-action="revoke-user" data-user-id="${user.id}"><i data-lucide="user-x"></i>Відкликати</button>`);
    return `<div class="admin-user-row"><div class="admin-user-main">${avatar(user)}<div class="admin-user-info"><strong>${escapeHtml(user.displayName || "—")}${user.approved === false ? ` <span class="badge pending">очікує</span>` : ""}</strong><p class="card-caption admin-user-email">${escapeHtml(user.email || "—")}</p><p class="card-caption">${summary.completedWorkouts} трен · ${exCount} вправ</p></div></div><div class="admin-user-controls">${roleControl}${approveControl}</div></div>`;
}

export function adminPanel() {
    const users = state.database.users.slice().sort((left, right) => roleRank(right.role) - roleRank(left.role) || String(left.displayName || "").localeCompare(String(right.displayName || "")));
    const isSuper = (user) => adminEmails.has(String(user.email || "").toLowerCase());
    const pendingUsers = users.filter((user) => user.approved === false);
    const counts = {
        total: users.length,
        premium: users.filter((user) => String(user.role).toLowerCase() === "premium").length,
        admin: users.filter((user) => String(user.role).toLowerCase() === "admin" || isSuper(user)).length,
        pending: pendingUsers.length
    };
    const pendingEx = pendingExercises();
    content(`<div class="grid dashboard-grid">
            <section class="card span-12"><div class="card-header"><div><h2>Адмін-панель</h2><p class="card-caption">Доступи, ролі та модерація GymOS в одному місці.</p></div></div>${workoutStatStrip([{ icon: "users", value: counts.total, label: "користувачі" }, { icon: "crown", value: counts.premium, label: "PRO" }, { icon: "shield", value: counts.admin, label: "адміни" }, { icon: "user-check", value: counts.pending, label: "на апруві" }, { icon: "dumbbell", value: state.database.exercises.length, label: "вправи" }, { icon: "shield-check", value: pendingEx.length, label: "на модерації" }])}</section>
            ${pendingUsers.length ? `<section class="card span-12 approval-card"><div class="card-header"><div><h2>Нові користувачі <span class="badge pending">${pendingUsers.length}</span></h2><p class="card-caption">Підтверди доступ до застосунку.</p></div></div><div class="admin-user-list">${pendingUsers.map(adminUserRow).join("")}</div></section>` : ""}
            <section class="card span-12"><div class="card-header"><div><h2>Користувачі та ролі</h2><p class="card-caption">Free · PRO (безліміт) · Адмін. Зміни застосовуються одразу.</p></div></div><div class="admin-user-list">${users.map(adminUserRow).join("")}</div></section>
            ${pendingEx.length ? approvalQueueCard() : ""}
        </div>`);
}

export async function setUserRole(userId, role) {
    if (!isAdmin()) {
        toast("Немає прав", "Лише адміністратор може змінювати ролі.");
        return;
    }
    const user = userById(userId);
    if (storage.mode === "api" && storage.apiClient.hasBaseUrl()) {
        await storage.apiClient.setUserRole(userId, role);
    }
    if (user) {
        user.role = role;
        if (role === "premium" || role === "admin") {
            user.approved = true;
        }
    }
    renderSection();
    toast("Роль оновлено", `${user?.displayName || "Користувач"} → ${roleLabel(role)}`);
}

export function userCard(user) {
    const summary = userStats(user.id);
    const info = userLevel(user.id);
    const isCurrent = user.id === currentUser().id;
    return `<article class="user-card" data-action="open-user" data-user-id="${user.id}"><div class="list-row">${framedAvatar(user, "xl", info.level)}<div><h3>${escapeHtml(user.displayName)}</h3><p class="card-caption">${escapeHtml(user.trainingGoal || "")}</p></div></div><div style="margin-top:14px;">${workoutStatStrip([{ icon: "calendar-check", value: summary.completedWorkouts, label: "трен." }, { icon: "boxes", value: `${number(summary.totalVolume)} кг` }, { icon: "heart-pulse", value: `${summary.cardioMinutes} хв`, label: "кардіо" }])}</div><div class="tag-row" style="margin-top:12px;">${levelBadge(info)}<span class="badge ${isCurrent ? "unlocked" : "locked"}">${isCurrent ? "Це ви" : "Учасник"}</span>${roleStatusBadge(user)}</div></article>`;
}

export function userDetail(userId) {
    const user = userById(userId);
    if (!user) {
        content(`<section class="card">${emptyInline("Користувача не знайдено", "Поверніться до команди.")}<div class="action-row" style="justify-content:center;margin-top:12px;"><button class="button button-secondary compact" type="button" data-action="navigate" data-section="users"><i data-lucide="arrow-left"></i>Команда</button></div></section>`);
        return;
    }
    const summary = userStats(user.id);
    const info = userLevel(user.id);
    const isCurrent = user.id === currentUser().id;
    const history = workoutsFor(user.id).sort(byDateDesc);
    // The server DELETES the detail-derived stats for a member this viewer may not
    // see, rather than zeroing them — a zero would claim they had lifted nothing.
    // Their absence is the signal to draw a lock instead of a number.
    const hidden = !isCurrent && detailHiddenFor(user.id);
    content(`<div class="grid dashboard-grid"><section class="card span-12"><div class="profile-header"><div class="list-row profile-identity">${framedAvatar(user, "large", info.level)}<div class="profile-headline"><h2>${escapeHtml(user.displayName)}</h2><div class="profile-badges">${levelBadge(info, { link: isCurrent })}${roleStatusBadge(user)}<span class="badge accent">${escapeHtml(user.trainingGoal || "Учасник")}</span>${isCurrent ? `<span class="badge unlocked">Це ви</span>` : ""}</div><p class="card-caption">${escapeHtml(user.name || "")}${user.bodyweight ? ` · ${user.bodyweight} кг` : ""}${user.height ? ` · ${user.height} см` : ""}${user.trainingExperience ? ` · ${escapeHtml(user.trainingExperience)}` : ""}</p></div></div><div class="inline-actions wrap user-detail-actions">${partnerProfileCta(user, isCurrent)}${subscribeButton(user, isCurrent)}${impersonateButton(user, isCurrent)}<button class="button button-secondary compact" type="button" data-action="navigate" data-section="users"><i data-lucide="arrow-left"></i>До команди</button></div></div>${achievementBadges(user.id)}</section><section class="card span-12"><div class="card-header"><div><h2>Тренування</h2><p class="card-caption">${isCurrent ? "Твої сесії." : "Сесії учасника. Натисни, щоб відкрити деталі."}</p></div></div><div class="activity-feed">${workoutHistoryList(history.slice(0, 20))}</div></section>${hidden
        ? `${metric("Тренування", summary.completedWorkouts ?? 0, "calendar-check", "Завершено", "span-3")}${metric("Серія", `${summary.trainingStreak ?? 0}`, "flame", "днів поспіль", "span-3")}${lockedMetric("Обсяг", "span-3")}${lockedMetric("Підходи", "span-3")}`
        : `${metric("Тренування", summary.completedWorkouts, "calendar-check", "Завершено", "span-3")}${metric("Загальний обсяг", compactKg(summary.totalVolume), "boxes", "Усі підходи", "span-3")}${metric("Підходи", summary.totalSets, "list-checks", `${summary.workingSets} робочих`, "span-3")}${metric("Кардіо", `${summary.cardioMinutes} хв`, "heart-pulse", `${summary.cardioDistance} км`, "span-3")}`}</div>`);
}

export function exerciseMedia(exercise) {
    const direct = imageUrl(exercise?.mediaUrl);
    if (direct) {
        return direct;
    }
    const references = Array.isArray(exercise?.mediaReferences) ? exercise.mediaReferences : [];
    for (const reference of references) {
        const candidate = typeof reference === "string" ? reference : (reference?.url || reference?.src || reference?.href || "");
        const url = imageUrl(candidate);
        if (url) {
            return url;
        }
    }
    return "";
}

export function exerciseThumb(exercise) {
    const url = exerciseMedia(exercise);
    // Always render a thumb: a muscle-group silhouette placeholder sits behind the
    // gif, so an exercise with no media (or a gif that fails to load) still shows a
    // consistent preview instead of collapsing to a text-only card.
    const placeholder = `<span class="exercise-thumb-ph" aria-hidden="true">${muscleIcon(exercise.primaryMuscleGroup)}</span>`;
    if (!url) {
        return `<div class="exercise-thumb is-placeholder">${placeholder}</div>`;
    }
    return `<div class="exercise-thumb">${placeholder}<img src="${escapeHtml(url)}" alt="${escapeHtml(exercise.name)}" referrerpolicy="no-referrer" loading="lazy" decoding="async" onerror="this.closest('.exercise-thumb')?.classList.add('is-placeholder'); this.remove();"></div>`;
}

export function media(exercise) {
    const url = exerciseMedia(exercise);
    if (url) {
        return `<div class="media-placeholder has-media"><img src="${escapeHtml(url)}" alt="Демонстрація вправи ${escapeHtml(exercise.name)}" referrerpolicy="no-referrer" loading="lazy" decoding="async" onerror="this.closest('.media-placeholder')?.classList.remove('has-media'); this.remove();"></div>`;
    }
    return `<div class="media-placeholder"><div class="media-placeholder-label">Місце для майбутнього GIF/WebP демо · анімований placeholder</div></div>`;
}

export function exerciseSourceBlock(exercise) {
    if (!exercise.sourceName) {
        return "";
    }
    const sourceText = exercise.sourceName === "ExRx.net" ? "Джерело: ExRx.net" : `Джерело: ${exercise.sourceName}`;
    return `<div class="source-strip"><span>${escapeHtml(sourceText)}</span>${exercise.sourceUrl ? `<a href="${escapeHtml(exercise.sourceUrl)}" target="_blank" rel="noreferrer">Відкрити джерело</a>` : ""}<span>Медіа збережено лише як reference metadata.</span></div>`;
}

export function emptyInline(title, caption) {
    return `<div class="empty-state"><i data-lucide="sparkles"></i><h3>${escapeHtml(title)}</h3><p>${escapeHtml(caption)}</p></div>`;
}

// One row shape for every history list (dashboard feed, calendar, stats, profile).
// Leads with a calendar tile + weekday + workout TYPE instead of the meaningless
// "Тренування #N" title; the number survives as a muted tag. Reads only the
// shape-agnostic accessors, so a peer summary renders identically to a hydrated row.
export function historyRow(workoutItem, options = {}) {
    const owner = userById(workoutItem.userId);
    const day = String(workoutItem.date).slice(0, 10);
    const parsed = new Date(`${day}T00:00:00`);
    const exercises = workoutExerciseCount(workoutItem);
    const sets = workoutSetCount(workoutItem);
    const cardio = workoutCardioMinutes(workoutItem);
    // A private row carries no aggregates at all, and every accessor above falls back
    // to 0 — so without this branch somebody else's session reads as "0 кг · 0 вправ",
    // which looks like a failed workout rather than a hidden one.
    const stats = isWorkoutPrivate(workoutItem)
        ? [`<span class="hist-private"><i data-lucide="lock"></i>Деталі приховані</span>`, `${durationOf(workoutItem)} хв`].filter(Boolean).join(" · ")
        : [
            `${number(workoutVolumeOf(workoutItem))} кг`,
            `${exercises} ${pluralUk(exercises, "вправа", "вправи", "вправ")}`,
            `${sets} ${pluralUk(sets, "підхід", "підходи", "підходів")}`,
            cardio ? `${cardio} хв кардіо` : "",
            `${durationOf(workoutItem)} хв`
        ].filter(Boolean).join(" · ");
    const ownerChip = options.showOwner && owner
        ? `<button class="hist-owner" type="button" data-action="open-user" data-user-id="${owner.id}">${avatar(owner, "tiny")}${escapeHtml(owner.displayName)}</button>`
        : "";
    // "Завершено" is the norm in a history list — only the exceptions earn a badge.
    const statusBadge = workoutItem.status === "completed"
        ? ""
        : `<span class="status-badge ${workoutStatusOf(workoutItem)}">${statusLabel(workoutStatusOf(workoutItem))}</span>`;
    return `<article class="hist-row status-${workoutStatusOf(workoutItem)}" data-action="open-workout" data-workout-id="${workoutItem.id}">
            <div class="hist-date" aria-hidden="true"><span class="hist-day">${parsed.getDate()}</span><span class="hist-mon">${MONTH_SHORT[parsed.getMonth()] || ""}</span></div>
            <div class="hist-main">
                <div class="hist-top"><strong class="hist-weekday">${weekdayLabel(day)}</strong><span class="chip hist-type">${workoutTypeLabel(workoutItem.workoutType)}</span>${statusBadge}<span class="hist-num">#${workoutNumber(workoutItem)}</span>${ownerChip}</div>
                <p class="hist-stats">${stats}</p>
            </div>
            <div class="hist-actions">
                <button class="icon-button hist-copy" type="button" title="Скопіювати й почати таке саме" aria-label="Скопіювати й почати таке саме" data-action="copy-workout-start" data-workout-id="${workoutItem.id}"><i data-lucide="copy-plus"></i></button>
                <button class="button button-secondary compact hist-open" type="button" data-action="open-workout" data-workout-id="${workoutItem.id}">Відкрити</button>
            </div>
        </article>`;
}
