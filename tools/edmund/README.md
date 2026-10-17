# Edmund Optics filter curves

How the 90 Edmund Optics filters in the filter database (`src-filters/edmund.js`) were collected.

Edmund's product pages draw their curves from the same requests these scripts use, run in a browser console on
edmundoptics.co.uk (they are same-origin requests there):

1. `collect.js` (set `window.IRLAB_ED_FAMS` to the product-family ids first): for each family, the product grid
   (`/Catalog/ProductFamily/_ProductGrid`), each product's curve list (`/Catalog/PartNumber/_CurveData`) and each
   transmission curve's data points (`/Catalog/PartNumber/GetChartData`). Sizes of the same coating share a curve id,
   so each curve is fetched once.
2. `collect-pdf.js`: products with no interactive curve usually have a "Curve" PDF (from `_Documents`). These are
   Excel charts saved as PDF, so the plotted line is stored as vector coordinates; the script reads it and calibrates
   it against the chart's own axis labels and gridlines (the residual is checked; a chart that does not calibrate,
   or that is only an image, is skipped).
3. Selection, in the browser: only filters useful for photography are kept. Longpass edges 380-1050nm, shortpass
   / IR-cut / hot mirrors with cut-offs 550-1050nm, bandpass filters 25nm or wider (10nm or wider below 400nm), the
   astronomy filters and the dichroic and cast colour filters. Duplicates (the same coating in another family) are
   dropped. Each curve was resampled to 1nm over 280-1100nm, thinned to within 2 percentage points, and exported
   with a checksum to `data/part*.json`; `data/ranges.json` holds each source chart's own wavelength span.
4. `python3 tools/edmund/convert.py` checks the checksums and writes `src-filters/edmund.js`. The kind of filter and
   its edge or centre are read from the curve itself. Where a chart stops short of 1100nm the curve is held at its
   last value, so a filter whose chart ends with light still passing (an unknown tail) is left out, except the colour filters,
   which are kept for colour work; all of these say
   "data to …nm" in their description.

Edmund marks these curves "for reference only" (typical or design performance).
