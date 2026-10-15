// Hash routing and navigation.
import { storage } from "./data.js";
import { routableSections } from "./events.js";
import { feedApiReady } from "./feed.js";
import { closeOverlay, element } from "./overlays.js";
import { renderSection } from "./shell.js";
import { state } from "./state.js";

// Where the app lands with no route in the hash: Стрічка, so opening GymOS shows what
// the team has been doing rather than a screen you have to leave to find it. The feed
// is API-only, though, so without a backend we fall back to Панель — a landing screen
// that renders from local data and cannot greet the user with an error card.
export function defaultSection() {
    return feedApiReady() ? "feed" : "dashboard";
}

function parseRoute() {
    const raw = String(window.location.hash || "").replace(/^#\/?/, "");
    const [section, ...rest] = raw.split("/");
    const params = rest.filter(Boolean).map((part) => decodeURIComponent(part));
    if (section && routableSections.has(section)) {
        return { section, param: params[0] || null, params };
    }
    return { section: defaultSection(), param: null, params: [] };
}

export function handleRoute() {
    if (!state.database || storage.requiresAuthentication()) {
        return;
    }
    const { section, param } = parseRoute();
    state.section = section;
    if (section === "workout") {
        state.editingWorkoutId = param || null;
    }
    if (section === "user") {
        state.viewUserId = param || null;
    }
    if (section === "post") {
        const { params } = parseRoute();
        state.postTarget = params.length >= 2 ? { type: params[0], id: params[1] } : null;
    }
    closeOverlay();
    renderSection();
    scrollToTop();
}

export function goToUser(userId) {
    const target = `#/user/${encodeURIComponent(userId)}`;
    if (window.location.hash === target) {
        handleRoute();
    } else {
        window.location.hash = target;
    }
}

function scrollToTop() {
    window.scrollTo(0, 0);
    const main = document.querySelector(".main-shell");
    if (main) {
        main.scrollTop = 0;
    }
    const content = element("pageContent");
    if (content) {
        content.scrollTop = 0;
    }
}

export function navigate(section) {
    const target = `#/${section}`;
    if (window.location.hash === target) {
        handleRoute();
    } else {
        window.location.hash = target;
    }
}

export function goToWorkoutEditor(workoutId) {
    const target = `#/workout/${encodeURIComponent(workoutId)}`;
    if (window.location.hash === target) {
        handleRoute();
    } else {
        window.location.hash = target;
    }
}
