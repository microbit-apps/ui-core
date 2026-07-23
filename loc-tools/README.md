# Localization tooling

Build-time localization machinery shared by the microbit-apps stack. A consumer
depends on `@microbit-apps/ui-core` and drives this tooling through its API and
two bins. The runtime side (`ui.loc` and the `_loc` namespace) lives in
`loc.ts`; this directory is the Node-side build tooling only.

## Layout

- `catalogs.mjs` -- layer discovery and per-language catalog merge.
- `fonts.mjs` -- font glyph-coverage parsing.
- `extract.mjs` -- source-string extraction from `ui.loc(...)` call sites.
- `charsets.mjs` -- generic per-language field data (resolve + validate).
- `emit.mjs` -- `loc.g.ts` generation and default/restore content.
- `gen.mjs` -- the `runLocGen` / `runCoverageMode` orchestrator.
- `index.mjs` -- the public API (imported as `@microbit-apps/ui-core/loc`).
- `bin/loc-strings.mjs`, `bin/loc-gen.mjs` -- the CLI entry points.

## Bins

- `loc-strings [srcLang]` -- regenerate the calling project's
  `locales/<srcLang>.json` (default `en`) from the display strings passed to
  `ui.loc` / `ui.locf` / `ui.locc` in the files listed in `pxt.json`. Runs in
  the current working directory.
- `loc-gen [--coverage] [--verbose] [--keep] [lang ...]` -- per-language build
  for simple projects. Optional `loc.config.json` (see below). Projects that
  need app-specific hooks call `runLocGen` from their own wrapper instead.

## Layer discovery

Catalog layers are derived from the dependency graph, never hard-coded. For a
project rooted at `root`:

1. Walk the project's `pxt.json` dependencies transitively. Every dependency
   module resolved under `pxt_modules/<name>/` that ships a `locales/`
   directory becomes a layer, ordered so a library appears before any library
   that depends on it.
2. The project's own `locales/` is the final layer, named `app`.

Later layers win on merge, so the app overrides its libraries and a library
overrides its own dependencies. The same discovery drives translation catalogs
(`<lang>.json`) and charset data (`charsets.json`).

## Charsets

Any layer may ship `locales/charsets.json` carrying per-language field data:

```json
{
  "es": { "alphabetLower": "abc...", "alphabetUpper": "ABC...", "symbols": "+-*/" },
  "fr": { "accentsLower": "àâä...", "accentsUpper": "ÀÂÄ..." }
}
```

Each field is an arbitrary string. The tooling is agnostic: it never interprets
field names. Language resolution per layer is the exact language key, else the
base-language prefix (`es` serves `es-ES`). Fields merge across layers per
language, the app layer winning.

Resolved fields are hard-validated (a failure is an error, never a silent drop):

- a `<x>Lower` / `<x>Upper` field pair, when both are present, must have equal
  code-point length;
- no field may repeat a code point within itself;
- every code point of every field must exist in the build font's coverage.

Each resolved field is emitted into the generated `loc.g.ts` as a `_loc` member
assignment (`<field> = <json string>` inside `namespace _loc`). The library that
owns a field declares the matching `_loc` member (via namespace reopening in
that library's own source); this tooling only writes the assignment.

## runLocGen options

`runLocGen(options, langArgs)` runs the per-language build; `runCoverageMode`
runs the coverage report. Defaults make a bare consumer work with only `root`.

- `root` (required) -- project directory.
- `srcLang` -- source language (default `"en"`); its build ships no table.
- `langs` -- explicit language list; otherwise `langArgs`, otherwise the source
  language plus every discovered language.
- `reservedLangNames` -- non-language basenames in `locales/` to skip during
  auto-discovery (the source language and `charsets` are always skipped).
- `font` -- build font for glyph and charset validation (default `"font8"`).
- `textPath` -- font glyph-table source (default the display-shield `text.ts`).
- `hexDir`, `hexName(lang)` -- output directory and per-language file name
  (default `<root>/assets/hex` and `<pxt name>.<lang>.hex`).
- `defaultLocG` -- exact content restored to `loc.g.ts` after a run and written
  for the source build (required for a build run).
- `locGPath` -- the generated file (default `<root>/loc.g.ts`).
- `smallFontContext` -- `{ font, strings }`: source strings validated against a
  second (small) font instead of the build font, dropped when it cannot render
  them. `strings` is an array, a Set, or a function returning either.
- `exclude` -- `{ label, keys(merged) }`: source strings to drop from device
  tables (they ship by another route). `label` names the count in the summary.
- `extraInventory` -- extra coverage inventory beyond the layer source
  catalogs: entries of `{ path, mapper(catalog) }` or precomputed string arrays.
- `postMerge(lang, merged)` -- called after merge, before drops, for
  app-specific side outputs. `merged` is `null` for the source language.
- `coverage`, `verbose`, `keep` -- flags mirrored from the CLI.

## Thin-wrapper pattern

Apps with app-specific behavior wrap the API. The wrapper owns everything the
generic tool should not know about, and stays thin:

```js
import { runLocGen } from "@microbit-apps/ui-core/loc"

runLocGen(
    {
        root: ROOT,
        defaultLocG: DEFAULT_LOC_G,
        hexName: lang => `myapp.${lang}.hex`,
        // app-specific hooks: exclude, smallFontContext, extraInventory, postMerge
    },
    process.argv.slice(2).filter(a => !a.startsWith("--")),
)
```

A project with no such needs skips the wrapper entirely and uses the `loc-gen`
bin, optionally with a `loc.config.json` setting `srcLang`, `font`, `hexName`
(a pattern with a `<lang>` placeholder), `reservedLangNames`, `textPath`, or
`hexDir`.
