// ============================================================================
//  PASCAL EDITOR  ·  pages/pascal-editor/main.js — the page around the editor
// ----------------------------------------------------------------------------
//  The page shows our static build of Pascal Editor (app/index.html, made by
//  build.sh from the pinned upstream commit) in a same-origin iframe. This
//  module:
//    - sets the iframe source (APP) after the page loads
//    - writes the pinned commit (PIN) into the bar and credits
//    - opens and closes the credits panel
//    - shows the phone note once, and a hint if the editor does not start
//    - unloads the iframe when the shell calls window.__snRelease
//  PIN.sha must be the same as PIN_SHA in build.sh and the commit line in
//  app/BUILD.txt. tests.mjs checks this.
//
//  grep -n targets
//    app entry ............ "const APP"
//    pinned commit ........ "const PIN"
//    phone note ........... "sn-pascal-note"
//    GPU release .......... "__snRelease"
// ============================================================================
export const APP = 'app/index.html';

export const PIN = {
  repo: 'pascalorg/editor',
  tag: '@pascal-app/editor@1.0.4',
  version: '1.0.4',
  sha: 'bccd365bbb54d33afd78b67f14579b9fda3a14e1',
  built: '2026-10-13',
};

export const commitUrl = p => `https://github.com/${p.repo}/commit/${p.sha}`;

function boot() {
  const $ = id => document.getElementById(id);
  $('pe-ver').textContent = `v${PIN.version}`;
  $('pe-pin').innerHTML = `<a href="${commitUrl(PIN)}" target="_blank" rel="noopener">${PIN.repo} ${PIN.sha.slice(0, 12)}</a>`
    + ` · <code>${PIN.tag}</code> · built ${PIN.built}`;

  const btn = document.querySelector('.pe-bar .pe-btn');
  const panel = $('pe-credits');
  btn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    btn.setAttribute('aria-expanded', String(!panel.hidden));
  });

  const note = $('pe-note');
  let seen = false;
  try { seen = localStorage.getItem('sn-pascal-note') === '1'; } catch { /* storage blocked */ }
  if (seen) note.hidden = true;
  note.querySelector('button').addEventListener('click', () => {
    note.hidden = true;
    try { localStorage.setItem('sn-pascal-note', '1'); } catch { /* storage blocked */ }
  });

  // The frame is same-origin, so the page can see if the editor mounted.
  // After 20 s with an empty #root, show the hint.
  const frame = $('pe-frame');
  frame.src = APP;
  setTimeout(() => {
    let mounted = false;
    try { mounted = !!frame.contentDocument?.querySelector('#root > *'); } catch { /* not readable */ }
    if (!mounted && frame.src) $('pe-msg').hidden = false;
  }, 20000);
}

const own = window.__snRelease;
window.__snRelease = function () {
  const f = document.getElementById('pe-frame');
  if (f) f.src = 'about:blank';
  if (own) own.apply(this, arguments);
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
