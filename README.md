# Channel Swap & Filter Curves

**A darkroom for full-spectrum, UV and infrared photography**
Built by [@king_of_little_germany](https://instagram.com/king_of_little_germany) · [irlab.uk](https://irlab.uk)

Two connected browser tools, built from scratch, running entirely client-side — no server, no install, no account. Open the link, drop in a photo, done. Built for photographers shooting UV, infrared and full-spectrum converted cameras who are tired of hunting through forum threads and Photoshop actions to get a real Aerochrome look.

Both tools are static HTML. Everything runs in your browser; nothing is uploaded anywhere.

---

## 1. Channel Swap — the editing tool

False-colour IR and UV photography needs channel swapping, white balance correction twice (before and after the swap), and fine colour control. Almost every tutorial online skips the step that actually matters.

### The swap engine

- **Full 3×3 channel mixer** with negative values, editable live, with a running total per row so you can see at a glance whether a row is changing colour or changing exposure
- **Presets** for the common starting points — R–B swap and cyclic rotation, each with an IR-subtraction variant, plus Bug Vision for UV
- **Pre-swap and post-swap white balance pickers** — the two-step correction most tutorials miss, with a visible tap marker and a forgiving sample area built for imprecise fingers on mobile
- **Calibrate from real patches** — a preset is someone's guess about one filter stack under one light. Photograph materials with stable signatures under your own stack, tap each one, say what colour it should become, and the matrix is solved from measurement instead. A smoothing control trades fit accuracy against the noise amplification an exact fit through few patches can produce.
- **Auto tone** — sets post-swap white balance and black point from the image's own histogram

### Colour that survives the swap

The hard part of false colour isn't the swap, it's what happens to the colours a swap asks for that no display can show.

- **Keep saturation** — some colours cannot be both bright and saturated; a fully saturated blue is a fraction as bright as a fully saturated yellow. At 0% those colours stay bright and go pale; at 100% they keep their richness and go darker instead. Hue is exact either way. Works on hue rotations as well as swaps, using an analytic OKLab gamut-cusp solve, so the trade happens where the colour is chosen rather than being patched up downstream.
- **Gamut mapping** with hue held exact and ratio scaling, so compression can't drift hue
- **Hue shift, saturation, exposure, contrast, black point** — all in OKLab or linear light, none of them fighting each other
- **Tri-tone merge** — three hue-rotated copies, each auto-levelled on its own histogram, combined by taking the brightest of the three per channel. A rebuild of the Aerochrome Photoshop action, whose look came from exactly this. Defaults are the action's own values.
- **Split toning** — two tints crossing over between dark and bright, added as chroma in OKLab so it colours without lifting or dropping brightness. The one look a channel matrix cannot produce, because a matrix treats every pixel the same regardless of how bright it is.
- **Defringe** — removes the purple/magenta halos IR lenses leave on high-contrast edges. Colour only; edge sharpness untouched.

### Seeing what you're doing

- **Scopes** — live histogram with a clipping overlay that measures values *before* the range is enforced. That's what lets it separate a legitimately saturated colour from one that actually lost information: a saturated yellow has zero blue by definition and has lost nothing, while a crushed shadow computed a negative and had it clamped. Both look identical in the final pixel.
- **Source channels** — which channel is actually carrying your signal
- **Raw sensor data** — reads past the embedded preview into the sensor plane itself: Bayer pattern, black level, as-shot white balance. Reporting only, as groundwork toward reading raw pixels directly.
- **Before/after compare slider**, and long-press any slider's value to type an exact number

### Getting work out

- **16-bit TIFF** with a real sRGB ICC profile, plus **PNG** and **JPEG**, all with EXIF preserved
- **Export at working or original resolution**
- **Batch** — apply one look to many files
- **`.cube` LUT import and export** — export bakes your exact look into a standards-compliant 3D LUT, verified against the tool's own LUT reader
- **RAW support** through the embedded camera preview, so CR2/CR3/NEF/ARW/DNG and the rest load directly

### Installable

Add it to your home screen and it works offline. On Android it registers as a **share target**, so a photo goes straight from Gallery or Drive into the tool through the share sheet.

---

## 2. Filter Curves — the reference tool

A transmission-curve visualiser and stacking calculator for UV/IR/colour glass — the thing that answers "what does this filter actually do, and what happens if I stack it with that one?"

154 filters across 13 groups: colour and faux-colour gels (38), IR blockers (16), branded B+W/Hoya/Tiffen (16), colour-conversion (14), UV-pass (12), the IR long-pass step series (12), astronomy narrowband (12), IR-pass (9), MidOpt multi-bandpass (9), special effects (6), Hoya's own contrast-filter naming (6), polarizers (3) and multi-bandpass (1).

**112 of the 154 carry an explicit provenance note** citing where the curve came from and how well it fits — often down to the fitting error in percentage points, and to the specific chart or lab report it was digitised from. The remaining 42 are mostly the entries where the honest answer is that no per-wavelength data exists publicly.

**The physics is real, not decorative:**

- **Beer-Lambert thickness scaling** — doubling a filter's thickness squares its blocking, exactly like real glass
- **Log-scale chart** with minor gridlines — reveals leaks below 1% that a linear axis would hide entirely
- **Stack any combination**, including multiple copies of the same filter, genuinely multiplying transmittance
- **Auto-generated stacking guidance**, derived from the curve maths itself rather than written per filter, so it can't drift out of sync with the model
- **Camera body selector** applied to the combined result only — each filter's own curve never changes with camera choice, because a piece of glass doesn't care what's behind it

**Sourcing discipline.** Real manufacturer and measured data fitted in over several sessions: Eastman Kodak's official Wratten transmittance tables (400–1100nm at 10nm), B+W's, Hoya's and Schott's own charts including the KB-series and the 80A/80B/80C conversion series, independent spectrometer measurements (Kolari IR Chrome, ZWB3, Baader Neodymium), and manufacturer datasheets for GRB1/GRB3, RM90, RM100 and R72.

That process caught real errors rather than just adding numbers. B+W 040/099 were showing different curves for what is the same glass. A Wratten filter had a ~17nm column misread, caught by cross-checking two independent scans of the same table. The Baader Neodymium filter was modelled as staying bright into the NIR when the real one falls to near zero. Where two real sources disagree — Kodak's own Wratten 16 against Tiffen's compatibly-numbered version, 18nm apart — both are shown rather than silently picking one.

**What is not claimed as measured:** most Lee lighting gels, most colour-conversion filters (KB-series aside), didymium, sepia, and the polarizers have no public per-wavelength data anywhere, and the tool says so rather than presenting a guess as fact.

**Known recipes, one tap away:** Candy Chrome DIY, IR Chrome DIY, Kolari IR Chrome, Candy Pink, Pink Aerochrome DIY, Blue Trees (both documented variants), Aerochrome yellow, faux colour on W47, a black-foliage notch stack, L-eXtreme, a real ZWB3+QB21-on-an-unconverted-camera demo sourced from an actual UVP forum thread, and a stock-IR-cut against H-alpha comparison showing exactly why full-spectrum conversion exists.

---

## Design

A darkroom-safelight and spectrometer-instrument aesthetic, built around what the tool is actually for: revealing light you can't see. Warm safelight red for actions, phosphor teal for data readouts, a literal spectrum gradient as the visual signature. No stock icons, no generic dark-theme-with-accent-colour default — every colour and typographic choice ties back to the subject.

## Where the research came from

Eastman Kodak's official Wratten filter handbook; B+W's, Hoya's and Schott's published transmission charts; Kolari Vision; Rob Shea; Pierre-Louis Ferrer; David Kennard; Hidden Realms; [ultravioletphotography.com](https://www.ultravioletphotography.com); Pedro Aphalo's spectrophotometer work; MidOpt's technical datasheets; independent spectrometer measurements shared on Cloudy Nights and truecolorinfrared.com; and Fedia — whose posts on the UVP forum and in the Hidden Realms comments are the direct source for three things here: the Bug Vision preset (ZWB3+TSN575), the faux-UV-on-an-unconverted-camera technique, and the real Canon-body test that is the reason "Blue Trees" is labelled camera-dependent rather than universal.

Plus a fair amount of primary-source digging whenever the popular summary of something turned out not to match what the original document actually said.

## Licence

Source is [AGPL-3.0](LICENSE.md). Third-party components and their licences are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
