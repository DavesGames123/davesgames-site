// ============================================================================
//  SCIENCE TOOLKIT  ·  core/bib.js  ·  BibTeX to formatted references
// ----------------------------------------------------------------------------
//  parseBib() reads @type{key, field = {..} | ".." | number | macro # ..}
//  with nested braces, @string macros and the month macros; @comment and
//  @preamble are skipped. TeX accents and dashes become Unicode.
//  names() splits "and"-joined authors in the three BibTeX forms ("First
//  von Last", "von Last, First", "von Last, Jr, First"). format() writes
//  one entry in APA 7, IEEE, Vancouver (ICMJE/NLM) or Chicago author-date.
//  Each style returns HTML (titles in italics where the style wants them)
//  and plain text. Everything runs offline: a DOI becomes a link; it is not
//  looked up.
//
//  GREP MAP
//    grep -n "export function parseBib"
//    grep -n "export function names"
//    grep -n "export function format"
//    grep -n "const STYLES"
// ============================================================================

const MONTHS = { jan: 'January', feb: 'February', mar: 'March', apr: 'April', may: 'May', jun: 'June', jul: 'July', aug: 'August', sep: 'September', oct: 'October', nov: 'November', dec: 'December' };
const ACC = { '"': { a: 'ä', o: 'ö', u: 'ü', e: 'ë', i: 'ï', A: 'Ä', O: 'Ö', U: 'Ü', y: 'ÿ' }, "'": { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', c: 'ć', n: 'ń', s: 'ś', z: 'ź', E: 'É', A: 'Á', O: 'Ó' }, '`': { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', E: 'È' }, '^': { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û' }, '~': { n: 'ñ', a: 'ã', o: 'õ', N: 'Ñ' }, c: { c: 'ç', C: 'Ç', s: 'ş' }, v: { c: 'č', s: 'š', z: 'ž', r: 'ř', e: 'ě', C: 'Č', S: 'Š', Z: 'Ž' }, H: { o: 'ő', u: 'ű' }, '=': { a: 'ā', e: 'ē', o: 'ō' }, '.': { z: 'ż', I: 'İ' }, u: { a: 'ă', g: 'ğ' }, k: { a: 'ą', e: 'ę' } };
const SYM = { ss: 'ß', o: 'ø', O: 'Ø', ae: 'æ', AE: 'Æ', aa: 'å', AA: 'Å', l: 'ł', L: 'Ł', i: 'ı', oe: 'œ', OE: 'Œ' };

// TeX text to Unicode plain text.
export function detex(s) {
  let t = String(s);
  t = t.replace(/\\([`'"^~=.])\s*\{?\\?([A-Za-z])\}?/g, (m, a, c) => (ACC[a] && ACC[a][c]) || c);
  t = t.replace(/\\([cvHuk])\s*\{([A-Za-z])\}/g, (m, a, c) => (ACC[a] && ACC[a][c]) || c);
  t = t.replace(/\\(ss|ae|AE|aa|AA|oe|OE|o|O|l|L|i)(?![A-Za-z])\s*/g, (m, a) => SYM[a]);
  t = t.replace(/\\&/g, '&').replace(/\\%/g, '%').replace(/\\_/g, '_').replace(/\\\$/g, '$').replace(/\\#/g, '#');
  t = t.replace(/---/g, '—').replace(/--/g, '–').replace(/``|''/g, '"').replace(/~/g, ' ');
  t = t.replace(/\\(textit|emph|textbf|mathrm|textrm|textsc|text)\s*\{([^{}]*)\}/g, '$2');
  t = t.replace(/\$([^$]*)\$/g, '$1').replace(/[{}]/g, '').replace(/\\[A-Za-z]+\s*/g, '').replace(/\s+/g, ' ').trim();
  return t;
}

export function parseBib(text) {
  const s = String(text), out = [], macros = { ...Object.fromEntries(Object.entries(MONTHS).map(([k, v]) => [k, v])) };
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const braced = () => {
    let depth = 0, start = i + 1;
    for (; i < s.length; i++) {
      if (s[i] === '\\') { i++; continue; }
      if (s[i] === '{') depth++;
      else if (s[i] === '}' && --depth === 0) { i++; return s.slice(start, i - 1); }
    }
    throw new Error('A { has no matching }.');
  };
  const quoted = () => {
    let depth = 0, start = ++i;
    for (; i < s.length; i++) {
      if (s[i] === '\\') { i++; continue; }
      if (s[i] === '{') depth++; else if (s[i] === '}') depth--;
      else if (s[i] === '"' && depth === 0) { i++; return s.slice(start, i - 1); }
    }
    throw new Error('A " has no matching ".');
  };
  const value = () => {
    let v = '';
    for (;;) {
      ws();
      if (s[i] === '{') v += braced();
      else if (s[i] === '"') v += quoted();
      else { const m = /^[A-Za-z0-9_:.\-+/]+/.exec(s.slice(i)); if (!m) throw new Error(`Unexpected "${s[i] || 'end'}" in a field value.`); i += m[0].length; v += /^\d+$/.test(m[0]) ? m[0] : (macros[m[0].toLowerCase()] ?? m[0]); }
      ws();
      if (s[i] === '#') { i++; continue; }
      return v;
    }
  };
  while (i < s.length) {
    const at = s.indexOf('@', i);
    if (at < 0) break;
    i = at + 1;
    const tm = /^([A-Za-z]+)\s*([{(])/.exec(s.slice(i));
    if (!tm) continue;
    const type = tm[1].toLowerCase();
    i += tm[0].length;
    const close = tm[2] === '{' ? '}' : ')';
    if (type === 'comment' || type === 'preamble') { i--; if (tm[2] === '{') braced(); else i = s.indexOf(')', i) + 1; continue; }
    if (type === 'string') {
      ws();
      const nm = /^[A-Za-z0-9_]+/.exec(s.slice(i)); i += nm[0].length; ws();
      if (s[i] === '=') i++;
      macros[nm[0].toLowerCase()] = value();
      ws(); if (s[i] === close) i++;
      continue;
    }
    ws();
    const km = /^[^,\s}]+/.exec(s.slice(i));
    const key = km ? km[0] : '';
    i += key.length; ws();
    const fields = {};
    while (i < s.length) {
      ws();
      if (s[i] === ',') { i++; ws(); }
      if (s[i] === close) { i++; break; }
      const fm = /^([A-Za-z][A-Za-z0-9_\-:]*)\s*=/.exec(s.slice(i));
      if (!fm) throw new Error(`Entry "${key}": cannot read a field near "${s.slice(i, i + 20)}".`);
      i += fm[0].length;
      fields[fm[1].toLowerCase()] = value();
    }
    out.push({ type, key, fields });
  }
  if (!out.length) throw new Error('No BibTeX entry found. An entry starts with @article{key, ...}.');
  return out;
}

// Split names. Returns [{ first, von, last, jr }].
export function names(field) {
  if (!field) return [];
  const parts = [];
  let depth = 0, cur = '';
  const toks = String(field).split(/(\s+and\s+|[{}])/i);
  for (const t of toks) {
    if (t === '{') depth++;
    if (t === '}') depth--;
    if (depth === 0 && /^\s+and\s+$/i.test(t)) { parts.push(cur); cur = ''; } else cur += t;
  }
  parts.push(cur);
  // Split at depth 0 only, so a braced group ({Barnes and Noble}) stays whole.
  const splitTop = (str, re) => {
    const out = []; let d = 0, cur = '';
    for (const ch of str) {
      if (ch === '{') d++; else if (ch === '}') d--;
      if (d === 0 && re.test(ch)) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map(x => x.trim()).filter(x => x !== '');
  };
  const lower = (w) => /^[a-z]/.test(w);
  return parts.map(p => p.trim()).filter(Boolean).map(p => {
    if (/^others$/i.test(p)) return { others: true };
    const c = splitTop(p, /,/);
    let first = '', von = '', last = '', jr = '';
    const splitVon = (str) => { const ws = splitTop(str, /\s/); let k = 0; while (k < ws.length - 1 && lower(ws[k])) k++; return [ws.slice(0, k).join(' '), ws.slice(k).join(' ')]; };
    if (c.length === 1) {
      const ws = splitTop(c[0], /\s/);
      const k = ws.findIndex((w, j) => j < ws.length - 1 && lower(w));
      if (k < 0) { last = ws.pop(); first = ws.join(' '); }
      else { first = ws.slice(0, k).join(' '); let j = k; while (j < ws.length - 1 && lower(ws[j])) j++; von = ws.slice(k, j).join(' '); last = ws.slice(j).join(' '); }
    } else if (c.length === 2) { [von, last] = splitVon(c[0]); first = c[1]; }
    else { [von, last] = splitVon(c[0]); jr = c[1]; first = c[2]; }
    return { first: detex(first), von: detex(von), last: detex(last), jr: detex(jr) };
  });
}

const initials = (first, sep = '. ', end = '.') => first.split(/[\s]+/).filter(Boolean).map(w => w.split('-').map(x => x[0]).join(`${end}-`)).join(sep) + (first ? end : '');
const initialsTight = (first) => first.split(/[\s-]+/).filter(Boolean).map(w => w[0]).join('');
const fullLast = (n) => [n.von, n.last].filter(Boolean).join(' ');
const pages = (p) => detex(p || '').replace(/\s*[-–]+\s*/, '–');
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sentence = (t) => t.replace(/[.?!]$/, '');

function fields(e) {
  const f = {};
  for (const [k, v] of Object.entries(e.fields)) f[k] = k === 'author' || k === 'editor' ? v : detex(v);
  f.authors = names(e.fields.author || e.fields.editor || '');
  if (f.doi) f.doi = f.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:/i, '');
  f.venue = f.journal || f.booktitle || f.publisher || f.school || f.institution || f.howpublished || '';
  return f;
}

const STYLES = {
  apa(e, f) {
    const list = f.authors.filter(n => !n.others).map(n => `${fullLast(n)}${n.jr ? ', ' + n.jr : ''}, ${initials(n.first, '. ', '.')}`.replace(/, \.$/, ''));
    let au = list.length <= 2 ? list.join(', & ') : list.length <= 20 ? `${list.slice(0, -1).join(', ')}, & ${list[list.length - 1]}` : `${list.slice(0, 19).join(', ')}, . . . ${list[list.length - 1]}`;
    if (list.length === 2) au = `${list[0]}, & ${list[1]}`;
    const year = f.year ? `(${f.year})` : '(n.d.)';
    const t = sentence(f.title || '');
    const doi = f.doi ? ` https://doi.org/${f.doi}` : f.url ? ` ${f.url}` : '';
    if (e.type === 'article') {
      const vol = f.volume ? `, <i>${esc(f.volume)}</i>` : '';
      const iss = f.number ? `(${esc(f.number)})` : '';
      const pg = f.pages ? `, ${esc(pages(f.pages))}` : '';
      return `${esc(au)} ${year}. ${esc(t)}. <i>${esc(f.journal || '')}</i>${vol}${iss}${pg}.${esc(doi)}`;
    }
    if (e.type === 'book') return `${esc(au)} ${year}. <i>${esc(t)}</i>${f.edition ? ` (${esc(f.edition)} ed.)` : ''}. ${esc(f.publisher || '')}.${esc(doi)}`;
    if (e.type === 'inproceedings' || e.type === 'incollection') return `${esc(au)} ${year}. ${esc(t)}. In <i>${esc(f.booktitle || '')}</i>${f.pages ? ` (pp. ${esc(pages(f.pages))})` : ''}${f.publisher ? `. ${esc(f.publisher)}` : ''}.${esc(doi)}`;
    return `${esc(au)} ${year}. <i>${esc(t)}</i>${f.venue ? `. ${esc(f.venue)}` : ''}.${esc(doi)}`;
  },
  ieee(e, f) {
    const list = f.authors.filter(n => !n.others).map(n => `${initials(n.first, '. ', '.')} ${fullLast(n)}${n.jr ? ', ' + n.jr : ''}`.trim());
    const au = list.length > 6 ? `${list[0]} et al.` : list.length <= 2 ? list.join(' and ') : `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
    const t = sentence(f.title || '');
    const mo = f.month ? `${f.month.slice(0, 3)}${f.month.length > 3 ? '.' : ''} ` : '';
    const doi = f.doi ? `, doi: ${f.doi}` : '';
    if (e.type === 'article') return `${esc(au)}, “${esc(t)},” <i>${esc(f.journal || '')}</i>${f.volume ? `, vol. ${esc(f.volume)}` : ''}${f.number ? `, no. ${esc(f.number)}` : ''}${f.pages ? `, pp. ${esc(pages(f.pages))}` : ''}, ${esc(mo)}${esc(f.year || '')}${esc(doi)}.`;
    if (e.type === 'book') return `${esc(au)}, <i>${esc(t)}</i>${f.edition ? `, ${esc(f.edition)} ed` : ''}. ${f.address ? esc(f.address) + ': ' : ''}${esc(f.publisher || '')}, ${esc(f.year || '')}${esc(doi)}.`;
    if (e.type === 'inproceedings' || e.type === 'incollection') return `${esc(au)}, “${esc(t)},” in <i>${esc(f.booktitle || '')}</i>, ${esc(f.year || '')}${f.pages ? `, pp. ${esc(pages(f.pages))}` : ''}${esc(doi)}.`;
    return `${esc(au)}, “${esc(t)},” ${esc(f.venue)}${f.venue ? ', ' : ''}${esc(f.year || '')}${esc(doi)}.`;
  },
  vancouver(e, f) {
    const list = f.authors.filter(n => !n.others).map(n => `${fullLast(n)} ${initialsTight(n.first)}`.trim());
    const au = list.length > 6 ? `${list.slice(0, 6).join(', ')}, et al.` : list.join(', ');
    const t = sentence(f.title || '');
    const doi = f.doi ? ` doi:${f.doi}` : '';
    if (e.type === 'article') return `${esc(au)}. ${esc(t)}. ${esc(f.journal || '')}. ${esc(f.year || '')}${f.volume ? `;${esc(f.volume)}` : ''}${f.number ? `(${esc(f.number)})` : ''}${f.pages ? `:${esc(pages(f.pages).replace('–', '-'))}` : ''}.${esc(doi)}`;
    if (e.type === 'book') return `${esc(au)}. ${esc(t)}.${f.edition ? ` ${esc(f.edition)} ed.` : ''} ${f.address ? esc(f.address) + ': ' : ''}${esc(f.publisher || '')}; ${esc(f.year || '')}.${esc(doi)}`;
    return `${esc(au)}. ${esc(t)}. ${f.booktitle ? 'In: ' + esc(f.booktitle) + '. ' : esc(f.venue) + (f.venue ? '; ' : '')}${esc(f.year || '')}.${esc(doi)}`;
  },
  chicago(e, f) {
    const ns = f.authors.filter(n => !n.others);
    const name = (n, k) => k === 0 ? `${fullLast(n)}, ${n.first}${n.jr ? ', ' + n.jr : ''}` : `${n.first} ${fullLast(n)}`;
    const list = ns.map(name);
    const au = list.length > 10 ? `${list.slice(0, 7).join(', ')}, et al.` : list.length <= 2 ? list.join(', and ') : `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
    const t = sentence(f.title || '');
    const doi = f.doi ? ` https://doi.org/${f.doi}.` : '';
    if (e.type === 'article') return `${esc(au)}. ${esc(f.year || 'n.d.')}. “${esc(t)}.” <i>${esc(f.journal || '')}</i>${f.volume ? ` ${esc(f.volume)}` : ''}${f.number ? ` (${esc(f.number)})` : ''}${f.pages ? `: ${esc(pages(f.pages))}` : ''}.${esc(doi)}`;
    if (e.type === 'book') return `${esc(au)}. ${esc(f.year || 'n.d.')}. <i>${esc(t)}</i>. ${f.address ? esc(f.address) + ': ' : ''}${esc(f.publisher || '')}.${esc(doi)}`;
    return `${esc(au)}. ${esc(f.year || 'n.d.')}. “${esc(t)}.” ${f.booktitle ? 'In <i>' + esc(f.booktitle) + '</i>' : esc(f.venue)}${f.pages ? `, ${esc(pages(f.pages))}` : ''}.${esc(doi)}`;
  },
};
export const STYLE_NAMES = { apa: 'APA 7', ieee: 'IEEE', vancouver: 'Vancouver (ICMJE)', chicago: 'Chicago author-date' };

// One entry -> { html, text }.
export function format(entry, style = 'apa') {
  const f = fields(entry);
  const html = STYLES[style](entry, f).replace(/\s+/g, ' ').replace(/\.\./g, '.').trim();
  const text = html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return { html, text, doi: f.doi };
}
