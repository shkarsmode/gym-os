// Avatar frames: 25 rarity tiers, one every 20 levels (500 / 25). Higher tiers
// look progressively more premium — muted metals early, glowing gem tones mid,
// animated holographic rings near the cap (Apex-style). Fully config-driven: the
// CSS reads a single gradient + glow variable per tier, so there are no bespoke
// per-tier components — add/tune a tier by editing one row here.

import { LEVEL_COUNT } from "./levels.js";

export const FRAME_TIER_SIZE = LEVEL_COUNT / 25;

// [name, colors[], glow 0..1, conic?] — conic tiers render an animated spinning ring.
const TIER_ROWS = [
    ["Залізо", ["#4b5563", "#9ca3af"], 0.0, false],
    ["Бронза", ["#78350f", "#c2803a"], 0.05, false],
    ["Мідь", ["#7c2d12", "#d1823f"], 0.07, false],
    ["Сталь", ["#475569", "#cbd5e1"], 0.1, false],
    ["Срібло", ["#64748b", "#e2e8f0"], 0.14, false],
    ["Нефрит", ["#065f46", "#34d399"], 0.18, false],
    ["Смарагд", ["#047857", "#6ee7b7"], 0.22, false],
    ["Бірюза", ["#0f766e", "#2dd4bf"], 0.24, false],
    ["Океан", ["#0369a1", "#38bdf8"], 0.28, false],
    ["Сапфір", ["#1d4ed8", "#60a5fa"], 0.32, false],
    ["Індиго", ["#4338ca", "#818cf8"], 0.36, false],
    ["Аметист", ["#6d28d9", "#a78bfa"], 0.4, false],
    ["Фіолет", ["#7e22ce", "#c084fc"], 0.44, false],
    ["Магента", ["#a21caf", "#e879f9"], 0.48, false],
    ["Троянда", ["#be123c", "#fb7185"], 0.52, false],
    ["Рубін", ["#9f1239", "#f43f5e"], 0.56, false],
    ["Золото", ["#a16207", "#fcd34d"], 0.62, false],
    ["Бурштин", ["#b45309", "#fbbf24"], 0.66, false],
    ["Полум'я", ["#c2410c", "#fb923c"], 0.7, false],
    ["Інферно", ["#b91c1c", "#f97316", "#fbbf24"], 0.76, false],
    ["Плазма", ["#22d3ee", "#a78bfa", "#f472b6"], 0.8, true],
    ["Голограма", ["#34d399", "#60a5fa", "#c084fc"], 0.85, true],
    ["Спектр", ["#f472b6", "#facc15", "#34d399", "#60a5fa"], 0.9, true],
    ["Призма", ["#f43f5e", "#f59e0b", "#facc15", "#34d399", "#38bdf8", "#a78bfa"], 0.95, true],
    ["Апекс", ["#f43f5e", "#fb923c", "#facc15", "#34d399", "#38bdf8", "#a78bfa", "#f472b6"], 1.0, true]
];

function buildGradient(colors, conic) {
    if (conic) {
        return `conic-gradient(from 0deg, ${[...colors, colors[0]].join(", ")})`;
    }
    return `linear-gradient(135deg, ${colors.join(", ")})`;
}

export const FRAME_TIERS = TIER_ROWS.map(([name, colors, glow, conic], index) => ({
    index,
    name,
    colors,
    glow,
    conic,
    gradient: buildGradient(colors, conic),
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
