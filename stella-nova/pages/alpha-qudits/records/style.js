// ============================================================================
//  ALPHA QUDITS  ·  records/style.js  ·  the CSS of the RECORDS figure shell
// ----------------------------------------------------------------------------
//  index.js injects this once as <style id="records-css">. Every rule is
//  under .rec-fig, so it cannot change CORE's layout. Buttons are 44 px
//  targets. Sentence-case labels; no uppercase, no letter-spacing.
// ============================================================================
export const CSS = `
.rec-fig{position:relative;width:100%;max-width:100%;color:#e8eef0;font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
.rec-fig [hidden]{display:none!important}
.rec-fig .rec-canvas{position:relative;width:100%;line-height:0}
.rec-fig canvas{display:block;width:100%;touch-action:pan-y;-webkit-tap-highlight-color:transparent;border-radius:10px;background:radial-gradient(120% 90% at 50% 15%,rgba(134,220,124,0.05),rgba(0,0,0,0) 60%)}
.rec-fig.rec-fill{height:100%}
.rec-fig.rec-fill .rec-canvas,.rec-fig.rec-fill canvas{height:100%;border-radius:0;background:none}
.rec-fig .rec-ctl{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 4px}
.rec-fig .rec-seg{display:flex;flex-wrap:wrap;gap:4px;padding:3px;border-radius:12px;background:rgba(255,255,255,0.05)}
.rec-fig button{min-height:44px;min-width:44px;padding:0 14px;border:0;border-radius:9px;background:transparent;color:#b9c6cb;font:500 0.92rem/1 Inter,system-ui,sans-serif;cursor:pointer}
.rec-fig button[aria-pressed="true"]{background:rgba(134,220,124,0.18);color:#eaf7e8;box-shadow:inset 0 0 0 1px rgba(134,220,124,0.45)}
.rec-fig button:hover{color:#fff}
.rec-fig button:focus-visible{outline:2px solid #62c4ff;outline-offset:2px}
.rec-fig .rec-tour{background:rgba(255,255,255,0.05)}
.rec-fig .rec-cap{margin:6px 2px 0;min-height:2.6em;font-size:0.95rem;line-height:1.45;color:#c8d3d7}
.rec-fig .rec-notes{margin:8px 0 0;padding:10px 12px;border-left:2px solid rgba(255,214,102,0.5);background:rgba(255,255,255,0.03);border-radius:0 8px 8px 0}
.rec-fig .rec-note{margin:0 0 6px;font-size:0.9rem;line-height:1.45;color:#aebbc0}
.rec-fig .rec-note:last-child{margin-bottom:0}
.rec-fig .rec-note b{font-weight:600;color:#e8eef0}
.rec-fig .rec-note.breaks b{color:#ffd666}
@media (max-width:420px){.rec-fig button{padding:0 10px;font-size:0.88rem}}
`;
