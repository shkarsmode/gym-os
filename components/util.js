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

export function registerOpenPanel(instance, panel, closeFn) {
    if (openPanel && openPanel.instance !== instance) {
        openPanel.closeFn();
    }
    openPanel = { instance, panel, closeFn };
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

document.addEventListener("scroll", (event) => {
    if (openPanel && openPanel.panel && openPanel.panel.contains(event.target)) {
        return;
    }
    closeOpenPanel();
}, true);
window.addEventListener("resize", closeOpenPanel);
window.addEventListener("hashchange", closeOpenPanel);
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeOpenPanel();
    }
});
