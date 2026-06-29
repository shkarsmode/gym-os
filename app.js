import "./components/select.js";
import "./components/datepicker.js";
import { escapeHtml, number, dateInput, formatDate, shortDate, seconds, splitCsv, unique, imageUrl } from "./lib/format.js";
import { sectionItems, mobileSectionIds, rankedExerciseNames, rankOrder, statusLabels, setTypeLabels, workoutTypeLabels, genderLabels, dataModeLabels, muscles, patterns, equipment } from "./lib/constants.js";
import { APP_VERSION, CHANGELOG, changelogTagLabels } from "./lib/changelog.js";

(() => {
    "use strict";

    const templates = [
        ["push", "Push", "Базовий жим для грудей.", ["Жим лежачи"]],
        ["pull", "Pull", "Вертикальна тяга для спини.", ["Тяга верхнього блока"]],
        ["legs", "Legs", "Порожній шаблон для майбутніх вправ ніг.", []],
        ["upper", "Upper", "Компактна сесія верху з двох базових рухів.", ["Жим лежачи", "Тяга верхнього блока"]],
        ["lower", "Lower", "Порожній шаблон для власного плану.", []],
        ["full_body", "Full Body", "Мінімальна силова сесія з curated-каталогу.", ["Жим лежачи", "Тяга верхнього блока"]],
        ["cardio", "Cardio", "Кардіо можна вести окремим блоком у тренуванні.", []],
        ["custom", "Custom", "Порожній шаблон для власного плану.", []]
    ].map(([id, title, description, exerciseNames]) => ({ id, title, description, exerciseNames, type: id }));

    const state = {
        section: "dashboard",
        profileUserId: null,
        editingWorkoutId: null,
        viewUserId: null,
        authUser: null,
        database: null,
        charts: new Map(),
        calendar: null,
        filters: {
            exerciseSearch: "",
            activityScope: "mine",
            statsUserId: null, // null = current user; "all" = whole team; otherwise a user id
            statsRange: "all",
            statsMuscle: "all",
            statsExerciseId: "all",
            statsWorkoutType: "all",
            pickerMuscle: "all",
            pickerEquipment: "all",
            feedbackType: "feature"
        },
        timer: {
            id: null,
            duration: 90,
            remaining: 90,
            startedAt: 0,
            running: false,
            paused: false
        }
    };

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

            let authToken = "";
            try {
                authToken = localStorage.getItem("gymos-auth-token") || "";
            } catch (error) {
                authToken = "";
            }

            const response = await fetch(`${this.baseUrl}${path}`, {
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                    ...(options.headers || {})
                },
                ...options
            });

            const responseText = await response.text();
            const payload = responseText ? this.parseResponse(responseText) : null;

            if (!response.ok) {
                const message = Array.isArray(payload?.message) ? payload.message.join(" ") : payload?.message || payload?.error || response.statusText || `HTTP ${response.status}`;
                const error = new Error(message);
                error.status = response.status;
                error.payload = payload;
                throw error;
            }

            if (response.status === 204) {
                return null;
            }

            return payload;
        }

        parseResponse(responseText) {
            try {
                return JSON.parse(responseText);
            } catch (error) {
                return responseText;
            }
        }

        health() {
            return this.request("/health", { method: "GET" });
        }

        me() {
            return this.request("/auth/me", { method: "GET" });
        }

        logout() {
            return this.request("/auth/logout", { method: "POST" });
        }

        exportData() {
            return this.request("/export", { method: "GET" });
        }

        importData(database) {
            return this.request("/import", { method: "POST", body: JSON.stringify(database) });
        }

        startImport(resources) {
            return this.request("/import/start", { method: "POST", body: JSON.stringify({ resources }) });
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
            return this.apiClient.exportData();
        }

        async save(database) {
            return this.apiClient.importData(database);
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
                const response = await this.apiClient.me();
                this.currentUser = response?.user || null;
                return this.currentUser;
            } catch (error) {
                this.currentUser = null;
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

    const storage = new DataService(window.FORGE_CONFIG || {});

    document.addEventListener("DOMContentLoaded", initialize);

    function captureAuthToken() {
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

    async function initialize() {
        captureAuthToken();
        const overlay = showBusyOverlay({
            title: "Запускаємо GymOS",
            message: "Перевіряємо backend і сесію.",
            detail: "Дані доступні після авторизації Google.",
            progress: 15
        });
        try {
            await storage.initialize();
            bindEvents();
            applySidebarState();
            state.authUser = storage.currentUser;
            if (storage.requiresAuthentication()) {
                state.database = createEmptyDatabase();
                renderAuthGate();
                return;
            }
            if (requiresApproval()) {
                state.database = createEmptyDatabase();
                renderApprovalGate();
                return;
            }
            updateBusyOverlay(overlay, {
                message: "Завантажуємо тренування.",
                detail: "Каталог і історія приходять з backend.",
                progress: 60
            });
            state.database = await storage.load() || createSeedDatabase();
        } catch (error) {
            console.error(error);
            state.database = createEmptyDatabase();
            renderAuthGate(friendlyError(error));
            return;
        } finally {
            hideBusyOverlay(overlay);
        }
        if (!state.database.version || state.database.version < 3) {
            state.database = createSeedDatabase();
        }
        state.profileUserId = state.database.currentUserId;
        if (storage.mode !== "api") {
            await persist();
        }
        renderShell();
        handleRoute();
        requestAnimationFrame(maybeShowWhatsNew);
    }

    function createEmptyDatabase() {
        return { version: 3, currentUserId: "", users: [], exercises: [], bodyweightEntries: [], workouts: [], strengthStandards: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    }

    function createSeedDatabase() {
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

    function createExercises() {
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

    function mergeImportedExerciseCatalog(baseExercises, payload) {
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

    function techniqueFor(pattern) {
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

    function mistakesFor(pattern) {
        const data = {
            "Горизонтальний жим": ["Відбивання ваги", "Нестабільні плечі", "Нерівна амплітуда"],
            "Вертикальна тяга": ["Розгойдування", "Половинчасті повторення", "Тяга лише руками"],
            "Присідання": ["Поспішний спуск", "Відрив п'ят", "Завал колін всередину"],
            "Hinge": ["Перетворення руху на присідання", "Округлення спини під втомою", "Вага відходить далеко від тіла"],
            "Кардіо": ["Занадто різкий старт", "Пропуск розминки", "Відсутність інтенсивності в логах"]
        };
        return data[pattern] || ["Зайва інерція", "Завелика вага", "Втрата контролю на втомі"];
    }

    function safetyFor(pattern) {
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

    function createStandards(exercises) {
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

    function createSet(type, weight, repetitions, rpe, restSeconds, isCompleted) {
        return { id: createId("set"), type, weight, repetitions, rpe, restSeconds, isCompleted, notes: "" };
    }

    function createCardio(index) {
        return { id: createId("cardio"), type: index % 2 ? "bike" : "treadmill", durationMinutes: 18 + index % 5 * 4, distance: round(2 + index % 4 * 0.7, 1), calories: 140 + index % 5 * 28, averageHeartRate: 125 + index % 4 * 8, intensity: ["low", "medium", "high"][index % 3], notes: "Контрольований кардіо-блок" };
    }

    function renderShell() {
        renderNavigation("sidebarNavigation", sectionItems.filter((item) => item.id !== "admin" || isAdmin()));
        renderMobileNavigation();
        renderCurrentUserButton();
        renderSidebarProfile();
        icons(); // one pass converts sidebar nav + mobile nav + profile icons
    }

    // Mobile bottom bar: "Тренування" sits in the centre as an elevated accent
    // button (pulses while a workout is active); the rest are icon+label tabs.
    function renderMobileNavigation() {
        const container = element("mobileNavigation");
        const activeWorkout = activeWorkoutFor(currentUser().id);
        const order = ["dashboard", "calendar", "workout", "stats", "profile"];
        const mobileLabels = { workout: "Тренування" };
        container.innerHTML = order.map((id) => {
            const item = sectionItems.find((section) => section.id === id);
            if (!item) {
                return "";
            }
            const active = state.section === id ? "active" : "";
            const label = escapeHtml(mobileLabels[id] || item.title);
            if (id === "workout") {
                return `<button class="mnav-center ${active}" type="button" data-action="navigate" data-section="workout" aria-label="${escapeHtml(item.title)}">
                    <span class="mnav-center-btn"><i data-lucide="${item.icon}"></i>${activeWorkout ? `<span class="mnav-pulse" aria-hidden="true"></span>` : ""}</span>
                    <span class="mnav-label">${label}</span>
                </button>`;
            }
            return `<button class="mnav-item ${active}" type="button" data-action="navigate" data-section="${id}" aria-label="${escapeHtml(item.title)}">
                <span class="mnav-ico"><i data-lucide="${item.icon}"></i></span>
                <span class="mnav-label">${label}</span>
            </button>`;
        }).join("");
    }

    function renderAuthGate(message = "") {
        element("sidebarNavigation").innerHTML = "";
        element("mobileNavigation").innerHTML = "";
        element("sidebarProfileCard").innerHTML = `<div class="profile-meta">Потрібна авторизація Google</div>`;
        element("openUserSwitcherButton").innerHTML = "GO";
        element("sectionEyebrow").textContent = "Авторизація";
        element("sectionTitle").textContent = "GymOS";
        element("pageContent").innerHTML = `
            <section class="empty-state auth-gate">
                <i data-lucide="shield-check"></i>
                <h2>Увійди через Google</h2>
                <p>GymOS працює через backend API. Дані тренувань доступні тільки після авторизації.</p>
                ${message ? `<p class="card-caption">${escapeHtml(message)}</p>` : ""}
                <div class="action-row auth-gate-actions" style="justify-content:center;margin-top:16px;">
                    <button class="button button-primary large-workout-button" type="button" data-action="login-google"><svg class="google-g" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" focusable="false"><path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/><path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/><path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/><path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/></svg>Увійти через Google</button>
                    <button class="button button-secondary large-workout-button" type="button" data-action="check-backend"><i data-lucide="server"></i>Перевірити backend</button>
                </div>
                <p class="profile-meta" style="margin-top:14px;">Backend: ${escapeHtml(storage.apiBaseUrl || "не налаштовано")} · статус: ${backendStatusLabel(storage.backendStatus)}</p>
            </section>
        `;
        icons();
    }

    function requiresApproval() {
        if (!(storage.mode === "api" && storage.config.requireAuth)) {
            return false;
        }
        const user = storage.currentUser;
        if (!user || isAdmin()) {
            return false;
        }
        return user.approved === false;
    }

    function renderApprovalGate() {
        const user = storage.currentUser || {};
        element("sidebarNavigation").innerHTML = "";
        element("mobileNavigation").innerHTML = "";
        element("sidebarProfileCard").innerHTML = `<div class="profile-meta">Очікування підтвердження</div>`;
        element("openUserSwitcherButton").innerHTML = "GO";
        element("sectionEyebrow").textContent = "Доступ";
        element("sectionTitle").textContent = "GymOS";
        element("pageContent").innerHTML = `
            <section class="empty-state auth-gate">
                <i data-lucide="hourglass"></i>
                <h2>Очікуйте підтвердження адміністратора</h2>
                <p>Ваш акаунт${user.email ? ` (${escapeHtml(user.email)})` : ""} зареєстровано. Доступ до GymOS відкриється після підтвердження адміністратором.</p>
                <div class="action-row" style="justify-content:center;margin-top:16px;">
                    <button class="button button-primary large-workout-button" type="button" data-action="recheck-approval"><i data-lucide="refresh-cw"></i>Перевірити ще раз</button>
                    <button class="button button-secondary large-workout-button" type="button" data-action="logout"><i data-lucide="log-out"></i>Вийти</button>
                </div>
            </section>
        `;
        icons();
    }

    async function recheckApproval() {
        await storage.refreshCurrentUser(false);
        state.authUser = storage.currentUser;
        if (storage.requiresAuthentication()) {
            renderAuthGate();
            return;
        }
        if (requiresApproval()) {
            renderApprovalGate();
            toast("Ще не підтверджено", "Адміністратор поки не підтвердив доступ.");
            return;
        }
        state.database = await storage.load() || createSeedDatabase();
        state.profileUserId = state.database.currentUserId;
        renderShell();
        handleRoute();
        toast("Доступ відкрито", "Ласкаво просимо до GymOS!");
    }

    function renderNavigation(containerId, items) {
        const activeWorkout = activeWorkoutFor(currentUser().id);
        const newFb = isAdmin() ? newFeedbackCount() : 0;
        const container = element(containerId);
        container.innerHTML = items.map((item) => {
            let badge = "";
            if (item.id === "workout" && activeWorkout) {
                badge = `<strong class="nav-badge">Активне</strong>`;
            } else if (item.id === "feedback" && newFb > 0) {
                badge = `<strong class="nav-badge">${newFb}</strong>`;
            }
            return `
            <button class="nav-button ${state.section === item.id ? "active" : ""}" type="button" data-action="navigate" data-section="${item.id}" title="${escapeHtml(item.title)}">
                <span><i data-lucide="${item.icon}"></i><span class="nav-label">${escapeHtml(item.title)}</span></span>
                ${badge}
            </button>`;
        }).join("");
    }

    function renderCurrentUserButton() {
        const user = currentUser();
        const button = element("openUserSwitcherButton");
        const url = imageUrl(user.avatarUrl);
        button.style.background = user.avatarColor;
        button.innerHTML = `${escapeHtml(user.avatarInitials)}${url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(user.displayName || "")}" referrerpolicy="no-referrer" decoding="async" onerror="this.remove()">` : ""}`;
    }

    function renderSidebarProfile() {
        const user = currentUser();
        const stats = userStats(user.id);
        element("sidebarProfileCard").innerHTML = `
            <div class="profile-row">
                ${avatar(user, "small")}
                <div>
                    <div class="profile-name">${escapeHtml(user.displayName)}</div>
                    <div class="profile-meta">${stats.completedWorkouts} тренувань · ${number(stats.totalVolume)} кг${infoTip("Загальний підсумок", "Загальний підсумок твоєї активності. Показує кількість проведених тренувань та сумарну вагу, яку ти підняв за весь час. Допомагає бачити глобальний масштаб твоєї роботи та мотивує не зупинятися.")}</div>
                </div>
            </div>
            <div class="progress-track" style="margin-top: 14px;"><div class="progress-fill" style="width: ${Math.min(100, stats.completedWorkouts * 5)}%;"></div></div>
            <div class="profile-meta" style="margin-top: 8px;">Поточний рівень: ${escapeHtml(mainRank(user.id))}</div>
            ${hasUnlimited()
                ? `<div class="sidebar-role" style="margin-top: 10px;">${roleStatusBadge(user)}</div>`
                : `<button class="button button-primary compact sidebar-upgrade" type="button" data-action="navigate" data-section="subscription"><i data-lucide="rocket"></i>Апгрейд до PRO</button>`}
        `;
    }

    let pendingExerciseScrollId = null;

    function renderSection() {
        destroyCharts();
        if (state.section === "admin" && !isAdmin()) {
            state.section = "dashboard";
        }
        renderShell();
        const item = sectionItems.find((section) => section.id === state.section) || sectionItems[0];
        element("sectionEyebrow").textContent = "Gym Progress OS";
        if (state.section === "user") {
            const viewedUser = userById(state.viewUserId);
            element("sectionTitle").textContent = viewedUser ? viewedUser.displayName : "Користувач";
        } else {
            element("sectionTitle").textContent = item.title;
        }
        const renderers = { dashboard, workout, calendar, exercises, stats, rankings, users, feedback, admin: adminPanel, subscription, changelog, profile, settings, user: () => userDetail(state.viewUserId) };
        (renderers[state.section] || dashboard)();
        iconsIn(element("pageContent")); // shell icons already converted in renderShell()
        // Subtle enter animation only when the section actually changes (not on
        // in-place data re-renders), so navigation feels smooth, edits don't flash.
        if (renderSection.lastSection !== state.section) {
            renderSection.lastSection = state.section;
            const pageEl = element("pageContent");
            pageEl.classList.remove("page-enter");
            void pageEl.offsetWidth;
            pageEl.classList.add("page-enter");
            // Start each new tab at the top so the enter animation reads cleanly
            // (skip when we're about to scroll to a freshly added exercise).
            if (!pendingExerciseScrollId) {
                window.scrollTo(0, 0);
            }
        }
        updateTopbarOffset();
        requestAnimationFrame(updateTopbarOffset);

        if (pendingExerciseScrollId) {
            const targetId = pendingExerciseScrollId;
            pendingExerciseScrollId = null;
            requestAnimationFrame(() => {
                const target = document.querySelector(`[data-workout-exercise-id="${targetId}"]`);
                if (target) {
                    target.scrollIntoView({ behavior: "smooth", block: "center" });
                }
            });
        }
    }

    // Plain-language explanations for every dashboard metric — "що це / що означає
    // число / навіщо це мені". Surfaced via the info tooltips (see infoTip).
    const dashboardTips = {
        volume: "Сумарний робочий обсяг (тоннаж). Це загальна вага, яку ти підняв за поточний тиждень (вага × повторення × підходи). Головний маркер прогресивного навантаження: якщо обсяг стабільно зростає без шкоди для техніки, твої м'язи стають сильнішими та адаптуються до навантажень.",
        cardio: "Час кардіонавантажень. Сумарний час у хвилинах, присвячений витривалості та здоров'ю серцево-судинної системи за поточний тиждень. Корисно для відстеження балансу між силовими тренуваннями та кардіо для відновлення або спалювання калорій.",
        volumeChart: "Розподіл навантаження за днями тижня. Показує, в які дні ти виклався на максимум, а коли відпочивав. Допомагає аналізувати періодизацію тренувань та уникати перетренованості.",
        muscleChart: "Аналітика м'язових груп. Показує відсоткове співвідношення підходів на різні частини тіла (груди, плечі, трицепс тощо). Допомагає контролювати баланс розвитку тіла, щоб уникати м'язових дисбалансів та рівномірно навантажувати всі цільові групи.",
        ops: "Швидка статистика поточної активності. «Завершено» — кількість тренувань, «Серія» — кількість днів регулярних тренувань поспіль (твій страйк), «Підходи» — сумарна кількість виконаних робочих серій. Тримай страйк, щоб будувати звичку!",
        pr: "Твій особистий рекорд (Personal Record). Розрахунковий максимум на 1 повторення (1ПМ) на основі твоїх останніх важких підходів. Головний показник твого пікового силового потенціалу в конкретній вправі.",
        team: "Спільний прогрес твого спортивного ком'юніті. Сума тренувань та кілограмів, піднятих усіма учасниками твоєї групи. Мотивує змагальним духом та показує силу командної роботи."
    };

    // The Панель is a lean control hub: at-a-glance status, the primary start CTA,
    // quick links to every section (the only way to reach Вправи / Рейтинги /
    // Команда on mobile, where the bottom bar has no room), and recent activity.
    // Deep stats + charts now live in the Статистика tab.
    function dashboard() {
        const user = currentUser();
        const stats = userStats(user.id);
        const active = activeWorkoutFor(user.id);
        content(`
            <div class="grid dashboard-grid">
                ${metric("Сьогодні", todayLabel(user.id), "calendar-check", todayCaption(user.id), "span-3")}
                ${metric("Поточне тренування", active?.title || "Немає активного", "activity", active ? "Триває зараз" : "Можна почати нове", "span-3")}
                ${metric("Серія", `${stats.trainingStreak} дн.`, "flame", "Тренувань поспіль", "span-3")}
                ${metric("Обсяг за тиждень", `${number(stats.weekVolume)} кг`, "boxes", `${stats.weekSets} підходів цього тижня`, "span-3", dashboardTips.volume)}
                <section class="card span-12 dash-quickstart">
                    <div class="card-header">
                        <div>
                            <h2>Швидкий старт</h2>
                            <p class="card-caption">${active ? "У тебе є активне тренування — продовж або відкрий календар." : "Почни нову сесію або переглянь історію в календарі."}</p>
                        </div>
                    </div>
                    <div class="action-row wrap">
                        <button class="button button-primary large-workout-button" type="button" data-action="${active ? "edit-workout" : "start-workout"}"${active ? ` data-workout-id="${active.id}"` : ""}><i data-lucide="${active ? "activity" : "play"}"></i>${active ? "Продовжити тренування" : "Почати тренування"}</button>
                        <button class="button button-secondary large-workout-button" type="button" data-action="navigate" data-section="calendar"><i data-lucide="calendar-days"></i>Перейти до календаря</button>
                    </div>
                </section>
                ${navHub()}
                <section class="card span-12"><div class="card-header"><div><h2>Історія тренувань</h2><p class="card-caption">${state.filters.activityScope === "all" ? "Спільна стрічка команди — чужі лише для перегляду." : "Твої завершені тренування."}</p></div><div class="activity-toolbar"><div class="segmented">${[["mine", "Мої"], ["all", "Усі"]].map(([value, label]) => `<button class="segment-button ${(state.filters.activityScope === "all" ? "all" : "mine") === value ? "active" : ""}" type="button" data-action="activity-scope" data-scope="${value}">${label}</button>`).join("")}</div><button class="button button-secondary compact" type="button" data-action="navigate" data-section="rankings"><i data-lucide="trophy"></i>Рейтинги</button></div></div><div class="activity-feed">${activityFeed()}</div></section>
            </div>
        `);
    }

    // Quick-access grid of every section — laconic icon cards. Essential on mobile,
    // where the bottom bar only holds 5 tabs.
    function navHub() {
        const newFb = newFeedbackCount();
        const links = [
            { id: "exercises", title: "Вправи", caption: "Каталог і власні вправи", icon: "list-filter" },
            { id: "stats", title: "Статистика", caption: "Графіки та прогрес", icon: "bar-chart-3" },
            { id: "rankings", title: "Рейтинги", caption: "Командний лідерборд", icon: "trophy" },
            { id: "users", title: "Команда", caption: "Учасники та активність", icon: "users" },
            { id: "feedback", title: "Ідеї", caption: "Запити та фікси спільноти", icon: "lightbulb", badge: isAdmin() && newFb > 0 ? newFb : 0 },
            { id: "calendar", title: "Календар", caption: "Історія тренувань", icon: "calendar-days" }
        ];
        if (isAdmin()) {
            links.push({ id: "admin", title: "Адмін", caption: "Модерація і доступи", icon: "shield" });
        } else if (!hasUnlimited()) {
            links.push({ id: "subscription", title: "GymOS PRO", caption: "Безліміт за $2/міс", icon: "gem", accent: true });
        }
        return `<section class="card span-12 nav-hub-card"><div class="card-header"><div><h2>Розділи</h2><p class="card-caption">Швидкий доступ до всіх інструментів GymOS.</p></div></div><div class="nav-hub">${links.map((link) => `<button class="nav-hub-item${link.accent ? " accent" : ""}" type="button" data-action="navigate" data-section="${link.id}"><span class="nav-hub-icon"><i data-lucide="${link.icon}"></i></span><span class="nav-hub-text"><strong>${escapeHtml(link.title)}</strong><span>${escapeHtml(link.caption)}</span></span>${link.badge ? `<span class="nav-hub-badge">${link.badge}</span>` : `<i class="nav-hub-arrow" data-lucide="chevron-right"></i>`}</button>`).join("")}</div></section>`;
    }

    function workout() {
        const workoutItem = editWorkout();
        content(`<div class="workout-stack">${workoutItem ? workoutEditor(workoutItem) : workoutStarter()}</div>`);
    }

    function workoutStarter() {
        return `<section class="card workout-starter"><div class="workout-starter-icon"><i data-lucide="dumbbell"></i></div><h2>Немає активного тренування</h2><p class="card-caption">Почни нову сесію та додавай вправи, підходи й кардіо прямо в залі. Усе можна відредагувати або видалити пізніше.</p><div class="workout-starter-actions"><button class="button button-primary large-workout-button" type="button" data-action="start-workout"><i data-lucide="play"></i>Почати тренування</button><button class="button button-secondary large-workout-button" type="button" data-action="navigate" data-section="calendar"><i data-lucide="calendar-days"></i>Історія тренувань</button></div></section>`;
    }

    function workoutEditor(workoutItem) {
        const owner = userById(workoutItem.userId);
        const readonly = !canManage(workoutItem);
        const completedSets = workoutItem.exercises.flatMap((item) => item.sets).filter((set) => set.isCompleted).length;
        const active = activeWorkoutFor(currentUser().id);
        const isOtherThanActive = !readonly && active && active.id !== workoutItem.id;
        const contextBanner = !readonly && workoutItem.status !== "active"
            ? `<div class="readonly-layer info">Ви редагуєте ${statusLabel(workoutItem.status).toLowerCase()} тренування. Зміни зберігаються автоматично.${active ? ` <button class="link-button" type="button" data-action="edit-workout" data-workout-id="${active.id}">Перейти до активного</button>` : ""}</div>`
            : isOtherThanActive ? `<div class="readonly-layer info">У вас є активне тренування. <button class="link-button" type="button" data-action="edit-workout" data-workout-id="${active.id}">Відкрити активне</button></div>` : "";
        const actionBar = readonly ? "" : `<div class="workout-actionbar">
                <div class="workout-actionbar-info"><span class="status-badge ${workoutItem.status}">${statusLabel(workoutItem.status)}</span><strong class="workout-actionbar-title">${escapeHtml(workoutLabel(workoutItem))}</strong></div>
                <div class="workout-actionbar-actions"><button class="button button-secondary compact" type="button" data-action="open-add-exercise-modal"><i data-lucide="plus"></i><span>Вправа</span></button>${workoutItem.status === "active" ? `<button class="button button-primary compact" type="button" data-action="finish-workout" data-workout-id="${workoutItem.id}"><i data-lucide="flag"></i><span>Завершити</span></button>` : `<button class="button button-primary compact" type="button" data-action="reopen-workout" data-workout-id="${workoutItem.id}"><i data-lucide="rotate-ccw"></i><span>Відновити</span></button>`}</div>
            </div>`;
        return `
            ${actionBar}
            <section class="card workout-head">
                <div class="card-header">
                    <div style="flex:1;min-width:0;"><div class="tag-row" style="margin-bottom:10px;"><span class="status-badge ${workoutItem.status}">${statusLabel(workoutItem.status)}</span>${readonly ? `<span class="status-badge readonly">Лише перегляд</span>` : ""}<button class="chip chip-button" type="button" data-action="open-user" data-user-id="${owner.id}">${escapeHtml(owner.displayName)}</button></div><h2>${escapeHtml(workoutLabel(workoutItem))}</h2><p class="card-caption">${formatDate(workoutItem.date)} · ${duration(workoutItem)} хв · ${number(workoutVolume(workoutItem))} кг${readonly ? "" : ` · ${completedSets} завершених підходів`}</p></div>
                </div>
                ${contextBanner}
                ${readonly ? "" : `<div class="field-grid" style="margin-top:14px;"><div class="field"><label>Дата</label><gym-date value="${escapeHtml(workoutItem.date)}" data-action="edit-workout-meta" data-field="date" data-workout-id="${workoutItem.id}"></gym-date></div><div class="field"><label>Тип</label><gym-select data-action="edit-workout-meta" data-field="workoutType" data-workout-id="${workoutItem.id}">${Object.entries(workoutTypeLabels).map(([value, label]) => `<option value="${value}" ${workoutItem.workoutType === value ? "selected" : ""}>${label}</option>`).join("")}</gym-select></div></div>`}
                ${readonly ? "" : `<div class="action-row wrap" style="margin-top:14px;"><button class="button button-danger compact" type="button" data-action="delete-workout" data-workout-id="${workoutItem.id}"><i data-lucide="trash-2"></i>Видалити тренування</button></div>`}
                <div class="field" style="margin-top:14px;"><label>Нотатки тренування</label><textarea data-action="update-workout-notes" placeholder="Що важливо запам'ятати про цю сесію" ${readonly ? "disabled" : ""}>${escapeHtml(workoutItem.notes || "")}</textarea></div>
            </section>
            ${workoutItem.exercises.length ? workoutItem.exercises.sort((left, right) => left.order - right.order).map((item) => workoutExerciseEditor(workoutItem, item, readonly)).join("") : emptyInline("Вправ ще немає", "Натисни «Вправа», щоб зібрати сесію.")}
            ${cardioBlock(workoutItem, readonly)}
        `;
    }

    function cardioBlock(workoutItem, readonly) {
        const sessions = workoutItem.cardioSessions || [];
        return `<section class="card"><div class="card-header"><div><h2>Кардіо</h2><p class="card-caption">Бігова доріжка, велотренажер та інше. Вкажи час і деталі.</p></div><button class="button button-secondary compact" type="button" data-action="open-cardio-modal" data-workout-id="${workoutItem.id}" ${readonly ? "disabled" : ""}><i data-lucide="plus"></i>Додати кардіо</button></div>${sessions.length ? `<div class="cardio-list">${sessions.map((session) => `<div class="cardio-row"><div class="cardio-icon"><i data-lucide="${cardioIcon(session.type)}"></i></div><div style="flex:1;min-width:0;"><strong>${cardioTypeLabel(session.type)} · ${session.durationMinutes} хв</strong><p class="card-caption">${[session.distance ? `${session.distance} км` : "", session.calories ? `${session.calories} ккал` : "", session.averageHeartRate ? `${session.averageHeartRate} уд/хв` : "", session.intensity ? intensityLabel(session.intensity) : ""].filter(Boolean).join(" · ") || "Без деталей"}</p></div>${readonly ? "" : `<div class="inline-actions"><button class="icon-button" type="button" title="Редагувати" data-action="open-cardio-modal" data-workout-id="${workoutItem.id}" data-cardio-id="${session.id}"><i data-lucide="pen-line"></i></button><button class="icon-button" type="button" title="Видалити" data-action="delete-cardio" data-workout-id="${workoutItem.id}" data-cardio-id="${session.id}"><i data-lucide="trash-2"></i></button></div>`}</div>`).join("")}</div>` : `<p class="card-caption">У цьому тренуванні ще немає кардіо-блоків.</p>`}</section>`;
    }

    function workoutExerciseEditor(workoutItem, workoutExercise, readonly) {
        const exercise = exerciseById(workoutExercise.exerciseId);
        const lastSets = lastExerciseSets(workoutItem.userId, workoutExercise.exerciseId, workoutItem.id);
        const lastNote = lastExerciseNote(workoutItem.userId, workoutExercise.exerciseId, workoutItem.id);
        const lastResults = lastSets && lastSets.sets.length
            ? `<div class="last-results"><span class="last-results-label"><i data-lucide="history"></i>Минулого разу · ${formatDate(lastSets.date)}</span><div class="last-results-chips">${lastSets.sets.map((set) => `<span class="chip">${number(set.weight)}×${set.repetitions}</span>`).join("")}</div></div>`
            : "";
        const previousNote = lastNote
            ? `<div class="previous-note"><span class="previous-note-label"><i data-lucide="sticky-note"></i>Остання нотатка · ${formatDate(lastNote.date)}</span><p>${escapeHtml(lastNote.notes)}</p></div>`
            : "";
        return `<article class="workout-exercise" data-workout-exercise-id="${workoutExercise.id}"><div class="exercise-header"><div><div class="exercise-title-line"><h3>${escapeHtml(exercise.name)}</h3><span class="chip">${exercise.primaryMuscleGroup}</span></div><p class="card-caption">${number(exerciseVolume(workoutExercise))} кг обсягу · 1ПМ ${number(exerciseOneRepMax(workoutExercise))} кг</p></div><div class="inline-actions"><button class="icon-button" type="button" title="Техніка" data-action="open-exercise" data-exercise-id="${exercise.id}"><i data-lucide="book-open"></i></button><button class="icon-button" type="button" title="Додати підхід" data-action="add-set" data-workout-exercise-id="${workoutExercise.id}" ${readonly ? "disabled" : ""}><i data-lucide="plus"></i></button><button class="icon-button" type="button" title="Видалити вправу" data-action="remove-workout-exercise" data-workout-exercise-id="${workoutExercise.id}" ${readonly ? "disabled" : ""}><i data-lucide="trash-2"></i></button></div></div>${lastResults}<div class="set-list">${workoutExercise.sets.length ? workoutExercise.sets.map((set, index) => setRow(workoutExercise.id, set, readonly, index + 1)).join("") : `<p class="card-caption set-empty">Підходів ще немає. Додай перший кнопкою «+» вище.</p>`}</div><div class="field" style="margin-top:14px;"><label>Нотатки до вправи</label>${previousNote}<textarea data-action="update-exercise-notes" data-workout-exercise-id="${workoutExercise.id}" placeholder="Нова нотатка до вправи (необов'язково)" ${readonly ? "disabled" : ""}>${escapeHtml(workoutExercise.notes || "")}</textarea></div></article>`;
    }

    function setRow(workoutExerciseId, set, readonly, index) {
        const target = `data-workout-exercise-id="${workoutExerciseId}" data-set-id="${set.id}"`;
        const lock = readonly ? "disabled" : "";
        return `<div class="set-row ${set.isCompleted ? "completed" : ""}">
            <div class="set-row-head">
                <span class="set-index">${index}</span>
                <gym-select class="set-type-select" data-action="set-field" ${target} data-field="type" ${lock}>${["warmup", "working", "drop", "failure", "backoff"].map((type) => `<option value="${type}" ${set.type === type ? "selected" : ""}>${setTypeLabel(type)}</option>`).join("")}</gym-select>
                <div class="set-row-actions">
                    <button class="icon-button set-done ${set.isCompleted ? "is-done" : ""}" type="button" title="${set.isCompleted ? "Виконано" : "Позначити виконаним"}" data-action="toggle-set" ${target} ${lock}><i data-lucide="${set.isCompleted ? "check-circle-2" : "circle"}"></i></button>
                    <button class="icon-button" type="button" title="Видалити підхід" data-action="delete-set" ${target} ${lock}><i data-lucide="trash-2"></i></button>
                </div>
            </div>
            <div class="set-fields">
                <label class="set-field"><span class="set-field-label">Вага, кг</span><input type="number" inputmode="decimal" step="0.5" min="0" value="${set.weight}" data-action="set-field" ${target} data-field="weight" ${lock}></label>
                <label class="set-field"><span class="set-field-label">Повтори</span><input type="number" inputmode="numeric" step="1" min="0" value="${set.repetitions}" data-action="set-field" ${target} data-field="repetitions" ${lock}></label>
                <label class="set-field"><span class="set-field-label">Відпочинок, с</span><input type="number" inputmode="numeric" step="15" min="0" value="${set.restSeconds}" data-action="set-field" ${target} data-field="restSeconds" ${lock}></label>
            </div>
        </div>`;
    }

    function calendar() {
        const overview = calendarOverview();
        const history = workoutsFor(currentUser().id).sort(byDateDesc).slice(0, 8);
        content(`<div class="grid dashboard-grid">${metric("Цього тижня", overview.weekWorkouts, "calendar-check", "Тренувань", "span-3")}${metric("Завершено", overview.weekCompleted, "check-circle-2", "За поточний тиждень", "span-3")}${metric("Цього місяця", overview.monthWorkouts, "calendar-range", "Усі тренування", "span-3")}${metric("Серія", `${overview.streak} дн.`, "flame", "Завершені тренування поспіль", "span-3")}<section class="calendar-shell span-8"><div class="card-header" style="margin-bottom:16px;"><div><div class="title-with-badge"><h2>Календар</h2>${roleStatusBadge(currentUser())}</div><p class="card-caption">Натисни день, щоб побачити тренування і керувати ними.</p></div><button class="button button-primary compact" type="button" data-action="start-workout"><i data-lucide="play"></i>Почати тренування</button></div><div id="calendarContainer"></div><div class="legend-list inline"><span><i class="legend-dot active"></i>Активне</span><span><i class="legend-dot completed"></i>Завершено</span><span><i class="legend-dot planned"></i>Інше</span></div></section><section class="card span-4"><h2>Огляд</h2>${kpi([{ label: "Тиждень", value: overview.weekWorkouts }, { label: "Місяць", value: overview.monthWorkouts }, { label: "Кардіо дні", value: overview.cardioDays }, { label: "Усього", value: workoutsFor(currentUser().id).length }])}</section><section class="card span-12"><div class="card-header"><div><h2>Останні тренування</h2><p class="card-caption">Натисни, щоб відкрити й керувати.</p></div></div><div class="activity-feed">${workoutHistoryList(history)}</div></section></div>`);
        requestAnimationFrame(renderCalendar);
    }

    function exercises() {
        content(`<section class="card"><div class="card-header"><div><h2>Каталог вправ</h2><p class="card-caption">Пошук працює за назвою, alias, м'язовою групою, патерном руху та обладнанням.</p></div><button class="button button-primary compact" type="button" data-action="open-custom-exercise"><i data-lucide="plus"></i>Власна вправа</button></div><div class="filter-row"><input type="search" placeholder="Пошук за назвою, alias, м'язом, патерном або обладнанням" value="${escapeHtml(state.filters.exerciseSearch)}" data-action="exercise-search"></div></section><section class="exercise-card-grid" id="exerciseCatalogGrid" style="margin-top:16px;">${exerciseCatalogCards()}</section>`);
    }

    function exerciseCatalogCards() {
        const items = filteredExercises();
        return items.length ? items.map(exerciseCard).join("") : emptyInline("Нічого не знайдено", "Спробуй іншу назву, м'язову групу або обладнання.");
    }

    function stats() {
        const scopeId = state.filters.statsUserId;
        const userId = scopeId === "all" ? null : (scopeId || currentUser().id);
        const summary = userId ? userStats(userId, true) : teamStats(true);
        const history = filteredWorkouts(userId ? workoutsFor(userId) : state.database.workouts).sort(byDateDesc).slice(0, 8);
        const scopeName = userId ? (userId === currentUser().id ? "Твій прогрес" : escapeHtml(userById(userId).displayName)) : "Уся команда";
        content(`<section class="card stats-head"><div class="card-header"><div><h2>Статистика</h2><p class="card-caption">${scopeName} · за весь час. Обери учасника нижче або «Усі» для команди.</p></div></div>${statsUserBar(userId)}</section><div class="grid dashboard-grid" style="margin-top:16px;">${metric("Усього тренувань", summary.totalWorkouts, "calendar", "Усі статуси", "span-3")}${metric("Завершено", summary.completedWorkouts, "check-circle-2", "Фінішовані сесії", "span-3")}${metric("Підходи", summary.totalSets, "list-checks", `${summary.workingSets || 0} робочих`, "span-3")}${metric("Загальний обсяг", `${number(summary.totalVolume)} кг`, "boxes", "Завершені підходи", "span-3")}${metric("Середня тривалість", `${summary.averageDurationMinutes || 0} хв`, "timer", "Завершені тренування", "span-3")}${metric("Кардіо хвилини", summary.cardioMinutes || 0, "heart-pulse", `${summary.cardioDistance || 0} км`, "span-3")}${metric("Найчастіша вправа", summary.mostUsedExercise?.name || "—", "repeat", "Частота вправ", "span-3")}${metric("Найсильніший фокус", summary.mostTrainedMuscleGroup || "—", "target", "За завершеними підходами", "span-3")}${chartCard("Обсяг у часі", "Завершений обсяг за сесіями.", "statsVolume", "span-6")}${chartCard("Підходи за м'язами", "Розподіл завершених підходів.", "statsMuscle", "span-6")}${chartCard("Прогрес вправи", "Тренд розрахункового 1ПМ.", "statsProgress", "span-6")}${chartCard("Регулярність", "Кількість вправ у сесії.", "statsConsistency", "span-6")}${contributorCard()}<section class="card span-12"><div class="card-header"><div><h2>Історія</h2><p class="card-caption">${userId ? "Тренування обраного учасника." : "Спільна стрічка команди."}</p></div></div><div class="activity-feed">${workoutHistoryList(history)}</div></section></div>`);
        requestAnimationFrame(() => {
            volumeChart("statsVolume", userId);
            muscleDistributionChart("statsMuscle", userId);
            progressChart("statsProgress", userId || currentUser().id);
            consistencyChart("statsConsistency", userId);
        });
    }

    // The only stats filter: a scrollable row of avatar chips — «Усі» (team) plus
    // every member (you first, labelled «Я»). Replaces the old 5-select filter bar.
    function statsUserBar(activeUserId) {
        const me = currentUser().id;
        const members = [...state.database.users].sort((left, right) => (right.id === me ? 1 : 0) - (left.id === me ? 1 : 0));
        const allChip = `<button class="stat-userchip all${activeUserId === null ? " active" : ""}" type="button" data-action="stats-user" data-user-id="all"><span class="stat-userchip-all"><i data-lucide="users"></i></span><span class="stat-userchip-name">Усі</span></button>`;
        const memberChips = members.map((member) => `<button class="stat-userchip${member.id === activeUserId ? " active" : ""}" type="button" data-action="stats-user" data-user-id="${member.id}">${avatar(member, "tiny")}<span class="stat-userchip-name">${escapeHtml(member.id === me ? "Я" : member.displayName)}</span></button>`).join("");
        return `<div class="stat-userbar">${allChip}${memberChips}</div>`;
    }

    function rankings() {
        content(`<section class="card"><div class="card-header"><div><h2>Командний рейтинг</h2><p class="card-caption">За регулярністю, обсягом і найкращим підйомом. Натисни на учасника, щоб відкрити його тренування.</p></div></div><div class="table-wrap"><table><thead><tr><th>Користувач</th><th>Завершено</th><th>Обсяг</th><th>Найкращий підйом</th><th>Бал</th></tr></thead><tbody>${leaderboard().map((row, index) => `<tr class="row-link" data-action="open-user" data-user-id="${row.user.id}"><td><div class="list-row">${avatar(row.user, "tiny")}<strong>${index + 1}. ${escapeHtml(row.user.displayName)}</strong>${roleStatusBadge(row.user)}</div></td><td>${row.completedWorkouts}</td><td>${number(row.totalVolume)} кг</td><td>${row.bestLift ? `${escapeHtml(row.bestLift.exercise.name)} · ${number(row.bestLift.estimatedOneRepMax)} кг` : "—"}</td><td>${number(row.score)}</td></tr>`).join("")}</tbody></table></div></section>`);
    }

    function users() {
        const team = teamStats();
        const pending = isAdmin() ? state.database.users.filter((item) => item.approved === false && item.id !== currentUser().id) : [];
        const adminSection = isAdmin()
            ? `<section class="card span-12"><div class="card-header"><div><h2>Заявки на підтвердження</h2><p class="card-caption">Нові користувачі чекають на доступ адміністратора.</p></div><span class="badge accent">${pending.length}</span></div>${pending.length ? `<div class="approval-list">${pending.map((item) => `<div class="day-row"><div class="list-row" style="min-width:0;">${avatar(item, "tiny")}<div style="min-width:0;"><strong>${escapeHtml(item.displayName)}</strong><p class="card-caption">${escapeHtml(item.email || item.name || "")}</p></div></div><div class="day-row-actions"><button class="button button-primary compact" type="button" data-action="approve-user" data-user-id="${item.id}"><i data-lucide="check"></i>Підтвердити</button></div></div>`).join("")}</div>` : `<p class="card-caption">Немає нових заявок.</p>`}</section>`
            : "";
        content(`<div class="grid dashboard-grid">${metric("Командний обсяг", `${number(team.totalVolume)} кг`, "boxes", "Спільний результат", "span-3")}${metric("Тренування команди", team.completedWorkouts, "calendar-check", "Завершено", "span-3")}${metric("Найактивніший", team.mostActiveUser.displayName, "flame", "За завершеними тренуваннями", "span-3")}${metric("Кардіо", `${team.cardioMinutes} хв`, "heart-pulse", "Командна кондиція", "span-3")}${adminSection}</div><section class="user-grid" style="margin-top:16px;">${state.database.users.map(userCard).join("")}</section>`);
    }

    function profile() {
        const user = currentUser();
        const summary = userStats(user.id);
        const recent = workoutsFor(user.id).filter((workoutItem) => workoutItem.status === "completed").sort(byDateDesc).slice(0, 5);
        content(`<div class="grid dashboard-grid"><section class="card span-12"><div class="profile-header"><div class="list-row">${avatar(user, "large")}<div><div class="tag-row" style="margin-bottom:10px;"><span class="badge accent">${escapeHtml(user.trainingGoal)}</span>${roleStatusBadge(user)}<span class="status-badge completed">Можна редагувати</span></div><h2>${escapeHtml(user.displayName)}</h2><p class="card-caption">${escapeHtml(user.name)} · ${user.height} см · ${user.bodyweight} кг · ${escapeHtml(user.trainingExperience)} · фокус: ${escapeHtml(user.favoriteMuscleGroup)}</p></div></div><div class="inline-actions wrap"><button class="button button-primary compact" type="button" data-action="open-profile-editor"><i data-lucide="pen-line"></i>Редагувати</button><button class="button button-secondary compact" type="button" data-action="navigate" data-section="settings"><i data-lucide="settings"></i>Налаштування</button><button class="button button-secondary compact" type="button" data-action="logout"><i data-lucide="log-out"></i>Вийти</button></div></div></section>${isAdmin() ? approvalQueueCard() : ""}${metric("Тренування", summary.completedWorkouts, "calendar-check", "Завершено", "span-3")}${metric("Загальний обсяг", `${number(summary.totalVolume)} кг`, "boxes", "Усі завершені підходи", "span-3")}${metric("Підходи", summary.totalSets, "list-checks", `${summary.workingSets} робочих`, "span-3")}${metric("Кардіо", `${summary.cardioMinutes} хв`, "heart-pulse", `${summary.cardioDistance} км`, "span-3")}${chartCard("Історія ваги тіла", "Щотижневі заміри.", "profileBodyweight", "span-6")}${chartCard("Тренд розрахункового 1ПМ", "Демо-тренд жиму лежачи.", "profileMax", "span-6")}<section class="card span-12"><h2>Особисті рекорди</h2><div class="exercise-card-grid">${recordsFor(user.id).slice(0, 6).map(recordCard).join("") || emptyInline("PR ще немає", "Заверши робочі підходи, щоб GymOS визначив рекорди.")}</div></section><section class="card span-12"><h2>Останні тренування</h2><div class="activity-feed">${workoutHistoryList(recent)}</div></section></div>`);
        requestAnimationFrame(() => {
            bodyweightChart("profileBodyweight", user.id);
            maxTrendChart("profileMax", user.id);
        });
    }

    // ---- Feedback / feature-request board (public; admin manages statuses) ----
    const feedbackTypes = [
        { key: "feature", label: "Фіча", icon: "sparkles" },
        { key: "fix", label: "Фікс", icon: "wrench" },
        { key: "improvement", label: "Покращення", icon: "wand-2" }
    ];
    const feedbackStatuses = [
        { key: "new", label: "Нове" },
        { key: "planned", label: "Заплановано" },
        { key: "in_progress", label: "В роботі" },
        { key: "done", label: "Готово" },
        { key: "declined", label: "Відхилено" }
    ];

    function feedbackItems() {
        return [...(state.database.featureRequests || [])];
    }

    function newFeedbackCount() {
        return feedbackItems().filter((item) => item.status === "new").length;
    }

    function feedback() {
        const items = feedbackItems().sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
        const admin = isAdmin();
        const pendingType = state.filters.feedbackType || "feature";
        content(`<div class="grid dashboard-grid">
            <section class="card span-12 feedback-compose">
                <div class="card-header"><div><h2>Запропонувати ідею або фікс</h2><p class="card-caption">Обери тип, опиши коротко — це побачить адмін і візьме в роботу.</p></div></div>
                <div class="fb-type-row">${feedbackTypes.map((type) => `<button class="fb-type ${type.key}${pendingType === type.key ? " active" : ""}" type="button" data-action="feedback-type" data-type="${type.key}"><i data-lucide="${type.icon}"></i>${escapeHtml(type.label)}</button>`).join("")}</div>
                <div class="field" style="margin-top:14px;"><label>Назва</label><input type="text" id="feedbackTitle" maxlength="140" placeholder="Коротко: що додати або пофіксити"></div>
                <div class="field" style="margin-top:12px;"><label>Деталі (необов'язково)</label><textarea id="feedbackDescription" maxlength="2000" placeholder="Опиши детальніше: де саме, як і навіщо"></textarea></div>
                <div class="action-row" style="margin-top:14px;"><button class="button button-primary" type="button" data-action="submit-feedback"><i data-lucide="send"></i>Надіслати запит</button></div>
            </section>
            <section class="card span-12">
                <div class="card-header"><div><h2>Дошка ідей</h2><p class="card-caption">${items.length} ${items.length === 1 ? "запит" : "запитів"} від спільноти. ${admin ? "Можеш міняти статус і видаляти." : "Статуси оновлює адмін."}</p></div></div>
                ${items.length ? `<div class="feedback-board">${items.map((item) => feedbackCard(item, admin)).join("")}</div>` : emptyInline("Поки порожньо", "Стань першим — запропонуй ідею вище.")}
            </section>
        </div>`);
    }

    function feedbackCard(item, admin) {
        const author = userById(item.userId);
        const typeMeta = feedbackTypes.find((type) => type.key === item.type) || feedbackTypes[0];
        const statusMeta = feedbackStatuses.find((status) => status.key === item.status) || feedbackStatuses[0];
        const adminControls = admin
            ? `<div class="fb-admin"><gym-select data-action="set-feedback-status" data-feedback-id="${item.id}">${feedbackStatuses.map((status) => `<option value="${status.key}" ${item.status === status.key ? "selected" : ""}>${escapeHtml(status.label)}</option>`).join("")}</gym-select><button class="icon-button" type="button" title="Видалити запит" data-action="delete-feedback" data-feedback-id="${item.id}"><i data-lucide="trash-2"></i></button></div>`
            : "";
        return `<article class="fb-item status-${item.status} type-${item.type}">
            <div class="fb-item-top"><span class="fb-type-badge ${item.type}"><i data-lucide="${typeMeta.icon}"></i>${escapeHtml(typeMeta.label)}</span><span class="fb-status-badge status-${item.status}">${escapeHtml(statusMeta.label)}</span></div>
            <h3 class="fb-title">${escapeHtml(item.title)}</h3>
            ${item.description ? `<p class="fb-desc">${escapeHtml(item.description)}</p>` : ""}
            <div class="fb-meta">${author ? avatar(author, "tiny") : ""}<span>${escapeHtml(author?.displayName || "Користувач")}</span><span class="fb-dot">·</span><span>${formatDate(item.createdAt)}</span></div>
            ${adminControls}
        </article>`;
    }

    async function submitFeedback() {
        const title = inputValue("feedbackTitle").trim();
        if (!title) {
            toast("Потрібна назва", "Додай коротку назву ідеї або фіксу.");
            return;
        }
        const type = state.filters.feedbackType || "feature";
        const description = inputValue("feedbackDescription").trim();
        if (storage.mode === "api") {
            try {
                const created = await storage.apiClient.createFeedback({ type, title, description });
                state.database.featureRequests = [created, ...(state.database.featureRequests || [])];
                showSyncIndicator("success", "Надіслано");
            } catch (error) {
                handleUserFacingError(error, "submit-feedback");
                return;
            }
        } else {
            state.database.featureRequests = [{ id: createId("feedback"), userId: currentUser().id, type, title, description, status: "new", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, ...(state.database.featureRequests || [])];
        }
        state.filters.feedbackType = "feature";
        renderSection();
        toast("Дякуємо!", "Твій запит на дошці — адмін його побачить.");
    }

    async function updateFeedbackStatus(id, status) {
        const item = (state.database.featureRequests || []).find((entry) => entry.id === id);
        if (item) {
            item.status = status;
        }
        renderSection();
        if (storage.mode === "api") {
            try {
                await storage.apiClient.updateFeedbackStatus(id, status);
                showSyncIndicator("success", "Статус оновлено");
            } catch (error) {
                handleUserFacingError(error, "set-feedback-status");
            }
        }
    }

    async function deleteFeedbackEntry(id) {
        if (!(await confirmDialog("Видалити цей запит?", { confirmLabel: "Видалити" }))) {
            return;
        }
        state.database.featureRequests = (state.database.featureRequests || []).filter((entry) => entry.id !== id);
        renderSection();
        if (storage.mode === "api") {
            try {
                await storage.apiClient.deleteFeedback(id);
            } catch (error) {
                handleUserFacingError(error, "delete-feedback");
            }
        }
    }

    function settings() {
        const modeOptions = storage.config.requireAuth ? `<option value="api" selected>Бекенд API</option>` : `<option value="local" ${storage.mode === "local" ? "selected" : ""}>Локальний</option><option value="api" ${storage.mode === "api" ? "selected" : ""}>Бекенд API</option>`;
        const modeCaption = storage.config.requireAuth ? "Застосунок працює тільки через backend API. Зміни даних доступні після Google OAuth." : "Застосунок працює локально через IndexedDB/localStorage або через бекенд API.";
        content(`<div class="grid dashboard-grid"><section class="card span-6"><h2>Профіль</h2><p class="card-caption">Активний акаунт визначається авторизацією Google.</p><div class="list-row" style="margin-top:14px;">${avatar(currentUser())}<div><div class="profile-name">${escapeHtml(currentUser().displayName)}</div><div class="profile-meta">${escapeHtml(currentUser().name)}</div></div></div><div class="action-row" style="margin-top:14px;"><button class="button button-secondary compact" type="button" data-action="navigate" data-section="profile"><i data-lucide="user-round"></i>Відкрити профіль</button></div></section><section class="card span-6"><h2>Авторизація</h2><p class="card-caption">Продакшн-режим передбачає тільки Google OAuth.</p><div class="action-row"><button class="button button-primary" type="button" data-action="login-google"><i data-lucide="log-in"></i>Увійти через Google</button><button class="button button-secondary" type="button" data-action="logout"><i data-lucide="log-out"></i>Вийти</button></div></section><section class="card span-6"><h2>Режим даних</h2><p class="card-caption">${modeCaption}</p><div class="field-grid"><div class="field"><label>Режим даних</label><gym-select data-action="data-mode">${modeOptions}</gym-select></div><div class="field"><label>Базовий URL API</label><input type="url" value="${escapeHtml(storage.apiBaseUrl)}" placeholder="https://gym-os-back.vercel.app" data-action="api-base-url"></div></div><div class="action-row" style="margin-top:14px;"><button class="button button-secondary" type="button" data-action="check-backend"><i data-lucide="plug-zap"></i>Перевірити підключення</button><span class="status-badge ${storage.backendStatus === "online" ? "completed" : storage.backendStatus === "offline" ? "planned" : "readonly"}">Бекенд: ${backendStatusLabel(storage.backendStatus)}</span></div></section><section class="card span-6"><h2>Стан сховища</h2>${kpi([{ label: "Режим", value: dataModeLabel(storage.mode) }, { label: "Провайдер", value: storage.provider?.name || "backend API" }, { label: "Вправи", value: state.database.exercises.length }, { label: "Тренування", value: state.database.workouts.length }])}<div class="action-row" style="margin-top:14px;"><button class="button button-secondary" type="button" data-action="notifications"><i data-lucide="bell"></i>Тест таймера</button><button class="button button-danger" type="button" data-action="reset"><i data-lucide="rotate-ccw"></i>Скинути локальний кеш</button></div></section><section class="card span-6"><h2>Імпорт / експорт</h2><p class="card-caption">JSON-дамп GymOS і окремий імпорт каталогу вправ.</p><div class="action-row"><button class="button button-primary" type="button" data-action="export-data"><i data-lucide="download"></i>Експорт JSON</button><label class="button button-secondary" for="importInput"><i data-lucide="upload"></i>Імпорт JSON</label><input class="hidden" id="importInput" type="file" accept="application/json" data-action="import-data"><label class="button button-secondary" for="exerciseCatalogInput"><i data-lucide="file-up"></i>Імпортувати каталог вправ з JSON</label><input class="hidden" id="exerciseCatalogInput" type="file" accept="application/json" data-action="import-exercise-catalog"></div></section><section class="card span-6"><h2>Довідники</h2><p class="card-caption">Власні вправи зберігаються з власником.</p><div class="action-row"><button class="button button-primary" type="button" data-action="open-custom-exercise"><i data-lucide="plus"></i>Додати власну вправу</button><button class="button button-danger" type="button" data-action="reset-curated-exercises"><i data-lucide="list-x"></i>Залишити 2 базові вправи</button></div></section></div>`);
    }

    function changelog() {
        content(`<section class="card"><div class="card-header"><div><h2>Що нового</h2><p class="card-caption">Останні зміни, фічі та виправлення GymOS</p></div><span class="role-badge admin"><i data-lucide="sparkles"></i>v${escapeHtml(APP_VERSION)}</span></div><div class="timeline">${CHANGELOG.map(changelogEntry).join("")}</div></section>`);
    }

    function changelogEntry(entry) {
        return `<article class="timeline-entry"><div class="timeline-rail"><span class="timeline-dot"></span></div><div class="timeline-card"><div class="timeline-head"><span class="timeline-version">v${escapeHtml(entry.version)}</span><span class="timeline-date">${formatDate(entry.date)}</span></div><h3 class="timeline-title">${escapeHtml(entry.title)}</h3><ul class="timeline-items">${entry.items.map((item) => `<li><span class="cl-tag ${item.type}">${escapeHtml(changelogTagLabels[item.type] || item.type)}</span><span>${escapeHtml(item.text)}</span></li>`).join("")}</ul></div></article>`;
    }

    function maybeShowWhatsNew() {
        try {
            const key = "gymos-last-seen-version";
            const seen = localStorage.getItem(key);
            if (seen === APP_VERSION) {
                return;
            }
            localStorage.setItem(key, APP_VERSION);
            if (!seen) {
                return; // first-ever load — don't interrupt onboarding
            }
            const latest = CHANGELOG[0];
            openModal(`<div class="modal-header"><div><h2>Що нового · v${escapeHtml(APP_VERSION)}</h2><p class="card-caption">${escapeHtml(latest.title)}</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><ul class="whatsnew-list">${latest.items.map((item) => `<li><span class="cl-tag ${item.type}">${escapeHtml(changelogTagLabels[item.type] || item.type)}</span><span>${escapeHtml(item.text)}</span></li>`).join("")}</ul><div class="form-actions" style="justify-content:space-between;margin-top:18px;"><button class="button button-secondary" type="button" data-action="open-changelog">Усі зміни</button><button class="button button-primary" type="button" data-action="close-overlay"><i data-lucide="check"></i>Круто!</button></div>`);
            icons();
        } catch (error) {
            // localStorage may be unavailable; ignore.
        }
    }

    function roleStatusBadge(user) {
        const isSuper = Boolean(user?.isSuperAdmin) || adminEmails.has(String(user?.email || "").toLowerCase());
        const role = isSuper ? "admin" : String(user?.role || "free").toLowerCase();
        if (role !== "admin" && role !== "premium") {
            return "";
        }
        // Only the current user's own badge is a link to Підписка — on other members'
        // cards/rows it must stay inert so it doesn't hijack their open-profile click.
        const me = currentUser();
        const link = Boolean(me && user && user.id === me.id);
        const cls = `role-badge ${role}${link ? " role-badge-link" : ""}`;
        const dataAttrs = link ? ` data-action="navigate" data-section="subscription" title="Підписка"` : "";
        const icon = role === "admin" ? "shield" : "crown";
        const label = role === "admin" ? "Адмін" : "PRO";
        return `<span class="${cls}"${dataAttrs}><i data-lucide="${icon}"></i>${label}</span>`;
    }

    function subscription() {
        const admin = isAdmin();
        const isPro = hasUnlimited();
        const planKey = admin ? "admin" : (isPro ? "pro" : "free");
        const planLabel = admin ? "Адмін" : (isPro ? "PRO" : "Free");
        const heroNote = admin
            ? "У тебе повний доступ адміністратора."
            : (isPro ? "Дякуємо! Активний PRO — безліміт у всьому." : "Ти на безкоштовному тарифі. Прокачайся до PRO за $2/міс.");
        const freeFeatures = [
            ["dumbbell", "1 тренування/день, 2/тиждень"],
            ["list-plus", "1 власна вправа на місяць"],
            ["bar-chart-3", "Базова статистика"],
            ["users", "Команда, рейтинги, календар"]
        ];
        const proFeatures = [
            ["dumbbell", "До 2 тренувань на день, без тижневого ліміту"],
            ["list-plus", "До 30 власних вправ"],
            ["lightbulb", "До 3 запитів-ідей на день"],
            ["bar-chart-3", "Розширена аналітика й прогрес"],
            ["history", "Повна історія тренувань"],
            ["download", "Експорт даних (CSV / PDF)"],
            ["crown", "Бейдж PRO у команді й рейтингу"],
            ["heart", "Підтримка розробки 💚"]
        ];
        const cmp = [
            ["Тренувань на день", "1", "2"],
            ["Тренувань на тиждень", "2", "без ліміту"],
            ["Власні вправи", "1 / міс", "до 30"],
            ["Запитів-ідей на день", "1", "3"],
            ["Розширена аналітика", false, true],
            ["Повна історія тренувань", false, true],
            ["Експорт даних", false, true],
            ["Бейдж PRO статусу", false, true]
        ];
        const cmpCell = (value) => value === true
            ? `<i data-lucide="check" class="cmp-yes"></i>`
            : (value === false ? `<i data-lucide="x" class="cmp-no"></i>` : `<span>${escapeHtml(String(value))}</span>`);
        const proCta = isPro
            ? `<button class="button button-secondary" type="button" disabled><i data-lucide="check-circle-2"></i>Активно</button>`
            : `<button class="button button-primary paywall-cta" type="button" data-action="upgrade-plan"><i data-lucide="rocket"></i>Оформити PRO — $2/міс</button>`;
        content(`<div class="grid dashboard-grid">
            <section class="card span-12 sub-hero"><div class="sub-hero-glow"></div><div class="sub-hero-row"><div class="sub-hero-info"><p class="card-caption">Твій тариф</p><h2 class="sub-hero-plan">${escapeHtml(planLabel)}</h2><p class="card-caption">${escapeHtml(heroNote)}</p></div>${isPro
                ? `<span class="role-badge ${admin ? "admin" : "premium"} sub-hero-badge"><i data-lucide="${admin ? "shield" : "crown"}"></i>${admin ? "Адмін" : "PRO"}</span>`
                : `<button class="button button-primary paywall-cta" type="button" data-action="upgrade-plan"><i data-lucide="rocket"></i>Апгрейд до PRO</button>`}</div></section>
            <section class="plan-card free span-6 ${planKey === "free" ? "current" : ""}"><div class="plan-head"><h3>Free</h3><div class="plan-price"><span class="plan-amount">$0</span></div></div><p class="card-caption">Базовий доступ для старту.</p><ul class="plan-features">${freeFeatures.map(([icon, text]) => `<li><i data-lucide="${icon}"></i><span>${escapeHtml(text)}</span></li>`).join("")}</ul>${planKey === "free" ? `<div class="plan-current-tag">Поточний план</div>` : ""}</section>
            <section class="plan-card pro span-6 ${isPro ? "current" : ""}"><div class="plan-glow"></div><div class="plan-head"><h3><i data-lucide="crown"></i>PRO</h3><div class="plan-price"><span class="plan-amount">$2</span><span class="plan-period">/міс</span></div></div><p class="card-caption">Безліміт і всі можливості GymOS.</p><ul class="plan-features">${proFeatures.map(([icon, text]) => `<li><i data-lucide="${icon}"></i><span>${escapeHtml(text)}</span></li>`).join("")}</ul>${proCta}</section>
            <section class="card span-12"><div class="card-header"><div><h2>Порівняння тарифів</h2><p class="card-caption">Що входить у кожен тариф.</p></div></div><div class="table-wrap"><table class="cmp-table"><thead><tr><th>Можливість</th><th>Free</th><th class="cmp-pro-col">PRO</th></tr></thead><tbody>${cmp.map((row) => `<tr><td>${escapeHtml(row[0])}</td><td class="cmp-free">${cmpCell(row[1])}</td><td class="cmp-pro-col">${cmpCell(row[2])}</td></tr>`).join("")}</tbody></table></div></section>
            <p class="card-caption sub-foot">Онлайн-оплата скоро запрацює — зараз це прев'ю тарифу PRO.</p>
        </div>`);
    }

    function applySidebarState() {
        let collapsed = false;
        try {
            collapsed = localStorage.getItem("gymos-sidebar-collapsed") === "1";
        } catch (error) {
            collapsed = false;
        }
        const shell = document.querySelector(".app-shell");
        if (shell) {
            shell.classList.toggle("sidebar-collapsed", collapsed);
        }
        const button = element("sidebarCollapseButton");
        if (button) {
            button.innerHTML = `<i data-lucide="${collapsed ? "panel-left-open" : "panel-left-close"}"></i>`;
            button.setAttribute("aria-label", collapsed ? "Розгорнути меню" : "Згорнути меню");
            button.setAttribute("title", collapsed ? "Розгорнути меню" : "Згорнути меню");
            icons();
        }
    }

    function toggleSidebar() {
        let collapsed = false;
        try {
            collapsed = localStorage.getItem("gymos-sidebar-collapsed") === "1";
            localStorage.setItem("gymos-sidebar-collapsed", collapsed ? "0" : "1");
        } catch (error) {
            // localStorage unavailable — fall back to a one-off DOM toggle.
            const shell = document.querySelector(".app-shell");
            if (shell) {
                shell.classList.toggle("sidebar-collapsed");
            }
            return;
        }
        applySidebarState();
    }

    function bindEvents() {
        document.addEventListener("click", handleClick);
        document.addEventListener("change", handleChange);
        document.addEventListener("input", handleInput);
        window.addEventListener("hashchange", handleRoute);
        // Guarantee scrolling is never left frozen by a stray overlay lock.
        window.addEventListener("focus", ensureScrollUnlockedIfNoOverlay);
        window.addEventListener("pageshow", ensureScrollUnlockedIfNoOverlay);
        window.addEventListener("resize", () => {
            clearTimeout(bindEvents.resizeTimer);
            bindEvents.resizeTimer = setTimeout(updateTopbarOffset, 150);
        });
        // iOS Safari ignores user-scalable=no but honours blocking these pinch
        // gesture events — stops the page (and inputs) from zooming on phones.
        ["gesturestart", "gesturechange", "gestureend"].forEach((eventName) => {
            document.addEventListener(eventName, (event) => event.preventDefault(), { passive: false });
        });
        element("modalBackdrop").addEventListener("click", closeOverlay);
        element("openQuickActionButton").addEventListener("click", openQuickAction);
        element("openUserSwitcherButton").addEventListener("click", () => navigate("profile"));
        const collapseButton = element("sidebarCollapseButton");
        if (collapseButton) {
            collapseButton.addEventListener("click", toggleSidebar);
        }
        setupTooltips();
        setupPullToRefresh();
    }

    // Re-fetch everything from the backend and re-render the current view. Used by
    // pull-to-refresh; the per-user /export feed is uncached so this always gets
    // fresh data. Local mode just re-renders (nothing to fetch).
    async function refreshData() {
        if (storage.mode !== "api") {
            renderShell();
            renderSection();
            return;
        }
        showSyncIndicator("loading", "Оновлення…");
        try {
            state.database = await storage.load();
            state.profileUserId = state.database.currentUserId;
            renderShell();
            renderSection();
            showSyncIndicator("success", "Оновлено");
        } catch (error) {
            handleUserFacingError(error, "refresh");
        }
    }

    // Pull-to-refresh: drag down from the very top to reload. Touch-only, armed
    // only at scrollTop===0, with resistance + a threshold, and disabled while an
    // overlay is open or the touch starts on a toast / nav / input — so it never
    // hijacks normal scrolling or other gestures.
    function setupPullToRefresh() {
        // Phones/tablets only — a touch-PRIMARY device (pointer: coarse). Desktops,
        // including touch-capable laptops driven by a mouse, report (pointer: fine)
        // and are excluded, so PTR never touches desktop mouse-wheel / reload.
        const touchPrimary = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
        if (!touchPrimary) {
            return;
        }
        if (document.getElementById("ptrIndicator")) {
            return;
        }
        const THRESHOLD = 72;
        const MAX = 130;
        const indicator = document.createElement("div");
        indicator.id = "ptrIndicator";
        indicator.className = "ptr-indicator";
        indicator.setAttribute("aria-hidden", "true");
        indicator.innerHTML = `<svg class="ptr-ring" viewBox="0 0 36 36" width="22" height="22" aria-hidden="true"><circle class="ptr-track" cx="18" cy="18" r="15"></circle><circle class="ptr-prog" cx="18" cy="18" r="15" transform="rotate(-90 18 18)"></circle></svg>`;
        document.body.appendChild(indicator);
        const prog = indicator.querySelector(".ptr-prog");
        const CIRC = 2 * Math.PI * 15; // ~94.25
        prog.style.strokeDasharray = String(CIRC);
        prog.style.strokeDashoffset = String(CIRC);

        let startY = 0;
        let armed = false;
        let pulling = false;
        let refreshing = false;
        let pull = 0;

        const atTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 0;

        function setPull(px, animate) {
            pull = px;
            indicator.style.transition = animate ? "transform 0.26s cubic-bezier(0.22,1,0.36,1), opacity 0.2s ease" : "none";
            const reveal = Math.min(px, MAX);
            indicator.style.transform = `translateX(-50%) translateY(${Math.min(72, -64 + reveal * 1.15)}px)`;
            indicator.style.opacity = String(Math.min(1, px / 26));
            const ratio = Math.max(0, Math.min(1, px / THRESHOLD));
            prog.style.strokeDashoffset = String(CIRC * (1 - ratio));
            indicator.querySelector(".ptr-ring").style.transform = refreshing ? "" : `rotate(${ratio * 270}deg)`;
            indicator.classList.toggle("ready", ratio >= 1 && !refreshing);
        }

        function reset(animate) {
            pulling = false;
            indicator.classList.remove("ptr-loading", "ready");
            setPull(0, animate);
        }

        async function trigger() {
            refreshing = true;
            indicator.classList.add("ptr-loading");
            indicator.classList.remove("ready");
            indicator.style.transition = "transform 0.26s cubic-bezier(0.22,1,0.36,1)";
            indicator.style.transform = "translateX(-50%) translateY(20px)";
            indicator.style.opacity = "1";
            try {
                await refreshData();
            } finally {
                refreshing = false;
                reset(true);
            }
        }

        document.addEventListener("touchstart", (event) => {
            if (refreshing || scrollLocked || event.touches.length !== 1) {
                armed = false;
                return;
            }
            if (event.target.closest(".toast, .drawer-layer, .modal-layer, .mobile-navigation, .floating-timer, input, textarea, select, [contenteditable]")) {
                armed = false;
                return;
            }
            if (!atTop()) {
                armed = false;
                return;
            }
            startY = event.touches[0].clientY;
            armed = true;
            pulling = false;
        }, { passive: true });

        document.addEventListener("touchmove", (event) => {
            if (!armed || refreshing) {
                return;
            }
            const dy = event.touches[0].clientY - startY;
            if (dy <= 0 || !atTop()) {
                if (pulling) {
                    reset(true);
                }
                if (!atTop()) {
                    armed = false;
                }
                return;
            }
            const resisted = Math.min(MAX, dy * 0.5);
            if (resisted > 3) {
                pulling = true;
                event.preventDefault(); // own the gesture; suppress native overscroll
                setPull(resisted, false);
            }
        }, { passive: false });

        const onEnd = () => {
            if (!armed) {
                return;
            }
            armed = false;
            if (pulling && pull >= THRESHOLD && !refreshing) {
                trigger();
            } else if (pulling) {
                reset(true);
            }
        };
        document.addEventListener("touchend", onEnd, { passive: true });
        document.addEventListener("touchcancel", onEnd, { passive: true });
    }

    // Shared, delegated tooltip engine for [data-tip-body] triggers (see infoTip).
    // One floating bubble, positioned in JS so it never clips inside cards.
    // Hover opens after a 200ms delay (no flicker on quick mouse passes); tap
    // toggles on touch; focus opens for keyboard users.
    function setupTooltips() {
        let tipEl = null;
        let arrowEl = null;
        let contentEl = null;
        let showTimer = null;
        let activeTrigger = null;
        // True when the most recent focus came from a pointer (mouse/touch), so
        // focusin won't open the tooltip that the click handler then toggles.
        let pointerFocus = false;

        function ensureEl() {
            if (tipEl) {
                return;
            }
            tipEl = document.createElement("div");
            tipEl.className = "app-tooltip";
            tipEl.id = "appTooltip";
            tipEl.setAttribute("role", "tooltip");
            arrowEl = document.createElement("div");
            arrowEl.className = "app-tooltip-arrow up";
            contentEl = document.createElement("div");
            contentEl.className = "app-tooltip-content";
            tipEl.append(arrowEl, contentEl);
            document.body.appendChild(tipEl);
        }

        function position(trigger) {
            const rect = trigger.getBoundingClientRect();
            // offsetWidth/Height ignore the CSS transform (scale .98 during the
            // open transition), so the measurement is stable and exact.
            const tw = tipEl.offsetWidth;
            const th = tipEl.offsetHeight;
            const margin = 8;
            const gap = 10;
            const centerX = rect.left + rect.width / 2;
            const left = Math.max(margin, Math.min(centerX - tw / 2, window.innerWidth - tw - margin));
            let top = rect.top - th - gap;
            let below = false;
            if (top < margin) {
                top = rect.bottom + gap;
                below = true;
            }
            // Keep fully on-screen vertically on short viewports too.
            top = Math.max(margin, Math.min(top, window.innerHeight - th - margin));
            tipEl.style.left = `${Math.round(left)}px`;
            tipEl.style.top = `${Math.round(top)}px`;
            const arrowLeft = Math.max(12, Math.min(centerX - left - 5, tw - 22));
            arrowEl.style.left = `${Math.round(arrowLeft)}px`;
            if (below) {
                arrowEl.className = "app-tooltip-arrow up";
                arrowEl.style.top = "-5px";
            } else {
                arrowEl.className = "app-tooltip-arrow down";
                arrowEl.style.top = `${Math.round(th - 5)}px`;
            }
        }

        function show(trigger) {
            ensureEl();
            const title = trigger.getAttribute("data-tip-title") || "";
            const body = trigger.getAttribute("data-tip-body") || "";
            if (!body) {
                return;
            }
            contentEl.innerHTML = `${title ? `<div class="app-tooltip-title">${escapeHtml(title)}</div>` : ""}<div class="app-tooltip-body">${escapeHtml(body)}</div>`;
            activeTrigger = trigger;
            trigger.setAttribute("aria-describedby", "appTooltip");
            tipEl.style.left = "-9999px";
            tipEl.style.top = "-9999px";
            tipEl.classList.add("visible");
            position(trigger);
        }

        function hide() {
            if (showTimer) {
                clearTimeout(showTimer);
                showTimer = null;
            }
            if (activeTrigger) {
                activeTrigger.removeAttribute("aria-describedby");
                activeTrigger = null;
            }
            if (tipEl) {
                tipEl.classList.remove("visible");
            }
        }

        const isCoarse = () => !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

        // ---- Mobile: a clean bottom sheet instead of a finicky floating tip ----
        let sheet = null;
        let sheetBackdrop = null;
        let sheetTitle = null;
        let sheetBody = null;

        function closeSheet() {
            if (sheet) {
                sheet.classList.remove("visible");
                sheet.style.transform = "";
            }
            if (sheetBackdrop) {
                sheetBackdrop.classList.remove("visible");
            }
        }

        function ensureSheet() {
            if (sheet) {
                return;
            }
            sheetBackdrop = document.createElement("div");
            sheetBackdrop.className = "tip-sheet-backdrop";
            sheet = document.createElement("div");
            sheet.className = "tip-sheet";
            sheet.setAttribute("role", "dialog");
            sheet.setAttribute("aria-modal", "true");
            sheet.innerHTML = `<span class="tip-sheet-handle" aria-hidden="true"></span><div class="tip-sheet-head"><span class="tip-sheet-icon"><i data-lucide="info"></i></span><h4 class="tip-sheet-title"></h4></div><p class="tip-sheet-body"></p>`;
            document.body.append(sheetBackdrop, sheet);
            sheetTitle = sheet.querySelector(".tip-sheet-title");
            sheetBody = sheet.querySelector(".tip-sheet-body");
            sheetBackdrop.addEventListener("click", closeSheet);

            // swipe the sheet down to dismiss
            let startY = 0;
            let deltaY = 0;
            let dragging = false;
            sheet.addEventListener("pointerdown", (event) => {
                startY = event.clientY;
                deltaY = 0;
                dragging = true;
                sheet.style.transition = "none";
            });
            sheet.addEventListener("pointermove", (event) => {
                if (!dragging) {
                    return;
                }
                deltaY = Math.max(0, event.clientY - startY);
                sheet.style.transform = `translateY(${deltaY}px)`;
            });
            const endDrag = () => {
                if (!dragging) {
                    return;
                }
                dragging = false;
                sheet.style.transition = "";
                if (deltaY > 90) {
                    closeSheet();
                } else {
                    sheet.style.transform = "";
                }
            };
            sheet.addEventListener("pointerup", endDrag);
            sheet.addEventListener("pointercancel", endDrag);
        }

        function openSheet(trigger) {
            const title = trigger.getAttribute("data-tip-title") || "";
            const body = trigger.getAttribute("data-tip-body") || "";
            if (!body) {
                return;
            }
            ensureSheet();
            sheetTitle.textContent = title;
            sheetBody.textContent = body;
            if (window.lucide) {
                window.lucide.createIcons({ root: sheet });
            }
            sheet.style.transform = "";
            sheetBackdrop.classList.add("visible");
            const reveal = () => sheet.classList.add("visible");
            requestAnimationFrame(reveal);
            setTimeout(reveal, 60); // fallback if rAF is throttled
        }

        // Touch devices synthesise mouseover/mouseout on tap (the flicker/lag) —
        // skip the hover path there entirely; tap opens the sheet instead.
        document.addEventListener("mouseover", (event) => {
            if (isCoarse()) {
                return;
            }
            const trigger = event.target.closest("[data-tip-body]");
            if (!trigger || trigger === activeTrigger) {
                return;
            }
            if (showTimer) {
                clearTimeout(showTimer);
            }
            showTimer = setTimeout(() => show(trigger), 200);
        });

        document.addEventListener("mouseout", (event) => {
            if (isCoarse()) {
                return;
            }
            const trigger = event.target.closest("[data-tip-body]");
            if (!trigger) {
                return;
            }
            if (event.relatedTarget && trigger.contains(event.relatedTarget)) {
                return;
            }
            hide();
        });

        // Capture phase so a tap on the trigger doesn't bubble to a parent action.
        document.addEventListener("click", (event) => {
            pointerFocus = false;
            const trigger = event.target.closest("[data-tip-body]");
            if (trigger) {
                event.preventDefault();
                event.stopPropagation();
                if (isCoarse()) {
                    openSheet(trigger);
                    return;
                }
                if (activeTrigger === trigger && tipEl && tipEl.classList.contains("visible")) {
                    hide();
                } else {
                    if (showTimer) {
                        clearTimeout(showTimer);
                    }
                    show(trigger);
                }
                return;
            }
            if (tipEl && tipEl.classList.contains("visible")) {
                hide();
            }
        }, true);

        document.addEventListener("pointerdown", (event) => {
            pointerFocus = !!(event.target.closest && event.target.closest("[data-tip-body]"));
        }, true);
        document.addEventListener("pointerup", () => {
            pointerFocus = false;
        }, true);
        document.addEventListener("focusin", (event) => {
            if (isCoarse()) {
                return;
            }
            const trigger = event.target.closest && event.target.closest("[data-tip-body]");
            if (trigger && !pointerFocus) {
                show(trigger);
            }
            pointerFocus = false;
        });
        document.addEventListener("focusout", (event) => {
            const trigger = event.target.closest && event.target.closest("[data-tip-body]");
            if (trigger) {
                hide();
            }
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                hide();
                closeSheet();
            }
        });
        window.addEventListener("scroll", hide, true);
        window.addEventListener("resize", () => { hide(); closeSheet(); });
        window.addEventListener("hashchange", () => { hide(); closeSheet(); });
    }

    async function handleClick(event) {
        const actionElement = event.target.closest("[data-action]");
        if (!actionElement) {
            return;
        }

        const action = actionElement.dataset.action;
        const actions = {
            navigate: () => navigate(actionElement.dataset.section),
            "start-workout": startNewWorkout,
            "edit-workout": () => openWorkoutEditor(actionElement.dataset.workoutId),
            "reopen-workout": () => reopenWorkout(actionElement.dataset.workoutId),
            "start-existing-workout": () => startExistingWorkout(actionElement.dataset.workoutId),
            "delete-workout": () => deleteWorkout(actionElement.dataset.workoutId),
            "open-day-sheet": () => openDaySheet(actionElement.dataset.date),
            "open-add-exercise-modal": openAddExerciseModal,
            "picker-filter": () => setPickerFilter(actionElement.dataset.key, actionElement.dataset.value),
            "add-exercise": () => addExercise(actionElement.dataset.exerciseId),
            "remove-workout-exercise": () => removeWorkoutExercise(actionElement.dataset.workoutExerciseId),
            "open-custom-exercise": () => openCustomExercise(),
            "save-custom-exercise": saveCustomExercise,
            "edit-exercise": () => editExercise(actionElement.dataset.exerciseId),
            "delete-exercise": () => deleteExerciseEntry(actionElement.dataset.exerciseId),
            "approve-exercise": () => approveExerciseEntry(actionElement.dataset.exerciseId),
            "reject-exercise": () => rejectExerciseEntry(actionElement.dataset.exerciseId),
            "upgrade-plan": showUpgradeComingSoon,
            "open-changelog": () => { closeOverlay(); navigate("changelog"); },
            "activity-scope": () => { state.filters.activityScope = actionElement.dataset.scope; renderSection(); },
            "stats-user": () => { state.filters.statsUserId = actionElement.dataset.userId; renderSection(); },
            "feedback-type": () => { state.filters.feedbackType = actionElement.dataset.type; document.querySelectorAll(".fb-type").forEach((btn) => btn.classList.toggle("active", btn.dataset.type === actionElement.dataset.type)); },
            "submit-feedback": submitFeedback,
            "delete-feedback": () => deleteFeedbackEntry(actionElement.dataset.feedbackId),
            "open-exercise": () => openExercise(actionElement.dataset.exerciseId),
            "react-exercise": () => reactToExercise(actionElement.dataset.exerciseId, actionElement.dataset.reaction),
            "open-user": () => goToUser(actionElement.dataset.userId),
            "add-set": () => addSet(actionElement.dataset.workoutExerciseId),
            "toggle-set": () => toggleSet(actionElement.dataset.workoutExerciseId, actionElement.dataset.setId),
            "delete-set": () => deleteSet(actionElement.dataset.workoutExerciseId, actionElement.dataset.setId),
            "finish-workout": () => finishWorkout(actionElement.dataset.workoutId),
            "open-cardio-modal": () => openCardioModal(actionElement.dataset.workoutId, actionElement.dataset.cardioId || null),
            "save-cardio": () => saveCardio(actionElement.dataset.workoutId, actionElement.dataset.cardioId || null),
            "delete-cardio": () => deleteCardio(actionElement.dataset.workoutId, actionElement.dataset.cardioId),
            "timer-add": () => addTimerTime(Number(actionElement.dataset.delta)),
            "timer-toggle": toggleTimerPause,
            "timer-stop": stopTimer,
            "open-profile-editor": openProfileEditor,
            "save-profile": saveProfile,
            "save-bodyweight": saveBodyweight,
            "open-workout": () => openWorkout(actionElement.dataset.workoutId),
            notifications: requestNotifications,
            "check-backend": checkBackendConnection,
            "login-google": loginWithGoogle,
            logout: logout,
            "recheck-approval": recheckApproval,
            "approve-user": () => setUserApproval(actionElement.dataset.userId, true),
            "revoke-user": () => setUserApproval(actionElement.dataset.userId, false),
            "export-data": exportData,
            "reset-curated-exercises": resetCuratedExercises,
            reset: resetData,
            "close-overlay": closeOverlay
        };

        if (actions[action]) {
            await runAction(actionElement, action, actions[action]);
        }
    }

    async function handleChange(event) {
        const actionElement = event.target.closest("[data-action]");
        if (!actionElement) {
            return;
        }

        await runChangeAction(actionElement, async () => {
            if (actionElement.dataset.action === "set-field") {
                await updateSetField(actionElement.dataset.workoutExerciseId, actionElement.dataset.setId, actionElement.dataset.field, actionElement.value);
            }

            if (actionElement.dataset.action === "edit-workout-meta") {
                await updateWorkoutMeta(actionElement.dataset.workoutId, actionElement.dataset.field, actionElement.value);
            }

            if (actionElement.dataset.action === "stats-filter") {
                state.filters[actionElement.dataset.filter] = actionElement.value;
                renderSection();
            }

            if (actionElement.dataset.action === "set-role") {
                await setUserRole(actionElement.dataset.userId, actionElement.value);
            }

            if (actionElement.dataset.action === "set-feedback-status") {
                await updateFeedbackStatus(actionElement.dataset.feedbackId, actionElement.value);
            }

            if (actionElement.dataset.action === "import-data") {
                await importData(actionElement.files[0]);
            }

            if (actionElement.dataset.action === "import-exercise-catalog") {
                await importExerciseCatalog(actionElement.files[0]);
            }

            if (actionElement.dataset.action === "data-mode") {
                await changeDataMode(actionElement.value);
            }
        });
    }

    async function runAction(actionElement, action, callback) {
        const shouldShowLoader = actionNeedsLoader(action);
        if (shouldShowLoader && actionElement.dataset.busy === "true") {
            return;
        }

        if (shouldShowLoader) {
            setActionLoading(actionElement, true);
            showSyncIndicator("loading", actionProgressLabel(action));
        }

        try {
            const result = callback();
            if (result && typeof result.then === "function") {
                await result;
            }
            if (shouldShowLoader) {
                showSyncIndicator("success", "Готово");
            }
        } catch (error) {
            handleUserFacingError(error, action);
        } finally {
            if (shouldShowLoader) {
                setActionLoading(actionElement, false);
            }
        }
    }

    async function runChangeAction(actionElement, callback) {
        try {
            const result = callback();
            if (result && typeof result.then === "function") {
                await result;
            }
        } catch (error) {
            handleUserFacingError(error, actionElement.dataset.action);
        } finally {
            if (actionElement.type === "file") {
                actionElement.value = "";
            }
        }
    }

    function actionNeedsLoader(action) {
        return !new Set([
            "navigate",
            "edit-workout",
            "open-day-sheet",
            "open-add-exercise-modal",
            "picker-filter",
            "open-custom-exercise",
            "edit-exercise",
            "upgrade-plan",
            "open-changelog",
            "activity-scope",
            "stats-user",
            "feedback-type",
            "react-exercise",
            "open-exercise",
            "open-user",
            "open-profile-editor",
            "open-workout",
            "open-cardio-modal",
            "timer-add",
            "timer-toggle",
            "timer-stop",
            "close-overlay"
        ]).has(action);
    }

    function actionProgressLabel(action) {
        const labels = {
            "start-workout": "Створюємо тренування",
            "reopen-workout": "Відновлюємо тренування",
            "start-existing-workout": "Запускаємо тренування",
            "delete-workout": "Видаляємо тренування",
            "add-exercise": "Додаємо вправу",
            "remove-workout-exercise": "Видаляємо вправу",
            "save-custom-exercise": "Зберігаємо вправу",
            "add-set": "Додаємо підхід",
            "toggle-set": "Оновлюємо підхід",
            "delete-set": "Видаляємо підхід",
            "finish-workout": "Завершуємо тренування",
            "save-cardio": "Зберігаємо кардіо",
            "delete-cardio": "Видаляємо кардіо",
            "save-profile": "Зберігаємо профіль",
            "save-bodyweight": "Додаємо замір ваги",
            notifications: "Перевіряємо таймер",
            "check-backend": "Перевіряємо backend",
            logout: "Виходимо з акаунта",
            "export-data": "Готуємо експорт",
            "reset-curated-exercises": "Очищаємо каталог вправ",
            reset: "Оновлюємо сховище"
        };
        return labels[action] || "Виконуємо дію";
    }

    function setActionLoading(actionElement, isLoading) {
        if (!actionElement) {
            return;
        }

        if (isLoading) {
            actionElement.dataset.busy = "true";
            actionElement.dataset.originalHtml = actionElement.innerHTML;
            actionElement.classList.add("is-loading");
            actionElement.setAttribute("aria-busy", "true");
            if ("disabled" in actionElement) {
                actionElement.disabled = true;
            }
            const canUseInlineLoader = actionElement.classList.contains("button") || actionElement.classList.contains("icon-button");
            if (canUseInlineLoader) {
                const label = actionElement.classList.contains("icon-button") ? "" : `<span>${escapeHtml(actionElement.textContent.trim() || "Зачекай")}</span>`;
                actionElement.innerHTML = `<span class="square-loader" aria-hidden="true"></span>${label}`;
            }
            return;
        }

        actionElement.classList.remove("is-loading");
        actionElement.removeAttribute("aria-busy");
        if ("disabled" in actionElement) {
            actionElement.disabled = false;
        }
        if (actionElement.dataset.originalHtml) {
            actionElement.innerHTML = actionElement.dataset.originalHtml;
        }
        delete actionElement.dataset.busy;
        delete actionElement.dataset.originalHtml;
        icons();
    }

    function handleInput(event) {
        const actionElement = event.target.closest("[data-action]");
        if (!actionElement) {
            return;
        }

        if (actionElement.dataset.action === "exercise-search") {
            // Re-render only the card grid (not the whole section) so the search
            // input keeps focus + caret while typing — re-rendering #pageContent
            // destroyed the input and dropped focus after every character.
            state.filters.exerciseSearch = actionElement.value;
            const grid = element("exerciseCatalogGrid");
            if (grid) {
                grid.innerHTML = exerciseCatalogCards();
                iconsIn(grid);
            }
        }

        if (actionElement.dataset.action === "exercise-picker-search") {
            state.filters.exerciseSearch = actionElement.value;
            const pickerGrid = element("exercisePickerGrid");
            if (pickerGrid) {
                pickerGrid.innerHTML = exercisePickerCards();
            }
        }

        if (actionElement.dataset.action === "custom-exercise-media") {
            const preview = element("customExerciseMediaPreview");
            const url = imageUrl(actionElement.value);
            if (preview) {
                preview.classList.toggle("has-image", Boolean(url));
                preview.innerHTML = url ? `<img src="${escapeHtml(url)}" alt="Превʼю" referrerpolicy="no-referrer" onerror="this.remove(); this.closest('.media-url-preview')?.classList.remove('has-image');">` : "";
            }
        }

        if (actionElement.dataset.action === "update-workout-notes") {
            const workoutItem = editWorkout();
            if (workoutItem) {
                workoutItem.notes = actionElement.value;
                schedulePersistWorkout(workoutItem);
            }
        }

        if (actionElement.dataset.action === "update-exercise-notes") {
            const workoutItem = editWorkout();
            const workoutExercise = workoutItem?.exercises.find((item) => item.id === actionElement.dataset.workoutExerciseId);
            if (workoutExercise) {
                workoutExercise.notes = actionElement.value;
                schedulePersistWorkout(workoutItem);
            }
        }

        if (actionElement.dataset.action === "api-base-url") {
            clearTimeout(handleInput.apiUrlTimeoutId);
            handleInput.apiUrlTimeoutId = setTimeout(() => updateApiBaseUrl(actionElement.value), 450);
        }
    }

    const routableSections = new Set([...sectionItems.map((item) => item.id), "user"]);

    function parseRoute() {
        const raw = String(window.location.hash || "").replace(/^#\/?/, "");
        const [section, param] = raw.split("/");
        if (section && routableSections.has(section)) {
            return { section, param: param ? decodeURIComponent(param) : null };
        }
        return { section: "dashboard", param: null };
    }

    function handleRoute() {
        if (!state.database || storage.requiresAuthentication()) {
            return;
        }
        const { section, param } = parseRoute();
        state.section = section;
        if (section === "workout") {
            state.editingWorkoutId = param || null;
        }
        if (section === "user") {
            state.viewUserId = param || null;
        }
        closeOverlay();
        renderSection();
        scrollToTop();
    }

    function goToUser(userId) {
        const target = `#/user/${encodeURIComponent(userId)}`;
        if (window.location.hash === target) {
            handleRoute();
        } else {
            window.location.hash = target;
        }
    }

    function scrollToTop() {
        window.scrollTo(0, 0);
        const main = document.querySelector(".main-shell");
        if (main) {
            main.scrollTop = 0;
        }
        const content = element("pageContent");
        if (content) {
            content.scrollTop = 0;
        }
    }

    function navigate(section) {
        const target = `#/${section}`;
        if (window.location.hash === target) {
            handleRoute();
        } else {
            window.location.hash = target;
        }
    }

    function goToWorkoutEditor(workoutId) {
        const target = `#/workout/${encodeURIComponent(workoutId)}`;
        if (window.location.hash === target) {
            handleRoute();
        } else {
            window.location.hash = target;
        }
    }

    function updateTopbarOffset() {
        const topbar = document.querySelector(".topbar");
        if (topbar) {
            document.documentElement.style.setProperty("--topbar-h", `${topbar.offsetHeight}px`);
        }
    }

    function openQuickAction() {
        openModal(`<div class="modal-header"><div><h2>Швидка дія</h2><p class="card-caption">Почати тренування або перейти в потрібний розділ.</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><div class="quick-grid"><button class="quick-card" type="button" data-action="start-workout"><i data-lucide="play"></i><h3>Почати тренування</h3><p class="card-caption">Нова сесія — додавай вправи та підходи.</p></button><button class="quick-card" type="button" data-action="navigate" data-section="calendar"><i data-lucide="calendar-days"></i><h3>Календар</h3><p class="card-caption">Історія та керування тренуваннями.</p></button><button class="quick-card" type="button" data-action="navigate" data-section="rankings"><i data-lucide="trophy"></i><h3>Рейтинги</h3><p class="card-caption">Поточний силовий рівень.</p></button><button class="quick-card" type="button" data-action="navigate" data-section="exercises"><i data-lucide="list-filter"></i><h3>Каталог вправ</h3><p class="card-caption">Техніка, помилки і безпека.</p></button></div>`);
    }

    function openDaySheet(date) {
        const items = state.database.workouts.filter((item) => item.date === date).sort((left, right) => statusRank(left.status) - statusRank(right.status));
        const isToday = date === dateInput(new Date());
        const rows = items.map((workoutItem) => {
            const owner = userById(workoutItem.userId);
            const own = workoutItem.userId === currentUser().id;
            const manage = canManage(workoutItem);
            return `<article class="day-row"><div class="day-row-main"><div class="tag-row"><span class="status-badge ${workoutItem.status}">${statusLabel(workoutItem.status)}</span><span class="chip">${workoutTypeLabel(workoutItem.workoutType)}</span>${own ? "" : `<span class="chip">${escapeHtml(owner.displayName)}</span>`}</div><strong>${escapeHtml(workoutLabel(workoutItem))}</strong><p class="card-caption">${number(workoutVolume(workoutItem))} кг · ${workoutSetCount(workoutItem)} підходів${workoutCardioMinutes(workoutItem) ? ` · ${workoutCardioMinutes(workoutItem)} хв кардіо` : ""}</p></div><div class="day-row-actions">${manage ? `<button class="button button-secondary compact" type="button" data-action="edit-workout" data-workout-id="${workoutItem.id}"><i data-lucide="pen-line"></i>Керувати</button><button class="icon-button" type="button" title="Видалити" data-action="delete-workout" data-workout-id="${workoutItem.id}"><i data-lucide="trash-2"></i></button>` : `<button class="button button-secondary compact" type="button" data-action="open-workout" data-workout-id="${workoutItem.id}">Деталі</button>`}</div></article>`;
        }).join("");
        openModal(`<div class="modal-header"><div><h2>${formatDate(date)}</h2><p class="card-caption">${items.length ? `Тренувань цього дня: ${items.length}` : "Цього дня тренувань немає"}</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><div class="day-list">${rows || emptyInline("Немає тренувань", isToday ? "Почни сьогоднішнє тренування." : "У цей день записів немає.")}</div>${isToday ? `<div class="form-actions" style="justify-content:flex-end;margin-top:16px;"><button class="button button-primary" type="button" data-action="start-workout"><i data-lucide="play"></i>Почати тренування</button></div>` : ""}`);
    }

    function openStartWorkoutModal() {
        startNewWorkout();
    }

    function openCardioModal(workoutId, cardioId = null) {
        const workoutItem = ownWorkout(workoutId);
        if (!workoutItem) {
            toast("Лише перегляд", "Кардіо можна додавати тільки у власні тренування.");
            return;
        }
        const session = cardioId ? (workoutItem.cardioSessions || []).find((item) => item.id === cardioId) : null;
        const types = [["treadmill", "Бігова доріжка"], ["bike", "Велотренажер"], ["running", "Біг"], ["walking", "Ходьба"], ["rower", "Гребний тренажер"], ["elliptical", "Еліпс"], ["other", "Інше"]];
        const type = session?.type || "treadmill";
        const intensity = session?.intensity || "medium";
        openModal(`<div class="modal-header"><div><h2>${session ? "Редагувати кардіо" : "Додати кардіо"}</h2><p class="card-caption">Вкажи тип і тривалість. Решта — за бажанням.</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><div class="field-grid"><div class="field"><label>Тип</label><gym-select id="cardioType">${types.map(([value, label]) => `<option value="${value}" ${type === value ? "selected" : ""}>${label}</option>`).join("")}</gym-select></div><div class="field"><label>Час, хв</label><input id="cardioDuration" type="number" min="1" step="1" value="${session ? session.durationMinutes : 20}"></div><div class="field"><label>Дистанція, км</label><input id="cardioDistance" type="number" min="0" step="0.1" value="${session?.distance || ""}" placeholder="Необов'язково"></div><div class="field"><label>Калорії</label><input id="cardioCalories" type="number" min="0" step="1" value="${session?.calories || ""}" placeholder="Необов'язково"></div><div class="field"><label>Середній пульс</label><input id="cardioHeartRate" type="number" min="0" step="1" value="${session?.averageHeartRate || ""}" placeholder="уд/хв"></div><div class="field"><label>Інтенсивність</label><gym-select id="cardioIntensity">${[["low", "низька"], ["medium", "середня"], ["high", "висока"]].map(([value, label]) => `<option value="${value}" ${intensity === value ? "selected" : ""}>${label}</option>`).join("")}</gym-select></div></div><div class="field" style="margin-top:14px;"><label>Нотатки</label><textarea id="cardioNotes" placeholder="Нахил, темп, відчуття">${escapeHtml(session?.notes || "")}</textarea></div><div class="form-actions" style="justify-content:flex-end;margin-top:16px;"><button class="button button-secondary" type="button" data-action="close-overlay">Скасувати</button><button class="button button-primary" type="button" data-action="save-cardio" data-workout-id="${workoutId}" ${session ? `data-cardio-id="${session.id}"` : ""}><i data-lucide="check"></i>Зберегти</button></div>`);
    }

    function openAddExerciseModal() {
        openModal(`<div class="modal-header"><div><h2>Додати вправу</h2><p class="card-caption">Пошук за назвою + фільтри за групою м'язів і обладнанням.</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><div id="exercisePickerBody">${pickerBody()}</div>`);
    }

    function pickerBody() {
        const muscleGroups = unique(state.database.exercises.map((exercise) => exercise.primaryMuscleGroup).filter(Boolean));
        const equipmentList = unique(state.database.exercises.map((exercise) => exercise.equipment).filter(Boolean));
        const chip = (key, value, label) => `<button class="segment-button ${state.filters[key] === value ? "active" : ""}" type="button" data-action="picker-filter" data-key="${key}" data-value="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
        return `<input type="search" placeholder="Пошук за назвою або alias" value="${escapeHtml(state.filters.exerciseSearch)}" data-action="exercise-picker-search">
            <div class="picker-filter-block"><span class="picker-filter-label">Група м'язів</span><div class="picker-chips">${chip("pickerMuscle", "all", "Усі")}${muscleGroups.map((value) => chip("pickerMuscle", value, value)).join("")}</div></div>
            <div class="picker-filter-block"><span class="picker-filter-label">Обладнання</span><div class="picker-chips">${chip("pickerEquipment", "all", "Усі")}${equipmentList.map((value) => chip("pickerEquipment", value, value)).join("")}</div></div>
            <div class="exercise-picker-grid" id="exercisePickerGrid">${exercisePickerCards()}</div>`;
    }

    function setPickerFilter(key, value) {
        state.filters[key] = value;
        const body = element("exercisePickerBody");
        if (body) {
            body.innerHTML = pickerBody();
            icons();
        }
    }

    function pickerExercises() {
        const search = state.filters.exerciseSearch.trim().toLowerCase();
        const muscle = state.filters.pickerMuscle;
        const equip = state.filters.pickerEquipment;
        return state.database.exercises.filter((exercise) => {
            if (muscle !== "all" && exercise.primaryMuscleGroup !== muscle) {
                return false;
            }
            if (equip !== "all" && exercise.equipment !== equip) {
                return false;
            }
            if (!search) {
                return true;
            }
            return [exercise.name, exercise.aliases.join(" "), exercise.primaryMuscleGroup, exercise.secondaryMuscleGroups.join(" "), exercise.movementPattern, exercise.equipment, exercise.category, exercise.difficulty].join(" ").toLowerCase().includes(search);
        });
    }

    function exercisePickerCards() {
        const items = pickerExercises();
        if (!items.length) {
            return emptyInline("Нічого не знайдено", "Спробуй іншу назву, групу м'язів або обладнання.");
        }
        const limit = 60;
        // Order: liked first, then neutral, then disliked (same as the catalog);
        // within a reaction tier surface the current user's own exercises first.
        const sorted = items.slice().sort((left, right) => {
            const byReaction = reactionRank(left) - reactionRank(right);
            if (byReaction) {
                return byReaction;
            }
            const byMine = (isMyExercise(right) ? 1 : 0) - (isMyExercise(left) ? 1 : 0);
            if (byMine) {
                return byMine;
            }
            return String(left.name || "").localeCompare(String(right.name || ""), "uk");
        });
        const shown = sorted.slice(0, limit);
        const note = items.length > limit
            ? `<p class="card-caption picker-count">Показано ${limit} з ${items.length} — уточни пошук або фільтри.</p>`
            : `<p class="card-caption picker-count">Знайдено: ${items.length}</p>`;
        return note + shown.map((exercise) => `<article class="exercise-card${exerciseMedia(exercise) ? " has-thumb" : ""}">${exerciseThumb(exercise)}<h3>${escapeHtml(exercise.name)}${isMyExercise(exercise) ? `<span class="picker-mine-flag"><i data-lucide="bookmark-check"></i>Моя</span>` : ""}</h3><p class="card-caption">${escapeHtml(exercise.primaryMuscleGroup)} · ${escapeHtml(exercise.movementPattern)} · ${escapeHtml(exercise.equipment)}</p><button class="button button-primary compact" type="button" data-action="add-exercise" data-exercise-id="${exercise.id}">Додати</button></article>`).join("");
    }

    function openCustomExercise(exercise = null) {
        const data = exercise && exercise.id ? exercise : null;
        const isEdit = Boolean(data);
        // Free tier: 1 custom exercise per month. Editing your own is always allowed.
        if (!isEdit && !hasUnlimited() && exerciseQuotaState(currentUser().id).over) {
            openPaywallModal({ type: "exercise" });
            return;
        }
        const val = (value) => escapeHtml(value == null ? "" : String(value));
        const aliasesValue = data && Array.isArray(data.aliases) ? data.aliases.join(", ") : "";
        const previewBlock = data && imageUrl(data.mediaUrl)
            ? `<div class="media-url-preview" id="customExerciseMediaPreview"><img src="${val(data.mediaUrl)}" alt="${val(data.name)}" referrerpolicy="no-referrer" onerror="this.remove()"></div>`
            : `<div class="media-url-preview" id="customExerciseMediaPreview"></div>`;
        const moderationHint = isEdit
            ? `<p class="card-caption">${isAdmin() ? "Зміни застосуються одразу." : "Після збереження вправа знову піде на модерацію."}</p>`
            : `<p class="card-caption">${isAdmin() ? "Вправа з'явиться в каталозі одразу." : "Нова вправа піде на модерацію адміну."}</p>`;
        openModal(`<div class="modal-header"><div><h2>${isEdit ? "Редагувати вправу" : "Власна вправа"}</h2>${moderationHint}</div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><input type="hidden" id="customExerciseId" value="${val(data?.id)}"><div class="field-grid"><div class="field"><label>Назва</label><input id="customExerciseName" type="text" placeholder="Жим у Smith під кутом" value="${val(data?.name)}"></div><div class="field"><label>Аліаси</label><input id="customExerciseAliases" type="text" placeholder="Через кому" value="${val(aliasesValue)}"></div><div class="field"><label>Основний м'яз</label>${select("customExerciseMuscle", muscles(), data?.primaryMuscleGroup || "Груди")}</div><div class="field"><label>Патерн руху</label>${select("customExercisePattern", patterns(), data?.movementPattern || "Горизонтальний жим")}</div><div class="field"><label>Обладнання</label>${select("customExerciseEquipment", equipment(), data?.equipment || "Тренажер")}</div><div class="field"><label>Складність</label>${select("customExerciseDifficulty", ["Початковий", "Середній", "Просунутий"], data?.difficulty || "Середній")}</div></div><div class="field" style="margin-top:14px;"><label>Опис</label><textarea id="customExerciseDescription" placeholder="Коротке пояснення">${val(data?.description)}</textarea></div><div class="field" style="margin-top:14px;"><label>Зображення / GIF (посилання)</label><input id="customExerciseMedia" type="url" placeholder="https://...jpg, .png або .gif" data-action="custom-exercise-media" value="${val(data?.mediaUrl)}">${previewBlock}</div><div class="form-actions" style="justify-content:flex-end;margin-top:16px;"><button class="button button-secondary" type="button" data-action="close-overlay">Скасувати</button><button class="button button-primary" type="button" data-action="save-custom-exercise">${isEdit ? "Зберегти зміни" : "Зберегти вправу"}</button></div>`);
    }

    function editExercise(exerciseId) {
        const exercise = exerciseById(exerciseId);
        if (!exercise) {
            return;
        }
        if (!canEditExercise(exercise)) {
            toast("Немає доступу", "Редагувати можна лише власні вправи.");
            return;
        }
        openCustomExercise(exercise);
    }

    async function deleteExerciseEntry(exerciseId) {
        const exercise = exerciseById(exerciseId);
        if (!exercise) {
            return;
        }
        if (!canEditExercise(exercise)) {
            toast("Немає доступу", "Видаляти можна лише власні вправи.");
            return;
        }
        const confirmed = await confirmDialog(`Видалити вправу «${exercise.name}»? Дію не можна скасувати.`, { confirmLabel: "Видалити" });
        if (!confirmed) {
            return;
        }
        if (storage.mode === "api" && storage.apiClient.hasBaseUrl()) {
            await storage.apiClient.deleteExercise(exercise.id);
        }
        state.database.exercises = state.database.exercises.filter((item) => item.id !== exercise.id);
        if (storage.mode !== "api") {
            await persist({ silent: true });
        }
        renderSection();
        toast("Вправу видалено", exercise.name);
    }

    async function approveExerciseEntry(exerciseId) {
        if (!isAdmin()) {
            return;
        }
        const exercise = exerciseById(exerciseId);
        if (!exercise) {
            return;
        }
        if (storage.mode === "api" && storage.apiClient.hasBaseUrl()) {
            await storage.apiClient.approveExercise(exercise.id);
        }
        exercise.status = "approved";
        renderSection();
        toast("Вправу схвалено", exercise.name);
    }

    async function rejectExerciseEntry(exerciseId) {
        if (!isAdmin()) {
            return;
        }
        const exercise = exerciseById(exerciseId);
        if (!exercise) {
            return;
        }
        const confirmed = await confirmDialog(`Відхилити та видалити «${exercise.name}»? Вправу буде видалено з каталогу.`, { confirmLabel: "Відхилити" });
        if (!confirmed) {
            return;
        }
        if (storage.mode === "api" && storage.apiClient.hasBaseUrl()) {
            await storage.apiClient.rejectExercise(exercise.id);
        }
        state.database.exercises = state.database.exercises.filter((item) => item.id !== exercise.id);
        renderSection();
        toast("Вправу відхилено", exercise.name);
    }

    async function saveCustomExercise() {
        const name = inputValue("customExerciseName").trim();
        if (!name) {
            toast("Потрібна назва", "Додай зрозумілу назву вправи.");
            return;
        }
        const editId = inputValue("customExerciseId");
        const existing = editId ? exerciseById(editId) : null;
        if (existing && !canEditExercise(existing)) {
            toast("Немає доступу", "Редагувати можна лише власні вправи.");
            return;
        }
        const muscle = inputValue("customExerciseMuscle");
        const pattern = inputValue("customExercisePattern");
        const mediaUrl = imageUrl(inputValue("customExerciseMedia"));
        const mediaType = mediaUrl ? (/\.gif(\?|$)/i.test(mediaUrl) ? "gif" : "image") : "none";
        // Admins publish instantly; everyone else (create or edit) goes to moderation.
        const status = isAdmin() ? "approved" : "pending";
        const payload = {
            name,
            aliases: splitCsv(inputValue("customExerciseAliases")),
            primaryMuscleGroup: muscle,
            secondaryMuscleGroups: existing?.secondaryMuscleGroups || [],
            movementPattern: pattern,
            equipment: inputValue("customExerciseEquipment"),
            category: existing?.category || "Власна",
            difficulty: inputValue("customExerciseDifficulty"),
            description: inputValue("customExerciseDescription") || `${name} — власна вправа з фокусом на ${muscle.toLowerCase()}.`,
            techniqueSteps: existing?.techniqueSteps?.length ? existing.techniqueSteps : techniqueFor(pattern),
            commonMistakes: existing?.commonMistakes?.length ? existing.commonMistakes : mistakesFor(pattern),
            safetyTips: existing?.safetyTips?.length ? existing.safetyTips : safetyFor(pattern),
            mediaUrl,
            mediaType,
            isCustom: true
        };
        const apiMode = storage.mode === "api" && storage.apiClient.hasBaseUrl();

        if (existing) {
            Object.assign(existing, payload, { status, updatedAt: new Date().toISOString() });
            if (apiMode) {
                showSyncIndicator("loading", "Зберігаємо зміни");
                try {
                    await storage.apiClient.updateExercise(existing.id, payload);
                    showSyncIndicator("success", "Збережено");
                } catch (error) {
                    showSyncIndicator("error", friendlyError(error));
                    throw error;
                }
            } else {
                await persist({ silent: true });
            }
            closeOverlay();
            renderSection();
            toast(status === "pending" ? "Зміни на модерації" : "Вправу оновлено", name);
            return;
        }

        const newExercise = {
            id: createId("exercise"),
            ...payload,
            status,
            createdByUserId: currentUser().id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        if (apiMode) {
            showSyncIndicator("loading", "Зберігаємо вправу");
            try {
                const created = await storage.apiClient.createExercise(payload);
                if (created?.id) {
                    newExercise.id = created.id;
                    newExercise.createdByUserId = created.createdByUserId || newExercise.createdByUserId;
                    if (created.status) {
                        newExercise.status = created.status;
                    }
                }
                state.database.exercises.push(newExercise);
                showSyncIndicator("success", "Збережено");
            } catch (error) {
                showSyncIndicator("error", friendlyError(error));
                throw error;
            }
        } else {
            state.database.exercises.push(newExercise);
            await persist({ silent: true });
        }
        closeOverlay();
        renderSection();
        toast(status === "pending" ? "Відправлено на модерацію" : "Власну вправу створено", name);
    }

    function openPaywallModal(context = {}) {
        const isExercise = context.type === "exercise";
        const reason = isExercise
            ? "Ти вже додав власну вправу цього місяця."
            : (context.overDay ? "Ти вже провів тренування сьогодні." : "Ти використав 2 безкоштовні тренування цього тижня.");
        const limitsLine = isExercise
            ? "На безкоштовному тарифі — <strong>1 власна вправа на місяць</strong>."
            : "На безкоштовному тарифі — до <strong>1 тренування на день</strong> і <strong>2 на тиждень</strong>.";
        const title = isExercise ? "Більше власних вправ із PRO" : "Більше тренувань із PRO";
        const perks = [
            ["dumbbell", "До 2 тренувань на день", "Free — 1 на день і 2 на тиждень"],
            ["list-plus", "До 30 власних вправ", "Free — лише 1 вправа на місяць"],
            ["bar-chart-3", "Розширена аналітика", "Глибша статистика прогресу та PR"],
            ["cloud", "Пріоритетна синхронізація", "Швидші бекапи й відновлення"]
        ];
        openModal(`<div class="paywall">
            <div class="paywall-glow"></div>
            <button class="icon-button paywall-close" type="button" data-action="close-overlay"><i data-lucide="x"></i></button>
            <div class="paywall-badge"><i data-lucide="zap"></i>GymOS PRO</div>
            <h2 class="paywall-title">${escapeHtml(title)}</h2>
            <p class="paywall-reason">${escapeHtml(reason)} ${limitsLine}</p>
            <div class="paywall-price"><span class="paywall-amount">$2</span><span class="paywall-period">/місяць</span></div>
            <ul class="paywall-perks">${perks.map(([icon, title, sub]) => `<li><span class="paywall-perk-icon"><i data-lucide="${icon}"></i></span><span><strong>${escapeHtml(title)}</strong><em>${escapeHtml(sub)}</em></span></li>`).join("")}</ul>
            <div class="paywall-actions"><button class="button button-primary paywall-cta" type="button" data-action="upgrade-plan"><i data-lucide="rocket"></i>Оформити PRO за $2/міс</button><button class="button button-secondary" type="button" data-action="close-overlay">Можливо пізніше</button></div>
            <p class="paywall-foot">Оплата скоро з'явиться — зараз це прев'ю тарифу.</p>
        </div>`);
    }

    function showUpgradeComingSoon() {
        toast("Дякуємо за інтерес!", "Онлайн-оплата PRO скоро запрацює. Поки що це прев'ю тарифу.");
    }

    function openProfileEditor() {
        const user = currentUser();
        openModal(`<div class="modal-header"><div><h2>Редагувати профіль</h2><p class="card-caption">Редагувати можна тільки профіль активного користувача.</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><div class="field-grid"><div class="field"><label>Ім'я</label><input id="profileName" type="text" value="${escapeHtml(user.name)}"></div><div class="field"><label>Публічне ім'я</label><input id="profileDisplayName" type="text" value="${escapeHtml(user.displayName)}"></div><div class="field"><label>Зріст</label><input id="profileHeight" type="number" value="${user.height}"></div><div class="field"><label>Вага тіла</label><input id="profileBodyweight" type="number" step="0.1" value="${user.bodyweight}"></div><div class="field"><label>Тренувальна ціль</label><input id="profileGoal" type="text" value="${escapeHtml(user.trainingGoal)}"></div><div class="field"><label>Досвід</label><input id="profileExperience" type="text" value="${escapeHtml(user.trainingExperience)}"></div><div class="field"><label>Улюблена група</label>${select("profileMuscle", muscles(), user.favoriteMuscleGroup)}</div><div class="field"><label>Категорія</label><gym-select id="profileGender"><option value="male" ${user.gender === "male" ? "selected" : ""}>чоловіча</option><option value="female" ${user.gender === "female" ? "selected" : ""}>жіноча</option></gym-select></div></div><div class="field-grid" style="margin-top:14px;"><div class="field"><label>Дата заміру</label><gym-date id="bodyweightDate" value="${dateInput(new Date())}"></gym-date></div><div class="field"><label>Додати запис ваги</label><input id="bodyweightValue" type="number" step="0.1" value="${user.bodyweight}"></div></div><div class="form-actions" style="justify-content:flex-end;margin-top:16px;"><button class="button button-secondary" type="button" data-action="close-overlay">Скасувати</button><button class="button button-primary" type="button" data-action="save-profile">Зберегти профіль</button></div>`);
    }

    async function saveProfile() {
        const user = currentUser();
        user.name = inputValue("profileName") || user.name;
        user.displayName = inputValue("profileDisplayName") || user.displayName;
        user.height = numberValue("profileHeight", user.height);
        user.bodyweight = numberValue("profileBodyweight", user.bodyweight);
        user.trainingGoal = inputValue("profileGoal") || user.trainingGoal;
        user.trainingExperience = inputValue("profileExperience") || user.trainingExperience;
        user.favoriteMuscleGroup = inputValue("profileMuscle") || user.favoriteMuscleGroup;
        user.gender = inputValue("profileGender") || user.gender;
        user.updatedAt = new Date().toISOString();
        await saveBodyweight(false);
        if (storage.mode === "api" && storage.apiClient.hasBaseUrl()) {
            showSyncIndicator("loading", "Зберігаємо профіль");
            try {
                const payload = {
                    name: user.name,
                    displayName: user.displayName,
                    gender: user.gender === "female" ? "female" : "male",
                    trainingGoal: user.trainingGoal || "",
                    trainingExperience: user.trainingExperience || "",
                    favoriteMuscleGroup: user.favoriteMuscleGroup || ""
                };
                if (user.height >= 80 && user.height <= 240) {
                    payload.height = user.height;
                }
                if (user.bodyweight >= 20 && user.bodyweight <= 300) {
                    payload.bodyweight = user.bodyweight;
                }
                await storage.apiClient.updateProfile(payload);
                showSyncIndicator("success", "Збережено");
            } catch (error) {
                showSyncIndicator("error", friendlyError(error));
                throw error;
            }
        } else {
            await persist({ silent: true });
        }
        closeOverlay();
        renderSection();
        toast("Профіль збережено", user.displayName);
    }

    async function saveBodyweight(shouldRender = true) {
        const value = numberValue("bodyweightValue", 0);
        if (!value) {
            return;
        }
        const date = inputValue("bodyweightDate") || dateInput(new Date());
        state.database.bodyweightEntries.push({ id: createId("bodyweight"), userId: currentUser().id, date, bodyweight: value, notes: "Ручний запис" });
        currentUser().bodyweight = value;
        if (storage.mode === "api" && storage.apiClient.hasBaseUrl() && value >= 20 && value <= 300) {
            try {
                await storage.apiClient.createBodyweight({ date, bodyweight: value, notes: "Ручний запис" });
            } catch (error) {
                console.error(error);
            }
        }
        if (shouldRender) {
            if (storage.mode !== "api") {
                await persist({ silent: true });
            }
            closeOverlay();
            renderSection();
        }
    }

    async function startNewWorkout() {
        if (!isAdmin()) {
            const quota = workoutQuotaState(currentUser().id);
            if (quota.over) {
                closeOverlay();
                openPaywallModal(Object.assign({ type: "workout" }, quota));
                return;
            }
        }
        const canStart = await ensureSingleActiveWorkout();
        if (!canStart) {
            return;
        }
        const now = new Date();
        const workoutItem = {
            id: createId("workout"),
            userId: currentUser().id,
            date: dateInput(now),
            title: "Тренування",
            status: "active",
            workoutType: "custom",
            startedAt: now.toISOString(),
            finishedAt: null,
            notes: "",
            exercises: [],
            cardioSessions: [],
            createdAt: now.toISOString(),
            updatedAt: now.toISOString()
        };
        state.database.workouts.push(workoutItem);
        state.editingWorkoutId = workoutItem.id;
        await persistWorkout(workoutItem);
        closeOverlay();
        goToWorkoutEditor(workoutItem.id);
        toast("Тренування почато", "Додай вправи, підходи або кардіо.");
    }

    function openWorkoutEditor(workoutId) {
        const workoutItem = state.database.workouts.find((item) => item.id === workoutId);
        if (!workoutItem) {
            return;
        }
        if (!canManage(workoutItem)) {
            openWorkout(workoutId);
            return;
        }
        closeOverlay();
        goToWorkoutEditor(workoutId);
    }

    async function reopenWorkout(workoutId) {
        const workoutItem = ownWorkout(workoutId);
        if (!workoutItem) {
            return;
        }
        const canStart = await ensureSingleActiveWorkout(workoutItem.id);
        if (!canStart) {
            return;
        }
        workoutItem.status = "active";
        workoutItem.finishedAt = null;
        if (!workoutItem.startedAt) {
            workoutItem.startedAt = new Date().toISOString();
        }
        workoutItem.updatedAt = new Date().toISOString();
        state.editingWorkoutId = workoutItem.id;
        await persistWorkout(workoutItem);
        goToWorkoutEditor(workoutItem.id);
        toast("Тренування відновлено", workoutLabel(workoutItem));
    }

    async function startExistingWorkout(workoutId) {
        await reopenWorkout(workoutId);
    }

    async function deleteWorkout(workoutId) {
        const workoutItem = state.database.workouts.find((item) => item.id === workoutId);
        if (!workoutItem || !canManage(workoutItem)) {
            toast("Лише перегляд", "Видаляти можна тільки власні тренування.");
            return;
        }
        if (!(await confirmDialog("Видалити це тренування? Дію не можна скасувати.", { confirmLabel: "Видалити" }))) {
            return;
        }
        const removedLabel = workoutLabel(workoutItem);
        cancelWorkoutSave(workoutId);
        state.database.workouts = state.database.workouts.filter((item) => item.id !== workoutId);
        if (state.editingWorkoutId === workoutId) {
            state.editingWorkoutId = null;
        }
        if (storage.mode === "api" && storage.apiClient.hasBaseUrl()) {
            showSyncIndicator("loading", "Видаляємо тренування");
            try {
                await storage.apiClient.deleteWorkout(workoutId);
                showSyncIndicator("success", "Видалено");
            } catch (error) {
                if (Number(error?.status) !== 404) {
                    showSyncIndicator("error", friendlyError(error));
                    throw error;
                }
            }
        } else {
            await persist({ silent: true });
        }
        closeOverlay();
        renderSection();
        toast("Тренування видалено", removedLabel);
    }

    async function ensureSingleActiveWorkout(excludedWorkoutId = null) {
        const existing = activeWorkoutFor(currentUser().id);
        if (!existing || existing.id === excludedWorkoutId) {
            return true;
        }
        if (!(await confirmDialog("У тебе вже є активне тренування. Завершити його і почати нове?", { confirmLabel: "Завершити і почати", danger: false }))) {
            return false;
        }
        existing.status = "completed";
        existing.finishedAt = new Date().toISOString();
        existing.updatedAt = new Date().toISOString();
        return true;
    }

    async function addExercise(exerciseId) {
        const workoutItem = editWorkout();
        if (!workoutItem || !canManage(workoutItem)) {
            toast("Спочатку почни тренування", "Відкрий або почни тренування, щоб додати вправу.");
            return;
        }
        const exercise = exerciseById(exerciseId);
        const workoutExerciseId = createId("workout-exercise");
        workoutItem.exercises.push({ id: workoutExerciseId, exerciseId, order: workoutItem.exercises.length + 1, notes: "", sets: suggestedSets(exercise) });
        workoutItem.updatedAt = new Date().toISOString();
        state.editingWorkoutId = workoutItem.id;
        pendingExerciseScrollId = workoutExerciseId;
        await persistWorkout(workoutItem);
        closeOverlay();
        if (state.section === "workout") {
            renderSection();
        } else {
            goToWorkoutEditor(workoutItem.id);
        }
        toast("Вправу додано", exercise.name);
    }

    async function removeWorkoutExercise(workoutExerciseId) {
        const workoutItem = editWorkout();
        if (!workoutItem) {
            return;
        }
        if (!(await confirmDialog("Видалити цю вправу з тренування?", { confirmLabel: "Видалити" }))) {
            return;
        }
        workoutItem.exercises = workoutItem.exercises.filter((item) => item.id !== workoutExerciseId);
        workoutItem.updatedAt = new Date().toISOString();
        await persistWorkout(workoutItem);
        renderSection();
    }

    async function addSet(workoutExerciseId) {
        const workoutExercise = editWorkoutExercise(workoutExerciseId);
        if (!workoutExercise) {
            return;
        }
        const previousSet = workoutExercise.sets.at(-1);
        workoutExercise.sets.push(previousSet ? { ...previousSet, id: createId("set"), isCompleted: false } : createSet("working", 0, 8, 8, 90, false));
        await persistWorkout(editWorkout());
        renderSection();
    }

    async function toggleSet(workoutExerciseId, setId) {
        const set = editSetByIds(workoutExerciseId, setId);
        if (!set) {
            return;
        }
        set.isCompleted = !set.isCompleted;
        if (set.isCompleted && editWorkout()?.status === "active") {
            startTimer(set.restSeconds || 90);
            toast("Підхід завершено", `Таймер відпочинку: ${seconds(set.restSeconds || 90)}`);
        }
        await persistWorkout(editWorkout());
        renderSection();
    }

    async function deleteSet(workoutExerciseId, setId) {
        const workoutExercise = editWorkoutExercise(workoutExerciseId);
        if (!workoutExercise) {
            return;
        }
        if (!(await confirmDialog("Видалити цей підхід?", { confirmLabel: "Видалити" }))) {
            return;
        }
        workoutExercise.sets = workoutExercise.sets.filter((set) => set.id !== setId);
        await persistWorkout(editWorkout());
        renderSection();
    }

    async function updateSetField(workoutExerciseId, setId, field, value) {
        const set = editSetByIds(workoutExerciseId, setId);
        if (!set) {
            return;
        }
        set[field] = ["weight", "repetitions", "rpe", "restSeconds"].includes(field) ? Number(value) || 0 : value;
        schedulePersistWorkout(editWorkout());
    }

    async function updateWorkoutMeta(workoutId, field, value) {
        const workoutItem = ownWorkout(workoutId);
        if (!workoutItem) {
            return;
        }
        workoutItem[field] = value;
        workoutItem.updatedAt = new Date().toISOString();
        await persistWorkout(workoutItem);
        renderSection();
    }

    async function finishWorkout(workoutId) {
        const workoutItem = workoutId ? ownWorkout(workoutId) : (editWorkout() || activeWorkoutFor(currentUser().id));
        if (!workoutItem) {
            return;
        }
        workoutItem.status = "completed";
        workoutItem.finishedAt = new Date().toISOString();
        workoutItem.updatedAt = new Date().toISOString();
        stopTimer();
        await persistWorkout(workoutItem);
        renderSection();
        toast("Тренування завершено", "Статистику та рекорди перераховано.");
    }

    async function saveCardio(workoutId, cardioId = null) {
        const workoutItem = ownWorkout(workoutId);
        if (!workoutItem) {
            return;
        }
        const duration = Math.max(1, Math.round(numberValue("cardioDuration", 0)));
        if (!duration) {
            toast("Вкажи час", "Тривалість кардіо обов'язкова.");
            return;
        }
        const data = {
            type: inputValue("cardioType") || "treadmill",
            durationMinutes: duration,
            distance: round(numberValue("cardioDistance", 0), 2),
            calories: Math.round(numberValue("cardioCalories", 0)),
            averageHeartRate: Math.round(numberValue("cardioHeartRate", 0)),
            intensity: inputValue("cardioIntensity") || "medium",
            notes: inputValue("cardioNotes").trim()
        };
        workoutItem.cardioSessions = workoutItem.cardioSessions || [];
        const existing = cardioId ? workoutItem.cardioSessions.find((item) => item.id === cardioId) : null;
        if (existing) {
            Object.assign(existing, data);
        } else {
            workoutItem.cardioSessions.push({ id: createId("cardio"), ...data });
        }
        workoutItem.updatedAt = new Date().toISOString();
        await persistWorkout(workoutItem);
        closeOverlay();
        renderSection();
        toast(existing ? "Кардіо оновлено" : "Кардіо додано", `${cardioTypeLabel(data.type)} · ${data.durationMinutes} хв`);
    }

    async function deleteCardio(workoutId, cardioId) {
        const workoutItem = ownWorkout(workoutId);
        if (!workoutItem) {
            return;
        }
        if (!(await confirmDialog("Видалити цей кардіо-блок?", { confirmLabel: "Видалити" }))) {
            return;
        }
        workoutItem.cardioSessions = (workoutItem.cardioSessions || []).filter((item) => item.id !== cardioId);
        workoutItem.updatedAt = new Date().toISOString();
        await persistWorkout(workoutItem);
        renderSection();
    }


    function strengthStandardsLinks(exercise) {
        const haystack = `${exercise?.name || ""} ${(exercise?.aliases || []).join(" ")}`.toLowerCase();
        const isBench = /жим лежачи|bench/.test(haystack);
        const links = isBench
            ? [
                ["Strength Level — жим лежачи", "https://strengthlevel.com/strength-standards/bench-press/kg", "Нормативи за вагою тіла й статтю (beginner→elite)"],
                ["Symmetric Strength", "https://symmetricstrength.com/", "Калькулятор рівня сили за вагою тіла"]
            ]
            : [
                ["Strength Level — стандарти сили", "https://strengthlevel.com/strength-standards", "Нормативи для більшості вправ"],
                ["Symmetric Strength", "https://symmetricstrength.com/", "Оцінка сили за вагою тіла"]
            ];
        const caption = isBench
            ? "Звір свій 1ПМ із реальними нормативами для аматорів."
            : "Зовнішні таблиці нормативів — звір свій 1ПМ із реальними рівнями.";
        return `<section class="panel" style="margin-top:14px;"><h3>Актуальні нормативи</h3><p class="card-caption">${caption}</p><div class="ext-links">${links.map(([title, href, sub]) => `<a class="ext-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener"><span class="ext-link-icon"><i data-lucide="bar-chart-3"></i></span><span class="ext-link-text"><strong>${escapeHtml(title)}</strong><em>${escapeHtml(sub)}</em></span><i data-lucide="external-link" class="ext-link-arrow"></i></a>`).join("")}</div></section>`;
    }

    function statChip(value, label, icon) {
        return `<div class="stat-chip"><span class="stat-chip-ico"><i data-lucide="${icon}"></i></span><div class="stat-chip-body"><div class="stat-chip-value">${escapeHtml(String(value))}</div><div class="stat-chip-label">${escapeHtml(label)}</div></div></div>`;
    }

    // Rich per-exercise analytics for the drawer: records, 1RM progress chart,
    // and the last sessions with a trend vs the previous one.
    function exerciseAnalytics(exerciseId) {
        const userId = currentUser().id;
        const sessions = exerciseInstances(userId, exerciseId).map((instance) => {
            const working = instance.sets.filter((set) => set.isCompleted && set.type !== "warmup");
            let top = null;
            working.forEach((set) => {
                const estimate = oneRepMax(set.weight, set.repetitions);
                if (!top || estimate > top.estimate) {
                    top = { weight: set.weight, repetitions: set.repetitions, estimate };
                }
            });
            const volume = round(working.reduce((sum, set) => sum + set.weight * set.repetitions, 0), 1);
            return { date: instance.date, working, top, volume, oneRm: top ? top.estimate : 0 };
        }).filter((session) => session.working.length);

        if (!sessions.length) {
            return `<section class="panel" style="margin-top:14px;"><h3>Аналітика прогресу</h3>${emptyInline("Ще немає даних", "Заверши тренування з цією вправою, щоб побачити рекорди, графік прогресу й динаміку останніх сесій.")}</section>`;
        }

        const allSets = sessions.flatMap((session) => session.working);
        const bestWeight = Math.max(...allSets.map((set) => set.weight));
        const bestSet = sessions.map((session) => session.top).sort((left, right) => right.estimate - left.estimate)[0];
        const best1RM = round(Math.max(...sessions.map((session) => session.oneRm)), 1);
        const teamBest = teamBestResult(exerciseId);
        const lastDate = sessions[0].date;
        const days = Math.round((startDay(new Date()) - startDay(new Date(lastDate))) / 86400000);
        const daysLabel = days <= 0 ? "сьогодні" : days === 1 ? "вчора" : `${days} дн. тому`;

        const chips = [
            statChip(`${number(bestWeight)} кг`, "Найкраща вага", "dumbbell"),
            statChip(`${bestSet.weight}×${bestSet.repetitions}`, "Найкращий сет", "layers"),
            statChip(`${number(best1RM)} кг`, "Найкращий 1ПМ", "trophy"),
            statChip(sessions.length, "Разів виконано", "repeat")
        ].join("");

        const recent = sessions.slice(0, 6);
        const rows = recent.map((session, index) => {
            const older = sessions[index + 1];
            let trend = `<span class="session-trend flat"></span>`;
            if (older && older.oneRm) {
                const delta = round(session.oneRm - older.oneRm, 1);
                if (delta > 0) {
                    trend = `<span class="session-trend up"><i data-lucide="trending-up"></i>+${number(delta)}</span>`;
                } else if (delta < 0) {
                    trend = `<span class="session-trend down"><i data-lucide="trending-down"></i>${number(delta)}</span>`;
                } else {
                    trend = `<span class="session-trend flat"><i data-lucide="minus"></i></span>`;
                }
            }
            return `<div class="session-row"><div class="session-date">${shortDate(session.date)}</div><div class="session-cell"><span class="session-cell-value">${session.top.weight}×${session.top.repetitions}</span><span class="session-cell-label">сет</span></div><div class="session-cell"><span class="session-cell-value">${number(session.volume)}</span><span class="session-cell-label">обсяг</span></div><div class="session-cell"><span class="session-cell-value">${number(session.oneRm)}</span><span class="session-cell-label">1ПМ</span></div>${trend}</div>`;
        }).join("");

        return `<section class="panel exercise-analytics" style="margin-top:14px;">
            <div><h3>Аналітика прогресу</h3><p class="card-caption">Останнє виконання: ${daysLabel} · ${formatDate(lastDate)}${teamBest ? ` · командний максимум ${number(teamBest.estimatedOneRepMax)} кг` : ""}</p></div>
            <div class="stat-chips">${chips}</div>
            <div class="chart-box exercise-progress"><canvas id="exerciseProgressChart"></canvas></div>
            <h4 class="analytics-subhead">Останні сесії</h4>
            <div class="session-list">${rows}</div>
        </section>`;
    }

    function openExercise(exerciseId) {
        const exercise = exerciseById(exerciseId);
        openDrawer(`<div class="drawer-header"><div><h2>${escapeHtml(exercise.name)}</h2><p class="card-caption">${exercise.primaryMuscleGroup} · ${exercise.movementPattern} · ${exercise.equipment}</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div>${media(exercise)}${exerciseSourceBlock(exercise)}${exerciseAnalytics(exerciseId)}<section class="panel" style="margin-top:14px;"><h3>Техніка</h3>${ordered(exercise.techniqueSteps)}</section>${strengthStandardsLinks(exercise)}<section class="panel" style="margin-top:14px;"><h3>Схожі вправи</h3><div class="workout-stack">${relatedExercises(exerciseId).slice(0, 3).map((item) => `<button class="nav-button" type="button" data-action="open-exercise" data-exercise-id="${item.id}"><span>${escapeHtml(item.name)}</span><strong class="nav-badge">${escapeHtml(item.primaryMuscleGroup)}</strong></button>`).join("") || emptyInline("Схожих вправ немає", "Розшир каталог у налаштуваннях.")}</div></section>`);
        const points = progressData(currentUser().id, exerciseId);
        const existing = state.charts.get("exerciseProgressChart");
        if (existing) {
            existing.destroy();
            state.charts.delete("exerciseProgressChart");
        }
        requestAnimationFrame(() => lineChart("exerciseProgressChart", points.map((point) => shortDate(point.date)), points.map((point) => point.value), "1ПМ, кг"));
    }

    function openWorkout(workoutId) {
        const workoutItem = state.database.workouts.find((item) => item.id === workoutId);
        const owner = userById(workoutItem.userId);
        const readonly = !canManage(workoutItem);
        const totalSets = workoutSetCount(workoutItem);
        const cardioMinutes = workoutCardioMinutes(workoutItem);
        openDrawer(`<div class="drawer-header"><div><h2>${escapeHtml(workoutLabel(workoutItem))}</h2><p class="card-caption"><button class="link-button" type="button" data-action="open-user" data-user-id="${owner.id}">${escapeHtml(owner.displayName)}</button> · ${formatDate(workoutItem.date)} · ${statusLabel(workoutItem.status)} · ${workoutTypeLabel(workoutItem.workoutType)}</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div>${readonly ? `<div class="readonly-layer">Лише перегляд: це тренування іншого користувача.</div>` : ""}<section class="panel">${kpi([{ label: "Вправи", value: workoutItem.exercises.length }, { label: "Підходи", value: totalSets }, { label: "Обсяг", value: `${number(workoutVolume(workoutItem))} кг` }, { label: "Кардіо", value: `${cardioMinutes} хв` }, { label: "Тривалість", value: `${duration(workoutItem)} хв` }])}${workoutItem.notes ? `<p class="card-caption" style="margin-top:12px;">${escapeHtml(workoutItem.notes)}</p>` : ""}<div class="action-row wrap" style="margin-top:14px;">${readonly ? "" : `<button class="button button-primary compact" type="button" data-action="edit-workout" data-workout-id="${workoutItem.id}"><i data-lucide="pen-line"></i>Керувати</button>${workoutItem.status === "active" ? `<button class="button button-secondary compact" type="button" data-action="finish-workout" data-workout-id="${workoutItem.id}"><i data-lucide="flag"></i>Завершити</button>` : `<button class="button button-secondary compact" type="button" data-action="reopen-workout" data-workout-id="${workoutItem.id}"><i data-lucide="rotate-ccw"></i>Відновити</button>`}<button class="button button-danger compact" type="button" data-action="delete-workout" data-workout-id="${workoutItem.id}"><i data-lucide="trash-2"></i>Видалити</button>`}</div></section><div class="workout-stack" style="margin-top:14px;">${workoutItem.exercises.length ? workoutItem.exercises.map((workoutExercise) => `<article class="panel"><h3>${escapeHtml(exerciseById(workoutExercise.exerciseId).name)}</h3><p class="card-caption">${workoutExercise.sets.length} підходів · ${number(exerciseVolume(workoutExercise))} кг</p><div class="tag-row">${workoutExercise.sets.map((set) => `<span class="chip">${setTypeLabel(set.type)} · ${set.weight} × ${set.repetitions}${set.isCompleted ? " · готово" : ""}</span>`).join("")}</div></article>`).join("") : emptyInline("Вправ ще немає", "Це порожнє або кардіо-тренування.")}</div>`);
    }

    function requestNotifications() {
        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission().catch(() => {});
        }
        startTimer(10);
        toast("Таймер запущено", "10-секундний тест таймера відпочинку.");
    }

    async function setUserApproval(userId, approved) {
        if (!isAdmin()) {
            toast("Немає прав", "Лише адміністратор може підтверджувати користувачів.");
            return;
        }
        try {
            await storage.apiClient.setUserApproval(userId, approved);
            const targetUser = userById(userId);
            if (targetUser) {
                targetUser.approved = approved;
            }
            renderSection();
            toast(approved ? "Користувача підтверджено" : "Доступ відкликано", targetUser?.displayName || "");
        } catch (error) {
            showSyncIndicator("error", friendlyError(error));
        }
    }

    async function checkBackendConnection() {
        try {
            await storage.checkBackend(true);
            await storage.refreshCurrentUser(false);
            toast("Бекенд доступний", storage.apiBaseUrl || "API URL активний.");
        } catch (error) {
            toast("Бекенд недоступний", storage.config.allowLocalFallback === false ? "Перевір deployment і env variables." : "Застосунок залишився в локальному деморежимі.");
            if (storage.config.allowLocalFallback !== false) {
                await storage.setMode("local");
            }
        }
        if (storage.requiresAuthentication()) {
            renderAuthGate();
            return;
        }
        renderSection();
    }

    async function changeDataMode(mode) {
        await storage.setMode(mode);
        if (mode === "api" && storage.backendStatus !== "online") {
            toast("Бекенд недоступний", "Повертаю демо у локальний режим.");
            await storage.setMode("local");
        } else {
            toast("Режим даних змінено", dataModeLabel(storage.mode));
        }
        renderSection();
    }

    async function updateApiBaseUrl(value) {
        await storage.setApiBaseUrl(value);
    }

    function loginWithGoogle() {
        try {
            storage.loginWithGoogle();
        } catch (error) {
            toast("API URL не налаштовано", "Додай backend URL у налаштуваннях перед Google OAuth.");
        }
    }

    async function logout() {
        try {
            localStorage.removeItem("gymos-auth-token");
        } catch (error) {
            console.warn("Token clear failed", error);
        }
        try {
            await storage.logout();
            toast("Вихід виконано", "Сесію завершено.");
        } catch (error) {
            toast("Бекенд недоступний", "Локальний деморежим продовжує працювати.");
        }
        if (storage.config.requireAuth) {
            state.database = createEmptyDatabase();
            renderAuthGate();
        }
    }

    function exportData() {
        const blob = new Blob([JSON.stringify(state.database, null, 4)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `gymos-export-${dateInput(new Date())}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        toast("Дані експортовано", "JSON-файл завантажено.");
    }

    async function importData(file) {
        if (!file) {
            return;
        }

        let overlay = null;
        try {
            const data = JSON.parse(await file.text());
            // strengthStandards is no longer part of the export payload (regenerated
            // client-side on demand), so it isn't required for a valid import.
            ["users", "exercises", "workouts", "bodyweightEntries"].forEach((key) => {
                if (!Array.isArray(data[key])) {
                    throw new Error(`Missing ${key}`);
                }
            });

            if (storage.mode === "api") {
                overlay = showBusyOverlay({
                    title: "Імпорт даних",
                    message: "Готуємо безпечну передачу у backend.",
                    detail: "Глобальний каталог не відправляється повторно.",
                    progress: 0
                });
                const result = await storage.importUserData(data, {
                    onProgress: (progress) => {
                        updateBusyOverlay(overlay, {
                            message: `Відправляємо ${resourceLabel(progress.resource)}.`,
                            detail: `Пачка ${progress.current}/${progress.total}. Елементів у пачці: ${progress.items}.`,
                            progress: progress.total ? Math.round((progress.current / progress.total) * 100) : 100
                        });
                    }
                });
                updateBusyOverlay(overlay, {
                    message: "Оновлюємо дані з backend.",
                    detail: "Фінальна перевірка після імпорту.",
                    progress: 100
                });
                state.database = await storage.load();
                state.profileUserId = state.database.currentUserId;
                renderShell();
                renderSection();
                toast("Дані імпортовано", `Тренувань: ${result.imported.workouts}, замірів ваги: ${result.imported.bodyweightEntries}.`);
                return;
            }

            state.database = data;
            state.profileUserId = data.currentUserId;
            await persist();
            renderSection();
            toast("Дані імпортовано", "Локальну базу оновлено.");
        } catch (error) {
            console.error(error);
            toast("Імпорт не вдався", "JSON-структура не підходить для GymOS.");
        } finally {
            hideBusyOverlay(overlay);
        }
    }

    async function importExerciseCatalog(file) {
        if (!file) {
            return;
        }

        let overlay = null;
        try {
            const data = JSON.parse(await file.text());

            if (storage.mode === "api") {
                overlay = showBusyOverlay({
                    title: "Імпорт каталогу вправ",
                    message: "Розбиваємо JSON на маленькі пачки.",
                    detail: "ExRx media лишаються reference-only, без hotlink у production.",
                    progress: 0
                });

                const result = await storage.importExerciseCatalog(data, {
                    onProgress: (progress) => {
                        console.log(
                            `Exercise catalog import ${progress.current}/${progress.total}`,
                            progress
                        );
                        updateBusyOverlay(overlay, {
                            message: "Відправляємо каталог у backend.",
                            detail: `Пачка ${progress.current}/${progress.total}. Вправ у пачці: ${progress.exercises}.`,
                            progress: progress.total ? Math.round((progress.current / progress.total) * 100) : 100
                        });
                    }
                });

                updateBusyOverlay(overlay, {
                    message: "Оновлюємо каталог з backend.",
                    detail: "Завантажуємо актуальний список вправ.",
                    progress: 100
                });
                state.database = await storage.load();

                toast(
                    "Каталог імпортовано",
                    `Отримано: ${result.received}, додано: ${result.imported}, пропущено: ${result.skipped}.`
                );
            } else {
                const result = mergeImportedExerciseCatalog(state.database.exercises, data);
                state.database.exercises = result.exercises;
                await persist();
                toast("Каталог імпортовано", `Додано: ${result.imported}, пропущено: ${result.skipped}.`);
            }

            renderSection();
        } catch (error) {
            console.error(error);
            toast("Імпорт каталогу не вдався", "Перевір JSON, авторизацію або розмір payload.");
        } finally {
            hideBusyOverlay(overlay);
        }
    }

    async function resetCuratedExercises() {
        if (!(await confirmDialog("Залишити тільки жим лежачи і тягу верхнього блока? Залежні зв'язки зі старими вправами будуть очищені.", { confirmLabel: "Очистити" }))) {
            return;
        }

        let overlay = null;
        try {
            overlay = showBusyOverlay({
                title: "Очищення каталогу",
                message: "Залишаємо curated-набір вправ.",
                detail: "Жим лежачи і тяга верхнього блока будуть доступні всім користувачам.",
                progress: 25
            });

            if (storage.mode === "api") {
                await storage.resetCuratedExercises();
                updateBusyOverlay(overlay, {
                    message: "Перечитуємо backend.",
                    detail: "Оновлюємо каталог і пов'язані тренування.",
                    progress: 85
                });
                state.database = await storage.load();
            } else {
                const curatedExercises = createExercises();
                const curatedIds = new Set(curatedExercises.map((exercise) => exercise.id));
                state.database.exercises = curatedExercises;
                state.database.strengthStandards = createStandards(curatedExercises);
                state.database.workouts.forEach((workoutItem) => {
                    workoutItem.exercises = workoutItem.exercises.filter((workoutExercise) => curatedIds.has(workoutExercise.exerciseId));
                });
                await persist();
            }

            updateBusyOverlay(overlay, {
                message: "Каталог оновлено.",
                detail: "Зайві вправи прибрані з інтерфейсу.",
                progress: 100
            });
            renderShell();
            renderSection();
            toast("Каталог очищено", "Залишено жим лежачи і тягу верхнього блока.");
        } finally {
            hideBusyOverlay(overlay);
        }
    }

    async function resetData() {
        if (!(await confirmDialog(storage.mode === "api" ? "Очистити локальний кеш і перечитати дані з backend?" : "Скинути всі локальні demo data?", { confirmLabel: "Скинути" }))) {
            return;
        }
        await storage.reset();
        if (storage.mode === "api") {
            state.database = await storage.load();
            state.profileUserId = state.database.currentUserId;
            renderShell();
            renderSection();
            toast("Кеш очищено", "Дані перечитано з backend.");
            return;
        }
        state.database = createSeedDatabase();
        state.profileUserId = state.database.currentUserId;
        await persist();
        renderSection();
        toast("Демодані скинуто", "Створено свіжу локальну базу.");
    }

    // Subtle "?" trigger that opens a delayed, JS-positioned tooltip (see
    // setupTooltips). Text lives in escaped data-attributes; no markup needed.
    function infoTip(title, body) {
        return `<button class="info-tip" type="button" tabindex="0" aria-label="${escapeHtml(title)}: пояснення" data-tip-title="${escapeHtml(title)}" data-tip-body="${escapeHtml(body)}"><i data-lucide="info"></i></button>`;
    }

    // Card <h2> heading with an optional inline info trigger next to it.
    function sectionHeading(title, tip) {
        return `<div class="section-heading"><h2>${escapeHtml(title)}</h2>${tip ? infoTip(title, tip) : ""}</div>`;
    }

    function metric(title, value, icon, caption, span = "span-3", tip = "") {
        // Compact stat tile: icon + value + label. caption kept in the signature
        // for callers but rendered as a title attr only (minimalist, less height).
        return `<section class="metric-card ${span}"${caption ? ` title="${escapeHtml(caption)}"` : ""}><span class="metric-icon"><i data-lucide="${icon}"></i></span><div class="metric-body"><div class="metric-value">${escapeHtml(String(value))}</div><div class="metric-label"><span class="metric-label-text">${escapeHtml(title)}</span>${tip ? infoTip(title, tip) : ""}</div></div></section>`;
    }

    function chartCard(title, caption, canvasId, span, tip = "") {
        return `<section class="card ${span} chart-card"><div class="card-header"><div>${sectionHeading(title, tip)}<p class="card-caption">${escapeHtml(caption)}</p></div></div><div class="chart-box"><canvas id="${canvasId}"></canvas></div></section>`;
    }

    function kpi(items) {
        return `<div class="kpi-strip">${items.map((item) => `<div class="kpi-item"><div class="kpi-value">${escapeHtml(String(item.value))}</div><div class="kpi-label">${escapeHtml(item.label)}</div></div>`).join("")}</div>`;
    }

    function insightCard(item) {
        return `<article class="insight-card"><strong>${escapeHtml(item.title)}</strong><p class="card-caption">${escapeHtml(item.caption)}</p></article>`;
    }

    function recordCard(record) {
        return `<article class="activity-item"><div class="activity-dot"></div><div><strong>${escapeHtml(record.exercise.name)}</strong><p class="card-caption">${number(record.estimatedOneRepMax)} кг розрах. 1ПМ · ${record.weight} кг × ${record.repetitions} · ${formatDate(record.date)}</p></div></article>`;
    }

    function exerciseCard(exercise) {
        const pending = exercise.status === "pending";
        const canEdit = canEditExercise(exercise);
        const added = exercise.createdAt ? formatDate(exercise.createdAt) : "";
        const media = exerciseMedia(exercise);
        const owner = exercise.createdByUserId ? userById(exercise.createdByUserId) : null;
        const ownerName = exerciseOwnerName(exercise);
        const badges = `${isMyExercise(exercise) ? `<span class="pill-badge mine"><i data-lucide="bookmark-check"></i>Моя</span>` : ""}${pending ? `<span class="pill-badge pending"><i data-lucide="clock"></i>На модерації</span>` : ""}`;
        const overlay = media && badges ? `<div class="exercise-card-tags">${badges}</div>` : "";
        const inlineBadges = !media && badges ? `<div class="exercise-card-tags inline">${badges}</div>` : "";
        const actions = canEdit
            ? `<div class="exercise-card-actions">${pending && isAdmin() ? `<button class="icon-button success" type="button" title="Схвалити" data-action="approve-exercise" data-exercise-id="${exercise.id}"><i data-lucide="check"></i></button>` : ""}<button class="icon-button" type="button" title="Редагувати" data-action="edit-exercise" data-exercise-id="${exercise.id}"><i data-lucide="pen-line"></i></button><button class="icon-button danger" type="button" title="Видалити" data-action="delete-exercise" data-exercise-id="${exercise.id}"><i data-lucide="trash-2"></i></button></div>`
            : "";
        const meta = `<div class="exercise-meta" title="${escapeHtml(ownerName)}${added ? ` · ${added}` : ""}">${owner ? avatar(owner, "tiny") : `<span class="exercise-meta-fallback"><i data-lucide="user-round"></i></span>`}<div class="exercise-meta-text"><span class="exercise-meta-name">${escapeHtml(ownerName)}</span>${added ? `<span class="exercise-meta-date">${added}</span>` : ""}</div></div>`;
        return `<article class="exercise-card${media ? " has-thumb" : ""}${pending ? " is-pending" : ""}${exercise.myReaction === "dislike" ? " is-disliked" : ""}" data-action="open-exercise" data-exercise-id="${exercise.id}">${exerciseThumb(exercise)}${overlay}<div class="exercise-card-body">${inlineBadges}<h3>${escapeHtml(exercise.name)}</h3><p class="card-caption exercise-card-desc">${escapeHtml(exercise.description)}</p><div class="tag-row"><span class="chip">${escapeHtml(exercise.primaryMuscleGroup)}</span><span class="chip">${escapeHtml(exercise.movementPattern)}</span><span class="chip">${escapeHtml(exercise.equipment)}</span></div></div><div class="exercise-card-footer">${meta}${actions}</div>${reactionBar(exercise)}</article>`;
    }

    // Like / dislike controls + shared counts. Lives in its own bottom row so it
    // never collides with the admin edit/delete panel. Tapping a button is its own
    // action (data-action wins over the card's open-exercise via closest()).
    function reactionBar(exercise) {
        const mine = exercise.myReaction || null;
        return `<div class="exercise-card-reactions">
            <button class="react-btn like${mine === "like" ? " active" : ""}" type="button" data-action="react-exercise" data-exercise-id="${exercise.id}" data-reaction="like" aria-pressed="${mine === "like"}" aria-label="Подобається"><i data-lucide="thumbs-up"></i><span class="react-count">${exercise.likeCount || 0}</span></button>
            <button class="react-btn dislike${mine === "dislike" ? " active" : ""}" type="button" data-action="react-exercise" data-exercise-id="${exercise.id}" data-reaction="dislike" aria-pressed="${mine === "dislike"}" aria-label="Не подобається"><i data-lucide="thumbs-down"></i><span class="react-count">${exercise.dislikeCount || 0}</span></button>
        </div>`;
    }

    function applyReactionLocally(exercise, next) {
        const previous = exercise.myReaction || "none";
        if (previous === "like") {
            exercise.likeCount = Math.max(0, (exercise.likeCount || 0) - 1);
        }
        if (previous === "dislike") {
            exercise.dislikeCount = Math.max(0, (exercise.dislikeCount || 0) - 1);
        }
        if (next === "like") {
            exercise.likeCount = (exercise.likeCount || 0) + 1;
        }
        if (next === "dislike") {
            exercise.dislikeCount = (exercise.dislikeCount || 0) + 1;
        }
        exercise.myReaction = next === "none" ? null : next;
    }

    // Update the card's buttons/counts in place — no re-sort, so the card doesn't
    // jump under the finger. The liked-first order applies on the next list render.
    function updateReactionUI(exercise) {
        document.querySelectorAll(`.react-btn[data-exercise-id="${exercise.id}"]`).forEach((button) => {
            const reaction = button.dataset.reaction;
            const active = exercise.myReaction === reaction;
            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
            const count = button.querySelector(".react-count");
            if (count) {
                count.textContent = reaction === "like" ? (exercise.likeCount || 0) : (exercise.dislikeCount || 0);
            }
        });
        document.querySelectorAll(`.exercise-card[data-exercise-id="${exercise.id}"]`).forEach((card) => {
            card.classList.toggle("is-disliked", exercise.myReaction === "dislike");
        });
    }

    const reactingExerciseIds = new Set();
    async function reactToExercise(exerciseId, reaction) {
        const exercise = exerciseById(exerciseId);
        if (!exercise || (reaction !== "like" && reaction !== "dislike")) {
            return;
        }
        // Serialize per exercise: ignore taps while a request is in flight so two
        // out-of-order responses can't leave the card in a stale/divergent state.
        if (reactingExerciseIds.has(exerciseId)) {
            return;
        }
        const previous = { myReaction: exercise.myReaction || null, likeCount: exercise.likeCount || 0, dislikeCount: exercise.dislikeCount || 0 };
        const next = exercise.myReaction === reaction ? "none" : reaction;
        reactingExerciseIds.add(exerciseId);
        applyReactionLocally(exercise, next);
        updateReactionUI(exercise);
        try {
            if (storage.mode === "api" && storage.apiClient.hasBaseUrl()) {
                const result = await storage.apiClient.reactExercise(exerciseId, next);
                exercise.likeCount = result.likeCount;
                exercise.dislikeCount = result.dislikeCount;
                exercise.myReaction = result.myReaction || null;
                updateReactionUI(exercise);
            } else {
                await persist({ silent: true });
            }
        } catch (error) {
            exercise.myReaction = previous.myReaction;
            exercise.likeCount = previous.likeCount;
            exercise.dislikeCount = previous.dislikeCount;
            updateReactionUI(exercise);
            handleUserFacingError(error, "react-exercise");
        } finally {
            reactingExerciseIds.delete(exerciseId);
        }
    }

    function pendingExercises() {
        return state.database.exercises.filter((exercise) => exercise.status === "pending");
    }

    function approvalQueueCard() {
        const items = pendingExercises();
        const rows = items.length
            ? items.map((exercise) => `<div class="approval-row">${exerciseThumb(exercise)}<div class="approval-info"><strong>${escapeHtml(exercise.name)}</strong><p class="card-caption">${escapeHtml(exerciseOwnerName(exercise))}${exercise.createdAt ? ` · ${formatDate(exercise.createdAt)}` : ""} · ${escapeHtml(exercise.primaryMuscleGroup)}</p></div><div class="approval-actions"><button class="icon-button" type="button" title="Огляд" data-action="open-exercise" data-exercise-id="${exercise.id}"><i data-lucide="eye"></i></button><button class="icon-button success" type="button" title="Схвалити" data-action="approve-exercise" data-exercise-id="${exercise.id}"><i data-lucide="check"></i></button><button class="icon-button danger" type="button" title="Відхилити" data-action="reject-exercise" data-exercise-id="${exercise.id}"><i data-lucide="x"></i></button></div></div>`).join("")
            : emptyInline("Черга порожня", "Нові та відредаговані вправи учасників з'являтимуться тут.");
        return `<section class="card span-12 approval-card"><div class="card-header"><div><h2>Модерація вправ ${items.length ? `<span class="badge pending">${items.length}</span>` : ""}</h2><p class="card-caption">Підтверджуй нові та відредаговані вправи учасників команди.</p></div></div><div class="approval-list">${rows}</div></section>`;
    }

    function exerciseContributors() {
        const counts = new Map();
        state.database.exercises.forEach((exercise) => {
            if (!exercise.createdByUserId) {
                return;
            }
            counts.set(exercise.createdByUserId, (counts.get(exercise.createdByUserId) || 0) + 1);
        });
        return [...counts.entries()]
            .map(([id, count]) => ({ user: userById(id), count }))
            .filter((row) => row.user)
            .sort((left, right) => right.count - left.count);
    }

    function contributorCard() {
        const rows = exerciseContributors();
        const max = rows.length ? rows[0].count : 1;
        const body = rows.length
            ? rows.slice(0, 8).map((row, index) => `<div class="contrib-row"><span class="contrib-rank">${index + 1}</span>${avatar(row.user)}<div class="contrib-main"><strong>${escapeHtml(row.user.displayName)}</strong><div class="contrib-bar"><span style="width:${Math.max(6, Math.round((row.count / max) * 100))}%"></span></div></div><span class="contrib-count">${row.count}</span></div>`).join("")
            : emptyInline("Поки немає даних", "Додай вправи, щоб побачити рейтинг авторів.");
        return `<section class="card span-12"><div class="card-header"><div><h2>Автори вправ</h2><p class="card-caption">Хто скільки вправ додав у каталог (${state.database.exercises.length} усього).</p></div></div><div class="contrib-list">${body}</div></section>`;
    }

    function roleRank(role) {
        return ({ admin: 3, premium: 2, free: 1 })[String(role || "free").toLowerCase()] || 0;
    }

    function adminUserRow(user) {
        const summary = userStats(user.id);
        const exCount = state.database.exercises.filter((exercise) => exercise.createdByUserId === user.id).length;
        const isSuper = adminEmails.has(String(user.email || "").toLowerCase());
        const role = isSuper ? "admin" : String(user.role || "free").toLowerCase();
        const roleControl = isSuper
            ? `<span class="role-badge admin"><i data-lucide="shield"></i>Власник</span>`
            : `<gym-select class="admin-role-select" data-action="set-role" data-user-id="${user.id}">${[["free", "Free"], ["premium", "PRO"], ["admin", "Адмін"]].map(([value, label]) => `<option value="${value}" ${role === value ? "selected" : ""}>${label}</option>`).join("")}</gym-select>`;
        const approveControl = user.approved === false
            ? `<button class="button button-primary compact" type="button" data-action="approve-user" data-user-id="${user.id}"><i data-lucide="check"></i>Дозволити</button>`
            : (isSuper ? "" : `<button class="button button-secondary compact" type="button" data-action="revoke-user" data-user-id="${user.id}"><i data-lucide="user-x"></i>Відкликати</button>`);
        return `<div class="admin-user-row"><div class="admin-user-main">${avatar(user)}<div class="admin-user-info"><strong>${escapeHtml(user.displayName || "—")}${user.approved === false ? ` <span class="badge pending">очікує</span>` : ""}</strong><p class="card-caption">${escapeHtml(user.email || "—")}</p><p class="card-caption">${summary.completedWorkouts} трен · ${exCount} вправ</p></div></div><div class="admin-user-controls">${roleControl}${approveControl}</div></div>`;
    }

    function adminPanel() {
        const users = state.database.users.slice().sort((left, right) => roleRank(right.role) - roleRank(left.role) || String(left.displayName || "").localeCompare(String(right.displayName || "")));
        const isSuper = (user) => adminEmails.has(String(user.email || "").toLowerCase());
        const pendingUsers = users.filter((user) => user.approved === false);
        const counts = {
            total: users.length,
            premium: users.filter((user) => String(user.role).toLowerCase() === "premium").length,
            admin: users.filter((user) => String(user.role).toLowerCase() === "admin" || isSuper(user)).length,
            pending: pendingUsers.length
        };
        const pendingEx = pendingExercises();
        content(`<div class="grid dashboard-grid">
            <section class="card span-12"><div class="card-header"><div><h2>Адмін-панель</h2><p class="card-caption">Доступи, ролі та модерація GymOS в одному місці.</p></div><span class="role-badge admin"><i data-lucide="shield"></i>Адмін</span></div>${kpi([{ label: "Користувачі", value: counts.total }, { label: "PRO", value: counts.premium }, { label: "Адміни", value: counts.admin }, { label: "На апруві", value: counts.pending }, { label: "Вправи", value: state.database.exercises.length }, { label: "На модерації", value: pendingEx.length }])}</section>
            ${pendingUsers.length ? `<section class="card span-12 approval-card"><div class="card-header"><div><h2>Нові користувачі <span class="badge pending">${pendingUsers.length}</span></h2><p class="card-caption">Підтверди доступ до застосунку.</p></div></div><div class="admin-user-list">${pendingUsers.map(adminUserRow).join("")}</div></section>` : ""}
            <section class="card span-12"><div class="card-header"><div><h2>Користувачі та ролі</h2><p class="card-caption">Free · PRO (безліміт) · Адмін. Зміни застосовуються одразу.</p></div></div><div class="admin-user-list">${users.map(adminUserRow).join("")}</div></section>
            ${pendingEx.length ? approvalQueueCard() : ""}
        </div>`);
    }

    async function setUserRole(userId, role) {
        if (!isAdmin()) {
            toast("Немає прав", "Лише адміністратор може змінювати ролі.");
            return;
        }
        const user = userById(userId);
        if (storage.mode === "api" && storage.apiClient.hasBaseUrl()) {
            await storage.apiClient.setUserRole(userId, role);
        }
        if (user) {
            user.role = role;
            if (role === "premium" || role === "admin") {
                user.approved = true;
            }
        }
        renderSection();
        toast("Роль оновлено", `${user?.displayName || "Користувач"} → ${roleLabel(role)}`);
    }

    function userCard(user) {
        const summary = userStats(user.id);
        const isCurrent = user.id === currentUser().id;
        return `<article class="user-card" data-action="open-user" data-user-id="${user.id}"><div class="list-row">${avatar(user, "xl")}<div><h3>${escapeHtml(user.displayName)}</h3><p class="card-caption">${escapeHtml(user.trainingGoal || "")}</p></div></div><div style="margin-top:14px;">${kpi([{ label: "Тренування", value: summary.completedWorkouts }, { label: "Обсяг", value: number(summary.totalVolume) }, { label: "Кардіо", value: summary.cardioMinutes }])}</div><div class="tag-row" style="margin-top:12px;"><span class="badge ${isCurrent ? "unlocked" : "locked"}">${isCurrent ? "Це ви" : "Учасник"}</span>${roleStatusBadge(user)}</div></article>`;
    }

    function userDetail(userId) {
        const user = userById(userId);
        if (!user) {
            content(`<section class="card">${emptyInline("Користувача не знайдено", "Поверніться до команди.")}<div class="action-row" style="justify-content:center;margin-top:12px;"><button class="button button-secondary compact" type="button" data-action="navigate" data-section="users"><i data-lucide="arrow-left"></i>Команда</button></div></section>`);
            return;
        }
        const summary = userStats(user.id);
        const isCurrent = user.id === currentUser().id;
        const history = workoutsFor(user.id).sort(byDateDesc);
        content(`<div class="grid dashboard-grid"><section class="card span-12"><div class="profile-header"><div class="list-row">${avatar(user, "large")}<div><div class="tag-row" style="margin-bottom:8px;"><span class="badge accent">${escapeHtml(user.trainingGoal || "Учасник")}</span>${roleStatusBadge(user)}${isCurrent ? `<span class="status-badge completed">Це ви</span>` : ""}</div><h2>${escapeHtml(user.displayName)}</h2><p class="card-caption">${escapeHtml(user.name || "")}${user.bodyweight ? ` · ${user.bodyweight} кг` : ""}${user.height ? ` · ${user.height} см` : ""}${user.trainingExperience ? ` · ${escapeHtml(user.trainingExperience)}` : ""}</p></div></div><button class="button button-secondary compact" type="button" data-action="navigate" data-section="users"><i data-lucide="arrow-left"></i>До команди</button></div></section>${metric("Тренування", summary.completedWorkouts, "calendar-check", "Завершено", "span-3")}${metric("Загальний обсяг", `${number(summary.totalVolume)} кг`, "boxes", "Усі підходи", "span-3")}${metric("Підходи", summary.totalSets, "list-checks", `${summary.workingSets} робочих`, "span-3")}${metric("Кардіо", `${summary.cardioMinutes} хв`, "heart-pulse", `${summary.cardioDistance} км`, "span-3")}<section class="card span-12"><div class="card-header"><div><h2>Тренування</h2><p class="card-caption">${isCurrent ? "Твої сесії." : "Сесії учасника. Натисни, щоб відкрити деталі."}</p></div></div><div class="activity-feed">${workoutHistoryList(history.slice(0, 20))}</div></section></div>`);
    }

    function exerciseMedia(exercise) {
        const direct = imageUrl(exercise?.mediaUrl);
        if (direct) {
            return direct;
        }
        const references = Array.isArray(exercise?.mediaReferences) ? exercise.mediaReferences : [];
        for (const reference of references) {
            const candidate = typeof reference === "string" ? reference : (reference?.url || reference?.src || reference?.href || "");
            const url = imageUrl(candidate);
            if (url) {
                return url;
            }
        }
        return "";
    }

    function exerciseThumb(exercise) {
        const url = exerciseMedia(exercise);
        if (!url) {
            return "";
        }
        return `<div class="exercise-thumb"><img src="${escapeHtml(url)}" alt="${escapeHtml(exercise.name)}" referrerpolicy="no-referrer" loading="lazy" decoding="async" onerror="this.closest('.exercise-thumb')?.remove()"></div>`;
    }

    function media(exercise) {
        const url = exerciseMedia(exercise);
        if (url) {
            return `<div class="media-placeholder has-media"><img src="${escapeHtml(url)}" alt="Демонстрація вправи ${escapeHtml(exercise.name)}" referrerpolicy="no-referrer" loading="lazy" decoding="async" onerror="this.closest('.media-placeholder')?.classList.remove('has-media'); this.remove();"></div>`;
        }
        return `<div class="media-placeholder"><div class="media-placeholder-label">Місце для майбутнього GIF/WebP демо · анімований placeholder</div></div>`;
    }

    function exerciseSourceBlock(exercise) {
        if (!exercise.sourceName) {
            return "";
        }
        const sourceText = exercise.sourceName === "ExRx.net" ? "Джерело: ExRx.net" : `Джерело: ${exercise.sourceName}`;
        return `<div class="source-strip"><span>${escapeHtml(sourceText)}</span>${exercise.sourceUrl ? `<a href="${escapeHtml(exercise.sourceUrl)}" target="_blank" rel="noreferrer">Відкрити джерело</a>` : ""}<span>Медіа збережено лише як reference metadata.</span></div>`;
    }

    function emptyInline(title, caption) {
        return `<div class="empty-state"><i data-lucide="sparkles"></i><h3>${escapeHtml(title)}</h3><p>${escapeHtml(caption)}</p></div>`;
    }

    function activityFeed() {
        const scope = state.filters.activityScope === "all" ? "all" : "mine";
        const me = currentUser();
        let items = state.database.workouts.filter((item) => item.status === "completed");
        if (scope === "mine" && me) {
            items = items.filter((item) => item.userId === me.id);
        }
        items = items.sort(byDateDesc).slice(0, 8);
        if (!items.length) {
            return emptyInline(
                scope === "mine" ? "У тебе ще немає завершених тренувань" : "Немає завершених тренувань",
                scope === "mine" ? "Заверши тренування — і воно з'явиться тут." : "Стрічка оновиться, коли команда завершить тренування."
            );
        }
        return items.map((workoutItem) => {
            const owner = userById(workoutItem.userId);
            return `<article class="activity-item"><span class="activity-dot"></span><div class="activity-main"><strong><button class="link-button" type="button" data-action="open-user" data-user-id="${owner.id}">${escapeHtml(owner.displayName)}</button> · ${escapeHtml(workoutLabel(workoutItem))}</strong><p class="card-caption">${formatDate(workoutItem.date)} · ${number(workoutVolume(workoutItem))} кг · ${workoutItem.exercises.length} вправ</p></div><button class="button button-secondary compact activity-open" type="button" data-action="open-workout" data-workout-id="${workoutItem.id}">Відкрити</button></article>`;
        }).join("");
    }

    function workoutHistoryList(workouts) {
        if (!workouts.length) {
            return emptyInline("Історія порожня", "Створи або заверши тренування, щоб воно з'явилося тут.");
        }

        return workouts.map((workoutItem) => {
            const owner = userById(workoutItem.userId);
            const readonly = !canManage(workoutItem);
            return `<article class="history-card" data-action="open-workout" data-workout-id="${workoutItem.id}"><div class="card-header"><div><div class="tag-row" style="margin-bottom:8px;"><span class="status-badge ${workoutItem.status}">${statusLabel(workoutItem.status)}</span><span class="chip">${workoutTypeLabel(workoutItem.workoutType)}</span>${readonly ? `<span class="status-badge readonly">Лише перегляд</span>` : ""}</div><h3>${escapeHtml(workoutLabel(workoutItem))}</h3><p class="card-caption">${formatDate(workoutItem.date)} · ${escapeHtml(owner.displayName)}</p></div><button class="button button-secondary compact" type="button" data-action="open-workout" data-workout-id="${workoutItem.id}">Деталі</button></div>${kpi([{ label: "Вправи", value: workoutItem.exercises.length }, { label: "Підходи", value: workoutSetCount(workoutItem) }, { label: "Обсяг", value: `${number(workoutVolume(workoutItem))} кг` }, { label: "Кардіо", value: `${workoutCardioMinutes(workoutItem)} хв` }, { label: "Тривалість", value: `${duration(workoutItem)} хв` }])}${workoutItem.notes ? `<p class="card-caption history-notes">${escapeHtml(workoutItem.notes).slice(0, 140)}</p>` : ""}</article>`;
        }).join("");
    }

    const lazyScripts = new Map();
    function loadScript(src) {
        if (lazyScripts.has(src)) {
            return lazyScripts.get(src);
        }
        const promise = new Promise((resolve, reject) => {
            const tag = document.createElement("script");
            tag.src = src;
            tag.async = true;
            tag.onload = () => resolve();
            tag.onerror = () => reject(new Error("Не вдалося завантажити " + src));
            document.head.appendChild(tag);
        });
        lazyScripts.set(src, promise);
        return promise;
    }

    function loadStyle(href) {
        if (document.querySelector(`link[data-lazy="${href}"]`)) {
            return;
        }
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.dataset.lazy = href;
        document.head.appendChild(link);
    }

    // Chart.js and FullCalendar are loaded on demand (only on stats / calendar views)
    // instead of blocking the initial page load. The catch keeps a CDN failure from
    // rejecting and breaking the caller; the entry points fall back gracefully.
    function ensureChartLib() {
        return window.Chart ? Promise.resolve() : loadScript("https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js").catch(() => {});
    }

    function ensureCalendarLib() {
        if (window.FullCalendar) {
            return Promise.resolve();
        }
        loadStyle("https://cdn.jsdelivr.net/npm/fullcalendar@6.1.15/index.global.min.css");
        return loadScript("https://cdn.jsdelivr.net/npm/fullcalendar@6.1.15/index.global.min.js").catch(() => {});
    }

    function renderCalendar() {
        const container = element("calendarContainer");
        if (!container) {
            return;
        }
        if (!window.FullCalendar) {
            ensureCalendarLib().then(() => {
                if (window.FullCalendar) {
                    renderCalendar();
                } else {
                    container.innerHTML = emptyInline("Календар недоступний", "Не вдалося завантажити FullCalendar з CDN.");
                    icons();
                }
            });
            return;
        }
        if (state.calendar) {
            state.calendar.destroy();
        }
        const mobile = window.innerWidth < 760;
        state.calendar = new FullCalendar.Calendar(container, {
            initialView: mobile ? "listMonth" : "dayGridMonth",
            height: "auto",
            firstDay: 1,
            locale: "uk",
            buttonText: { today: "Сьогодні", month: "Місяць", week: "Тиждень", list: "Список" },
            headerToolbar: mobile ? { left: "prev,next", center: "title", right: "today" } : { left: "prev,next today", center: "title", right: "dayGridMonth,listMonth" },
            displayEventTime: false,
            events: state.database.workouts.map((workoutItem) => ({ id: workoutItem.id, title: userById(workoutItem.userId).displayName, start: workoutItem.date, classNames: [`workout-status-${workoutItem.status}`], extendedProps: { workoutId: workoutItem.id, date: workoutItem.date } })),
            dateClick: (info) => openDaySheet(info.dateStr),
            eventClick: (info) => {
                info.jsEvent.preventDefault();
                openDaySheet(info.event.extendedProps.date);
            }
        });
        state.calendar.render();
    }

    function weeklyVolumeChart(id, userId) {
        const labels = Array.from({ length: 7 }, (_, index) => dateInput(addDays(startWeek(new Date()), index)));
        const data = labels.map((label) => workoutsFor(userId).filter((item) => item.status === "completed" && item.date === label).reduce((sum, item) => sum + workoutVolume(item), 0));
        barChart(id, labels.map(shortDate), data, "Обсяг, кг");
    }

    function volumeChart(id, userId) {
        const workouts = filteredWorkouts(userId ? workoutsFor(userId) : state.database.workouts).filter((item) => item.status === "completed").sort(byDateAsc).slice(-14);
        barChart(id, workouts.map((item) => shortDate(item.date)), workouts.map(workoutVolume), "Обсяг, кг");
    }

    function muscleDistributionChart(id, userId) {
        const map = muscleSetMap(filteredWorkouts(userId ? workoutsFor(userId) : state.database.workouts).filter((item) => item.status === "completed"));
        doughnutChart(id, [...map.keys()], [...map.values()]);
    }

    function bodyweightChart(id, userId = currentUser().id) {
        const entries = state.database.bodyweightEntries.filter((item) => item.userId === userId).sort(byDateAsc);
        lineChart(id, entries.map((item) => shortDate(item.date)), entries.map((item) => item.bodyweight), "Вага тіла, кг");
    }

    function cardioChart(id, userId = currentUser().id) {
        const workouts = workoutsFor(userId).filter((item) => item.status === "completed").sort(byDateAsc).slice(-10);
        barChart(id, workouts.map((item) => shortDate(item.date)), workouts.map((item) => item.cardioSessions.reduce((sum, session) => sum + session.durationMinutes, 0)), "Кардіо, хв");
    }

    function progressChart(id, userId) {
        const exerciseId = state.filters.statsExerciseId !== "all" ? state.filters.statsExerciseId : exerciseByName("Жим лежачи").id;
        const points = progressData(userId, exerciseId);
        lineChart(id, points.map((point) => shortDate(point.date)), points.map((point) => point.value), "Розрах. 1ПМ");
    }

    function maxTrendChart(id, userId) {
        const points = progressData(userId, exerciseByName("Жим лежачи").id);
        lineChart(id, points.map((point) => shortDate(point.date)), points.map((point) => point.value), "Жим лежачи, розрах. 1ПМ");
    }

    function consistencyChart(id, userId) {
        const workouts = filteredWorkouts(userId ? workoutsFor(userId) : state.database.workouts).filter((item) => item.status === "completed").sort(byDateAsc).slice(-10);
        barChart(id, workouts.map((item) => shortDate(item.date)), workouts.map((item) => item.exercises.length), "Вправи");
    }

    const chartPalette = ["#34d399", "#60a5fa", "#a78bfa", "#fbbf24", "#f472b6", "#22d3ee", "#fb923c", "#4ade80", "#f87171", "#c084fc", "#2dd4bf", "#facc15"];

    function barChart(id, labels, data, label) {
        const colors = data.map((_, index) => chartPalette[index % chartPalette.length]);
        createChart(id, { type: "bar", data: { labels, datasets: [{ label, data, backgroundColor: colors.map((color) => `${color}cc`), borderColor: colors, borderWidth: 1, borderRadius: 8 }] }, options: chartOptions() });
    }

    function lineChart(id, labels, data, label) {
        createChart(id, { type: "line", data: { labels, datasets: [{ label, data, tension: 0.35, fill: true, backgroundColor: "rgba(52, 211, 153, 0.12)", borderColor: "#34d399", pointBackgroundColor: "#6ee7b7", pointRadius: 3, borderWidth: 2 }] }, options: chartOptions() });
    }

    function doughnutChart(id, labels, data) {
        const colors = labels.map((_, index) => chartPalette[index % chartPalette.length]);
        createChart(id, { type: "doughnut", data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: "#111113", borderWidth: 2, hoverOffset: 6 }] }, options: { ...chartOptions(), cutout: "66%", scales: {} } });
    }

    function createChart(id, config) {
        if (!element(id)) {
            return;
        }
        const labels = config.data?.labels || [];
        const values = config.data?.datasets?.[0]?.data || [];
        if (!labels.length || !values.some((value) => Number(value) > 0)) {
            const parent = element(id).parentElement;
            if (parent) {
                parent.innerHTML = emptyInline("Недостатньо даних", "Графік оновиться після створення або завершення тренувань.");
                icons();
            }
            return;
        }
        if (!window.Chart) {
            // Load Chart.js on demand, then retry once. The window.Chart guard stops a
            // failed CDN load from re-entering forever.
            ensureChartLib().then(() => {
                if (window.Chart) {
                    createChart(id, config);
                }
            });
            return;
        }
        const chart = new Chart(element(id), config);
        state.charts.set(id, chart);
    }

    function chartOptions() {
        return { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: "#a1a1aa", boxWidth: 12, usePointStyle: true } }, tooltip: { backgroundColor: "rgba(22, 22, 24, 0.97)", titleColor: "#f4f4f5", bodyColor: "#d4d4d8", borderColor: "rgba(255, 255, 255, 0.14)", borderWidth: 1 } }, scales: { x: { ticks: { color: "#71717a" }, grid: { color: "rgba(255, 255, 255, 0.06)" } }, y: { ticks: { color: "#71717a" }, grid: { color: "rgba(255, 255, 255, 0.06)" }, beginAtZero: true } } };
    }

    function destroyCharts() {
        state.charts.forEach((chart) => chart.destroy());
        state.charts.clear();
    }

    function userStats(userId, useFilters = false) {
        const workouts = useFilters ? filteredWorkouts(workoutsFor(userId)) : workoutsFor(userId);
        const completed = workouts.filter((item) => item.status === "completed");
        const allSets = completed.flatMap((item) => item.exercises.flatMap((exercise) => exercise.sets)).filter((set) => set.isCompleted);
        const cardioSessions = workouts.flatMap((item) => item.cardioSessions || []);
        const weekStart = startWeek(new Date());
        const week = completed.filter((item) => new Date(item.date) >= weekStart);
        const muscleMap = muscleSetMap(completed);
        const exerciseMap = exerciseUsageMap(completed);
        return {
            userId,
            totalWorkouts: workouts.length,
            completedWorkouts: completed.length,
            totalSets: allSets.length,
            workingSets: allSets.filter((set) => set.type !== "warmup").length,
            warmupSets: allSets.filter((set) => set.type === "warmup").length,
            totalVolume: round(allSets.reduce((sum, set) => sum + set.weight * set.repetitions, 0), 1),
            averageDurationMinutes: completed.length ? Math.round(completed.reduce((sum, item) => sum + duration(item), 0) / completed.length) : 0,
            cardioMinutes: cardioSessions.reduce((sum, session) => sum + session.durationMinutes, 0),
            cardioDistance: round(cardioSessions.reduce((sum, session) => sum + session.distance, 0), 1),
            cardioSessions: cardioSessions.length,
            weekVolume: round(week.reduce((sum, item) => sum + workoutVolume(item), 0), 1),
            weekSets: week.flatMap((item) => item.exercises.flatMap((exercise) => exercise.sets)).filter((set) => set.isCompleted).length,
            weekCardioMinutes: week.flatMap((item) => item.cardioSessions || []).reduce((sum, session) => sum + session.durationMinutes, 0),
            trainingStreak: streak(completed),
            lastWorkoutDate: completed.sort(byDateDesc)[0]?.date || null,
            mostUsedExercise: topMap(exerciseMap, exerciseById),
            mostTrainedMuscleGroup: topMap(muscleMap),
            personalRecords: recordsFor(userId).length,
            notesCount: completed.reduce((sum, item) => sum + (item.notes ? 1 : 0) + item.exercises.filter((exercise) => exercise.notes).length, 0)
        };
    }

    function teamStats(useFilters = false) {
        const userSummaries = state.database.users.map((user) => userStats(user.id, useFilters));
        const workouts = useFilters ? filteredWorkouts(state.database.workouts) : state.database.workouts;
        const completed = workouts.filter((item) => item.status === "completed");
        const cardioSessions = workouts.flatMap((item) => item.cardioSessions || []);
        const mostActive = [...userSummaries].sort((left, right) => right.completedWorkouts - left.completedWorkouts)[0];
        return {
            totalWorkouts: workouts.length,
            completedWorkouts: completed.length,
            totalSets: userSummaries.reduce((sum, item) => sum + item.totalSets, 0),
            workingSets: userSummaries.reduce((sum, item) => sum + item.workingSets, 0),
            totalVolume: round(userSummaries.reduce((sum, item) => sum + item.totalVolume, 0), 1),
            averageDurationMinutes: completed.length ? Math.round(completed.reduce((sum, item) => sum + duration(item), 0) / completed.length) : 0,
            cardioMinutes: cardioSessions.reduce((sum, session) => sum + session.durationMinutes, 0),
            cardioDistance: round(cardioSessions.reduce((sum, session) => sum + session.distance, 0), 1),
            cardioDays: new Set(workouts.filter((item) => item.cardioSessions?.length).map((item) => item.date)).size,
            teamStreak: streak(completed),
            mostActiveUser: userById(mostActive.userId),
            mostUsedExercise: userSummaries.map((item) => item.mostUsedExercise).filter(Boolean)[0],
            mostTrainedMuscleGroup: topMap(muscleSetMap(completed))
        };
    }

    function recordsFor(userId) {
        const map = new Map();
        workoutsFor(userId).filter((item) => item.status === "completed").forEach((workoutItem) => {
            workoutItem.exercises.forEach((workoutExercise) => {
                const exercise = exerciseById(workoutExercise.exerciseId);
                workoutExercise.sets.filter((set) => set.isCompleted && set.type !== "warmup").forEach((set) => {
                    const estimatedOneRepMax = oneRepMax(set.weight, set.repetitions);
                    const current = map.get(exercise.id);
                    if (!current || estimatedOneRepMax > current.estimatedOneRepMax) {
                        map.set(exercise.id, { id: `record-${userId}-${exercise.id}`, userId, exerciseId: exercise.id, exercise, date: workoutItem.date, type: "estimated_one_rep_max", value: estimatedOneRepMax, estimatedOneRepMax, weight: set.weight, repetitions: set.repetitions, workoutId: workoutItem.id, isEstimated: set.repetitions !== 1 });
                    }
                });
            });
        });
        return [...map.values()].sort((left, right) => right.estimatedOneRepMax - left.estimatedOneRepMax);
    }

    // Strength standards are no longer shipped in the backend payload. Regenerate
    // the lightweight demo levels client-side on demand so the "Поточний рівень"
    // indicator keeps working without bloating the API response.
    function ensureStrengthStandards() {
        if (!Array.isArray(state.database.strengthStandards) || !state.database.strengthStandards.length) {
            state.database.strengthStandards = createStandards(state.database.exercises || []);
        }
        return state.database.strengthStandards;
    }

    function rankingFor(userId, exerciseId) {
        const user = userById(userId);
        if (!user || !exerciseId) {
            return { best: null, currentLevel: null, nextLevel: null, progress: 0 };
        }

        const standards = ensureStrengthStandards().filter((standard) => standard.exerciseId === exerciseId && standard.gender === user.gender && user.bodyweight >= standard.bodyweightMin && user.bodyweight < standard.bodyweightMax).sort((left, right) => left.requiredWeight - right.requiredWeight);
        const best = bestResult(userId, exerciseId);
        if (!best || !standards.length) {
            return { best, currentLevel: null, nextLevel: standards[0] || null, progress: 0 };
        }
        const currentLevel = standards.filter((standard) => best.estimatedOneRepMax >= standard.requiredWeight).at(-1) || null;
        const nextLevel = standards.find((standard) => best.estimatedOneRepMax < standard.requiredWeight) || null;
        const lower = currentLevel?.requiredWeight || 0;
        const upper = nextLevel?.requiredWeight || best.estimatedOneRepMax;
        return { best, currentLevel, nextLevel, progress: upper === lower ? 100 : (best.estimatedOneRepMax - lower) / (upper - lower) * 100 };
    }

    function leaderboard() {
        return state.database.users.map((user) => {
            const summary = userStats(user.id);
            const bestLift = recordsFor(user.id)[0] || null;
            return { user, completedWorkouts: summary.completedWorkouts, totalVolume: summary.totalVolume, bestLift, mainRank: mainRank(user.id), score: summary.completedWorkouts * 25 + summary.totalVolume / 500 + (bestLift?.estimatedOneRepMax || 0) * 3 };
        }).sort((left, right) => right.score - left.score);
    }

    function insights(userId) {
        const summary = userStats(userId);
        const bench = exerciseByName("Жим лежачи");
        const lastBench = lastUsed(bench.id, userId);
        const days = lastBench ? dayDiff(new Date(), new Date(lastBench)) : null;
        const bestLift = recordsFor(userId)[0] || null;
        const chestSets = workoutsFor(userId).filter((item) => item.status === "completed" && new Date(item.date) >= startWeek(new Date())).flatMap((item) => item.exercises).filter((item) => exerciseById(item.exerciseId).primaryMuscleGroup === "Груди").flatMap((item) => item.sets).filter((set) => set.isCompleted).length;
        return [
            { title: `Робота на груди: ${chestSets} підходів`, caption: chestSets ? "Груди вже тренувалися цього тижня." : "Груди ще не тренувалися цього тижня." },
            { title: days === null ? "Жим ще не логували" : `Жим був ${days} дн. тому`, caption: "Корисно для частоти і відновлення." },
            { title: bestLift ? `Найкращий 1ПМ: ${number(bestLift.estimatedOneRepMax)} кг` : "Особистих рекордів ще немає", caption: bestLift ? `${escapeHtml(bestLift.exercise.name)} · продовжуй прогрес.` : "Заверши робочі підходи, щоб зафіксувати PR." },
            { title: summary.weekVolume ? "Обсяг рухається" : "Почни тиждень", caption: `${number(summary.weekVolume)} кг завершено цього тижня.` },
            { title: summary.warmupSets >= 10 ? "Дисципліна розминки" : "Підказка для розминки", caption: summary.warmupSets >= 10 ? "Звичка розминки вже помітна в логах." : "Додавай розминкові підходи перед основними рухами." }
        ];
    }

    function suggestedSets(exercise) {
        if (exercise.movementPattern === "Кардіо") {
            return [];
        }
        const currentUserId = state.database?.currentUserId;
        // Carry over the exact same sets (count + weight + reps + type) from the last
        // time this exercise was done, just reset to not-completed.
        const last = currentUserId ? lastExerciseSets(currentUserId, exercise.id) : null;
        if (last && last.sets.length) {
            return last.sets.map((set) => createSet(set.type || "working", Number(set.weight) || 0, Number(set.repetitions) || 0, set.rpe, Number(set.restSeconds) || 90, false));
        }
        const weight = seedWeight(exercise.name, 0);
        if (exercise.movementPattern === "Кор") {
            return [createSet("working", 0, 45, 7, 60, false), createSet("working", 0, 45, 8, 60, false)];
        }
        return [createSet("warmup", round(weight * 0.55, 1), 10, 5, 60, false), createSet("working", round(weight, 1), 8, 8, 105, false), createSet("working", round(weight, 1), 8, 8.5, 120, false)];
    }

    function filteredExercises() {
        const search = state.filters.exerciseSearch.trim().toLowerCase();
        let items = state.database.exercises;
        if (search) {
            items = items.filter((exercise) => [exercise.name, exercise.aliases.join(" "), exercise.primaryMuscleGroup, exercise.secondaryMuscleGroups.join(" "), exercise.movementPattern, exercise.equipment, exercise.category, exercise.difficulty].join(" ").toLowerCase().includes(search));
        }
        return sortExercisesByReaction(items);
    }

    // Liked-by-me first, then neutral, then disliked-by-me last; alphabetical within
    // each group. (Personal reaction, not global counts.)
    function reactionRank(exercise) {
        if (exercise.myReaction === "like") {
            return 0;
        }
        if (exercise.myReaction === "dislike") {
            return 2;
        }
        return 1;
    }

    function sortExercisesByReaction(list) {
        return list.slice().sort((left, right) => {
            const byReaction = reactionRank(left) - reactionRank(right);
            if (byReaction) {
                return byReaction;
            }
            return String(left.name || "").localeCompare(String(right.name || ""), "uk");
        });
    }

    function filteredWorkouts(workouts) {
        let items = [...workouts];
        if (state.filters.statsRange !== "all") {
            const start = addDays(new Date(), -Number(state.filters.statsRange));
            items = items.filter((item) => new Date(item.date) >= start);
        }
        if (state.filters.statsMuscle !== "all") {
            items = items.filter((item) => item.exercises.some((exercise) => exerciseById(exercise.exerciseId).primaryMuscleGroup === state.filters.statsMuscle));
        }
        if (state.filters.statsExerciseId !== "all") {
            items = items.filter((item) => item.exercises.some((exercise) => exercise.exerciseId === state.filters.statsExerciseId));
        }
        if (state.filters.statsWorkoutType !== "all") {
            items = items.filter((item) => item.workoutType === state.filters.statsWorkoutType);
        }
        return items;
    }

    function workoutVolume(workoutItem) {
        return round(workoutItem.exercises.reduce((sum, item) => sum + exerciseVolume(item), 0), 1);
    }

    function exerciseVolume(workoutExercise) {
        return round(workoutExercise.sets.filter((set) => set.isCompleted).reduce((sum, set) => sum + set.weight * set.repetitions, 0), 1);
    }

    function exerciseOneRepMax(workoutExercise) {
        return round(Math.max(0, ...workoutExercise.sets.filter((set) => set.isCompleted).map((set) => oneRepMax(set.weight, set.repetitions))), 1);
    }

    function oneRepMax(weight, repetitions) {
        const load = Number(weight) || 0;
        const reps = Math.round(Number(repetitions) || 0);
        if (load <= 0 || reps <= 0) {
            return 0;
        }
        if (reps === 1) {
            return round(load, 1);
        }
        // Average of validated estimation formulas for higher accuracy.
        // Reps are capped at 12 — predictions diverge sharply beyond that.
        const cappedReps = Math.min(reps, 12);
        const estimates = [
            load * (1 + cappedReps / 30),                                 // Epley
            load * 36 / (37 - cappedReps),                                // Brzycki
            load * Math.pow(cappedReps, 0.10),                            // Lombardi
            load * (1 + cappedReps / 40),                                 // O'Conner
            100 * load / (48.8 + 53.8 * Math.exp(-0.075 * cappedReps)),   // Wathen
            100 * load / (101.3 - 2.67123 * cappedReps)                   // Lander
        ].filter((value) => Number.isFinite(value) && value > 0);
        if (!estimates.length) {
            return round(load, 1);
        }
        const average = estimates.reduce((sum, value) => sum + value, 0) / estimates.length;
        return round(Math.max(average, load), 1);
    }

    function duration(workoutItem) {
        if (!workoutItem.startedAt) {
            return 0;
        }
        return Math.max(0, Math.round(((workoutItem.finishedAt ? new Date(workoutItem.finishedAt) : new Date()) - new Date(workoutItem.startedAt)) / 60000));
    }

    function previousPerformance(userId, exerciseId, excludedWorkoutId = null) {
        if (!userId) {
            return null;
        }
        const entries = workoutsFor(userId).filter((item) => item.status === "completed" && item.id !== excludedWorkoutId).sort(byDateDesc).flatMap((workoutItem) => workoutItem.exercises.map((workoutExercise) => ({ workoutItem, workoutExercise }))).filter((item) => item.workoutExercise.exerciseId === exerciseId);
        const latest = entries[0];
        if (!latest) {
            return null;
        }
        const bestSet = latest.workoutExercise.sets.filter((set) => set.isCompleted && set.type !== "warmup").sort((left, right) => oneRepMax(right.weight, right.repetitions) - oneRepMax(left.weight, left.repetitions))[0];
        return bestSet ? { date: latest.workoutItem.date, weight: bestSet.weight, repetitions: bestSet.repetitions } : null;
    }

    // All prior instances of an exercise for a user (most recent first), excluding a workout.
    function exerciseInstances(userId, exerciseId, excludedWorkoutId = null) {
        if (!userId) {
            return [];
        }
        return workoutsFor(userId)
            .filter((item) => item.id !== excludedWorkoutId)
            .sort(byDateDesc)
            .flatMap((workoutItem) => workoutItem.exercises
                .filter((workoutExercise) => workoutExercise.exerciseId === exerciseId)
                .map((workoutExercise) => ({ date: workoutItem.date, sets: workoutExercise.sets || [], notes: String(workoutExercise.notes || "").trim() })));
    }

    function lastExerciseSets(userId, exerciseId, excludedWorkoutId = null) {
        return exerciseInstances(userId, exerciseId, excludedWorkoutId).find((entry) => entry.sets.length) || null;
    }

    function lastExerciseNote(userId, exerciseId, excludedWorkoutId = null) {
        return exerciseInstances(userId, exerciseId, excludedWorkoutId).find((entry) => entry.notes) || null;
    }

    function bestResult(userId, exerciseId) {
        return recordsFor(userId).find((record) => record.exerciseId === exerciseId) || null;
    }

    function teamBestResult(exerciseId) {
        return state.database.users.map((user) => bestResult(user.id, exerciseId)).filter(Boolean).sort((left, right) => right.estimatedOneRepMax - left.estimatedOneRepMax)[0] || null;
    }

    function progressData(userId, exerciseId) {
        return workoutsFor(userId).filter((item) => item.status === "completed").sort(byDateAsc).map((workoutItem) => {
            const workoutExercise = workoutItem.exercises.find((item) => item.exerciseId === exerciseId);
            const value = workoutExercise ? exerciseOneRepMax(workoutExercise) : 0;
            return value ? { date: workoutItem.date, value } : null;
        }).filter(Boolean);
    }

    function relatedExercises(exerciseId) {
        const source = exerciseById(exerciseId);
        return state.database.exercises.filter((item) => item.id !== exerciseId).map((item) => ({ item, score: (item.primaryMuscleGroup === source.primaryMuscleGroup ? 4 : 0) + (item.movementPattern === source.movementPattern ? 3 : 0) + (item.equipment === source.equipment ? 1 : 0) })).filter((row) => row.score > 0).sort((left, right) => right.score - left.score).map((row) => row.item);
    }

    function usersForExercise(exerciseId) {
        return [...new Set(state.database.workouts.filter((item) => item.exercises.some((exercise) => exercise.exerciseId === exerciseId)).map((item) => item.userId))].map(userById);
    }

    function lastUsed(exerciseId, userId = null) {
        const items = userId ? workoutsFor(userId) : state.database.workouts;
        return items.filter((item) => item.exercises.some((exercise) => exercise.exerciseId === exerciseId)).sort(byDateDesc)[0]?.date || null;
    }

    function muscleSetMap(workouts) {
        const map = new Map();
        workouts.forEach((workoutItem) => workoutItem.exercises.forEach((workoutExercise) => {
            const muscle = exerciseById(workoutExercise.exerciseId).primaryMuscleGroup;
            map.set(muscle, (map.get(muscle) || 0) + workoutExercise.sets.filter((set) => set.isCompleted).length);
        }));
        return map;
    }

    function exerciseUsageMap(workouts) {
        const map = new Map();
        workouts.forEach((workoutItem) => workoutItem.exercises.forEach((workoutExercise) => map.set(workoutExercise.exerciseId, (map.get(workoutExercise.exerciseId) || 0) + 1)));
        return map;
    }

    function topMap(map, transform = null) {
        const entry = [...map.entries()].sort((left, right) => right[1] - left[1])[0];
        return entry ? (transform ? transform(entry[0]) : entry[0]) : null;
    }

    function mainRank(userId) {
        const levels = rankedExerciseNames
            .map((name) => exerciseByName(name))
            .filter((exercise) => exercise && !String(exercise.id || "").startsWith("missing-"))
            .map((exercise) => rankingFor(userId, exercise.id).currentLevel?.level)
            .filter(Boolean);
        if (!levels.length) {
            return "Поки немає рівня";
        }
        return rankLabel(levels.sort((left, right) => rankOrder.indexOf(right) - rankOrder.indexOf(left))[0]);
    }

    function rankLabel(level) {
        return ({ beginner: "Початковий", novice: "Новачок", third_class: "3-й клас", second_class: "2-й клас", first_class: "1-й клас", candidate_master: "Кандидат у майстри", master: "Майстер" })[level] || capitalize(level);
    }

    function streak(completedWorkouts) {
        const dates = [...new Set(completedWorkouts.map((item) => item.date))].sort().reverse();
        if (!dates.length) {
            return 0;
        }
        let count = 0;
        let cursor = new Date();
        for (const date of dates) {
            const diff = dayDiff(cursor, new Date(date));
            if (diff <= 1 || count === 0) {
                count += 1;
                cursor = new Date(date);
            } else {
                break;
            }
        }
        return count;
    }

    function startTimer(duration) {
        clearInterval(state.timer.id);
        state.timer.duration = duration;
        state.timer.remaining = duration;
        state.timer.startedAt = Date.now();
        state.timer.running = true;
        state.timer.paused = false;
        state.timer.id = setInterval(timerTick, 250);
        renderFloatingTimer();
    }

    function timerTick() {
        if (state.timer.paused) {
            return;
        }
        const elapsed = Math.floor((Date.now() - state.timer.startedAt) / 1000);
        state.timer.remaining = Math.max(0, state.timer.duration - elapsed);
        updateFloatingTimer();
        if (state.timer.remaining <= 0) {
            stopTimer();
            timerDone();
        }
    }

    function timerDone() {
        toast("Відпочинок завершено", "Можна переходити до наступного підходу.");
        try {
            const audioContext = window.AudioContext || window.webkitAudioContext;
            if (audioContext) {
                const context = new audioContext();
                const oscillator = context.createOscillator();
                const gain = context.createGain();
                oscillator.connect(gain);
                gain.connect(context.destination);
                oscillator.frequency.value = 880;
                gain.gain.setValueAtTime(0.0001, context.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.25, context.currentTime + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.6);
                oscillator.start();
                oscillator.stop(context.currentTime + 0.62);
            }
        } catch (error) {
            console.warn("Timer sound unavailable", error);
        }
        if (navigator.vibrate) {
            navigator.vibrate([180, 90, 180]);
        }
        if ("Notification" in window && Notification.permission === "granted") {
            new Notification("GymOS", { body: "Відпочинок завершено." });
        }
    }

    function stopTimer() {
        clearInterval(state.timer.id);
        state.timer.id = null;
        state.timer.running = false;
        state.timer.paused = false;
        renderFloatingTimer();
    }

    function pauseTimer() {
        if (!state.timer.running || state.timer.paused) {
            return;
        }
        state.timer.paused = true;
        renderFloatingTimer();
    }

    function resumeTimer() {
        if (!state.timer.running || !state.timer.paused) {
            return;
        }
        state.timer.paused = false;
        state.timer.startedAt = Date.now() - (state.timer.duration - state.timer.remaining) * 1000;
        renderFloatingTimer();
    }

    function toggleTimerPause() {
        state.timer.paused ? resumeTimer() : pauseTimer();
    }

    function addTimerTime(delta) {
        if (!state.timer.running) {
            if (delta > 0) {
                startTimer(delta);
            }
            return;
        }
        state.timer.duration = Math.max(5, state.timer.duration + delta);
        state.timer.remaining = Math.max(1, state.timer.remaining + delta);
        state.timer.startedAt = Date.now() - (state.timer.duration - state.timer.remaining) * 1000;
        updateFloatingTimer();
    }

    function renderFloatingTimer() {
        let node = document.getElementById("floatingTimer");
        if (!state.timer.running) {
            if (node) {
                node.classList.remove("visible");
            }
            return;
        }
        if (!node) {
            node = document.createElement("div");
            node.id = "floatingTimer";
            node.className = "floating-timer";
            document.body.appendChild(node);
        }
        node.innerHTML = `
            <div class="floating-timer-bar"><span id="floatingTimerProgress"></span></div>
            <div class="floating-timer-body">
                <div class="floating-timer-label"><i data-lucide="timer"></i><span>Відпочинок</span></div>
                <div class="floating-timer-value" id="floatingTimerValue">${seconds(state.timer.remaining)}</div>
                <div class="floating-timer-actions">
                    <button class="icon-button" type="button" data-action="timer-add" data-delta="-15" title="-15 с"><i data-lucide="minus"></i></button>
                    <button class="icon-button" type="button" data-action="timer-toggle" title="Пауза / продовжити"><i data-lucide="${state.timer.paused ? "play" : "pause"}"></i></button>
                    <button class="icon-button" type="button" data-action="timer-add" data-delta="15" title="+15 с"><i data-lucide="plus"></i></button>
                    <button class="icon-button" type="button" data-action="timer-stop" title="Зупинити"><i data-lucide="x"></i></button>
                </div>
            </div>`;
        node.classList.add("visible");
        node.classList.toggle("paused", state.timer.paused);
        updateFloatingTimer();
        iconsIn(node);
    }

    function updateFloatingTimer() {
        const node = document.getElementById("floatingTimer");
        if (!node) {
            return;
        }
        const value = node.querySelector("#floatingTimerValue");
        const progress = node.querySelector("#floatingTimerProgress");
        if (value) {
            value.textContent = seconds(state.timer.remaining);
        }
        if (progress) {
            const percent = state.timer.duration ? Math.max(0, Math.min(100, (state.timer.remaining / state.timer.duration) * 100)) : 0;
            progress.style.width = `${percent}%`;
        }
        node.classList.toggle("paused", state.timer.paused);
    }

    function userById(id) {
        return state.database.users.find((user) => user.id === id);
    }

    function currentUser() {
        return userById(state.database.currentUserId);
    }

    const adminEmails = new Set(["zshkarrr@gmail.com"]);

    function effectiveRole() {
        return String(storage.currentUser?.role || currentUser()?.role || "free").toLowerCase();
    }

    function isAdmin() {
        const email = String(storage.currentUser?.email || currentUser()?.email || "").trim().toLowerCase();
        if (email !== "" && adminEmails.has(email)) {
            return true;
        }
        return effectiveRole() === "admin";
    }

    function hasUnlimited() {
        return isAdmin() || effectiveRole() === "premium";
    }

    function roleLabel(role) {
        return ({ free: "Free", premium: "PRO", admin: "Адмін" })[String(role || "free").toLowerCase()] || "Free";
    }

    function roleBadge(role) {
        const key = String(role || "free").toLowerCase();
        if (key === "admin") {
            return `<span class="role-badge admin"><i data-lucide="shield"></i>Адмін</span>`;
        }
        if (key === "premium") {
            return `<span class="role-badge premium"><i data-lucide="crown"></i>PRO</span>`;
        }
        return `<span class="role-badge free">Free</span>`;
    }

    function exerciseQuotaState(userId) {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const count = state.database.exercises.filter((exercise) => exercise.createdByUserId === userId && exercise.createdAt && new Date(exercise.createdAt) >= startOfMonth).length;
        return { count, limit: 1, over: count >= 1 };
    }

    function canEditExercise(exercise) {
        if (!exercise) {
            return false;
        }
        const me = currentUser();
        return isAdmin() || (Boolean(me) && exercise.createdByUserId === me.id);
    }

    // True only for the exercise's own creator — drives the personal "Моя" badge.
    function isMyExercise(exercise) {
        const me = currentUser();
        return Boolean(me && exercise && exercise.createdByUserId === me.id);
    }

    function exerciseOwnerName(exercise) {
        if (!exercise || !exercise.createdByUserId) {
            return "GymOS";
        }
        const owner = userById(exercise.createdByUserId);
        return owner ? owner.displayName : "GymOS";
    }

    // Free-tier workout quota (mirrors the backend): 1/day, 2/ISO-week. Admins exempt.
    function workoutQuotaState(userId, when) {
        const date = when ? new Date(when) : new Date();
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(startOfDay);
        endOfDay.setDate(endOfDay.getDate() + 1);
        const startOfWeek = new Date(startOfDay);
        const mondayOffset = (startOfWeek.getDay() + 6) % 7;
        startOfWeek.setDate(startOfWeek.getDate() - mondayOffset);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(endOfWeek.getDate() + 7);
        const mine = workoutsFor(userId);
        const inRange = (workoutItem, from, to) => {
            const value = new Date(workoutItem.date);
            return value >= from && value < to;
        };
        const day = mine.filter((workoutItem) => inRange(workoutItem, startOfDay, endOfDay)).length;
        const week = mine.filter((workoutItem) => inRange(workoutItem, startOfWeek, endOfWeek)).length;
        return { day, week, dayLimit: 1, weekLimit: 2, overDay: day >= 1, overWeek: week >= 2, over: day >= 1 || week >= 2 };
    }

    function canManage(workoutItem) {
        if (!workoutItem) {
            return false;
        }
        const me = currentUser();
        return (Boolean(me) && workoutItem.userId === me.id) || isAdmin();
    }

    function workoutNumber(workoutItem) {
        const list = workoutsFor(workoutItem.userId).slice().sort((left, right) => new Date(left.createdAt || left.date) - new Date(right.createdAt || right.date));
        const index = list.findIndex((item) => item.id === workoutItem.id);
        return (index >= 0 ? index : list.length - 1) + 1;
    }

    function workoutLabel(workoutItem) {
        return `Тренування #${workoutNumber(workoutItem)}`;
    }

    function exerciseById(id) {
        return state.database.exercises.find((exercise) => exercise.id === id) || missingExercise(id);
    }

    function exerciseByName(name) {
        const normalizedName = String(name || "").toLowerCase();
        return state.database.exercises.find((exercise) => {
            return exercise.name === name ||
                String(exercise.originalName || "").toLowerCase() === normalizedName ||
                (exercise.aliases || []).some((alias) => String(alias).toLowerCase() === normalizedName);
        }) || missingExercise(`missing-${createSlug(name)}`, name);
    }

    function missingExercise(id, name = "Вправа недоступна") {
        return {
            id: id || "missing-exercise",
            name,
            aliases: [],
            primaryMuscleGroup: "Не налаштовано",
            secondaryMuscleGroups: [],
            movementPattern: "Не налаштовано",
            equipment: "Інше",
            category: "Власна",
            difficulty: "Середній",
            description: "Ця вправа відсутня у поточному каталозі backend.",
            techniqueSteps: [],
            commonMistakes: [],
            safetyTips: [],
            mediaUrl: "",
            mediaType: "none",
            isMissing: true
        };
    }

    function workoutsFor(userId) {
        return state.database.workouts.filter((workoutItem) => workoutItem.userId === userId);
    }

    function activeWorkoutFor(userId) {
        return state.database.workouts.find((workoutItem) => workoutItem.userId === userId && workoutItem.status === "active");
    }

    function ownWorkout(workoutId) {
        const workoutItem = state.database.workouts.find((item) => item.id === workoutId);
        return workoutItem && canManage(workoutItem) ? workoutItem : null;
    }

    function editWorkout() {
        const id = state.editingWorkoutId;
        if (id) {
            const owned = ownWorkout(id);
            if (owned) {
                return owned;
            }
        }
        return activeWorkoutFor(currentUser().id) || null;
    }

    function editWorkoutExercise(id) {
        return editWorkout()?.exercises.find((item) => item.id === id);
    }

    function editSetByIds(workoutExerciseId, setId) {
        return editWorkoutExercise(workoutExerciseId)?.sets.find((set) => set.id === setId);
    }

    function statusRank(status) {
        return ({ active: 0, planned: 1, completed: 2 })[status] ?? 3;
    }

    function cardioIcon(type) {
        return ({ treadmill: "footprints", running: "footprints", walking: "footprints", bike: "bike", rower: "waves", elliptical: "activity", other: "heart-pulse" })[type] || "heart-pulse";
    }

    function templateById(id) {
        return templates.find((template) => template.id === id) || templates.at(-1);
    }

    function templateByType(type) {
        return templates.find((template) => template.type === type) || templateById("custom");
    }

    function statusLabel(status) {
        return statusLabels[status] || capitalize(status);
    }

    function setTypeLabel(type) {
        return setTypeLabels[type] || capitalize(type);
    }

    function workoutTypeLabel(type) {
        return workoutTypeLabels[type] || capitalize(type);
    }

    function genderLabel(gender) {
        return genderLabels[gender] || gender;
    }

    function dataModeLabel(mode) {
        return dataModeLabels[mode] || mode;
    }

    function backendStatusLabel(status) {
        return ({ online: "доступний", offline: "недоступний", unknown: "не перевірено" })[status] || "не перевірено";
    }

    function cardioTypeLabel(type) {
        return ({ treadmill: "Бігова доріжка", bike: "Велотренажер", running: "Біг", walking: "Ходьба", rower: "Гребний тренажер" })[type] || type;
    }

    function intensityLabel(value) {
        return ({ low: "низька", medium: "середня", high: "висока" })[value] || value;
    }

    function workoutSetCount(workoutItem) {
        return workoutItem.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
    }

    function workoutCardioMinutes(workoutItem) {
        return (workoutItem.cardioSessions || []).reduce((sum, session) => sum + session.durationMinutes, 0);
    }

    function calendarOverview() {
        const now = new Date();
        const weekStart = startWeek(now);
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const weekItems = state.database.workouts.filter((item) => new Date(item.date) >= weekStart);
        const monthItems = state.database.workouts.filter((item) => new Date(item.date) >= monthStart);
        const completed = state.database.workouts.filter((item) => item.status === "completed");
        return {
            weekWorkouts: weekItems.length,
            weekCompleted: weekItems.filter((item) => item.status === "completed").length,
            weekPlanned: weekItems.filter((item) => item.status === "planned").length,
            monthWorkouts: monthItems.length,
            monthPlanned: monthItems.filter((item) => item.status === "planned").length,
            cardioDays: new Set(weekItems.filter((item) => workoutCardioMinutes(item) > 0).map((item) => item.date)).size,
            streak: streak(completed)
        };
    }

    function seedWeight(name, index) {
        const weights = { "Жим лежачи": 72, "Жим гантелей під кутом": 28, "Жим у тренажері": 78, "Зведення в кросовері": 18, "Підтягування": 78, "Тяга верхнього блока": 67, "Тяга штанги в нахилі": 72, "Горизонтальна тяга блока": 64, "Жим над головою": 45, "Підйом гантелей в сторони": 12, "Розведення на задню дельту": 10, "Присідання зі штангою": 92, "Жим ногами": 180, "Розгинання ніг": 56, "Румунська тяга": 82, "Згинання ніг": 48, "Підйом на литки": 72, "Згинання зі штангою": 32, "Згинання з гантелями": 16, "Молоткові згинання": 18, "Розгинання на блоці": 38, "Розгинання трицепса над головою": 32, "Планка": 0, "Підйом ніг у висі": 0 };
        return round((weights[name] || 25) + index * 0.7, 1);
    }

    function todayLabel(userId) {
        const item = workoutsFor(userId).find((workoutItem) => workoutItem.date === dateInput(new Date()));
        return item ? item.title : "Заплануй сьогодні";
    }

    function todayCaption(userId) {
        const item = workoutsFor(userId).find((workoutItem) => workoutItem.date === dateInput(new Date()));
        return item ? statusLabel(item.status) : "Тренувань сьогодні ще немає";
    }

    function avatar(user, size = "") {
        const url = imageUrl(user?.avatarUrl);
        const image = url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(user.displayName || "")}" referrerpolicy="no-referrer" loading="lazy" decoding="async" onerror="this.remove()">` : "";
        return `<div class="avatar ${size}" style="background:${escapeHtml(user.avatarColor)};">${escapeHtml(user.avatarInitials)}${image}</div>`;
    }

    function ordered(items) {
        return `<ol>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`;
    }

    function bullets(items) {
        return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
    }

    function select(id, options, selected) {
        return `<gym-select id="${id}">${options.map((option) => `<option value="${escapeHtml(option)}" ${option === selected ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</gym-select>`;
    }

    function uniqueStrings(items) {
        return [...new Set(items.map(cleanText).filter(Boolean))];
    }

    function cleanList(items) {
        return uniqueStrings(Array.isArray(items) ? items : []);
    }

    function cleanText(value) {
        return String(value || "").trim();
    }

    function stripSourcePrefix(value) {
        return value.replace(/^ExRx\.net\s*:\s*/i, "").trim();
    }

    function createSlug(value) {
        return cleanText(value).toLowerCase().replace(/[^a-z0-9а-яіїєґ]+/gi, "-").replace(/^-|-$/g, "").slice(0, 90);
    }

    function normalizeMuscleGroup(value = "", category = "", originalName = "") {
        const text = `${value} ${category} ${originalName}`.toLowerCase();
        if (/(chest|pector|pec\b|sternal|clavicular)/.test(text)) return "Груди";
        if (/(back|lat|teres|trap|rhomboid|row)/.test(text)) return "Спина";
        if (/(delt|shoulder|front delt|side delt|rear delt)/.test(text)) return "Плечі";
        if (/triceps/.test(text)) return "Трицепс";
        if (/(biceps|brachialis|curl)/.test(text)) return "Біцепс";
        if (/(forearm|wrist|grip)/.test(text)) return "Передпліччя";
        if (/(quad|thigh|leg extension)/.test(text)) return "Квадрицепс";
        if (/(hamstring|leg curl)/.test(text)) return "Задня поверхня стегна";
        if (/(glute|hip)/.test(text)) return "Сідниці";
        if (/(calf|gastrocnemius|soleus)/.test(text)) return "Литки";
        if (/(ab|oblique|waist|core)/.test(text)) return "Прес";
        if (/neck/.test(text)) return "Шия";
        return value && value !== "Full Body" ? cleanText(value) : "Все тіло";
    }

    function normalizeEquipment(value = "", originalName = "") {
        const text = `${value} ${originalName}`.toLowerCase();
        if (/barbell|bb\b/.test(text)) return "Штанга";
        if (/dumbbell|db\b/.test(text)) return "Гантелі";
        if (/cable|pulley/.test(text)) return "Блок";
        if (/lever|machine|sled|smith/.test(text)) return "Тренажер";
        if (/body\s?weight|self|assisted/.test(text)) return "Вага тіла";
        if (/kettlebell/.test(text)) return "Гиря";
        if (/band/.test(text)) return "Еспандер";
        if (/medicine/.test(text)) return "Медбол";
        return cleanText(value) || "Інше";
    }

    function normalizeMovementPattern(value = "", category = "", originalName = "") {
        const text = `${value} ${category} ${originalName}`.toLowerCase();
        if (/cardio|walk|run|cycle|bike|treadmill/.test(text)) return "Кардіо";
        if (/squat|lunge|step-up|leg press/.test(text)) return "Присідання";
        if (/deadlift|hinge|pull-through|good morning/.test(text)) return "Hinge";
        if (/row/.test(text)) return "Горизонтальна тяга";
        if (/pulldown|pull-up|chin-up/.test(text)) return "Вертикальна тяга";
        if (/military|overhead|shoulder press|vertical press/.test(text)) return "Вертикальний жим";
        if (/press|bench|dip|push-up/.test(text)) return "Горизонтальний жим";
        if (/raise|fly|abduction/.test(text)) return "Підйом";
        if (/curl|flexion/.test(text)) return "Згинання";
        if (/extension|pushdown/.test(text)) return "Розгинання";
        if (/rotation|twist|crunch|sit-up|plank/.test(text)) return "Кор";
        return cleanText(value) || "Ізоляція";
    }

    function normalizeDifficulty(value = "") {
        const text = String(value || "").toLowerCase();
        if (/advanced|expert/.test(text)) return "Просунутий";
        if (/beginner|basic|easy/.test(text)) return "Початковий";
        return "Середній";
    }

    function content(html) {
        element("pageContent").innerHTML = html;
    }

    function element(id) {
        return document.getElementById(id);
    }

    function openModal(html) {
        closeOverlay();
        element("modalBackdrop").classList.remove("hidden");
        element("modalLayer").innerHTML = html;
        element("modalLayer").classList.remove("hidden");
        iconsIn(element("modalLayer"));
        lockBackgroundScroll();
    }

    // Reliable in-app confirmation (native confirm() is unreliable/blocked on mobile).
    function confirmDialog(message, options = {}) {
        const { title = "Підтвердження", confirmLabel = "Підтвердити", cancelLabel = "Скасувати", danger = true } = options;
        return new Promise((resolve) => {
            closeOverlay();
            const backdrop = element("modalBackdrop");
            const layer = element("modalLayer");
            backdrop.classList.remove("hidden");
            layer.innerHTML = `<div class="confirm-dialog"><div class="modal-header"><div><h2>${escapeHtml(title)}</h2></div></div><p class="confirm-message">${escapeHtml(message)}</p><div class="form-actions" style="justify-content:flex-end;margin-top:18px;"><button class="button button-secondary" type="button" id="confirmCancelBtn">${escapeHtml(cancelLabel)}</button><button class="button ${danger ? "button-danger" : "button-primary"}" type="button" id="confirmOkBtn">${escapeHtml(confirmLabel)}</button></div></div>`;
            layer.classList.remove("hidden");
            iconsIn(layer);
            lockBackgroundScroll();
            let settled = false;
            const finish = (result) => {
                if (settled) {
                    return;
                }
                settled = true;
                backdrop.removeEventListener("click", onBackdrop);
                closeOverlay();
                resolve(result);
            };
            const onBackdrop = () => finish(false);
            backdrop.addEventListener("click", onBackdrop);
            element("confirmOkBtn").addEventListener("click", () => finish(true));
            element("confirmCancelBtn").addEventListener("click", () => finish(false));
        });
    }

    function openDrawer(html) {
        closeOverlay();
        element("modalBackdrop").classList.remove("hidden");
        element("drawerLayer").innerHTML = html;
        element("drawerLayer").classList.remove("hidden");
        iconsIn(element("drawerLayer"));
        lockBackgroundScroll();
    }

    // --- Background scroll-lock for overlays (modal/drawer) ---
    // Without this, iOS routes a touch-scroll to the page *behind* a position:fixed
    // overlay (rubber-banding — "задник сердиться") and the overlay itself often
    // won't scroll at all. Pinning <body> position:fixed makes the overlay the only
    // scrollable surface; we save/restore scrollY so there is no jump on open/close.
    let scrollLockY = 0;
    let scrollLocked = false;

    function lockBackgroundScroll() {
        // Only lock on touch-primary devices (the iOS drawer rubber-band fix this
        // was built for). On desktop a position:fixed <body> is unnecessary and has
        // repeatedly risked freezing main-content scroll, so skip it entirely there.
        const touchPrimary = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
        if (!touchPrimary) {
            return;
        }
        if (scrollLocked) {
            return;
        }
        scrollLocked = true;
        scrollLockY = window.scrollY || window.pageYOffset || 0;
        // compensate for the desktop scrollbar disappearing (no-op on mobile overlay scrollbars)
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
        const bodyStyle = document.body.style;
        bodyStyle.position = "fixed";
        bodyStyle.top = `-${scrollLockY}px`;
        bodyStyle.left = "0";
        bodyStyle.right = "0";
        bodyStyle.width = "100%";
        if (scrollbarWidth > 0) {
            bodyStyle.paddingRight = `${scrollbarWidth}px`;
        }
        document.documentElement.classList.add("overlay-open");
    }

    function unlockBackgroundScroll() {
        // Clear the lock styles UNCONDITIONALLY (idempotent) — even if the flag
        // ever desyncs, a stuck position:fixed must never survive and kill page /
        // mouse-wheel scrolling. Only restore scroll position if we were locked.
        const wasLocked = scrollLocked;
        scrollLocked = false;
        const bodyStyle = document.body.style;
        bodyStyle.position = "";
        bodyStyle.top = "";
        bodyStyle.left = "";
        bodyStyle.right = "";
        bodyStyle.width = "";
        bodyStyle.paddingRight = "";
        document.documentElement.classList.remove("overlay-open");
        if (wasLocked) {
            window.scrollTo(0, scrollLockY);
        }
    }

    function closeOverlay() {
        // Unlock FIRST so a later DOM error can't skip it and leave scroll frozen.
        unlockBackgroundScroll();
        element("modalBackdrop").classList.add("hidden");
        element("modalLayer").classList.add("hidden");
        element("drawerLayer").classList.add("hidden");
        element("modalLayer").innerHTML = "";
        element("drawerLayer").innerHTML = "";
    }

    // Self-heal: if no overlay is actually open but the body is still locked
    // (e.g. an interrupted close), force scrolling back on. Runs on tab focus /
    // bfcache restore and navigation so a stuck lock can never persist.
    function ensureScrollUnlockedIfNoOverlay() {
        const modalHidden = element("modalLayer").classList.contains("hidden");
        const drawerHidden = element("drawerLayer").classList.contains("hidden");
        if (modalHidden && drawerHidden && (scrollLocked || document.body.style.position === "fixed")) {
            unlockBackgroundScroll();
        }
    }

    function showBusyOverlay(options = {}) {
        let overlay = document.getElementById("busyOverlay");
        if (!overlay) {
            overlay = document.createElement("div");
            overlay.id = "busyOverlay";
            overlay.className = "busy-overlay hidden";
            overlay.innerHTML = `<section class="busy-panel" role="status" aria-live="polite" aria-busy="true">
                <div class="pixel-loader" aria-hidden="true">${Array.from({ length: 25 }, (_, index) => `<span style="--cell:${index};"></span>`).join("")}</div>
                <div>
                    <p class="busy-kicker">GymOS</p>
                    <h2 id="busyTitle">Синхронізація</h2>
                    <p class="busy-message" id="busyMessage">Готуємо дані.</p>
                    <p class="busy-detail" id="busyDetail">Це займе кілька секунд.</p>
                    <div class="busy-progress" aria-hidden="true"><span id="busyProgress"></span></div>
                </div>
            </section>`;
            document.body.appendChild(overlay);
        }

        updateBusyOverlay(overlay, options);
        overlay.classList.remove("hidden");
        return overlay;
    }

    function updateBusyOverlay(overlay, options = {}) {
        if (!overlay) {
            return;
        }

        const progress = Math.max(0, Math.min(100, Number(options.progress || 0)));
        overlay.querySelector("#busyTitle").textContent = options.title || overlay.querySelector("#busyTitle").textContent;
        overlay.querySelector("#busyMessage").textContent = options.message || overlay.querySelector("#busyMessage").textContent;
        overlay.querySelector("#busyDetail").textContent = options.detail || overlay.querySelector("#busyDetail").textContent;
        overlay.querySelector("#busyProgress").style.width = `${progress}%`;
    }

    function hideBusyOverlay(overlay) {
        if (!overlay) {
            return;
        }

        window.setTimeout(() => {
            overlay.classList.add("hidden");
        }, 180);
    }

    function resourceLabel(resource) {
        const labels = {
            customExercises: "власні вправи",
            bodyweightEntries: "замір ваги",
            workouts: "тренування"
        };
        return labels[resource] || "дані";
    }

    let syncIndicatorTimeoutId = null;

    // Save status lives inline in the topbar as a subtle chip (loading/success);
    // errors escalate to a readable, dismissible toast instead of lingering there.
    function showSyncIndicator(status, message) {
        if (status === "error") {
            toast(message || "Щось пішло не так", "", "error");
            return;
        }
        const chip = document.getElementById("syncChip");
        if (!chip) {
            return;
        }
        const icon = status === "loading"
            ? `<span class="square-loader small" aria-hidden="true"></span>`
            : `<span class="sync-chip-ico" aria-hidden="true"><i data-lucide="check"></i></span>`;
        chip.className = `sync-chip visible ${status}`;
        chip.innerHTML = `${icon}<span class="sync-chip-text">${escapeHtml(message)}</span>`;
        if (status === "success") {
            iconsIn(chip);
        }
        clearTimeout(syncIndicatorTimeoutId);
        if (status !== "loading") {
            syncIndicatorTimeoutId = setTimeout(() => chip.classList.remove("visible"), 1900);
        }
    }

    function handleUserFacingError(error, action = "") {
        console.error(error);
        const message = friendlyError(error);
        showSyncIndicator("error", message); // routes to an error toast

        if (Number(error?.status) === 401 && storage.config.requireAuth) {
            renderAuthGate(message);
        }
    }

    function friendlyError(error) {
        const status = Number(error?.status || 0);
        const rawMessage = String(error?.message || "").trim();

        if (status === 401) {
            return "Сесія неактивна. Увійди через Google ще раз.";
        }
        if (status === 429) {
            return rawMessage || "Забагато запитів за коротку мить. Зачекай кілька секунд.";
        }
        if (status === 403) {
            // Quota/limit hits carry a specific, friendly message from the backend
            // (e.g. PRO daily caps) — surface it instead of the generic permission line.
            const code = error?.payload?.code;
            if (code === "WORKOUT_LIMIT" || code === "EXERCISE_LIMIT" || code === "FEEDBACK_LIMIT") {
                return rawMessage || "Ліміт тарифу досягнуто.";
            }
            return "Немає прав для цієї дії.";
        }
        if (status === 413) {
            return "Дані завеликі для одного запиту. Спробуй імпорт маленькими пачками.";
        }
        if (status >= 500) {
            return "Backend тимчасово недоступний. Спробуй ще раз за кілька секунд.";
        }
        if (/failed to fetch|networkerror|load failed/i.test(rawMessage)) {
            return "Не вдалося підключитися до backend. Перевір інтернет або deployment.";
        }
        if (/api base url is not configured/i.test(rawMessage)) {
            return "API URL не налаштовано.";
        }

        return rawMessage || "Запит не виконано. Спробуй ще раз.";
    }

    function toast(title, message = "", type = "default") {
        const toastElement = document.createElement("div");
        toastElement.className = `toast toast-${type}`;
        toastElement.setAttribute("role", type === "error" ? "alert" : "status");
        const icon = type === "error" ? "alert-triangle" : "sparkles";
        toastElement.innerHTML = `<span class="toast-icon"><i data-lucide="${icon}"></i></span><div class="toast-body"><strong>${escapeHtml(title)}</strong>${message ? `<p class="toast-message">${escapeHtml(message)}</p>` : ""}</div><span class="toast-progress" aria-hidden="true"></span>`;
        element("toastStack").appendChild(toastElement);
        iconsIn(toastElement);

        let timer = null;
        let leaving = false;
        const remove = () => toastElement.remove();

        // Standard exit (tap / auto-dismiss): slide-up + fade via CSS animation.
        const dismiss = () => {
            if (leaving) {
                return;
            }
            leaving = true;
            clearTimeout(timer);
            toastElement.style.animation = ""; // let the .is-leaving animation own it
            toastElement.classList.add("is-leaving");
            toastElement.addEventListener("animationend", (event) => {
                if (event.target === toastElement && event.animationName === "toastOut") {
                    remove();
                }
            });
            setTimeout(remove, 450); // fallback if animationend doesn't fire
        };

        // Swipe exit: fly off in the gesture direction, then remove.
        const flyOut = (direction) => {
            if (leaving) {
                return;
            }
            leaving = true;
            clearTimeout(timer);
            const offX = direction === "left" ? -window.innerWidth : direction === "right" ? window.innerWidth : 0;
            const offY = direction === "up" ? -180 : 0;
            toastElement.style.transition = "transform 0.3s cubic-bezier(0.4, 0, 1, 1), opacity 0.3s ease";
            toastElement.style.transform = `translate(${offX}px, ${offY}px)`;
            toastElement.style.opacity = "0";
            toastElement.addEventListener("transitionend", remove, { once: true });
            setTimeout(remove, 400);
        };

        const startTimer = () => {
            timer = setTimeout(dismiss, 4200);
        };
        startTimer();

        // Hover pauses the auto-dismiss (desktop).
        toastElement.addEventListener("mouseenter", () => {
            if (!leaving) {
                clearTimeout(timer);
                toastElement.classList.add("is-paused");
            }
        });
        toastElement.addEventListener("mouseleave", () => {
            if (!leaving) {
                toastElement.classList.remove("is-paused");
                startTimer();
            }
        });

        // Tap to dismiss + swipe up / left / right to flick away.
        const THRESHOLD = 64;
        let startX = 0;
        let startY = 0;
        let dx = 0;
        let dy = 0;
        let dragging = false;
        let moved = false;
        let activePointer = null;

        toastElement.addEventListener("pointerdown", (event) => {
            if (leaving || activePointer !== null) {
                return;
            }
            activePointer = event.pointerId;
            startX = event.clientX;
            startY = event.clientY;
            dx = 0;
            dy = 0;
            dragging = true;
            moved = false;
            clearTimeout(timer);
            toastElement.style.animation = "none"; // free the transform for dragging
            toastElement.classList.add("is-paused", "is-dragging");
            try {
                toastElement.setPointerCapture(event.pointerId);
            } catch (_) {}
        });

        toastElement.addEventListener("pointermove", (event) => {
            if (!dragging || event.pointerId !== activePointer) {
                return;
            }
            dx = event.clientX - startX;
            dy = event.clientY - startY;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                moved = true;
            }
            const horizontal = Math.abs(dx) >= Math.abs(dy);
            let tx = 0;
            let ty = 0;
            if (horizontal) {
                tx = dx;
            } else {
                ty = dy < 0 ? dy : dy * 0.25; // up moves freely, down resists
            }
            const distance = horizontal ? Math.abs(dx) : Math.abs(ty);
            const opacity = Math.max(0.35, 1 - distance / (THRESHOLD * 3));
            toastElement.style.transform = `translate(${tx}px, ${ty}px)`;
            toastElement.style.opacity = String(opacity);
        });

        const endDrag = (event) => {
            if (!dragging || (event && event.pointerId !== activePointer)) {
                return;
            }
            dragging = false;
            activePointer = null;
            toastElement.classList.remove("is-dragging");
            const horizontal = Math.abs(dx) >= Math.abs(dy);
            const flick = horizontal
                ? (Math.abs(dx) >= THRESHOLD ? (dx < 0 ? "left" : "right") : null)
                : (dy < 0 && Math.abs(dy) >= THRESHOLD ? "up" : null);
            if (flick) {
                flyOut(flick);
                return;
            }
            // snap back into place
            toastElement.style.transition = "transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.28s ease";
            toastElement.style.transform = "translate(0, 0)";
            toastElement.style.opacity = "1";
            toastElement.addEventListener("transitionend", function clear() {
                toastElement.style.transition = "";
                toastElement.style.transform = "";
                toastElement.style.opacity = "";
                toastElement.removeEventListener("transitionend", clear);
            }, { once: true });
            if (!leaving) {
                toastElement.classList.remove("is-paused");
                startTimer();
            }
        };

        toastElement.addEventListener("pointerup", endDrag);
        toastElement.addEventListener("pointercancel", endDrag);

        toastElement.addEventListener("click", () => {
            if (moved) {
                moved = false;
                return; // a swipe/drag, not a tap
            }
            dismiss();
        });
    }

    function icons() {
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    // Scoped icon conversion: only scans `root` instead of the whole document.
    // Use for frequent, self-contained updates (toasts, chip) to avoid a
    // full-document [data-lucide] scan on every small UI change.
    function iconsIn(root) {
        if (window.lucide && root) {
            window.lucide.createIcons({ root });
        }
    }

    function startWeek(date) {
        const result = new Date(date);
        const day = result.getDay() || 7;
        result.setHours(0, 0, 0, 0);
        result.setDate(result.getDate() - day + 1);
        return result;
    }

    function startDay(date) {
        const result = new Date(date);
        result.setHours(0, 0, 0, 0);
        return result;
    }

    function addDays(date, days) {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
    }

    function addMinutes(date, minutes) {
        const result = new Date(date);
        result.setMinutes(result.getMinutes() + minutes);
        return result;
    }

    function setClock(date, hours, minutes) {
        const result = new Date(date);
        result.setHours(hours, minutes, 0, 0);
        return result;
    }

    function dayDiff(left, right) {
        return Math.floor((startDay(left) - startDay(right)) / 86400000);
    }


    function numberValue(id, fallback) {
        return Number(inputValue(id)) || fallback;
    }

    function inputValue(id) {
        return element(id)?.value || "";
    }

    function round(value, precision = 1) {
        const multiplier = 10 ** precision;
        return Math.round((Number(value) || 0) * multiplier) / multiplier;
    }

    function capitalize(value) {
        return String(value || "").replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
    }

    function byDateDesc(left, right) {
        return new Date(right.date || right.createdAt) - new Date(left.date || left.createdAt);
    }

    function byDateAsc(left, right) {
        return new Date(left.date || left.createdAt) - new Date(right.date || right.createdAt);
    }

    function createId(prefix) {
        return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    }

    async function persist(options = {}) {
        state.database.updatedAt = new Date().toISOString();
        if (!options.silent) {
            showSyncIndicator("loading", "Зберігаємо зміни");
        }

        try {
            await storage.save(state.database);
            if (!options.silent) {
                showSyncIndicator("success", "Зміни збережено");
            }
        } catch (error) {
            showSyncIndicator("error", friendlyError(error));
            throw error;
        }
    }

    function workoutPayload(workoutItem) {
        return {
            date: workoutItem.date,
            title: workoutItem.title || "Тренування",
            status: workoutItem.status || "active",
            workoutType: workoutItem.workoutType || "custom",
            notes: workoutItem.notes || "",
            exercises: (workoutItem.exercises || []).map((exercise, index) => ({
                exerciseId: exercise.exerciseId,
                order: exercise.order || index + 1,
                notes: exercise.notes || "",
                sets: (exercise.sets || []).map((set) => ({
                    type: set.type || "working",
                    weight: Number(set.weight) || 0,
                    repetitions: Number(set.repetitions) || 0,
                    rpe: Number(set.rpe) || 0,
                    restSeconds: Number(set.restSeconds) || 90,
                    isCompleted: Boolean(set.isCompleted),
                    notes: set.notes || ""
                }))
            })),
            cardioSessions: (workoutItem.cardioSessions || []).map((session) => ({
                type: session.type || "treadmill",
                durationMinutes: Number(session.durationMinutes) || 0,
                distance: Number(session.distance) || 0,
                calories: Number(session.calories) || 0,
                averageHeartRate: Number(session.averageHeartRate) || 0,
                intensity: session.intensity || "medium",
                notes: session.notes || ""
            }))
        };
    }

    // ---- Coalescing, serialized per-workout saver ----
    // Each workout has at most ONE save in flight. Rapid edits collapse into a
    // single trailing save that always sends the LATEST full state. The "saved"
    // (green) indicator only appears once the queue is fully drained, so it never
    // lies while later saves are still pending/failing. Failed saves retry a few
    // times (covers transient 500s) before surfacing an error.
    const workoutSavers = new Map();
    let localPersistTimeoutId = null;

    function getWorkoutSaver(workoutId) {
        let saver = workoutSavers.get(workoutId);
        if (!saver) {
            saver = { running: false, dirty: false, retries: 0, timer: null, lastError: null };
            workoutSavers.set(workoutId, saver);
        }
        return saver;
    }

    function requestWorkoutSave(workoutItem, debounceMs = 0) {
        if (!workoutItem) {
            return;
        }
        state.database.updatedAt = new Date().toISOString();

        if (!(storage.mode === "api" && storage.apiClient.hasBaseUrl())) {
            clearTimeout(localPersistTimeoutId);
            localPersistTimeoutId = setTimeout(() => {
                persist({ silent: true }).catch((error) => {
                    console.error(error);
                    showSyncIndicator("error", friendlyError(error));
                });
            }, Math.max(150, debounceMs));
            return;
        }

        const saver = getWorkoutSaver(workoutItem.id);
        showSyncIndicator("loading", "Зберігаємо…");
        clearTimeout(saver.timer);
        saver.timer = setTimeout(() => runWorkoutSave(workoutItem.id), debounceMs);
    }

    async function runWorkoutSave(workoutId) {
        const saver = getWorkoutSaver(workoutId);
        if (saver.running) {
            saver.dirty = true;
            return;
        }
        const workoutItem = state.database.workouts.find((item) => item.id === workoutId && canManage(item));
        if (!workoutItem) {
            return;
        }

        saver.running = true;
        saver.dirty = false;
        let ok = false;
        try {
            workoutItem.updatedAt = new Date().toISOString();
            await storage.apiClient.saveWorkout(workoutItem.id, workoutPayload(workoutItem));
            storage.backendStatus = "online";
            ok = true;
            saver.retries = 0;
        } catch (error) {
            saver.lastError = error;
            console.error(error);
            if (Number(error?.status) === 401 && storage.config.requireAuth) {
                saver.running = false;
                handleUserFacingError(error, "save-workout");
                return;
            }
        } finally {
            saver.running = false;
            if (saver.dirty) {
                runWorkoutSave(workoutId);
            } else if (ok) {
                showSyncIndicator("success", "Збережено");
            } else if (saver.retries < 3) {
                saver.retries += 1;
                showSyncIndicator("loading", "Повтор збереження…");
                setTimeout(() => runWorkoutSave(workoutId), 1000 * saver.retries);
            } else {
                saver.retries = 0;
                showSyncIndicator("error", friendlyError(saver.lastError));
            }
        }
    }

    function cancelWorkoutSave(workoutId) {
        const saver = workoutSavers.get(workoutId);
        if (saver) {
            clearTimeout(saver.timer);
            workoutSavers.delete(workoutId);
        }
    }

    // Thin wrappers kept so existing call sites stay unchanged. Saves are now
    // optimistic + coalesced (fire-and-forget) — the UI updates instantly and the
    // serializer guarantees one in-flight save with the latest state.
    function persistWorkout(workoutItem) {
        requestWorkoutSave(workoutItem, 0);
        return Promise.resolve();
    }

    function schedulePersistWorkout(workoutItem) {
        requestWorkoutSave(workoutItem, 650);
    }
})();

// Branded DevTools console banner + self-XSS warning. Pure client-side UX, no
// effect on the app. Exposed as window.gymosBanner() for manual re-print.
(function gymosConsoleBanner() {
    if (typeof window === "undefined" || typeof console === "undefined") {
        return;
    }

    const version = (window.FORGE_CONFIG && window.FORGE_CONFIG.version) || "0.1.0";
    const repoUrl = "https://github.com/shkarsmode/gym-os";

    const ascii = [
        " ██████╗ ██╗   ██╗███╗   ███╗ ██████╗ ███████╗",
        "██╔════╝ ╚██╗ ██╔╝████╗ ████║██╔═══██╗██╔════╝",
        "██║  ███╗ ╚████╔╝ ██╔████╔██║██║   ██║███████╗",
        "██║   ██║  ╚██╔╝  ██║╚██╔╝██║██║   ██║╚════██║",
        "╚██████╔╝   ██║   ██║ ╚═╝ ██║╚██████╔╝███████║",
        " ╚═════╝    ╚═╝   ╚═╝     ╚═╝ ╚═════╝ ╚══════╝"
    ].join("\n");

    const style = {
        green: "color:#34e89e;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.15;text-shadow:0 0 10px rgba(52,232,158,.45);",
        pill: "background:linear-gradient(135deg,#34e89e,#0a8f5f);color:#04150f;font-weight:800;font-size:13px;letter-spacing:3px;padding:6px 16px;border-radius:9px;",
        tag: "color:#cfe9df;font-size:13px;font-weight:600;",
        muted: "color:#7c8a83;font-size:12px;",
        divider: "color:#1f2d27;font-size:12px;",
        stop: "color:#ff5c5c;font-size:22px;font-weight:800;text-shadow:0 0 10px rgba(255,92,92,.4);",
        warn: "color:#ffb3b3;font-size:13px;",
        link: "color:#34e89e;font-size:12px;font-weight:700;"
    };

    function print() {
        console.log("%c" + ascii, style.green);
        console.log("%c GYM PROGRESS OS ", style.pill);
        console.log("%c🏋️  Твій силовий прогрес під контролем — тренування, PR, рейтинги команди.", style.tag);
        console.log("%cv" + version + "   ·   NestJS + Prisma + PostgreSQL   ·   Vanilla JS SPA", style.muted);
        console.log("%c──────────────────────────────────────────────", style.divider);
        console.log("%c⛔ Стоп!", style.stop);
        console.log("%cЦе консоль для розробників. Не вставляй сюди код, який тобі хтось надіслав — це може дати доступ до твого акаунта GymOS (self-XSS).", style.warn);
        console.log("%c💚 Любиш залізо і код? → " + repoUrl + "   ·   повтор: gymosBanner()", style.link);
    }

    window.gymosBanner = print;

    if (!window.__gymosBannerShown) {
        window.__gymosBannerShown = true;
        print();
    }
})();


