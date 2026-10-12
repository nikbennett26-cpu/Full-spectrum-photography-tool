// SPDX-License-Identifier: GPL-3.0-or-later
//
// RCD (Ratio Corrected Demosaicing) for Bayer CFA sensors, ported from darktable's
// src/iop/demosaicing/rcd.c (core math only — demosaic_box3 is unused by rcd_demosaic and is
// omitted) plus its border fallback, src/iop/demosaicing/ppg.c. Helper functions sqrf/
// interpolatef/CLIP from darktable's src/common/math.h, FC from src/develop/imageop_math.h.
//
// Original RCD algorithm: Luis Sanz Rodriguez (GPLv3). Tiling: Ingo Weyrich. Optimisation:
// Hanno Schwalm. darktable itself: GPLv3-or-later. This is a mechanical extraction of the
// glib/GTK/OpenCL-free math path (no dt_iop_roi_t, no pixelpipe, no GUI types anywhere below)
// under the same GPLv3 terms as the source it's extracted from — compatible with this
// project's AGPL-3.0 licensing, same basis as the existing RawTherapee X-Trans ports in this
// directory.
//
// Deliberately NO dependency on rtengine.h/rt_math.h: unlike RawTherapee's AMaZE/LMMSE/IGV/AHD
// (blocked here by glibmm), RCD's core math never touches darktable's or RawTherapee's
// internals, so it doesn't need the array2D shim either. Plain row-pointer arrays in, same out.
//
// Calling convention matches xtrans_fast_demosaic_port / xtrans_markesteijn1_demosaic_port in
// this same directory, so lr_c_api.cpp can call it the same way.
//
// NOT YET WIRED: lr_c_api.cpp currently returns 0 for any non-X-Trans (filters != 9) sensor —
// Bayer demosaic isn't called from anywhere yet. See the diff below for the lr_demosaic()
// change that adds the Bayer branch.
//
// NOT BUILD-VERIFIED against your actual Emscripten toolchain or a real Bayer RAW file in this
// session — only compiled and run under ASan/UBSan standalone (g++, synthetic data) before
// this adaptation. Confirm against your Canon 6D CR2 test file before trusting the output.

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

namespace {

inline float sqrf(float a) { return a * a; }
inline float interpolatef(float a, float b, float c) { return a * (b - c) + c; }
inline float clip01(float x) { return x < 0.0f ? 0.0f : (x > 1.0f ? 1.0f : x); }
inline float safe_in(float a) { return std::max(0.0f, a); }

// Bayer CFA colour at (row, col): 0=R, 1=G, 2=B. Same bit-packed convention LibRaw exposes as
// imgdata.idata.filters (dcraw-derived; darktable uses the identical scheme).
inline int FC(size_t row, size_t col, uint32_t filters) {
    return (filters >> (((row << 1 & 14) + (col & 1)) << 1)) & 3;
}

// PPG border fallback. Writes the WHOLE image as interleaved RGBA into `out` (caller-owned,
// width*height*4 floats); rcd_demosaic_port below overwrites all but a `margin`-pixel border
// with its own interior result. `in` is a flat width*height row-major CFA buffer.
void ppg_demosaic(float* out, const float* in, int width, int height, uint32_t filters, int margin) {
    float sum[8];
    for (int j = 0; j < height; j++) {
        for (int i = 0; i < width; i++) {
            if (i == 3 && j >= 3 && j < height - 3) i = width - 3;
            if (i == width) break;
            std::memset(sum, 0, sizeof(sum));
            for (int y = j - 1; y != j + 2; y++)
                for (int x = i - 1; x != i + 2; x++)
                    if (y >= 0 && x >= 0 && y < height && x < width) {
                        int f = FC(y, x, filters);
                        sum[f] += in[(size_t)y * width + x];
                        sum[f + 4]++;
                    }
            int f = FC(j, i, filters);
            for (int c = 0; c < 3; c++) {
                float* dst = &out[4 * ((size_t)j * width + i) + c];
                if (c != f && sum[c + 4] > 0.0f)
                    *dst = std::max(0.0f, sum[c] / sum[c + 4]);
                else
                    *dst = std::max(0.0f, in[(size_t)j * width + i]);
            }
        }
    }

    const int border = margin + 3;
    for (int j = 3; j < height - 3; j++) {
        float* buf = out + (size_t)4 * width * j + 4 * 3;
        const float* buf_in = in + (size_t)width * j + 3;
        for (int i = 3; i < width - 3; i++) {
            if (i == border && j >= border && j < height - border) {
                i = width - border;
                buf = out + (size_t)4 * width * j + 4 * i;
                buf_in = in + (size_t)width * j + i;
            }
            if (i == width) break;

            int c = FC(j, i, filters);
            float color[4];
            float pc = buf_in[0];
            if (c == 0 || c == 2) {
                color[c] = pc;
                float pym = buf_in[-width], pym2 = buf_in[-2 * width], pym3 = buf_in[-3 * width];
                float pyM = buf_in[width], pyM2 = buf_in[2 * width], pyM3 = buf_in[3 * width];
                float pxm = buf_in[-1], pxm2 = buf_in[-2], pxm3 = buf_in[-3];
                float pxM = buf_in[1], pxM2 = buf_in[2], pxM3 = buf_in[3];

                float guessx = (pxm + pc + pxM) * 2.0f - pxM2 - pxm2;
                float diffx = (std::fabs(pxm2 - pc) + std::fabs(pxM2 - pc) + std::fabs(pxm - pxM)) * 3.0f +
                              (std::fabs(pxM3 - pxM) + std::fabs(pxm3 - pxm)) * 2.0f;
                float guessy = (pym + pc + pyM) * 2.0f - pyM2 - pym2;
                float diffy = (std::fabs(pym2 - pc) + std::fabs(pyM2 - pc) + std::fabs(pym - pyM)) * 3.0f +
                              (std::fabs(pyM3 - pyM) + std::fabs(pym3 - pym)) * 2.0f;
                if (diffx > diffy) {
                    float m = std::min(pym, pyM), M = std::max(pym, pyM);
                    color[1] = std::max(std::min(guessy * 0.25f, M), m);
                } else {
                    float m = std::min(pxm, pxM), M = std::max(pxm, pxM);
                    color[1] = std::max(std::min(guessx * 0.25f, M), m);
                }
            } else {
                color[1] = pc;
            }
            color[3] = 0.0f;
            for (int k = 0; k < 4; k++) buf[k] = std::max(0.0f, color[k]);
            buf += 4;
            buf_in++;
        }
    }

    for (int j = 0; j < height; j++) {
        float* buf = out + (size_t)4 * width * j;
        for (int i = 0; i < width; i++) {
            if (i == margin && j >= margin && j < height - margin) {
                i = width - margin;
                buf = out + (size_t)4 * (width * j + i);
            }
            float color[4] = {buf[0], buf[1], buf[2], buf[3]};

            if (j > 0 && i > 0 && i < width - 1 && j < height - 1) {
                int c = FC(j, i, filters);
                if (c & 1) {
                    const float* nt = buf - 4 * width;
                    const float* nb = buf + 4 * width;
                    const float* nl = buf - 4;
                    const float* nr = buf + 4;
                    if (FC(j, i + 1, filters) == 0) {
                        color[2] = (nt[2] + nb[2] + 2.0f * color[1] - nt[1] - nb[1]) * 0.5f;
                        color[0] = (nl[0] + nr[0] + 2.0f * color[1] - nl[1] - nr[1]) * 0.5f;
                    } else {
                        color[0] = (nt[0] + nb[0] + 2.0f * color[1] - nt[1] - nb[1]) * 0.5f;
                        color[2] = (nl[2] + nr[2] + 2.0f * color[1] - nl[1] - nr[1]) * 0.5f;
                    }
                } else {
                    const float* ntl = buf - 4 - 4 * width;
                    const float* ntr = buf + 4 - 4 * width;
                    const float* nbl = buf - 4 + 4 * width;
                    const float* nbr = buf + 4 + 4 * width;
                    int oc = (c == 0) ? 2 : 0;
                    float diff1 = std::fabs(ntl[oc] - nbr[oc]) + std::fabs(ntl[1] - color[1]) + std::fabs(nbr[1] - color[1]);
                    float guess1 = ntl[oc] + nbr[oc] + 2.0f * color[1] - ntl[1] - nbr[1];
                    float diff2 = std::fabs(ntr[oc] - nbl[oc]) + std::fabs(ntr[1] - color[1]) + std::fabs(nbl[1] - color[1]);
                    float guess2 = ntr[oc] + nbl[oc] + 2.0f * color[1] - ntr[1] - nbl[1];
                    if (diff1 > diff2) color[oc] = guess2 * 0.5f;
                    else if (diff1 < diff2) color[oc] = guess1 * 0.5f;
                    else color[oc] = (guess1 + guess2) * 0.25f;
                }
            }
            for (int k = 0; k < 4; k++) buf[k] = std::max(0.0f, color[k]);
            buf += 4;
        }
    }
}

constexpr int TILESIZE = 112;
constexpr int BORDER = 10;
constexpr int MARGIN = 9;
constexpr int TILEVALID = TILESIZE - 2 * BORDER;
constexpr float EPS = 1e-5f;
constexpr float EPSSQ = 1e-10f;
constexpr int w1 = TILESIZE, w2 = 2 * TILESIZE, w3 = 3 * TILESIZE, w4 = 4 * TILESIZE;

}  // namespace

// width/height/filters: straight from LibRaw (imgdata.idata.filters; not valid for X-Trans,
// filters==9 — that stays on xtrans_fast_demosaic_port / xtrans_markesteijn1_demosaic_port).
// rawData/red/green/blue: row-pointer arrays, one float* per image row, each width floats —
// identical convention to the existing xtrans ports in this directory.
void rcd_demosaic_port(int width, int height, uint32_t filters,
                        float* const* rawData,
                        float** red, float** green, float** blue)
{
    // Flatten to one contiguous row-major buffer: the tile math below (ported verbatim from
    // darktable, which operates on a single packed array) is far simpler to keep correct as a
    // straight port if the addressing stays linear, rather than reworking every index into
    // row/col pairs against the row-pointer arrays. Same flattening lr_c_api.cpp already does
    // itself for the X-Trans path (see rawBuf there) — this mirrors that, not a new pattern.
    std::vector<float> in((size_t)width * height);
    for (int row = 0; row < height; row++)
        std::memcpy(&in[(size_t)row * width], rawData[row], sizeof(float) * width);

    std::vector<float> ppgOut((size_t)width * height * 4);
    ppg_demosaic(ppgOut.data(), in.data(), width, height, filters, BORDER);
    for (int row = 0; row < height; row++)
        for (int col = 0; col < width; col++) {
            size_t p = ((size_t)row * width + col) * 4;
            red[row][col]   = ppgOut[p];
            green[row][col] = ppgOut[p + 1];
            blue[row][col]  = ppgOut[p + 2];
        }

    if (width < 2 * BORDER || height < 2 * BORDER) return;  // PPG result stands as-is

    const int num_vertical = 1 + (height - 2 * BORDER - 1) / TILEVALID;
    const int num_horizontal = 1 + (width - 2 * BORDER - 1) / TILEVALID;
    const size_t tilePx = (size_t)TILESIZE * TILESIZE;

    std::vector<float> VH_Dir(tilePx, 0.0f);
    std::vector<float> PQ_Dir(tilePx / 2);
    std::vector<float> cfa(tilePx);
    std::vector<float> P_CDiff_Hpf(tilePx / 2);
    std::vector<float> Q_CDiff_Hpf(tilePx / 2);
    std::vector<float> rgb0(tilePx), rgb1(tilePx), rgb2(tilePx);
    float* rgb[3] = {rgb0.data(), rgb1.data(), rgb2.data()};
    float* lpf = PQ_Dir.data();  // reused buffer, matching upstream ("no overlapping use")

    // Tile loop: darktable parallelises this with OpenMP; each tile iteration here reads only
    // `in` and writes only its own region of red/green/blue, so it's safe to parallelise later
    // (Web Worker pool / Emscripten pthreads) without restructuring. Left single-threaded for
    // this first port — get correctness confirmed against a real file before optimising.
    for (int tile_vertical = 0; tile_vertical < num_vertical; tile_vertical++) {
        for (int tile_horizontal = 0; tile_horizontal < num_horizontal; tile_horizontal++) {
            const int rowStart = tile_vertical * TILEVALID;
            const int rowEnd = std::min(rowStart + TILESIZE, height);
            const int colStart = tile_horizontal * TILEVALID;
            const int colEnd = std::min(colStart + TILESIZE, width);
            const int tileRows = std::min(rowEnd - rowStart, TILESIZE);
            const int tileCols = std::min(colEnd - colStart, TILESIZE);

            if (rowStart + TILESIZE > height || colStart + TILESIZE > width) {
                std::fill(VH_Dir.begin(), VH_Dir.end(), 0.0f);
                std::fill(rgb0.begin(), rgb0.end(), 0.0f);
                std::fill(rgb1.begin(), rgb1.end(), 0.0f);
                std::fill(rgb2.begin(), rgb2.end(), 0.0f);
            }

            for (int row = rowStart; row < rowEnd; row++) {
                const int c0 = FC(row, colStart, filters);
                const int c1 = FC(row, colStart + 1, filters);
                for (int col = colStart, idx = (row - rowStart) * TILESIZE, in_idx = row * width + colStart;
                     col < colEnd; col++, idx++, in_idx++) {
                    float v = safe_in(in[in_idx]);
                    cfa[idx] = v;
                    rgb[c0][idx] = v;
                    rgb[c1][idx] = v;
                }
            }

            float bufferV[3][TILESIZE - 8];
            for (int row = 3; row < std::min(tileRows - 3, 5); row++)
                for (int col = 4, idx = row * TILESIZE + col; col < tileCols - 4; col++, idx++)
                    bufferV[row - 3][col - 4] = sqrf((cfa[idx - w3] - cfa[idx - w1] - cfa[idx + w1] + cfa[idx + w3]) -
                                                      3.0f * (cfa[idx - w2] + cfa[idx + w2]) + 6.0f * cfa[idx]);

            float bufferH[TILESIZE];
            float* V0 = bufferV[0];
            float* V1 = bufferV[1];
            float* V2 = bufferV[2];
            for (int row = 4; row < tileRows - 4; row++) {
                for (int col = 3, idx = row * TILESIZE + col; col < tileCols - 3; col++, idx++)
                    bufferH[col - 3] = sqrf((cfa[idx - 3] - cfa[idx - 1] - cfa[idx + 1] + cfa[idx + 3]) -
                                             3.0f * (cfa[idx - 2] + cfa[idx + 2]) + 6.0f * cfa[idx]);
                for (int col = 4, idx = (row + 1) * TILESIZE + col; col < tileCols - 4; col++, idx++)
                    V2[col - 4] = sqrf((cfa[idx - w3] - cfa[idx - w1] - cfa[idx + w1] + cfa[idx + w3]) -
                                        3.0f * (cfa[idx - w2] + cfa[idx + w2]) + 6.0f * cfa[idx]);
                for (int col = 4, idx = row * TILESIZE + col; col < tileCols - 4; col++, idx++) {
                    float V_Stat = std::max(EPSSQ, V0[col - 4] + V1[col - 4] + V2[col - 4]);
                    float H_Stat = std::max(EPSSQ, bufferH[col - 4] + bufferH[col - 3] + bufferH[col - 2]);
                    VH_Dir[idx] = V_Stat / (V_Stat + H_Stat);
                }
                float* tmp = V0; V0 = V1; V1 = V2; V2 = tmp;
            }

            for (int row = 2; row < tileRows - 2; row++)
                for (int col = 2 + (FC(row, 0, filters) & 1), idx = row * TILESIZE + col, lpIdx = idx / 2;
                     col < tileCols - 2; col += 2, idx += 2, lpIdx++)
                    lpf[lpIdx] = cfa[idx] + 0.5f * (cfa[idx - w1] + cfa[idx + w1] + cfa[idx - 1] + cfa[idx + 1]) +
                                 0.25f * (cfa[idx - w1 - 1] + cfa[idx - w1 + 1] + cfa[idx + w1 - 1] + cfa[idx + w1 + 1]);

            for (int row = 4; row < tileRows - 4; row++) {
                for (int col = 4 + (FC(row, 0, filters) & 1), idx = row * TILESIZE + col, lpIdx = idx / 2;
                     col < tileCols - 4; col += 2, idx += 2, lpIdx++) {
                    float cfai = cfa[idx];
                    float N_Grad = EPS + std::fabs(cfa[idx - w1] - cfa[idx + w1]) + std::fabs(cfai - cfa[idx - w2]) +
                                   std::fabs(cfa[idx - w1] - cfa[idx - w3]) + std::fabs(cfa[idx - w2] - cfa[idx - w4]);
                    float S_Grad = EPS + std::fabs(cfa[idx + w1] - cfa[idx - w1]) + std::fabs(cfai - cfa[idx + w2]) +
                                   std::fabs(cfa[idx + w1] - cfa[idx + w3]) + std::fabs(cfa[idx + w2] - cfa[idx + w4]);
                    float W_Grad = EPS + std::fabs(cfa[idx - 1] - cfa[idx + 1]) + std::fabs(cfai - cfa[idx - 2]) +
                                   std::fabs(cfa[idx - 1] - cfa[idx - 3]) + std::fabs(cfa[idx - 2] - cfa[idx - 4]);
                    float E_Grad = EPS + std::fabs(cfa[idx + 1] - cfa[idx - 1]) + std::fabs(cfai - cfa[idx + 2]) +
                                   std::fabs(cfa[idx + 1] - cfa[idx + 3]) + std::fabs(cfa[idx + 2] - cfa[idx + 4]);

                    float lpfi = lpf[lpIdx];
                    // Indexed by w1 (not w1/2) into the half-size lpf buffer — matches
                    // darktable's rcd.c exactly; intentional in the upstream source.
                    float N_Est = cfa[idx - w1] * (lpfi + lpfi) / (EPS + lpfi + lpf[lpIdx - w1]);
                    float S_Est = cfa[idx + w1] * (lpfi + lpfi) / (EPS + lpfi + lpf[lpIdx + w1]);
                    float W_Est = cfa[idx - 1] * (lpfi + lpfi) / (EPS + lpfi + lpf[lpIdx - 1]);
                    float E_Est = cfa[idx + 1] * (lpfi + lpfi) / (EPS + lpfi + lpf[lpIdx + 1]);

                    float V_Est = (S_Grad * N_Est + N_Grad * S_Est) / (N_Grad + S_Grad);
                    float H_Est = (W_Grad * E_Est + E_Grad * W_Est) / (E_Grad + W_Grad);

                    float VHc = VH_Dir[idx];
                    float VHn = 0.25f * (VH_Dir[idx - w1 - 1] + VH_Dir[idx - w1 + 1] + VH_Dir[idx + w1 - 1] + VH_Dir[idx + w1 + 1]);
                    float VH_Disc = (std::fabs(0.5f - VHc) < std::fabs(0.5f - VHn)) ? VHn : VHc;

                    rgb1[idx] = interpolatef(clip01(VH_Disc), H_Est, V_Est);
                }
            }

            for (int row = 3; row < tileRows - 3; row++)
                for (int col = 3, idx = row * TILESIZE + col, idx2 = idx / 2; col < tileCols - 3; col += 2, idx += 2, idx2++) {
                    P_CDiff_Hpf[idx2] = sqrf((cfa[idx - w3 - 3] - cfa[idx - w1 - 1] - cfa[idx + w1 + 1] + cfa[idx + w3 + 3]) -
                                              3.0f * (cfa[idx - w2 - 2] + cfa[idx + w2 + 2]) + 6.0f * cfa[idx]);
                    Q_CDiff_Hpf[idx2] = sqrf((cfa[idx - w3 + 3] - cfa[idx - w1 + 1] - cfa[idx + w1 - 1] + cfa[idx + w3 - 3]) -
                                              3.0f * (cfa[idx - w2 + 2] + cfa[idx + w2 - 2]) + 6.0f * cfa[idx]);
                }

            for (int row = 4; row < tileRows - 4; row++)
                for (int col = 4 + (FC(row, 0, filters) & 1), idx = row * TILESIZE + col, idx2 = idx / 2,
                         idx3 = (idx - w1 - 1) / 2, idx4 = (idx + w1 - 1) / 2;
                     col < tileCols - 4; col += 2, idx += 2, idx2++, idx3++, idx4++) {
                    float P_Stat = std::max(EPSSQ, P_CDiff_Hpf[idx3] + P_CDiff_Hpf[idx2] + P_CDiff_Hpf[idx4 + 1]);
                    float Q_Stat = std::max(EPSSQ, Q_CDiff_Hpf[idx3 + 1] + Q_CDiff_Hpf[idx2] + Q_CDiff_Hpf[idx4]);
                    PQ_Dir[idx2] = P_Stat / (P_Stat + Q_Stat);
                }

            for (int row = 4; row < tileRows - 4; row++)
                for (int col = 4 + (FC(row, 0, filters) & 1), idx = row * TILESIZE + col, c = 2 - FC(row, col, filters),
                         pqIdx = idx / 2, pqIdx2 = (idx - w1 - 1) / 2, pqIdx3 = (idx + w1 - 1) / 2;
                     col < tileCols - 4; col += 2, idx += 2, pqIdx++, pqIdx2++, pqIdx3++) {
                    float PQc = PQ_Dir[pqIdx];
                    float PQn = 0.25f * (PQ_Dir[pqIdx2] + PQ_Dir[pqIdx2 + 1] + PQ_Dir[pqIdx3] + PQ_Dir[pqIdx3 + 1]);
                    float PQ_Disc = (std::fabs(0.5f - PQc) < std::fabs(0.5f - PQn)) ? PQn : PQc;

                    float NW_Grad = EPS + std::fabs(rgb[c][idx - w1 - 1] - rgb[c][idx + w1 + 1]) +
                                     std::fabs(rgb[c][idx - w1 - 1] - rgb[c][idx - w3 - 3]) + std::fabs(rgb1[idx] - rgb1[idx - w2 - 2]);
                    float NE_Grad = EPS + std::fabs(rgb[c][idx - w1 + 1] - rgb[c][idx + w1 - 1]) +
                                     std::fabs(rgb[c][idx - w1 + 1] - rgb[c][idx - w3 + 3]) + std::fabs(rgb1[idx] - rgb1[idx - w2 + 2]);
                    float SW_Grad = EPS + std::fabs(rgb[c][idx - w1 + 1] - rgb[c][idx + w1 - 1]) +
                                     std::fabs(rgb[c][idx + w1 - 1] - rgb[c][idx + w3 - 3]) + std::fabs(rgb1[idx] - rgb1[idx + w2 - 2]);
                    float SE_Grad = EPS + std::fabs(rgb[c][idx - w1 - 1] - rgb[c][idx + w1 + 1]) +
                                     std::fabs(rgb[c][idx + w1 + 1] - rgb[c][idx + w3 + 3]) + std::fabs(rgb1[idx] - rgb1[idx + w2 + 2]);

                    float NW_Est = rgb[c][idx - w1 - 1] - rgb1[idx - w1 - 1];
                    float NE_Est = rgb[c][idx - w1 + 1] - rgb1[idx - w1 + 1];
                    float SW_Est = rgb[c][idx + w1 - 1] - rgb1[idx + w1 - 1];
                    float SE_Est = rgb[c][idx + w1 + 1] - rgb1[idx + w1 + 1];

                    float P_Est = (NW_Grad * SE_Est + SE_Grad * NW_Est) / (NW_Grad + SE_Grad);
                    float Q_Est = (NE_Grad * SW_Est + SW_Grad * NE_Est) / (NE_Grad + SW_Grad);

                    rgb[c][idx] = rgb1[idx] + interpolatef(clip01(PQ_Disc), Q_Est, P_Est);
                }

            for (int row = 4; row < tileRows - 4; row++)
                for (int col = 4 + (FC(row, 1, filters) & 1), idx = row * TILESIZE + col; col < tileCols - 4; col += 2, idx += 2) {
                    float VHc = VH_Dir[idx];
                    float VHn = 0.25f * (VH_Dir[idx - w1 - 1] + VH_Dir[idx - w1 + 1] + VH_Dir[idx + w1 - 1] + VH_Dir[idx + w1 + 1]);
                    float VH_Disc = (std::fabs(0.5f - VHc) < std::fabs(0.5f - VHn)) ? VHn : VHc;
                    float r1 = rgb1[idx];
                    float N1 = EPS + std::fabs(r1 - rgb1[idx - w2]);
                    float S1 = EPS + std::fabs(r1 - rgb1[idx + w2]);
                    float W1v = EPS + std::fabs(r1 - rgb1[idx - 2]);
                    float E1 = EPS + std::fabs(r1 - rgb1[idx + 2]);
                    float r1mw1 = rgb1[idx - w1], r1pw1 = rgb1[idx + w1];
                    float r1m1 = rgb1[idx - 1], r1p1 = rgb1[idx + 1];

                    for (int c = 0; c <= 2; c += 2) {
                        float SNabs = std::fabs(rgb[c][idx - w1] - rgb[c][idx + w1]);
                        float EWabs = std::fabs(rgb[c][idx - 1] - rgb[c][idx + 1]);

                        float N_Grad = N1 + SNabs + std::fabs(rgb[c][idx - w1] - rgb[c][idx - w3]);
                        float S_Grad = S1 + SNabs + std::fabs(rgb[c][idx + w1] - rgb[c][idx + w3]);
                        float W_Grad = W1v + EWabs + std::fabs(rgb[c][idx - 1] - rgb[c][idx - 3]);
                        float E_Grad = E1 + EWabs + std::fabs(rgb[c][idx + 1] - rgb[c][idx + 3]);

                        float N_Est = rgb[c][idx - w1] - r1mw1;
                        float S_Est = rgb[c][idx + w1] - r1pw1;
                        float W_Est = rgb[c][idx - 1] - r1m1;
                        float E_Est = rgb[c][idx + 1] - r1p1;

                        float V_Est = (N_Grad * S_Est + S_Grad * N_Est) / (N_Grad + S_Grad);
                        float H_Est = (E_Grad * W_Est + W_Grad * E_Est) / (E_Grad + W_Grad);

                        rgb[c][idx] = r1 + interpolatef(clip01(VH_Disc), H_Est, V_Est);
                    }
                }

            const int first_v = rowStart + (tile_vertical == 0 ? MARGIN : BORDER);
            const int last_v = rowEnd - (tile_vertical == num_vertical - 1 ? MARGIN : BORDER);
            const int first_h = colStart + (tile_horizontal == 0 ? MARGIN : BORDER);
            const int last_h = colEnd - (tile_horizontal == num_horizontal - 1 ? MARGIN : BORDER);
            for (int row = first_v; row < last_v; row++)
                for (int col = first_h, idx = (row - rowStart) * TILESIZE + col - colStart; col < last_h; col++, idx++) {
                    red[row][col]   = std::max(0.0f, rgb0[idx]);
                    green[row][col] = std::max(0.0f, rgb1[idx]);
                    blue[row][col]  = std::max(0.0f, rgb2[idx]);
                }
        }
    }
}
