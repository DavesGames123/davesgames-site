// ============================================================================
//  CORAL REEF  ·  tests/fauna-page.test.mjs  ·  the creatures on the page
//    NODE_PATH=<jsdom>/node_modules node tests/fauna-page.test.mjs
// ----------------------------------------------------------------------------
//  The real index.html and main.js in jsdom on the fake WebGL2
//  (page-harness.mjs; jsdom has no Worker, so the spawns run on the main
//  thread). Checks of fauna/hook.js on the page:
//    boot ...... the creatures spawn round the squad and some are drawn;
//                no console error comes from the creatures
//    budget .... the animals stay in the budget of the profile
//    toggle .... "Creatures" off frees every animal; on brings them back
//    saver ..... the saver runs with the creatures (an escort near the lead)
//    HUD ....... rov/hud.js draws the label of the creature in view
//  Without jsdom the file skips (0 passed, 0 failed).
// ============================================================================
import { hudFields, tagText } from '../rov/hud.js';
import { FAUNA_BUDGET } from '../fauna/budget.js';

const { bootPage, loadJsdom } = await import('./page-harness.mjs');
let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) { pass++; console.log(`ok   ${name}${info !== '' ? '  ' + info : ''}`); } else { fail++; console.log(`FAIL ${name}${info !== '' ? '  ' + info : ''}`); } };

// the HUD label (no DOM needed)
{
  const F = hudFields({ id: 2, depth: 812, heading: 90, time: 61, tag: { name: 'vampire squid', sci: 'Vampyroteuthis infernalis', src: 'procedural' }, status: { live: true, fps: 20, frames: 5 } });
  ok(F.tag === 'OBS vampire squid · Vampyroteuthis infernalis', 'HUD: the label names the creature and its species', F.tag);
  ok(tagText({ name: 'generated crab 3A2F', sci: null }) === 'OBS generated crab 3A2F' && hudFields({ id: 1, status: {} }).tag === '', 'HUD: a generated species has no scientific name; no creature, no label');
}

if (!loadJsdom()) { console.log('fauna-page: jsdom not found (set JSDOM_DIR or NODE_PATH), skipped'); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }

const P = await bootPage({ w: 1280, h: 720, dpr: 1, search: '?profile=phone' });
const W = P.win, $ = id => P.doc.getElementById(id);
const dbg = () => W.__coralDebug();
const until = async (f, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (f()) return true; await P.run(100); } return !!f(); };
const built = await until(() => dbg().worldReady && dbg().rovs > 0, 120000);
ok(built, 'the world and the ROVs are built');
const spawned = await until(() => dbg().fauna && dbg().fauna.agents > 0 && dbg().fauna.pending === 0, 60000);
await P.run(1500);
let f = dbg().fauna;
ok(spawned && f && f.agents > 0 && f.chunks > 0, 'boot: the creatures spawn round the eye', f ? `${f.agents} animals in ${f.chunks} chunks, regions ${JSON.stringify(f.regions)}` : 'no fauna');
ok(f && f.species > 0, 'boot: species meshes are built', f ? `${f.species} species meshes, ${f.drawn} drawn, ${f.halos} halos, ${(f.bytes / 1048576).toFixed(2)} MB` : '');
ok(f && f.agents <= FAUNA_BUDGET.phone.maxAgents, 'budget: the animals stay in the phone budget', f ? `${f.agents} of ${FAUNA_BUDGET.phone.maxAgents}` : '');
const ferr = P.errors.filter(l => /fauna/i.test(l));
ok(ferr.length === 0, 'boot: no console error from the creatures', ferr.slice(0, 3).join(' | '));
// the toggle
const tog = $('tFauna');
ok(!!tog, 'the panel has a "Creatures" toggle');
if (tog) {
  const input = tog.matches('input') ? tog : tog.querySelector('input') || tog;
  input.click(); input.dispatchEvent(new W.Event('change', { bubbles: true }));
  await P.run(300);
  ok(dbg().fauna === null, 'toggle off: every animal and mesh is freed', JSON.stringify(dbg().fauna));
  input.click(); input.dispatchEvent(new W.Event('change', { bubbles: true }));
  const back = await until(() => dbg().fauna && dbg().fauna.agents > 0, 60000);
  ok(back, 'toggle on: the creatures come back', dbg().fauna ? `${dbg().fauna.agents} animals` : '');
}
// the saver
W.snSaver.enter({ seed: 3, calm: 0.7, label: () => {} });
await P.run(4000);
f = dbg().fauna;
ok(f && f.agents > 0 && P.errors.filter(l => /fauna/i.test(l)).length === 0, 'saver: the creatures run in the saver shots', f ? `${f.agents} animals, ${f.drawn} drawn` : '');
W.snSaver.exit();
await P.run(300);
P.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
