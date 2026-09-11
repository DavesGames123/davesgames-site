// ============================================================================
//  MOBILE SWITCH  ·  toggle the .mob class on <html> for phone-sized viewports
// ----------------------------------------------------------------------------
//  Adds or removes .mob on the document root so the stylesheet can serve a
//  compact phone layout. It weighs both the live viewport width and a
//  coarse-pointer plus small-device test, because iOS Safari expands an iframe
//  to its content size, which makes a plain width media query lie inside the
//  site shell. Testing the physical device recovers the true form factor.
//
//      viewport width <= 860           ─┐
//                                        ├─▶ toggle .mob on <html>
//      coarse pointer AND shorter        │
//      screen edge <= 860              ─┘
//
//  It re-checks on resize, orientation change, and visualViewport resize.
// ============================================================================
/* Device-aware mobile switch — same rationale as ChordLab: iOS Safari
   expands iframes to content size, so width media queries lie inside
   the index shell. Check the physical device too. */
(function(){
  // Decide whether this is a phone-sized context and set the .mob flag.
  function chk(){
    // Prefer visualViewport width; it excludes on-screen keyboard/URL-bar chrome.
    var vw=window.visualViewport?window.visualViewport.width:window.innerWidth;
    // Touch devices report a coarse pointer.
    var coarse=window.matchMedia&&matchMedia('(pointer:coarse)').matches;
    // Physical short edge, so orientation does not flip the device test.
    var dev=Math.min(screen.width,screen.height);
    document.documentElement.classList.toggle('mob',vw<=860||(coarse&&dev<=860));
  }
  // Check once now, then on every event that can change the effective width.
  chk();
  addEventListener('resize',chk);
  addEventListener('orientationchange',chk);
  if(window.visualViewport)visualViewport.addEventListener('resize',chk);
})();
