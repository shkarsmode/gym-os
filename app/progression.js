// Achievements, XP, levels, avatar frames.
import { escapeHtml, number } from "../lib/format.js";
import { levelForXp, XP_REWARDS, LEVEL_COUNT } from "../lib/levels.js";
import { frameForLevel, FRAME_TIERS } from "../lib/frames.js";
import { ACHIEVEMENTS } from "../lib/achievements.js";
import { userAchievements as kernelUserAchievements, xpEvents as kernelXpEvents } from "../lib/scoring.js";
import { storage } from "./data.js";
import { avatar, currentUser, exerciseById, userById, workoutsFor } from "./model.js";
import { toast } from "./overlays.js";
import { recordsFor, serverScoring } from "./scoring-bridge.js";
import { state } from "./state.js";

// ---- Progression: XP, levels, avatar frames (all computed from existing data) ----
// Reconstructs a dated XP ledger from the user's real activity. Total XP drives
// the level (see lib/levels.js) and the events power the Levels-page history.
// Everything an achievement check can look at, pre-filtered to the user.
export function userAchievements(userId, records = null) {
    const fromServer = serverScoring(userId);
    if (fromServer) {
        // The server sends only what unlocked. The UI renders all 39 including
        // locked ones and counts the array, so the full list is rebuilt here with
        // unlock dates merged in — returning the server's array alone would make
        // the Прокачка tab show only the earned badges.
        const unlocked = new Map(fromServer.achievements.map((item) => [item.id, item.unlockedAt]));
        return ACHIEVEMENTS.map((achievement) => ({
            ...achievement,
            unlockedAt: unlocked.get(achievement.id) || null
        }));
    }
    return kernelUserAchievements(userId, workoutsFor(userId), {
        exerciseById,
        userById,
        featureRequests: state.database.featureRequests || [],
        exercises: state.database.exercises,
        records: records || recordsFor(userId),
        // The five tenure badges unlock on wall-clock alone; passing the instant
        // explicitly keeps the browser and the backend from disagreeing.
        now: new Date()
    });
}

// The kernel emits structured events with no UI text, so the backend can return the
// same ledger without shipping Ukrainian copy or icon names. The wording lives here.
function labelForXpEvent(event) {
    if (event.kind === "workout") {
        return { icon: "dumbbell", label: `Тренування · ${number(event.meta.volume)} кг${event.meta.continues ? " · серія" : ""}` };
    }
    if (event.kind === "record") {
        return { icon: "flame", label: `Рекорд: ${exerciseById(event.refId).name} · ${number(event.meta.estimatedOneRepMax)} кг` };
    }
    if (event.kind === "idea") {
        return { icon: "lightbulb", label: `Ідею втілено: ${event.meta.title}` };
    }
    if (event.kind === "exercise") {
        return { icon: "plus-circle", label: `Додано вправу: ${event.meta.name}` };
    }
    return { icon: "award", label: `Досягнення: ${event.meta.title}` };
}

export function xpEvents(userId, records = null) {
    const fromServer = serverScoring(userId);
    if (fromServer) {
        // Only the caller's own ledger is sent — nothing renders a peer's. An empty
        // array here is correct for peers, not a missing-data bug.
        return fromServer.xpLedger.map((event) => ({ ...event, ...labelForXpEvent(event) }));
    }
    const recordList = records || recordsFor(userId);
    const achievements = userAchievements(userId, recordList);
    return kernelXpEvents(userId, workoutsFor(userId), {
        records: recordList,
        achievements,
        featureRequests: state.database.featureRequests || [],
        exercises: state.database.exercises
    }).map((event) => ({ ...event, ...labelForXpEvent(event) }));
}

// Toasts newly unlocked achievements (first run seeds silently so history
// doesn't spam). Called at boot and after actions that can unlock something.
// Returns the fresh ones; `silent` marks them seen without a toast, for a caller that
// shows them itself (the new screen's summary, which a toast would cover).
export function checkAchievementUnlocks(options = {}) {
    const user = currentUser();
    if (!user) {
        return [];
    }
    const unlockedIds = userAchievements(user.id).filter((achievement) => achievement.unlockedAt).map((achievement) => achievement.id);
    const key = `ach-seen-${user.id}`;
    const raw = storage.readSetting(key);
    if (raw === null || raw === undefined || raw === "") {
        storage.writeSetting(key, JSON.stringify(unlockedIds));
        return [];
    }
    let seen;
    try {
        seen = new Set(JSON.parse(raw));
    } catch (error) {
        seen = new Set();
    }
    const fresh = unlockedIds.filter((id) => !seen.has(id)).map((id) => ACHIEVEMENTS.find((item) => item.id === id)).filter(Boolean);
    if (!fresh.length) {
        return [];
    }
    if (!options.silent) {
        fresh.forEach((achievement, index) => {
            setTimeout(() => toast("Досягнення відкрито", `«${achievement.title}» · +${achievement.xp} XP`, "achievement"), 350 + index * 900);
        });
    }
    storage.writeSetting(key, JSON.stringify(unlockedIds));
    return fresh;
}

function userXp(userId, records = null) {
    // Must read the server's total, not sum the ledger: peer ledgers are shipped
    // empty (nothing renders them), so summing would report every teammate at 0 XP
    // and flatten the entire leaderboard.
    const fromServer = serverScoring(userId);
    if (fromServer) {
        return fromServer.xp;
    }
    return xpEvents(userId, records).reduce((sum, event) => sum + event.amount, 0);
}

export function userLevel(userId, records = null) {
    return levelForXp(userXp(userId, records));
}

export const XP_HOWTO = `XP нараховується автоматично за реальну активність: тренування (+${XP_REWARDS.workout}), обсяг підйомів (до +${XP_REWARDS.volumeCap} за сесію), серію тренувань підряд (+${XP_REWARDS.streak}), кожен особистий рекорд (+${XP_REWARDS.record}), твої вправи в каталозі (+${XP_REWARDS.exercise}), ідеї, які позначили «Готово» (+${XP_REWARDS.ideaDone}), та відкриті досягнення (+50–400). Усього ${LEVEL_COUNT} рівнів — що вищий рівень, то крутіша рамка аватара.`;

// Resolve which frame tier to draw. Admins can locally preview any tier via the
// frame test tool (state.frameOverride) — it only affects the admin's OWN avatar
// and resets on reload (in-memory only), so it never touches other users.
export function frameTierFor(user, level) {
    if (state.frameOverride !== null && user && user.id === currentUser()?.id) {
        return FRAME_TIERS[state.frameOverride];
    }
    return frameForLevel(level);
}

// Wrap an avatar in its level-based frame ring. `size` matches the avatar size class.
export function framedAvatar(user, size = "", level = null) {
    const resolved = level === null ? userLevel(user.id).level : level;
    return avatar(user, size, { frameTier: frameTierFor(user, resolved), plateLevel: resolved });
}

export function levelBadge(info, options = {}) {
    const tier = frameForLevel(info.level);
    const link = options.link ? ` data-action="navigate" data-section="levels"` : "";
    const cls = `level-badge${options.link ? " level-badge-link" : ""}`;
    return `<span class="${cls}" title="${escapeHtml(tier.name)} · Рівень ${info.level}"${link}><i data-lucide="medal"></i>Рів. ${info.level}</span>`;
}
