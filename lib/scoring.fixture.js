// Fixture for the scoring parity test.
//
// Every entry here exists because it is a case where the scoring rules can quietly
// produce a different answer than intended. A fixture of "three normal workouts" would
// pass while the interesting behaviour drifted underneath it.
//
// `NOW` is frozen. Five tenure achievements and the streak calculation read the clock,
// so without a fixed instant this fixture's expected output would change every day.

export const NOW = new Date("2026-07-21T12:00:00.000Z");

export const EXERCISES = [
    { id: "ex-bench", name: "Жим лежачи", primaryMuscleGroup: "Груди", isCustom: false },
    { id: "ex-squat", name: "Присідання зі штангою", primaryMuscleGroup: "Ноги", isCustom: false },
    { id: "ex-row", name: "Тяга верхнього блока", primaryMuscleGroup: "Спина", isCustom: false },
    // Contributed by u1 and liked — drives `exercises-3` / `exercises-10` counting and
    // the `exercise-liked` badge, whose unlock date is the exercise's creation date.
    { id: "ex-custom-1", name: "Власна вправа 1", primaryMuscleGroup: "Плечі", isCustom: true, createdByUserId: "u1", createdAt: "2026-01-05", likeCount: 3 },
    { id: "ex-custom-2", name: "Власна вправа 2", primaryMuscleGroup: "Плечі", isCustom: true, createdByUserId: "u1", createdAt: "2026-01-06", likeCount: 0 },
    { id: "ex-custom-3", name: "Власна вправа 3", primaryMuscleGroup: "Руки", isCustom: true, createdByUserId: "u1", createdAt: "2026-01-07", likeCount: 0 }
];

export const USERS = [
    // Order matters: teamStats.mostUsedExerciseId takes the first non-null in this
    // order, which is /export order (createdAt ASC).
    { id: "u1", displayName: "Перший", createdAt: "2023-02-15T00:00:00.000Z" },  // >3y tenure
    { id: "u2", displayName: "Другий", createdAt: "2026-06-25T00:00:00.000Z" },  // <1m tenure
    { id: "u3", displayName: "Третій", createdAt: "2026-01-20T00:00:00.000Z" }   // 6m boundary
];

export const FEATURE_REQUESTS = [
    { id: "fr-1", userId: "u1", status: "done", title: "Готова ідея", createdAt: "2026-03-01", updatedAt: "2026-03-10" },
    { id: "fr-2", userId: "u1", status: "new", title: "Ще не зроблено", createdAt: "2026-03-02", updatedAt: "2026-03-02" },
    // No date at all: the trailing filter in xpEvents must DROP this, so it awards no
    // XP. If the filter is ever removed this fixture's totals move.
    { id: "fr-3", userId: "u2", status: "done", title: "Без дати", createdAt: null, updatedAt: null }
];

function set(weight, repetitions, extra = {}) {
    return { type: "working", weight, repetitions, isCompleted: true, restSeconds: 90, notes: "", ...extra };
}

function workout(id, userId, date, exercises, extra = {}) {
    return {
        id, userId, date, status: "completed", title: "Тренування", workoutType: "custom",
        notes: "", startedAt: null, finishedAt: null, durationOverride: null,
        exercises, cardioSessions: [], ...extra
    };
}

// Newest-first, which is /export order and what recordsFor's tie-break depends on.
export const WORKOUTS = [
    // --- TIED 1RM ACROSS TWO DATES -------------------------------------------------
    // Identical weight x reps on two different days. recordsFor uses a strict `>`, so
    // whichever is visited FIRST wins. Fed newest-first, the record must carry
    // 2026-07-18, not 2026-07-11. This single assertion protects PR dates, and through
    // them first-pr / pr-25 unlock dates and the whole XP ledger.
    workout("w-tie-new", "u1", "2026-07-18", [
        { exerciseId: "ex-squat", notes: "", sets: [set(150, 3)] }
    ]),
    workout("w-tie-old", "u1", "2026-07-11", [
        { exerciseId: "ex-squat", notes: "", sets: [set(150, 3)] }
    ]),

    // --- TWO WORKOUTS ON THE SAME DATE ---------------------------------------------
    // The seq tie-break, and the streak date de-duplication.
    workout("w-same-b", "u1", "2026-07-10", [
        { exerciseId: "ex-bench", notes: "", sets: [set(100, 1)] }
    ]),
    workout("w-same-a", "u1", "2026-07-10", [
        { exerciseId: "ex-row", notes: "", sets: [set(70, 8)] }
    ]),

    // --- CARDIO-ONLY, NO EXERCISES -------------------------------------------------
    // A legitimately empty exercises array. Anything that assumes exercises.length > 0
    // breaks here, and the write-path guard must still accept it.
    workout("w-cardio", "u1", "2026-07-08", [], {
        cardioSessions: [{ type: "treadmill", durationMinutes: 45, distance: 7.5, calories: 400 }]
    }),

    // --- START-HOUR BADGES ---------------------------------------------------------
    // early-bird (<07:00) and night-owl (>=22:00). getHours() is LOCAL, so these two
    // assertions are exactly where a server running in a different zone diverges.
    workout("w-0430", "u1", "2026-07-06", [{ exerciseId: "ex-bench", notes: "", sets: [set(80, 5)] }],
        { startedAt: "2026-07-06T04:30:00", finishedAt: "2026-07-06T05:20:00" }),
    workout("w-0600", "u1", "2026-07-05", [{ exerciseId: "ex-bench", notes: "", sets: [set(80, 5)] }],
        { startedAt: "2026-07-05T06:00:00", finishedAt: "2026-07-05T07:05:00" }),
    workout("w-2230", "u1", "2026-07-04", [{ exerciseId: "ex-bench", notes: "", sets: [set(80, 5)] }],
        { startedAt: "2026-07-04T22:30:00", finishedAt: "2026-07-04T23:40:00" }),
    workout("w-0030", "u1", "2026-07-03", [{ exerciseId: "ex-bench", notes: "", sets: [set(80, 5)] }],
        { startedAt: "2026-07-03T00:30:00", finishedAt: "2026-07-03T01:15:00" }),

    // --- SEVEN CONSECUTIVE DAYS ACROSS A DST BOUNDARY ------------------------------
    // Seven genuinely consecutive days, 26 March to 1 April 2026.
    //
    // KNOWN BUG, DELIBERATELY FROZEN: streak-7 does NOT unlock for this run. Europe/Kyiv
    // springs forward on 2026-03-29, so that local day is 23 hours;
    // consecutiveDaysUnlockDate divides the millisecond difference by 86400000 and tests
    // `gap === 1`, which yields 0.9583 and resets the run. Anyone whose seven-day streak
    // crosses the last Sunday in March never earns this badge.
    //
    // The fixture asserts the CURRENT behaviour on purpose. The parity test exists to
    // prove the kernel extraction changed nothing; encoding the correct-but-different
    // answer here would make it fail for the right reason at the wrong time. Fixing the
    // DST arithmetic grants achievements to real users who do not have them today, which
    // is a deliberate product change and belongs in its own commit.
    //
    // Note also that in UTC the same gap is exactly 1. A backend running in UTC would
    // consider this unlocked while the browser in Kyiv does not — the concrete case that
    // makes pinning the server timezone mandatory rather than advisory.
    workout("w-dst-7", "u2", "2026-04-01", [{ exerciseId: "ex-bench", notes: "", sets: [set(60, 10)] }]),
    workout("w-dst-6", "u2", "2026-03-31", [{ exerciseId: "ex-bench", notes: "", sets: [set(60, 10)] }]),
    workout("w-dst-5", "u2", "2026-03-30", [{ exerciseId: "ex-bench", notes: "", sets: [set(60, 10)] }]),
    workout("w-dst-4", "u2", "2026-03-29", [{ exerciseId: "ex-bench", notes: "", sets: [set(60, 10)] }]),
    workout("w-dst-3", "u2", "2026-03-28", [{ exerciseId: "ex-bench", notes: "", sets: [set(60, 10)] }]),
    workout("w-dst-2", "u2", "2026-03-27", [{ exerciseId: "ex-bench", notes: "", sets: [set(60, 10)] }]),
    workout("w-dst-1", "u2", "2026-03-26", [{ exerciseId: "ex-bench", notes: "", sets: [set(60, 10)] }]),

    // --- EXERCISE MISSING FROM THE CATALOG -----------------------------------------
    // A workout referencing a deleted exercise must still score, resolving through the
    // `missing-` placeholder rather than throwing.
    workout("w-missing", "u3", "2026-06-20", [
        { exerciseId: "ex-deleted-forever", notes: "", sets: [set(50, 10)] }
    ]),

    // --- WARMUP SETS AND INCOMPLETE SETS -------------------------------------------
    // Warmups never count toward records; incomplete sets never count toward volume.
    workout("w-mixed", "u3", "2026-06-18", [
        {
            exerciseId: "ex-bench", notes: "", sets: [
                set(200, 1, { type: "warmup" }),           // huge, but warmup — no PR
                set(90, 5),                                 // counts
                set(300, 1, { isCompleted: false })         // huge, but incomplete
            ]
        }
    ]),

    // --- DURATION OVERRIDE VS CLOCK ------------------------------------------------
    workout("w-override", "u3", "2026-06-15", [{ exerciseId: "ex-bench", notes: "", sets: [set(85, 5)] }],
        { startedAt: "2026-06-15T10:00:00", finishedAt: "2026-06-15T12:00:00", durationOverride: 35 }),

    // --- NON-COMPLETED WORKOUTS ----------------------------------------------------
    // Must be excluded from every completed-only aggregate but counted in totalWorkouts.
    workout("w-planned", "u3", "2026-06-14", [{ exerciseId: "ex-bench", notes: "", sets: [set(999, 1)] }],
        { status: "planned" }),
    workout("w-active", "u3", "2026-06-13", [{ exerciseId: "ex-bench", notes: "", sets: [set(999, 1)] }],
        { status: "active" })
];

export const FIXTURE = {
    users: USERS,
    workouts: WORKOUTS,
    exercises: EXERCISES,
    featureRequests: FEATURE_REQUESTS,
    now: NOW
};
