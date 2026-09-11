// HUD helpers: set the topbar status message.
function setStatus(m){document.getElementById('smsg').textContent=m}
// Enable or disable the Launch button.
function setBtnLaunch(v){document.getElementById('btnLaunch').disabled=!v}
// Switch the floating equation panel between LIVE and REFERENCE styling.
function setEqPanelActive(active){
  document.getElementById('eqPanel').classList.toggle('active',active);
  document.getElementById('eqState').textContent=active?'LIVE':'REFERENCE';
}
// Show or hide the transient banner over the canvas (green when a leg finishes).
function setTbar(show,msg='',green){
  const el=document.getElementById('tbar');
  if(show){
    el.textContent=msg;
    el.classList.add('show');
    el.classList.toggle('go',!!green);
  } else el.classList.remove('show');
}

/* INIT */
// Load the random system as the default and start the render loop.
loadPreset('random', document.querySelector('.pcard[data-preset="random"]'));
requestAnimationFrame(frame);
