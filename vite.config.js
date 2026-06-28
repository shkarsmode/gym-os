import { defineConfig } from "vite";

// Single-page app: index.html at the project root is the only entry.
// public/ (sw.js, manifest.json, icons, favicon) is copied to the build root as-is.
export default defineConfig({
    base: "/",
    build: {
        outDir: "dist",
        emptyOutDir: true
    },
    server: {
        port: 5500,
        host: true,
        strictPort: false
    },
    preview: {
        port: 5500,
        host: true,
        strictPort: false
    }
});
