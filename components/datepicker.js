// <gym-date> — a styled date field. On desktop it opens a custom animated
// calendar (portaled to <body> so it never clips); on touch devices it defers to
// the native OS date picker (best mobile UX). Like <gym-select> it carries data-*
// attributes, exposes .value (ISO yyyy-mm-dd) and fires a bubbling "change".
import { escapeHtml, refreshIcons, revealOnNextFrame, registerOpenPanel, unregisterOpenPanel } from "./util.js";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
const MONTHS_SHORT = ["Січ", "Лют", "Бер", "Кві", "Тра", "Чер", "Лип", "Сер", "Вер", "Жов", "Лис", "Гру"];
// A page of years, three across. Twelve is the same grid as the months view, so
// switching between them does not resize the panel.
const YEARS_PER_PAGE = 12;
const MONTHS = [
    "Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень",
    "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"
];

function toISO(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseISO(iso) {
    if (!iso) {
        return null;
    }
    const [year, month, day] = iso.split("-").map(Number);
    if (!year || !month || !day) {
        return null;
    }
    return new Date(year, month - 1, day);
}

function formatLabel(iso) {
    const date = parseISO(iso);
    if (!date) {
        return "Оберіть дату";
    }
    return new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

class GymDate extends HTMLElement {
    connectedCallback() {
        if (this.initialized) {
            return;
        }
        this.initialized = true;
        this._value = this.getAttribute("value") || "";

        this.innerHTML = "";
        this.classList.add("gdate");
        this.tabIndex = 0;
        this.setAttribute("role", "combobox");
        this.setAttribute("aria-haspopup", "dialog");
        this.setAttribute("aria-expanded", "false");

        // Hidden native input — source of truth for the value and the mobile picker.
        this.input = document.createElement("input");
        this.input.type = "date";
        this.input.className = "gdate-native";
        this.input.value = this._value;
        this.input.tabIndex = -1;
        this.input.setAttribute("aria-hidden", "true");
        const min = this.getAttribute("min");
        const max = this.getAttribute("max");
        if (min) {
            this.input.min = min;
        }
        if (max) {
            this.input.max = max;
        }
        this.appendChild(this.input);
        this.input.addEventListener("change", (event) => {
            event.stopPropagation();
            this.commit(this.input.value, true);
        });

        this.trigger = document.createElement("button");
        this.trigger.type = "button";
        this.trigger.className = "gdate-trigger";
        this.trigger.tabIndex = -1;
        this.appendChild(this.trigger);
        this.renderTrigger();
        this.updateAria();

        this.trigger.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.toggle();
        });
        this.addEventListener("keydown", (event) => this.onKeydown(event));
    }

    disconnectedCallback() {
        this.close();
    }

    get value() {
        return this._value;
    }

    set value(next) {
        this.commit(next, false);
    }

    commit(next, fromUser) {
        const value = next || "";
        const changed = value !== this._value;
        this._value = value;
        if (this.input) {
            this.input.value = value;
        }
        this.renderTrigger();
        this.updateAria();
        if (fromUser && changed) {
            this.dispatchEvent(new Event("change", { bubbles: true }));
        }
    }

    renderTrigger() {
        const placeholder = this._value ? "" : " is-placeholder";
        this.trigger.innerHTML = `<i data-lucide="calendar-days" class="gdate-icon"></i><span class="gdate-label${placeholder}">${escapeHtml(formatLabel(this._value))}</span>`;
        refreshIcons();
    }

    updateAria() {
        this.setAttribute("aria-label", this._value ? `Дата: ${formatLabel(this._value)}` : "Оберіть дату");
    }

    isDisabledISO(iso) {
        const min = this.input.min;
        const max = this.input.max;
        return Boolean((min && iso < min) || (max && iso > max));
    }

    toggle() {
        // ONE implementation on every device. It used to hand touch screens to
        // input.showPicker(), and on a real phone that returned nothing at all — the
        // field stayed on «Оберіть дату» after picking a date, with no error to explain
        // it. A path that cannot be reproduced or tested here is not one to keep for the
        // devices most people use; the panel below is sized for a thumb instead.
        if (this.panel) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
        this.classList.add("is-open");
        this.setAttribute("aria-expanded", "true");
        // With no value, start where the field is ALLOWED to be rather than at today.
        // A birthday field capped at "ten years ago" opened on the current year, and
        // reaching 1998 from there is 336 taps on a chevron — which is how somebody ends
        // up entering 2025 as their year of birth.
        const base = parseISO(this._value) || parseISO(this.input.max) || new Date();
        this.viewYear = base.getFullYear();
        this.viewMonth = base.getMonth();
        this.view = "days";
        this.activeIso = this._value || toISO(base);

        const panel = document.createElement("div");
        panel.className = "gdate-panel";
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-label", "Вибір дати");
        document.body.appendChild(panel);
        this.panel = panel;
        registerOpenPanel(this, panel, () => this.close(), () => this.position());
        this.renderCalendar();
        this.position();
        revealOnNextFrame(panel);

        panel.addEventListener("click", (event) => {
            const nav = event.target.closest("[data-nav]");
            if (nav) {
                event.preventDefault();
                this.shiftView(Number(nav.dataset.nav));
                return;
            }
            if (event.target.closest("[data-zoom]")) {
                event.preventDefault();
                // Days → months → years, the way every OS picker does it.
                this.view = this.view === "days" ? "months" : "years";
                this.renderCalendar();
                return;
            }
            const pickYear = event.target.closest("[data-year]");
            if (pickYear && !pickYear.disabled) {
                event.preventDefault();
                this.viewYear = Number(pickYear.dataset.year);
                this.view = "months";
                this.renderCalendar();
                return;
            }
            const pickMonth = event.target.closest("[data-month]");
            if (pickMonth && !pickMonth.disabled) {
                event.preventDefault();
                this.viewMonth = Number(pickMonth.dataset.month);
                this.view = "days";
                this.renderCalendar();
                return;
            }
            if (event.target.closest("[data-today]")) {
                event.preventDefault();
                const today = toISO(new Date());
                if (!this.isDisabledISO(today)) {
                    this.commit(today, true);
                    this.close();
                    this.focus();
                }
                return;
            }
            const day = event.target.closest(".gcal-day[data-iso]");
            if (day && !day.disabled) {
                event.preventDefault();
                this.commit(day.dataset.iso, true);
                this.close();
                this.focus();
            }
        });

        this.onDocPointer = (event) => {
            if (!this.contains(event.target) && !panel.contains(event.target)) {
                this.close();
            }
        };
        setTimeout(() => document.addEventListener("pointerdown", this.onDocPointer, true), 0);
    }

    onKeydown(event) {
        if (!this.panel) {
            if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
                event.preventDefault();
                this.toggle();
            }
            return;
        }
        switch (event.key) {
            case "ArrowLeft":
            case "ArrowRight":
            case "ArrowUp":
            case "ArrowDown":
                if (this.view !== "days") {
                    event.preventDefault();
                    this.view = "days";
                    this.renderCalendar();
                    return;
                }
                break;
            default:
                break;
        }
        switch (event.key) {
            case "ArrowLeft": event.preventDefault(); this.moveActive(-1); break;
            case "ArrowRight": event.preventDefault(); this.moveActive(1); break;
            case "ArrowUp": event.preventDefault(); this.moveActive(-7); break;
            case "ArrowDown": event.preventDefault(); this.moveActive(7); break;
            // Pages whatever is on screen, matching what the chevrons do.
            case "PageUp": event.preventDefault(); this.shiftView(-1); break;
            case "PageDown": event.preventDefault(); this.shiftView(1); break;
            case "Enter":
            case " ":
                event.preventDefault();
                if (this.activeIso && !this.isDisabledISO(this.activeIso)) {
                    this.commit(this.activeIso, true);
                    this.close();
                    this.focus();
                }
                break;
            case "Escape":
                event.preventDefault();
                this.close();
                this.focus();
                break;
            case "Tab":
                this.close();
                break;
            default:
                break;
        }
    }

    moveActive(deltaDays) {
        const cursor = parseISO(this.activeIso) || new Date();
        cursor.setDate(cursor.getDate() + deltaDays);
        this.activeIso = toISO(cursor);
        if (cursor.getFullYear() !== this.viewYear || cursor.getMonth() !== this.viewMonth) {
            this.viewYear = cursor.getFullYear();
            this.viewMonth = cursor.getMonth();
            // Rendered but NOT repositioned: the panel is anchored once, on open. Six
            // week-rows are always six rows now, but re-running position() on every
            // arrow key would still walk the panel around whenever its height changed
            // for any other reason.
            this.renderCalendar();
        } else {
            this.markActive();
        }
    }

    markActive() {
        if (!this.panel) {
            return;
        }
        this.panel.querySelectorAll(".gcal-day.is-focus").forEach((element) => element.classList.remove("is-focus"));
        const active = this.panel.querySelector(`.gcal-day[data-iso="${this.activeIso}"]`);
        if (active) {
            active.classList.add("is-focus");
        }
    }

    shiftMonth(delta) {
        this.viewMonth += delta;
        if (this.viewMonth < 0) {
            this.viewMonth = 11;
            this.viewYear -= 1;
        } else if (this.viewMonth > 11) {
            this.viewMonth = 0;
            this.viewYear += 1;
        }
        this.renderCalendar();
    }

    /** The chevrons mean "previous page of whatever is on screen". */
    shiftView(delta) {
        if (this.view === "days") {
            this.shiftMonth(delta);
            return;
        }
        this.viewYear += this.view === "years" ? delta * YEARS_PER_PAGE : delta;
        this.renderCalendar();
    }

    /** The 12-year block `viewYear` falls in, so paging is stable rather than relative. */
    yearPageStart() {
        // Anchored to a fixed grid of decades rather than to the current year, so paging
        // back and forth always lands on the same pages instead of drifting.
        return Math.floor(this.viewYear / YEARS_PER_PAGE) * YEARS_PER_PAGE;
    }

    renderCalendar() {
        const body = this.view === "years" ? this.yearsMarkup()
            : this.view === "months" ? this.monthsMarkup()
            : this.daysMarkup();
        const title = this.view === "years"
            ? `${this.yearPageStart()} — ${this.yearPageStart() + YEARS_PER_PAGE - 1}`
            : this.view === "months" ? String(this.viewYear)
            : `${MONTHS[this.viewMonth]} ${this.viewYear}`;
        // The title is a BUTTON in every view except the last one you can zoom out to.
        // Reaching 1998 by chevron from the current year is 336 taps, which is how a
        // birthday field ends up holding 2025.
        const titleMarkup = this.view === "years"
            ? `<div class="gcal-title">${title}</div>`
            : `<button type="button" class="gcal-title gcal-title-btn" data-zoom aria-label="Обрати ${this.view === "days" ? "місяць" : "рік"}"><span>${title}</span><i data-lucide="chevron-down"></i></button>`;
        this.panel.innerHTML =
            `<div class="gcal-head">` +
                `<button type="button" class="gcal-nav" data-nav="-1" aria-label="Назад"><i data-lucide="chevron-left"></i></button>` +
                titleMarkup +
                `<button type="button" class="gcal-nav" data-nav="1" aria-label="Вперед"><i data-lucide="chevron-right"></i></button>` +
            `</div><div class="gcal-body">${body}</div>` +
            // Offering "today" on a birthday field capped at ten years ago is offering a
            // button that refuses to work.
            (this.isDisabledISO(toISO(new Date()))
                ? ""
                : `<div class="gcal-foot"><button type="button" class="gcal-today-btn" data-today>Сьогодні</button></div>`);
        refreshIcons();
    }

    daysMarkup() {
        const year = this.viewYear;
        const month = this.viewMonth;
        const startDow = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-first
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const today = toISO(new Date());
        let cells = "";
        for (let index = 0; index < startDow; index += 1) {
            cells += `<span class="gcal-day is-empty"></span>`;
        }
        for (let day = 1; day <= daysInMonth; day += 1) {
            const iso = toISO(new Date(year, month, day));
            const disabled = this.isDisabledISO(iso);
            const classes = [
                iso === this._value ? "is-selected" : "",
                iso === today ? "is-today" : "",
                iso === this.activeIso ? "is-focus" : "",
                disabled ? "is-disabled" : ""
            ].filter(Boolean).join(" ");
            cells += `<button type="button" class="gcal-day ${classes}" data-iso="${iso}"${disabled ? " disabled" : ""}>${day}</button>`;
        }
        // Always six rows. A 5-row month and a 6-row month are 40 px apart, and the panel
        // is positioned from its own height — so every chevron tap moved the whole
        // calendar under the finger that tapped it.
        const filled = startDow + daysInMonth;
        for (let index = filled; index < 42; index += 1) {
            cells += `<span class="gcal-day is-empty"></span>`;
        }
        return `<div class="gcal-grid gcal-weekdays">${WEEKDAYS.map((day) => `<span class="gcal-wd">${day}</span>`).join("")}</div>`
            + `<div class="gcal-grid gcal-days">${cells}</div>`;
    }

    monthsMarkup() {
        const cells = MONTHS_SHORT.map((label, index) => {
            // A month is out of range only when EVERY day in it is.
            const first = toISO(new Date(this.viewYear, index, 1));
            const last = toISO(new Date(this.viewYear, index + 1, 0));
            const disabled = this.isDisabledISO(first) && this.isDisabledISO(last);
            const current = index === this.viewMonth ? " is-selected" : "";
            return `<button type="button" class="gcal-cell${current}" data-month="${index}"${disabled ? " disabled" : ""}>${label}</button>`;
        }).join("");
        return `<div class="gcal-grid gcal-picks">${cells}</div>`;
    }

    yearsMarkup() {
        const start = this.yearPageStart();
        const selected = parseISO(this._value)?.getFullYear();
        let cells = "";
        for (let year = start; year < start + YEARS_PER_PAGE; year += 1) {
            const disabled = this.isDisabledISO(`${year}-12-31`) && this.isDisabledISO(`${year}-01-01`);
            const current = year === selected ? " is-selected" : year === this.viewYear ? " is-focus" : "";
            cells += `<button type="button" class="gcal-cell${current}" data-year="${year}"${disabled ? " disabled" : ""}>${year}</button>`;
        }
        return `<div class="gcal-grid gcal-picks">${cells}</div>`;
    }

    position() {
        const rect = this.getBoundingClientRect();
        const panel = this.panel;
        const margin = 8;
        const panelHeight = panel.offsetHeight;
        const panelWidth = panel.offsetWidth;
        const below = window.innerHeight - rect.bottom;
        let top = below < panelHeight + 12 && rect.top > below
            ? rect.top - panelHeight - 6
            : rect.bottom + 6;
        // Clamp to the viewport. Flipping above a field that sits high on the screen —
        // which is where it sits inside a centred dialog — put the whole calendar at a
        // negative offset, off the top of the window, with no way to scroll to it.
        top = Math.max(margin, Math.min(top, window.innerHeight - panelHeight - margin));
        panel.style.top = `${Math.round(top)}px`;
        const left = Math.max(margin, Math.min(rect.left, window.innerWidth - panelWidth - margin));
        panel.style.left = `${Math.round(left)}px`;
    }

    close() {
        if (this.panel) {
            this.panel.remove();
            this.panel = null;
        }
        if (this.onDocPointer) {
            document.removeEventListener("pointerdown", this.onDocPointer, true);
            this.onDocPointer = null;
        }
        this.classList.remove("is-open");
        this.setAttribute("aria-expanded", "false");
        unregisterOpenPanel(this);
    }
}

if (!customElements.get("gym-date")) {
    customElements.define("gym-date", GymDate);
}
