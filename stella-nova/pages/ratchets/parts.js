// ============================================================================
//  RATCHETS & FREEWHEELS  ·  parts.js — what each part is called and does
// ----------------------------------------------------------------------------
//  partsFor(id) returns PARTS[info] = { name, group, role, specs, live }.
//  The keys match the info ids of scene.js. live names the rows that
//  cards.js fills each frame through main.js liveValue().
//
//  GREP MAP
//    export function partsFor ... the table, built from the mech.js numbers
//    export const GROUP_COLOR ... the eyebrow colour of each group
// ============================================================================
import { unit, pawlGeo, pawlMoment, spragGeo } from './mech.js';

export const GROUP_COLOR = { 'Input': '#e9c27a', 'Output': '#8fb0ff', 'Clutch': '#e9a0a8', 'Spring': '#8fe0c0', 'Frame': '#9aa6c0' };
const deg = r => `${(r * 180 / Math.PI).toFixed(2)}°`;

export function partsFor(id) {
  const u = unit(id), common = {
    base: { name: 'Base plate', group: 'Frame', role: 'A painted steel plate that holds the shaft boss. The load on the output is a drag that holds it still when the clutch lets go.', specs: [] },
    pin: { name: 'Pawl pin', group: 'Clutch', role: 'The pivot of the pawl. It rides with the input, so the pawl goes round with it.', specs: [['Diameter', `${2 * (u.pinR || 0)} mm`]] },
  };
  if (id === 'ratchet') {
    const G = pawlGeo(u);
    return { ...common,
      shaft: { name: 'Output shaft', group: 'Output', role: 'Keyed to the ratchet wheel. It only turns forward: the load holds it while the lever swings back.', specs: [['Diameter', '20 mm']], live: ['out'] },
      wheel: { name: `Ratchet wheel, ${u.N} teeth`, group: 'Output', role: `Saw teeth: a radial face that the pawl pushes, and a long back slope that lifts the pawl when the lever goes back. One tooth is ${(360 / u.N).toFixed(0)}°, the most motion a back stroke can lose.`, specs: [['Teeth', String(u.N)], ['Tip / root', `${u.rTip} / ${u.rRoot} mm`], ['Pitch', `${(360 / u.N).toFixed(0)}°`]], live: ['out', 'gap'] },
      lever: { name: 'Lever (input)', group: 'Input', role: 'Swings on the shaft and carries the pawl. A forward stroke drives the wheel; a back stroke clicks the pawl over the teeth.', specs: [['Handle radius', '106 mm']], live: ['in', 'state'] },
      pawl: { name: 'Pawl', group: 'Clutch', role: `A hooked pawl. Its pivot sits near the tangent at mid-tooth, so the face force pulls it into the tooth (self-engaging up to μ ${(() => { let m = 0; for (let x = 0; x < 1; x += 0.01) if (pawlMoment(u, x, G) > 0) m = x; return m.toFixed(2); })()}). Its tip lifts ${(u.rTip - u.rRoot)} mm over each tooth.`, specs: [['Pivot to tip', `${G.l.toFixed(1)} mm`], ['Crest overrun c', deg(G.c)]], live: ['gap', 'state'] },
      spring: { name: 'Pawl spring', group: 'Spring', role: 'A coil spring from a lug on the lever to the back of the pawl. It keeps the tip on the teeth, so the pawl drops into each tooth: the click.', specs: [['Coil', '7.2 mm, 6 turns']], live: ['state'] },
    };
  }
  if (id === 'sprag') {
    const S = spragGeo(u);
    return { ...common,
      shaft: { name: 'Input shaft', group: 'Input', role: 'Keyed to the inner race.', specs: [['Diameter', '20 mm']], live: ['in'] },
      inner: { name: 'Inner race (input)', group: 'Input', role: 'When it turns forward, friction tilts each sprag up, the sprag gets taller than the gap, and it wedges. When it turns back, the sprags tilt down and the race slides under them.', specs: [['Radius', `${u.ri} mm`]], live: ['in', 'state'] },
      outer: { name: 'Outer race (output)', group: 'Output', role: 'A gear ring on the outside takes the drive away. The sprags lock it to the inner race in one direction only.', specs: [['Bore', `${u.ro} mm`], ['Gap', `${u.ro - u.ri} mm`]], live: ['out'] },
      sprag: { name: 'Sprag', group: 'Clutch', role: `A hardened strut with two curved contact faces. The line between its contacts leans ${deg(S.epsI)} from the radius; tan ε = ${Math.tan(S.epsI).toFixed(3)} is under the friction μ ${u.mu}, so it wedges instead of slipping. It has no teeth, so it locks at any angle.`, specs: [['Count', String(u.Z)], ['Strut angle ε', deg(S.epsI)], ['Contact load', `${(S.Q / 1000).toFixed(2)} kN at ${u.T / 1000} N·m`], ['Take-up', deg(S.e)]], live: ['gap', 'state'] },
      cage: { name: 'Cage', group: 'Clutch', role: 'A ring under the sprags. In a real clutch it has a window for each sprag, so they stay spaced and all tilt and lock together.', specs: [] },
      garter: { name: 'Garter spring', group: 'Spring', role: 'A ring spring through the sprags. It tips every sprag lightly onto both races, so there is no gap to close before it locks.', specs: [] },
    };
  }
  const G = pawlGeo(u);
  return { ...common,
    axle: { name: 'Axle', group: 'Frame', role: 'Fixed in the frame. The hub shell and the freehub body turn on it in bearings.', specs: [['Diameter', '16 mm']] },
    shell: { name: 'Hub shell (output)', group: 'Output', role: 'The wheel hub, with the spoke flange. While the rider stops pedalling the wheel keeps turning and the pawls click: the freehub buzz.', specs: [['Spoke holes', '20']], live: ['out'] },
    ring: { name: `Drive ring, ${u.N} teeth`, group: 'Output', role: `Internal saw teeth fixed in the hub shell. ${u.N} teeth and ${u.pawls} pawls in phase give ${u.N} points of engagement, one every ${(360 / u.N).toFixed(0)}°.`, specs: [['Teeth', String(u.N)], ['Depth', `${u.rRoot - u.rTip} mm`], ['Engagement', `${(360 / u.N).toFixed(0)}°`]], live: ['gap'] },
    body: { name: 'Freehub body (input)', group: 'Input', role: 'The chain turns the cassette, and the cassette turns the body. The body carries the pawls.', specs: [['Splines', '9']], live: ['in', 'state'] },
    pawl: { name: 'Pawl', group: 'Clutch', role: `One of ${u.pawls} pawls that tip out into the ring. The pivot must sit inside the ring, so the tip moves along the teeth as it folds: it clears a crest ${deg(G.c)} late.`, specs: [['Pivot to tip', `${G.l.toFixed(1)} mm`], ['Crest overrun c', deg(G.c)]], live: ['gap', 'state'] },
    spring: { name: 'Pawl spring', group: 'Spring', role: 'A small coil spring under each pawl that pushes it out against the ring.', specs: [] },
    cassette: { name: 'Cassette', group: 'Input', role: 'Three chain cogs on the splined body: 18, 16 and 14 teeth for 1/2 in chain. Small cogs, so the pawls stay in view.', specs: [['Cogs', '18 · 16 · 14']] },
  };
}
