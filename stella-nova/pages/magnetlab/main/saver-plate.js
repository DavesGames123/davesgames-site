// ============================================================================
//  MAGNETLAB  ·  screensaver plates  (part 17 of 20)
// ----------------------------------------------------------------------------
//  The plate of each scene: live parameters, notes, TeX, and the anchor
//  on the magnets for the plate leader.
//
//  grep -n targets: "const SV_PLATE", "function svAnchor", "function saverPlate"
// ============================================================================

// The plate fields for each scene: live parameters (TeX symbol, short name,
// value), at most two notes, and TeX equations. The colours are RULES of
// equations.js: B m1, m m3. saverPlate() merges them into the scene's label;
// the plain eq of the scene stays as the fallback.
const SV_RULES=[['\\vec{B}','m1'],['\\vec{E}','m2'],['\\vec{J}','m5'],['\\vec{m}','m3']];
const DIPOLE_TEX=String.raw`\vec{B}(\vec{r})=\frac{\mu_0}{4\pi}\,\frac{3(\vec{m}\cdot\hat{r})\,\hat{r}-\vec{m}}{r^3}`;
const SUM_TEX=String.raw`\vec{B}=\sum_i\frac{\mu_0}{4\pi}\,\frac{3(\vec{m}_i\cdot\hat{r}_i)\,\hat{r}_i-\vec{m}_i}{r_i^3}`;
const DIV_TEX=String.raw`\nabla\cdot\vec{B}=0`;
const svW=w=>({sym:'\\omega',name:'turn rate',value:om(w)+' rad/s'});
const svGap=()=>({sym:'d',name:'gap',value:Math.round(Math.hypot(magnets[1].x-magnets[0].x,magnets[1].y-magnets[0].y))+' px'});
const SV_PLATE={
  dipole:st=>({params:[{sym:'\\vec{m}',name:'axis angle',value:((deg(magnets[0].angle)%360+360)%360)+'°',cls:'m3'},svW(st.w)],
    tex:[DIPOLE_TEX,String.raw`|\vec{B}|\propto 1/r^3\ \text{far from the magnet}`,DIV_TEX]}),
  attract:st=>({params:[svGap(),svW(st.w)],notes:['The field lines run across the gap.'],
    tex:[String.raw`F=\frac{3\mu_0\,m_1m_2}{2\pi d^4}`,String.raw`U=-\vec{m}\cdot\vec{B},\qquad \vec{F}=\nabla(\vec{m}\cdot\vec{B})`,DIPOLE_TEX]}),
  repel:st=>({params:[svGap(),svW(st.w)],notes:['The lines turn away from the gap.'],
    tex:[String.raw`F=\frac{3\mu_0\,m_1m_2}{2\pi d^4}\ \text{(apart)}`,String.raw`\vec{B}=0\ \text{at the null point}`,DIPOLE_TEX]}),
  quad:st=>({params:[{sym:'n',name:'magnets',value:String(st.n)},{sym:'r',name:'bore radius',value:Math.round(st.r)+' px'},svW(Math.abs(st.w))],
    notes:[st.n===4?'Lenses like this focus beams in accelerators.':st.n===6?'Sextupoles correct the chromatic error of quadrupoles.':'Octupoles damp beam instabilities.'],
    tex:st.n===4?[String.raw`B_x=G\,y,\qquad B_y=G\,x`,String.raw`|\vec{B}|=G\,r\ \text{(zero on the axis)}`,DIV_TEX]
      :[String.raw`|\vec{B}|\propto r^{\,n/2-1},\qquad n=${st.n}`,SUM_TEX,DIV_TEX]}),
  'halbach-ring':st=>({params:[{sym:'k',name:'pattern',value:String(st.k)},{sym:'n',name:'dipoles',value:String(st.n)},{sym:'r',name:'ring radius',value:Math.round(st.r)+' px'},svW(st.w)],
    notes:[st.k===2?'k = 2: near-uniform field in the bore.':st.k===3?'k = 3: a quadrupole, zero at the centre.':'k = −2: the flux goes outside the ring.'],
    tex:[String.raw`\hat{m}(\theta)=(\cos k\theta,\ \sin k\theta)`,String.raw`|\vec{B}|_{\text{bore}}\propto r^{\,k-2}`,SUM_TEX]}),
  'halbach-line':st=>({params:[{sym:'n',name:'dipoles',value:String(st.n)},{sym:'\\lambda',name:'period',value:Math.round(st.gap*4)+' px'}],notes:['Strong face below, weak face above.'],
    tex:[String.raw`\hat{m}(x)=(\cos kx,\ \sin kx),\qquad k=2\pi/\lambda`,String.raw`|\vec{B}|\propto e^{-k|y|}\ \text{on the strong face}`,SUM_TEX]}),
  orbit:st=>({params:[{sym:'R',name:'orbit radius',value:Math.round(st.R)+' px'},svW(st.w),{sym:'T',name:'period',value:fx(2*Math.PI/(st.w*SV.slow),1)+' s'}],notes:['The disc moment stays along the orbit.'],
    tex:[String.raw`|\vec{B}|=\mu_0 nI\ \text{(inside a long solenoid)}`,String.raw`x=R\cos\omega t,\qquad y=R\sin\omega t`,DIPOLE_TEX]}),
  lattice:st=>st.wave?({params:[{sym:'N',name:'grid',value:st.nx+' × '+st.ny},{sym:'k_x',name:'wave number',value:fx(st.kx)+' rad'},
      {sym:'k_y',name:'wave number',value:fx(st.ky)+' rad'},svW(st.ww)],notes:['A travelling twist of the moments, like a magnon.'],
    tex:[SUM_TEX,String.raw`\theta_{ij}(t)=k_x\,i+k_y\,j-\omega t`]}):({params:[{sym:'N',name:'grid',value:st.nx+' × '+st.ny},{sym:'a',name:'spacing',value:Math.round(st.sp)+' px'},
      {sym:'\\omega_i',name:'turn rates',value:om(Math.min(...st.w.map(Math.abs)))+' to '+om(Math.max(...st.w.map(Math.abs)))+' rad/s'}],notes:['Neighbours turn in opposite directions.'],
    tex:[SUM_TEX,String.raw`\theta_i(t)=\theta_{i0}+\omega_i t`]}),
  horseshoe:st=>({params:[{sym:'d',name:'bar above the gap',value:Math.round(st.d)+' px'},{sym:'\\vec{m}',name:'bar angle',value:deg(magnets[1].angle)+'°',cls:'m3'}],notes:['The horseshoe rocks ±29°, the bar turns ±34°.'],
    tex:[SUM_TEX,String.raw`\nabla\cdot\vec{B}=0:\ \text{each line from N returns to S}`]}),
  compass:st=>({params:[{sym:'N',name:'needles',value:String(st.nn)},{sym:'n',name:'drivers',value:String(st.nd)}],notes:['Each needle turns until it lies along B.'],
    tex:[String.raw`\vec{\tau}=\vec{m}\times\vec{B}`,DIPOLE_TEX,DIV_TEX]}),
  gear:st=>({params:[{sym:'p_1',name:'inner pole pairs',value:String(st.p1)},{sym:'p_2',name:'outer pole pairs',value:String(st.p2)},
      {sym:'\\omega_1',name:'inner rate',value:om(st.w)+' rad/s'},{sym:'\\omega_2',name:'outer rate',value:'−'+om(st.w*st.p1/st.p2)+' rad/s'}],notes:['The rings lock through the field alone.'],
    tex:[String.raw`\omega_2=-\frac{p_1}{p_2}\,\omega_1`,SUM_TEX]}),
  spiral:st=>({params:[{sym:'n',name:'dipoles',value:String(st.n)},{sym:'c',name:'spiral scale',value:Math.round(st.c)+' px'},
      {sym:'\\alpha',name:'moment angle',value:deg(st.al||0)+'°',cls:'m3'}],notes:['α = 0°: radial. α = 90°: the flux closes.'],
    tex:[String.raw`r_n=c\sqrt{n},\qquad \theta_n=n\cdot 137.5^\circ`,String.raw`\hat{m}_n=(\cos(\theta_n+\alpha),\ \sin(\theta_n+\alpha))`,SUM_TEX]}),
  cluster:st=>({params:[{sym:'N',name:'magnets',value:String(st.n)},{sym:'T',name:'types',value:String(st.types.length)}],notes:['A new arrangement from each seed.'],
    tex:[SUM_TEX,String.raw`x_i=x_{i0}+A_i\sin\omega_{1i}t,\qquad y_i=y_{i0}+B_i\sin\omega_{2i}t`]}),
  chain:st=>({params:[{sym:'n',name:'dipoles',value:String(st.n)},{sym:'A',name:'amplitude',value:Math.round(st.A)+' px'},
      {sym:'\\lambda',name:'wavelength',value:Math.round(2*Math.PI/st.k)+' px'}],notes:['Head to tail gives the lowest energy.'],
    tex:[String.raw`y=A\sin(kx-\omega t),\qquad \hat{m}\parallel\frac{d\vec{r}}{ds}`,String.raw`U=-\vec{m}\cdot\vec{B}`,SUM_TEX]}),
  closure:st=>({params:[{sym:'g',name:'corner gap',value:Math.round(st.open||0)+' px'},{sym:'h',name:'half side',value:Math.round(st.h)+' px'}],notes:['Closed, the flux stays in the loop.'],
    tex:[DIV_TEX,String.raw`\oint\vec{B}\cdot d\vec{l}\ \text{follows the loop}`,SUM_TEX]}),
  shear:st=>({params:[{sym:'a',name:'pitch',value:Math.round(st.a)+' px'},{sym:'d',name:'gap',value:Math.round(st.gap)+' px'},
      {sym:'v',name:'row speed',value:Math.round(st.v*SV.slow)+' px/s'}],notes:['The rows pull into register as they pass.'],
    tex:[String.raw`\hat{m}_i=(-1)^i\,\hat{m}_0`,String.raw`F_x\propto\sin\!\left(\frac{2\pi\,\Delta x}{2a}\right)`,SUM_TEX]}),
};
// The magnets on screen, for the plate leader. CAM is at zoom 1 and no
// offset in the saver, so a magnet's x, y are canvas CSS px. The radius holds
// every magnet centre plus its half diagonal; the key points are the centres.
function svAnchor(){
  if(!saverOn||!magnets.length) return null;
  const b=canvas.getBoundingClientRect(); let cx=0,cy=0;
  for(const m of magnets){ cx+=m.x; cy+=m.y; } cx/=magnets.length; cy/=magnets.length;
  let r=0; const pts=magnets.map(m=>{ r=Math.max(r,Math.hypot(m.x-cx,m.y-cy)+Math.hypot(m.w||20,m.h||20)/2); return {x:b.left+m.x,y:b.top+m.y}; });
  return {x:b.left+cx,y:b.top+cy,r,pts:pts.slice(0,8)};
}
// The full plate for the current scene: the scene label, its plate fields
// and the view name as the last note.
function saverPlate(){
  const sc=SV.scene, st=SV.st; if(!sc||!st) return null;
  const L=sc.label(st), P=SV_PLATE[sc.id]?SV_PLATE[sc.id](st):{};
  return {title:'MagnetLab · '+L.title,sub:L.sub.charAt(0).toUpperCase()+L.sub.slice(1),params:P.params,lines:(P.notes||[]).concat(['View: '+st.view.name+'.']),
    tex:P.tex,rules:SV_RULES,eq:L.eq,anchor:svAnchor};
}
