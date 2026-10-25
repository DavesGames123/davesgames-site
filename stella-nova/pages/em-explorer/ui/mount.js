// ============================================================================
//  EM EXPLORER  ·  ui/mount.js — load VIEW, DATA and CATALOG, or a stub
// ----------------------------------------------------------------------------
//  main.js does not import the three packages statically. A static import
//  of a missing or broken module stops the link of main.js, and then no line
//  of the page runs (a blank page). loadPackages() imports each package with
//  import(). When an import fails, the page uses the stub of that package
//  and records the error, so the shell, the messages and the controls still
//  work.
//
//  The stubs follow the APIs in CONTRACT.md and NOTES.md:
//    CATALOG  DATASETS, BOOKMARKS, ABOUT (two records, no real places)
//    DATA     openVolume(record) -> a Volume with scales and no chunks
//    VIEW     createViewer(canvas, opts) -> an object that keeps its state
//             and draws nothing
//
//  normalizeCatalog(mod) accepts upper-case or lower-case export names and
//  drops records that cannot work (no id, a bookmark with no dataset).
//
//  grep -n targets
//    import with fallback .. "export async function loadPackages"
//    catalog shape ......... "export function normalizeCatalog"
//    stubs ................. "const STUB_"
// ============================================================================

const STUB_CATALOG = {
  DATASETS: [
    { id: 'stub-a', name: 'Sample volume (stub)', organism: 'Stub', tissue: 'CATALOG not loaded', method: 'FIB-SEM', voxel: [8, 8, 8], size: [4096, 4096, 4096], licence: 'CC BY 4.0', credit: 'Stub record', links: [] },
  ],
  BOOKMARKS: [],
  ABOUT: ['The dataset catalog did not load.'],
};

const STUB_DATA = {
  stub: true,
  openVolume(record) {
    const size = record.size || [4096, 4096, 4096], res = record.voxel || [8, 8, 8];
    return Promise.resolve({
      id: record.id, dtype: 'uint8', bounds: [[0, 0, 0], size],
      scales: [{ key: 's0', size, resolution: res, chunk: [64, 64, 64], encoding: 'raw' }],
      getChunk() { return Promise.reject(new Error('DATA package not loaded')); },
      getSlice() { return Promise.reject(new Error('DATA package not loaded')); },
    });
  },
};

const STUB_VIEW = {
  stub: true,
  createViewer(canvas, opts = {}) {
    const st = { x: 0, y: 0, z: 0, zoom: 0.05, plane: 'xy', contrast: { lo: 0, hi: 255, gamma: 1 }, invert: false };
    const emit = () => { try { opts.onState && opts.onState({ ...st }); } catch (e) { /* page handler */ } };
    return {
      stub: true,
      setVolume(vol) { const s = vol && vol.scales && vol.scales[0]; if (s) { st.x = s.size[0] / 2; st.y = s.size[1] / 2; st.z = s.size[2] / 2; } emit(); },
      setPlane(p) { st.plane = p; emit(); },
      setSlice(nm) { st.sliceNm = nm; emit(); },
      goTo(t) { for (const k of ['x', 'y', 'z', 'zoom', 'plane']) if (t[k] != null) st[k] = t[k]; emit(); },
      setContrast(lo, hi, gamma) { st.contrast = { lo, hi, gamma }; },
      setInvert(b) { st.invert = !!b; },
      setInsets() {}, setLayout() {},
      state() { return { ...st }; },
      resize() {}, dispose() {},
      saverShots: null,
    };
  },
};

export const STUBS = { catalog: STUB_CATALOG, data: STUB_DATA, view: STUB_VIEW };

// loadPackages(importer) -> { catalog, data, view, errors: [{ pkg, error }] }
// importer(path) defaults to import(); tests pass their own.
export async function loadPackages(importer = (p) => import(p), base = '..') {
  const errors = [];
  const one = async (pkg, stub, check) => {
    try {
      const mod = await importer(`${base}/${pkg}/index.js`);
      if (!check(mod)) throw new Error(`${pkg}/index.js has not the documented exports`);
      return mod;
    } catch (e) {
      errors.push({ pkg, error: e });
      return stub;
    }
  };
  const [catalog, data, view] = await Promise.all([
    one('catalog', STUB_CATALOG, (m) => !!(m.DATASETS || m.datasets)),
    one('data', STUB_DATA, (m) => typeof m.openVolume === 'function'),
    one('view', STUB_VIEW, (m) => typeof m.createViewer === 'function'),
  ]);
  return { catalog, data, view, errors };
}

const isObj = (v) => v && typeof v === 'object';

// normalizeCatalog(mod) -> { datasets, bookmarks, about: { title, paragraphs }, defaultId }
export function normalizeCatalog(mod) {
  const m = mod || {};
  const datasets = (m.DATASETS || m.datasets || []).filter((d) => isObj(d) && typeof d.id === 'string' && d.id);
  const ids = new Set(datasets.map((d) => d.id));
  const bookmarks = (m.BOOKMARKS || m.bookmarks || [])
    .filter((b) => isObj(b) && ids.has(b.dataset) && [b.x, b.y, b.z].every(Number.isFinite))
    .map((b, i) => ({ ...b, id: typeof b.id === 'string' && b.id ? b.id : `${b.dataset}-${i + 1}` }));
  let about = m.ABOUT || m.about || [];
  if (typeof about === 'string') about = { title: 'About the data', paragraphs: about.split(/\n\s*\n/) };
  else if (Array.isArray(about)) about = { title: 'About the data', paragraphs: about };
  else if (isObj(about)) about = { title: about.title || 'About the data', paragraphs: Array.isArray(about.paragraphs) ? about.paragraphs : [], sections: Array.isArray(about.sections) ? about.sections : null };
  about.paragraphs = (about.paragraphs || []).map(String).filter((s) => s.trim());
  const want = m.DEFAULT_DATASET || m.defaultDataset;
  const defaultId = ids.has(want) ? want : (datasets[0] ? datasets[0].id : null);
  return { datasets, bookmarks, about, defaultId };
}
