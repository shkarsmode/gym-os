import test from "node:test";
import assert from "node:assert/strict";
import { muscles, patterns, equipment, statusLabels, setTypeLabels } from "./constants.js";

/**
 * These lists are what the exercise editor offers. Two entries meaning the same thing
 * split the catalogue between them and make the filter look broken — «Вага тіла» and
 * «Власна вага» sat next to each other in the equipment dropdown for exactly that
 * reason. And a value the catalogue holds but the list omits is worse than cosmetic:
 * the select falls back to its first option, so saving an unrelated edit rewrites it.
 */
const normalise = (value) => value.toLowerCase().replace(/[\s'’ʼ`-]/g, "");

for (const [label, list] of [["muscles", muscles()], ["patterns", patterns()], ["equipment", equipment()]]) {
    test(`${label}() has no duplicate or near-duplicate entries`, () => {
        const seen = new Map();
        for (const value of list) {
            const key = normalise(value);
            assert.equal(seen.has(key), false, `«${value}» duplicates «${seen.get(key)}» in ${label}()`);
            seen.set(key, value);
        }
    });

    test(`${label}() entries are non-empty and untrimmed of nothing`, () => {
        for (const value of list) {
            assert.equal(typeof value, "string");
            assert.equal(value, value.trim());
            assert.notEqual(value.length, 0);
        }
    });
}

test("equipment() speaks one language for the Smith machine", () => {
    // The catalogue stores «Тренажер Сміта»; offering "Smith Machine" alongside it is
    // how a second value for the same equipment gets created.
    assert.equal(equipment().includes("Тренажер Сміта"), true);
    assert.equal(equipment().includes("Smith Machine"), false);
});

test("equipment() has a single bodyweight entry", () => {
    assert.deepEqual(equipment().filter((value) => /вага/i.test(value)), ["Вага тіла"]);
});

test("patterns() covers every value the catalogue actually uses", () => {
    // Observed in production. A missing one is silently rewritten on the next save.
    for (const value of ["Розведення", "Зведення", "Похилий жим", "Підйом на носки", "Кор", "Hinge"]) {
        assert.equal(patterns().includes(value), true, `patterns() is missing «${value}»`);
    }
});

test("every stored workout status has a label, including the derived one", () => {
    for (const status of ["planned", "active", "completed", "missed"]) {
        assert.equal(typeof statusLabels[status], "string");
        assert.notEqual(statusLabels[status].length, 0);
    }
});

test("every set type the editor offers has a label", () => {
    for (const type of ["warmup", "working", "drop", "failure", "backoff"]) {
        assert.equal(typeof setTypeLabels[type], "string");
    }
});
