function goToBeh(btn, id){
  var el = document.getElementById('beh-' + id);
  if (el) el.scrollIntoView({behavior: 'smooth', block: 'start'});
  document.querySelectorAll('#sidebar .nav-btn').forEach(function(b){ b.classList.remove('active') });
  btn.classList.add('active');
}
var sections = document.querySelectorAll('.beh-section');
var navBtns = document.querySelectorAll('#sidebar .nav-btn[data-beh]');
var contentEl = document.getElementById('content');
var observer = new IntersectionObserver(function(entries){
  entries.forEach(function(entry){
    if (entry.isIntersecting) {
      var id = entry.target.id.replace('beh-', '');
      navBtns.forEach(function(btn){
        btn.classList.toggle('active', btn.getAttribute('data-beh') === id);
      });
    }
  });
}, {threshold: 0.2, root: contentEl, rootMargin: '-80px 0px -50% 0px'});
sections.forEach(function(s){ observer.observe(s) });
