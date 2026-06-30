// Muscle-group icons (body silhouette with the active muscle highlighted).
// Provided assets in /assets/muscles, inlined at build time via Vite ?raw so they
// bundle (offline-safe) and can be injected directly with innerHTML.
import all from "../assets/muscles/all.svg?raw";
import chest from "../assets/muscles/chest.svg?raw";
import back from "../assets/muscles/back.svg?raw";
import triceps from "../assets/muscles/triceps.svg?raw";
import biceps from "../assets/muscles/biceps.svg?raw";
import shoulders from "../assets/muscles/shoulders.svg?raw";
import abs from "../assets/muscles/abs.svg?raw";
import hamstrings from "../assets/muscles/hamstrings.svg?raw";
import quads from "../assets/muscles/quads.svg?raw";
import calves from "../assets/muscles/calves.svg?raw";
import forearms from "../assets/muscles/forearms.svg?raw";

// Keyed by the muscle-group name as stored on exercises (Ukrainian). "all" is the
// pseudo-group for the "Усі м'язи" (no filter) option.
export const muscleIcons = {
    all,
    "Груди": chest,
    "Спина": back,
    "Трицепс": triceps,
    "Біцепс": biceps,
    "Плечі": shoulders,
    "Прес": abs,
    "Квадрицепс": quads,
    "Задня поверхня стегна": hamstrings,
    "Литки": calves,
    "Передпліччя": forearms
};
