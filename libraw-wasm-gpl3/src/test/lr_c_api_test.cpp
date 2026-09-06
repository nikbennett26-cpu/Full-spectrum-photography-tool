// SPDX-License-Identifier: GPL-3.0-or-later
#include <cstdio>
#include <cstdint>
#include <cstdlib>
#include <vector>

extern "C" {
    int lr_open(const uint8_t* data, int len);
    int lr_width(int h);
    int lr_height(int h);
    void lr_cfa(int h, int* out4);
    float lr_black(int h);
    float lr_white(int h);
    void lr_cam_mul(int h, float* out4);
    void lr_rgb_cam(int h, float* out12);
    int lr_demosaic(int h, int qual, float* outR, float* outG, float* outB);
    void lr_free(int h);
}

int main(int argc, char** argv)
{
    if (argc < 2) {
        fprintf(stderr, "usage: %s <file.RAF>\n", argv[0]);
        return 1;
    }

    FILE* f = fopen(argv[1], "rb");
    if (!f) {
        fprintf(stderr, "could not open %s\n", argv[1]);
        return 1;
    }
    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    std::vector<uint8_t> buf(size);
    fread(buf.data(), 1, size, f);
    fclose(f);

    printf("file size: %ld bytes\n", size);

    int h = lr_open(buf.data(), (int)size);
    if (!h) {
        fprintf(stderr, "lr_open failed\n");
        return 1;
    }
    printf("handle: %d\n", h);

    int width = lr_width(h);
    int height = lr_height(h);
    printf("width=%d height=%d\n", width, height);

    int cfa[4];
    lr_cfa(h, cfa);
    printf("cfa (filters sentinel in [0]): %d %d %d %d (9=X-Trans)\n", cfa[0], cfa[1], cfa[2], cfa[3]);

    float black = lr_black(h);
    float white = lr_white(h);
    printf("black=%.1f white=%.1f\n", black, white);

    float camMul[4];
    lr_cam_mul(h, camMul);
    printf("cam_mul: R=%.4f G=%.4f B=%.4f G2=%.4f\n", camMul[0], camMul[1], camMul[2], camMul[3]);

    float rgbCam[12];
    lr_rgb_cam(h, rgbCam);
    printf("rgb_cam:\n");
    for (int r = 0; r < 3; r++)
        printf("  %.4f %.4f %.4f %.4f\n", rgbCam[r*4+0], rgbCam[r*4+1], rgbCam[r*4+2], rgbCam[r*4+3]);

    std::vector<float> R(width * height), G(width * height), B(width * height);
    int ok = lr_demosaic(h, 0, R.data(), G.data(), B.data());
    printf("lr_demosaic returned: %d\n", ok);

    if (ok) {
        int cy = height / 2, cx = width / 2;
        size_t cidx = (size_t)cy * width + cx;
        printf("centre pixel (row=%d, col=%d): R=%.1f G=%.1f B=%.1f\n", cy, cx, R[cidx], G[cidx], B[cidx]);

        long nanCount = 0;
        for (size_t i = 0; i < R.size(); i++) {
            if (R[i] != R[i] || G[i] != G[i] || B[i] != B[i]) nanCount++;
        }
        printf("NaN pixels: %ld (of %zu total)\n", nanCount, R.size());
    }

    lr_free(h);
    printf("freed handle OK\n");

    return 0;
}
