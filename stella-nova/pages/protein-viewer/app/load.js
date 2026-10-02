// ============================================================================
//  PROTEIN VIEWER  ·  app/load.js — presets, PDB and UniProt IDs, files, paste
// ────────────────────────────────────────────────────────────────────────────
//  All loads go through parse() and setStructure(). S.token cancels a
//  load that a newer load has replaced. Gzip data is decoded here.
//
//  GREP MAP
//    const UNIPROT                         accession pattern
//    function decodeBytes / fetchText      bytes, gzip and fetch with timeout
//    function loadPreset / loadText / loadFile   the load paths
//    function fetchId                      RCSB, then AlphaFold DB
//    dragenter / drop                      drop a file on the page
// ============================================================================
import { parse } from '../parse.js';
import { byId } from '../presets.js';
import { $, PHONE_Q } from './env.js';
import { S, isPolymer } from './state.js';
import { hideLoading, nextFrame, showLoading, toast } from './feedback.js';
import { setStructure } from './structure.js';
import { setOpen } from './panel.js';
import { markPreset } from './ui.js';

const UNIPROT = /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})$/;

// ── loading ───────────────────────────────────────────────────────────────
async function decodeBytes(buf) {
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot read gzip files');
    const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    buf = new Uint8Array(await new Response(ds).arrayBuffer());
  }
  return new TextDecoder('latin1').decode(buf);
}
async function fetchText(url, timeout = 30000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await decodeBytes(new Uint8Array(await r.arrayBuffer()));
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('the request timed out');
    throw e;
  } finally { clearTimeout(t); }
}

export async function loadPreset(id) {
  const p = byId(id);
  if (!p) return;
  const token = ++S.token;
  showLoading(`Loading ${p.code}…`);
  markPreset(p.id);
  try {
    const text = await fetchText('data/' + p.file);
    if (token !== S.token) return;
    await nextFrame();
    const s = parse(text, p.code);
    if (token !== S.token) return;
    setStructure(s, p);
    // the screensaver (S.saver) does not write the URL hash
    if (!S.saver) try { history.replaceState(null, '', '#' + p.id); } catch (e) { /* sandboxed */ }
  } catch (e) {
    if (token === S.token) toast(`Could not load ${p.code}: ${e.message}`, true);
  } finally { if (token === S.token) hideLoading(); }
}

export async function loadText(text, name) {
  const token = ++S.token;
  showLoading(`Reading ${name}…`);
  await nextFrame();
  try {
    const s = parse(text, name);
    if (token !== S.token) return;
    markPreset(null);
    setStructure(s, null);
    toast(`${name}: ${s.atoms.length.toLocaleString()} atoms, ${s.residues.filter(isPolymer).length.toLocaleString()} residues`);
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* sandboxed */ }
    return true;
  } catch (e) {
    toast(`Could not read ${name}: ${e.message}`, true);
    return false;
  } finally { if (token === S.token) hideLoading(); }
}

// RCSB for 4-character IDs, AlphaFold DB for UniProt accessions
export async function fetchId(q) {
  const note = $('fetchNote');
  const id = q.trim().toUpperCase().replace(/^AF-/, '').replace(/-F\d+.*$/, '');
  const say = (msg, cls = '') => { note.textContent = msg; note.className = 'note ' + cls; };
  if (!id) return;
  let urls, label;
  if (/^[0-9][A-Z0-9]{3}$/.test(id)) {
    label = id;
    urls = [`https://files.rcsb.org/download/${id}.cif`, `https://files.rcsb.org/download/${id}.pdb`];
  } else if (UNIPROT.test(id)) {
    label = 'AF-' + id;
    urls = [];
    try {
      const r = await fetch(`https://alphafold.ebi.ac.uk/api/prediction/${id}`);
      if (r.ok) { const j = await r.json(); const e = Array.isArray(j) ? j[0] : j; if (e && e.pdbUrl) urls.push(e.pdbUrl); if (e && e.cifUrl) urls.push(e.cifUrl); }
    } catch (e) { /* fall back to the file names */ }
    for (const v of [6, 5, 4]) urls.push(`https://alphafold.ebi.ac.uk/files/AF-${id}-F1-model_v${v}.pdb`);
  } else {
    say('Enter a 4-character PDB ID (for example 1U19) or a UniProt accession (for example P04637).', 'err');
    return;
  }
  const btn = $('fetchBtn');
  btn.disabled = true;
  say(`Fetching ${label}…`);
  showLoading(`Fetching ${label}…`);
  let lastErr = null;
  for (const u of urls) {
    try {
      const text = await fetchText(u);
      hideLoading();
      if (await loadText(text, label)) { say(`Loaded ${label} from ${new URL(u).host}.`, 'ok'); if (PHONE_Q.matches) setOpen(false); }
      btn.disabled = false;
      return;
    } catch (e) { lastErr = e; }
  }
  hideLoading();
  btn.disabled = false;
  const why = lastErr && /HTTP 404/.test(lastErr.message) ? 'no entry with that ID was found' : navigator.onLine === false ? 'you appear to be offline' : (lastErr ? lastErr.message : 'unknown error');
  say(`Could not fetch ${label}: ${why}. The presets work offline.`, 'err');
  toast(`Could not fetch ${label}: ${why}`, true);
}

export async function loadFile(f) {
  if (f.size > 120e6) { toast('That file is over 120 MB, which is too large to show here', true); return; }
  try {
    const text = await decodeBytes(new Uint8Array(await f.arrayBuffer()));
    if (await loadText(text, f.name.replace(/\.(gz)$/i, '').replace(/\.(pdb|ent|cif|mmcif|txt)$/i, '')) && PHONE_Q.matches) setOpen(false);
  } catch (e) { toast(`Could not read ${f.name}: ${e.message}`, true); }
}

// drag and drop a file anywhere
let dragDepth = 0;
window.addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; $('drop').hidden = false; e.preventDefault(); } });
window.addEventListener('dragover', e => { if (!$('drop').hidden) e.preventDefault(); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
window.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; $('drop').hidden = true;
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) loadFile(f);
});
