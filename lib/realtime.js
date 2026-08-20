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

// Compare two versions at SECOND resolution.
//
// Postgres keeps microseconds and JSON carries milliseconds, so a round-tripped timestamp
// is routinely a fraction behind the stored one. Comparing exactly would report a copy as
// stale immediately after it was saved.
export function isVersionBehind(held, current) {
    if (!held || !current) {
        return false;
    }
    const left = Math.floor(new Date(held).getTime() / 1000);
    const right = Math.floor(new Date(current).getTime() / 1000);
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
