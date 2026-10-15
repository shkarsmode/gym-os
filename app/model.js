// Users, roles, limits, workout lookups, labels, catalogue normalizers.
import { escapeHtml, dateInput, imageUrl } from "../lib/format.js";
import { statusLabels, setTypeLabels, workoutTypeLabels, dataModeLabels } from "../lib/constants.js";
import { effectiveWorkoutStatus } from "../lib/workout-status.js";
import { skeletonMore } from "./components.js";
import { storage } from "./data.js";
import { friendlyError, showSyncIndicator } from "./overlays.js";
import { renderSection } from "./shell.js";
import { state, templates } from "./state.js";
import { addDays, capitalize, dayDiff, round, startWeek } from "./util.js";

export function userById(id) {
    return state.database.users.find((user) => user.id === id);
}

export function currentUser() {
    return userById(state.database.currentUserId);
}

export const adminEmails = new Set(["zshkarrr@gmail.com"]);

export function effectiveRole() {
    return String(storage.currentUser?.role || currentUser()?.role || "free").toLowerCase();
}

export function isAdmin() {
    const email = String(storage.currentUser?.email || currentUser()?.email || "").trim().toLowerCase();
    if (email !== "" && adminEmails.has(email)) {
        return true;
    }
    return effectiveRole() === "admin";
}

export function hasUnlimited() {
    return isAdmin() || effectiveRole() === "premium";
}

export function roleLabel(role) {
    return ({ free: "Free", premium: "PRO", admin: "Адмін" })[String(role || "free").toLowerCase()] || "Free";
}

export function exerciseQuotaState(userId) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const count = state.database.exercises.filter((exercise) => exercise.createdByUserId === userId && exercise.createdAt && new Date(exercise.createdAt) >= startOfMonth).length;
    return { count, limit: 1, over: count >= 1 };
}

export function canEditExercise(exercise) {
    if (!exercise) {
        return false;
    }
    const me = currentUser();
    return isAdmin() || (Boolean(me) && exercise.createdByUserId === me.id);
}

// True only for the exercise's own creator — drives the personal "Моя" badge.
export function isMyExercise(exercise) {
    const me = currentUser();
    return Boolean(me && exercise && exercise.createdByUserId === me.id);
}

export function exerciseOwnerName(exercise) {
    if (!exercise || !exercise.createdByUserId) {
        return "GymOS";
    }
    const owner = userById(exercise.createdByUserId);
    return owner ? owner.displayName : "GymOS";
}

// Per-tier workout limits mirrored from the backend (see workout-quota.ts). `weeks` maps
// the allowed Monday–Sunday windows to their cap; a window not present is not addable.
const WORKOUT_LIMITS = {
    free: { perDay: 1, weeks: { current: 2 } },
    premium: { perDay: 2, weeks: { prev: 5, current: 6, next: 5 } }
};

function workoutWindow(date) {
    const diffWeeks = Math.round(dayDiff(startWeek(date), startWeek(new Date())) / 7);
    return diffWeeks === 0 ? "current" : diffWeeks === -1 ? "prev" : diffWeeks === 1 ? "next" : "out";
}

function workoutLimitSummary(tier) {
    return tier === "premium"
        ? "PRO: до 2 тренувань на день; 5 за минулий тиждень, 6 за поточний, 5 за наступний."
        : "Безкоштовний тариф: до 1 тренування на день і 2 на поточний тиждень.";
}

// Tier-aware check for whether the current user may add a workout on `when` (a Date or a
// "YYYY-MM-DD" string; default today). Mirrors the backend so the UI can hide the add
// button and show an inline block before any request. Admins are always allowed.
export function workoutLimitState(userId, when, excludeId) {
    const date = when ? new Date(when) : new Date();
    if (isAdmin()) {
        return { allowed: true, tier: "admin" };
    }
    const tier = effectiveRole() === "premium" ? "premium" : "free";
    const config = WORKOUT_LIMITS[tier];
    const summary = workoutLimitSummary(tier);
    const window = workoutWindow(date);
    const weekCap = config.weeks[window];
    if (weekCap === undefined) {
        return { allowed: false, scope: "window", tier, window, summary,
            message: tier === "premium"
                ? "PRO дозволяє додавати тренування лише за минулий, поточний і наступний тиждень."
                : "Безкоштовний тариф дозволяє додавати тренування лише в межах поточного тижня." };
    }
    const dayKey = dateInput(date);
    const weekKey = dateInput(startWeek(date));
    const mine = workoutsFor(userId).filter((workoutItem) => workoutItem.id !== excludeId);
    const day = mine.filter((workoutItem) => String(workoutItem.date).slice(0, 10) === dayKey).length;
    const week = mine.filter((workoutItem) => dateInput(startWeek(workoutItem.date)) === weekKey).length;
    if (day >= config.perDay) {
        return { allowed: false, scope: "day", tier, window, summary, day, week,
            message: `Ліміт на день досягнуто — ${config.perDay} тренування на день.` };
    }
    if (week >= weekCap) {
        return { allowed: false, scope: "week", tier, window, summary, day, week,
            message: `Ліміт на цей тиждень досягнуто — ${weekCap} тренувань.` };
    }
    return { allowed: true, tier, window, day, week };
}

// Allowed date range for the current user's tier, as "YYYY-MM-DD" min/max for the
// date picker (empty = unrestricted, i.e. admin). Caps are still checked on change.
export function workoutDateBounds() {
    if (isAdmin()) {
        return { min: "", max: "" };
    }
    const tier = effectiveRole() === "premium" ? "premium" : "free";
    const weeks = WORKOUT_LIMITS[tier].weeks;
    const monday = startWeek(new Date());
    const minOffset = "prev" in weeks ? -7 : 0;
    const maxOffset = ("next" in weeks ? 7 : 0) + 6;
    return { min: dateInput(addDays(monday, minOffset)), max: dateInput(addDays(monday, maxOffset)) };
}

function workoutLimitBlock(state, compact = false) {
    const icon = state.scope === "window" ? "calendar-x" : "lock";
    if (compact) {
        return `<span class="workout-limit-chip"><i data-lucide="${icon}"></i>${escapeHtml(state.message)}</span>`;
    }
    const upsell = state.tier === "free"
        ? `<button class="button button-secondary compact" type="button" data-action="navigate" data-section="subscription"><i data-lucide="rocket"></i>Дізнатись про PRO</button>`
        : "";
    return `<div class="workout-limit-block"><i data-lucide="${icon}"></i><div class="wlb-text"><strong>${escapeHtml(state.message)}</strong><span>${escapeHtml(state.summary)}</span></div>${upsell}</div>`;
}

// A ready-to-place add/start-workout button, or the inline limit block when the current
// user cannot add a workout on `dateOverride` (a "YYYY-MM-DD" string; default today).
export function startWorkoutButton(dateOverride, opts = {}) {
    const state = workoutLimitState(currentUser().id, dateOverride);
    if (!state.allowed) {
        return workoutLimitBlock(state, opts.compact);
    }
    const dataDate = dateOverride ? ` data-date="${escapeHtml(String(dateOverride).slice(0, 10))}"` : "";
    const cls = opts.buttonClass || (opts.compact ? "button button-primary compact" : "button button-primary large-workout-button");
    return `<button class="${cls}" type="button" data-action="start-workout"${dataDate}><i data-lucide="play"></i>${escapeHtml(opts.label || "Почати тренування")}</button>`;
}

export function canManage(workoutItem) {
    if (!workoutItem) {
        return false;
    }
    const me = currentUser();
    return (Boolean(me) && workoutItem.userId === me.id) || isAdmin();
}

export function workoutNumber(workoutItem) {
    // The server assigns the lifetime ordinal. Deriving it from the workouts held
    // in memory is wrong under the windowed payload — a member with a hundred
    // sessions holding the last thirty would be shown #1..#30 instead of #71..#100.
    // The server value also fixes an old nondeterminism: this sorted by
    // `createdAt || date` while /export never sent createdAt, so same-day workouts
    // could swap numbers between loads.
    if (Number.isFinite(workoutItem.seq)) {
        return workoutItem.seq;
    }
    const list = workoutsFor(workoutItem.userId).slice().sort((left, right) => new Date(left.createdAt || left.date) - new Date(right.createdAt || right.date));
    const index = list.findIndex((item) => item.id === workoutItem.id);
    return (index >= 0 ? index : list.length - 1) + 1;
}

export function workoutLabel(workoutItem) {
    return `Тренування #${workoutNumber(workoutItem)}`;
}

export function exerciseById(id) {
    return state.database.exercises.find((exercise) => exercise.id === id) || missingExercise(id);
}

export function exerciseByName(name) {
    const normalizedName = String(name || "").toLowerCase();
    return state.database.exercises.find((exercise) => {
        return exercise.name === name ||
            String(exercise.originalName || "").toLowerCase() === normalizedName ||
            (exercise.aliases || []).some((alias) => String(alias).toLowerCase() === normalizedName);
    }) || missingExercise(`missing-${createSlug(name)}`, name);
}

function missingExercise(id, name = "Вправа недоступна") {
    return {
        id: id || "missing-exercise",
        name,
        aliases: [],
        primaryMuscleGroup: "Не налаштовано",
        secondaryMuscleGroups: [],
        movementPattern: "Не налаштовано",
        equipment: "Інше",
        category: "Власна",
        difficulty: "Середній",
        description: "Ця вправа відсутня у поточному каталозі backend.",
        techniqueSteps: [],
        commonMistakes: [],
        safetyTips: [],
        mediaUrl: "",
        mediaType: "none",
        isMissing: true
    };
}

export function workoutsFor(userId) {
    // Under the windowed payload only the caller's own workouts carry sets; peers
    // arrive as summaries (or aren't loaded at all). Set-level aggregates for peers
    // come from `scoring` (see userStats/userXp), so callers here just get whatever
    // rows are present — the current user's full window, a peer's summaries, or an
    // empty list. It must never throw: the calendar, team cards and profile views
    // all call it for peers and a throw takes the whole screen down.
    return state.database.workouts.filter((workoutItem) => workoutItem.userId === userId);
}

// Swaps the button for a skeleton while the page is in flight, so the rows already
// on screen stay put and readable instead of the list collapsing to a spinner.
export async function loadMoreWorkoutsAction() {
    const button = document.querySelector('[data-action="load-more-workouts"]');
    if (button) {
        button.outerHTML = skeletonMore(2);
    }
    try {
        await loadMoreOwnWorkouts();
    } catch (error) {
        console.error(error);
        showSyncIndicator("error", friendlyError(error));
    }
    renderSection();
}

// Own history is paged: the boot payload carries the most recent slice and this
// pulls the next one. Returns false when there is nothing more to load.
async function loadMoreOwnWorkouts() {
    if (!state.workoutsCursor || state.loadingMoreWorkouts) {
        return false;
    }
    state.loadingMoreWorkouts = true;
    try {
        const page = await storage.apiClient.fetchMyWorkouts(state.workoutsCursor);
        const known = new Set(state.database.workouts.map((item) => item.id));
        // Upsert rather than append: a workout edited since boot may already be held,
        // and a hydrated row must never be replaced by an older copy of itself.
        for (const workoutItem of page.workouts || []) {
            if (!known.has(workoutItem.id)) {
                state.database.workouts.push(workoutItem);
            }
        }
        state.workoutsCursor = page.nextCursor || null;
        return true;
    } finally {
        state.loadingMoreWorkouts = false;
    }
}

export function activeWorkoutFor(userId) {
    return state.database.workouts.find((workoutItem) => workoutItem.userId === userId && workoutItem.status === "active");
}

export function ownWorkout(workoutId) {
    const workoutItem = state.database.workouts.find((item) => item.id === workoutId);
    return workoutItem && canManage(workoutItem) ? workoutItem : null;
}

export function editWorkout() {
    const id = state.editingWorkoutId;
    if (id) {
        const owned = ownWorkout(id);
        if (owned) {
            return owned;
        }
    }
    return activeWorkoutFor(currentUser().id) || null;
}

export function editWorkoutExercise(id) {
    return editWorkout()?.exercises.find((item) => item.id === id);
}

export function editSetByIds(workoutExerciseId, setId) {
    return editWorkoutExercise(workoutExerciseId)?.sets.find((set) => set.id === setId);
}

export function statusRank(status) {
    return ({ active: 0, planned: 1, completed: 2 })[status] ?? 3;
}

export function cardioIcon(type) {
    return ({ treadmill: "footprints", running: "footprints", walking: "footprints", bike: "bike", rower: "waves", elliptical: "activity", other: "heart-pulse" })[type] || "heart-pulse";
}

export function templateById(id) {
    return templates.find((template) => template.id === id) || templates.at(-1);
}

export function statusLabel(status) {
    return statusLabels[status] || capitalize(status);
}

/**
 * The status a workout is SHOWN as, which is not always the one stored on it.
 *
 * Every user-facing status goes through here, so a teammate's finished session
 * cannot read «Заплановано» in the day sheet and «Завершено» in the history list two
 * taps later. The rule and its reasoning live in lib/workout-status.js.
 */
export function workoutStatusOf(workoutItem) {
    return effectiveWorkoutStatus(workoutItem, dateInput(new Date()));
}

export function setTypeLabel(type) {
    return setTypeLabels[type] || capitalize(type);
}

export function workoutTypeLabel(type) {
    return workoutTypeLabels[type] || capitalize(type);
}

export function dataModeLabel(mode) {
    return dataModeLabels[mode] || mode;
}

export function backendStatusLabel(status) {
    return ({ online: "доступний", offline: "недоступний", unknown: "не перевірено" })[status] || "не перевірено";
}

export function cardioTypeLabel(type) {
    return ({ treadmill: "Бігова доріжка", bike: "Велотренажер", running: "Біг", walking: "Ходьба", rower: "Гребний тренажер" })[type] || type;
}

export function intensityLabel(value) {
    return ({ low: "низька", medium: "середня", high: "висока" })[value] || value;
}

export function workoutSetCount(workoutItem) {
    // Prefer the row aggregate: a summary has no sets to count, and for a hydrated
    // row the server counted exactly the same thing.
    if (Number.isFinite(workoutItem.setCount)) {
        return workoutItem.setCount;
    }
    return (workoutItem.exercises || []).reduce((sum, exercise) => sum + (exercise.sets || []).length, 0);
}

export function workoutCardioMinutes(workoutItem) {
    if (Number.isFinite(workoutItem.cardioMinutes)) {
        return workoutItem.cardioMinutes;
    }
    return (workoutItem.cardioSessions || []).reduce((sum, session) => sum + session.durationMinutes, 0);
}

export function seedWeight(name, index) {
    const weights = { "Жим лежачи": 72, "Жим гантелей під кутом": 28, "Жим у тренажері": 78, "Зведення в кросовері": 18, "Підтягування": 78, "Тяга верхнього блока": 67, "Тяга штанги в нахилі": 72, "Горизонтальна тяга блока": 64, "Жим над головою": 45, "Підйом гантелей в сторони": 12, "Розведення на задню дельту": 10, "Присідання зі штангою": 92, "Жим ногами": 180, "Розгинання ніг": 56, "Румунська тяга": 82, "Згинання ніг": 48, "Підйом на литки": 72, "Згинання зі штангою": 32, "Згинання з гантелями": 16, "Молоткові згинання": 18, "Розгинання на блоці": 38, "Розгинання трицепса над головою": 32, "Планка": 0, "Підйом ніг у висі": 0 };
    return round((weights[name] || 25) + index * 0.7, 1);
}

export function avatar(user, size = "", options = {}) {
    const url = imageUrl(user?.avatarUrl);
    // eager + sync decode so a cached avatar paints WITH the layout (no initials→photo
    // flash when switching tabs); the initials stay only as the pre-load / error fallback.
    const image = url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(user.displayName || "")}" referrerpolicy="no-referrer" loading="eager" decoding="sync" onerror="this.remove()">` : "";
    const inner = `<div class="avatar ${size}" style="background:${escapeHtml(user.avatarColor)};">${escapeHtml(user.avatarInitials)}${image}</div>`;
    const tier = options.frameTier;
    if (!tier) {
        return inner;
    }
    // Layered "ranked badge": the proven ring/conic/sheen/glow stays on the inner
    // overflow-hidden .avatar-frame; the outer overflow-visible .avatar-frame-wrap
    // carries the aura, orbiting sparkles and level nameplate. Heavy layers only on
    // the big identity surfaces so the tiny leaderboard avatars stay cheap.
    const big = size === "large" || size === "xl";
    const medium = big || size === "small";
    const shape = tier.shape || "metal";
    const showAura = tier.aura && medium;
    const showSpark = tier.spark && big;
    const showOrbit = tier.orbit && big;
    const showPlate = tier.plate && size === "large" && options.plateLevel != null;
    // Per-band SHAPE decorations — each rarity band has its own silhouette, only on
    // the identity surfaces (tiny/default stay a bare ring for performance).
    let deco = "";
    if (medium) {
        if (shape === "crystal") {
            deco = `<span class="af-gems" aria-hidden="true"><b></b><b></b><b></b><b></b></span>`;
        } else if (shape === "neon") {
            deco = `<span class="af-tube" aria-hidden="true"></span><span class="af-nodes" aria-hidden="true"></span>`;
        } else if (shape === "flame") {
            deco = `<span class="af-wings" aria-hidden="true"></span>`;
        } else if (shape === "holo") {
            deco = `<span class="af-arcs" aria-hidden="true"></span>`;
        } else if (shape === "apex") {
            deco = `<span class="af-crown" aria-hidden="true"></span>${big ? `<span class="af-frags" aria-hidden="true"></span><span class="af-aura2" aria-hidden="true"></span>` : ""}`;
        }
    }
    const frameMods = [
        `shape-${shape}`,
        tier.conic ? "is-conic is-anim" : "",
        tier.sheen ? "has-sheen" : "",
        tier.ornament ? "has-ornament" : "",
        tier.pulse ? "is-pulse" : ""
    ].filter(Boolean).join(" ");
    const wrapMods = [
        `shape-${shape}`,
        deco ? "has-deco" : "",
        showAura ? "has-aura" : "",
        showSpark ? "has-spark" : "",
        showOrbit ? "has-orbit" : "",
        showPlate ? "has-plate" : "",
        (tier.pulse && showAura) ? "is-pulse" : ""
    ].filter(Boolean).join(" ");
    const vars = `--fgrad:${tier.gradient};--fgi:${tier.glow};--fglowc:${tier.glowColor};--fw:${tier.width}px;`;
    const auraLayer = showAura ? `<span class="af-aura" aria-hidden="true"></span>` : "";
    const orbitLayer = showOrbit
        ? `<span class="af-orbit" aria-hidden="true"></span>${tier.orbit2 ? `<span class="af-orbit af-orbit-rev" aria-hidden="true"></span>` : ""}`
        : "";
    const sparkLayer = showSpark ? `<span class="af-spark" aria-hidden="true"></span>` : "";
    const plate = showPlate
        ? `<span class="af-plate" aria-hidden="true">${tier.emblem ? `<span class="af-emblem">${tier.emblem}</span>` : ""}LVL ${escapeHtml(String(options.plateLevel))}</span>`
        : "";
    const frame = `<div class="avatar-frame ${size} ${frameMods}">${inner}</div>`;
    return `<div class="avatar-frame-wrap ${size} ${wrapMods}" style="${vars}">${auraLayer}${orbitLayer}${frame}${deco}${sparkLayer}${plate}</div>`;
}

export function ordered(items) {
    return `<ol>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`;
}

export function select(id, options, selected) {
    return `<gym-select id="${id}">${options.map((option) => `<option value="${escapeHtml(option)}" ${option === selected ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</gym-select>`;
}

export function uniqueStrings(items) {
    return [...new Set(items.map(cleanText).filter(Boolean))];
}

export function cleanList(items) {
    return uniqueStrings(Array.isArray(items) ? items : []);
}

export function cleanText(value) {
    return String(value || "").trim();
}

export function stripSourcePrefix(value) {
    return value.replace(/^ExRx\.net\s*:\s*/i, "").trim();
}

export function createSlug(value) {
    return cleanText(value).toLowerCase().replace(/[^a-z0-9а-яіїєґ]+/gi, "-").replace(/^-|-$/g, "").slice(0, 90);
}

export function normalizeMuscleGroup(value = "", category = "", originalName = "") {
    const text = `${value} ${category} ${originalName}`.toLowerCase();
    if (/(chest|pector|pec\b|sternal|clavicular)/.test(text)) return "Груди";
    if (/(back|lat|teres|trap|rhomboid|row)/.test(text)) return "Спина";
    if (/(delt|shoulder|front delt|side delt|rear delt)/.test(text)) return "Плечі";
    if (/triceps/.test(text)) return "Трицепс";
    if (/(biceps|brachialis|curl)/.test(text)) return "Біцепс";
    if (/(forearm|wrist|grip)/.test(text)) return "Передпліччя";
    if (/(quad|thigh|leg extension)/.test(text)) return "Квадрицепс";
    if (/(hamstring|leg curl)/.test(text)) return "Задня поверхня стегна";
    // Adductors before glutes: "hip adductor" contains "hip", and the inner thigh is
    // the more specific answer for it.
    if (/(adductor|inner thigh|groin)/.test(text)) return "Внутрішня поверхня стегна";
    if (/(abductor|glute|hip)/.test(text)) return "Сідниці";
    if (/(calf|gastrocnemius|soleus)/.test(text)) return "Литки";
    if (/(ab|oblique|waist|core)/.test(text)) return "Прес";
    if (/neck/.test(text)) return "Шия";
    return value && value !== "Full Body" ? cleanText(value) : "Все тіло";
}

export function normalizeEquipment(value = "", originalName = "") {
    const text = `${value} ${originalName}`.toLowerCase();
    if (/barbell|bb\b/.test(text)) return "Штанга";
    if (/dumbbell|db\b/.test(text)) return "Гантелі";
    if (/cable|pulley/.test(text)) return "Блок";
    if (/lever|machine|sled|smith/.test(text)) return "Тренажер";
    if (/body\s?weight|self|assisted/.test(text)) return "Вага тіла";
    if (/kettlebell/.test(text)) return "Гиря";
    if (/band/.test(text)) return "Еспандер";
    if (/medicine/.test(text)) return "Медбол";
    return cleanText(value) || "Інше";
}

export function normalizeMovementPattern(value = "", category = "", originalName = "") {
    const text = `${value} ${category} ${originalName}`.toLowerCase();
    if (/cardio|walk|run|cycle|bike|treadmill/.test(text)) return "Кардіо";
    if (/squat|lunge|step-up|leg press/.test(text)) return "Присідання";
    if (/deadlift|hinge|pull-through|good morning/.test(text)) return "Hinge";
    if (/row/.test(text)) return "Горизонтальна тяга";
    if (/pulldown|pull-up|chin-up/.test(text)) return "Вертикальна тяга";
    if (/military|overhead|shoulder press|vertical press/.test(text)) return "Вертикальний жим";
    if (/press|bench|dip|push-up/.test(text)) return "Горизонтальний жим";
    if (/raise|fly|abduction/.test(text)) return "Підйом";
    if (/curl|flexion/.test(text)) return "Згинання";
    if (/extension|pushdown/.test(text)) return "Розгинання";
    if (/rotation|twist|crunch|sit-up|plank/.test(text)) return "Кор";
    return cleanText(value) || "Ізоляція";
}

export function normalizeDifficulty(value = "") {
    const text = String(value || "").toLowerCase();
    if (/advanced|expert/.test(text)) return "Просунутий";
    if (/beginner|basic|easy/.test(text)) return "Початковий";
    return "Середній";
}
