/**
 * Who still needs to introduce themselves, and in what order we ask.
 *
 * Kept out of app.js and free of DOM so the rule — "which of these does this account
 * still not know about you" — can be tested directly. The one thing it must never do is
 * decide someone is incomplete because a field they filled in reads as falsy: a height
 * of 0 is missing, but a favourite muscle group of «Прес» and a bodyweight of 0.0 are
 * different kinds of empty and only one of them is a real answer.
 */

/** Every question onboarding asks, in the order it asks them. */
export const ONBOARDING_STEPS = ["intro", "identity", "birth", "body", "focus", "privacy", "done"];

/** The steps that collect something — intro and done are not answers. */
export const ONBOARDING_QUESTIONS = ["identity", "birth", "body", "focus", "privacy"];

function filled(value) {
    return value !== null && value !== undefined && String(value).trim() !== "";
}

function positive(value) {
    return Number(value) > 0;
}

/**
 * What this profile is still missing, as step names.
 *
 * `privacyChosen` is passed separately because it does not live on the profile — it is
 * an account-level decision, and the point of folding it in here is that it stops being
 * a second modal that ambushes people after they have already answered five questions.
 */
export function missingOnboarding(user, privacyChosen) {
    const missing = [];
    if (!filled(user?.displayName)) {
        missing.push("identity");
    }
    if (!filled(user?.birthDate) && !positive(user?.birthYear)) {
        missing.push("birth");
    }
    if (!positive(user?.height) || !positive(user?.bodyweight)) {
        missing.push("body");
    }
    if (!filled(user?.favoriteMuscleGroup)) {
        missing.push("focus");
    }
    if (!privacyChosen) {
        missing.push("privacy");
    }
    return missing;
}

export function needsOnboarding(user, privacyChosen) {
    return missingOnboarding(user, privacyChosen).length > 0;
}

/**
 * Is this a plausible date of birth?
 *
 * Bounded on both ends rather than only in the past: a typo of 2026 for 1926 is far
 * likelier than a newborn signing up, and either extreme makes every age-derived number
 * downstream nonsense.
 */
export function validBirthDate(value, today = new Date()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
        return false;
    }
    const [year, month, day] = value.split("-").map(Number);
    // Built and compared in UTC on purpose. Parsing "1998-04-17T00:00:00" is LOCAL, and
    // toISOString then shifts it back across midnight in any timezone east of Greenwich —
    // so every date in Kyiv failed a round-trip that was meant to catch 2001-02-30.
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) {
        return false;
    }
    const age = ageFromBirthDate(value, today);
    return age !== null && age >= 10 && age <= 100;
}

/** Whole years, counting the birthday that has not happened yet as not counted. */
export function ageFromBirthDate(value, today = new Date()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
        return null;
    }
    const [year, month, day] = value.split("-").map(Number);
    let age = today.getFullYear() - year;
    const monthNow = today.getMonth() + 1;
    const dayNow = today.getDate();
    if (monthNow < month || (monthNow === month && dayNow < day)) {
        age -= 1;
    }
    return age;
}

/** Sensible bounds, so a slipped digit cannot become a 1 800 cm lifter. */
export function validHeight(value) {
    const height = Number(value);
    return Number.isFinite(height) && height >= 100 && height <= 250;
}

export function validBodyweight(value) {
    const weight = Number(value);
    return Number.isFinite(weight) && weight >= 30 && weight <= 300;
}

function pluralYears(count) {
    const abs = Math.abs(Math.round(count));
    if (abs % 10 === 1 && abs % 100 !== 11) {
        return "рік";
    }
    if (abs % 10 >= 2 && abs % 10 <= 4 && (abs % 100 < 12 || abs % 100 > 14)) {
        return "роки";
    }
    return "років";
}

/** The oldest and youngest dates the birthday field will accept, as YYYY-MM-DD. */
export function birthDateBounds(today = new Date()) {
    const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const min = new Date(today.getFullYear() - 100, today.getMonth(), today.getDate());
    const max = new Date(today.getFullYear() - 10, today.getMonth(), today.getDate());
    return { min: iso(min), max: iso(max) };
}

/** Which questions a given step still blocks on, so «Далі» can say why it is disabled. */
export function stepBlocker(step, draft) {
    if (step === "identity") {
        return filled(draft.displayName) ? null : "Додай імʼя, яке бачитимуть інші";
    }
    if (step === "birth") {
        if (validBirthDate(draft.birthDate)) {
            return null;
        }
        // Two different failures, and telling them apart matters: "pick a date" next to a
        // date that is visibly picked reads as the app being broken. It is what happened —
        // somebody chose 2025 because the calendar could not reach a real birth year, and
        // then got told to choose a date.
        const age = ageFromBirthDate(draft.birthDate);
        if (age !== null) {
            return age < 10 ? `Це ${age} ${pluralYears(age)} — вкажи свій рік народження` : "Перевір рік народження";
        }
        return "Обери дату народження";
    }
    if (step === "body") {
        if (!validHeight(draft.height)) {
            return "Зріст у сантиметрах, від 100 до 250";
        }
        return validBodyweight(draft.bodyweight) ? null : "Вага в кілограмах, від 30 до 300";
    }
    if (step === "focus") {
        return filled(draft.favoriteMuscleGroup) ? null : "Обери групу, яку любиш найбільше";
    }
    if (step === "privacy") {
        return draft.hideWorkoutDetails === null || draft.hideWorkoutDetails === undefined
            ? "Обери, хто бачить деталі"
            : null;
    }
    return null;
}
