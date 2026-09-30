/* ═══════════════════════════════════════════════════════════════════════════
   SHAN SHUI  ·  seed.js  (load order 2 of 12)
   ───────────────────────────────────────────────────────────────────────────
   This file sets the global SEED and seeds the generator. SEED is the time
   in milliseconds, unless the URL query holds seed=<value>. parseArgs reads
   window.location.href. The file then calls Math.seed(SEED).

   UPSTREAM LINES  63-85

   GREP MAP
     grep -n "function parseArgs"   the URL query parser
     grep -n "SEED ="               the default seed from the clock

   Upstream: shan-shui-inf by Lingdong Huang, 2018. MIT License, see
   LICENSE-shan-shui-inf.txt. The code below is a verbatim copy.
   ═══════════════════════════════════════════════════════════════════════════ */
  function parseArgs(key2f) {
    var par = window.location.href.split("?")[1];
    if (par == undefined) {
      return;
    }
    par = par.split("&");
    for (var i = 0; i < par.length; i++) {
      var e = par[i].split("=");
      try {
        key2f[e[0]](e[1]);
      } catch (e) {
        console.log(e);
      }
    }
  }
  SEED = "" + new Date().getTime();
  parseArgs({
    seed: function(x) {
      SEED = x == "" ? SEED : x;
    },
  });
  Math.seed(SEED);
  console.log(Prng.seed);
