// ============================================================================
//  SOLAR LIGHT STUDY  ·  where the sun sits over a site, all day, any date
// ----------------------------------------------------------------------------
//  Given a location, date and time, this computes the sun's position with a
//  standard solar-geometry model, then draws it three ways: a rectangular
//  theta/phi map, a polar sky dome, and a matched render frame. The frame grid
//  lets a 3D artist line up rendered stills with the real sun angle, and export
//  the angle map as JSON.
//
//  ANGLE CONVENTION
//  ---------------------------------------------------------------------------
//      alt   altitude above the horizon        (0 at horizon, 90 overhead)
//      az    compass azimuth of the sun        (0 = N, 90 = E, clockwise)
//      aA    azimuth + north offset nO         site-aligned azimuth = phi
//      th    theta = 90 - alt                  zenith angle (0 overhead)
//      ph    phi = aA                          the frame's horizontal angle
//      sh    shadow direction = (aA+180)%360
//
//  TWO PROJECTIONS OF THE SAME PATH
//  ---------------------------------------------------------------------------
//      theta/phi map (drawMap)          sky dome (drawSky, looking down)
//        phi 0 ────────────▶ 360             N
//      th 0 ┌──────────────────┐          W  ●  E     radius = 1 - alt/90
//           │   ·  sun path ·  │             S        angle  = aA
//           │ ·              ·  │        rings = altitude circles,
//      180  └──────────────────┘        center = straight overhead
//
//  DATA FLOW
//  ---------------------------------------------------------------------------
//      date + time + site ─▶ sol() ─▶ {alt,az,aA,th,ph,sh}
//                              │
//        dP() day path (every 2 min)   fRS() sunrise/sunset
//                              │
//      upd() ─▶ readouts + nearF() render frame + drawMap() + drawSky()
//      genFr() builds the theta/phi frame grid; loadF() attaches images to it
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  ---------------------------------------------------------------------------
//      constants ............ "const D="        deg/rad, device pixel ratio
//      state ................ "let sD="         date, view month, site, sweep
//      climate data ......... "const clHi="     monthly Santa Clara normals
//      time format .......... "function mt12"   minutes -> clock strings
//      day of year .......... "function doy"    date -> ordinal day
//      canvas setup ......... "function sC"     size a canvas to its box
//      solar position ....... "function sol"    the astronomy core
//      day path ............. "function dP"     sample the sun every 2 minutes
//      sunrise/sunset ....... "function fRS"    horizon crossings
//      frame grid ........... "function genFr"  build the theta/phi render grid
//      nearest frame ........ "function nearF"  closest frame to a sun angle
//      sparkline ............ "function drawSpark"  the little climate bars
//      climate update ....... "function updateClim" month readouts
//      solar events ......... "function updateSolEv" sunrise/noon/sunset list
//      main update .......... "function upd"    redraw everything for the time
//      theta/phi map ........ "function drawMap"    the rectangular projection
//      map click ............ "getElementById('mapC')"  click a time on the map
//      sky dome ............. "function drawSky"    the polar projection
//      calendar ............. "function rCal"   month grid + daylight bar
//      compass .............. "function dN"     the north-offset dial
//      controls ............. "getElementById('nSl')"  sliders, play, keys
//      image load ........... "function loadF"  attach rendered stills to frames
//      export ............... "getElementById('exportBtn')"  angle map JSON
//      boot ................. "genFr();rCal()"  first build and paint
// ============================================================================
// Degree/radian factors and the device pixel ratio for crisp canvas drawing.
const D=Math.PI/180,R=180/Math.PI,dp=window.devicePixelRatio||1;
// Live state: selected date, calendar view month, north offset, site lat/lon and
// UTC offset, and the theta/phi step sizes for the render sweep.
let sD=new Date(2025,5,21),vM=new Date(2025,5,1),nO=24,lat=37.403263,lon=-121.969688,utc=-7,tS=10,pS=10;
// Render frames (fr), loaded frame images by number (im), and playback state.
let fr=[],im={},pl=false,pT=null,pSp=1;
// Monthly climate normals for Santa Clara: high/low temperature (C), mean daily
// sunshine hours, and rainfall (mm), indexed 0..11 by month.
const clHi=[15,17,18,21,23,26,28,28,27,23,18,15],clLo=[5,7,8,9,11,13,14,14,13,10,7,5];
const clSH=[6.3,7.5,8.5,9.8,10.8,11.3,11.6,10.8,9.8,8.5,6.8,5.3],clRM=[65,60,50,25,8,2,0,0,3,15,35,65];
// Minutes since midnight to a 12-hour clock string.
function mt12(m){let h=Math.floor(m/60),n=Math.floor(m%60);const a=h>=12?'PM':'AM';h=h%12||12;return h+':'+String(n).padStart(2,'0')+' '+a}
// Minutes since midnight to a 24-hour HH:MM string.
function mt(m){return String(Math.floor(m/60)).padStart(2,'0')+':'+String(Math.floor(m%60)).padStart(2,'0')}
// Ordinal day of the year (1..366) for a date.
function doy(d){return Math.floor((d-new Date(d.getFullYear(),0,0))/864e5)}
// Size a canvas to its parent box at device resolution and return a scaled 2D
// context so drawing uses CSS pixels.
function sC(c){const r=c.parentElement.getBoundingClientRect();c.width=r.width*dp;c.height=r.height*dp;const x=c.getContext('2d');x.setTransform(dp,0,0,dp,0,0);return x}
// Solar geometry core: for a date and a minute of the day, compute the sun's
// altitude and azimuth from the site latitude/longitude and UTC offset, using
// the equation of time (E), declination (dc) and hour angle (H). Returns the
// derived frame angles (theta, phi, shadow) and a below-horizon flag.
function sol(date,min){const n=doy(date),B=(360/365)*(n-81)*D,E=9.87*Math.sin(2*B)-7.53*Math.cos(B)-1.5*Math.sin(B),dc=23.45*Math.sin((360/365)*(n+284)*D),dR=dc*D,LS=15*utc,TC=4*(lon-LS)+E,LST=min+TC,H=(LST/4)-180,lR=lat*D,sA=Math.sin(lR)*Math.sin(dR)+Math.cos(lR)*Math.cos(dR)*Math.cos(H*D),alt=Math.asin(Math.max(-1,Math.min(1,sA)))*R;let cA=(Math.sin(dR)-Math.sin(alt*D)*Math.sin(lR))/(Math.cos(alt*D)*Math.cos(lR));cA=Math.max(-1,Math.min(1,cA));let az=Math.acos(cA)*R;if(H>0)az=360-az;const aA=(az+nO)%360;return{alt,az,aA,th:90-alt,ph:aA,sh:(aA+180)%360,dc,LST,bel:alt<0}}
// Sample the whole day's sun path at 2-minute steps, tagging each sample with
// its minute. Feeds every path drawing.
function dP(d){const p=[];for(let m=0;m<=1440;m+=2){const s=sol(d,m);s.min=m;p.push(s)}return p}
// Find sunrise and sunset minutes by scanning for the altitude crossing zero.
function fRS(d){let r=null,s=null;for(let m=0;m<1440;m++){const a=sol(d,m).alt,b=sol(d,m+1).alt;if(a<=0&&b>0&&!r)r=m;if(a>0&&b<=0&&!s)s=m}return{r,s}}
// Build the render frame grid: sweep theta 0..180 and phi 0..360 by the step
// sizes, numbering frames and naming them NNNN.png. At the poles (theta 0 or
// 180) all phi values coincide, so only one frame is emitted there.
function genFr(){fr=[];let n=0;for(let t=0;t<=180.01;t+=tS){const po=t<.01||Math.abs(t-180)<.01;for(let p=0;p<359.99;p+=pS){fr.push({f:++n,fn:String(n).padStart(4,'0')+'.png',th:t,ph:p,tr:t*D,pr:p*D});if(po)break}}document.getElementById('cTot').textContent=fr.length}
// Nearest frame to a sun angle: minimize squared theta/phi distance, wrapping
// phi around 360 so 359 and 1 count as close.
function nearF(th,ph){if(!fr.length)return null;let b=1e9,i=0;fr.forEach((f,j)=>{const dt=f.th-th,dpR=f.ph-ph,dpW=Math.min(Math.abs(dpR),360-Math.abs(dpR));if(dt*dt+dpW*dpW<b){b=dt*dt+dpW*dpW;i=j}});return fr[i]}
// Draw a 12-bar climate sparkline into a canvas, highlighting the current month.
function drawSpark(id,data,color,mo){const cv=document.getElementById(id);const w=cv.parentElement.clientWidth;cv.width=w*dp;cv.height=28*dp;cv.style.width=w+'px';cv.style.height='28px';const x=cv.getContext('2d');x.setTransform(dp,0,0,dp,0,0);const mn=Math.min(...data),mx=Math.max(...data),bw=w/12;data.forEach((v,i)=>{const h=((v-mn)/(mx-mn||1))*22+4,y=28-h;x.fillStyle=i===mo?color:'rgba(0,0,0,.05)';x.beginPath();x.roundRect(i*bw+1,y,bw-2,h,[0,0,2,2]);x.fill();if(i===mo){x.fillStyle=color;x.beginPath();x.arc(i*bw+bw/2,y-2,2.5,0,Math.PI*2);x.fill()}})}
// Refresh the four climate cards and their sparklines for the selected month.
function updateClim(){const mo=sD.getMonth();document.getElementById('clHi').innerHTML=clHi[mo]+'°<span class="cunit"> C high</span>';document.getElementById('clLo').innerHTML=clLo[mo]+'°<span class="cunit"> C low</span>';document.getElementById('clSun').innerHTML=clSH[mo].toFixed(1)+'<span class="cunit"> hrs</span>';document.getElementById('clRn').innerHTML=clRM[mo]+'<span class="cunit"> mm</span>';drawSpark('cvHi',clHi,'#c8102e',mo);drawSpark('cvLo',clLo,'#4a90d9',mo);drawSpark('cvSun',clSH,'#d4a843',mo);drawSpark('cvRn',clRM,'#3d7a35',mo)}
// Build the solar-events list for the day: sunrise, solar noon (the path's peak
// altitude), sunset, golden-hour bounds, and total daylight, sorted by time.
function updateSolEv(){const path=dP(sD),rs=fRS(sD);let noon=720,maxA=-99;path.forEach(s=>{if(s.alt>maxA){maxA=s.alt;noon=s.min}});const ev=[];if(rs.r!==null)ev.push({t:rs.r,l:'Sunrise',v:sol(sD,rs.r).az.toFixed(1)+'° az'});ev.push({t:noon,l:'Solar Noon',v:maxA.toFixed(1)+'° alt'});if(rs.s!==null)ev.push({t:rs.s,l:'Sunset',v:sol(sD,rs.s).az.toFixed(1)+'° az'});if(rs.r!==null)ev.push({t:rs.r+60,l:'Golden Hr End',v:'morning'});if(rs.s!==null)ev.push({t:rs.s-60,l:'Golden Hr Start',v:'evening'});if(rs.r!==null&&rs.s!==null)ev.push({t:9999,l:'Total Daylight',v:((rs.s-rs.r)/60).toFixed(1)+' hrs'});ev.sort((a,b)=>a.t-b.t);document.getElementById('solEv').innerHTML=ev.map(e=>'<div class="sol-ev-item"><span class="sol-ev-time">'+(e.t<9999?mt12(e.t):'')+'</span><span class="sol-ev-label">'+e.l+'</span><span class="sol-ev-val">'+e.v+'</span></div>').join('')}
// The main refresh: read the time slider, compute the sun angle, update every
// numeric readout, show the matched render frame (or a placeholder), then redraw
// the theta/phi map and the sky dome.
function upd(){const m=parseInt(document.getElementById('tSl').value),c=sol(sD,m),nf=nearF(c.th,c.ph);document.getElementById('tT').textContent=mt12(m);document.getElementById('bA').textContent=c.alt.toFixed(1)+'°';document.getElementById('bAz').textContent=c.aA.toFixed(1)+'°';document.getElementById('bTh').textContent=c.th.toFixed(1)+'°';document.getElementById('bPh').textContent=c.ph.toFixed(1)+'°';const img=document.getElementById('hImg'),ph=document.getElementById('hPh');if(nf){document.getElementById('fBdg').textContent='Frame '+nf.f+' · '+nf.fn;document.getElementById('dFr').textContent=nf.f;document.getElementById('dFl').textContent=nf.fn;if(im[nf.f]){img.src=im[nf.f];img.style.display='block';ph.style.display='none'}else{img.style.display='none';ph.style.display='block';ph.innerHTML='<p>Frame '+nf.f+' — no image</p>'}}document.getElementById('dAl').textContent=c.alt.toFixed(1)+'°';document.getElementById('dAT').textContent=c.az.toFixed(1)+'°';document.getElementById('dAA').textContent=c.aA.toFixed(1)+'°';document.getElementById('dTh').textContent=c.th.toFixed(1)+'°';document.getElementById('dPh').textContent=c.ph.toFixed(1)+'°';document.getElementById('dSh').textContent=c.bel?'—':c.sh.toFixed(1)+'°';drawMap();drawSky()}
// Draw the rectangular theta/phi map: gridlines and axis labels, every render
// frame as a dot (loaded frames greener, the matched frame red), the day's sun
// path as a yellow curve with hour marks, and crosshairs at the current sun.
function drawMap(){const cv=document.getElementById('mapC'),W=cv.parentElement.clientWidth,H=Math.min(280,W*.42);cv.width=W*dp;cv.height=H*dp;cv.style.height=H+'px';const x=cv.getContext('2d');x.setTransform(dp,0,0,dp,0,0);const p={t:18,r:8,b:22,l:30},pw=W-p.l-p.r,ph=H-p.t-p.b,m=parseInt(document.getElementById('tSl').value),path=dP(sD),cur=sol(sD,m),nf=nearF(cur.th,cur.ph);x.fillStyle='rgba(250,250,250,.4)';x.fillRect(p.l,p.t,pw,ph);const hY=p.t+(90/180)*ph;x.fillStyle='rgba(61,122,53,.025)';x.fillRect(p.l,p.t,pw,hY-p.t);x.strokeStyle='rgba(61,122,53,.12)';x.lineWidth=1;x.setLineDash([4,4]);x.beginPath();x.moveTo(p.l,hY);x.lineTo(p.l+pw,hY);x.stroke();x.setLineDash([]);const fs=Math.max(6,W*.012);x.font=fs+'px "JetBrains Mono"';x.strokeStyle='rgba(200,16,46,.04)';x.lineWidth=.5;for(let t=0;t<=180;t+=30){const y=p.t+(t/180)*ph;x.beginPath();x.moveTo(p.l,y);x.lineTo(p.l+pw,y);x.stroke();x.fillStyle='rgba(0,0,0,.2)';x.textAlign='right';x.fillText(t+'°',p.l-3,y+3)}for(let pp=0;pp<=360;pp+=45){const xp=p.l+(pp/360)*pw;x.beginPath();x.moveTo(xp,p.t);x.lineTo(xp,p.t+ph);x.stroke();x.fillStyle='rgba(0,0,0,.2)';x.textAlign='center';x.fillText(pp+'°',xp,p.t+ph+10)}[{a:0,l:'N'},{a:90,l:'E'},{a:180,l:'S'},{a:270,l:'W'}].forEach(c=>{x.fillStyle=c.l==='N'?'rgba(200,16,46,.45)':'rgba(0,0,0,.15)';x.fillText(c.l,p.l+(c.a/360)*pw,p.t-3)});const dr=Math.max(1.5,pw/fr.length*.7);fr.forEach(f=>{const fx=p.l+(f.ph/360)*pw,fy=p.t+(f.th/180)*ph,hi=!!im[f.f],iN=nf&&f.f===nf.f;x.beginPath();x.arc(fx,fy,iN?Math.max(5,dr*3):(hi?Math.max(2.5,dr*1.2):dr),0,Math.PI*2);if(iN){x.fillStyle='rgba(200,16,46,.9)';x.shadowColor='rgba(200,16,46,.3)';x.shadowBlur=5}else if(hi){x.fillStyle='rgba(61,122,53,.45)';x.shadowBlur=0}else{x.fillStyle='rgba(0,0,0,.08)';x.shadowBlur=0}x.fill();x.shadowBlur=0});x.beginPath();let st=false,pvX=null;path.forEach(sp=>{if(sp.th>180||sp.th<0){st=false;return}const sx=p.l+(sp.ph/360)*pw,sy=p.t+(sp.th/180)*ph;if(pvX!==null&&Math.abs(sx-pvX)>pw*.4)st=false;if(!st){x.moveTo(sx,sy);st=true}else x.lineTo(sx,sy);pvX=sx});x.strokeStyle='rgba(245,200,66,.6)';x.lineWidth=2.5;x.stroke();path.forEach(sp=>{if(sp.th>90||sp.min%60!==0)return;const sx=p.l+(sp.ph/360)*pw,sy=p.t+(sp.th/180)*ph;x.beginPath();x.arc(sx,sy,2,0,Math.PI*2);x.fillStyle='rgba(212,168,67,.5)';x.fill();if(pw>350){x.fillStyle='rgba(0,0,0,.2)';x.font=Math.max(5,fs*.75)+'px "JetBrains Mono"';x.textAlign='center';x.fillText(mt(sp.min),sx,sy-5)}});if(cur.th>=0&&cur.th<=180){const sx=p.l+(cur.ph/360)*pw,sy=p.t+(cur.th/180)*ph;x.strokeStyle='rgba(245,200,66,.2)';x.lineWidth=1;x.setLineDash([3,3]);x.beginPath();x.moveTo(sx,p.t);x.lineTo(sx,p.t+ph);x.stroke();x.beginPath();x.moveTo(p.l,sy);x.lineTo(p.l+pw,sy);x.stroke();x.setLineDash([]);if(nf){const nx=p.l+(nf.ph/360)*pw,ny=p.t+(nf.th/180)*ph;x.beginPath();x.moveTo(sx,sy);x.lineTo(nx,ny);x.strokeStyle='rgba(200,16,46,.25)';x.lineWidth=1;x.setLineDash([2,2]);x.stroke();x.setLineDash([])}x.beginPath();x.arc(sx,sy,cur.bel?4:7,0,Math.PI*2);x.fillStyle=cur.bel?'rgba(200,16,46,.3)':'#f5c842';if(!cur.bel){x.shadowColor='rgba(245,200,66,.4)';x.shadowBlur=8}x.fill();x.shadowBlur=0;if(!cur.bel){x.beginPath();x.arc(sx,sy,3,0,Math.PI*2);x.fillStyle='#fff';x.fill()}}}
// Click the map to jump to a time: convert the click to theta/phi, find the
// day-path sample nearest that point, and set the time slider to its minute.
document.getElementById('mapC').addEventListener('click',function(e){const rc=this.getBoundingClientRect(),W=rc.width,H=rc.height,p={t:18,r:8,b:22,l:30},pw=W-p.l-p.r,ph=H-p.t-p.b,cP=((e.clientX-rc.left-p.l)/pw)*360,cT=((e.clientY-rc.top-p.t)/ph)*180,path=dP(sD);let b=1e9,bm=720;path.forEach(sp=>{const dt=sp.th-cT,dr=sp.ph-cP,dw=Math.min(Math.abs(dr),360-Math.abs(dr));if(dt*dt+dw*dw<b){b=dt*dt+dw*dw;bm=sp.min}});document.getElementById('tSl').value=bm;upd()});
// Draw the polar sky dome (a fisheye looking straight up): altitude rings and
// compass spokes offset by nO, the day's path where the sun is up, hour marks,
// and the current sun with its shadow spoke and a soft glow.
function drawSky(){const cv=document.getElementById('skyC');if(!cv.parentElement.clientWidth)return;const x=sC(cv),w=cv.width/dp,h=cv.height/dp,cx=w/2,cy=h/2,RR=Math.min(w,h)*.4,m=parseInt(document.getElementById('tSl').value),path=dP(sD),cur=sol(sD,m);for(let a=0;a<=90;a+=15){const r=(1-a/90)*RR;x.beginPath();x.arc(cx,cy,r,0,Math.PI*2);x.strokeStyle='rgba(200,16,46,.05)';x.lineWidth=.5;x.stroke();if(a>0&&a<90){x.fillStyle='rgba(0,0,0,.18)';x.font='7px "JetBrains Mono"';x.textAlign='left';x.fillText(a+'°',cx+2,cy-r+9)}}[{a:0,l:'N'},{a:90,l:'E'},{a:180,l:'S'},{a:270,l:'W'}].forEach(d=>{const adj=d.a+nO,ar=(adj-90)*D;x.beginPath();x.moveTo(cx,cy);x.lineTo(cx+Math.cos(ar)*RR,cy+Math.sin(ar)*RR);x.strokeStyle=d.l==='N'?'rgba(200,16,46,.18)':'rgba(200,16,46,.04)';x.lineWidth=d.l==='N'?1.5:.5;x.stroke();x.fillStyle=d.l==='N'?'rgba(200,16,46,.6)':'rgba(0,0,0,.25)';x.font=d.l==='N'?'bold 9px "JetBrains Mono"':'8px "JetBrains Mono"';x.textAlign='center';x.textBaseline='middle';x.fillText(d.l,cx+Math.cos(ar)*(RR+11),cy+Math.sin(ar)*(RR+11))});x.beginPath();x.arc(cx,cy,RR,0,Math.PI*2);x.strokeStyle='rgba(212,168,67,.2)';x.lineWidth=1.5;x.stroke();x.beginPath();let st=false;path.forEach(sp=>{if(sp.alt<-1){st=false;return}const alt=Math.max(0,sp.alt),r=(1-alt/90)*RR,ar=(sp.aA-90)*D,px=cx+Math.cos(ar)*r,py=cy+Math.sin(ar)*r;if(!st){x.moveTo(px,py);st=true}else x.lineTo(px,py)});x.strokeStyle='rgba(245,200,66,.45)';x.lineWidth=2;x.stroke();path.forEach(sp=>{if(sp.alt<0||sp.min%60!==0)return;const r=(1-sp.alt/90)*RR,ar=(sp.aA-90)*D,px=cx+Math.cos(ar)*r,py=cy+Math.sin(ar)*r;x.beginPath();x.arc(px,py,2,0,Math.PI*2);x.fillStyle='rgba(212,168,67,.45)';x.fill();x.fillStyle='rgba(0,0,0,.25)';x.font='6px "JetBrains Mono"';x.textAlign='center';x.fillText(mt(sp.min),px,py-5)});if(cur.alt>=-2){const alt=Math.max(0,cur.alt),r=(1-alt/90)*RR,ar=(cur.aA-90)*D,px=cx+Math.cos(ar)*r,py=cy+Math.sin(ar)*r;if(!cur.bel){const sa=((cur.sh+nO)-90)*D;x.beginPath();x.moveTo(cx,cy);x.lineTo(cx+Math.cos(sa)*RR*.45,cy+Math.sin(sa)*RR*.45);x.strokeStyle='rgba(0,0,0,.06)';x.lineWidth=4;x.lineCap='round';x.stroke();x.lineCap='butt';const gl=x.createRadialGradient(px,py,0,px,py,16);gl.addColorStop(0,'rgba(245,200,66,.35)');gl.addColorStop(1,'transparent');x.fillStyle=gl;x.fillRect(px-16,py-16,32,32)}x.beginPath();x.arc(px,py,cur.bel?3:6,0,Math.PI*2);x.fillStyle=cur.bel?'rgba(200,16,46,.3)':'#f5c842';if(!cur.bel){x.shadowColor='rgba(245,200,66,.35)';x.shadowBlur=6}x.fill();x.shadowBlur=0;if(!cur.bel){x.beginPath();x.arc(px,py,2.5,0,Math.PI*2);x.fillStyle='#fff';x.fill()}}}
// Month names for the calendar header.
const moN=['January','February','March','April','May','June','July','August','September','October','November','December'];
// Render the calendar grid for the view month: day cells (marking selected and
// today), click-to-select handlers, and the daylight bar for the selected date.
function rCal(){document.getElementById('calT').textContent=moN[vM.getMonth()]+' '+vM.getFullYear();const g=document.getElementById('calG');let h='';['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(d=>h+='<div class="chd">'+d+'</div>');const f=new Date(vM.getFullYear(),vM.getMonth(),1),l=new Date(vM.getFullYear(),vM.getMonth()+1,0);for(let i=0;i<f.getDay();i++)h+='<div class="cd mt"></div>';const td=new Date();for(let d=1;d<=l.getDate();d++){const dt=new Date(vM.getFullYear(),vM.getMonth(),d);let c='cd';if(dt.toDateString()===sD.toDateString())c+=' sl';if(dt.toDateString()===td.toDateString())c+=' td';h+='<div class="'+c+'" data-d="'+d+'">'+d+'</div>'}g.innerHTML=h;g.querySelectorAll('.cd:not(.mt)').forEach(el=>el.addEventListener('click',()=>{sD=new Date(vM.getFullYear(),vM.getMonth(),parseInt(el.dataset.d));rCal();updateClim();updateSolEv();upd()}));const rs=fRS(sD);if(rs.r!==null&&rs.s!==null){document.getElementById('dlF').style.left=(rs.r/1440*100)+'%';document.getElementById('dlF').style.width=((rs.s-rs.r)/1440*100)+'%';document.getElementById('dlR').textContent='↑'+mt12(rs.r);document.getElementById('dlS').textContent=mt12(rs.s)+'↓';document.getElementById('dlH').textContent=((rs.s-rs.r)/60).toFixed(1)+' hrs daylight'}else{document.getElementById('dlF').style.width='0';document.getElementById('dlH').textContent='—'}}
// Previous/next month buttons step the calendar view.
document.getElementById('calP').addEventListener('click',()=>{vM=new Date(vM.getFullYear(),vM.getMonth()-1,1);rCal()});
document.getElementById('calN').addEventListener('click',()=>{vM=new Date(vM.getFullYear(),vM.getMonth()+1,1);rCal()});
// Preset epoch chips (solstices/equinoxes) jump to a fixed date.
document.querySelectorAll('.ep').forEach(el=>el.addEventListener('click',()=>{const p=el.dataset.d.split('-');sD=new Date(+p[0],+p[1]-1,+p[2]);vM=new Date(sD.getFullYear(),sD.getMonth(),1);rCal();updateClim();updateSolEv();upd()}));
// The small north-offset compass dial.
const nCv=document.getElementById('nC'),nx=nCv.getContext('2d');
// Draw the compass: tick ring plus a red needle pointing at the north offset nO,
// so the user sees how the site is rotated from true north.
function dN(){const w=64,cx=32,cy=32,RR=25;nx.setTransform(2,0,0,2,0,0);nx.clearRect(0,0,w,w);nx.beginPath();nx.arc(cx,cy,RR,0,Math.PI*2);nx.strokeStyle='rgba(200,16,46,.12)';nx.lineWidth=1.5;nx.stroke();for(let a=0;a<360;a+=15){const mj=a%90===0,r1=RR-(mj?6:2.5),ar=(a-90)*D;nx.beginPath();nx.moveTo(cx+Math.cos(ar)*r1,cy+Math.sin(ar)*r1);nx.lineTo(cx+Math.cos(ar)*RR,cy+Math.sin(ar)*RR);nx.strokeStyle=mj?'rgba(200,16,46,.25)':'rgba(200,16,46,.07)';nx.lineWidth=mj?1.2:.5;nx.stroke()}const na=(nO-90)*D;nx.beginPath();nx.moveTo(cx+Math.cos(na)*RR*.82,cy+Math.sin(na)*RR*.82);nx.lineTo(cx+Math.cos(na+.2)*RR*.28,cy+Math.sin(na+.2)*RR*.28);nx.lineTo(cx+Math.cos(na-.2)*RR*.28,cy+Math.sin(na-.2)*RR*.28);nx.closePath();nx.fillStyle='#c8102e';nx.fill();nx.fillStyle='#c8102e';nx.font='bold 7px "JetBrains Mono"';nx.textAlign='center';nx.textBaseline='middle';nx.fillText('N',cx+Math.cos(na)*(RR+7),cy+Math.sin(na)*(RR+7))}
// North-offset slider re-rotates the compass and every azimuth-based drawing.
document.getElementById('nSl').addEventListener('input',function(){nO=parseInt(this.value);document.getElementById('nV').textContent=nO+'°';dN();upd()});
// Time slider and the minus/plus 5-minute nudge buttons.
document.getElementById('tSl').addEventListener('input',upd);
document.getElementById('tPr').addEventListener('click',()=>{const s=document.getElementById('tSl');s.value=Math.max(0,+s.value-5);upd()});
document.getElementById('tNx').addEventListener('click',()=>{const s=document.getElementById('tSl');s.value=Math.min(1440,+s.value+5);upd()});
// Play/pause: advance the time slider on an interval, wrapping past midnight.
document.getElementById('tPl').addEventListener('click',function(){pl=!pl;this.textContent=pl?'⏸':'▶';this.classList.toggle('on',pl);if(pl){const s=document.getElementById('tSl');pT=setInterval(()=>{let v=+s.value+pSp*2;if(v>1440)v=0;s.value=v;upd()},25)}else clearInterval(pT)});
// Speed button cycles the playback multiplier 1x, 2x, 4x, 8x.
document.getElementById('tSp').addEventListener('click',function(){const sp=[1,2,4,8];pSp=sp[(sp.indexOf(pSp)+1)%sp.length];this.textContent=pSp+'×'});
// Keyboard: arrows nudge the time, space toggles play.
document.addEventListener('keydown',e=>{const s=document.getElementById('tSl');if(e.key==='ArrowLeft'){e.preventDefault();s.value=Math.max(0,+s.value-5);upd()}if(e.key==='ArrowRight'){e.preventDefault();s.value=Math.min(1440,+s.value+5);upd()}if(e.key===' '){e.preventDefault();document.getElementById('tPl').click()}});
// Touch scrub: dragging across the hero area moves the time slider.
let tX=null;const ha=document.getElementById('heroArea');
ha.addEventListener('touchstart',e=>{tX=e.touches[0].clientX},{passive:true});
ha.addEventListener('touchmove',e=>{if(tX===null)return;const dx=e.touches[0].clientX-tX;const s=document.getElementById('tSl');s.value=Math.max(0,Math.min(1440,+s.value+Math.round(dx*.5)));tX=e.touches[0].clientX;upd()},{passive:true});
ha.addEventListener('touchend',()=>{tX=null},{passive:true});
// Site config inputs (lat, lon, UTC) recompute all solar geometry.
['cLat','cLon','cUTC'].forEach(id=>document.getElementById(id).addEventListener('change',()=>{lat=+document.getElementById('cLat').value;lon=+document.getElementById('cLon').value;utc=+document.getElementById('cUTC').value;rCal();updateClim();updateSolEv();upd()}));
// Sweep step inputs rebuild the render frame grid.
['cTS','cPS'].forEach(id=>document.getElementById(id).addEventListener('change',()=>{tS=+document.getElementById('cTS').value||10;pS=+document.getElementById('cPS').value||10;genFr();upd()}));
// Attach loaded still images to frames by number: match NNNN.png exactly, or the
// last number in any filename, keeping only numbers within the frame range.
function loadF(list){const files=Array.from(list).filter(f=>f.type.startsWith('image/'));let n=0;files.forEach(f=>{const m=f.name.match(/^(\d+)\.\w+$/);if(m){const v=parseInt(m[1]);if(v>=1&&v<=fr.length){im[v]=URL.createObjectURL(f);n++}}else{const nums=f.name.match(/(\d+)/g);if(nums){const v=parseInt(nums[nums.length-1]);if(v>=1&&v<=fr.length){im[v]=URL.createObjectURL(f);n++}}}});document.getElementById('cLd').textContent=n;upd()}
// Directory picker feeds its files to loadF.
document.getElementById('fileIn').addEventListener('change',e=>loadF(e.target.files));
// Export the angle map: config plus every frame's theta/phi and image state, as
// a downloaded angle_map.json for the render pipeline to consume.
document.getElementById('exportBtn').addEventListener('click',()=>{const o={config:{theta_step:tS,phi_step:pS,total:fr.length,lat,lon,utc_offset:utc,north_offset:nO},frames:fr.map(f=>({frame:f.f,filename:f.fn,theta:f.th,phi:f.ph,has_image:!!im[f.f]}))};const b=new Blob([JSON.stringify(o,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='angle_map.json';a.click()});
// Redraw on resize.
window.addEventListener('resize',()=>{upd();updateClim()});
// Boot: build the frame grid, calendar, compass and climate, then paint the sun
// after a short delay so the layout has settled and canvases have real sizes.
genFr();rCal();dN();updateClim();updateSolEv();setTimeout(upd,80);
