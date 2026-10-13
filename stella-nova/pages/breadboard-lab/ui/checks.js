// ============================================================================
//  BREADBOARD LAB  ·  ui/checks.js — the CHECKS panel
// ----------------------------------------------------------------------------
//  The successor of the old GAPS list. Two sources:
//    static .... Netlist.issues (CONTRACT 3.9: floating-input, shorted-part,
//                ic-not-straddling, led-no-resistor, rail-no-feed, …),
//                refreshed on every netlist rebuild
//    live ...... SimEvents with severity warn or error (damage, short, cc,
//                fuse, brownout) since the last reset, newest first
//  A row flashes its targets in the 3D view and frames the first one.
//  "Reset bench" repairs every damaged part and restarts the sim.
//
//  GREP MAP
//    CODE_HELP ........... one line of advice per issue code
//    createChecks ........ the panel
//    counts .............. { error, warn, info } for the status bar
// ============================================================================
import { h, makePanel, btn, note } from './panels.js';
import { fmtTime } from './format.js';

export const CODE_HELP = {
  'floating-input': 'An input with nothing driving it picks up noise. Tie it high or low with a resistor.',
  'unconnected-pin': 'A pin goes nowhere. Wire it, or check that the part sits in the holes you meant.',
  'shorted-part': 'Two pins of this part share one strip, so the part is shorted out. Move one leg to another column.',
  'ic-not-straddling': 'A DIP chip must straddle the centre channel, or its opposite pins short together.',
  'led-no-resistor': 'An LED with no series resistor takes far too much current. Add 220 Ω to 1 kΩ.',
  'supply-short': 'The supply terminals connect with almost no resistance. Expect a short circuit.',
  'rail-no-feed': 'Parts use this rail, but nothing feeds it. Wire the supply to the rail.',
  'covered-hole': 'A wire ends in a hole that a part body covers. It cannot be plugged in there.',
  'pin-overlap': 'Two part pins sit in one hole. Only one leg fits a hole.',
  'no-ground': 'There is no ground reference: add a source or a board GND.',
  'not-simulated': 'This module draws supply current, but its function is not simulated.'
};

export function createChecks(C) {
  const P = makePanel({ id: 'p-checks', title: 'Checks', onClose: () => C.panels.close('checks') });
  let issues = [], events = [];
  const list = h('div.issues');
  const live = h('div.issues');
  const reset = btn('Reset bench', { cls: 'small', title: 'Repair every damaged part and restart the sim', onClick: () => { C.resetBench(); } });
  const clear = btn('Clear', { cls: 'small', title: 'Clear the event list', onClick: () => { events = []; render(); } });
  P.tools.append(reset);
  P.body.append(list, h('div.sec', {}, h('span', {}, 'Events'), clear), live);

  function row(level, msg, sub, targets) {
    const b = h(`button.sq.issue.${level}`, { type: 'button' }, h('i'), h('span', {}, msg, sub ? h('small', {}, sub) : null));
    b.addEventListener('click', () => {
      if (!targets || !targets.length) return;
      C.view.flash && C.view.flash(targets);
      const t = targets[0];
      const id = t.id || t.part || t.probe || null;
      if (id && C.view.focus) C.view.focus(id);
      if (t.kind === 'hole' || t.kind === 'pin') C.highlightTarget(t);
    });
    return b;
  }
  function render() {
    list.innerHTML = '';
    const order = { error: 0, warn: 1, info: 2 };
    const L = issues.slice().sort((a, b) => order[a.level] - order[b.level]);
    if (!L.length) list.appendChild(note(C.netlist ? 'No problems found in the wiring.' : 'Checks run when the bench has a circuit.'));
    for (const i of L) list.appendChild(row(i.level, i.msg, CODE_HELP[i.code] || i.code, i.targets));
    live.innerHTML = '';
    if (!events.length) live.appendChild(h('p.empty', {}, 'No damage or limits so far.'));
    for (const e of events.slice(0, 40)) live.appendChild(row(e.severity === 'error' ? 'error' : e.severity === 'warn' ? 'warn' : 'info', e.msg, `${fmtTime(e.t)}${e.owner ? ' · ' + e.owner : ''}`, e.owner ? [{ kind: 'part', id: e.owner }] : []));
    C.setIssueCount(counts());
  }
  function counts() {
    const c = { error: 0, warn: 0, info: 0 };
    for (const i of issues) c[i.level] = (c[i.level] || 0) + 1;
    for (const e of events) if (e.severity === 'error') c.error++;
    return c;
  }
  render();
  return {
    key: 'checks', title: 'CHECKS', icon: 'checks', col: 'right', el: P.el,
    setIssues(list2) { issues = Array.isArray(list2) ? list2 : []; render(); },
    event(e) { if (!e || e.severity === 'info') return; events.unshift(e); if (events.length > 200) events.length = 200; render(); },
    clearEvents() { events = []; render(); },
    counts, update() {}
  };
}
