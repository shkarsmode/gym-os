// Workout sheets: ⋯ / ⋮ / set / rest / reorder / «як минулого разу».
import { escapeHtml, formatDate, shortDate } from "../lib/format.js";
import { isTimedSet } from "../lib/set-format.js";
import { positionLabel, workoutBlocks } from "../lib/superset.js";
import { sessionSetLabels, pairedLast, numberDraft } from "../lib/session.js";
import { exerciseMedia } from "./components.js";
import { touchGymClock } from "./gym-clock-ui.js";
import { latestDoneSets } from "./history.js";
import {
    editSetByIds, editWorkout, editWorkoutExercise, exerciseById, hasUnlimited, setTypeLabel, workoutDateBounds,
    workoutLabel, workoutTypeLabel
} from "./model.js";
import { closeOverlay, openModal, showSyncIndicator } from "./overlays.js";
import { persistWorkout, schedulePersistWorkout } from "./persistence.js";
import { getPref } from "./prefs.js";
import { autoDuration } from "./scoring-bridge.js";
import { createSet } from "./seed.js";
import { settingsSwitch } from "./settings.js";
import { renderSection } from "./shell.js";
import {
    formatDurationLabel, formatRest, supersetRestSeconds, supersetSetRest, supersetsEnabled
} from "./supersets.js";
import { warmupAvailable } from "./warmup-ui.js";
import { updateSetField } from "./workout-actions.js";
import { pluralUk } from "./workout-screen.js";

// ===== Workout sheets ======================================================================
//
// The bottom sheets of the workout screen: the ⋯ menu of a workout, the ⋮ menu of an
// exercise, a set's type / rest / delete, the rest picker, the exercise order and «як
// минулого разу». They came from the experimental full-screen session view (0.67–0.68),
// which the owner tried and replaced with his classic screen; that view was removed in
// 0.73.1 and only these sheets, which the classic screen uses, remain. The `ux2` prefix
// on their names and data-actions is that history, nothing more.

export function ux2Title(workoutItem) {
    const type = workoutItem.workoutType;
    return type && type !== "custom" ? workoutTypeLabel(type) : workoutLabel(workoutItem);
}

/** m:ss — how a hold is read off a stopwatch. */
function ux2Clock(totalSeconds) {
    const total = Math.max(0, Math.round(Number(totalSeconds) || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** A set the way it is said out loud: 92,5 × 6 · 20 × 0:45 · 12 повт · 0:45. */
function ux2SetText(set) {
    if (!set) {
        return "—";
    }
    const weight = Number(set.weight) || 0;
    if (isTimedSet(set)) {
        const time = ux2Clock(set.durationSeconds);
        return weight ? `${numberDraft(weight)} × ${time}` : time;
    }
    const reps = Math.max(0, Math.round(Number(set.repetitions) || 0));
    return weight ? `${numberDraft(weight)} × ${reps}` : `${reps} повт`;
}

/**
 * Last time this exercise was actually DONE: finished sessions, completed sets.
 *
 * Not lastExerciseSets(): that walks every own workout, so a session planned for next
 * week — first by date — would be offered as "last time".
 */
export function ux2LastSets(workoutItem, exerciseId) {
    return latestDoneSets(workoutItem.userId, exerciseId, workoutItem.id);
}

export function ux2Thumb(exercise) {
    const media = exerciseMedia(exercise);
    // The icon sits underneath and the gif covers it; a gif that fails removes itself
    // and the icon is simply what is left.
    return `<span class="ux2-thumb"><i data-lucide="dumbbell"></i>${media ? `<img src="${escapeHtml(media)}" alt="" referrerpolicy="no-referrer" loading="eager" decoding="sync" onerror="this.remove()">` : ""}</span>`;
}

// ---- Rest -------------------------------------------------------------------------------------

/** The rest that starts after a set: its own value, or the round's inside a superset. */
export function ux2RestSeconds(workoutItem, workoutExercise, set) {
    if (workoutExercise.supersetGroupId) {
        return supersetRestSeconds(workoutItem, workoutExercise.supersetGroupId);
    }
    const own = Number(set && set.restSeconds);
    return Math.max(0, Math.round(Number.isFinite(own) && own > 0 ? own : Number(getPref("defaultRest")) || 90));
}

// The set whose tick started the running rest, so its line can show the countdown.

// Which sets a change applies to: the whole exercise (what people usually mean) or one.
let ux2RestScope = "all";

export function ux2SetRestScope(scope) {
    ux2RestScope = scope === "one" ? "one" : "all";
}

export function ux2OpenRestSheet(workoutExerciseId, setId, groupId = null) {
    const workoutItem = editWorkout();
    const workoutExercise = workoutItem ? workoutItem.exercises.find((item) => item.id === workoutExerciseId) : null;
    if (!workoutItem || (!workoutExercise && !groupId)) {
        closeOverlay();
        return;
    }
    const set = workoutExercise ? (workoutExercise.sets || []).find((item) => item.id === setId) : null;
    const current = groupId ? supersetRestSeconds(workoutItem, groupId) : ux2RestSeconds(workoutItem, workoutExercise, set);
    const ids = ` data-workout-exercise-id="${workoutExercise ? workoutExercise.id : ""}" data-set-id="${set ? set.id : ""}"${groupId ? ` data-superset-id="${escapeHtml(groupId)}"` : ""}`;
    const presets = [45, 60, 90, 120, 150, 180, 240, 300];
    const index = set && workoutExercise ? workoutExercise.sets.indexOf(set) : -1;
    const label = index >= 0 ? sessionSetLabels(workoutExercise.sets)[index] : null;
    const scope = groupId ? "" : `<div class="segmented ux2-rest-scope">
                <button class="segment-button${ux2RestScope === "all" ? " active" : ""}" type="button" data-action="ux2-rest-scope" data-scope="all"${ids}>Усі підходи вправи</button>
                <button class="segment-button${ux2RestScope === "one" ? " active" : ""}" type="button" data-action="ux2-rest-scope" data-scope="one"${ids}>Лише після підходу ${label ? label.label : ""}</button>
            </div>`;
    const caption = groupId
        ? "Після кожного раунду суперсету"
        : `${exerciseById(workoutExercise.exerciseId).name}`;
    ux2Sheet("Відпочинок", `<div class="ux2-rest-pick">
                <button class="ux2-round-btn" type="button" data-action="ux2-rest-step" data-delta="-15"${ids} aria-label="Мінус 15 секунд"><i data-lucide="minus"></i></button>
                <strong class="ux2-rest-big">${formatRest(current)}</strong>
                <button class="ux2-round-btn" type="button" data-action="ux2-rest-step" data-delta="15"${ids} aria-label="Плюс 15 секунд"><i data-lucide="plus"></i></button>
            </div>
            <div class="ux2-chip-row ux2-rest-presets">${presets.map((value) => `<button class="ux2-chip${value === current ? " is-on" : ""}" type="button" data-action="ux2-rest-set" data-seconds="${value}"${ids}>${formatRest(value)}</button>`).join("")}</div>
            ${scope}
            <div class="ux2-switch-row"><span><strong>Таймер сам</strong><span>Стартує, щойно позначиш підхід</span></span>${settingsSwitch("autoStartRest", "Авто-старт таймера відпочинку")}</div>
            <button class="button button-primary ux2-wide" type="button" data-action="close-overlay"><i data-lucide="check"></i>Готово</button>`, { caption });
}

export async function ux2ApplyRest(workoutExerciseId, setId, groupId, seconds, keepOpen) {
    const value = Math.max(0, Math.min(3600, Math.round(Number(seconds) || 0)));
    if (groupId) {
        await supersetSetRest(groupId, value);
    } else {
        const workoutItem = editWorkout();
        const workoutExercise = workoutItem ? workoutItem.exercises.find((item) => item.id === workoutExerciseId) : null;
        if (!workoutExercise) {
            return;
        }
        (workoutExercise.sets || []).forEach((set) => {
            if (ux2RestScope === "all" || set.id === setId) {
                set.restSeconds = value;
            }
        });
        workoutItem.updatedAt = new Date().toISOString();
        schedulePersistWorkout(workoutItem);
        renderSection();
    }
    if (keepOpen) {
        ux2OpenRestSheet(workoutExerciseId, setId, groupId);
    } else {
        closeOverlay();
    }
    showSyncIndicator("success", `Відпочинок ${formatRest(value)}`);
}

// ---- «Як минулого разу» -------------------------------------------------------------------

/** «Минулого разу» is a button: one tap copies last time's numbers into this set. */
export function ux2ApplyLast(workoutExerciseId, setId) {
    const workoutItem = editWorkout();
    const workoutExercise = editWorkoutExercise(workoutExerciseId);
    const set = workoutExercise ? workoutExercise.sets.find((item) => item.id === setId) : null;
    if (!workoutItem || !set) {
        return;
    }
    const last = pairedLast(ux2LastSets(workoutItem, workoutExercise.exerciseId), workoutExercise.sets.indexOf(set));
    if (!last) {
        return;
    }
    set.weight = Number(last.weight) || 0;
    // Like with like: a hold copies its time, a rep set its reps. Across the two only the
    // weight carries over, rather than silently turning the set into the other kind.
    if (isTimedSet(set) && isTimedSet(last)) {
        set.durationSeconds = Math.round(Number(last.durationSeconds) || 0);
    } else if (!isTimedSet(set) && !isTimedSet(last)) {
        set.repetitions = Math.round(Number(last.repetitions) || 0);
    }
    schedulePersistWorkout(workoutItem);
    renderSection();
    showSyncIndicator("success", "Як минулого разу");
}

/**
 * Rewrites the sets not yet done with last time's: same count, same numbers, same kind.
 * Completed sets are never touched — they are what actually happened today.
 */
function ux2FillExerciseFromLast(workoutItem, workoutExercise) {
    const last = ux2LastSets(workoutItem, workoutExercise.exerciseId);
    if (!last || workoutExercise.supersetGroupId) {
        return false;
    }
    const sets = workoutExercise.sets || [];
    const kept = [];
    last.sets.forEach((source, index) => {
        const fill = {
            type: source.type || "working",
            weight: Number(source.weight) || 0,
            repetitions: Math.round(Number(source.repetitions) || 0),
            durationSeconds: isTimedSet(source) ? Math.round(Number(source.durationSeconds) || 0) : null,
            restSeconds: Number(source.restSeconds) || Number(getPref("defaultRest")) || 90
        };
        const current = sets[index];
        if (current && current.isCompleted) {
            kept.push(current);
        } else if (current) {
            kept.push(Object.assign(current, fill));
        } else {
            kept.push(createSet(fill.type, fill.weight, fill.repetitions, source.rpe, fill.restSeconds, false, fill.durationSeconds));
        }
    });
    // Beyond last time's count only completed sets stay.
    sets.slice(last.sets.length).forEach((set) => {
        if (set.isCompleted) {
            kept.push(set);
        }
    });
    workoutExercise.sets = kept;
    return true;
}

export function ux2FillFromLast(workoutExerciseId = null) {
    const workoutItem = editWorkout();
    if (!workoutItem) {
        return;
    }
    const targets = workoutExerciseId
        ? workoutItem.exercises.filter((item) => item.id === workoutExerciseId)
        : workoutItem.exercises;
    const changed = targets.filter((item) => ux2FillExerciseFromLast(workoutItem, item)).length;
    closeOverlay();
    if (!changed) {
        showSyncIndicator("success", "Минулих результатів немає");
        return;
    }
    touchGymClock(workoutItem);
    workoutItem.updatedAt = new Date().toISOString();
    persistWorkout(workoutItem);
    renderSection();
    showSyncIndicator("success", "Як минулого разу");
}

// ---- Reordering exercises --------------------------------------------------------------------
//
// A bottom sheet with the session as a list: drag a row by its grip, or nudge it with the
// arrows — on a phone the arrows are the dependable way, the drag the quick one. A
// superset moves as one block, so a reorder can never split a round.

function ux2BlockKey(block) {
    return block.kind === "superset" ? `ss:${block.groupId}` : `ex:${block.exercise.id}`;
}

/** Puts a block at a new index and renumbers `order` so members stay together. */
function ux2MoveBlock(key, toIndex) {
    const workoutItem = editWorkout();
    if (!workoutItem) {
        return false;
    }
    const blocks = workoutBlocks(workoutItem.exercises);
    const from = blocks.findIndex((block) => ux2BlockKey(block) === key);
    const target = Math.max(0, Math.min(blocks.length - 1, toIndex));
    if (from < 0 || target === from) {
        return false;
    }
    const [moved] = blocks.splice(from, 1);
    blocks.splice(target, 0, moved);
    let order = 1;
    blocks.forEach((block) => {
        (block.kind === "superset" ? block.members : [block.exercise]).forEach((member) => {
            member.order = order;
            order += 1;
        });
    });
    workoutItem.updatedAt = new Date().toISOString();
    persistWorkout(workoutItem);
    renderSection();
    return true;
}

export function ux2MoveBlockBy(key, direction) {
    const workoutItem = editWorkout();
    const index = workoutItem ? workoutBlocks(workoutItem.exercises).findIndex((block) => ux2BlockKey(block) === key) : -1;
    if (index >= 0 && ux2MoveBlock(key, index + direction)) {
        ux2OpenReorderSheet(null, key);
    }
}

export function ux2OpenReorderSheet(workoutExerciseId = null, focusKey = null) {
    const workoutItem = editWorkout();
    if (!workoutItem) {
        return;
    }
    const blocks = workoutBlocks(workoutItem.exercises);
    // Opened from an exercise's own menu: that row is the one being moved.
    const highlight = focusKey || (workoutExerciseId
        ? ux2BlockKey(blocks.find((block) => (block.kind === "superset" ? block.members : [block.exercise]).some((member) => member.id === workoutExerciseId)) || blocks[0])
        : null);
    const rows = blocks.map((block, index) => {
        const key = ux2BlockKey(block);
        let main;
        if (block.kind === "superset") {
            const names = block.members.map((member, memberIndex) => `${positionLabel(memberIndex)} ${exerciseById(member.exerciseId).name}`).join(" · ");
            main = `<span class="ux2-thumb ux2-ro-ss"><i data-lucide="repeat-2"></i></span><span class="ux2-ro-text"><strong>Суперсет</strong><span>${escapeHtml(names)}</span></span>`;
        } else {
            const exercise = exerciseById(block.exercise.exerciseId);
            const sets = block.exercise.sets || [];
            const done = sets.length > 0 && sets.every((set) => set.isCompleted);
            main = `${ux2Thumb(exercise)}<span class="ux2-ro-text"><strong>${escapeHtml(exercise.name)}</strong><span>${sets.length} ${pluralUk(sets.length, "підхід", "підходи", "підходів")}${done ? " · виконано" : ""}</span></span>`;
        }
        return `<li class="ux2-ro-row${key === highlight ? " is-focus" : ""}" data-ro-key="${escapeHtml(key)}">
                <span class="ux2-ro-handle" data-ro-handle aria-hidden="true"><i data-lucide="grip-vertical"></i></span>
                ${main}
                <button class="ux2-ro-btn" type="button" data-action="ux2-reorder-move" data-key="${escapeHtml(key)}" data-dir="-1" aria-label="Вище"${index === 0 ? " disabled" : ""}><i data-lucide="arrow-up"></i></button>
                <button class="ux2-ro-btn" type="button" data-action="ux2-reorder-move" data-key="${escapeHtml(key)}" data-dir="1" aria-label="Нижче"${index === blocks.length - 1 ? " disabled" : ""}><i data-lucide="arrow-down"></i></button>
            </li>`;
    }).join("");
    ux2Sheet("Порядок вправ", `<p class="ux2-sheet-hint">Тягни за ⠿ або тисни стрілки — зберігається одразу.</p>
            <ol class="ux2-ro-list" id="ux2ReorderList">${rows}</ol>
            <button class="button button-primary ux2-wide" type="button" data-action="close-overlay"><i data-lucide="check"></i>Готово</button>`, { caption: ux2Title(workoutItem) });
    ux2BindReorderDrag();
}

/**
 * Drag by the grip. The grip alone has `touch-action: none`, so a finger anywhere else in
 * the sheet still scrolls it; the rows around the dragged one slide out of its way, and
 * the new order is saved on release.
 */
function ux2BindReorderDrag() {
    const list = document.getElementById("ux2ReorderList");
    if (!list) {
        return;
    }
    list.addEventListener("pointerdown", (event) => {
        const handle = event.target.closest("[data-ro-handle]");
        const row = handle ? handle.closest(".ux2-ro-row") : null;
        if (!row || event.button > 0) {
            return;
        }
        event.preventDefault();
        const rows = [...list.children];
        const from = rows.indexOf(row);
        const rects = rows.map((item) => item.getBoundingClientRect());
        const step = rows.length > 1 ? rects[1].top - rects[0].top : rects[0].height;
        const startY = event.clientY;
        let to = from;
        // Capture where the browser allows it; the listeners sit on the window either way,
        // so a drag whose capture was refused (or lost) still tracks the finger.
        try {
            handle.setPointerCapture(event.pointerId);
        } catch (error) {
            // not an active pointer (synthetic) — the window listeners cover it
        }
        row.classList.add("is-dragging");
        list.classList.add("is-sorting");
        const pointerId = event.pointerId;
        const onMove = (move) => {
            if (move.pointerId !== pointerId) {
                return;
            }
            const dy = move.clientY - startY;
            row.style.transform = `translateY(${dy}px)`;
            const centre = rects[from].top + rects[from].height / 2 + dy;
            to = 0;
            rows.forEach((item, index) => {
                if (index !== from && rects[index].top + rects[index].height / 2 < centre) {
                    to += 1;
                }
            });
            rows.forEach((item, index) => {
                if (index === from) {
                    return;
                }
                let shift = 0;
                if (from < to && index > from && index <= to) {
                    shift = -step;
                } else if (from > to && index >= to && index < from) {
                    shift = step;
                }
                item.style.transform = shift ? `translateY(${shift}px)` : "";
            });
        };
        const finish = (end) => {
            if (end && end.pointerId !== pointerId) {
                return;
            }
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", finish);
            window.removeEventListener("pointercancel", finish);
            rows.forEach((item) => {
                item.style.transform = "";
            });
            row.classList.remove("is-dragging");
            list.classList.remove("is-sorting");
            const key = row.dataset.roKey;
            if (to !== from && ux2MoveBlock(key, to)) {
                if (navigator.vibrate) {
                    navigator.vibrate(8);
                }
                ux2OpenReorderSheet(null, key);
            }
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
    });
}

// ---- Sheets: one bottom sheet per question -----------------------------------------------------

export function ux2Sheet(title, body, options = {}) {
    openModal(`<div class="ux2-sheet">
            <div class="ux2-sheet-head">${options.lead || ""}<div class="ux2-sheet-title"><h2>${escapeHtml(title)}</h2>${options.caption ? `<p>${escapeHtml(options.caption)}</p>` : ""}</div><button class="icon-button" type="button" data-action="close-overlay" aria-label="Закрити"><i data-lucide="x"></i></button></div>
            ${body}
        </div>`, { sheet: true });
}

export function ux2MenuItem(action, icon, label, attrs = "", options = {}) {
    const cls = `ux2-menu-item${options.danger ? " is-danger" : ""}${options.primary ? " is-primary" : ""}`;
    return `<button class="${cls}" type="button" data-action="${action}"${attrs}><span class="ux2-menu-ico"><i data-lucide="${icon}"></i></span><span class="ux2-menu-text"><strong>${escapeHtml(label)}</strong>${options.hint ? `<span>${escapeHtml(options.hint)}</span>` : ""}</span>${options.value ? `<span class="ux2-menu-value">${escapeHtml(options.value)}</span>` : ""}${options.chevron ? `<i data-lucide="chevron-right" class="ux2-menu-chev"></i>` : ""}</button>`;
}

/** Everything about one set that is not a number: its type, its rest, removing it. */
export function ux2OpenSetMenu(workoutExerciseId, setId, superset = false) {
    const workoutExercise = editWorkoutExercise(workoutExerciseId);
    const set = workoutExercise ? workoutExercise.sets.find((item) => item.id === setId) : null;
    if (!set) {
        closeOverlay();
        return;
    }
    const exercise = exerciseById(workoutExercise.exerciseId);
    const index = workoutExercise.sets.indexOf(set);
    const label = sessionSetLabels(workoutExercise.sets)[index];
    const ids = ` data-workout-exercise-id="${workoutExercise.id}" data-set-id="${set.id}"${superset ? ` data-superset="1"` : ""}`;
    const types = ["warmup", "working", "drop", "failure", "backoff"].map((type) => `<button class="ux2-chip${set.type === type ? " is-on" : ""}" type="button" data-action="ux2-set-type" data-type="${type}"${ids}>${escapeHtml(setTypeLabel(type))}</button>`).join("");
    const rest = Math.max(0, Math.round(Number(set.restSeconds) || 0));
    const title = superset ? `Раунд ${index + 1}` : `Підхід ${label.label}`;
    ux2Sheet(title, `<div class="ux2-sheet-block"><span class="ux2-sheet-label">Тип підходу</span><div class="ux2-chip-row">${types}</div></div>
            ${superset ? "" : `<div class="ux2-sheet-block ux2-stepper-row"><span class="ux2-sheet-label">Відпочинок після нього</span><div class="ux2-stepper"><button class="ux2-round-btn" type="button" data-action="ux2-set-rest" data-delta="-15"${ids} aria-label="Мінус 15 секунд"><i data-lucide="minus"></i></button><strong>${formatRest(rest)}</strong><button class="ux2-round-btn" type="button" data-action="ux2-set-rest" data-delta="15"${ids} aria-label="Плюс 15 секунд"><i data-lucide="plus"></i></button></div></div>`}
            <div class="ux2-menu">
                ${ux2MenuItem("ux2-sheet-toggle-set", set.isCompleted ? "rotate-ccw" : "check", set.isCompleted ? "Зняти позначку «виконано»" : "Позначити виконаним", ids)}
                ${superset ? "" : ux2MenuItem("ux2-delete-set", "trash-2", "Видалити підхід", ids, { danger: true, hint: "12 секунд, щоб повернути" })}
            </div>`, { caption: `${exercise.name} · ${ux2SetText(set)}` });
}

export async function ux2SetType(workoutExerciseId, setId, type, superset) {
    await updateSetField(workoutExerciseId, setId, "type", type);
    renderSection();
    ux2OpenSetMenu(workoutExerciseId, setId, superset);
}

export function ux2SetRest(workoutExerciseId, setId, delta, superset) {
    const set = editSetByIds(workoutExerciseId, setId);
    if (!set) {
        return;
    }
    set.restSeconds = Math.max(0, Math.min(3600, Math.round(Number(set.restSeconds) || 0) + delta));
    schedulePersistWorkout(editWorkout());
    ux2OpenSetMenu(workoutExerciseId, setId, superset);
}

export function ux2OpenExerciseMenu(workoutExerciseId) {
    const workoutExercise = editWorkoutExercise(workoutExerciseId);
    if (!workoutExercise) {
        closeOverlay();
        return;
    }
    const exercise = exerciseById(workoutExercise.exerciseId);
    const sets = workoutExercise.sets || [];
    const timed = sets.some(isTimedSet);
    const id = ` data-workout-exercise-id="${workoutExercise.id}"`;
    const open = sets.filter((set) => !set.isCompleted);
    const restNow = open.length && open.every((set) => set.restSeconds === open[0].restSeconds) ? open[0].restSeconds : null;
    const restChips = [60, 90, 120, 180].map((value) => `<button class="ux2-chip${restNow === value ? " is-on" : ""}" type="button" data-action="ux2-ex-rest" data-seconds="${value}"${id}>${formatRest(value)}</button>`).join("");
    const last = workoutExercise.supersetGroupId ? null : ux2LastSets(editWorkout(), workoutExercise.exerciseId);
    ux2Sheet(exercise.name, `<div class="ux2-menu">
                ${last ? ux2MenuItem("ux2-fill-last", "history", "Як минулого разу", id, { hint: last.sets.map((set) => ux2SetText(set)).join(" · ") }) : ""}
                ${warmupAvailable(workoutExercise, exercise) ? ux2MenuItem("warmup-open", "flame", sets.some((set) => set.type === "warmup") ? "Перерахувати розминку" : "Розминка", id, { hint: "Розминочні підходи до робочої ваги" }) : ""}
                ${editWorkout()?.status === "active" ? ux2MenuItem("ux2-ex-focus", "crosshair", "Фокус на цій вправі", id, { hint: "Один підхід на весь екран" }) : ""}
                ${ux2MenuItem("ux2-ex-replace", "repeat", "Замінити вправу", id)}
                ${workoutBlocks(editWorkout().exercises).length > 1 ? ux2MenuItem("ux2-reorder", "arrow-up-down", "Перемістити", id, { hint: "Змінити порядок вправ" }) : ""}
                ${ux2MenuItem("ux2-ex-timed", timed ? "repeat-2" : "timer", timed ? "Рахувати повтори" : "Рахувати час", id, { hint: timed ? "Замість секунд" : "Планка, віс, утримання" })}
                ${ux2MenuItem("ux2-open-note", "sticky-note", workoutExercise.notes ? "Нотатка до вправи" : "Додати нотатку", ` data-note-key="exercise:${workoutExercise.id}"`)}
                ${ux2MenuItem("ux2-ex-info", "info", "Техніка виконання", ` data-exercise-id="${escapeHtml(exercise.id)}"`)}
            </div>
            ${open.length ? `<div class="ux2-sheet-block"><span class="ux2-sheet-label">Відпочинок для невиконаних підходів</span><div class="ux2-chip-row">${restChips}</div></div>` : ""}
            <div class="ux2-menu">${ux2MenuItem("ux2-ex-remove", "trash-2", "Прибрати вправу", id, { danger: true })}</div>`, {
        caption: `${exercise.primaryMuscleGroup} · ${sets.length} ${pluralUk(sets.length, "підхід", "підходи", "підходів")}`,
        lead: ux2Thumb(exercise)
    });
}

export function ux2ExerciseRest(workoutExerciseId, seconds) {
    const workoutExercise = editWorkoutExercise(workoutExerciseId);
    if (!workoutExercise) {
        return;
    }
    workoutExercise.sets.filter((set) => !set.isCompleted).forEach((set) => {
        set.restSeconds = seconds;
    });
    schedulePersistWorkout(editWorkout());
    renderSection(); // the rest chips / lines under the sheet show the new value
    ux2OpenExerciseMenu(workoutExerciseId);
    showSyncIndicator("success", `Відпочинок ${formatRest(seconds)}`);
}

export function ux2OpenSessionMenu() {
    const workoutItem = editWorkout();
    if (!workoutItem) {
        return;
    }
    const id = ` data-workout-id="${workoutItem.id}"`;
    const durationValue = workoutItem.durationOverride == null ? `авто · ${autoDuration(workoutItem)} хв` : formatDurationLabel(Number(workoutItem.durationOverride));
    // «Завершити» lives in the workout's own action bar, not in here.
    ux2Sheet(ux2Title(workoutItem), `<div class="ux2-menu">
                ${workoutItem.exercises.length ? ux2MenuItem("ux2-fill-last", "history", "Усе як минулого разу", "", { hint: "Невиконані підходи — останніми результатами" }) : ""}
                ${workoutBlocks(workoutItem.exercises).length > 1 ? ux2MenuItem("ux2-reorder", "arrow-up-down", "Порядок вправ", "", { hint: "Перетягнути або стрілками" }) : ""}
                ${ux2MenuItem("ux2-pick-type", "layers", "Тип тренування", id, { value: workoutTypeLabel(workoutItem.workoutType) })}
                ${ux2MenuItem("ux2-meta", "calendar-clock", "Дата і тривалість", id, { value: `${shortDate(workoutItem.date)} · ${durationValue}` })}
                ${ux2MenuItem("ux2-open-note", "sticky-note", workoutItem.notes ? "Нотатка до тренування" : "Додати нотатку", ` data-note-key="workout:${workoutItem.id}"`)}
                ${ux2MenuItem("ux2-cardio", "heart-pulse", "Додати кардіо", id)}
                ${supersetsEnabled() ? ux2MenuItem("ux2-superset", "repeat-2", "Створити суперсет", id, { hint: hasUnlimited() ? "2–3 вправи, один відпочинок після раунду" : "Доступно в PRO" }) : ""}
                ${workoutItem.exercises.length ? ux2MenuItem("ux2-template", "bookmark-plus", "Зберегти як шаблон", id) : ""}
            </div>
            <div class="ux2-menu">
                ${ux2MenuItem("ux2-delete-workout", "trash-2", "Видалити тренування", id, { danger: true })}
            </div>`, { caption: `${workoutLabel(workoutItem)} · ${formatDate(workoutItem.date)}` });
}

export function ux2OpenMetaSheet() {
    const workoutItem = editWorkout();
    if (!workoutItem) {
        return;
    }
    const bounds = workoutDateBounds();
    const dateAttrs = bounds.min ? ` min="${bounds.min}" max="${bounds.max}"` : "";
    const minutes = [15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 210, 240];
    ux2Sheet("Дата і тривалість", `<div class="field-grid two ux2-meta-grid">
                <div class="field"><label>Дата</label><gym-date value="${escapeHtml(workoutItem.date)}"${dateAttrs} data-action="edit-workout-meta" data-field="date" data-workout-id="${workoutItem.id}"></gym-date></div>
                <div class="field"><label>Тривалість</label><gym-select data-action="edit-workout-meta" data-field="durationOverride" data-workout-id="${workoutItem.id}"><option value="auto" ${workoutItem.durationOverride == null ? "selected" : ""}>Авто (${autoDuration(workoutItem)} хв)</option>${minutes.map((min) => `<option value="${min}" ${Number(workoutItem.durationOverride) === min ? "selected" : ""}>${formatDurationLabel(min)}</option>`).join("")}</gym-select></div>
            </div>
            <button class="button button-primary ux2-wide" type="button" data-action="close-overlay"><i data-lucide="check"></i>Готово</button>`);
}
