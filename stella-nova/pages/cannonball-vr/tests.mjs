// ============================================================================
//  CANNONBALL VR TESTS  ·  node stella-nova/pages/cannonball-vr/tests.mjs
// ----------------------------------------------------------------------------
//  The physics, randomizer, hash and saver plan are tested in
//  ../cannonball-3d/tests.mjs (this page runs the same app). Here:
//  vrbutton    the three.js VRButton class is there, with createButton,
//              and makes an "VR NOT SUPPORTED" button with no WebXR device
//  page        main.js boots in VR mode under the DOM stub (no WebGL:
//              no renderer, so no VR button and the rAF loop), autoplays
//              a random scene, and the saver cuts with TeX and no code
//  index       the page loads the cannonball-3d style and the VR entry
// ============================================================================
import vm from 'node:vm';
import fs from 'node:fs';
import { installDom } from '../../widgets/sim-kit/test/stubs.mjs';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };

installDom({ w: 1280, h: 800 });
vm.runInThisContext(fs.readFileSync(new URL('../../vendor/three@0.139.2/build/three.min.js', import.meta.url), 'utf8'));
globalThis.TMP = { page(i) { globalThis.__credit = i; }, creditLines: () => ['Cannonball VR by Matthias Müller'] };
globalThis.isSecureContext = true;
{
  const { VRButton } = await import('./vrbutton.js');
  let supported = null;
  globalThis.navigator.xr = { isSessionSupported: () => Promise.resolve(false) };
  const b = VRButton.createButton({ xr: {} });
  await new Promise(r => setTimeout(r, 5));
  ok(typeof VRButton.createButton === 'function' && b && b.textContent === 'VR NOT SUPPORTED', 'vrbutton: the three.js VRButton makes a button; no device gives "VR NOT SUPPORTED"', b && b.textContent);
  delete globalThis.navigator.xr;
}
{
  await import('./main.js');
  const P = window.__cb;
  runRaf(40);
  ok(__credit && __credit.file === '02-cannonballVR.html' && P.kit.playing && P.S.frame > 0 && P.S.balls.length > 0, 'page: boots in VR mode, credits 02-cannonballVR.html, autoplays a random scene', `${P.S.balls.length} balls, ${P.S.frame} frames`);
  const labels = [];
  await window.snSaver.enter({ seed: 3, label: L => labels.push(L) });
  for (let k = 0; k < 8; k++) { window.snSaver.cut(); runRaf(15); }
  const hist = window.snSaver.debug().hist; let rep = 0; for (let i = 1; i < hist.length; i++) if (hist[i].shot === hist[i - 1].shot) rep++;
  ok(hist.length === 9 && rep === 0 && labels.every(L => L.tex && !L.code), 'page saver: 9 cuts, no repeats, TeX plates, no code', hist.map(x => x.shot).join(' '));
  window.snSaver.exit();
}
{
  const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const heads = [...html.matchAll(/<script src="\.\.\/\.\.\/lib\/([a-z-]+)\.js"><\/script>/g)].map(m => m[1]);
  ok(heads.join(',') === 'gpu-guard,wishlist,stats-beacon' && /cannonball-3d\/style\.css/.test(html) && /type="module" src="main\.js"/.test(html) && /three@0\.139\.2\/build\/three\.min\.js/.test(html),
    'index: head scripts in site order, cannonball-3d style, three r139 and the module entry');
  const css = fs.readFileSync(new URL('../cannonball-3d/style.css', import.meta.url), 'utf8');
  ok(/\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/.test(css) && /\.vr-slot/.test(css), 'style: the [hidden] rule and the VR button slot');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
