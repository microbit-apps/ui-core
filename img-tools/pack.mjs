// Pack assembly: records laid end to end, with a u16le offset per image index.
//
// Images with identical pixels share one record and one offset.
//
// Every record is decoded back out of the assembled blob and compared against
// the image it came from, so a mispacked blob fails the build rather than the
// device.

import { encodeImage, encodeRecord, decodeRecord, isUncompressed, recordLength } from "./codec.mjs"

const OFFSET_LIMIT = 0x10000

/**
 * Builds a pack from `images`, an array of { name, rows } in index order.
 *
 * Returns { blob, offsets, entries, indexByName, stats }. `entries` carries one
 * record per index, with `shared` naming the earlier image it reuses, if any.
 * `stats` totals the counts and byte sizes for reporting.
 */
export function buildPack(images) {
    const chunks = []
    const entries = []
    const indexByName = new Map()
    const offsetByContent = new Map()
    let off = 0

    images.forEach((img, index) => {
        if (indexByName.has(img.name))
            throw new Error(`image "${img.name}" is declared more than once`)
        if (img.name.indexOf(",") >= 0)
            throw new Error(`image name "${img.name}" may not contain a comma`)

        const f4 = encodeImage(img.rows)
        const key = f4.toString("hex")
        const seen = offsetByContent.get(key)
        if (seen !== undefined) {
            entries.push({ ...img, index, offset: seen.offset, f4, uncompressed: seen.uncompressed,
                           recordBytes: 0, rawBytes: f4.length, shared: seen.name })
            indexByName.set(img.name, index)
            return
        }

        let record
        try {
            record = encodeRecord(f4)
        } catch (e) {
            throw new Error(`encoding "${img.name}" failed: ${e.message}`)
        }
        const uncompressed = isUncompressed(record)
        offsetByContent.set(key, { offset: off, uncompressed, name: img.name })
        entries.push({ ...img, index, offset: off, f4, uncompressed,
                       recordBytes: record.length, rawBytes: f4.length, shared: null })
        indexByName.set(img.name, index)
        chunks.push(record)
        off += record.length
    })

    if (off >= OFFSET_LIMIT)
        throw new Error(`pack is ${off} bytes, past the ${OFFSET_LIMIT}-byte range of a u16 offset table`)

    const blob = Buffer.concat(chunks)
    const offsets = Buffer.alloc(2 * entries.length)
    entries.forEach((e, i) => offsets.writeUInt16LE(e.offset, 2 * i))

    verifyPack(blob, entries)

    const unique = entries.filter(e => !e.shared)
    const stats = {
        images: entries.length,
        unique: unique.length,
        shared: entries.length - unique.length,
        uncompressed: unique.filter(e => e.uncompressed).length,
        compressed: unique.filter(e => !e.uncompressed).length,
        rawBytes: unique.reduce((n, e) => n + e.rawBytes, 0),
        packBytes: blob.length,
        offsetBytes: offsets.length,
        // RAM cost once every image is decoded; ui.ImagePack never evicts.
        decodedWorstCase: unique.reduce((n, e) => n + e.f4.length, 0),
    }
    return { blob, offsets, entries, indexByName, stats }
}

/** Decodes every record out of the assembled blob and compares it to its source. */
function verifyPack(blob, entries) {
    for (const e of entries) {
        let back
        try {
            back = decodeRecord(blob, e.offset)
        } catch (err) {
            throw new Error(`"${e.name}" does not decode at offset ${e.offset}: ${err.message}`)
        }
        const expected = Buffer.from(e.f4)
        expected.writeUInt16LE(0, 6)
        if (!back.equals(expected))
            throw new Error(`"${e.name}" decodes to different pixels at offset ${e.offset}`)
        if (!e.shared) {
            const len = recordLength(blob, e.offset)
            if (len !== e.recordBytes)
                throw new Error(`"${e.name}" record is ${e.recordBytes} bytes but walks as ${len}`)
        }
    }
}
