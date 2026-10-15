// Workout accessors, history lists, lazily loaded libraries (Chart.js, FullCalendar), calendar rendering, charts.
import { escapeHtml, dateInput, shortDate, imageUrl } from "../lib/format.js";
import { formatClock } from "../lib/gym-clock.js";
import { workoutVolume } from "../lib/scoring.js";
import { emptyInline, historyRow } from "./components.js";
import { muscleSetMap, progressData } from "./history.js";
import { currentUser, exerciseByName, userById, workoutNumber, workoutStatusOf, workoutsFor } from "./model.js";
import { element } from "./overlays.js";
import { duration } from "./scoring-bridge.js";
import { state } from "./state.js";
import { openDaySheet } from "./ui-helpers.js";
import { byDateAsc, icons } from "./util.js";

// ---- Shape-agnostic workout accessors ---------------------------------------
// Every workout row carries these aggregates whether or not it carries its sets,
// which is what lets one renderer serve both a hydrated own workout and a peer
// summary. Reading them from the row rather than recomputing is also the only
// correct thing to do for a summary — there are no sets to compute from.
export function workoutExerciseCount(workoutItem) {
    return Number.isFinite(workoutItem.exerciseCount)
        ? workoutItem.exerciseCount
        : (workoutItem.exercises || []).length;
}

export function workoutVolumeOf(workoutItem) {
    return Number.isFinite(workoutItem.totalVolume) ? workoutItem.totalVolume : workoutVolume(workoutItem);
}

export function durationOf(workoutItem) {
    return Number.isFinite(workoutItem.durationMinutes) ? workoutItem.durationMinutes : duration(workoutItem);
}

// Rendered under a history list when the caller's own history continues past what
// the boot payload delivered. Absent for peers and once everything is loaded, so
// there is no "load more" that does nothing.
export function loadMoreControl() {
    if (!state.workoutsCursor) {
        return "";
    }
    return `<div class="action-row" style="justify-content:center;margin-top:14px;"><button class="button button-secondary compact" type="button" data-action="load-more-workouts"><i data-lucide="chevron-down"></i>Показати більше</button></div>`;
}

export function workoutHistoryList(workouts) {
    if (!workouts.length) {
        return emptyInline("Історія порожня", "Створи або заверши тренування, щоб воно з'явилося тут.");
    }

    const me = currentUser();
    return workouts.map((workoutItem) => historyRow(workoutItem, { showOwner: !me || workoutItem.userId !== me.id })).join("");
}

const lazyScripts = new Map();

function loadScript(src) {
    if (lazyScripts.has(src)) {
        return lazyScripts.get(src);
    }
    const promise = new Promise((resolve, reject) => {
        const tag = document.createElement("script");
        tag.src = src;
        tag.async = true;
        tag.onload = () => resolve();
        tag.onerror = () => reject(new Error("Не вдалося завантажити " + src));
        document.head.appendChild(tag);
    });
    lazyScripts.set(src, promise);
    return promise;
}

function loadStyle(href) {
    if (document.querySelector(`link[data-lazy="${href}"]`)) {
        return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.lazy = href;
    document.head.appendChild(link);
}

// Chart.js and FullCalendar are loaded on demand (only on stats / calendar views)
// instead of blocking the initial page load. The catch keeps a CDN failure from
// rejecting and breaking the caller; the entry points fall back gracefully.
function ensureChartLib() {
    return window.Chart ? Promise.resolve() : loadScript("https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js").catch(() => {});
}

function ensureCalendarLib() {
    if (window.FullCalendar) {
        return Promise.resolve();
    }
    loadStyle("https://cdn.jsdelivr.net/npm/fullcalendar@6.1.15/index.global.min.css");
    return loadScript("https://cdn.jsdelivr.net/npm/fullcalendar@6.1.15/index.global.min.js").catch(() => {});
}

export function renderCalendar() {
    const container = element("calendarContainer");
    if (!container) {
        return;
    }
    if (!window.FullCalendar) {
        ensureCalendarLib().then(() => {
            if (window.FullCalendar) {
                renderCalendar();
            } else {
                container.innerHTML = emptyInline("Календар недоступний", "Не вдалося завантажити FullCalendar з CDN.");
                icons();
            }
        });
        return;
    }
    // Which month the user was looking at. The calendar is rebuilt whenever the
    // section repaints — including now, when a teammate's session changes — and
    // without this it silently jumps back to today every time, throwing away
    // wherever they had navigated to.
    let viewedDate = null;
    if (state.calendar) {
        try {
            viewedDate = state.calendar.getDate();
        } catch (error) {
            viewedDate = null;
        }
        state.calendar.destroy();
    }
    const mobile = window.innerWidth < 760;
    state.calendar = new FullCalendar.Calendar(container, {
        initialView: mobile ? "listMonth" : "dayGridMonth",
        ...(viewedDate ? { initialDate: viewedDate } : {}),
        height: "auto",
        firstDay: 1,
        locale: "uk",
        buttonText: { today: "Сьогодні", month: "Місяць", week: "Тиждень", list: "Список" },
        headerToolbar: mobile ? { left: "prev,next", center: "title", right: "today" } : { left: "prev,next today", center: "title", right: "dayGridMonth,listMonth" },
        displayEventTime: false,
        eventOrder: "mine,title",
        // Cap a day cell at 4 workouts; the rest fold into a "+N" pill that opens
        // the full day sheet (same modal as clicking a day) instead of FC's popover.
        dayMaxEvents: 4,
        moreLinkContent: (arg) => ({ html: `<span class="fc-more-pill">ще ${arg.num}</span>` }),
        moreLinkClick: (arg) => { openDaySheet(dateInput(arg.date)); return "none"; },
        events: state.database.workouts.map((workoutItem) => {
            const owner = userById(workoutItem.userId);
            const mine = workoutItem.userId === currentUser().id;
            return {
                id: workoutItem.id,
                title: owner.displayName,
                start: workoutItem.date,
                classNames: [`workout-status-${workoutStatusOf(workoutItem)}`, ...(mine ? ["workout-mine"] : [])],
                extendedProps: {
                    workoutId: workoutItem.id,
                    date: workoutItem.date,
                    num: String(workoutNumber(workoutItem)),
                    mine: mine ? 0 : 1,
                    avatarUrl: imageUrl(owner.avatarUrl) || "",
                    initials: owner.avatarInitials || "",
                    color: owner.avatarColor || "#333",
                    // Only an OWN active session has the marks to derive a clock from —
                    // peer rows are summaries and carry no set timestamps.
                    clockFrom: mine && workoutItem.status === "active" ? (workoutItem.firstSetAt || "") : ""
                }
            };
        }),
        eventContent: (arg) => {
            const props = arg.event.extendedProps;
            const av = `<span class="fc-ev-av" style="background:${escapeHtml(props.color)}">${escapeHtml(props.initials)}${props.avatarUrl ? `<img src="${escapeHtml(props.avatarUrl)}" alt="" referrerpolicy="no-referrer" decoding="async" onerror="this.remove()">` : ""}</span>`;
            // A session that is running right now shows its clock instead of the #N —
            // the calendar becomes a live view of who is training.
            const live = props.clockFrom
                ? `<span class="fc-ev-clock" data-cal-clock="${escapeHtml(props.clockFrom)}">${escapeHtml(formatClock(Math.max(0, Date.now() - new Date(props.clockFrom).getTime())))}</span>`
                : "";
            return { html: `<div class="fc-ev">${av}<span class="fc-ev-name">${escapeHtml(arg.event.title || "")}</span>${live || (props.num ? `<span class="fc-ev-num">#${escapeHtml(props.num)}</span>` : "")}</div>` };
        },
        dateClick: (info) => openDaySheet(info.dateStr),
        eventClick: (info) => {
            info.jsEvent.preventDefault();
            openDaySheet(info.event.extendedProps.date);
        }
    });
    state.calendar.render();
    syncCalendarClocks();
}

// One interval for every live clock drawn in the calendar. It stops as soon as none are
// on screen, so leaving the section costs nothing.
let calendarClockTimer = null;

function syncCalendarClocks() {
    clearInterval(calendarClockTimer);
    calendarClockTimer = null;
    const tick = () => {
        const nodes = document.querySelectorAll("[data-cal-clock]");
        if (!nodes.length) {
            clearInterval(calendarClockTimer);
            calendarClockTimer = null;
            return;
        }
        nodes.forEach((node) => {
            const start = new Date(node.dataset.calClock).getTime();
            if (!Number.isFinite(start)) {
                return;
            }
            node.textContent = formatClock(Math.max(0, Date.now() - start));
        });
    };
    if (document.querySelector("[data-cal-clock]")) {
        calendarClockTimer = setInterval(tick, 1000);
        tick();
    }
}

export function volumeChart(id, userId) {
    const workouts = (userId ? workoutsFor(userId) : state.database.workouts).filter((item) => item.status === "completed").sort(byDateAsc).slice(-14);
    barChart(id, workouts.map((item) => shortDate(item.date)), workouts.map(workoutVolume), "Обсяг, кг");
}

export function muscleDistributionChart(id, userId) {
    const map = muscleSetMap((userId ? workoutsFor(userId) : state.database.workouts).filter((item) => item.status === "completed"));
    doughnutChart(id, [...map.keys()], [...map.values()]);
}

export function bodyweightChart(id, userId = currentUser().id) {
    const entries = state.database.bodyweightEntries.filter((item) => item.userId === userId).sort(byDateAsc);
    // Bodyweight barely moves relative to zero, so a 0-based axis flattens the line.
    // Frame the axis around the actual data (±10 кг) to make fluctuations visible.
    const values = entries.map((item) => Number(item.bodyweight) || 0).filter((value) => value > 0);
    const yScale = values.length
        ? { beginAtZero: false, suggestedMin: Math.max(0, Math.floor(Math.min(...values) - 10)), suggestedMax: Math.ceil(Math.max(...values) + 10) }
        : null;
    lineChart(id, entries.map((item) => shortDate(item.date)), entries.map((item) => item.bodyweight), "Вага тіла, кг", yScale);
}

export function progressChart(id, userId) {
    // Was gated on state.filters.statsExerciseId, which no UI ever assigned — it
    // sat at "all" for the life of the app, so this always charted the bench press.
    const exerciseId = exerciseByName("Жим лежачи").id;
    const points = progressData(userId, exerciseId);
    lineChart(id, points.map((point) => shortDate(point.date)), points.map((point) => point.value), "Розрах. 1ПМ");
}

export function maxTrendChart(id, userId) {
    const points = progressData(userId, exerciseByName("Жим лежачи").id);
    lineChart(id, points.map((point) => shortDate(point.date)), points.map((point) => point.value), "Жим лежачи, розрах. 1ПМ");
}

export function consistencyChart(id, userId) {
    const workouts = (userId ? workoutsFor(userId) : state.database.workouts).filter((item) => item.status === "completed").sort(byDateAsc).slice(-10);
    barChart(id, workouts.map((item) => shortDate(item.date)), workouts.map((item) => workoutExerciseCount(item)), "Вправи");
}

const chartPalette = ["#34d399", "#60a5fa", "#a78bfa", "#fbbf24", "#f472b6", "#22d3ee", "#fb923c", "#4ade80", "#f87171", "#c084fc", "#2dd4bf", "#facc15"];

function barChart(id, labels, data, label) {
    const colors = data.map((_, index) => chartPalette[index % chartPalette.length]);
    createChart(id, { type: "bar", data: { labels, datasets: [{ label, data, backgroundColor: colors.map((color) => `${color}cc`), borderColor: colors, borderWidth: 1, borderRadius: 8 }] }, options: chartOptions() });
}

export function lineChart(id, labels, data, label, yScale = null) {
    const options = chartOptions();
    if (yScale) {
        options.scales.y = { ...options.scales.y, ...yScale };
    }
    createChart(id, { type: "line", data: { labels, datasets: [{ label, data, tension: 0.35, fill: true, backgroundColor: "rgba(52, 211, 153, 0.12)", borderColor: "#34d399", pointBackgroundColor: "#6ee7b7", pointRadius: 3, borderWidth: 2 }] }, options });
}

function doughnutChart(id, labels, data) {
    const colors = labels.map((_, index) => chartPalette[index % chartPalette.length]);
    createChart(id, { type: "doughnut", data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: "#111113", borderWidth: 2, hoverOffset: 6 }] }, options: { ...chartOptions(), cutout: "66%", scales: {} } });
}

function createChart(id, config) {
    if (!element(id)) {
        return;
    }
    const labels = config.data?.labels || [];
    const values = config.data?.datasets?.[0]?.data || [];
    if (!labels.length || !values.some((value) => Number(value) > 0)) {
        const parent = element(id).parentElement;
        if (parent) {
            parent.innerHTML = emptyInline("Недостатньо даних", "Графік оновиться після створення або завершення тренувань.");
            icons();
        }
        return;
    }
    if (!window.Chart) {
        // Load Chart.js on demand, then retry once. The window.Chart guard stops a
        // failed CDN load from re-entering forever.
        ensureChartLib().then(() => {
            if (window.Chart) {
                createChart(id, config);
            }
        });
        return;
    }
    const chart = new Chart(element(id), config);
    state.charts.set(id, chart);
}

function chartOptions() {
    return { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: "#a1a1aa", boxWidth: 12, usePointStyle: true } }, tooltip: { backgroundColor: "rgba(22, 22, 24, 0.97)", titleColor: "#f4f4f5", bodyColor: "#d4d4d8", borderColor: "rgba(255, 255, 255, 0.14)", borderWidth: 1 } }, scales: { x: { ticks: { color: "#71717a" }, grid: { color: "rgba(255, 255, 255, 0.06)" } }, y: { ticks: { color: "#71717a" }, grid: { color: "rgba(255, 255, 255, 0.06)" }, beginAtZero: true } } };
}

export function destroyCharts() {
    state.charts.forEach((chart) => chart.destroy());
    state.charts.clear();
}
