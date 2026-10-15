// Shared app state: the in-memory `state` object and the workout-type templates.

export const templates = [
    ["push", "Push", "Базовий жим для грудей.", ["Жим лежачи"]],
    ["pull", "Pull", "Вертикальна тяга для спини.", ["Тяга верхнього блока"]],
    ["legs", "Legs", "Порожній шаблон для майбутніх вправ ніг.", []],
    ["upper", "Upper", "Компактна сесія верху з двох базових рухів.", ["Жим лежачи", "Тяга верхнього блока"]],
    ["lower", "Lower", "Порожній шаблон для власного плану.", []],
    ["full_body", "Full Body", "Мінімальна силова сесія з curated-каталогу.", ["Жим лежачи", "Тяга верхнього блока"]],
    ["cardio", "Cardio", "Кардіо можна вести окремим блоком у тренуванні.", []],
    ["custom", "Custom", "Порожній шаблон для власного плану.", []]
].map(([id, title, description, exerciseNames]) => ({ id, title, description, exerciseNames, type: id }));

export const state = {
    section: "dashboard",
    // Note fields the user has explicitly opened this session (they render collapsed
    // to a one-line button while empty).
    openNotes: new Set(),
    // Finished superset rounds the athlete reopened to correct a number, keyed
    // "groupId:roundIndex". Session-scoped: it is a viewing choice, not data.
    supersetOpenRounds: {},
    profileUserId: null,
    editingWorkoutId: null,
    // Cursor into the caller's own history under the windowed payload; null once
    // everything is loaded. loadingMoreWorkouts guards a double fetch from a fast
    // double-tap on "load more".
    workoutsCursor: null,
    loadingMoreWorkouts: false,
    viewUserId: null,
    frameOverride: null, // admin-only local frame preview; resets on reload
    authUser: null,
    database: null,
    charts: new Map(),
    calendar: null,
    filters: {
        exerciseSearch: "",
        activityScope: "mine",
        statsUserId: null, // null = current user; "all" = whole team; otherwise a user id
        // statsRange / statsMuscle / statsExerciseId / statsWorkoutType were removed:
        // they were initialised to "all" and never assigned anywhere, so the
        // filteredWorkouts() they drove was an identity function on every call.
        pickerMuscle: "all",
        pickerEquipment: "all",
        rankingsMuscle: "Груди", // default best-lift category in Рейтинги
        feedbackType: "feature"
    },
    timer: {
        id: null,
        duration: 90,
        remaining: 90, // goes negative in overtime (counting past zero)
        startedAt: 0,
        running: false,
        paused: false,
        overtime: false, // true once the countdown crossed zero (signal fired)
        collapsed: true // minimized to the side circle FAB (default in normal flow)
    },
    focus: null // { exerciseId, setId, view: "set" | "rest" } — focus-mode session
};
