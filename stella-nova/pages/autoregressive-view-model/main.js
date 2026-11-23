// ============================================================================
//  AUTOREGRESSIVE VIEW MODEL  ·  main.js — tables, the lab, the saver hook
// ----------------------------------------------------------------------------
//  Builds the byline and the paper tables from data.js, and runs the lab:
//  a stream (stream.js) walks the chosen path (world.js) in chunks of
//  L_tgt = 3; lab.js draws each chunk. Play advances one chunk every
//  STEP_MS; Step advances one; Reset starts the stream again with the
//  current path, policy and input images.
//
//  grep -n: "function table"  "function buildTables"  "function restart"
//           "function advance"  "function draw"  "window.snSaver"
// ============================================================================
import { PAPER, T2, T3, T4, T5, T6, T8 } from './data.js';
import { PATHS, prefillFor } from './world.js';
import { createStream, POLICIES } from './stream.js';
import { drawMap, drawNow, drawFilm, ctxBar } from './lab.js';

const $ = id => document.getElementById(id);
const STEP_MS = 420;

// ── tables ──
const fmt = v => v == null ? '–' : String(v);
function table(T, opt = {}) {
  const cols = opt.show ? opt.show.map(k => T.cols.find(c => c[0] === k)) : T.cols;
  const idx = opt.show ? opt.show.map(k => T.cols.findIndex(c => c[0] === k)) : T.cols.map((_, i) => i);
  const dir = opt.show ? cols.map(c => c[3]) : cols.map(c => c[1]);
  const best = idx.map((j, n) => {
    const vals = T.rows.map(r => (opt.show ? r[2] : r[1])[j]).filter(v => v != null);
    return dir[n] > 0 ? Math.max(...vals) : Math.min(...vals);
  });
  const head = opt.show ? cols.map(c => `<th>${c[1]} ${c[3] > 0 ? '↑' : '↓'}<small>${c[2]}</small></th>`).join('')
    : cols.map(c => `<th>${c[0].replace('L_rtr', 'L<sub>rtr</sub>')} ${c[1] > 0 ? '↑' : '↓'}</th>`).join('');
  let body = '', grp = null;
  for (const r of T.rows) {
    const name = r[0], vals = opt.show ? r[2] : r[1];
    if (opt.show && r[1] !== grp && r[1] !== 'avm') { grp = r[1]; body += `<tr class="grp"><td colspan="${cols.length + 1}">${grp === 'view' ? 'View-synthesis models' : 'World models'}</td></tr>`; }
    if (opt.show && r[1] === 'avm' && grp !== 'avm') { grp = 'avm'; body += `<tr class="grp"><td colspan="${cols.length + 1}">This paper</td></tr>`; }
    body += `<tr class="${/^AVM$|^Spatial \+ angular$/.test(name) ? 'avm' : ''}"><td>${name.replace('L_rtr', 'L<sub>rtr</sub>').replace('L_win', 'L<sub>win</sub>')}</td>`
      + idx.map((j, n) => `<td class="${vals[j] != null && vals[j] === best[n] ? 'best' : ''}">${fmt(vals[j])}</td>`).join('') + '</tr>';
  }
  return `<table><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}
function buildTables() {
  const T = { T2, T3, T4, T5, T6, T8 };
  document.querySelectorAll('[data-table]').forEach(el => {
    const k = el.dataset.table;
    el.innerHTML = table(T[k], k === 'T2' ? { show: T2.show } : {});
  });
  $('byline').textContent = PAPER.authors + ' · ' + PAPER.orgs + ' · arXiv:' + PAPER.arxiv + ' · ' + PAPER.date;
  $('cite').innerHTML = `${PAPER.authors}. <i>${PAPER.title}</i>. <a href="${PAPER.url}" target="_blank" rel="noopener">arXiv:${PAPER.arxiv}</a>, ${PAPER.orgs}, 2026. Licence: <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">${PAPER.licence}</a>.`;
  $('siteLink').href = PAPER.site;
}

// ── the lab ──
const L = { path: 'outback', policy: 'angular', prefill: 3, st: null, poses: [], i: 0, ci: -1, playing: false, timer: 0 };
function restart() {
  L.poses = PATHS[L.path].poses();
  L.st = createStream({ prefill: prefillFor(L.path, L.prefill), policy: L.policy, seed: 1 });
  L.i = 0; L.ci = -1;
  $('pathNote').textContent = PATHS[L.path].note;
  draw();
}
function advance() {
  if (L.i >= L.poses.length) { setPlaying(false); return false; }
  const ch = L.st.step(L.poses.slice(L.i, L.i + 3));
  L.i += 3; L.ci = ch.index;
  draw();
  return true;
}
const pct = (a, b) => b ? (100 * a / b).toFixed(0) + ' %' : '–';
function draw() {
  const st = L.st, ch = st.chunks[L.ci];
  drawMap($('map'), st, L.poses, L.ci);
  drawNow($('now'), ch);
  drawFilm($('film'), st);
  ctxBar($('ctxbar'), ch, st.Lsin);
  const rows = [
    ['Chunk', ch ? `${ch.index + 1} of ${Math.ceil(L.poses.length / 3)}` : '–'],
    ['Pool (input + history views)', String(st.pool.length)],
    ['Context L = L_sin + L_rtr + L_mot + L_tgt', ch ? `${ch.sink.length} + ${ch.retrieved.length} + ${ch.motion.length} + ${ch.targets.length} = ${ch.L}` : '–'],
    ['Columns copied from context', ch ? (100 * ch.recon).toFixed(0) + ' % now, ' + pct(st.reconN, st.colN) + ' so far' : '–'],
    ['Revisit consistency', st.revisitN ? `${pct(st.revisitMatch, st.revisitN)} of ${st.revisitN} returns` : 'no returns yet'],
  ];
  $('labNums').innerHTML = rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('');
}
function setPlaying(on) {
  L.playing = on; clearInterval(L.timer);
  $('play').textContent = on ? 'Pause' : (L.i >= L.poses.length ? 'Replay' : 'Play');
  if (on) {
    if (L.i >= L.poses.length) restart();
    L.timer = setInterval(() => { if (!advance()) setPlaying(false); }, STEP_MS);
  }
}
function seg(el, items, get, set) {
  el.innerHTML = '';
  for (const [k, label] of items) {
    const b = document.createElement('button'); b.textContent = label; b.dataset.k = k;
    b.onclick = () => { set(k); sync(); };
    el.appendChild(b);
  }
  el.sync = () => el.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === get()));
}
function sync() { $('paths').sync(); $('policies').sync(); $('prefillV').textContent = String(L.prefill); }
function buildLab() {
  seg($('paths'), Object.entries(PATHS).map(([k, p]) => [k, p.name]), () => L.path, k => { L.path = k; restart(); });
  seg($('policies'), Object.entries(POLICIES).map(([k, n]) => [k, n.replace(' (L_rtr = 0)', '')]), () => L.policy, k => { L.policy = k; restart(); });
  $('prefill').oninput = () => { const v = +$('prefill').value; if (Number.isFinite(v)) { L.prefill = v; restart(); sync(); } };
  $('play').onclick = () => setPlaying(!L.playing);
  $('stepBtn').onclick = () => { setPlaying(false); advance(); };
  $('resetBtn').onclick = () => { setPlaying(false); restart(); };
  let rz = 0;
  addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(draw); });
  sync(); restart();
}

// ── screensaver: the lab alone, paths and policies in turn ──
let saverTimer = 0;
window.snSaver = {
  enter(opts = {}) {
    document.documentElement.classList.add('avm-saver');
    const paths = Object.keys(PATHS), pols = ['angular', 'off', 'greedy', 'spatial'];
    let k = Math.abs(Math.floor(opts.seed ?? Math.random() * 1e6));
    const shot = () => {
      L.path = paths[k % paths.length]; L.policy = pols[Math.floor(k / paths.length) % pols.length]; k++;
      sync(); restart(); setPlaying(true);
      saverTimer = setTimeout(shot, Math.max(8000, L.poses.length / 3 * STEP_MS + 1500));
    };
    shot();
    return { canvas: $('map'), warmupMs: 800 };
  },
  exit() { clearTimeout(saverTimer); setPlaying(false); document.documentElement.classList.remove('avm-saver'); },
};

buildTables();
buildLab();
