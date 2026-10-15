// Training together.
import { escapeHtml } from "../lib/format.js";
import { storage } from "./data.js";
import { avatar } from "./model.js";
import { element, friendlyError, toast } from "./overlays.js";
import { firstName, liveState } from "./presence.js";
import { renderSection } from "./shell.js";
import { iconsIn } from "./util.js";
import { syncWatchFab } from "./watch.js";

// ---- Training together --------------------------------------------------------------
//
// Two people, watching each other's sets as they happen. Read-only in both
// directions — see partner.service.ts for why editing a partner's session is not
// currently buildable honestly.
export const partnerState = { partnership: null, workout: null, loading: false };

export async function loadPartnerState() {
    if (storage.mode !== "api" || !storage.apiClient.hasBaseUrl()) {
        return;
    }
    try {
        const answer = await storage.apiClient.fetchPartner();
        partnerState.partnership = answer?.partnership || null;
    } catch (error) {
        partnerState.partnership = null;
    }
    if (!partnerState.partnership || partnerState.partnership.status !== "active") {
        partnerState.workout = null;
        return;
    }
    await refreshPartnerWorkout();
}

/**
 * Re-read the partner's live session.
 *
 * Their sets are fetched through GET /workouts/:id like anyone else's — the stream
 * only ever said "it moved". That is what keeps this from being a way to see
 * something a plain request would refuse.
 */
export async function refreshPartnerWorkout() {
    const partner = partnerState.partnership?.partner;
    if (!partner) {
        return;
    }
    // ANY state, not just "training". Waiting for their first ticked set was wrong:
    // the session already exists, with every exercise and every planned set in it,
    // and that is exactly what somebody training alongside wants to see — what is
    // coming, not only what is done.
    const live = liveState.presence.find((item) => !item.divider && item.userId === partner.id);
    if (!live) {
        partnerState.workout = null;
        renderPartnerPanel();
        return;
    }
    try {
        const full = await storage.apiClient.fetchWorkout(live.workoutId);
        partnerState.workout = full && Array.isArray(full.exercises) ? full : null;
    } catch (error) {
        partnerState.workout = null;
    }
    renderPartnerPanel();
}

export async function invitePartner(userId) {
    try {
        await storage.apiClient.invitePartner(userId);
        await loadPartnerState();
        renderSection();
        toast("Запрошення надіслано", "Щойно людина прийме — побачиш її підходи наживо");
    } catch (error) {
        toast("Не вдалося запросити", friendlyError(error), "error");
    }
}

export async function answerPartner(id, action) {
    try {
        await storage.apiClient.answerPartner(id, action);
        await loadPartnerState();
        renderSection();
        if (action === "accept") {
            toast("Тренуєте разом", "Ви бачите підходи одне одного наживо");
        }
    } catch (error) {
        toast("Не вдалося", friendlyError(error), "error");
    }
}

/**
 * Open or close YOUR OWN session to the person you are training with.
 *
 * Phrased in the panel as what the person in front of it controls — "X may edit MY
 * workout" — because the mirror right belongs to the other person and no switch here
 * can or should reach it.
 */
export async function setPartnerEditRight(id, allow) {
    try {
        await storage.apiClient.setPartnerEditRight(id, allow);
        if (partnerState.partnership) {
            partnerState.partnership.partnerCanEditMine = allow;
        }
        toast(
            allow ? "Дозволено редагувати" : "Редагування закрито",
            allow
                ? "Партнер може відмічати й міняти підходи у твоєму тренуванні"
                : "Тепер він тільки дивиться"
        );
    } catch (error) {
        await loadPartnerState();
        renderPartnerPanel();
        toast("Не вдалося змінити", friendlyError(error), "error");
    }
}

// ---- The panel ----------------------------------------------------------------------

function partnerPanelMarkup() {
    const link = partnerState.partnership;
    if (!link) {
        return "";
    }
    const person = link.partner || {};
    const name = escapeHtml(firstName(person.displayName));
    if (link.status === "pending") {
        return `<section class="card span-12 partner-card">
                <div class="partner-head">${avatar(person, "tiny")}<div class="partner-title">
                    <strong>${link.incoming ? `${name} кличе тренуватися разом` : `Чекаємо на ${name}`}</strong>
                    <p class="card-caption">${link.incoming ? "Бачитимете підходи одне одного, поки триває сесія." : "Запрошення надіслано."}</p>
                </div></div>
                <div class="action-row">
                    ${link.incoming ? `<button class="button button-primary compact" type="button" data-action="partner-answer" data-id="${escapeHtml(link.id)}" data-decision="accept"><i data-lucide="check"></i>Приєднатися</button>` : ""}
                    <button class="button button-secondary compact" type="button" data-action="partner-answer" data-id="${escapeHtml(link.id)}" data-decision="leave">${link.incoming ? "Не зараз" : "Скасувати"}</button>
                </div>
            </section>`;
    }
    // Deliberately just this: who you are with, and the two things you can do about
    // it. Set counts, volume and an exercise list all live one tap away on the screen
    // the first button opens, and repeating them here only pushed your OWN workout
    // further down the phone.
    const live = partnerState.workout;
    return `<section class="card span-12 partner-card is-live">
            <div class="partner-head">
                ${avatar(person, "tiny")}
                <div class="partner-title"><strong>Разом з ${name}</strong></div>
            </div>
            <div class="partner-actions" id="partnerBody">
                ${live
                ? `<button class="button button-primary compact" type="button" data-action="watch-workout" data-workout-id="${escapeHtml(live.id)}"><i data-lucide="eye"></i>Тренування ${name}</button>`
                : `<span class="card-caption partner-idle">${name} ще не відкрив сьогоднішнє тренування</span>`}
                <button class="button button-secondary compact" type="button" data-action="partner-answer" data-id="${escapeHtml(link.id)}" data-decision="leave">Завершити</button>
            </div>
            <label class="partner-right">
                <input type="checkbox" data-action="partner-edit-right" data-id="${escapeHtml(link.id)}" ${link.partnerCanEditMine ? "checked" : ""}>
                <span>${name} може редагувати моє тренування</span>
            </label>
            ${link.iCanEditTheirs
            ? `<p class="card-caption partner-granted"><i data-lucide="pencil"></i>${name} дозволив тобі редагувати своє</p>`
            : ""}
        </section>`;
}

export function renderPartnerPanel() {
    const host = element("partnerPanel");
    if (!host) {
        return;
    }
    // The panel no longer changes as the partner lifts — it only says who you are
    // with — so there is nothing to update in place and nothing to blink.

    host.innerHTML = partnerPanelMarkup();
    iconsIn(host);
    syncWatchFab();
}

/**
 * "Train together" offered wherever you find out somebody is mid-session — the
 * details of an unfinished workout, and their profile — not only the presence strip.
 * Seeing that a session is running is the moment the offer makes sense; making the
 * invitation live in one corner of one screen means it is never found there.
 */
export function partnerInviteCta(workoutItem, readonly) {
    if (!readonly || storage.mode !== "api" || workoutItem.status !== "active") {
        return "";
    }
    if (partnerState.partnership) {
        return "";
    }
    return `<button class="button button-secondary compact" type="button" data-action="partner-invite" data-user-id="${escapeHtml(workoutItem.userId)}"><i data-lucide="users"></i>Тренуватися разом</button>`;
}

/** The same offer on a member's profile, when they are training right now. */
export function partnerProfileCta(user, isCurrent) {
    if (isCurrent || storage.mode !== "api" || partnerState.partnership) {
        return "";
    }
    const training = liveState.presence.some((item) => item.userId === user.id);
    if (!training) {
        return "";
    }
    return `<button class="button button-secondary compact" type="button" data-action="partner-invite" data-user-id="${escapeHtml(user.id)}"><i data-lucide="users"></i>Тренуватися разом</button>`;
}

/** Offered on someone who is training right now, from the presence strip. */
export function partnerInviteButton(item) {
    const link = partnerState.partnership;
    if (link) {
        // Already in one, or waiting on an answer — no second invitation.
        return "";
    }
    return `<button class="presence-invite" type="button" data-action="partner-invite" data-user-id="${escapeHtml(item.userId)}" title="Тренуватися разом"><i data-lucide="users"></i></button>`;
}
