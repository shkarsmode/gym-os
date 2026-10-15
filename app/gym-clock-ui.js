// The gym clock chip and its ticker.
import { gymClockState, nextGymClockMarks, formatClock } from "../lib/gym-clock.js";
import { activeWorkoutFor, currentUser, editWorkout } from "./model.js";
import { state } from "./state.js";

// Thin wrappers kept so existing call sites stay unchanged. Saves are now
// optimistic + coalesced (fire-and-forget) — the UI updates instantly and the
// serializer guarantees one in-flight save with the latest state.
// ---- Gym clock --------------------------------------------------------
// Pure logic lives in lib/gym-clock.js (and is tested there); this file only wires
// it to the workout state and to the DOM.

export function touchGymClock(workoutItem) {
    if (!workoutItem) {
        return;
    }
    Object.assign(workoutItem, nextGymClockMarks(workoutItem));
}

export function gymClockChip(workoutItem) {
    const clock = gymClockState(workoutItem);
    if (!clock) {
        return "";
    }
    if (clock.overflow) {
        // Too long to be a plausible single session — show the anchor instead of a
        // runaway number, so a forgotten session reads as "started at 18:30".
        return `<span class="gym-clock stale" title="Сесія триває надто довго, щоб показувати секундомір"><i data-lucide="clock"></i><span>з ${clock.startLabel}</span></span>`;
    }
    return `<span class="gym-clock ${clock.live ? "live" : "done"}" data-gym-clock="1" title="${clock.live ? "У залі з " + clock.startLabel : "Від першого до останнього підходу"}"><i data-lucide="${clock.live ? "timer" : "check"}"></i><span data-gym-clock-value="1">${formatClock(clock.ms)}</span></span>`;
}

// One interval for the whole app: re-rendering the section every second would fight
// every input the user is typing into.
let gymClockTimer = null;

// Only chips that are actually on screen count. #focusLayer keeps its markup after
// the overlay is hidden, so an orphaned live chip in there used to keep the ticker
// alive — and each tick re-rendered the section, which re-armed the ticker, one new
// interval per second on every screen.
function liveClockValueNodes() {
    return [...document.querySelectorAll("[data-gym-clock].live [data-gym-clock-value]")]
        .filter((node) => {
            const layer = node.closest(".focus-layer");
            return !layer || layer.classList.contains("visible");
        });
}

function stopGymClockTicker() {
    clearInterval(gymClockTimer);
    gymClockTimer = null;
}

export function syncGymClockTicker() {
    if (!liveClockValueNodes().length) {
        stopGymClockTicker();
        return;
    }
    if (gymClockTimer) {
        return;
    }
    gymClockTimer = setInterval(() => {
        // A throw in here would NOT stop the interval, so everything is guarded and
        // the ticker shuts itself down rather than erroring once a second forever
        // (which is what logging out mid-workout used to do).
        try {
            const nodes = liveClockValueNodes();
            const user = state.database ? currentUser() : null;
            const workoutItem = user ? (editWorkout() || activeWorkoutFor(user.id)) : null;
            const clock = gymClockState(workoutItem);
            if (!nodes.length || !clock || !clock.live) {
                stopGymClockTicker();
                return;
            }
            nodes.forEach((node) => { node.textContent = formatClock(clock.ms); });
        } catch (error) {
            stopGymClockTicker();
        }
    }, 1000);
}
