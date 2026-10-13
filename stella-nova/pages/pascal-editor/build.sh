#!/usr/bin/env bash
# ============================================================================
#  PASCAL EDITOR  ·  pages/pascal-editor/build.sh — rebuild app/ from upstream
# ----------------------------------------------------------------------------
#  Clones pascalorg/editor at the pinned commit, copies adapter/ into the
#  clone as apps/sn-static, installs with bun, builds with vite, and writes
#  the result to app/ next to this script. The upstream files do not change.
#
#  Needs: git, bun (upstream uses bun workspaces), about 1.5 GB of free disk.
#  Run:   bash stella-nova/pages/pascal-editor/build.sh
#  Env:   PASCAL_WORK  clone folder (default /private/tmp/claude-501/pascal-build)
#         SN_ASSET_ORIGIN  cdn (default) or self, see adapter/vite.config.mjs
#
#  grep -n targets
#    pinned commit ........ "PIN_SHA="
#    copied public files .. "PUBLIC_DIRS="
# ============================================================================
set -euo pipefail

PIN_SHA=bccd365bbb54d33afd78b67f14579b9fda3a14e1
PIN_TAG=@pascal-app/editor@1.0.4
REPO=https://github.com/pascalorg/editor.git

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${PASCAL_WORK:-/private/tmp/claude-501/pascal-build}"
SRC="$WORK/src"
OUT="$HERE/app"
export SN_ASSET_ORIGIN="${SN_ASSET_ORIGIN:-cdn}"

mkdir -p "$WORK"
if [ ! -d "$SRC/.git" ]; then
  git clone --filter=blob:none "$REPO" "$SRC"
fi
git -C "$SRC" fetch --quiet origin "$PIN_SHA" || git -C "$SRC" fetch --quiet --tags origin
git -C "$SRC" checkout --quiet --force "$PIN_SHA"
test "$(git -C "$SRC" rev-parse HEAD)" = "$PIN_SHA"

rm -rf "$SRC/apps/sn-static"
mkdir -p "$SRC/apps/sn-static"
cp -R "$HERE/adapter/." "$SRC/apps/sn-static/"

(cd "$SRC" && CI=1 bun install)
(cd "$SRC" && bunx turbo run build --filter='sn-pascal-static^...' --ui=stream)
(cd "$SRC/apps/sn-static" && SN_OUT_DIR="$OUT" bunx --bun vite build)

PUBLIC="$SRC/apps/editor/public"
PUBLIC_DIRS="icons audios"
if [ "$SN_ASSET_ORIGIN" = "self" ]; then PUBLIC_DIRS="$PUBLIC_DIRS items material hdri"; fi
for d in $PUBLIC_DIRS; do cp -R "$PUBLIC/$d" "$OUT/$d"; done
cp "$PUBLIC/cursor.svg" "$OUT/cursor.svg"
cp "$SRC/LICENSE" "$OUT/LICENSE.txt"
find "$OUT" -name .DS_Store -delete

cat > "$OUT/BUILD.txt" << INFO
Pascal Editor, static build for davesgames.io
upstream  https://github.com/pascalorg/editor
commit    $PIN_SHA
tag       $PIN_TAG
assets    $SN_ASSET_ORIGIN
licence   MIT, Copyright (c) 2026 Pascal Group Inc. (LICENSE.txt)
changes   scenes saved in browser IndexedDB, not the Next.js scenes API.
          Adapter source: stella-nova/pages/pascal-editor/adapter/
INFO

du -sh "$OUT"
