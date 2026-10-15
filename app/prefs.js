// User preferences (theme, accent, workout defaults) and their cross-device sync.
import { storage } from "./data.js";

// ---- User preferences (theme / accent / compact / workout defaults) ----
// Stored via storage.readSetting/writeSetting (localStorage "gymos-setting-pref-*").
const PREF_DEFAULTS = {
    theme: "dark",            // dark | system | blackout
    accent: "mint",           // mint | blue | purple | amber | red
    compactCards: "0",        // "1" = compact
    defaultRest: "90",
    defaultWorkoutType: "custom",
    defaultDuration: "90",    // minutes; "auto" = clock-based. Default 1.5 год
    defaultSetType: "warmup",
    autoStartRest: "1",       // "1" = auto-start rest timer on set completion
    useSupersets: "1",        // "1" = offer merging 2–3 exercises into rounds
    keepAwake: "1",           // "1" = hold a screen wake lock while a workout is active
};

export function getPref(key) {
    const value = storage.readSetting(`pref-${key}`);
    return value === null || value === undefined || value === "" ? PREF_DEFAULTS[key] : value;
}

export function setPref(key, value) {
    storage.writeSetting(`pref-${key}`, String(value));
    pushPreferences();
}

// ---- Cross-device preference sync (API mode only) ----
// Prefs live in localStorage (device-local); when logged in we mirror the full
// set to the account so every device inherits theme/accent/defaults. Server is
// the source of truth on load; local is only a fallback / first-login seed.
let prefSyncTimer = null;

let suppressPrefSync = false;

function collectPreferences() {
    const out = {};
    Object.keys(PREF_DEFAULTS).forEach((key) => { out[key] = getPref(key); });
    return out;
}

function canSyncPreferences() {
    return storage.mode === "api" && !!storage.currentUser;
}

// Debounced push of the whole pref set (wholesale replace on the backend).
function pushPreferences() {
    if (suppressPrefSync || !canSyncPreferences()) {
        return;
    }
    clearTimeout(prefSyncTimer);
    prefSyncTimer = setTimeout(() => {
        const prefs = collectPreferences();
        storage.apiClient.savePreferences(prefs).then(() => {
            if (storage.currentUser) {
                storage.currentUser.preferences = prefs;
            }
        }).catch(() => {});
    }, 700);
}

// On login: adopt the account's saved prefs (they win over local so a change on
// one device shows up here); if the account has none yet, seed it from local.
export function syncPreferencesFromServer() {
    if (!canSyncPreferences()) {
        return;
    }
    const server = storage.currentUser.preferences;
    if (server && typeof server === "object" && Object.keys(server).length) {
        suppressPrefSync = true;
        Object.entries(server).forEach(([key, value]) => {
            if (key in PREF_DEFAULTS && value !== null && value !== undefined) {
                setPref(key, value);
            }
        });
        suppressPrefSync = false;
        applyPreferences();
    } else {
        storage.apiClient.savePreferences(collectPreferences()).then((response) => {
            if (storage.currentUser) {
                storage.currentUser.preferences = response?.preferences || collectPreferences();
            }
        }).catch(() => {});
    }
}

// Reflect appearance prefs onto <html> (CSS keys off [data-theme]/[data-accent]
// and .compact-ui; the defaults dark/mint map to the base :root, no override).
export function applyPreferences() {
    const root = document.documentElement;
    root.dataset.theme = getPref("theme");
    root.dataset.accent = getPref("accent");
    root.classList.toggle("compact-ui", getPref("compactCards") === "1");
}
