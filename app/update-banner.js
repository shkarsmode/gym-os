// The «new version» banner.
import { flushPendingWorkoutSaves } from "./persistence.js";
import { iconsIn } from "./util.js";

// ---- Update prompt ----------------------------------------------------
//
// A deployed build only reaches an open tab on reload. index.html watches the service
// worker and fires "gymos:update-ready"; this shows a quiet bar rather than reloading,
// because a forced reload mid-set would throw away whatever the athlete was typing.
// Dismissing hides it for the session — the next visit picks the new build up anyway.
let updateBannerShown = false;

export function showUpdateBanner() {
    if (updateBannerShown || document.getElementById("updateBanner")) {
        return;
    }
    updateBannerShown = true;
    const node = document.createElement("div");
    node.id = "updateBanner";
    node.className = "update-banner";
    node.innerHTML = `<span class="update-banner-ico"><i data-lucide="sparkles"></i></span>
            <div class="update-banner-text"><strong>Є нова версія GymOS</strong><span>Онови, щоб отримати останні зміни.</span></div>
            <button class="button button-primary compact" type="button" data-action="apply-update"><i data-lucide="refresh-cw"></i>Оновити</button>
            <button class="icon-button update-banner-close" type="button" data-action="dismiss-update" aria-label="Пізніше"><i data-lucide="x"></i></button>`;
    document.body.appendChild(node);
    iconsIn(node);
    requestAnimationFrame(() => node.classList.add("visible"));
}

export function dismissUpdateBanner() {
    const node = document.getElementById("updateBanner");
    if (!node) {
        return;
    }
    node.classList.remove("visible");
    setTimeout(() => node.remove(), 260);
}

export async function applyUpdate() {
    // Flush anything the debounced saver is still holding, or reloading loses the
    // last set the user ticked.
    try {
        flushPendingWorkoutSaves();
    } catch (error) {
        // nothing pending
    }
    window.location.reload();
}
