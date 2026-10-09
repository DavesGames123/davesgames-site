// ============================================================================
//  CT EXPLAINED  ·  CT Lab links  (ES module, no DOM)
// ----------------------------------------------------------------------------
//  Each figure on this page links to the matching preset of the CT Lab
//  (page key ct-lab). The lab reads #preset=<id> from its URL on load and
//  on hashchange (ct-lab/LAB-API.md). The ids are the lab's own, from
//  ct-lab/lab/presets.js; tests.mjs checks that each one exists there.
//
//      page hash     #preset=<id>
//      shell URL     /stella-nova/#ct-lab/preset=<id>
//
//  The shell copies the part after "ct-lab/" into the lab frame as its own
//  hash (stella-nova/index.html, "function routeFromHash").
//
//  GREP MAP
//    grep -n 'export const PRESETS'   the lab ids this page uses
//    grep -n 'export function labHref' link for a preset
// ============================================================================
export const LAB_KEY = 'ct-lab';

// lab id -> what the figure that links to it shows
export const PRESETS = {
  'shepp-logan':    'projection, sinogram and Fourier slice figures',
  'head-brain':     'Beer-Lambert and FBP figures (head, brain window)',
  'filters':        'back-projection and filter figures',
  'fan-flat':       'fan-beam geometry',
  'fan-arc':        'fan beam on a curved detector (the lab is 2D; no cone preset)',
  'algorithms':     'iterative solvers at 30 views',
  'art-kaczmarz':   'ART, one ray at a time',
  'low-dose':       'artefact: noise and dose',
  'sparse-36':      'artefact: too few views',
  'limited-90':     'artefact: limited angle',
  'beam-hardening': 'artefact: beam hardening',
  'metal-streaks':  'artefact: metal',
  'rings':          'artefact: rings',
  'motion':         'artefact: motion',
  'chest-lung':     'Hounsfield units, lung window',
};

// The link for a preset. In the shell frame the link goes through the
// shell (target _top). On its own the page links to the lab folder.
export function labHref(id, inFrame = true) {
  return inFrame ? `/stella-nova/#${LAB_KEY}/preset=${id}` : `../${LAB_KEY}/index.html#preset=${id}`;
}
