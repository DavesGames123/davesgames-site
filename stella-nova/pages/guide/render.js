/* ════════════════════════════════════════════════════════════════════
   RENDERING
   ──────────────────────────────────────────────────────────────────── */
// Match the canvas backing store to its CSS box and the device pixel ratio,
// then recentre the grid. Called every frame so a container resize is
// picked up without a resize event.
function resize(){
  const r = document.getElementById('canvasArea').getBoundingClientRect();
  W = r.width; H = r.height;
  cv.width = W*dpr; cv.height = H*dpr;
  cv.style.width = W+'px'; cv.style.height = H+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);
  centerGrid();
}
// Put grid origin at the canvas centre and size cells to the smaller
// dimension, clamped to 22..38px.
function centerGrid(){
  GRID.cx = Math.floor(W/2);
  GRID.cy = Math.floor(H/2);
  // Scale cell size to fit nicely
  GRID.cellSize = Math.max(22, Math.min(38, Math.floor(Math.min(W,H)/22)));
}

// Faint blue background lattice, offset so lines fall on cell boundaries.
function drawSpaceGrid(){
  ctx.strokeStyle = 'rgba(80,130,200,0.045)';
  ctx.lineWidth = 1;
  const cs = GRID.cellSize;
  const ox = GRID.cx % cs, oy = GRID.cy % cs;
  for(let x = ox - cs; x <= W; x += cs){
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke();
  }
  for(let y = oy - cs; y <= H; y += cs){
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
  }
}

// Teal phosphor fill and outline on every enclosed storage cell.
function drawEnclosedCells(){
  const cs = GRID.cellSize;
  ctx.save();
  for(const k of state.enclosed){
    const [gx,gy] = k.split(',').map(Number);
    const pos = gridToScreen(gx,gy);
    ctx.shadowBlur = 10; ctx.shadowColor = '#4ad8e0';
    ctx.fillStyle = 'rgba(74,216,224,0.07)';
    ctx.strokeStyle = 'rgba(74,216,224,0.35)';
    ctx.lineWidth = 1;
    ctx.fillRect(pos.x - cs/2 + 2, pos.y - cs/2 + 2, cs - 4, cs - 4);
    ctx.strokeRect(pos.x - cs/2 + 2, pos.y - cs/2 + 2, cs - 4, cs - 4);
  }
  ctx.restore();
}

// Draw the top resource stack in each enclosed cell: label above, count
// below, tinted and glowing with the resource colour.
function drawResources(){
  const cs = GRID.cellSize;
  for(const k of state.enclosed){
    const stk = state.resources[k];
    if(!stk || stk.length===0) continue;
    const [gx,gy] = k.split(',').map(Number);
    const pos = gridToScreen(gx,gy);
    const top = stk[0];
    if(!top || top.count<=0) continue;
    ctx.save();
    ctx.shadowBlur = 5; ctx.shadowColor = top.color;
    ctx.fillStyle = top.color;
    ctx.font = 'bold '+Math.round(cs*0.32)+'px JetBrains Mono';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(top.label, pos.x, pos.y - cs*0.08);
    ctx.font = Math.round(cs*0.22)+'px JetBrains Mono';
    ctx.fillStyle = 'rgba(200,210,220,0.75)';
    ctx.shadowBlur = 0;
    ctx.fillText(top.count+'×', pos.x, pos.y + cs*0.18);
    ctx.restore();
  }
}

// Draw one module. Built modules get a solid glowing box plus a glyph (the
// core shows a hexagon, a foundry shows its output arrow and progress);
// planned modules get a dashed blueprint box with a construction bar.
function drawModule(m){
  const cs = GRID.cellSize;
  const t = MOD[m.type];
  const pos = gridToScreen(m.gx, m.gy);
  const built = m.built !== false;
  const x = pos.x - cs/2, y = pos.y - cs/2;

  ctx.save();
  if(built){
    ctx.shadowBlur = 9;
    ctx.shadowColor = t.color;
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 1.6;
    ctx.fillStyle = t.color + '10';
    ctx.fillRect(x+2, y+2, cs-4, cs-4);
    ctx.strokeRect(x+2, y+2, cs-4, cs-4);

    if(m.type==='C'){
      // Core: inner hex marker
      ctx.shadowBlur = 0;
      ctx.beginPath();
      const r = cs*0.22;
      for(let i=0;i<6;i++){
        const a = (i/6)*Math.PI*2;
        const px = pos.x + Math.cos(a)*r, py = pos.y + Math.sin(a)*r;
        if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
      }
      ctx.closePath(); ctx.stroke();
    } else {
      // Letter label
      ctx.shadowBlur = 0;
      ctx.fillStyle = t.color;
      ctx.font = 'bold '+Math.round(cs*0.46)+'px JetBrains Mono';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(m.type, pos.x, pos.y + 1);
    }

    // Foundry output arrow
    // Arrow points along the output direction; the claim ring and progress
    // bar mirror the worker's docked state.
    if(m.type==='F' && state.foundry){
      const dir = state.foundry.dir;
      const ang = dir*Math.PI/2;
      const len = cs*0.32;
      const ax = pos.x + Math.cos(ang)*len, ay = pos.y + Math.sin(ang)*len;
      ctx.shadowBlur = 12; ctx.shadowColor = '#ffc832';
      ctx.strokeStyle = '#ffc832';
      ctx.fillStyle = '#ffc832';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ax - Math.cos(ang)*6 - Math.sin(ang)*4, ay - Math.sin(ang)*6 + Math.cos(ang)*4);
      ctx.lineTo(ax, ay);
      ctx.lineTo(ax - Math.cos(ang)*6 + Math.sin(ang)*4, ay - Math.sin(ang)*6 - Math.cos(ang)*4);
      ctx.stroke();

      // Foundry claim ring + progress bar — matches foundry_worker/foundry_progress
      if(state.foundry.claimed){
        ctx.shadowBlur = 10; ctx.shadowColor = '#b45028';
        ctx.strokeStyle = '#b45028';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([3,3]);
        ctx.strokeRect(x, y, cs, cs);
        ctx.setLineDash([]);
      }
      if(state.foundry.progress !== null && state.foundry.progress !== undefined){
        const pct = Math.min(1, state.foundry.progress);
        ctx.shadowBlur = 6; ctx.shadowColor = '#ffc832';
        ctx.fillStyle = '#ffc832';
        ctx.fillRect(x+3, y+cs-4, (cs-6)*pct, 2.5);
      }
    }
  } else {
    // Planned / blueprint - dashed outline, dim color
    ctx.shadowBlur = 6;
    ctx.shadowColor = t.color;
    ctx.strokeStyle = t.color + '90';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4,3]);
    ctx.strokeRect(x+2, y+2, cs-4, cs-4);
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    ctx.fillStyle = t.color + '70';
    ctx.font = 'bold '+Math.round(cs*0.42)+'px JetBrains Mono';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(m.type, pos.x, pos.y + 1);
    // Construction progress bar
    if(m.delivered>0 && m.need){
      const pct = Math.min(1, m.delivered/m.need);
      ctx.fillStyle = t.color;
      ctx.fillRect(x+3, y+cs-6, (cs-6)*pct, 2);
    }
  }
  ctx.restore();
}

// Preview the cell under the pointer in placement scenarios: a dashed ghost
// tinted the module colour when valid, red when the placement would fail.
function drawHoverPlacement(){
  if(!state.hover) return;
  const s = SCENARIOS[state.scnIdx];
  if(!s.showPalette) return;
  const {gx,gy} = screenToGrid(state.hover.x, state.hover.y);
  // Out of reasonable range?
  if(Math.abs(gx)>20 || Math.abs(gy)>20) return;
  if(moduleAt(gx,gy)) return;
  const v = validatePlacement(gx,gy,state.paletteSel);
  const cs = GRID.cellSize;
  const pos = gridToScreen(gx,gy);
  ctx.save();
  ctx.shadowBlur = 10;
  if(v.ok){
    ctx.shadowColor = MOD[state.paletteSel].color;
    ctx.strokeStyle = MOD[state.paletteSel].color;
    ctx.fillStyle = MOD[state.paletteSel].color + '20';
  } else {
    ctx.shadowColor = '#ff5050';
    ctx.strokeStyle = '#ff5050';
    ctx.fillStyle = 'rgba(255,80,80,0.10)';
  }
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5,3]);
  ctx.fillRect(pos.x - cs/2 + 2, pos.y - cs/2 + 2, cs - 4, cs - 4);
  ctx.strokeRect(pos.x - cs/2 + 2, pos.y - cs/2 + 2, cs - 4, cs - 4);
  ctx.setLineDash([]);
  ctx.restore();
}

// Advance and draw ejecta particles. Each frame integrates velocity, applies
// drag and spin, ages the particle, and culls it off-screen or at life 0.
function drawParticles(){
  for(let i = state.particles.length - 1; i >= 0; i--){
    const p = state.particles[i];
    p.x += p.vx; p.y += p.vy;
    p.vx *= 0.978; p.vy *= 0.978;  // higher drag — initial speed is now ~6x
    p.rot += p.rotV;
    p.life--;
    if(p.life <= 0 || p.x < -50 || p.x > W+50 || p.y < -50 || p.y > H+50){
      state.particles.splice(i,1);
      continue;
    }
    const alpha = Math.min(1, p.life/80);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.shadowBlur = 6;
    ctx.shadowColor = p.color;
    ctx.fillStyle = p.color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

/* Metallurgy worker — mirrors behaviors/metallurgy.rs state machine:
   searching → approaching → processing → (loop if more input) → departing.
   foundry_worker + foundry_progress set on Docking, cleared on Undocking. */
// Find the input-bay cell the worker should pull from next: any non-output
// enclosed cell that holds ore, chosen in top-to-bottom, left-to-right
// reading order (mirrors get_region_resources_by_position).
function findInputCellWithOre(){
  if(!state.foundry) return null;
  const f = state.foundry;
  const dir = f.dir;
  const cells = [];
  for(const k of state.enclosed){
    const [gx, gy] = k.split(',').map(Number);
    const isOutput = (dir===0 && gx>f.gx) || (dir===2 && gx<f.gx) ||
                     (dir===1 && gy>f.gy) || (dir===3 && gy<f.gy);
    if(isOutput) continue;
    const stk = state.resources[k];
    if(stk && stk.length>0 && stk[0].count>0){
      cells.push({k, gx, gy, stk});
    }
  }
  // Reading order: top-to-bottom, left-to-right (matches get_region_resources_by_position)
  cells.sort((a,b) => a.gy === b.gy ? a.gx - b.gx : a.gy - b.gy);
  return cells[0] || null;
}

// One smelt: take 1 ore from the chosen input cell and add 7 ingots to the
// output cell, capped at 64. Returns false when there is no ore to consume.
function executeFoundryTransfer(){
  // Consume 1 ore from input, produce 7 ingots to output — matches Foundry smelt 1:7
  const cell = findInputCellWithOre();
  if(!cell) return false;
  cell.stk[0].count--;
  const f = state.foundry;
  // Output cell is the neighbour in the foundry's output direction.
  const ofs = [[1,0],[0,1],[-1,0],[0,-1]][f.dir];
  const ogx = f.gx + ofs[0], ogy = f.gy + ofs[1];
  const okey = gKey(ogx, ogy);
  if(state.enclosed.has(okey)){
    if(!state.resources[okey]) state.resources[okey] = [];
    let st = state.resources[okey].find(s => s.label === 'Fe+');
    if(!st){
      st = {label:'Fe+', color:'#c8a840', count:0};
      state.resources[okey].push(st);
    }
    st.count = Math.min(64, st.count + 7);
  }
  return true;
}

// The Metallurgy worker state machine, advanced one step per frame:
//
//   searching ─input?─▶ approaching ─docked─▶ processing ─┐
//       ▲                                          │       │ batch done,
//       │                                          │       │ more input
//       └───────────── departing ◀────no input────┴───────┘
//
// searching drifts in orbit until input appears; approaching flies to the
// foundry and docks; processing accrues work and smelts a batch each time
// the meter fills; departing flies back to the hold, then loops.
function updateFoundryWorker(){
  const w = state.foundryWorker;
  if(!w || !state.foundry) return;
  const f = state.foundry;
  const fpos = gridToScreen(f.gx, f.gy);
  const speed = 2.2;

  switch(w.state){
    // Idle drift until an input cell has ore, then approach.
    case 'searching':
      // Drift slowly in orbit while no input available
      if(!findInputCellWithOre()){
        w.x += Math.sin(state.t*0.024) * 0.3;
        w.y += Math.cos(state.t*0.018) * 0.2;
        w.dir = state.t * 0.01;
        return;
      }
      w.state = 'approaching';
      break;

    // Fly toward the foundry; on arrival dock, claim it, and set the work
    // needed for one batch.
    case 'approaching': {
      const dx = fpos.x - w.x, dy = fpos.y - w.y;
      const d = Math.hypot(dx, dy);
      if(d > 5){
        w.vx = (dx/d)*speed; w.vy = (dy/d)*speed;
        w.dir = Math.atan2(dy, dx);
        w.x += w.vx; w.y += w.vy;
      } else {
        // Docking — lock to foundry world position (matches handle_docking)
        w.x = fpos.x; w.y = fpos.y;
        w.vx = 0; w.vy = 0;
        f.claimed = true;
        // detect_recipe_from_input — for our demo, ore→ingot has 1 input × WORK_PER_INPUT_ITEM = 200
        w.workDone = 0;
        w.workNeeded = 200;
        f.progress = 0;
        w.state = 'processing';
      }
      break;
    }

    // Accrue work while docked; smelt one batch each time the meter fills,
    // and undock when the input runs out.
    case 'processing': {
      // Need input still available (or undock)
      if(!findInputCellWithOre()){
        w.state = 'departing';
        f.claimed = false; f.progress = null;
        break;
      }
      // Work rate: 200 units / 240 frames = ~0.83/frame (4s per batch)
      w.workDone += 200/240;
      f.progress = w.workDone / w.workNeeded;
      if(w.workDone >= w.workNeeded){
        const ok = executeFoundryTransfer();
        w.workDone = 0; f.progress = 0;
        if(!ok || !findInputCellWithOre()){
          // No more input — undock
          w.state = 'departing';
          f.claimed = false; f.progress = null;
        }
      }
      break;
    }

    // Fly back to the off-station hold, then return to searching.
    case 'departing': {
      // Fly back to off-station hold position
      const tx = W*0.08, ty = H*0.50;
      const ldx = tx - w.x, ldy = ty - w.y;
      const ld = Math.hypot(ldx, ldy);
      if(ld > 8){
        w.vx = (ldx/ld)*speed; w.vy = (ldy/ld)*speed;
        w.dir = Math.atan2(ldy, ldx);
        w.x += w.vx; w.y += w.vy;
      } else {
        w.state = 'searching';
      }
      break;
    }
  }
}

// Draw the foundry worker as a small ship, coloured and captioned by state
// (IDLE / DOCKING / METALLURGY / UNDOCKING).
function drawFoundryWorker(){
  const w = state.foundryWorker;
  if(!w) return;
  let color = '#6878a0';
  if(w.state === 'approaching' || w.state === 'departing') color = '#a08040';
  if(w.state === 'processing') color = '#b45028';

  ctx.save();
  ctx.translate(w.x, w.y);
  ctx.rotate(w.dir);
  ctx.shadowBlur = w.state === 'processing' ? 14 : 10;
  ctx.shadowColor = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = w.state === 'processing' ? 1.8 : 1.5;
  const r = 11;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(-r*0.8, -r*0.75);
  ctx.lineTo(-r*0.45, 0);
  ctx.lineTo(-r*0.8, r*0.75);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  const labels = {searching:'IDLE', approaching:'DOCKING',
                  processing:'METALLURGY', departing:'UNDOCKING'};
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = 'bold 9px JetBrains Mono';
  ctx.textAlign = 'center';
  ctx.fillText(labels[w.state]||'', w.x, w.y + 22);
  ctx.restore();
}

/* ════════════════════════════════════════════════════════════════════
   CREW SIMULATION
   ──────────────────────────────────────────────────────────────────── */
// Colour per task, used to tint each citizen by what they are doing.
const TASK_COLORS = {
  Search:'#8c5ac8', Collect:'#2878c8', Construct:'#c8a01e',
  Mine:'#be8232',   Harvest:'#3ca032', Metallurgy:'#b45028',
  Rest:'#6878a0',   Idle:'#6878a0',
};

// Assign a citizen its next task by walking the priority order and taking
// the first enabled task with available work, claiming the target so two
// citizens do not chase the same one. Falls through to Idle.
function pickCitizenTask(c){
  // Priority: Construct > Metallurgy > Mine > Collect > Rest > Idle (when toggled on)
  if(state.taskOn.Construct){
    const planned = state.modules.find(m=>m.built===false && (m._claimedBy==null || m._claimedBy===c));
    if(planned){
      planned._claimedBy = c;
      const pos = gridToScreen(planned.gx, planned.gy);
      c.task = 'Construct'; c.target = {x:pos.x, y:pos.y, type:'module', ref:planned};
      return;
    }
  }
  if(state.taskOn.Mine){
    const ast = state.asteroids.find(a => a.ore>0 && (a._claimedBy==null || a._claimedBy===c));
    if(ast){
      ast._claimedBy = c;
      c.task = 'Mine'; c.target = {x:ast.x, y:ast.y, type:'asteroid', ref:ast};
      return;
    }
  }
  if(state.taskOn.Collect && state.particles.length>0){
    const p = state.particles[0];
    c.task = 'Collect'; c.target = {x:p.x, y:p.y, type:'particle', ref:p};
    return;
  }
  if(state.taskOn.Rest){
    const dock = state.modules.find(m=>m.type==='D' && m.built);
    if(dock){
      const pos = gridToScreen(dock.gx, dock.gy);
      c.task = 'Rest'; c.target = {x:pos.x, y:pos.y, type:'rest'};
      return;
    }
  }
  if(state.taskOn.Search){
    c.task = 'Search'; c.target = {x: Math.random()*W*0.9 + W*0.05, y: Math.random()*H*0.7 + H*0.15, type:'wander'};
    return;
  }
  c.task = 'Idle'; c.target = null;
}

// Per-frame crew step: reset counts, drop stale claims, re-pick a task for
// any citizen whose target is gone, then move each citizen toward its
// target and run the task action on arrival. Also updates the DOM counts.
function updateCrew(){
  // Count by task
  state.taskCount = {Search:0,Collect:0,Construct:0,Mine:0,Harvest:0,Metallurgy:0,Rest:0,Idle:0};
  // Release stale claims on dead targets
  for(const m of state.modules){ if(m.built){ delete m._claimedBy; } }
  for(const a of state.asteroids){ if(a.ore<=0){ delete a._claimedBy; } }

  // Re-pick a task when the citizen has none or its target is finished.
  for(const c of state.citizens){
    if(!c.target || (c.target.type==='asteroid' && c.target.ref.ore<=0) ||
       (c.target.type==='module' && c.target.ref.built) ||
       (c.target.type==='particle' && state.particles.indexOf(c.target.ref)===-1)){
      pickCitizenTask(c);
    }
    if(c.target){
      const dx = c.target.x - c.x, dy = c.target.y - c.y;
      const d = Math.hypot(dx,dy);
      if(d > 3){
        const speed = 1.5;
        c.vx = (dx/d)*speed; c.vy = (dy/d)*speed;
        c.dir = Math.atan2(dy,dx);
      } else {
        c.vx = 0; c.vy = 0;
        // At target - do task
        // Mining chips the asteroid's ore and periodically spawns a
        // collectable ore particle; a depleted rock respawns shortly.
        if(c.task==='Mine' && c.target.ref){
          // Matches behaviors/mine.rs: "Creates new Resource objects in orbit"
          c.target.ref.ore -= 0.008;
          c.mineSpawnTimer = (c.mineSpawnTimer||0) + 1;
          if(c.mineSpawnTimer >= 22 && c.target.ref.ore > 0){
            c.mineSpawnTimer = 0;
            // Spawn one orbital resource near the asteroid — these are Collect targets
            const ang = Math.random()*Math.PI*2;
            state.particles.push({
              x: c.target.ref.x + Math.cos(ang)*16,
              y: c.target.ref.y + Math.sin(ang)*16,
              vx: Math.cos(ang)*0.4 + (Math.random()-0.5)*0.2,
              vy: Math.sin(ang)*0.4 + (Math.random()-0.5)*0.2,
              color:'#d08050', label:'Fe',
              life: 900, rot:Math.random()*6.28, rotV:(Math.random()-0.5)*0.04,
            });
          }
          if(c.target.ref.ore<=0){
            // Asteroid depleted — respawn after a moment
            setTimeout(()=>{ c.target.ref.ore = 1; }, 700);
          }
        // Construction adds progress; a finished blueprint becomes built
        // and may seal new enclosure.
        } else if(c.task==='Construct' && c.target.ref){
          c.target.ref.delivered = (c.target.ref.delivered||0) + 4;
          if(c.target.ref.delivered >= c.target.ref.need){
            c.target.ref.built = true;
            state.enclosed = computeEnclosed();
          }
        // Collecting removes the ore particle from orbit.
        } else if(c.task==='Collect' && c.target.ref){
          // Remove the particle
          const idx = state.particles.indexOf(c.target.ref);
          if(idx>=0) state.particles.splice(idx,1);
        }
      }
      c.x += c.vx; c.y += c.vy;
    }
    state.taskCount[c.task] = (state.taskCount[c.task]||0) + 1;
  }
  // Update task counts in DOM
  // Mirror the live task counts into the task box (crew scenario only).
  if(SCENARIOS[state.scnIdx].id === 'crew'){
    for(const t of ['Search','Collect','Construct','Mine','Harvest','Metallurgy','Rest']){
      const el = document.getElementById('tcnt-'+t);
      if(el) el.textContent = state.taskCount[t] || 0;
    }
  }
}

// Draw each citizen as a small ship tinted by task, with the task name
// captioned below.
function drawCrew(){
  for(const c of state.citizens){
    const color = TASK_COLORS[c.task] || '#6878a0';
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.dir);
    ctx.shadowBlur = 10; ctx.shadowColor = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    const r = 11;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(-r*0.8, -r*0.75);
    ctx.lineTo(-r*0.45, 0);
    ctx.lineTo(-r*0.8, r*0.75);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    // Label below
    ctx.save();
    ctx.fillStyle = 'rgba(200,210,230,0.55)';
    ctx.font = 'bold 9px JetBrains Mono';
    ctx.textAlign='center';
    ctx.fillText(c.task.toUpperCase(), c.x, c.y + 22);
    ctx.restore();
  }
}

// Drift, spin, and draw each ore asteroid as its jagged polygon; depleted
// rocks are skipped until they respawn.
function drawAsteroids(){
  for(const a of state.asteroids){
    if(a.ore<=0) continue;
    a.x += a.vx; a.y += a.vy;
    a.dir += a.spin;
    // Bounds
    // Bounce off the canvas edges.
    if(a.x<a.r||a.x>W-a.r) a.vx*=-1;
    if(a.y<a.r||a.y>H-a.r) a.vy*=-1;
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(a.dir);
    ctx.shadowBlur = 5; ctx.shadowColor = '#c8b8a0';
    ctx.strokeStyle = '#c8b8a0';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    a.verts.forEach((v,i)=>{
      const x = Math.cos(v.a)*v.r*a.r, y = Math.sin(v.a)*v.r*a.r;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}

/* ════════════════════════════════════════════════════════════════════
   TIER RENDERING
   ──────────────────────────────────────────────────────────────────── */
// Position every node: group by tier into rows, place each row at a fixed
// vertical fraction (T0 low, T5 high), and space nodes evenly across the
// width. Returns nodes with x/y added; both draw and hit-test use it.
function layoutTierNodes(){
  const tiers = [[],[],[],[],[],[]];
  for(const n of TIER_NODES) tiers[n.tier].push(n);
  const result = [];
  const yOf = [H*0.86, H*0.68, H*0.50, H*0.30, H*0.13, H*0.06];
  const paddingX = W*0.08;
  for(let t=0;t<6;t++){
    const row = tiers[t];
    if(row.length===0) continue;
    const spacing = (W - paddingX*2) / row.length;
    row.forEach((n, i)=>{
      result.push({...n, x: paddingX + spacing*(i+0.5), y: yOf[t]});
    });
  }
  return result;
}

// Every node the given node depends on: walk edges backward (dst→src)
// depth-first to collect the full input tree.
function getAncestors(id){
  const set = new Set();
  const stack = [id];
  while(stack.length){
    const cur = stack.pop();
    for(const [src,dst] of TIER_EDGES){
      if(dst===cur && !set.has(src)){ set.add(src); stack.push(src); }
    }
  }
  return set;
}
// Every node built from the given node: walk edges forward (src→dst)
// depth-first to collect the full output tree.
function getDescendants(id){
  const set = new Set();
  const stack = [id];
  while(stack.length){
    const cur = stack.pop();
    for(const [src,dst] of TIER_EDGES){
      if(src===cur && !set.has(dst)){ set.add(dst); stack.push(dst); }
    }
  }
  return set;
}

// Draw the whole tier graph: tier labels, bezier edges, then nodes. When a
// node is selected, ancestors glow yellow, descendants green, and the rest
// dim so the traced dependency tree stands out.
function drawTiers(){
  const nodes = layoutTierNodes();
  const nodeMap = {};
  for(const n of nodes) nodeMap[n.id] = n;

  // Resolve the selection's input tree (anc) and output tree (desc).
  const sel = state.tierSel;
  const anc = sel ? getAncestors(sel) : new Set();
  const desc = sel ? getDescendants(sel) : new Set();

  // Draw tier labels
  ctx.save();
  ctx.font = 'bold 10px JetBrains Mono';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const labels = ['T0 ORES','T1 INGOTS','T2 ALLOYS','T3 COMPONENTS','T4 FOOD','T5 FUEL'];
  const yOf = [H*0.86, H*0.68, H*0.50, H*0.30, H*0.13, H*0.06];
  for(let t=0;t<6;t++){
    ctx.fillStyle = TIER_COLORS[t] + '50';
    ctx.shadowBlur = 4; ctx.shadowColor = TIER_COLORS[t];
    ctx.fillText(labels[t], 12, yOf[t]);
  }
  ctx.restore();

  // Draw edges
  // Draw edges as vertical bezier curves; highlight those on the traced tree.
  for(const [src,dst] of TIER_EDGES){
    const a = nodeMap[src], b = nodeMap[dst];
    if(!a || !b) continue;
    let color = 'rgba(120,140,170,0.10)', lw = 1, blur = 0;
    if(sel){
      // Highlight if this edge connects sel to ancestors or descendants
      const inAnc = (anc.has(src) || src===sel) && (anc.has(dst) || dst===sel);
      const inDesc = (desc.has(src) || src===sel) && (desc.has(dst) || dst===sel);
      if(inAnc){ color = '#ffc832aa'; lw = 1.6; blur = 6; }
      else if(inDesc){ color = '#64c864aa'; lw = 1.6; blur = 6; }
    }
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    if(blur){ ctx.shadowBlur = blur; ctx.shadowColor = color; }
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    const midY = (a.y + b.y) / 2;
    ctx.bezierCurveTo(a.x, midY, b.x, midY, b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  // Draw nodes
  // Draw nodes; colour and glow by selection role (self / ancestor /
  // descendant / dimmed).
  for(const n of nodes){
    let color = TIER_COLORS[n.tier];
    let blur = 8;
    let lw = 1.4;
    const isSel = n.id===sel;
    const isAnc = anc.has(n.id);
    const isDesc = desc.has(n.id);
    if(sel && !isSel && !isAnc && !isDesc){
      color = '#384060';
      blur = 0;
    } else if(isAnc){ color = '#ffc832'; blur = 12; lw = 1.8; }
    else if(isDesc){ color = '#64c864'; blur = 12; lw = 1.8; }
    else if(isSel){ blur = 16; lw = 2.2; }

    ctx.save();
    ctx.shadowBlur = blur;
    ctx.shadowColor = color;
    ctx.strokeStyle = color;
    ctx.fillStyle = color + '20';
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(n.x, n.y, 18, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.font = (isSel?'bold ':'') + '9.5px JetBrains Mono';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(n.label, n.x, n.y);
    ctx.restore();
  }
}

