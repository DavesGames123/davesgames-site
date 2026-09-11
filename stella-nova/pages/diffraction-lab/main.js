const PI=Math.PI,TAU=2*PI,mm=1e-3,um=1e-6,nm=1e-9;
function czeros(n){return{re:new Float64Array(n),im:new Float64Array(n)}}function cones(n){const r=new Float64Array(n);r.fill(1);return{re:r,im:new Float64Array(n)}}
function cmul(a,b){const n=a.re.length,o=czeros(n);for(let i=0;i<n;i++){o.re[i]=a.re[i]*b.re[i]-a.im[i]*b.im[i];o.im[i]=a.re[i]*b.im[i]+a.im[i]*b.re[i]}return o}
function cabs2(a){const n=a.re.length,o=new Float64Array(n);for(let i=0;i<n;i++)o[i]=a.re[i]*a.re[i]+a.im[i]*a.im[i];return o}
function fft1d(re,im,n,inv){for(let i=1,j=0;i<n;i++){let b=n>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t}}for(let len=2;len<=n;len<<=1){const h=len>>1,a=(inv?1:-1)*TAU/len,wR=Math.cos(a),wI=Math.sin(a);for(let i=0;i<n;i+=len){let uR=1,uI=0;for(let j=0;j<h;j++){const e=i+j,o=i+j+h,tR=uR*re[o]-uI*im[o],tI=uR*im[o]+uI*re[o];re[o]=re[e]-tR;im[o]=im[e]-tI;re[e]+=tR;im[e]+=tI;const nu=uR*wR-uI*wI;uI=uR*wI+uI*wR;uR=nu}}}if(inv)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n}}
function fft2d(f,Nx,Ny,inv){const re=new Float64Array(f.re),im=new Float64Array(f.im),rB=new Float64Array(Math.max(Nx,Ny)),iB=new Float64Array(Math.max(Nx,Ny));for(let y=0;y<Ny;y++){const o=y*Nx;for(let x=0;x<Nx;x++){rB[x]=re[o+x];iB[x]=im[o+x]}fft1d(rB,iB,Nx,inv);for(let x=0;x<Nx;x++){re[o+x]=rB[x];im[o+x]=iB[x]}}for(let x=0;x<Nx;x++){for(let y=0;y<Ny;y++){rB[y]=re[y*Nx+x];iB[y]=im[y*Nx+x]}fft1d(rB,iB,Ny,inv);for(let y=0;y<Ny;y++){re[y*Nx+x]=rB[y];im[y*Nx+x]=iB[y]}}return{re,im}}
function fftshift(f,Nx,Ny){const n=Nx*Ny,re=new Float64Array(n),im=new Float64Array(n),hx=Nx>>1,hy=Ny>>1;for(let y=0;y<Ny;y++)for(let x=0;x<Nx;x++){const s=((y+hy)%Ny)*Nx+((x+hx)%Nx),d=y*Nx+x;re[d]=f.re[s];im[d]=f.im[s]}return{re,im}}
function fftfreqS(N,d){const f=new Float64Array(N),h=N>>1;for(let i=0;i<N;i++)f[i]=(i-h)/(N*d);return f}
function prop(E,Nx,Ny,dx,dy,z,lam){if(z===0)return{re:new Float64Array(E.re),im:new Float64Array(E.im)};let sp=fft2d(E,Nx,Ny,false);sp=fftshift(sp,Nx,Ny);const fx=fftfreqS(Nx,dx),fy=fftfreqS(Ny,dy),k=TAU/lam,k2=k*k,N=Nx*Ny,Hr=new Float64Array(N),Hi=new Float64Array(N);for(let iy=0;iy<Ny;iy++){const ky2=(TAU*fy[iy])**2;for(let ix=0;ix<Nx;ix++){const idx=iy*Nx+ix,kx2=(TAU*fx[ix])**2,arg=k2-kx2-ky2;if(arg>=0){const kz=Math.sqrt(arg);Hr[idx]=Math.cos(kz*z);Hi[idx]=Math.sin(kz*z)}else Hr[idx]=Math.exp(-Math.sqrt(-arg)*z)}}const sr=sp.re,si=sp.im;for(let i=0;i<N;i++){const a=sr[i]*Hr[i]-si[i]*Hi[i],b=sr[i]*Hi[i]+si[i]*Hr[i];sr[i]=a;si[i]=b}sp=fftshift({re:sr,im:si},Nx,Ny);return fft2d(sp,Nx,Ny,true)}
function pG(x,mu,s1,s2){return Math.exp(-.5*((x-mu)/(x<mu?s1:s2))**2)}
function cieX(l){return 1.056*pG(l,599.8,37.9,31)+.362*pG(l,442,16,26.7)-.065*pG(l,501.1,20.4,26.2)}
function cieY(l){return .821*pG(l,568.8,46.9,40.5)+.286*pG(l,530.9,16.3,31.1)}
function cieZ(l){return 1.217*pG(l,437,11.8,36)+.681*pG(l,459,26,13.8)}
const D65=[49.98,52.31,54.65,68.70,82.75,87.12,91.49,92.46,93.43,90.06,86.68,95.77,104.87,110.94,117.01,117.41,117.81,116.34,114.86,115.39,115.92,112.37,108.81,109.08,109.35,108.58,107.80,106.30,104.79,106.24,107.69,106.05,104.41,104.22,104.05,102.02,100,98.17,96.33,96.06,95.79];
function d65(l){const t=(l-380)/10,i=Math.max(0,Math.min(39,Math.floor(t)));return D65[i]+(D65[i+1]-D65[i])*(t-i)}
function sGam(v){return v<=.0031308?12.92*v:1.055*Math.pow(v,1/2.4)-.055}
function wlRGB(l){let r=0,g=0,b=0;if(l>=380&&l<440){r=(440-l)/60;b=1}else if(l<490){g=(l-440)/50;b=1}else if(l<510){g=1;b=(510-l)/20}else if(l<580){r=(l-510)/70;g=1}else if(l<645){r=1;g=(645-l)/65}else if(l<=780)r=1;let f=1;if(l<420)f=.3+.7*(l-380)/40;else if(l>700)f=.3+.7*(780-l)/80;return[Math.pow(r*f,.8),Math.pow(g*f,.8),Math.pow(b*f,.8)]}
function inPoly(px,py,vs){let c=false;for(let i=0,j=vs.length-1;i<vs.length;j=i++){const xi=vs[i][0],yi=vs[i][1],xj=vs[j][0],yj=vs[j][1];if(((yi>py)!==(yj>py))&&(px<(xj-xi)*(py-yi)/(yj-yi)+xi))c=!c}return c}
function starV(n,R,r){const v=[];for(let i=0;i<n*2;i++){const a=i*PI/n-PI/2;v.push([(i%2?r:R)*Math.cos(a),(i%2?r:R)*Math.sin(a)])}return v}

/* ═══ RASTER HELPER (flips Y so text/images appear right-side up) ═══ */
function rasterToField(imgData,side,N){const t=czeros(N);for(let iy=0;iy<side;iy++)for(let ix=0;ix<side;ix++){const si=iy*side+ix,ci=(side-1-iy)*side+ix;t.re[si]=imgData.data[ci*4]/255}return t}

/* ═══ ELEMENTS ═══ */
const EL={
  hex:{name:'Hexagonal',sym:'⬡',wlDep:false,params:[{id:'radius',label:'R',min:.01,max:5,value:.7,step:.01}],t(xx,yy,l,N,p){const R=p.radius*mm,s3=Math.sqrt(3),t=czeros(N);for(let i=0;i<N;i++){const ax=Math.abs(xx[i]),ay=Math.abs(yy[i]);t.re[i]=(ax+ay/s3<=R&&ay<=R*s3/2)?1:0}return t},tex(){return String.raw`\textcolor{${_C.T}}{t}\!=\!\begin{cases}1&|x|+|y|/\!\sqrt3\le R\\0\end{cases}`}},
  circular:{name:'Circle',sym:'⊙',wlDep:false,params:[{id:'radius',label:'R',min:.01,max:5,value:.5,step:.01}],t(xx,yy,l,N,p){const a=p.radius*mm,t=czeros(N);for(let i=0;i<N;i++)t.re[i]=(xx[i]*xx[i]+yy[i]*yy[i]<a*a)?1:0;return t},tex(p){return String.raw`\textcolor{${_C.T}}{t}\!=\!\mathrm{circ}(r/${p.radius})`}},
  rect:{name:'Rect Slit',sym:'▬',wlDep:false,params:[{id:'width',label:'W',min:.01,max:5,value:.1,step:.01},{id:'height',label:'H',min:.01,max:10,value:3,step:.1}],t(xx,yy,l,N,p){const w=p.width*mm/2,h=p.height*mm/2,t=czeros(N);for(let i=0;i<N;i++)t.re[i]=(Math.abs(xx[i])<w&&Math.abs(yy[i])<h)?1:0;return t},tex(){return String.raw`\textcolor{${_C.T}}{t}\!=\!\mathrm{rect}(x/w)\,\mathrm{rect}(y/h)`}},
  double:{name:'Double Slit',sym:'‖',wlDep:false,params:[{id:'slit_w',label:'W',min:.005,max:1,value:.04,step:.005},{id:'sep',label:'Sep',min:.02,max:5,value:.3,step:.01},{id:'height',label:'H',min:.1,max:10,value:3,step:.1}],t(xx,yy,l,N,p){const w=p.slit_w*mm/2,d=p.sep*mm/2,h=p.height*mm/2,t=czeros(N);for(let i=0;i<N;i++){const x=xx[i],y=yy[i];t.re[i]=((Math.abs(x-d)<w||Math.abs(x+d)<w)&&Math.abs(y)<h)?1:0}return t},tex(){return String.raw`\textcolor{${_C.T}}{t}\!=\!\Sigma\,\mathrm{rect}\!\left(\tfrac{x\pm d/2}{w}\right)`}},
  star:{name:'Star',sym:'★',wlDep:false,params:[{id:'pts',label:'Pts',min:3,max:12,value:5,step:1},{id:'radius',label:'R',min:.05,max:5,value:.6,step:.01},{id:'inner',label:'Inn',min:.1,max:.9,value:.38,step:.01}],t(xx,yy,l,N,p){const R=p.radius*mm,rI=R*p.inner,vs=starV(p.pts,R,rI),t=czeros(N);for(let i=0;i<N;i++)t.re[i]=inPoly(xx[i],yy[i],vs)?1:0;return t},tex(p){return String.raw`\textcolor{${_C.T}}{t}\!=\!\mathrm{star}_{${p.pts}}(r;\,R,\,r_i)`}},
  heart:{name:'Heart',sym:'♥',wlDep:false,params:[{id:'size',label:'Size',min:.05,max:5,value:.5,step:.01}],t(xx,yy,l,N,p){const s=p.size*mm,t=czeros(N);for(let i=0;i<N;i++){const xn=xx[i]/s,yn=-yy[i]/s+.35,r2=xn*xn+yn*yn-1;t.re[i]=(r2*r2*r2-xn*xn*yn*yn*yn<=0)?1:0}return t},tex(){return String.raw`\textcolor{${_C.T}}{t}\!=\!\{(x^2\!+\!y^2\!-\!1)^3\!\le\! x^2y^3\}`}},
  ring:{name:'Ring',sym:'◯',wlDep:false,params:[{id:'outer',label:'Out',min:.05,max:5,value:.6,step:.01},{id:'inner',label:'Inn',min:.01,max:4,value:.4,step:.01}],t(xx,yy,l,N,p){const ro=p.outer*mm,ri=p.inner*mm,t=czeros(N);for(let i=0;i<N;i++){const r2=xx[i]*xx[i]+yy[i]*yy[i];t.re[i]=(r2>=ri*ri&&r2<=ro*ro)?1:0}return t},tex(){return String.raw`\textcolor{${_C.T}}{t}\!=\!\{r_i\le r\le r_o\}`}},
  cross:{name:'Cross',sym:'✚',wlDep:false,params:[{id:'arm',label:'Arm',min:.05,max:5,value:.6,step:.01},{id:'width',label:'W',min:.01,max:2,value:.15,step:.01}],t(xx,yy,l,N,p){const a=p.arm*mm,w=p.width*mm/2,t=czeros(N);for(let i=0;i<N;i++){const ax=Math.abs(xx[i]),ay=Math.abs(yy[i]);t.re[i]=((ax<w&&ay<a)||(ay<w&&ax<a))?1:0}return t},tex(){return String.raw`\textcolor{${_C.T}}{t}\!=\!\mathrm{cross}(x,y;\,a,w)`}},
  'grating-bin':{name:'Grating',sym:'⫾',wlDep:false,params:[{id:'period',label:'Per',min:.01,max:2,value:.15,step:.005},{id:'width',label:'W',min:.1,max:15,value:3,step:.1},{id:'height',label:'H',min:.1,max:15,value:3,step:.1}],t(xx,yy,l,N,p){const P=p.period*mm,w=p.width*mm/2,h=p.height*mm/2,t=czeros(N);for(let i=0;i<N;i++){const x=xx[i],y=yy[i];if(Math.abs(x)<w&&Math.abs(y)<h)t.re[i]=(((x%P+P)%P)<P/2)?1:0}return t},tex(){return String.raw`\textcolor{${_C.T}}{t}\!=\!\mathrm{sgn}(\cos 2\pi x/\Lambda)`}},
  'grating-phase':{name:'Phase Grating',sym:'≋',wlDep:true,params:[{id:'period',label:'Per',min:.01,max:2,value:.15,step:.005},{id:'width',label:'W',min:.1,max:15,value:3,step:.1},{id:'height',label:'H',min:.1,max:15,value:3,step:.1}],t(xx,yy,l,N,p){const P=p.period*mm,w=p.width*mm/2,h=p.height*mm/2,t=czeros(N);for(let i=0;i<N;i++){const x=xx[i],y=yy[i];if(Math.abs(x)<w&&Math.abs(y)<h){const ph=TAU*x/P;t.re[i]=Math.cos(ph);t.im[i]=Math.sin(ph)}}return t},tex(){return String.raw`\textcolor{${_C.T}}{t}\!=\!e^{2\pi ix/\Lambda}`}},
  'lens-ap':{name:'Lens',sym:'◉',wlDep:true,params:[{id:'f',label:'f',min:1,max:1000,value:50,step:1},{id:'radius',label:'R',min:.05,max:5,value:.4,step:.01}],t(xx,yy,l,N,p){const f=p.f*mm,a=p.radius*mm,t=czeros(N);for(let i=0;i<N;i++){const r2=xx[i]*xx[i]+yy[i]*yy[i];if(r2<a*a){const ph=-PI/(l*f)*r2;t.re[i]=Math.cos(ph);t.im[i]=Math.sin(ph)}}return t},tex(){return String.raw`\textcolor{${_C.T}}{t}\!=\!\mathrm{circ}\!\cdot e^{-i\pi r^2/\lambda f}`}},
  fzp:{name:'Zone Plate',sym:'◎',wlDep:true,params:[{id:'f',label:'f',min:5,max:500,value:50,step:1},{id:'radius',label:'R',min:.05,max:5,value:.5,step:.01}],t(xx,yy,l,N,p){const f=p.f*mm,a=p.radius*mm,t=czeros(N);for(let i=0;i<N;i++){const r2=xx[i]*xx[i]+yy[i]*yy[i];if(r2<a*a){const ph=-(TAU/l)*(Math.sqrt(f*f+r2)-f);t.re[i]=Math.cos(ph);t.im[i]=Math.sin(ph)}}return t},tex(){return String.raw`\textcolor{${_C.T}}{t}\!=\!e^{-i2\pi(\sqrt{f^2+r^2}-f)/\lambda}`}},
  text:{name:'Text',sym:'Aa',wlDep:false,params:[{id:'txt',label:'Text',type:'text',value:'davesgames.io'},{id:'sz',label:'Size',min:8,max:120,value:28,step:1}],t(xx,yy,l,N,p){const side=Math.round(Math.sqrt(N)),cv=document.createElement('canvas');cv.width=side;cv.height=side;const ctx=cv.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,side,side);ctx.fillStyle='#fff';ctx.font=`bold ${p.sz}px "JetBrains Mono",monospace`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(p.txt||'A',side/2,side/2);return rasterToField(ctx.getImageData(0,0,side,side),side,N)},tex(p){return String.raw`\textcolor{${_C.T}}{t}(x,y) = \text{text\_mask}\!\left(\text{"${(p.txt||'').slice(0,16)}"}\right)`}},
  image:{name:'Image',sym:'◫',wlDep:false,params:[{id:'file',label:'Image',type:'file'},{id:'inv',label:'Invert',min:0,max:1,value:0,step:1}],t(xx,yy,l,N,p){if(!window._imgMask||window._imgMask.length!==N)return cones(N);const t=czeros(N),inv=p.inv>.5;for(let i=0;i<N;i++)t.re[i]=inv?1-window._imgMask[i]:window._imgMask[i];return t},tex(){return String.raw`\textcolor{${_C.T}}{t}\!=\!\text{grayscale}(\text{image})`}},
};

/* Populate element select */
(function(){const sel=document.getElementById('element-select');Object.entries(EL).forEach(([k,v])=>{const o=document.createElement('option');o.value=k;o.textContent=v.sym+' '+v.name;if(k==='text')o.selected=true;sel.appendChild(o)})})();

const S={element:'text',source:'white',lambda:633,z:200,extent:5,N:256,divs:15,speed:5,viewMode:1,params:{}};
let animDir=0,animDwell=0;
function sg(el){el.style.setProperty('--pct',(el.value-el.min)/(el.max-el.min)*100+'%')}

/* ═══ BUILD 4 CELLS WITH BARS ═══ */
const CHANNELS=[{id:'cv-rgb',label:'Composite',cls:''},{id:'cv-r',label:'Red',cls:'ch-r'},{id:'cv-g',label:'Green',cls:'ch-g'},{id:'cv-b',label:'Blue',cls:'ch-b'}];
const grid=document.getElementById('canvas-grid');
CHANNELS.forEach((ch,idx)=>{
  const cell=document.createElement('div');cell.className='canvas-cell';cell.id='cell-'+idx;
  cell.innerHTML=`<div class="cell-label ${ch.cls}">${ch.label}</div><canvas id="${ch.id}"></canvas>
<div class="cell-bar">
<div class="cb-row"><span class="cb-lbl">z</span><input type="range" class="cb-slider cb-z" min="0" max="500" value="200" step="1"><span class="cb-val cb-z-v">200 mm</span></div>
<div class="cb-row"><span class="cb-lbl">ext</span><input type="range" class="cb-slider cb-ext" min="0.5" max="30" value="5" step="0.1"><span class="cb-val cb-ext-v">5.0 mm</span></div>
<div class="cb-row"><span class="cb-lbl">spd</span><input type="range" class="cb-slider cb-spd" min="0.5" max="5" value="5" step="0.25"><span class="cb-val cb-spd-v">×5</span></div>
<div class="cb-transport"><button class="cb-btn" data-d="-1">◀ REV</button><button class="cb-btn" data-d="0">⏸ STOP</button><button class="cb-btn" data-d="1">▶ PLAY</button></div>
</div>`;
  grid.appendChild(cell);
});

function renderCh(canvas,rgb,Nx,Ny,ch){const cell=canvas.parentElement,cw=cell.clientWidth*devicePixelRatio,barH=cell.querySelector('.cell-bar').offsetHeight||50,ch2=(cell.clientHeight-barH)*devicePixelRatio;if(ch2<1)return;canvas.width=cw;canvas.height=ch2;const ctx=canvas.getContext('2d');ctx.fillStyle='#060810';ctx.fillRect(0,0,cw,ch2);const off=document.createElement('canvas');off.width=Nx;off.height=Ny;const oc=off.getContext('2d'),img=oc.createImageData(Nx,Ny),d=img.data;for(let iy=0;iy<Ny;iy++)for(let ix=0;ix<Nx;ix++){const si=(Ny-1-iy)*Nx+ix,di=(iy*Nx+ix)*4,r=rgb[si*3],g=rgb[si*3+1],b=rgb[si*3+2];if(ch==='rgb'){d[di]=r;d[di+1]=g;d[di+2]=b}else if(ch==='r'){d[di]=r;d[di+1]=0;d[di+2]=0}else if(ch==='g'){d[di]=0;d[di+1]=g;d[di+2]=0}else{d[di]=0;d[di+1]=0;d[di+2]=b}d[di+3]=255}oc.putImageData(img,0,0);const sc=Math.min(cw/Nx,ch2/Ny),dw=Nx*sc,dh=Ny*sc;ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(off,(cw-dw)/2,(ch2-dh)/2,dw,dh)}

function readParams(){const el=EL[S.element],p={};el.params.forEach(pd=>{if(pd.type==='file')return;const sl=document.getElementById('sl-p-'+pd.id);p[pd.id]=pd.type==='text'?(sl?sl.value:pd.value):(sl?parseFloat(sl.value):pd.value)});S.params=p;return p}

function recompute(){
  const p=readParams(),el=EL[S.element],N=S.N,Nx=N,Ny=N,ext=S.extent*mm,dx=ext/Nx,dy=ext/Ny,z=S.z*mm;
  const xx=new Float64Array(N*N),yy=new Float64Array(N*N);
  for(let iy=0;iy<Ny;iy++){const y_=dy*(iy-Ny/2);for(let ix=0;ix<Nx;ix++){xx[iy*Nx+ix]=dx*(ix-Nx/2);yy[iy*Nx+ix]=y_}}
  let rgb;
  if(S.source==='mono'){
    const lam=S.lambda*nm,tr=el.t(xx,yy,lam,N*N,p);let E=cmul(cones(N*N),tr);E=prop(E,Nx,Ny,dx,dy,z,lam);const I=cabs2(E);let mx=0;for(let i=0;i<I.length;i++)if(I[i]>mx)mx=I[i];if(mx<1e-30)mx=1;const wl=wlRGB(S.lambda);rgb=new Uint8Array(N*N*3);for(let i=0;i<N*N;i++){const v=Math.sqrt(I[i]/mx);rgb[i*3]=Math.min(255,v*wl[0]*255)|0;rgb[i*3+1]=Math.min(255,v*wl[1]*255)|0;rgb[i*3+2]=Math.min(255,v*wl[2]*255)|0}
  } else {
    const nD=S.divs,dl=(780-380)/nD,X=new Float64Array(N*N),Y=new Float64Array(N*N),Z=new Float64Array(N*N);let tC=null;if(!el.wlDep)tC=el.t(xx,yy,550*nm,N*N,p);
    for(let d=0;d<nD;d++){const ln=380+(d+.5)*dl,lam=ln*nm,Sd=d65(ln)*dl,xw=cieX(ln)*Sd,yw=cieY(ln)*Sd,zw=cieZ(ln)*Sd,tr=tC||el.t(xx,yy,lam,N*N,p);let E=cmul(cones(N*N),tr);E=prop(E,Nx,Ny,dx,dy,z,lam);const I=cabs2(E);for(let i=0;i<N*N;i++){X[i]+=I[i]*xw;Y[i]+=I[i]*yw;Z[i]+=I[i]*zw}}
    let mY=0;for(let i=0;i<N*N;i++)if(Y[i]>mY)mY=Y[i];if(mY<1e-30)mY=1;const sc=1/mY;rgb=new Uint8Array(N*N*3);
    for(let i=0;i<N*N;i++){const x=X[i]*sc,y=Y[i]*sc,zv=Z[i]*sc;let r=3.2406*x-1.5372*y-.4986*zv,g=-.9689*x+1.8758*y+.0415*zv,b=.0557*x-.204*y+1.057*zv;r=Math.max(0,r);g=Math.max(0,g);b=Math.max(0,b);rgb[i*3]=Math.min(255,sGam(r)*255)|0;rgb[i*3+1]=Math.min(255,sGam(g)*255)|0;rgb[i*3+2]=Math.min(255,sGam(b)*255)|0}
  }
  renderCh(document.getElementById('cv-rgb'),rgb,Nx,Ny,'rgb');
  if(S.viewMode===4){renderCh(document.getElementById('cv-r'),rgb,Nx,Ny,'r');renderCh(document.getElementById('cv-g'),rgb,Nx,Ny,'g');renderCh(document.getElementById('cv-b'),rgb,Nx,Ny,'b')}
  document.getElementById('st-main').textContent=`${N}² · dx=${(dx/um).toFixed(1)}µm · z=${S.z.toFixed(0)}mm`;
  const aC=p.radius||p.outer||p.width||p.slit_w||p.arm||p.size||0;if(aC>0&&S.z>0){const l0=(S.source==='mono'?S.lambda:550)*nm,Nf=(aC*mm)**2/(l0*z);document.getElementById('st-sub').textContent=`N_F=${Nf.toFixed(2)} · ${Nf>5?'geometric':Nf>.5?'Fresnel':'Fraunhofer'}`}else document.getElementById('st-sub').textContent='';
  document.getElementById('qp-title').textContent='Aperture Diffraction';document.getElementById('qp-summary').textContent=el.sym+' '+el.name+' · '+(S.source==='white'?'D65':'λ='+S.lambda+'nm')+' · z='+S.z.toFixed(0)+'mm';
  if(window.katex&&window._ko&&el.tex){document.getElementById('eq-t-label').textContent='Transmittance · '+el.name;try{katex.render(el.tex(p),document.getElementById('eq-trans'),window._ko)}catch(e){}}
}
let _sc=false;function scheduleRecompute(){if(!_sc){_sc=true;requestAnimationFrame(()=>{_sc=false;recompute()})}}

/* ═══ SYNC 4 BARS ═══ */
const allZ=document.querySelectorAll('.cb-z'),allZV=document.querySelectorAll('.cb-z-v'),allSpd=document.querySelectorAll('.cb-spd'),allSpdV=document.querySelectorAll('.cb-spd-v'),allExt=document.querySelectorAll('.cb-ext'),allExtV=document.querySelectorAll('.cb-ext-v'),allBtns=document.querySelectorAll('.cb-btn');
function syncBars(){allZ.forEach(s=>{s.value=Math.min(+s.max,S.z);sg(s)});allZV.forEach(v=>v.textContent=S.z.toFixed(0)+' mm');allSpd.forEach(s=>{s.value=S.speed;sg(s)});allSpdV.forEach(v=>v.textContent=`×${S.speed}`);allExt.forEach(s=>{s.value=S.extent;sg(s)});allExtV.forEach(v=>v.textContent=S.extent.toFixed(1)+' mm');allBtns.forEach(b=>{const d=+b.dataset.d;b.classList.toggle('on',d!==0&&d===animDir)})}
allZ.forEach(s=>{sg(s);s.addEventListener('input',function(){S.z=+this.value;syncBars();if(!animDir)scheduleRecompute()})});
allSpd.forEach(s=>{sg(s);s.addEventListener('input',function(){S.speed=+this.value;syncBars()})});
allExt.forEach(s=>{sg(s);s.addEventListener('input',function(){S.extent=+this.value;syncBars();scheduleRecompute()})});
allBtns.forEach(b=>b.addEventListener('click',function(){const d=+this.dataset.d;if(d===0)animDir=0;else if(animDir===d)animDir=0;else{animDir=d;requestAnimationFrame(animLoop)}syncBars()}));
function animLoop(){if(!animDir)return;if(animDwell>0){animDwell--;requestAnimationFrame(animLoop);return}const zMin=0,zMax=+allZ[0].max||500;S.z+=animDir*S.speed*(zMax-zMin)/400;if(S.z>=zMax){S.z=zMax;animDir=-1;animDwell=60}if(S.z<=zMin){S.z=zMin;animDir=1;animDwell=60}syncBars();recompute();requestAnimationFrame(animLoop)}

/* ═══ PARAM UI ═══ */
function buildParamUI(){const c=document.getElementById('params-container'),el=EL[S.element];c.innerHTML='';el.params.forEach(pd=>{if(pd.type==='text'){const d=document.createElement('div');d.innerHTML=`<input type="text" id="sl-p-${pd.id}" value="${pd.value}" class="qp-text-input" placeholder="${pd.label}">`;c.appendChild(d);d.querySelector('input').addEventListener('input',()=>scheduleRecompute())}else if(pd.type==='file'){const d=document.createElement('div');d.innerHTML=`<button class="qp-file-btn">Choose Image</button>`;c.appendChild(d);d.querySelector('button').addEventListener('click',()=>document.getElementById('file-input').click())}else{const dec=pd.step<.01?3:pd.step<.1?2:pd.step<1?1:0;const row=document.createElement('div');row.className='row';row.innerHTML=`<span class="row-lbl">${pd.label}</span><input type="range" id="sl-p-${pd.id}" min="${pd.min}" max="${pd.max}" value="${pd.value}" step="${pd.step}"><span class="val" id="vl-p-${pd.id}">${pd.value.toFixed(dec)}</span>`;c.appendChild(row);const sl=row.querySelector('input');sg(sl);sl.addEventListener('input',function(){document.getElementById('vl-p-'+pd.id).textContent=(+this.value).toFixed(dec);sg(this);scheduleRecompute()})}});readParams()}

document.getElementById('file-input').addEventListener('change',function(){const f=this.files[0];if(!f)return;const r=new FileReader();r.onload=function(e){const img=new Image();img.onload=function(){const N=S.N,cv=document.createElement('canvas');cv.width=N;cv.height=N;const ctx=cv.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,N,N);const sc=Math.min(N/img.width,N/img.height)*.85,w=img.width*sc,h=img.height*sc;ctx.drawImage(img,(N-w)/2,(N-h)/2,w,h);const id=ctx.getImageData(0,0,N,N);window._imgMask=new Float64Array(N*N);for(let iy=0;iy<N;iy++)for(let ix=0;ix<N;ix++){const si=iy*N+ix,ci=(N-1-iy)*N+ix;window._imgMask[si]=(id.data[ci*4]+id.data[ci*4+1]+id.data[ci*4+2])/765}scheduleRecompute()};img.src=e.target.result};r.readAsDataURL(f)});

/* ═══ EVENTS ═══ */
document.getElementById('element-select').addEventListener('change',function(){S.element=this.value;buildParamUI();scheduleRecompute()});
document.querySelectorAll('#source-modes .qp-mode').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('#source-modes .qp-mode').forEach(x=>x.classList.remove('active'));b.classList.add('active');S.source=b.dataset.source;document.getElementById('mono-params').style.display=S.source==='mono'?'block':'none';document.getElementById('white-params').style.display=S.source==='white'?'block':'none';scheduleRecompute()}));
document.querySelectorAll('.res-btn[data-n]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.res-btn[data-n]').forEach(x=>x.classList.remove('active'));b.classList.add('active');S.N=+b.dataset.n;window._imgMask=null;scheduleRecompute()}));
document.querySelectorAll('#view-modes .qp-mode').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('#view-modes .qp-mode').forEach(x=>x.classList.remove('active'));b.classList.add('active');S.viewMode=+b.dataset.view;const g=document.getElementById('canvas-grid');g.classList.toggle('view-1',S.viewMode===1);document.getElementById('export-section').style.display=S.viewMode===1?'':'none';scheduleRecompute()}));
['sl-lam','sl-div'].forEach(id=>{const el=document.getElementById(id);if(!el)return;sg(el);el.addEventListener('input',function(){sg(this);const v=+this.value;if(id==='sl-lam'){S.lambda=v;document.getElementById('vl-lam').textContent=v.toFixed(0);const rgb=wlRGB(v),dot=document.getElementById('wl-dot'),cs=`rgb(${rgb[0]*255|0},${rgb[1]*255|0},${rgb[2]*255|0})`;dot.style.backgroundColor=cs;dot.style.color=cs}else{S.divs=v;document.getElementById('vl-div').textContent=v.toFixed(0)}scheduleRecompute()})});
document.getElementById('sl-txtsz').addEventListener('input',function(){sg(this);document.getElementById('vl-txtsz').textContent=this.value});sg(document.getElementById('sl-txtsz'));
document.getElementById('qp-collapse-btn').addEventListener('click',()=>{const p=document.getElementById('quick-panel'),c=p.classList.toggle('collapsed');document.getElementById('qp-collapse-btn').textContent=c?'▶':'◀';document.getElementById('canvas-grid').style.left=c?'44px':'';setTimeout(scheduleRecompute,250)});
/* Mobile drawer */
function toggleMobilePanel(){const p=document.getElementById('quick-panel'),o=document.getElementById('mob-overlay');const isOpen=p.classList.toggle('mob-open');o.classList.toggle('show',isOpen)}
document.getElementById('mob-menu').addEventListener('click',toggleMobilePanel);
document.getElementById('mob-overlay').addEventListener('click',toggleMobilePanel);
window.addEventListener('resize',()=>scheduleRecompute());

function closeMob(){if(window.innerWidth<=700){document.getElementById('quick-panel').classList.remove('mob-open');document.getElementById('mob-overlay').classList.remove('show')}}
/* Custom text button */
document.getElementById('btn-set-text').addEventListener('click',()=>{
  const txt=document.getElementById('custom-text').value||'A';
  const sz=+document.getElementById('sl-txtsz').value||28;
  S.element='text';document.getElementById('element-select').value='text';
  buildParamUI();
  const slT=document.getElementById('sl-p-txt');if(slT)slT.value=txt;
  const slS=document.getElementById('sl-p-sz');if(slS){slS.value=sz;sg(slS);const vl=document.getElementById('vl-p-sz');if(vl)vl.textContent=sz}
  scheduleRecompute();closeMob();
});

/* Reset */
document.getElementById('btn-reset').addEventListener('click',()=>{animDir=0;S.element='text';S.source='white';S.lambda=633;S.z=200;S.extent=5;S.N=256;S.divs=15;S.speed=5;window._imgMask=null;
  document.getElementById('element-select').value='text';
  document.querySelectorAll('#source-modes .qp-mode').forEach(b=>b.classList.toggle('active',b.dataset.source==='white'));
  document.getElementById('mono-params').style.display='none';document.getElementById('white-params').style.display='block';
  const slD=document.getElementById('sl-div');slD.value=15;sg(slD);document.getElementById('vl-div').textContent='15';
  document.querySelectorAll('.res-btn[data-n]').forEach(b=>b.classList.toggle('active',+b.dataset.n===256));
  allZ.forEach(s=>s.max=500);
  document.querySelectorAll('.preset-btn').forEach(b=>b.classList.remove('on'));
  buildParamUI();syncBars();scheduleRecompute();closeMob()});

/* ═══ EXPORT SYSTEM ═══ */
let exAR=[1,1]; // [w,h] ratio
const AR_MAP={'1:1':[1,1],'16:9':[16,9],'9:16':[9,16],'4:3':[4,3],'3:4':[3,4]};
const EASE={linear:t=>t,'ease-in':t=>t*t,'ease-out':t=>1-(1-t)*(1-t),'ease-in-out':t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2};
function exDims(){const w=+document.getElementById('sl-exw').value;const h=Math.round(w*exAR[1]/exAR[0]);return[w,h]}
function updateExLabel(){const[w,h]=exDims();document.getElementById('vl-exw').textContent=w+'×'+h}

document.querySelectorAll('#ar-btns .res-btn').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('#ar-btns .res-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');exAR=AR_MAP[b.dataset.ar]||[1,1];updateExLabel()}));
const slExw=document.getElementById('sl-exw');sg(slExw);slExw.addEventListener('input',function(){sg(this);updateExLabel()});
const slDur=document.getElementById('sl-dur');sg(slDur);slDur.addEventListener('input',function(){sg(this);document.getElementById('vl-dur').textContent=this.value+'s'});
const slRep=document.getElementById('sl-rep');sg(slRep);slRep.addEventListener('input',function(){sg(this);document.getElementById('vl-rep').textContent=this.value});

function renderFrame(Nx,Ny,exW,exH,z){
  const p=readParams(),el=EL[S.element];
  const maxN=Math.max(Nx,Ny),ext=S.extent*mm;
  const dx=ext/maxN,dy=ext/maxN; // isotropic sampling
  const NN=Nx*Ny;
  const xx=new Float64Array(NN),yy=new Float64Array(NN);
  for(let iy=0;iy<Ny;iy++){const y_=dy*(iy-Ny/2);for(let ix=0;ix<Nx;ix++){xx[iy*Nx+ix]=dx*(ix-Nx/2);yy[iy*Nx+ix]=y_}}
  let rgb;
  if(S.source==='mono'){
    const lam=S.lambda*nm,tr=el.t(xx,yy,lam,NN,p);let E=cmul(cones(NN),tr);E=prop(E,Nx,Ny,dx,dy,z*mm,lam);const I=cabs2(E);let mx=0;for(let i=0;i<I.length;i++)if(I[i]>mx)mx=I[i];if(mx<1e-30)mx=1;const wl=wlRGB(S.lambda);rgb=new Uint8Array(NN*3);for(let i=0;i<NN;i++){const v=Math.sqrt(I[i]/mx);rgb[i*3]=Math.min(255,v*wl[0]*255)|0;rgb[i*3+1]=Math.min(255,v*wl[1]*255)|0;rgb[i*3+2]=Math.min(255,v*wl[2]*255)|0}
  } else {
    const nD=S.divs,dl=(780-380)/nD,X=new Float64Array(NN),Y=new Float64Array(NN),Z=new Float64Array(NN);let tC=null;if(!el.wlDep)tC=el.t(xx,yy,550*nm,NN,p);
    for(let d=0;d<nD;d++){const ln=380+(d+.5)*dl,lam=ln*nm,Sd=d65(ln)*dl,xw=cieX(ln)*Sd,yw=cieY(ln)*Sd,zw=cieZ(ln)*Sd,tr=tC||el.t(xx,yy,lam,NN,p);let E=cmul(cones(NN),tr);E=prop(E,Nx,Ny,dx,dy,z*mm,lam);const I=cabs2(E);for(let i=0;i<NN;i++){X[i]+=I[i]*xw;Y[i]+=I[i]*yw;Z[i]+=I[i]*zw}}
    let mY=0;for(let i=0;i<NN;i++)if(Y[i]>mY)mY=Y[i];if(mY<1e-30)mY=1;const sc=1/mY;rgb=new Uint8Array(NN*3);
    for(let i=0;i<NN;i++){const x=X[i]*sc,y=Y[i]*sc,zv=Z[i]*sc;let r=3.2406*x-1.5372*y-.4986*zv,g=-.9689*x+1.8758*y+.0415*zv,b=.0557*x-.204*y+1.057*zv;r=Math.max(0,r);g=Math.max(0,g);b=Math.max(0,b);rgb[i*3]=Math.min(255,sGam(r)*255)|0;rgb[i*3+1]=Math.min(255,sGam(g)*255)|0;rgb[i*3+2]=Math.min(255,sGam(b)*255)|0}
  }
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

function getZForFrame(frame,total,dir,ease){
  const zMax=+allZ[0].max||500;
  let t=frame/Math.max(1,total-1); // 0→1
  t=ease(t);
  if(dir==='fwd') return t*zMax;
  if(dir==='rev') return (1-t)*zMax;
  // bounce: 0→1→0
  return t<0.5 ? (t*2)*zMax : (2-t*2)*zMax;
}

/* Half each dimension, snap to power of 2 */
function exSimDims(w,h){return[Math.pow(2,Math.max(7,Math.round(Math.log2(w/2)))),Math.pow(2,Math.max(7,Math.round(Math.log2(h/2))))]}

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
function applyP(pr){animDir=0;S.element=pr.el;S.source=pr.src||'white';S.lambda=pr.lam||633;S.extent=pr.ext;S.z=pr.z;S.N=pr.N||256;S.divs=pr.div||15;S.speed=5;
  document.getElementById('element-select').value=pr.el;allZ.forEach(s=>s.max=Math.max(500,pr.z*3));
  document.querySelectorAll('#source-modes .qp-mode').forEach(b=>b.classList.toggle('active',b.dataset.source===(pr.src||'white')));
  document.getElementById('mono-params').style.display=S.source==='mono'?'block':'none';document.getElementById('white-params').style.display=S.source==='white'?'block':'none';
  const slD=document.getElementById('sl-div');slD.value=S.divs;sg(slD);document.getElementById('vl-div').textContent=S.divs;
  document.querySelectorAll('.res-btn[data-n]').forEach(b=>b.classList.toggle('active',+b.dataset.n===S.N));
  document.querySelectorAll('.preset-btn').forEach(b=>b.classList.remove('on'));
  buildParamUI();const el=EL[pr.el];el.params.forEach(pd=>{if(pd.type==='file')return;if(pr.p[pd.id]!==undefined){const sl=document.getElementById('sl-p-'+pd.id);if(sl){if(pd.type==='text')sl.value=pr.p[pd.id];else{sl.value=pr.p[pd.id];sg(sl);const dec=pd.step<.01?3:pd.step<.1?2:pd.step<1?1:0;const vl=document.getElementById('vl-p-'+pd.id);if(vl)vl.textContent=pr.p[pd.id].toFixed(dec)}}}});
  syncBars();scheduleRecompute()}
(function(){const g=document.getElementById('preset-grid');PR.forEach(pr=>{const b=document.createElement('button');b.className='preset-btn';b.textContent=pr.name;b.addEventListener('click',()=>{applyP(pr);b.classList.add('on');closeMob()});g.appendChild(b)})})();

(function(){const rgb=wlRGB(S.lambda),dot=document.getElementById('wl-dot'),cs=`rgb(${rgb[0]*255|0},${rgb[1]*255|0},${rgb[2]*255|0})`;dot.style.backgroundColor=cs;dot.style.color=cs;buildParamUI();syncBars();scheduleRecompute()})();
