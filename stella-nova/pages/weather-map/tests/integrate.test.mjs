// integrate (INTEGRATE package): static checks that main.js calls each
// phase-2 module by the API it really exports. The browser boot is not
// run here (no browser); a jsdom boot outside the repo covers it.
// ok(name, cond, info). Run alone: node tests.mjs
import { readFileSync } from 'node:fs';
import * as saverMod from '../saver.js';
import * as fieldsMod from '../render/fields.js';
import * as directorMod from '../director.js';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

export default function run(ok) {
  const main = read('main.js');
  const keyBlock = main.slice(main.indexOf('// ── KEYS'), main.indexOf('// ── SAVER'));
  ok('integrate: main.js installs the saver by its real export', typeof saverMod.installSaver === 'function' && /\binstallSaver\(\{/.test(main) && !/\binitSaver\b/.test(main));
  ok('integrate: the frame loop ticks the saver before the camera', /saverObj\.tick\(dt\)/.test(main) && /if \(!saverRan\) clockAndCamera/.test(main));
  ok('integrate: main.js does not bind S (saver.js binds it)', !/k === 's'/.test(keyBlock));
  ok('integrate: page keys stop while the saver runs', /if \(saverOn\(\)\) return;/.test(keyBlock));
  ok('integrate: fields get the WPC fronts (H / L)', /once\(L\.fields, 'setFronts', d\.fronts\)/.test(main));
  ok('integrate: isobar marks go to labels.setMarks', /F\.marks\(\)/.test(main) && /'setMarks'/.test(main));
  ok('integrate: no calls to label methods that do not exist', !/'setData'|'setUnits'/.test(main));
  const lay = fieldsMod.labelMarks({ isobars: [{ lat: 40, lon: -100, text: '1012' }], centers: [{ type: 'H', lat: 41, lon: -99, hPa: 1030, source: 'grid' }] });
  ok('integrate: fields marks are in the setMarks form', lay.length === 2 && lay[0].kind === 'iso' && lay[1].kind === 'H');
  ok('integrate: director takes the clear-area view', /createDirector\(app, \{ view: clearInsets \}\)/.test(main) && typeof directorMod.clearBox === 'function');
}
