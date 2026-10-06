#!/bin/sh
# Build the line-art crate to WebAssembly and write the wasm-bindgen glue to
# ../pkg (the page loads pkg/line_art.js from worker.js).
#   1. cargo test --release        the native unit tests
#   2. cargo build --lib --release --target wasm32-unknown-unknown
#   3. wasm-bindgen --target web   (the CLI version must equal the
#      wasm-bindgen crate version in Cargo.toml: 0.2.103)
set -e
cd "$(dirname "$0")"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$PWD/target}"
cargo test --release
cargo build --lib --release --target wasm32-unknown-unknown
"${WASM_BINDGEN:-$HOME/.cargo/bin/wasm-bindgen}" --target web --no-typescript --out-dir ../pkg --out-name line_art \
  "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/line_art.wasm"
ls -l ../pkg
