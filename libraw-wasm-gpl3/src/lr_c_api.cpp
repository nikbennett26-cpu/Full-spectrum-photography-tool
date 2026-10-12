// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026
//
// C API exposed to glue/libraw-gpl3.mjs. Function names and signatures
// match that file's existing calls exactly (_lr_open, _lr_width, etc.)
// so no JS-side changes are needed once this links into the wasm module.
//
// Deliberately minimal: lr_demosaic() does spatial demosaic + basic
// per-channel black-level subtraction ONLY. White balance, the colour
// matrix, and gamma are NOT applied here — decode() already hands camMul
// and rgbCam back to JS separately, and irlab's own Bradford/WB pipeline
// is where that colour science belongs. Verified in practice: stacking a
// colour-correction pass here on top of irlab's own WB pass produced
// worse results than handing irlab clean, minimally-processed data.

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#else
#include "emscripten_native_shim.h"
#endif

#include <libraw/libraw.h>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>
#include <unordered_map>

// From xtrans_fast_port.cc — the verified X-Trans demosaic.
void xtrans_fast_demosaic_port(int w, int h, const int xtrans[6][6],
                                float* const* rawData,
                                float** red, float** green, float** blue);

// From xtrans_markesteijn1_port.cc — higher-quality X-Trans demosaic
// (RawTherapee's Markesteijn 1-pass algorithm, useCieLab=false variant).
void xtrans_markesteijn1_demosaic_port(int w, int h, const int xtrans[6][6],
                                        float* const* rawData,
                                        float** red, float** green, float** blue);

// From rcd_demosaic_port.cc — RCD (Ratio Corrected Demosaicing), ported from darktable.
// Bayer-only (does not handle filters==9 / X-Trans). No glibmm dependency, unlike
// RawTherapee's AMaZE/LMMSE/IGV/AHD, which stay blocked behind rtengine.h for now.
void rcd_demosaic_port(int w, int h, uint32_t filters,
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
    // No raw2image()/subtract_black() here: lr_demosaic() reads rawdata.raw_image directly,
    // and subtract_black() zeroes imgdata.color.black/cblack while leaving raw_image
    // untouched -- so the black offset (~2048 on Canon) was never removed and every
    // image came out lifted/washed-out. raw2image() also allocated a full-size 4-channel
    // copy (~140MB at 18MP) that nothing used. Black is now subtracted per CFA site in
    // lr_demosaic() from the untouched LibRaw black-level fields.
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

// Returns 1 on success, 0 on failure (e.g. unsupported CFA type).
EMSCRIPTEN_KEEPALIVE
int lr_demosaic(int h, int qual, float* outR, float* outG, float* outB)
{
    // X-Trans (filters==9): qual==0 (bilinear, the UI's own "fastest" option)
    // uses the fast X-Trans port; anything else (including the app's own
    // default, 'amaze'=1, sent for every ordinary RAW load) uses the newer,
    // higher-quality Markesteijn 1-pass port instead.
    //
    // Bayer (filters!=9): routed to RCD (rcd_demosaic_port, ported from
    // darktable) regardless of `qual` for now -- it's the only Bayer path
    // wired up so far. The other RawTherapee Bayer quals (lmmse/igv/ahd) are
    // still gated behind glibmm; AMaZE likewise. RCD was picked first because,
    // unlike those, its core math has no glibmm/rtengine.h dependency at all.
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

    // Per-site black level, as LibRaw itself computes it: global black + per-colour
    // cblack[0..3] (index 3 = second green) + optional repeating pattern in cblack[6..].
    const unsigned* cblack = proc->imgdata.color.cblack;
    const float gblack = (float)proc->imgdata.color.black;
    const unsigned patH = cblack[4], patW = cblack[5];
    auto siteColor = [&](int row, int col) -> int {
        if (filters == 9)
            return proc->imgdata.idata.xtrans[(row + 6) % 6][(col + 6) % 6] & 3;
        return (filters >> (((row << 1 & 14) + (col & 1)) << 1)) & 3;
    };
    auto siteBlack = [&](int row, int col) -> float {
        float b = gblack + (float)cblack[siteColor(row, col)];
        if (patH && patW && patH * patW <= LIBRAW_CBLACK_SIZE - 6)
            b += (float)cblack[6 + (row % patH) * patW + (col % patW)];
        return b;
    };
    float blackSum = 0.f;
    for (int c = 0; c < 4; c++) blackSum += gblack + (float)cblack[c];
    const float blackAvg = blackSum / 4.f;

    std::vector<std::vector<float>> rawBuf(height);
    std::vector<float*> rawRows(height), redRows(height), greenRows(height), blueRows(height);
    for (int row = 0; row < height; row++) {
        rawBuf[row].resize(width);
        const unsigned short* srcRow = raw + (size_t)(row + top) * pitch + left;
        for (int col = 0; col < width; col++) {
            float v = (float)srcRow[col] - siteBlack(row, col);
            rawBuf[row][col] = v > 0.f ? v : 0.f;
        }
        rawRows[row]   = rawBuf[row].data();
        redRows[row]   = outR + (size_t)row * width;
        greenRows[row] = outG + (size_t)row * width;
        blueRows[row]  = outB + (size_t)row * width;
    }

    if (filters == 9) {
        int xtrans[6][6];
        for (int r = 0; r < 6; r++)
            for (int c = 0; c < 6; c++)
                xtrans[r][c] = proc->imgdata.idata.xtrans[r][c];

        if (qual == 0) {
            xtrans_fast_demosaic_port(width, height, xtrans, rawRows.data(),
                                       redRows.data(), greenRows.data(), blueRows.data());
        } else {
            xtrans_markesteijn1_demosaic_port(width, height, xtrans, rawRows.data(),
                                               redRows.data(), greenRows.data(), blueRows.data());
        }
    } else {
        rcd_demosaic_port(width, height, filters, rawRows.data(),
                           redRows.data(), greenRows.data(), blueRows.data());
    }

    // Black was already subtracted per site above; just normalise so sensor white -> 1.0.
    const float white = (float)proc->imgdata.color.maximum;
    const float scale = (white - blackAvg > 1.f) ? 1.f / (white - blackAvg) : 1.f;
    const size_t n = (size_t)width * height;
    for (size_t i = 0; i < n; i++) {
        outR[i] = (outR[i] > 0.f ? outR[i] : 0.f) * scale;
        outG[i] = (outG[i] > 0.f ? outG[i] : 0.f) * scale;
        outB[i] = (outB[i] > 0.f ? outB[i] : 0.f) * scale;
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
