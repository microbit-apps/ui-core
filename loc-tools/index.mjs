// Public localization tooling API.
//
// A consuming app builds a thin wrapper over runLocGen, supplying its root and
// any app-specific hooks (see loc-tools/README.md). Extraction, layer
// discovery, font coverage, and charset resolution are exposed for wrappers and
// tests that need the pieces directly.

export { runLocGen, runCoverageMode } from "./gen.mjs"
export { extractCatalog, runLocStrings } from "./extract.mjs"
export { discoverLayers, mergeLayers, readCatalog } from "./catalogs.mjs"
export { createFontProvider, parseFontCoverage, defaultTextPath, toHexCp } from "./fonts.mjs"
export { resolveCharsets, validateCharsets } from "./charsets.mjs"
export { emitLocG, writeDefault, GENERIC_DEFAULT_LOC_G } from "./emit.mjs"
