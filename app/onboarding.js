// Onboarding.
import { escapeHtml } from "../lib/format.js";
import {
    ONBOARDING_QUESTIONS, missingOnboarding, needsOnboarding, validBirthDate, ageFromBirthDate, birthDateBounds,
    stepBlocker
} from "../lib/onboarding.js";
import { loadDatabaseOrThrow } from "./boot.js";
import { storage } from "./data.js";
import { muscleIcon, muscleLabel, orderedMuscleGroups } from "./exercise-picker.js";
import { activeWorkoutFor, currentUser } from "./model.js";
import { element, friendlyError, lockBackgroundScroll, toast, unlockBackgroundScroll } from "./overlays.js";
import { persist } from "./persistence.js";
import { getPref, setPref } from "./prefs.js";
import { accessState, loadAccessState, setPrivacy } from "./privacy.js";
import { renderCurrentUserButton, renderSection, renderSidebarProfile } from "./shell.js";
import { state } from "./state.js";
import { iconsIn } from "./util.js";
import { pluralUk } from "./workout-screen.js";

// ---- Onboarding ---------------------------------------------------------------------
//
// One flow that asks everything an account is missing, privacy included. Privacy used
// to be its own dialog that appeared three seconds after opening the app, which is
// the worst possible moment to read a setting about who can see your data: you came
// to log a workout, and a modal about visibility is something to dismiss. As a step
// among five, with the same weight as height and bodyweight, it gets answered.
//
// One question per screen on purpose. The same six fields as a form are a wall that
// gets abandoned; asked one at a time with a progress bar they are a minute.
const onboardingState = { open: false, index: 0, draft: null, steps: [], saving: false, error: "" };

/**
 * Onboarding answers survive a reload.
 *
 * Measured on production: phones discard this PWA and boot it again about every six
 * minutes — 67 full boots across three people in three hours, and half the live
 * streams died inside thirty seconds. A five-question flow that only writes anything
 * at the very end will therefore lose somebody's answers as a matter of routine, and
 * the way it showed up was the save being cut off mid-request (HTTP 499) with the
 * button stuck on «Зберігаємо…» until the twenty-second timeout.
 */
function onboardingDraftKey() {
    return `gymos-onboarding-${storage.currentUser?.id || state.database?.currentUserId || "anon"}`;
}

function saveOnboardingDraft() {
    if (!onboardingState.open) {
        return;
    }
    try {
        localStorage.setItem(onboardingDraftKey(), JSON.stringify({
            draft: onboardingState.draft,
            step: currentOnboardingStep()
        }));
    } catch (error) {
        // A full or private-mode storage just means the old behaviour.
    }
}

function readOnboardingDraft() {
    try {
        const raw = localStorage.getItem(onboardingDraftKey());
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        return null;
    }
}

function clearOnboardingDraft() {
    try {
        localStorage.removeItem(onboardingDraftKey());
    } catch (error) {
        // nothing to clear
    }
}

export function maybeStartOnboarding() {
    if (onboardingState.open || storage.mode !== "api" || !accessState.loaded) {
        return;
    }
    // Never over a workout in progress — that screen is somebody mid-set.
    if (state.section === "workout" && activeWorkoutFor(currentUser().id)) {
        return;
    }
    // Once per session. Dismissing it must not mean being asked again on the next
    // route change, and completing it must not race a second copy into existence.
    // An INTERRUPTED flow is the exception: a page thrown away mid-answer should come
    // back to where it was, not stay silent because this session had already seen it.
    if (sessionStorage.getItem("gymos-onboarding-seen") && !readOnboardingDraft()) {
        return;
    }
    const user = currentUser();
    if (!needsOnboarding(user, Boolean(accessState.privacyChoiceAt))) {
        return;
    }
    openOnboarding();
}

export function openOnboarding() {
    const user = currentUser();
    const missing = missingOnboarding(user, Boolean(accessState.privacyChoiceAt));
    onboardingState.open = true;
    onboardingState.index = 0;
    onboardingState.saving = false;
    onboardingState.error = "";
    // Only what is actually missing, wrapped in the intro and the payoff. Asking
    // somebody to re-confirm a height they entered last year is how a one-minute
    // flow becomes something to close.
    onboardingState.steps = ["intro", ...ONBOARDING_QUESTIONS.filter((step) => missing.includes(step)), "done"];
    onboardingState.draft = {
        displayName: user.displayName || user.name || "",
        birthDate: user.birthDate || (user.birthYear ? `${user.birthYear}-01-01` : ""),
        height: user.height || "",
        bodyweight: user.bodyweight || "",
        favoriteMuscleGroup: user.favoriteMuscleGroup || "",
        // Not a step of its own: onboarding already asks five questions, and a sixth
        // buys one preference at the cost of everybody who abandons on it. It rides
        // along with «what do you like to train», which is the other question about
        // how somebody trains.
        useSupersets: getPref("useSupersets") === "1",
        hideWorkoutDetails: accessState.privacyChoiceAt ? accessState.hideWorkoutDetails : null
    };
    // Pick up where a discarded page left off, rather than asking the same five
    // questions again.
    const saved = readOnboardingDraft();
    if (saved && saved.draft) {
        Object.assign(onboardingState.draft, saved.draft);
        const resumeAt = onboardingState.steps.indexOf(saved.step);
        if (resumeAt > 0) {
            onboardingState.index = resumeAt;
        }
    }
    try {
        sessionStorage.setItem("gymos-onboarding-seen", "1");
    } catch (error) {
        // A private-mode browser simply gets asked again next open.
    }
    renderOnboarding();
    lockBackgroundScroll();
}

export function closeOnboarding() {
    onboardingState.open = false;
    // The date panel is portaled to <body>, so it does not go away with the layer
    // that owns its field — it would be left floating over the app with nothing
    // behind it.
    document.querySelectorAll(".gdate-panel, .gselect-panel").forEach((panel) => panel.remove());
    const layer = element("onboardingLayer");
    if (layer) {
        layer.classList.remove("visible");
        setTimeout(() => {
            if (!onboardingState.open) {
                layer.innerHTML = "";
                layer.classList.add("hidden");
            }
        }, 260);
    }
    unlockBackgroundScroll();
}

function currentOnboardingStep() {
    return onboardingState.steps[onboardingState.index] || "done";
}

function renderOnboarding() {
    let layer = element("onboardingLayer");
    if (!layer) {
        layer = document.createElement("div");
        layer.id = "onboardingLayer";
        layer.className = "ob-layer hidden";
        document.body.appendChild(layer);
    }
    const step = currentOnboardingStep();
    // The intro and the payoff are not questions, so they get no progress pip and no
    // back button — a progress bar that counts screens you cannot fail is noise.
    const questions = onboardingState.steps.filter((item) => item !== "intro" && item !== "done");
    const position = step === "done" ? questions.length : questions.indexOf(step);
    const pips = questions.length > 1
        ? `<div class="ob-pips" aria-hidden="true">${questions.map((item, index) => `<span class="${index < position ? "done" : index === position ? "on" : ""}"></span>`).join("")}</div>`
        : "";
    layer.innerHTML = `<div class="ob-card ob-${step}" role="dialog" aria-modal="true" aria-label="Знайомство">
            ${pips}
            <div class="ob-body" id="onboardingBody">${onboardingStepMarkup(step)}</div>
            ${onboardingFooter(step)}
        </div>`;
    layer.classList.remove("hidden");
    iconsIn(layer);
    requestAnimationFrame(() => layer.classList.add("visible"));
    // Autofocus the one field a step is waiting on — but never on a touch screen,
    // where it summons the keyboard over the question you are meant to read first.
    if (!matchMedia("(pointer: coarse)").matches) {
        layer.querySelector("input[data-ob-field]")?.focus();
    }
}

function onboardingHead(icon, title, subtitle) {
    return `<div class="ob-head"><span class="ob-icon"><i data-lucide="${icon}"></i></span><h2>${escapeHtml(title)}</h2>${subtitle ? `<p class="ob-sub">${escapeHtml(subtitle)}</p>` : ""}</div>`;
}

function onboardingStepMarkup(step) {
    const draft = onboardingState.draft;
    const error = onboardingState.error ? `<p class="ob-error" role="alert"><i data-lucide="alert-circle"></i>${escapeHtml(onboardingState.error)}</p>` : "";

    if (step === "intro") {
        const name = (currentUser().displayName || "").split(" ")[0];
        return `${onboardingHead("hand-metal", name ? `Привіт, ${name}!` : "Привіт!", "Кілька коротких питань — і GymOS рахуватиме твій прогрес, рівні та рекорди.")}
                <div class="ob-teasers">
                    <span class="ob-teaser"><i data-lucide="timer"></i>1 хвилина</span>
                    <span class="ob-teaser"><i data-lucide="pencil"></i>Змінити можна будь-коли</span>
                </div>`;
    }

    if (step === "identity") {
        return `${onboardingHead("user-round", "Як тебе показувати?", "Це імʼя бачитимуть у команді, стрічці й рейтингах.")}
                <input class="ob-input" type="text" maxlength="40" placeholder="Твоє імʼя" value="${escapeHtml(draft.displayName)}" data-action="onboarding-field" data-ob-field="displayName" autocomplete="nickname">${error}`;
    }

    if (step === "birth") {
        // Bounds go to the picker as well as to the validator, so an impossible year
        // is greyed out rather than accepted and then rejected.
        const bounds = birthDateBounds();
        const age = validBirthDate(draft.birthDate) ? ageFromBirthDate(draft.birthDate) : null;
        return `${onboardingHead("cake", "Коли твій день народження?", "Вік впливає на силові нормативи й на те, скільки часу треба на відновлення.")}
                <gym-date class="ob-date" id="onboardingBirth" value="${escapeHtml(draft.birthDate)}" min="${bounds.min}" max="${bounds.max}" data-action="onboarding-field" data-ob-field="birthDate"></gym-date>
                ${age === null ? "" : `<p class="ob-hint"><i data-lucide="sparkles"></i>${age} ${pluralUk(age, "рік", "роки", "років")}</p>`}${error}`;
    }

    if (step === "body") {
        return `${onboardingHead("ruler", "Зріст і вага", "Потрібні для нормативів і графіка ваги тіла.")}
                <div class="ob-pair">
                    <label class="ob-field"><span>Зріст</span><span class="ob-input-wrap"><input class="ob-input" type="number" inputmode="numeric" min="100" max="250" placeholder="180" value="${escapeHtml(String(draft.height || ""))}" data-action="onboarding-field" data-ob-field="height"><em>см</em></span></label>
                    <label class="ob-field"><span>Вага</span><span class="ob-input-wrap"><input class="ob-input" type="number" inputmode="decimal" step="0.1" min="30" max="300" placeholder="80" value="${escapeHtml(String(draft.bodyweight || ""))}" data-action="onboarding-field" data-ob-field="bodyweight"><em>кг</em></span></label>
                </div>${error}`;
    }

    if (step === "focus") {
        // The catalogue's own muscle grid — silhouettes, not a dropdown of words.
        const card = (value) => `<button type="button" class="muscle-card${draft.favoriteMuscleGroup === value ? " active" : ""}" data-action="onboarding-muscle" data-value="${escapeHtml(value)}"><span class="muscle-card-ic">${muscleIcon(value)}</span><span class="muscle-card-label">${escapeHtml(muscleLabel(value))}</span></button>`;
        const superset = (value, label) => `<button type="button" class="ob-mini${draft.useSupersets === value ? " active" : ""}" data-action="onboarding-supersets" data-value="${value}">${escapeHtml(label)}</button>`;
        return `${onboardingHead("target", "Що любиш тренувати?", "Підсвітимо твій фокус у профілі й рейтингах.")}
                <div class="muscle-grid ob-grid">${orderedMuscleGroups().map(card).join("")}</div>
                <div class="ob-aside">
                    <div class="ob-aside-text"><strong>Виконуєте вправи суперсетами?</strong><span>2–3 вправи поспіль із відпочинком після завершення раунду</span></div>
                    <div class="ob-mini-row">${superset(true, "Так")}${superset(false, "Ні")}</div>
                </div>${error}`;
    }

    if (step === "privacy") {
        const pick = (value, icon, title, text) => `<button type="button" class="ob-choice${draft.hideWorkoutDetails === (value === "true") ? " active" : ""}" data-action="onboarding-privacy" data-value="${value}">
                <span class="ob-choice-ic"><i data-lucide="${icon}"></i></span>
                <span class="ob-choice-text"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></span>
                <i data-lucide="check" class="ob-choice-tick"></i>
            </button>`;
        return `${onboardingHead("eye", "Хто бачить твої тренування?", "Профіль, рівень і сам факт тренування видно завжди.")}
                <div class="ob-choices">
                    ${pick("false", "users", "Уся команда", "Бачать вправи, підходи й ваги")}
                    ${pick("true", "lock", "Тільки я", "Деталі приховані, доступ — за запитом")}
                </div>${error}`;
    }

    const name = (onboardingState.draft.displayName || "").split(" ")[0];
    return `${onboardingHead("party-popper", name ? `Готово, ${name}!` : "Готово!", "")}
            <ul class="ob-perks">
                <li><i data-lucide="trending-up"></i><span><strong>Тренуйся і трекай</strong>Кожен підхід рахується — обсяг, рекорди, прогрес по вправах</span></li>
                <li><i data-lucide="medal"></i><span><strong>Отримуй рівні</strong>500 рівнів, рамки для аватара й досягнення за реальну роботу</span></li>
                <li><i data-lucide="users"></i><span><strong>Тренуйся разом</strong>Дивись сесії команди наживо, підбадьорюй і тренуйся в парі</span></li>
                <li><i data-lucide="lightbulb"></i><span><strong>Пропонуй фічі</strong>Ідеї з дошки справді доїжджають у застосунок</span></li>
            </ul>${error}`;
}

function onboardingFooter(step) {
    if (step === "intro") {
        return `<div class="ob-foot">
                <button class="button button-ghost" type="button" data-action="onboarding-skip">Пізніше</button>
                <button class="button button-primary" type="button" data-action="onboarding-next"><span>Почнемо</span><i data-lucide="arrow-right"></i></button>
            </div>`;
    }
    if (step === "done") {
        return `<div class="ob-foot single">
                <button class="button button-primary" type="button" data-action="onboarding-finish" ${onboardingState.saving ? "disabled" : ""}><i data-lucide="${onboardingState.saving ? "loader" : onboardingState.error ? "rotate-ccw" : "check"}"></i><span>${onboardingState.saving ? "Зберігаємо…" : onboardingState.error ? "Спробувати ще раз" : "До тренування"}</span></button>
            </div>`;
    }
    const first = onboardingState.steps.indexOf(step) <= 1;
    return `<div class="ob-foot">
            <button class="button button-ghost" type="button" data-action="onboarding-back" ${first ? "disabled" : ""}><i data-lucide="arrow-left"></i><span>Назад</span></button>
            <button class="button button-primary" type="button" data-action="onboarding-next"><span>Далі</span><i data-lucide="arrow-right"></i></button>
        </div>`;
}

export function setOnboardingField(field, value) {
    onboardingState.draft[field] = value;
    onboardingState.error = "";
    saveOnboardingDraft();
    // Repaint only what the value changes — the live age line and the selected card.
    // Re-rendering the step would recreate the input and drop the caret mid-typing.
    if (field === "birthDate") {
        renderOnboardingBody();
    }
}

export function renderOnboardingBody() {
    const host = element("onboardingBody");
    if (!host) {
        return;
    }
    host.innerHTML = onboardingStepMarkup(currentOnboardingStep());
    iconsIn(host);
}

export function onboardingNext() {
    const step = currentOnboardingStep();
    const blocker = stepBlocker(step, onboardingState.draft);
    if (blocker) {
        onboardingState.error = blocker;
        renderOnboardingBody();
        return;
    }
    onboardingState.error = "";
    onboardingState.index = Math.min(onboardingState.index + 1, onboardingState.steps.length - 1);
    saveOnboardingDraft();
    renderOnboarding();
}

export function onboardingBack() {
    onboardingState.error = "";
    onboardingState.index = Math.max(0, onboardingState.index - 1);
    renderOnboarding();
}

/**
 * Save everything at the end, in one go.
 *
 * Per-step saving would leave a half-answered profile behind whenever somebody closed
 * the tab in the middle — and a profile that is missing exactly one field is a
 * profile that gets asked again, which is the outcome this flow exists to avoid.
 */
export async function finishOnboarding() {
    if (onboardingState.saving) {
        return;
    }
    onboardingState.saving = true;
    renderOnboarding();
    const draft = onboardingState.draft;
    const user = currentUser();
    const payload = {};
    if (draft.displayName) {
        payload.displayName = draft.displayName.trim();
    }
    if (validBirthDate(draft.birthDate)) {
        payload.birthDate = draft.birthDate;
        // Sent too, so a backend that predates birthDate still records the age.
        payload.birthYear = Number(draft.birthDate.slice(0, 4));
    }
    if (Number(draft.height) > 0) {
        payload.height = Math.round(Number(draft.height));
    }
    if (Number(draft.bodyweight) > 0) {
        payload.bodyweight = Number(draft.bodyweight);
    }
    if (draft.favoriteMuscleGroup) {
        payload.favoriteMuscleGroup = draft.favoriteMuscleGroup;
    }
    // A preference, not a profile field — setPref mirrors it to the account, so the
    // answer follows the person to every device. No paywall here on purpose: saying
    // "yes" costs nothing, and the tier is met when the feature is actually reached.
    setPref("useSupersets", draft.useSupersets ? "1" : "0");
    const apiMode = storage.mode === "api" && storage.apiClient.hasBaseUrl();
    try {
        if (Object.keys(payload).length) {
            if (apiMode) {
                await storage.apiClient.updateProfile(payload);
            }
            Object.assign(user, payload, { updatedAt: new Date().toISOString() });
            if (!apiMode) {
                await persist({ silent: true });
            }
        }
        if (!apiMode) {
            // Nothing to record the privacy choice against without a backend.
        } else if (draft.hideWorkoutDetails === true) {
            await setPrivacy(true);
        } else if (draft.hideWorkoutDetails === false) {
            accessState.privacyChoiceAt = new Date().toISOString();
            await storage.apiClient.acknowledgePrivacy();
        }
        clearOnboardingDraft();
        closeOnboarding();
        renderSection();
        renderCurrentUserButton();
        renderSidebarProfile();
        toast("Профіль готовий", "Гарного тренування!");
    } catch (error) {
        // The answers stay on disk, so pressing the button again resends them — and
        // so does reopening after the page has been thrown away mid-request.
        onboardingState.saving = false;
        onboardingState.error = error?.timedOut
            ? "Звʼязок обірвався. Твої відповіді збережені — спробуй ще раз."
            : friendlyError(error);
        renderOnboarding();
    }
}

/**
 * Forget detail this device is no longer entitled to.
 *
 * Revoking on the server stops the NEXT read; it does nothing about the sets already
 * sitting in memory and in IndexedDB from when access was granted. Without this an
 * ex-subscriber keeps seeing everything they were ever shown, which makes "закрити
 * доступ" a promise the app does not keep.
 *
 * The whole payload is re-read rather than surgically pruned: the server is the only
 * thing that knows what this account may now see, and guessing at it here is how a
 * row gets missed.
 */
export async function dropRevokedDetail() {
    await loadAccessState();
    try {
        const fresh = await loadDatabaseOrThrow();
        state.database = fresh;
        state.profileUserId = state.database.currentUserId;
    } catch (error) {
        // Could not re-read. Drop every peer row rather than keep showing detail that
        // may no longer be permitted — a missing calendar entry is recoverable, a
        // leak is not.
        const me = state.database.currentUserId;
        state.database.workouts = state.database.workouts.filter((row) => row.userId === me);
    }
    renderSection();
    toast("Доступ закрито", "Ця людина більше не показує тобі деталі своїх тренувань");
}
