#!/usr/bin/env node
// Image pack generator for apps that need no wrapper. Run from the project
// root.
//
// Configuration is optional. An img.config.json beside pxt.json may set any of:
// keysPath and outName (paths relative to the project root), fallback, and
// pins. Apps that need more call runImageGen from their own script instead.
//
// Flags:
//   --verbose  per-image breakdown, plus notes that are otherwise hidden
//   --check    after a build: report packed images that also ship as buffers,
//              without regenerating anything

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { runImageGen } from "../gen.mjs"
import { runImageCheck } from "../verify.mjs"

const CONFIG_KEYS = ["keysPath", "outName", "fallback", "pins"]

function readConfig(root) {
    const path = join(root, "img.config.json")
    if (!existsSync(path)) return {}
    let config
    try {
        config = JSON.parse(readFileSync(path, "utf8"))
    } catch (e) {
        throw new Error(`${path} is not valid JSON: ${e.message}`)
    }
    if (!config || typeof config !== "object" || Array.isArray(config))
        throw new Error(`${path} must be a JSON object`)
    const unknown = Object.keys(config).filter(k => CONFIG_KEYS.indexOf(k) < 0)
    if (unknown.length > 0)
        throw new Error(`${path}: unknown setting(s) ${unknown.join(", ")}; expected ${CONFIG_KEYS.join(", ")}`)
    return config
}

try {
    const root = process.cwd()
    const argv = process.argv.slice(2)
    const unknownFlags = argv.filter(a => a !== "--verbose" && a !== "--check")
    if (unknownFlags.length > 0) throw new Error(`unknown argument(s) ${unknownFlags.join(" ")}`)
    const check = argv.indexOf("--check") >= 0

    const config = readConfig(root)
    const options = {
        root,
        keysPath: config.keysPath ? join(root, config.keysPath) : undefined,
        outName: config.outName,
        fallback: config.fallback,
        pins: config.pins,
        verbose: argv.indexOf("--verbose") >= 0,
    }

    if (check) {
        const { pack } = runImageGen({ ...options, write: false, log: () => {} })
        runImageCheck({ root, pack })
    } else {
        runImageGen(options)
    }
} catch (e) {
    console.error(`img-gen: ${e.message}`)
    process.exit(1)
}
