// Translation catalog layer discovery and merge.
//
// A build's translations come from ordered layers: each dependency library
// that ships a locales/ directory, in transitive dependency order (a library
// before any library that depends on it), then the consuming project's own
// locales/ last. Later layers win on merge, so the app overrides its
// libraries and a library overrides its own dependencies.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

// Parse a JSON catalog file, or null when it does not exist.
export function readCatalog(path) {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, "utf8"))
}

// Dependency names declared in a pxt.json, or [] when the file is absent.
function readDeps(pxtJsonPath) {
    if (!existsSync(pxtJsonPath)) return []
    const pxt = JSON.parse(readFileSync(pxtJsonPath, "utf8"))
    return Object.keys(pxt.dependencies || {})
}

// The ordered locale layers for a project rooted at `root`: every dependency
// module (resolved under pxt_modules) that carries a locales/ directory, in
// transitive dependency order, followed by the project's own locales/ as the
// final, highest-priority layer named "app". Each layer is { name, localesDir }.
export function discoverLayers(root) {
    const modulesDir = join(root, "pxt_modules")
    const seen = new Set()
    const layers = []
    const visit = name => {
        if (seen.has(name)) return
        seen.add(name)
        const modDir = join(modulesDir, name)
        for (const dep of readDeps(join(modDir, "pxt.json"))) visit(dep)
        const localesDir = join(modDir, "locales")
        if (existsSync(localesDir)) layers.push({ name, localesDir })
    }
    for (const dep of readDeps(join(root, "pxt.json"))) visit(dep)
    layers.push({ name: "app", localesDir: join(root, "locales") })
    return layers
}

// Merge the per-language catalog of every layer into one table, later layers
// winning. Returns the merged table and per-layer info (count is null when the
// layer has no file for the language).
export function mergeLayers(layers, lang) {
    const merged = {}
    const info = []
    for (const layer of layers) {
        const path = join(layer.localesDir, lang + ".json")
        const cat = readCatalog(path)
        if (cat === null) {
            info.push({ name: layer.name, path, count: null })
            continue
        }
        for (const k of Object.keys(cat)) merged[k] = cat[k]
        info.push({ name: layer.name, path, count: Object.keys(cat).length })
    }
    return { merged, layers: info }
}
