// SPDX-License-Identifier: GPL-3.0-or-later
// Standalone shim for RawTherapee's rt_math.h.
// MAX/MIN used by xtrans_fast_port.cc; SQR/LIM used by the Markesteijn
// port -- real signatures from RawTherapee's own rt_math.h (constexpr
// templates, not macros, to match exactly and avoid macro pitfalls
// with the compound expressions both ports pass in).
#pragma once

#ifndef MAX
#define MAX(a, b) ((a) > (b) ? (a) : (b))
#endif

#ifndef MIN
#define MIN(a, b) ((a) < (b) ? (a) : (b))
#endif

template<typename T>
constexpr T SQR(T x)
{
    return x * x;
}

template<typename T>
constexpr const T& LIM(const T& val, const T& low, const T& high)
{
    return val < low ? low : (val > high ? high : val);
}
