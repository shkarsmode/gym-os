// Warm-up sets before a working set — the formula the owner approved on 2026-10-15.
//
// What it follows, and why:
// - A specific warm-up that climbs to ~80% of the working load improves the first
//   working sets, and a light-only one does not (Ribeiro et al. 2020 IJERPH, 2021 JOMH;
//   a single 80% × 5 beat 40% × 15 and 60% × 10 before sets to failure). So the LAST
//   warm-up is the heavy one: 70–90% of the working weight, closer the fewer reps.
// - Reps fall as the load climbs (10 → 5 → 3 → 2 → 1) and the jumps are even; the
//   heavier the working weight, the more steps (Starting Strength, the NSCA 1RM
//   protocol, Hevy's defaults). A jump is capped at 25% of the working weight — so a
//   140 kg bench climbs in ~35 kg steps and a 16 kg curl in 4 kg ones.
// - Floor pulls do not start on the empty bar; machines and isolation need fewer sets;
//   a muscle an earlier exercise already worked needs only the heavy ones (Neves et al.
//   2025: a short re-warm-up between exercises still helped).
// - Fatigue: no warm-up set asks for more than ~20% of the reps possible at its weight.
// - Rest: 1 min between warm-ups, 2 min before a heavy barbell set (90 s otherwise).

/** Patterns that move several joints — the big lifts and their machine versions. */
export const COMPOUND_PATTERNS = new Set(["Горизонтальний жим", "Похилий жим", "Вертикальний жим", "Горизонтальна тяга", "Вертикальна тяга", "Присідання", "Hinge", "Випад"]);

export const EMPTY_BAR = 20;
export const WARMUP_REST = 60;

/** Holds, carries on the clock, core work and cardio have no weight to climb to. */
export function isWarmupEligible(exercise) {
    return Boolean(exercise) && !exercise.isTimed && !["Кардіо", "Кор"].includes(exercise.movementPattern);
}

/** The heavy last warm-up: how close to the working weight, and for how many reps. */
export function finalWarmup(reps) {
    if (reps <= 3) return { pct: 0.90, reps: 1 };
    if (reps <= 6) return { pct: 0.85, reps: 2 };
    if (reps <= 10) return { pct: 0.80, reps: 3 };
    if (reps <= 15) return { pct: 0.75, reps: 4 };
    return { pct: 0.70, reps: 5 };
}

/** What can actually be loaded: 2.5 kg plates (5 kg from 80 kg), 2 kg dumbbells, 2.5/5 kg stacks. */
export function warmupLoadStep(equipment, weight) {
    if (equipment === "Штанга" || equipment === "Тренажер Сміта") return weight < 80 ? 2.5 : 5;
    if (equipment === "Гантелі" || equipment === "Гиря") return 2;
    if (equipment === "Тренажер" || equipment === "Блок") return weight < 40 ? 2.5 : 5;
    return 2.5;
}

function roundTo(value, step) {
    return Math.round(Math.round(value / step) * step * 100) / 100;
}

/**
 * The warm-up sets before one working set of `weight` × `reps`.
 *
 * `exercise` needs equipment and movementPattern; `warm` means an earlier exercise in
 * this session already worked the muscle. Returns [{ weight, reps, restSeconds, pct, note }],
 * lightest first; empty when no warm-up makes sense (a timed hold, an empty-bar working set).
 */
export function planWarmup({ weight, reps, exercise, warm = false }) {
    const load = Math.max(0, Number(weight) || 0);
    const count = Math.round(Number(reps) || 0);
    if (!isWarmupEligible(exercise) || count <= 0) {
        return [];
    }
    const { equipment, movementPattern } = exercise;
    const compound = COMPOUND_PATTERNS.has(movementPattern);
    const barbell = equipment === "Штанга";
    const machine = equipment === "Тренажер" || equipment === "Блок";
    const bodyweight = equipment === "Вага тіла";
    const step = warmupLoadStep(equipment, load);
    const final = finalWarmup(count);
    const finish = (sets, lastRest) => sets.map((set, index) => ({
        ...set,
        restSeconds: index === sets.length - 1 ? lastRest : WARMUP_REST,
        pct: load > 0 ? Math.round((set.weight / load) * 100) : null
    }));

    if (bodyweight) {
        // Dips and pull-ups: the body is most of the load, so a percentage of the belt
        // weight means little. Without added weight: one easy set of about a third.
        if (load <= 0) {
            return finish([{ weight: 0, reps: Math.max(2, Math.round(count / 3)), note: "легкий підхід" }], 90);
        }
        const sets = [{ weight: 0, reps: 5, note: "без ваги" }];
        const half = Math.max(step, roundTo(load / 2, step));
        if (!warm && half <= load - step) {
            sets.push({ weight: half, reps: 3, note: null });
        }
        return finish(sets, 90);
    }

    if (load <= 0) {
        return [];
    }

    if (!compound && count >= 11) {
        // High-rep isolation: the working set is light already — one heavier feeler.
        // Never below what the bar itself weighs.
        const only = Math.min(roundTo(load * final.pct, step), load - step);
        return only >= (barbell ? EMPTY_BAR : step) ? finish([{ weight: only, reps: final.reps, note: null }], 90) : [];
    }

    const top = Math.min(roundTo(load * final.pct, step), load - step);
    let lead = null;
    let startPct = null;
    if (warm) {
        startPct = compound ? 0.60 : null;
    } else if (barbell && compound && movementPattern !== "Hinge" && load >= 40) {
        lead = { weight: EMPTY_BAR, reps: 10, note: "порожній гриф" };
    } else if (!compound || machine) {
        startPct = 0.50;
    } else {
        startPct = 0.40; // floor pulls, dumbbells, kettlebells
    }

    const floor = barbell ? EMPTY_BAR : step;
    const from = lead ? lead.weight : (startPct === null ? top : Math.max(floor, roundTo(load * startPct, step)));
    const maxJump = load * (!compound ? 0.35 : machine ? 0.30 : 0.25);
    const distance = top - from;
    const jumps = distance > 0 ? Math.max(1, Math.ceil(distance / maxJump)) : 0;

    const loaded = [];
    for (let i = lead ? 1 : 0; i <= jumps; i++) {
        loaded.push(roundTo(from + (distance * i) / Math.max(1, jumps), step));
    }
    const weights = [...new Set(loaded)]
        .filter((value) => value > (lead ? lead.weight : -1) && value >= floor && value <= load - step)
        .sort((a, b) => a - b);

    const firstReps = count >= 12 ? 8 : count >= 8 ? 6 : 5;
    const sets = weights.map((value, index) => {
        const t = weights.length === 1 ? 1 : index / (weights.length - 1);
        return { weight: value, reps: Math.max(final.reps, Math.floor(firstReps + (final.reps - firstReps) * t)), note: null };
    });
    if (sets.length) {
        sets[sets.length - 1].reps = final.reps;
    }
    const all = lead ? [lead, ...sets] : sets;
    const heavyBar = compound && (barbell || equipment === "Тренажер Сміта");
    return finish(all, heavyBar ? 120 : 90);
}

function isRepSet(set) {
    return set && !(Number(set.durationSeconds) > 0);
}

/**
 * What to warm up FOR: the first working set still to do that already has numbers, else
 * last time's heaviest working set (more reps on a tie). Null when there is nothing to go on.
 */
export function warmupPrefill(sets, lastSets, bodyweight = false) {
    const usable = (set) => isRepSet(set) && set.type !== "warmup" && Number(set.repetitions) > 0 && (bodyweight || Number(set.weight) > 0);
    const planned = (sets || []).find((set) => !set.isCompleted && usable(set));
    if (planned) {
        return { weight: Number(planned.weight) || 0, reps: Math.round(Number(planned.repetitions)), source: "set" };
    }
    const best = (lastSets || []).filter(usable).sort((a, b) => (Number(b.weight) - Number(a.weight)) || (Number(b.repetitions) - Number(a.repetitions)))[0];
    return best ? { weight: Number(best.weight) || 0, reps: Math.round(Number(best.repetitions)), source: "last" } : null;
}

/**
 * Whether an earlier exercise in the session already worked this muscle — as its main
 * muscle or a helper (bench press warms the triceps for pushdowns). `previous` is the
 * catalogue entries of the exercises before this one that have sets.
 */
export function muscleAlreadyWarm(previous, exercise) {
    const target = exercise?.primaryMuscleGroup;
    if (!target) {
        return false;
    }
    return (previous || []).some((item) => item && (item.primaryMuscleGroup === target || (item.secondaryMuscleGroups || []).includes(target)));
}

/** The warm-up can still help: nothing working has been done yet. */
export function warmupStillUseful(sets) {
    return !(sets || []).some((set) => set.isCompleted && set.type !== "warmup");
}

/**
 * The exercise's sets with the warm-up applied.
 *
 * Unfinished warm-ups are replaced; finished ones stay, and the plan skips what they
 * already covered. The new warm-ups go right before the first working set, which takes
 * the working numbers (a new one is added if there is none). `makeSet(type, weight, reps,
 * restSeconds)` creates a set; nothing completed is ever changed.
 */
export function applyWarmupSets(sets, plan, working, makeSet) {
    const existing = sets || [];
    const doneWarmups = existing.filter((set) => set.type === "warmup" && set.isCompleted);
    const covered = doneWarmups.length ? Math.max(...doneWarmups.map((set) => Number(set.weight) || 0)) : -Infinity;
    const kept = existing.filter((set) => !(set.type === "warmup" && !set.isCompleted));
    const fresh = plan
        .filter((set) => set.weight > covered)
        .map((set) => makeSet("warmup", set.weight, set.reps, set.restSeconds));
    const firstWork = kept.findIndex((set) => set.type !== "warmup");
    if (firstWork === -1) {
        return [...kept, ...fresh, makeSet("working", working.weight, working.reps, working.restSeconds)];
    }
    const next = [...kept.slice(0, firstWork), ...fresh, ...kept.slice(firstWork)];
    const target = next[firstWork + fresh.length];
    if (target && !target.isCompleted && isRepSet(target)) {
        target.weight = working.weight;
        target.repetitions = working.reps;
    }
    return next;
}
