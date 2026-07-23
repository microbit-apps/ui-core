#!/usr/bin/env node
// Regenerate the calling project's source catalog (locales/<srcLang>.json) from
// its listed .ts files. Run from the project root.

import { runLocStrings } from "../extract.mjs"

const srcLang = process.argv[2] || "en"
runLocStrings(process.cwd(), srcLang)
