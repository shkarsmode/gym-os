// The warm-up row and sheet (the formula is lib/warmup.js).
import { escapeHtml, number } from "../lib/format.js";
import { isBodyweightExercise, isTimedSet } from "../lib/set-format.js";
import { FIELD_LIMITS, fieldStep, stepValue } from "../lib/session.js";
import {
    planWarmup, isWarmupEligible, warmupPrefill, muscleAlreadyWarm, warmupStillUseful, applyWarmupSets,
    minWorkingRest, openWorkingSets
} from "../lib/warmup.js";
import { latestDoneSets } from "./history.js";
import { currentUser, editWorkout, editWorkoutExercise, exerciseById, setTypeLabel } from "./model.js";
import { closeOverlay, element, showSyncIndicator } from "./overlays.js";
import { persistWorkout } from "./persistence.js";
import { getPref } from "./prefs.js";
import { createSet } from "./seed.js";
import { ux2LastSets, ux2Sheet, ux2Thumb } from "./sheets.js";
import { renderSection } from "./shell.js";
import { formatRest } from "./supersets.js";
import { icons } from "./util.js";
import { watchedPrevious } from "./watch.js";
import { pluralUk } from "./workout-screen.js";

// ---- Warm-up: sets that climb to the working weight (formula: lib/warmup.js) ------------

// The sheet's numbers while it is open: the working set to warm up for, how many working
// sets there are, and whether the muscle is already warm — worked out from the session,
// but the person can say otherwise.
export let warmupDraft = null;

/** Exercises before this one in the session that have sets: the ones that warmed it up. */
function warmupPreviousExercises(workoutItem, workoutExercise) {
    const exercises = workoutItem?.exercises || [];
    const index = exercises.findIndex((item) => item.id === workoutExercise.id);
    return exercises.slice(0, Math.max(0, index))
        .filter((item) => (item.sets || []).length > 0)
        .map((item) => exerciseById(item.exerciseId))
        .filter(Boolean);
}

/** Not for holds, core or cardio, not inside a superset (a round is the Nth set of
 *  every member — extra sets on one of them would shift every round), and only until
 *  the first working set is done. */
export function warmupAvailable(workoutExercise, exercise) {
    return isWarmupEligible(exercise) && !workoutExercise.supersetGroupId && warmupStillUseful(workoutExercise.sets);
}

function warmupLoadText(weight, bodyweight) {
    if (bodyweight) {
        return weight > 0 ? `+${number(weight)} кг` : "без ваги";
    }
    return `${number(weight)} кг`;
}

/** The visible way in: a row right above the sets, there until a working set is done. */
export function warmupInlineRow(workoutItem, workoutExercise, exercise, lastSets) {
    if (!warmupAvailable(workoutExercise, exercise)) {
        return "";
    }
    const bodyweight = isBodyweightExercise(exercise);
    const prefill = warmupPrefill(workoutExercise.sets, lastSets?.sets, bodyweight);
    const hasWarmups = workoutExercise.sets.some((set) => set.type === "warmup");
    let detail = "Вкажи робочу вагу — порахую підходи";
    if (prefill) {
        const warm = muscleAlreadyWarm(warmupPreviousExercises(workoutItem, workoutExercise), exercise);
        const plan = planWarmup({ weight: prefill.weight, reps: prefill.reps, exercise, warm });
        if (!plan.length) {
            return "";
        }
        // Once warm-ups exist the count would only restate the default plan, which may not
        // be the one that was picked (the «already warm» switch) — so just the target.
        detail = `до ${warmupLoadText(prefill.weight, bodyweight)} × ${prefill.reps}${hasWarmups ? "" : ` · ${plan.length} ${pluralUk(plan.length, "підхід", "підходи", "підходів")}`}`;
    }
    return `<button class="warmup-cta${hasWarmups ? " is-quiet" : ""}" type="button" data-action="warmup-open" data-workout-exercise-id="${workoutExercise.id}">
            <span class="warmup-cta-ico"><i data-lucide="flame"></i></span>
            <span class="warmup-cta-text"><strong>${hasWarmups ? "Перерахувати розминку" : "Розминка"}</strong><span>${escapeHtml(detail)}</span></span>
            <i data-lucide="chevron-right" class="warmup-cta-chev"></i>
        </button>`;
}

/**
 * Repaints one exercise's warm-up row in place. A set's numbers change without a
 * re-render (−/+ and typing keep the caret and the scroll), so without this the row
 * kept saying «до 115 кг» after the working set had been raised to 120.
 */
export function refreshWarmupRow(workoutExerciseId) {
    const card = document.querySelector(`.workout-exercise[data-workout-exercise-id="${CSS.escape(String(workoutExerciseId))}"]`);
    const workoutItem = editWorkout();
    const workoutExercise = editWorkoutExercise(workoutExerciseId);
    if (!card || !workoutItem || !workoutExercise || workoutItem.userId !== currentUser().id) {
        return;
    }
    const exercise = exerciseById(workoutExercise.exerciseId);
    const lastSets = watchedPrevious(workoutItem, workoutExercise.exerciseId) || latestDoneSets(workoutItem.userId, workoutExercise.exerciseId, workoutItem.id);
    const html = warmupInlineRow(workoutItem, workoutExercise, exercise, lastSets);
    const current = card.querySelector(".warmup-cta");
    if (current) {
        if (html) {
            current.outerHTML = html;
        } else {
            current.remove();
        }
    } else if (html) {
        card.querySelector(".set-list")?.insertAdjacentHTML("beforebegin", html);
    }
    icons();
}

const WARMUP_MAX_WORKING = 10;

export function openWarmupSheet(workoutExerciseId) {
    const workoutItem = editWorkout();
    const workoutExercise = editWorkoutExercise(workoutExerciseId);
    if (!workoutItem || !workoutExercise) {
        closeOverlay();
        return;
    }
    const exercise = exerciseById(workoutExercise.exerciseId);
    const last = ux2LastSets(workoutItem, workoutExercise.exerciseId);
    const prefill = warmupPrefill(workoutExercise.sets, last?.sets, isBodyweightExercise(exercise));
    const warm = muscleAlreadyWarm(warmupPreviousExercises(workoutItem, workoutExercise), exercise);
    // As many working sets as there are; with none yet, as many as last time; else one.
    const lastWorking = (last?.sets || []).filter((set) => set.type === "working" && !isTimedSet(set)).length;
    warmupDraft = {
        workoutExerciseId,
        weight: prefill ? prefill.weight : 0,
        reps: prefill ? prefill.reps : 8,
        count: Math.min(WARMUP_MAX_WORKING, openWorkingSets(workoutExercise.sets).length || lastWorking || 1),
        source: prefill ? prefill.source : null,
        warm,
        warmAuto: warm
    };
    renderWarmupSheet();
}

/** What the working sets become — the preview and the button use the same numbers. */
function warmupWorking(exercise) {
    return {
        weight: warmupDraft.weight,
        reps: warmupDraft.reps,
        count: warmupDraft.count,
        restSeconds: Number(getPref("defaultRest")) || 90,
        minRest: minWorkingRest(exercise)
    };
}

/**
 * The draft worked through: the plan, and the exercise's sets exactly as applying it
 * would leave them. The preview IS that outcome — the same function run on a copy — so
 * what the sheet shows is what the button does.
 */
function warmupDraftState() {
    const workoutExercise = warmupDraft ? editWorkoutExercise(warmupDraft.workoutExerciseId) : null;
    const exercise = workoutExercise ? exerciseById(workoutExercise.exerciseId) : null;
    if (!exercise) {
        return null;
    }
    const bodyweight = isBodyweightExercise(exercise);
    const plan = planWarmup({ weight: warmupDraft.weight, reps: warmupDraft.reps, exercise, warm: warmupDraft.warm });
    const ready = warmupDraft.reps > 0 && (bodyweight || warmupDraft.weight > 0);
    // A preview set remembers its step of the plan for the «%» beside it; plan weights
    // only ever climb, so the weight finds it.
    const previewSet = (type, weight, reps, restSeconds) => {
        const step = type === "warmup" ? plan.find((item) => item.weight === weight) : null;
        return { id: null, type, weight, repetitions: reps, restSeconds, isCompleted: false, durationSeconds: null, note: step?.note || null, pct: step?.pct ?? null };
    };
    const outcome = ready
        ? applyWarmupSets(workoutExercise.sets.map((set) => ({ ...set })), plan, warmupWorking(exercise), previewSet)
        : [];
    return {
        workoutExercise,
        exercise,
        bodyweight,
        plan,
        ready,
        before: new Map(workoutExercise.sets.map((set) => [set.id, set])),
        outcome,
        shown: outcome.filter((set) => set.type === "warmup" && !set.id),
        pending: workoutExercise.sets.filter((set) => set.type === "warmup" && !set.isCompleted).length,
        hasWork: workoutExercise.sets.some((set) => set.type !== "warmup")
    };
}

function warmupPreviewHtml(draft) {
    if (!draft.ready) {
        return `<p class="warmup-empty">Вкажи вагу й повтори робочого підходу — і тут з'являться підходи розминки.</p>`;
    }
    if (!draft.shown.length) {
        return `<p class="warmup-empty">Для такої ваги окрема розминка не потрібна — можна одразу робочий підхід.</p>`;
    }
    const row = (position, set, note, kind = "") => `<li class="warmup-row${kind ? ` is-${kind}` : ""}">
                <span class="warmup-num">${kind === "done" ? `<i data-lucide="check"></i>` : position}</span>
                <span class="warmup-load">${warmupLoadHtml(set, draft.bodyweight)}</span>
                <span class="warmup-note">${escapeHtml(note)}</span>
                <span class="warmup-rest">${set.restSeconds && kind !== "done" ? `<i data-lucide="timer"></i>${formatRest(set.restSeconds)}` : ""}</span>
            </li>`;
    // Every set the exercise will have, in order: what was done stays, the warm-ups, then
    // the working sets — each saying whether its numbers change — then anything else.
    const rows = draft.outcome.map((set, index) => {
        if (set.isCompleted) {
            return row(index + 1, set, "виконано", "done");
        }
        if (set.type === "warmup") {
            return row(index + 1, set, set.note || (set.pct ? `${set.pct}%` : ""));
        }
        if (set.type === "working" && !isTimedSet(set)) {
            const was = set.id ? draft.before.get(set.id) : null;
            const changed = was && (Number(was.weight) !== Number(set.weight) || Number(was.repetitions) !== Number(set.repetitions));
            return row(index + 1, set, !was ? "новий робочий" : changed ? `було ${warmupShortText(was, draft.bodyweight)}` : "робочий", "work");
        }
        return row(index + 1, set, setTypeLabel(set.type).toLowerCase(), "kept");
    }).join("");
    const last = draft.shown.at(-1);
    const why = last.pct
        ? `Останній підхід розминки — ${last.pct}% робочої ваги, після нього ${formatRest(last.restSeconds)} відпочинку: мʼязи готові, а втома встигає зійти. Кожен підхід легкий — далеко від відмови.`
        : `Розминка легка, далеко від відмови, а перед робочим — ${formatRest(last.restSeconds)} відпочинку.`;
    return `<ol class="warmup-list">${rows}</ol><p class="warmup-why">${escapeHtml(why)}</p>`;
}

function warmupLoadHtml(set, bodyweight) {
    const load = escapeHtml(warmupLoadText(Number(set.weight) || 0, bodyweight));
    return isTimedSet(set) ? `${load} <b>· ${Number(set.durationSeconds) || 0} с</b>` : `${load} <b>× ${Number(set.repetitions) || 0}</b>`;
}

/** «60 × 6» — what a working set held before, beside what it will hold. */
function warmupShortText(set, bodyweight) {
    const weight = Number(set.weight) || 0;
    return `${bodyweight ? (weight > 0 ? `+${number(weight)}` : "0") : number(weight)} × ${Number(set.repetitions) || 0}`;
}

function warmupApplyLabel(draft) {
    const count = draft.shown.length;
    if (!count) {
        return { text: draft.ready ? "Розминка не потрібна" : "Вкажи робочий підхід", disabled: true };
    }
    const what = `${count} ${pluralUk(count, "підхід", "підходи", "підходів")}`;
    if (draft.pending) {
        return { text: `Замінити розминку · ${what}`, disabled: false };
    }
    return { text: draft.hasWork ? `Додати розминку · ${what}` : `Додати розминку й ${warmupDraft.count > 1 ? "робочі" : "робочий"}`, disabled: false };
}

function renderWarmupSheet() {
    const draft = warmupDraftState();
    if (!draft) {
        closeOverlay();
        return;
    }
    const field = (name, value, inputMode, step, label) => `<div class="set-field"><span class="set-field-label">${label}</span><div class="set-stepper">
                <button class="set-step" type="button" data-action="warmup-step" data-field="${name}" data-dir="-1" aria-label="Менше">−</button>
                <input id="warmup-${name}" type="number" inputmode="${inputMode}" step="${step}" min="0" value="${value}" data-action="warmup-field" data-field="${name}">
                <button class="set-step" type="button" data-action="warmup-step" data-field="${name}" data-dir="1" aria-label="Більше">+</button>
            </div></div>`;
    const source = warmupDraft.source === "last"
        ? "Як минулого разу — зміни, якщо сьогодні інакше"
        : warmupDraft.source === "set" ? "З твого першого робочого підходу" : "Скільки плануєш у робочому підході";
    const warmHint = warmupDraft.warmAuto
        ? "Попередня вправа вже працювала на цей мʼяз — досить 1–2 підходів"
        : "Увімкни, якщо мʼяз уже працював сьогодні — тоді 1–2 підходи";
    const apply = warmupApplyLabel(draft);
    ux2Sheet("Розминка", `<div class="ux2-sheet-block">
                <span class="ux2-sheet-label">Робочий підхід</span>
                <div class="warmup-inputs">${field("weight", warmupDraft.weight, "decimal", "0.5", draft.bodyweight ? "Дод. вага, кг" : "Вага, кг")}${field("reps", warmupDraft.reps, "numeric", "1", "Повтори")}</div>
                <p class="warmup-source">${escapeHtml(source)}</p>
                <div class="warmup-count-row"><span>Робочих підходів</span><div class="ux2-stepper"><button class="ux2-round-btn" type="button" data-action="warmup-count" data-delta="-1" aria-label="На один менше"><i data-lucide="minus"></i></button><strong id="warmupCount">${warmupDraft.count}</strong><button class="ux2-round-btn" type="button" data-action="warmup-count" data-delta="1" aria-label="На один більше"><i data-lucide="plus"></i></button></div></div>
            </div>
            <div class="ux2-switch-row"><span><strong>Мʼяз уже розігрітий</strong><span>${escapeHtml(warmHint)}</span></span><label class="settings-switch"><input type="checkbox" data-action="warmup-warm" ${warmupDraft.warm ? "checked" : ""} aria-label="Мʼяз уже розігрітий"><span></span></label></div>
            <div class="ux2-sheet-block"><span class="ux2-sheet-label">Підходи</span><div id="warmupPreview">${warmupPreviewHtml(draft)}</div></div>
            <button class="button button-primary ux2-wide" type="button" data-action="warmup-apply" id="warmupApply" ${apply.disabled ? "disabled" : ""}><i data-lucide="flame"></i><span>${escapeHtml(apply.text)}</span></button>`, {
        caption: draft.exercise.name,
        lead: ux2Thumb(draft.exercise)
    });
}

/** Typing or ± in the sheet repaints the plan only — the inputs keep focus and caret. */
export function refreshWarmupPreview() {
    const draft = warmupDraftState();
    if (!draft) {
        return;
    }
    const preview = element("warmupPreview");
    if (preview) {
        preview.innerHTML = warmupPreviewHtml(draft);
    }
    const button = element("warmupApply");
    if (button) {
        const apply = warmupApplyLabel(draft);
        button.disabled = apply.disabled;
        const label = button.querySelector("span");
        if (label) {
            label.textContent = apply.text;
        }
    }
    icons();
}

export function warmupStep(field, direction) {
    const draft = warmupDraftState();
    if (!draft || !direction) {
        return;
    }
    if (field === "weight") {
        warmupDraft.weight = stepValue(warmupDraft.weight, direction * fieldStep("weight", draft.exercise.equipment), "weight");
    } else {
        warmupDraft.reps = Math.max(1, Math.min(100, Math.round(Number(warmupDraft.reps) || 0) + direction));
    }
    const input = element(`warmup-${field}`);
    if (input) {
        input.value = String(field === "weight" ? warmupDraft.weight : warmupDraft.reps);
    }
    refreshWarmupPreview();
}

export function warmupCount(delta) {
    if (!warmupDraft || !delta) {
        return;
    }
    warmupDraft.count = Math.max(1, Math.min(WARMUP_MAX_WORKING, warmupDraft.count + delta));
    const shown = element("warmupCount");
    if (shown) {
        shown.textContent = String(warmupDraft.count);
    }
    refreshWarmupPreview();
}

export function warmupSetField(field, raw) {
    if (!warmupDraft) {
        return;
    }
    const value = Number(String(raw ?? "").replace(",", "."));
    if (field === "weight") {
        warmupDraft.weight = Number.isFinite(value) && value > 0 ? Math.min(value, FIELD_LIMITS.weight.max) : 0;
    } else {
        warmupDraft.reps = Number.isFinite(value) && value > 0 ? Math.min(100, Math.round(value)) : 0;
    }
    refreshWarmupPreview();
}

export async function applyWarmup() {
    const draft = warmupDraftState();
    const workoutItem = editWorkout();
    if (!draft || !workoutItem || !draft.shown.length) {
        return;
    }
    const { workoutExercise } = draft;
    const before = new Set(workoutExercise.sets);
    const next = applyWarmupSets(workoutExercise.sets, draft.plan, warmupWorking(draft.exercise), (type, weight, reps, restSeconds) => createSet(type, weight, reps, null, restSeconds, false));
    const added = next.filter((set) => !before.has(set) && set.type === "warmup").length;
    workoutExercise.sets.splice(0, workoutExercise.sets.length, ...next);
    warmupDraft = null;
    closeOverlay();
    await persistWorkout(workoutItem);
    renderSection();
    showSyncIndicator("success", `Розминка · ${added} ${pluralUk(added, "підхід", "підходи", "підходів")}`);
}
