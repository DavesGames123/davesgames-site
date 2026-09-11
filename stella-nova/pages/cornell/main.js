"use strict";
function showErr(e){ try{ var d=document.getElementById('err'); if(d){ d.style.display='block'; d.textContent='\u26a0 '+((e&&e.message)?e.message:e)+((e&&e.stack)?('\n'+e.stack.split('\n').slice(0,3).join('\n')):''); } }catch(_){ } }
window.onerror=function(m,s,l,c,err){ showErr(err||(m+' @'+l+':'+c)); };

// ==CORE START==
// SDF Cornell core (scalar, headless-testable). Hybrid: analytic walls + ray-marched objects.
// SDF primitives ported from Inigo Quilez (iquilezles.org, MIT). Tracer after RTOW (CC0).
var SCENE={
  light:18, lsize:0.33, lcol:[1.0,0.95,0.86],
  wl:[0.08,0.55,0.66], wr:[0.07,0.11,0.42], ww:[0.74,0.78,0.82],
  spheres:[
    {c:[-0.46,-0.52,-0.10], r:0.46, mat:0, shape:3, alb:[0.95,0.95,0.95], rx:0.3, ry:0.6, rz:0.1},
    {c:[ 0.04,-0.60, 0.30], r:0.42, mat:3, shape:0, alb:[1,1,1],          rx:0,   ry:0,   rz:0},
    {c:[ 0.54,-0.48,-0.30], r:0.48, mat:2, shape:2, alb:[0.92,0.92,0.96], rough:0, rx:0.2, ry:-0.4,rz:0.15}
  ],
  bounces:5
};
var CAM={az:90,el:14,R:2.45,fov:52,tx:0,ty:-0.10,tz:0};
var MSTEPS=44;
// shape: 0 sphere,1 box,2 roundbox,3 torus,4 cylinder,5 octahedron,6 capsule
// mat:   0 diffuse,2 mirror,3 glass,4 glossy

var gObj=0, gnx=0,gny=1,gnz=0;
function matMul3(A,B){ var C=new Array(9); for(var r=0;r<3;r++)for(var c=0;c<3;c++){ C[r*3+c]=A[r*3]*B[c]+A[r*3+1]*B[3+c]+A[r*3+2]*B[6+c]; } return C; }
function eulerM(rx,ry,rz){ var cx=Math.cos(rx),sx=Math.sin(rx),cy=Math.cos(ry),sy=Math.sin(ry),cz=Math.cos(rz),sz=Math.sin(rz);
  return [ cz*cy, cz*sy*sx - sz*cx, cz*sy*cx + sz*sx,
           sz*cy, sz*sy*sx + cz*cx, sz*sy*cx - cz*sx,
           -sy,   cy*sx,            cy*cx ]; }
function setObjMatrix(s,M){ s.m=M; s.mt=[M[0],M[3],M[6], M[1],M[4],M[7], M[2],M[5],M[8]]; } // mt = world->object (transpose)
function setupRot(){ for(var i=0;i<SCENE.spheres.length;i++){ var s=SCENE.spheres[i]; if(!s.m) setObjMatrix(s, eulerM(s.rx||0,s.ry||0,s.rz||0)); } }
setupRot();

function sdBox(x,y,z,bx,by,bz){ var qx=Math.abs(x)-bx,qy=Math.abs(y)-by,qz=Math.abs(z)-bz;
  var ox=qx>0?qx:0, oy=qy>0?qy:0, oz=qz>0?qz:0;
  return Math.sqrt(ox*ox+oy*oy+oz*oz)+Math.min(Math.max(qx,Math.max(qy,qz)),0); }
/* ---- 3D text: signed distance field (Felzenszwalb exact EDT) ---- */
var TEXTSDF={data:null,w:0,h:0,aspect:4,u8:null};
function _edt1d(f,d,v,z,n){ v[0]=0; z[0]=-1e20; z[1]=1e20; var k=0,q,s;
  for(q=1;q<n;q++){ s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*q-2*v[k]);
    while(s<=z[k]){ k--; s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*q-2*v[k]); }
    k++; v[k]=q; z[k]=s; z[k+1]=1e20; }
  for(q=0,k=0;q<n;q++){ while(z[k+1]<q)k++; var dd=q-v[k]; d[q]=dd*dd+f[v[k]]; } }
function _edt2d(grid,W,H){ var m=Math.max(W,H), f=new Float64Array(m), d=new Float64Array(m), v=new Int32Array(m+1), z=new Float64Array(m+1), x,y;
  for(x=0;x<W;x++){ for(y=0;y<H;y++)f[y]=grid[y*W+x]; _edt1d(f,d,v,z,H); for(y=0;y<H;y++)grid[y*W+x]=d[y]; }
  for(y=0;y<H;y++){ for(x=0;x<W;x++)f[x]=grid[y*W+x]; _edt1d(f,d,v,z,W); for(x=0;x<W;x++)grid[y*W+x]=d[x]; } }
function buildTextSDF(inside,W,H,aspect){ var INF=1e20, n=W*H, outer=new Float64Array(n), inner=new Float64Array(n), i;
  for(i=0;i<n;i++){ if(inside[i]){ outer[i]=INF; inner[i]=0; } else { outer[i]=0; inner[i]=INF; } }
  _edt2d(outer,W,H); _edt2d(inner,W,H);
  var data=new Float32Array(n), u8=new Uint8Array(n);
  for(i=0;i<n;i++){ var dpx=Math.sqrt(inner[i])-Math.sqrt(outer[i]), nrm=dpx*2/H; if(nrm>1)nrm=1; if(nrm<-1)nrm=-1; data[i]=nrm; u8[i]=Math.round((nrm*0.5+0.5)*255); }
  TEXTSDF={data:data,w:W,h:H,aspect:aspect,u8:u8}; return TEXTSDF; }
function sampleText(u,v){ var T=TEXTSDF; if(!T.data)return 1;
  var fx=u*(T.w-1), fy=v*(T.h-1); if(fx<0)fx=0; if(fx>T.w-1)fx=T.w-1; if(fy<0)fy=0; if(fy>T.h-1)fy=T.h-1;
  var x0=fx|0,y0=fy|0,x1=x0+1<T.w?x0+1:x0,y1=y0+1<T.h?y0+1:y0,tx=fx-x0,ty=fy-y0,d=T.data;
  var a=d[y0*T.w+x0],b=d[y0*T.w+x1],c=d[y1*T.w+x0],e=d[y1*T.w+x1];
  return (a*(1-tx)+b*tx)*(1-ty)+(c*(1-tx)+e*tx)*ty; }

function shapeSDF(sh,x,y,z,r){
  if(sh===0) return Math.sqrt(x*x+y*y+z*z)-r;
  if(sh===1) return sdBox(x,y,z,r*0.82,r*0.82,r*0.82);
  if(sh===2){ var b=r*0.70, rr=r*0.18; return sdBox(x,y,z,b-rr,b-rr,b-rr)-rr; }
  if(sh===3){ var ta=r*0.72, tb=r*0.30; var q=Math.sqrt(x*x+z*z)-ta; return Math.sqrt(q*q+y*y)-tb; }
  if(sh===4){ var rad=r*0.60,h=r*0.85; var dx=Math.sqrt(x*x+z*z)-rad, dy=Math.abs(y)-h;
    var ox=dx>0?dx:0, oy=dy>0?dy:0; return Math.min(Math.max(dx,dy),0)+Math.sqrt(ox*ox+oy*oy); }
  if(sh===5){ var s=r*1.15; return (Math.abs(x)+Math.abs(y)+Math.abs(z)-s)*0.57735027; }
  if(sh===6){ var hh=r*0.5, rr2=r*0.5, yc=y-Math.max(-hh,Math.min(hh,y)); return Math.sqrt(x*x+yc*yc+z*z)-rr2; }
  if(sh===8){ var Tt=TEXTSDF, asp=(Tt&&Tt.aspect)||4, th=r*0.16;
    var u=0.5 + x/(2*asp*r), v=0.5 - y/(2*r); if(u<0)u=0; if(u>1)u=1; if(v<0)v=0; if(v>1)v=1;
    var d2=sampleText(u,v)*r, dz=Math.abs(z)-th, wx=d2>0?d2:0, wy=dz>0?dz:0;
    return Math.min(Math.max(d2,dz),0)+Math.sqrt(wx*wx+wy*wy); }
  var CH=r*0.85, rb=r*0.62, rt=0.0001, qx=Math.sqrt(x*x+z*z), qy=y;
  var k1x=rt,k1y=CH, k2x=rt-rb,k2y=2*CH;
  var cax=qx-Math.min(qx,(qy<0?rb:rt)), cay=Math.abs(qy)-CH;
  var dk=((k1x-qx)*k2x+(k1y-qy)*k2y)/(k2x*k2x+k2y*k2y); dk=dk<0?0:(dk>1?1:dk);
  var cbx=qx-k1x+k2x*dk, cby=qy-k1y+k2y*dk; var sgn=(cbx<0&&cay<0)?-1:1;
  return sgn*Math.sqrt(Math.min(cax*cax+cay*cay, cbx*cbx+cby*cby));
}
function mapObjects(px,py,pz){ var best=1e9,bi=0,sp=SCENE.spheres;
  for(var i=0;i<sp.length;i++){ var s=sp[i]; if(s.vis===false) continue; var dx=px-s.c[0],dy=py-s.c[1],dz=pz-s.c[2]; var m=s.mt;
    var lx=m[0]*dx+m[1]*dy+m[2]*dz, ly=m[3]*dx+m[4]*dy+m[5]*dz, lz=m[6]*dx+m[7]*dy+m[8]*dz;
    var d=shapeSDF(s.shape,lx,ly,lz,s.r); if(d<best){best=d;bi=i;} }
  gObj=bi; return best; }
function marchObjects(ox,oy,oz,dx,dy,dz,tMax){ var t=2e-3;
  for(var i=0;i<MSTEPS;i++){ var d=mapObjects(ox+dx*t,oy+dy*t,oz+dz*t); var ad=d<0?-d:d;
    if(ad<6e-4*(1.0+t*0.5)) return t; t+=ad*0.9; if(t>tMax) return -1; }
  return -1; }
function normalObjects(px,py,pz){ var e=5e-4;
  var nx=mapObjects(px+e,py,pz)-mapObjects(px-e,py,pz);
  var ny=mapObjects(px,py+e,pz)-mapObjects(px,py-e,pz);
  var nz=mapObjects(px,py,pz+e)-mapObjects(px,py,pz-e);
  var l=Math.sqrt(nx*nx+ny*ny+nz*nz)||1; gnx=nx/l;gny=ny/l;gnz=nz/l; }

var hr={t:0,type:0,nx:0,ny:1,nz:0,ax:0,ay:0,az:0,ex:0,ey:0,ez:0,rough:0};
function hitScene(ox,oy,oz,dx,dy,dz){
  var bt=Infinity,bty=-1,nx=0,ny=1,nz=0,ax=0,ay=0,az=0,ex=0,ey=0,ez=0,rgh=0,t,px,py,pz,W=SCENE.ww;
  if(dx>1e-6||dx<-1e-6){
    t=(-1-ox)/dx; if(t>1e-3&&t<bt){py=oy+dy*t;pz=oz+dz*t; if(py<=1&&py>=-1&&pz<=1&&pz>=-1){bt=t;bty=0;nx=1;ny=0;nz=0;ax=SCENE.wl[0];ay=SCENE.wl[1];az=SCENE.wl[2];ex=ey=ez=0;}}
    t=(1-ox)/dx; if(t>1e-3&&t<bt){py=oy+dy*t;pz=oz+dz*t; if(py<=1&&py>=-1&&pz<=1&&pz>=-1){bt=t;bty=0;nx=-1;ny=0;nz=0;ax=SCENE.wr[0];ay=SCENE.wr[1];az=SCENE.wr[2];ex=ey=ez=0;}}
  }
  if(dy>1e-6||dy<-1e-6){
    t=(-1-oy)/dy; if(t>1e-3&&t<bt){px=ox+dx*t;pz=oz+dz*t; if(px<=1&&px>=-1&&pz<=1&&pz>=-1){bt=t;bty=0;nx=0;ny=1;nz=0;ax=W[0];ay=W[1];az=W[2];ex=ey=ez=0;}}
    t=(1-oy)/dy; if(t>1e-3&&t<bt){px=ox+dx*t;pz=oz+dz*t; if(px<=1&&px>=-1&&pz<=1&&pz>=-1){
      var lit=(px<SCENE.lsize&&px>-SCENE.lsize&&pz<SCENE.lsize&&pz>-SCENE.lsize);
      bt=t;bty=lit?1:0;nx=0;ny=-1;nz=0;
      if(lit){ax=ay=az=0;ex=SCENE.lcol[0]*SCENE.light;ey=SCENE.lcol[1]*SCENE.light;ez=SCENE.lcol[2]*SCENE.light;}
      else {ax=W[0];ay=W[1];az=W[2];ex=ey=ez=0;}}}
  }
  if(dz>1e-6||dz<-1e-6){
    t=(-1-oz)/dz; if(t>1e-3&&t<bt){px=ox+dx*t;py=oy+dy*t; if(px<=1&&px>=-1&&py<=1&&py>=-1){bt=t;bty=0;nx=0;ny=0;nz=1;ax=W[0];ay=W[1];az=W[2];ex=ey=ez=0;}}
  }
  // ray-marched objects, limited to the nearest wall distance
  var tObj=marchObjects(ox,oy,oz,dx,dy,dz, bt===Infinity?6.0:bt);
  if(tObj>0){ var s=SCENE.spheres[gObj]; var hx=ox+dx*tObj,hy=oy+dy*tObj,hz=oz+dz*tObj; normalObjects(hx,hy,hz);
    bt=tObj; bty=s.mat; nx=gnx;ny=gny;nz=gnz; ax=s.alb[0];ay=s.alb[1];az=s.alb[2]; if(s.mat===5&&s.emis){ex=s.emis[0];ey=s.emis[1];ez=s.emis[2];}else{ex=ey=ez=0;} rgh=(s.rough||0); }
  hr.t=bt;hr.type=bty;hr.nx=nx;hr.ny=ny;hr.nz=nz;hr.ax=ax;hr.ay=ay;hr.az=az;hr.ex=ex;hr.ey=ey;hr.ez=ez;hr.rough=rgh;
}
function cosineHemiS(nx,ny,nz,rand){
  var u1=rand(),u2=rand(); var rr=Math.sqrt(u1),th=6.283185307*u2, ct=Math.cos(th),st=Math.sin(th);
  var tx,ty,tz; if(nx>0.9||nx<-0.9){tx=0;ty=1;tz=0;} else {tx=1;ty=0;tz=0;}
  var cx=ty*nz-tz*ny, cy=tz*nx-tx*nz, cz=tx*ny-ty*nx; var cl=1/Math.sqrt(cx*cx+cy*cy+cz*cz); tx=cx*cl;ty=cy*cl;tz=cz*cl;
  var bx=ny*tz-nz*ty, by=nz*tx-nx*tz, bz=nx*ty-ny*tx; var sq=Math.sqrt(1-u1<0?0:1-u1);
  var ddx=tx*rr*ct+bx*rr*st+nx*sq, ddy=ty*rr*ct+by*rr*st+ny*sq, ddz=tz*rr*ct+bz*rr*st+nz*sq;
  var l=1/Math.sqrt(ddx*ddx+ddy*ddy+ddz*ddz); gx=ddx*l;gy=ddy*l;gz=ddz*l;
}
var gx=0,gy=0,gz=0, sr=0,sg=0,sb=0;
function sampleLightS(px,py,pz,nx,ny,nz,ax,ay,az,rand){
  var lx=(rand()*2-1)*SCENE.lsize, lz=(rand()*2-1)*SCENE.lsize;
  var dx=lx-px,dy=0.999-py,dz=lz-pz; var dist=Math.sqrt(dx*dx+dy*dy+dz*dz),inv=1/dist;
  var Lx=dx*inv,Ly=dy*inv,Lz=dz*inv; var ndl=nx*Lx+ny*Ly+nz*Lz; if(ndl<=0){sr=sg=sb=0;return;}
  var cosl=Ly; if(cosl<=0){sr=sg=sb=0;return;}
  hitScene(px+nx*1.5e-3,py+ny*1.5e-3,pz+nz*1.5e-3,Lx,Ly,Lz); if(hr.t<dist-2e-3){sr=sg=sb=0;return;}
  var area=(2*SCENE.lsize)*(2*SCENE.lsize); var g=ndl*cosl*inv*inv*area*0.3183098862, e=SCENE.light;
  sr=ax*SCENE.lcol[0]*e*g; sg=ay*SCENE.lcol[1]*e*g; sb=az*SCENE.lcol[2]*e*g;
}
function radiance(ox,oy,oz,dx,dy,dz,rand){
  var cx=0,cy=0,cz=0,tx=1,ty=1,tz=1,spec=true;
  for(var b=0;b<SCENE.bounces;b++){
    hitScene(ox,oy,oz,dx,dy,dz); var ht=hr.type; if(ht===-1) break;
    var t=hr.t, nx=hr.nx,ny=hr.ny,nz=hr.nz, ax=hr.ax,ay=hr.ay,az=hr.az;
    var px=ox+dx*t, py=oy+dy*t, pz=oz+dz*t;
    if(ht===1){ if(spec){cx+=tx*hr.ex;cy+=ty*hr.ey;cz+=tz*hr.ez;} break; }
    if(ht===5){ cx+=tx*hr.ex;cy+=ty*hr.ey;cz+=tz*hr.ez; break; }
    if(ht===0){ sampleLightS(px,py,pz,nx,ny,nz,ax,ay,az,rand); cx+=tx*sr;cy+=ty*sg;cz+=tz*sb;
      tx*=ax;ty*=ay;tz*=az; cosineHemiS(nx,ny,nz,rand); ox=px+nx*1.5e-3;oy=py+ny*1.5e-3;oz=pz+nz*1.5e-3; dx=gx;dy=gy;dz=gz; spec=false; }
    else if(ht===2){ var dn=2*(dx*nx+dy*ny+dz*nz); var Rx=dx-dn*nx,Ry=dy-dn*ny,Rz=dz-dn*nz; var rg=hr.rough; if(rg>0){ cosineHemiS(nx,ny,nz,rand); Rx+=gx*rg;Ry+=gy*rg;Rz+=gz*rg; var rl=1/Math.sqrt(Rx*Rx+Ry*Ry+Rz*Rz); Rx*=rl;Ry*=rl;Rz*=rl; } dx=Rx;dy=Ry;dz=Rz; tx*=ax;ty*=ay;tz*=az; ox=px+nx*1.5e-3;oy=py+ny*1.5e-3;oz=pz+nz*1.5e-3; spec=true; }
    else if(ht===3){ var nnx=nx,nny=ny,nnz=nz, ci=-(dx*nx+dy*ny+dz*nz), eta=0.6666667;
      if(ci<0){nnx=-nx;nny=-ny;nnz=-nz;ci=-ci;eta=1.5;}
      var F=0.04+0.96*Math.pow(1-ci,5); var k=1-eta*eta*(1-ci*ci);
      if(k<0||rand()<F){ var dn2=2*(dx*nnx+dy*nny+dz*nnz); dx-=dn2*nnx;dy-=dn2*nny;dz-=dn2*nnz; }
      else { var f=eta*ci-Math.sqrt(k); dx=eta*dx+f*nnx;dy=eta*dy+f*nny;dz=eta*dz+f*nnz; var l=1/Math.sqrt(dx*dx+dy*dy+dz*dz); dx*=l;dy*=l;dz*=l; }
      tx*=ax;ty*=ay;tz*=az; ox=px+dx*1.5e-3;oy=py+dy*1.5e-3;oz=pz+dz*1.5e-3; spec=true; }
    else { var dn3=2*(dx*nx+dy*ny+dz*nz); var Rx=dx-dn3*nx,Ry=dy-dn3*ny,Rz=dz-dn3*nz;
      cosineHemiS(nx,ny,nz,rand); var rg4=hr.rough||0.16; dx=Rx+gx*rg4;dy=Ry+gy*rg4;dz=Rz+gz*rg4; var l2=1/Math.sqrt(dx*dx+dy*dy+dz*dz); dx*=l2;dy*=l2;dz*=l2;
      tx*=ax;ty*=ay;tz*=az; ox=px+nx*1.5e-3;oy=py+ny*1.5e-3;oz=pz+nz*1.5e-3; spec=true; }
  }
  return [cx,cy,cz];
}
function camRay(px,py,W,H,rand){
  var az=CAM.az*Math.PI/180, el=CAM.el*Math.PI/180, tgx=CAM.tx,tgy=CAM.ty,tgz=CAM.tz,R=CAM.R;
  var cpx=tgx+R*Math.cos(el)*Math.cos(az), cpy=tgy+R*Math.sin(el), cpz=tgz+R*Math.cos(el)*Math.sin(az);
  var fx=tgx-cpx,fy=tgy-cpy,fz=tgz-cpz; var fl=1/Math.sqrt(fx*fx+fy*fy+fz*fz); fx*=fl;fy*=fl;fz*=fl;
  var rx=-fz, ry=0, rz=fx; var rl=1/Math.sqrt(rx*rx+rz*rz); rx*=rl;rz*=rl;
  var ux=ry*fz-rz*fy, uy=rz*fx-rx*fz, uz=rx*fy-ry*fx; var tan=Math.tan(CAM.fov*Math.PI/360); var asp=W/H;
  var ndcx=(((px+rand())/W)*2-1)*tan*asp, ndcy=(1-((py+rand())/H)*2)*tan;
  var ddx=fx+rx*ndcx+ux*ndcy, ddy=fy+ry*ndcx+uy*ndcy, ddz=fz+rz*ndcx+uz*ndcy;
  var dl=1/Math.sqrt(ddx*ddx+ddy*ddy+ddz*ddz);
  return [cpx,cpy,cpz, ddx*dl,ddy*dl,ddz*dl];
}
function acesT(x){ x=(x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14); return x<0?0:(x>1?1:x); }
// ==CORE END==

/* ---------- shared vec + camera ---------- */
function vsub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
function vcross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function vdot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
function vnorm(a){var l=Math.sqrt(vdot(a,a))||1;return [a[0]/l,a[1]/l,a[2]/l];}
function vadd(a,b){return [a[0]+b[0],a[1]+b[1],a[2]+b[2]];}
function vscale(a,s){return [a[0]*s,a[1]*s,a[2]*s];}
function cameraBasis(){
  var az=CAM.az*Math.PI/180, el=CAM.el*Math.PI/180, tgt=[CAM.tx,CAM.ty,CAM.tz], R=CAM.R;
  var cp=[tgt[0]+R*Math.cos(el)*Math.cos(az), tgt[1]+R*Math.sin(el), tgt[2]+R*Math.cos(el)*Math.sin(az)];
  var f=vnorm(vsub(tgt,cp)), rt=vnorm(vcross(f,[0,1,0])), up=vcross(rt,f);
  return {cp:cp,f:f,rt:rt,up:up,tan:Math.tan(CAM.fov*Math.PI/360)};
}
function axisAngleM(ax,ang){ // Rodrigues -> row-major 3x3 (object->world rotation about world axis)
  var x=ax[0],y=ax[1],z=ax[2],c=Math.cos(ang),s=Math.sin(ang),t=1-c;
  return [t*x*x+c, t*x*y-s*z, t*x*z+s*y,
          t*x*y+s*z, t*y*y+c, t*y*z-s*x,
          t*x*z-s*y, t*y*z+s*x, t*z*z+c];
}
function pushGPURot(){ if(gpu&&gpu.syncRot) gpu.syncRot(); }

/* ---------- CPU path tracer ---------- */
function makeCPU(cv){
  var ctx=cv.getContext('2d'); if(!ctx) return null;
  var W=108,H=108, accum=null, img=null, spp=0, y0=0, CHUNK=12;
  function setRes(w,h){ W=w;H=h; cv.width=w; cv.height=h; accum=new Float32Array(w*h*3); img=ctx.createImageData(w,h); var d=img.data; for(var i=3;i<d.length;i+=4) d[i]=255; ctx.putImageData(img,0,0); spp=0; y0=0; CHUNK=Math.max(6,Math.round(h/12)); }
  function reset(){ if(!accum) return; accum.fill(0); spp=0; y0=0; var d=img.data; for(var i=0;i<d.length;i+=4){d[i]=0;d[i+1]=0;d[i+2]=0;d[i+3]=255;} ctx.putImageData(img,0,0); }
  function step(){ if(!accum) return; var rows=Math.min(CHUNK,H-y0), den=spp+1, d=img.data, rnd=Math.random;
    for(var y=y0;y<y0+rows;y++){ for(var x=0;x<W;x++){
      var q=camRay(x,y,W,H,rnd); var c=radiance(q[0],q[1],q[2],q[3],q[4],q[5],rnd);
      var k=(y*W+x)*3; accum[k]+=c[0]; accum[k+1]+=c[1]; accum[k+2]+=c[2]; var j=(y*W+x)*4;
      d[j]=255*Math.pow(acesT(accum[k]/den),0.4545); d[j+1]=255*Math.pow(acesT(accum[k+1]/den),0.4545); d[j+2]=255*Math.pow(acesT(accum[k+2]/den),0.4545); d[j+3]=255;
    }}
    ctx.putImageData(img,0,0); y0+=rows; if(y0>=H){ y0=0; spp++; } }
  return { setRes:setRes, reset:reset, step:step, samples:function(){return spp;} };
}

/* ---------- GPU path tracer ---------- */
var VERT='';
var TRACE='';
var DISP='';
function makeGPU(cv){
  var gl=null; try{ gl=cv.getContext('webgl2',{antialias:false,preserveDrawingBuffer:false}); }catch(e){}
  if(!gl) return null;
  var CBF=gl.getExtension('EXT_color_buffer_float'); gl.getExtension('EXT_color_buffer_half_float'); gl.getExtension('OES_texture_float_linear');
  var IF=CBF?gl.RGBA32F:gl.RGBA16F, TY=CBF?gl.FLOAT:gl.HALF_FLOAT;
  function sh(t,src){ var s=gl.createShader(t); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){ showErr('shader: '+gl.getShaderInfoLog(s)); return null; } return s; }
  function prog(vs,fs){ var v=sh(gl.VERTEX_SHADER,vs),f=sh(gl.FRAGMENT_SHADER,fs); if(!v||!f) return null; var p=gl.createProgram(); gl.attachShader(p,v); gl.attachShader(p,f); gl.bindAttribLocation(p,0,'p'); gl.linkProgram(p); if(!gl.getProgramParameter(p,gl.LINK_STATUS)){ showErr('link: '+gl.getProgramInfoLog(p)); return null; } return p; }
  var pT=prog(VERT,TRACE), pD=prog(VERT,DISP); if(!pT||!pD) return null;
  var vb=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,vb); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  var W=1,H=1,tex=[],fbo=[],ping=0,spp=0,ok=true;
  var texText=gl.createTexture();
  function setTextSDF(u8,w,h){ gl.bindTexture(gl.TEXTURE_2D,texText); gl.pixelStorei(gl.UNPACK_ALIGNMENT,1); gl.texImage2D(gl.TEXTURE_2D,0,gl.R8,w,h,0,gl.RED,gl.UNSIGNED_BYTE,u8);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE); }
  function targets(){ for(var i=0;i<tex.length;i++){ gl.deleteTexture(tex[i]); gl.deleteFramebuffer(fbo[i]); } tex=[]; fbo=[];
    for(var k=0;k<2;k++){ var t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t); gl.texImage2D(gl.TEXTURE_2D,0,IF,W,H,0,gl.RGBA,TY,null);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      var f=gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER,f); gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0); tex.push(t); fbo.push(f); }
    gl.bindFramebuffer(gl.FRAMEBUFFER,fbo[0]); ok=(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE); gl.bindFramebuffer(gl.FRAMEBUFFER,null); }
  function U(p,n){ return gl.getUniformLocation(p,n); }
  function uniforms(){ var cam=cameraBasis();
    gl.uniform2f(U(pT,'uRes'),W,H); gl.uniform1f(U(pT,'uAspect'),W/H); gl.uniform1f(U(pT,'uTan'),cam.tan);
    gl.uniform3f(U(pT,'uCamPos'),cam.cp[0],cam.cp[1],cam.cp[2]); gl.uniform3f(U(pT,'uFwd'),cam.f[0],cam.f[1],cam.f[2]);
    gl.uniform3f(U(pT,'uRight'),cam.rt[0],cam.rt[1],cam.rt[2]); gl.uniform3f(U(pT,'uUp'),cam.up[0],cam.up[1],cam.up[2]);
    gl.uniform1i(U(pT,'uFrame'),spp); gl.uniform1i(U(pT,'uSamples'),spp);
    gl.uniform1i(U(pT,'uNumSph'),Math.min(SCENE.spheres.length,8)); gl.uniform1i(U(pT,'uMaxB'),SCENE.bounces); gl.uniform1i(U(pT,'uMSteps'),96);
    gl.uniform3f(U(pT,'uColL'),SCENE.wl[0],SCENE.wl[1],SCENE.wl[2]); gl.uniform3f(U(pT,'uColR'),SCENE.wr[0],SCENE.wr[1],SCENE.wr[2]); gl.uniform3f(U(pT,'uColW'),SCENE.ww[0],SCENE.ww[1],SCENE.ww[2]);
    gl.uniform3f(U(pT,'uLightCol'),SCENE.lcol[0],SCENE.lcol[1],SCENE.lcol[2]); gl.uniform1f(U(pT,'uLightInt'),SCENE.light); gl.uniform1f(U(pT,'uLightSize'),SCENE.lsize);
    for(var i=0;i<Math.min(SCENE.spheres.length,8);i++){ var s=SCENE.spheres[i];
      gl.uniform4f(U(pT,'uSph['+i+']'),s.c[0],s.c[1],s.c[2],s.r);
      gl.uniform4f(U(pT,'uSphMat['+i+']'),s.mat,s.alb[0],s.alb[1],s.alb[2]);
      gl.uniform4f(U(pT,'uSphMat2['+i+']'),(s.rough!=null?s.rough:(s.mat===4?0.16:0)),1.5,s.shape,(s.mat===5?(s.emisI||8):0));
      gl.uniform1f(U(pT,'uVis['+i+']'),(s.vis===false?0:1));
      gl.uniform3f(U(pT,'uRotInvR0['+i+']'),s.mt[0],s.mt[1],s.mt[2]);
      gl.uniform3f(U(pT,'uRotInvR1['+i+']'),s.mt[3],s.mt[4],s.mt[5]);
      gl.uniform3f(U(pT,'uRotInvR2['+i+']'),s.mt[6],s.mt[7],s.mt[8]); }
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D,texText); gl.uniform1i(U(pT,'uTextSDF'),2); gl.uniform1f(U(pT,'uTextAspect'),(TEXTSDF&&TEXTSDF.aspect)||4); gl.activeTexture(gl.TEXTURE0); }
  function setRes(w,h){ W=w; H=h; cv.width=w; cv.height=h; targets(); spp=0; }
  function reset(){ spp=0; }
  function step(nsamp){ if(!ok) return; gl.viewport(0,0,W,H); gl.useProgram(pT);
    for(var s=0;s<nsamp;s++){ gl.bindFramebuffer(gl.FRAMEBUFFER,fbo[1-ping]); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,tex[ping]);
      gl.uniform1i(U(pT,'uAccum'),0); uniforms(); gl.drawArrays(gl.TRIANGLES,0,3); ping=1-ping; spp++; }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null); gl.viewport(0,0,W,H); gl.useProgram(pD);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,tex[ping]); gl.uniform1i(U(pD,'uAccum'),0); gl.uniform2f(U(pD,'uRes'),W,H); gl.drawArrays(gl.TRIANGLES,0,3); }
  function isBlank(){ try{ var px=new Uint8Array(W*H*4); gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,px); var mx=0; for(var i=0;i<px.length;i+=4){ if(px[i]>mx)mx=px[i]; if(px[i+1]>mx)mx=px[i+1]; if(px[i+2]>mx)mx=px[i+2]; } return mx<8; }catch(e){ return false; } }
  return { setRes:setRes, reset:reset, step:step, samples:function(){return spp;}, ok:function(){return ok;}, isBlank:isBlank, syncRot:function(){}, setTextSDF:setTextSDF };
}

/* ---------- wireframe geometry ---------- */
function circlePts(plane,rad,segs){ var pts=[],i; for(i=0;i<=segs;i++){ var a=i/segs*6.2831853,c=Math.cos(a)*rad,s=Math.sin(a)*rad; if(plane===0)pts.push([c,s,0]); else if(plane===1)pts.push([c,0,s]); else pts.push([0,c,s]); } return pts; }
function polySeg(pts,out){ for(var i=0;i<pts.length-1;i++) out.push([pts[i][0],pts[i][1],pts[i][2],pts[i+1][0],pts[i+1][1],pts[i+1][2]]); }
function genWire(shape,r){ var segs=[],i,j;
  if(shape===8){ var asp=(typeof TEXTSDF!=='undefined'&&TEXTSDF.aspect)||4, hw=asp*r, hh=r, th=r*0.16;
    var rect=function(z){ segs.push([-hw,-hh,z,hw,-hh,z]); segs.push([hw,-hh,z,hw,hh,z]); segs.push([hw,hh,z,-hw,hh,z]); segs.push([-hw,hh,z,-hw,-hh,z]); };
    rect(th); rect(-th); [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].forEach(function(c){ segs.push([c[0],c[1],th,c[0],c[1],-th]); }); return segs; }
  if(shape===0){ [0,1,2].forEach(function(pl){ polySeg(circlePts(pl,r,26),segs); }); }
  else if(shape===1||shape===2){ var b=(shape===1?0.82:0.70)*r; var c=[[-b,-b,-b],[b,-b,-b],[b,b,-b],[-b,b,-b],[-b,-b,b],[b,-b,b],[b,b,b],[-b,b,b]];
    var e=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    e.forEach(function(ed){ var A=c[ed[0]],B=c[ed[1]]; segs.push([A[0],A[1],A[2],B[0],B[1],B[2]]); }); }
  else if(shape===3){ var ta=r*0.72,tb=r*0.30; polySeg(circlePts(1,ta+tb,36),segs); polySeg(circlePts(1,ta-tb,36),segs);
    for(i=0;i<8;i++){ var a=i/8*6.2831853,ring=[]; for(j=0;j<=14;j++){ var b2=j/14*6.2831853,rr=ta+Math.cos(b2)*tb; ring.push([Math.cos(a)*rr,Math.sin(b2)*tb,Math.sin(a)*rr]); } polySeg(ring,segs); } }
  else if(shape===4){ var rad=r*0.60,h=r*0.85,top=[],bot=[]; for(i=0;i<=24;i++){ var a=i/24*6.2831853,cx=Math.cos(a)*rad,cz=Math.sin(a)*rad; top.push([cx,h,cz]); bot.push([cx,-h,cz]); }
    polySeg(top,segs); polySeg(bot,segs); for(i=0;i<24;i+=6){ var a2=i/24*6.2831853; segs.push([Math.cos(a2)*rad,h,Math.sin(a2)*rad,Math.cos(a2)*rad,-h,Math.sin(a2)*rad]); } }
  else if(shape===5){ var s=r*1.15,v=[[s,0,0],[-s,0,0],[0,s,0],[0,-s,0],[0,0,s],[0,0,-s]],ed=[[0,2],[0,3],[0,4],[0,5],[1,2],[1,3],[1,4],[1,5],[2,4],[4,3],[3,5],[5,2]];
    ed.forEach(function(e){ var A=v[e[0]],B=v[e[1]]; segs.push([A[0],A[1],A[2],B[0],B[1],B[2]]); }); }
  else if(shape===6){ var rd2=r*0.5,h2=r*0.5,top2=[],bot2=[]; for(i=0;i<=20;i++){ var a=i/20*6.2831853,cx=Math.cos(a)*rd2,cz=Math.sin(a)*rd2; top2.push([cx,h2,cz]); bot2.push([cx,-h2,cz]); }
    polySeg(top2,segs); polySeg(bot2,segs);
    for(i=0;i<20;i+=5){ var a2=i/20*6.2831853; segs.push([Math.cos(a2)*rd2,h2,Math.sin(a2)*rd2,Math.cos(a2)*rd2,-h2,Math.sin(a2)*rd2]); } }
  else { var CH=r*0.85, rb=r*0.62, base=[]; for(i=0;i<=24;i++){ var a=i/24*6.2831853; base.push([Math.cos(a)*rb,-CH,Math.sin(a)*rb]); } polySeg(base,segs);
    for(i=0;i<24;i+=4){ var a3=i/24*6.2831853; segs.push([Math.cos(a3)*rb,-CH,Math.sin(a3)*rb,0,CH,0]); } }
  return segs; }
// transform local point by object matrix M (object->world) + center
function objWorld(s,p){ var m=s.m,c=s.c; return [c[0]+m[0]*p[0]+m[1]*p[1]+m[2]*p[2], c[1]+m[3]*p[0]+m[4]*p[1]+m[5]*p[2], c[2]+m[6]*p[0]+m[7]*p[1]+m[8]*p[2]]; }

/* ---------- controller ---------- */
var gpu=null;
var APP=(function(){
  var glCv=document.getElementById('gl'), cpuCv=document.getElementById('cpu'), wcv=document.getElementById('wire');
  var wctx=wcv.getContext('2d');
  var cpu=null, mode='render', backend='gpu', gpuAvail=false, raf=null, checked=false;
  var WW=400, WH=400, dpr=1;
  var sel=1, gizmo='move';
  var MATS=[['Diffuse',0],['Mirror',2],['Glass',3],['Glossy',4]], NAMES=['Left','Center','Right'];
  var SHAPES=[['Sphere',0],['Box',1],['Rounded box',2],['Torus',3],['Cylinder',4],['Cone',7],['Octahedron',5],['Capsule',6]];
  var OBJCOL=['#ff9050','#60e0ee','#c890ff'];
  var fps=0,fpsT=0,fpsN=0,lastT=0;

  function active(){ return (mode==='render'&&backend==='gpu'&&gpu)?gpu:cpu; }
  function resetRender(){ checked=false; if(cpu)cpu.reset(); if(gpu)gpu.reset(); }
  function note(t){ var d=document.getElementById('modenote'); if(d) d.innerHTML=t; }

  /* projection */
  function project(p){ var cam=PROJ; var rx=p[0]-cam.cp[0],ry=p[1]-cam.cp[1],rz=p[2]-cam.cp[2];
    var dz=rx*cam.f[0]+ry*cam.f[1]+rz*cam.f[2]; if(dz<0.02) return null;
    var cx=rx*cam.rt[0]+ry*cam.rt[1]+rz*cam.rt[2], cy=rx*cam.up[0]+ry*cam.up[1]+rz*cam.up[2];
    var half=WH/2; return { x:WW/2+(cx/dz)/cam.tan*half, y:WH/2-(cy/dz)/cam.tan*half, dz:dz }; }
  var PROJ=cameraBasis();

  /* wireframe draw */
  function line(a,b,col,w){ var pa=project(a),pb=project(b); if(!pa||!pb)return; wctx.strokeStyle=col; wctx.lineWidth=w||1; wctx.beginPath(); wctx.moveTo(pa.x,pa.y); wctx.lineTo(pb.x,pb.y); wctx.stroke(); }
  function drawScene(opaque){
    PROJ=cameraBasis();
    wctx.setTransform(dpr,0,0,dpr,0,0); wctx.clearRect(0,0,WW,WH);
    if(opaque){
      wctx.fillStyle='#0e1118'; wctx.fillRect(0,0,WW,WH);
      var C=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
      var E=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
      E.forEach(function(e){ line(C[e[0]],C[e[1]],'rgba(150,200,255,0.22)',1); });
      var ls=SCENE.lsize, L=[[-ls,1,-ls],[ls,1,-ls],[ls,1,ls],[-ls,1,ls]];
      for(var i=0;i<4;i++) line(L[i],L[(i+1)%4],'rgba(255,200,50,0.6)',1.5);
      for(var oi=0;oi<SCENE.spheres.length;oi++){ var s=SCENE.spheres[oi];
        var segs=genWire(s.shape,s.r); var col=oi===sel?'rgba(255,200,50,0.95)':'rgba(150,200,255,0.5)';
        wctx.strokeStyle=col; wctx.lineWidth=oi===sel?1.4:1;
        for(var k=0;k<segs.length;k++){ var sg=segs[k]; var A=objWorld(s,[sg[0],sg[1],sg[2]]),B=objWorld(s,[sg[3],sg[4],sg[5]]);
          var pa=project(A),pb=project(B); if(!pa||!pb)continue; wctx.beginPath(); wctx.moveTo(pa.x,pa.y); wctx.lineTo(pb.x,pb.y); wctx.stroke(); }
      }
      var pt=project([CAM.tx,CAM.ty,CAM.tz]); if(pt){ wctx.strokeStyle='rgba(150,200,255,0.5)'; wctx.lineWidth=1; wctx.beginPath(); wctx.moveTo(pt.x-6,pt.y); wctx.lineTo(pt.x+6,pt.y); wctx.moveTo(pt.x,pt.y-6); wctx.lineTo(pt.x,pt.y+6); wctx.stroke(); }
    }
    if(typeof sel==='number'&&SCENE.spheres[sel]) drawGizmo(SCENE.spheres[sel]);
  }
  function gizLen(s){ return 0.42+s.r*0.7; }
  var AX=[[1,0,0],[0,1,0],[0,0,1]], AXCOL=['#ff5a5a','#64dd64','#5a9cff'];
  function drawGizmo(s){ var C=s.c, L=gizLen(s); var pc=project(C); if(!pc)return; var aL=L*0.9, sL=L*1.18;
    for(var a2=0;a2<3;a2++){ var ringPlane=a2===0?2:(a2===1?1:0); var pts=circlePts(ringPlane,L,48);
      wctx.strokeStyle=AXCOL[a2]; wctx.globalAlpha=0.8; wctx.lineWidth=2; wctx.beginPath(); var started=false;
      for(var i=0;i<pts.length;i++){ var w=vadd(C,pts[i]); var pp=project(w); if(!pp){started=false;continue;} if(!started){wctx.moveTo(pp.x,pp.y);started=true;}else wctx.lineTo(pp.x,pp.y); }
      wctx.stroke(); }
    wctx.globalAlpha=1;
    for(var a=0;a<3;a++){ var tip=project(vadd(C,vscale(AX[a],aL))), sc=project(vadd(C,vscale(AX[a],sL))); if(!tip)continue;
      wctx.strokeStyle=AXCOL[a]; wctx.lineWidth=3.5; wctx.beginPath(); wctx.moveTo(pc.x,pc.y); wctx.lineTo(tip.x,tip.y); wctx.stroke();
      wctx.fillStyle=AXCOL[a]; var ang=Math.atan2(tip.y-pc.y,tip.x-pc.x); wctx.save(); wctx.translate(tip.x,tip.y); wctx.rotate(ang); wctx.beginPath(); wctx.moveTo(3,0); wctx.lineTo(-18,-9); wctx.lineTo(-18,9); wctx.closePath(); wctx.fill(); wctx.restore();
      if(sc){ wctx.fillStyle=AXCOL[a]; wctx.fillRect(sc.x-6,sc.y-6,12,12); wctx.strokeStyle='rgba(8,10,16,0.85)'; wctx.lineWidth=1.5; wctx.strokeRect(sc.x-6,sc.y-6,12,12); } }
    wctx.fillStyle='rgba(255,200,50,0.92)'; wctx.fillRect(pc.x-5,pc.y-5,10,10);
  }

  /* picking */
  function distToSeg(px,py,ax,ay,bx,by){ var dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy; if(l2<1e-6)return Math.hypot(px-ax,py-ay); var t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/l2)); return Math.hypot(px-(ax+t*dx),py-(ay+t*dy)); }
  function pickGizmo(px,py){ if(typeof sel!=='number'||!SCENE.spheres[sel])return null; var s=SCENE.spheres[sel],C=s.c,L=gizLen(s); var pc=project(C); if(!pc)return null; var aL=L*0.9, sL=L*1.18;
    for(var a=0;a<3;a++){ var sc=project(vadd(C,vscale(AX[a],sL))); if(sc&&Math.hypot(px-sc.x,py-sc.y)<14) return {type:'scale',axis:a}; }
    for(var a2=0;a2<3;a2++){ var pe=project(vadd(C,vscale(AX[a2],aL))); if(pe&&distToSeg(px,py,pc.x,pc.y,pe.x,pe.y)<10) return {type:'move',axis:a2}; }
    for(var a3=0;a3<3;a3++){ var ringPlane=a3===0?2:(a3===1?1:0); var pts=circlePts(ringPlane,L,48),best=999;
      for(var i=0;i<pts.length-1;i++){ var p1=project(vadd(C,pts[i])),p2=project(vadd(C,pts[i+1])); if(!p1||!p2)continue; best=Math.min(best,distToSeg(px,py,p1.x,p1.y,p2.x,p2.y)); }
      if(best<11) return {type:'rot',axis:a3}; }
    if(Math.hypot(px-pc.x,py-pc.y)<13) return {type:'plane'};
    return null; }
  function pickObject(px,py){ var bestI=-1,bestD=18; for(var i=0;i<SCENE.spheres.length;i++){ var p=project(SCENE.spheres[i].c); if(!p)continue; var d=Math.hypot(px-p.x,py-p.y); if(d<bestD){bestD=d;bestI=i;} } return bestI; }

  /* input */
  var drag=null;
  function evPos(e){ var r=wcv.getBoundingClientRect(); var t=e.touches?e.touches[0]:e; return [t.clientX-r.left,t.clientY-r.top]; }
  function down(e){ var pos=evPos(e); var g=pickGizmo(pos[0],pos[1]);
    if(g){ var s=SCENE.spheres[sel]; drag={kind:g.type,axis:g.axis,sx:pos[0],sy:pos[1],c0:s.c.slice(),r0:s.r,m0:s.m.slice(),ang0:0}; wcv.classList.add('dragging'); return; }
    var oi=pickObject(pos[0],pos[1]); if(oi>=0){ sel=oi; rebuildUI(); updateStatus(); drag={kind:'orbit',sx:pos[0],sy:pos[1],az0:CAM.az,el0:CAM.el,justSel:true}; wcv.classList.add('dragging'); return; }
    drag={kind:'orbit',sx:pos[0],sy:pos[1],az0:CAM.az,el0:CAM.el}; wcv.classList.add('dragging'); }
  function move(e){ if(!drag)return; var pos=evPos(e); var dx=pos[0]-drag.sx, dy=pos[1]-drag.sy; var s=SCENE.spheres[sel];
    if(drag.kind==='orbit'){ CAM.az=drag.az0 - dx*0.35; CAM.el=Math.max(-85,Math.min(85,drag.el0 + dy*0.35)); }
    else if(drag.kind==='plane'){ var pc=project(drag.c0); var wpp=pc.dz*PROJ.tan/(WH/2); s.c=[drag.c0[0]+(PROJ.rt[0]*dx-PROJ.up[0]*dy)*wpp, drag.c0[1]+(PROJ.rt[1]*dx-PROJ.up[1]*dy)*wpp, drag.c0[2]+(PROJ.rt[2]*dx-PROJ.up[2]*dy)*wpp]; }
    else if(drag.kind==='move'){ var ax=AX[drag.axis]; var pc2=project(drag.c0),pe=project(vadd(drag.c0,ax)); if(pc2&&pe){ var sxu=pe.x-pc2.x,syu=pe.y-pc2.y,len=Math.hypot(sxu,syu)||1; var t=((dx)*sxu+(dy)*syu)/(len*len); s.c=[drag.c0[0]+ax[0]*t,drag.c0[1]+ax[1]*t,drag.c0[2]+ax[2]*t]; } }
    else if(drag.kind==='scale'||drag.kind==='scaleC'){ s.r=Math.max(0.12,Math.min(0.8,drag.r0*(1-dy/220))); }
    else if(drag.kind==='rot'){ var pc3=project(drag.c0); var a0=Math.atan2(drag.sy-pc3.y,drag.sx-pc3.x),a1=Math.atan2(pos[1]-pc3.y,pos[0]-pc3.x); var dA=a1-a0; var axis=AX[drag.axis]; var sgn=(vdot(axis,PROJ.f)>0)?-1:1; var R=axisAngleM(axis,dA*sgn); s.m=matMul3(R,drag.m0); s.mt=[s.m[0],s.m[3],s.m[6],s.m[1],s.m[4],s.m[7],s.m[2],s.m[5],s.m[8]]; }
    if(drag.kind!=='orbit'&&drag.kind!=='rot'){ /* moved/scaled */ }
    drag.justSel=false; if(mode==='render') resetRender(); }
  function up(){ if(drag){ if(mode==='render') resetRender(); } drag=null; wcv.classList.remove('dragging'); }
  wcv.addEventListener('mousedown',down); window.addEventListener('mousemove',move); window.addEventListener('mouseup',up);
  wcv.addEventListener('touchstart',function(e){ if(e.touches.length===2){ drag={kind:'pinch',d0:pinchDist(e),R0:CAM.R}; return; } e.preventDefault(); down(e); },{passive:false});
  wcv.addEventListener('touchmove',function(e){ if(drag&&drag.kind==='pinch'&&e.touches.length===2){ var d=pinchDist(e); CAM.R=Math.max(1.2,Math.min(6,drag.R0*drag.d0/d)); e.preventDefault(); return; } e.preventDefault(); move(e); },{passive:false});
  wcv.addEventListener('touchend',up);
  function pinchDist(e){ var a=e.touches[0],b=e.touches[1]; return Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY); }
  wcv.addEventListener('wheel',function(e){ e.preventDefault(); CAM.R=Math.max(1.2,Math.min(6,CAM.R*(e.deltaY>0?1.08:1/1.08))); if(mode==='render')resetRender(); },{passive:false});

  /* sizing — render buffers track viewport aspect (no squish) */
  function renderDims(base){ var asp=WW/WH,w,h; if(asp>=1){ h=base; w=Math.round(base*asp); } else { w=base; h=Math.round(base/asp); }
    var cap=Math.round(base*2.0); if(w>cap){ w=cap; h=Math.round(w/asp); } if(h>cap){ h=cap; w=Math.round(h*asp); } return [Math.max(8,w),Math.max(8,h)]; }
  function applyRes(){ var sm=Math.min(WW,WH)<360; var dc=renderDims(sm?104:150), dg=renderDims(sm?300:440); if(cpu) cpu.setRes(dc[0],dc[1]); if(gpu) gpu.setRes(dg[0],dg[1]); }
  var resizeTO=null;
  function resize(){ var w=document.getElementById('canvas-wrap'); WW=w.clientWidth||400; WH=w.clientHeight||400; dpr=Math.min(window.devicePixelRatio||1,2);
    wcv.width=WW*dpr; wcv.height=WH*dpr; wcv.style.width=WW+'px'; wcv.style.height=WH+'px';
    if(resizeTO) clearTimeout(resizeTO); resizeTO=setTimeout(function(){ applyRes(); if(mode==='render') resetRender(); }, 180); }
  if(window.ResizeObserver) new ResizeObserver(resize).observe(document.getElementById('canvas-wrap')); else window.addEventListener('resize',resize);

  /* loop */
  function loop(t){ raf=requestAnimationFrame(loop);
    var dt=(t-lastT)/1000; lastT=t; fpsT+=dt; fpsN++; if(fpsT>=0.5){ fps=Math.round(fpsN/fpsT); fpsT=0; fpsN=0; }
    try{
      if(mode==='wire'){ drawScene(true); }
      else if(mode==='shaded'){ drawShaded(); }
      else { var a=active();
        if(backend==='gpu'&&gpu){ if(a.samples()<4000) a.step(2); if(!checked&&a.samples()>=10){ checked=true; if(a.isBlank()){ gpuAvail=false; backend='cpu'; paintBackend(); showCanvas(); resetRender(); note('<b>GPU blank on this device</b> — using CPU.'); } } }
        else { if(a.samples()<400) a.step(); }
        drawScene(false);
      }
      updateStatus();
    }catch(e){ showErr(e); if(mode==='render'&&backend==='gpu'){ backend='cpu'; gpuAvail=false; paintBackend(); showCanvas(); } }
  }
  function updateStatus(){
    var mn = mode==='wire'?'WIREFRAME':(mode==='shaded'?'SHADED':('RENDER \u00b7 '+backend.toUpperCase()));
    document.getElementById('st-mode').textContent=mn;
    document.getElementById('st-cam').textContent='az '+Math.round(((CAM.az%360)+360)%360)+' \u00b7 el '+Math.round(CAM.el)+' \u00b7 d '+CAM.R.toFixed(2);
    document.getElementById('st-sel').textContent='sel: '+selName();
    if(mode==='render') document.getElementById('st-extra').textContent='spp '+active().samples()+' \u00b7 '+fps+'fps';
    else document.getElementById('st-extra').textContent=fps+' fps';
  }
  function selName(){ if(sel==='ceiling')return 'Ceiling Light'; if(typeof sel==='number'&&SCENE.spheres[sel])return SCENE.spheres[sel].name; return 'none'; }

  /* ---- shaded raycast viewport (solid preview, reuses the SDF scene) ---- */
  var shadeCv=document.createElement('canvas'), shadeCtx=shadeCv.getContext('2d'), shadeImg=null, shadeRow=0, shadeW=0, shadeH=0, shadeLights=[];
  function half(){ return 0.5; }
  function tone(r,g,b){ return [255*Math.pow(acesT(r),0.4545),255*Math.pow(acesT(g),0.4545),255*Math.pow(acesT(b),0.4545)]; }
  function shadeRay(q,lights){
    hitScene(q[0],q[1],q[2],q[3],q[4],q[5]);
    if(hr.type===-1) return [12,15,22];
    var t=hr.t, px=q[0]+q[3]*t, py=q[1]+q[4]*t, pz=q[2]+q[5]*t;
    if(hr.type===1) return [250,246,236];
    if(hr.type===5) return tone(hr.ex*0.55,hr.ey*0.55,hr.ez*0.55);
    var nx=hr.nx,ny=hr.ny,nz=hr.nz, ax=hr.ax,ay=hr.ay,az=hr.az;
    var amb=0.24, rC=amb,gC=amb,bC=amb;
    var lx=0-px,ly=0.999-py,lz=0-pz,il=1/Math.sqrt(lx*lx+ly*ly+lz*lz); lx*=il;ly*=il;lz*=il;
    var df=Math.max(0,nx*lx+ny*ly+nz*lz)*1.15; rC+=df*SCENE.lcol[0];gC+=df*SCENE.lcol[1];bC+=df*SCENE.lcol[2];
    for(var i=0;i<lights.length;i++){ var L=lights[i]; var dx=L.c[0]-px,dy=L.c[1]-py,dz=L.c[2]-pz,dd=dx*dx+dy*dy+dz*dz,inv=1/Math.sqrt(dd);
      var ndl=Math.max(0,nx*dx*inv+ny*dy*inv+nz*dz*inv), att=ndl/(0.35+dd)*0.05; rC+=att*L.emis[0];gC+=att*L.emis[1];bC+=att*L.emis[2]; }
    var hl=Math.max(0,-(nx*q[3]+ny*q[4]+nz*q[5]))*0.14; rC+=hl;gC+=hl;bC+=hl;
    return tone(ax*rC,ay*gC,az*bC);
  }
  var shadeSig='';
  function sceneSig(){ var s=CAM.az+'_'+CAM.el+'_'+CAM.R+'_'+CAM.fov+'_'+CAM.tx+'_'+CAM.ty+'_'+CAM.tz+'|'+sel+'|'+gizmo+'|'+SCENE.light+'_'+SCENE.lsize+'|'+WW+'x'+WH+'|'+TEXTSTR+'|';
    for(var i=0;i<SCENE.spheres.length;i++){ var o=SCENE.spheres[i]; s+=o.shape+'/'+o.mat+'/'+o.r+'/'+o.c.join(',')+'/'+(o.vis===false?'h':'v')+'/'+(o.m?o.m.join(','):'')+'/'+(o.alb?o.alb.join(','):'')+'/'+(o.emisI||0)+';'; } return s; }
  function drawShaded(){
    var dragging=!!drag, sig=sceneSig();
    var targetH=dragging?130:Math.min(Math.round(WH*Math.min(dpr||1,2)),600);
    var targetW=Math.max(8,Math.round(targetH*WW/WH));
    var resized=(targetW!==shadeW||targetH!==shadeH), changed=(sig!==shadeSig||resized);
    if(!changed && shadeRow>=shadeH) return;                 // converged & idle: nothing to do
    if(changed){
      if(resized){ var nc=document.createElement('canvas'); nc.width=targetW; nc.height=targetH; var ncx=nc.getContext('2d');
        if(shadeCv.width>1){ ncx.imageSmoothingEnabled=true; try{ ncx.drawImage(shadeCv,0,0,targetW,targetH); }catch(e){} }  // seed: blur previous frame so there is no flash
        shadeCv=nc; shadeCtx=ncx; shadeImg=ncx.getImageData(0,0,targetW,targetH); shadeW=targetW; shadeH=targetH; }
      shadeSig=sig; shadeRow=0; PROJ=cameraBasis();
      shadeLights=[]; for(var i=0;i<SCENE.spheres.length;i++){ var o=SCENE.spheres[i]; if(o.mat===5&&o.vis!==false&&o.emis) shadeLights.push(o); }
    }
    if(shadeRow<shadeH){
      var band=dragging?shadeH:Math.max(2,Math.floor(42000/shadeW));
      var y1=Math.min(shadeH,shadeRow+band), d=shadeImg.data;
      for(var y=shadeRow;y<y1;y++){ var rb=y*shadeW*4; for(var x=0;x<shadeW;x++){ var q=camRay(x,y,shadeW,shadeH,half), c=shadeRay(q,shadeLights), k=rb+x*4; d[k]=c[0];d[k+1]=c[1];d[k+2]=c[2];d[k+3]=255; } }
      shadeRow=y1; shadeCtx.putImageData(shadeImg,0,0);
    }
    wctx.setTransform(dpr,0,0,dpr,0,0); wctx.clearRect(0,0,WW,WH); wctx.imageSmoothingEnabled=true; wctx.drawImage(shadeCv,0,0,WW,WH);
    if(typeof sel==='number'&&SCENE.spheres[sel]) drawGizmo(SCENE.spheres[sel]);
  }

  /* ---- canvases / modes ---- */
  function usingGpu(){ return backend==='gpu'&&!!gpu; }
  function showCanvas(){ var r=(mode==='render'); glCv.style.display=(r&&usingGpu())?'block':'none'; cpuCv.style.display=(r&&!usingGpu())?'block':'none'; wcv.style.display='block'; }
  function paintMode(){ var b=document.getElementById('modeSeg').children, ms=['wire','shaded','render']; for(var i=0;i<3;i++) b[i].classList.toggle('on',mode===ms[i]); document.getElementById('bkSeg').style.opacity=mode==='render'?'1':'0.4'; }
  function paintBackend(){ document.getElementById('bGpu').classList.toggle('on',backend==='gpu'); document.getElementById('bCpu').classList.toggle('on',backend==='cpu'); document.getElementById('bGpu').disabled=!gpuAvail; }

  /* ---- 3D text generation ---- */
  var TEXTSTR='[ davesgames.io ]';
  function genTextSDF(str){ TEXTSTR=(str==null?TEXTSTR:str)||'davesgames.io';
    var fsz=120, pad=20, font='800 '+fsz+'px Inter, "Helvetica Neue", Helvetica, Arial, sans-serif';
    var c=document.createElement('canvas'), x=c.getContext('2d'); x.font=font;
    var tw=Math.max(10,Math.ceil(x.measureText(TEXTSTR).width)), W=tw+pad*2, Hh=fsz+pad*2;
    c.width=W; c.height=Hh; x=c.getContext('2d'); x.fillStyle='#000'; x.fillRect(0,0,W,Hh);
    x.font=font; x.fillStyle='#fff'; x.textAlign='center'; x.textBaseline='middle'; x.fillText(TEXTSTR,W/2,Hh/2+2);
    var im=x.getImageData(0,0,W,Hh).data, inside=new Uint8Array(W*Hh);
    for(var i=0;i<W*Hh;i++) inside[i]=im[i*4]>128?1:0;
    buildTextSDF(inside,W,Hh,W/Hh); if(gpu&&gpu.setTextSDF) gpu.setTextSDF(TEXTSDF.u8,W,Hh); }

  /* ---- scene CRUD ---- */
  var nameCount={};
  function autoName(base){ nameCount[base]=(nameCount[base]||0)+1; return base+(''+nameCount[base]).padStart(2,'0'); }
  var SHNAME=['Sphere','Box','RBox','Torus','Cylinder','Octa','Capsule','Cone'];
  function newObj(kind,shape,opt){ if(SCENE.spheres.length>=8){ note('<b>Scene full.</b> Max 8 objects \u2014 delete one first.'); tab('modify'); return; }
    var o;
    if(kind==='light'){ var la=(opt&&opt.alb)||[1,0.86,0.66], li=(opt&&opt.emisI)||11, lr=(opt&&opt.r)||0.1, lb=(opt&&opt.base)||'Light'; o={name:autoName(lb),kind:'light',shape:(shape==null?0:shape),mat:5,alb:la.slice(),emisI:li,emis:[la[0]*li,la[1]*li,la[2]*li],c:[0,0.45,0.1],r:lr,rx:0,ry:0,rz:0,vis:true}; }
    else if(kind==='text'){ o={name:autoName('Text'),kind:'text',shape:8,mat:0,alb:[0.96,0.84,0.42],c:[0,-0.05,0],r:0.14,rx:0,ry:0,rz:0,vis:true}; }
    else { var cols=[[0.82,0.4,0.34],[0.4,0.7,0.52],[0.52,0.58,0.9],[0.82,0.74,0.4]], col=cols[SCENE.spheres.length%4];
      o={name:autoName(SHNAME[shape]||'Object'),kind:'geo',shape:shape,mat:0,alb:col,c:[0,-0.25,0],r:0.34,rough:0,rx:0.2,ry:0.4,rz:0,vis:true}; }
    setObjMatrix(o, eulerM(o.rx,o.ry,o.rz)); SCENE.spheres.push(o); sel=SCENE.spheres.length-1; tab('modify'); rebuildUI(); if(mode==='render')resetRender(); }
  function delObject(i){ SCENE.spheres.splice(i,1); if(sel===i) sel=(SCENE.spheres.length?Math.min(i,SCENE.spheres.length-1):'ceiling'); else if(typeof sel==='number'&&sel>i) sel--; rebuildUI(); if(mode==='render')resetRender(); }
  function toggleVis(i){ var o=SCENE.spheres[i]; o.vis=(o.vis===false); rebuildUI(); if(mode==='render')resetRender(); }
  function selectItem(s){ sel=s; tab('modify'); rebuildUI(); updateStatus(); }
  function syncLight(o){ o.emis=[o.alb[0]*o.emisI,o.alb[1]*o.emisI,o.alb[2]*o.emisI]; }

  /* ---- UI builders ---- */
  function tab(t){ document.getElementById('tabCreate').classList.toggle('on',t==='create'); document.getElementById('tabModify').classList.toggle('on',t==='modify'); document.getElementById('paneCreate').style.display=t==='create'?'block':'none'; document.getElementById('paneModify').style.display=t==='modify'?'block':'none'; }
  function ico(o){ if(o.kind==='text')return 'T'; if(o.kind==='light')return '\u25c9'; return ['\u25ef','\u25a2','\u25a2','\u25cc','\u25ad','\u25c6','\u25ad','\u25b2'][o.shape]||'\u25c6'; }
  function buildCreate(){
    var geos=[['Sphere',0,'\u25ef'],['Box',1,'\u25a2'],['Rounded',2,'\u25a2'],['Torus',3,'\u25cc'],['Cylinder',4,'\u25ad'],['Cone',7,'\u25b2'],['Octahedron',5,'\u25c6'],['Capsule',6,'\u25ad']];
    var g=document.getElementById('createGeo'); g.innerHTML='';
    geos.forEach(function(it){ var b=document.createElement('button'); b.className='create-btn'; b.innerHTML='<span class="g">'+it[2]+'</span>'+it[0]; b.onclick=function(){ newObj('geo',it[1]); }; g.appendChild(b); });
    var tb=document.createElement('button'); tb.className='create-btn'; tb.style.gridColumn='1 / -1'; tb.innerHTML='<span class="g" style="font-weight:800">T</span>3D Text'; tb.onclick=function(){ newObj('text'); }; g.appendChild(tb);
    var lg=document.getElementById('createLight'); lg.innerHTML='';
    var lights=[['Omni',0,'\u25c9',[1,0.86,0.66],11,0.1],['Tube',6,'\u2503',[0.66,0.82,1],9,0.12],['Bar',4,'\u25ad',[1,0.72,0.5],9,0.12],['Panel',1,'\u25a3',[0.95,0.97,1],7,0.16],['Cone',7,'\u25b2',[0.7,1,0.82],10,0.14]];
    lights.forEach(function(it){ var b=document.createElement('button'); b.className='create-btn'; b.innerHTML='<span class="g" style="color:var(--yellow)">'+it[2]+'</span>'+it[0]+' Light'; b.onclick=function(){ newObj('light',it[1],{base:it[0],alb:it[3],emisI:it[4],r:it[5]}); }; lg.appendChild(b); });
  }
  function fld(label){ var d=document.createElement('div'); d.className='fieldlbl'; d.textContent=label; return d; }
  function slider(min,max,step,val,oninput){ var w=document.createElement('div'); w.className='mag-row';
    var s=document.createElement('input'); s.type='range'; s.min=min; s.max=max; s.step=step; s.value=val;
    var v=document.createElement('span'); v.className='val'; var dec=step<1?2:0; v.textContent=(+val).toFixed(dec);
    function pc(){ s.style.setProperty('--pct',((s.value-min)/(max-min)*100)+'%'); }
    s.oninput=function(){ pc(); v.textContent=(+s.value).toFixed(dec); oninput(+s.value); }; pc();
    w.appendChild(s); w.appendChild(v); return w; }
  function hx(c){ function p(x){ x=Math.max(0,Math.min(255,Math.round(x*255))).toString(16); return x.length<2?'0'+x:x; } return '#'+p(c[0])+p(c[1])+p(c[2]); }
  function colorRow(getc,setc){ var cw=document.createElement('input'); cw.type='color'; cw.className='swatch'; cw.value=hx(getc()); cw.oninput=function(){ var v=cw.value; setc([parseInt(v.substr(1,2),16)/255,parseInt(v.substr(3,2),16)/255,parseInt(v.substr(5,2),16)/255]); if(mode==='render')resetRender(); }; return cw; }
  function buildModify(){
    var host=document.getElementById('modifyBody'); host.innerHTML='';
    if(sel==='ceiling'){
      var hd=document.createElement('div'); hd.className='mod-head'; hd.innerHTML='<span class="tree-ico" style="color:var(--yellow)">\u25c9</span>Ceiling Light'; host.appendChild(hd);
      host.appendChild(fld('Intensity')); host.appendChild(slider(3,45,1,SCENE.light,function(v){ SCENE.light=v; if(mode==='render')resetRender(); }));
      host.appendChild(fld('Size')); host.appendChild(slider(0.1,0.6,0.01,SCENE.lsize,function(v){ SCENE.lsize=v; if(mode==='render')resetRender(); }));
      host.appendChild(fld('Color')); host.appendChild(colorRow(function(){return SCENE.lcol;},function(c){SCENE.lcol=c;}));
      return;
    }
    if(typeof sel!=='number'||!SCENE.spheres[sel]){ var e=document.createElement('div'); e.className='mod-empty'; e.textContent='Nothing selected. Pick an item in the Scene Explorer above, or open the Create tab to add geometry or a light.'; host.appendChild(e); return; }
    var o=SCENE.spheres[sel];
    var hh=document.createElement('div'); hh.className='mod-head'; hh.innerHTML='<span class="tree-ico" style="color:'+(o.kind==='light'?'var(--yellow)':'var(--blue)')+'">'+ico(o)+'</span>'+o.name; host.appendChild(hh);
    host.appendChild(fld('Transform'));
    var gh=document.createElement('div'); gh.className='mod-empty'; gh.style.margin='0'; gh.innerHTML='Drag the on-screen gimbal \u2014 <b style="color:#ff5a5a">arrows</b> move, <b style="color:#5a9cff">rings</b> rotate, <b style="color:#64dd64">cubes</b> scale.'; host.appendChild(gh);
    if(o.kind==='geo'){
      host.appendChild(fld('Shape'));
      var ss=document.createElement('select'); ss.className='shapesel'; SHAPES.forEach(function(sh){ var op=document.createElement('option'); op.value=sh[1]; op.textContent=sh[0]; if(o.shape===sh[1])op.selected=true; ss.appendChild(op); }); ss.onchange=function(){ o.shape=+ss.value; rebuildUI(); if(mode==='render')resetRender(); }; host.appendChild(ss);
      host.appendChild(fld('Material'));
      var mg=document.createElement('div'); mg.className='seg g4'; MATS.forEach(function(m){ var b=document.createElement('button'); b.textContent=m[0]; if(o.mat===m[1])b.classList.add('on'); b.onclick=function(){ o.mat=m[1]; if(m[1]===4&&!(o.rough>0))o.rough=0.18; buildModify(); if(mode==='render')resetRender(); }; mg.appendChild(b); }); host.appendChild(mg);
      host.appendChild(fld('Color')); host.appendChild(colorRow(function(){return o.alb;},function(c){o.alb=c;}));
      if(o.mat===2||o.mat===4){ host.appendChild(fld('Roughness')); host.appendChild(slider(0,0.6,0.01,(o.rough||0),function(v){ o.rough=v; if(mode==='render')resetRender(); })); }
    } else if(o.kind==='text'){
      host.appendChild(fld('Text string'));
      var ti=document.createElement('input'); ti.type='text'; ti.className='txtinput'; ti.value=TEXTSTR; var tmo;
      ti.oninput=function(){ clearTimeout(tmo); tmo=setTimeout(function(){ genTextSDF(ti.value); shadeSig=''; if(mode==='render')resetRender(); }, 280); };
      host.appendChild(ti);
      host.appendChild(fld('Material'));
      var mgt=document.createElement('div'); mgt.className='seg g4'; MATS.forEach(function(m){ var b=document.createElement('button'); b.textContent=m[0]; if(o.mat===m[1])b.classList.add('on'); b.onclick=function(){ o.mat=m[1]; if(m[1]===4&&!(o.rough>0))o.rough=0.18; buildModify(); if(mode==='render')resetRender(); }; mgt.appendChild(b); }); host.appendChild(mgt);
      host.appendChild(fld('Color')); host.appendChild(colorRow(function(){return o.alb;},function(c){o.alb=c;}));
      if(o.mat===2||o.mat===4){ host.appendChild(fld('Roughness')); host.appendChild(slider(0,0.6,0.01,(o.rough||0),function(v){ o.rough=v; if(mode==='render')resetRender(); })); }
    } else {
      host.appendChild(fld('Intensity')); host.appendChild(slider(2,30,1,o.emisI,function(v){ o.emisI=v; syncLight(o); if(mode==='render')resetRender(); }));
      host.appendChild(fld('Color')); host.appendChild(colorRow(function(){return o.alb;},function(c){o.alb=c; syncLight(o);}));
    }
    host.appendChild(fld(o.kind==='light'?'Radius':'Size'));
    host.appendChild(slider(0.06,0.7,0.01,o.r,function(v){ o.r=v; if(mode==='render')resetRender(); }));
    host.appendChild(fld('Position   X \u00b7 Y \u00b7 Z'));
    [0,1,2].forEach(function(ai){ host.appendChild(slider(-0.95,0.95,0.01,o.c[ai],function(v){ o.c[ai]=v; if(mode==='render')resetRender(); })); });
    var del=document.createElement('button'); del.className='pbtn'; del.style.cssText='margin-top:11px;border-color:rgba(224,122,122,0.35);color:#e07a7a'; del.textContent='\u2715 Delete '+o.name; del.onclick=function(){ delObject(sel); }; host.appendChild(del);
  }
  function buildTree(){
    var t=document.getElementById('tree'); t.innerHTML='';
    function mkrow(o,i,isCeil){
      var r=document.createElement('div'); r.className='tree-row'+((isCeil?sel==='ceiling':sel===i)?' sel':'')+((!isCeil&&o.vis===false)?' hidden':'');
      var eye=document.createElement('span'); eye.className='tree-eye'+((!isCeil&&o.vis===false)?' off':''); eye.textContent=(!isCeil&&o.vis===false)?'\u25cb':'\u25c9';
      eye.onclick=function(e){ e.stopPropagation(); if(!isCeil) toggleVis(i); };
      var ic=document.createElement('span'); ic.className='tree-ico'; ic.style.color=isCeil?'var(--yellow)':(o.kind==='light'?'var(--yellow)':'var(--blue)'); ic.textContent=isCeil?'\u25c9':ico(o);
      var nm=document.createElement('span'); nm.className='tree-name'; nm.textContent=isCeil?'Ceiling Light':o.name;
      r.appendChild(eye); r.appendChild(ic); r.appendChild(nm);
      if(!isCeil){ var x=document.createElement('span'); x.className='tree-del'; x.textContent='\u2715'; x.onclick=function(e){ e.stopPropagation(); delObject(i); }; r.appendChild(x); }
      r.onclick=function(){ selectItem(isCeil?'ceiling':i); };
      return r;
    }
    t.appendChild(mkrow(null,-1,true));
    SCENE.spheres.forEach(function(o,i){ t.appendChild(mkrow(o,i,false)); });
  }
  function rebuildUI(){ buildTree(); buildModify(); paintMode(); }

  /* ---- public ---- */
  function setMode(m){ mode=m; if(m==='shaded') shadeSig=''; paintMode(); showCanvas(); if(m==='render') resetRender();
    note(m==='wire'?'Wireframe viewport. Drag to orbit \u00b7 scroll / pinch to zoom.':(m==='shaded'?'Solid shaded preview \u2014 real-time. Drag to orbit \u00b7 scroll to zoom.':'Path-traced render. Orbiting re-renders from the new angle.')); updateStatus(); }
  function setBackend(b){ if(b==='gpu'&&!gpuAvail)return; backend=b; paintBackend(); showCanvas(); if(mode==='render')resetRender(); }
  function setGizmo(g){ gizmo=g; if(typeof sel==='number') buildModify(); }
  function resetView(){ CAM.az=90; CAM.el=14; CAM.R=2.45; CAM.fov=52; CAM.tx=0; CAM.ty=-0.10; CAM.tz=0; if(mode==='render')resetRender(); }
  function preset(which){ if(which==='brand'){ SCENE.wl=[0.08,0.55,0.66]; SCENE.wr=[0.07,0.11,0.42]; SCENE.ww=[0.74,0.78,0.82]; SCENE.light=17; SCENE.lsize=0.33; } else if(which==='classic'){ SCENE.wl=[0.62,0.06,0.05]; SCENE.wr=[0.07,0.45,0.11]; SCENE.ww=[0.73,0.73,0.73]; SCENE.light=18; SCENE.lsize=0.33; }
    else { SCENE.wl=[0.10,0.40,0.18]; SCENE.wr=[0.45,0.10,0.30]; SCENE.ww=[0.42,0.40,0.38]; SCENE.light=9; SCENE.lsize=0.26; }
    rebuildUI(); if(mode==='render')resetRender(); }
  function decorateScene(){ SCENE.spheres.forEach(function(o){ if(o.vis===undefined)o.vis=true; if(!o.kind)o.kind=(o.mat===5?'light':'geo'); if(!o.name)o.name=autoName(o.kind==='light'?'Omni':(SHNAME[o.shape]||'Object')); }); }

  function init(){
    resize();
    cpu=makeCPU(cpuCv);
    try{ gpu=makeGPU(glCv); }catch(e){ gpu=null; }
    applyRes();
    if(gpu && !gpu.ok()) gpu=null;
    if(resizeTO){ clearTimeout(resizeTO); resizeTO=null; }
    gpuAvail=!!gpu; if(!gpuAvail) backend='cpu';
    genTextSDF(TEXTSTR);
    if(!SCENE.spheres.some(function(o){return o.shape===8;})){ var logo={name:'[ davesgames.io ]',kind:'text',shape:8,mat:0,alb:[0.11,0.17,0.45],c:[0,0.38,0.32],r:0.14,rx:0,ry:0,rz:0,vis:true}; setObjMatrix(logo,eulerM(0,0,0)); SCENE.spheres.push(logo); }
    decorateScene(); buildCreate(); tab('modify'); rebuildUI(); paintBackend(); showCanvas(); resetRender();
    note(gpuAvail?'Path-traced render. Drag to orbit \u00b7 scroll / pinch to zoom. Add objects from the Create tab.':'GPU unavailable \u2014 Render uses CPU. Drag to orbit. Add objects from the Create tab.');
    raf=requestAnimationFrame(loop);
  }
  return { init:init, setMode:setMode, setBackend:setBackend, setGizmo:setGizmo, resetView:resetView, preset:preset, tab:tab };
})();

(async () => {
  VERT = await (await fetch(new URL('shaders/fullscreen.vert.glsl', document.baseURI))).text();
  TRACE = await (await fetch(new URL('shaders/tracer.frag.glsl', document.baseURI))).text();
  DISP = await (await fetch(new URL('shaders/display.frag.glsl', document.baseURI))).text();
  APP.init();
})().catch(showErr);
