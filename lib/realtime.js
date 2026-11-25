// Rules for reconciling one workout held on two devices.
//
// `POST /workouts/:id/save` is a destructive full replace: the server deletes every set,
// exercise and cardio session of the workout and recreates them from the payload. With a
// single account open on a phone and a desktop that makes the last writer win SILENTLY —
// the phone holding a copy from before three sets were ticked re-creates the tree without
// them, no error is raised anywhere, and the work is simply gone.
//
// The server now refuses such a write when the client names the version it based the
// payload on (`baseUpdatedAt`). Everything here is the client half of that protocol, kept
// pure so the decisions can be tested without a network, a DOM or a database.

// The server's version of a row, as it travels on the wire.
//
// Deliberately NOT the client's own `updatedAt`: that field is a local "when did I last
// touch this" marker written by ~18 mutation sites, it is always set to the local clock,
// and it is therefore never behind. Comparing it to the server's clock would make every
// save look current and the guard would never fire.
export function serverVersionOf(row) {
    const value = row && row.updatedAt;
    return typeof value === "string" && value ? value : null;
}

// Whether a rejected save was rejected for being based on a stale copy.
//
// saveFull answers 409 for two different reasons — this one and WOULD_ERASE_EXERCISES —
// and they need opposite handling, so the status alone is not enough to branch on.
export function isStaleConflict(error) {
    if (!error || Number(error.status) !== 409) {
        return false;
    }
    return codeOf(error) === "STALE_WORKOUT";
}

// The version the server says it currently holds, so the retry can be based on it
// without a second round-trip.
export function conflictVersion(error) {
    const body = bodyOf(error);
    const value = body && body.currentUpdatedAt;
    return typeof value === "string" && value ? value : null;
}

function bodyOf(error) {
    if (!error) {
        return null;
    }
    // Different call paths attach the parsed response body under different names.
    const candidates = [error.body, error.data, error.response, error.payload];
    for (const candidate of candidates) {
        if (candidate && typeof candidate === "object") {
            return candidate;
        }
    }
    return null;
}

function codeOf(error) {
    const body = bodyOf(error);
    if (body && typeof body.code === "string") {
        return body.code;
    }
    return typeof error.code === "string" ? error.code : "";
}

// Compare two versions to the millisecond.
//
// Every version this client holds (boot rows, save acks, fetched rows, stream hints) is the
// same server Date serialised with millisecond precision, so one revision always compares
// equal to itself. Rounding to seconds made a change landing in the same second as this
// device's last save look old, and the hint announcing it was ignored.
export function isVersionBehind(held, current) {
    if (!held || !current) {
        return false;
    }
    const left = new Date(held).getTime();
    const right = new Date(current).getTime();
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
        return false;
    }
    return left < right;
}

function setsOf(workout) {
    return (workout && Array.isArray(workout.exercises) ? workout.exercises : [])
        .flatMap((exercise) => (Array.isArray(exercise.sets) ? exercise.sets : []));
}

function setCountByExercise(workout) {
    const counts = new Map();
    for (const exercise of (workout && Array.isArray(workout.exercises) ? workout.exercises : [])) {
        const key = exercise.exerciseId;
        const sets = Array.isArray(exercise.sets) ? exercise.sets.length : 0;
        // Same exercise twice in one session is legal (e.g. a second bench block), so
        // accumulate rather than overwrite.
        counts.set(key, (counts.get(key) || 0) + sets);
    }
    return counts;
}

// Whether re-saving the local copy over the server's would lose nothing.
//
// This is the question that decides whether a version conflict can be resolved silently.
// It is true in the overwhelmingly common shape of the conflict — one device sitting on a
// copy that is merely OLD while the other did the actual work — and false as soon as both
// copies contain training the other lacks, which is the only case a person has to decide.
//
// Note it is about CONTENT, not timestamps: a local copy can be based on an older version
// and still contain everything the newer one does.
export function localIsAhead(local, server) {
    if (!local || !Array.isArray(local.exercises)) {
        return false;
    }
    if (!server || !Array.isArray(server.exercises)) {
        // Nothing to compare against — refuse the silent path rather than guess.
        return false;
    }
    const localCounts = setCountByExercise(local);
    for (const [exerciseId, serverSets] of setCountByExercise(server)) {
        if ((localCounts.get(exerciseId) || 0) < serverSets) {
            return false;
        }
    }
    const completed = (workout) => setsOf(workout).filter((set) => set.isCompleted).length;
    if (completed(local) < completed(server)) {
        return false;
    }
    // Cardio has no per-item identity worth matching; count is the honest proxy.
    const cardio = (workout) => (Array.isArray(workout.cardioSessions) ? workout.cardioSessions.length : 0);
    return cardio(local) >= cardio(server);
}

// ---- The live stream ---------------------------------------------------------------
//
// Server-sent events, read with fetch() rather than EventSource. EventSource cannot set
// an Authorization header, and this app's primary credential is a bearer token in
// localStorage (the cookie is only a fallback, because iOS Safari's tracking prevention
// drops it on a cross-origin API). The alternative — putting a 14-day JWT in the query
// string — would write it into every proxy access log on the way.

// Split a growing buffer into complete SSE frames.
//
// A frame ends at a blank line, and a chunk boundary can fall anywhere — including in the
// middle of a JSON payload, which is why the leftover is returned rather than parsed.
export function parseSseFrames(buffer) {
    const events = [];
    // Normalise line endings first: the spec allows CRLF and a lone CR, and a proxy is
    // free to rewrite them.
    const text = String(buffer || "").replace(/\r\n|\r/g, "\n");
    const parts = text.split("\n\n");
    // The last part is either empty (the buffer ended on a frame boundary) or a partial
    // frame that the next chunk continues.
    const rest = parts.pop() ?? "";
    for (const part of parts) {
        const frame = readFrame(part);
        if (frame) {
            events.push(frame);
        }
    }
    return { events, rest };
}

function readFrame(part) {
    let name = "message";
    const dataLines = [];
    for (const line of part.split("\n")) {
        // A line starting with ':' is a comment — heartbeats and anti-buffering padding.
        if (!line || line.startsWith(":")) {
            continue;
        }
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") {
            name = value;
        } else if (field === "data") {
            dataLines.push(value);
        }
    }
    if (!dataLines.length) {
        return null;
    }
    try {
        return { name, data: JSON.parse(dataLines.join("\n")) };
    } catch (error) {
        // A frame we cannot read is dropped, not fatal: the stream carries hints, and a
        // missed hint costs a refresh, while throwing would drop the whole connection.
        return null;
    }
}

// How long to wait before reconnecting after the stream dropped.
//
// Exponential with a ceiling and jitter. The ceiling matters because a phone in a gym
// basement can be disconnected for an hour and must not spend it retrying every second;
// the jitter matters because a redeploy drops every device at the same instant and an
// undithered schedule brings them all back in the same moment, which is the load spike
// the reconnect is supposed to absorb.
export function backoffDelay(attempt, random = Math.random) {
    const base = Math.min(30000, 1000 * Math.pow(2, Math.max(0, attempt - 1)));
    return Math.round(base / 2 + base * random() / 2);
}

// Whether a "this row changed" hint should be acted on.
//
// `busy` is the decisive one and it replaces echo-suppression entirely: if this device
// has a save in flight or pending for that workout, its own copy is by definition newer
// than anything the server can report, and adopting the server's would undo the edit the
// user is in the middle of making. It is also correct in the cases an "ignore my own
// echo" scheme gets wrong — a second and third tab on the same account, a reconnected
// stream, and a save that completed while the stream was down.
export function shouldApplyRemote({ version, held, busy }) {
    if (busy) {
        return false;
    }
    if (!held) {
        // Nothing held locally — the row is new to this device, so fetch it.
        return true;
    }
    if (!version) {
        // The hint did not name a version; the only safe answer is to go and look.
        return true;
    }
    return isVersionBehind(held, version);
}

// ---- Merging a refused save and resyncing after a gap --------------------------------

const text = (value) => (value === undefined || value === null ? "" : String(value));
const optional = (value) => (value === undefined || value === null || value === "" ? null : value);
const numberOr = (fallback) => (value) => Number(value) || fallback;
const roundedOrNull = (value) => {
    if (value === undefined || value === null || value === "") {
        return null;
    }
    const rounded = Math.round(Number(value));
    return Number.isFinite(rounded) ? rounded : null;
};

const WORKOUT_FIELDS = {
    date: (value) => String(value || "").slice(0, 10),
    title: (value) => text(value) || "Тренування",
    status: (value) => text(value) || "active",
    workoutType: (value) => text(value) || "custom",
    notes: text,
    durationOverride: roundedOrNull
};
const CLOCK_FIELDS = { firstSetAt: optional, lastSetAt: optional };
const EXERCISE_FIELDS = { exerciseId: text, notes: text, supersetGroupId: optional };
const SET_FIELDS = {
    type: (value) => text(value) || "working",
    weight: numberOr(0),
    repetitions: numberOr(0),
    durationSeconds: (value) => roundedOrNull(value) || null,
    rpe: numberOr(0),
    restSeconds: numberOr(90),
    isCompleted: Boolean,
    notes: text
};
const CARDIO_FIELDS = {
    type: (value) => text(value) || "treadmill",
    durationMinutes: numberOr(0),
    distance: numberOr(0),
    calories: numberOr(0),
    averageHeartRate: numberOr(0),
    intensity: (value) => text(value) || "medium",
    notes: text
};

const listOf = (value) => (Array.isArray(value) ? value : []);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function normalized(fields, item) {
    return Object.fromEntries(Object.entries(fields).map(([key, normalize]) => [key, normalize(item ? item[key] : undefined)]));
}

// The saved meaning of a workout, normalised exactly like the save payload, so two copies
// compare equal when saving either would write the same rows.
export function snapshotWorkout(workout) {
    if (!workout || !Array.isArray(workout.exercises)) {
        return null;
    }
    return {
        ...normalized(WORKOUT_FIELDS, workout),
        ...normalized(CLOCK_FIELDS, workout),
        exercises: workout.exercises.map((exercise) => ({
            id: exercise.id || null,
            ...normalized(EXERCISE_FIELDS, exercise),
            sets: listOf(exercise.sets).map((set) => ({ id: set.id || null, ...normalized(SET_FIELDS, set) }))
        })),
        supersetGroups: listOf(workout.supersetGroups).map((group) => ({ id: group.id || null, restSeconds: Number(group.restSeconds) || 0 })),
        cardioSessions: listOf(workout.cardioSessions).map((session) => normalized(CARDIO_FIELDS, session))
    };
}

function hasIds(snapshot) {
    return snapshot.exercises.every((exercise) => exercise.id && exercise.sets.every((set) => set.id))
        && snapshot.supersetGroups.every((group) => group.id);
}

function choose(tally, baseValue, localValue, serverValue) {
    if (same(localValue, baseValue)) {
        return serverValue;
    }
    if (!same(serverValue, baseValue) && !same(serverValue, localValue)) {
        tally.conflicts += 1;
    }
    return localValue;
}

function mergeFields(fields, tally, base, local, server) {
    const reference = base || local;
    return Object.fromEntries(Object.keys(fields).map((key) => [key, choose(tally, reference[key], local[key], server[key])]));
}

function mergeOrder(baseIds, localIds, serverIds, keep) {
    const relative = (ids, others) => ids.filter((id) => others.includes(id));
    const movedHere = !same(relative(localIds, baseIds), relative(baseIds, localIds));
    const primary = movedHere ? localIds : serverIds;
    const secondary = movedHere ? serverIds : localIds;
    const order = primary.filter((id) => keep.has(id));
    secondary.forEach((id, index) => {
        if (!keep.has(id) || order.includes(id)) {
            return;
        }
        const next = secondary.slice(index + 1).find((candidate) => order.includes(candidate));
        if (next) {
            order.splice(order.indexOf(next), 0, id);
        } else {
            order.push(id);
        }
    });
    for (const id of keep.keys()) {
        if (!order.includes(id)) {
            order.push(id);
        }
    }
    return order;
}

function mergeList(tally, baseList, localList, serverList, mergeItem) {
    const byId = (list) => new Map(list.map((item) => [item.id, item]));
    const bases = byId(baseList);
    const locals = byId(localList);
    const servers = byId(serverList);
    const keep = new Map();
    for (const id of new Set([...locals.keys(), ...servers.keys()])) {
        const base = bases.get(id);
        const local = locals.get(id);
        const server = servers.get(id);
        if (local && server) {
            keep.set(id, mergeItem(tally, base, local, server));
        } else if (local) {
            if (!base || !same(base, local)) {
                keep.set(id, local);
                tally.conflicts += base ? 1 : 0;
            }
        } else if (!base || !same(base, server)) {
            keep.set(id, server);
            tally.conflicts += base ? 1 : 0;
        }
    }
    const ids = (list) => list.map((item) => item.id);
    return mergeOrder(ids(baseList), ids(localList), ids(serverList), keep).map((id) => keep.get(id));
}

function mergeSet(tally, base, local, server) {
    const doneHere = local.isCompleted && !(base && base.isCompleted);
    const doneThere = server.isCompleted && !(base && base.isCompleted);
    if (doneThere && !doneHere) {
        return server;
    }
    if (doneHere && !doneThere) {
        return local;
    }
    return { id: local.id, ...mergeFields(SET_FIELDS, tally, base, local, server) };
}

function mergeExercise(tally, base, local, server) {
    return {
        id: local.id,
        ...mergeFields(EXERCISE_FIELDS, tally, base, local, server),
        sets: mergeList(tally, base ? base.sets : [], local.sets, server.sets, mergeSet)
    };
}

function mergeClock(key, base, local, server, earliest) {
    if (same(local[key], base[key])) {
        return server[key];
    }
    if (same(server[key], base[key]) || !local[key] || !server[key]) {
        return local[key];
    }
    return (earliest ? local[key] < server[key] : local[key] > server[key]) ? local[key] : server[key];
}

function keepGroupsTogether(exercises) {
    const placed = new Set();
    const result = [];
    for (const item of exercises) {
        if (placed.has(item.id)) {
            continue;
        }
        const members = item.supersetGroupId ? exercises.filter((other) => other.supersetGroupId === item.supersetGroupId) : [item];
        for (const member of members) {
            placed.add(member.id);
            result.push(member);
        }
    }
    return result;
}

/**
 * Three-way merge of a workout whose save was refused as stale.
 *
 * `base` is the snapshot of the last copy the server confirmed to this device, `local`
 * the copy in memory, `server` the fresh copy. Exercises and sets are matched by their
 * stable ids; a field keeps this device's value only where this device changed it, so a
 * weight, a date or a note changed elsewhere is no longer overwritten by an old copy.
 * Returns null when the copies cannot be matched, and the caller falls back.
 */
export function mergeWorkout(base, local, server) {
    const mine = snapshotWorkout(local);
    const theirs = snapshotWorkout(server);
    if (!base || !mine || !theirs || !hasIds(base) || !hasIds(mine) || !hasIds(theirs)) {
        return null;
    }
    const tally = { conflicts: 0 };
    const scalars = {
        ...mergeFields(WORKOUT_FIELDS, tally, base, mine, theirs),
        firstSetAt: mergeClock("firstSetAt", base, mine, theirs, true),
        lastSetAt: mergeClock("lastSetAt", base, mine, theirs, false)
    };
    const groups = mergeList(tally, base.supersetGroups, mine.supersetGroups, theirs.supersetGroups, (counter, groupBase, groupLocal, groupServer) => ({
        id: groupLocal.id,
        restSeconds: choose(counter, groupBase ? groupBase.restSeconds : groupLocal.restSeconds, groupLocal.restSeconds, groupServer.restSeconds)
    }));
    const groupIds = new Set(groups.map((group) => group.id));
    const exercises = keepGroupsTogether(
        mergeList(tally, base.exercises, mine.exercises, theirs.exercises, mergeExercise)
            .map((exercise) => (exercise.supersetGroupId && !groupIds.has(exercise.supersetGroupId) ? { ...exercise, supersetGroupId: null } : exercise))
    );
    const usedGroups = new Set(exercises.map((exercise) => exercise.supersetGroupId).filter(Boolean));
    const cardioHere = !same(mine.cardioSessions, base.cardioSessions);
    if (cardioHere && !same(theirs.cardioSessions, base.cardioSessions) && !same(mine.cardioSessions, theirs.cardioSessions)) {
        tally.conflicts += 1;
    }

    const rawExercises = new Map();
    const rawSets = new Map();
    const rawGroups = new Map();
    for (const source of [server, local]) {
        for (const exercise of listOf(source.exercises)) {
            rawExercises.set(exercise.id, exercise);
            for (const set of listOf(exercise.sets)) {
                rawSets.set(set.id, set);
            }
        }
        for (const group of listOf(source.supersetGroups)) {
            rawGroups.set(group.id, group);
        }
    }
    return {
        conflicts: tally.conflicts,
        changedLocally: !same(mine, base),
        workout: {
            ...scalars,
            exercises: exercises.map((exercise, index) => {
                const { sets, ...fields } = exercise;
                return {
                    ...(rawExercises.get(exercise.id) || {}),
                    ...fields,
                    order: index + 1,
                    sets: sets.map((set) => ({ ...(rawSets.get(set.id) || {}), ...set }))
                };
            }),
            supersetGroups: groups
                .filter((group) => usedGroups.has(group.id))
                .map((group) => ({ ...(rawGroups.get(group.id) || {}), ...group })),
            cardioSessions: listOf(cardioHere ? local.cardioSessions : server.cardioSessions).map((session) => ({ ...session }))
        }
    };
}

/**
 * What to do with this device's own workouts after it was away (backgrounded, offline,
 * stream dropped): `server` is the newest page of `/workouts/mine`, newest first.
 *
 * A row is only adopted or removed when this device has nothing pending for it. A row
 * missing from the page is treated as deleted only when the page provably covers its
 * date, i.e. it is newer than the oldest date on the page, or the page is the whole list.
 */
export function planResync({ local, server, complete, busy }) {
    const held = new Map(listOf(local).map((item) => [item.id, item]));
    const seen = new Set(listOf(server).map((row) => row.id));
    const adopt = [];
    const add = [];
    const remove = [];
    for (const row of listOf(server)) {
        const mine = held.get(row.id);
        if (!mine) {
            add.push(row);
            continue;
        }
        if (busy(row.id)) {
            continue;
        }
        if (!mine.serverVersion || !Array.isArray(mine.exercises) || isVersionBehind(mine.serverVersion, serverVersionOf(row))) {
            adopt.push(row);
        }
    }
    const rows = listOf(server);
    const oldest = rows.length ? String(rows[rows.length - 1].date || "").slice(0, 10) : "";
    for (const mine of listOf(local)) {
        if (seen.has(mine.id) || !mine.serverVersion || busy(mine.id)) {
            continue;
        }
        const date = String(mine.date || "").slice(0, 10);
        if (complete || (oldest && date > oldest)) {
            remove.push(mine.id);
        }
    }
    return { adopt, add, remove };
}
