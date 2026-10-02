// HUD helpers: set the topbar status message.
function setStatus(m){document.getElementById('smsg').textContent=m}
// Enable or disable the Launch button.
function setBtnLaunch(v){document.getElementById('btnLaunch').disabled=!v}
// Switch the floating equation panel between LIVE and REFERENCE styling.
function setEqPanelActive(active){
  document.getElementById('eqPanel').classList.toggle('active',active);
  document.getElementById('eqState').textContent=active?'Live':'Reference';
}
// Show or hide the transient banner over the canvas (green when a leg finishes).
function setTbar(show,msg='',green){
  const el=document.getElementById('tbar');
  if(show){
    el.textContent=msg;
    el.classList.add('show');
    el.classList.toggle('go',!!green);
  } else el.classList.remove('show');
}

/* INIT */
// Load the random system as the default and start the render loop.
loadPreset('random', document.querySelector('.pcard[data-preset="random"]'));
requestAnimationFrame(frame);

/* SCREENSAVER */
// Shell screensaver hook (lib/screensaver.js). enter() hides the topbar, the
// action bar, the math panel and the DOM overlays, makes #canvasArea fill the
// window and calls resize(). It also makes the guidance box and the grade
// card no-ops, and draws the unpicked orbits brighter. The autopilot then
// flies one transfer at a time: pick a pair, show the launch windows, launch
// at W1, coast, hold, fade to black and clear. Each new pair goes to the
// shell's label plate (opts.label): names, burns, coast time, equations.
// After two transfers it loads the next system behind the same fade. The sim
// speed comes from the innermost period, so one inner orbit takes 12 s (calm
// 0) to 22 s (calm 1). The pair is the one whose wait plus coast fits the
// slot, picked with opts.seed. No exit(): the shell reloads the page on stop.
window.snSaver={enter(opts){
  const calm=Math.max(0,Math.min(1,opts&&opts.calm!=null?+opts.calm:0.7));
  const secs=Math.max(20,+(opts&&opts.seconds)||60);
  let s=((opts&&opts.seed)|0)||12345;
  const rnd=()=>{s=(s+0x6D2B79F5)|0;let t=Math.imul(s^s>>>15,1|s);t^=t+Math.imul(t^t>>>7,61|t);return((t^t>>>14)>>>0)/4294967296};
  const st=document.createElement('style');
  st.textContent='.topbar,.action-bar,#mathpanel,#guide,#hoverbox,#fabMath,#drawerBackdrop,#tbar{display:none!important}'+
    '#main,#canvasArea{position:fixed!important;inset:0!important}canvas#cvs{cursor:none}';
  document.head.appendChild(st);
  document.documentElement.classList.add('saver');
  if(hopMode) toggleHopMode();
  drawGuidance=function(){}; drawScoreOverlay=function(){};
  // Unpicked orbits draw at 0.06 alpha, which reads as empty space full frame.
  const oOrbit=drawOrbit;
  drawOrbit=function(p){
    if(p===source||p===target) return oOrbit(p);
    ctx.beginPath(); ctx.arc(CX,CY,p.r*SCALE,0,TAU); ctx.setLineDash([1.5,7]);
    ctx.strokeStyle='rgba(150,200,255,0.2)'; ctx.lineWidth=0.9; ctx.stroke(); ctx.setLineDash([]);
  };
  const sp=document.getElementById('spSlider'); sp.min='0.001'; sp.max='10'; sp.step='any';
  const PRESETS=['random','inner','random','laplace','outer'];  // binary waits too long
  let pi=Math.floor(rnd()*PRESETS.length);
  const slot=Math.max(14,secs/2-6);          // real seconds of wait + coast per transfer
  let phase='pick', tPhase=performance.now(), tLaunch=0, done=0, fade=0, fadeTo=0;
  function system(name){
    loadPreset(name); _sc=null; paused=false;
    const tMin=Math.min(...planets.map(p=>p.period));
    sp.value=String(tMin/((12+10*calm)*BASE_TS));
  }
  function rate(){ return BASE_TS*parseFloat(sp.value); } // sim years per real second
  function pick(){
    const c=[];
    planets.forEach(a=>planets.forEach(b=>{
      if(a===b) return;
      const x=computeXfer(a.r,b.r), w=computeWindows(a,b,x,simTime,1);
      if(!w.length) return;
      c.push({a,b,x,wait:w[0].dt/rate(),t:(w[0].dt+x.tTr)/rate()});
    }));
    if(!c.length) return false;
    const fit=c.filter(o=>o.t<=slot&&o.wait>=3);
    const o=fit.length?fit[Math.floor(rnd()*fit.length)]:c.sort((p,q)=>p.t-q.t)[0];
    source=o.a; target=o.b; xfer=o.x;
    launchWindows=computeWindows(source,target,xfer,simTime);
    tLaunch=simTime+launchWindows[0].dt;
    plate();
    return true;
  }
  // The shell's label plate: the pair, the burns as parameters, and the
  // page's own TeX (typeset.mjs) for the equations. The page colours by hex
  // in typeset.mjs; the plate uses the nearest sci.css class: r m1, a m2,
  // v m3, phi and omega m4, mu and t m5, Delta v m6. eq is the plain fallback.
  function plate(){
    if(!opts||typeof opts.label!=='function') return;
    const x=xfer, k=v=>(v*AU2KMS).toFixed(2);
    opts.label({
      title:`${source.name} \u2192 ${target.name}`,
      sub:`Hohmann transfer, ${x.asc?'outward':'inward'}`,
      params:[
        {sym:'r_1 \\to r_2',name:'orbit radii',value:`${x.r1.toFixed(2)} \u2192 ${x.r2.toFixed(2)} AU`,cls:'m1'},
        {sym:'\\Delta v_1',name:'first burn',value:`${k(x.dv1)} km/s`,cls:'m6'},
        {sym:'\\Delta v_2',name:'second burn',value:`${k(x.dv2)} km/s`,cls:'m6'},
        {sym:'t_{\\mathrm{tr}}',name:'coast',value:`${(x.tTr*365.25).toFixed(0)} days`,cls:'m5'},
      ],
      lines:[`Total \u0394v ${k(x.dvTot)} km/s, two burns at the apsides.`],
      tex:['v = \\sqrt{\\mu\\left(\\frac{2}{r} - \\frac{1}{a}\\right)}',
           '\\Delta v_1 = \\big|\\,v_t(r_1) - v_c(r_1)\\,\\big|',
           'a_t = \\frac{r_1 + r_2}{2}, \\qquad t_{\\mathrm{tr}} = \\pi\\sqrt{\\frac{a_t^{3}}{\\mu}}',
           '\\varphi_{\\mathrm{req}} = \\pi - \\omega_{\\mathrm{tgt}}\\,t_{\\mathrm{tr}}'],
      rules:[['\\Delta v_1','m6'],['\\Delta v_2','m6'],['v','m3'],['r','m1'],['a','m2'],['\\mu','m5'],
             ['t_{\\mathrm{tr}}','m5'],['\\varphi_{\\mathrm{req}}','m4'],['\\omega_{\\mathrm{tgt}}','m4']],
      eq:['v = \u221a(\u03bc (2/r \u2212 1/a))','a\u209c = (r\u2081 + r\u2082) / 2',
          '\u0394v = |v(transfer) \u2212 v(circular)|','t = \u03c0 \u221a(a\u209c\u00b3 / \u03bc)'],
      anchor:xferAnchor,
    });
  }
  // The transfer on screen, in window px (the canvas fills the window in
  // saver mode). The centre is the Sun (CX, CY), the radius is the larger
  // orbit (r2 or r1 times SCALE), and the key points are the Sun, the two
  // planets (pPos) and the ship when it flies.
  function xferAnchor(){
    if(!source||!target||!xfer) return null;
    const pts=[{x:CX,y:CY},pPos(source),pPos(target)];
    if(ship&&isFinite(ship.x)&&isFinite(ship.y)) pts.push({x:ship.x,y:ship.y});
    return {x:CX,y:CY,r:Math.max(xfer.r1,xfer.r2)*SCALE+6,pts};
  }
  system(PRESETS[pi]);
  const ofr=frame;
  frame=function(now){
    ofr(now);
    const t=performance.now(), age=(t-tPhase)/1000;
    if(phase==='pick'&&age>1.5){ if(pick()){phase='wait';tPhase=t;} }
    else if(phase==='wait'&&simTime>=tLaunch){ launch(); launchScore=null; phase='fly'; tPhase=t; }
    else if(phase==='fly'&&ship&&ship.arrived){ phase='hold'; tPhase=t; }
    else if(phase==='hold'&&age>4){ phase='out'; tPhase=t; fadeTo=1; }
    else if(phase==='out'&&fade>=1){
      done++;
      if(done%2===0){ pi=(pi+1)%PRESETS.length; system(PRESETS[pi]); } else clearSel();
      phase='pick'; tPhase=t; fadeTo=0;
    }
    // In-scene fade to black, so the recording holds it too.
    const step=1/60/1.2; fade=fadeTo>fade?Math.min(fadeTo,fade+step):Math.max(fadeTo,fade-step);
    if(fade>0){ ctx.fillStyle=`rgba(6,8,16,${fade})`; ctx.fillRect(0,0,W,H); }
  };
  return {canvas:cvs,warmupMs:1500};
}};
