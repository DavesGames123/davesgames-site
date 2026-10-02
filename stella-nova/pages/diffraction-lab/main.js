// ============================================================================
//  APERTURE DIFFRACTION  ·  angular-spectrum wave-optics engine
// ----------------------------------------------------------------------------
//  A complex scalar field E leaves a flat aperture (the transmittance mask t of
//  the chosen element), propagates a distance z through free space, and lands on
//  a screen where its intensity |E|² is shown. Propagation uses the angular
//  spectrum method (ASM): a 2D FFT into spatial frequencies, a per-frequency
//  phase advance, then an inverse FFT. White light sums many wavelengths through
//  the CIE 1931 color-matching functions and the D65 illuminant into sRGB.
//
//  PROPAGATION PIPELINE   (per wavelength λ)
//  --------------------------------------------------------------------------
//      aperture plane                 screen plane at z
//      ┌───────────┐                  ┌───────────┐
//      │  E0 = 1    │   FFT      ×H     IFFT        │  E(z)     │
//      │  ·  t(x,y) │ ───────▶ spectrum ───▶ ─────▶ │  |E|² →   │
//      └───────────┘         S(fx,fy)                │  color    │
//        transmittance        H = exp(i·kz·z)        └───────────┘
//        mask (EL[...])       kz = √(k² − kx² − ky²)
//                             k  = 2π/λ ; kz imaginary → evanescent decay
//
//  COLOR PATH
//  --------------------------------------------------------------------------
//      mono   : tone(|E|²/max) × lamRGB(λ)          true colour of one λ
//      white  : Σ_λ |E|² · D65(λ) · [x̄,ȳ,z̄] → XYZ, Y tone-mapped → sRGB
//      tone   : log over S.range decades, or linear × S.gainLin (fieldRGB)
//
//  SCREEN LAYOUT   (the leading marker is an element id; see index.html)
//  --------------------------------------------------------------------------
//      #panel        aperture + presets, light, intensity, view/grid/export
//      #canvas-grid  one composite cell, or a 2×2 of composite + R + G + B;
//                    the composite cell has the aperture inset, scale bar
//                    and legend (placeOverlays)
//      #stage-bar    one shared z / field width / speed bar and transport
//      #eq-panel     equations: a column at ≥1280 px, else a drawer
//      #dock         phone only: panel, Log / Linear, play
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  --------------------------------------------------------------------------
//      complex + FFT ....... "function fft1d"        radix-2 FFT, 1D and 2D
//      propagator .......... "function prop"         the angular spectrum step
//      CIE + color ......... "function cieX"         color-matching and sRGB
//      field to colour ..... "function fieldRGB"     tone map, mono and white light
//      overlays ............ "function placeOverlays" inset, scale bar, legend
//      phone sheet ......... "function setSheet"     bottom sheet and dock
//      geometry helpers .... "function inPoly"       point-in-polygon, star
//      raster helper ....... "function rasterToField"  text/image → mask
//      elements ............ "const EL="             aperture transmittances
//      state ............... "const S="              the one mutable state
//      channel cells ....... "BUILD 4 CELLS"         composite + RGB canvases
//      canvas paint ........ "function renderCh"     field RGB → one canvas
//      recompute ........... "function recompute"    the live render path
//      bar sync + anim ..... "SYNC 4 BARS"           z sliders and z animation
//      param UI ............ "function buildParamUI" per-element sliders
//      events .............. "EVENTS"                element/source/view wiring
//      export .............. "EXPORT SYSTEM"         PNG still and WebM video
//      presets ............. "const PR="             named element setups
//      screensaver ......... "window.snSaver"        shell saver hook
// ============================================================================

// Base constants and unit scales. TAU = 2π; mm/um/nm convert millimeter,
// micrometer, and nanometer figures into the SI meters the physics uses.
const PI=Math.PI,TAU=2*PI,mm=1e-3,um=1e-6,nm=1e-9;
// Complex-array helpers: a field is stored as parallel real and imaginary
// Float64Arrays. czeros makes an all-zero field; cones makes a uniform unit
// field (the incident plane wave before the aperture).
function czeros(n){return{re:new Float64Array(n),im:new Float64Array(n)}}function cones(n){const r=new Float64Array(n);r.fill(1);return{re:r,im:new Float64Array(n)}}
// Elementwise complex multiply (incident field times transmittance mask).
function cmul(a,b){const n=a.re.length,o=czeros(n);for(let i=0;i<n;i++){o.re[i]=a.re[i]*b.re[i]-a.im[i]*b.im[i];o.im[i]=a.re[i]*b.im[i]+a.im[i]*b.re[i]}return o}
// Squared magnitude |E|² of a complex field: the physical intensity.
function cabs2(a){const n=a.re.length,o=new Float64Array(n);for(let i=0;i<n;i++)o[i]=a.re[i]*a.re[i]+a.im[i]*a.im[i];return o}
// In-place radix-2 Cooley-Tukey FFT of one length-n row (n must be a power of
// two). First a bit-reversal permutation, then log2(n) butterfly stages. inv
// runs the inverse transform and divides by n. Twiddle factors advance by the
// running complex root (uR,uI) instead of a per-index trig call.
function fft1d(re,im,n,inv){for(let i=1,j=0;i<n;i++){let b=n>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t}}for(let len=2;len<=n;len<<=1){const h=len>>1,a=(inv?1:-1)*TAU/len,wR=Math.cos(a),wI=Math.sin(a);for(let i=0;i<n;i+=len){let uR=1,uI=0;for(let j=0;j<h;j++){const e=i+j,o=i+j+h,tR=uR*re[o]-uI*im[o],tI=uR*im[o]+uI*re[o];re[o]=re[e]-tR;im[o]=im[e]-tI;re[e]+=tR;im[e]+=tI;const nu=uR*wR-uI*wI;uI=uR*wI+uI*wR;uR=nu}}}if(inv)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n}}
// 2D FFT by separability: transform every row, then every column, reusing one
// scratch buffer pair. Returns fresh real/imag arrays and leaves f untouched.
function fft2d(f,Nx,Ny,inv){const re=new Float64Array(f.re),im=new Float64Array(f.im),rB=new Float64Array(Math.max(Nx,Ny)),iB=new Float64Array(Math.max(Nx,Ny));for(let y=0;y<Ny;y++){const o=y*Nx;for(let x=0;x<Nx;x++){rB[x]=re[o+x];iB[x]=im[o+x]}fft1d(rB,iB,Nx,inv);for(let x=0;x<Nx;x++){re[o+x]=rB[x];im[o+x]=iB[x]}}for(let x=0;x<Nx;x++){for(let y=0;y<Ny;y++){rB[y]=re[y*Nx+x];iB[y]=im[y*Nx+x]}fft1d(rB,iB,Ny,inv);for(let y=0;y<Ny;y++){re[y*Nx+x]=rB[y];im[y*Nx+x]=iB[y]}}return{re,im}}
// fftshift: swap diagonal quadrants so the zero frequency moves to the center,
// matching the centered fftfreqS frequency axis used to build the propagator.
function fftshift(f,Nx,Ny){const n=Nx*Ny,re=new Float64Array(n),im=new Float64Array(n),hx=Nx>>1,hy=Ny>>1;for(let y=0;y<Ny;y++)for(let x=0;x<Nx;x++){const s=((y+hy)%Ny)*Nx+((x+hx)%Nx),d=y*Nx+x;re[d]=f.re[s];im[d]=f.im[s]}return{re,im}}
// Centered spatial-frequency axis for a length-N transform with sample pitch d,
// in cycles per meter. Zero sits at the middle, matching fftshift.
function fftfreqS(N,d){const f=new Float64Array(N),h=N>>1;for(let i=0;i<N;i++)f[i]=(i-h)/(N*d);return f}
// Angular spectrum propagation of field E over distance z at wavelength lam.
// Steps: FFT to the spectrum, shift zero to center, build the transfer function
// H = exp(i·kz·z) per frequency, multiply, shift back, inverse FFT. When
// k² − kx² − ky² < 0 the wave is evanescent, so H becomes a real decaying
// exponential instead of a phase. z = 0 returns a copy unchanged.
function prop(E,Nx,Ny,dx,dy,z,lam){if(z===0)return{re:new Float64Array(E.re),im:new Float64Array(E.im)};let sp=fft2d(E,Nx,Ny,false);sp=fftshift(sp,Nx,Ny);const fx=fftfreqS(Nx,dx),fy=fftfreqS(Ny,dy),k=TAU/lam,k2=k*k,N=Nx*Ny,Hr=new Float64Array(N),Hi=new Float64Array(N);for(let iy=0;iy<Ny;iy++){const ky2=(TAU*fy[iy])**2;for(let ix=0;ix<Nx;ix++){const idx=iy*Nx+ix,kx2=(TAU*fx[ix])**2,arg=k2-kx2-ky2;if(arg>=0){const kz=Math.sqrt(arg);Hr[idx]=Math.cos(kz*z);Hi[idx]=Math.sin(kz*z)}else Hr[idx]=Math.exp(-Math.sqrt(-arg)*z)}}const sr=sp.re,si=sp.im;for(let i=0;i<N;i++){const a=sr[i]*Hr[i]-si[i]*Hi[i],b=sr[i]*Hi[i]+si[i]*Hr[i];sr[i]=a;si[i]=b}sp=fftshift({re:sr,im:si},Nx,Ny);return fft2d(sp,Nx,Ny,true)}
// Asymmetric (piecewise) Gaussian: different spread below and above the mean mu.
// It is the building block of the CIE color-matching function fits.
function pG(x,mu,s1,s2){return Math.exp(-.5*((x-mu)/(x<mu?s1:s2))**2)}
// CIE 1931 x̄/ȳ/z̄ color-matching functions of wavelength l (nm), from the
// standard multi-lobe Gaussian approximation. These weight each wavelength's
// intensity into XYZ tristimulus values.
function cieX(l){return 1.056*pG(l,599.8,37.9,31)+.362*pG(l,442,16,26.7)-.065*pG(l,501.1,20.4,26.2)}
function cieY(l){return .821*pG(l,568.8,46.9,40.5)+.286*pG(l,530.9,16.3,31.1)}
function cieZ(l){return 1.217*pG(l,437,11.8,36)+.681*pG(l,459,26,13.8)}
// D65 daylight illuminant spectrum, sampled every 10 nm from 380 to 780 nm.
// It is the reference white for the white-light color path.
const D65=[49.98,52.31,54.65,68.70,82.75,87.12,91.49,92.46,93.43,90.06,86.68,95.77,104.87,110.94,117.01,117.41,117.81,116.34,114.86,115.39,115.92,112.37,108.81,109.08,109.35,108.58,107.80,106.30,104.79,106.24,107.69,106.05,104.41,104.22,104.05,102.02,100,98.17,96.33,96.06,95.79];
// Linearly interpolate the D65 table at an arbitrary wavelength l (nm).
function d65(l){const t=(l-380)/10,i=Math.max(0,Math.min(39,Math.floor(t)));return D65[i]+(D65[i+1]-D65[i])*(t-i)}
// sRGB transfer function (gamma): map a linear channel value into display space.
function sGam(v){return v<=.0031308?12.92*v:1.055*Math.pow(v,1/2.4)-.055}
// Ray-cast point-in-polygon test, used to rasterize the star aperture.
function inPoly(px,py,vs){let c=false;for(let i=0,j=vs.length-1;i<vs.length;j=i++){const xi=vs[i][0],yi=vs[i][1],xj=vs[j][0],yj=vs[j][1];if(((yi>py)!==(yj>py))&&(px<(xj-xi)*(py-yi)/(yj-yi)+xi))c=!c}return c}
// Build the 2n vertices of an n-point star, alternating outer radius R and
// inner radius r around the circle.
function starV(n,R,r){const v=[];for(let i=0;i<n*2;i++){const a=i*PI/n-PI/2;v.push([(i%2?r:R)*Math.cos(a),(i%2?r:R)*Math.sin(a)])}return v}

/* ═══ FIELD TO COLOUR ═══ */
// XYZ to linear sRGB (D65 white), the matrix M of the CIE formula.
function xyz2rgb(x,y,z){return[3.2406*x-1.5372*y-.4986*z,-.9689*x+1.8758*y+.0415*z,.0557*x-.204*y+1.057*z]}
// The true colour of one wavelength l (nm): its CIE x̄ȳz̄ to linear sRGB.
// Most spectral colours are out of gamut, so negative channels clip to 0
// and the brightest channel scales to 1. Used by the mono path and the λ swatch.
function lamRGB(l){const c=xyz2rgb(cieX(l),cieY(l),cieZ(l)).map(v=>Math.max(0,v)),m=Math.max(c[0],c[1],c[2],1e-9);return c.map(v=>v/m)}
// Tone curve: intensity u = I/Imax in 0..1 to display brightness 0..1.
//   lin  u · gain, clipped at 1 (gain 1..64: lift the side lobes, clip the core)
//   log  log10(1 + u·10^D) / D over D decades (1..6): every lobe is visible
// S.scale picks the curve. S.range holds D for log and the gain for lin.
function tone(u){if(S.scale==='log'){const D=S.range,g=Math.pow(10,D);return Math.log10(1+u*g)/Math.log10(1+g)}return Math.min(1,u*S.gainLin)}
// Propagate the element mask to z (metres) and return an sRGB byte buffer.
// mono:  |E|² at one λ, tone-mapped, times the true colour of λ.
// white: Σ over S.divs wavelengths of |E|² · D65 · x̄ȳz̄ → XYZ. The luminance
//        Y is tone-mapped and XYZ scales with it, so the hue of each pixel
//        stays. A pixel brighter than the gamut scales down as a whole, not
//        per channel, so it keeps its hue and does not turn white.
// A non-dispersive mask (wlDep false) is built once for all wavelengths.
function fieldRGB(el,p,xx,yy,Nx,Ny,dx,dy,z){
  const NN=Nx*Ny,rgb=new Uint8Array(NN*3);
  if(S.source==='mono'){
    const lam=S.lambda*nm,tr=el.t(xx,yy,lam,NN,p);let E=cmul(cones(NN),tr);E=prop(E,Nx,Ny,dx,dy,z,lam);const I=cabs2(E);let mx=0;for(let i=0;i<NN;i++)if(I[i]>mx)mx=I[i];if(mx<1e-30)mx=1;
    const c=lamRGB(S.lambda);for(let i=0;i<NN;i++){const v=tone(I[i]/mx);rgb[i*3]=sGam(v*c[0])*255+.5|0;rgb[i*3+1]=sGam(v*c[1])*255+.5|0;rgb[i*3+2]=sGam(v*c[2])*255+.5|0}
    return rgb;
  }
  const nD=S.divs,dl=(780-380)/nD,X=new Float64Array(NN),Y=new Float64Array(NN),Z=new Float64Array(NN);const tC=el.wlDep?null:el.t(xx,yy,550*nm,NN,p);
  for(let d=0;d<nD;d++){const ln=380+(d+.5)*dl,lam=ln*nm,Sd=d65(ln)*dl,xw=cieX(ln)*Sd,yw=cieY(ln)*Sd,zw=cieZ(ln)*Sd,tr=tC||el.t(xx,yy,lam,NN,p);let E=cmul(cones(NN),tr);E=prop(E,Nx,Ny,dx,dy,z,lam);const I=cabs2(E);for(let i=0;i<NN;i++){X[i]+=I[i]*xw;Y[i]+=I[i]*yw;Z[i]+=I[i]*zw}}
  let mY=0;for(let i=0;i<NN;i++)if(Y[i]>mY)mY=Y[i];if(mY<1e-30)mY=1;
  for(let i=0;i<NN;i++){const y=Y[i];if(y<=0)continue;const k=tone(y/mY)/y;let[r,g,b]=xyz2rgb(X[i]*k,y*k,Z[i]*k);r=Math.max(0,r);g=Math.max(0,g);b=Math.max(0,b);const m=Math.max(r,g,b);if(m>1){r/=m;g/=m;b/=m}rgb[i*3]=sGam(r)*255+.5|0;rgb[i*3+1]=sGam(g)*255+.5|0;rgb[i*3+2]=sGam(b)*255+.5|0}
  return rgb;
}

/* ═══ RASTER HELPER (flips Y so text/images appear right-side up) ═══ */
function rasterToField(imgData,side,N){const t=czeros(N);for(let iy=0;iy<side;iy++)for(let ix=0;ix<side;ix++){const si=iy*side+ix,ci=(side-1-iy)*side+ix;t.re[si]=imgData.data[ci*4]/255}return t}

// The element catalog. Each entry is an aperture or optic: its t(xx,yy,l,N,p)
// returns the complex transmittance mask over the sampled grid, params drive its
// sliders, wlDep marks masks that depend on wavelength (lens, zone plate, phase
// grating) so the white-light path cannot cache one mask across wavelengths, and
// its formula is DiffEq.trans[key] in equations.js. Amplitude apertures
// set only the real part; phase optics write a unit-magnitude complex phase.
/* ═══ ELEMENTS ═══ */
const EL={
  hex:{name:'Hexagonal',sym:'⬡',wlDep:false,params:[{id:'radius',label:'R',min:.01,max:5,value:.7,step:.01}],t(xx,yy,l,N,p){const R=p.radius*mm,s3=Math.sqrt(3),t=czeros(N);for(let i=0;i<N;i++){const ax=Math.abs(xx[i]),ay=Math.abs(yy[i]);t.re[i]=(ax+ay/s3<=R&&ay<=R*s3/2)?1:0}return t}},
  circular:{name:'Circle',sym:'⊙',wlDep:false,params:[{id:'radius',label:'R',min:.01,max:5,value:.5,step:.01}],t(xx,yy,l,N,p){const a=p.radius*mm,t=czeros(N);for(let i=0;i<N;i++)t.re[i]=(xx[i]*xx[i]+yy[i]*yy[i]<a*a)?1:0;return t}},
  rect:{name:'Rect Slit',sym:'▬',wlDep:false,params:[{id:'width',label:'W',min:.01,max:5,value:.1,step:.01},{id:'height',label:'H',min:.01,max:10,value:3,step:.1}],t(xx,yy,l,N,p){const w=p.width*mm/2,h=p.height*mm/2,t=czeros(N);for(let i=0;i<N;i++)t.re[i]=(Math.abs(xx[i])<w&&Math.abs(yy[i])<h)?1:0;return t}},
  double:{name:'Double Slit',sym:'‖',wlDep:false,params:[{id:'slit_w',label:'W',min:.005,max:1,value:.04,step:.005},{id:'sep',label:'Sep',min:.02,max:5,value:.3,step:.01},{id:'height',label:'H',min:.1,max:10,value:3,step:.1}],t(xx,yy,l,N,p){const w=p.slit_w*mm/2,d=p.sep*mm/2,h=p.height*mm/2,t=czeros(N);for(let i=0;i<N;i++){const x=xx[i],y=yy[i];t.re[i]=((Math.abs(x-d)<w||Math.abs(x+d)<w)&&Math.abs(y)<h)?1:0}return t}},
  star:{name:'Star',sym:'★',wlDep:false,params:[{id:'pts',label:'Pts',min:3,max:12,value:5,step:1},{id:'radius',label:'R',min:.05,max:5,value:.6,step:.01},{id:'inner',label:'Inn',min:.1,max:.9,value:.38,step:.01}],t(xx,yy,l,N,p){const R=p.radius*mm,rI=R*p.inner,vs=starV(p.pts,R,rI),t=czeros(N);for(let i=0;i<N;i++)t.re[i]=inPoly(xx[i],yy[i],vs)?1:0;return t}},
  heart:{name:'Heart',sym:'♥',wlDep:false,params:[{id:'size',label:'Size',min:.05,max:5,value:.5,step:.01}],t(xx,yy,l,N,p){const s=p.size*mm,t=czeros(N);for(let i=0;i<N;i++){const xn=xx[i]/s,yn=-yy[i]/s+.35,r2=xn*xn+yn*yn-1;t.re[i]=(r2*r2*r2-xn*xn*yn*yn*yn<=0)?1:0}return t}},
  ring:{name:'Ring',sym:'◯',wlDep:false,params:[{id:'outer',label:'Out',min:.05,max:5,value:.6,step:.01},{id:'inner',label:'Inn',min:.01,max:4,value:.4,step:.01}],t(xx,yy,l,N,p){const ro=p.outer*mm,ri=p.inner*mm,t=czeros(N);for(let i=0;i<N;i++){const r2=xx[i]*xx[i]+yy[i]*yy[i];t.re[i]=(r2>=ri*ri&&r2<=ro*ro)?1:0}return t}},
  cross:{name:'Cross',sym:'✚',wlDep:false,params:[{id:'arm',label:'Arm',min:.05,max:5,value:.6,step:.01},{id:'width',label:'W',min:.01,max:2,value:.15,step:.01}],t(xx,yy,l,N,p){const a=p.arm*mm,w=p.width*mm/2,t=czeros(N);for(let i=0;i<N;i++){const ax=Math.abs(xx[i]),ay=Math.abs(yy[i]);t.re[i]=((ax<w&&ay<a)||(ay<w&&ax<a))?1:0}return t}},
  'grating-bin':{name:'Grating',sym:'⫾',wlDep:false,params:[{id:'period',label:'Per',min:.01,max:2,value:.15,step:.005},{id:'width',label:'W',min:.1,max:15,value:3,step:.1},{id:'height',label:'H',min:.1,max:15,value:3,step:.1}],t(xx,yy,l,N,p){const P=p.period*mm,w=p.width*mm/2,h=p.height*mm/2,t=czeros(N);for(let i=0;i<N;i++){const x=xx[i],y=yy[i];if(Math.abs(x)<w&&Math.abs(y)<h)t.re[i]=(((x%P+P)%P)<P/2)?1:0}return t}},
  'grating-phase':{name:'Phase Grating',sym:'≋',wlDep:true,params:[{id:'period',label:'Per',min:.01,max:2,value:.15,step:.005},{id:'width',label:'W',min:.1,max:15,value:3,step:.1},{id:'height',label:'H',min:.1,max:15,value:3,step:.1}],t(xx,yy,l,N,p){const P=p.period*mm,w=p.width*mm/2,h=p.height*mm/2,t=czeros(N);for(let i=0;i<N;i++){const x=xx[i],y=yy[i];if(Math.abs(x)<w&&Math.abs(y)<h){const ph=TAU*x/P;t.re[i]=Math.cos(ph);t.im[i]=Math.sin(ph)}}return t}},
  'lens-ap':{name:'Lens',sym:'◉',wlDep:true,params:[{id:'f',label:'f',min:1,max:1000,value:50,step:1},{id:'radius',label:'R',min:.05,max:5,value:.4,step:.01}],t(xx,yy,l,N,p){const f=p.f*mm,a=p.radius*mm,t=czeros(N);for(let i=0;i<N;i++){const r2=xx[i]*xx[i]+yy[i]*yy[i];if(r2<a*a){const ph=-PI/(l*f)*r2;t.re[i]=Math.cos(ph);t.im[i]=Math.sin(ph)}}return t}},
  fzp:{name:'Zone Plate',sym:'◎',wlDep:true,params:[{id:'f',label:'f',min:5,max:500,value:50,step:1},{id:'radius',label:'R',min:.05,max:5,value:.5,step:.01}],t(xx,yy,l,N,p){const f=p.f*mm,a=p.radius*mm,t=czeros(N);for(let i=0;i<N;i++){const r2=xx[i]*xx[i]+yy[i]*yy[i];if(r2<a*a){const ph=-(TAU/l)*(Math.sqrt(f*f+r2)-f);t.re[i]=Math.cos(ph);t.im[i]=Math.sin(ph)}}return t}},
  text:{name:'Text',sym:'Aa',wlDep:false,params:[{id:'txt',label:'Text',type:'text',value:'davesgames.io'},{id:'sz',label:'Size',min:8,max:120,value:28,step:1}],t(xx,yy,l,N,p){const side=Math.round(Math.sqrt(N)),cv=document.createElement('canvas');cv.width=side;cv.height=side;const ctx=cv.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,side,side);ctx.fillStyle='#fff';ctx.font=`bold ${p.sz}px "JetBrains Mono",monospace`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(p.txt||'A',side/2,side/2);return rasterToField(ctx.getImageData(0,0,side,side),side,N)}},
  image:{name:'Image',sym:'◫',wlDep:false,params:[{id:'file',label:'Image',type:'file'},{id:'inv',label:'Invert',min:0,max:1,value:0,step:1}],t(xx,yy,l,N,p){if(!window._imgMask||window._imgMask.length!==N)return cones(N);const t=czeros(N),inv=p.inv>.5;for(let i=0;i<N;i++)t.re[i]=inv?1-window._imgMask[i]:window._imgMask[i];return t}},
};

// Fill the element dropdown from EL, defaulting the selection to the text mask.
/* Populate element select */
(function(){const sel=document.getElementById('element-select');Object.entries(EL).forEach(([k,v])=>{const o=document.createElement('option');o.value=k;o.textContent=v.sym+'  '+v.name;if(k==='hex')o.selected=true;sel.appendChild(o)})})();

// The single mutable state. source is 'mono' or 'white'; z is the propagation
// distance in mm; extent is the physical grid width in mm; N is the grid side;
// divs is the number of wavelength samples for white light; viewMode 1 or 4
// selects composite-only or the 2×2 channel split; params holds element sliders.
// scale is 'log' or 'lin'; range is the log decades, gainLin the linear gain.
const S={element:'hex',source:'white',lambda:633,z:200,extent:5,N:256,divs:15,speed:5,viewMode:1,scale:'log',range:2,gainLin:1,params:{}};
// z-animation state: direction (−1/0/+1) and a dwell countdown at each endpoint.
let animDir=0,animDwell=0;
// Paint a range input's filled portion via the --pct custom property.
function sg(el){el.style.setProperty('--pct',(el.value-el.min)/(el.max-el.min)*100+'%')}

// Build the four output cells (composite plus one per RGB channel). Each cell
// carries its own canvas and a control bar with a z slider, an extent slider, a
// speed slider, and the transport buttons; the bars are kept in sync elsewhere.
/* ═══ BUILD 4 CELLS WITH BARS ═══ */
const CHANNELS=[{id:'cv-rgb',label:'Composite',cls:''},{id:'cv-r',label:'Red',cls:'ch-r'},{id:'cv-g',label:'Green',cls:'ch-g'},{id:'cv-b',label:'Blue',cls:'ch-b'}];
const grid=document.getElementById('canvas-grid');
CHANNELS.forEach((ch,idx)=>{
  const cell=document.createElement('div');cell.className='canvas-cell';cell.id='cell-'+idx;
  cell.innerHTML=`<div class="cell-label ${ch.cls}">${ch.label}</div><canvas id="${ch.id}"></canvas>`+(idx?'':`
<div class="ov ov-ap"><canvas id="ap-cv" width="128" height="128"></canvas><span id="ap-lbl">Aperture</span></div>
<div class="ov ov-scale"><i id="scale-bar"></i><span id="scale-lbl"></span></div>
<div class="ov ov-legend"><i id="legend-bar"></i><div class="ticks" id="legend-ticks"></div></div>`);
  grid.appendChild(cell);
});

// Paint one channel of the computed rgb buffer to its canvas. Draw into an
// offscreen ImageData at grid resolution (flipping Y so the image is upright),
// then scale it, letterboxed and centered, into the visible canvas. ch selects
// which channels to keep: 'rgb' composite, or 'r'/'g'/'b' isolated.
function renderCh(canvas,rgb,Nx,Ny,ch){const cell=canvas.parentElement,dpr=devicePixelRatio,W=cell.clientWidth,H=cell.clientHeight,clear=clearHeight(cell);if(clear<1||W<1)return;const cw=Math.round(W*dpr),ch2=Math.round(H*dpr);canvas.width=cw;canvas.height=ch2;const ctx=canvas.getContext('2d');ctx.clearRect(0,0,cw,ch2);const off=document.createElement('canvas');off.width=Nx;off.height=Ny;const oc=off.getContext('2d'),img=oc.createImageData(Nx,Ny),d=img.data;for(let iy=0;iy<Ny;iy++)for(let ix=0;ix<Nx;ix++){const si=(Ny-1-iy)*Nx+ix,di=(iy*Nx+ix)*4,r=rgb[si*3],g=rgb[si*3+1],b=rgb[si*3+2];if(ch==='rgb'){d[di]=r;d[di+1]=g;d[di+2]=b}else if(ch==='r'){d[di]=r;d[di+1]=0;d[di+2]=0}else if(ch==='g'){d[di]=0;d[di+1]=g;d[di+2]=0}else{d[di]=0;d[di+1]=0;d[di+2]=b}d[di+3]=255}oc.putImageData(img,0,0);const side=Math.min(W,clear),x0=(W-side)/2,y0=(clear-side)/2;ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(off,x0*dpr,y0*dpr,side*dpr,side*dpr);if(ch==='rgb')placeOverlays(cell,x0,y0,side,H)}
// The height of a cell that the phone sheet (#panel) does not cover. On a
// desktop the panel is beside the stage, so the whole cell is clear.
function clearHeight(cell){const r=cell.getBoundingClientRect(),pr=document.getElementById('panel').getBoundingClientRect();if(!phone()||!document.body.classList.contains('sheet-open')||pr.left>r.left+r.width/2)return r.height;return Math.max(0,Math.min(r.height,pr.top-r.top))}
// Put the aperture inset, the scale bar and the legend on the corners of the
// drawn pattern (x0, y0, side in CSS px inside the cell of height H). The
// scale bar has a 1-2-5 length near a quarter of the pattern width.
function placeOverlays(cell,x0,y0,side,H){const st=cell.style,pad=side<360?8:12;st.setProperty('--fx',x0+pad+'px');st.setProperty('--fy',y0+pad+(S.viewMode===4?18:0)+'px');st.setProperty('--sx',x0+pad+4+'px');st.setProperty('--sy',H-(y0+side)+pad+'px');st.setProperty('--lx',x0+pad+4+'px');st.setProperty('--ly',H-(y0+side)+pad+'px');const mmPerPx=S.extent/side,want=mmPerPx*side*.22,e=Math.pow(10,Math.floor(Math.log10(want))),m=want/e,nice=(m>=5?5:m>=2?2:1)*e;document.getElementById('scale-bar').style.width=nice/mmPerPx+'px';document.getElementById('scale-lbl').textContent=nice>=1?nice+' mm':(nice*1000)+' µm'}

// Read the current element's slider and text values into a plain params object
// and cache it on S. File-type params (image upload) are handled separately.
function readParams(){const el=EL[S.element],p={};el.params.forEach(pd=>{if(pd.type==='file')return;const sl=document.getElementById('sl-p-'+pd.id);p[pd.id]=pd.type==='text'?(sl?sl.value:pd.value):(sl?parseFloat(sl.value):pd.value)});S.params=p;return p}

// The live render path. Sample a physical grid centered on the aperture, build
// the transmittance mask, propagate it to z, and convert intensity to an RGB
// buffer, then paint the visible cells and update the readouts and equation.
function recompute(){
  // Physical sample coordinates: dx,dy are the grid pitch (extent / N).
  const p=readParams(),el=EL[S.element],N=S.N,Nx=N,Ny=N,ext=S.extent*mm,dx=ext/Nx,dy=ext/Ny,z=S.z*mm;
  const xx=new Float64Array(N*N),yy=new Float64Array(N*N);
  for(let iy=0;iy<Ny;iy++){const y_=dy*(iy-Ny/2);for(let ix=0;ix<Nx;ix++){xx[iy*Nx+ix]=dx*(ix-Nx/2);yy[iy*Nx+ix]=y_}}
  const rgb=fieldRGB(el,p,xx,yy,Nx,Ny,dx,dy,z);
  // Always paint the composite; paint the isolated R/G/B cells only in 2×2 view.
  renderCh(document.getElementById('cv-rgb'),rgb,Nx,Ny,'rgb');
  if(S.viewMode===4){renderCh(document.getElementById('cv-r'),rgb,Nx,Ny,'r');renderCh(document.getElementById('cv-g'),rgb,Nx,Ny,'g');renderCh(document.getElementById('cv-b'),rgb,Nx,Ny,'b')}
  document.getElementById('st-main').textContent=`${N}² grid · dx ${(dx/um).toFixed(1)} µm`;
  // Fresnel number N_F = a²/(λz) classifies the regime: large means geometric
  // shadow, near one is Fresnel (near-field), small is Fraunhofer (far-field).
  const aC=p.radius||p.outer||p.width||p.slit_w||p.arm||p.size||0;let nf='';if(aC>0&&S.z>0){const l0=(S.source==='mono'?S.lambda:550)*nm,Nf=(aC*mm)**2/(l0*z);nf=`N_F = ${Nf<.01?Nf.toExponential(1):Nf.toFixed(2)} · ${Nf>5?'shadow':Nf>.5?'Fresnel':'Fraunhofer'}`}document.getElementById('st-sub').textContent=nf;document.getElementById('eq-nf').textContent=nf||'–';
  drawAperture(el,p,xx,yy,N);drawLegend();
  document.getElementById('qp-summary').textContent=el.sym+' '+el.name+' · '+(S.source==='white'?'D65':'λ='+S.lambda+'nm')+' · z='+S.z.toFixed(0)+'mm';
  // Show the transmittance formula of the current element (MathJax SVG from
  // equations.js, typeset by typeset.mjs).
  showTrans();
}
// Aperture inset: |t| as brightness, and for a phase element the phase as
// hue, over the same field width as the pattern. Drawn at 128 px.
function drawAperture(el,p,xx,yy,N){const cv=document.getElementById('ap-cv');if(!cv)return;const t=el.t(xx,yy,(S.source==='mono'?S.lambda:550)*nm,N*N,p),off=document.createElement('canvas');off.width=N;off.height=N;const oc=off.getContext('2d'),img=oc.createImageData(N,N),d=img.data;let phase=false;for(let i=0;i<N*N;i++)if(Math.abs(t.im[i])>1e-6){phase=true;break}for(let iy=0;iy<N;iy++)for(let ix=0;ix<N;ix++){const si=(N-1-iy)*N+ix,di=(iy*N+ix)*4,re=t.re[si],im=t.im[si],a=Math.min(1,Math.hypot(re,im));if(phase&&a>0){const h=(Math.atan2(im,re)/TAU+1)%1,c=hsl(h);d[di]=c[0]*a;d[di+1]=c[1]*a;d[di+2]=c[2]*a}else{const v=a*235+12;d[di]=d[di+1]=d[di+2]=v}d[di+3]=255}oc.putImageData(img,0,0);const c=cv.getContext('2d');c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';c.drawImage(off,0,0,128,128);document.getElementById('ap-lbl').textContent=phase?'Aperture · phase':'Aperture'}
function hsl(h){const f=n=>{const k=(n+h*12)%12;return 255*(.55-.45*Math.max(-1,Math.min(k-3,9-k,1)))};return[f(0),f(8),f(4)]}
// Legend: the tone curve as a gradient from 0 to the peak, in the light's
// colour, with the intensity at each end and the middle.
function drawLegend(){const bar=document.getElementById('legend-bar');if(!bar)return;const c=S.source==='mono'?lamRGB(S.lambda):[1,1,1],stops=[];for(let i=0;i<=16;i++){let u;if(S.scale==='log')u=Math.pow(10,-S.range*(1-i/16));else u=i/16/S.gainLin;const v=tone(u),col=c.map(x=>Math.round(sGam(v*x)*255));stops.push(`rgb(${col}) ${(i/16*100).toFixed(1)}%`)}bar.style.background=`linear-gradient(90deg,${stops.join(',')})`;const ticks=S.scale==='log'?[`10⁻${sup(S.range)}`,`10⁻${sup(S.range/2)}`,'1']:['0',fmtG(.5/S.gainLin),fmtG(1/S.gainLin)];document.getElementById('legend-ticks').innerHTML=ticks.map(t=>`<span>${t}</span>`).join('')}
function sup(x){const m='⁰¹²³⁴⁵⁶⁷⁸⁹';const s=(Math.round(x*10)/10).toString();return s.split('').map(ch=>ch==='.'?'·':m[+ch]).join('')}
function fmtG(v){return v>=.1?(+v.toFixed(2)).toString():v.toExponential(0)}
// Put the element's transmittance formula into #eq-trans, once per element.
let _transKey=null;function showTrans(){if(_transKey===S.element||!window.DiffEq)return;_transKey=S.element;document.getElementById('eq-t-label').textContent='Transmittance · '+EL[S.element].name;document.getElementById('eq-trans').innerHTML=DiffEq.trans[S.element]||''}
// Equation column: beside the stage at 1280 px and wider, else a drawer.
function setEqOpen(o){document.body.classList.toggle('eq-open',o);document.getElementById('eq-toggle').setAttribute('aria-expanded',o)}
function eqLayout(){const narrow=innerWidth<1280||phone();document.body.classList.toggle('no-eq',narrow);if(!narrow)setEqOpen(false)}
document.getElementById('eq-collapse-btn').addEventListener('click',()=>setEqOpen(false));
document.getElementById('eq-toggle').addEventListener('click',()=>setEqOpen(!document.body.classList.contains('eq-open')));
eqLayout();
// Coalesce many rapid changes into one recompute per animation frame.
let _sc=false;function scheduleRecompute(){if(!_sc){_sc=true;requestAnimationFrame(()=>{_sc=false;recompute()})}}

// The four cells each have their own z/extent/speed sliders and transport
// buttons. syncBars writes S back to every copy so they stay identical, and the
// input handlers below read any one of them into S. The z animation drives z
// back and forth between 0 and its max, dwelling briefly at each endpoint.
/* ═══ SYNC 4 BARS ═══ */
const allZ=document.querySelectorAll('.cb-z'),allZV=document.querySelectorAll('.cb-z-v'),allSpd=document.querySelectorAll('.cb-spd'),allSpdV=document.querySelectorAll('.cb-spd-v'),allExt=document.querySelectorAll('.cb-ext'),allExtV=document.querySelectorAll('.cb-ext-v'),allBtns=document.querySelectorAll('.cb-btn');
function syncBars(){allZ.forEach(s=>{s.value=Math.min(+s.max,S.z);sg(s)});allZV.forEach(v=>v.textContent=S.z.toFixed(0)+' mm');allSpd.forEach(s=>{s.value=S.speed;sg(s)});allSpdV.forEach(v=>v.textContent=`×${S.speed}`);allExt.forEach(s=>{s.value=S.extent;sg(s)});allExtV.forEach(v=>v.textContent=S.extent.toFixed(1)+' mm');allBtns.forEach(b=>{const d=+b.dataset.d;b.classList.toggle('on',d!==0&&d===animDir)});const dp=document.getElementById('dockPlay');dp.classList.toggle('on',!!animDir);dp.textContent=animDir?'❚❚':'▶'}
allZ.forEach(s=>{sg(s);s.addEventListener('input',function(){S.z=+this.value;syncBars();if(!animDir)scheduleRecompute()})});
allSpd.forEach(s=>{sg(s);s.addEventListener('input',function(){S.speed=+this.value;syncBars()})});
allExt.forEach(s=>{sg(s);s.addEventListener('input',function(){S.extent=+this.value;syncBars();scheduleRecompute()})});
allBtns.forEach(b=>b.addEventListener('click',function(){const d=+this.dataset.d;if(d===0)animDir=0;else if(animDir===d)animDir=0;else{animDir=d;requestAnimationFrame(animLoop)}syncBars()}));
// One z-animation tick: advance z by a speed-scaled step, reverse and dwell at
// each end, then recompute and reschedule.
function animLoop(){if(!animDir)return;if(animDwell>0){animDwell--;requestAnimationFrame(animLoop);return}const zMin=0,zMax=+allZ[0].max||500;S.z+=animDir*S.speed*(zMax-zMin)/400;if(S.z>=zMax){S.z=zMax;animDir=-1;animDwell=60}if(S.z<=zMin){S.z=zMin;animDir=1;animDwell=60}syncBars();recompute();requestAnimationFrame(animLoop)}

// Rebuild the parameter widgets for the current element. Text params get a text
// input, file params get a file-picker button, and numeric params get a slider
// with a decimal precision inferred from the step. Every widget schedules a
// recompute on change.
/* ═══ PARAM UI ═══ */
// Readable names and units for the element parameters (EL keeps short ids).
const PNAME={radius:['Radius','mm'],width:['Width','mm'],height:['Height','mm'],slit_w:['Slit width','mm'],sep:['Separation','mm'],pts:['Points',''],inner:['Inner ratio',''],size:['Size','mm'],outer:['Outer radius','mm'],arm:['Arm length','mm'],period:['Period','mm'],f:['Focal length','mm'],sz:['Font size','px'],inv:['Invert','']};
function buildParamUI(){const c=document.getElementById('params-container'),el=EL[S.element];c.innerHTML='';el.params.forEach(pd=>{if(pd.type==='text'){const d=document.createElement('div');d.innerHTML=`<input type="text" id="sl-p-${pd.id}" value="${pd.value}" class="qp-text-input" placeholder="${pd.label}">`;c.appendChild(d);d.querySelector('input').addEventListener('input',()=>scheduleRecompute())}else if(pd.type==='file'){const d=document.createElement('div');d.innerHTML=`<button class="qp-file-btn">Choose Image</button>`;c.appendChild(d);d.querySelector('button').addEventListener('click',()=>document.getElementById('file-input').click())}else{const dec=pd.step<.01?3:pd.step<.1?2:pd.step<1?1:0;const nm_=PNAME[pd.id]||[pd.label,''],row=document.createElement('div');row.className='row';row.innerHTML=`<span class="row-lbl">${nm_[0]}</span><input type="range" id="sl-p-${pd.id}" min="${pd.min}" max="${pd.max}" value="${pd.value}" step="${pd.step}" aria-label="${nm_[0]}"><span class="val"><span id="vl-p-${pd.id}">${pd.value.toFixed(dec)}</span>${nm_[1]?' '+nm_[1]:''}</span>`;c.appendChild(row);const sl=row.querySelector('input');sg(sl);sl.addEventListener('input',function(){document.getElementById('vl-p-'+pd.id).textContent=(+this.value).toFixed(dec);sg(this);scheduleRecompute()})}});readParams()}

// Image upload: draw the chosen file centered on an N×N canvas, then read its
// luminance (flipping Y) into window._imgMask for the 'image' element's mask.
document.getElementById('file-input').addEventListener('change',function(){const f=this.files[0];if(!f)return;const r=new FileReader();r.onload=function(e){const img=new Image();img.onload=function(){const N=S.N,cv=document.createElement('canvas');cv.width=N;cv.height=N;const ctx=cv.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,N,N);const sc=Math.min(N/img.width,N/img.height)*.85,w=img.width*sc,h=img.height*sc;ctx.drawImage(img,(N-w)/2,(N-h)/2,w,h);const id=ctx.getImageData(0,0,N,N);window._imgMask=new Float64Array(N*N);for(let iy=0;iy<N;iy++)for(let ix=0;ix<N;ix++){const si=iy*N+ix,ci=(N-1-iy)*N+ix;window._imgMask[si]=(id.data[ci*4]+id.data[ci*4+1]+id.data[ci*4+2])/765}scheduleRecompute()};img.src=e.target.result};r.readAsDataURL(f)});

// Top-level control wiring: element choice, source mode (which shows the mono or
// white sub-panel), grid resolution, view mode, and the wavelength/division
// sliders with their live swatch. Each writes S and schedules a recompute.
/* ═══ EVENTS ═══ */
document.getElementById('element-select').addEventListener('change',function(){S.element=this.value;document.querySelectorAll('.preset-btn').forEach(b=>b.classList.remove('on'));buildParamUI();scheduleRecompute()});
document.querySelectorAll('#source-modes .qp-mode').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('#source-modes .qp-mode').forEach(x=>x.classList.remove('active'));b.classList.add('active');S.source=b.dataset.source;syncSource();scheduleRecompute()}));
// Show the wavelength row or the wavelength-count row for the light source.
function syncSource(){document.querySelectorAll('#source-modes .qp-mode').forEach(x=>x.classList.toggle('active',x.dataset.source===S.source));document.getElementById('mono-params').hidden=S.source!=='mono';document.getElementById('white-params').hidden=S.source!=='white'}
document.querySelectorAll('.res-btn[data-n]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.res-btn[data-n]').forEach(x=>x.classList.remove('active'));b.classList.add('active');S.N=+b.dataset.n;window._imgMask=null;scheduleRecompute()}));
document.querySelectorAll('#view-modes .qp-mode').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('#view-modes .qp-mode').forEach(x=>x.classList.remove('active'));b.classList.add('active');S.viewMode=+b.dataset.view;const g=document.getElementById('canvas-grid');g.classList.toggle('view-1',S.viewMode===1);document.getElementById('export-section').hidden=S.viewMode!==1;scheduleRecompute()}));
['sl-lam','sl-div'].forEach(id=>{const el=document.getElementById(id);if(!el)return;sg(el);el.addEventListener('input',function(){sg(this);const v=+this.value;if(id==='sl-lam'){S.lambda=v;document.getElementById('vl-lam').textContent=v.toFixed(0);const rgb=lamRGB(v).map(x=>sGam(x)*255|0),dot=document.getElementById('wl-dot'),cs=`rgb(${rgb})`;dot.style.backgroundColor=cs;dot.style.color=cs}else{S.divs=v;document.getElementById('vl-div').textContent=v.toFixed(0)}scheduleRecompute()})});
// Intensity scale: Log or Linear, and one slider. In log mode the slider is
// the number of decades shown (1..6); in linear mode it is the gain (×1..×64,
// on a log2 track). syncScale writes S to the buttons, slider and label.
function syncScale(){document.querySelectorAll('[data-scale]').forEach(b=>b.classList.toggle('active',b.dataset.scale===S.scale));const sl=document.getElementById('sl-range'),lb=document.getElementById('lb-range'),vl=document.getElementById('vl-range');if(S.scale==='log'){lb.textContent='Range';sl.min=1;sl.max=6;sl.step=.5;sl.value=S.range;vl.textContent=S.range+' dec'}else{lb.textContent='Gain';sl.min=0;sl.max=6;sl.step=.5;sl.value=Math.log2(S.gainLin);vl.textContent='×'+(+S.gainLin.toFixed(1))}sg(sl)}
document.querySelectorAll('[data-scale]').forEach(b=>b.addEventListener('click',()=>{S.scale=b.dataset.scale;syncScale();scheduleRecompute()}));
document.getElementById('sl-range').addEventListener('input',function(){if(S.scale==='log')S.range=+this.value;else S.gainLin=Math.pow(2,+this.value);syncScale();scheduleRecompute()});
// Collapse the control panel to a narrow strip; the stage takes the room.
document.getElementById('qp-collapse-btn').addEventListener('click',()=>{document.body.classList.toggle('panel-collapsed');setTimeout(scheduleRecompute,60)});
// PHONE. The panel is a bottom sheet (portrait) or a right drawer (landscape
// phone) over #dock. #dockPanel opens it, #sheetGrip toggles half and full
// height, and a drag down on the grip closes it. The sheet stays open while a
// control changes, and renderCh frames the pattern above it (clearHeight).
function phone(){return matchMedia('(max-width:768px),(max-height:500px) and (pointer:coarse)').matches}
function setSheet(open,full){document.body.classList.toggle('sheet-open',open);document.body.classList.toggle('sheet-full',open&&!!full);document.getElementById('dockPanel').classList.toggle('on',open);document.getElementById('dockPanel').setAttribute('aria-expanded',open);setTimeout(scheduleRecompute,300)}
document.getElementById('dockPanel').addEventListener('click',()=>setSheet(!document.body.classList.contains('sheet-open')));
(function(){const g=document.getElementById('sheetGrip');let y0=null;g.addEventListener('pointerdown',e=>{y0=e.clientY;g.setPointerCapture(e.pointerId)});g.addEventListener('pointerup',e=>{if(y0===null)return;const dy=e.clientY-y0;y0=null;if(dy>40)setSheet(false);else if(dy<-40)setSheet(true,true);else setSheet(true,!document.body.classList.contains('sheet-full'))})})();
document.getElementById('dockPlay').addEventListener('click',()=>{animDir=animDir?0:1;if(animDir)requestAnimationFrame(animLoop);syncBars()});
window.addEventListener('resize',()=>{eqLayout();scheduleRecompute()});


// Reset: restore every state field and control to its default, clear any
// uploaded image, and recompute.
/* Reset */
document.getElementById('btn-reset').addEventListener('click',()=>{S.scale='log';S.range=2;S.gainLin=1;S.viewMode=1;window._imgMask=null;document.querySelectorAll('#view-modes .qp-mode').forEach(b=>b.classList.toggle('active',b.dataset.view==='1'));document.getElementById('canvas-grid').classList.add('view-1');document.getElementById('export-section').hidden=false;syncScale();applyP(PR[0]);document.querySelectorAll('.preset-btn')[0].classList.add('on')});

// Export: render a still PNG at the current z, or a WebM video that sweeps z
// over time. Both reuse renderFrame, which runs the same propagation as the live
// path but into a standalone canvas at the export resolution.
/* ═══ EXPORT SYSTEM ═══ */
// Aspect ratio state and the named ratio presets.
let exAR=[1,1]; // [w,h] ratio
const AR_MAP={'1:1':[1,1],'16:9':[16,9],'9:16':[9,16],'4:3':[4,3],'3:4':[3,4]};
// Easing curves for the z sweep over a video, mapping frame fraction 0..1.
const EASE={linear:t=>t,'ease-in':t=>t*t,'ease-out':t=>1-(1-t)*(1-t),'ease-in-out':t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2};
// Output pixel dimensions from the width slider and the chosen aspect ratio.
function exDims(){const w=+document.getElementById('sl-exw').value;const h=Math.round(w*exAR[1]/exAR[0]);return[w,h]}
function updateExLabel(){const[w,h]=exDims();document.getElementById('vl-exw').textContent=w+'×'+h}

// Export control wiring: aspect ratio, output size, duration, and repeat count.
document.querySelectorAll('#ar-btns .res-btn').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('#ar-btns .res-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');exAR=AR_MAP[b.dataset.ar]||[1,1];updateExLabel()}));
const slExw=document.getElementById('sl-exw');sg(slExw);slExw.addEventListener('input',function(){sg(this);updateExLabel()});
const slDur=document.getElementById('sl-dur');sg(slDur);slDur.addEventListener('input',function(){sg(this);document.getElementById('vl-dur').textContent=this.value+'s'});
const slRep=document.getElementById('sl-rep');sg(slRep);slRep.addEventListener('input',function(){sg(this);document.getElementById('vl-rep').textContent=this.value});

// Render one export frame: run the full mono or white propagation on an Nx×Ny
// sim grid at distance z (mm), draw it to a sim canvas, then scale it to fill
// the exW×exH output canvas. This mirrors recompute but writes to a fresh canvas.
function renderFrame(Nx,Ny,exW,exH,z){
  const p=readParams(),el=EL[S.element];
  const maxN=Math.max(Nx,Ny),ext=S.extent*mm;
  const dx=ext/maxN,dy=ext/maxN; // isotropic sampling
  const NN=Nx*Ny;
  const xx=new Float64Array(NN),yy=new Float64Array(NN);
  for(let iy=0;iy<Ny;iy++){const y_=dy*(iy-Ny/2);for(let ix=0;ix<Nx;ix++){xx[iy*Nx+ix]=dx*(ix-Nx/2);yy[iy*Nx+ix]=y_}}
  const rgb=fieldRGB(el,p,xx,yy,Nx,Ny,dx,dy,z*mm);
  const simCv=document.createElement('canvas');simCv.width=Nx;simCv.height=Ny;
  const sc2=simCv.getContext('2d'),img=sc2.createImageData(Nx,Ny),d=img.data;
  for(let iy=0;iy<Ny;iy++)for(let ix=0;ix<Nx;ix++){const si=(Ny-1-iy)*Nx+ix,di=(iy*Nx+ix)*4;d[di]=rgb[si*3];d[di+1]=rgb[si*3+1];d[di+2]=rgb[si*3+2];d[di+3]=255}
  sc2.putImageData(img,0,0);
  const outCv=document.createElement('canvas');outCv.width=exW;outCv.height=exH;
  const oc=outCv.getContext('2d');oc.fillStyle='#000';oc.fillRect(0,0,exW,exH);
  oc.imageSmoothingEnabled=true;oc.imageSmoothingQuality='high';
  oc.drawImage(simCv,0,0,exW,exH); // fills exactly, no letterboxing
  return outCv;
}

// Map a video frame index to a z value along the chosen direction and easing:
// forward 0→max, reverse max→0, or bounce 0→max→0.
function getZForFrame(frame,total,dir,ease){
  const zMax=+allZ[0].max||500;
  let t=frame/Math.max(1,total-1); // 0→1
  t=ease(t);
  if(dir==='fwd') return t*zMax;
  if(dir==='rev') return (1-t)*zMax;
  // bounce: 0→1→0
  return t<0.5 ? (t*2)*zMax : (2-t*2)*zMax;
}

// Choose a power-of-two sim grid roughly half the output size, floored at 128,
// so the FFT stays fast while the result upscales cleanly.
/* Half each dimension, snap to power of 2 */
function exSimDims(w,h){return[Math.pow(2,Math.max(7,Math.round(Math.log2(w/2)))),Math.pow(2,Math.max(7,Math.round(Math.log2(h/2))))]}

// PNG export: freeze any animation, render one frame at the captured z, and
// download it as a PNG. The setTimeout lets the status text paint first.
/* PNG export */
document.getElementById('btn-export-png').addEventListener('click',()=>{
  const wasAnimating=animDir;animDir=0;syncBars(); // pause to freeze preview
  const stat=document.getElementById('export-status');
  const[w,h]=exDims();
  const sN=S.N; // WYSIWYG: same sim grid as preview
  const capturedZ=S.z;
  stat.textContent='Rendering '+w+'×'+h+' at z='+capturedZ.toFixed(0)+'mm…';
  setTimeout(()=>{
    const cv=renderFrame(sN,sN,w,h,capturedZ);
    cv.toBlob(blob=>{
      if(!blob){stat.textContent='Export failed';return}
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=url;
      a.download='diffraction-'+w+'x'+h+'-z'+capturedZ.toFixed(0)+'mm.png';
      document.body.appendChild(a);a.click();document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      stat.textContent='Saved '+w+'×'+h+' PNG';
    },'image/png');
  },50);
});

// Video export runs in two phases: pre-render every frame to an ImageData array
// (so the slow propagation never competes with real-time encoding), then play
// those frames onto a canvas whose captureStream feeds a MediaRecorder to WebM.
/* Video export — pre-render all frames then encode */
let exporting=false;
document.getElementById('btn-export-vid').addEventListener('click',()=>{
  if(exporting)return;exporting=true;
  const stat=document.getElementById('export-status');
  const[w,h]=exDims();
  const fps=30;
  const dur=+document.getElementById('sl-dur').value||5;
  const reps=+document.getElementById('sl-rep').value||1;
  const dir=document.getElementById('sel-dir').value;
  const interpName=document.getElementById('sel-interp').value;
  const ease=EASE[interpName]||EASE.linear;
  const framesPerCycle=fps*dur;
  const totalFrames=framesPerCycle*reps;

  // Phase 1: pre-render all frames as ImageData
  const frames=[];
  let f=0;
  const sN=S.N; // WYSIWYG: same sim grid as preview
  stat.textContent='Rendering frame 1/'+totalFrames+'…';

  // Render frames one at a time via setTimeout so the UI stays responsive.
  function computeNext(){
    if(f>=totalFrames){startEncoding();return}
    const cycleFrame=f%framesPerCycle;
    const z=getZForFrame(cycleFrame,framesPerCycle,dir,ease);
    stat.textContent='Frame '+(f+1)+'/'+totalFrames+' · z='+z.toFixed(0)+'mm';
    const cv=renderFrame(sN,sN,w,h,z);
    frames.push(cv.getContext('2d').getImageData(0,0,w,h));
    f++;
    setTimeout(computeNext,0);
  }

  // Phase 2: pick a supported WebM codec, record the played-back frames, and
  // download the resulting blob. Fails gracefully if MediaRecorder is missing.
  function startEncoding(){
    stat.textContent='Encoding video…';
    const recCv=document.createElement('canvas');recCv.width=w;recCv.height=h;
    const recCtx=recCv.getContext('2d');

    let mimeType='video/webm;codecs=vp9';
    if(!MediaRecorder.isTypeSupported(mimeType))mimeType='video/webm;codecs=vp8';
    if(!MediaRecorder.isTypeSupported(mimeType))mimeType='video/webm';
    if(typeof MediaRecorder==='undefined'||!MediaRecorder.isTypeSupported(mimeType)){
      stat.textContent='Video not supported — try Chrome or Firefox';exporting=false;return;
    }

    const stream=recCv.captureStream(fps);
    const recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:8000000});
    const chunks=[];
    recorder.ondataavailable=e=>{if(e.data&&e.data.size>0)chunks.push(e.data)};
    recorder.onstop=()=>{
      const blob=new Blob(chunks,{type:mimeType.split(';')[0]});
      if(blob.size<100){stat.textContent='Encoding failed';exporting=false;return}
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=url;
      a.download='diffraction-'+w+'x'+h+'-'+dur+'s-'+dir+'.webm';
      document.body.appendChild(a);a.click();document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url),2000);
      stat.textContent='Saved '+w+'×'+h+' video · '+totalFrames+' frames';
      exporting=false;
    };

    recorder.start();
    let fi=0;
    function playFrame(){
      if(fi>=frames.length){setTimeout(()=>recorder.stop(),200);return}
      recCtx.putImageData(frames[fi],0,0);
      fi++;
      setTimeout(playFrame,1000/fps);
    }
    playFrame();
  }
  computeNext();
});

// Named presets: each sets an element, its params, and the viewing distance,
// extent, and wavelength divisions for a recognizable diffraction pattern.
/* ═══ PRESETS ═══ */
const PR=[
  {name:'Hex',el:'hex',p:{radius:.7},ext:5,z:200,div:15},
  {name:'Circle',el:'circular',p:{radius:.3},ext:3,z:150,div:15},
  {name:'Star ★',el:'star',p:{pts:5,radius:.6,inner:.38},ext:3,z:200,div:15},
  {name:'Heart ♥',el:'heart',p:{size:.5},ext:3,z:200,div:15},
  {name:'Ring ◯',el:'ring',p:{outer:.6,inner:.4},ext:3,z:200,div:15},
  {name:'Cross ✚',el:'cross',p:{arm:.6,width:.15},ext:3,z:200,div:15},
  {name:'Young\'s',el:'double',p:{slit_w:.04,sep:.3,height:3},ext:5,z:300,div:15},
  {name:'Grating',el:'grating-bin',p:{period:.15,width:3,height:3},ext:5,z:200,div:15},
  {name:'Lens',el:'lens-ap',p:{f:80,radius:.4},ext:.6,z:80,div:12},
  {name:'FZP',el:'fzp',p:{f:60,radius:.5},ext:.6,z:60,div:12},
  {name:'Slit',el:'rect',p:{width:.1,height:3},ext:5,z:200,div:15},
  {name:'6-Star',el:'star',p:{pts:6,radius:.6,inner:.45},ext:3,z:200,div:15},
];
// Apply one preset: copy its fields into S, sync every control to match, rebuild
// the parameter UI, push the preset's param values, and recompute.
function applyP(pr){animDir=0;S.element=pr.el;S.source=pr.src||'white';S.lambda=pr.lam||633;S.extent=pr.ext;S.z=pr.z;S.N=pr.N||256;S.divs=pr.div||15;S.speed=5;
  document.getElementById('element-select').value=pr.el;allZ.forEach(s=>s.max=Math.max(500,pr.z*3));
  syncSource();
  const slD=document.getElementById('sl-div');slD.value=S.divs;sg(slD);document.getElementById('vl-div').textContent=S.divs;
  document.querySelectorAll('.res-btn[data-n]').forEach(b=>b.classList.toggle('active',+b.dataset.n===S.N));
  document.querySelectorAll('.preset-btn').forEach(b=>b.classList.remove('on'));
  buildParamUI();const el=EL[pr.el];el.params.forEach(pd=>{if(pd.type==='file')return;if(pr.p[pd.id]!==undefined){const sl=document.getElementById('sl-p-'+pd.id);if(sl){if(pd.type==='text')sl.value=pr.p[pd.id];else{sl.value=pr.p[pd.id];sg(sl);const dec=pd.step<.01?3:pd.step<.1?2:pd.step<1?1:0;const vl=document.getElementById('vl-p-'+pd.id);if(vl)vl.textContent=pr.p[pd.id].toFixed(dec)}}}});
  syncBars();scheduleRecompute()}
// Build the preset button grid.
(function(){const g=document.getElementById('preset-grid');PR.forEach(pr=>{const b=document.createElement('button');b.className='preset-btn';b.textContent=pr.name;b.addEventListener('click',()=>{applyP(pr);b.classList.add('on')});g.appendChild(b)})})();

// Boot: set the wavelength swatch, build the param UI, sync the bars, and render.
(function(){syncScale();const rgb=lamRGB(S.lambda).map(x=>sGam(x)*255|0),dot=document.getElementById('wl-dot'),cs=`rgb(${rgb})`;dot.style.backgroundColor=cs;dot.style.color=cs;applyP(PR[0]);document.querySelectorAll('.preset-btn')[0].classList.add('on')})();

// Screensaver hook for the shell (lib/screensaver.js). enter() hides the GUI
// and pins #stage to the window, so the composite cell (and #cv-rgb, sized
// from it in renderCh) fills the frame. One rAF driver eases z on a slow sine
// around the preset distance and recomputes once per frame. It moves to the
// next preset (from opts.seed) every max(12, seconds/3) s, with a canvas fade.
// recompute is wrapped to fill the letterbox opaque, so a recording has no
// transparency. White light uses 10 wavelengths to keep a frame cheap.
/* ═══ SCREENSAVER ═══ */
window.snSaver={enter(opts){
  const calm=Math.max(0,Math.min(1,+opts.calm||0)),sp=1-0.6*calm;
  const st=document.createElement('style');
  st.textContent='html.saver .topbar,html.saver #panel,html.saver #eq-panel,html.saver #eq-toggle,html.saver #stage-bar,html.saver #dock,html.saver .cell-label,html.saver .ov{display:none!important}'+
    'html.saver #stage{position:fixed;inset:0;z-index:5;padding:0}html.saver #canvas-grid{padding:0}html.saver .canvas-cell{border-radius:0}html.saver #cv-rgb{cursor:none}';
  document.head.appendChild(st);document.documentElement.classList.add('saver');
  const names=['Hex','Circle','Star ★','Heart ♥','Ring ◯','Cross ✚','Young\'s','Lens','FZP','6-Star'];
  const list=names.map(n=>PR.find(p=>p.name===n)).filter(Boolean);
  const hold=Math.max(12,(+opts.seconds||60)/3),FADE=0.9;
  let pi=(opts.seed>>>0)%list.length,tp=0,tz=0,last=0;
  const show=()=>{applyP(list[pi]);S.divs=10;S.scale='log';S.range=2;animDir=0;tz=0;saverPlate(list[pi]);};
  saverLabel=opts.labels!==false&&typeof opts.label==='function'?opts.label:null;
  clearInterval(saverTimer);
  if(saverLabel)saverTimer=setInterval(()=>saverPlate(list[pi]),1000);
  if(S.viewMode!==1){S.viewMode=1;document.getElementById('canvas-grid').classList.add('view-1');}
  show();
  const base=recompute;
  recompute=function(){
    base();
    const cv=document.getElementById('cv-rgb'),c=cv.getContext('2d');
    c.save();c.setTransform(1,0,0,1,0,0);c.globalCompositeOperation='destination-over';c.fillStyle='#000';c.fillRect(0,0,cv.width,cv.height);
    c.globalCompositeOperation='source-over';
    const f=Math.max(0,1-tp/FADE,1-(hold-tp)/FADE);
    if(f>0){c.fillStyle=`rgba(0,0,0,${Math.min(1,f)})`;c.fillRect(0,0,cv.width,cv.height);}
    c.restore();
  };
  (function drive(now){
    requestAnimationFrame(drive);
    const dt=last?Math.min(0.25,(now-last)/1000):0;last=now;
    tp+=dt;tz+=dt*sp;
    if(tp>hold){tp=0;pi=(pi+1)%list.length;show();}
    // z from 0.8 to 2 times the preset distance, one slow cycle per 40 s at calm 0.
    S.z=list[pi].z*(1.4-0.6*Math.cos(tz*TAU/40));
    recompute();
  })(0);
  return{canvas:document.getElementById('cv-rgb'),warmupMs:2000};
},
exit(){saverLabel=null;clearInterval(saverTimer);saverTimer=0;}};
// The plate (opts.label) names the preset and its element, the aperture
// parameters from readParams() with the units that EL[...].t() applies (mm,
// except the star point count and inner ratio), and the live z, field width,
// grid pitch and Fresnel number with the same formula and regime words as
// recompute(). The equations are the angular spectrum step that prop() runs,
// the white-light sum in fieldRGB(), and the transmittance of the element.
let saverLabel=null,saverTimer=0;
const SAVER_T={lens:'t = e^(−iπr²/(λf)) for r < R',fzp:'t = e^(−ik(√(f² + r²) − f)) for r < R'};
function saverPlate(pr){
  if(!saverLabel||!pr)return;
  const el=EL[S.element],p=readParams(),f2=v=>(+v).toFixed(v<.1?3:2);
  const parts=el.params.filter(pd=>pd.type!=='file'&&pd.type!=='text').map(pd=>
    pd.label+' = '+(+p[pd.id]).toFixed(pd.step<.01?3:pd.step<.1?2:pd.step<1?1:0)+(pd.id==='pts'?'':S.element==='star'&&pd.id==='inner'?' R':' mm'));
  const aC=p.radius||p.outer||p.width||p.slit_w||p.arm||p.size||0,lam0=S.source==='mono'?S.lambda:550;
  const Nf=aC>0&&S.z>0?(aC*mm)**2/(lam0*nm*S.z*mm):0;
  const lines=[el.name+' aperture · '+parts.join(' · ')];
  lines.push('z = '+S.z.toFixed(0)+' mm · field '+S.extent+' mm · '+S.N+'² grid · dx = '+(S.extent*1000/S.N).toFixed(1)+' µm');
  lines.push(S.source==='white'?'white light: D65, '+S.divs+' wavelengths from 380 to 780 nm':'λ = '+S.lambda+' nm');
  if(Nf>0)lines.push('N_F = a²/(λz) = '+(Nf<.01?Nf.toExponential(1):Nf.toFixed(2))+' (a = '+f2(aC)+' mm, λ = '+lam0+' nm) · '+(Nf>5?'shadow':Nf>.5?'Fresnel':'Fraunhofer'));
  const eq=['E(z) = F⁻¹{ F{t} · e^(i k_z z) }',
    'k_z = √(k² − kₓ² − k_y²),   k = 2π/λ',
    'I = |E|²,   XYZ = Σ_λ I · D65 · (x̄, ȳ, z̄)'];
  eq.push(SAVER_T[pr.el==='lens-ap'?'lens':pr.el]||'t = 1 inside the aperture, 0 outside');
  saverLabel({
    title:'Diffraction · '+pr.name,
    sub:'angular spectrum propagation · scalar field · log tone, 2 decades',
    lines,eq,
  });
}
