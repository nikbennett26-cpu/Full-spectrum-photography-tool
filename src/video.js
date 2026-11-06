'use strict';
/* irlab editor: src/video.js. Build 298: video. Opening an MP4, MOV or WebM loads one frame as a still so every tool
   works as it does on a photo; "Export video" then runs the current settings over every frame in the browser and
   writes an MP4. Decoding uses the browser's own <video>, encoding uses WebCodecs, and the MP4 container comes from
   the MIT-licensed mp4-muxer (vendor/mp4-muxer.js, loaded only when a video is exported). */
let videoSrc = null;          /* { file, w, h, dur } while the open picture is a frame of a video, else null */
let videoStop = false, videoBusy = false;
let videoLogKind = '';
const VID_MAX = 1920;         /* the longest side is brought down to this: the processing is per frame, in the browser */

function videoIsFile(f) { return !!f && (/^video\//.test(f.type || '') || /\.(mp4|m4v|mov|webm)$/i.test(f.name || '')); }
function videoSize(v) {
  let w = v.videoWidth, h = v.videoHeight; const m = Math.max(w, h);
  if (m > VID_MAX) { const k = VID_MAX / m; w = Math.round(w * k); h = Math.round(h * k); }
  return [Math.max(2, w - (w % 2)), Math.max(2, h - (h % 2))];
}
function videoLoad(file) {
  return new Promise((res, rej) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.onloadeddata = () => res(v);
    v.onerror = () => rej(new Error('This browser cannot play that video file.'));
    v.src = URL.createObjectURL(file);
  });
}
function videoSeek(v, t) {
  return new Promise(r => {
    /* Seeking to where it already is fires no "seeked", so that case (and any seek that stalls) resolves on its own. */
    if (!v.seeking && Math.abs(v.currentTime - t) < 1e-4) { r(); return; }
    let tm = null;
    const done = () => { v.removeEventListener('seeked', done); clearTimeout(tm); r(); };
    v.addEventListener('seeked', done);
    tm = setTimeout(done, 4000);
    v.currentTime = t;
  });
}
/* Draws a frame of v into canvas c and returns the time used. A frame grabbed the instant a seek finishes can come back
   black (the picture has not been presented yet), and a clip can also open on black, so: wait for the frame to be shown,
   and if it is black, try a few other moments and keep the first one with something in it. */
async function videoGrab(v, c, dur) {
  const w = c.width, h = c.height, x = c.getContext('2d', { willReadFrequently: true });
  const lum = () => { try { const d = x.getImageData(0, 0, w, h).data; let s = 0, n = 0; for (let i = 0; i < d.length; i += 4 * 97) { s += d[i] + d[i + 1] + d[i + 2]; n += 3; } return s / n; } catch (e) { return 99; } };
  const tries = [Math.min(0.5, dur / 2), dur * 0.25, dur * 0.5, dur * 0.1, dur * 0.75, 0];
  let first = null;
  for (const t0 of tries) {
    const t = Math.max(0, Math.min(t0, Math.max(0, dur - 0.05)));
    const shown = videoShownTime(v, t); await videoSeek(v, t); await shown;
    x.drawImage(v, 0, 0, w, h);
    let l = lum();
    if (l < 2) { await vidSleep(250); x.drawImage(v, 0, 0, w, h); l = lum(); }
    if (first === null) first = t;
    if (l >= 2) return t;
  }
  return first === null ? 0 : first;
}
function videoUi() {
  const p = document.getElementById('vidPanel');
  if (p) p.style.display = videoSrc ? '' : 'none';
  const sc = document.getElementById('vidScrub'); if (sc && videoSrc) { sc.value = Math.round(1000 * (videoSrc.startT || 0) / (videoSrc.dur || 1)); videoScrubLabel(); }
  videoInfo();
}
/* One line about the clip: size, length, file size, and (measured by playing a few frames) the frame rate. */
async function videoInfo() {
  const el = document.getElementById('vidInfo'); if (!el || !videoSrc) return;
  const src = videoSrc, mb = (src.file.size / 1048576).toFixed(src.file.size > 1e7 ? 0 : 1);
  const base = src.w + '\u00d7' + src.h + ' \u00b7 ' + src.dur.toFixed(1) + ' s \u00b7 ' + mb + ' MB';
  el.textContent = base;
  try {
    if (src.meta == null) src.meta = await videoProbe(src.file);
    if (src.meta == null && src.fps == null) src.fps = await videoFps(src.el);
    if (videoSrc !== src) return;
    if (src.meta) el.textContent = base + ' \u00b7 ' + src.meta.fps.toFixed(src.meta.fps % 1 ? 2 : 0) + ' fps \u00b7 ' + src.meta.frames + ' frames \u00b7 ' + src.meta.codec;
    else el.textContent = base + ' \u00b7 about ' + src.fps + ' fps';
  } catch (e) { if (videoSrc === src) el.textContent = base; }
}
/* Exact frame rate, frame count and codec from the file's own index (MP4 and MOV), without reading any frames. */
async function videoProbe(file) {
  if (!/\.(mp4|m4v|mov)$/i.test(file.name || '') && !/mp4|quicktime/.test(file.type || '')) return null;
  try {
    await videoLoadScript('vendor/mp4box.all.min.js', 'MP4Box');
    const ab = await file.arrayBuffer();
    return await new Promise(res => {
      const mf = MP4Box.createFile();
      mf.onError = () => res(null);
      mf.onReady = i => { const t = i.videoTracks[0]; res(t && t.nb_samples && t.duration ? { fps: t.nb_samples / (t.duration / t.timescale), frames: t.nb_samples, codec: t.codec.split('.')[0] } : null); };
      ab.fileStart = 0; mf.appendBuffer(ab); mf.flush();
      setTimeout(() => res(null), 3000);
    });
  } catch (e) { return null; }
}
function vidEta(t0, done, total) {
  if (done < 3) return '';
  const left = Math.round((performance.now() - t0) / done * (total - done) / 1000);
  return ' \u00b7 ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') + ' left';
}
/* Called first thing by loadFile: a video becomes a still frame (and is remembered); anything else clears the video. */
async function videoIntercept(file) {
  if (!videoIsFile(file)) { if (videoSrc) { try { URL.revokeObjectURL(videoSrc.el.src); } catch (e) {} videoSrc = null; videoLogSet(''); videoUi(); } return file; }
  let v;
  try { v = await videoLoad(file); } catch (e) { alert(e.message + '\n\nTry an H.264 MP4 (the usual phone and camera format).'); return null; }
  if (!v.videoWidth || !v.videoHeight) { alert('This browser can play the sound of that file but cannot decode its video (often 10-bit or HEVC/H.265). Re-save it as an H.264 MP4, or open it in Safari or a browser with HEVC support.'); URL.revokeObjectURL(v.src); return null; }
  const dur = isFinite(v.duration) ? v.duration : 0;
  const [w, h] = videoSize(v);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = await videoGrab(v, c, dur);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.95));
  if (!blob) { URL.revokeObjectURL(v.src); alert('Could not read a frame from that video.'); return null; }
  if (videoSrc && videoSrc.el) { try { URL.revokeObjectURL(videoSrc.el.src); } catch (e) {} }
  videoSrc = { file, w, h, dur, el: v, startT: g };
  videoLogSet('');
  videoUi();
  if (typeof toast === 'function') toast('Video opened on one frame. Edit as usual, then Export video (Export tab).');
  return new File([blob], (file.name || 'video').replace(/\.\w+$/, '') + '-frame.jpg', { type: 'image/jpeg' });
}
/* Frame rate: play a few frames and read their media times; falls back to 30. */
async function videoFps(v) {
  if (!v.requestVideoFrameCallback) return 30;
  await videoSeek(v, 0);
  const ts = await new Promise(res => {
    const t = []; let done = false;
    const fin = () => { if (done) return; done = true; try { v.pause(); } catch (e) {} res(t); };
    const cb = (now, md) => { t.push(md.mediaTime); if (t.length < 12) v.requestVideoFrameCallback(cb); else fin(); };
    v.requestVideoFrameCallback(cb);
    v.play().catch(fin);
    setTimeout(fin, 1500);
  });
  const d = []; for (let i = 1; i < ts.length; i++) { const x = ts[i] - ts[i - 1]; if (x > 0.004) d.push(x); }
  if (d.length < 3) return 30;
  d.sort((a, b) => a - b);
  /* The shortest gaps, not the middle: a phone that cannot keep up skips frame callbacks, which only ever makes a gap
     longer, so the middle of the list can read a 60 fps clip as 30. */
  const f = 1 / d[Math.floor((d.length - 1) * 0.15)];
  const snaps = [24, 25, 30, 50, 60, 120]; let best = 30, bd = 1e9;
  snaps.forEach(s2 => { const e = Math.abs(f - s2) / s2; if (e < bd) { bd = e; best = s2; } });
  return bd < 0.06 ? best : Math.max(10, Math.min(120, Math.round(f)));
}
/* The time of the frame the video actually shows after a seek (its own clock, so a variable frame rate keeps its timing). */
function videoShownTime(v, fallback) {
  return new Promise(res => {
    if (!v.requestVideoFrameCallback) { res(fallback); return; }
    let d = false; const f = t => { if (!d) { d = true; res(t); } };
    v.requestVideoFrameCallback((n, md) => f(md.mediaTime));
    setTimeout(() => f(fallback), 500);
  });
}
function videoLoadMuxer() {
  if (window.Mp4Muxer) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'vendor/mp4-muxer.js';
    s.onload = () => (window.Mp4Muxer ? res() : rej(new Error('video writer missing')));
    s.onerror = () => rej(new Error('Could not load the video writer (are you offline?)'));
    document.head.appendChild(s);
  });
}
async function videoPickCodec(w, h, fps, bitrate) {
  const tries = [['avc1.640034', 'avc'], ['avc1.64002A', 'avc'], ['avc1.4D4028', 'avc'], ['avc1.42001F', 'avc'], ['vp09.00.40.08', 'vp9'], ['vp09.00.10.08', 'vp9']];
  for (const [codec, mux] of tries) {
    const cfg = { codec, width: w, height: h, bitrate, framerate: fps };
    try { const s = await VideoEncoder.isConfigSupported(cfg); if (s && s.supported) return { cfg, mux }; } catch (e) {}
  }
  return null;
}
/* Audio: decode the track and encode it again as AAC (or Opus). Returns null when the browser can't, so the video is
   still made, silent. */
async function videoAudioPrep(file) {
  try {
    if (!window.AudioEncoder || !window.AudioData) return null;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    const ac = new AC();
    let buf;
    try { buf = await ac.decodeAudioData((await file.arrayBuffer()).slice(0)); } finally { try { ac.close(); } catch (e) {} }
    if (!buf || !buf.length) return null;
    const ch = Math.min(2, buf.numberOfChannels), sr = buf.sampleRate;
    for (const [codec, mux] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
      const cfg = { codec, sampleRate: sr, numberOfChannels: ch, bitrate: 128000 };
      try { const s = await AudioEncoder.isConfigSupported(cfg); if (s && s.supported) return { buf, ch, sr, cfg, mux }; } catch (e) {}
    }
  } catch (e) {}
  return null;
}
async function videoAudioWrite(a, muxer) {
  let err = null;
  const enc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: e => { err = e; } });
  enc.configure(a.cfg);
  const step = 4800;
  for (let i = 0; i < a.buf.length && !err; i += step) {
    const n = Math.min(step, a.buf.length - i), data = new Float32Array(n * a.ch);
    for (let c = 0; c < a.ch; c++) data.set(a.buf.getChannelData(c).subarray(i, i + n), c * n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: a.sr, numberOfFrames: n, numberOfChannels: a.ch, timestamp: Math.round(i * 1e6 / a.sr), data });
    enc.encode(ad); ad.close();
    if (enc.encodeQueueSize > 30) await new Promise(r => setTimeout(r, 5));
  }
  await enc.flush(); enc.close();
  if (err) throw err;
}
/* Build 300: the frame-by-frame path. Seeking a <video> to each frame hands back stale frames now and then (about one in
   five on a phone clip: repeats followed by jumps, which is jerk), so MP4 and MOV files are read here instead: the file
   is taken apart with mp4box (BSD-3-Clause, vendor/mp4box.all.min.js), every video sample goes through the browser's
   own VideoDecoder in order, each frame keeps its real timestamp, and AAC audio is copied across untouched. */
function videoLoadScript(src, globalName) {
  if (window[globalName]) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src;
    s.onload = () => (window[globalName] ? res() : rej(new Error(src + ' missing')));
    s.onerror = () => rej(new Error('Could not load ' + src + ' (are you offline?)'));
    document.head.appendChild(s);
  });
}
async function videoDemux(file) {
  await videoLoadScript('vendor/mp4box.all.min.js', 'MP4Box');
  const ab = await file.arrayBuffer();
  return new Promise((res, rej) => {
    const mf = MP4Box.createFile(); let info = null; const out = { v: [], a: [] };
    mf.onError = e => rej(new Error('Could not read the file (' + e + ')'));
    mf.onReady = i => {
      info = i;
      const vt = i.videoTracks[0], at = i.audioTracks[0];
      if (!vt) { rej(new Error('No video track found')); return; }
      mf.setExtractionOptions(vt.id, 'v', { nbSamples: 1e9 });
      if (at) mf.setExtractionOptions(at.id, 'a', { nbSamples: 1e9 });
      mf.start();
    };
    mf.onSamples = (id, user, samples) => { for (const x of samples) out[user].push(x); };
    ab.fileStart = 0; mf.appendBuffer(ab); mf.flush();
    if (!info || !out.v.length) rej(new Error('No video samples found')); else res({ mf, info, out });
  });
}
function videoCodecDesc(mf, trackId) {
  const trak = mf.getTrackById(trackId);
  for (const e of trak.mdia.minf.stbl.stsd.entries) {
    const b = e.avcC || e.hvcC || e.av1C;
    if (b) { const ds = new DataStream(undefined, 0, DataStream.BIG_ENDIAN); b.write(ds); return new Uint8Array(ds.buffer, 8); }
  }
  return undefined;
}
function videoAacDesc(mf, trackId) {
  const trak = mf.getTrackById(trackId);
  for (const e of trak.mdia.minf.stbl.stsd.entries) {
    if (e.esds) { try { return new Uint8Array(e.esds.esd.descs[0].descs[0].data); } catch (x) {} }
  }
  return undefined;
}
const vidSleep = ms => new Promise(r => setTimeout(r, ms));
function vidStamp() { const d = new Date(), p2 = n => String(n).padStart(2, '0'); return d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()); }

/* Returns true when it handled the whole export, false when the caller should use the seeking path instead. */
async function videoExportDecoder(say) {
  if (!window.VideoDecoder || !window.EncodedVideoChunk || !/\.(mp4|m4v|mov)$/i.test(videoSrc.file.name || '') && !/mp4|quicktime/.test(videoSrc.file.type || '')) return false;
  let dm;
  try { dm = await videoDemux(videoSrc.file); } catch (e) { return false; }
  const { mf, info, out } = dm, vt = info.videoTracks[0], at = info.audioTracks[0];
  const dcfg = { codec: vt.codec, codedWidth: vt.video.width, codedHeight: vt.video.height, description: videoCodecDesc(mf, vt.id) };
  try { const sup = await VideoDecoder.isConfigSupported(dcfg); if (!sup || !sup.supported) return false; } catch (e) { return false; }
  /* display size: the picture is turned upright here, so portrait phone clips come out portrait with no rotation flag */
  const m = vt.matrix || [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824];
  const rot = ((Math.round(Math.atan2(m[1], m[0]) * 180 / Math.PI) % 360) + 360) % 360;
  const swap = rot === 90 || rot === 270;
  let sw = swap ? vt.video.height : vt.video.width, sh = swap ? vt.video.width : vt.video.height;
  const mx = Math.max(sw, sh), k = mx > VID_MAX ? VID_MAX / mx : 1;
  const w = Math.max(2, Math.round(sw * k) - (Math.round(sw * k) % 2)), h = Math.max(2, Math.round(sh * k) - (Math.round(sh * k) % 2));
  const vs = out.v, ts = vt.timescale;
  const spanUs = (vs[vs.length - 1].cts + vs[vs.length - 1].duration - vs[0].cts) * 1e6 / ts;
  const fps = Math.max(1, vs.length / (spanUs / 1e6));
  const bitrate = Math.max(2e6, Math.min(40e6, Math.round(w * h * fps * 0.12)));
  const pick = await videoPickCodec(w, h, Math.round(fps), bitrate);
  if (!pick) throw new Error('No video encoder this browser supports at ' + w + '×' + h + '.');
  /* audio: AAC is copied as it is; anything else is decoded and encoded again if the browser can, else left out */
  const aacOk = at && /^mp4a\.40/.test(at.codec) && videoAacDesc(mf, at.id);
  const audio = aacOk ? null : await videoAudioPrep(videoSrc.file);
  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: pick.mux, width: w, height: h, frameRate: Math.round(fps) },
    audio: aacOk ? { codec: 'aac', numberOfChannels: at.audio.channel_count, sampleRate: at.audio.sample_rate }
         : (audio ? { codec: audio.mux, numberOfChannels: audio.ch, sampleRate: audio.sr } : undefined),
    fastStart: 'in-memory', firstTimestampBehavior: 'offset'
  });
  let encErr = null, decErr = null;
  const enc = new VideoEncoder({ output: (c, mt) => muxer.addVideoChunk(c, mt), error: e => { encErr = e; } });
  enc.configure(pick.cfg);
  const fc = document.createElement('canvas'); fc.width = w; fc.height = h; const fx = fc.getContext('2d');
  const oc = document.createElement('canvas'); oc.width = w; oc.height = h; const ox = oc.getContext('2d');
  const keyEvery = Math.max(1, Math.round(fps * 2));
  let pending = 0, chain = Promise.resolve(), nOut = 0, firstTs = null; const t0 = performance.now();
  const draw = f => {
    fx.save();
    if (rot === 90) { fx.translate(w, 0); fx.rotate(Math.PI / 2); fx.drawImage(f, 0, 0, h, w); }
    else if (rot === 270) { fx.translate(0, h); fx.rotate(-Math.PI / 2); fx.drawImage(f, 0, 0, h, w); }
    else if (rot === 180) { fx.translate(w, h); fx.rotate(Math.PI); fx.drawImage(f, 0, 0, w, h); }
    else fx.drawImage(f, 0, 0, w, h);
    fx.restore();
  };
  const handle = async f => {
    try {
      if (videoStop || encErr) return;
      if (firstTs === null) firstTs = f.timestamp;
      draw(f);
      if (!(nOut > 0 && engine.updateFrame && engine.updateFrame(fc))) engine.setImage(fc);
      engine.render(currentParams());
      ox.drawImage(engine.canvas, 0, 0, w, h);
      const vf = new VideoFrame(oc, { timestamp: f.timestamp - firstTs, duration: f.duration || Math.round(1e6 / fps) });
      enc.encode(vf, { keyFrame: nOut % keyEvery === 0 }); vf.close(); nOut++;
      while (enc.encodeQueueSize > 6 && !encErr) await vidSleep(6);
      if (nOut % 3 === 0) { say('Exporting ' + Math.round(100 * nOut / vs.length) + '%' + vidEta(t0, nOut, vs.length) + ' · tap to stop'); await vidSleep(0); }
    } finally { f.close(); pending--; }
  };
  const dec = new VideoDecoder({ output: f => { pending++; chain = chain.then(() => handle(f)); }, error: e => { decErr = e; } });
  dec.configure(dcfg);
  for (const sm of vs) {
    while ((dec.decodeQueueSize > 8 || pending > 3) && !decErr && !encErr && !videoStop) await vidSleep(4);
    if (decErr || encErr || videoStop) break;
    dec.decode(new EncodedVideoChunk({ type: sm.is_sync ? 'key' : 'delta', timestamp: Math.round(sm.cts * 1e6 / ts), duration: Math.round(sm.duration * 1e6 / ts), data: sm.data }));
  }
  if (!decErr && !videoStop) { try { await dec.flush(); } catch (e) { decErr = decErr || e; } }
  await chain;
  try { dec.close(); } catch (e) {}
  if (decErr || encErr) { try { enc.close(); } catch (e) {} throw (decErr || encErr); }
  if (videoStop) { try { enc.close(); } catch (e) {} if (typeof toast === 'function') toast('Video export stopped'); return true; }
  await enc.flush(); enc.close();
  let audioNote = 'no audio';
  if (aacOk) {
    say('Adding audio…');
    const desc = videoAacDesc(mf, at.id), ats = at.timescale;
    const meta = { decoderConfig: { codec: at.codec, numberOfChannels: at.audio.channel_count, sampleRate: at.audio.sample_rate, description: desc } };
    out.a.forEach((sm, i) => muxer.addAudioChunkRaw(sm.data, sm.is_sync ? 'key' : 'delta', Math.round(sm.cts * 1e6 / ats), Math.round(sm.duration * 1e6 / ats), i === 0 ? meta : undefined));
    audioNote = 'audio kept as recorded';
  } else if (audio) {
    say('Adding audio…'); try { await videoAudioWrite(audio, muxer); audioNote = 'audio re-encoded'; } catch (e) {}
  }
  muxer.finalize();
  deliverBlob(new Blob([muxer.target.buffer], { type: 'video/mp4' }), 'channel-swap-' + vidStamp() + '.mp4');
  if (typeof toast === 'function') toast('Video saved · ' + nOut + ' frames, every frame decoded · ' + audioNote);
  return true;
}

async function videoExport() {
  const btn = document.getElementById('bVid');
  if (videoBusy) { videoStop = true; return; }
  if (!videoSrc || typeof engine === 'undefined' || !engine || !loadedImage) return;
  if (!window.VideoEncoder || !window.VideoFrame) {
    alert('This browser cannot write video (no WebCodecs). Use a recent Chrome, Edge or Safari.'); return;
  }
  videoBusy = true; videoStop = false;
  const label = btn ? btn.textContent : '';
  const say = t => { if (btn) btn.textContent = t; };
  let v = null, ok = false;
  try {
    say('Preparing…');
    await videoLoadMuxer();
    if (await videoExportDecoder(say)) { ok = true; return ok; }
    /* Fallback (WebM, or a browser that cannot decode this file itself): seek the <video> frame by frame. */
    v = await videoLoad(videoSrc.file);
    const [w, h] = videoSize(v), dur = v.duration;
    const fps = await videoFps(v), total = Math.max(1, Math.floor(dur * fps));
    const bitrate = Math.max(2e6, Math.min(40e6, Math.round(w * h * fps * 0.12)));
    const pick = await videoPickCodec(w, h, fps, bitrate);
    if (!pick) throw new Error('No video encoder this browser supports at ' + w + '×' + h + '.');
    const audio = await videoAudioPrep(videoSrc.file);
    const muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: pick.mux, width: w, height: h, frameRate: fps },
      audio: audio ? { codec: audio.mux, numberOfChannels: audio.ch, sampleRate: audio.sr } : undefined,
      fastStart: 'in-memory', firstTimestampBehavior: 'offset'
    });
    let encErr = null;
    const enc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { encErr = e; } });
    enc.configure(pick.cfg);
    const fc = document.createElement('canvas'); fc.width = w; fc.height = h;
    const fx = fc.getContext('2d');
    const oc = document.createElement('canvas'); oc.width = w; oc.height = h;
    const ox = oc.getContext('2d');
    const keyEvery = Math.max(1, Math.round(fps * 2)); let lastMt = -1, nOut = 0; const t0 = performance.now();
    for (let i = 0; i < total && !videoStop && !encErr; i++) {
      const tgt = Math.min((i + 0.25) / fps, Math.max(0, dur - 0.001));
      const shown = videoShownTime(v, tgt);
      await videoSeek(v, tgt);
      const mt = await shown;
      if (mt <= lastMt + 1e-4) continue;
      lastMt = mt;
      fx.drawImage(v, 0, 0, w, h);
      if (!(nOut > 0 && engine.updateFrame && engine.updateFrame(fc))) engine.setImage(fc);
      engine.render(currentParams());
      ox.drawImage(engine.canvas, 0, 0, w, h);
      const vf = new VideoFrame(oc, { timestamp: Math.round(mt * 1e6), duration: Math.round(1e6 / fps) });
      enc.encode(vf, { keyFrame: nOut % keyEvery === 0 }); vf.close(); nOut++;
      while (enc.encodeQueueSize > 6) await vidSleep(8);
      if (i % 3 === 0) { say('Exporting ' + Math.round(100 * i / total) + '%' + vidEta(t0, nOut, total) + ' · tap to stop'); await vidSleep(0); }
    }
    if (encErr) throw encErr;
    if (videoStop) { try { enc.close(); } catch (e) {} if (typeof toast === 'function') toast('Video export stopped'); return; }
    await enc.flush(); enc.close();
    let withAudio = false;
    if (audio) { say('Adding audio…'); try { await videoAudioWrite(audio, muxer); withAudio = true; } catch (e) {} }
    muxer.finalize();
    ok = true;
    deliverBlob(new Blob([muxer.target.buffer], { type: 'video/mp4' }), 'channel-swap-' + vidStamp() + '.mp4');
    if (typeof toast === 'function') toast('Video saved' + (withAudio ? '' : ' (no audio: this browser could not encode it)') + ' · ' + nOut + ' frames');
  } catch (e) {
    alert('Video export failed: ' + (e && e.message ? e.message : e));
  } finally {
    if (v) { try { URL.revokeObjectURL(v.src); } catch (e) {} }
    try { engine.setImage(typeof dustPrepare === 'function' ? dustPrepare(loadedImage) : loadedImage); render(); } catch (e) {}
    videoBusy = false; videoStop = false; if (btn) btn.textContent = label || 'Export video';
  }
  return ok;
}
document.addEventListener('DOMContentLoaded', () => { const b = document.getElementById('bVid'); if (b) b.onclick = videoExport; videoUi(); });
if (document.readyState !== 'loading') { const b = document.getElementById('bVid'); if (b) b.onclick = videoExport; videoUi(); }

/* Build 301: camera log input. A log clip (F-Log, F-Log2, S-Log3, LogC3) is a flat picture whose values are not light.
   A 3D lookup table made from the published curve turns it into a normal picture at the very start of the pipeline (the
   early-LUT stage), so the swap and white balance work on real light. Scene light is mapped straight to sRGB with
   middle grey kept at 18%, clipped at white; bring highlights down with Exposure if the log clip carries more. */
const VID_LOG = {
  flog:  y => y >= 0.100537775223865 ? (Math.pow(10, (y - 0.790453) / 0.344676) - 0.009468) / 0.555556 : (y - 0.092864) / 8.735631,
  flog2: y => y >= 0.100686685370811 ? (Math.pow(10, (y - 0.384316) / 0.245281) - 0.064829) / 5.555556 : (y - 0.092864) / 8.799461,
  slog3: y => { const c = y * 1023; return y >= 171.2102946929 / 1023 ? (Math.pow(10, (c - 420) / 261.5)) * 0.19 - 0.01 : (c - 95) * 0.01125 / (171.2102946929 - 95); },
  logc3: t => t > 5.367655 * 0.010591 + 0.092809 ? (Math.pow(10, (t - 0.385537) / 0.24719) - 0.052272) / 5.555556 : (t - 0.092809) / 5.367655
};
function videoLogLUT(kind) {
  const f = VID_LOG[kind]; if (!f) return null;
  const N = 65, curve = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let L = f(i / (N - 1)); L = Math.max(0, Math.min(1, L));
    curve[i] = L <= 0.0031308 ? 12.92 * L : 1.055 * Math.pow(L, 1 / 2.4) - 0.055;
  }
  const data = new Float32Array(N * N * N * 3);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const o = ((z * N + y) * N + x) * 3; data[o] = curve[x]; data[o + 1] = curve[y]; data[o + 2] = curve[z];
  }
  return { size: N, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data };
}
function videoLogSet(kind) {
  videoLogKind = kind || '';
  const sel = document.getElementById('vidLog'); if (sel && sel.value !== videoLogKind) sel.value = videoLogKind;
  if (typeof engine === 'undefined' || !engine) { preLUTUser = null; return; }
  preLUTUser = videoLogLUT(videoLogKind);
  try { engine.setLUTPre(preLUTUser || decodeFilmLUT()); render(); } catch (e) {}
}
function videoScrubLabel() {
  const sc = document.getElementById('vidScrub'), l = document.getElementById('v_vidScrub');
  if (sc && l && videoSrc) l.textContent = (videoSrc.dur * sc.value / 1000).toFixed(1) + ' s';
}
let videoScrubBusy = false, videoScrubAgain = false;
async function videoScrubTo() {
  if (!videoSrc || !videoSrc.el || videoBusy) return;
  if (videoScrubBusy) { videoScrubAgain = true; return; }
  videoScrubBusy = true;
  try {
    do {
      videoScrubAgain = false;
      const sc = document.getElementById('vidScrub'), v = videoSrc.el;
      const t = Math.min(videoSrc.dur * sc.value / 1000, Math.max(0, videoSrc.dur - 0.001));
      const shown = videoShownTime(v, t); await videoSeek(v, t); await shown;
      const cv = (typeof rawCanvas !== 'undefined') ? rawCanvas : null; if (!cv) break;
      cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
      engine.setImage(typeof dustPrepare === 'function' ? dustPrepare(cv) : cv);
      render();
    } while (videoScrubAgain);
  } catch (e) {} finally { videoScrubBusy = false; }
}
(function videoWire() {
  const go = () => {
    const sel = document.getElementById('vidLog'), sc = document.getElementById('vidScrub');
    if (sel) sel.onchange = () => videoLogSet(sel.value);
    if (sc) { sc.oninput = () => { videoScrubLabel(); videoScrubTo(); }; }
  };
  if (document.readyState !== 'loading') go(); else document.addEventListener('DOMContentLoaded', go);
})();
