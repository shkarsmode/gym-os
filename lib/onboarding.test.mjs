import test from "node:test";
import assert from "node:assert/strict";
import {
    ONBOARDING_STEPS, ONBOARDING_QUESTIONS,
    missingOnboarding, needsOnboarding, validBirthDate, ageFromBirthDate,
    validHeight, validBodyweight, stepBlocker
} from "./onboarding.js";

const TODAY = new Date("2026-08-21T12:00:00Z");
const complete = {
    displayName: "Даніл", birthDate: "1998-04-17", birthYear: 1998,
    height: 183, bodyweight: 82, favoriteMuscleGroup: "Спина"
};

test("a complete profile that has chosen privacy is asked nothing", () => {
    assert.deepEqual(missingOnboarding(complete, true), []);
    assert.equal(needsOnboarding(complete, true), false);
});

test("privacy alone is enough to bring onboarding back", () => {
    // It used to be its own modal, ambushing people after they had finished everything
    // else. Folding it in means it is one of the questions, not a sequel.
    assert.deepEqual(missingOnboarding(complete, false), ["privacy"]);
});

test("each missing field names its own step", () => {
    assert.deepEqual(missingOnboarding({ ...complete, displayName: "" }, true), ["identity"]);
    assert.deepEqual(missingOnboarding({ ...complete, height: 0 }, true), ["body"]);
    assert.deepEqual(missingOnboarding({ ...complete, bodyweight: null }, true), ["body"]);
    assert.deepEqual(missingOnboarding({ ...complete, favoriteMuscleGroup: "" }, true), ["focus"]);
});

test("an account filled in before birthDate existed is not dragged back for it", () => {
    // birthYear is what every older profile has, and it answers the same question.
    assert.deepEqual(missingOnboarding({ ...complete, birthDate: null }, true), []);
    assert.deepEqual(missingOnboarding({ ...complete, birthDate: null, birthYear: 0 }, true), ["birth"]);
});

test("a brand-new account is asked everything, in order", () => {
    assert.deepEqual(missingOnboarding({}, false), ["identity", "birth", "body", "focus", "privacy"]);
    assert.deepEqual(missingOnboarding(null, false), ["identity", "birth", "body", "focus", "privacy"]);
});

test("the step list starts and ends outside the questions", () => {
    assert.equal(ONBOARDING_STEPS[0], "intro");
    assert.equal(ONBOARDING_STEPS.at(-1), "done");
    for (const step of ONBOARDING_QUESTIONS) {
        assert.equal(ONBOARDING_STEPS.includes(step), true);
    }
    assert.equal(ONBOARDING_QUESTIONS.includes("intro"), false);
    assert.equal(ONBOARDING_QUESTIONS.includes("done"), false);
});

test("age counts a birthday that has not arrived as not counted", () => {
    assert.equal(ageFromBirthDate("1998-04-17", TODAY), 28);
    assert.equal(ageFromBirthDate("1998-08-21", TODAY), 28);   // today
    assert.equal(ageFromBirthDate("1998-08-22", TODAY), 27);   // tomorrow
    assert.equal(ageFromBirthDate("nope", TODAY), null);
});

test("birth dates are checked in UTC, so they survive being east of Greenwich", () => {
    // Parsing "1998-04-17T00:00:00" is LOCAL; toISOString then shifts it across midnight
    // in Kyiv, and a plain round-trip check rejected every valid date in the app's own
    // timezone. Pinned here because the failure only appears with TZ set.
    assert.equal(validBirthDate("1998-04-17", TODAY), true);
    assert.equal(validBirthDate("2000-01-01", TODAY), true);
});

test("birth dates are bounded on both ends", () => {
    assert.equal(validBirthDate("2020-01-01", TODAY), false);   // too young
    assert.equal(validBirthDate("1900-01-01", TODAY), false);   // too old
    assert.equal(validBirthDate("2030-01-01", TODAY), false);   // the future
});

test("a date that is not on the calendar is refused", () => {
    assert.equal(validBirthDate("2001-02-30", TODAY), false);
    assert.equal(validBirthDate("2001-13-01", TODAY), false);
    assert.equal(validBirthDate("17.04.1998", TODAY), false);
    assert.equal(validBirthDate("", TODAY), false);
    assert.equal(validBirthDate(null, TODAY), false);
});

test("height and weight are bounded so a slipped digit cannot get through", () => {
    assert.equal(validHeight(183), true);
    assert.equal(validHeight(1830), false);
    assert.equal(validHeight(0), false);
    assert.equal(validHeight("175"), true);
    assert.equal(validBodyweight(82.5), true);
    assert.equal(validBodyweight(820), false);
    assert.equal(validBodyweight(0), false);
});

test("each step explains what it is still waiting for", () => {
    assert.match(stepBlocker("identity", {}), /імʼя/);
    assert.match(stepBlocker("birth", {}), /дату/);
    assert.match(stepBlocker("body", { height: 183 }), /[Вв]ага/);
    assert.match(stepBlocker("body", {}), /[Зз]ріст/);
    assert.match(stepBlocker("focus", {}), /групу/);
    assert.match(stepBlocker("privacy", {}), /бачить/);
});

test("a satisfied step blocks on nothing", () => {
    assert.equal(stepBlocker("identity", { displayName: "Даніл" }), null);
    assert.equal(stepBlocker("birth", { birthDate: "1998-04-17" }), null);
    assert.equal(stepBlocker("body", { height: 183, bodyweight: 82 }), null);
    assert.equal(stepBlocker("focus", { favoriteMuscleGroup: "Спина" }), null);
    // false is a real answer here — "keep my workouts open" — not an unanswered question.
    assert.equal(stepBlocker("privacy", { hideWorkoutDetails: false }), null);
    assert.equal(stepBlocker("privacy", { hideWorkoutDetails: true }), null);
    assert.equal(stepBlocker("intro", {}), null);
    assert.equal(stepBlocker("done", {}), null);
});
