'use strict';
/* irlab editor: src/video.js. Build 298: video. Opening an MP4, MOV or WebM loads one frame as a still so every tool
   works as it does on a photo; "Export video" then runs the current settings over every frame in the browser and
   writes an MP4. Decoding uses the browser's own <video>, encoding uses WebCodecs, and the MP4 container comes from
   the MIT-licensed mp4-muxer (vendor/mp4-muxer.js, loaded only when a video is exported). */
let videoSrc = null;          /* { file, w, h, dur } while the open picture is a frame of a video, else null */
let videoStop = false, videoBusy = false;
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
    const done = () => { v.removeEventListener('seeked', done); r(); };
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });
}
function videoUi() {
  const b = document.getElementById('bVid'), n = document.getElementById('vidNote');
  if (b) b.style.display = videoSrc ? '' : 'none';
  if (n) n.style.display = videoSrc ? '' : 'none';
}
/* Called first thing by loadFile: a video becomes a still frame (and is remembered); anything else clears the video. */
async function videoIntercept(file) {
  if (!videoIsFile(file)) { if (videoSrc) { videoSrc = null; videoUi(); } return file; }
  let v;
  try { v = await videoLoad(file); } catch (e) { alert(e.message + '\n\nTry an H.264 MP4 (the usual phone and camera format).'); return null; }
  const dur = isFinite(v.duration) ? v.duration : 0;
  await videoSeek(v, Math.min(0.5, dur / 2));
  const [w, h] = videoSize(v);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(v, 0, 0, w, h);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.95));
  URL.revokeObjectURL(v.src);
  if (!blob) { alert('Could not read a frame from that video.'); return null; }
  videoSrc = { file, w, h, dur };
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
  const f = 1 / d[d.length >> 1];
  const snaps = [24, 25, 30, 50, 60]; let best = 30, bd = 1e9;
  snaps.forEach(s => { const e = Math.abs(f - s); if (e < bd) { bd = e; best = s; } });
  return bd < 2.5 ? best : Math.max(10, Math.min(60, Math.round(f)));
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
    const keyEvery = Math.max(1, Math.round(fps * 2));
    for (let i = 0; i < total && !videoStop && !encErr; i++) {
      await videoSeek(v, Math.min(i / fps, Math.max(0, dur - 0.001)));
      fx.drawImage(v, 0, 0, w, h);
      engine.setImage(fc);
      engine.render(currentParams());
      const vf = new VideoFrame(engine.canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      enc.encode(vf, { keyFrame: i % keyEvery === 0 }); vf.close();
      while (enc.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 8));
      if (i % 3 === 0) { say('Exporting ' + Math.round(100 * i / total) + '% · tap to stop'); await new Promise(r => setTimeout(r, 0)); }
    }
    if (encErr) throw encErr;
    if (videoStop) { try { enc.close(); } catch (e) {} if (typeof toast === 'function') toast('Video export stopped'); return; }
    await enc.flush(); enc.close();
    let withAudio = false;
    if (audio) { say('Adding audio…'); try { await videoAudioWrite(audio, muxer); withAudio = true; } catch (e) {} }
    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    ok = true;
    const d = new Date(), p2 = n => String(n).padStart(2, '0');
    deliverBlob(blob, 'channel-swap-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + '.mp4');
    if (typeof toast === 'function') toast('Video saved' + (withAudio ? '' : ' (no audio: this browser could not encode it)') + ' · ' + total + ' frames at ' + fps + ' fps');
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
