// ============================================================================
//  CHANDRASEKHAR LIMIT  ·  main.js — page wiring
// ----------------------------------------------------------------------------
//  Typesets the TeX (one ink colour, no colour coding), starts the 2D
//  figures (figures.js) and the black-hole render (renders.js), and binds
//  its controls. saver.js defines window.snSaver.
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//    maths ......... "typesetAll"
//    black hole .... "function initHole"
//    boot .......... "const steps"
//    debug ......... "window.__chandra"     state for headless checks
// ============================================================================
import { typesetAll } from '../../lib/sci-math.js';
import * as F from './figures.js';
import { holeScene, mountScene } from './renders.js';
import * as P from './physics.js';
import './saver.js';

const $ = id => document.getElementById(id);
const D = window.__chandra = { booted: false, errors: [], mounted: {} };

// The page's equation boxes use the class "eq"; sci-math reads data-tex.
typesetAll(document).catch(e => D.errors.push(String(e)));

function initHole() {
  const S = holeScene();
  const m = mountScene($('holeCv'), S);
  if (!m) $('holeNoGL').classList.add('on');
  D.mounted.hole = !!m;
  $('holeInc').addEventListener('input', e => { S.pitch = +e.target.value; });
  $('holeDist').addEventListener('input', e => { S.dist = +e.target.value; });
  const tog = (id, k) => $(id).addEventListener('click', e => { S[k] = S[k] ? 0 : 1; e.currentTarget.setAttribute('aria-pressed', !!S[k]); });
  tog('holeLens', 'lens'); tog('holeShift', 'shift');
}

const steps = [F.initHero, F.initFermi, F.initPoly, F.initEnergyP, F.initER, F.initLE, F.initFull, F.initHubble, initHole];
for (const f of steps) {
  try { f(); } catch (e) { D.errors.push(f.name + ': ' + (e && e.message)); console.error(e); }
}
$('mchOut').textContent = P.massChandra(2).Msun.toFixed(3);
$('ignOut').textContent = P.whiteDwarf(P.eos(2).xOf(2e12)).M.toFixed(3);
$('capOut').textContent = P.whiteDwarf(P.eos(2).xOf(1e13)).M.toFixed(3);
D.booted = true;
