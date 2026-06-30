// <gym-select> — a styled, animated dropdown that is a drop-in replacement for a
// native <select> within GymOS:
//   • carries the same data-* attributes (so document-delegated handleChange works),
//   • exposes a .value property (so element(id).value still works),
//   • dispatches a bubbling "change" event whose target is the host element.
// The dropdown panel is portaled to <body> so it never clips inside cards.
import { escapeHtml, refreshIcons, revealOnNextFrame, registerOpenPanel, unregisterOpenPanel } from "./util.js";

// Optional per-option icons. The host app registers a map { key: "<svg…>" } and an
// <option data-icon="key"> then renders that icon to the left of its label (and on
// the trigger when selected). Icons are raw inline SVG (use currentColor).
const OPTION_ICONS = {};
export function registerSelectIcons(map) {
    Object.assign(OPTION_ICONS, map || {});
}

class GymSelect extends HTMLElement {
    connectedCallback() {
        if (this.initialized) {
            return;
        }
        this.initialized = true;

        this.options = [...this.querySelectorAll("option")].map((option) => ({
            value: option.getAttribute("value") ?? option.textContent,
            label: option.textContent,
            icon: option.getAttribute("data-icon") || "",
            selected: option.hasAttribute("selected")
        }));
        const attrValue = this.getAttribute("value");
        const selected = this.options.find((option) => option.selected);
        this._value = attrValue != null
            ? attrValue
            : selected
                ? selected.value
                : this.options[0]
                    ? this.options[0].value
                    : "";

        this.innerHTML = "";
        this.classList.add("gselect");
        this.disabledControl = this.hasAttribute("disabled");
        this.tabIndex = this.disabledControl ? -1 : 0;
        this.setAttribute("role", "combobox");
        this.setAttribute("aria-haspopup", "listbox");
        this.setAttribute("aria-expanded", "false");
        if (this.disabledControl) {
            this.classList.add("is-disabled");
            this.setAttribute("aria-disabled", "true");
        }

        this.trigger = document.createElement("button");
        this.trigger.type = "button";
        this.trigger.className = "gselect-trigger";
        this.trigger.tabIndex = -1;
        this.appendChild(this.trigger);
        this.renderTrigger();

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
        this._value = next;
        if (this.trigger) {
            this.renderTrigger();
        }
    }

    currentLabel() {
        const option = this.options.find((item) => String(item.value) === String(this._value));
        return option ? option.label : "";
    }

    renderTrigger() {
        const current = this.options.find((item) => String(item.value) === String(this._value));
        const icon = current && OPTION_ICONS[current.icon] ? `<span class="gselect-opt-icon">${OPTION_ICONS[current.icon]}</span>` : "";
        this.trigger.innerHTML = `${icon}<span class="gselect-label">${escapeHtml(this.currentLabel())}</span><i data-lucide="chevron-down" class="gselect-caret"></i>`;
        refreshIcons();
    }

    toggle() {
        if (this.disabledControl) {
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

        const panel = document.createElement("div");
        panel.className = "gselect-panel";
        panel.setAttribute("role", "listbox");
        panel.innerHTML = this.options.map((option, index) =>
            `<div class="gselect-option${String(option.value) === String(this._value) ? " is-selected" : ""}" role="option" data-index="${index}">` +
            `${OPTION_ICONS[option.icon] ? `<span class="gselect-opt-icon">${OPTION_ICONS[option.icon]}</span>` : ""}` +
            `<span class="gselect-opt-label">${escapeHtml(option.label)}</span><i data-lucide="check" class="gselect-check"></i></div>`
        ).join("");
        document.body.appendChild(panel);
        this.panel = panel;
        registerOpenPanel(this, panel, () => this.close());
        this.position();
        refreshIcons();
        revealOnNextFrame(panel);

        panel.addEventListener("click", (event) => {
            const option = event.target.closest(".gselect-option");
            if (option) {
                this.choose(Number(option.dataset.index));
            }
        });

        this.onDocPointer = (event) => {
            if (!this.contains(event.target) && !panel.contains(event.target)) {
                this.close();
            }
        };
        // Defer so the opening gesture doesn't immediately close it.
        setTimeout(() => document.addEventListener("pointerdown", this.onDocPointer, true), 0);

        this.activeIndex = this.options.findIndex((option) => String(option.value) === String(this._value));
        if (this.activeIndex < 0) {
            this.activeIndex = 0;
        }
        this.highlight();
    }

    position() {
        const rect = this.getBoundingClientRect();
        const panel = this.panel;
        const margin = 8;
        panel.style.minWidth = `${Math.round(rect.width)}px`;
        const panelHeight = panel.offsetHeight;
        const below = window.innerHeight - rect.bottom;
        if (below < panelHeight + 12 && rect.top > below) {
            panel.style.top = `${Math.round(rect.top - panelHeight - 6)}px`;
        } else {
            panel.style.top = `${Math.round(rect.bottom + 6)}px`;
        }
        const panelWidth = panel.offsetWidth;
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

    choose(index) {
        const option = this.options[index];
        if (!option) {
            return;
        }
        const changed = String(option.value) !== String(this._value);
        this.value = option.value;
        this.close();
        this.focus();
        if (changed) {
            this.dispatchEvent(new Event("change", { bubbles: true }));
        }
    }

    highlight() {
        if (!this.panel) {
            return;
        }
        [...this.panel.children].forEach((element, index) => {
            element.classList.toggle("is-active", index === this.activeIndex);
        });
        const active = this.panel.children[this.activeIndex];
        if (active) {
            active.scrollIntoView({ block: "nearest" });
        }
    }

    onKeydown(event) {
        if (this.disabledControl) {
            return;
        }
        if (!this.panel) {
            if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                this.open();
            }
            return;
        }
        if (event.key === "ArrowDown") {
            event.preventDefault();
            this.activeIndex = Math.min(this.options.length - 1, this.activeIndex + 1);
            this.highlight();
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            this.activeIndex = Math.max(0, this.activeIndex - 1);
            this.highlight();
        } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            this.choose(this.activeIndex);
        } else if (event.key === "Escape") {
            event.preventDefault();
            this.close();
            this.focus();
        } else if (event.key === "Tab") {
            this.close();
        }
    }
}

if (!customElements.get("gym-select")) {
    customElements.define("gym-select", GymSelect);
}
