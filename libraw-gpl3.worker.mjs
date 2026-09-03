// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phil Warren
//
// Web Worker entry point. Runs the LibRaw unpack + demosaic off the main
// thread so a full-sensor pass never blocks the UI. Instantiate it as a
// MODULE worker:
//
//   new Worker(new URL('./libraw-gpl3.worker.mjs', import.meta.url),
//              { type: 'module' });
//
// Prefer the client wrapper in libraw-gpl3.client.mjs rather than talking to
// this file directly.

import { decodeAndDemosaic } from './worker-core.mjs';

self.onmessage = async (e) => {
  const { id, bytes, qual } = e.data || {};
  try {
    const { meta, R, G, B } = await decodeAndDemosaic(bytes, qual);
    // Transfer the plane buffers back rather than copying them.
    self.postMessage({ id, ok: true, meta, R, G, B }, [R.buffer, G.buffer, B.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
