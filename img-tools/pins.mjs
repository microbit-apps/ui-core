// Pin check for the package shipping both the build tooling and the device
// runtime.
//
// The encoder runs from the npm install and the decoder ships from the pxt
// module, so a build is only sound when both resolve to the same version of
// the package. Resolved versions are compared, not the specs that produced
// them: a linked development setup legitimately carries different specs that
// resolve to one checkout.

import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

function versionOf(dir) {
    const path = join(dir, "pxt.json")
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, "utf8")).version || null
}

// npm may hoist an install to any node_modules above the app.
function findNpmDir(root, npmName) {
    let dir = root
    for (;;) {
        const candidate = join(dir, "node_modules", npmName)
        if (existsSync(candidate)) return candidate
        const parent = dirname(dir)
        if (parent === dir) return null
        dir = parent
    }
}

/**
 * Compares the versions an app at `root` resolves for the shared package.
 *
 * Returns { ok, reason, npm, pxt }. `ok` is false only when both sides were
 * found and disagree; when either is missing there is nothing to compare and
 * `reason` says which.
 */
export function checkPins(root, options = {}) {
    const pxtName = options.pxtName || "ui-core"
    const npmName = options.npmName || "@microbit-apps/ui-core"

    const pxtDir = join(root, "pxt_modules", pxtName)
    const npmDir = findNpmDir(root, npmName)
    const pxt = existsSync(pxtDir) ? versionOf(pxtDir) : null
    const npm = npmDir ? versionOf(npmDir) : null

    if (!pxt) return { ok: true, reason: `no pxt module ${pxtName}`, npm, pxt }
    if (!npm) return { ok: true, reason: `no npm install of ${npmName}`, npm, pxt }
    if (npm !== pxt)
        return {
            ok: false,
            reason: `${npmName} resolves to ${npm} for build tooling but ${pxt} for device code`,
            npm,
            pxt,
        }
    return { ok: true, reason: null, npm, pxt }
}
