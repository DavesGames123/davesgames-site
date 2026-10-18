// ============================================================================
//  CORAL REEF  ·  manual.js  ·  the user drives the selected ROV (control mode)
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "if i have an ROV selected and I start using
//  wasd, it should override its motion and allow me to maneuver the vehicle
//  in control mode until i click on the portrait again to bring us back to
//  auto mode".
//
//  ENTER. In follow mode on a squad ROV, a move key (W A S D, E Q, the
//  arrows) or the phone stick takes that ROV from the planner
//  (rov/squad.js setManual). Swim and orbit keep the keys for the camera.
//  DRIVE. input.js take(dt) gives drive(cmd) each frame in follow mode:
//  W S thrust, A D yaw, the left and right arrows strafe, E Q up and down,
//  Shift boost. rov/squad.js manualMove has the inertia, drag, top speed,
//  the rock and ROV guard, and the leash.
//  STATE. A MANUAL badge on the feed card (.fcard .mbadge), the 3D tag and
//  the camera bar button (class manual), the task text "manual control",
//  and the hint #manualHint (with a leash warning past 85 %).
//  EXIT. A click or a tap on the feed card of that ROV (onCardTap), Esc
//  (escape), a new ROV selection (onSelect: a toast; held keys take the
//  new ROV at once) or a camera that does not follow it (tick).
//  PHONES. #manualPad: a stick (forward and yaw) and the up and down
//  buttons, only in control mode on a coarse pointer.
//
//    const M = mountManual({ doc, getSquad, getCam, flash, coarse });
//    M.drive(cmd) -> true while it drives   M.escape()   M.onCardTap(id)
//    M.onSelect(id)   M.tick(dt)   M.id (the manual ROV or null)
//
//  grep -n targets: "export function mountManual", "function enter",
//  "function exit", "function drive", "function padUI", "function tick"
// ============================================================================

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const CSS = `
.fcard .mbadge,#rovPick button .mbadge{position:absolute;z-index:3;top:6px;right:6px;padding:1px 6px;border-radius:4px;background:#f2b134;color:#111;font:700 10px/16px system-ui,sans-serif;letter-spacing:0.08em;pointer-events:none}
#rovPick button{position:relative}#rovPick button .mbadge{top:-8px;right:-6px;font-size:8px;line-height:12px;padding:0 3px}
.rtag.manual .lbl b::after{content:' MANUAL';color:#f2b134}
#manualHint{position:fixed;z-index:24;left:50%;top:64px;transform:translateX(-50%);max-width:calc(100vw - 32px);padding:6px 12px;border-radius:8px;background:rgba(5,20,28,0.82);border:1px solid #f2b134;color:#e9f3f0;font:13px/1.35 system-ui,sans-serif;text-align:center;pointer-events:none}
#manualHint b{color:#f2b134}#manualHint .warn{display:block;color:#ff7a5c}
#manualPad{position:fixed;z-index:24;left:16px;bottom:96px;display:flex;gap:12px;align-items:flex-end;touch-action:none;user-select:none;-webkit-user-select:none}
#manualPad .ring{width:112px;height:112px;border-radius:50%;border:2px solid rgba(242,177,52,0.6);background:rgba(5,20,28,0.35);position:relative}
#manualPad .knob{position:absolute;left:34px;top:34px;width:44px;height:44px;border-radius:50%;background:rgba(242,177,52,0.6);pointer-events:none}
#manualPad .ud{display:flex;flex-direction:column;gap:10px}
#manualPad button{width:48px;height:48px;border-radius:50%;border:2px solid rgba(242,177,52,0.6);background:rgba(5,20,28,0.5);color:#e9f3f0;font:700 13px system-ui,sans-serif}
#manualPad button.on{background:rgba(242,177,52,0.5)}
[hidden]{display:none!important}`;

export function mountManual(o) {
  const doc = o.doc;
  let id = null, keysHeld = false, lastWarn = false;
  const pad = { x: 0, y: 0, up: 0, on: false };
  const squad = () => o.getSquad();
  const cam = () => o.getCam();
  const say = (m) => { if (o.flash) o.flash(m); };
  let style = null, hint = null, padEl = null;

  function ensureDom() {
    if (!doc || !doc.body) return;
    if (!style) { style = doc.createElement('style'); style.id = 'manualCss'; style.textContent = CSS; doc.head.appendChild(style); }
    if (!hint) { hint = doc.createElement('div'); hint.id = 'manualHint'; hint.hidden = true; hint.setAttribute('role', 'status'); hint.setAttribute('aria-live', 'polite'); doc.body.appendChild(hint); }
  }
  function followed() {
    const c = cam(), S = squad();
    if (!c || !S || c.mode !== 'follow') return null;
    return S.vehicles.some(v => v.id === c.followId) ? c.followId : null;
  }
  function enter(vid) {
    const S = squad(); if (!S || !S.setManual || !S.setManual(vid, true)) return false;
    id = vid; lastWarn = false;
    say(o.coarse ? `ROV ${vid}: manual control. Tap the feed to return to auto.` : `ROV ${vid}: manual control. Click the feed (or press Esc) to return to auto.`);
    return true;
  }
  function exit(msg) {
    if (id == null) return false;
    const S = squad(), was = id;
    id = null; pad.x = pad.y = pad.up = 0;
    if (S && S.setManual) S.setManual(was, false);
    say(msg || `ROV ${was} is back on auto: the planner takes it from here.`);
    tick(0);
    return true;
  }
  // input.js, follow mode, each frame: cmd = { fwd, lat, up, yaw, boost }
  function drive(cmd) {
    const any = !!(cmd.fwd || cmd.lat || cmd.up || cmd.yaw);
    keysHeld = any;
    const f = followed();
    if (id == null) { if (!any || f == null || !enter(f)) return false; }
    if (f !== id) return false;
    const c = { fwd: clamp(cmd.fwd + -pad.y, -1, 1), lat: cmd.lat || 0, up: clamp(cmd.up + pad.up, -1, 1), yaw: clamp(cmd.yaw + pad.x, -1, 1), boost: !!cmd.boost };
    squad().drive(id, c);
    return true;
  }
  function onSelect(vid) {
    if (id == null || vid === id) return;
    const was = id, held = keysHeld;
    exit(held ? `ROV ${was} is back on auto. You drive ROV ${vid} now.` : `ROV ${was} is back on auto.`);
    if (held) enter(vid);
  }
  function onCardTap(vid) { if (id == null || vid !== id) return false; exit(); return true; }
  function escape() { return exit(); }

  // the phone pad: a stick (forward, yaw) and the up and down buttons
  function padUI(show) {
    if (!doc || !doc.body) return;
    if (!padEl) {
      if (!show) return;
      padEl = doc.createElement('div'); padEl.id = 'manualPad';
      padEl.innerHTML = '<div class="ring" aria-label="Drive stick"><div class="knob"></div></div><div class="ud"><button type="button" data-up="1" aria-label="Rise">UP</button><button type="button" data-up="-1" aria-label="Sink">DN</button></div>';
      doc.body.appendChild(padEl);
      const ring = padEl.querySelector('.ring'), knob = padEl.querySelector('.knob');
      let pid = null;
      const set = (e) => {
        const r = ring.getBoundingClientRect(), R = (r.width || 112) / 2;
        let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R); const l = Math.hypot(dx, dy);
        if (l > R) { dx *= R / l; dy *= R / l; }
        pad.x = dx / R; pad.y = dy / R;
        knob.style.transform = `translate(${dx.toFixed(0)}px, ${dy.toFixed(0)}px)`;
      };
      const end = () => { pid = null; pad.x = pad.y = 0; knob.style.transform = ''; };
      ring.addEventListener('pointerdown', (e) => { pid = e.pointerId; try { ring.setPointerCapture(pid); } catch (x) { /* old browser */ } set(e); e.preventDefault(); });
      ring.addEventListener('pointermove', (e) => { if (e.pointerId === pid) set(e); });
      ring.addEventListener('pointerup', end); ring.addEventListener('pointercancel', end);
      for (const b of padEl.querySelectorAll('button')) {
        const u = +b.dataset.up;
        const on = (e) => { pad.up = u; b.classList.add('on'); e.preventDefault(); };
        const off = () => { if (pad.up === u) pad.up = 0; b.classList.remove('on'); };
        b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
      }
    }
    padEl.hidden = !show;
  }

  function badge(el, on) {
    if (!el) return;
    el.classList.toggle('manual', on);
    let b = el.querySelector(':scope > .mbadge');
    if (on && !b) { b = doc.createElement('span'); b.className = 'mbadge'; b.textContent = 'MANUAL'; b.setAttribute('aria-hidden', 'true'); el.appendChild(b); }
    if (!on && b) b.remove();
  }
  // each frame: exit when the camera leaves the ROV, the badges, the hint
  function tick() {
    if (!doc) return;
    ensureDom();
    if (id != null) {
      const S = squad();
      if (!S || !S.isManual || !S.isManual(id)) { id = null; }
      else if (followed() !== id) { exit(`ROV ${id} is back on auto: the camera left it.`); return; }
    }
    for (const el of doc.querySelectorAll('#feedSlot .fcard, #rovPick button[data-rov], #rovTags .rtag')) badge(el, id != null && +el.dataset.rov === id);
    const lbl = doc.getElementById('camFollowLbl');
    if (lbl && id != null) lbl.textContent = `Driving ROV ${id}: manual control`;
    if (hint) {
      hint.hidden = id == null;
      if (id != null) {
        const m = squad().manualOf(id) || {};
        const how = o.coarse ? 'The stick drives, UP and DN rise and sink.' : 'W S thrust, A D turn, arrows strafe, E Q up and down, Shift fast.';
        const warn = m.warn ? `<span class="warn">Tether limit: ROV ${id} is at ${Math.round(m.leash * 100)} % of the leash. The pull back starts at 100 %.</span>` : '';
        const html = `<b>MANUAL</b> ROV ${id}. ${how} ${o.coarse ? 'Tap' : 'Click'} the feed to return to auto.${warn}`;
        if (hint.innerHTML !== html) hint.innerHTML = html;
        if (m.warn && !lastWarn) say(`ROV ${id} is near the end of its tether.`);
        lastWarn = !!m.warn;
      }
    }
    padUI(id != null && !!o.coarse);
  }

  return {
    drive, escape, onCardTap, onSelect, tick, exit,
    get id() { return id; },
    get pad() { return pad; },
  };
}
