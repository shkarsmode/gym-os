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
