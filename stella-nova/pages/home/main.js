// ============================================================================
//  HOME  ·  the Stella Nova landing page behavior
// ----------------------------------------------------------------------------
//  Four independent pieces drive the page:
//    1. a bug-report form that POSTs to a form email endpoint
//    2. an image carousel for the gameplay gallery
//    3. a full-screen background N-body gravity simulation
//    4. a hero "radar" that sweeps a stylized solar system
//  plus a reveal-on-scroll observer for the content sections.
//
//  BACKGROUND SIM  (Barnes-Hut N-body, canvas #sim)
//  ---------------------------------------------------------------------------
//  Naive gravity is O(n^2). This builds a quadtree each frame and treats a
//  distant cluster as one mass at its center, giving O(n log n).
//
//      root square over all bodies          per body, walk the tree:
//      ┌───────┬───────┐                       if a node is far enough
//      │   ·   │  · ·   │                       (node.w / dist < THETA)
//      │       ├───┬───┤   subdivide only         use its center of mass
//      ├───────┤ · │   │   where bodies land    else recurse into children
//      │  ·  · │───┼───┤                        leaf holds one body
//      └───────┴───┴───┘
//      buildTree ─▶ calcForce ─▶ integrate (vel, pos) ─▶ renderSim
//
//  HERO RADAR  (canvas #heroRadar)
//  ---------------------------------------------------------------------------
//  A fake solar system in polar coordinates: planets on circular orbits, a
//  sweeping radar line, and a ping that flares each planet as the line passes.
//      x = cx + cos(phase + omega*t) * dist * scale     (y with sin)
//      orbit period scales as T^1 for angular speed; dist as T^(2/3) (Kepler)
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  ---------------------------------------------------------------------------
//      bug form ............. "function submitBug"   POST the report
//      carousel ............. "var cur=0"            gallery slider IIFE
//      canvas helpers ....... "function initCanvas"  get + size a canvas
//      sim state ............ "const simCV"          bodies + toggles + constants
//      Body ................. "class Body"           one gravitating mass
//      quadtree ............. "class QTNode"         Barnes-Hut tree node
//      build tree ........... "function buildTree"   enclose bodies, insert all
//      spawn ................ "function spawnBody"   add bodies and clusters
//      step ................. "function stepSim"     one physics tick
//      render sim ........... "function renderSim"   draw bodies, trails, tree
//      radar data ........... "const heroCV"         planets, moons, asteroids
//      draw radar ........... "function drawRadar"   the hero solar system
//      resize ............... "function resize"      match canvases to window
//      sim toggles .......... "function toggleTree"  quadtree/trails/pause
//      drag to launch ....... "simCV.c.addEventListener"  fling a new body
//      loop ................. "function loop"        the per-frame driver
//      reveal on scroll ..... "const obs"            fade sections in
// ============================================================================
// Submit the bug report: build the form data, add subject and form-service
// flags, POST it, and swap the form for a success note (or re-enable on failure).
function submitBug(e) {
  e.preventDefault();
  const form = document.getElementById('bugForm');
  const data = new FormData(form);
  const btn = document.getElementById('bugSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Transmitting...';
  const severity = data.get('severity') || 'medium';
  const summary = data.get('summary') || 'Bug Report';
  data.append('_subject', '[Stella Nova Bug] [' + severity.toUpperCase() + '] ' + summary);
  data.append('_captcha', 'false');
  data.append('_template', 'box');
  fetch('https://formsubmit.co/ajax/dave@davesgames.io', {method:'POST',body:data})
  .then(r => r.json())
  .then(res => {if(res.success){document.getElementById('bugSuccess').classList.add('show');form.style.display='none'}else{btn.disabled=false;btn.textContent='Transmit Report';alert('Transmission failed. Try again or report on Discord.')}})
  .catch(() => {btn.disabled=false;btn.textContent='Transmit Report';alert('Transmission failed. Try again or report on Discord.')});
}

// Gallery carousel: a self-contained slider over the .nv-slide track. cur is the
// index; render() slides the track and syncs the pips and counter; auto-advance
// runs on a timer that resets on manual navigation.
(function(){
  var cur=0,autoTimer=null;var track=document.getElementById('nvTrack');var slides=track?track.children:[];var total=slides.length;var fileEl=document.getElementById('nvFile');var pipsEl=document.getElementById('nvPips');var autoBtn=document.getElementById('nvAutoBtn');var viewer=document.getElementById('nvViewer');
  // Zero-pad a slide number for the "01/06" readout.
  function pad(n){return n<10?'0'+n:''+n}
  // Move the track to the current slide and update the counter and active pip.
  function render(){if(!track)return;track.style.transform='translateX(-'+(cur*100)+'%)';if(fileEl)fileEl.textContent='IMG '+pad(cur+1)+'/'+pad(total);var pips=pipsEl?pipsEl.children:[];for(var i=0;i<pips.length;i++){pips[i].className='nv-pip'+(i===cur?' active':'')}}
  // Build one pip per slide, each jumping to its index.
  if(pipsEl){for(var i=0;i<total;i++){var p=document.createElement('button');p.className='nv-pip'+(i===0?' active':'');p.setAttribute('aria-label','Slide '+(i+1));(function(idx){p.onclick=function(){cur=idx;render();resetAuto()}})(i);pipsEl.appendChild(p)}}
  // Prev/next navigation, wrapping around the ends.
  window.nvNav=function(dir){cur=(cur+dir+total)%total;render();resetAuto()};
  // Toggle auto-advance on a 3.5s interval.
  window.nvToggleAuto=function(){if(autoTimer){clearInterval(autoTimer);autoTimer=null}else{autoTimer=setInterval(function(){cur=(cur+1)%total;render()},3500)}if(autoBtn)autoBtn.className='nv-auto'+(autoTimer?' on':'')};
  // Restart the auto timer after a manual move so it does not fire immediately.
  function resetAuto(){if(!autoTimer)return;clearInterval(autoTimer);autoTimer=setInterval(function(){cur=(cur+1)%total;render()},3500)}
  // Left/right arrow keys navigate when the viewer has focus.
  if(viewer){viewer.setAttribute('tabindex','0');viewer.addEventListener('keydown',function(e){if(e.key==='ArrowLeft'){window.nvNav(-1);e.preventDefault()}if(e.key==='ArrowRight'){window.nvNav(1);e.preventDefault()}})}
  render();
})();

// Device pixel ratio (capped at 2) and two-pi, shared by both canvases.
const dpr=Math.min(devicePixelRatio||1,2),TAU=Math.PI*2;
// Fetch a canvas and its 2D context as a small pair, or null if absent.
function initCanvas(id){const c=document.getElementById(id);if(!c)return null;return{c,ctx:c.getContext('2d')}}
// Size a canvas to w by h CSS pixels at device resolution, scaling the context.
function sizeCanvas(cv,w,h){cv.c.width=w*dpr;cv.c.height=h*dpr;cv.c.style.width=w+'px';cv.c.style.height=h+'px';cv.ctx.setTransform(dpr,0,0,dpr,0,0)}
// Background gravity sim state: the body list and the three view toggles.
const simCV=initCanvas('sim');let W,H,bodies=[],showTree=false,showTrails=false,paused=false;
// Sim tuning: gravity strength, Barnes-Hut opening angle, force softening (to
// avoid singularities at tiny distances), timestep, and trail length.
const G=800,THETA=0.5,SOFTENING=4,DT=0.016,MAX_TRAIL=40;
// One gravitating body: position, velocity, acceleration, mass. Radius grows as
// the cube root of mass; colour steps by mass so heavy bodies read brighter.
class Body{constructor(x,y,vx,vy,m){this.x=x;this.y=y;this.vx=vx;this.vy=vy;this.ax=0;this.ay=0;this.mass=m;this.radius=Math.pow(m,0.33)*0.8;this.trail=[];const t=Math.min(m/500,1);this.color=t>0.8?'#96c8ff':t>0.4?'#7090b0':t>0.15?'#4a6080':'#2a3850'}}
// Barnes-Hut quadtree node over a square region. It stores the total mass and
// center of mass of everything inside, so a far cluster can be treated as one
// point. insert() adds a body and subdivides on collision; calcForce()
// accumulates gravity on a body, recursing only into nodes that are too close.
class QTNode{constructor(x,y,w,h){this.x=x;this.y=y;this.w=w;this.h=h;this.mass=0;this.cx=0;this.cy=0;this.body=null;this.children=null;this.count=0}insert(b){if(b.x<this.x||b.x>this.x+this.w||b.y<this.y||b.y>this.y+this.h)return;if(this.count===0){this.body=b;this.mass=b.mass;this.cx=b.x;this.cy=b.y;this.count=1;return}if(!this.children){this.subdivide();const o=this.body;this.body=null;for(const c of this.children)c.insert(o)}for(const c of this.children)c.insert(b);const tm=this.mass+b.mass;this.cx=(this.cx*this.mass+b.x*b.mass)/tm;this.cy=(this.cy*this.mass+b.y*b.mass)/tm;this.mass=tm;this.count++}subdivide(){const hw=this.w/2,hh=this.h/2;this.children=[new QTNode(this.x,this.y,hw,hh),new QTNode(this.x+hw,this.y,hw,hh),new QTNode(this.x,this.y+hh,hw,hh),new QTNode(this.x+hw,this.y+hh,hw,hh)]}calcForce(b){if(this.count===0)return;if(this.count===1&&this.body===b)return;const dx=this.cx-b.x,dy=this.cy-b.y,dSq=dx*dx+dy*dy+SOFTENING*SOFTENING,d=Math.sqrt(dSq);if(this.count===1||this.w/d<THETA){const F=G*this.mass/dSq;b.ax+=F*dx/d;b.ay+=F*dy/d;return}if(this.children)for(const c of this.children)c.calcForce(b)}}
// Build the quadtree for the current frame: find the bounding box of all
// bodies, make a square root node that covers it, and insert every body.
function buildTree(){let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9;for(const b of bodies){if(b.x<minX)minX=b.x;if(b.x>maxX)maxX=b.x;if(b.y<minY)minY=b.y;if(b.y>maxY)maxY=b.y}const s=Math.max(maxX-minX,maxY-minY)+20;const r=new QTNode(minX-10,minY-10,s,s);for(const b of bodies)r.insert(b);return r}
// Recursively stroke the quadtree cells, for the Quadtree debug overlay.
function drawTree(n,ctx){if(!n||n.count===0)return;ctx.strokeStyle='rgba(150,200,255,0.04)';ctx.lineWidth=0.5;ctx.strokeRect(n.x,n.y,n.w,n.h);if(n.children)for(const c of n.children)drawTree(c,ctx)}
// Add one body with an optional velocity and mass (random mass by default).
function spawnBody(x,y,vx,vy,m){bodies.push(new Body(x,y,vx||0,vy||0,m||(5+Math.random()*60)))}
// Add a cluster: a heavy central mass plus n light bodies on near-circular
// orbits, each given the orbital speed sqrt(G*M/d) for its distance.
function addCluster(n){const cx=W*0.15+Math.random()*W*0.7,cy=H*0.15+Math.random()*H*0.7,r=80+Math.random()*100;spawnBody(cx,cy,0,0,300+Math.random()*400);for(let i=0;i<n;i++){const a=Math.random()*TAU,d=20+Math.random()*r,x=cx+Math.cos(a)*d,y=cy+Math.sin(a)*d;const sp=Math.sqrt(G*400/d)*(0.6+Math.random()*0.4);spawnBody(x,y,-Math.sin(a)*sp,Math.cos(a)*sp,3+Math.random()*30)}}
// Clear and reseed the sim with two clusters.
function resetSim(){bodies=[];addCluster(100);setTimeout(()=>addCluster(80),100)}
// The tree from the last step, kept so the overlay can draw it.
let lastTree=null;
// One physics tick: cull far-flung bodies, rebuild the tree, sum forces, then
// integrate velocity and position, nudge stragglers back, and record trails.
function stepSim(){if(paused)return;bodies=bodies.filter(b=>b.x>-1500&&b.x<W+1500&&b.y>-1500&&b.y<H+1500);if(bodies.length<2)return;lastTree=buildTree();for(const b of bodies){b.ax=0;b.ay=0}for(const b of bodies)lastTree.calcForce(b);for(const b of bodies){b.vx+=b.ax*DT;b.vy+=b.ay*DT;b.x+=b.vx*DT;b.y+=b.vy*DT;if(b.x<-200)b.vx+=2;if(b.x>W+200)b.vx-=2;if(b.y<-200)b.vy+=2;if(b.y>H+200)b.vy-=2;if(showTrails){b.trail.push({x:b.x,y:b.y});if(b.trail.length>MAX_TRAIL)b.trail.shift()}else if(b.trail.length)b.trail=[]}}
// Draw the sim: optional quadtree overlay, optional motion trails, each body as
// a glow plus a core disc, and the drag-to-launch aiming line.
function renderSim(){const ctx=simCV.ctx;ctx.clearRect(0,0,W,H);if(showTree&&lastTree)drawTree(lastTree,ctx);if(showTrails)for(const b of bodies){if(b.trail.length<2)continue;ctx.beginPath();ctx.moveTo(b.trail[0].x,b.trail[0].y);for(let i=1;i<b.trail.length;i++)ctx.lineTo(b.trail[i].x,b.trail[i].y);ctx.strokeStyle=b.color+'18';ctx.lineWidth=b.radius*0.5;ctx.stroke()}for(const b of bodies){const gr=ctx.createRadialGradient(b.x,b.y,0,b.x,b.y,b.radius*5);gr.addColorStop(0,b.color+'10');gr.addColorStop(1,'transparent');ctx.beginPath();ctx.arc(b.x,b.y,b.radius*5,0,TAU);ctx.fillStyle=gr;ctx.fill();ctx.beginPath();ctx.arc(b.x,b.y,b.radius,0,TAU);ctx.fillStyle=b.color;ctx.fill()}if(dragging&&dragStart&&dragCurrent){ctx.beginPath();ctx.moveTo(dragStart.x,dragStart.y);ctx.lineTo(dragCurrent.x,dragCurrent.y);ctx.strokeStyle='rgba(255,200,80,0.4)';ctx.lineWidth=1.5;ctx.setLineDash([4,4]);ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.arc(dragStart.x,dragStart.y,4,0,TAU);ctx.fillStyle='rgba(255,200,80,0.6)';ctx.fill()}}

// Hero radar canvas and its scene data.
const heroCV=initCanvas('heroRadar');
// Base orbital period in seconds; each planet's period is BASE_T * its T.
const BASE_T=16;
// The planets: relative period T, colour, radius, and moons. dist and omega are
// filled below from T; sizes are fractions of the canvas scale.
const planets=[{T:1,color:'#ffc832',r:0.02,moons:[{d:0.028,T:0.18,r:0.007}]},{T:2,color:'#ff8844',r:0.028,moons:[{d:0.03,T:0.22,r:0.006},{d:0.05,T:0.4,r:0.008}]},{T:4,color:'#ff5050',r:0.034,moons:[{d:0.035,T:0.3,r:0.006}]},{T:8,color:'#96c8ff',r:0.024,moons:[{d:0.03,T:0.24,r:0.006}]}];
// Kepler-flavoured setup: orbit distance scales as T^(2/3), angular speed omega
// as 1/T. Gives the outer planets slower, wider orbits.
planets.forEach(p=>{p.dist=0.27*Math.pow(p.T,2/3);p.omega=TAU/(BASE_T*p.T)});
// Hand-set starting angles so the planets do not all line up at t=0.
planets[0].phase=0;planets[1].phase=Math.PI*0.55;planets[2].phase=Math.PI*1.2;planets[3].phase=Math.PI*0.1;
// Moons get a random starting angle and their own angular speed.
planets.forEach(p=>p.moons.forEach(m=>{m.phase=Math.random()*TAU;m.omega=TAU/(BASE_T*m.T)}));
// An asteroid belt between planets 1 and 2, each rock on its own Kepler orbit.
const asteroids=[];const bi=planets[1].dist+0.02,bo=planets[2].dist-0.02;
for(let i=0;i<40;i++){const d=bi+Math.random()*(bo-bi);asteroids.push({dist:d,omega:TAU/(BASE_T*Math.pow(d/0.27,1.5)),phase:Math.random()*TAU,r:0.003+Math.random()*0.003})}
// Radar sweep angular speed: one full turn every 4 seconds.
const sweepSpeed=TAU/4;
// Draw the hero radar for time t: grid rings and spokes, the sweep line, orbit
// paths, asteroids, the sun, then each planet (with a ping when the sweep passes)
// and its moons. All positions are polar about the canvas center.
function drawRadar(ctx,W,H,t){const cx=W/2,cy=H/2,sc=Math.min(W,H)/2.4,sa=sweepSpeed*t;ctx.fillStyle='rgba(14,17,24,0.95)';ctx.fillRect(0,0,W,H);const maxR=planets[3].dist*sc*1.25;for(let i=1;i<=5;i++){const r=(i/5)*maxR;ctx.beginPath();ctx.arc(cx,cy,r,0,TAU);ctx.strokeStyle='rgba(150,200,255,0.025)';ctx.lineWidth=0.5;ctx.stroke()}for(let i=0;i<12;i++){const a=(i/12)*TAU;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(a)*maxR,cy+Math.sin(a)*maxR);ctx.strokeStyle='rgba(150,200,255,0.012)';ctx.lineWidth=0.3;ctx.stroke()}ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(sa)*maxR*1.2,cy+Math.sin(sa)*maxR*1.2);ctx.strokeStyle='rgba(150,200,255,0.2)';ctx.lineWidth=1;ctx.stroke();planets.forEach(p=>{const R=p.dist*sc;ctx.beginPath();ctx.setLineDash([1.5,5]);ctx.arc(cx,cy,R,0,TAU);ctx.strokeStyle='rgba(150,200,255,0.025)';ctx.lineWidth=0.4;ctx.stroke();ctx.setLineDash([])});asteroids.forEach(a=>{const ang=a.phase+a.omega*t;ctx.beginPath();ctx.arc(cx+Math.cos(ang)*a.dist*sc,cy+Math.sin(ang)*a.dist*sc,a.r*sc,0,TAU);ctx.fillStyle='rgba(150,200,255,0.05)';ctx.fill()});ctx.beginPath();ctx.arc(cx,cy,0.02*sc,0,TAU);ctx.fillStyle='rgba(255,200,80,0.2)';ctx.fill();planets.forEach(p=>{const a=p.phase+p.omega*t,px=cx+Math.cos(a)*p.dist*sc,py=cy+Math.sin(a)*p.dist*sc;let sd=(sa-a)%TAU;if(sd<0)sd+=TAU;const ping=sd<1.5?1-sd/1.5:0;if(ping>0){const pr=p.r*sc*(3+(1-ping)*5);ctx.beginPath();ctx.arc(px,py,pr,0,TAU);ctx.strokeStyle=`rgba(150,200,255,${ping*0.12})`;ctx.lineWidth=0.8;ctx.stroke()}const gl=ctx.createRadialGradient(px,py,0,px,py,p.r*sc*3);gl.addColorStop(0,p.color+'18');gl.addColorStop(1,'transparent');ctx.beginPath();ctx.arc(px,py,p.r*sc*3,0,TAU);ctx.fillStyle=gl;ctx.fill();ctx.beginPath();ctx.arc(px,py,p.r*sc,0,TAU);ctx.fillStyle=p.color;ctx.globalAlpha=0.5+ping*0.5;ctx.fill();ctx.globalAlpha=1;p.moons.forEach(m=>{const ma=m.phase+m.omega*t;ctx.beginPath();ctx.arc(px+Math.cos(ma)*m.d*sc,py+Math.sin(ma)*m.d*sc,m.r*sc,0,TAU);ctx.fillStyle='rgba(150,200,255,0.12)';ctx.fill()})})}

// Keep both full-screen canvases matched to the window.
function resize(){W=innerWidth;H=innerHeight;sizeCanvas(simCV,W,H);sizeCanvas(heroCV,W,H)}
resize();addEventListener('resize',resize);
// The three sim view toggles, each reflecting state on its button.
function toggleTree(){showTree=!showTree;document.getElementById('treeBtn').classList.toggle('active',showTree)}
function toggleTrails(){showTrails=!showTrails;document.getElementById('trailBtn').classList.toggle('active',showTrails)}
function togglePause(){paused=!paused;const b=document.getElementById('pauseBtn');b.classList.toggle('active',paused);b.textContent=paused?'Resume':'Pause'}
// Expose the sim controls to the inline onclick handlers in the markup.
window.resetSim=resetSim;window.addCluster=addCluster;window.toggleTree=toggleTree;window.toggleTrails=toggleTrails;window.togglePause=togglePause;
// Drag to launch: press sets the origin, release flings a new body with a
// velocity proportional to the drag vector (a slingshot).
let dragging=false,dragStart=null,dragCurrent=null;
simCV.c.addEventListener('mousedown',e=>{dragging=true;dragStart={x:e.clientX,y:e.clientY};dragCurrent={x:e.clientX,y:e.clientY}});
addEventListener('mousemove',e=>{if(dragging)dragCurrent={x:e.clientX,y:e.clientY}});
addEventListener('mouseup',e=>{if(dragging&&dragStart){spawnBody(dragStart.x,dragStart.y,(dragStart.x-e.clientX)*3,(dragStart.y-e.clientY)*3,10+Math.random()*80);dragging=false;dragStart=null;dragCurrent=null}});
// Frame counter, FPS timer, and the radar clock.
let fc=0,lastFT=performance.now(),time=0;
// Seed the initial two clusters.
addCluster(100);setTimeout(()=>addCluster(80),100);
// The per-frame driver: step and draw the sim and the radar, then update the
// topbar readouts (FPS once a second, body count and wall clock every frame).
function loop(){time+=1/60;stepSim();renderSim();drawRadar(heroCV.ctx,W,H,time);fc++;const now=performance.now();if(now-lastFT>=1000){document.getElementById('fpsRead').textContent=fc;fc=0;lastFT=now}document.getElementById('bodyCount').textContent=bodies.length;document.getElementById('clockRead').textContent=new Date().toTimeString().slice(0,8);requestAnimationFrame(loop)}
requestAnimationFrame(loop);
// Reveal-on-scroll: add the .vis class to each .rv section as it scrolls into
// view, so the CSS can fade and slide it in.
const obs=new IntersectionObserver(e=>{e.forEach(el=>{if(el.isIntersecting)el.target.classList.add('vis')})},{threshold:0.08});
document.querySelectorAll('.rv').forEach(el=>obs.observe(el));
