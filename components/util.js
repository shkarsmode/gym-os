// Shared helpers for the custom form components (mirrors app.js escapeHtml).
export function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

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
