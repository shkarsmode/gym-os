// Privacy and access requests.
import { escapeHtml } from "../lib/format.js";
import { storage } from "./data.js";
import { avatar, userById } from "./model.js";
import { friendlyError, toast } from "./overlays.js";
import { firstName } from "./presence.js";
import { userStats } from "./scoring-bridge.js";
import { settingsGroup, settingsRow } from "./settings.js";
import { renderSection } from "./shell.js";

// ---- Privacy and access requests ---------------------------------------------------
//
// A member can hide the detail behind their sessions. Everyone still sees their
// profile, their standing and that they trained; the exercises, sets, weights, notes
// and records are gated behind an explicit grant.
//
// Nothing here decides what is visible — the server does, and it does so by not
// fetching the rows in the first place. This is only the UI for asking and answering.
export const accessState = { hideWorkoutDetails: false, privacyChoiceAt: null, incoming: [], outgoing: [], subscribers: [], loaded: false };

export async function loadAccessState() {
    if (storage.mode !== "api" || !storage.apiClient.hasBaseUrl()) {
        return;
    }
    try {
        const answer = await storage.apiClient.fetchAccessState();
        Object.assign(accessState, answer, { loaded: true });
    } catch (error) {
        // Privacy UI is not worth failing a screen over; the server enforces the rule
        // regardless of whether this loaded.
    }
}

/** What this viewer's relationship to another member's data currently is. */
export function accessTo(ownerId) {
    const row = (accessState.outgoing || []).find((item) => item.ownerId === ownerId);
    return row ? row.status : "none";
}

export function isWorkoutPrivate(workoutItem) {
    return Boolean(workoutItem && workoutItem.private);
}

export async function requestAccess(ownerId) {
    try {
        const answer = await storage.apiClient.requestAccess(ownerId);
        // Optimistically reflect it so the button stops inviting another tap; the
        // authoritative state arrives on the next access.changed event.
        if (!(accessState.outgoing || []).some((item) => item.ownerId === ownerId)) {
            accessState.outgoing = [...(accessState.outgoing || []), { ownerId, status: answer.status || "pending", owner: userById(ownerId) }];
        }
        renderSection();
        toast("Запит надіслано", "Ти дізнаєшся, коли його розглянуть");
    } catch (error) {
        toast("Не вдалося надіслати запит", friendlyError(error), "error");
    }
}

export async function decideAccess(grantId, action) {
    try {
        await storage.apiClient.decideAccess(grantId, action);
        await loadAccessState();
        renderSection();
        if (action === "accept") {
            toast("Доступ відкрито", "Ця людина тепер бачить деталі твоїх тренувань");
        } else if (action === "revoke") {
            toast("Доступ закрито", "Деталі твоїх тренувань знову приховані");
        }
    } catch (error) {
        toast("Не вдалося", friendlyError(error), "error");
    }
}

export async function setPrivacy(hide) {
    // Painted immediately: a switch that waits for a round trip before moving feels
    // broken, and the failure path below puts it back.
    const previous = accessState.hideWorkoutDetails;
    accessState.hideWorkoutDetails = hide;
    accessState.privacyChoiceAt = new Date().toISOString();
    renderSection();
    try {
        await storage.apiClient.setPrivacy(hide);
        toast(
            hide ? "Тренування приховані" : "Тренування відкриті",
            hide
                ? "Інші бачать, що ти тренувався, але не бачать вправ, підходів і ваг"
                : "Інші знову бачать деталі твоїх тренувань"
        );
    } catch (error) {
        accessState.hideWorkoutDetails = previous;
        renderSection();
        toast("Не вдалося змінити", friendlyError(error), "error");
    }
}

// ---- The privacy card in Налаштування -----------------------------------------------

export function privacySettingsCard() {
    if (storage.mode !== "api") {
        return "";
    }
    const hide = Boolean(accessState.hideWorkoutDetails);
    const pending = (accessState.incoming || []).length;
    const subscribers = (accessState.subscribers || []).length;
    const extras = `${pending ? `<div class="access-alert"><i data-lucide="user-plus"></i><span>${pending} ${pending === 1 ? "запит очікує" : "запити очікують"} на відповідь</span></div>` : ""}`
        + `${(accessState.incoming || []).map(accessRequestRow).join("")}`
        + `${subscribers ? `<h3 class="access-subhead">Мають доступ (${subscribers})</h3>${(accessState.subscribers || []).map(subscriberRow).join("")}` : ""}`;
    return settingsGroup("Приватність тренувань", [
        settingsRow("Приховати деталі", `<label class="settings-switch"><input type="checkbox" data-action="set-privacy-switch" ${hide ? "checked" : ""} aria-label="Приховати деталі тренувань"><span></span></label>`, {
            hint: "Видно профіль, рівень і сам факт тренування — але не вправи, підходи, ваги, нотатки й рекорди"
        })
    ], { footer: extras ? `<div class="settings-group-extra">${extras}</div>` : "" });
}

function accessRequestRow(row) {
    const person = row.viewer || {};
    return `<div class="access-row">
            <div class="access-person">${avatar(person, "tiny")}<span>${escapeHtml(person.displayName || "Учасник")}</span></div>
            <div class="access-actions">
                <button class="button button-primary compact" type="button" data-action="access-decide" data-grant-id="${escapeHtml(row.id)}" data-decision="accept">Відкрити</button>
                <button class="button button-secondary compact" type="button" data-action="access-decide" data-grant-id="${escapeHtml(row.id)}" data-decision="reject">Відхилити</button>
            </div>
        </div>`;
}

function subscriberRow(row) {
    const person = row.viewer || {};
    return `<div class="access-row">
            <div class="access-person">${avatar(person, "tiny")}<span>${escapeHtml(person.displayName || "Учасник")}</span></div>
            <div class="access-actions">
                <button class="button button-secondary compact" type="button" data-action="access-decide" data-grant-id="${escapeHtml(row.id)}" data-decision="revoke">Закрити доступ</button>
            </div>
        </div>`;
}

/**
 * Whether this member's detail is being withheld from the current viewer.
 *
 * Read from the ABSENCE of the detail-derived stats rather than from a flag, because
 * absence is what the server actually produces — and a flag would be one more thing
 * that can be out of step with the data it describes.
 */
export function detailHiddenFor(userId) {
    const stats = userStats(userId);
    return Boolean(stats) && stats.totalVolume === undefined;
}

/** A metric tile that says "not shown" instead of inventing a number. */
export function lockedMetric(label, span = "span-3") {
    return `<section class="card metric ${span} metric-locked">
            <span class="metric-ico"><i data-lucide="lock"></i></span>
            <div><div class="metric-label">${escapeHtml(label)}</div><div class="metric-value">—</div><div class="metric-caption">Приховано власником</div></div>
        </section>`;
}

export function subscribeButton(user, isCurrent) {
    if (isCurrent || storage.mode !== "api" || !detailHiddenFor(user.id)) {
        return "";
    }
    const status = accessTo(user.id);
    if (status === "accepted") {
        return `<span class="badge unlocked"><i data-lucide="lock-open"></i>Ти маєш доступ</span>`;
    }
    if (status === "pending") {
        return `<button class="button button-secondary compact" type="button" disabled><i data-lucide="clock"></i>Запит надіслано</button>`;
    }
    return `<button class="button button-primary compact" type="button" data-action="request-access" data-owner-id="${escapeHtml(user.id)}"><i data-lucide="user-plus"></i>Підписатися</button>`;
}

// ---- The locked workout screen ------------------------------------------------------

export function privateWorkoutPanel(ownerId) {
    const owner = userById(ownerId);
    const name = owner ? firstName(owner.displayName) : "Учасник";
    const status = accessTo(ownerId);
    const action = status === "accepted"
        ? ""
        : status === "pending"
            ? `<button class="button button-secondary" type="button" disabled><i data-lucide="clock"></i>Запит надіслано</button>`
            : `<button class="button button-primary" type="button" data-action="request-access" data-owner-id="${escapeHtml(ownerId)}"><i data-lucide="lock-open"></i>Запросити доступ</button>`;
    return `<section class="card private-panel">
            <span class="private-ico"><i data-lucide="lock"></i></span>
            <h3>Деталі тренування приватні</h3>
            <p class="card-caption">${escapeHtml(name)} приховує вправи, підходи й ваги. Видно, що тренування було — решта лише за згодою.</p>
            ${action ? `<div class="action-row" style="justify-content:center;">${action}</div>` : ""}
        </section>`;
}
