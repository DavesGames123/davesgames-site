// ============================================================================
//  ROCHE LIMIT  ·  app/card-art.js — gallery card pictures
// ----------------------------------------------------------------------------
//  One inline SVG per scenario card.
//
//  grep -n targets
//    card picture .... "function cardArt"
// ============================================================================

// Small pictures for the gallery cards (inline SVG, 160 x 90).
export function cardArt(key) {
  const sv = body => `<svg viewBox="0 0 160 90" aria-hidden="true"><rect width="160" height="90" fill="#070b13"/>${body}</svg>`;
  const stars = '<g fill="#9fb3d1" opacity="0.5"><circle cx="12" cy="14" r="0.8"/><circle cx="140" cy="20" r="0.7"/><circle cx="128" cy="76" r="0.8"/><circle cx="30" cy="70" r="0.6"/><circle cx="96" cy="8" r="0.6"/></g>';
  if (key === 'saturn') return sv(`${stars}<ellipse cx="80" cy="47" rx="60" ry="13" fill="none" stroke="#cdb98e" stroke-opacity="0.5" stroke-width="7"/><ellipse cx="80" cy="45" rx="20" ry="18" fill="#d9c08a"/><path d="M60 45 a20 18 0 0 1 40 0" fill="#e6d3a6"/><ellipse cx="80" cy="47" rx="60" ry="13" fill="none" stroke="#e8dcc0" stroke-opacity="0.7" stroke-width="3" stroke-dasharray="0 0 60 200"/><path d="M128 40 q8 6 2 12" fill="none" stroke="#bfe0ff" stroke-width="2" stroke-dasharray="2 3"/><circle cx="131" cy="36" r="3.4" fill="#cfe4ff"/>`);
  if (key === 'close') return sv(`${stars}<circle cx="80" cy="45" r="16" fill="#6f9cc8"/><ellipse cx="80" cy="45" rx="46" ry="22" fill="none" stroke="#ff7a59" stroke-opacity="0.75" stroke-dasharray="3 3"/><path d="M146 45 C146 10 40 8 30 40 C24 60 60 74 96 66" fill="none" stroke="#ffd7a0" stroke-opacity="0.6" stroke-width="1.4"/><ellipse cx="100" cy="65" rx="5" ry="3.5" fill="#cfe4ff"/>`);
  if (key === 'flyby') return sv(`${stars}<circle cx="64" cy="48" r="20" fill="#c99a6a"/><path d="M64 51 h20" stroke="#a87650" stroke-width="2"/><path d="M150 6 Q70 40 150 86" fill="none" stroke="#ffd7a0" stroke-opacity="0.5" stroke-width="1.2"/>${[0, 1, 2, 3, 4, 5, 6].map(i => `<circle cx="${108 + i * 5.5}" cy="${62 + i * 3.4}" r="${2.2 - i * 0.18}" fill="#e8eef8"/>`).join('')}`);
  if (key === 'compare') return sv(`${stars}<circle cx="80" cy="45" r="15" fill="#6f9cc8"/><ellipse cx="80" cy="45" rx="54" ry="24" fill="none" stroke="#9aa6b8" stroke-opacity="0.35"/><ellipse cx="30" cy="40" rx="7.5" ry="4" fill="#62c4ff"/><circle cx="21" cy="40" r="1.2" fill="#62c4ff"/><circle cx="39" cy="41" r="1.2" fill="#62c4ff"/><circle cx="131" cy="50" r="5" fill="#ff9a62"/>`);
  return sv(`${stars}<circle cx="58" cy="46" r="22" fill="#b5603f"/><circle cx="58" cy="46" r="46" fill="none" stroke="#ff7a59" stroke-opacity="0.6" stroke-dasharray="3 3"/><circle cx="96" cy="36" r="3.5" fill="#a59c90"/><text x="104" y="40" fill="#9fb3d1" font-size="9" font-family="Inter, system-ui, sans-serif">Phobos</text>`);
}
