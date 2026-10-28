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
// - Rest grows with the load: 1 min after the first warm-up, +30 s after each next one
//   (up to 2.5 min), and 3 min after the last — the heavy set primes the working one
//   only once its fatigue has faded, which takes minutes, not seconds (the owner asked
//   for this after the first version gave 1 min / 2 min; the PAPE literature agrees).
//   The working sets of a multi-joint lift rest at least 3 min too (Schoenfeld et al.
//   2016: 3 min beat 1 min for strength and size in trained lifters).

/** Patterns that move several joints — the big lifts and their machine versions. */
export const COMPOUND_PATTERNS = new Set(["Горизонтальний жим", "Похилий жим", "Вертикальний жим", "Горизонтальна тяга", "Вертикальна тяга", "Присідання", "Hinge", "Випад"]);

export const EMPTY_BAR = 20;
export const WARMUP_REST_FIRST = 60;
export const WARMUP_REST_STEP = 30;
export const WARMUP_REST_CAP = 150;
export const WARMUP_REST_BEFORE_WORK = 180;
export const COMPOUND_WORKING_REST = 180;

/** Rest after warm-up number `index` of `total`: 1:00, 1:30, 2:00, 2:30 … and 3:00 after the last. */
export function warmupRest(index, total) {
    if (index >= total - 1) {
        return WARMUP_REST_BEFORE_WORK;
    }
    return Math.min(WARMUP_REST_CAP, WARMUP_REST_FIRST + WARMUP_REST_STEP * index);
}

/** The least rest after a working set: 3 min for a multi-joint lift; isolation is left as it is. */
export function minWorkingRest(exercise) {
    return exercise && COMPOUND_PATTERNS.has(exercise.movementPattern) ? COMPOUND_WORKING_REST : 0;
}

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
    const finish = (sets) => sets.map((set, index) => ({
        ...set,
        restSeconds: warmupRest(index, sets.length),
        pct: load > 0 ? Math.round((set.weight / load) * 100) : null
    }));

    if (bodyweight) {
        // Dips and pull-ups: the body is most of the load, so a percentage of the belt
        // weight means little. Without added weight: one easy set of about a third.
        if (load <= 0) {
            return finish([{ weight: 0, reps: Math.max(2, Math.round(count / 3)), note: "легкий підхід" }]);
        }
        const sets = [{ weight: 0, reps: 5, note: "без ваги" }];
        const half = Math.max(step, roundTo(load / 2, step));
        if (!warm && half <= load - step) {
            sets.push({ weight: half, reps: 3, note: null });
        }
        return finish(sets);
    }

    if (load <= 0) {
        return [];
    }

    if (!compound && count >= 11) {
        // High-rep isolation: the working set is light already — one heavier feeler.
        // Never below what the bar itself weighs.
        const only = Math.min(roundTo(load * final.pct, step), load - step);
        return only >= (barbell ? EMPTY_BAR : step) ? finish([{ weight: only, reps: final.reps, note: null }]) : [];
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
    return finish(all);
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

/** The sets the working numbers are for: working sets still to do, counted in reps. */
export function openWorkingSets(sets) {
    return (sets || []).filter((set) => set.type === "working" && !set.isCompleted && isRepSet(set));
}

/**
 * The exercise's sets with the warm-up applied — the whole exercise, exactly as the sheet
 * previews it.
 *
 * Nothing completed is changed. Unfinished warm-ups are replaced by the plan, minus what
 * finished ones already covered. The working sets still to do become `working.count` sets
 * (default: as many as there are, at least one), every one at the working weight × reps:
 * the existing ones are reused in order — their rest and notes stay — missing ones are
 * added, extra ones dropped. Until 0.75 only the first of them took the new numbers, so a
 * recalculated 80 × 5 was followed by the old 60 × 6. Sets of another kind (drop, failure,
 * back-off, a hold) keep their numbers and follow the working sets. `working.minRest`
 * raises — never lowers — the rest of everything still to do after the warm-ups.
 * `makeSet(type, weight, reps, restSeconds)` creates a set.
 */
export function applyWarmupSets(sets, plan, working, makeSet) {
    const existing = sets || [];
    const done = existing.filter((set) => set.isCompleted);
    const doneWarmups = done.filter((set) => set.type === "warmup");
    const covered = doneWarmups.length ? Math.max(...doneWarmups.map((set) => Number(set.weight) || 0)) : -Infinity;
    const fresh = plan
        .filter((set) => set.weight > covered)
        .map((set) => makeSet("warmup", set.weight, set.reps, set.restSeconds));
    const openWork = openWorkingSets(existing);
    const others = existing.filter((set) => !set.isCompleted && set.type !== "warmup" && !openWork.includes(set));
    const count = Math.max(1, Math.round(Number(working.count) || openWork.length || 1));
    const minRest = Number(working.minRest) || 0;
    // A working set added to make up the count rests like the last one there was.
    const addedRest = openWork.length ? Number(openWork[openWork.length - 1].restSeconds) || 0 : Number(working.restSeconds) || 0;
    const work = Array.from({ length: count }, (_, index) => openWork[index] || makeSet("working", working.weight, working.reps, addedRest));
    work.forEach((set) => {
        set.weight = working.weight;
        set.repetitions = working.reps;
    });
    if (minRest) {
        [...work, ...others].forEach((set) => {
            set.restSeconds = Math.max(Number(set.restSeconds) || 0, minRest);
        });
    }
    return [...done, ...fresh, ...work, ...others];
}
