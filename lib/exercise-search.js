// Exercise search: what a person types, matched against the catalogue, best match first.
//
// People type Ukrainian, Russian or English, in any word order, stop halfway through a
// word and miss letters — «жим лёжа», «гантели жим», «присед», «гиперекстензия». So the
// query and every exercise are folded to one comparable alphabet and compared word by
// word: each word typed has to land somewhere (the name, an alias, a muscle, the
// equipment), and where and how well it lands decides the rank. Popularity only breaks
// ties, so a search never buries the exercise that was actually asked for.

// Words that carry no meaning in an exercise name, folded («зі» → «зи», «від» → «вид»).
const STOP_WORDS = new Set(["на", "з", "из", "зи", "в", "у", "до", "для", "с", "со", "и", "та", "по", "вид", "от", "за", "a", "an", "the", "of", "with", "on", "to"]);

// Russian (and gym slang) roots that Ukrainian spells with another root, so no amount of
// letter folding gets from one to the other. Both sides are folded; one root may lead to
// several («ноги» is every leg muscle).
const ROOT_SYNONYMS = [
    ["разгиб", "розгин"], ["сгиб", "згин"], ["отжим", "виджим"], ["свед", "звед"], ["развод", "розвед"],
    ["икр", "литк"], ["голен", "гомил"], ["ягодиц", "сидниц"], ["ягодичн", "сиднич"], ["попа", "сидниц"],
    ["бедр", "стегн"], ["наклон", "нахил"], ["скам", "лав"], ["лавк", "лав"], ["узк", "вузк"],
    ["обратн", "зворотн"], ["французск", "французк"], ["дельт", "плеч"], ["широчайш", "спин"], ["бицух", "бицепс"],
    ["трицух", "трицепс"], ["турник", "пидтяг"], ["перекладин", "пидтяг"], ["грудн", "груд"], ["квадр", "квадрицепс"],
    ["пресс", "прес"], ["кубик", "прес"], ["трапец", "шраг"], ["резин", "гумов"], ["лент", "стричк"],
    ["хип", "таз"], ["траст", "таз"],
    ["ног", "квадрицепс"], ["ног", "стегн"], ["ног", "сидниц"], ["ног", "литк"],
    ["ниг", "квадрицепс"], ["ниг", "стегн"], ["ниг", "сидниц"], ["ниг", "литк"]
];

// Where a word landed, and how much that is worth.
const FIELD_WEIGHTS = { name: 10, alias: 7, muscle: 6, equipment: 4, pattern: 3, secondary: 2 };

// A word typed as itself or the start of itself, rather than a guess at a misspelling.
const STRONG = 0.8;

// Endings of Russian and Ukrainian words (folded), longest first: «задняя» and «задню»
// are one word once both lose theirs.
const ENDINGS = ["ями", "ами", "ого", "его", "ому", "ему", "ими", "ая", "яя", "ую", "юю", "ой", "ей", "ий", "ие", "их", "ах", "ях", "ом", "ем", "ою", "ею", "а", "я", "у", "ю", "и", "е", "о"];

/** A word without its ending, when at least four letters are left. */
function stemOf(word) {
    for (const ending of ENDINGS) {
        if (word.endsWith(ending) && word.length - ending.length >= 4) {
            return word.slice(0, -ending.length);
        }
    }
    return word;
}

/**
 * One comparable alphabet: lower case, no accents or apostrophes, and the letters that
 * Ukrainian and Russian spell differently for the same sound made equal (і/и/ы, є/е/э,
 * ґ/г; the soft and hard signs dropped), and a doubled letter written once — Ukrainian
 * doubles where Russian does not and back («кроссовер» / «кросовер», «гакк» / «гак»).
 * «Біцепс» and «бицепс» fold to the same word.
 */
export function foldSearchText(text) {
    return String(text ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/['’ʼ`´]/g, "")
        .replace(/[іы]/g, "и")
        .replace(/[єэ]/g, "е")
        .replace(/ґ/g, "г")
        .replace(/[ъь]/g, "")
        .replace(/[^a-z0-9а-я]+/g, " ")
        .replace(/([a-zа-я])\1/g, "$1")
        .trim();
}

function words(text) {
    const folded = foldSearchText(text);
    return folded ? folded.split(" ") : [];
}

/** The consonants of a Cyrillic word, doubled ones once: «присед» and «присідання» share
 *  «прсд», «кроссовер» and «кросовер» share «крсвр». Empty for anything else. */
function skeleton(word) {
    if (!/[а-я]/.test(word)) {
        return "";
    }
    return word.replace(/[аеиоуяю]/g, "").replace(/(.)\1+/g, "$1");
}

/** The same word with Ukrainian's і where Russian has о or е: «ног» / «ніг», «мост» /
 *  «міст», «бег» / «біг». Nothing else may differ. */
function vowelShift(token, word) {
    if (token.length !== word.length || token.length < 3) {
        return false;
    }
    let shifted = false;
    for (let index = 0; index < token.length; index += 1) {
        const left = token[index];
        const right = word[index];
        if (left === right) {
            continue;
        }
        const pair = left + right;
        if (pair !== "ои" && pair !== "ио" && pair !== "еи" && pair !== "ие") {
            return false;
        }
        shifted = true;
    }
    return shifted;
}

/** Edit distance with adjacent swaps (optimal string alignment), stopping early past `max`. */
function typoDistance(left, right, max) {
    if (Math.abs(left.length - right.length) > max) {
        return max + 1;
    }
    let previousRow = null;
    let row = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i += 1) {
        const next = [i];
        let best = i;
        for (let j = 1; j <= right.length; j += 1) {
            const cost = left[i - 1] === right[j - 1] ? 0 : 1;
            let value = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + cost);
            if (previousRow && i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
                value = Math.min(value, previousRow[j - 2] + 1);
            }
            next.push(value);
            best = Math.min(best, value);
        }
        if (best > max) {
            return max + 1;
        }
        previousRow = row;
        row = next;
    }
    return row[right.length];
}

/** How well one typed word matches one word of the exercise, 0..1. */
function wordQuality(token, word) {
    if (word === token) {
        return 1;
    }
    if (word.startsWith(token)) {
        return token.length >= 3 ? 0.9 : 0.7;
    }
    if (vowelShift(token, word)) {
        return 0.85;
    }
    // The start of the word, with the vowel shift: «присед» → «присідання». Five letters
    // at least — «прес» would otherwise start «присідання» too.
    if (token.length >= 5 && vowelShift(token, word.slice(0, token.length))) {
        return 0.8;
    }
    if (token.length >= 3 && word.includes(token)) {
        return 0.55;
    }
    // The same word in another case or gender: «задняя дельта» → «на задню дельту». Below
    // an exact muscle, so «спина» lists the back before everything done «на спині».
    if (token.length >= 5) {
        const stem = stemOf(token);
        if (stem !== token && (word.startsWith(stem) || stemOf(word) === stem)) {
            return 0.55;
        }
    }
    if (token.length >= 4) {
        // Same consonants in the same order: «присед» → «присідання», «подтяг» → «підтяг».
        // Four of them at least — three («спн», «прс») start far too many words.
        const typed = skeleton(token);
        if (typed.length >= 4 && skeleton(word).startsWith(typed)) {
            return 0.5;
        }
    }
    if (token.length >= 5 && token[0] === word[0]) {
        // A typo: the start of the word, give or take a letter or two, is within reach.
        // The first letter has to be right — «кисть» is not «вистрибування».
        const allowed = token.length >= 8 ? 2 : 1;
        for (const length of [token.length, token.length - 1, token.length + 1]) {
            if (length <= word.length && typoDistance(token, word.slice(0, length), allowed) <= allowed) {
                return 0.42;
            }
        }
    }
    return 0;
}

// Folded words of every searchable field, worked out once per exercise version.
const indexCache = new WeakMap();

function indexOf(exercise) {
    const aliases = [...(Array.isArray(exercise.aliases) ? exercise.aliases : []), exercise.originalName].filter(Boolean);
    const secondary = Array.isArray(exercise.secondaryMuscleGroups) ? exercise.secondaryMuscleGroups : [];
    const signature = [exercise.name, aliases.join("|"), exercise.primaryMuscleGroup, exercise.equipment, exercise.movementPattern, secondary.join("|")].join("~");
    const cached = indexCache.get(exercise);
    if (cached && cached.signature === signature) {
        return cached;
    }
    const nameWords = words(exercise.name);
    const index = {
        signature,
        name: foldSearchText(exercise.name),
        nameLength: String(exercise.name || "").length,
        aliases: aliases.map(foldSearchText),
        fields: [
            ["name", nameWords],
            ["alias", aliases.flatMap(words)],
            ["muscle", words(exercise.primaryMuscleGroup)],
            ["equipment", words(exercise.equipment)],
            ["pattern", words(exercise.movementPattern)],
            ["secondary", secondary.flatMap(words)]
        ]
    };
    indexCache.set(exercise, index);
    return index;
}

/** The words of a query worth matching, each with the roots it may also be spelled as. */
export function queryTokens(query) {
    const typed = words(query);
    const meaningful = typed.filter((token) => !STOP_WORDS.has(token) && (token.length > 1 || /\d/.test(token)));
    // A lone first letter («ж») or a lone «на» is still something typed: match it as is
    // rather than treating the search as empty and listing everything.
    return (meaningful.length ? meaningful : typed)
        .map((token) => {
            const alternatives = [token];
            ROOT_SYNONYMS.forEach(([from, to]) => {
                if (token.startsWith(from) || (token.length >= 4 && from.startsWith(token))) {
                    alternatives.push(to);
                }
            });
            return [...new Set(alternatives)];
        });
}

/** The best place one typed word lands in an exercise. */
function tokenMatch(alternatives, index) {
    let best = { score: 0, field: null, quality: 0, firstWord: false };
    alternatives.forEach((token, position) => {
        const discount = position === 0 ? 1 : 0.95;
        index.fields.forEach(([field, fieldWords]) => {
            fieldWords.forEach((word, at) => {
                const quality = wordQuality(token, word);
                const score = FIELD_WEIGHTS[field] * quality * discount;
                if (score > best.score) {
                    best = { score, field, quality, firstWord: field === "name" && at === 0 };
                }
            });
        });
    });
    return best;
}

/**
 * How well an exercise answers the query (0 = it does not). Every word typed has to
 * land somewhere unless `minMatched` says fewer will do.
 */
export function exerciseRelevance(exercise, query, options = {}) {
    const tokens = options.tokens || queryTokens(query);
    if (!tokens.length) {
        return 0;
    }
    const index = indexOf(exercise);
    const matches = tokens.map((alternatives) => tokenMatch(alternatives, index));
    const matched = matches.filter((match) => match.score > 0);
    if (matched.length < (options.minMatched ?? tokens.length)) {
        return 0;
    }
    let score = matched.reduce((sum, match) => sum + match.score, 0);
    const phrase = foldSearchText(query);
    if (index.name === phrase) {
        score += 20;
    } else if (index.aliases.includes(phrase)) {
        score += 12;
    }
    if (phrase && index.name.startsWith(phrase)) {
        score += 8;
    } else if (phrase.length >= 3 && index.name.includes(phrase)) {
        score += 4;
    }
    // Everything typed is in the name, spelled out rather than guessed at.
    if (matched.length === tokens.length && matches.every((match) => match.field === "name" && match.quality >= STRONG)) {
        score += 4;
    }
    // The name starts with what was asked for: «Присідання зі штангою» before «Гоблет-присідання».
    if (matches.some((match) => match.firstWord && match.quality >= STRONG)) {
        score += 2;
    }
    return score;
}

/**
 * The team's favourites first: more likes, then what you do most. Somebody else's
 * dislike does not push an exercise down — only your own does, to the very end.
 */
function popularityOrder(uses) {
    return (left, right) => {
        const disliked = (exercise) => (exercise.myReaction === "dislike" ? 1 : 0);
        return disliked(left) - disliked(right)
            || (Number(right.likeCount) || 0) - (Number(left.likeCount) || 0)
            || (uses.get(right.id) || 0) - (uses.get(left.id) || 0);
    };
}

const byName = (left, right) => String(left.name || "").localeCompare(String(right.name || ""), "uk");

/** The catalogue's resting order: popularity, then by name. */
export function popularityCompare(uses = new Map()) {
    const popular = popularityOrder(uses);
    return (left, right) => popular(left, right) || byName(left, right);
}

/**
 * The exercises that answer `query`, best first. Ties (the same kind of match) go to the
 * more popular one, then to the shorter name — the plain «Станова тяга» before its
 * variations. When nothing matches every word, the ones matching most of them are
 * returned instead: one word nobody spells like that should not empty the list.
 */
export function searchExercises(exercises, query, options = {}) {
    const list = exercises || [];
    const uses = options.uses || new Map();
    const tokens = queryTokens(query);
    if (!tokens.length) {
        // Nothing typed lists everything; something typed that folds away to nothing
        // («ъъъ», «—») matches nothing.
        return String(query ?? "").trim() ? [] : list.slice().sort(popularityCompare(uses));
    }
    const rank = (minMatched) => list
        .map((exercise) => ({ exercise, score: exerciseRelevance(exercise, query, { tokens, minMatched }) }))
        .filter((item) => item.score > 0);
    let ranked = rank(tokens.length);
    if (!ranked.length && tokens.length > 1) {
        ranked = rank(Math.max(1, Math.ceil(tokens.length / 2)));
    }
    const popular = popularityOrder(uses);
    // Scores within a whisker of each other are the same kind of match; let popularity
    // decide those instead of a rounding difference.
    return ranked
        .sort((left, right) => (Math.round(right.score * 2) - Math.round(left.score * 2))
            || popular(left.exercise, right.exercise)
            || indexOf(left.exercise).nameLength - indexOf(right.exercise).nameLength
            || byName(left.exercise, right.exercise))
        .map((item) => item.exercise);
}
