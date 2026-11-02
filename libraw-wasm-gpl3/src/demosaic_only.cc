// SPDX-License-Identifier: GPL-3.0-or-later
//
// demosaic_only.cc (build 256) -- the Bayer demosaics on their own, with no LibRaw, as a small
// standalone WebAssembly module (dist/demosaic-only.wasm, built by build_demosaic_only.sh with
// zig's clang). It exists so the decode worker can demosaic a mosaic that JS has changed: for
// the white balance BEFORE demosaic (worker-core.mjs), the mosaic is recovered from a first pass
// (AMaZE and RCD both keep every photosite's own value exactly), each colour is scaled by the
// Cheng PCA gains, and it is demosaiced again here with balanced channels, which is what AMaZE and
// RCD assume. The algorithms are the same files the main module uses, unchanged.

#include "amaze/amaze_demosaic_port.cc"   // brings in the file-static amaze_demosaic()

void rcd_demosaic_port(int width, int height, uint32_t filters,
                       float* const* rawData, float** red, float** green, float** blue);

extern "C" {

__attribute__((export_name("dm_malloc"))) void* dm_malloc(unsigned long n) { return malloc(n); }
__attribute__((export_name("dm_free"))) void dm_free(void* p) { free(p); }

// in: w*h floats (white = 1.0). out4: w*h*4 floats, RGBA interleaved. clip_pt: the lowest
// channel's white after the balance gains, as RawTherapee passes it.
__attribute__((export_name("dm_amaze")))
int dm_amaze(const float* in, float* out4, int w, int h, uint32_t filters, float clip_pt)
{
  if (!in || !out4 || w < 16 || h < 16) return 0;
  memset(out4, 0, sizeof(float) * 4 * (size_t)w * h);
  amaze_demosaic(in, out4, w, h, filters, clip_pt);
  return 1;
}

// in: w*h floats. R, G, B: w*h floats each.
__attribute__((export_name("dm_rcd")))
int dm_rcd(float* in, float* R, float* G, float* B, int w, int h, uint32_t filters)
{
  if (!in || !R || !G || !B || w < 16 || h < 16) return 0;
  std::vector<float*> ri(h), rr(h), rg(h), rb(h);
  for (int y = 0; y < h; y++) {
    ri[y] = in + (size_t)y * w; rr[y] = R + (size_t)y * w; rg[y] = G + (size_t)y * w; rb[y] = B + (size_t)y * w;
  }
  rcd_demosaic_port(w, h, filters, ri.data(), rr.data(), rg.data(), rb.data());
  return 1;
}

}
