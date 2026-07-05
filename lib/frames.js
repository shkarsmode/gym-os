// Avatar frames: 25 rarity tiers, one every 20 levels (500 / 25). The progression
// is designed to be clearly escalating, not just recoloured: early tiers are thin,
// matte, glow-less metals; the middle bands are thicker, glossy, glowing gems; the
// top five are animated conic holo rings, and the final tier also pulses. Every
// visual axis (colour, ring width, glow, gloss, animation) ramps with the tier, so
// a tier reads as strictly "better" than the one below it. Fully config-driven: the
// CSS reads per-tier gradient/glow/width vars + a couple of modifier classes, so
// there are no bespoke per-tier components — tune a tier by editing one row here.

import { LEVEL_COUNT } from "./levels.js";

export const FRAME_TIER_SIZE = LEVEL_COUNT / 25;

// [name, colors[], glow 0..1, ringWidthPx, kind] where kind is:
//   "matte" — flat/subtle linear ring, no gloss (cheap early tiers)
//   "gloss" — linear ring with a glossy highlight + glow (mid tiers)
//   "conic" — animated spinning conic ring + glow (top tiers)
const TIER_ROWS = [
    ["Залізо", ["#2f343c", "#4b525c"], 0.0, 2, "matte"],
    ["Бронза", ["#6b3f16", "#9c6327"], 0.0, 2, "matte"],
    ["Мідь", ["#7a3410", "#c07636"], 0.06, 2, "matte"],
    ["Сталь", ["#3f4a59", "#8792a1"], 0.1, 2, "matte"],
    ["Срібло", ["#8794a2", "#dfe6ee"], 0.16, 3, "matte"],
    ["Нефрит", ["#0b6b4f", "#2fd39a"], 0.26, 3, "gloss"],
    ["Смарагд", ["#059669", "#6ee7b7"], 0.32, 3, "gloss"],
    ["Бірюза", ["#0d7d74", "#2dd4bf"], 0.38, 3, "gloss"],
    ["Океан", ["#0369a1", "#38bdf8"], 0.44, 4, "gloss"],
    ["Сапфір", ["#1d4ed8", "#7cb0ff"], 0.5, 4, "gloss"],
    ["Аметист", ["#6d28d9", "#b79bff"], 0.55, 4, "gloss"],
    ["Фіолет", ["#7e22ce", "#c98bff"], 0.6, 4, "gloss"],
    ["Магента", ["#a21caf", "#f07cf6"], 0.64, 5, "gloss"],
    ["Троянда", ["#be123c", "#fb7185"], 0.68, 5, "gloss"],
    ["Рубін", ["#9f1239", "#ff5b7a"], 0.72, 5, "gloss"],
    ["Золото", ["#a16207", "#ffd764"], 0.78, 5, "gloss"],
    ["Бурштин", ["#b45309", "#ffc84d"], 0.82, 6, "gloss"],
    ["Полум'я", ["#c2410c", "#ff9a4d"], 0.86, 6, "gloss"],
    ["Жар", ["#dc2626", "#ff8a3d", "#ffc24d"], 0.9, 6, "gloss"],
    ["Інферно", ["#b91c1c", "#f97316", "#ffd24d"], 0.94, 6, "gloss"],
    ["Плазма", ["#22d3ee", "#a78bfa", "#f472b6"], 0.86, 6, "conic"],
    ["Голограма", ["#34d399", "#60a5fa", "#c084fc"], 0.9, 6, "conic"],
    ["Спектр", ["#f472b6", "#facc15", "#34d399", "#60a5fa"], 0.94, 7, "conic"],
    ["Призма", ["#f43f5e", "#f59e0b", "#facc15", "#34d399", "#38bdf8", "#a78bfa"], 0.97, 7, "conic"],
    ["Апекс", ["#f43f5e", "#fb923c", "#facc15", "#34d399", "#38bdf8", "#a78bfa", "#f472b6"], 1.0, 8, "conic"]
];

function buildGradient(colors, conic) {
    if (conic) {
        return `conic-gradient(from 0deg, ${[...colors, colors[0]].join(", ")})`;
    }
    return `linear-gradient(135deg, ${colors.join(", ")})`;
}

// Small glyph shown on the level nameplate, escalating with the tier band.
const TIER_EMBLEMS = ["", "", "◦", "◦", "◦", "◇", "◇", "◇", "◇", "◇", "◆", "◆", "◆", "◆", "◆", "★", "★", "★", "★", "★", "✦", "✦", "✦", "❖", "❖"];

// Layered "ranked badge" progression — each visual axis only ever switches ON as the
// tier rises, so a higher frame is always strictly richer. Milestones the climber feels:
//   T3  nameplate · T6 gloss + corner brackets · T11 keyline + top crest · T12 aura
//   bloom · T16 orbiting sparkles + arc ring · T21 the ring comes alive (spins) ·
//   T24 counter-rotating second arc · T25 the whole thing breathes.
export const FRAME_TIERS = TIER_ROWS.map(([name, colors, glow, width, kind], index) => ({
    index,
    name,
    colors,
    glow,
    width,
    conic: kind === "conic",
    anim: kind === "conic",
    sheen: kind !== "matte",
    corners: index >= 5,
    ornament: index >= 10,
    crest: index >= 10,
    aura: index >= 11,
    spark: index >= 15,
    orbit: index >= 15,
    orbit2: index >= 23,
    plate: index >= 2,
    pulse: index === TIER_ROWS.length - 1,
    emblem: TIER_EMBLEMS[index] || "",
    gradient: buildGradient(colors, kind === "conic"),
    glowColor: colors[colors.length - 1],
    unlockLevel: index * FRAME_TIER_SIZE + 1
}));

export const FRAME_TIER_COUNT = FRAME_TIERS.length;

export function frameForLevel(level) {
    const index = Math.max(0, Math.min(FRAME_TIER_COUNT - 1, Math.floor((Math.max(1, level) - 1) / FRAME_TIER_SIZE)));
    return FRAME_TIERS[index];
}

// The tier a user is progressing toward (null once the final tier is reached).
export function nextFrameForLevel(level) {
    const current = frameForLevel(level);
    return current.index >= FRAME_TIER_COUNT - 1 ? null : FRAME_TIERS[current.index + 1];
}
