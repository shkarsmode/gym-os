(() => {
    "use strict";

    const sectionItems = [
        ["dashboard", "Панель", "layout-dashboard"],
        ["workout", "Поточне тренування", "dumbbell"],
        ["calendar", "Календар", "calendar-days"],
        ["exercises", "Вправи", "list-filter"],
        ["knowledge", "База знань", "book-open"],
        ["stats", "Статистика", "bar-chart-3"],
        ["rankings", "Рейтинги", "trophy"],
        ["achievements", "Досягнення", "badge-check"],
        ["users", "Команда", "users"],
        ["profile", "Профіль", "user-round"],
        ["settings", "Налаштування", "settings"]
    ].map(([id, title, icon]) => ({ id, title, icon }));

    const mobileSectionIds = ["dashboard", "workout", "calendar", "stats", "profile"];
    const rankedExerciseNames = ["Жим лежачи", "Присідання зі штангою", "Румунська тяга", "Підтягування", "Жим над головою", "Тяга штанги в нахилі"];
    const rankOrder = ["beginner", "novice", "third_class", "second_class", "first_class", "candidate_master", "master"];
    const statusLabels = { planned: "Заплановано", active: "Активне", completed: "Завершено" };
    const setTypeLabels = { warmup: "Розминка", working: "Робочий", drop: "Дроп", failure: "Відмова", backoff: "Відкат" };
    const workoutTypeLabels = { push: "Push", pull: "Pull", legs: "Legs", upper: "Upper", lower: "Lower", full_body: "Full Body", cardio: "Cardio", custom: "Custom" };
    const genderLabels = { male: "чоловіча", female: "жіноча" };
    const dataModeLabels = { local: "локальний", api: "backend" };

    const templates = [
        ["push", "Push", "Груди, плечі та трицепс.", ["Жим лежачи", "Жим гантелей під кутом", "Жим над головою", "Підйом гантелей в сторони", "Розгинання на блоці"]],
        ["pull", "Pull", "Спина та біцепс із чистою тяговою механікою.", ["Підтягування", "Тяга штанги в нахилі", "Тяга верхнього блока", "Розведення на задню дельту", "Молоткові згинання"]],
        ["legs", "Legs", "Присідання, hinge і нижня частина тіла.", ["Присідання зі штангою", "Румунська тяга", "Жим ногами", "Згинання ніг", "Підйом на литки"]],
        ["upper", "Upper", "Збалансована силова робота для верху.", ["Жим лежачи", "Підтягування", "Жим над головою", "Горизонтальна тяга блока", "Згинання зі штангою"]],
        ["lower", "Lower", "Контрольований обсяг для низу тіла.", ["Присідання зі штангою", "Жим ногами", "Румунська тяга", "Розгинання ніг", "Підйом на литки"]],
        ["full_body", "Full Body", "Компактна силова сесія на все тіло.", ["Жим лежачи", "Підтягування", "Присідання зі штангою", "Планка"]],
        ["cardio", "Cardio", "Тренування з фокусом на кондицію.", ["Бігова доріжка", "Велотренажер"]],
        ["custom", "Custom", "Порожній шаблон для власного плану.", []]
    ].map(([id, title, description, exerciseNames]) => ({ id, title, description, exerciseNames, type: id }));

    const achievements = [
        ["first-workout", "Перше тренування", "Завершити перше тренування.", "01", "Ритм", 1, "completedWorkouts"],
        ["three-workouts", "3 завершені тренування", "Побудувати перший стабільний ритм.", "03", "Ритм", 3, "completedWorkouts"],
        ["ten-workouts", "10 завершених тренувань", "Закріпити помітну тренувальну звичку.", "10", "Ритм", 10, "completedWorkouts"],
        ["first-pr", "Перший особистий рекорд", "Зафіксувати будь-який PR.", "PR", "Сила", 1, "personalRecords"],
        ["bench-pr", "PR у жимі лежачи", "Поставити рекорд у жимі лежачи.", "BP", "Сила", 1, "benchRecords"],
        ["squat-pr", "PR у присіданні", "Поставити рекорд у присіданні.", "SQ", "Сила", 1, "squatRecords"],
        ["pullup-progress", "Прогрес у підтягуваннях", "Залогувати підтягування три рази.", "PU", "Сила", 3, "pullupSessions"],
        ["volume-10k", "10 000 кг обсягу", "Зібрати перший великий блок роботи.", "10K", "Обсяг", 10000, "totalVolume"],
        ["volume-50k", "50 000 кг обсягу", "Показати накопичений силовий обсяг.", "50K", "Обсяг", 50000, "totalVolume"],
        ["first-cardio", "Перше кардіо", "Додати перший кардіо-блок.", "C1", "Кардіо", 1, "cardioSessions"],
        ["cardio-100", "100 хвилин кардіо", "Побудувати базу кондиції.", "C100", "Кардіо", 100, "cardioMinutes"],
        ["full-week", "Повний тренувальний тиждень", "Завершити три тренування за один тиждень.", "WK", "Ритм", 1, "fullTrainingWeeks"],
        ["ppl", "Push Pull Legs", "Закрити push, pull і legs у завершених сесіях.", "PPL", "Техніка", 3, "pushPullLegs"],
        ["warmup", "Дисципліна розминки", "Виконати 10 розминкових підходів.", "WU", "Техніка", 10, "warmupSets"],
        ["notes", "Якісні нотатки", "Додати корисні нотатки до тренувань.", "NT", "Техніка", 5, "notesCount"],
        ["profile", "Заповнений профіль", "Заповнити ключові поля профілю.", "ID", "Профіль", 1, "profileCompleteness"]
    ].map(([id, title, description, icon, category, target, metric]) => ({ id, title, description, icon, category, target, metric }));
    const state = {
        section: "dashboard",
        knowledgeExerciseId: "exercise-bench-press",
        profileUserId: null,
        authUser: null,
        database: null,
        charts: new Map(),
        calendar: null,
        filters: {
            exerciseSearch: "",
            statsScope: "current",
            statsRange: "90",
            statsMuscle: "all",
            statsExerciseId: "all",
            statsWorkoutType: "all",
            achievementCategory: "all"
        },
        timer: {
            id: null,
            duration: 90,
            remaining: 90,
            startedAt: 0,
            running: false
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

            const response = await fetch(`${this.baseUrl}${path}`, {
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                    ...(options.headers || {})
                },
                ...options
            });

            if (!response.ok) {
                throw new Error(`API request failed: ${response.status}`);
            }

            if (response.status === 204) {
                return null;
            }

            return response.json();
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

        importExercises(payload) {
            return this.request("/import/exercises", { method: "POST", body: JSON.stringify(payload) });
        }

        createWorkout(payload) {
            return this.request("/workouts", { method: "POST", body: JSON.stringify(payload) });
        }

        updateWorkout(id, payload) {
            return this.request(`/workouts/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
        }

        deleteWorkout(id) {
            return this.request(`/workouts/${id}`, { method: "DELETE" });
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
                    await this.apiProvider.save(database);
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

        async importExerciseCatalog(payload) {
            if (this.mode === "api") {
                return this.apiClient.importExercises(payload);
            }
            return null;
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

    async function initialize() {
        await storage.initialize();
        bindEvents();
        state.authUser = storage.currentUser;
        if (storage.requiresAuthentication()) {
            state.database = createEmptyDatabase();
            renderAuthGate();
            return;
        }
        try {
            state.database = await storage.load() || createSeedDatabase();
        } catch (error) {
            console.error(error);
            state.database = createEmptyDatabase();
            renderAuthGate("Бекенд відповів помилкою під час завантаження даних.");
            return;
        }
        if (!state.database.version || state.database.version < 3) {
            state.database = createSeedDatabase();
        }
        state.profileUserId = state.database.currentUserId;
        await persist();
        renderShell();
        renderSection();
    }

    function createEmptyDatabase() {
        return { version: 3, currentUserId: "", users: [], exercises: [], bodyweightEntries: [], workouts: [], strengthStandards: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    }

    function createSeedDatabase() {
        const now = new Date();
        const users = createUsers();
        const exercises = mergeImportedExerciseCatalog(createExercises(), window.GYMOS_EXRX_CATALOG || null).exercises;
        return {
            version: 3,
            currentUserId: "user-daniil",
            users,
            exercises,
            bodyweightEntries: createBodyweights(users, now),
            workouts: createWorkouts(exercises, now),
            strengthStandards: createStandards(exercises),
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
            ["incline-dumbbell-press", "Жим гантелей під кутом", "Incline Dumbbell Press,Incline DB Press", "Груди", "Плечі,Трицепс", "Горизонтальний жим", "Гантелі", "Гіпертрофія", "Середній"],
            ["chest-press-machine", "Жим у тренажері", "Chest Press Machine,Machine Press", "Груди", "Трицепс", "Горизонтальний жим", "Тренажер", "Гіпертрофія", "Початковий"],
            ["cable-fly", "Зведення в кросовері", "Cable Fly,Cable Crossover", "Груди", "Плечі", "Ізоляція", "Блок", "Ізоляція", "Початковий"],
            ["pull-ups", "Підтягування", "Pull-ups,Pullup,Chin over bar", "Спина", "Біцепс,Передпліччя", "Вертикальна тяга", "Вага тіла", "Сила", "Середній"],
            ["lat-pulldown", "Тяга верхнього блока", "Lat Pulldown,Pulldown", "Спина", "Біцепс", "Вертикальна тяга", "Блок", "Гіпертрофія", "Початковий"],
            ["barbell-row", "Тяга штанги в нахилі", "Barbell Row,Bent-over Row", "Спина", "Біцепс,Передпліччя", "Горизонтальна тяга", "Штанга", "Сила", "Середній"],
            ["seated-cable-row", "Горизонтальна тяга блока", "Seated Cable Row,Cable Row", "Спина", "Біцепс", "Горизонтальна тяга", "Блок", "Гіпертрофія", "Початковий"],
            ["shoulder-press", "Жим над головою", "Shoulder Press,Overhead Press,OHP", "Плечі", "Трицепс", "Вертикальний жим", "Штанга", "Сила", "Середній"],
            ["lateral-raise", "Підйом гантелей в сторони", "Lateral Raise,Side Raise", "Плечі", "", "Підйом", "Гантелі", "Ізоляція", "Початковий"],
            ["rear-delt-fly", "Розведення на задню дельту", "Rear Delt Fly,Reverse Fly", "Плечі", "Спина", "Підйом", "Гантелі", "Ізоляція", "Початковий"],
            ["barbell-squat", "Присідання зі штангою", "Barbell Squat,Back Squat", "Квадрицепс", "Сідниці,Задня поверхня стегна,Прес", "Присідання", "Штанга", "Сила", "Просунутий"],
            ["leg-press", "Жим ногами", "Leg Press,Machine Leg Press", "Квадрицепс", "Сідниці,Задня поверхня стегна", "Присідання", "Тренажер", "Гіпертрофія", "Початковий"],
            ["leg-extension", "Розгинання ніг", "Leg Extension,Quad Extension", "Квадрицепс", "", "Розгинання", "Тренажер", "Ізоляція", "Початковий"],
            ["romanian-deadlift", "Румунська тяга", "Romanian Deadlift,RDL", "Задня поверхня стегна", "Сідниці,Спина", "Hinge", "Штанга", "Сила", "Середній"],
            ["leg-curl", "Згинання ніг", "Leg Curl,Hamstring Curl", "Задня поверхня стегна", "", "Згинання", "Тренажер", "Ізоляція", "Початковий"],
            ["calf-raise", "Підйом на литки", "Calf Raise,Standing Calf Raise", "Литки", "", "Підйом", "Тренажер", "Ізоляція", "Початковий"],
            ["barbell-curl", "Згинання зі штангою", "Barbell Curl,EZ Curl", "Біцепс", "Передпліччя", "Згинання", "Штанга", "Ізоляція", "Початковий"],
            ["dumbbell-curl", "Згинання з гантелями", "Dumbbell Curl,DB Curl", "Біцепс", "Передпліччя", "Згинання", "Гантелі", "Ізоляція", "Початковий"],
            ["hammer-curl", "Молоткові згинання", "Hammer Curl,Neutral Curl", "Біцепс", "Передпліччя", "Згинання", "Гантелі", "Ізоляція", "Початковий"],
            ["triceps-pushdown", "Розгинання на блоці", "Triceps Pushdown,Cable Pushdown", "Трицепс", "", "Розгинання", "Блок", "Ізоляція", "Початковий"],
            ["overhead-triceps-extension", "Розгинання трицепса над головою", "Overhead Triceps Extension,Overhead Cable Extension", "Трицепс", "", "Розгинання", "Блок", "Ізоляція", "Початковий"],
            ["plank", "Планка", "Plank,Front Plank", "Прес", "Все тіло", "Кор", "Вага тіла", "Кор", "Початковий"],
            ["hanging-leg-raise", "Підйом ніг у висі", "Hanging Leg Raise,Leg Raise", "Прес", "Передпліччя", "Кор", "Вага тіла", "Кор", "Середній"],
            ["treadmill", "Бігова доріжка", "Treadmill,Incline Walk", "Все тіло", "Литки", "Кардіо", "Тренажер", "Кардіо", "Початковий"],
            ["bike", "Велотренажер", "Bike,Stationary Bike", "Квадрицепс", "Сідниці,Литки", "Кардіо", "Тренажер", "Кардіо", "Початковий"],
            ["running", "Біг", "Running,Run", "Все тіло", "Литки,Квадрицепс", "Кардіо", "Вага тіла", "Кардіо", "Середній"],
            ["walking", "Ходьба", "Walking,Walk", "Все тіло", "Литки", "Кардіо", "Вага тіла", "Кардіо", "Початковий"],
            ["rowing-machine", "Гребний тренажер", "Rowing Machine,Rower", "Все тіло", "Спина,Квадрицепс,Біцепс", "Кардіо", "Тренажер", "Кардіо", "Середній"]
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
            ["user-daniil", 38, "Push сила", "push", ["Жим лежачи", "Жим гантелей під кутом", "Підйом гантелей в сторони", "Розгинання на блоці"]],
            ["user-daniil", 35, "Pull обсяг", "pull", ["Підтягування", "Тяга штанги в нахилі", "Тяга верхнього блока", "Молоткові згинання"]],
            ["user-daniil", 32, "Legs відновлення", "legs", ["Присідання зі штангою", "Румунська тяга", "Жим ногами", "Підйом на литки"]],
            ["user-daniil", 28, "Upper контроль", "upper", ["Жим лежачи", "Горизонтальна тяга блока", "Жим над головою", "Згинання зі штангою"]],
            ["user-daniil", 20, "Push гіпертрофія", "push", ["Жим гантелей під кутом", "Жим у тренажері", "Зведення в кросовері", "Розгинання на блоці"]],
            ["user-daniil", 16, "Legs обсяг", "legs", ["Присідання зі штангою", "Розгинання ніг", "Згинання ніг", "Підйом на литки"]],
            ["user-daniil", 7, "Push прогресія", "push", ["Жим лежачи", "Жим гантелей під кутом", "Жим над головою", "Розгинання трицепса над головою"]],
            ["user-daniil", 3, "Pull точність", "pull", ["Підтягування", "Тяга штанги в нахилі", "Горизонтальна тяга блока", "Молоткові згинання"]],
            ["user-anastasia", 31, "Lower контроль", "lower", ["Жим ногами", "Румунська тяга", "Згинання ніг", "Підйом на литки"]],
            ["user-anastasia", 24, "Кардіо і кор", "cardio", ["Бігова доріжка", "Велотренажер", "Планка"]],
            ["user-anastasia", 9, "Upper чисті повторення", "upper", ["Тяга верхнього блока", "Горизонтальна тяга блока", "Підйом гантелей в сторони", "Розгинання на блоці"]],
            ["user-maxim", 36, "Важкий push", "push", ["Жим лежачи", "Жим над головою", "Розгинання на блоці"]],
            ["user-maxim", 19, "Legs сила", "legs", ["Присідання зі штангою", "Румунська тяга", "Жим ногами"]],
            ["user-maxim", 5, "Upper щільність", "upper", ["Жим лежачи", "Тяга штанги в нахилі", "Жим над головою", "Молоткові згинання"]]
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
                exercises: exerciseNames.map((name, index) => createWorkoutExercise(byName.get(name), workoutIndex, index)),
                cardioSessions: workoutType === "cardio" || workoutIndex % 4 === 0 ? [createCardio(workoutIndex)] : [],
                createdAt: start.toISOString(),
                updatedAt: start.toISOString()
            };
            return workout;
        });

        workouts.push(createTemplateWorkout("user-daniil", templateById("legs"), "planned", dateInput(addDays(now, 2)), exercises));
        const activeWorkout = createTemplateWorkout("user-daniil", templateById("push"), "active", dateInput(now), exercises);
        activeWorkout.startedAt = addMinutes(now, -34).toISOString();
        activeWorkout.notes = "Активне demo-тренування. Можна завершити або додати роботу.";
        workouts.push(activeWorkout);
        return workouts;
    }

    function createWorkoutExercise(exercise, workoutIndex, index) {
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
                return { id: createId("workout-exercise"), exerciseId: exercise.id, order: index + 1, notes: "Підказка із шаблону.", sets: suggestedSets(exercise) };
            }),
            cardioSessions: template.type === "cardio" ? [createCardio(0)] : [],
            createdAt: now.toISOString(),
            updatedAt: now.toISOString()
        };
    }

    function createStandards(exercises) {
        const byName = new Map(exercises.map((exercise) => [exercise.name, exercise]));
        const ranges = [[50, 60], [60, 70], [70, 80], [80, 90], [90, 105], [105, 140]];
        const levelMultipliers = { beginner: 0.45, novice: 0.7, third_class: 0.95, second_class: 1.15, first_class: 1.35, candidate_master: 1.55, master: 1.8 };
        const exerciseMultipliers = { "Жим лежачи": 1, "Присідання зі штангою": 1.28, "Румунська тяга": 1.2, "Підтягування": 1.05, "Жим над головою": 0.68, "Тяга штанги в нахилі": 0.95 };
        const standards = [];

        rankedExerciseNames.forEach((name) => {
            ranges.forEach(([min, max]) => {
                rankOrder.forEach((level) => {
                    ["male", "female"].forEach((gender) => {
                        const middle = (min + max) / 2;
                        standards.push({
                            id: createId("standard"),
                            exerciseId: byName.get(name).id,
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
        renderNavigation("sidebarNavigation", sectionItems);
        renderNavigation("mobileNavigation", sectionItems.filter((item) => mobileSectionIds.includes(item.id)));
        renderCurrentUserButton();
        renderSidebarProfile();
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
                <div class="action-row" style="justify-content:center;margin-top:16px;">
                    <button class="button button-primary large-workout-button" type="button" data-action="login-google"><i data-lucide="log-in"></i>Увійти через Google</button>
                    <button class="button button-secondary large-workout-button" type="button" data-action="check-backend"><i data-lucide="plug-zap"></i>Перевірити backend</button>
                </div>
                <p class="profile-meta" style="margin-top:14px;">Backend: ${escapeHtml(storage.apiBaseUrl || "не налаштовано")} · статус: ${backendStatusLabel(storage.backendStatus)}</p>
            </section>
        `;
        icons();
    }

    function renderNavigation(containerId, items) {
        const activeWorkout = activeWorkoutFor(currentUser().id);
        const container = element(containerId);
        container.innerHTML = items.map((item) => `
            <button class="nav-button ${state.section === item.id ? "active" : ""}" type="button" data-action="navigate" data-section="${item.id}">
                <span><i data-lucide="${item.icon}"></i>${escapeHtml(item.title)}</span>
                ${item.id === "workout" && activeWorkout ? `<strong class="nav-badge">Активне</strong>` : ""}
            </button>
        `).join("");
        icons();
    }

    function renderCurrentUserButton() {
        const user = currentUser();
        const button = element("openUserSwitcherButton");
        button.textContent = user.avatarInitials;
        button.style.background = user.avatarColor;
    }

    function renderSidebarProfile() {
        const user = currentUser();
        const stats = userStats(user.id);
        element("sidebarProfileCard").innerHTML = `
            <div class="profile-row">
                ${avatar(user, "small")}
                <div>
                    <div class="profile-name">${escapeHtml(user.displayName)}</div>
                    <div class="profile-meta">${stats.completedWorkouts} тренувань · ${number(stats.totalVolume)} кг</div>
                </div>
            </div>
            <div class="progress-track" style="margin-top: 14px;"><div class="progress-fill" style="width: ${Math.min(100, stats.completedWorkouts * 5)}%;"></div></div>
            <div class="profile-meta" style="margin-top: 8px;">Поточний рівень: ${escapeHtml(mainRank(user.id))}</div>
        `;
    }

    function renderSection() {
        destroyCharts();
        renderShell();
        const item = sectionItems.find((section) => section.id === state.section) || sectionItems[0];
        element("sectionEyebrow").textContent = "Gym Progress OS";
        element("sectionTitle").textContent = item.title;
        const renderers = { dashboard, workout, calendar, exercises, knowledge, stats, rankings, achievementsPage, users, profile, settings };
        renderers[state.section]();
        icons();
    }

    function dashboard() {
        const user = currentUser();
        const stats = userStats(user.id);
        const team = teamStats();
        const record = recordsFor(user.id)[0];
        content(`
            <div class="grid dashboard-grid">
                ${metric("Сьогодні", todayLabel(user.id), "calendar-check", todayCaption(user.id), "span-3")}
                ${metric("Поточне тренування", activeWorkoutFor(user.id)?.title || "Немає активного", "activity", activeWorkoutFor(user.id) ? "Таймер тренування працює" : "Можна почати з шаблону", "span-3")}
                ${metric("Обсяг за тиждень", `${number(stats.weekVolume)} кг`, "boxes", `${stats.weekSets} підходів цього тижня`, "span-3")}
                ${metric("Кардіо за тиждень", `${stats.weekCardioMinutes} хв`, "heart-pulse", "Кондиція врахована", "span-3")}
                <section class="card span-12">
                    <div class="card-header">
                        <div>
                            <h2>Швидкий старт</h2>
                            <p class="card-caption">Основні дії для демо: почати, запланувати або перейти до календаря.</p>
                        </div>
                    </div>
                    <div class="action-row">
                        <button class="button button-primary large-workout-button" type="button" data-action="start-empty-workout"><i data-lucide="play"></i>Почати тренування</button>
                        <button class="button button-secondary large-workout-button" type="button" data-action="open-planning-modal"><i data-lucide="calendar-plus"></i>Запланувати тренування</button>
                        <button class="button button-secondary large-workout-button" type="button" data-action="navigate" data-section="calendar"><i data-lucide="calendar-days"></i>Перейти до календаря</button>
                    </div>
                </section>
                ${chartCard("Обсяг за тиждень", "Завершений робочий обсяг за днями.", "weeklyVolumeChart", "span-8")}
                ${chartCard("Розподіл м'язів", "Підходи у завершених тренуваннях.", "muscleChart", "span-4")}
                <section class="card span-4"><h2>Операційна панель</h2>${kpi([{ label: "Завершено", value: stats.completedWorkouts }, { label: "Усього кг", value: number(stats.totalVolume) }, { label: "Серія", value: stats.trainingStreak }, { label: "Підходи", value: stats.totalSets }])}<div class="insight-grid" style="margin-top: 14px;">${insights(user.id).slice(0, 3).map(insightCard).join("")}</div></section>
                <section class="card span-4"><h2>Останній PR</h2>${record ? recordCard(record) : emptyInline("Поки немає особистих рекордів", "Заверши тренування з робочими підходами, щоб GymOS визначив PR.")}</section>
                <section class="card span-4"><h2>Статистика команди</h2>${kpi([{ label: "Тренування", value: team.completedWorkouts }, { label: "Командні кг", value: number(team.totalVolume) }, { label: "Кардіо хв", value: team.cardioMinutes }, { label: "Найактивніший", value: team.mostActiveUser.displayName }])}</section>
                ${chartCard("Історія ваги тіла", "Щотижневі заміри.", "bodyweightChart", "span-6")}
                ${chartCard("Кардіо хвилини", "Останні блоки кондиції.", "cardioChart", "span-6")}
                <section class="card span-12"><div class="card-header"><div><h2>Історія тренувань</h2><p class="card-caption">Спільна стрічка команди. Чужі тренування відкриваються лише для перегляду.</p></div><button class="button button-secondary compact" type="button" data-action="navigate" data-section="rankings">Відкрити рейтинги</button></div><div class="activity-feed">${activityFeed()}</div></section>
            </div>
        `);
        requestAnimationFrame(() => {
            weeklyVolumeChart("weeklyVolumeChart", user.id);
            muscleDistributionChart("muscleChart", user.id);
            bodyweightChart("bodyweightChart", user.id);
            cardioChart("cardioChart", user.id);
        });
    }

    function workout() {
        const activeWorkout = activeWorkoutFor(currentUser().id);
        content(`
            <div class="workout-layout">
                <div class="workout-stack">${activeWorkout ? workoutEditor(activeWorkout) : workoutStarter()}</div>
                <aside class="workout-stack">
                    ${timerCard()}
                    <section class="card"><h2>Аналітика тренування</h2><div class="insight-grid">${insights(currentUser().id).map(insightCard).join("")}</div></section>
                    <section class="card"><h2>Швидкі шаблони</h2><div class="template-grid">${templates.map(templateCard).join("")}</div></section>
                </aside>
            </div>
        `);
    }

    function workoutStarter() {
        return `<section class="empty-state"><i data-lucide="dumbbell"></i><h2>Немає активного тренування</h2><p>Почни з чистої сесії, шаблону або заплануй роботу в календарі. Кнопки збільшені для використання в залі.</p><div class="action-row" style="justify-content:center;margin-top:16px;"><button class="button button-primary large-workout-button" type="button" data-action="start-empty-workout"><i data-lucide="play"></i>Почати тренування</button><button class="button button-secondary large-workout-button" type="button" data-action="open-template-modal"><i data-lucide="layers"></i>Обрати шаблон</button><button class="button button-secondary large-workout-button" type="button" data-action="open-planning-modal"><i data-lucide="calendar-plus"></i>Запланувати</button></div></section>`;
    }

    function workoutEditor(workoutItem) {
        const owner = userById(workoutItem.userId);
        const readonly = workoutItem.userId !== state.database.currentUserId;
        const completedSets = workoutItem.exercises.flatMap((item) => item.sets).filter((set) => set.isCompleted).length;
        return `
            <section class="card">
                <div class="card-header">
                    <div><div class="tag-row" style="margin-bottom:10px;"><span class="status-badge ${workoutItem.status}">${statusLabel(workoutItem.status)}</span>${readonly ? `<span class="status-badge readonly">Лише перегляд</span>` : ""}<span class="chip">${escapeHtml(owner.displayName)}</span></div><h2>${escapeHtml(workoutItem.title)}</h2><p class="card-caption">${formatDate(workoutItem.date)} · ${duration(workoutItem)} хв · ${number(workoutVolume(workoutItem))} кг · ${completedSets} завершених підходів</p></div>
                    <div class="inline-actions"><button class="button button-secondary compact" type="button" data-action="open-add-exercise-modal" ${readonly ? "disabled" : ""}><i data-lucide="plus"></i>Додати вправу</button><button class="button button-primary compact" type="button" data-action="finish-workout" ${readonly ? "disabled" : ""}><i data-lucide="flag"></i>Завершити тренування</button></div>
                </div>
                ${readonly ? `<div class="readonly-layer">Це тренування можна переглядати, але редагувати може лише власник.</div>` : ""}
                <div class="field" style="margin-top:14px;"><label>Нотатки тренування</label><textarea data-action="update-workout-notes" ${readonly ? "disabled" : ""}>${escapeHtml(workoutItem.notes || "")}</textarea></div>
            </section>
            ${workoutItem.exercises.length ? workoutItem.exercises.sort((left, right) => left.order - right.order).map((item) => workoutExerciseEditor(workoutItem, item, readonly)).join("") : emptyInline("Вправ ще немає", "Додай вправу, щоб зібрати сесію.")}
            <section class="card"><div class="card-header"><div><h2>Кардіо в тренуванні</h2><p class="card-caption">Фіксуй кондицію без виходу з поточної сесії.</p></div><button class="button button-secondary compact" type="button" data-action="add-cardio" ${readonly ? "disabled" : ""}>Додати кардіо</button></div>${workoutItem.cardioSessions.length ? workoutItem.cardioSessions.map((session) => `<div class="activity-item"><div class="activity-dot"></div><div><strong>${cardioTypeLabel(session.type)}</strong><p class="card-caption">${session.durationMinutes} хв · ${session.distance} км · ${session.calories} ккал · ${intensityLabel(session.intensity)}</p></div></div>`).join("") : `<p class="card-caption">У цьому тренуванні ще немає кардіо-блоків.</p>`}</section>
        `;
    }

    function workoutExerciseEditor(workoutItem, workoutExercise, readonly) {
        const exercise = exerciseById(workoutExercise.exerciseId);
        const previous = previousPerformance(workoutItem.userId, workoutExercise.exerciseId, workoutItem.id);
        return `<article class="workout-exercise"><div class="exercise-header"><div><div class="exercise-title-line"><h3>${escapeHtml(exercise.name)}</h3><span class="chip">${exercise.primaryMuscleGroup}</span><span class="chip">${exercise.movementPattern}</span></div><p class="card-caption">${number(exerciseVolume(workoutExercise))} кг обсягу · розрах. 1ПМ ${number(exerciseOneRepMax(workoutExercise))} кг${previous ? ` · попередньо ${number(previous.weight)} кг × ${previous.repetitions}` : ""}</p></div><div class="inline-actions"><button class="icon-button" type="button" title="Техніка" data-action="open-exercise" data-exercise-id="${exercise.id}"><i data-lucide="book-open"></i></button><button class="icon-button" type="button" title="Додати підхід" data-action="add-set" data-workout-exercise-id="${workoutExercise.id}" ${readonly ? "disabled" : ""}><i data-lucide="plus"></i></button><button class="icon-button" type="button" title="Повторити підхід" data-action="duplicate-set" data-workout-exercise-id="${workoutExercise.id}" ${readonly ? "disabled" : ""}><i data-lucide="copy"></i></button></div></div><div class="set-grid-header"><span>Тип</span><span>Вага</span><span>Повт.</span><span>RPE</span><span>Відпоч.</span><span>Готово</span><span></span></div>${workoutExercise.sets.map((set) => setRow(workoutExercise.id, set, readonly)).join("")}<div class="field" style="margin-top:12px;"><label>Нотатки до вправи</label><textarea data-action="update-exercise-notes" data-workout-exercise-id="${workoutExercise.id}" ${readonly ? "disabled" : ""}>${escapeHtml(workoutExercise.notes || "")}</textarea></div></article>`;
    }

    function setRow(workoutExerciseId, set, readonly) {
        return `<div class="set-row ${set.isCompleted ? "completed" : ""}"><select data-action="set-field" data-workout-exercise-id="${workoutExerciseId}" data-set-id="${set.id}" data-field="type" ${readonly ? "disabled" : ""}>${["warmup", "working", "drop", "failure", "backoff"].map((type) => `<option value="${type}" ${set.type === type ? "selected" : ""}>${setTypeLabel(type)}</option>`).join("")}</select><input type="number" step="0.5" value="${set.weight}" data-action="set-field" data-workout-exercise-id="${workoutExerciseId}" data-set-id="${set.id}" data-field="weight" ${readonly ? "disabled" : ""}><input type="number" step="1" value="${set.repetitions}" data-action="set-field" data-workout-exercise-id="${workoutExerciseId}" data-set-id="${set.id}" data-field="repetitions" ${readonly ? "disabled" : ""}><input type="number" step="0.5" value="${set.rpe}" data-action="set-field" data-workout-exercise-id="${workoutExerciseId}" data-set-id="${set.id}" data-field="rpe" ${readonly ? "disabled" : ""}><input type="number" step="15" value="${set.restSeconds}" data-action="set-field" data-workout-exercise-id="${workoutExerciseId}" data-set-id="${set.id}" data-field="restSeconds" ${readonly ? "disabled" : ""}><button class="icon-button" type="button" data-action="toggle-set" data-workout-exercise-id="${workoutExerciseId}" data-set-id="${set.id}" ${readonly ? "disabled" : ""}><i data-lucide="${set.isCompleted ? "check-circle-2" : "circle"}"></i></button><button class="icon-button" type="button" data-action="delete-set" data-workout-exercise-id="${workoutExerciseId}" data-set-id="${set.id}" ${readonly ? "disabled" : ""}><i data-lucide="trash-2"></i></button></div>`;
    }

    function calendar() {
        const overview = calendarOverview();
        const history = state.database.workouts.sort(byDateDesc).slice(0, 8);
        content(`<div class="grid dashboard-grid">${metric("Тренувань цього тижня", overview.weekWorkouts, "calendar-check", "Усі статуси", "span-3")}${metric("Завершено", overview.weekCompleted, "check-circle-2", "За поточний тиждень", "span-3")}${metric("Заплановано", overview.weekPlanned, "calendar-plus", "Майбутні сесії", "span-3")}${metric("Серія", `${overview.streak} дн.`, "flame", "Будь-яке завершене тренування", "span-3")}<section class="calendar-shell span-8"><div class="card-header" style="margin-bottom:16px;"><div><h2>Календар тренувань</h2><p class="card-caption">Клік по дню відкриває планування. Клік по тренуванню відкриває деталі.</p></div><button class="button button-secondary compact" type="button" data-action="open-planning-modal"><i data-lucide="calendar-plus"></i>Запланувати тренування</button></div><div id="calendarContainer"></div></section><section class="card span-4"><h2>Огляд</h2>${kpi([{ label: "Тиждень", value: overview.weekWorkouts }, { label: "Місяць", value: overview.monthWorkouts }, { label: "Кардіо дні", value: overview.cardioDays }, { label: "Заплановано", value: overview.monthPlanned }])}<div class="legend-list"><span><i class="legend-dot planned"></i>Заплановано</span><span><i class="legend-dot active"></i>Активне</span><span><i class="legend-dot completed"></i>Завершено</span></div></section><section class="card span-12"><div class="card-header"><div><h2>Історія з календаря</h2><p class="card-caption">Видно тренування всіх користувачів. Редагування доступне лише власнику.</p></div></div><div class="activity-feed">${workoutHistoryList(history)}</div></section></div>`);
        requestAnimationFrame(renderCalendar);
    }

    function exercises() {
        const items = filteredExercises();
        content(`<section class="card"><div class="card-header"><div><h2>Каталог вправ</h2><p class="card-caption">Пошук працює за назвою, alias, м'язовою групою, патерном руху та обладнанням.</p></div><button class="button button-primary compact" type="button" data-action="open-custom-exercise"><i data-lucide="plus"></i>Власна вправа</button></div><div class="filter-row"><input type="search" placeholder="Пошук за назвою, alias, м'язом, патерном або обладнанням" value="${escapeHtml(state.filters.exerciseSearch)}" data-action="exercise-search"></div></section><section class="exercise-card-grid" style="margin-top:16px;">${items.length ? items.map(exerciseCard).join("") : emptyInline("Нічого не знайдено", "Спробуй іншу назву, м'язову групу або обладнання.")}</section>`);
    }

    function knowledge() {
        const selected = exerciseById(state.knowledgeExerciseId) || state.database.exercises[0];
        const currentBest = bestResult(currentUser().id, selected.id);
        const teamBest = teamBestResult(selected.id);
        content(`<div class="grid dashboard-grid"><section class="card span-4"><h2>База знань</h2><input type="search" placeholder="Пошук техніки" value="${escapeHtml(state.filters.exerciseSearch)}" data-action="exercise-search"><div class="workout-stack" style="margin-top:14px;">${filteredExercises().slice(0, 14).map((exercise) => `<button class="nav-button ${exercise.id === selected.id ? "active" : ""}" type="button" data-action="select-knowledge" data-exercise-id="${exercise.id}"><span><i data-lucide="circle-dot"></i>${escapeHtml(exercise.name)}</span><strong class="nav-badge">${escapeHtml(exercise.primaryMuscleGroup)}</strong></button>`).join("")}</div></section><section class="card span-8"><div class="card-header"><div><div class="tag-row" style="margin-bottom:10px;"><span class="badge accent">${escapeHtml(selected.primaryMuscleGroup)}</span><span class="chip">${escapeHtml(selected.movementPattern)}</span><span class="chip">${escapeHtml(selected.equipment)}</span><span class="chip">${escapeHtml(selected.difficulty)}</span></div><h2>${escapeHtml(selected.name)}</h2><p class="card-caption">${escapeHtml(selected.description)}</p></div><button class="button button-primary compact" type="button" data-action="add-exercise" data-exercise-id="${selected.id}">Додати до тренування</button></div>${media(selected)}${exerciseSourceBlock(selected)}</section><section class="card span-4"><h2>Кроки техніки</h2>${ordered(selected.techniqueSteps)}</section><section class="card span-4"><h2>Типові помилки</h2>${bullets(selected.commonMistakes)}</section><section class="card span-4"><h2>Безпека</h2>${bullets(selected.safetyTips)}</section><section class="card span-4"><h2>Використання</h2>${kpi([{ label: "Востаннє", value: lastUsed(selected.id) ? shortDate(lastUsed(selected.id)) : "Ще не було" }, { label: "Користувачі", value: usersForExercise(selected.id).length }, { label: "Твій максимум", value: currentBest ? `${number(currentBest.estimatedOneRepMax)} кг` : "—" }, { label: "Командний максимум", value: teamBest ? `${number(teamBest.estimatedOneRepMax)} кг` : "—" }])}</section><section class="card span-8"><h2>Схожі вправи</h2><div class="exercise-card-grid">${relatedExercises(selected.id).slice(0, 4).map(exerciseCard).join("") || emptyInline("Схожих вправ немає", "Каталог можна розширити у налаштуваннях.")}</div></section></div>`);
    }

    function stats() {
        const userId = state.filters.statsScope === "current" ? currentUser().id : null;
        const summary = userId ? userStats(userId, true) : teamStats(true);
        const history = filteredWorkouts(userId ? workoutsFor(userId) : state.database.workouts).sort(byDateDesc).slice(0, 8);
        content(`<section class="card"><div class="card-header"><div><h2>Статистика</h2><p class="card-caption">Фільтри за користувачем, періодом, м'язовою групою, вправою і типом тренування.</p></div></div><div class="filter-row"><select data-action="stats-filter" data-filter="statsScope"><option value="current" ${state.filters.statsScope === "current" ? "selected" : ""}>Поточний користувач</option><option value="team" ${state.filters.statsScope === "team" ? "selected" : ""}>Усі користувачі</option></select><select data-action="stats-filter" data-filter="statsRange"><option value="30" ${state.filters.statsRange === "30" ? "selected" : ""}>Останні 30 днів</option><option value="90" ${state.filters.statsRange === "90" ? "selected" : ""}>Останні 90 днів</option><option value="365" ${state.filters.statsRange === "365" ? "selected" : ""}>Останній рік</option><option value="all" ${state.filters.statsRange === "all" ? "selected" : ""}>Увесь час</option></select><select data-action="stats-filter" data-filter="statsMuscle"><option value="all">Усі м'язові групи</option>${unique(state.database.exercises.map((exercise) => exercise.primaryMuscleGroup)).map((muscle) => `<option value="${muscle}" ${state.filters.statsMuscle === muscle ? "selected" : ""}>${muscle}</option>`).join("")}</select><select data-action="stats-filter" data-filter="statsExerciseId"><option value="all">Усі вправи</option>${state.database.exercises.map((exercise) => `<option value="${exercise.id}" ${state.filters.statsExerciseId === exercise.id ? "selected" : ""}>${escapeHtml(exercise.name)}</option>`).join("")}</select><select data-action="stats-filter" data-filter="statsWorkoutType"><option value="all">Усі типи</option>${Object.entries(workoutTypeLabels).map(([value, label]) => `<option value="${value}" ${state.filters.statsWorkoutType === value ? "selected" : ""}>${label}</option>`).join("")}</select></div></section><div class="grid dashboard-grid" style="margin-top:16px;">${metric("Усього тренувань", summary.totalWorkouts, "calendar", "Усі статуси", "span-3")}${metric("Завершено", summary.completedWorkouts, "check-circle-2", "Фінішовані сесії", "span-3")}${metric("Підходи", summary.totalSets, "list-checks", `${summary.workingSets || 0} робочих`, "span-3")}${metric("Загальний обсяг", `${number(summary.totalVolume)} кг`, "boxes", "Завершені підходи", "span-3")}${metric("Середня тривалість", `${summary.averageDurationMinutes || 0} хв`, "timer", "Завершені тренування", "span-3")}${metric("Кардіо хвилини", summary.cardioMinutes || 0, "heart-pulse", `${summary.cardioDistance || 0} км`, "span-3")}${metric("Найчастіша вправа", summary.mostUsedExercise?.name || "—", "repeat", "Частота вправ", "span-3")}${metric("Найсильніший фокус", summary.mostTrainedMuscleGroup || "—", "target", "За завершеними підходами", "span-3")}${chartCard("Обсяг у часі", "Завершений обсяг за сесіями.", "statsVolume", "span-6")}${chartCard("Підходи за м'язами", "Розподіл завершених підходів.", "statsMuscle", "span-6")}${chartCard("Прогрес вправи", "Тренд розрахункового 1ПМ.", "statsProgress", "span-6")}${chartCard("Регулярність", "Кількість вправ у сесії.", "statsConsistency", "span-6")}<section class="card span-12"><div class="card-header"><div><h2>Історія за фільтрами</h2><p class="card-caption">Список оновлюється разом із графіками.</p></div></div><div class="activity-feed">${workoutHistoryList(history)}</div></section></div>`);
        requestAnimationFrame(() => {
            volumeChart("statsVolume", userId);
            muscleDistributionChart("statsMuscle", userId);
            progressChart("statsProgress", userId || currentUser().id);
            consistencyChart("statsConsistency", userId);
        });
    }

    function rankings() {
        const user = currentUser();
        content(`<section class="card"><div class="card-header"><div><h2>Силові рейтинги</h2><p class="card-caption">Демо-нормативи використовуються лише для прикладу. Їх можна оновити під реальні стандарти пізніше.</p></div><span class="badge accent">${user.bodyweight} кг · ${genderLabel(user.gender)}</span></div></section><section class="ranking-grid" style="margin-top:16px;">${rankedExerciseNames.map((name) => rankCard(user, exerciseByName(name))).join("")}</section><section class="card" style="margin-top:16px;"><div class="card-header"><div><h2>Командний рейтинг</h2><p class="card-caption">Рейтинг за регулярністю, обсягом і найкращим підйомом.</p></div></div><div class="table-wrap"><table><thead><tr><th>Користувач</th><th>Завершено</th><th>Загальний обсяг</th><th>Найкращий підйом</th><th>Основний рівень</th><th>Бал</th></tr></thead><tbody>${leaderboard().map((row, index) => `<tr><td><div class="list-row">${avatar(row.user, "small")}<strong>${index + 1}. ${escapeHtml(row.user.displayName)}</strong></div></td><td>${row.completedWorkouts}</td><td>${number(row.totalVolume)} кг</td><td>${row.bestLift ? `${escapeHtml(row.bestLift.exercise.name)} · ${number(row.bestLift.estimatedOneRepMax)} кг` : "Поки немає результату"}</td><td>${escapeHtml(row.mainRank)}</td><td>${number(row.score)}</td></tr>`).join("")}</tbody></table></div></section>`);
    }

    function achievementsPage() {
        const items = achievementsFor(currentUser().id);
        const categories = ["all", ...unique(achievements.map((achievement) => achievement.category))];
        const filtered = state.filters.achievementCategory === "all" ? items : items.filter((item) => item.category === state.filters.achievementCategory);
        content(`<section class="card"><div class="card-header"><div><h2>Досягнення</h2><p class="card-caption">Стримані бейджі зі станами відкрито/закрито, прогресом і датою відкриття.</p></div><span class="badge accent">${items.filter((item) => item.isUnlocked).length}/${items.length} відкрито</span></div><div class="tab-row">${categories.map((category) => `<button class="segment-button ${state.filters.achievementCategory === category ? "active" : ""}" type="button" data-action="achievement-filter" data-category="${category}">${category === "all" ? "Усі" : category}</button>`).join("")}</div></section><section class="achievement-grid" style="margin-top:16px;">${filtered.map(achievementCard).join("")}</section>`);
    }

    function users() {
        const team = teamStats();
        content(`<div class="grid dashboard-grid">${metric("Командний обсяг", `${number(team.totalVolume)} кг`, "boxes", "Спільний результат", "span-3")}${metric("Тренування команди", team.completedWorkouts, "calendar-check", "Завершено", "span-3")}${metric("Найактивніший", team.mostActiveUser.displayName, "flame", "За завершеними тренуваннями", "span-3")}${metric("Кардіо", `${team.cardioMinutes} хв`, "heart-pulse", "Командна кондиція", "span-3")}</div><section class="user-grid" style="margin-top:16px;">${state.database.users.map(userCard).join("")}</section>`);
    }

    function profile() {
        const user = userById(state.profileUserId || state.database.currentUserId);
        const summary = userStats(user.id);
        const isCurrent = user.id === currentUser().id;
        const recent = workoutsFor(user.id).filter((workoutItem) => workoutItem.status === "completed").sort(byDateDesc).slice(0, 5);
        content(`<div class="grid dashboard-grid"><section class="card span-12"><div class="profile-header"><div class="list-row">${avatar(user, "large")}<div><div class="tag-row" style="margin-bottom:10px;"><span class="badge accent">${escapeHtml(user.trainingGoal)}</span><span class="status-badge ${isCurrent ? "completed" : "readonly"}">${isCurrent ? "Можна редагувати" : "Лише перегляд"}</span></div><h2>${escapeHtml(user.displayName)}</h2><p class="card-caption">${escapeHtml(user.name)} · ${user.height} см · ${user.bodyweight} кг · ${escapeHtml(user.trainingExperience)} · фокус: ${escapeHtml(user.favoriteMuscleGroup)}</p></div></div><button class="button button-primary" type="button" data-action="open-profile-editor" ${isCurrent ? "" : "disabled"}><i data-lucide="pen-line"></i>Редагувати профіль</button></div></section>${metric("Тренування", summary.completedWorkouts, "calendar-check", "Завершено", "span-3")}${metric("Загальний обсяг", `${number(summary.totalVolume)} кг`, "boxes", "Усі завершені підходи", "span-3")}${metric("Підходи", summary.totalSets, "list-checks", `${summary.workingSets} робочих`, "span-3")}${metric("Кардіо", `${summary.cardioMinutes} хв`, "heart-pulse", `${summary.cardioDistance} км`, "span-3")}${chartCard("Історія ваги тіла", "Щотижневі заміри.", "profileBodyweight", "span-6")}${chartCard("Тренд розрахункового 1ПМ", "Демо-тренд жиму лежачи.", "profileMax", "span-6")}<section class="card span-6"><h2>Особисті рекорди</h2><div class="workout-stack">${recordsFor(user.id).slice(0, 6).map(recordCard).join("") || emptyInline("PR ще немає", "Заверши робочі підходи, щоб GymOS визначив рекорди.")}</div></section><section class="card span-6"><h2>Бейджі</h2><div class="achievement-grid">${achievementsFor(user.id).filter((item) => item.isUnlocked).slice(0, 4).map(achievementCard).join("") || emptyInline("Бейджів ще немає", "Завершуй тренування, щоб відкривати досягнення.")}</div></section><section class="card span-12"><h2>Останні тренування</h2><div class="activity-feed">${workoutHistoryList(recent)}</div></section></div>`);
        requestAnimationFrame(() => {
            bodyweightChart("profileBodyweight", user.id);
            maxTrendChart("profileMax", user.id);
        });
    }

    function settings() {
        const modeOptions = storage.config.requireAuth ? `<option value="api" selected>Бекенд API</option>` : `<option value="local" ${storage.mode === "local" ? "selected" : ""}>Локальний</option><option value="api" ${storage.mode === "api" ? "selected" : ""}>Бекенд API</option>`;
        const modeCaption = storage.config.requireAuth ? "Застосунок працює тільки через backend API. Зміни даних доступні після Google OAuth." : "Застосунок працює локально через IndexedDB/localStorage або через бекенд API.";
        content(`<div class="grid dashboard-grid"><section class="card span-6"><h2>Активний користувач</h2><p class="card-caption">Права редагування залежать від авторизованого Google акаунта.</p><div class="user-grid" style="margin-top:14px;">${state.database.users.map(userSwitcherCard).join("")}</div></section><section class="card span-6"><h2>Авторизація</h2><p class="card-caption">Продакшн-режим передбачає тільки Google OAuth.</p><div class="action-row"><button class="button button-primary" type="button" data-action="login-google"><i data-lucide="log-in"></i>Увійти через Google</button><button class="button button-secondary" type="button" data-action="logout"><i data-lucide="log-out"></i>Вийти</button></div></section><section class="card span-6"><h2>Режим даних</h2><p class="card-caption">${modeCaption}</p><div class="field-grid"><div class="field"><label>Режим даних</label><select data-action="data-mode">${modeOptions}</select></div><div class="field"><label>Базовий URL API</label><input type="url" value="${escapeHtml(storage.apiBaseUrl)}" placeholder="https://gym-os-back.vercel.app" data-action="api-base-url"></div></div><div class="action-row" style="margin-top:14px;"><button class="button button-secondary" type="button" data-action="check-backend"><i data-lucide="plug-zap"></i>Перевірити підключення</button><span class="status-badge ${storage.backendStatus === "online" ? "completed" : storage.backendStatus === "offline" ? "planned" : "readonly"}">Бекенд: ${backendStatusLabel(storage.backendStatus)}</span></div></section><section class="card span-6"><h2>Стан сховища</h2>${kpi([{ label: "Режим", value: dataModeLabel(storage.mode) }, { label: "Провайдер", value: storage.provider?.name || "backend API" }, { label: "Вправи", value: state.database.exercises.length }, { label: "Тренування", value: state.database.workouts.length }])}<div class="action-row" style="margin-top:14px;"><button class="button button-secondary" type="button" data-action="notifications"><i data-lucide="bell"></i>Тест таймера</button><button class="button button-danger" type="button" data-action="reset"><i data-lucide="rotate-ccw"></i>Скинути локальний кеш</button></div></section><section class="card span-6"><h2>Імпорт / експорт</h2><p class="card-caption">JSON-дамп GymOS і окремий імпорт каталогу вправ.</p><div class="action-row"><button class="button button-primary" type="button" data-action="export-data"><i data-lucide="download"></i>Експорт JSON</button><label class="button button-secondary" for="importInput"><i data-lucide="upload"></i>Імпорт JSON</label><input class="hidden" id="importInput" type="file" accept="application/json" data-action="import-data"><label class="button button-secondary" for="exerciseCatalogInput"><i data-lucide="file-up"></i>Імпортувати каталог вправ з JSON</label><input class="hidden" id="exerciseCatalogInput" type="file" accept="application/json" data-action="import-exercise-catalog"></div></section><section class="card span-6"><h2>Довідники</h2><p class="card-caption">Власні вправи зберігаються з власником, нормативи лишаються налаштовуваними даними.</p><div class="action-row"><button class="button button-primary" type="button" data-action="open-custom-exercise">Додати власну вправу</button><button class="button button-secondary" type="button" data-action="open-standards">Відкрити нормативи</button></div></section></div>`);
    }

    function bindEvents() {
        document.addEventListener("click", handleClick);
        document.addEventListener("change", handleChange);
        document.addEventListener("input", handleInput);
        element("modalBackdrop").addEventListener("click", closeOverlay);
        element("openQuickActionButton").addEventListener("click", openQuickAction);
        element("openUserSwitcherButton").addEventListener("click", openUserSwitcher);
    }

    async function handleClick(event) {
        const actionElement = event.target.closest("[data-action]");
        if (!actionElement) {
            return;
        }

        const action = actionElement.dataset.action;
        const actions = {
            navigate: () => navigate(actionElement.dataset.section),
            "open-template-modal": openTemplateModal,
            "open-planning-modal": () => openPlanningModal(actionElement.dataset.date || dateInput(new Date()), actionElement.dataset.workoutId || null),
            "create-planned-workout": () => savePlanningWorkout("planned"),
            "create-and-start-planned-workout": () => savePlanningWorkout("active"),
            "save-planned-workout": () => savePlanningWorkout("planned", actionElement.dataset.workoutId),
            "start-planned-workout": () => startPlannedWorkout(actionElement.dataset.workoutId),
            "delete-workout": () => deleteWorkout(actionElement.dataset.workoutId),
            "start-template": () => startFromTemplate(actionElement.dataset.templateId, "active"),
            "plan-template": () => startFromTemplate(actionElement.dataset.templateId, "planned"),
            "start-empty-workout": () => startFromTemplate("custom", "active"),
            "open-add-exercise-modal": openAddExerciseModal,
            "add-exercise": () => addExercise(actionElement.dataset.exerciseId),
            "open-custom-exercise": openCustomExercise,
            "save-custom-exercise": saveCustomExercise,
            "open-exercise": () => openExercise(actionElement.dataset.exerciseId),
            "select-knowledge": () => selectKnowledge(actionElement.dataset.exerciseId),
            "add-set": () => addSet(actionElement.dataset.workoutExerciseId),
            "duplicate-set": () => duplicateSet(actionElement.dataset.workoutExerciseId),
            "toggle-set": () => toggleSet(actionElement.dataset.workoutExerciseId, actionElement.dataset.setId),
            "delete-set": () => deleteSet(actionElement.dataset.workoutExerciseId, actionElement.dataset.setId),
            "finish-workout": finishWorkout,
            "add-cardio": addCardioToWorkout,
            "switch-user": () => switchUser(actionElement.dataset.userId),
            "view-user": () => viewUser(actionElement.dataset.userId),
            "open-profile-editor": openProfileEditor,
            "save-profile": saveProfile,
            "save-bodyweight": saveBodyweight,
            "achievement-filter": () => filterAchievements(actionElement.dataset.category),
            "open-workout": () => openWorkout(actionElement.dataset.workoutId),
            notifications: requestNotifications,
            "check-backend": checkBackendConnection,
            "login-google": loginWithGoogle,
            logout: logout,
            "export-data": exportData,
            reset: resetData,
            "open-standards": openStandards,
            "close-overlay": closeOverlay
        };

        if (actions[action]) {
            await actions[action]();
        }
    }

    async function handleChange(event) {
        const actionElement = event.target.closest("[data-action]");
        if (!actionElement) {
            return;
        }

        if (actionElement.dataset.action === "set-field") {
            await updateSetField(actionElement.dataset.workoutExerciseId, actionElement.dataset.setId, actionElement.dataset.field, actionElement.value);
        }

        if (actionElement.dataset.action === "stats-filter") {
            state.filters[actionElement.dataset.filter] = actionElement.value;
            renderSection();
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
    }

    function handleInput(event) {
        const actionElement = event.target.closest("[data-action]");
        if (!actionElement) {
            return;
        }

        if (actionElement.dataset.action === "exercise-search") {
            state.filters.exerciseSearch = actionElement.value;
            clearTimeout(handleInput.timeoutId);
            handleInput.timeoutId = setTimeout(renderSection, 140);
        }

        if (actionElement.dataset.action === "exercise-picker-search") {
            state.filters.exerciseSearch = actionElement.value;
            const pickerGrid = element("exercisePickerGrid");
            if (pickerGrid) {
                pickerGrid.innerHTML = exercisePickerCards();
            }
        }

        if (actionElement.dataset.action === "update-workout-notes") {
            const active = activeWorkoutFor(currentUser().id);
            if (active) {
                active.notes = actionElement.value;
                schedulePersist();
            }
        }

        if (actionElement.dataset.action === "update-exercise-notes") {
            const active = activeWorkoutFor(currentUser().id);
            const workoutExercise = active?.exercises.find((item) => item.id === actionElement.dataset.workoutExerciseId);
            if (workoutExercise) {
                workoutExercise.notes = actionElement.value;
                schedulePersist();
            }
        }

        if (actionElement.dataset.action === "api-base-url") {
            clearTimeout(handleInput.apiUrlTimeoutId);
            handleInput.apiUrlTimeoutId = setTimeout(() => updateApiBaseUrl(actionElement.value), 450);
        }
    }

    function navigate(section) {
        state.section = section;
        closeOverlay();
        renderSection();
    }

    function openQuickAction() {
        openModal(`<div class="modal-header"><div><h2>Швидка дія</h2><p class="card-caption">Почати, запланувати або перейти в потрібний розділ.</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><div class="template-grid"><button class="template-card" type="button" data-action="start-empty-workout"><h3>Почати порожнє тренування</h3><p class="card-caption">Чиста сесія без заздалегідь заданих вправ.</p></button><button class="template-card" type="button" data-action="open-planning-modal"><h3>Запланувати тренування</h3><p class="card-caption">Дата, тип, шаблон і нотатки.</p></button><button class="template-card" type="button" data-action="open-template-modal"><h3>Обрати шаблон</h3><p class="card-caption">Push, Pull, Legs, Full Body і не тільки.</p></button><button class="template-card" type="button" data-action="navigate" data-section="rankings"><h3>Відкрити рейтинги</h3><p class="card-caption">Перевірити поточний силовий рівень.</p></button><button class="template-card" type="button" data-action="navigate" data-section="knowledge"><h3>База техніки</h3><p class="card-caption">Форма, помилки і безпечне виконання.</p></button></div>`);
    }

    function openUserSwitcher() {
        openModal(`<div class="modal-header"><div><h2>Змінити активного користувача</h2><p class="card-caption">Права в деморежимі імітуються через активного користувача.</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><div class="user-grid">${state.database.users.map(userSwitcherCard).join("")}</div>`);
    }

    function openTemplateModal() {
        openModal(`<div class="modal-header"><div><h2>Шаблони тренувань</h2><p class="card-caption">Створи заплановане або активне тренування. Усе можна редагувати після створення.</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><div class="template-grid">${templates.map(templateCard).join("")}</div>`);
    }

    function openPlanningModal(date = dateInput(new Date()), workoutId = null) {
        const workoutItem = workoutId ? state.database.workouts.find((item) => item.id === workoutId) : null;
        const readonly = workoutItem && workoutItem.userId !== currentUser().id;
        const selectedTemplateId = workoutItem ? templateByType(workoutItem.workoutType).id : "custom";
        const selectedType = workoutItem?.workoutType || templateById(selectedTemplateId).type;
        const title = workoutItem?.title || "";
        const notes = workoutItem?.notes || "";
        const targetDate = workoutItem?.date || date;

        openModal(`<div class="modal-header"><div><h2>${workoutItem ? "Деталі плану" : "Запланувати тренування"}</h2><p class="card-caption">${readonly ? "Чуже тренування доступне лише для перегляду." : "Обери дату, тип і шаблон. Можна одразу почати сесію."}</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div>${readonly ? `<div class="readonly-layer">Лише перегляд: редагувати може тільки власник тренування.</div>` : ""}<div class="field-grid"><div class="field"><label>Дата</label><input id="planDate" type="date" value="${escapeHtml(targetDate)}" ${readonly ? "disabled" : ""}></div><div class="field"><label>Назва тренування</label><input id="planTitle" type="text" value="${escapeHtml(title)}" placeholder="Наприклад: Push сила" ${readonly ? "disabled" : ""}></div><div class="field"><label>Тип тренування</label><select id="planType" ${readonly ? "disabled" : ""}>${Object.entries(workoutTypeLabels).map(([value, label]) => `<option value="${value}" ${selectedType === value ? "selected" : ""}>${label}</option>`).join("")}</select></div><div class="field"><label>Шаблон</label><select id="planTemplate" ${readonly ? "disabled" : ""}>${templates.map((template) => `<option value="${template.id}" ${selectedTemplateId === template.id ? "selected" : ""}>${escapeHtml(template.title)}</option>`).join("")}</select></div></div><div class="field" style="margin-top:14px;"><label>Нотатки</label><textarea id="planNotes" placeholder="Що важливо пам'ятати перед сесією" ${readonly ? "disabled" : ""}>${escapeHtml(notes)}</textarea></div><div class="form-actions" style="justify-content:flex-end;margin-top:16px;"><button class="button button-secondary" type="button" data-action="close-overlay">Скасувати</button>${workoutItem && !readonly ? `<button class="button button-danger" type="button" data-action="delete-workout" data-workout-id="${workoutItem.id}">Видалити</button><button class="button button-secondary" type="button" data-action="start-planned-workout" data-workout-id="${workoutItem.id}">Почати</button><button class="button button-primary" type="button" data-action="save-planned-workout" data-workout-id="${workoutItem.id}">Зберегти</button>` : ""}${!workoutItem ? `<button class="button button-secondary" type="button" data-action="create-planned-workout">Запланувати</button><button class="button button-primary" type="button" data-action="create-and-start-planned-workout">Запланувати і почати</button>` : ""}</div>`);
    }

    function openAddExerciseModal() {
        openModal(`<div class="modal-header"><div><h2>Додати вправу</h2><p class="card-caption">Пошук за назвою, alias, м'язом, патерном або обладнанням.</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><input type="search" placeholder="Пошук вправи" value="${escapeHtml(state.filters.exerciseSearch)}" data-action="exercise-picker-search"><div class="exercise-picker-grid" id="exercisePickerGrid" style="margin-top:14px;">${exercisePickerCards()}</div>`);
    }

    function exercisePickerCards() {
        const items = filteredExercises();
        if (!items.length) {
            return emptyInline("Нічого не знайдено", "Спробуй назву, alias, м'язову групу, патерн руху або обладнання.");
        }
        return items.map((exercise) => `<article class="exercise-card"><h3>${escapeHtml(exercise.name)}</h3><p class="card-caption">${escapeHtml(exercise.primaryMuscleGroup)} · ${escapeHtml(exercise.movementPattern)} · ${escapeHtml(exercise.equipment)}</p><button class="button button-primary compact" type="button" data-action="add-exercise" data-exercise-id="${exercise.id}">Додати</button></article>`).join("");
    }

    function openCustomExercise() {
        openModal(`<div class="modal-header"><div><h2>Власна вправа</h2><p class="card-caption">Створи вправу для локального каталогу або майбутнього backend.</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><div class="field-grid"><div class="field"><label>Назва</label><input id="customExerciseName" type="text" placeholder="Жим у Smith під кутом"></div><div class="field"><label>Aliases</label><input id="customExerciseAliases" type="text" placeholder="Через кому"></div><div class="field"><label>Основний м'яз</label>${select("customExerciseMuscle", muscles(), "Груди")}</div><div class="field"><label>Патерн руху</label>${select("customExercisePattern", patterns(), "Горизонтальний жим")}</div><div class="field"><label>Обладнання</label>${select("customExerciseEquipment", equipment(), "Тренажер")}</div><div class="field"><label>Складність</label>${select("customExerciseDifficulty", ["Початковий", "Середній", "Просунутий"], "Середній")}</div></div><div class="field" style="margin-top:14px;"><label>Опис</label><textarea id="customExerciseDescription" placeholder="Коротке пояснення"></textarea></div><div class="form-actions" style="justify-content:flex-end;margin-top:16px;"><button class="button button-secondary" type="button" data-action="close-overlay">Скасувати</button><button class="button button-primary" type="button" data-action="save-custom-exercise">Зберегти вправу</button></div>`);
    }

    async function saveCustomExercise() {
        const name = inputValue("customExerciseName").trim();
        if (!name) {
            toast("Потрібна назва", "Додай зрозумілу назву вправи.");
            return;
        }
        const muscle = inputValue("customExerciseMuscle");
        const pattern = inputValue("customExercisePattern");
        const newExercise = {
            id: createId("exercise"),
            name,
            aliases: splitCsv(inputValue("customExerciseAliases")),
            primaryMuscleGroup: muscle,
            secondaryMuscleGroups: [],
            movementPattern: pattern,
            equipment: inputValue("customExerciseEquipment"),
            category: "Власна",
            difficulty: inputValue("customExerciseDifficulty"),
            description: inputValue("customExerciseDescription") || `${name} — власна вправа з фокусом на ${muscle.toLowerCase()}.`,
            techniqueSteps: techniqueFor(pattern),
            commonMistakes: mistakesFor(pattern),
            safetyTips: safetyFor(pattern),
            mediaUrl: "",
            mediaType: "none",
            isCustom: true,
            createdByUserId: currentUser().id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        state.database.exercises.push(newExercise);
        await persist();
        closeOverlay();
        renderSection();
        toast("Власну вправу створено", name);
    }

    function openProfileEditor() {
        const user = currentUser();
        openModal(`<div class="modal-header"><div><h2>Редагувати профіль</h2><p class="card-caption">Редагувати можна тільки профіль активного користувача.</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><div class="field-grid"><div class="field"><label>Ім'я</label><input id="profileName" type="text" value="${escapeHtml(user.name)}"></div><div class="field"><label>Публічне ім'я</label><input id="profileDisplayName" type="text" value="${escapeHtml(user.displayName)}"></div><div class="field"><label>Зріст</label><input id="profileHeight" type="number" value="${user.height}"></div><div class="field"><label>Вага тіла</label><input id="profileBodyweight" type="number" step="0.1" value="${user.bodyweight}"></div><div class="field"><label>Тренувальна ціль</label><input id="profileGoal" type="text" value="${escapeHtml(user.trainingGoal)}"></div><div class="field"><label>Досвід</label><input id="profileExperience" type="text" value="${escapeHtml(user.trainingExperience)}"></div><div class="field"><label>Улюблена група</label>${select("profileMuscle", muscles(), user.favoriteMuscleGroup)}</div><div class="field"><label>Категорія</label><select id="profileGender"><option value="male" ${user.gender === "male" ? "selected" : ""}>чоловіча</option><option value="female" ${user.gender === "female" ? "selected" : ""}>жіноча</option></select></div></div><div class="field-grid" style="margin-top:14px;"><div class="field"><label>Дата заміру</label><input id="bodyweightDate" type="date" value="${dateInput(new Date())}"></div><div class="field"><label>Додати запис ваги</label><input id="bodyweightValue" type="number" step="0.1" value="${user.bodyweight}"></div></div><div class="form-actions" style="justify-content:flex-end;margin-top:16px;"><button class="button button-secondary" type="button" data-action="close-overlay">Скасувати</button><button class="button button-primary" type="button" data-action="save-profile">Зберегти профіль</button></div>`);
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
        await persist();
        closeOverlay();
        renderSection();
        toast("Профіль збережено", user.displayName);
    }

    async function saveBodyweight(shouldRender = true) {
        const value = numberValue("bodyweightValue", 0);
        if (!value) {
            return;
        }
        state.database.bodyweightEntries.push({ id: createId("bodyweight"), userId: currentUser().id, date: inputValue("bodyweightDate") || dateInput(new Date()), bodyweight: value, notes: "Ручний запис" });
        currentUser().bodyweight = value;
        if (shouldRender) {
            await persist();
            closeOverlay();
            renderSection();
        }
    }

    async function savePlanningWorkout(status, workoutId = null) {
        const template = templateById(inputValue("planTemplate") || "custom");
        const date = inputValue("planDate") || dateInput(new Date());
        const title = inputValue("planTitle").trim() || template.title;
        const workoutType = inputValue("planType") || template.type;
        const notes = inputValue("planNotes").trim();

        if (workoutId) {
            const workoutItem = state.database.workouts.find((item) => item.id === workoutId);
            if (!workoutItem || workoutItem.userId !== currentUser().id) {
                toast("Лише перегляд", "Редагувати можна тільки власні тренування.");
                return;
            }
            workoutItem.date = date;
            workoutItem.title = title;
            workoutItem.workoutType = workoutType;
            workoutItem.notes = notes;
            workoutItem.updatedAt = new Date().toISOString();
            await persist();
            closeOverlay();
            renderSection();
            toast("План оновлено", workoutItem.title);
            return;
        }

        const workoutItem = createTemplateWorkout(currentUser().id, template, status, date, state.database.exercises);
        workoutItem.title = title;
        workoutItem.workoutType = workoutType;
        workoutItem.notes = notes || (status === "active" ? "Почато з планування." : "Заплановано вручну.");
        if (status === "active") {
            const canStart = await ensureSingleActiveWorkout();
            if (!canStart) {
                return;
            }
        }
        state.database.workouts.push(workoutItem);
        await persist();
        closeOverlay();
        navigate(status === "active" ? "workout" : "calendar");
        toast(status === "active" ? "Тренування почато" : "Тренування заплановано", workoutItem.title);
    }

    async function startPlannedWorkout(workoutId) {
        const workoutItem = state.database.workouts.find((item) => item.id === workoutId);
        if (!workoutItem || workoutItem.userId !== currentUser().id) {
            toast("Лише перегляд", "Почати можна тільки власне тренування.");
            return;
        }
        const canStart = await ensureSingleActiveWorkout(workoutItem.id);
        if (!canStart) {
            return;
        }
        workoutItem.status = "active";
        workoutItem.startedAt = new Date().toISOString();
        workoutItem.finishedAt = null;
        workoutItem.updatedAt = new Date().toISOString();
        await persist();
        closeOverlay();
        navigate("workout");
        toast("Тренування почато", workoutItem.title);
    }

    async function deleteWorkout(workoutId) {
        const workoutItem = state.database.workouts.find((item) => item.id === workoutId);
        if (!workoutItem || workoutItem.userId !== currentUser().id) {
            toast("Лише перегляд", "Видаляти можна тільки власні тренування.");
            return;
        }
        if (!confirm("Видалити це тренування?")) {
            return;
        }
        state.database.workouts = state.database.workouts.filter((item) => item.id !== workoutId);
        await persist();
        closeOverlay();
        renderSection();
        toast("Тренування видалено", workoutItem.title);
    }

    async function ensureSingleActiveWorkout(excludedWorkoutId = null) {
        const existing = activeWorkoutFor(currentUser().id);
        if (!existing || existing.id === excludedWorkoutId) {
            return true;
        }
        if (!confirm("У тебе вже є активне тренування. Завершити його і почати нове?")) {
            return false;
        }
        existing.status = "completed";
        existing.finishedAt = new Date().toISOString();
        existing.updatedAt = new Date().toISOString();
        return true;
    }

    async function startFromTemplate(templateId, status) {
        const existing = activeWorkoutFor(currentUser().id);
        if (status === "active" && existing) {
            if (!confirm("У тебе вже є активне тренування. Завершити його і почати нове?")) {
                return;
            }
            existing.status = "completed";
            existing.finishedAt = new Date().toISOString();
        }
        const workoutItem = createTemplateWorkout(currentUser().id, templateById(templateId), status, dateInput(new Date()), state.database.exercises);
        state.database.workouts.push(workoutItem);
        await persist();
        closeOverlay();
        navigate(status === "active" ? "workout" : "calendar");
        toast(status === "active" ? "Тренування почато" : "Тренування заплановано", workoutItem.title);
    }

    async function addExercise(exerciseId) {
        const active = activeWorkoutFor(currentUser().id);
        if (!active) {
            toast("Спочатку почни тренування", "Додати вправу можна тільки в активну сесію.");
            return;
        }
        const exercise = exerciseById(exerciseId);
        active.exercises.push({ id: createId("workout-exercise"), exerciseId, order: active.exercises.length + 1, notes: suggestionNote(currentUser().id, exerciseId), sets: suggestedSets(exercise) });
        active.updatedAt = new Date().toISOString();
        await persist();
        closeOverlay();
        navigate("workout");
        toast("Вправу додано", exercise.name);
    }

    async function addSet(workoutExerciseId) {
        const workoutExercise = activeWorkoutExercise(workoutExerciseId);
        if (!workoutExercise) {
            return;
        }
        const previousSet = workoutExercise.sets.at(-1);
        workoutExercise.sets.push(previousSet ? { ...previousSet, id: createId("set"), isCompleted: false } : createSet("working", 0, 8, 8, 90, false));
        await persist();
        renderSection();
    }

    async function duplicateSet(workoutExerciseId) {
        await addSet(workoutExerciseId);
        toast("Підхід повторено", "Попередній підхід скопійовано.");
    }

    async function toggleSet(workoutExerciseId, setId) {
        const set = setByIds(workoutExerciseId, setId);
        if (!set) {
            return;
        }
        set.isCompleted = !set.isCompleted;
        await persist();
        if (set.isCompleted) {
            startTimer(set.restSeconds || 90);
            toast("Підхід завершено", `Таймер відпочинку: ${seconds(set.restSeconds || 90)}`);
        }
        renderSection();
    }

    async function deleteSet(workoutExerciseId, setId) {
        const workoutExercise = activeWorkoutExercise(workoutExerciseId);
        if (!workoutExercise || !confirm("Видалити цей підхід?")) {
            return;
        }
        workoutExercise.sets = workoutExercise.sets.filter((set) => set.id !== setId);
        await persist();
        renderSection();
    }

    async function updateSetField(workoutExerciseId, setId, field, value) {
        const set = setByIds(workoutExerciseId, setId);
        if (!set) {
            return;
        }
        set[field] = ["weight", "repetitions", "rpe", "restSeconds"].includes(field) ? Number(value) || 0 : value;
        await persist();
    }

    async function finishWorkout() {
        const active = activeWorkoutFor(currentUser().id);
        if (!active) {
            return;
        }
        active.status = "completed";
        active.finishedAt = new Date().toISOString();
        active.updatedAt = new Date().toISOString();
        stopTimer();
        await persist();
        renderSection();
        toast("Тренування завершено", "PR, досягнення і статистику перераховано.");
    }

    async function addCardioToWorkout() {
        const active = activeWorkoutFor(currentUser().id);
        if (!active) {
            return;
        }
        active.cardioSessions.push(createCardio(1));
        await persist();
        renderSection();
        toast("Кардіо додано", "Блок кондиції додано до тренування.");
    }

    async function switchUser(userId) {
        state.database.currentUserId = userId;
        state.profileUserId = userId;
        await persist();
        closeOverlay();
        renderSection();
        toast("Активного користувача змінено", userById(userId).displayName);
    }

    function viewUser(userId) {
        state.profileUserId = userId;
        navigate("profile");
    }

    function selectKnowledge(exerciseId) {
        state.knowledgeExerciseId = exerciseId;
        renderSection();
    }

    function filterAchievements(category) {
        state.filters.achievementCategory = category;
        renderSection();
    }

    function openExercise(exerciseId) {
        const exercise = exerciseById(exerciseId);
        const currentBest = bestResult(currentUser().id, exerciseId);
        const teamBest = teamBestResult(exerciseId);
        openDrawer(`<div class="drawer-header"><div><h2>${escapeHtml(exercise.name)}</h2><p class="card-caption">${exercise.primaryMuscleGroup} · ${exercise.movementPattern} · ${exercise.equipment}</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div>${media(exercise)}${exerciseSourceBlock(exercise)}<section class="panel" style="margin-top:14px;"><h3>Техніка</h3>${ordered(exercise.techniqueSteps)}</section><section class="panel" style="margin-top:14px;"><h3>Результати</h3>${kpi([{ label: "Твій максимум", value: currentBest ? `${number(currentBest.estimatedOneRepMax)} кг` : "—" }, { label: "Командний максимум", value: teamBest ? `${number(teamBest.estimatedOneRepMax)} кг` : "—" }])}</section><section class="panel" style="margin-top:14px;"><h3>Схожі вправи</h3><div class="workout-stack">${relatedExercises(exerciseId).slice(0, 3).map((item) => `<button class="nav-button" type="button" data-action="open-exercise" data-exercise-id="${item.id}"><span>${escapeHtml(item.name)}</span><strong class="nav-badge">${escapeHtml(item.primaryMuscleGroup)}</strong></button>`).join("") || emptyInline("Схожих вправ немає", "Розшир каталог у налаштуваннях.")}</div></section>`);
    }

    function openWorkout(workoutId) {
        const workoutItem = state.database.workouts.find((item) => item.id === workoutId);
        const owner = userById(workoutItem.userId);
        const readonly = workoutItem.userId !== currentUser().id;
        const totalSets = workoutSetCount(workoutItem);
        const cardioMinutes = workoutCardioMinutes(workoutItem);
        openDrawer(`<div class="drawer-header"><div><h2>${escapeHtml(workoutItem.title)}</h2><p class="card-caption">${escapeHtml(owner.displayName)} · ${formatDate(workoutItem.date)} · ${statusLabel(workoutItem.status)} · ${workoutTypeLabel(workoutItem.workoutType)}</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div>${readonly ? `<div class="readonly-layer">Лише перегляд: це тренування іншого користувача.</div>` : ""}<section class="panel">${kpi([{ label: "Вправи", value: workoutItem.exercises.length }, { label: "Підходи", value: totalSets }, { label: "Обсяг", value: `${number(workoutVolume(workoutItem))} кг` }, { label: "Кардіо", value: `${cardioMinutes} хв` }, { label: "Тривалість", value: `${duration(workoutItem)} хв` }])}${workoutItem.notes ? `<p class="card-caption" style="margin-top:12px;">${escapeHtml(workoutItem.notes)}</p>` : ""}<div class="action-row" style="margin-top:14px;">${!readonly && workoutItem.status === "planned" ? `<button class="button button-primary compact" type="button" data-action="start-planned-workout" data-workout-id="${workoutItem.id}">Почати</button><button class="button button-secondary compact" type="button" data-action="open-planning-modal" data-date="${workoutItem.date}" data-workout-id="${workoutItem.id}"><i data-lucide="pen-line"></i>Редагувати</button><button class="button button-danger compact" type="button" data-action="delete-workout" data-workout-id="${workoutItem.id}">Видалити</button>` : ""}${!readonly && workoutItem.status === "active" ? `<button class="button button-primary compact" type="button" data-action="navigate" data-section="workout">Перейти до поточного</button><button class="button button-secondary compact" type="button" data-action="finish-workout">Завершити</button>` : ""}</div></section><div class="workout-stack" style="margin-top:14px;">${workoutItem.exercises.length ? workoutItem.exercises.map((workoutExercise) => `<article class="panel"><h3>${escapeHtml(exerciseById(workoutExercise.exerciseId).name)}</h3><p class="card-caption">${workoutExercise.sets.length} підходів · ${number(exerciseVolume(workoutExercise))} кг</p><div class="tag-row">${workoutExercise.sets.map((set) => `<span class="chip">${setTypeLabel(set.type)} · ${set.weight} × ${set.repetitions}${set.isCompleted ? " · готово" : ""}</span>`).join("")}</div></article>`).join("") : emptyInline("Вправ ще немає", "Це порожнє або кардіо-тренування.")}</div>`);
    }

    function openStandards() {
        openModal(`<div class="modal-header"><div><h2>Силові нормативи</h2><p class="card-caption">Демо-нормативи використовуються лише для прикладу. Їх можна оновити під реальні стандарти пізніше.</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><div class="table-wrap"><table><thead><tr><th>Вправа</th><th>Категорія</th><th>Вага тіла</th><th>Рівень</th><th>Вимога</th><th>Джерело</th></tr></thead><tbody>${state.database.strengthStandards.slice(0, 42).map((standard) => `<tr><td>${escapeHtml(exerciseById(standard.exerciseId).name)}</td><td>${genderLabel(standard.gender)}</td><td>${standard.bodyweightMin}-${standard.bodyweightMax}</td><td>${rankLabel(standard.level)}</td><td>${standard.requiredWeight} кг × ${standard.repetitions}</td><td>${escapeHtml(standard.sourceName)}</td></tr>`).join("")}</tbody></table></div>`);
    }

    function requestNotifications() {
        toast("Таймер працює без дозволів", "GymOS покаже visual toast навіть без browser notifications.");
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
            await storage.logout();
            toast("Вихід виконано", "У деморежимі активний користувач лишається локальним.");
        } catch (error) {
            toast("Бекенд недоступний", "Локальний деморежим продовжує працювати.");
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
        try {
            const data = JSON.parse(await file.text());
            ["users", "exercises", "workouts", "bodyweightEntries", "strengthStandards"].forEach((key) => {
                if (!Array.isArray(data[key])) {
                    throw new Error(`Missing ${key}`);
                }
            });
            state.database = data;
            state.profileUserId = data.currentUserId;
            await persist();
            renderSection();
            toast("Дані імпортовано", "Локальну базу оновлено.");
        } catch (error) {
            console.error(error);
            toast("Імпорт не вдався", "JSON-структура не підходить для GymOS.");
        }
    }

    async function importExerciseCatalog(file) {
        if (!file) {
            return;
        }
        try {
            const data = JSON.parse(await file.text());
            if (storage.mode === "api") {
                const result = await storage.importExerciseCatalog(data);
                toast("Каталог імпортовано", `Додано: ${result.imported || 0}, пропущено: ${result.skipped || 0}.`);
                state.database = await storage.load();
            } else {
                const result = mergeImportedExerciseCatalog(state.database.exercises, data);
                state.database.exercises = result.exercises;
                await persist();
                toast("Каталог імпортовано", `Додано: ${result.imported}, пропущено: ${result.skipped}.`);
            }
            renderSection();
        } catch (error) {
            console.error(error);
            toast("Імпорт каталогу не вдався", "Перевір структуру JSON і права доступу.");
        }
    }

    async function resetData() {
        if (!confirm(storage.mode === "api" ? "Очистити локальний кеш і перечитати дані з backend?" : "Скинути всі локальні demo data?")) {
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

    function metric(title, value, icon, caption, span = "span-3") {
        return `<section class="metric-card ${span}"><div class="card-header"><div><div class="metric-title">${escapeHtml(title)}</div><div class="metric-value">${escapeHtml(String(value))}</div><div class="stat-label">${escapeHtml(caption)}</div></div><div class="metric-icon"><i data-lucide="${icon}"></i></div></div></section>`;
    }

    function chartCard(title, caption, canvasId, span) {
        return `<section class="card ${span} chart-card"><div class="card-header"><div><h2>${escapeHtml(title)}</h2><p class="card-caption">${escapeHtml(caption)}</p></div></div><div class="chart-box"><canvas id="${canvasId}"></canvas></div></section>`;
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

    function templateCard(template) {
        return `<article class="template-card"><div class="card-header"><div><h3>${escapeHtml(template.title)}</h3><p class="card-caption">${escapeHtml(template.description)}</p></div><span class="badge accent">${template.exerciseNames.length || "Вільно"}</span></div><div class="tag-row" style="margin:12px 0;">${template.exerciseNames.slice(0, 4).map((name) => `<span class="chip">${escapeHtml(name)}</span>`).join("")}</div><div class="inline-actions"><button class="button button-primary compact" type="button" data-action="start-template" data-template-id="${template.id}">Почати</button><button class="button button-secondary compact" type="button" data-action="plan-template" data-template-id="${template.id}">Запланувати</button></div></article>`;
    }

    function exerciseCard(exercise) {
        return `<article class="exercise-card" data-action="open-exercise" data-exercise-id="${exercise.id}"><div class="card-header"><div><h3>${escapeHtml(exercise.name)}</h3><p class="card-caption">${escapeHtml(exercise.description)}</p></div>${exercise.isCustom ? `<span class="badge accent">Власна</span>` : ""}</div><div class="tag-row"><span class="chip">${escapeHtml(exercise.primaryMuscleGroup)}</span><span class="chip">${escapeHtml(exercise.movementPattern)}</span><span class="chip">${escapeHtml(exercise.equipment)}</span></div></article>`;
    }

    function userCard(user) {
        const summary = userStats(user.id);
        const isCurrent = user.id === currentUser().id;
        return `<article class="user-card" data-action="view-user" data-user-id="${user.id}"><div class="list-row">${avatar(user)}<div><h3>${escapeHtml(user.displayName)}</h3><p class="card-caption">${escapeHtml(user.trainingGoal)}</p></div></div><div style="margin-top:14px;">${kpi([{ label: "Тренування", value: summary.completedWorkouts }, { label: "Обсяг", value: number(summary.totalVolume) }, { label: "Кардіо", value: summary.cardioMinutes }])}</div><div class="tag-row" style="margin-top:12px;"><span class="badge ${isCurrent ? "unlocked" : "locked"}">${isCurrent ? "Поточний" : "Лише перегляд"}</span><span class="chip">${escapeHtml(mainRank(user.id))}</span></div></article>`;
    }

    function userSwitcherCard(user) {
        const isCurrent = user.id === currentUser().id;
        return `<article class="user-card"><div class="list-row">${avatar(user, "small")}<div><h3>${escapeHtml(user.displayName)}</h3><p class="card-caption">${escapeHtml(user.name)}</p></div></div><button class="button ${isCurrent ? "button-secondary" : "button-primary"} compact" type="button" data-action="switch-user" data-user-id="${user.id}" style="margin-top:12px;" ${isCurrent ? "disabled" : ""}>${isCurrent ? "Активний" : "Перемкнути"}</button></article>`;
    }

    function achievementCard(item) {
        const percent = item.target ? Math.min(100, Math.round(item.currentValue / item.target * 100)) : 0;
        return `<article class="achievement-card ${item.isUnlocked ? "" : "locked"}"><div class="achievement-icon">${item.icon}</div><div class="card-header"><h3>${escapeHtml(item.title)}</h3><span class="badge ${item.isUnlocked ? "unlocked" : "locked"}">${item.isUnlocked ? "Відкрито" : "Закрито"}</span></div><p class="card-caption">${escapeHtml(item.description)}</p><div class="progress-track" style="margin:12px 0 8px;"><div class="progress-fill" style="width:${percent}%;"></div></div><p class="profile-meta">${number(Math.min(item.currentValue, item.target))}/${number(item.target)} · ${item.unlockedAt ? `Відкрито ${formatDate(item.unlockedAt)}` : item.category}</p></article>`;
    }

    function rankCard(user, exercise) {
        const rank = rankingFor(user.id, exercise.id);
        const current = rank.currentLevel ? rankLabel(rank.currentLevel.level) : "Поки немає результату";
        const next = rank.nextLevel ? rankLabel(rank.nextLevel.level) : "Верхній demo-рівень";
        return `<article class="ranking-card"><div class="card-header"><div><h3>${escapeHtml(exercise.name)}</h3><p class="card-caption">${exercise.primaryMuscleGroup} · ${exercise.movementPattern}</p></div><span class="badge accent">${current}</span></div>${kpi([{ label: "Найкращий", value: rank.best ? `${number(rank.best.estimatedOneRepMax)} кг` : "—" }, { label: "Наступний рівень", value: rank.nextLevel ? `${number(rank.nextLevel.requiredWeight)} кг` : "—" }])}<div class="progress-track" style="margin-top:12px;"><div class="progress-fill" style="width:${Math.min(100, rank.progress)}%;"></div></div><p class="profile-meta" style="margin-top:8px;">Далі: ${next} · ${Math.round(rank.progress)}% · ${rank.best?.isEstimated ? "розрахункове 1ПМ" : "прямий результат"}</p></article>`;
    }

    function timerCard() {
        const progress = state.timer.running ? Math.max(0, Math.min(100, (1 - state.timer.remaining / state.timer.duration) * 100)) : 0;
        return `<section class="card"><div class="timer-card"><div><h2>Таймер відпочинку</h2><p class="card-caption">Запускається автоматично після завершення підходу.</p></div><div class="timer-ring" style="--timer-progress:${progress}%"><div class="timer-value">${seconds(state.timer.remaining)}</div></div></div></section>`;
    }

    function media(exercise) {
        if (exercise.mediaUrl && exercise.mediaType !== "none") {
            return `<div class="media-placeholder"><img src="${escapeHtml(exercise.mediaUrl)}" alt="Демонстрація вправи ${escapeHtml(exercise.name)}"></div>`;
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
        return state.database.workouts.filter((item) => item.status === "completed").sort(byDateDesc).slice(0, 8).map((workoutItem) => {
            const owner = userById(workoutItem.userId);
            return `<article class="activity-item"><div class="activity-dot"></div><div style="flex:1;"><strong>${escapeHtml(owner.displayName)} завершив ${escapeHtml(workoutItem.title)}</strong><p class="card-caption">${formatDate(workoutItem.date)} · ${number(workoutVolume(workoutItem))} кг · ${workoutItem.exercises.length} вправ</p></div><button class="button button-secondary compact" type="button" data-action="open-workout" data-workout-id="${workoutItem.id}">Відкрити</button></article>`;
        }).join("");
    }

    function workoutHistoryList(workouts) {
        if (!workouts.length) {
            return emptyInline("Історія порожня", "Створи або заверши тренування, щоб воно з'явилося тут.");
        }

        return workouts.map((workoutItem) => {
            const owner = userById(workoutItem.userId);
            const readonly = workoutItem.userId !== currentUser().id;
            return `<article class="history-card" data-action="open-workout" data-workout-id="${workoutItem.id}"><div class="card-header"><div><div class="tag-row" style="margin-bottom:8px;"><span class="status-badge ${workoutItem.status}">${statusLabel(workoutItem.status)}</span><span class="chip">${workoutTypeLabel(workoutItem.workoutType)}</span>${readonly ? `<span class="status-badge readonly">Лише перегляд</span>` : ""}</div><h3>${escapeHtml(workoutItem.title)}</h3><p class="card-caption">${formatDate(workoutItem.date)} · ${escapeHtml(owner.displayName)}</p></div><button class="button button-secondary compact" type="button" data-action="open-workout" data-workout-id="${workoutItem.id}">Деталі</button></div>${kpi([{ label: "Вправи", value: workoutItem.exercises.length }, { label: "Підходи", value: workoutSetCount(workoutItem) }, { label: "Обсяг", value: `${number(workoutVolume(workoutItem))} кг` }, { label: "Кардіо", value: `${workoutCardioMinutes(workoutItem)} хв` }, { label: "Тривалість", value: `${duration(workoutItem)} хв` }])}${workoutItem.notes ? `<p class="card-caption history-notes">${escapeHtml(workoutItem.notes).slice(0, 140)}</p>` : ""}</article>`;
        }).join("");
    }

    function renderCalendar() {
        const container = element("calendarContainer");
        if (!window.FullCalendar) {
            container.innerHTML = emptyInline("Календар недоступний", "Потрібен доступ до FullCalendar CDN або локальний bundle.");
            icons();
            return;
        }
        if (state.calendar) {
            state.calendar.destroy();
        }
        state.calendar = new FullCalendar.Calendar(container, {
            initialView: window.innerWidth < 700 ? "listWeek" : "dayGridMonth",
            height: "auto",
            firstDay: 1,
            headerToolbar: { left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,listWeek" },
            events: state.database.workouts.map((workoutItem) => ({ id: workoutItem.id, title: `${userById(workoutItem.userId).displayName}: ${workoutItem.title}`, start: workoutItem.date, classNames: [`workout-status-${workoutItem.status}`], extendedProps: { workoutId: workoutItem.id } })),
            dateClick: (info) => openPlanningModal(info.dateStr),
            eventClick: (info) => openWorkout(info.event.extendedProps.workoutId)
        });
        state.calendar.render();
    }

    async function planOnDate(date) {
        openPlanningModal(date);
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

    function barChart(id, labels, data, label) {
        createChart(id, { type: "bar", data: { labels, datasets: [{ label, data, backgroundColor: "rgba(211, 183, 121, 0.62)", borderColor: "rgba(240, 216, 154, 0.9)", borderWidth: 1, borderRadius: 10 }] }, options: chartOptions() });
    }

    function lineChart(id, labels, data, label) {
        createChart(id, { type: "line", data: { labels, datasets: [{ label, data, tension: 0.35, fill: true, backgroundColor: "rgba(211, 183, 121, 0.1)", borderColor: "rgba(240, 216, 154, 0.92)", pointBackgroundColor: "rgba(240, 216, 154, 1)" }] }, options: chartOptions() });
    }

    function doughnutChart(id, labels, data) {
        createChart(id, { type: "doughnut", data: { labels, datasets: [{ data, backgroundColor: ["#d3b779", "#9e8653", "#70644c", "#b7a176", "#64583e", "#8f7c52", "#cabd99"] }] }, options: { ...chartOptions(), cutout: "68%", scales: {} } });
    }

    function createChart(id, config) {
        if (!window.Chart || !element(id)) {
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
        const chart = new Chart(element(id), config);
        state.charts.set(id, chart);
    }

    function chartOptions() {
        return { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: "#a9a297", boxWidth: 12, usePointStyle: true } }, tooltip: { backgroundColor: "rgba(16, 18, 22, 0.96)", borderColor: "rgba(255, 255, 255, 0.12)", borderWidth: 1 } }, scales: { x: { ticks: { color: "#8e877c" }, grid: { color: "rgba(255, 255, 255, 0.05)" } }, y: { ticks: { color: "#8e877c" }, grid: { color: "rgba(255, 255, 255, 0.05)" }, beginAtZero: true } } };
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

    function achievementsFor(userId) {
        const summary = userStats(userId);
        const records = recordsFor(userId);
        const completed = workoutsFor(userId).filter((item) => item.status === "completed");
        const bench = exerciseByName("Жим лежачи");
        const squat = exerciseByName("Присідання зі штангою");
        const pullups = exerciseByName("Підтягування");
        const metrics = {
            completedWorkouts: summary.completedWorkouts,
            personalRecords: records.length,
            benchRecords: records.some((record) => record.exerciseId === bench.id) ? 1 : 0,
            squatRecords: records.some((record) => record.exerciseId === squat.id) ? 1 : 0,
            pullupSessions: completed.filter((workoutItem) => workoutItem.exercises.some((item) => item.exerciseId === pullups.id)).length,
            totalVolume: summary.totalVolume,
            cardioSessions: summary.cardioSessions,
            cardioMinutes: summary.cardioMinutes,
            fullTrainingWeeks: fullWeek(completed) ? 1 : 0,
            pushPullLegs: new Set(completed.map((item) => item.workoutType).filter((type) => ["push", "pull", "legs"].includes(type))).size,
            warmupSets: summary.warmupSets,
            notesCount: summary.notesCount,
            profileCompleteness: profileComplete(userById(userId)) ? 1 : 0
        };
        return achievements.map((achievement) => {
            const currentValue = metrics[achievement.metric] || 0;
            return { ...achievement, currentValue, isUnlocked: currentValue >= achievement.target, unlockedAt: currentValue >= achievement.target ? summary.lastWorkoutDate || userById(userId).updatedAt : null };
        });
    }

    function rankingFor(userId, exerciseId) {
        const user = userById(userId);
        const standards = state.database.strengthStandards.filter((standard) => standard.exerciseId === exerciseId && standard.gender === user.gender && user.bodyweight >= standard.bodyweightMin && user.bodyweight < standard.bodyweightMax).sort((left, right) => left.requiredWeight - right.requiredWeight);
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
        const rank = rankingFor(userId, bench.id);
        const chestSets = workoutsFor(userId).filter((item) => item.status === "completed" && new Date(item.date) >= startWeek(new Date())).flatMap((item) => item.exercises).filter((item) => exerciseById(item.exerciseId).primaryMuscleGroup === "Груди").flatMap((item) => item.sets).filter((set) => set.isCompleted).length;
        return [
            { title: `Робота на груди: ${chestSets} підходів`, caption: chestSets ? "Груди вже тренувалися цього тижня." : "Груди ще не тренувалися цього тижня." },
            { title: days === null ? "Жим ще не логували" : `Жим був ${days} дн. тому`, caption: "Корисно для частоти і відновлення." },
            { title: rank.nextLevel ? "Наступний рівень видимий" : "Верхній demo-рівень досягнуто", caption: rank.nextLevel ? `${number(rank.nextLevel.requiredWeight)} кг розрах. 1ПМ для рівня ${rankLabel(rank.nextLevel.level)}.` : "Нормативи можна оновити пізніше." },
            { title: summary.weekVolume ? "Обсяг рухається" : "Почни тиждень", caption: `${number(summary.weekVolume)} кг завершено цього тижня.` },
            { title: summary.warmupSets >= 10 ? "Дисципліна розминки" : "Підказка для розминки", caption: summary.warmupSets >= 10 ? "Звичка розминки вже помітна в логах." : "Додавай розминкові підходи перед основними рухами." }
        ];
    }

    function suggestedSets(exercise) {
        if (exercise.movementPattern === "Кардіо") {
            return [];
        }
        const currentUserId = state.database?.currentUserId;
        const previous = currentUserId ? previousPerformance(currentUserId, exercise.id) : null;
        const weight = previous?.weight || seedWeight(exercise.name, 0);
        if (exercise.movementPattern === "Кор") {
            return [createSet("working", 0, 45, 7, 60, false), createSet("working", 0, 45, 8, 60, false)];
        }
        return [createSet("warmup", round(weight * 0.55, 1), 10, 5, 60, false), createSet("working", round(weight, 1), 8, 8, 105, false), createSet("working", round(weight, 1), 8, 8.5, 120, false)];
    }

    function filteredExercises() {
        const search = state.filters.exerciseSearch.trim().toLowerCase();
        if (!search) {
            return state.database.exercises;
        }
        return state.database.exercises.filter((exercise) => [exercise.name, exercise.aliases.join(" "), exercise.primaryMuscleGroup, exercise.secondaryMuscleGroups.join(" "), exercise.movementPattern, exercise.equipment, exercise.category, exercise.difficulty].join(" ").toLowerCase().includes(search));
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
        return weight ? round(weight * (1 + repetitions / 30), 1) : 0;
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

    function suggestionNote(userId, exerciseId) {
        const previous = previousPerformance(userId, exerciseId);
        return previous ? `Попередній результат: ${previous.weight} кг × ${previous.repetitions} · ${formatDate(previous.date)}.` : "Новий рух у цій програмі.";
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
        const levels = rankedExerciseNames.map((name) => rankingFor(userId, exerciseByName(name).id).currentLevel?.level).filter(Boolean);
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

    function fullWeek(workouts) {
        const map = new Map();
        workouts.forEach((item) => {
            const key = dateInput(startWeek(new Date(item.date)));
            map.set(key, (map.get(key) || 0) + 1);
        });
        return [...map.values()].some((count) => count >= 3);
    }

    function profileComplete(user) {
        return Boolean(user.name && user.displayName && user.height && user.bodyweight && user.trainingGoal && user.trainingExperience && user.favoriteMuscleGroup);
    }

    function startTimer(duration) {
        stopTimer();
        state.timer.duration = duration;
        state.timer.remaining = duration;
        state.timer.startedAt = Date.now();
        state.timer.running = true;
        state.timer.id = setInterval(() => {
            const elapsed = Math.floor((Date.now() - state.timer.startedAt) / 1000);
            state.timer.remaining = Math.max(0, state.timer.duration - elapsed);
            const value = document.querySelector(".timer-value");
            const ring = document.querySelector(".timer-ring");
            if (value && ring) {
                value.textContent = seconds(state.timer.remaining);
                ring.style.setProperty("--timer-progress", `${(1 - state.timer.remaining / state.timer.duration) * 100}%`);
            }
            if (state.timer.remaining <= 0) {
                stopTimer();
                toast("Відпочинок завершено", "Можна переходити до наступного підходу.");
                if ("Notification" in window && Notification.permission === "granted") {
                    new Notification("GymOS", { body: "Відпочинок завершено. Можна переходити до наступного підходу." });
                }
            }
        }, 1000);
    }

    function stopTimer() {
        if (state.timer.id) {
            clearInterval(state.timer.id);
        }
        state.timer.id = null;
        state.timer.running = false;
    }

    function userById(id) {
        return state.database.users.find((user) => user.id === id);
    }

    function currentUser() {
        return userById(state.database.currentUserId);
    }

    function exerciseById(id) {
        return state.database.exercises.find((exercise) => exercise.id === id);
    }

    function exerciseByName(name) {
        return state.database.exercises.find((exercise) => exercise.name === name);
    }

    function workoutsFor(userId) {
        return state.database.workouts.filter((workoutItem) => workoutItem.userId === userId);
    }

    function activeWorkoutFor(userId) {
        return state.database.workouts.find((workoutItem) => workoutItem.userId === userId && workoutItem.status === "active");
    }

    function activeWorkoutExercise(id) {
        return activeWorkoutFor(currentUser().id)?.exercises.find((item) => item.id === id);
    }

    function setByIds(workoutExerciseId, setId) {
        return activeWorkoutExercise(workoutExerciseId)?.sets.find((set) => set.id === setId);
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

    function muscles() {
        return ["Груди", "Спина", "Плечі", "Біцепс", "Трицепс", "Квадрицепс", "Задня поверхня стегна", "Сідниці", "Литки", "Прес", "Передпліччя", "Все тіло"];
    }

    function patterns() {
        return ["Горизонтальний жим", "Вертикальний жим", "Горизонтальна тяга", "Вертикальна тяга", "Присідання", "Hinge", "Випад", "Згинання", "Розгинання", "Підйом", "Перенесення", "Ротація", "Кор", "Кардіо"];
    }

    function equipment() {
        return ["Штанга", "Гантелі", "Тренажер", "Блок", "Вага тіла", "Smith Machine", "Гиря", "Еспандер", "Інше"];
    }

    function avatar(user, size = "") {
        return `<div class="avatar ${size}" style="background:${escapeHtml(user.avatarColor)};">${escapeHtml(user.avatarInitials)}</div>`;
    }

    function ordered(items) {
        return `<ol>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`;
    }

    function bullets(items) {
        return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
    }

    function select(id, options, selected) {
        return `<select id="${id}">${options.map((option) => `<option value="${escapeHtml(option)}" ${option === selected ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>`;
    }

    function splitCsv(value) {
        return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
    }

    function unique(items) {
        return [...new Set(items)].sort();
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
        icons();
    }

    function openDrawer(html) {
        closeOverlay();
        element("modalBackdrop").classList.remove("hidden");
        element("drawerLayer").innerHTML = html;
        element("drawerLayer").classList.remove("hidden");
        icons();
    }

    function closeOverlay() {
        element("modalBackdrop").classList.add("hidden");
        element("modalLayer").classList.add("hidden");
        element("drawerLayer").classList.add("hidden");
        element("modalLayer").innerHTML = "";
        element("drawerLayer").innerHTML = "";
    }

    function toast(title, message = "") {
        const toastElement = document.createElement("div");
        toastElement.className = "toast";
        toastElement.innerHTML = `<i data-lucide="sparkles"></i><div><strong>${escapeHtml(title)}</strong>${message ? `<p class="card-caption" style="margin:4px 0 0;">${escapeHtml(message)}</p>` : ""}</div>`;
        element("toastStack").appendChild(toastElement);
        icons();
        setTimeout(() => toastElement.remove(), 4200);
    }

    function icons() {
        if (window.lucide) {
            window.lucide.createIcons();
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

    function dateInput(date) {
        const result = new Date(date);
        return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, "0")}-${String(result.getDate()).padStart(2, "0")}`;
    }

    function formatDate(value) {
        return value ? new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) : "—";
    }

    function shortDate(value) {
        return new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "short" }).format(new Date(value));
    }

    function seconds(value) {
        return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
    }

    function number(value) {
        return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(Number(value) || 0);
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

    function escapeHtml(value) {
        return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
    }

    let persistTimeoutId = null;

    function schedulePersist() {
        clearTimeout(persistTimeoutId);
        persistTimeoutId = setTimeout(persist, 250);
    }

    async function persist() {
        state.database.updatedAt = new Date().toISOString();
        await storage.save(state.database);
    }
})();


