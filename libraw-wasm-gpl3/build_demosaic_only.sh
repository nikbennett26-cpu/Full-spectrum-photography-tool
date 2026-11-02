#!/usr/bin/env bash
# build_demosaic_only.sh -- dist/demosaic-only.wasm (build 256): the AMaZE and RCD Bayer demosaics
# with no LibRaw, for the white balance before demosaic. Needs zig (pip install ziglang).
set -euo pipefail
cd "$(dirname "$0")"
ZIG="${ZIG:-python3 -m ziglang}"
$ZIG c++ -target wasm32-wasi -O3 -fno-exceptions -std=c++17 -mexec-model=reactor \
  -Wl,--max-memory=4294901760 -Wl,--initial-memory=33554432 -Wl,--strip-all \
  src/demosaic_only.cc src/amaze/rcd_demosaic_port.cc -o dist/demosaic-only.wasm
ls -la dist/demosaic-only.wasm
