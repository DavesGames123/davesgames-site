// ============================================================================
//  LENIA  ·  app/keys.js — keyboard shortcuts
// ----------------------------------------------------------------------------
//  Space plays, R resets, N seeds, C clears, F follows, 1 to 3 set the view,
//  [ and ] set the brush, the arrows step the catalog, / opens the search.
//
//  GREP MAP
//    grep -n 'function bindKeys'  the keydown handler
// ============================================================================
import { $, S } from './state.js';
import { selectCreature, placeCreature, soup } from './creature.js';
import { openBrowser } from './browser.js';
import { setPlaying, setFollow, setMode } from './controls.js';

export function bindKeys() {
  addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target, tag = t && t.tagName;
    const typing = tag === 'INPUT' && (t.type === 'search' || t.type === 'text') || tag === 'SELECT' || tag === 'TEXTAREA';
    if (typing) return;
    const onRange = tag === 'INPUT' && t.type === 'range';
    const k = e.key.toLowerCase();
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); if (tag === 'BUTTON') t.blur(); setPlaying(!S.playing); }
    else if (k === 'r') placeCreature();
    else if (k === 'n') soup();
    else if (k === 'c') { if (S.engine) { S.engine.clear(); S.time = 0; } }
    else if (k === 'f') setFollow(!S.view.follow);
    else if (k === '1') setMode('world');
    else if (k === '2') setMode('potential');
    else if (k === '3') setMode('growth');
    else if (e.key === '[' || e.key === ']') {
      const inp = $('brush');
      inp.value = Math.max(+inp.min, Math.min(+inp.max, +inp.value + (e.key === ']' ? 0.25 : -0.25)));
      inp.dispatchEvent(new Event('input'));
    }
    else if (!onRange && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) { e.preventDefault(); selectCreature(S.idx + 1); }
    else if (!onRange && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) { e.preventDefault(); selectCreature(S.idx - 1); }
    else if (e.key === 'Escape') openBrowser(false);
    else if (e.key === '/') { e.preventDefault(); openBrowser(true); $('search').focus(); }
  });
}
