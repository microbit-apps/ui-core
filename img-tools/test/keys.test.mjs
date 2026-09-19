import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"

import { readKeyTable, emptyKeyTable, referencedNames } from "../keys.mjs"
import { makeProject, removeProject } from "./helpers.mjs"

function withTable(content, fn) {
    const root = makeProject({ "img.keys.json": content })
    try {
        return fn(join(root, "img.keys.json"))
    } finally {
        removeProject(root)
    }
}

test("a missing key table is an empty one", () => {
    assert.deepEqual(readKeyTable("/nonexistent/img.keys.json"), emptyKeyTable())
})

test("a key table reads numeric and string keys", () => {
    withTable({ numeric: { 16: "thermometer", 180: "thermometer" }, names: { delete: "btn_delete" } }, path => {
        const table = readKeyTable(path)
        assert.deepEqual(table.numeric, { 16: "thermometer", 180: "thermometer" })
        assert.deepEqual(table.names, { delete: "btn_delete" })
        assert.deepEqual([...referencedNames(table)].sort(), ["btn_delete", "thermometer"])
    })
})

test("either section may be left out", () => {
    withTable({ names: { a: "b" } }, path => assert.deepEqual(readKeyTable(path).numeric, {}))
    withTable({ numeric: { 1: "b" } }, path => assert.deepEqual(readKeyTable(path).names, {}))
})

test("a malformed key table is rejected with the entry at fault", () => {
    const cases = [
        ["{ not json", /not valid JSON/],
        [[], /must be a JSON object/],
        [{ numeric: { "-1": "x" } }, /numeric key "-1"/],
        [{ numeric: { two: "x" } }, /numeric key "two"/],
        [{ numeric: { 3: "" } }, /numeric key 3 must name an image/],
        [{ names: { "a,b": "x" } }, /may not contain a comma/],
        [{ names: { a: 7 } }, /string key "a" must name an image/],
    ]
    for (const [content, message] of cases)
        withTable(content, path => assert.throws(() => readKeyTable(path), message, JSON.stringify(content)))
})
