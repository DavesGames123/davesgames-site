// ============================================================================
//  CITIZEN BEHAVIORS  ·  scroll-spy navigation for the field manual
// ----------------------------------------------------------------------------
//  Classic script loaded at the end of body. The page is one long scrolling
//  column of behavior sections inside #content. This file keeps the left
//  sidebar navigation in sync with the scroll position in two directions:
//
//    click a nav button ─▶ goToBeh() ─▶ smooth-scroll #content to the section
//    scroll #content     ─▶ IntersectionObserver ─▶ mark the nav button of the
//                                                    section now in view active
//
//  LAYOUT
//    ┌─────────────┬──────────────────────────────┐
//    │ #sidebar    │ #content (scroll container)   │
//    │  nav-btn ●  │   .beh-section  #beh-search   │
//    │  nav-btn    │   .beh-section  #beh-collect  │
//    │   ...       │   ...                         │
//    └─────────────┴──────────────────────────────┘
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//    click to scroll ..... "function goToBeh"          nav button click handler
//    observed sections ... "var sections"              the section and button node lists
//    scroll spy .......... "new IntersectionObserver"  set the active button on scroll
//    start watching ...... "sections.forEach"          observe every section
// ============================================================================

// Nav button click handler. It scrolls the target section to the top of the
// content pane, then moves the active class onto the clicked button. The id
// argument is the behavior key; the DOM element id is 'beh-' + key.
function goToBeh(btn, id){
  var el = document.getElementById('beh-' + id);
  if (el) el.scrollIntoView({behavior: 'smooth', block: 'start'});
  document.querySelectorAll('#sidebar .nav-btn').forEach(function(b){ b.classList.remove('active') });
  btn.classList.add('active');
}
// The two node lists the scroll spy links: every behavior section, and every
// sidebar button that carries a data-beh key. contentEl is the scroll root the
// observer measures against, not the window.
var sections = document.querySelectorAll('.beh-section');
var navBtns = document.querySelectorAll('#sidebar .nav-btn[data-beh]');
var contentEl = document.getElementById('content');
// Scroll spy. When a section crosses the visibility threshold, strip 'beh-' off
// its id and toggle the active class onto the matching button.
var observer = new IntersectionObserver(function(entries){
  entries.forEach(function(entry){
    if (entry.isIntersecting) {
      var id = entry.target.id.replace('beh-', '');
      navBtns.forEach(function(btn){
        btn.classList.toggle('active', btn.getAttribute('data-beh') === id);
      });
    }
  });
// threshold 0.2 fires once a fifth of the section shows. The rootMargin shrinks
// the detection band to the upper part of the pane: it drops the top 80px under
// the topbar and ignores the bottom half, so the button flips as a section
// reaches the reading zone rather than when it first peeks in at the edge.
}, {threshold: 0.2, root: contentEl, rootMargin: '-80px 0px -50% 0px'});
// Register every section with the observer so scrolling drives the highlight.
sections.forEach(function(s){ observer.observe(s) });
