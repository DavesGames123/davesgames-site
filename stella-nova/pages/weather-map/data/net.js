// WEATHER MAP · data/net.js — shared fetch, cache and sample helpers for
// every loader in data/. No DOM. The same code runs in node and in the
// browser.
//
// grep -n targets:
//   fetchText / fetchJSON   GET with a timeout; reads the whole body, never
//                           sizes a buffer from content-length
//   cacheGet / cacheSet     sessionStorage JSON with a max age (try/catch)
//   readSample              data/sample/<name>; fetch in the browser, fs in node
//   CACHE_MS                20 min cache age from CONTRACT.md

export const CACHE_MS = 20 * 60 * 1000;
export const TIMEOUT_MS = 15000;
const PREFIX = 'wx:v1:';

// Browsers do not let a page set User-Agent. Node tools pass opts.headers
// with the site UA ('davesgames.io weather-map'), never a personal email.
export async function fetchText(url, opts = {}) {
  const f = opts.fetch || globalThis.fetch;
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), opts.timeout || TIMEOUT_MS) : 0;
  try {
    const res = await f(url, { headers: opts.headers || {}, signal: ac ? ac.signal : undefined });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally { if (timer) clearTimeout(timer); }
}

export async function fetchJSON(url, opts = {}) {
  return JSON.parse(await fetchText(url, opts));
}

function store() {
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; }
}

export function cacheGet(key, maxAge = CACHE_MS, now = Date.now()) {
  try {
    const s = store(); if (!s) return null;
    const raw = s.getItem(PREFIX + key); if (!raw) return null;
    const rec = JSON.parse(raw);
    if (!rec || typeof rec.at !== 'number' || now - rec.at > maxAge) return null;
    return rec.v;
  } catch { return null; }
}

export function cacheSet(key, value, now = Date.now()) {
  try { const s = store(); if (s) s.setItem(PREFIX + key, JSON.stringify({ at: now, v: value })); } catch { /* quota or blocked */ }
}

export function sampleUrl(name) { return new URL(`./sample/${name}`, import.meta.url); }

// Node cannot fetch file: URLs, so read them with fs there.
export async function readSample(name, opts = {}) {
  const url = sampleUrl(name);
  if (url.protocol === 'file:') {
    const fs = await import('node:fs/promises');
    return fs.readFile(url, 'utf8');
  }
  return fetchText(url.href, opts);
}

export async function readSampleJSON(name, opts = {}) { return JSON.parse(await readSample(name, opts)); }


