// SPDX-License-Identifier: GPL-3.0-or-later
// Standalone shim for RawTherapee's rtengine.h.
//
// Only provides what the ported demosaic files actually need: the
// array2D<T> row-pointer wrapper. In real RawTherapee this lives in
// array2D.h and is a GLOBAL-scope template (not inside `namespace
// rtengine`) — confirmed by xtrans_fast_port.cc itself, which uses
// bare `array2D<float>` both inside `namespace rtengine { ... }` and
// again in the free function below the closing brace. Reproduced here
// as global scope for the same reason.
//
// Only the ARRAY2D_BYREFERENCE (wrap existing row pointers, no copy)
// and plain owning-allocation constructors are implemented — the only
// two modes the standalone ports use.
#pragma once

#include <cstddef>
#include <cstdint>

enum {
    ARRAY2D_BYREFERENCE = 1
};

template <typename T>
class array2D
{
public:
    array2D() : w_(0), h_(0), rows_(nullptr), storage_(nullptr), owns_(false) {}

    // Wrap existing row-pointer array without copying.
    array2D(int w, int h, T* const* data, int /*flags*/)
        : w_(w), h_(h), rows_(const_cast<T**>(data)), storage_(nullptr), owns_(false) {}

    // Allocate and own storage.
    array2D(int w, int h)
        : w_(w), h_(h), storage_(nullptr), owns_(true)
    {
        rows_ = new T*[h_];
        storage_ = new T[static_cast<size_t>(w_) * static_cast<size_t>(h_)];
        for (int r = 0; r < h_; ++r) {
            rows_[r] = storage_ + static_cast<size_t>(r) * static_cast<size_t>(w_);
        }
    }

    ~array2D()
    {
        if (owns_) {
            delete[] storage_;
            delete[] rows_;
        }
    }

    array2D(const array2D&) = delete;
    array2D& operator=(const array2D&) = delete;

    // Real RawTherapee's array2D returns a mutable row pointer even
    // through a const-qualified array2D reference (the wrapper's own
    // constness doesn't propagate to the pointed-to buffer's element
    // type -- consistent with it being a thin reference wrapper around
    // an externally-owned buffer, not an owning const container).
    // Needed by the Markesteijn port, which takes `const array2D<float>
    // &rawData` and still takes `float* pix = &rawData[row][col];` to
    // do pointer arithmetic into neighbouring pixels.
    T* operator[](int row) const { return rows_[row]; }

    int width() const { return w_; }
    int height() const { return h_; }

private:
    int w_;
    int h_;
    T** rows_;
    T* storage_;
    bool owns_;
};
