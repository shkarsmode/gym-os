// <gym-date> — a styled date field. On desktop it opens a custom animated
// calendar (portaled to <body> so it never clips); on touch devices it defers to
// the native OS date picker (best mobile UX). Like <gym-select> it carries data-*
// attributes, exposes .value (ISO yyyy-mm-dd) and fires a bubbling "change".
import { escapeHtml, refreshIcons, isCoarsePointer, revealOnNextFrame, registerOpenPanel, unregisterOpenPanel } from "./util.js";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
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
        if (isCoarsePointer()) {
            try {
                this.input.showPicker();
            } catch (_) {
                this.input.focus();
                this.input.click();
            }
            return;
        }
        if (this.panel) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
        this.classList.add("is-open");
        this.setAttribute("aria-expanded", "true");
        const base = parseISO(this._value) || new Date();
        this.viewYear = base.getFullYear();
        this.viewMonth = base.getMonth();
        this.activeIso = this._value || toISO(new Date());

        const panel = document.createElement("div");
        panel.className = "gdate-panel";
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-label", "Вибір дати");
        document.body.appendChild(panel);
        this.panel = panel;
        registerOpenPanel(this, panel, () => this.close());
        this.renderCalendar();
        this.position();
        revealOnNextFrame(panel);

        panel.addEventListener("click", (event) => {
            const nav = event.target.closest("[data-nav]");
            if (nav) {
                event.preventDefault();
                this.shiftMonth(Number(nav.dataset.nav));
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
            case "ArrowLeft": event.preventDefault(); this.moveActive(-1); break;
            case "ArrowRight": event.preventDefault(); this.moveActive(1); break;
            case "ArrowUp": event.preventDefault(); this.moveActive(-7); break;
            case "ArrowDown": event.preventDefault(); this.moveActive(7); break;
            case "PageUp": event.preventDefault(); this.shiftMonth(-1); break;
            case "PageDown": event.preventDefault(); this.shiftMonth(1); break;
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
            this.renderCalendar();
            this.position();
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
        this.position();
    }

    renderCalendar() {
        const year = this.viewYear;
        const month = this.viewMonth;
        const startDow = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-first
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const today = toISO(new Date());
        let cells = "";
        for (let i = 0; i < startDow; i += 1) {
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
        this.panel.innerHTML =
            `<div class="gcal-head">` +
                `<button type="button" class="gcal-nav" data-nav="-1" aria-label="Попередній місяць"><i data-lucide="chevron-left"></i></button>` +
                `<div class="gcal-title">${MONTHS[month]} ${year}</div>` +
                `<button type="button" class="gcal-nav" data-nav="1" aria-label="Наступний місяць"><i data-lucide="chevron-right"></i></button>` +
            `</div>` +
            `<div class="gcal-grid gcal-weekdays">${WEEKDAYS.map((day) => `<span class="gcal-wd">${day}</span>`).join("")}</div>` +
            `<div class="gcal-grid gcal-days">${cells}</div>` +
            `<div class="gcal-foot"><button type="button" class="gcal-today-btn" data-today>Сьогодні</button></div>`;
        refreshIcons();
    }

    position() {
        const rect = this.getBoundingClientRect();
        const panel = this.panel;
        const margin = 8;
        const panelHeight = panel.offsetHeight;
        const panelWidth = panel.offsetWidth;
        const below = window.innerHeight - rect.bottom;
        if (below < panelHeight + 12 && rect.top > below) {
            panel.style.top = `${Math.round(rect.top - panelHeight - 6)}px`;
        } else {
            panel.style.top = `${Math.round(rect.bottom + 6)}px`;
        }
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
