// Impersonation, logout, data export / import, catalogue reset, profile menu, achievement badges.
import { escapeHtml, dateInput } from "../lib/format.js";
import { APP_VERSION } from "../lib/changelog.js";
import { loadDatabaseOrThrow } from "./boot.js";
import { storage } from "./data.js";
import { stopLiveStream } from "./live.js";
import { currentUser, userById } from "./model.js";
import {
    confirmDialog, friendlyError, hideBusyOverlay, resourceLabel, showBusyOverlay, toast, updateBusyOverlay
} from "./overlays.js";
import { persist } from "./persistence.js";
import { userAchievements } from "./progression.js";
import {
    createEmptyDatabase, createExercises, createSeedDatabase, createStandards, mergeImportedExerciseCatalog
} from "./seed.js";
import { ux2MenuItem } from "./sheets.js";
import { renderAuthGate, renderLoadFailure, renderSection, renderShell } from "./shell.js";
import { state } from "./state.js";
import { iconsIn } from "./util.js";

// ---- Admin impersonation ("увійти як користувач") --------------------------
// Owner-only support tool. The button only exists when the SERVER says this
// account may impersonate (`canImpersonate` from /auth/me) — the frontend never
// decides that itself, and the backend re-checks on every call.
export function impersonateButton(user, isCurrent) {
    if (!storage.canImpersonate || isCurrent || storage.impersonation) {
        return "";
    }
    return `<button class="button button-impersonate compact" type="button" data-action="impersonate-user" data-user-id="${user.id}"><i data-lucide="user-round-cog"></i>Увійти як ${escapeHtml(user.displayName)}</button>`;
}

export async function impersonateUser(userId) {
    const target = userById(userId);
    const name = target ? target.displayName : "користувача";
    const confirmed = await confirmDialog(
        `Далі ти працюєш у акаунті «${name}»: усе, що зробиш, буде від його імені. Вийти можна в будь-який момент кнопкою у верхній смузі.`,
        { title: `Увійти як ${name}?`, confirmLabel: "Увійти в акаунт", danger: false }
    );
    if (!confirmed) {
        return;
    }
    try {
        const result = await storage.apiClient.impersonate(userId);
        // Bearer copy for iOS Safari, which drops the cross-site session cookie.
        if (result && result.token) {
            try {
                localStorage.setItem("gymos-auth-token", result.token);
            } catch (error) {
                // cookie-only session still works everywhere else
            }
        }
        // Full reload: every cache, list and computed score in memory belongs to
        // the previous account. Re-booting is the only honest way to swap identity.
        location.hash = "";
        location.reload();
    } catch (error) {
        toast("Не вдалося увійти", friendlyError(error));
    }
}

export async function stopImpersonation() {
    try {
        const result = await storage.apiClient.stopImpersonation();
        if (result && result.token) {
            try {
                localStorage.setItem("gymos-auth-token", result.token);
            } catch (error) {
                // cookie-only session still works everywhere else
            }
        }
    } catch (error) {
        // Reload regardless: an expired or already-ended impersonation must never
        // leave the admin stuck inside someone else's account.
        toast("Сесію завершено", friendlyError(error));
    }
    location.hash = "#/users";
    location.reload();
}

// Persistent, unmissable warning while impersonating. Lives as the first row of
// the app-shell grid (spanning both columns) so it never fights the sticky topbar
// or the mobile bottom nav — it simply sits above everything and sticks.
export function renderImpersonationBar() {
    const shell = document.querySelector(".app-shell");
    const active = storage.impersonation;
    let bar = document.getElementById("impersonationBar");
    document.body.classList.toggle("is-impersonating", Boolean(active));
    if (!active || !shell) {
        if (bar) {
            bar.remove();
        }
        return;
    }
    const name = (storage.currentUser && storage.currentUser.displayName) || currentUser()?.displayName || "користувач";
    if (!bar) {
        bar = document.createElement("div");
        bar.id = "impersonationBar";
        bar.className = "imp-bar";
        bar.setAttribute("role", "status");
        shell.prepend(bar);
    }
    if (bar.dataset.sig !== name) {
        bar.dataset.sig = name;
        bar.innerHTML = `<span class="imp-ico" aria-hidden="true"><i data-lucide="shield-alert"></i></span>
                <span class="imp-text"><strong>Ти в акаунті ${escapeHtml(name)}</strong><span class="imp-sub">Режим адміна — усі дії від його імені</span></span>
                <button class="button imp-exit compact" type="button" data-action="stop-impersonation"><i data-lucide="log-out"></i><span>Вийти</span></button>`;
        iconsIn(bar);
    }
    // The sticky topbar/sidebar sit exactly below the bar. Publish its MEASURED
    // height (content + safe area) instead of trusting a hardcoded one, or a
    // taller line wrap silently slides the topbar underneath it.
    document.documentElement.style.setProperty("--imp-offset", `${bar.offsetHeight}px`);
}

export async function logout() {
    // Close the stream before the token goes: it is a long-lived authenticated
    // request, and leaving it open would keep delivering this account's events into
    // a tab that has already signed out.
    stopLiveStream();
    try {
        localStorage.removeItem("gymos-auth-token");
    } catch (error) {
        console.warn("Token clear failed", error);
    }
    try {
        await storage.logout();
    } catch (error) {
        toast("Бекенд недоступний", "Локальний деморежим продовжує працювати.");
    }
    if (storage.config.requireAuth) {
        state.database = createEmptyDatabase();
        renderAuthGate();
    }
}

export function exportData() {
    const blob = new Blob([JSON.stringify(state.database, null, 4)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `gymos-export-${dateInput(new Date())}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast("Дані експортовано", "JSON-файл завантажено.");
}

export async function importData(file) {
    if (!file) {
        return;
    }

    let overlay = null;
    try {
        const data = JSON.parse(await file.text());
        // strengthStandards is no longer part of the export payload (regenerated
        // client-side on demand), so it isn't required for a valid import.
        ["users", "exercises", "workouts", "bodyweightEntries"].forEach((key) => {
            if (!Array.isArray(data[key])) {
                throw new Error(`Missing ${key}`);
            }
        });

        if (storage.mode === "api") {
            overlay = showBusyOverlay({
                title: "Імпорт даних",
                message: "Готуємо безпечну передачу у backend.",
                detail: "Глобальний каталог не відправляється повторно.",
                progress: 0
            });
            const result = await storage.importUserData(data, {
                onProgress: (progress) => {
                    updateBusyOverlay(overlay, {
                        message: `Відправляємо ${resourceLabel(progress.resource)}.`,
                        detail: `Пачка ${progress.current}/${progress.total}. Елементів у пачці: ${progress.items}.`,
                        progress: progress.total ? Math.round((progress.current / progress.total) * 100) : 100
                    });
                }
            });
            updateBusyOverlay(overlay, {
                message: "Оновлюємо дані з backend.",
                detail: "Фінальна перевірка після імпорту.",
                progress: 100
            });
            state.database = await loadDatabaseOrThrow();
            state.profileUserId = state.database.currentUserId;
    // Seeded from every payload install: null under the legacy shape (all history is
    // already present), a cursor under the windowed one.
    state.workoutsCursor = state.database.workoutsCursor || null;
            renderShell();
            renderSection();
            toast("Дані імпортовано", `Тренувань: ${result.imported.workouts}, замірів ваги: ${result.imported.bodyweightEntries}.`);
            return;
        }

        state.database = data;
        state.profileUserId = data.currentUserId;
        await persist();
        renderSection();
        toast("Дані імпортовано", "Локальну базу оновлено.");
    } catch (error) {
        console.error(error);
        toast("Імпорт не вдався", "JSON-структура не підходить для GymOS.");
    } finally {
        hideBusyOverlay(overlay);
    }
}

export async function importExerciseCatalog(file) {
    if (!file) {
        return;
    }

    let overlay = null;
    try {
        const data = JSON.parse(await file.text());

        if (storage.mode === "api") {
            overlay = showBusyOverlay({
                title: "Імпорт каталогу вправ",
                message: "Розбиваємо JSON на маленькі пачки.",
                detail: "ExRx media лишаються reference-only, без hotlink у production.",
                progress: 0
            });

            const result = await storage.importExerciseCatalog(data, {
                onProgress: (progress) => {
                    console.log(
                        `Exercise catalog import ${progress.current}/${progress.total}`,
                        progress
                    );
                    updateBusyOverlay(overlay, {
                        message: "Відправляємо каталог у backend.",
                        detail: `Пачка ${progress.current}/${progress.total}. Вправ у пачці: ${progress.exercises}.`,
                        progress: progress.total ? Math.round((progress.current / progress.total) * 100) : 100
                    });
                }
            });

            updateBusyOverlay(overlay, {
                message: "Оновлюємо каталог з backend.",
                detail: "Завантажуємо актуальний список вправ.",
                progress: 100
            });
            state.database = await loadDatabaseOrThrow();

            toast(
                "Каталог імпортовано",
                `Отримано: ${result.received}, додано: ${result.imported}, пропущено: ${result.skipped}.`
            );
        } else {
            const result = mergeImportedExerciseCatalog(state.database.exercises, data);
            state.database.exercises = result.exercises;
            await persist();
            toast("Каталог імпортовано", `Додано: ${result.imported}, пропущено: ${result.skipped}.`);
        }

        renderSection();
    } catch (error) {
        console.error(error);
        toast("Імпорт каталогу не вдався", "Перевір JSON, авторизацію або розмір payload.");
    } finally {
        hideBusyOverlay(overlay);
    }
}

export async function resetCuratedExercises() {
    if (!(await confirmDialog("Залишити тільки жим лежачи і тягу верхнього блока? Залежні зв'язки зі старими вправами будуть очищені.", { confirmLabel: "Очистити" }))) {
        return;
    }

    let overlay = null;
    try {
        overlay = showBusyOverlay({
            title: "Очищення каталогу",
            message: "Залишаємо curated-набір вправ.",
            detail: "Жим лежачи і тяга верхнього блока будуть доступні всім користувачам.",
            progress: 25
        });

        if (storage.mode === "api") {
            await storage.resetCuratedExercises();
            updateBusyOverlay(overlay, {
                message: "Перечитуємо backend.",
                detail: "Оновлюємо каталог і пов'язані тренування.",
                progress: 85
            });
            state.database = await loadDatabaseOrThrow();
        } else {
            const curatedExercises = createExercises();
            const curatedIds = new Set(curatedExercises.map((exercise) => exercise.id));
            state.database.exercises = curatedExercises;
            state.database.strengthStandards = createStandards(curatedExercises);
            state.database.workouts.forEach((workoutItem) => {
                workoutItem.exercises = workoutItem.exercises.filter((workoutExercise) => curatedIds.has(workoutExercise.exerciseId));
            });
            await persist();
        }

        updateBusyOverlay(overlay, {
            message: "Каталог оновлено.",
            detail: "Зайві вправи прибрані з інтерфейсу.",
            progress: 100
        });
        renderShell();
        renderSection();
        toast("Каталог очищено", "Залишено жим лежачи і тягу верхнього блока.");
    } finally {
        hideBusyOverlay(overlay);
    }
}

export async function resetData() {
    if (!(await confirmDialog(storage.mode === "api" ? "Очистити локальний кеш і перечитати дані з backend?" : "Скинути всі локальні demo data?", { confirmLabel: "Скинути" }))) {
        return;
    }
    await storage.reset();
    if (storage.mode === "api") {
        // Not inside a try elsewhere in this function: loadDatabaseOrThrow now
        // throws on a bad payload, and an unhandled rejection here would leave the
        // user staring at a stale screen with no explanation.
        try {
            state.database = await loadDatabaseOrThrow();
        } catch (error) {
            console.error(error);
            renderLoadFailure(friendlyError(error));
            return;
        }
        state.profileUserId = state.database.currentUserId;
    // Seeded from every payload install: null under the legacy shape (all history is
    // already present), a cursor under the windowed one.
    state.workoutsCursor = state.database.workoutsCursor || null;
        renderShell();
        renderSection();
        toast("Кеш очищено", "Дані перечитано з backend.");
        return;
    }
    state.database = createSeedDatabase();
    state.profileUserId = state.database.currentUserId;
    // Seeded from every payload install: null under the legacy shape (all history is
    // already present), a cursor under the windowed one.
    state.workoutsCursor = state.database.workoutsCursor || null;
    await persist();
    renderSection();
    toast("Демодані скинуто", "Створено свіжу локальну базу.");
}

// Subtle "?" trigger that opens a delayed, JS-positioned tooltip (see
// setupTooltips). Text lives in escaped data-attributes; no markup needed.
export function infoTip(title, body) {
    return `<button class="info-tip" type="button" tabindex="0" aria-label="${escapeHtml(title)}: пояснення" data-tip-title="${escapeHtml(title)}" data-tip-body="${escapeHtml(body)}"><i data-lucide="info"></i></button>`;
}

// Card <h2> heading with an optional inline info trigger next to it.
export function sectionHeading(title, tip) {
    return `<div class="section-heading"><h2>${escapeHtml(title)}</h2>${tip ? infoTip(title, tip) : ""}</div>`;
}

// A row of gold achievement icons (unlocked only, no captions) so anyone opening
// a profile can see what the person earned. Each icon is a tooltip trigger
// (title + caption) via the shared [data-tip-body] engine.
export function profileMenu(user, info) {
    const achievements = userAchievements(user.id);
    const unlocked = achievements.filter((achievement) => achievement.unlockedAt).length;
    return `<div class="ux2-menu profile-menu">
            ${ux2MenuItem("open-profile-editor", "pen-line", "Редагувати профіль", "", { hint: "Ім'я, фото, зріст, вага, ціль", chevron: true })}
            ${ux2MenuItem("navigate", "medal", "Прокачка", ` data-section="levels"`, { value: `Рівень ${info.level}`, chevron: true })}
            ${ux2MenuItem("navigate", "trophy", "Досягнення", ` data-section="levels"`, { value: `${unlocked} з ${achievements.length}`, chevron: true })}
            ${ux2MenuItem("navigate", "settings", "Налаштування", ` data-section="settings"`, { chevron: true })}
            ${ux2MenuItem("navigate", "sparkles", "Що нового", ` data-section="changelog"`, { value: `v${APP_VERSION}`, chevron: true })}
            ${ux2MenuItem("open-onboarding", "hand-metal", "Знайомство", "", { hint: "Пройти питання про себе ще раз", chevron: true })}
        </div>`;
}

export function achievementBadges(userId) {
    // Most recently unlocked first, so the freshest achievements lead the row.
    const unlocked = userAchievements(userId)
        .filter((achievement) => achievement.unlockedAt)
        .sort((left, right) => new Date(right.unlockedAt) - new Date(left.unlockedAt));
    if (!unlocked.length) {
        return "";
    }
    return `<div class="ach-badge-row" role="list" aria-label="Досягнення">${unlocked.map((achievement) => `<button class="ach-badge" type="button" role="listitem" tabindex="0" data-tip-title="${escapeHtml(achievement.title)}" data-tip-body="${escapeHtml(achievement.caption)} · +${achievement.xp} XP" aria-label="${escapeHtml(achievement.title)}"><i data-lucide="${achievement.icon}"></i></button>`).join("")}</div>`;
}
