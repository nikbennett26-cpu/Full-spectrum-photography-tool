# Thorlabs filter curves

How the 221 Thorlabs filters in the filter database (`src-filters/thorlabs.js`) were collected, so they can be refreshed or extended.

Thorlabs publishes a measured transmission spreadsheet for each filter, opened from the ⓘ icon in each row of a
family page's spec table (for example thorlabs.com/hard-coated-edgepass-filters). There is no bulk download, so:

1. **Collect, in a browser.** Open a family page and run `collect.js` in its console. It opens each row's popup,
   takes the spreadsheet link, downloads and reads the .xlsx in the page, resamples the transmission column to 1nm
   (250-1200nm) and keeps the points needed to stay within 1 percentage point. Progress is saved in the page's
   localStorage under `irlab_<family>`, so a reload carries on where it stopped. Families used: hard-coated edgepass,
   NIR, VIS and UV bandpass.
2. **Export.** Each family's result was thinned again to 280-1100nm (this page's window) within 2 percentage points,
   with values to 0.01, and saved as `data/*.json` as `{family: {part: [description, checksum, [nm, T, ...]]}}`. The
   checksum is the sum of the numbers, computed in the browser, so a damaged copy is caught.
3. **Build.** `python3 tools/thorlabs/convert.py` checks every checksum and writes `src-filters/thorlabs.js`; then
   `python3 tools/build.py`. Ø12.5mm versions (same coating as Ø25mm), parts beyond 1100nm and 1nm laser-line filters
   are left out.

Thorlabs notes the data are typical and vary slightly from lot to lot.
