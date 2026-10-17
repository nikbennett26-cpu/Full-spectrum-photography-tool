// Shrinks one built bundle with Terser. Called by tools/build.py; not part of the site.
//   node tools/minify.mjs <bundle in> <out .js> <input source map>
// Top-level names are kept (toplevel: false), because index.html, filters.html and i18n/tr.js call the bundles'
// functions by name, and two features build Web Workers from functions' own source text (Function.toString()).
import fs from 'node:fs';
import path from 'node:path';
import { minify } from 'terser';
const [inp, out, mapIn] = process.argv.slice(2);
const code = fs.readFileSync(inp, 'utf8');
const res = await minify(code, {
  ecma: 2020,
  compress: { passes: 1 },
  mangle: true,
  format: { comments: false, preamble: `/* ${path.basename(out)}: built and shrunk from the readable sources by tools/build.py. Edit those, not this. ${path.basename(out)}.map leads back to them. */` },
  sourceMap: { content: fs.readFileSync(mapIn, 'utf8'), url: path.basename(out) + '.map' },
});
fs.writeFileSync(out, res.code + '\n');
fs.writeFileSync(out + '.map', res.map);
