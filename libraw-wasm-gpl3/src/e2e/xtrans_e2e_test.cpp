// SPDX-License-Identifier: GPL-3.0-or-later
//
// End-to-end smoke test: LibRaw open+unpack -> real X-Trans sensor data
// -> xtrans_fast_demosaic_port (the verified port in
// src/amaze/xtrans_fast_port.cc). Not the final production wrapper —
// that's src/demosaic_xtrans_fast.cpp per the port's own header comment,
// which will also need black-level subtraction and [0,1] normalisation.
// This is purely "does the whole pipe work end to end on a real file."
//
// Usage: xtrans_e2e_test <path-to.RAF> [output.png]

#include <cstdio>
#include <cstdlib>
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
        fprintf(stderr, "Not an X-Trans sensor (filters=%u) — this test only "
                        "handles X-Trans files.\n", processor.imgdata.idata.filters);
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
        fprintf(stderr, "raw_image is null — this file may use a color4_image "
                        "path instead (compressed/other layout). Needs "
                        "further investigation before proceeding.\n");
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
        float maxVal = 0.f;
        for (int row = 0; row < height; row++)
            for (int col = 0; col < width; col++) {
                if (redRows[row][col]   > maxVal) maxVal = redRows[row][col];
                if (greenRows[row][col] > maxVal) maxVal = greenRows[row][col];
                if (blueRows[row][col]  > maxVal) maxVal = blueRows[row][col];
            }

        unsigned char* png = new unsigned char[(size_t)width * height * 3];
        for (int row = 0; row < height; row++) {
            for (int col = 0; col < width; col++) {
                size_t idx = ((size_t)row * width + col) * 3;
                png[idx + 0] = (unsigned char)(255.f * redRows[row][col]   / maxVal);
                png[idx + 1] = (unsigned char)(255.f * greenRows[row][col] / maxVal);
                png[idx + 2] = (unsigned char)(255.f * blueRows[row][col]  / maxVal);
            }
        }

        int ok = stbi_write_png(argv[2], width, height, 3, png, width * 3);
        delete[] png;

        if (ok) {
            printf("\nWrote %s (%dx%d PNG, linear-stretched to max=%.1f)\n",
                   argv[2], width, height, maxVal);
        } else {
            fprintf(stderr, "stbi_write_png failed for %s\n", argv[2]);
        }
    }

    return nanCount > 0 ? 1 : 0;
}
