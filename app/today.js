// «Сьогодні»: the dashboard (hero, week, records, next, recent) and the sections hub.
import { escapeHtml, number, dateInput, formatDate, shortDate } from "../lib/format.js";
import { sessionProgress, numberDraft } from "../lib/session.js";
import { dayDiff as kernelDayDiff } from "../lib/scoring.js";
import { compactKg, pendingExercises } from "./components.js";
import { newFeedbackCount } from "./feedback.js";
import { activeWorkoutFor, currentUser, hasUnlimited, isAdmin, startWorkoutButton, workoutsFor } from "./model.js";
import { content } from "./overlays.js";
import { firstName } from "./presence.js";
import { recordsFor, userStats } from "./scoring-bridge.js";
import { ux2Title } from "./sheets.js";
import { byDateDesc } from "./util.js";
import { workoutHistoryList, workoutVolumeOf } from "./workout-history.js";
import { pluralUk, sameWeekdayWorkout, weekdayLabel } from "./workout-screen.js";

// «Сьогодні» — what matters right now, in the order you need it: start (or repeat) a
// session, this week against the last one, fresh records, what is planned next, then the
// way into every section and your last sessions. «Зараз тренуються» is the feed's job, so
// it is not repeated here.
export function dashboard() {
    const user = currentUser();
    const active = activeWorkoutFor(user.id);
    content(`<div class="grid dashboard-grid today">
            ${todayHero(user, active)}
            ${todayWeek(user)}
            ${todayRecords(user)}
            ${todayNext(user)}
            ${navHub()}
            ${todayRecent(user)}
        </div>`);
}

function todayHero(user, active) {
    const name = escapeHtml(firstName(user.displayName));
    const hour = new Date().getHours();
    const hello = hour < 5 ? "Доброї ночі" : hour < 12 ? "Доброго ранку" : hour < 18 ? "Доброго дня" : "Доброго вечора";
    if (active) {
        const progress = sessionProgress(active.exercises || []);
        return `<section class="card span-12 today-hero"><div class="today-hero-text"><span class="today-hello">${hello}, ${name}</span><strong>Тренування йде</strong><span>${escapeHtml(ux2Title(active))}${progress.total ? ` · ${progress.done} з ${progress.total} підходів` : ""}</span></div><div class="today-hero-actions"><button class="button button-primary" type="button" data-action="edit-workout" data-workout-id="${active.id}"><i data-lucide="activity"></i>Продовжити тренування</button></div></section>`;
    }
    const today = dateInput(new Date());
    const done = workoutsFor(user.id).filter((item) => item.status === "completed").sort(byDateDesc);
    const last = done[0] || null;
    // What to offer as a one-tap repeat: last time on this weekday, else the latest.
    const repeat = sameWeekdayWorkout(user.id, today, null) || last;
    let sub = "Почнімо перше тренування";
    if (last) {
        const days = kernelDayDiff(new Date(`${today}T12:00:00`), new Date(`${String(last.date).slice(0, 10)}T12:00:00`));
        const when = days <= 0 ? "сьогодні" : days === 1 ? "вчора" : `${days} ${pluralUk(days, "день", "дні", "днів")} тому`;
        sub = `Останнє тренування — ${when} (${ux2Title(last)})`;
    }
    return `<section class="card span-12 today-hero">
            <div class="today-hero-text"><span class="today-hello">${hello}, ${name}</span><strong>Готовий тренуватись?</strong><span>${escapeHtml(sub)}</span></div>
            <div class="today-hero-actions">
                ${startWorkoutButton(null, { label: "Почати тренування", buttonClass: "button button-primary" })}
                ${repeat ? `<button class="button button-secondary" type="button" data-action="copy-workout-start" data-workout-id="${repeat.id}"><i data-lucide="copy"></i>Повторити ${escapeHtml(ux2Title(repeat))} · ${escapeHtml(shortDate(repeat.date))}</button>` : ""}
            </div>
        </section>`;
}

function todayWeek(user) {
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    const shift = (days) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + days);
    const from = dateInput(monday);
    const to = dateInput(shift(7));
    const lastFrom = dateInput(shift(-7));
    const done = workoutsFor(user.id).filter((item) => item.status === "completed");
    const day = (item) => String(item.date || "").slice(0, 10);
    const thisWeek = done.filter((item) => day(item) >= from && day(item) < to);
    const lastWeek = done.filter((item) => day(item) >= lastFrom && day(item) < from);
    const volume = (list) => list.reduce((sum, item) => sum + (Number(workoutVolumeOf(item)) || 0), 0);
    // No percentage against last week: a week in progress against a finished one only ever
    // reads as a loss (Tuesday, one session: «−81%»). Last week is a plain line instead.
    const trained = new Set(thisWeek.map(day));
    const todayKey = dateInput(now);
    const streakDays = Number(userStats(user.id).trainingStreak) || 0;
    const dots = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"].map((name, index) => {
        const key = dateInput(shift(index));
        return `<span class="today-day${trained.has(key) ? " is-on" : ""}${key === todayKey ? " is-today" : ""}"><b>${name}</b><i aria-hidden="true"></i></span>`;
    }).join("");
    return `<section class="card span-6 today-week">
            <h3 class="today-label">Цей тиждень</h3>
            <div class="today-days" aria-label="Дні тижня з тренуваннями">${dots}</div>
            <div class="today-kpis">
                <div><strong>${thisWeek.length}</strong><span>${pluralUk(thisWeek.length, "тренування", "тренування", "тренувань")}</span></div>
                <div><strong>${escapeHtml(compactKg(volume(thisWeek)))}</strong><span>обсяг</span></div>
                <div><strong>${streakDays}</strong><span>${pluralUk(streakDays, "день", "дні", "днів")} поспіль</span></div>
            </div>
            ${lastWeek.length ? `<p class="today-week-last">Минулого тижня: ${lastWeek.length} ${pluralUk(lastWeek.length, "тренування", "тренування", "тренувань")} · ${escapeHtml(compactKg(volume(lastWeek)))}</p>` : ""}
        </section>`;
}

function todayRecords(user) {
    const records = recordsFor(user.id).slice().sort((left, right) => String(right.date).localeCompare(String(left.date))).slice(0, 3);
    if (!records.length) {
        return "";
    }
    return `<section class="card span-6 today-records">
            <h3 class="today-label">Свіжі рекорди</h3>
            ${records.map((record) => `<button class="today-rec" type="button" data-action="open-exercise" data-exercise-id="${escapeHtml(record.exerciseId)}"><span class="today-rec-ico"><i data-lucide="flame"></i></span><span class="today-rec-text"><strong>${escapeHtml(record.exercise.name)}</strong><span>${numberDraft(record.weight)} кг × ${record.repetitions} · 1ПМ ≈ ${number(record.estimatedOneRepMax)} кг · ${escapeHtml(shortDate(record.date))}</span></span><i data-lucide="chevron-right" class="ux2-menu-chev"></i></button>`).join("")}
        </section>`;
}

function todayNext(user) {
    const today = dateInput(new Date());
    const next = workoutsFor(user.id)
        .filter((item) => item.status === "planned" && String(item.date || "").slice(0, 10) >= today)
        .sort((left, right) => String(left.date).localeCompare(String(right.date)))[0];
    if (!next) {
        return "";
    }
    return `<section class="card span-12 today-next">
            <span class="today-next-ico"><i data-lucide="calendar-clock"></i></span>
            <div class="today-next-text"><span class="today-label">Заплановано</span><strong>${escapeHtml(ux2Title(next))}</strong><span>${escapeHtml(weekdayLabel(next.date))} · ${escapeHtml(formatDate(next.date))}</span></div>
            <button class="button button-secondary compact" type="button" data-action="edit-workout" data-workout-id="${next.id}">Відкрити</button>
        </section>`;
}

function todayRecent(user) {
    const recent = workoutsFor(user.id).filter((item) => item.status === "completed").sort(byDateDesc).slice(0, 3);
    if (!recent.length) {
        return "";
    }
    return `<section class="card span-12 today-recent"><div class="today-recent-head"><h3 class="today-label">Останні тренування</h3><button class="link-button" type="button" data-action="navigate" data-section="calendar">Усі в календарі</button></div><div class="activity-feed">${workoutHistoryList(recent)}</div></section>`;
}

// Quick-access grid of every section — laconic icon cards. Essential on mobile,
// where the bottom bar only holds 5 tabs.
function navHub() {
    const newFb = newFeedbackCount();
    const links = [
        { id: "levels", title: "Прокачка", caption: "Рівні, XP та досягнення", icon: "medal" },
        { id: "users", title: "Команда", caption: "Учасники та активність", icon: "users" },
        { id: "exercises", title: "Вправи", caption: "Каталог і власні вправи", icon: "list-filter" },
        { id: "rankings", title: "Рейтинги", caption: "Командний лідерборд", icon: "trophy" },
        { id: "feedback", title: "Ідеї", caption: "Запити та фікси спільноти", icon: "lightbulb", badge: isAdmin() && newFb > 0 ? newFb : 0 }
    ];
    if (!hasUnlimited()) {
        links.push({ id: "subscription", title: "GymOS PRO", caption: "Безліміт за $2/міс", icon: "gem", accent: true });
    }
    if (isAdmin()) {
        const pendingEx = pendingExercises().length;
        links.push({ id: "moderation", title: "Модерація", caption: "Нові вправи на апрув", icon: "shield-check", badge: pendingEx > 0 ? pendingEx : 0 });
        links.push({ id: "admin", title: "Адмін", caption: "Ролі й доступи", icon: "shield" });
        links.push({ id: "aistats", title: "AI статистика", caption: "Витрати токенів і ліміти", icon: "brain-circuit" });
    }
    return `<section class="card span-12 nav-hub-card"><div class="card-header"><div><h2>Розділи</h2><p class="card-caption">Швидкий доступ до всіх інструментів GymOS.</p></div></div><div class="nav-hub">${links.map((link) => `<button class="nav-hub-item${link.accent ? " accent" : ""}" type="button" data-action="navigate" data-section="${link.id}"><span class="nav-hub-icon"><i data-lucide="${link.icon}"></i></span><span class="nav-hub-text"><strong>${escapeHtml(link.title)}</strong><span>${escapeHtml(link.caption)}</span></span>${link.badge ? `<span class="nav-hub-badge">${link.badge}</span>` : `<i class="nav-hub-arrow" data-lucide="chevron-right"></i>`}</button>`).join("")}</div></section>`;
}
