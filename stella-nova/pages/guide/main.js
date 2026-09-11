/* ════════════════════════════════════════════════════════════════════
   MAIN LOOP
   ──────────────────────────────────────────────────────────────────── */
// The per-frame update: resize, lay down the phosphor fade and grid, then
// draw the active scenario. Tiers is its own path; every other scenario
// shares the grid draw order. Ends by scheduling the next frame.
function render(){
  resize();
  state.t++;

  // Semi-transparent fill each frame leaves fading trails behind moving art.
  // Phosphor trail
  ctx.fillStyle = 'rgba(7,10,16,0.32)';
  ctx.fillRect(0,0,W,H);

  drawSpaceGrid();

  const s = SCENARIOS[state.scnIdx];

  // Tiers draws the dependency graph; all others draw the grid world.
  if(s.id==='tiers'){
    drawTiers();
  } else {
    // Grid scenarios
    drawEnclosedCells();
    drawResources();

    if(s.id==='foundry'){
      updateFoundryWorker();
    }

    // Modules
    for(const m of state.modules) drawModule(m);

    // Foundry worker citizen (drawn on top of modules so the glow stacks)
    if(s.id==='foundry') drawFoundryWorker();

    // Crew scenario extras
    if(s.id==='crew'){
      drawAsteroids();
      updateCrew();
      drawCrew();
    }

    // Auto-build for placement / enclosure
    // With auto-build on, advance one blueprint per frame; finishing one
    // may seal new enclosure and, in the enclosure lesson, fill it.
    if(state.autoBuild && (s.id==='placement' || s.id==='enclosure')){
      // Advance one planned module's progress
      const planned = state.modules.find(m=>m.built===false);
      if(planned){
        planned.delivered = (planned.delivered||0) + 6;
        if(planned.delivered >= planned.need){
          planned.built = true;
          state.enclosed = computeEnclosed();
          if(s.id==='enclosure'){
            // Maybe new cells got enclosed - resource fill
            const labels = ['Fe','Cu','Al','C'];
            const cols   = ['#d08050','#d8a050','#c8c8d8','#8a8a8a'];
            for(const k of state.enclosed){
              if(!state.resources[k]){
                const idx = Math.floor(Math.random()*labels.length);
                state.resources[k] = [{label:labels[idx], color:cols[idx], count:10+Math.floor(Math.random()*40)}];
              }
            }
          }
        }
      }
    }

    drawParticles();
    drawHoverPlacement();
  }

  updateHud();
  requestAnimationFrame(render);
}

/* ════════════════════════════════════════════════════════════════════
   SCENARIO BAR
   ──────────────────────────────────────────────────────────────────── */
// Build the top row of scenario cards, each wired to loadScenario(i).
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
// On narrow screens the FAB slides the right panel in as a drawer over a
// backdrop; the three elements toggle together.
function toggleDrawer(){
  const panel = document.getElementById('sideR');
  const fab = document.getElementById('fab');
  const bd = document.getElementById('bd');
  const willOpen = !panel.classList.contains('open');
  panel.classList.toggle('open', willOpen);
  fab.classList.toggle('open', willOpen);
  bd.classList.toggle('show', willOpen);
}
// Close the drawer (backdrop tap).
function closeDrawer(){
  document.getElementById('sideR').classList.remove('open');
  document.getElementById('fab').classList.remove('open');
  document.getElementById('bd').classList.remove('show');
}

/* ════════════════════════════════════════════════════════════════════
   BOOT
   ──────────────────────────────────────────────────────────────────── */
// Build the card bar, size the canvas, keep it sized on resize, load the
// first scenario, and start the render loop.
buildScnBar();
resize();
window.addEventListener('resize', resize);
loadScenario(0);
render();

// When embedded in the site shell iframe, add .in-frame so the CSS hides
// this page's own chrome. A cross-origin access throw also means embedded.
try{ if(window.self!==window.top) document.body.classList.add('in-frame'); }catch(e){ document.body.classList.add('in-frame'); }
