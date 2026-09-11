(function(){
  function chk(){
    var vw=window.visualViewport?window.visualViewport.width:window.innerWidth;
    var coarse=window.matchMedia&&matchMedia('(pointer:coarse)').matches;
    var dev=Math.min(screen.width,screen.height);
    document.documentElement.classList.toggle('mob',vw<=700||(coarse&&dev<=860));
  }
  chk();addEventListener('resize',chk);addEventListener('orientationchange',chk);
  if(window.visualViewport)visualViewport.addEventListener('resize',chk);
})();
