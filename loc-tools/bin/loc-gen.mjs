#!/usr/bin/env node
// Thin per-language build CLI for simple consumers. Run from the project root.
//
// Configuration is optional: with no loc.config.json a bare project builds the
// source language plus every locales/<lang>.json using stock defaults. A
// loc.config.json (JSON) may set any of: srcLang, font, hexName (a pattern with
// a "<lang>" placeholder), reservedLangNames, textPath, hexDir. Apps needing
// app-specific hooks (extra inventory, side outputs, exclusions) call the
// runLocGen API from their own wrapper instead.
//
// Flags: --coverage [--verbose], --keep, and positional language names.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { runLocGen } from "../gen.mjs"
import { GENERIC_DEFAULT_LOC_G } from "../emit.mjs"

const root = process.cwd()
const argv = process.argv.slice(2)
const coverage = argv.indexOf("--coverage") >= 0
const verbose = argv.indexOf("--verbose") >= 0
const keep = argv.indexOf("--keep") >= 0
const positional = argv.filter(a => !a.startsWith("--"))

let config = {}
const configPath = join(root, "loc.config.json")
if (existsSync(configPath)) config = JSON.parse(readFileSync(configPath, "utf8"))

const options = {
    root,
    srcLang: config.srcLang,
    font: config.font,
    textPath: config.textPath ? join(root, config.textPath) : undefined,
    hexDir: config.hexDir ? join(root, config.hexDir) : undefined,
    hexName: config.hexName ? lang => config.hexName.replace("<lang>", lang) : undefined,
    reservedLangNames: config.reservedLangNames,
    // The CLI always uses the stock default; a custom loc.g.ts default is an
    // API-level concern (pass defaultLocG to runLocGen from a wrapper).
    defaultLocG: GENERIC_DEFAULT_LOC_G,
    coverage,
    verbose,
    keep,
}

runLocGen(options, positional)
