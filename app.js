// GymOS entry. The app lives in app/*.js (split out of this file in 0.74.0, behaviour
// unchanged); this file wires the page-level listeners, in their original order.

import "./components/select.js";
import "./components/datepicker.js";
import { initialize } from "./app/boot.js";
import { renewSessionOnResume, startLiveStream, stopLiveStream } from "./app/live.js";
import { flushPendingWorkoutSaves } from "./app/persistence.js";
import { loadPresence, replayMissedCheers } from "./app/presence.js";
import { syncScreenWakeLock } from "./app/shell.js";
import { commitPendingRemovals } from "./app/undo.js";

document.addEventListener("DOMContentLoaded", initialize);

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
        flushPendingWorkoutSaves();
        commitPendingRemovals();
        // A backgrounded tab holding an open stream keeps the radio busy for events
        // it cannot show anyone. Phones suspend the connection anyway; closing it
        // deliberately means the reconnect happens on returning, not at some
        // arbitrary moment decided by the OS.
        stopLiveStream();
    } else {
        startLiveStream();
        loadPresence(true);
        replayMissedCheers();
        // The OS released the lock when the tab went away and will not give it back on
        // its own, so coming back has to ask again.
        syncScreenWakeLock();
        renewSessionOnResume();
    }
});

window.addEventListener("pagehide", () => {
    flushPendingWorkoutSaves();
    // An open undo window is a delete that has been promised but not sent. Left
    // unsettled it is simply a row that comes back from the dead on the next boot,
    // so the tab going away settles every one of them.
    commitPendingRemovals();
    stopLiveStream();
});

// iOS restores a backgrounded PWA from the back/forward cache without always firing
// visibilitychange, so a phone reopened from the app switcher could come back with a
// dead stream and nothing collected. pageshow fires in both cases.
window.addEventListener("pageshow", (event) => {
    if (!event.persisted) {
        return;
    }
    startLiveStream();
    loadPresence(true);
    replayMissedCheers();
    renewSessionOnResume();
});

(function gymosConsoleBanner() {
    if (typeof window === "undefined" || typeof console === "undefined") {
        return;
    }

    const version = (window.FORGE_CONFIG && window.FORGE_CONFIG.version) || "0.1.0";
    const repoUrl = "https://github.com/shkarsmode/gym-os";

    const ascii = [
        " ██████╗ ██╗   ██╗███╗   ███╗ ██████╗ ███████╗",
        "██╔════╝ ╚██╗ ██╔╝████╗ ████║██╔═══██╗██╔════╝",
        "██║  ███╗ ╚████╔╝ ██╔████╔██║██║   ██║███████╗",
        "██║   ██║  ╚██╔╝  ██║╚██╔╝██║██║   ██║╚════██║",
        "╚██████╔╝   ██║   ██║ ╚═╝ ██║╚██████╔╝███████║",
        " ╚═════╝    ╚═╝   ╚═╝     ╚═╝ ╚═════╝ ╚══════╝"
    ].join("\n");

    const style = {
        green: "color:#34e89e;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.15;text-shadow:0 0 10px rgba(52,232,158,.45);",
        pill: "background:linear-gradient(135deg,#34e89e,#0a8f5f);color:#04150f;font-weight:800;font-size:13px;letter-spacing:3px;padding:6px 16px;border-radius:9px;",
        tag: "color:#cfe9df;font-size:13px;font-weight:600;",
        muted: "color:#7c8a83;font-size:12px;",
        divider: "color:#1f2d27;font-size:12px;",
        stop: "color:#ff5c5c;font-size:22px;font-weight:800;text-shadow:0 0 10px rgba(255,92,92,.4);",
        warn: "color:#ffb3b3;font-size:13px;",
        link: "color:#34e89e;font-size:12px;font-weight:700;"
    };

    function print() {
        console.log("%c" + ascii, style.green);
        console.log("%c GYM PROGRESS OS ", style.pill);
        console.log("%c🏋️  Твій силовий прогрес під контролем — тренування, PR, рейтинги команди.", style.tag);
        console.log("%cv" + version + "   ·   NestJS + Prisma + PostgreSQL   ·   Vanilla JS SPA", style.muted);
        console.log("%c──────────────────────────────────────────────", style.divider);
        console.log("%c⛔ Стоп!", style.stop);
        console.log("%cЦе консоль для розробників. Не вставляй сюди код, який тобі хтось надіслав — це може дати доступ до твого акаунта GymOS (self-XSS).", style.warn);
        console.log("%c💚 Любиш залізо і код? → " + repoUrl + "   ·   повтор: gymosBanner()", style.link);
    }

    window.gymosBanner = print;

    if (!window.__gymosBannerShown) {
        window.__gymosBannerShown = true;
        print();
    }
})();
