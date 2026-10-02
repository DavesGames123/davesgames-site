// ============================================================================
//  TWENTY TO FOUR  ·  equation column builder
// ----------------------------------------------------------------------------
//  Builds the equation column from window.T24 (equations.js, MathJax SVG
//  made by typeset.mjs). Each concept block shows its name and a plain line,
//  Maxwell's scalar lines (numbered 01 to 20), and the folded Heaviside
//  vector form with a note. The 20 / 4 switch folds the scalar lines away,
//  and the tick strip shows the twenty lines gather into four groups.
//
//  A scalar line drives the canvas overlay through window.__setOverlay
//  (main.js): a mouse lights it while it hovers, a tap pins it until the
//  next tap. Self-invoking; it does nothing if equations.js did not load.
//
//  BLOCK STRUCTURE   (per concept)
//  --------------------------------------------------------------------------
//      section.concept[data-role]  --cc = the concept colour
//        header      numeral, name, tag, plain line
//        .fold       Maxwell source tag + ol.lines (one li per scalar line)
//        .result     "Heaviside 1884" kick, the vector form, the note
//
//  SECTION MAP   (jump with grep -n "<anchor>" concepts.js)
//  --------------------------------------------------------------------------
//      colours ............. "const CC"            concept colour tokens
//      block build ......... "function block"      one concept block
//      tick strip .......... "function ticks"      20 ticks, grouped
//      the four ............ "function four"       the summary grid
//      20 / 4 switch ....... "window.eqView"       fold the scalar lines
//      hover and tap ....... "function light"      line -> canvas overlay
//      label symbols ....... "data-sym"            T24.sym into the labels
// ============================================================================
(function(){
  const T=window.T24; if(!T) return;
  const scroll=document.getElementById('eq-scroll');
  // Concept colour per block, as CSS tokens (style.css :root).
  // The four take the color of their main symbol: E, B, A and J.
  const CC={gaussE:'var(--e)',gaussB:'var(--b)',faraday:'var(--a)',ampere:'var(--j)',const:'var(--dim)',contin:'var(--dim)'};
  const pad=n=>String(n).padStart(2,'0');
  const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  // One concept block: the head, the foldable scalar lines, the result.
  function block(c){
    const s=document.createElement('section');
    s.className='concept';s.dataset.role=c.role;s.dataset.key=c.key;s.style.setProperty('--cc',CC[c.key]||'var(--dim)');
    const badge=c.numeral?`<span class="num">${c.numeral}</span>`:`<span class="num num-tag">${esc(c.tag)}</span>`;
    s.innerHTML=
      `<header class="c-head">${badge}<div><h3>${esc(c.name)}${c.numeral?` <span class="tag">${esc(c.tag)}</span>`:''}</h3><p class="plain">${esc(c.plain)}</p></div></header>`+
      `<div class="fold"><div class="fold-in"><div class="src">Maxwell 1865 · ${esc(c.src)}</div><ol class="lines">`+
      c.lines.map(l=>`<li data-ov="${l.ov}" tabindex="0"><span class="ln">${pad(l.n)}</span><span class="m">${l.svg}</span></li>`).join('')+
      `</ol></div></div>`+
      `<div class="result"><span class="kick">${c.role==='core'?'Heaviside 1884':c.role==='aside'?'In vector form':'Not an independent law'}</span>`+
      `<div class="heav">${c.heav}</div><p class="note">${c.note}</p></div>`;
    return s;
  }
  // The tick strip: one tick per scalar line, coloured by its concept. In the
  // 4 view the ticks of each core block close up, and the rest fade.
  function ticks(){
    const el=document.getElementById('ticks'); if(!el) return;
    el.innerHTML=T.concepts.map(c=>`<span class="tg" data-role="${c.role}" style="--cc:${CC[c.key]}">`+
      c.lines.map(()=>'<i></i>').join('')+'</span>').join('');
  }
  // The four that remain, as a 2 x 2 grid.
  function four(){
    const f=document.createElement('section');f.className='four';
    f.innerHTML='<h2>The four that remain</h2><div class="four-grid">'+
      T.four.map((q,i)=>`<div class="q" style="--cc:${CC[T.concepts[i].key]}"><span class="num">${q.numeral}</span><span class="qn">${esc(q.name)}</span><div class="qm">${q.svg}</div></div>`).join('')+
      '</div><p class="foot">Light needs only these four: a changing E makes a curling B, a changing B makes a curling E, and the pair carries itself away at c.</p>';
    return f;
  }
  // Label symbols: each [data-sym] element gets its MathJax SVG from T24.sym.
  if(T.sym) document.querySelectorAll('[data-sym]').forEach(el=>{const v=T.sym[el.dataset.sym]; if(v) el.innerHTML=v;});
  T.concepts.forEach(c=>scroll.appendChild(block(c)));
  scroll.appendChild(four());
  ticks();

  // The 20 / 4 switch: fold the scalar lines away (CSS animates .fold).
  window.eqView=function(n){
    const p=document.getElementById('eqpanel');
    p.classList.toggle('collapsed',n===4);
    document.getElementById('vw-20').classList.toggle('on',n!==4);
    document.getElementById('vw-4').classList.toggle('on',n===4);
    if(n===4) light(null);
  };

  // Hover and tap. light(row) marks one line and its block and sets the canvas
  // overlay; light(null) clears both. A tap pins a line until the next tap.
  let pinned=null;
  function light(row){
    scroll.querySelectorAll('.lines li.lit').forEach(r=>r.classList.remove('lit'));
    scroll.querySelectorAll('.concept.hot').forEach(b=>b.classList.remove('hot'));
    if(row){row.classList.add('lit');row.closest('.concept').classList.add('hot');}
    window.__setOverlay&&window.__setOverlay(row?row.dataset.ov:null);
  }
  scroll.querySelectorAll('.lines li').forEach(row=>{
    row.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'&&!pinned)light(row);});
    row.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'&&!pinned)light(null);});
    row.addEventListener('click',()=>{pinned=pinned===row?null:row;light(pinned);});
    row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();row.click();}});
  });
})();
