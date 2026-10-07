#!/usr/bin/env bash
# ============================================================================
#  CONTEXT FREE  ·  engine/build.sh — build cf.js + cf.wasm from source
# ----------------------------------------------------------------------------
#  This script is the build of the WebAssembly engine of the page. It is part
#  of the corresponding source (GPL version 2, section 3) of cf.wasm.
#
#  INPUTS (all in this directory)
#    UPSTREAM                         the upstream repository and commit
#    context-free-<short>-src.tar.gz  the upstream files that the build
#                                     uses, made with `git archive` at that
#                                     commit (see UPSTREAM)
#    patches/*.patch                  our changes to the upstream engine
#    shim/cfweb.cpp                   our C API in place of the CLI main()
#
#  TOOLS
#    EMSDK   an emsdk checkout, activated (`./emsdk activate latest`)
#    BISON   GNU Bison 3.x (macOS /usr/bin/bison is 2.3: too old)
#    FLEX    GNU flex 2.6.4, with its FlexLexer.h in FLEX_INCLUDE (default:
#            the include directory next to the flex bin directory).
#            macOS /usr/bin/flex writes size_t LexerInput, which does not
#            match the GNU FlexLexer.h: use a GNU flex build.
#
#  USE
#    EMSDK=/path/to/emsdk BISON=/path/to/bison FLEX=/path/to/flex \
#      engine/build.sh [outdir]
#  The default outdir is the page directory (one level up). The script
#  writes cf.js and cf.wasm there and prints their sizes and sha256.
#
#  WITH NO TARBALL the script clones the commit in UPSTREAM from GitHub.
# ============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HERE/..}"
EMSDK="${EMSDK:?set EMSDK to an activated emsdk checkout}"
BISON="${BISON:-bison}"
FLEX="${FLEX:-flex}"
FLEX_INCLUDE="${FLEX_INCLUDE:-$(dirname "$(command -v "$FLEX")")/../include}"

REPO="$(sed -n 's/^repo: //p' "$HERE/UPSTREAM")"
COMMIT="$(sed -n 's/^commit: //p' "$HERE/UPSTREAM")"
SHORT="${COMMIT:0:7}"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/cfweb-build.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# ── 1. the upstream source ───────────────────────────────────────────────────
TARBALL="$HERE/context-free-$SHORT-src.tar.gz"
if [ -f "$TARBALL" ]; then
  tar -xzf "$TARBALL" -C "$WORK"
  SRC="$WORK/context-free-$SHORT"
else
  git clone --quiet "$REPO" "$WORK/clone"
  git -C "$WORK/clone" checkout --quiet "$COMMIT"
  SRC="$WORK/clone"
fi

# ── 2. our patches ───────────────────────────────────────────────────────────
for p in "$HERE"/patches/*.patch; do
  (cd "$SRC" && patch -p1 --quiet < "$p")
  echo "patch: $(basename "$p")"
done

# ── 3. the parser and the lexer ──────────────────────────────────────────────
GEN="$WORK/gen"
mkdir -p "$GEN"
"$BISON" --version | head -1
"$BISON" -o "$GEN/cfdg.tab.cpp" "$SRC/src-common/cfdg.ypp"
"$FLEX" -o "$GEN/lex.yy.cpp" "$SRC/src-common/cfdg.l"
"$FLEX" --version
cp "$FLEX_INCLUDE/FlexLexer.h" "$GEN/"

# ── 4. compile and link ──────────────────────────────────────────────────────
# shellcheck disable=SC1091
source "$EMSDK/emsdk_env.sh" > /dev/null 2>&1
em++ --version | head -1

COMMON="cfdg.cpp Rand64.cpp makeCFfilename.cpp cfdgimpl.cpp renderimpl.cpp
  builder.cpp shape.cpp variation.cpp tempfile.cpp aggCanvas.cpp HSBColor.cpp
  SVGCanvas.cpp rendererAST.cpp primShape.cpp bounds.cpp shapeSTL.cpp
  tiledCanvas.cpp astexpression.cpp astreplacement.cpp pathIterator.cpp
  stacktype.cpp CmdInfo.cpp abstractPngCanvas.cpp ast.cpp prettyint.cpp"
AGG="agg_trans_affine.cpp agg_curves.cpp agg_vcgen_contour.cpp
  agg_vcgen_stroke.cpp agg_bezier_arc.cpp agg_color_rgba.cpp"

SRCS=("$GEN/cfdg.tab.cpp" "$GEN/lex.yy.cpp" "$HERE/shim/cfweb.cpp")
for f in $COMMON; do SRCS+=("$SRC/src-common/$f"); done
for f in $AGG; do SRCS+=("$SRC/src-agg/src/$f"); done

CXXFLAGS=(-std=c++20 -O2 -DNDEBUG -DCFDG_WEB -fwasm-exceptions
  -Wno-parentheses -Wno-deprecated-declarations
  -I"$GEN" -I"$SRC/src-common" -I"$SRC/src-common/agg-extras"
  -I"$SRC/src-unix" -I"$SRC/src-agg" -I"$SRC/src-agg/agg2")

OBJ="$WORK/obj"
mkdir -p "$OBJ"
OBJS=()
for s in "${SRCS[@]}"; do
  o="$OBJ/$(basename "${s%.cpp}").o"
  em++ "${CXXFLAGS[@]}" -c "$s" -o "$o"
  OBJS+=("$o")
done

EXPORTS='["_cf_parse","_cf_info","_cf_render","_cf_pixels","_cf_release","_cf_render_svg","_cf_variation_to_string","_cf_variation_from_string","_cf_variation_max","_malloc","_free"]'
em++ "${OBJS[@]}" -o "$WORK/cf.js" \
  -O2 -fwasm-exceptions \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createContextFree \
  -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB -sSTACK_SIZE=4MB \
  -sEXPORTED_FUNCTIONS="$EXPORTS" \
  -sEXPORTED_RUNTIME_METHODS='["UTF8ToString","stringToUTF8","lengthBytesUTF8","FS","HEAPU8"]' \
  -sFORCE_FILESYSTEM=1

cp "$WORK/cf.js" "$WORK/cf.wasm" "$OUT/"

# ── 5. the record ────────────────────────────────────────────────────────────
# BUILD names the tools and the output hashes. tests.mjs checks that
# cf.wasm is the one in BUILD. A build into another directory only prints.
REPORT="$WORK/BUILD"
{
  echo "upstream: $REPO @ $COMMIT"
  echo "patches: $(cd "$HERE/patches" && ls *.patch | tr '\n' ' ')"
  echo "emcc: $(em++ --version | head -1)"
  echo "bison: $("$BISON" --version | head -1)"
  echo "flex: $("$FLEX" --version | head -1)"
  for f in cf.js cf.wasm; do
    printf '%s: %d bytes, sha256 %s\n' "$f" "$(wc -c < "$OUT/$f" | tr -d ' ')" "$(shasum -a 256 "$OUT/$f" | cut -d' ' -f1)"
  done
} > "$REPORT"
cat "$REPORT"
if [ "$(cd "$OUT" && pwd)" = "$(cd "$HERE/.." && pwd)" ]; then cp "$REPORT" "$HERE/BUILD"; fi
