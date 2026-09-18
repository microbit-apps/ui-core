import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { encodeImage } from "../codec.mjs"
import { bmpConst, ns, makeProject, removeProject } from "./helpers.mjs"

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "img-gen.mjs")
const ROWS = Array(8).fill("11112222")

function imgGen(root, ...args) {
    const r = spawnSync(process.execPath, [BIN, ...args], { cwd: root, encoding: "utf8" })
    return { code: r.status, out: r.stdout, err: r.stderr }
}

function app(files = {}) {
    return makeProject({
        "pxt.json": { name: "app", files: ["a.ts", "img.g.ts"] },
        "a.ts": ns("icons", bmpConst("disk", ROWS, ["packable", "whenUsed"])),
        ...files,
    })
}

test("with no configuration it scaffolds a key table and writes img.g.ts", () => {
    const root = app()
    try {
        const r = imgGen(root)
        assert.equal(r.code, 0, r.err)
        assert.match(r.out, /wrote a starter with 1 string key/)
        assert.match(r.out, /img-gen: 1 images/)
        assert.ok(existsSync(join(root, "img.g.ts")))
        assert.ok(existsSync(join(root, "img.keys.json")))
    } finally {
        removeProject(root)
    }
})

test("img.config.json sets the key table path and output name", () => {
    const root = app({
        "img.config.json": { keysPath: "config/keys.json", outName: "images.g.ts" },
        "config/keys.json": { names: { save: "disk" } },
    })
    try {
        const r = imgGen(root)
        assert.equal(r.code, 0, r.err)
        assert.ok(existsSync(join(root, "images.g.ts")))
        assert.ok(!existsSync(join(root, "img.g.ts")))
        assert.match(readFileSync(join(root, "images.g.ts"), "utf8"), /const KEYS = "save"/)
    } finally {
        removeProject(root)
    }
})

test("an unknown config setting is an error, not ignored", () => {
    const root = app({ "img.config.json": { nameKeys: "all" } })
    try {
        const r = imgGen(root)
        assert.equal(r.code, 1)
        assert.match(r.err, /unknown setting\(s\) nameKeys; expected keysPath, outName, fallback, pins/)
    } finally {
        removeProject(root)
    }
})

test("a malformed config file is an error", () => {
    const root = app({ "img.config.json": "{ nope" })
    try {
        const r = imgGen(root)
        assert.equal(r.code, 1)
        assert.match(r.err, /img\.config\.json is not valid JSON/)
    } finally {
        removeProject(root)
    }
})

test("an unknown argument is an error", () => {
    const root = app()
    try {
        const r = imgGen(root, "--nope")
        assert.equal(r.code, 1)
        assert.match(r.err, /unknown argument\(s\) --nope/)
    } finally {
        removeProject(root)
    }
})

test("a failing run exits 1 with the problems and no stack trace", () => {
    const root = app({ "img.keys.json": { names: { a: "no_such_image" } } })
    try {
        const r = imgGen(root)
        assert.equal(r.code, 1)
        assert.match(r.err, /img-gen: 1 problem\(s\)/)
        assert.match(r.err, /no_such_image/)
        assert.doesNotMatch(r.err, /\n\s+at /)
    } finally {
        removeProject(root)
    }
})

test("--verbose adds the per-image breakdown", () => {
    const root = app({ "img.keys.json": { names: { disk: "disk" } } })
    try {
        const r = imgGen(root, "--verbose")
        assert.equal(r.code, 0, r.err)
        assert.match(r.out, /icons\.disk: 40 B -> \d+ B compressed @0/)
    } finally {
        removeProject(root)
    }
})

test("--check reports duplicates in the last build without regenerating", () => {
    const f4 = encodeImage(ROWS)
    const asm = `_hexlit1:\n .word pxt::buffer_vt\n .word ${f4.length}\n .hex ${f4.toString("hex")}\n`
    const root = app({ "img.keys.json": { names: { disk: "disk" } }, "built/out.asm": asm })
    try {
        const r = imgGen(root, "--check")
        assert.equal(r.code, 0, r.err)
        assert.match(r.out, /img-check: 1 packed image\(s\) also ship as buffers/)
        assert.ok(!existsSync(join(root, "img.g.ts")))
    } finally {
        removeProject(root)
    }
})
