(async () => {
const VS = await (await fetch(new URL('shaders/refraction.vert.glsl', document.baseURI))).text();
const FS = await (await fetch(new URL('shaders/refraction.frag.glsl', document.baseURI))).text();
const canvas=document.getElementById('gl');
const gl=canvas.getContext('webgl2',{alpha:false,antialias:false});
if(!gl){document.body.innerHTML='<p style="color:#fff;padding:2em">WebGL 2 required</p>';throw 0;}

const DEFS=[
  {k:'zoom',     l:'Zoom',     min:1.5, max:14,  step:.05, def:4,     sec:'Camera'},
  {k:'fov',      l:'FOV',      min:.2,  max:2.5, step:.01, def:.7},
  {k:'height',   l:'Height',   min:.01, max:.49, step:.005,def:.35},
  {k:'spin',     l:'Spin',     min:0,   max:2,   step:.01, def:.12},
  {k:'curvature',l:'Curvature',min:.01, max:1.5, step:.01, def:.5,    sec:'Shape'},
  {k:'ior',      l:'IOR',      min:1,   max:3,   step:.01, def:1.33,  sec:'Optics'},
  {k:'fresnel',  l:'Fresnel',  min:.3,  max:12,  step:.1,  def:5},
  {k:'fresnelIn',l:'Inner Fr', min:.3,  max:5,   step:.05, def:1.3},
  {k:'lightAng', l:'Angle',    min:0,   max:6.28,step:.01, def:.5,    sec:'Light'},
  {k:'ambient',  l:'Ambient',  min:0,   max:3,   step:.05, def:1},
  {k:'diffuse',  l:'Diffuse',  min:0,   max:3,   step:.05, def:1},
  {k:'accent',   l:'Accent',   min:0,   max:8,   step:.1,  def:3},
  {k:'cPhase',   l:'Phase',    min:0,   max:6.28,step:.01, def:0,     sec:'Color'},
  {k:'cSat',     l:'Saturate', min:.1,  max:3,   step:.05, def:1},
  {k:'cFreq',    l:'Frequency',min:.2,  max:3,   step:.05, def:1},
  {k:'edgeFade', l:'Edge',     min:.005,max:.4,  step:.005,def:.075},
];
const RAND_RANGES={zoom:[2.5,8],fov:[.3,1.6],height:[.05,.48],spin:[0,1.2],curvature:[.05,1.4],ior:[1,2.5],fresnel:[.5,10],fresnelIn:[.5,4],lightAng:[0,6.28],ambient:[.2,2.5],diffuse:[.2,2.5],accent:[0,6],cPhase:[0,6.28],cSat:[.2,2.5],cFreq:[.3,2.5],edgeFade:[.01,.25]};

const P={};const sliders={};
DEFS.forEach(d=>P[d.k]=d.def);
let animShape=false,animColor=false;

const ui=document.getElementById('ui');
(function buildUI(){
  DEFS.forEach(d=>{
    if(d.sec){const h=document.createElement('div');h.className='sec';h.textContent=d.sec;ui.appendChild(h);}
    const row=document.createElement('div');row.className='s-row';
    const lbl=document.createElement('span');lbl.className='s-lbl';lbl.textContent=d.l;
    const inp=document.createElement('input');inp.type='range';inp.min=d.min;inp.max=d.max;inp.step=d.step;inp.value=d.def;
    const val=document.createElement('span');val.className='s-val';val.textContent=d.def.toFixed(2);
    row.append(lbl,inp,val);ui.appendChild(row);
    sliders[d.k]={inp,val};
    inp.addEventListener('input',()=>{P[d.k]=parseFloat(inp.value);val.textContent=P[d.k].toFixed(2);});
  });
  const dv1=document.createElement('div');dv1.className='divider';ui.appendChild(dv1);
  const tsec=document.createElement('div');tsec.className='t-section';
  [{k:'animShape',l:'Anim Shape'},{k:'animColor',l:'Anim Color'}].forEach(t=>{
    const item=document.createElement('div');item.className='t-item';
    const lb=document.createElement('span');lb.className='t-lbl';lb.textContent=t.l;
    const tog=document.createElement('div');tog.className='tog';
    tog.addEventListener('click',()=>{
      if(t.k==='animShape')animShape=!animShape,tog.classList.toggle('on',animShape);
      else animColor=!animColor,tog.classList.toggle('on',animColor);});
    item.append(lb,tog);tsec.appendChild(item);});
  ui.appendChild(tsec);
  const dv2=document.createElement('div');dv2.className='divider';ui.appendChild(dv2);
  const btn=document.createElement('button');btn.id='rand-btn';btn.textContent='Randomize';
  btn.addEventListener('click',randomize);ui.appendChild(btn);
  const fps=document.createElement('div');fps.id='fps';ui.appendChild(fps);
})();

function syncSlider(k){const s=sliders[k];if(s){s.inp.value=P[k];s.val.textContent=P[k].toFixed(2);}}
document.getElementById('toggle-btn').addEventListener('click',()=>ui.classList.toggle('hidden'));

let rAnim=null;
function randF(a,b){return a+Math.random()*(b-a);}
function easeIO(t){return t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;}
function randomize(){const from={},to={};for(const k in RAND_RANGES){from[k]=P[k];to[k]=randF(RAND_RANGES[k][0],RAND_RANGES[k][1]);}rAnim={from,to,start:performance.now(),dur:900};}
function tickRand(now){if(!rAnim)return;const t=Math.min(1,(now-rAnim.start)/rAnim.dur),e=easeIO(t);for(const k in rAnim.to){P[k]=rAnim.from[k]+(rAnim.to[k]-rAnim.from[k])*e;syncSlider(k);}if(t>=1)rAnim=null;}

let mx=0,my=0,mUsed=false;
canvas.addEventListener('mousedown',e=>{mUsed=true;mx=e.clientX;my=e.clientY;});
canvas.addEventListener('mousemove',e=>{if(e.buttons&1){mUsed=true;mx=e.clientX;my=e.clientY;}});
canvas.addEventListener('touchstart',e=>{e.preventDefault();mUsed=true;mx=e.touches[0].clientX;my=e.touches[0].clientY;},{passive:false});
canvas.addEventListener('touchmove',e=>{e.preventDefault();mx=e.touches[0].clientX;my=e.touches[0].clientY;},{passive:false});
canvas.addEventListener('wheel',e=>{e.preventDefault();P.zoom=Math.max(1.5,Math.min(14,P.zoom+e.deltaY*.008));syncSlider('zoom');},{passive:false});


function mkS(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){console.error(gl.getShaderInfoLog(s));return null;}return s;}
let prog=null,uL={};
function build(){if(prog)gl.deleteProgram(prog);const vs=mkS(gl.VERTEX_SHADER,VS),fs=mkS(gl.FRAGMENT_SHADER,FS);if(!vs||!fs)return;const p=gl.createProgram();gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);gl.deleteShader(vs);gl.deleteShader(fs);if(!gl.getProgramParameter(p,gl.LINK_STATUS)){console.error(gl.getProgramInfoLog(p));return;}prog=p;gl.useProgram(p);['iResolution','iTime','iMouse','u_zoom','u_fov','u_height','u_spin','u_curvature','u_ior','u_fresnel','u_fresnelIn','u_lightAng','u_ambient','u_diffuse','u_accent','u_cPhase','u_cSat','u_cFreq','u_edgeFade'].forEach(n=>uL[n]=gl.getUniformLocation(p,n));const a=gl.getAttribLocation(p,'a_pos');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);}
const quad=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,quad);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
build();

function sst(e0,e1,x){const t=Math.max(0,Math.min(1,(x-e0)/(e1-e0)));return t*t*(3-2*t);}
function fmod(a,b){return a-b*Math.floor(a/b);}
const t0=performance.now()/1000;let frames=0,lastFps=performance.now(),fpsVal=0;

function frame(now){
  requestAnimationFrame(frame);tickRand(now);
  const dpr=Math.min(devicePixelRatio||1,2);
  const w=canvas.clientWidth*dpr|0,h=canvas.clientHeight*dpr|0;
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  if(!prog)return;const time=now/1000-t0;
  let curv=P.curvature;if(animShape){const tm=fmod((time+53)*.44,20);curv=.001+1.5-1.5*sst(0,8.5,tm)*(1-sst(10,18.5,tm));}
  let cShift=P.cPhase;if(animColor)cShift+=.072*time;
  gl.viewport(0,0,w,h);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(prog);
  gl.uniform3f(uL.iResolution,w,h,1);gl.uniform1f(uL.iTime,time);
  gl.uniform4f(uL.iMouse,mUsed?mx*(w/canvas.clientWidth):0,mUsed?(canvas.clientHeight-my)*(h/canvas.clientHeight):0,0,0);
  gl.uniform1f(uL.u_zoom,P.zoom);gl.uniform1f(uL.u_fov,P.fov);gl.uniform1f(uL.u_height,P.height);gl.uniform1f(uL.u_spin,P.spin);gl.uniform1f(uL.u_curvature,curv);
  gl.uniform1f(uL.u_ior,P.ior);gl.uniform1f(uL.u_fresnel,P.fresnel);gl.uniform1f(uL.u_fresnelIn,P.fresnelIn);
  gl.uniform1f(uL.u_lightAng,P.lightAng);gl.uniform1f(uL.u_ambient,P.ambient);gl.uniform1f(uL.u_diffuse,P.diffuse);gl.uniform1f(uL.u_accent,P.accent);
  gl.uniform1f(uL.u_cPhase,cShift);gl.uniform1f(uL.u_cSat,P.cSat);gl.uniform1f(uL.u_cFreq,P.cFreq);gl.uniform1f(uL.u_edgeFade,P.edgeFade);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  frames++;if(now-lastFps>=500){fpsVal=frames/((now-lastFps)/1000)|0;frames=0;lastFps=now;document.getElementById('fps').textContent=fpsVal+' fps';}
}
requestAnimationFrame(frame);
})();
