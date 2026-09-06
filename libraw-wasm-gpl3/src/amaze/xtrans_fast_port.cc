////////////////////////////////////////////////////////////////
//
// Fast X-Trans demosaic (adapted from RawTherapee's
// RawImageSource::xtransborder_interpolate + fast_xtrans_interpolate)
//
// Original xtrans_demosaic.cc:
// code dated: April 18, 2018
//
// This file is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
//
////////////////////////////////////////////////////////////////

#include "rtengine.h"
#include "rawimagesource.h"
#include "rt_math.h"

namespace rtengine
{

#define XT_FCOL(row, col) xtrans[(row) % 6][(col) % 6]

void xtransborder_interpolate_standalone(
    int width, int height, int border, const int xtrans[6][6],
    const array2D<float> &rawData,
    array2D<float> &red, array2D<float> &green, array2D<float> &blue)
{
    const float weight[3][3] = {
        {0.25f, 0.5f, 0.25f},
        {0.5f, 0.f, 0.5f},
        {0.25f, 0.5f, 0.25f}
    };

    for (int row = 0; row < height; row++)
        for (int col = 0; col < width; col++) {
            if (col == border && row >= border && row < height - border) {
                col = width - border;
            }

            float sum[6] = {0.f};

            for (int y = MAX(0, row - 1), v = row == 0 ? 0 : -1; y <= MIN(row + 1, height - 1); y++, v++)
                for (int x = MAX(0, col - 1), h = col == 0 ? 0 : -1; x <= MIN(col + 1, width - 1); x++, h++) {
                    int f = XT_FCOL(y, x);
                    sum[f] += rawData[y][x] * weight[v + 1][h + 1];
                    sum[f + 3] += weight[v + 1][h + 1];
                }

            switch (XT_FCOL(row, col)) {
                case 0:
                    red[row][col] = rawData[row][col];
                    green[row][col] = (sum[1] / sum[4]);
                    blue[row][col] = (sum[2] / sum[5]);
                    break;

                case 1:
                    if (sum[3] == 0.f) {
                        red[row][col] = green[row][col] = blue[row][col] = rawData[row][col];
                    } else {
                        red[row][col] = (sum[0] / sum[3]);
                        green[row][col] = rawData[row][col];
                        blue[row][col] = (sum[2] / sum[5]);
                    }
                    break;

                case 2:
                    red[row][col] = (sum[0] / sum[3]);
                    green[row][col] = (sum[1] / sum[4]);
                    blue[row][col] = rawData[row][col];
            }
        }
}

void fast_xtrans_interpolate_standalone(
    int width, int height, const int xtrans[6][6],
    const array2D<float> &rawData,
    array2D<float> &red, array2D<float> &green, array2D<float> &blue)
{
    xtransborder_interpolate_standalone(width, height, 1, xtrans, rawData, red, green, blue);

    const float weight[3][3] = {
        {0.25f, 0.5f, 0.25f},
        {0.5f, 0.f, 0.5f},
        {0.25f, 0.5f, 0.25f}
    };

    for (int row = 1; row < height - 1; ++row) {
        for (int col = 1; col < width - 1; ++col) {
            float sum[3] = {};

            for (int v = -1; v <= 1; v++) {
                for (int h = -1; h <= 1; h++) {
                    sum[XT_FCOL(row + v, col + h)] += rawData[row + v][(col + h)] * weight[v + 1][h + 1];
                }
            }

            switch (XT_FCOL(row, col)) {
                case 0:
                    red[row][col] = rawData[row][col];
                    green[row][col] = sum[1] * 0.5f;
                    blue[row][col] = sum[2];
                    break;

                case 1:
                    green[row][col] = rawData[row][col];
                    if (XT_FCOL(row, col - 1) == XT_FCOL(row, col + 1)) {
                        red[row][col] = sum[0];
                        blue[row][col] = sum[2];
                    } else {
                        red[row][col] = sum[0] * 1.3333333f;
                        blue[row][col] = sum[2] * 1.3333333f;
                    }
                    break;

                case 2:
                    red[row][col] = sum[0];
                    green[row][col] = sum[1] * 0.5f;
                    blue[row][col] = rawData[row][col];
                    break;
            }
        }
    }
}

#undef XT_FCOL

} // namespace rtengine

void xtrans_fast_demosaic_port(int w, int h, const int xtrans[6][6],
                                float* const* rawData,
                                float** red, float** green, float** blue)
{
    array2D<float> rawA(w, h, const_cast<float**>(rawData), ARRAY2D_BYREFERENCE);
    array2D<float> redA(w, h, red, ARRAY2D_BYREFERENCE);
    array2D<float> greenA(w, h, green, ARRAY2D_BYREFERENCE);
    array2D<float> blueA(w, h, blue, ARRAY2D_BYREFERENCE);

    rtengine::fast_xtrans_interpolate_standalone(w, h, xtrans, rawA, redA, greenA, blueA);
}
