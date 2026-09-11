/* ═════════════════════════════════════════════════════════════
   MATH PANEL RENDERING (live values, color-coded variable names)
   ═════════════════════════════════════════════════════════════ */
// Render a LaTeX string to HTML, falling back to a code span on error.
function K(s,d=false){
  try{return katex.renderToString(s,{throwOnError:false,displayMode:d})}
  catch(e){return`<code>${s}</code>`}
}
// Number formatters: 3 and 4 decimals; fk converts AU/yr to km/s; fD to days.
const f3=v=>v.toFixed(3), f4=v=>v.toFixed(4);
const fk=v=>(v*AU2KMS).toFixed(3);
const fD=yr=>(yr*365.25).toFixed(0);

// Colour code for each variable, matching the KaTeX reference (katex.js).
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
  const rows=hopLog.length===0
    ? `<div style="font-size:11px;color:var(--text-faint);padding:8px 0;text-align:center">No hops yet</div>`
    : hopLog.map((h,i)=>`
      <div style="display:flex;align-items:center;gap:9px;padding:6px 0;border-bottom:1px solid rgba(22,34,64,0.4)">
        <div style="font-size:10.5px;color:var(--text-faint);min-width:18px;font-weight:700">${i+1}</div>
        <div style="flex:1;font-size:11.5px;line-height:1.5">
          <span style="color:${h.fromColor};font-weight:600">${h.from}</span>
          <span style="color:var(--text-faint)"> → </span>
          <span style="color:${h.toColor};font-weight:600">${h.to}</span>
          <span style="color:var(--text-faint);font-size:10px;margin-left:4px">${(h.dvTot*AU2KMS).toFixed(2)} km/s</span>
        </div>
        <div style="font-size:15px;font-weight:700;font-family:'Cormorant Garamond',serif;color:${h.color||gradeColors[h.grade]||'#c8d0e0'}">${h.grade}</div>
      </div>`).join('');
  return `
    <div class="msec" style="background:rgba(122,216,122,0.04);border-left:3px solid rgba(122,216,122,0.35)">
      <div class="msec-head">
        <span style="color:#7ad87a">⬡ Hop Log</span>
        <span class="mh-tag">${hopLog.length} HOPS${hopLog.length>0?' · '+totalDv+' km/s':''}</span>
      </div>
      ${rows}
      ${hopLog.length>0?`
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px">
        <div class="scard" style="border-left:3px solid rgba(122,216,122,0.55)">
          <div class="sl">Total Δv</div>
          <div class="sv" style="color:#7ad87a;font-size:14px">${totalDv}<span class="su">km/s</span></div>
        </div>
        <div class="scard" style="border-left:3px solid rgba(122,216,122,0.55)">
          <div class="sl">Best grade</div>
          <div class="sv" style="color:${gradeColors[hopLog.reduce((b,h)=>{const gi=g=>Object.keys(gradeColors).indexOf(g);return gi(h.grade)<gi(b)?h.grade:b;},hopLog[0].grade)]||'#c8d0e0'};font-size:14px;font-family:'Cormorant Garamond',serif">${hopLog.reduce((b,h)=>{const gi=g=>Object.keys(gradeColors).indexOf(g);return gi(h.grade)<gi(b)?h.grade:b;},hopLog[0].grade)}</div>
        </div>
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
        <div class="msec-head"><span>Getting Started</span><span class="mh-tag">SELECT.A.PLANET</span></div>
        <div class="ph">
          <span class="ic">Orbital Mechanics</span>
          ${hopMode
            ?'Select your home planet to park your spacecraft there. Then pick any destination and launch repeated transfers in a chain.'
            :'Click any planet to set the source orbit, then click another to compute the Hohmann transfer and reveal the launch windows.'}
        </div>
      </div>
      <div class="msec">
        <div class="msec-head"><span>What this calculator does</span></div>
        <div style="font-size:11.5px;color:var(--text-dim);line-height:1.7">
          A <b style="color:var(--text-bright)">Hohmann transfer</b> is the lowest-fuel route between two circular coplanar orbits. The spacecraft burns once to enter an elliptical transfer orbit tangent to both circles, coasts, then burns again to circularise at the target.
          <br><br>
          The floating panel above shows the five equations that fully describe the maneuver. After you pick a source and target, this panel fills with the live computed values, the three nearest launch windows, and an eight-step walkthrough of the math.
        </div>
      </div>`;
    return;
  }

  // Stage 2: source picked, no target; show the source orbit and its v_c1.
  if(!target){
    el.innerHTML=hopLogHTML()+`
      <div class="msec">
        <div class="msec-head"><span>Selected Orbit</span></div>
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
        <div style="padding:6px 0;overflow-x:auto">${K(`\\textcolor{${CC.v}}{v_{c1}}=\\sqrt{4\\pi^2/\\textcolor{${CC.r}}{${f3(source.r)}}}=${f4(source.speed)}\\;\\text{AU/yr}`,true)}</div>
        <div style="font-size:12px;color:${CC.v};margin-top:5px;font-weight:700">= ${fk(source.speed)} km/s</div>
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
      <div class="msec-head"><span>Selected Orbits</span><span class="mh-tag">${asc?'↑ ASCENDING':'↓ DESCENDING'}</span></div>
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
      <div class="msec-head"><span>Launch Windows</span><span class="mh-tag">PHASE.ALIGN</span></div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:7px;line-height:1.7">
        Required target lead angle: ${K(`\\textcolor{${CC.phi}}{\\varphi_{\\text{req}}} = ${phi_deg}^\\circ`)}
      </div>
      <div class="wcards">${wHTML}</div>
    </div>

    <div class="msec">
      <div class="msec-head"><span>Step by Step</span><span class="mh-tag">HOHMANN.CALC</span></div>
      <div class="step">
        <div class="snum">01</div>
        <div class="sbody"><b>Transfer semi-major axis</b>
          <div style="overflow-x:auto;margin:4px 0">${K(`\\textcolor{${CC.a}}{a_t}=\\tfrac{\\textcolor{${CC.r}}{${f3(r1)}}+\\textcolor{${CC.r}}{${f3(r2)}}}{2}=${f3(a_t)}\\;\\text{AU}`)}</div>
        </div>
      </div>
      <div class="step">
        <div class="snum">02</div>
        <div class="sbody"><b>Ellipse geometry</b>
          <div style="overflow-x:auto;margin:4px 0">${K(`c_t=${f3(c_t)},\\;b_t=${f3(b_t)},\\;e=${e_t.toFixed(4)}`)}</div>
        </div>
      </div>
      <div class="step">
        <div class="snum">03</div>
        <div class="sbody"><b>Circular speeds</b>
          <div style="overflow-x:auto;margin:4px 0">${K(`\\textcolor{${CC.v}}{v_{c1}}=${fk(vc1)}\\;\\text{km/s},\\;\\textcolor{${CC.v}}{v_{c2}}=${fk(vc2)}\\;\\text{km/s}`)}</div>
        </div>
      </div>
      <div class="step">
        <div class="snum">04</div>
        <div class="sbody"><b>Vis-viva at <span style="color:${CC.r}">r₁</span> on transfer</b>
          <div style="overflow-x:auto;margin:4px 0">${K(`\\textcolor{${CC.v}}{v_1}=\\sqrt{4\\pi^2\\!\\left(\\tfrac{2}{\\textcolor{${CC.r}}{${f3(r1)}}}-\\tfrac{1}{\\textcolor{${CC.a}}{${f3(a_t)}}}\\right)}`)}</div>
          <div class="sresult" style="color:${CC.v}">= ${fk(v1)} km/s</div>
        </div>
      </div>
      <div class="step">
        <div class="snum">05</div>
        <div class="sbody"><b>Vis-viva at <span style="color:${CC.r}">r₂</span> on transfer</b>
          <div style="overflow-x:auto;margin:4px 0">${K(`\\textcolor{${CC.v}}{v_2}=\\sqrt{4\\pi^2\\!\\left(\\tfrac{2}{\\textcolor{${CC.r}}{${f3(r2)}}}-\\tfrac{1}{\\textcolor{${CC.a}}{${f3(a_t)}}}\\right)}`)}</div>
          <div class="sresult" style="color:${CC.v}">= ${fk(v2)} km/s</div>
        </div>
      </div>
      <div class="step">
        <div class="snum" style="color:${CC.dv}">06</div>
        <div class="sbody"><b style="color:${CC.dv}">First burn Δv₁</b>
          <div style="overflow-x:auto;margin:4px 0">${K(`\\textcolor{${CC.dv}}{\\Delta v_1}=|${fk(v1)}-${fk(vc1)}|`)}</div>
          <div class="sresult" style="color:${CC.dv}">= ${fk(dv1)} km/s</div>
        </div>
      </div>
      <div class="step">
        <div class="snum" style="color:${CC.t}">07</div>
        <div class="sbody"><b style="color:${CC.t}">Second burn Δv₂</b>
          <div style="overflow-x:auto;margin:4px 0">${K(`\\textcolor{${CC.t}}{\\Delta v_2}=|${fk(v2)}-${fk(vc2)}|`)}</div>
          <div class="sresult" style="color:${CC.t}">= ${fk(dv2)} km/s</div>
        </div>
      </div>
      <div class="step">
        <div class="snum" style="color:${CC.t}">08</div>
        <div class="sbody"><b style="color:${CC.t}">Transfer time</b>
          <div style="overflow-x:auto;margin:4px 0">${K(`\\textcolor{${CC.t}}{t_{tr}}=\\pi\\sqrt{\\textcolor{${CC.a}}{${f3(a_t)}}^3/4\\pi^2}`)}</div>
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

