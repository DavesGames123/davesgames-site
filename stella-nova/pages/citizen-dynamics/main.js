// ============================================================================
//  CITIZEN DYNAMICS  ·  main.js — fill the crew dossier
// ----------------------------------------------------------------------------
//  A classic script. It reads window.SN_DATA (lib/game-data/catalog.js) and
//  fills each [data-fill] block in index.html with links to wiki entries.
//  The page shows names, labels, symbols and portrait sprites only.
//
//  The sample file card picks a random portrait, backstory and starsign.
//  The pick is for display. It does not show how the game makes a citizen.
//
//  grep -n targets
//    config ............ "var CFG"
//    helpers ........... "function link"
//    sample file ....... "function drawFile"
//    portraits ......... "function fillPortraits"
//    work roster ....... "function fillWork"
//    trait axes ........ "function fillTraits"
//    quirks ............ "function fillQuirks"
//    backstories ....... "function fillBackstories"
//    starsigns ......... "function fillSigns"
//    needs ............. "function fillNeeds"
//    mind .............. "function fillMind"
//    scroll spy ........ "function bindTabs"
//    boot .............. "function boot"
// ============================================================================
(function () {
  'use strict';

  var CFG = {
    WIKI: '../wiki/index.html#',     // wiki entry link prefix, then the entry id
    ROOT: '../../'                   // sprite paths are relative to stella-nova/
  };
  var D = window.SN_DATA;
  var idx = {};

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cat(id) { return D.entries.filter(function (e) { return e.category === id; }); }
  function fill(name) { return document.querySelector('[data-fill="' + name + '"]'); }
  function link(e, cls, inner, extra) {
    return '<a class="' + cls + '" href="' + esc(CFG.WIKI + e.id) + '" data-id="' + esc(e.id) + '"' + (extra || '') + '>' + (inner || esc(e.name)) + '</a>';
  }
  function sym(e) { return e.fields && e.fields.Symbol ? '<span class="sym" aria-hidden="true">' + esc(e.fields.Symbol) + '</span>' : ''; }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function rel(e, category) {
    return (e.links.related || []).filter(function (id) { return id.indexOf(category + '/') === 0; }).map(function (id) { return idx[id]; }).filter(Boolean);
  }

  // Line icons for the needs and the mind panels. Decoration only.
  var ICON = {
    health: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10C19.5 15.4 12 20 12 20z"/><path d="M7 12h3l1.5-2.5 2 5 1.5-2.5h2"/>',
    energy: '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>',
    food: '<path d="M7 3v8a3 3 0 0 0 3 3v7M10 3v6M4 3v6a3 3 0 0 0 3 3M17 21V3c-2.5 1.5-3.5 4-3.5 8h3.5"/>',
    emotions: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.5c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8"/><circle cx="9" cy="10" r=".6"/><circle cx="15" cy="10" r=".6"/>',
    relations: '<circle cx="8" cy="12" r="4.5"/><circle cx="16" cy="12" r="4.5"/>'
  };
  function icon(k) { return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + (ICON[k] || '<circle cx="12" cy="12" r="4"/>') + '</svg>'; }

  // ── sample file ───────────────────────────────────────────────────────────
  var portraits, backstories, signs;
  function drawFile() {
    var p = pick(portraits), b = pick(backstories), s = pick(signs);
    var photo = fill('file-photo');
    photo.setAttribute('href', CFG.WIKI + p.id);
    photo.innerHTML = '<img src="' + esc(CFG.ROOT + p.sprite) + '" alt="' + esc(p.name) + '" width="256" height="256">';
    fill('file-rows').innerHTML =
      '<div><dt>Backstory</dt><dd>' + link(b, 'fl') + '</dd></div>' +
      '<div><dt>Starsign</dt><dd>' + link(s, 'fl', '<span class="s-mini" aria-hidden="true">' + esc((s.fields && s.fields.Symbol) || '') + '</span>' + esc(s.name)) + '</dd></div>' +
      '<div><dt>Portrait</dt><dd>' + link(p, 'fl') + '</dd></div>';
  }

  // ── sections ──────────────────────────────────────────────────────────────
  function fillPortraits() {
    fill('portraits').innerHTML = portraits.map(function (e, i) {
      return link(e, 'portrait', '<img src="' + esc(CFG.ROOT + e.sprite) + '" alt="' + esc(e.name) + '" loading="lazy" decoding="async">', ' style="--i:' + i + '"');
    }).join('');
  }

  function fillWork() {
    var skills = cat('skills');
    var used = {};
    var head = '<div class="r-row r-head" aria-hidden="true"><span>Skill</span><span>Job</span><span>Behavior</span></div>';
    fill('work').innerHTML = head + skills.map(function (s) {
      var jobs = rel(s, 'jobs'), behs = rel(s, 'behaviors');
      behs.forEach(function (b) { used[b.id] = 1; });
      return '<div class="r-row">' +
        link(s, 'r-skill', sym(s) + '<span>' + esc(s.name) + '</span>') +
        '<span class="r-cell" data-label="Job">' + (jobs.length ? jobs.map(function (j) { return link(j, 'tag'); }).join('') : '<span class="none">None</span>') + '</span>' +
        '<span class="r-cell" data-label="Behavior">' + (behs.length ? behs.map(function (b) { return link(b, 'tag'); }).join('') : '<span class="none">None</span>') + '</span>' +
        '</div>';
    }).join('');
    var rest = cat('behaviors').filter(function (b) { return !used[b.id]; });
    fill('behaviors').innerHTML = rest.length
      ? '<h3>Other behaviors</h3><div class="chips">' + rest.map(function (b) { return link(b, 'chip'); }).join('') + '</div>'
      : '';
  }

  function fillTraits() {
    fill('traits').innerHTML = cat('traits').map(function (t) {
      var f = t.fields || {};
      var wa = (f['Pole A words'] || '').split(/\s*,\s*/).filter(Boolean);
      var wb = (f['Pole B words'] || '').split(/\s*,\s*/).filter(Boolean);
      return '<details class="axis">' +
        '<summary>' +
        '<span class="a-pole a">' + esc(f['Pole A'] || '') + '</span>' +
        '<span class="a-bar"><span class="a-name">' + esc(t.name) + '</span></span>' +
        '<span class="a-pole b">' + esc(f['Pole B'] || '') + '</span>' +
        '<svg class="a-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>' +
        '</summary>' +
        '<div class="a-words">' +
        '<div class="w a">' + wa.map(function (w) { return '<span>' + esc(w) + '</span>'; }).join('') + '</div>' +
        '<div class="w b">' + wb.map(function (w) { return '<span>' + esc(w) + '</span>'; }).join('') + '</div>' +
        '</div>' +
        '<div class="a-foot">' + link(t, 'a-wiki', 'Open ' + esc(t.name) + ' in wiki') + '</div>' +
        '</details>';
    }).join('');
  }

  function fillQuirks() {
    var all = cat('quirks');
    var groups = [];
    all.forEach(function (e) { var g = e.group || 'Other'; if (groups.indexOf(g) < 0) groups.push(g); });
    fill('quirks').innerHTML = groups.map(function (g, i) {
      return '<div class="grp" style="--k:' + ['var(--blue)', 'var(--gold)', 'var(--teal)', 'var(--rose)'][i % 4] + '"><h3>' + esc(g) + '</h3><div class="chips">' +
        all.filter(function (e) { return (e.group || 'Other') === g; }).map(function (e) { return link(e, 'chip'); }).join('') +
        '</div></div>';
    }).join('');
  }

  function fillBackstories() {
    fill('backstories').innerHTML = backstories.map(function (e) {
      return link(e, 'folder', '<span class="f-tab"></span><span class="f-name">' + esc(e.name) + '</span>');
    }).join('');
  }

  function fillSigns() {
    fill('starsigns').innerHTML = signs.map(function (e) {
      return link(e, 'sign', '<span class="s-glyph" aria-hidden="true">' + esc((e.fields && e.fields.Symbol) || '*') + '</span><span class="s-name">' + esc(e.name) + '</span>');
    }).join('');
  }

  function fillNeeds() {
    fill('needs').innerHTML = cat('needs').map(function (e) {
      return link(e, 'need', icon(e.slug) + '<span>' + esc(e.name) + '</span>');
    }).join('');
  }

  function fillMind() {
    function panel(id, label, ic) {
      var list = cat(id);
      var n = list.length;
      var art = '<svg class="spokes" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="40"/><circle cx="50" cy="50" r="22"/>';
      list.forEach(function (e, i) {
        var a = -Math.PI / 2 + i * 2 * Math.PI / n;
        art += '<line x1="50" y1="50" x2="' + (50 + 40 * Math.cos(a)).toFixed(2) + '" y2="' + (50 + 40 * Math.sin(a)).toFixed(2) + '"/>' +
          '<circle class="tip" cx="' + (50 + 40 * Math.cos(a)).toFixed(2) + '" cy="' + (50 + 40 * Math.sin(a)).toFixed(2) + '" r="1.6"/>';
      });
      art += '</svg>';
      return '<div class="mpanel"><div class="m-head">' + icon(ic) + '<h3>' + esc(label) + '</h3></div>' + art +
        '<div class="chips">' + list.map(function (e) { return link(e, 'chip'); }).join('') + '</div></div>';
    }
    fill('mind').innerHTML = panel('emotions', 'Emotion dimensions', 'emotions') + panel('relationship-dimensions', 'Relationship dimensions', 'relations');
  }

  // ── scroll spy ────────────────────────────────────────────────────────────
  function bindTabs() {
    var bar = document.querySelector('.tabs-in');
    var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-tab]'));
    function mark(id) {
      tabs.forEach(function (t) {
        var on = t.dataset.tab === id;
        t.classList.toggle('on', on);
        if (on) {
          var l = t.offsetLeft - 16, r = t.offsetLeft + t.offsetWidth + 16;
          if (l < bar.scrollLeft) bar.scrollLeft = l;
          else if (r > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = r - bar.clientWidth;
        }
      });
    }
    if (!('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) mark(e.target.id); });
    }, { rootMargin: '-40% 0px -55% 0px' });
    document.querySelectorAll('.sec').forEach(function (s) { io.observe(s); });
  }

  // ── boot ──────────────────────────────────────────────────────────────────
  function boot() {
    if (!D || !D.entries) {
      document.querySelector('.lede').textContent = 'The game catalog did not load.';
      return;
    }
    D.entries.forEach(function (e) { idx[e.id] = e; });
    portraits = cat('portraits').filter(function (e) { return e.sprite; });
    backstories = cat('backstories');
    signs = cat('starsigns');
    if (portraits.length && backstories.length && signs.length) drawFile();
    document.getElementById('shuffle').addEventListener('click', drawFile);
    fillPortraits();
    fillWork();
    fillTraits();
    fillQuirks();
    fillBackstories();
    fillSigns();
    fillNeeds();
    fillMind();
    bindTabs();
    document.body.classList.add('ready');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
