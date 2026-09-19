// Package discovery: the app and every package it compiles against.
//
// Dependencies resolve under pxt_modules and are visited in transitive order,
// a package before anything that depends on it, with the app last. Each is
// { name, dir, files }, where `files` is the package's compiled sources --
// testFiles are excluded, since an image declared in one never ships.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

function readPxt(dir) {
    const path = join(dir, "pxt.json")
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, "utf8"))
}

function compiledFiles(pxt, skip) {
    return (pxt.files || []).filter(f => f.endsWith(".ts") && f !== skip)
}

/**
 * The packages an app at `root` compiles against, dependencies first and the
 * app last under the name "app". `skip` names a file to leave out of every
 * package's file list, for the generated file itself.
 */
export function discoverPackages(root, skip) {
    const modulesDir = join(root, "pxt_modules")
    const seen = new Set()
    const packages = []
    const visit = name => {
        if (seen.has(name)) return
        seen.add(name)
        const dir = join(modulesDir, name)
        const pxt = readPxt(dir)
        if (!pxt) return
        for (const dep of Object.keys(pxt.dependencies || {})) visit(dep)
        packages.push({ name, dir, files: compiledFiles(pxt, skip) })
    }
    const appPxt = readPxt(root)
    if (!appPxt) throw new Error(`no pxt.json at ${root}`)
    for (const dep of Object.keys(appPxt.dependencies || {})) visit(dep)
    packages.push({ name: "app", dir: root, files: compiledFiles(appPxt, skip) })
    return packages
}

/** True for the package holding the app's own sources. */
export function isApp(pkg) {
    return pkg.name === "app"
}
