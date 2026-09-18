// Source scanning for packable images.
//
// A packable image is an `export const <name> = bmp` literal carrying a
// `//% packable` attribute in the comment block directly above it. The image
// is named by its const, so a key table entry and a declaration never repeat
// the same string.
//
// `//% packable="name"` overrides that name. It exists so a package can keep a
// name stable while renaming the const behind it -- a library cannot edit the
// key tables of the apps that use it. An app aliasing its own key to an image
// belongs in its key table instead.
//
// Images inside a /* */ block are ignored, matching what the compiler sees.
//
// The same source is also read two other ways: for every `bmp` literal a file
// declares, annotated or not, and for whether an image's const is referenced
// by name anywhere, which decides whether packing it would move it or copy it.

// One `//%` attribute block followed by an exported bmp literal.
const DECL =
    /((?:[ \t]*\/\/%[^\n]*\n)+)[ \t]*export[ \t]+const[ \t]+(\w+)[ \t]*=[ \t]*bmp`([^`]*)`/g

// Any exported bmp literal, with or without attributes.
const LITERAL = /export[ \t]+const[ \t]+(\w+)[ \t]*=[ \t]*bmp`([^`]*)`/g

// The namespace a declaration sits in, for reports that name the const.
const NAMESPACE = /\bnamespace[ \t]+([\w.]+)/g

/**
 * Blanks out comments, keeping every newline so line numbers still match the
 * file on disk. A "/*" or "//" inside a string or template is left alone.
 *
 * `opts.lineComments` also blanks `//` comments, which discovery needs to keep
 * because `//%` attributes live in them. `opts.strings` blanks the text inside
 * quotes, which reference counting needs: a name in string data is not a use
 * of the const that shares it. Interpolations in a template are kept, since
 * those hold real code.
 */
function blankComments(src, opts) {
    const lineComments = !!(opts && opts.lineComments)
    const strings = !!(opts && opts.strings)
    let out = ""
    let i = 0
    const blank = text => {
        for (const ch of text) out += ch === "\n" ? "\n" : " "
    }
    while (i < src.length) {
        const c = src[i]
        const d = src[i + 1]
        if (c === "/" && d === "*") {
            const end = src.indexOf("*/", i + 2)
            const stop = end < 0 ? src.length : end + 2
            blank(src.slice(i, stop))
            i = stop
        } else if (c === "/" && d === "/") {
            const end = src.indexOf("\n", i)
            const stop = end < 0 ? src.length : end
            if (lineComments) blank(src.slice(i, stop))
            else out += src.slice(i, stop)
            i = stop
        } else if (c === '"' || c === "'" || c === "`") {
            let j = i + 1
            while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1
            const stop = Math.min(j + 1, src.length)
            const body = src.slice(i + 1, stop - 1)
            if (!strings) out += src.slice(i, stop)
            else {
                out += c
                // Keep ${...} in a template: it is code, not text.
                for (const part of body.split(/(\$\{[^}]*\})/g)) {
                    if (c === "`" && part.startsWith("${")) out += part
                    else blank(part)
                }
                out += stop - 1 > i ? c : ""
            }
            i = stop
        } else {
            out += c
            i++
        }
    }
    return out
}

/** Source with block comments blanked, leaving `//%` attributes readable. */
export function stripBlockComments(src) {
    return blankComments(src, {})
}

/**
 * Reads `//% packable` from an attribute block: null when absent, otherwise
 * the name it carries, or "" for the bare form, which names by the const.
 */
function packableAttr(attrs) {
    // pxt allows several attributes on one `//%` line, so `packable` may
    // follow another one: `//% whenUsed packable`.
    const m = /\/\/%(?:[ \t]*|[^\n]*?[ \t])packable\b(\s*=\s*("([^"]*)"|'([^']*)'|(\S+)))?/.exec(attrs)
    if (!m) return null
    if (!m[1]) return ""
    const raw = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5]
    return (raw || "").trim()
}

/** The innermost namespace opened before `index`, or null. */
function namespaceAt(src, index) {
    let ns = null
    let m
    NAMESPACE.lastIndex = 0
    while ((m = NAMESPACE.exec(src)) && m.index < index) ns = m[1]
    return ns
}

/**
 * Annotated images in one source file, in declaration order. Each is
 * { name, constName, namespace, rows, whenUsed, file, line } -- `name` is the
 * const's own name unless `packable=` overrode it, and `rows` the pixel rows
 * as written.
 */
export function scanSource(src, file) {
    const clean = stripBlockComments(src)
    const found = []
    let m
    DECL.lastIndex = 0
    while ((m = DECL.exec(clean))) {
        const declared = packableAttr(m[1])
        if (declared === null) continue
        found.push({
            name: declared || m[2],
            constName: m[2],
            namespace: namespaceAt(clean, m.index),
            rows: m[3],
            whenUsed: /\/\/%[^\n]*\bwhenUsed\b/.test(m[1]),
            file,
            line: clean.slice(0, m.index).split("\n").length,
        })
    }
    return found
}

/**
 * Every exported `bmp` literal in one source file, annotated or not, as
 * { constName, rows, file, line }. Used to compare a pack against the images
 * that still ship as literals.
 */
export function scanLiterals(src, file) {
    const clean = stripBlockComments(src)
    const found = []
    let m
    LITERAL.lastIndex = 0
    while ((m = LITERAL.exec(clean)))
        found.push({
            constName: m[1],
            rows: m[2],
            file,
            line: clean.slice(0, m.index).split("\n").length,
        })
    return found
}

/**
 * Counts references to a const named `name` declared in `namespace ns`,
 * ignoring comments and the text inside quotes.
 *
 * A reference is `ns.name` from anywhere, or a bare `name` in a file that opens
 * that namespace -- so `music.playTone()` is not a use of `icondb.music`. The
 * const's own declaration is one such bare use, which is why a caller compares
 * the total against 1 rather than 0. Pass no `ns` to count bare uses anywhere.
 */
export function countReferences(src, name, ns) {
    const code = blankComments(src, { lineComments: true, strings: true })
    const escaped = ns ? ns.replace(/\./g, "\\.") : null
    let total = 0
    if (ns) {
        const qualified = code.match(new RegExp("\\b" + escaped + "\\." + name + "\\b", "g"))
        total += qualified ? qualified.length : 0
        if (!new RegExp("\\bnamespace\\s+" + escaped + "\\b").test(code)) return total
    }
    const bare = code.match(new RegExp("(?<![.\\w])" + name + "\\b", "g"))
    return total + (bare ? bare.length : 0)
}
