// Supersets: creating, managing, the superset block.
import { escapeHtml } from "../lib/format.js";
import { isTimedSet, weightFieldLabel, isBodyweightExercise } from "../lib/set-format.js";
import {
    SUPERSET_MIN_MEMBERS, SUPERSET_MAX_MEMBERS, SUPERSET_DEFAULT_ROUNDS, SUPERSET_DEFAULT_REST, positionLabel,
    workoutBlocks, roundCount, roundSets, isRoundComplete, currentRoundIndex, missingSetCount, mergeProblem,
    roundSummary
} from "../lib/superset.js";
import { openPaywallModal } from "./account.js";
import { renderFocus } from "./focus.js";
import { touchGymClock } from "./gym-clock-ui.js";
import { canManage, editWorkout, exerciseById, hasUnlimited } from "./model.js";
import {
    choiceDialog, closeOverlay, closeSheet, confirmDialog, element, openModal, openSheet, toast
} from "./overlays.js";
import { persistWorkout } from "./persistence.js";
import { getPref } from "./prefs.js";
import { createSet } from "./seed.js";
import { renderSection } from "./shell.js";
import { state } from "./state.js";
import { createId, iconsIn } from "./util.js";
import { pluralUk } from "./workout-screen.js";

// ---- Creating a superset --------------------------------------------------------------

/** PRO-only, and the pref decides whether the action is offered at all. */
export function supersetsEnabled() {
    return getPref("useSupersets") === "1";
}

/**
 * Gate the feature, showing the paywall only when somebody actually reaches for it.
 *
 * Discoverability without nagging: a free account still SEES the action with a PRO
 * mark, and finds out what it costs at the moment it becomes relevant rather than
 * during onboarding.
 */
function requireSupersetPro() {
    if (hasUnlimited()) {
        return true;
    }
    openPaywallModal({ type: "superset" });
    return false;
}

export const SUPERSET_BUILDER_MIN_ROUNDS = 2;

export const SUPERSET_BUILDER_MAX_ROUNDS = 12;

export const supersetBuilder = { workoutId: null, picked: [], rounds: SUPERSET_DEFAULT_ROUNDS, restSeconds: SUPERSET_DEFAULT_REST };

/**
 * Turn the chosen exercises into a group.
 *
 * Members are renumbered CONTIGUOUSLY from the first one's position, because that
 * adjacency is what lets `order` place a block both in the workout and inside its
 * group — the reason there is no separate position column.
 */
export async function createSupersetFrom(workoutId, exerciseBlockIds, options = {}) {
    const workoutItem = editWorkout();
    if (!workoutItem || !canManage(workoutItem) || !requireSupersetPro()) {
        return;
    }
    const chosen = exerciseBlockIds
        .map((blockId) => (workoutItem.exercises || []).find((item) => item.id === blockId))
        .filter(Boolean);
    const problem = mergeProblem(chosen);
    if (problem) {
        toast("Не вдалося обʼєднати", problem);
        return;
    }
    const groupId = createId("superset");
    const rounds = Math.max(1, Math.round(Number(options.rounds) || SUPERSET_DEFAULT_ROUNDS));
    const rest = Math.max(0, Math.round(Number(options.restSeconds) || SUPERSET_DEFAULT_REST));
    const anchorOrder = Math.min(...chosen.map((item) => Number(item.order) || 0));

    // Everything at or below the group slides down by however many members there are,
    // so they can sit shoulder to shoulder without colliding with anything.
    const others = (workoutItem.exercises || []).filter((item) => !chosen.includes(item));
    others.forEach((item) => {
        if ((Number(item.order) || 0) >= anchorOrder) {
            item.order = (Number(item.order) || 0) + chosen.length;
        }
    });
    chosen.forEach((member, index) => {
        member.supersetGroupId = groupId;
        member.order = anchorOrder + index;
        member.sets = member.sets || [];
        // Level every member to the same number of rounds. Sets already logged are
        // kept — merging must never cost somebody work they already did.
        for (let missing = missingSetCount(member, rounds); missing > 0; missing -= 1) {
            const previous = member.sets.at(-1);
            member.sets.push(previous
                ? { ...previous, id: createId("set"), isCompleted: false }
                : createSet("working", 0, 10, 8, rest, false));
        }
    });
    workoutItem.supersetGroups = [...(workoutItem.supersetGroups || []), { id: groupId, restSeconds: rest }];
    workoutItem.updatedAt = new Date().toISOString();
    await persistWorkout(workoutItem);
    closeOverlay();
    renderSection();
    toast("Суперсет створено", `${chosen.length} ${pluralUk(chosen.length, "вправа", "вправи", "вправ")} · ${rounds} ${pluralUk(rounds, "раунд", "раунди", "раундів")}`);
}

/**
 * The builder: pick 2–3 exercises already in the workout, set rounds and rest.
 *
 * Built from what is ALREADY in the session rather than from the catalogue, because
 * that is the moment a superset is actually decided — you put the exercises down and
 * then choose to pair them. It also means there is no second exercise-picking flow to
 * learn, and «+ Вправа» keeps working exactly as it did.
 */
export function openSupersetBuilder(workoutId) {
    const workoutItem = editWorkout();
    if (!workoutItem || !canManage(workoutItem)) {
        return;
    }
    const loose = workoutBlocks(workoutItem.exercises)
        .filter((block) => block.kind === "exercise")
        .map((block) => block.exercise);
    // Asked BEFORE the paywall: offering to sell something that cannot be done yet
    // for a reason that has nothing to do with the plan is the wrong answer.
    if (loose.length < SUPERSET_MIN_MEMBERS) {
        const missing = SUPERSET_MIN_MEMBERS - loose.length;
        toast("Ще нема чого обʼєднувати", missing === 1
            ? "Додай ще одну вправу — у суперсеті їх щонайменше дві."
            : "Додай дві вправи — саме їх суперсет і чергує.");
        return;
    }
    if (!requireSupersetPro()) {
        return;
    }
    supersetBuilder.workoutId = workoutItem.id;
    supersetBuilder.picked = [];
    supersetBuilder.rounds = SUPERSET_DEFAULT_ROUNDS;
    supersetBuilder.restSeconds = SUPERSET_DEFAULT_REST;
    openModal(supersetBuilderMarkup(workoutItem, loose));
}

function supersetBuilderMarkup(workoutItem, loose) {
    const rows = loose.map((exercise) => {
        const meta = exerciseById(exercise.exerciseId);
        const at = supersetBuilder.picked.indexOf(exercise.id);
        const chosen = at !== -1;
        return `<button class="ss-pick${chosen ? " active" : ""}" type="button" role="checkbox" aria-checked="${chosen}" data-action="superset-pick" data-exercise-block-id="${exercise.id}">
                <span class="ss-pick-mark">${chosen ? positionLabel(at) : ""}</span>
                <span class="ss-pick-name">${escapeHtml(meta?.name || "Вправа")}</span>
                <span class="ss-pick-muscle">${escapeHtml(meta?.primaryMuscleGroup || "")}</span>
            </button>`;
    }).join("");
    const problem = mergeProblem(supersetBuilder.picked
        .map((id) => (workoutItem.exercises || []).find((item) => item.id === id))
        .filter(Boolean));
    const restOpts = { action: "superset-builder-rest" };
    const roundsStepper = stepperMarkup({
        value: supersetBuilder.rounds, action: "superset-builder-rounds",
        down: `data-rounds-delta="-1"`, up: `data-rounds-delta="1"`,
        downLabel: "Менше раундів", upLabel: "Більше раундів",
        downOff: supersetBuilder.rounds <= SUPERSET_BUILDER_MIN_ROUNDS,
        upOff: supersetBuilder.rounds >= SUPERSET_BUILDER_MAX_ROUNDS
    });
    const picked = supersetBuilder.picked.length;
    return `<div class="modal-header"><div><h2>Новий суперсет</h2><p class="card-caption">Обери 2–3 вправи — вони йдуть поспіль, відпочинок один, після раунду.</p></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="Закрити"><i data-lucide="x"></i></button></div>
            <span class="ss-step-label">${picked ? `Обрано ${picked} з ${SUPERSET_MAX_MEMBERS}` : "Обери вправи"}</span>
            <div class="ss-picks" id="supersetPicks">${rows}</div>
            <div class="ss-group">
                ${ssRow("Раундів", roundsStepper)}
                ${ssRow("Відпочинок після раунду", restStepperMarkup(supersetBuilder.restSeconds, restOpts), { extra: restPresetsMarkup(supersetBuilder.restSeconds, restOpts) })}
            </div>
            ${problem && supersetBuilder.picked.length ? `<p class="ob-error" role="alert"><i data-lucide="alert-circle"></i>${escapeHtml(problem)}</p>` : ""}
            <div class="form-actions" style="justify-content:flex-end;margin-top:16px;">
                <button class="button button-secondary" type="button" data-action="close-overlay">Скасувати</button>
                <button class="button button-primary" type="button" data-action="superset-create" ${problem ? "disabled" : ""}><i data-lucide="repeat-2"></i>Створити суперсет</button>
            </div>`;
}

export function toggleSupersetPick(exerciseBlockId) {
    const at = supersetBuilder.picked.indexOf(exerciseBlockId);
    if (at === -1) {
        if (supersetBuilder.picked.length >= SUPERSET_MAX_MEMBERS) {
            toast("Максимум три", `У суперсеті не більше ${SUPERSET_MAX_MEMBERS} вправ.`);
            return;
        }
        supersetBuilder.picked.push(exerciseBlockId);
    } else {
        supersetBuilder.picked.splice(at, 1);
    }
    refreshSupersetBuilder();
}

export function refreshSupersetBuilder() {
    const workoutItem = editWorkout();
    const layer = element("modalLayer");
    if (!workoutItem || !layer || !supersetBuilder.workoutId) {
        return;
    }
    const loose = workoutBlocks(workoutItem.exercises)
        .filter((block) => block.kind === "exercise")
        .map((block) => block.exercise);
    layer.innerHTML = supersetBuilderMarkup(workoutItem, loose);
    iconsIn(layer);
}

// ---- Superset actions ----------------------------------------------------------------

export function supersetBlockOf(workoutItem, groupId) {
    return workoutBlocks(workoutItem.exercises).find((block) => block.kind === "superset" && block.groupId === groupId) || null;
}

/**
 * Add one round to every member at once.
 *
 * A round only exists when every member has that set — a group where A1 has four sets
 * and A2 has three is not "three and a half rounds", it is a broken round nobody can
 * finish. Each new set copies the member's own previous one, which is what the athlete
 * almost always wants and what the ordinary «+» already does.
 */
export async function supersetAddRound(workoutId, groupId) {
    const workoutItem = editWorkout();
    if (!workoutItem || !canManage(workoutItem)) {
        return;
    }
    const block = supersetBlockOf(workoutItem, groupId);
    if (!block) {
        return;
    }
    const target = roundCount(block.members) + 1;
    block.members.forEach((member) => {
        member.sets = member.sets || [];
        for (let index = missingSetCount(member, target); index > 0; index -= 1) {
            const previous = member.sets.at(-1);
            member.sets.push(previous
                ? { ...previous, id: createId("set"), isCompleted: false }
                : createSet(getPref("defaultSetType"), 0, 8, 8, Number(getPref("defaultRest")) || 90, false));
        }
    });
    workoutItem.updatedAt = new Date().toISOString();
    await persistWorkout(workoutItem);
    renderSection();
    // Pressing the button in focus mode is a request to DO that round, so land on it.
    // Without this the screen stayed on the finished round it was already showing and
    // only the counter moved, which reads as the button having done nothing.
    if (state.focus && block.members.some((member) => member.id === state.focus.exerciseId)) {
        const first = block.members[0];
        const set = ((first || {}).sets || [])[currentRoundIndex(block.members)];
        if (first && set) {
            state.focus.exerciseId = first.id;
            state.focus.setId = set.id;
            state.focus.view = "set";
        }
    }
    if (state.focus) {
        renderFocus();
    }
    // The sheet shows the round count it just changed — redraw it so the number and
    // the disabled state of «−» stay truthful without closing the menu.
    if (!element("modalBackdrop2").classList.contains("hidden")) {
        openSupersetMenu(workoutItem.id, groupId);
    }
}

export async function supersetRemoveRound(workoutId, groupId) {
    const workoutItem = editWorkout();
    if (!workoutItem || !canManage(workoutItem)) {
        return;
    }
    const block = supersetBlockOf(workoutItem, groupId);
    const rounds = block ? roundCount(block.members) : 0;
    if (!block || rounds <= 1) {
        return;
    }
    const removed = roundSets(block.members, rounds - 1).filter(Boolean);
    const done = removed.filter((set) => set.isCompleted).length;
    const confirmed = await confirmDialog(`Раунд ${rounds}`, {
        title: "Прибрати останній раунд?",
        detail: done ? `${done} ${pluralUk(done, "підхід", "підходи", "підходів")} у ньому вже виконано` : "Підходи в ньому не виконані",
        confirmLabel: "Прибрати"
    });
    if (!confirmed) {
        return;
    }
    block.members.forEach((member) => {
        if ((member.sets || []).length >= rounds) {
            member.sets = member.sets.slice(0, rounds - 1);
        }
    });
    touchGymClock(workoutItem);
    workoutItem.updatedAt = new Date().toISOString();
    await persistWorkout(workoutItem);
    renderSection();
    if (state.focus) {
        renderFocus();
    }
    // The sheet shows the round count it just changed — redraw it so the number and
    // the disabled state of «−» stay truthful without closing the menu.
    if (!element("modalBackdrop2").classList.contains("hidden")) {
        openSupersetMenu(workoutItem.id, groupId);
    }
}

/**
 * Break the group up, keeping every set exactly where it is.
 *
 * Splitting is the SAFE way out of a superset and has to read as clearly different
 * from deleting one: the exercises stay in the workout, in the same order, with the
 * same results. Only the grouping goes.
 */
export async function supersetSplit(workoutId, groupId) {
    const workoutItem = editWorkout();
    if (!workoutItem || !canManage(workoutItem)) {
        return;
    }
    const block = supersetBlockOf(workoutItem, groupId);
    if (!block) {
        return;
    }
    const confirmed = await confirmDialog(`${block.members.length} ${pluralUk(block.members.length, "вправа", "вправи", "вправ")}`, {
        title: "Розділити на окремі вправи?",
        detail: "Вправи, підходи й результати залишаться — зникне лише групування в раунди.",
        confirmLabel: "Розділити",
        danger: false
    });
    if (!confirmed) {
        return;
    }
    applySupersetSplit(workoutItem, groupId);
    workoutItem.updatedAt = new Date().toISOString();
    await persistWorkout(workoutItem);
    renderSection();
    toast("Суперсет розділено", "Вправи лишились на місці");
}

/** The mutation behind splitting — shared with the paths that dissolve a group. */
function applySupersetSplit(workoutItem, groupId) {
    (workoutItem.exercises || []).forEach((exercise) => {
        if (exercise.supersetGroupId === groupId) {
            exercise.supersetGroupId = null;
        }
    });
    workoutItem.supersetGroups = (workoutItem.supersetGroups || []).filter((group) => group.id !== groupId);
}

/**
 * A group of one is not a group.
 *
 * Called after any removal. Dissolving rather than refusing the removal is what keeps
 * "remove this exercise" from having a surprising second meaning.
 */
function dissolveLoneSuperset(workoutItem, groupId) {
    const block = supersetBlockOf(workoutItem, groupId);
    if (!block || block.members.length >= SUPERSET_MIN_MEMBERS) {
        return false;
    }
    applySupersetSplit(workoutItem, groupId);
    return true;
}

/**
 * The rest a superset member earns for closing a round, or null if the round is not
 * finished yet.
 *
 * Rest belongs to the round: A1 is followed straight away by A2, and only when the
 * last unfinished member of that round is ticked does anybody actually stop. Returning
 * null for every other tick is what keeps a timer from firing between A1 and A2.
 */
export function supersetRoundRestFor(workoutExercise, setId) {
    const groupId = workoutExercise.supersetGroupId;
    const workoutItem = editWorkout();
    if (!groupId || !workoutItem) {
        return null;
    }
    const block = supersetBlockOf(workoutItem, groupId);
    if (!block) {
        return null;
    }
    const roundIndex = (workoutExercise.sets || []).findIndex((item) => item.id === setId);
    if (roundIndex === -1 || !isRoundComplete(block.members, roundIndex)) {
        return null;
    }
    return supersetRestSeconds(workoutItem, groupId);
}

// ---- Superset management menu ---------------------------------------------------------
//
// One sheet for everything the group can do, so the card itself keeps a single icon
// instead of the six an exercise card already carries. The three destructive actions
// are worded and coloured apart on purpose: removing ONE exercise, SPLITTING the group,
// and DELETING the whole thing are routinely confused, and only one of them loses work.

export function openSupersetMenu(workoutId, groupId) {
    const workoutItem = editWorkout();
    const block = workoutItem ? supersetBlockOf(workoutItem, groupId) : null;
    if (!workoutItem || !block || !canManage(workoutItem)) {
        return;
    }
    const rounds = roundCount(block.members);
    const rest = supersetRestSeconds(workoutItem, groupId);
    const canAdd = block.members.length < SUPERSET_MAX_MEMBERS;
    const memberRows = block.members.map((member, index) => {
        const meta = exerciseById(member.exerciseId);
        const first = index === 0;
        const last = index === block.members.length - 1;
        return `<div class="ss-menu-member">
                <span class="ss-pos">${positionLabel(index)}</span>
                <span class="ss-menu-name">${escapeHtml(meta?.name || "Вправа")}</span>
                <span class="ss-menu-tools">
                    <button class="icon-button" type="button" title="Вище" aria-label="Пересунути ${positionLabel(index)} вище" data-action="superset-move-member" data-superset-id="${escapeHtml(groupId)}" data-exercise-block-id="${member.id}" data-dir="-1" ${first ? "disabled" : ""}><i data-lucide="arrow-up"></i></button>
                    <button class="icon-button" type="button" title="Нижче" aria-label="Пересунути ${positionLabel(index)} нижче" data-action="superset-move-member" data-superset-id="${escapeHtml(groupId)}" data-exercise-block-id="${member.id}" data-dir="1" ${last ? "disabled" : ""}><i data-lucide="arrow-down"></i></button>
                    <button class="icon-button" type="button" title="Замінити вправу" aria-label="Замінити ${positionLabel(index)}" data-action="replace-exercise" data-workout-exercise-id="${member.id}"><i data-lucide="repeat"></i></button>
                    <button class="icon-button danger" type="button" title="Прибрати з суперсету" aria-label="Прибрати ${positionLabel(index)} з суперсету" data-action="superset-remove-member" data-superset-id="${escapeHtml(groupId)}" data-exercise-block-id="${member.id}"><i data-lucide="unlink"></i></button>
                </span>
            </div>`;
    }).join("");
    const restOpts = { action: "superset-set-rest", extraAttrs: `data-superset-id="${escapeHtml(groupId)}"` };
    openSheet(`<div class="modal-header"><div><h2>Суперсет</h2><p class="card-caption">${block.members.length} ${pluralUk(block.members.length, "вправа", "вправи", "вправ")} · ${rounds} ${pluralUk(rounds, "раунд", "раунди", "раундів")}</p></div><button class="icon-button" type="button" data-action="close-sheet" aria-label="Закрити"><i data-lucide="x"></i></button></div>
            <div class="ss-menu-members">${memberRows}</div>
            ${canAdd ? `<button class="button button-secondary compact ss-menu-add" type="button" data-action="superset-add-member" data-superset-id="${escapeHtml(groupId)}"><i data-lucide="plus"></i>Додати третю вправу</button>` : ""}
            <div class="ss-group">
                ${ssRow("Раунди", `<div class="ss-stepper"><button class="ss-step" type="button" aria-label="Прибрати раунд" data-action="superset-remove-round" data-superset-id="${escapeHtml(groupId)}" ${rounds <= 1 ? "disabled" : ""}><i data-lucide="minus"></i></button><strong>${rounds}</strong><button class="ss-step" type="button" aria-label="Додати раунд" data-action="superset-add-round" data-superset-id="${escapeHtml(groupId)}"><i data-lucide="plus"></i></button></div>`)}
                ${ssRow("Відпочинок після раунду", restStepperMarkup(rest, restOpts), { extra: restPresetsMarkup(rest, restOpts) })}
            </div>
            <div class="ss-menu-danger">
                <button class="button button-secondary" type="button" data-action="superset-split" data-superset-id="${escapeHtml(groupId)}"><i data-lucide="split"></i><span><strong>Розділити на окремі вправи</strong><em>Вправи й результати залишаються</em></span></button>
                <button class="button button-danger" type="button" data-action="superset-delete" data-superset-id="${escapeHtml(groupId)}"><i data-lucide="trash-2"></i><span><strong>Видалити весь суперсет</strong><em>Разом з усіма підходами</em></span></button>
            </div>`);
}

/** Reorder A1/A2/A3 by swapping `order` with the neighbour, group-internally. */
export async function supersetMoveMember(groupId, exerciseBlockId, direction) {
    const workoutItem = editWorkout();
    const block = workoutItem ? supersetBlockOf(workoutItem, groupId) : null;
    if (!block || !canManage(workoutItem)) {
        return;
    }
    const at = block.members.findIndex((member) => member.id === exerciseBlockId);
    const to = at + Number(direction);
    if (at === -1 || to < 0 || to >= block.members.length) {
        return;
    }
    const moving = block.members[at];
    const other = block.members[to];
    const movingOrder = moving.order;
    moving.order = other.order;
    other.order = movingOrder;
    workoutItem.updatedAt = new Date().toISOString();
    await persistWorkout(workoutItem);
    renderSection();
    openSupersetMenu(workoutItem.id, groupId);
}

/**
 * Take one exercise out of the group.
 *
 * It stays in the workout with all of its sets — this is the "I paired the wrong two"
 * action, not a delete. If that leaves a single member the group dissolves, because a
 * superset of one is not a superset.
 */
export async function supersetRemoveMember(groupId, exerciseBlockId) {
    const workoutItem = editWorkout();
    const block = workoutItem ? supersetBlockOf(workoutItem, groupId) : null;
    const member = block ? block.members.find((item) => item.id === exerciseBlockId) : null;
    if (!member || !canManage(workoutItem)) {
        return;
    }
    const name = exerciseById(member.exerciseId)?.name || "Вправа";
    const confirmed = await confirmDialog(`«${name}»`, {
        title: "Прибрати з суперсету?",
        detail: "Вправа залишиться у тренуванні з усіма підходами — вийде лише з групи.",
        confirmLabel: "Прибрати",
        danger: false
    });
    if (!confirmed) {
        return;
    }
    member.supersetGroupId = null;
    const dissolved = dissolveLoneSuperset(workoutItem, groupId);
    workoutItem.updatedAt = new Date().toISOString();
    await persistWorkout(workoutItem);
    closeSheet();
    renderSection();
    if (dissolved) {
        toast("Суперсет розпався", "Лишилась одна вправа — вона стала звичайною");
    }
}

/** Add a third exercise by picking one already in the workout. */
export async function supersetAddMember(groupId) {
    const workoutItem = editWorkout();
    const block = workoutItem ? supersetBlockOf(workoutItem, groupId) : null;
    if (!block || !canManage(workoutItem) || !requireSupersetPro()) {
        return;
    }
    const loose = workoutBlocks(workoutItem.exercises)
        .filter((item) => item.kind === "exercise")
        .map((item) => item.exercise);
    if (!loose.length) {
        toast("Немає що додати", "Спершу додай вправу до тренування.");
        return;
    }
    const choice = await choiceDialog("Яку вправу додати третьою?", {
        title: "Третя вправа",
        closable: true,
        choices: loose.slice(0, 8).map((exercise) => ({
            label: exerciseById(exercise.exerciseId)?.name || "Вправа",
            value: exercise.id
        }))
    });
    if (!choice) {
        return;
    }
    const joining = loose.find((exercise) => exercise.id === choice);
    if (!joining) {
        return;
    }
    const rounds = roundCount(block.members);
    const lastOrder = Math.max(...block.members.map((member) => Number(member.order) || 0));
    (workoutItem.exercises || []).forEach((item) => {
        if (item !== joining && (Number(item.order) || 0) > lastOrder) {
            item.order = (Number(item.order) || 0) + 1;
        }
    });
    joining.supersetGroupId = groupId;
    joining.order = lastOrder + 1;
    joining.sets = joining.sets || [];
    for (let missing = missingSetCount(joining, rounds); missing > 0; missing -= 1) {
        const previous = joining.sets.at(-1);
        joining.sets.push(previous
            ? { ...previous, id: createId("set"), isCompleted: false }
            : createSet("working", 0, 10, 8, supersetRestSeconds(workoutItem, groupId), false));
    }
    workoutItem.updatedAt = new Date().toISOString();
    await persistWorkout(workoutItem);
    renderSection();
    toast("Вправу додано", `${exerciseById(joining.exerciseId)?.name || "Вправа"} · ${positionLabel(block.members.length)}`);
}

export async function supersetSetRest(groupId, seconds) {
    const workoutItem = editWorkout();
    const group = workoutItem ? supersetGroupOf(workoutItem, groupId) : null;
    if (!group || !canManage(workoutItem) || !requireSupersetPro()) {
        return;
    }
    group.restSeconds = Math.max(0, Math.min(3600, Math.round(Number(seconds))));
    workoutItem.updatedAt = new Date().toISOString();
    await persistWorkout(workoutItem);
    renderSection();
    // The picker shows the value it just set, so whichever surface is showing it has
    // to be redrawn — otherwise the readout and the active preset lag one tap behind.
    if (state.focus) {
        renderFocus();
    }
    if (!element("modalBackdrop2").classList.contains("hidden")) {
        openSupersetMenu(workoutItem.id, groupId);
    }
}

/**
 * Delete the group AND its exercises.
 *
 * The only one of the three that loses work, so it says exactly how much.
 */
export async function supersetDelete(groupId) {
    const workoutItem = editWorkout();
    const block = workoutItem ? supersetBlockOf(workoutItem, groupId) : null;
    if (!block || !canManage(workoutItem)) {
        return;
    }
    const setCount = block.members.reduce((sum, member) => sum + (member.sets || []).length, 0);
    const doneCount = block.members.reduce((sum, member) => sum + (member.sets || []).filter((set) => set.isCompleted).length, 0);
    const confirmed = await confirmDialog(`${block.members.length} ${pluralUk(block.members.length, "вправа", "вправи", "вправ")}`, {
        title: "Видалити весь суперсет?",
        detail: `Зникнуть ${setCount} ${pluralUk(setCount, "підхід", "підходи", "підходів")}${doneCount ? `, з них ${doneCount} виконано` : ""}. Щоб залишити вправи, обери «Розділити».`,
        confirmLabel: "Видалити"
    });
    if (!confirmed) {
        return;
    }
    const removedIds = new Set(block.members.map((member) => member.id));
    workoutItem.exercises = (workoutItem.exercises || []).filter((item) => !removedIds.has(item.id));
    workoutItem.supersetGroups = (workoutItem.supersetGroups || []).filter((group) => group.id !== groupId);
    touchGymClock(workoutItem);
    workoutItem.updatedAt = new Date().toISOString();
    await persistWorkout(workoutItem, { confirmEmpty: true });
    closeSheet();
    renderSection();
    toast("Суперсет видалено", `${block.members.length} ${pluralUk(block.members.length, "вправа", "вправи", "вправ")} · ${setCount} ${pluralUk(setCount, "підхід", "підходи", "підходів")}`);
}

// ---- Superset block ------------------------------------------------------------------
//
// ONE card for the whole group, not two or three stacked exercise cards. What a person
// does in the gym is a ROUND — A1, then A2, then A3, then rest — so the card is a list
// of rounds rather than a list of exercises: the current round is open, finished ones
// collapse to a single line you can reopen, and the rest belongs to the round rather
// than to any one set inside it.

function supersetGroupOf(workoutItem, groupId) {
    return (workoutItem.supersetGroups || []).find((group) => group.id === groupId) || null;
}

export function supersetRestSeconds(workoutItem, groupId) {
    const group = supersetGroupOf(workoutItem, groupId);
    return Math.max(0, Math.round(Number(group?.restSeconds ?? SUPERSET_DEFAULT_REST)));
}

/**
 * Rest picker — a stepper plus presets, not a fixed dropdown.
 *
 * The old control was a six-option select (1:00 … 4:00), which could express neither
 * "thirty seconds is plenty" nor "four minutes is not enough". Rest is the one number
 * in a superset the athlete tunes most, so it takes any value: ±15 s steps, a direct
 * numeric field, and presets for the values people actually reach for.
 */
const REST_PRESETS = [30, 45, 60, 90, 120, 180, 300];

/**
 * The value is stated ONCE.
 *
 * This used to be a seconds input, a preset grid AND a mm:ss readout — three controls
 * saying the same number in two different units, which is why the sheet read as a
 * pile. Now: the value itself in mm:ss with ±15 s on either side, and presets under
 * it. Every value is still reachable; none of them is spelled twice.
 */
function stepperMarkup({ value, action, extraAttrs = "", down, up, downLabel, upLabel, downOff = false, upOff = false }) {
    return `<div class="ss-stepper">
            <button class="ss-step" type="button" aria-label="${downLabel}" data-action="${action}" ${extraAttrs} ${down} ${downOff ? "disabled" : ""}><i data-lucide="minus"></i></button>
            <strong>${value}</strong>
            <button class="ss-step" type="button" aria-label="${upLabel}" data-action="${action}" ${extraAttrs} ${up} ${upOff ? "disabled" : ""}><i data-lucide="plus"></i></button>
        </div>`;
}

function restStepperMarkup(seconds, { action, extraAttrs = "" }) {
    const value = Math.max(0, Math.round(Number(seconds) || 0));
    return stepperMarkup({
        value: formatRest(value), action, extraAttrs,
        down: `data-rest-delta="-15"`, up: `data-rest-delta="15"`,
        downLabel: "Менше на 15 секунд", upLabel: "Більше на 15 секунд",
        downOff: value <= 0
    });
}

function restPresetsMarkup(seconds, { action, extraAttrs = "" }) {
    const value = Math.max(0, Math.round(Number(seconds) || 0));
    return `<div class="rest-presets">${REST_PRESETS.map((preset) =>
        `<button class="rest-preset${preset === value ? " active" : ""}" type="button" data-action="${action}" ${extraAttrs} data-rest="${preset}">${formatRest(preset)}</button>`).join("")}</div>`;
}

/** Stacked form, for the rest screen where the picker is the only thing on the line. */
export function restPickerMarkup(seconds, options) {
    return `<div class="rest-picker">${restStepperMarkup(seconds, options)}${restPresetsMarkup(seconds, options)}</div>`;
}

/**
 * One sheet row: what it is on the left, the control that changes it on the right.
 *
 * `extra` takes the whole line underneath — for a control (the rest presets) too wide
 * to sit beside its label but which must not push the label out of alignment with the
 * rows above it.
 */
function ssRow(label, control, { extra = "" } = {}) {
    return `<div class="ss-row"><span class="ss-row-label">${label}</span><div class="ss-row-control">${control}</div>${extra ? `<div class="ss-row-extra">${extra}</div>` : ""}</div>`;
}

/** Resolve what a rest control was asked to do: a preset, a step, or a typed value. */
export function resolveRestValue(actionElement, current) {
    if (actionElement.dataset.rest !== undefined) {
        return Math.max(0, Math.round(Number(actionElement.dataset.rest) || 0));
    }
    if (actionElement.dataset.restDelta !== undefined) {
        return Math.max(0, current + Math.round(Number(actionElement.dataset.restDelta) || 0));
    }
    return Math.max(0, Math.min(3600, Math.round(Number(actionElement.value) || 0)));
}

export function formatRest(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    return total < 60 ? `${total} с` : `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function supersetBlockEditor(workoutItem, block, readonly) {
    const { groupId, members } = block;
    const rounds = roundCount(members);
    const current = currentRoundIndex(members);
    const finished = rounds > 0 && current >= rounds;
    const names = members.map((member) => exerciseById(member.exerciseId)?.name || "Вправа");
    const rest = supersetRestSeconds(workoutItem, groupId);
    const progress = rounds
        ? `<span class="ss-progress" aria-hidden="true">${Array.from({ length: rounds }, (_, index) =>
            `<i class="${index < current ? "done" : index === current ? "on" : ""}"></i>`).join("")}</span>`
        : "";
    const heading = finished
        ? "Суперсет завершено"
        : rounds ? `Раунд ${Math.min(current + 1, rounds)} з ${rounds}` : "Раундів ще немає";
    return `<article class="superset-block${finished ? " is-done" : ""}" data-superset-id="${escapeHtml(groupId)}">
            <div class="ss-head">
                <div class="ss-head-text">
                    <div class="ss-title-line"><span class="ss-badge"><i data-lucide="repeat-2"></i>Суперсет</span><span class="ss-count">${members.length} ${pluralUk(members.length, "вправа", "вправи", "вправ")}</span></div>
                    <p class="ss-names">${escapeHtml(names.join(" · "))}</p>
                    <div class="ss-status">${progress}<span>${escapeHtml(heading)}</span></div>
                </div>
                ${readonly ? "" : `<button class="icon-button" type="button" title="Керування суперсетом" aria-label="Керування суперсетом" data-action="open-superset-menu" data-superset-id="${escapeHtml(groupId)}" data-workout-id="${workoutItem.id}"><i data-lucide="more-vertical"></i></button>`}
            </div>
            <div class="ss-rounds">${Array.from({ length: rounds }, (_, index) =>
            supersetRoundRow(workoutItem, block, index, current, readonly, rest)).join("")}</div>
            ${readonly ? "" : `<div class="ss-foot"><button class="button button-secondary compact" type="button" data-action="superset-add-round" data-superset-id="${escapeHtml(groupId)}" data-workout-id="${workoutItem.id}"><i data-lucide="plus"></i>Раунд</button><span class="ss-rest-note"><i data-lucide="timer"></i>Відпочинок ${formatRest(rest)}</span></div>`}
        </article>`;
}

/**
 * One round.
 *
 * Open when it is the round being done, or when the athlete deliberately reopened a
 * finished one — a completed round has to stay editable, because the commonest reason
 * to look at it is that a number went in wrong.
 */
function supersetRoundRow(workoutItem, block, roundIndex, currentIndex, readonly, rest) {
    const { groupId, members } = block;
    const sets = roundSets(members, roundIndex);
    const done = isRoundComplete(members, roundIndex);
    const reopened = Boolean(state.supersetOpenRounds[`${groupId}:${roundIndex}`]);
    const open = reopened || (!done && roundIndex === currentIndex);
    const summary = sets.map((set) => roundSummary(set)).join(" · ");
    if (!open) {
        return `<button class="ss-round is-collapsed${done ? " is-done" : ""}" type="button" data-action="superset-open-round" data-superset-id="${escapeHtml(groupId)}" data-round="${roundIndex}">
                <span class="ss-round-no">${done ? `<i data-lucide="check"></i>` : roundIndex + 1}</span>
                <span class="ss-round-summary">${escapeHtml(summary)}</span>
                <i data-lucide="chevron-down" class="ss-round-caret"></i>
            </button>`;
    }
    const rows = members.map((member, memberIndex) => supersetMemberRow(member, memberIndex, roundIndex, readonly)).join("");
    return `<div class="ss-round is-open${done ? " is-done" : ""}">
            <div class="ss-round-head">
                <span class="ss-round-no">${roundIndex + 1}</span>
                <span class="ss-round-label">Раунд ${roundIndex + 1}</span>
                ${readonly ? "" : `<button class="ss-round-collapse" type="button" data-action="superset-close-round" data-superset-id="${escapeHtml(groupId)}" data-round="${roundIndex}" aria-label="Згорнути раунд"><i data-lucide="chevron-up"></i></button>`}
            </div>
            ${rows}
            ${readonly ? "" : `<div class="ss-round-rest"><i data-lucide="timer"></i>Відпочинок після раунду · ${formatRest(rest)}</div>`}
        </div>`;
}

function supersetMemberRow(member, memberIndex, roundIndex, readonly) {
    const set = (member.sets || [])[roundIndex];
    const exercise = exerciseById(member.exerciseId);
    if (!set) {
        return `<div class="ss-member is-missing"><span class="ss-pos">${positionLabel(memberIndex)}</span><span class="ss-member-name">${escapeHtml(exercise?.name || "Вправа")}</span><span class="card-caption">немає підходу</span></div>`;
    }
    const timed = isTimedSet(set);
    const bodyweight = isBodyweightExercise(exercise);
    const target = `data-workout-exercise-id="${member.id}" data-set-id="${set.id}"`;
    const lock = readonly ? "disabled" : "";
    // Two rows, not three: who it is, then the numbers WITH the tick. A round of three
    // exercises has to fit a phone without scrolling between its own members, and the
    // stacked label-above-input field the ordinary card uses costs 66px per number.
    return `<div class="ss-member${set.isCompleted ? " is-done" : ""}">
            <div class="ss-member-head">
                <span class="ss-pos">${positionLabel(memberIndex)}</span>
                <span class="ss-member-name">${escapeHtml(exercise?.name || "Вправа")}</span>
            </div>
            <div class="ss-member-fields">
                <label class="set-field" title="${weightFieldLabel({ timed, bodyweight })}"><span class="set-field-label">кг</span><input type="number" inputmode="decimal" step="0.5" min="0" value="${set.weight}" aria-label="${escapeHtml(weightFieldLabel({ timed, bodyweight }))}" data-action="set-field" ${target} data-field="weight" ${lock}></label>
                ${timed
                ? `<label class="set-field" title="Час, секунд"><span class="set-field-label">с</span><input type="number" inputmode="numeric" step="5" min="0" value="${set.durationSeconds}" aria-label="Час, секунд" data-action="set-field" ${target} data-field="durationSeconds" ${lock}></label>`
                : `<label class="set-field" title="Повтори"><span class="set-field-label">повт</span><input type="number" inputmode="numeric" step="1" min="0" value="${set.repetitions}" aria-label="Повтори" data-action="set-field" ${target} data-field="repetitions" ${lock}></label>`}
                <button class="icon-button set-done ${set.isCompleted ? "is-done" : ""}" type="button" title="${set.isCompleted ? "Виконано" : "Позначити виконаним"}" aria-label="${escapeHtml(`${positionLabel(memberIndex)} ${exercise?.name || "Вправа"}`)} — ${set.isCompleted ? "виконано" : "позначити виконаним"}" data-action="toggle-set" ${target} ${lock}><i data-lucide="${set.isCompleted ? "check-circle-2" : "circle"}"></i></button>
            </div>
        </div>`;
}

export function formatDurationLabel(minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    if (total < 60) {
        return `${total} хв`;
    }
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    return rest ? `${hours} год ${rest} хв` : `${hours} год`;
}
