// ============================================================================
//  LOSE THE MODIFIER  ·  cycle.js — the autoplay on an empty input
// ----------------------------------------------------------------------------
//  One pair at a time on #stage, as if someone edits it live:
//    1. the weak phrase types in, letter by letter, with a caret
//    2. the left side of the formula pops in; a red line strikes the
//       modifier; the modifier flashes as a selection
//    3. backspace deletes the line, faster as it goes
//    4. the strong word types in; the formula, the options and the example
//       come in; the caret blinks through a hold
//    5. a quick erase, then the next pair
//  main.js stops it while the user types and pauses it while the pointer
//  is on the stage. pause() leaves the current pair complete on the stage,
//  so it can be read and copied.
//
//  Each run has a token. A new start, stop or pause makes a new token, and
//  every wait in the old run then throws STOP, so two runs never overlap.
//
//  grep -n targets
//    "async function play"   the steps for one pair
//    "function rate"         typing speed: letter delays with jitter
//    "pause("  "resume("     the hover and idle control
// ============================================================================
const STOP = Symbol('stop');

export function createCycle({ stage, pick, onShow, onPick, reduced = false }) {
  let token = 0, cur = null, resumeT = 0, running = false, done = false;
  const wait = (ms, t) => new Promise((res, rej) => setTimeout(() => (t === token ? res() : rej(STOP)), ms));
  // Letter delays: a human rhythm, a longer beat after a space.
  const rate = (ch, base) => base * (0.7 + Math.random() * 0.6) + (ch === ' ' ? base * 0.9 : 0);

  async function play(e, t) {
    const word = e.targets[0];
    cur = e; done = false; onShow(e, word);
    stage.fit(e, [word]);
    stage.famTag(e);
    stage.eqStep(e, 0);
    stage.clearInfo();
    if (reduced) {
      stage.show(e, { word, onPick });
      done = true;
      await wait(4200, t);
      return;
    }
    const weak = e.base ? (e.modFirst ? e.mod + ' ' + e.base : e.base + ' ' + e.mod) : e.phrase;
    stage.weak(e, 0);
    await wait(260, t);
    for (let i = 1; i <= weak.length; i++) { stage.weak(e, i); await wait(rate(weak[i - 1], 62), t); }
    await wait(420, t);
    stage.eqStep(e, 1);
    stage.weak(e, weak.length, { cut: true });
    await wait(520, t);
    stage.weak(e, weak.length, { cut: true, sel: true, caret: false });
    await wait(170, t);
    for (let i = weak.length; i >= 0; i--) {
      stage.weak(e, i, { cut: true });
      await wait(Math.max(16, 52 - (weak.length - i) * 4), t);
    }
    await wait(150, t);
    for (let i = 1; i <= word.length; i++) { stage.strong(word, i); await wait(rate(word[i - 1], 74), t); }
    stage.strong(word, word.length, { blink: true });
    stage.eqStep(e, 2, word);
    await wait(120, t);
    stage.alts(e, word, onPick);
    stage.ex(e);
    done = true;
    await wait(2600 + Math.min(1600, e.ex.length * 14), t);
    done = false;
    for (let i = word.length; i >= 0; i--) { stage.strong(word, i); await wait(18, t); }
    await wait(120, t);
  }

  async function loop(t) {
    running = true;
    try { while (t === token) await play(pick(cur), t); }
    catch (x) { if (x !== STOP) throw x; }
    finally { if (t === token) running = false; }
  }

  const api = {
    start() { clearTimeout(resumeT); const t = ++token; loop(t); },
    // stop: end the run, leave the stage to the caller.
    stop() { clearTimeout(resumeT); token++; running = false; },
    // pause: end the run and show the current pair complete.
    pause() {
      clearTimeout(resumeT);
      if (!running) return;
      token++; running = false;
      // In the hold the pair is already complete: keep its nodes, so a tap
      // on an option button still lands.
      if (cur && !done) { stage.show(cur, { word: cur.targets[0], onPick }); onShow(cur, cur.targets[0]); }
    },
    resume(ms = 0) { clearTimeout(resumeT); if (running) return; resumeT = setTimeout(() => api.start(), ms); },
    get running() { return running; },
    get current() { return cur; },
  };
  return api;
}
