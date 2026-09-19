import { test } from "node:test"
import assert from "node:assert/strict"

import { imagesInBuild, findBuildOutputs, runImageCheck } from "../verify.mjs"
import { buildPack } from "../pack.mjs"
import { encodeImage } from "../codec.mjs"
import { makeProject, removeProject, captureLog } from "./helpers.mjs"

// A buffer literal the way the compiler writes one into its assembly output.
const literal = buf =>
    `_hexlit1:\n .word pxt::buffer_vt\n                .word ${buf.length}\n                .hex ${buf.toString("hex")}\n`

const icon = encodeImage(Array(16).fill("1111222233334444"))

test("imagesInBuild finds image buffers and skips everything else", () => {
    const notImage = Buffer.from("hello world")
    const wrongLength = Buffer.concat([icon, Buffer.alloc(4)])
    const wrongDepth = Buffer.from(icon)
    wrongDepth[1] = 8
    const asm = [icon, notImage, wrongLength, wrongDepth].map(literal).join("\n")
    const found = imagesInBuild(asm)
    assert.equal(found.length, 1)
    assert.deepEqual(found[0], icon)
})

test("findBuildOutputs lists the assembly files in built/", () => {
    const root = makeProject({ "built/a.asm": "", "built/b.asm": "", "built/binary.hex": "" })
    try {
        assert.deepEqual(findBuildOutputs(root).map(p => p.split("/").pop()).sort(), ["a.asm", "b.asm"])
    } finally {
        removeProject(root)
    }
})

test("runImageCheck reports a packed image that also ships as a buffer", () => {
    const root = makeProject({ "built/out.asm": literal(icon) })
    try {
        const log = captureLog()
        const pack = buildPack([{ name: "icon", rows: Array(16).fill("1111222233334444") }])
        const r = runImageCheck({ root, pack, log })
        assert.deepEqual(r.duplicates.map(d => d.name), ["icon"])
        assert.match(log.text(), /1 packed image\(s\) also ship as buffers, 136 B/)
    } finally {
        removeProject(root)
    }
})

test("runImageCheck reports nothing when the pack is not duplicated", () => {
    const root = makeProject({ "built/out.asm": literal(icon) })
    try {
        const log = captureLog()
        const pack = buildPack([{ name: "other", rows: ["1 2", "3 4"] }])
        const r = runImageCheck({ root, pack, log })
        assert.equal(r.duplicates.length, 0)
        assert.match(log.text(), /1 image buffer\(s\) in 1 output\(s\), none duplicating the pack/)
    } finally {
        removeProject(root)
    }
})
