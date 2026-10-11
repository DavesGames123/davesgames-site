// ============================================================================
//  CATALOG  ·  filter and group the example list  (pure)
// ----------------------------------------------------------------------------
//  An entry is {id, file, title, topic, level, scene, summary, concepts}
//  (examples/catalog.js). The examples browser (ui/examples.js) calls these.
//
//  EXPORTS   (grep -n "export function <name>" catalog.js)
//    normalise      fill missing fields so a bad entry cannot stop the list
//    topicsOf       topics in first-seen order, with counts
//    filterCatalog  {topic, level, query} -> matching entries
//    parseHeader    "# key: value" lines at the top of an example file
// ============================================================================

export function normalise(e) {
  const level = Math.min(3, Math.max(1, parseInt(e && e.level, 10) || 1));
  return {
    id: String(e.id || e.file || e.title || ''),
    file: String(e.file || ''),
    title: String(e.title || e.id || 'Untitled'),
    topic: String(e.topic || 'Other'),
    level,
    scene: e.scene ? String(e.scene) : '',
    summary: String(e.summary || ''),
    concepts: Array.isArray(e.concepts) ? e.concepts.map(String)
      : String(e.concepts || '').split(',').map(s => s.trim()).filter(Boolean),
    code: typeof e.code === 'string' ? e.code : null,
  };
}

export function topicsOf(list) {
  const m = new Map();
  for (const e of list) m.set(e.topic, (m.get(e.topic) || 0) + 1);
  return [...m].map(([topic, count]) => ({ topic, count }));
}

// query: words, all must match (title, summary, topic, concepts, id).
// level: 0 or '' for any. topic: '' for any.
export function filterCatalog(list, { topic = '', level = 0, query = '' } = {}) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const lv = parseInt(level, 10) || 0;
  return list.filter(e => {
    if (topic && e.topic !== topic) return false;
    if (lv && e.level !== lv) return false;
    if (!words.length) return true;
    const hay = `${e.title} ${e.summary} ${e.topic} ${e.id} ${e.concepts.join(' ')}`.toLowerCase();
    return words.every(w => hay.includes(w));
  });
}

export function parseHeader(src) {
  const out = {};
  for (const line of String(src).split('\n')) {
    const m = /^#\s*([a-z]+)\s*:\s*(.*)$/.exec(line);
    if (!m) { if (line.trim() === '' || line.startsWith('#')) continue; break; }
    out[m[1]] = m[2].trim();
  }
  if (out.concepts) out.concepts = out.concepts.split(',').map(s => s.trim()).filter(Boolean);
  return out;
}
