/* ═════════════════════════════════════════════════════════════
   MATH PANEL RENDERING (live values, color-coded variable names)
   ═════════════════════════════════════════════════════════════ */
// The live maths is plain HTML (no KaTeX: its HTML layout fails in Safari).
// The .mx, .fr and .rad classes in style.css set it with flex boxes only.
// mx wraps one formula; fr is a stacked fraction; rad is a square root with
// its bar; cv colours one symbol; I sets a symbol in italic with an optional
// subscript.
const mx=h=>`<span class="mx">${h}</span>`;
const fr=(n,d)=>`<span class="fr"><span>${n}</span><span>${d}</span></span>`;
const rad=h=>`<span class="rad">\u221a<span>${h}</span></span>`;
const cv=(col,h)=>`<span style="color:${col}">${h}</span>`;
const I=(sym,sub)=>`<i>${sym}</i>${sub?`<sub>${sub}</sub>`:''}`;
// Number formatters: 3 and 4 decimals; fk converts AU/yr to km/s; fD to days.
const f3=v=>v.toFixed(3), f4=v=>v.toFixed(4);
const fk=v=>(v*AU2KMS).toFixed(3);
const fD=yr=>(yr*365.25).toFixed(0);

// Colour code for each variable, matching the reference SVG (typeset.mjs).
const CC={
  mu:'#ffc832', r:'#96c8ff', v:'#7ad87a', a:'#ff9050',
  dv:'#5cd8e8', t:'#ffc832', phi:'#d870c8', om:'#d870c8'
};

// Build the hop-log panel: one row per completed leg, plus a total-Δv and
// best-grade summary. Returns empty when hop mode is off.
function hopLogHTML(){
  if(!hopMode) return '';
  // Sum every leg's total Δv, converted to km/s.
  const totalDv=(hopLog.reduce((a,h)=>a+h.dvTot,0)*AU2KMS).toFixed(3);
  const gradeColors={'A+':'#69f7a0','A':'#69f7a0','A−':'#a8f0c0','B+':'#96c8ff','B':'#96c8ff','B−':'#96c8ff','C+':'#ffc832','C':'#ffc832','C−':'#ffa040','D+':'#ff7060','D':'#ff5050','D−':'#ff5050','F':'#ff3030'};
  const gi=g=>Object.keys(gradeColors).indexOf(g);
  const best=hopLog.length?hopLog.reduce((b,h)=>gi(h.grade)<gi(b)?h.grade:b,hopLog[0].grade):'';
  const rows=hopLog.length===0
    ? `<div class="prose" style="text-align:center;padding:6px 0">No hops yet</div>`
    : hopLog.map((h,i)=>`
      <div class="hop-row">
        <div class="hop-n">${i+1}</div>
        <div class="hop-leg"><span style="color:${h.fromColor}">${h.from}</span> → <span style="color:${h.toColor}">${h.to}</span><span class="hop-dv">${(h.dvTot*AU2KMS).toFixed(2)} km/s</span></div>
        <div class="hop-grade" style="color:${h.color||gradeColors[h.grade]||'#c8d0e0'}">${h.grade}</div>
      </div>`).join('');
  return `
    <div class="msec">
      <div class="msec-head"><span style="color:var(--green)">Hop log</span><span class="mh-tag">${hopLog.length} hops${hopLog.length>0?' · '+totalDv+' km/s':''}</span></div>
      ${rows}
      ${hopLog.length>0?`
      <div class="scards" style="margin-top:8px">
        <div class="scard"><div class="sl">Total Δv</div><div class="sv" style="color:var(--green)">${totalDv}<span class="su">km/s</span></div></div>
        <div class="scard"><div class="sl">Best grade</div><div class="sv" style="color:${gradeColors[best]||'#c8d0e0'};font-family:var(--serif)">${best}</div></div>
      </div>`:''}
    </div>`;
}

// Render the live computation panel. Its content has three stages: no source
// picked (intro), source only (circular speed), and both picked (the full
// eight-step Hohmann walkthrough with live values and launch windows).
function renderMath(){
  const el=document.getElementById('mathcontent');

  // Stage 1: nothing selected yet, show the getting-started copy.
  if(!source){
    el.innerHTML=hopLogHTML()+`
      <div class="msec">
        <div class="msec-head"><span>Getting started</span></div>
        <div class="ph">
          <span class="ic">Orbital Mechanics</span>
          ${hopMode
            ?'Select your home planet to park your spacecraft there. Then pick any destination and launch repeated transfers in a chain.'
            :'Click any planet to set the source orbit, then click another to compute the Hohmann transfer and reveal the launch windows.'}
        </div>
      </div>
      <div class="msec">
        <div class="msec-head"><span>What this calculator does</span></div>
        <div class="prose">
          A <b>Hohmann transfer</b> is the lowest-fuel route between two circular coplanar orbits. The spacecraft burns once to enter an elliptical transfer orbit tangent to both circles, coasts, then burns again to circularise at the target.
          <br><br>
          The card above shows the equations that describe the maneuver. After you pick a source and target, this panel fills with the live computed values, the three nearest launch windows, and an eight-step walkthrough of the math.
        </div>
      </div>`;
    return;
  }

  // Stage 2: source picked, no target; show the source orbit and its v_c1.
  if(!target){
    el.innerHTML=hopLogHTML()+`
      <div class="msec">
        <div class="msec-head"><span>Selected orbit</span></div>
        <div class="ocards">
          <div class="ocard src">
            <div class="ol">${hopMode?'Parked At':'Source'}</div>
            <div class="on" style="color:${source.color}">${source.name}</div>
            <div class="ov"><span style="color:${CC.r}">r₁</span> = ${f3(source.r)} AU<br><span style="color:${CC.v}">v</span> = ${fk(source.speed)} km/s<br><span style="color:${CC.t}">T</span> = ${source.period.toFixed(3)} yr</div>
          </div>
          <div class="ocard dim">
            <div class="ol">Target</div>
            <div class="on" style="color:var(--text-faint)">—</div>
            <div class="ov">click another planet</div>
          </div>
        </div>
      </div>
      <div class="msec">
        <div class="msec-head"><span>Circular speed at <span style="color:${CC.r}">r₁</span></span></div>
        <div class="sline">${mx(`${cv(CC.v,I('v','c1'))} = ${rad(`4π²/${cv(CC.r,f3(source.r))}`)} = ${f4(source.speed)} AU/yr`)}</div>
        <div class="sresult" style="color:${CC.v}">= ${fk(source.speed)} km/s</div>
      </div>`;
    return;
  }

  // Stage 3: both orbits picked; pull the computed transfer and build the walkthrough.
  const tr=xfer;
  const{r1,r2,a_t,b_t,c_t,e_t,asc,vc1,vc2,v1,v2,dv1,dv2,dvTot,tTr}=tr;
  // Required lead angle for the launch-window explanation, in degrees.
  const phi_req=Math.PI-target.omega*tTr;
  const phi_deg=(phi_req*180/Math.PI).toFixed(1);
  const tDays=(tTr*365.25).toFixed(1);
  // Cards for each computed launch window with its countdown.
  const wHTML=launchWindows.map((w,i)=>`
    <div class="wcard w${i+1}">
      <div class="wlbl">${w.label} · in ${fD(w.dt)} days</div>
      <div class="wval${i>0?` d${i+1}`:''}">${(w.dt*365.25).toFixed(1)} d</div>
    </div>`).join('');

  el.innerHTML=hopLogHTML()+`
    <div class="msec">
      <div class="msec-head"><span>Selected orbits</span><span class="mh-tag">${asc?'↑ ascending':'↓ descending'}</span></div>
      <div class="ocards">
        <div class="ocard src">
          <div class="ol">${hopMode?'Parked At':'Source'}</div>
          <div class="on" style="color:${source.color}">${source.name}</div>
          <div class="ov"><span style="color:${CC.r}">r₁</span> = ${f3(r1)} AU<br><span style="color:${CC.v}">v<sub>c1</sub></span> = ${fk(vc1)} km/s<br><span style="color:${CC.t}">T</span> = ${source.period.toFixed(3)} yr</div>
        </div>
        <div class="ocard tgt">
          <div class="ol">Target</div>
          <div class="on" style="color:${target.color}">${target.name}</div>
          <div class="ov"><span style="color:${CC.r}">r₂</span> = ${f3(r2)} AU<br><span style="color:${CC.v}">v<sub>c2</sub></span> = ${fk(vc2)} km/s<br><span style="color:${CC.t}">T</span> = ${target.period.toFixed(3)} yr</div>
        </div>
      </div>
    </div>

    <div class="msec">
      <div class="msec-head"><span>Launch windows</span><span class="mh-tag">phase alignment</span></div>
      <div class="prose" style="margin-bottom:6px">
        Required target lead angle: ${mx(`${cv(CC.phi,I('φ','req'))} = ${phi_deg}°`)}
      </div>
      <div class="wcards">${wHTML}</div>
    </div>

    <div class="msec">
      <div class="msec-head"><span>Step by step</span></div>
      <div class="step">
        <div class="snum">01</div>
        <div class="sbody"><b>Transfer semi-major axis</b>
          <div class="sline">${mx(`${cv(CC.a,I('a','t'))} = ${fr(`${cv(CC.r,f3(r1))} + ${cv(CC.r,f3(r2))}`,'2')} = ${f3(a_t)} AU`)}</div>
        </div>
      </div>
      <div class="step">
        <div class="snum">02</div>
        <div class="sbody"><b>Ellipse geometry</b>
          <div class="sline">${mx(`${I('c','t')} = ${f3(c_t)}, ${I('b','t')} = ${f3(b_t)}, ${I('e')} = ${e_t.toFixed(4)}`)}</div>
        </div>
      </div>
      <div class="step">
        <div class="snum">03</div>
        <div class="sbody"><b>Circular speeds</b>
          <div class="sline">${mx(`${cv(CC.v,I('v','c1'))} = ${fk(vc1)} km/s, ${cv(CC.v,I('v','c2'))} = ${fk(vc2)} km/s`)}</div>
        </div>
      </div>
      <div class="step">
        <div class="snum">04</div>
        <div class="sbody"><b>Vis-viva at <span style="color:${CC.r}">r₁</span> on transfer</b>
          <div class="sline">${mx(`${cv(CC.v,I('v','1'))} = ${rad(`4π²(${fr('2',cv(CC.r,f3(r1)))} − ${fr('1',cv(CC.a,f3(a_t)))})`)}`)}</div>
          <div class="sresult" style="color:${CC.v}">= ${fk(v1)} km/s</div>
        </div>
      </div>
      <div class="step">
        <div class="snum">05</div>
        <div class="sbody"><b>Vis-viva at <span style="color:${CC.r}">r₂</span> on transfer</b>
          <div class="sline">${mx(`${cv(CC.v,I('v','2'))} = ${rad(`4π²(${fr('2',cv(CC.r,f3(r2)))} − ${fr('1',cv(CC.a,f3(a_t)))})`)}`)}</div>
          <div class="sresult" style="color:${CC.v}">= ${fk(v2)} km/s</div>
        </div>
      </div>
      <div class="step">
        <div class="snum" style="color:${CC.dv}">06</div>
        <div class="sbody"><b style="color:${CC.dv}">First burn Δv₁</b>
          <div class="sline">${mx(`${cv(CC.dv,'Δ'+I('v','1'))} = |${fk(v1)} − ${fk(vc1)}|`)}</div>
          <div class="sresult" style="color:${CC.dv}">= ${fk(dv1)} km/s</div>
        </div>
      </div>
      <div class="step">
        <div class="snum" style="color:${CC.t}">07</div>
        <div class="sbody"><b style="color:${CC.t}">Second burn Δv₂</b>
          <div class="sline">${mx(`${cv(CC.t,'Δ'+I('v','2'))} = |${fk(v2)} − ${fk(vc2)}|`)}</div>
          <div class="sresult" style="color:${CC.t}">= ${fk(dv2)} km/s</div>
        </div>
      </div>
      <div class="step">
        <div class="snum" style="color:${CC.t}">08</div>
        <div class="sbody"><b style="color:${CC.t}">Transfer time</b>
          <div class="sline">${mx(`${cv(CC.t,I('t','tr'))} = π${rad(`${cv(CC.a,f3(a_t))}³ / 4π²`)}`)}</div>
          <div class="sresult" style="color:${CC.t}">= ${tDays} days</div>
        </div>
      </div>
    </div>

    <div class="msec">
      <div class="msec-head"><span>Summary</span></div>
      <div class="scards">
        <div class="scard" style="border-left-color:${CC.dv}">
          <div class="sl">Δv₁ burn 1</div>
          <div class="sv" style="color:${CC.dv}">${fk(dv1)}<span class="su">km/s</span></div>
        </div>
        <div class="scard" style="border-left-color:${CC.t}">
          <div class="sl">Δv₂ burn 2</div>
          <div class="sv" style="color:${CC.t}">${fk(dv2)}<span class="su">km/s</span></div>
        </div>
        <div class="scard" style="border-left-color:${CC.r}">
          <div class="sl">Total Δv</div>
          <div class="sv" style="color:${CC.r}">${fk(dvTot)}<span class="su">km/s</span></div>
        </div>
        <div class="scard" style="border-left-color:${CC.v}">
          <div class="sl">Transfer time</div>
          <div class="sv" style="color:${CC.v}">${tDays}<span class="su">days</span></div>
        </div>
      </div>
    </div>`;
}

