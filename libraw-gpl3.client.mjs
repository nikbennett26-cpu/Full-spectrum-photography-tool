// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phil Warren
//
// Main-thread client for the RAW demosaic Web Worker. Spawns the module
// worker lazily on first use, and exposes a Promise-based API. Input bytes
// and output planes are passed by transfer (zero-copy) in both directions.
//
//   import { demosaicRawInWorker } from './libraw-gpl3.client.mjs';
//   const img = await demosaicRawInWorker(fileBytes, 'amaze');
//   // img = { width, height, cfa, black, white, camMul, rgbCam, qual, R, G, B }

let worker = null;
let seq = 0;
const pending = new Map();

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./libraw-gpl3.worker.mjs', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const { id, ok, meta, R, G, B, error } = e.data || {};
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) p.resolve({ ...meta, R, G, B });
    else p.reject(new Error(error || 'demosaic failed'));
  };
  worker.onerror = (e) => {
    const err = new Error((e && e.message) || 'worker crashed');
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    // Force a fresh worker on the next call.
    try { worker.terminate(); } catch { /* ignore */ }
    worker = null;
  };
  return worker;
}

// Decode + demosaic a RAW file. `bytes` may be a Uint8Array or ArrayBuffer;
// its underlying buffer is transferred to the worker and left detached here.
export function demosaicRawInWorker(bytes, qual = 'amaze') {
  const w = ensureWorker();
  const buf = bytes instanceof Uint8Array ? bytes.buffer : bytes;
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, bytes: buf, qual }, [buf]);
  });
}

// Tear the worker down (e.g. when leaving a RAW-editing view).
export function disposeWorker() {
  if (worker) {
    try { worker.terminate(); } catch { /* ignore */ }
    worker = null;
  }
  pending.clear();
}
