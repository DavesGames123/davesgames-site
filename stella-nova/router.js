(function(){
  'use strict';
  var PAGES = {
    home:'home.html', hohmann:'hohmann.html', forge:'forge.html',
    crafting:'crafting.html', planner:'planner.html', guide:'guide.html',
    behaviors:'behaviors.html', controls:'controls.html', gravity:'gravity.html',
    selection:'selection.html', explosion:'explosion.html', flare:'flare.html',
    solar:'solar.html', shipdesigner:'ship-designer.html',
    flagdesigner:'flag-designer.html', matlab:'material-lab.html',
    orbital:'atomic-orbital-vr.html', supernova:'fractal-orb.html',
    anomaly:'wormhole.html', blackhole:'blackhole.html', galaxy:'galaxy.html',
    fortom:'for-tom.html'
  };
  var LABELS = {
    home:'Overview', hohmann:'Hohmann Transfer', forge:'Planet Forge',
    crafting:'Crafting', planner:'Station Planner', guide:'Station Guide',
    behaviors:'Behaviors', controls:'Controls', gravity:'Gravity Sim',
    selection:'Selection', explosion:'Explosion',
    flare:'Engine Propulsion Effects', solar:'Solar Transit Study',
    shipdesigner:'Ship Designer', flagdesigner:'Flag Designer',
    matlab:'PBR Material Studio', orbital:'Atomic Orbital',
    supernova:'Fractal Orb', anomaly:'Anomaly', blackhole:'Black Hole',
    galaxy:'Galaxy', fortom:'For Tom'
  };
  var XR_PAGES = { orbital: 1 };

  var BASE_PATH = '/stella-nova/';
  var activeTab = null, suppressURLWrite = false;

  function urlForTab(id){ return id === 'home' ? BASE_PATH : BASE_PATH + id; }

  function tabFromURL(){
    var p = location.pathname;
    if (p.indexOf(BASE_PATH) === 0){
      var sub = p.slice(BASE_PATH.length).replace(/\/$/, '');
      if (sub && PAGES[sub]) return sub;
    }
    var h = (location.hash || '').replace(/^#/, '');
    if (h && PAGES[h]) return h;
    return 'home';
  }

  function switchTab(id, opts){
    opts = opts || {};
    if (!PAGES[id]) id = 'home';
    if (id === activeTab && !opts.force) return;
    var items = document.querySelectorAll('.nav-item');
    for (var i=0;i<items.length;i++){
      items[i].classList.toggle('active', items[i].dataset.tab === id);
    }
    var wrap = document.getElementById('frame-wrap');
    if (wrap){
      wrap.innerHTML = '';
      var iframe = document.createElement('iframe');
      iframe.src = PAGES[id];
      var allow = 'downloads';
      if (XR_PAGES[id]) allow = 'xr-spatial-tracking; accelerometer; gyroscope; magnetometer; downloads';
      iframe.setAttribute('allow', allow);
      wrap.appendChild(iframe);
    }
    var ta = document.getElementById('topbar-active');
    if (ta) ta.textContent = LABELS[id] || id;
    document.title = (LABELS[id] || 'Stella Nova') + ' · Stella Nova';
    if (!suppressURLWrite){
      var target = urlForTab(id);
      if (location.pathname + location.hash !== target){
        try { history.pushState({tab:id}, '', target); }
        catch(e){ location.hash = '#' + id; }
      }
    }
    activeTab = id;
    if (typeof window.closeSidebar === 'function') window.closeSidebar();
  }

  function routeFromURL(){
    suppressURLWrite = true;
    switchTab(tabFromURL(), {force:true});
    suppressURLWrite = false;
  }

  window.addEventListener('popstate', routeFromURL);
  window.addEventListener('hashchange', routeFromURL);

  function boot(){
    try {
      var stashed = sessionStorage.getItem('STELLA_NOVA_TARGET');
      if (stashed){
        sessionStorage.removeItem('STELLA_NOVA_TARGET');
        if (PAGES[stashed]) history.replaceState({tab:stashed}, '', urlForTab(stashed));
      }
    } catch(e){}
    routeFromURL();
  }

  window.switchTab = switchTab;
  window.StellaNovaRouter = { boot: boot, BASE_PATH: BASE_PATH };

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})();
