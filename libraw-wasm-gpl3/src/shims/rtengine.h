// SPDX-License-Identifier: GPL-3.0-or-later
// Standalone shim for RawTherapee's rtengine.h.
// array2D is GLOBAL scope (not inside namespace rtengine) — matches
// how xtrans_fast_port.cc uses it both inside and outside the namespace.
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

    array2D(int w, int h, T* const* data, int /*flags*/)
        : w_(w), h_(h), rows_(const_cast<T**>(data)), storage_(nullptr), owns_(false) {}

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

    T* operator[](int row) { return rows_[row]; }
    const T* operator[](int row) const { return rows_[row]; }

    int width() const { return w_; }
    int height() const { return h_; }

private:
    int w_;
    int h_;
    T** rows_;
    T* storage_;
    bool owns_;
};
