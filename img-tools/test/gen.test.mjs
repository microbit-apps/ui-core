import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { runImageGen } from "../gen.mjs"
import { bmpConst, ns, makeProject, removeProject, captureLog } from "./helpers.mjs"

const P = ["packable", "whenUsed"]

// An app with two dependencies, exercising every way an image can be packed
// or left out.
function project(keys, extra = {}) {
    return makeProject({
        "pxt.json": {
            name: "app",
            dependencies: { lib: "*", other: "*" },
            files: ["assets.ts", "draw.ts", "img.g.ts"],
            testFiles: ["test.ts"],
        },
        "assets.ts": ns(
            "icondb",
            bmpConst("own", ["1 2"], P),
            bmpConst("referenced", ["3 4"], P),
            bmpConst("loose", ["5 6"], ["packable"]),
            bmpConst("twin_of_lib", ["7 7"], P),
            bmpConst("no_key", ["d d"], P),
            bmpConst("renamedSinceRelease", ["a a"], ['packable="stable_name"', "whenUsed"]),
            bmpConst("microphone", ["b b"], P),
        ),
        "draw.ts": ns("app", "    export function draw() { return icondb.referenced }"),
        "test.ts": ns("t", bmpConst("in_a_test_file", ["9"], P)),
        "pxt_modules/lib/pxt.json": { name: "lib", files: ["icons.ts"] },
        "pxt_modules/lib/icons.ts": ns(
            "lib",
            bmpConst("from_lib", ["8 8"], P),
            bmpConst("lib_unwanted", ["a b"], P),
            bmpConst("microphone", ["c c"], P),
            bmpConst("shared_icon", ["e e"], P),
            bmpConst("plainTwin", ["7 7"]),
            bmpConst("sharedWithOther", ["c d"]),
        ),
        "pxt_modules/other/pxt.json": { name: "other", files: ["icons.ts"] },
        "pxt_modules/other/icons.ts": ns(
            "other",
            bmpConst("sharedWithLib", ["c d"]),
            bmpConst("shared_icon", ["f f"], P),
        ),
        ...(keys ? { "img.keys.json": keys } : {}),
        ...extra,
    })
}

const KEYS = {
    numeric: { 3: "own" },
    names: {
        own: "own",
        twin: "twin_of_lib",
        borrowed: "from_lib",
        stable: "stable_name",
        mic_app: "microphone",
        mic_lib: "lib.microphone",
    },
}

function run(keys, options = {}, extra) {
    const root = project(keys, extra)
    const log = captureLog()
    try {
        const result = runImageGen({ root, write: false, log, ...options })
        return { result, log, error: null }
    } catch (error) {
        return { result: null, log, error }
    } finally {
        removeProject(root)
    }
}

const notes = (result, severity) => result.diagnostics.filter(n => n.severity === severity).map(n => n.text)
const packed = result => result.pack.entries.map(e => e.name).sort()

test("packs the app's images and the dependency images its key table names", () => {
    const { result, error } = run(KEYS)
    assert.equal(error, null)
    assert.deepEqual(packed(result), [
        "icondb.microphone",
        "icondb.own",
        "icondb.stable_name",
        "icondb.twin_of_lib",
        "lib.from_lib",
        "lib.microphone",
    ])
})

test("keys resolve to the right images", () => {
    const { result } = run(KEYS)
    const at = i => result.pack.entries[i].name
    assert.equal(at(result.numeric[3]), "icondb.own")
    assert.equal(at(result.names.stable), "icondb.stable_name")
    assert.equal(at(result.names.borrowed), "lib.from_lib")
    assert.equal(at(result.names.mic_app), "icondb.microphone")
    assert.equal(at(result.names.mic_lib), "lib.microphone")
})

test("each image left out is reported once, for its own reason", () => {
    const { result } = run(KEYS)
    const warnings = notes(result, "warning")
    const infos = notes(result, "info")
    assert.equal(warnings.length, 2)
    assert.match(warnings.find(t => t.includes("loose")), /not \/\/% whenUsed/)
    assert.match(warnings.find(t => t.includes("no_key")), /no key in the key table reaches it/)
    assert.match(infos.find(t => t.includes("icondb.referenced")), /still referenced as referenced/)
    assert.match(infos.find(t => t.includes("twin_of_lib")), /same pixels as plainTwin.*costing 16 B twice/)
})

test("images in testFiles are never discovered", () => {
    const { result } = run(KEYS)
    assert.ok(!result.diagnostics.some(n => n.text.includes("in_a_test_file")))
    assert.ok(!packed(result).some(n => n.includes("in_a_test_file")))
})

test("a duplicate between two dependencies only shows when verbose", () => {
    const quiet = run(KEYS)
    assert.doesNotMatch(quiet.log.text(), /identical images in dependencies/)
    const verbose = run(KEYS, { verbose: true })
    assert.match(verbose.log.text(), /identical images in dependencies: lib\/sharedWithOther, other\/sharedWithLib/)
})

test("a key naming an image nothing declares fails the run", () => {
    const { error, log } = run({ names: { a: "no_such_image" } })
    assert.match(error.message, /1 problem\(s\)/)
    assert.match(error.message, /"no_such_image", which no package declares/)
    assert.match(log.text(), /no_such_image/)
})

test("a key naming an image that cannot be packed fails, after saying why", () => {
    const { error, log } = run({ names: { a: "loose" } })
    assert.match(error.message, /icondb\.loose, which cannot be packed/)
    assert.match(log.text(), /warning: .*icondb\.loose is \/\/% packable but not \/\/% whenUsed/)
})

test("every problem is reported at once", () => {
    const { error } = run({ names: { a: "nope1", b: "nope2" } })
    assert.match(error.message, /2 problem\(s\)/)
    assert.match(error.message, /nope1/)
    assert.match(error.message, /nope2/)
})

test("mismatched ui-core versions fail the run", () => {
    const { error } = run(KEYS, {}, {
        "node_modules/@microbit-apps/ui-core/pxt.json": { version: "0.0.8" },
        "pxt_modules/ui-core/pxt.json": { version: "0.0.9" },
    })
    assert.match(error.message, /0\.0\.8 for build tooling but 0\.0\.9 for device code/)
})

test("the same image declared twice in the app fails the run", () => {
    const { error } = run(KEYS, {}, { "draw.ts": ns("icondb", bmpConst("own", ["f"], P)) })
    assert.match(error.message, /icondb\.own is declared twice in app/)
})

test("the fallback image stays out of the pack", () => {
    const { result } = run(KEYS, { fallback: "no_key" })
    assert.ok(!packed(result).includes("icondb.no_key"))
    assert.match(notes(result, "info").join("\n"), /icondb\.no_key is the pack's fallback image/)
    assert.ok(!notes(result, "warning").some(t => t.includes("no_key")))
})

test("the generated file is written only when asked, and matches the result", () => {
    const root = project(KEYS)
    try {
        runImageGen({ root, write: false, log: () => {} })
        assert.equal(existsSync(join(root, "img.g.ts")), false)
        const result = runImageGen({ root, log: () => {} })
        assert.equal(readFileSync(join(root, "img.g.ts"), "utf8"), result.source)
        assert.match(result.source, /^namespace _img \{$/m)
        assert.match(result.source, /\/\/ {3}app\/assets\.ts/)
        assert.match(result.source, /\/\/ {3}lib\/icons\.ts/)
    } finally {
        removeProject(root)
    }
})

test("a run prints a one-line summary", () => {
    const { log } = run(KEYS)
    assert.match(log.text(), /img-gen: 6 images \(6 unique, 0 shared\)/)
    assert.match(log.text(), /RAM if all decoded/)
})

test("a missing key table is scaffolded with every image that can be packed", () => {
    const root = project(null)
    try {
        const log = captureLog()
        const result = runImageGen({ root, log })
        const written = JSON.parse(readFileSync(join(root, "img.keys.json"), "utf8"))
        assert.deepEqual(written.numeric, {})
        assert.deepEqual(Object.keys(written.names).sort(), ["microphone", "no_key", "own", "stable_name", "twin_of_lib"])
        for (const [k, v] of Object.entries(written.names)) assert.equal(k, v)
        assert.match(log.text(), /no key table .*; wrote a starter with 5 string key\(s\)/)
        assert.match(log.text(), /info: review .*img\.keys\.json before relying on it/)
        assert.ok(!result.diagnostics.some(n => n.text.includes("no key in the key table")))
        assert.deepEqual(packed(result), [
            "icondb.microphone",
            "icondb.no_key",
            "icondb.own",
            "icondb.stable_name",
            "icondb.twin_of_lib",
        ])

        // The next run reads the file it wrote, and nothing it keyed is rejected.
        const again = runImageGen({ root, log: () => {} })
        assert.deepEqual(packed(again), packed(result))
    } finally {
        removeProject(root)
    }
})

test("the starter leaves out images that cannot be packed, and dependencies' images", () => {
    const root = project(null)
    try {
        runImageGen({ root, log: () => {} })
        const names = Object.keys(JSON.parse(readFileSync(join(root, "img.keys.json"), "utf8")).names)
        for (const absent of ["loose", "referenced", "from_lib", "lib.microphone", "in_a_test_file"])
            assert.ok(!names.includes(absent), absent)
    } finally {
        removeProject(root)
    }
})

test("the starter is used but not written when writing is off", () => {
    const root = project(null)
    try {
        const log = captureLog()
        const result = runImageGen({ root, write: false, log })
        assert.equal(existsSync(join(root, "img.keys.json")), false)
        assert.match(log.text(), /would write a starter/)
        assert.doesNotMatch(log.text(), /before relying on it/)
        assert.equal(result.pack.entries.length, 5)
    } finally {
        removeProject(root)
    }
})

test("an existing key table is never overwritten", () => {
    const root = project(KEYS)
    try {
        const before = readFileSync(join(root, "img.keys.json"), "utf8")
        runImageGen({ root, log: () => {} })
        assert.equal(readFileSync(join(root, "img.keys.json"), "utf8"), before)
    } finally {
        removeProject(root)
    }
})

test("a name the app shares with a dependency is only reported when verbose", () => {
    const quiet = run(KEYS)
    assert.doesNotMatch(quiet.log.text(), /"microphone" matches both/)
    const detail = notes(quiet.result, "detail").find(t => t.includes('"microphone"'))
    assert.equal(
        detail,
        '"microphone" matches both icondb.microphone and lib.microphone. A bare "microphone" in ' +
            'img.keys.json resolves to icondb.microphone; to use lib.microphone instead, write "lib.microphone".',
    )
    assert.match(run(KEYS, { verbose: true }).log.text(), /detail: "microphone" matches both/)
})

test("a name two dependencies share is reported, saying what to write", () => {
    const { result, log } = run(KEYS)
    const info = notes(result, "info").find(t => t.includes('"shared_icon"'))
    assert.equal(
        info,
        '"shared_icon" matches both lib.shared_icon and other.shared_icon. A bare "shared_icon" in ' +
            'img.keys.json resolves to lib.shared_icon; to use other.shared_icon instead, write "other.shared_icon".',
    )
    assert.match(log.text(), /info: "shared_icon" matches both/)
})
