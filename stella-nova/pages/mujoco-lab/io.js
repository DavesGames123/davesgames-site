// ============================================================================
//  MUJOCO LAB  ·  io.js — MJCF text tools and "load your own model"
// ----------------------------------------------------------------------------
//  highlightXML gives HTML for the editor underlay (tags, attributes,
//  values, comments). pickMain chooses the top MJCF file of a set: the one
//  that no other file includes, with scene*.xml first. readUpload reads
//  files from an <input type=file> or a drop: one .zip (JSZip, vendored,
//  loaded on demand) or loose .xml, mesh and texture files. The VFS paths
//  are relative to the folder of the top MJCF file.
//
//  GREP MAP
//    export function highlightXML ... MJCF text -> HTML with token spans
//    export function pickMain ....... { path: text } -> top MJCF path
//    export function rebase ......... paths relative to the top file folder
//    export async function readUpload  File list -> { xml, files, name }
//    function loadJSZip ............. vendor/jszip@3.10.1, one script tag
// ============================================================================
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function highlightXML(text) {
  let out = '', i = 0;
  const re = /<!--[\s\S]*?(?:-->|$)|<\/?[A-Za-z_][\w:.-]*|\/?>|"[^"<]*"?|'[^'<]*'?|[A-Za-z_][\w:.-]*(?==)/g;
  let inTag = false, m;
  while ((m = re.exec(text))) {
    const t = m[0];
    if (!inTag && (t[0] === '"' || t[0] === "'" || /^[A-Za-z_]/.test(t))) continue;   // text between tags
    out += esc(text.slice(i, m.index));
    if (t.startsWith('<!--')) out += `<span class="xc">${esc(t)}</span>`;
    else if (t[0] === '<') { out += `<span class="xt">${esc(t)}</span>`; inTag = true; }
    else if (t === '>' || t === '/>') { out += `<span class="xt">${esc(t)}</span>`; inTag = false; }
    else if (t[0] === '"' || t[0] === "'") out += `<span class="xv">${esc(t)}</span>`;
    else out += `<span class="xa">${esc(t)}</span>`;
    i = m.index + t.length;
  }
  return out + esc(text.slice(i)) + '\n';
}

const isXML = p => /\.xml$/i.test(p);
const dirOf = p => (p.lastIndexOf('/') >= 0 ? p.slice(0, p.lastIndexOf('/') + 1) : '');

// texts: { path: string } for the .xml files. Returns the top path or null.
export function pickMain(texts) {
  const paths = Object.keys(texts).filter(p => isXML(p) && /<mujoco\b/.test(texts[p]) && !/(^|\/)(__MACOSX|\.)/.test(p));
  if (!paths.length) return null;
  const included = new Set();
  for (const p of paths) for (const m of texts[p].matchAll(/<include\s+file="([^"]+)"/g)) included.add(norm(dirOf(p) + m[1]));
  const tops = paths.filter(p => !included.has(norm(p)));
  const pool = tops.length ? tops : paths;
  const score = p => (/(^|\/)scene[^/]*\.xml$/i.test(p) ? 0 : 1) * 100 + p.split('/').length * 10 + p.length / 1000;
  return pool.sort((a, b) => score(a) - score(b))[0];
}
function norm(p) {
  const out = [];
  for (const s of p.split('/')) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); }
  return out.join('/');
}
// files: { path: data }, main: path -> { xml, files } with paths relative to dirOf(main)
export function rebase(all, main) {
  const d = dirOf(main), files = {};
  for (const p in all) {
    if (p === main) continue;
    if (d && p.startsWith(d)) files[p.slice(d.length)] = all[p];
    else if (!d) files[p] = all[p];
    else files['../'.repeat(d.split('/').length - 1) + p] = all[p];
  }
  return files;
}

let jszip = null;
function loadJSZip() {
  if (globalThis.JSZip) return Promise.resolve(globalThis.JSZip);
  if (jszip) return jszip;
  jszip = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = new URL('../../vendor/jszip@3.10.1/dist/jszip.min.js', import.meta.url).href;
    s.onload = () => res(globalThis.JSZip); s.onerror = () => { jszip = null; rej(new Error('Could not load the zip reader')); };
    document.head.appendChild(s);
  });
  return jszip;
}

const MAX = 64 * 1024 * 1024;
// list: File[] (from an input or a drop) -> { xml, files, name, main }
export async function readUpload(list) {
  const all = {}, texts = {};
  let size = 0;
  for (const f of list) {
    size += f.size;
    if (size > MAX) throw new Error('The files are larger than 64 MB.');
    if (/\.zip$/i.test(f.name)) {
      const JSZip = await loadJSZip();
      const z = await JSZip.loadAsync(await f.arrayBuffer());
      const ents = Object.values(z.files).filter(e => !e.dir && !/(^|\/)(__MACOSX|\.DS_Store)/.test(e.name));
      for (const e of ents) {
        if (isXML(e.name)) { texts[e.name] = await e.async('string'); all[e.name] = texts[e.name]; }
        else all[e.name] = await e.async('uint8array');
      }
    } else {
      const p = f.webkitRelativePath || f.name;
      if (isXML(p)) { texts[p] = await f.text(); all[p] = texts[p]; }
      else all[p] = new Uint8Array(await f.arrayBuffer());
    }
  }
  const main = pickMain(texts);
  if (!main) throw new Error('No MJCF file (an .xml file with a <mujoco> element) is in the selection.');
  return { xml: texts[main], files: rebase(all, main), main, name: main.split('/').pop().replace(/\.xml$/i, '') };
}
