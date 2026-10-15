// The ideas / feature-request board.
import { escapeHtml, formatDate } from "../lib/format.js";
import { emptyInline } from "./components.js";
import { storage } from "./data.js";
import { avatar, currentUser, isAdmin, userById } from "./model.js";
import { confirmDialog, content, handleUserFacingError, showSyncIndicator, toast } from "./overlays.js";
import { renderSection } from "./shell.js";
import { state } from "./state.js";
import { createId, inputValue } from "./util.js";

// ---- Feedback / feature-request board (public; admin manages statuses) ----
const feedbackTypes = [
    { key: "feature", label: "Фіча", icon: "sparkles" },
    { key: "fix", label: "Фікс", icon: "wrench" },
    { key: "improvement", label: "Покращення", icon: "wand-2" }
];

const feedbackStatuses = [
    { key: "new", label: "Нове" },
    { key: "planned", label: "Заплановано" },
    { key: "in_progress", label: "В роботі" },
    { key: "done", label: "Готово" },
    { key: "declined", label: "Відхилено" }
];

function feedbackItems() {
    return [...(state.database.featureRequests || [])];
}

export function newFeedbackCount() {
    return feedbackItems().filter((item) => item.status === "new").length;
}

export function feedback() {
    const items = feedbackItems().sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
    const admin = isAdmin();
    const pendingType = state.filters.feedbackType || "feature";
    content(`<div class="grid dashboard-grid">
            <section class="card span-12 feedback-compose">
                <div class="card-header"><div><h2>Запропонувати ідею або фікс</h2><p class="card-caption">Обери тип, опиши коротко — це побачить адмін і візьме в роботу.</p></div></div>
                <div class="fb-type-row">${feedbackTypes.map((type) => `<button class="fb-type ${type.key}${pendingType === type.key ? " active" : ""}" type="button" data-action="feedback-type" data-type="${type.key}"><i data-lucide="${type.icon}"></i>${escapeHtml(type.label)}</button>`).join("")}</div>
                <div class="field" style="margin-top:14px;"><label>Назва</label><input type="text" id="feedbackTitle" maxlength="140" placeholder="Коротко: що додати або пофіксити"></div>
                <div class="field" style="margin-top:12px;"><label>Деталі (необов'язково)</label><textarea id="feedbackDescription" maxlength="2000" placeholder="Опиши детальніше: де саме, як і навіщо"></textarea></div>
                <div class="action-row" style="margin-top:14px;"><button class="button button-primary" type="button" data-action="submit-feedback"><i data-lucide="send"></i>Надіслати запит</button></div>
            </section>
            <section class="card span-12">
                <div class="card-header"><div><h2>Дошка ідей</h2><p class="card-caption">${items.length} ${items.length === 1 ? "запит" : "запитів"} від спільноти. ${admin ? "Можеш міняти статус і видаляти." : "Статуси оновлює адмін."}</p></div></div>
                ${items.length ? `<div class="feedback-board">${items.map((item) => feedbackCard(item, admin)).join("")}</div>` : emptyInline("Поки порожньо", "Стань першим — запропонуй ідею вище.")}
            </section>
        </div>`);
}

function feedbackCard(item, admin) {
    const author = userById(item.userId);
    const typeMeta = feedbackTypes.find((type) => type.key === item.type) || feedbackTypes[0];
    const statusMeta = feedbackStatuses.find((status) => status.key === item.status) || feedbackStatuses[0];
    const adminControls = admin
        ? `<div class="fb-admin"><gym-select data-action="set-feedback-status" data-feedback-id="${item.id}">${feedbackStatuses.map((status) => `<option value="${status.key}" ${item.status === status.key ? "selected" : ""}>${escapeHtml(status.label)}</option>`).join("")}</gym-select><button class="icon-button" type="button" title="Видалити запит" data-action="delete-feedback" data-feedback-id="${item.id}"><i data-lucide="trash-2"></i></button></div>`
        : "";
    return `<article class="fb-item status-${item.status} type-${item.type}">
            <div class="fb-item-top"><span class="fb-type-badge ${item.type}"><i data-lucide="${typeMeta.icon}"></i>${escapeHtml(typeMeta.label)}</span><span class="fb-status-badge status-${item.status}">${escapeHtml(statusMeta.label)}</span></div>
            <h3 class="fb-title">${escapeHtml(item.title)}</h3>
            ${item.description ? `<p class="fb-desc">${escapeHtml(item.description)}</p>` : ""}
            <div class="fb-meta">${author ? avatar(author, "tiny") : ""}<span>${escapeHtml(author?.displayName || "Користувач")}</span><span class="fb-dot">·</span><span>${formatDate(item.createdAt)}</span></div>
            ${adminControls}
        </article>`;
}

export async function submitFeedback() {
    const title = inputValue("feedbackTitle").trim();
    if (!title) {
        toast("Потрібна назва", "Додай коротку назву ідеї або фіксу.");
        return;
    }
    const type = state.filters.feedbackType || "feature";
    const description = inputValue("feedbackDescription").trim();
    if (storage.mode === "api") {
        try {
            const created = await storage.apiClient.createFeedback({ type, title, description });
            state.database.featureRequests = [created, ...(state.database.featureRequests || [])];
            showSyncIndicator("success", "Надіслано");
        } catch (error) {
            handleUserFacingError(error, "submit-feedback");
            return;
        }
    } else {
        state.database.featureRequests = [{ id: createId("feedback"), userId: currentUser().id, type, title, description, status: "new", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, ...(state.database.featureRequests || [])];
    }
    state.filters.feedbackType = "feature";
    renderSection();
    toast("Дякуємо!", "Твій запит на дошці — адмін його побачить.");
}

export async function updateFeedbackStatus(id, status) {
    const item = (state.database.featureRequests || []).find((entry) => entry.id === id);
    if (item) {
        item.status = status;
    }
    // Targeted DOM update instead of a full re-render — re-rendering the whole
    // board recreated every author avatar <img> and made them blink.
    const statusMeta = feedbackStatuses.find((entry) => entry.key === status) || feedbackStatuses[0];
    const select = document.querySelector(`[data-action="set-feedback-status"][data-feedback-id="${id}"]`);
    const card = select ? select.closest(".fb-item") : null;
    if (card) {
        card.className = card.className.replace(/\bstatus-[\w-]+/, `status-${status}`);
        const badge = card.querySelector(".fb-status-badge");
        if (badge) {
            badge.className = `fb-status-badge status-${status}`;
            badge.textContent = statusMeta.label;
        }
    } else {
        renderSection();
    }
    if (storage.mode === "api") {
        try {
            await storage.apiClient.updateFeedbackStatus(id, status);
            showSyncIndicator("success", "Статус оновлено");
        } catch (error) {
            handleUserFacingError(error, "set-feedback-status");
        }
    }
}

export async function deleteFeedbackEntry(id) {
    if (!(await confirmDialog("Видалити цей запит?", { confirmLabel: "Видалити" }))) {
        return;
    }
    state.database.featureRequests = (state.database.featureRequests || []).filter((entry) => entry.id !== id);
    renderSection();
    if (storage.mode === "api") {
        try {
            await storage.apiClient.deleteFeedback(id);
        } catch (error) {
            handleUserFacingError(error, "delete-feedback");
        }
    }
}
