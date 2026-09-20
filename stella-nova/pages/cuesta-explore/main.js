/* ═══════════════════════════════════════════════════════════════════════════
   CUESTA PARK EXPLORE  ·  runtime
   ───────────────────────────────────────────────────────────────────────────
   This file drives a shared street checklist for the Cuesta Park neighborhood
   in Mountain View. Each street holds one status: to do, in progress, or
   explored. A tap on a row moves the status forward. The page keeps the status
   set in two places: localStorage on the device, and the URL hash for sharing.

   SHARE MODEL  (no server)
     The share link carries the whole status set in its hash. A person opens the
     link, and the page MERGES the link status into the device status. The merge
     keeps the higher status per street, so two people who trade links never
     lower each other. The merge cannot move a street backward.

   STATE SHAPE
     STATE.seed[i]   status 0..2 for SEED[i]        (fixed street order)
     STATE.custom[]  { name, s }  streets added in the field
     STATE.updated   last change time, epoch ms

   HASH FORMAT
     s1.<digits>.<b64>
       digits  one char 0..2 per SEED street, in SEED order
       b64     URL-safe base64 of JSON [[name,status], ...] for custom streets

   GREP MAP  (jump with grep -n "<token>" main.js)
     seed list ...... 'const SEED'
     load/save ...... 'function load'  'function save'
     hash merge ..... 'function mergeHash'  'function encodeHash'
     render ......... 'function render'
     tap cycle ...... 'function cycle'
     add/edit ....... 'function openAdd'  'function openEdit'
     share .......... 'function openShare'  'function doShare'
   ═══════════════════════════════════════════════════════════════════════════ */

/* Seed streets. Source: OpenStreetMap named residential ways whose center falls
   inside the Cuesta Drive / Grant Road / Miramonte Avenue box. Edit in the field
   with the add and rename controls. */
const SEED = [
  "Adams Court","Alegre Avenue","Altamead Drive","Amalfi Way","Aura Way",
  "Autumn Lane","B Street","Black Mountain Court","Bond Way","Buckingham Drive",
  "Carmel Terrace","Carob Lane","Carvo Court","Colonial Oaks Drive","Concord Avenue",
  "Crane Avenue","Damian Way","Dartmouth Lane","East Rose Circle","Eastwood Court",
  "Eastwood Drive","Eastwood Place","Estate Drive","Eureka Avenue","Eureka Court",
  "Gantry Way","Granger Avenue","Hayman Place","Hazelaar Way","Heritage Court",
  "Holly Avenue","Hospital Drive","Kensington Circle","Lammy Place","Lisa Court",
  "Lisa Lane","Loma Prieta Court","Loraine Avenue","Lundy Lane","McKenzie Avenue",
  "Milano Way","Muir Way","North Drive","Oakhurst Avenue","Odell Way",
  "Patlen Drive","Paula Court","Payne Drive","Petersen Court","Portland Avenue",
  "Rose Avenue","Rosemont Avenue","Rosemont Court","Runnymead Drive","Runnymeade Court",
  "Solace Place","Sorrento Court","South Drive","Stanley Avenue","Stanwirth Court",
  "Suffolk Court","Suffolk Way","Sunrise Court","Thatcher Court","Thatcher Drive",
  "Thorpe Court","Volti Lane","West Rose Circle","Yardis Court"
];

const KEY = 'cuesta-explore-v1';
const TAGS = ['To do','In progress','Explored'];
let STATE = { seed: [], custom: [], updated: 0 };
let filter = 'all';   // all | 0 | 1 | 2
let query = '';

/* ---------- storage ---------- */
function blankSeed(){ return SEED.map(function(){ return 0; }); }

function load(){
  try{
    const raw = localStorage.getItem(KEY);
    if(raw){ STATE = JSON.parse(raw); }
  }catch(e){ /* private mode or bad data: fall back to a blank set */ }
  if(!Array.isArray(STATE.seed)) STATE.seed = blankSeed();
  if(!Array.isArray(STATE.custom)) STATE.custom = [];
  // Keep the seed status array the same length as SEED.
  const fixed = blankSeed();
  for(let i=0;i<SEED.length && i<STATE.seed.length;i++) fixed[i] = clampS(STATE.seed[i]);
  STATE.seed = fixed;
  STATE.custom = STATE.custom.filter(function(c){ return c && c.name; })
    .map(function(c){ return { name:String(c.name), s:clampS(c.s) }; });
}
function save(){
  STATE.updated = Date.now();
  try{ localStorage.setItem(KEY, JSON.stringify(STATE)); }catch(e){}
  encodeHash();
}
function clampS(v){ v = v|0; return v<0?0:(v>2?2:v); }

/* ---------- hash encode and merge ---------- */
function encodeHash(){
  const digits = STATE.seed.map(function(s){ return clampS(s); }).join('');
  const pairs = STATE.custom.map(function(c){ return [c.name, clampS(c.s)]; });
  let b64 = '';
  if(pairs.length){
    try{ b64 = btoa(unescape(encodeURIComponent(JSON.stringify(pairs))))
      .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }catch(e){}
  }
  const h = 's1.' + digits + '.' + b64;
  try{ history.replaceState(null,'','#'+h); }catch(e){ location.hash = h; }
}
function mergeHash(){
  const h = (location.hash||'').replace(/^#/,'');
  if(h.indexOf('s1.') !== 0) return false;
  const parts = h.split('.');
  const digits = parts[1]||'';
  for(let i=0;i<SEED.length && i<digits.length;i++){
    const v = clampS(parseInt(digits[i],10)||0);
    if(v > STATE.seed[i]) STATE.seed[i] = v;   // higher status wins
  }
  const b64 = parts[2]||'';
  if(b64){
    try{
      const json = decodeURIComponent(escape(atob(b64.replace(/-/g,'+').replace(/_/g,'/'))));
      const pairs = JSON.parse(json);
      pairs.forEach(function(p){
        const name = String(p[0]); const s = clampS(p[1]);
        const hit = STATE.custom.find(function(c){ return c.name.toLowerCase()===name.toLowerCase(); });
        if(hit){ if(s>hit.s) hit.s = s; }
        else{
          // Skip a custom name that already lives in the seed list.
          const inSeed = SEED.some(function(n){ return n.toLowerCase()===name.toLowerCase(); });
          if(!inSeed) STATE.custom.push({ name:name, s:s });
        }
      });
    }catch(e){}
  }
  return true;
}

/* ---------- view model ---------- */
function items(){
  // One flat list of rows. id 'g<i>' for seed, 'c<i>' for custom.
  const out = [];
  SEED.forEach(function(n,i){ out.push({ id:'g'+i, name:n, s:STATE.seed[i], custom:false }); });
  STATE.custom.forEach(function(c,i){ out.push({ id:'c'+i, name:c.name, s:c.s, custom:true }); });
  out.sort(function(a,b){ return a.name.localeCompare(b.name); });
  return out;
}
function setStatus(id, s){
  s = clampS(s);
  if(id[0]==='g') STATE.seed[+id.slice(1)] = s;
  else{ const c = STATE.custom[+id.slice(1)]; if(c) c.s = s; }
}
function getStatus(id){
  if(id[0]==='g') return STATE.seed[+id.slice(1)];
  const c = STATE.custom[+id.slice(1)]; return c?c.s:0;
}

/* ---------- render ---------- */
function counts(){
  let todo=0,doing=0,done=0;
  STATE.seed.forEach(tally); STATE.custom.forEach(function(c){ tally(c.s); });
  function tally(s){ s = (typeof s==='object')? s.s : s; if(s===2)done++; else if(s===1)doing++; else todo++; }
  return { todo:todo, doing:doing, done:done, total:todo+doing+done };
}
function render(){
  const c = counts();
  document.getElementById('count').innerHTML = '<b>'+c.done+'</b> / '+c.total+' explored';
  const pct = c.total? Math.round(((c.done + c.doing*0.5)/c.total)*100) : 0;
  document.getElementById('barFill').style.width = pct+'%';
  // chip counts
  setChip('all', c.total); setChip('0', c.todo); setChip('1', c.doing); setChip('2', c.done);
  document.querySelectorAll('.chip').forEach(function(ch){ ch.classList.toggle('on', ch.dataset.f===filter); });

  const list = document.getElementById('list');
  const q = query.trim().toLowerCase();
  const rows = items().filter(function(it){
    if(filter!=='all' && it.s !== (+filter)) return false;
    if(q && it.name.toLowerCase().indexOf(q)<0) return false;
    return true;
  });
  if(!rows.length){
    list.innerHTML = '<div class="empty">No streets match.<br>Change the filter, or add a street below.</div>';
    return;
  }
  list.innerHTML = rows.map(function(it){
    return '<div class="row s'+it.s+'" data-id="'+it.id+'">'
      + '<span class="dot"></span>'
      + '<span class="name">'+esc(it.name)+'</span>'
      + '<span class="tag">'+TAGS[it.s]+'</span>'
      + '<button class="edit" data-edit="'+it.id+'" aria-label="Edit street">&#9998;</button>'
      + '</div>';
  }).join('');
}
function setChip(f,n){ const el=document.querySelector('.chip[data-f="'+f+'"] .n'); if(el) el.textContent=n; }
function esc(s){ return s.replace(/[&<>"]/g,function(m){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]; }); }

/* ---------- actions ---------- */
function cycle(id){
  setStatus(id, (getStatus(id)+1)%3);
  save(); render();
}
function openAdd(){
  sheet('<h3>Add a street</h3><p>Add a street the seed list missed. It joins the shared link.</p>'
    + '<input class="field" id="f-add" placeholder="Street name" autocomplete="off">'
    + '<div class="sheet-row"><button class="btn" data-close>Cancel</button>'
    + '<button class="btn primary" id="f-add-ok">Add</button></div>');
  const inp = document.getElementById('f-add'); inp.focus();
  document.getElementById('f-add-ok').onclick = function(){
    const name = inp.value.trim(); if(!name){ inp.focus(); return; }
    const dup = SEED.concat(STATE.custom.map(function(c){return c.name;}))
      .some(function(n){ return n.toLowerCase()===name.toLowerCase(); });
    if(dup){ toast('Already on the list'); closeSheet(); return; }
    STATE.custom.push({ name:name, s:0 }); save(); render(); closeSheet(); toast('Added '+name);
  };
  inp.onkeydown = function(e){ if(e.key==='Enter') document.getElementById('f-add-ok').click(); };
}
function openEdit(id){
  const cur = items().find(function(it){ return it.id===id; }); if(!cur) return;
  const isCustom = id[0]==='c';
  sheet('<h3>'+esc(cur.name)+'</h3>'
    + '<p>Set the status, or rename'+(isCustom?' or remove':'')+' this street.</p>'
    + '<div class="sheet-row" style="margin-bottom:12px">'
      + '<button class="btn" data-s="0">To do</button>'
      + '<button class="btn" data-s="1">In progress</button>'
      + '<button class="btn primary" data-s="2">Explored</button></div>'
    + '<input class="field" id="f-name" value="'+esc(cur.name)+'">'
    + '<div class="sheet-row"><button class="btn" data-close>Close</button>'
    + (isCustom?'<button class="btn" id="f-del"><span class="danger">Remove</span></button>':'')
    + '<button class="btn primary" id="f-rename">Rename</button></div>');
  document.querySelectorAll('.sheet [data-s]').forEach(function(b){
    b.onclick = function(){ setStatus(id, +b.dataset.s); save(); render(); closeSheet(); };
  });
  document.getElementById('f-rename').onclick = function(){
    const v = document.getElementById('f-name').value.trim(); if(!v) return;
    if(id[0]==='g'){
      // Renaming a seed street turns it into a custom entry with the same status.
      const i = +id.slice(1); const s = STATE.seed[i];
      if(v!==SEED[i]){ STATE.custom.push({ name:v, s:s }); STATE.seed[i]=0; }
    }else{ STATE.custom[+id.slice(1)].name = v; }
    save(); render(); closeSheet();
  };
  const del = document.getElementById('f-del');
  if(del) del.onclick = function(){ STATE.custom.splice(+id.slice(1),1); save(); render(); closeSheet(); };
}
function openShare(){
  const url = shareLink();
  sheet('<h3>Share progress</h3>'
    + '<p>Send this link to the team. When they open it, their map takes the'
    + ' higher status per street. It never lowers what someone marked.</p>'
    + '<div class="link-box" id="f-link">'+esc(url)+'</div>'
    + '<div class="sheet-row">'
    + (navigator.share?'<button class="btn primary" id="f-send">Share</button>':'')
    + '<button class="btn'+(navigator.share?'':' primary')+'" id="f-copy">Copy link</button></div>'
    + '<div class="sheet-row" style="margin-top:10px"><button class="btn" data-close>Done</button></div>');
  const send = document.getElementById('f-send'); if(send) send.onclick = doShare;
  document.getElementById('f-copy').onclick = function(){ copy(url); };
}
function shareLink(){ return location.origin + location.pathname + location.hash; }
function doShare(){
  navigator.share({ title:'Cuesta Park Explore', text:'Which streets we have covered', url:shareLink() })
    .catch(function(){});
}
function copy(text){
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(function(){ toast('Link copied'); },function(){ fallbackCopy(text); });
  }else fallbackCopy(text);
}
function fallbackCopy(text){
  const t=document.createElement('textarea'); t.value=text; t.style.position='fixed'; t.style.opacity='0';
  document.body.appendChild(t); t.select();
  try{ document.execCommand('copy'); toast('Link copied'); }catch(e){ toast('Copy failed'); }
  document.body.removeChild(t);
}
function openReset(){
  sheet('<h3>Reset this device</h3><p>Set every street back to "to do" on this device.'
    + ' It does not change other people. This cannot be undone.</p>'
    + '<div class="sheet-row"><button class="btn" data-close>Cancel</button>'
    + '<button class="btn" id="f-reset"><span class="danger">Reset all</span></button></div>');
  document.getElementById('f-reset').onclick = function(){
    STATE.seed = blankSeed(); STATE.custom.forEach(function(c){ c.s=0; });
    save(); render(); closeSheet(); toast('Reset');
  };
}

/* ---------- bottom sheet + toast ---------- */
function sheet(html){
  document.getElementById('sheet').innerHTML = html;
  document.getElementById('sheet').classList.add('open');
  document.getElementById('scrim').classList.add('open');
}
function closeSheet(){
  document.getElementById('sheet').classList.remove('open');
  document.getElementById('scrim').classList.remove('open');
}
let toastT=null;
function toast(msg){
  const el=document.getElementById('toast'); el.textContent=msg; el.classList.add('show');
  clearTimeout(toastT); toastT=setTimeout(function(){ el.classList.remove('show'); }, 1900);
}

/* ---------- wire up ---------- */
function init(){
  load();
  const shared = mergeHash();
  save();                 // writes merged state and refreshes the hash
  render();
  if(shared) toast('Merged shared progress');

  document.getElementById('list').addEventListener('click', function(e){
    const ed = e.target.closest('[data-edit]');
    if(ed){ openEdit(ed.dataset.edit); return; }
    const row = e.target.closest('.row');
    if(row) cycle(row.dataset.id);
  });
  document.querySelectorAll('.chip').forEach(function(ch){
    ch.onclick = function(){ filter = ch.dataset.f; render(); };
  });
  const s = document.getElementById('search');
  s.addEventListener('input', function(){
    query = s.value;
    s.parentElement.classList.toggle('has-text', !!s.value);
    render();
  });
  document.querySelector('.search-x').onclick = function(){
    s.value=''; query=''; s.parentElement.classList.remove('has-text'); render(); s.focus();
  };
  document.getElementById('addBtn').onclick = openAdd;
  document.getElementById('shareBtn').onclick = openShare;
  document.getElementById('resetBtn').onclick = openReset;
  document.getElementById('scrim').onclick = closeSheet;
  document.querySelector('#app').addEventListener('click', function(e){
    if(e.target.closest('[data-close]')) closeSheet();
  });
}
document.addEventListener('DOMContentLoaded', init);
