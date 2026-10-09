// ============================================================================
//  PLANET FORGE  ·  studio.js — the Studio tab: batch renders to PNG
// ----------------------------------------------------------------------------
//  The panel over studio-core.js. It makes jobs from the controls, runs
//  them in a queue and shows a gallery. Each card has its thumbnail, its
//  state, and PNG, JSON and Open buttons. Open sends the planet to the
//  editor (main.js applyPlanet). Download all writes a ZIP with a PNG and
//  a recipe JSON per render (studio-core.js zipFiles).
//
//  SOURCES  random      n draws of the chosen randomize.js mode
//           variations  n mutations of the editor's planet
//           list        recipe files (studio JSON or Maps-tab JSON); with
//                       "same shot for all" the panel's render settings
//                       replace the settings in the files
//  RESOURCES  The studio has its own worker pool (pool.js cancels an older
//    generate() call, so the live view and the studio cannot share one)
//    and its own render run (studio-core.js createRun). Both are made at
//    Render and freed when the queue stops. Phones: 2048 px at most, tile
//    512, 300 MB of PNG in the gallery; desktops 4096, tile 1024, 1.5 GB.
//    Without WebGPU, Render is off and the note says why.
//
//  grep -n targets: "export function createStudio", "function startRun", "function makeJobs",
//  "function drawGallery", "function downloadZip"
// ============================================================================
import * as SC from './studio-core.js';
import { MODES } from './randomize.js';
import { createPool } from './pool.js';

const RES = [512, 1024, 2048, 3072, 4096];

// opts: { $, device, loadText, ENV, getPlanet(), open(P), status(t), progress(f), save(blob, name) }
export function createStudio(o) {
  const { $, device, ENV } = o;
  const limits = device ? device.limits : {};
  const maxRes = SC.maxRes(ENV, limits);
  const tile = Math.min(ENV.mobile ? 512 : 1024, limits.maxTextureDimension2D || 8192);
  let src = 'random', files = [], run = null, pool = null, timer = 0, batch = 0;
  const cards = new Map();

  const fill = (sel, items, val) => { $(sel).innerHTML = ''; for (const [v, t] of items) { const op = document.createElement('option'); op.value = v; op.textContent = t; $(sel).appendChild(op); } $(sel).value = val; };
  fill('stMode', MODES.map(m => [m.id, m.label]), 'any');
  fill('stRes', RES.filter(r => r <= maxRes).map(r => [r, r + ' px']), Math.min(2048, maxRes));
  fill('stAspect', SC.ASPECTS.map(a => [a.id, a.label]), 'square');
  fill('stFraming', SC.FRAMINGS.map(f => [f.id, f.label]), 'disc');
  fill('stBg', SC.BACKGROUNDS.map(b => [b.id, b.label]), 'stars');
  $('stSeed').value = Math.floor(Math.random() * 1e6);
  const amt = $('stAmt'), showAmt = () => { $('oStAmt').textContent = (+amt.value).toFixed(2); };
  amt.oninput = showAmt; showAmt();
  const srcBtns = [...$('stSource').children];
  const showSrc = () => {
    srcBtns.forEach(b => b.classList.toggle('on', b.dataset.src === src));
    $('stModeRow').hidden = src !== 'random'; $('stCountRow').hidden = src === 'list';
    $('stAmtRow').hidden = src !== 'variations'; $('stFilesRow').hidden = src !== 'list';
  };
  srcBtns.forEach(b => b.onclick = () => { src = b.dataset.src; showSrc(); });
  showSrc();
  $('stFiles').onchange = async e => {
    files = [];
    for (const f of e.target.files) {
      try { files.push(SC.jobFromRecipe(await f.text())); } catch (err) { o.status(`${f.name}: ${err.message}`); }
    }
    $('stNote').textContent = `${files.length} recipe${files.length === 1 ? '' : 's'} loaded`;
  };

  const renderSettings = () => ({ ...SC.RENDER_DEFAULT, res: +$('stRes').value, aspect: $('stAspect').value, framing: $('stFraming').value, background: $('stBg').value });
  const queue = SC.createQueue({
    maxBytes: ENV.mobile ? 3e8 : 1.5e9,
    run: (job, hooks) => SC.renderJob({ run, env: ENV, maxRes, generate: (P, W, prog) => pool.generate(P, W, prog) }, job, hooks),
    onChange: () => { if (!timer) timer = setTimeout(() => { timer = 0; drawGallery(); }, 80); },
  });

  function makeJobs() {
    const matchAll = $('stMatch').checked, render = renderSettings();
    const n = Math.max(1, Math.min(200, +$('stCount').value | 0));
    if (src === 'list') { batch++; return files.map(j => ({ ...j, id: `f${batch}-${j.id}`, render: matchAll ? render : j.render })); }
    return SC.makeJobs({ source: src, mode: $('stMode').value, n, seed: +$('stSeed').value >>> 0, amount: +amt.value, current: o.getPlanet(), render, matchAll });
  }

  async function startRun() {
    if (!device) return;
    const jobs = makeJobs();
    if (!jobs.length) { $('stNote').textContent = 'nothing to render: load recipe files first'; return; }
    queue.add(jobs);
    if (queue.running) return;
    $('stSeed').value = (+$('stSeed').value + jobs.length) >>> 0;
    try {
      pool = createPool(Math.max(1, Math.min(ENV.mobile ? 2 : 4, (ENV.cores || 4) - 1)));
      run = await SC.createRun({ device, loadText: o.loadText, tile });
      await queue.start();
    } catch (e) { $('stNote').textContent = 'studio stopped: ' + e.message; }
    finally {
      SC.destroyRun(run); run = null;
      try { pool && pool.terminate(); } catch (e) { /* gone */ }
      pool = null;
      drawGallery();
    }
  }
  $('stStart').onclick = startRun;
  $('stCancel').onclick = () => queue.cancel();
  $('stClear').onclick = () => queue.clear();
  $('stZip').onclick = downloadZip;

  function drawGallery() {
    const host = $('stGallery'), live = new Set(queue.jobs.map(j => j.id));
    for (const [id, c] of cards) if (!live.has(id)) { c.fig.remove(); cards.delete(id); }
    queue.jobs.forEach((j, i) => {
      let c = cards.get(j.id);
      if (!c) {
        const fig = document.createElement('figure');
        fig.innerHTML = '<canvas width="1" height="1"></canvas><figcaption><span></span><b></b><button data-a="png">PNG</button><button data-a="json">JSON</button><button data-a="open">Open</button></figcaption>';
        if (j.render.background === 'transparent') fig.classList.add('alpha');
        c = { fig, canvas: fig.querySelector('canvas'), name: fig.querySelector('span'), state: fig.querySelector('b'), drawn: false };
        fig.querySelector('[data-a=png]').onclick = () => j.result && o.save(new Blob([j.result.png], { type: 'image/png' }), SC.fileBase(j.result, i) + '.png');
        fig.querySelector('[data-a=json]').onclick = () => o.save(new Blob([JSON.stringify(j.result ? j.result.recipe : SC.recipeOf(j), null, 1)], { type: 'application/json' }), (j.result ? SC.fileBase(j.result, i) : 'recipe-' + j.planet.seed) + '.json');
        fig.querySelector('[data-a=open]').onclick = () => o.open(j.planet);
        cards.set(j.id, c); host.appendChild(fig);
      }
      c.name.textContent = `${i + 1}. ${j.planet.name || j.planet.preset}`;
      c.state.textContent = j.status === 'running' ? Math.round(j.progress * 100) + '%' : j.status === 'failed' ? 'failed' : j.status === 'done' ? `${j.result.w}×${j.result.h}` : j.status;
      c.state.title = j.error || '';
      c.fig.querySelector('[data-a=png]').disabled = !j.result;
      if (j.result && !c.drawn) {
        const t = j.result.thumb;
        c.canvas.width = t.w; c.canvas.height = t.h;
        const g = c.canvas.getContext('2d');
        if (g) g.putImageData(new ImageData(t.data, t.w, t.h), 0, 0);
        c.drawn = true;
      }
    });
    const done = queue.jobs.filter(j => j.status === 'done').length, left = queue.jobs.filter(j => j.status === 'queued' || j.status === 'running').length;
    const mb = (queue.bytes / 1e6).toFixed(0);
    $('stNote').textContent = !device ? 'Rendering needs WebGPU.'
      : queue.state === 'full' ? `The gallery holds ${mb} MB. Download the ZIP, then press Clear to go on.`
      : `${done} done, ${left} to go · ${mb} MB · up to ${maxRes} px, tiles of ${tile}`;
    $('stStart').disabled = !device; $('stCancel').disabled = !queue.running; $('stZip').disabled = !done;
    const r = queue.jobs.find(j => j.status === 'running');
    if (r) { o.progress(r.progress); o.status(`studio: rendering ${queue.jobs.indexOf(r) + 1} of ${queue.jobs.length}`); }
  }

  async function downloadZip() {
    if (!window.JSZip) { o.status('ZIP library missing'); return; }
    const results = queue.jobs.filter(j => j.result).map(j => j.result), zip = new window.JSZip();
    for (const [name, bytes] of SC.zipFiles(results)) zip.file(name, bytes);
    o.status(`zipping ${results.length} renders…`);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    o.save(blob, `forge-studio-${new Date().toISOString().slice(0, 10)}.zip`);
    o.status(`ZIP saved (${(blob.size / 1e6).toFixed(0)} MB)`);
  }

  drawGallery();
  return { queue, startRun, drawGallery, destroy() { queue.cancel(); SC.destroyRun(run); try { pool && pool.terminate(); } catch (e) { /* gone */ } } };
}
