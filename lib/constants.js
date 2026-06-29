// Static reference data — section nav, labels, ordering, catalog vocabularies.
// No app state; pure constants.

export const sectionItems = [
    ["dashboard", "Панель", "layout-dashboard"],
    ["workout", "Поточне тренування", "dumbbell"],
    ["calendar", "Календар", "calendar-days"],
    ["exercises", "Вправи", "list-filter"],
    ["stats", "Статистика", "bar-chart-3"],
    ["rankings", "Рейтинги", "trophy"],
    ["users", "Команда", "users"],
    ["feedback", "Ідеї", "lightbulb"],
    ["admin", "Адмін", "shield"],
    ["subscription", "Підписка", "gem"],
    ["profile", "Профіль", "user-round"],
    ["changelog", "Що нового", "sparkles"],
    ["settings", "Налаштування", "settings"]
].map(([id, title, icon]) => ({ id, title, icon }));

export const mobileSectionIds = ["dashboard", "workout", "calendar", "stats", "profile"];
export const rankedExerciseNames = ["Жим лежачи", "Тяга верхнього блока"];
export const rankOrder = ["beginner", "novice", "third_class", "second_class", "first_class", "candidate_master", "master"];
export const statusLabels = { planned: "Заплановано", active: "Активне", completed: "Завершено" };
export const setTypeLabels = { warmup: "Розминка", working: "Робочий", drop: "Дроп", failure: "Відмова", backoff: "Відкат" };
export const workoutTypeLabels = { custom: "Custom", push: "Push", pull: "Pull", legs: "Legs", upper: "Upper", lower: "Lower", full_body: "Full Body", cardio: "Cardio" };
export const genderLabels = { male: "чоловіча", female: "жіноча" };
export const dataModeLabels = { local: "локальний", api: "backend" };

export function muscles() {
    return ["Груди", "Спина", "Плечі", "Біцепс", "Трицепс", "Квадрицепс", "Задня поверхня стегна", "Сідниці", "Литки", "Прес", "Передпліччя", "Все тіло"];
}

export function patterns() {
    return ["Горизонтальний жим", "Вертикальний жим", "Горизонтальна тяга", "Вертикальна тяга", "Присідання", "Hinge", "Випад", "Згинання", "Розгинання", "Підйом", "Перенесення", "Ротація", "Кор", "Кардіо"];
}

export function equipment() {
    return ["Штанга", "Гантелі", "Тренажер", "Блок", "Вага тіла", "Smith Machine", "Гиря", "Еспандер", "Інше"];
}
