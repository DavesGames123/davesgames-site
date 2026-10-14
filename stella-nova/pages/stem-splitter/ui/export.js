// ============================================================================
//  STEM SPLITTER  ·  ui/export.js — file names, "No vocals" sum, zip, save
// ----------------------------------------------------------------------------
//  File names follow CONTRACT 2.6: <song>_<stem>.wav, <song>_no_vocals.wav
//  (the Demucs --two-stems name) and <song>_stems.zip. The zip uses JSZip
//  (vendored, window.JSZip) with STORE, because WAV data does not compress.
//
//  The "No vocals" file is the sum of all stems except vocals, before the
//  clip rule. stemToWav (wav.js) then rescales the sum like any other file.
//
//  GREP MAP
//    songBase .......... file name -> safe song name (no extension)
//    stemFileName ...... <song>_<stem>.wav
//    noVocalsName ...... <song>_no_vocals.wav
//    zipName ........... <song>_stems.zip
//    sumStems .......... sum of the stems, float64 accumulate
//    buildZip .......... JSZip STORE archive of { name, bytes }[]
//    saveBlob .......... browser download through a temporary <a download>
// ============================================================================

export function songBase(fileName) {
  let s = String(fileName || '').replace(/\.[A-Za-z0-9]{1,5}$/, '');
  s = s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim();
  if (s.length > 80) s = s.slice(0, 80).trim();
  return s || 'song';
}

export const stemFileName = (song, stem) => `${song}_${stem}.wav`;
export const noVocalsName = song => `${song}_no_vocals.wav`;
export const zipName = song => `${song}_stems.zip`;

// stems: { name: [L, R] }. Returns [L, R] Float32Array of the stems that are
// not in `exclude`.
export function sumStems(stems, exclude = ['vocals']) {
  const names = Object.keys(stems).filter(n => !exclude.includes(n));
  if (!names.length) throw new Error('no stems to sum');
  const n = stems[names[0]][0].length;
  const out = [new Float32Array(n), new Float32Array(n)];
  const acc = new Float64Array(n);
  for (let c = 0; c < 2; c++) {
    acc.fill(0);
    for (const k of names) { const ch = stems[k][c]; for (let i = 0; i < n; i++) acc[i] += ch[i]; }
    out[c].set(acc);
  }
  return out;
}

// files: [{ name, bytes: Uint8Array }]. type: 'blob' in the browser,
// 'uint8array' in the tests.
export async function buildZip(JSZip, files, type = 'blob') {
  if (typeof JSZip !== 'function') throw new Error('JSZip is not loaded');
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.bytes, { binary: true, compression: 'STORE' });
  return zip.generateAsync({ type, compression: 'STORE', mimeType: 'application/zip' });
}

// Browser only: starts a download of `blob` as `name`.
export function saveBlob(blob, name, doc = document) {
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
