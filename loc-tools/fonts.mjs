// Bitmap-font glyph coverage.
//
// A font's renderable code points are read from its hex-literal glyph table in
// the display-shield text source. Each record is 8 bytes: a 2-byte
// little-endian code point followed by 6 data bytes. The set of code points is
// used to decide whether a translated string can render in a given font.

import { readFileSync } from "node:fs"
import { join } from "node:path"

// Format a code point as U+XXXX for diagnostics.
export function toHexCp(cp) {
    return "U+" + cp.toString(16).toUpperCase().padStart(4, "0")
}

// Escape regex metacharacters so a value can be matched literally.
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Parse the code-point coverage of a named font from a text source file.
export function parseFontCoverage(srcPath, fontName) {
    const src = readFileSync(srcPath, "utf8")
    const m = src.match(
        new RegExp(escapeRegExp(fontName) + "[\\s\\S]*?data:\\s*hex`([\\s\\S]*?)`"),
    )
    if (!m) throw new Error(`could not locate ${fontName} hex literal in ${srcPath}`)
    const hex = m[1].replace(/\s+/g, "")
    const set = new Set()
    for (let i = 0; i + 16 <= hex.length; i += 16) {
        const lo = parseInt(hex.slice(i, i + 2), 16)
        const hi = parseInt(hex.slice(i + 2, i + 4), 16)
        set.add(lo | (hi << 8))
    }
    return set
}

// The standard font glyph-table source shipped by the display-shield module.
export function defaultTextPath(root) {
    return join(root, "pxt_modules", "display-shield", "text.ts")
}

// A cached coverage provider over one text source file. `coverage(name)`
// returns the code-point set for a font, parsing it on first use.
export function createFontProvider(textPath) {
    const cache = {}
    return {
        coverage(fontName) {
            if (!cache[fontName]) cache[fontName] = parseFontCoverage(textPath, fontName)
            return cache[fontName]
        },
    }
}
