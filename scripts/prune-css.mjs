// Removes CSS selectors (and then rules, @media blocks and @keyframes left empty) that
// target classes the app no longer renders. Run on purpose after removing UI:
//
//   node scripts/prune-css.mjs <class-prefix> [--apply]
//
// e.g. `node scripts/prune-css.mjs ux2` reports every selector that names a `ux2…` class
// nothing in app.js / index.html / lib / components produces any more. A token that only
// appears as an action name (data-action="…", an action-map key, a menu item's action) is
// not a class. Without --apply it only reports.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prefix = process.argv[2];
const apply = process.argv.includes("--apply");
if (!prefix || prefix.startsWith("--")) {
    console.error("usage: node scripts/prune-css.mjs <class-prefix> [--apply]");
    process.exit(2);
}

const sourceFiles = [
    path.join(root, "app.js"),
    path.join(root, "index.html"),
    ...fs.readdirSync(path.join(root, "lib")).filter((f) => f.endsWith(".js")).map((f) => path.join(root, "lib", f)),
    ...fs.readdirSync(path.join(root, "components")).filter((f) => f.endsWith(".js")).map((f) => path.join(root, "components", f))
];
const code = sourceFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");
const p = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const actionOnly = code
    .replace(new RegExp(`data-action="${p}[A-Za-z0-9_-]*"`, "g"), "")
    .replace(new RegExp(`"${p}[A-Za-z0-9_-]*":\\s`, "g"), "")
    .replace(new RegExp(`MenuItem\\("${p}[A-Za-z0-9_-]*"`, "g"), "MenuItem(")
    .replace(new RegExp(`action(?:\\.dataset\\.action)?\\s*===\\s*"${p}[A-Za-z0-9_-]*"`, "g"), "")
    .replace(new RegExp(`startsWith\\("${p}-"\\)`, "g"), "");
const alive = new Set(actionOnly.match(new RegExp(`${p}[A-Za-z0-9_-]*`, "g")) || []);
const dynamicPrefixes = [...code.matchAll(new RegExp(`(${p}[A-Za-z0-9_-]*-)\\$\\{`, "g"))].map((m) => m[1]);
const isAlive = (token) => alive.has(token) || dynamicPrefixes.some((d) => token.startsWith(d));
const tokenRe = new RegExp(`[.#](${p}[A-Za-z0-9_-]*)`, "g");
const selectorDead = (selector) => [...selector.matchAll(tokenRe)].some((m) => !isAlive(m[1]));

const cssPath = path.join(root, "styles.css");
const css = fs.readFileSync(cssPath, "utf8");
const ast = postcss.parse(css, { from: cssPath });
const removed = [];

ast.walkRules((rule) => {
    if (rule.parent && rule.parent.type === "atrule" && /keyframes$/i.test(rule.parent.name)) {
        return;
    }
    const keep = rule.selectors.filter((selector) => !selectorDead(selector));
    if (keep.length === rule.selectors.length) {
        return;
    }
    rule.selectors.filter((selector) => selectorDead(selector)).forEach((selector) => removed.push(selector));
    if (keep.length) {
        rule.selectors = keep;
    } else {
        rule.remove();
    }
});

// at-rules (@media, @supports) left with nothing but comments
let changed = true;
while (changed) {
    changed = false;
    ast.walkAtRules((atRule) => {
        if (/keyframes$/i.test(atRule.name) || !atRule.nodes) {
            return;
        }
        if (!atRule.nodes.some((node) => node.type !== "comment")) {
            atRule.remove();
            changed = true;
        }
    });
}

// @keyframes nothing animates with any more
const cssNow = ast.toString();
ast.walkAtRules(/keyframes$/i, (atRule) => {
    const name = atRule.params.trim();
    if (!name.startsWith(prefix)) {
        return;
    }
    const uses = (cssNow.match(new RegExp(`\\b${name}\\b`, "g")) || []).length;
    if (uses <= 1 && !code.includes(name)) {
        removed.push(`@keyframes ${name}`);
        atRule.remove();
    }
});

const out = ast.toString().replace(/\n{3,}/g, "\n\n");
console.log(`selectors removed: ${removed.length}; styles.css ${css.length} → ${out.length} chars`);
console.log(`still used ${prefix} classes: ${[...alive].filter((c) => c.startsWith(`${prefix}-`)).sort().join(" ")}`);
if (apply) {
    fs.writeFileSync(cssPath, out);
    console.log("written");
}
