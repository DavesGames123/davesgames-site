// layout: static checks of the page shell and the HUD (no browser), and
// the label choice of main.js. The phone rules are read from style.css.
import { readFileSync } from 'node:fs';

const here = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', here), 'utf8');
const css = readFileSync(new URL('style.css', here), 'utf8');
const rule = (sel, src = css) => { const m = src.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&') + '\\{([^}]*)\\}')); return m ? m[1] : ''; };
const phone = css.slice(css.indexOf('@media (max-width:760px)'), css.indexOf('/* ── LANDSCAPE'));

export default async function (ok) {
  ok('layout: HUD numbers use tabular figures', /tabular-nums/.test(rule('.h-grid dd')) && /tabular-nums/.test(rule('.regions')) && /tabular-nums/.test(rule('.h-title span')));
  ok('layout: the body turns on tabular figures', /body\{font:[^}]*'tnum' 1/.test(css));
  ok('layout: a type scale: small caps labels, serif title, large numbers', /uppercase/.test(rule('.sec-label')) && /var\(--serif\)/.test(rule('.h-title b')) && /1\.1\dx?rem/.test(rule('.h-grid dd')));
  ok('layout: spacing comes from the 4 px scale', /--s1:4px; --s2:8px; --s3:12px; --s4:16px/.test(css));
  ok('layout: no glow shadows on controls', !/box-shadow/.test(css));
  ok('layout: the dock has no emoji glyphs', !/[✳⛨✈◐]/u.test(html) && (html.match(/<svg viewBox/g) || []).length === 4);
  ok('layout: the play glyph asks for text style', /&#9654;&#xFE0E;/.test(html));
  ok('layout: phone dock targets are at least 44 px', /min-height:44px/.test(rule('#dock .tab', phone)));
  ok('layout: phone bars respect the safe areas', /safe-area-inset-bottom/.test(phone) && /safe-area-inset-left/.test(phone) && /safe-area-inset-right/.test(phone));
  ok('layout: the phone HUD is one strip of 4 numbers', /repeat\(4,minmax\(0,1fr\)\)/.test(rule('.h-grid', phone)));
  ok('layout: selects are 16 px on touch (no iOS zoom)', /select\{min-height:40px;font-size:16px\}/.test(css));
  ok('layout: the phone sheet sits above the base bar and the dock', /bottom:calc\(var\(--dock-h\) \+ var\(--base-h\)\)/.test(phone));
  ok('layout: the hint never shows on a phone', /#hint\{display:none\}/.test(phone));
  ok('layout: labels have a tip class, no inline styles in main.js', /\.tip\{/.test(css) && !/style\.cssText/.test(readFileSync(new URL('main.js', here), 'utf8')));

  const M = await import('../main.js');
  const sim = { N: 6, I: Float64Array.of(10, 500, 0, 300, 2, 900) };
  const pop = Float64Array.of(1e5, 1e6, 1e6, 1e6, 1e7, 1e6);
  const top = M.topOutbreaks(sim, pop, 3, 1e-4);
  ok('labels: the largest outbreaks first, at most k', top.join() === '5,1,3', top.join());
  ok('labels: a city under the prevalence floor gets no label', !M.topOutbreaks(sim, pop, 6, 1e-4).includes(4));
  ok('labels: few labels (4 on desktop, 2 on a phone)', M.LABELS_DESKTOP <= 5 && M.LABELS_PHONE <= 3);
  ok('labels: no sim, no labels', M.topOutbreaks(null, pop, 3).length === 0);
}
