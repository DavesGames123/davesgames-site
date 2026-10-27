// ============================================================================
//  LENIA  ·  app/browser.js — the grouped, searchable catalog
// ----------------------------------------------------------------------------
//  The #browser drawer: family chips, a search field, and the creature list
//  in family groups. Thumbnails draw when they scroll into view.
//
//  GREP MAP
//    grep -n 'function buildBrowser'  family chips and search keys
//    grep -n 'function fillList'      the filtered, grouped list
//    grep -n 'function drawThumb'     catalog thumbnails
//    grep -n 'function markBrowser'   mark the current creature
//    grep -n 'function openBrowser'   open or close the drawer
// ============================================================================
import { familyOf, familyColor, cellsOf, lut } from './catalog.js';
import { $, PHONE_Q, FINE_Q, S } from './state.js';
import { selectCreature } from './creature.js';
import { setOpen } from './controls.js';

function chipEl(f, tag = 'span') {
  const c = document.createElement(tag);
  c.className = 'chip';
  c.style.setProperty('--c', familyColor(f));
  c.textContent = f;
  return c;
}

let famFilter = null;
export function buildBrowser() {
  const fams = [];
  for (const c of S.creatures) { const f = familyOf(c); if (!fams.includes(f)) fams.push(f); }
  const chips = $('famChips');
  chips.textContent = '';
  for (const f of fams) {
    const b = chipEl(f, 'button'); b.type = 'button';
    b.addEventListener('click', () => {
      famFilter = famFilter === f ? null : f;
      for (const x of chips.children) x.classList.toggle('on', x.textContent === famFilter);
      fillList();
    });
    chips.append(b);
  }
  $('search').addEventListener('input', fillList);
  $('search').addEventListener('keydown', e => {
    if (e.key === 'Enter') { const first = $('list').querySelector('.br-item'); if (first) first.click(); }
    if (e.key === 'Escape') { e.stopPropagation(); openBrowser(false); }
  });
  fillList();
}

let thumbIO = null;
export function fillList() {
  const q = $('search').value.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const box = $('list');
  box.textContent = '';
  if (thumbIO) thumbIO.disconnect();
  thumbIO = new IntersectionObserver(ents => {
    for (const e of ents) if (e.isIntersecting) { drawThumb(e.target); thumbIO.unobserve(e.target); }
  }, { root: box, rootMargin: '200px' });
  const groups = new Map();
  S.creatures.forEach((c, i) => {
    const f = familyOf(c);
    if (famFilter && f !== famFilter) return;
    const hay = [c.name, c.code, c.cname, ...c.rank].join(' ').toLowerCase();
    if (!words.every(w => hay.includes(w))) return;
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push(i);
  });
  for (const [f, list] of groups) {
    const g = document.createElement('div'); g.className = 'br-group';
    const h = document.createElement('div'); h.className = 'br-gh';
    const dot = document.createElement('span'); dot.className = 'chip-dot'; dot.style.setProperty('--c', familyColor(f));
    const n = document.createElement('span'); n.className = 'n'; n.textContent = list.length;
    h.append(dot, f, n);
    g.append(h);
    for (const i of list) {
      const c = S.creatures[i];
      const b = document.createElement('button'); b.className = 'br-item'; b.dataset.idx = i;
      const th = document.createElement('canvas'); th.dataset.idx = i;
      const t = document.createElement('span'); t.className = 't';
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = c.name;
      const ct = document.createElement('span'); ct.className = 'ct';
      ct.textContent = `${c.code}${c.cname ? ' · ' + c.cname : ''} · R ${Math.round(c.R * c.scale)}${c.cls === 'grow' ? ' · grows' : ''}`;
      t.append(nm, ct);
      b.append(th, t);
      g.append(b);
      thumbIO.observe(th);
      b.addEventListener('click', () => { selectCreature(i); if (PHONE_Q.matches) openBrowser(false); });
    }
    box.append(g);
  }
  if (!groups.size) { const d = document.createElement('div'); d.className = 'br-empty'; d.textContent = 'No creature matches.'; box.append(d); }
  markBrowser();
}

// The start cells, fit into the thumbnail with the aspect kept.
function drawThumb(cv) {
  const c = S.creatures[+cv.dataset.idx];
  const p = cellsOf(c), L = lut(S.view.palette);
  const img = new ImageData(p.w, p.h);
  for (let i = 0; i < p.w * p.h; i++) {
    const k = Math.round(p.data[i] * 255);
    img.data[i * 4] = L[k * 3]; img.data[i * 4 + 1] = L[k * 3 + 1]; img.data[i * 4 + 2] = L[k * 3 + 2]; img.data[i * 4 + 3] = 255;
  }
  const tmp = document.createElement('canvas'); tmp.width = p.w; tmp.height = p.h;
  tmp.getContext('2d').putImageData(img, 0, 0);
  const size = Math.round((cv.clientWidth || 44) * Math.min(devicePixelRatio || 1, 2));
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  g.fillStyle = `rgb(${L[0]},${L[1]},${L[2]})`;
  g.fillRect(0, 0, size, size);
  const k = size * 0.92 / Math.max(p.w, p.h);
  g.imageSmoothingEnabled = true;
  g.drawImage(tmp, (size - p.w * k) / 2, (size - p.h * k) / 2, p.w * k, p.h * k);
}

export function markBrowser() {
  for (const b of $('list').querySelectorAll('.br-item')) b.classList.toggle('on', +b.dataset.idx === S.idx);
}
export function openBrowser(open) {
  const br = $('browser');
  if (open === undefined) open = !br.classList.contains('open');
  br.classList.toggle('open', open);
  br.setAttribute('aria-hidden', String(!open));
  $('browseBtn').classList.toggle('on', open);
  $('dockCreature').classList.toggle('on', open);
  if (open) {
    if (PHONE_Q.matches) setOpen(false);
    const cur = $('list').querySelector('.br-item.on');
    if (cur) cur.scrollIntoView({ block: 'center' });
    if (FINE_Q.matches) setTimeout(() => $('search').focus({ preventScroll: true }), 50);
  } else if (document.activeElement === $('search')) $('search').blur();
}
