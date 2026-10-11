// ============================================================================
//  PYHIGHLIGHT  ·  Python text -> coloured HTML  (no DOM, node-safe)
// ----------------------------------------------------------------------------
//  Uses the Lezer Python parser from the CodeMirror bundle and its class
//  highlighter (tok-keyword, tok-string and so on; style.css gives the
//  colours). The reference panel shows inspect.getsource() output with it,
//  and lessons show ``` fences with it. One parse per call.
//
//  EXPORTS
//    highlightPython(text) -> HTML string (escaped)
// ============================================================================
import { pythonParser, highlightTree, classHighlighter } from '../vendor-editor/codemirror@6.bundle.js';
import { escapeHtml } from './markdown.js';

export function highlightPython(text) {
  const src = String(text || '');
  let tree;
  try { tree = pythonParser.parse(src); } catch { return escapeHtml(src); }
  let pos = 0, html = '';
  highlightTree(tree, classHighlighter, (from, to, cls) => {
    if (from > pos) html += escapeHtml(src.slice(pos, from));
    html += `<span class="${cls}">${escapeHtml(src.slice(from, to))}</span>`;
    pos = to;
  });
  return html + escapeHtml(src.slice(pos));
}
