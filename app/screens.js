// Stats, rankings, team, profile and levels screens.
import { escapeHtml, number, formatDate } from "../lib/format.js";
import { XP_REWARDS, LEVEL_COUNT } from "../lib/levels.js";
import { frameForLevel, nextFrameForLevel, FRAME_TIERS, FRAME_TIER_SIZE, FRAME_TIER_COUNT } from "../lib/frames.js";
import { infoTip, profileMenu } from "./account-admin.js";
import { chartCard, compactKg, contributorCard, emptyInline, metric, recordCard, userCard } from "./components.js";
import { orderedMuscleGroups } from "./exercise-picker.js";
import { mainRank } from "./history.js";
import { avatar, currentUser, isAdmin, userById, workoutsFor } from "./model.js";
import { content } from "./overlays.js";
import { XP_HOWTO, framedAvatar, levelBadge, userAchievements, userLevel, xpEvents } from "./progression.js";
import { leaderboard, recordsFor, teamStats, userStats } from "./scoring-bridge.js";
import { roleStatusBadge } from "./settings.js";
import { state } from "./state.js";
import { byDateDesc } from "./util.js";
import {
    bodyweightChart, consistencyChart, loadMoreControl, maxTrendChart, muscleDistributionChart, progressChart,
    volumeChart, workoutHistoryList
} from "./workout-history.js";

export function stats() {
    const scopeId = state.filters.statsUserId;
    const userId = scopeId === "all" ? null : (scopeId || currentUser().id);
    const summary = userId ? userStats(userId) : teamStats();
    const history = (userId ? workoutsFor(userId) : state.database.workouts).sort(byDateDesc).slice(0, 8);
    const scopeName = userId ? (userId === currentUser().id ? "Твій прогрес" : escapeHtml(userById(userId).displayName)) : "Уся команда";
    content(`<section class="card stats-head"><div class="card-header head-dup"><div><h2>Статистика</h2><p class="card-caption">${scopeName} · за весь час. Обери учасника нижче або «Усі» для команди.</p></div></div>${statsUserBar(userId)}</section><div class="grid dashboard-grid" style="margin-top:16px;">${metric("Усього тренувань", summary.totalWorkouts, "calendar", "Усі статуси", "span-3")}${metric("Завершено", summary.completedWorkouts, "check-circle-2", "Фінішовані сесії", "span-3")}${metric("Підходи", summary.totalSets, "list-checks", `${summary.workingSets || 0} робочих`, "span-3")}${metric("Загальний обсяг", compactKg(summary.totalVolume), "boxes", "Завершені підходи", "span-3")}${metric("Середня тривалість", `${summary.averageDurationMinutes || 0} хв`, "timer", "Завершені тренування", "span-3")}${metric("Кардіо хвилини", summary.cardioMinutes || 0, "heart-pulse", `${summary.cardioDistance || 0} км`, "span-3")}${metric("Найчастіша вправа", summary.mostUsedExercise?.name || "—", "repeat", "Частота вправ", "span-3")}${metric("Найсильніший фокус", summary.mostTrainedMuscleGroup || "—", "target", "За завершеними підходами", "span-3")}${chartCard("Обсяг у часі", "Завершений обсяг за сесіями.", "statsVolume", "span-6")}${chartCard("Підходи за м'язами", "Розподіл завершених підходів.", "statsMuscle", "span-6")}${chartCard("Прогрес вправи", "Тренд розрахункового 1ПМ.", "statsProgress", "span-6")}${chartCard("Регулярність", "Кількість вправ у сесії.", "statsConsistency", "span-6")}${contributorCard()}<section class="card span-12"><div class="card-header"><div><h2>Історія</h2><p class="card-caption">${userId ? "Тренування обраного учасника." : "Спільна стрічка команди."}</p></div></div><div class="activity-feed">${workoutHistoryList(history)}</div>${loadMoreControl()}</section></div>`);
    requestAnimationFrame(() => {
        volumeChart("statsVolume", userId);
        muscleDistributionChart("statsMuscle", userId);
        progressChart("statsProgress", userId || currentUser().id);
        consistencyChart("statsConsistency", userId);
    });
}

// The only stats filter: a scrollable row of avatar chips — «Усі» (team) plus
// every member (you first, labelled «Я»). Replaces the old 5-select filter bar.
function statsUserBar(activeUserId) {
    const me = currentUser().id;
    const members = [...state.database.users].sort((left, right) => (right.id === me ? 1 : 0) - (left.id === me ? 1 : 0));
    const allChip = `<button class="stat-userchip all${activeUserId === null ? " active" : ""}" type="button" data-action="stats-user" data-user-id="all"><span class="stat-userchip-all"><i data-lucide="users"></i></span><span class="stat-userchip-name">Усі</span></button>`;
    const memberChips = members.map((member) => `<button class="stat-userchip${member.id === activeUserId ? " active" : ""}" type="button" data-action="stats-user" data-user-id="${member.id}">${avatar(member, "tiny")}<span class="stat-userchip-name">${escapeHtml(member.id === me ? "Я" : member.displayName)}</span></button>`).join("");
    return `<div class="stat-userbar">${allChip}${memberChips}</div>`;
}

export function rankings() {
    const groups = orderedMuscleGroups();
    const requested = state.filters.rankingsMuscle || "Груди";
    // Fall back gracefully if the preferred default group isn't in the catalog.
    const muscle = requested === "all" || groups.includes(requested) ? requested : (groups.includes("Груди") ? "Груди" : "all");
    const muscleOptions = [`<option value="all"${muscle === "all" ? " selected" : ""}>Найкращий загалом</option>`]
        .concat(orderedMuscleGroups().map((group) => `<option value="${escapeHtml(group)}"${muscle === group ? " selected" : ""}>${escapeHtml(group)}</option>`))
        .join("");
    const liftLabel = muscle === "all" ? "1ПМ" : escapeHtml(muscle);
    const rows = leaderboard(muscle).map((row, index) => {
        const rank = index + 1;
        const bestLift = row.bestLift
            ? `<span class="rank-metric-val">${number(row.bestLift.estimatedOneRepMax)} кг</span><span class="rank-metric-lbl">${escapeHtml(row.bestLift.exercise.name)}</span>`
            : `<span class="rank-metric-val">—</span><span class="rank-metric-lbl">${liftLabel}</span>`;
        return `<button class="rank-row${rank <= 3 ? ` podium rank-top-${rank}` : ""}" type="button" data-action="open-user" data-user-id="${row.user.id}">
                <span class="rank-num">${rank}</span>
                <div class="rank-user">${framedAvatar(row.user, "tiny", row.level)}<div class="rank-user-text"><strong class="rank-name">${escapeHtml(row.user.displayName)}</strong><span class="rank-chips">${levelBadge({ level: row.level })}${roleStatusBadge(row.user)}</span></div></div>
                <div class="rank-metrics">
                    <div class="rank-metric"><span class="rank-metric-val">${row.completedWorkouts}</span><span class="rank-metric-lbl">трен.</span></div>
                    <div class="rank-metric"><span class="rank-metric-val">${number(row.totalVolume)}</span><span class="rank-metric-lbl">кг обсяг</span></div>
                    <div class="rank-metric rank-metric-best">${bestLift}</div>
                </div>
            </button>`;
    }).join("");
    content(`<section class="card rankings-card"><div class="card-header rankings-header"><div class="head-dup"><h2>Командний рейтинг</h2><p class="card-caption">За рівнем, регулярністю та обсягом. Натисни на учасника, щоб відкрити його тренування.</p></div><div class="rankings-lift-picker"><label>Найкращий підйом</label><gym-select data-action="rankings-lift-filter">${muscleOptions}</gym-select></div></div><div class="rank-list">${rows}</div></section>`);
}

export function users() {
    // Approval requests live only in the admin panel now — the team page is just
    // the member grid.
    content(`<section class="user-grid">${state.database.users.map(userCard).join("")}</section>`);
}

export function profile() {
    const user = currentUser();
    const summary = userStats(user.id);
    const info = userLevel(user.id);
    const recent = workoutsFor(user.id).filter((workoutItem) => workoutItem.status === "completed").sort(byDateDesc).slice(0, 5);
    content(`<div class="grid dashboard-grid"><section class="card span-12"><div class="profile-header"><div class="list-row profile-identity">${framedAvatar(user, "large", info.level)}<div class="profile-headline"><h2>${escapeHtml(user.displayName)}</h2><div class="profile-badges">${levelBadge(info, { link: true })}${roleStatusBadge(user)}<span class="badge accent">${escapeHtml(user.trainingGoal)}</span></div><p class="card-caption">${escapeHtml(user.name)} · ${user.height} см · ${user.bodyweight} кг · ${escapeHtml(user.trainingExperience)} · фокус: ${escapeHtml(user.favoriteMuscleGroup)}</p></div></div>${profileMenu(user, info)}</section><section class="card span-12"><h2>Останні тренування</h2><div class="activity-feed">${workoutHistoryList(recent)}</div></section>${metric("Тренування", summary.completedWorkouts, "calendar-check", "Завершено", "span-3")}${metric("Загальний обсяг", compactKg(summary.totalVolume), "boxes", "Усі завершені підходи", "span-3")}${metric("Підходи", summary.totalSets, "list-checks", `${summary.workingSets} робочих`, "span-3")}${metric("Кардіо", `${summary.cardioMinutes} хв`, "heart-pulse", `${summary.cardioDistance} км`, "span-3")}${chartCard("Історія ваги тіла", "Щотижневі заміри.", "profileBodyweight", "span-6")}${chartCard("Тренд розрахункового 1ПМ", "Демо-тренд жиму лежачи.", "profileMax", "span-6")}<section class="card span-12"><h2>Особисті рекорди</h2><div class="exercise-card-grid">${recordsFor(user.id).slice(0, 6).map(recordCard).join("") || emptyInline("PR ще немає", "Заверши робочі підходи, щоб GymOS визначив рекорди.")}</div></section></div>`);
    requestAnimationFrame(() => {
        bodyweightChart("profileBodyweight", user.id);
        maxTrendChart("profileMax", user.id);
    });
}

export function levels() {
    const user = currentUser();
    const info = userLevel(user.id);
    const tier = frameForLevel(info.level);
    const nextTier = nextFrameForLevel(info.level);
    const recent = xpEvents(user.id).slice(0, 14);
    const pct = Math.round(info.progress * 100);
    const xpSources = [
        ["dumbbell", "Завершене тренування", `+${XP_REWARDS.workout}`],
        ["boxes", "Обсяг підйомів за сесію", `до +${XP_REWARDS.volumeCap}`],
        ["flame", "Серія тренувань підряд", `+${XP_REWARDS.streak}`],
        ["trophy", "Особистий рекорд (1ПМ)", `+${XP_REWARDS.record}`],
        ["plus-circle", "Твоя вправа в каталозі", `+${XP_REWARDS.exercise}`],
        ["lightbulb", "Ідея зі статусом «Готово»", `+${XP_REWARDS.ideaDone}`],
        ["award", "Відкрите досягнення", "+50–400"]
    ];
    const heroCard = `<section class="card span-12 level-hero">
            <div class="list-row profile-identity">${framedAvatar(user, "large", info.level)}<div class="profile-headline">
                <h2>Рівень ${info.level}${infoTip("Рівні та XP", XP_HOWTO)}</h2>
                <div class="profile-badges">${levelBadge(info)}<span class="frame-name-badge">${escapeHtml(tier.name)}</span>${roleStatusBadge(user)}<span class="badge locked">Силовий клас: ${escapeHtml(mainRank(user.id))}</span></div>
                <p class="card-caption">${info.isMax ? "Максимальний рівень досягнуто" : `${number(info.xpToNext)} XP до рівня ${info.level + 1}`} · Загалом ${number(info.xp)} XP</p>
                <div class="level-progress"><div class="progress-track"><div class="progress-fill" style="width:${pct}%;"></div></div><span class="level-progress-label">${info.isMax ? "MAX" : `${number(info.xpIntoLevel)} / ${number(info.xpForLevel)} XP`}</span></div>
            </div></div>
        </section>`;
    const frameCard = `<section class="card span-6">
            <h2>Рамка аватара</h2>
            <p class="card-caption">Рамка оновлюється кожні ${FRAME_TIER_SIZE} рівнів — усього ${FRAME_TIER_COUNT} рангів. Що вищий рівень — то крутіша рамка.</p>
            <div class="frame-preview-row">
                <div class="frame-preview">${framedAvatar(user, "large", info.level)}<strong class="frame-preview-name">${escapeHtml(tier.name)}</strong><span class="frame-preview-meta">Зараз · ранг ${tier.index + 1}/${FRAME_TIER_COUNT}</span></div>
                <div class="frame-preview-arrow"><i data-lucide="arrow-right"></i></div>
                ${nextTier
                ? `<div class="frame-preview">${avatar(user, "large", { frameTier: nextTier, plateLevel: nextTier.unlockLevel })}<strong class="frame-preview-name">${escapeHtml(nextTier.name)}</strong><span class="frame-preview-meta">Рівень ${nextTier.unlockLevel} · ранг ${nextTier.index + 1}/${FRAME_TIER_COUNT}</span></div>`
                : `<div class="frame-preview"><strong class="frame-preview-name">Найвища рамка</strong><span class="frame-preview-meta">Ти на вершині</span></div>`}
            </div>
            ${isAdmin() ? `<div class="action-row" style="margin-top:16px;"><button class="button button-secondary compact" type="button" data-action="admin-frame-test"><i data-lucide="palette"></i>Тестувати рамки (адмін)</button></div>` : ""}
        </section>`;
    const howCard = `<section class="card span-6">
            <h2>Як заробити XP</h2>
            <ul class="xp-source-list">${xpSources.map(([icon, label, amount]) => `<li><span class="xp-source-ico"><i data-lucide="${icon}"></i></span><span class="xp-source-label">${escapeHtml(label)}</span><span class="xp-amount">${escapeHtml(amount)}</span></li>`).join("")}</ul>
            <p class="card-caption">XP нараховується автоматично з усієї твоєї історії — нічого не треба вмикати. ${LEVEL_COUNT} рівнів: перші даються швидко, далі — цінніші.</p>
        </section>`;
    const achievements = userAchievements(user.id);
    const unlockedCount = achievements.filter((achievement) => achievement.unlockedAt).length;
    // Show unlocked first (most recent leading), locked after — sorted by relevance.
    const sortedAchievements = [...achievements].sort((left, right) => {
        if (Boolean(left.unlockedAt) !== Boolean(right.unlockedAt)) {
            return left.unlockedAt ? -1 : 1;
        }
        if (left.unlockedAt && right.unlockedAt) {
            return new Date(right.unlockedAt) - new Date(left.unlockedAt);
        }
        return left.xp - right.xp;
    });
    const achievementsCard = `<section class="card span-12">
            <div class="card-header"><div><h2>Досягнення</h2><p class="card-caption">Відкрито ${unlockedCount} з ${achievements.length} — кожне дає XP</p></div></div>
            <div class="ach-grid">${sortedAchievements.map((achievement) => `<div class="ach-card${achievement.unlockedAt ? " unlocked" : ""}"><span class="ach-xp-badge">+${achievement.xp} XP</span><span class="ach-ico"><i data-lucide="${achievement.unlockedAt ? achievement.icon : "lock"}"></i></span><strong class="ach-title">${escapeHtml(achievement.title)}</strong><span class="ach-cap">${escapeHtml(achievement.caption)}</span>${achievement.unlockedAt ? `<span class="ach-date">${formatDate(achievement.unlockedAt)}</span>` : ""}</div>`).join("")}</div>
        </section>`;
    const historyCard = `<section class="card span-12">
            <h2>Останні нарахування XP</h2>
            ${recent.length
            ? `<div class="xp-history">${recent.map((event) => `<div class="xp-history-row"><span class="xp-history-ico kind-${event.kind}"><i data-lucide="${event.icon}"></i></span><div class="xp-history-main"><strong>${escapeHtml(event.label)}</strong><span class="xp-history-date">${formatDate(event.date)}</span></div><span class="xp-amount">+${number(event.amount)}</span></div>`).join("")}</div>`
            : emptyInline("Ще немає активності", "Заверши перше тренування, щоб почати набирати XP.")}
        </section>`;
    content(`<div class="grid dashboard-grid">${heroCard}${frameCard}${howCard}${achievementsCard}${historyCard}</div>`);
}

// Admin-only local frame preview: shows all tiers; picking one previews it on the
// admin's own avatar (state.frameOverride, in-memory) so they can review the frames.
export function frameGallery() {
    const user = currentUser();
    const active = state.frameOverride;
    const cards = FRAME_TIERS.map((tier) => `<button class="frame-gallery-card${active === tier.index ? " active" : ""}" type="button" data-action="apply-frame-override" data-tier="${tier.index}">${avatar(user, "large", { frameTier: tier, plateLevel: tier.unlockLevel })}<strong class="frame-preview-name">${escapeHtml(tier.name)}</strong><span class="frame-preview-meta">Ранг ${tier.index + 1} · Рів. ${tier.unlockLevel}+</span></button>`).join("");
    return `<div class="frame-gallery-head"><div><h2>Тест рамок (адмін)</h2><p class="card-caption">Обери рамку, щоб приміряти її на свій аватар. Лише локально — скидається після перезавантаження.</p></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="Закрити"><i data-lucide="x"></i></button></div><div class="frame-gallery">${cards}</div><div class="action-row" style="margin-top:16px;"><button class="button button-secondary" type="button" data-action="reset-frame-override"><i data-lucide="rotate-ccw"></i>Скинути до мого рівня (Рів. ${userLevel(user.id).level})</button></div>`;
}
