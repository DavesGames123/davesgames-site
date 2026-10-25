// ============================================================================
//  ALPHA QUDITS  ·  compare/style.js  ·  the CSS of the COMPARE figure shell
// ----------------------------------------------------------------------------
//  index.js injects this once as <style id="cmp-css">. Every rule is under
//  .cmp-fig, so it cannot change CORE's layout. Buttons are 44 px targets.
//  Sentence-case labels; no uppercase text, no letter-spacing.
// ============================================================================
export const CSS = `
.cmp-fig{position:relative;width:100%;max-width:100%;min-width:0;color:#eceef3;font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
.cmp-fig [hidden]{display:none!important}
.cmp-fig .cmp-canvas{position:relative;width:100%;line-height:0}
.cmp-fig canvas{display:block;width:100%;touch-action:pan-y;-webkit-tap-highlight-color:transparent;border-radius:10px;background:#090c13}
.cmp-fig.cmp-fill{height:100%}
.cmp-fig.cmp-fill .cmp-canvas,.cmp-fig.cmp-fill canvas{height:100%;border-radius:0;background:none}
.cmp-fig .cmp-ctl{display:grid;gap:8px;margin:10px 0 4px}
.cmp-fig .cmp-grp{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px}
.cmp-fig .cmp-grp>.cmp-gl{flex:0 0 100%;font-size:0.8rem;color:#8b93a7;margin:2px 2px 0}
.cmp-fig .cmp-seg{display:flex;flex-wrap:wrap;gap:4px;padding:3px;border-radius:12px;background:rgba(255,255,255,0.045)}
.cmp-fig .cmp-grp.stack .cmp-seg{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));width:100%}
.cmp-fig button{min-height:44px;min-width:44px;padding:0 14px;border:0;border-radius:9px;background:transparent;color:#c4c9d6;font:500 0.9rem/1.2 Inter,system-ui,sans-serif;cursor:pointer;text-align:center}
.cmp-fig button.wide{text-align:left;padding:6px 12px;display:flex;flex-direction:column;justify-content:center;gap:2px}
.cmp-fig button .cmp-bs{font-size:0.78rem;color:#8b93a7;font-weight:400}
.cmp-fig button[aria-pressed="true"]{background:rgba(255,214,102,0.15);color:#fff6dc;box-shadow:inset 0 0 0 1px rgba(255,214,102,0.5)}
.cmp-fig button[aria-pressed="true"] .cmp-bs{color:#e9d8a6}
@media (hover:hover){.cmp-fig button:hover{color:#fff;background:rgba(255,255,255,0.06)}}
.cmp-fig button:focus-visible{outline:2px solid #62c4ff;outline-offset:2px}
.cmp-fig .cmp-hint{font-size:0.8rem;color:#8b93a7;margin:0 2px}
.cmp-fig .cmp-cap{margin:6px 2px 0;min-height:2.6em;font-size:0.92rem;line-height:1.45;color:#c4c9d6}
.cmp-fig .cmp-info{margin:8px 0 0;padding:10px 12px;border-left:2px solid rgba(255,214,102,0.5);background:rgba(255,255,255,0.03);border-radius:0 8px 8px 0;font-size:0.9rem;line-height:1.5;color:#aeb6c6}
.cmp-fig .cmp-info:empty{display:none}
.cmp-fig .cmp-info p{margin:0 0 8px}
.cmp-fig .cmp-info p:last-child{margin-bottom:0}
.cmp-fig .cmp-info b{color:#eceef3;font-weight:600}
.cmp-fig .cmp-ref{color:#8b93a7;font-size:0.84rem}
.cmp-fig .cmp-flag{color:#ff9a62;font-weight:600}
.cmp-fig .cmp-sub{font-size:0.84rem;color:#8b93a7}
.cmp-fig .cmp-list{margin:0 0 8px 1.1em;padding:0;font-size:0.84rem;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
@media (max-width:420px){.cmp-fig button{padding:0 10px;font-size:0.86rem}.cmp-fig .cmp-grp.stack .cmp-seg{grid-template-columns:1fr}}
`;
