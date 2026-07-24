Channel Swap & Filter Curves
A darkroom for full-spectrum, UV and infrared photography
Built by @king_of_little_germany
Two connected browser tools, built from scratch, running entirely client-side — no server, no install, no account. Open the link, drop in a photo, done. Built for photographers shooting UV, infrared and full-spectrum converted cameras who are tired of hunting through forum threads and Photoshop actions to get a real Aerochrome look.
1. Channel Swap — the editing tool
The core problem it solves: false-colour IR and UV photography needs channel swapping, white balance correction twice (before and after the swap), and fine colour control — and almost every tutorial online skips the step that actually matters.
The swap engine
Full 3×3 channel mixer with negative values, editable live
26 built-in presets across UV and IR — Aerochrome, the 550/590/665/720/850/1000nm ladder, Pink & Teal, IR Chrome, "Blue Trees" (sourced from Hidden Realms, with both documented gel variants), and more
Pre-swap and post-swap white balance pickers — the two-step correction most tutorials miss, with a visible tap marker and forgiving sample area built for imprecise fingers on mobile
Hue rotation, LUT loading (.cube), 16-bit TIFF/PNG/JPEG export with EXIF preservation
Beyond a plain swap
Foliage variation — genuine frequency separation (not sharpening). Splits colour from texture so foliage gets real tonal richness instead of a flat, posterised swap. This is the thing a static LUT categorically cannot do.
Aerochrome finishing panel — saturation, targeted red/blue hue shifts, and Lab a/b colour pushes, recreating the parts of a professional darkroom action that a plain swap can't reach
Sensor baseline — corrects for real, sourced differences in how Canon/Nikon/Sony/Fuji sensors respond to red/near-IR light (Kolari Vision's 82-camera study), so the same filter stack behaves consistently across bodies. Labelled honestly as a directional correction, not a lab-measured coefficient — the white balance picker still measures your actual camera and always wins.
Foliage anchor — tap grass or leaves, pick a target colour, the matrix adjusts automatically to hit it
Live histogram, source-channel viewer, before/after compare slider, RAW embedded-preview support
Sharing your work
Export your exact look as a real, standards-compliant 3D .cube LUT — every filter in the pipeline baked in, verified against the tool's own LUT reader
Copy share link — your entire setup (filters, sliders, matrix, sensor body) encoded into one URL, so you can send someone your exact recipe
Getting in — the link to the filter reference tool now sits right below the header, visible the moment the page loads. No need to pick a photo first just to look something up.
2. Filter Curves — the reference tool
A transmission-curve visualiser and stacking calculator for UV/IR/colour glass — the thing that answers "what does this filter actually do, and what happens if I stack it with that one?"
152 filters, across 13 groups: UV-pass, IR blockers, IR long-pass, the full 29-piece Schott reference glass series, branded (B+W/Hoya/Tiffen), the Wratten step series, Hoya's own contrast-filter naming, colour/faux-colour gels, MidOpt multi-bandpass, special effects, polarizers, and astronomy narrowband. 59 of them now carry an explicit sourcing note citing exactly where the curve came from and how well it fits.
The physics is real, not decorative:
Beer-Lambert thickness scaling — doubling a filter's thickness actually squares its blocking, exactly like real glass
Log-scale chart, now with minor gridlines — reveals leaks below 1% that a linear axis would hide entirely; both axes carry fine tick marks between the major labelled lines, plus proper axis titles
Stack any combination, including multiple copies of the same filter (genuinely multiplies the transmittance, matching what stacking two pieces of identical glass does physically)
Auto-generated stacking guidance — plain-language explanation of what a combination actually delivers, derived from the curve maths itself rather than written per-filter, so it can't drift out of sync with the model
Camera body selector — the same sourced sensor ranking as the editing tool, applied to the combined result only; each filter's own curve never changes with camera choice, because a piece of glass doesn't care what's behind it
Sourcing discipline, upgraded significantly: a run of real manufacturer and measured data got fitted in over several sessions —
Eastman Kodak's own official transmittance tables for the Wratten series (400–1100nm, 10nm resolution)
B+W's, Hoya's, and Schott's own official transmission charts — including the KB-series (KB20's real shape is a deep V-notch bottoming near 600nm, not the gentle slope it was modelled as before) and the 80A/80B/80C conversion series (a real shoulder feature around 580–600nm that a simple curve had been missing entirely)
Independent spectrometer measurements (Kolari IR Chrome, ZWB3, Baader Neodymium)
Manufacturer datasheets for GRB1/GRB3, RM90, RM100, R72
That process caught and fixed real errors along the way rather than just adding numbers — B+W 040/099 were wrongly showing different curves for what's the same glass; a Wratten filter had a ~17nm column-misread that got caught by cross-checking two independent scans of the same table; the Baader Neodymium filter's infrared behaviour was wrong in a way that mattered (it was modelled as staying bright into the NIR when the real filter falls to near-zero). Where two real sources disagree — Kodak's own Wratten 16 vs. Tiffen's compatibly-numbered version measuring 18nm apart — both are shown rather than silently picking one.
What's not claimed as measured: most Lee lighting gels, most colour-conversion filters (KB-series aside), didymium, sepia, and the polarizers have no public per-wavelength data anywhere, and the tool says so rather than presenting a guess as a fact.
Known recipes, one tap away: Candy Chrome, IR Chrome DIY, Candy Pink, Pink Aerochrome, Blue Trees (both documented variants), L-eXtreme, a real ZWB3+QB21-on-an-unconverted-camera demo sourced from an actual UVP forum thread, and a demo showing exactly why full-spectrum conversion exists (a stock camera's internal filter vs. the same shot converted).
Design
A darkroom-safelight and spectrometer-instrument aesthetic, built around what the tool is actually for: revealing light you can't see. Warm safelight red for actions, phosphor teal for data readouts, a literal spectrum gradient as the visual signature. No stock icons, no generic dark-theme-with-accent-colour default — every colour and typographic choice ties back to the subject.
Where the research came from
Eastman Kodak's official Wratten filter handbook, B+W's and Hoya's and Schott's own published transmission charts, Kolari Vision, Rob Shea, Pierre-Louis Ferrer, David Kennard, Hidden Realms, ultravioletphotography.com, Pedro Aphalo's spectrophotometer work, MidOpt's technical datasheets, independent spectrometer measurements shared on Cloudy Nights and truecolorinfrared.com, Fedia — whose posts on the UVP forum and in the Hidden Realms comments are the direct source for three things in this tool: the Bug Vision preset (ZWB3+TSN575), the faux-UV-on-an-unconverted-camera technique, and the real Canon-body test that's the reason "Blue Trees" is labelled camera-dependent rather than universal — and a fair amount of primary-source digging whenever the popular summary of something turned out not to match what the original document actually said.
Both tools are static HTML — everything runs in your browser, nothing is uploaded anywhere.
