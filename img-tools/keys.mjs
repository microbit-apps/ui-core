// The app's key table: the keys it looks images up by, and nothing else.
//
// Shape (both sections optional):
//
//   {
//     "numeric": { "16": "thermometer", "180": "thermometer" },
//     "names":   { "delete": "btn_delete" }
//   }
//
// `numeric` maps the app's own small-integer keys to image names, for a key
// space the app already has and cannot renumber. `names` lists every string key
// the app looks an image up by, including one that equals its image's name
// (`"sad": "sad"`); the emitted name index holds exactly the keys listed here.
//
// An image is named by the const that declares it. Where two packages declare
// the same const name, write the namespace too (`"ui.microphone"`) to say which
// one is meant; a bare name resolves to the app's.
//
// The table holds no pixels. Images are declared where they are drawn, with
// `//% packable`, and the two are joined by name.

import { existsSync, readFileSync } from "node:fs"

/** An empty key table: the app declares no keys of its own. */
export function emptyKeyTable() {
    return { numeric: {}, names: {} }
}

/**
 * Reads and validates a key table, returning an empty one when the file does
 * not exist. Throws on a malformed table, naming the entry at fault.
 */
export function readKeyTable(path) {
    if (!existsSync(path)) return emptyKeyTable()

    let raw
    try {
        raw = JSON.parse(readFileSync(path, "utf8"))
    } catch (e) {
        throw new Error(`key table ${path} is not valid JSON: ${e.message}`)
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new Error(`key table ${path} must be a JSON object`)

    const table = emptyKeyTable()
    for (const [key, value] of Object.entries(raw.numeric || {})) {
        if (!/^\d+$/.test(key))
            throw new Error(`key table ${path}: numeric key "${key}" is not a non-negative integer`)
        if (typeof value !== "string" || value.length === 0)
            throw new Error(`key table ${path}: numeric key ${key} must name an image`)
        table.numeric[Number(key)] = value
    }
    for (const [key, value] of Object.entries(raw.names || {})) {
        if (key.indexOf(",") >= 0)
            throw new Error(`key table ${path}: string key "${key}" may not contain a comma`)
        if (typeof value !== "string" || value.length === 0)
            throw new Error(`key table ${path}: string key "${key}" must name an image`)
        table.names[key] = value
    }
    return table
}

/** Every image name the table refers to, deduplicated. */
export function referencedNames(table) {
    const names = new Set()
    for (const n of Object.values(table.numeric)) names.add(n)
    for (const n of Object.values(table.names)) names.add(n)
    return names
}
