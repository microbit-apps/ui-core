import { test } from "node:test"
import assert from "node:assert/strict"

import { scanSource, scanLiterals, countReferences, stripBlockComments } from "../scan.mjs"
import { BT, bmpConst, ns } from "./helpers.mjs"

const names = src => scanSource(src, "a.ts").map(i => i.name)

test("a packable image is named by its const", () => {
    const [img] = scanSource(ns("icons", bmpConst("disk", ["1"], ["packable", "whenUsed"])), "a.ts")
    assert.equal(img.name, "disk")
    assert.equal(img.constName, "disk")
    assert.equal(img.namespace, "icons")
    assert.equal(img.whenUsed, true)
    assert.equal(img.file, "a.ts")
    assert.equal(img.line, 2)
})

test("packable= overrides the name, quoted or not", () => {
    assert.deepEqual(names(ns("a", bmpConst("x", ["1"], ['packable="stable"']))), ["stable"])
    assert.deepEqual(names(ns("a", bmpConst("x", ["1"], ["packable=bare"]))), ["bare"])
})

test("packable is found wherever it sits on a //% line", () => {
    for (const attrs of [["whenUsed packable"], ["packable whenUsed"], ["whenUsed", "packable"]]) {
        const [img] = scanSource(ns("a", bmpConst("x", ["1"], attrs)), "a.ts")
        assert.ok(img, attrs.join(" / "))
        assert.equal(img.whenUsed, true, attrs.join(" / "))
    }
})

test("images without packable are not discovered", () => {
    assert.deepEqual(names(ns("a", bmpConst("x", ["1"], ["whenUsed"]))), [])
    assert.deepEqual(names(ns("a", bmpConst("x", ["1"]))), [])
    assert.deepEqual(names(ns("a", bmpConst("x", ["1"], ["notpackable"]))), [])
})

test("whenUsed is optional and reported", () => {
    const [img] = scanSource(ns("a", bmpConst("x", ["1"], ["packable"])), "a.ts")
    assert.equal(img.whenUsed, false)
})

test("an image inside a block comment is ignored", () => {
    const src = ns("a", "    /*\n" + bmpConst("hidden", ["1"], ["packable"]) + "\n    */", bmpConst("shown", ["2"], ["packable"]))
    assert.deepEqual(names(src), ["shown"])
})

test("a comment opener inside a string does not hide what follows", () => {
    const src = ns("a", '    const s = "a /* b"', bmpConst("after", ["1"], ["packable"]))
    assert.deepEqual(names(src), ["after"])
})

test("blanking comments keeps line numbers", () => {
    const src = "a\n/* one\ntwo */\nb\n"
    assert.equal(stripBlockComments(src).split("\n").length, src.split("\n").length)
    const [img] = scanSource("/*\n\n*/\n" + ns("a", bmpConst("x", ["1"], ["packable"])), "a.ts")
    assert.equal(img.line, 5)
})

test("scanLiterals finds every bmp literal, annotated or not", () => {
    const src = ns("a", bmpConst("one", ["1"], ["packable"]), bmpConst("two", ["2"]))
    assert.deepEqual(scanLiterals(src, "a.ts").map(l => l.constName), ["one", "two"])
})

test("countReferences counts the declaration as one use", () => {
    const src = ns("icons", bmpConst("disk", ["1"], ["packable"]))
    assert.equal(countReferences(src, "disk", "icons"), 1)
})

test("countReferences finds qualified uses anywhere and bare uses only inside the namespace", () => {
    const other = ns("app", "    function f() { return icons.disk }")
    assert.equal(countReferences(other, "disk", "icons"), 1)
    const bareElsewhere = ns("app", "    function f() { return disk }")
    assert.equal(countReferences(bareElsewhere, "disk", "icons"), 0)
    const bareInside = ns("icons", "    function f() { return disk }")
    assert.equal(countReferences(bareInside, "disk", "icons"), 1)
})

test("countReferences ignores a different namespace's member of the same name", () => {
    const src = ns("app", "    function f() { music.playTone(1, 2) }")
    assert.equal(countReferences(src, "music", "icons"), 0)
})

test("countReferences ignores comments and string data but not interpolated code", () => {
    const src = ns(
        "app",
        "    // icons.disk",
        '    const a = "icons.disk"',
        "    const b = " + BT + "icons.disk" + BT,
        "    const c = " + BT + "${icons.disk}" + BT,
    )
    assert.equal(countReferences(src, "disk", "icons"), 1)
})
