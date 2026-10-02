// ============================================================================
//  STATION GUIDE  ·  main.js — chapter nav, wiki chips, boot
// ----------------------------------------------------------------------------
//  This classic script runs last. It starts each figure from chapters.js,
//  fills every element with a data-wiki list of catalog ids with linked
//  chips, and marks the chapter on screen in the top nav.
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//      wiki chips ......... "function fillChips"
//      chapter nav ........ "function watchChapters"
//      boot ............... "function boot"
//      screensaver ........ "window.snSaver"      shell saver autopilot
// ============================================================================
(function () {
  function $(s) { return document.querySelector(s); }

  // ---- wiki chips ---------------------------------------------------------------
  function fillChips() {
    document.querySelectorAll('[data-wiki]').forEach(function (el) {
      el.innerHTML = el.dataset.wiki.split(/\s+/).map(GD.get).filter(Boolean).map(function (e) { return GD.chip(e); }).join('');
    });
    // Jobs and their skills, paired by the catalog related links.
    var jobs = GD.D.entries.filter(function (e) { return e.category === 'jobs'; });
    $('#jobChips').innerHTML = jobs.map(function (j) {
      var sk = (j.links.related || []).filter(function (id) { return id.indexOf('skills/') === 0; }).map(GD.get)[0];
      return '<span class="pair">' + GD.chip(j) + (sk ? '<span class="via">skill</span>' + GD.chip(sk) : '') + '</span>';
    }).join('');
  }

  // ---- chapter nav --------------------------------------------------------------
  function watchChapters() {
    var links = {};
    document.querySelectorAll('#chaps a').forEach(function (a) { links[a.dataset.c] = a; });
    if (!window.IntersectionObserver) return;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        Object.keys(links).forEach(function (k) { links[k].classList.toggle('on', k === e.target.id); });
        var a = links[e.target.id];
        if (a && a.scrollIntoView) { var p = a.parentNode; p.scrollTo({ left: a.offsetLeft - p.offsetLeft - p.clientWidth / 2 + a.clientWidth / 2, behavior: 'smooth' }); }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    document.querySelectorAll('.ch').forEach(function (s) { io.observe(s); });
  }

  // ---- boot ----------------------------------------------------------------------
  function boot() {
    if (window.self !== window.top) document.body.classList.add('in-frame');
    CH.hero($('.hero-art'));
    CH.placement($('#fig-placement'));
    CH.enclosure($('#fig-enclosure'));
    CH.decompress($('#fig-decompress'));
    CH.foundry($('#fig-foundry'));
    CH.chain($('#chain'));
    CH.crew($('#fig-crew'));
    CH.tiers($('#fig-tiers'));
    fillChips();
    watchChapters();
  }
  boot();

  // ---- screensaver ---------------------------------------------------------------
  // Shell saver hook (lib/screensaver.js). enter() hides the page and adds one
  // full-window canvas (#sv-cv). Each frame copies the board of the active
  // figure into it at 1:1 pixels, centred. The board itself is resized to fit
  // the window through its own resize path. Four figures play in turn:
  // hero, enclosure (the autopilot closes the three gaps), foundry (it adds
  // ore to the input room) and crew. A fade to black hides each change.
  // calm 1 runs the figure clock at 0.4 speed. No storage or hash writes.
  window.snSaver = {
    enter: function (opts) {
      var calm = Math.max(0, Math.min(1, +opts.calm || 0)), seed = (opts.seed >>> 0) || 1;
      function rng() { seed = (seed + 0x6D2B79F5) >>> 0; var x = Math.imul(seed ^ seed >>> 15, 1 | seed); x ^= x + Math.imul(x ^ x >>> 7, 61 | x); return ((x ^ x >>> 14) >>> 0) / 4294967296; }
      GD.speed = 1 - 0.6 * calm;
      var st = document.createElement('style');
      st.textContent = 'html.saver,html.saver body{overflow:hidden!important;cursor:none}html.saver body>*{visibility:hidden!important}' +
        'html.saver #sv-cv{visibility:visible!important;position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:99;display:block}';
      document.head.appendChild(st);
      document.documentElement.classList.add('saver');
      var sv = document.createElement('canvas'), g = sv.getContext('2d', { alpha: false });
      sv.id = 'sv-cv'; document.body.appendChild(sv);
      function tap(b, x, y) {
        var r = b.cv.getBoundingClientRect();
        b.cv.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + (x + 0.5) * b.cell, clientY: r.top + (y + 0.5) * b.cell }));
      }
      var reset = function (el) { var x = el.querySelector('[data-a=reset]'); if (x) x.click(); };
      var LIST = [
        { el: $('.hero-art') },
        { el: $('#fig-enclosure'), start: reset, tick: function (b, u, s) { var k = Math.floor((u - 1.5) / 1.6); if (k >= 0 && k < 3 && s.k !== k) { s.k = k; tap(b, [6, 10, 4][k], [1, 3, 5][k]); } } },
        { el: $('#fig-foundry'), start: function (el) { var o = el.querySelectorAll('.ore'); if (o.length) o[(rng() * o.length) | 0].click(); reset(el); },
          tick: function (b, u, s) { var k = Math.floor(u / 1.6); if (s.k !== k) { s.k = k; tap(b, 2 + ((rng() * 8) | 0), 1 + ((rng() * 3) | 0)); } } },
        { el: $('#fig-crew') }
      ].filter(function (x) { return x.el && x.el.querySelector('canvas'); });
      var seg = Math.max(12, (+opts.seconds || 60) / 3) * 1000, i = seed % LIST.length, cur = null, t0 = 0, u = 0, last = 0, dpr = 1;
      function fit() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        sv.width = Math.round(innerWidth * dpr); sv.height = Math.round(innerHeight * dpr);
        if (!cur) return;
        var b = cur.b, cell = Math.max(14, Math.floor(Math.min(innerWidth * 0.96 / b.cols, innerHeight * 0.96 / b.rows)));
        b.cv.parentNode.style.cssText = 'width:' + cell * b.cols + 'px;max-width:none;flex:none';
        b.resize();
      }
      // The plate: the lesson on screen, read from its own section (number,
      // heading, lead, notes) and the live status line of its figure. The
      // hero takes the page heading. Refreshed once a second.
      var lastPlate = 0;
      function txt(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }
      function plate(now) {
        if (!opts.label || !cur) return;
        lastPlate = now;
        var sec = cur.el.closest('section.ch'), status = txt(cur.el.querySelector('.fig-status'));
        if (!sec) {
          opts.label({ title: txt($('.hero h1')), sub: txt($('.hero .kick')), lines: [txt($('.hero .lead'))] });
          return;
        }
        var lines = [txt(sec.querySelector('.lead'))];
        sec.querySelectorAll('.notes li').forEach(function (li) { lines.push('· ' + txt(li)); });
        if (status) lines.push('Figure: ' + status);
        opts.label({ title: txt(sec.querySelector('h2')), sub: 'Station guide · lesson ' + txt(sec.querySelector('.num')), lines: lines });
      }
      function show(k, now) {
        if (cur) cur.b.cv.parentNode.style.cssText = '';
        cur = LIST[k]; cur.b = cur.el.querySelector('canvas').board; cur.s = {};
        if (cur.start) cur.start(cur.el);
        fit(); t0 = now; u = 0;
        plate(now);
      }
      window.addEventListener('resize', fit);
      function frame(now) {
        if (!cur || now - t0 >= seg) show(cur ? (i = (i + 1) % LIST.length) : i, now);
        u += Math.min(0.05, last ? (now - last) / 1000 : 0) * GD.speed; last = now;
        GD.figs.forEach(function (f) { f.on = f.el === cur.el; });
        if (cur.tick) cur.tick(cur.b, u, cur.s);
        if (now - lastPlate > 1000) plate(now);
        var t = now - t0, a = Math.min(1, t / 900, (seg - t) / 900);
        g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.fillStyle = '#07090e'; g.fillRect(0, 0, sv.width, sv.height);
        var c = cur.b.cv;
        if (c.width && a > 0) { g.globalAlpha = a; g.drawImage(c, Math.round((sv.width - c.width) / 2), Math.round((sv.height - c.height) / 2)); }
        requestAnimationFrame(frame);
      }
      show(i, performance.now());
      requestAnimationFrame(frame);
      return { canvas: sv, warmupMs: 1500 };
    }
  };
})();
