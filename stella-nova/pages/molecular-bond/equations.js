// ============================================================================
//  equations.js · rendered reference equations + mobile drawer toggles
// ----------------------------------------------------------------------------
//  A classic script loaded before main.js. It typesets the molecular-orbital
//  equations ([data-tex] in the panel) and the control label symbols
//  ([data-sym]) as MathJax SVG through lib/sci-math.js, with one math color
//  class per quantity. It also defines the mobile drawer open/close helpers
//  used by the inline onclick handlers in index.html.
//
//  SECTION MAP  (jump with grep -n "<anchor>" equations.js)
//      color rules .......... "const RULES"        symbol -> .mN class
//      equation render ...... "typesetAll"         MathJax SVG into [data-tex]
//      panel collapse ....... "eqCollapseBtn"      show/hide the equation panel
//      drawer toggles ....... "function toggleDrawer"  mobile side panels
// ============================================================================
// Typeset the equations. A classic script cannot use a static import, so
// lib/sci-math.js comes in by dynamic import. If it fails, the TeX stays.
(function(){
  // One class per quantity (lib/sci.css colors .m1 to .m6). The control
  // labels R and E_total carry the same class in index.html.
  //   m3  wavefunctions psi_+-, phi_A, phi_B, phi_nlm    m2  nuclear charge Z
  //   m1  bond length R                                  m4  overlap S
  //   m5  energy E_+, E_total                            m6  integrals J, K
  // R is written as \class{m1}{R} in the TeX, because a rule for R would
  // also color the radial function R_nl.
  const RULES=[['\\psi_\\pm','m3'],['\\varphi_A','m3'],['\\varphi_B','m3'],['\\varphi_{n\\ell m}','m3'],
    ['Z','m2'],['S','m4'],['E_+','m5'],['J','m6'],['K','m6']];
  const panel=document.getElementById('eqPanel');
  import('../../lib/sci-math.js').then(M=>{
    M.typesetAll(panel,RULES);
    for(const el of document.querySelectorAll('[data-sym]')) M.typeset(el,el.dataset.sym,{display:false,rules:RULES});
  }).catch(()=>{});

  // Collapse toggle: fold the equation panel. The word says what the next
  // click does.
  const btn=document.getElementById('eqCollapseBtn');
  btn.addEventListener('click',()=>{
    const c=panel.classList.toggle('collapsed');
    btn.textContent=c?'Show':'Hide';
    btn.title=c?'Expand':'Collapse';
  });
})();

// Drawer toggles (mobile)
// Open or close one side drawer (a or b), closing the other first so only one
// is open at a time, and toggle the shared backdrop.
function toggleDrawer(which){
  const p=document.getElementById('panel-'+which);
  const fab=document.getElementById('fab'+which.toUpperCase());
  const bd=document.getElementById('drawerBackdrop');
  // Close the other drawer first
  const other=which==='a'?'b':'a';
  document.getElementById('panel-'+other).classList.remove('open');
  document.getElementById('fab'+other.toUpperCase()).classList.remove('open');
  const open=!p.classList.contains('open');
  p.classList.toggle('open',open);
  fab.classList.toggle('open',open);
  bd.classList.toggle('show',open);
}
// Force both drawers and the backdrop closed (used after loading a preset).
function closeDrawers(){
  document.getElementById('panel-a').classList.remove('open');
  document.getElementById('panel-b').classList.remove('open');
  document.getElementById('fabA').classList.remove('open');
  document.getElementById('fabB').classList.remove('open');
  document.getElementById('drawerBackdrop').classList.remove('show');
}
