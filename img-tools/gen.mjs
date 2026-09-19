// Image pack generation.
//
// Discovers the images declared with //% packable across the app and the
// packages it compiles against, joins them to the app's key table, packs the
// ones the app can pack, and writes img.g.ts.
//
// An app packs its own images, and a dependency's only when its key table names
// one. An image is left out when packing it would copy it rather than move it:
// when it lacks //% whenUsed, or when code still refers to its const.
//
// A consuming app calls runImageGen from a thin wrapper holding whatever is
// specific to it, the way it wraps runLocGen.

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"

import { scanSource, scanLiterals, countReferences } from "./scan.mjs"
import { discoverPackages, isApp } from "./packages.mjs"
import { readKeyTable, referencedNames } from "./keys.mjs"
import { buildPack } from "./pack.mjs"
import { emitImgG } from "./emit.mjs"
import { createDiagnostics } from "./diagnostics.mjs"
import { checkPins } from "./pins.mjs"
import { encodeImage } from "./codec.mjs"

// Normalize options into a fully-defaulted config.
function resolveConfig(options) {
    const root = options.root
    if (!root) throw new Error("runImageGen: options.root is required")
    const outName = options.outName || "img.g.ts"
    return {
        root,
        outName,
        outPath: options.outPath || join(root, outName),
        keysPath: options.keysPath || join(root, "img.keys.json"),
        // An image to keep out of the pack because the pack falls back to it.
        fallback: options.fallback || null,
        pins: options.pins !== false,
        write: options.write !== false,
        verbose: !!options.verbose,
        log: options.log || (s => console.log(s)),
    }
}

// Every compiled source in the graph, read once, with what each one declares.
function readGraph(cfg) {
    const packages = discoverPackages(cfg.root, cfg.outName)
    const sources = []
    const declared = []
    const literals = []
    for (const pkg of packages) {
        for (const rel of pkg.files) {
            const path = join(pkg.dir, rel)
            if (!existsSync(path)) continue
            const text = readFileSync(path, "utf8")
            sources.push({ pkg, rel, text })
            for (const img of scanSource(text, rel)) declared.push({ ...img, pkg })
            for (const lit of scanLiterals(text, rel)) literals.push({ ...lit, pkg })
        }
    }
    return { packages, sources, declared, literals }
}

// The qualified name is an image's identity: unique, because a namespace
// cannot declare the same const twice.
function qualified(img) {
    return img.namespace ? img.namespace + "." + img.name : img.name
}

// Index every declared image twice: by its bare name, where an app declaration
// wins over a dependency's, and by its qualified name, which a key table uses
// to say exactly which image it means when a bare name is ambiguous.
function indexImages(graph, diag, keysName) {
    const byBare = new Map()
    const byQualified = new Map()
    const all = []
    for (const img of graph.declared) {
        const q = qualified(img)
        const prior = byQualified.get(q)
        if (prior) {
            const where = `${prior.file}:${prior.line} and ${img.file}:${img.line}`
            const text = `${q} is declared twice in ${img.pkg.name}: ${where}`
            isApp(img.pkg) ? diag.error(text) : diag.info(text)
            continue
        }
        byQualified.set(q, img)
        all.push(img)

        const held = byBare.get(img.name)
        if (!held) {
            byBare.set(img.name, img)
            continue
        }
        const winner = isApp(img.pkg) ? img : held
        const loser = winner === img ? held : img
        byBare.set(img.name, winner)
        const w = qualified(winner)
        const l = qualified(loser)
        const text =
            `"${img.name}" matches both ${w} and ${l}. A bare "${img.name}" in ${keysName} ` +
            `resolves to ${w}; to use ${l} instead, write "${l}".`
        // When exactly one side is the app's, a bare name resolves to the image
        // the app itself declared, which is what its author expects.
        if (isApp(winner.pkg) !== isApp(loser.pkg)) diag.detail(text)
        else diag.info(text)
    }
    return { byBare, byQualified, all }
}

// A key table entry is an image's own name, or its qualified name when that is
// ambiguous. The exact name wins, so a `packable="a.b"` override still resolves.
function resolveImage(index, name) {
    return index.byBare.get(name) || index.byQualified.get(name) || null
}

// An image whose const is still used somewhere would be copied by packing
// rather than moved, so it stays a literal. A const name is unique within its
// namespace, so its own declaration is the single use expected.
function isReferenced(graph, img) {
    let uses = 0
    for (const s of graph.sources) uses += countReferences(s.text, img.constName, img.namespace)
    return uses > 1
}

// Why an image cannot be packed regardless of the key table, as a note to
// report, or null when nothing prevents it.
function exclusion(cfg, graph, img) {
    const where = `${img.pkg.name} ${img.file}:${img.line}`
    if (cfg.fallback && (img.name === cfg.fallback || qualified(img) === cfg.fallback))
        return { severity: "info", text: `${qualified(img)} is the pack's fallback image, so it stays a literal` }
    if (!img.whenUsed)
        return {
            severity: isApp(img.pkg) ? "warning" : "info",
            text: `${where}: ${qualified(img)} is //% packable but not //% whenUsed, so packing it would copy it rather than move it`,
        }
    if (isReferenced(graph, img))
        return { severity: "info", text: `${where}: ${qualified(img)} is still referenced as ${img.constName}, so it stays a literal` }
    return null
}

// The images the app can pack, with a note for each one it cannot.
function selectPackable(cfg, graph, index, wanted, diag) {
    const packable = []
    for (const img of index.all) {
        if (!isApp(img.pkg) && !wanted.has(img)) continue
        const why = exclusion(cfg, graph, img)
        if (why) {
            diag[why.severity](why.text)
            continue
        }
        // A packed image is reached only through a key, so one without a key
        // would take up space in the pack with no way to draw it.
        if (!wanted.has(img)) {
            diag.warning(`${img.pkg.name} ${img.file}:${img.line}: ${qualified(img)} is //% packable but no key in the key table reaches it, so it is left out`)
            continue
        }
        packable.push(img)
    }
    return packable
}

// A key table for an app that has none: one string key per image of the app's
// that can be packed, named after the image. Images that could not be packed
// are left out, so the table never names an image the next run rejects.
function starterKeyTable(cfg, graph, index) {
    const names = {}
    for (const img of index.all) {
        if (!isApp(img.pkg) || exclusion(cfg, graph, img)) continue
        // A bare name that resolves elsewhere would key the wrong image.
        const name = index.byBare.get(img.name) === img ? img.name : qualified(img)
        names[name] = name
    }
    return { numeric: {}, names }
}

// Reports each packed image whose pixels also ship as a plain literal, with
// the bytes that costs.
function reportDuplicates(graph, packed, diag) {
    const annotated = new Set(graph.declared.map(d => `${d.pkg.name}/${d.file}/${d.constName}`))
    const plain = graph.literals.filter(
        l => !annotated.has(`${l.pkg.name}/${l.file}/${l.constName}`),
    )
    const contentOf = new Map()
    for (const lit of plain) {
        const key = encodeImage(lit.rows).toString("hex")
        if (!contentOf.has(key)) contentOf.set(key, [])
        contentOf.get(key).push(lit)
    }

    for (const e of packed.entries) {
        if (e.shared) continue
        const twins = contentOf.get(e.f4.toString("hex")) || []
        for (const twin of twins) {
            const where = `${twin.pkg.name} ${twin.file}:${twin.line}`
            const text = `packed "${e.name}" has the same pixels as ${twin.constName} at ${where}, costing ${e.rawBytes} B twice`
            isApp(twin.pkg) ? diag.warning(text) : diag.info(text)
        }
    }

    // Identical images between two dependencies, with the app's pack holding
    // neither, are reported only when asked for.
    for (const [, group] of contentOf) {
        const deps = group.filter(l => !isApp(l.pkg))
        if (deps.length > 1 && deps.length === group.length)
            diag.detail(
                `identical images in dependencies: ` +
                    deps.map(l => `${l.pkg.name}/${l.constName}`).join(", "),
            )
    }
}

/**
 * Generates the app's image pack and img.g.ts.
 *
 * Returns everything it decided -- the pack, the lookups, the images it left
 * out and why, and the emitted source -- so a wrapper or a test can inspect the
 * result without reading the file back.
 */
export function runImageGen(options) {
    const cfg = resolveConfig(options)
    const diag = createDiagnostics(cfg.verbose)

    if (cfg.pins) {
        const pin = checkPins(cfg.root, options.pinNames)
        if (!pin.ok) diag.error(pin.reason)
        else if (pin.reason) diag.detail(`pin check skipped: ${pin.reason}`)
    }

    const graph = readGraph(cfg)
    const index = indexImages(graph, diag, basename(cfg.keysPath))

    let keys
    if (!existsSync(cfg.keysPath)) {
        keys = starterKeyTable(cfg, graph, index)
        const count = Object.keys(keys.names).length
        if (count > 0) {
            if (cfg.write) writeFileSync(cfg.keysPath, JSON.stringify(keys, null, 4) + "\n")
            diag.info(
                `no key table at ${cfg.keysPath}; ${cfg.write ? "wrote" : "would write"} a starter ` +
                    `with ${count} string key(s), one per image that can be packed`,
            )
            // The starter is a guess at the app's keys, so point out what it
            // cannot know.
            if (cfg.write)
                diag.info(
                    `review ${cfg.keysPath} before relying on it: each string key is the image's own ` +
                        `name, which may not be the key your code passes to _img.get; it has no numeric ` +
                        `keys; and it lists every app image that can be packed, including any your app ` +
                        `never draws`,
                )
        }
    } else {
        try {
            keys = readKeyTable(cfg.keysPath)
        } catch (e) {
            diag.error(e.message)
            diag.flush(cfg.log)
            diag.check()
        }
    }
    const wanted = new Set()
    for (const name of [...referencedNames(keys)].sort()) {
        const img = resolveImage(index, name)
        if (img) wanted.add(img)
        else diag.error(`key table names "${name}", which no package declares`)
    }

    const packable = selectPackable(cfg, graph, index, wanted, diag)
    const indexOf = new Map(packable.map((img, i) => [img, i]))
    for (const img of wanted)
        if (!indexOf.has(img))
            diag.error(`key table names ${qualified(img)}, which cannot be packed (see the note above)`)
    diag.flush(cfg.log)
    diag.check()

    const pack = buildPack(packable.map(img => ({ name: qualified(img), rows: img.rows })))
    reportDuplicates(graph, pack, diag)
    diag.flush(cfg.log)
    diag.check()

    // The key table declares every string key the app looks an image up by.
    const names = {}
    for (const [key, value] of Object.entries(keys.names))
        names[key] = indexOf.get(resolveImage(index, value))
    const numeric = {}
    for (const [key, value] of Object.entries(keys.numeric))
        numeric[Number(key)] = indexOf.get(resolveImage(index, value))

    const files = [...new Set(packable.map(i => `${i.pkg.name}/${i.file}`))]
    const source = emitImgG(pack, names, numeric, files)
    if (cfg.write) writeFileSync(cfg.outPath, source)

    report(cfg, pack, names, numeric, diag)
    return { pack, names, numeric, source, images: packable, diagnostics: diag.notes, config: cfg }
}

function report(cfg, pack, names, numeric, diag) {
    diag.flush(cfg.log)

    const s = pack.stats
    const packTotal = s.packBytes + s.offsetBytes
    const saved = s.rawBytes - packTotal
    const pct = s.rawBytes > 0 ? ((saved / s.rawBytes) * 100).toFixed(1) : "0.0"
    cfg.log(
        `img-gen: ${s.images} images (${s.unique} unique, ${s.shared} shared), ` +
            `${s.compressed} compressed, ${s.uncompressed} uncompressed; ` +
            `${s.rawBytes} B -> ${packTotal} B (${saved} B saved, ${pct}%); ` +
            `${s.decodedWorstCase} B RAM if all decoded`,
    )
    // Approximate flash cost of the emitted name index.
    const stringKeys = Object.keys(names)
    const indexBytes = stringKeys.join(",").length + stringKeys.length * (pack.entries.length > 255 ? 2 : 1)
    cfg.log(
        `img-gen: name index holds ${stringKeys.length} key(s), about ${indexBytes} B`,
    )
    if (!cfg.verbose) return

    cfg.log(`img-gen: wrote ${cfg.outPath}`)
    cfg.log(`img-gen: ${Object.keys(numeric).length} numeric key(s)`)
    for (const e of pack.entries) {
        if (e.shared) {
            cfg.log(`  ${e.name}: shares the record of ${e.shared}`)
            continue
        }
        const how = e.uncompressed ? "uncompressed" : "compressed"
        cfg.log(`  ${e.name}: ${e.rawBytes} B -> ${e.recordBytes} B ${how} @${e.offset}`)
    }
}
