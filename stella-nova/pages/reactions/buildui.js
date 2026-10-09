// ============================================================================
//  REACTIONS  ·  buildui.js — the build-your-own surface (DOM)
// ----------------------------------------------------------------------------
//  The right-hand panel (a bottom sheet on phones) over a builder.js
//  Builder. Add molecules by name (the species list, then the Molecule
//  Explorer library through molecules/browse.js) or by SMILES (Enter;
//  molecules/engine.js fromSmiles). Tap molecules to select one, two or
//  three; the options list shows only the classes that run on them, with
//  the product names. Tap an outcome to run it: the product joins the
//  surface and the centre tree shows the build with its equations.
//  Undo, Clear, Share (#b=... link; the clipboard when it allows).
//
//  new BuilderUI(root, { OCL, onChange(S, id), toast, nodeOfLib, nodeOfSmiles })
//  ui.load(builder)   show a builder (from a share link)
//
//  GREP MAP: grep -n 'renderOptions'  'renderSurface'  'addBy'
// ============================================================================
import { Builder, QUICK, speciesSearch } from './builder.js';
import { nodeOfSpecies } from './steps.js';
import { SPECIES, CLASS } from './templates.js';
import { blockedWhy } from './react.js';
import { render2D } from '../molecules/draw2d.js';
import { decode } from '../molecules/chem.js';
import { LIB, loadLibrary, search } from '../molecules/browse.js';
import { typeset } from '../../lib/sci-math.js';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const q = (root, s) => root.querySelector(s);

export class BuilderUI {
  constructor(root, cb) {
    this.root = root; this.cb = cb; this.sel = [];
    this.b = new Builder(cb.OCL);
    q(root, '#bQuick').innerHTML = QUICK.map(k => `<button type="button" data-k="${k}">${esc(SPECIES[k][1])}</button>`).join('');
    q(root, '#bQuick').addEventListener('click', e => { const t = e.target.closest('button'); if (t) this.addBy({ sp: t.dataset.k }); });
    const inp = q(root, '#bq'), res = q(root, '#bres');
    inp.addEventListener('focus', () => { if (!LIB.recs.length) loadLibrary().then(() => this.results(inp.value)).catch(() => {}); });
    inp.addEventListener('input', () => this.results(inp.value));
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const first = res.querySelector('button');
        if (first && !/[=#()[\]@\\/]/.test(inp.value)) first.click(); else if (inp.value.trim()) this.addBy({ smiles: inp.value.trim() });
      } else if (e.key === 'Escape') { res.hidden = true; inp.blur(); }
    });
    res.addEventListener('click', e => { const t = e.target.closest('button'); if (!t) return; this.addBy(t.dataset.k ? { sp: t.dataset.k } : { lib: t.dataset.lib }); inp.value = ''; res.hidden = true; });
    document.addEventListener('pointerdown', e => { if (!e.target.closest('#bres,#bq')) res.hidden = true; });
    q(root, '#bSurface').addEventListener('click', e => {
      const c = e.target.closest('.bm'); if (!c) return;
      const id = +c.dataset.id, i = this.sel.indexOf(id);
      if (i >= 0) this.sel.splice(i, 1); else { this.sel.push(id); if (this.sel.length > 3) this.sel.shift(); }
      this.render(); this.cb.focus && this.cb.focus(id);
    });
    q(root, '#bOpts').addEventListener('click', e => {
      const t = e.target.closest('button[data-o]'); if (!t) return;
      const opt = this.opts[+t.dataset.o], k = +t.dataset.k;
      this.cb.busy && this.cb.busy('Running ' + opt.name);
      setTimeout(() => {
        let id = -1;
        try { id = this.b.apply(opt, k); } catch (er) { console.error(er); }
        this.cb.busy && this.cb.busy(null);
        if (id < 0) { this.cb.toast('That step could not run.', true); return; }
        this.sel = [id]; this.changed(id);
      }, 20);
    });
    q(root, '#bUndo').addEventListener('click', () => { if (this.b.undo()) { this.sel = []; this.changed(this.b.S.root); } });
    q(root, '#bClear').addEventListener('click', () => { this.b.clear(); this.sel = []; this.changed(-1); });
    q(root, '#bShare').addEventListener('click', () => this.share());
    this.render();
  }
  load(b) { this.b = b; this.sel = b.S.root >= 0 ? [b.S.root] : []; this.changed(b.S.root, true); }
  async addBy(o) {
    let node = null;
    try {
      if (o.sp) node = nodeOfSpecies(o.sp);
      else if (o.lib) node = this.cb.nodeOfLib(LIB.byId.get(o.lib));
      else if (o.smiles) { this.cb.busy && this.cb.busy('Building ' + o.smiles); node = await this.cb.nodeOfSmiles(o.smiles); }
    } catch (e) { this.cb.toast('Not a structure the engine can read: ' + e.message, true); }
    this.cb.busy && this.cb.busy(null);
    if (!node) return;
    const why = blockedWhy(node.G);
    if (why) { this.cb.toast(`This page does not work with ${why}. Try an everyday compound.`, true); return; }
    const op = o.sp ? ['a', o.sp] : o.lib ? ['a', 'lib:' + o.lib] : ['a', 'smi:' + o.smiles];
    const id = this.b.add(node, op);
    this.sel = [id]; this.changed(id);
  }
  results(text) {
    const res = q(this.root, '#bres');
    const sp = speciesSearch(text, 6), lib = LIB.recs.length ? search(text, 10).filter(r => !sp.some(k => SPECIES[k][1].toLowerCase() === r.n.toLowerCase())).slice(0, 8) : [];
    if (!text.trim() || (!sp.length && !lib.length)) { res.hidden = true; return; }
    res.innerHTML = sp.map(k => `<button type="button" class="res" data-k="${k}"><b>${esc(SPECIES[k][1])}</b><small>${esc(SPECIES[k][2])}</small></button>`).join('')
      + lib.map(r => `<button type="button" class="res" data-lib="${esc(r.id)}"><b>${esc(r.n)}</b><small>${esc(r.f)} · Molecule Explorer library</small></button>`).join('');
    res.hidden = false;
  }
  changed(id, quiet) {
    this.render();
    this.cb.onChange(this.b.S, id, quiet);
  }
  render() { this.renderSurface(); this.renderOptions(); this.renderSeq(); }
  renderSurface() {
    const S = this.b.S, el = q(this.root, '#bSurface');
    if (!S.nodes.length) { el.innerHTML = '<p class="note">Add a molecule above, or tap a common one.</p>'; return; }
    el.innerHTML = S.nodes.map(n => {
      let svg = ''; try { svg = render2D(decode(n.mol.rec), { lw: 1.7, pad: 0.45, minW: 4.6, minH: 2.8 }).svg; } catch (e) { svg = ''; }
      const on = this.sel.includes(n.id);
      return `<button type="button" class="bm${on ? ' on' : ''}${n.used >= 0 ? ' used' : ''}" data-id="${n.id}" title="${esc(n.mol.name)}"><span class="th">${svg}</span><small>${esc(n.mol.name)}</small>${on ? `<i>${this.sel.indexOf(n.id) + 1}</i>` : ''}</button>`;
    }).join('');
  }
  renderOptions() {
    const el = q(this.root, '#bOpts');
    if (!this.sel.length) { el.innerHTML = '<p class="note">Select one, two or three molecules.</p>'; this.opts = []; return; }
    let opts = [];
    try { opts = this.b.options(this.sel); } catch (e) { console.error(e); }
    this.opts = opts;
    if (!opts.length) { el.innerHTML = '<p class="note">No reaction in this library runs on the selected molecules. Select a different set.</p>'; return; }
    el.innerHTML = opts.map((o, i) => {
      const reag = o.ins.filter(x => typeof x === 'string').map(k => SPECIES[k] ? SPECIES[k][2] : k);
      return `<div class="bo"><div class="bo-h">${esc(o.name)}${reag.length ? `<small> + ${esc(reag.join(', '))}</small>` : ''}</div>`
        + o.items.map(it => it.why ? `<div class="bo-x">Declined: the product would be ${esc(it.why)}.</div>`
          : `<button type="button" data-o="${i}" data-k="${it.k}">→ <b>${esc(it.main)}</b>${it.names.length > 1 ? `<small> + ${esc(it.names.slice(1).join(' + '))}</small>` : ''}</button>`).join('') + '</div>';
    }).join('');
  }
  renderSeq() {
    const el = q(this.root, '#bSeq'), S = this.b.S;
    if (!S.steps.length) { el.innerHTML = '<p class="note">The equations of your steps show here.</p>'; return; }
    el.innerHTML = S.steps.map((s, i) => `<div class="bs"><small>${i + 1}. ${esc(CLASS[s.st.cls].name)}</small><div class="bs-tex"></div></div>`).join('');
    el.querySelectorAll('.bs-tex').forEach((d, i) => typeset(d, S.steps[i].st.tex));
  }
  async share() {
    const url = location.origin + location.pathname + '#b=' + this.b.encode();
    history.replaceState(null, '', '#b=' + this.b.encode());
    try { await navigator.clipboard.writeText(url); this.cb.toast('Link copied. It rebuilds this tree.'); }
    catch (e) { this.cb.toast('The link is in the address bar.'); }
  }
}
