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

function forEachCompletedSet(workouts, visit) {
    for (const workoutItem of workouts) {
        for (const workoutExercise of workoutItem.exercises || []) {
            for (const set of workoutExercise.sets || []) {
                if (set.isCompleted) {
                    const stop = visit(workoutItem, workoutExercise, set);
                    if (stop) {
                        return stop;
                    }
                }
            }
        }
    }
    return null;
}

function liftUnlockDate(workouts, exerciseInfo, namePattern, weightKg) {
    return forEachCompletedSet(workouts, (workoutItem, workoutExercise, set) => {
        const info = exerciseInfo(workoutExercise.exerciseId);
        return (Number(set.weight) >= weightKg && namePattern.test(info.name)) ? workoutItem.date : null;
    });
}

function muscleVolumeUnlockDate(workouts, exerciseInfo, muscle, targetKg) {
    let accumulated = 0;
    return forEachCompletedSet(workouts, (workoutItem, workoutExercise, set) => {
        if (exerciseInfo(workoutExercise.exerciseId).primaryMuscleGroup === muscle) {
            accumulated += (Number(set.weight) || 0) * (Number(set.repetitions) || 0);
        }
        return accumulated >= targetKg ? workoutItem.date : null;
    });
}

function countUnlockDate(workouts, target, measure) {
    let accumulated = 0;
    for (const workoutItem of workouts) {
        accumulated += measure(workoutItem);
        if (accumulated >= target) {
            return workoutItem.date;
        }
    }
    return null;
}

function workoutSets(workoutItem) {
    return (workoutItem.exercises || []).flatMap((item) => item.sets || []).filter((set) => set.isCompleted);
}

function cardioMinutes(workoutItem) {
    return (workoutItem.cardioSessions || []).reduce((sum, session) => sum + (Number(session.durationMinutes) || 0), 0);
}

function singleWorkoutUnlockDate(workouts, predicate) {
    for (const workoutItem of workouts) {
        if (predicate(workoutItem)) {
            return workoutItem.date;
        }
    }
    return null;
}

function consecutiveDaysUnlockDate(workouts, days) {
    const dates = [...new Set(workouts.map((item) => String(item.date).slice(0, 10)))].sort();
    let run = 1;
    for (let index = 1; index < dates.length; index += 1) {
        const gap = (new Date(`${dates[index]}T00:00:00`) - new Date(`${dates[index - 1]}T00:00:00`)) / 86400000;
        run = gap === 1 ? run + 1 : 1;
        if (run >= days) {
            return dates[index];
        }
    }
    return days <= 1 && dates.length ? dates[0] : null;
}

function startHourUnlockDate(workouts, matches) {
    for (const workoutItem of workouts) {
        if (workoutItem.startedAt && matches(new Date(workoutItem.startedAt).getHours())) {
            return workoutItem.date;
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
    },
    {
        id: "workouts-100",
        title: "Сотня",
        caption: "Заверши 100 тренувань",
        icon: "crown",
        xp: 800,
        check: ({ workouts }) => nthDate(workouts, 100, (item) => item.date)
    },
    {
        id: "workouts-250",
        title: "Ветеран залу",
        caption: "Заверши 250 тренувань",
        icon: "gem",
        xp: 1500,
        check: ({ workouts }) => nthDate(workouts, 250, (item) => item.date)
    },
    {
        id: "volume-500k",
        title: "Пів мільйона",
        caption: "Підійми сумарно 500 000 кг",
        icon: "container",
        xp: 700,
        check: ({ workouts }) => volumeUnlockDate(workouts, 500000)
    },
    {
        id: "volume-1m",
        title: "Мільйонер",
        caption: "Підійми сумарно 1 000 000 кг",
        icon: "mountain",
        xp: 1200,
        check: ({ workouts }) => volumeUnlockDate(workouts, 1000000)
    },
    {
        id: "bench-100",
        title: "Жим сотки",
        caption: "Жим лежачи зі 100 кг",
        icon: "zap",
        xp: 500,
        check: ({ workouts, exerciseInfo }) => liftUnlockDate(workouts, exerciseInfo, /жим лежачи|bench press/i, 100)
    },
    {
        id: "bench-140",
        title: "Жим 140",
        caption: "Жим лежачи зі 140 кг",
        icon: "flame-kindling",
        xp: 1000,
        check: ({ workouts, exerciseInfo }) => liftUnlockDate(workouts, exerciseInfo, /жим лежачи|bench press/i, 140)
    },
    {
        id: "squat-140",
        title: "Присід 140",
        caption: "Присідання зі 140 кг",
        icon: "arrow-down-up",
        xp: 800,
        check: ({ workouts, exerciseInfo }) => liftUnlockDate(workouts, exerciseInfo, /присід|squat/i, 140)
    },
    {
        id: "deadlift-180",
        title: "Тяга 180",
        caption: "Станова тяга зі 180 кг",
        icon: "tractor",
        xp: 1000,
        check: ({ workouts, exerciseInfo }) => liftUnlockDate(workouts, exerciseInfo, /станова|deadlift/i, 180)
    },
    {
        id: "cardio-60",
        title: "Година кардіо",
        caption: "60 хвилин кардіо за одне тренування",
        icon: "heart-pulse",
        xp: 300,
        check: ({ workouts }) => singleWorkoutUnlockDate(workouts, (item) => cardioMinutes(item) >= 60)
    },
    {
        id: "cardio-500",
        title: "Кардіомарафон",
        caption: "500 хвилин кардіо сумарно",
        icon: "route",
        xp: 400,
        check: ({ workouts }) => countUnlockDate(workouts, 500, cardioMinutes)
    },
    {
        id: "shoulders-50k",
        title: "Дельти зі сталі",
        caption: "50 000 кг у вправах на плечі",
        icon: "triangle",
        xp: 350,
        check: ({ workouts, exerciseInfo }) => muscleVolumeUnlockDate(workouts, exerciseInfo, "Плечі", 50000)
    },
    {
        id: "chest-100k",
        title: "Груди-броня",
        caption: "100 000 кг у вправах на груди",
        icon: "shield",
        xp: 400,
        check: ({ workouts, exerciseInfo }) => muscleVolumeUnlockDate(workouts, exerciseInfo, "Груди", 100000)
    },
    {
        id: "streak-7",
        title: "Сім поспіль",
        caption: "Тренування 7 днів підряд",
        icon: "calendar-heart",
        xp: 300,
        check: ({ workouts }) => consecutiveDaysUnlockDate(workouts, 7)
    },
    {
        id: "early-bird",
        title: "Рання пташка",
        caption: "Почни тренування до 7 ранку",
        icon: "sunrise",
        xp: 150,
        check: ({ workouts }) => startHourUnlockDate(workouts, (hour) => hour < 7)
    },
    {
        id: "night-owl",
        title: "Нічна зміна",
        caption: "Почни тренування після 22:00",
        icon: "moon",
        xp: 150,
        check: ({ workouts }) => startHourUnlockDate(workouts, (hour) => hour >= 22)
    },
    {
        id: "sets-1000",
        title: "Тисяча підходів",
        caption: "Виконай 1000 підходів",
        icon: "list-checks",
        xp: 500,
        check: ({ workouts }) => countUnlockDate(workouts, 1000, (item) => workoutSets(item).length)
    },
    {
        id: "reps-10000",
        title: "10 000 повторень",
        caption: "Сумарно 10 000 повторень",
        icon: "repeat",
        xp: 600,
        check: ({ workouts }) => countUnlockDate(workouts, 10000, (item) => workoutSets(item).reduce((sum, set) => sum + (Number(set.repetitions) || 0), 0))
    },
    {
        id: "pr-25",
        title: "Колекціонер рекордів",
        caption: "Рекорди у 25 різних вправах",
        icon: "boxes",
        xp: 500,
        check: ({ records }) => {
            if (records.length < 25) {
                return null;
            }
            const sorted = [...records].sort((left, right) => new Date(left.date) - new Date(right.date));
            return sorted[24].date;
        }
    },
    {
        id: "volume-10k-day",
        title: "10 тонн за день",
        caption: "10 000 кг за одне тренування",
        icon: "truck",
        xp: 400,
        check: ({ workouts }) => singleWorkoutUnlockDate(workouts, (item) => workoutSets(item).reduce((sum, set) => sum + (Number(set.weight) || 0) * (Number(set.repetitions) || 0), 0) >= 10000)
    },
    {
        id: "exercises-10",
        title: "Куратор каталогу",
        caption: "Додай 10 власних вправ",
        icon: "library-big",
        xp: 400,
        check: ({ customExercises }) => nthDate(customExercises, 10, (item) => item.createdAt)
    }
];

// Returns [{ ...achievement, unlockedAt }] for every achievement, unlockedAt = null while locked.
export function evaluateAchievements(data) {
    return ACHIEVEMENTS.map((achievement) => ({ ...achievement, unlockedAt: achievement.check(data) }));
}
