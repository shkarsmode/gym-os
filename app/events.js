// Event wiring: bindEvents, drag reorder, refresh, pull-to-refresh, tooltips, the click / change / input handlers, action loaders.
import { escapeHtml, imageUrl } from "../lib/format.js";
import { sectionItems } from "../lib/constants.js";
import { SUPERSET_DEFAULT_REST } from "../lib/superset.js";
import { openProfileEditor, saveBodyweight, saveProfile, showUpgradeComingSoon } from "./account.js";
import {
    exportData, impersonateUser, importData, importExerciseCatalog, logout, resetCuratedExercises, resetData,
    stopImpersonation
} from "./account-admin.js";
import {
    changeDataMode, checkBackendConnection, loginWithGoogle, requestNotifications, setUserApproval,
    updateApiBaseUrl
} from "./admin-actions.js";
import { aiStatsSetFilter, aiStatsSetPeriod, loadAiStats } from "./ai-stats.js";
import {
    aiAddSet, aiApply, aiCatalogCards, aiChooseExercise, aiCollapsedKey, aiEditCardio, aiEditSet,
    aiEditWorkoutField, aiOpenCatalogPicker, aiParse, aiPickOption, aiRemoveCardio, aiRemoveExercise, aiRemoveSet,
    aiReset, aiState, aiUpdateCharCount
} from "./ai-workout.js";
import { initialize, loadDatabaseOrThrow } from "./boot.js";
import { phoneCalendarMonth } from "./calendar.js";
import { catalogFilterRow, refreshCatalog } from "./catalog.js";
import { reactToExercise, setUserRole } from "./components.js";
import { storage } from "./data.js";
import { openExercise, openWorkout } from "./exercise-detail.js";
import {
    approveExerciseEntry, deleteExerciseEntry, editExercise, exercisePickerCards, openAddExerciseModal,
    openCustomExercise, pickerBody, pickerMuscleContent, rejectExerciseEntry, saveCustomExercise, setPickerFilter,
    suggestExerciseMedia
} from "./exercise-picker.js";
import {
    disablePush, editCommentPrompt, enablePush, feedState, loadFeed, markAllNotificationsRead, openPost,
    openReportModal, removeComment, replyToComment, resolveReport, setFeedScope, submitComment, submitReport,
    toggleFeedReaction, togglePushCategory
} from "./feed.js";
import { deleteFeedbackEntry, submitFeedback, updateFeedbackStatus } from "./feedback.js";
import {
    closeFocusMode, focusAddSet, focusApplyHint, focusCompleteSet, focusFinishWorkout, focusJumpMember,
    focusJumpSet, focusShiftExercise, focusShowRest, focusStartSet, focusStepField, focusUncompleteSet,
    openFocusMode
} from "./focus.js";
import { editWorkout, isAdmin, loadMoreWorkoutsAction, ownWorkout } from "./model.js";
import {
    closeOnboarding, finishOnboarding, onboardingBack, onboardingNext, openOnboarding, renderOnboardingBody,
    setOnboardingField
} from "./onboarding.js";
import {
    closeConfirmOverlay, closeOverlay, closeSheet, dismissActiveConfirm, element, ensureScrollUnlockedIfNoOverlay,
    handleUserFacingError, openModal, openSheet, scrollLocked, showSyncIndicator
} from "./overlays.js";
import { answerPartner, invitePartner, setPartnerEditRight } from "./partner.js";
import { flushOfflineQueue, persistWorkout, schedulePersistWorkout } from "./persistence.js";
import { applyPreferences, setPref } from "./prefs.js";
import { cheerTapped, sendCheer } from "./presence.js";
import { decideAccess, requestAccess, setPrivacy } from "./privacy.js";
import { goToUser, handleRoute, navigate } from "./router.js";
import { frameGallery } from "./screens.js";
import { toggleSidebar } from "./settings.js";
import {
    ux2ApplyRest, ux2ExerciseRest, ux2FillFromLast, ux2MoveBlockBy, ux2OpenExerciseMenu, ux2OpenMetaSheet,
    ux2OpenReorderSheet, ux2OpenRestSheet, ux2OpenSessionMenu, ux2OpenSetMenu, ux2RestSeconds, ux2SetRest,
    ux2SetRestScope, ux2SetType
} from "./sheets.js";
import { recheckApproval, renderSection, renderShell } from "./shell.js";
import { state } from "./state.js";
import {
    SUPERSET_BUILDER_MAX_ROUNDS, SUPERSET_BUILDER_MIN_ROUNDS, createSupersetFrom, openSupersetBuilder,
    openSupersetMenu, refreshSupersetBuilder, resolveRestValue, supersetAddMember, supersetAddRound,
    supersetBuilder, supersetDelete, supersetMoveMember, supersetRemoveMember, supersetRemoveRound,
    supersetRestSeconds, supersetSetRest, supersetSplit, toggleSupersetPick
} from "./supersets.js";
import {
    deletePersonalTemplate, openSaveTemplateModal, saveWorkoutTemplate, startTemplateWorkout
} from "./templates.js";
import { addTimerTime, setTimerCollapsed, stopTimer, toggleTimerPause } from "./timer.js";
import {
    closeEmptyNote, openCardioModal, openDaySheet, openNote, openQuickAction, openWorkoutTypePicker,
    updateLastResultsFocus, updateTopbarContext, updateTopbarOffset
} from "./ui-helpers.js";
import { applyUpdate, dismissUpdateBanner, showUpdateBanner } from "./update-banner.js";
import { icons, iconsIn } from "./util.js";
import {
    applyWarmup, openWarmupSheet, refreshWarmupPreview, warmupDraft, warmupSetField, warmupStep
} from "./warmup-ui.js";
import { closeWatch, editWatchedSet, isWatchedTarget, openWatch, watchedSet } from "./watch.js";
import {
    addExercise, addSet, copyWorkoutAndStart, deleteCardio, deleteSet, deleteWorkout, finishWorkout,
    openWorkoutEditor, removeWorkoutExercise, reopenWorkout, saveCardio, startExistingWorkout, startNewWorkout,
    toggleSet, toggleTimedBlock, updateSetField, updateWorkoutMeta
} from "./workout-actions.js";
import { applyWeekdayWorkout, fillSetFromLast, liveUpdateWeightDeltas, stepSetField } from "./workout-screen.js";

export function bindEvents() {
    // Run-once. initialize() became re-entrant when renderLoadFailure gained a
    // "retry-load" action, and the named handlers below dedupe per the DOM spec
    // while the anonymous ones do NOT. setupExerciseReorder in particular adds a
    // fresh document pointerdown listener each call, so N retries meant one grip
    // press ran commitExerciseReorder N times — silently scrambling exercise order
    // and persisting it. A static property, not a `let`: bindEvents is hoisted and
    // called from initialize(), so a block-scoped flag risks a TDZ error.
    if (bindEvents.done) {
        return;
    }
    bindEvents.done = true;
    document.addEventListener("click", handleClick);
    document.addEventListener("change", handleChange);
    document.addEventListener("input", handleInput);
    /*
     * The «Минулого разу» strip steps aside while a set field is being edited.
     *
     * Not because of typing — because of what happens when focus LEAVES. The keyboard
     * lifts the view to reveal the input, and when it goes the strip is sticky right
     * on top of that input. Moving the page to fix it never felt right, so the strip
     * moves instead — and only its opacity, so the layout never shifts.
     *
     * It returns on the next scroll rather than on blur, since blur is the exact
     * moment it would land on the input. The delay guards against the scroll the
     * closing keyboard itself produces.
     */
    let editingField = false;
    let scrollYAtBlur = 0;
    const isSetField = (node) => Boolean(node && node.closest
        && node.closest(".set-field, .workout-exercise textarea"));
    document.addEventListener("focusin", (event) => {
        if (isSetField(event.target)) {
            editingField = true;
            document.body.classList.add("is-editing-set");
        }
    });
    document.addEventListener("focusout", (event) => {
        if (isSetField(event.target)) {
            editingField = false;
            scrollYAtBlur = window.scrollY;
        }
    });
    window.addEventListener("scroll", () => {
        if (!document.body.classList.contains("is-editing-set")) {
            return;
        }
        // Tracked in a flag rather than read from document.activeElement: focus state
        // is not reliably readable in every context, and getting it wrong here means
        // the strip reappears mid-edit — the exact thing being prevented.
        //
        // Restored when the page has ACTUALLY MOVED since the blur, not merely when a
        // scroll event arrived. Closing the keyboard fires scroll events of its own
        // without the reader doing anything, and treating those as "they have looked
        // away" put the strip straight back on the input. Distance is the honest
        // signal, and it does not depend on timing that varies by device.
        if (editingField || Math.abs(window.scrollY - scrollYAtBlur) <= 24) {
            return;
        }
        if (document.body.classList.contains("strip-restoring")) {
            return; // a handoff is already running
        }
        /*
         * Going back to sticky in two phases, because `position` cannot be animated.
         *
         * The strip is sitting in its own slot in the flow; becoming sticky again moves
         * it to the top of the card in a single frame, which is the snap that was
         * reported. So it fades out where it stands, changes position while nobody can
         * see it, and fades back in stuck.
         */
        document.body.classList.add("strip-restoring");
        window.setTimeout(() => {
            document.body.classList.remove("is-editing-set");
            // A separate tick, so the browser paints the element at its new position
            // still transparent before the fade-in starts.
            window.setTimeout(() => document.body.classList.remove("strip-restoring"), 30);
        }, 180);
    }, { passive: true });
    window.addEventListener("hashchange", handleRoute);
    window.addEventListener("gymos:update-ready", showUpdateBanner);
    // Capture phase: blur does not bubble.
    document.addEventListener("blur", (event) => {
        const field = event.target;
        if (field && field.tagName === "TEXTAREA" && field.dataset.noteKey) {
            closeEmptyNote(field.dataset.noteKey, field.value);
        }
    }, true);
    window.addEventListener("scroll", updateLastResultsFocus, { passive: true });
    window.addEventListener("scroll", updateTopbarContext, { passive: true });
    // The event can fire before the app finishes booting, in which case index.html's
    // dispatch lands on nobody — index.html sets the flag too, so re-check here.
    if (window.__gymosUpdateReady) {
        showUpdateBanner();
    }
    // Moved here from initialize() so the run-once guard above covers it too —
    // it is an anonymous listener and would otherwise stack on every retry.
    window.addEventListener("online", () => flushOfflineQueue());
    // Guarantee scrolling is never left frozen by a stray overlay lock.
    window.addEventListener("focus", ensureScrollUnlockedIfNoOverlay);
    window.addEventListener("pageshow", ensureScrollUnlockedIfNoOverlay);
    window.addEventListener("resize", () => {
        clearTimeout(bindEvents.resizeTimer);
        bindEvents.resizeTimer = setTimeout(updateTopbarOffset, 150);
    });
    // iOS Safari ignores user-scalable=no but honours blocking these pinch
    // gesture events — stops the page (and inputs) from zooming on phones.
    ["gesturestart", "gesturechange", "gestureend"].forEach((eventName) => {
        document.addEventListener(eventName, (event) => event.preventDefault(), { passive: false });
    });
    element("modalBackdrop").addEventListener("click", closeOverlay);
    element("modalBackdrop2").addEventListener("click", closeSheet);
    element("openQuickActionButton").addEventListener("click", openQuickAction);
    element("openUserSwitcherButton").addEventListener("click", () => navigate("profile"));
    const collapseButton = element("sidebarCollapseButton");
    if (collapseButton) {
        collapseButton.addEventListener("click", toggleSidebar);
    }
    setupTooltips();
    setupPullToRefresh();
    setupExerciseReorder();
}

// Drag-and-drop reorder of exercises within a workout. One delegated
// pointerdown on the grip handle drives it, so it survives re-renders and
// works identically for touch and mouse (Pointer Events). During a drag the
// grabbed card follows the finger while the others slide open a gap via
// transforms (no live DOM churn); we commit the new order only on release.
function setupExerciseReorder() {
    document.addEventListener("pointerdown", (event) => {
        if (event.button != null && event.button !== 0) {
            return; // left button / touch / pen only
        }
        const handle = event.target.closest && event.target.closest(".we-drag-handle");
        if (!handle) {
            return;
        }
        const list = handle.closest(".workout-exercise-list[data-reorder]");
        if (!list) {
            return;
        }
        beginExerciseDrag(event, handle, list);
    });
}

let reorderAutoScrollTimer = null;

function beginExerciseDrag(event, handle, list) {
    event.preventDefault();
    const dragged = handle.closest(".workout-exercise");
    const cards = Array.prototype.slice.call(list.querySelectorAll(".workout-exercise"));
    const dragIndex = cards.indexOf(dragged);
    if (dragIndex < 0 || cards.length < 2) {
        return;
    }
    const pointerId = event.pointerId;
    const grabClientY = event.clientY;
    let lastClientY = event.clientY;
    let targetIndex = dragIndex;
    let frame = null;

    try { handle.setPointerCapture(pointerId); } catch (_) {}
    // Collapse every card to just grip + name + muscle group. The whole list
    // then fits on screen, so the transforms stay tiny and uniform and the
    // gifs / set-lists / notes stop repainting — the drag is smooth on phones
    // and you can see every exercise at once. Measure geometry AFTER collapsing
    // (and after clamping the now-shorter scroll) so hit-testing matches what's
    // on screen; all coordinates are kept in DOCUMENT space so edge auto-scroll
    // can't invalidate them mid-drag.
    document.body.classList.add("is-reordering");
    list.classList.add("reordering");
    dragged.classList.add("we-dragging");
    void list.offsetHeight; // flush layout with the collapsed heights
    const maxScroll0 = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    if (window.scrollY > maxScroll0) {
        window.scrollTo(0, maxScroll0);
    }
    const scroll0 = window.scrollY;
    const rects = cards.map((el) => el.getBoundingClientRect());
    const centersDoc = rects.map((r) => r.top + r.height / 2 + scroll0);
    const gap = cards.length > 1 ? Math.max(6, rects[1].top - rects[0].bottom) : 10;
    const dragH = rects[dragIndex].height;
    const shift = dragH + gap;
    const naturalTopDoc = rects[dragIndex].top + scroll0;
    // Finger's offset from the collapsed card's top, clamped — so if the collapse
    // scrolled the card out from under the finger, the card re-anchors back to it.
    const pointerOffset = Math.max(6, Math.min(dragH - 6, grabClientY - rects[dragIndex].top));

    dragged.style.transition = "none";
    cards.forEach((el, i) => {
        if (i !== dragIndex) {
            el.style.transition = "transform 0.18s cubic-bezier(0.22,1,0.36,1)";
        }
    });

    const apply = () => {
        frame = null;
        const desiredTopDoc = (lastClientY + window.scrollY) - pointerOffset;
        dragged.style.transform = `translateY(${desiredTopDoc - naturalTopDoc}px) scale(1.03)`;
        const draggedCenter = desiredTopDoc + dragH / 2;
        let up = 0;
        let down = 0;
        cards.forEach((el, i) => {
            if (i === dragIndex) {
                return;
            }
            if (i < dragIndex) {
                if (draggedCenter < centersDoc[i]) {
                    el.style.transform = `translateY(${shift}px)`;
                    up++;
                } else {
                    el.style.transform = "translateY(0)";
                }
            } else if (draggedCenter > centersDoc[i]) {
                el.style.transform = `translateY(${-shift}px)`;
                down++;
            } else {
                el.style.transform = "translateY(0)";
            }
        });
        targetIndex = up ? dragIndex - up : down ? dragIndex + down : dragIndex;
    };
    const schedule = () => {
        if (!frame) {
            frame = requestAnimationFrame(apply);
        }
    };
    apply(); // place the lifted card (re-anchors it under the finger if the collapse shifted it)

    const edgeAutoScroll = () => {
        const margin = 84;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        let dir = 0;
        if (lastClientY < margin && window.scrollY > 0) {
            dir = -1;
        } else if (lastClientY > window.innerHeight - margin && window.scrollY < max) {
            dir = 1;
        }
        if (!dir) {
            stopReorderAutoScroll();
            return;
        }
        if (reorderAutoScrollTimer) {
            return;
        }
        reorderAutoScrollTimer = setInterval(() => {
            window.scrollBy(0, dir * 11);
            schedule();
        }, 16);
    };

    const onMove = (event2) => {
        if (event2.pointerId !== pointerId) {
            return;
        }
        event2.preventDefault();
        lastClientY = event2.clientY;
        schedule();
        edgeAutoScroll();
    };
    const onUp = (event2) => {
        if (event2.pointerId !== pointerId) {
            return;
        }
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
        stopReorderAutoScroll();
        if (frame) {
            cancelAnimationFrame(frame);
            frame = null;
        }
        document.body.classList.remove("is-reordering");
        list.classList.remove("reordering");
        dragged.classList.remove("we-dragging");
        cards.forEach((el) => {
            el.style.transition = "";
            el.style.transform = "";
        });
        try { handle.releasePointerCapture(pointerId); } catch (_) {}
        commitExerciseReorder(list, dragIndex, targetIndex);
    };
    document.addEventListener("pointermove", onMove, { passive: false });
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
}

function stopReorderAutoScroll() {
    if (reorderAutoScrollTimer) {
        clearInterval(reorderAutoScrollTimer);
        reorderAutoScrollTimer = null;
    }
}

function commitExerciseReorder(list, fromIndex, toIndex) {
    if (fromIndex === toIndex) {
        return;
    }
    const workoutId = list.dataset.workoutId;
    const workoutItem = (workoutId && ownWorkout(workoutId)) || editWorkout();
    if (!workoutItem) {
        return;
    }
    const ordered = workoutItem.exercises.slice().sort((left, right) => left.order - right.order);
    if (fromIndex >= ordered.length || toIndex >= ordered.length) {
        return;
    }
    const [moved] = ordered.splice(fromIndex, 1);
    ordered.splice(toIndex, 0, moved);
    ordered.forEach((exercise, index) => {
        exercise.order = index + 1;
    });
    workoutItem.updatedAt = new Date().toISOString();
    persistWorkout(workoutItem);
    renderSection();
}

// Re-fetch everything from the backend and re-render the current view. Used by
// pull-to-refresh; the per-user /export feed is uncached so this always gets
// fresh data. Local mode just re-renders (nothing to fetch).
async function refreshData() {
    if (storage.mode !== "api") {
        renderShell();
        renderSection();
        return;
    }
    showSyncIndicator("loading", "Оновлення…");
    try {
        state.database = await loadDatabaseOrThrow();
        state.profileUserId = state.database.currentUserId;
    // Seeded from every payload install: null under the legacy shape (all history is
    // already present), a cursor under the windowed one.
    state.workoutsCursor = state.database.workoutsCursor || null;
        renderShell();
        renderSection();
        showSyncIndicator("success", "Оновлено");
    } catch (error) {
        handleUserFacingError(error, "refresh");
    }
}

// Pull-to-refresh, the way a native list does it.
//
// The old one woke up on a 6 px nudge at the top of any screen and floated a ring over
// the header — so it appeared constantly, mostly while nobody meant it. Now: nothing at
// all until the finger has clearly pulled DOWN (a dead zone, and a sideways swipe never
// counts), then the ring slides out from under the header, fills as you pull, ticks once
// at the threshold, and refreshes only if you let go past it. Off on the workout screen
// entirely: mid-session a refresh is never what was meant, and live sync keeps that
// screen current anyway. Touch-primary devices only.
function setupPullToRefresh() {
    const touchPrimary = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    if (!touchPrimary) {
        return;
    }
    if (document.getElementById("ptrIndicator")) {
        return;
    }
    const DEAD_ZONE = 28; // finger travel before anything shows
    const THRESHOLD = 64; // ring travel (after resistance) that refreshes on release
    const MAX = 110;
    const indicator = document.createElement("div");
    indicator.id = "ptrIndicator";
    indicator.className = "ptr-indicator";
    indicator.setAttribute("aria-hidden", "true");
    indicator.innerHTML = `<svg class="ptr-ring" viewBox="0 0 36 36" width="22" height="22" aria-hidden="true"><circle class="ptr-track" cx="18" cy="18" r="15"></circle><circle class="ptr-prog" cx="18" cy="18" r="15" transform="rotate(-90 18 18)"></circle></svg>`;
    document.body.appendChild(indicator);
    const prog = indicator.querySelector(".ptr-prog");
    const ring = indicator.querySelector(".ptr-ring");
    const CIRC = 2 * Math.PI * 15; // ~94.25
    prog.style.strokeDasharray = String(CIRC);
    prog.style.strokeDashoffset = String(CIRC);

    let startX = 0;
    let startY = 0;
    let armed = false;
    let pulling = false;
    let refreshing = false;
    let ticked = false;
    let pull = 0;
    let base = 0;

    const atTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 0;

    // Where the ring parks: just under the header, which it slides out from behind.
    const headerBottom = () => {
        const bar = document.querySelector(".topbar");
        if (!bar || getComputedStyle(bar).display === "none") {
            return 0;
        }
        return Math.max(0, bar.getBoundingClientRect().bottom);
    };

    // Screens where a pull is never a refresh.
    const blocked = () => scrollLocked
        || state.section === "workout"
        || Boolean(state.focus);

    // PTR must NOT hijack a drag that belongs to an inner scrollable region
    // (a list, a portaled dropdown panel, any overflow:auto box). If the touch
    // starts inside one that can actually scroll, let it scroll instead.
    const insideScrollable = (node) => {
        while (node && node !== document.body && node !== document.documentElement) {
            if (node.nodeType === 1 && node.scrollHeight > node.clientHeight) {
                const overflowY = getComputedStyle(node).overflowY;
                if (overflowY === "auto" || overflowY === "scroll") {
                    return true;
                }
            }
            node = node.parentElement;
        }
        return false;
    };

    function place(px, animate) {
        pull = px;
        indicator.style.transition = animate ? "transform 0.28s cubic-bezier(0.22,1,0.36,1), opacity 0.2s ease" : "none";
        // At 0 the ring sits fully behind the header; it comes out as the pull grows.
        indicator.style.transform = `translateX(-50%) translateY(${base - 46 + Math.min(px, MAX)}px)`;
        indicator.style.opacity = px > 0 || refreshing ? "1" : "0";
        const ratio = Math.max(0, Math.min(1, px / THRESHOLD));
        prog.style.strokeDashoffset = String(CIRC * (1 - ratio));
        ring.style.transform = refreshing ? "" : `rotate(${ratio * 270}deg)`;
        const ready = ratio >= 1 && !refreshing;
        indicator.classList.toggle("ready", ready);
        // One tick when the pull becomes a refresh — the threshold should be felt, not
        // guessed at.
        if (ready && !ticked) {
            ticked = true;
            if (navigator.vibrate) {
                navigator.vibrate(8);
            }
        } else if (!ready) {
            ticked = false;
        }
    }

    function reset(animate) {
        pulling = false;
        indicator.classList.remove("ptr-loading", "ready");
        place(0, animate);
    }

    async function trigger() {
        refreshing = true;
        indicator.classList.add("ptr-loading");
        indicator.classList.remove("ready");
        indicator.style.transition = "transform 0.26s cubic-bezier(0.22,1,0.36,1)";
        indicator.style.transform = `translateX(-50%) translateY(${base + 12}px)`;
        indicator.style.opacity = "1";
        try {
            await refreshData();
        } finally {
            refreshing = false;
            reset(true);
        }
    }

    document.addEventListener("touchstart", (event) => {
        armed = false;
        if (refreshing || event.touches.length !== 1 || blocked()) {
            return;
        }
        if (event.target.closest(".toast, .drawer-layer, .modal-layer, .focus-layer, .mobile-navigation, .floating-timer, .gselect-panel, .gdate-panel, .we-drag-handle, gym-select, gym-date, input, textarea, select, [contenteditable]")) {
            return;
        }
        if (insideScrollable(event.target) || !atTop()) {
            return;
        }
        startX = event.touches[0].clientX;
        startY = event.touches[0].clientY;
        base = headerBottom();
        armed = true;
        pulling = false;
    }, { passive: true });

    document.addEventListener("touchmove", (event) => {
        if (!armed || refreshing) {
            return;
        }
        const dx = event.touches[0].clientX - startX;
        const dy = event.touches[0].clientY - startY;
        if (!pulling) {
            // A sideways swipe (the presence row, a chip strip) is never a pull, and
            // neither is scrolling the page down.
            if ((Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) || dy < -6) {
                armed = false;
                return;
            }
            if (dy <= 0) {
                return;
            }
        }
        if (!atTop()) {
            armed = false;
            if (pulling) {
                reset(true);
            }
            return;
        }
        // At the very top and moving down: the only native thing left is the bounce,
        // which the pull replaces.
        event.preventDefault();
        const distance = dy - DEAD_ZONE;
        if (distance <= 0) {
            if (pulling) {
                place(0, false);
            }
            return;
        }
        pulling = true;
        // Rubber band: easy at first, stiffer towards the end, never past MAX.
        place(MAX * (1 - Math.exp(-distance / (MAX * 1.2))), false);
    }, { passive: false });

    const onEnd = () => {
        if (!armed) {
            return;
        }
        armed = false;
        if (pulling && pull >= THRESHOLD && !refreshing) {
            trigger();
        } else if (pulling) {
            reset(true);
        }
    };
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
}

// Shared, delegated tooltip engine for [data-tip-body] triggers (see infoTip).
// One floating bubble, positioned in JS so it never clips inside cards.
// Hover opens after a 200ms delay (no flicker on quick mouse passes); tap
// toggles on touch; focus opens for keyboard users.
function setupTooltips() {
    let tipEl = null;
    let arrowEl = null;
    let contentEl = null;
    let showTimer = null;
    let activeTrigger = null;
    // True when the most recent focus came from a pointer (mouse/touch), so
    // focusin won't open the tooltip that the click handler then toggles.
    let pointerFocus = false;

    function ensureEl() {
        if (tipEl) {
            return;
        }
        tipEl = document.createElement("div");
        tipEl.className = "app-tooltip";
        tipEl.id = "appTooltip";
        tipEl.setAttribute("role", "tooltip");
        arrowEl = document.createElement("div");
        arrowEl.className = "app-tooltip-arrow up";
        contentEl = document.createElement("div");
        contentEl.className = "app-tooltip-content";
        tipEl.append(arrowEl, contentEl);
        document.body.appendChild(tipEl);
    }

    function position(trigger) {
        const rect = trigger.getBoundingClientRect();
        // offsetWidth/Height ignore the CSS transform (scale .98 during the
        // open transition), so the measurement is stable and exact.
        const tw = tipEl.offsetWidth;
        const th = tipEl.offsetHeight;
        const margin = 8;
        const gap = 10;
        const centerX = rect.left + rect.width / 2;
        const left = Math.max(margin, Math.min(centerX - tw / 2, window.innerWidth - tw - margin));
        let top = rect.top - th - gap;
        let below = false;
        if (top < margin) {
            top = rect.bottom + gap;
            below = true;
        }
        // Keep fully on-screen vertically on short viewports too.
        top = Math.max(margin, Math.min(top, window.innerHeight - th - margin));
        tipEl.style.left = `${Math.round(left)}px`;
        tipEl.style.top = `${Math.round(top)}px`;
        const arrowLeft = Math.max(12, Math.min(centerX - left - 5, tw - 22));
        arrowEl.style.left = `${Math.round(arrowLeft)}px`;
        if (below) {
            arrowEl.className = "app-tooltip-arrow up";
            arrowEl.style.top = "-5px";
        } else {
            arrowEl.className = "app-tooltip-arrow down";
            arrowEl.style.top = `${Math.round(th - 5)}px`;
        }
    }

    function show(trigger) {
        ensureEl();
        const title = trigger.getAttribute("data-tip-title") || "";
        const body = trigger.getAttribute("data-tip-body") || "";
        if (!body) {
            return;
        }
        contentEl.innerHTML = `${title ? `<div class="app-tooltip-title">${escapeHtml(title)}</div>` : ""}<div class="app-tooltip-body">${escapeHtml(body)}</div>`;
        activeTrigger = trigger;
        trigger.setAttribute("aria-describedby", "appTooltip");
        tipEl.style.left = "-9999px";
        tipEl.style.top = "-9999px";
        tipEl.classList.add("visible");
        position(trigger);
    }

    function hide() {
        if (showTimer) {
            clearTimeout(showTimer);
            showTimer = null;
        }
        if (activeTrigger) {
            activeTrigger.removeAttribute("aria-describedby");
            activeTrigger = null;
        }
        if (tipEl) {
            tipEl.classList.remove("visible");
        }
    }

    const isCoarse = () => !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

    // ---- Mobile: a clean bottom sheet instead of a finicky floating tip ----
    let sheet = null;
    let sheetBackdrop = null;
    let sheetTitle = null;
    let sheetBody = null;

    function closeSheet() {
        if (sheet) {
            sheet.classList.remove("visible");
            sheet.style.transform = "";
        }
        if (sheetBackdrop) {
            sheetBackdrop.classList.remove("visible");
        }
    }

    function ensureSheet() {
        if (sheet) {
            return;
        }
        sheetBackdrop = document.createElement("div");
        sheetBackdrop.className = "tip-sheet-backdrop";
        sheet = document.createElement("div");
        sheet.className = "tip-sheet";
        sheet.setAttribute("role", "dialog");
        sheet.setAttribute("aria-modal", "true");
        sheet.innerHTML = `<span class="tip-sheet-handle" aria-hidden="true"></span><div class="tip-sheet-head"><span class="tip-sheet-icon"><i data-lucide="info"></i></span><h4 class="tip-sheet-title"></h4></div><p class="tip-sheet-body"></p>`;
        document.body.append(sheetBackdrop, sheet);
        sheetTitle = sheet.querySelector(".tip-sheet-title");
        sheetBody = sheet.querySelector(".tip-sheet-body");
        sheetBackdrop.addEventListener("click", closeSheet);

        // swipe the sheet down to dismiss
        let startY = 0;
        let deltaY = 0;
        let dragging = false;
        sheet.addEventListener("pointerdown", (event) => {
            startY = event.clientY;
            deltaY = 0;
            dragging = true;
            sheet.style.transition = "none";
        });
        sheet.addEventListener("pointermove", (event) => {
            if (!dragging) {
                return;
            }
            deltaY = Math.max(0, event.clientY - startY);
            sheet.style.transform = `translateY(${deltaY}px)`;
        });
        const endDrag = () => {
            if (!dragging) {
                return;
            }
            dragging = false;
            sheet.style.transition = "";
            if (deltaY > 90) {
                closeSheet();
            } else {
                sheet.style.transform = "";
            }
        };
        sheet.addEventListener("pointerup", endDrag);
        sheet.addEventListener("pointercancel", endDrag);
    }

    function openSheet(trigger) {
        const title = trigger.getAttribute("data-tip-title") || "";
        const body = trigger.getAttribute("data-tip-body") || "";
        if (!body) {
            return;
        }
        ensureSheet();
        sheetTitle.textContent = title;
        sheetBody.textContent = body;
        if (window.lucide) {
            window.lucide.createIcons({ root: sheet });
        }
        sheet.style.transform = "";
        sheetBackdrop.classList.add("visible");
        const reveal = () => sheet.classList.add("visible");
        requestAnimationFrame(reveal);
        setTimeout(reveal, 60); // fallback if rAF is throttled
    }

    // Touch devices synthesise mouseover/mouseout on tap (the flicker/lag) —
    // skip the hover path there entirely; tap opens the sheet instead.
    document.addEventListener("mouseover", (event) => {
        if (isCoarse()) {
            return;
        }
        const trigger = event.target.closest("[data-tip-body]");
        if (!trigger || trigger === activeTrigger) {
            return;
        }
        if (showTimer) {
            clearTimeout(showTimer);
        }
        showTimer = setTimeout(() => show(trigger), 200);
    });

    document.addEventListener("mouseout", (event) => {
        if (isCoarse()) {
            return;
        }
        const trigger = event.target.closest("[data-tip-body]");
        if (!trigger) {
            return;
        }
        if (event.relatedTarget && trigger.contains(event.relatedTarget)) {
            return;
        }
        hide();
    });

    // Capture phase so a tap on the trigger doesn't bubble to a parent action.
    document.addEventListener("click", (event) => {
        pointerFocus = false;
        const trigger = event.target.closest("[data-tip-body]");
        if (trigger) {
            event.preventDefault();
            event.stopPropagation();
            if (isCoarse()) {
                openSheet(trigger);
                return;
            }
            if (activeTrigger === trigger && tipEl && tipEl.classList.contains("visible")) {
                hide();
            } else {
                if (showTimer) {
                    clearTimeout(showTimer);
                }
                show(trigger);
            }
            return;
        }
        if (tipEl && tipEl.classList.contains("visible")) {
            hide();
        }
    }, true);

    document.addEventListener("pointerdown", (event) => {
        pointerFocus = !!(event.target.closest && event.target.closest("[data-tip-body]"));
    }, true);
    document.addEventListener("pointerup", () => {
        pointerFocus = false;
    }, true);
    document.addEventListener("focusin", (event) => {
        if (isCoarse()) {
            return;
        }
        const trigger = event.target.closest && event.target.closest("[data-tip-body]");
        if (trigger && !pointerFocus) {
            show(trigger);
        }
        pointerFocus = false;
    });
    document.addEventListener("focusout", (event) => {
        const trigger = event.target.closest && event.target.closest("[data-tip-body]");
        if (trigger) {
            hide();
        }
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            hide();
            // Topmost first, and then STOP. Falling through would close the sheet the
            // confirmation was asked from and leave the confirmation over nothing.
            if (dismissActiveConfirm()) {
                return;
            }
            closeSheet();
            // Focus mode exits on Escape, but only when nothing is stacked above it.
            if (state.focus && element("modalBackdrop").classList.contains("hidden")) {
                closeFocusMode();
            }
        }
    });
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", () => { hide(); closeSheet(); });
    window.addEventListener("hashchange", () => { hide(); closeSheet(); });
}

async function handleClick(event) {
    const actionElement = event.target.closest("[data-action]");
    if (!actionElement) {
        return;
    }

    const action = actionElement.dataset.action;
    const actions = {
        navigate: () => navigate(actionElement.dataset.section),
        "start-workout": () => startNewWorkout(actionElement && actionElement.dataset ? actionElement.dataset.date : undefined),
        "edit-workout": () => openWorkoutEditor(actionElement.dataset.workoutId),
        "reopen-workout": () => reopenWorkout(actionElement.dataset.workoutId),
        "start-existing-workout": () => startExistingWorkout(actionElement.dataset.workoutId),
        "apply-weekday-workout": () => applyWeekdayWorkout(actionElement.dataset.workoutId),
        "copy-workout-start": () => copyWorkoutAndStart(actionElement.dataset.workoutId),
        "feed-scope": () => setFeedScope(actionElement.dataset.scope),
        "cheer": () => cheerTapped(actionElement.dataset.workoutId),
        "set-privacy": () => setPrivacy(actionElement.dataset.value === "1"),
        "partner-invite": () => invitePartner(actionElement.dataset.userId),
        "watch-workout": () => openWatch(actionElement.dataset.workoutId),
        "close-watch": closeWatch,
        "partner-answer": () => answerPartner(actionElement.dataset.id, actionElement.dataset.decision),
        "partner-edit-right": () => setPartnerEditRight(actionElement.dataset.id, actionElement.checked),
        "request-access": () => requestAccess(actionElement.dataset.ownerId),
        "access-decide": () => decideAccess(actionElement.dataset.grantId, actionElement.dataset.decision),
        "cheer-pick": () => sendCheer(actionElement.dataset.workoutId, actionElement.dataset.emoji),
        "feed-retry": () => loadFeed(feedState.scope, false),
        "feed-more": () => loadFeed(feedState.scope, true),
        "feed-react": () => toggleFeedReaction(actionElement.dataset.type, actionElement.dataset.id, actionElement),
        "open-post": () => openPost(actionElement.dataset.type, actionElement.dataset.id),
        "post-comment": submitComment,
        "reply-comment": () => replyToComment(actionElement.dataset.commentId, actionElement.dataset.name),
        "edit-comment": () => editCommentPrompt(actionElement.dataset.commentId),
        "delete-comment": () => removeComment(actionElement.dataset.commentId),
        "open-report": () => openReportModal(actionElement.dataset.type, actionElement.dataset.id),
        "submit-report": () => submitReport(actionElement.dataset.type, actionElement.dataset.id),
        "resolve-report": () => resolveReport(actionElement.dataset.reportId, actionElement.dataset.resolve),
        "mark-all-read": markAllNotificationsRead,
        "enable-push": enablePush,
        "disable-push": disablePush,
        "impersonate-user": () => impersonateUser(actionElement.dataset.userId),
        "stop-impersonation": stopImpersonation,
        "delete-workout": () => deleteWorkout(actionElement.dataset.workoutId),
        "open-day-sheet": () => openDaySheet(actionElement.dataset.date),
        "pcal-step": () => {
            const month = phoneCalendarMonth();
            state.pcalMonth = new Date(month.getFullYear(), month.getMonth() + (Number(actionElement.dataset.delta) || 0), 1);
            renderSection();
        },
        "pcal-today": () => { state.pcalMonth = null; renderSection(); },
        "pcal-scope": () => { state.filters.calendarScope = actionElement.dataset.scope === "team" ? "team" : "mine"; renderSection(); },
        "open-add-exercise-modal": () => { state.replaceExerciseTarget = null; openAddExerciseModal(); },
        "replace-exercise": () => { state.replaceExerciseTarget = actionElement.dataset.workoutExerciseId; openAddExerciseModal(); },
        "open-muscle-grid": () => openSheet(pickerMuscleContent(), { fullscreen: true }),
        "pick-muscle": () => {
            state.filters.pickerMuscle = actionElement.dataset.value;
            closeSheet();
            const pickerBodyEl = document.getElementById("exercisePickerBody");
            if (pickerBodyEl) {
                pickerBodyEl.innerHTML = pickerBody();
                iconsIn(element("modalLayer"));
            }
            // Catalog uses the same visual muscle grid — refresh its filter row + grid.
            const catalogFilters = document.getElementById("exerciseCatalogFilters");
            if (catalogFilters) {
                catalogFilters.innerHTML = catalogFilterRow();
                iconsIn(catalogFilters);
            }
            refreshCatalog();
        },
        "muscle-grid-back": closeSheet,
        "open-save-template": () => openSaveTemplateModal(actionElement.dataset.workoutId),
        "save-workout-template": () => saveWorkoutTemplate(actionElement.dataset.workoutId),
        "start-template-workout": () => startTemplateWorkout(actionElement.dataset.templateId),
        "delete-template": () => deletePersonalTemplate(actionElement.dataset.templateId),
        "admin-frame-test": () => { if (isAdmin()) { openModal(frameGallery(), { fullscreen: true }); } },
        "apply-frame-override": () => { state.frameOverride = Number(actionElement.dataset.tier); renderSection(); element("modalLayer").innerHTML = frameGallery(); iconsIn(element("modalLayer")); },
        "reset-frame-override": () => { state.frameOverride = null; renderSection(); element("modalLayer").innerHTML = frameGallery(); iconsIn(element("modalLayer")); },
        "picker-filter": () => setPickerFilter(actionElement.dataset.key, actionElement.dataset.value),
        "add-exercise": () => addExercise(actionElement.dataset.exerciseId),
        "remove-workout-exercise": () => removeWorkoutExercise(actionElement.dataset.workoutExerciseId),
        "open-custom-exercise": () => openCustomExercise(),
        "save-custom-exercise": saveCustomExercise,
        "suggest-exercise-media": suggestExerciseMedia,
        "edit-exercise": () => editExercise(actionElement.dataset.exerciseId),
        "delete-exercise": () => deleteExerciseEntry(actionElement.dataset.exerciseId),
        "approve-exercise": () => approveExerciseEntry(actionElement.dataset.exerciseId),
        "reject-exercise": () => rejectExerciseEntry(actionElement.dataset.exerciseId),
        "upgrade-plan": showUpgradeComingSoon,
        "open-changelog": () => { closeOverlay(); navigate("changelog"); },
        "activity-scope": () => { state.filters.activityScope = actionElement.dataset.scope; renderSection(); },
        "stats-user": () => { state.filters.statsUserId = actionElement.dataset.userId; renderSection(); },
        "feedback-type": () => { state.filters.feedbackType = actionElement.dataset.type; document.querySelectorAll(".fb-type").forEach((btn) => btn.classList.toggle("active", btn.dataset.type === actionElement.dataset.type)); },
        "set-pref": () => { setPref(actionElement.dataset.pref, actionElement.dataset.value); applyPreferences(); renderSection(); },
        "submit-feedback": submitFeedback,
        "delete-feedback": () => deleteFeedbackEntry(actionElement.dataset.feedbackId),
        "open-exercise": () => openExercise(actionElement.dataset.exerciseId),
        "react-exercise": () => reactToExercise(actionElement.dataset.exerciseId, actionElement.dataset.reaction),
        "open-user": () => goToUser(actionElement.dataset.userId),
        "add-set": () => addSet(actionElement.dataset.workoutExerciseId),
        "open-superset-builder": () => openSupersetBuilder(actionElement.dataset.workoutId),
        "superset-pick": () => toggleSupersetPick(actionElement.dataset.exerciseBlockId),
        "superset-create": () => createSupersetFrom(supersetBuilder.workoutId, supersetBuilder.picked, {
            rounds: supersetBuilder.rounds,
            restSeconds: supersetBuilder.restSeconds
        }),
        "open-superset-menu": () => openSupersetMenu(actionElement.dataset.workoutId, actionElement.dataset.supersetId),
        "focus-jump-member": () => focusJumpMember(actionElement.dataset.exerciseBlockId),
        "superset-set-rest": async () => {
            const groupId = actionElement.dataset.supersetId;
            const workoutItem = editWorkout();
            const current = workoutItem ? supersetRestSeconds(workoutItem, groupId) : SUPERSET_DEFAULT_REST;
            await supersetSetRest(groupId, resolveRestValue(actionElement, current));
        },
        "superset-builder-rest": () => {
            supersetBuilder.restSeconds = resolveRestValue(actionElement, supersetBuilder.restSeconds);
            refreshSupersetBuilder();
        },
        "superset-builder-rounds": () => {
            const delta = Math.round(Number(actionElement.dataset.roundsDelta) || 0);
            supersetBuilder.rounds = Math.max(SUPERSET_BUILDER_MIN_ROUNDS,
                Math.min(SUPERSET_BUILDER_MAX_ROUNDS, supersetBuilder.rounds + delta));
            refreshSupersetBuilder();
        },
        "superset-add-round": () => supersetAddRound(actionElement.dataset.workoutId, actionElement.dataset.supersetId),
        "superset-remove-round": () => supersetRemoveRound(actionElement.dataset.workoutId, actionElement.dataset.supersetId),
        "superset-move-member": () => supersetMoveMember(actionElement.dataset.supersetId, actionElement.dataset.exerciseBlockId, actionElement.dataset.dir),
        "superset-remove-member": () => supersetRemoveMember(actionElement.dataset.supersetId, actionElement.dataset.exerciseBlockId),
        "superset-add-member": () => supersetAddMember(actionElement.dataset.supersetId),
        "superset-split": () => supersetSplit(actionElement.dataset.workoutId, actionElement.dataset.supersetId),
        "superset-delete": () => supersetDelete(actionElement.dataset.supersetId),
        "superset-open-round": () => {
            state.supersetOpenRounds[`${actionElement.dataset.supersetId}:${actionElement.dataset.round}`] = true;
            renderSection();
        },
        "superset-close-round": () => {
            delete state.supersetOpenRounds[`${actionElement.dataset.supersetId}:${actionElement.dataset.round}`];
            renderSection();
        },
        "toggle-timed-block": () => toggleTimedBlock(actionElement.dataset.workoutExerciseId),
        "toggle-set": () => isWatchedTarget(actionElement)
            ? editWatchedSet(actionElement.dataset.workoutExerciseId, actionElement.dataset.setId, { isCompleted: !watchedSet(actionElement)?.isCompleted })
            : toggleSet(actionElement.dataset.workoutExerciseId, actionElement.dataset.setId),
        "delete-set": () => deleteSet(actionElement.dataset.workoutExerciseId, actionElement.dataset.setId),
        "finish-workout": () => finishWorkout(actionElement.dataset.workoutId),
        "open-cardio-modal": () => openCardioModal(actionElement.dataset.workoutId, actionElement.dataset.cardioId || null),
        "save-cardio": () => saveCardio(actionElement.dataset.workoutId, actionElement.dataset.cardioId || null),
        "delete-cardio": () => deleteCardio(actionElement.dataset.workoutId, actionElement.dataset.cardioId),
        "timer-add": () => addTimerTime(Number(actionElement.dataset.delta)),
        "timer-toggle": toggleTimerPause,
        "timer-stop": stopTimer,
        "timer-collapse": () => setTimerCollapsed(true),
        "timer-expand": () => setTimerCollapsed(false),
        "open-focus": () => openFocusMode(actionElement.dataset.workoutExerciseId || null),
        "focus-close": closeFocusMode,
        "focus-complete-set": focusCompleteSet,
        "focus-uncomplete-set": focusUncompleteSet,
        "focus-add-set": focusAddSet,
        "focus-next-exercise": () => focusShiftExercise(Number(actionElement.dataset.dir) || 1),
        "focus-jump-set": () => focusJumpSet(actionElement.dataset.setId),
        "focus-start-set": focusStartSet,
        "focus-show-rest": focusShowRest,
        "focus-apply-hint": () => focusApplyHint(actionElement.dataset.weight, actionElement.dataset.reps, actionElement.dataset.seconds),
        "focus-step": () => focusStepField(actionElement.dataset.field, Number(actionElement.dataset.delta)),
        "focus-finish-workout": focusFinishWorkout,
        "open-profile-editor": openProfileEditor,
        "open-onboarding": openOnboarding,
        "onboarding-next": onboardingNext,
        "onboarding-back": onboardingBack,
        "onboarding-skip": closeOnboarding,
        "onboarding-finish": finishOnboarding,
        "onboarding-muscle": () => {
            setOnboardingField("favoriteMuscleGroup", actionElement.dataset.value);
            renderOnboardingBody();
        },
        "onboarding-supersets": () => {
            setOnboardingField("useSupersets", actionElement.dataset.value === "true");
            renderOnboardingBody();
        },
        "onboarding-privacy": () => {
            setOnboardingField("hideWorkoutDetails", actionElement.dataset.value === "true");
            renderOnboardingBody();
        },
        "save-profile": saveProfile,
        "save-bodyweight": saveBodyweight,
        "open-workout": () => openWorkout(actionElement.dataset.workoutId),
        notifications: requestNotifications,
        "check-backend": checkBackendConnection,
        "retry-load": () => initialize(),
        "load-more-workouts": loadMoreWorkoutsAction,
        "login-google": loginWithGoogle,
        logout: logout,
        "recheck-approval": recheckApproval,
        "approve-user": () => setUserApproval(actionElement.dataset.userId, true),
        "revoke-user": () => setUserApproval(actionElement.dataset.userId, false),
        "export-data": exportData,
        "reset-curated-exercises": resetCuratedExercises,
        "ai-parse": aiParse,
        "ai-apply": aiApply,
        "ai-reset": aiReset,
        "ai-expand": () => { aiState.forceExpanded = true; renderSection(); },
        "ai-collapse": () => { aiState.forceExpanded = false; storage.writeSetting(aiCollapsedKey(), "1"); renderSection(); },
        "toggle-exercise-collapse": () => {
            const id = actionElement.dataset.workoutExerciseId;
            const card = actionElement.closest(".workout-exercise");
            if (!card) { return; }
            state.expandedExercises = state.expandedExercises || new Set();
            // Toggle the class on the live DOM so the CSS height transition plays.
            if (card.classList.contains("we-collapsed")) { state.expandedExercises.add(id); card.classList.remove("we-collapsed"); }
            else { state.expandedExercises.delete(id); card.classList.add("we-collapsed"); }
        },
        "ai-add-set": () => aiAddSet(actionElement.dataset.exIndex),
        "ai-remove-set": () => aiRemoveSet(actionElement.dataset.exIndex, actionElement.dataset.setIndex),
        "ai-remove-exercise": () => aiRemoveExercise(actionElement.dataset.exIndex),
        "ai-remove-cardio": () => aiRemoveCardio(actionElement.dataset.cardioIndex),
        "ai-pick-option": () => aiPickOption(actionElement.dataset.exIndex, actionElement.dataset.optionId),
        "ai-open-catalog": () => aiOpenCatalogPicker(actionElement.dataset.exIndex),
        "ai-choose-exercise": () => aiChooseExercise(actionElement.dataset.exerciseId),
        "ai-stats-period": () => aiStatsSetPeriod(actionElement.dataset.period),
        "ai-stats-refresh": () => loadAiStats(),
        reset: resetData,
        "close-overlay": closeOverlay,
        "close-confirm": closeConfirmOverlay,
        "apply-update": applyUpdate,
        "open-note": () => openNote(actionElement.dataset.noteKey),
        "open-workout-type": () => openWorkoutTypePicker(actionElement.dataset.workoutId),
        "dismiss-update": dismissUpdateBanner,
        "close-sheet": closeSheet,
        // ---- workout sheets (the bottom sheets of the workout screen) ----
        "ux2-add-set": () => addSet(actionElement.dataset.workoutExerciseId),
        "ux2-set-menu": () => ux2OpenSetMenu(actionElement.dataset.workoutExerciseId, actionElement.dataset.setId, actionElement.dataset.superset === "1"),
        "ux2-set-type": () => ux2SetType(actionElement.dataset.workoutExerciseId, actionElement.dataset.setId, actionElement.dataset.type, actionElement.dataset.superset === "1"),
        "ux2-set-rest": () => ux2SetRest(actionElement.dataset.workoutExerciseId, actionElement.dataset.setId, Number(actionElement.dataset.delta) || 0, actionElement.dataset.superset === "1"),
        "ux2-sheet-toggle-set": () => { closeOverlay(); return toggleSet(actionElement.dataset.workoutExerciseId, actionElement.dataset.setId); },
        "ux2-delete-set": () => { closeOverlay(); return deleteSet(actionElement.dataset.workoutExerciseId, actionElement.dataset.setId, { skipConfirm: true }); },
        "ux2-ex-menu": () => ux2OpenExerciseMenu(actionElement.dataset.workoutExerciseId),
        "ux2-ex-focus": () => { closeOverlay(); openFocusMode(actionElement.dataset.workoutExerciseId || null); },
        "ux2-ex-replace": () => { state.replaceExerciseTarget = actionElement.dataset.workoutExerciseId; openAddExerciseModal(); },
        "ux2-ex-timed": () => { closeOverlay(); return toggleTimedBlock(actionElement.dataset.workoutExerciseId); },
        "ux2-ex-info": () => openExercise(actionElement.dataset.exerciseId),
        "ux2-ex-remove": () => { closeOverlay(); return removeWorkoutExercise(actionElement.dataset.workoutExerciseId); },
        "ux2-fill-last": () => ux2FillFromLast(actionElement.dataset.workoutExerciseId || null),
        "set-step": () => stepSetField(actionElement.dataset.workoutExerciseId, actionElement.dataset.setId, actionElement.dataset.field, Number(actionElement.dataset.dir) || 0),
        "fill-from-last": () => fillSetFromLast(actionElement.dataset.workoutExerciseId, Number(actionElement.dataset.setIndex)),
        "warmup-open": () => openWarmupSheet(actionElement.dataset.workoutExerciseId),
        "warmup-step": () => warmupStep(actionElement.dataset.field, Number(actionElement.dataset.dir) || 0),
        "warmup-apply": () => applyWarmup(),
        "ux2-reorder": () => ux2OpenReorderSheet(actionElement.dataset.workoutExerciseId || null),
        "ux2-reorder-move": () => ux2MoveBlockBy(actionElement.dataset.key, Number(actionElement.dataset.dir) || 0),
        "ux2-ex-rest": () => ux2ExerciseRest(actionElement.dataset.workoutExerciseId, Number(actionElement.dataset.seconds) || 0),
        "ux2-open-note": () => { closeOverlay(); openNote(actionElement.dataset.noteKey); },
        "ux2-session-menu": ux2OpenSessionMenu,
        "ux2-pick-type": () => { closeOverlay(); return openWorkoutTypePicker(actionElement.dataset.workoutId); },
        "ux2-meta": ux2OpenMetaSheet,
        "ux2-cardio": () => openCardioModal(actionElement.dataset.workoutId, null),
        "ux2-superset": () => { closeOverlay(); return openSupersetBuilder(actionElement.dataset.workoutId); },
        "ux2-template": () => openSaveTemplateModal(actionElement.dataset.workoutId),
        "ux2-delete-workout": () => { closeOverlay(); return deleteWorkout(actionElement.dataset.workoutId); },
        "ux2-rest-line": () => ux2OpenRestSheet(actionElement.dataset.workoutExerciseId, actionElement.dataset.setId, actionElement.dataset.supersetId || null),
        "ux2-rest-set": () => ux2ApplyRest(actionElement.dataset.workoutExerciseId, actionElement.dataset.setId, actionElement.dataset.supersetId || null, Number(actionElement.dataset.seconds), false),
        "ux2-rest-step": () => {
            const workoutItem = editWorkout();
            const groupId = actionElement.dataset.supersetId || null;
            const workoutExercise = workoutItem ? workoutItem.exercises.find((item) => item.id === actionElement.dataset.workoutExerciseId) : null;
            const set = workoutExercise ? (workoutExercise.sets || []).find((item) => item.id === actionElement.dataset.setId) : null;
            const current = groupId ? supersetRestSeconds(workoutItem, groupId) : ux2RestSeconds(workoutItem, workoutExercise, set);
            return ux2ApplyRest(actionElement.dataset.workoutExerciseId, actionElement.dataset.setId, groupId, current + Number(actionElement.dataset.delta || 0), true);
        },
        "ux2-rest-scope": () => {
            ux2SetRestScope(actionElement.dataset.scope);
            ux2OpenRestSheet(actionElement.dataset.workoutExerciseId, actionElement.dataset.setId, actionElement.dataset.supersetId || null);
        },
    };

    if (actions[action]) {
        await runAction(actionElement, action, actions[action]);
    }
}

async function handleChange(event) {
    const actionElement = event.target.closest("[data-action]");
    if (!actionElement) {
        return;
    }

    // gym-date fires `change`, not `input`, so the birthday step is read here.
    if (actionElement.dataset.action === "onboarding-field") {
        setOnboardingField(actionElement.dataset.obField, actionElement.value);
        return;
    }

    if (actionElement.dataset.action === "warmup-warm") {
        if (warmupDraft) {
            warmupDraft.warm = Boolean(actionElement.checked);
            refreshWarmupPreview();
        }
        return;
    }

    if (actionElement.dataset.action === "superset-builder-rest") {
        supersetBuilder.restSeconds = resolveRestValue(actionElement, supersetBuilder.restSeconds);
        refreshSupersetBuilder();
        return;
    }

    if (actionElement.dataset.action === "superset-set-rest") {
        const groupId = actionElement.dataset.supersetId;
        const workoutItem = editWorkout();
        const current = workoutItem ? supersetRestSeconds(workoutItem, groupId) : SUPERSET_DEFAULT_REST;
        await supersetSetRest(groupId, resolveRestValue(actionElement, current));
        return;
    }

    await runChangeAction(actionElement, async () => {
        if (actionElement.dataset.action === "set-field") {
            if (isWatchedTarget(actionElement)) {
                // A partner's set: through the narrow route, never the local saver,
                // which would try to replace their whole workout with our copy.
                const field = actionElement.dataset.field;
                const raw = actionElement.value;
                await editWatchedSet(actionElement.dataset.workoutExerciseId, actionElement.dataset.setId, {
                    [field]: field === "type" ? raw : Number(raw) || 0
                });
            } else {
                await updateSetField(actionElement.dataset.workoutExerciseId, actionElement.dataset.setId, actionElement.dataset.field, actionElement.value);
            }
        }

        if (actionElement.dataset.action === "edit-workout-meta") {
            await updateWorkoutMeta(actionElement.dataset.workoutId, actionElement.dataset.field, actionElement.value);
        }

        if (actionElement.dataset.action === "stats-filter") {
            state.filters[actionElement.dataset.filter] = actionElement.value;
            renderSection();
        }

        if (actionElement.dataset.action === "set-role") {
            await setUserRole(actionElement.dataset.userId, actionElement.value);
        }

        if (actionElement.dataset.action === "set-feedback-status") {
            await updateFeedbackStatus(actionElement.dataset.feedbackId, actionElement.value);
        }

        if (actionElement.dataset.action === "push-toggle") {
            togglePushCategory(actionElement.dataset.key, actionElement.checked);
        }

        if (actionElement.dataset.action === "set-pref-select") {
            setPref(actionElement.dataset.pref, actionElement.value);
        }

        // A boolean preference is a switch, not a two-button segmented control taking
        // the full width of a row. Repaints the section because some prefs change the
        // shell (density, accent).
        if (actionElement.dataset.action === "set-privacy-switch") {
            await setPrivacy(actionElement.checked);
        }

        if (actionElement.dataset.action === "set-pref-switch") {
            setPref(actionElement.dataset.pref, actionElement.checked ? "1" : "0");
            applyPreferences();
            renderSection();
        }

        if (actionElement.dataset.action === "picker-filter-select") {
            setPickerFilter(actionElement.dataset.key, actionElement.value);
        }

        if (actionElement.dataset.action === "rankings-lift-filter") {
            state.filters.rankingsMuscle = actionElement.value;
            renderSection();
        }

        if (actionElement.dataset.action === "import-data") {
            await importData(actionElement.files[0]);
        }

        if (actionElement.dataset.action === "import-exercise-catalog") {
            await importExerciseCatalog(actionElement.files[0]);
        }

        if (actionElement.dataset.action === "data-mode") {
            await changeDataMode(actionElement.value);
        }

        if (actionElement.dataset.action === "ai-workout-field") {
            aiEditWorkoutField(actionElement.dataset.field, actionElement.value);
        }

        if (actionElement.dataset.action === "ai-set-field") {
            aiEditSet(actionElement.dataset.exIndex, actionElement.dataset.setIndex, actionElement.dataset.field, actionElement.value);
        }

        if (actionElement.dataset.action === "ai-cardio-field") {
            aiEditCardio(actionElement.dataset.cardioIndex, actionElement.dataset.field, actionElement.value);
        }

        if (actionElement.dataset.action === "ai-stats-filter") {
            aiStatsSetFilter(actionElement.dataset.filter, actionElement.value);
        }
    });
}

async function runAction(actionElement, action, callback) {
    const shouldShowLoader = actionNeedsLoader(action);
    if (shouldShowLoader && actionElement.dataset.busy === "true") {
        return;
    }

    if (shouldShowLoader) {
        setActionLoading(actionElement, true);
        showSyncIndicator("loading", actionProgressLabel(action));
    }

    try {
        const result = callback();
        if (result && typeof result.then === "function") {
            await result;
        }
        if (shouldShowLoader) {
            showSyncIndicator("success", "Готово");
        }
    } catch (error) {
        handleUserFacingError(error, action);
    } finally {
        if (shouldShowLoader) {
            setActionLoading(actionElement, false);
        }
    }
}

async function runChangeAction(actionElement, callback) {
    try {
        const result = callback();
        if (result && typeof result.then === "function") {
            await result;
        }
    } catch (error) {
        handleUserFacingError(error, actionElement.dataset.action);
    } finally {
        if (actionElement.type === "file") {
            actionElement.value = "";
        }
    }
}

function actionNeedsLoader(action) {
    // The workout sheets, the warm-up and the steppers paint their result themselves,
    // immediately: a spinner swapped into a 46px tick would read as lag, not progress.
    if (action.startsWith("ux2-") || action.startsWith("pcal-") || action.startsWith("warmup-") || action === "set-step" || action === "fill-from-last") {
        return false;
    }
    return !new Set([
        "navigate",
        "edit-workout",
        "open-day-sheet",
        "open-add-exercise-modal",
        "picker-filter",
        "open-muscle-grid",
        "pick-muscle",
        "muscle-grid-back",
        "open-custom-exercise",
        "edit-exercise",
        "upgrade-plan",
        "open-changelog",
        "activity-scope",
        "stats-user",
        "feedback-type",
        "set-pref",
        "react-exercise",
        "open-exercise",
        "open-user",
        "open-profile-editor",
        // Onboarding paints its own next screen; a spinner on the button would be a
        // loading state for something that is already on screen.
        "open-onboarding",
        "superset-pick",
        "superset-open-round",
        "superset-close-round",
        "open-superset-menu",
        // Rest is nudged repeatedly; a spinner on every tap would strobe.
        "superset-set-rest",
        "superset-builder-rest",
        "superset-builder-rounds",
        "focus-jump-member",
        "superset-add-round",
        "superset-remove-round",
        "onboarding-next",
        "onboarding-back",
        "onboarding-skip",
        "onboarding-muscle",
        "onboarding-supersets",
        "onboarding-privacy",
        "open-workout",
        "open-cardio-modal",
        "timer-add",
        "timer-toggle",
        "timer-stop",
        "timer-collapse",
        "timer-expand",
        "open-focus",
        "focus-close",
        "focus-start-set",
        "focus-jump-set",
        "focus-apply-hint",
        "focus-step",
        "focus-next-exercise",
        "focus-show-rest",
        // Optimistic feed actions paint their own result immediately; routing them
        // through the loader made setActionLoading restore the button's pre-click
        // markup afterwards, silently putting the old like count back.
        "feed-react",
        "feed-scope",
        // Same reason: the cheer button paints itself sent the instant it is tapped,
        // and the loader restoring the pre-click markup would undo that.
        "cheer",
        "cheer-pick",
        "open-post",
        "open-report",
        "close-overlay"
    ]).has(action);
}

function actionProgressLabel(action) {
    const labels = {
        "start-workout": "Створюємо тренування",
        "copy-workout-start": "Копіюємо тренування",
        "reopen-workout": "Відновлюємо тренування",
        "start-existing-workout": "Запускаємо тренування",
        "delete-workout": "Видаляємо тренування",
        "add-exercise": "Додаємо вправу",
        "remove-workout-exercise": "Видаляємо вправу",
        "save-custom-exercise": "Зберігаємо вправу",
        "suggest-exercise-media": "Підбираємо GIF",
        "add-set": "Додаємо підхід",
        "toggle-timed-block": "Змінюємо вимір",
        "toggle-set": "Оновлюємо підхід",
        "delete-set": "Видаляємо підхід",
        "finish-workout": "Завершуємо тренування",
        "save-cardio": "Зберігаємо кардіо",
        "delete-cardio": "Видаляємо кардіо",
        "save-profile": "Зберігаємо профіль",
        "save-bodyweight": "Додаємо замір ваги",
        notifications: "Перевіряємо таймер",
        "check-backend": "Перевіряємо backend",
        logout: "Виходимо з акаунта",
        "export-data": "Готуємо експорт",
        "reset-curated-exercises": "Очищаємо каталог вправ",
        reset: "Оновлюємо сховище"
    };
    return labels[action] || "Виконуємо дію";
}

function setActionLoading(actionElement, isLoading) {
    if (!actionElement) {
        return;
    }

    if (isLoading) {
        actionElement.dataset.busy = "true";
        actionElement.classList.add("is-loading");
        actionElement.setAttribute("aria-busy", "true");
        if ("disabled" in actionElement) {
            actionElement.disabled = true;
        }
        const canUseInlineLoader = actionElement.classList.contains("button") || actionElement.classList.contains("icon-button");
        if (canUseInlineLoader) {
            // Capture ONLY when we are about to overwrite. Capturing unconditionally
            // meant the restore below reverted whatever the handler had painted in
            // the meantime.
            actionElement.dataset.originalHtml = actionElement.innerHTML;
            const label = actionElement.classList.contains("icon-button") ? "" : `<span>${escapeHtml(actionElement.textContent.trim() || "Зачекай")}</span>`;
            actionElement.innerHTML = `<span class="square-loader" aria-hidden="true"></span>${label}`;
        }
        return;
    }

    actionElement.classList.remove("is-loading");
    actionElement.removeAttribute("aria-busy");
    if ("disabled" in actionElement) {
        actionElement.disabled = false;
    }
    if (actionElement.dataset.originalHtml) {
        actionElement.innerHTML = actionElement.dataset.originalHtml;
    }
    delete actionElement.dataset.busy;
    delete actionElement.dataset.originalHtml;
    icons();
}

function handleInput(event) {
    const actionElement = event.target.closest("[data-action]");
    if (!actionElement) {
        return;
    }

    if (actionElement.dataset.action === "onboarding-field") {
        setOnboardingField(actionElement.dataset.obField, actionElement.value);
        return;
    }

    if (actionElement.dataset.action === "warmup-field") {
        warmupSetField(actionElement.dataset.field, actionElement.value);
        return;
    }

    if (actionElement.dataset.action === "exercise-search") {
        // Re-render only the card grid (not the whole section) so the search
        // input keeps focus + caret while typing — re-rendering #pageContent
        // destroyed the input and dropped focus after every character.
        state.filters.exerciseSearch = actionElement.value;
        refreshCatalog();
    }

    if (actionElement.dataset.action === "exercise-picker-search") {
        state.filters.exerciseSearch = actionElement.value;
        const pickerGrid = element("exercisePickerGrid");
        if (pickerGrid) {
            pickerGrid.innerHTML = exercisePickerCards();
        }
    }

    if (actionElement.dataset.action === "set-field" && actionElement.dataset.field === "weight") {
        liveUpdateWeightDeltas(actionElement);
    }

    if (actionElement.dataset.action === "custom-exercise-media") {
        const preview = element("customExerciseMediaPreview");
        const url = imageUrl(actionElement.value);
        if (preview) {
            preview.classList.toggle("has-image", Boolean(url));
            // Drop the class BEFORE detaching: closest() on an already-removed <img>
            // has no parent left to find, so the empty frame used to stay visible.
            preview.innerHTML = url ? `<img src="${escapeHtml(url)}" alt="Превʼю" referrerpolicy="no-referrer" onerror="this.closest('.media-url-preview')?.classList.remove('has-image'); this.remove();">` : "";
        }
    }

    if (actionElement.dataset.action === "update-workout-notes") {
        const workoutItem = editWorkout();
        if (workoutItem) {
            workoutItem.notes = actionElement.value;
            schedulePersistWorkout(workoutItem);
        }
    }

    if (actionElement.dataset.action === "ai-input") {
        // Store transcript/typed text without repainting so the caret stays put.
        aiState.text = actionElement.value;
        aiUpdateCharCount();
    }

    if (actionElement.dataset.action === "ai-catalog-search") {
        state.filters.exerciseSearch = actionElement.value;
        const grid = element("aiCatalogGrid");
        if (grid) {
            grid.innerHTML = aiCatalogCards();
            iconsIn(grid);
        }
    }

    if (actionElement.dataset.action === "update-exercise-notes") {
        const workoutItem = editWorkout();
        const workoutExercise = workoutItem?.exercises.find((item) => item.id === actionElement.dataset.workoutExerciseId);
        if (workoutExercise) {
            workoutExercise.notes = actionElement.value;
            schedulePersistWorkout(workoutItem);
        }
    }

    if (actionElement.dataset.action === "api-base-url") {
        clearTimeout(handleInput.apiUrlTimeoutId);
        handleInput.apiUrlTimeoutId = setTimeout(() => updateApiBaseUrl(actionElement.value), 450);
    }
}

export const routableSections = new Set([...sectionItems.map((item) => item.id), "user", "post"]);
