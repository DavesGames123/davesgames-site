// ============================================================================
//  NAVIER–STOKES NUMERICS  ·  FFT + pseudo-spectral solvers (loaded before main)
// ----------------------------------------------------------------------------
//  Plain globals, no DOM. main.js constructs one solver per fluid view and steps
//  it. Every solver is pseudo-spectral: linear operators (derivatives, the
//  Laplacian, viscosity) are exact and diagonal in Fourier space, and only the
//  quadratic nonlinear term is formed in physical space.
//
//  ONE PSEUDO-SPECTRAL STEP  (the shape shared by all three solvers)
//  ----------------------------------------------------------------------------
//      spectral field  ŵ
//         │  inverse FFT
//         ▼
//      physical u, ω ──▶ form nonlinear product (u·ω, u², u×ω) in real space
//         │  forward FFT
//         ▼
//      product spectrum ──▶ take derivative (× ik), project divergence-free,
//         │                 zero the top 1/3 of |k| (the 2/3 dealias mask)
//         ▼
//      right-hand side  ──▶ RK4 / Heun advance ── viscosity via e^{-νk²h}
//
//  Dealiasing: a quadratic product can fold energy from high wavenumbers back
//  into the resolved band (aliasing). Zeroing |k| ≥ n/3 before the product makes
//  that impossible — the 2/3 rule.
//
//  SECTION MAP   (jump with grep -n "<anchor>" script-2.js)
//  ----------------------------------------------------------------------------
//      FFT core ............. "function fft1"      radix-2, bit-reversal + tables
//      N-D FFT .............. "function fftND"     FFT along each axis in turn
//      1D Burgers ........... "class Burgers"      Strang split viscosity + RK4
//      2D Navier–Stokes ..... "class Flow2D"       vorticity form, RK4
//      3D Navier–Stokes ..... "class Flow3D"       velocity form, Heun + e^{-νk²}
//      Helmholtz demo ....... "function helmholtz" Leray split for the equations
// ============================================================================
/* radix-2 complex FFT, in place. forward: e^{-ikx}; inverse divides by n */
// Caches per length n: bit-reversal permutation + twiddle tables (fftTable), and
// scratch buffers for the axis transforms (_fftScratch).
const _fftTab={}, _fftScratch={};
// Build (once per n) the bit-reversal index array and the cos/sin twiddle tables.
function fftTable(n){ let t=_fftTab[n]; if(t) return t; const rev=new Uint32Array(n), bits=Math.round(Math.log2(n));
  for(let i=0;i<n;i++){ let r=0,x=i; for(let b=0;b<bits;b++){ r=(r<<1)|(x&1); x>>=1; } rev[i]=r; }
  const cos=new Float64Array(n/2), sin=new Float64Array(n/2); for(let i=0;i<n/2;i++){ cos[i]=Math.cos(2*Math.PI*i/n); sin[i]=Math.sin(2*Math.PI*i/n); }
  return _fftTab[n]={rev,cos,sin}; }
// In-place radix-2 Cooley–Tukey FFT of length n: bit-reversal reorder, then
// butterflies over doubling stages; the inverse divides by n. inv flips the
// twiddle sign.
function fft1(re,im,n,inv){ const {rev,cos,sin}=fftTable(n);
  for(let i=0;i<n;i++){ const j=rev[i]; if(j>i){ let t=re[i];re[i]=re[j];re[j]=t; t=im[i];im[i]=im[j];im[j]=t; } }
  for(let len=2;len<=n;len<<=1){ const half=len>>1, step=n/len;
    for(let i=0;i<n;i+=len){ for(let j=0;j<half;j++){ const k=j*step, wr=cos[k], wi=inv?sin[k]:-sin[k], a=i+j, b=a+half;
      const xr=re[b]*wr-im[b]*wi, xi=re[b]*wi+im[b]*wr; re[b]=re[a]-xr; im[b]=im[a]-xi; re[a]+=xr; im[a]+=xi; } } }
  if(inv){ const s=1/n; for(let i=0;i<n;i++){ re[i]*=s; im[i]*=s; } } }
// Transform one axis of a flat N-D array: gather each pencil of length n (with the
// right stride) into scratch, FFT it, and scatter it back.
function fftAxis(re,im,dims,axis,inv){ const n=dims[axis]; let stride=1; for(let a=0;a<axis;a++) stride*=dims[a];
  const N=re.length, outer=N/(stride*n); let sc=_fftScratch[n]; if(!sc) sc=_fftScratch[n]={r:new Float64Array(n),i:new Float64Array(n)}; const tr=sc.r, ti=sc.i;
  for(let o=0;o<outer;o++) for(let s=0;s<stride;s++){ const base=o*stride*n+s;
    for(let j=0;j<n;j++){ tr[j]=re[base+j*stride]; ti[j]=im[base+j*stride]; } fft1(tr,ti,n,inv);
    for(let j=0;j<n;j++){ re[base+j*stride]=tr[j]; im[base+j*stride]=ti[j]; } } }
// Separable N-D FFT: transform along every axis in turn.
function fftND(re,im,dims,inv){ for(let a=0;a<dims.length;a++) fftAxis(re,im,dims,a,inv); }
// Signed wavenumber for index i (upper half wraps to negative), and a Float64 alloc.
const wavenum=(i,n)=>i<n/2?i:i-n;
const F64=n=>new Float64Array(n);

/* ─── 1D viscous Burgers, pseudo-spectral, Strang-split viscosity + RK4 ─── */
// State ur/ui is u in Fourier space; u and ux are the physical value and slope.
// k is the wavenumber array; mask is the 2/3 dealias filter; s is a pool of
// scratch/RK4-stage buffers.
class Burgers{
  constructor(n=1024){ this.n=n; this.k=F64(n); this.mask=new Uint8Array(n); for(let i=0;i<n;i++){ this.k[i]=wavenum(i,n); this.mask[i]=Math.abs(this.k[i])<n/3?1:0; }
    this.ur=F64(n); this.ui=F64(n); this.u=F64(n); this.ux=F64(n); this.nu=0.02; this.t=0; this.ic='sine';
    this.s=Array.from({length:12},()=>F64(n)); this.hist=[]; }
  // The three initial profiles: sine, an N-wave bump, and a random sum of modes.
  u0(x){ return this.ic==='sine'?Math.sin(x):this.ic==='bump'?Math.exp(-(((x-Math.PI)/0.6)**2))*1.5-0.6*Math.exp(-(((x-Math.PI)/1.6)**2)):0.8*Math.sin(x)+0.5*Math.sin(2*x+1.3)+0.3*Math.cos(3*x); }
  // Sample the initial profile, transform to spectral, reset time, and record the
  // starting steepest slope q0 (which fixes the inviscid breaking time 1/q0).
  setIC(name){ if(name) this.ic=name; const n=this.n; for(let i=0;i<n;i++){ this.ur[i]=this.u0(2*Math.PI*i/n); this.ui[i]=0; } fft1(this.ur,this.ui,n,false); this.t=0; this.hist=[]; this.phys(); this.q0=this.maxSlope(); }
  // Recover the physical field u and its derivative ux (ux via ik in spectral space).
  phys(){ const n=this.n,[a,b,c,d]=this.s; a.set(this.ur); b.set(this.ui); fft1(a,b,n,true); this.u.set(a);
    for(let i=0;i<n;i++){ c[i]=-this.k[i]*this.ui[i]; d[i]=this.k[i]*this.ur[i]; } fft1(c,d,n,true); this.ux.set(c); }
  // Advective right-hand side −∂ₓ(u²/2): square u in physical space, transform back,
  // multiply by −ik, and dealias.
  rhs(ur,ui,outr,outi){ const n=this.n,[a,b]=this.s; a.set(ur); b.set(ui); fft1(a,b,n,true);
    for(let i=0;i<n;i++){ a[i]=0.5*a[i]*a[i]; b[i]=0; } fft1(a,b,n,false);
    for(let i=0;i<n;i++){ const m=this.mask[i]; outr[i]=this.k[i]*b[i]*m; outi[i]=-this.k[i]*a[i]*m; } } // −ik F(u²/2)
  // Exact viscous half-step: multiply each mode by the heat-kernel factor e^{-νk²h}.
  visc(h){ const n=this.n; for(let i=0;i<n;i++){ const e=Math.exp(-this.nu*this.k[i]*this.k[i]*h); this.ur[i]*=e; this.ui[i]*=e; } }
  // One time step, Strang split: half viscosity, RK4 on advection, half viscosity.
  step(dt){ const n=this.n,[,,,,k1r,k1i,k2r,k2i,tr,ti,k3r,k3i]=this.s; this.visc(dt/2);
    this.rhs(this.ur,this.ui,k1r,k1i); for(let i=0;i<n;i++){ tr[i]=this.ur[i]+dt/2*k1r[i]; ti[i]=this.ui[i]+dt/2*k1i[i]; }
    this.rhs(tr,ti,k2r,k2i); for(let i=0;i<n;i++){ tr[i]=this.ur[i]+dt/2*k2r[i]; ti[i]=this.ui[i]+dt/2*k2i[i]; }
    this.rhs(tr,ti,k3r,k3i); for(let i=0;i<n;i++){ tr[i]=this.ur[i]+dt*k3r[i]; ti[i]=this.ui[i]+dt*k3i[i]; k1r[i]+=2*k2r[i]+2*k3r[i]; k1i[i]+=2*k2i[i]+2*k3i[i]; }
    this.rhs(tr,ti,k2r,k2i); for(let i=0;i<n;i++){ this.ur[i]+=dt/6*(k1r[i]+k2r[i]); this.ui[i]+=dt/6*(k1i[i]+k2i[i]); }
    this.visc(dt/2); this.t+=dt; this.phys(); }
  // Steepest downhill slope max(−ux): the quantity that would diverge inviscidly.
  maxSlope(){ let m=0; for(let i=0;i<this.n;i++) m=Math.max(m,-this.ux[i]); return m; }
  // Kinetic energy ½⟨u²⟩.
  energy(){ let e=0; for(let i=0;i<this.n;i++) e+=this.u[i]*this.u[i]; return 0.5*e/this.n; }
  // Append a diagnostics sample (time, slope, energy) for the plots.
  record(){ this.hist.push({t:this.t,q:this.maxSlope(),E:this.energy()}); }
}

/* ─── 2D Navier–Stokes, vorticity form, pseudo-spectral 2/3-dealiased, RK4 ─── */
// State wr/wi is the scalar vorticity ω in Fourier space. kx/ky/k2 are the
// wavevector components and |k|²; velocity is recovered from ω each step by
// solving one Poisson problem (the streamfunction). S is a scratch/stage pool.
class Flow2D{
  constructor(n=128){ this.n=n; const N=n*n; this.N=N; this.dims=[n,n]; this.kx=F64(N); this.ky=F64(N); this.k2=F64(N); this.mask=new Uint8Array(N);
    for(let j=0;j<n;j++) for(let i=0;i<n;i++){ const p=i+n*j, kx=wavenum(i,n), ky=wavenum(j,n); this.kx[p]=kx; this.ky[p]=ky; this.k2[p]=kx*kx+ky*ky; this.mask[p]=(Math.abs(kx)<n/3&&Math.abs(ky)<n/3)?1:0; }
    this.wr=F64(N); this.wi=F64(N); this.u=F64(N); this.v=F64(N); this.om=F64(N);
    this.S=Array.from({length:18},()=>F64(N)); this.nu=0.01; this.t=0; this.hist=[]; this.ic='random'; this.steps=0; }
  // Build the chosen initial vorticity in physical space, transform to spectral,
  // remove the mean, and record the reference energy/enstrophy/max used by the
  // fixed colour scale and the decay overlays.
  setIC(name){ if(name) this.ic=name; const n=this.n; const w=this.wr, wi=this.wi; wi.fill(0); const cx=Math.PI, cy=Math.PI;
    const rnd=[]; for(let m=0;m<12;m++) rnd.push([3+Math.floor(Math.random()*5)*(Math.random()<.5?1:-1),3+Math.floor(Math.random()*5)*(Math.random()<.5?1:-1),Math.random()*6.28,Math.random()<.5?1:-1]);
    for(let j=0;j<n;j++) for(let i=0;i<n;i++){ const x=2*Math.PI*i/n, y=2*Math.PI*j/n, p=i+n*j; let o=0;
      switch(this.ic){
        case 'taylor-green': o=2*Math.sin(x)*Math.sin(y); break;
        case 'lamb-oseen': { const t0=0.0625/this.nu; o=(6/(4*Math.PI*this.nu*t0))*Math.exp(-((x-cx)**2+(y-cy)**2)/(4*this.nu*t0)); this.t0=t0; } break;
        case 'random': for(const [a,b,ph,sg] of rnd) o+=sg*Math.cos(a*x+b*y+ph); o*=0.6; break;
        case 'shear': { const d=0.12; const s1=1/Math.cosh((y-Math.PI/2)/d), s2=1/Math.cosh((y-3*Math.PI/2)/d); o=(s1*s1-s2*s2)/d*0.5 + 0.35*(Math.sin(2*x)*Math.exp(-(((y-Math.PI/2)/(2*d))**2))-Math.sin(2*x+1)*Math.exp(-(((y-3*Math.PI/2)/(2*d))**2))); } break;
        case 'dipole': { const s=0.22, dx=x-cx; o=9*(Math.exp(-(dx*dx+(y-cy-0.42)**2)/(2*s*s))-Math.exp(-(dx*dx+(y-cy+0.42)**2)/(2*s*s))); } break;
      } w[p]=o; }
    fftND(w,wi,this.dims,false); w[0]=0; wi[0]=0; this.t=0; this.hist=[]; this.steps=0; this.rhs(w,wi,this.S[0],this.S[1]); this.w0max=this.maxOm(); this.E0=this.energy(); this.Z0=this.enstrophy(); }
  // Vorticity right-hand side −u·∇ω + νΔω. Recover velocity from ω through the
  // streamfunction (u = ∇⊥Δ⁻¹ω), form the fluxes uω and vω in physical space,
  // take their divergence in spectral space, dealias, and add viscosity.
  rhs(wr,wi,outr,outi){ const n=this.n,N=this.N,S=this.S,[ur,ui,vr,vi,or,oi,ar,ai,br,bi]=S;
    // Solve for velocity: ψ̂ = −ω̂/k², then u = (−∂ᵧψ, ∂ₓψ); the k=0 mean is dropped.
    for(let p=0;p<N;p++){ const k2=this.k2[p]; if(k2===0){ ur[p]=ui[p]=vr[p]=vi[p]=0; } else { const pr=-wr[p]/k2, pi=-wi[p]/k2, kx=this.kx[p], ky=this.ky[p]; ur[p]=-ky*pi; ui[p]=ky*pr; vr[p]=kx*pi; vi[p]=-kx*pr; } or[p]=wr[p]; oi[p]=wi[p]; }
    fftND(ur,ui,this.dims,true); fftND(vr,vi,this.dims,true); fftND(or,oi,this.dims,true);
    for(let p=0;p<N;p++){ this.u[p]=ur[p]; this.v[p]=vr[p]; this.om[p]=or[p]; ar[p]=ur[p]*or[p]; ai[p]=0; br[p]=vr[p]*or[p]; bi[p]=0; }
    fftND(ar,ai,this.dims,false); fftND(br,bi,this.dims,false);
    for(let p=0;p<N;p++){ const m=this.mask[p], nk=this.nu*this.k2[p]; outr[p]=(this.kx[p]*ai[p]+this.ky[p]*bi[p])*m-nk*wr[p]; outi[p]=-(this.kx[p]*ar[p]+this.ky[p]*br[p])*m-nk*wi[p]; } }
  // One classical RK4 step of the vorticity equation; the diagnostics from stage 1
  // (energy, enstrophy, max|ω|) are cached for the readout.
  step(dt){ const N=this.N,S=this.S; const k1r=S[10],k1i=S[11],k2r=S[12],k2i=S[13],tr=S[14],ti=S[15],acr=S[16],aci=S[17]; const wr=this.wr, wi=this.wi; // rhs uses S[0..9] as workspace
    this.rhs(wr,wi,k1r,k1i); this.lastE=this.energy(); this.lastZ=this.enstrophy(); this.lastMax=this.maxOm();
    for(let p=0;p<N;p++){ tr[p]=wr[p]+dt/2*k1r[p]; ti[p]=wi[p]+dt/2*k1i[p]; } this.rhs(tr,ti,k2r,k2i);
    for(let p=0;p<N;p++){ acr[p]=k1r[p]+2*k2r[p]; aci[p]=k1i[p]+2*k2i[p]; tr[p]=wr[p]+dt/2*k2r[p]; ti[p]=wi[p]+dt/2*k2i[p]; }
    this.rhs(tr,ti,k2r,k2i); for(let p=0;p<N;p++){ acr[p]+=2*k2r[p]; aci[p]+=2*k2i[p]; tr[p]=wr[p]+dt*k2r[p]; ti[p]=wi[p]+dt*k2i[p]; }
    this.rhs(tr,ti,k2r,k2i); for(let p=0;p<N;p++){ wr[p]+=dt/6*(acr[p]+k2r[p]); wi[p]+=dt/6*(aci[p]+k2i[p]); }
    this.t+=dt; this.steps++; }
  // Stable timestep: the smaller of an advective CFL limit and a viscous limit.
  dtCFL(){ let um=1e-6; for(let p=0;p<this.N;p++) um=Math.max(um,Math.abs(this.u[p]),Math.abs(this.v[p])); const dx=2*Math.PI/this.n; return Math.min(0.02, 0.5*dx/um, 2.0/(this.nu*(this.n/3)**2*2)); }
  // Energy ½⟨|u|²⟩, enstrophy ½⟨ω²⟩, and peak |ω| — all monotone in 2D.
  energy(){ let e=0; for(let p=0;p<this.N;p++) e+=this.u[p]*this.u[p]+this.v[p]*this.v[p]; return 0.5*e/this.N; }
  enstrophy(){ let z=0; for(let p=0;p<this.N;p++) z+=this.om[p]*this.om[p]; return 0.5*z/this.N; }
  maxOm(){ let m=0; for(let p=0;p<this.N;p++) m=Math.max(m,Math.abs(this.om[p])); return m; }
  // Append a diagnostics sample for the plots.
  record(){ this.hist.push({t:this.t,E:this.lastE,Z:this.lastZ,m:this.lastMax}); }
}

/* ─── 3D Navier–Stokes, velocity form, spectral, Heun + integrating-factor viscosity ─── */
// State U is the velocity in Fourier space as three [real, imag] pairs. Here the
// nonlinear term is carried in rotational form u×ω and then projected onto
// divergence-free fields, which removes the pressure. P holds the physical
// velocity for particle advection; omMag holds |ω| for the point colours.
class Flow3D{
  constructor(n=32){ this.n=n; const N=n*n*n; this.N=N; this.dims=[n,n,n]; this.kx=F64(N); this.ky=F64(N); this.kz=F64(N); this.k2=F64(N); this.mask=new Uint8Array(N);
    for(let k=0;k<n;k++) for(let j=0;j<n;j++) for(let i=0;i<n;i++){ const p=i+n*(j+n*k), a=wavenum(i,n), b=wavenum(j,n), c=wavenum(k,n); this.kx[p]=a; this.ky[p]=b; this.kz[p]=c; this.k2[p]=a*a+b*b+c*c; this.mask[p]=(Math.abs(a)<n/3&&Math.abs(b)<n/3&&Math.abs(c)<n/3)?1:0; }
    this.U=[[F64(N),F64(N)],[F64(N),F64(N)],[F64(N),F64(N)]]; this.P=[F64(N),F64(N),F64(N)]; this.omMag=new Float32Array(N);
    this.S=Array.from({length:18},()=>F64(N)); this.nu=0.01; this.t=0; this.hist=[]; this.ic='taylor-green'; this.bkm=0; this.msStep=0; }
  // Set the initial velocity for the chosen case (Taylor–Green base, or ABC) in
  // physical space, then transform to spectral. The vortex column adds a curl-based
  // field afterward.
  setIC(name){ if(name) this.ic=name; const n=this.n; for(let c=0;c<3;c++){ this.U[c][1].fill(0); }
    for(let k=0;k<n;k++) for(let j=0;j<n;j++) for(let i=0;i<n;i++){ const x=2*Math.PI*i/n,y=2*Math.PI*j/n,z=2*Math.PI*k/n,p=i+n*(j+n*k);
      if(this.ic==='taylor-green'||this.ic==='column'){ this.U[0][0][p]=Math.sin(x)*Math.cos(y)*Math.cos(z); this.U[1][0][p]=-Math.cos(x)*Math.sin(y)*Math.cos(z); this.U[2][0][p]=0; }
      else { const A=1,B=Math.sqrt(2/3),C=Math.sqrt(1/3); this.U[0][0][p]=A*Math.sin(z)+C*Math.cos(y); this.U[1][0][p]=B*Math.sin(x)+A*Math.cos(z); this.U[2][0][p]=C*Math.sin(y)+B*Math.cos(x); } }
    for(let c=0;c<3;c++) fftND(this.U[c][0],this.U[c][1],this.dims,false);
    if(this.ic==='column'){ // Gaussian vortex column with a helical kink, plus a weak axial jet: u = curl^{-1} P ω
      const N=this.N, oz=F64(N), ozi=F64(N), jr=F64(N), ji=F64(N), r0=0.5;
      for(let k=0;k<n;k++) for(let j=0;j<n;j++) for(let i=0;i<n;i++){ const x=2*Math.PI*i/n,y=2*Math.PI*j/n,z=2*Math.PI*k/n,p=i+n*(j+n*k); const xc=Math.PI+0.35*Math.cos(z), yc=Math.PI+0.35*Math.sin(z); oz[p]=7*Math.exp(-((x-xc)**2+(y-yc)**2)/(r0*r0)); jr[p]=0.5*Math.exp(-((x-Math.PI)**2+(y-Math.PI)**2)/(r0*r0)); }
      fftND(oz,ozi,this.dims,false); fftND(jr,ji,this.dims,false);
      for(let p=0;p<N;p++){ const k2=this.k2[p]; if(k2===0){ for(let c=0;c<3;c++){ this.U[c][0][p]=0; this.U[c][1][p]=0; } continue; } const kx=this.kx[p],ky=this.ky[p],kz=this.kz[p];
        // project ω=(0,0,oz) onto divergence-free fields
        const dr=kz*oz[p]/k2, di=kz*ozi[p]/k2; const wxr=-kx*dr, wxi=-kx*di, wyr=-ky*dr, wyi=-ky*di, wzr=oz[p]-kz*dr, wzi=ozi[p]-kz*di;
        // û = i (k×ω̂)/k²
        const cxr=ky*wzr-kz*wyr, cxi=ky*wzi-kz*wyi, cyr=kz*wxr-kx*wzr, cyi=kz*wxi-kx*wzi, czr=kx*wyr-ky*wxr, czi=kx*wyi-ky*wxi;
        this.U[0][0][p]=-cxi/k2; this.U[0][1][p]=cxr/k2; this.U[1][0][p]=-cyi/k2; this.U[1][1][p]=cyr/k2; this.U[2][0][p]=-czi/k2+jr[p]; this.U[2][1][p]=czr/k2+ji[p]; }
      this.U[2][0][0]=0; this.U[2][1][0]=0; }
    // Prime the diagnostics and store the reference energy/enstrophy/max.
    this.t=0; this.hist=[]; this.bkm=0; this.rhs(this.U,this.S.slice(0,6)); this.diag(); this.E0=this.lastE; this.Z0=this.lastZ; this.m0=this.lastMax; }
  // trilinear velocity at a point in [0,2π)^3, from the last physical field
  velAt(x,y,z,out){ const n=this.n, h=n/(2*Math.PI); let fx=x*h, fy=y*h, fz=z*h; fx-=Math.floor(fx/n)*n; fy-=Math.floor(fy/n)*n; fz-=Math.floor(fz/n)*n; const i0=Math.floor(fx), j0=Math.floor(fy), k0=Math.floor(fz); const tx=fx-i0, ty=fy-j0, tz=fz-k0; const i1=(i0+1)%n, j1=(j0+1)%n, k1=(k0+1)%n;
    for(let c=0;c<3;c++){ const P=this.P[c]; const id=(i,j,k)=>P[i+n*(j+n*k)]; const c00=id(i0,j0,k0)*(1-tx)+id(i1,j0,k0)*tx, c10=id(i0,j1,k0)*(1-tx)+id(i1,j1,k0)*tx, c01=id(i0,j0,k1)*(1-tx)+id(i1,j0,k1)*tx, c11=id(i0,j1,k1)*(1-tx)+id(i1,j1,k1)*tx; out[c]=(c00*(1-ty)+c10*ty)*(1-tz)+(c01*(1-ty)+c11*ty)*tz; } }
  // out: array of 6 arrays [r0,i0,r1,i1,r2,i2] = P[u×ω]^ ; also fills physical u (P) and |ω|
  rhs(U,out){ const N=this.N, S=this.S, ur=S[6],ui=S[7],vr=S[8],vi=S[9],wr=S[10],wi=S[11], oxr=S[12],oxi=S[13],oyr=S[14],oyi=S[15],ozr=S[16],ozi=S[17];
    for(let p=0;p<N;p++){ const kx=this.kx[p],ky=this.ky[p],kz=this.kz[p]; const [[ar,ai],[br,bi],[cr,ci]]=U;
      ur[p]=ar[p];ui[p]=ai[p]; vr[p]=br[p];vi[p]=bi[p]; wr[p]=cr[p];wi[p]=ci[p];
      // ω̂ = i k×û
      const zxr=ky*cr[p]-kz*br[p], zxi=ky*ci[p]-kz*bi[p]; oxr[p]=-zxi; oxi[p]=zxr;
      const zyr=kz*ar[p]-kx*cr[p], zyi=kz*ai[p]-kx*ci[p]; oyr[p]=-zyi; oyi[p]=zyr;
      const zzr=kx*br[p]-ky*ar[p], zzi=kx*bi[p]-ky*ai[p]; ozr[p]=-zzi; ozi[p]=zzr; }
    for(const [r,i] of [[ur,ui],[vr,vi],[wr,wi],[oxr,oxi],[oyr,oyi],[ozr,ozi]]) fftND(r,i,this.dims,true);
    let mx=0; for(let p=0;p<N;p++){ const u=ur[p],v=vr[p],w=wr[p],ox=oxr[p],oy=oyr[p],oz=ozr[p]; this.P[0][p]=u; this.P[1][p]=v; this.P[2][p]=w; const m=Math.sqrt(ox*ox+oy*oy+oz*oz); this.omMag[p]=m; if(m>mx)mx=m;
      out[0][p]=v*oz-w*oy; out[1][p]=0; out[2][p]=w*ox-u*oz; out[3][p]=0; out[4][p]=u*oy-v*ox; out[5][p]=0; }
    this._max=mx; this._Z=0; for(let p=0;p<N;p++) this._Z+=this.omMag[p]*this.omMag[p]; this._Z*=0.5/N;
    this._E=0; for(let p=0;p<N;p++) this._E+=ur[p]*ur[p]+vr[p]*vr[p]+wr[p]*wr[p]; this._E*=0.5/N;
    for(let c=0;c<3;c++) fftND(out[2*c],out[2*c+1],this.dims,false);
    for(let p=0;p<N;p++){ const k2=this.k2[p], m=this.mask[p]; if(k2===0||!m){ for(let c=0;c<6;c++) out[c][p]=0; continue; } const kx=this.kx[p],ky=this.ky[p],kz=this.kz[p];
      const dr=(kx*out[0][p]+ky*out[2][p]+kz*out[4][p])/k2, di=(kx*out[1][p]+ky*out[3][p]+kz*out[5][p])/k2;
      out[0][p]-=kx*dr; out[1][p]-=kx*di; out[2][p]-=ky*dr; out[3][p]-=ky*di; out[4][p]-=kz*dr; out[5][p]-=kz*di; } }
  // Publish the diagnostics gathered during the last rhs() into the last* fields.
  diag(){ this.lastE=this._E; this.lastZ=this._Z; this.lastMax=this._max; }
  // One Heun (predictor–corrector) step with viscosity applied as an exact
  // integrating factor e^{-νk²dt}, and accumulate the Beale–Kato–Majda integral bkm.
  step(dt){ const N=this.N,S=this.S; const t0=performance.now(); const N1=S.slice(0,6); this.rhs(this.U,N1); this.diag(); this.bkm+=this.lastMax*dt;
    const Ustar=[[F64(0),F64(0)],[F64(0),F64(0)],[F64(0),F64(0)]]; // views into scratch: reuse S[6..11] after rhs used them (safe: rhs done)
    Ustar[0]=[S[6],S[7]]; Ustar[1]=[S[8],S[9]]; Ustar[2]=[S[10],S[11]];
    for(let c=0;c<3;c++){ const [ur,ui]=this.U[c]; for(let p=0;p<N;p++){ const e=Math.exp(-this.nu*this.k2[p]*dt); Ustar[c][0][p]=e*(ur[p]+dt*N1[2*c][p]); Ustar[c][1][p]=e*(ui[p]+dt*N1[2*c+1][p]); } }
    const N2=[S[12],S[13],S[14],S[15],S[16],S[17]]; // rhs will overwrite S[6..17] while reading U*: copy U* first into fresh arrays
    const Uc=Ustar.map(([r,i])=>[Float64Array.from(r),Float64Array.from(i)]);
    this.rhs(Uc,N2);
    for(let c=0;c<3;c++){ const [ur,ui]=this.U[c]; for(let p=0;p<N;p++){ const e=Math.exp(-this.nu*this.k2[p]*dt); ur[p]=e*ur[p]+dt/2*(e*N1[2*c][p]+N2[2*c][p]); ui[p]=e*ui[p]+dt/2*(e*N1[2*c+1][p]+N2[2*c+1][p]); } }
    this.t+=dt; this.msStep=performance.now()-t0; }
  // Advective CFL timestep from the peak physical speed.
  dtCFL(){ let um=1e-6; for(let c=0;c<3;c++) for(let p=0;p<this.N;p++) um=Math.max(um,Math.abs(this.P[c][p])); return Math.min(0.03,0.6*(2*Math.PI/this.n)/um); }
  // Append a diagnostics sample (with the BKM integral) for the plots.
  record(){ this.hist.push({t:this.t,E:this.lastE,Z:this.lastZ,m:this.lastMax,bkm:this.bkm}); }
}

/* ─── Helmholtz / Leray decomposition demo ─── */
// Build a random smooth 2D vector field f and split it, in Fourier space, into a
// gradient part ∇φ and a divergence-free remainder Pf = f − ∇φ. Returns both
// parts, the potential φ, the divergence field, and its peak before and after
// projection — the equations view draws these three panels.
function helmholtz(n){ const N=n*n, dims=[n,n]; const fr=F64(N),fi=F64(N),gr=F64(N),gi=F64(N); const modes=[]; for(let m=0;m<7;m++) modes.push([Math.floor(Math.random()*7)-3,Math.floor(Math.random()*7)-3,Math.random()*6.28,Math.random()*6.28-3.14,Math.random()*6.28-3.14]);
  const fx=F64(N),fy=F64(N); for(let j=0;j<n;j++) for(let i=0;i<n;i++){ const x=2*Math.PI*i/n,y=2*Math.PI*j/n,p=i+n*j; let a=0,b=0; for(const [kx,ky,ph,ca,cb] of modes){ if(kx===0&&ky===0) continue; const c=Math.cos(kx*x+ky*y+ph); a+=ca*c; b+=cb*c; } fx[p]=a; fy[p]=b; }
  const ar=Float64Array.from(fx), ai=F64(N), br=Float64Array.from(fy), bi=F64(N); fftND(ar,ai,dims,false); fftND(br,bi,dims,false);
  const gxr=F64(N),gxi=F64(N),gyr=F64(N),gyi=F64(N),phr=F64(N),phi=F64(N),dr=F64(N),di=F64(N);
  for(let j=0;j<n;j++) for(let i=0;i<n;i++){ const p=i+n*j,kx=wavenum(i,n),ky=wavenum(j,n),k2=kx*kx+ky*ky; const sr=kx*ar[p]+ky*br[p], si=kx*ai[p]+ky*bi[p];
    dr[p]=-si; di[p]=sr; // div = i k·f̂
    if(k2){ gxr[p]=kx*sr/k2; gxi[p]=kx*si/k2; gyr[p]=ky*sr/k2; gyi[p]=ky*si/k2; phr[p]=si/k2; phi[p]=-sr/k2; } }
  for(const [r,i] of [[gxr,gxi],[gyr,gyi],[phr,phi],[dr,di]]) fftND(r,i,dims,true);
  const wx=F64(N),wy=F64(N); for(let p=0;p<N;p++){ wx[p]=fx[p]-gxr[p]; wy[p]=fy[p]-gyr[p]; }
  // divergence of the projected field, for the readout
  const cr=Float64Array.from(wx),ci=F64(N),er=Float64Array.from(wy),ei=F64(N); fftND(cr,ci,dims,false); fftND(er,ei,dims,false); let dv=0;
  for(let j=0;j<n;j++) for(let i=0;i<n;i++){ const p=i+n*j,kx=wavenum(i,n),ky=wavenum(j,n); dv=Math.max(dv,Math.hypot(kx*cr[p]+ky*er[p],kx*ci[p]+ky*ei[p])/N); }
  let dmax=0; for(let p=0;p<N;p++) dmax=Math.max(dmax,Math.abs(dr[p]));
  return {n,fx,fy,wx,wy,gx:gxr,gy:gyr,phi:phr,div:dr,divMax:dmax,divProjMax:dv};
}
