// Public image compression tooling API.
//
// The codec works with the F4 buffers that `bmp` literals compile to: an
// 8-byte header followed by 4-bit pixel data, column by column.
//
// A consuming app builds a thin wrapper over runImageGen, supplying its root
// and any app-specific keys, and calls runImageCheck after a build to see what
// the pack duplicates. The codec, scanner, package discovery, key table reader,
// packer, emitter and pin check are exposed for wrappers and tests that need
// the pieces directly.

export { encodeImage, encodeRecord, decodeRecord, isUncompressed, recordLength } from "./codec.mjs"
export { runImageGen } from "./gen.mjs"
export { runImageCheck, imagesInBuild, findBuildOutputs } from "./verify.mjs"
export { scanSource, scanLiterals, countReferences, stripBlockComments } from "./scan.mjs"
export { discoverPackages } from "./packages.mjs"
export { readKeyTable, emptyKeyTable, referencedNames } from "./keys.mjs"
export { buildPack } from "./pack.mjs"
export { emitImgG } from "./emit.mjs"
export { checkPins } from "./pins.mjs"
