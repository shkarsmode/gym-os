// Builders for the empty / demo database: users, exercises, workouts, sets, standards.
import { dateInput, splitCsv } from "../lib/format.js";
import { rankedExerciseNames, rankOrder } from "../lib/constants.js";
import {
    cleanList, cleanText, createSlug, normalizeDifficulty, normalizeEquipment, normalizeMovementPattern,
    normalizeMuscleGroup, seedWeight, stripSourcePrefix, templateById, uniqueStrings
} from "./model.js";
import { suggestedSets } from "./scoring-bridge.js";
import { addDays, addMinutes, createId, round, setClock } from "./util.js";

export function createEmptyDatabase() {
    return { version: 3, currentUserId: "", users: [], exercises: [], bodyweightEntries: [], workouts: [], strengthStandards: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

export function createSeedDatabase() {
    const now = new Date();
    const users = createUsers();
    const exercises = createExercises();
    return {
        version: 3,
        currentUserId: "user-daniil",
        users,
        exercises,
        bodyweightEntries: createBodyweights(users, now),
        workouts: createWorkouts(exercises, now),
        strengthStandards: createStandards(exercises),
        featureRequests: [],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
    };
}

function createUsers() {
    return [
        createUser("user-daniil", "Данило Шкарупа", "Dunskyi", "DS", "#8c6f3f", 185, 78, "male", "Суха сила і видимий прогрес", "4 роки", "Спина"),
        createUser("user-anastasia", "Анастасія Коваль", "Nastya", "AN", "#6e604a", 168, 56, "female", "Мобільність, тонус і регулярність", "2 роки", "Сідниці"),
        createUser("user-maxim", "Максим Левченко", "Max", "MX", "#465369", 181, 84, "male", "Powerbuilding", "5 років", "Груди")
    ];
}

function createUser(id, name, displayName, avatarInitials, avatarColor, height, bodyweight, gender, trainingGoal, trainingExperience, favoriteMuscleGroup) {
    return { id, name, displayName, avatarInitials, avatarColor, height, bodyweight, birthYear: 2002, gender, trainingGoal, trainingExperience, favoriteMuscleGroup, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

export function createExercises() {
    const rows = [
        ["bench-press", "Жим лежачи", "Bench Press,Barbell Bench,Flat Bench", "Груди", "Трицепс,Плечі", "Горизонтальний жим", "Штанга", "Сила", "Середній"],
        ["lat-pulldown", "Тяга верхнього блока", "Lat Pulldown,Pulldown", "Спина", "Біцепс", "Вертикальна тяга", "Блок", "Гіпертрофія", "Початковий"]
    ];

    return rows.map(([slug, name, aliases, primaryMuscleGroup, secondaryMuscles, movementPattern, equipment, category, difficulty]) => ({
        id: `exercise-${slug}`,
        name,
        aliases: splitCsv(aliases),
        primaryMuscleGroup,
        secondaryMuscleGroups: splitCsv(secondaryMuscles),
        movementPattern,
        equipment,
        category,
        difficulty,
        description: `${name} — вправа з патерном "${movementPattern}", основний фокус: ${primaryMuscleGroup.toLowerCase()}. Тримай сетап повторюваним і фіксуй чисту роботу.`,
        techniqueSteps: techniqueFor(movementPattern),
        commonMistakes: mistakesFor(movementPattern),
        safetyTips: safetyFor(movementPattern),
        mediaUrl: "",
        mediaType: "none",
        isCustom: false,
        createdByUserId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    }));
}

export function mergeImportedExerciseCatalog(baseExercises, payload) {
    const rows = Array.isArray(payload?.exercises) ? payload.exercises : Array.isArray(payload) ? payload : [];
    const existingKeys = new Set(baseExercises.flatMap(exerciseDuplicateKeys));
    const imported = [];
    let skipped = 0;

    rows.forEach((row) => {
        const exercise = normalizeImportedExercise(row);
        const keys = exerciseDuplicateKeys(exercise);
        if (keys.some((key) => existingKeys.has(key))) {
            skipped += 1;
            return;
        }
        keys.forEach((key) => existingKeys.add(key));
        imported.push(exercise);
    });

    return { exercises: [...baseExercises, ...imported], imported: imported.length, skipped };
}

function normalizeImportedExercise(row) {
    const originalName = cleanText(row.originalName || row.name || "Imported exercise");
    const sourceName = cleanText(row.sourceName || "ExRx.net");
    const name = stripSourcePrefix(cleanText(row.name || originalName));
    const category = cleanText(row.category || normalizeMuscleGroup(row.primaryMuscleGroup, row.category, originalName));
    const primaryMuscleGroup = normalizeMuscleGroup(row.primaryMuscleGroup, row.category, originalName);
    const movementPattern = normalizeMovementPattern(row.movementPattern, category, originalName);
    const equipment = normalizeEquipment(row.equipment, originalName);
    const now = new Date().toISOString();

    return {
        id: row.id || `exercise-${createSlug(`${sourceName}-${originalName}`)}`,
        name,
        aliases: uniqueStrings([...(Array.isArray(row.aliases) ? row.aliases : []), originalName]),
        primaryMuscleGroup,
        secondaryMuscleGroups: uniqueStrings((row.secondaryMuscleGroups || []).map((item) => normalizeMuscleGroup(item))),
        movementPattern,
        equipment,
        category,
        difficulty: normalizeDifficulty(row.difficulty),
        description: cleanText(row.description || `${name} — вправа з джерела ${sourceName}. Перевіряй техніку за оригінальним джерелом перед додаванням у тренування.`),
        techniqueSteps: cleanList(row.techniqueSteps),
        commonMistakes: cleanList(row.commonMistakes),
        safetyTips: cleanList(row.safetyTips),
        mediaUrl: "",
        mediaType: "none",
        sourceName,
        sourceUrl: cleanText(row.sourceUrl),
        originalName,
        licenseStatus: cleanText(row.licenseStatus || "permission_required"),
        mediaReferences: Array.isArray(row.mediaReferences) ? row.mediaReferences : [],
        isCustom: false,
        createdByUserId: null,
        createdAt: row.importedAt || now,
        updatedAt: row.updatedAt || now
    };
}

function exerciseDuplicateKeys(exercise) {
    return [
        exercise.originalName ? `original:${exercise.originalName.toLowerCase()}` : "",
        exercise.sourceUrl ? `source:${exercise.sourceUrl.toLowerCase()}` : "",
        exercise.id ? `id:${exercise.id}` : ""
    ].filter(Boolean);
}

export function techniqueFor(pattern) {
    const data = {
        "Горизонтальний жим": ["Зведи лопатки вниз і назад.", "Тримай кисті над ліктями.", "Опускай вагу контрольовано.", "Тисни без відбиву."],
        "Вертикальний жим": ["Зафіксуй ребра та корпус.", "Тисни по рівній вертикальній траєкторії.", "Не компенсуй надмірним прогином.", "Завершуй з контрольованою фіксацією."],
        "Горизонтальна тяга": ["Задай стабільний кут корпуса.", "Веди лікті назад.", "Зроби коротку паузу біля корпуса.", "Опускай вагу під контролем."],
        "Вертикальна тяга": ["Почни зі стабільних плечей.", "Тягни лікті вниз до ребер.", "Не розгойдуйся.", "Контролюй повну амплітуду."],
        "Присідання": ["Забрейсь перед спуском.", "Тримай рівномірний тиск стопи.", "Контролюй глибину.", "Підіймайся без завалу колін."],
        "Hinge": ["Відведи таз назад.", "Тримай вагу близько до тіла.", "Зберігай нейтральну спину.", "Вставай рівно без перерозгинання."],
        "Згинання": ["Зафіксуй плечі.", "Підіймай без розгону тазом.", "Коротко стисни м'яз.", "Опускай повільно."],
        "Розгинання": ["Тримай лікті стабільно.", "Рухайся через цільовий суглоб.", "Контролюй фінальне розгинання.", "Не кидай вагу в стек."],
        "Підйом": ["Обери вагу для контролю.", "Рухайся плавно.", "Не забирай усе трапеціями.", "Опускай повільно."],
        "Кор": ["Спочатку зафіксуй корпус.", "Контролюй таз.", "Не працюй інерцією.", "Зупинись, якщо позиція ламається."],
        "Кардіо": ["Почни легко.", "Піднімай інтенсивність поступово.", "Тримай стабільне дихання.", "Запиши тривалість і відчуття."]
    };
    return data[pattern] || ["Налаштуй позицію контрольовано.", "Працюй у повторюваній амплітуді.", "Не поспішай.", "Фіксуй результат стабільно."];
}

export function mistakesFor(pattern) {
    const data = {
        "Горизонтальний жим": ["Відбивання ваги", "Нестабільні плечі", "Нерівна амплітуда"],
        "Вертикальна тяга": ["Розгойдування", "Половинчасті повторення", "Тяга лише руками"],
        "Присідання": ["Поспішний спуск", "Відрив п'ят", "Завал колін всередину"],
        "Hinge": ["Перетворення руху на присідання", "Округлення спини під втомою", "Вага відходить далеко від тіла"],
        "Кардіо": ["Занадто різкий старт", "Пропуск розминки", "Відсутність інтенсивності в логах"]
    };
    return data[pattern] || ["Зайва інерція", "Завелика вага", "Втрата контролю на втомі"];
}

export function safetyFor(pattern) {
    const data = {
        "Горизонтальний жим": ["Для важких сетів використовуй страхувальні упори або партнера.", "Зупинись, якщо траєкторія штанги стала нестабільною."],
        "Присідання": ["Для важких підходів став страхувальні упори.", "Не гонись за глибиною ціною контролю."],
        "Hinge": ["Поважай втому в hinge-рухах.", "Зменш вагу, якщо позиція змінюється."],
        "Кардіо": ["Піднімай інтенсивність поступово.", "Зроби паузу, якщо є дискомфорт."]
    };
    return data[pattern] || ["Працюй із контрольованим навантаженням.", "Не женись за цифрами ціною форми."];
}

function createBodyweights(users, now) {
    return users.flatMap((user, userIndex) => Array.from({ length: 9 }, (_, entryIndex) => ({
        id: createId("bodyweight"),
        userId: user.id,
        date: dateInput(addDays(now, (entryIndex - 8) * 7)),
        bodyweight: round(user.bodyweight + Math.sin(entryIndex + userIndex) * 1.2, 1),
        notes: "Щотижневий замір"
    })));
}

function createWorkouts(exercises, now) {
    const byName = new Map(exercises.map((exercise) => [exercise.name, exercise]));
    const plan = [
        ["user-daniil", 38, "Push сила", "push", ["Жим лежачи"]],
        ["user-daniil", 35, "Pull обсяг", "pull", ["Тяга верхнього блока"]],
        ["user-daniil", 28, "Upper контроль", "upper", ["Жим лежачи", "Тяга верхнього блока"]],
        ["user-daniil", 7, "Push прогресія", "push", ["Жим лежачи"]],
        ["user-daniil", 3, "Pull точність", "pull", ["Тяга верхнього блока"]],
        ["user-anastasia", 24, "Кардіо і мобільність", "cardio", []],
        ["user-anastasia", 9, "Upper чисті повторення", "upper", ["Тяга верхнього блока"]],
        ["user-maxim", 36, "Важкий push", "push", ["Жим лежачи"]],
        ["user-maxim", 5, "Upper щільність", "upper", ["Жим лежачи", "Тяга верхнього блока"]]
    ];

    const workouts = plan.map(([userId, daysAgo, title, workoutType, exerciseNames], workoutIndex) => {
        const start = setClock(addDays(now, -daysAgo), 18 + workoutIndex % 3, 10);
        const workout = {
            id: createId("workout"),
            userId,
            date: dateInput(start),
            title,
            status: "completed",
            workoutType,
            startedAt: start.toISOString(),
            finishedAt: addMinutes(start, 65 + workoutIndex % 25).toISOString(),
            notes: workoutIndex % 2 ? "Хороша сесія. Додавати вагу тільки якщо контроль стабільний." : "Чиста техніка. Повторити сетап наступного разу.",
            exercises: exerciseNames.map((name, index) => createWorkoutExercise(byName.get(name), workoutIndex, index)).filter(Boolean),
            cardioSessions: workoutType === "cardio" || workoutIndex % 4 === 0 ? [createCardio(workoutIndex)] : [],
            createdAt: start.toISOString(),
            updatedAt: start.toISOString()
        };
        return workout;
    });

    workouts.push(createTemplateWorkout("user-daniil", templateById("pull"), "planned", dateInput(addDays(now, 2)), exercises));
    const activeWorkout = createTemplateWorkout("user-daniil", templateById("push"), "active", dateInput(now), exercises);
    activeWorkout.startedAt = addMinutes(now, -34).toISOString();
    activeWorkout.notes = "Активне demo-тренування. Можна завершити або додати роботу.";
    workouts.push(activeWorkout);
    return workouts;
}

function createWorkoutExercise(exercise, workoutIndex, index) {
    if (!exercise) {
        return null;
    }

    if (exercise.movementPattern === "Кардіо") {
        return { id: createId("workout-exercise"), exerciseId: exercise.id, order: index + 1, notes: "Кардіо ведеться окремим блоком у тренуванні.", sets: [] };
    }

    const base = seedWeight(exercise.name, workoutIndex);
    return {
        id: createId("workout-exercise"),
        exerciseId: exercise.id,
        order: index + 1,
        notes: index === 0 ? "Головний рух. Тримай техніку строгою." : "Допоміжний рух.",
        sets: [
            createSet("warmup", Math.max(0, round(base * 0.55, 1)), 10, 5, 60, true),
            createSet("working", base, 8 + (workoutIndex + index) % 3, 8, 105, true),
            createSet("working", round(base * 1.04, 1), 7 + workoutIndex % 2, 8.5, 120, true),
            createSet(index % 3 === 0 ? "failure" : "backoff", round(base * 0.92, 1), 10, 9, 90, true)
        ]
    };
}

function createTemplateWorkout(userId, template, status, date, exercises) {
    const byName = new Map(exercises.map((exercise) => [exercise.name, exercise]));
    const now = new Date();
    return {
        id: createId("workout"),
        userId,
        date,
        title: template.title,
        status,
        workoutType: template.type,
        startedAt: status === "active" ? now.toISOString() : null,
        finishedAt: null,
        notes: status === "planned" ? "Заплановано із шаблону." : "Почато із шаблону.",
        exercises: template.exerciseNames.map((name, index) => {
            const exercise = byName.get(name);
            if (!exercise) {
                return null;
            }
            return { id: createId("workout-exercise"), exerciseId: exercise.id, order: index + 1, notes: "Підказка із шаблону.", sets: suggestedSets(exercise) };
        }).filter(Boolean),
        cardioSessions: template.type === "cardio" ? [createCardio(0)] : [],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
    };
}

export function createStandards(exercises) {
    const byName = new Map(exercises.map((exercise) => [exercise.name, exercise]));
    const ranges = [[50, 60], [60, 70], [70, 80], [80, 90], [90, 105], [105, 140]];
    const levelMultipliers = { beginner: 0.45, novice: 0.7, third_class: 0.95, second_class: 1.15, first_class: 1.35, candidate_master: 1.55, master: 1.8 };
    const exerciseMultipliers = { "Жим лежачи": 1, "Тяга верхнього блока": 0.9 };
    const standards = [];

    rankedExerciseNames.forEach((name) => {
        const rankedExercise = byName.get(name);
        if (!rankedExercise) {
            return;
        }
        ranges.forEach(([min, max]) => {
            rankOrder.forEach((level) => {
                ["male", "female"].forEach((gender) => {
                    const middle = (min + max) / 2;
                    standards.push({
                        id: createId("standard"),
                        exerciseId: rankedExercise.id,
                        gender,
                        bodyweightMin: min,
                        bodyweightMax: max,
                        level,
                        requiredWeight: round(middle * levelMultipliers[level] * exerciseMultipliers[name] * (gender === "female" ? 0.62 : 1), 1),
                        repetitions: name === "Підтягування" ? (gender === "female" ? 3 : 5) : 1,
                        sourceName: "Демо-нормативи",
                        sourceNote: "Демо-нормативи використовуються лише для прикладу. Їх можна оновити під реальні стандарти пізніше.",
                        isOfficial: false,
                        updatedAt: new Date().toISOString()
                    });
                });
            });
        });
    });

    return standards;
}

export function createSet(type, weight, repetitions, rpe, restSeconds, isCompleted, durationSeconds = null) {
    return { id: createId("set"), type, weight, repetitions, durationSeconds, rpe, restSeconds, isCompleted, notes: "" };
}

function createCardio(index) {
    return { id: createId("cardio"), type: index % 2 ? "bike" : "treadmill", durationMinutes: 18 + index % 5 * 4, distance: round(2 + index % 4 * 0.7, 1), calories: 140 + index % 5 * 28, averageHeartRate: 125 + index % 4 * 8, intensity: ["low", "medium", "high"][index % 3], notes: "Контрольований кардіо-блок" };
}

// Desktop sidebar: a curated, ordered subset (exercises / stats / changelog /
// settings intentionally live only in the Панель «Розділи» hub or the profile
// buttons, to keep the rail short). Order mirrors the «Розділи» hub.
// Grouped desktop rail. A flat 12-item list reads as one undifferentiated wall;
// splitting it into "what I do now" / "the team" / "admin" makes the shape of the
// app visible at a glance. Groups with no visible items disappear entirely.
export const SIDEBAR_GROUPS = [
    { label: "", items: ["dashboard", "workout", "calendar", "feed", "exercises", "stats"] },
    { label: "Спільнота", items: ["users", "rankings", "levels", "feedback"] },
    { label: "Адмін", items: ["moderation", "admin", "aistats"] },
    { label: "", items: ["subscription", "profile"] }
];
