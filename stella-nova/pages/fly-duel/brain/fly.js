// ============================================================================
//  FLY DUEL  ·  the model fly that plays  (ES module, no DOM)
// ----------------------------------------------------------------------------
//  Fly = FlyAgent (brain/agent.js) bound to the real game: step, isOver,
//  newGame and legalActions from game/rules.js, features from
//  game/features.js. Read brain/agent.js for the decision rule and the TD
//  update, and brain/mb.js for the mushroom body model.
//
//  TWO FLIES.  Fly A and fly B use the same PN -> KC claws and the same
//  KC -> MBON synapses from data/connectome.json (real hemibrain wiring,
//  no claw resampling). They differ in two things only: the seeded
//  feature -> glomerulus map (hemisphere 'A' or 'B') and their own
//  learned KC -> MBON weights. makePair() builds the two.
//
//  USE
//      const fly = new Fly(connectome, { name: 'Fly A', hemisphere: 'A' });
//      const { action, values, trace } = fly.choose(state, legalActions(state),
//                                                   { explore: 0.05, learn: true });
//      ...  at the end of the game, for both flies:
//      fly.observe(null, finalState, +1 | -1 | 0, true);
//
//  EXPORTS   (jump with grep -n "<anchor>" brain/fly.js)
//      Fly ............. "export class Fly"
//      makePair ........ "export function makePair"
//      GAME ............ "export const GAME"     the bound game functions
//      re-exports ...... MushroomBody, FlyAgent, FLY_DEFAULTS, calibrationSet
// ============================================================================
import { step, isOver, newGame, legalActions } from '../game/rules.js';
import { features } from '../game/features.js';
import { FlyAgent, FLY_DEFAULTS, calibrationSet } from './agent.js';
import { MushroomBody } from './mb.js';

export { MushroomBody, FlyAgent, FLY_DEFAULTS, calibrationSet };

// newGame without log lines: calibration needs no log, and it is faster.
const quietNewGame = o => newGame({ ...o, log: false });
export const GAME = Object.freeze({ step, isOver, features, newGame: quietNewGame, legalActions });

export class Fly extends FlyAgent {
  constructor(connectome, opts = {}) { super(connectome, { game: GAME, ...opts }); }
  static fromJSON(connectome, json) { return FlyAgent.fromJSON(connectome, json, GAME, Fly); }
}

// Fly A and fly B on one wiring. opts go to both; optsA / optsB win.
export function makePair(connectome, opts = {}, optsA = {}, optsB = {}) {
  return [
    new Fly(connectome, { ...opts, name: 'Fly A', hemisphere: 'A', ...optsA }),
    new Fly(connectome, { ...opts, name: 'Fly B', hemisphere: 'B', ...optsB }),
  ];
}
