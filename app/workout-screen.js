// The workout screen: the starter, the workout card, the exercise editor and its set rows.
import { escapeHtml, number, formatDate } from "../lib/format.js";
import { isTimedSet, formatDuration, weightFieldLabel, isBodyweightExercise } from "../lib/set-format.js";
import { workoutBlocks } from "../lib/superset.js";
import { fieldStep, stepValue } from "../lib/session.js";
import { liveSetRecords } from "../lib/live-records.js";
import { workoutVolume, exerciseVolume, exerciseOneRepMax, recordsFor as kernelRecordsFor } from "../lib/scoring.js";
import { aiBlockCollapsed, aiWorkoutBlock, canUseAi, noteAiSeen } from "./ai-workout.js";
import { emptyInline, exerciseMedia, workoutStatStrip } from "./components.js";
import { gymClockChip, touchGymClock } from "./gym-clock-ui.js";
import { isHydratedWorkout, lastExerciseNote, latestDoneSets } from "./history.js";
import {
    activeWorkoutFor, canManage, cardioIcon, cardioTypeLabel, currentUser, editWorkout, editWorkoutExercise,
    exerciseById, intensityLabel, setTypeLabel, startWorkoutButton, statusLabel, userById, workoutDateBounds,
    workoutLabel, workoutSetCount, workoutStatusOf, workoutTypeLabel, workoutsFor
} from "./model.js";
import { content, toast } from "./overlays.js";
import { loadPartnerState, renderPartnerPanel } from "./partner.js";
import { persistWorkout, schedulePersistWorkout } from "./persistence.js";
import { loadPresence } from "./presence.js";
import { duration, recordsFor } from "./scoring-bridge.js";
import { ux2ApplyLast } from "./sheets.js";
import { renderSection } from "./shell.js";
import { state } from "./state.js";
import { formatRest, supersetBlockEditor } from "./supersets.js";
import { personalTemplatesSection } from "./templates.js";
import { noteField } from "./ui-helpers.js";
import { byDateDesc, createId } from "./util.js";
import { refreshWarmupRow, warmupInlineRow } from "./warmup-ui.js";
import { watchedPrevious } from "./watch.js";
import { addSet, recordFlashSetId, timedBlockCaption } from "./workout-actions.js";
import { workoutExerciseCount, workoutVolumeOf } from "./workout-history.js";

export function workout() {
    const workoutItem = editWorkout();
    content(`<div class="workout-stack"><div id="partnerPanel"></div>${workoutItem ? workoutEditor(workoutItem) : workoutStarter()}</div>`);
    // Painted from whatever is already held, then refreshed in the background, so
    // switching to this screen never flashes an empty panel.
    renderPartnerPanel();
    loadPartnerState().then(renderPartnerPanel);
    // The strip lived only on the dashboard and the feed. Its absence here IS the
    // missing entry point: this is the screen you are on while training, and it is
    // where seeing that somebody else is lifting right now actually matters.
    // Presence still loads — the partner panel and the peek button read from it — it
    // simply has no strip to draw on this screen.
    loadPresence();
}

function workoutStarter() {
    // AI block sits directly above the manual "Почати тренування" card. Available to
    // PRO (premium) and admins; hidden for free users (backend enforces it too).
    // Returning users get it folded into a compact inline button instead.
    let aiBlock = "";
    let aiInlineButton = "";
    if (canUseAi()) {
        if (aiBlockCollapsed()) {
            aiInlineButton = `<button class="button button-secondary large-workout-button ai-inline-btn" type="button" data-action="ai-expand"><i data-lucide="sparkles"></i>Створити за допомогою AI</button>`;
        } else {
            noteAiSeen();
            aiBlock = `<div id="aiWorkoutBlock">${aiWorkoutBlock()}</div>`;
        }
    }
    return `${aiBlock}<section class="card workout-starter"><div class="workout-starter-icon"><i data-lucide="dumbbell"></i></div><h2>Немає активного тренування</h2><p class="card-caption">Почни нову сесію та додавай вправи, підходи й кардіо прямо в залі. Усе можна відредагувати або видалити пізніше.</p><div class="workout-starter-actions">${startWorkoutButton(null)}${aiInlineButton}<button class="button button-secondary large-workout-button" type="button" data-action="navigate" data-section="calendar"><i data-lucide="calendar-days"></i>Історія тренувань</button></div></section>${personalTemplatesSection()}`;
}

// ===== end AI статистика ====================================================

export function workoutEditor(workoutItem, options = {}) {
    const owner = userById(workoutItem.userId);
    // `forceReadonly` is not the same question as "may this person edit". An admin
    // CAN manage anybody's workout, so opening someone else's session to watch it
    // handed them the full editor — action bar, delete button, live weight inputs and
    // the "tap the circle to finish" coach-mark — on a screen whose entire promise is
    // that you are only looking. Watching must never be able to change anything,
    // whoever is watching.
    const readonly = options.forceReadonly === true || !canManage(workoutItem);
    // An admin can open ANY workout here, including a teammate's row that is still a
    // summary from the windowed payload. Everything below walks exercises/sets, so
    // bail out to a read-only stub rather than throwing on a screen the user reached
    // in one tap from the profile.
    if (!isHydratedWorkout(workoutItem)) {
        return `<section class="card workout-head"><div class="card-header"><div><h2>${escapeHtml(workoutLabel(workoutItem))}</h2><p class="card-caption">${escapeHtml(owner ? owner.displayName : "Учасник")} · ${formatDate(workoutItem.date)} · ${statusLabel(workoutStatusOf(workoutItem))}</p></div></div>${workoutStatStrip([{ icon: "dumbbell", value: workoutExerciseCount(workoutItem), label: "вправ" }, { icon: "list-checks", value: workoutSetCount(workoutItem), label: "підходів" }, { icon: "boxes", value: `${number(workoutVolumeOf(workoutItem))} кг` }])}<div class="action-row" style="margin-top:14px;"><button class="button button-primary compact" type="button" data-action="open-workout" data-workout-id="${workoutItem.id}"><i data-lucide="external-link"></i>Відкрити деталі</button></div></section>`;
    }
    const completedSets = workoutItem.exercises.flatMap((item) => item.sets).filter((set) => set.isCompleted).length;
    const active = activeWorkoutFor(currentUser().id);
    const dateBounds = workoutDateBounds();
    const dateAttrs = dateBounds.min ? ` min="${dateBounds.min}" max="${dateBounds.max}"` : "";
    const isOtherThanActive = !readonly && active && active.id !== workoutItem.id;
    const contextBanner = !readonly && workoutItem.status !== "active"
        ? `<div class="readonly-layer info">Ви редагуєте ${statusLabel(workoutStatusOf(workoutItem)).toLowerCase()} тренування. Зміни зберігаються автоматично.${active ? ` <button class="link-button" type="button" data-action="edit-workout" data-workout-id="${active.id}">Перейти до активного</button>` : ""}</div>`
        : isOtherThanActive ? `<div class="readonly-layer info">У вас є активне тренування. <button class="link-button" type="button" data-action="edit-workout" data-workout-id="${active.id}">Відкрити активне</button></div>` : "";
    const clockChip = readonly ? "" : gymClockChip(workoutItem);
    // `has-clock` lets the CSS know whether the buttons have to share the row. Without
    // it, a bar whose clock has not started yet kept the buttons pinned right, with
    // dead space where the chip would eventually appear.
    const actionBar = readonly ? "" : `<div class="workout-actionbar${clockChip ? " has-clock" : ""}">
                <div class="workout-actionbar-info"><strong class="workout-actionbar-title">${escapeHtml(workoutLabel(workoutItem))}</strong></div>
                ${clockChip}
                <div class="workout-actionbar-actions">${workoutItem.status === "active" && workoutItem.exercises.length ? `<button class="button button-secondary compact" type="button" data-action="open-focus" title="Фокус-режим: одна вправа, один підхід"><i data-lucide="crosshair"></i><span>Фокус</span></button>` : ""}<button class="button button-secondary compact" type="button" data-action="open-add-exercise-modal"><i data-lucide="plus"></i><span>Вправа</span></button>${workoutItem.status === "active" ? `<button class="button button-primary compact" type="button" data-action="finish-workout" data-workout-id="${workoutItem.id}"><i data-lucide="flag"></i><span>Завершити</span></button>` : `<button class="button button-primary compact" type="button" data-action="reopen-workout" data-workout-id="${workoutItem.id}"><i data-lucide="rotate-ccw"></i><span>Відновити</span></button>`}</div>
            </div>`;
    return `
            ${actionBar}
            <section class="card workout-head">
                <div class="card-header">
                    <div style="flex:1;min-width:0;"><div class="tag-row" style="margin-bottom:10px;"><span class="status-badge ${workoutStatusOf(workoutItem)}">${statusLabel(workoutStatusOf(workoutItem))}</span>${readonly ? `<span class="status-badge readonly">Лише перегляд</span>` : ""}${owner.id === currentUser().id ? "" : `<button class="chip chip-button" type="button" data-action="open-user" data-user-id="${owner.id}">${escapeHtml(owner.displayName)}</button>`}</div><div class="workout-title-line"><h2>${escapeHtml(workoutLabel(workoutItem))}</h2>${readonly ? `<span class="chip">${escapeHtml(workoutTypeLabel(workoutItem.workoutType))}</span>` : `<button class="chip chip-button workout-type-chip" type="button" data-action="open-workout-type" data-workout-id="${workoutItem.id}" title="Змінити тип тренування"><span>${escapeHtml(workoutTypeLabel(workoutItem.workoutType))}</span><i data-lucide="chevron-down"></i></button>`}</div><p class="card-caption">${formatDate(workoutItem.date)} · ${duration(workoutItem)} хв · ${number(workoutVolume(workoutItem))} кг${readonly ? "" : ` · ${completedSets} завершених підходів`}</p></div>
                    ${readonly ? "" : `<button class="icon-button workout-menu-btn" type="button" data-action="ux2-session-menu" title="Ще" aria-label="Меню тренування: тип, дата, нотатка, кардіо, шаблон, видалення"><i data-lucide="more-horizontal"></i></button>`}
                </div>
                ${contextBanner}
                ${readonly || workoutItem.notes || state.openNotes.has(`workout:${workoutItem.id}`) ? noteField(`workout:${workoutItem.id}`, "Нотатки тренування", "Додати нотатку до тренування", workoutItem.notes, `data-action="update-workout-notes"`, readonly) : ""}
            </section>
            ${workoutItem.exercises.length ? `<div class="workout-exercise-list"${readonly ? "" : ` data-reorder="1" data-workout-id="${workoutItem.id}"`}>${workoutBlocks(workoutItem.exercises).map((block, blockIndex) => block.kind === "superset"
            ? supersetBlockEditor(workoutItem, block, readonly)
            : workoutExerciseEditor(workoutItem, block.exercise, readonly, blockIndex === 0)).join("")}</div>` : `${readonly ? "" : repeatSuggestionCard(workoutItem)}${emptyInline("Вправ ще немає", "Натисни «Вправа», щоб зібрати сесію.")}`}
            ${(workoutItem.cardioSessions || []).length ? cardioBlock(workoutItem, readonly) : ""}
        `;
}

const WEEKDAY_ACC = ["неділю", "понеділок", "вівторок", "середу", "четвер", "п'ятницю", "суботу"];

const WEEKDAY_NOM = ["Неділя", "Понеділок", "Вівторок", "Середа", "Четвер", "П'ятниця", "Субота"];

export const MONTH_SHORT = ["січ", "лют", "бер", "квіт", "трав", "черв", "лип", "серп", "вер", "жовт", "лист", "груд"];

function weekdayOf(dateStr) {
    return new Date(`${String(dateStr).slice(0, 10)}T00:00:00`).getDay();
}

export function weekdayLabel(dateStr) {
    return WEEKDAY_NOM[weekdayOf(dateStr)] || "";
}

// Ukrainian count forms: 1 вправа / 2-4 вправи / 5+ вправ (with the 11-14 exception).
export function pluralUk(count, one, few, many) {
    const abs = Math.abs(Math.round(Number(count) || 0));
    const mod10 = abs % 10;
    const mod100 = abs % 100;
    if (mod10 === 1 && mod100 !== 11) {
        return one;
    }
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
        return few;
    }
    return many;
}

// The user's most recent completed workout (with exercises) on the SAME weekday
// as `dateStr`, before that date — used to offer "repeat last Wednesday's session".
export function sameWeekdayWorkout(userId, dateStr, excludeId) {
    const targetDow = weekdayOf(dateStr);
    const day = String(dateStr).slice(0, 10);
    return workoutsFor(userId)
        .filter((item) => item.id !== excludeId && item.status === "completed" && (item.exercises || []).length && String(item.date).slice(0, 10) < day && weekdayOf(item.date) === targetDow)
        .sort(byDateDesc)[0] || null;
}

function repeatSuggestionCard(workoutItem) {
    if (workoutItem.exercises.length) {
        return "";
    }
    const source = sameWeekdayWorkout(workoutItem.userId, workoutItem.date, workoutItem.id);
    if (!source) {
        return "";
    }
    return `<div class="repeat-suggest"><div class="repeat-suggest-main"><span class="repeat-suggest-icon"><i data-lucide="history"></i></span><div><strong>Повторити тренування в ${WEEKDAY_ACC[weekdayOf(workoutItem.date)]}?</strong><p class="card-caption">Минулого разу (${formatDate(source.date)}) — ${source.exercises.length} вправ, ${workoutSetCount(source)} підходів. Ті самі вправи, а ваги й повтори — з останнього разу, коли ти їх робив.</p></div></div><button class="button button-primary compact" type="button" data-action="apply-weekday-workout" data-workout-id="${source.id}"><i data-lucide="copy"></i>Застосувати</button></div>`;
}

// Copy a source workout's exercises + cardio + type into the current empty workout,
// keeping today's date. The NUMBERS come from the last time each exercise was done, not
// from the source: the source is matched by weekday and can be months old, and a set
// filled with July's weights next to a «Минулий раз» column showing last week's is
// exactly the mismatch it used to produce.
export async function applyWeekdayWorkout(sourceId) {
    const workoutItem = editWorkout();
    const source = state.database.workouts.find((item) => item.id === sourceId);
    if (!workoutItem || !canManage(workoutItem) || !source) {
        return;
    }
    workoutItem.workoutType = source.workoutType;
    workoutItem.exercises = source.exercises.slice().sort((left, right) => left.order - right.order).map((exercise, index) => ({
        id: createId("workout-exercise"),
        exerciseId: exercise.exerciseId,
        order: index + 1,
        notes: "",
        sets: (latestDoneSets(workoutItem.userId, exercise.exerciseId, workoutItem.id)?.sets || exercise.sets || [])
            .map((set) => ({ ...set, id: createId("set"), isCompleted: false, notes: "" }))
    }));
    workoutItem.cardioSessions = (source.cardioSessions || []).map((session) => ({ ...session, id: createId("cardio") }));
    // Fresh un-ticked sets — the clock must forget the session this was copied from.
    touchGymClock(workoutItem);
    workoutItem.updatedAt = new Date().toISOString();
    await persistWorkout(workoutItem);
    renderSection();
    toast("Тренування заповнено", `Вправи — з ${formatDate(source.date)}, ваги й повтори — з останнього разу.`);
}

function cardioBlock(workoutItem, readonly) {
    const sessions = workoutItem.cardioSessions || [];
    return `<section class="card"><div class="card-header"><div><h2>Кардіо</h2><p class="card-caption">Бігова доріжка, велотренажер та інше. Вкажи час і деталі.</p></div><button class="button button-secondary compact" type="button" data-action="open-cardio-modal" data-workout-id="${workoutItem.id}" ${readonly ? "disabled" : ""}><i data-lucide="plus"></i>Додати кардіо</button></div>${sessions.length ? `<div class="cardio-list">${sessions.map((session) => `<div class="cardio-row"><div class="cardio-icon"><i data-lucide="${cardioIcon(session.type)}"></i></div><div style="flex:1;min-width:0;"><strong>${cardioTypeLabel(session.type)} · ${session.durationMinutes} хв</strong><p class="card-caption">${[session.distance ? `${session.distance} км` : "", session.calories ? `${session.calories} ккал` : "", session.averageHeartRate ? `${session.averageHeartRate} уд/хв` : "", session.intensity ? intensityLabel(session.intensity) : ""].filter(Boolean).join(" · ") || "Без деталей"}</p></div>${readonly ? "" : `<div class="inline-actions"><button class="icon-button" type="button" title="Редагувати" data-action="open-cardio-modal" data-workout-id="${workoutItem.id}" data-cardio-id="${session.id}"><i data-lucide="pen-line"></i></button><button class="icon-button" type="button" title="Видалити" data-action="delete-cardio" data-workout-id="${workoutItem.id}" data-cardio-id="${session.id}"><i data-lucide="trash-2"></i></button></div>`}</div>`).join("")}</div>` : `<p class="card-caption">У цьому тренуванні ще немає кардіо-блоків.</p>`}</section>`;
}

function workoutExerciseEditor(workoutItem, workoutExercise, readonly, isFirstExercise) {
    const exercise = exerciseById(workoutExercise.exerciseId);
    // Only the current user's own history is hydrated in the windowed payload; a
    // peer's prior sessions are summaries, so there is nothing to show and asking
    // for it used to throw.
    const historyUserId = workoutItem.userId === state.database.currentUserId ? workoutItem.userId : null;
    // For a session being watched the owner's own previous performance comes from the
    // server — the client cannot compute it, because peers arrive as summaries with
    // no sets, which is exactly why historyUserId is null for anybody but you.
    // Your own last time is the last FINISHED session (latestDoneSets) — the same source
    // the chips fill from and new sets are pre-filled from.
    const lastSets = watchedPrevious(workoutItem, workoutExercise.exerciseId)
        || latestDoneSets(historyUserId, workoutExercise.exerciseId, workoutItem.id);
    const editable = !readonly && workoutItem.userId === currentUser().id;
    const lastNote = lastExerciseNote(historyUserId, workoutExercise.exerciseId, workoutItem.id);
    const warmupRow = editable ? warmupInlineRow(workoutItem, workoutExercise, exercise, lastSets) : "";
    const records = editable ? liveSetRecords(workoutExercise.sets, previousBestOneRepMax(workoutItem, workoutExercise.exerciseId)) : null;
    const lastResults = lastSets && lastSets.sets.length
        ? `<div class="last-results"><span class="last-results-label"><i data-lucide="history"></i>Минулого разу · ${formatDate(lastSets.date)}</span><div class="last-results-chips">${lastSets.sets.map((set, setIndex) => {
            const text = isTimedSet(set) ? `${number(set.weight) ? `${number(set.weight)}×` : ""}${formatDuration(set.durationSeconds)}` : `${number(set.weight)}×${set.repetitions}`;
            // Tap a chip and that set takes last time's numbers.
            return editable
                ? `<button class="chip last-chip" type="button" data-action="fill-from-last" data-workout-exercise-id="${workoutExercise.id}" data-set-index="${setIndex}" title="Заповнити підхід ${setIndex + 1} як минулого разу">${text}</button>`
                : `<span class="chip" data-set-index="${setIndex}">${text}</span>`;
        }).join("")}</div></div>`
        : "";
    const previousNote = lastNote
        ? `<div class="previous-note"><span class="previous-note-label"><i data-lucide="sticky-note"></i>Остання нотатка · ${formatDate(lastNote.date)}</span><p>${escapeHtml(lastNote.notes)}</p></div>`
        : "";
    const showSetHint = !readonly && isFirstExercise;
    const dragHandle = readonly ? "" : `<button class="we-drag-handle" type="button" aria-label="Перетягни, щоб змінити порядок" title="Перетягни, щоб змінити порядок" data-workout-exercise-id="${workoutExercise.id}"><i data-lucide="grip-vertical"></i></button>`;
    // Small gif thumbnail, same style as the finished-workout detail (.wd-thumb).
    const media = exerciseMedia(exercise);
    // eager + sync decode so a cached gif re-paints WITH the layout on re-render
    // (renderSection rebuilds the card on every set edit) — no blink.
    const thumb = media
        ? `<div class="wd-thumb"><img src="${escapeHtml(media)}" alt="${escapeHtml(exercise.name)}" referrerpolicy="no-referrer" loading="eager" decoding="sync" onerror="this.closest('.wd-thumb')?.remove()"></div>`
        : `<div class="wd-thumb wd-thumb-fallback"><i data-lucide="dumbbell"></i></div>`;
    // A fully-completed exercise folds to just its header (animated); the chevron
    // toggles it and state.expandedExercises tracks manual expand overrides.
    const allDone = workoutExercise.sets.length > 0 && workoutExercise.sets.every((set) => set.isCompleted);
    state.expandedExercises = state.expandedExercises || new Set();
    const collapsed = allDone && !state.expandedExercises.has(workoutExercise.id) && state.collapseAnimId !== workoutExercise.id;
    const articleClass = `workout-exercise${allDone ? " we-done" : ""}${collapsed ? " we-collapsed" : ""}`;
    const collapseToggle = allDone ? `<button class="icon-button we-collapse-btn" type="button" title="Згорнути / розгорнути" aria-label="Згорнути / розгорнути" data-action="toggle-exercise-collapse" data-workout-exercise-id="${workoutExercise.id}"><i data-lucide="chevron-down"></i></button>` : "";
    // A block is "timed" when its sets are. The header toggle flips the whole block
    // at once, because mixing seconds and reps inside one exercise is almost always
    // a mistake rather than an intent.
    const blockTimed = (workoutExercise.sets || []).some(isTimedSet);
    return `<article class="${articleClass}" data-workout-exercise-id="${workoutExercise.id}"><div class="exercise-header${editable ? " is-compact" : ""}"><div class="we-head-main">${dragHandle}${thumb}<div class="we-head-text"><div class="exercise-title-line"><h3>${escapeHtml(exercise.name)}</h3><span class="chip">${exercise.primaryMuscleGroup}</span></div><p class="card-caption">${blockTimed ? timedBlockCaption(workoutExercise) : `${number(exerciseVolume(workoutExercise))} кг обсягу · 1ПМ ${number(exerciseOneRepMax(workoutExercise))} кг`}</p></div></div>${editable
        ? `<div class="inline-actions we-actions-compact">${collapseToggle}<button class="icon-button we-menu-btn" type="button" title="Дії з вправою" aria-label="Дії з вправою: фокус, заміна, час, нотатка, відпочинок, видалення" data-action="ux2-ex-menu" data-workout-exercise-id="${workoutExercise.id}"><i data-lucide="more-vertical"></i></button></div>`
        : `<div class="inline-actions">${collapseToggle}${!readonly && workoutItem.status === "active" ? `<button class="icon-button" type="button" title="Фокус на цій вправі" data-action="open-focus" data-workout-exercise-id="${workoutExercise.id}"><i data-lucide="crosshair"></i></button>` : ""}${readonly ? "" : `<button class="icon-button" type="button" title="Замінити вправу" data-action="replace-exercise" data-workout-exercise-id="${workoutExercise.id}"><i data-lucide="repeat"></i></button>`}${readonly ? "" : `<button class="icon-button${blockTimed ? " is-on" : ""}" type="button" title="${blockTimed ? "Рахувати повтори" : "Рахувати час (планка, віс, утримання)"}" data-action="toggle-timed-block" data-workout-exercise-id="${workoutExercise.id}"><i data-lucide="${blockTimed ? "repeat-2" : "timer"}"></i></button>`}<button class="icon-button" type="button" title="Додати підхід" data-action="add-set" data-workout-exercise-id="${workoutExercise.id}" ${readonly ? "disabled" : ""}><i data-lucide="plus"></i></button><button class="icon-button" type="button" title="Видалити вправу" data-action="remove-workout-exercise" data-workout-exercise-id="${workoutExercise.id}" ${readonly ? "disabled" : ""}><i data-lucide="trash-2"></i></button></div>`}</div><div class="we-body"><div class="we-body-inner">${lastResults}${warmupRow}<div class="set-list">${workoutExercise.sets.length ? workoutExercise.sets.map((set, index) => (editable
            ? setRowV2(workoutExercise, set, index + 1, showSetHint, index > 0 ? workoutExercise.sets[index - 1].weight : null, isBodyweightExercise(exercise), records ? records.get(set.id) || null : null)
            : setRow(workoutExercise.id, set, readonly, index + 1, showSetHint, index > 0 ? workoutExercise.sets[index - 1].weight : null, isBodyweightExercise(exercise)))).join("") : `<p class="card-caption set-empty">${editable ? "Підходів ще немає." : "Підходів ще немає. Додай перший кнопкою «+» вище."}</p>`}</div>${editable ? `<button class="set-add" type="button" data-action="ux2-add-set" data-workout-exercise-id="${workoutExercise.id}"><i data-lucide="plus"></i>Підхід</button>` : ""}<div class="note-slot">${previousNote}${!editable || workoutExercise.notes || state.openNotes.has(`exercise:${workoutExercise.id}`) ? noteField(`exercise:${workoutExercise.id}`, "Нотатки до вправи", "Додати нотатку до вправи", workoutExercise.notes, `data-action="update-exercise-notes" data-workout-exercise-id="${workoutExercise.id}"`, readonly) : ""}</div></div></div></article>`;
}

// Small "+N кг" / "−N кг" tag showing the weight change from the previous set.
// Shown right of the "Вага, кг" label on the 2nd+ set (editor + focus mode).
export function weightDeltaBadge(prevWeight, currentWeight) {
    if (prevWeight === null || prevWeight === undefined) {
        return "";
    }
    const prev = Number(prevWeight);
    const cur = Number(currentWeight);
    if (!Number.isFinite(prev) || !Number.isFinite(cur) || prev === cur) {
        return "";
    }
    const diff = cur - prev;
    return `<span class="set-delta ${diff > 0 ? "up" : "down"}" title="Різниця ваги з попереднім підходом">${diff > 0 ? "+" : "−"}${number(Math.abs(diff))} кг</span>`;
}

// Live-refresh the "+N кг" tags as you TYPE a weight (the `input` event) — without
// re-rendering, so the caret stays put. Reads live values straight from the DOM
// inputs. Editing set N updates N's own tag (vs N−1) and the next set's tag (vs N).
export function liveUpdateWeightDeltas(input) {
    const weightValue = (el) => { const w = el && el.querySelector('input[data-field="weight"]'); return w ? (Number(w.value) || 0) : null; };
    // Focus mode shows one set at a time: read the previous set's weight from state.
    const focusField = input.closest(".focus-field");
    if (focusField) {
        const exercise = editWorkoutExercise(input.dataset.workoutExerciseId);
        const idx = exercise ? exercise.sets.findIndex((item) => item.id === input.dataset.setId) : -1;
        const prevWeight = exercise && idx > 0 ? exercise.sets[idx - 1].weight : null;
        const label = focusField.querySelector(".focus-field-label");
        if (label) { label.innerHTML = `Вага, кг${weightDeltaBadge(prevWeight, Number(input.value) || 0)}`; }
        return;
    }
    const list = input.closest(".set-list");
    if (!list) { return; }
    const rows = Array.prototype.slice.call(list.querySelectorAll(".set-row"));
    const row = input.closest(".set-row");
    const rowIndex = rows.indexOf(row);
    const relabel = (targetRow, prevWeight) => {
        const weightInput = targetRow.querySelector('input[data-field="weight"]');
        const label = weightInput ? weightInput.closest(".set-field").querySelector(".set-field-label") : null;
        if (label) { label.innerHTML = `Вага, кг${weightDeltaBadge(prevWeight, Number(weightInput.value) || 0)}`; }
    };
    if (rowIndex > 0) { relabel(row, weightValue(rows[rowIndex - 1])); }
    if (rowIndex >= 0 && rowIndex + 1 < rows.length) { relabel(rows[rowIndex + 1], weightValue(row)); }
}

function setRow(workoutExerciseId, set, readonly, index, showSetHint, prevWeight, bodyweight = false) {
    const target = `data-workout-exercise-id="${workoutExerciseId}" data-set-id="${set.id}"`;
    const lock = readonly ? "disabled" : "";
    // Coach-mark on the very first set of the first exercise (until that set is
    // done). Shows every time a workout's first exercise is added — not one-time.
    const hintOn = Boolean(showSetHint) && index === 1 && !set.isCompleted;
    const hintChip = hintOn
        ? `<div class="setdone-hint" role="status"><span>Тисни кружечок, щоб завершити</span><span class="setdone-hint-caret" aria-hidden="true"></span></div>`
        : "";
    // Reps and seconds are alternatives, not companions: a plank has no rep count and
    // a bench press has no hold time, and showing both invites logging into the wrong
    // one. Which it is lives on the SET, so one exercise can be done either way.
    const timed = isTimedSet(set);
    return `<div class="set-row ${set.isCompleted ? "completed" : ""}${hintOn ? " has-hint" : ""}">
            <div class="set-row-head">${hintChip}
                <span class="set-index">${index}</span>
                <gym-select class="set-type-select" data-action="set-field" ${target} data-field="type" ${lock}>${["warmup", "working", "drop", "failure", "backoff"].map((type) => `<option value="${type}" ${set.type === type ? "selected" : ""}>${setTypeLabel(type)}</option>`).join("")}</gym-select>
                <div class="set-row-actions">
                    <button class="icon-button set-done ${set.isCompleted ? "is-done" : ""}${hintOn ? " hinting" : ""}" type="button" title="${set.isCompleted ? "Виконано" : "Позначити виконаним"}" data-action="toggle-set" ${target} ${lock}><i data-lucide="${set.isCompleted ? "check-circle-2" : "circle"}"></i></button>
                    <button class="icon-button" type="button" title="Видалити підхід" data-action="delete-set" ${target} ${lock}><i data-lucide="trash-2"></i></button>
                </div>
            </div>
            <div class="set-fields${timed ? " is-timed" : ""}">
                <label class="set-field" title="${timed || bodyweight ? "Вага понад власну — 0, якщо без обтяження" : "Робоча вага"}"><span class="set-field-label">${weightFieldLabel({ timed, bodyweight })}${weightDeltaBadge(prevWeight, set.weight)}</span><input type="number" inputmode="decimal" step="0.5" min="0" value="${set.weight}" data-action="set-field" ${target} data-field="weight" ${lock}></label>
                ${timed
                ? `<label class="set-field"><span class="set-field-label">Час, с</span><input type="number" inputmode="numeric" step="5" min="0" value="${set.durationSeconds}" data-action="set-field" ${target} data-field="durationSeconds" ${lock}></label>`
                : `<label class="set-field"><span class="set-field-label">Повтори</span><input type="number" inputmode="numeric" step="1" min="0" value="${set.repetitions}" data-action="set-field" ${target} data-field="repetitions" ${lock}></label>`}
                <label class="set-field"><span class="set-field-label">Відпочинок, с</span><input type="number" inputmode="numeric" step="15" min="0" value="${set.restSeconds}" data-action="set-field" ${target} data-field="restSeconds" ${lock}></label>
            </div>
        </div>`;
}

/**
 * The person's best estimated 1RM for this exercise from OTHER sessions — the bar a set
 * today has to clear to be a record. Server records cover the whole history; when the
 * best one is this very session (it was finished and reopened) the loaded history
 * without it decides instead.
 */
function previousBestOneRepMax(workoutItem, exerciseId) {
    const record = recordsFor(workoutItem.userId).find((item) => item.exerciseId === exerciseId);
    if (record && record.workoutId !== workoutItem.id) {
        return Number(record.estimatedOneRepMax) || 0;
    }
    const others = workoutsFor(workoutItem.userId).filter((item) => item.id !== workoutItem.id);
    const local = kernelRecordsFor(workoutItem.userId, others, exerciseById).find((item) => item.exerciseId === exerciseId);
    return local ? Number(local.estimatedOneRepMax) || 0 : 0;
}

function setRowV2(workoutExercise, set, index, showSetHint, prevWeight, bodyweight = false, record = null) {
    const target = `data-workout-exercise-id="${workoutExercise.id}" data-set-id="${set.id}"`;
    const hintOn = Boolean(showSetHint) && index === 1 && !set.isCompleted;
    const hintChip = hintOn
        ? `<div class="setdone-hint" role="status"><span>Тисни кружечок, щоб завершити</span><span class="setdone-hint-caret" aria-hidden="true"></span></div>`
        : "";
    const timed = isTimedSet(set);
    const measureField = timed ? "durationSeconds" : "repetitions";
    const rest = Math.max(0, Math.round(Number(set.restSeconds) || 0));
    const stepper = (field, value, inputMode, step) => `<div class="set-stepper">
                <button class="set-step" type="button" data-action="set-step" data-field="${field}" data-dir="-1" ${target} aria-label="Менше">−</button>
                <input type="number" inputmode="${inputMode}" step="${step}" min="0" value="${value}" data-action="set-field" ${target} data-field="${field}">
                <button class="set-step" type="button" data-action="set-step" data-field="${field}" data-dir="1" ${target} aria-label="Більше">+</button>
            </div>`;
    const recordStrip = record
        ? `<div class="set-record" role="status"><span class="set-record-ico" aria-hidden="true"><i data-lucide="trophy"></i></span><span class="set-record-text"><strong>Новий рекорд</strong><span>1ПМ ${number(record.e1rm)} кг · +${number(record.gain)} кг до попереднього</span></span></div>`
        : "";
    return `<div class="set-row v2 kind-${escapeHtml(set.type || "working")}${set.isCompleted ? " completed" : ""}${hintOn ? " has-hint" : ""}${record ? " is-record" : ""}${record && set.id === recordFlashSetId ? " is-new" : ""}">
            <div class="set-row-head">${hintChip}
                <span class="set-index">${index}</span>
                <button class="set-type-chip" type="button" data-action="ux2-set-menu" ${target} aria-label="Тип підходу: ${escapeHtml(setTypeLabel(set.type))}. Змінити"><span>${escapeHtml(setTypeLabel(set.type))}</span></button>
                <button class="set-edit-btn" type="button" data-action="ux2-set-menu" ${target} aria-label="Редагувати підхід — тип, відпочинок, видалити" title="Редагувати підхід"><i data-lucide="pencil"></i></button>
                <button class="set-rest-chip" type="button" data-action="ux2-rest-line" ${target} aria-label="Відпочинок після підходу: ${formatRest(rest)}. Змінити"><i data-lucide="timer"></i><span>${formatRest(rest)}</span></button>
                <div class="set-row-actions">
                    <button class="icon-button set-done ${set.isCompleted ? "is-done" : ""}${hintOn ? " hinting" : ""}" type="button" title="${set.isCompleted ? "Виконано" : "Позначити виконаним"}" data-action="toggle-set" ${target}><i data-lucide="${set.isCompleted ? "check-circle-2" : "circle"}"></i></button>
                </div>
            </div>
            <div class="set-fields v2${timed ? " is-timed" : ""}">
                <div class="set-field" title="${timed || bodyweight ? "Вага понад власну — 0, якщо без обтяження" : "Робоча вага"}"><span class="set-field-label">${weightFieldLabel({ timed, bodyweight })}${weightDeltaBadge(prevWeight, set.weight)}</span>${stepper("weight", set.weight, "decimal", "0.5")}</div>
                <div class="set-field"><span class="set-field-label">${timed ? "Час, с" : "Повтори"}</span>${stepper(measureField, timed ? set.durationSeconds : set.repetitions, "numeric", timed ? "5" : "1")}</div>
            </div>${recordStrip}
        </div>`;
}

/** −/+ on a set field: by the plate step for weight, 1 rep, 5 s — straight into the input. */
export function stepSetField(workoutExerciseId, setId, field, direction) {
    const workoutExercise = editWorkoutExercise(workoutExerciseId);
    const set = workoutExercise ? workoutExercise.sets.find((item) => item.id === setId) : null;
    if (!set || !["weight", "repetitions", "durationSeconds"].includes(field)) {
        return;
    }
    const exercise = exerciseById(workoutExercise.exerciseId);
    const value = stepValue(Number(set[field]) || 0, direction * fieldStep(field, exercise.equipment), field);
    set[field] = value;
    schedulePersistWorkout(editWorkout());
    const input = document.querySelector(`input[data-set-id="${CSS.escape(setId)}"][data-field="${field}"]`);
    if (input) {
        input.value = String(value);
        if (field === "weight") {
            liveUpdateWeightDeltas(input);
        }
    }
    refreshWarmupRow(workoutExerciseId);
}

/** A «Минулого разу» chip fills its set; the chip one past the last set adds that set. */
export async function fillSetFromLast(workoutExerciseId, index) {
    const workoutExercise = editWorkoutExercise(workoutExerciseId);
    if (!workoutExercise || index < 0) {
        return;
    }
    if (index === workoutExercise.sets.length) {
        await addSet(workoutExerciseId);
    }
    const set = workoutExercise.sets[index];
    if (!set) {
        return;
    }
    ux2ApplyLast(workoutExerciseId, set.id);
}
