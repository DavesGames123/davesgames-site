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
        if (a && a.scrollIntoView) { var p = a.parentNode; p.scrollTo({ left: a.offsetLeft - p.clientWidth / 2 + a.clientWidth / 2, behavior: 'smooth' }); }
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
})();
