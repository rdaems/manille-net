#!/bin/bash
# Builds the engine three ways: for this machine (target/release/manille), as a static Linux
# binary that also runs on hippo (../bin/manille, not in git), and as WebAssembly for the page
# (../site/manille.wasm, in git: the site is served straight from the repository).
# Needs: rustup target add x86_64-unknown-linux-musl wasm32-unknown-unknown
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:$PATH"
cargo test --release -q
cargo build --release -q
cargo build --release -q --target x86_64-unknown-linux-musl
cargo build --release -q --target wasm32-unknown-unknown --lib
mkdir -p ../bin
cp target/x86_64-unknown-linux-musl/release/manille ../bin/manille
cp target/wasm32-unknown-unknown/release/manille_engine.wasm ../site/manille.wasm
ls -la ../bin/manille ../site/manille.wasm
