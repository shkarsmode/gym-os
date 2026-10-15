// Personal workout templates.
import { escapeHtml, number, dateInput } from "../lib/format.js";
import { workoutBlocks } from "../lib/superset.js";
import { exerciseMedia } from "./components.js";
import { storage } from "./data.js";
import { lastExerciseSets } from "./history.js";
import { currentUser, exerciseById, ownWorkout, workoutLimitState, workoutTypeLabel } from "./model.js";
import { closeSheet, confirmDialog, friendlyError, openSheet, toast } from "./overlays.js";
import { persist, persistWorkout } from "./persistence.js";
import { getPref } from "./prefs.js";
import { goToWorkoutEditor } from "./router.js";
import { suggestedSets } from "./scoring-bridge.js";
import { renderSection } from "./shell.js";
import { state } from "./state.js";
import { createId, inputValue } from "./util.js";
import { ensureSingleActiveWorkout } from "./workout-actions.js";
import { pluralUk } from "./workout-screen.js";

// ---- Personal workout templates (save a workout as a reusable template) ----
export async function loadPersonalTemplates() {
    if (storage.mode === "api" && storage.apiClient.hasBaseUrl()) {
        try {
            state.personalTemplates = await storage.apiClient.fetchMyTemplates() || [];
        } catch (error) {
            state.personalTemplates = state.personalTemplates || [];
        }
    } else {
        state.personalTemplates = state.database.personalTemplates || [];
    }
}

function templatePreviewRow(item, live = false) {
    const exercise = exerciseById(item.exerciseId);
    const url = exerciseMedia(exercise);
    const thumb = url
        ? `<img class="tpl-thumb" src="${escapeHtml(url)}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()">`
        : `<span class="tpl-thumb tpl-thumb-empty"><i data-lucide="dumbbell"></i></span>`;
    let caption = `${item.targetSets || 3} × ${item.targetReps || 8} · відпочинок ${item.restSeconds || 90}с`;
    if (live) {
        // The gallery shows what will ACTUALLY be prefilled on start — the user's
        // last session of this exercise (same source as suggestedSets).
        const last = lastExerciseSets(currentUser().id, item.exerciseId);
        if (last && last.sets.length) {
            const working = last.sets.filter((set) => set.type !== "warmup");
            const list = working.length ? working : last.sets;
            const reps = Number(list[0]?.repetitions) || item.targetReps || 8;
            const weight = Math.max(...list.map((set) => Number(set.weight) || 0));
            caption = `${last.sets.length} × ${reps}${weight > 0 ? ` · ${number(weight)} кг` : ""} · останнє`;
        }
    }
    return `<div class="tpl-exercise">${thumb}<div class="tpl-exercise-text"><strong>${escapeHtml(exercise.name)}</strong><span>${caption}</span></div></div>`;
}

export function openSaveTemplateModal(workoutId) {
    const workoutItem = ownWorkout(workoutId);
    if (!workoutItem || !workoutItem.exercises.length) {
        toast("Немає вправ", "Додай хоча б одну вправу, щоб зберегти шаблон.");
        return;
    }
    const items = workoutItem.exercises.map((workoutExercise, index) => ({
        exerciseId: workoutExercise.exerciseId,
        order: index + 1,
        targetSets: workoutExercise.sets.filter((set) => set.type !== "warmup").length || workoutExercise.sets.length || 3,
        targetReps: (workoutExercise.sets.find((set) => set.type !== "warmup") || workoutExercise.sets[0])?.repetitions || 8,
        restSeconds: workoutExercise.sets[0]?.restSeconds || 90
    }));
    openSheet(`<div class="modal-header"><div><h2>Зберегти як шаблон</h2><p class="card-caption">Назви шаблон — вправи й підходи збережуться для швидкого старту.</p></div><button class="icon-button" type="button" data-action="close-sheet"><i data-lucide="x"></i></button></div>
            <div class="field"><label>Назва шаблону</label><input type="text" id="templateName" maxlength="120" value="${escapeHtml(workoutItem.title === "Тренування" ? `Мій ${workoutTypeLabel(workoutItem.workoutType)}` : workoutItem.title)}"></div>
            <div class="tpl-preview">${items.map(templatePreviewRow).join("")}</div>
            <div class="action-row" style="justify-content:flex-end;margin-top:14px;"><button class="button button-primary" type="button" data-action="save-workout-template" data-workout-id="${workoutItem.id}"><i data-lucide="bookmark-plus"></i>Зберегти шаблон</button></div>`);
}

export async function saveWorkoutTemplate(workoutId) {
    const workoutItem = ownWorkout(workoutId);
    if (!workoutItem) {
        return;
    }
    const title = (inputValue("templateName") || "").trim() || "Мій шаблон";
    // Templates store a flat list of exercises with target sets and reps — they carry
    // no grouping. A superset therefore saves as its separate exercises, which loses
    // the pairing but never a number. Said out loud rather than left to be discovered
    // when the template is started.
    const groupedCount = workoutBlocks(workoutItem.exercises).filter((block) => block.kind === "superset").length;
    const payload = {
        title,
        type: workoutItem.workoutType || "custom",
        exercises: workoutItem.exercises.map((workoutExercise, index) => ({
            exerciseId: workoutExercise.exerciseId,
            order: index + 1,
            targetSets: workoutExercise.sets.filter((set) => set.type !== "warmup").length || workoutExercise.sets.length || 3,
            targetReps: (workoutExercise.sets.find((set) => set.type !== "warmup") || workoutExercise.sets[0])?.repetitions || 8,
            restSeconds: Math.round(workoutExercise.sets[0]?.restSeconds || 90)
        }))
    };
    try {
        if (storage.mode === "api" && storage.apiClient.hasBaseUrl()) {
            const created = await storage.apiClient.createTemplate(payload);
            state.personalTemplates = [created, ...(state.personalTemplates || [])];
        } else {
            const local = { id: createId("template"), ...payload, createdAt: new Date().toISOString() };
            state.database.personalTemplates = [local, ...(state.database.personalTemplates || [])];
            state.personalTemplates = state.database.personalTemplates;
            await persist({ silent: true });
        }
        closeSheet();
        if (groupedCount) {
            toast(
                "Шаблон збережено",
                `${groupedCount} ${pluralUk(groupedCount, "суперсет", "суперсети", "суперсетів")} збережено як окремі вправи — шаблони поки не зберігають групування`
            );
        }
    } catch (error) {
        toast("Не вдалося зберегти", friendlyError(error), "error");
    }
}

export async function deletePersonalTemplate(templateId) {
    const confirmed = await confirmDialog("Шаблон зникне назавжди, тренування не постраждають.", { title: "Видалити шаблон?", confirmLabel: "Видалити" });
    if (!confirmed) {
        return;
    }
    try {
        if (storage.mode === "api" && storage.apiClient.hasBaseUrl()) {
            await storage.apiClient.deleteTemplate(templateId);
        } else {
            state.database.personalTemplates = (state.database.personalTemplates || []).filter((item) => item.id !== templateId);
            await persist({ silent: true });
        }
        state.personalTemplates = (state.personalTemplates || []).filter((item) => item.id !== templateId);
        renderSection();
        toast("Шаблон видалено");
    } catch (error) {
        toast("Не вдалося видалити", friendlyError(error), "error");
    }
}

export async function startTemplateWorkout(templateId) {
    const template = (state.personalTemplates || []).find((item) => item.id === templateId);
    if (!template) {
        return;
    }
    const limit = workoutLimitState(currentUser().id);
    if (!limit.allowed) {
        toast("Ліміт тренувань", limit.message);
        return;
    }
    const canStart = await ensureSingleActiveWorkout();
    if (!canStart) {
        return;
    }
    const now = new Date();
    const defaultDur = getPref("defaultDuration");
    const workoutItem = {
        id: createId("workout"),
        userId: currentUser().id,
        date: dateInput(now),
        title: template.title,
        status: "active",
        workoutType: template.type || "custom",
        durationOverride: (defaultDur === "auto" || defaultDur === "" || defaultDur == null) ? null : (Math.max(0, Math.round(Number(defaultDur))) || null),
        startedAt: now.toISOString(),
        finishedAt: null,
        notes: "",
        exercises: (template.exercises || []).map((item, index) => ({
            id: createId("workout-exercise"),
            exerciseId: item.exerciseId,
            order: index + 1,
            notes: item.notes || "",
            // Same behaviour as adding the exercise by hand: carry over the sets
            // (count + weight + reps) from the last time this exercise was done.
            sets: suggestedSets(exerciseById(item.exerciseId))
        })),
        supersetGroups: [],
        cardioSessions: [],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
    };
    state.database.workouts.push(workoutItem);
    state.editingWorkoutId = workoutItem.id;
    await persistWorkout(workoutItem);
    goToWorkoutEditor(workoutItem.id);
}

export function personalTemplatesSection() {
    const list = state.personalTemplates || [];
    if (!list.length) {
        return "";
    }
    const cards = list.map((template) => `<article class="tpl-card"><div class="tpl-card-head"><div><strong>${escapeHtml(template.title)}</strong><span class="chip">${workoutTypeLabel(template.type)}</span></div><button class="icon-button" type="button" title="Видалити шаблон" data-action="delete-template" data-template-id="${template.id}"><i data-lucide="trash-2"></i></button></div><div class="tpl-preview compact">${(template.exercises || []).map((item) => templatePreviewRow(item, true)).join("") || `<p class="card-caption">Порожній шаблон</p>`}</div><button class="button button-primary compact" type="button" data-action="start-template-workout" data-template-id="${template.id}"><i data-lucide="play"></i>Почати за шаблоном</button></article>`).join("");
    return `<section class="card"><div class="card-header"><div><h2>Мої шаблони</h2><p class="card-caption">Збережені тренування — старт в один дотик.</p></div></div><div class="tpl-grid">${cards}</div></section>`;
}
