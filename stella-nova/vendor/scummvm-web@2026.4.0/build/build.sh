#!/bin/bash
# ============================================================================
#  SCUMMVM WEB BUILD  ·  vendor/scummvm-web@2026.4.0/build/build.sh
# ----------------------------------------------------------------------------
#  Rebuilds the ScummVM WebAssembly files in this folder from the official
#  source. This script, retro-pre.js and pkg-config are the build scripts
#  that the GPL asks for. The source is ScummVM v2026.4.0:
#    https://github.com/scummvm/scummvm/tree/v2026.4.0
#    commit 7d2709da5136866589f7602f5f5a7b17de03420e
#  The script does not change the ScummVM source. It links one extra file,
#  retro-pre.js (--pre-js), which gives the host page the Emscripten FS
#  before main() runs. The Retro Shelf page uses it to write a freeware
#  game into /games/<id>.
#
#  Toolchain: Emscripten 4.0.10 (emsdk), the version that
#  dists/emscripten/build.sh of this tag pins. The SDL3 port (3.2.4, zlib
#  licence) comes from emsdk. pkg-config is a small shim, because configure
#  asks pkg-config for sdl3 and macOS has none.
#
#  Engines: sky, queen, lure, drascula, cge (Sołtys) and cge2 (Sfinx).
#  The data/ folder keeps only the engine data files of those engines, and
#  encoding.dat. data/index.json lists them for the HTTP file system of the
#  emscripten backend.
#
#  Usage: build/build.sh <work-dir>   (needs git, curl, python3, make)
#  The output replaces scummvm.js, scummvm.wasm and data/ next to build/.
# ============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$(dirname "$HERE")"
WORK="${1:?usage: build.sh <work-dir>}"
mkdir -p "$WORK" && cd "$WORK"

[ -d scummvm ] || git clone -q --depth 1 --branch v2026.4.0 https://github.com/scummvm/scummvm.git scummvm
test "$(git -C scummvm rev-parse HEAD)" = 7d2709da5136866589f7602f5f5a7b17de03420e

if [ ! -d emsdk-4.0.10 ]; then
  curl -sSL -o emsdk-4.0.10.tar.gz https://github.com/emscripten-core/emsdk/archive/refs/tags/4.0.10.tar.gz
  tar xzf emsdk-4.0.10.tar.gz
  (cd emsdk-4.0.10 && ./emsdk install 4.0.10 && ./emsdk activate 4.0.10)
fi
source emsdk-4.0.10/emsdk_env.sh >/dev/null
export EMSDK
mkdir -p bin && cp "$HERE/pkg-config" bin/pkg-config && chmod +x bin/pkg-config
export PATH="$PWD/bin:$PATH"

cd scummvm
LDFLAGS="--pre-js $HERE/retro-pre.js" emconfigure ./configure \
  --host=wasm32-unknown-emscripten --build=wasm32-unknown-emscripten \
  --disable-all-engines --enable-engine=sky,queen,lure,drascula,cge,cge2 \
  --enable-release --disable-debug --disable-cloud --disable-libcurl \
  --disable-sdlnet --disable-tts --disable-freetype2 --disable-fluidsynth \
  --disable-mt32emu
emmake make -j"$(sysctl -n hw.ncpu 2>/dev/null || nproc)"
emmake make dist-emscripten

cp build-emscripten/scummvm.js build-emscripten/scummvm.wasm "$DEST/"
rm -rf "$DEST/data" && mkdir -p "$DEST/data" "$DEST/doc"
for f in drascula.dat lure.dat queen.tbl sky.cpt encoding.dat; do cp "build-emscripten/data/$f" "$DEST/data/"; done
cp build-emscripten/doc/COPYING build-emscripten/doc/COPYING.* build-emscripten/doc/COPYRIGHT build-emscripten/doc/AUTHORS "$DEST/doc/"
python3 -I -c 'import os,json,sys
d=sys.argv[1]
idx={f: os.path.getsize(os.path.join(d,f)) for f in sorted(os.listdir(d)) if f!="index.json"}
open(os.path.join(d,"index.json"),"w").write(json.dumps(idx))' "$DEST/data"
(cd "$DEST" && shasum -a 256 scummvm.js scummvm.wasm data/* > build/SHA256SUMS)
echo "done: $DEST"
