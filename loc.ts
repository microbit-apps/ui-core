/**
 * Build-time localization runtime.
 *
 * The catalog holds the translated strings for exactly one language and is
 * assigned at startup by a generated per-language file (`loc.g.ts`) in the
 * consuming app. English strings are used as both the catalog keys and the
 * fallback: an English build ships no table at all, so `ui.loc` and friends
 * become the identity function and simply return the source English string.
 *
 * One language ships per build image. To localize an app, generate a
 * `loc.g.ts` that assigns `_loc.table` (the id-to-string catalog) and,
 * optionally, `_loc.defaultFont` (a language-specific bitmap font). Build one
 * image per language.
 *
 * Catalog keys are the English source strings. Strings that need different
 * translations depending on where they appear use a `"context#string"` key
 * (see `ui.locc`) so the same English word can map to different translations.
 */
namespace _loc {
    /**
     * Translation catalog for the shipped language, assigned by the app's
     * generated `loc.g.ts`. `undefined` means an English build with no table,
     * in which case localization is the identity function.
     */
    export let table: { [key: string]: string } = undefined

    /**
     * Per-language default bitmap font, assigned by the app's generated
     * `loc.g.ts`. `undefined` means the built-in `bitmaps.font8`.
     */
    export let defaultFont: ui.TextFont = undefined
}

namespace ui {
    /**
     * Localizes an English source string.
     *
     * With no catalog (an English build) the source string is returned
     * unchanged. Otherwise the catalog is looked up by the source string; a
     * missing entry falls back to the source string.
     */
    export function loc(s: string): string {
        if (!_loc.table) return s
        const entry = _loc.table[s]
        if (entry === undefined) return s
        return entry
    }

    /**
     * Localizes an English source string that needs a context-specific
     * translation.
     *
     * The catalog is looked up by the composite key `context + "#" + s`, which
     * lets the same English word (for example "on" as a relay state versus
     * elsewhere) map to different translations. On a miss the lookup falls back
     * to the plain-string translation via `loc(s)`, and finally to the English
     * source string. With no catalog the source string is returned unchanged.
     */
    export function locc(context: string, s: string): string {
        if (!_loc.table) return s
        const entry = _loc.table[context + "#" + s]
        if (entry === undefined) return loc(s)
        return entry
    }

    /**
     * Localizes an English source string with positional interpolation.
     *
     * The source string is localized first, then each `"{i}"` token is
     * replaced with `args[i]`. Because translation happens before substitution,
     * a translated string may reorder the placeholders (for example map
     * "LED {0} {1}" to "{1} {0} DEL").
     */
    export function locf(s: string, args: string[]): string {
        let result = loc(s)
        for (let i = 0; i < args.length; i++) {
            result = result.replaceAll("{" + i + "}", args[i])
        }
        return result
    }

    /**
     * Returns the default bitmap font for the shipped language, or
     * `bitmaps.font8` when no language-specific font is set.
     */
    export function locFont(): TextFont {
        if (_loc.defaultFont) return _loc.defaultFont
        return bitmaps.font8
    }
}
