/* ════════════════════════════════════════════════════════════════════
   REFERENCE PANEL CONTENT
   ──────────────────────────────────────────────────────────────────── */
// Build the right-panel reference HTML for a scenario. Each scenario names
// a body key in its ref; this returns the matching markup string.
function refContent(key){
  // One row per module type (the core is omitted, it is not placeable).
  if(key==='moduleLibrary'){
    return Object.entries(MOD).filter(([k])=>k!=='C').map(([k,v])=>(
      '<div class="ref-row" style="--rc:'+v.color+'"><span class="ref-glyph">'+k+'</span><span>'+v.name+'</span><span class="ref-tag">'+v.tag+'</span></div>'
    )).join('');
  }
  // How enclosed cells hold, filter, and group into shared regions.
  if(key==='storageRules'){
    return '<div class="scn-desc">'+
      '<p>Each enclosed cell holds up to <strong>64 units</strong> of one resource type.</p>'+
      '<p style="margin-top:6px">Right-click a cell in-game to set a filter — restrict the zone to specific resource categories.</p>'+
      '<p style="margin-top:6px">Connected enclosed cells form one <strong>region</strong> with a shared ID, used by foundries to know where to pull and deposit.</p></div>';
  }
  // What happens to stored stacks when an enclosure breaks.
  if(key==='ejectionPhysics'){
    return '<div class="scn-desc">'+
      '<p>When a wall breaks, the enclosure recomputes. Cells now reachable from outside <strong>decompress</strong> — all stored stacks eject as floating items with radial velocity from the breach point.</p>'+
      '<p style="margin-top:6px">In-game these are collectable: any citizen with <strong>Collect</strong> enabled will gather them back.</p>'+
      '<p style="margin-top:6px">Deconstructing a built module also ejects 25–65% of its build cost as a partial refund.</p></div>';
  }
  // Tier-1 smelting table: each ore, its ingot, the 1:7 yield, and time.
  if(key==='smeltingTable'){
    const rows = [
      ['Fe','Iron Ingot','×7','8s'],['Cu','Copper Ingot','×7','7s'],['C','Carbon Brick','×7','6s'],
      ['Al','Aluminum Ingot','×7','10s'],['Si','Silicon Wafer','×7','12s'],['Ti','Titanium Ingot','×7','15s'],
      ['Au','Gold Ingot','×7','12s'],['U','Uranium Ingot','×7','25s'],
    ];
    return '<div style="font-size:11px;color:var(--text-dim);line-height:1.6">'+
      rows.map(r=>'<div style="display:flex;gap:8px;padding:3px 0;border-bottom:1px solid var(--border)"><span style="color:var(--orange);font-weight:600;width:24px">'+r[0]+'</span><span style="flex:1">'+r[1]+'</span><span style="color:var(--yellow)">'+r[2]+'</span><span style="color:var(--text-faint)">'+r[3]+'</span></div>').join('')+
      '</div>';
  }
  // One row per crew task with its colour and skill label.
  if(key==='taskRef'){
    const tasks = [
      {n:'Search',     c:'#8c5ac8', s:'Prospecting'},
      {n:'Collect',    c:'#2878c8', s:'Logistics'},
      {n:'Construct',  c:'#c8a01e', s:'Construction'},
      {n:'Mine',       c:'#be8232', s:'Mining'},
      {n:'Harvest',    c:'#3ca032', s:'Agriculture'},
      {n:'Metallurgy', c:'#b45028', s:'Metallurgy'},
      {n:'Rest',       c:'#6878a0', s:'(need<10% en)'},
    ];
    return tasks.map(t=>(
      '<div class="ref-row" style="--rc:'+t.c+'"><span class="ref-glyph">'+t.n.charAt(0)+'</span><span>'+t.n+'</span><span class="ref-tag">'+t.s+'</span></div>'
    )).join('');
  }
  // A worked example: the full input tree of a Reactor Core.
  if(key==='reactorChain'){
    return '<div class="scn-desc"><p>Reactor Core: <strong>2× Uranium Ingot + 3× Steel + 2× Titanium Alloy</strong> · 20s craft.</p>'+
      '<p style="margin-top:6px">Full chain reaches <strong>4 ores</strong>: Uranium, Iron, Carbon, Titanium, Aluminum.</p>'+
      '<p style="margin-top:6px">Steel = 2 Fe Ingot + 1 C Brick. Ti Alloy = 2 Ti Ingot + 3 Al Ingot.</p>'+
      '<p style="margin-top:6px">Click the <code>Reactor</code> node on the canvas to highlight every input.</p></div>';
  }
  return '';
}

/* Auto-orient — matches station_modules/crew.rs::auto_orient_processing_modules.
   When a processing module (F/P/A/L) is operational with no output direction,
   the engine picks the first direction with a valid input region.
   Preference order: South > East > North > West. */
const DIR_PREFERENCE = [
  {name:'South', vec:[0,1],  dir:1},
  {name:'East',  vec:[1,0],  dir:0},
  {name:'North', vec:[0,-1], dir:3},
  {name:'West',  vec:[-1,0], dir:2},
];
function autoOrientFoundry(gx, gy){
  // For each preferred direction, check if the OPPOSITE side has at least one
  // enclosed cell (which would be the input). Output goes in the preferred dir.
  for(const p of DIR_PREFERENCE){
    // Output side cell
    const ox = gx + p.vec[0], oy = gy + p.vec[1];
    // Need at least one non-output adjacent cell that's enclosed (input candidate)
    let hasInput = false;
    for(const q of DIR_PREFERENCE){
      if(q.dir === p.dir) continue;
      const ix = gx + q.vec[0], iy = gy + q.vec[1];
      if(state.enclosed.has(gKey(ix,iy))){ hasInput = true; break; }
    }
    if(hasInput) return p.dir;
  }
  return null;  // warning state — no valid I/O direction
}

