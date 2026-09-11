/* ════════════════════════════════════════════════════════════════════
   SCENARIO LIFECYCLE
   ──────────────────────────────────────────────────────────────────── */
// Switch to scenario i: wipe all world state, recentre the grid, run the
// scenario's setup(), then rebuild every panel, overlay, and control the
// lesson uses. This is the single entry point for both card clicks and
// RESET.
function loadScenario(i){
  state.scnIdx = i;
  // Clear every world field so no data leaks between lessons.
  state.modules = [];
  state.enclosed = new Set();
  state.particles = [];
  state.resources = {};
  state.foundry = null;
  state.foundryWorker = null;
  state.flowParticles = [];
  state.citizens = [];
  state.asteroids = [];
  state.taskOn = {};
  state.tierSel = null;
  state.autoBuild = false;
  state.hover = null;
  centerGrid();

  // Seed the lesson, then compute enclosure from the seeded modules.
  const s = SCENARIOS[i];
  s.setup();
  state.enclosed = computeEnclosed();

  // HUD scenario counter and active card highlight.
  document.getElementById('hud-scn').textContent = String(i+1).padStart(2,'0')+'/'+String(SCENARIOS.length).padStart(2,'0');
  document.querySelectorAll('.scn-card').forEach((b,k)=>b.classList.toggle('active',k===i));

  // Fill the hint bar and side panel text from the scenario config.
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

  // Show / hide overlays
  document.getElementById('palette').style.display = s.showPalette ? '' : 'none';
  document.getElementById('taskBox').style.display = (s.id==='crew') ? '' : 'none';
  document.getElementById('rotBtn').style.display = (s.id==='foundry') ? '' : 'none';
  document.getElementById('autoBtn').style.display = s.autoBuildable ? '' : 'none';
  document.getElementById('autoBtn').classList.toggle('active', false);

  // Build the overlays the shown controls need.
  if(s.showPalette) buildPalette();
  if(s.id==='crew') buildTaskBox();

  // Reference panel
  document.getElementById('refTitle').firstChild ? null : null;
  const rt = document.getElementById('refTitle');
  // refTitle has a ::before pseudo; we only need to set text:
  rt.childNodes[0] ? null : null;
  // Just rebuild
  rt.innerHTML = s.ref.title;
  rt.style.setProperty('--ac', s.accent);
  // Re-add the pip via CSS pseudo (it already exists)
  // Inject body
  document.getElementById('refBody').innerHTML = refContent(s.ref.body);

  updateHud();
}
// RESET reloads the current scenario from scratch.
function resetScenario(){ loadScenario(state.scnIdx); }

// Build the module palette bar for placement-style scenarios: one button
// per selectable type, wired to selPalette.
function buildPalette(){
  const p = document.getElementById('palette');
  const types = ['W','V','Q','D','G','M','F','A','L','S'];
  p.innerHTML = '<div class="palette-title">PALETTE</div>' + types.map(k=>{
    const m = MOD[k];
    return '<button class="pal-btn" data-k="'+k+'" style="--pc:'+m.color+'" onclick="selPalette(\''+k+'\')">'+
      '<span class="pal-glyph">'+k+'</span>'+
      '<span>'+m.name+'</span>'+
      '<span class="pal-tag">'+m.tag+'</span>'+
    '</button>';
  }).join('');
  // Defer the active highlight until after innerHTML lands the buttons.
  setTimeout(()=>{
    document.querySelectorAll('.pal-btn').forEach(b=>b.classList.toggle('active', b.dataset.k===state.paletteSel));
  },0);
}
// Select a palette module type and repaint the active button.
function selPalette(k){
  state.paletteSel = k;
  document.querySelectorAll('.pal-btn').forEach(b=>b.classList.toggle('active', b.dataset.k===k));
}
// Toggle auto-build: placed modules arrive as blueprints and fill in over
// time instead of appearing built.
function toggleAuto(){
  state.autoBuild = !state.autoBuild;
  document.getElementById('autoBtn').classList.toggle('active', state.autoBuild);
}

// Build the crew task toggle box: one row per task, wired to toggleTask.
function buildTaskBox(){
  const box = document.getElementById('taskBox');
  const tasks = [
    {n:'Mine',       c:'#be8232'},
    {n:'Construct',  c:'#c8a01e'},
    {n:'Collect',    c:'#2878c8'},
    {n:'Search',     c:'#8c5ac8'},
    {n:'Harvest',    c:'#3ca032'},
    {n:'Metallurgy', c:'#b45028'},
    {n:'Rest',       c:'#6878a0'},
  ];
  box.innerHTML = '<div class="tasks-title">TASKS</div>' + tasks.map(t=>(
    '<div class="task-row '+(state.taskOn[t.n]?'on':'')+'" data-task="'+t.n+'" style="--tc:'+t.c+'" onclick="toggleTask(\''+t.n+'\')">'+
      '<span class="task-pip"></span>'+
      '<span class="task-name">'+t.n+'</span>'+
      '<span class="task-count" id="tcnt-'+t.n+'">'+(state.taskCount[t.n]||0)+'</span>'+
    '</div>'
  )).join('');
}
// Flip a task on or off; citizens re-prioritise on the next frame.
function toggleTask(name){
  state.taskOn[name] = !state.taskOn[name];
  const row = document.querySelector('.task-row[data-task="'+name+'"]');
  if(row) row.classList.toggle('on', !!state.taskOn[name]);
}

// Rotate the foundry output one quarter turn. Changing the output side
// invalidates any docked worker, so release the claim and send it away
// (mirrors release_foundry_claim in the engine).
function rotateFoundry(){
  if(!state.foundry) return;
  state.foundry.dir = (state.foundry.dir + 1) % 4;
  // Output direction changed → release any active claim (matches release_foundry_claim)
  state.foundry.claimed = false;
  state.foundry.progress = null;
  if(state.foundryWorker && state.foundryWorker.state === 'processing'){
    state.foundryWorker.state = 'departing';
    state.foundryWorker.workDone = 0;
    state.foundryWorker.workNeeded = 0;
  }
  flash('Foundry output: ' + ['EAST','SOUTH','WEST','NORTH'][state.foundry.dir],'info');
}

/* ════════════════════════════════════════════════════════════════════
   INPUT
   ──────────────────────────────────────────────────────────────────── */
// Canvas-local pointer coordinate for a mouse or touch event. Reads
// touches / changedTouches first so both drag and tap-end resolve.
function getPt(e){
  const r = cv.getBoundingClientRect();
  if(e.touches && e.touches.length){
    return {x:e.touches[0].clientX-r.left, y:e.touches[0].clientY-r.top};
  }
  if(e.changedTouches && e.changedTouches[0]){
    return {x:e.changedTouches[0].clientX-r.left, y:e.changedTouches[0].clientY-r.top};
  }
  return {x:e.clientX-r.left, y:e.clientY-r.top};
}

// Route one tap to the active scenario's handler. Crew handles input
// through DOM toggles, so it takes no canvas tap.
function onTap(p){
  const s = SCENARIOS[state.scnIdx];
  if(s.id==='placement') return handlePlacement(p);
  if(s.id==='enclosure') return handleEnclosure(p);
  if(s.id==='decompress') return handleDecompress(p);
  if(s.id==='foundry') return handleFoundry(p);
  if(s.id==='crew') return; // tasks handled in DOM
  if(s.id==='tiers') return handleTiers(p);
}

// Placement scenario tap: click a module to remove it, click an empty
// valid cell to place the selected type. Placed processing modules auto-
// orient to a valid output direction.
function handlePlacement(p){
  const {gx,gy} = screenToGrid(p.x, p.y);
  // Tapping an existing module removes it (the core is protected).
  const existing = moduleAt(gx,gy);
  if(existing){
    if(existing.type==='C'){ flash('Cannot remove the Core'); return; }
    state.modules = state.modules.filter(m=>!(m.gx===gx && m.gy===gy));
    state.enclosed = computeEnclosed();
    updateHud();
    return;
  }
  // Otherwise validate and place; built depends on the auto-build toggle.
  const v = validatePlacement(gx,gy,state.paletteSel);
  if(!v.ok){ flash('Invalid: '+v.reason); return; }
  state.modules.push({gx,gy,type:state.paletteSel,built:!state.autoBuild,delivered:0,need:MOD[state.paletteSel].work});
  state.enclosed = computeEnclosed();
  // Auto-orient processing modules (matches crew.rs DIRECTION_PREFERENCE S>E>N>W)
  const placed = moduleAt(gx,gy);
  if(placed && ['F','P','A','L'].includes(placed.type) && placed.built){
    const orient = autoOrientFoundry(gx,gy);
    if(orient !== null){
      placed.outputDir = orient;
      if(placed.type==='F') state.foundry = {gx, gy, dir:orient};
      flash('Auto-oriented '+MOD[placed.type].name+' → '+['EAST','SOUTH','WEST','NORTH'][orient],'info');
    } else {
      flash('Warning: '+MOD[placed.type].name+' has no valid I/O direction');
    }
  }
  updateHud();
}

// Enclosure scenario tap: same place/remove flow as placement, but when a
// placement newly seals cells, fill them with random resources and report.
function handleEnclosure(p){
  const {gx,gy} = screenToGrid(p.x, p.y);
  const existing = moduleAt(gx,gy);
  if(existing){
    if(existing.type==='C') return;
    state.modules = state.modules.filter(m=>!(m.gx===gx && m.gy===gy));
    state.enclosed = computeEnclosed();
    updateHud();
    return;
  }
  const v = validatePlacement(gx,gy,state.paletteSel);
  if(!v.ok){ flash('Invalid: '+v.reason); return; }
  state.modules.push({gx,gy,type:state.paletteSel,built:!state.autoBuild,delivered:0,need:MOD[state.paletteSel].work});
  // Compare enclosure size before and after to detect newly sealed cells.
  const prev = state.enclosed.size;
  state.enclosed = computeEnclosed();
  if(state.enclosed.size > prev){
    // Newly enclosed cells get random resources
    const labels = ['Fe','Cu','Al','C'];
    const cols   = ['#d08050','#d8a050','#c8c8d8','#8a8a8a'];
    for(const k of state.enclosed){
      if(!state.resources[k]){
        const idx = Math.floor(Math.random()*labels.length);
        state.resources[k] = [{label:labels[idx], color:cols[idx], count:10+Math.floor(Math.random()*40)}];
      }
    }
    flash('+'+(state.enclosed.size - prev)+' cells enclosed','win');
  }
  updateHud();
}

// Decompression scenario tap: remove the clicked wall, recompute
// enclosure, and eject the resources of any cell that lost its seal.
function handleDecompress(p){
  const {gx,gy} = screenToGrid(p.x, p.y);
  const m = moduleAt(gx,gy);
  if(!m){ return; }
  if(m.type==='C'){ flash('Cannot remove the Core'); return; }
  // Snapshot the enclosure, drop the wall, recompute the enclosure.
  const wallCellsBefore = state.enclosed;
  state.modules = state.modules.filter(mm=>!(mm.gx===gx && mm.gy===gy));
  const wallCellsAfter = computeEnclosed();
  // Cells lost from enclosure now eject their resources
  // The lost cells are those enclosed before but not after.
  const lost = new Set();
  for(const k of wallCellsBefore){ if(!wallCellsAfter.has(k)) lost.add(k); }
  let totalEjected = 0;
  for(const k of lost){
    const [lx,ly] = k.split(',').map(Number);
    const stk = state.resources[k] || [];
    for(const r of stk){
      // Spawn particles — matches process_storage_ejections in requests.rs:
      //   angle = (i/count)*TAU + jitter(±0.3 rad)
      //   burst_speed = 800-1200 game-units/s, scaled to canvas px/frame
      //   one Resource entity per UNIT in the stack (not per stack)
      // One particle per unit in the stack, spread evenly around a circle
      // from a random base angle with jitter, so the burst reads radial.
      const N = r.count;
      const baseAngle = Math.random()*Math.PI*2;
      const pos = gridToScreen(lx,ly);
      for(let i=0;i<N;i++){
        const ang = (i/N)*Math.PI*2 + baseAngle + (Math.random()-0.5)*0.6;
        const sp = 5.5 + Math.random()*2.8;  // scaled 800-1200 → ~5.5-8.3 px/frame
        state.particles.push({
          x:pos.x, y:pos.y,
          vx:Math.cos(ang)*sp, vy:Math.sin(ang)*sp,
          color:r.color, label:r.label,
          life: 280 + Math.random()*40,
          rot: Math.random()*Math.PI*2, rotV:(Math.random()-0.5)*0.06,
        });
        totalEjected++;
      }
    }
    delete state.resources[k];
  }
  state.enclosed = wallCellsAfter;
  if(totalEjected>0) flash('DECOMPRESSION · '+totalEjected+' units ejected','win');
  else flash('Wall removed','info');
  updateHud();
}

// Foundry scenario tap: click an input-bay cell to add ore. Clicking the
// output side is rejected with a hint.
function handleFoundry(p){
  // Click an input cell to refill ore
  const {gx,gy} = screenToGrid(p.x, p.y);
  const k = gKey(gx,gy);
  if(!state.enclosed.has(k)) return;
  // Determine which side this cell is on relative to foundry direction
  const dir = state.foundry.dir;  // 0=E,1=S,2=W,3=N
  const isOutput = (dir===0 && gx>0) || (dir===2 && gx<0) || (dir===1 && gy>0) || (dir===3 && gy<0);
  if(isOutput){ flash('That side is the output — try the input bay','info'); return; }
  // Add ore
  // Add ore, clamped to the 64-unit cell cap.
  if(!state.resources[k]) state.resources[k] = [];
  const stk = state.resources[k];
  if(stk.length===0) stk.push({label:'Fe', color:'#d08050', count:0});
  stk[0].count = Math.min(64, stk[0].count + 16);
  flash('+16 Iron Ore added','info');
}

// Tiers scenario tap: hit-test every node and toggle the nearest within
// 22px as the selection (clicking the selected node clears it).
function handleTiers(p){
  const nodes = layoutTierNodes();
  let best = null, bestD = Infinity;
  for(const n of nodes){
    const d = Math.hypot(p.x - n.x, p.y - n.y);
    if(d < 22 && d < bestD){ best = n; bestD = d; }
  }
  if(best){
    state.tierSel = (state.tierSel === best.id) ? null : best.id;
    if(state.tierSel) flash('Selected: '+best.label,'info');
  } else {
    state.tierSel = null;
  }
}

// Pointer wiring: mouse and touch both update state.hover on move and call
// onTap on release. preventDefault stops scrolling and text selection.
let mouseHandled = false;
cv.addEventListener('mousedown', e=>{
  e.preventDefault();
  const p = getPt(e);
  state.hover = p;
});
cv.addEventListener('mousemove', e=>{
  const p = getPt(e);
  state.hover = p;
});
cv.addEventListener('mouseup', e=>{
  e.preventDefault();
  const p = getPt(e);
  onTap(p);
});
cv.addEventListener('mouseleave', ()=>{ state.hover = null; });
cv.addEventListener('touchstart', e=>{ e.preventDefault(); const p = getPt(e); state.hover = p; }, {passive:false});
cv.addEventListener('touchmove',  e=>{ e.preventDefault(); const p = getPt(e); state.hover = p; }, {passive:false});
cv.addEventListener('touchend',   e=>{ e.preventDefault(); const p = getPt(e); onTap(p); state.hover = null; }, {passive:false});

/* ════════════════════════════════════════════════════════════════════
   READOUTS
   ──────────────────────────────────────────────────────────────────── */
// Refresh the top HUD counters and the per-scenario selection bar. The
// selection bar text is chosen by scenario id so each lesson reports the
// figure that matters to it.
function updateHud(){
  document.getElementById('hud-mods').textContent = state.modules.length;
  document.getElementById('hud-enc').textContent  = state.enclosed.size;
  const sel = document.getElementById('sel');
  const s = SCENARIOS[state.scnIdx];
  if(s.id==='placement' || s.id==='enclosure'){
    const built = state.modules.filter(m=>m.built!==false).length;
    const unbuilt = state.modules.length - built;
    sel.classList.toggle('has-sel', state.modules.length>0);
    sel.innerHTML = '<strong>'+built+'</strong> built · <strong>'+unbuilt+'</strong> planned · <strong>'+state.enclosed.size+'</strong> enclosed';
  } else if(s.id==='decompress'){
    sel.classList.toggle('has-sel', state.particles.length>0);
    sel.innerHTML = '<strong>'+state.particles.length+'</strong> floating · <strong>'+state.enclosed.size+'</strong> still enclosed';
  } else if(s.id==='foundry'){
    sel.classList.toggle('has-sel', true);
    const w = state.foundryWorker;
    const wState = w ? w.state.toUpperCase() : 'NONE';
    sel.innerHTML = 'Output: <strong>'+['EAST','SOUTH','WEST','NORTH'][state.foundry?state.foundry.dir:0]+'</strong> · Worker: <strong>'+wState+'</strong>';
  } else if(s.id==='crew'){
    const taskList = ['Mine','Construct','Collect','Search','Harvest','Metallurgy','Rest'];
    const counts = taskList.map(t=>state.taskCount[t]||0);
    const totalActive = counts.reduce((a,b)=>a+b,0);
    sel.classList.toggle('has-sel', true);
    sel.innerHTML = '<strong>'+totalActive+'</strong> citizens working · <strong>'+state.asteroids.length+'</strong> asteroids';
  } else if(s.id==='tiers'){
    sel.classList.toggle('has-sel', !!state.tierSel);
    if(state.tierSel){
      const n = TIER_NODES.find(x=>x.id===state.tierSel);
      sel.innerHTML = 'Selected: <strong>'+n.label+'</strong>';
    } else {
      sel.innerHTML = 'Click a node to trace dependencies';
    }
  }
}

// Show a transient toast message. kind sets the colour class; the toast
// hides itself after 1.8s, and each call resets that timer.
let toastTimer;
function flash(msg, kind){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (kind?(' '+kind):'');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), 1800);
}

