/**
 * What to hang on the bar.
 *
 * The one arithmetic problem everybody actually does in a gym, standing in front of a
 * rack, every single set. `80` means nothing until it means "twenty, five and two and a
 * half, per side, on a twenty-kilo bar" — and getting it wrong costs a walk back to the
 * rack with a plate in each hand.
 *
 * Pure and total: every input returns a shape, including the awkward ones (lighter than
 * the bar, an odd number that no combination of plates can reach). The caller renders
 * whatever it gets and never has to special-case a null.
 */

export const DEFAULT_BAR_KG = 20;

/** Standard commercial-gym set, heaviest first — the greedy walk depends on that order. */
export const DEFAULT_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];

/** Equipment values that actually involve a loadable bar. */
const BARBELL_EQUIPMENT = ["штанга", "barbell", "гриф"];

export function usesBarbell(equipment) {
    const value = String(equipment || "").trim().toLowerCase();
    return BARBELL_EQUIPMENT.some((name) => value.includes(name));
}

/**
 * Greedy split of the load into plates PER SIDE.
 *
 * Greedy is exact for the standard set (every plate divides the ones above it in the
 * useful range), and where it cannot land exactly it lands just under and reports the
 * shortfall rather than silently rounding — a hint that quietly lies about the weight on
 * the bar is worse than no hint.
 *
 * @param {number} totalKg  the weight the athlete typed, bar included
 * @param {{barKg?: number, plates?: number[]}} [options]
 * @returns {{
 *   kind: "loaded" | "bar-only" | "below-bar" | "invalid",
 *   perSide: number[], counts: Array<[number, number]>,
 *   achievedKg: number, shortfallKg: number, exact: boolean, barKg: number
 * }}
 */
export function plateBreakdown(totalKg, options = {}) {
    const barKg = Number.isFinite(Number(options.barKg)) ? Number(options.barKg) : DEFAULT_BAR_KG;
    const plates = (options.plates && options.plates.length ? options.plates : DEFAULT_PLATES)
        .map(Number).filter((plate) => Number.isFinite(plate) && plate > 0)
        .sort((left, right) => right - left);
    const total = Number(totalKg);
    const empty = { perSide: [], counts: [], achievedKg: barKg, shortfallKg: 0, exact: true, barKg };

    if (!Number.isFinite(total) || total <= 0) {
        return { kind: "invalid", ...empty, achievedKg: 0 };
    }
    if (total < barKg) {
        // A dumbbell weight typed against a barbell exercise, or a bar lighter than the
        // setting says. Either way there is nothing to hang.
        return { kind: "below-bar", ...empty };
    }
    if (total === barKg) {
        return { kind: "bar-only", ...empty };
    }

    let perSideRemaining = (total - barKg) / 2;
    const perSide = [];
    for (const plate of plates) {
        // A floating-point epsilon, because 62.5 - 20 halved is the sort of number that
        // arrives as 21.249999999999996 and quietly loses a 1.25 off the end.
        while (perSideRemaining + 1e-9 >= plate) {
            perSideRemaining -= plate;
            perSide.push(plate);
        }
    }
    const loaded = perSide.reduce((sum, plate) => sum + plate, 0);
    const achievedKg = round2(barKg + loaded * 2);
    const shortfallKg = round2(total - achievedKg);
    return {
        kind: "loaded",
        perSide,
        counts: countPlates(perSide),
        achievedKg,
        shortfallKg,
        exact: shortfallKg === 0,
        barKg
    };
}

function countPlates(perSide) {
    const counts = [];
    for (const plate of perSide) {
        const last = counts[counts.length - 1];
        if (last && last[0] === plate) {
            last[1] += 1;
        } else {
            counts.push([plate, 1]);
        }
    }
    return counts;
}

function round2(value) {
    return Math.round(value * 100) / 100;
}

/** `2.5` not `2.50`, `20` not `20.0` — plates are written the way they are painted. */
export function plateLabel(plate) {
    return String(Math.round(plate * 100) / 100);
}

/**
 * The compact one-liner: `гриф 20 · 20+5+2.5 з боку`.
 *
 * Returns "" when there is nothing worth saying, so the caller can drop the whole line
 * rather than render an empty row.
 */
export function plateHint(totalKg, options = {}) {
    const result = plateBreakdown(totalKg, options);
    if (result.kind === "invalid" || result.kind === "below-bar") {
        return "";
    }
    if (result.kind === "bar-only") {
        return `тільки гриф ${plateLabel(result.barKg)}`;
    }
    const perSide = result.perSide.map(plateLabel).join("+");
    const head = `гриф ${plateLabel(result.barKg)} · ${perSide} з боку`;
    return result.exact ? head : `${head} → ${plateLabel(result.achievedKg)} кг`;
}
