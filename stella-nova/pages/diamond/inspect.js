// ============================================================================
//  DIAMOND LAB  ·  inspect.js — the loupe and the grading views
// ────────────────────────────────────────────────────────────────────────────
//  A jeweller looks at a stone in a few fixed positions and with a 10x
//  loupe. This module holds that data and the loupe geometry. It has no
//  DOM and no GPU code, so tests.mjs can import it.
//
//  The loupe does not scale the picture. fs_gem moves each pixel inside
//  the lens toward the lens centre by 1/mag before it makes the camera
//  ray, so every pixel in the lens is a new traced ray (loupeMap is the
//  same function in JS).
//
//  GREP MAP
//    const LOUPE_MAGS ............. the loupe powers (0 = off)
//    const VIEWS .................. the grading views: camera pitch, spin
//    function loupeMap ............ a pixel in the lens to its traced pixel
//    function loupeRadius ......... the lens radius in CSS px for a window
//    function clampPitch .......... the pitch range for a drag
// ============================================================================

export const LOUPE_MAGS = [0, 5, 10, 20];

// pitch: camera elevation (rad). spin: the turntable state that the view
// sets. A view that is null for spin keeps the turntable as it is.
export const VIEWS = {
  faceup:  { name: 'Face up',    pitch: 1.5,  spin: false, note: 'Straight down through the table, as a grader looks for brightness, fire and the arrow pattern.' },
  profile: { name: 'Profile',    pitch: 0.0,  spin: null,  note: 'Level with the girdle: the crown height, the pavilion depth and the girdle thickness.' },
  tabledown: { name: 'Table down', pitch: -1.5, spin: false, note: 'Up through the pavilion, as the stone lies in a grading tray: the culet and the pavilion mains.' },
  free:    { name: 'Free',       pitch: 0.55, spin: true,  note: 'The default three-quarter view on the turntable.' },
};
export const VIEW_KEYS = Object.keys(VIEWS);

// p, c: [x, y]. Inside the lens of radius r about c, a point moves to
// c + (p - c) / mag. Outside the lens, or with mag 0, it does not move.
export function loupeMap(p, c, r, mag) {
  if (!(mag > 0) || !(r > 0)) return p;
  const dx = p[0] - c[0], dy = p[1] - c[1];
  if (dx * dx + dy * dy >= r * r) return p;
  return [c[0] + dx / mag, c[1] + dy / mag];
}

// The lens is 22% of the short side of the window, 70..190 CSS px.
export function loupeRadius(w, h) {
  return Math.min(190, Math.max(70, 0.22 * Math.min(w, h)));
}

// A drag can turn the stone over: from table down to face up.
export const clampPitch = p => Math.min(1.5, Math.max(-1.5, p));
