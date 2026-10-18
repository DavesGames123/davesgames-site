// ============================================================================
//  CORAL REEF  ·  crash.js  ·  the error box and the error handlers (DOM)
// ----------------------------------------------------------------------------
//  The user reported (2026-10-17): "https://davesgames.io/stella-nova/
//  #coral-reef crashed when i tried to load it". With no message on the
//  page, the user cannot tell what failed. This file shows a small box at
//  the bottom left with a title, the error text and a Copy button, so the
//  user can report it. The look is in ERR_CSS (a <style> that this file
//  adds, so the box works with no change to style.css).
//
//  mountErrorBox(doc) -> { show({ title, text, level }), hide(), count, last }
//      level 'error' (red edge) or 'note' (blue edge). A second show adds
//      the text under the first (at most 6 entries).
//  installErrorHandlers(win, box) -> uninstall()
//      window error and unhandledrejection go to the box. "Script error."
//      (a cross-origin script with no detail) and ResizeObserver notes do
//      not show.
//
//  grep -n targets: "export function mountErrorBox",
//  "export function installErrorHandlers"
// ============================================================================

export const ERR_CSS = `#errBox{position:fixed;left:14px;bottom:14px;z-index:58;width:min(460px,calc(100vw - 28px));max-height:min(46vh,360px);display:flex;flex-direction:column;
  background:rgba(14,6,10,0.96);border:1px solid rgba(255,120,120,0.55);border-left:4px solid #ff6b6b;border-radius:8px;color:var(--ink);font-size:0.76rem;box-shadow:0 6px 30px rgba(0,0,0,0.6)}
#errBox.note{border-color:rgba(127,224,207,0.45);border-left-color:var(--accent);background:rgba(3,18,27,0.96)}
#errBox .eb-head{display:flex;align-items:center;gap:8px;padding:8px 10px 6px}
#errBox .eb-t{flex:1;font-weight:600}
#errBox button{min-height:28px;padding:2px 10px;border:1px solid var(--line-b);border-radius:6px;background:rgba(6,32,44,0.8);color:var(--ink);cursor:pointer;font:inherit}
#errBox .eb-d{margin:0;padding:0 10px 10px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:0.7rem;line-height:1.45;color:#e9d6d6;user-select:text}
#errBox.note .eb-d{color:var(--dim)}
@media (pointer:coarse){#errBox{bottom:calc(76px + env(safe-area-inset-bottom,0px));font-size:0.78rem}#errBox button{min-height:44px;min-width:44px}#errBox .eb-d{font-size:0.72rem}}
html.sn-saver #errBox.note{display:none!important}`;

export function mountErrorBox(doc) {
  if (!doc.getElementById('errBoxCss')) {
    const st = doc.createElement('style'); st.id = 'errBoxCss'; st.textContent = ERR_CSS;
    (doc.head || doc.documentElement).appendChild(st);
  }
  let el = doc.getElementById('errBox');
  if (!el) {
    el = doc.createElement('div');
    el.id = 'errBox';
    el.setAttribute('role', 'alert');
    el.hidden = true;
    el.innerHTML = '<div class="eb-head"><b class="eb-t"></b><button type="button" class="eb-copy">Copy</button><button type="button" class="eb-x" aria-label="Close">×</button></div><pre class="eb-d"></pre>';
    (doc.body || doc.documentElement).appendChild(el);
  }
  const t = el.querySelector('.eb-t'), d = el.querySelector('.eb-d');
  const entries = [];
  el.querySelector('.eb-x').addEventListener('click', () => { el.hidden = true; });
  el.querySelector('.eb-copy').addEventListener('click', () => {
    const txt = `${t.textContent}\n${d.textContent}\n${(doc.defaultView && doc.defaultView.navigator && doc.defaultView.navigator.userAgent) || ''}`;
    try { doc.defaultView.navigator.clipboard.writeText(txt); el.querySelector('.eb-copy').textContent = 'Copied'; } catch (e) { /* no clipboard: the text is selectable */ }
  });
  const box = {
    el,
    get count() { return entries.length; },
    get last() { return entries[entries.length - 1] || null; },
    show({ title = 'Something went wrong', text = '', level = 'error' } = {}) {
      entries.push({ title, text, level });
      if (entries.length > 6) entries.shift();
      t.textContent = entries.length > 1 ? `${title} (${entries.length} messages)` : title;
      d.textContent = entries.map(e => (entries.length > 1 ? `· ${e.title}\n` : '') + e.text).join('\n\n').slice(0, 6000);
      el.classList.toggle('note', entries.every(e => e.level === 'note'));
      el.hidden = false;
    },
    hide() { el.hidden = true; },
  };
  return box;
}

const QUIET = /^Script error\.?$|ResizeObserver loop/;
export function installErrorHandlers(win, box) {
  const onErr = e => {
    const msg = String((e && e.message) || (e && e.error && e.error.message) || 'Error');
    if (QUIET.test(msg)) return;
    const where = e && e.filename ? `\n${String(e.filename).split('/').slice(-2).join('/')}:${e.lineno || 0}:${e.colno || 0}` : '';
    const stack = e && e.error && e.error.stack ? `\n${String(e.error.stack).split('\n').slice(0, 6).join('\n')}` : '';
    box.show({ title: 'The page hit an error', text: msg + where + stack });
  };
  const onRej = e => {
    const r = e && e.reason;
    const msg = String((r && (r.stack || r.message)) || r || 'a promise failed');
    if (QUIET.test(msg)) return;
    box.show({ title: 'A task of the page failed', text: msg.split('\n').slice(0, 7).join('\n') });
  };
  win.addEventListener('error', onErr);
  win.addEventListener('unhandledrejection', onRej);
  return () => { win.removeEventListener('error', onErr); win.removeEventListener('unhandledrejection', onRej); };
}
