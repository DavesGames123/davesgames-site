// ============================================================================
//  LOSE THE MODIFIER  ·  main.js — input, picker, matches, copy, speech
// ----------------------------------------------------------------------------
//  Boot order: build the family chips, bind the input, show a first pair.
//  What the user types goes through lookup() (matcher.js) on each input
//  event; the top match goes on the stage, the next ones into #more.
//  With an empty input the stage shows pairs from the chosen family.
//
//  grep -n targets
//    "function onInput"        live lookup as you type
//    "function showEntry"      one entry on the stage (static)
//    "function idle"           the empty-input state
//    "function buildPicker"    the family chips
//    "function copyWord"       clipboard and toast
//    "function say"            speechSynthesis, only on a click
//    "function dockToKeyboard" keep the dock on top of a phone keyboard
//    "function setTheme"       dark or light, kept in localStorage
// ============================================================================
import { PHRASES, FAMILIES } from './phrases.js';
import { lookup } from './matcher.js';
import { createStage, famLabel } from './stage.js';

const $ = id => document.getElementById(id);
const q = $('q');
export const stage = createStage({ big: $('big'), eq: $('eq'), alts: $('alts'), ex: $('ex'), fam: $('fam') });
export const S = { family: 'all', cur: null, word: '', results: [], typing: false };

// ── pool and picker ────────────────────────────────────────────────────────
export function pool() { return S.family === 'all' ? PHRASES : PHRASES.filter(e => e.family === S.family); }
export function randomEntry(avoid) {
  const p = pool();
  let e = p[Math.floor(Math.random() * p.length)];
  if (p.length > 1 && e === avoid) e = p[(p.indexOf(e) + 1) % p.length];
  return e;
}

function buildPicker() {
  const counts = {};
  for (const e of PHRASES) counts[e.family] = (counts[e.family] || 0) + 1;
  const items = [{ id: 'all', label: 'all', n: PHRASES.length }].concat(FAMILIES.map(f => ({ id: f.id, label: f.label, n: counts[f.id] || 0 })));
  const box = $('picker');
  box.innerHTML = items.map(it => `<button role="tab" data-f="${it.id}" class="${it.id === S.family ? 'on' : ''}" aria-selected="${it.id === S.family}">${it.label}<sup>${it.n}</sup></button>`).join('');
  box.onclick = ev => {
    const b = ev.target.closest('button'); if (!b) return;
    S.family = b.dataset.f;
    box.querySelectorAll('button').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
    if (q.value.trim()) onInput(); else hooks.familyChanged();
  };
  $('counts').textContent = items.map(it => `${it.label} ${it.n}`).join(' · ');
}

// ── stage ──────────────────────────────────────────────────────────────────
export function showEntry(e, { word = e.targets[0], how = '' } = {}) {
  S.cur = e; S.word = word;
  stage.show(e, { word, how, onPick: w => { showEntry(e, { word: w, how }); copyWord(w); } });
  document.querySelectorAll('#more .row').forEach(r => r.classList.toggle('on', +r.dataset.id === e.id));
}

// Hooks that cycle.js replaces: what the empty input does.
export const hooks = {
  idle() { showEntry(randomEntry(S.cur)); },
  familyChanged() { showEntry(randomEntry(S.cur)); },
  next() { showEntry(randomEntry(S.cur)); },
  typing() {},
};

function idle() {
  S.typing = false; S.results = [];
  $('more').innerHTML = '';
  hooks.idle();
}

// ── input ──────────────────────────────────────────────────────────────────
function onInput() {
  const v = q.value;
  $('clearQ').hidden = !v;
  if (!v.trim()) { idle(); return; }
  S.typing = true; hooks.typing();
  const res = lookup(v, PHRASES, { family: S.family === 'all' ? '' : S.family, limit: 25 });
  S.results = res;
  if (!res.length) { S.cur = null; S.word = ''; stage.none(v.trim()); $('more').innerHTML = ''; return; }
  const top = res[0];
  if (S.cur !== top.e || S.how !== top.how) showEntry(top.e, { how: top.how });
  S.how = top.how;
  const rest = res.slice(1, 13);
  $('more').innerHTML = rest.length ? '<h2>Other matches</h2>' + rest.map(r => {
    const e = r.e, i = e.base ? (e.modFirst ? `<i>${e.mod}</i> ${e.base}` : `${e.base} <i>${e.mod}</i>`) : `<i>${e.phrase}</i>`;
    return `<button class="row" data-id="${e.id}"><span class="w">${i}</span><span class="s">${e.targets[0]}</span></button>`;
  }).join('') : '';
}
$('more').addEventListener('click', ev => {
  const b = ev.target.closest('.row'); if (!b) return;
  const r = S.results.find(r => r.e.id === +b.dataset.id);
  if (r) showEntry(r.e, { how: r.how });
});

// ── copy, toast, speech ────────────────────────────────────────────────────
let toastT = 0;
export function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1400);
}
export async function copyWord(w) {
  if (!w) return;
  try { await navigator.clipboard.writeText(w); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = w; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select(); try { document.execCommand('copy'); } catch (e2) { /* nothing more to try */ } ta.remove();
  }
  toast(`Copied “${w}”`);
}
function say(w) {
  if (!w || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(w);
  const v = speechSynthesis.getVoices().find(v => /^en[-_](US|GB)/i.test(v.lang)) || speechSynthesis.getVoices().find(v => /^en/i.test(v.lang));
  if (v) u.voice = v;
  u.lang = v ? v.lang : 'en-US'; u.rate = 0.92;
  speechSynthesis.speak(u);
}
const curWord = () => S.word || (S.cur && S.cur.targets[0]) || '';
$('copyBtn').onclick = () => copyWord(curWord());
$('sayBtn').onclick = () => say(curWord());
if (!('speechSynthesis' in window)) { $('sayBtn').disabled = true; $('sayBtn').title = 'This browser has no speech'; }
$('big').addEventListener('click', ev => { const s = ev.target.closest('.s'); if (s) copyWord(s.dataset.word); });
$('nextBtn').onclick = () => { if (q.value) { q.value = ''; $('clearQ').hidden = true; S.typing = false; $('more').innerHTML = ''; } hooks.next(); };

q.addEventListener('input', onInput);
q.addEventListener('keydown', ev => {
  if (ev.key === 'Enter') { ev.preventDefault(); copyWord(curWord()); }
  if (ev.key === 'Escape') { q.value = ''; onInput(); }
});
$('clearQ').onclick = () => { q.value = ''; onInput(); q.focus(); };

// ── theme ──────────────────────────────────────────────────────────────────
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('ltm-theme', t); } catch (e) { /* private mode: no memory */ }
}
const curTheme = () => document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
$('themeBtn').onclick = $('themeBtn2').onclick = () => setTheme(curTheme() === 'dark' ? 'light' : 'dark');
$('aboutBtn').onclick = () => $('about').showModal();
$('about').addEventListener('click', ev => { if (ev.target === $('about')) $('about').close(); });

// ── layout: dock height, phone keyboard ────────────────────────────────────
function dockToKeyboard() {
  const vv = window.visualViewport;
  const kb = vv ? Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) : 0;
  document.documentElement.style.setProperty('--kb', kb + 'px');
  document.documentElement.classList.toggle('kb-open', kb > 80 || (document.activeElement === q && matchMedia('(pointer:coarse)').matches));
}
if (window.visualViewport) { visualViewport.addEventListener('resize', dockToKeyboard); visualViewport.addEventListener('scroll', dockToKeyboard); }
q.addEventListener('focus', dockToKeyboard); q.addEventListener('blur', () => setTimeout(dockToKeyboard, 50));
new ResizeObserver(() => document.documentElement.style.setProperty('--dock-h', $('dock').offsetHeight + 'px')).observe($('dock'));
let fitT = 0;
addEventListener('resize', () => { clearTimeout(fitT); fitT = setTimeout(() => { if (S.cur) stage.fit(S.cur, [S.word || S.cur.targets[0]], false); }, 120); });

// ── modes ──────────────────────────────────────────────────────────────────
export const modes = { words: $('words') };
document.querySelectorAll('.modes button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
export function setMode(m) {
  if (!modes[m]) return;
  document.querySelectorAll('.modes button').forEach(x => { const on = x.dataset.mode === m; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
  for (const [k, el] of Object.entries(modes)) el.hidden = k !== m;
  $('dock').hidden = m !== 'words';
  document.documentElement.dataset.mode = m;
  hooks.mode && hooks.mode(m);
}

// ── boot ───────────────────────────────────────────────────────────────────
buildPicker();
const startQ = new URLSearchParams(location.search).get('q');
if (startQ) { q.value = startQ; }
const boot = () => { if (q.value) onInput(); else idle(); };
if (document.fonts && document.fonts.load) Promise.all([document.fonts.load("700 100px 'Space Grotesk'"), document.fonts.load("500 100px 'IBM Plex Mono'")]).then(boot, boot);
else boot();
window.__ltm = { S, PHRASES, lookup, stage, famLabel, onInput, setMode };
