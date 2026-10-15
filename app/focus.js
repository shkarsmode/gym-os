// Focus mode.
import { escapeHtml, number } from "../lib/format.js";
import { isTimedSet, formatDuration, weightFieldLabel, isBodyweightExercise } from "../lib/set-format.js";
import { positionLabel, roundCount, currentRoundIndex, nextMemberInRound } from "../lib/superset.js";
import { syncGymClockTicker, touchGymClock } from "./gym-clock-ui.js";
import { lastExerciseSets } from "./history.js";
import { canManage, editWorkout, exerciseById, setTypeLabel } from "./model.js";
import { lockBackgroundScroll, unlockBackgroundScroll } from "./overlays.js";
import { schedulePersistWorkout } from "./persistence.js";
import { getPref } from "./prefs.js";
import { createSet } from "./seed.js";
import { renderSection } from "./shell.js";
import { state } from "./state.js";
import { formatRest, restPickerMarkup, supersetBlockOf, supersetRestSeconds } from "./supersets.js";
import { renderFloatingTimer, startTimer, stopTimer, timerDisplayValue } from "./timer.js";
import { createId, iconsIn, round } from "./util.js";
import { finishWorkout } from "./workout-actions.js";
import { liveUpdateWeightDeltas, pluralUk, weightDeltaBadge } from "./workout-screen.js";

// ===== Focus mode =====
// A separate full-screen flow for the active workout: one exercise, one set at
// a time — big inputs with steppers, prev-session hints, and the rest timer as
// a first-class screen (with overtime) instead of a floating card. All edits go
// through the same workout data + persist path as the normal editor, so leaving
// focus mode always lands on an up-to-date page.

// Resolve the focused workout/exercise/set, self-healing stale ids (an exercise
// or set removed elsewhere) by falling back to the first incomplete one.
function focusContext() {
    if (!state.focus) {
        return null;
    }
    const workoutItem = editWorkout();
    if (!workoutItem || workoutItem.status !== "active" || !canManage(workoutItem)) {
        return null;
    }
    const list = [...workoutItem.exercises].sort((left, right) => left.order - right.order);
    if (!list.length) {
        return null;
    }
    let index = list.findIndex((item) => item.id === state.focus.exerciseId);
    if (index === -1) {
        index = 0;
    }
    const exercise = list[index];
    let set = exercise.sets.find((item) => item.id === state.focus.setId) || null;
    if (!set) {
        set = exercise.sets.find((item) => !item.isCompleted) || exercise.sets.at(-1) || null;
    }
    state.focus.exerciseId = exercise.id;
    state.focus.setId = set ? set.id : null;

    /*
     * Focus mode used to treat every superset member as a standalone exercise: it
     * walked A1's sets to the end before ever reaching A2, which is the opposite of
     * how a superset is performed. The group is resolved here so the view can show
     * the round and the advance can go A1 → A2 → A3 → rest.
     *
     * The round is the set's own index — the same identity the rest of the app uses,
     * so nothing here can disagree with the editor.
     */
    let superset = null;
    const groupId = exercise.supersetGroupId;
    if (groupId) {
        const block = supersetBlockOf(workoutItem, groupId);
        if (block && block.members.length) {
            const setIndex = set ? exercise.sets.findIndex((item) => item.id === set.id) : -1;
            const rounds = roundCount(block.members);
            const roundIndex = setIndex === -1
                ? Math.min(currentRoundIndex(block.members), Math.max(0, rounds - 1))
                : setIndex;
            superset = {
                groupId,
                members: block.members,
                names: block.members.map((member) => exerciseById(member.exerciseId)?.name || "Вправа"),
                memberIndex: Math.max(0, block.members.findIndex((member) => member.id === exercise.id)),
                roundIndex,
                rounds,
                rest: supersetRestSeconds(workoutItem, groupId)
            };
        }
    }
    return { workout: workoutItem, list, index, exercise, set, superset };
}

export function openFocusMode(workoutExerciseId = null) {
    const workoutItem = editWorkout();
    if (!workoutItem || workoutItem.status !== "active" || !canManage(workoutItem) || !workoutItem.exercises.length) {
        return;
    }
    const list = [...workoutItem.exercises].sort((left, right) => left.order - right.order);
    const exercise = list.find((item) => item.id === workoutExerciseId)
        || list.find((item) => item.sets.some((set) => !set.isCompleted))
        || list[0];
    const set = exercise.sets.find((item) => !item.isCompleted) || exercise.sets.at(-1) || null;
    state.focus = { exerciseId: exercise.id, setId: set ? set.id : null, view: "set" };
    renderFocus();
    lockBackgroundScroll();
    renderFloatingTimer(); // focus owns the timer UI now — hide the floating card
}

export function closeFocusMode() {
    if (!state.focus) {
        return;
    }
    state.focus = null;
    // The layer keeps its markup while it fades; clear it afterwards so a live clock
    // chip cannot outlive the overlay that owns it.
    setTimeout(() => {
        const layer = document.getElementById("focusLayer");
        if (layer && !layer.classList.contains("visible")) {
            layer.innerHTML = "";
        }
        syncGymClockTicker();
    }, 320);
    const node = document.getElementById("focusLayer");
    if (node) {
        node.classList.remove("visible");
    }
    unlockBackgroundScroll();
    renderFloatingTimer(); // bring the floating timer back if rest is still running
    renderSection(); // the page underneath may be stale after focus edits
}

export function renderFocus() {
    let node = document.getElementById("focusLayer");
    if (!state.focus) {
        if (node) {
            node.classList.remove("visible");
        }
        return;
    }
    const context = focusContext();
    if (!context) {
        closeFocusMode();
        return;
    }
    if (!node) {
        node = document.createElement("div");
        node.id = "focusLayer";
        node.className = "focus-layer";
        document.body.appendChild(node);
    }
    node.innerHTML = focusMarkup(context);
    if (!node.classList.contains("visible")) {
        void node.offsetWidth; // commit the enter-from state so the transition plays
    }
    node.classList.add("visible");
    iconsIn(node);
    updateFocusTimer();
    syncGymClockTicker();
}

function focusMarkup(context) {
    const { list, index } = context;
    const chipVisible = state.timer.running && state.focus.view !== "rest";
    return `<div class="focus-shell">
            <header class="focus-topbar">
                <button class="icon-button" type="button" data-action="focus-close" title="Вийти з фокус-режиму"><i data-lucide="x"></i></button>
                <div class="focus-topbar-text">
                    <span class="focus-eyebrow">Фокус-режим</span>
                    <strong>Вправа ${index + 1} з ${list.length}</strong>
                </div>
                <button class="focus-timer-chip${chipVisible ? " visible" : ""}${state.timer.overtime ? " overtime" : ""}" type="button" data-action="focus-show-rest" id="focusTimerChip" title="Відкрити таймер відпочинку">
                    <i data-lucide="timer"></i><span id="focusTimerChipValue">${timerDisplayValue()}</span>
                </button>
            </header>
            <div class="focus-scroll">${state.focus.view === "rest" ? focusRestView(context) : focusSetView(context)}</div>
        </div>`;
}

function focusHintChip(icon, label, set) {
    return `<button class="focus-hint" type="button" data-action="focus-apply-hint" data-weight="${set.weight}" data-reps="${set.repetitions}" data-seconds="${isTimedSet(set) ? set.durationSeconds : ""}" title="Підставити ці значення">
            <span class="focus-hint-label"><i data-lucide="${icon}"></i>${label}</span>
            <strong class="focus-hint-value">${isTimedSet(set) ? `${number(set.weight) ? `${number(set.weight)} × ` : ""}${formatDuration(set.durationSeconds)}` : `${number(set.weight)} × ${set.repetitions}`}</strong>
            <span class="focus-hint-use"><i data-lucide="corner-down-left"></i></span>
        </button>`;
}

/**
 * The superset strip: which group you are in, which round, and which member.
 *
 * Without it focus mode said "Вправа 3 з 7" and nothing else, so a superset was
 * indistinguishable from three unrelated exercises that happened to follow each
 * other — the complaint that it "isn't managed at all" in focus mode.
 */
function focusSupersetStrip(superset) {
    const { names, memberIndex, roundIndex, rounds, groupId, rest } = superset;
    const dots = Array.from({ length: rounds }, (_, index) =>
        `<i class="${index < roundIndex ? "done" : index === roundIndex ? "on" : ""}"></i>`).join("");
    // Tappable, because the one thing you need mid-round that nothing else offered is
    // "go back to A1, I typed the wrong weight". Without it the only way back was to
    // leave focus mode.
    const chips = names.map((name, index) => `<button class="focus-ss-member${index === memberIndex ? " current" : ""}${index < memberIndex ? " done" : ""}" type="button" data-action="focus-jump-member" data-exercise-block-id="${escapeHtml(superset.members[index].id)}" aria-current="${index === memberIndex}">
            <span class="ss-pos">${positionLabel(index)}</span><span class="focus-ss-member-name">${escapeHtml(name)}</span>
        </button>`).join("");
    return `<div class="focus-superset" data-superset-id="${escapeHtml(groupId)}">
            <div class="focus-ss-top">
                <span class="ss-badge"><i data-lucide="repeat-2"></i>Суперсет</span>
                <span class="focus-ss-round">Раунд ${Math.min(roundIndex + 1, rounds)} з ${rounds}</span>
                <span class="ss-progress" aria-hidden="true">${dots}</span>
            </div>
            <div class="focus-ss-members">${chips}</div>
            <p class="focus-ss-hint">Поспіль, без пауз · відпочинок ${formatRest(rest)} після ${positionLabel(names.length - 1)}</p>
        </div>`;
}

/**
 * Move to another member of the CURRENT round.
 *
 * Deliberately stays on the same round rather than that member's next open set: the
 * reason to go back to A1 mid-round is to correct what was just entered there.
 */
export function focusJumpMember(exerciseBlockId) {
    const context = focusContext();
    if (!context || !context.superset || !state.focus) {
        return;
    }
    const member = context.superset.members.find((item) => item.id === exerciseBlockId);
    if (!member) {
        return;
    }
    const set = (member.sets || [])[context.superset.roundIndex];
    state.focus.exerciseId = member.id;
    state.focus.setId = set ? set.id : null;
    state.focus.view = "set";
    renderFocus();
}

/** Inside a round the button promises what happens next, not just "done". */
function supersetCtaLabel(superset) {
    if (!superset) {
        return "Підхід виконано";
    }
    const next = nextMemberInRound(superset.members, superset.roundIndex);
    const remaining = superset.members
        .map((member, index) => ({ member, index }))
        .filter(({ index }) => index !== superset.memberIndex);
    const upcoming = next !== null && next !== superset.memberIndex
        ? next
        : remaining.find(({ member }) => !((member.sets || [])[superset.roundIndex] || {}).isCompleted)?.index;
    if (upcoming !== undefined && upcoming !== null) {
        return `Готово → ${positionLabel(upcoming)}`;
    }
    return superset.roundIndex + 1 < superset.rounds ? "Раунд завершено → відпочинок" : "Останній раунд завершено";
}

function focusSetView(context) {
    const { workout: workoutItem, list, index, exercise, set, superset } = context;
    const meta = exerciseById(exercise.exerciseId);
    const sets = exercise.sets;
    const setIndex = set ? sets.findIndex((item) => item.id === set.id) : -1;
    const target = set ? `data-workout-exercise-id="${exercise.id}" data-set-id="${set.id}"` : "";
    const exerciseNav = `<div class="focus-exercise-nav">
            <button class="icon-button" type="button" data-action="focus-next-exercise" data-dir="-1" title="Попередня вправа" ${index === 0 ? "disabled" : ""}><i data-lucide="chevron-left"></i></button>
            <div class="focus-exercise-name"><h2>${escapeHtml(meta.name)}</h2><span class="chip">${escapeHtml(meta.primaryMuscleGroup)}</span></div>
            <button class="icon-button" type="button" data-action="focus-next-exercise" data-dir="1" title="Наступна вправа" ${index >= list.length - 1 ? "disabled" : ""}><i data-lucide="chevron-right"></i></button>
        </div>`;
    const dots = sets.length ? `<div class="focus-set-dots">${sets.map((item, position) => `<button class="focus-dot${item.isCompleted ? " done" : ""}${set && item.id === set.id ? " current" : ""}" type="button" data-action="focus-jump-set" data-set-id="${item.id}" title="Підхід ${position + 1}">${item.isCompleted ? `<i data-lucide="check"></i>` : position + 1}</button>`).join("")}</div>` : "";
    if (!set) {
        return `${exerciseNav}<div class="focus-set-card"><p class="card-caption" style="text-align:center;">Підходів ще немає — додай перший.</p>
                <button class="button button-primary focus-cta" type="button" data-action="focus-add-set"><i data-lucide="plus"></i>Додати підхід</button></div>`;
    }
    // The middle stepper measures whatever this set measures — never both.
    const timed = isTimedSet(set);
    const measure = timed ? "durationSeconds" : "repetitions";
    const last = lastExerciseSets(workoutItem.userId, exercise.exerciseId, workoutItem.id);
    const lastSet = last ? (last.sets[setIndex] || last.sets.at(-1)) : null;
    const previousSet = setIndex > 0 ? sets[setIndex - 1] : null;
    const hints = !set.isCompleted && (lastSet || previousSet)
        ? `<div class="focus-hints-wrap"><span class="focus-hints-caption"><i data-lucide="wand-2"></i>Натисни, щоб підставити значення</span><div class="focus-hints">${lastSet ? focusHintChip("history", "Минулого разу", lastSet) : ""}${previousSet ? focusHintChip("corner-left-up", "Попередній підхід", previousSet) : ""}</div></div>`
        : "";
    const nextExercise = list[index + 1] || null;
    /*
     * A superset drops the exercise nav and the round label from the card.
     *
     * Both were already on the strip directly above — the screen said "Раунд 2 з 5"
     * twice and named the exercise twice, and the ‹ › arrows walked OUT of the group
     * mid-round, which is not a thing anyone wants to do by accident. The card keeps
     * one heading: which position you are on and what it is.
     */
    return `${superset ? focusSupersetStrip(superset) : `${exerciseNav}${dots}`}
        <div class="focus-set-card${superset ? " in-superset" : ""}">
            <div class="focus-set-heading">
                <span class="focus-set-label">${superset
                ? `<span class="ss-pos">${positionLabel(superset.memberIndex)}</span><span class="focus-set-name">${escapeHtml(meta.name)}</span>${timed ? `<span class="chip">на час</span>` : ""}`
                : `Підхід ${setIndex + 1} з ${sets.length}${timed ? " · на час" : ""}`}</span>
                ${set.isCompleted ? `<span class="status-badge completed">Виконано</span>` : ""}
            </div>
            ${hints}
            <label class="focus-type-field">
                <span class="focus-field-label">Тип підходу</span>
                <gym-select class="set-type-select" data-action="set-field" ${target} data-field="type">${["warmup", "working", "drop", "failure", "backoff"].map((type) => `<option value="${type}" ${set.type === type ? "selected" : ""}>${setTypeLabel(type)}</option>`).join("")}</gym-select>
            </label>
            <div class="focus-fields">
                <div class="focus-field">
                    <span class="focus-field-label">${weightFieldLabel({ timed, bodyweight: isBodyweightExercise(meta) })}${weightDeltaBadge(previousSet ? previousSet.weight : null, set.weight)}</span>
                    <div class="focus-stepper">
                        <button class="focus-step" type="button" data-action="focus-step" data-field="weight" data-delta="-2.5" title="−2.5 кг"><i data-lucide="minus"></i></button>
                        <input type="number" inputmode="decimal" step="0.5" min="0" value="${set.weight}" data-action="set-field" ${target} data-field="weight">
                        <button class="focus-step" type="button" data-action="focus-step" data-field="weight" data-delta="2.5" title="+2.5 кг"><i data-lucide="plus"></i></button>
                    </div>
                </div>
                <div class="focus-field">
                    <span class="focus-field-label">${timed ? "Час, с" : "Повтори"}</span>
                    <div class="focus-stepper">
                        <button class="focus-step" type="button" data-action="focus-step" data-field="${measure}" data-delta="${timed ? -5 : -1}" title="${timed ? "−5 с" : "−1"}"><i data-lucide="minus"></i></button>
                        <input type="number" inputmode="numeric" step="${timed ? 5 : 1}" min="0" value="${timed ? set.durationSeconds : set.repetitions}" data-action="set-field" ${target} data-field="${measure}">
                        <button class="focus-step" type="button" data-action="focus-step" data-field="${measure}" data-delta="${timed ? 5 : 1}" title="${timed ? "+5 с" : "+1"}"><i data-lucide="plus"></i></button>
                    </div>
                </div>
            </div>
            ${superset ? "" : `<div class="focus-rest-field">
                <span class="focus-field-label">Відпочинок</span>
                ${`<div class="focus-stepper focus-stepper-rest">
                    <button class="focus-step" type="button" data-action="focus-step" data-field="restSeconds" data-delta="-15" title="−15 с"><i data-lucide="minus"></i></button>
                    <input type="number" inputmode="numeric" step="15" min="0" value="${set.restSeconds}" data-action="set-field" ${target} data-field="restSeconds">
                    <span class="focus-rest-unit">с</span>
                    <button class="focus-step" type="button" data-action="focus-step" data-field="restSeconds" data-delta="15" title="+15 с"><i data-lucide="plus"></i></button>
                </div>`}
            </div>`}
            ${set.isCompleted
            ? `<button class="button button-secondary focus-cta" type="button" data-action="focus-uncomplete-set"><i data-lucide="rotate-ccw"></i>Зняти позначку «виконано»</button>`
            : `<button class="button button-primary focus-cta" type="button" data-action="focus-complete-set"><i data-lucide="check"></i>${supersetCtaLabel(superset)}</button>`}
        </div>
        <div class="focus-secondary-row">
            ${superset
            // «+ Підхід» would add a set to ONE member and break the round alignment,
            // so inside a group the round control replaces it.
            ? `<button class="button button-secondary compact" type="button" data-action="superset-add-round" data-workout-id="${workoutItem.id}" data-superset-id="${escapeHtml(superset.groupId)}"><i data-lucide="plus"></i>Раунд</button>`
            : `<button class="button button-secondary compact" type="button" data-action="focus-add-set"><i data-lucide="plus"></i>Підхід</button>`}
            ${nextExercise
            ? `<button class="button button-secondary compact" type="button" data-action="focus-next-exercise" data-dir="1">Наступна вправа<i data-lucide="arrow-right"></i></button>`
            : `<button class="button button-secondary compact" type="button" data-action="focus-finish-workout"><i data-lucide="flag"></i>Завершити тренування</button>`}
        </div>`;
}

function focusRestView(context) {
    const { list, index, exercise, superset } = context;
    const meta = exerciseById(exercise.exerciseId);
    if (superset) {
        return focusSupersetRestView(context);
    }
    const nextSet = exercise.sets.find((item) => !item.isCompleted);
    const nextSetIndex = nextSet ? exercise.sets.findIndex((item) => item.id === nextSet.id) : -1;
    const nextExercise = list[index + 1] || null;
    const nextExerciseMeta = nextExercise ? exerciseById(nextExercise.exerciseId) : null;
    const doneCount = exercise.sets.filter((item) => item.isCompleted).length;
    const running = state.timer.running;
    const overtime = state.timer.overtime;
    const label = running ? (overtime ? "Час вийшов — рахуємо далі" : "Відпочинок") : "Перерва без таймера";
    const bottom = nextSet
        ? `<div class="focus-next-preview"><span>Далі</span><strong>Підхід ${nextSetIndex + 1} · ${number(nextSet.weight)} кг × ${isTimedSet(nextSet) ? formatDuration(nextSet.durationSeconds) : nextSet.repetitions}</strong></div>
               <button class="button button-primary focus-cta" type="button" data-action="focus-start-set">Почати підхід</button>`
        : `<div class="focus-done-panel">
                <p class="focus-done-title">Вправу завершено</p>
                ${nextExercise ? `<button class="button button-secondary focus-cta" type="button" data-action="focus-next-exercise" data-dir="1">Наступна: ${escapeHtml(nextExerciseMeta.name)}<i data-lucide="arrow-right"></i></button>` : ""}
                <button class="button button-primary focus-cta" type="button" data-action="open-add-exercise-modal"><i data-lucide="list-plus"></i>Додати вправу</button>
                <button class="button button-secondary focus-cta" type="button" data-action="focus-add-set"><i data-lucide="plus"></i>Додати підхід</button>
                <button class="button button-secondary focus-cta" type="button" data-action="focus-finish-workout"><i data-lucide="flag"></i>Завершити тренування</button>
            </div>`;
    return `<div class="focus-rest${overtime ? " overtime" : ""}" id="focusRest">
            <p class="focus-rest-exercise">${escapeHtml(meta.name)} · ${doneCount}/${exercise.sets.length} підходів</p>
            <p class="focus-rest-label" id="focusRestLabel">${label}</p>
            <div class="focus-ring">
                <span class="focus-ring-fill" aria-hidden="true"></span>
                <strong class="focus-ring-value" id="focusTimerValue">${running ? timerDisplayValue() : "—"}</strong>
            </div>
            ${running ? `<div class="focus-rest-controls">
                <button class="chip chip-button" type="button" data-action="timer-add" data-delta="-15">−15 с</button>
                <button class="chip chip-button" type="button" data-action="timer-stop">Стоп</button>
                <button class="chip chip-button" type="button" data-action="timer-add" data-delta="15">+15 с</button>
            </div>` : ""}
            ${bottom}
        </div>`;
}

/**
 * Rest between rounds.
 *
 * Differs from the per-set rest screen in what it promises next: not "set 3 of 4" of
 * the exercise you just did, but the FIRST member of the next round — which is where
 * the athlete actually goes. The timer length is the group's, editable right here, so
 * "four minutes is not enough" is a two-tap fix without leaving focus mode.
 */
function focusSupersetRestView(context) {
    const { superset } = context;
    const { members, names, roundIndex, rounds, rest, groupId } = superset;
    const running = state.timer.running;
    const overtime = state.timer.overtime;
    // focusCompleteSet has ALREADY moved the context on to the round about to be
    // done, so `roundIndex` is that round — adding one to it here counted the same
    // round twice and declared the superset finished after round 2 of 3.
    //
    // Whether anything is left is therefore not arithmetic on an index whose meaning
    // shifts between the two ways of arriving here: it is simply whether the round we
    // are pointing at has already been done.
    // The first round still to be done, whatever route led here. Adding a round from
    // the finished panel makes one available again, and asking "is the round we are
    // pointing at complete" kept answering yes about the round that had just ended.
    const upcomingRound = currentRoundIndex(members);
    const finished = upcomingRound >= rounds;
    const label = running ? (overtime ? "Час вийшов — рахуємо далі" : "Відпочинок після раунду") : "Перерва без таймера";
    const firstSet = ((members[0] || {}).sets || [])[upcomingRound] || null;
    const bottom = finished
        ? `<div class="focus-done-panel">
                <p class="focus-done-title">Суперсет завершено · ${rounds} ${pluralUk(rounds, "раунд", "раунди", "раундів")}</p>
                <button class="button button-secondary focus-cta" type="button" data-action="superset-add-round" data-workout-id="${context.workout.id}" data-superset-id="${escapeHtml(groupId)}"><i data-lucide="plus"></i>Ще один раунд</button>
                <button class="button button-primary focus-cta" type="button" data-action="focus-next-exercise" data-dir="1">Далі<i data-lucide="arrow-right"></i></button>
                <button class="button button-secondary focus-cta" type="button" data-action="focus-finish-workout"><i data-lucide="flag"></i>Завершити тренування</button>
            </div>`
        : `<div class="focus-next-preview">
                   <span>Далі · раунд ${upcomingRound + 1} з ${rounds}</span>
                   <strong>${positionLabel(0)} ${escapeHtml(names[0] || "Вправа")}${firstSet ? ` · ${number(firstSet.weight)} кг × ${isTimedSet(firstSet) ? formatDuration(firstSet.durationSeconds) : firstSet.repetitions}` : ""}</strong>
               </div>
               <button class="button button-primary focus-cta" type="button" data-action="focus-start-set">Почати раунд ${upcomingRound + 1}</button>`;
    return `<div class="focus-rest${overtime ? " overtime" : ""}" id="focusRest">
            <p class="focus-rest-exercise"><span class="ss-badge"><i data-lucide="repeat-2"></i>Суперсет</span> ${escapeHtml(names.join(" · "))}</p>
            <p class="focus-rest-label" id="focusRestLabel">${label}</p>
            <div class="focus-ring">
                <span class="focus-ring-fill" aria-hidden="true"></span>
                <strong class="focus-ring-value" id="focusTimerValue">${running ? timerDisplayValue() : "—"}</strong>
            </div>
            ${running ? `<div class="focus-rest-controls">
                <button class="chip chip-button" type="button" data-action="timer-add" data-delta="-15">−15 с</button>
                <button class="chip chip-button" type="button" data-action="timer-stop">Стоп</button>
                <button class="chip chip-button" type="button" data-action="timer-add" data-delta="15">+15 с</button>
            </div>` : ""}
            <div class="focus-ss-restedit">
                <span class="focus-field-label">Відпочинок після раунду</span>
                ${restPickerMarkup(rest, { action: "superset-set-rest", extraAttrs: `data-superset-id="${escapeHtml(groupId)}"` })}
            </div>
            ${bottom}
        </div>`;
}

// Per-tick DOM update inside the focus layer (no re-render: inputs keep focus).
export function updateFocusTimer() {
    if (!state.focus) {
        return;
    }
    const chip = document.getElementById("focusTimerChip");
    if (chip) {
        chip.classList.toggle("visible", state.timer.running && state.focus.view !== "rest");
        chip.classList.toggle("overtime", state.timer.overtime);
        const chipValue = document.getElementById("focusTimerChipValue");
        if (chipValue) {
            chipValue.textContent = timerDisplayValue();
        }
    }
    const value = document.getElementById("focusTimerValue");
    if (value && state.timer.running) {
        value.textContent = timerDisplayValue();
    }
    const rest = document.getElementById("focusRest");
    if (rest) {
        const ratio = state.timer.overtime ? 1 : (state.timer.duration > 0 ? Math.max(0, Math.min(1, state.timer.remaining / state.timer.duration)) : 0);
        rest.style.setProperty("--timer-ratio", String(ratio));
    }
}

// Countdown crossed zero (or the timer stopped): the rest screen swaps its
// layout, the set screen only re-tints its chip — never re-render inputs mid-typing.
export function renderFocusTimerPhase() {
    if (!state.focus) {
        return;
    }
    if (state.focus.view === "rest") {
        renderFocus();
    } else {
        updateFocusTimer();
    }
}

export async function focusCompleteSet() {
    const context = focusContext();
    if (!context || !context.set || context.set.isCompleted) {
        return;
    }
    context.set.isCompleted = true;
    touchGymClock(context.workout);

    if (context.superset) {
        // Inside a superset the rest belongs to the ROUND. Move straight to the next
        // member with no timer at all; only once the round is complete does the shared
        // rest start and the screen hand over to the rest view.
        const { members, roundIndex, rounds, rest } = context.superset;
        const nextIndex = nextMemberInRound(members, roundIndex);
        if (nextIndex !== null) {
            const member = members[nextIndex];
            state.focus.exerciseId = member.id;
            state.focus.setId = ((member.sets || [])[roundIndex] || {}).id || null;
            state.focus.view = "set";
        } else {
            const nextRound = roundIndex + 1;
            const first = members[0];
            if (nextRound < rounds) {
                startTimer(rest);
                state.focus.exerciseId = first.id;
                state.focus.setId = ((first.sets || [])[nextRound] || {}).id || null;
            } else {
                state.focus.setId = context.set.id;
            }
            state.focus.view = "rest";
        }
    } else {
        startTimer(context.set.restSeconds || Number(getPref("defaultRest")) || 90);
        const next = context.exercise.sets.find((item) => !item.isCompleted);
        state.focus.setId = next ? next.id : context.set.id;
        state.focus.view = "rest";
    }
    context.workout.updatedAt = new Date().toISOString();
    // Debounced (650ms) rather than immediate: focus mode is tapped rapidly set
    // after set, and each save rewrites the whole workout tree server-side. The
    // three focus handlers are the only high-frequency save sites — the other 18
    // call sites (create, finish, delete) stay immediate.
    schedulePersistWorkout(context.workout);
    renderFocus();
}

export async function focusUncompleteSet() {
    const context = focusContext();
    if (!context || !context.set) {
        return;
    }
    context.set.isCompleted = false;
    touchGymClock(context.workout);
    context.workout.updatedAt = new Date().toISOString();
    schedulePersistWorkout(context.workout);
    renderFocus();
}

export async function focusAddSet() {
    const context = focusContext();
    if (!context) {
        return;
    }
    const previousSet = context.exercise.sets.at(-1);
    const newSet = previousSet
        ? { ...previousSet, id: createId("set"), isCompleted: false }
        : createSet(getPref("defaultSetType"), 0, 8, 8, Number(getPref("defaultRest")) || 90, false);
    context.exercise.sets.push(newSet);
    state.focus.setId = newSet.id;
    state.focus.view = "set";
    context.workout.updatedAt = new Date().toISOString();
    schedulePersistWorkout(context.workout);
    renderFocus();
}

export function focusShiftExercise(direction) {
    const context = focusContext();
    if (!context) {
        return;
    }
    const target = context.list[context.index + direction];
    if (!target) {
        return;
    }
    state.focus.exerciseId = target.id;
    state.focus.setId = (target.sets.find((item) => !item.isCompleted) || target.sets[0] || null)?.id || null;
    state.focus.view = "set";
    renderFocus();
}

export function focusJumpSet(setId) {
    if (!state.focus) {
        return;
    }
    state.focus.setId = setId;
    state.focus.view = "set";
    renderFocus();
}

// Leave the rest screen for the next set ("skip rest" / "start set").
export function focusStartSet() {
    if (!state.focus) {
        return;
    }
    const context = focusContext();
    // Inside a superset "start the round" has to POINT at that round's first set, not
    // just flip the view: arriving from the finished panel — after «+ Раунд» made a
    // new round available — leaves the context on the set that was just completed, so
    // flipping alone would reopen the round that had already ended.
    if (context && context.superset) {
        const { members } = context.superset;
        const round = currentRoundIndex(members);
        const first = members[0];
        const set = ((first || {}).sets || [])[round];
        if (first && set) {
            state.focus.exerciseId = first.id;
            state.focus.setId = set.id;
        }
    }
    state.focus.view = "set";
    stopTimer();
    renderFocus();
}

export function focusShowRest() {
    if (!state.focus) {
        return;
    }
    state.focus.view = "rest";
    renderFocus();
}

export function focusApplyHint(weight, reps, seconds) {
    const context = focusContext();
    if (!context || !context.set) {
        return;
    }
    context.set.weight = Number(weight) || 0;
    // The hint carries whichever measure the set it came from was recorded in. A
    // timed hint must not write a rep count into a plank, and a rep hint must not
    // leave a stale hold time behind — so the two are set as a pair.
    if (seconds !== undefined && seconds !== null && seconds !== "") {
        context.set.durationSeconds = Number(seconds) || 0;
        context.set.repetitions = 0;
    } else {
        context.set.repetitions = Number(reps) || 0;
        context.set.durationSeconds = null;
    }
    schedulePersistWorkout(context.workout);
    renderFocus();
}

export function focusStepField(field, delta) {
    const context = focusContext();
    if (!context || !context.set) {
        return;
    }
    const value = Math.max(0, round((Number(context.set[field]) || 0) + delta, 2));
    context.set[field] = value;
    schedulePersistWorkout(context.workout);
    const input = document.querySelector(`#focusLayer input[data-field="${field}"]`);
    if (input) {
        input.value = value;
        if (field === "weight") {
            liveUpdateWeightDeltas(input); // steppers set value programmatically (no input event)
        }
    }
}

export async function focusFinishWorkout() {
    const context = focusContext();
    if (!context) {
        closeFocusMode();
        return;
    }
    const workoutId = context.workout.id;
    closeFocusMode();
    await finishWorkout(workoutId);
}
