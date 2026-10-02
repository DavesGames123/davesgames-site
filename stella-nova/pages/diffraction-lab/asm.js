// ============================================================================
//  APERTURE DIFFRACTION  ·  asm.js  ·  cached angular spectrum engine
// ----------------------------------------------------------------------------
//  The propagation step of main.js, split in two halves. The z-free half runs
//  once per aperture setup: the forward FFT of the mask and kz per frequency.
//  The z half runs per frame: one complex multiply and one inverse FFT.
//  The page (main.js) and each pool worker (asm-worker.js) load this file.
//  It defines one global, DiffASM, and touches no DOM.
//
//  SAME NUMBERS AS THE OLD prop()
//  --------------------------------------------------------------------------
//  The old prop() did FFT, fftshift, x H(centered axis), fftshift, IFFT.
//  Here the frequency axis is in FFT order (m = s or s - N), so no fftshift
//  is necessary. Each frequency gets the same m/(N·d), the same kz and the
//  same H, so the output is bit-identical to the old path.
//
//      setup (z-free)                  frame (per z)
//      mask t ─FFT─▶ S(fx,fy)          W = S · H(z),  H = e^(i·kz·z)
//      kz = √(k² − kx² − ky²)          E = IFFT(W),   I = |E|²
//      stored signed: kz ≥ 0 travels,  kz < 0 holds −κ, H = e^(−κz)
//
//  GREP MAP
//      "function fft1d"     radix-2 FFT of one row (unchanged from main.js)
//      "function fft2dIn"   2D FFT in place on caller buffers
//      "function makeSpec"  z-free half: spectrum and signed kz
//      "function propI"     z half: intensity |E(z)|² into a caller buffer
//      "function maskI"     z = 0: intensity of the mask itself
// ============================================================================
(function(G){
const TAU=2*Math.PI;
// In-place radix-2 Cooley-Tukey FFT of one length-n row (n is a power of two).
// The arithmetic is the same as the old fft1d in main.js, so results match.
function fft1d(re,im,n,inv){for(let i=1,j=0;i<n;i++){let b=n>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t}}for(let len=2;len<=n;len<<=1){const h=len>>1,a=(inv?1:-1)*TAU/len,wR=Math.cos(a),wI=Math.sin(a);for(let i=0;i<n;i+=len){let uR=1,uI=0;for(let j=0;j<h;j++){const e=i+j,o=i+j+h,tR=uR*re[o]-uI*im[o],tI=uR*im[o]+uI*re[o];re[o]=re[e]-tR;im[o]=im[e]-tI;re[e]+=tR;im[e]+=tI;const nu=uR*wR-uI*wI;uI=uR*wI+uI*wR;uR=nu}}}if(inv)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n}}
// 2D FFT in place: every row, then every column, through the scratch rows
// rB/iB (length ≥ max(Nx,Ny)). Same order of operations as the old fft2d.
function fft2dIn(re,im,Nx,Ny,inv,rB,iB){for(let y=0;y<Ny;y++){const o=y*Nx;for(let x=0;x<Nx;x++){rB[x]=re[o+x];iB[x]=im[o+x]}fft1d(rB,iB,Nx,inv);for(let x=0;x<Nx;x++){re[o+x]=rB[x];im[o+x]=iB[x]}}for(let x=0;x<Nx;x++){for(let y=0;y<Ny;y++){rB[y]=re[y*Nx+x];iB[y]=im[y*Nx+x]}fft1d(rB,iB,Ny,inv);for(let y=0;y<Ny;y++){re[y*Nx+x]=rB[y];im[y*Nx+x]=iB[y]}}}
// Frequency of FFT bin s on a length-N axis with pitch d, in cycles per metre.
// m is the signed bin (s, or s − N above the Nyquist bin).
function freqFFT(N,d){const f=new Float64Array(N),h=N>>1;for(let s=0;s<N;s++)f[s]=(s<h?s:s-N)/(N*d);return f}
// The z-free half for one wavelength lam (metres). tre/tim is the mask (the
// field just after the aperture). Returns the spectrum Sr/Si and the signed kz.
function makeSpec(tre,tim,Nx,Ny,dx,dy,lam){const N=Nx*Ny,Sr=new Float64Array(tre),Si=new Float64Array(tim),M=Math.max(Nx,Ny);fft2dIn(Sr,Si,Nx,Ny,false,new Float64Array(M),new Float64Array(M));const fx=freqFFT(Nx,dx),fy=freqFFT(Ny,dy),k=TAU/lam,k2=k*k,kz=new Float64Array(N);for(let iy=0;iy<Ny;iy++){const ky2=(TAU*fy[iy])**2;for(let ix=0;ix<Nx;ix++){const kx2=(TAU*fx[ix])**2,arg=k2-kx2-ky2;kz[iy*Nx+ix]=arg>=0?Math.sqrt(arg):-Math.sqrt(-arg)}}return{Sr,Si,kz,Nx,Ny}}
// Scratch buffers per grid size, so a frame allocates nothing.
const SCR=new Map();function scratch(Nx,Ny){const k=Nx+'x'+Ny;let s=SCR.get(k);if(!s){const N=Nx*Ny,M=Math.max(Nx,Ny);s={wr:new Float64Array(N),wi:new Float64Array(N),rB:new Float64Array(M),iB:new Float64Array(M)};SCR.clear();SCR.set(k,s)}return s}
// The z half: I = |IFFT(S · H)|² at distance z (metres, z > 0) into out.
function propI(sp,z,out){const{Sr,Si,kz,Nx,Ny}=sp,N=Nx*Ny,s=scratch(Nx,Ny),wr=s.wr,wi=s.wi;for(let i=0;i<N;i++){const v=kz[i];let Hr,Hi;if(v>=0){Hr=Math.cos(v*z);Hi=Math.sin(v*z)}else{Hr=Math.exp(v*z);Hi=0}const sr=Sr[i],si=Si[i];wr[i]=sr*Hr-si*Hi;wi[i]=sr*Hi+si*Hr}fft2dIn(wr,wi,Nx,Ny,true,s.rB,s.iB);for(let i=0;i<N;i++)out[i]=wr[i]*wr[i]+wi[i]*wi[i];return out}
// z = 0: the old prop() returned the mask unchanged, so I = |t|².
function maskI(tre,tim,out){for(let i=0;i<out.length;i++)out[i]=tre[i]*tre[i]+tim[i]*tim[i];return out}
G.DiffASM={fft1d,fft2dIn,makeSpec,propI,maskI};
})(self);
