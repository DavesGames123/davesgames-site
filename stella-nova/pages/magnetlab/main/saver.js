// ============================================================================
//  MAGNETLAB  ·  screensaver driver  (part 19 of 20)
// ----------------------------------------------------------------------------
//  The seeded tour: scene start, per-frame step, plate send, the fade
//  cover, and the window.snSaver hook for lib/screensaver.js.
//
//  grep -n targets: "function svRand", "function saverScene", "function saverStep",
//                   "function saverOverlay", "window.snSaver"
// ============================================================================

// Seeded random 0..1 (mulberry32), so a seed gives the same tour.
function svRand(seed){ let a=seed>>>0; return ()=>{ a=(a+0x6D2B79F5)>>>0; let t=a; t=Math.imul(t^t>>>15,t|1);
  t^=t+Math.imul(t^t>>>7,t|61); return ((t^t>>>14)>>>0)/4294967296; }; }

// Start scene number k of the tour: new magnets, a seeded view, fresh tracers,
// filings seeds and the plate.
function saverScene(k){
  SV.k=k; SV.t=0;
  const sc=SAVER_SCENES[SV.order[k%SV.order.length]];
  SV.cx=CW*(CW>CH*1.2?0.44:0.5); SV.cy=CH*0.5; SV.R=Math.min(CW,CH)*0.5;
  const st={}; SV.scene=sc; SV.st=st; sc.build(st);
  for(const m of magnets){ m.spin=0; m.vx=m.vy=m.va=0; }
  sc.step(st,0);
  const v=VIEWS[sc.views[SV.pick(sc.views.length)]]; st.view=v;
  SIM.showTracers=v.tr; SIM.trMode=v.mode; SIM.showHeatmap=v.heat; SIM.showFilings=v.fil; SIM.showArrows=false;
  SIM.tracerCount=v.tr?tracerBudget():0;
  CAM.x=0; CAM.y=0; CAM.zoom=1;
  spawnTracers(); seedFilings();
  SV.plateT=0; SV.plateJ='';
  if(SV.opts && SV.opts.label) svSendPlate();
}
// Send the plate when it changed. saverStep() calls it once a second, so the
// live values (angles, gaps) stay current.
function svSendPlate(){ const L=saverPlate(); if(!L) return; const j=JSON.stringify(L); if(j!==SV.plateJ){ SV.plateJ=j; SV.opts.label(L); } }

// Per frame, before integrateMagnets(): move the scene, and fade through
// black around a scene change. SV.fade is the black cover, 0..1.
function saverStep(dt){
  SV.t+=dt;
  if(SV.st) SV.scene.step(SV.st,SV.t*SV.slow);
  if(SV.opts && SV.opts.label && SV.t-(SV.plateT||0)>=1){ SV.plateT=SV.t; svSendPlate(); }
  const left=SV.dwell-SV.t;
  if(left<=0){ saverScene(SV.k+1); SV.fade=1; return; }
  SV.fade=Math.max(0,Math.min(1,Math.max(1-SV.t/FADE_S,1-left/FADE_S)));
}
function saverOverlay(){
  if(SV.fade<=0.002) return;
  ctx.fillStyle='rgba(14,17,24,'+SV.fade.toFixed(3)+')'; ctx.fillRect(0,0,CW,CH);
}


window.snSaver={
  enter(opts){
    const calm=Math.min(1,Math.max(0,opts.calm??0.7));
    const st=document.createElement('style');
    st.textContent='#panel,#mob-btn,#eq-panel,#status-bar{display:none!important}'+
      '#canvas-wrap{position:fixed!important;inset:0}body::before,body::after{display:none}';
    document.head.appendChild(st);
    const ready=()=>started?Promise.resolve():new Promise(r=>setTimeout(()=>r(ready()),60));
    return ready().then(()=>{
      resize();
      const rnd=svRand(opts.seed||1);
      SV.opts=opts; SV.rnd=rnd; SV.pick=n=>Math.floor(rnd()*n)%n;
      SV.order=SAVER_SCENES.map((_,i)=>i);
      for(let i=SV.order.length-1;i>0;i--){ const j=SV.pick(i+1); [SV.order[i],SV.order[j]]=[SV.order[j],SV.order[i]]; }
      SV.slow=1-0.7*calm;
      SV.dwell=Math.max(14,Math.min(30,(opts.seconds||60)/3));
      SIM.selectedId=-1; SIM.playing=true;
      SIM.tracerSpeed=0.6+0.6*SV.slow; SIM.tracerTrail=60;
      saverOn=true;
      saverScene(0); SV.fade=0;
      rebuildMagnetList();
      return { canvas, warmupMs:1500 };
    });
  },
  exit(){ saverOn=false; if(SV.opts&&SV.opts.label) SV.opts.label(null); }
};
