// Exercise and finished-workout detail, exercise analytics.
import { escapeHtml, number, formatDate, shortDate } from "../lib/format.js";
import { workoutNeedsDetail } from "../lib/workout-status.js";
import { positionLabel, workoutBlocks, roundCount } from "../lib/superset.js";
import { serverVersionOf } from "../lib/realtime.js";
import { oneRepMax, exerciseVolume, exerciseOneRepMax } from "../lib/scoring.js";
import { emptyInline, exerciseMedia, exerciseSourceBlock, media, workoutStatStrip } from "./components.js";
import { storage } from "./data.js";
import { exerciseInstances, progressData, relatedExercises, teamBestResult } from "./history.js";
import {
    canManage, currentUser, exerciseById, ordered, setTypeLabel, statusLabel, userById, workoutCardioMinutes,
    workoutLabel, workoutSetCount, workoutStatusOf, workoutTypeLabel
} from "./model.js";
import { element, openDrawer } from "./overlays.js";
import { partnerInviteCta } from "./partner.js";
import { isWorkoutPrivate, privateWorkoutPanel } from "./privacy.js";
import { state } from "./state.js";
import { round, startDay } from "./util.js";
import { durationOf, lineChart, workoutExerciseCount, workoutVolumeOf } from "./workout-history.js";
import { pluralUk } from "./workout-screen.js";

function strengthStandardsLinks(exercise) {
    const haystack = `${exercise?.name || ""} ${(exercise?.aliases || []).join(" ")}`.toLowerCase();
    const isBench = /жим лежачи|bench/.test(haystack);
    const links = isBench
        ? [
            ["Strength Level — жим лежачи", "https://strengthlevel.com/strength-standards/bench-press/kg", "Нормативи за вагою тіла й статтю (beginner→elite)"],
            ["Symmetric Strength", "https://symmetricstrength.com/", "Калькулятор рівня сили за вагою тіла"]
        ]
        : [
            ["Strength Level — стандарти сили", "https://strengthlevel.com/strength-standards", "Нормативи для більшості вправ"],
            ["Symmetric Strength", "https://symmetricstrength.com/", "Оцінка сили за вагою тіла"]
        ];
    const caption = isBench
        ? "Звір свій 1ПМ із реальними нормативами для аматорів."
        : "Зовнішні таблиці нормативів — звір свій 1ПМ із реальними рівнями.";
    return `<section class="panel" style="margin-top:14px;"><h3>Актуальні нормативи</h3><p class="card-caption">${caption}</p><div class="ext-links">${links.map(([title, href, sub]) => `<a class="ext-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener"><span class="ext-link-icon"><i data-lucide="bar-chart-3"></i></span><span class="ext-link-text"><strong>${escapeHtml(title)}</strong><em>${escapeHtml(sub)}</em></span><i data-lucide="external-link" class="ext-link-arrow"></i></a>`).join("")}</div></section>`;
}

function statChip(value, label, icon) {
    return `<div class="stat-chip"><span class="stat-chip-ico"><i data-lucide="${icon}"></i></span><div class="stat-chip-body"><div class="stat-chip-value">${escapeHtml(String(value))}</div><div class="stat-chip-label">${escapeHtml(label)}</div></div></div>`;
}

// Rich per-exercise analytics for the drawer: records, 1RM progress chart,
// and the last sessions with a trend vs the previous one.
function exerciseAnalytics(exerciseId) {
    const userId = currentUser().id;
    const sessions = exerciseInstances(userId, exerciseId).map((instance) => {
        const working = instance.sets.filter((set) => set.isCompleted && set.type !== "warmup");
        let top = null;
        working.forEach((set) => {
            const estimate = oneRepMax(set.weight, set.repetitions);
            if (!top || estimate > top.estimate) {
                top = { weight: set.weight, repetitions: set.repetitions, estimate };
            }
        });
        const volume = round(working.reduce((sum, set) => sum + set.weight * set.repetitions, 0), 1);
        return { date: instance.date, working, top, volume, oneRm: top ? top.estimate : 0 };
    }).filter((session) => session.working.length);

    if (!sessions.length) {
        return `<section class="panel" style="margin-top:14px;"><h3>Аналітика прогресу</h3>${emptyInline("Ще немає даних", "Заверши тренування з цією вправою, щоб побачити рекорди, графік прогресу й динаміку останніх сесій.")}</section>`;
    }

    const allSets = sessions.flatMap((session) => session.working);
    const bestWeight = Math.max(...allSets.map((set) => set.weight));
    const bestSet = sessions.map((session) => session.top).sort((left, right) => right.estimate - left.estimate)[0];
    const best1RM = round(Math.max(...sessions.map((session) => session.oneRm)), 1);
    const teamBest = teamBestResult(exerciseId);
    const lastDate = sessions[0].date;
    const days = Math.round((startDay(new Date()) - startDay(new Date(lastDate))) / 86400000);
    const daysLabel = days <= 0 ? "сьогодні" : days === 1 ? "вчора" : `${days} дн. тому`;

    const chips = [
        statChip(`${number(bestWeight)} кг`, "Найкраща вага", "dumbbell"),
        statChip(`${bestSet.weight}×${bestSet.repetitions}`, "Найкращий сет", "layers"),
        statChip(`${number(best1RM)} кг`, "Найкращий 1ПМ", "trophy"),
        statChip(sessions.length, "Разів виконано", "repeat")
    ].join("");

    const recent = sessions.slice(0, 6);
    const rows = recent.map((session, index) => {
        const older = sessions[index + 1];
        let trend = `<span class="session-trend flat"></span>`;
        if (older && older.oneRm) {
            const delta = round(session.oneRm - older.oneRm, 1);
            if (delta > 0) {
                trend = `<span class="session-trend up"><i data-lucide="trending-up"></i>+${number(delta)}</span>`;
            } else if (delta < 0) {
                trend = `<span class="session-trend down"><i data-lucide="trending-down"></i>${number(delta)}</span>`;
            } else {
                trend = `<span class="session-trend flat"><i data-lucide="minus"></i></span>`;
            }
        }
        return `<div class="session-row"><div class="session-date">${shortDate(session.date)}</div><div class="session-cell"><span class="session-cell-value">${session.top.weight}×${session.top.repetitions}</span><span class="session-cell-label">сет</span></div><div class="session-cell"><span class="session-cell-value">${number(session.volume)}</span><span class="session-cell-label">обсяг</span></div><div class="session-cell"><span class="session-cell-value">${number(session.oneRm)}</span><span class="session-cell-label">1ПМ</span></div>${trend}</div>`;
    }).join("");

    return `<section class="panel exercise-analytics" style="margin-top:14px;">
            <div><h3>Аналітика прогресу</h3><p class="card-caption">Останнє виконання: ${daysLabel} · ${formatDate(lastDate)}${teamBest ? ` · командний максимум ${number(teamBest.estimatedOneRepMax)} кг` : ""}</p></div>
            <div class="stat-chips">${chips}</div>
            <div class="chart-box exercise-progress"><canvas id="exerciseProgressChart"></canvas></div>
            <h4 class="analytics-subhead">Останні сесії</h4>
            <div class="session-list">${rows}</div>
        </section>`;
}

export function openExercise(exerciseId) {
    const exercise = exerciseById(exerciseId);
    openDrawer(`<div class="drawer-header"><div><h2>${escapeHtml(exercise.name)}</h2><p class="card-caption">${exercise.primaryMuscleGroup} · ${exercise.movementPattern} · ${exercise.equipment}</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div>${media(exercise)}${exerciseSourceBlock(exercise)}${exerciseAnalytics(exerciseId)}<section class="panel" style="margin-top:14px;"><h3>Техніка</h3>${ordered(exercise.techniqueSteps)}</section>${strengthStandardsLinks(exercise)}<section class="panel" style="margin-top:14px;"><h3>Схожі вправи</h3><div class="workout-stack">${relatedExercises(exerciseId).slice(0, 3).map((item) => `<button class="nav-button" type="button" data-action="open-exercise" data-exercise-id="${item.id}"><span>${escapeHtml(item.name)}</span><strong class="nav-badge">${escapeHtml(item.primaryMuscleGroup)}</strong></button>`).join("") || emptyInline("Схожих вправ немає", "Розшир каталог у налаштуваннях.")}</div></section>`, { fullscreen: true });
    const points = progressData(currentUser().id, exerciseId);
    const existing = state.charts.get("exerciseProgressChart");
    if (existing) {
        existing.destroy();
        state.charts.delete("exerciseProgressChart");
    }
    requestAnimationFrame(() => lineChart("exerciseProgressChart", points.map((point) => shortDate(point.date)), points.map((point) => point.value), "1ПМ, кг"));
}

export function openWorkout(workoutId) {
    const workoutItem = state.database.workouts.find((item) => item.id === workoutId);
    if (!workoutItem) {
        return;
    }
    const owner = userById(workoutItem.userId);
    const readonly = !canManage(workoutItem);
    const totalSets = workoutSetCount(workoutItem);
    const cardioMinutes = workoutCardioMinutes(workoutItem);
    // A peer's session, and anything past the boot window, arrives as a summary: the
    // aggregate chips are populated but `exercises` is absent ENTIRELY, which is how a
    // summary is told apart from a genuinely empty session (that one has []). Without
    // this the drawer claimed "Вправ ще немає" for a workout whose own chip said 6.
    // A workout already known to be private is NOT missing its detail — asking again
    // returns the same refusal, and the repaint that follows asks again after that.
    const needsDetail = workoutNeedsDetail(workoutItem);
    openDrawer(`<div class="drawer-header"><div><h2>${escapeHtml(workoutLabel(workoutItem))}</h2><p class="card-caption"><button class="link-button" type="button" data-action="open-user" data-user-id="${owner.id}">${escapeHtml(owner.displayName)}</button> · ${formatDate(workoutItem.date)} · ${statusLabel(workoutStatusOf(workoutItem))} · ${workoutTypeLabel(workoutItem.workoutType)}</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div>${readonly ? `<div class="readonly-layer">Лише перегляд: це тренування іншого користувача.</div>` : ""}<section class="panel">${workoutStatStrip([{ icon: "dumbbell", value: workoutExerciseCount(workoutItem), label: "вправ" }, { icon: "list-checks", value: totalSets, label: "підходів" }, { icon: "boxes", value: `${number(workoutVolumeOf(workoutItem))} кг` }, { icon: "heart-pulse", value: `${cardioMinutes} хв`, label: "кардіо" }, { icon: "timer", value: `${durationOf(workoutItem)} хв` }])}${workoutItem.notes ? `<p class="card-caption" style="margin-top:12px;">${escapeHtml(workoutItem.notes)}</p>` : ""}<div class="action-row wrap" style="margin-top:14px;">${partnerInviteCta(workoutItem, readonly)}<button class="button ${readonly ? "button-primary" : "button-secondary"} compact" type="button" data-action="copy-workout-start" data-workout-id="${workoutItem.id}"><i data-lucide="copy-plus"></i>Копіювати й почати</button>${readonly ? "" : `<button class="button button-primary compact" type="button" data-action="edit-workout" data-workout-id="${workoutItem.id}"><i data-lucide="pen-line"></i>Керувати</button>${workoutItem.status === "active" ? `<button class="button button-secondary compact" type="button" data-action="finish-workout" data-workout-id="${workoutItem.id}"><i data-lucide="flag"></i>Завершити</button>` : `<button class="button button-secondary compact" type="button" data-action="reopen-workout" data-workout-id="${workoutItem.id}"><i data-lucide="rotate-ccw"></i>Відновити</button>`}<button class="button button-danger compact" type="button" data-action="delete-workout" data-workout-id="${workoutItem.id}"><i data-lucide="trash-2"></i>Видалити</button>`}</div></section><div class="wd-exercise-list" data-workout-detail="${workoutItem.id}" style="margin-top:14px;">${workoutDetailBody(workoutItem, needsDetail)}</div>`, { fullscreen: true });
    if (needsDetail) {
        hydrateWorkoutDetail(workoutId);
    }
}

function workoutDetailBody(workoutItem, needsDetail) {
    // Its owner keeps their details private. Distinct from "we could not load it":
    // there is nothing to wait for, and there IS something to do about it.
    if (isWorkoutPrivate(workoutItem) || workoutItem.privateOwnerId) {
        return privateWorkoutPanel(workoutItem.privateOwnerId || workoutItem.userId);
    }
    if (needsDetail) {
        return emptyInline("Завантажуємо підходи", "Це тренування підвантажується з сервера.");
    }
    if ((workoutItem.exercises || []).length) {
        // Grouped the same way the editor groups it, so a superset reads as one thing
        // in history too — the point of the card is that these were done together, and
        // a flat list of exercises loses exactly that.
        return workoutBlocks(workoutItem.exercises).map((block) => block.kind === "superset"
            ? `<div class="wd-superset"><div class="wd-superset-head"><span class="ss-badge"><i data-lucide="repeat-2"></i>Суперсет</span><span class="wd-superset-rounds">${roundCount(block.members)} ${pluralUk(roundCount(block.members), "раунд", "раунди", "раундів")}</span></div>${block.members.map((member, index) => workoutDetailExercise(member, positionLabel(index))).join("")}</div>`
            : workoutDetailExercise(block.exercise)).join("");
    }
    // Only say "not available" when the server actually refused. A hydrated workout
    // with no exercises really is an empty or cardio-only session, whoever owns it.
    if (workoutItem.detailUnavailable) {
        return emptyInline("Деталі недоступні", "Не вдалося завантажити підходи. Спробуй ще раз пізніше.");
    }
    return emptyInline("Вправ ще немає", "Це порожнє або кардіо-тренування.");
}

// Pulls the full row for a summary and repaints the drawer in place. GET /workouts/:id
// serves a peer's COMPLETED session (and anything at all to an admin); for a peer's
// unfinished one it 404s by design, which is what detailUnavailable records so we do
// not refetch on every open.
async function hydrateWorkoutDetail(workoutId) {
    const stillOpen = () => Boolean(element("drawerLayer")?.querySelector(`[data-workout-detail="${workoutId}"]`));
    if (storage.mode !== "api" || !storage.apiClient.hasBaseUrl()) {
        return;
    }
    let full = null;
    let privateOwnerId = null;
    let changed = true;
    try {
        full = await storage.apiClient.fetchWorkout(workoutId);
    } catch (error) {
        full = null;
        // A refusal on privacy grounds is not a failed request — it is an answer, and
        // the one the "ask for access" screen is built around.
        if (Number(error?.status) === 403 && error?.payload?.code === "WORKOUT_PRIVATE") {
            privateOwnerId = error.payload.ownerId || null;
        }
    }
    const workoutItem = state.database.workouts.find((item) => item.id === workoutId);
    if (!workoutItem) {
        return;
    }
    if (full && Array.isArray(full.exercises)) {
        const localTouchedAt = workoutItem.updatedAt;
        Object.assign(workoutItem, full);
        // Object.assign would otherwise let the server's timestamp masquerade as the
        // local one and vice versa; keep the two meanings apart.
        workoutItem.serverVersion = serverVersionOf(full) || workoutItem.serverVersion || null;
        workoutItem.updatedAt = localTouchedAt || workoutItem.updatedAt;
    } else if (privateOwnerId) {
        // Already knew? Then the repaint below would paint the identical screen and
        // start this all over again. Second guard on the same loop as `needsDetail`,
        // because re-entry here is what makes the drawer unclosable.
        changed = workoutItem.privateOwnerId !== privateOwnerId;
        workoutItem.privateOwnerId = privateOwnerId;
        delete workoutItem.detailUnavailable;
    } else {
        changed = !workoutItem.detailUnavailable;
        workoutItem.detailUnavailable = true;
    }
    // Repaint only if the user is still looking at this workout: the fetch can outlive
    // the drawer, and openWorkout on a stale id would yank them back into it.
    if (changed && stillOpen()) {
        openWorkout(workoutId);
    }
}

// Compact, scannable exercise block for the workout-detail drawer: a small
// thumbnail + name/summary, then a clean numbered set list (index · type ·
// weight × reps) instead of a wall of chips.
function workoutDetailExercise(workoutExercise, position = "") {
    const exercise = exerciseById(workoutExercise.exerciseId);
    const media = exerciseMedia(exercise);
    const thumb = media
        ? `<div class="wd-thumb"><img src="${escapeHtml(media)}" alt="${escapeHtml(exercise.name)}" referrerpolicy="no-referrer" loading="lazy" decoding="async" onerror="this.closest('.wd-thumb')?.remove()"></div>`
        : `<div class="wd-thumb wd-thumb-fallback"><i data-lucide="dumbbell"></i></div>`;
    const orm = exerciseOneRepMax(workoutExercise);
    const setRows = workoutExercise.sets.map((set, index) => `<div class="wd-set${set.isCompleted ? "" : " pending"}"><span class="wd-set-idx">${index + 1}</span><span class="wd-set-type type-${set.type}">${setTypeLabel(set.type)}</span><span class="wd-set-val"><strong>${number(set.weight)}</strong> кг × <strong>${set.repetitions}</strong></span></div>`).join("");
    return `<article class="wd-exercise${position ? " in-superset" : ""}"><div class="wd-exercise-head">${thumb}<div class="wd-exercise-meta"><h3>${position ? `<span class="ss-pos">${position}</span>` : ""}${escapeHtml(exercise.name)}</h3><span class="card-caption">${workoutExercise.sets.length} підходів · ${number(exerciseVolume(workoutExercise))} кг${orm ? ` · 1ПМ ${number(orm)} кг` : ""}</span></div></div><div class="wd-set-list">${setRows}</div></article>`;
}
