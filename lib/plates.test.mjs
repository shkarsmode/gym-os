import test from "node:test";
import assert from "node:assert/strict";
import {
    plateBreakdown, plateHint, usesBarbell, plateLabel, DEFAULT_BAR_KG, DEFAULT_PLATES
} from "./plates.js";

test("splits an ordinary working weight per side", () => {
    const result = plateBreakdown(80);
    assert.equal(result.kind, "loaded");
    // (80 - 20) / 2 = 30 per side.
    assert.deepEqual(result.perSide, [25, 5]);
    assert.equal(result.achievedKg, 80);
    assert.equal(result.exact, true);
});

test("counts repeated plates instead of listing them one by one", () => {
    // 180 kg: 80 per side, and greedy takes the 25s first — 25+25+25+5.
    const result = plateBreakdown(180);
    assert.deepEqual(result.perSide, [25, 25, 25, 5]);
    assert.deepEqual(result.counts, [[25, 3], [5, 1]]);
});

test("says so when the bar alone is the answer", () => {
    const result = plateBreakdown(20);
    assert.equal(result.kind, "bar-only");
    assert.deepEqual(result.perSide, []);
    assert.equal(plateHint(20), "тільки гриф 20");
});

test("refuses to invent plates for a weight under the bar", () => {
    // A dumbbell number typed against a barbell exercise. There is nothing to hang, and
    // pretending otherwise would put a wrong instruction in front of somebody at a rack.
    const result = plateBreakdown(12);
    assert.equal(result.kind, "below-bar");
    assert.equal(plateHint(12), "");
});

test("handles nonsense without throwing", () => {
    for (const value of [0, -40, NaN, null, undefined, "abc"]) {
        const result = plateBreakdown(value);
        assert.equal(result.kind, "invalid");
        assert.equal(plateHint(value), "");
    }
});

test("survives the floating-point weights this arithmetic produces", () => {
    // (62.5 - 20) / 2 = 21.25, which subtracts down through 20 to 1.2499999999999996.
    // Without the epsilon the final 1.25 is dropped and the hint is silently 2.5 kg light.
    const result = plateBreakdown(62.5);
    assert.deepEqual(result.perSide, [20, 1.25]);
    assert.equal(result.achievedKg, 62.5);
    assert.equal(result.exact, true);
});

test("lands under and REPORTS it when the plates cannot reach the number", () => {
    // 81 kg: 30.5 per side, and there is no 0.5 plate. Better to say "→ 80" than to round
    // in silence and have somebody believe they lifted a kilo they did not.
    const result = plateBreakdown(81);
    assert.equal(result.exact, false);
    assert.equal(result.achievedKg, 80);
    assert.equal(result.shortfallKg, 1);
    assert.match(plateHint(81), /→ 80 кг$/);
});

test("never claims more than it loads", () => {
    for (let total = 20; total <= 300; total += 0.5) {
        const result = plateBreakdown(total);
        assert.ok(result.achievedKg <= total + 1e-9, `overshot at ${total}`);
        const loaded = result.perSide.reduce((sum, plate) => sum + plate, 0);
        assert.equal(Math.round((result.barKg + loaded * 2) * 100) / 100, result.achievedKg);
    }
});

test("is exact for every 2.5 kg step, which is how weights are actually chosen", () => {
    for (let total = 20; total <= 250; total += 2.5) {
        assert.equal(plateBreakdown(total).exact, true, `not exact at ${total}`);
    }
});

test("honours a lighter bar", () => {
    const result = plateBreakdown(50, { barKg: 15 });
    assert.equal(result.barKg, 15);
    assert.deepEqual(result.perSide, [15, 2.5]);
    assert.equal(result.achievedKg, 50);
    assert.match(plateHint(50, { barKg: 15 }), /^гриф 15 · 15\+2\.5 з боку$/);
});

test("honours a gym that only owns a few plates", () => {
    const result = plateBreakdown(100, { plates: [20, 10] });
    assert.deepEqual(result.perSide, [20, 20]);
    assert.equal(result.achievedKg, 100);
    // And one it cannot make with those plates: 37.5 per side takes a 20 and a 10, and
    // the remaining 7.5 has nothing to land on — so the bar carries 80, not 95.
    const odd = plateBreakdown(95, { plates: [20, 10] });
    assert.equal(odd.exact, false);
    assert.equal(odd.achievedKg, 80);
    assert.equal(odd.shortfallKg, 15);
});

test("ignores junk in the plate list rather than producing junk", () => {
    const result = plateBreakdown(80, { plates: [25, -5, 0, NaN, 5] });
    assert.deepEqual(result.perSide, [25, 5]);
});

test("recognises a barbell from the catalogue's own wording", () => {
    assert.equal(usesBarbell("Штанга"), true);
    assert.equal(usesBarbell("штанга"), true);
    assert.equal(usesBarbell("Barbell"), true);
    assert.equal(usesBarbell("EZ-гриф"), true);
    // Everything else must stay silent, which is what keeps the hint off most rows.
    assert.equal(usesBarbell("Гантелі"), false);
    assert.equal(usesBarbell("Тренажер"), false);
    assert.equal(usesBarbell("Вага тіла"), false);
    assert.equal(usesBarbell(""), false);
    assert.equal(usesBarbell(null), false);
});

test("writes plate numbers the way they are painted on them", () => {
    assert.equal(plateLabel(2.5), "2.5");
    assert.equal(plateLabel(20), "20");
    assert.equal(plateLabel(1.25), "1.25");
});

test("ships sane defaults", () => {
    assert.equal(DEFAULT_BAR_KG, 20);
    assert.deepEqual([...DEFAULT_PLATES].sort((a, b) => b - a), DEFAULT_PLATES);
});
