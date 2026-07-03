// Progression model: users earn XP for real activity and climb 500 levels.
// XP is COMPUTED from existing data (workouts, records, ideas, exercises) — no
// backend column — so every account gets a level from its whole history and old
// data can never break. This module is pure math + reward constants; the actual
// event reconstruction (which needs app data helpers) lives in app.js.

export const LEVEL_COUNT = 500;

// XP granted per real action. Tuned so early levels come quickly (dopamine) but
// the climb stays meaningful later — see LEVEL_THRESHOLDS below.
export const XP_REWARDS = {
    workout: 50,          // per completed workout (quantity)
    volumePerXp: 250,     // +1 XP per this many kg of that workout's volume (progress)
    volumeCap: 60,        // cap the volume bonus so one huge session can't spike
    streak: 15,           // bonus when a workout continues a streak (consistency)
    record: 40,           // per exercise personal best (estimated 1RM) — progress
    ideaDone: 500,        // per submitted idea later marked "Готово" — community
    exercise: 75          // per exercise the user contributed to the catalog
};

// Per-level cost ramps from cheap to steep so the curve is front-loaded early and
// grindy near 500 (Apex-style). START = XP for level 1→2, MAX = XP for 499→500.
const START_COST = 40;
const MAX_COST = 4200;
const RAMP = 2.2;

function levelCost(level) {
    const t = (level - 1) / (LEVEL_COUNT - 2);
    return Math.round(START_COST + (MAX_COST - START_COST) * Math.pow(t, RAMP));
}

// LEVEL_THRESHOLDS[i] = total XP required to REACH level (i + 1). Index 0 = level 1 = 0 XP.
export const LEVEL_THRESHOLDS = (() => {
    const thresholds = [0];
    let accumulated = 0;
    for (let level = 1; level < LEVEL_COUNT; level += 1) {
        accumulated += levelCost(level);
        thresholds.push(accumulated);
    }
    return thresholds;
})();

export const MAX_XP = LEVEL_THRESHOLDS[LEVEL_COUNT - 1];

export function totalXpForLevel(level) {
    const clamped = Math.max(1, Math.min(LEVEL_COUNT, Math.round(level)));
    return LEVEL_THRESHOLDS[clamped - 1];
}

// Resolve a raw XP total into a rich level descriptor for the UI.
export function levelForXp(totalXp) {
    const xp = Math.max(0, Math.round(Number(totalXp) || 0));
    let level = 1;
    for (let index = LEVEL_COUNT - 1; index >= 0; index -= 1) {
        if (xp >= LEVEL_THRESHOLDS[index]) {
            level = index + 1;
            break;
        }
    }
    const isMax = level >= LEVEL_COUNT;
    const currentThreshold = LEVEL_THRESHOLDS[level - 1];
    const nextThreshold = isMax ? currentThreshold : LEVEL_THRESHOLDS[level];
    const xpForLevel = isMax ? 0 : nextThreshold - currentThreshold;
    const xpIntoLevel = xp - currentThreshold;
    const xpToNext = isMax ? 0 : nextThreshold - xp;
    const progress = isMax ? 1 : xpForLevel === 0 ? 1 : xpIntoLevel / xpForLevel;
    return { level, xp, isMax, currentThreshold, nextThreshold, xpForLevel, xpIntoLevel, xpToNext, progress };
}
