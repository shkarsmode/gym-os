// Adding and replacing exercises: the picker, custom exercises, duplicate warnings, demo-gif suggestions, moderation actions.
import { muscleIcons } from "../lib/muscle-icons.js";
import { escapeHtml, shortDate, splitCsv, unique, imageUrl } from "../lib/format.js";
import { muscles, patterns, equipment } from "../lib/constants.js";
import { searchExercises } from "../lib/exercise-search.js";
import { numberDraft, suggestExercises } from "../lib/session.js";
import { openPaywallModal } from "./account.js";
import { refreshCatalog } from "./catalog.js";
import { emptyInline, exerciseMedia, exerciseThumb, reactionBar } from "./components.js";
import { storage } from "./data.js";
import { openExercise } from "./exercise-detail.js";
import { isHydratedWorkout } from "./history.js";
import {
    canEditExercise, currentUser, editWorkout, exerciseById, exerciseQuotaState, hasUnlimited, isAdmin, select,
    workoutTypeLabel, workoutsFor
} from "./model.js";
import {
    closeOverlay, closeSheet, confirmDialog, element, friendlyError, openModal, openSheet, sheetDismissHooks,
    showSyncIndicator, toast
} from "./overlays.js";
import { persist } from "./persistence.js";
import { checkAchievementUnlocks } from "./progression.js";
import { exerciseUsage, recordsFor } from "./scoring-bridge.js";
import { mistakesFor, safetyFor, techniqueFor } from "./seed.js";
import { ux2Thumb } from "./sheets.js";
import { renderSection } from "./shell.js";
import { state } from "./state.js";
import { removeWithUndo } from "./undo.js";
import { checkboxValue, createId, iconsIn, inputValue } from "./util.js";
import { pluralUk } from "./workout-screen.js";

// Remembers the exercise name the user already saw the duplicate sheet for and chose
// to create anyway, so a retry after a failed save does not re-ask (and does not burn
// a second AI call). Reset every time the custom-exercise form opens.
let duplicateCheckState = { acknowledgedName: "" };

// Last gif-suggestion round. `picked` is kept so the save path can trust the server's
// content-type instead of guessing the media type from the file extension.
let mediaSuggestState = { query: "", items: [], picked: null };

// Bumped on every new search AND whenever the sheet is dismissed, so a slow response
// can never repaint a sheet the user has already closed or replaced.
let mediaSuggestToken = 0;

let mediaSuggestHooked = false;

// How many cards the grid paints at a time; «Показати ще» adds the next page.
const PICKER_PAGE = 60;
let pickerLimit = PICKER_PAGE;

export function openAddExerciseModal() {
    openModal(pickerListContent(), { fullscreen: true, list: true });
    // Straight into typing on a computer; a phone would throw its keyboard over the grid.
    if (window.matchMedia && window.matchMedia("(pointer: fine)").matches) {
        document.querySelector("#exercisePickerBody .picker-search")?.focus();
    }
}

/** The exercise «Замінити» was opened for, while it is open. */
function replacedExercise() {
    if (!state.replaceExerciseTarget) {
        return null;
    }
    const entry = (editWorkout()?.exercises || []).find((item) => item.id === state.replaceExerciseTarget);
    return entry ? exerciseById(entry.exerciseId) : null;
}

function pickerListContent() {
    const current = replacedExercise();
    const heading = state.replaceExerciseTarget ? "Замінити вправу" : "Додати вправу";
    const caption = current ? `<p class="card-caption">Замість «${escapeHtml(current.name)}»</p>` : "";
    return `<div class="modal-header picker-header"><div><h2>${heading}</h2>${caption}</div><button class="icon-button" type="button" data-action="close-overlay" aria-label="Закрити"><i data-lucide="x"></i></button></div><div id="exercisePickerBody" class="modal-list-body">${pickerBody()}</div>`;
}

// Muscle-group filter priority order (the rest fall back alphabetically).
const MUSCLE_ORDER = ["Груди", "Спина", "Трицепс", "Біцепс", "Плечі", "Прес"];

export function orderedMuscleGroups() {
    const muscleGroups = unique(state.database.exercises.map((exercise) => exercise.primaryMuscleGroup).filter(Boolean));
    return muscleGroups.slice().sort((left, right) => {
        const li = MUSCLE_ORDER.indexOf(left);
        const ri = MUSCLE_ORDER.indexOf(right);
        const lr = li === -1 ? MUSCLE_ORDER.length : li;
        const rr = ri === -1 ? MUSCLE_ORDER.length : ri;
        return lr !== rr ? lr - rr : String(left).localeCompare(String(right), "uk");
    });
}

export function muscleLabel(value) {
    return value === "all" ? "Усі м'язи" : value;
}

export function muscleIcon(value) {
    return muscleIcons[value] || muscleIcons.all;
}

// The muscle filter opens a visual grid of body-silhouette cards (in-modal view
// swap — no second overlay, since the picker is itself a modal).
export function pickerMuscleContent() {
    const card = (value) => `<button type="button" class="muscle-card${state.filters.pickerMuscle === value ? " active" : ""}" data-action="pick-muscle" data-value="${escapeHtml(value)}"><span class="muscle-card-ic">${muscleIcon(value)}</span><span class="muscle-card-label">${escapeHtml(muscleLabel(value))}</span></button>`;
    const cards = card("all") + orderedMuscleGroups().map(card).join("");
    // Top-right X returns to the exercise picker (acts as back), not close-all.
    return `<div class="modal-header"><div><h2>Група м'язів</h2><p class="card-caption">Оберіть групу для фільтра.</p></div><button class="icon-button" type="button" data-action="muscle-grid-back" aria-label="Назад до пошуку"><i data-lucide="x"></i></button></div><div class="muscle-grid">${cards}</div>`;
}

export function pickerBody() {
    pickerLimit = PICKER_PAGE;
    const equipmentList = unique(state.database.exercises.map((exercise) => exercise.equipment).filter(Boolean));
    const option = (key, value, label) => `<option value="${escapeHtml(value)}" ${state.filters[key] === value ? "selected" : ""}>${escapeHtml(label)}</option>`;
    const equipmentOptions = option("pickerEquipment", "all", "Все обладнання") + equipmentList.map((value) => option("pickerEquipment", value, value)).join("");
    const muscle = state.filters.pickerMuscle;
    const search = state.filters.exerciseSearch;
    return `<div class="picker-search-wrap"><i data-lucide="search" class="picker-search-ico"></i><input type="search" class="picker-search" placeholder="Назва, м'яз або обладнання" value="${escapeHtml(search)}" data-action="exercise-picker-search" enterkeyhint="search" autocomplete="off" spellcheck="false"><button type="button" class="picker-search-clear" data-action="picker-search-clear" aria-label="Очистити пошук"${search ? "" : " hidden"}><i data-lucide="x"></i></button></div>
            <div class="picker-filter-row">
                <button type="button" class="picker-muscle-trigger" data-action="open-muscle-grid"><span class="picker-muscle-ic">${muscleIcon(muscle)}</span><span class="picker-muscle-label">${escapeHtml(muscleLabel(muscle))}</span><i data-lucide="chevron-down" class="gselect-caret"></i></button>
                <gym-select data-action="picker-filter-select" data-key="pickerEquipment">${equipmentOptions}</gym-select>
            </div>
            <div class="exercise-picker-grid modal-list-scroll" id="exercisePickerGrid">${exercisePickerCards()}</div>`;
}

/** Search or a filter changed: the results from the top, the field keeps its focus. */
export function refreshPickerResults() {
    pickerLimit = PICKER_PAGE;
    const grid = element("exercisePickerGrid");
    if (grid) {
        grid.innerHTML = exercisePickerCards();
        grid.scrollTop = 0;
        iconsIn(grid);
    }
    const clear = document.querySelector("#exercisePickerBody .picker-search-clear");
    if (clear) {
        clear.hidden = !state.filters.exerciseSearch;
    }
}

export function clearPickerSearch() {
    state.filters.exerciseSearch = "";
    const input = document.querySelector("#exercisePickerBody .picker-search");
    if (input) {
        input.value = "";
        input.focus();
    }
    refreshPickerResults();
    refreshCatalog();
}

export function setPickerFilter(key, value) {
    state.filters[key] = value;
    // Re-render only the results — leave the search input + filter selects intact (no
    // focus loss, the selects already reflect the chosen value).
    refreshPickerResults();
    // The catalog shares the same filter state — refresh it too when open.
    refreshCatalog();
}

function pickerFiltered() {
    const muscle = state.filters.pickerMuscle;
    const equip = state.filters.pickerEquipment;
    return state.database.exercises.filter((exercise) => (muscle === "all" || exercise.primaryMuscleGroup === muscle) && (equip === "all" || exercise.equipment === equip));
}

/**
 * The first thing the picker shows. Adding: what you usually do in this kind of session
 * and have not done yet today. Replacing: the closest stand-ins for the exercise being
 * replaced. A muscle or equipment filter narrows these too instead of hiding them —
 * «Спина» should still say which back exercise you usually do — but a search hides them:
 * a person typing a name already knows what they want.
 */
function pickerSuggestions(usage) {
    if (state.filters.exerciseSearch.trim()) {
        return "";
    }
    const muscle = state.filters.pickerMuscle;
    const equip = state.filters.pickerEquipment;
    const fits = (exercise) => exercise && !exercise.isMissing && (muscle === "all" || exercise.primaryMuscleGroup === muscle) && (equip === "all" || exercise.equipment === equip);
    const row = (exercise, detail) => `<button class="picker-suggest-item" type="button" data-action="add-exercise" data-exercise-id="${escapeHtml(exercise.id)}">
                ${ux2Thumb(exercise)}
                <span class="picker-suggest-text"><strong>${escapeHtml(exercise.name)}</strong><span>${escapeHtml(detail)}</span></span>
                <span class="picker-suggest-add" aria-hidden="true"><i data-lucide="plus"></i></span>
            </button>`;
    const section = (title, rows) => `<section class="picker-suggest">
            <h3 class="picker-suggest-title"><i data-lucide="sparkles"></i>${escapeHtml(title)}</h3>
            <div class="picker-suggest-list">${rows}</div>
        </section>`;
    const current = replacedExercise();
    if (state.replaceExerciseTarget) {
        if (!current) {
            return "";
        }
        // Same main muscle, and the same MOVEMENT first — the machine is taken, so another
        // incline press, not the fly done most often. Habit and likes only order those.
        const score = (exercise) => (exercise.movementPattern === current.movementPattern ? 6 : 0)
            + (exercise.equipment === current.equipment ? 1 : 0)
            + Math.min(3, Math.log2(1 + (usage.uses.get(exercise.id) || 0)) * 0.75)
            + (Number(exercise.likeCount) || 0) * 0.5
            - (exercise.myReaction === "dislike" ? 10 : 0);
        const similar = state.database.exercises
            .filter((exercise) => exercise.id !== current.id && exercise.primaryMuscleGroup === current.primaryMuscleGroup && fits(exercise))
            .sort((left, right) => score(right) - score(left) || String(left.name).localeCompare(String(right.name), "uk"))
            .slice(0, 5);
        if (!similar.length) {
            return "";
        }
        return section(`Схожі на «${current.name}»`, similar.map((exercise) => {
            const times = usage.uses.get(exercise.id) || 0;
            return row(exercise, `${exercise.equipment}${exercise.movementPattern === current.movementPattern ? " · той самий рух" : ""}${times ? ` · ${times} ${pluralUk(times, "раз", "рази", "разів")}` : ""}`);
        }).join(""));
    }
    const me = currentUser();
    const workoutItem = me ? editWorkout() : null;
    if (!workoutItem || !isHydratedWorkout(workoutItem)) {
        return "";
    }
    const picks = suggestExercises(workoutsFor(me.id).filter(isHydratedWorkout), workoutItem, { limit: 40 })
        .map((pick) => ({ ...pick, exercise: exerciseById(pick.exerciseId) }))
        .filter((pick) => fits(pick.exercise))
        .slice(0, 5);
    if (!picks.length) {
        return "";
    }
    const type = workoutItem.workoutType && workoutItem.workoutType !== "custom" ? workoutTypeLabel(workoutItem.workoutType) : "";
    const sameType = type && picks.some((pick) => pick.sameTypeCount);
    return section(sameType ? `Зазвичай у ${type}` : "З твоїх останніх тренувань", picks.map((pick) => row(pick.exercise, `${pick.exercise.primaryMuscleGroup} · ${pick.count} ${pluralUk(pick.count, "раз", "рази", "разів")} нещодавно · ${shortDate(pick.lastDate)}`)).join(""));
}

function pickerResults(usage) {
    return searchExercises(pickerFiltered(), state.filters.exerciseSearch, { uses: usage.uses });
}

/** One exercise in the grid: the gif large enough to read, a tap adds it. */
function pickCard(exercise, context) {
    const url = exerciseMedia(exercise);
    const inSession = context.inSession.has(exercise.id);
    const isCurrent = context.currentId === exercise.id;
    const likes = Number(exercise.likeCount) || 0;
    const name = escapeHtml(exercise.name);
    const tag = isCurrent
        ? `<span class="pick-tag is-current">Зараз</span>`
        : inSession ? `<span class="pick-tag"><i data-lucide="check"></i>Уже є</span>` : "";
    const likeChip = likes ? `<span class="pick-likes${exercise.myReaction === "like" ? " is-mine" : ""}" title="Подобається ${likes}"><i data-lucide="thumbs-up"></i>${likes}</span>` : "";
    const meta = [exercise.primaryMuscleGroup, exercise.equipment].filter(Boolean).map(escapeHtml).join(" · ");
    // The badges and the «+» sit on the picture, inside the one big button: the whole card
    // is the target. Only «i» is its own button, beside it rather than nested in it.
    return `<article class="pick-card${inSession ? " is-in" : ""}${isCurrent ? " is-current" : ""}${exercise.myReaction === "dislike" ? " is-disliked" : ""}">
            <button class="pick-card-main" type="button" data-action="add-exercise" data-exercise-id="${escapeHtml(exercise.id)}" aria-label="${state.replaceExerciseTarget ? "Замінити на" : "Додати"} «${name}»">
                <span class="pick-media"><span class="exercise-thumb-ph" aria-hidden="true">${muscleIcon(exercise.primaryMuscleGroup)}</span>${url ? `<img src="${escapeHtml(url)}" alt="" referrerpolicy="no-referrer" loading="lazy" decoding="async" onerror="this.remove()">` : ""}${tag}${likeChip}<span class="pick-add" aria-hidden="true"><i data-lucide="${state.replaceExerciseTarget ? "repeat" : "plus"}"></i></span></span>
                <span class="pick-body"><strong class="pick-name">${name}</strong><span class="pick-meta">${meta}</span></span>
            </button>
            <button class="pick-info" type="button" data-action="picker-preview" data-exercise-id="${escapeHtml(exercise.id)}" aria-label="Як виконувати «${name}»"><i data-lucide="info"></i></button>
        </article>`;
}

function pickerCardContext() {
    return {
        inSession: new Set((editWorkout()?.exercises || []).map((entry) => entry.exerciseId)),
        currentId: replacedExercise()?.id || null
    };
}

function pickerMoreButton(left) {
    return left > 0
        ? `<button class="button button-secondary picker-more" type="button" data-action="picker-more">Показати ще ${Math.min(left, PICKER_PAGE)}<span>із ${left}</span></button>`
        : "";
}

export function exercisePickerCards() {
    const usage = exerciseUsage();
    const items = pickerResults(usage);
    const search = state.filters.exerciseSearch.trim();
    if (!items.length) {
        const create = search
            ? `<button class="button button-secondary compact" type="button" data-action="open-custom-exercise" data-name="${escapeHtml(search)}"><i data-lucide="plus"></i>Створити «${escapeHtml(search)}»</button>`
            : "";
        return pickerSuggestions(usage) + `<div class="picker-empty">${emptyInline("Нічого не знайдено", search ? "Спробуй інакше: частину назви, м'яз або обладнання — українською, російською чи англійською." : "Спробуй іншу групу м'язів або обладнання.")}${create}</div>`;
    }
    const muscle = state.filters.pickerMuscle;
    const equip = state.filters.pickerEquipment;
    const scope = search ? "Знайдено" : [muscle !== "all" ? muscle : "", equip !== "all" ? equip : ""].filter(Boolean).join(" · ") || "Усі вправи";
    const context = pickerCardContext();
    const shown = items.slice(0, pickerLimit);
    return pickerSuggestions(usage)
        + `<h3 class="picker-section-title"><span>${escapeHtml(scope)}</span><span class="picker-section-count">${items.length}</span></h3>`
        + `<div class="pick-grid" id="pickGrid">${shown.map((exercise) => pickCard(exercise, context)).join("")}</div>`
        + pickerMoreButton(items.length - shown.length);
}

/** «Показати ще»: the next page goes under the cards already there — nothing repaints. */
export function showMorePickerCards() {
    const grid = element("pickGrid");
    if (!grid) {
        return;
    }
    const items = pickerResults(exerciseUsage());
    const from = pickerLimit;
    pickerLimit += PICKER_PAGE;
    const context = pickerCardContext();
    grid.insertAdjacentHTML("beforeend", items.slice(from, pickerLimit).map((exercise) => pickCard(exercise, context)).join(""));
    const more = grid.parentElement?.querySelector(".picker-more");
    if (more) {
        more.outerHTML = pickerMoreButton(items.length - Math.min(items.length, pickerLimit));
    }
    iconsIn(grid.parentElement);
}

/**
 * A closer look without leaving the picker: the gif large, the muscles, how you did it
 * last, the technique — and the same add. A sheet over the picker, so closing it lands
 * back exactly where the person was scrolling.
 */
export function openPickerPreview(exerciseId) {
    const exercise = exerciseById(exerciseId);
    if (!exercise || exercise.isMissing) {
        return;
    }
    const me = currentUser();
    const usage = exerciseUsage();
    const times = usage.uses.get(exercise.id) || 0;
    const record = me ? recordsFor(me.id).find((item) => item.exerciseId === exercise.id) : null;
    const url = exerciseMedia(exercise);
    const muscles = [`<span class="chip pick-chip-main">${escapeHtml(exercise.primaryMuscleGroup)}</span>`, ...(exercise.secondaryMuscleGroups || []).map((item) => `<span class="chip">${escapeHtml(item)}</span>`)].join("");
    const history = times
        ? `<p class="pick-preview-history"><i data-lucide="history"></i><span>Ти робив ${times} ${pluralUk(times, "раз", "рази", "разів")}${usage.last.get(exercise.id) ? ` · востаннє ${escapeHtml(shortDate(usage.last.get(exercise.id)))}` : ""}${record ? ` · рекорд ${numberDraft(record.weight)} кг × ${record.repetitions}` : ""}</span></p>`
        : "";
    const steps = (exercise.techniqueSteps || []).filter(Boolean).slice(0, 6);
    const technique = steps.length ? `<section class="pick-preview-steps"><h3>Техніка</h3><ol>${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol></section>` : "";
    const action = state.replaceExerciseTarget ? "Замінити на цю" : "Додати в тренування";
    openSheet(`<div class="pick-preview">
            <div class="modal-header"><div><h2>${escapeHtml(exercise.name)}</h2><p class="card-caption">${escapeHtml([exercise.movementPattern, exercise.equipment].filter(Boolean).join(" · "))}</p></div><button class="icon-button" type="button" data-action="picker-preview-close" aria-label="Назад до вправ"><i data-lucide="x"></i></button></div>
            <div class="pick-preview-media"><span class="exercise-thumb-ph" aria-hidden="true">${muscleIcon(exercise.primaryMuscleGroup)}</span>${url ? `<img src="${escapeHtml(url)}" alt="Демонстрація: ${escapeHtml(exercise.name)}" referrerpolicy="no-referrer" decoding="async" onerror="this.remove()">` : ""}</div>
            <div class="tag-row pick-preview-muscles">${muscles}</div>
            ${history}
            ${technique}
            ${reactionBar(exercise)}
            <div class="pick-preview-actions"><button class="button button-primary" type="button" data-action="add-exercise" data-exercise-id="${escapeHtml(exercise.id)}"><i data-lucide="${state.replaceExerciseTarget ? "repeat" : "plus"}"></i>${action}</button></div>
        </div>`, { fullscreen: true });
}

/** Back to the grid; a like given in the preview shows on its card. */
export function closePickerPreview() {
    closeSheet();
    const grid = element("exercisePickerGrid");
    if (grid) {
        // Same pages, same place: the grid repaints where the person was, not from the top.
        const top = grid.scrollTop;
        grid.innerHTML = exercisePickerCards();
        iconsIn(grid);
        grid.scrollTop = top;
    }
}

export function openCustomExercise(exercise = null, prefill = {}) {
    const data = exercise && exercise.id ? exercise : null;
    const isEdit = Boolean(data);
    // Unconditional, and before the paywall return: a fresh form must never inherit
    // the previous one's acknowledged name or picked gif.
    duplicateCheckState = { acknowledgedName: "" };
    mediaSuggestState = { query: "", items: [], picked: null };
    // Free tier: 1 custom exercise per month. Editing your own is always allowed.
    if (!isEdit && !hasUnlimited() && exerciseQuotaState(currentUser().id).over) {
        openPaywallModal({ type: "exercise" });
        return;
    }
    const val = (value) => escapeHtml(value == null ? "" : String(value));
    const aliasesValue = data && Array.isArray(data.aliases) ? data.aliases.join(", ") : "";
    // has-image is what makes .media-url-preview visible (it is display:none without
    // it). The edit branch used to omit it, so an existing exercise's image stayed
    // invisible until the user touched the input and handleInput re-rendered it.
    const previewBlock = data && imageUrl(data.mediaUrl)
        ? `<div class="media-url-preview has-image" id="customExerciseMediaPreview"><img src="${val(data.mediaUrl)}" alt="${val(data.name)}" referrerpolicy="no-referrer" onerror="this.closest('.media-url-preview')?.classList.remove('has-image'); this.remove();"></div>`
        : `<div class="media-url-preview" id="customExerciseMediaPreview"></div>`;
    const moderationHint = isEdit
        ? `<p class="card-caption">${isAdmin() ? "Зміни застосуються одразу." : "Після збереження вправа знову піде на модерацію."}</p>`
        : `<p class="card-caption">${isAdmin() ? "Вправа з'явиться в каталозі одразу." : "Нова вправа піде на модерацію адміну."}</p>`;
    openModal(`<div class="modal-header"><div><h2>${isEdit ? "Редагувати вправу" : "Власна вправа"}</h2>${moderationHint}</div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><input type="hidden" id="customExerciseId" value="${val(data?.id)}"><div class="field-grid"><div class="field"><label>Назва</label><input id="customExerciseName" type="text" placeholder="Жим у Smith під кутом" value="${val(data ? data.name : prefill.name)}"></div><div class="field"><label>Аліаси</label><input id="customExerciseAliases" type="text" placeholder="Через кому" value="${val(aliasesValue)}"></div><div class="field"><label>Основний м'яз</label>${select("customExerciseMuscle", muscles(), data?.primaryMuscleGroup || "Груди")}</div><div class="field"><label>Патерн руху</label>${select("customExercisePattern", patterns(), data?.movementPattern || "Горизонтальний жим")}</div><div class="field"><label>Обладнання</label>${select("customExerciseEquipment", equipment(), data?.equipment || "Тренажер")}</div><div class="field"><label>Складність</label>${select("customExerciseDifficulty", ["Початковий", "Середній", "Просунутий"], data?.difficulty || "Середній")}</div></div><label class="toggle-row" style="margin-top:14px;"><input type="checkbox" id="customExerciseTimed" ${data?.isTimed ? "checked" : ""}><span class="toggle-row-text"><strong>Вимірюється часом</strong><span class="card-caption">Планка, віс на перекладині, утримання — підходи рахуються в секундах, а не в повтореннях.</span></span></label><div class="field" style="margin-top:14px;"><label>Опис</label><textarea id="customExerciseDescription" placeholder="Коротке пояснення">${val(data?.description)}</textarea></div><div class="field" style="margin-top:14px;"><label>Зображення / GIF (посилання)</label><input id="customExerciseMedia" type="url" placeholder="https://...jpg, .png або .gif" data-action="custom-exercise-media" value="${val(data?.mediaUrl)}"><div class="action-row" style="margin-top:8px;"><button class="button button-secondary compact" type="button" data-action="suggest-exercise-media"><i data-lucide="sparkles"></i>Підібрати GIF</button></div>${previewBlock}</div><div class="form-actions" style="justify-content:flex-end;margin-top:16px;"><button class="button button-secondary" type="button" data-action="close-overlay">Скасувати</button><button class="button button-primary" type="button" data-action="save-custom-exercise">${isEdit ? "Зберегти зміни" : "Зберегти вправу"}</button></div>`);
}

export function editExercise(exerciseId) {
    const exercise = exerciseById(exerciseId);
    if (!exercise) {
        return;
    }
    if (!canEditExercise(exercise)) {
        toast("Немає доступу", "Редагувати можна лише власні вправи.");
        return;
    }
    openCustomExercise(exercise);
}

export async function deleteExerciseEntry(exerciseId) {
    const exercise = exerciseById(exerciseId);
    if (!exercise) {
        return;
    }
    if (!canEditExercise(exercise)) {
        toast("Немає доступу", "Видаляти можна лише власні вправи.");
        return;
    }
    // How much history leans on it. Only hydrated workouts can be counted — a peer
    // summary carries no exercises — so this is "yours", which is the number that
    // actually matters to the person deciding.
    const used = state.database.workouts.filter(
        (workoutItem) => isHydratedWorkout(workoutItem)
            && workoutItem.exercises.some((entry) => entry.exerciseId === exercise.id)
    ).length;
    const confirmed = await confirmDialog(`«${exercise.name}»`, {
        title: "Видалити вправу з каталогу?",
        detail: used
            ? `Використана у ${used} ${pluralUk(used, "твоєму тренуванні", "твоїх тренуваннях", "твоїх тренуваннях")} — записи залишаться, але вправа зникне з каталогу.`
            : "Жодне тренування її не використовує.",
        confirmLabel: "Видалити",
        note: "Матимеш 20 секунд, щоб повернути."
    });
    if (!confirmed) {
        return;
    }
    const index = state.database.exercises.findIndex((item) => item.id === exercise.id);
    state.database.exercises = state.database.exercises.filter((item) => item.id !== exercise.id);
    renderSection();

    removeWithUndo({
        key: `exercise:${exercise.id}`,
        title: "Вправу видалено",
        message: used ? `${exercise.name} · була у ${used} ${pluralUk(used, "тренуванні", "тренуваннях", "тренуваннях")}` : exercise.name,
        restore: () => {
            if (!state.database.exercises.some((item) => item.id === exercise.id)) {
                state.database.exercises.splice(index < 0 ? state.database.exercises.length : index, 0, exercise);
            }
            renderSection();
            showSyncIndicator("success", "Повернуто");
        },
        commit: async () => {
            if (storage.mode === "api" && storage.apiClient.hasBaseUrl()) {
                try {
                    await storage.apiClient.deleteExercise(exercise.id);
                } catch (error) {
                    if (Number(error?.status) !== 404) {
                        showSyncIndicator("error", friendlyError(error));
                    }
                }
            } else {
                await persist({ silent: true });
            }
        }
    });
}

export async function approveExerciseEntry(exerciseId) {
    if (!isAdmin()) {
        return;
    }
    const exercise = exerciseById(exerciseId);
    if (!exercise) {
        return;
    }
    if (storage.mode === "api" && storage.apiClient.hasBaseUrl()) {
        await storage.apiClient.approveExercise(exercise.id);
    }
    exercise.status = "approved";
    renderSection();
    toast("Вправу схвалено", exercise.name);
}

export async function rejectExerciseEntry(exerciseId) {
    if (!isAdmin()) {
        return;
    }
    const exercise = exerciseById(exerciseId);
    if (!exercise) {
        return;
    }
    const confirmed = await confirmDialog(`Відхилити та видалити «${exercise.name}»? Вправу буде видалено з каталогу.`, { confirmLabel: "Відхилити" });
    if (!confirmed) {
        return;
    }
    if (storage.mode === "api" && storage.apiClient.hasBaseUrl()) {
        await storage.apiClient.rejectExercise(exercise.id);
    }
    state.database.exercises = state.database.exercises.filter((item) => item.id !== exercise.id);
    renderSection();
    toast("Вправу відхилено", exercise.name);
}

// Returns true when the caller should go ahead and create the exercise. NEVER throws:
// a failing, slow or unavailable duplicate check must not stop somebody adding their
// exercise, and an escaped error would land in handleUserFacingError and show a red
// toast for something that was only ever advisory.
async function confirmNotDuplicate(payload, apiMode) {
    // Nothing to ask in local mode. index.html sets allowLocalFallback:false, so in
    // production this branch is dev-only.
    if (!apiMode) {
        return true;
    }
    const key = payload.name.trim().toLowerCase();
    if (duplicateCheckState.acknowledgedName === key) {
        return true;
    }
    let result = null;
    try {
        // The Save button is already spinning from runAction; only the chip's label is
        // wrong, and the create path overwrites it back to "Зберігаємо вправу".
        showSyncIndicator("loading", "Шукаємо схожі вправи");
        result = await storage.apiClient.checkExerciseDuplicate({
            // EXACTLY these five fields, never the whole payload: the backend runs a
            // whitelist validation pipe with forbidNonWhitelisted, so any extra key
            // (movementPattern, category, techniqueSteps...) makes the request 400.
            name: payload.name,
            primaryMuscleGroup: payload.primaryMuscleGroup,
            equipment: payload.equipment,
            description: payload.description,
            aliases: payload.aliases
        });
    } catch (error) {
        console.warn("duplicate check failed", error);
        return true;
    }
    const matches = Array.isArray(result?.matches) ? result.matches : [];
    if (!matches.length) {
        return true; // nothing to warn about, the user sees no extra step at all
    }
    const choice = await openDuplicateSheet(matches, result);
    if (choice === "create") {
        duplicateCheckState.acknowledgedName = key;
        return true;
    }
    if (typeof choice === "string" && choice.startsWith("use:")) {
        useExistingExercise(choice.slice(4));
        return false;
    }
    return false; // "cancel", backdrop or Escape: stay in the form, create nothing
}

// The user picked an existing exercise instead of creating a twin. Close the form and
// open the catalog entry so they can look at it.
function useExistingExercise(exerciseId) {
    const existing = exerciseById(exerciseId);
    closeOverlay();
    renderSection();
    toast("Вже є в каталозі", existing ? existing.name : "Скористайся наявною вправою.");
    if (existing) {
        // Safe immediately after closeOverlay: openDrawer clears the deferred wipe
        // timer that would otherwise blank the layer 240 ms from now.
        openExercise(exerciseId);
    }
}

export async function saveCustomExercise() {
    const name = inputValue("customExerciseName").trim();
    if (!name) {
        toast("Потрібна назва", "Додай зрозумілу назву вправи.");
        return;
    }
    const editId = inputValue("customExerciseId");
    const existing = editId ? exerciseById(editId) : null;
    if (existing && !canEditExercise(existing)) {
        toast("Немає доступу", "Редагувати можна лише власні вправи.");
        return;
    }
    const muscle = inputValue("customExerciseMuscle");
    const pattern = inputValue("customExercisePattern");
    const mediaUrl = imageUrl(inputValue("customExerciseMedia"));
    // The extension is only a hint - a gif is often served from an extensionless URL.
    // When the URL came from a suggestion the server already read its real
    // content-type, so prefer that answer over guessing.
    let mediaType = mediaUrl ? (/\.gif(\?|$)/i.test(mediaUrl) ? "gif" : "image") : "none";
    if (mediaUrl && mediaSuggestState.picked && mediaSuggestState.picked.url === mediaUrl) {
        mediaType = mediaSuggestState.picked.mediaType;
    }
    // Admins publish instantly; everyone else (create or edit) goes to moderation.
    const status = isAdmin() ? "approved" : "pending";
    const payload = {
        name,
        aliases: splitCsv(inputValue("customExerciseAliases")),
        primaryMuscleGroup: muscle,
        secondaryMuscleGroups: existing?.secondaryMuscleGroups || [],
        movementPattern: pattern,
        equipment: inputValue("customExerciseEquipment"),
        category: existing?.category || "Власна",
        difficulty: inputValue("customExerciseDifficulty"),
        description: inputValue("customExerciseDescription") || `${name} — власна вправа з фокусом на ${muscle.toLowerCase()}.`,
        techniqueSteps: existing?.techniqueSteps?.length ? existing.techniqueSteps : techniqueFor(pattern),
        commonMistakes: existing?.commonMistakes?.length ? existing.commonMistakes : mistakesFor(pattern),
        safetyTips: existing?.safetyTips?.length ? existing.safetyTips : safetyFor(pattern),
        mediaUrl,
        mediaType,
        isCustom: true,
        isTimed: checkboxValue("customExerciseTimed")
    };
    const apiMode = storage.mode === "api" && storage.apiClient.hasBaseUrl();

    if (existing) {
        Object.assign(existing, payload, { status, updatedAt: new Date().toISOString() });
        if (apiMode) {
            showSyncIndicator("loading", "Зберігаємо зміни");
            try {
                await storage.apiClient.updateExercise(existing.id, payload);
                showSyncIndicator("success", "Збережено");
            } catch (error) {
                showSyncIndicator("error", friendlyError(error));
                throw error;
            }
        } else {
            await persist({ silent: true });
        }
        closeOverlay();
        renderSection();
        toast(status === "pending" ? "Зміни на модерації" : "Вправу оновлено", name);
        return;
    }

    // Create path only - the edit branch above has already returned. Advisory: any
    // failure inside falls through to creation, it never blocks. Returning here leaves
    // the modal open with every field intact; nothing has been mutated yet.
    const proceed = await confirmNotDuplicate(payload, apiMode);
    if (!proceed) {
        return;
    }

    const newExercise = {
        id: createId("exercise"),
        ...payload,
        status,
        createdByUserId: currentUser().id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    if (apiMode) {
        showSyncIndicator("loading", "Зберігаємо вправу");
        try {
            const created = await storage.apiClient.createExercise(payload);
            if (created?.id) {
                newExercise.id = created.id;
                newExercise.createdByUserId = created.createdByUserId || newExercise.createdByUserId;
                if (created.status) {
                    newExercise.status = created.status;
                }
            }
            state.database.exercises.push(newExercise);
            showSyncIndicator("success", "Збережено");
        } catch (error) {
            showSyncIndicator("error", friendlyError(error));
            throw error;
        }
    } else {
        state.database.exercises.push(newExercise);
        await persist({ silent: true });
    }
    closeOverlay();
    renderSection();
    toast(status === "pending" ? "Відправлено на модерацію" : "Власну вправу створено", name);
    checkAchievementUnlocks();
}

// ---- Duplicate-exercise warning sheet --------------------------------------
// Stacked ABOVE the still-open custom-exercise form (openSheet only ever touches
// #modalLayer2), so every field the user typed keeps its live DOM value. Resolves
// "create" | "use:<id>" | "cancel".
//
// Buttons here deliberately carry data-dup / data-dup-use instead of data-action:
// the global handleClick delegate matches any [data-action] anywhere in the document,
// so a data-action button inside the sheet would ALSO be routed through runAction and
// fire twice, with a second spinner. Same reason choiceDialog uses data-choice.
function openDuplicateSheet(matches, result) {
    return new Promise((resolve) => {
        const backdrop = element("modalBackdrop2");
        openSheet(duplicateSheetHtml(matches, result));
        const layer = element("modalLayer2");
        let settled = false;
        const finish = (value) => {
            if (settled) {
                return;
            }
            settled = true;
            sheetDismissHooks.delete(onDismiss);
            backdrop.removeEventListener("click", onBackdrop);
            document.removeEventListener("keydown", onKey, true);
            closeSheet();
            resolve(value);
        };
        // Covers every exit that bypasses our own buttons: closeOverlay(), the global
        // backdrop click, and data-action="close-sheet". Without it the Save button
        // stays disabled with a spinner forever, because runAction is still awaiting.
        const onDismiss = () => finish("cancel");
        const onBackdrop = () => finish("cancel");
        // Capture phase so it lands before any other Escape handler gets to close the
        // sheet out from under us. finish() closes it itself.
        const onKey = (event) => {
            if (event.key === "Escape") {
                finish("cancel");
            }
        };
        sheetDismissHooks.add(onDismiss);
        backdrop.addEventListener("click", onBackdrop);
        document.addEventListener("keydown", onKey, true);
        layer.querySelectorAll("[data-dup]").forEach((button) => {
            button.addEventListener("click", () => finish(button.dataset.dup));
        });
        layer.querySelectorAll("[data-dup-use]").forEach((button) => {
            button.addEventListener("click", () => finish(`use:${button.dataset.dupUse}`));
        });
    });
}

function duplicateSheetHtml(matches, result) {
    const hasSame = matches.some((match) => match.verdict === "same");
    const title = hasSame ? "Здається, така вправа вже є" : "Знайшли схожі вправи";
    const lead = result?.aiUsed
        ? "AI звірив твою вправу з каталогом. Подивись і вирішуй сам: узяти наявну чи все одно створити свою."
        : "Знайшли вправи зі схожою назвою. Глянь, чи це не те саме.";
    return `<div class="confirm-dialog dup-sheet">`
        + `<div class="modal-header"><div><h2>${escapeHtml(title)}</h2><p class="card-caption">${escapeHtml(lead)}</p></div>`
        + `<button class="icon-button" type="button" data-dup="cancel" aria-label="Закрити"><i data-lucide="x"></i></button></div>`
        + duplicateDegradedNote(result)
        + `<div class="dup-list">${matches.map(duplicateCard).join("")}</div>`
        + `<p class="dup-footnote">Форма нікуди не зникла: усі поля лишились заповненими.</p>`
        + `<div class="form-actions confirm-choices">`
        + `<button class="button button-secondary" type="button" data-dup="cancel">Назад до форми</button>`
        + `<button class="button button-primary" type="button" data-dup="create">Все одно створити</button>`
        + `</div></div>`;
}

// Only shown when the AI judge did not run: the cards are then pure name similarity,
// which is a much weaker claim, and the copy has to say so.
function duplicateDegradedNote(result) {
    if (result?.aiUsed) {
        return "";
    }
    if (result?.degradedReason === "AI_FORBIDDEN") {
        return `<div class="ai-banner ai-banner-info"><i data-lucide="sparkles"></i><p>AI-перевірка схожості доступна в PRO. Поки що звірили тільки за назвою.</p></div>`;
    }
    return `<div class="ai-banner ai-banner-warn"><i data-lucide="alert-triangle"></i><p>AI зараз недоступний, тож звірили тільки за назвою. Перевір сам, чи це справді те саме.</p></div>`;
}

function duplicateCard(match) {
    const isSame = match.verdict === "same";
    const verdictBadge = isSame
        ? `<span class="pill-badge pending"><i data-lucide="copy"></i>Схоже, те саме</span>`
        : `<span class="pill-badge"><i data-lucide="info"></i>Варіація</span>`;
    const mineBadge = match.isMine ? `<span class="pill-badge mine"><i data-lucide="bookmark-check"></i>Моя</span>` : "";
    // reason is model output: escaped like every other untrusted string.
    const reason = match.reason
        ? `<p class="dup-reason"><i data-lucide="sparkles"></i><span>${escapeHtml(match.reason)}</span></p>`
        : "";
    const tags = [match.primaryMuscleGroup, match.movementPattern, match.equipment]
        .filter(Boolean)
        .map((value) => `<span class="chip">${escapeHtml(value)}</span>`)
        .join("");
    // A null author means the built-in catalog rather than a person.
    const author = match.author ? escapeHtml(match.author) : "GymOS";
    // No data-action="open-exercise" on the article: it would fire openDrawer, which
    // wipes #modalLayer and destroys the half-filled form behind this sheet. No
    // reaction bar either: a like/dislike POST from a confirmation dialog is wrong.
    return `<article class="exercise-card has-thumb dup-card ${isSame ? "is-same" : "is-similar"}">`
        + exerciseThumb(match)
        + `<div class="exercise-card-tags inline">${verdictBadge}${mineBadge}</div>`
        + `<div class="exercise-card-body"><h3>${escapeHtml(match.name)}</h3>`
        + (match.description ? `<p class="card-caption exercise-card-desc">${escapeHtml(match.description)}</p>` : "")
        + (tags ? `<div class="tag-row">${tags}</div>` : "")
        + reason
        + `</div>`
        + `<div class="exercise-card-footer"><span class="exercise-meta-name">${author}</span>`
        + `<button class="button button-primary compact" type="button" data-dup-use="${escapeHtml(match.id)}">Використати цю</button></div>`
        + `</article>`;
}

// ---- Suggested demo gifs sheet ---------------------------------------------
// Opened from the media field of the custom-exercise form. Same layer as the
// duplicate sheet, but the two can never be open at once: one is a side branch off a
// field, the other gates the Save button.
export async function suggestExerciseMedia() {
    const name = inputValue("customExerciseName").trim();
    if (name.length < 2) {
        toast("Спочатку введи назву", "Без назви немає що шукати.");
        return;
    }
    if (!(storage.mode === "api" && storage.apiClient.hasBaseUrl())) {
        toast("Потрібен звʼязок із сервером", "Підбір GIF працює лише онлайн.");
        return;
    }
    const payload = {
        name,
        aliases: splitCsv(inputValue("customExerciseAliases")).slice(0, 8),
        primaryMuscleGroup: inputValue("customExerciseMuscle"),
        equipment: inputValue("customExerciseEquipment"),
        movementPattern: inputValue("customExercisePattern"),
        limit: 6
    };
    const token = ++mediaSuggestToken;
    mediaSuggestState.query = name;
    mediaSuggestState.items = [];
    // Open on the loading state immediately: the search costs a couple of seconds and
    // an empty screen behind a button spinner reads as nothing having happened.
    renderMediaSuggestSheet(mediaSuggestLoadingHtml(name));
    let response = null;
    let failure = null;
    try {
        response = await storage.apiClient.suggestExerciseMedia(payload);
    } catch (error) {
        console.warn("media suggest failed", error);
        failure = error;
    }
    if (token !== mediaSuggestToken) {
        return; // sheet was dismissed, or a newer search took over
    }
    mediaSuggestState.items = Array.isArray(response?.items) ? response.items : [];
    renderMediaSuggestSheet(mediaSuggestSheetHtml(response, name, failure));
}

// Paints (or repaints) the sheet and re-wires its listeners. openSheet replaces the
// whole innerHTML, so every listener has to be attached again after each render.
function renderMediaSuggestSheet(html) {
    openSheet(html);
    const layer = element("modalLayer2");
    // One dismiss hook for as long as the sheet lives: any close path invalidates the
    // token, so an in-flight response cannot repaint a sheet that is already gone.
    if (!mediaSuggestHooked) {
        mediaSuggestHooked = true;
        sheetDismissHooks.add(() => {
            mediaSuggestHooked = false;
            mediaSuggestToken += 1;
        });
    }
    layer.querySelectorAll("[data-media-close]").forEach((button) => {
        button.addEventListener("click", () => closeSheet());
    });
    layer.querySelectorAll("[data-media-url]").forEach((button) => {
        button.addEventListener("click", () => applySuggestedMedia(button.dataset.mediaUrl, button.dataset.mediaType));
    });
}

function applySuggestedMedia(url, mediaType) {
    const field = element("customExerciseMedia");
    if (!field) {
        closeSheet();
        return;
    }
    field.value = url || "";
    mediaSuggestState.picked = { url: url || "", mediaType: mediaType || "image" };
    // Reuse the form's own input handler instead of duplicating the preview markup:
    // it already toggles .has-image and injects the <img>.
    field.dispatchEvent(new Event("input", { bubbles: true }));
    closeSheet();
    toast("Зображення додано", "Не забудь зберегти вправу.");
}

function mediaSuggestHeader(query, subtitle) {
    return `<div class="modal-header"><div><h2>Підібрані GIF</h2>`
        + `<p class="card-caption">Для «${escapeHtml(query)}»${subtitle ? ` · ${subtitle}` : ""}</p></div>`
        + `<button class="icon-button" type="button" data-media-close="1" aria-label="Закрити"><i data-lucide="x"></i></button></div>`;
}

function mediaSuggestFooter() {
    return `<div class="form-actions confirm-choices">`
        + `<button class="button button-secondary" type="button" data-media-close="1">Без зображення</button></div>`;
}

function mediaSuggestLoadingHtml(query) {
    const tiles = Array.from({ length: 6 }, () => `<div class="media-suggest-card is-skeleton sk-wrap" aria-hidden="true">`
        + `<span class="sk media-suggest-skthumb"></span><span class="sk sk-line half"></span><span class="sk sk-line short"></span></div>`).join("");
    return mediaSuggestHeader(query, "шукаємо анімації")
        + `<div class="media-suggest-grid" aria-busy="true">${tiles}</div>`
        + mediaSuggestFooter();
}

function mediaSuggestSheetHtml(response, query, failure) {
    if (failure) {
        return mediaSuggestHeader(query, "")
            + `<div class="ai-banner ai-banner-error"><i data-lucide="alert-triangle"></i><p>Не вдалося отримати підказки. Встав посилання вручну або спробуй ще раз.</p></div>`
            + mediaSuggestFooter();
    }
    const items = Array.isArray(response?.items) ? response.items : [];
    const nearby = Array.isArray(response?.nearby) ? response.nearby : [];
    const degraded = response?.degraded;
    const notes = [];
    if (degraded === "ai_unavailable" || degraded === "ai_quota") {
        notes.push(`<div class="ai-banner ai-banner-info"><i data-lucide="sparkles"></i><p>AI зараз недоступний, тож шукали просто за назвою.</p></div>`);
    }
    if (response?.lowConfidence) {
        notes.push(`<div class="ai-banner ai-banner-warn"><i data-lucide="alert-triangle"></i><p>Не впевнені, що правильно розпізнали назву. Перевір, чи це та сама вправа.</p></div>`);
    }
    if (degraded === "verification_failed" || degraded === "timeout") {
        notes.push(`<div class="ai-banner ai-banner-warn"><i data-lucide="alert-triangle"></i><p>Встигли перевірити не всі варіанти. Спробуй ще раз, якщо тут замало.</p></div>`);
    }
    // Showing WHAT was searched for is the mitigation for the real failure mode here:
    // a working gif of the wrong exercise. The user has to be able to spot it.
    const subtitle = response?.resolvedName ? `шукали як «${escapeHtml(response.resolvedName)}»` : "";
    const head = mediaSuggestHeader(query, subtitle) + notes.join("");
    if (!items.length) {
        const nearbyBlock = nearby.length
            ? `<p class="card-caption dup-footnote">Схожі за групою мʼязів:</p>`
              + `<div class="media-suggest-grid">${nearby.map(mediaSuggestCard).join("")}</div>`
            : "";
        return head
            + `<div class="ai-empty"><i data-lucide="search"></i><p>Нічого перевіреного не знайшли. Встав посилання вручну або спробуй іншу назву.</p></div>`
            + nearbyBlock + mediaSuggestFooter();
    }
    return head
        + `<div class="media-suggest-grid">${items.map(mediaSuggestCard).join("")}</div>`
        + mediaSuggestFooter();
}

function mediaSuggestCard(item) {
    const isGif = item?.mediaType === "gif";
    const url = imageUrl(item?.url);
    if (!url) {
        return "";
    }
    const label = item?.label || "";
    return `<button class="media-suggest-card${isGif ? " is-gif" : ""}" type="button" data-media-url="${escapeHtml(url)}" data-media-type="${escapeHtml(item?.mediaType || "image")}">`
        + `<span class="media-suggest-thumb"><img src="${escapeHtml(url)}" alt="${escapeHtml(label)}" referrerpolicy="no-referrer" loading="lazy" decoding="async"`
        // Backstop, not the guarantee: the server HEAD-verified every URL, but a tile
        // that still fails to paint removes itself rather than showing a broken frame.
        + ` onerror="this.closest('.media-suggest-card')?.remove();"></span>`
        + `<span class="pill-badge${isGif ? " mine" : " pending"}"><i data-lucide="${isGif ? "play" : "eye"}"></i>${isGif ? "GIF" : "Фото"}</span>`
        + `<span class="media-suggest-label">${escapeHtml(label)}</span>`
        + `<span class="media-suggest-meta">${escapeHtml(item?.sourceLabel || "")}</span>`
        + `</button>`;
}
