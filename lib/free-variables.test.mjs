import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAst } from "rollup/parseAst";

/**
 * Catches a reference to a name that does not exist in any enclosing scope.
 *
 * This exists because exactly that bug shipped to production and silently disabled a
 * whole feature: the live-stream code read `authToken`, which is a local inside
 * ApiClient.request and not a module-level binding, so the very first call threw
 * ReferenceError and the connection was never opened. Nothing caught it — the build
 * succeeds (a bundler assumes an unresolved name is a global), the unit tests do not
 * execute app.js, and the API tests went straight to the server over HTTP.
 *
 * The check is deliberately structural rather than a full linter: it only asks whether
 * every identifier read resolves to a declaration somewhere up the scope chain, or to a
 * known global.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

// Everything the app legitimately reaches for on the platform or from a script tag.
const GLOBALS = new Set([
    // language
    "globalThis", "undefined", "NaN", "Infinity", "Object", "Array", "String", "Number",
    "Boolean", "Symbol", "Math", "JSON", "Date", "RegExp", "Error", "TypeError",
    "RangeError", "SyntaxError", "Map", "Set", "WeakMap", "WeakSet", "Promise", "Proxy",
    "Reflect", "BigInt", "Intl", "parseInt", "parseFloat", "isNaN", "isFinite", "escape",
    "unescape", "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI",
    "Function", "arguments", "structuredClone", "queueMicrotask",
    "ArrayBuffer", "SharedArrayBuffer", "DataView", "Uint8Array", "Uint8ClampedArray",
    "Uint16Array", "Uint32Array", "Int8Array", "Int16Array", "Int32Array",
    "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array",
    // DOM + browser
    "window", "document", "navigator", "location", "history", "screen", "localStorage",
    "sessionStorage", "indexedDB", "console", "fetch", "Headers", "Request", "Response",
    "FormData", "URL", "URLSearchParams", "Blob", "File", "FileReader", "Image", "Audio",
    "AbortController", "AbortSignal", "TextEncoder", "TextDecoder", "CSS", "Notification",
    "setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame",
    "cancelAnimationFrame", "requestIdleCallback", "matchMedia", "getComputedStyle",
    "alert", "confirm", "prompt", "MutationObserver", "IntersectionObserver",
    "ResizeObserver", "CustomEvent", "Event", "EventTarget", "DOMParser", "XMLHttpRequest",
    "HTMLElement", "Element", "Node", "NodeList", "DocumentFragment", "Worker",
    "ServiceWorker", "ServiceWorkerRegistration", "PushManager", "atob", "btoa", "crypto",
    "performance", "self", "top", "parent", "frames", "close", "open", "scrollTo",
    "scrollBy", "getSelection", "customElements", "ShadowRoot", "AudioContext",
    "webkitAudioContext", "speechSynthesis", "SpeechSynthesisUtterance", "Option",
    // loaded from a script tag rather than imported
    "lucide", "FullCalendar", "Chart"
]);

function declaredNames(node, out) {
    if (!node) {
        return;
    }
    switch (node.type) {
        case "Identifier":
            out.push(node.name);
            return;
        case "ObjectPattern":
            node.properties.forEach((property) => declaredNames(property.value || property.argument, out));
            return;
        case "ArrayPattern":
            node.elements.forEach((element) => declaredNames(element, out));
            return;
        case "AssignmentPattern":
            declaredNames(node.left, out);
            return;
        case "RestElement":
            declaredNames(node.argument, out);
            return;
        default:
    }
}

// Names introduced by a node into the scope it sits in.
function bindingsOf(node) {
    const names = [];
    switch (node.type) {
        case "VariableDeclaration":
            node.declarations.forEach((declaration) => declaredNames(declaration.id, names));
            break;
        case "FunctionDeclaration":
        case "ClassDeclaration":
            if (node.id) {
                names.push(node.id.name);
            }
            break;
        case "ImportDeclaration":
            node.specifiers.forEach((specifier) => names.push(specifier.local.name));
            break;
        default:
    }
    return names;
}

const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

/** Every child node, with the ones that are never variable reads already filtered out. */
function childNodes(node) {
    const children = [];
    for (const key of Object.keys(node)) {
        if (key === "type" || key === "start" || key === "end" || key === "loc") {
            continue;
        }
        // A property name is not a variable: `a.b` reads `a`, never `b`.
        if (node.type === "MemberExpression" && key === "property" && !node.computed) {
            continue;
        }
        if ((node.type === "Property" || node.type === "PropertyDefinition" || node.type === "MethodDefinition")
            && key === "key" && !node.computed) {
            continue;
        }
        // Labels, and the remote half of an import/export specifier, share the Identifier
        // node type but name no binding.
        if ((node.type === "LabeledStatement" || node.type === "BreakStatement" || node.type === "ContinueStatement")
            && key === "label") {
            continue;
        }
        if (node.type === "ImportSpecifier" && key === "imported") {
            continue;
        }
        if ((node.type === "ExportSpecifier") && (key === "local" || key === "exported")) {
            continue;
        }
        const value = node[key];
        if (Array.isArray(value)) {
            value.forEach((item) => {
                if (item && typeof item.type === "string") {
                    children.push(item);
                }
            });
        } else if (value && typeof value.type === "string") {
            children.push(value);
        }
    }
    return children;
}

function collectFreeVariables(source) {
    const ast = parseAst(source);
    const free = [];

    const walk = (node, scopes) => {
        let current = scopes;

        // A node that opens a scope gets its own frame, pre-filled with what it binds.
        if (FUNCTION_TYPES.has(node.type)) {
            const own = new Set();
            node.params.forEach((param) => {
                const names = [];
                declaredNames(param, names);
                names.forEach((name) => own.add(name));
            });
            if (node.type === "FunctionExpression" && node.id) {
                own.add(node.id.name);
            }
            // `arguments` exists in every non-arrow function.
            if (node.type !== "ArrowFunctionExpression") {
                own.add("arguments");
            }
            current = [...scopes, own];
            hoistInto(node.body, own);
        } else if (node.type === "BlockStatement" || node.type === "Program" || node.type === "StaticBlock") {
            const own = new Set();
            current = [...scopes, own];
            hoistInto(node, own);
        } else if (node.type === "CatchClause" && node.param) {
            const own = new Set();
            const names = [];
            declaredNames(node.param, names);
            names.forEach((name) => own.add(name));
            current = [...scopes, own];
        } else if (node.type === "ForStatement" || node.type === "ForOfStatement" || node.type === "ForInStatement") {
            const own = new Set();
            const init = node.init || node.left;
            if (init && init.type === "VariableDeclaration") {
                bindingsOf(init).forEach((name) => own.add(name));
            }
            current = [...scopes, own];
        }

        if (node.type === "Identifier") {
            const name = node.name;
            const known = GLOBALS.has(name) || current.some((scope) => scope.has(name));
            if (!known) {
                free.push(name);
            }
            return;
        }

        childNodes(node).forEach((child) => walk(child, current));
    };

    // Declarations are visible to the whole scope regardless of where they appear, so they
    // are gathered before walking rather than as the walk passes them.
    const hoistInto = (scopeNode, own) => {
        const body = Array.isArray(scopeNode) ? scopeNode : (scopeNode.body || []);
        const statements = Array.isArray(body) ? body : [body];
        const visit = (node) => {
            if (!node || typeof node.type !== "string") {
                return;
            }
            bindingsOf(node).forEach((name) => own.add(name));
            // `var` and function declarations climb out of blocks; recurse into anything
            // that is not itself a new function scope.
            if (FUNCTION_TYPES.has(node.type) || node.type === "ClassDeclaration") {
                return;
            }
            childNodes(node).forEach(visit);
        };
        statements.forEach(visit);
    };

    walk(ast, []);
    return [...new Set(free)];
}

const files = [
    "app.js",
    ...fs.readdirSync(path.join(root, "lib"))
        .filter((name) => name.endsWith(".js"))
        .map((name) => path.join("lib", name)),
    ...fs.readdirSync(path.join(root, "components"))
        .filter((name) => name.endsWith(".js"))
        .map((name) => path.join("components", name))
];

for (const file of files) {
    test(`${file} references no name that does not exist`, () => {
        const source = fs.readFileSync(path.join(root, file), "utf8");
        const free = collectFreeVariables(source);
        assert.deepEqual(
            free,
            [],
            `${file} reads ${free.join(", ")} — declared nowhere in scope and not a known global. `
            + "A bundler treats these as globals and the build succeeds; the browser throws ReferenceError "
            + "on the first call. If one of these is a real global, add it to GLOBALS in this file."
        );
    });
}
