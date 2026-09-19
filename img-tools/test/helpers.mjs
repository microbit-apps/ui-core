// Shared fixtures for the img-tools tests.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

export const BT = "`"

/** A `bmp` literal const, with any `//%` attribute lines given. */
export function bmpConst(constName, rows, attrs = []) {
    const lines = attrs.map(a => "    //% " + a)
    const body = rows.map(r => "        " + r).join("\n")
    lines.push(`    export const ${constName} = bmp${BT}\n${body}\n    ${BT}`)
    return lines.join("\n")
}

/** A namespace wrapping the given declarations. */
export function ns(name, ...decls) {
    return `namespace ${name} {\n${decls.join("\n\n")}\n}\n`
}

/**
 * Writes a project tree into a fresh temporary directory and returns its root.
 * `files` maps relative paths to contents; objects are written as JSON.
 */
export function makeProject(files) {
    const root = mkdtempSync(join(tmpdir(), "img-tools-test-"))
    for (const [rel, content] of Object.entries(files)) {
        const path = join(root, rel)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content, null, 4))
    }
    return root
}

export function removeProject(root) {
    rmSync(root, { recursive: true, force: true })
}

/** A log function that collects lines, for asserting on what a run printed. */
export function captureLog() {
    const lines = []
    const log = s => lines.push(s)
    log.lines = lines
    log.text = () => lines.join("\n")
    return log
}

/** A deterministic pseudo-random generator, so failures reproduce. */
export function seeded(seed) {
    let s = seed >>> 0
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0
        return s / 0x100000000
    }
}
