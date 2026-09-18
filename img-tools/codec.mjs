// Build-time encoder for compressed image records. The device-side decoder
// is `bitmaps.ofCompressed` in img.ts, and the record format is documented
// there. These two must agree byte for byte, which is why a consumer has to
// pin the same ui-core ref for its build tooling and its device code.
//
// Typical use:
//
//   import { encodeImage, encodeRecord } from "@microbit-apps/ui-core/img"
//   const f4 = encodeImage(rows)       // rows as the pixel editor prints them
//   const record = encodeRecord(f4)    // smallest method, always a record
//
// `encodeRecord` round-trips every record through `decodeRecord` and throws
// on a mismatch, so a bad stream fails the build rather than the device.

const MAGIC = 0x87
const BPP = 4
const METHOD_UNCOMPRESSED = 0x0000
const METHOD_SIGNATURE = 0xc000
const METHOD_RLE = 1

/** Decoded size of an F4 buffer: header plus 32-bit-padded columns. */
function decodedSize(w, h) {
    return 8 + (((h * 4 + 31) >> 5) << 2) * w
}

/**
 * Encodes pixel rows into an F4 image buffer, byte-identical to what the pxt
 * compiler emits for a `bmp` literal. `rows` is an array of row strings
 * ("." is transparent, a hex digit is a color, whitespace is ignored), or a
 * single string with embedded newlines.
 */
export function encodeImage(rows) {
    rows = (Array.isArray(rows) ? rows : rows.split("\n"))
        .map(r => r.replace(/\s+/g, ""))
        .filter(r => r.length > 0)
    if (rows.length === 0) throw new Error("image has no rows")
    const w = Math.max(...rows.map(r => r.length))
    const h = rows.length
    const colBytes = ((h * 4 + 31) >> 5) << 2
    const buf = Buffer.alloc(8 + colBytes * w)
    buf[0] = MAGIC
    buf[1] = BPP
    buf.writeUInt16LE(w, 2)
    buf.writeUInt16LE(h, 4)
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
            const ch = rows[y][x] || "."
            const v = ch === "." ? 0 : parseInt(ch, 16)
            if (Number.isNaN(v)) throw new Error(`bad pixel ${ch}`)
            const off = 8 + x * colBytes + (y >> 1)
            if (y & 1) buf[off] |= v << 4
            else buf[off] |= v
        }
    }
    return buf
}

/** Run-length encodes an F4 payload's nibble stream. */
function rleNibble(payload) {
    const nibbles = []
    for (const b of payload) nibbles.push(b & 15, b >> 4)
    const out = []
    let i = 0
    while (i < nibbles.length) {
        let j = i
        while (j < nibbles.length && nibbles[j] === nibbles[i] && j - i < 16)
            j++
        out.push((nibbles[i] << 4) | (j - i - 1))
        i = j
    }
    return Buffer.from(out)
}

/**
 * Encodes an F4 buffer into a record, using whichever method is smallest.
 * Always returns a record, and never one larger than the image it holds.
 */
export function encodeRecord(f4) {
    if (f4[0] !== MAGIC || f4[1] !== BPP)
        throw new Error("not an F4 image buffer (magic/bpp mismatch)")
    const payload = f4.slice(8)
    const packed = rleNibble(payload)

    const header = Buffer.from(f4.slice(0, 8))
    let record
    if (packed.length < payload.length) {
        header.writeUInt16LE(METHOD_SIGNATURE | METHOD_RLE, 6)
        record = Buffer.concat([header, packed])
    } else {
        header.writeUInt16LE(METHOD_UNCOMPRESSED, 6)
        record = Buffer.concat([header, payload])
    }

    const check = decodeRecord(record)
    const expected = Buffer.from(f4)
    expected.writeUInt16LE(0, 6)
    if (!check.equals(expected)) throw new Error("record round-trip failed")
    return record
}

/** True when `encodeRecord` left this record uncompressed. */
export function isUncompressed(record, offset = 0) {
    return record.readUInt16LE(offset + 6) === METHOD_UNCOMPRESSED
}

/**
 * Decodes one record back into an F4 buffer, with the padding field zeroed.
 * Reference implementation of the device-side `bitmaps.ofCompressed`.
 *
 * Throws when `src` at `offset` is not a record.
 */
export function decodeRecord(src, offset = 0) {
    if (src[offset] !== MAGIC || src[offset + 1] !== BPP)
        throw new Error("not a record (magic/bpp mismatch)")
    const w = src.readUInt16LE(offset + 2)
    const h = src.readUInt16LE(offset + 4)
    const size = decodedSize(w, h)
    const marker = src.readUInt16LE(offset + 6)

    const out = Buffer.alloc(size)
    src.copy(out, 0, offset, offset + 8)
    out.writeUInt16LE(0, 6)

    if (marker === METHOD_UNCOMPRESSED) {
        src.copy(out, 8, offset + 8, offset + size)
        return out
    }
    if ((marker & 0xff00) !== METHOD_SIGNATURE)
        throw new Error(`not a record (marker 0x${marker.toString(16)})`)
    if ((marker & 0xff) !== METHOD_RLE)
        throw new Error(`unknown method ${marker & 0xff}`)

    let s = offset + 8
    let d = 16
    const dEnd = size * 2
    while (d < dEnd) {
        const run = src[s++]
        const color = run >> 4
        const count = (run & 15) + 1
        if (color) {
            for (let k = 0; k < count; k++) {
                out[d >> 1] |= color << ((d & 1) * 4)
                d++
            }
        } else {
            d += count
        }
    }
    return out
}

/** Byte length of the record starting at `offset`. */
export function recordLength(src, offset = 0) {
    const w = src.readUInt16LE(offset + 2)
    const h = src.readUInt16LE(offset + 4)
    if (src.readUInt16LE(offset + 6) === METHOD_UNCOMPRESSED) return decodedSize(w, h)
    // A compressed payload is walked to find its end.
    const size = decodedSize(w, h)
    let s = offset + 8
    let d = 16
    while (d < size * 2) {
        const run = src[s++]
        d += (run & 15) + 1
    }
    return s - offset
}
