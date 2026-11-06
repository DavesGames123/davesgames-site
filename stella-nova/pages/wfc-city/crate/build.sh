#!/bin/sh
# Build the wfc-city crate to WebAssembly and write the wasm-bindgen glue to
# ../pkg (the page loads pkg/wfc_city.js).
#   1. cargo test --release        the native unit tests
#   2. cargo build --lib --release --target wasm32-unknown-unknown
#   3. wasm-bindgen --target web   (the CLI version must equal the
#      wasm-bindgen crate version in Cargo.toml: 0.2.103)
# Set CARGO_TARGET_DIR to a folder outside the repo. Do not commit target/.
set -e
cd "$(dirname "$0")"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-/private/tmp/wfc-city-target}"
cargo test --release
cargo build --lib --release --target wasm32-unknown-unknown
"${WASM_BINDGEN:-$HOME/.cargo/bin/wasm-bindgen}" --target web --no-typescript --out-dir ../pkg --out-name wfc_city \
  "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/wfc_city.wasm"
ls -l ../pkg
