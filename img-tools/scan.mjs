// Source scanning for packable images, over a TypeScript AST.
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
// The same source is also read two other ways: for every `bmp` literal a file
// declares, annotated or not, and for whether an image's const is referenced
// by name anywhere, which decides whether packing it would move it or copy it.
//
// Parsing is TypeScript's, so comments, strings, namespaces and identifiers
// are distinguished by the language rather than by pattern. Attributes are the
// exception: they live inside comment text, and are read with a regex, as pxt
// reads its own.

import ts from "typescript"

const parse = (src, file) =>
    ts.createSourceFile(file || "source.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

const lineOf = (sf, pos) => sf.getLineAndCharacterOfPosition(pos).line + 1

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

/** The namespaces enclosing a node, outermost first, as `a.b.c`, or null. */
function namespaceOf(node) {
    const names = []
    for (let n = node.parent; n; n = n.parent)
        if (ts.isModuleDeclaration(n) && ts.isIdentifier(n.name)) names.unshift(n.name.text)
    return names.length > 0 ? names.join(".") : null
}

/**
 * The comments directly above a statement, stopping at a blank line, so a
 * distant comment is never read as this declaration's attributes.
 */
function attachedComments(src, sf, stmt) {
    const ranges = ts.getLeadingCommentRanges(src, stmt.getFullStart()) || []
    const attached = []
    let nextStart = stmt.getStart(sf)
    for (let i = ranges.length - 1; i >= 0; i--) {
        const r = ranges[i]
        if (src.slice(r.end, nextStart).split("\n").length > 2) break
        attached.unshift(r)
        nextStart = r.pos
    }
    return attached
}

/** Calls `fn` for every `export const <name> = bmp` literal in the file. */
function eachImageConst(src, file, fn) {
    const sf = parse(src, file)
    const visit = node => {
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer &&
            ts.isTaggedTemplateExpression(node.initializer) &&
            ts.isIdentifier(node.initializer.tag) &&
            node.initializer.tag.text === "bmp" &&
            ts.isNoSubstitutionTemplateLiteral(node.initializer.template)
        ) {
            const stmt = node.parent.parent
            const exported =
                ts.isVariableStatement(stmt) &&
                (stmt.modifiers || []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)
            if (exported)
                fn({
                    sf,
                    stmt,
                    constName: node.name.text,
                    rows: node.initializer.template.text,
                    namespace: namespaceOf(node),
                })
        }
        ts.forEachChild(node, visit)
    }
    visit(sf)
}

/**
 * Annotated images in one source file, in declaration order. Each is
 * { name, constName, namespace, rows, whenUsed, file, line } -- `name` is the
 * const's own name unless `packable=` overrode it, and `rows` the pixel rows
 * as written.
 */
export function scanSource(src, file) {
    const found = []
    eachImageConst(src, file, ({ sf, stmt, constName, rows, namespace }) => {
        const comments = attachedComments(src, sf, stmt)
        const attrs = comments.map(c => src.slice(c.pos, c.end)).join("\n")
        const declared = packableAttr(attrs)
        if (declared === null) return
        // The attribute block is the trailing run of `//%` comments.
        let first = comments.length
        while (first > 0 && src.slice(comments[first - 1].pos, comments[first - 1].end).startsWith("//%"))
            first--
        found.push({
            name: declared || constName,
            constName,
            namespace,
            rows,
            whenUsed: /\/\/%[^\n]*\bwhenUsed\b/.test(attrs),
            file,
            line: lineOf(sf, comments[first] ? comments[first].pos : stmt.getStart(sf)),
        })
    })
    return found
}

/**
 * Every exported `bmp` literal in one source file, annotated or not, as
 * { constName, rows, file, line }. Used to compare a pack against the images
 * that still ship as literals.
 */
export function scanLiterals(src, file) {
    const found = []
    eachImageConst(src, file, ({ sf, stmt, constName, rows }) => {
        found.push({ constName, rows, file, line: lineOf(sf, stmt.getStart(sf)) })
    })
    return found
}

/** The dotted name a property access reads, or null when it is not a plain chain. */
function qualifierOf(node) {
    const parts = []
    for (let n = node; ; n = n.expression) {
        if (ts.isIdentifier(n)) return [n.text, ...parts].join(".")
        if (!ts.isPropertyAccessExpression(n)) return null
        parts.unshift(n.name.text)
    }
}

/** True when the file opens `ns`, so a bare name in it could resolve there. */
function opensNamespace(sf, ns) {
    const wanted = ns.split(".")
    let found = false
    const visit = node => {
        if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name)) {
            const chain = []
            for (let n = node; n; n = n.parent)
                if (ts.isModuleDeclaration(n) && ts.isIdentifier(n.name)) chain.unshift(n.name.text)
            if (wanted.every((p, i) => chain[i] === p)) found = true
        }
        ts.forEachChild(node, visit)
    }
    visit(sf)
    return found
}

/**
 * Counts references to a const named `name` declared in `namespace ns`.
 *
 * A reference is `ns.name` from anywhere, or a bare `name` in a file that opens
 * that namespace -- so `music.playTone()` is not a use of `icondb.music`. The
 * const's own declaration is one such bare use, which is why a caller compares
 * the total against 1 rather than 0. Pass no `ns` to count bare uses anywhere.
 *
 * Only identifiers count: a name in a comment, in string data, or as a member
 * of some other object is not a use of this const.
 */
export function countReferences(src, name, ns) {
    const sf = parse(src, "source.ts")
    const bareCounts = !ns || opensNamespace(sf, ns)
    let total = 0
    const visit = node => {
        if (ts.isPropertyAccessExpression(node) && node.name.text === name) {
            if (ns && qualifierOf(node.expression) === ns) total++
        } else if (ts.isIdentifier(node) && node.text === name) {
            const p = node.parent
            const isMemberName =
                (ts.isPropertyAccessExpression(p) && p.name === node) ||
                (ts.isQualifiedName(p) && p.right === node) ||
                (ts.isPropertyAssignment(p) && p.name === node) ||
                (ts.isPropertySignature(p) && p.name === node)
            if (!isMemberName && bareCounts) total++
        }
        ts.forEachChild(node, visit)
    }
    visit(sf)
    return total
}
