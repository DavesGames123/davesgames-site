// ui/io.js — Mandelbulber page: .fract import and export, and the share link in the URL hash.
//
// Import reads an upstream .fract file from the file field or a drop on the page.
// Export writes the params that differ from the defaults, as upstream does. The share
// link holds the same diff text, deflated and base64url, in #s=. writeHash updates the
// URL 400 ms after the last change; readHash reads a link at boot.
//
// grep: function loadText  function exportText  function exportFract  function initIo  function shareHash
//       function decodeShare  function writeHash  function readHash  function copyLink

import { defaultScene, parseFract, serialiseFract } from '../fract.js';
import { $, stage, download } from './dom.js';
import { P, EXAMPLES, isNone } from './data.js';
import { scene, currentExample, setCurrentExample, formulaAt } from './state.js';
import { flash } from './hud.js';
import { loadScene } from './scene.js';
import { markExample } from './panel.js';

export function loadText(text, name = 'file') {
  const { scene: sc, meta } = parseFract(text, P);
  setCurrentExample(-1);
  markExample();
  loadScene(sc, `${name}: loaded${meta.skipped.length ? `, ${meta.skipped.length} params not supported` : ''}`);
  if (meta.skipped.length) console.info('[mandelbulber] params not supported:', meta.skipped.join(' '));
  return meta;
}

export function exportText() { return serialiseFract(scene, P); }

export function exportFract() {
  const f = formulaAt(0);
  const base = currentExample >= 0 ? EXAMPLES[currentExample].name : (isNone(f) ? 'scene' : f.id);
  download(new Blob([exportText()], { type: 'text/plain' }), `${base}.fract`);
}

let dragDepth = 0;

export function initIo() {
  $('file').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (f) loadText(await f.text(), f.name);
    e.target.value = '';
  });
  window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; stage.classList.add('dropping'); } });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; stage.classList.remove('dropping'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    stage.classList.remove('dropping');
    const f = e.dataTransfer?.files?.[0];
    if (f) loadText(await f.text(), f.name);
  });
}

// Share: the .fract diff text, deflated, base64url, in #s=
const b64url = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }

export async function shareHash(sc = scene) {
  const body = (x) => serialiseFract(x, P).split('\n').filter((l) => l && !l.startsWith('#')).join('\n');
  const text = body(sc);
  if (text === body(defaultScene(P))) return '';
  return `s=${b64url(await pipe(new TextEncoder().encode(text), new CompressionStream('deflate-raw')))}`;
}

export async function decodeShare(hash) {
  const m = String(hash).match(/(?:^|[#&])s=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  const text = new TextDecoder().decode(await pipe(unb64url(m[1]), new DecompressionStream('deflate-raw')));
  return parseFract(`# version 2.33\n${text}`, P).scene;
}

let hashTimer = 0;
export function writeHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(async () => {
    const h = await shareHash();
    history.replaceState(null, '', h ? `#${h}` : location.pathname + location.search);
  }, 400);
}

export async function readHash() {
  try { return await decodeShare(location.hash); } catch (e) { console.warn('[mandelbulber] bad share link', e); return null; }
}

export async function copyLink() {
  clearTimeout(hashTimer);
  const h = await shareHash();
  history.replaceState(null, '', h ? `#${h}` : location.pathname + location.search);
  try { await navigator.clipboard.writeText(location.href); flash('link copied'); } catch { flash('copy the link from the address bar'); }
}
