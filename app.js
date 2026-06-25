(() => {
    "use strict";

    const sectionItems = [
        ["dashboard", "Dashboard", "layout-dashboard"],
        ["workout", "Current Workout", "dumbbell"],
        ["calendar", "Calendar", "calendar-days"],
        ["exercises", "Exercises", "list-filter"],
        ["knowledge", "Knowledge Base", "book-open"],
        ["stats", "Stats", "bar-chart-3"],
        ["rankings", "Rankings", "trophy"],
        ["achievements", "Achievements", "badge-check"],
        ["users", "Users", "users"],
        ["profile", "Profile", "user-round"],
        ["settings", "Settings", "settings"]
    ].map(([id, title, icon]) => ({ id, title, icon }));

    const mobileSectionIds = ["dashboard", "workout", "calendar", "stats", "profile"];
    const rankedExerciseNames = ["Bench Press", "Barbell Squat", "Romanian Deadlift", "Pull-ups", "Shoulder Press", "Barbell Row"];
    const rankOrder = ["beginner", "novice", "third_class", "second_class", "first_class", "candidate_master", "master"];

    const templates = [
        ["push", "Push Day", "Chest, shoulders and triceps.", ["Bench Press", "Incline Dumbbell Press", "Shoulder Press", "Lateral Raise", "Triceps Pushdown"]],
        ["pull", "Pull Day", "Back and biceps with clean pulling patterns.", ["Pull-ups", "Barbell Row", "Lat Pulldown", "Rear Delt Fly", "Hammer Curl"]],
        ["legs", "Leg Day", "Squat, hinge and lower-body accessories.", ["Barbell Squat", "Romanian Deadlift", "Leg Press", "Leg Curl", "Calf Raise"]],
        ["upper", "Upper Body", "Balanced upper-body strength work.", ["Bench Press", "Pull-ups", "Shoulder Press", "Seated Cable Row", "Barbell Curl"]],
        ["lower", "Lower Body", "Lower-body volume without chaos.", ["Barbell Squat", "Leg Press", "Romanian Deadlift", "Leg Extension", "Calf Raise"]],
        ["full_body", "Full Body", "Compact strength session.", ["Bench Press", "Pull-ups", "Barbell Squat", "Plank"]],
        ["cardio", "Cardio Day", "Conditioning-focused workout.", ["Treadmill", "Bike"]],
        ["custom", "Custom Day", "Start from a clean slate.", []]
    ].map(([id, title, description, exerciseNames]) => ({ id, title, description, exerciseNames, type: id }));

    const achievements = [
        ["first-workout", "First Workout", "Complete your first workout.", "🏁", "Consistency", 1, "completedWorkouts"],
        ["three-workouts", "3 Workouts Completed", "Build the first visible rhythm.", "⚙️", "Consistency", 3, "completedWorkouts"],
        ["ten-workouts", "10 Workouts Completed", "Lock in a real training habit.", "🧱", "Consistency", 10, "completedWorkouts"],
        ["first-pr", "First Personal Record", "Register any PR.", "📈", "Strength", 1, "personalRecords"],
        ["bench-pr", "Bench Press PR", "Set a bench press record.", "🏋️", "Strength", 1, "benchRecords"],
        ["squat-pr", "Squat PR", "Set a squat record.", "🦵", "Strength", 1, "squatRecords"],
        ["pullup-progress", "Pull-up Progress", "Log pull-ups three times.", "🪢", "Strength", 3, "pullupSessions"],
        ["volume-10k", "10,000 kg Total Volume", "Move the first big block.", "🧮", "Volume", 10000, "totalVolume"],
        ["volume-50k", "50,000 kg Total Volume", "Volume starts to compound.", "📦", "Volume", 50000, "totalVolume"],
        ["first-cardio", "First Cardio Session", "Log your first cardio block.", "❤️", "Cardio", 1, "cardioSessions"],
        ["cardio-100", "100 Cardio Minutes", "Build conditioning base.", "⏱️", "Cardio", 100, "cardioMinutes"],
        ["full-week", "Full Week Completed", "Train three times in one week.", "🗓️", "Consistency", 1, "fullTrainingWeeks"],
        ["ppl", "Push Pull Legs Completed", "Complete push, pull and legs.", "🔺", "Technique", 3, "pushPullLegs"],
        ["warmup", "Warm-up Discipline", "Complete 10 warm-up sets.", "🧤", "Technique", 10, "warmupSets"],
        ["notes", "Notes Master", "Add useful notes.", "📝", "Technique", 5, "notesCount"],
        ["profile", "Profile Completed", "Fill the key profile fields.", "🪪", "Profile", 1, "profileCompleteness"]
    ].map(([id, title, description, icon, category, target, metric]) => ({ id, title, description, icon, category, target, metric }));

    const state = {
        section: "dashboard",
        knowledgeExerciseId: "exercise-bench-press",
        profileUserId: null,
        database: null,
        charts: new Map(),
        calendar: null,
        filters: {
            exerciseSearch: "",
            statsScope: "current",
            statsRange: "90",
            statsMuscle: "all",
            statsExerciseId: "all",
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
            this.mode = this.readSetting("dataMode") || this.config.dataMode || "local";
            this.apiBaseUrl = this.readSetting("apiBaseUrl") || this.config.apiBaseUrl || "";
            this.backendStatus = "unknown";
            this.localProvider = new LocalStorageProvider(this.key);
            this.indexedDbProvider = new IndexedDbProvider("gymos-database", "state", this.key);
            this.apiClient = new ApiClient(this.apiBaseUrl);
            this.apiProvider = new ApiProvider(this.apiClient);
            this.provider = this.localProvider;
        }

        async initialize() {
            try {
                const indexedReady = await this.indexedDbProvider.initialize();
                this.localProvider = indexedReady ? this.indexedDbProvider : this.localProvider;
            } catch (error) {
                console.warn("IndexedDB fallback", error);
            }

            if (this.mode === "api") {
                const isBackendAvailable = await this.checkBackend(false);
                this.provider = isBackendAvailable ? this.apiProvider : this.localProvider;
                if (!isBackendAvailable && this.config.allowLocalFallback !== false) {
                    this.mode = "local";
                    this.writeSetting("dataMode", "local");
                }
                return;
            }

            this.provider = this.localProvider;
        }

        async load() {
            return this.provider.load();
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
        state.database = await storage.load() || createSeedDatabase();
        state.profileUserId = state.database.currentUserId;
        await persist();
        bindEvents();
        renderShell();
        renderSection();
    }

    function createSeedDatabase() {
        const now = new Date();
        const users = createUsers();
        const exercises = createExercises();
        return {
            version: 1,
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
            createUser("user-daniil", "Daniil Shkarupa", "Dunskyi", "DS", "#8c6f3f", 185, 78, "male", "Lean strength and visible progress", "4 years", "Back"),
            createUser("user-anastasia", "Anastasia", "Nastya", "AN", "#6e604a", 168, 56, "female", "Mobility, tone and consistency", "2 years", "Glutes"),
            createUser("user-maxim", "Maxim", "Max", "MX", "#465369", 181, 84, "male", "Powerbuilding", "5 years", "Chest")
        ];
    }

    function createUser(id, name, displayName, avatarInitials, avatarColor, height, bodyweight, gender, trainingGoal, trainingExperience, favoriteMuscleGroup) {
        return { id, name, displayName, avatarInitials, avatarColor, height, bodyweight, birthYear: 2002, gender, trainingGoal, trainingExperience, favoriteMuscleGroup, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    }

    function createExercises() {
        const rows = [
            ["bench-press", "Bench Press", "Barbell Bench,Flat Bench", "Chest", "Triceps,Shoulders", "Horizontal Press", "Barbell", "Strength", "Intermediate"],
            ["incline-dumbbell-press", "Incline Dumbbell Press", "Incline DB Press", "Chest", "Shoulders,Triceps", "Horizontal Press", "Dumbbell", "Hypertrophy", "Intermediate"],
            ["chest-press-machine", "Chest Press Machine", "Machine Press", "Chest", "Triceps", "Horizontal Press", "Machine", "Hypertrophy", "Beginner"],
            ["cable-fly", "Cable Fly", "Cable Crossover", "Chest", "Shoulders", "Horizontal Press", "Cable", "Isolation", "Beginner"],
            ["pull-ups", "Pull-ups", "Pullup,Chin over bar", "Back", "Biceps,Forearms", "Vertical Pull", "Bodyweight", "Strength", "Intermediate"],
            ["lat-pulldown", "Lat Pulldown", "Pulldown", "Back", "Biceps", "Vertical Pull", "Cable", "Hypertrophy", "Beginner"],
            ["barbell-row", "Barbell Row", "Bent-over Row", "Back", "Biceps,Forearms", "Horizontal Pull", "Barbell", "Strength", "Intermediate"],
            ["seated-cable-row", "Seated Cable Row", "Cable Row", "Back", "Biceps", "Horizontal Pull", "Cable", "Hypertrophy", "Beginner"],
            ["shoulder-press", "Shoulder Press", "Overhead Press,OHP", "Shoulders", "Triceps", "Vertical Press", "Barbell", "Strength", "Intermediate"],
            ["lateral-raise", "Lateral Raise", "Side Raise", "Shoulders", "", "Raise", "Dumbbell", "Isolation", "Beginner"],
            ["rear-delt-fly", "Rear Delt Fly", "Reverse Fly", "Shoulders", "Back", "Raise", "Dumbbell", "Isolation", "Beginner"],
            ["barbell-squat", "Barbell Squat", "Back Squat", "Quads", "Glutes,Hamstrings,Abs", "Squat", "Barbell", "Strength", "Advanced"],
            ["leg-press", "Leg Press", "Machine Leg Press", "Quads", "Glutes,Hamstrings", "Squat", "Machine", "Hypertrophy", "Beginner"],
            ["leg-extension", "Leg Extension", "Quad Extension", "Quads", "", "Extension", "Machine", "Isolation", "Beginner"],
            ["romanian-deadlift", "Romanian Deadlift", "RDL", "Hamstrings", "Glutes,Back", "Hinge", "Barbell", "Strength", "Intermediate"],
            ["leg-curl", "Leg Curl", "Hamstring Curl", "Hamstrings", "", "Curl", "Machine", "Isolation", "Beginner"],
            ["calf-raise", "Calf Raise", "Standing Calf Raise", "Calves", "", "Raise", "Machine", "Isolation", "Beginner"],
            ["barbell-curl", "Barbell Curl", "EZ Curl", "Biceps", "Forearms", "Curl", "Barbell", "Isolation", "Beginner"],
            ["dumbbell-curl", "Dumbbell Curl", "DB Curl", "Biceps", "Forearms", "Curl", "Dumbbell", "Isolation", "Beginner"],
            ["hammer-curl", "Hammer Curl", "Neutral Curl", "Biceps", "Forearms", "Curl", "Dumbbell", "Isolation", "Beginner"],
            ["triceps-pushdown", "Triceps Pushdown", "Cable Pushdown", "Triceps", "", "Extension", "Cable", "Isolation", "Beginner"],
            ["overhead-triceps-extension", "Overhead Triceps Extension", "Overhead Cable Extension", "Triceps", "", "Extension", "Cable", "Isolation", "Beginner"],
            ["plank", "Plank", "Front Plank", "Abs", "Full Body", "Core", "Bodyweight", "Core", "Beginner"],
            ["hanging-leg-raise", "Hanging Leg Raise", "Leg Raise", "Abs", "Forearms", "Core", "Bodyweight", "Core", "Intermediate"],
            ["treadmill", "Treadmill", "Incline Walk", "Full Body", "Calves", "Cardio", "Machine", "Cardio", "Beginner"],
            ["bike", "Bike", "Stationary Bike", "Quads", "Glutes,Calves", "Cardio", "Machine", "Cardio", "Beginner"],
            ["running", "Running", "Run", "Full Body", "Calves,Quads", "Cardio", "Bodyweight", "Cardio", "Intermediate"],
            ["walking", "Walking", "Walk", "Full Body", "Calves", "Cardio", "Bodyweight", "Cardio", "Beginner"],
            ["rowing-machine", "Rowing Machine", "Rower", "Full Body", "Back,Quads,Biceps", "Cardio", "Machine", "Cardio", "Intermediate"]
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
            description: `${name} is a ${movementPattern.toLowerCase()} movement focused on ${primaryMuscleGroup.toLowerCase()}. Keep the setup repeatable and track clean performance.` ,
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

    function techniqueFor(pattern) {
        const data = {
            "Horizontal Press": ["Set shoulder blades down and back.", "Keep wrists stacked over elbows.", "Lower with control.", "Press without bouncing."],
            "Vertical Press": ["Brace ribs down.", "Press in a smooth vertical path.", "Avoid excessive arching.", "Finish with controlled lockout."],
            "Horizontal Pull": ["Set the torso angle.", "Drive elbows back.", "Pause near the body.", "Lower under control."],
            "Vertical Pull": ["Start with stable shoulders.", "Pull elbows down to ribs.", "Avoid swinging.", "Control the full stretch."],
            "Squat": ["Brace before descent.", "Keep foot pressure balanced.", "Control depth.", "Drive up without knee collapse."],
            "Hinge": ["Push hips back.", "Keep the load close.", "Maintain neutral spine.", "Stand tall without leaning back."],
            "Curl": ["Lock upper arms.", "Lift without hip swing.", "Squeeze briefly.", "Lower slowly."],
            "Extension": ["Keep elbows stable.", "Move through the target joint.", "Control lockout.", "Avoid stack slamming."],
            "Raise": ["Use controlled weight.", "Lead smoothly.", "Avoid trap domination.", "Lower slowly."],
            "Core": ["Brace first.", "Keep pelvis controlled.", "Avoid momentum.", "Stop when position breaks."],
            "Cardio": ["Start easy.", "Increase intensity gradually.", "Keep breathing stable.", "Record duration and effort."]
        };
        return data[pattern] || ["Set up with control.", "Use repeatable range.", "Avoid rushing.", "Track consistently."];
    }

    function mistakesFor(pattern) {
        const data = {
            "Horizontal Press": ["Bouncing the weight", "Loose shoulder position", "Inconsistent range"],
            "Vertical Pull": ["Swinging", "Half reps", "Only pulling with arms"],
            "Squat": ["Rushing descent", "Heels lifting", "Knees collapsing inward"],
            "Hinge": ["Turning it into a squat", "Rounding under fatigue", "Load drifting away"],
            "Cardio": ["Starting too hard", "Skipping warm-up", "Not recording intensity"]
        };
        return data[pattern] || ["Too much momentum", "Too much load", "Poor control near fatigue"];
    }

    function safetyFor(pattern) {
        const data = {
            "Horizontal Press": ["Use safeties or a spotter for heavy sets.", "Stop when bar path becomes unstable."],
            "Squat": ["Use safeties for heavy attempts.", "Do not chase depth by losing control."],
            "Hinge": ["Respect fatigue on hinge work.", "Reduce load if position changes."],
            "Cardio": ["Increase intensity gradually.", "Rest if discomfort appears."]
        };
        return data[pattern] || ["Use controlled loading.", "Do not chase numbers with broken form."];
    }

    function createBodyweights(users, now) {
        return users.flatMap((user, userIndex) => Array.from({ length: 9 }, (_, entryIndex) => ({
            id: createId("bodyweight"),
            userId: user.id,
            date: dateInput(addDays(now, (entryIndex - 8) * 7)),
            bodyweight: round(user.bodyweight + Math.sin(entryIndex + userIndex) * 1.2, 1),
            notes: "Weekly check-in"
        })));
    }

    function createWorkouts(exercises, now) {
        const byName = new Map(exercises.map((exercise) => [exercise.name, exercise]));
        const plan = [
            ["user-daniil", 38, "Push strength", "push", ["Bench Press", "Incline Dumbbell Press", "Lateral Raise", "Triceps Pushdown"]],
            ["user-daniil", 35, "Pull volume", "pull", ["Pull-ups", "Barbell Row", "Lat Pulldown", "Hammer Curl"]],
            ["user-daniil", 32, "Leg rebuild", "legs", ["Barbell Squat", "Romanian Deadlift", "Leg Press", "Calf Raise"]],
            ["user-daniil", 28, "Upper control", "upper", ["Bench Press", "Seated Cable Row", "Shoulder Press", "Barbell Curl"]],
            ["user-daniil", 20, "Push hypertrophy", "push", ["Incline Dumbbell Press", "Chest Press Machine", "Cable Fly", "Triceps Pushdown"]],
            ["user-daniil", 16, "Leg volume", "legs", ["Barbell Squat", "Leg Extension", "Leg Curl", "Calf Raise"]],
            ["user-daniil", 7, "Push progression", "push", ["Bench Press", "Incline Dumbbell Press", "Shoulder Press", "Overhead Triceps Extension"]],
            ["user-daniil", 3, "Pull precision", "pull", ["Pull-ups", "Barbell Row", "Seated Cable Row", "Hammer Curl"]],
            ["user-anastasia", 31, "Lower body control", "lower", ["Leg Press", "Romanian Deadlift", "Leg Curl", "Calf Raise"]],
            ["user-anastasia", 24, "Cardio and core", "cardio", ["Treadmill", "Bike", "Plank"]],
            ["user-anastasia", 9, "Upper clean reps", "upper", ["Lat Pulldown", "Seated Cable Row", "Lateral Raise", "Triceps Pushdown"]],
            ["user-maxim", 36, "Heavy push", "push", ["Bench Press", "Shoulder Press", "Triceps Pushdown"]],
            ["user-maxim", 19, "Leg power", "legs", ["Barbell Squat", "Romanian Deadlift", "Leg Press"]],
            ["user-maxim", 5, "Upper density", "upper", ["Bench Press", "Barbell Row", "Shoulder Press", "Hammer Curl"]]
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
                notes: workoutIndex % 2 ? "Good session. Add load only if control stays stable." : "Clean technique. Repeat setup next time.",
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
        activeWorkout.notes = "Active demo workout. Finish it or add more work.";
        workouts.push(activeWorkout);
        return workouts;
    }

    function createWorkoutExercise(exercise, workoutIndex, index) {
        if (exercise.movementPattern === "Cardio") {
            return { id: createId("workout-exercise"), exerciseId: exercise.id, order: index + 1, notes: "Cardio exercise tracked in cardio sessions.", sets: [] };
        }

        const base = seedWeight(exercise.name, workoutIndex);
        return {
            id: createId("workout-exercise"),
            exerciseId: exercise.id,
            order: index + 1,
            notes: index === 0 ? "Main movement. Stay strict." : "Accessory movement.",
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
            notes: status === "planned" ? "Planned from template." : "Started from template.",
            exercises: template.exerciseNames.map((name, index) => {
                const exercise = byName.get(name);
                return { id: createId("workout-exercise"), exerciseId: exercise.id, order: index + 1, notes: "Template suggestion.", sets: suggestedSets(exercise) };
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
        const exerciseMultipliers = { "Bench Press": 1, "Barbell Squat": 1.28, "Romanian Deadlift": 1.2, "Pull-ups": 1.05, "Shoulder Press": 0.68, "Barbell Row": 0.95 };
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
                            repetitions: name === "Pull-ups" ? (gender === "female" ? 3 : 5) : 1,
                            sourceName: "Demo configurable standards",
                            sourceNote: "Demo data only. Replace with your own standards later.",
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
        return { id: createId("cardio"), type: index % 2 ? "bike" : "treadmill", durationMinutes: 18 + index % 5 * 4, distance: round(2 + index % 4 * 0.7, 1), calories: 140 + index % 5 * 28, averageHeartRate: 125 + index % 4 * 8, intensity: ["low", "medium", "high"][index % 3], notes: "Controlled conditioning block" };
    }

    function renderShell() {
        renderNavigation("sidebarNavigation", sectionItems);
        renderNavigation("mobileNavigation", sectionItems.filter((item) => mobileSectionIds.includes(item.id)));
        renderCurrentUserButton();
        renderSidebarProfile();
    }

    function renderNavigation(containerId, items) {
        const activeWorkout = activeWorkoutFor(currentUser().id);
        const container = element(containerId);
        container.innerHTML = items.map((item) => `
            <button class="nav-button ${state.section === item.id ? "active" : ""}" type="button" data-action="navigate" data-section="${item.id}">
                <span><i data-lucide="${item.icon}"></i>${escapeHtml(item.title)}</span>
                ${item.id === "workout" && activeWorkout ? `<strong class="nav-badge">Live</strong>` : ""}
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
                    <div class="profile-meta">${stats.completedWorkouts} workouts · ${number(stats.totalVolume)} kg</div>
                </div>
            </div>
            <div class="progress-track" style="margin-top: 14px;"><div class="progress-fill" style="width: ${Math.min(100, stats.completedWorkouts * 5)}%;"></div></div>
            <div class="profile-meta" style="margin-top: 8px;">Current rank: ${escapeHtml(mainRank(user.id))}</div>
        `;
    }

    function renderSection() {
        destroyCharts();
        renderShell();
        const item = sectionItems.find((section) => section.id === state.section) || sectionItems[0];
        element("sectionEyebrow").textContent = "Gym OS";
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
                ${metric("Today's workout", todayLabel(user.id), "calendar-check", todayCaption(user.id), "span-3")}
                ${metric("Active workout", activeWorkoutFor(user.id)?.title || "No active", "activity", activeWorkoutFor(user.id) ? "Workout timer is running" : "Start from a template", "span-3")}
                ${metric("Weekly volume", `${number(stats.weekVolume)} kg`, "boxes", `${stats.weekSets} sets this week`, "span-3")}
                ${metric("Cardio week", `${stats.weekCardioMinutes} min`, "heart-pulse", "Conditioning tracked", "span-3")}
                ${chartCard("Weekly volume", "Completed working volume by day.", "weeklyVolumeChart", "span-8")}
                ${chartCard("Muscle split", "Distribution by completed sets.", "muscleChart", "span-4")}
                <section class="card span-4"><h2>Training command</h2>${kpi([{ label: "Completed", value: stats.completedWorkouts }, { label: "Total kg", value: number(stats.totalVolume) }, { label: "Streak", value: stats.trainingStreak }, { label: "Sets", value: stats.totalSets }])}<div class="insight-grid" style="margin-top: 14px;">${insights(user.id).slice(0, 3).map(insightCard).join("")}</div></section>
                <section class="card span-4"><h2>Best recent PR</h2>${record ? recordCard(record) : emptyInline("No personal records yet", "Complete workouts to start detecting PRs.")}</section>
                <section class="card span-4"><h2>Team summary</h2>${kpi([{ label: "Workouts", value: team.completedWorkouts }, { label: "Team kg", value: number(team.totalVolume) }, { label: "Cardio min", value: team.cardioMinutes }, { label: "Most active", value: team.mostActiveUser.displayName }])}</section>
                ${chartCard("Bodyweight trend", "Weekly check-ins.", "bodyweightChart", "span-6")}
                ${chartCard("Cardio minutes", "Recent conditioning blocks.", "cardioChart", "span-6")}
                <section class="card span-12"><div class="card-header"><div><h2>Recent activity</h2><p class="card-caption">Shared team feed. Other users are view-only.</p></div><button class="button button-secondary compact" type="button" data-action="navigate" data-section="rankings">Open leaderboard</button></div><div class="activity-feed">${activityFeed()}</div></section>
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
                    <section class="card"><h2>Workout intelligence</h2><div class="insight-grid">${insights(currentUser().id).map(insightCard).join("")}</div></section>
                    <section class="card"><h2>Quick templates</h2><div class="template-grid">${templates.map(templateCard).join("")}</div></section>
                </aside>
            </div>
        `);
    }

    function workoutStarter() {
        return `<section class="empty-state"><i data-lucide="dumbbell"></i><h2>No active workout</h2><p>Start clean or pick a premium template. Main controls are large enough for actual gym usage.</p><div class="action-row" style="justify-content:center;margin-top:16px;"><button class="button button-primary large-workout-button" type="button" data-action="start-empty-workout"><i data-lucide="play"></i>Start empty workout</button><button class="button button-secondary large-workout-button" type="button" data-action="open-template-modal"><i data-lucide="layers"></i>Choose template</button></div></section>`;
    }

    function workoutEditor(workoutItem) {
        const owner = userById(workoutItem.userId);
        const readonly = workoutItem.userId !== state.database.currentUserId;
        const completedSets = workoutItem.exercises.flatMap((item) => item.sets).filter((set) => set.isCompleted).length;
        return `
            <section class="card">
                <div class="card-header">
                    <div><div class="tag-row" style="margin-bottom:10px;"><span class="status-badge ${workoutItem.status}">${capitalize(workoutItem.status)}</span>${readonly ? `<span class="status-badge readonly">Read only</span>` : ""}<span class="chip">${escapeHtml(owner.displayName)}</span></div><h2>${escapeHtml(workoutItem.title)}</h2><p class="card-caption">${formatDate(workoutItem.date)} · ${duration(workoutItem)} min · ${number(workoutVolume(workoutItem))} kg · ${completedSets} completed sets</p></div>
                    <div class="inline-actions"><button class="button button-secondary compact" type="button" data-action="open-add-exercise-modal" ${readonly ? "disabled" : ""}><i data-lucide="plus"></i>Add exercise</button><button class="button button-primary compact" type="button" data-action="finish-workout" ${readonly ? "disabled" : ""}><i data-lucide="flag"></i>Finish</button></div>
                </div>
                ${readonly ? `<div class="readonly-layer">You can inspect this workout, but only its owner can edit it.</div>` : ""}
                <div class="field" style="margin-top:14px;"><label>Workout notes</label><textarea data-action="update-workout-notes" ${readonly ? "disabled" : ""}>${escapeHtml(workoutItem.notes || "")}</textarea></div>
            </section>
            ${workoutItem.exercises.length ? workoutItem.exercises.sort((left, right) => left.order - right.order).map((item) => workoutExerciseEditor(workoutItem, item, readonly)).join("") : emptyInline("No exercises yet", "Add an exercise to build the session.")}
            <section class="card"><div class="card-header"><div><h2>Cardio inside workout</h2><p class="card-caption">Track conditioning without leaving the active session.</p></div><button class="button button-secondary compact" type="button" data-action="add-cardio" ${readonly ? "disabled" : ""}>Add cardio</button></div>${workoutItem.cardioSessions.length ? workoutItem.cardioSessions.map((session) => `<div class="activity-item"><div class="activity-dot"></div><div><strong>${capitalize(session.type)}</strong><p class="card-caption">${session.durationMinutes} min · ${session.distance} km · ${session.calories} kcal · ${capitalize(session.intensity)}</p></div></div>`).join("") : `<p class="card-caption">No cardio blocks in this workout.</p>`}</section>
        `;
    }

    function workoutExerciseEditor(workoutItem, workoutExercise, readonly) {
        const exercise = exerciseById(workoutExercise.exerciseId);
        const previous = previousPerformance(workoutItem.userId, workoutExercise.exerciseId, workoutItem.id);
        return `<article class="workout-exercise"><div class="exercise-header"><div><div class="exercise-title-line"><h3>${escapeHtml(exercise.name)}</h3><span class="chip">${exercise.primaryMuscleGroup}</span><span class="chip">${exercise.movementPattern}</span></div><p class="card-caption">${number(exerciseVolume(workoutExercise))} kg volume · est. 1RM ${number(exerciseOneRepMax(workoutExercise))} kg${previous ? ` · previous ${number(previous.weight)} kg × ${previous.repetitions}` : ""}</p></div><div class="inline-actions"><button class="icon-button" type="button" title="Technique" data-action="open-exercise" data-exercise-id="${exercise.id}"><i data-lucide="book-open"></i></button><button class="icon-button" type="button" title="Add set" data-action="add-set" data-workout-exercise-id="${workoutExercise.id}" ${readonly ? "disabled" : ""}><i data-lucide="plus"></i></button><button class="icon-button" type="button" title="Duplicate" data-action="duplicate-set" data-workout-exercise-id="${workoutExercise.id}" ${readonly ? "disabled" : ""}><i data-lucide="copy"></i></button></div></div><div class="set-grid-header"><span>Type</span><span>Weight</span><span>Reps</span><span>RPE</span><span>Rest</span><span>Done</span><span></span></div>${workoutExercise.sets.map((set) => setRow(workoutExercise.id, set, readonly)).join("")}<div class="field" style="margin-top:12px;"><label>Exercise notes</label><textarea data-action="update-exercise-notes" data-workout-exercise-id="${workoutExercise.id}" ${readonly ? "disabled" : ""}>${escapeHtml(workoutExercise.notes || "")}</textarea></div></article>`;
    }

    function setRow(workoutExerciseId, set, readonly) {
        return `<div class="set-row ${set.isCompleted ? "completed" : ""}"><select data-action="set-field" data-workout-exercise-id="${workoutExerciseId}" data-set-id="${set.id}" data-field="type" ${readonly ? "disabled" : ""}>${["warmup", "working", "drop", "failure", "backoff"].map((type) => `<option value="${type}" ${set.type === type ? "selected" : ""}>${capitalize(type)}</option>`).join("")}</select><input type="number" step="0.5" value="${set.weight}" data-action="set-field" data-workout-exercise-id="${workoutExerciseId}" data-set-id="${set.id}" data-field="weight" ${readonly ? "disabled" : ""}><input type="number" step="1" value="${set.repetitions}" data-action="set-field" data-workout-exercise-id="${workoutExerciseId}" data-set-id="${set.id}" data-field="repetitions" ${readonly ? "disabled" : ""}><input type="number" step="0.5" value="${set.rpe}" data-action="set-field" data-workout-exercise-id="${workoutExerciseId}" data-set-id="${set.id}" data-field="rpe" ${readonly ? "disabled" : ""}><input type="number" step="15" value="${set.restSeconds}" data-action="set-field" data-workout-exercise-id="${workoutExerciseId}" data-set-id="${set.id}" data-field="restSeconds" ${readonly ? "disabled" : ""}><button class="icon-button" type="button" data-action="toggle-set" data-workout-exercise-id="${workoutExerciseId}" data-set-id="${set.id}" ${readonly ? "disabled" : ""}><i data-lucide="${set.isCompleted ? "check-circle-2" : "circle"}"></i></button><button class="icon-button" type="button" data-action="delete-set" data-workout-exercise-id="${workoutExerciseId}" data-set-id="${set.id}" ${readonly ? "disabled" : ""}><i data-lucide="trash-2"></i></button></div>`;
    }

    function calendar() {
        const team = teamStats();
        content(`<div class="grid dashboard-grid">${metric("Team workouts", team.completedWorkouts, "users", "Completed across the team", "span-3")}${metric("Team volume", `${number(team.totalVolume)} kg`, "boxes", "Shared total", "span-3")}${metric("Cardio days", team.cardioDays, "heart-pulse", "Days with cardio", "span-3")}${metric("Team streak", `${team.teamStreak} days`, "flame", "Any user trained", "span-3")}<section class="calendar-shell span-12"><div class="card-header" style="margin-bottom:16px;"><div><h2>Training calendar</h2><p class="card-caption">Click a day to plan a workout. Click an event to inspect details.</p></div><button class="button button-secondary compact" type="button" data-action="open-template-modal">Plan workout</button></div><div id="calendarContainer"></div></section></div>`);
        requestAnimationFrame(renderCalendar);
    }

    function exercises() {
        const items = filteredExercises();
        content(`<section class="card"><div class="card-header"><div><h2>Exercise catalog</h2><p class="card-caption">Hybrid catalog: muscle group, movement pattern, equipment, aliases and technique guide.</p></div><button class="button button-primary compact" type="button" data-action="open-custom-exercise"><i data-lucide="plus"></i>Custom exercise</button></div><div class="filter-row"><input type="search" placeholder="Search by name, alias, muscle group, movement pattern or equipment" value="${escapeHtml(state.filters.exerciseSearch)}" data-action="exercise-search"></div></section><section class="exercise-card-grid" style="margin-top:16px;">${items.map(exerciseCard).join("")}</section>`);
    }

    function knowledge() {
        const selected = exerciseById(state.knowledgeExerciseId) || state.database.exercises[0];
        const currentBest = bestResult(currentUser().id, selected.id);
        const teamBest = teamBestResult(selected.id);
        content(`<div class="grid dashboard-grid"><section class="card span-4"><h2>Knowledge Base</h2><input type="search" placeholder="Search technique" value="${escapeHtml(state.filters.exerciseSearch)}" data-action="exercise-search"><div class="workout-stack" style="margin-top:14px;">${filteredExercises().slice(0, 14).map((exercise) => `<button class="nav-button ${exercise.id === selected.id ? "active" : ""}" type="button" data-action="select-knowledge" data-exercise-id="${exercise.id}"><span><i data-lucide="circle-dot"></i>${escapeHtml(exercise.name)}</span><strong class="nav-badge">${escapeHtml(exercise.primaryMuscleGroup)}</strong></button>`).join("")}</div></section><section class="card span-8"><div class="card-header"><div><div class="tag-row" style="margin-bottom:10px;"><span class="badge accent">${escapeHtml(selected.primaryMuscleGroup)}</span><span class="chip">${escapeHtml(selected.movementPattern)}</span><span class="chip">${escapeHtml(selected.equipment)}</span><span class="chip">${escapeHtml(selected.difficulty)}</span></div><h2>${escapeHtml(selected.name)}</h2><p class="card-caption">${escapeHtml(selected.description)}</p></div><button class="button button-primary compact" type="button" data-action="add-exercise" data-exercise-id="${selected.id}">Add to workout</button></div>${media(selected)}</section><section class="card span-4"><h2>Technique steps</h2>${ordered(selected.techniqueSteps)}</section><section class="card span-4"><h2>Common mistakes</h2>${bullets(selected.commonMistakes)}</section><section class="card span-4"><h2>Safety tips</h2>${bullets(selected.safetyTips)}</section><section class="card span-4"><h2>Usage intelligence</h2>${kpi([{ label: "Last used", value: lastUsed(selected.id) ? shortDate(lastUsed(selected.id)) : "Never" }, { label: "Users", value: usersForExercise(selected.id).length }, { label: "Your best", value: currentBest ? `${number(currentBest.estimatedOneRepMax)} kg` : "—" }, { label: "Team best", value: teamBest ? `${number(teamBest.estimatedOneRepMax)} kg` : "—" }])}</section><section class="card span-8"><h2>Related exercises</h2><div class="exercise-card-grid">${relatedExercises(selected.id).slice(0, 4).map(exerciseCard).join("")}</div></section></div>`);
    }

    function stats() {
        const userId = state.filters.statsScope === "current" ? currentUser().id : null;
        const summary = userId ? userStats(userId) : teamStats();
        content(`<section class="card"><div class="card-header"><div><h2>Powerful stats</h2><p class="card-caption">Filter by scope, date range, muscle group and exercise.</p></div></div><div class="filter-row"><select data-action="stats-filter" data-filter="statsScope"><option value="current" ${state.filters.statsScope === "current" ? "selected" : ""}>Current user</option><option value="team" ${state.filters.statsScope === "team" ? "selected" : ""}>All users</option></select><select data-action="stats-filter" data-filter="statsRange"><option value="30" ${state.filters.statsRange === "30" ? "selected" : ""}>Last 30 days</option><option value="90" ${state.filters.statsRange === "90" ? "selected" : ""}>Last 90 days</option><option value="365" ${state.filters.statsRange === "365" ? "selected" : ""}>Last year</option><option value="all" ${state.filters.statsRange === "all" ? "selected" : ""}>All time</option></select><select data-action="stats-filter" data-filter="statsMuscle"><option value="all">All muscle groups</option>${unique(state.database.exercises.map((exercise) => exercise.primaryMuscleGroup)).map((muscle) => `<option value="${muscle}" ${state.filters.statsMuscle === muscle ? "selected" : ""}>${muscle}</option>`).join("")}</select><select data-action="stats-filter" data-filter="statsExerciseId"><option value="all">All exercises</option>${state.database.exercises.map((exercise) => `<option value="${exercise.id}" ${state.filters.statsExerciseId === exercise.id ? "selected" : ""}>${escapeHtml(exercise.name)}</option>`).join("")}</select></div></section><div class="grid dashboard-grid" style="margin-top:16px;">${metric("Total workouts", summary.totalWorkouts, "calendar", "All statuses", "span-3")}${metric("Completed", summary.completedWorkouts, "check-circle-2", "Finished sessions", "span-3")}${metric("Total sets", summary.totalSets, "list-checks", `${summary.workingSets || 0} working`, "span-3")}${metric("Total volume", `${number(summary.totalVolume)} kg`, "boxes", "Completed sets", "span-3")}${metric("Avg duration", `${summary.averageDurationMinutes || 0} min`, "timer", "Completed workouts", "span-3")}${metric("Cardio minutes", summary.cardioMinutes || 0, "heart-pulse", `${summary.cardioDistance || 0} km`, "span-3")}${metric("Most used", summary.mostUsedExercise?.name || "—", "repeat", "Exercise frequency", "span-3")}${metric("Best muscle", summary.mostTrainedMuscleGroup || "—", "target", "By completed sets", "span-3")}${chartCard("Volume over time", "Completed volume by session.", "statsVolume", "span-6")}${chartCard("Sets by muscle group", "Completed sets distribution.", "statsMuscle", "span-6")}${chartCard("Exercise progress", "Approximate 1RM trend.", "statsProgress", "span-6")}${chartCard("Consistency", "Exercises per session.", "statsConsistency", "span-6")}</div>`);
        requestAnimationFrame(() => {
            volumeChart("statsVolume", userId);
            muscleDistributionChart("statsMuscle", userId);
            progressChart("statsProgress", userId || currentUser().id);
            consistencyChart("statsConsistency", userId);
        });
    }

    function rankings() {
        const user = currentUser();
        content(`<section class="card"><div class="card-header"><div><h2>Strength rankings</h2><p class="card-caption">Standards are configurable demo data, not official final truth.</p></div><span class="badge accent">${user.bodyweight} kg · ${user.gender}</span></div></section><section class="ranking-grid" style="margin-top:16px;">${rankedExerciseNames.map((name) => rankCard(user, exerciseByName(name))).join("")}</section><section class="card" style="margin-top:16px;"><div class="card-header"><div><h2>Team leaderboard</h2><p class="card-caption">Ranked by consistency, volume and best lift.</p></div></div><div class="table-wrap"><table><thead><tr><th>User</th><th>Completed</th><th>Total volume</th><th>Best lift</th><th>Main level</th><th>Score</th></tr></thead><tbody>${leaderboard().map((row, index) => `<tr><td><div class="list-row">${avatar(row.user, "small")}<strong>${index + 1}. ${escapeHtml(row.user.displayName)}</strong></div></td><td>${row.completedWorkouts}</td><td>${number(row.totalVolume)} kg</td><td>${row.bestLift ? `${escapeHtml(row.bestLift.exercise.name)} · ${number(row.bestLift.estimatedOneRepMax)} kg` : "—"}</td><td>${escapeHtml(row.mainRank)}</td><td>${number(row.score)}</td></tr>`).join("")}</tbody></table></div></section>`);
    }

    function achievementsPage() {
        const items = achievementsFor(currentUser().id);
        const categories = ["all", ...unique(achievements.map((achievement) => achievement.category))];
        const filtered = state.filters.achievementCategory === "all" ? items : items.filter((item) => item.category === state.filters.achievementCategory);
        content(`<section class="card"><div class="card-header"><div><h2>Achievements</h2><p class="card-caption">Polished badges with locked and unlocked states.</p></div><span class="badge accent">${items.filter((item) => item.isUnlocked).length}/${items.length} unlocked</span></div><div class="tab-row">${categories.map((category) => `<button class="segment-button ${state.filters.achievementCategory === category ? "active" : ""}" type="button" data-action="achievement-filter" data-category="${category}">${capitalize(category)}</button>`).join("")}</div></section><section class="achievement-grid" style="margin-top:16px;">${filtered.map(achievementCard).join("")}</section>`);
    }

    function users() {
        const team = teamStats();
        content(`<div class="grid dashboard-grid">${metric("Team total", `${number(team.totalVolume)} kg`, "boxes", "Shared volume", "span-3")}${metric("Team workouts", team.completedWorkouts, "calendar-check", "Completed", "span-3")}${metric("Most active", team.mostActiveUser.displayName, "flame", "By completed workouts", "span-3")}${metric("Cardio", `${team.cardioMinutes} min`, "heart-pulse", "Team conditioning", "span-3")}</div><section class="user-grid" style="margin-top:16px;">${state.database.users.map(userCard).join("")}</section>`);
    }

    function profile() {
        const user = userById(state.profileUserId || state.database.currentUserId);
        const summary = userStats(user.id);
        const isCurrent = user.id === currentUser().id;
        const recent = workoutsFor(user.id).filter((workoutItem) => workoutItem.status === "completed").sort(byDateDesc).slice(0, 5);
        content(`<div class="grid dashboard-grid"><section class="card span-12"><div class="profile-header"><div class="list-row">${avatar(user, "large")}<div><div class="tag-row" style="margin-bottom:10px;"><span class="badge accent">${escapeHtml(user.trainingGoal)}</span><span class="status-badge ${isCurrent ? "completed" : "readonly"}">${isCurrent ? "Editable" : "Read only"}</span></div><h2>${escapeHtml(user.displayName)}</h2><p class="card-caption">${escapeHtml(user.name)} · ${user.height} cm · ${user.bodyweight} kg · ${escapeHtml(user.trainingExperience)}</p></div></div><button class="button button-primary" type="button" data-action="open-profile-editor" ${isCurrent ? "" : "disabled"}><i data-lucide="pen-line"></i>Edit profile</button></div></section>${metric("Workouts", summary.completedWorkouts, "calendar-check", "Completed", "span-3")}${metric("Total volume", `${number(summary.totalVolume)} kg`, "boxes", "All completed sets", "span-3")}${metric("Total sets", summary.totalSets, "list-checks", `${summary.workingSets} working`, "span-3")}${metric("Streak", `${summary.trainingStreak} days`, "flame", "Completed sessions", "span-3")}${chartCard("Bodyweight history", "Weekly check-ins.", "profileBodyweight", "span-6")}${chartCard("Estimated 1RM trend", "Bench press trend demo.", "profileMax", "span-6")}<section class="card span-6"><h2>Personal records</h2><div class="workout-stack">${recordsFor(user.id).slice(0, 6).map(recordCard).join("") || emptyInline("No PRs yet", "Complete working sets to detect records.")}</div></section><section class="card span-6"><h2>Current badges</h2><div class="achievement-grid">${achievementsFor(user.id).filter((item) => item.isUnlocked).slice(0, 4).map(achievementCard).join("") || emptyInline("No badges yet", "Complete workouts to unlock badges.")}</div></section><section class="card span-12"><h2>Recent workouts</h2><div class="table-wrap"><table><thead><tr><th>Date</th><th>Title</th><th>Type</th><th>Volume</th><th>Duration</th><th></th></tr></thead><tbody>${recent.map((workoutItem) => `<tr><td>${formatDate(workoutItem.date)}</td><td>${escapeHtml(workoutItem.title)}</td><td>${capitalize(workoutItem.workoutType)}</td><td>${number(workoutVolume(workoutItem))} kg</td><td>${duration(workoutItem)} min</td><td><button class="button button-secondary compact" type="button" data-action="open-workout" data-workout-id="${workoutItem.id}">View</button></td></tr>`).join("")}</tbody></table></div></section></div>`);
        requestAnimationFrame(() => {
            bodyweightChart("profileBodyweight", user.id);
            maxTrendChart("profileMax", user.id);
        });
    }

    function settings() {
        content(`<div class="grid dashboard-grid"><section class="card span-6"><h2>Active user</h2><p class="card-caption">Front-end permission simulation. Active user can edit only own data.</p><div class="user-grid" style="margin-top:14px;">${state.database.users.map(userSwitcherCard).join("")}</div></section><section class="card span-6"><h2>Theme</h2><p class="card-caption">Dark only. Premium graphite palette, soft borders, muted gold accent, no neon.</p>${kpi([{ label: "Mode", value: "Dark" }, { label: "Font", value: "Oxanium" }])}</section><section class="card span-6"><h2>Data portability</h2><p class="card-caption">Local-first storage abstraction. Easy to replace with API calls later.</p><div class="action-row"><button class="button button-primary" type="button" data-action="export-data"><i data-lucide="download"></i>Export JSON</button><label class="button button-secondary" for="importInput"><i data-lucide="upload"></i>Import JSON</label><input class="hidden" id="importInput" type="file" accept="application/json" data-action="import-data"></div></section><section class="card span-6"><h2>Storage status</h2>${kpi([{ label: "Storage", value: storage.mode }, { label: "Exercises", value: state.database.exercises.length }, { label: "Workouts", value: state.database.workouts.length }])}<div class="action-row" style="margin-top:14px;"><button class="button button-secondary" type="button" data-action="notifications"><i data-lucide="bell"></i>Notifications</button><button class="button button-danger" type="button" data-action="reset"><i data-lucide="rotate-ccw"></i>Reset demo data</button></div></section><section class="card span-6"><h2>Manage exercise catalog</h2><p class="card-caption">Custom exercises are stored locally and marked by owner.</p><button class="button button-primary" type="button" data-action="open-custom-exercise">Add custom exercise</button></section><section class="card span-6"><h2>Manage strength standards</h2><p class="card-caption">Demo standards are configurable and not presented as official truth.</p><button class="button button-secondary" type="button" data-action="open-standards">Open standards table</button></section></div>`);
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
    }

    function navigate(section) {
        state.section = section;
        closeOverlay();
        renderSection();
    }

    function openQuickAction() {
        openModal(`<div class="modal-header"><div><h2>Quick action</h2><p class="card-caption">Start, plan or jump to a focused area.</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><div class="template-grid"><button class="template-card" type="button" data-action="start-empty-workout"><h3>Start empty workout</h3><p class="card-caption">Clean session with no predefined exercises.</p></button><button class="template-card" type="button" data-action="open-template-modal"><h3>Choose template</h3><p class="card-caption">Push, pull, legs, full body and more.</p></button><button class="template-card" type="button" data-action="navigate" data-section="rankings"><h3>Open rankings</h3><p class="card-caption">Check current strength class.</p></button><button class="template-card" type="button" data-action="navigate" data-section="knowledge"><h3>Technique base</h3><p class="card-caption">Review form and mistakes.</p></button></div>`);
    }

    function openUserSwitcher() {
        openModal(`<div class="modal-header"><div><h2>Switch active user</h2><p class="card-caption">Permissions are simulated with currentUserId.</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><div class="user-grid">${state.database.users.map(userSwitcherCard).join("")}</div>`);
    }

    function openTemplateModal() {
        openModal(`<div class="modal-header"><div><h2>Workout templates</h2><p class="card-caption">Create planned or active workouts. Everything can be edited after creation.</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><div class="template-grid">${templates.map(templateCard).join("")}</div>`);
    }

    function openAddExerciseModal() {
        openModal(`<div class="modal-header"><div><h2>Add exercise</h2><p class="card-caption">Search by name, alias, muscle, pattern or equipment.</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><input type="search" placeholder="Search exercise" value="${escapeHtml(state.filters.exerciseSearch)}" data-action="exercise-search"><div class="exercise-picker-grid" style="margin-top:14px;">${filteredExercises().map((exercise) => `<article class="exercise-card"><h3>${escapeHtml(exercise.name)}</h3><p class="card-caption">${escapeHtml(exercise.primaryMuscleGroup)} · ${escapeHtml(exercise.movementPattern)} · ${escapeHtml(exercise.equipment)}</p><button class="button button-primary compact" type="button" data-action="add-exercise" data-exercise-id="${exercise.id}">Add</button></article>`).join("")}</div>`);
    }

    function openCustomExercise() {
        openModal(`<div class="modal-header"><div><h2>Custom exercise</h2><p class="card-caption">Create a local custom exercise.</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><div class="field-grid"><div class="field"><label>Name</label><input id="customExerciseName" type="text" placeholder="Smith Incline Press"></div><div class="field"><label>Aliases</label><input id="customExerciseAliases" type="text" placeholder="Comma separated"></div><div class="field"><label>Primary muscle</label>${select("customExerciseMuscle", muscles(), "Chest")}</div><div class="field"><label>Movement pattern</label>${select("customExercisePattern", patterns(), "Horizontal Press")}</div><div class="field"><label>Equipment</label>${select("customExerciseEquipment", equipment(), "Machine")}</div><div class="field"><label>Difficulty</label>${select("customExerciseDifficulty", ["Beginner", "Intermediate", "Advanced"], "Intermediate")}</div></div><div class="field" style="margin-top:14px;"><label>Description</label><textarea id="customExerciseDescription" placeholder="Short explanation"></textarea></div><div class="form-actions" style="justify-content:flex-end;margin-top:16px;"><button class="button button-secondary" type="button" data-action="close-overlay">Cancel</button><button class="button button-primary" type="button" data-action="save-custom-exercise">Save exercise</button></div>`);
    }

    async function saveCustomExercise() {
        const name = inputValue("customExerciseName").trim();
        if (!name) {
            toast("Name required", "Add a clear exercise name.");
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
            category: "Custom",
            difficulty: inputValue("customExerciseDifficulty"),
            description: inputValue("customExerciseDescription") || `${name} is a custom ${pattern.toLowerCase()} movement focused on ${muscle.toLowerCase()}.`,
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
        toast("Custom exercise created", name);
    }

    function openProfileEditor() {
        const user = currentUser();
        openModal(`<div class="modal-header"><div><h2>Edit profile</h2><p class="card-caption">Only the active user can edit their profile.</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><div class="field-grid"><div class="field"><label>Name</label><input id="profileName" type="text" value="${escapeHtml(user.name)}"></div><div class="field"><label>Display name</label><input id="profileDisplayName" type="text" value="${escapeHtml(user.displayName)}"></div><div class="field"><label>Height</label><input id="profileHeight" type="number" value="${user.height}"></div><div class="field"><label>Bodyweight</label><input id="profileBodyweight" type="number" step="0.1" value="${user.bodyweight}"></div><div class="field"><label>Training goal</label><input id="profileGoal" type="text" value="${escapeHtml(user.trainingGoal)}"></div><div class="field"><label>Experience</label><input id="profileExperience" type="text" value="${escapeHtml(user.trainingExperience)}"></div><div class="field"><label>Favorite muscle</label>${select("profileMuscle", muscles(), user.favoriteMuscleGroup)}</div><div class="field"><label>Gender</label>${select("profileGender", ["male", "female"], user.gender)}</div></div><div class="field-grid" style="margin-top:14px;"><div class="field"><label>Bodyweight date</label><input id="bodyweightDate" type="date" value="${dateInput(new Date())}"></div><div class="field"><label>Add bodyweight entry</label><input id="bodyweightValue" type="number" step="0.1" value="${user.bodyweight}"></div></div><div class="form-actions" style="justify-content:flex-end;margin-top:16px;"><button class="button button-secondary" type="button" data-action="close-overlay">Cancel</button><button class="button button-primary" type="button" data-action="save-profile">Save profile</button></div>`);
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
        toast("Profile saved", user.displayName);
    }

    async function saveBodyweight(shouldRender = true) {
        const value = numberValue("bodyweightValue", 0);
        if (!value) {
            return;
        }
        state.database.bodyweightEntries.push({ id: createId("bodyweight"), userId: currentUser().id, date: inputValue("bodyweightDate") || dateInput(new Date()), bodyweight: value, notes: "Manual entry" });
        currentUser().bodyweight = value;
        if (shouldRender) {
            await persist();
            closeOverlay();
            renderSection();
        }
    }

    async function startFromTemplate(templateId, status) {
        const existing = activeWorkoutFor(currentUser().id);
        if (status === "active" && existing && !confirm("You already have an active workout. Finish it and start a new one?")) {
            return;
        }
        if (status === "active" && existing) {
            existing.status = "completed";
            existing.finishedAt = new Date().toISOString();
        }
        const workoutItem = createTemplateWorkout(currentUser().id, templateById(templateId), status, dateInput(new Date()), state.database.exercises);
        state.database.workouts.push(workoutItem);
        await persist();
        closeOverlay();
        navigate(status === "active" ? "workout" : "calendar");
        toast(status === "active" ? "Workout started" : "Workout planned", workoutItem.title);
    }

    async function addExercise(exerciseId) {
        const active = activeWorkoutFor(currentUser().id);
        if (!active) {
            toast("Start a workout first", "Create an active workout before adding exercises.");
            return;
        }
        const exercise = exerciseById(exerciseId);
        active.exercises.push({ id: createId("workout-exercise"), exerciseId, order: active.exercises.length + 1, notes: suggestionNote(currentUser().id, exerciseId), sets: suggestedSets(exercise) });
        active.updatedAt = new Date().toISOString();
        await persist();
        closeOverlay();
        navigate("workout");
        toast("Exercise added", exercise.name);
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
        toast("Set duplicated", "Previous set was copied.");
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
            toast("Set completed", `Rest timer: ${seconds(set.restSeconds || 90)}`);
        }
        renderSection();
    }

    async function deleteSet(workoutExerciseId, setId) {
        const workoutExercise = activeWorkoutExercise(workoutExerciseId);
        if (!workoutExercise || !confirm("Delete this set?")) {
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
        toast("Workout completed", "PRs and achievements were recalculated.");
    }

    async function addCardioToWorkout() {
        const active = activeWorkoutFor(currentUser().id);
        if (!active) {
            return;
        }
        active.cardioSessions.push(createCardio(1));
        await persist();
        renderSection();
        toast("Cardio added", "Conditioning block added.");
    }

    async function switchUser(userId) {
        state.database.currentUserId = userId;
        state.profileUserId = userId;
        await persist();
        closeOverlay();
        renderSection();
        toast("Active user switched", userById(userId).displayName);
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
        openDrawer(`<div class="drawer-header"><div><h2>${escapeHtml(exercise.name)}</h2><p class="card-caption">${exercise.primaryMuscleGroup} · ${exercise.movementPattern} · ${exercise.equipment}</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div>${media(exercise)}<section class="panel" style="margin-top:14px;"><h3>Technique</h3>${ordered(exercise.techniqueSteps)}</section><section class="panel" style="margin-top:14px;"><h3>Performance</h3>${kpi([{ label: "Your best", value: currentBest ? `${number(currentBest.estimatedOneRepMax)} kg` : "—" }, { label: "Team best", value: teamBest ? `${number(teamBest.estimatedOneRepMax)} kg` : "—" }])}</section><section class="panel" style="margin-top:14px;"><h3>Related</h3><div class="workout-stack">${relatedExercises(exerciseId).slice(0, 3).map((item) => `<button class="nav-button" type="button" data-action="open-exercise" data-exercise-id="${item.id}"><span>${escapeHtml(item.name)}</span><strong class="nav-badge">${escapeHtml(item.primaryMuscleGroup)}</strong></button>`).join("")}</div></section>`);
    }

    function openWorkout(workoutId) {
        const workoutItem = state.database.workouts.find((item) => item.id === workoutId);
        const owner = userById(workoutItem.userId);
        const readonly = workoutItem.userId !== currentUser().id;
        openDrawer(`<div class="drawer-header"><div><h2>${escapeHtml(workoutItem.title)}</h2><p class="card-caption">${escapeHtml(owner.displayName)} · ${formatDate(workoutItem.date)} · ${capitalize(workoutItem.status)}</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div>${readonly ? `<div class="readonly-layer">Read-only: another user's workout.</div>` : ""}${kpi([{ label: "Volume kg", value: number(workoutVolume(workoutItem)) }, { label: "Minutes", value: duration(workoutItem) }, { label: "Exercises", value: workoutItem.exercises.length }])}<div class="workout-stack" style="margin-top:14px;">${workoutItem.exercises.map((workoutExercise) => `<article class="panel"><h3>${escapeHtml(exerciseById(workoutExercise.exerciseId).name)}</h3><p class="card-caption">${workoutExercise.sets.length} sets · ${number(exerciseVolume(workoutExercise))} kg</p><div class="tag-row">${workoutExercise.sets.map((set) => `<span class="chip">${capitalize(set.type)} · ${set.weight} × ${set.repetitions}</span>`).join("")}</div></article>`).join("")}</div>`);
    }

    function openStandards() {
        openModal(`<div class="modal-header"><div><h2>Strength standards</h2><p class="card-caption">Demo configurable standards. Not official final truth.</p></div><button class="icon-button" type="button" data-action="close-overlay"><i data-lucide="x"></i></button></div><div class="table-wrap"><table><thead><tr><th>Exercise</th><th>Gender</th><th>BW</th><th>Level</th><th>Required</th><th>Source</th></tr></thead><tbody>${state.database.strengthStandards.slice(0, 42).map((standard) => `<tr><td>${escapeHtml(exerciseById(standard.exerciseId).name)}</td><td>${standard.gender}</td><td>${standard.bodyweightMin}-${standard.bodyweightMax}</td><td>${rankLabel(standard.level)}</td><td>${standard.requiredWeight} kg × ${standard.repetitions}</td><td>${escapeHtml(standard.sourceName)}</td></tr>`).join("")}</tbody></table></div>`);
    }

    function requestNotifications() {
        if (!("Notification" in window)) {
            toast("Notifications unavailable", "Browser notifications are not supported here.");
            return;
        }
        Notification.requestPermission().then((permission) => toast("Notification permission", permission));
    }

    function exportData() {
        const blob = new Blob([JSON.stringify(state.database, null, 4)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `gym-os-export-${dateInput(new Date())}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        toast("Data exported", "JSON file downloaded.");
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
            toast("Data imported", "Local database updated.");
        } catch (error) {
            console.error(error);
            toast("Import failed", "The JSON structure is not valid for Gym OS.");
        }
    }

    async function resetData() {
        if (!confirm("Reset all local demo data?")) {
            return;
        }
        await storage.reset();
        state.database = createSeedDatabase();
        state.profileUserId = state.database.currentUserId;
        await persist();
        renderSection();
        toast("Demo data reset", "Fresh local database created.");
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
        return `<article class="activity-item"><div class="activity-dot"></div><div><strong>${escapeHtml(record.exercise.name)}</strong><p class="card-caption">${number(record.estimatedOneRepMax)} kg estimated 1RM · ${record.weight} kg × ${record.repetitions} · ${formatDate(record.date)}</p></div></article>`;
    }

    function templateCard(template) {
        return `<article class="template-card"><div class="card-header"><div><h3>${escapeHtml(template.title)}</h3><p class="card-caption">${escapeHtml(template.description)}</p></div><span class="badge accent">${template.exerciseNames.length || "Free"}</span></div><div class="tag-row" style="margin:12px 0;">${template.exerciseNames.slice(0, 4).map((name) => `<span class="chip">${escapeHtml(name)}</span>`).join("")}</div><div class="inline-actions"><button class="button button-primary compact" type="button" data-action="start-template" data-template-id="${template.id}">Start</button><button class="button button-secondary compact" type="button" data-action="plan-template" data-template-id="${template.id}">Plan</button></div></article>`;
    }

    function exerciseCard(exercise) {
        return `<article class="exercise-card" data-action="open-exercise" data-exercise-id="${exercise.id}"><div class="card-header"><div><h3>${escapeHtml(exercise.name)}</h3><p class="card-caption">${escapeHtml(exercise.description)}</p></div>${exercise.isCustom ? `<span class="badge accent">Custom</span>` : ""}</div><div class="tag-row"><span class="chip">${escapeHtml(exercise.primaryMuscleGroup)}</span><span class="chip">${escapeHtml(exercise.movementPattern)}</span><span class="chip">${escapeHtml(exercise.equipment)}</span></div></article>`;
    }

    function userCard(user) {
        const summary = userStats(user.id);
        const isCurrent = user.id === currentUser().id;
        return `<article class="user-card" data-action="view-user" data-user-id="${user.id}"><div class="list-row">${avatar(user)}<div><h3>${escapeHtml(user.displayName)}</h3><p class="card-caption">${escapeHtml(user.trainingGoal)}</p></div></div><div style="margin-top:14px;">${kpi([{ label: "Workouts", value: summary.completedWorkouts }, { label: "Volume", value: number(summary.totalVolume) }, { label: "Cardio", value: summary.cardioMinutes }])}</div><div class="tag-row" style="margin-top:12px;"><span class="badge ${isCurrent ? "unlocked" : "locked"}">${isCurrent ? "Current" : "Read only"}</span><span class="chip">${escapeHtml(mainRank(user.id))}</span></div></article>`;
    }

    function userSwitcherCard(user) {
        const isCurrent = user.id === currentUser().id;
        return `<article class="user-card"><div class="list-row">${avatar(user, "small")}<div><h3>${escapeHtml(user.displayName)}</h3><p class="card-caption">${escapeHtml(user.name)}</p></div></div><button class="button ${isCurrent ? "button-secondary" : "button-primary"} compact" type="button" data-action="switch-user" data-user-id="${user.id}" style="margin-top:12px;" ${isCurrent ? "disabled" : ""}>${isCurrent ? "Active" : "Switch"}</button></article>`;
    }

    function achievementCard(item) {
        const percent = Math.min(100, Math.round(item.currentValue / item.target * 100));
        return `<article class="achievement-card ${item.isUnlocked ? "" : "locked"}"><div class="achievement-icon">${item.icon}</div><div class="card-header"><h3>${escapeHtml(item.title)}</h3><span class="badge ${item.isUnlocked ? "unlocked" : "locked"}">${item.isUnlocked ? "Unlocked" : "Locked"}</span></div><p class="card-caption">${escapeHtml(item.description)}</p><div class="progress-track" style="margin:12px 0 8px;"><div class="progress-fill" style="width:${percent}%;"></div></div><p class="profile-meta">${number(Math.min(item.currentValue, item.target))}/${number(item.target)} · ${item.unlockedAt ? `Unlocked ${formatDate(item.unlockedAt)}` : item.category}</p></article>`;
    }

    function rankCard(user, exercise) {
        const rank = rankingFor(user.id, exercise.id);
        const current = rank.currentLevel ? rankLabel(rank.currentLevel.level) : "No result yet";
        const next = rank.nextLevel ? rankLabel(rank.nextLevel.level) : "Top level";
        return `<article class="ranking-card"><div class="card-header"><div><h3>${escapeHtml(exercise.name)}</h3><p class="card-caption">${exercise.primaryMuscleGroup} · ${exercise.movementPattern}</p></div><span class="badge accent">${current}</span></div>${kpi([{ label: "Best approx", value: rank.best ? `${number(rank.best.estimatedOneRepMax)} kg` : "—" }, { label: "Next req.", value: rank.nextLevel ? `${number(rank.nextLevel.requiredWeight)} kg` : "—" }])}<div class="progress-track" style="margin-top:12px;"><div class="progress-fill" style="width:${Math.min(100, rank.progress)}%;"></div></div><p class="profile-meta" style="margin-top:8px;">Next: ${next} · ${Math.round(rank.progress)}% · ${rank.best?.isEstimated ? "estimated value" : "direct value"}</p></article>`;
    }

    function timerCard() {
        const progress = state.timer.running ? Math.max(0, Math.min(100, (1 - state.timer.remaining / state.timer.duration) * 100)) : 0;
        return `<section class="card"><div class="timer-card"><div><h2>Rest timer</h2><p class="card-caption">Starts automatically after completing a set.</p></div><div class="timer-ring" style="--timer-progress:${progress}%"><div class="timer-value">${seconds(state.timer.remaining)}</div></div></div></section>`;
    }

    function media(exercise) {
        if (exercise.mediaUrl && exercise.mediaType !== "none") {
            return `<div class="media-placeholder"><img src="${escapeHtml(exercise.mediaUrl)}" alt="${escapeHtml(exercise.name)} demonstration"></div>`;
        }
        return `<div class="media-placeholder"><div class="media-placeholder-label">Future GIF/WebP demo slot · animated placeholder</div></div>`;
    }

    function emptyInline(title, caption) {
        return `<div class="empty-state"><i data-lucide="sparkles"></i><h3>${escapeHtml(title)}</h3><p>${escapeHtml(caption)}</p></div>`;
    }

    function activityFeed() {
        return state.database.workouts.filter((item) => item.status === "completed").sort(byDateDesc).slice(0, 8).map((workoutItem) => {
            const owner = userById(workoutItem.userId);
            return `<article class="activity-item"><div class="activity-dot"></div><div style="flex:1;"><strong>${escapeHtml(owner.displayName)} completed ${escapeHtml(workoutItem.title)}</strong><p class="card-caption">${formatDate(workoutItem.date)} · ${number(workoutVolume(workoutItem))} kg · ${workoutItem.exercises.length} exercises</p></div><button class="button button-secondary compact" type="button" data-action="open-workout" data-workout-id="${workoutItem.id}">Open</button></article>`;
        }).join("");
    }

    function renderCalendar() {
        const container = element("calendarContainer");
        if (!window.FullCalendar) {
            container.innerHTML = emptyInline("Calendar library unavailable", "Connect internet for FullCalendar CDN.");
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
            events: state.database.workouts.map((workoutItem) => ({ id: workoutItem.id, title: `${userById(workoutItem.userId).displayName}: ${workoutItem.title}`, start: workoutItem.date, extendedProps: { workoutId: workoutItem.id } })),
            dateClick: (info) => planOnDate(info.dateStr),
            eventClick: (info) => openWorkout(info.event.extendedProps.workoutId)
        });
        state.calendar.render();
    }

    async function planOnDate(date) {
        const workoutItem = createTemplateWorkout(currentUser().id, templateById("custom"), "planned", date, state.database.exercises);
        workoutItem.title = "Custom planned workout";
        state.database.workouts.push(workoutItem);
        await persist();
        renderSection();
        toast("Workout planned", formatDate(date));
    }

    function weeklyVolumeChart(id, userId) {
        const labels = Array.from({ length: 7 }, (_, index) => dateInput(addDays(startWeek(new Date()), index)));
        const data = labels.map((label) => workoutsFor(userId).filter((item) => item.status === "completed" && item.date === label).reduce((sum, item) => sum + workoutVolume(item), 0));
        barChart(id, labels.map(shortDate), data, "Volume kg");
    }

    function volumeChart(id, userId) {
        const workouts = filteredWorkouts(userId ? workoutsFor(userId) : state.database.workouts).filter((item) => item.status === "completed").sort(byDateAsc).slice(-14);
        barChart(id, workouts.map((item) => shortDate(item.date)), workouts.map(workoutVolume), "Volume kg");
    }

    function muscleDistributionChart(id, userId) {
        const map = muscleSetMap(filteredWorkouts(userId ? workoutsFor(userId) : state.database.workouts).filter((item) => item.status === "completed"));
        doughnutChart(id, [...map.keys()], [...map.values()]);
    }

    function bodyweightChart(id, userId = currentUser().id) {
        const entries = state.database.bodyweightEntries.filter((item) => item.userId === userId).sort(byDateAsc);
        lineChart(id, entries.map((item) => shortDate(item.date)), entries.map((item) => item.bodyweight), "Bodyweight kg");
    }

    function cardioChart(id, userId = currentUser().id) {
        const workouts = workoutsFor(userId).filter((item) => item.status === "completed").sort(byDateAsc).slice(-10);
        barChart(id, workouts.map((item) => shortDate(item.date)), workouts.map((item) => item.cardioSessions.reduce((sum, session) => sum + session.durationMinutes, 0)), "Cardio min");
    }

    function progressChart(id, userId) {
        const exerciseId = state.filters.statsExerciseId !== "all" ? state.filters.statsExerciseId : exerciseByName("Bench Press").id;
        const points = progressData(userId, exerciseId);
        lineChart(id, points.map((point) => shortDate(point.date)), points.map((point) => point.value), "Approx 1RM");
    }

    function maxTrendChart(id, userId) {
        const points = progressData(userId, exerciseByName("Bench Press").id);
        lineChart(id, points.map((point) => shortDate(point.date)), points.map((point) => point.value), "Bench approx 1RM");
    }

    function consistencyChart(id, userId) {
        const workouts = filteredWorkouts(userId ? workoutsFor(userId) : state.database.workouts).filter((item) => item.status === "completed").sort(byDateAsc).slice(-10);
        barChart(id, workouts.map((item) => shortDate(item.date)), workouts.map((item) => item.exercises.length), "Exercises");
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

    function userStats(userId) {
        const workouts = filteredWorkouts(workoutsFor(userId));
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

    function teamStats() {
        const userSummaries = state.database.users.map((user) => userStats(user.id));
        const workouts = filteredWorkouts(state.database.workouts);
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
        const bench = exerciseByName("Bench Press");
        const squat = exerciseByName("Barbell Squat");
        const pullups = exerciseByName("Pull-ups");
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
        const bench = exerciseByName("Bench Press");
        const lastBench = lastUsed(bench.id, userId);
        const days = lastBench ? dayDiff(new Date(), new Date(lastBench)) : null;
        const rank = rankingFor(userId, bench.id);
        const chestSets = workoutsFor(userId).filter((item) => item.status === "completed" && new Date(item.date) >= startWeek(new Date())).flatMap((item) => item.exercises).filter((item) => exerciseById(item.exerciseId).primaryMuscleGroup === "Chest").flatMap((item) => item.sets).filter((set) => set.isCompleted).length;
        return [
            { title: `Chest work: ${chestSets} sets`, caption: chestSets ? "Chest was trained this week." : "Chest has not been trained this week." },
            { title: days === null ? "Bench not logged yet" : `Bench trained ${days} days ago`, caption: "Useful for planning frequency and recovery." },
            { title: rank.nextLevel ? "Next rank is visible" : "Top demo rank reached", caption: rank.nextLevel ? `${number(rank.nextLevel.requiredWeight)} kg estimated 1RM for ${rankLabel(rank.nextLevel.level)}.` : "Update standards later for advanced levels." },
            { title: summary.weekVolume ? "Volume is moving" : "Start the week", caption: `${number(summary.weekVolume)} kg completed this week.` },
            { title: summary.warmupSets >= 10 ? "Warm-up discipline" : "Warm-up helper", caption: summary.warmupSets >= 10 ? "Warm-up habit is visible in your logs." : "Add warm-up sets before main lifts." }
        ];
    }

    function suggestedSets(exercise) {
        if (exercise.movementPattern === "Cardio") {
            return [];
        }
        const currentUserId = state.database?.currentUserId;
        const previous = currentUserId ? previousPerformance(currentUserId, exercise.id) : null;
        const weight = previous?.weight || seedWeight(exercise.name, 0);
        if (exercise.movementPattern === "Core") {
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
        return previous ? `Last performance: ${previous.weight} kg × ${previous.repetitions} on ${formatDate(previous.date)}.` : "New movement in this program.";
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
            return "No rank yet";
        }
        return rankLabel(levels.sort((left, right) => rankOrder.indexOf(right) - rankOrder.indexOf(left))[0]);
    }

    function rankLabel(level) {
        return ({ beginner: "Beginner", novice: "Novice", third_class: "3rd Class", second_class: "2nd Class", first_class: "1st Class", candidate_master: "Candidate Master", master: "Master" })[level] || capitalize(level);
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
                toast("Rest finished", "Ready for the next set.");
                if ("Notification" in window && Notification.permission === "granted") {
                    new Notification("Gym OS", { body: "Rest finished. Ready for the next set." });
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

    function seedWeight(name, index) {
        const weights = { "Bench Press": 72, "Incline Dumbbell Press": 28, "Chest Press Machine": 78, "Cable Fly": 18, "Pull-ups": 78, "Lat Pulldown": 67, "Barbell Row": 72, "Seated Cable Row": 64, "Shoulder Press": 45, "Lateral Raise": 12, "Rear Delt Fly": 10, "Barbell Squat": 92, "Leg Press": 180, "Leg Extension": 56, "Romanian Deadlift": 82, "Leg Curl": 48, "Calf Raise": 72, "Barbell Curl": 32, "Dumbbell Curl": 16, "Hammer Curl": 18, "Triceps Pushdown": 38, "Overhead Triceps Extension": 32, "Plank": 0, "Hanging Leg Raise": 0 };
        return round((weights[name] || 25) + index * 0.7, 1);
    }

    function todayLabel(userId) {
        const item = workoutsFor(userId).find((workoutItem) => workoutItem.date === dateInput(new Date()));
        return item ? item.title : "Plan today";
    }

    function todayCaption(userId) {
        const item = workoutsFor(userId).find((workoutItem) => workoutItem.date === dateInput(new Date()));
        return item ? capitalize(item.status) : "No workout logged yet";
    }

    function muscles() {
        return ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Quads", "Hamstrings", "Glutes", "Calves", "Abs", "Forearms", "Full Body"];
    }

    function patterns() {
        return ["Horizontal Press", "Vertical Press", "Horizontal Pull", "Vertical Pull", "Squat", "Hinge", "Lunge", "Curl", "Extension", "Raise", "Carry", "Rotation", "Core", "Cardio"];
    }

    function equipment() {
        return ["Barbell", "Dumbbell", "Machine", "Cable", "Bodyweight", "Smith Machine", "Kettlebell", "Resistance Band", "Other"];
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
        return value ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)) : "—";
    }

    function shortDate(value) {
        return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value));
    }

    function seconds(value) {
        return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
    }

    function number(value) {
        return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(Number(value) || 0);
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
