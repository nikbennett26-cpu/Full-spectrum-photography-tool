// SPDX-License-Identifier: GPL-3.0-or-later
//
// C API exposed to glue/libraw-gpl3.mjs. Function names and signatures
// match that file's existing calls exactly (_lr_open, _lr_width, etc.)
// so no JS-side changes are needed once this links into the wasm module.
//
// Deliberately minimal: lr_demosaic() does spatial demosaic + basic
// per-channel black-level subtraction ONLY. White balance, the colour
// matrix, and gamma are NOT applied here — decode() already hands camMul
// and rgbCam back to JS separately, and irlab's own Bradford/WB pipeline
// is where that colour science belongs.

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#else
#include "emscripten_native_shim.h"
#endif

#include <libraw/libraw.h>
#include <cstdint>
#include <cstring>
#include <vector>
#include <unordered_map>

void xtrans_fast_demosaic_port(int w, int h, const int xtrans[6][6],
                                float* const* rawData,
                                float** red, float** green, float** blue);

static std::unordered_map<int, LibRaw*> g_handles;
static int g_nextHandle = 1;

extern "C" {

EMSCRIPTEN_KEEPALIVE
int lr_open(const uint8_t* data, int len)
{
    LibRaw* proc = new LibRaw();
    if (proc->open_buffer(data, (size_t)len) != LIBRAW_SUCCESS) {
        delete proc;
        return 0;
    }
    if (proc->unpack() != LIBRAW_SUCCESS) {
        delete proc;
        return 0;
    }
    int h = g_nextHandle++;
    g_handles[h] = proc;
    return h;
}

EMSCRIPTEN_KEEPALIVE
int lr_width(int h)
{
    auto it = g_handles.find(h);
    if (it == g_handles.end()) return 0;
    return it->second->imgdata.sizes.width;
}

EMSCRIPTEN_KEEPALIVE
int lr_height(int h)
{
    auto it = g_handles.find(h);
    if (it == g_handles.end()) return 0;
    return it->second->imgdata.sizes.height;
}

EMSCRIPTEN_KEEPALIVE
void lr_cfa(int h, int* out4)
{
    out4[0] = out4[1] = out4[2] = out4[3] = 0;
    auto it = g_handles.find(h);
    if (it == g_handles.end()) return;
    out4[0] = (int)it->second->imgdata.idata.filters;
}

EMSCRIPTEN_KEEPALIVE
float lr_black(int h)
{
    auto it = g_handles.find(h);
    if (it == g_handles.end()) return 0.f;
    return (float)it->second->imgdata.color.black;
}

EMSCRIPTEN_KEEPALIVE
float lr_white(int h)
{
    auto it = g_handles.find(h);
    if (it == g_handles.end()) return 65535.f;
    return (float)it->second->imgdata.color.maximum;
}

EMSCRIPTEN_KEEPALIVE
void lr_cam_mul(int h, float* out4)
{
    out4[0] = out4[1] = out4[2] = out4[3] = 0.f;
    auto it = g_handles.find(h);
    if (it == g_handles.end()) return;
    const float* cm = it->second->imgdata.color.cam_mul;
    for (int i = 0; i < 4; i++) out4[i] = cm[i];
}

EMSCRIPTEN_KEEPALIVE
void lr_rgb_cam(int h, float* out12)
{
    for (int i = 0; i < 12; i++) out12[i] = 0.f;
    auto it = g_handles.find(h);
    if (it == g_handles.end()) return;
    const float (*m)[4] = it->second->imgdata.color.rgb_cam;
    for (int r = 0; r < 3; r++)
        for (int c = 0; c < 4; c++)
            out12[r * 4 + c] = m[r][c];
}

EMSCRIPTEN_KEEPALIVE
int lr_demosaic(int h, int qual, float* outR, float* outG, float* outB)
{
    (void)qual;
    auto it = g_handles.find(h);
    if (it == g_handles.end()) return 0;
    LibRaw* proc = it->second;

    unsigned filters = proc->imgdata.idata.filters;
    int width  = proc->imgdata.sizes.width;
    int height = proc->imgdata.sizes.height;
    int top    = proc->imgdata.sizes.top_margin;
    int left   = proc->imgdata.sizes.left_margin;
    int pitch  = proc->imgdata.sizes.raw_pitch / sizeof(unsigned short);
    const unsigned short* raw = proc->imgdata.rawdata.raw_image;
    if (!raw) return 0;

    if (filters != 9) {
        return 0;
    }

    int xtrans[6][6];
    for (int r = 0; r < 6; r++)
        for (int c = 0; c < 6; c++)
            xtrans[r][c] = proc->imgdata.idata.xtrans[r][c];

    std::vector<std::vector<float>> rawBuf(height);
    std::vector<float*> rawRows(height), redRows(height), greenRows(height), blueRows(height);
    for (int row = 0; row < height; row++) {
        rawBuf[row].resize(width);
        const unsigned short* srcRow = raw + (size_t)(row + top) * pitch + left;
        for (int col = 0; col < width; col++) rawBuf[row][col] = (float)srcRow[col];
        rawRows[row]   = rawBuf[row].data();
        redRows[row]   = outR + (size_t)row * width;
        greenRows[row] = outG + (size_t)row * width;
        blueRows[row]  = outB + (size_t)row * width;
    }

    xtrans_fast_demosaic_port(width, height, xtrans, rawRows.data(),
                               redRows.data(), greenRows.data(), blueRows.data());

    const unsigned* cblack = proc->imgdata.color.cblack;
    const size_t n = (size_t)width * height;
    for (size_t i = 0; i < n; i++) {
        outR[i] -= (float)cblack[0]; if (outR[i] < 0.f) outR[i] = 0.f;
        outG[i] -= (float)cblack[1]; if (outG[i] < 0.f) outG[i] = 0.f;
        outB[i] -= (float)cblack[2]; if (outB[i] < 0.f) outB[i] = 0.f;
    }

    return 1;
}

EMSCRIPTEN_KEEPALIVE
void lr_free(int h)
{
    auto it = g_handles.find(h);
    if (it == g_handles.end()) return;
    delete it->second;
    g_handles.erase(it);
}

} // extern "C"
