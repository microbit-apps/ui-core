// Per-language localization build orchestrator.
//
// For each requested language: merge the discovered catalog layers, drop
// identity and unrenderable entries, resolve and validate per-language field
// data, emit loc.g.ts, build with mkc, and copy the resulting hex. A language
// with no renderable translations and no field data builds no hex. loc.g.ts is
// restored to its default (assign-nothing) state after the run.
//
// Coverage mode reports, per language, how much of the source-string inventory
// the merged catalog translates; it builds nothing and does not write loc.g.ts.

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, statSync } from "node:fs"
import { execSync } from "node:child_process"
import { join } from "node:path"

import { discoverLayers, mergeLayers, readCatalog } from "./catalogs.mjs"
import { createFontProvider, defaultTextPath, toHexCp } from "./fonts.mjs"
import { emitLocG, writeDefault } from "./emit.mjs"
import { resolveCharsets, validateCharsets } from "./charsets.mjs"

// Normalize options into a fully-defaulted config.
function resolveConfig(options) {
    const root = options.root
    if (!root) throw new Error("runLocGen: options.root is required")
    const pxt = JSON.parse(readFileSync(join(root, "pxt.json"), "utf8"))
    const srcLang = options.srcLang || "en"
    const textPath = options.textPath || defaultTextPath(root)
    const fonts = createFontProvider(textPath)

    const exclude = options.exclude || null
    const excludeLabel = (exclude && exclude.label) || "excluded"

    const small = options.smallFontContext || null
    const smallFont = (small && small.font) || "font5"
    let smallStrings = null
    if (small) {
        let s = typeof small.strings === "function" ? small.strings() : small.strings
        smallStrings = s instanceof Set ? s : new Set(s || [])
    }

    return {
        root,
        pxt,
        srcLang,
        fonts,
        font: options.font || "font8",
        layers: discoverLayers(root),
        langs: options.langs || null,
        reservedLangNames: options.reservedLangNames || [],
        coverage: !!options.coverage,
        verbose: !!options.verbose,
        keep: !!options.keep,
        hexDir: options.hexDir || join(root, "assets", "hex"),
        hexName: options.hexName || (lang => `${pxt.name}.${lang}.hex`),
        defaultLocG: options.defaultLocG,
        locGPath: options.locGPath || join(root, "loc.g.ts"),
        exclude,
        excludeLabel,
        smallFont,
        smallStrings,
        extraInventory: options.extraInventory || [],
        postMerge: options.postMerge || null,
    }
}

// Languages present in the project's own locales/, excluding the source
// language, the reserved charsets file, and any app-declared reserved names.
function discoverLangs(cfg) {
    const langs = []
    for (const f of readdirSync(join(cfg.root, "locales"))) {
        if (!f.endsWith(".json")) continue
        const name = f.slice(0, -5)
        if (name === cfg.srcLang || name === "charsets") continue
        if (cfg.reservedLangNames.indexOf(name) >= 0) continue
        langs.push(name)
    }
    return langs
}

function buildAndCopy(cfg, lang) {
    execSync("npx mkc build", { cwd: cfg.root, stdio: "pipe" })
    if (!existsSync(cfg.hexDir)) mkdirSync(cfg.hexDir, { recursive: true })
    const dst = join(cfg.hexDir, cfg.hexName(lang))
    copyFileSync(join(cfg.root, "built", "binary.hex"), dst)
    return { dst, size: statSync(dst).size }
}

// Validate a set of source strings rendered in the small-font context against
// that font's coverage; drop and report those the font cannot render.
function dropUnrenderable(merged, keys, coverage, lang, tag, only) {
    let dropped = 0
    for (const k of Object.keys(merged)) {
        if (only && !keys.has(k)) continue
        if (!only && keys.has(k)) continue
        const val = merged[k]
        const missing = []
        for (const ch of val) {
            const cp = ch.codePointAt(0)
            if (cp < 33) continue
            if (!coverage.has(cp)) missing.push(ch + " " + toHexCp(cp))
        }
        if (missing.length > 0) {
            delete merged[k]
            dropped++
            console.log(`  [${tag}] drop ${lang} key ${JSON.stringify(k)}: missing ${missing.join(", ")}`)
        }
    }
    return dropped
}

function processLanguage(cfg, lang) {
    const report = { lang }

    if (lang === cfg.srcLang) {
        console.log(`\n=== ${lang} ===`)
        if (cfg.postMerge) cfg.postMerge(lang, null)
        writeDefault(cfg.locGPath, cfg.defaultLocG)
        const built = buildAndCopy(cfg, lang)
        console.log("  source-string build (no translation table)")
        console.log(`  hex: ${built.dst} (${built.size} bytes)`)
        report.merged = 0
        report.identityDropped = 0
        report.smallDropped = 0
        report.glyphDropped = 0
        report.lengthWarnings = 0
        report.hexPath = built.dst
        report.hexSize = built.size
        return report
    }

    console.log(`\n=== ${lang} ===`)
    const { merged, layers } = mergeLayers(cfg.layers, lang)
    const layersFound = []
    for (const l of layers) {
        if (l.count === null) {
            console.log(`  layer ${l.name}: missing (${l.path})`)
            continue
        }
        layersFound.push(l.name)
        console.log(`  layer ${l.name}: ${l.count} entries`)
    }
    const mergedCount = Object.keys(merged).length

    if (cfg.postMerge) cfg.postMerge(lang, merged)

    // App-declared table key exclusions (source strings that ship elsewhere).
    let excluded = 0
    if (cfg.exclude) {
        const drop = new Set(cfg.exclude.keys(merged))
        for (const k of Object.keys(merged)) {
            if (drop.has(k)) {
                delete merged[k]
                excluded++
            }
        }
    }

    // Drop identity entries (value === key): they only waste flash.
    let identityDropped = 0
    for (const k of Object.keys(merged)) {
        if (merged[k] === k) {
            delete merged[k]
            identityDropped++
        }
    }

    // Small-font-context validation: strings the app renders in the small font
    // are validated against its coverage, not the build font. A translation the
    // small font cannot render is dropped so the runtime falls back to the
    // source string rather than drawing blank.
    let smallDropped = 0
    if (cfg.smallStrings && cfg.smallStrings.size > 0) {
        const cov = cfg.fonts.coverage(cfg.smallFont)
        smallDropped = dropUnrenderable(merged, cfg.smallStrings, cov, lang, cfg.smallFont, true)
    }

    // Glyph validation: drop entries whose translation contains code points the
    // build font cannot render. Code points below 33 are always acceptable.
    // Small-font-context keys are exempt: validated above.
    const cov = cfg.fonts.coverage(cfg.font)
    const smallKeys = cfg.smallStrings || new Set()
    const glyphDropped = dropUnrenderable(merged, smallKeys, cov, lang, cfg.font, false)

    // Length warning (never drops): translated text much longer than source.
    let lengthWarnings = 0
    for (const k of Object.keys(merged)) {
        const srcLen = Array.from(k).length
        const transLen = Array.from(merged[k]).length
        if (transLen > srcLen * 1.5 && transLen - srcLen > 3) {
            lengthWarnings++
            console.log(`  [length] ${lang} key ${JSON.stringify(k)}: src ${srcLen} -> trans ${transLen} chars`)
        }
    }

    // Per-language field data (hard-validated, never dropped).
    const charsets = resolveCharsets(cfg.layers, lang)
    if (Object.keys(charsets).length > 0) validateCharsets(charsets, cov, lang)

    const finalCount = Object.keys(merged).length
    const hasFields = Object.keys(charsets).length > 0

    report.merged = mergedCount
    report.identityDropped = identityDropped
    report.smallDropped = smallDropped
    report.glyphDropped = glyphDropped
    report.lengthWarnings = lengthWarnings
    report.table = finalCount

    // A language none of whose translations survive validation, and with no
    // field data, would ship an image identical to the source-string build;
    // skip it rather than emit a pointless hex.
    if (finalCount === 0 && !hasFields) {
        console.log(
            `  merged ${mergedCount}, ${cfg.excludeLabel} ${excluded}, identity-dropped ${identityDropped}, ` +
                `${cfg.smallFont}-dropped ${smallDropped}, glyph-dropped ${glyphDropped}`,
        )
        console.log("  no renderable translations; skipped (no hex built)")
        report.skipped = true
        return report
    }

    writeFileSync(cfg.locGPath, emitLocG(lang, merged, charsets))
    const built = buildAndCopy(cfg, lang)

    console.log(
        `  merged ${mergedCount}, ${cfg.excludeLabel} ${excluded}, identity-dropped ${identityDropped}, ` +
            `${cfg.smallFont}-dropped ${smallDropped}, glyph-dropped ${glyphDropped}, ` +
            `length-warnings ${lengthWarnings}, table ${finalCount}`,
    )
    console.log(`  hex: ${built.dst} (${built.size} bytes)`)

    report.hexPath = built.dst
    report.hexSize = built.size
    return report
}

// The full set of localizable source strings: the union of every layer's
// source catalog (keys) plus any app-declared extra inventory sources.
function sourceInventory(cfg) {
    const set = new Set()
    for (const layer of cfg.layers) {
        const cat = readCatalog(join(layer.localesDir, cfg.srcLang + ".json"))
        if (cat) for (const k of Object.keys(cat)) set.add(k)
    }
    for (const src of cfg.extraInventory) {
        if (Array.isArray(src)) {
            for (const s of src) set.add(s)
            continue
        }
        const cat = readCatalog(src.path)
        if (!cat) continue
        for (const s of src.mapper(cat)) set.add(s)
    }
    return set
}

function runCoverage(cfg, langArgs) {
    const inventory = Array.from(sourceInventory(cfg)).sort()
    const total = inventory.length
    const langs = langArgs.length > 0 ? langArgs : discoverLangs(cfg)

    console.log("locgen coverage")
    console.log(`inventory: ${total} source strings`)

    const rows = []
    const missingByLang = {}
    for (const lang of langs) {
        const { merged } = mergeLayers(cfg.layers, lang)
        let translated = 0
        const missing = []
        for (const s of inventory) {
            if (Object.prototype.hasOwnProperty.call(merged, s)) translated++
            else missing.push(s)
        }
        const pct = total === 0 ? 100 : (translated / total) * 100
        rows.push({ lang, total, translated, missing: missing.length, pct })
        missingByLang[lang] = missing
    }

    const head = ["lang", "total", "translated", "missing", "percent"]
    const cells = rows.map(r => [
        r.lang,
        String(r.total),
        String(r.translated),
        String(r.missing),
        r.pct.toFixed(1) + "%",
    ])
    const widths = head.map((h, i) => Math.max(h.length, ...cells.map(c => c[i].length)))
    const fmt = c => c.map((v, i) => v.padEnd(widths[i])).join("  ")
    console.log("")
    console.log(fmt(head))
    for (const c of cells) console.log(fmt(c))

    if (cfg.verbose) {
        for (const lang of langs) {
            const missing = missingByLang[lang]
            console.log(`\n--- ${lang}: ${missing.length} missing ---`)
            for (const s of missing) console.log("  " + s)
        }
    }
}

// Run coverage for the given languages (or all discovered when none are named).
export function runCoverageMode(options, langArgs = []) {
    const cfg = resolveConfig({ ...options, coverage: true })
    runCoverage(cfg, langArgs)
}

// Run the per-language build. `options` carry the project root and the hooks
// that specialize it (see loc-tools/README.md). Language selection: options.langs
// if given, else the named `langArgs`, else the source language plus every
// discovered language.
export function runLocGen(options, langArgs = []) {
    const cfg = resolveConfig(options)

    if (cfg.coverage) {
        runCoverage(cfg, langArgs)
        return
    }
    if (!cfg.defaultLocG) throw new Error("runLocGen: options.defaultLocG is required for a build run")

    let langs = cfg.langs || (langArgs.length > 0 ? langArgs : null)
    if (!langs) langs = [cfg.srcLang, ...discoverLangs(cfg)]

    console.log("locgen: " + langs.join(", "))

    const reports = []
    let leaveModified = false
    let failedLang = null
    try {
        for (const lang of langs) {
            try {
                reports.push(processLanguage(cfg, lang))
            } catch (err) {
                // A build failure leaves loc.g.ts in place for debugging.
                leaveModified = true
                failedLang = lang
                const out = (err.stdout && err.stdout.toString()) || ""
                const errOut = (err.stderr && err.stderr.toString()) || ""
                console.error(`\nERROR building ${lang}: ${err.message}`)
                if (out) console.error(out.split("\n").slice(-25).join("\n"))
                if (errOut) console.error(errOut.split("\n").slice(-25).join("\n"))
                throw err
            }
        }
    } finally {
        if (leaveModified) {
            console.error(`\nloc.g.ts left MODIFIED (last: ${failedLang}) for debugging; not restored.`)
        } else if (cfg.keep) {
            console.log("\nloc.g.ts left in place (--keep); not restored.")
        } else {
            writeDefault(cfg.locGPath, cfg.defaultLocG)
            console.log("\nloc.g.ts restored to default state.")
        }
    }

    console.log("\n=== summary ===")
    const head = ["lang", "merged", "identity", cfg.smallFont, "glyph", "len-warn", "table", "hex bytes"]
    console.log(head.join("\t"))
    for (const r of reports) {
        console.log(
            [
                r.lang,
                r.merged,
                r.identityDropped,
                r.smallDropped === undefined ? "-" : r.smallDropped,
                r.glyphDropped,
                r.lengthWarnings,
                r.table === undefined ? "-" : r.table,
                r.skipped ? "(skipped)" : r.hexSize,
            ].join("\t"),
        )
    }
}
