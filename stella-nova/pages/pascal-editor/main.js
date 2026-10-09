// ============================================================================
//  PASCAL EDITOR  ·  pages/pascal-editor/main.js — the frame around the editor
// ----------------------------------------------------------------------------
//  The page shows the official hosted Pascal Editor (editor.pascal.app) in an
//  iframe. The open-source build is a Next.js server, so this static site
//  cannot host it (see the header of index.html). This module:
//    - sets the iframe source (APP) after the page loads
//    - writes the pinned open-source release (PIN) into the bar and credits
//    - opens and closes the credits panel
//    - shows the phone note once, and a hint if the frame stays blank
//    - unloads the iframe when the shell calls window.__snRelease
//  PIN is the release of @pascal-app/cli that "npx" runs on a local computer,
//  and the sha256 of its web runtime as GitHub publishes it. The hosted frame
//  is the live version, which Pascal updates, so the page cannot pin it.
//
//  grep -n targets
//    hosted URL ........... "const APP"
//    release pin .......... "const PIN"
//    phone note ........... "sn-pascal-note"
//    GPU release .......... "__snRelease"
// ============================================================================
export const APP = 'https://editor.pascal.app/';

export const PIN = {
  repo: 'pascalorg/editor',
  cli: '@pascal-app/cli',
  version: '1.0.3',
  tag: '@pascal-app/cli@1.0.3',
  asset: 'pascal-web-runtime-1.0.3.tar.gz',
  sha256: 'abd20f2b7f77f0b0f056a3f7a65ef63c65698284ea30607aa5d1a00cf83b37da',
  checked: '2026-10-09',
};

export const releaseUrl = p => `https://github.com/${p.repo}/releases/tag/${encodeURIComponent(p.tag)}`;

function boot() {
  const $ = id => document.getElementById(id);
  $('pe-ver').textContent = `hosted · OSS v${PIN.version}`;
  $('pe-cmd').textContent = `npx ${PIN.cli}@${PIN.version} editor`;
  $('pe-pin').innerHTML = `<a href="${releaseUrl(PIN)}" target="_blank" rel="noopener">${PIN.tag}</a>`
    + ` · <code>${PIN.asset}</code> · sha256 <code>${PIN.sha256}</code> (checked ${PIN.checked})`;

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

  // A cross-origin frame does not tell the parent if it failed. After 12 s
  // with no load event, show a link to open the editor in its own tab.
  const frame = $('pe-frame');
  let loaded = false;
  frame.addEventListener('load', () => { if (frame.src) loaded = true; });
  frame.src = APP;
  setTimeout(() => { if (!loaded) $('pe-msg').hidden = false; }, 12000);
}

const own = window.__snRelease;
window.__snRelease = function () {
  const f = document.getElementById('pe-frame');
  if (f) f.src = 'about:blank';
  if (own) own.apply(this, arguments);
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
