// Presentation helpers for Стрічка. Pure functions with no app state, kept out of
// app.js so the feed's formatting rules are testable and readable on their own.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Relative time the way a social feed says it: "щойно", "14 хв", "3 год", "вчора",
// then an absolute date once "N днів тому" stops being easier to read than the date.
export function timeAgo(value, now = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    const diff = now.getTime() - date.getTime();
    if (!Number.isFinite(diff)) {
        return "";
    }
    if (diff < MINUTE) {
        return "щойно";
    }
    if (diff < HOUR) {
        return `${Math.floor(diff / MINUTE)} хв`;
    }
    if (diff < DAY) {
        return `${Math.floor(diff / HOUR)} год`;
    }
    if (diff < 2 * DAY) {
        return "вчора";
    }
    if (diff < 7 * DAY) {
        return `${Math.floor(diff / DAY)} дн`;
    }
    return date.toLocaleDateString("uk-UA", { day: "numeric", month: "short" });
}

// Notifications are bucketed rather than listed flat: "today" is what you act on,
// everything older is context.
export function notificationBucket(value, now = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return date.getTime() >= startOfToday ? "today" : "earlier";
}

export const NOTIFICATION_ICONS = {
    comment: "message-circle",
    reply: "corner-down-right",
    reaction: "thumbs-up",
    mention: "at-sign",
    achievement: "award",
    team: "users",
    moderation: "shield-alert"
};

export const REPORT_REASON_LABELS = {
    spam: "Спам або реклама",
    abuse: "Образи чи агресія",
    unsafe: "Небезпечні поради",
    other: "Інше"
};

export const FEED_SCOPE_TABS = [
    ["team", "Команда"],
    ["records", "Рекорди"],
    ["achievements", "Досягнення"],
    ["mine", "Мої"]
];

// Push categories the settings screen renders. `defaultOn` mirrors the server's
// PUSH_DEFAULTS: direct interactions with your content are on, ambient team noise is
// off, and anything added later starts off.
export const PUSH_CATEGORIES = [
    { key: "comment", label: "Коментарі до моїх тренувань", defaultOn: true },
    { key: "reply", label: "Відповіді у тредах", defaultOn: true },
    { key: "reaction", label: "Реакції на мої пости", defaultOn: true },
    { key: "moderation", label: "Рішення модерації щодо мене", defaultOn: true },
    { key: "achievement", label: "Мої нові досягнення", defaultOn: false },
    { key: "team", label: "Активність команди", defaultOn: false }
];

// Web Push needs the VAPID key as a byte array, not the base64url string the server
// stores. Browsers reject a malformed key with an opaque error, so this conversion
// lives in one tested place.
export function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const output = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) {
        output[index] = raw.charCodeAt(index);
    }
    return output;
}

// Comments come back as a flat list; the UI shows one level of threading. Roots keep
// their order and each carries its replies, so a reply can never orphan itself when
// its parent is hidden or deleted.
export function threadComments(items) {
    const roots = [];
    const byId = new Map();
    for (const item of items || []) {
        if (!item.parentId) {
            const node = { ...item, replies: [] };
            byId.set(item.id, node);
            roots.push(node);
        }
    }
    for (const item of items || []) {
        if (item.parentId) {
            const parent = byId.get(item.parentId);
            if (parent) {
                parent.replies.push(item);
            } else {
                // Parent gone (deleted): keep the reply visible as a root rather than
                // silently dropping someone's message.
                roots.push({ ...item, replies: [] });
            }
        }
    }
    return roots;
}
