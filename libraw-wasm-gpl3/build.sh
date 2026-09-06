#!/usr/bin/env bash
# build.sh — libraw-wasm-gpl3
#
# Split into independent stages so X-Trans (no glibmm needed) can build
# and be verified without waiting on the AMaZE/LMMSE/RCD/IGV/AHD block,
# which needs a real GTK/glibmm vendor tree not yet assembled for wasm.
set -euo pipefail

SRC_DIR="src"
SHIM_DIR="src/shims"
OUT_DIR="build"

mkdir -p "$OUT_DIR"

echo "== Stage 1: X-Trans standalone (no glibmm) =="
em++ -std=c++17 -O2 \
    -I "$SHIM_DIR" \
    -c "$SRC_DIR/amaze/xtrans_fast_port.cc" \
    -o "$OUT_DIR/xtrans_fast_port.o"
echo "  -> $OUT_DIR/xtrans_fast_port.o"

echo "== Stage 2: AMaZE / LMMSE / RCD / IGV / AHD (needs glibmm) =="
if [ "${BUILD_GLIBMM_DEMOSAICS:-0}" = "1" ]; then
    echo "  BUILD_GLIBMM_DEMOSAICS=1 set, attempting..."
    # These still need the vendor/RawTherapee + glibmm tree assembled.
    # Left as a stub until that vendoring work is done.
    for f in amaze_port ahd_port igv_port rcd_port lmmse_port; do
        em++ -std=c++17 -O2 \
            -I "$SHIM_DIR" \
            $(pkg-config --cflags glibmm-2.4) \
            -c "$SRC_DIR/amaze/${f}.cc" \
            -o "$OUT_DIR/${f}.o"
    done
else
    echo "  Skipped (falling back to bilinear demosaic for these algorithms)."
    echo "  Set BUILD_GLIBMM_DEMOSAICS=1 once the glibmm vendor tree is in place."
fi

echo "== Done. Object files in $OUT_DIR/ =="
ls -la "$OUT_DIR"

echo "== Stage 3: LibRaw core (reduced/no-postprocessing build) =="
LIBRAW_DIR="vendor/LibRaw"
LIBRAW_OBJ_DIR="$OUT_DIR/libraw"
mkdir -p "$LIBRAW_OBJ_DIR"

LIBRAW_FILES=$(cat src/libraw_nopp_filelist.txt)

for f in $LIBRAW_FILES; do
    outname=$(echo "$f" | tr '/' '_' | sed 's/\.cpp$/.o/')
    em++ -std=c++17 -O2 \
        -DLIBRAW_NOTHREADS -DLIBRAW_USE_AUTOPTR \
        -I "$LIBRAW_DIR" \
        -c "$LIBRAW_DIR/$f" \
        -o "$LIBRAW_OBJ_DIR/$outname"
done
echo "  -> $(ls $LIBRAW_OBJ_DIR | wc -l) LibRaw object files in $LIBRAW_OBJ_DIR/"
