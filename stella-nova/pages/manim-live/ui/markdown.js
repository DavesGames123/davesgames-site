// ============================================================================
//  MARKDOWN  ·  small Markdown -> HTML for lessons and notes  (pure)
// ----------------------------------------------------------------------------
//  Supports what lessons/index.js and UNDER-THE-HOOD.md use: # headings,
//  paragraphs, - and 1. lists, > quotes, ``` fences, `code`, **bold**,
//  *italic*, [links](url), tables with | rows, and TeX as $...$ (inline)
//  and $$...$$ (display). TeX goes out as
//  <span class="md-tex" data-tex="..." data-inline>, and the caller sends
//  those spans to lib/sci-math.js typesetAll(). Every text is escaped, so
//  a lesson cannot put raw HTML on the page.
//
//  EXPORTS   (grep -n "export function <name>" markdown.js)
//    escapeHtml      & < > " ' -> entities
//    renderInline    one line of inline Markdown -> HTML
//    renderMarkdown  a document -> HTML. opts.code(text, lang) styles fences.
// ============================================================================

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function safeUrl(u) {
  const t = u.trim();
  if (/^(https?:|mailto:|#|\.{0,2}\/)/i.test(t) || !/^[a-z]+:/i.test(t)) return t;
  return '#';
}

export function renderInline(text) {
  // Take out code spans and TeX first, so * and _ inside them stay.
  const keep = [];
  const stash = html => `\u0000${keep.push(html) - 1}\u0000`;
  let s = String(text)
    .replace(/`([^`]+)`/g, (_, c) => stash(`<code>${escapeHtml(c)}</code>`))
    .replace(/\$\$([^$]+)\$\$/g, (_, t) => stash(`<span class="md-tex md-tex-display" data-tex="${escapeHtml(t.trim())}"></span>`))
    .replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_, pre, t) => pre + stash(`<span class="md-tex" data-inline data-tex="${escapeHtml(t.trim())}"></span>`));
  s = escapeHtml(s)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${escapeHtml(safeUrl(u.replace(/&amp;/g, '&')))}" target="_blank" rel="noopener">${t}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[+i]);
}

export function renderMarkdown(src, opts = {}) {
  const code = opts.code || ((t) => escapeHtml(t));
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null;           // {tag, items}
  const flushPara = () => { if (para.length) { out.push(`<p>${renderInline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${renderInline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
  const flush = () => { flushPara(); flushList(); };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*```\s*([\w-]*)\s*$/.exec(line);
    if (fence) {
      flush();
      const body = [];
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) body.push(lines[i]);
      out.push(`<pre class="md-code"><code>${code(body.join('\n'), fence[1] || '')}</code></pre>`);
      continue;
    }
    if (/^\s*\$\$\s*$/.test(line)) {
      flush();
      const body = [];
      for (i++; i < lines.length && !/^\s*\$\$\s*$/.test(lines[i]); i++) body.push(lines[i]);
      out.push(`<div class="md-tex md-tex-display" data-tex="${escapeHtml(body.join('\n').trim())}"></div>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { flush(); const n = Math.min(6, h[1].length + 1); out.push(`<h${n}>${renderInline(h[2])}</h${n}>`); continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flush();
      const rows = [];
      for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) rows.push(lines[i]);
      i--;
      const cells = r => r.trim().slice(1, -1).split('|').map(c => c.trim());
      const body = rows.filter(r => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
      const [head, ...rest] = body;
      out.push('<table class="md-table"><thead><tr>' + cells(head).map(c => `<th>${renderInline(c)}</th>`).join('') + '</tr></thead><tbody>'
        + rest.map(r => '<tr>' + cells(r).map(c => `<td>${renderInline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const tag = ul ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push((ul || ol)[1]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += ' ' + line.trim(); continue; }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) { flush(); out.push(`<blockquote>${renderInline(q[1])}</blockquote>`); continue; }
    if (!line.trim()) { flush(); continue; }
    flushList();
    para.push(line.trim());
  }
  flush();
  return out.join('\n');
}
