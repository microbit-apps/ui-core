// Post-build check: what the pack holds against what the build actually shipped.
//
// Run it after a build. It reads the image buffers out of the compiled output
// and reports any whose pixels a packed image already carries, which is flash
// spent twice. Nothing here fails a build.

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { decodeRecord } from "./codec.mjs"

// A buffer literal in the compiled output: its declared length and its bytes.
const BUFFER = /\.word\s+pxt::buffer_vt\s+\.word\s+(\d+)\s+\.hex\s+([0-9a-f]+)/g

const MAGIC = 0x87

function decodedSize(w, h) {
    return 8 + (((h * 4 + 31) >> 5) << 2) * w
}

/**
 * The F4 images in one compiled output. A buffer counts as an image on the
 * same terms the runtime uses: the magic byte, a supported depth, and a length
 * matching exactly what its width and height imply.
 */
export function imagesInBuild(asm) {
    const found = []
    let m
    BUFFER.lastIndex = 0
    while ((m = BUFFER.exec(asm))) {
        const buf = Buffer.from(m[2], "hex")
        if (buf.length < 9 || buf[0] !== MAGIC) continue
        if (buf[1] !== 1 && buf[1] !== 4) continue
        if (buf.length !== decodedSize(buf.readUInt16LE(2), buf.readUInt16LE(4))) continue
        found.push(buf)
    }
    return found
}

/** The compiled outputs under a project's built/ directory. */
export function findBuildOutputs(root) {
    const dir = join(root, "built")
    if (!existsSync(dir)) return []
    return readdirSync(dir)
        .filter(f => f.endsWith(".asm"))
        .map(f => join(dir, f))
}

/**
 * Compares a pack against the images in the build at `root`.
 *
 * `pack` is what buildPack returned. Returns { outputs, images, duplicates },
 * where each duplicate names a packed image whose pixels also ship as a
 * separate buffer, with the bytes that costs.
 */
export function runImageCheck(options) {
    const root = options.root
    if (!root) throw new Error("runImageCheck: options.root is required")
    const pack = options.pack
    if (!pack) throw new Error("runImageCheck: options.pack is required")
    const log = options.log || (s => console.log(s))

    const outputs = options.outputs || findBuildOutputs(root)
    const packed = new Map()
    for (const e of pack.entries) {
        if (e.shared) continue
        packed.set(decodeRecord(pack.blob, e.offset).toString("hex"), e)
    }

    const duplicates = []
    let images = 0
    for (const path of outputs) {
        for (const buf of imagesInBuild(readFileSync(path, "utf8"))) {
            images++
            // A packed image decodes with its padding zeroed, which is how
            // every compiler-emitted image is written too.
            const hit = packed.get(buf.toString("hex"))
            if (hit) duplicates.push({ name: hit.name, bytes: buf.length, output: path })
        }
    }

    if (duplicates.length === 0)
        log(`img-check: ${images} image buffer(s) in ${outputs.length} output(s), none duplicating the pack`)
    else {
        const bytes = duplicates.reduce((n, d) => n + d.bytes, 0)
        log(`img-check: ${duplicates.length} packed image(s) also ship as buffers, ${bytes} B:`)
        for (const d of duplicates) log(`  ${d.name}: ${d.bytes} B`)
    }
    return { outputs, images, duplicates }
}
