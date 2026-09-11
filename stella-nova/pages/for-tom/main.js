const flowProfiles = {
  start:{t:'Round Start',c:'Player drops in. The first five attacks have already resolved — you arrive in media res, with chaos already in progress.',accent:false},
  'media-res':{t:'In Media Res',c:'<span class="accent">5 random attacks pre-resolved.</span> Fires already burning, systems already damaged, enemies already deployed. The game does not begin in calm.',accent:true},
  map:{t:'Map View',c:'The strategic map reveals the full picture. Systems failing across the ship — you choose what to save and what to let go.',accent:false},
  prioritize:{t:'Prioritize Threats',c:'Triage: which fire is biggest? Which system is most critical? Which enemy is closest to a Bob? Decisions are the gameplay.',accent:false},
  navigate:{t:'Navigate + Solve',c:'Click-to-move toward priority targets. Engage hostiles, weaponize the environment, repair damage.',accent:false},
  combat:{t:'Firefight',c:'Auto-aim engagements with growing recoil. Pacing bursts produces perfectly accurate fire.',accent:false},
  repair:{t:'Repair',c:'Wrench out broken systems. Blast windows for vacuum, then repair them when the room is clear.',accent:false},
  newprob:{t:'New Problems Spawn',c:'Attack events fire on a fixed interval — new fires, new enemies, new system damage. <span class="accent">The pressure never relents.</span>',accent:true},
  player:{t:'Player Input',c:'One character under direct control. Mouse-driven by default; <span class="accent">WASD under review</span> but on hold.',accent:true},
  input:{t:'Input Branch',c:'Five branches on the input layer. Each maps deterministically to one in-world outcome.',accent:false},
  'lmb-enemy':{t:'LMB · On Enemy',c:'Aim auto-snaps to enemy center mass. Hold to fire — <span class="accent">"recoil gets bigger so pacing your shots will resolve in perfectly accurate burst."</span>',accent:true},
  'lmb-device':{t:'LMB · On Device',c:'Destructible devices: window, fire barrel, bomb, power conduit. LMB destroys them and triggers the associated hazard.',accent:false},
  rmb:{t:'RMB · Anywhere',c:'Manual aim. Decoupled from auto-aim. Used for trick angles, environmental shots, intentional misses.',accent:false},
  'click-move':{t:'Click · Ground',c:'Click-to-move pathing. Movement is tuned for decisions, not reflexes.',accent:false},
  'click-npc':{t:'Click · NPC',c:'Selects an NPC. Issue direct orders the same way you command yourself.',accent:false},
  'o-burst':{t:'Outcome · Burst',c:'Paced shots stay inside the perfect-accuracy band. Held shots overshoot the recoil ceiling.',accent:false},
  'o-hazard':{t:'Outcome · Hazard',c:'Suction zones, fire spread, blast detonation, electrified wires. Stray bullets from enemy robots can also trigger these.',accent:false},
  'o-free':{t:'Outcome · Free Fire',c:'Player-aimed projectile path. No auto-targeting assistance.',accent:false},
  'o-move':{t:'Outcome · Move',c:'Pathfinding to clicked location.',accent:false},
  'o-command':{t:'Outcome · Command',c:'NPC selected; awaiting direct order or personality switch.',accent:false},
  player2:{t:'Player',c:'Same one-character controller. Crew commands layer on top.',accent:false},
  bob:{t:'Bob · Civilian Crew',c:'Pistol-armed, fragile, scattered. Flees when combat draws near. <span class="accent">Must be protected — they operate the ship.</span>',accent:true},
  atech:{t:'Fellow AstroTech',c:'Engineer-soldier peer. Multiple abilities, autonomous combat use. Recoverable through play.',accent:false},
  follow:{t:'Personality · Follow',c:'NPC trails behind the player. Useful for escorts.',accent:false},
  guard:{t:'Personality · Guard',c:'NPC holds position and engages hostiles entering range.',accent:false},
  default:{t:'Personality · Default',c:'Idle / scared behavior. Bobs flee from nearby combat.',accent:false},
  work:{t:'Personality · Work · STRETCH',c:'Stretch goal. Autonomous repair labor — assign crew to broken systems and they fix them without further input.',accent:true},
  follow2:{t:'AstroTech Personalities',c:'Same four options as Bobs.',accent:false},
  'abilities-auto':{t:'Autonomous Abilities',c:'AstroTechs use their abilities automatically when enemies are near.',accent:false},
  'o-follow':{t:'Behavior · Trails',c:'Tracks player position with a small offset.',accent:false},
  'o-guard':{t:'Behavior · Holds',c:'Stationary. Auto-fires on hostiles in range.',accent:false},
  'o-default':{t:'Behavior · Flees',c:'Bobs panic and route away from threats.',accent:false},
  'o-work':{t:'Behavior · Repairs · STRETCH',c:'Targets damaged systems and repairs them autonomously. Stretch only.',accent:true},
  'o-engaged':{t:'Behavior · Engages',c:'AstroTech locks on and fires.',accent:false},
  'o-cast':{t:'Behavior · Casts',c:'Uses abilities on cooldown when targets are valid.',accent:false},
  round:{t:'Round Active',c:'Mid-round. All systems running, all paths still open.',accent:false},
  'systems-up':{t:'Systems Repaired',c:'Critical systems back online. Ship integrity holding.',accent:false},
  objective:{t:'Objective Complete',c:'Mission goal achieved — defense held, story beat reached, or wave cleared.',accent:false},
  win:{t:'VICTORY',c:'Round resolves to win. <span class="accent">Save the ship with your strat.</span>',accent:true},
  'fail-trigger':{t:'Fail Trigger',c:'Any one of three failure conditions activates the defeat path.',accent:false},
  death:{t:'Player Down',c:'Engineer killed in combat. Game over.',accent:false},
  'ship-loss':{t:'Critical Systems Lost',c:'Too much damage to ship-critical infrastructure. Vessel cannot be saved.',accent:false},
  overrun:{t:'Overrun',c:'Hostile mass exceeds containable threshold. Position lost.',accent:false},
  defeat:{t:'DEFEAT',c:'Round resolves to loss. Restart or load.',accent:false}
};
function bindFlow(svgId, sideId){
  const svg = document.getElementById(svgId);
  const side = document.getElementById(sideId);
  const nodes = svg.querySelectorAll('.node');
  nodes.forEach(n=>{
    n.addEventListener('mouseenter',()=>{
      nodes.forEach(x=>x.classList.remove('active'));
      n.classList.add('active');
      const k = n.dataset.key; const p = flowProfiles[k]; if(!p) return;
      side.innerHTML = `<div class="meta">${p.accent?'⚠ Critical Profile':'Node Profile'}</div><h4>${p.t}</h4><p>${p.c}</p>`;
    });
  });
}
bindFlow('flowLoop','loopSide');bindFlow('flowCombat','combatSide');bindFlow('flowCrew','crewSide');bindFlow('flowEnd','endSide');

(function(){
  const svg=document.getElementById('recoilSvg'),path=document.getElementById('recoilCurve'),dot=document.getElementById('recoilDot'),tEl=document.getElementById('holdTime'),sEl=document.getElementById('spread');
  let t=0,holding=false,points=[];
  function tick(){
    if(holding){t=Math.min(t+0.05,4);}else{t=Math.max(t-0.15,0);}
    const x=(t/4)*600,y=180-(1-Math.exp(-t*0.9))*150;
    if(holding){points.push([x,y]);if(points.length>120)points.shift();}
    if(!holding&&t<=0){points=[];}
    let d="M 0 180";points.forEach(p=>{d+=` L ${p[0].toFixed(1)} ${p[1].toFixed(1)}`;});
    path.setAttribute('d',d);dot.setAttribute('cx',x);dot.setAttribute('cy',y);
    const spread=((1-Math.exp(-t*0.9))*100).toFixed(0);
    tEl.textContent=t.toFixed(1)+'s';sEl.textContent=spread+'%';sEl.className=spread>60?'warn':'';
    requestAnimationFrame(tick);
  }
  svg.addEventListener('mousedown',()=>{holding=true;});
  svg.addEventListener('touchstart',e=>{e.preventDefault();holding=true;},{passive:false});
  window.addEventListener('mouseup',()=>{holding=false;});
  window.addEventListener('touchend',()=>{holding=false;});
  tick();
})();
(function(){
  const slider=document.getElementById('dilSlider'),val=document.getElementById('dilVal'),planet=document.getElementById('dilPlanet'),stateLabel=document.getElementById('dilStateLabel');
  let angle=0,lastT=0;
  function frame(t){
    if(!lastT)lastT=t;const dt=(t-lastT)/1000;lastT=t;
    const speed=+slider.value/100;angle+=dt*speed*1.4;
    const cx=100+Math.cos(angle)*42,cy=50+Math.sin(angle)*42;
    planet.setAttribute('cx',cx.toFixed(2));planet.setAttribute('cy',cy.toFixed(2));
    requestAnimationFrame(frame);
  }
  slider.addEventListener('input',()=>{
    const v=+slider.value;val.textContent=v+'%';
    if(v<=20)stateLabel.textContent='AT REST';else if(v<70)stateLabel.textContent='COMMITTING';
    else if(v<=75)stateLabel.textContent='COMMIT // 70%';else stateLabel.textContent='OVERDRIVE';
  });
  requestAnimationFrame(frame);
})();
(function(){
  const data={snipers:{n:'SNIPERS',c:'Long-range corrupted units. Force you to break sightlines and approach via cover or environmental hazards.'},
    spiders:{n:'SPIDERS',c:'Fast, low-profile machines. Punish stationary play. Vulnerable to suction zones and live-wire traps.'},
    sentry:{n:'SENTRY DROIDS',c:'Garrisoned area-denial. Hold key chokepoints — dislodge with grenades, AOE, or environmental detonation.'},
    boss:{n:'ENVIRONMENTAL BOSSES',c:'"Powerful environmental boss-enemies." Fight is structured around the room itself — windows, conduits, barrels.'}};
  const detail=document.getElementById('threatDetail');const bands=document.querySelectorAll('.threats .bar div');
  bands.forEach(b=>{b.addEventListener('mouseenter',()=>{bands.forEach(x=>x.classList.remove('active'));b.classList.add('active');const d=data[b.dataset.t];detail.innerHTML=`<b>${d.n}</b>${d.c}`;});});
})();
(function(){
  const hazards={
    window:{n:'Window',m:'PROFILE 01 / 05',ph:'SCREENSHOT · DECOMPRESSION KILL',
      e:`<p><strong>Three states:</strong> <span class="tag ship">Working / Closed</span> <span class="tag" style="color:var(--magenta);border-color:var(--magenta);">Broken</span> <span class="tag" style="color:var(--cyan);border-color:var(--cyan-mid);">Broken-Shielded</span></p>
          <p>When broken, a window <em style="color:var(--cyan);font-style:normal;">"will create a sucking area of effect"</em>, then after a couple seconds <em style="color:var(--cyan);font-style:normal;">"they will shield themselves and become broken shielded."</em></p>
          <p style="font-size:13px;color:var(--text-dim);"><span class="tag stretch">STRETCH</span> Wire to a power conduit — destroy the conduit and the window will not shield itself.</p>`,
      svg:`<rect x="40" y="30" width="80" height="40" fill="none" stroke="#5be6e6" stroke-width="1.5"/><text x="80" y="86" fill="#5be6e6" font-size="9" font-family="JetBrains Mono" text-anchor="middle">WORKING</text>
            <line x1="135" y1="50" x2="155" y2="50" stroke="#2a8a8a" stroke-width="1" marker-end="url(#hazArrow)"/>
            <rect x="170" y="30" width="80" height="40" fill="none" stroke="#ff3d8b" stroke-width="1.5" stroke-dasharray="3,2"/><circle cx="195" cy="50" r="4" fill="#ff3d8b" class="bloom"/><circle cx="225" cy="50" r="4" fill="#ff3d8b" class="bloom"/><text x="210" y="86" fill="#ff3d8b" font-size="9" font-family="JetBrains Mono" text-anchor="middle">BROKEN</text>
            <line x1="265" y1="50" x2="285" y2="50" stroke="#2a8a8a" stroke-width="1" marker-end="url(#hazArrow)"/>
            <rect x="300" y="30" width="80" height="40" fill="none" stroke="#5be6e6" stroke-width="2"/><rect x="304" y="34" width="72" height="32" fill="none" stroke="#5be6e6" stroke-width="0.5" stroke-dasharray="2,2"/><text x="340" y="86" fill="#5be6e6" font-size="9" font-family="JetBrains Mono" text-anchor="middle">SHIELDED</text>`},
    door:{n:'Door',m:'PROFILE 02 / 05',ph:'SCREENSHOT · DOOR OPENING',
      e:`<p>Opens automatically to <em style="color:var(--cyan);font-style:normal;">"both friendly and enemies."</em> Pretty durable but grenades and similar will damage it. Damageable in both open and closed states.</p>
          <p style="font-size:13px;color:var(--text-dim);"><span class="tag hidden">LIKELY ADD</span> Doors can be enemy-infected — walk through without shooting the enemies off the door and it sends an attack toward you.</p>
          <p style="font-size:13px;color:var(--text-dim);"><span class="tag stretch">STRETCH</span> Pressurized via oxygen generator on one side. Unequal pressure disables auto-open; manual click vents a short air burst before shielding or becoming a walkable windy area.</p>`,
      svg:`<rect x="40" y="35" width="20" height="30" fill="none" stroke="#5be6e6" stroke-width="1.5"/><rect x="60" y="35" width="20" height="30" fill="none" stroke="#5be6e6" stroke-width="1.5"/><text x="60" y="86" fill="#5be6e6" font-size="9" font-family="JetBrains Mono" text-anchor="middle">CLOSED</text>
            <line x1="95" y1="50" x2="115" y2="50" stroke="#2a8a8a" stroke-width="1" marker-end="url(#hazArrow)"/>
            <rect x="125" y="35" width="20" height="30" fill="none" stroke="#5be6e6" stroke-width="1.5"/><line x1="148" y1="35" x2="170" y2="35" stroke="#5be6e6" stroke-width="1.5"/><line x1="148" y1="65" x2="170" y2="65" stroke="#5be6e6" stroke-width="1.5"/><rect x="170" y="35" width="20" height="30" fill="none" stroke="#5be6e6" stroke-width="1.5"/><text x="155" y="86" fill="#5be6e6" font-size="9" font-family="JetBrains Mono" text-anchor="middle">OPEN</text>
            <line x1="205" y1="50" x2="225" y2="50" stroke="#ffb000" stroke-width="1" marker-end="url(#hazArrow)"/>
            <rect x="240" y="35" width="20" height="30" fill="none" stroke="#ffb000" stroke-width="1.5" stroke-dasharray="3,2"/><rect x="260" y="35" width="20" height="30" fill="none" stroke="#ffb000" stroke-width="1.5" stroke-dasharray="3,2"/><circle cx="270" cy="50" r="3" fill="#ff3d8b" class="bloom"/><text x="260" y="86" fill="#ffb000" font-size="9" font-family="JetBrains Mono" text-anchor="middle">INFECTED</text>
            <text x="350" y="50" fill="#ff3d8b" font-size="9" font-family="JetBrains Mono">→ ATTACKS</text>`},
    bomb:{n:'Barrel Bomb',m:'PROFILE 03 / 05',ph:'SCREENSHOT · DETONATION',
      e:`<p><em style="color:var(--cyan);font-style:normal;">"A classic barrel that you shoot and it blows up."</em></p>
          <p>Cannot be repaired once destroyed. One-shot environmental tool — clear a room or take out a cluster in a single trigger.</p>`,
      svg:`<rect x="180" y="30" width="40" height="40" fill="none" stroke="#ff3d8b" stroke-width="1.5"/><circle cx="200" cy="50" r="6" fill="#ff3d8b" class="bloom"/><circle cx="200" cy="50" r="20" fill="none" stroke="#ffb000" stroke-width="1"/><circle cx="200" cy="50" r="35" fill="none" stroke="#ffb000" stroke-width="1" opacity="0.6"/><circle cx="200" cy="50" r="48" fill="none" stroke="#ffb000" stroke-width="1" opacity="0.3" stroke-dasharray="3,3"/><text x="200" y="92" fill="#ffb000" font-size="9" font-family="JetBrains Mono" text-anchor="middle">BLAST RADIUS · ONE-SHOT</text>`},
    fire:{n:'Fire Barrel',m:'PROFILE 04 / 05',ph:'SCREENSHOT · FIRE SPREAD',
      e:`<p>Wall-mounted. <em style="color:var(--cyan);font-style:normal;">"When you shoot it, it drops some fire hazards that spread organically."</em></p>
          <p>Unlike the barrel bomb, the fire barrel <strong>can be repaired</strong>. Spread continues until contained.</p>`,
      svg:`<rect x="40" y="30" width="20" height="40" fill="none" stroke="#ff3d8b" stroke-width="1.5"/><line x1="40" y1="30" x2="40" y2="70" stroke="#ff3d8b" stroke-width="3"/><text x="50" y="86" fill="#ff3d8b" font-size="9" font-family="JetBrains Mono" text-anchor="middle">WALL</text>
            <circle cx="120" cy="60" r="6" fill="#ff3d8b" class="bloom"/><circle cx="160" cy="55" r="5" fill="#ff3d8b" class="bloom"/><circle cx="200" cy="62" r="7" fill="#ff3d8b" class="bloom"/><circle cx="240" cy="55" r="5" fill="#ff3d8b" class="bloom"/><circle cx="280" cy="60" r="6" fill="#ff3d8b" class="bloom"/>
            <circle cx="120" cy="60" r="14" fill="none" stroke="#ffb000" stroke-dasharray="2,3" opacity="0.6"/><circle cx="200" cy="62" r="16" fill="none" stroke="#ffb000" stroke-dasharray="2,3" opacity="0.6"/><circle cx="280" cy="60" r="14" fill="none" stroke="#ffb000" stroke-dasharray="2,3" opacity="0.6"/>
            <text x="200" y="92" fill="#ffb000" font-size="9" font-family="JetBrains Mono" text-anchor="middle">SPREADS ORGANICALLY · REPAIRABLE</text>`},
    conduit:{n:'Power Conduit',m:'PROFILE 05 / 05',ph:'SCREENSHOT · STUN TRAP',
      e:`<p>Usually mounted above a set of electrical wires. Shoot the conduit and the wires <em style="color:var(--cyan);font-style:normal;">"create a hazard that will stun a player or enemies a little — sticky trap if you will."</em></p>
          <p style="font-size:13px;color:var(--text-dim);">Conduits are also the wiring substrate for the stretch interconnects (window-to-conduit, etc.).</p>`,
      svg:`<rect x="160" y="20" width="80" height="14" fill="none" stroke="#ffb000" stroke-width="1.5"/><text x="200" y="16" fill="#ffb000" font-size="9" font-family="JetBrains Mono" text-anchor="middle">CONDUIT</text>
            <path d="M 20 60 L 60 40 L 100 60 L 140 40 L 180 60 L 220 40 L 260 60 L 300 40 L 340 60 L 380 40" fill="none" stroke="#ffb000" stroke-width="2"/>
            <circle cx="100" cy="60" r="4" fill="#ff3d8b" class="bloom"/><circle cx="220" cy="40" r="4" fill="#ff3d8b" class="bloom"/>
            <text x="200" y="92" fill="#ffb000" font-size="9" font-family="JetBrains Mono" text-anchor="middle">STUN ZONE — STICKY TRAP</text>`}
  };
  const detail=document.getElementById('hazDetail');const opts=document.querySelectorAll('.haz .opt');
  opts.forEach(o=>{o.addEventListener('click',()=>{
    opts.forEach(x=>x.classList.remove('on'));o.classList.add('on');
    const h=hazards[o.dataset.haz];
    detail.innerHTML=`<div class="topbar"><div class="hmeta">${h.m}</div><div style="display:flex;gap:8px;align-items:center;"><span class="dial fast" style="width:24px;height:24px;"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="none" stroke="#2a8a8a" stroke-width="1"/><g class="sweep"><line x1="20" y1="20" x2="20" y2="6" stroke="#5be6e6" stroke-width="1.5"/></g></svg></span><span class="btn-pulse cyan" style="width:10px;height:10px;"></span></div></div><h4>${h.n}</h4><div class="ph" data-dim="500×120">${h.ph}</div>${h.e}<svg class="diag" viewBox="0 0 400 100"><defs><marker id="hazArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#2a8a8a"/></marker></defs>${h.svg}</svg>`;
  });});
})();
(function(){
  const buttons=document.querySelectorAll('.regfilters button');const rows=document.querySelectorAll('#regBody tr');
  buttons.forEach(b=>{b.addEventListener('click',()=>{buttons.forEach(x=>x.classList.remove('on'));b.classList.add('on');
    const f=b.dataset.filter;rows.forEach(r=>{if(f==='all'||r.dataset.row===f)r.classList.remove('hide');else r.classList.add('hide');});});});
})();
document.querySelectorAll('.topnav a').forEach(a=>{a.addEventListener('click',e=>{const id=a.getAttribute('href').slice(1);const el=document.getElementById(id);if(el){e.preventDefault();el.scrollIntoView({behavior:'smooth',block:'start'});}});});
