// ============================================================================
//  MAGNETLAB  ·  panel wiring  (part 12 of 20)
// ----------------------------------------------------------------------------
//  The left panel and the magnet cards. index.html calls these functions
//  from onclick and oninput, so each one stays a global function.
//
//  grep -n targets: "function sg", "function rebuildMagnetList", "function addMagnet",
//                   "function toggleMobilePanel", "function setMagProp", "function clearAll"
// ============================================================================

/* ═══ UI WIRING ═══ */
// Paint a range input's filled portion: set the --pct custom property the CSS
// gradient reads, so the track shows progress up to the thumb.
function sg(el){const pct=(el.value-el.min)/(el.max-el.min)*100;el.style.setProperty('--pct',pct+'%');}

// Rebuild the magnet list panel from scratch. One card per magnet carries the
// strength, angle, spin, and fixed/dynamic controls, each wired to setMagProp.
// Called after any add, remove, select, drag, or property change.
function rebuildMagnetList(){
  const list=document.getElementById('mag-list');if(!list)return;list.innerHTML='';
  const names={bar:'Bar',dipole:'Dipole',solenoid:'Solenoid',horseshoe:'Horseshoe',buzzer:'Buzzer',ring:'Ring',quadrupole:'Quadrupole',halbach:'Halbach'};
  magnets.forEach(mag=>{
    const c=document.createElement('div');
    c.className='mag-card'+(mag.id===SIM.selectedId?' selected':'');
    c.onclick=e=>{if(!e.target.closest('.mag-card-del'))selectMagnet(mag.id);};
    c.innerHTML=`<div class="mag-card-head"><span class="mag-card-name">${names[mag.type]||mag.type} ${mag.id}</span><button class="mag-card-del" onclick="removeMagnet(${mag.id})" aria-label="Remove">Remove</button></div>
      <div class="mag-row"><span class="mag-row-lbl">Strength</span><input type="range" min="0.1" max="5" value="${mag.strength}" step="0.1" oninput="setMagProp(${mag.id},'strength',+this.value,this)"><span class="val">${mag.strength.toFixed(1)}</span></div>
      <div class="mag-row"><span class="mag-row-lbl">Angle</span><input type="range" min="-3.14159" max="3.14159" value="${mag.angle}" step="0.05" oninput="setMagProp(${mag.id},'angle',+this.value,this)"><span class="val">${(mag.angle*180/Math.PI).toFixed(0)}°</span></div>
      <div class="mag-row"><span class="mag-row-lbl">Spin</span><input type="range" min="-24" max="24" value="${mag.spin}" step="0.5" oninput="setMagProp(${mag.id},'spin',+this.value,this)"><span class="val">${mag.spin.toFixed(1)}</span></div>
      <button class="tog-btn ${mag.fixed?'off':'on'}" onclick="toggleFixed(${mag.id})">${mag.fixed?'Fixed':'Dynamic'}</button>`;
    list.appendChild(c);
    c.querySelectorAll('input[type=range]').forEach(sg);
  });
  document.getElementById('st-magnets').textContent=magnets.length+' magnet'+(magnets.length!==1?'s':'');
}

// Add a magnet of the given type at a free spot near centre, select it, and
// respawn tracers so filings gather at the new poles.
function addMagnet(type){
  // Find a position that doesn't overlap existing magnets
  let cx=CW/2, cy=CH/2;
  const tryRadius=Math.max(60, Math.min(CW,CH)*0.08);
  let placed=false;
  // Spiral outward from center to find a free spot
  for(let ring=0;ring<8&&!placed;ring++){
    const r=ring*tryRadius;
    const steps=Math.max(1, Math.round(ring*6));
    for(let s=0;s<steps&&!placed;s++){
      const angle=s/steps*Math.PI*2;
      const tx=CW/2+Math.cos(angle)*r;
      const ty=CH/2+Math.sin(angle)*r;
      let overlap=false;
      for(const other of magnets){
        const dx=tx-other.x,dy=ty-other.y;
        const minD=Math.max(other.w,other.h)*0.5+60;
        if(dx*dx+dy*dy<minD*minD){overlap=true;break;}
      }
      if(!overlap){cx=tx;cy=ty;placed=true;}
    }
  }
  cx=Math.max(60,Math.min(CW-60,cx));
  cy=Math.max(60,Math.min(CH-60,cy));
  const m=createMagnet(type,cx,cy);
  magnets.push(m);SIM.selectedId=m.id;
  rebuildMagnetList();spawnTracers();
  // Auto-close mobile panel so user sees the new magnet
  if(window.innerWidth<600) document.getElementById('panel').classList.remove('mob-open');
}

// Slide the left panel in or out on narrow screens.
function toggleMobilePanel(){
  document.getElementById('panel').classList.toggle('mob-open');
}

// The remaining control handlers: remove/select a magnet, edit a property,
// toggle fixed/dynamic, toggle each display layer, retune tracers, and run the
// transport buttons. Each keeps SIM and the DOM in sync, respawning tracers
// where the field geometry changed.
function removeMagnet(id){magnets=magnets.filter(m=>m.id!==id);if(SIM.selectedId===id)SIM.selectedId=magnets.length?magnets[0].id:-1;rebuildMagnetList();spawnTracers();}
function selectMagnet(id){SIM.selectedId=id;rebuildMagnetList();}
function setMagProp(id,prop,val,el){
  const m=magnets.find(m=>m.id===id);if(!m)return;m[prop]=val;if(el)sg(el);
  const row=el.closest('.mag-row');if(row){const v=row.querySelector('.val');if(prop==='angle')v.textContent=(val*180/Math.PI).toFixed(0)+'°';else v.textContent=val.toFixed(1);}
}
function toggleFixed(id){const m=magnets.find(m=>m.id===id);if(!m)return;m.fixed=!m.fixed;m.vx=0;m.vy=0;m.va=0;rebuildMagnetList();}
function toggleTracers(){SIM.showTracers=!SIM.showTracers;const b=document.getElementById('tog-tracers');b.classList.toggle('on',SIM.showTracers);b.classList.toggle('off',!SIM.showTracers);}
function toggleArrows(){SIM.showArrows=!SIM.showArrows;const b=document.getElementById('tog-arrows');b.classList.toggle('on',SIM.showArrows);b.classList.toggle('off',!SIM.showArrows);}
function toggleGrid(){SIM.showHeatmap=!SIM.showHeatmap;const b=document.getElementById('tog-grid');b.classList.toggle('on',SIM.showHeatmap);b.classList.toggle('off',!SIM.showHeatmap);}
function updateTracerCount(el){SIM.tracerCount=+el.value;document.getElementById('vl-tracer-count').textContent=el.value;sg(el);spawnTracers();document.getElementById('st-tracers').textContent=SIM.tracerCount+' tracers';}
function updateTracerSpeed(el){SIM.tracerSpeed=+el.value;document.getElementById('vl-tracer-speed').textContent=(+el.value).toFixed(1);sg(el);}
function updateTracerTrail(el){SIM.tracerTrail=+el.value;document.getElementById('vl-tracer-trail').textContent=el.value;sg(el);}
function togglePlay(){SIM.playing=!SIM.playing;const b=document.getElementById('btn-play');b.textContent=SIM.playing?'Play':'Pause';b.classList.toggle('active',SIM.playing);}
function resetSim(){magnets.forEach(m=>{m.vx=0;m.vy=0;m.va=0;m.spin=0;});rebuildMagnetList();spawnTracers();}
function stopAll(){magnets.forEach(m=>{m.vx=0;m.vy=0;m.va=0;m.spin=0;});rebuildMagnetList();}
function clearAll(){magnets=[];SIM.selectedId=-1;rebuildMagnetList();spawnTracers();}
