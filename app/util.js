// Small utilities: icons, dates, inputs, rounding, ids.
import { element } from "./overlays.js";

export function icons() {
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

// Scoped icon conversion: only scans `root` instead of the whole document.
// Use for frequent, self-contained updates (toasts, chip) to avoid a
// full-document [data-lucide] scan on every small UI change.
export function iconsIn(root) {
    if (window.lucide && root) {
        window.lucide.createIcons({ root });
    }
}

export function startWeek(date) {
    const result = new Date(date);
    const day = result.getDay() || 7;
    result.setHours(0, 0, 0, 0);
    result.setDate(result.getDate() - day + 1);
    return result;
}

export function startDay(date) {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
}

export function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

export function addMinutes(date, minutes) {
    const result = new Date(date);
    result.setMinutes(result.getMinutes() + minutes);
    return result;
}

export function setClock(date, hours, minutes) {
    const result = new Date(date);
    result.setHours(hours, minutes, 0, 0);
    return result;
}

export function dayDiff(left, right) {
    return Math.floor((startDay(left) - startDay(right)) / 86400000);
}

export function numberValue(id, fallback) {
    return Number(inputValue(id)) || fallback;
}

export function inputValue(id) {
    return element(id)?.value || "";
}

export function checkboxValue(id) {
    return Boolean(element(id)?.checked);
}

export function round(value, precision = 1) {
    const multiplier = 10 ** precision;
    return Math.round((Number(value) || 0) * multiplier) / multiplier;
}

export function capitalize(value) {
    return String(value || "").replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function byDateDesc(left, right) {
    return new Date(right.date || right.createdAt) - new Date(left.date || left.createdAt);
}

export function byDateAsc(left, right) {
    return new Date(left.date || left.createdAt) - new Date(right.date || right.createdAt);
}

export function createId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
