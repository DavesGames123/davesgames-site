// ============================================================================
//  MOLECULES  ·  saver.js  ·  window.snSaver, the screensaver tour
// ----------------------------------------------------------------------------
//  The shell (lib/screensaver.js) calls snSaver.enter(opts), opts = { calm,
//  seconds, caption, seed, label }. enter hides the GUI (html.sn-saver:
//  only the 3D canvas stays, full frame) and plays shots in a seeded
//  shuffle, a new order each run. Each shot holds 5-12 s (calm makes them
//  longer). A cut fades the canvas through black by the tone-mapping
//  exposure, so a recording of the canvas alone has the fade too.
//
//  Shots (the molecule: a seeded shuffle of the famous ones)
//    draw     the skeletal formula draws itself bond by bond as thin white
//             ink (heteroatom labels as sprites), then lifts into the 3D
//             ball-and-stick model and turns
//    ball     a slow orbit in ball and stick
//    space    a slow orbit of the van der Waals surface (space-filling)
//    groups   ball and stick with the functional groups pulsing
//    family   a montage of three molecules of one family (amino acids,
//             sugars, drugs, nucleic acids, vitamins, hormones)
//  The molecule is framed in the clear band of the label plate (plateBand).
//  Each shot sends the plate: the name, the category, the formula and the
//  molar mass, the description, and as code either the SMILES or (draw
//  shots) the real drawOrder source from draw2d.js.
//
//  snSaver.debug() returns the director state for CDP checks.
//  grep -n targets: "const SHOTS", "function frameRect", "function plate"
// ============================================================================
import { plateBand } from '../../lib/saver-clear.js';
import { CAT_NAME, findGroups, GROUP_INFO, formulaParts } from './chem.js';
import { model } from './browse.js';

let CODE = `export function drawOrder(M) {
  const seen = new Uint8Array(M.n), used = new Uint8Array(M.nShown), out = [];
  for (let s = 0; s < M.n; s++) {
    if (seen[s]) continue;
    const q = [s]; seen[s] = 1;
    while (q.length) {
      const a = q.shift();
      for (const e of M.nb[a]) { /* each bond once, breadth first */ }
    }
  }
  return out;
}`;

const FAMILIES = [['amino', 'Amino acids'], ['sugars', 'Sugars'], ['drugs', 'Pharmaceuticals'], ['nucleic', 'Nucleobases and nucleotides'], ['vitamins', 'Vitamins'], ['hormones', 'Hormones and neurotransmitters'], ['flavours', 'Flavours and fragrances']];
const texFormula = f => formulaParts(f).filter(p => p[0] !== 'charge').map(([s, n]) => `\\text{${s}}${n > 1 ? `_{${n}}` : ''}`).join('');
const uniFormula = f => formulaParts(f).map(([s, n]) => s === 'charge' ? n.replace('-', '⁻').replace('+', '⁺') : s + (n > 1 ? String(n).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[+d]).join('') : '')).join('');

export function installSaver(api) {
  const { sides, show, LIB } = api;
  fetch(new URL('draw2d.js', import.meta.url)).then(r => r.text()).then(t => {
    const i = t.indexOf('export function drawOrder'), j = t.indexOf('\n}\n', i);
    if (i >= 0 && j > i) CODE = t.slice(i, j + 2).trim();
  }).catch(() => {});
  let run = null;

  window.snSaver = {
    enter(opts = {}) {
      const side = sides.a, v = side.view;
      if (!v) return null;
      const calm = Math.max(0, Math.min(1, opts.calm ?? 0.7));
      let seed = (opts.seed >>> 0) || 1;
      const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
      const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
      const label = typeof opts.label === 'function' ? opts.label : null;
      document.documentElement.classList.add('sn-saver');
      const saved = { groups: api.S.groups, style: v.style, showH: v.showH, spin: v.controls.autoRotate, speed: v.controls.autoRotateSpeed, rec: side.rec, labels: v.labelMode, exp: v.renderer.toneMappingExposure };
      v.controls.enabled = false;
      v.setLabels('none');
      const famous = shuffle(LIB.recs.filter(r => r.fam && r.p3));
      const kinds = shuffle(['draw', 'draw', 'ball', 'space', 'groups', 'family', 'draw', 'ball', 'space', 'groups']);
      const hold = () => (5.5 + 5 * calm + rnd() * 1.5) * 1000;
      run = { saved, kinds, i: -1, mi: 0, shot: null, t0: 0, going: false, band: null, bandAt: -1e9, rect: null, raf: 0, fade: 1 };

      // ── framing in the plate's clear band ────────────────────────────────
      const frameRect = force => {
        const now = performance.now();
        if (!force && now - run.bandAt < 400) return;
        run.bandAt = now;
        const W = innerWidth, H = innerHeight, b = plateBand(H);
        const top = b ? b.t : 0, bot = b ? b.b : 0, w = b ? Math.min(W, b.w) : W;
        const h = Math.max(0.3 * H, H - top - bot);
        const r = { x: (W - w) / 2 + w * 0.06, y: top, w: w * 0.88, h };
        const key = JSON.stringify(r);
        if (key !== run.rectKey) { run.rectKey = key; run.rect = r; v.setRect(r); }
      };
      const nextMol = () => famous[run.mi++ % famous.length];
      const SHOTS = {
        draw: () => ({ rec: nextMol(), style: 'ball', title: 'Drawn, then lifted into 3D', draw: true }),
        ball: () => ({ rec: nextMol(), style: 'ball', title: 'Ball and stick' }),
        space: () => ({ rec: nextMol(), style: 'space', title: 'Space-filling: van der Waals radii' }),
        groups: () => {
          let rec = nextMol(), tries = 0;
          while (findGroups(model(rec)).length < 2 && tries++ < 6) rec = nextMol();
          return { rec, style: 'ball', title: 'Functional groups', groups: true };
        },
        family: () => {
          const [cat, name] = FAMILIES[Math.floor(rnd() * FAMILIES.length)];
          const pool = shuffle(LIB.recs.filter(r => r.c === cat && r.p3 && model(r).n >= 5 && model(r).n <= 45));
          return { rec: pool[0], fam: pool.slice(0, 3), famName: name, style: rnd() < 0.5 ? 'ball' : 'stick', title: name };
        },
      };
      const apply = (s, rec) => {
        show('a', rec, { noHash: true });
        v.setStyle(s.style); v.setShowH(true);
        api.setGroups(!!s.groups);
        v.controls.autoRotateSpeed = (0.9 - 0.45 * calm) * (rnd() < 0.5 ? 1 : -1);
        if (s.draw) { v.setMorph(0); v.setInk(1); v.setReveal(0); v.setSpin(false); }
        else { v.setMorph(1); v.setInk(0); v.setReveal(null); v.setSpin(true); tilt(); }
        frameRect(true); v.fit(true);
        if (!s.draw) tilt();
      };
      // a start view from a random side, a little above the plane
      const tilt = () => {
        const p = v.camera.position, d = p.length(), az = rnd() * Math.PI * 2, el = (rnd() - 0.4) * 0.6;
        p.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
        v.camera.lookAt(0, 0, 0); v.dirty = true;
      };
      const start = () => {
        run.i = (run.i + 1) % kinds.length;
        const s = run.shot = SHOTS[kinds[run.i]]();
        s.kind = kinds[run.i]; s.dur = hold() * (s.kind === 'draw' ? 1.35 : s.kind === 'family' ? 1.4 : 1);
        s.fi = 0;
        apply(s, s.rec);
        run.t0 = performance.now();
        plate();
      };
      const fadeTo = fn => {
        if (run.going) return; run.going = true;
        const t0 = performance.now();
        const step = () => {
          if (!run) return;
          const k = (performance.now() - t0) / 600;
          if (k < 1) { run.fade = 1 - k; requestAnimationFrame(step); return; }
          run.fade = 0; fn();
          const t1 = performance.now();
          const up = () => { if (!run) return; const u = (performance.now() - t1) / 700; run.fade = Math.min(1, u); if (u < 1) requestAnimationFrame(up); else run.going = false; };
          requestAnimationFrame(up);
        };
        requestAnimationFrame(step);
      };
      const plate = () => {
        if (!label || !run || !run.shot) return;
        const s = run.shot, rec = side.rec, M = side.M;
        const groups = s.groups ? [...new Set(findGroups(M).map(g => GROUP_INFO[g.id].name))] : [];
        const params = [
          { sym: texFormula(rec.f), name: 'molecular formula', value: `${M.N} atoms`, cls: 'm2' },
          { sym: 'M', name: 'molar mass', value: (+rec.w).toFixed(2) + ' g/mol', cls: 'm1' },
        ];
        if (groups.length) params.push({ sym: 'n', name: 'functional groups', value: String(groups.length), cls: 'm5' });
        const lines = [rec.d];
        if (groups.length) lines.push(groups.slice(0, 5).join(' · '));
        if (s.kind === 'family') lines.push(`${s.famName}: ${s.fam.map(r => r.n).join(', ')}`);
        label({
          title: rec.n,
          sub: `${s.title} · ${CAT_NAME[rec.c] || ''}`,
          params, lines,
          eq: [uniFormula(rec.f) + ' · ' + (+rec.w).toFixed(2) + ' g/mol'],
          code: s.draw ? { lang: 'js', name: 'draw2d.js · drawOrder, the order the bonds are drawn', text: CODE }
            : { lang: 'smiles', name: `SMILES · PubChem CID ${rec.cid || '—'}`, text: (rec.s || '').replace(/(.{46})/g, '$1\n').trim() },
          anchor: () => { const r = run && run.rect; return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2, r: Math.min(r.w, r.h) * 0.36 } : null; },
        });
      };

      // ── director ────────────────────────────────────────────────────────
      const tick = now => {
        if (!run) return;
        run.raf = requestAnimationFrame(tick);
        frameRect(false);
        const s = run.shot; if (!s) return;
        const t = (now - run.t0) / s.dur;
        if (s.draw) {
          const nb = side.M.nShown, drawEnd = 0.45, liftEnd = 0.68;
          if (t < drawEnd) { v.setReveal(Math.max(0, t / drawEnd) * (nb + 0.5) - 0.2); v.setInk(1); v.setMorph(0); }
          else if (t < liftEnd) {
            const u = (t - drawEnd) / (liftEnd - drawEnd);
            v.setReveal(null); v.setInk(Math.max(0, 1 - u * 1.6)); v.setMorph(u);
            if (u > 0.98) v.fit(false);
          } else { if (v.morph !== 1) { v.setMorph(1); v.setInk(0); v.fit(false); } if (!v.controls.autoRotate) v.setSpin(true); }
        }
        if (s.groups) v.haloMat.opacity = 0.22 + 0.22 * (0.5 + 0.5 * Math.sin(now / 1000 * Math.PI * 0.8));
        else v.haloMat.opacity = 0.38;
        if (s.kind === 'family' && s.fam.length > 1) {
          const k = Math.min(s.fam.length - 1, Math.floor(t * s.fam.length));
          if (k !== s.fi && !run.going) { s.fi = k; fadeTo(() => { apply(s, s.fam[k]); plate(); }); }
        }
        v.renderer.toneMappingExposure = 1.05 * run.fade; v.dirty = true;
        if (t >= 1 && !run.going) fadeTo(start);
      };
      start();
      run.raf = requestAnimationFrame(tick);
      return { canvas: v.canvas, warmupMs: 700 };
    },
    exit() {
      if (!run) return;
      cancelAnimationFrame(run.raf);
      const saved = run.saved;
      run = null;
      const side = sides.a, v = side.view;
      document.documentElement.classList.remove('sn-saver');
      if (v) {
        v.controls.enabled = true; v.setRect(null); v.setReveal(null); v.setInk(0); v.setMorph(1);
        v.renderer.toneMappingExposure = 1.05; v.haloMat.opacity = 0.38;
        v.setStyle(api.S.style); v.setSpin(api.S.spin); v.setLabels(api.S.labels);
      }
      api.setGroups(saved.groups);
      if (saved.rec) show('a', saved.rec, { noHash: true });
    },
    debug() {
      const side = sides.a;
      return run ? { kind: run.shot && run.shot.kind, mol: side.rec && side.rec.id, i: run.i, kinds: run.kinds, rect: run.rect, fade: run.fade, morph: side.view.morph, ink: side.view.ink } : null;
    },
  };
}
