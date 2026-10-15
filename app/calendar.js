// The calendar screen, including the phone month grid.
import { escapeHtml, dateInput } from "../lib/format.js";
import { currentUser, startWorkoutButton, userById, workoutStatusOf, workoutsFor } from "./model.js";
import { content } from "./overlays.js";
import { state } from "./state.js";
import { byDateDesc } from "./util.js";
import { loadMoreControl, renderCalendar, workoutHistoryList } from "./workout-history.js";
import { pluralUk } from "./workout-screen.js";

export function calendar() {
    const history = workoutsFor(currentUser().id).sort(byDateDesc).slice(0, 8);
    if (phoneCalendarWanted()) {
        content(`<div class="grid dashboard-grid"><section class="calendar-shell span-12 is-phone">${phoneCalendar()}</section><section class="card span-12"><div class="card-header"><div><h2>Мої тренування</h2></div></div><div class="activity-feed">${workoutHistoryList(history)}</div>${loadMoreControl()}</section></div>`);
        return;
    }
    content(`<div class="grid dashboard-grid"><section class="calendar-shell span-12"><div class="card-header" style="margin-bottom:16px;"><div class="head-dup"><h2>Календар</h2><p class="card-caption">Натисни день, щоб побачити тренування і керувати ними.</p></div>${startWorkoutButton(null, { compact: true })}</div><div id="calendarContainer"></div><div class="legend-list inline"><span><i class="legend-dot active"></i>Активне</span><span><i class="legend-dot completed"></i>Завершено</span><span><i class="legend-dot planned"></i>Інше</span></div></section><section class="card span-12"><div class="card-header"><div><h2>Останні тренування</h2><p class="card-caption">Натисни, щоб відкрити й керувати.</p></div></div><div class="activity-feed">${workoutHistoryList(history)}</div>${loadMoreControl()}</section></div>`);
    requestAnimationFrame(renderCalendar);
}

// ---- Phone calendar: the month at a glance ------------------------------------------------
//
// FullCalendar's phone view was a list of every member's sessions, day after day — three
// screens of other people before you found your own. On a phone it is a month grid now:
// your sessions as dots (filled done, ring planned, glowing live), the team's only when
// asked for, and a tap on a day opens the same day sheet as before.

function phoneCalendarWanted() {
    return Boolean(window.matchMedia && window.matchMedia("(max-width: 760px)").matches);
}

export function phoneCalendarMonth() {
    const now = new Date();
    const base = state.pcalMonth instanceof Date ? state.pcalMonth : new Date(now.getFullYear(), now.getMonth(), 1);
    return new Date(base.getFullYear(), base.getMonth(), 1);
}

function phoneCalendar() {
    const me = currentUser().id;
    const month = phoneCalendarMonth();
    const scope = state.filters.calendarScope === "team" ? "team" : "mine";
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    const days = new Date(year, monthIndex + 1, 0).getDate();
    const offset = (month.getDay() + 6) % 7; // Monday first
    const today = dateInput(new Date());
    const prefix = `${year}-${String(monthIndex + 1).padStart(2, "0")}-`;
    const byDate = new Map();
    state.database.workouts.forEach((item) => {
        const day = String(item.date || "").slice(0, 10);
        if (!day.startsWith(prefix)) {
            return;
        }
        if (scope === "mine" && item.userId !== me) {
            return;
        }
        if (!byDate.has(day)) {
            byDate.set(day, []);
        }
        byDate.get(day).push(item);
    });
    const dot = (item) => {
        const status = workoutStatusOf(item);
        if (item.userId !== me) {
            const owner = userById(item.userId);
            return `<span class="pcal-dot is-team" style="--dot:${escapeHtml(owner?.avatarColor || "#666")}"></span>`;
        }
        return `<span class="pcal-dot is-own is-${escapeHtml(status)}"></span>`;
    };
    const cells = [];
    for (let blank = 0; blank < offset; blank += 1) {
        cells.push(`<span class="pcal-blank" aria-hidden="true"></span>`);
    }
    for (let day = 1; day <= days; day += 1) {
        const date = `${prefix}${String(day).padStart(2, "0")}`;
        const items = (byDate.get(date) || []).slice().sort((left, right) => (left.userId === me ? 0 : 1) - (right.userId === me ? 0 : 1));
        const own = items.filter((item) => item.userId === me);
        const shown = items.slice(0, 3).map(dot).join("");
        const more = items.length > 3 ? `<span class="pcal-more">+${items.length - 3}</span>` : "";
        const label = `${new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long" }).format(new Date(year, monthIndex, day))}${items.length ? `: ${items.length} ${pluralUk(items.length, "тренування", "тренування", "тренувань")}` : ""}`;
        cells.push(`<button class="pcal-day${date === today ? " is-today" : ""}${own.length ? " has-own" : ""}" type="button" data-action="open-day-sheet" data-date="${date}" aria-label="${escapeHtml(label)}"><span class="pcal-num">${day}</span><span class="pcal-dots">${shown}${more}</span></button>`);
    }
    const title = new Intl.DateTimeFormat("uk-UA", { month: "long", year: "numeric" }).format(month).replace(/\s*р\.$/, "");
    const isCurrent = year === new Date().getFullYear() && monthIndex === new Date().getMonth();
    const ownCount = state.database.workouts.filter((item) => item.userId === me && String(item.date || "").startsWith(prefix) && workoutStatusOf(item) === "completed").length;
    return `<div class="pcal" id="phoneCalendar">
            <div class="pcal-head">
                <button class="ux2-icon-btn" type="button" data-action="pcal-step" data-delta="-1" aria-label="Попередній місяць"><i data-lucide="chevron-left"></i></button>
                <div class="pcal-title"><strong>${escapeHtml(title.charAt(0).toUpperCase() + title.slice(1))}</strong><span>${ownCount} ${pluralUk(ownCount, "тренування", "тренування", "тренувань")} у тебе</span></div>
                <button class="ux2-icon-btn" type="button" data-action="pcal-step" data-delta="1" aria-label="Наступний місяць"><i data-lucide="chevron-right"></i></button>
            </div>
            <div class="pcal-tools">
                <div class="segmented pcal-scope">
                    <button class="segment-button${scope === "mine" ? " active" : ""}" type="button" data-action="pcal-scope" data-scope="mine">Мої</button>
                    <button class="segment-button${scope === "team" ? " active" : ""}" type="button" data-action="pcal-scope" data-scope="team">Уся команда</button>
                </div>
                ${isCurrent ? "" : `<button class="pcal-today" type="button" data-action="pcal-today">Сьогодні</button>`}
            </div>
            <div class="pcal-grid" role="grid">
                ${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"].map((name) => `<span class="pcal-wd">${name}</span>`).join("")}
                ${cells.join("")}
            </div>
            <div class="pcal-legend"><span><i class="pcal-dot is-own is-completed"></i>завершено</span><span><i class="pcal-dot is-own is-planned"></i>заплановано</span><span><i class="pcal-dot is-own is-active"></i>зараз</span></div>
        </div>`;
}
