// ============================================================================
//  MOBILE SWITCH  ·  toggle the .mob class on <html> for phone-sized viewports
// ----------------------------------------------------------------------------
//  Runs before the page CSS needs it. It adds or removes .mob on the document
//  root so the stylesheet can serve a compact phone layout. The decision uses
//  both the live viewport width and a coarse-pointer + small-device test, so a
//  narrow desktop window and an actual touch phone both resolve correctly.
//
//      viewport width <= 700           ─┐
//                                        ├─▶ toggle .mob on <html>
//      coarse pointer AND shorter        │
//      screen edge <= 860              ─┘
//
//  It re-checks on resize, orientation change, and visualViewport resize (which
//  fires when a mobile browser's URL bar shows or hides).
// ============================================================================
(function(){
  // Decide whether this is a phone-sized context and set the .mob flag.
  function chk(){
    // Prefer visualViewport width; it excludes on-screen keyboard/URL-bar chrome.
    var vw=window.visualViewport?window.visualViewport.width:window.innerWidth;
    // Touch devices report a coarse pointer.
    var coarse=window.matchMedia&&matchMedia('(pointer:coarse)').matches;
    // Physical short edge, so orientation does not flip the device test.
    var dev=Math.min(screen.width,screen.height);
    document.documentElement.classList.toggle('mob',vw<=700||(coarse&&dev<=860));
  }
  // Check once now, then on every event that can change the effective width.
  chk();addEventListener('resize',chk);addEventListener('orientationchange',chk);
  if(window.visualViewport)visualViewport.addEventListener('resize',chk);
})();
