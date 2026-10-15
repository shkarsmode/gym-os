// The exercise catalogue screen and its counter.
import { escapeHtml, unique } from "../lib/format.js";
import { emptyInline, exerciseCard } from "./components.js";
import { muscleIcon, muscleLabel } from "./exercise-picker.js";
import { isMyExercise } from "./model.js";
import { content, element } from "./overlays.js";
import { filteredExercises } from "./scoring-bridge.js";
import { state } from "./state.js";
import { iconsIn } from "./util.js";
import { pluralUk } from "./workout-screen.js";

export function exercises() {
    // Filtered once and handed to both the counter and the grid: computing it twice
    // is how a counter starts disagreeing with the cards underneath it.
    const items = filteredExercises();
    const catalogShown = items.length;
    content(`<section class="card catalog-head"><div class="card-header"><div class="head-dup"><h2>Каталог вправ</h2><p class="card-caption">Пошук за назвою, alias, м'язом, патерном або обладнанням + фільтри за групою м'язів і обладнанням.</p></div><button class="button button-primary compact" type="button" data-action="open-custom-exercise"><i data-lucide="plus"></i>Власна вправа</button></div><div id="exerciseCatalogFilters">${catalogFilterRow()}</div><div class="catalog-count" id="catalogCount" data-shown="${catalogShown}">${catalogCounterMarkup(catalogShown)}</div></section><section class="exercise-card-grid" id="exerciseCatalogGrid" style="margin-top:16px;">${exerciseCatalogCards(items)}</section>`);
}

// Same filter row as the add-exercise modal: search + visual muscle-grid trigger
// + equipment select. Reuses the picker's shared filter state (pickerMuscle /
// pickerEquipment / exerciseSearch) so both surfaces filter identically.
export function catalogFilterRow() {
    const equipmentList = unique(state.database.exercises.map((exercise) => exercise.equipment).filter(Boolean));
    const option = (value, label) => `<option value="${escapeHtml(value)}" ${state.filters.pickerEquipment === value ? "selected" : ""}>${escapeHtml(label)}</option>`;
    const equipmentOptions = option("all", "Все обладнання") + equipmentList.map((value) => option(value, value)).join("");
    const muscle = state.filters.pickerMuscle;
    return `<input type="search" class="picker-search" placeholder="Пошук за назвою, alias, м'язом, патерном або обладнанням" value="${escapeHtml(state.filters.exerciseSearch)}" data-action="exercise-search">
            <div class="picker-filter-row">
                <button type="button" class="picker-muscle-trigger" data-action="open-muscle-grid"><span class="picker-muscle-ic">${muscleIcon(muscle)}</span><span class="picker-muscle-label">${escapeHtml(muscleLabel(muscle))}</span><i data-lucide="chevron-down" class="gselect-caret"></i></button>
                <gym-select data-action="picker-filter-select" data-key="pickerEquipment">${equipmentOptions}</gym-select>
            </div>`;
}

function exerciseCatalogCards(items) {
    const list = items || filteredExercises();
    return list.length ? list.map(exerciseCard).join("") : emptyInline("Нічого не знайдено", "Спробуй іншу назву, м'язову групу або обладнання.");
}

// ---- Catalogue counter ---------------------------------------------------------------
//
// How much of the library the current filter leaves standing. The number TWEENS
// rather than snapping, because the informative part is the CHANGE: 149 to 23 as a
// filter lands is the feedback that the filter did something, where a swapped digit
// reads as nothing having happened.

function catalogCounterLabel(shown, total) {
    if (!total) {
        return "Каталог порожній";
    }
    if (!shown) {
        return "нічого не знайдено — спробуй інший фільтр";
    }
    if (shown === total) {
        return `${pluralUk(total, "вправа", "вправи", "вправ")} у каталозі`;
    }
    return `${pluralUk(shown, "вправа", "вправи", "вправ")} з <b>${total}</b> за фільтром`;
}

// A sliver of bar for a single match, so "1 of 149" still reads as a bar rather than
// an empty track indistinguishable from "nothing found".
function catalogCounterShare(shown, total) {
    if (!total || !shown) {
        return 0;
    }
    return Math.max(4, Math.round((shown / total) * 100));
}

function catalogCounterMarkup(shown) {
    const total = state.database.exercises.length;
    const mine = state.database.exercises.filter(isMyExercise).length;
    const pending = state.database.exercises.filter((exercise) => exercise.status === "pending").length;
    const chips = `${mine ? `<span class="cc-chip"><i data-lucide="bookmark-check"></i>${mine} ${pluralUk(mine, "твоя", "твої", "твоїх")}</span>` : ""}${pending ? `<span class="cc-chip warn"><i data-lucide="clock"></i>${pending} на модерації</span>` : ""}`;
    return `<span class="cc-num">${shown}</span><div class="cc-text"><span class="cc-label">${catalogCounterLabel(shown, total)}</span><div class="cc-bar"><span style="width:${catalogCounterShare(shown, total)}%"></span></div></div>${chips ? `<div class="cc-chips">${chips}</div>` : ""}`;
}

function updateCatalogCounter(shown) {
    const host = element("catalogCount");
    if (!host) {
        return;
    }
    const total = state.database.exercises.length;
    const previous = Number(host.dataset.shown);
    const num = host.querySelector(".cc-num");
    const label = host.querySelector(".cc-label");
    const bar = host.querySelector(".cc-bar > span");
    if (num && label && bar) {
        // Targeted: the chips and their icons do not change while you type, and
        // rebuilding them would re-run icon replacement once per keystroke.
        label.innerHTML = catalogCounterLabel(shown, total);
        bar.style.width = `${catalogCounterShare(shown, total)}%`;
    } else {
        host.innerHTML = catalogCounterMarkup(shown);
        iconsIn(host);
    }
    host.dataset.shown = String(shown);
    host.classList.toggle("is-empty", shown === 0);
    tweenCount(host.querySelector(".cc-num"), Number.isFinite(previous) ? previous : shown, shown);
}

/**
 * Count from one number to another over a third of a second.
 *
 * Backed by a timeout that force-writes the final value: requestAnimationFrame is
 * throttled to a crawl — or never delivered at all — in a backgrounded or automated
 * tab, and a counter frozen mid-tween is not a cosmetic problem, it is a number on
 * screen that is simply wrong.
 */
function tweenCount(node, from, to) {
    if (!node) {
        return;
    }
    const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || Math.abs(to - from) < 2) {
        node.textContent = String(to);
        return;
    }
    const duration = 340;
    const started = performance.now();
    node.textContent = String(from);
    const step = (now) => {
        const progress = Math.min(1, (now - started) / duration);
        // Ease-out, so the number lands softly instead of stopping dead.
        const eased = 1 - Math.pow(1 - progress, 3);
        node.textContent = String(Math.round(from + (to - from) * eased));
        if (progress < 1 && node.isConnected) {
            requestAnimationFrame(step);
        }
    };
    requestAnimationFrame(step);
    setTimeout(() => {
        if (node.isConnected) {
            node.textContent = String(to);
        }
    }, duration + 90);
}

/**
 * One entry point for repainting the catalogue.
 *
 * The counter and the grid come from the SAME filtered array, so the headline number
 * cannot drift from the cards below it — which is exactly what happens when three
 * separate call sites each refresh only the half they remembered about.
 */
export function refreshCatalog() {
    const grid = element("exerciseCatalogGrid");
    if (!grid) {
        return;
    }
    const items = filteredExercises();
    grid.innerHTML = exerciseCatalogCards(items);
    iconsIn(grid);
    updateCatalogCounter(items.length);
}
