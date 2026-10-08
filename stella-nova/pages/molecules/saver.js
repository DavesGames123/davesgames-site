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
//    metal    a metal complex (METALS: ferrocene, ruthenocene, Fe(CO)5,
//             OsO4, the carbonyls) in ball and stick, seen from the side
//             so a sandwich shows its two rings
//  The molecule is framed in the clear band of the label plate (plateBand).
//  A draw shot frames the flat drawing by its own box (drawDist), then
//  the camera eases out to the 3D fit while the drawing lifts. Its rect
//  is the clear area left of the plate's code box (sideBox).
//  Each shot sends the plate: the name, the category, the formula and the
//  molar mass, the description, and as code either the SMILES or (draw
//  shots) the breadth-first walk of drawOrder, read from draw2d.js.
//
//  snSaver.debug() returns the director state for CDP checks.
//  grep -n targets: "const SHOTS", "const frameRect", "const plate",
//  "const drawDist", "const sideBox", "const METALS"
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

// metal complexes with a built 3D geometry (build/special.mjs)
const METALS = ['ferrocene', 'ruthenocene', 'iron-pentacarbonyl', 'osmium-tetroxide', 'chromium-hexacarbonyl', 'nickel-tetracarbonyl'];
const FAMILIES = [['amino', 'Amino acids'], ['sugars', 'Sugars'], ['drugs', 'Pharmaceuticals'], ['nucleic', 'Nucleobases and nucleotides'], ['vitamins', 'Vitamins'], ['hormones', 'Hormones and neurotransmitters'], ['flavours', 'Flavours and fragrances']];
const texFormula = f => formulaParts(f).filter(p => p[0] !== 'charge').map(([s, n]) => `\\text{${s}}${n > 1 ? `_{${n}}` : ''}`).join('');
const uniFormula = f => formulaParts(f).map(([s, n]) => s === 'charge' ? n.replace('-', '⁻').replace('+', '⁺') : s + (n > 1 ? String(n).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[+d]).join('') : '')).join('');

export function installSaver(api) {
  const { sides, show, LIB } = api;
  fetch(new URL('draw2d.js', import.meta.url)).then(r => r.text()).then(t => {
    const i = t.indexOf('export function drawOrder'), j = t.indexOf('\n}\n', i);
    // only the breadth-first walk (9 lines, from "for (let s" to the
    // queue push): a short code box leaves a taller clear band
    if (i >= 0 && j > i) {
      const L = t.slice(i, j + 2).split('\n'), a = L.findIndex(l => /for \(let s = 0/.test(l)), b = L.findIndex(l => /q\.push\(e\.to\)/.test(l));
      if (a > 0 && b > a) CODE = L.slice(a, b + 1).join('\n');
    }
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
      const metals = shuffle(METALS.map(id => LIB.recs.find(r => r.id === id)).filter(r => r && r.p3));
      const kinds = shuffle(['draw', 'draw', 'ball', 'space', 'groups', 'family', 'draw', 'ball', 'space', 'groups', ...(metals.length ? ['metal'] : [])]);
      const hold = () => (5.5 + 5 * calm + rnd() * 1.5) * 1000;
      run = { seed0: (opts.seed >>> 0) || 1, saved, kinds, i: -1, mi: 0, ki: 0, shot: null, t0: 0, going: false, band: null, bandAt: -1e9, rect: null, raf: 0, fade: 1 };

      // ── framing in the plate's clear band ────────────────────────────────
      const frameRect = force => {
        const now = performance.now();
        if (!force && now - run.bandAt < 400) return;
        run.bandAt = now;
        const W = innerWidth, H = innerHeight, b = plateBand(H);
        // between two shots the plate swaps its text and plateBand gives
        // null for a moment: keep the last band, or the next molecule
        // shows full frame (under the plate) and then jumps into the band
        if (!b && run.rect && run.rectWH === W + 'x' + H) return;
        run.rectWH = W + 'x' + H;
        const top = b ? b.t : 0, bot = b ? b.b : 0, w = b ? Math.min(W, b.w) : W;
        const h = Math.max(0.3 * H, H - top - bot);
        let r = { x: (W - w) / 2 + w * 0.06, y: top, w: w * 0.88, h };
        // a draw shot has a tall code box at the lower right: frame the
        // molecule in the clear area beside it, down to the left text
        const sb = b && run.shot && run.shot.draw ? sideBox() : null;
        if (sb && sb.codeX > 0.4 * W && sb.colY - 14 - top > 0.3 * H) {
          const x0 = (W - w) / 2 + w * 0.04;
          r = { x: x0, y: top, w: sb.codeX - 24 - x0, h: sb.colY - 14 - top };
        }
        const key = JSON.stringify(r);
        if (key !== run.rectKey) { run.rectKey = key; run.rect = r; v.setRect(r); }
      };
      // the code box of the plate and the top of the text in the left
      // column of its lower slot, in this page's CSS px (null in the
      // 9:16 frame, or when the plate has no code box)
      const sideBox = () => {
        try {
          const doc = window.parent !== window ? window.parent.document : null, fr = window.frameElement;
          const p = doc && doc.getElementById('sn-saver-label');
          if (!p || !fr || !p.classList.contains('on') || doc.body.classList.contains('sn-saver-vert')) return null;
          const code = p.querySelector('.slot-bot .code'), col = p.querySelector('.slot-bot .col');
          if (!code || !col) return null;
          const o = fr.getBoundingClientRect(), c = code.getBoundingClientRect(), rg = doc.createRange();
          let y0 = Infinity;
          const walk = n => {
            if (n.nodeType === 3) { if (n.textContent.trim()) { rg.selectNodeContents(n); const q = rg.getBoundingClientRect(); if (q.height > 0) y0 = Math.min(y0, q.top); } return; }
            if (n.nodeType !== 1) return;
            if (n.tagName.toLowerCase() === 'svg') { const q = n.getBoundingClientRect(); if (q.height > 0) y0 = Math.min(y0, q.top); return; }
            for (const k of n.childNodes) walk(k);
          };
          walk(col);
          return c.width > 0 && y0 < Infinity ? { codeX: c.left - o.left, colY: y0 - o.top } : null;
        } catch (e) { return null; }
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
        metal: () => ({ rec: metals[run.ki++ % metals.length], style: 'ball', title: 'Metal complex', side: true }),
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
        else { v.setMorph(1); v.setInk(0); v.setReveal(null); v.setSpin(true); }
        frameRect(true); v.fit(true);
        if (s.draw) { s.rk = run.rectKey; s.d0 = drawDist(); s.d1 = fitDist(); setDist(s.d0); }
        else tilt(s.side ? 0.12 : null);
      };
      // a start view from a random side, a little above the plane
      const tilt = elev => {
        const p = v.camera.position, d = p.length(), az = rnd() * Math.PI * 2, el = elev ?? (rnd() - 0.4) * 0.6;
        p.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
        v.camera.lookAt(0, 0, 0); v.dirty = true;
      };
      // the camera distance at which the flat drawing (face on, at z = 0)
      // fills the band: its own half width and half height, not a sphere
      const drawDist = () => {
        const F = v.flat, n = side.M.N, W = v.canvas.clientWidth || 1, H = v.canvas.clientHeight || 1, r = run.rect || { w: W, h: H };
        let hw = 0, hh = 0;
        for (let i = 0; i < n; i++) { hw = Math.max(hw, Math.abs(F[3 * i])); hh = Math.max(hh, Math.abs(F[3 * i + 1])); }
        hw = Math.max(hw, 2.4); hh = Math.max(hh, 1.6);   // a small molecule (CO2, water) is not drawn huge
        const tv = Math.tan(v.camera.fov * Math.PI / 360);
        return 1.1 * Math.max((hh + 0.7) / (tv * r.h / H), (hw + 0.7) / (tv * (W / H) * r.w / W));
      };
      // the distance of the 3D fit (the bounding sphere, as v.fit)
      const fitDist = () => { const m0 = v.morph; v.morph = 1; v.fit(false); const d = v.camera.position.length(); v.morph = m0; return d; };
      const setDist = d => {
        v.camera.position.setLength(d);
        v.camera.near = Math.max(0.05, d * 0.25); v.camera.far = d * 4;
        v.applyOffset(); v.dirty = true;
      };
      const ease = u => u * u * (3 - 2 * u);
      const start = () => {
        run.i = (run.i + 1) % kinds.length;
        const s = run.shot = SHOTS[kinds[run.i]]();
        s.kind = kinds[run.i]; s.dur = hold() * (s.kind === 'draw' ? 1.35 : s.kind === 'family' ? 1.4 : 1);
        s.fi = 0;
        apply(s, s.rec);
        run.t0 = performance.now();
        plate();
      };
      // stay black until the plate shows the new text and its band holds
      // still for 200 ms (at most 1.5 s), then fade in: the molecule does
      // not jump to a new frame while it is visible. The shot clock waits.
      const reveal = () => {
        const ts = performance.now(); let key = null, since = ts, t1 = 0;
        const up = () => { if (!run) return; const u = (performance.now() - t1) / 700; run.fade = Math.min(1, u); if (u < 1) requestAnimationFrame(up); else run.going = false; };
        const settle = () => {
          if (!run) return;
          const now = performance.now(), on = !label || !!plateBand(innerHeight);
          if (on) { frameRect(true); if (run.rectKey !== key) { key = run.rectKey; since = now; } } else since = now;
          if (now - since < 200 && now - ts < 1500) { requestAnimationFrame(settle); return; }
          t1 = performance.now(); run.t0 += t1 - ts; requestAnimationFrame(up);
        };
        run.going = true; run.fade = 0;
        requestAnimationFrame(settle);
      };
      const fadeTo = fn => {
        if (run.going) return; run.going = true;
        const t0 = performance.now();
        const step = () => {
          if (!run) return;
          const k = (performance.now() - t0) / 600;
          if (k < 1) { run.fade = 1 - k; requestAnimationFrame(step); return; }
          run.fade = 0; fn(); reveal();
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
          // the band moves when the plate text changes: frame again
          if (s.rk !== run.rectKey && t < liftEnd) { s.rk = run.rectKey; s.d0 = drawDist(); s.d1 = fitDist(); }
          if (t < drawEnd) { v.setReveal(Math.max(0, t / drawEnd) * (nb + 0.5) - 0.2); v.setInk(1); v.setMorph(0); setDist(s.d0); }
          else if (t < liftEnd) {
            // the drawing lifts and the camera eases from the drawing's
            // frame to the 3D frame: no jump at the end of the lift
            const u = (t - drawEnd) / (liftEnd - drawEnd);
            v.setReveal(null); v.setInk(Math.max(0, 1 - u * 1.6)); v.setMorph(u);
            setDist(s.d0 + (s.d1 - s.d0) * ease(u));
          } else { if (v.morph !== 1) { v.setMorph(1); v.setInk(0); setDist(s.d1); } if (!v.controls.autoRotate) v.setSpin(true); }
        }
        if (s.groups) v.haloMat.opacity = 0.22 + 0.22 * (0.5 + 0.5 * Math.sin(now / 1000 * Math.PI * 0.8));
        else v.haloMat.opacity = 0.38;
        if (s.kind === 'family' && s.fam.length > 1) {
          const k = Math.min(s.fam.length - 1, Math.floor(t * s.fam.length));
          if (k !== s.fi && !run.going) { s.fi = k; fadeTo(() => { apply(s, s.fam[k]); plate(); }); }
        }
        v.renderer.toneMappingExposure = 1.05 * run.fade; v.dirty = true;
        // at zero exposure the molecule is a black shape on the lit
        // background: hide it while the cut waits for the plate
        v.group.visible = run.fade > 0.02;
        if (t >= 1 && !run.going) fadeTo(start);
      };
      start(); reveal();
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
        v.renderer.toneMappingExposure = 1.05; v.haloMat.opacity = 0.38; v.group.visible = true;
        v.setStyle(api.S.style); v.setSpin(api.S.spin); v.setLabels(api.S.labels);
      }
      api.setGroups(saved.groups);
      if (saved.rec) show('a', saved.rec, { noHash: true });
    },
    debug() {
      const side = sides.a;
      if (!run) return null;
      // box: the screen box (CSS px) of the atom centres as drawn now
      const v = side.view, P = v.pos, cam = v.camera, W = v.canvas.clientWidth, H = v.canvas.clientHeight;
      cam.updateMatrixWorld(); const A = cam.matrixWorldInverse.elements, B = cam.projectionMatrix.elements;
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let i = 0; P && i < P.length / 3; i++) {
        const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
        const ex = A[0] * x + A[4] * y + A[8] * z + A[12], ey = A[1] * x + A[5] * y + A[9] * z + A[13], ez = A[2] * x + A[6] * y + A[10] * z + A[14];
        const cx = B[0] * ex + B[4] * ey + B[8] * ez + B[12], cy = B[1] * ex + B[5] * ey + B[9] * ez + B[13], cw = B[3] * ex + B[7] * ey + B[11] * ez + B[15];
        const sx = (cx / cw + 1) / 2 * W, sy = (1 - cy / cw) / 2 * H;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
      const r1 = n => Math.round(n);
      return { seed: run.seed0, kind: run.shot && run.shot.kind, mol: side.rec && side.rec.id, i: run.i, kinds: run.kinds, rect: run.rect, fade: run.fade, morph: v.morph, ink: v.ink,
        dist: +cam.position.length().toFixed(2), box: [r1(x0), r1(y0), r1(x1), r1(y1)] };
    },
  };
}
