// ============================================================================
//  SELECTION  ·  interactive trainer for the game's pick rules
// ----------------------------------------------------------------------------
//  A 2D canvas sandbox that teaches how click and box selection resolve when
//  entities overlap. Six scenarios each spawn a mix of entities, then the input
//  layer runs the same priority rules the game uses. A phosphor-trail render
//  loop redraws vector shapes with CRT glow every frame.
//
//  TWO PRIORITY LADDERS
//  --------------------
//  Every type has a clickPri and a boxPri (lower wins). The two ladders differ
//  on purpose: a click favours the small useful thing, a box favours the big
//  container.
//      click:  ship < enemy < planet < station < module < asteroid < star
//      box:    planet < ship < enemy < station < module < asteroid < star
//  Selection is single-category: the winning type takes the whole pick.
//
//  INPUT RESOLUTION
//  ----------------
//      pointer down ─▶ drag record ─▶ moved > 6px ? ─┬─ yes ─▶ doBox()
//                                                     └─ no  ─▶ doClick()
//      modifier (Cmd/Ctrl or MOD button) adds/removes within one category.
//
//  RENDER LOOP
//  -----------
//      render(): veil canvas (trail) ─▶ grid ─▶ drift/spin ─▶ draw back-to-front
//                ─▶ draw live drag box ─▶ requestAnimationFrame
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  ----------------------------------------------------------------------------
//      type table ......... "const TYPES"        shapes, colours, priorities
//      module library ..... "MODULE_LIB"         station sub-modules
//      scenarios .......... "const SCENARIOS"    six setups with copy
//      state .............. "const state"        selection idx, mod, zoom, drag
//      construction ....... "function make"      build one entity
//      spawn .............. "function spawn"     scatter n of a type
//      station zoom ....... "function rebuildStation" split station into modules
//      lifecycle .......... "function loadScenario"   reset and apply a scenario
//      click pick ......... "function doClick"   click priority resolution
//      box pick ........... "function doBox"     box priority resolution
//      pointer input ...... "function onDown"    mouse and touch handlers
//      readouts ........... "function updateSelReadout" HUD counts
//      rendering .......... "function render"    the per-frame draw
//      shapes ............. "function shape_ship"     vector shape drawers
//      legends ............ "function buildLegends"   priority ladders in DOM
//      boot ............... "buildScnBar()"      last block wires everything
// ============================================================================

/* ════════════════════════════════════════════════════════════════════
   ENTITY TYPES — vector-drawn, CRT-glow
   ──────────────────────────────────────────────────────────────────── */
// One record per entity type. clickPri and boxPri are the two priority ladders
// (lower wins); r is hit radius, drift/spin drive idle motion, color is the glow.
const TYPES = {
  ship:     {label:'Ship',     shape:'ship',     color:'#4ad8e0', r:13, clickPri:0, boxPri:1, drift:true,  spin:0.004},
  enemy:    {label:'Enemy',    shape:'enemy',    color:'#ff5050', r:13, clickPri:1, boxPri:2, drift:true,  spin:0.018},
  planet:   {label:'Planet',   shape:'planet',   color:'#64c864', r:32, clickPri:2, boxPri:0, drift:false, spin:0.002},
  station:  {label:'Station',  shape:'station',  color:'#ffc832', r:24, clickPri:3, boxPri:3, drift:false, spin:0},
  module:   {label:'Module',   shape:'module',   color:'#ff8844', r:10, clickPri:4, boxPri:4, drift:false, spin:0},
  asteroid: {label:'Asteroid', shape:'asteroid', color:'#c8b8a0', r:14, clickPri:5, boxPri:5, drift:true,  spin:0.020},
  star:     {label:'Star',     shape:'star',     color:'#ffe060', r:28, clickPri:9, boxPri:9, drift:false, spin:0},
};

// The sub-modules a station splits into when zoomed in (see rebuildStation).
// Each has a one-letter tag and its own accent colour.
const MODULE_LIB = [
  {sub:'foundry',   letter:'F', color:'#ff8844'},
  {sub:'assembler', letter:'A', color:'#ffc832'},
  {sub:'lab',       letter:'L', color:'#c878d8'},
  {sub:'fuel',      letter:'P', color:'#ff5050'},
  {sub:'crew',      letter:'C', color:'#4ad8e0'},
  {sub:'green',     letter:'G', color:'#64c864'},
  {sub:'medical',   letter:'M', color:'#e06080'},
  {sub:'dock',      letter:'D', color:'#4a90d0'},
];

/* ════════════════════════════════════════════════════════════════════
   SCENARIOS
   ──────────────────────────────────────────────────────────────────── */
// Each scenario is a lesson: metadata for the picker card and sidebar copy,
// plus a setup() that populates ents. enableZoom turns on the zoom controls for
// the station-decompose lesson. setup() runs against the module-level W, H, ents.
const SCENARIOS = [
  {
    id:'basics', name:'Click & Box', icon:'◎', accent:'#96c8ff',
    head:'Click & <em>Box</em>',
    desc:'Click one entity to select it. Drag a rectangle to select many at once.',
    notes:[
      'Left-click any entity to select it.',
      'Click and drag in empty space to draw a box.',
      'Click empty space to clear.'
    ],
    hint:'Click any ship · then <strong>drag a box</strong> around several asteroids',
    setup(){
      spawn('ship',   10, {region:'wide'});
      spawn('enemy',  4,  {region:'wide'});
      spawn('asteroid', 90, {region:'wide'});
      spawn('planet', 2,  {region:'wide'});
      spawn('star',   3,  {region:'corners'});
    }
  },
  {
    id:'priority', name:'Priority', icon:'◉', accent:'#64c864',
    head:'Overlap <em>Priority</em>',
    desc:'When entities sit on top of each other, the system picks the one you probably meant.',
    notes:[
      'A ship on a planet → clicking gets the <code>ship</code>.',
      'You\'d rarely want the bigger background object.',
      'Same applies to ships on stations, asteroids on planets, etc.'
    ],
    hint:'The ship is sitting <strong>on top of</strong> the planet · click it · <strong>the ship wins</strong>',
    setup(){
      // Place a ship almost on top of a planet at each pair, so a click there
      // must choose between them; click priority gives the ship.
      const pairs = [[W*0.30,H*0.40],[W*0.62,H*0.55],[W*0.45,H*0.75]];
      pairs.forEach(([px,py])=>{
        ents.push(make('planet', px, py));
        ents.push(make('ship', px-5+Math.random()*8, py-5+Math.random()*8));
      });
      ents.push(make('station', W*0.80, H*0.30));
      ents.push(make('ship', W*0.80+4, H*0.30-3));
      spawn('asteroid', 70, {region:'wide'});
      spawn('star', 2, {region:'corners'});
    }
  },
  {
    id:'clickbox', name:'Click vs Box', icon:'⊟', accent:'#ff8844',
    head:'Click <em>vs</em> Box',
    desc:'Clicking and box-dragging use different priorities. Clicking favors small useful things. Boxing favors the big important ones.',
    notes:[
      'Click in a busy area → you get a <code>ship</code>.',
      'Box over the same area → you get the <code>planet</code> instead.',
      'Boxing over a system should grab planets, not the 50 ships orbiting them.'
    ],
    hint:'<strong>Click a ship</strong> in the cluster · then <strong>box-drag</strong> over the planet · different result',
    setup(){
      const px = W*0.40, py = H*0.55;
      ents.push(make('planet', px, py));
      // Ring of ships orbiting the planet: click one and box the whole cluster
      // to show click (ship) versus box (planet) giving opposite results.
      for(let i=0;i<12;i++){
        const ang = (i/12)*Math.PI*2 + Math.random()*0.3;
        const rad = 65 + Math.random()*45;
        const s = make('ship', px+Math.cos(ang)*rad, py+Math.sin(ang)*rad);
        s.vx = -Math.sin(ang)*0.4;
        s.vy = Math.cos(ang)*0.4;
        s.dir = ang + Math.PI/2;
        ents.push(s);
      }
      ents.push(make('planet', W*0.78, H*0.30));
      spawn('asteroid', 80, {region:'wide'});
      spawn('enemy', 4, {region:'edges'});
    }
  },
  {
    id:'modifier', name:'Modifier', icon:'⌘', accent:'#ffc832',
    head:'Hold <em>Modifier</em>',
    desc:'Hold Cmd / Ctrl while clicking to add to your selection. Click an already-selected entity to remove just that one.',
    notes:[
      'Hold <code>⌘</code> or <code>Ctrl</code> + click → adds to selection.',
      'Click a selected entity (with modifier) → removes it.',
      'Mobile: tap the <strong>⌘ HOLD</strong> button to toggle modifier mode.'
    ],
    hint:'Click a ship · then <code>⌘-click</code> more · then <code>⌘-click</code> a selected one to remove it',
    setup(){
      spawn('ship', 14, {region:'wide'});
      spawn('enemy', 4, {region:'wide'});
      spawn('asteroid', 40, {region:'wide'});
    }
  },
  {
    id:'lock', name:'Category Lock', icon:'⊠', accent:'#c878d8',
    head:'Category <em>Lock</em>',
    desc:'You can never mix types in one selection. Selecting a new category replaces the old one — even with modifier held.',
    notes:[
      'Selection is always single-category.',
      'Click a different type → previous selection drops out.',
      '<code>⌘-click</code> empty space → nothing happens (safe).'
    ],
    hint:'Select some ships · then click an asteroid · <strong>the ships are released</strong>',
    setup(){
      spawn('ship', 10, {region:'left'});
      spawn('asteroid', 50, {region:'right'});
      spawn('enemy', 3, {region:'wide'});
      spawn('planet', 2, {region:'wide'});
    }
  },
  {
    id:'modules', name:'Zoom & Modules', icon:'◇', accent:'#4ad8e0',
    head:'Zoom &amp; <em>Modules</em>',
    desc:'Zoom in past the threshold and a station decomposes into its individual modules. Each one becomes clickable.',
    notes:[
      'Low zoom → station is one entity.',
      'High zoom → individual modules become clickable.',
      'Threshold has hysteresis — no flickering at the boundary.'
    ],
    hint:'Use <code>+ ZOOM</code> · station breaks into modules at high zoom · click any module',
    enableZoom:true,
    setup(){
      state.stationCenter = {x:W*0.50, y:H*0.55};
      rebuildStation();
      spawn('ship', 6, {region:'edges'});
      spawn('enemy', 2, {region:'edges'});
      spawn('asteroid', 70, {region:'wide'});
    }
  }
];

/* ════════════════════════════════════════════════════════════════════
   STATE
   ──────────────────────────────────────────────────────────────────── */
// The one mutable state bag. mod is the on-screen toggle; kbMod tracks a held
// Cmd/Ctrl; drag holds the in-progress pointer gesture; t is the frame counter.
const state = {
  scnIdx: 0, mod: false, kbMod: false,
  zoom: 1.0, zoomVisible: false,
  drag: null, stationCenter: null,
  t: 0,
};
// ents is the live entity list; W and H track the canvas size (in CSS pixels);
// dpr scales the backing store for crisp lines on high-density screens.
let ents = [];
let W=0, H=0;
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const dpr = window.devicePixelRatio||1;

/* ════════════════════════════════════════════════════════════════════
   ENTITY CONSTRUCTION
   ──────────────────────────────────────────────────────────────────── */
// Build one entity of a type at (x,y). Drifters get a random velocity; spinners
// a random angular rate. Asteroids cache a jagged vertex ring; stars a twinkle
// phase. The returned object carries its own sel flag.
function make(type, x, y){
  const t = TYPES[type];
  const e = {
    type, x, y, sel:false,
    vx: t.drift ? (Math.random()-0.5)*0.3 : 0,
    vy: t.drift ? (Math.random()-0.5)*0.3 : 0,
    dir: Math.random()*Math.PI*2,
    spin: t.spin ? (Math.random()-0.5)*2*t.spin : 0,
  };
  if(type==='asteroid'){
    const n = 8 + Math.floor(Math.random()*4);
    e.verts = [];
    for(let i=0;i<n;i++){
      const a = (i/n)*Math.PI*2;
      const r = 0.7 + Math.random()*0.4;
      e.verts.push({a,r});
    }
  }
  if(type==='star'){
    e.twinkle = Math.random()*Math.PI*2;
  }
  return e;
}

// Scatter n entities of a type into a named region, retrying placement up to 40
// times to avoid overlap (tooClose). Regions carve the canvas into zones so
// scenarios can separate groups (left/right) or push decoration to the edges.
function spawn(type, n, opts){
  opts = opts||{};
  for(let i=0;i<n;i++){
    const t = TYPES[type];
    let x, y, tries=0;
    do{
      if(opts.region==='left')        x = W*0.06 + Math.random()*W*0.32;
      else if(opts.region==='right')  x = W*0.58 + Math.random()*W*0.36;
      else if(opts.region==='edges')  x = Math.random()<0.5 ? W*0.06 + Math.random()*W*0.20 : W*0.74 + Math.random()*W*0.20;
      else if(opts.region==='corners'){const cx=Math.random()<0.5?0.10:0.85; x = W*cx + Math.random()*W*0.05;}
      else                            x = W*0.05 + Math.random()*W*0.90;
      if(opts.region==='corners')     y = (Math.random()<0.5?0.12:0.82)*H + Math.random()*H*0.06;
      else                            y = H*0.15 + Math.random()*H*0.72;
      tries++;
    } while(tooClose(x,y,type==='asteroid'?t.r-2:t.r+8,type) && tries<40);
    ents.push(make(type, x, y));
  }
}

// True if (x,y) sits within r plus the other entity's radius of any existing
// entity. Asteroid-on-asteroid packs tighter so fields look dense, not sparse.
function tooClose(x,y,r,fromType){
  return ents.some(e=>{
    const tr = TYPES[e.type].r;
    // Asteroid-vs-asteroid allow tighter packing (just don't visually overlap)
    if(fromType==='asteroid' && e.type==='asteroid') return Math.hypot(e.x-x, e.y-y) < r+tr-6;
    return Math.hypot(e.x-x, e.y-y) < r+tr;
  });
}

// Swap the station for its modules (or back) based on zoom. Above the threshold
// the station decomposes into MODULE_LIB laid out in a grid; below it, one
// station glyph scaled by zoom. Removes the old station/module ents first.
function rebuildStation(){
  if(!state.stationCenter) return;
  ents = ents.filter(e => e.type!=='station' && e.type!=='module');
  const c = state.stationCenter;
  const z = state.zoom;
  // Hysteresis: it takes z>=2.2 to expand, but only z<1.6 to collapse, so the
  // view does not flicker between station and modules right at the boundary.
  const wasVisible = state.zoomVisible;
  state.zoomVisible = wasVisible ? z>=1.6 : z>=2.2;
  if(state.zoomVisible){
    const sp = 22 * z * 0.55;
    MODULE_LIB.forEach((m,i)=>{
      const col = i%4, row = (i/4)|0;
      const e = make('module', c.x + (col-1.5)*sp, c.y + (row-0.5)*sp);
      e.subType = m.sub;
      e.subLetter = m.letter;
      e.subColor = m.color;
      ents.push(e);
    });
  } else {
    const e = make('station', c.x, c.y);
    e.scale = Math.max(0.7, z*0.85);
    ents.push(e);
  }
}

/* ════════════════════════════════════════════════════════════════════
   SCENARIO LIFECYCLE
   ──────────────────────────────────────────────────────────────────── */
// Reset to scenario i: clear state and ents, run its setup(), then push all its
// copy (headline, description, notes, hint) into the DOM and toggle the zoom
// controls. This is the single entry point for both first load and Reset.
function loadScenario(i){
  state.scnIdx = i;
  state.drag = null;
  state.zoom = 1.0;
  state.zoomVisible = false;
  ents = [];
  const s = SCENARIOS[i];
  s.setup();
  document.getElementById('hud-scn').textContent = String(i+1).padStart(2,'0')+'/'+String(SCENARIOS.length).padStart(2,'0');
  document.querySelectorAll('.scn-card').forEach((b,k)=>b.classList.toggle('active',k===i));
  const hint = document.getElementById('hint');
  hint.innerHTML = s.hint;
  hint.style.setProperty('--ac', s.accent);
  document.getElementById('scnHead').innerHTML = s.head;
  document.getElementById('scnHead').style.setProperty('--ac', s.accent);
  document.getElementById('scnDesc').textContent = s.desc;
  const notes = document.getElementById('scnNotes');
  notes.innerHTML = '';
  notes.style.setProperty('--ac', s.accent);
  s.notes.forEach(n=>{ const li=document.createElement('li'); li.innerHTML=n; notes.appendChild(li); });
  document.getElementById('sel').style.setProperty('--ac', s.accent);
  const showZoom = !!s.enableZoom;
  document.getElementById('zoomIn').style.display = showZoom?'':'none';
  document.getElementById('zoomOut').style.display = showZoom?'':'none';
  updateSelReadout();
}

// Reset button and the R key both re-run the current scenario from scratch.
function resetScenario(){ loadScenario(state.scnIdx); }

// Step zoom in or out (clamped), then rebuild the station at the new level.
function adjustZoom(dir){
  state.zoom = Math.max(0.5, Math.min(3.2, state.zoom + dir*0.4));
  rebuildStation();
  flash('Zoom: '+state.zoom.toFixed(1)+'×', 'info');
}

/* ════════════════════════════════════════════════════════════════════
   SELECTION LOGIC
   ──────────────────────────────────────────────────────────────────── */
// Modifier is on if the screen toggle is set or the event carries Ctrl/Cmd.
function modActive(e){ return state.mod || (e && (e.ctrlKey||e.metaKey)); }

// Every entity whose circle (radius plus 5px slop) contains the point.
function hitTest(mx,my){
  return ents.filter(en=>{
    const t = TYPES[en.type];
    const r = t.r * (en.scale||1) + 5;
    return Math.hypot(en.x-mx, en.y-my) <= r;
  });
}

// True if the entity's bounding box intersects the drag rectangle.
function boxOverlap(en, x1, y1, x2, y2){
  const t = TYPES[en.type];
  const r = t.r * (en.scale||1);
  return en.x+r>x1 && en.x-r<x2 && en.y+r>y1 && en.y-r<y2;
}

// Resolve a click. With no hit, clear (or preserve, under modifier). Otherwise
// the lowest clickPri among the hits wins. Under modifier the click toggles the
// pick within a category, but switching categories replaces (category lock).
function doClick(mx, my, mod){
  const hits = hitTest(mx, my);
  if(!hits.length){
    if(!mod){
      const had = ents.some(e=>e.sel);
      ents.forEach(e=>e.sel=false);
      if(had) flash('Selection cleared');
    } else { flash('Selection preserved', 'info'); }
    return;
  }
  // Lowest clickPri is the intended target when several overlap.
  hits.sort((a,b)=>TYPES[a.type].clickPri - TYPES[b.type].clickPri);
  const pick = hits[0];
  if(mod){
    const cur = ents.find(e=>e.sel);
    if(cur && cur.type !== pick.type){
      ents.forEach(e=>e.sel=false);
      pick.sel = true;
      flash('Category lock — switched to '+TYPES[pick.type].label,'info');
    } else { pick.sel = !pick.sel; }
  } else {
    ents.forEach(e=>e.sel=false);
    pick.sel = true;
  }
}

// Resolve a box drag. Of everything inside, the lowest boxPri type wins and all
// entities of that one type are taken. Modifier and category lock work as in
// doClick. Box priority favours big containers, so a drag over a system grabs
// the planet, not the ships around it.
function doBox(x1,y1,x2,y2,mod){
  const inside = ents.filter(en=>boxOverlap(en,x1,y1,x2,y2));
  if(!inside.length){
    if(!mod){ const had=ents.some(e=>e.sel); ents.forEach(e=>e.sel=false); if(had) flash('Selection cleared'); }
    else flash('Selection preserved', 'info');
    return;
  }
  // Winning type is the lowest boxPri present; take every entity of that type.
  inside.sort((a,b)=>TYPES[a.type].boxPri - TYPES[b.type].boxPri);
  const bestType = inside[0].type;
  const winners = inside.filter(e=>e.type===bestType);
  if(mod){
    const cur = ents.find(e=>e.sel);
    if(cur && cur.type !== bestType){
      ents.forEach(e=>e.sel=false);
      winners.forEach(e=>e.sel=true);
      flash('Category lock — switched to '+TYPES[bestType].label,'info');
    } else { winners.forEach(e=>e.sel=true); }
  } else {
    ents.forEach(e=>e.sel=false);
    winners.forEach(e=>e.sel=true);
  }
}

/* ════════════════════════════════════════════════════════════════════
   INPUT
   ──────────────────────────────────────────────────────────────────── */
// Pointer position in canvas space, for either a mouse or the first touch.
function getPt(e){
  const r = cv.getBoundingClientRect();
  if(e.touches && e.touches.length){
    return {x:e.touches[0].clientX-r.left, y:e.touches[0].clientY-r.top};
  }
  return {x:e.clientX-r.left, y:e.clientY-r.top};
}

// Pointer down starts a drag record. It captures the modifier now so a key
// released mid-drag does not change the gesture. active stays false until moved.
function onDown(e){
  e.preventDefault();
  const p = getPt(e);
  state.drag = {sx:p.x, sy:p.y, cx:p.x, cy:p.y, active:false, mod:modActive(e)};
}
// Track the current point; promote to a box drag once it moves past 6px.
function onMove(e){
  if(!state.drag) return;
  e.preventDefault();
  const p = getPt(e);
  state.drag.cx = p.x; state.drag.cy = p.y;
  if(Math.hypot(p.x-state.drag.sx, p.y-state.drag.sy) > 6) state.drag.active = true;
}
// Pointer up commits the gesture: a moved drag runs doBox over the normalised
// rectangle, a still one runs doClick at the start point. Then refresh readouts.
function onUp(e){
  if(!state.drag) return;
  e.preventDefault();
  let endX=state.drag.cx, endY=state.drag.cy;
  if(e.changedTouches && e.changedTouches[0]){
    const r = cv.getBoundingClientRect();
    endX = e.changedTouches[0].clientX-r.left;
    endY = e.changedTouches[0].clientY-r.top;
  }
  const mod = state.drag.mod || modActive(e);
  if(state.drag.active){
    const x1=Math.min(state.drag.sx, endX), x2=Math.max(state.drag.sx, endX);
    const y1=Math.min(state.drag.sy, endY), y2=Math.max(state.drag.sy, endY);
    doBox(x1,y1,x2,y2,mod);
  } else {
    doClick(state.drag.sx, state.drag.sy, mod);
  }
  state.drag = null;
  updateSelReadout();
}

// Bind the same three handlers to both mouse and touch; touch is non-passive so
// preventDefault can stop the page scrolling under a drag.
cv.addEventListener('mousedown', onDown);
cv.addEventListener('mousemove', onMove);
cv.addEventListener('mouseup', onUp);
cv.addEventListener('mouseleave', ()=>{ state.drag = null; });
cv.addEventListener('touchstart', onDown, {passive:false});
cv.addEventListener('touchmove', onMove, {passive:false});
cv.addEventListener('touchend', onUp, {passive:false});

// Keyboard: track the held Cmd/Ctrl for the MOD readout, and R resets.
window.addEventListener('keydown', e=>{
  if(e.key==='Control'||e.key==='Meta'){
    state.kbMod = true;
    document.getElementById('hud-mod').textContent = state.mod||state.kbMod ? 'ON' : 'OFF';
  }
  if(e.key==='r'||e.key==='R'){ resetScenario(); }
});
window.addEventListener('keyup', e=>{
  if(e.key==='Control'||e.key==='Meta'){
    state.kbMod = false;
    document.getElementById('hud-mod').textContent = state.mod||state.kbMod ? 'ON' : 'OFF';
  }
});

// The on-screen MOD button toggles persistent modifier mode for touch users.
function toggleMod(){
  state.mod = !state.mod;
  document.getElementById('modBtn').classList.toggle('active', state.mod);
  document.getElementById('hud-mod').textContent = state.mod||state.kbMod ? 'ON' : 'OFF';
}

/* ════════════════════════════════════════════════════════════════════
   READOUTS
   ──────────────────────────────────────────────────────────────────── */
// Refresh the HUD: selected count, total entity count, and the selection bar
// (which names the single category, since selection is always one type).
function updateSelReadout(){
  const sel = ents.filter(e=>e.sel);
  document.getElementById('hud-sel').textContent = sel.length;
  document.getElementById('hud-ents').textContent = ents.length;
  const bar = document.getElementById('sel');
  if(!sel.length){
    bar.textContent = 'Nothing selected';
    bar.classList.remove('has-sel');
  } else {
    const t = TYPES[sel[0].type];
    bar.classList.add('has-sel');
    bar.innerHTML = '<strong style="color:'+t.color+'">'+sel.length+'</strong> '+t.label+(sel.length>1?'s':'')+' selected';
  }
}

// Show a transient toast (cleared/preserved/category-lock messages), auto-hiding
// after 1.6s. kind adds a colour class.
let toastTimer;
function flash(msg, kind){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (kind?(' '+kind):'');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), 1600);
}

/* ════════════════════════════════════════════════════════════════════
   RENDERING — CRT glow vectors
   ──────────────────────────────────────────────────────────────────── */
// Match the canvas backing store to the canvas-area box and dpr, then set the
// transform so all drawing code works in CSS pixels. Called every frame.
function resize(){
  const r = document.querySelector('.canvas-area').getBoundingClientRect();
  W = r.width; H = r.height;
  cv.width = W*dpr; cv.height = H*dpr;
  cv.style.width = W+'px'; cv.style.height = H+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);
}

// Faint background grid at a fixed 50px pitch.
function drawGrid(){
  ctx.strokeStyle = 'rgba(80,130,200,0.045)';
  ctx.lineWidth = 1;
  const g = 50;
  for(let x=0;x<W;x+=g){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for(let y=0;y<H;y+=g){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
}

// Set the stroke and shadow for the CRT glow; a selected entity glows brighter.
function glow(color, sel, baseBlur){
  ctx.shadowBlur = sel ? baseBlur*1.8 : baseBlur;
  ctx.shadowColor = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = sel ? 2 : 1.4;
}

// Dashed ring around a selected entity.
function drawSelHalo(x,y,r,color){
  ctx.save();
  ctx.shadowBlur = 14; ctx.shadowColor = color;
  ctx.strokeStyle = color; ctx.lineWidth = 1;
  ctx.setLineDash([5,4]);
  ctx.beginPath(); ctx.arc(x,y,r+9,0,Math.PI*2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// Vector shape drawers. Each draws one entity in local space centred at the
// origin (drawEntity has already translated and rotated), radius r, using the
// current stroke set by glow(). Kept as plain outlines so the glow reads clean.
function shape_ship(r){
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(-r*0.8, -r*0.75);
  ctx.lineTo(-r*0.45, 0);
  ctx.lineTo(-r*0.8, r*0.75);
  ctx.closePath();
  ctx.stroke();
}

function shape_enemy(r){
  ctx.beginPath();
  ctx.moveTo(r*1.05, 0);
  ctx.lineTo(0, -r*0.6);
  ctx.lineTo(-r*1.05, 0);
  ctx.lineTo(0, r*0.6);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-r*0.5, 0); ctx.lineTo(r*0.5, 0);
  ctx.stroke();
}

function shape_planet(r){
  ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-r,0); ctx.lineTo(r,0); ctx.stroke();
  for(let i=1;i<3;i++){
    const y = (i/3)*r;
    const xs = Math.sqrt(r*r - y*y);
    ctx.beginPath(); ctx.moveTo(-xs,y); ctx.lineTo(xs,y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-xs,-y); ctx.lineTo(xs,-y); ctx.stroke();
  }
}

function shape_station(r){
  ctx.beginPath();
  for(let i=0;i<6;i++){
    const a = (i/6)*Math.PI*2;
    const x = Math.cos(a)*r, y = Math.sin(a)*r;
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.closePath(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0,-r*0.7); ctx.lineTo(0,r*0.7);
  ctx.moveTo(-r*0.7,0); ctx.lineTo(r*0.7,0);
  ctx.stroke();
  ctx.strokeRect(-r*0.42,-r*0.42,r*0.84,r*0.84);
}

function shape_asteroid(verts, r){
  ctx.beginPath();
  verts.forEach((v,i)=>{
    const x = Math.cos(v.a)*v.r*r;
    const y = Math.sin(v.a)*v.r*r;
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.closePath(); ctx.stroke();
}

// Star pulses over time via its twinkle phase and the global frame counter.
function shape_star(r, twinkle){
  const pulse = 0.85 + 0.15*Math.sin(twinkle + state.t*0.06);
  ctx.beginPath(); ctx.arc(0,0,r*0.32*pulse,0,Math.PI*2); ctx.stroke();
  const spikes = 12;
  for(let i=0;i<spikes;i++){
    const a = (i/spikes)*Math.PI*2;
    const inner = r * 0.48;
    const outer = r * (i%2 ? 0.78 : 1.0) * pulse;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a)*inner, Math.sin(a)*inner);
    ctx.lineTo(Math.cos(a)*outer, Math.sin(a)*outer);
    ctx.stroke();
  }
}

// Module is a lettered box; the label is drawn without glow so it stays legible.
function shape_module(r, letter, color){
  ctx.strokeRect(-r,-r,r*2,r*2);
  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.font = 'bold 11px JetBrains Mono';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(letter, 0, 0.5);
}

// Draw one entity: optional halo, then translate/rotate into its frame, set the
// glow, and dispatch to the shape drawer for its type.
function drawEntity(e){
  const t = TYPES[e.type];
  const r = t.r * (e.scale||1);
  const color = e.subColor || t.color;

  if(e.sel) drawSelHalo(e.x, e.y, r, color);

  ctx.save();
  ctx.translate(e.x, e.y);
  if(e.type==='ship'||e.type==='enemy'||e.type==='asteroid'||e.type==='planet'){
    ctx.rotate(e.dir);
  }
  glow(color, e.sel, t.shape==='star' ? 18 : t.shape==='planet' ? 16 : t.shape==='asteroid' ? 6 : 11);

  switch(t.shape){
    case 'ship':     shape_ship(r); break;
    case 'enemy':    shape_enemy(r); break;
    case 'planet':   shape_planet(r); break;
    case 'station':  shape_station(r); break;
    case 'asteroid': shape_asteroid(e.verts, r); break;
    case 'star':     shape_star(r, e.twinkle||0); break;
    case 'module':   shape_module(r, e.subLetter||'M', color); break;
  }
  ctx.restore();
}

// Draw the live drag rectangle and preview-ring the entities it would select,
// running the same boxPri resolution as doBox so the preview matches the result.
function drawDrag(){
  if(!state.drag || !state.drag.active) return;
  const x1=Math.min(state.drag.sx, state.drag.cx);
  const y1=Math.min(state.drag.sy, state.drag.cy);
  const x2=Math.max(state.drag.sx, state.drag.cx);
  const y2=Math.max(state.drag.sy, state.drag.cy);
  ctx.fillStyle = 'rgba(150,200,255,0.05)';
  ctx.fillRect(x1,y1,x2-x1,y2-y1);
  ctx.save();
  ctx.shadowBlur = 8;
  ctx.shadowColor = 'rgba(150,200,255,0.5)';
  ctx.strokeStyle = 'rgba(150,200,255,0.65)';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([6,4]);
  ctx.strokeRect(x1,y1,x2-x1,y2-y1);
  ctx.setLineDash([]);
  ctx.restore();

  const inside = ents.filter(en=>boxOverlap(en,x1,y1,x2,y2));
  if(inside.length){
    inside.sort((a,b)=>TYPES[a.type].boxPri-TYPES[b.type].boxPri);
    const bestType = inside[0].type;
    inside.filter(e=>e.type===bestType).forEach(e=>{
      const t = TYPES[e.type];
      const r = t.r*(e.scale||1);
      ctx.save();
      ctx.shadowBlur = 10; ctx.shadowColor = t.color;
      ctx.strokeStyle = t.color; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(e.x, e.y, r+6, 0, Math.PI*2); ctx.stroke();
      ctx.restore();
    });
  }
}

// The frame loop: resize, lay a translucent veil for the phosphor trail, draw
// the grid, advance drift and spin, draw entities back-to-front (largest first),
// overlay the drag box, and schedule the next frame.
function render(){
  resize();
  state.t += 1;

  // Phosphor trail: a translucent fill each frame fades old frames instead of a
  // hard clear, leaving motion trails behind moving entities.
  ctx.fillStyle = 'rgba(7,10,16,0.32)';
  ctx.fillRect(0,0,W,H);

  drawGrid();

  ents.forEach(e=>{
    const t = TYPES[e.type];
    if(t.drift){
      e.x += e.vx; e.y += e.vy;
      // Bounce off the padded edges so drifters stay on screen.
      const pad = 30;
      if(e.x<pad){ e.x=pad; e.vx*=-1; }
      if(e.x>W-pad){ e.x=W-pad; e.vx*=-1; }
      if(e.y<pad){ e.y=pad; e.vy*=-1; }
      if(e.y>H-pad){ e.y=H-pad; e.vy*=-1; }
    }
    if(t.spin) e.dir += e.spin;
  });

  // Draw largest radius first so small entities land on top and stay clickable.
  const sorted = ents.slice().sort((a,b)=>TYPES[b.type].r - TYPES[a.type].r);
  sorted.forEach(drawEntity);

  drawDrag();
  requestAnimationFrame(render);
}

/* ════════════════════════════════════════════════════════════════════
   SIDEBAR LEGEND
   ──────────────────────────────────────────────────────────────────── */
// Render a small standalone canvas icon of a type for the sidebar legend rows.
// It mirrors the main shapes at pip scale; the shapes are inlined here rather
// than reused because the pip sizes and simplifications differ from the field.
function drawLegendPip(type){
  const c = document.createElement('canvas');
  const s = 22;
  c.width = s*dpr; c.height = s*dpr;
  c.style.width = s+'px'; c.style.height = s+'px';
  const lc = c.getContext('2d');
  lc.setTransform(dpr,0,0,dpr,0,0);
  const T = TYPES[type];
  const r = 8;
  lc.translate(s/2, s/2);
  lc.shadowBlur = 6;
  lc.shadowColor = T.color;
  lc.strokeStyle = T.color;
  lc.lineWidth = 1.4;
  lc.fillStyle = T.color;
  switch(T.shape){
    case 'ship':
      lc.beginPath();
      lc.moveTo(r, 0);
      lc.lineTo(-r*0.8, -r*0.75);
      lc.lineTo(-r*0.45, 0);
      lc.lineTo(-r*0.8, r*0.75);
      lc.closePath(); lc.stroke(); break;
    case 'enemy':
      lc.beginPath();
      lc.moveTo(r,0); lc.lineTo(0,-r*0.6); lc.lineTo(-r,0); lc.lineTo(0,r*0.6); lc.closePath(); lc.stroke();
      break;
    case 'planet':
      lc.beginPath(); lc.arc(0,0,r*0.85,0,Math.PI*2); lc.stroke();
      lc.beginPath(); lc.moveTo(-r*0.85,0); lc.lineTo(r*0.85,0); lc.stroke();
      break;
    case 'station':
      lc.beginPath();
      for(let i=0;i<6;i++){
        const a=(i/6)*Math.PI*2;
        const x=Math.cos(a)*r*0.85, y=Math.sin(a)*r*0.85;
        if(i===0) lc.moveTo(x,y); else lc.lineTo(x,y);
      }
      lc.closePath(); lc.stroke();
      lc.strokeRect(-r*0.35,-r*0.35,r*0.7,r*0.7);
      break;
    case 'module':
      lc.strokeRect(-r*0.7,-r*0.7,r*1.4,r*1.4);
      lc.shadowBlur=0; lc.font='bold 9px JetBrains Mono';
      lc.textAlign='center'; lc.textBaseline='middle'; lc.fillText('F',0,0.5);
      break;
    case 'asteroid':
      lc.beginPath();
      const verts = 9;
      for(let i=0;i<verts;i++){
        const a=(i/verts)*Math.PI*2;
        const rr = r*(0.75 + (i%3===0?0.25:i%2===0?0.10:0.0));
        const x=Math.cos(a)*rr, y=Math.sin(a)*rr;
        if(i===0) lc.moveTo(x,y); else lc.lineTo(x,y);
      }
      lc.closePath(); lc.stroke();
      break;
    case 'star':
      lc.beginPath(); lc.arc(0,0,r*0.28,0,Math.PI*2); lc.stroke();
      for(let i=0;i<8;i++){
        const a=(i/8)*Math.PI*2;
        lc.beginPath();
        lc.moveTo(Math.cos(a)*r*0.45, Math.sin(a)*r*0.45);
        lc.lineTo(Math.cos(a)*r*0.85, Math.sin(a)*r*0.85);
        lc.stroke();
      }
      break;
  }
  return c;
}

// Build both sidebar priority ladders: one ordered by clickPri, one by boxPri,
// each row a pip, a name, and its rank. The two orders visualise the difference.
function buildLegends(){
  const types = Object.keys(TYPES);
  const legendC = types.slice().sort((a,b)=>TYPES[a].clickPri-TYPES[b].clickPri);
  const legendB = types.slice().sort((a,b)=>TYPES[a].boxPri-TYPES[b].boxPri);
  function row(t, pri){
    const T = TYPES[t];
    const div = document.createElement('div');
    div.className = 'legend-row';
    const pip = document.createElement('span');
    pip.className = 'lpip';
    pip.appendChild(drawLegendPip(t));
    div.appendChild(pip);
    const name = document.createElement('span');
    name.textContent = T.label;
    div.appendChild(name);
    const pri_el = document.createElement('span');
    pri_el.className = 'lpri';
    pri_el.textContent = '#'+pri;
    div.appendChild(pri_el);
    return div;
  }
  const lc = document.getElementById('legendC');
  const lb = document.getElementById('legendB');
  lc.innerHTML = ''; lb.innerHTML = '';
  legendC.forEach((t,i)=>lc.appendChild(row(t,i+1)));
  legendB.forEach((t,i)=>lb.appendChild(row(t,i+1)));
}

// Build the top scenario picker: one card per SCENARIOS entry, calling
// loadScenario on click.
function buildScnBar(){
  const bar = document.getElementById('scnBar');
  bar.innerHTML = SCENARIOS.map((s,i)=>(
    '<button class="scn-card" data-idx="'+i+'" style="--ac:'+s.accent+'" onclick="loadScenario('+i+')">'+
      '<span class="scn-ico">'+s.icon+'</span>'+
      '<span class="scn-meta">'+
        '<span class="scn-num">'+String(i+1).padStart(2,'0')+'</span>'+
        '<span class="scn-name">'+s.name+'</span>'+
      '</span>'+
    '</button>'
  )).join('');
}

/* ════════════════════════════════════════════════════════════════════
   MOBILE DRAWER
   ──────────────────────────────────────────────────────────────────── */
// Mobile: the FAB slides the right sidebar in over a backdrop.
function toggleDrawer(){
  const panel = document.getElementById('sideR');
  const fab = document.getElementById('fab');
  const bd = document.getElementById('bd');
  const willOpen = !panel.classList.contains('open');
  panel.classList.toggle('open', willOpen);
  fab.classList.toggle('open', willOpen);
  bd.classList.toggle('show', willOpen);
}
function closeDrawer(){
  document.getElementById('sideR').classList.remove('open');
  document.getElementById('fab').classList.remove('open');
  document.getElementById('bd').classList.remove('show');
}

/* ════════════════════════════════════════════════════════════════════
   BOOT
   ──────────────────────────────────────────────────────────────────── */
// Boot: build the static UI, size the canvas, load the first scenario, and start
// the render loop.
buildScnBar();
resize();
buildLegends();
window.addEventListener('resize', ()=>{ resize(); });
loadScenario(0);
render();

// In-frame guard: hide this page's own chrome when embedded in the site shell.
try{ if(window.self!==window.top) document.body.classList.add('in-frame'); }catch(e){ document.body.classList.add('in-frame'); }
