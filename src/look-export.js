/* ---------- Look export and the filter-stack record (build 158) ----------

   1. Save look as .cube, baked on the GPU.
      The .cube used to be baked by a JavaScript copy of the colour pipeline (pipelineRGB in colour-mirror.js), which
      had fallen behind the shader: HSL, colour calibration, white point, brightness and vibrance were all missing, so
      a saved look could differ from the screen by 10-30 levels. Now an identity grid (every colour of a 33^3 cube, one
      pixel each) is drawn through the real shader on its own WebGL context, with exactly the parameters an export
      uses, and the result is read back as the table. Whatever the preview does per pixel, the .cube does too, and it
      can never drift again because there is no second copy to keep in step.

      A .cube maps one colour to another and nothing else, so anything that looks at neighbouring pixels cannot be in
      it: noise reduction, sharpening, clarity, dehaze, local tone mapping, masks, chromatic aberration and hotspot
      correction are switched off for the bake (LOOK_SPATIAL_OFF) and the file's header says so.

   2. The filter stack in the file.
      The filters set under "Predict from your filters" are written into every exported JPEG, PNG and TIFF as XMP, the
      metadata format Lightroom, Bridge, Capture One, darktable, exiftool and Windows all read: a plain sentence in the
      description (dc:description, shown as the caption) and the list itself under an irlab namespace, together with
      the look and the build. Single exports and batch both do it; the checkbox in Export turns it off. */

const LOOK_SPATIAL_OFF = {
  noiseReduction: 0, noiseColour: 0, sharpen: 0, clarity: 0, dehaze: 0, orton: 0, caR: 0, caB: 0, hotspot: [0, 0, 0],
  epd: null, eir: null, deband: 0, indexMode: 0, vigAmt: 0, dither: false, clipView: false, gamutDrag: false,
  maskView: -1, bandPreview: null
};
/* Measured (build 158): with every slider pushed to 80% in turn, the GPU-baked table reproduced the render within 1 level
   (mean) for all but dehaze (28) and the HSL magenta and purple bands (about 6, from their edge-aware smoothing). */
const LOOK_SPATIAL_NAMES = 'noise reduction, sharpening, clarity, dehaze, Orton glow, local tone mapping, masks, chromatic aberration and hotspot correction; HSL can differ slightly at colour edges';

function lookNameNow() {
  return ((document.querySelector('.pb.on b') || {}).textContent || 'Custom').trim();
}
function emptyMasks() {
  const adj = new Float32Array(16);
  for (let i = 0; i < 4; i++) { adj[i * 4 + 1] = 1; adj[i * 4 + 2] = 1; }
  return { n: 0, geom: new Float32Array(16), info: new Float32Array(16), adj: adj, adj2: new Float32Array(16) };
}

/* Returns { text, name } like buildCubeLUT, or null if this device cannot render off-screen (the caller falls back). */
function bakeCubeGPU(size) {
  const N = size || 33, total = N * N * N;
  const W = Math.ceil(Math.sqrt(total)), H = Math.ceil(total / W);
  const src = document.createElement('canvas'); src.width = W; src.height = H;
  const sx = src.getContext('2d'), id = sx.createImageData(W, H), d = id.data;
  for (let i = 0; i < total; i++) {
    const r = i % N, g = Math.floor(i / N) % N, b = Math.floor(i / (N * N));
    d[i * 4] = Math.round(r * 255 / (N - 1)); d[i * 4 + 1] = Math.round(g * 255 / (N - 1)); d[i * 4 + 2] = Math.round(b * 255 / (N - 1)); d[i * 4 + 3] = 255;
  }
  for (let i = total; i < W * H; i++) d[i * 4 + 3] = 255;
  sx.putImageData(id, 0, 0);
  let eng = null;
  try {
    eng = new WebGLEngine(document.createElement('canvas'));
    eng.setLUT(currentLUT); eng.setLUTPre(preLUTUser || decodeFilmLUT());
    eng.setImage(src);
    const p = Object.assign(exportParams(), LOOK_SPATIAL_OFF, { masks: emptyMasks() });
    let px = eng.renderHiPrec(p), scale = 65535;
    if (!px) { eng.render(p); px = eng.readPixels(); scale = 255; }
    if (!px) return null;
    const look = lookNameNow(), safe = look.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'Custom';
    const stack = (typeof fpStackNames === 'function') ? fpStackNames() : [];
    const out = [
      '# Made with irlab.uk (build ' + (((document.querySelector('meta[name="irlab-build"]') || {}).content) || '?') + ')',
      '# Look: ' + look,
      stack.length ? '# Filter stack: ' + stack.join(' + ') : '# Filter stack: not recorded',
      '# Input: the photo as irlab receives it (a camera JPEG, or a RAW developed with its camera matrix and white balance).',
      '# Not included (a .cube cannot hold anything that looks at neighbouring pixels): ' + LOOK_SPATIAL_NAMES + '.',
      'TITLE "irlab ' + safe + '"',
      'LUT_3D_SIZE ' + N,
      'DOMAIN_MIN 0.0 0.0 0.0',
      'DOMAIN_MAX 1.0 1.0 1.0'
    ];
    // .cube order: red changes fastest, then green, then blue, which is exactly the order the grid was laid out in
    for (let i = 0; i < total; i++)
      out.push((px[i * 4] / scale).toFixed(6) + ' ' + (px[i * 4 + 1] / scale).toFixed(6) + ' ' + (px[i * 4 + 2] / scale).toFixed(6));
    return { text: out.join('\n') + '\n', name: 'irlab_' + safe + '.cube' };
  } catch (e) {
    console.warn('GPU .cube bake failed, using the CPU copy instead:', e);
    return null;
  } finally {
    if (eng) { const lc = eng.gl.getExtension('WEBGL_lose_context'); if (lc) lc.loseContext(); }
  }
}

/* ---------- XMP: the filter stack in the file ---------- */
function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/* The packet for this export, as UTF-8 bytes, or null when there is nothing to record or the user has turned it off. */
function buildXmpPacket() {
  const box = $('exportStackMeta');
  if (box && !box.checked) return null;
  const stack = (typeof fpStackNames === 'function') ? fpStackNames() : [];
  if (!stack.length) return null;
  const ids = fpStack.slice();
  const build = ((document.querySelector('meta[name="irlab-build"]') || {}).content) || '';
  const look = lookNameNow();
  const desc = 'Filter stack: ' + stack.join(' + ') + '. Look: ' + look + '. Edited in irlab.uk.';
  const li = a => a.map(x => '<rdf:li>' + xmlEsc(x) + '</rdf:li>').join('');
  const xml =
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:irlab="https://irlab.uk/ns/1.0/">' +
    '<dc:description><rdf:Alt><rdf:li xml:lang="x-default">' + xmlEsc(desc) + '</rdf:li></rdf:Alt></dc:description>' +
    '<xmp:CreatorTool>irlab.uk' + (build ? ' build ' + xmlEsc(build) : '') + '</xmp:CreatorTool>' +
    '<irlab:FilterStack><rdf:Seq>' + li(stack) + '</rdf:Seq></irlab:FilterStack>' +
    '<irlab:FilterIDs><rdf:Seq>' + li(ids) + '</rdf:Seq></irlab:FilterIDs>' +
    '<irlab:Look>' + xmlEsc(look) + '</irlab:Look>' +
    '</rdf:Description></rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>';
  return new TextEncoder().encode(xml);
}

/* JPEG: an APP1 segment named by the XMP namespace, placed straight after the start marker. */
function spliceXmpIntoJpegBytes(jpeg, xmp) {
  if (!xmp || jpeg[0] !== 0xFF || jpeg[1] !== 0xD8) return jpeg;
  const head = new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\0');
  const len = 2 + head.length + xmp.length;
  if (len > 65535) return jpeg;
  const seg = new Uint8Array(2 + len);
  seg[0] = 0xFF; seg[1] = 0xE1; seg[2] = len >> 8; seg[3] = len & 0xFF;
  seg.set(head, 4); seg.set(xmp, 4 + head.length);
  const out = new Uint8Array(jpeg.length + seg.length);
  out.set(jpeg.subarray(0, 2), 0); out.set(seg, 2); out.set(jpeg.subarray(2), 2 + seg.length);
  return out;
}

/* PNG: an uncompressed iTXt chunk with the keyword XML:com.adobe.xmp, straight after IHDR. */
function spliceXmpIntoPngBytes(png, xmp) {
  if (!xmp) return png;
  try {
    const ihdrLen = (png[8] << 24) | (png[9] << 16) | (png[10] << 8) | png[11];
    const at = 8 + 4 + 4 + ihdrLen + 4;
    const key = new TextEncoder().encode('XML:com.adobe.xmp');
    const data = new Uint8Array(key.length + 5 + xmp.length);   // keyword \0, compression flag 0, method 0, empty language \0, empty translated keyword \0
    data.set(key, 0); data.set(xmp, key.length + 5);
    const type = new Uint8Array([0x69, 0x54, 0x58, 0x74]);   // iTXt
    const crcIn = new Uint8Array(4 + data.length); crcIn.set(type, 0); crcIn.set(data, 4);
    const chunk = new Uint8Array(12 + data.length);
    chunk.set(u32be(data.length), 0); chunk.set(type, 4); chunk.set(data, 8); chunk.set(u32be(crc32(crcIn)), 8 + data.length);
    const out = new Uint8Array(png.length + chunk.length);
    out.set(png.subarray(0, at), 0); out.set(chunk, at); out.set(png.subarray(at), at + chunk.length);
    return out;
  } catch (e) { return png; }
}

/* The export panel's line: what will be written, or how to set it. */
function stackMetaRefresh() {
  const el = $('stackMetaNames'); if (!el) return;
  const names = (typeof fpStackNames === 'function') ? fpStackNames() : [];
  el.textContent = names.length ? names.join(' + ') : 'none set, add them below';
  el.classList.toggle('noTr', !!names.length);   // filter names stay as they are; the hint is translated
  const box = $('exportStackMeta'); if (box) box.disabled = !names.length;
}
stackMetaRefresh();
