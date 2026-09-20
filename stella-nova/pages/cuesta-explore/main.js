/* ═══════════════════════════════════════════════════════════════════════════
   CUESTA PARK SEARCH  ·  runtime
   ───────────────────────────────────────────────────────────────────────────
   This file drives a ground-search map for the Cuesta Park area in Mountain
   View. The map shows two things. A grid of search sectors covers the area, and
   each sector fills with a color for its status. Pins mark relevant places. A
   tap moves a sector or a pin forward: not searched, searching, searched.

   The page needs no server. main.js keeps the state in localStorage and in the
   URL hash. A person shares the link, and the reader MERGES the higher status
   per sector and per pin. The merge never lowers what someone marked.

   STATE SHAPE
     STATE.sectors[i]  status 0..2 for grid cell i, row major
     STATE.pinS[i]     status 0..2 for SEED_PINS[i]
     STATE.custom[]    { name, lat, lng, s }   pins added in the field
     STATE.updated     last change time, epoch ms

   HASH FORMAT
     cs1.<sectorDigits>.<pinDigits>.<b64custom>
       sectorDigits  one char 0..2 per grid cell, row major
       pinDigits     one char 0..2 per SEED_PINS entry
       b64custom     URL-safe base64 of JSON [[name,lat,lng,s], ...]

   GREP MAP  (jump with grep -n "<token>" main.js)
     grid config .... 'const GRID'
     seed pins ...... 'const SEED_PINS'
     load/save ...... 'function load'  'function save'
     hash merge ..... 'function mergeHash'  'function encodeHash'
     map build ...... 'function buildMap'
     sectors ........ 'function drawSectors'  'function cycleSector'
     pins ........... 'function drawPins'  'function pinMarker'
     add pin ........ 'function toggleAdd'  'function placePin'
     share .......... 'function openShare'  'function doShare'
   ═══════════════════════════════════════════════════════════════════════════ */

/* Search grid over the neighborhood. Columns run west to east (A..), rows run
   north to south (1..). Change cols or rows to make the sectors larger. */
const GRID = { south:37.3520, west:-122.0910, north:37.3790, east:-122.0690, cols:5, rows:6 };

/* Seed pins. Source: OpenStreetMap places in and around the Cuesta Park box.
   Each pin is a relevant search location: a park, the creek, a school, a
   gathering place, or a landmark. Add more in the field. */
const SEED_PINS = [
  { name:"Cuesta Park",                 lat:37.37225, lng:-122.08147, kind:"Park" },
  { name:"Cuesta Park Annex",           lat:37.37336, lng:-122.08254, kind:"Open space" },
  { name:"Varsity Park",                lat:37.37506, lng:-122.08958, kind:"Park" },
  { name:"Cooper Park",                 lat:37.36821, lng:-122.07302, kind:"Park" },
  { name:"Sleeper Park",                lat:37.37142, lng:-122.06808, kind:"Park" },
  { name:"Heritage Oaks Park",          lat:37.35899, lng:-122.08670, kind:"Park" },
  { name:"Marymeade Park",              lat:37.35275, lng:-122.07960, kind:"Park" },
  { name:"Bubb Park",                   lat:37.37805, lng:-122.08353, kind:"Park" },
  { name:"El Camino Hospital",          lat:37.36861, lng:-122.08105, kind:"Hospital" },
  { name:"El Camino Branch YMCA",       lat:37.37055, lng:-122.07909, kind:"Gathering" },
  { name:"Blach Intermediate School",   lat:37.36388, lng:-122.08171, kind:"School" },
  { name:"Miramonte Christian School",  lat:37.36139, lng:-122.08102, kind:"School" },
  { name:"St. Francis High School",     lat:37.36881, lng:-122.08480, kind:"School" },
  { name:"Bubb Elementary School",      lat:37.37819, lng:-122.08183, kind:"School" },
  { name:"Amy Imai Elementary School",  lat:37.37449, lng:-122.07506, kind:"School" },
  { name:"Oak Avenue Elementary",       lat:37.35795, lng:-122.07145, kind:"School" },
  { name:"Permanente Creek — north",    lat:37.37407, lng:-122.08699, kind:"Creek" },
  { name:"Permanente Creek — mid",      lat:37.36924, lng:-122.08583, kind:"Creek" },
  { name:"Permanente Creek — south",    lat:37.36391, lng:-122.08575, kind:"Creek" },
  { name:"Safeway (Cuesta / Miramonte)",lat:37.37234, lng:-122.08844, kind:"Gathering" },
  { name:"St. Timothy Episcopal Church",lat:37.37278, lng:-122.07857, kind:"Gathering" },
  { name:"First Presbyterian Church",   lat:37.37436, lng:-122.08620, kind:"Gathering" }
];

const KEY = 'cuesta-search-v1';
const TAGS = ['Not searched','Searching','Searched'];
const NCELL = GRID.cols * GRID.rows;
let STATE = { sectors:[], pinS:[], custom:[], updated:0 };
let map=null, sectorLayers=[], pinMarkers=[], labelLayers=[], addMode=false;

/* ---------- storage ---------- */
function zeros(n){ const a=[]; for(let i=0;i<n;i++) a.push(0); return a; }
function clampS(v){ v=v|0; return v<0?0:(v>2?2:v); }

function load(){
  try{ const raw=localStorage.getItem(KEY); if(raw) STATE=JSON.parse(raw); }catch(e){}
  if(!Array.isArray(STATE.sectors)) STATE.sectors=zeros(NCELL);
  if(!Array.isArray(STATE.pinS))    STATE.pinS=zeros(SEED_PINS.length);
  if(!Array.isArray(STATE.custom))  STATE.custom=[];
  STATE.sectors = fit(STATE.sectors, NCELL);
  STATE.pinS    = fit(STATE.pinS, SEED_PINS.length);
  STATE.custom  = STATE.custom.filter(function(c){ return c && c.name; }).map(function(c){
    return { name:String(c.name), lat:+c.lat, lng:+c.lng, s:clampS(c.s) }; });
}
function fit(arr,n){ const out=zeros(n); for(let i=0;i<n&&i<arr.length;i++) out[i]=clampS(arr[i]); return out; }
function save(){
  STATE.updated=Date.now();
  try{ localStorage.setItem(KEY, JSON.stringify(STATE)); }catch(e){}
  encodeHash();
}

/* ---------- hash encode and merge ---------- */
function encodeHash(){
  const sd = STATE.sectors.map(clampS).join('');
  const pd = STATE.pinS.map(clampS).join('');
  let b64='';
  if(STATE.custom.length){
    const pairs = STATE.custom.map(function(c){ return [c.name, round5(c.lat), round5(c.lng), clampS(c.s)]; });
    try{ b64 = btoa(unescape(encodeURIComponent(JSON.stringify(pairs))))
      .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }catch(e){}
  }
  const h = 'cs1.'+sd+'.'+pd+'.'+b64;
  try{ history.replaceState(null,'','#'+h); }catch(e){ location.hash=h; }
}
function round5(v){ return Math.round((+v)*1e5)/1e5; }
function mergeHash(){
  const h=(location.hash||'').replace(/^#/,'');
  if(h.indexOf('cs1.')!==0) return false;
  const p=h.split('.');
  raise(STATE.sectors, p[1]||'');
  raise(STATE.pinS, p[2]||'');
  const b64=p[3]||'';
  if(b64){
    try{
      const json=decodeURIComponent(escape(atob(b64.replace(/-/g,'+').replace(/_/g,'/'))));
      JSON.parse(json).forEach(function(a){
        const name=String(a[0]), lat=+a[1], lng=+a[2], s=clampS(a[3]);
        const hit=STATE.custom.find(function(c){
          return c.name.toLowerCase()===name.toLowerCase()
            && Math.abs(c.lat-lat)<1e-4 && Math.abs(c.lng-lng)<1e-4; });
        if(hit){ if(s>hit.s) hit.s=s; }
        else STATE.custom.push({ name:name, lat:lat, lng:lng, s:s });
      });
    }catch(e){}
  }
  return true;
}
function raise(arr,digits){ for(let i=0;i<arr.length&&i<digits.length;i++){
  const v=clampS(parseInt(digits[i],10)||0); if(v>arr[i]) arr[i]=v; } }

/* ---------- view model helpers ---------- */
function cellBounds(i){
  const col=i%GRID.cols, row=(i/GRID.cols)|0;
  const dLat=(GRID.north-GRID.south)/GRID.rows, dLng=(GRID.east-GRID.west)/GRID.cols;
  const n=GRID.north-row*dLat, s=n-dLat;
  const w=GRID.west+col*dLng, e=w+dLng;
  return [[s,w],[n,e]];
}
function cellLabel(i){ const col=i%GRID.cols, row=(i/GRID.cols)|0;
  return String.fromCharCode(65+col)+(row+1); }
function allPins(){
  const out=[];
  SEED_PINS.forEach(function(p,i){ out.push({ id:'p'+i, name:p.name, kind:p.kind, lat:p.lat, lng:p.lng, s:STATE.pinS[i], seed:true }); });
  STATE.custom.forEach(function(c,i){ out.push({ id:'u'+i, name:c.name, kind:'Added', lat:c.lat, lng:c.lng, s:c.s, seed:false }); });
  return out;
}
function pinStatus(id){ return id[0]==='p'? STATE.pinS[+id.slice(1)] : (STATE.custom[+id.slice(1)]||{}).s||0; }
function setPin(id,s){ s=clampS(s); if(id[0]==='p') STATE.pinS[+id.slice(1)]=s; else{ const c=STATE.custom[+id.slice(1)]; if(c) c.s=s; } }

/* ---------- map build ---------- */
function buildMap(){
  map = L.map('map',{ zoomControl:true, attributionControl:true, tap:true })
        .fitBounds([[GRID.south,GRID.west],[GRID.north,GRID.east]]);
  // Carto Voyager: a bright, Google-style street basemap. No API key needed.
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',{
    subdomains:'abcd', maxZoom:20,
    attribution:'&copy; OpenStreetMap contributors &copy; CARTO'
  }).addTo(map);
  drawSectors();
  drawPins();
  // A tap on empty map in add mode drops a pin.
  map.on('click', function(e){ if(addMode) placePin(e.latlng); });
  setTimeout(function(){ map.invalidateSize(); }, 60);
}
const SFILL = ['#ff5a5a','#ffc832','#64c864'];
function sectorStyle(s){ return { color:SFILL[s], weight:1.2, opacity:0.85,
  fillColor:SFILL[s], fillOpacity:[0.22,0.30,0.42][s] }; }
function drawSectors(){
  for(let i=0;i<NCELL;i++){
    const rect=L.rectangle(cellBounds(i), sectorStyle(STATE.sectors[i])).addTo(map);
    rect.on('click', (function(idx){ return function(e){
      if(addMode){ placePin(e.latlng); return; }
      cycleSector(idx);
    }; })(i));
    sectorLayers.push(rect);
    const c=rect.getBounds().getCenter();
    const lab=L.marker(c,{ interactive:false, icon:L.divIcon({ className:'', html:'<div class="slab">'+cellLabel(i)+'</div>', iconSize:[24,12], iconAnchor:[12,6] }) }).addTo(map);
    labelLayers.push(lab);
  }
}
function cycleSector(i){
  STATE.sectors[i]=(STATE.sectors[i]+1)%3;
  sectorLayers[i].setStyle(sectorStyle(STATE.sectors[i]));
  save(); updateProgress();
}

/* ---------- pins ---------- */
function pinIcon(s,big){ return L.divIcon({ className:'',
  html:'<div class="pin s'+s+(big?' big':'')+'">'+(s===2?'✓':(s===1?'…':''))+'</div>',
  iconSize:[22,22], iconAnchor:[11,11] }); }
function drawPins(){
  pinMarkers.forEach(function(m){ map.removeLayer(m); }); pinMarkers=[];
  allPins().forEach(function(p){
    const m=L.marker([p.lat,p.lng],{ icon:pinIcon(p.s) }).addTo(map);
    m.on('click', function(){ openPin(p.id); });
    pinMarkers.push(m);
  });
}
function refreshPins(){ drawPins(); }

/* ---------- progress ---------- */
function counts(arr){ let done=0,doing=0; arr.forEach(function(s){ if(s===2)done++; else if(s===1)doing++; });
  return { done:done, doing:doing, total:arr.length }; }
function updateProgress(){
  const sc=counts(STATE.sectors);
  const pc=counts(STATE.pinS.concat(STATE.custom.map(function(c){return c.s;})));
  document.getElementById('count').innerHTML =
    '<b class="g">'+sc.done+'</b>/'+sc.total+' sectors<br><span>'+pc.done+'/'+pc.total+' pins</span>';
  const pct = sc.total? Math.round(((sc.done+sc.doing*0.5)/sc.total)*100):0;
  document.getElementById('barFill').style.width=pct+'%';
}

/* ---------- pin sheet ---------- */
function openPin(id){
  const p=allPins().find(function(x){ return x.id===id; }); if(!p) return;
  const custom=id[0]==='u';
  sheet('<h3>'+esc(p.name)+'</h3><div class="kind">'+esc(p.kind||'')+'</div>'
    + '<div class="sheet-row" style="margin-bottom:12px">'
      + statusBtn(0,p.s)+statusBtn(1,p.s)+statusBtn(2,p.s)+'</div>'
    + (custom?'<input class="field" id="p-name" value="'+esc(p.name)+'">':'')
    + '<div class="sheet-row">'
      + '<button class="btn" data-close>Close</button>'
      + '<button class="btn" id="p-center">Center map</button>'
      + (custom?'<button class="btn" id="p-del"><span class="danger">Remove</span></button>':'')
      + (custom?'<button class="btn primary" id="p-save">Save name</button>':'')
    + '</div>');
  document.querySelectorAll('.sheet .st-btn').forEach(function(b){
    b.onclick=function(){ setPin(id,+b.dataset.s); save(); refreshPins(); updateProgress(); closeSheet(); }; });
  document.getElementById('p-center').onclick=function(){ map.setView([p.lat,p.lng],17); closeSheet(); };
  const del=document.getElementById('p-del');
  if(del) del.onclick=function(){ STATE.custom.splice(+id.slice(1),1); save(); refreshPins(); updateProgress(); closeSheet(); };
  const sv=document.getElementById('p-save');
  if(sv) sv.onclick=function(){ const v=document.getElementById('p-name').value.trim(); if(v){ STATE.custom[+id.slice(1)].name=v; save(); refreshPins(); } closeSheet(); };
}
function statusBtn(s,cur){ return '<button class="btn st-btn'+(s===cur?' on':'')+'" data-s="'+s+'">'+TAGS[s]+'</button>'; }

/* ---------- add pin ---------- */
function toggleAdd(){
  addMode=!addMode;
  document.getElementById('app').classList.toggle('adding',addMode);
  document.getElementById('addbar').classList.toggle('on',addMode);
  document.getElementById('addBtn').textContent = addMode? 'Tap map' : '+ Pin';
}
function placePin(latlng){
  const lat=round5(latlng.lat), lng=round5(latlng.lng);
  sheet('<h3>New pin</h3><p>Name this location. It joins the shared link.</p>'
    + '<input class="field" id="np-name" placeholder="Location name" autocomplete="off">'
    + '<div class="sheet-row"><button class="btn" data-close>Cancel</button>'
    + '<button class="btn primary" id="np-ok">Add pin</button></div>');
  const inp=document.getElementById('np-name'); inp.focus();
  document.getElementById('np-ok').onclick=function(){
    const name=inp.value.trim()||('Pin '+(STATE.custom.length+1));
    STATE.custom.push({ name:name, lat:lat, lng:lng, s:0 });
    save(); refreshPins(); updateProgress(); closeSheet(); toast('Pin added');
  };
  inp.onkeydown=function(e){ if(e.key==='Enter') document.getElementById('np-ok').click(); };
  if(addMode) toggleAdd();
}

/* ---------- share ---------- */
function openShare(){
  const url=shareLink();
  sheet('<h3>Share progress</h3>'
    + '<p>Send this link to the team. When they open it, their map takes the higher'
    + ' status per sector and pin. It never lowers what someone marked.</p>'
    + '<div class="link-box">'+esc(url)+'</div><div class="sheet-row">'
    + (navigator.share?'<button class="btn primary" id="sh-send">Share</button>':'')
    + '<button class="btn'+(navigator.share?'':' primary')+'" id="sh-copy">Copy link</button>'
    + '<button class="btn" data-close>Done</button></div>');
  const s=document.getElementById('sh-send'); if(s) s.onclick=doShare;
  document.getElementById('sh-copy').onclick=function(){ copy(url); };
}
function shareLink(){ return location.origin+location.pathname+location.hash; }
function doShare(){ navigator.share({ title:'Cuesta Park Search', text:'Search coverage map', url:shareLink() }).catch(function(){}); }
function copy(t){
  if(navigator.clipboard&&navigator.clipboard.writeText)
    navigator.clipboard.writeText(t).then(function(){ toast('Link copied'); },function(){ fallbackCopy(t); });
  else fallbackCopy(t);
}
function fallbackCopy(t){ const a=document.createElement('textarea'); a.value=t; a.style.position='fixed'; a.style.opacity='0';
  document.body.appendChild(a); a.select(); try{ document.execCommand('copy'); toast('Link copied'); }catch(e){ toast('Copy failed'); } document.body.removeChild(a); }

/* ---------- reset ---------- */
function openReset(){
  sheet('<h3>Reset this device</h3><p>Set every sector and pin back to "not searched" on'
    + ' this device. It does not change other people. This cannot be undone.</p>'
    + '<div class="sheet-row"><button class="btn" data-close>Cancel</button>'
    + '<button class="btn" id="rs-ok"><span class="danger">Reset all</span></button></div>');
  document.getElementById('rs-ok').onclick=function(){
    STATE.sectors=zeros(NCELL); STATE.pinS=zeros(SEED_PINS.length); STATE.custom.forEach(function(c){ c.s=0; });
    sectorLayers.forEach(function(r,i){ r.setStyle(sectorStyle(0)); });
    save(); refreshPins(); updateProgress(); closeSheet(); toast('Reset');
  };
}

/* ---------- sheet + toast ---------- */
function sheet(html){ document.getElementById('sheet').innerHTML=html;
  document.getElementById('sheet').classList.add('open'); document.getElementById('scrim').classList.add('open'); }
function closeSheet(){ document.getElementById('sheet').classList.remove('open'); document.getElementById('scrim').classList.remove('open'); }
let toastT=null;
function toast(m){ const el=document.getElementById('toast'); el.textContent=m; el.classList.add('show');
  clearTimeout(toastT); toastT=setTimeout(function(){ el.classList.remove('show'); },1900); }
function esc(s){ return String(s).replace(/[&<>"]/g,function(m){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]; }); }

/* ---------- wire up ---------- */
function init(){
  load();
  const shared=mergeHash();
  save();
  buildMap();
  updateProgress();
  if(shared) toast('Merged shared progress');
  document.getElementById('addBtn').onclick=toggleAdd;
  document.getElementById('shareBtn').onclick=openShare;
  document.getElementById('resetBtn').onclick=openReset;
  document.getElementById('fitBtn').onclick=function(){ map.fitBounds([[GRID.south,GRID.west],[GRID.north,GRID.east]]); };
  document.getElementById('scrim').onclick=closeSheet;
  document.getElementById('app').addEventListener('click',function(e){ if(e.target.closest('[data-close]')) closeSheet(); });
}
document.addEventListener('DOMContentLoaded', init);
