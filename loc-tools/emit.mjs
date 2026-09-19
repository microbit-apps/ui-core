// Generation and restore of the app's loc.g.ts.
//
// loc.g.ts holds one shipped language's translation table (and any per-language
// field data) for a per-language build. It is a transient build intermediate:
// the generator writes a language's content, builds, and restores the default
// state afterward. The default state assigns nothing, so a vanilla build falls
// back to the source strings.

import { writeFileSync } from "node:fs"

// A generic assign-nothing loc.g.ts, used when a consumer does not supply its
// own default content. The runtime falls back to the source strings, so a
// vanilla build produces the source-string image with no localization tooling
// involved. A consumer whose build depends on loc.g.ts being listed first in
// pxt.json (for example to fix font-capture ordering) supplies its own text.
export const GENERIC_DEFAULT_LOC_G = `// Generated placeholder for a per-language build. In this default state it
// assigns nothing: the runtime falls back to the source strings.
//
// This file must exist because it is listed in pxt.json "files". A per-language
// build writes a translation table here, builds, and restores this default
// state afterward. Only the default state belongs in a commit.
`

// Emit loc.g.ts content for one language. `table` is the id-to-string catalog
// (emitted only when non-empty); `charsets` maps field names to their resolved
// strings (each emitted as a `_loc` member assignment). `font`, when given, is
// the name of a `bitmaps` font the language renders in, assigned to
// `_loc.defaultFont` so `ui.locFont()` returns it instead of the built-in
// fallback. All live inside one reopened `namespace _loc` block.
//
// The font is emitted as a reference (`bitmaps.font12`), not as glyph data:
// the font is already in the image, and a second copy would cost flash and
// could drift from the one the coverage check validated against.
export function emitLocG(lang, table, charsets, font) {
    const keys = Object.keys(table).sort()
    const fields = Object.keys(charsets).sort()
    const lines = []
    lines.push("// Generated for a per-language build. Holds the one shipped language's")
    lines.push("// translation table and per-language field data.")
    lines.push("//")
    lines.push("// Transient build intermediate: the generator restores the default state of")
    lines.push("// this file after the run. Do not commit this generated content.")
    lines.push("// lang: " + lang)
    lines.push("namespace _loc {")
    if (font) lines.push("    defaultFont = bitmaps." + font)
    if (keys.length > 0) {
        const entries = keys.map(k => "        " + JSON.stringify(k) + ": " + JSON.stringify(table[k]))
        lines.push("    table = {")
        lines.push(entries.join(",\n"))
        lines.push("    }")
    }
    for (const field of fields) {
        lines.push("    " + field + " = " + JSON.stringify(charsets[field]))
    }
    lines.push("}")
    return lines.join("\n") + "\n"
}

// Write the default (assign-nothing) state to loc.g.ts.
export function writeDefault(locGPath, defaultLocG) {
    writeFileSync(locGPath, defaultLocG)
}
