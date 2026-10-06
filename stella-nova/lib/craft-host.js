// ============================================================================
//  CRAFT HOST  ·  lib/craft-host.js — show one hosted Crafting App
// ----------------------------------------------------------------------------
//  Each Craft Suite page (pages/<app>/index.html) is a frame around the
//  official web build of one app from github.com/storytold. The page sets
//  <body data-craft="<app id>">. This module reads the pin of that app from
//  vendor/craft/craft.lock.json and builds:
//    - a top bar: name, release tag, authors, source and release links
//    - a credits panel: licence, copyright, the zip and its sha256, and a
//      statement that the site did not write or change the app
//    - an iframe with vendor/craft/<dir>/index.html, the upstream build as
//      tools/craft-fetch.mjs unpacked it, with no change to any byte
//  The app id is the key in the pin file, so the next app needs only a new
//  pin and a page with a new data-craft value.
//
//  GPU release: lib/gpu-guard.js frees the GPU work of this document only.
//  The app makes its WebGPU device in the child iframe. The shell calls
//  window.__snRelease before it unloads the page, so this module wraps
//  __snRelease and also unloads the child iframe (about:blank).
//
//  grep -n targets
//    pin file path ........ "const LOCK"
//    top bar markup ....... "function bar"
//    credits markup ....... "function credits"
//    GPU release .......... "__snRelease"
// ============================================================================
const LOCK = new URL('../vendor/craft/craft.lock.json', import.meta.url);
const id = document.body.dataset.craft;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function links(a) {
  const repo = `https://github.com/${a.repo}`;
  return { repo, tree: `${repo}/tree/${a.tag}`, release: `${repo}/releases/tag/${a.tag}`,
    notice: `${repo}/blob/${a.tag}/NOTICE`, attribution: `${repo}/blob/${a.tag}/ATTRIBUTION.md` };
}

function bar(a, L, appUrl) {
  return `<header class="ch-bar">
  <span class="ch-name">${esc(a.name)}</span><span class="ch-ver">${esc(a.tag)}</span>
  <span class="ch-by">by the ArtCraft Team and contributors · ${esc(a.license)}</span>
  <nav class="ch-links">
    <a class="ch-wide" href="${L.tree}" target="_blank" rel="noopener">Source</a>
    <a class="ch-wide" href="${esc(a.site)}" target="_blank" rel="noopener">Website</a>
    <a class="ch-wide" href="${appUrl}" target="_blank" rel="noopener">Full window</a>
    <button class="ch-btn" type="button" aria-expanded="false" aria-controls="ch-credits">Credits</button>
  </nav>
</header>`;
}

function credits(a, L, base) {
  return `<section class="ch-credits" id="ch-credits" hidden>
  <p><strong>${esc(a.name)}</strong> is free, open-source software by the ArtCraft Team and the ${esc(a.name)} contributors. ${esc(a.copyright)}. It is licensed under the MIT License or the Apache License 2.0, at your option.</p>
  <p>This page runs the official web build from the ${esc(a.name)} GitHub release <a href="${L.release}" target="_blank" rel="noopener">${esc(a.tag)}</a>, unchanged, in your browser. davesgames.io did not write or change ${esc(a.name)}, and is not affiliated with or endorsed by the ArtCraft Team. Your files stay on your device.</p>
  <dl>
    <dt>App</dt><dd>${esc(a.kind)}</dd>
    <dt>Source</dt><dd><a href="${L.tree}" target="_blank" rel="noopener">${esc(a.repo)} @ ${esc(a.tag)}</a></dd>
    <dt>Website</dt><dd><a href="${esc(a.site)}" target="_blank" rel="noopener">${esc(a.site.replace(/^https:\/\//, ''))}</a></dd>
    <dt>Licence</dt><dd><a href="${base}LICENSE-MIT" target="_blank">MIT</a> or <a href="${base}LICENSE-APACHE" target="_blank">Apache-2.0</a> · <a href="${L.notice}" target="_blank" rel="noopener">NOTICE</a> · <a href="${L.attribution}" target="_blank" rel="noopener">third-party assets</a></dd>
    <dt>Build</dt><dd><code>${esc(a.asset)}</code> · sha256 <code>${esc(a.sha256)}</code></dd>
  </dl>
</section>
<div class="ch-note" id="ch-note">This app is made for a large screen with a mouse and keyboard.<button class="ch-btn" type="button">OK</button></div>`;
}

function stage(a, appUrl) {
  return `<main class="ch-stage"><iframe src="${appUrl}" title="${esc(a.name)}: ${esc(a.kind)}"
    allow="fullscreen; clipboard-read; clipboard-write"></iframe></main>`;
}

function fail(msg) {
  document.body.insertAdjacentHTML('beforeend', `<main class="ch-stage"><div class="ch-msg">${msg}</div></main>`);
}

async function boot() {
  let a;
  try { a = (await (await fetch(LOCK)).json()).apps[id]; } catch { a = null; }
  if (!a) { fail(`No pin for <code>${esc(id)}</code> in vendor/craft/craft.lock.json.`); return; }
  const base = new URL(`../vendor/craft/${a.dir}/`, import.meta.url).href;
  const appUrl = base + 'index.html';
  const L = links(a);
  document.title = `${a.name} // Stella Nova · davesgames.io`;
  document.body.insertAdjacentHTML('beforeend', bar(a, L, appUrl) + credits(a, L, base));
  // A local clone has no build until tools/craft-fetch.mjs runs.
  const ok = await fetch(appUrl, { method: 'HEAD', cache: 'no-store' }).then(r => r.ok, () => false);
  if (!ok) fail(`The ${esc(a.name)} build is not on this server. From the repo root, run <code>node tools/craft-fetch.mjs</code>.`);
  else document.body.insertAdjacentHTML('beforeend', stage(a, appUrl));

  const btn = document.querySelector('.ch-bar .ch-btn');
  const panel = document.getElementById('ch-credits');
  btn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    btn.setAttribute('aria-expanded', String(!panel.hidden));
  });
  const note = document.getElementById('ch-note');
  let seen = false;
  try { seen = localStorage.getItem('sn-craft-note') === '1'; } catch { /* storage blocked */ }
  if (seen) note.hidden = true;
  note.querySelector('button').addEventListener('click', () => {
    note.hidden = true;
    try { localStorage.setItem('sn-craft-note', '1'); } catch { /* storage blocked */ }
  });
}

const own = window.__snRelease;
window.__snRelease = function () {
  const f = document.querySelector('.ch-stage iframe');
  if (f) { try { f.contentWindow.location.replace('about:blank'); } catch { f.src = 'about:blank'; } }
  if (own) own.apply(this, arguments);
};

window.__craft = { id, ready: boot() };
