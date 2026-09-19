import { test } from "node:test"
import assert from "node:assert/strict"

import { buildPack } from "../pack.mjs"
import { emitImgG } from "../emit.mjs"
import { encodeImage, decodeRecord } from "../codec.mjs"

const solid = c => Array(8).fill(c.repeat(8))

test("a pack decodes every image back to its pixels", () => {
    const images = [
        { name: "a", rows: solid("1") },
        { name: "b", rows: ["12", "34"] },
        { name: "c", rows: solid("2") },
    ]
    const pack = buildPack(images)
    assert.equal(pack.entries.length, 3)
    images.forEach((img, i) => {
        const expected = encodeImage(img.rows)
        expected.writeUInt16LE(0, 6)
        const offset = pack.offsets.readUInt16LE(i * 2)
        assert.deepEqual(decodeRecord(pack.blob, offset), expected, img.name)
    })
})

test("identical images share one record", () => {
    const pack = buildPack([
        { name: "a", rows: solid("1") },
        { name: "b", rows: solid("2") },
        { name: "c", rows: solid("1") },
    ])
    assert.equal(pack.offsets.readUInt16LE(0), pack.offsets.readUInt16LE(4))
    assert.equal(pack.entries[2].shared, "a")
    assert.equal(pack.stats.unique, 2)
    assert.equal(pack.stats.shared, 1)
})

test("pack stats count bytes once per unique image", () => {
    const pack = buildPack([
        { name: "a", rows: solid("1") },
        { name: "b", rows: solid("1") },
    ])
    const raw = encodeImage(solid("1")).length
    assert.equal(pack.stats.rawBytes, raw)
    assert.equal(pack.stats.decodedWorstCase, raw)
    assert.equal(pack.stats.packBytes, pack.blob.length)
    assert.equal(pack.stats.offsetBytes, 4)
})

test("an image name must be unique and free of commas", () => {
    assert.throws(() => buildPack([{ name: "a", rows: ["1"] }, { name: "a", rows: ["2"] }]), /more than once/)
    assert.throws(() => buildPack([{ name: "a,b", rows: ["1"] }]), /comma/)
})

test("an empty pack is valid", () => {
    const pack = buildPack([])
    assert.equal(pack.blob.length, 0)
    assert.match(emitImgG(pack, {}, {}, []), /export const count = 0/)
})

test("only the lookups an app uses are emitted", () => {
    const pack = buildPack([{ name: "a", rows: ["1"] }])
    const none = emitImgG(pack, {}, {}, [])
    assert.doesNotMatch(none, /KEYS|NUM_INDEX/)

    const namesOnly = emitImgG(pack, { a: 0 }, {}, [])
    assert.match(namesOnly, /const KEYS = "a"\.split/)
    assert.doesNotMatch(namesOnly, /NUM_INDEX/)

    const numericOnly = emitImgG(pack, {}, { 3: 0 }, [])
    assert.match(numericOnly, /NUM_INDEX/)
    assert.doesNotMatch(numericOnly, /KEYS/)
})

test("the numeric table holds index + 1 per key, 0 for keys with no image", () => {
    const pack = buildPack([{ name: "a", rows: ["1"] }, { name: "b", rows: ["2"] }])
    const src = emitImgG(pack, {}, { 1: 0, 3: 1 }, [])
    const table = /const NUM_INDEX = hex`([0-9a-f]*)`/.exec(src)[1]
    assert.equal(table, "00010002")
    assert.match(src, /key >= 4\) return -1/)
})

test("index tables widen past 255 images", () => {
    const images = Array.from({ length: 300 }, (_, i) => ({ name: "i" + i, rows: ["1"] }))
    const pack = buildPack(images)
    const src = emitImgG(pack, { i299: 299 }, { 0: 299 }, [])
    assert.match(src, /KEY_INDEX\.getNumber\(NumberFormat\.UInt16LE/)
    assert.match(src, /NUM_INDEX\.getNumber\(NumberFormat\.UInt16LE/)
})
