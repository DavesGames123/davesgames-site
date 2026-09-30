/* ============================================================================
   SHAN SHUI  ·  main script  (classic script, load order 12 of 12)
   ----------------------------------------------------------------------------
   The Stella Nova UI for the shan-shui-inf engine. The engine files before
   this one are verbatim upstream code. This file replaces the upstream UI
   (lines 4043-4361): the side bars, the settings menu, xcroll, autoxcroll,
   present, reloadWSeed, download, and the paper-texture script.

   ENGINE GLOBALS READ
     MEM            cursx, windx (3000), windy (800), xmin, xmax, cwid, chunks
     SEED           the seed string from ?seed= or the time
     update()       loads chunks, then writes <svg id="SVG"> into #BG
     viewupdate()   moves the viewBox of #SVG to MEM.cursx, with no rebuild
     calcViewBox()  "cursx 0 w h", with w = windx / 1.142
     Noise          used only by the paper loop, after the first update()

   DETERMINISM. Math.random is the seeded PRNG. The chunk build and the
   Perlin table use it. The boot order is the upstream order: the scale,
   MEM.lasttick, update(), then the paper loop. This file never calls
   Math.random itself. A new seed comes from Date.now(), as in upstream.
   MEM.windx and MEM.windy do not change. CSS scales the SVG for each screen.

   SCALE. fitScale() reads the height of #stage. The scale S is that height
   divided by 800, so the full scroll height always fits. #BG gets --svg-w
   and --svg-h, and style.css applies them to the SVG. The CSS variables stay
   when update() replaces the SVG. One CSS px is unitsPerPx() SVG units.

   PAN. Drag, touch drag, wheel (deltaX, or shift + deltaY), the arrow keys,
   the step buttons, and auto-scroll all call panBy(). refresh() then runs
   once per animation frame. It calls update() at once when the engine needs
   new chunks, or when the view leaves the rendered band of chunks. In the
   other cases it calls viewupdate(), and it calls update() 180 ms after the
   last pan to center the rendered band again.

   GREP MAP
     grep -n 'function fitScale'     the CSS scale of the SVG
     grep -n 'function panBy'        every pan input ends here
     grep -n 'function refresh'      viewupdate or update, with the debounce
     grep -n 'function tick'         auto-scroll and the step glide
     grep -n 'function paperTexture' the upstream paper loop, verbatim
     grep -n 'function downloadSVG'  the SVG file save
     grep -n 'function reloadSeed'   the reload with ?seed=
     grep -n 'function buildUI'      the control wiring
     grep -n 'function setOpen'      the panel, the phone sheet, and the dock
     grep -n 'BOOT'                  the boot order
   ========================================================================== */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  // The phone layout. This query matches the PHONE block in style.css.
  const PHONE_Q = window.matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
  const DEBOUNCE_MS = 180;   // idle time before the band of chunks is centered

  const G = {
    step: 200,       // step size in SVG units, as upstream INC_STEP
    speed: 100,      // auto-scroll speed in SVG units per second
    auto: false,
  };

  const stage = $('stage'), BG = $('BG');

  // ------------------------------------------------------------- fitScale
  // The SVG keeps its 3000 x 800 size in units. CSS scales it to the stage.
  let S = 1;
  function fitScale() {
    const h = Math.max(1, stage.clientHeight);
    S = h / MEM.windy;
    BG.style.setProperty('--svg-w', (MEM.windx * S).toFixed(2) + 'px');
    BG.style.setProperty('--svg-h', (MEM.windy * S).toFixed(2) + 'px');
  }
  // SVG units per CSS px. The viewBox width comes from the engine.
  function unitsPerPx() {
    const vbW = parseFloat(calcViewBox().split(' ')[2]);
    return vbW / (MEM.windx * S);
  }
  // The width of the scroll on screen, in SVG units.
  function visibleUnits() {
    return Math.min(stage.clientWidth, MEM.windx * S) * unitsPerPx();
  }

  // --------------------------------------------------------------- refresh
  // renderedX is MEM.cursx at the last update(). chunkrender() then drew the
  // chunks with x in (renderedX - cwid, renderedX + windx + cwid).
  let renderedX = 0, rafPending = false, idleTimer = 0;
  function doUpdate() {
    clearTimeout(idleTimer); idleTimer = 0;
    update();
    renderedX = MEM.cursx;
    refreshStatus();
  }
  // The same test as the while loop of chunkloader(MEM.cursx, MEM.cursx + windx).
  function needsChunks() {
    const x0 = MEM.cursx, x1 = MEM.cursx + MEM.windx;
    return x1 > MEM.xmax - MEM.cwid || x0 < MEM.xmin + MEM.cwid;
  }
  // True when the view gets near the edge of the rendered chunks. Half of a
  // chunk width stays as margin, because a mountain spreads past its own x.
  function outOfBand() {
    const m = MEM.cwid * 0.5;
    return MEM.cursx < renderedX - MEM.cwid + m ||
           MEM.cursx + visibleUnits() > renderedX + MEM.windx + MEM.cwid - m;
  }
  function refresh() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (needsChunks() || outOfBand()) { doUpdate(); return; }
      viewupdate();
      refreshStatus();
      clearTimeout(idleTimer);
      idleTimer = setTimeout(doUpdate, DEBOUNCE_MS);
    });
  }

  // ---------------------------------------------------------------- panBy
  // Upstream xcroll(v) adds v to MEM.cursx. There is no limit on either side.
  function panBy(dUnits) {
    if (!dUnits || !isFinite(dUnits)) return;
    MEM.cursx += dUnits;
    refresh();
  }

  // ----------------------------------------------------------------- tick
  // One loop for auto-scroll and for the glide of a step. It runs only while
  // one of them is active.
  let glide = null, looping = false, lastT = 0;
  function startLoop() {
    if (looping) return;
    looping = true; lastT = performance.now();
    requestAnimationFrame(tick);
  }
  function tick(now) {
    const dt = Math.min((now - lastT) / 1000, 0.05); lastT = now;
    let d = 0;
    if (G.auto) d += G.speed * dt;
    if (glide) {
      const f = Math.min(1, (now - glide.t0) / glide.ms);
      const e = 1 - Math.pow(1 - f, 3);
      const x = glide.from + glide.dist * e;
      d += x - glide.done; glide.done = x;
      if (f >= 1) glide = null;
    }
    panBy(d);
    if (G.auto || glide) requestAnimationFrame(tick);
    else looping = false;
  }
  // A step glides over 320 ms. A second step during a glide adds to it.
  function stepBy(d) {
    const now = performance.now();
    if (glide) { const left = glide.from + glide.dist - glide.done; d += left; }
    glide = { from: 0, dist: d, done: 0, t0: now, ms: 320 };
    startLoop();
  }
  function setAuto(on) {
    G.auto = on;
    const b = $('autoBtn'), k = $('dockAuto');
    b.textContent = on ? '❚❚ STOP AUTO-SCROLL' : '▶ AUTO-SCROLL';
    b.classList.toggle('on', on);
    k.textContent = on ? '❚❚' : '▶▶';
    k.classList.toggle('on', on);
    k.setAttribute('aria-label', on ? 'Stop auto-scroll' : 'Start auto-scroll');
    if (on) { hideHint(); startLoop(); }
  }

  // ---------------------------------------------------------- paperTexture
  // The upstream paper script (lines 4336-4358). The loop is verbatim, so it
  // reads Noise and Math.random in the same order as upstream. The last line
  // puts the texture on #stage in place of body, because body is the dark UI.
  function paperTexture() {
    var canvas = document.getElementById("bgcanv");
    var ctx = canvas.getContext("2d");
    var reso = 512;

    for (var i = 0; i < reso / 2 + 1; i++) {
      for (var j = 0; j < reso / 2 + 1; j++) {
        var c = 245 + Noise.noise(i * 0.1, j * 0.1) * 10;
        c -= Math.random() * 20;

        var r = c.toFixed(0);
        var g = (c * 0.95).toFixed(0);
        var b = (c * 0.85).toFixed(0);
        ctx.fillStyle = "rgb(" + r + "," + g + "," + b + ")";
        ctx.fillRect(i, j, 1, 1);
        ctx.fillRect(reso - i, j, 1, 1);
        ctx.fillRect(i, reso - j, 1, 1);
        ctx.fillRect(reso - i, reso - j, 1, 1);
      }
    }
    var img = canvas.toDataURL("image/png");
    document.getElementById("BG").style.backgroundImage = "url(" + img + ")";
    document.getElementById("stage").style.backgroundImage = "url(" + img + ")";
  }

  // ----------------------------------------------------------- downloadSVG
  // Upstream download() saves the innerHTML of #BG. A Blob URL replaces the
  // data URL, because the SVG text can be several MB. The file name holds the
  // seed and the x position, not Math.random as upstream.
  function downloadSVG() {
    doUpdate();
    const text = BG.innerHTML;
    const blob = new Blob([text], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'shan-shui-' + SEED + '-x' + Math.round(MEM.cursx) + '.svg';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // ------------------------------------------------------------ reloadSeed
  // Upstream reloadWSeed(s). The page reloads in its own frame, so it stays
  // inside the Stella Nova shell. The seed keeps only safe characters, so
  // parseArgs reads it with no URL decode.
  function cleanSeed(s) { return String(s).trim().replace(/[^\w.-]/g, '').slice(0, 48); }
  function reloadSeed(s) {
    s = cleanSeed(s);
    if (!s) return;
    const u = new URL(window.location.href);
    u.search = '?seed=' + s;
    u.hash = '';
    window.location.href = u.toString();
  }

  // --------------------------------------------------------------- status
  function setText(id, s) { const el = $(id); if (el && el.textContent !== s) el.textContent = s; }
  function refreshStatus() {
    setText('stMain', 'seed ' + SEED);
    setText('stRight', 'x ' + Math.round(MEM.cursx) + ' · ' + MEM.chunks.length + ' chunks');
  }
  const hint = $('hint');
  // A touch screen has no wheel and no keys, so its hint is short.
  if (hint && window.matchMedia('(pointer:coarse)').matches) hint.textContent = 'drag to pan · ☰ for seed and save';
  function hideHint() { if (hint) hint.classList.add('gone'); }

  // --------------------------------------------------------------- buildUI
  function buildUI() {
    // Drag with one pointer: mouse, pen, or touch. Only the first pointer pans.
    let drag = null;
    stage.addEventListener('pointerdown', e => {
      if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
      drag = { id: e.pointerId, x: e.clientX };
      try { stage.setPointerCapture(e.pointerId); } catch (x) {}
      stage.classList.add('drag');
      stage.focus({ preventScroll: true });
      hideHint();
    });
    stage.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      drag.x = e.clientX;
      panBy(-dx * unitsPerPx());
    });
    const endDrag = e => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      stage.classList.remove('drag');
      try { stage.releasePointerCapture(e.pointerId); } catch (x) {}
    };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);

    // Wheel and trackpad. deltaX pans. With shift, deltaY pans too.
    stage.addEventListener('wheel', e => {
      let d = e.deltaX;
      if (!d && e.shiftKey) d = e.deltaY;
      if (!d) return;
      e.preventDefault();
      if (e.deltaMode === 1) d *= 16;
      else if (e.deltaMode === 2) d *= stage.clientWidth;
      hideHint();
      panBy(d * unitsPerPx());
    }, { passive: false });

    // Arrow keys: a quarter step. With shift: a full step.
    window.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      hideHint();
      const d = (e.shiftKey ? G.step : G.step / 4) * (e.key === 'ArrowLeft' ? -1 : 1);
      if (e.repeat) panBy(d); else stepBy(d);
    });

    // Steps and auto-scroll, in the panel and in the phone dock.
    $('stepLeft').addEventListener('click', () => stepBy(-G.step));
    $('stepRight').addEventListener('click', () => stepBy(G.step));
    $('dockLeft').addEventListener('click', () => stepBy(-G.step));
    $('dockRight').addEventListener('click', () => stepBy(G.step));
    $('autoBtn').addEventListener('click', () => setAuto(!G.auto));
    $('dockAuto').addEventListener('click', () => setAuto(!G.auto));
    bindRange('step', 'step', v => v + ' u');
    bindRange('speed', 'speed', v => v + ' u/s');

    // Seed.
    const inp = $('seedInp');
    inp.value = SEED;
    $('seedApply').addEventListener('click', () => reloadSeed(inp.value));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') reloadSeed(inp.value); });
    $('seedRandom').addEventListener('click', () => {
      const s = String(Date.now());
      inp.value = s;
      reloadSeed(s);
    });

    // Download. The label changes while the SVG text is built.
    const dl = $('dlBtn');
    dl.addEventListener('click', () => {
      dl.disabled = true; dl.textContent = 'SAVING…';
      setTimeout(() => {
        try { downloadSVG(); } finally { dl.disabled = false; dl.textContent = 'DOWNLOAD SVG'; }
      }, 30);
    });

    // The panel: a drawer on desktop, a sheet or a drawer on phones.
    const panel = $('panel'), dockPanel = $('dockPanel');
    function setOpen(open) {
      panel.classList.toggle('open', open);
      if (!open) panel.classList.remove('full');
      document.body.classList.toggle('panel-closed', !open);
      dockPanel.classList.toggle('on', open);
      dockPanel.setAttribute('aria-expanded', String(open));
    }
    const toggle = () => setOpen(!panel.classList.contains('open'));
    $('gear').addEventListener('click', toggle);
    dockPanel.addEventListener('click', toggle);
    $('panelClose').addEventListener('click', () => setOpen(false));
    setOpen(!PHONE_Q.matches);                  // start closed on phones
    PHONE_Q.addEventListener('change', e => setOpen(!e.matches));

    // The grip of the phone sheet. A tap switches half and full height. A drag
    // up gives full height. A drag down gives half height, then closes.
    const grip = $('sheetGrip');
    let gripY = null;
    grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) {} });
    grip.addEventListener('pointerup', e => {
      if (gripY === null) return;
      const dy = e.clientY - gripY; gripY = null;
      if (Math.abs(dy) < 8) panel.classList.toggle('full');
      else if (dy < -40) panel.classList.add('full');
      else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
    });
    grip.addEventListener('pointercancel', () => { gripY = null; });

    // The stage height changes with the window, the bars, and the phone
    // orientation. Each change sets the scale again.
    if (window.ResizeObserver) new ResizeObserver(() => { fitScale(); refresh(); }).observe(stage);
    else window.addEventListener('resize', () => { fitScale(); refresh(); });

    setTimeout(hideHint, 7000);
  }
  function bindRange(id, key, fmtFn) {
    const inp = $(id), out = $(id + 'V');
    const show = () => { G[key] = +inp.value; out.textContent = fmtFn(+inp.value); };
    inp.addEventListener('input', show);
    show();
  }

  // ------------------------------------------------------------------ BOOT
  // The upstream order. Nothing before update() may call Math.random or
  // Noise, or the same seed draws a different landscape.
  fitScale();                              // 1. scale (upstream: BG width)
  MEM.lasttick = new Date().getTime();     // 2. as upstream
  doUpdate();                              // 3. first chunks and the SVG
  paperTexture();                          // 4. paper; reads Math.random
  buildUI();                               // 5. controls, no Math.random
  refreshStatus();
})();
