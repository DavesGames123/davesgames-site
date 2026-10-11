// ============================================================================
//  RST  ·  manim docstrings (reStructuredText, numpydoc) -> HTML  (pure)
// ----------------------------------------------------------------------------
//  manim writes its docstrings in numpydoc form. This reader covers what
//  they use, not all of RST:
//    "Parameters" + "----------"   section heading
//    name : type / indented text   parameter entry (definition list)
//    ``code``                      inline code
//    :class:`~.Circle`  :meth:`.Mobject.shift`  and so on
//                                  a reference link (data-ref="Circle")
//    .. manim:: Name               a runnable example scene: shown as code,
//    .. code-block:: python        with "Load in editor" when it is a manim
//    >>> doctest lines             example
//    .. note:: / .. warning::      a note box
//  Other directives show as plain text.
//
//  EXPORTS
//    rstToHtml(doc, {code}) -> {html, examples: [{scene, code}]}
//    refName(target)        -> name for introspect ("~.Mobject.shift" -> "Mobject.shift")
// ============================================================================
import { escapeHtml } from './markdown.js';

export function refName(t) {
  return String(t).replace(/^[~!]/, '').replace(/^\.+/, '').replace(/\(\)$/, '').trim();
}

function inline(s) {
  const keep = [];
  const stash = h => `\u0000${keep.push(h) - 1}\u0000`;
  s = String(s)
    .replace(/``([^`]+)``/g, (_, c) => stash(`<code>${escapeHtml(c)}</code>`))
    .replace(/:(?:py:)?(class|meth|func|attr|mod|obj|data|exc|ref|doc|math):`([^`]+)`/g, (_, role, t) => {
      if (role === 'math') return stash(`<span class="md-tex" data-inline data-tex="${escapeHtml(t)}"></span>`);
      const m = /^(.*?)\s*<([^>]+)>$/.exec(t);
      const label = m ? m[1] : (t.startsWith('~') ? refName(t).split('.').pop() : refName(t));
      const target = refName(m ? m[2] : t);
      if (role === 'ref' || role === 'doc') return stash(`<em>${escapeHtml(label)}</em>`);
      return stash(`<code class="ref-link" data-ref="${escapeHtml(target)}">${escapeHtml(label)}</code>`);
    })
    .replace(/`([^`]+)`_*/g, (_, c) => stash(`<em>${escapeHtml(c.replace(/\s*<[^>]+>$/, ''))}</em>`));
  s = escapeHtml(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*\s][^*]*)\*/g, '<em>$1</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[+i]);
}

const indentOf = l => l.length - l.trimStart().length;

export function rstToHtml(doc, opts = {}) {
  const code = opts.code || (t => escapeHtml(t));
  const lines = String(doc || '').replace(/\t/g, '    ').split('\n');
  // Docstrings carry the indent of the def. Remove the common indent of
  // the lines after the first (inspect.cleandoc does the same).
  const rest = lines.slice(1).filter(l => l.trim());
  const common = rest.length ? Math.min(...rest.map(indentOf)) : 0;
  const L = [lines[0].trim(), ...lines.slice(1).map(l => l.slice(Math.min(common, indentOf(l))))];
  const out = [];
  const examples = [];
  let para = [];
  let section = '';
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };

  // Lines indented more than base, from i on. Returns [blockLines, nextI].
  const block = (i, base) => {
    const b = [];
    for (; i < L.length; i++) {
      if (L[i].trim() && indentOf(L[i]) <= base) break;
      b.push(L[i]);
    }
    while (b.length && !b[b.length - 1].trim()) b.pop();
    const ind = b.filter(x => x.trim()).reduce((m, x) => Math.min(m, indentOf(x)), 99);
    return [b.map(x => x.slice(Math.min(ind, indentOf(x)))), i];
  };

  for (let i = 0; i < L.length; i++) {
    const line = L[i];
    const t = line.trim();
    // Section heading: text then a line of - or = of about the same length.
    if (t && L[i + 1] && /^\s*([-=~^])\1{2,}\s*$/.test(L[i + 1]) && indentOf(line) === 0) {
      flush(); section = t;
      out.push(`<h4 class="rst-h">${escapeHtml(t)}</h4>`); i++; continue;
    }
    const dir = /^(\s*)\.\.\s+([\w:-]+)::\s*(.*)$/.exec(line);
    if (dir) {
      flush();
      const kind = dir[2];
      let j = i + 1;
      // Options (":name: value") right after the directive.
      while (j < L.length && /^\s+:[\w-]+:/.test(L[j])) j++;
      const [b, next] = block(j, indentOf(line));
      i = next - 1;
      const text = b.join('\n').replace(/^\n+/, '');
      if (kind === 'manim' || kind === 'code-block' || kind === 'code' || kind === 'sourcecode' || kind === 'testcode') {
        const isManim = kind === 'manim' || /from manim import|class \w+\(.*Scene\)/.test(text);
        let n = -1;
        if (isManim) {
          const scene = kind === 'manim' ? dir[3].trim() : ((/class (\w+)\(/.exec(text) || [])[1] || '');
          const full = /from manim import/.test(text) ? text : `from manim import *\n\n${text}`;
          n = examples.push({ scene, code: full }) - 1;
        }
        out.push(`<div class="rst-code">${isManim ? `<div class="rst-code-bar"><span>Example${kind === 'manim' && dir[3] ? ': ' + escapeHtml(dir[3]) : ''}</span><button class="btn small rst-load" data-example="${n}">Load in editor</button></div>` : ''}<pre><code>${code(text)}</code></pre></div>`);
      } else if (/^(note|warning|seealso|tip|important|caution|attention|deprecated|versionadded|versionchanged)$/.test(kind)) {
        out.push(`<div class="rst-note rst-${kind}"><b>${escapeHtml(kind === 'seealso' ? 'See also' : kind[0].toUpperCase() + kind.slice(1))}</b> ${inline([dir[3], ...b].join(' ').trim())}</div>`);
      } else if (kind === 'math') {
        out.push(`<div class="md-tex md-tex-display" data-tex="${escapeHtml((dir[3] + '\n' + text).trim())}"></div>`);
      } else if (b.length || dir[3]) {
        out.push(`<p class="muted">${inline([dir[3], ...b].join(' ').trim())}</p>`);
      }
      continue;
    }
    if (/^\s*>>>/.test(line)) {
      flush();
      const b = [];
      for (; i < L.length && L[i].trim(); i++) b.push(L[i].trim());
      out.push(`<pre class="rst-doctest"><code>${escapeHtml(b.join('\n'))}</code></pre>`);
      continue;
    }
    if (line.trim().endsWith('::') && !dir) {
      // "Example::" then an indented literal block.
      para.push(t.replace(/::$/, ':'));
      flush();
      let j = i + 1; while (j < L.length && !L[j].trim()) j++;
      const [b, next] = block(j, indentOf(line));
      if (b.length) { out.push(`<pre><code>${code(b.join('\n'))}</code></pre>`); i = next - 1; }
      continue;
    }
    // numpydoc entry: "name : type" at indent 0 in a Parameters-like
    // section, then the indented text.
    if (/^(Parameters|Returns|Yields|Raises|Attributes|Other Parameters|Keyword Arguments|Warns)$/i.test(section) && t && indentOf(line) === 0) {
      flush();
      const m = /^([\w*, ]+?)\s*(?::\s*(.*))?$/.exec(t);
      const [b, next] = block(i + 1, 0);
      i = next - 1;
      out.push(`<dl class="rst-param"><dt><code>${escapeHtml(m ? m[1] : t)}</code>${m && m[2] ? ` <span class="rst-type">${inline(m[2])}</span>` : ''}</dt><dd>${inline(b.join(' ').trim())}</dd></dl>`);
      continue;
    }
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li) { flush(); out.push(`<ul><li>${inline(li[1])}</li></ul>`); continue; }
    if (!t) { flush(); continue; }
    para.push(t);
  }
  flush();
  return { html: out.join('\n').replace(/<\/ul>\n<ul>/g, ''), examples };
}
