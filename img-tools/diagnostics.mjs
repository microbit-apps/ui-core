// Collected diagnostics, ordered by what the app can act on.
//
//   error    the run cannot produce a correct result and the app can fix it
//   warning  the app owns the problem but the pack is still correct
//   info     the cause is in a dependency, so it is reported and not acted on
//   detail   only shown when the caller asks for verbose output
//
// Errors are collected rather than thrown; call `check()` at the point the run
// is ready to fail, and it reports every problem found so far at once.

/** Creates a collector. `verbose` decides whether `detail` notes are shown. */
export function createDiagnostics(verbose) {
    const notes = []
    const add = (severity, text) => notes.push({ severity, text })
    return {
        notes,
        error: text => add("error", text),
        warning: text => add("warning", text),
        info: text => add("info", text),
        detail: text => add("detail", text),

        /** Notes worth showing, given the verbosity. */
        visible() {
            return notes.filter(n => verbose || n.severity !== "detail")
        },

        /**
         * Writes any notes not already written. Call this before `check()` so
         * a failing run still explains itself: the notes saying why an image
         * could not be packed are what make the failure actionable.
         */
        flush(log) {
            for (const n of this.visible()) {
                if (n.logged) continue
                n.logged = true
                log(`img-gen: ${n.severity}: ${n.text}`)
            }
        },

        /** Throws one error naming every problem found, if there were any. */
        check() {
            const errors = notes.filter(n => n.severity === "error")
            if (errors.length === 0) return
            const lines = errors.map(e => "  - " + e.text).join("\n")
            throw new Error(
                `${errors.length} problem(s) prevent generating the image pack:\n${lines}`,
            )
        },
    }
}
