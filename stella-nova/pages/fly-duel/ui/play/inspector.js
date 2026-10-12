// ============================================================================
//  FLY DUEL  ·  play mode, the card inspector  (ES module, DOM)
// ----------------------------------------------------------------------------
//  A full-screen view of one card: the card face as large as the screen
//  allows (layout.zoom), then the keyword reminders, the state of the
//  permanent (damage, pump, tapped, entered this turn) and the picture
//  credit. Close: the Close button (44 px), a tap on the dark ground, or
//  Esc. Focus goes to Close when it opens and back when it closes.
//
//  GREP MAP
//      grep -n 'export function createInspector'
//      grep -n 'function permLines'   state lines of a permanent
// ============================================================================
import { paintCard } from './canvas.js';
import * as CF from '../cardface.js';

function permLines(x) {
  if (!x) return [];
  const out = [];
  if (x.tapped) out.push('Tapped.');
  if (x.sick) out.push('Entered this turn: it cannot attack yet (unless swift).');
  if (x.dmg) out.push(`${x.dmg} damage marked this turn.`);
  if (x.pp || x.pt) out.push(`+${x.pp | 0}/+${x.pt | 0} until end of turn.`);
  if (x.pc) out.push(`+${x.pc}/+${x.pc} from growth (lasting).`);
  return out;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createInspector(host, { KEYWORDS = {} } = {}) {
  const doc = host.ownerDocument;
  const el = doc.createElement('div');
  el.className = 'pl-insp';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<div class="pl-insp-in"><canvas class="pl-cv"></canvas><div class="pl-insp-txt"></div><button type="button" class="pl-btn pl-insp-x">Close</button></div>`;
  host.appendChild(el);
  const cv = el.querySelector('canvas');
  const txt = el.querySelector('.pl-insp-txt');
  const x = el.querySelector('.pl-insp-x');
  let back = null;
  const close = () => { if (el.hidden) return; el.hidden = true; back?.focus?.(); back = null; };
  x.addEventListener('click', close);
  el.addEventListener('click', e => { if (e.target === el) close(); });

  function open(card, { L, perm = null, owner = '' } = {}) {
    if (!card) return;
    back = doc.activeElement;
    const w = L?.zoom?.w || 300, h = L?.zoom?.h || 420;
    paintCard(cv, card, { w, h, mode: 'full', state: perm ? { tapped: !!perm.tapped, damage: perm.dmg | 0, pp: perm.pp | 0, pt: perm.pt | 0 } : {} });
    const kws = (card.keywords || []).map(k => KEYWORDS[k]).filter(Boolean);
    const credit = CF.artCredit?.(card.id) || '';
    txt.innerHTML = [
      owner ? `<p class="pl-insp-own">${esc(owner)}</p>` : '',
      kws.length ? `<ul>${kws.map(k => `<li>${esc(k)}</li>`).join('')}</ul>` : '',
      permLines(perm).map(l => `<p>${esc(l)}</p>`).join(''),
      credit ? `<p class="pl-insp-cr">${esc(credit)}</p>` : '',
    ].join('');
    el.hidden = false;
    x.focus?.();
  }

  return { el, open, close, isOpen: () => !el.hidden };
}
