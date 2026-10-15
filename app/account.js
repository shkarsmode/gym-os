// Paywall, profile editor, bodyweight.
import { escapeHtml, dateInput } from "../lib/format.js";
import { muscles } from "../lib/constants.js";
import { storage } from "./data.js";
import { currentUser, select } from "./model.js";
import {
    closeOverlay, element, friendlyError, openConfirmOverlay, openModal, showSyncIndicator, toast
} from "./overlays.js";
import { persist } from "./persistence.js";
import { renderSection } from "./shell.js";
import { state } from "./state.js";
import { createId, inputValue, numberValue } from "./util.js";

export function openPaywallModal(context = {}) {
    const isExercise = context.type === "exercise";
    const isSuperset = context.type === "superset";
    const reason = isSuperset
        ? "Суперсети — це PRO."
        : isExercise
            ? "Ти вже додав власну вправу цього місяця."
            : (context.overDay ? "Ти вже провів тренування сьогодні." : "Ти використав 2 безкоштовні тренування цього тижня.");
    const limitsLine = isSuperset
        ? "Обʼєднуй <strong>2–3 вправи в раунди</strong> зі спільним відпочинком. Суперсети, які вже є у твоїх тренуваннях, залишаються — їх видно завжди."
        : isExercise
            ? "На безкоштовному тарифі — <strong>1 власна вправа на місяць</strong>."
            : "На безкоштовному тарифі — до <strong>1 тренування на день</strong> і <strong>2 на тиждень</strong>.";
    const title = isSuperset ? "Суперсети з PRO" : isExercise ? "Більше власних вправ із PRO" : "Більше тренувань із PRO";
    const perks = [
        ["repeat-2", "Суперсети", "2–3 вправи в раунди зі спільним відпочинком"],
        ["dumbbell", "До 2 тренувань на день", "Free — 1 на день і 2 на тиждень"],
        ["list-plus", "До 30 власних вправ", "Free — лише 1 вправа на місяць"],
        ["bar-chart-3", "Розширена аналітика", "Глибша статистика прогресу та PR"],
        ["cloud", "Пріоритетна синхронізація", "Швидші бекапи й відновлення"]
    ];
    // Stack on top if a modal is already open (e.g. day-sheet → "Почати" → quota),
    // so dismissing returns to it instead of closing everything.
    // The paywall can be raised from a sheet (the superset menu asks for PRO when the
    // rest is changed), so it has to sit above whatever asked — same reason the
    // confirm dialogs use their own level.
    const stacked = !element("modalBackdrop").classList.contains("hidden")
        || !element("modalBackdrop2").classList.contains("hidden");
    const closeAction = stacked ? "close-confirm" : "close-overlay";
    const html = `<div class="paywall">
            <div class="paywall-glow"></div>
            <button class="icon-button paywall-close" type="button" data-action="${closeAction}"><i data-lucide="x"></i></button>
            <div class="paywall-badge"><i data-lucide="zap"></i>GymOS PRO</div>
            <h2 class="paywall-title">${escapeHtml(title)}</h2>
            <p class="paywall-reason">${escapeHtml(reason)} ${limitsLine}</p>
            <div class="paywall-price"><span class="paywall-amount">$2</span><span class="paywall-period">/місяць</span></div>
            <ul class="paywall-perks">${perks.map(([icon, title, sub]) => `<li><span class="paywall-perk-icon"><i data-lucide="${icon}"></i></span><span><strong>${escapeHtml(title)}</strong><em>${escapeHtml(sub)}</em></span></li>`).join("")}</ul>
            <div class="paywall-actions"><button class="button button-primary paywall-cta" type="button" data-action="upgrade-plan"><i data-lucide="rocket"></i>Оформити PRO за $2/міс</button><button class="button button-secondary" type="button" data-action="${closeAction}">Можливо пізніше</button></div>
            <p class="paywall-foot">Оплата скоро з'явиться — зараз це прев'ю тарифу.</p>
        </div>`;
    if (stacked) {
        openConfirmOverlay(html);
    } else {
        openModal(html);
    }
}

export function showUpgradeComingSoon() {
    toast("Дякуємо за інтерес!", "Онлайн-оплата PRO скоро запрацює. Поки що це прев'ю тарифу.");
}

export function openProfileEditor() {
    const user = currentUser();
    openModal(`<div class="modal-header"><div><h2>Редагувати профіль</h2><p class="card-caption">Редагувати можна тільки профіль активного користувача.</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><div class="field-grid"><div class="field"><label>Ім'я</label><input id="profileName" type="text" value="${escapeHtml(user.name)}"></div><div class="field"><label>Публічне ім'я</label><input id="profileDisplayName" type="text" value="${escapeHtml(user.displayName)}"></div><div class="field"><label>Зріст</label><input id="profileHeight" type="number" value="${user.height}"></div><div class="field"><label>Вага тіла</label><input id="profileBodyweight" type="number" step="0.1" value="${user.bodyweight}"></div><div class="field"><label>Рік народження</label><input id="profileBirthYear" type="number" step="1" min="1920" placeholder="1998" value="${user.birthYear || ""}"></div><div class="field"><label>Тренувальна ціль</label><input id="profileGoal" type="text" value="${escapeHtml(user.trainingGoal)}"></div><div class="field"><label>Досвід</label><input id="profileExperience" type="text" value="${escapeHtml(user.trainingExperience)}"></div><div class="field"><label>Улюблена група</label>${select("profileMuscle", muscles(), user.favoriteMuscleGroup)}</div><div class="field"><label>Категорія</label><gym-select id="profileGender"><option value="male" ${user.gender === "male" ? "selected" : ""}>чоловіча</option><option value="female" ${user.gender === "female" ? "selected" : ""}>жіноча</option></gym-select></div></div><div class="field-grid" style="margin-top:14px;"><div class="field"><label>Дата заміру</label><gym-date id="bodyweightDate" value="${dateInput(new Date())}"></gym-date></div><div class="field"><label>Додати запис ваги</label><input id="bodyweightValue" type="number" step="0.1" value="${user.bodyweight}"></div></div><div class="form-actions" style="justify-content:flex-end;margin-top:16px;"><button class="button button-secondary" type="button" data-action="close-overlay">Скасувати</button><button class="button button-primary" type="button" data-action="save-profile">Зберегти профіль</button></div>`);
}

export async function saveProfile() {
    const user = currentUser();
    user.name = inputValue("profileName") || user.name;
    user.displayName = inputValue("profileDisplayName") || user.displayName;
    user.height = numberValue("profileHeight", user.height);
    user.bodyweight = numberValue("profileBodyweight", user.bodyweight);
    const birthYearInput = Math.round(numberValue("profileBirthYear", 0));
    user.birthYear = birthYearInput >= 1920 && birthYearInput <= new Date().getFullYear() ? birthYearInput : null;
    user.trainingGoal = inputValue("profileGoal") || user.trainingGoal;
    user.trainingExperience = inputValue("profileExperience") || user.trainingExperience;
    user.favoriteMuscleGroup = inputValue("profileMuscle") || user.favoriteMuscleGroup;
    user.gender = inputValue("profileGender") || user.gender;
    user.updatedAt = new Date().toISOString();
    await saveBodyweight(false);
    if (storage.mode === "api" && storage.apiClient.hasBaseUrl()) {
        showSyncIndicator("loading", "Зберігаємо профіль");
        try {
            const payload = {
                name: user.name,
                displayName: user.displayName,
                gender: user.gender === "female" ? "female" : "male",
                trainingGoal: user.trainingGoal || "",
                trainingExperience: user.trainingExperience || "",
                favoriteMuscleGroup: user.favoriteMuscleGroup || ""
            };
            if (user.height >= 80 && user.height <= 240) {
                payload.height = user.height;
            }
            if (user.bodyweight >= 20 && user.bodyweight <= 300) {
                payload.bodyweight = user.bodyweight;
            }
            if (user.birthYear) {
                payload.birthYear = user.birthYear;
            }
            await storage.apiClient.updateProfile(payload);
            showSyncIndicator("success", "Збережено");
        } catch (error) {
            showSyncIndicator("error", friendlyError(error));
            throw error;
        }
    } else {
        await persist({ silent: true });
    }
    closeOverlay();
    renderSection();
}

export async function saveBodyweight(shouldRender = true) {
    const value = numberValue("bodyweightValue", 0);
    if (!value) {
        return;
    }
    const date = inputValue("bodyweightDate") || dateInput(new Date());
    state.database.bodyweightEntries.push({ id: createId("bodyweight"), userId: currentUser().id, date, bodyweight: value, notes: "Ручний запис" });
    currentUser().bodyweight = value;
    if (storage.mode === "api" && storage.apiClient.hasBaseUrl() && value >= 20 && value <= 300) {
        try {
            await storage.apiClient.createBodyweight({ date, bodyweight: value, notes: "Ручний запис" });
        } catch (error) {
            console.error(error);
        }
    }
    if (shouldRender) {
        if (storage.mode !== "api") {
            await persist({ silent: true });
        }
        closeOverlay();
        renderSection();
    }
}
