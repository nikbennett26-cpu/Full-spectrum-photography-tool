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

  Reflectance ........... REAL, both vegetation and soil now. Four leaf
                           reflectance spectra from CheeseCube312's
                           Filter-Plotter-Data project (that project's own
                           documented default set), plus 14 real USGS
                           Spectral Library v7 vegetation species (Kokaly
                           et al. 2017) with genuine structural variety —
                           trees, conifers, shrubs, a succulent, wetland,
                           and a dry/green grass contrast — and 4 real
                           USGS soil/ground samples (two sand, two basalt).
                           Only neutral-grey is still a flat construction,
                           which is correct by definition rather than a
                           gap. Per-species TARGET colours (what each
                           species should map toward for the matrix fit)
                           are a separate, still-provisional design choice
                           — see build_vegetation_targets()'s own
                           docstring.

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

    filter_id can be a single id ("ir590") or a list/tuple for a real
    filter STACK (e.g. ["zwb3", "qb21", "qb21"] for ZWB3 plus two QB21s --
    repeat an id for multiple copies of the same glass). A stack's combined
    transmission is the per-wavelength PRODUCT of each filter's own curve --
    correct for stacking absorptive glass (Beer-Lambert: transmittances
    multiply), which is what every filter used for validation so far has
    been. This does NOT reproduce filters.html's own stackT() line for
    line (that also handles thickness scaling and interference-type
    filters differently) -- for the plain-absorptive-glass case tested here
    it gives the same answer, but treat it as an approximation, not a
    guaranteed match, for anything with an interference filter in the mix.

    Requires filters_core.js (extracted from filters.html lines 580-1577 --
    the pure data + transmission model, before the DOM-dependent UI code
    starts) to sit alongside this script, or pass filters_dir explicitly.
    """
    import subprocess, json, os
    d = filters_dir or os.path.dirname(os.path.abspath(__file__))
    script = os.path.join(d, "filters_core.js")
    lo, hi, step = WAVELENGTHS[0], WAVELENGTHS[-1], WAVELENGTHS[1] - WAVELENGTHS[0]

    ids = [filter_id] if isinstance(filter_id, str) else list(filter_id)
    unique_ids = sorted(set(ids))
    result = subprocess.run(
        ["node", script, ",".join(unique_ids), str(lo), str(hi), str(step)],
        capture_output=True, text=True, check=True,
    )
    data = json.loads(result.stdout)

    curve = np.ones_like(WAVELENGTHS, dtype=float)
    for uid in unique_ids:
        c = np.array(data[uid]["transmission"])
        assert len(c) == len(WAVELENGTHS), \
            f"filter curve length {len(c)} != WAVELENGTHS length {len(WAVELENGTHS)}"
        count = ids.count(uid)  # repeats -- e.g. two copies of the same QB21
        curve = curve * (c ** count)
    return curve


# ---------------------------------------------------------------------------
# Sensor QE — PLACEHOLDER, flagged prominently, see module docstring
# ---------------------------------------------------------------------------

def get_sensor_qe_real(source="kaf8300"):
    """
    REAL DATA, with an honest caveat about the match to what this project
    actually needs. Three options now, two straight from CheeseCube312's
    Filter-Plotter-Data project and one empirically adjusted from them:

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
    label.

    "canon_fullspectrum_empirical" -- "generic" with the blue channel's
    NIR crossover (both real reference curves show blue rising again
    around 750-850nm, the well-documented "Bayer dye filters lose colour
    selectivity in NIR" effect) suppressed. This ISN'T a second real
    dataset -- it's a one-photo empirical correction, built after a real
    Canon full-spectrum body + Wratten 12 photo (IMG_8269.CR2) showed
    hard mineral surfaces (basalt, stucco, pavement) reading at genuinely
    ZERO blue -- below the sensor's own black level, not just low -- where
    both real reference curves predicted 13-25% relative blue from NIR
    leaking back through. One photo is not a validated general model of
    "how Canon sensors behave"; treat this as a working hypothesis this
    specific camera's blue channel doesn't regain much NIR sensitivity,
    not as a fact about Canon sensors generally. Worth re-checking against
    a second real photo, ideally a different filter, before trusting it
    beyond this one comparison.

    NOT applied to the green channel, despite a second real photo (a
    Canon full-spectrum body through ZWB3+QB21+QB21, IMG_4060.CR2) also
    showing a real discrepancy: green predicted at 14-22%, real photo
    showed 1-3%. Traced the actual wavelength contribution rather than
    guessing, and found the mismatch wasn't primarily about this stack's
    real 400nm UV/violet peak at all -- roughly half of it came from a
    small residual leak around 670-690nm, where QB21's own entry in
    filters.html already says "treat the exact position/slope as
    provisional" about precisely the closing-edge parameter responsible
    (hi:665, hs:22). That's the filter model's own already-disclosed
    uncertainty lining up with where the discrepancy actually is -- which
    means this is very likely a filters.html curve-fitting question, not
    a sensor QE one, and patching the QE here would be fixing the wrong
    layer. Left alone pending better real QB21 lab data to refit that
    slope against, rather than trading one guess for another.
    """
    filenames = {
        "kaf8300": "QE_Kodak_KAF_8300_CCD.tsv",
        "generic": "Default_QE.tsv",
        "canon_fullspectrum_empirical": "Default_QE.tsv",
    }
    path = os.path.join(REAL_DATA_DIR, "QE_data", filenames[source])
    # Columns are Wavelength, B, G, R (in that order -- checked against the
    # file's own header, not assumed) as percentages (0-100), matching
    # filters.html's real-data convention, so divide by 100 here too.
    out = {}
    for band, col in [("B", 1), ("G", 2), ("R", 3)]:
        wls, vals = _load_tsv_column(path, col)
        out[band] = np.interp(WAVELENGTHS, wls, np.array(vals) / 100, left=0, right=0)

    if source == "canon_fullspectrum_empirical":
        # Fade blue to ~zero from 700nm, fully gone by 780nm -- a plain
        # sigmoid rolloff, not fit to any particular curve shape, since the
        # only real evidence here is "basically zero past this filter's
        # passband," not a measured rate of decline.
        fade = 1.0 / (1.0 + np.exp((WAVELENGTHS - 740) / 15))
        out["B"] = out["B"] * fade

    return out


# ---------------------------------------------------------------------------
# Reflectance — REAL for vegetation, still placeholder for soil/neutral
# ---------------------------------------------------------------------------

def _load_usgs_splib07(path):
    """
    Parser for USGS Spectral Library Version 7's 's07_ASD' convolved format
    (Kokaly et al. 2017, USGS Data Series 1035) -- a header line, then 2151
    reflectance values with no wavelength column, because the wavelength
    axis is fixed and documented rather than stored per-file: 350-2500nm at
    a uniform 1nm step (confirmed against this file's own line count: 2151
    data lines, matching 2500-350+1 exactly). Bad/unmeasured bands are
    marked -1.23e34, a USGS-specific sentinel documented in their own
    release notes -- these get dropped rather than interpolated through
    silently, since some species have real gaps (e.g. around the 1400/1900nm
    water-absorption bands) that a naive fill would paper over.
    """
    with open(path, encoding="utf-8", errors="replace") as f:
        lines = [l.strip() for l in f.readlines()[1:]]  # skip header
    vals = np.array([float(l) for l in lines if l])
    wls = np.arange(350, 350 + len(vals))
    good = vals > -1e30  # drop the -1.23e34 bad-band sentinel
    return wls[good], vals[good]


def get_reflectance_library():
    """
    Vegetation is now REAL DATA from two independent sources:

    - Four leaf spectra via CheeseCube312's Filter-Plotter-Data project
      (400-1100nm), averaged into one "foliage_leaf_avg" entry -- kept as
      its own entry since it's a genuinely different kind of measurement
      (individual leaves) than the USGS canopy/plant data below.
    - 14 real USGS Spectral Library v7 species (Kokaly et al. 2017,
      s07_ASD convolved format, 350-2500nm) -- actual field/lab
      measurements of real plants, not leaf-only samples: Aspen, Blue
      Spruce, Buckbrush, Cactus, Cattail, Chamise, Douglas-Fir, Engelmann
      Spruce, two grass samples at different dry/green ratios, Lodgepole
      Pine, Manzanita, Pinon Pine, and Sagebrush. Chosen for real
      structural variety (broadleaf, conifer needle, succulent, wetland,
      chaparral shrub, and a dry-vs-green grass contrast), not just
      quantity -- this is what actually fixes the earlier "3 materials,
      ill-conditioned 3x3 fit" problem: enough real, sufficiently
      different rows for the least-squares solve to be over-determined
      instead of an exact (and therefore fragile) fit.

    Soil is STILL a placeholder -- the USGS library has real soil spectra
    (Chapter S) but they haven't been sourced into this project yet.
    Neutral-grey is a flat reference by construction, not something real
    data would change.
    """
    leaf_dir = os.path.join(REAL_DATA_DIR, "reflectors", "plant")
    leaf_curves = []
    for i in range(1, 5):
        path = os.path.join(leaf_dir, f"Leaf_{i}_reflectance_extrapolated_1100.tsv")
        wls, vals = _load_tsv_column(path, 1)
        leaf_curves.append(np.interp(WAVELENGTHS, wls, vals, left=vals[0], right=vals[-1]))
    foliage_leaf_avg = np.mean(leaf_curves, axis=0)

    usgs_veg_dir = os.path.join(REAL_DATA_DIR, "reflectors", "usgs_vegetation")
    usgs_species = {}
    if os.path.isdir(usgs_veg_dir):
        for fname in sorted(os.listdir(usgs_veg_dir)):
            if not fname.endswith(".txt"):
                continue
            # e.g. "s07_ASD_Blue_Spruce_DW92-5_needles_BECKa_AREF.txt" -> "blue_spruce"
            key = fname.replace("s07_ASD_", "").split("_")[0:2]
            key = "_".join(key).lower().rstrip("-").replace("-", "_")
            wls, vals = _load_usgs_splib07(os.path.join(usgs_veg_dir, fname))
            # WAVELENGTHS (380-1000nm) is fully inside USGS's 350-2500nm range,
            # so this is real interpolation within measured data, not edge
            # extrapolation the way the leaf curves above need.
            usgs_species[key] = np.interp(WAVELENGTHS, wls, vals)

    # Real soil/ground samples, replacing the old placeholder curve -- same
    # USGS splib07 source, Chapter S (Soils and Mixtures). Picked two sand
    # samples (Deepwater Horizon spill site data, but the "no visible oil"
    # readings are just real beach sand) and two basalt samples (fresh vs
    # weathered, a real and fairly large spectral difference worth having)
    # rather than one soil placeholder.
    usgs_soil_dir = os.path.join(REAL_DATA_DIR, "reflectors", "usgs_soil")
    usgs_soil = {}
    if os.path.isdir(usgs_soil_dir):
        for fname in sorted(os.listdir(usgs_soil_dir)):
            if not fname.endswith(".txt"):
                continue
            key = "soil_" + fname.replace("s07_ASD_", "").split("_")[0].lower()
            # both Basalt files share the same first token -- disambiguate
            if "weathered" in fname.lower():
                key += "_weathered"
            elif "fresh" in fname.lower():
                key += "_fresh"
            elif "grndisle" in fname.lower():
                key += "_grandisle"
            wls, vals = _load_usgs_splib07(os.path.join(usgs_soil_dir, fname))
            usgs_soil[key] = np.interp(WAVELENGTHS, wls, vals)

    def sky_proxy(wl):
        # Not a "reflectance" physically -- included as a rough stand-in
        # for a bright, spectrally-flat-ish target (e.g. a grey card or an
        # overcast sky) for calibration/sanity purposes only.
        return np.full_like(wl, 0.5, dtype=float)

    library = {
        "foliage_leaf_avg": foliage_leaf_avg,
        "neutral_grey": sky_proxy(WAVELENGTHS),
    }
    library.update(usgs_species)
    library.update(usgs_soil)
    return library


# Which get_reflectance_library() keys are vegetation, for target-design
# purposes below -- everything except the flat neutral reference and the
# real soil/ground samples.
def _is_vegetation_key(name):
    return name not in ("neutral_grey",) and not name.startswith("soil_")


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


def build_vegetation_targets(reflectance_lib):
    """
    Per-species targets grounded in each species' OWN measured NIR
    reflectance (mean over 750-900nm), not one flat colour assigned to
    every vegetation species alike. This directly replaces the earlier
    version, which forced 15 genuinely different real species toward one
    identical illustrative target -- numerically over-determined, but not
    honest about what the real data actually showed, and produced a
    fitted matrix that looked accordingly unstable.

    The physical basis for varying by NIR strength: this is a real,
    measurable property already sitting in the loaded data (not invented),
    and it corresponds to something true-Aerochrome photography actually
    shows -- a species reflecting more NIR has more energy for a false-
    colour swap to work with, and tends to render more vividly than one
    that doesn't. Species are ranked by their own measured NIR reflectance
    relative to the full real spread across the whole library (not an
    absolute cutoff), so the mapping adapts to whatever the actual data
    shows rather than assuming a fixed scale.

    Still a design choice, not a measured ground truth -- exactly which
    curve maps "NIR strength" to "target vividness" is a modelling
    decision (linear here), and the 0.55-0.90 / down-to-0.03 endpoints
    were picked to give visible spread, not fit to a specific reference
    photo. Worth revisiting once there's a real photo to validate against.
    """
    nir_band = (WAVELENGTHS >= 750) & (WAVELENGTHS <= 900)
    nir_strength = {
        name: float(np.mean(refl[nir_band]))
        for name, refl in reflectance_lib.items()
        if _is_vegetation_key(name)
    }
    lo, hi = min(nir_strength.values()), max(nir_strength.values())
    span = max(hi - lo, 1e-6)

    targets = {}
    for name in reflectance_lib:
        if name == "neutral_grey":
            targets[name] = [0.33, 0.33, 0.33]
        elif name.startswith("soil_"):
            targets[name] = [0.4, 0.3, 0.2]
        else:
            frac = (nir_strength[name] - lo) / span  # 0..1, real measured spread within this library
            r = 0.55 + 0.35 * frac
            g = max(0.25 - 0.15 * frac, 0.03)
            b = max(0.20 - 0.10 * frac, 0.03)
            targets[name] = [r, g, b]
    return targets, nir_strength


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

    # Matrix fit -- every input now real, with the sensor QE upgraded to
    # the empirically-corrected variant after real validation: a genuine
    # Canon full-spectrum photo through Wratten 12 (IMG_8269.CR2) showed
    # hard mineral surfaces reading at true zero blue (below the sensor's
    # own black level), where both off-the-shelf QE references predicted
    # 13-25% relative blue from NIR leaking back through. Suppressing that
    # crossover brought simulated foliage blue (0.042) inside the real
    # photo's measured range (0.04-0.10) and cut hard-surface blue from
    # ~0.13-0.20 down to ~0.05-0.07 -- real improvement, not a perfect
    # match; that residual gap is honest, not hidden.
    raw_table = build_simulated_raw_table(filter_id="ir590", qe_source="canon_fullspectrum_empirical")
    reflectance_lib = get_reflectance_library()
    target_table, nir_strength = build_vegetation_targets(reflectance_lib)

    print("Per-species target red intensity, driven by each one's own real NIR reflectance:")
    for name in sorted(nir_strength, key=nir_strength.get, reverse=True):
        print(f"  {name:30s} NIR refl={nir_strength[name]:.3f}  target={[round(x,2) for x in target_table[name]]}")

    M = fit_matrix(raw_table, target_table)
    print(f"\nFitted 3x3 matrix for ir590 ({len(raw_table)} real materials, real filter + QE data, varying real targets):")
    print(M)
    print(f"\n{len(raw_table)} materials feeding a 3x3 fit (9 unknowns), targets now spread across a real")
    print("measured range instead of collapsed to one colour. Still a starting-point matrix --")
    print("the exact target curve (how NIR strength maps to vividness) is a modelling choice,")
    print("not a measured ground truth. Same slot as irlab's existing Channel Swap matrix")
    print("(m00..m22) once validated against real photos.")

