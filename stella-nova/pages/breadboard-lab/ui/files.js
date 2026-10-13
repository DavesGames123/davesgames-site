// ============================================================================
//  BREADBOARD LAB  ·  ui/files.js — saved benches, autosave, local libraries
// ----------------------------------------------------------------------------
//  Every storage access is inside try/catch (CONTRACT 0): Safari's private
//  mode, a full quota or a blocked storage all throw. When the browser store
//  fails, the data goes into an in-memory store, so the session still works,
//  and the call reports { ok: true, persisted: false } so the FILE panel can
//  say "kept for this visit only".
//
//  Keys (all under 'bblab:'):
//    bblab:files ........ { [name]: { t, doc } }
//    bblab:autosave ..... { t, doc }
//    bblab:materials .... MaterialSpec[] (the local material library)
//    bblab:parts ........ PartDef[] (the local part library)
//
//  GREP MAP
//    safeStorage ....... a storage wrapper that never throws
//    createFiles ....... list / save / load / remove / autosave / libraries
//    exportJSON ........ the file a person downloads
//    parseJSON ......... text -> { kind, doc|def|spec|legacy, error }
//    download / pickFile  the DOM side (a Blob link, a file input)
// ============================================================================

export function safeStorage(backing) {
  let ls = backing;
  if (ls === undefined) { try { ls = globalThis.localStorage; } catch (e) { ls = null; } }
  const mem = new Map();
  let broken = !ls;
  const S = {
    get(k) {
      if (mem.has(k)) return mem.get(k);
      if (broken) return null;
      try { return ls.getItem(k); } catch (e) { broken = true; return null; }
    },
    set(k, v) {
      if (!broken) {
        try { ls.setItem(k, v); mem.delete(k); return true; } catch (e) { /* quota or blocked: keep it in memory */ }
      }
      mem.set(k, v);
      return false;
    },
    remove(k) { mem.delete(k); if (!broken) { try { ls.removeItem(k); } catch (e) { /* ignore */ } } },
    get persistent() { return !broken; }
  };
  return S;
}

const K = { files: 'bblab:files', auto: 'bblab:autosave', mats: 'bblab:materials', parts: 'bblab:parts' };
const readJSON = (S, k, dflt) => { try { const v = S.get(k); return v ? JSON.parse(v) : dflt; } catch (e) { return dflt; } };

export function createFiles({ storage } = {}) {
  const S = storage && storage.get ? storage : safeStorage(storage);
  const put = (k, v) => { try { return S.set(k, JSON.stringify(v)); } catch (e) { return false; } };
  return {
    storage: S,
    list() {
      const m = readJSON(S, K.files, {});
      return Object.entries(m).map(([name, r]) => ({ name, t: r.t || 0, parts: (r.doc && r.doc.parts || []).length, title: r.doc && r.doc.title })).sort((a, b) => b.t - a.t);
    },
    save(name, doc) {
      name = String(name || '').trim();
      if (!name) return { ok: false, error: 'a name is needed' };
      const m = readJSON(S, K.files, {});
      m[name] = { t: Date.now(), doc };
      const persisted = put(K.files, m);
      return { ok: true, persisted };
    },
    load(name) { const m = readJSON(S, K.files, {}); return m[name] ? m[name].doc : null; },
    remove(name) { const m = readJSON(S, K.files, {}); delete m[name]; put(K.files, m); },
    autosave(doc) { return put(K.auto, { t: Date.now(), doc }); },
    loadAutosave() { const r = readJSON(S, K.auto, null); return r && r.doc ? r.doc : null; },
    libMaterials() { return readJSON(S, K.mats, []); },
    saveLibMaterial(spec) {
      const L = readJSON(S, K.mats, []).filter(m => m.id !== spec.id);
      L.push(spec); return put(K.mats, L);
    },
    removeLibMaterial(id) { put(K.mats, readJSON(S, K.mats, []).filter(m => m.id !== id)); },
    libParts() { return readJSON(S, K.parts, []); },
    saveLibPart(def) {
      const L = readJSON(S, K.parts, []).filter(d => d.id !== def.id);
      L.push(def); return put(K.parts, L);
    },
    removeLibPart(id) { put(K.parts, readJSON(S, K.parts, []).filter(d => d.id !== id)); }
  };
}

export function exportJSON(doc) { return JSON.stringify(doc, null, 1); }

// text -> { kind:'doc'|'example'|'legacy'|'part'|'material'|'unknown', ... , error? }
export function parseJSON(text) {
  let o;
  try { o = JSON.parse(text); } catch (e) { return { kind: 'unknown', error: 'not valid JSON: ' + e.message }; }
  if (!o || typeof o !== 'object') return { kind: 'unknown', error: 'not a bench file' };
  if (o.format === 'breadboard-lab') return { kind: 'doc', doc: o };
  if (o.meta && o.doc && o.doc.format === 'breadboard-lab') return { kind: 'example', doc: o.doc, meta: o.meta };
  if (Array.isArray(o.placed) && Array.isArray(o.wires)) return { kind: 'legacy', legacy: o };
  if (o.kind === 'part' && o.def) return { kind: 'part', def: o.def };
  if (o.kind === 'material' && o.spec) return { kind: 'material', spec: o.spec };
  if (o.id && Array.isArray(o.pins) && o.category) return { kind: 'part', def: o };
  if (o.id && typeof o.color === 'string' && 'roughness' in o) return { kind: 'material', spec: o };
  return { kind: 'unknown', error: 'this JSON is not a bench, a part, a material or an old bench file' };
}

export function download(filename, text, mime = 'application/json') {
  if (typeof document === 'undefined') return false;
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}
export function pickFile(accept = '.json,application/json') {
  return new Promise((resolve, reject) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept;
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      if (!f) { reject(new Error('no file')); return; }
      f.text().then(resolve, reject);
    });
    inp.click();
  });
}
