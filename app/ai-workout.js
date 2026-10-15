// AI workout parsing (PRO + admin): input, preview, editing, applying.
import { escapeHtml, dateInput } from "../lib/format.js";
import { workoutTypeLabels } from "../lib/constants.js";
import { exerciseThumb } from "./components.js";
import { storage } from "./data.js";
import { muscleIcon } from "./exercise-picker.js";
import { currentUser, effectiveRole, exerciseById, isAdmin, setTypeLabel, workoutLimitState } from "./model.js";
import { closeOverlay, element, openModal, toast } from "./overlays.js";
import { persistWorkout } from "./persistence.js";
import { getPref } from "./prefs.js";
import { goToWorkoutEditor } from "./router.js";
import { state } from "./state.js";
import { createId, iconsIn } from "./util.js";

// ===== AI-тренування (PRO + admin) ==========================================
// A single compact block on the workout-prep screen: one textarea + a "Створити
// за допомогою AI" button. Voice input is left to the device keyboard's native
// dictation (types straight into the textarea). The parsed structured workout is
// shown as an editable preview; "Застосувати тренування" seeds a NEW planned
// workout and opens it in the normal editor. Nothing is started or saved
// automatically. Free users don't see the block; PRO gets a daily quota + shorter
// input, admins are unlimited.
const AI_PRO_DAILY_LIMIT = 3;

export const aiState = {
    text: "",
    status: "idle", // idle | processing | result | error
    result: null,
    error: null,
    cooldownUntil: 0,
    daily: null, // { limit, used, remaining, tier } from the last successful parse
    forceExpanded: false, // session override: user tapped the compact "Створити за допомогою AI" button
    seenCounted: false // guard so we count one "saw the AI card" per app session
};

let aiCooldownTimer = null;

export function canUseAi() {
    return isAdmin() || effectiveRole() === "premium";
}

// PRO users get a 2000-char cap; admins get the full length.
function aiMaxChars() {
    return isAdmin() ? 6000 : 2000;
}

// ---- AI block collapse ----------------------------------------------------
// Once someone has used AI (tapped "Створити за допомогою AI") or seen the card
// a few sessions, the full card folds into a compact button next to «Почати
// тренування». They can expand it on demand; it defaults back to compact next
// session. Local per-device (no cross-device sync needed for a layout choice).
function aiSeenKey() { return `ai-seen-${currentUser().id}`; }

function aiUsedKey() { return `ai-used-${currentUser().id}`; }

export function aiCollapsedKey() { return `ai-collapsed-${currentUser().id}`; }

function markAiUsed() {
    storage.writeSetting(aiUsedKey(), "1");
}

// Count one "saw the expanded AI card" per app session, capped at the threshold.
export function noteAiSeen() {
    if (aiState.seenCounted) { return; }
    aiState.seenCounted = true;
    const seen = Number(storage.readSetting(aiSeenKey()) || "0");
    if (seen < 3) { storage.writeSetting(aiSeenKey(), String(seen + 1)); }
}

export function aiBlockCollapsed() {
    if (aiState.forceExpanded) { return false; }
    if (storage.readSetting(aiCollapsedKey()) === "1") { return true; }
    const used = storage.readSetting(aiUsedKey()) === "1";
    const seen = Number(storage.readSetting(aiSeenKey()) || "0");
    return used || seen >= 3;
}

export function aiWorkoutBlock() {
    return `${aiInputCard()}${aiState.result ? aiPreviewCard(aiState.result) : ""}`;
}

function renderAiBlock() {
    const host = element("aiWorkoutBlock");
    if (host) {
        host.innerHTML = aiWorkoutBlock();
        iconsIn(host);
    }
}

function aiTierHint() {
    if (isAdmin()) {
        return `<span class="ai-tier-hint"><i data-lucide="infinity"></i>Адмін · без ліміту</span>`;
    }
    const daily = aiState.daily;
    if (daily && typeof daily.remaining === "number") {
        return `<span class="ai-tier-hint">PRO · залишилось ${daily.remaining} з ${daily.limit} сьогодні</span>`;
    }
    return `<span class="ai-tier-hint">PRO · до ${AI_PRO_DAILY_LIMIT} на день</span>`;
}

function aiInputCard() {
    const maxChars = aiMaxChars();
    const processing = aiState.status === "processing";
    const cooldownLeft = aiState.cooldownUntil ? Math.max(0, aiState.cooldownUntil - Date.now()) : 0;
    const onCooldown = cooldownLeft > 0;
    const disabled = processing || onCooldown;
    const primaryLabel = processing
        ? "Аналізую…"
        : onCooldown
            ? `Зачекай ${Math.ceil(cooldownLeft / 1000)} с`
            : aiState.result ? "Обробити ще раз" : "Створити за допомогою AI";
    return `<section class="card ai-card">
            <div class="ai-head">
                <span class="ai-badge"><i data-lucide="sparkles"></i></span>
                <div class="ai-head-text">
                    <p class="eyebrow">AI</p>
                    <h2 class="ai-title">AI-тренування</h2>
                    <p class="card-caption">Опиши тренування текстом (або надиктуй мікрофоном клавіатури) — AI зробить структурований чернетку.</p>
                </div>
                <button class="icon-button ai-collapse-btn" type="button" data-action="ai-collapse" title="Згорнути" aria-label="Згорнути AI-блок"><i data-lucide="chevron-up"></i></button>
            </div>
            <div class="ai-input-wrap">
                <textarea id="aiTextarea" class="ai-textarea" data-action="ai-input" rows="3" maxlength="${maxChars}" placeholder="Наприклад: жим лежачи 4×10 по 80 кг, відпочинок 90 секунд, потім розводка 3×15 і доріжка 20 хвилин"${processing ? " disabled" : ""}>${escapeHtml(aiState.text)}</textarea>
            </div>
            <div class="ai-input-meta">${aiTierHint()}<span id="aiCharCount" class="ai-char-count">${aiState.text.length} / ${maxChars}</span></div>
            <div class="ai-actions">
                <button class="button ai-primary large-workout-button" type="button" data-action="ai-parse"${disabled ? " disabled" : ""}>${processing ? `<span class="pixel-loader ai-loader">${Array.from({ length: 5 }, (_, i) => `<span style="--cell:${i}"></span>`).join("")}</span>` : `<i data-lucide="sparkles"></i>`}${primaryLabel}</button>
                ${aiState.result || aiState.text ? `<button class="button button-ghost compact" type="button" data-action="ai-reset"><i data-lucide="eraser"></i>Очистити</button>` : ""}
            </div>
            ${aiState.status === "error" && aiState.error ? `<div class="ai-banner ai-banner-error" role="alert"><i data-lucide="alert-triangle"></i><span>${escapeHtml(aiState.error.message)}</span></div>` : ""}
            ${processing ? `<div class="ai-banner ai-banner-info"><i data-lucide="loader"></i><span>Аналізую опис тренування…</span></div>` : ""}
        </section>`;
}

function aiPreviewCard(result) {
    const blocked = !aiCanApply(result);
    const typeOptions = Object.entries(workoutTypeLabels).map(([value, label]) => `<option value="${value}" ${result.workoutType === value ? "selected" : ""}>${label}</option>`).join("");
    const warningsBlock = (result.warnings || []).length
        ? `<div class="ai-banner ai-banner-warn"><i data-lucide="info"></i><div>${result.warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("")}</div></div>`
        : "";
    const exercisesBlock = (result.exercises || []).length
        ? result.exercises.map((exercise, index) => aiExerciseCard(exercise, index)).join("")
        : `<div class="ai-empty">Вправ не розпізнано. Додаси вручну після застосування або уточни опис.</div>`;
    const cardioBlockHtml = (result.cardioSessions || []).length
        ? `<div class="ai-section-label"><i data-lucide="heart-pulse"></i>Кардіо</div>${result.cardioSessions.map((cardio, index) => aiCardioCard(cardio, index)).join("")}`
        : "";
    return `<section class="card ai-preview">
            <div class="ai-preview-head">
                <div><p class="eyebrow">Preview</p><h3>Перевір і відредагуй</h3></div>
                <span class="chip">${result.meta && result.meta.model ? escapeHtml(result.meta.model) : "AI"}</span>
            </div>
            <div class="field-grid ai-meta-grid">
                <div class="field"><label>Тип</label><gym-select data-action="ai-workout-field" data-field="workoutType">${typeOptions}</gym-select></div>
                <div class="field"><label>Дата</label><input type="date" value="${escapeHtml(result.date || "")}" data-action="ai-workout-field" data-field="date"></div>
            </div>
            ${warningsBlock}
            <div class="ai-exercises">${exercisesBlock}</div>
            ${cardioBlockHtml}
            <div class="ai-apply-row">
                ${blocked ? `<p class="input-hint ai-blocked"><i data-lucide="alert-circle"></i>Признач усі нерозпізнані вправи, щоб застосувати.</p>` : ""}
                <button class="button ai-primary large-workout-button" type="button" data-action="ai-apply"${blocked ? " disabled" : ""}><i data-lucide="check-circle-2"></i>Застосувати тренування</button>
            </div>
        </section>`;
}

function aiExerciseCard(exercise, index) {
    const resolvedExercise = exercise.exerciseId ? exerciseById(exercise.exerciseId) : null;
    const thumb = resolvedExercise
        ? exerciseThumb(resolvedExercise)
        : `<div class="exercise-thumb is-placeholder"><span class="exercise-thumb-ph" aria-hidden="true">${muscleIcon(exercise.primaryMuscleGroup || "all")}</span></div>`;
    const statusBadge = exercise.exerciseId
        ? `<span class="status-badge completed">${escapeHtml((resolvedExercise && resolvedExercise.name) || exercise.matchedName || "Розпізнано")}</span>`
        : exercise.status === "ambiguous"
            ? `<span class="status-badge active">Уточни вправу</span>`
            : `<span class="status-badge readonly">Не знайдено</span>`;
    const resolver = exercise.exerciseId ? "" : aiExerciseResolver(exercise, index);
    const setsHtml = (exercise.sets || []).map((set, setIndex) => aiSetRow(exercise, index, set, setIndex)).join("");
    return `<div class="ai-exercise ${exercise.exerciseId ? "" : "is-unresolved"}">
            <div class="ai-exercise-head">
                ${thumb}
                <div class="ai-exercise-title">
                    <strong>${escapeHtml(exercise.recognizedName)}</strong>
                    <div class="ai-exercise-meta">${statusBadge}${exercise.primaryMuscleGroup ? `<span class="chip">${escapeHtml(exercise.primaryMuscleGroup)}</span>` : ""}</div>
                </div>
                <button class="icon-button" type="button" title="Прибрати вправу" data-action="ai-remove-exercise" data-ex-index="${index}"><i data-lucide="trash-2"></i></button>
            </div>
            ${resolver}
            <div class="ai-sets">${setsHtml}</div>
            <button class="button button-ghost compact ai-add-set" type="button" data-action="ai-add-set" data-ex-index="${index}"><i data-lucide="plus"></i>Підхід</button>
        </div>`;
}

function aiExerciseResolver(exercise, index) {
    const options = (exercise.options || []).map((option) => `<button class="ai-option" type="button" data-action="ai-pick-option" data-ex-index="${index}" data-option-id="${escapeHtml(option.id)}"><span>${escapeHtml(option.name)}</span><span class="ai-option-meta">${escapeHtml(option.primaryMuscleGroup || "")}${option.equipment ? " · " + escapeHtml(option.equipment) : ""}</span></button>`).join("");
    return `<div class="ai-resolver">
            <p class="input-hint">${exercise.status === "ambiguous" ? "Обери правильну вправу:" : "Вправу не знайдено в каталозі — обери вручну:"}</p>
            ${options ? `<div class="ai-options">${options}</div>` : ""}
            <button class="button button-secondary compact" type="button" data-action="ai-open-catalog" data-ex-index="${index}"><i data-lucide="search"></i>Обрати з каталогу</button>
        </div>`;
}

function aiSetRow(exercise, exIndex, set, setIndex) {
    const target = `data-ex-index="${exIndex}" data-set-index="${setIndex}"`;
    const isTimed = set.durationSeconds !== null && set.durationSeconds !== undefined;
    return `<div class="ai-set-row">
            <div class="ai-set-row-head">
                <span class="ai-set-index">${setIndex + 1}</span>
                <gym-select class="ai-set-type" data-action="ai-set-field" ${target} data-field="type">${["warmup", "working", "drop", "failure", "backoff"].map((type) => `<option value="${type}" ${set.type === type ? "selected" : ""}>${setTypeLabel(type)}</option>`).join("")}</gym-select>
                <button class="icon-button ai-set-del" type="button" title="Видалити підхід" data-action="ai-remove-set" ${target}><i data-lucide="x"></i></button>
            </div>
            <div class="ai-set-grid">
                <label class="ai-set-field"><span>Вага, кг</span><input type="number" inputmode="decimal" step="0.5" min="0" value="${set.weight}" data-action="ai-set-field" ${target} data-field="weight"></label>
                ${isTimed
                ? `<label class="ai-set-field"><span>Час, с</span><input type="number" inputmode="numeric" step="5" min="0" value="${set.durationSeconds}" data-action="ai-set-field" ${target} data-field="durationSeconds"></label>`
                : `<label class="ai-set-field"><span>Повтори</span><input type="number" inputmode="numeric" step="1" min="0" value="${set.repetitions}" data-action="ai-set-field" ${target} data-field="repetitions"></label>`}
                <label class="ai-set-field"><span>RPE</span><input type="number" inputmode="decimal" step="0.5" min="0" max="10" value="${set.rpe || ""}" placeholder="—" data-action="ai-set-field" ${target} data-field="rpe"></label>
                <label class="ai-set-field"><span>Відп, с</span><input type="number" inputmode="numeric" step="15" min="0" value="${set.restSeconds}" data-action="ai-set-field" ${target} data-field="restSeconds"></label>
            </div>
        </div>`;
}

function aiCardioCard(cardio, index) {
    const typeOptions = Object.entries(aiCardioTypeLabels).map(([value, label]) => `<option value="${value}" ${cardio.type === value ? "selected" : ""}>${label}</option>`).join("");
    const intensityOptions = Object.entries(aiIntensityLabels).map(([value, label]) => `<option value="${value}" ${cardio.intensity === value ? "selected" : ""}>${label}</option>`).join("");
    return `<div class="ai-cardio">
            <div class="ai-cardio-head">
                <gym-select data-action="ai-cardio-field" data-cardio-index="${index}" data-field="type">${typeOptions}</gym-select>
                <button class="icon-button" type="button" title="Прибрати кардіо" data-action="ai-remove-cardio" data-cardio-index="${index}"><i data-lucide="trash-2"></i></button>
            </div>
            <div class="ai-cardio-fields">
                <label class="ai-set-field"><span>хв</span><input type="number" inputmode="numeric" step="1" min="0" value="${cardio.durationMinutes}" data-action="ai-cardio-field" data-cardio-index="${index}" data-field="durationMinutes"></label>
                <label class="ai-set-field"><span>км</span><input type="number" inputmode="decimal" step="0.1" min="0" value="${cardio.distance || ""}" placeholder="—" data-action="ai-cardio-field" data-cardio-index="${index}" data-field="distance"></label>
                <label class="ai-set-field"><span>ккал</span><input type="number" inputmode="numeric" step="1" min="0" value="${cardio.calories || ""}" placeholder="—" data-action="ai-cardio-field" data-cardio-index="${index}" data-field="calories"></label>
                <label class="ai-set-field"><span>пульс</span><input type="number" inputmode="numeric" step="1" min="0" value="${cardio.averageHeartRate || ""}" placeholder="—" data-action="ai-cardio-field" data-cardio-index="${index}" data-field="averageHeartRate"></label>
                <label class="ai-set-field ai-cardio-intensity"><span>інт.</span><gym-select data-action="ai-cardio-field" data-cardio-index="${index}" data-field="intensity">${intensityOptions}</gym-select></label>
            </div>
        </div>`;
}

const aiCardioTypeLabels = { treadmill: "Доріжка", bike: "Велотренажер", running: "Біг", walking: "Ходьба", rower: "Гребля", elliptical: "Еліпс", other: "Інше" };

const aiIntensityLabels = { low: "Низька", medium: "Середня", high: "Висока" };

function aiCanApply(result) {
    if (!result) {
        return false;
    }
    const hasContent = (result.exercises || []).length > 0 || (result.cardioSessions || []).length > 0;
    const allResolved = (result.exercises || []).every((exercise) => Boolean(exercise.exerciseId));
    return hasContent && allResolved;
}

// ---- AI actions -----------------------------------------------------------
export function aiUpdateCharCount() {
    const counter = element("aiCharCount");
    if (counter) {
        const max = aiMaxChars();
        counter.textContent = `${Math.min(aiState.text.length, max)} / ${max}`;
        counter.classList.toggle("is-full", aiState.text.length >= max);
    }
}

export async function aiParse() {
    const text = String(aiState.text || "").trim();
    if (text.length < 3) {
        toast("Замало тексту", "Опиши тренування трохи детальніше.");
        return;
    }
    if (aiState.status === "processing") {
        return;
    }
    if (aiState.cooldownUntil && Date.now() < aiState.cooldownUntil) {
        return;
    }
    markAiUsed(); // returning users see the compact button next time
    aiState.status = "processing";
    aiState.error = null;
    renderAiBlock();
    try {
        const result = await storage.apiClient.parseAiWorkout({ text });
        aiState.result = aiNormalizeResult(result);
        if (result && result.meta) {
            aiState.daily = { limit: result.meta.dailyLimit, used: result.meta.dailyUsed, remaining: result.meta.dailyRemaining, tier: result.meta.tier };
        }
        aiState.status = "result";
        aiState.error = null;
        renderAiBlock();
    } catch (error) {
        aiState.status = "error";
        const status = Number(error && error.status ? error.status : 0);
        const payload = (error && error.payload) || {};
        if (payload.code === "AI_DAILY_LIMIT") {
            aiState.daily = { limit: AI_PRO_DAILY_LIMIT, used: AI_PRO_DAILY_LIMIT, remaining: 0, tier: "premium" };
        }
        if (status === 429 && payload.retryAfterMs) {
            aiState.cooldownUntil = Date.now() + Number(payload.retryAfterMs);
            aiStartCooldownTick();
        }
        aiState.error = { code: payload.code || String(status || "ERROR"), message: aiErrorMessage(error) };
        renderAiBlock();
    }
}

function aiStartCooldownTick() {
    clearInterval(aiCooldownTimer);
    aiCooldownTimer = setInterval(() => {
        if (!aiState.cooldownUntil || Date.now() >= aiState.cooldownUntil) {
            aiState.cooldownUntil = 0;
            clearInterval(aiCooldownTimer);
            aiCooldownTimer = null;
        }
        renderAiBlock();
    }, 500);
}

function aiErrorMessage(error) {
    const code = String((error && error.payload && error.payload.code) || "");
    const messages = {
        GEMINI_NOT_CONFIGURED: "AI тимчасово недоступний: ключ Gemini не налаштовано.",
        AI_FORBIDDEN: "AI-тренування доступне у тарифі PRO.",
        AI_DAILY_LIMIT: `Ліміт PRO вичерпано: ${AI_PRO_DAILY_LIMIT} AI-тренування на день. Спробуй завтра.`,
        TIMEOUT: "AI не встиг відповісти. Спробуй ще раз.",
        RATE_LIMIT: "Забагато запитів. Зачекай кілька секунд.",
        AI_RATE_LIMIT: "Забагато AI-запитів. Зачекай трохи.",
        INVALID_RESPONSE: "AI повернув некоректну відповідь. Спробуй ще раз або переформулюй.",
        INPUT_TOO_LONG: "Опис задовгий. Скороти текст.",
        INPUT_TOO_SHORT: "Опис закороткий."
    };
    if (messages[code]) {
        return messages[code];
    }
    const status = Number(error && error.status ? error.status : 0);
    if (status === 403) {
        return "Немає доступу до AI-функції.";
    }
    return (error && error.message) || "Не вдалося обробити запит. Спробуй ще раз.";
}

function aiNormalizeResult(result) {
    const safe = result && typeof result === "object" ? result : {};
    return {
        title: safe.title || "",
        date: safe.date || "",
        workoutType: safe.workoutType || "custom",
        notes: safe.notes || "",
        exercises: Array.isArray(safe.exercises) ? safe.exercises.map((exercise) => ({
            exerciseId: exercise.exerciseId || null,
            recognizedName: exercise.recognizedName || "Вправа",
            matchedName: exercise.matchedName || null,
            primaryMuscleGroup: exercise.primaryMuscleGroup || null,
            mediaUrl: exercise.mediaUrl || "",
            confidence: exercise.confidence,
            status: exercise.status || (exercise.exerciseId ? "resolved" : "not_found"),
            options: Array.isArray(exercise.options) ? exercise.options : [],
            notes: exercise.notes || "",
            sets: Array.isArray(exercise.sets) ? exercise.sets.map((set) => ({
                type: set.type || "working",
                weight: Number(set.weight) || 0,
                repetitions: Number(set.repetitions) || 0,
                durationSeconds: set.durationSeconds === null || set.durationSeconds === undefined ? null : Number(set.durationSeconds),
                rpe: set.rpe === null || set.rpe === undefined ? 0 : Number(set.rpe),
                restSeconds: set.restSeconds === null || set.restSeconds === undefined ? 90 : Number(set.restSeconds),
                notes: set.notes || ""
            })) : []
        })) : [],
        cardioSessions: Array.isArray(safe.cardioSessions) ? safe.cardioSessions.map((cardio) => ({
            type: cardio.type || "treadmill",
            durationMinutes: Number(cardio.durationMinutes) || 0,
            distance: cardio.distance === null || cardio.distance === undefined ? 0 : Number(cardio.distance),
            calories: cardio.calories === null || cardio.calories === undefined ? 0 : Number(cardio.calories),
            averageHeartRate: cardio.averageHeartRate === null || cardio.averageHeartRate === undefined ? 0 : Number(cardio.averageHeartRate),
            intensity: cardio.intensity || "medium",
            notes: cardio.notes || ""
        })) : [],
        warnings: Array.isArray(safe.warnings) ? safe.warnings : [],
        unresolvedExercises: Array.isArray(safe.unresolvedExercises) ? safe.unresolvedExercises : [],
        meta: safe.meta || {}
    };
}

export function aiEditWorkoutField(field, value) {
    if (!aiState.result) {
        return;
    }
    aiState.result[field] = value;
}

export function aiEditSet(exIndex, setIndex, field, value) {
    const exercise = aiState.result && aiState.result.exercises[Number(exIndex)];
    const set = exercise && exercise.sets[Number(setIndex)];
    if (!set) {
        return;
    }
    set[field] = ["weight", "repetitions", "rpe", "restSeconds", "durationSeconds"].includes(field) ? Number(value) || 0 : value;
}

export function aiEditCardio(cardioIndex, field, value) {
    const cardio = aiState.result && aiState.result.cardioSessions[Number(cardioIndex)];
    if (!cardio) {
        return;
    }
    cardio[field] = ["durationMinutes", "distance", "calories", "averageHeartRate"].includes(field) ? Number(value) || 0 : value;
}

export function aiAddSet(exIndex) {
    const exercise = aiState.result && aiState.result.exercises[Number(exIndex)];
    if (!exercise) {
        return;
    }
    const previous = exercise.sets[exercise.sets.length - 1];
    exercise.sets.push(previous
        ? { ...previous }
        : { type: "working", weight: 0, repetitions: 0, durationSeconds: null, rpe: 0, restSeconds: 90, notes: "" });
    renderAiBlock();
}

export function aiRemoveSet(exIndex, setIndex) {
    const exercise = aiState.result && aiState.result.exercises[Number(exIndex)];
    if (!exercise) {
        return;
    }
    exercise.sets.splice(Number(setIndex), 1);
    renderAiBlock();
}

export function aiRemoveExercise(exIndex) {
    if (!aiState.result) {
        return;
    }
    aiState.result.exercises.splice(Number(exIndex), 1);
    renderAiBlock();
}

export function aiRemoveCardio(cardioIndex) {
    if (!aiState.result) {
        return;
    }
    aiState.result.cardioSessions.splice(Number(cardioIndex), 1);
    renderAiBlock();
}

export function aiPickOption(exIndex, optionId) {
    const exercise = aiState.result && aiState.result.exercises[Number(exIndex)];
    if (!exercise) {
        return;
    }
    const option = (exercise.options || []).find((item) => item.id === optionId);
    const catalogExercise = exerciseById(optionId);
    exercise.exerciseId = optionId;
    exercise.matchedName = (option && option.name) || (catalogExercise && catalogExercise.name) || exercise.recognizedName;
    exercise.primaryMuscleGroup = (option && option.primaryMuscleGroup) || (catalogExercise && catalogExercise.primaryMuscleGroup) || exercise.primaryMuscleGroup;
    exercise.status = "resolved";
    renderAiBlock();
}

export function aiOpenCatalogPicker(exIndex) {
    aiState.pickerExIndex = Number(exIndex);
    state.filters.exerciseSearch = "";
    openModal(aiCatalogPickerContent(), { fullscreen: true, list: true });
}

function aiCatalogPickerContent() {
    return `<div class="modal-header"><div><h2>Обери вправу</h2><p class="card-caption">Заміни нерозпізнану вправу вправою з каталогу.</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div>
            <div class="ai-catalog-search"><i data-lucide="search"></i><input type="search" placeholder="Пошук вправи…" data-action="ai-catalog-search" autocomplete="off"></div>
            <div id="aiCatalogGrid" class="ai-catalog-grid modal-list-scroll">${aiCatalogCards()}</div>`;
}

export function aiCatalogCards() {
    const search = String(state.filters.exerciseSearch || "").trim().toLowerCase();
    const list = (state.database.exercises || []).filter((exercise) => {
        if (!search) {
            return true;
        }
        return [exercise.name, (exercise.aliases || []).join(" "), exercise.primaryMuscleGroup, exercise.equipment].join(" ").toLowerCase().includes(search);
    }).slice(0, 60);
    if (!list.length) {
        return `<div class="ai-empty">Нічого не знайдено.</div>`;
    }
    return list.map((exercise) => `<article class="exercise-card has-thumb" data-action="ai-choose-exercise" data-exercise-id="${exercise.id}">${exerciseThumb(exercise)}<h3>${escapeHtml(exercise.name)}</h3><p class="card-caption">${escapeHtml(exercise.primaryMuscleGroup || "")}${exercise.equipment ? " · " + escapeHtml(exercise.equipment) : ""}</p></article>`).join("");
}

export function aiChooseExercise(exerciseId) {
    const exIndex = aiState.pickerExIndex;
    const exercise = aiState.result && aiState.result.exercises[Number(exIndex)];
    const catalogExercise = exerciseById(exerciseId);
    if (exercise && catalogExercise) {
        exercise.exerciseId = catalogExercise.id;
        exercise.matchedName = catalogExercise.name;
        exercise.primaryMuscleGroup = catalogExercise.primaryMuscleGroup;
        exercise.status = "resolved";
    }
    closeOverlay();
    renderAiBlock();
}

export function aiReset() {
    aiState.text = "";
    aiState.result = null;
    aiState.error = null;
    aiState.status = "idle";
    renderAiBlock();
}

export async function aiApply() {
    const result = aiState.result;
    if (!result) {
        return;
    }
    if (!aiCanApply(result)) {
        toast("Оберіть вправи", "Спочатку познач усі нерозпізнані вправи.");
        return;
    }
    const now = new Date();
    const targetDate = result.date || dateInput(now);
    const limit = workoutLimitState(currentUser().id, targetDate);
    if (!limit.allowed) {
        toast("Ліміт тренувань", limit.message);
        return;
    }
    const workoutItem = {
        id: createId("workout"),
        userId: currentUser().id,
        date: targetDate,
        title: result.title || "Тренування",
        // Always planned — AI never starts a workout automatically.
        status: "planned",
        workoutType: result.workoutType || getPref("defaultWorkoutType"),
        durationOverride: null,
        startedAt: null,
        finishedAt: null,
        notes: result.notes || "",
        exercises: result.exercises.filter((exercise) => exercise.exerciseId).map((exercise, index) => ({
            id: createId("workout-exercise"),
            exerciseId: exercise.exerciseId,
            order: index + 1,
            notes: exercise.notes || "",
            sets: (exercise.sets || []).map((set) => ({
                id: createId("set"),
                type: set.type || "working",
                weight: Number(set.weight) || 0,
                repetitions: Number(set.repetitions) || 0,
                durationSeconds: set.durationSeconds === null || set.durationSeconds === undefined ? null : Math.round(Number(set.durationSeconds)) || null,
                rpe: Number(set.rpe) || 0,
                restSeconds: Number(set.restSeconds) || 90,
                isCompleted: false,
                notes: set.notes || ""
            }))
        })),
        cardioSessions: (result.cardioSessions || []).map((cardio) => ({
            id: createId("cardio"),
            type: cardio.type || "treadmill",
            durationMinutes: Number(cardio.durationMinutes) || 0,
            distance: Number(cardio.distance) || 0,
            calories: Number(cardio.calories) || 0,
            averageHeartRate: Number(cardio.averageHeartRate) || 0,
            intensity: cardio.intensity || "medium",
            notes: cardio.notes || ""
        })),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
    };
    state.database.workouts.push(workoutItem);
    state.editingWorkoutId = workoutItem.id;
    aiState.text = "";
    aiState.result = null;
    aiState.status = "idle";
    await persistWorkout(workoutItem);
    toast("Чернетку створено", "Перевір і відредагуй перед стартом — тренування у статусі «Заплановано».");
    goToWorkoutEditor(workoutItem.id);
}
