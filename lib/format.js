// Pure formatting + small string/date/array utilities shared across the app.
// No app state — input → output only.

export function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

export function number(value) {
    return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(Number(value) || 0);
}

export function dateInput(date) {
    const result = new Date(date);
    return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, "0")}-${String(result.getDate()).padStart(2, "0")}`;
}

export function formatDate(value) {
    return value ? new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) : "—";
}

export function shortDate(value) {
    return new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "short" }).format(new Date(value));
}

export function seconds(value) {
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

export function splitCsv(value) {
    return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

export function unique(items) {
    return [...new Set(items)].sort();
}

export function imageUrl(value) {
    const url = String(value || "").trim();
    return /^https?:\/\//i.test(url) ? url : "";
}
