#!/usr/bin/env sh
# 用 sh 直接 exec node start.mjs，避免 Cursor 侧用 CJS 加载导致 ERR_REQUIRE_ESM
cd "$(dirname "$0")" && exec node start.mjs
