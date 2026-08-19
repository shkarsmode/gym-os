// Specs for the progression curve (levels.js) and the avatar-frame tiers (frames.js).
//
//   node --test lib/levels.test.mjs
//
// Both modules are pure math over frozen constants, and both feed numbers straight
// into the UI without anything downstream ever validating them: a level, an XP bar
// fill, a frame name on somebody's avatar. A curve that dips, a remainder that goes
// negative or a tier lookup that lands one row off would all render as a perfectly
// plausible screen — the only visible symptom is that a user's level moved for no
// reason, or their frame downgraded overnight. These tests are the alarm.
//
// No fixture and no snapshot here on purpose: the properties below (monotonicity,
// remainder bounds, boundary round-trips) must hold for EVERY point on the curve, so
// they are asserted by walking the whole range rather than sampling a frozen output.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    LEVEL_COUNT,
    LEVEL_THRESHOLDS,
    MAX_XP,
    XP_REWARDS,
    levelForXp,
    totalXpForLevel
} from "./levels.js";
import {
    FRAME_TIERS,
    FRAME_TIER_COUNT,
    FRAME_TIER_SIZE,
    frameForLevel,
    nextFrameForLevel
} from "./frames.js";

// ------------------------------------------------------------------ the curve

test("the curve has one threshold per level, all the way to 500", () => {
    assert.equal(LEVEL_COUNT, 500);
    assert.equal(LEVEL_THRESHOLDS.length, LEVEL_COUNT);
});

// levelCost() raises (level - 1) to a fractional power over a range derived from
// LEVEL_COUNT. A sign slip or an off-by-one in that arithmetic yields NaN or Infinity
// for part of the range, and NaN silently makes every comparison in levelForXp false
// — the user lands on level 1 with a full bar.
test("every threshold on the curve is a finite whole number", () => {
    LEVEL_THRESHOLDS.forEach((threshold, index) => {
        assert.ok(Number.isFinite(threshold), `level ${index + 1} threshold is not finite: ${threshold}`);
        assert.ok(Number.isInteger(threshold), `level ${index + 1} threshold is fractional: ${threshold}`);
    });
});

test("level 1 begins at zero XP", () => {
    assert.equal(LEVEL_THRESHOLDS[0], 0);
    const info = levelForXp(0);
    assert.equal(info.level, 1);
    assert.equal(info.xpIntoLevel, 0);
    assert.equal(info.progress, 0);
});

// Equal thresholds would make a level cost nothing and hand out two levels for one
// XP point; a decreasing one would make more XP mean a lower level.
test("thresholds rise strictly, so no two levels share an entry price", () => {
    for (let index = 1; index < LEVEL_COUNT; index += 1) {
        assert.ok(
            LEVEL_THRESHOLDS[index] > LEVEL_THRESHOLDS[index - 1],
            `level ${index + 1} does not cost more than level ${index}`
        );
    }
});

// The whole design of the curve: cheap early, grindy near 500. If a level ever costs
// less than the one below it the climb briefly gets easier and the pacing breaks.
test("each level costs at least as much as the level before it", () => {
    for (let index = 2; index < LEVEL_COUNT; index += 1) {
        const cost = LEVEL_THRESHOLDS[index] - LEVEL_THRESHOLDS[index - 1];
        const previousCost = LEVEL_THRESHOLDS[index - 1] - LEVEL_THRESHOLDS[index - 2];
        assert.ok(cost >= previousCost, `level ${index + 1} costs ${cost}, cheaper than level ${index} at ${previousCost}`);
    }
});

// The classic failure mode of a threshold table scanned with >= : the exact boundary
// resolves to the level below, so a user who just earned level 42 is shown level 41
// with a completely full bar until their next rep.
test("the exact boundary XP of a level resolves to that level, not the one below", () => {
    for (let level = 1; level <= LEVEL_COUNT; level += 1) {
        assert.equal(levelForXp(totalXpForLevel(level)).level, level, `boundary of level ${level} misresolved`);
    }
});

test("one XP short of a boundary is still the previous level", () => {
    for (let level = 2; level <= LEVEL_COUNT; level += 1) {
        const oneShort = totalXpForLevel(level) - 1;
        assert.equal(levelForXp(oneShort).level, level - 1, `${oneShort} XP should still be level ${level - 1}`);
    }
});

// Earning XP must never demote anyone. Walking the full range in small steps catches
// a curve that dips anywhere, not just at the sampled boundaries.
test("a level never goes down as XP goes up", () => {
    let previous = 0;
    for (let xp = 0; xp <= MAX_XP + 5000; xp += 97) {
        const level = levelForXp(xp).level;
        assert.ok(level >= previous, `XP ${xp} dropped from level ${previous} to ${level}`);
        previous = level;
    }
});

// XP only ever accrues — there is no path that subtracts it — so every reward has to
// be a positive number. A zero or negative reward would make an extra workout, record
// or idea leave a user's level flat or lower it.
test("every XP reward is a positive finite amount", () => {
    Object.entries(XP_REWARDS).forEach(([key, value]) => {
        assert.ok(Number.isFinite(value), `${key} is not a finite reward: ${value}`);
        assert.ok(value > 0, `${key} rewards ${value}, which cannot raise a level`);
    });
});

// The XP bar renders xpIntoLevel / xpForLevel. A negative remainder draws a bar
// pointing backwards; a remainder equal to the span draws a full bar on a level the
// user has not finished.
test("the XP earned into a level stays within [0, span)", () => {
    for (let xp = 0; xp < MAX_XP; xp += 89) {
        const info = levelForXp(xp);
        assert.ok(info.xpIntoLevel >= 0, `XP ${xp} gave a negative remainder ${info.xpIntoLevel}`);
        assert.ok(info.xpIntoLevel < info.xpForLevel, `XP ${xp} filled its level (${info.xpIntoLevel}/${info.xpForLevel}) without levelling up`);
        assert.equal(info.currentThreshold + info.xpIntoLevel, xp);
    }
});

// "Ще N XP до наступного рівня" — N must never read 0 while the user is mid-level.
test("the XP left to the next level counts down to the boundary and never hits zero early", () => {
    for (let xp = 0; xp < MAX_XP; xp += 89) {
        const info = levelForXp(xp);
        assert.equal(info.xpToNext, info.nextThreshold - xp);
        assert.ok(info.xpToNext > 0, `XP ${xp} reports nothing left to earn on level ${info.level}`);
        assert.ok(info.xpToNext <= info.xpForLevel, `XP ${xp} needs more than a full level (${info.xpToNext}/${info.xpForLevel})`);
    }
});

test("progress below the top level is a fraction in [0, 1)", () => {
    for (let xp = 0; xp < MAX_XP; xp += 89) {
        const { progress } = levelForXp(xp);
        assert.ok(Number.isFinite(progress), `XP ${xp} gave a non-finite progress ${progress}`);
        assert.ok(progress >= 0 && progress < 1, `XP ${xp} gave progress ${progress}`);
    }
});

// Level 500 has no next threshold, so the span is 0 — every ratio here is a division
// by zero waiting to render "NaN%" on the proudest screen in the app.
test("the top level is terminal instead of dividing by zero", () => {
    const info = levelForXp(MAX_XP);
    assert.equal(info.level, LEVEL_COUNT);
    assert.equal(info.isMax, true);
    assert.equal(info.xpToNext, 0);
    assert.equal(info.progress, 1);
    assert.equal(info.nextThreshold, info.currentThreshold);
});

test("XP earned past the top level stays on level 500 with a full bar", () => {
    const info = levelForXp(MAX_XP + 250000);
    assert.equal(info.level, LEVEL_COUNT);
    assert.equal(info.isMax, true);
    assert.equal(info.progress, 1);
    assert.equal(info.xpToNext, 0);
});

// XP arrives from the server's scoring block for peers, and that block can be missing
// or partial (windowed payload). Anything unusable must read as a fresh level 1
// account rather than NaN.
test("missing or unusable XP totals read as a fresh level 1", () => {
    for (const bad of [undefined, null, NaN, "", "abc", -1, -50000]) {
        const info = levelForXp(bad);
        assert.equal(info.level, 1, `${String(bad)} did not resolve to level 1`);
        assert.equal(info.xp, 0, `${String(bad)} did not resolve to 0 XP`);
    }
});

test("fractional XP totals round to a level instead of falling off the curve", () => {
    assert.equal(levelForXp(39.4).level, 1);
    assert.equal(levelForXp(39.6).level, 2, "39.6 rounds to the 40 XP boundary of level 2");
});

test("levels outside 1..500 clamp to the ends of the curve", () => {
    assert.equal(totalXpForLevel(1), 0);
    assert.equal(totalXpForLevel(0), 0);
    assert.equal(totalXpForLevel(-7), 0);
    assert.equal(totalXpForLevel(LEVEL_COUNT), MAX_XP);
    assert.equal(totalXpForLevel(LEVEL_COUNT + 1), MAX_XP);
});

// ------------------------------------------------------------------ the frames

test("there are 25 frame tiers, one every 20 levels", () => {
    assert.equal(FRAME_TIER_COUNT, 25);
    assert.equal(FRAME_TIER_SIZE, 20);
    assert.equal(FRAME_TIER_COUNT * FRAME_TIER_SIZE, LEVEL_COUNT);
});

// Two tiers unlocking on the same level would make one of them unreachable — the
// gallery would show a frame nobody can ever earn.
test("every tier unlocks at its own level", () => {
    const unlocks = FRAME_TIERS.map((tier) => tier.unlockLevel);
    assert.equal(new Set(unlocks).size, FRAME_TIER_COUNT);
});

test("tier unlock levels ascend and stay inside the 500-level range", () => {
    assert.equal(FRAME_TIERS[0].unlockLevel, 1);
    FRAME_TIERS.forEach((tier, index) => {
        assert.equal(tier.index, index, "tier index must match its position for the gallery's rank labels");
        if (index > 0) {
            assert.ok(tier.unlockLevel > FRAME_TIERS[index - 1].unlockLevel, `tier ${index + 1} unlocks before the one below it`);
        }
        assert.ok(tier.unlockLevel <= LEVEL_COUNT, `tier ${index + 1} unlocks at level ${tier.unlockLevel}, beyond the curve`);
    });
});

test("level 1 wears the base tier", () => {
    const tier = frameForLevel(1);
    assert.equal(tier.index, 0);
    assert.equal(tier.name, "Залізо");
});

// The resolver is what actually decides which ring is drawn. An off-by-one here means
// a user who just unlocked a tier keeps the old frame, or wears the next one early.
test("the resolver picks the highest tier the level has earned", () => {
    FRAME_TIERS.forEach((tier) => {
        assert.equal(frameForLevel(tier.unlockLevel), tier, `level ${tier.unlockLevel} should unlock ${tier.name}`);
        const lastLevelOfTier = tier.unlockLevel + FRAME_TIER_SIZE - 1;
        if (lastLevelOfTier <= LEVEL_COUNT) {
            assert.equal(frameForLevel(lastLevelOfTier), tier, `level ${lastLevelOfTier} should still be ${tier.name}`);
        }
        if (tier.index > 0) {
            assert.equal(frameForLevel(tier.unlockLevel - 1), FRAME_TIERS[tier.index - 1], `level ${tier.unlockLevel - 1} unlocked ${tier.name} too early`);
        }
    });
});

test("a level past the last tier keeps the final frame", () => {
    const apex = FRAME_TIERS[FRAME_TIER_COUNT - 1];
    assert.equal(apex.name, "Апекс");
    assert.equal(frameForLevel(LEVEL_COUNT), apex);
    assert.equal(frameForLevel(LEVEL_COUNT + 1), apex);
    assert.equal(frameForLevel(10000), apex);
});

// Levels are never below 1 in practice, but the frame is drawn on every avatar in the
// app including peers, and an out-of-range index would return undefined and take the
// whole render down on `tier.name`.
test("levels below 1 fall back to the base tier rather than off the array", () => {
    assert.equal(frameForLevel(0), FRAME_TIERS[0]);
    assert.equal(frameForLevel(-40), FRAME_TIERS[0]);
});

test("the next tier is the one directly above, and null once the last is reached", () => {
    assert.equal(nextFrameForLevel(1), FRAME_TIERS[1]);
    assert.equal(nextFrameForLevel(1).unlockLevel, 21);
    assert.equal(nextFrameForLevel(FRAME_TIERS[FRAME_TIER_COUNT - 1].unlockLevel), null);
    assert.equal(nextFrameForLevel(LEVEL_COUNT), null);
});

test("every tier before the last advertises a reachable next tier", () => {
    FRAME_TIERS.slice(0, -1).forEach((tier) => {
        const next = nextFrameForLevel(tier.unlockLevel);
        assert.equal(next.index, tier.index + 1);
        assert.ok(next.unlockLevel > tier.unlockLevel);
    });
});

test("every tier has a distinct non-empty name and a gradient to paint", () => {
    const names = FRAME_TIERS.map((tier) => tier.name);
    assert.equal(new Set(names).size, FRAME_TIER_COUNT);
    FRAME_TIERS.forEach((tier) => {
        assert.ok(tier.name.length > 0, `tier ${tier.index + 1} has no name`);
        assert.ok(tier.colors.length > 0, `${tier.name} has no colours`);
        assert.ok(tier.gradient.includes("gradient("), `${tier.name} has no usable gradient: ${tier.gradient}`);
        assert.ok(tier.glow >= 0 && tier.glow <= 1, `${tier.name} has an out-of-range glow ${tier.glow}`);
    });
});

// A higher tier must never look cheaper than a lower one: the ring can only get
// thicker and effects can only switch on. (Glow is deliberately excluded — it dips at
// Плазма, where the animated conic ring takes over as the escalation.)
test("ring width and effect flags only ever escalate with the tier", () => {
    const flags = ["sheen", "ornament", "aura", "spark", "orbit", "orbit2", "plate", "anim", "conic"];
    FRAME_TIERS.slice(1).forEach((tier) => {
        const below = FRAME_TIERS[tier.index - 1];
        assert.ok(tier.width >= below.width, `${tier.name} has a thinner ring than ${below.name}`);
        flags.forEach((flag) => {
            assert.ok(!(below[flag] && !tier[flag]), `${tier.name} switched ${flag} back off after ${below.name}`);
        });
    });
});
