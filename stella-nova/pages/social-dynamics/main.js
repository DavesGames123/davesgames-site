// ============================================================================
//  SOCIAL DYNAMICS  ·  main.js — fill the named concept sections
// ----------------------------------------------------------------------------
//  A classic script. It reads window.SN_DATA (lib/game-data/catalog.js) and
//  fills each [data-fill] block in index.html with links to wiki entries.
//  The page shows names and group labels only. It says nothing about how
//  the game computes social state.
//
//  grep -n targets
//    config ............ "var CFG"
//    helpers ........... "function link"
//    ladder ............ "function fillLadder"
//    rumors ............ "function fillRumors"
//    channels .......... "function fillChannels"
//    events ............ "function fillEvents"
//    pulse ring ........ "function fillPulses"
//    incidents ......... "function fillIncidents"
//    scroll spy ........ "function bindTabs"
//    boot .............. "function boot"
// ============================================================================
(function () {
  'use strict';

  var CFG = {
    WIKI: '../wiki/index.html#/e/'   // wiki entry link prefix, then the entry id
  };
  var D = window.SN_DATA;

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cat(id) { return D.entries.filter(function (e) { return e.category === id; }); }
  function fill(name) { return document.querySelector('[data-fill="' + name + '"]'); }
  function href(e) { return esc(CFG.WIKI + e.id); }
  function link(e, cls, inner) {
    return '<a class="' + cls + '" href="' + href(e) + '" data-id="' + esc(e.id) + '">' + (inner || esc(e.name)) + '</a>';
  }
  function mix(a, b, t) {
    var pa = a.match(/\w\w/g).map(function (h) { return parseInt(h, 16); });
    var pb = b.match(/\w\w/g).map(function (h) { return parseInt(h, 16); });
    return 'rgb(' + pa.map(function (v, i) { return Math.round(v + (pb[i] - v) * t); }).join(',') + ')';
  }

  // Small line icons. They are decoration only.
  var ICON = {
    'face-to-face': '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M3 20c0-3 2.5-5 5-5s5 2 5 5M11 20c0-3 2.5-5 5-5s5 2 5 5"/>',
    'carried': '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>',
    'comms': '<path d="M12 13v8M9 21h6"/><circle cx="12" cy="11" r="2"/><path d="M7.5 6.5a6.5 6.5 0 0 0 0 9M16.5 6.5a6.5 6.5 0 0 1 0 9M4.5 3.5a10.5 10.5 0 0 0 0 15M19.5 3.5a10.5 10.5 0 0 1 0 15"/>',
    'originated': '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
    'retold': '<path d="M4 9h12l-3-3M20 15H8l3 3"/>',
    'corroborated': '<circle cx="12" cy="12" r="8.5"/><path d="M8 12.5l3 3 5-6"/>',
    'rejected': '<circle cx="12" cy="12" r="8.5"/><path d="M9 9l6 6M15 9l-6 6"/>',
    'discovered': '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    'comms-in': '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"/>',
    'social': '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2.4"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M15 20c.2-2.4 1.4-4.2 4-4.6"/>',
    'station': '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 12h16M12 4v16"/>',
    'heart': '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10C19.5 15.4 12 20 12 20z"/>'
  };
  function icon(k) {
    return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + (ICON[k] || '<circle cx="12" cy="12" r="4"/>') + '</svg>';
  }

  // ── ladder ────────────────────────────────────────────────────────────────
  function fillLadder() {
    var all = cat('relationship-tiers');
    var pos = all.filter(function (e) { return e.group === 'Positive'; });
    var neg = all.filter(function (e) { return e.group === 'Negative'; });
    var spc = all.filter(function (e) { return e.group !== 'Positive' && e.group !== 'Negative'; });
    var html = '';
    pos.slice().reverse().forEach(function (e, i, a) {
      var t = a.length > 1 ? 1 - i / (a.length - 1) : 1;
      html += '<li style="--k:' + mix('8fb4d6', '64dcc8', t) + '">' + link(e, 'rung pos', '<span class="r-dot"></span><span class="r-name">' + esc(e.name) + '</span><span class="r-grp">' + esc(e.group) + '</span>') + '</li>';
    });
    html += '<li class="axis" aria-hidden="true"><span></span></li>';
    neg.forEach(function (e, i, a) {
      var t = a.length > 1 ? i / (a.length - 1) : 1;
      html += '<li style="--k:' + mix('ffb36b', 'ff5a4e', t) + '">' + link(e, 'rung neg', '<span class="r-dot"></span><span class="r-name">' + esc(e.name) + '</span><span class="r-grp">' + esc(e.group) + '</span>') + '</li>';
    });
    fill('ladder').innerHTML = html;
    fill('special').innerHTML = spc.map(function (e) {
      return link(e, 'orb', '<span class="orb-ring">' + icon('heart') + '</span><span class="orb-grp">' + esc(e.group || 'Special') + '</span><span class="orb-name">' + esc(e.name) + '</span>');
    }).join('');
  }

  // ── rumors ────────────────────────────────────────────────────────────────
  function fillRumors() {
    var all = cat('rumor-topics');
    var groups = ['Positive', 'Negative'];
    all.forEach(function (e) { if (groups.indexOf(e.group) < 0) groups.push(e.group); });
    fill('rumors').innerHTML = groups.map(function (g) {
      var list = all.filter(function (e) { return e.group === g; });
      if (!list.length) return '';
      return '<div class="col ' + (g === 'Negative' ? 'neg' : 'pos') + '"><h3>' + esc(g || 'Other') + '</h3><div class="chips">' +
        list.map(function (e) { return link(e, 'chip'); }).join('') + '</div></div>';
    }).join('');
  }

  // ── channels and events ───────────────────────────────────────────────────
  function cardList(id, target) {
    fill(target).innerHTML = cat(id).map(function (e) {
      return link(e, 'card', icon(e.slug) + '<span class="c-name">' + esc(e.name) + '</span><span class="c-go">Wiki</span>');
    }).join('');
  }
  function fillChannels() { cardList('gossip-channels', 'channels'); }
  function fillEvents() { cardList('gossip-events', 'events'); }

  // ── pulse ring ────────────────────────────────────────────────────────────
  function fillPulses() {
    var all = cat('social-pulses');
    var n = all.length;
    var svg = '<svg class="ring-art" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="38"/><circle cx="50" cy="50" r="24" class="in"/>';
    all.forEach(function (e, i) {
      var a = -Math.PI / 2 + i * 2 * Math.PI / n;
      svg += '<line x1="' + (50 + 24 * Math.cos(a)).toFixed(2) + '" y1="' + (50 + 24 * Math.sin(a)).toFixed(2) + '" x2="' + (50 + 38 * Math.cos(a)).toFixed(2) + '" y2="' + (50 + 38 * Math.sin(a)).toFixed(2) + '"/>';
    });
    svg += '</svg>';
    var html = svg + '<div class="ring-core"><span>Social</span><em>pulses</em></div>';
    all.forEach(function (e, i) {
      var a = -Math.PI / 2 + i * 2 * Math.PI / n;
      var x = 50 + 38 * Math.cos(a), y = 50 + 38 * Math.sin(a);
      html += link(e, 'pulse', '<span class="p-dot"></span><span class="p-name">' + esc(e.name) + '</span>')
        .replace('class="pulse"', 'class="pulse" style="left:' + x.toFixed(2) + '%;top:' + y.toFixed(2) + '%;--d:' + (i * 0.35).toFixed(2) + 's"');
    });
    fill('pulses').innerHTML = html;
  }

  // ── incidents ─────────────────────────────────────────────────────────────
  function fillIncidents() {
    var cats = cat('incident-categories');
    var inc = cat('incidents');
    fill('incidents').innerHTML = cats.map(function (c) {
      var kids = inc.filter(function (e) { return (e.links.related || []).indexOf(c.id) >= 0 || (c.links.related || []).indexOf(e.id) >= 0; });
      return '<div class="icat">' +
        link(c, 'icat-head', icon(c.slug) + '<span><small>Category</small>' + esc(c.name) + '</span>') +
        '<div class="icat-list">' + (kids.length ? kids.map(function (e) { return link(e, 'chip'); }).join('') : '<span class="none">No incident kinds</span>') + '</div></div>';
    }).join('');
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
    mark('tiers');
  }

  // ── boot ──────────────────────────────────────────────────────────────────
  function boot() {
    if (!D || !D.entries) {
      document.querySelector('.lede').textContent = 'The game catalog did not load.';
      return;
    }
    fillLadder();
    fillRumors();
    fillChannels();
    fillEvents();
    fillPulses();
    fillIncidents();
    bindTabs();
    document.body.classList.add('ready');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
