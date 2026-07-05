// Achievements are COMPUTED from existing data (like XP/levels) — each check derives
// the unlock DATE from the user's history, so unlocks are deterministic, retroactive
// and identical on every device with no backend writes. Each unlocked achievement
// also feeds the XP ledger (see xpEvents in app.js) with its own reward.
//
// A check receives { workouts, records, ideas, customExercises } — all pre-filtered
// to the user and sorted (workouts by date asc, records as recordsFor returns them) —
// and returns the unlock date string ("YYYY-MM-DD" / ISO) or null while locked.

function nthDate(items, n, pick) {
    return items.length >= n ? pick(items[n - 1]) : null;
}

function volumeUnlockDate(workouts, targetKg) {
    let accumulated = 0;
    for (const workoutItem of workouts) {
        for (const workoutExercise of workoutItem.exercises || []) {
            for (const set of workoutExercise.sets || []) {
                if (set.isCompleted) {
                    accumulated += (Number(set.weight) || 0) * (Number(set.repetitions) || 0);
                }
            }
        }
        if (accumulated >= targetKg) {
            return workoutItem.date;
        }
    }
    return null;
}

function weekCountUnlockDate(workouts, perWeek) {
    const byWeek = new Map();
    for (const workoutItem of workouts) {
        const date = new Date(`${String(workoutItem.date).slice(0, 10)}T00:00:00`);
        const day = date.getDay() || 7;
        date.setDate(date.getDate() - day + 1);
        const key = date.toISOString().slice(0, 10);
        const count = (byWeek.get(key) || 0) + 1;
        byWeek.set(key, count);
        if (count >= perWeek) {
            return workoutItem.date;
        }
    }
    return null;
}

function monthRecordsUnlockDate(records, perMonth) {
    const byMonth = new Map();
    const sorted = [...records].sort((left, right) => new Date(left.date) - new Date(right.date));
    for (const record of sorted) {
        const key = String(record.date).slice(0, 7);
        const count = (byMonth.get(key) || 0) + 1;
        byMonth.set(key, count);
        if (count >= perMonth) {
            return record.date;
        }
    }
    return null;
}

export const ACHIEVEMENTS = [
    {
        id: "first-workout",
        title: "Перший крок",
        caption: "Заверши перше тренування",
        icon: "footprints",
        xp: 50,
        check: ({ workouts }) => nthDate(workouts, 1, (item) => item.date)
    },
    {
        id: "workouts-10",
        title: "Десятка",
        caption: "Заверши 10 тренувань",
        icon: "medal",
        xp: 150,
        check: ({ workouts }) => nthDate(workouts, 10, (item) => item.date)
    },
    {
        id: "workouts-50",
        title: "Півсотні",
        caption: "Заверши 50 тренувань",
        icon: "shield-check",
        xp: 400,
        check: ({ workouts }) => nthDate(workouts, 50, (item) => item.date)
    },
    {
        id: "volume-100k",
        title: "100 тонн",
        caption: "Підійми сумарно 100 000 кг",
        icon: "anchor",
        xp: 300,
        check: ({ workouts }) => volumeUnlockDate(workouts, 100000)
    },
    {
        id: "week-3",
        title: "Тижневий ритм",
        caption: "3 тренування за один тиждень",
        icon: "calendar-check",
        xp: 100,
        check: ({ workouts }) => weekCountUnlockDate(workouts, 3)
    },
    {
        id: "first-pr",
        title: "Новий рекорд",
        caption: "Постав перший особистий рекорд",
        icon: "trophy",
        xp: 50,
        check: ({ records }) => records.length ? [...records].sort((left, right) => new Date(left.date) - new Date(right.date))[0].date : null
    },
    {
        id: "pr-5-month",
        title: "Місяць рекордів",
        caption: "5 рекордів за один місяць",
        icon: "flame",
        xp: 200,
        check: ({ records }) => monthRecordsUnlockDate(records, 5)
    },
    {
        id: "exercises-3",
        title: "Автор каталогу",
        caption: "Додай 3 власні вправи",
        icon: "library",
        xp: 150,
        check: ({ customExercises }) => nthDate(customExercises, 3, (item) => item.createdAt)
    },
    {
        id: "idea-done",
        title: "Ідея втілена",
        caption: "Твоя ідея отримала статус «Готово»",
        icon: "lightbulb",
        xp: 250,
        check: ({ ideas }) => {
            const done = ideas.filter((item) => item.status === "done").sort((left, right) => new Date(left.updatedAt || left.createdAt) - new Date(right.updatedAt || right.createdAt));
            return done.length ? (done[0].updatedAt || done[0].createdAt) : null;
        }
    }
];

// Returns [{ ...achievement, unlockedAt }] for every achievement, unlockedAt = null while locked.
export function evaluateAchievements(data) {
    return ACHIEVEMENTS.map((achievement) => ({ ...achievement, unlockedAt: achievement.check(data) }));
}
