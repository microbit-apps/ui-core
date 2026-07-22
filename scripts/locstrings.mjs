// Regenerates locales/en.json from source.
//
// Scans the .ts files listed in pxt.json "files" (so test files are excluded)
// and extracts the source display strings passed to the localization helpers:
//
//   ui.loc("...")  / loc("...")
//   ui.locf("...") / locf("...")   (first argument only)
//   ui.locc("ctx", "...") / locc("ctx", "...")  (emits key "ctx#string")
//
// Arguments must be string literals at the call site (the documented
// convention; see locales/README.md). Any other argument is reported as a
// loud warning naming the file and the argument, so a missed string is never
// dropped silently. A call whose argument is deliberately dynamic (its
// strings reach the catalog by another route) is suppressed by putting
// "locstrings-ignore" in a comment on the call's line.
//
// The result is a sorted JSON object mapping each catalog key to its source
// display string. For locc entries the value is the plain string, without the
// context prefix. The file is fully derived: it is regenerated from source, so
// any prior keys not found in the current sources are dropped.

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

// A double- or single-quoted string literal, honoring escaped quotes.
const STR = `"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'`
// One helper argument: a string literal, or any run up to the next comma or
// close paren. The string alternative is tried first so commas or parens
// inside a literal do not truncate the capture.
const ARG = `(?:${STR}|[^,)]*)`

// A helper definition (`function loc(...)`) rather than a call site. Excluded
// via lookbehind so parameter declarations are not read as call arguments.
const DEF = `(?<!\\bfunction\\s{1,8})`
// loc(...) and locf(...): first argument. The optional "f" plus the required
// "(" lookahead avoids matching locc and locFont.
const LOC_RE = new RegExp(`${DEF}(?:ui\\.)?locf?\\s*\\(\\s*(${ARG})`, "g")
// locc("ctx", "..."): both arguments.
const LOCC_RE = new RegExp(
    `${DEF}(?:ui\\.)?locc\\s*\\(\\s*(${ARG})\\s*,\\s*(${ARG})`,
    "g",
)

const STR_ONLY = new RegExp(`^(?:${STR})$`)

// Removes line and block comments so commented-out code is neither extracted
// nor reported as an unresolved argument. String and template literals are
// copied verbatim so a "//" or "/*" inside a literal is preserved.
function stripComments(src) {
    let out = ""
    let i = 0
    const n = src.length
    while (i < n) {
        const c = src[i]
        const d = src[i + 1]
        if (c == "/" && d == "/") {
            i += 2
            while (i < n && src[i] != "\n") i++
            continue
        }
        if (c == "/" && d == "*") {
            i += 2
            while (i < n && !(src[i] == "*" && src[i + 1] == "/")) i++
            i += 2
            continue
        }
        if (c == '"' || c == "'" || c == "`") {
            out += c
            i++
            while (i < n) {
                const ch = src[i]
                if (ch == "\\") {
                    out += ch + (i + 1 < n ? src[i + 1] : "")
                    i += 2
                    continue
                }
                out += ch
                i++
                if (ch == c) break
            }
            continue
        }
        out += c
        i++
    }
    return out
}

// Turns a source string literal into its runtime string value.
function unquote(lit) {
    const body = lit.slice(1, -1)
    return body.replace(/\\(.)/g, (_, ch) => {
        if (ch == "n") return "\n"
        if (ch == "t") return "\t"
        if (ch == "r") return "\r"
        return ch
    })
}

let warnings = 0

// Resolves a captured helper argument to its string value, or null (with a
// warning) when it is not a string literal.
function resolveArg(raw, file) {
    const arg = raw.trim()
    if (arg == "") return null
    if (STR_ONLY.test(arg)) return unquote(arg)
    console.warn(`locstrings: WARNING: ${file}: cannot resolve loc argument '${arg}'`)
    warnings++
    return null
}

const pxt = JSON.parse(readFileSync(join(root, "pxt.json"), "utf8"))
const catalog = {}

// The file that implements the localization API passes its own parameters
// through loc(); it defines the helpers rather than consuming them, so it is
// not a source of catalog keys.
const API_DEF_RE = new RegExp(`\\bexport\\s+function\\s+loc\\s*\\(`)

for (const file of pxt.files) {
    if (!file.endsWith(".ts")) continue
    const raw = readFileSync(join(root, file), "utf8")
        .split("\n")
        .filter(line => !line.includes("locstrings-ignore"))
        .join("\n")
    const src = stripComments(raw)
    if (API_DEF_RE.test(src)) continue

    for (const m of src.matchAll(LOCC_RE)) {
        const ctx = resolveArg(m[1], file)
        const str = resolveArg(m[2], file)
        if (ctx == null || str == null) continue
        catalog[ctx + "#" + str] = str
    }
    for (const m of src.matchAll(LOC_RE)) {
        const str = resolveArg(m[1], file)
        if (str == null) continue
        catalog[str] = str
    }
}

const sorted = {}
for (const key of Object.keys(catalog).sort()) sorted[key] = catalog[key]

writeFileSync(
    join(root, "locales", "en.json"),
    JSON.stringify(sorted, null, 4) + "\n",
)

const count = Object.keys(sorted).length
console.log(`locstrings: wrote ${count} key(s) to locales/en.json`)
if (warnings) console.log(`locstrings: ${warnings} unresolved loc argument(s); see warnings above`)
