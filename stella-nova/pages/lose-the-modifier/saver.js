// ============================================================================
//  LOSE THE MODIFIER  ·  saver.js — the screensaver hook (window.snSaver)
// ----------------------------------------------------------------------------
//  The shell (lib/screensaver.js) calls snSaver.enter(opts) with
//  { calm 0..1, seconds, caption, seed, label }. enter() puts one canvas in
//  the document over the page, and returns { canvas, warmupMs }. All type
//  is drawn on that canvas at the device pixel ratio, at its real size: no
//  small text is drawn and then scaled up.
//
//  A director plays shots in a seeded shuffle (a new order for each seed;
//  the counters start at zero on each load). A shot is a pure function of
//  its own clock t, so a frame only depends on t and the shot data:
//    edit     two pairs at full size: type in, strike, backspace, type out
//    montage  the family stamps in and is struck, then rapid-fire pairs
//    redline  a sentence types in; its weak phrase is struck and replaced
//    cloud    many weak forms of one word drift, then collapse into the
//             strong word
//    kinetic  the strong word drops in letter by letter, its options roll
//             under it, then the letters fall away
//  Shots last about 5 to 12 s. calm 1 types slower and holds longer.
//  The subject sits in the plate's clear band (lib/saver-clear.js
//  plateBand), read again twice a second.
//
//  grep -n targets
//    "function typed"        letters shown at time t (all type steps)
//    "function shotEdit"     "function shotMontage"  "function shotRedline"
//    "function shotCloud"    "function shotKinetic"
//    "function director"     the seeded shot order and the cuts
//    "function plate"        the label payload (title, pair, family)
//    "window.snSaver"        enter and exit
// ============================================================================
import { PHRASES } from './phrases.js';
import { famLabel, weakParts } from './stage.js';

const C = { bg: '#0b0c0f', ink: '#f3f1ea', dim: '#8d929c', faint: '#3a3e47', hi: '#ffd23f', cut: '#ff5b4d' };
const F = {
  mono: px => `500 ${px.toFixed(1)}px 'IBM Plex Mono', ui-monospace, Menlo, monospace`,
  bold: px => `700 ${px.toFixed(1)}px 'Space Grotesk', system-ui, sans-serif`,
  med: px => `500 ${px.toFixed(1)}px 'Space Grotesk', system-ui, sans-serif`,
  serif: px => `italic 400 ${px.toFixed(1)}px 'Instrument Serif', Georgia, serif`,
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = {
  out: x => 1 - Math.pow(1 - clamp(x, 0, 1), 3),
  in: x => Math.pow(clamp(x, 0, 1), 3),
  back: x => { x = clamp(x, 0, 1); const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); },
};
function mulberry(seed) {
  return () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function shuffle(a, rnd) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// The letters of s shown at time t, for typing that starts at t0 at cps
// letters per second. Backspace is the same with the count reversed.
function typed(s, t, t0, cps) {
  const n = Math.floor((t - t0) * cps);
  return s.slice(0, clamp(n, 0, s.length));
}
function erased(s, t, t0, cps) {
  const n = Math.floor((t - t0) * cps);
  return s.slice(0, s.length - clamp(n, 0, s.length));
}
const blinkOn = t => (t % 1.0) < 0.55;

// ── drawing helpers ────────────────────────────────────────────────────────
let X = null;   // the 2D context of the saver canvas
function text(s, x, y, font, color, align = 'left', alpha = 1) {
  X.font = font; X.fillStyle = color; X.textAlign = align; X.globalAlpha = alpha;
  X.fillText(s, x, y); X.globalAlpha = 1;
}
function width(s, font) { X.font = font; return X.measureText(s).width; }
function caret(x, base, fs, color, on = true) {
  if (!on) return;
  X.fillStyle = color; X.fillRect(x + fs * 0.03, base - fs * 0.78, Math.max(2, fs * 0.055), fs * 0.98);
}
function strike(x0, x1, base, fs, p, color = C.cut) {
  if (p <= 0) return;
  X.fillStyle = color; X.fillRect(x0 - fs * 0.03, base - fs * 0.33, (x1 - x0 + fs * 0.06) * clamp(p, 0, 1), Math.max(2, fs * 0.075));
}
// One size for the weak phrase (mono) and the strong word (bold).
function fitSize(box, weak, strong, k = 0.42) {
  const w = Math.max(width(weak, F.mono(100)), width(strong, F.bold(100))) / 100;
  return clamp(Math.min(box.h * k, box.w * 0.9 / Math.max(w, 0.1)), 18, 220);
}

// ── pair timeline (edit, montage) ──────────────────────────────────────────
// Times in s from the start of the pair. sp: the calm factor (1 = calm 0).
function pairTimes(e, sp) {
  const w = weakParts(e).text, s = e.targets[0];
  const T = {};
  T.typeW = 0.15; T.cpsW = 15 / sp;
  T.doneW = T.typeW + w.length / T.cpsW;
  T.strike = T.doneW + 0.35 * sp;
  T.sel = T.strike + 0.42 * sp;
  T.back = T.sel + 0.16;
  T.cpsB = 34;
  T.typeS = T.back + w.length / T.cpsB + 0.14;
  T.cpsS = 12 / sp;
  T.doneS = T.typeS + s.length / T.cpsS;
  T.hold = T.doneS + (1.5 + 0.2 * Math.min(4, e.targets.length)) * sp;
  T.end = T.hold + s.length / 40 + 0.12;
  return T;
}

// Draw one pair at time t in box (the big line, the tag, the formula).
function drawPair(e, t, box, sp, { cy = box.y + box.h / 2, fsMax = Infinity, tag = true, formula = true } = {}) {
  const T = pairTimes(e, sp), p = weakParts(e), s = e.targets[0];
  const fs = Math.min(fsMax, fitSize(box, p.text, s));
  const base = cy + fs * 0.34, cx = box.x + box.w / 2;
  if (t < T.typeS) {
    const shown = t < T.back ? typed(p.text, t, T.typeW, T.cpsW) : erased(p.text, t, T.back, T.cpsB);
    const font = F.mono(fs), full = width(p.text, font), x0 = cx - full / 2;
    if (t >= T.sel && t < T.back) {
      const a = x0 + width(p.text.slice(0, p.a), font), b = x0 + width(p.text.slice(0, p.b), font);
      X.fillStyle = 'rgba(255,91,77,0.32)'; X.fillRect(a - fs * 0.04, base - fs * 0.86, b - a + fs * 0.08, fs * 1.08);
    }
    // the modifier dims after the strike
    const struck = t >= T.strike;
    for (let i = 0, x = x0; i < shown.length; i++) {
      const ch = shown[i], inMod = i >= p.a && i < p.b;
      text(ch, x, base, font, inMod && struck ? C.dim : C.ink);
      x += width(ch, font);
    }
    if (struck) {
      const a = x0 + width(p.text.slice(0, p.a), font), b = x0 + width(p.text.slice(0, Math.min(p.b, shown.length)), font);
      if (shown.length > p.a) strike(a, b, base, fs, ease.out((t - T.strike) / 0.22));
    }
    const typing = (t > T.typeW && t < T.doneW) || t >= T.back;
    caret(x0 + width(shown, font), base, fs, C.ink, typing || blinkOn(t));
  } else {
    const shown = t < T.hold ? typed(s, t, T.typeS, T.cpsS) : erased(s, t, T.hold, 40);
    const font = F.bold(fs), full = width(s, font), x0 = cx - full / 2;
    text(shown, x0, base, font, C.hi);
    caret(x0 + width(shown, font), base, fs, C.hi, t < T.doneS || blinkOn(t));
  }
  const small = clamp(fs * 0.17, 13, 26);
  if (tag) text(`${famLabel(e.family)} · ${e.pos} · ${e.reg}`, cx, cy - fs * 0.78 - small * 0.2, F.mono(small * 0.85), C.dim, 'center');
  if (formula && t >= T.strike) {
    const y = base + fs * 0.42 + small;
    const parts = [];
    const m = { s: e.mod, c: C.ink, strike: true }, b = { s: e.base, c: C.ink }, op = s => ({ s, c: C.faint });
    if (!e.base) parts.push(m); else if (e.modFirst) parts.push(m, op(' + '), b); else parts.push(b, op(' + '), m);
    if (t >= T.doneS) parts.push(op(' = '), { s, c: C.hi, bold: true });
    const fw = parts.reduce((a, q) => a + width(q.s, q.bold ? F.bold(small) : F.mono(small)), 0);
    let x = cx - fw / 2;
    const a = ease.out((t - T.strike) / 0.2);
    for (const q of parts) {
      const f = q.bold ? F.bold(small) : F.mono(small), w = width(q.s, f);
      text(q.s, x, y + (1 - a) * small * 0.6, f, q.c, 'left', a);
      if (q.strike) strike(x, x + w, y, small, 1);
      x += w;
    }
    if (t >= T.doneS + 0.15 && e.targets.length > 1 && t < T.hold) {
      const al = ease.out((t - T.doneS - 0.15) / 0.25);
      text('also  ' + e.targets.slice(1).join('  ·  '), cx, y + small * 1.7, F.med(small * 0.92), C.dim, 'center', al);
    }
  }
  return T;
}

// ── shots ──────────────────────────────────────────────────────────────────
// Each shot: { kind, dur, draw(t, box), pair(t) -> the entry on screen }.
function shotEdit(pick, sp) {
  const es = [pick(), pick()], Ts = es.map(e => pairTimes(e, sp));
  const starts = [0, Ts[0].end + 0.1];
  const at = t => (t >= starts[1] ? 1 : 0);
  return {
    kind: 'edit', dur: starts[1] + Ts[1].end,
    pair: t => es[at(t)],
    draw(t, box) { const i = at(t); drawPair(es[i], t - starts[i], box, sp); },
  };
}

function shotMontage(pick, sp, rnd) {
  // A family with enough pairs; the pairs come from it.
  const fam = pick().family, pool = shuffle(PHRASES.filter(e => e.family === fam && weakParts(e).text.length <= 22), rnd);
  const n = Math.round(clamp(6 - sp * 1.5, 4, 6)), es = pool.slice(0, n);
  const stamp = 1.15 * sp, per = 1.05 * sp;
  const label = famLabel(fam);
  return {
    kind: 'montage', dur: stamp + es.length * per + 1.4 * sp,
    pair: t => es[clamp(Math.floor((t - stamp) / per), 0, es.length - 1)],
    draw(t, box) {
      const cx = box.x + box.w / 2;
      if (t < stamp) {
        // the family word stamps in, then is struck through
        const fs = Math.min(box.h * 0.62, box.w * 0.8 / Math.max(0.1, width(label, F.bold(100)) / 100));
        const k = 1 + 0.5 * (1 - ease.back(t / 0.28));
        X.save(); X.translate(cx, box.y + box.h / 2); X.scale(k, k);
        const w = width(label, F.bold(fs));
        text(label, -w / 2, fs * 0.34, F.bold(fs), C.ink, 'left', clamp(t / 0.12, 0, 1));
        strike(-w / 2, w / 2, fs * 0.34, fs, ease.out((t - 0.45 * sp) / 0.25));
        X.restore();
        return;
      }
      const u = t - stamp, i = Math.min(es.length - 1, Math.floor(u / per)), lt = u - i * per;
      const small = clamp(box.h * 0.055, 12, 20);
      // The live row sits low in the band; done rows step up, smaller and dimmer.
      const liveY = box.y + box.h * 0.62, step = box.h * 0.27;
      const push = ease.out(lt / 0.2);
      for (let k = Math.max(0, i - 2); k <= i; k++) {
        const e = es[k], p = weakParts(e), s = e.targets[0], live = k === i;
        const pos = live ? 0 : (i - k - 1) + push;          // 0 = live row, 1, 2 = rows above
        const size = live ? 1 : 1 - 0.45 * Math.min(1, pos);
        const alpha = live ? 1 : clamp(1 - 0.38 * pos, 0, 1) * (pos > 1.6 ? clamp((2.4 - pos) / 0.8, 0, 1) : 1);
        const fsLive = Math.min(box.h * 0.3, fitSize({ w: box.w * 0.46, h: 1e9 }, p.text, s, 1));
        const fs = fsLive * size, base = liveY - pos * step + fs * 0.34;
        const wf = F.mono(fs), sf = F.bold(fs), gap = fs * 0.9, ww = width(p.text, wf);
        const xl = box.x + box.w / 2 - gap / 2 - ww, xr = box.x + box.w / 2 + gap / 2;
        const slam = live ? 1 + 0.22 * (1 - ease.back(lt / 0.16)) : 1;
        X.save(); X.translate(xl + ww, base); X.scale(slam, slam); X.translate(-(xl + ww), -base);
        text(p.text, xl, base, wf, live ? C.ink : C.dim, 'left', alpha * (live ? clamp(lt / 0.05, 0, 1) : 1));
        X.restore();
        const s0 = live ? 0.26 * sp : -1;
        if (!live || lt >= s0) {
          const a = xl + width(p.text.slice(0, p.a), wf), b = xl + width(p.text.slice(0, p.b), wf);
          X.globalAlpha = alpha; strike(a, b, base, fs, live ? ease.out((lt - s0) / 0.14) : 1); X.globalAlpha = 1;
        }
        const t0 = 0.42 * sp;
        if (!live || lt >= t0) {
          const shown = live ? typed(s, lt, t0, 26 / sp) : s;
          text('\u2192', box.x + box.w / 2, base, F.med(fs * 0.55), C.faint, 'center', alpha);
          text(shown, xr, base, sf, C.hi, 'left', alpha);
          if (live) caret(xr + width(shown, sf), base, fs, C.hi, shown.length < s.length || blinkOn(lt));
        }
      }
      text(`${label} \u00b7 ${i + 1} / ${es.length}`, box.x + box.w / 2, box.y + box.h - small * 0.2, F.mono(small), C.dim, 'center');
    },
  };
}

// A sentence as runs; layout wraps the words and centres the lines.
function layoutRuns(runs, fs, maxW) {
  const lines = [[]]; let w = 0;
  const font = r => r.k === 'w' ? F.mono(fs * 0.92) : r.k === 's' ? F.bold(fs) : F.med(fs);
  for (const r of runs) {
    for (const piece of r.t.split(/(\s+)/)) {
      if (!piece) continue;
      const f = font(r), pw = width(piece, f), space = /^\s+$/.test(piece);
      if (!space && w + pw > maxW && lines[lines.length - 1].length) { lines.push([]); w = 0; }
      if (space && !lines[lines.length - 1].length) continue;
      lines[lines.length - 1].push({ t: piece, k: r.k, f, w: pw, caret: false });
      w += pw;
    }
  }
  return lines.map(l => { while (l.length && /^\s+$/.test(l[l.length - 1].t)) l.pop(); return l; });
}
function shotRedline(pick, sp) {
  const items = [];
  for (let k = 0; k < 2; k++) {
    if (k === 1 && items.length && items[0].T.end > 6 * sp) break;
    let e = pick(), guard = 0;
    // the first target must occur once in the example, as a word
    const once = e => { const t = e.targets[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return (e.ex.match(new RegExp(`(^|[^A-Za-z'-])${t}(?=$|[^A-Za-z'-])`, 'gi')) || []).length === 1; };
    while ((!once(e) || e.ex.length > 96) && guard++ < 60) e = pick();
    const t = e.targets[0], re = new RegExp(`(^|[^A-Za-z'-])(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=$|[^A-Za-z'-])`, 'i');
    const m = re.exec(e.ex); if (!m) continue;
    const at = m.index + m[1].length, word = m[2];
    const weakTxt = weakParts(e).text, cap = /^[A-Z]/.test(word);
    const weak = cap ? weakTxt[0].toUpperCase() + weakTxt.slice(1) : weakTxt;
    const strong = word;
    // a / an before the weak phrase follows its first word
    const pre = e.ex.slice(0, at).replace(/\b(a|an)(\s+)$/i, (q, a, sp2) => { const an = /^[aeio]/i.test(weak) ? 'an' : 'a'; return (/^A/.test(a) ? an[0].toUpperCase() + an.slice(1) : an) + sp2; });
    const post = e.ex.slice(at + word.length);
    const cps = 30 / sp, all = pre + weak + post;
    const T = { type: 0.2, done: 0.2 + all.length / cps };
    T.mark = T.done + 0.45 * sp; T.strike = T.mark + 0.35 * sp; T.back = T.strike + 0.45 * sp;
    T.typeS = T.back + weak.length / 30 + 0.12; T.doneS = T.typeS + strong.length / (13 / sp);
    T.end = T.doneS + 2.2 * sp;
    items.push({ e, pre, weak, strong, post, all, cps, T });
  }
  const starts = []; let acc = 0;
  for (const it of items) { starts.push(acc); acc += it.T.end; }
  const at = t => { let i = 0; while (i + 1 < starts.length && t >= starts[i + 1]) i++; return i; };
  return {
    kind: 'redline', dur: acc,
    pair: t => items[at(t)].e,
    draw(t, box) {
      const i = at(t), it = items[i], T = it.T, u = t - starts[i];
      // runs at time u
      const n = clamp(Math.floor((u - T.type) * it.cps), 0, it.all.length);
      const runs = [];
      let car = 'n';
      if (u < T.typeS) {
        const w = u < T.back ? it.weak : erased(it.weak, u, T.back, 30);
        const a = it.pre.slice(0, n), b = it.weak.slice(0, Math.max(0, n - it.pre.length)), c = it.post.slice(0, Math.max(0, n - it.pre.length - it.weak.length));
        runs.push({ t: a, k: 'n' });
        // U+200B keeps an empty run in the layout, so the caret has a place
        if (b) runs.push({ t: (u < T.back ? b : w) || '\u200b', k: 'w', mark: u >= T.mark, cut: u >= T.strike ? ease.out((u - T.strike) / 0.22) : 0 });
        if (c) runs.push({ t: c, k: 'n' });
        car = n < it.all.length ? 'end' : (u >= T.back ? 'w' : 'end');
      } else {
        runs.push({ t: it.pre, k: 'n' }, { t: typed(it.strong, u, T.typeS, 13) || '\u200b', k: 's' }, { t: it.post, k: 'n' });
        car = u < T.doneS ? 's' : 'none';
      }
      // one font size for this sentence: the most lines that fit
      let fs = clamp(box.h * 0.2, 18, 64);
      const full = [{ t: it.pre, k: 'n' }, { t: it.weak, k: 'w' }, { t: it.post, k: 'n' }];
      for (; fs > 16; fs -= 2) { const L = layoutRuns(full, fs, box.w * 0.88); if (L.length * fs * 1.32 <= box.h * 0.78 && L.length <= 4) break; }
      const lines = layoutRuns(runs.map(r => ({ ...r })), fs, box.w * 0.88);
      // keep the mark state per piece
      let ri = 0;
      for (const l of lines) for (const p of l) { while (ri < runs.length - 1 && runs[ri].k !== p.k) ri++; p.mark = runs[ri].mark; p.cut = runs[ri].cut; }
      const lh = fs * 1.32, top = box.y + box.h / 2 - (lines.length * lh) / 2 + fs * 0.95;
      let cx = null, cy = 0, lastX = box.x + box.w / 2, lastY = top;
      lines.forEach((l, li) => {
        const lw = l.reduce((a, p) => a + p.w, 0);
        let x = box.x + box.w / 2 - lw / 2; const y = top + li * lh;
        for (const p of l) {
          if (p.k === 'w' && p.mark && !/^\s+$/.test(p.t)) { X.fillStyle = 'rgba(255,91,77,0.26)'; X.fillRect(x - 2, y - fs * 0.82, p.w + 4, fs * 1.06); }
          text(p.t, x, y, p.f, p.k === 's' ? C.hi : p.k === 'w' ? (p.cut ? C.dim : C.ink) : C.ink);
          if (p.k === 'w' && p.cut && !/^\s+$/.test(p.t)) strike(x, x + p.w, y, fs, p.cut);
          if ((car === 'w' && p.k === 'w') || (car === 's' && p.k === 's')) { cx = x + p.w; cy = y; }
          x += p.w; lastX = x; lastY = y;
        }
      });
      if (car === 'end') { cx = lastX; cy = lastY; }
      if (car === 's' && cx === null) { cx = lastX; cy = lastY; }
      if (cx !== null && car !== 'none') caret(cx, cy, fs, car === 's' ? C.hi : C.ink, true);
      const small = clamp(fs * 0.36, 12, 18);
      text(`redline · ${famLabel(it.e.family)}`, box.x + box.w / 2, box.y + small, F.mono(small), C.dim, 'center');
    },
  };
}

const CLOUD_MODS = ['very', 'really', 'so', 'extremely', 'super', 'incredibly', 'awfully', 'terribly', 'truly', 'quite', 'pretty', 'rather', 'seriously', 'way too'];
function shotCloud(pick, sp, rnd) {
  let e = pick(), guard = 0;
  while ((!e.base || e.base.includes(' ') || e.pos !== 'adj') && guard++ < 80) e = pick();
  const known = PHRASES.filter(x => x.base === e.base).map(x => x.phrase);
  const words = Array.from(new Set(known.concat(shuffle(CLOUD_MODS.slice(), rnd).map(m => m + ' ' + e.base)))).slice(0, 14);
  const items = words.map(w => ({ w, x: rnd() * 2 - 1, y: rnd() * 2 - 1, s: 0.55 + rnd() * 0.75, ph: rnd() * 6.28, d: rnd() * 0.5 }));
  const T = { in: 0.15, collapse: 2.6 * sp, land: 2.6 * sp + 0.55, end: 2.6 * sp + 0.55 + 3.2 * sp };
  return {
    kind: 'cloud', dur: T.end,
    pair: () => e,
    draw(t, box) {
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      const base = clamp(box.h * 0.085, 13, 30);
      for (const it of items) {
        const appear = ease.out((t - T.in - it.d * 0.8) / 0.3);
        const k = ease.in((t - T.collapse - it.d * 0.25) / 0.45);
        if (appear <= 0 || k >= 1) continue;
        const dx = it.x * box.w * 0.42 + Math.sin(t * 0.7 + it.ph) * 8, dy = it.y * box.h * 0.38 + Math.cos(t * 0.6 + it.ph) * 6;
        const x = cx + dx * (1 - k), y = cy + dy * (1 - k), fs = base * it.s * (1 - 0.6 * k);
        text(it.w, x, y + fs * 0.34, F.mono(fs), C.ink, 'center', appear * (0.35 + 0.5 * it.s / 1.3) * (1 - k));
        const half = width(it.w, F.mono(fs)) / 2, mw = width(it.w.slice(0, it.w.length - e.base.length).trimEnd(), F.mono(fs));
        if (t > T.collapse - 0.6 * sp) { X.globalAlpha = appear * (1 - k) * 0.8; strike(x - half, x - half + mw, y + fs * 0.34, fs, ease.out((t - T.collapse + 0.6 * sp - it.d * 0.4) / 0.2)); X.globalAlpha = 1; }
      }
      if (t >= T.land - 0.12) {
        const s = e.targets[0], fs = fitSize(box, '', s, 0.46);
        const k = ease.back((t - T.land + 0.12) / 0.35), w = width(s, F.bold(fs));
        X.save(); X.translate(cx, cy); X.scale(0.4 + 0.6 * k, 0.4 + 0.6 * k);
        text(s, -w / 2, fs * 0.34, F.bold(fs), C.hi, 'left', clamp(k, 0, 1));
        X.restore();
        const small = clamp(fs * 0.18, 13, 24);
        const a = ease.out((t - T.land - 0.4) / 0.3);
        text(`${words.length} weak forms of “${e.base}” → one word`, cx, cy + fs * 0.34 + small * 1.9, F.mono(small * 0.85), C.dim, 'center', a);
      }
    },
  };
}

function shotKinetic(pick, sp) {
  const es = [pick(), pick()].map(e => e.targets.length > 1 ? e : e);
  const one = e => { const s = e.targets[0]; const T = { drop: 0.2, per: 0.065 * sp }; T.landed = T.drop + s.length * T.per + 0.3; T.roll = T.landed + 0.6 * sp; T.rollEach = 0.75 * sp; T.out = T.roll + Math.max(1, e.targets.length - 1) * T.rollEach + 0.9 * sp; T.end = T.out + 0.55; return T; };
  const Ts = es.map(one), starts = [0, Ts[0].end];
  const at = t => (t >= starts[1] ? 1 : 0);
  return {
    kind: 'kinetic', dur: starts[1] + Ts[1].end,
    pair: t => es[at(t)],
    draw(t, box) {
      const i = at(t), e = es[i], T = Ts[i], u = t - starts[i], s = e.targets[0];
      const cx = box.x + box.w / 2, fs = fitSize(box, '', s, 0.44), font = F.bold(fs);
      const p = weakParts(e), small = clamp(fs * 0.24, 13, 30), wf = F.mono(small), ww = width(p.text, wf);
      // centre the stack: the weak line, the word, the options
      const w = width(s, font), cy = box.y + box.h / 2 - (0.09 * fs + 0.75 * small) / 2, base = cy + fs * 0.34;
      // the weak phrase, small and struck, above
      const a0 = ease.out(u / 0.2);
      text(p.text, cx - ww / 2, cy - fs * 0.7, wf, C.dim, 'left', a0);
      strike(cx - ww / 2 + width(p.text.slice(0, p.a), wf), cx - ww / 2 + width(p.text.slice(0, p.b), wf), cy - fs * 0.7, small, ease.out((u - 0.15) / 0.2));
      // letters drop in, then fall away
      let x = cx - w / 2;
      for (let k = 0; k < s.length; k++) {
        const ch = s[k], cw = width(ch, font);
        const d = ease.back((u - T.drop - k * T.per) / 0.32);
        const fall = ease.in((u - T.out - (s.length - k) * 0.025) / 0.35);
        if (d > 0 && fall < 1) {
          const y = base - (1 - d) * fs * 0.7 + fall * fs * 1.4;
          X.save(); X.translate(x + cw / 2, y); X.rotate(fall * (k % 2 ? 0.5 : -0.4));
          text(ch, -cw / 2, 0, font, C.hi, 'left', clamp(d * 1.4, 0, 1) * (1 - fall));
          X.restore();
        }
        x += cw;
      }
      if (u > T.landed && u < T.out) caret(cx + w / 2, base, fs, C.hi, blinkOn(u));
      // the options roll under the word
      if (e.targets.length > 1 && u > T.roll - 0.3 && u < T.out + 0.2) {
        const opts = e.targets.slice(1), r = (u - T.roll) / T.rollEach, j = clamp(Math.floor(r), 0, opts.length - 1);
        const f = r - Math.floor(r), slide = j < opts.length - 1 ? ease.out((f - 0.7) / 0.3) : 0;
        const y = base + fs * 0.45 + small * 1.3, rh = small * 1.5;
        X.save(); X.beginPath(); X.rect(box.x, y - rh, box.w, rh * 1.35); X.clip();
        const al = ease.out((u - T.roll + 0.3) / 0.3) * (1 - ease.out((u - T.out) / 0.2));
        text('or  ' + opts[j], cx, y - slide * rh, F.med(small), C.ink, 'center', al);
        if (j + 1 < opts.length) text('or  ' + opts[j + 1], cx, y + rh - slide * rh, F.med(small), C.ink, 'center', al);
        X.restore();
      }
    },
  };
}

// ── director ───────────────────────────────────────────────────────────────
const KINDS = { edit: shotEdit, montage: shotMontage, redline: shotRedline, cloud: shotCloud, kinetic: shotKinetic };
function director(seed, calm) {
  const rnd = mulberry((seed >>> 0) || 1);
  const sp = 1 + 0.6 * clamp(calm, 0, 1);        // calm 1: 1.6x slower
  const pool = shuffle(PHRASES.filter(e => weakParts(e).text.length <= 28 && e.targets[0].length <= 16).slice(), rnd);
  let pi = 0;
  const pick = () => pool[pi++ % pool.length];
  let order = [], oi = 0, last = '';
  const nextKind = () => {
    if (oi >= order.length) { order = shuffle(Object.keys(KINDS), rnd); if (order[0] === last) order.push(order.shift()); oi = 0; }
    return (last = order[oi++]);
  };
  return { next: () => { const k = nextKind(); const s = KINDS[k](pick, sp, rnd); s.dur = clamp(s.dur, 4, 14); return s; } };
}

// ── label plate ────────────────────────────────────────────────────────────
// The plate has no code extract: the user wants the words alone.
function plate(e) {
  const p = weakParts(e);
  const left = !e.base ? e.mod : e.modFirst ? `${e.mod} + ${e.base}` : `${e.base} + ${e.mod}`;
  return {
    title: 'Lose the Modifier',
    sub: `${left} = ${e.targets[0]}`,
    lines: [`${famLabel(e.family)} family · ${e.pos} · ${e.reg}`, `${p.text.slice(p.a, p.b)} goes, one word stays`],
  };
}

// ── hook ───────────────────────────────────────────────────────────────────
export function installSaver({ onEnter, onExit }) {
  let R = null;
  function frame(now) {
    if (!R) return;
    R.raf = requestAnimationFrame(frame);
    const W = innerWidth, H = innerHeight, dpr = Math.min(2, devicePixelRatio || 1);
    const cv = R.canvas;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    if (now - R.bandAt > 500 && R.bandFn) { R.bandAt = now; R.band = R.bandFn(H); }
    const b = window.__saverBand || R.band || { t: H * 0.14, b: H * 0.14, w: W };
    const colW = Math.min(W, b.w || W), mx = Math.max(16, colW * 0.05);
    const box = { x: (W - colW) / 2 + mx, y: b.t, w: colW - 2 * mx, h: Math.max(110, H - b.t - b.b) };
    if (box.y + box.h > H) box.y = Math.max(0, H - box.h);
    let t = (now - R.t0) / 1000;
    if (t >= R.shot.dur) { R.shot = R.dir.next(); R.t0 = now; R.n++; t = 0; }
    X.setTransform(dpr, 0, 0, dpr, 0, 0);
    X.fillStyle = C.bg; X.fillRect(0, 0, W, H);
    X.textBaseline = 'alphabetic';
    // a fast fade-in on each cut
    X.globalAlpha = 1;
    R.shot.draw(t, box);
    if (t < 0.12) { X.fillStyle = C.bg; X.globalAlpha = 1 - t / 0.12; X.fillRect(0, 0, W, H); X.globalAlpha = 1; }
    const e = R.shot.pair(t);
    if (e && e !== R.lastE) { R.lastE = e; R.label(plate(e)); }
  }
  window.snSaver = {
    enter(o = {}) {
      if (R) window.snSaver.exit();
      onEnter && onEnter();
      const canvas = document.createElement('canvas');
      canvas.id = 'saverCanvas';
      // The canvas box is the window (inset 0), the same box as innerWidth x
      // innerHeight that sizes its pixels. 100vh is taller than the window in
      // iOS Safari while its toolbar shows, so the frame stretched down and
      // the bottom of the clear band went under the toolbar.
      canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:1000;background:' + C.bg;
      const st = document.createElement('style'); st.id = 'saverStyle';
      st.textContent = '#bar,#dock,.view,#toast,#about{visibility:hidden!important}body{overflow:hidden!important;cursor:none}';
      document.head.append(st); document.body.append(canvas);
      X = canvas.getContext('2d');
      const dir = director(o.seed, o.calm ?? 0.7);
      R = { canvas, st, dir, shot: dir.next(), t0: performance.now() + 500, n: 0, raf: 0, band: null, bandAt: 0, bandFn: null, lastE: null,
        label: typeof o.label === 'function' ? o.label : () => {} };
      import('../../lib/saver-clear.js').then(m => { if (R) R.bandFn = m.plateBand; }).catch(() => { /* no shell: the default band */ });
      const fonts = document.fonts ? Promise.all([document.fonts.load(F.bold(64)), document.fonts.load(F.mono(64)), document.fonts.load(F.med(64))]).catch(() => {}) : Promise.resolve();
      fonts.then(() => { if (R) { R.t0 = performance.now(); R.raf = requestAnimationFrame(frame); } });
      return { canvas, warmupMs: 700 };
    },
    exit() {
      if (!R) return;
      cancelAnimationFrame(R.raf);
      R.label(null);
      R.canvas.remove(); R.st.remove();
      R = null;
      onExit && onExit();
    },
    debug() { return R ? { kind: R.shot.kind, dur: +R.shot.dur.toFixed(2), t: +((performance.now() - R.t0) / 1000).toFixed(2), n: R.n, pair: R.lastE && R.lastE.phrase, band: R.band } : null; },
  };
}
