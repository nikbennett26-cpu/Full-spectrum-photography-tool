# irlab colour-pipeline regression suite

Renders 36 fixed control settings on two fixed test images and compares the result to stored
baselines in OKLab delta E, then runs a handful of property checks (exposure is monotonic,
neutral settings change nothing, Keep saturation never reduces lamp chroma, reset is exact, ...).
Uses software WebGL so the result does not depend on your GPU.

Put this folder next to `index.html` (so `../index.html` exists), then:

    npm install
    npm test                   # compare the current build to golden.json
    npm run update             # accept the current build as the new baseline

Other options: `node run.mjs --file path/to/index.html`, `--only sat180` (run matching cases only).

`golden.json` is "what the build looked like when this was written", not a measured ground truth.
Look at the images once, and only run `update` when a change is one you meant to make.
A failing line shows mean, 99th-percentile and worst-pixel delta E (about 0.02 is a just-noticeable
difference), so you can tell a rounding wobble from a real change.

Add a case by adding a line to `cases.mjs`. Controls are set by element id; ones a build does not
have are skipped, so the same suite runs against older builds.
