// The rest timer and the floating timer.
import { seconds } from "../lib/format.js";
import { renderFocusTimerPhase, updateFocusTimer } from "./focus.js";
import { state } from "./state.js";
import { iconsIn } from "./util.js";

export function startTimer(duration) {
    clearInterval(state.timer.id);
    state.timer.duration = duration;
    state.timer.remaining = duration;
    state.timer.startedAt = Date.now();
    state.timer.running = true;
    state.timer.paused = false;
    state.timer.overtime = false;
    state.timer.collapsed = true; // normal flow starts collapsed to the side circle
    state.timer.id = setInterval(timerTick, 250);
    renderFloatingTimer();
}

// The countdown does NOT stop at zero: it signals once (sound/vibration/push)
// and flips into overtime, counting how long past the planned rest we are —
// the athlete sees the overshoot instead of the timer silently vanishing.
function timerTick() {
    if (state.timer.paused) {
        return;
    }
    const elapsed = Math.floor((Date.now() - state.timer.startedAt) / 1000);
    state.timer.remaining = state.timer.duration - elapsed;
    syncTimerOvertime(true);
    updateFloatingTimer();
    updateFocusTimer();
}

// Keep the overtime flag in line with the (possibly negative) remaining value.
// +15 during overtime can push the timer back into a normal countdown.
function syncTimerOvertime(signalOnCross) {
    const over = state.timer.remaining <= 0;
    if (over === state.timer.overtime) {
        return;
    }
    state.timer.overtime = over;
    if (over && signalOnCross) {
        timerSignal();
    }
    renderFloatingTimer();
    renderFocusTimerPhase();
}

function timerSignal() {
    try {
        const audioContext = window.AudioContext || window.webkitAudioContext;
        if (audioContext) {
            const context = new audioContext();
            const oscillator = context.createOscillator();
            const gain = context.createGain();
            oscillator.connect(gain);
            gain.connect(context.destination);
            oscillator.frequency.value = 880;
            gain.gain.setValueAtTime(0.0001, context.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.25, context.currentTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.6);
            oscillator.start();
            oscillator.stop(context.currentTime + 0.62);
        }
    } catch (error) {
        console.warn("Timer sound unavailable", error);
    }
    if (navigator.vibrate) {
        navigator.vibrate([180, 90, 180]);
    }
    if ("Notification" in window && Notification.permission === "granted") {
        new Notification("GymOS", { body: "Відпочинок завершено." });
    }
}

export function stopTimer() {
    clearInterval(state.timer.id);
    state.timer.id = null;
    state.timer.running = false;
    state.timer.paused = false;
    state.timer.overtime = false;
    renderFloatingTimer();
    renderFocusTimerPhase();
}

function pauseTimer() {
    if (!state.timer.running || state.timer.paused) {
        return;
    }
    state.timer.paused = true;
    renderFloatingTimer();
}

function resumeTimer() {
    if (!state.timer.running || !state.timer.paused) {
        return;
    }
    state.timer.paused = false;
    state.timer.startedAt = Date.now() - (state.timer.duration - state.timer.remaining) * 1000;
    renderFloatingTimer();
}

export function toggleTimerPause() {
    state.timer.paused ? resumeTimer() : pauseTimer();
}

export function addTimerTime(delta) {
    if (!state.timer.running) {
        if (delta > 0) {
            startTimer(delta);
        }
        return;
    }
    state.timer.duration = Math.max(5, state.timer.duration + delta);
    state.timer.remaining = state.timer.remaining + delta;
    state.timer.startedAt = Date.now() - (state.timer.duration - state.timer.remaining) * 1000;
    syncTimerOvertime(false); // -15 into / +15 out of overtime — no extra signal
    updateFloatingTimer();
    updateFocusTimer();
}

// Countdown shows M:SS; overtime shows how far past zero we are as +M:SS.
export function timerDisplayValue() {
    const remaining = Math.round(state.timer.remaining);
    return remaining >= 0 ? seconds(remaining) : `+${seconds(-remaining)}`;
}

export function renderFloatingTimer() {
    let node = document.getElementById("floatingTimer");
    // Focus mode renders the timer inside its own layer — hide the floating one.
    if (!state.timer.running || state.focus) {
        if (node) {
            node.classList.remove("visible");
        }
        return;
    }
    if (!node) {
        node = document.createElement("div");
        node.id = "floatingTimer";
        node.className = "floating-timer";
        document.body.appendChild(node);
    }
    const timer = state.timer;
    node.classList.toggle("collapsed", timer.collapsed);
    node.classList.toggle("overtime", timer.overtime);
    if (timer.collapsed) {
        // Side circle FAB: keeps the workout action bar visible; tap to expand.
        node.innerHTML = `
            <button class="floating-timer-circle" type="button" data-action="timer-expand" title="Розгорнути таймер" aria-label="Розгорнути таймер відпочинку">
                <span class="floating-timer-circle-ring" aria-hidden="true"></span>
                <span class="floating-timer-circle-value" id="floatingTimerValue">${timerDisplayValue()}</span>
            </button>`;
    } else {
        node.innerHTML = `
            <div class="floating-timer-bar"><span id="floatingTimerProgress"></span></div>
            <div class="floating-timer-body">
                <div class="floating-timer-label"><i data-lucide="timer"></i><span>${timer.overtime ? "Час вийшов" : "Відпочинок"}</span></div>
                <div class="floating-timer-value" id="floatingTimerValue">${timerDisplayValue()}</div>
                <div class="floating-timer-actions">
                    ${timer.overtime ? "" : `<button class="icon-button" type="button" data-action="timer-add" data-delta="-15" title="-15 с"><i data-lucide="minus"></i></button>
                    <button class="icon-button" type="button" data-action="timer-toggle" title="Пауза / продовжити"><i data-lucide="${timer.paused ? "play" : "pause"}"></i></button>
                    <button class="icon-button" type="button" data-action="timer-add" data-delta="15" title="+15 с"><i data-lucide="plus"></i></button>`}
                    <button class="icon-button" type="button" data-action="timer-collapse" title="Згорнути в кружок"><i data-lucide="chevron-down"></i></button>
                    <button class="icon-button" type="button" data-action="timer-stop" title="Зупинити"><i data-lucide="x"></i></button>
                </div>
            </div>`;
    }
    node.classList.add("visible");
    node.classList.toggle("paused", timer.paused);
    updateFloatingTimer();
    iconsIn(node);
}

function updateFloatingTimer() {
    const node = document.getElementById("floatingTimer");
    if (!node || !node.classList.contains("visible")) {
        return;
    }
    const value = node.querySelector("#floatingTimerValue");
    if (value) {
        value.textContent = timerDisplayValue();
    }
    const ratio = state.timer.overtime ? 1 : (state.timer.duration > 0 ? Math.max(0, Math.min(1, state.timer.remaining / state.timer.duration)) : 0);
    const progress = node.querySelector("#floatingTimerProgress");
    if (progress) {
        progress.style.width = `${ratio * 100}%`;
    }
    node.style.setProperty("--timer-ratio", String(ratio));
    node.classList.toggle("paused", state.timer.paused);
}

export function setTimerCollapsed(collapsed) {
    state.timer.collapsed = collapsed;
    renderFloatingTimer();
}
