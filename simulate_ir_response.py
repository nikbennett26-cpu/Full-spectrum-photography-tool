"""
IR colour system simulation pipeline for irlab.uk
===================================================

Goal: simulate what a full-spectrum-converted camera's raw sensor sees for a
given real-world material, then fit a 3x3 matrix from those simulated raw
values to a chosen set of target colours (the way Aerochrome's red-foliage
look is a *target*, not a physical fact) — the same kind of matrix irlab's
Channel Swap panel already takes, just derived from a physical model instead
of hand-tuned by eye against one or two reference photos.

    Response(band) = integral over wavelength of:
        Reflectance(lambda) * Illuminant(lambda) * FilterTransmission(lambda) * SensorQE(lambda, band)

STATUS OF EACH INPUT — READ THIS BEFORE TRUSTING ANY OUTPUT NUMBER:

  Illuminant ............ REAL. Two options now: colour-science's bundled
                           CIE D65 (visible-range only), or AM1.5 Global (a
                           real standard solar spectrum extending to 1100nm,
                           sourced from CheeseCube312's Filter-Plotter-Data
                           project) — the latter is the more honest choice
                           for outdoor IR work, since D65 was never defined
                           past the visible range in the first place.

  Filter transmission ... REAL. Wired to filters.html's actual model
                           (edgeUp/edgeDn/bandT/filterT, run via Node) —
                           see load_filter_transmission() below.

  Reflectance ........... REAL for one material class: four actual measured
                           leaf reflectance spectra (400-1100nm), also from
                           CheeseCube312's Filter-Plotter-Data project —
                           these are that project's own documented default
                           reflectance set (see reflectors/default_reflectors.json
                           in the source repo), not a substitution I chose.
                           Soil and neutral-grey are STILL placeholders —
                           the USGS splib07 download in progress should
                           cover soil; neutral-grey is a flat reference by
                           construction, not something that needs "real"
                           data as such.

  Sensor QE .............. REAL, with a caveat worth keeping in mind: sourced
                           from QE_Kodak_KAF_8300_CCD.tsv (also via
                           CheeseCube312), a genuine measured per-channel QE
                           curve extending with real (non-noise-floor) signal
                           all the way to 1100nm. This is a scientific
                           astronomy CCD, not a converted DSLR/mirrorless
                           sensor — astro cameras are often sold without the
                           aggressive hot mirror consumer cameras have, which
                           is presumably why this data exists at all when
                           three separate consumer-camera datasets (NPL,
                           Jinwei Gu/camspec, and Butcher's own spectroscope
                           measurements) all hit a wall at ~700-715nm. It's
                           the best real substitute found for "hot-mirror-
                           removed sensor response" — but it's still a
                           different physical device than what's actually in
                           a converted DSLR, so treat results as
                           representative-shape-plausible, not
                           camera-verified. A generic "Default_QE.tsv"
                           (labelled by its own source as "Generic CMOS
                           sensor") is also available as get_sensor_qe_generic()
                           if a non-astro-specific curve is preferred.

Nothing here has been validated against a real photo yet. That's the next
step now that reflectance and QE are both backed by real (if imperfectly
matched) data — compare simulated output against Fedia's real photos and
the Triple Band Aerochrome LUT, per the original plan.
"""

import os
import numpy as np

try:
    import colour
    HAVE_COLOUR_SCIENCE = True
except ImportError:
    HAVE_COLOUR_SCIENCE = False

# Working wavelength grid. 380-1000nm covers visible through the practical
# edge of silicon sensitivity. 5nm steps balance integration accuracy against
# how coarse the filter/reflectance data actually is — no point sampling
# finer than the least precise input.
WAVELENGTHS = np.arange(380, 1001, 5)

REAL_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "real_data")


def _load_tsv_column(path, col_index):
    """Shared parser for CheeseCube312's TSV format: a header row, then rows
    of `wavelength <tab> value1 <tab> value2 ... <tab> manufacturer <tab> name`,
    where manufacturer/name are only populated on the first data row. Returns
    (wavelengths, values) as plain lists, resampling left to the caller
    (np.interp against WAVELENGTHS is the usual next step) since different
    callers want different edge-clamping behaviour."""
    wls, vals = [], []
    with open(path, encoding="utf-8") as f:
        next(f)  # header
        for line in f:
            cols = line.rstrip("\n").split("\t")
            if len(cols) <= col_index:
                continue
            try:
                wl = float(cols[0])
                v = float(cols[col_index])
            except ValueError:
                continue
            wls.append(wl)
            vals.append(v)
    return wls, vals


# ---------------------------------------------------------------------------
# Illuminant — REAL data, two options
# ---------------------------------------------------------------------------

def get_illuminant(name="D65"):
    """
    Returns illuminant SPD resampled onto WAVELENGTHS.

    "D65" -- real CIE standard via colour-science, but only ever defined for
    the visible range; anything WAVELENGTHS asks for past ~780nm is
    colour-science's own extrapolation/padding, not a real CIE value.

    "AM1.5" -- a real standard solar spectrum (the photovoltaics-industry
    reference for terrestrial sunlight), extending with genuine data to
    1100nm and beyond, via CheeseCube312's Filter-Plotter-Data project. The
    more honest choice for anything meant to represent actual outdoor IR
    photography conditions, since D65 was never meant to cover this range
    at all.
    """
    if name == "AM1.5":
        path = os.path.join(REAL_DATA_DIR, "illuminants", "AM1.5_Global_REL.tsv")
        wls, vals = _load_tsv_column(path, 1)
        return np.interp(WAVELENGTHS, wls, vals, left=vals[0], right=vals[-1])
    if HAVE_COLOUR_SCIENCE:
        sd = colour.SDS_ILLUMINANTS[name]
        sd = sd.copy().align(colour.SpectralShape(WAVELENGTHS[0], WAVELENGTHS[-1], 5))
        return np.nan_to_num(sd.values, nan=0.0)
    else:
        print("WARNING: colour-science not available, using flat illuminant placeholder")
        return np.ones_like(WAVELENGTHS, dtype=float)


# ---------------------------------------------------------------------------
# Filter transmission — STUB, needs wiring to filters.html's real dataset
# ---------------------------------------------------------------------------

def load_filter_transmission(filter_id, filters_dir=None):
    """
    REAL DATA. Loads the actual transmission curve from irlab's filters.html,
    by running its real transmission model (edgeUp/edgeDn/bandT/filterT --
    the same sigmoid-band math, Beer-Lambert thickness scaling, and Fresnel
    surface-loss handling filters.html itself uses) via Node, rather than
    hand-copying numbers into a second, driftable source of truth. If
    filters.html's real curves ever change, re-running this re-extracts them
    automatically instead of silently going stale.

    Requires filters_core.js (extracted from filters.html lines 580-1577 --
    the pure data + transmission model, before the DOM-dependent UI code
    starts) to sit alongside this script, or pass filters_dir explicitly.
    """
    import subprocess, json, os
    d = filters_dir or os.path.dirname(os.path.abspath(__file__))
    script = os.path.join(d, "filters_core.js")
    lo, hi, step = WAVELENGTHS[0], WAVELENGTHS[-1], WAVELENGTHS[1] - WAVELENGTHS[0]
    result = subprocess.run(
        ["node", script, str(filter_id), str(lo), str(hi), str(step)],
        capture_output=True, text=True, check=True,
    )
    data = json.loads(result.stdout)
    curve = np.array(data[filter_id]["transmission"])
    # filters.html's grid should match WAVELENGTHS exactly since we passed
    # the same lo/hi/step -- this assert catches it early if that ever drifts
    assert len(curve) == len(WAVELENGTHS), \
        f"filter curve length {len(curve)} != WAVELENGTHS length {len(WAVELENGTHS)}"
    return curve


# ---------------------------------------------------------------------------
# Sensor QE — PLACEHOLDER, flagged prominently, see module docstring
# ---------------------------------------------------------------------------

def get_sensor_qe_real(source="kaf8300"):
    """
    REAL DATA, with an honest caveat about the match to what this project
    actually needs. Two real options, both via CheeseCube312's
    Filter-Plotter-Data project:

    "kaf8300" (default) -- QE_Kodak_KAF_8300_CCD.tsv, a genuine measured
    per-channel QE curve for a real scientific astronomy CCD, with actual
    non-noise-floor signal all the way to 1100nm. This is the best real
    substitute found for "what does a hot-mirror-removed sensor see in the
    NIR" -- three separate consumer-camera datasets (NPL, Jinwei Gu/camspec,
    and Glenn Butcher's own spectroscope measurements) all hit a wall at
    ~700-715nm because every one of them measured a STOCK, hot-mirror-
    equipped body. Astro CCDs are often sold without that aggressive
    filtering, which is presumably why this one has real data where the
    others don't. Caveat: it's a genuinely different physical device
    (scientific CCD, not a converted DSLR/mirrorless Bayer sensor) --
    treat results as representative-shape-plausible, not camera-verified.

    "generic" -- Default_QE.tsv, labelled by its own source simply as
    "Generic CMOS sensor" -- a real curated reference rather than something
    invented for this project, but with no stated pedigree beyond that
    label, and it goes to ~zero by 1080nm (see its own data), consistent
    with a stock-camera-style rolloff rather than a converted sensor's.
    """
    filenames = {
        "kaf8300": "QE_Kodak_KAF_8300_CCD.tsv",
        "generic": "Default_QE.tsv",
    }
    path = os.path.join(REAL_DATA_DIR, "QE_data", filenames[source])
    # Columns are Wavelength, B, G, R (in that order -- checked against the
    # file's own header, not assumed) as percentages (0-100), matching
    # filters.html's real-data convention, so divide by 100 here too.
    out = {}
    for band, col in [("B", 1), ("G", 2), ("R", 3)]:
        wls, vals = _load_tsv_column(path, col)
        out[band] = np.interp(WAVELENGTHS, wls, np.array(vals) / 100, left=0, right=0)
    return out


# ---------------------------------------------------------------------------
# Reflectance — REAL for vegetation, still placeholder for soil/neutral
# ---------------------------------------------------------------------------

def get_reflectance_library():
    """
    Vegetation is now REAL DATA: four actual measured leaf reflectance
    spectra (400-1100nm), via CheeseCube312's Filter-Plotter-Data project --
    and per that project's own reflectors/default_reflectors.json, these
    four leaves are its own documented default reflector set, not a
    substitution chosen for this project. Averaged into one "foliage" entry
    for now; the four are similar enough in shape (all show the same real
    red-edge rise) that using all four individually as separate fit targets
    would mostly add near-duplicate rows rather than real material variety
    -- worth revisiting if the matrix fit ever needs more spread specifically
    within the vegetation class.

    Soil and neutral-grey are STILL placeholders -- the USGS splib07
    download in progress should cover soil with real data; neutral-grey
    is a flat reference by construction, not something "real" data would
    change.
    """
    leaf_dir = os.path.join(REAL_DATA_DIR, "reflectors", "plant")
    leaf_curves = []
    for i in range(1, 5):
        path = os.path.join(leaf_dir, f"Leaf_{i}_reflectance_extrapolated_1100.tsv")
        wls, vals = _load_tsv_column(path, 1)
        leaf_curves.append(np.interp(WAVELENGTHS, wls, vals, left=vals[0], right=vals[-1]))
    foliage = np.mean(leaf_curves, axis=0)

    def soil(wl):
        # Soil reflectance genuinely does rise fairly smoothly and
        # monotonically with wavelength in reality -- this is a rough
        # placeholder shape, not measured, but the general upward trend is
        # a real documented characteristic of soil spectra, not invented.
        # STILL A PLACEHOLDER -- replace once USGS splib07 soil spectra land.
        return 0.15 + 0.35 * (wl - 380) / (1000 - 380)

    def sky_proxy(wl):
        # Not a "reflectance" physically -- included as a rough stand-in
        # for a bright, spectrally-flat-ish target (e.g. a grey card or an
        # overcast sky) for calibration/sanity purposes only.
        return np.full_like(wl, 0.5, dtype=float)

    return {
        "foliage": foliage,
        "soil": soil(WAVELENGTHS),
        "neutral_grey": sky_proxy(WAVELENGTHS),
    }


# ---------------------------------------------------------------------------
# Core integration
# ---------------------------------------------------------------------------

def simulate_raw_response(reflectance, illuminant, filter_transmission, sensor_qe):
    """Response(band) = sum over wavelength of R * I * F * QE(band), per the
    module docstring's formula. Simple Riemann sum since WAVELENGTHS is
    evenly spaced -- fine at 5nm resolution for anything but a razor-sharp
    spectral feature narrower than that."""
    combined = reflectance * illuminant * filter_transmission
    return {
        band: float(np.sum(combined * qe))
        for band, qe in sensor_qe.items()
    }


def build_simulated_raw_table(filter_id="ir590", illuminant_name="D65", qe_source="kaf8300"):
    """Runs every material through the pipeline for one filter, returns
    {material_name: {R,G,B}} raw response table -- the direct input to the
    least-squares matrix fit."""
    illum = get_illuminant(illuminant_name)
    filt = load_filter_transmission(filter_id)
    qe = get_sensor_qe_real(qe_source)
    materials = get_reflectance_library()

    table = {}
    for name, refl in materials.items():
        table[name] = simulate_raw_response(refl, illum, filt, qe)
    return table


# ---------------------------------------------------------------------------
# Least-squares 3x3 matrix fit: simulated raw RGB -> target RGB
# ---------------------------------------------------------------------------

def fit_matrix(raw_table, target_table):
    """
    Standard least-squares colour matrix fit. Given N materials each with a
    simulated raw (r,g,b) and a chosen TARGET (r,g,b) -- e.g. "foliage should
    land near Aerochrome red" -- solves for the 3x3 M minimizing
    sum_i || M @ raw_i - target_i ||^2.

    This is the exact numerical step that turns "we have a physical
    simulation" into "we have a matrix irlab's Channel Swap panel can
    actually use" -- same slot as every hand-tuned preset already there.

    Needs at least 3 non-degenerate materials to fully constrain a 3x3
    matrix; more (and more varied) materials give a better-conditioned fit,
    the same way a real camera calibration uses a full colour chart rather
    than 3 patches.

    Fits on NORMALIZED raw RGB (each triplet divided by its own sum), not
    absolute simulated intensity. This matters because different filters
    pass wildly different total amounts of light (a 590nm long-pass passes
    far more than an 850nm one) -- fitting on raw magnitude would make the
    matrix partly compensate for that overall brightness difference instead
    of purely learning colour separation, and would make matrices fit under
    different filters incomparable in scale. Every real camera pipeline
    white-balances/normalizes before a colour matrix is ever applied, so
    this matches that rather than inventing a new convention.
    """
    names = list(raw_table.keys())
    raw = np.array([[raw_table[n]["R"], raw_table[n]["G"], raw_table[n]["B"]] for n in names])
    raw = raw / raw.sum(axis=1, keepdims=True)
    target = np.array([target_table[n] for n in names])

    # Solve raw @ M.T = target  =>  M.T = lstsq(raw, target)
    M_T, residuals, rank, sv = np.linalg.lstsq(raw, target, rcond=None)
    M = M_T.T

    if rank < 3:
        print(f"WARNING: fit is under-constrained (rank {rank} < 3) -- "
              f"need more/more-varied materials for a reliable 3x3 fit")

    return M


if __name__ == "__main__":
    print(f"Wavelength grid: {WAVELENGTHS[0]}-{WAVELENGTHS[-1]}nm, {len(WAVELENGTHS)} points\n")

    for filter_id in ["ir590", "ir720"]:
        print(f"=== {filter_id} (real filters.html transmission data) ===")
        raw_table = build_simulated_raw_table(filter_id=filter_id)
        for name, rgb in raw_table.items():
            total = sum(rgb.values()) or 1
            norm = {k: round(v / total, 4) for k, v in rgb.items()}
            print(f"  {name:15s} normalized={norm}")
        # Spread across materials is the actual thing we care about here --
        # low spread means the sensor genuinely isn't differentiating them,
        # matching last message's hypothesis for a pure-IR long-pass filter.
        r_vals = [rgb["R"] / sum(rgb.values()) for rgb in raw_table.values()]
        print(f"  R-channel spread across materials: {(max(r_vals) - min(r_vals)) * 100:.2f} percentage points\n")

    print("If ir590's spread is meaningfully larger than ir720's, that confirms")
    print("the mixed visible+NIR hypothesis from last message using real filter")
    print("data instead of the earlier synthetic stand-in.\n")

    # Matrix fit, now using real KAF-8300 QE and real (averaged) leaf
    # reflectance for foliage -- soil and neutral-grey are still
    # placeholders, so this is STILL only 3 materials for a 3x3 fit, i.e.
    # still the same under-constrained, numerically fragile regime flagged
    # last time. Real QE/reflectance improves what each material's number
    # MEANS, but doesn't by itself fix the "too few materials" problem --
    # that needs the USGS soil data (and ideally several more materials
    # generally) to actually resolve.
    raw_table = build_simulated_raw_table(filter_id="ir590")
    target_table = {
        "foliage": [0.9, 0.1, 0.1],
        "soil": [0.4, 0.3, 0.2],
        "neutral_grey": [0.33, 0.33, 0.33],
    }
    M = fit_matrix(raw_table, target_table)
    print("Fitted 3x3 matrix for ir590 (real filter + QE + vegetation data, soil/neutral still placeholder):")
    print(M)
    print("\nStill only 3 materials feeding a 3x3 fit -- expect this to still be")
    print("poorly conditioned until real soil data replaces that placeholder too.")
    print("Same slot as irlab's existing Channel Swap matrix (m00..m22) once it is.")

