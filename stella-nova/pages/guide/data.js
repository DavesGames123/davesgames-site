// ════════════════════════════════════════════════════════════════════
//  STATIONS  ·  interactive tutorial for the station-building game
// ────────────────────────────────────────────────────────────────────
//  One 2D <canvas> teaches six game mechanics, one scenario at a time. A
//  scenario card bar selects the active lesson; the render loop dispatches
//  by scenario id and paints only that lesson. Every scenario shares one
//  square grid, one flood-fill enclosure test, and one mutable state
//  object. Selecting a scenario clears state and runs that scenario's
//  setup(), which seeds the modules, resources, citizens, or graph the
//  lesson needs.
//
//  The six scenarios each demonstrate one system of the real game:
//      1 Placement    grid rules: connected, no 2×2 block, placement tags
//      2 Enclosure    walls that fully surround empty cells make storage
//      3 Decompress   breaking a wall ejects the stored resources
//      4 Foundry      a foundry wall smelts ore from one bay into the other
//      5 Crew         citizens pick tasks by priority and skill toggles
//      6 Tiers        the resource dependency graph, T0 ore up to T5 fuel
//
//  Several routines carry a note naming the Rust source they mirror (for
//  example crew.rs, metallurgy.rs, requests.rs). The tutorial reproduces
//  the engine behaviour so the demo matches the shipped game.
//
//  SCREEN LAYOUT  (# marks an element id in index.html)
//      ┌──────────────────────────────────────────────────────────────┐
//      │ topbar     STATIONS · LIVE PRACTICE · HUD readouts            │
//      ├──────────────────────────────────────────────────────────────┤
//      │ #scnBar    ◰ ◫ ◐ ◈ ◇ ◆   six scenario cards                   │
//      ├──────────────────────────────────────────────────────────────┤
//      │ ctrl-bar   ↻ RESET · ▶ AUTO-BUILD · ⤿ ROTATE OUTPUT           │
//      ├───────────────────────────────────┬──────────────────────────┤
//      │ #canvasArea                        │ #sideR                   │
//      │   #cv   the lesson canvas          │   headline + description │
//      │   #hint #sel #toast overlays       │   How it works notes     │
//      │   #palette (placement scenarios)   │   #refPanel reference    │
//      │   #taskBox (crew scenario)         │                          │
//      └───────────────────────────────────┴──────────────────────────┘
//
//  FRAME PIPELINE  (render, once per animation frame)
//      resize ▶ phosphor fade ▶ space grid ▶ dispatch by scenario id ▶
//        tiers  : drawTiers
//        others : enclosed cells ▶ resources ▶ per-scenario update ▶
//                 modules ▶ crew/foundry actors ▶ particles ▶ hover
//      ▶ updateHud ▶ requestAnimationFrame(render)
//
//  SCENARIO DISPATCH  (one input path, one draw path, keyed by s.id)
//      onTap(p) ─┬─ placement  ─▶ handlePlacement
//                ├─ enclosure  ─▶ handleEnclosure
//                ├─ decompress ─▶ handleDecompress
//                ├─ foundry    ─▶ handleFoundry
//                ├─ crew       ─▶ (DOM task toggles only)
//                └─ tiers      ─▶ handleTiers
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  ────────────────────────────────────────────────────────────────────
//      module library ....... "const MOD ="        module types + rules
//      grid utilities ....... "GRID UTILITIES"      key/screen/adjacency
//      enclosure test ....... "computeEnclosed"     flood fill from outside
//      state ................ "const state ="       the one mutable object
//      scenarios ............ "const SCENARIOS ="   the six lesson configs
//      tier graph data ...... "TIER_NODES"          nodes and edges
//      reference panel ...... "function refContent" right-panel html
//      auto-orient .......... "autoOrientFoundry"   pick output direction
//      scenario lifecycle ... "function loadScenario" reset + seed a lesson
//      palette / tasks ...... "function buildPalette" bottom-bar controls
//      input ................ "function onTap"      pointer to scenario
//      readouts ............. "function updateHud"  HUD + selection bar
//      rendering ............ "function resize"     canvas + draw helpers
//      foundry worker ....... "updateFoundryWorker" smelting state machine
//      crew simulation ...... "function pickCitizenTask" task priority
//      tier rendering ....... "function layoutTierNodes" graph draw
//      main loop ............ "function render"     the per-frame update
//      scenario bar ......... "function buildScnBar" the card row
//      mobile drawer ........ "function toggleDrawer" side-panel toggle
//      boot ................. "buildScnBar()"        start the page
// ════════════════════════════════════════════════════════════════════

/* ════════════════════════════════════════════════════════════════════
   MODULE LIBRARY
   ──────────────────────────────────────────────────────────────────── */
// Every placeable module type, keyed by its single-letter glyph. name is
// the label, color drives every draw, placement is the grid rule (auto /
// any / interior / exterior), tag groups it, work is the build cost.
const MOD = {
  C: {name:'Core',        color:'#c878d8', placement:'auto',     tag:'STRUCT', work:0},
  W: {name:'Wall',        color:'#ff8844', placement:'any',      tag:'STRUCT', work:150},
  V: {name:'Wall (white)',color:'#c8c8d8', placement:'any',      tag:'STRUCT', work:150},
  Q: {name:'Quarters',    color:'#4ad8e0', placement:'interior', tag:'INTRA',  work:600},
  D: {name:'Docking',     color:'#4a90d0', placement:'exterior', tag:'EXTRA',  work:1000},
  G: {name:'Greenhouse',  color:'#64c864', placement:'interior', tag:'INTRA',  work:750},
  M: {name:'Medical',     color:'#e06080', placement:'interior', tag:'INTRA',  work:900},
  R: {name:'Recreation',  color:'#a060c8', placement:'interior', tag:'INTRA',  work:500},
  S: {name:'Shield',      color:'#5ac8e0', placement:'any',      tag:'ANY',    work:1250},
  F: {name:'Foundry',     color:'#ff8844', placement:'any',      tag:'PROD',   work:800},
  P: {name:'Fuel Proc',   color:'#ff5050', placement:'any',      tag:'PROD',   work:1000},
  A: {name:'Assembler',   color:'#ffc832', placement:'any',      tag:'PROD',   work:900},
  L: {name:'Lab',         color:'#c878d8', placement:'any',      tag:'PROD',   work:1200},
};

/* ════════════════════════════════════════════════════════════════════
   GRID UTILITIES — shared by placement/enclosure/decompression/foundry
   ──────────────────────────────────────────────────────────────────── */
// cellSize is pixels per cell; cx/cy is the screen pixel of grid origin
// (0,0). centerGrid() keeps the origin at the canvas centre on resize.
const GRID = {cellSize: 30, cx: 0, cy: 0};

// String key for a grid cell, used as a Set/map key for walls and cells.
function gKey(gx,gy){ return gx+','+gy; }
// Grid cell centre to canvas pixel.
function gridToScreen(gx,gy){ return {x: GRID.cx + gx*GRID.cellSize, y: GRID.cy + gy*GRID.cellSize}; }
// Canvas pixel to nearest grid cell (inverse of gridToScreen).
function screenToGrid(sx,sy){
  return {gx: Math.round((sx - GRID.cx) / GRID.cellSize),
          gy: Math.round((sy - GRID.cy) / GRID.cellSize)};
}
// The module occupying a cell, or undefined.
function moduleAt(gx,gy){ return state.modules.find(m=>m.gx===gx && m.gy===gy); }

// A new cell is connected if any of its four neighbours holds a module
// (the first module placed is connected by definition).
function isConnected(gx,gy){
  if(state.modules.length===0) return true;
  const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
  return dirs.some(([dx,dy]) => moduleAt(gx+dx,gy+dy));
}
// The crossword rule: no filled 2×2 square. Test the four 2×2 blocks that
// could contain (gx,gy) as a corner, treating that cell as filled.
function makes2x2(gx,gy){
  // With (gx,gy) hypothetically filled, does any 2x2 block become full?
  const has = (x,y) => (x===gx && y===gy) || !!moduleAt(x,y);
  const tlCands = [[gx-1,gy-1],[gx,gy-1],[gx-1,gy],[gx,gy]];
  return tlCands.some(([tx,ty]) => has(tx,ty) && has(tx+1,ty) && has(tx,ty+1) && has(tx+1,ty+1));
}
// A cell is interior when all four neighbours hold modules (walled in).
function isInterior(gx,gy){
  return [[0,-1],[0,1],[-1,0],[1,0]].every(([dx,dy]) => moduleAt(gx+dx,gy+dy));
}
// Gate a placement against every grid rule and report the first failure:
// occupied, disconnected, forms a 2×2, or breaks the type's placement tag.
function validatePlacement(gx,gy,type){
  if(moduleAt(gx,gy)) return {ok:false, reason:'occupied'};
  if(!isConnected(gx,gy)) return {ok:false, reason:'not connected to station'};
  if(makes2x2(gx,gy)) return {ok:false, reason:'forms 2×2 block'};
  const p = MOD[type].placement;
  if(p==='interior' && !isInterior(gx,gy)) return {ok:false, reason:type+' must be interior (all 4 sides walled)'};
  if(p==='exterior' && isInterior(gx,gy)) return {ok:false, reason:type+' must face open space'};
  return {ok:true};
}

/* Flood-fill enclosure detection */
// A cell is "enclosed" storage when it is empty and cannot be reached from
// outside the station. Flood the exterior from a corner two cells beyond
// the module bounding box; any empty cell the flood never reaches is walled
// in. Returns the set of enclosed cell keys.
function computeEnclosed(){
  if(state.modules.length<3) return new Set();
  // Treat every module cell as a wall the flood cannot cross.
  const walls = new Set(state.modules.map(m=>gKey(m.gx,m.gy)));
  // Bounding box of all modules.
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const m of state.modules){
    minX=Math.min(minX,m.gx); maxX=Math.max(maxX,m.gx);
    minY=Math.min(minY,m.gy); maxY=Math.max(maxY,m.gy);
  }
  // Pad by 2 so the flood surrounds the station on every side.
  minX-=2; maxX+=2; minY-=2; maxY+=2;
  // Breadth-first flood of everything reachable from the padded corner.
  const reach = new Set();
  const q = [[minX,minY]];
  reach.add(gKey(minX,minY));
  while(q.length){
    const [x,y] = q.shift();
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=x+dx, ny=y+dy, k=gKey(nx,ny);
      if(nx<minX||nx>maxX||ny<minY||ny>maxY) continue;
      if(reach.has(k)||walls.has(k)) continue;
      reach.add(k);
      q.push([nx,ny]);
    }
  }
  // Any interior cell that is neither a wall nor reachable is enclosed.
  const enclosed = new Set();
  for(let x=minX+1;x<=maxX-1;x++){
    for(let y=minY+1;y<=maxY-1;y++){
      const k = gKey(x,y);
      if(walls.has(k)||reach.has(k)) continue;
      enclosed.add(k);
    }
  }
  return enclosed;
}

/* ════════════════════════════════════════════════════════════════════
   STATE
   ──────────────────────────────────────────────────────────────────── */
// The one mutable object every scenario reads and writes. loadScenario()
// clears it and each scenario's setup() fills only the fields it needs, so
// unused fields stay empty for the active lesson.
const state = {
  scnIdx: 0,
  modules: [],         // {gx, gy, type, built}
  enclosed: new Set(),
  particles: [],       // ejected resources
  resources: {},       // gKey -> [{type, count}]
  hover: null,         // {gx, gy}
  paletteSel: 'W',
  foundry: null,       // {gx, gy, dir:0..3}
  flowParticles: [],
  citizens: [],        // {x, y, task, target, color}
  asteroids: [],
  taskOn: {},          // {Search:true, Mine:true, ...}
  taskCount: {},       // for HUD
  tierSel: null,       // selected node id in tier scenario
  autoBuild: false,
  t: 0,
};
let ents_dummy = [];
// W/H are the canvas CSS size in pixels; dpr scales the backing store for
// crisp lines on high-density displays. cv/ctx are the canvas and its 2D
// drawing context.
let W=0, H=0;
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const dpr = window.devicePixelRatio||1;

/* ════════════════════════════════════════════════════════════════════
   SCENARIOS
   ──────────────────────────────────────────────────────────────────── */
// Each scenario is a self-contained lesson config. Shared fields: id (the
// dispatch key), name/icon/accent (the card), head/desc/notes/hint (the
// panel text), showPalette / autoBuildable / rotBtn flags (which controls
// appear), setup() (seed state for the lesson), and ref (right-panel
// reference content). loadScenario() reads all of these.
const SCENARIOS = [
  // 1 · Placement — free build from the core under the grid rules.
  {
    id:'placement', name:'Placement', icon:'◰', accent:'#96c8ff',
    head:'Grid <em>Placement</em>',
    desc:'Build outward from the core. Modules must be connected, can\'t form 2×2 blocks, and obey their placement rules.',
    notes:[
      'Connected: a new module must touch an existing one cardinally.',
      'No 2×2: the crossword rule keeps layouts open.',
      'Interior tags (<code>Q G M R</code>) need all 4 sides walled.'
    ],
    hint:'Pick a module from the palette · click an empty cell · invalid placements flash red',
    showPalette: true,
    autoBuildable: true,
    // Seed a lone core; the player builds outward with the wall palette.
    setup(){
      state.modules = [{gx:0,gy:0,type:'C',built:true}];
      state.paletteSel = 'W';
    },
    ref: {title:'Module Library', body:'moduleLibrary'}
  },
  // 2 · Enclosure — close wall gaps so empty cells become storage.
  {
    id:'enclosure', name:'Enclosure', icon:'◫', accent:'#4ad8e0',
    head:'Enclosed <em>Storage</em>',
    desc:'Empty cells fully surrounded by built modules become storage regions. Each cell holds up to 64 units.',
    notes:[
      'Close the wall gaps to enclose the empty cells inside.',
      'Enclosed cells phosphor-glow teal.',
      'Adjacent enclosed cells form one region for the foundry.'
    ],
    hint:'Place walls (<code>W</code>) to close the gaps · enclosed cells turn teal · they fill with resources',
    showPalette: true,
    autoBuildable: true,
    // Seed a nearly-closed ring with a few gaps for the player to fill.
    setup(){
      // Pre-built U-shape with 3 missing wall cells
      const m = [];
      m.push({gx:0,gy:0,type:'C',built:true});
      // Top edge
      for(let x=-3;x<=3;x++) m.push({gx:x,gy:-3,type:'W',built:true});
      // Left edge
      for(let y=-3;y<=3;y++) if(y!==-3) m.push({gx:-3,gy:y,type:'W',built:true});
      // Right edge with two gaps
      for(let y=-3;y<=3;y++){
        if(y===-3) continue;
        if(y===0 || y===2) continue;  // gaps
        m.push({gx:3,gy:y,type:'W',built:true});
      }
      // Bottom edge with gap
      for(let x=-3;x<=3;x++){
        if(x===0) continue;  // gap
        m.push({gx:x,gy:3,type:'W',built:true});
      }
      // Drop the core duplicate at (0,0) — it's already in the loop with type W? no, core is at 0,0
      // Filter duplicates at (0,0)
      // Keep the first module at each cell so the core is not overwritten.
      const seen = new Set();
      state.modules = m.filter(mm=>{
        const k = gKey(mm.gx,mm.gy);
        if(seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      state.paletteSel = 'W';
    },
    ref: {title:'Storage Rules', body:'storageRules'}
  },
  // 3 · Decompression — breaking a wall vents the resources it enclosed.
  {
    id:'decompress', name:'Decompression', icon:'◐', accent:'#ff5050',
    head:'<em>Decompression</em>',
    desc:'Break a wall enclosing storage and everything inside ejects explosively into orbit.',
    notes:[
      'Click any wall to remove it.',
      'If removing the wall breaks an enclosure, the resources eject.',
      'Plan demolition: interior modules before exterior walls.'
    ],
    hint:'Click any orange wall · watch the bay decompress · resources scatter as ejecta',
    showPalette: false,
    autoBuildable: false,
    // Seed a sealed bay already packed with mixed resources.
    setup(){
      // Fully enclosed rectangle, full of resources
      const m = [{gx:0,gy:0,type:'C',built:true}];
      // 7x5 enclosed bay
      for(let x=-3;x<=3;x++){ m.push({gx:x,gy:-3,type:'W',built:true}); m.push({gx:x,gy:3,type:'W',built:true}); }
      for(let y=-2;y<=2;y++){
        m.push({gx:-3,gy:y,type:'W',built:true});
        m.push({gx:3,gy:y,type:'W',built:true});
      }
      const seen = new Set();
      state.modules = m.filter(mm=>{
        const k = gKey(mm.gx,mm.gy);
        if(seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      // Pack the interior with resources
      // Give each enclosed cell one resource stack, cycling the label list
      // and randomising the count so the bay reads as full of mixed ore.
      state.resources = {};
      const enc = computeEnclosed();
      const labels = ['Fe','Cu','C','Al','Si','Ti','Au'];
      const cols   = ['#d08050','#d8a050','#8a8a8a','#c8c8d8','#a0c8e0','#c8a880','#ffd040'];
      let i = 0;
      for(const k of enc){
        const idx = i % labels.length;
        const ct = 30 + Math.floor(Math.random()*34);
        state.resources[k] = [{label:labels[idx], color:cols[idx], count:ct}];
        i++;
      }
      state.enclosed = enc;
      state.particles = [];
    },
    ref: {title:'Ejection Physics', body:'ejectionPhysics'}
  },
  // 4 · Foundry Flow — a foundry wall smelts ore from one bay to the other.
  {
    id:'foundry', name:'Foundry Flow', icon:'◈', accent:'#ff8844',
    head:'Foundry <em>Membrane</em>',
    desc:'A foundry is a wall between two storage regions. A citizen with Metallurgy enabled docks at the foundry, consumes 1 input, and produces the recipe output. No manual recipe selection — foundries auto-detect from input ore.',
    notes:[
      'Direction is <strong>auto-oriented</strong> S>E>N>W on placement.',
      'Output side gets the ingot; <strong>all other adjacent</strong> enclosed cells are inputs.',
      'Work cost = <code>inputs × 200</code>. One ore → seven ingots.'
    ],
    hint:'Click <strong>↺ ROTATE OUTPUT</strong> · or click input cells to add ore · a Metallurgy worker will dock and process',
    showPalette: false,
    autoBuildable: false,
    // Seed two bays split by a divider, a foundry in the divider gap, and
    // one Metallurgy worker to dock and smelt.
    setup(){
      // Pre-built foundry station
      const m = [{gx:0,gy:0,type:'C',built:true}];
      // Outer rectangle 11 wide x 5 tall
      for(let x=-5;x<=5;x++){ m.push({gx:x,gy:-3,type:'W',built:true}); m.push({gx:x,gy:3,type:'W',built:true}); }
      for(let y=-2;y<=2;y++){ m.push({gx:-5,gy:y,type:'W',built:true}); m.push({gx:5,gy:y,type:'W',built:true}); }
      // Divider at x=0 with foundry in middle
      for(let y=-2;y<=2;y++){
        if(y===0) continue;
        m.push({gx:0,gy:y,type:'W',built:true});
      }
      m.push({gx:0,gy:0,type:'F',built:true});  // foundry replaces core
      const seen = new Set();
      state.modules = m.filter(mm=>{
        const k = gKey(mm.gx,mm.gy);
        if(seen.has(k)) return false; seen.add(k); return true;
      });
      // Foundry direction: 0=East, 1=South, 2=West, 3=North
      // East-output by default → input on left bay
      state.foundry = {gx:0, gy:0, dir:0, progress:null, claimed:false};
      // Single Metallurgy worker — matches behaviors/metallurgy.rs state machine
      state.foundryWorker = {
        x: W*0.08, y: H*0.50, vx:0, vy:0, dir:0,
        state:'searching', timer:0,
        workDone:0, workNeeded:0,
      };
      // Stock left bay with iron ore
      // Left bay (gx<0) is the input and gets ore; right bay stays empty as
      // the output the foundry fills with ingots.
      const enc = computeEnclosed();
      state.resources = {};
      for(const k of enc){
        const [gx,gy] = k.split(',').map(Number);
        if(gx < 0){
          state.resources[k] = [{label:'Fe', color:'#d08050', count:40+Math.floor(Math.random()*20)}];
        } else {
          state.resources[k] = [];  // empty output
        }
      }
      state.enclosed = enc;
      state.flowParticles = [];
    },
    ref: {title:'Tier 1 Smelting', body:'smeltingTable'}
  },
  // 5 · Crew & Tasks — citizens choose tasks from the enabled toggles.
  {
    id:'crew', name:'Crew & Tasks', icon:'◇', accent:'#c8a01e',
    head:'Crew <em>Tasks</em>',
    desc:'Toggle which tasks each citizen will perform. They autonomously prioritize based on skill and station needs.',
    notes:[
      'Each citizen is colored by their current task.',
      'Toggle tasks in the panel · citizens immediately re-prioritize.',
      'Mining requires asteroids · Construct requires Planned modules.'
    ],
    hint:'Toggle <strong>Mine</strong>, <strong>Construct</strong>, <strong>Collect</strong> · watch citizens switch tasks · colors match the task',
    showPalette: false,
    autoBuildable: false,
    // Seed a small station, a crew of citizens, an orbit of asteroids, and
    // a few planned modules to give the tasks something to act on.
    setup(){
      // Background station (pre-built)
      const m = [{gx:0,gy:0,type:'C',built:true}];
      for(let x=-2;x<=2;x++){ m.push({gx:x,gy:-2,type:'W',built:true}); m.push({gx:x,gy:2,type:'W',built:true}); }
      for(let y=-1;y<=1;y++){ m.push({gx:-2,gy:y,type:'W',built:true}); m.push({gx:2,gy:y,type:'W',built:true}); }
      // A docking port poking out
      m.push({gx:3,gy:0,type:'D',built:true});
      m.push({gx:0,gy:-3,type:'D',built:true});
      const seen = new Set();
      state.modules = m.filter(mm=>{
        const k = gKey(mm.gx,mm.gy); if(seen.has(k))return false; seen.add(k); return true;
      });
      // Citizens (3..6)
      // Scatter the crew across the right half of the canvas.
      const ncit = 5;
      state.citizens = [];
      const names = ['Astrid','Björn','Celeste','Dmitri','Elena','Finn'];
      for(let i=0;i<ncit;i++){
        const cx = (Math.random()-0.5)*W*0.6 + W*0.4;
        const cy = (Math.random()-0.5)*H*0.5 + H*0.5;
        state.citizens.push({x:cx,y:cy,vx:0,vy:0,task:'idle',target:null,name:names[i],dir:0,work:0});
      }
      // Asteroids
      // Build drifting ore rocks with a jagged random polygon outline.
      state.asteroids = [];
      for(let i=0;i<10;i++){
        const ax = W*0.65 + Math.random()*W*0.30;
        const ay = H*0.10 + Math.random()*H*0.75;
        const verts = [];
        const n = 9;
        for(let v=0;v<n;v++){
          const a = (v/n)*Math.PI*2;
          const r = 0.7 + Math.random()*0.4;
          verts.push({a,r});
        }
        state.asteroids.push({x:ax,y:ay,vx:(Math.random()-0.5)*0.15,vy:(Math.random()-0.5)*0.15,dir:Math.random()*6.28,spin:(Math.random()-0.5)*0.018,verts,r:14,ore:1});
      }
      // Planned modules to build (mining/build targets)
      // Unbuilt blueprints (built:false) are Construct targets; delivered
      // rises toward need as citizens work them.
      state.modules.push({gx:-3,gy:0,type:'W',built:false,delivered:0,need:3});
      state.modules.push({gx:-3,gy:-1,type:'W',built:false,delivered:0,need:3});
      state.modules.push({gx:0,gy:3,type:'D',built:false,delivered:0,need:5});
      // Task toggles
      // taskOn drives which tasks citizens may pick; taskCount is the HUD.
      state.taskOn = {Mine:true, Construct:true, Collect:true, Search:false, Harvest:false, Metallurgy:false, Rest:false};
      state.taskCount = {Mine:0, Construct:0, Collect:0, Search:0, Harvest:0, Metallurgy:0, Rest:0, Idle:ncit};
    },
    ref: {title:'Task Reference', body:'taskRef'}
  },
  // 6 · Tier Chain — the resource dependency graph, click to trace a node.
  {
    id:'tiers', name:'Tier Chain', icon:'◆', accent:'#58b870',
    head:'Resource <em>Tiers</em>',
    desc:'Mined ore cascades through 6 tiers into components. Click any node to highlight its full dependency tree.',
    notes:[
      'T0 ores feed T1 ingots at <code>1:7</code> ratio.',
      'T2 alloys combine ingots · T3 components combine alloys + ingots.',
      'Click a T3 node to see every raw ore it traces back to.'
    ],
    hint:'Click any node · ancestors highlight in yellow · descendants in green',
    showPalette: false,
    autoBuildable: false,
    // No world to seed; the graph is static. Just clear the selection.
    setup(){
      state.tierSel = null;
    },
    ref: {title:'Reactor Core Chain', body:'reactorChain'}
  }
];

/* ════════════════════════════════════════════════════════════════════
   TIER GRAPH DATA
   ──────────────────────────────────────────────────────────────────── */
// Every node in the crafting graph, tagged with its tier (0 raw ore up to
// 5 fuel). tier sets the row and colour when the graph is laid out.
const TIER_NODES = [
  // T0 ores
  {id:'fe', label:'Iron', tier:0},      {id:'cu', label:'Copper', tier:0},
  {id:'c',  label:'Carbon', tier:0},    {id:'al', label:'Aluminum', tier:0},
  {id:'si', label:'Silicon', tier:0},   {id:'ti', label:'Titanium', tier:0},
  {id:'au', label:'Gold', tier:0},      {id:'u',  label:'Uranium', tier:0},
  {id:'re', label:'RareEarth', tier:0},
  // T1 ingots
  {id:'fei',label:'Fe Ingot', tier:1},  {id:'cui', label:'Cu Ingot', tier:1},
  {id:'cb', label:'C Brick',  tier:1},  {id:'ali', label:'Al Ingot', tier:1},
  {id:'siw',label:'Si Wafer', tier:1},  {id:'tii', label:'Ti Ingot', tier:1},
  {id:'aui',label:'Au Ingot', tier:1},  {id:'ui',  label:'U Ingot',  tier:1},
  {id:'rei',label:'RE Ingot', tier:1},
  // T2 alloys
  {id:'stl',label:'Steel',         tier:2}, {id:'brz', label:'Bronze', tier:2},
  {id:'tia',label:'Ti Alloy',      tier:2}, {id:'cf',  label:'C Fiber', tier:2},
  {id:'gls',label:'Glass',         tier:2}, {id:'cuw', label:'Cu Wire', tier:2},
  // T3 components
  {id:'pcb',label:'Circuit',     tier:3}, {id:'cpu', label:'Processor', tier:3},
  {id:'bat',label:'Battery',     tier:3}, {id:'rct', label:'Reactor', tier:3},
  {id:'thr',label:'Thruster',    tier:3}, {id:'shd', label:'Shield', tier:3},
  // T4 food / T5 fuel
  {id:'food', label:'Food', tier:4},
  {id:'fuel', label:'Fuel', tier:5},
];

// Directed edges [source, destination]: source is an input, destination is
// the crafted output. getAncestors/getDescendants walk these to trace a
// node's full input tree or output tree.
const TIER_EDGES = [
  // T0 → T1 (smelting)
  ['fe','fei'],['cu','cui'],['c','cb'],['al','ali'],['si','siw'],['ti','tii'],['au','aui'],['u','ui'],['re','rei'],
  // T1 → T2
  ['fei','stl'],['cb','stl'],
  ['cui','brz'],['fei','brz'],
  ['tii','tia'],['ali','tia'],
  ['cb','cf'],
  ['siw','gls'],
  ['cui','cuw'],
  // T2/T1 → T3
  ['siw','pcb'],['cuw','pcb'],['gls','pcb'],
  ['siw','cpu'],['aui','cpu'],['cuw','cpu'],
  ['cui','bat'],['cb','bat'],['cuw','bat'],
  ['ui','rct'],['stl','rct'],['tia','rct'],
  ['stl','thr'],['tia','thr'],['cuw','thr'],
  ['tia','shd'],['rei','shd'],['cuw','shd'],
  // T5 fuel
  ['cb','fuel'],['ali','fuel'],['rei','fuel'],
];

// One colour per tier index, used for nodes, edges, and tier labels.
const TIER_COLORS = ['#d08050','#c8a840','#6898d0','#58b870','#78b848','#e88040'];

