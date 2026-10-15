// Workout-screen helpers: last-results focus, notes, topbar context, quick actions, day sheet, cardio modal.
import { escapeHtml, number, dateInput, formatDate } from "../lib/format.js";
import { workoutTypeLabels } from "../lib/constants.js";
import { emptyInline } from "./components.js";
import {
    avatar, canManage, currentUser, ownWorkout, startWorkoutButton, statusLabel, statusRank, userById,
    workoutCardioMinutes, workoutLimitState, workoutNumber, workoutSetCount, workoutStatusOf, workoutTypeLabel
} from "./model.js";
import { choiceDialog, element, openModal, toast } from "./overlays.js";
import { renderCurrentUserButton, renderSection, setPendingNoteFocus, topbarContextBase } from "./shell.js";
import { state } from "./state.js";
import { iconsIn } from "./util.js";
import { updateWorkoutMeta } from "./workout-actions.js";
import { workoutVolumeOf } from "./workout-history.js";

// Highlights the chip in «Минулого разу» that lines up with the set you are looking at.
//
// The pill is sticky, so its bottom edge is effectively the reading line: whichever set
// row's centre sits closest to that line is the one in front of you, and its previous
// result is the number you actually want to compare against.
export function updateLastResultsFocus() {
    const pills = document.querySelectorAll(".last-results");
    for (const pill of pills) {
        const card = pill.closest(".workout-exercise");
        if (!card) {
            continue;
        }
        const cardRect = card.getBoundingClientRect();
        const chips = pill.querySelectorAll("[data-set-index]");
        const allRows = card.querySelectorAll(".set-row");
        if (cardRect.bottom < 0 || cardRect.top > window.innerHeight) {
            // Off screen: clear it, so scrolling back does not flash a stale chip.
            chips.forEach((chip) => chip.classList.remove("is-current"));
            allRows.forEach((row) => row.classList.remove("is-reading"));
            continue;
        }
        const rows = allRows;
        if (!rows.length || !chips.length) {
            continue;
        }
        const line = pill.getBoundingClientRect().bottom;
        // A set hands over to the next one as soon as ~30% of it has passed the line —
        // by then you are reading the row below, and waiting for the halfway point made
        // the highlight feel a beat late.
        let best = 0;
        rows.forEach((row, index) => {
            const rect = row.getBoundingClientRect();
            if (rect.top + rect.height * 0.3 <= line) {
                best = Math.min(rows.length - 1, index + 1);
            }
        });
        chips.forEach((chip, index) => chip.classList.toggle("is-current", index === best));
        // The chips are one line that scrolls sideways when there are many sets, so the
        // current one has to be brought into view — but only when it is actually out of
        // it, or every scroll of the page would nudge the strip.
        const strip = pill.querySelector(".last-results-chips");
        const current = chips[best];
        if (strip && current && strip.scrollWidth > strip.clientWidth) {
            const left = current.offsetLeft - strip.offsetLeft;
            const right = left + current.offsetWidth;
            if (left < strip.scrollLeft || right > strip.scrollLeft + strip.clientWidth) {
                strip.scrollLeft = Math.max(0, left - (strip.clientWidth - current.offsetWidth) / 2);
            }
        }
        // Mark the ROW as well, so the pairing is visible at both ends: the chip up in
        // the sticky strip and the number down in the row are lit together, and you can
        // read "this set was 80x3 last time" without counting positions between them.
        rows.forEach((row, index) => row.classList.toggle("is-reading", index === best));
    }
}

// The workout type lives in the title now, so changing it is a one-tap sheet rather
// than a select buried under the fold.
export async function openWorkoutTypePicker(workoutId) {
    const workoutItem = ownWorkout(workoutId);
    if (!workoutItem || !canManage(workoutItem)) {
        return;
    }
    const choice = await choiceDialog("Який це тип тренування?", {
        title: "Тип тренування",
        closable: true,
        choices: Object.entries(workoutTypeLabels).map(([value, label]) => ({
            label,
            value,
            variant: workoutItem.workoutType === value ? "primary" : "secondary"
        }))
    });
    if (choice && choice !== workoutItem.workoutType) {
        await updateWorkoutMeta(workoutId, "workoutType", choice);
    }
}

// A note field that is empty renders as a single line instead of a textarea.
//
// An empty «Нотатки до вправи» box cost about a third of a phone screen per exercise,
// pushing the sets you are actually working with off the bottom. Most sets never get a
// note, so the box should only exist once you ask for it.
//
// `openNotes` survives re-renders (the whole page is rebuilt on every set tick), and a
// field that is opened but left empty folds itself away again on blur.
export function noteField(key, label, addLabel, value, attrs, readonly, extra = "") {
    const text = String(value || "");
    if (readonly && !text) {
        return "";
    }
    if (!text && !state.openNotes.has(key)) {
        return `<button class="note-add" type="button" data-action="open-note" data-note-key="${escapeHtml(key)}"><i data-lucide="plus"></i>${escapeHtml(addLabel)}</button>`;
    }
    return `<div class="field note-field" style="margin-top:14px;"><label>${escapeHtml(label)}</label>${extra}<textarea ${attrs} data-note-key="${escapeHtml(key)}" placeholder="${escapeHtml(addLabel)}" ${readonly ? "disabled" : ""}>${escapeHtml(text)}</textarea></div>`;
}

export function openNote(key) {
    if (!key) {
        return;
    }
    state.openNotes.add(key);
    setPendingNoteFocus(key);
    renderSection();
}

// Folding back on blur is what keeps the layout honest: open a note, think better of
// it, and the screen returns to what it was.
//
// Deferred, because blur fires BEFORE the click that caused it. Re-rendering
// immediately would tear down the button the user is in the middle of pressing and
// swallow the tap — so wait for that click to land, then re-check: still empty, still
// not focused, still there.
export function closeEmptyNote(key, value) {
    if (!key || String(value || "").trim()) {
        return;
    }
    setTimeout(() => {
        const live = document.querySelector(`textarea[data-note-key="${CSS.escape(key)}"]`);
        if (live && (live.value.trim() || document.activeElement === live)) {
            return;
        }
        if (!state.openNotes.delete(key)) {
            return;
        }
        renderSection();
    }, 180);
}

// As you scroll a workout, the sticky header stops being "Поточне тренування" and
// becomes the exercise it is currently covering — name in the title, its thumbnail
// where the avatar sits. Once that exercise scrolls past, the next one takes over, and
// back at the top the header returns to normal.
//
// Everything is read from the DOM and applied only on a real change: this runs on every
// scroll event, and rewriting the avatar's innerHTML each time would make it blink.
export function updateTopbarContext() {
    const topbar = document.querySelector(".topbar");
    if (!topbar) {
        return;
    }
    const eyebrow = element("sectionEyebrow");
    const title = element("sectionTitle");
    const avatar = element("openUserSwitcherButton");
    const line = topbar.getBoundingClientRect().bottom;

    // The exercise you are IN — the last one whose top has passed under the header —
    // rather than only one the header physically overlaps. Requiring an overlap made
    // the title flick back to the section name in every gap between two cards.
    // It clears only once that exercise has scrolled off the top entirely.
    let current = null;
    for (const card of document.querySelectorAll(".workout-exercise")) {
        const rect = card.getBoundingClientRect();
        if (rect.top <= line && rect.bottom > 0) {
            current = card;
        }
    }

    const key = current ? current.dataset.workoutExerciseId : "";
    if (topbar.dataset.ctxKey === key) {
        return;
    }
    topbar.dataset.ctxKey = key;

    if (!current) {
        topbar.classList.remove("is-context");
        eyebrow.textContent = topbarContextBase.eyebrow;
        title.textContent = topbarContextBase.title;
        renderCurrentUserButton(true);
        return;
    }

    topbar.classList.add("is-context");
    const name = current.querySelector(".we-head-text h3");
    const muscle = current.querySelector(".we-head-text .chip");
    eyebrow.textContent = muscle ? muscle.textContent.trim() : "Вправа";
    title.textContent = name ? name.textContent.trim() : "Вправа";

    const source = current.querySelector(".wd-thumb img");
    const shown = avatar.querySelector("img");
    if (source && shown && shown.src === source.src) {
        return;
    }
    avatar.innerHTML = source
        ? `<img src="${escapeHtml(source.getAttribute("src"))}" alt="" loading="eager" decoding="sync">`
        : `<i data-lucide="dumbbell"></i>`;
    delete avatar.dataset.avatarSig;
    if (!source) {
        iconsIn(avatar);
    }
}

export function topbarHeight() {
    const topbar = document.querySelector(".topbar");
    return topbar ? topbar.offsetHeight : 64;
}

export function updateTopbarOffset() {
    const topbar = document.querySelector(".topbar");
    if (topbar) {
        document.documentElement.style.setProperty("--topbar-h", `${topbar.offsetHeight}px`);
    }
    // The workout action bar is sticky too and parks directly under the topbar, so
    // anything else that sticks (the «Минулого разу» pill) has to start below it.
    // Measured, not hardcoded: on a narrow phone the bar wraps to two rows.
    const actionBar = document.querySelector(".workout-actionbar");
    document.documentElement.style.setProperty("--wab-h", actionBar ? `${actionBar.offsetHeight}px` : "0px");
    // Third and last sticky layer. Published so `scroll-margin-top` can keep a focused
    // field clear of ALL of them: the browser scrolls an input into view when the
    // keyboard opens and knows nothing about position:sticky, so without this the
    // field you are typing into ends up underneath the header.
    const strip = document.querySelector(".last-results");
    document.documentElement.style.setProperty("--lr-h", strip ? `${strip.offsetHeight}px` : "0px");
}

export function openQuickAction() {
    const limit = workoutLimitState(currentUser().id);
    const startCard = limit.allowed
        ? `<button class="quick-card" type="button" data-action="start-workout"><i data-lucide="play"></i><h3>Почати тренування</h3><p class="card-caption">Нова сесія — додавай вправи та підходи.</p></button>`
        : `<button class="quick-card quick-card-locked" type="button" data-action="navigate" data-section="${limit.tier === "free" ? "subscription" : "calendar"}"><i data-lucide="lock"></i><h3>Ліміт тренувань</h3><p class="card-caption">${escapeHtml(limit.message)}</p></button>`;
    openModal(`<div class="modal-header"><div><h2>Швидка дія</h2><p class="card-caption">Почати тренування або перейти в потрібний розділ.</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><div class="quick-grid">${startCard}<button class="quick-card" type="button" data-action="navigate" data-section="calendar"><i data-lucide="calendar-days"></i><h3>Календар</h3><p class="card-caption">Історія та керування тренуваннями.</p></button><button class="quick-card" type="button" data-action="navigate" data-section="rankings"><i data-lucide="trophy"></i><h3>Рейтинги</h3><p class="card-caption">Поточний силовий рівень.</p></button><button class="quick-card" type="button" data-action="navigate" data-section="exercises"><i data-lucide="list-filter"></i><h3>Каталог вправ</h3><p class="card-caption">Техніка, помилки і безпека.</p></button></div>`);
}

export function openDaySheet(date) {
    const meId = currentUser().id;
    // Own workouts first, then by status — so you spot yours instantly.
    const items = state.database.workouts.filter((item) => item.date === date).sort((left, right) => {
        const ownDiff = (left.userId === meId ? 0 : 1) - (right.userId === meId ? 0 : 1);
        return ownDiff !== 0 ? ownDiff : statusRank(left.status) - statusRank(right.status);
    });
    const isToday = date === dateInput(new Date());
    const rows = items.map((workoutItem) => {
        const owner = userById(workoutItem.userId);
        const own = workoutItem.userId === meId;
        const manage = canManage(workoutItem);
        return `<article class="day-row${own ? " own" : ""}"><div class="day-row-lead">${avatar(owner, "tiny")}</div><div class="day-row-main"><div class="tag-row"><span class="status-badge ${workoutStatusOf(workoutItem)}">${statusLabel(workoutStatusOf(workoutItem))}</span><span class="chip num-chip">#${workoutNumber(workoutItem)}</span><span class="chip">${workoutTypeLabel(workoutItem.workoutType)}</span>${own ? `<span class="chip mine-chip">Моє</span>` : ""}</div><strong>${escapeHtml(owner.displayName)}</strong><p class="card-caption">${number(workoutVolumeOf(workoutItem))} кг · ${workoutSetCount(workoutItem)} підходів${workoutCardioMinutes(workoutItem) ? ` · ${workoutCardioMinutes(workoutItem)} хв кардіо` : ""}</p></div><div class="day-row-actions"><button class="button button-secondary compact" type="button" data-action="open-workout" data-workout-id="${workoutItem.id}"><i data-lucide="list"></i>Деталі</button>${manage ? `<button class="icon-button" type="button" title="Видалити" data-action="delete-workout" data-workout-id="${workoutItem.id}"><i data-lucide="trash-2"></i></button>` : ""}</div></article>`;
    }).join("");
    openModal(`<div class="modal-header"><div><h2>${formatDate(date)}</h2><p class="card-caption">${items.length ? `Тренувань цього дня: ${items.length}` : "Цього дня тренувань немає"}</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><div class="day-list">${rows || emptyInline("Немає тренувань", isToday ? "Почни сьогоднішнє тренування." : "У цей день записів немає.")}</div><div class="day-sheet-action">${startWorkoutButton(date, { label: isToday ? "Почати тренування" : "Додати тренування", buttonClass: "button button-primary" })}</div>`);
}

export function openCardioModal(workoutId, cardioId = null) {
    const workoutItem = ownWorkout(workoutId);
    if (!workoutItem) {
        toast("Лише перегляд", "Кардіо можна додавати тільки у власні тренування.");
        return;
    }
    const session = cardioId ? (workoutItem.cardioSessions || []).find((item) => item.id === cardioId) : null;
    const types = [["treadmill", "Бігова доріжка"], ["bike", "Велотренажер"], ["running", "Біг"], ["walking", "Ходьба"], ["rower", "Гребний тренажер"], ["elliptical", "Еліпс"], ["other", "Інше"]];
    const type = session?.type || "treadmill";
    const intensity = session?.intensity || "medium";
    openModal(`<div class="modal-header"><div><h2>${session ? "Редагувати кардіо" : "Додати кардіо"}</h2><p class="card-caption">Вкажи тип і тривалість. Решта — за бажанням.</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><div class="field-grid"><div class="field"><label>Тип</label><gym-select id="cardioType">${types.map(([value, label]) => `<option value="${value}" ${type === value ? "selected" : ""}>${label}</option>`).join("")}</gym-select></div><div class="field"><label>Час, хв</label><input id="cardioDuration" type="number" min="1" step="1" value="${session ? session.durationMinutes : 20}"></div><div class="field"><label>Дистанція, км</label><input id="cardioDistance" type="number" min="0" step="0.1" value="${session?.distance || ""}" placeholder="Необов'язково"></div><div class="field"><label>Калорії</label><input id="cardioCalories" type="number" min="0" step="1" value="${session?.calories || ""}" placeholder="Необов'язково"></div><div class="field"><label>Середній пульс</label><input id="cardioHeartRate" type="number" min="0" step="1" value="${session?.averageHeartRate || ""}" placeholder="уд/хв"></div><div class="field"><label>Інтенсивність</label><gym-select id="cardioIntensity">${[["low", "низька"], ["medium", "середня"], ["high", "висока"]].map(([value, label]) => `<option value="${value}" ${intensity === value ? "selected" : ""}>${label}</option>`).join("")}</gym-select></div></div><div class="field" style="margin-top:14px;"><label>Нотатки</label><textarea id="cardioNotes" placeholder="Нахил, темп, відчуття">${escapeHtml(session?.notes || "")}</textarea></div><div class="form-actions" style="justify-content:flex-end;margin-top:16px;"><button class="button button-secondary" type="button" data-action="close-overlay">Скасувати</button><button class="button button-primary" type="button" data-action="save-cardio" data-workout-id="${workoutId}" ${session ? `data-cardio-id="${session.id}"` : ""}><i data-lucide="check"></i>Зберегти</button></div>`);
}
