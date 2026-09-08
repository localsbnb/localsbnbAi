#!/usr/bin/env sh
# exec node start.mjs directly via sh to avoid ERR_REQUIRE_ESM when Cursor loads this as CJS
cd "$(dirname "$0")" && exec node start.mjs
