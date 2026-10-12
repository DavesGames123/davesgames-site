// ============================================================================
//  FLY DUEL  ·  every canvas that waits on one picture draws again
//  (node tests/cardart-wait.test.mjs)
// ----------------------------------------------------------------------------
//  The old deck chooser kept one "loading" flag per art id. The first
//  deck box that asked for a key card got the picture. The other boxes
//  with the same key card stayed black. ui/cardface.js paintWithArt()
//  keeps the wait per canvas, so each canvas draws again.
//
//  No browser: a stub Image loads on a timer. A canvas here is any
//  object, because paintWithArt() only uses it as a key.
//
//  GREP MAP
//      grep -n 'TWO CANVASES'   two canvases, one art id: both draw again
//      grep -n 'LATEST DRAW'    a canvas that paints twice draws once more
//      grep -n 'AFTER LOAD'     a canvas made after the load draws at once
//      grep -n 'NEW ID'         a canvas that changes id ignores the old one
// ============================================================================
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };

// A stub Image: decodes 5 ms after src is set, with a fixed size.
let decodes = 0;
globalThis.Image = class {
  constructor() { this.width = 0; this.height = 0; this.naturalWidth = 0; this.naturalHeight = 0; }
  set src(v) { this._src = v; setTimeout(() => { decodes++; this.width = this.naturalWidth = 240; this.height = this.naturalHeight = 180; this.onload?.(); }, 5); }
  get src() { return this._src; }
};

const CM = await import('../game/cards.js');
const cf = await import('../ui/cardface.js');
cf.setArtIndex({});

ok(typeof cf.paintWithArt === 'function', 'cardface exports paintWithArt');
if (typeof cf.paintWithArt !== 'function') {
  console.log(`cardart-wait: ${pass} pass, ${fail} fail`);
  process.exit(1);
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const ids = cf.ART_IDS.filter(id => CM.CARD[id]);

// ------------------------------------------------------------ TWO CANVASES
{
  const id = ids[0];
  const seen = { a: [], b: [] };
  const cvA = {}, cvB = {};
  cf.paintWithArt(cvA, id, art => seen.a.push(art), { small: true });
  cf.paintWithArt(cvB, id, art => seen.b.push(art), { small: true });
  ok(seen.a.length === 1 && seen.a[0] === null, 'canvas A draws at once with no picture');
  ok(seen.b.length === 1 && seen.b[0] === null, 'canvas B draws at once with no picture');
  await wait(30);
  ok(seen.a.length === 2 && seen.a[1] && seen.a[1].width === 240, `canvas A draws again with the picture (${seen.a.length} draws)`);
  ok(seen.b.length === 2 && seen.b[1] && seen.b[1].width === 240, `canvas B draws again with the picture (${seen.b.length} draws)`);
  ok(seen.a[1] === seen.b[1], 'both canvases get the same cached picture');
}

// ------------------------------------------------------------ LATEST DRAW
{
  const id = ids[1];
  const cv = {};
  const log = [];
  cf.paintWithArt(cv, id, art => log.push(['old', art]), { small: true });
  cf.paintWithArt(cv, id, art => log.push(['new', art]), { small: true });
  await wait(30);
  ok(log.length === 3, `paint, paint, then one draw after the load (${log.length})`);
  ok(log[2]?.[0] === 'new' && log[2][1], 'the draw after the load is the latest draw function');
}

// ------------------------------------------------------------ AFTER LOAD
{
  const id = ids[0];
  const before = decodes;
  const log = [];
  cf.paintWithArt({}, id, art => log.push(art), { small: true });
  ok(log.length === 1 && log[0] && log[0].width === 240, 'a canvas made after the load draws the picture at once');
  await wait(20);
  ok(log.length === 1, 'and does not draw a second time');
  ok(decodes === before, 'no second decode of a cached picture');
}

// ------------------------------------------------------------ NEW ID
{
  const cv = {};
  const log = [];
  cf.paintWithArt(cv, ids[2], art => log.push(['two', art]), { small: true });
  cf.paintWithArt(cv, ids[3], art => log.push(['three', art]), { small: true });
  await wait(30);
  const late = log.slice(2);
  ok(late.length === 1 && late[0][0] === 'three', `only the current id draws again (${late.map(x => x[0]).join(',')})`);
}

console.log(`cardart-wait: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
