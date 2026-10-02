// ============================================================================
//  PIN TUMBLER LOCK  ·  parts.js — what each part is called and what it does
// ────────────────────────────────────────────────────────────────────────────
//  partsFor(L) returns PARTS[id] = { name, group, role, specs: [[k, v]],
//  live } for the lock L (lock.js). The ids are the info ids of scene.js
//  (all five key pins share 'keyPin', and so on). live names the rows that
//  main.js liveValue fills each frame.
//
//  GREP MAP
//    export function partsFor ... the table, built from the lock numbers
//    export const GROUP_COLOR ... the eyebrow colour of each group
// ============================================================================
export const GROUP_COLOR = {
  'Shell': '#c9a46a', 'Plug': '#e8c47e', 'Pin stacks': '#ff9a8a', 'Wafers': '#9fd0ff',
  'Key': '#d8d4c8', 'Drive': '#c8a6ff',
};
const mm = v => `${+v.toFixed(2)} mm`;

export function partsFor(L) {
  const g = L.g, k = g.key;
  const cuts = L.bits.right.join(' ');
  const common = {
    key: { name: 'Key', group: 'Key', role: L.pin
      ? 'A nickel-silver blank with five cuts on its top edge. Each cut sets how high one key pin rides. The grooves in its sides fit the wards of the keyway, so only this blank goes in.'
      : 'A short blank with five cuts. Each cut lifts one wafer by the top edge of its window. The side groove fits the ward of the keyway.',
      specs: [['Cuts (right key)', cuts], ['Depth step', mm(k.step)], ['Cut angle', `${k.angle}°`], ['Pitch', mm(g.pitch)]], live: ['insert', 'keyName'] },
    plug: { name: 'Plug', group: 'Plug', role: L.pin
      ? 'The cylinder that turns. Its five chambers line up with the five in the housing. The plug can turn only when no pin crosses the gap between plug and housing: the shear line.'
      : 'The cylinder that turns. Five slots go right through it, one for each wafer. It turns only when no wafer stands out of its surface.',
      specs: [['Diameter', mm(2 * g.Rp)], ['Turn', '90° to throw']], live: ['angle', 'open'] },
    housing: { name: 'Housing', group: 'Shell', role: L.pin
      ? 'The fixed brass shell. Its tower holds the top of each chamber: drivers and springs live here. The bore round the plug is the outer side of the shear line.'
      : 'The fixed shell, threaded to take a nut through a cabinet door. A groove runs along the top and the bottom of its bore; a wafer that stands out lands in one and stops the plug.',
      specs: L.pin ? [['Bore', mm(2 * g.Rp)], ['Chambers', `${g.n} × Ø ${2 * g.holeR} mm`]] : [['Bore', mm(2 * g.Rp)], ['Groove depth', mm(g.grooveY - g.Rp)]], live: ['blocked'] },
    clip: { name: 'Retaining clip', group: 'Shell', role: 'A blued spring clip on the back of the plug. It holds the plug in the housing so it can turn but not slide out.', specs: [] },
  };
  if (L.pin) return {
    ...common,
    keyPin: { name: 'Key pins', group: 'Pin stacks', role: 'The lower pin of each stack, cut to its own length, with a domed tip that rides the key. The right key lifts each one until its top is level with the shear line.', specs: [['Lengths', g.kLen.map(v => v.toFixed(2)).join(' · ')], ['Diameter', mm(2 * g.pinR)], ['Tip radius', mm(g.domeR)]], live: ['gaps', 'state'] },
    driver: { name: 'Driver pins', group: 'Pin stacks', role: 'The upper pin of each stack, all one length. With no key they reach down across the shear line into the plug, and that is what holds the plug still.', specs: [['Length', mm(g.driverLen)], ['Diameter', mm(2 * g.pinR)]], live: ['drivers'] },
    spring: { name: 'Springs', group: 'Pin stacks', role: 'Each spring pushes its driver and key pin down onto the key, or down into the plug when there is no key.', specs: [['Free length', mm(g.spring.free)], ['Rate', `${g.spring.rate} N/mm`]], live: ['springs', 'force'] },
    cap: { name: 'Cap strip', group: 'Shell', role: 'Closes the top of the five chambers and gives the springs a seat.', specs: [['Chamber top', `y = ${g.yTop} mm`]] },
    collar: { name: 'Collar', group: 'Shell', role: 'The face ring round the front of the plug. It hides the gap between plug and housing.', specs: [] },
    cam: { name: 'Cam', group: 'Drive', role: 'Turns with the back of the plug. Its pin runs in the slot of the bolt yoke, so a quarter turn of the plug throws the bolt.', specs: [['Pin radius Rc', mm(g.cam.Rc)]], live: ['angle', 'bolt'] },
    bolt: { name: 'Bolt', group: 'Drive', role: 'A Scotch yoke: the cam pin slides up its slot while it pushes the bar sideways, so the bolt moves Rc · sin θ.', specs: [['Throw', mm(g.cam.Rc)]], live: ['bolt'] },
    case: { name: 'Lock case', group: 'Drive', role: 'The back plate and the strap that guide the bolt. Two screws hold it to the tower of the housing.', specs: [] },
  };
  return {
    ...common,
    wafer: { name: 'Wafers', group: 'Wafers', role: 'Flat steel plates in slots through the plug. A spring pushes each one down; the key lifts it by the top edge of its window. The right key centres every wafer inside the plug.', specs: [['Thickness', mm(g.waferT)], ['Window tops', g.winTop.map(v => v.toFixed(2)).join(' · ')]], live: ['gaps', 'state'] },
    wSpring: { name: 'Wafer springs', group: 'Wafers', role: 'A small coil in a pocket at the side of each slot. It presses on the tab of its wafer, so with no key every wafer drops into the lower groove.', specs: [['Free length', mm(g.spring.free)]], live: ['springs'] },
    cam: { name: 'Cam bar', group: 'Drive', role: 'A flat bar screwed to the back of the plug. Locked, it hangs down behind the frame stop. A quarter turn swings it clear.', specs: [['Length', mm(g.cam.len)]], live: ['angle'] },
    strike: { name: 'Frame stop', group: 'Drive', role: 'The edge of the cabinet frame. The cam bar bears on it when the lock is locked.', specs: [] },
  };
}
