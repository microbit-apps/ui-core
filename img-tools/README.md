# Image packing

`img-tools` compresses an app's `bmp` image literals into a single packed
buffer at build time and generates a keyed lookup for them, `_img.get(key)`.
On a typical icon set, pixel data shrinks by around 45%, and the per-image
const overhead goes away too.

Images stay authored as ordinary `bmp` literals in your source. You annotate
the ones to pack, map your lookup keys to them in a key table, and run the
generator before building.

## Is it right for your app?

Packing trades flash for heap.

- An unpacked `bmp` literal is drawn directly from flash and uses no heap.
- A packed image is decoded into the heap on its first `_img.get`, and the
  decoded bitmap is cached for the lifetime of the program. Nothing is evicted.

Heap cost therefore scales with the number of distinct images accessed over a
session, not with how many are on screen at once. An app that eventually draws
every packed image holds all of them decoded. The generator reports that worst
case on every run:

```
img-gen: ... 17648 B RAM if all decoded
```

Packing fits if your app can afford that on top of its normal heap usage.
Verify it on a device with a session that reaches every screen. If the heap is
tight, pack selectively: rarely drawn images cost heap only when they are
drawn, while images drawn in every session always cost their full decoded size.

## Setup

**1. Pin the same ui-core version on both dependency channels.** The encoder
runs from your npm devDependency; the decoder ships in your pxt dependency.
`runImageGen` compares the resolved versions (the `version` in each side's
`pxt.json`) and fails on a mismatch.

```json
// package.json
"devDependencies": {
    "@microbit-apps/ui-core": "github:microbit-apps/ui-core#v0.0.9"
}
```

In `pxt.json`, ui-core can be a direct or transitive dependency.

**2. Add a script for the `img-gen` bin.** It runs from the project root.

```json
// package.json
"scripts": {
    "img:gen": "img-gen"
}
```

Settings are optional and go in `img.config.json`, beside `pxt.json`. See
[Configuration](#configuration).

**3. Add the generated file to `pxt.json`.** The generator writes `img.g.ts`,
which defines the `_img` namespace. List it in `files` ahead of any file that
uses `_img` at top level, since file order sets global initialization order.
Commit it: the project does not build without it.

```json
"files": ["img.g.ts", "assets.ts", "..."]
```

## Marking an image to pack

```ts
namespace icons {
    //% packable
    //% whenUsed
    export const thermometer = bmp`
        . 1 1 .
        . 1 1 .
        . 1 1 .
        1 2 2 1
    `
}
```

- `//% packable` makes the const eligible for packing. The image is identified
  by its const name, `thermometer`, or `icons.thermometer` when qualified.
- `//% whenUsed` makes the const tree-shakable, so once nothing references it
  the literal is dropped from the binary. Without it the literal ships
  regardless, and packing would duplicate the image, so the generator skips it
  with a warning.

The two attributes can also share a line: `//% packable whenUsed`.

The literal remains the source of truth. Edit it in place and regenerate.

## The key table

`img.keys.json`, beside `pxt.json`, maps your lookup keys to images:

```json
{
    "numeric": {
        "16": "thermometer",
        "180": "thermometer"
    },
    "names": {
        "delete": "btn_delete",
        "thermometer": "thermometer"
    }
}
```

- **`numeric`** maps integer keys, such as existing tile or item ids. It
  generates a flat table indexed by key, with one entry per integer up to the
  largest key, so keep keys small. Several keys can map to the same image.
- **`names`** maps string keys. The generated name index holds exactly the keys
  listed here, so list every string key you look up, including identity
  mappings like `"thermometer": "thermometer"`. String keys cannot contain
  commas.

Both sections are optional. Each packable image needs at least one key; an
image no key reaches could never be retrieved, so the generator excludes it
with a warning.

If `img.keys.json` doesn't exist, the generator writes a starter table and uses
it for that run: one identity string key per app image that can be packed.
Images excluded for another reason, such as a missing `//% whenUsed`, are
omitted, so the starter never references an image the next run would reject.
The run reports that it wrote one and asks you to review it. Check it before
relying on it: each string key is the image's own name, which may not be the key
your code passes to `_img.get`; there are no numeric keys; and every packable app
image is listed, including any your app never draws. An existing
table is never overwritten.

An image can be referenced by its bare const name or by its namespace-qualified
name. See [Using a library's images](#using-a-librarys-images).

## Running the generator

```sh
npm run img:gen
```

Run it before building, and after any change to a packed image or the key
table. A clean run prints a summary:

```
img-gen: 110 images (110 unique, 0 shared), 110 compressed, 0 uncompressed; 17648 B -> 9653 B (7995 B saved, 45.3%); 17648 B RAM if all decoded
img-gen: name index holds 24 key(s), about 285 B
```

`--verbose` adds a per-image breakdown: compressed size, and whether each image
was compressed, left uncompressed, or shares another image's record. It also
shows notes that are otherwise hidden. Errors exit with status 1.

## Retrieving images

```ts
const img = _img.get(16)          // numeric key
const del = _img.get("delete")    // string key
```

`_img.get(key: string | number, nullIfMissing?: boolean)` returns the pack's
fallback image (`ui.MISSING`) for an unknown key, so callers never need a null
check. With `nullIfMissing`, it returns `undefined` instead:

```ts
const maybe = _img.get("delete", true)
if (maybe) draw(maybe)
```

Because decoded bitmaps are cached, every key that resolves to the same image
returns the same `Bitmap` instance.

`img.g.ts` also exports `_img.count` and `_img.byIndex(i)` for iterating the
pack, and `_img.indexOfKey` / `_img.indexOfName` when the corresponding key
type is in use.

## Using a library's images

A dependency's images are packed only if your key table references them, and
only if the library marks them `//% packable`. Referencing one moves it into
your pack, and the library's literal is tree-shaken out.

```json
"numeric": { "16": "ui.thermometer" }
```

Qualify the name with the declaring namespace. A bare name resolves to your
app's declaration when one exists, so `"thermometer"` would resolve to your own
`thermometer`, not `ui.thermometer`. The generator reports a bare-name
collision between two dependencies, or within your app; one between your app
and a dependency only shows with `--verbose`, since the bare name already
resolves to your own image.

**For library authors:** consumers' key tables reference your images by const
name, which makes those names part of your public API. To rename a const
without breaking consumers, keep the published name with
`//% packable="thermometer"`.

## Web-only images

Images used only by code that isn't compiled for hardware, such as the body of
a `//% shim=TD_NOOP` function, should be `//% whenUsed` without `//% packable`.
They are tree-shaken from the hardware build as-is.

## Diagnostics

| Message | Severity | Meaning and fix |
|---|---|---|
| `key table names "x", which no package declares` | error | The key table references an unknown image. Fix the name, or annotate the const `//% packable`. |
| `key table names x, which cannot be packed` | error | The key table references an image that was excluded. The preceding note gives the reason. |
| `resolves to 0.0.8 for build tooling but 0.0.9 for device code` | error | npm and pxt resolve different ui-core versions. Pin both to the same one. |
| `is //% packable but not //% whenUsed` | warning (info for a dependency's image) | Add `//% whenUsed`. |
| `no key in the key table reaches it, so it is left out` | warning | Add a key, or drop `//% packable`. |
| `is still referenced as x, so it stays a literal` | info | Code references the const directly, so it can't be removed. Retrieve it through `_img.get` instead, or leave it unpacked. |
| `"x" matches both a.x and b.x` | info (detail if one is your app's) | A bare `"x"` is ambiguous. The message names the image it resolves to and the qualified name to write for the other. When one of them is yours, a bare name resolves to yours, so the note only shows with `--verbose`. |
| `has the same pixels as x ... costing N B twice` | info (warning if `x` is yours) | A packed image is pixel-identical to a literal that still ships. Remove one if you can. |

Errors abort the run and are reported together. Warnings and info never abort.

## Checking a build

After building, `img-gen --check` scans the compiled output (`built/*.asm`) for
image buffers byte-identical to a packed image, which would mean the image ships
twice. It regenerates nothing.

```sh
npx img-gen --check
```

```
img-check: 29 image buffer(s) in 1 output(s), none duplicating the pack
```

It reports only and never fails.

## Configuration

`img.config.json` is optional. Every setting has a default, and unknown settings
are rejected.

| Setting | Default | Description |
|---|---|---|
| `keysPath` | `img.keys.json` | Key table path, relative to the project root. |
| `outName` | `img.g.ts` | Generated file name. |
| `fallback` | none | Image to keep out of the pack because the app uses it as its missing-image placeholder. |
| `pins` | `true` | `false` skips the ui-core version check. |

```json
{
    "keysPath": "assets/img.keys.json",
    "fallback": "placeholder"
}
```

### Calling it from a script

For anything the config doesn't cover, such as running without writing or
capturing output, call the API directly. It takes the same settings, plus:

| Option | Default | Description |
|---|---|---|
| `root` | required | Project directory containing `pxt.json`. |
| `verbose` | `false` | Same as `--verbose`. |
| `write` | `true` | `false` runs everything but writing `img.g.ts` or a starter key table. |
| `log` | `console.log` | Receives each line of output. |

`keysPath` is a path here, resolved as given rather than against `root`.

```js
import { runImageGen, runImageCheck } from "@microbit-apps/ui-core/img"

const result = runImageGen({ root, write: false, log: () => {} })
runImageCheck({ root, pack: result.pack })
```

`runImageGen` throws on errors and otherwise returns what it decided: the pack,
the resolved keys, the diagnostics, and the generated source.

## Future directions

**LRU eviction.** Decoded bitmaps are currently cached for the program's
lifetime. An opt-in LRU cache could bound heap use by evicting the least
recently used bitmaps and decoding them again on the next access.

Eviction only reclaims heap for a bitmap that has no other live references, and
retained-mode widgets keep references to their bitmaps for as long as they
exist. Evicting a bitmap that a widget still holds reclaims nothing, and the
next `_img.get` for that image decodes a second copy, which increases heap use.
pxt has no weak references, so the cache can't tell held bitmaps from free ones.

LRU therefore suits draw paths that call `_img.get` at draw time and don't
retain the result. It would also drop the guarantee that a key always returns
the same `Bitmap` instance.
