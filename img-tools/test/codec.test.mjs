import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

import { encodeImage, encodeRecord, decodeRecord, isUncompressed, recordLength } from "../codec.mjs"
import { scanLiterals } from "../scan.mjs"
import { seeded } from "./helpers.mjs"

const uiCore = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const hex = s => Buffer.from(s.replace(/\s+/g, ""), "hex")

// The image the compiler would emit, with padding zeroed, which is what a
// record decodes back to.
const zeroPadding = f4 => {
    const b = Buffer.from(f4)
    b.writeUInt16LE(0, 6)
    return b
}

test("encodeImage lays out pixels as the compiler does", () => {
    // Two columns of two rows: each column is padded to 4 bytes, and within a
    // column the lower row takes the low nibble.
    assert.deepEqual(encodeImage(["1 2", "3 4"]), hex("87 04 0200 0200 0000  31000000  42000000"))
})

test("encodeImage pads each column to 32 bits", () => {
    // Nine rows need 36 bits, so each column takes 8 bytes.
    const rows = [".", ".", ".", ".", ".", ".", ".", ".", "f"]
    const f4 = encodeImage(rows)
    assert.equal(f4.length, 8 + 8)
    assert.equal(f4[8 + 4], 0x0f)
})

test("encodeImage accepts rows as a string, ignores whitespace, and pads ragged rows", () => {
    assert.deepEqual(encodeImage("1 2\n3 4\n"), encodeImage(["12", "34"]))
    assert.deepEqual(encodeImage(["12", "3"]), encodeImage(["12", "3."]))
})

test("encodeImage rejects an empty image and a bad pixel", () => {
    assert.throws(() => encodeImage([]), /no rows/)
    assert.throws(() => encodeImage(["1g"]), /bad pixel g/)
})

test("encodeRecord compresses when it helps, marking the record", () => {
    const f4 = encodeImage(Array(16).fill(". . . . . . . . . . . . . . . ."))
    const record = encodeRecord(f4)
    assert.ok(record.length < f4.length)
    assert.equal(record.readUInt16LE(6), 0xc001)
    assert.equal(isUncompressed(record), false)
})

test("encodeRecord leaves an image that does not compress uncompressed and unchanged", () => {
    const row = y => Array.from({ length: 16 }, (_, x) => ((x + y) % 2 ? "1" : "2")).join("")
    const f4 = encodeImage(Array.from({ length: 16 }, (_, y) => row(y)))
    const record = encodeRecord(f4)
    assert.equal(isUncompressed(record), true)
    assert.deepEqual(record, f4)
})

test("encodeRecord rejects a buffer that is not an image", () => {
    assert.throws(() => encodeRecord(Buffer.from([0x00, 0x04, 1, 0, 1, 0, 0, 0, 0])), /not an F4/)
})

test("records round-trip for many sizes and kinds of pixels", () => {
    const rand = seeded(1)
    const sizes = [[1, 1], [1, 9], [9, 1], [7, 7], [16, 16], [16, 17], [33, 5], [5, 33]]
    for (const [w, h] of sizes) {
        for (const kind of ["noise", "runs", "blank"]) {
            let color = 0
            const rows = Array.from({ length: h }, () =>
                Array.from({ length: w }, () => {
                    if (kind === "blank") return "."
                    if (kind === "noise" || rand() < 0.1) color = Math.floor(rand() * 16)
                    return color.toString(16)
                }).join(""),
            )
            const f4 = encodeImage(rows)
            const record = encodeRecord(f4)
            assert.ok(record.length <= f4.length, `${w}x${h} ${kind}: record grew`)
            assert.deepEqual(decodeRecord(record), zeroPadding(f4), `${w}x${h} ${kind}`)
            assert.equal(recordLength(record), record.length, `${w}x${h} ${kind}: length`)
        }
    }
})

test("decodeRecord and recordLength read a record at an offset", () => {
    const f4 = encodeImage(Array(8).fill("11112222"))
    const record = encodeRecord(f4)
    const blob = Buffer.concat([Buffer.from([0xff, 0xff, 0xff]), record])
    assert.deepEqual(decodeRecord(blob, 3), zeroPadding(f4))
    assert.equal(recordLength(blob, 3), record.length)
})

test("decodeRecord rejects what it cannot read", () => {
    const record = encodeRecord(encodeImage(Array(8).fill("11111111")))
    const withMarker = m => {
        const b = Buffer.from(record)
        b.writeUInt16LE(m, 6)
        return b
    }
    assert.throws(() => decodeRecord(withMarker(0xa000)), /not a record/)
    assert.throws(() => decodeRecord(withMarker(0xc002)), /unknown method 2/)
    assert.throws(() => decodeRecord(Buffer.from([0x12, 0x04, 1, 0, 1, 0, 0, 0])), /magic/)
})

// ui-core's device tests carry records made by this encoder. If the encoder
// or the art changes, those vectors are stale and the device tests stop
// meaning anything, so this checks them against what the encoder makes now.
test("the device test vectors match what the encoder produces", () => {
    const testTs = readFileSync(join(uiCore, "test.ts"), "utf8")
    const vector = name => hex(new RegExp(`const ${name} = hex${"`"}([0-9a-f]*)${"`"}`).exec(testTs)[1])

    const icons = readFileSync(join(uiCore, "icons.ts"), "utf8")
    const missing = scanLiterals(icons, "icons.ts").find(l => l.constName === "MISSING")
    assert.deepEqual(encodeRecord(encodeImage(missing.rows)), vector("rleRecord"))

    const checker = /const checker = bmp`([^`]*)`/.exec(testTs)[1]
    assert.deepEqual(encodeRecord(encodeImage(checker)), vector("uncompressedRecord"))
})
