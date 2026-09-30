/* ═══════════════════════════════════════════════════════════════════════════
   SHAN SHUI  ·  draw.js  (load order 6 of 12)
   ───────────────────────────────────────────────────────────────────────────
   This file defines the global brush helpers. The helpers make SVG strings
   for ink strokes, blobs, and textures. The Tree, Mount, Arch, and Man
   builders call these helpers. The helpers read Noise and Math.random.

   UPSTREAM LINES  514-742

   GREP MAP
     grep -n "function stroke"    the ink stroke of variable width
     grep -n "function blob"      the filled leaf or dot shape
     grep -n "function div"       the subdivision of a polyline
     grep -n "var texture"        the hatch texture on a surface

   Upstream: shan-shui-inf by Lingdong Huang, 2018. MIT License, see
   LICENSE-shan-shui-inf.txt. The code below is a verbatim copy.
   ═══════════════════════════════════════════════════════════════════════════ */
  console.log("************************************************");

  function stroke(ptlist, args) {
    var args = args != undefined ? args : {};
    var xof = args.xof != undefined ? args.xof : 0;
    var yof = args.yof != undefined ? args.yof : 0;
    var wid = args.wid != undefined ? args.wid : 2;
    var col = args.col != undefined ? args.col : "rgba(200,200,200,0.9)";
    var noi = args.noi != undefined ? args.noi : 0.5;
    var out = args.out != undefined ? args.out : 1;
    var fun =
      args.fun != undefined
        ? args.fun
        : function(x) {
            return Math.sin(x * Math.PI);
          };

    if (ptlist.length == 0) {
      return "";
    }
    vtxlist0 = [];
    vtxlist1 = [];
    vtxlist = [];
    var n0 = Math.random() * 10;
    for (var i = 1; i < ptlist.length - 1; i++) {
      var w = wid * fun(i / ptlist.length);
      w = w * (1 - noi) + w * noi * Noise.noise(i * 0.5, n0);
      var a1 = Math.atan2(
        ptlist[i][1] - ptlist[i - 1][1],
        ptlist[i][0] - ptlist[i - 1][0],
      );
      var a2 = Math.atan2(
        ptlist[i][1] - ptlist[i + 1][1],
        ptlist[i][0] - ptlist[i + 1][0],
      );
      var a = (a1 + a2) / 2;
      if (a < a2) {
        a += Math.PI;
      }
      vtxlist0.push([
        ptlist[i][0] + w * Math.cos(a),
        ptlist[i][1] + w * Math.sin(a),
      ]);
      vtxlist1.push([
        ptlist[i][0] - w * Math.cos(a),
        ptlist[i][1] - w * Math.sin(a),
      ]);
    }

    vtxlist = [ptlist[0]]
      .concat(
        vtxlist0.concat(vtxlist1.concat([ptlist[ptlist.length - 1]]).reverse()),
      )
      .concat([ptlist[0]]);

    var canv = poly(
      vtxlist.map(function(x) {
        return [x[0] + xof, x[1] + yof];
      }),
      { fil: col, str: col, wid: out },
    );
    return canv;
  }

  function blob(x, y, args) {
    var args = args != undefined ? args : {};
    var len = args.len != undefined ? args.len : 20;
    var wid = args.wid != undefined ? args.wid : 5;
    var ang = args.ang != undefined ? args.ang : 0;
    var col = args.col != undefined ? args.col : "rgba(200,200,200,0.9)";
    var noi = args.noi != undefined ? args.noi : 0.5;
    var ret = args.ret != undefined ? args.ret : 0;
    var fun =
      args.fun != undefined
        ? args.fun
        : function(x) {
            return x <= 1
              ? Math.pow(Math.sin(x * Math.PI), 0.5)
              : -Math.pow(Math.sin((x + 1) * Math.PI), 0.5);
          };

    var reso = 20.0;
    var lalist = [];
    for (var i = 0; i < reso + 1; i++) {
      var p = (i / reso) * 2;
      var xo = len / 2 - Math.abs(p - 1) * len;
      var yo = (fun(p) * wid) / 2;
      var a = Math.atan2(yo, xo);
      var l = Math.sqrt(xo * xo + yo * yo);
      lalist.push([l, a]);
    }
    var nslist = [];
    var n0 = Math.random() * 10;
    for (var i = 0; i < reso + 1; i++) {
      nslist.push(Noise.noise(i * 0.05, n0));
    }

    loopNoise(nslist);
    var plist = [];
    for (var i = 0; i < lalist.length; i++) {
      var ns = nslist[i] * noi + (1 - noi);
      var nx = x + Math.cos(lalist[i][1] + ang) * lalist[i][0] * ns;
      var ny = y + Math.sin(lalist[i][1] + ang) * lalist[i][0] * ns;
      plist.push([nx, ny]);
    }

    if (ret == 0) {
      return poly(plist, { fil: col, str: col, wid: 0 });
    } else {
      return plist;
    }
  }

  function div(plist, reso) {
    var tl = (plist.length - 1) * reso;
    var lx = 0;
    var ly = 0;
    var rlist = [];

    for (var i = 0; i < tl; i += 1) {
      var lastp = plist[Math.floor(i / reso)];
      var nextp = plist[Math.ceil(i / reso)];
      var p = (i % reso) / reso;
      var nx = lastp[0] * (1 - p) + nextp[0] * p;
      var ny = lastp[1] * (1 - p) + nextp[1] * p;

      var ang = Math.atan2(ny - ly, nx - lx);

      rlist.push([nx, ny]);
      lx = nx;
      ly = ny;
    }

    if (plist.length > 0) {
      rlist.push(plist[plist.length - 1]);
    }
    return rlist;
  }

  var texture = function(ptlist, args) {
    var args = args != undefined ? args : {};
    var xof = args.xof != undefined ? args.xof : 0;
    var yof = args.yof != undefined ? args.yof : 0;
    var tex = args.tex != undefined ? args.tex : 400;
    var wid = args.wid != undefined ? args.wid : 1.5;
    var len = args.len != undefined ? args.len : 0.2;
    var sha = args.sha != undefined ? args.sha : 0;
    var ret = args.ret != undefined ? args.ret : 0;
    var noi =
      args.noi != undefined
        ? args.noi
        : function(x) {
            return 30 / x;
          };
    var col =
      args.col != undefined
        ? args.col
        : function(x) {
            return "rgba(100,100,100," + (Math.random() * 0.3).toFixed(3) + ")";
          };
    var dis =
      args.dis != undefined
        ? args.dis
        : function() {
            if (Math.random() > 0.5) {
              return (1 / 3) * Math.random();
            } else {
              return (1 * 2) / 3 + (1 / 3) * Math.random();
            }
          };
    var reso = [ptlist.length, ptlist[0].length];
    var texlist = [];
    for (var i = 0; i < tex; i++) {
      var mid = (dis() * reso[1]) | 0;
      //mid = (reso[1]/3+reso[1]/3*Math.random())|0

      var hlen = Math.floor(Math.random() * (reso[1] * len));

      var start = mid - hlen;
      var end = mid + hlen;
      start = Math.min(Math.max(start, 0), reso[1]);
      end = Math.min(Math.max(end, 0), reso[1]);

      var layer = (i / tex) * (reso[0] - 1);

      texlist.push([]);
      for (var j = start; j < end; j++) {
        var p = layer - Math.floor(layer);

        var x =
          ptlist[Math.floor(layer)][j][0] * p +
          ptlist[Math.ceil(layer)][j][0] * (1 - p);

        var y =
          ptlist[Math.floor(layer)][j][1] * p +
          ptlist[Math.ceil(layer)][j][1] * (1 - p);

        var ns = [
          noi(layer + 1) * (Noise.noise(x, j * 0.5) - 0.5),
          noi(layer + 1) * (Noise.noise(y, j * 0.5) - 0.5),
        ];

        texlist[texlist.length - 1].push([x + ns[0], y + ns[1]]);
      }
    }
    var canv = "";
    //SHADE
    if (sha) {
      for (var j = 0; j < texlist.length; j += 1 + (sha != 0)) {
        canv += stroke(
          texlist[j].map(function(x) {
            return [x[0] + xof, x[1] + yof];
          }),
          { col: "rgba(100,100,100,0.1)", wid: sha },
        );
      }
    }
    //TEXTURE
    for (var j = 0 + sha; j < texlist.length; j += 1 + sha) {
      canv += stroke(
        texlist[j].map(function(x) {
          return [x[0] + xof, x[1] + yof];
        }),
        { col: col(j / texlist.length), wid: wid },
      );
    }
    return ret ? texlist : canv;
  };

