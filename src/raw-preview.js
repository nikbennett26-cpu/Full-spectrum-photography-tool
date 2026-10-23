'use strict';
/* irlab editor: js/raw-preview.js. One of the editor's scripts, loaded in order by index.html as plain
   (non-module) scripts that share one global scope. Order matters: see the list in index.html. */

/* ---------- embedded preview extraction from camera RAW ----------

   Browsers have no RAW decoder and never will. But every camera RAW file
   carries a camera-rendered JPEG inside it — that's what the back-of-camera
   review screen displays — and on Canon bodies it is full sensor resolution.
   Pulling that out is pure byte parsing, needs no dependencies, and turns
   "CR2 files can't be opened" into "drag the CR2 straight in".

   Be clear about what this is NOT: it is the camera's own rendering, with the
   camera's white balance and picture style already applied, in 8 bits. It is
   not demosaiced sensor data, so it does not give the flat unity-WB input a
   proper raw converter would. It is exactly equivalent to having shot
   RAW+JPEG, which means the camera-side settings (custom WB, Neutral picture
   style, ALO off) still matter just as much.

   Most RAW formats — CR2, NEF, ARW, DNG, ORF, PEF, SRW — are TIFF containers,
   so the IFD chain can be walked directly to find the previews. Formats that
   aren't (CR3 is ISO base media, RAF is Fuji's own) fall through to a byte
   scan, which usually still finds the preview.  */

const TIFF_TAGS = {
  COMPRESSION: 0x0103,
  STRIP_OFFSETS: 0x0111,
  STRIP_BYTE_COUNTS: 0x0117,
  SUB_IFDS: 0x014A,
  JPEG_OFFSET: 0x0201,      // JPEGInterchangeFormat
  JPEG_LENGTH: 0x0202,      // JPEGInterchangeFormatLength
  EXIF_IFD: 0x8769
};

function readVals(dv, entryOff, le) {
  // returns the numeric values of one IFD entry, following the offset when
  // the payload is larger than the 4 inline bytes
  const type = dv.getUint16(entryOff + 2, le);
  const count = dv.getUint32(entryOff + 4, le);
  const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  const unit = sizes[type] || 0;
  if (!unit || count === 0 || count > 65536) return [];
  const total = unit * count;
  const base = total <= 4 ? entryOff + 8 : dv.getUint32(entryOff + 8, le);
  const out = [];
  for (let i = 0; i < count; i++) {
    const p = base + i * unit;
    if (p + unit > dv.byteLength) break;
    if (type === 1 || type === 7) out.push(dv.getUint8(p));
    else if (type === 3) out.push(dv.getUint16(p, le));
    else if (type === 4 || type === 9) out.push(dv.getUint32(p, le));
    else out.push(0);
  }
  return out;
}

function walkTiff(dv, candidates) {
  if (dv.byteLength < 16) return false;
  const b0 = dv.getUint16(0, false);
  let le;
  if (b0 === 0x4949) le = true;
  else if (b0 === 0x4D4D) le = false;
  else return false;
  if (dv.getUint16(2, le) !== 42) return false;   // CR3/RAF are not TIFF

  const seen = new Set();
  const queue = [dv.getUint32(4, le)];
  let guard = 0;

  while (queue.length && guard++ < 64) {
    const ifdOff = queue.shift();
    // A malformed or hostile file could point an IFD at itself; the seen-set
    // and the guard counter make the walk terminate regardless.
    if (!ifdOff || ifdOff < 8 || ifdOff + 2 > dv.byteLength || seen.has(ifdOff)) continue;
    seen.add(ifdOff);

    const n = dv.getUint16(ifdOff, le);
    if (n > 512) continue;                        // not a plausible IFD
    const end = ifdOff + 2 + n * 12;
    if (end + 4 > dv.byteLength) continue;

    let compression = 0, stripOff = null, stripLen = null, jpegOff = null, jpegLen = null;
    for (let i = 0; i < n; i++) {
      const e = ifdOff + 2 + i * 12;
      const tag = dv.getUint16(e, le);
      switch (tag) {
        case TIFF_TAGS.COMPRESSION:       compression = (readVals(dv, e, le)[0]) | 0; break;
        case TIFF_TAGS.STRIP_OFFSETS:     stripOff = readVals(dv, e, le); break;
        case TIFF_TAGS.STRIP_BYTE_COUNTS: stripLen = readVals(dv, e, le); break;
        case TIFF_TAGS.JPEG_OFFSET:       jpegOff = readVals(dv, e, le)[0]; break;
        case TIFF_TAGS.JPEG_LENGTH:       jpegLen = readVals(dv, e, le)[0]; break;
        case TIFF_TAGS.SUB_IFDS:          readVals(dv, e, le).forEach(v => queue.push(v)); break;
        case TIFF_TAGS.EXIF_IFD:          queue.push(readVals(dv, e, le)[0]); break;
      }
    }

    // JPEGInterchangeFormat pair — how DNG and most thumbnails are stored
    if (jpegOff && jpegLen) candidates.push({ parts: [{ off: jpegOff, len: jpegLen }] });

    /* Strips with compression 6 (old JPEG) or 7 (new JPEG) — how CR2 stores
       its full-size preview.

       Critically, the strips are ONE JPEG cut into pieces, not several
       images. Offering a single strip hands the decoder a truncated file,
       and a truncated JPEG does not fail: browsers decode as much as they
       received and leave the remainder black, with naturalWidth still set.
       So it passes a decode check and renders as a black frame. All strips
       from one IFD must be concatenated in order into a single candidate. */
    if ((compression === 6 || compression === 7) && stripOff && stripLen) {
      const parts = [];
      for (let i = 0; i < stripOff.length && i < stripLen.length; i++) {
        if (stripOff[i] > 0 && stripLen[i] > 0) parts.push({ off: stripOff[i], len: stripLen[i] });
      }
      if (parts.length) candidates.push({ parts });
    }

    queue.push(dv.getUint32(end, le));             // next IFD in the chain
  }
  return true;
}

/* Byte scan fallback, for containers that aren't TIFF at all. FF D9 cannot
   occur inside JPEG entropy-coded data — an FF in the data stream is always
   byte-stuffed as FF 00 — so a marker found here is a genuine end-of-image. */
function scanForJpegs(bytes, candidates) {
  const limit = bytes.length - 3;
  for (let i = 0; i < limit; i++) {
    if (bytes[i] !== 0xFF || bytes[i + 1] !== 0xD8 || bytes[i + 2] !== 0xFF) continue;
    for (let j = i + 2; j < bytes.length - 1; j++) {
      if (bytes[j] === 0xFF && bytes[j + 1] === 0xD9) {
        const len = j + 2 - i;
        if (len > 4096) candidates.push({ parts: [{ off: i, len }] });
        i = j;                                     // don't rescan inside it
        break;
      }
    }
  }
}

/* ---------- RAW sensor-plane probe ----------

   Everything the existing extractor does stops at the embedded JPEG preview
   — the camera's own rendering, already demosaiced, already white-balanced.
   This reads past that, into the actual sensor data: which IFD holds it,
   what shape it is, the Bayer colour filter pattern, the black level (the
   sensor's noise floor, which has to be subtracted before anything else is
   valid), and the as-shot white balance.

   It does NOT attempt to decode compressed raw data. Canon's CR2/CR3 and
   most Nikon NEF store the sensor plane behind proprietary or
   semi-proprietary compression (a lossless-JPEG variant, camera-specific
   curves) that this makes no attempt to unpack — that is a real decoder in
   its own right and a separate piece of work. What this DOES do reliably is
   locate the plane and report its metadata regardless of compression, and
   decode the actual pixels only when they are genuinely uncompressed
   (Compression tag == 1), which is the case for many DNGs and for some
   cameras' uncompressed-RAW shooting mode, but not for an out-of-camera CR2.

   Reusing readVals() from the preview extractor for integer tag types, but
   NOT for BlackLevel or AsShotNeutral: both are commonly stored as RATIONAL
   (type 5), and readVals() has no branch for that type — it silently
   returns 0 for every entry. A rational-aware reader is required, or this
   would confidently report a black level of zero on files where the real
   value is a few hundred. */

function readRationals(dv, entryOff, le) {
  const type = dv.getUint16(entryOff + 2, le);
  const count = dv.getUint32(entryOff + 4, le);
  if (count === 0 || count > 4096) return [];
  if (type !== 5 && type !== 10) {
    // not actually a rational — fall through to the plain integer reader
    return readVals(dv, entryOff, le);
  }
  const unit = 8; // two 4-byte integers, signed for type 10
  const total = unit * count;
  const base = total <= 4 ? entryOff + 8 : dv.getUint32(entryOff + 8, le);
  const out = [];
  for (let i = 0; i < count; i++) {
    const p = base + i * unit;
    if (p + unit > dv.byteLength) break;
    const num = type === 10 ? dv.getInt32(p, le) : dv.getUint32(p, le);
    const den = type === 10 ? dv.getInt32(p + 4, le) : dv.getUint32(p + 4, le);
    out.push(den === 0 ? 0 : num / den);
  }
  return out;
}

const RAW_TAGS = {
  WIDTH: 0x0100, HEIGHT: 0x0101, BITS_PER_SAMPLE: 0x0102,
  COMPRESSION: 0x0103, PHOTOMETRIC: 0x0106, SAMPLES_PER_PIXEL: 0x0115,
  STRIP_OFFSETS: 0x0111, STRIP_BYTE_COUNTS: 0x0117,
  SUB_IFDS: 0x014A, EXIF_IFD: 0x8769,
  CFA_REPEAT_DIM: 0x828D, CFA_PATTERN: 0x828E,
  BLACK_LEVEL: 0xC61A, WHITE_LEVEL: 0xC61D, AS_SHOT_NEUTRAL: 0xC628
};

const COMPRESSION_NAMES = {
  1: 'uncompressed', 5: 'LZW', 6: 'old-style JPEG (this is a preview, not sensor data)',
  7: 'JPEG / lossless-JPEG variant (camera-proprietary — not decoded)',
  8: 'Deflate', 32773: 'PackBits', 34713: 'Nikon NEF compressed (proprietary — not decoded)',
  34892: 'lossy JPEG (DNG)', 9999: 'unknown'
};

const CFA_CODE = { 0: 'R', 1: 'G', 2: 'B', 3: 'C', 4: 'M', 5: 'Y', 6: 'W' };

function decodeCfaPattern(dim, codes) {
  if (!dim || dim.length < 2) return null;
  const rows = dim[0], cols = dim[1];
  if (rows !== 2 || cols !== 2 || codes.length < 4) {
    // a non-2x2 pattern exists on a handful of sensors (Fuji X-Trans is 6x6)
    // but demosaicing those needs different maths entirely — report the raw
    // codes rather than pretending it's an ordinary Bayer sensor
    return { rows, cols, codes: codes.map(c => CFA_CODE[c] || '?'), bayer: null };
  }
  const s = codes.slice(0, 4).map(c => CFA_CODE[c] || '?');
  const pattern = s.join('');
  const known = ['RGGB', 'BGGR', 'GRBG', 'GBRG'];
  return { rows: 2, cols: 2, codes: s, bayer: known.includes(pattern) ? pattern : null, raw: pattern };
}

function probeRawPlane(buf) {
  const dv = new DataView(buf);
  if (dv.byteLength < 16) return { found: false, reason: 'file too small to be a TIFF-based RAW' };
  const b0 = dv.getUint16(0, false);
  let le;
  if (b0 === 0x4949) le = true;
  else if (b0 === 0x4D4D) le = false;
  else return { found: false, reason: 'not a TIFF container (CR3 and RAF use a different structure entirely, and need their own parser)' };
  if (dv.getUint16(2, le) !== 42) return { found: false, reason: 'TIFF magic number mismatch' };

  const seen = new Set();
  const queue = [dv.getUint32(4, le)];
  let guard = 0;
  const candidates = [];

  while (queue.length && guard++ < 64) {
    const ifdOff = queue.shift();
    if (!ifdOff || ifdOff < 8 || ifdOff + 2 > dv.byteLength || seen.has(ifdOff)) continue;
    seen.add(ifdOff);
    const n = dv.getUint16(ifdOff, le);
    if (n > 512) continue;
    const end = ifdOff + 2 + n * 12;
    if (end + 4 > dv.byteLength) continue;

    const tags = {};
    for (let i = 0; i < n; i++) {
      const e = ifdOff + 2 + i * 12;
      const tag = dv.getUint16(e, le);
      switch (tag) {
        case RAW_TAGS.WIDTH: tags.width = readVals(dv, e, le)[0]; break;
        case RAW_TAGS.HEIGHT: tags.height = readVals(dv, e, le)[0]; break;
        case RAW_TAGS.BITS_PER_SAMPLE: tags.bits = readVals(dv, e, le)[0]; break;
        case RAW_TAGS.COMPRESSION: tags.compression = readVals(dv, e, le)[0]; break;
        case RAW_TAGS.PHOTOMETRIC: tags.photometric = readVals(dv, e, le)[0]; break;
        case RAW_TAGS.SAMPLES_PER_PIXEL: tags.samplesPerPixel = readVals(dv, e, le)[0]; break;
        case RAW_TAGS.STRIP_OFFSETS: tags.stripOffsets = readVals(dv, e, le); break;
        case RAW_TAGS.STRIP_BYTE_COUNTS: tags.stripByteCounts = readVals(dv, e, le); break;
        case RAW_TAGS.CFA_REPEAT_DIM: tags.cfaDim = readVals(dv, e, le); break;
        case RAW_TAGS.CFA_PATTERN: tags.cfaCodes = readVals(dv, e, le); break;
        case RAW_TAGS.BLACK_LEVEL: tags.blackLevel = readRationals(dv, e, le); break;
        case RAW_TAGS.WHITE_LEVEL: tags.whiteLevel = readVals(dv, e, le)[0]; break;
        case RAW_TAGS.AS_SHOT_NEUTRAL: tags.asShotNeutral = readRationals(dv, e, le); break;
        case RAW_TAGS.SUB_IFDS: readVals(dv, e, le).forEach(v => queue.push(v)); break;
        case RAW_TAGS.EXIF_IFD: queue.push(readVals(dv, e, le)[0]); break;
      }
    }
    tags.ifdOffset = ifdOff;
    candidates.push(tags);
    queue.push(dv.getUint32(end, le));
  }

  /* Identify the sensor IFD. PhotometricInterpretation === 32803 (CFA) is
     the unambiguous signal where present — DNG and standards-following
     files set it explicitly. Where it's absent, fall back to: single
     sample per pixel, a plausible raw bit depth, not JPEG-compressed (that
     would be the preview, already handled elsewhere), and a pixel count
     large enough to rule out a thumbnail IFD. */
  let raw = candidates.find(c => c.photometric === 32803);
  if (!raw) {
    raw = candidates.find(c =>
      c.width && c.height && c.width * c.height > 1000000 &&
      (c.samplesPerPixel === undefined || c.samplesPerPixel === 1) &&
      c.bits >= 8 && c.bits <= 16 &&
      c.compression !== 6 && c.compression !== 7
    );
  }
  if (!raw) return { found: false, reason: 'no sensor-plane IFD located — this file may be a format this parser doesn\u2019t understand, or the preview-only extractor already covers everything it contains' };

  const compName = COMPRESSION_NAMES[raw.compression] || ('unrecognised (tag value ' + raw.compression + ')');
  const supported = raw.compression === 1;

  const cfa = decodeCfaPattern(raw.cfaDim, raw.cfaCodes || []);

  const result = {
    found: true,
    width: raw.width, height: raw.height, bitsPerSample: raw.bits,
    compression: raw.compression, compressionName: compName, supported,
    cfa,
    blackLevel: raw.blackLevel && raw.blackLevel.length ? raw.blackLevel : null,
    whiteLevel: raw.whiteLevel || (raw.bits ? (Math.pow(2, raw.bits) - 1) : null),
    asShotNeutral: raw.asShotNeutral && raw.asShotNeutral.length === 3 ? raw.asShotNeutral : null,
    pixels: null
  };

  if (supported && raw.stripOffsets && raw.stripByteCounts && raw.width && raw.height) {
    const totalSamples = raw.width * raw.height;
    const bytesPerSample = raw.bits > 8 ? 2 : 1;
    const out = raw.bits > 8 ? new Uint16Array(totalSamples) : new Uint8Array(totalSamples);
    let written = 0, ok = true;
    for (let s = 0; s < raw.stripOffsets.length && ok; s++) {
      const off = raw.stripOffsets[s], len = raw.stripByteCounts[s] || 0;
      const count = Math.floor(len / bytesPerSample);
      for (let i = 0; i < count && written < totalSamples; i++) {
        const p = off + i * bytesPerSample;
        if (p + bytesPerSample > dv.byteLength) { ok = false; break; }
        out[written++] = bytesPerSample === 2 ? dv.getUint16(p, le) : dv.getUint8(p);
      }
    }
    if (ok && written === totalSamples) result.pixels = out;
    else result.pixelReadError = 'strip data ran short of the file — declared dimensions don\u2019t match what was actually available';
  }

  return result;
}

/* Turns a probeRawPlane() result into the diagnostic panel's text. Written
   once per load, not per frame -- this has nothing to do with rendering. */
/* Persistent marker for which decoder actually produced what's on screen —
   AMaZE, this tool's own native decoder, or just the camera's embedded
   preview. Set once per load and left up for the rest of the session,
   since which decoder ran doesn't stop being relevant after a toast fades. */
/* Which demosaic the WASM decoder actually ran: lr_demosaic() sends X-Trans (CFA 9) to the Markesteijn
   1-pass port; a Bayer sensor gets AMaZE (darktable's copy of RawTherapee's) or, when 'rcd' is asked for,
   RCD (darktable). Which of the two is a setting (demosaicPref), so both can be compared on one photo. */
function demosaicPref() { try { return localStorage.getItem('irlab.demosaic') === 'rcd' ? 'rcd' : 'amaze'; } catch (e) { return 'amaze'; } }
function demosaicPrefName() { return demosaicPref() === 'rcd' ? 'RCD' : 'AMaZE'; }
/* LibRaw's orientation flag as an EXIF orientation for drawOriented(): 3 = 180, 5 = 90 CCW (EXIF 8), 6 = 90 CW. */
function rawFlipToExif(f) { return f === 3 ? 3 : f === 5 ? 8 : f === 6 ? 6 : 1; }
function rawDemosaicName(res) { return res && res.cfa && res.cfa[0] === 9 ? 'Markesteijn' : (res && res.qual === 'rcd' ? 'RCD' : 'AMaZE'); }
function setDecoderBadge(text, isAmaze) {
  const b = $('decoderBadge');
  if (!b) return;
  if (!text) { b.style.display = 'none'; return; }
  b.textContent = text;
  b.classList.toggle('amaze', !!isAmaze);
  b.style.display = 'block';
}

function renderRawPlaneReport(rp) {
  const panel = $('rawPlanePanel'), out = $('rawPlaneReport');
  if (!panel || !out) return;   // the readout panel was removed from the page; nothing to fill in
  if (!panel || !out) return;
  if (!rp || !rp.found) {
    panel.style.display = 'block';
    out.textContent = 'No sensor-plane data located in this file' +
      (rp && rp.reason ? ' \u2014 ' + rp.reason : '') + '.';
    return;
  }
  const lines = [];
  lines.push('Renderer: ' + (typeof engine !== 'undefined' && engine && engine.isWebGL2
    ? 'WebGL2 \u2014 the exposure/contrast float-precision fix (see Recently Added) is active'
    : 'WebGL1 \u2014 the float-precision fix isn\u2019t available on this browser/device; large exposure pushes may band more visibly on smooth gradients like skies'));
  lines.push(rp.width + '\u00d7' + rp.height + ' \u00b7 ' + rp.bitsPerSample + '-bit \u00b7 compression: ' + rp.compressionName);
  if (rp.cfa) {
    lines.push('CFA pattern: ' + (rp.cfa.bayer || (rp.cfa.codes.join('') + ' (not a standard 2\u00d72 Bayer layout \u2014 needs different demosaic maths)')));
  } else {
    lines.push('CFA pattern: not present in this file\u2019s tags');
  }
  lines.push('Black level: ' + (rp.blackLevel ? rp.blackLevel.join(', ') : 'not found') +
    '  \u00b7  White level: ' + (rp.whiteLevel || 'not found'));
  if (rp.decoded) {
    // A real decode happened, not just a diagnostic probe \u2014 this branch
    // exists because the panel was written before cr2ToCanvas did, when
    // "reporting only, nothing changes" was true for every file that could
    // reach here. It no longer is, for a CR2 specifically, and saying so
    // stale would undersell the thing this panel is supposed to report on.
    if (rp.crop) lines.push('Crop origin (from SensorInfo): left ' + rp.crop.left + ', top ' + rp.crop.top + ', right ' + rp.crop.right + ', bottom ' + rp.crop.bottom);
    lines.push('');
    lines.push('\u2713 This is what\u2019s actually on screen \u2014 the full sensor plane was decoded and demosaiced, not a camera-rendered preview standing in for it.');
  } else {
    lines.push('As-shot neutral: ' + (rp.asShotNeutral ? rp.asShotNeutral.map(v => v.toFixed(3)).join(', ') : 'not found'));
    lines.push('');
    lines.push(rp.supported
      ? '\u2713 Sensor data is uncompressed and WAS read \u2014 ' + (rp.pixels ? rp.pixels.length : 0) + ' raw samples in memory (not used for anything yet).'
      : '\u2717 Sensor data is stored compressed (' + rp.compressionName + ') and was NOT decoded. This is normal for a camera-original CR2/NEF/ARW \u2014 decoding it needs a real demosaic decoder, which this diagnostic deliberately does not attempt.');
  }
  panel.style.display = 'block';
  out.textContent = lines.join('\n');
}

/* EXIF Orientation, tag 0x0112 in IFD0.

   A RAW's embedded preview is a bare JPEG stream with no APP1 segment, so the
   orientation the camera recorded stays behind in the RAW's TIFF header and
   the preview comes out sideways. Browsers rotate ordinary JPEGs
   automatically; nothing rotates this one unless we read the tag ourselves. */
function readTiffOrientation(buf) {
  try {
    const dv = new DataView(buf);
    if (dv.byteLength < 16) return 1;
    const b0 = dv.getUint16(0, false);
    let le;
    if (b0 === 0x4949) le = true; else if (b0 === 0x4D4D) le = false; else return 1;
    if (dv.getUint16(2, le) !== 42) return 1;
    const ifd = dv.getUint32(4, le);
    if (!ifd || ifd + 2 > dv.byteLength) return 1;
    const n = dv.getUint16(ifd, le);
    if (n > 512) return 1;
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > dv.byteLength) break;
      if (dv.getUint16(e, le) === 0x0112) {
        const v = dv.getUint16(e + 8, le);
        return (v >= 1 && v <= 8) ? v : 1;
      }
    }
  } catch (e) {}
  return 1;
}

/* Draw an image applying an EXIF orientation. 5 to 8 involve a 90 degree
   turn, so the canvas dimensions swap; 2, 4, 5 and 7 are mirrored as well as
   rotated, which is why this is a full transform rather than a rotate. */
/* Carries the linear float twin through the SAME geometry the 8-bit canvas
   gets, so the raw headroom survives into the texture.

   This is why Highlight recovery did nothing. rawEngineResultToCanvas
   produced a linear buffer with values above white, but the app then draws
   rawCanvas from that decoded canvas with drawImage() — a different canvas,
   8-bit, headroom gone — and setImage() saw no twin at all. inputIsLinear
   stayed false, the shader linearised ordinary clipped pixels, and the
   recovery slider had nothing above 1.0 to pull back. The pipeline was linear
   right up to the point where it was quietly thrown away.

   Box-filtered for the downscale rather than point-sampled, because dropping
   pixels would discard exactly the small bright ones recovery exists for. */
function resampleLinearFloat(buf, sw, sh, dw, dh) {
  if (!buf || (sw === dw && sh === dh)) return buf;
  const out = new Float32Array(dw * dh * 4);
  const xr = sw / dw, yr = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * yr), y1 = Math.min(sh, Math.max(y0 + 1, Math.floor((y + 1) * yr)));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * xr), x1 = Math.min(sw, Math.max(x0 + 1, Math.floor((x + 1) * xr)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * sw + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) { r += buf[i]; g += buf[i+1]; b += buf[i+2]; n++; }
      }
      const q = (y * dw + x) * 4;
      if (n) { out[q] = r / n; out[q+1] = g / n; out[q+2] = b / n; }
      out[q+3] = 1;
    }
  }
  return out;
}
/* The eight EXIF orientations, applied to the float buffer to match what
   drawOriented() does to the canvas. */
function orientLinearFloat(buf, w, h, o) {
  if (!buf || !o || o === 1) return buf;
  const swap = o >= 5 && o <= 8;
  const dw = swap ? h : w, dh = swap ? w : h;
  const out = new Float32Array(dw * dh * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx, ny;
      switch (o) {
        case 2: nx = w - 1 - x; ny = y; break;
        case 3: nx = w - 1 - x; ny = h - 1 - y; break;
        case 4: nx = x;         ny = h - 1 - y; break;
        case 5: nx = y;         ny = x; break;
        case 6: nx = h - 1 - y; ny = x; break;
        case 7: nx = h - 1 - y; ny = w - 1 - x; break;
        case 8: nx = y;         ny = w - 1 - x; break;
        default: nx = x; ny = y;
      }
      const si = (y * w + x) * 4, di = (ny * dw + nx) * 4;
      out[di] = buf[si]; out[di+1] = buf[si+1]; out[di+2] = buf[si+2]; out[di+3] = 1;
    }
  }
  return out;
}
/* Keeps the twin attached through a drawOriented() call. */
function carryLinearFloat(destCv, srcImg, o) {
  let src = srcImg && srcImg.__linearFloat;
  let sw = srcImg ? srcImg.width : 0, sh = srcImg ? srcImg.height : 0;
  /* Fall back to the parked buffer when the property was lost to an
     intermediate canvas, provided it describes an image of the same size. */
  /* ...but only the buffer made by THIS load. It used to be matched on size alone and never cleared, so opening a
     photo of the same pixel size as an earlier RAW (a camera JPEG from a RAW+JPEG pair, or the next frame) picked up
     the earlier photo's data: Before showed the new photo while After, which renders from this twin, showed the old
     one, in whatever orientation it had been given. A rotate after load is the same load, so it still works. */
  if (!src && LAST_LINEAR_FLOAT && LAST_LINEAR_FLOAT.gen === loadToken && LAST_LINEAR_FLOAT.w === sw && LAST_LINEAR_FLOAT.h === sh) {
    src = LAST_LINEAR_FLOAT.buf;
  }
  if (!src) { delete destCv.__linearFloat; return; }
  const swap = o >= 5 && o <= 8;
  const preW = swap ? destCv.height : destCv.width;
  const preH = swap ? destCv.width : destCv.height;
  const scaled = resampleLinearFloat(src, sw, sh, preW, preH);
  destCv.__linearFloat = orientLinearFloat(scaled, preW, preH, o);
}

function drawOriented(cv, img, w, h, o) {
  if (typeof dustUnheal === 'function') dustUnheal(cv, false);   // build 185: never redraw from (or carry) healed pixels
  const swap = o >= 5 && o <= 8;
  cv.width = swap ? h : w;
  cv.height = swap ? w : h;
  const c = cv.getContext('2d', { willReadFrequently: true });
  c.setTransform(1, 0, 0, 1, 0, 0);
  switch (o) {
    case 2: c.translate(w, 0); c.scale(-1, 1); break;
    case 3: c.translate(w, h); c.rotate(Math.PI); break;
    case 4: c.translate(0, h); c.scale(1, -1); break;
    case 5: c.rotate(0.5 * Math.PI); c.scale(1, -1); break;
    case 6: c.rotate(0.5 * Math.PI); c.translate(0, -h); break;
    case 7: c.rotate(0.5 * Math.PI); c.translate(w, -h); c.scale(-1, 1); break;
    case 8: c.rotate(-0.5 * Math.PI); c.translate(-w, 0); break;
  }
  c.drawImage(img, 0, 0, w, h);
  c.setTransform(1, 0, 0, 1, 0, 0);
}

// combine an EXIF orientation with quarter-turns the user has asked for
const ROT_CW = { 1:6, 6:3, 3:8, 8:1, 2:7, 7:4, 4:5, 5:2 };
function rotateOrient(o, times) {
  let v = o || 1;
  for (let i = 0; i < ((times % 4) + 4) % 4; i++) v = ROT_CW[v] || 1;
  return v;
}

/* ---------- camera-colour match ----------

   Fits the raw sensor decode to the camera's own JPEG of the same frame,
   both of which are sitting inside the CR2. Neither alone is what you want:
   the raw is clean but flat, the JPEG is finished but written at roughly one
   bit per pixel with quarter-resolution colour. Fitting one to the other
   takes the colour rendering off the JPEG and leaves its compression behind.

   See u_camCoef in the shader for why this is a cubic rather than a matrix. */
let camCoef = null;                 // Float32Array(60) = 20 vec3s, or null

// term order must match the shader's expansion exactly
function camFeats(r, g, b) {
  return [1, r, g, b, r*g, r*b, g*b, r*r, g*g, b*b,
          r*r*r, g*g*g, b*b*b, r*g*b, r*r*g, r*r*b, g*g*r, g*g*b, b*b*r, b*b*g];
}

/* Ridge-regularised normal equations, solved by Gauss-Jordan. Ridge is not
   optional here: a cubic will happily extrapolate to absurd values in colour
   regions the sample never covered, and on a spatially-biased sample that
   produced a worst-case error of 203/255 unregularised against 105 with it.
   The cost on the fit itself is negligible (RMSE 5.42 to 5.51). */
function solveRidge(A, B, lambda) {
  const n = A.length, m = B[0].length;
  const M = A.map((row, i) => row.slice().concat(B[i]));
  for (let i = 0; i < n; i++) M[i][i] += lambda;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let c = col; c < n + m; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (!f) continue;
      for (let c = col; c < n + m; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map(row => row.slice(n));
}

/* rawCv: the sensor decode. jpgBlob: the embedded preview of the SAME frame.
   Both are sampled on a common small grid — a few thousand well-spread pairs
   fit this as well as millions would, and keeps it fast enough to run on
   every load without anyone noticing. */
async function fitCameraColour(rawCv, jpgBlob) {
  const N = 220;                              // ~48k sample points
  const a = document.createElement('canvas'); a.width = N; a.height = N;
  a.getContext('2d').drawImage(rawCv, 0, 0, N, N);
  const bmp = await createImageBitmap(jpgBlob);
  const b = document.createElement('canvas'); b.width = N; b.height = N;
  b.getContext('2d').drawImage(bmp, 0, 0, N, N);

  const da = a.getContext('2d').getImageData(0, 0, N, N).data;
  const db = b.getContext('2d').getImageData(0, 0, N, N).data;

  const T = 20;
  const AtA = Array.from({length: T}, () => new Float64Array(T));
  const AtB = Array.from({length: T}, () => new Float64Array(3));
  let used = 0;
  for (let i = 0; i < da.length; i += 4) {
    const r = da[i]/255, g = da[i+1]/255, bl = da[i+2]/255;
    // skip pixels clipped in either source: they carry no usable
    // correspondence, only a hard stop that would bend the fit toward it
    const jr = db[i]/255, jg = db[i+1]/255, jb = db[i+2]/255;
    if (r <= 0.002 || g <= 0.002 || bl <= 0.002 || r >= 0.998 || g >= 0.998 || bl >= 0.998) continue;
    if (jr >= 0.998 && jg >= 0.998 && jb >= 0.998) continue;
    const f = camFeats(r, g, bl);
    for (let p = 0; p < T; p++) {
      const fp = f[p];
      if (!fp) continue;
      const rowA = AtA[p];
      for (let q = p; q < T; q++) rowA[q] += fp * f[q];
      const rowB = AtB[p];
      rowB[0] += fp * jr; rowB[1] += fp * jg; rowB[2] += fp * jb;
    }
    used++;
  }
  if (used < 500) return null;                // too little overlap to trust
  for (let p = 0; p < T; p++) for (let q = 0; q < p; q++) AtA[p][q] = AtA[q][p];

  const scale = 1 / used;
  const An = AtA.map(row => Array.from(row, v => v * scale));
  const Bn = AtB.map(row => Array.from(row, v => v * scale));
  const sol = solveRidge(An, Bn, 1e-3);
  if (!sol) return null;

  const out = new Float32Array(60);
  for (let p = 0; p < T; p++) { out[p*3] = sol[p][0]; out[p*3+1] = sol[p][1]; out[p*3+2] = sol[p][2]; }
  // residual on the same samples, reported rather than assumed good
  let sumSq = 0, n2 = 0;
  for (let i = 0; i < da.length; i += 4 * 7) {
    const r = da[i]/255, g = da[i+1]/255, bl = da[i+2]/255;
    if (r <= 0.002 || r >= 0.998) continue;
    const f = camFeats(r, g, bl);
    for (let c = 0; c < 3; c++) {
      let v = 0;
      for (let p = 0; p < T; p++) v += f[p] * sol[p][c];
      const e = Math.max(0, Math.min(1, v)) * 255 - db[i+c];
      sumSq += e*e; n2++;
    }
  }
  return { coef: out, rmse: Math.sqrt(sumSq / Math.max(1, n2)), samples: used };
}

/* ---------- chroma reconstruction for subsampled JPEG sources ----------

   A camera's embedded preview is written 4:2:0: full-resolution brightness,
   but colour stored at half in each direction, so every 2x2 block of pixels
   shares one Cb/Cr pair. On an ordinary photo that is invisible. Here it is
   not: this tool does almost nothing but move colour around, and a channel
   swap followed by a saturation push takes those shared blocks and turns
   them into visible streaks and posterised patches — the artefact that made
   embedded previews unusable for anything heavier than a quick look.

   The browser has already expanded the chroma back to full size by the time
   we see a canvas, but it does that by replication, which is what leaves the
   hard block edges. This re-does that expansion properly: each pixel's
   chroma becomes a weighted average of its neighbours, weighted by how
   similar their LUMINANCE is. Luminance survived at full resolution, so it
   knows where the real edges are. Inside a smooth region the weights are
   even and the block edges dissolve; across a real edge the weights collapse
   to one side and the colour boundary stays put.

   This cannot invent colour detail that the camera genuinely threw away.
   What it does is stop what remains from having false 2x2 structure that the
   rest of the pipeline would otherwise amplify. */
function reconstructChroma(cv, onProgress) {
  const w = cv.width, h = cv.height;
  const ctx = cv.getContext('2d');
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  // Y/Cb/Cr as separate planes: the loop below reads each pixel's neighbours
  // many times, and doing the RGB->YCbCr conversion once up front rather
  // than per-visit is most of the difference between usable and not.
  const n = w * h;
  /* Y as bytes and the chroma planes as Int16, not Float32. At full size
     (5184x3456 = 18M pixels) five Float32 planes is roughly 360 MB of
     temporaries, which a desktop absorbs and a phone does not — it is an
     out-of-memory before anything renders, and the tab either dies or the
     load simply never completes. Y fits a byte, and Cb/Cr are colour
     DIFFERENCES in -255..255 so they fit an Int16 exactly; the results are
     written straight back into the ImageData rather than into two more
     full-size planes. Same arithmetic, ~90 MB instead of ~360 MB. */
  const Y = new Uint8ClampedArray(n), Cb = new Int16Array(n), Cr = new Int16Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = d[p], g = d[p+1], b = d[p+2];
    const y = 0.299*r + 0.587*g + 0.114*b;
    Y[i] = y; Cb[i] = b - y; Cr[i] = r - y;
  }


  /* Luminance tolerance, in 0..255 units. Too tight and nothing is averaged
     (the block edges survive); too loose and colour bleeds across real
     edges. 24 keeps within-texture variation together while still breaking
     at foliage-against-sky, which is exactly the boundary that showed the
     worst streaking. */
  const SIGMA = 24, INV2S2 = 1 / (2 * SIGMA * SIGMA);
  /* The weight depends only on the luminance DIFFERENCE, which between two
     bytes is always an integer in -255..255 — so there are 511 possible
     weights, not 450 million. Precomputing them turns the inner loop's
     exp() into an array read: at full size that call happened 25 times per
     pixel across 18M pixels, and it was most of the time this function took.
     Same numbers, just not recomputed for every pixel that shares a
     difference with another. */
  const WLUT = new Float32Array(511);
  for (let dv = -255; dv <= 255; dv++) WLUT[dv + 255] = Math.exp(-dv * dv * INV2S2);
  // 5x5 reach: a 2x2 chroma block needs neighbours from beyond the block to
  // have anything to blend toward, so a 3x3 window centred inside a block
  // can still see only its own constant value.
  const R = 2;

  for (let y = 0; y < h; y++) {
    if (onProgress && (y & 511) === 0) onProgress(y / h);
    for (let x = 0; x < w; x++) {
      const i = y*w + x;
      const y0 = Y[i];
      let sw = 0, sb = 0, sr = 0;
      const yLo = Math.max(0, y-R), yHi = Math.min(h-1, y+R);
      const xLo = Math.max(0, x-R), xHi = Math.min(w-1, x+R);
      for (let yy = yLo; yy <= yHi; yy++) {
        const row = yy*w;
        for (let xx = xLo; xx <= xHi; xx++) {
          const j = row + xx;
          const wgt = WLUT[(Y[j] - y0 + 255) | 0];
          sw += wgt; sb += wgt * Cb[j]; sr += wgt * Cr[j];
        }
      }
      /* Written straight back into the ImageData. Safe because the loop only
         ever READS the Y/Cb/Cr planes, which are untouched by this — the two
         extra full-size output planes this replaces were the single largest
         allocation in the function. */
      const yv = Y[i], p = i * 4;
      const nb = sb / sw + yv, nr = sr / sw + yv;
      const ng = (yv - 0.299*nr - 0.114*nb) / 0.587;
      d[p]   = nr < 0 ? 0 : nr > 255 ? 255 : nr;
      d[p+1] = ng < 0 ? 0 : ng > 255 ? 255 : ng;
      d[p+2] = nb < 0 ? 0 : nb > 255 ? 255 : nb;
    }
  }

  ctx.putImageData(img, 0, 0);
  return cv;
}

/* Reads the sampling factors straight out of the JPEG's SOF header rather
   than assuming: 4:2:0 is usual for a camera preview but not universal, and
   running the reconstruction on a 4:4:4 file would be pure cost for no
   benefit. Returns true only when a chroma component is genuinely coarser
   than the luma one. */
function jpegIsChromaSubsampled(bytes) {
  let p = 2;                                     // skip SOI
  while (p < bytes.length - 1) {
    if (bytes[p] !== 0xFF) { p++; continue; }
    const m = bytes[p+1];
    if (m === 0xD8 || (m >= 0xD0 && m <= 0xD7) || m === 0x01) { p += 2; continue; }
    if (m === 0xDA || m === 0xD9) return false;  // hit the scan without an SOF we understand
    const len = (bytes[p+2] << 8) | bytes[p+3];
    // any baseline/progressive/extended SOF, but not SOF4/8/12 (non-frame markers)
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
      const nc = bytes[p+9];
      if (nc < 3) return false;                  // greyscale: nothing to reconstruct
      let maxH = 0, maxV = 0, minH = 99, minV = 99;
      for (let c = 0; c < nc; c++) {
        const sf = bytes[p+11 + c*3];
        const hf = sf >> 4, vf = sf & 15;
        if (hf > maxH) maxH = hf; if (vf > maxV) maxV = vf;
        if (hf < minH) minH = hf; if (vf < minV) minV = vf;
      }
      return maxH > minH || maxV > minV;
    }
    p += 2 + len;
  }
  return false;
}

function collectCandidates(buf) {
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const candidates = [];
  walkTiff(dv, candidates);
  if (!candidates.length) scanForJpegs(bytes, candidates);

  // every part must fit in the file, and the FIRST must begin with a JPEG SOI
  const valid = [];
  for (const c of candidates) {
    const p0 = c.parts[0];
    // offset 0 is allowed: a file that is simply a JPEG start-to-finish is a
    // valid candidate. Rejecting it meant a JPEG carrying a RAW extension —
    // exactly what a restored session used to hand back — could never be read.
    if (!p0 || p0.off < 0 || bytes[p0.off] !== 0xFF || bytes[p0.off + 1] !== 0xD8) continue;
    let total = 0, ok = true;
    for (const p of c.parts) {
      if (p.off < 0 || p.len < 1 || p.off + p.len > bytes.length) { ok = false; break; }
      total += p.len;
    }
    if (ok && total > 1024) valid.push({ parts: c.parts, len: total });
  }

  // de-duplicate, then biggest first: the full-size preview before the
  // 160x120 thumbnail that sits alongside it
  const seen = new Set();
  return valid.filter(c => {
    const k = c.parts.map(p => p.off + ':' + p.len).join(',');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => b.len - a.len);
}

/* ORI is Olympus's in-camera-processed variant and uses the same container
   as ORF, so the existing TIFF walk reaches its preview unchanged.

   X3F (Sigma Foveon) is the odd one: not TIFF-based, so walkTiff finds
   nothing and it falls through to scanForJpegs, which hunts JPEG markers
   directly. That should locate the embedded preview, but it is untested
   against a real file — no X3F to hand. If it fails, extractPreview returns
   null and the existing dialog explains the format stores its preview
   somewhere this cannot reach, which is the honest outcome rather than a
   broken one. */
/* ---------- CR2 sensor decode ----------
   Canon stores the mosaic as ITU T.81 LOSSLESS JPEG (SOF3) — Huffman plus a
   left/above predictor, no DCT — sliced into vertical strips and wrapped in
   a TIFF container. Verified against a real 6D file rather than written from
   the spec and hoped for.

   This exists so the swap can happen on actual sensor data. Every other
   route hands over something a converter has already demosaiced and tone
   curved; on a full-spectrum body those decisions were made for a camera
   that no longer exists spectrally. */
function cr2FindRaw(dv, u8) {
  const le = u8[0] === 0x49;
  const g16 = o => dv.getUint16(o, le), g32 = o => dv.getUint32(o, le);
  if (dv.getUint16(2, le) !== 42) throw new Error('not a TIFF container');
  const TSZ = {1:1,2:1,3:2,4:4,5:8,7:1,9:4,10:8,11:4,12:8};
  const readIFD = off => {
    const n = g16(off), t = {};
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i*12, tag = g16(e), typ = g16(e+2), cnt = g32(e+4);
      const sz = (TSZ[typ]||1)*cnt, vo = sz <= 4 ? e+8 : g32(e+8);
      t[tag] = { typ, cnt, vo };
    }
    return { tags: t, next: g32(off + 2 + n*12) };
  };
  const val = (t, k) => {
    const e = t[k]; if (!e) return null;
    const rd = i => e.typ === 3 ? g16(e.vo+i*2) : e.typ === 4 ? g32(e.vo+i*4) : u8[e.vo+i];
    return e.cnt === 1 ? rd(0) : Array.from({length: e.cnt}, (_, i) => rd(i));
  };

  // the sensor IFD is the one with compression 6 and by far the largest strip
  let off = g32(4), best = null, first = null;
  for (let i = 0; off && i < 8; i++) {
    const { tags, next } = readIFD(off);
    if (i === 0) first = tags;
    const comp = val(tags,0x103), so = val(tags,0x111), sb = val(tags,0x117);
    if (comp === 6 && so && sb && (!best || sb > best.bytes))
      best = { offset: so, bytes: sb, slice: val(tags,0xc640) };
    off = next;
  }
  if (!best) throw new Error('no compressed sensor image found');

  /* Crop origin comes from Canon's SensorInfo, not a guess. The decoded grid
     includes optical-black borders, and using the wrong origin puts a black
     bar down one edge of every frame. */
  let crop = null, blackLevel = 2047;
  const exifRef = first && first[0x8769];
  if (exifRef) {
    const ex = readIFD(exifRef.vo).tags;
    const mn = ex[0x927C];
    if (mn) {
      const m = readIFD(mn.vo).tags;
      const si = m[0x00e0];
      if (si) {
        const s = i => g16(si.vo + i*2);
        crop = { left: s(5), top: s(6), right: s(7), bottom: s(8) };
      }
      const bl = m[0x4001];   // ColorData — black level lives inside, model-dependent
      if (bl && bl.cnt > 200) blackLevel = g16(bl.vo + 0x1e*2) || 2047;
    }
  }
  /* CFA layout from the file's own tags where present. probeRawPlane already
     parses this for the diagnostics panel, so reuse it rather than writing a
     second parser that could disagree with the first. */
  let cfa = null;
  try {
    const rp = probeRawPlane(dv.buffer);
    if (rp && rp.found && rp.cfa && rp.cfa.bayer) cfa = rp.cfa;
  } catch (e) { /* fall back to the default layout below */ }
  return { ...best, crop, blackLevel, le, cfa };
}

function cr2DecodeLossless(u8, start) {
  let p = start;
  if (!(u8[p] === 0xFF && u8[p+1] === 0xD8)) throw new Error('sensor data is not a JPEG stream');
  p += 2;
  const be16 = o => (u8[o] << 8) | u8[o+1];
  const huff = {};
  let prec = 0, W = 0, H = 0, NC = 0, comps = null;
  for (;;) {
    if (u8[p] !== 0xFF) throw new Error('lost sync in JPEG headers');
    const m = u8[p+1], len = be16(p+2);
    if (m === 0xC4) {                       // Huffman tables
      let q = p+4; const end = p+2+len;
      while (q < end) {
        const th = u8[q] & 15;
        const counts = []; let total = 0;
        for (let i = 0; i < 16; i++) { counts.push(u8[q+1+i]); total += u8[q+1+i]; }
        q += 17;
        const syms = u8.subarray(q, q+total); q += total;
        /* Flat 16-bit lookup: index by the next 16 bits and read the symbol
           and length in one step. Decoding bit-by-bit down a tree is what
           made the reference implementation take 40 seconds. */
        const lut = new Uint8Array(1 << 16), lenLut = new Uint8Array(1 << 16);
        let code = 0, k = 0;
        for (let L = 1; L <= 16; L++) {
          for (let n = 0; n < counts[L-1]; n++, k++) {
            const shift = 16 - L, base = code << shift;
            for (let f = 0; f < (1 << shift); f++) { lut[base+f] = syms[k]; lenLut[base+f] = L; }
            code++;
          }
          code <<= 1;
        }
        huff[th] = { lut, lenLut };
      }
    } else if (m === 0xC3) {
      prec = u8[p+4]; H = be16(p+5); W = be16(p+7); NC = u8[p+9];
      comps = [];
      for (let c = 0; c < NC; c++) comps.push(u8[p+12+c*3] & 15);
    } else if (m === 0xDA) {
      const ns = u8[p+4];
      comps = [];
      for (let i = 0; i < ns; i++) comps.push(u8[p+6+i*2] & 15);
      p = p + 2 + len;
      break;
    } else if (m === 0xD8 || (m >= 0xD0 && m <= 0xD7)) { p += 2; continue; }
    p += 2 + len;
  }

  const out = new Uint16Array(W * H * NC);
  const pred0 = 1 << (prec - 1);
  let bp = p;
  let acc = 0, nbits = 0;
  const need = n => { while (nbits < n) { let b = u8[bp++]; if (b === undefined) b = 0;
      else if (b === 0xFF && u8[bp] === 0x00) bp++;
      acc = ((acc << 8) | b) >>> 0; nbits += 8; } };
  const peek16 = () => { need(16); return (acc >>> (nbits - 16)) & 0xFFFF; };
  const skip = n => { nbits -= n; acc &= (nbits >= 32 ? 0xFFFFFFFF : ((1 << nbits) - 1)) >>> 0; };

  const prevRow = new Int32Array(NC);
  const row = new Int32Array(W * NC);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let c = 0; c < NC; c++) {
        const tbl = huff[comps[c]] || huff[0];
        const bits = peek16();
        const L = tbl.lenLut[bits];
        if (!L) throw new Error('bad Huffman code at row ' + y);
        const s = tbl.lut[bits];
        skip(L);
        let diff = 0;
        if (s) {
          need(s);
          diff = (acc >>> (nbits - s)) & ((1 << s) - 1);
          skip(s);
          if (diff < (1 << (s-1))) diff -= (1 << s) - 1;
        }
        const base = x === 0 ? (y === 0 ? pred0 : prevRow[c]) : row[(x-1)*NC + c];
        row[x*NC + c] = base + diff;
      }
    }
    for (let c = 0; c < NC; c++) prevRow[c] = row[c];
    out.set(row.subarray(0, W*NC), y*W*NC);
  }
  return { data: out, W, H, NC, prec };
}

/* UNUSED as of the AMaZE-only decode change \u2014 this tool's own from-scratch
   bilinear CR2 decoder is no longer called from loadFile() or the batch
   path, both of which now use AMaZE (via LibRaw + RawTherapee) unconditionally
   for real sensor decode. Left defined rather than deleted: costs nothing
   sitting idle, and staying reachable makes reverting this decision a
   one-line change instead of a restoration job. Safe to fully remove later
   if the answer to "would we ever go back" turns out to be no. */
async function cr2ToCanvas(buf, onProgress) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  const info = cr2FindRaw(dv, u8);
  const dec = cr2DecodeLossless(u8, info.offset);
  const { data, W, H, NC, prec } = dec;

  // unslice: tag 0xc640 = [fullSliceCount, sliceWidth, lastSliceWidth]
  let sw, lw, nFull;
  if (info.slice && info.slice.length === 3) { nFull = info.slice[0]; sw = info.slice[1]; lw = info.slice[2]; }
  else { nFull = 0; sw = W*NC; lw = 0; }
  const RW = nFull * sw + lw, RH = H;
  if (RW * RH !== W * H * NC) throw new Error('slice geometry does not match sample count');
  const grid = new Uint16Array(RW * RH);
  let pos = 0;
  for (let s = 0; s <= nFull; s++) {
    const width = (s === nFull) ? lw : sw;
    if (!width) continue;
    for (let x = 0; x < width; x++)
      for (let y = 0; y < RH; y++)
        grid[y*RW + s*sw + x] = data[pos + y*width + x];
    pos += width * RH;
  }

  const c = info.crop || { left: 0, top: 0, right: RW-1, bottom: RH-1 };
  const vw = c.right - c.left + 1, vh = c.bottom - c.top + 1;

  /* Bayer layout, taken from the file rather than assumed. The four letters
     are the colours at (0,0) (1,0) (0,1) (1,1) of the repeating 2x2 tile.
     Falls back to GBRG, which is what a 6D measures as and what this decoder
     was originally written against — so a file whose tag is missing behaves
     exactly as before rather than differently.

     The crop origin has to be folded in as well: an odd left or top shifts
     which colour lands on an even pixel, and getting that wrong swaps red and
     blue across the whole frame while looking perfectly plausible. */
  let pat = (info.cfa && info.cfa.bayer) || 'GBRG';
  if ((c.left & 1) === 1) pat = pat[1] + pat[0] + pat[3] + pat[2];   // odd x: swap columns
  if ((c.top  & 1) === 1) pat = pat[2] + pat[3] + pat[0] + pat[1];   // odd y: swap rows
  const CFA_SITES = [pat[0], pat[1], pat[2], pat[3]];
  // for each row of the tile, does the red sit in that row? decides whether a
  // green pixel's horizontal neighbours are red or blue
  const G_ROW_IS_R = [
    CFA_SITES[0] === 'R' || CFA_SITES[1] === 'R',
    CFA_SITES[2] === 'R' || CFA_SITES[3] === 'R',
  ];
  const black = info.blackLevel, white = (1 << prec) - 1;
  const scale = 1 / Math.max(white - black, 1);

  /* sRGB-ENCODED into the canvas, not linear. The pipeline does
     srgbToLinear on the texture, so writing linear values here would be
     decoded a second time and crush the shadows. Encoding on the way in
     means the round trip is correct.

     No white balance and no colour matrix applied: this is the sensor's own
     response, which is the entire point — on a converted body the camera's
     matrix characterises optics that are no longer there. Expect a strong
     cast, and set white balance with the picker. */
  const cv = document.createElement('canvas');
  cv.width = vw; cv.height = vh;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(vw, vh);
  const d8 = img.data;
  const enc = v => v <= 0.0031308 ? v*12.92 : 1.055*Math.pow(v, 1/2.4) - 0.055;
  const LUTN = 4096, encLut = new Float32Array(LUTN+1);
  for (let i = 0; i <= LUTN; i++) encLut[i] = enc(i/LUTN);
  const at = (x, y) => {
    const gx = c.left + x, gy = c.top + y;
    if (gx < 0 || gy < 0 || gx >= RW || gy >= RH) return 0;
    const v = (grid[gy*RW + gx] - black) * scale;
    return v <= 0 ? 0 : v >= 1 ? 1 : v;
  };
  // GBRG demosaic — verified against a real 6D file: the matching (green)
  // sites are (0,0) and (1,1), diagonal rather than the RGGB norm.
  /* Yields to the event loop every 256 rows. Without this the whole decode
     is one synchronous block: on a full-size file that is several seconds
     during which the page cannot repaint at all, so a progress message set
     beforehand never actually appears and the tool looks hung on exactly
     the operation that takes longest. Yielding costs a few ms in total and
     buys a UI that visibly moves. */
  for (let y = 0; y < vh; y++) {
    if (onProgress && (y & 255) === 0) {
      onProgress(y / vh);
      await new Promise(r => setTimeout(r, 0));
    }
    for (let x = 0; x < vw; x++) {
      const ex = x & 1, ey = y & 1;
      let r, g, b;
      const P = (dx, dy) => at(x+dx, y+dy);
      /* Which colour sits at this position comes from the file's own CFA
         tag, not from an assumption. GBRG was measured on a 6D and hardcoded,
         which is correct for that body and wrong for any sensor laid out
         differently — and a wrong layout does not fail loudly, it silently
         swaps colours, so the only symptom is a picture that looks wrong in
         a way no slider fixes. `site` is 'R', 'G' or 'B' for this pixel. */
      const site = CFA_SITES[(ey * 2 + ex)];
      if (site === 'G') {
        g = P(0,0);
        // the two non-green neighbours of a green site are always one
        // horizontal pair and one vertical pair; which is which depends on
        // whether red leads the row this green sits in
        if (G_ROW_IS_R[ey]) { r = (P(1,0)+P(-1,0))/2; b = (P(0,1)+P(0,-1))/2; }
        else                { b = (P(1,0)+P(-1,0))/2; r = (P(0,1)+P(0,-1))/2; }
      } else if (site === 'B') {
        b = P(0,0);
        g = (P(-1,0)+P(1,0)+P(0,-1)+P(0,1))/4;
        r = (P(-1,-1)+P(1,-1)+P(-1,1)+P(1,1))/4;
      } else {                                          // R
        r = P(0,0);
        g = (P(-1,0)+P(1,0)+P(0,-1)+P(0,1))/4;
        b = (P(-1,-1)+P(1,-1)+P(-1,1)+P(1,1))/4;
      }
      /* Crosstalk correction. No camera colour matrix is applied on
         purpose (see above), but that means the sensor's own filter
         crosstalk — each site still catching a fair bit of the other two
         colours' light — is left in untouched, and it shows up as
         pixels that read visibly less separated than the camera's own
         JPEG even at identical exposure: measured on a real file, ~38-40%
         saturation off the raw decoder against ~46-70% from the embedded
         preview, before either has been swapped or white-balanced. Pushing
         the Saturation slider afterward can't fix this — it scales chroma
         that was never captured, not manufacture the separation a CCM
         would have recovered.
         This is a fixed-row-sum 3x3 (rows sum to 1), so a neutral grey
         stays neutral; it just pulls each channel away from the average
         of the other two, which is the visible effect of a CCM without
         needing the camera's actual (and here, meaningless — the optics
         it characterises no longer exist) matrix coefficients. k tuned
         against a real file: high enough to close most of the gap,
         conservative enough to avoid visible fringing on flat surfaces. */
      const K = 0.10;
      const nr = r*(1+2*K) - K*g - K*b;
      const ng = g*(1+2*K) - K*r - K*b;
      const nb = b*(1+2*K) - K*r - K*g;
      r = nr < 0 ? 0 : nr > 1 ? 1 : nr;
      g = ng < 0 ? 0 : ng > 1 ? 1 : ng;
      b = nb < 0 ? 0 : nb > 1 ? 1 : nb;
      const q = (y*vw + x)*4;
      d8[q]   = encLut[(r*LUTN)|0]*255;
      d8[q+1] = encLut[(g*LUTN)|0]*255;
      d8[q+2] = encLut[(b*LUTN)|0]*255;
      d8[q+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  /* Attached rather than returned separately, so this doesn't change the
     signature every existing caller relies on (just a canvas). Consumed by
     the "Raw sensor data" panel so it reports what actually happened on a
     successful decode, instead of sitting on its old diagnostic-only
     copy \u2014 written before this decoder existed, when nothing here really
     could change what you saw. */
  cv.__rawReport = {
    found: true, decoded: true,
    width: RW, height: RH, bitsPerSample: prec,
    compressionName: 'lossless JPEG (SOF3)',
    cfa: { bayer: (info.cfa && info.cfa.bayer) ? (info.cfa.bayer + ' (from the file\u2019s CFA tag)') : 'GBRG (assumed \u2014 no CFA tag in this file)' },
    blackLevel: [info.blackLevel], whiteLevel: (1 << prec) - 1,
    crop: info.crop,
  };
  return cv;
}

const CR2_EXT = ['CR2'];
const RAW_EXT = ['CR2','CR3','NEF','ARW','SR2','ORF','ORI','RW2','PEF','RAF','SRW','DNG','NRW','3FR','IIQ','MRW','KDC','DCR','X3F'];

/* Converts a rawEngine.demosaic() result (planar linear-light Float32 R/G/B,
   camera-native, pre-white-balance, full sensor resolution) into an ordinary
   8-bit sRGB canvas — the same shape cr2ToCanvas hands back, so everything
   downstream (auto white balance, toBlob, the working canvas, the raw-plane
   report) needs no knowledge of which decoder produced it.

   No fixed-matrix chroma boost here, unlike cr2ToCanvas's K=0.10 CCM: that
   correction is tuned against THIS TOOL'S OWN from-scratch bilinear decoder's
   measured ~40% saturation shortfall against a camera JPEG. AMaZE (and the
   other RawTherapee ports) is a real edge-directed demosaic already tuned by
   RawTherapee against reference material — applying a boost sized for a
   different, simpler decoder's known deficit would be correcting a problem
   that likely does not exist in the same shape here, unmeasured. */
function camSwapKey(on, matrix, name) { return on ? (String(name || '') + '|' + JSON.stringify(matrix || null)) : 'off'; }
function rawEngineResultToCanvas(res, doCamSpaceSwap, doCamSpaceSwapMatrix, doCamSpaceSwapName, forceFullRes) {
  if (!forceFullRes && typeof rawEngine !== 'undefined') rawEngine.builtKey = camSwapKey(!!doCamSpaceSwap, doCamSpaceSwapMatrix, doCamSpaceSwapName);
  /* TODO(perf): this whole function re-runs on EVERY swap-preset dropdown
     change and checkbox toggle (see reapplyCamSpaceSwap), and most of what
     it does doesn't actually depend on which swap preset was picked:
       - the box-filter downscale below visits every native sensor pixel
         once (e.g. ~18M for a 3464x5202 sensor) in a scalar JS loop, purely
         to reach the ~2048px working size \u2014 same result regardless of
         swapMatrix
       - chengPCAGains(res.R, res.G, res.B) further down is a property of
         the sensor data, not the swap, and gets recomputed from scratch
         every call
     Only the 3x3 matrix multiply + sRGB encode on the ALREADY-downscaled
     buffer actually needs to change when the preset changes. Fix: cache the
     downscaled linear buffer + wb gains on rawEngine.lastResult the first
     time this runs for a given decode, and on later calls skip straight to
     re-applying just the matrix+encode step to the cached buffer \u2014 or
     better, do that remaining step on the GPU (upload the cached buffer as
     a float texture once, apply the matrix as a shader uniform, one
     readPixels) instead of a second scalar CPU loop, reusing the same
     matrix-multiply/encode machinery pipelineRGB's shader already has for
     every other control in the app. Not fixed yet \u2014 flagged for later. */
  const srcW = res.width, srcH = res.height, R = res.R, G = res.G, B = res.B;

  /* Downscaled HERE, before the 8-bit buffer or the PNG encode exist, not
     left to the app's usual WORKING_MAX_DIM resize that runs later on the
     loaded Image. That resize only kicks in once a blob already exists \u2014
     by then the peak memory has already happened: the worker's three
     Float32 planes (camera-native, full sensor resolution) plus a full-res
     8-bit RGBA buffer plus whatever the PNG encoder needs internally, all
     alive at once. On desktop that peak is affordable; on a phone's much
     tighter per-tab budget it's a plausible reason the whole page can go
     silent with no catchable error \u2014 the browser killing a tab under
     memory pressure doesn't throw anything for a page to catch. Point-
     sampling straight into a smaller buffer means the full-resolution
     8-bit/PNG memory spike this app already avoids everywhere else never
     happens here either.

     forceFullRes bypasses this cap deliberately -- see its call sites for
     why. It exists because of a real bug: the code that was SUPPOSED to
     capture a genuine full-resolution version for export/session-restore
     (origW/origH) was reading cv.width/cv.height off THIS function's own
     already-capped output, for every RAW format. It wasn't reading a
     smaller number by mistake so much as there never having been a
     full-resolution canvas to read from at all -- the app concluded
     "nothing to choose, working size already matches the original" and
     hid the resolution panel, so every RAW export capped at 2048px
     regardless of what the sensor actually captured. Callers that need
     the true original (building origFile, not the live preview) now pass
     true here and get one, at the one-time memory cost that was already
     being accepted for the mis-labelled "full-res" blob before this fix
     -- the difference is that cost now actually buys full resolution. */
  const scale = forceFullRes ? 1 : Math.min(1, WORKING_MAX_DIM / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d8 = img.data;
  const LUTN = 4096;
  const enc = v => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  const encLut = new Float32Array(LUTN + 1);
  for (let i = 0; i <= LUTN; i++) encLut[i] = enc(i / LUTN);
  const idx = v => v <= 0 ? 0 : v >= 1 ? LUTN : (v * LUTN) | 0;
  /* Interpolated lookup rather than a truncating one. The table is indexed by
     LINEAR value, but sRGB encoding is steepest exactly where the table is
     coarsest: the first step spans linear 0 to 1/4096, which encodes to 0 and
     0.8/255 respectively, so every shadow value inside that span collapsed
     onto one of two outputs. Truncation also biases every sample downward
     rather than rounding. Worst error in the shadows measured at 0.80/255
     before, 0.004/255 after -- a 200x reduction for one multiply and one add.

     Being straight about the size of this: 0.8/255 is real posterisation in
     the deepest shadows and worth removing, but it is NOT what makes a gained
     RAW look noisy. See the note in rawEngineResultToCanvas about where the
     white-balance gain actually happens. */
  const encAt = v => {
    if (v <= 0) return encLut[0];
    if (v >= 1) return encLut[LUTN];
    const f = v * LUTN, i = f | 0;
    return encLut[i] + (encLut[i + 1] - encLut[i]) * (f - i);
  };
  /* Real per-camera colorimetry when LibRaw actually supplied it, rather
     than the generic grey-world guess this canvas would otherwise need
     afterward. rgb_cam is LibRaw's own measured camera->linear-sRGB matrix
     for this specific sensor; camMul is the camera's as-shot white balance.
     Composed via pp_camToSrgbLin (ported from webraw-extravisual/color.js)
     into ONE matrix, so each pixel is one 3x3 multiply rather than two.
     Falls back to identity automatically when rgb_cam is missing or
     all-zero, in which case hasCameraCal stays false and the caller runs
     its own white-balance guess instead \u2014 additive, never a regression
     from the previous plain linear-to-sRGB behaviour. */
  const camToOutput = pp_camToSrgbLin(pp_rgbCam3x3(res.rgbCam));
  /* Eigenvector WB (Cheng/Prasad/Brown) is the primary method now, not
     camMul \u2014 camMul just repeats whatever the camera's own meter already
     decided, which is exactly the number a RAW workflow exists to get a
     second opinion on. [1,1,1] is chengPCAGains' own "couldn't compute"
     signal (too few valid sample points, e.g. a very small or very flat
     frame), not a real neutral-illuminant result, so that specific case
     falls back to camMul rather than being taken at face value \u2014 a
     silently-accepted identity here would look like "confirmed already
     neutral" when it actually means "gave up". */
  let wb = res.__wb || chengPCAGains(res.R, res.G, res.B);
  let wbSource = 'eigenvector';
  if (!res.__wb && wb[0] === 1 && wb[1] === 1 && wb[2] === 1) { wb = pp_wbGain(res.camMul); wbSource = 'camera meter'; }
  if (!res.__wb) res.__wb = wb;   // the same numbers every time for this decode, including the noise-reduced preview
  const hasCameraCal = !!(res.rgbCam && res.rgbCam.length >= 12 &&
    res.rgbCam.reduce((a,b) => a + Math.abs(b), 0) > 1e-6);
  /* Experimental wide-gamut swap (see the intro-screen checkbox comment).

     The swap happens in PROPHOTO, not in camera-native space. That
     distinction is the whole point. Camera RGB channels are whatever the
     sensor's own filters happen to pass \u2014 arbitrary, sensor-specific
     primaries \u2014 so exchanging R and B there is not a well-defined colour
     operation, just a swizzle of three arbitrary numbers whose meaning
     changes from body to body. ProPhoto has fixed, standard primaries wide
     enough to contain essentially every colour a sensor can record, so a
     swap there IS well-defined, reproducible across cameras, and has the
     full separation to work with that a swap done after compression to
     sRGB does not \u2014 which is exactly the argument for doing it here.

     Only meaningful with real camera calibration: without rgb_cam the
     camera->ProPhoto matrix is identity and "ProPhoto" would be a label on
     unconverted sensor numbers, so this silently no-ops rather than
     pretending, same fail-safe shape as the white-balance fallback above. */
  const swapActive = !!(doCamSpaceSwap && hasCameraCal);
  // camera -> ProPhoto (swap happens here) -> sRGB. Composed once, not per
  // pixel; when the swap is off this collapses back to exactly camToOutput.
  const camToPP = bfMat3mul(SRGB_LIN_TO_PROPHOTO_LIN, pp_rgbCam3x3(res.rgbCam));
  // swapMatrix is one of the Channel Swap panel's own preset matrices
  // (see CAM_SPACE_SWAP_PRESETS), passed in by the caller \u2014 falls back to
  // a plain R-B exchange if none was actually selected, matching this
  // feature's original, narrower behaviour rather than silently doing
  // nothing.
  const swapMatrix = swapActive && Array.isArray(doCamSpaceSwapMatrix) ? doCamSpaceSwapMatrix : [0,0,1, 0,1,0, 1,0,0];
  const camToOutputSwapped = bfMat3mul(PROPHOTO_LIN_TO_SRGB_LIN, bfMat3mul(swapMatrix, camToPP));
  const M = swapActive ? camToOutputSwapped : camToOutput;
  res.__M = hasCameraCal ? M : null;   // build 172: the IR leak correction needs the exact camera->output step (src/ir-leak.js)
  /* wb IS multiplied in here, before the matrix -- standard order for any
     RAW pipeline (white balance, then the colour-space matrix), and the
     ONLY order that makes sense for the swap specifically: permuting raw,
     not-yet-balanced channel values through camToPP produced wildly
     oversaturated results, since a camera matrix expects roughly balanced
     input to begin with. An earlier version removed wb from this step
     entirely to fix a real double-correction bug (see below) -- that
     traded one bug for a worse one; this restores the correct order and
     fixes the actual redundant step instead, over in finishLoad(), which
     no longer copies this same wb value into preWBM for the live
     pipeline to reapply. WB now happens exactly once, right here; the
     live pipeline's own preWBM stays at identity unless the user
     deliberately sets it (the eyedropper pick), so "After" no longer
     ends up at roughly wb-squared the way it did when both stages
     multiplied it in -- the "eigenvector correction doubled up" Phil
     reported. */
  /* Parallel float buffer, same values as d8 below but never rounded to
     8-bit -- see setImage's own comment for why. sRGB-ENCODED float, not
     linear: this deliberately mirrors d8's own values at full precision
     rather than skipping the gamma encode, so the shader's existing
     srgbToLinear() decode step needs no changes at all. Only the upload
     precision changes; every step downstream of that decode is untouched. */
  const floatBuf = new Float32Array(w * h * 4);
  /* Box-filter (area-average) downscale, not nearest-neighbour. The
     previous version picked ONE source pixel per output pixel
     (sy=(y/scale)|0) and discarded the rest -- for a typical 6000px
     sensor scaled to the 2048px working canvas, that's roughly two of
     every three source pixels simply thrown away rather than blended in,
     not just downsized. Confirmed synthetically before this was written:
     a fine checkerboard run through the old sampling kept full source
     contrast (variance 0.25, meaning fine detail was aliasing into
     random solid blocks) where a correct downscale should show it
     smoothed toward grey; box-averaging measured variance 0.003, an 80x
     reduction, the expected result of detail actually being preserved as
     reduced-contrast texture instead of aliased noise. Averaging happens
     on the RAW linear R/G/B values before WB/matrix/gamma are applied
     below, not on the already-encoded output -- averaging gamma-encoded
     values instead of linear ones is a separate, well-known way to get
     this subtly wrong (it skews perceived brightness). When scale is 1
     (no actual downscale, e.g. the forceFullRes export path) the box is
     exactly 1x1 source pixel, so this reduces to the same simple sample
     the old code always did for that case -- no behaviour change there. */
  const boxSize = 1 / scale;
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor(y * boxSize);
    const sy1 = Math.min(srcH, Math.max(sy0 + 1, Math.ceil((y + 1) * boxSize)));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x * boxSize);
      const sx1 = Math.min(srcW, Math.max(sx0 + 1, Math.ceil((x + 1) * boxSize)));
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let ssy = sy0; ssy < sy1; ssy++) {
        const rowBase = ssy * srcW;
        for (let ssx = sx0; ssx < sx1; ssx++) {
          const si = rowBase + ssx;
          sr += R[si]; sg += G[si]; sb += B[si]; n++;
        }
      }
      const q = (y * w + x) * 4;
      let srn = sr / n, sgn = sg / n, sbn = sb / n;
      const rawMxPre = srn > sgn ? (srn > sbn ? srn : sbn) : (sgn > sbn ? sgn : sbn);
      const rawMnPre = srn < sgn ? (srn < sbn ? srn : sbn) : (sgn < sbn ? sgn : sbn);

      /* HIGHLIGHT RECONSTRUCTION, on the sensor values before any gain.

         When a highlight clips it usually does not clip in all three channels
         at once -- the most-gained channel pins first while the others still
         hold real data. Those surviving channels say what the pixel's
         brightness actually was, so the pinned one can be estimated rather
         than left flat. That is the difference between recovering cloud
         structure and merely making its absence look tidy.

         The estimate assumes the highlight is neutral. That is the standard
         assumption and a good one for the things that actually clip: cloud,
         sky, speculars. In balanced space a neutral pixel has equal channels,
         so whichever unclipped channel implies the highest level sets it, and
         each pinned channel is refilled to match. Faded in by how clipped the
         pixel is, so there is no seam where reconstruction begins.

         It cannot help when ALL THREE channels pinned -- nothing survives to
         estimate from. That case falls through to the desaturation below. */
      if (!res.__hlDone && rawMxPre > 0.96 && rawMnPre < 0.96) {   // the basic rebuild; skipped when inpaint opposed ran
        let recon = (rawMxPre - 0.96) / 0.04;
        recon = recon > 1 ? 1 : recon;
        recon = recon * recon * (3 - 2 * recon);
        const bR = srn * wb[0], bG = sgn * wb[1], bB = sbn * wb[2];
        let lvl = -1;
        if (srn < 0.96 && bR > lvl) lvl = bR;
        if (sgn < 0.96 && bG > lvl) lvl = bG;
        if (sbn < 0.96 && bB > lvl) lvl = bB;
        if (lvl > 0) {
          if (srn >= 0.96 && lvl > bR) srn += (lvl / wb[0] - srn) * recon;
          if (sgn >= 0.96 && lvl > bG) sgn += (lvl / wb[1] - sgn) * recon;
          if (sbn >= 0.96 && lvl > bB) sbn += (lvl / wb[2] - sbn) * recon;
        }
      }

      const cr = srn * wb[0], cg = sgn * wb[1], cb = sbn * wb[2];
      let or_ = M[0]*cr + M[1]*cg + M[2]*cb;
      let og  = M[3]*cr + M[4]*cg + M[5]*cb;
      let ob  = M[6]*cr + M[7]*cg + M[8]*cb;

      /* Highlight desaturation, for the case reconstruction cannot reach:
         every channel pinned, so there is no surviving data and the only
         honest thing left is to make the result neutral rather than let
         whichever channel clipped last decide the hue. Triggered on the RAW
         sensor level, never on the gained value -- with a blue gain of 3.5 an
         ordinary mid-tone leaves the matrix above 1.0, and thresholding on
         that would drain colour out of the whole image. */
      if (rawMnPre >= 0.96) {
        let t = (rawMnPre - 0.96) / 0.04;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        t = t * t * (3 - 2 * t);
        const mx = or_ > og ? (or_ > ob ? or_ : ob) : (og > ob ? og : ob);
        const wht = mx > 1 ? 1 : mx;
        or_ += (wht - or_) * t;
        og  += (wht - og)  * t;
        ob  += (wht - ob)  * t;
      }
      const er = encAt(or_), eg = encAt(og), eb = encAt(ob);
      d8[q]   = er * 255;
      d8[q+1] = eg * 255;
      d8[q+2] = eb * 255;
      d8[q+3] = 255;
      /* The float twin stores LINEAR, SCENE-REFERRED values, with everything
         above the white point kept.

         It used to store the same sRGB-encoded numbers as the 8-bit canvas,
         which made it a higher-precision JPEG rather than a raw: the extra
         bits bought smoother gradients but no extra latitude, because encAt()
         clamps at 1.0 and the headroom was already gone. With IR white
         balance gains a normal sunlit cloud lands between 1.05 and 1.6 linear
         after balancing -- up to two thirds of a stop above white -- and all
         of it was being discarded here, a few lines after the highlight
         reconstruction above had worked to recover it.

         Keeping it linear means the shader can do exposure and highlight
         recovery in the space where those operations mean something, and only
         encode to sRGB once at the end. The cap at 8.0 is a sanity bound
         (three stops over white); nothing real survives the sensor above
         that, and it keeps a stray value from poisoning a 16-bit float. */
      floatBuf[q]   = or_ > 8 ? 8 : (or_ < 0 ? 0 : or_);
      floatBuf[q+1] = og  > 8 ? 8 : (og  < 0 ? 0 : og);
      floatBuf[q+2] = ob  > 8 ? 8 : (ob  < 0 ? 0 : ob);
      floatBuf[q+3] = 1;
    }
  }
  ctx.putImageData(img, 0, 0);
  cv.__linearFloat = floatBuf;   // linear scene-referred twin, headroom intact -- see setImage
  /* Also parked module-level, keyed by size.

     The property alone was not enough: between this decode and the texture
     upload the app may draw the canvas into another canvas (camera-colour
     fitting, orientation, the working-size resize), and every such step
     produces a fresh canvas with no custom properties on it. The twin was
     being dropped somewhere in that chain and the shader silently fell back
     to treating clipped 8-bit pixels as linear, which is why Highlight
     recovery did nothing on a real RAW file while every isolated test of it
     passed. Keying on dimensions means whichever canvas finally arrives can
     still claim the buffer, as long as it is the same size. */
  LAST_LINEAR_FLOAT = { buf: floatBuf, w: cv.width, h: cv.height, gen: loadToken };   // tied to the load that made it
  cv.__camSpaceSwapApplied = swapActive;   // so the caller can say so, and skip re-swapping downstream if they choose to
  cv.__camSpaceSwapName = swapActive ? (doCamSpaceSwapName || 'R-B swap') : null;
  cv.__hasCameraWB = hasCameraCal;   // tells the caller whether to skip the grey-world auto-WB pass
  cv.__wbGains = wb; cv.__wbSource = wbSource;   // so the interactive WB panel can reflect what actually ran, not stay silently unaware
  cv.__demosaicName = rawDemosaicName(res);   // 'RCD' (Bayer) or 'Markesteijn' (X-Trans) -- what lr_demosaic() actually ran
  cv.__rawReport = {
    found: true, decoded: true,
    width: srcW, height: srcH, bitsPerSample: 16,
    compressionName: 'LibRaw unpack + ' + rawDemosaicName(res) + ' demosaic (WASM, GPL-3)' +
      (hasCameraCal ? ', camera-matrix developed' : ', no camera matrix in this file \u2014 grey-world WB') +
      (swapActive ? ', ' + (doCamSpaceSwapName || 'R-B swap') + ' in ProPhoto (experimental)' : '') +
      (scale < 1 ? ' \u2014 downsized to ' + w + '\u00d7' + h + ' for the working canvas' : ''),
    cfa: { bayer: (res.cfa || []).map(c => 'RGB'[c] || '?').join('') || 'unknown' },
    blackLevel: [res.black], whiteLevel: res.white,
    crop: null,
  };
  return cv;
}

function decodable(blob) {
  return new Promise(res => {
    const url = URL.createObjectURL(blob);
    const im = new Image();
    im.onload  = () => { URL.revokeObjectURL(url); res(im.naturalWidth > 0 ? im : null); };
    im.onerror = () => { URL.revokeObjectURL(url); res(null); };
    im.src = url;
  });
}

/* Try each candidate largest-first and hand back the first that the browser
   will actually decode. Validating by decoding rather than by trusting the
   offsets matters: a byte scan can land on a JPEG-looking run inside
   compressed sensor data, and some makers write a preview whose declared
   length is wrong. If it doesn't decode, it isn't the preview. */
async function extractPreview(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const cands = collectCandidates(buf);
  /* Pick by decoded AREA, not by byte count. A truncated or partially
     recovered candidate can still be the largest run of bytes while decoding
     to far fewer pixels than the real preview, so the only trustworthy
     measure is what actually came out of the decoder. */
  const orient = readTiffOrientation(buf);
  // reuses the SAME buffer already in hand, rather than a second file read,
  // to find out what the actual sensor plane looks like — purely diagnostic
  // for now; nothing downstream acts on this yet
  let rawPlane = null;
  try { rawPlane = probeRawPlane(buf); } catch (e) { rawPlane = { found: false, reason: 'probe threw: ' + e.message }; }
  let best = null;
  for (const c of cands.slice(0, 5)) {
    const blob = new Blob(c.parts.map(p => bytes.slice(p.off, p.off + p.len)), { type: 'image/jpeg' });
    const im = await decodable(blob);
    if (!im) continue;
    const area = im.naturalWidth * im.naturalHeight;
    // whether this candidate's colour was stored coarser than its brightness,
    // read from its own header — see reconstructChroma. Only the first few KB
    // are needed: the SOF sits well before the scan data.
    let sub = false;
    try {
      const p0 = c.parts[0];
      sub = jpegIsChromaSubsampled(bytes.subarray(p0.off, p0.off + Math.min(p0.len, 65536)));
    } catch (e) { sub = false; }
    if (!best || area > best.area) best = { blob, w: im.naturalWidth, h: im.naturalHeight, area, orient, rawPlane, subsampled: sub };
    if (area >= 12e6) break;                       // already full sensor size
  }
  if (best) best.rawPlane = rawPlane;               // attach even if the loop above never reassigned it via 'break'
  return best;
}
