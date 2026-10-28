import test from "node:test";
import assert from "node:assert/strict";
import { foldSearchText, popularityCompare, queryTokens, searchExercises } from "./exercise-search.js";

// Real catalogue rows (names, aliases, muscles), trimmed to what the search reads.
const ex = (id, name, primaryMuscleGroup, equipment, movementPattern, aliases = [], extra = {}) => ({ id, name, primaryMuscleGroup, equipment, movementPattern, aliases, secondaryMuscleGroups: [], ...extra });
const CATALOGUE = [
    ex("bench", "Жим лежачи", "Груди", "Штанга", "Горизонтальний жим", ["Bench Press", "Barbell Bench", "Flat Bench"], { likeCount: 3 }),
    ex("db-bench", "Жим гантелей лежачи", "Груди", "Гантелі", "Горизонтальний жим", ["Dumbbell Bench Press", "Жим гантелей лёжа"], { likeCount: 1 }),
    ex("db-seated", "Жим гантелей сидячи", "Плечі", "Гантелі", "Вертикальний жим", ["Seated Dumbbell Shoulder Press", "Жим гантелей сидя"], { likeCount: 1, dislikeCount: 1 }),
    ex("incline", "Жим штанги на похилій лаві", "Груди", "Штанга", "Горизонтальний жим", ["Incline Barbell Bench Press", "Incline Press"], { likeCount: 1 }),
    ex("leg-press", "Жим платформи ногами", "Квадрицепс", "Тренажер", "Присідання", ["Leg Press", "Жим ногами"], { likeCount: 1 }),
    ex("curl", "Біцепс зі штангою", "Біцепс", "Штанга", "Згинання", ["біцепс", "Підйом штанги на біцепс", "Barbell Curl", "EZ Bar Curl"], { likeCount: 3 }),
    ex("db-curl", "Згинання рук з гантелями стоячи", "Біцепс", "Гантелі", "Згинання", ["Dumbbell Curl", "Біцепс з гантелями"]),
    ex("squat", "Присідання зі штангою", "Квадрицепс", "Штанга", "Присідання", ["Barbell Squat", "Приседания со штангой"]),
    ex("pullup", "Підтягування", "Спина", "Вага тіла", "Вертикальна тяга", ["Pull-up", "Подтягивания"]),
    ex("dips", "Віджимання на брусах", "Трицепс", "Вага тіла", "Вертикальний жим", ["Dips", "Отжимания на брусьях", "Бруси", "Chest Dips"]),
    ex("pushup", "Віджимання від підлоги", "Груди", "Вага тіла", "Горизонтальний жим", ["Push-Up", "Віджимання"]),
    ex("calf", "Литки в тренажері сидячи", "Литки", "Тренажер", "Підйом на носки", ["ікри", "Seated Calf Raise"], { likeCount: 1 }),
    ex("hyper", "Гіперекстензія", "Спина", "Тренажер", "Розгинання", ["Hyperextension", "Back Extension"], { likeCount: 1 }),
    ex("lat", "Тяга верхнього блока", "Спина", "Блок", "Вертикальна тяга", ["Lat Pulldown", "Pulldown"], { likeCount: 1 }),
    ex("lat-one", "Тяга верхнього блока однією рукою", "Спина", "Блок", "Вертикальна тяга", ["One Arm Lat Pulldown"]),
    ex("fly", "Розведення гантелей лежачи", "Груди", "Гантелі", "Розведення", ["Dumbbell Fly", "Разводка"], { likeCount: 1 }),
    ex("cross", "Зведення рук у кросовері", "Груди", "Блок", "Зведення", ["Cable Crossover", "Cable Fly"], { likeCount: 2 }),
    ex("pushdown", "Розгинання на блоці з канатом", "Трицепс", "Блок", "Розгинання", ["Rope Pushdown", "Triceps Pushdown"], { dislikeCount: 1 }),
    ex("skull", "Французький жим з EZ-грифом лежачи", "Трицепс", "Штанга", "Розгинання", ["Skull Crusher"]),
    ex("leg-ext", "Розгинання ніг в тренажері", "Квадрицепс", "Тренажер", "Розгинання", ["Leg Extension"]),
    ex("leg-curl", "Згинання ніг в тренажері", "Задня поверхня стегна", "Тренажер", "Згинання", ["Lying Leg Curl", "Згинання ніг лежачи"]),
    ex("bridge", "Сідничний місток з власною вагою", "Сідниці", "Вага тіла", "Розгинання стегна", ["Glute Bridge", "Ягодичний мостик"]),
    ex("wrist", "Згинання зап'ясть з гантелями", "Передпліччя", "Гантелі", "Згинання", ["Dumbbell Wrist Curl"], { likeCount: 1 }),
    ex("lateral", "Махи гантелей через сторони", "Плечі", "Гантелі", "Махи", ["дельта", "Dumbbell Lateral Raise"], { likeCount: 1 }),
    ex("plank", "Планка", "Прес", "Вага тіла", "Кор", ["Plank", "Front Plank"], { likeCount: 1 }),
    ex("deadlift", "Станова тяга", "Спина", "Штанга", "Тяга від підлоги", ["Deadlift", "Становая тяга"], { dislikeCount: 1 }),
    ex("sumo", "Станова тяга сумо", "Сідниці", "Штанга", "Тяга від підлоги", ["Sumo Deadlift", "Сумо"]),
    ex("goblet", "Гоблет-присідання", "Квадрицепс", "Гантелі", "Присідання", ["Goblet Squat"]),
    ex("spanish", "Іспанські присідання з гумовою стрічкою", "Квадрицепс", "Гумова стрічка", "Присідання", ["Spanish Squat"]),
    ex("jump-squat", "Присідання з вистрибуванням", "Квадрицепс", "Вага тіла", "Присідання", ["Jump Squat"]),
    ex("gripper", "Кистьовий еспандер", "Передпліччя", "Інше", "Хват", ["Hand Gripper"]),
    ex("deadbug", "Мертвий жук", "Прес", "Вага тіла", "Кор", ["Dead Bug", "Дед баг"]),
    ex("run", "Біг на місці з високим підніманням колін", "Все тіло", "Вага тіла", "Кардіо", ["High Knees"]),
    ex("thrust", "Підйом таза зі штангою", "Сідниці", "Штанга", "Розгинання стегна", ["Barbell Hip Thrust", "Hip Thrust"]),
    ex("hack", "Гак-присідання у тренажері", "Квадрицепс", "Тренажер", "Присідання", ["Hack Squat"]),
    ex("rear", "Розведення в кросовері на задню дельту", "Плечі", "Блок", "Розведення", ["Cable Rear Delt Fly"])
];
const ids = (query, options) => searchExercises(CATALOGUE, query, options).map((item) => item.id);
const first = (query) => ids(query)[0];

test("folding makes Ukrainian and Russian spellings of a word the same", () => {
    assert.equal(foldSearchText("Біцепс"), foldSearchText("бицепс"));
    assert.equal(foldSearchText("Жим лёжа"), "жим лежа");
    assert.equal(foldSearchText("Згинання зап'ясть"), foldSearchText("згинання запʼясть"));
    assert.equal(foldSearchText("  Тяга —  Т-грифа "), "тяга т грифа");
    assert.equal(foldSearchText("Кроссовер"), foldSearchText("кросовер"));
});

test("the exercise that was asked for comes first", () => {
    assert.equal(first("жим лежачи"), "bench");
    assert.equal(first("Жим лежачи"), "bench");
    assert.equal(first("біцепс"), "curl");
    assert.equal(first("тяга верхнього блока"), "lat");
    assert.equal(first("планка"), "plank");
});

test("word order does not matter", () => {
    assert.equal(first("лежачи жим"), "bench");
    assert.equal(first("гантелей жим лежачи"), "db-bench");
    assert.equal(first("рукою блока тяга"), "lat-one");
});

test("half a word is enough", () => {
    assert.equal(first("жим леж"), "bench");
    assert.equal(first("гіперек"), "hyper");
    assert.equal(first("розв ганте"), "fly");
});

test("Russian spellings find the Ukrainian names", () => {
    assert.equal(first("бицепс"), "curl");
    assert.equal(first("жим лёжа"), "bench");
    assert.equal(first("присед"), "squat");
    assert.equal(first("подтягивания"), "pullup");
    assert.equal(first("отжимания на брусьях"), "dips");
    assert.equal(first("тяга верхнего блока"), "lat");
    assert.equal(first("разгибание ног"), "leg-ext");
    assert.equal(first("сгибание ног"), "leg-curl");
    assert.equal(first("икры"), "calf");
    assert.equal(first("ягодичный мост"), "bridge");
    assert.equal(first("кроссовер"), "cross");
    assert.equal(first("разводка"), "fly");
    assert.equal(first("предплечья"), "wrist");
    assert.deepEqual(new Set(ids("дельты").slice(0, 2)), new Set(["lateral", "rear"]));
    assert.equal(first("гакк"), "hack");
    assert.deepEqual(ids("задняя дельта"), ["rear"]);
});

test("English names come in through the aliases", () => {
    assert.equal(first("bench press"), "bench");
    assert.equal(first("leg press"), "leg-press");
    assert.equal(first("pulldown"), "lat");
    assert.equal(first("skull"), "skull");
});

test("a typo still finds the exercise", () => {
    assert.equal(first("гиперекстензия"), "hyper");
    assert.equal(first("гіпереккстензія"), "hyper");
    assert.equal(first("підтягуваня"), "pullup");
    assert.equal(first("bnech"), "bench");
});

test("a muscle or the equipment lists everything for it, name matches first", () => {
    const back = ids("спина");
    assert.deepEqual(new Set(back.slice(0, 5)), new Set(["pullup", "hyper", "lat", "lat-one", "deadlift"]));
    const triceps = ids("трицепс");
    assert.ok(["dips", "pushdown", "skull"].every((id) => triceps.includes(id)));
    const dumbbells = ids("гантелі");
    assert.ok(["db-bench", "db-seated", "fly", "wrist", "lateral", "db-curl"].every((id) => dumbbells.includes(id)));
});

test("the name beats a helper muscle and an alias beats a muscle", () => {
    // «жим» in the name: the presses, not the triceps exercises it helps.
    assert.ok(ids("жим").slice(0, 5).every((id) => ["bench", "db-bench", "db-seated", "incline", "leg-press"].includes(id)));
    assert.equal(first("бруси"), "dips");
});

test("among equal matches the more liked one wins", () => {
    // Every «Жим …» starts the same way; the team's favourite goes first.
    assert.equal(first("жим"), "bench");
    assert.deepEqual(ids("тяга верхнього").slice(0, 2), ["lat", "lat-one"]);
});

test("nothing matching every word falls back to the ones matching most of them", () => {
    assert.equal(first("жим лежачи фиолетовый"), "bench");
    assert.deepEqual(ids("абракадабра"), []);
});

test("stop words and punctuation are ignored", () => {
    assert.deepEqual(queryTokens("тяга к поясу").map((alternatives) => alternatives[0]), ["тяга", "поясу"]);
    assert.equal(first("біцепс, зі штангою!"), "curl");
});

test("something typed is never an empty search", () => {
    // Nonsense finds nothing — it used to collapse to one letter and list everything.
    assert.deepEqual(ids("zzzz"), []);
    assert.deepEqual(ids("ъъъ"), []);
    // One first letter is the start of a word.
    const startsWithZh = ids("ж").slice(0, 4).map((id) => CATALOGUE.find((item) => item.id === id).name[0]);
    assert.deepEqual(startsWithZh, ["Ж", "Ж", "Ж", "Ж"]);
});

test("no query: most liked first, then what you do most, your dislikes last", () => {
    const uses = new Map([["db-curl", 12], ["squat", 4]]);
    const order = searchExercises(CATALOGUE, "", { uses }).map((item) => item.id);
    assert.deepEqual(order.slice(0, 2).sort(), ["bench", "curl"]);
    assert.ok(order.indexOf("cross") < order.indexOf("calf"));
    // No likes either way: the one done more often goes first.
    assert.ok(order.indexOf("db-curl") < order.indexOf("squat"));
    assert.ok(order.indexOf("squat") < order.indexOf("pullup"));
    // Somebody else's dislike does not push an exercise down: by name among the unliked.
    assert.ok(order.indexOf("pushdown") < order.indexOf("skull"));
    const mine = CATALOGUE.map((item) => (item.id === "bench" ? { ...item, myReaction: "dislike" } : item));
    assert.equal(searchExercises(mine, "").at(-1).id, "bench");
});

test("the plain exercise before its variations", () => {
    // One dislike from somebody else does not sink the deadlift under the sumo version.
    assert.deepEqual(ids("станова").slice(0, 2), ["deadlift", "sumo"]);
    assert.equal(first("присед"), "squat");
    assert.ok(ids("присед").indexOf("squat") < ids("присед").indexOf("goblet"));
});

test("a guess is never made from three consonants or a wrong first letter", () => {
    assert.deepEqual(ids("кисть"), ["gripper"]);
    assert.deepEqual(ids("бег"), ["run"]);
    assert.ok(!ids("спина").includes("spanish"));
    assert.ok(!ids("пресс").includes("goblet"));
    assert.ok(!ids("трицепс").includes("curl"));
});

test("«ноги» means every leg muscle, «ніг» is «ног»", () => {
    const legs = ids("ноги");
    assert.ok(["squat", "leg-press", "leg-ext", "leg-curl", "calf", "bridge"].every((id) => legs.includes(id)));
    assert.ok(!legs.includes("bench"));
    assert.equal(first("сгибание ног"), "leg-curl");
    assert.ok(!ids("згинання ніг").includes("db-curl"));
    assert.equal(first("хип траст"), "thrust");
    assert.ok(ids("резинка").includes("spanish"));
});

test("popularityCompare sorts like the search does without a query", () => {
    const sorted = CATALOGUE.slice().sort(popularityCompare());
    assert.deepEqual(sorted.map((item) => item.id), searchExercises(CATALOGUE, "").map((item) => item.id));
});
