// ============================================================================
//  BLACK HOLE  ·  Schwarzschild geodesic ray tracer (raw WebGL 2)
// ----------------------------------------------------------------------------
//  This is the host for one fragment shader that bends light around a black
//  hole. There is no Three.js here: the file fetches the shader source, compiles
//  a single program, binds a fullscreen quad, and each frame writes the camera
//  and physics parameters into uniforms before one draw call. All rendering is
//  in raytracer.frag.glsl; this file is camera control, UI wiring, and the loop.
//
//  RENDER PIPELINE
//  ---------------
//      fetch .glsl ─▶ compile VS+FS ─▶ link program ─▶ bind quad (a_pos)
//                                                            │
//      frame(): orbit camera ─▶ build camera basis ─▶ set uniforms ─▶ drawArrays
//                                                            │
//                                                            ▼
//                                                   fragment shader per pixel
//                                                            │
//                                                            ▼
//                                                        <canvas id="c">
//
//  CAMERA  (orbit around the origin, spherical to Cartesian each frame)
//  --------------------------------------------------------------------
//      camYaw / camPitch / camRadius ─▶ (cx, cy, cz) position
//      fwd = -normalize(pos) ; right = fwd x up ; up = right x fwd
//      the basis is written to u_camFwd / u_camRight / u_camUp
//      u_focalLen = FOCAL_PER_H x canvas height, so the field of view does
//      not change when render-scale changes the canvas size
//
//  UNITS
//      Everything is in SI meters. RS is the Schwarzschild radius of a
//      4.3e6 solar-mass hole (Sagittarius A*). Zoom and step size scale
//      with camRadius so the look holds at any distance.
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  --------------------------------------------------------------------
//      shader fetch ......... "const VS ="            load .glsl before compile
//      gl + program ......... "canvas.getContext"     context, compile, link
//      fullscreen quad ...... "const buf="            the 4-vertex strip
//      uniform locations .... "const U={}"            cache uniform handles
//      physics constants .... "const CC="             RS, camera, step budget
//      spin control ......... "function pauseSpin"    idle auto-spin logic
//      quality .............. "window.setQuality"     step-count presets
//      warning gate ......... "window.dismissWarn"    reveal UI after warning
//      pointer input ........ "let dragging"          mouse, touch, wheel
//      keyboard ............. "keydown"               arrow-key orbit
//      toggles .............. "function setBtn"       geodesic, RK4, disc, Doppler, bg
//      disc constants ....... "const DISC_IN="        ISCO, outer edge, T0, clock
//      resize ............... "RenderScale.create"    pixel budget + fps control
//      frame loop ........... "function frame"        camera basis + uniforms
//      screensaver hook ..... "window.snSaver"        UI off, sharper, slow orbit
//      equations ............ "function renderEqs"    MathJax metric + EFE
// ============================================================================
(async () => {
// Fetch both shader stages as text before compiling anything, so the rest of
// init runs in a single synchronous pass.
const VS = await (await fetch(new URL('shaders/raytracer.vert.glsl', document.baseURI))).text();

const FS = await (await fetch(new URL('shaders/raytracer.frag.glsl', document.baseURI))).text();


// Get a WebGL 2 context (required for #version 300 es). Bail with a message if
// the device cannot provide one.
const canvas=document.getElementById('c');
const gl=canvas.getContext('webgl2',{antialias:false,alpha:false,powerPreference:'high-performance'});
if(!gl){document.body.innerHTML='<h1 style="color:red;padding:2em">WebGL 2 required</h1>';throw '';}
// The tab shell removes this iframe on a page swap. Drop the context so the
// browser does not run out of live WebGL contexts during heavy swapping.
window.addEventListener('pagehide',function(){try{if(gl)gl.getExtension('WEBGL_lose_context').loseContext();}catch(e){}});
// Compile one shader stage; log and return null on a compile error.
function compile(src,type){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){console.error(gl.getShaderInfoLog(s));return null;}return s;}
// Build the program: compile both stages, force a_pos to location 0, then link.
const vs=compile(VS,gl.VERTEX_SHADER),fs=compile(FS,gl.FRAGMENT_SHADER);
const prog=gl.createProgram();gl.attachShader(prog,vs);gl.attachShader(prog,fs);
gl.bindAttribLocation(prog,0,'a_pos');gl.linkProgram(prog);
if(!gl.getProgramParameter(prog,gl.LINK_STATUS))console.error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);
// One static buffer holding the four clip-space corners of the fullscreen quad,
// drawn later as a TRIANGLE_STRIP into attribute location 0.
const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);
gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);

// Cache every uniform location once, keyed by name, for cheap per-frame updates.
const U={};
['u_res','u_camPos','u_camFwd','u_camRight','u_camUp','u_focalLen','u_rs','u_discInner','u_discOuter',
 'u_geodesicDl','u_maxSteps','u_escapeR','u_useGeodesic','u_useRK4','u_showDisc','u_bgMode',
 'u_time','u_discTemp','u_doppler'
].forEach(n=>U[n]=gl.getUniformLocation(prog,n));

// Physics constants and derived Schwarzschild radius. RS is computed from c, G,
// and the mass of Sagittarius A* (4.3e6 solar masses), so all scene distances
// below are multiples of a real horizon radius.
const CC=2.99792458e8,GR=6.67430e-11,RS=2.0*GR*4.3e6*1.989e30/(CC*CC);
// Orbit-camera state: yaw, pitch, and distance out from the hole in meters.
let camYaw=0,camPitch=0.15,camRadius=32*RS;
// Focal length in canvas heights: 1.0 gives a vertical half-angle of 26.6
// degrees at any render size. It was a fixed 700 px, so a 4K canvas
// (1536x864) saw a much wider view than a 1080p one (768x432).
const FOCAL_PER_H=1.0;
// Integrator toggles, mirrored to the u_useGeodesic / u_useRK4 / u_showDisc uniforms.
// RK4 is the default: its step grows with r in the shader, so it is about 5x
// faster than fixed-step Euler and closer to the true path.
let useGeodesic=true,useRK4=true,showDisc=true;
let bgMode=0;
// Accretion disc: inner edge at the ISCO (3 r_s), outer edge DISC_OUT r_s.
// DISC_T0 is the peak emitted temperature in K (shadeDisc() in the shader).
// useDoppler 0 keeps only the gravitational part of the shift g. DISC_CLOCK
// converts seconds to the shader clock in r_s/c: the ISCO orbit lasts
// 2 pi sqrt(2 x 27) = 46 r_s/c, so 2.9 gives one inner turn in 16 s.
// The clock wraps at 17 x 588: a whole number of DISC_FLOW_P (17) periods.
const DISC_IN=3.0,DISC_OUT=8.0,DISC_T0=4000,DISC_CLOCK=2.9;
let useDoppler=true;
// Base step size, step budget, and escape-radius multiplier; scaled by zoom in frame().
let geodesicDl=5e7*1.9*4.0,maxSteps=2048,escMul=35;
let autoSpin=true;
const SPIN_SPEED=0.0008;
let warnDismissed=false;
// Auto-spin resumes SPIN_RESUME_MS after the last user interaction, unless the
// user turned spin off entirely (spinEnabled).
var spinTimer=null;
var spinEnabled=true;
const SPIN_RESUME_MS=4000;
// Any interaction pauses auto-spin and arms a timer to resume it later.
function pauseSpin(){
  autoSpin=false;
  if(spinTimer)clearTimeout(spinTimer);
  if(spinEnabled){
    spinTimer=setTimeout(function(){autoSpin=true;},SPIN_RESUME_MS);
  }
  document.getElementById('hint').style.opacity='0';
}
// Spin button: master on/off for auto-spin, independent of the idle timer.
window.toggleSpin=function(){
  spinEnabled=!spinEnabled;
  var el=document.getElementById('btnSpin');
  el.classList.toggle('on',spinEnabled);
  el.classList.toggle('off',!spinEnabled);
  if(spinEnabled){autoSpin=true;}
  else{autoSpin=false;if(spinTimer){clearTimeout(spinTimer);spinTimer=null;}}
};
// Quality presets: each level sets the geodesic step budget (maxSteps). More
// steps means a more accurate bend at higher GPU cost.
var qualitySteps=[512,2048,4096];
var qualityLabels=['btnQLow','btnQMed','btnQHigh'];
var currentQuality=1;
window.setQuality=function(q){
  currentQuality=q;maxSteps=qualitySteps[q];renderScale.reset();
  qualityLabels.forEach(function(id,i){
    var el=document.getElementById(id);
    el.classList.toggle('on',i===q);el.classList.toggle('off',false);
  });
};

// The GPU-load warning gate: dismissing it hides the notice and reveals the
// control bars, so the heavy render only starts once the user has acknowledged it.
window.dismissWarn=function(){
  document.getElementById('gpuWarn').classList.add('hide');
  document.getElementById('ctrlWrap').style.display='flex';
  document.getElementById('bgBar').style.display='flex';
  document.getElementById('eqPanel').style.display='flex';
  warnDismissed=true;
};

// Pointer input: drag to orbit (updates yaw/pitch), tracked from the last mouse
// position. Pitch is clamped just short of the poles to avoid a flipped basis.
let dragging=false,lmx=0,lmy=0;

canvas.addEventListener('mousedown',function(e){dragging=true;lmx=e.clientX;lmy=e.clientY;pauseSpin();});
window.addEventListener('mouseup',function(){dragging=false;});
window.addEventListener('mousemove',function(e){if(!dragging)return;
  camYaw-=(e.clientX-lmx)*0.005;camPitch-=(e.clientY-lmy)*0.005;
  camPitch=Math.max(-Math.PI*0.49,Math.min(Math.PI*0.49,camPitch));
  lmx=e.clientX;lmy=e.clientY;});

// Touch input: one finger orbits, two fingers pinch to zoom (camRadius), mirrored
// into the zoom slider. Both radius and pitch are clamped to safe ranges.
canvas.addEventListener('touchstart',function(e){
  e.preventDefault();pauseSpin();
  if(e.touches.length===1){dragging=true;lmx=e.touches[0].clientX;lmy=e.touches[0].clientY;}
  if(e.touches.length===2){dragging=false;pinchDist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);}
},{passive:false});
var pinchDist=0;
canvas.addEventListener('touchmove',function(e){
  e.preventDefault();
  if(e.touches.length===1&&dragging){
    var t=e.touches[0];
    camYaw-=(t.clientX-lmx)*0.005;camPitch-=(t.clientY-lmy)*0.005;
    camPitch=Math.max(-Math.PI*0.49,Math.min(Math.PI*0.49,camPitch));
    lmx=t.clientX;lmy=t.clientY;
  }
  if(e.touches.length===2){
    var nd=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
    var ratio=pinchDist/nd;
    camRadius*=ratio;camRadius=Math.max(RS*5,Math.min(RS*200,camRadius));
    document.getElementById('zoomSlider').value=Math.round(camRadius/RS);
    document.getElementById('zoomVal').textContent=Math.round(camRadius/RS);
    pinchDist=nd;
  }
},{passive:false});
canvas.addEventListener('touchend',function(){dragging=false;});

// Wheel: multiplicative zoom on camRadius, clamped between 5 and 200 RS.
canvas.addEventListener('wheel',function(e){e.preventDefault();pauseSpin();
  camRadius*=e.deltaY>0?1.08:0.92;camRadius=Math.max(RS*5,Math.min(RS*200,camRadius));
  document.getElementById('zoomSlider').value=Math.round(camRadius/RS);
  document.getElementById('zoomVal').textContent=Math.round(camRadius/RS);},{passive:false});

// Arrow keys: nudge the orbit; up/down pitch clamped like the pointer path.
window.addEventListener('keydown',function(e){var s=0.05;pauseSpin();
  if(e.key==='ArrowLeft')camYaw+=s;if(e.key==='ArrowRight')camYaw-=s;
  if(e.key==='ArrowUp')camPitch=Math.min(camPitch+s,Math.PI*0.49);
  if(e.key==='ArrowDown')camPitch=Math.max(camPitch-s,-Math.PI*0.49);});

// Zoom slider: set camRadius directly in units of RS.
document.getElementById('zoomSlider').addEventListener('input',function(){
  camRadius=this.value*RS;document.getElementById('zoomVal').textContent=this.value;});

// Toggle buttons: flip a boolean and its on/off CSS class. Each drives one uniform.
function setBtn(id,on){var el=document.getElementById(id);el.classList.toggle('on',on);el.classList.toggle('off',!on);}
window.toggleGeodesic=function(){useGeodesic=!useGeodesic;setBtn('btnGeodesic',useGeodesic);renderScale.reset();};
window.toggleRK4=function(){useRK4=!useRK4;setBtn('btnRK4',useRK4);renderScale.reset();};
window.toggleDisc=function(){showDisc=!showDisc;setBtn('btnDisc',showDisc);};
window.toggleDoppler=function(){useDoppler=!useDoppler;setBtn('btnDoppler',useDoppler);};
// Background selector: set bgMode and highlight the active icon (0..4).
window.setBg=function(m){
  bgMode=m;
  document.getElementById('bgStars').classList.toggle('active',m===0);
  document.getElementById('bgGrid').classList.toggle('active',m===1);
  document.getElementById('bgUV').classList.toggle('active',m===2);
  document.getElementById('bgNebula').classList.toggle('active',m===3);
  document.getElementById('bgRings').classList.toggle('active',m===4);
};
// Equations panel: collapse or expand the KaTeX overlay, swapping the button glyph.
window.toggleEqPanel=function(){
  var panel=document.getElementById('eqPanel');
  var btn=document.getElementById('eqToggleBtn');
  panel.classList.toggle('collapsed');
  btn.textContent=panel.classList.contains('collapsed')?'+':'−';
};

// Size the render target below native resolution: the per-pixel geodesic march is
// expensive, so the canvas renders at a fraction of the window (lower on mobile)
// and CSS scales it up. lib/render-scale.js also caps the pixel count and lowers
// it while the frame rate is low. This is the main performance lever.
var renderScale=RenderScale.create({canvas:canvas,gl:gl,label:document.getElementById('res'),
  fracDesktop:0.4,fracMobile:0.25,mobileWidth:600});
window.addEventListener('resize',renderScale.resize);renderScale.resize();

// The per-frame loop: advance auto-spin, rebuild the camera basis from the orbit
// angles, scale the step parameters by zoom, push everything to uniforms, and
// issue one draw call. A twice-per-second sampler updates the FPS readout.
var frames=0,lastT=performance.now();
function frame(){
  var now=performance.now();frames++;renderScale.tick(now);
  if(now-lastT>500){document.getElementById('fps').textContent=Math.round(frames/((now-lastT)/1000))+' fps';frames=0;lastT=now;}

  if(autoSpin) camYaw-=SPIN_SPEED;

  // Camera position from spherical orbit angles; forward points back at the hole.
  var cx=camRadius*Math.cos(camPitch)*Math.cos(camYaw),cy=camRadius*Math.sin(camPitch),cz=camRadius*Math.cos(camPitch)*Math.sin(camYaw);
  var fl=Math.sqrt(cx*cx+cy*cy+cz*cz),fwd=[-cx/fl,-cy/fl,-cz/fl];
  // Right and up complete an orthonormal basis; the rl guard handles a top-down view.
  var rl=Math.sqrt(fwd[2]*fwd[2]+fwd[0]*fwd[0]);
  var right=rl>1e-6?[fwd[2]/rl,0,-fwd[0]/rl]:[1,0,0];
  var up=[fwd[1]*right[2]-fwd[2]*right[1],fwd[2]*right[0]-fwd[0]*right[2],fwd[0]*right[1]-fwd[1]*right[0]];
  // Scale step size, step count, and escape radius with distance so the bend
  // looks consistent whether zoomed in close or far out. RK4 does not scale
  // dl or the budget below the default zoom (rkR): its steps already grow
  // with r, and a cut budget ends rays early, so the lensed far side of the
  // disc goes missing.
  var scaleR=camRadius/(32*RS),rkR=Math.max(scaleR,1),escR=escMul*scaleR;
  var dl=geodesicDl*(useRK4?rkR:scaleR),steps=Math.max(1,Math.round(maxSteps*(useRK4?rkR:scaleR)));
  document.getElementById('mode').textContent=useGeodesic?(useRK4?'Geodesic (RK4)':'Geodesic (Euler)'):'Straight rays';

  // Push camera, disc geometry, and integrator settings into the shader.
  gl.uniform2f(U.u_res,canvas.width,canvas.height);
  gl.uniform3f(U.u_camPos,cx,cy,cz);gl.uniform3f(U.u_camFwd,fwd[0],fwd[1],fwd[2]);
  gl.uniform3f(U.u_camRight,right[0],right[1],right[2]);gl.uniform3f(U.u_camUp,up[0],up[1],up[2]);
  gl.uniform1f(U.u_focalLen,FOCAL_PER_H*canvas.height);gl.uniform1f(U.u_rs,RS);
  gl.uniform1f(U.u_discInner,DISC_IN*RS);gl.uniform1f(U.u_discOuter,DISC_OUT*RS);
  gl.uniform1f(U.u_time,(now/1000)*DISC_CLOCK%(17*588));gl.uniform1f(U.u_discTemp,DISC_T0);
  gl.uniform1f(U.u_doppler,useDoppler?1:0);
  gl.uniform1f(U.u_geodesicDl,dl);gl.uniform1f(U.u_maxSteps,steps);gl.uniform1f(U.u_escapeR,escR);
  gl.uniform1f(U.u_useGeodesic,useGeodesic?1:0);gl.uniform1f(U.u_useRK4,useRK4?1:0);
  gl.uniform1f(U.u_showDisc,showDisc?1:0);gl.uniform1f(U.u_bgMode,bgMode);
  // One draw call renders the whole frame through the fragment shader.
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  requestAnimationFrame(frame);
}

// When embedded in the site shell's iframe, add .in-frame so CSS hides the local
// chrome the shell already provides. Then start the loop.
if(window.self!==window.top)document.body.classList.add('in-frame');
frame();

// ─── Screensaver hook (stella-nova/lib/screensaver.js) ───
// The shell calls enter() in screensaver mode. It hides the UI, swaps in a
// sharper render scale (0.75 of the window, 2 Mpx budget, still fps-capped),
// and replaces the idle spin with a slower yaw orbit and a gentle pitch sway.
// It also puts the metric, the geodesic equations and r_s on the label plate.
window.snSaver={
  raf:0,
  enter:function(opts){
    var calm=Math.max(0,Math.min(1,opts&&opts.calm!=null?opts.calm:0.7));
    var st=document.createElement('style');
    st.textContent='#gpuWarn,.hud,.stats,#hint,#eqPanel,#bgBar,#ctrlWrap{display:none!important}canvas{cursor:none}';
    document.head.appendChild(st);
    window.removeEventListener('resize',renderScale.resize);
    renderScale=RenderScale.create({canvas:canvas,gl:gl,fracDesktop:0.75,fracMobile:0.5,mobileWidth:600,maxPixels:2.0e6});
    window.addEventListener('resize',renderScale.resize);renderScale.resize();
    spinEnabled=false;autoSpin=false;if(spinTimer){clearTimeout(spinTimer);spinTimer=null;}
    camYaw=(((opts&&opts.seed)||0)%628)/100;
    var yawRate=0.048*(1.3-0.8*calm);   // rad/s; the page idles at 0.048
    var last=0,ph=0,self=this;
    function step(now){
      var dt=last?Math.min(0.1,(now-last)/1000):0;last=now;
      camYaw-=dt*yawRate;
      ph+=dt*Math.PI*2/(60+60*calm);    // one pitch sway per 1-2 minutes
      camPitch=0.15+0.12*Math.sin(ph);
      self.raf=requestAnimationFrame(step);
    }
    this.raf=requestAnimationFrame(step);
    // The plate (opts.label) names the metric, the geodesic equations that
    // gRHS() in raytracer.frag.glsl integrates, and the live values that
    // frame() pushes as uniforms: r_s (u_rs), the camera radius and pitch,
    // the disc edges (u_discInner, u_discOuter) and the step budget.
    var label=opts&&opts.labels!==false&&typeof opts.label==='function'?opts.label:null;
    function sci(v){var e=Math.floor(Math.log10(Math.abs(v))),m=v/Math.pow(10,e),SUP='⁰¹²³⁴⁵⁶⁷⁸⁹';
      return m.toFixed(2)+' × 10'+String(e).replace('-','⁻').replace(/[0-9]/g,function(d){return SUP[+d];});}
    function plate(){
      if(!label)return;
      var scaleR=camRadius/(32*RS),rkR=Math.max(scaleR,1),k=useRK4?rkR:scaleR;
      var steps=Math.max(1,Math.round(maxSteps*k));
      // Parameters, the page's TeX and its EQ_RULES (r_s m2, r m3, g m1,
      // T m4, R m5). eq is the plain fallback.
      label({title:'Schwarzschild black hole',sub:'Sgr A* mass, null geodesics, '+(useGeodesic?(useRK4?'RK4':'Euler'):'straight rays'),
        params:[{sym:'r_s',name:'horizon',value:sci(RS)+' m',cls:'m2'},
          {sym:'r',name:'camera',value:(camRadius/RS).toFixed(1)+' rₛ · pitch '+(camPitch*180/Math.PI).toFixed(1)+'°',cls:'m3'},
          {sym:'r_{\\text{disc}}',name:'accretion disc',value:DISC_IN.toFixed(1)+' – '+DISC_OUT.toFixed(1)+' rₛ',cls:'m3'},
          {sym:'N',name:'steps per ray',value:String(steps)}],
        lines:['M = 4.3 × 10⁶ solar masses. The photon sphere is at 1.5 rₛ, the disc inner edge at the ISCO (3 rₛ).',
          'Disc colour: a blackbody at g T, with g the gravitational and Doppler shift'+(useDoppler?'.':' (Doppler off).')],
        tex:['ds^2 = -\\left(1 - \\tfrac{r_s}{r}\\right)c^2\\,dt^2 + \\frac{dr^2}{1 - r_s/r} + r^2\\,d\\Omega^2',
          '\\ddot\\varphi = -\\frac{2\\,\\dot r\\,\\dot\\varphi}{r}, \\qquad \\dot t = \\frac{E}{1 - r_s/r}',
          'R_{\\mu\\nu} - \\tfrac{1}{2}g_{\\mu\\nu}R = \\frac{8\\pi G}{c^4}T_{\\mu\\nu}',
          'g = \\frac{\\sqrt{1 - 3r_s/2r}}{1 - \\Omega\\lambda/c}, \\quad \\Omega = \\sqrt{\\tfrac{r_s c^2}{2r^3}}, \\quad T \\propto r^{-3/4}\\big(1 - \\sqrt{r_{\\text{in}}/r}\\big)^{1/4}'],
        rules:EQ_RULES,
        eq:['ds² = −f c²dt² + dr²/f + r²dΩ²',
          'r̈ = −(r_s/2r²)fṫ² + (r_s/2r²f)ṙ² + (r−r_s)φ̇²',
          'φ̈ = −2ṙφ̇/r,   ṫ = E/f,   f = 1 − r_s/r',
          'g = √(1 − 3r_s/2r) / (1 − Ωλ/c),   T ∝ r^(−3/4) (1 − √(r_in/r))^(1/4)'],
        anchor:holeAnchor});
    }
    // The hole on screen. The canvas fills the window, the camera looks at
    // the hole, and the image plane is FOCAL_PER_H x height away, so a point
    // at distance d beside the axis lands f d / camRadius px from the centre
    // (f = canvas CSS height). The radius holds the disc outer edge (5.1 r_s)
    // plus 20 percent for the lensed far side. The key point is the centre.
    function holeAnchor(){
      var b=canvas.getBoundingClientRect(),f=FOCAL_PER_H*b.height,cx=b.left+b.width/2,cy=b.top+b.height/2;
      return {x:cx,y:cy,r:1.2*f*DISC_OUT*RS/camRadius,pts:[{x:cx,y:cy}]};
    }
    plate();
    if(label)this.timer=setInterval(plate,1000);
    return {canvas:canvas,warmupMs:1500};
  },
  exit:function(){cancelAnimationFrame(this.raf);clearInterval(this.timer);}
};

// ─── Equations ───
// The [data-tex] boxes in index.html hold the TeX. lib/sci-math.js typesets
// them as MathJax SVG. Each quantity has one math color class (lib/sci.css):
//   g_{\mu\nu} metric -> m1, r_s Schwarzschild radius -> m2, r -> m3,
//   T_{\mu\nu} stress-energy -> m4, R_{\mu\nu} and R curvature -> m5.
// G, c, pi and the numbers stay the default color.
var EQ_RULES=[['g_{\\mu\\nu}','m1'],['r_s','m2'],['r','m3'],['T_{\\mu\\nu}','m4'],['R_{\\mu\\nu}','m5'],['R','m5']];
function renderEqs(){
  import(new URL('../../lib/sci-math.js',document.baseURI).href).then(function(m){
    m.typesetAll(document.getElementById('eqPanel'),EQ_RULES);
    // The zoom slider sets the camera distance in units of r_s.
    m.typesetAll(document.getElementById('ctrlWrap'),EQ_RULES);
  });
}
renderEqs();
})();
