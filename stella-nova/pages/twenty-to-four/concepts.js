(function(){
  if(!window.katex) return;
  const E='#ffc832',B='#60e0ee',A='#c890ff',J='#ffb84d',op='#96c8ff',rho='#ff9050',mu='#7fd6a0',phi='#c890ff';
  const ro={throwOnError:false,displayMode:false};
  const R=(tex,el)=>el&&katex.render(tex,el,ro);
  const S=String.raw;

  // concepts: destination-grouped — how the 20 collapse into the 4 (+ what falls away)
  const concepts=[
    {color:E, role:'CORE', name:'Gauss · electric', grp:'G · free charge   ·   E · elasticity',
     lines:[
       {tex:S`\partial_x \textcolor{${E}}{D_x}+\partial_y \textcolor{${E}}{D_y}+\partial_z \textcolor{${E}}{D_z}=\textcolor{${rho}}{\rho}`, ov:'divE'},
       {tex:S`\textcolor{${E}}{D_x}=\varepsilon \textcolor{${E}}{E_x}`, ov:'Ex'},
       {tex:S`\textcolor{${E}}{D_y}=\varepsilon \textcolor{${E}}{E_y}`, ov:'Ey'},
       {tex:S`\textcolor{${E}}{D_z}=\varepsilon \textcolor{${E}}{E_z}`, ov:'zero'},
     ],
     heav:S`\textcolor{${op}}{\nabla}\cdot\textcolor{${E}}{\vec{E}}=\dfrac{\textcolor{${rho}}{\rho}}{\varepsilon_0}`,
     note:S`Substitute <b>D = εE</b>, and the three separate \(\partial_i D_i\) terms fold into one <b>divergence</b>.`},

    {color:B, role:'CORE', name:'Gauss · magnetic', grp:'B · field from the vector potential',
     lines:[
       {tex:S`\textcolor{${B}}{B_x}=\partial_y \textcolor{${A}}{A_z}-\partial_z \textcolor{${A}}{A_y}`, ov:'zero'},
       {tex:S`\textcolor{${B}}{B_y}=\partial_z \textcolor{${A}}{A_x}-\partial_x \textcolor{${A}}{A_z}`, ov:'zero'},
       {tex:S`\textcolor{${B}}{B_z}=\partial_x \textcolor{${A}}{A_y}-\partial_y \textcolor{${A}}{A_x}`, ov:'Bz'},
     ],
     heav:S`\textcolor{${op}}{\nabla}\cdot\textcolor{${B}}{\vec{B}}=0`,
     note:S`Because <b>B = ∇×A</b>, the identity \(\nabla\!\cdot\!(\nabla\times\vec A)=0\) makes this <b>true for free</b> — no measured law required.`},

    {color:'#ffb84d', role:'CORE', name:'Faraday · induction', grp:'D · electromotive force',
     lines:[
       {tex:S`\textcolor{${E}}{E_x}=\mu(v_y \textcolor{${B}}{H_z}-v_z \textcolor{${B}}{H_y})-\partial_t \textcolor{${A}}{A_x}-\partial_x \textcolor{${phi}}{\varphi}`, ov:'Ex'},
       {tex:S`\textcolor{${E}}{E_y}=\mu(v_z \textcolor{${B}}{H_x}-v_x \textcolor{${B}}{H_z})-\partial_t \textcolor{${A}}{A_y}-\partial_y \textcolor{${phi}}{\varphi}`, ov:'Ey'},
       {tex:S`\textcolor{${E}}{E_z}=\mu(v_x \textcolor{${B}}{H_y}-v_y \textcolor{${B}}{H_x})-\partial_t \textcolor{${A}}{A_z}-\partial_z \textcolor{${phi}}{\varphi}`, ov:'zero'},
     ],
     heav:S`\textcolor{${op}}{\nabla}\times\textcolor{${E}}{\vec{E}}=-\dfrac{\partial\textcolor{${B}}{\vec{B}}}{\partial t}`,
     note:S`Drop the motional term and take the <b>curl</b>: \(\nabla\times(-\partial_t\vec A)=-\partial_t(\nabla\times\vec A)=-\partial_t\vec B\).`},

    {color:'#64c864', role:'CORE', name:'Ampère · Maxwell', grp:'C · circuital law   ·   A · total current',
     lines:[
       {tex:S`\partial_y \textcolor{${B}}{H_z}-\partial_z \textcolor{${B}}{H_y}=\textcolor{${J}}{J'_x}`, ov:'curlHx'},
       {tex:S`\partial_z \textcolor{${B}}{H_x}-\partial_x \textcolor{${B}}{H_z}=\textcolor{${J}}{J'_y}`, ov:'curlHy'},
       {tex:S`\partial_x \textcolor{${B}}{H_y}-\partial_y \textcolor{${B}}{H_x}=\textcolor{${J}}{J'_z}`, ov:'zero'},
       {tex:S`\textcolor{${J}}{J'_x}=\textcolor{${J}}{J_x}+\partial_t \textcolor{${E}}{D_x}`, ov:'dExdt'},
       {tex:S`\textcolor{${J}}{J'_y}=\textcolor{${J}}{J_y}+\partial_t \textcolor{${E}}{D_y}`, ov:'dEydt'},
       {tex:S`\textcolor{${J}}{J'_z}=\textcolor{${J}}{J_z}+\partial_t \textcolor{${E}}{D_z}`, ov:'zero'},
     ],
     heav:S`\textcolor{${op}}{\nabla}\times\textcolor{${B}}{\vec{B}}=\mu_0\textcolor{${J}}{\vec{J}}+\textcolor{${mu}}{\mu_0\varepsilon_0\dfrac{\partial\textcolor{${E}}{\vec{E}}}{\partial t}}`,
     note:S`The curl of H is the <b>total</b> current. Its \(\partial D/\partial t\) half is Maxwell's <b>displacement current</b> — the term that lets the loops on the canvas detach and fly off as light.`},

    {color:'#7a8aa0', role:'SET ASIDE', name:'Constitutive', grp:"F · Ohm's law   ·   E · elasticity",
     lines:[
       {tex:S`\textcolor{${J}}{J_x}=\sigma \textcolor{${E}}{E_x}`, ov:'Ex'},
       {tex:S`\textcolor{${J}}{J_y}=\sigma \textcolor{${E}}{E_y}`, ov:'Ey'},
       {tex:S`\textcolor{${J}}{J_z}=\sigma \textcolor{${E}}{E_z}`, ov:'zero'},
     ],
     heavText:S`\(\vec J=\sigma\vec E,\;\; \vec D=\varepsilon\vec E\) — material relations. They describe the <b>medium</b>, not the field, so they sit outside the famous four.`,
     note:''},

    {color:'#7a8aa0', role:'REDUNDANT', name:'Continuity', grp:'H · conservation of charge',
     lines:[
       {tex:S`\partial_x \textcolor{${J}}{J_x}+\partial_y \textcolor{${J}}{J_y}+\partial_z \textcolor{${J}}{J_z}+\partial_t \textcolor{${rho}}{\rho}=0`, ov:'zero'},
     ],
     heavText:S`Not an independent law — it <b>follows automatically</b> from \(\nabla\!\cdot\!(\nabla\times\vec B)=0\) applied to Ampère–Maxwell.`,
     note:''},
  ];

  const scroll=document.getElementById('eq-scroll');
  concepts.forEach((c,ci)=>{
    const block=document.createElement('div');block.className='concept';block.style.setProperty('--cc',c.color);
    const dim=c.role!=='CORE'?' dim':'';
    block.innerHTML=
      `<div class="concept-head"><span class="badge${dim}">${c.role}</span><span class="cname">${c.name}</span></div>`;
    const body=document.createElement('div');body.className='concept-body';
    // Maxwell column
    const mw=document.createElement('div');mw.className='mw-col';
    mw.innerHTML=`<div class="mw-grp">${c.grp}</div>`;
    c.lines.forEach((ln,li)=>{
      const row=document.createElement('div');row.className='mw-line';row.dataset.ov=ln.ov;row.dataset.ci=ci;
      const span=document.createElement('span');R(ln.tex,span);row.appendChild(span);
      mw.appendChild(row);
    });
    body.appendChild(mw);
    // arrow
    const arr=document.createElement('div');arr.className='arrow-col';arr.textContent='→';body.appendChild(arr);
    // Heaviside column
    const hv=document.createElement('div');hv.className='hv-col';
    if(c.heav){const eq=document.createElement('div');eq.className='hv-eq';R(c.heav,eq);hv.appendChild(eq);}
    if(c.heavText){const t=document.createElement('div');t.className='hv-text';t.innerHTML=c.heavText;hv.appendChild(t);renderInlineKatex(t);}
    if(c.note){const n=document.createElement('div');n.className='hv-note';n.innerHTML=c.note;hv.appendChild(n);renderInlineKatex(n);}
    body.appendChild(hv);
    block.appendChild(body);
    scroll.appendChild(block);
  });

  // summary
  const sm=document.createElement('div');sm.className='summary';
  sm.innerHTML=`<h3>The four that remain</h3>`;
  [S`\textcolor{${op}}{\nabla}\cdot\textcolor{${E}}{\vec E}=\rho/\varepsilon_0`,
   S`\textcolor{${op}}{\nabla}\cdot\textcolor{${B}}{\vec B}=0`,
   S`\textcolor{${op}}{\nabla}\times\textcolor{${E}}{\vec E}=-\partial_t\textcolor{${B}}{\vec B}`,
   S`\textcolor{${op}}{\nabla}\times\textcolor{${B}}{\vec B}=\mu_0\vec J+\mu_0\varepsilon_0\,\partial_t\textcolor{${E}}{\vec E}`
  ].forEach(t=>{const d=document.createElement('div');d.className='seq';R(t,d);sm.appendChild(d);});
  scroll.appendChild(sm);

  // render \( \) inline katex inside note/text html
  function renderInlineKatex(el){
    el.innerHTML=el.innerHTML.replace(/\\\((.+?)\\\)/g,(m,tex)=>{
      try{return katex.renderToString(tex,{throwOnError:false,displayMode:false});}catch(e){return m;}
    });
  }

  // hover → drive canvas overlay (functions defined in sim script via window)
  scroll.querySelectorAll('.mw-line').forEach(row=>{
    row.addEventListener('pointerenter',()=>{
      row.classList.add('lit');
      const block=row.closest('.concept'); if(block) block.classList.add('hot');
      window.__setOverlay && window.__setOverlay(row.dataset.ov);
    });
    row.addEventListener('pointerleave',()=>{
      row.classList.remove('lit');
      const block=row.closest('.concept'); if(block) block.classList.remove('hot');
      window.__setOverlay && window.__setOverlay(null);
    });
  });
})();
