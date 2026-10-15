// Data layer: storage providers (localStorage / IndexedDB), the API client, DataService (`storage`) and the session token.

class LocalStorageProvider {
    constructor(key) {
        this.key = key;
        this.name = "localStorage";
    }

    async initialize() {
        return true;
    }

    async load() {
        const value = localStorage.getItem(this.key);
        return value ? JSON.parse(value) : null;
    }

    async save(database) {
        localStorage.setItem(this.key, JSON.stringify({ ...database, savedAt: new Date().toISOString() }));
    }

    async reset() {
        localStorage.removeItem(this.key);
    }
}

class IndexedDbProvider {
    constructor(databaseName, storeName, key) {
        this.databaseName = databaseName;
        this.storeName = storeName;
        this.key = key;
        this.name = "IndexedDB";
        this.database = null;
    }

    async initialize() {
        if (!window.indexedDB) {
            return false;
        }

        this.database = await new Promise((resolve, reject) => {
            const request = indexedDB.open(this.databaseName, 1);
            request.onupgradeneeded = () => request.result.createObjectStore(this.storeName);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        return true;
    }

    async load() {
        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction(this.storeName, "readonly");
            const request = transaction.objectStore(this.storeName).get(this.key);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async save(database) {
        return new Promise((resolve, reject) => {
            const transaction = this.database.transaction(this.storeName, "readwrite");
            const request = transaction.objectStore(this.storeName).put({ ...database, savedAt: new Date().toISOString() }, this.key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async reset() {
        return new Promise((resolve) => {
            const transaction = this.database.transaction(this.storeName, "readwrite");
            transaction.objectStore(this.storeName).delete(this.key).onsuccess = () => resolve();
        });
    }
}

/**
 * The session token, read from storage on every use.
 *
 * Deliberately a shared function rather than a cached value: the token changes on
 * login, logout and impersonation, and a copy captured at module load would keep
 * authenticating as whoever was signed in when the tab opened.
 *
 * It used to be a local inside ApiClient.request, which is why the live stream —
 * written later, in a different scope — referenced a name that did not exist there
 * and threw before it could open a connection.
 */
export function storedAuthToken() {
    try {
        return localStorage.getItem("gymos-auth-token") || "";
    } catch (error) {
        return "";
    }
}

/**
 * Keeps the Bearer copy of a session the server just slid forward.
 *
 * A sign-in lasts half a year and /auth/me renews it — at most once a day — by handing
 * back `token`. It used to be minted once at login for 14 days and never renewed, so
 * everyone was signed out a fortnight after their last login however often they
 * trained. Stored only while the session that asked is still the one on this device:
 * a logout or an impersonation switch made while the request was in flight must not be
 * undone by its late answer.
 */
export function adoptRenewedSession(sentToken, renewedToken) {
    if (!sentToken || !renewedToken || renewedToken === sentToken) {
        return;
    }
    try {
        if (localStorage.getItem("gymos-auth-token") === sentToken) {
            localStorage.setItem("gymos-auth-token", renewedToken);
        }
    } catch (error) {
        // The cookie half of the session was renewed by the same response.
    }
}

class ApiClient {
    constructor(baseUrl) {
        this.baseUrl = String(baseUrl || "").replace(/\/$/, "");
    }

    hasBaseUrl() {
        return Boolean(this.baseUrl);
    }

    async request(path, options = {}) {
        if (!this.hasBaseUrl()) {
            throw new Error("API base URL is not configured");
        }

        const authToken = storedAuthToken();

        // Longer than the serverless execution wall (10s) on purpose: a backend that
        // times out should surface as its real 504, not as a client-side abort that
        // hides which side failed. Without this a stalled connection (cellular
        // handoff, gym basement, captive portal) leaves the boot overlay spinning
        // forever, because nothing else bounds a bare fetch.
        const { timeoutMs = 20000, headers: extraHeaders, ...fetchOptions } = options;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        let response;
        let responseText = "";
        try {
            response = await fetch(`${this.baseUrl}${path}`, {
                credentials: "include",
                // `...fetchOptions` is spread BEFORE headers: it used to come after,
                // so any caller passing options.headers silently replaced the whole
                // header object and dropped Authorization.
                ...fetchOptions,
                signal: controller.signal,
                headers: {
                    "Content-Type": "application/json",
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                    ...(extraHeaders || {})
                }
            });
            // Drained inside the guarded region on purpose. fetch() resolves as soon
            // as the HEADERS arrive, so clearing the timer before reading the body
            // left /export — the multi-hundred-KB payload that gates boot — entirely
            // unbounded while streaming. A cellular handoff or captive portal stalls
            // mid-body, which is exactly the case this timeout exists for.
            responseText = await response.text();
        } catch (error) {
            if (error?.name === "AbortError") {
                const timeoutError = new Error(`Backend не відповів за ${Math.round(timeoutMs / 1000)} с.`);
                timeoutError.status = 0;
                timeoutError.timedOut = true;
                throw timeoutError;
            }
            throw error;
        } finally {
            clearTimeout(timer);
        }
        let payload = null;
        let parseFailed = false;
        if (responseText) {
            try {
                payload = JSON.parse(responseText);
            } catch (error) {
                parseFailed = true;
            }
        }

        if (!response.ok) {
            const message = Array.isArray(payload?.message) ? payload.message.join(" ") : payload?.message || payload?.error || response.statusText || `HTTP ${response.status}`;
            const error = new Error(message);
            error.status = response.status;
            error.payload = payload;
            throw error;
        }

        // A 200 whose body is not JSON (an HTML error page from a proxy, a truncated
        // response) must fail loudly. This used to return the raw string, which is
        // truthy, so it flowed into state.database and the app rendered fabricated
        // seed data as if it were the user's real training history.
        if (parseFailed) {
            const error = new Error("Backend повернув некоректну відповідь (не JSON).");
            error.status = response.status;
            error.malformed = true;
            throw error;
        }

        if (response.status === 204) {
            return null;
        }

        return payload;
    }

    health() {
        // Uses the app's LONGEST bound on purpose. /health looks like a cheap probe
        // but it is the one route that pays the entire Nest + Prisma cold start:
        // vercel.ts bootstrapServer -> app.init() -> PrismaService.onModuleInit ->
        // ensureSchema, which on a first boot runs ~28 serial statements over the
        // pooler, on top of a Neon scale-to-zero compute wake. A short bound here
        // does not protect anyone — it just reports a healthy backend as down.
        return this.request("/health", { method: "GET" });
    }

    me() {
        return this.request("/auth/me", { method: "GET" });
    }

    logout() {
        return this.request("/auth/logout", { method: "POST" });
    }

    // Asks for the windowed shape and offers the catalog it already has. An old
    // server ignores both — the query param is unbound and the header is unread —
    // and answers with the full v3 payload, which the client detects and handles.
    // That is what lets the two sides deploy in either order.
    exportData(catalogEtag = "") {
        return this.request("/export?shape=windowed", {
            method: "GET",
            headers: catalogEtag ? { "If-None-Match": catalogEtag } : {}
        });
    }

    fetchMyWorkouts(cursor = "", limit = 30) {
        const params = new URLSearchParams({ limit: String(limit) });
        if (cursor) {
            params.set("cursor", cursor);
        }
        return this.request(`/workouts/mine?${params}`, { method: "GET" });
    }

    startImport(resources) {
        // `confirm` is required by the backend: /import/start erases the named
        // resources before any replacement chunk is written, so it refuses to run
        // without an explicit token and an explicit resource list.
        return this.request("/import/start", { method: "POST", body: JSON.stringify({ resources, confirm: "replace" }) });
    }

    importChunk(resource, items, meta = {}) {
        return this.request("/import/chunk", { method: "POST", body: JSON.stringify({ resource, items, meta }) });
    }

    finishImport(summary) {
        return this.request("/import/finish", { method: "POST", body: JSON.stringify(summary || {}) });
    }

    importExercises(payload) {
        return this.request("/import/exercises", { method: "POST", body: JSON.stringify(payload) });
    }

    resetCuratedExercises() {
        return this.request("/exercises/reset-curated", { method: "POST" });
    }

    createWorkout(payload) {
        return this.request("/workouts", { method: "POST", body: JSON.stringify(payload) });
    }

    saveWorkout(id, payload) {
        return this.request(`/workouts/${id}/save`, { method: "POST", body: JSON.stringify(payload) });
    }

    // Full workout WITH sets. Own always; a peer's only when completed (the backend
    // 404s otherwise) — which is exactly what "copy this session" needs.
    fetchWorkout(id) {
        return this.request(`/workouts/${id}`, { method: "GET" });
    }

    // ---- Стрічка (feed, threads, notifications, reports, push) ----
    fetchFeed(scope, cursor) {
        const params = new URLSearchParams({ scope: scope || "team" });
        if (cursor) {
            params.set("cursor", cursor);
        }
        return this.request(`/feed?${params}`, { method: "GET" });
    }

    fetchPost(type, id) {
        return this.request(`/feed/${type}/${id}`, { method: "GET" });
    }

    toggleFeedReaction(type, id) {
        return this.request(`/feed/${type}/${id}/react`, { method: "POST" });
    }

    addFeedComment(type, id, payload) {
        return this.request(`/feed/${type}/${id}/comments`, { method: "POST", body: JSON.stringify(payload) });
    }

    editFeedComment(id, body) {
        return this.request(`/feed/comments/${id}/update`, { method: "POST", body: JSON.stringify({ body }) });
    }

    deleteFeedComment(id) {
        return this.request(`/feed/comments/${id}/delete`, { method: "POST" });
    }

    fetchAccessState() {
        return this.request("/access/state", { method: "GET" });
    }

    setPrivacy(hideWorkoutDetails) {
        return this.request("/access/privacy", { method: "POST", body: JSON.stringify({ hideWorkoutDetails }) });
    }

    acknowledgePrivacy() {
        return this.request("/access/privacy/ack", { method: "POST" });
    }

    requestAccess(ownerId) {
        return this.request("/access/requests", { method: "POST", body: JSON.stringify({ ownerId }) });
    }

    decideAccess(grantId, action) {
        return this.request(`/access/requests/${encodeURIComponent(grantId)}/${action}`, { method: "POST" });
    }

    updatePartnerSet(workoutId, workoutExerciseId, setId, patch) {
        return this.request(
            `/workouts/${encodeURIComponent(workoutId)}/exercises/${encodeURIComponent(workoutExerciseId)}/sets/${encodeURIComponent(setId)}/update`,
            { method: "POST", body: JSON.stringify(patch) }
        );
    }

    watchWorkout(workoutId) {
        return this.request(`/workouts/${encodeURIComponent(workoutId)}/watch`, { method: "GET" });
    }

    registerWatch(token, workoutId) {
        return this.request("/live/watch", { method: "POST", body: JSON.stringify({ token, workoutId }) });
    }

    stopWatch(token) {
        return this.request("/live/watch/stop", { method: "POST", body: JSON.stringify({ token }) });
    }

    fetchPartner() {
        return this.request("/live/partner", { method: "GET" });
    }

    invitePartner(userId) {
        return this.request("/live/partner/invite", { method: "POST", body: JSON.stringify({ userId }) });
    }

    setPartnerEditRight(id, allow) {
        return this.request(`/live/partner/${encodeURIComponent(id)}/edit-right`, { method: "POST", body: JSON.stringify({ allow }) });
    }

    answerPartner(id, action) {
        return this.request(`/live/partner/${encodeURIComponent(id)}/${action}`, { method: "POST" });
    }

    fetchPresence() {
        return this.request("/live/presence", { method: "GET" });
    }

    fetchPeerWorkouts() {
        return this.request("/live/peers", { method: "GET" });
    }

    sendCheer(payload) {
        return this.request("/live/cheer", { method: "POST", body: JSON.stringify(payload) });
    }

    fetchCheers(workoutId) {
        return this.request(`/live/cheers/${encodeURIComponent(workoutId)}`, { method: "GET" });
    }

    reportContent(payload) {
        return this.request("/feed/report", { method: "POST", body: JSON.stringify(payload) });
    }

    fetchReports() {
        return this.request("/feed/reports", { method: "GET" });
    }

    fetchReportCount() {
        return this.request("/feed/reports/count", { method: "GET" });
    }

    resolveReport(id, action) {
        return this.request(`/feed/reports/${id}/resolve`, { method: "POST", body: JSON.stringify({ action }) });
    }

    fetchNotifications(cursor) {
        return this.request(`/feed/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { method: "GET" });
    }

    fetchUnreadCount() {
        return this.request("/feed/notifications/unread", { method: "GET" });
    }

    markNotificationsRead(ids) {
        return this.request("/feed/notifications/read", { method: "POST", body: JSON.stringify({ ids }) });
    }

    fetchPushKey() {
        return this.request("/feed/push/key", { method: "GET" });
    }

    pushSubscribe(payload) {
        return this.request("/feed/push/subscribe", { method: "POST", body: JSON.stringify(payload) });
    }

    pushUnsubscribe(endpoint) {
        return this.request("/feed/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint }) });
    }

    syncRecords(items) {
        return this.request("/feed/records/sync", { method: "POST", body: JSON.stringify({ items }) });
    }

    syncAchievements(items) {
        return this.request("/feed/achievements/sync", { method: "POST", body: JSON.stringify({ items }) });
    }

    impersonate(userId) {
        return this.request(`/auth/impersonate/${userId}`, { method: "POST" });
    }

    stopImpersonation() {
        return this.request("/auth/impersonate/stop", { method: "POST" });
    }

    updateWorkout(id, payload) {
        return this.request(`/workouts/${id}/update`, { method: "POST", body: JSON.stringify(payload) });
    }

    deleteWorkout(id) {
        return this.request(`/workouts/${id}/delete`, { method: "POST" });
    }

    createExercise(payload) {
        return this.request("/exercises", { method: "POST", body: JSON.stringify(payload) });
    }

    updateExercise(id, payload) {
        return this.request(`/exercises/${id}/update`, { method: "POST", body: JSON.stringify(payload) });
    }

    deleteExercise(id) {
        return this.request(`/exercises/${id}/delete`, { method: "POST" });
    }

    approveExercise(id) {
        return this.request(`/exercises/${id}/approve`, { method: "POST" });
    }

    rejectExercise(id) {
        return this.request(`/exercises/${id}/reject`, { method: "POST" });
    }

    fetchPendingExercises() {
        return this.request("/exercises/pending", { method: "GET" });
    }

    fetchMyExerciseReactions() {
        return this.request("/exercises/my-reactions", { method: "GET" });
    }

    reactExercise(id, type) {
        return this.request(`/exercises/${id}/react`, { method: "POST", body: JSON.stringify({ type }) });
    }

    createFeedback(payload) {
        return this.request("/feedback", { method: "POST", body: JSON.stringify(payload) });
    }

    updateFeedbackStatus(id, status) {
        return this.request(`/feedback/${id}/status`, { method: "POST", body: JSON.stringify({ status }) });
    }

    deleteFeedback(id) {
        return this.request(`/feedback/${id}/delete`, { method: "POST" });
    }

    createBodyweight(payload) {
        return this.request("/users/me/bodyweight", { method: "POST", body: JSON.stringify(payload) });
    }

    updateProfile(payload) {
        return this.request("/users/me/profile", { method: "POST", body: JSON.stringify(payload) });
    }

    savePreferences(preferences) {
        return this.request("/users/me/preferences", { method: "POST", body: JSON.stringify({ preferences }) });
    }

    fetchMyTemplates() {
        return this.request("/workout-templates/mine", { method: "GET" });
    }

    createTemplate(payload) {
        return this.request("/workout-templates", { method: "POST", body: JSON.stringify(payload) });
    }

    deleteTemplate(id) {
        return this.request(`/workout-templates/${id}/delete`, { method: "POST" });
    }

    setUserApproval(userId, approved) {
        return this.request(`/users/${userId}/approval`, { method: "POST", body: JSON.stringify({ approved }) });
    }

    setUserRole(userId, role) {
        return this.request(`/users/${userId}/role`, { method: "POST", body: JSON.stringify({ role }) });
    }

    startWorkout(id) {
        return this.request(`/workouts/${id}/start`, { method: "POST" });
    }

    finishWorkout(id) {
        return this.request(`/workouts/${id}/finish`, { method: "POST" });
    }

    parseAiWorkout(payload) {
        return this.request("/ai/workouts/parse", { method: "POST", body: JSON.stringify(payload) });
    }

    // Advisory "does this already exist?" check for the custom-exercise form. The
    // backend answers 200 even when its AI judge is unavailable, and the caller
    // swallows anything that still escapes. Shorter than the default 20s because the
    // backend caps its own model call at 7s and this sits on the submit path: a user
    // waiting on the Save button must not be held for the full network budget.
    checkExerciseDuplicate(payload) {
        return this.request("/ai/exercises/duplicate-check", { method: "POST", body: JSON.stringify(payload), timeoutMs: 12000 });
    }

    // Suggested demo gifs for an exercise name. Lives under /exercises, NOT /ai: the
    // AI routes share one per-user cooldown, so asking for a gif there would lock the
    // user out of the AI coach for seconds afterwards.
    suggestExerciseMedia(payload) {
        return this.request("/exercises/media-suggest", { method: "POST", body: JSON.stringify(payload) });
    }

    fetchAiStatistics(kind, query = {}) {
        const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== "")).toString();
        return this.request(`/ai/statistics/${kind}${params ? `?${params}` : ""}`, { method: "GET" });
    }
}

class ApiProvider {
    constructor(apiClient) {
        this.apiClient = apiClient;
        this.name = "backend API";
    }

    async initialize() {
        if (!this.apiClient.hasBaseUrl()) {
            return false;
        }

        await this.apiClient.health();
        return true;
    }

    async load() {
        // The catalog is 40% of the payload and changes a few times a month, so the
        // tag we were last served is offered back and the server omits that section
        // when it still matches. `catalogEtag` is module-level rather than stored:
        // a reload should re-fetch the catalog once, cheaply, rather than trust a
        // tag that outlived the data it described.
        const payload = await this.apiClient.exportData(this.catalogEtag || "");
        if (payload && typeof payload === "object") {
            if (payload.catalogEtag) {
                this.catalogEtag = payload.catalogEtag;
            }
            // Section omitted means "you already have it" — splice ours back in, or
            // downstream sees a payload with no catalog at all.
            if (!Array.isArray(payload.exercises) && Array.isArray(this.lastExercises)) {
                payload.exercises = this.lastExercises;
            } else if (Array.isArray(payload.exercises)) {
                this.lastExercises = payload.exercises;
            }
        }
        return payload;
    }

    async save(database) {
        // Unreachable: DataService.save() routes api-mode writes through
        // importUserData() (the chunked start/chunk/finish flow). The monolithic
        // POST /import it used to call no longer exists. Fail loudly rather than 404.
        throw new Error("ApiProvider.save is not a supported path — use importUserData()");
    }

    async reset() {
        return null;
    }
}

class DataService {
    constructor(config) {
        this.config = config || {};
        this.key = "gym-os-v2";
        this.mode = this.config.requireAuth ? this.config.dataMode || "api" : this.readSetting("dataMode") || this.config.dataMode || "local";
        this.apiBaseUrl = this.readSetting("apiBaseUrl") || this.config.apiBaseUrl || "";
        this.backendStatus = "unknown";
        this.backendUnavailable = false;
        this.localProvider = new LocalStorageProvider(this.key);
        this.indexedDbProvider = new IndexedDbProvider("gymos-database", "state", this.key);
        this.apiClient = new ApiClient(this.apiBaseUrl);
        this.apiProvider = new ApiProvider(this.apiClient);
        this.provider = this.localProvider;
        this.currentUser = null;
    }

    async initialize() {
        try {
            const indexedReady = await this.indexedDbProvider.initialize();
            this.localProvider = indexedReady ? this.indexedDbProvider : this.localProvider;
        } catch (error) {
            console.warn("IndexedDB fallback", error);
        }

        if (this.mode === "api") {
            if (this.config.requireAuth) {
                await this.localProvider.reset();
            }
            const isBackendAvailable = await this.checkBackend(false);
            this.provider = isBackendAvailable || this.config.allowLocalFallback === false ? this.apiProvider : this.localProvider;
            if (!isBackendAvailable && this.config.allowLocalFallback !== false) {
                this.mode = "local";
                this.writeSetting("dataMode", "local");
            }
            // With no local fallback we stay in api mode but never learn who the user
            // is, because refreshCurrentUser is skipped below. currentUser then stays
            // null, requiresAuthentication() reads true, and a signed-in member gets
            // the Google login screen because the backend is down. Record the real
            // reason so the boot path can tell those two states apart.
            this.backendUnavailable = !isBackendAvailable;
            if (isBackendAvailable) {
                await this.refreshCurrentUser(false);
            }
            return;
        }

        this.provider = this.localProvider;
    }

    async load() {
        try {
            return await this.provider.load();
        } catch (error) {
            console.warn("Data load fallback", error);
            this.backendStatus = "offline";
            if (this.config.allowLocalFallback === false) {
                throw error;
            }
            this.mode = "local";
            this.writeSetting("dataMode", "local");
            this.provider = this.localProvider;
            return this.localProvider.load();
        }
    }

    async save(database) {
        if (this.mode === "api" && this.backendStatus === "online") {
            try {
                await this.importUserData(database, { quiet: true });
                return;
            } catch (error) {
                console.warn("API save fallback", error);
                this.backendStatus = "offline";
                if (this.config.allowLocalFallback === false) {
                    throw error;
                }
            }
        }

        await this.localProvider.save(database);
    }

    async reset() {
        await this.localProvider.reset();
    }

    async setMode(mode) {
        this.mode = mode;
        this.writeSetting("dataMode", mode);
        await this.initialize();
    }

    async setApiBaseUrl(apiBaseUrl) {
        this.apiBaseUrl = String(apiBaseUrl || "").trim().replace(/\/$/, "");
        this.writeSetting("apiBaseUrl", this.apiBaseUrl);
        this.apiClient = new ApiClient(this.apiBaseUrl);
        this.apiProvider = new ApiProvider(this.apiClient);
        await this.initialize();
    }

    async refreshCurrentUser(shouldThrow = true) {
        try {
            const sentToken = storedAuthToken();
            const response = await this.apiClient.me();
            adoptRenewedSession(sentToken, response?.token);
            this.currentUser = response?.user || null;
            // Session shape, not user data: whether this is an impersonation and
            // whether this account may start one. Read from the server on every
            // boot so the warning banner cannot be lost or faked client-side.
            this.impersonation = response?.impersonation?.active ? response.impersonation : null;
            this.canImpersonate = Boolean(response?.canImpersonate);
            return this.currentUser;
        } catch (error) {
            this.currentUser = null;
            this.impersonation = null;
            this.canImpersonate = false;
            if (shouldThrow) {
                throw error;
            }
            return null;
        }
    }

    requiresAuthentication() {
        return this.mode === "api" && this.config.requireAuth && !this.currentUser;
    }

    async importUserData(database, options = {}) {
        if (this.mode !== "api") {
            return null;
        }

        const payload = this.createUserImportPayload(database);
        const resources = [
            ["customExercises", payload.customExercises],
            ["bodyweightEntries", payload.bodyweightEntries],
            ["workouts", payload.workouts]
        ];
        const chunks = resources.flatMap(([resource, items]) => {
            return this.createImportChunks(resource, items, 62 * 1024);
        });
        const summary = {
            ok: true,
            resources: resources.map(([resource]) => resource),
            chunks: chunks.length,
            imported: {
                customExercises: 0,
                bodyweightEntries: 0,
                workouts: 0
            }
        };

        await this.apiClient.startImport(summary.resources);

        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
            const chunk = chunks[chunkIndex];
            const result = await this.apiClient.importChunk(chunk.resource, chunk.items, {
                index: chunkIndex + 1,
                total: chunks.length
            });
            summary.imported[chunk.resource] += result?.imported || 0;

            if (typeof options.onProgress === "function") {
                options.onProgress({
                    current: chunkIndex + 1,
                    total: chunks.length,
                    resource: chunk.resource,
                    items: chunk.items.length,
                    result
                });
            }

            if (!options.quiet) {
                await this.wait(90);
            }
        }

        const finished = await this.apiClient.finishImport(summary);
        return { ...summary, finished };
    }

    createUserImportPayload(database) {
        const currentUserId = this.currentUser?.id || database?.currentUserId || "";
        const exercises = Array.isArray(database?.exercises) ? database.exercises : [];
        const bodyweightEntries = Array.isArray(database?.bodyweightEntries) ? database.bodyweightEntries : [];
        const workouts = Array.isArray(database?.workouts) ? database.workouts : [];

        return {
            currentUserId,
            customExercises: exercises.filter((exercise) => exercise.isCustom && exercise.createdByUserId === currentUserId),
            bodyweightEntries: bodyweightEntries.filter((entry) => entry.userId === currentUserId),
            workouts: workouts.filter((workout) => workout.userId === currentUserId)
        };
    }

    createImportChunks(resource, items, maximumChunkBytes) {
        const chunks = [];
        let currentChunk = [];

        for (const item of items) {
            const nextChunk = [...currentChunk, item];
            const nextPayloadSize = this.getJsonByteSize({ resource, items: nextChunk });

            if (nextPayloadSize > maximumChunkBytes && currentChunk.length > 0) {
                chunks.push({ resource, items: currentChunk });
                currentChunk = [item];
                continue;
            }

            currentChunk = nextChunk;
        }

        if (currentChunk.length > 0) {
            chunks.push({ resource, items: currentChunk });
        }

        return chunks;
    }

    async importExerciseCatalog(payload, options = {}) {
        if (this.mode !== "api") {
            return null;
        }

        const exercises = this.extractExerciseCatalogRows(payload)
            .map((exercise) => this.sanitizeExerciseForApiImport(exercise))
            .filter((exercise) => exercise.name && exercise.originalName);

        const chunks = this.createExerciseImportChunks(exercises, 55 * 1024);
        const importSummary = {
            ok: true,
            received: exercises.length,
            chunks: chunks.length,
            imported: 0,
            skipped: 0,
            duplicates: 0,
            failed: 0,
            errors: []
        };

        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
            const chunk = chunks[chunkIndex];
            const payloadChunk = {
                exercises: chunk
            };

            const result = await this.apiClient.importExercises(payloadChunk);

            this.mergeExerciseImportResult(importSummary, result);

            if (typeof options.onProgress === "function") {
                options.onProgress({
                    current: chunkIndex + 1,
                    total: chunks.length,
                    exercises: chunk.length,
                    result
                });
            }

            await this.wait(120);
        }

        return importSummary;
    }

    async resetCuratedExercises() {
        if (this.mode !== "api") {
            return null;
        }

        return this.apiClient.resetCuratedExercises();
    }

    extractExerciseCatalogRows(payload) {
        if (Array.isArray(payload)) {
            return payload;
        }

        if (Array.isArray(payload?.exercises)) {
            return payload.exercises;
        }

        if (payload?.name || payload?.originalName) {
            return [payload];
        }

        return [];
    }

    sanitizeExerciseForApiImport(exercise) {
        const trimText = (value, maximumLength = 500) => {
            if (typeof value !== "string") {
                return "";
            }

            return value
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, maximumLength);
        };

        const trimStringArray = (value, maximumItems = 6, maximumLength = 160) => {
            if (!Array.isArray(value)) {
                return [];
            }

            return value
                .filter((item) => typeof item === "string")
                .map((item) => trimText(item, maximumLength))
                .filter(Boolean)
                .slice(0, maximumItems);
        };

        const stripSourcePrefix = (value) => {
            return trimText(value, 180)
                .replace(/^ExRx\.net\s*:\s*/i, "")
                .replace(/^ExRx\s*:\s*/i, "")
                .trim();
        };

        const name = stripSourcePrefix(exercise.name || exercise.originalName || "");
        const originalName = stripSourcePrefix(exercise.originalName || exercise.name || "");

        return {
            id: trimText(exercise.id, 140),
            sourceName: trimText(exercise.sourceName, 80) || "ExRx.net",
            sourceUrl: trimText(exercise.sourceUrl, 260),
            licenseStatus: trimText(exercise.licenseStatus, 80) || "permission_required",

            name: name || originalName,
            originalName: originalName || name,
            aliases: trimStringArray(exercise.aliases, 3, 120),

            primaryMuscleGroup: trimText(exercise.primaryMuscleGroup, 60) || "Full Body",
            secondaryMuscleGroups: trimStringArray(exercise.secondaryMuscleGroups, 4, 60),

            movementPattern: trimText(exercise.movementPattern, 60) || "Other",
            equipment: trimText(exercise.equipment, 60) || "Other",
            category: trimText(exercise.category, 80) || "Strength",
            difficulty: trimText(exercise.difficulty, 60) || "Intermediate",

            description: trimText(exercise.description, 500),
            techniqueSteps: trimStringArray(exercise.techniqueSteps, 5, 180),
            commonMistakes: trimStringArray(exercise.commonMistakes, 5, 160),
            safetyTips: trimStringArray(exercise.safetyTips, 5, 160),

            mediaUrl: "",
            mediaType: "none",
            mediaReferences: [],

            isCustom: false,
            createdByUserId: null
        };
    }

    createExerciseImportChunks(exercises, maximumChunkBytes) {
        const chunks = [];
        let currentChunk = [];

        for (const exercise of exercises) {
            const nextChunk = [...currentChunk, exercise];
            const nextPayloadSize = this.getJsonByteSize({
                exercises: nextChunk
            });

            if (nextPayloadSize > maximumChunkBytes && currentChunk.length > 0) {
                chunks.push(currentChunk);
                currentChunk = [exercise];
                continue;
            }

            currentChunk = nextChunk;
        }

        if (currentChunk.length > 0) {
            chunks.push(currentChunk);
        }

        return chunks;
    }

    getJsonByteSize(value) {
        return new Blob([JSON.stringify(value)]).size;
    }

    mergeExerciseImportResult(importSummary, result) {
        const readCounter = (value, nestedKey = "") => {
            if (typeof value === "number") {
                return value;
            }

            if (value && nestedKey && typeof value[nestedKey] === "number") {
                return value[nestedKey];
            }

            return 0;
        };

        importSummary.imported += readCounter(result?.imported, "catalogExercises");
        importSummary.skipped += readCounter(result?.skipped, "catalogExercises");
        importSummary.duplicates += readCounter(result?.duplicates);
        importSummary.failed += readCounter(result?.failed);

        if (Array.isArray(result?.errors)) {
            importSummary.errors.push(...result.errors.slice(0, 5));
        }
    }

    wait(milliseconds) {
        return new Promise((resolve) => {
            window.setTimeout(resolve, milliseconds);
        });
    }

    async checkBackend(shouldThrow = true) {
        try {
            this.apiClient = new ApiClient(this.apiBaseUrl);
            this.apiProvider = new ApiProvider(this.apiClient);
            await this.apiProvider.initialize();
            this.backendStatus = "online";
            return true;
        } catch (error) {
            this.backendStatus = "offline";
            if (shouldThrow) {
                throw error;
            }
            return false;
        }
    }

    loginWithGoogle() {
        if (!this.apiClient.hasBaseUrl()) {
            throw new Error("API base URL is not configured");
        }
        window.location.href = `${this.apiClient.baseUrl}/auth/google`;
    }

    async logout() {
        if (this.mode === "api" && this.apiClient.hasBaseUrl()) {
            await this.apiClient.logout();
        }
    }

    readSetting(key) {
        try {
            return localStorage.getItem(`gymos-setting-${key}`);
        } catch (error) {
            return "";
        }
    }

    writeSetting(key, value) {
        try {
            localStorage.setItem(`gymos-setting-${key}`, value);
        } catch (error) {
            console.warn("Settings storage unavailable", error);
        }
    }
}

export const storage = new DataService(window.FORGE_CONFIG || {});

export function captureAuthToken() {
    try {
        const fromHash = (window.location.hash || "").match(/[#&]token=([^&]+)/);
        const fromQuery = new URLSearchParams(window.location.search || "").get("token");
        const token = fromHash ? decodeURIComponent(fromHash[1]) : (fromQuery || "");
        if (token) {
            localStorage.setItem("gymos-auth-token", token);
            window.history.replaceState({}, document.title, window.location.origin + window.location.pathname);
        }
    } catch (error) {
        console.warn("Auth token capture failed", error);
    }
}
