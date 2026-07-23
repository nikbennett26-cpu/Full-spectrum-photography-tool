Channel Swap & Filter Curves
A darkroom for full-spectrum, UV and infrared photography
Built by @king_of_little_germany
Two connected browser tools, built from scratch, running entirely client-side — no server, no install, no account. Open the link, drop in a photo, done. Built for photographers shooting UV, infrared and full-spectrum converted cameras who are tired of hunting through forum threads and Photoshop actions to get a real Aerochrome look.
1. Channel Swap — the editing tool
The core problem it solves: false-colour IR and UV photography needs channel swapping, white balance correction twice (before and after the swap), and fine colour control — and almost every tutorial online skips the step that actually matters.
The swap engine
Full 3×3 channel mixer with negative values, editable live
25+ built-in presets across UV and IR — Aerochrome, 550nm/590nm/665nm/720nm/850nm/1000nm ladders, Pink & Teal, IR Chrome, and a sourced "Blue Trees" recipe from Hidden Realms
Pre-swap and post-swap white balance pickers — the two-step correction most tutorials miss, with a visible tap marker and forgiving sample area built for imprecise fingers on mobile
Hue rotation, LUT loading (.cube), 16-bit TIFF/PNG/JPEG export with EXIF preservation
Beyond a plain swap
Foliage variation — genuine frequency separation (not sharpening). Splits colour from texture so foliage gets real tonal richness instead of a flat, posterised swap. This is the thing a static LUT categorically cannot do, and the reason a Photoshop action's "look" couldn't just be exported.
Aerochrome finishing panel — saturation, targeted red/blue hue shifts, and Lab a/b colour pushes, recreating the parts of a professional darkroom action that a plain swap can't reach
Sensor baseline — corrects for real, sourced differences in how Canon/Nikon/Sony/Fuji sensors respond to red/near-IR light (Kolari Vision's 82-camera study), so the same filter stack behaves consistently across bodies
Foliage anchor — tap grass or leaves, pick a target colour, the matrix adjusts automatically
Live histogram, source-channel viewer, before/after compare slider, RAW embedded-preview support
Sharing your work
Export your exact look as a real, standards-compliant 3D .cube LUT
Copy share link — your entire setup (filters, sliders, matrix) encoded into one URL
2. Filter Curves — the reference tool
A transmission-curve visualiser and stacking calculator for UV/IR/colour glass — the thing that answers "what does this filter actually do, and what happens if I stack it with that one?"
148 filters, organised into nine groups: UV-pass, IR blockers, IR long-pass, the full Schott reference glass series, branded (B+W/Hoya/Tiffen), the Wratten step series, Hoya's own contrast-filter naming, colour/faux-colour gels, MidOpt multi-bandpass, special effects, polarizers, and astronomy narrowband.
The physics is real, not decorative:
Beer-Lambert thickness scaling — doubling a filter's thickness actually squares its blocking, exactly like real glass
Log-scale chart — reveals leaks below 1% that a linear axis would hide entirely
Stack any combination, including multiple copies of the same filter (genuinely multiplies the transmittance, matching what stacking two pieces of identical glass does physically)
Auto-generated stacking guidance — plain-language explanation of what a combination actually delivers, derived from the curve maths itself rather than written per-filter (so it can't drift out of sync with the model)
Camera body selector — same sourced sensor ranking as the editing tool, showing how the combined result (not the glass itself, which never changes) differs by brand
Sourcing discipline: every filter is labelled by how well-anchored its curve is. The Schott series and the Kolari IR Chrome are fitted to real published data (spectrometer measurements, manufacturer spec sheets) and verified to land within a few percentage points. Community-reported combinations (DIY Aerochrome recipes, gel stacks) are flagged as such, with the actual source cited. Nothing is presented as measured that isn't.
Known recipes, one tap away: Candy Chrome, IR Chrome DIY, Candy Pink, Pink Aerochrome, Blue Trees (both documented variants), L-eXtreme, and a demo showing exactly why full-spectrum conversion exists (a stock camera's internal filter vs. the same shot converted).
Design
A darkroom-safelight and spectrometer-instrument aesthetic, built around what the tool is actually for: revealing light you can't see. Warm safelight red for actions, phosphor teal for data readouts, a literal spectrum gradient as the visual signature. No stock icons, no generic dark-theme-with-accent-colour default — every colour and typographic choice ties back to the subject.
Where the research came from
Kolari Vision, Rob Shea, Pierre-Louis Ferrer, David Kennard, Hidden Realms, ultravioletphotography.com, Pedro Aphalo's spectrophotometer work, the Kodak Photographic Filters Handbook, Schott's own glass specifications, MidOpt's technical datasheets, and a fair amount of primary-source digging when the popular summary of something turned out not to match what the original author actually said.
Both tools are static HTML — everything runs in your browser, nothing is uploaded anywhere.
