// ============================================================================
//  FLY DUEL  ·  play mode, the cast preview  (ES module, DOM part optional)
// ----------------------------------------------------------------------------
//  The user (verbatim, 2026-10-12): "it should animatedly display the card
//  in the left, then place it down on the mat magic the gathering arena
//  style". When a creature or a spell is cast (by you or by the fly), the
//  card shows large at the left side of the screen for a beat (hold), then
//  it flies down and shrinks onto its spot on the mat (fly) and goes. A
//  land has no preview (as in MTG Arena). The 3D clip of the scene runs at
//  the same time (ui/play/play.js animate waits for both).
//
//  Where it lands: the new permanent of the cast (castTarget: its place on
//  the 3D table, projected with the scene camera), else the creature row
//  of the caster (your row low, the fly's row high in the table box). A
//  spell lands at the middle of the table and fades.
//
//  PURE (node tests): CAST (times), castPlan (null for a land or a move
//  that is not a cast), castRect (the big card at the left, in the view,
//  clear of the hand), newPermUid, fallbackTarget.
//
//  GREP MAP
//      grep -n 'export const CAST'          hold, fly, fade (ms)
//      grep -n 'export function castPlan'   which records preview, how long
//      grep -n 'export function castRect'   the big card at the left
//      grep -n 'export function newPermUid' the permanent a cast made
//      grep -n 'export function fallbackTarget'
//      grep -n 'export function projectTarget'  3D place -> client px
//      grep -n 'export function createCastView' the DOM element
// ============================================================================

// hold: the card stays big at the left; fly: it goes down to the mat;
// fade: the last fade out. SPEED scales hold and fly with the play speed.
export const CAST = Object.freeze({ hold: 750, fly: 420, fade: 140, landScale: 0.2 });
export const CAST_SPEED = Object.freeze({ calm: 1.35, normal: 1, fast: 0.45 });

// The uid of the permanent that rec made for its caster (null: none).
export function newPermUid(rec) {
  const p = rec?.who;
  const before = new Set((rec?.before?.players?.[p]?.battlefield || []).map(x => x.uid));
  const made = (rec?.after?.players?.[p]?.battlefield || []).find(x => !before.has(x.uid) && x.id === rec.action?.card);
  return made ? made.uid : null;
}

// rec: a ui/match.js record. Returns null (no preview) or { id, seat,
// kind: 'creature' | 'spell', uid, hold, fly, fade, total }.
export function castPlan(rec, CARD, { speed = 'normal', reduced = false } = {}) {
  const a = rec?.action;
  if (!a || a.type !== 'cast') return null;
  const c = CARD?.[a.card];
  if (!c || c.type === 'land') return null;
  const k = CAST_SPEED[speed] ?? 1;
  const hold = Math.round(CAST.hold * k);
  const fly = reduced ? 0 : Math.round(CAST.fly * k);
  const kind = c.type === 'creature' ? 'creature' : 'spell';
  return { id: a.card, seat: rec.who, kind, uid: kind === 'creature' ? newPermUid(rec) : null, hold, fly, fade: CAST.fade, total: hold + fly + CAST.fade };
}

// The big card at the left of a view vw x vh. peek: px of the hand at the
// bottom; top: px of the scorecards at the top. The card keeps 5:7, stays
// in the view and clear of the hand.
export function castRect(vw, vh, { peek = 0, top = 0 } = {}) {
  const m = 12;
  const room = vh - peek - top - 2 * m;
  let h = Math.min(460, vh * 0.56, room);
  let w = h / 1.4;
  if (w > vw * 0.44) { w = vw * 0.44; h = w * 1.4; }
  w = Math.round(w); h = Math.round(w * 1.4);
  const x = Math.max(m, Math.round(vw * 0.03));
  const y = Math.round(top + m + Math.max(0, (room - h) / 2));
  return { x, y, w, h };
}

// Where the card lands when the scene cannot say: the creature row of the
// caster in the table box (box: { left, top, width, height } client px).
// mine: the caster is you (your row is low, the fly's row high).
export function fallbackTarget(box, mine, kind = 'creature') {
  const fy = kind === 'spell' ? 0.5 : mine ? 0.64 : 0.36;
  return { x: box.left + box.width / 2, y: box.top + box.height * fy };
}

// A 3D place (a three.js Vector3 with clone/project) to client px over the
// canvas rect. Null when it is behind the camera or not a vector.
export function projectTarget(pos, camera, rect) {
  if (!pos || typeof pos.clone !== 'function' || !camera || !rect) return null;
  camera.updateMatrixWorld?.();
  const v = pos.clone().project(camera);
  if (!(v.z < 1) || !Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
  return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
}

// ------------------------------------------------------------------ DOM
// createCastView(root, { paint(cv, id, w, h), view() -> [vw, vh],
// insets() -> { peek, top }, wait, unwait }) -> { el, play(plan,
// target(plan) -> { x, y } client px | null) -> Promise, cancel(),
// dispose() }. One preview at a time: a new one ends the old one.
export function createCastView(root, opts) {
  const doc = root.ownerDocument;
  const wait = opts.wait || ((f, ms) => setTimeout(f, ms));
  const unwait = opts.unwait || (t => clearTimeout(t));
  const el = doc.createElement('div');
  el.className = 'pl-cast';
  el.hidden = true;
  el.setAttribute('aria-hidden', 'true');
  el.dataset.n = '0';
  const cv = doc.createElement('canvas');
  cv.className = 'pl-cv';
  el.appendChild(cv);
  root.appendChild(el);
  let timers = [], done = null;

  function cancel() {
    for (const t of timers) unwait(t);
    timers = [];
    el.hidden = true;
    el.classList.remove('is-in', 'is-down');
    el.style.transform = '';
    const d = done; done = null; d?.();
  }

  function play(plan, target) {
    cancel();
    if (!plan) return Promise.resolve(false);
    const [vw, vh] = opts.view();
    const ins = opts.insets?.() || {};
    const r = castRect(vw, vh, ins);
    Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, transform: '', transitionDuration: '0ms' });
    el.dataset.seat = String(plan.seat);
    el.dataset.kind = plan.kind;
    el.dataset.id = plan.id;
    el.dataset.n = String((+el.dataset.n || 0) + 1);
    opts.paint?.(cv, plan.id, r.w, r.h);
    el.hidden = false;
    el.classList.add('is-in');
    return new Promise(resolve => {
      done = () => resolve(true);
      timers.push(wait(() => {
        // fly down to the mat: from the centre of the big card to the target
        let t = null;
        try { t = target?.(plan) || null; } catch { t = null; }
        const rb = root.getBoundingClientRect?.() || { left: 0, top: 0 };
        const tx = t ? t.x - rb.left : vw / 2, ty = t ? t.y - rb.top : vh / 2;
        const dx = Math.round(tx - (r.x + r.w / 2)), dy = Math.round(ty - (r.y + r.h / 2));
        el.style.transitionDuration = `${plan.fly}ms`;
        el.style.transform = `translate(${dx}px, ${dy}px) scale(${CAST.landScale})`;
        el.classList.add('is-down');
        timers.push(wait(() => {
          el.classList.remove('is-in');
          timers.push(wait(() => { const d = done; done = null; timers = []; el.hidden = true; el.classList.remove('is-down'); el.style.transform = ''; d?.(); }, plan.fade));
        }, plan.fly));
      }, plan.hold));
    });
  }

  return { el, play, cancel, dispose() { cancel(); el.remove(); } };
}
