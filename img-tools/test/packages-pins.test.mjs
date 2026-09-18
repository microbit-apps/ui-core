import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, symlinkSync } from "node:fs"
import { join } from "node:path"

import { discoverPackages } from "../packages.mjs"
import { checkPins } from "../pins.mjs"
import { makeProject, removeProject } from "./helpers.mjs"

test("packages come dependencies first, each once, with the app last", () => {
    const root = makeProject({
        "pxt.json": { name: "app", dependencies: { top: "*", base: "*" }, files: ["app.ts"] },
        "pxt_modules/top/pxt.json": { name: "top", dependencies: { base: "*" }, files: ["top.ts"] },
        "pxt_modules/base/pxt.json": { name: "base", files: ["base.ts"] },
    })
    try {
        assert.deepEqual(discoverPackages(root).map(p => p.name), ["base", "top", "app"])
    } finally {
        removeProject(root)
    }
})

test("a package's files are its compiled sources only", () => {
    const root = makeProject({
        "pxt.json": { name: "app", files: ["a.ts", "img.g.ts", "README.md"], testFiles: ["test.ts"] },
    })
    try {
        const [app] = discoverPackages(root, "img.g.ts")
        assert.deepEqual(app.files, ["a.ts"])
    } finally {
        removeProject(root)
    }
})

test("a dependency with nothing under pxt_modules is skipped", () => {
    const root = makeProject({ "pxt.json": { name: "app", dependencies: { core: "*" }, files: [] } })
    try {
        assert.deepEqual(discoverPackages(root).map(p => p.name), ["app"])
    } finally {
        removeProject(root)
    }
})

test("a project without pxt.json is an error", () => {
    const root = makeProject({})
    try {
        assert.throws(() => discoverPackages(root), /no pxt.json/)
    } finally {
        removeProject(root)
    }
})

const pinned = (npm, pxt) => {
    const files = {}
    if (npm) files["node_modules/@microbit-apps/ui-core/pxt.json"] = { version: npm }
    if (pxt) files["pxt_modules/ui-core/pxt.json"] = { version: pxt }
    return makeProject(files)
}

test("matching versions pass the pin check", () => {
    const root = pinned("0.0.9", "0.0.9")
    try {
        assert.deepEqual(checkPins(root), { ok: true, reason: null, npm: "0.0.9", pxt: "0.0.9" })
    } finally {
        removeProject(root)
    }
})

test("different versions fail the pin check, naming both", () => {
    const root = pinned("0.0.8", "0.0.9")
    try {
        const r = checkPins(root)
        assert.equal(r.ok, false)
        assert.match(r.reason, /0\.0\.8 for build tooling but 0\.0\.9 for device code/)
    } finally {
        removeProject(root)
    }
})

test("a missing side leaves nothing to compare", () => {
    for (const [npm, pxt, why] of [[null, "0.0.9", /no npm install/], ["0.0.9", null, /no pxt module/]]) {
        const root = pinned(npm, pxt)
        try {
            const r = checkPins(root)
            assert.equal(r.ok, true)
            assert.match(r.reason, why)
        } finally {
            removeProject(root)
        }
    }
})

test("a linked setup passes, since both sides are one checkout", () => {
    const root = makeProject({ "checkout/pxt.json": { version: "0.0.9" } })
    try {
        mkdirSync(join(root, "node_modules/@microbit-apps"), { recursive: true })
        mkdirSync(join(root, "pxt_modules"), { recursive: true })
        symlinkSync(join(root, "checkout"), join(root, "node_modules/@microbit-apps/ui-core"))
        symlinkSync(join(root, "checkout"), join(root, "pxt_modules/ui-core"))
        assert.equal(checkPins(root).ok, true)
    } finally {
        removeProject(root)
    }
})

test("an npm install hoisted above the project is found", () => {
    const outer = makeProject({
        "node_modules/@microbit-apps/ui-core/pxt.json": { version: "0.0.8" },
        "app/pxt_modules/ui-core/pxt.json": { version: "0.0.9" },
    })
    try {
        assert.equal(checkPins(join(outer, "app")).ok, false)
    } finally {
        removeProject(outer)
    }
})
