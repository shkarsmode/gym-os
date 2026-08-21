// Static reference data — section nav, labels, ordering, catalog vocabularies.
// No app state; pure constants.

export const sectionItems = [
    ["dashboard", "Панель", "layout-dashboard"],
    ["workout", "Поточне тренування", "dumbbell"],
    ["calendar", "Календар", "calendar-days"],
    ["exercises", "Вправи", "list-filter"],
    ["stats", "Статистика", "bar-chart-3"],
    ["feed", "Стрічка", "bell"],
    ["notifications", "Повідомлення", "inbox"],
    ["rankings", "Рейтинги", "trophy"],
    ["levels", "Прокачка", "medal"],
    ["users", "Команда", "users"],
    ["feedback", "Ідеї", "lightbulb"],
    ["moderation", "Модерація", "shield-check"],
    ["admin", "Адмін", "shield"],
    ["aistats", "AI статистика", "brain-circuit"],
    ["subscription", "Підписка", "gem"],
    ["profile", "Профіль", "user-round"],
    ["changelog", "Що нового", "sparkles"],
    ["settings", "Налаштування", "settings"]
].map(([id, title, icon]) => ({ id, title, icon }));

export const rankedExerciseNames = ["Жим лежачи", "Тяга верхнього блока"];
export const rankOrder = ["beginner", "novice", "third_class", "second_class", "first_class", "candidate_master", "master"];
// `missed` is never stored — it is what a PAST day that was planned and then never
// logged actually is. See lib/workout-status.js.
export const statusLabels = { planned: "Заплановано", active: "Активне", completed: "Завершено", missed: "Не відбулося" };
export const setTypeLabels = { warmup: "Розминка", working: "Робочий", drop: "Дроп", failure: "Відмова", backoff: "Відкат" };
export const workoutTypeLabels = { custom: "Custom", push: "Push", pull: "Pull", legs: "Legs", upper: "Upper", full_body: "Full Body", cardio: "Cardio" };
export const genderLabels = { male: "чоловіча", female: "жіноча" };
export const dataModeLabels = { local: "локальний", api: "backend" };

export function muscles() {
    return ["Груди", "Спина", "Плечі", "Біцепс", "Трицепс", "Квадрицепс", "Задня поверхня стегна", "Сідниці", "Внутрішня поверхня стегна", "Литки", "Прес", "Передпліччя", "Все тіло"];
}

// These lists are what the exercise EDITOR offers, and a select cannot show a value it
// does not contain — so anything the catalogue actually holds has to be in here. When a
// stored value is missing the select falls back to its first option and SAVING SILENTLY
// REWRITES IT, which is how «Розведення» would quietly become «Горизонтальний жим» the
// first time somebody fixed a typo in that exercise's name.
export function patterns() {
    return ["Горизонтальний жим", "Похилий жим", "Вертикальний жим", "Горизонтальна тяга", "Вертикальна тяга", "Присідання", "Hinge", "Випад", "Згинання", "Розгинання", "Розведення", "Зведення", "Підйом", "Підйом на носки", "Перенесення", "Ротація", "Кор", "Кардіо"];
}

export function equipment() {
    // «Тренажер Сміта», not "Smith Machine": the catalogue stores the Ukrainian spelling,
    // and offering the English one only invites a second value for the same equipment.
    return ["Штанга", "Гантелі", "Тренажер", "Блок", "Вага тіла", "Тренажер Сміта", "Гиря", "Еспандер", "Інше"];
}
