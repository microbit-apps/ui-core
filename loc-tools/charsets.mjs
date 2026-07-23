// Generic per-language field data.
//
// Any layer (discovered exactly like translation catalogs) may ship
// locales/charsets.json:
//
//   { "<lang>": { "<fieldName>": "<string>", ... }, ... }
//
// Each field is a string of characters that a consuming library treats as
// per-language configuration -- for example a keyboard alphabet. The tooling
// is agnostic: it never interprets field names, only merges, validates, and
// emits them as `_loc.<fieldName>` assignments (see emit.mjs). The library that
// owns a field declares the matching `_loc` member.
//
// Language resolution per layer: the exact language key, else the base-language
// prefix (so "es" serves "es-ES"). Fields merge across layers per language,
// the app layer winning.

import { join } from "node:path"
import { readCatalog } from "./catalogs.mjs"
import { toHexCp } from "./fonts.mjs"

// The base-language prefix of a locale tag ("es" for "es-ES", "fr" for "fr").
function baseLang(lang) {
    const i = lang.indexOf("-")
    return i < 0 ? lang : lang.slice(0, i)
}

// Resolve the merged field set for a language across all layers. Returns an
// object mapping field name to its resolved string (empty when no layer ships
// data for the language).
export function resolveCharsets(layers, lang) {
    const merged = {}
    for (const layer of layers) {
        const data = readCatalog(join(layer.localesDir, "charsets.json"))
        if (!data) continue
        const entry = data[lang] || data[baseLang(lang)]
        if (!entry) continue
        for (const field of Object.keys(entry)) merged[field] = entry[field]
    }
    return merged
}

// Validate resolved field data. These are hard errors, never silent drops:
//   - a `<x>Lower`/`<x>Upper` field pair (both present) must have equal
//     code-point length;
//   - no field may repeat a code point within itself;
//   - every code point of every field must be present in the build font's
//     coverage.
export function validateCharsets(fields, fontCoverage, lang) {
    for (const [name, str] of Object.entries(fields)) {
        const seen = new Set()
        for (const ch of str) {
            const cp = ch.codePointAt(0)
            if (seen.has(cp))
                throw new Error(
                    `charsets: ${lang} field ${JSON.stringify(name)}: duplicate character ${ch} ${toHexCp(cp)}`,
                )
            seen.add(cp)
        }
    }

    for (const name of Object.keys(fields)) {
        if (!name.endsWith("Lower")) continue
        const upper = name.slice(0, -"Lower".length) + "Upper"
        if (fields[upper] === undefined) continue
        const lowerLen = Array.from(fields[name]).length
        const upperLen = Array.from(fields[upper]).length
        if (lowerLen !== upperLen)
            throw new Error(
                `charsets: ${lang} pair ${JSON.stringify(name)}/${JSON.stringify(upper)}: ` +
                    `code-point length ${lowerLen} != ${upperLen}`,
            )
    }

    for (const [name, str] of Object.entries(fields)) {
        for (const ch of str) {
            const cp = ch.codePointAt(0)
            if (!fontCoverage.has(cp))
                throw new Error(
                    `charsets: ${lang} field ${JSON.stringify(name)}: character ${ch} ${toHexCp(cp)} ` +
                        `not in build font coverage`,
                )
        }
    }
}
