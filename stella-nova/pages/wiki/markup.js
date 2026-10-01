// ============================================================================
//  WIKI  ·  pages/wiki/markup.js — wiki markup to DOM renderer
// ────────────────────────────────────────────────────────────────────────────
//  This classic script sets window.SNWikiMarkup. It turns the wiki markup of
//  one article section into DOM nodes.
//
//  SECURITY. This file is the main security surface of the editor. The
//  renderer never parses HTML. It makes each element with createElement and
//  puts all user text in text nodes, so a "<" in the source stays a "<" on
//  the page. It sets only the attributes that it makes itself:
//    - wiki links get "#/e/<category>/<slug>" after a strict id check
//    - external links get a URL only when its scheme is http, https or mailto
//    - images get a path from the entry's own sprite list, never from source
//  No code path writes source text into innerHTML, an "on..." attribute or
//  a style attribute.
//
//  SYNTAX (one construct per line for block forms)
//    == Heading ==   === Subheading ===   ==== Minor ====
//    **bold**   ''italic''   `code`
//    [[category/slug]]   [[category/slug|label]]      wiki link
//    [https://example.com label]                      external link
//    > quote line                                     block quote
//    * item   # item                                  lists
//    ----                                             rule
//    [[redact|hidden text]]                           black bar, tap shows
//    [DATA EXPUNGED]   [[expunged]]                   expunged tag
//    [[fn|footnote text]]                             footnote
//    [[image 2|caption]]                              sprite 2 of the entry
//    [[collapse Title]] ... [[/collapse]]             collapsible block
//
//  grep -n targets
//    function render(      entry point: (src, ctx) -> element
//    function blocks(      block parser
//    function inline(      inline parser
//    function safeUrl(     external link scheme check
//    var ID_RE             wiki link id check
// ============================================================================
(function () {
  'use strict';

  var ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var MAX_DEPTH = 6;
  var MAX_LEN = 60000;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // Only absolute http, https and mailto URLs pass. The check reads the
  // scheme from the URL parser, so "java\tscript:" and "JaVaScRiPt:" fail.
  function safeUrl(u) {
    if (typeof u !== 'string' || !u || u.length > 2000) return null;
    if (/[\u0000- \u007f<>"'`]/.test(u)) return null;
    var url;
    try { url = new URL(u); } catch (e) { return null; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'mailto:') return null;
    return url.href;
  }

  // ── inline ──────────────────────────────────────────────────────────────
  // Returns an array of nodes. Unclosed markers stay as literal text.
  function inline(s, ctx, depth) {
    var out = [], buf = '', i = 0;
    function flush() { if (buf) { out.push(document.createTextNode(buf)); buf = ''; } }
    if (depth > MAX_DEPTH) return [document.createTextNode(s)];
    while (i < s.length) {
      var c2 = s.substr(i, 2);
      var end;
      if (c2 === '**' && (end = s.indexOf('**', i + 2)) > i + 2) {
        flush(); var b = el('strong'); append(b, inline(s.slice(i + 2, end), ctx, depth + 1)); out.push(b); i = end + 2; continue;
      }
      if (c2 === "''" && (end = s.indexOf("''", i + 2)) > i + 2) {
        flush(); var it = el('em', 'mk-em'); append(it, inline(s.slice(i + 2, end), ctx, depth + 1)); out.push(it); i = end + 2; continue;
      }
      if (s[i] === '`' && (end = s.indexOf('`', i + 1)) > i + 1) {
        flush(); out.push(el('code', 'mk-code', s.slice(i + 1, end))); i = end + 1; continue;
      }
      if (c2 === '[[' && (end = s.indexOf(']]', i + 2)) > i + 2) {
        var node = tagNode(s.slice(i + 2, end), ctx, depth);
        if (node) { flush(); out.push(node); i = end + 2; continue; }
      }
      if (s.substr(i, 15) === '[DATA EXPUNGED]') {
        flush(); out.push(el('span', 'mk-expunged', '[DATA EXPUNGED]')); i += 15; continue;
      }
      if (s[i] === '[' && s[i + 1] !== '[' && (end = s.indexOf(']', i + 1)) > i + 1) {
        var body = s.slice(i + 1, end), sp = body.search(/\s/);
        var url = safeUrl(sp < 0 ? body : body.slice(0, sp));
        if (url) {
          flush();
          var a = el('a', 'mk-ext', sp < 0 ? url : body.slice(sp + 1).trim() || url);
          a.setAttribute('href', url);
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener noreferrer nofollow');
          out.push(a); i = end + 1; continue;
        }
      }
      buf += s[i]; i++;
    }
    flush();
    return out;
  }

  // The inside of [[ ... ]]. Returns null for an unknown form, and the
  // caller then keeps the brackets as literal text.
  function tagNode(body, ctx, depth) {
    var bar = body.indexOf('|');
    var head = (bar < 0 ? body : body.slice(0, bar)).trim();
    var rest = bar < 0 ? '' : body.slice(bar + 1);
    if (head === 'redact') {
      var r = el('span', 'mk-redact', rest || '███');
      r.setAttribute('tabindex', '0');
      r.setAttribute('role', 'button');
      r.setAttribute('aria-label', 'Redacted text. Activate to show it.');
      return r;
    }
    if (head === 'expunged') return el('span', 'mk-expunged', '[DATA EXPUNGED]');
    if (head === 'fn') {
      if (!rest.trim()) return null;
      ctx.notes.push(rest);
      var n = ctx.notes.length;
      var sup = el('sup', 'mk-fnref');
      var b = el('button', null, '[' + n + ']');
      b.setAttribute('type', 'button');
      b.setAttribute('data-fn', String(n));
      b.setAttribute('aria-label', 'Footnote ' + n);
      sup.appendChild(b);
      return sup;
    }
    if (ID_RE.test(head)) {
      var hit = ctx.resolve ? ctx.resolve(head) : null;
      var text = rest.trim() || (hit ? hit.name : head);
      if (!hit) {
        var red = el('span', 'mk-red', text);
        red.setAttribute('title', 'No entry: ' + head);
        return red;
      }
      var a = el('a', 'mk-wiki', text);
      a.setAttribute('href', '#/e/' + head);
      return a;
    }
    return null;
  }

  function append(parent, nodes) { nodes.forEach(function (n) { parent.appendChild(n); }); }

  // ── blocks ──────────────────────────────────────────────────────────────
  function blocks(lines, ctx, depth, into) {
    var para = [];
    function flushPara() {
      if (!para.length) return;
      var p = el('p');
      append(p, inline(para.join(' '), ctx, depth));
      into.appendChild(p);
      para = [];
    }
    var i = 0, m;
    while (i < lines.length) {
      var line = lines[i];
      var t = line.trim();
      if (!t) { flushPara(); i++; continue; }
      if ((m = t.match(/^(={2,4})\s*(.+?)\s*=*$/))) {
        flushPara();
        var hd = el('h' + (m[1].length + 1), 'mk-h');
        append(hd, inline(m[2], ctx, depth));
        into.appendChild(hd); i++; continue;
      }
      if (/^-{4,}$/.test(t)) { flushPara(); into.appendChild(el('hr', 'mk-hr')); i++; continue; }
      if (t[0] === '>') {
        flushPara();
        var q = [];
        while (i < lines.length && lines[i].trim()[0] === '>') { q.push(lines[i].trim().replace(/^>\s?/, '')); i++; }
        var bq = el('blockquote', 'mk-quote');
        if (depth < MAX_DEPTH) blocks(q, ctx, depth + 1, bq); else bq.textContent = q.join(' ');
        into.appendChild(bq); continue;
      }
      if ((m = t.match(/^([*#])\s+/))) {
        flushPara();
        var mark = m[1], list = el(mark === '*' ? 'ul' : 'ol', 'mk-list');
        while (i < lines.length) {
          var lt = lines[i].trim();
          if (lt.length < 2 || lt[0] !== mark || !/\s/.test(lt[1])) break;
          var li = el('li');
          append(li, inline(lt.slice(2).trim(), ctx, depth));
          list.appendChild(li); i++;
        }
        into.appendChild(list); continue;
      }
      if ((m = t.match(/^\[\[collapse(?:\s+([^\]]*))?\]\]$/))) {
        flushPara();
        var level = 1, j = i + 1;
        for (; j < lines.length; j++) {
          var lj = lines[j].trim();
          if (/^\[\[collapse(?:\s+[^\]]*)?\]\]$/.test(lj)) level++;
          else if (lj === '[[/collapse]]' && --level === 0) break;
        }
        var det = el('details', 'mk-collapse');
        var sum = el('summary');
        append(sum, inline((m[1] || 'Show more').trim(), ctx, depth));
        det.appendChild(sum);
        var inner = el('div', 'mk-collapse-body');
        if (depth < MAX_DEPTH) blocks(lines.slice(i + 1, j), ctx, depth + 1, inner); else inner.textContent = lines.slice(i + 1, j).join('\n');
        det.appendChild(inner);
        into.appendChild(det);
        i = j + 1; continue;
      }
      if ((m = t.match(/^\[\[image\s+(\d{1,2})(?:\|([^\]]*))?\]\]$/))) {
        flushPara();
        var k = parseInt(m[1], 10), src = (ctx.sprites || [])[k - 1];
        var fig = el('figure', 'mk-fig');
        if (src) {
          var img = el('img');
          img.setAttribute('src', (ctx.base || '') + src);
          img.setAttribute('alt', m[2] ? m[2].trim() : 'Sprite ' + k);
          img.setAttribute('loading', 'lazy');
          fig.appendChild(img);
        } else {
          fig.appendChild(el('span', 'mk-red', 'No sprite ' + k + ' for this entry'));
        }
        if (m[2] && m[2].trim()) { var cap = el('figcaption'); append(cap, inline(m[2].trim(), ctx, depth)); fig.appendChild(cap); }
        into.appendChild(fig); i++; continue;
      }
      para.push(t); i++;
    }
    flushPara();
  }

  // ── entry point ─────────────────────────────────────────────────────────
  // ctx: { resolve(id) -> { name } | null, sprites: [path], base: '../../' }
  function render(src, ctx) {
    ctx = Object.assign({ resolve: null, sprites: [], base: '' }, ctx || {}, { notes: [] });
    src = String(src == null ? '' : src).slice(0, MAX_LEN).replace(/\r\n?/g, '\n');
    var root = el('div', 'mk');
    blocks(src.split('\n'), ctx, 0, root);
    if (ctx.notes.length) {
      var ol = el('ol', 'mk-notes');
      ctx.notes.forEach(function (n, i) {
        var li = el('li');
        li.setAttribute('data-fnt', String(i + 1));
        append(li, inline(n, Object.assign({}, ctx, { notes: [] }), 1));
        ol.appendChild(li);
      });
      root.appendChild(ol);
    }
    // One listener per rendered block: footnote jumps and redaction toggles.
    root.addEventListener('click', function (ev) {
      var fn = ev.target.closest('[data-fn]');
      if (fn) {
        var t = root.querySelector('[data-fnt="' + fn.getAttribute('data-fn') + '"]');
        if (t) { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); t.classList.add('hit'); setTimeout(function () { t.classList.remove('hit'); }, 1200); }
        return;
      }
      var r = ev.target.closest('.mk-redact');
      if (r) r.classList.toggle('on');
    });
    root.addEventListener('keydown', function (ev) {
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList && ev.target.classList.contains('mk-redact')) { ev.preventDefault(); ev.target.classList.toggle('on'); }
    });
    return root;
  }

  window.SNWikiMarkup = { render: render, safeUrl: safeUrl, ID_RE: ID_RE };
})();
