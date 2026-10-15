// AI usage statistics (admin).
import { escapeHtml, number, formatDate, shortDate } from "../lib/format.js";
import { emptyInline, metric } from "./components.js";
import { storage } from "./data.js";
import { isAdmin } from "./model.js";
import { content, element, friendlyError } from "./overlays.js";
import { defaultSection } from "./router.js";
import { renderSection } from "./shell.js";
import { state } from "./state.js";
import { iconsIn } from "./util.js";
import { lineChart } from "./workout-history.js";

// ===== end AI-тренування ====================================================

// ===== AI статистика (admin-only) ===========================================
const aiStatsState = {
    loading: false,
    error: null,
    summary: null,
    usage: null,
    requests: null,
    limits: null,
    filters: { period: "30d", status: "all", model: "", userId: "" }
};

export function aiStats() {
    if (!isAdmin()) {
        state.section = defaultSection();
        renderSection();
        return;
    }
    content(`<div class="ai-stats-page">
            <div class="ai-stats-header">
                <div><p class="eyebrow">AI</p><h2>AI статистика</h2><p class="card-caption">Використання Gemini у GymOS: запити, токени, помилки й ліміти.</p></div>
                <button class="button button-secondary compact" type="button" data-action="ai-stats-refresh"><i data-lucide="refresh-cw"></i>Оновити</button>
            </div>
            ${aiStatsFilters()}
            <div id="aiStatsBody">${aiStatsBodyContent()}</div>
        </div>`);
    loadAiStats();
}

function aiStatsFilters() {
    const periods = [["today", "Сьогодні"], ["7d", "7 днів"], ["30d", "30 днів"], ["all", "Весь час"]];
    const models = (aiStatsState.summary && aiStatsState.summary.models) || [];
    return `<div class="ai-stats-filters">
            <div class="ai-stats-periods">${periods.map(([value, label]) => `<button class="segment-button ${aiStatsState.filters.period === value ? "active" : ""}" type="button" data-action="ai-stats-period" data-period="${value}">${label}</button>`).join("")}</div>
            <div class="ai-stats-selects">
                <gym-select data-action="ai-stats-filter" data-filter="status"><option value="all" ${aiStatsState.filters.status === "all" ? "selected" : ""}>Усі статуси</option><option value="success" ${aiStatsState.filters.status === "success" ? "selected" : ""}>Успішні</option><option value="error" ${aiStatsState.filters.status === "error" ? "selected" : ""}>Помилки</option></gym-select>
                ${models.length ? `<gym-select data-action="ai-stats-filter" data-filter="model"><option value="">Усі моделі</option>${models.map((entry) => `<option value="${escapeHtml(entry.model)}" ${aiStatsState.filters.model === entry.model ? "selected" : ""}>${escapeHtml(entry.model)}</option>`).join("")}</gym-select>` : ""}
            </div>
        </div>`;
}

function renderAiStatsBody() {
    const body = element("aiStatsBody");
    if (body) {
        body.innerHTML = aiStatsBodyContent();
        iconsIn(body);
    }
    // Refresh the model filter options once summary is available.
    const filters = document.querySelector(".ai-stats-filters");
    if (filters) {
        filters.outerHTML = aiStatsFilters();
        const refreshed = document.querySelector(".ai-stats-filters");
        if (refreshed) {
            iconsIn(refreshed);
        }
    }
}

function aiStatsBodyContent() {
    if (aiStatsState.error) {
        return `<div class="ai-banner ai-banner-error" role="alert"><i data-lucide="alert-triangle"></i><span>${escapeHtml(aiStatsState.error)}</span></div>`;
    }
    if (aiStatsState.loading && !aiStatsState.summary) {
        return `<div class="ai-stats-loading"><span class="pixel-loader">${Array.from({ length: 5 }, (_, i) => `<span style="--cell:${i}"></span>`).join("")}</span><p class="card-caption">Завантажую статистику…</p></div>`;
    }
    if (!aiStatsState.summary) {
        return emptyInline("Немає даних", "Статистика зʼявиться після перших AI-запитів.");
    }
    return `${aiStatsKpis()}${aiStatsChartCard()}${aiStatsLimits()}${aiStatsRequests()}`;
}

function aiStatsKpis() {
    const summary = aiStatsState.summary;
    const period = summary.period || {};
    const counts = summary.counts || {};
    return `<div class="grid dashboard-grid ai-stats-kpis">
            ${metric("Сьогодні", counts.today || 0, "calendar", "Запитів сьогодні", "span-3")}
            ${metric("7 днів", counts.last7Days || 0, "calendar-days", "Запитів за тиждень", "span-3")}
            ${metric("30 днів", counts.last30Days || 0, "calendar-range", "Запитів за місяць", "span-3")}
            ${metric("Success rate", `${period.successRate || 0}%`, "check-circle-2", `${period.success || 0} з ${period.requests || 0}`, "span-3")}
            ${metric("Усього токенів", number(period.totalTokens || 0), "coins", "За обраний період", "span-3")}
            ${metric("Input / Output", `${number(period.inputTokens || 0)} / ${number(period.outputTokens || 0)}`, "arrow-left-right", "Токени вхід/вихід", "span-3")}
            ${metric("Сер. затримка", `${number(period.avgLatencyMs || 0)} мс`, "timer", `Макс ${number(period.maxLatencyMs || 0)} мс`, "span-3")}
            ${metric("Помилки", period.errors || 0, "alert-triangle", "За обраний період", "span-3")}
        </div>`;
}

function aiStatsChartCard() {
    return `<section class="card chart-card span-12"><div class="card-header"><div><h3>Витрата токенів по днях</h3><p class="card-caption">Сумарні токени за день у межах періоду.</p></div></div><div class="chart-box"><canvas id="aiTokenChart"></canvas></div></section>`;
}

function renderAiStatsChart() {
    const usage = aiStatsState.usage;
    if (!usage || !Array.isArray(usage.days) || !element("aiTokenChart")) {
        return;
    }
    const labels = usage.days.map((day) => shortDate(day.date));
    const data = usage.days.map((day) => day.totalTokens || 0);
    lineChart("aiTokenChart", labels, data, "Токени");
}

function aiStatsLimits() {
    const limits = aiStatsState.limits;
    if (!limits) {
        return "";
    }
    const official = limits.official;
    const estimate = limits.estimate;
    const usage = limits.usage || {};
    const rows = official
        ? `<div class="ai-limit-grid">
                ${aiLimitTile("Запитів/хв", official.rpm)}
                ${aiLimitTile("Запитів/день", official.rpd)}
                ${aiLimitTile("Токенів/хв", number(official.tpm))}
            </div>`
        : `<p class="input-hint">Офіційні ліміти для моделі «${escapeHtml(limits.model)}» не задокументовані у застосунку. Перевір на сторінці квот.</p>`;
    const estimateBar = estimate
        ? `<div class="ai-limit-usage"><div class="ai-limit-usage-head"><span>Використано сьогодні</span><strong>${estimate.requestsToday} / ${estimate.dailyRequestLimit}</strong></div><div class="busy-progress"><span style="width:${Math.min(100, estimate.usagePercent)}%"></span></div><p class="input-hint">${estimate.usagePercent}% денного ліміту (оцінка за фактичними запитами GymOS).</p></div>`
        : "";
    return `<section class="card span-12 ai-limits-card">
            <div class="card-header"><div><h3>Ліміти Gemini</h3><p class="card-caption">Модель: <strong>${escapeHtml(limits.model)}</strong> · ${limits.configured ? "ключ налаштовано" : "ключ не налаштовано"}</p></div></div>
            ${rows}
            ${estimateBar}
            <div class="ai-limit-usage-row">
                <span class="chip"><i data-lucide="activity"></i> Запитів сьогодні: ${usage.requestsToday || 0}</span>
                <span class="chip"><i data-lucide="coins"></i> Токенів сьогодні: ${number(usage.totalTokensToday || 0)}</span>
            </div>
            <p class="input-hint ai-limit-note">${escapeHtml(limits.note || "")}</p>
            <div class="ai-limit-links">
                <a class="link-button" href="${escapeHtml((limits.sources && limits.sources.quotaDashboard) || "https://aistudio.google.com/rate-limit")}" target="_blank" rel="noopener">Квоти проєкту в AI Studio</a>
                <a class="link-button" href="${escapeHtml((limits.sources && limits.sources.limitsDoc) || "https://ai.google.dev/gemini-api/docs/rate-limits")}" target="_blank" rel="noopener">Офіційна документація лімітів</a>
            </div>
        </section>`;
}

function aiLimitTile(label, value) {
    return `<div class="ai-limit-tile"><div class="ai-limit-value">${escapeHtml(String(value))}</div><div class="ai-limit-label">${escapeHtml(label)}</div></div>`;
}

function aiStatsRequests() {
    const requests = (aiStatsState.requests && aiStatsState.requests.requests) || [];
    if (!requests.length) {
        return `<section class="card span-12"><div class="card-header"><div><h3>Останні запити</h3></div></div>${emptyInline("Порожньо", "Запитів ще не було.")}</section>`;
    }
    const rows = requests.map((request) => {
        const ok = request.status === "success";
        const when = request.createdAt ? new Date(request.createdAt) : null;
        const timeLabel = when ? `${formatDate(request.createdAt)} ${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}` : "";
        return `<div class="ai-req-row ${ok ? "" : "is-error"}">
                <span class="status-badge ${ok ? "completed" : "readonly"}">${ok ? "OK" : escapeHtml(request.errorCode || "Помилка")}</span>
                <div class="ai-req-main"><strong>${escapeHtml(request.userName || "—")}</strong><span class="ai-req-sub">${escapeHtml(request.model || "")}${request.recognizedExercises != null ? ` · ${request.recognizedExercises} вправ` : ""}</span></div>
                <div class="ai-req-metrics">
                    <span title="Токени"><i data-lucide="coins"></i>${number(request.totalTokens || 0)}</span>
                    <span title="Затримка"><i data-lucide="timer"></i>${number(request.durationMs || 0)} мс</span>
                    <span class="ai-req-time">${escapeHtml(timeLabel)}</span>
                </div>
            </div>`;
    }).join("");
    return `<section class="card span-12 ai-requests-card"><div class="card-header"><div><h3>Останні запити</h3><p class="card-caption">Останні ${requests.length} викликів (без промптів і transcript-ів).</p></div></div><div class="ai-req-list">${rows}</div></section>`;
}

export async function loadAiStats() {
    if (aiStatsState.loading) {
        return;
    }
    aiStatsState.loading = true;
    aiStatsState.error = null;
    renderAiStatsBody();
    try {
        const query = aiStatsState.filters;
        const [summary, usage, requests, limits] = await Promise.all([
            storage.apiClient.fetchAiStatistics("summary", query),
            storage.apiClient.fetchAiStatistics("usage", query),
            storage.apiClient.fetchAiStatistics("requests", query),
            storage.apiClient.fetchAiStatistics("limits", {})
        ]);
        aiStatsState.summary = summary;
        aiStatsState.usage = usage;
        aiStatsState.requests = requests;
        aiStatsState.limits = limits;
        aiStatsState.loading = false;
        if (state.section === "aistats") {
            renderAiStatsBody();
            requestAnimationFrame(() => renderAiStatsChart());
        }
    } catch (error) {
        aiStatsState.loading = false;
        aiStatsState.error = friendlyError(error);
        if (state.section === "aistats") {
            renderAiStatsBody();
        }
    }
}

export function aiStatsSetPeriod(period) {
    aiStatsState.filters.period = period;
    loadAiStats();
    renderAiStatsBody();
}

export function aiStatsSetFilter(filter, value) {
    aiStatsState.filters[filter] = value;
    loadAiStats();
}
