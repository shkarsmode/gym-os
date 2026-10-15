// Notification permission, user approval, backend / data-mode actions, Google login.
import { initialize } from "./boot.js";
import { storage } from "./data.js";
import { currentUser, dataModeLabel, isAdmin, userById } from "./model.js";
import { friendlyError, showSyncIndicator, toast } from "./overlays.js";
import { renderAuthGate, renderSection } from "./shell.js";
import { startTimer } from "./timer.js";

export function requestNotifications() {
    if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
    }
    startTimer(10);
    toast("Таймер запущено", "10-секундний тест таймера відпочинку.");
}

export async function setUserApproval(userId, approved) {
    if (!isAdmin()) {
        toast("Немає прав", "Лише адміністратор може підтверджувати користувачів.");
        return;
    }
    try {
        await storage.apiClient.setUserApproval(userId, approved);
        const targetUser = userById(userId);
        if (targetUser) {
            targetUser.approved = approved;
        }
        renderSection();
        toast(approved ? "Користувача підтверджено" : "Доступ відкликано", targetUser?.displayName || "");
    } catch (error) {
        showSyncIndicator("error", friendlyError(error));
    }
}

export async function checkBackendConnection() {
    try {
        await storage.checkBackend(true);
        await storage.refreshCurrentUser(false);
        toast("Бекенд доступний", storage.apiBaseUrl || "API URL активний.");
    } catch (error) {
        toast("Бекенд недоступний", storage.config.allowLocalFallback === false ? "Перевір deployment і env variables." : "Застосунок залишився в локальному деморежимі.");
        if (storage.config.allowLocalFallback !== false) {
            await storage.setMode("local");
        }
    }
    if (storage.requiresAuthentication()) {
        renderAuthGate();
        return;
    }
    // Reachable from renderLoadFailure, which leaves state.database empty. A bare
    // renderSection() there hits renderMobileNavigation -> currentUser().id and
    // throws on undefined, so re-run boot instead of painting an empty shell.
    if (!currentUser()) {
        await initialize();
        return;
    }
    renderSection();
}

export async function changeDataMode(mode) {
    await storage.setMode(mode);
    if (mode === "api" && storage.backendStatus !== "online") {
        toast("Бекенд недоступний", "Повертаю демо у локальний режим.");
        await storage.setMode("local");
    } else {
        toast("Режим даних змінено", dataModeLabel(storage.mode));
    }
    renderSection();
}

export async function updateApiBaseUrl(value) {
    await storage.setApiBaseUrl(value);
}

export function loginWithGoogle() {
    try {
        storage.loginWithGoogle();
    } catch (error) {
        toast("API URL не налаштовано", "Додай backend URL у налаштуваннях перед Google OAuth.");
    }
}
