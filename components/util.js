// Shared helpers for the custom form components.
// escapeHtml lives in the shared format module; re-export so component imports
// (from "./util.js") stay unchanged.
export { escapeHtml } from "../lib/format.js";

// Re-run Lucide so freshly-inserted <i data-lucide> become SVGs.
export function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
        window.lucide.createIcons();
    }
}

export function isCoarsePointer() {
    return !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
}

// Add a class on the next frame to trigger an enter transition. rAF is throttled
// in background tabs, so a setTimeout fallback guarantees the element still reveals.
export function revealOnNextFrame(element, className = "visible") {
    const add = () => element.classList.add(className);
    requestAnimationFrame(add);
    setTimeout(add, 60);
}

// ---- Single open panel across ALL custom controls -------------------------
// Both <gym-select> and <gym-date> register here so only one dropdown/calendar
// is ever open, and a single set of global listeners closes it on scroll /
// resize / route change / Escape. (Scrolling inside the open panel itself —
// e.g. a long option list — must not close it.)
let openPanel = null;

export function registerOpenPanel(instance, panel, closeFn, repositionFn) {
    if (openPanel && openPanel.instance !== instance) {
        openPanel.closeFn();
    }
    openPanel = { instance, panel, closeFn, repositionFn };
}

export function unregisterOpenPanel(instance) {
    if (openPanel && openPanel.instance === instance) {
        openPanel = null;
    }
}

function closeOpenPanel() {
    if (openPanel) {
        openPanel.closeFn();
    }
}

/**
 * Keep an open panel glued to its field instead of throwing it away.
 *
 * This used to close on ANY scroll or resize, and that is what people reported as the
 * date picker "shutting by itself". The scroll listener is in the CAPTURE phase, so it
 * counts a scroll anywhere in the document — including the dialog body sitting under the
 * panel, and including the one-pixel scroll a tap can produce. On a phone it is worse
 * still: `resize` fires every time the address bar slides away, so simply opening the
 * calendar and reaching for a date could dismiss it.
 *
 * Closing is now reserved for the one case where following is meaningless — the field
 * itself has scrolled out of view.
 */
let followFrame = 0;
function followOpenPanel() {
    if (!openPanel) {
        return;
    }
    if (followFrame) {
        return;
    }
    followFrame = requestAnimationFrame(() => {
        followFrame = 0;
        if (!openPanel) {
            return;
        }
        const rect = openPanel.instance.getBoundingClientRect();
        const anchorVisible = rect.bottom > 0 && rect.top < window.innerHeight;
        if (!anchorVisible || !openPanel.repositionFn) {
            closeOpenPanel();
            return;
        }
        openPanel.repositionFn();
    });
}

document.addEventListener("scroll", (event) => {
    // Scrolling INSIDE the panel moves nothing it is anchored to.
    if (openPanel && openPanel.panel && openPanel.panel.contains(event.target)) {
        return;
    }
    followOpenPanel();
}, true);
window.addEventListener("resize", followOpenPanel);
window.addEventListener("hashchange", closeOpenPanel);
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeOpenPanel();
    }
});
