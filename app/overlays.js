// Overlays: content / element, modals, sheets, dialogs, drawer, scroll lock, busy overlay, sync indicator, errors, toasts.
import { escapeHtml } from "../lib/format.js";
import { APP_VERSION } from "../lib/changelog.js";
import { storage } from "./data.js";
import { renderAuthGate } from "./shell.js";
import { state } from "./state.js";
import { iconsIn } from "./util.js";
import { releaseWatch, watchState } from "./watch.js";

export function content(html) {
    element("pageContent").innerHTML = html;
}

export function element(id) {
    return document.getElementById(id);
}

let overlayCloseTimer = null;

let sheetCloseTimer = null;

let confirmCloseTimer = null;

// Dismiss hooks for a stacked sheet that somebody is AWAITING a decision from.
// Three separate code paths close the sheet without knowing a promise is pending:
// the global #modalBackdrop2 click (bindEvents), closeOverlay(), and the
// data-action="close-sheet" button. A dialog whose caller is held in a loading state
// (saveCustomExercise sits inside runAction's button loader) would hang forever if
// any of them ran. Registering here means closeSheet is the single choke point that
// releases them, whoever called it.
export const sheetDismissHooks = new Set();

// Reveal an overlay layer (backdrop + modal/drawer) with a fade/scale-in.
function revealOverlay(layer) {
    const backdrop = element("modalBackdrop");
    backdrop.classList.remove("hidden");
    layer.classList.remove("hidden");
    if (layer.classList.contains("visible")) {
        backdrop.classList.add("visible"); // already shown (content swap) — no re-animate
        return;
    }
    // Force a sync reflow so the enter-from state (opacity 0 / scaled) is committed,
    // THEN flip to .visible and the transition plays. (More reliable than rAF, which
    // can be throttled when the tab isn't actively compositing → modal stuck hidden.)
    void layer.offsetWidth;
    backdrop.classList.add("visible");
    layer.classList.add("visible");
}

export function openModal(html, opts = {}) {
    clearTimeout(overlayCloseTimer);
    const drawer = element("drawerLayer");
    drawer.classList.add("hidden");
    drawer.classList.remove("visible");
    drawer.innerHTML = "";
    const modal = element("modalLayer");
    modal.innerHTML = html;
    modal.classList.toggle("modal-fullscreen", !!opts.fullscreen);
    // A modal whose body is a FILTERED LIST keeps a fixed height. Without this the box
    // is as tall as its results, so typing in the search resized it on every keystroke
    // — and because it is vertically centred, it jumped up and down under the cursor
    // while you were still typing into it.
    modal.classList.toggle("modal-list", !!opts.list);
    // A short menu or a single question slides up from the bottom edge on a phone,
    // where the thumb already is, instead of appearing in the middle of the screen.
    modal.classList.toggle("modal-sheet", !!opts.sheet);
    iconsIn(modal);
    lockBackgroundScroll();
    revealOverlay(modal);
}

// Second-level sheet stacked ABOVE the modal (e.g. the muscle-group picker).
// Animates like the modal; does NOT touch the scroll-lock (parent modal holds it).
export function openSheet(html, opts = {}) {
    clearTimeout(sheetCloseTimer);
    const backdrop = element("modalBackdrop2");
    const layer = element("modalLayer2");
    layer.innerHTML = html;
    layer.classList.toggle("modal-fullscreen", !!opts.fullscreen);
    iconsIn(layer);
    backdrop.classList.remove("hidden");
    layer.classList.remove("hidden");
    if (!layer.classList.contains("visible")) {
        void layer.offsetWidth;
    }
    backdrop.classList.add("visible");
    layer.classList.add("visible");
}

export function closeSheet() {
    const backdrop = element("modalBackdrop2");
    const layer = element("modalLayer2");
    if (backdrop.classList.contains("hidden")) {
        return;
    }
    // Release anyone awaiting a decision BEFORE the sheet animates out. Each hook is
    // removed before it runs, so the finish() it calls (which calls closeSheet again)
    // cannot re-enter this loop.
    if (sheetDismissHooks.size) {
        Array.from(sheetDismissHooks).forEach((hook) => {
            sheetDismissHooks.delete(hook);
            hook();
        });
    }
    backdrop.classList.remove("visible");
    layer.classList.remove("visible");
    clearTimeout(sheetCloseTimer);
    sheetCloseTimer = setTimeout(() => {
        backdrop.classList.add("hidden");
        layer.classList.add("hidden");
        layer.innerHTML = "";
        layer.classList.remove("modal-fullscreen");
    }, 240);
}

/**
 * The confirm level — a third overlay that always draws above the other two.
 *
 * A question can be asked from the page, from a modal, or from a sheet (the superset
 * menu is one). Picking between the modal and sheet layers meant a confirm raised
 * FROM a sheet landed on the lower layer and was hidden behind it, so the dialog was
 * invisible and its action looked broken. Confirmations never stack on each other, so
 * one dedicated top level removes the choice entirely.
 */
export function openConfirmOverlay(html) {
    clearTimeout(confirmCloseTimer);
    const backdrop = element("modalBackdrop3");
    const layer = element("modalLayer3");
    layer.innerHTML = html;
    iconsIn(layer);
    backdrop.classList.remove("hidden");
    layer.classList.remove("hidden");
    if (!layer.classList.contains("visible")) {
        void layer.offsetWidth; // commit the enter-from state so the transition plays
    }
    backdrop.classList.add("visible");
    layer.classList.add("visible");
}

export function closeConfirmOverlay() {
    const backdrop = element("modalBackdrop3");
    const layer = element("modalLayer3");
    if (backdrop.classList.contains("hidden")) {
        return;
    }
    backdrop.classList.remove("visible");
    layer.classList.remove("visible");
    clearTimeout(confirmCloseTimer);
    confirmCloseTimer = setTimeout(() => {
        backdrop.classList.add("hidden");
        layer.classList.add("hidden");
        layer.innerHTML = "";
    }, 240);
}

/** True when neither lower overlay is open, so the confirm owns the scroll lock. */
/**
 * How to dismiss the confirmation currently on screen, or null when there is none.
 *
 * A dialog that cannot be closed with Escape is a keyboard trap, and the three
 * dialogs each bound only their own buttons. Kept as one reference rather than three
 * listeners so the key handler can dismiss the TOPMOST thing and stop — otherwise
 * Escape closed the sheet underneath and left the confirm floating over nothing.
 */
let activeConfirmDismiss = null;

/** Answers the open confirmation as "dismissed", if there is one. True when it did. */
export function dismissActiveConfirm() {
    if (!activeConfirmDismiss) {
        return false;
    }
    const dismiss = activeConfirmDismiss;
    activeConfirmDismiss = null;
    dismiss();
    return true;
}

function confirmIsStandalone() {
    return element("modalBackdrop").classList.contains("hidden")
        && element("modalBackdrop2").classList.contains("hidden");
}

// Reliable in-app confirmation (native confirm() is unreliable/blocked on mobile).
export function confirmDialog(message, options = {}) {
    const { title = "Підтвердження", confirmLabel = "Підтвердити", cancelLabel = "Скасувати", danger = true, detail = "", note = "" } = options;
    return new Promise((resolve) => {
        // Two optional extras, each its own element rather than line breaks smuggled
        // through an escaped string: `detail` is what exactly is being acted on, and
        // `note` is the reassuring half — "you can take this back" — kept apart from
        // the question so it cannot be misread as part of the warning.
        const html = `<div class="confirm-dialog"><div class="modal-header"><div><h2>${escapeHtml(title)}</h2></div></div><p class="confirm-message">${escapeHtml(message)}</p>${detail ? `<p class="confirm-detail">${escapeHtml(detail)}</p>` : ""}${note ? `<p class="confirm-note"><i data-lucide="undo-2"></i>${escapeHtml(note)}</p>` : ""}<div class="form-actions" style="justify-content:flex-end;margin-top:18px;"><button class="button button-secondary" type="button" id="confirmCancelBtn">${escapeHtml(cancelLabel)}</button><button class="button ${danger ? "button-danger" : "button-primary"}" type="button" id="confirmOkBtn">${escapeHtml(confirmLabel)}</button></div></div>`;
        // Always on the confirm level, so the question is visible whether it came
        // from the page, a modal, or a sheet — and cancelling never disturbs what is
        // underneath it.
        const standalone = confirmIsStandalone();
        const backdrop = element("modalBackdrop3");
        if (standalone) {
            lockBackgroundScroll();
        }
        openConfirmOverlay(html);
        let settled = false;
        const finish = (result) => {
            if (settled) {
                return;
            }
            settled = true;
            activeConfirmDismiss = null;
            backdrop.removeEventListener("click", onBackdrop);
            closeConfirmOverlay();
            if (standalone) {
                unlockBackgroundScroll();
            }
            resolve(result);
        };
        const onBackdrop = () => finish(false);
        activeConfirmDismiss = () => finish(false);
        backdrop.addEventListener("click", onBackdrop);
        element("confirmOkBtn").addEventListener("click", () => finish(true));
        element("confirmCancelBtn").addEventListener("click", () => finish(false));
    });
}

// Like confirmDialog, but with N labelled choices. Resolves the chosen value,
// or null if dismissed via the backdrop. Reuses the same stack-aware overlay
// plumbing so it can appear on its own or on top of an already-open modal.
export function choiceDialog(message, options = {}) {
    const { title = "Підтвердження", choices = [], closable = false } = options;
    return new Promise((resolve) => {
        const variantClass = (variant) => variant === "primary" ? "button-primary" : variant === "danger" ? "button-danger" : "button-secondary";
        const buttons = choices.map((choice, index) => `<button class="button ${variantClass(choice.variant)}" type="button" data-choice="${index}">${escapeHtml(choice.label)}</button>`).join("");
        const closeBtn = closable ? `<button class="icon-button" type="button" data-choice-close="1" aria-label="Закрити"><i data-lucide="x"></i></button>` : "";
        const html = `<div class="confirm-dialog"><div class="modal-header"><div><h2>${escapeHtml(title)}</h2></div>${closeBtn}</div><p class="confirm-message">${escapeHtml(message)}</p><div class="form-actions confirm-choices">${buttons}</div></div>`;
        const standalone = confirmIsStandalone();
        const backdrop = element("modalBackdrop3");
        if (standalone) {
            lockBackgroundScroll();
        }
        openConfirmOverlay(html);
        const layer = element("modalLayer3");
        let settled = false;
        const finish = (result) => {
            if (settled) {
                return;
            }
            settled = true;
            activeConfirmDismiss = null;
            backdrop.removeEventListener("click", onBackdrop);
            closeConfirmOverlay();
            if (standalone) {
                unlockBackgroundScroll();
            }
            resolve(result);
        };
        const onBackdrop = () => finish(null);
        activeConfirmDismiss = () => finish(null);
        backdrop.addEventListener("click", onBackdrop);
        layer.querySelectorAll("[data-choice]").forEach((button) => {
            button.addEventListener("click", () => finish(choices[Number(button.dataset.choice)].value));
        });
        const closeButton = layer.querySelector("[data-choice-close]");
        if (closeButton) {
            closeButton.addEventListener("click", () => finish(null));
        }
    });
}

// Small text prompt built on the same overlay plumbing as confirmDialog.
// Resolves the edited text, or null when dismissed.
export function promptDialog(title, initialValue = "") {
    return new Promise((resolve) => {
        const html = `<div class="confirm-dialog"><div class="modal-header"><div><h2>${escapeHtml(title)}</h2></div></div><div class="field" style="margin-top:8px;"><textarea id="promptDialogInput" rows="3">${escapeHtml(initialValue)}</textarea></div><div class="form-actions" style="justify-content:flex-end;margin-top:16px;"><button class="button button-secondary" type="button" id="promptCancelBtn">Скасувати</button><button class="button button-primary" type="button" id="promptOkBtn">Зберегти</button></div></div>`;
        const standalone = confirmIsStandalone();
        const backdrop = element("modalBackdrop3");
        if (standalone) {
            lockBackgroundScroll();
        }
        openConfirmOverlay(html);
        const layer = element("modalLayer3");
        let settled = false;
        const finish = (result) => {
            if (settled) {
                return;
            }
            settled = true;
            activeConfirmDismiss = null;
            backdrop.removeEventListener("click", onBackdrop);
            closeConfirmOverlay();
            if (standalone) {
                unlockBackgroundScroll();
            }
            resolve(result);
        };
        const onBackdrop = () => finish(null);
        backdrop.addEventListener("click", onBackdrop);
        layer.querySelector("#promptOkBtn").addEventListener("click", () => finish(layer.querySelector("#promptDialogInput").value));
        layer.querySelector("#promptCancelBtn").addEventListener("click", () => finish(null));
        const input = layer.querySelector("#promptDialogInput");
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    });
}

export function openDrawer(html, opts = {}) {
    clearTimeout(overlayCloseTimer);
    const modal = element("modalLayer");
    modal.classList.add("hidden");
    modal.classList.remove("visible");
    modal.innerHTML = "";
    const drawer = element("drawerLayer");
    drawer.innerHTML = html;
    drawer.classList.toggle("modal-fullscreen", !!opts.fullscreen);
    iconsIn(drawer);
    lockBackgroundScroll();
    revealOverlay(drawer);
}

// --- Background scroll-lock for overlays (modal/drawer) ---
// iOS would otherwise route a touch-scroll to the page *behind* an overlay
// (rubber-banding — "задник сердиться"). The previous fix pinned <body>
// position:fixed, but in an INSTALLED PWA (standalone) iOS recomputes the layout
// viewport when body goes fixed and visibly *jumps* the content + bottom-nav as a
// modal opens (works fine in a normal browser, so it slipped through). So we no
// longer mutate layout at all: a non-passive touchmove guard blocks any scroll
// that isn't inside the overlay's own scroll surface (.modal-layer / .drawer-layer
// are overflow:auto + overscroll-behavior:contain, so they scroll themselves and
// don't chain to the page). No layout change => no jump. Touch-only; the desktop
// mouse-wheel path is never touched.
export let scrollLocked = false;

let lockTouchMove = null;

export function lockBackgroundScroll() {
    const touchPrimary = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    if (!touchPrimary || scrollLocked) {
        return;
    }
    scrollLocked = true;
    lockTouchMove = (event) => {
        if (event.touches && event.touches.length > 1) {
            return; // allow pinch-zoom
        }
        // Include the portaled dropdown panels (.gselect-panel / .gdate-panel are
        // appended to <body>, OUTSIDE .modal-layer) so their own list can scroll on
        // touch while a modal is open — otherwise the guard would block them.
        // EVERY overlay that holds the lock has to be listed here, or its own content
        // cannot be scrolled on a touch screen — the guard blocks the gesture as if it
        // were the page behind. .ob-layer was missing, which froze the onboarding
        // muscle grid on any phone short enough to need scrolling.
        const overlay = event.target && event.target.closest ? event.target.closest(".modal-layer, .drawer-layer, .gselect-panel, .gdate-panel, .focus-layer, .ob-layer") : null;
        if (!overlay) {
            event.preventDefault(); // outside any overlay → never let the page behind scroll
            return;
        }
        // Walk from the touch target up to (and including) the overlay. If ANY node
        // along the way can actually scroll, let it — the real scroller may be an
        // INNER element (e.g. the picker's .exercise-picker-grid, since that modal is
        // overflow:hidden), not the .modal-layer itself. overscroll-behavior:contain on
        // the scrollers stops chaining at their edges. Only when nothing in the chain
        // can scroll do we block (so a non-scrollable overlay can't chain to the page).
        let node = event.target;
        while (node) {
            if (node.scrollHeight > node.clientHeight) {
                return;
            }
            if (node === overlay) {
                break;
            }
            node = node.parentElement;
        }
        event.preventDefault();
    };
    document.addEventListener("touchmove", lockTouchMove, { passive: false });
    document.documentElement.classList.add("overlay-open");
}

export function unlockBackgroundScroll() {
    // Focus mode holds the lock for its whole session: an overlay stacked above
    // it (confirm / paywall) must not release it on close. Focus releases it
    // itself by clearing state.focus before calling this.
    if (state.focus) {
        return;
    }
    // Idempotent — even if the flag ever desyncs, the listener must never survive
    // and keep swallowing touch-scroll.
    scrollLocked = false;
    if (lockTouchMove) {
        document.removeEventListener("touchmove", lockTouchMove, { passive: false });
        lockTouchMove = null;
    }
    document.documentElement.classList.remove("overlay-open");
}

export function closeOverlay() {
    // The watch sheet lives in this same drawer, so every way of dismissing it — the
    // backdrop, Escape, the X, or another overlay replacing it — must release the
    // registration too, or the server keeps sending hints to a closed screen.
    if (watchState.workoutId) {
        releaseWatch();
    }
    // Unlock FIRST so a later DOM error can't skip it and leave scroll frozen.
    unlockBackgroundScroll();
    closeSheet(); // a nested sheet (muscle picker) closes with its parent
    const backdrop = element("modalBackdrop");
    const modal = element("modalLayer");
    const drawer = element("drawerLayer");
    if (backdrop.classList.contains("hidden")) {
        return; // nothing open
    }
    // Animate out (drop .visible), then hide + clear after the exit transition.
    backdrop.classList.remove("visible");
    modal.classList.remove("visible");
    drawer.classList.remove("visible");
    clearTimeout(overlayCloseTimer);
    overlayCloseTimer = setTimeout(() => {
        backdrop.classList.add("hidden");
        modal.classList.add("hidden");
        drawer.classList.add("hidden");
        modal.innerHTML = "";
        drawer.innerHTML = "";
    }, 240);
}

// Self-heal: if no overlay is actually open but the body is still locked
// (e.g. an interrupted close), force scrolling back on. Runs on tab focus /
// bfcache restore and navigation so a stuck lock can never persist.
export function ensureScrollUnlockedIfNoOverlay() {
    const modalHidden = element("modalLayer").classList.contains("hidden");
    const drawerHidden = element("drawerLayer").classList.contains("hidden");
    if (modalHidden && drawerHidden && !state.focus && (scrollLocked || lockTouchMove)) {
        unlockBackgroundScroll();
    }
}

export function showBusyOverlay(options = {}) {
    let overlay = document.getElementById("busyOverlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "busyOverlay";
        overlay.className = "busy-overlay hidden";
        overlay.innerHTML = `<section class="busy-panel" role="status" aria-live="polite" aria-busy="true">
                <div class="pixel-loader" aria-hidden="true">${Array.from({ length: 25 }, (_, index) => `<span style="--cell:${index};"></span>`).join("")}</div>
                <div>
                    <p class="busy-kicker">GymOS · v${APP_VERSION}</p>
                    <h2 id="busyTitle">Синхронізація</h2>
                    <p class="busy-message" id="busyMessage">Готуємо дані.</p>
                    <p class="busy-detail" id="busyDetail">Це займе кілька секунд.</p>
                    <div class="busy-progress" aria-hidden="true"><span id="busyProgress"></span></div>
                </div>
            </section>`;
        document.body.appendChild(overlay);
    }

    updateBusyOverlay(overlay, options);
    overlay.classList.remove("hidden");

    // A slow boot should say so rather than look identical to a hung one. The
    // request itself is bounded by ApiClient's AbortController, so this only
    // changes the copy while the user waits — it never becomes the failure path.
    clearTimeout(overlay.slowTimer);
    if (options.escalate !== false) {
        overlay.slowTimer = setTimeout(() => {
            if (!overlay.classList.contains("hidden")) {
                updateBusyOverlay(overlay, {
                    message: "Backend відповідає повільно.",
                    detail: "Ще чекаємо — з'єднання повільне або сервер прокидається."
                });
            }
        }, 6000);
    }

    return overlay;
}

export function updateBusyOverlay(overlay, options = {}) {
    if (!overlay) {
        return;
    }

    const progress = Math.max(0, Math.min(100, Number(options.progress || 0)));
    overlay.querySelector("#busyTitle").textContent = options.title || overlay.querySelector("#busyTitle").textContent;
    overlay.querySelector("#busyMessage").textContent = options.message || overlay.querySelector("#busyMessage").textContent;
    overlay.querySelector("#busyDetail").textContent = options.detail || overlay.querySelector("#busyDetail").textContent;
    overlay.querySelector("#busyProgress").style.width = `${progress}%`;
}

export function hideBusyOverlay(overlay) {
    if (!overlay) {
        return;
    }

    // Cancel the pending "responding slowly" escalation, or a fast boot that
    // finishes at 5.9s still rewrites the panel copy after it is gone.
    clearTimeout(overlay.slowTimer);
    window.setTimeout(() => {
        overlay.classList.add("hidden");
    }, 180);
}

export function resourceLabel(resource) {
    const labels = {
        customExercises: "власні вправи",
        bodyweightEntries: "замір ваги",
        workouts: "тренування"
    };
    return labels[resource] || "дані";
}

export let syncIndicatorTimeoutId = null;

// Save status lives inline in the topbar as a subtle chip (loading/success);
// errors escalate to a readable, dismissible toast instead of lingering there.
export function showSyncIndicator(status, message) {
    if (status === "error") {
        toast(message || "Щось пішло не так", "", "error");
        return;
    }
    const chip = document.getElementById("syncChip");
    if (!chip) {
        return;
    }
    const icon = status === "loading"
        ? `<span class="square-loader small" aria-hidden="true"></span>`
        : `<span class="sync-chip-ico" aria-hidden="true"><i data-lucide="check"></i></span>`;
    chip.className = `sync-chip visible ${status}`;
    chip.innerHTML = `${icon}<span class="sync-chip-text">${escapeHtml(message)}</span>`;
    if (status === "success") {
        iconsIn(chip);
    }
    clearTimeout(syncIndicatorTimeoutId);
    if (status !== "loading") {
        syncIndicatorTimeoutId = setTimeout(() => {
            chip.classList.remove("visible");
        }, 1900);
    }
}

export function handleUserFacingError(error, action = "") {
    console.error(error);
    const message = friendlyError(error);
    showSyncIndicator("error", message); // routes to an error toast

    if (Number(error?.status) === 401 && storage.config.requireAuth) {
        renderAuthGate(message);
    }
}

export function friendlyError(error) {
    const status = Number(error?.status || 0);
    const rawMessage = String(error?.message || "").trim();

    if (status === 401) {
        return "Сесія неактивна. Увійди через Google ще раз.";
    }
    if (status === 429) {
        return rawMessage || "Забагато запитів за коротку мить. Зачекай кілька секунд.";
    }
    if (status === 403) {
        // Quota/limit hits carry a specific, friendly message from the backend
        // (e.g. PRO daily caps) — surface it instead of the generic permission line.
        const code = error?.payload?.code;
        if (code === "WORKOUT_LIMIT" || code === "EXERCISE_LIMIT" || code === "FEEDBACK_LIMIT") {
            return rawMessage || "Ліміт тарифу досягнуто.";
        }
        return "Немає прав для цієї дії.";
    }
    if (error?.payload?.code === "WOULD_ERASE_EXERCISES") {
        return "Не вдалося зберегти порожнє тренування. Спробуй ще раз або онови сторінку.";
    }
    if (status === 413) {
        return "Дані завеликі для одного запиту. Спробуй імпорт маленькими пачками.";
    }
    if (status >= 500) {
        return "Backend тимчасово недоступний. Спробуй ще раз за кілька секунд.";
    }
    if (/failed to fetch|networkerror|load failed/i.test(rawMessage)) {
        return "Не вдалося підключитися до backend. Перевір інтернет або deployment.";
    }
    if (/api base url is not configured/i.test(rawMessage)) {
        return "API URL не налаштовано.";
    }

    return rawMessage || "Запит не виконано. Спробуй ще раз.";
}

/**
 * `options` turns a notice into something you can act on:
 *   duration — how long it stays up (default 4.2 s)
 *   action   — {label, icon, onClick}; adds a button and a visible countdown
 *   onExpire — the timer ran out, or the toast was flicked away un-acted-on
 *
 * A toast carrying an action does NOT dismiss on a body tap and does NOT pause on
 * hover. Both would be lies: the number on it is a promise about when something
 * irreversible happens, and a countdown that quietly stops while the pointer rests
 * on it — or a stray tap that throws the window away — makes that promise false.
 */
export function toast(title, message = "", type = "default", options = {}) {
    const duration = Number(options.duration) > 0 ? Number(options.duration) : 4200;
    const action = options.action || null;
    const toastElement = document.createElement("div");
    toastElement.className = `toast toast-${type}${action ? " has-action" : ""}`;
    toastElement.setAttribute("role", type === "error" ? "alert" : "status");
    const icon = type === "error" ? "alert-triangle" : type === "achievement" ? "trophy" : type === "undo" ? "trash-2" : "sparkles";
    const actionMarkup = action
        ? `<button class="toast-action" type="button"><i data-lucide="${action.icon || "undo-2"}"></i><span>${escapeHtml(action.label)}</span><span class="toast-count">${Math.ceil(duration / 1000)}</span></button>`
        : "";
    toastElement.innerHTML = `<span class="toast-icon"><i data-lucide="${icon}"></i></span><div class="toast-body"><strong>${escapeHtml(title)}</strong>${message ? `<p class="toast-message">${escapeHtml(message)}</p>` : ""}</div>${actionMarkup}<span class="toast-progress" aria-hidden="true" style="animation-duration:${duration}ms"></span>`;
    element("toastStack").appendChild(toastElement);
    iconsIn(toastElement);

    let timer = null;
    let ticker = null;
    let leaving = false;
    let expired = false;
    const remove = () => {
        clearInterval(ticker);
        toastElement.remove();
    };

    // Fires exactly once, whichever way the window closes: the countdown ending, a
    // swipe, or the page going away with the toast still up.
    const expire = () => {
        if (expired) {
            return;
        }
        expired = true;
        clearInterval(ticker);
        if (options.onExpire) {
            options.onExpire();
        }
    };

    if (action) {
        const counter = toastElement.querySelector(".toast-count");
        const endsAt = performance.now() + duration;
        ticker = setInterval(() => {
            const left = Math.max(0, Math.ceil((endsAt - performance.now()) / 1000));
            counter.textContent = String(left);
            if (!left) {
                clearInterval(ticker);
            }
        }, 250);
        const actionButton = toastElement.querySelector(".toast-action");
        // A press that starts on the button belongs to the button. Without this the
        // toast's own pointerdown runs first, calls setPointerCapture on the TOAST,
        // and the browser then dispatches the resulting click to the capturing
        // element instead of the button — so «Повернути» looked pressable and did
        // nothing at all. (A synthetic .click() in a test skips the pointer sequence
        // entirely, which is why this passed everywhere except under a real finger.)
        actionButton.addEventListener("pointerdown", (event) => event.stopPropagation());
        actionButton.addEventListener("click", (event) => {
            event.stopPropagation();
            // Acted on: the thing the countdown was waiting for must never happen.
            expired = true;
            clearInterval(ticker);
            clearTimeout(timer);
            action.onClick();
            dismiss();
        });
    }

    // Standard exit (tap / auto-dismiss): slide-up + fade via CSS animation.
    const dismiss = () => {
        if (leaving) {
            return;
        }
        leaving = true;
        clearTimeout(timer);
        toastElement.style.animation = ""; // let the .is-leaving animation own it
        toastElement.classList.add("is-leaving");
        toastElement.addEventListener("animationend", (event) => {
            if (event.target === toastElement && event.animationName === "toastOut") {
                remove();
            }
        });
        setTimeout(remove, 450); // fallback if animationend doesn't fire
    };

    // Swipe exit: fly off in the gesture direction, then remove.
    const flyOut = (direction) => {
        if (leaving) {
            return;
        }
        leaving = true;
        expire();
        clearTimeout(timer);
        const offX = direction === "left" ? -window.innerWidth : direction === "right" ? window.innerWidth : 0;
        const offY = direction === "up" ? -180 : 0;
        toastElement.style.transition = "transform 0.3s cubic-bezier(0.4, 0, 1, 1), opacity 0.3s ease";
        toastElement.style.transform = `translate(${offX}px, ${offY}px)`;
        toastElement.style.opacity = "0";
        toastElement.addEventListener("transitionend", remove, { once: true });
        setTimeout(remove, 400);
    };

    const startTimer = () => {
        if (action) {
            // Scheduled once, below. Restarting it here — which every drag and every
            // mouseleave would do — hands back time the visible counter has already
            // spent, and the two stop agreeing.
            return;
        }
        timer = setTimeout(dismiss, duration);
    };
    if (action) {
        timer = setTimeout(() => {
            expire();
            dismiss();
        }, duration);
    } else {
        startTimer();
    }

    // Hover pauses the auto-dismiss (desktop) — but never a countdown.
    toastElement.addEventListener("mouseenter", () => {
        if (!leaving && !action) {
            clearTimeout(timer);
            toastElement.classList.add("is-paused");
        }
    });
    toastElement.addEventListener("mouseleave", () => {
        if (!leaving && !action) {
            toastElement.classList.remove("is-paused");
            startTimer();
        }
    });

    // Tap to dismiss + swipe up / left / right to flick away.
    const THRESHOLD = 64;
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let dy = 0;
    let dragging = false;
    let moved = false;
    let activePointer = null;

    toastElement.addEventListener("pointerdown", (event) => {
        if (leaving || activePointer !== null) {
            return;
        }
        // Belt and braces for the same thing: never start a drag from the action.
        if (action && event.target?.closest?.(".toast-action")) {
            return;
        }
        activePointer = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        dx = 0;
        dy = 0;
        dragging = true;
        moved = false;
        if (!action) {
            clearTimeout(timer);
        }
        toastElement.style.animation = "none"; // free the transform for dragging
        toastElement.classList.add("is-paused", "is-dragging");
        try {
            toastElement.setPointerCapture(event.pointerId);
        } catch (_) {}
    });

    toastElement.addEventListener("pointermove", (event) => {
        if (!dragging || event.pointerId !== activePointer) {
            return;
        }
        dx = event.clientX - startX;
        dy = event.clientY - startY;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            moved = true;
        }
        const horizontal = Math.abs(dx) >= Math.abs(dy);
        let tx = 0;
        let ty = 0;
        if (horizontal) {
            tx = dx;
        } else {
            ty = dy < 0 ? dy : dy * 0.25; // up moves freely, down resists
        }
        const distance = horizontal ? Math.abs(dx) : Math.abs(ty);
        const opacity = Math.max(0.35, 1 - distance / (THRESHOLD * 3));
        toastElement.style.transform = `translate(${tx}px, ${ty}px)`;
        toastElement.style.opacity = String(opacity);
    });

    const endDrag = (event) => {
        if (!dragging || (event && event.pointerId !== activePointer)) {
            return;
        }
        dragging = false;
        activePointer = null;
        toastElement.classList.remove("is-dragging");
        const horizontal = Math.abs(dx) >= Math.abs(dy);
        const flick = horizontal
            ? (Math.abs(dx) >= THRESHOLD ? (dx < 0 ? "left" : "right") : null)
            : (dy < 0 && Math.abs(dy) >= THRESHOLD ? "up" : null);
        if (flick) {
            flyOut(flick);
            return;
        }
        // snap back into place
        toastElement.style.transition = "transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.28s ease";
        toastElement.style.transform = "translate(0, 0)";
        toastElement.style.opacity = "1";
        toastElement.addEventListener("transitionend", function clear() {
            toastElement.style.transition = "";
            toastElement.style.transform = "";
            toastElement.style.opacity = "";
            toastElement.removeEventListener("transitionend", clear);
        }, { once: true });
        if (!leaving && !action) {
            toastElement.classList.remove("is-paused");
            startTimer();
        }
    };

    toastElement.addEventListener("pointerup", endDrag);
    toastElement.addEventListener("pointercancel", endDrag);

    toastElement.addEventListener("click", () => {
        if (moved) {
            moved = false;
            return; // a swipe/drag, not a tap
        }
        if (action) {
            return; // a stray tap must not throw away the undo window
        }
        dismiss();
    });

    return { expireNow: () => { expire(); dismiss(); } };
}
