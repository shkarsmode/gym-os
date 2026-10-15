// Settings (UI kit + screen), changelog, subscription, sidebar state.
import { escapeHtml, formatDate } from "../lib/format.js";
import { setTypeLabels, workoutTypeLabels } from "../lib/constants.js";
import { APP_VERSION, CHANGELOG, changelogTagLabels, changelogTagIcons } from "../lib/changelog.js";
import { pushSettingsSection } from "./feed.js";
import { adminEmails, currentUser, hasUnlimited, isAdmin } from "./model.js";
import { content, element, openModal } from "./overlays.js";
import { getPref } from "./prefs.js";
import { privacySettingsCard } from "./privacy.js";
import { formatDurationLabel } from "./supersets.js";
import { icons } from "./util.js";

// ---- Settings UI kit -------------------------------------------------------------
//
// One row shape for the whole screen: a label (with an optional line of explanation)
// on the left, its control on the right. Before this the page was eight cards of five
// different shapes — three of which existed to hold a single button — and nothing
// lined up with anything. Grouped rows are what a settings screen is everywhere else,
// and the reason is that they can be SCANNED: the eye runs down one column of names.

/**
 * @param {{hint?: string, stacked?: boolean, danger?: boolean}} options
 *
 * `stacked` drops the control onto its own line. Needed for anything wide — the five
 * accent swatches cannot share a row with their label on a phone without either
 * squashing the label to nothing or scrolling sideways.
 */
export function settingsRow(label, control, options = {}) {
    const classes = ["settings-row"];
    if (options.stacked) {
        classes.push("is-stacked");
    }
    if (options.danger) {
        classes.push("is-danger");
    }
    return `<div class="${classes.join(" ")}">
            <div class="settings-row-text"><strong>${escapeHtml(label)}</strong>${options.hint ? `<span>${escapeHtml(options.hint)}</span>` : ""}</div>
            <div class="settings-row-control">${control}</div>
        </div>`;
}

/** A boolean preference: one switch, not two buttons the width of the row. */
const ACCENT_CHOICES = [
    ["mint", "Mint", "#34d399"],
    ["blue", "Blue", "#3b82f6"],
    ["purple", "Purple", "#a78bfa"],
    ["amber", "Amber", "#f59e0b"],
    ["red", "Red", "#f43f5e"]
];

// `on` overrides the stored value, for a caller that knows the switch's state better than
// getPref alone (a pref whose default is decided elsewhere).
export function settingsSwitch(pref, label, on = getPref(pref) === "1") {
    return `<label class="settings-switch"><input type="checkbox" data-action="set-pref-switch" data-pref="${pref}" ${on ? "checked" : ""} aria-label="${escapeHtml(label)}"><span></span></label>`;
}

/**
 * Colour is picked by looking at colours.
 *
 * The accent used to be five named text pills, which is both wider than any phone row
 * and the wrong control entirely — nobody chooses "Amber" by reading the word.
 */
function settingsSwatches(pref, options) {
    const current = getPref(pref);
    return `<div class="settings-swatches" role="radiogroup" aria-label="Акцент">${options.map(([value, label, color]) =>
        `<button class="settings-swatch${current === value ? " active" : ""}" type="button" role="radio" aria-checked="${current === value}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" data-action="set-pref" data-pref="${pref}" data-value="${value}" style="--swatch:${color};"></button>`).join("")}</div>`;
}

export function settingsGroup(title, rows, options = {}) {
    return `<section class="settings-group${options.wide ? " span-12" : " span-6"}">
            <header class="settings-group-head"><h2>${escapeHtml(title)}</h2>${options.caption ? `<p class="card-caption">${escapeHtml(options.caption)}</p>` : ""}</header>
            <div class="settings-list">${rows.filter(Boolean).join("")}</div>
            ${options.footer || ""}
        </section>`;
}

export function settings() {
    const seg = (pref, value, label, extra = "") => `<button class="segment-button ${getPref(pref) === value ? "active" : ""}" type="button" data-action="set-pref" data-pref="${pref}" data-value="${value}">${extra}${escapeHtml(label)}</button>`;
    const themeButtons = [["system", "System"], ["dark", "Dark"], ["blackout", "Blackout"]].map(([value, label]) => seg("theme", value, label)).join("");

    const restOptions = [45, 60, 75, 90, 120, 150, 180].map((rest) => `<option value="${rest}" ${getPref("defaultRest") === String(rest) ? "selected" : ""}>${rest} сек</option>`).join("");
    const workoutTypeOptions = Object.entries(workoutTypeLabels).map(([value, label]) => `<option value="${value}" ${getPref("defaultWorkoutType") === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
    const setTypeOptions = Object.entries(setTypeLabels).map(([value, label]) => `<option value="${value}" ${getPref("defaultSetType") === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
    const durationDefaultOptions = `<option value="auto" ${getPref("defaultDuration") === "auto" ? "selected" : ""}>Авто (за часом)</option>` + [15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 210, 240].map((min) => `<option value="${min}" ${getPref("defaultDuration") === String(min) ? "selected" : ""}>${formatDurationLabel(min)}</option>`).join("");
    const appearanceGroup = settingsGroup("Вигляд", [
        settingsRow("Тема", `<div class="segmented settings-seg">${themeButtons}</div>`),
        settingsRow("Акцент", settingsSwatches("accent", ACCENT_CHOICES)),
        settingsRow("Компактні картки", settingsSwitch("compactCards", "Компактні картки"), { hint: "Вміщують більше на екран" })
    ]);

    const workoutGroup = settingsGroup("Тренування за замовчуванням", [
        settingsRow("Відпочинок між підходами", `<gym-select data-action="set-pref-select" data-pref="defaultRest">${restOptions}</gym-select>`),
        settingsRow("Тип тренування", `<gym-select data-action="set-pref-select" data-pref="defaultWorkoutType">${workoutTypeOptions}</gym-select>`),
        settingsRow("Тип першого підходу", `<gym-select data-action="set-pref-select" data-pref="defaultSetType">${setTypeOptions}</gym-select>`),
        settingsRow("Тривалість", `<gym-select data-action="set-pref-select" data-pref="defaultDuration">${durationDefaultOptions}</gym-select>`),
        settingsRow("Екран не гасне", settingsSwitch("keepAwake", "Тримати екран увімкненим під час тренування"), { hint: "Поки тренування активне. Після «Завершити» відпускається" }),
        settingsRow("Авто-старт таймера", settingsSwitch("autoStartRest", "Авто-старт таймера відпочинку"), { hint: "Щойно позначив підхід" }),
        settingsRow("Суперсети", settingsSwitch("useSupersets", "Використовую суперсети"), { hint: "Обʼєднувати 2–3 вправи в раунди" })
    ]);

    // The three one-button cards were a card each for a single line. As rows they are
    // three lines of one group, and the page stops looking like scattered leftovers.
    const dataGroup = settingsGroup("Дані", [
        settingsRow("Експорт JSON", `<button class="button button-secondary compact" type="button" data-action="export-data"><i data-lucide="download"></i>Завантажити</button>`, { hint: "Тренування, заміри, власні вправи" }),
        settingsRow("Власна вправа", `<button class="button button-secondary compact" type="button" data-action="open-custom-exercise"><i data-lucide="plus"></i>Додати</button>`, { hint: "Зберігається за тобою" })
    ]);

    const accountGroup = settingsGroup("Акаунт", [
        settingsRow("Версія", `<span class="settings-value">v${APP_VERSION}</span>`, { hint: "GymOS" }),
        settingsRow("Вийти з акаунта", `<button class="button button-danger compact" type="button" data-action="logout"><i data-lucide="log-out"></i>Вийти</button>`, { danger: true })
    ]);

    content(`<div class="grid dashboard-grid settings-page">${appearanceGroup}${workoutGroup}${privacySettingsCard()}${pushSettingsSection()}${dataGroup}${accountGroup}</div>`);
}

export function changelog() {
    content(`<section class="card"><div class="card-header"><div class="head-dup"><h2>Що нового</h2><p class="card-caption">Останні зміни, фічі та виправлення GymOS</p></div><span class="role-badge admin"><i data-lucide="sparkles"></i>v${escapeHtml(APP_VERSION)}</span></div><div class="timeline">${CHANGELOG.map(changelogEntry).join("")}</div></section>`);
}

function changelogEntry(entry) {
    return `<article class="timeline-entry"><div class="timeline-rail"><span class="timeline-dot"></span></div><div class="timeline-card"><div class="timeline-head"><span class="timeline-version">v${escapeHtml(entry.version)}</span><span class="timeline-date">${formatDate(entry.date)}</span></div><h3 class="timeline-title">${escapeHtml(entry.title)}</h3><ul class="timeline-items">${entry.items.map((item) => `<li><span class="cl-tag ${item.type}" title="${escapeHtml(changelogTagLabels[item.type] || item.type)}" aria-label="${escapeHtml(changelogTagLabels[item.type] || item.type)}"><i data-lucide="${changelogTagIcons[item.type] || "tag"}"></i></span><span>${escapeHtml(item.text)}</span></li>`).join("")}</ul></div></article>`;
}

export function maybeShowWhatsNew() {
    try {
        const key = "gymos-last-seen-version";
        const seen = localStorage.getItem(key);
        if (seen === APP_VERSION) {
            return;
        }
        localStorage.setItem(key, APP_VERSION);
        if (!seen) {
            return; // first-ever load — don't interrupt onboarding
        }
        const latest = CHANGELOG[0];
        openModal(`<div class="modal-header"><div><h2>Що нового · v${escapeHtml(APP_VERSION)}</h2><p class="card-caption">${escapeHtml(latest.title)}</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><ul class="whatsnew-list">${latest.items.map((item) => `<li><span class="cl-tag ${item.type}" title="${escapeHtml(changelogTagLabels[item.type] || item.type)}" aria-label="${escapeHtml(changelogTagLabels[item.type] || item.type)}"><i data-lucide="${changelogTagIcons[item.type] || "tag"}"></i></span><span>${escapeHtml(item.text)}</span></li>`).join("")}</ul><div class="form-actions" style="justify-content:space-between;margin-top:18px;"><button class="button button-secondary" type="button" data-action="open-changelog">Усі зміни</button><button class="button button-primary" type="button" data-action="close-overlay"><i data-lucide="check"></i>Круто!</button></div>`);
        icons();
    } catch (error) {
        // localStorage may be unavailable; ignore.
    }
}

export function roleStatusBadge(user) {
    const isSuper = Boolean(user?.isSuperAdmin) || adminEmails.has(String(user?.email || "").toLowerCase());
    const role = isSuper ? "admin" : String(user?.role || "free").toLowerCase();
    if (role !== "admin" && role !== "premium") {
        return "";
    }
    // Only the current user's own badge is a link to Підписка — on other members'
    // cards/rows it must stay inert so it doesn't hijack their open-profile click.
    const me = currentUser();
    const link = Boolean(me && user && user.id === me.id);
    const cls = `role-badge ${role}${link ? " role-badge-link" : ""}`;
    const dataAttrs = link ? ` data-action="navigate" data-section="subscription" title="Підписка"` : "";
    const icon = role === "admin" ? "shield" : "crown";
    const label = role === "admin" ? "Адмін" : "PRO";
    return `<span class="${cls}"${dataAttrs}><i data-lucide="${icon}"></i>${label}</span>`;
}

export function subscription() {
    const admin = isAdmin();
    const isPro = hasUnlimited();
    const planKey = admin ? "admin" : (isPro ? "pro" : "free");
    const planLabel = admin ? "Адмін" : (isPro ? "PRO" : "Free");
    const heroNote = admin
        ? "У тебе повний доступ адміністратора."
        : (isPro ? "Дякуємо! Активний PRO — безліміт у всьому." : "Ти на безкоштовному тарифі. Прокачайся до PRO за $2/міс.");
    const freeFeatures = [
        ["dumbbell", "1 тренування/день, 2 на поточний тиждень"],
        ["calendar-x", "Тренування лише в межах поточного тижня"],
        ["list-plus", "1 власна вправа на місяць"],
        ["bar-chart-3", "Базова статистика"],
        ["users", "Команда, рейтинги, календар"]
    ];
    const proFeatures = [
        ["dumbbell", "До 2 тренувань на день"],
        ["sparkles", "AI-тренування голосом або текстом — 3 на день"],
        ["calendar-days", "Минулий, поточний і наступний тиждень (5 / 6 / 5)"],
        ["list-plus", "До 30 власних вправ"],
        ["lightbulb", "До 3 запитів-ідей на день"],
        ["bar-chart-3", "Розширена аналітика й прогрес"],
        ["history", "Повна історія тренувань"],
        ["download", "Експорт даних (CSV / PDF)"],
        ["crown", "Бейдж PRO у команді й рейтингу"],
        ["heart", "Підтримка розробки 💚"]
    ];
    const cmp = [
        ["Тренувань на день", "1", "2"],
        ["Тижні для тренувань", "поточний", "мин. + поточ. + наст."],
        ["Тренувань на тиждень (мин / пот / наст)", "— / 2 / —", "5 / 6 / 5"],
        ["Власні вправи", "1 / міс", "до 30"],
        ["AI-тренування (на день)", false, "3"],
        ["Запитів-ідей на день", "1", "3"],
        ["Розширена аналітика", false, true],
        ["Повна історія тренувань", false, true],
        ["Експорт даних", false, true],
        ["Бейдж PRO статусу", false, true]
    ];
    const cmpCell = (value) => value === true
        ? `<i data-lucide="check" class="cmp-yes"></i>`
        : (value === false ? `<i data-lucide="x" class="cmp-no"></i>` : `<span>${escapeHtml(String(value))}</span>`);
    const proCta = isPro
        ? `<button class="button button-secondary" type="button" disabled><i data-lucide="check-circle-2"></i>Активно</button>`
        : `<button class="button button-primary paywall-cta" type="button" data-action="upgrade-plan"><i data-lucide="rocket"></i>Оформити PRO — $2/міс</button>`;
    content(`<div class="grid dashboard-grid">
            <section class="card span-12 sub-hero"><div class="sub-hero-glow"></div><div class="sub-hero-row"><div class="sub-hero-info"><p class="card-caption">Твій тариф</p><h2 class="sub-hero-plan">${escapeHtml(planLabel)}</h2><p class="card-caption">${escapeHtml(heroNote)}</p></div>${isPro
            ? `<span class="role-badge ${admin ? "admin" : "premium"} sub-hero-badge"><i data-lucide="${admin ? "shield" : "crown"}"></i>${admin ? "Адмін" : "PRO"}</span>`
            : `<button class="button button-primary paywall-cta" type="button" data-action="upgrade-plan"><i data-lucide="rocket"></i>Апгрейд до PRO</button>`}</div></section>
            <section class="plan-card free span-6 ${planKey === "free" ? "current" : ""}"><div class="plan-head"><h3>Free</h3><div class="plan-price"><span class="plan-amount">$0</span></div></div><p class="card-caption">Базовий доступ для старту.</p><ul class="plan-features">${freeFeatures.map(([icon, text]) => `<li><i data-lucide="${icon}"></i><span>${escapeHtml(text)}</span></li>`).join("")}</ul>${planKey === "free" ? `<div class="plan-current-tag">Поточний план</div>` : ""}</section>
            <section class="plan-card pro span-6 ${isPro ? "current" : ""}"><div class="plan-glow"></div><div class="plan-head"><h3><i data-lucide="crown"></i>PRO</h3><div class="plan-price"><span class="plan-amount">$2</span><span class="plan-period">/міс</span></div></div><p class="card-caption">Безліміт і всі можливості GymOS.</p><ul class="plan-features">${proFeatures.map(([icon, text]) => `<li><i data-lucide="${icon}"></i><span>${escapeHtml(text)}</span></li>`).join("")}</ul>${proCta}</section>
            <section class="card span-12"><div class="card-header"><div><h2>Порівняння тарифів</h2><p class="card-caption">Що входить у кожен тариф.</p></div></div><div class="table-wrap"><table class="cmp-table"><thead><tr><th>Можливість</th><th>Free</th><th class="cmp-pro-col">PRO</th></tr></thead><tbody>${cmp.map((row) => `<tr><td>${escapeHtml(row[0])}</td><td class="cmp-free">${cmpCell(row[1])}</td><td class="cmp-pro-col">${cmpCell(row[2])}</td></tr>`).join("")}</tbody></table></div><p class="card-caption cmp-admin-note"><i data-lucide="shield"></i>Адмін — без обмежень за датою та кількістю тренувань.</p></section>
            <p class="card-caption sub-foot">Онлайн-оплата скоро запрацює — зараз це прев'ю тарифу PRO.</p>
        </div>`);
}

export function applySidebarState() {
    let collapsed = false;
    try {
        collapsed = localStorage.getItem("gymos-sidebar-collapsed") === "1";
    } catch (error) {
        collapsed = false;
    }
    const shell = document.querySelector(".app-shell");
    if (shell) {
        shell.classList.toggle("sidebar-collapsed", collapsed);
    }
    const button = element("sidebarCollapseButton");
    if (button) {
        button.innerHTML = `<i data-lucide="${collapsed ? "panel-left-open" : "panel-left-close"}"></i>`;
        button.setAttribute("aria-label", collapsed ? "Розгорнути меню" : "Згорнути меню");
        button.setAttribute("title", collapsed ? "Розгорнути меню" : "Згорнути меню");
        icons();
    }
}

export function toggleSidebar() {
    let collapsed = false;
    try {
        collapsed = localStorage.getItem("gymos-sidebar-collapsed") === "1";
        localStorage.setItem("gymos-sidebar-collapsed", collapsed ? "0" : "1");
    } catch (error) {
        // localStorage unavailable — fall back to a one-off DOM toggle.
        const shell = document.querySelector(".app-shell");
        if (shell) {
            shell.classList.toggle("sidebar-collapsed");
        }
        return;
    }
    applySidebarState();
}
