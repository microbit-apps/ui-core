// Compressed image records.
//
// A record is a pxt F4 image header followed by a method-specific payload.
// The header's `padding` field carries the method:
//
//   0x0000   uncompressed -- the payload is raw F4 pixel data
//   0xC0nn   compressed by method nn (1, nibble RLE, is the only one defined)
//
// pxt writes `padding` as 0 and never reads it, so a plain `bmp` literal is
// already a valid uncompressed record and can be handed to `ofCompressed`
// unchanged. A buffer whose marker is neither 0 nor 0xC0-prefixed is
// rejected rather than read as an image.
//
// Nibble RLE: one byte per run, the high nibble the color and the low nibble
// the run length minus 1 (runs of 1 to 16), over the payload's nibble stream
// in storage order -- low nibble first, per-column padding included. A run of
// color 0 only advances the cursor, since a fresh buffer starts zeroed.
//
// Records are produced at build time by img-tools.
namespace bitmaps {
    const IMG_MAGIC = 0x87
    const IMG_BPP = 4
    const METHOD_UNCOMPRESSED = 0x0000
    const METHOD_SIGNATURE = 0xc000
    const METHOD_SIGNATURE_MASK = 0xff00
    const METHOD_RLE = 1

    /**
     * Size of the F4 buffer a record decodes to: the 8-byte header plus w
     * columns of h nibbles, each column padded to a 32-bit boundary.
     */
    function decodedSize(w: number, h: number): number {
        return 8 + (((h * 4 + 31) >> 5) << 2) * w
    }

    /**
     * Decodes one image record into a new Bitmap.
     *
     * Unlike `ofBuffer`, which wraps a flash buffer in place, this always
     * allocates: a record has to be expanded into RAM. Returns `null` when
     * `src` at `offset` is not a record this runtime understands.
     *
     * Records may be packed end to end, so `offset` selects one.
     */
    export function ofCompressed(src: Buffer, offset = 0): Bitmap {
        if (!src || offset < 0 || offset + 8 > src.length) return null
        if (src[offset] != IMG_MAGIC || src[offset + 1] != IMG_BPP) return null

        const w = src.getNumber(NumberFormat.UInt16LE, offset + 2)
        const h = src.getNumber(NumberFormat.UInt16LE, offset + 4)
        if (w <= 0 || h <= 0) return null
        const size = decodedSize(w, h)

        const marker = src.getNumber(NumberFormat.UInt16LE, offset + 6)
        if (marker == METHOD_UNCOMPRESSED) {
            // An uncompressed record is byte-for-byte an ordinary image.
            if (offset + size > src.length) return null
            return bitmaps.ofBuffer(src.slice(offset, size))
        }
        if ((marker & METHOD_SIGNATURE_MASK) != METHOD_SIGNATURE) return null
        if ((marker & 0xff) != METHOD_RLE) return null

        const out = Buffer.create(size)
        for (let i = 0; i < 8; ++i) out[i] = src[offset + i]
        // Keep pxt's zero-padding invariant, so no method value reaches a
        // buffer pxt inspects.
        out[6] = 0
        out[7] = 0

        let s = offset + 8
        let d = 16 // nibble cursor; the 8 header bytes are 16 nibbles
        const dEnd = size * 2
        while (d < dEnd) {
            if (s >= src.length) return null
            const run = src[s++]
            const color = run >> 4
            const count = (run & 15) + 1
            if (color) {
                for (let k = 0; k < count; ++k) {
                    out[d >> 1] |= color << ((d & 1) * 4)
                    ++d
                }
            } else {
                d += count
            }
        }
        return bitmaps.ofBuffer(out)
    }
}

namespace ui {
    /**
     * Lazily decoded access to a pack of image records.
     *
     * A pack is one buffer of records laid end to end plus a u16le offset
     * table, one entry per image index. Several indices may share an offset,
     * which is how identical images are kept once.
     *
     * An image is decoded on first use and kept for the life of the program.
     * Nothing is evicted, so a pack's fully decoded size is its worst-case
     * RAM cost.
     *
     * A record the runtime cannot read yields the fallback image rather than
     * null, so callers never have to null-check an image. The fallback is
     * `ui.MISSING` unless one is supplied, and it must not itself be packed --
     * were it a record, a decode failure would have nothing to fall back to.
     */
    export class ImagePack {
        private blob_: Buffer
        private offsets_: Buffer
        private fallback_: Bitmap
        private cache_: Bitmap[]
        private count_: number

        constructor(blob: Buffer, offsets: Buffer, fallback?: Bitmap) {
            this.blob_ = blob
            this.offsets_ = offsets
            // Normalized so the field is a Bitmap or null, never undefined.
            this.fallback_ = fallback ? fallback : null
            this.cache_ = []
            this.count_ = offsets.length >> 1
        }

        /** Number of image indices in the pack. */
        public get length(): number {
            return this.count_
        }

        private offsetAt(index: number): number {
            return this.offsets_.getNumber(NumberFormat.UInt16LE, index * 2)
        }

        private fallbackImage(): Bitmap {
            return this.fallback_ ? this.fallback_ : MISSING
        }

        /**
         * The image at `index`, decoding it on first use. Out-of-range
         * indices and unreadable records both yield the fallback.
         */
        public get(index: number): Bitmap {
            if (index < 0 || index >= this.count_) return this.fallbackImage()

            let img = this.cache_[index]
            if (img) return img

            const offset = this.offsetAt(index)
            // The same record may be shared by several indices; decode it
            // once so they hand back one object rather than equal copies.
            for (let i = 0; i < this.count_; ++i) {
                const cached = this.cache_[i]
                if (cached && this.offsetAt(i) == offset) {
                    img = cached
                    break
                }
            }
            if (!img) img = bitmaps.ofCompressed(this.blob_, offset)
            if (!img) img = this.fallbackImage()

            this.cache_[index] = img
            return img
        }
    }
}
