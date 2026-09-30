/* ═══════════════════════════════════════════════════════════════════════════
   SHAN SHUI  ·  prng.js  (load order 1 of 12)
   ───────────────────────────────────────────────────────────────────────────
   This file defines the global Prng, a seeded pseudo-random generator.
   It replaces Math.random with Prng.next, and it adds Math.seed. After
   this file loads, every Math.random call on the page is deterministic.
   Prng.hash reads window.btoa to turn a seed string into a number.

   UPSTREAM LINES  2-59  (index.html, script tag lines removed)

   GREP MAP
     grep -n "this.hash"       seed string to integer
     grep -n "this.next"       the next value in [0, 1)
     grep -n "Math.random ="   the global override
     grep -n "Math.seed ="     the seed entry point

   Upstream: shan-shui-inf by Lingdong Huang, 2018. MIT License, see
   LICENSE-shan-shui-inf.txt. The code below is a verbatim copy.
   ═══════════════════════════════════════════════════════════════════════════ */
  var Prng = new function() {
    this.s = 1234;
    this.p = 999979; //9887//983
    this.q = 999983; //9967//991
    this.m = this.p * this.q;
    this.hash = function(x) {
      var y = window.btoa(JSON.stringify(x));
      var z = 0;
      for (var i = 0; i < y.length; i++) {
        z += y.charCodeAt(i) * Math.pow(128, i);
      }
      return z;
    };
    this.seed = function(x) {
      if (x == undefined) {
        x = new Date().getTime();
      }
      var y = 0;
      var z = 0;
      function redo() {
        y = (Prng.hash(x) + z) % Prng.m;
        z += 1;
      }
      while (y % Prng.p == 0 || y % Prng.q == 0 || y == 0 || y == 1) {
        redo();
      }
      Prng.s = y;
      console.log(["int seed", Prng.s]);
      for (var i = 0; i < 10; i++) {
        Prng.next();
      }
    };
    this.next = function() {
      Prng.s = (Prng.s * Prng.s) % Prng.m;
      return Prng.s / Prng.m;
    };
    this.test = function(f) {
      var F =
        f ||
        function() {
          return Prng.next();
        };
      var t0 = new Date().getTime();
      var chart = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (var i = 0; i < 10000000; i++) {
        chart[Math.floor(F() * 10)] += 1;
      }
      console.log(chart);
      console.log("finished in " + (new Date().getTime() - t0));
      return chart;
    };
  }();
  Math.random = function() {
    return Prng.next();
  };
  Math.seed = function(x) {
    return Prng.seed(x);
  };
