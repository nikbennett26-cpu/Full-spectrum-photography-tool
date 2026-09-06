// SPDX-License-Identifier: GPL-3.0-or-later
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <vector>
#include <algorithm>
#include <libraw/libraw.h>

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"

void xtrans_fast_demosaic_port(int w, int h, const int xtrans[6][6],
                                float* const* rawData,
                                float** red, float** green, float** blue);

int main(int argc, char** argv)
{
    if (argc < 2) {
        fprintf(stderr, "usage: %s <file.RAF>\n", argv[0]);
        return 1;
    }

    LibRaw processor;

    int ret = processor.open_file(argv[1]);
    if (ret != LIBRAW_SUCCESS) {
        fprintf(stderr, "open_file failed: %s\n", libraw_strerror(ret));
        return 1;
    }

    ret = processor.unpack();
    if (ret != LIBRAW_SUCCESS) {
        fprintf(stderr, "unpack failed: %s\n", libraw_strerror(ret));
        return 1;
    }

    printf("make/model: %s %s\n",
           processor.imgdata.idata.make, processor.imgdata.idata.model);
    printf("filters: %u (9 = X-Trans expected)\n", processor.imgdata.idata.filters);

    if (processor.imgdata.idata.filters != 9) {
        fprintf(stderr, "Not an X-Trans sensor (filters=%u)\n", processor.imgdata.idata.filters);
        return 1;
    }

    const int width  = processor.imgdata.sizes.width;
    const int height = processor.imgdata.sizes.height;
    const int top    = processor.imgdata.sizes.top_margin;
    const int left   = processor.imgdata.sizes.left_margin;
    const int pitch  = processor.imgdata.sizes.raw_pitch / sizeof(ushort);

    printf("visible image: %dx%d, crop offset (top=%d, left=%d), raw pitch=%d\n",
           width, height, top, left, pitch);

    const ushort* raw = processor.imgdata.rawdata.raw_image;
    if (!raw) {
        fprintf(stderr, "raw_image is null\n");
        return 1;
    }

    int xtrans[6][6];
    for (int r = 0; r < 6; r++)
        for (int c = 0; c < 6; c++)
            xtrans[r][c] = processor.imgdata.idata.xtrans[r][c];

    printf("xtrans pattern (from LibRaw):\n");
    for (int r = 0; r < 6; r++) {
        printf("  ");
        for (int c = 0; c < 6; c++) printf("%d ", xtrans[r][c]);
        printf("\n");
    }

    float** rawRows   = new float*[height];
    float** redRows   = new float*[height];
    float** greenRows = new float*[height];
    float** blueRows  = new float*[height];

    for (int row = 0; row < height; row++) {
        rawRows[row]   = new float[width];
        redRows[row]   = new float[width];
        greenRows[row] = new float[width];
        blueRows[row]  = new float[width];

        const ushort* srcRow = raw + (size_t)(row + top) * pitch + left;
        for (int col = 0; col < width; col++) {
            rawRows[row][col] = (float)srcRow[col];
        }
    }

    xtrans_fast_demosaic_port(width, height, xtrans, rawRows, redRows, greenRows, blueRows);

    const unsigned* cblack = processor.imgdata.color.cblack;
    const float* pre_mul = processor.imgdata.color.pre_mul;
    const float* cam_mul = processor.imgdata.color.cam_mul;
    const float (*rgb_cam)[4] = processor.imgdata.color.rgb_cam;

    printf("\ncblack: R=%u G=%u B=%u G2=%u\n",
           cblack[0], cblack[1], cblack[2], cblack[3]);
    printf("pre_mul: R=%.4f G=%.4f B=%.4f G2=%.4f\n",
           pre_mul[0], pre_mul[1], pre_mul[2], pre_mul[3]);
    printf("cam_mul (as-shot, from file metadata): R=%.4f G=%.4f B=%.4f G2=%.4f\n",
           cam_mul[0], cam_mul[1], cam_mul[2], cam_mul[3]);
    printf("rgb_cam:\n");
    for (int r = 0; r < 3; r++)
        printf("  %.4f %.4f %.4f %.4f\n", rgb_cam[r][0], rgb_cam[r][1], rgb_cam[r][2], rgb_cam[r][3]);

    const float wbR = cam_mul[0] / cam_mul[1];
    const float wbG = 1.f;
    const float wbB = cam_mul[2] / cam_mul[1];
    printf("normalised as-shot WB gain: R=%.4f G=%.4f B=%.4f\n", wbR, wbG, wbB);

    for (int row = 0; row < height; row++) {
        for (int col = 0; col < width; col++) {
            float rr = (redRows[row][col]   - (float)cblack[0]) * wbR;
            float gg = (greenRows[row][col] - (float)cblack[1]) * wbG;
            float bb = (blueRows[row][col]  - (float)cblack[2]) * wbB;
            if (rr < 0.f) rr = 0.f;
            if (gg < 0.f) gg = 0.f;
            if (bb < 0.f) bb = 0.f;

            float outR = rgb_cam[0][0] * rr + rgb_cam[0][1] * gg + rgb_cam[0][2] * bb;
            float outG = rgb_cam[1][0] * rr + rgb_cam[1][1] * gg + rgb_cam[1][2] * bb;
            float outB = rgb_cam[2][0] * rr + rgb_cam[2][1] * gg + rgb_cam[2][2] * bb;

            redRows[row][col]   = outR;
            greenRows[row][col] = outG;
            blueRows[row][col]  = outB;
        }
    }

    std::vector<float> luminances;
    luminances.reserve((size_t)width * height);
    for (int row = 0; row < height; row++) {
        for (int col = 0; col < width; col++) {
            float lum = 0.2126f * redRows[row][col] + 0.7152f * greenRows[row][col] + 0.0722f * blueRows[row][col];
            luminances.push_back(lum);
        }
    }
    std::sort(luminances.begin(), luminances.end());
    size_t idx995 = (size_t)(luminances.size() * 0.995);
    if (idx995 >= luminances.size()) idx995 = luminances.size() - 1;
    const float whitePoint = luminances[idx995] > 1.f ? luminances[idx995] : 1.f;

    size_t idx005 = (size_t)(luminances.size() * 0.005);
    const float blackPoint = luminances[idx005];

    const float range = (whitePoint - blackPoint) > 1.f ? (whitePoint - blackPoint) : 1.f;

    printf("\nmeasured black point (0.5th pct): %.1f, white point (99.5th pct): %.1f\n",
           blackPoint, whitePoint);

    int cy = height / 2, cx = width / 2;
    printf("\ncentre pixel (row=%d, col=%d):\n", cy, cx);
    printf("  raw   = %.1f\n", rawRows[cy][cx]);
    printf("  R=%.1f G=%.1f B=%.1f\n", redRows[cy][cx], greenRows[cy][cx], blueRows[cy][cx]);

    long nanCount = 0;
    for (int row = 0; row < height; row++)
        for (int col = 0; col < width; col++) {
            float r = redRows[row][col], g = greenRows[row][col], b = blueRows[row][col];
            if (r != r || g != g || b != b) nanCount++;
        }
    printf("\nNaN pixels across full frame: %ld (of %d total)\n", nanCount, width * height);

    if (argc >= 3) {
        unsigned char* png = new unsigned char[(size_t)width * height * 3];
        for (int row = 0; row < height; row++) {
            for (int col = 0; col < width; col++) {
                size_t idx = ((size_t)row * width + col) * 3;
                float r = (redRows[row][col]   - blackPoint) / range;
                float g = (greenRows[row][col] - blackPoint) / range;
                float b = (blueRows[row][col]  - blackPoint) / range;
                if (r < 0.f) r = 0.f; if (r > 1.f) r = 1.f;
                if (g < 0.f) g = 0.f; if (g > 1.f) g = 1.f;
                if (b < 0.f) b = 0.f; if (b > 1.f) b = 1.f;
                png[idx + 0] = (unsigned char)(255.f * powf(r, 1.f / 2.2f));
                png[idx + 1] = (unsigned char)(255.f * powf(g, 1.f / 2.2f));
                png[idx + 2] = (unsigned char)(255.f * powf(b, 1.f / 2.2f));
            }
        }

        int ok = stbi_write_png(argv[2], width, height, 3, png, width * 3);
        delete[] png;

        if (ok) {
            printf("\nWrote %s (%dx%d PNG)\n", argv[2], width, height);
        } else {
            fprintf(stderr, "stbi_write_png failed for %s\n", argv[2]);
        }
    }

    return nanCount > 0 ? 1 : 0;
}
