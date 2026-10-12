// ============================================================================
//  TWENTY TO FOUR  ·  story.js — the chapters of the story column
// ----------------------------------------------------------------------------
//  Each chapter names the stage scene it drives (scenes.js) and holds its
//  prose as HTML. Markup inside the prose:
//      {{key}}                inline formula (tex.js key, drawn by math.js)
//      <div data-eq="key">    a display formula
//      <div data-w="name">    a widget that main.js builds (see WIDGETS)
//  main.js renders the chapters in order and makes the chapter whose head
//  is nearest the top third of the column the active one. The active
//  chapter sets the stage scene.
//
//  SCENES: fold, field, curlB, curlE, div, four, gauge, forms (scenes.js).
//  WIDGETS: groups, quantities, four, falloff, maps, fieldctl, curl,
//           div, gauge, forms (main.js "function widget").
//  grep -n "id: '"   jumps to each chapter.
// ============================================================================
export const CHAPTERS = [
  {
    id: 'twenty', scene: 'fold', kicker: 'Maxwell, 1865', title: 'Twenty equations',
    html: `
<p class="lede">In 1865 James Clerk Maxwell wrote the electromagnetic field as twenty equations in twenty unknowns. He wrote each law three times, once for each of x, y and z, because vector notation was not yet in common use.</p>
<p>His eight groups are below, with his own letters. Point at a group and the stage marks its lines.</p>
<div data-w="groups"></div>
<p>His twenty unknowns, with the names we use today:</p>
<div data-w="quantities"></div>
<p>About twenty years later Oliver Heaviside, and on his own Josiah Willard Gibbs, gave physics the operators {{idivE}} and {{icurlE}}. Each triple of component lines folds into one vector equation. Four of the results are the laws we now call Maxwell’s equations. Groups E and F describe the material, not the field, and group H follows from the four.</p>
<div data-w="four"></div>
<p class="aside">The stage plays the fold. Each group flows into the law that absorbs it, and then the four laws flow into the two equations of differential forms, the last chapter.</p>`,
  },
  {
    id: 'field', scene: 'field', kicker: 'The source', title: 'The field the laws govern',
    html: `
<p>One source drives every picture on this page: a small charge that runs up and down the vertical axis, a Hertzian dipole. The orange curves are the lines of {{iE}}. The wash is {{iB}}, which circles the axis and so crosses this plane: blue toward you, violet away.</p>
<div data-eq="Efull"></div>
<div data-eq="Bfull"></div>
<p>The field has three parts. Close to the source the static dipole field wins, and it falls as {{ir3}}. Far away only the part that falls as {{ir1}} is left. That part carries energy away: it is light. The dashed ring is {{ikr1}}, where the three parts are equal.</p>
<div data-w="falloff"></div>
<p>Each orange curve is a level line of one function of position and time, so the stage draws the lines exactly at any zoom. Watch the loops pinch off near the dashed ring and move out at the speed of light.</p>
<div data-eq="lines"></div>
<p>Show one of Maxwell’s quantities on the plane:</p>
<div data-w="maps"></div>
<div data-w="fieldctl"></div>`,
  },
  {
    id: 'curlB', scene: 'curlB', kicker: 'Groups A and C → law IV', title: 'Curl: circulation round three small loops',
    html: `
<p>Each line of Maxwell’s group C is a circulation. Walk round a small square in one coordinate plane, add up {{iB}} along the way, and divide by the area of the square. As the square shrinks, that ratio is one component of the curl.</p>
<div data-eq="curlDef"></div>
<p>The three coordinate planes give the three components. They are Maxwell’s three lines:</p>
<div data-eq="cBx"></div><div data-eq="cBy"></div><div data-eq="cBz"></div>
<p>Together they are one vector, {{icurlB}}. Heaviside wrote the three lines as one with the Levi-Civita symbol {{ieps}}. In empty space the curl equals Maxwell’s displacement current. On the stage the three loop arrows add head to tail, and the blue sum lands on the orange arrow of {{idEdt}}.</p>
<div data-eq="curlBvac"></div>
<div data-w="curl"></div>
<p class="aside">Tap or click the sheet to move the probe. The zx loop collects nothing on this sheet: there {{iB}} goes straight through it, so no part of {{iB}} runs along its edges.</p>`,
  },
  {
    id: 'curlE', scene: 'curlE', kicker: 'Group D → law III', title: 'Faraday: a changing B curls E',
    html: `
<p>Maxwell’s group D gives the electric force from the potentials: {{pE}} for a field at rest. Take the curl of it. The curl of a gradient is zero, so the {{iphi}} term goes, and Faraday’s law is what is left.</p>
<div data-eq="curlgrad"></div>
<div data-eq="cEx"></div><div data-eq="cEy"></div><div data-eq="cEz"></div>
<div data-eq="curlE"></div>
<p>Here only the zx loop has a circulation, because {{iE}} lies in the sheet and so runs round the loop that stands in the sheet. The curl points along y, through the sheet, and it lands on the blue arrow of {{lmdBdt}}.</p>
<div data-w="curl"></div>`,
  },
  {
    id: 'div', scene: 'div', kicker: 'Group G → law I, group B → law II', title: 'Divergence: flux out of a small cube',
    html: `
<p>Gauss’s law counts what leaves a closed surface. Put a small cube round a point and add up the flux out through its six faces. Divided by the volume, as the cube shrinks, that is the divergence.</p>
<div data-eq="divDef"></div>
<p>Opposite faces pair up. The flux out of the right face minus the flux in at the left face gives one term, a partial derivative. Three pairs give Maxwell’s line G.</p>
<div data-eq="divE"></div>
<div data-w="div"></div>
<p>Away from the charge all three terms of {{idivE}} can be large, but they cancel. For {{iB}} the zero needs no luck: group B writes {{iB}} as the curl of {{iA}}, and the divergence of any curl is zero.</p>
<div data-eq="divcurl"></div>`,
  },
  {
    id: 'four', scene: 'four', kicker: 'Heaviside, 1884', title: 'Four laws, one field',
    html: `
<div data-w="four"></div>
<p>The stage now shows the field in three dimensions. The E loops lie in the planes through the axis. The B loops are circles round the axis. Each B loop links E loops, and each E loop links B loops.</p>
<p>Laws III and IV feed each other: a curling E goes with a changing B, and a curling B with a changing E. That is how the loops leave the source and travel on their own.</p>
<p>The glassy surface is the radiation pattern: the power sent out in each direction. Nothing goes out along the axis.</p>
<div data-eq="power"></div>`,
  },
  {
    id: 'gauge', scene: 'gauge', kicker: 'Groups B and D, rewritten', title: 'Potentials and gauge',
    html: `
<p>Maxwell built his equations on two potentials, {{iphi}} and {{iA}}. Heaviside distrusted them and wrote the four laws with {{iE}} and {{iB}} only. But the potentials make two of the four laws automatic.</p>
<div data-eq="pB"></div><div data-eq="pE"></div>
<p>With the first, law II holds for any {{iA}}. With the second, law III holds. The potentials are not unique: add the gradient of any function {{ichi}} to {{iA}}, take its time derivative from {{iphi}}, and {{iE}} and {{iB}} do not change. This freedom is a gauge.</p>
<div data-eq="gaugeA"></div><div data-eq="gaugeP"></div>
<div data-w="gauge"></div>
<p>The green arrows are {{iA}}. The slider adds a breathing blob {{ichiG}}. The arrows swirl round it, and the orange lines of {{iE}} do not move at all.</p>
<p class="aside">This page uses the Lorenz gauge. In it the potentials of the dipole are retarded: {{iA}} is the current of the source, late by the travel time of light.</p>
<div data-eq="dipA"></div>`,
  },
  {
    id: 'forms', scene: 'forms', kicker: 'Differential forms', title: 'Two equations',
    html: `
<p>In spacetime, {{iE}} and {{iB}} are one object: the 2-form {{iF}}. Written out in the coordinates t, x, y, z, it is an antisymmetric 4 × 4 array, with {{iE}} in the time row and {{iB}} in the space block.</p>
<div data-eq="Fdef"></div>
<div data-w="forms"></div>
<p>The four components of {{id}}{{iF}} are laws II and III. The other two laws become one equation too, where {{istar}} swaps the roles of {{iE}} and {{iB}}:</p>
<div data-eq="lawdF"></div><div data-eq="lawdsF"></div>
<p>Why is {{id}}{{iF}} zero for any field? Because {{iF}} is {{id}}{{iA}}, and {{id}} applied twice gives zero. In geometry this says that the boundary of a boundary is empty. On the stage, each face of the cube has its loop, and next to each edge two loops run in opposite directions, so every edge cancels.</p>
<div data-eq="ddA"></div><div data-eq="dd0"></div>
<p class="coda">Twenty equations, then four, then two. The physics did not change. Each new notation shows more of its geometry.</p>`,
  },
];
