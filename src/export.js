'use strict';
/* irlab editor: js/export.js. One of the editor's scripts, loaded in order by index.html as plain
   (non-module) scripts that share one global scope. Order matters: see the list in index.html. */

// ---------- EXIF preservation ----------
// Canvas-based export strips all metadata by nature. To carry it through, we
// read the raw EXIF (APP1) segment straight out of the source JPEG bytes at
// load time, then splice those exact same bytes into the exported file: as
// an APP1 segment for JPEG output, or a PNG "eXIf" chunk for PNG output.
// (16-bit TIFF export doesn't carry this yet.)
function extractExifSegment(bytes){
  if(bytes.length<4||bytes[0]!==0xFF||bytes[1]!==0xD8)return null;
  let i=2;
  while(i<bytes.length-4){
    if(bytes[i]!==0xFF)break;
    const marker=bytes[i+1];
    if(marker===0xD8||marker===0xD9||marker===0xDA)break;
    const len=(bytes[i+2]<<8)|bytes[i+3];
    if(len<2)break;
    if(marker===0xE1&&i+4+6<=bytes.length){
      let sig='';for(let k=0;k<6;k++)sig+=String.fromCharCode(bytes[i+4+k]);
      if(sig==='Exif\u0000\u0000')return bytes.slice(i,i+2+len);
    }
    i+=2+len;
  }
  return null;
}
async function extractExifFromFile(fileOrBlob){
  try{
    const buf=await fileOrBlob.arrayBuffer();
    return extractExifSegment(new Uint8Array(buf));
  }catch(e){return null;}
}
/* Reset the Orientation tag (0x0112) to 1 ("upright, no rotation needed")
   in a raw EXIF segment before it's spliced into an export.

   This app's exports are always already pixel-correct — the canvas that
   produced them has already applied whatever rotation the source file's own
   EXIF tag asked for (or a manual turn via the rotate buttons), baking it
   directly into the pixel data, the way any canvas-based render always
   does. exifSegment is captured from the ORIGINAL file so things like
   camera model and capture date survive into the export, but that meant
   its Orientation tag was carried over unmodified too. For the extremely
   common phone-photo case — physically landscape sensor data plus an
   Orientation tag saying "rotate 90 to display" — the result was an export
   with correct pixels AND a stale tag telling every EXIF-respecting viewer
   (Photos, the OS gallery, anything) to rotate an already-upright image
   again. That's the actual mechanism behind portraits saving as landscape:
   not a pixel bug in this app at all, a metadata one that only shows up
   once you open the saved file somewhere that honours EXIF. Applies
   whether or not the user touched the manual rotate buttons — an
   unrotated phone portrait with a landscape-sensor + orientation-tag origin
   hits this exactly the same way. */
function normalizeExifOrientation(exif) {
  if (!exif || exif.length < 20) return exif;
  const out = new Uint8Array(exif);   // mutate a copy, never the cached original
  const tiffStart = 10;                // 2 marker + 2 length + 6 "Exif\0\0"
  try {
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const b0 = dv.getUint16(tiffStart, false);
    let le;
    if (b0 === 0x4949) le = true; else if (b0 === 0x4D4D) le = false; else return exif;
    if (dv.getUint16(tiffStart + 2, le) !== 42) return exif;
    const ifdOff = dv.getUint32(tiffStart + 4, le);
    const ifd = tiffStart + ifdOff;
    if (!ifdOff || ifd + 2 > out.length) return exif;
    const n = dv.getUint16(ifd, le);
    if (n > 512) return exif;
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > out.length) break;
      if (dv.getUint16(e, le) === 0x0112) {
        dv.setUint16(e + 8, 1, le);   // value: 1 = upright, no rotation
        break;
      }
    }
  } catch (err) { return exif; }
  return out;
}
function spliceExifIntoJpegBytes(jpegBytes,exif){
  if(!exif||jpegBytes[0]!==0xFF||jpegBytes[1]!==0xD8)return jpegBytes;
  const out=new Uint8Array(2+exif.length+(jpegBytes.length-2));
  out.set([0xFF,0xD8],0);
  out.set(exif,2);
  out.set(jpegBytes.subarray(2),2+exif.length);
  return out;
}
const CRC_TABLE=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c>>>0;}return t;})();
function crc32(bytes){let c=0xFFFFFFFF;for(let i=0;i<bytes.length;i++)c=CRC_TABLE[(c^bytes[i])&0xFF]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}
function u32be(n){return[(n>>>24)&0xFF,(n>>>16)&0xFF,(n>>>8)&0xFF,n&0xFF];}
function spliceExifIntoPngBytes(pngBytes,exif){
  if(!exif||exif.length<=10)return pngBytes;
  const tiffData=exif.subarray(10);
  try{
    const ihdrLen=(pngBytes[8]<<24)|(pngBytes[9]<<16)|(pngBytes[10]<<8)|pngBytes[11];
    const ihdrEnd=8+4+4+ihdrLen+4;
    const typeBytes=new Uint8Array([0x65,0x58,0x49,0x66]);
    const crcInput=new Uint8Array(typeBytes.length+tiffData.length);
    crcInput.set(typeBytes,0);crcInput.set(tiffData,typeBytes.length);
    const crc=crc32(crcInput);
    const chunk=new Uint8Array(4+4+tiffData.length+4);
    chunk.set(u32be(tiffData.length),0);
    chunk.set(typeBytes,4);
    chunk.set(tiffData,8);
    chunk.set(u32be(crc),8+tiffData.length);
    const out=new Uint8Array(pngBytes.length+chunk.length);
    out.set(pngBytes.subarray(0,ihdrEnd),0);
    out.set(chunk,ihdrEnd);
    out.set(pngBytes.subarray(ihdrEnd),ihdrEnd+chunk.length);
    return out;
  }catch(e){return pngBytes;}
}

// zlib-wraps (header + deflate + Adler32), NOT raw deflate -- PNG's iCCP
// spec requires "zlib datastream" specifically (compression method 0).
// CompressionStream's 'deflate' mode (as opposed to 'deflate-raw') already
// produces exactly that wrapper, same Web Streams API this file already
// uses for DecompressionStream elsewhere, so no hand-written zlib needed.
async function zlibDeflate(bytes){
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  writer.write(bytes); writer.close();
  const compressed = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(compressed);
}

// Same splice-right-after-IHDR technique as spliceExifIntoPngBytes above,
// for an iCCP chunk instead of eXIf. PNG's iCCP chunk layout: profile
// name (Latin-1, null-terminated, <=79 bytes), one compression-method
// byte (0 = zlib/deflate, the only method the spec defines), then the
// zlib-compressed profile bytes themselves -- no other framing needed.
async function spliceICCIntoPngBytes(pngBytes, iccProfileBytes, profileName){
  if (!iccProfileBytes || !iccProfileBytes.length) return pngBytes;
  try{
    const nameBytes = iccAscii(profileName || 'ProPhoto RGB');
    const compressed = await zlibDeflate(iccProfileBytes);
    const data = new Uint8Array(nameBytes.length + 1 + 1 + compressed.length);
    data.set(nameBytes, 0);
    data[nameBytes.length] = 0;       // null terminator on the profile name
    data[nameBytes.length + 1] = 0;   // compression method: 0 = zlib/deflate
    data.set(compressed, nameBytes.length + 2);

    const ihdrLen=(pngBytes[8]<<24)|(pngBytes[9]<<16)|(pngBytes[10]<<8)|pngBytes[11];
    const ihdrEnd=8+4+4+ihdrLen+4;
    const typeBytes=new Uint8Array([0x69,0x43,0x43,0x50]); // 'iCCP'
    const crcInput=new Uint8Array(typeBytes.length+data.length);
    crcInput.set(typeBytes,0);crcInput.set(data,typeBytes.length);
    const crc=crc32(crcInput);
    const chunk=new Uint8Array(4+4+data.length+4);
    chunk.set(u32be(data.length),0);
    chunk.set(typeBytes,4);
    chunk.set(data,8);
    chunk.set(u32be(crc),8+data.length);
    const out=new Uint8Array(pngBytes.length+chunk.length);
    out.set(pngBytes.subarray(0,ihdrEnd),0);
    out.set(chunk,ihdrEnd);
    out.set(pngBytes.subarray(ihdrEnd),ihdrEnd+chunk.length);
    return out;
  }catch(e){return pngBytes;}
}

// ---------- original-resolution export ----------
// The live preview and on-screen WebGL canvas work at a capped size (up to
// WORKING_MAX_DIM) so the tab never freezes on a huge photo. Exporting at
// the original resolution means decoding the source file fresh at full
// size and rendering it through a SEPARATE, temporary WebGL context sized
// to match — never touching the visible preview canvas — then discarding
// that context immediately after reading the result back.
function decodeNative(file){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) { URL.revokeObjectURL(url); return reject(new Error('zero size')); }
      URL.revokeObjectURL(url);
      resolve({ img, w, h });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.src = url;
  });
}
/* For a RAW that is open now, the full-size image is rebuilt from its sensor data with the camera-space swap exactly as
   the preview has it, keeping the linear high-precision twin. It used to be decoded from a copy saved when the RAW
   first loaded, so a swap changed afterwards (or the preview being rebuilt by Undo) left full screen and full-size
   export showing a different picture from the one being edited. Anything else still uses the saved original. */
async function rawFullResSource() {
  if (!rawEngine.lastResult || rawEngine.lastGen !== loadToken) return null;
  try {
    const checked = !!($('camSpaceSwap') && $('camSpaceSwap').checked);
    const nr = rawNrValues();
    // the common case: the swap has not changed since the RAW loaded, so the saved full-size copy, with its parked
    // high-precision twin, is already right, and rebuilding it from the sensor data would only cost seconds
    if (!rawProcActive(nr) && rawEngine.fullKey && camSwapKey(checked, getCamSpaceSwapMatrix(), getCamSpaceSwapName()) === rawEngine.fullKey &&
        LAST_LINEAR_FLOAT && LAST_LINEAR_FLOAT.gen === loadToken && LAST_LINEAR_FLOAT.w === origW && LAST_LINEAR_FLOAT.h === origH) return null;
    let src = rawEngine.lastResult;
    if (rawProcActive(nr)) {   // the same highlight rebuild and noise reduction, at full resolution this time
      const wb = rawWbFor(src), btn = $('bDl');
      const out = await runRawNr(src.R, src.G, src.B, src.width, src.height, { luma: nr.L, chroma: nr.C, hl: nr.HL, wb: wb },
        p => { if (btn && btn.disabled) btn.textContent = 'Reducing noise ' + Math.round(p * 100) + '%\u2026'; });
      src = Object.assign({}, src, { R: out.R, G: out.G, B: out.B, __wb: wb, __ds: null, __hlDone: !!out.hlDone });
    }
    const keep = LAST_LINEAR_FLOAT, keepKey = rawEngine.builtKey;
    const cv = rawEngineResultToCanvas(src, checked, getCamSpaceSwapMatrix(), getCamSpaceSwapName(), true);
    LAST_LINEAR_FLOAT = keep; rawEngine.builtKey = keepKey;   // building this must not disturb the preview's own
    return cv;
  } catch (e) { return null; }
}
async function renderAtOriginalRes() {
  /* let, not const: w and h are reassigned below from the oriented canvas,
     because drawOriented swaps them for a 90/270-degree EXIF rotation. As
     const this threw "Assignment to constant variable." on EVERY full-size
     export — and the caller catches the throw and quietly falls back to
     working size, so the only symptom was that "original" silently produced
     a 2048px file. */
  const rawCv = await rawFullResSource();
  let { img, w, h } = rawCv ? { img: rawCv, w: rawCv.width, h: rawCv.height } : await decodeNative(origFile);

  /* Query the GPU limit from the LIVE context, and BEFORE decoding to a
     canvas. This previously called oc.getContext('webgl') on a canvas that
     had already been handed a '2d' context — which the spec requires to
     return null, every time, on every device. So maxTex silently pinned to
     the 4096 fallback and any original above that was refused with a toast
     blaming the GPU, on hardware that reports 8192 or 16384. */
  const gl0 = engine && engine.gl;
  const maxTex = gl0 ? gl0.getParameter(gl0.MAX_TEXTURE_SIZE) : 4096;
  if (w > maxTex || h > maxTex) {
    toast('Original (' + w + '×' + h + ') exceeds this device\u2019s GPU texture limit (' + maxTex + 'px) — using working size instead');
    return null;
  }

  const oc = document.createElement('canvas');
  // same orientation as the preview, or a full-size export would come out
  // sideways while the thing on screen looked right
  drawOriented(oc, img, w, h, srcOrient);
  carryLinearFloat(oc, rawCv || img, srcOrient);   // the same linear twin the preview renders from (for the saved copy, the parked one)
  w = oc.width; h = oc.height;

  const exportCanvas = document.createElement('canvas');
  const exportEngine = new WebGLEngine(exportCanvas);
  exportEngine.setImage(dustPrepare(oc));   // build 185: dust spots heal at full resolution too
  // currentParams() rather than a hand-rolled duplicate — the old copy here
  // had silently omitted tempTint, so temperature and tint were visible in
  // the preview and absent from every full-resolution export.
  exportEngine.setLUT(currentLUT);   // the grade is baked by the shader now, not by a CPU loop afterwards
  /* The built-in film LUT lives on a SECOND texture unit, so it needs
     uploading to this temporary engine too — setLUT alone only covers the
     imported .cube. Missing it meant the fullscreen view and every full-size
     export silently dropped the Aerochrome transform while the working
     preview still showed it: same settings, two different images. */
  exportEngine.setLUTPre(preLUTUser || decodeFilmLUT());
  const params = exportParams();
  { const pv = $('preview'), pl = pv ? Math.max(pv.width, pv.height) : 0;   // how many source px one preview px stands for
    params.nrScale = pl > 0 ? Math.max(1, Math.max(w, h) / pl) : 1; }
  /* try/finally, not a straight-line release. Browsers cap concurrent WebGL
     contexts at somewhere around eight to sixteen and silently drop the
     OLDEST when a new one exceeds that — and the oldest is the main preview
     engine. Releasing only on the success path meant every export that threw
     (a float buffer that would not allocate, an image too large, a lost
     context mid-render) leaked a context permanently, so after enough of
     them the preview's own context was evicted and every later render did
     nothing at all, with no error: the picture simply stopped changing. */
  try {
    // Prefer the half-float path; the 8-bit canvas draw is only worth paying
    // for if that fails — on a device without a renderable float buffer, or on
    // an original large enough that the float buffer won't allocate.
    let px = exportEngine.renderHiPrec(params);
    if (!px) { exportEngine.render(params); px = exportEngine.readPixels(); }
    return { px, w, h };
  } finally {
    if (rawCv) { delete rawCv.__linearFloat; delete oc.__linearFloat; }   // these full-size float buffers are large: let them go
    const loseCtx = exportEngine.gl && exportEngine.gl.getExtension('WEBGL_lose_context');
    if (loseCtx) loseCtx.loseContext();
  }
}

// ---------- 16-bit TIFF ----------
/* rgba is either a Uint16Array of true 0..65535 samples (from the
   half-float render path) or a Uint8ClampedArray, in which case each byte is
   expanded by 257 — which maps 0..255 exactly onto 0..65535 but adds no
   information whatsoever. The previous version only ever did the latter, so
   the "16-bit TIFF" was a 16-bit container holding 8-bit data. */
/* ---------- sRGB ICC profile, embedded in TIFF exports ----------

   Every export from this tool has always been genuinely sRGB — the whole
   pipeline uses the IEC 61966-2-1 transfer function throughout (see
   srgbToLinearF/linearToSrgbF) — but the TIFF encoder never actually SAID
   so. No ICC tag, nothing declaring a colour space at all, which leaves
   every consuming application to assume sRGB rather than be told. Harmless
   until it isn't: open the file somewhere colour-managed and there is
   nothing to manage against.

   Structure (header, tag table, XYZ/curve/text tag encoding, 4-byte
   alignment) follows the same minimal-valid-ICC-v2 approach used in
   webraw-extravisual's own ICC writer for its ProPhoto export, adapted here
   for sRGB's own colorants and — unlike a single-gamma shortcut — a genuinely
   SAMPLED transfer curve built from this file's own exact sRGB formula,
   since sRGB's real curve is piecewise (a short linear segment near black,
   then a ~2.4 power law), not a pure gamma the way ProPhoto's is. A pure
   2.2-gamma approximation would have been close but not exactly what this
   tool actually does to every pixel.

   The colorant matrix (sRGB primaries, D65 white, Bradford-adapted to the
   D50 PCS ICC profiles use) was derived from the published primaries rather
   than typed from memory, and checked against the standard reference sRGB
   ICC matrix values: max deviation 8.7e-5, well inside normal
   Bradford-rounding tolerance between sources. */
function s15Fixed16(v) { return Math.round(v * 65536); }

function iccXyzBlock(x, y, z) {
  const b = new Uint8Array(20), dv = new DataView(b.buffer);
  b[0]=0x58; b[1]=0x59; b[2]=0x5a; b[3]=0x20; // 'XYZ '
  dv.setInt32(8, s15Fixed16(x), false);
  dv.setInt32(12, s15Fixed16(y), false);
  dv.setInt32(16, s15Fixed16(z), false);
  return b;
}

// sampled curv tag: count + N big-endian uint16 samples, domain and range
// both 0..1. Built from this file's own srgbToLinearF, so the embedded
// profile matches what the pipeline actually computes, not a stand-in gamma.
function iccSampledCurve(n) {
  const b = new Uint8Array(12 + n * 2), dv = new DataView(b.buffer);
  b[0]=0x63; b[1]=0x75; b[2]=0x72; b[3]=0x76; // 'curv'
  dv.setUint32(8, n, false);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    dv.setUint16(12 + i * 2, Math.round(srgbToLinearF(x) * 65535), false);
  }
  return b;
}
// Same 'curv' tag shape as iccSampledCurve above, but sampling a plain
// power-law gamma instead of the sRGB piecewise curve -- used for the
// ProPhoto profile below. ROMM RGB's real TRC has a small linear toe
// segment before the power curve, same idea as sRGB's; a pure gamma is
// the common practical approximation most software actually ships (and
// is a documented simplification here, not silently passed off as the
// exact ROMM curve).
function iccSampledCurveGamma(n, gamma) {
  const b = new Uint8Array(12 + n * 2), dv = new DataView(b.buffer);
  b[0]=0x63; b[1]=0x75; b[2]=0x72; b[3]=0x76; // 'curv'
  dv.setUint32(8, n, false);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    dv.setUint16(12 + i * 2, Math.round(Math.pow(x, gamma) * 65535), false);
  }
  return b;
}

function iccAscii(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0x7f;
  return out;
}
function iccDescBlock(text) {
  const a = iccAscii(text), count = a.length + 1;
  const b = new Uint8Array(8 + 4 + count + 4 + 4 + 2 + 1 + 67), dv = new DataView(b.buffer);
  b[0]=0x64; b[1]=0x65; b[2]=0x73; b[3]=0x63; // 'desc'
  dv.setUint32(8, count, false);
  b.set(a, 12);
  return b;
}
function iccTextBlock(text) {
  const a = iccAscii(text);
  const b = new Uint8Array(8 + a.length + 1);
  b[0]=0x74; b[1]=0x65; b[2]=0x78; b[3]=0x74; // 'text'
  b.set(a, 8);
  return b;
}
function iccTagSig(s) { return [s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)]; }
const iccAlign4 = n => (n + 3) & ~3;

let _sRGBICCCache = null;
function buildSRGBICCProfile() {
  if (_sRGBICCCache) return _sRGBICCCache;

  // sRGB primaries -> XYZ(D50), Bradford-adapted; verified against the
  // published reference matrix to 8.7e-5 before being committed here
  const rXYZ = iccXyzBlock(0.436066, 0.222493, 0.013924);
  const gXYZ = iccXyzBlock(0.385152, 0.716887, 0.097081);
  const bXYZ = iccXyzBlock(0.143078, 0.060620, 0.714099);
  const wtpt = iccXyzBlock(0.9642, 1.0, 0.8249); // D50 PCS white
  const trc  = iccSampledCurve(256);
  const desc = iccDescBlock('sRGB IEC61966-2.1 (irlab.uk)');
  const cprt = iccTextBlock('Public Domain');

  const blocks = [
    { sig: 'desc', data: desc }, { sig: 'wtpt', data: wtpt },
    { sig: 'rXYZ', data: rXYZ }, { sig: 'gXYZ', data: gXYZ }, { sig: 'bXYZ', data: bXYZ },
    { sig: 'rTRC', data: trc }, { sig: 'cprt', data: cprt },
  ];
  const tagList = ['desc','wtpt','rXYZ','gXYZ','bXYZ','rTRC','gTRC','bTRC','cprt'];

  const headerSize = 128, tagCount = tagList.length, tagTableSize = 4 + tagCount * 12;
  let offset = iccAlign4(headerSize + tagTableSize);
  const placement = new Map();
  for (const blk of blocks) {
    placement.set(blk.sig, { off: offset, size: blk.data.length });
    offset = iccAlign4(offset + blk.data.length);
  }
  const trcPlace = placement.get('rTRC');
  placement.set('gTRC', trcPlace); placement.set('bTRC', trcPlace); // share one curve block

  const totalSize = offset;
  const buf = new Uint8Array(totalSize), dv = new DataView(buf.buffer);
  dv.setUint32(0, totalSize, false);
  dv.setUint32(8, 0x02100000, false); // ICC v2.1
  buf.set(iccTagSig('mntr'), 12); buf.set(iccTagSig('RGB '), 16); buf.set(iccTagSig('XYZ '), 20);
  buf.set(iccTagSig('acsp'), 36);
  dv.setUint32(64, 0, false); // perceptual rendering intent
  dv.setInt32(68, s15Fixed16(0.9642), false);
  dv.setInt32(72, s15Fixed16(1.0), false);
  dv.setInt32(76, s15Fixed16(0.8249), false);

  let p = headerSize;
  dv.setUint32(p, tagCount, false); p += 4;
  for (const sig of tagList) {
    const place = placement.get(sig);
    buf.set(iccTagSig(sig), p);
    dv.setUint32(p + 4, place.off, false);
    dv.setUint32(p + 8, place.size, false);
    p += 12;
  }
  for (const blk of blocks) buf.set(blk.data, placement.get(blk.sig).off);

  _sRGBICCCache = buf;
  return buf;
}

let _ProPhotoICCCache = null;
function buildProPhotoICCProfile() {
  if (_ProPhotoICCCache) return _ProPhotoICCCache;

  // ProPhoto RGB primaries -> XYZ(D50). No Bradford adaptation needed
  // here (unlike sRGB above) -- ProPhoto's own native white point IS
  // D50, matching the ICC profile connection space directly. Computed
  // from this file's own PROPHOTO_RGB_TO_XYZ_D50 matrix (same one the
  // ProPhoto channel-swap feature already uses) -- verified by summing
  // all three primaries and confirming the result equals the D50 white
  // point below, to within rounding.
  const rXYZ = iccXyzBlock(0.797667, 0.288037, 0.000000);
  const gXYZ = iccXyzBlock(0.135192, 0.711877, 0.000086);
  const bXYZ = iccXyzBlock(0.031353, 0.000086, 0.825188);
  const wtpt = iccXyzBlock(0.9642, 1.0, 0.8249); // D50 PCS white, same for every profile
  // ROMM RGB's real tone curve has a small linear toe before a 1.8 power
  // section (the same shape as sRGB's own toe+power curve); a pure 1.8
  // gamma is the common practical approximation most software ships,
  // and is what's used here -- a documented simplification, not passed
  // off as the exact ROMM curve.
  const trc  = iccSampledCurveGamma(256, 1.8);
  const desc = iccDescBlock('ProPhoto RGB (irlab.uk)');
  const cprt = iccTextBlock('Public Domain');

  const blocks = [
    { sig: 'desc', data: desc }, { sig: 'wtpt', data: wtpt },
    { sig: 'rXYZ', data: rXYZ }, { sig: 'gXYZ', data: gXYZ }, { sig: 'bXYZ', data: bXYZ },
    { sig: 'rTRC', data: trc }, { sig: 'cprt', data: cprt },
  ];
  const tagList = ['desc','wtpt','rXYZ','gXYZ','bXYZ','rTRC','gTRC','bTRC','cprt'];

  const headerSize = 128, tagCount = tagList.length, tagTableSize = 4 + tagCount * 12;
  let offset = iccAlign4(headerSize + tagTableSize);
  const placement = new Map();
  for (const blk of blocks) {
    placement.set(blk.sig, { off: offset, size: blk.data.length });
    offset = iccAlign4(offset + blk.data.length);
  }
  const trcPlace = placement.get('rTRC');
  placement.set('gTRC', trcPlace); placement.set('bTRC', trcPlace); // share one curve block

  const totalSize = offset;
  const buf = new Uint8Array(totalSize), dv = new DataView(buf.buffer);
  dv.setUint32(0, totalSize, false);
  dv.setUint32(8, 0x02100000, false); // ICC v2.1
  buf.set(iccTagSig('mntr'), 12); buf.set(iccTagSig('RGB '), 16); buf.set(iccTagSig('XYZ '), 20);
  buf.set(iccTagSig('acsp'), 36);
  dv.setUint32(64, 0, false); // perceptual rendering intent
  dv.setInt32(68, s15Fixed16(0.9642), false);
  dv.setInt32(72, s15Fixed16(1.0), false);
  dv.setInt32(76, s15Fixed16(0.8249), false);

  let p = headerSize;
  dv.setUint32(p, tagCount, false); p += 4;
  for (const sig of tagList) {
    const place = placement.get(sig);
    buf.set(iccTagSig(sig), p);
    dv.setUint32(p + 4, place.off, false);
    dv.setUint32(p + 8, place.size, false);
    p += 12;
  }
  for (const blk of blocks) buf.set(blk.data, placement.get(blk.sig).off);

  _ProPhotoICCCache = buf;
  return buf;
}

/* ZIP (Adobe Deflate, TIFF compression tag value 8) rather than LZW: LZW's
   byte-oriented dictionary matching does poorly on 16-bit sample data,
   where the meaningful repetition is between whole 16-bit values, not the
   individual bytes LZW actually dictionary-matches on -- Pizzamancer's own
   read on this matches how these codecs actually work. Deflate has no such
   assumption. Reuses zlibDeflate (built for the PNG iCCP chunk below) --
   CompressionStream('deflate') produces zlib-wrapped output, which is
   exactly the byte stream Adobe Deflate expects, not a coincidence worth
   re-deriving. Necessarily async now, since compression is: the pixel
   buffer has to exist before its compressed size is known, so the file
   layout (which depends on that size) can't be computed up front the way
   the uncompressed version could. */
async function encodeTIFF16(rgba,w,h,useProPhoto,xmp){
  const is16 = rgba instanceof Uint16Array;
  const icc = useProPhoto ? buildProPhotoICCProfile() : buildSRGBICCProfile();
  const spp=3;
  const rawPx=new Uint16Array(w*h*spp);let j=0;
  if(is16){
    for(let i=0;i<rgba.length;i+=4){rawPx[j++]=rgba[i];rawPx[j++]=rgba[i+1];rawPx[j++]=rgba[i+2];}
  }else{
    for(let i=0;i<rgba.length;i+=4){rawPx[j++]=rgba[i]*257;rawPx[j++]=rgba[i+1]*257;rawPx[j++]=rgba[i+2]*257;}
  }
  // TIFF's own byte order applies to sample data same as everywhere else in
  // the file -- rawPx is native-endian (whatever this device is), so on a
  // big-endian host this would need a byte-swap pass before compressing.
  // Every consumer of LE here already assumes little-endian throughout, so
  // this isn't a new assumption, just one that now also has to hold before
  // the compress step rather than only at final write time.
  const compressedPx = await zlibDeflate(new Uint8Array(rawPx.buffer, rawPx.byteOffset, rawPx.byteLength));
  // 15 IFD entries now (34675 ICC Profile added), written in ascending tag
  // order as the TIFF spec requires -- 34675 is far larger than every other
  // tag here, so it has to be the LAST entry, not inserted mid-list.
  const xl=xmp?xmp.length:0;   // build 158: XMP (tag 700) carries the filter stack, see src/look-export.js
  const pixelBytes=compressedPx.length,numEntries=xl?16:15,ifdOffset=8,ifdSize=2+numEntries*12+4,after=ifdOffset+ifdSize;
  const bpsOff=after,xResOff=bpsOff+6,yResOff=xResOff+8,iccOff=yResOff+8;
  // ICC block is 4-byte aligned before the pixel data, matching the alignment
  // already used inside the profile itself -- not required by TIFF, just tidy
  const xmpOff=(iccOff+icc.length+3)&~3;
  const pixOff=(xmpOff+xl+3)&~3;
  const buf=new ArrayBuffer(pixOff+pixelBytes),dv=new DataView(buf);
  dv.setUint8(0,LE?0x49:0x4D);dv.setUint8(1,LE?0x49:0x4D);dv.setUint16(2,42,LE);dv.setUint32(4,ifdOffset,LE);
  let o=ifdOffset;dv.setUint16(o,numEntries,LE);o+=2;
  const en=(t,ty,c,v)=>{dv.setUint16(o,t,LE);dv.setUint16(o+2,ty,LE);dv.setUint32(o+4,c,LE);dv.setUint32(o+8,v,LE);o+=12;};
  en(256,4,1,w);en(257,4,1,h);en(258,3,3,bpsOff);en(259,3,1,8);en(262,3,1,2);en(273,4,1,pixOff);en(277,3,1,3);en(278,4,1,h);en(279,4,1,pixelBytes);en(282,5,1,xResOff);en(283,5,1,yResOff);en(284,3,1,1);en(296,3,1,2);en(339,3,1,1);if(xl)en(700,1,xl,xmpOff);en(34675,7,icc.length,iccOff);dv.setUint32(o,0,LE);
  dv.setUint16(bpsOff,16,LE);dv.setUint16(bpsOff+2,16,LE);dv.setUint16(bpsOff+4,16,LE);
  dv.setUint32(xResOff,72,LE);dv.setUint32(xResOff+4,1,LE);dv.setUint32(yResOff,72,LE);dv.setUint32(yResOff+4,1,LE);
  new Uint8Array(buf,iccOff,icc.length).set(icc);
  if(xl)new Uint8Array(buf,xmpOff,xl).set(xmp);
  new Uint8Array(buf,pixOff,pixelBytes).set(compressedPx);
  return new Blob([buf],{type:'image/tiff'});
}

/* Ordered (Bayer) dither, used only when a high-precision render has to be
   squeezed back down to 8 bits for PNG or JPEG.

   Rounding to the nearest of 256 levels is what turns a smooth IR sky into
   visible stair-steps, and the harder the exposure/contrast/black-point
   controls stretch the tonal range, the wider each step gets. Adding a
   sub-LSB threshold pattern before rounding scatters the decision across a
   fixed 8x8 grid, so the boundary between two output levels becomes a fine
   dither texture instead of a hard contour line. The 8x8 matrix is the
   standard recursive Bayer construction; it's deterministic, so exporting
   the same image twice gives byte-identical files. */
const BAYER8 = (() => {
  const m = new Float32Array(64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    let v = 0, mask = 4, bit = 0;
    // interleave the bits of x^y and y, the usual Bayer bit-reversal
    for (let i = 0; i < 3; i++, mask >>= 1) {
      v |= (((y & mask) >> (2 - i)) << (bit++));
      v |= ((((x ^ y) & mask) >> (2 - i)) << (bit++));
    }
    // reverse so the low bits carry the finest ordering, then centre on zero
    let r = 0;
    for (let i = 0; i < 6; i++) r |= ((v >> i) & 1) << (5 - i);
    m[y * 8 + x] = (r / 64) - 0.5;
  }
  return m;
})();
function quantize8(u16, w, h) {
  const out = new Uint8ClampedArray(u16.length);
  for (let y = 0; y < h; y++) {
    const row = (y & 7) * 8;
    for (let x = 0; x < w; x++) {
      const d = BAYER8[row + (x & 7)];
      const p = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = u16[p + c] / 257 + d;   // 0..255 scale, plus sub-level offset
        out[p + c] = v < 0 ? 0 : v > 255 ? 255 : (v + 0.5) | 0;
      }
      out[p + 3] = u16[p + 3] >> 8;
    }
  }
  return out;
}

// Tell the user plainly which precision they're actually going to get, since
// it depends on the device rather than on anything they chose.
function updatePrecisionNote() {
  const el = $('precNote');
  if (!el) return;
  if (!engine) { el.textContent = ''; return; }
  el.textContent = engine.hiPrec
    ? 'This device supports high-precision rendering: TIFF export carries true 16-bit tone, and PNG/JPEG are dithered down from it.'
    : 'This device lacks a renderable half-float buffer (needs WebGL2), so export is 8-bit; TIFF will still be written as a 16-bit file, but padded from 8-bit values.';
}

function bytesPerPixelFor(fmt){return fmt==='tiff16'?6:fmt==='png'?3:0.3;}

/* Converts an sRGB-encoded RGBA pixel buffer to ProPhoto RGB, encoded with
   ProPhoto's own tone curve (a pure 1.8 gamma here — the same practical
   approximation used for the embedded ICC profile's TRC above, so the
   actual pixel values match what the profile tag claims). Reuses this
   file's own SRGB_LIN_TO_PROPHOTO_LIN matrix (the ProPhoto channel-swap
   feature's own matrix) rather than deriving a second one. Alpha passes
   through untouched. Works on either a Uint16Array (16-bit TIFF path) or
   a Uint8ClampedArray/Uint8Array (8-bit PNG path) — same maths, just a
   different input/output scale. */
function convertRGBAtoProPhoto(px, isU16){
  const scale = isU16 ? 65535 : 255;
  const out = isU16 ? new Uint16Array(px.length) : new Uint8ClampedArray(px.length);
  const M = SRGB_LIN_TO_PROPHOTO_LIN;
  for (let i = 0; i < px.length; i += 4) {
    const lr = srgbToLinearF(px[i]   / scale);
    const lg = srgbToLinearF(px[i+1] / scale);
    const lb = srgbToLinearF(px[i+2] / scale);
    const pr = M[0]*lr + M[1]*lg + M[2]*lb;
    const pg = M[3]*lr + M[4]*lg + M[5]*lb;
    const pb = M[6]*lr + M[7]*lg + M[8]*lb;
    const cr = Math.max(0, Math.min(1, pr));
    const cg = Math.max(0, Math.min(1, pg));
    const cb = Math.max(0, Math.min(1, pb));
    out[i]   = Math.round(Math.pow(cr, 1/1.8) * scale);
    out[i+1] = Math.round(Math.pow(cg, 1/1.8) * scale);
    out[i+2] = Math.round(Math.pow(cb, 1/1.8) * scale);
    out[i+3] = px[i+3];
  }
  return out;
}
function updateExportResOptions(){
  const panel = $('resPanel');
  if (!origW || !origH || (origW === $('preview').width && origH === $('preview').height)) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';
  const fmt = document.querySelector('input[name=fmt]:checked').value;
  const bpp = bytesPerPixelFor(fmt);
  const w = $('preview').width, h = $('preview').height;
  const mbWorking = (w*h*bpp/1048576).toFixed(1);
  $('resWorkingLbl').textContent = '(' + w + '×' + h + ' · ~' + mbWorking + ' MB)';
  const mbOrig = (origW*origH*bpp/1048576).toFixed(1);
  $('resOrigLbl').textContent = '(' + origW + '×' + origH + ' · ~' + mbOrig + ' MB)';
  $('resNote').textContent = 'Your source photo is ' + origW + '×' + origH + '. Working size is downscaled for smooth live preview — original renders fresh at export time and takes longer.';
}
document.querySelectorAll('input[name=fmt]').forEach(r => r.addEventListener('change', () => {
  updateExportResOptions();
  const fmt = document.querySelector('input[name=fmt]:checked').value;
  const row = $('wideGamutRow');
  if (row) row.style.display = (fmt === 'tiff16' || fmt === 'png') ? 'flex' : 'none';
}));
// Run once at load too, not just on change -- TIFF is checked by default,
// so the wide-gamut row should already be visible on first paint, not
// only after the user touches the format radios.
(() => {
  const fmt0 = document.querySelector('input[name=fmt]:checked');
  const row0 = $('wideGamutRow');
  if (fmt0 && row0) row0.style.display = (fmt0.value === 'tiff16' || fmt0.value === 'png') ? 'flex' : 'none';
})();

/* ---------- handing a finished file to the browser ----------
   Why consecutive exports could fail: a download only counts as the user's own while the tap that started it is
   still "fresh" (Chrome allows about five seconds). Building a full-size or 16-bit file can take longer than that,
   so the download that finally fires is treated as one the page started by itself. Chrome lets the first of those
   through and blocks the next ones (on Android, often silently), so the first export of a session worked and the
   next one did nothing. If the tap is still fresh, the file is saved straight away as before; if not, a "Save"
   button appears, and tapping it saves the file as a fresh action that the browser always accepts. */
let exportsThisSession = 0;
function deliverBlob(blob, name, after) {
  exportsThisSession++;
  const url = URL.createObjectURL(blob);
  const fire = () => {
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    if (typeof haptic === 'function') haptic('confirm');
    if (after) after();
  };
  const fresh = !(navigator.userActivation && navigator.userActivation.isActive === false);
  /* An app opened from the home-screen icon has no way to show Chrome's "allow multiple downloads?" question, so a
     second download there can be blocked without a word. From the second export on, it always gets the bar, with a
     Save button that does not depend on the download system (see below). */
  const installed = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  if (fresh && !(installed && exportsThisSession > 1)) { fire(); return; }
  showSaveReady(name, fire, blob, after, url);
}
/* Saving inside the installed app, where Chrome's download system blocks repeat downloads without saying so:
   1. a real Save-as dialog (File System Access), where the browser offers it: writes the file directly, no download
      involved at all;
   2. otherwise the download runs in a fresh browser tab, which Chrome treats as a new page and so lets through;
   3. otherwise the plain download, as everywhere else. */
function saveWithPicker(blob, name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const mime = blob.type || ({ tiff: 'image/tiff', tif: 'image/tiff', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', zip: 'application/zip' })[ext] || 'application/octet-stream';
  return window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Export', accept: { [mime]: ['.' + ext] } }] })
    .then(h => h.createWritable().then(w => w.write(blob).then(() => w.close()))).then(() => true)
    .catch(e => (e && e.name === 'AbortError') ? 'cancel' : false);
}
function saveInNewTab(url, name) {
  let w = null; try { w = window.open('', '_blank'); } catch (e) { w = null; }
  if (!w) return false;
  try {
    w.document.write('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Saving</title><body style="margin:0;padding:24px;background:#0c0d0f;color:#eceae4;font:15px system-ui,sans-serif">Saving ' + name.replace(/[<&]/g, '') + '&hellip; you can close this tab.</body>');
    const a = w.document.createElement('a'); a.href = url; a.download = name; w.document.body.appendChild(a); a.click();
    setTimeout(() => { try { w.close(); } catch (e) {} }, 6000);
    return true;
  } catch (e) { try { w.close(); } catch (e2) {} return false; }
}
function showSaveReady(name, fire, blob, after, url) {
  let bar = $('saveReady');
  if (!bar) {
    bar = document.createElement('div'); bar.id = 'saveReady'; bar.setAttribute('role', 'dialog'); bar.setAttribute('aria-label', 'Export ready');
    bar.innerHTML = '<span class="srText"></span><button type="button" class="srSave">Save</button><button type="button" class="srClose" aria-label="Dismiss">\u00d7</button>';
    document.body.appendChild(bar);
  }
  bar.querySelector('.srText').textContent = 'Your export is ready: ' + name;
  const save = bar.querySelector('.srSave'), close = bar.querySelector('.srClose');
  const installedApp = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  save.onclick = () => {
    if (installedApp && blob && window.showSaveFilePicker) {
      saveWithPicker(blob, name).then(r => {
        if (r === true) { bar.classList.remove('on'); toast('Saved ' + name); if (after) after(); }
        else if (r !== 'cancel') { bar.classList.remove('on'); fire(); }
      });
      return;
    }
    if (installedApp && url && saveInNewTab(url, name)) { bar.classList.remove('on'); if (after) after(); return; }
    bar.classList.remove('on'); fire();
  };
  close.onclick = () => { bar.classList.remove('on'); };
  bar.classList.add('on');
  try { save.focus({ preventScroll: true }); } catch (e) {}
}

async function exportNow() {
  if (!engine || !loadedImage) return;
  // The whole handler used to have no error handling at all, so any
  // exception anywhere in it — a bad readback, a thrown promise, anything —
  // produced exactly nothing: no toast, no download, no clue. That's a
  // diagnosis dead end as much as a UX one. Wrapping the whole thing means
  // the NEXT time an export silently fails, it stops being silent.
  try {
  const resChoice = (document.querySelector('input[name=res]:checked') || { value: 'working' }).value;
  const useOriginal = resChoice === 'original' && origFile && (origW !== $('preview').width || origH !== $('preview').height);

  let px, w, h;
  if (useOriginal) {
    $('bDl').disabled = true; $('bDl').textContent = 'Rendering original…';
    try {
      const result = await renderAtOriginalRes();
      if (result) { px = result.px; w = result.w; h = result.h; }
    } catch (e) { toast('Original render failed (' + e.message + ') — using working size', true); }
    $('bDl').disabled = false; $('bDl').textContent = 'Export Image';
  }
  if (!px) {
    w = $('preview').width; h = $('preview').height;
    // same precedence at working size: half-float first, 8-bit canvas readback
    // as the fallback. The LUT is no longer applied here in a CPU loop — the
    // shader bakes it, which is also why the preview finally shows it.
    const ep = exportParams();
    px = engine.renderHiPrec(ep);
    if (!px) { engine.render(ep); px = engine.readPixels(); }
    render();   // repaint the canvas with the on-screen params, overlay and all
  }
  ({ px, w, h } = applyCropToPixels(px, w, h));   // crop is applied to the finished pixels, for every format

  const fmt = document.querySelector('input[name=fmt]:checked').value;
  const stamp = Date.now();
  const is16 = px instanceof Uint16Array;
  // JPEG never offers this (checkbox is hidden for it, see the format-change
  // listener above) -- always sRGB there, deliberately, per the export
  // panel's own note.
  const useProPhoto = (fmt === 'tiff16' || fmt === 'png') &&
    !!($('exportProPhoto') && $('exportProPhoto').checked);

  if (fmt === 'tiff16') {
    if (useProPhoto) px = convertRGBAtoProPhoto(px, is16);
    const blob = await encodeTIFF16(px, w, h, useProPhoto, buildXmpPacket());
    deliverBlob(blob, 'channel-swap-' + stamp + '.tiff', offerLanding);
    return;
  }

  if (useProPhoto) px = convertRGBAtoProPhoto(px, is16);
  const oc = document.createElement('canvas');
  oc.width = w; oc.height = h;
  const ox = oc.getContext('2d');
  const id = ox.createImageData(w, h);
  // PNG and JPEG are 8-bit containers, so a high-precision render has to be
  // quantised — dithered rather than hard-rounded, or the extra precision is
  // thrown away as contouring at the very last step.
  id.data.set(is16 ? quantize8(px, w, h) : px);
  ox.putImageData(id, 0, 0);
  const mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
  const ext = fmt === 'png' ? 'png' : 'jpg';
  oc.toBlob(async b => {
    if (!b) { alert('Export failed.'); return; }
    let finalBlob = b;
    try {
      let buf = new Uint8Array(await b.arrayBuffer());
      if (fmt === 'png') {
        if (useProPhoto) buf = await spliceICCIntoPngBytes(buf, buildProPhotoICCProfile(), 'ProPhoto RGB');
        buf = spliceXmpIntoPngBytes(buf, buildXmpPacket());
        if (exifSegment) buf = spliceExifIntoPngBytes(buf, normalizeExifOrientation(exifSegment));
      } else {
        buf = spliceXmpIntoJpegBytes(buf, buildXmpPacket());   // inserted first so the EXIF segment lands ahead of it
        if (exifSegment) buf = spliceExifIntoJpegBytes(buf, normalizeExifOrientation(exifSegment));
      }
      finalBlob = new Blob([buf], { type: mime });
    } catch (e) {}
    deliverBlob(finalBlob, 'channel-swap-' + stamp + '.' + ext, offerLanding);
  }, mime, fmt === 'jpeg' ? 1.0 : undefined);
  } catch (e) {
    $('bDl').disabled = false; $('bDl').textContent = 'Export Image';
    alert('Export failed: ' + (e && e.message ? e.message : e) + '\n\nA screenshot of this is the fastest way to get it fixed.');
  }
}
/* The export used to start its heavy work in the same instant as the tap, so nothing on screen changed until it was
   done and the button felt slow or stuck. Now the button says "Exporting…" straight away, the page gets a moment to
   show that, and a second tap while one export is running is ignored instead of starting another. */
let exportBusy = false;
$('bDl').onclick = async () => {
  if (exportBusy || !engine || !loadedImage) return;
  exportBusy = true;
  const btn = $('bDl'); btn.disabled = true; btn.classList.add('busy'); btn.textContent = 'Exporting\u2026';
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  try { await exportNow(); }
  finally { exportBusy = false; btn.disabled = false; btn.classList.remove('busy'); btn.textContent = 'Export Image'; }
};
