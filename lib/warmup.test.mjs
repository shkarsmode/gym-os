import test from "node:test";
import assert from "node:assert/strict";
import {
    planWarmup, finalWarmup, warmupLoadStep, isWarmupEligible, warmupPrefill,
    muscleAlreadyWarm, warmupStillUseful, applyWarmupSets, warmupRest, minWorkingRest
} from "./warmup.js";

const ex = (equipment, movementPattern, extra = {}) => ({ equipment, movementPattern, primaryMuscleGroup: "Груди", secondaryMuscleGroups: [], ...extra });
const text = (weight, reps, exercise, warm = false) =>
    planWarmup({ weight, reps, exercise, warm }).map((set) => `${set.weight}×${set.reps}`).join(" ");

// The exact table the owner approved before this was built. Changing the formula means
// changing these lines on purpose — and showing the owner again.
test("the approved examples, set for set", () => {
    const bench = ex("Штанга", "Горизонтальний жим");
    assert.equal(text(100, 5, bench), "20×10 40×5 65×3 85×2");
    assert.equal(text(100, 8, bench), "20×10 40×6 60×4 80×3");
    assert.equal(text(140, 3, bench), "20×10 55×5 90×3 125×1");
    assert.equal(text(60, 8, bench), "20×10 35×6 47.5×3");
    assert.equal(text(200, 3, ex("Штанга", "Присідання")), "20×10 60×5 100×3 140×2 180×1");
    assert.equal(text(180, 3, ex("Штанга", "Hinge")), "70×5 115×3 160×1");
    assert.equal(text(50, 5, ex("Штанга", "Вертикальний жим")), "20×10 32.5×5 42.5×2");
    assert.equal(text(30, 8, ex("Гантелі", "Похилий жим")), "12×6 18×4 24×3");
    assert.equal(text(70, 10, ex("Блок", "Вертикальна тяга")), "35×6 55×3");
    assert.equal(text(200, 10, ex("Тренажер", "Присідання")), "100×6 160×3");
    assert.equal(text(40, 10, ex("Штанга", "Згинання")), "20×6 32.5×3");
    assert.equal(text(16, 10, ex("Гантелі", "Згинання")), "8×6 12×3");
    assert.equal(text(10, 12, ex("Гантелі", "Розведення")), "8×4");
    assert.equal(text(20, 8, ex("Вага тіла", "Вертикальний жим")), "0×5 10×3");
    assert.equal(text(30, 8, ex("Гантелі", "Похилий жим"), true), "18×6 24×3");
});

test("big lifters climb in big steps, small lifts in small ones", () => {
    const steps = (plan) => plan.slice(1).map((set, index) => set.weight - plan[index].weight);
    const heavy = planWarmup({ weight: 140, reps: 3, exercise: ex("Штанга", "Горизонтальний жим") });
    const curl = planWarmup({ weight: 16, reps: 10, exercise: ex("Гантелі", "Згинання") });
    assert.ok(Math.max(...steps(heavy)) >= 30);
    assert.ok(Math.max(...steps(curl)) <= 4);
    assert.ok(curl.length <= 2);
});

test("every warm-up stays far from failure (≤ ~20% of the reps possible at its weight)", () => {
    const cases = [
        [100, 5, ex("Штанга", "Горизонтальний жим")], [100, 8, ex("Штанга", "Горизонтальний жим")],
        [140, 3, ex("Штанга", "Горизонтальний жим")], [200, 3, ex("Штанга", "Присідання")],
        [180, 3, ex("Штанга", "Hinge")], [30, 8, ex("Гантелі", "Похилий жим")],
        [70, 10, ex("Блок", "Вертикальна тяга")], [16, 10, ex("Гантелі", "Згинання")], [60, 15, ex("Тренажер", "Розгинання")]
    ];
    for (const [weight, reps, exercise] of cases) {
        const oneRm = weight * (1 + reps / 30); // Epley
        for (const set of planWarmup({ weight, reps, exercise })) {
            const possible = 30 * (oneRm / set.weight - 1);
            assert.ok(set.reps / possible <= 0.22, `${weight}×${reps}: ${set.weight}×${set.reps} is too hard`);
        }
    }
});

test("rest grows with the load: 1:00, 1:30, 2:00 … and 3:00 before the working set", () => {
    const plan = planWarmup({ weight: 100, reps: 5, exercise: ex("Штанга", "Горизонтальний жим") });
    assert.equal(plan.at(-1).weight, 85);
    assert.deepEqual(plan.map((set) => set.restSeconds), [60, 90, 120, 180]);
    assert.deepEqual(planWarmup({ weight: 200, reps: 3, exercise: ex("Штанга", "Присідання") }).map((set) => set.restSeconds), [60, 90, 120, 150, 180]);
    assert.deepEqual(planWarmup({ weight: 16, reps: 10, exercise: ex("Гантелі", "Згинання") }).map((set) => set.restSeconds), [60, 180]);
    assert.deepEqual(planWarmup({ weight: 10, reps: 12, exercise: ex("Гантелі", "Розведення") }).map((set) => set.restSeconds), [180]);
    assert.deepEqual([0, 1, 2, 3, 4, 5].map((index) => warmupRest(index, 7)), [60, 90, 120, 150, 150, 150]);
    assert.equal(warmupRest(6, 7), 180);
    assert.equal(minWorkingRest(ex("Штанга", "Горизонтальний жим")), 180);
    assert.equal(minWorkingRest(ex("Гантелі", "Згинання")), 0);
    assert.deepEqual([finalWarmup(1), finalWarmup(5), finalWarmup(8), finalWarmup(12), finalWarmup(20)].map((item) => item.pct), [0.9, 0.85, 0.8, 0.75, 0.7]);
});

test("weights are always loadable and climb strictly below the working weight", () => {
    for (const [weight, reps, exercise] of [[92.5, 6, ex("Штанга", "Присідання")], [27, 9, ex("Гантелі", "Горизонтальний жим")], [33, 12, ex("Блок", "Горизонтальна тяга")]]) {
        const step = warmupLoadStep(exercise.equipment, weight);
        const plan = planWarmup({ weight, reps, exercise });
        plan.forEach((set, index) => {
            assert.equal(Math.round(set.weight / step * 1000) % 1000, 0, `${set.weight} is not a multiple of ${step}`);
            assert.ok(set.weight < weight);
            if (index > 0) assert.ok(set.weight > plan[index - 1].weight);
        });
    }
});

test("floor pulls never start on the empty bar; a barbell working set at the bar gets no warm-up", () => {
    assert.ok(planWarmup({ weight: 180, reps: 3, exercise: ex("Штанга", "Hinge") })[0].weight > 20);
    assert.deepEqual(planWarmup({ weight: 20, reps: 12, exercise: ex("Штанга", "Згинання") }), []);
});

test("no warm-up for holds, core, cardio, or nothing to climb to", () => {
    assert.deepEqual(planWarmup({ weight: 20, reps: 30, exercise: ex("Вага тіла", "Кор", { isTimed: true }) }), []);
    assert.deepEqual(planWarmup({ weight: 0, reps: 20, exercise: ex("Вага тіла", "Кор") }), []);
    assert.deepEqual(planWarmup({ weight: 0, reps: 10, exercise: ex("Гантелі", "Згинання") }), []);
    assert.equal(isWarmupEligible(ex("Вага тіла", "Кардіо")), false);
    assert.equal(isWarmupEligible(ex("Штанга", "Присідання")), true);
});

test("pull-ups without added weight: one easy set of about a third", () => {
    assert.equal(text(0, 8, ex("Вага тіла", "Вертикальна тяга")), "0×3");
    assert.equal(text(0, 4, ex("Вага тіла", "Вертикальна тяга")), "0×2");
});

test("prefill: the planned working set first, then last time's heaviest working set", () => {
    const today = [{ type: "warmup", weight: 40, repetitions: 5 }, { type: "working", weight: 102.5, repetitions: 5, isCompleted: false }];
    const last = [{ type: "warmup", weight: 60, repetitions: 3 }, { type: "working", weight: 100, repetitions: 5 }, { type: "working", weight: 100, repetitions: 6 }, { type: "working", weight: 95, repetitions: 8 }];
    assert.deepEqual(warmupPrefill(today, last), { weight: 102.5, reps: 5, source: "set" });
    assert.deepEqual(warmupPrefill([{ type: "working", weight: 0, repetitions: 8 }], last), { weight: 100, reps: 6, source: "last" });
    assert.equal(warmupPrefill([], []), null);
    assert.deepEqual(warmupPrefill([{ type: "working", weight: 0, repetitions: 8 }], [], true), { weight: 0, reps: 8, source: "set" });
    assert.equal(warmupPrefill([{ type: "working", weight: 0, repetitions: 0, durationSeconds: 45 }], []), null);
});

test("a muscle an earlier exercise worked — as its main muscle or a helper — counts as warm", () => {
    const pushdown = { primaryMuscleGroup: "Трицепс" };
    assert.equal(muscleAlreadyWarm([{ primaryMuscleGroup: "Груди", secondaryMuscleGroups: ["Трицепс", "Плечі"] }], pushdown), true);
    assert.equal(muscleAlreadyWarm([{ primaryMuscleGroup: "Трицепс" }], pushdown), true);
    assert.equal(muscleAlreadyWarm([{ primaryMuscleGroup: "Спина", secondaryMuscleGroups: ["Біцепс"] }], pushdown), false);
    assert.equal(muscleAlreadyWarm([], pushdown), false);
});

test("the warm-up stops being offered once a working set is done", () => {
    assert.equal(warmupStillUseful([{ type: "warmup", isCompleted: true }, { type: "working", isCompleted: false }]), true);
    assert.equal(warmupStillUseful([{ type: "working", isCompleted: true }]), false);
});

let nextId = 0;
const makeSet = (type, weight, repetitions, restSeconds) => ({ id: `n${++nextId}`, type, weight, repetitions, restSeconds, isCompleted: false, durationSeconds: null });
const plan100x5 = planWarmup({ weight: 100, reps: 5, exercise: ex("Штанга", "Горизонтальний жим") });

test("apply: warm-ups go before the first working set, which takes the working numbers", () => {
    const sets = [{ id: "w1", type: "working", weight: 95, repetitions: 6, isCompleted: false }, { id: "w2", type: "working", weight: 95, repetitions: 6, isCompleted: false }];
    const next = applyWarmupSets(sets, plan100x5, { weight: 100, reps: 5, restSeconds: 120 }, makeSet);
    assert.deepEqual(next.map((set) => `${set.type[0]}${set.weight}×${set.repetitions}`), ["w20×10", "w40×5", "w65×3", "w85×2", "w100×5", "w95×6"]);
    assert.deepEqual(next.slice(0, 4).map((set) => set.type), ["warmup", "warmup", "warmup", "warmup"]);
    assert.equal(next[4].id, "w1");
});

test("apply: an empty exercise gets the warm-ups and one working set", () => {
    const next = applyWarmupSets([], plan100x5, { weight: 100, reps: 5, restSeconds: 150 }, makeSet);
    assert.equal(next.length, 5);
    assert.deepEqual([next.at(-1).type, next.at(-1).weight, next.at(-1).repetitions, next.at(-1).restSeconds], ["working", 100, 5, 150]);
});

test("apply: unfinished warm-ups are replaced, finished ones stay and are not repeated", () => {
    const sets = [
        { id: "a", type: "warmup", weight: 20, repetitions: 10, isCompleted: true },
        { id: "b", type: "warmup", weight: 40, repetitions: 5, isCompleted: true },
        { id: "c", type: "warmup", weight: 60, repetitions: 3, isCompleted: false },
        { id: "w", type: "working", weight: 100, repetitions: 5, isCompleted: false }
    ];
    const next = applyWarmupSets(sets, plan100x5, { weight: 100, reps: 5, restSeconds: 120 }, makeSet);
    assert.deepEqual(next.map((set) => `${set.weight}×${set.repetitions}${set.isCompleted ? "✓" : ""}`), ["20×10✓", "40×5✓", "65×3", "85×2", "100×5"]);
    assert.equal(next.some((set) => set.id === "c"), false);
});

test("apply: working sets still to do rest at least the minimum — a longer rest is kept", () => {
    const sets = [
        { id: "w1", type: "working", weight: 100, repetitions: 5, restSeconds: 120, isCompleted: false },
        { id: "w2", type: "working", weight: 100, repetitions: 5, restSeconds: 240, isCompleted: false }
    ];
    const next = applyWarmupSets(sets, plan100x5, { weight: 100, reps: 5, restSeconds: 90, minRest: 180 }, makeSet);
    assert.deepEqual(next.filter((set) => set.type === "working").map((set) => set.restSeconds), [180, 240]);
    const fresh = applyWarmupSets([], plan100x5, { weight: 100, reps: 5, restSeconds: 90, minRest: 180 }, makeSet);
    assert.equal(fresh.at(-1).restSeconds, 180);
});

test("apply: a completed working set is never rewritten", () => {
    const sets = [{ id: "w", type: "working", weight: 90, repetitions: 5, isCompleted: true }];
    const next = applyWarmupSets(sets, plan100x5, { weight: 100, reps: 5, restSeconds: 120 }, makeSet);
    assert.deepEqual([next.at(-1).weight, next.at(-1).repetitions, next.at(-1).isCompleted], [90, 5, true]);
});
