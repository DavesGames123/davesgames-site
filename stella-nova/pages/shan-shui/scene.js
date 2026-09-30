/* ═══════════════════════════════════════════════════════════════════════════
   SHAN SHUI  ·  scene.js  (load order 11 of 12)
   ───────────────────────────────────────────────────────────────────────────
   This file plans and renders the scroll of landscape. It defines the global
   MEM, the chunk store and the view state. MEM.windx is 3000 and MEM.windy
   is 800. The UI must not change these values.

   DATA PATH. mountplanner() picks the positions of each feature in a range.
   chunkloader() builds the SVG chunks for new positions and adds them to
   MEM.chunks. chunkrender() joins the visible chunks into MEM.canv. update()
   writes one <svg id="SVG"> with that string into the element #BG.

   GLOBALS WRITTEN: MEM, mouseX, mouseY. update() reads self.chunkloader, so
   the page must run in a window. The file also adds two mouse listeners to
   document.

   UPSTREAM LINES  3667-4040

   GREP MAP
     grep -n "function water"         the water line strokes
     grep -n "function mountplanner"  the feature plan for a range
     grep -n "MEM = {"                the chunk store and the view state
     grep -n "function chunkloader"   the chunk build and the NaN guard
     grep -n "function chunkrender"   the join of the visible chunks
     grep -n "function calcViewBox"   the viewBox from MEM.cursx
     grep -n "function viewupdate"    the viewBox change without a rebuild
     grep -n "function update"        the full rebuild of #BG

   Upstream: shan-shui-inf by Lingdong Huang, 2018. MIT License, see
   LICENSE-shan-shui-inf.txt. The code below is a verbatim copy.
   ═══════════════════════════════════════════════════════════════════════════ */
  function water(xoff, yoff, seed, args) {
    var args = args != undefined ? args : {};
    var hei = args.hei != undefined ? args.hei : 2;
    var len = args.len != undefined ? args.len : 800;
    var clu = args.clu != undefined ? args.clu : 10;
    var canv = "";

    var ptlist = [];
    var yk = 0;
    for (var i = 0; i < clu; i++) {
      ptlist.push([]);
      var xk = (Math.random() - 0.5) * (len / 8);
      yk += Math.random() * 5;
      var lk = len / 4 + Math.random() * (len / 4);
      var reso = 5;
      for (var j = -lk; j < lk; j += reso) {
        ptlist[ptlist.length - 1].push([
          j + xk,
          Math.sin(j * 0.2) * hei * Noise.noise(j * 0.1) - 20 + yk,
        ]);
      }
    }

    for (var j = 1; j < ptlist.length; j += 1) {
      canv += stroke(
        ptlist[j].map(function(x) {
          return [x[0] + xoff, x[1] + yoff];
        }),
        {
          col:
            "rgba(100,100,100," + (0.3 + Math.random() * 0.3).toFixed(3) + ")",
          wid: 1,
        },
      );
    }

    return canv;
  }

  function mountplanner(xmin, xmax) {
    function locmax(x, y, f, r) {
      var z0 = f(x, y);
      if (z0 <= 0.3) {
        return false;
      }
      for (var i = x - r; i < x + r; i++) {
        for (var j = y - r; j < y + r; j++) {
          if (f(i, j) > z0) {
            return false;
          }
        }
      }
      return true;
    }

    function chadd(r, mind) {
      mind = mind == undefined ? 10 : mind;
      for (var k = 0; k < reg.length; k++) {
        if (Math.abs(reg[k].x - r.x) < mind) {
          return false;
        }
      }
      console.log("+");
      reg.push(r);
      return true;
    }

    var reg = [];
    var samp = 0.03;
    var ns = function(x, y) {
      return Math.max(Noise.noise(x * samp) - 0.55, 0) * 2;
    };
    var nns = function(x) {
      return 1 - Noise.noise(x * samp);
    };
    var nnns = function(x, y) {
      return Math.max(Noise.noise(x * samp * 2, 2) - 0.55, 0) * 2;
    };
    var yr = function(x) {
      return Noise.noise(x * 0.01, Math.PI);
    };

    var xstep = 5;
    var mwid = 200;
    for (var i = xmin; i < xmax; i += xstep) {
      var i1 = Math.floor(i / xstep);
      MEM.planmtx[i1] = MEM.planmtx[i1] || 0;
    }

    for (var i = xmin; i < xmax; i += xstep) {
      for (var j = 0; j < yr(i) * 480; j += 30) {
        if (locmax(i, j, ns, 2)) {
          var xof = i + 2 * (Math.random() - 0.5) * 500;
          var yof = j + 300;
          var r = { tag: "mount", x: xof, y: yof, h: ns(i, j) };
          var res = chadd(r);
          if (res) {
            for (
              var k = Math.floor((xof - mwid) / xstep);
              k < (xof + mwid) / xstep;
              k++
            ) {
              MEM.planmtx[k] += 1;
            }
          }
        }
      }
      if (Math.abs(i) % 1000 < Math.max(1, xstep - 1)) {
        var r = {
          tag: "distmount",
          x: i,
          y: 280 - Math.random() * 50,
          h: ns(i, j),
        };
        chadd(r);
      }
    }
    console.log([xmin, xmax]);
    for (var i = xmin; i < xmax; i += xstep) {
      if (MEM.planmtx[Math.floor(i / xstep)] == 0) {
        //var r = {tag:"redcirc",x:i,y:700}
        //console.log(i)
        if (Math.random() < 0.01) {
          for (var j = 0; j < 4 * Math.random(); j++) {
            var r = {
              tag: "flatmount",
              x: i + 2 * (Math.random() - 0.5) * 700,
              y: 700 - j * 50,
              h: ns(i, j),
            };
            chadd(r);
          }
        }
      } else {
        // var r = {tag:"greencirc",x:i,y:700}
        // chadd(r)
      }
    }

    for (var i = xmin; i < xmax; i += xstep) {
      if (Math.random() < 0.2) {
        var r = { tag: "boat", x: i, y: 300 + Math.random() * 390 };
        chadd(r, 400);
      }
    }

    return reg;
  }

  MEM = {
    canv: "",
    chunks: [],
    xmin: 0,
    xmax: 0,
    cwid: 512,
    cursx: 0,
    lasttick: 0,
    windx: 3000,
    windy: 800,
    planmtx: [],
  };

  function dummyloader(xmin, xmax) {
    for (var i = xmin; i < xmax; i += 200) {
      //MEM.chunks.push({tag:"?",x:i,y:100,canv:Tree.tree08(i,500,i)})
      //MEM.chunks.push({tag:"?",x:i,y:100,canv:Man.man(i,500)})
      //MEM.chunks.push({tag:"?",x:i,y:100,canv:Arch.arch01(i,500)})
      //MEM.chunks.push({tag:"?",x:i,y:100,canv:Arch.boat01(i,500)})
      //MEM.chunks.push({tag:"?",x:i,y:100,canv:Arch.transmissionTower01(i,500)})
      MEM.chunks.push({
        tag: "?",
        x: i,
        y: 100,
        canv: Arch.arch02(i, 500, 0, { sto: 1, rot: Math.random() }),
      });
    }
  }

  function chunkloader(xmin, xmax) {
    var add = function(nch) {
      if (nch.canv.includes("NaN")) {
        console.log("gotcha:");
        console.log(nch.tag);
        nch.canv = nch.canv.replace(/NaN/g, -1000);
      }
      if (MEM.chunks.length == 0) {
        MEM.chunks.push(nch);
        return;
      } else {
        if (nch.y <= MEM.chunks[0].y) {
          MEM.chunks.unshift(nch);
          return;
        } else if (nch.y >= MEM.chunks[MEM.chunks.length - 1].y) {
          MEM.chunks.push(nch);
          return;
        } else {
          for (var j = 0; j < MEM.chunks.length - 1; j++) {
            if (MEM.chunks[j].y <= nch.y && nch.y <= MEM.chunks[j + 1].y) {
              MEM.chunks.splice(j + 1, 0, nch);
              return;
            }
          }
        }
      }
      console.log("EH?WTF!");
      console.log(MEM.chunks);
      console.log(nch);
    };

    while (xmax > MEM.xmax - MEM.cwid || xmin < MEM.xmin + MEM.cwid) {
      console.log("generating new chunk...");

      var plan;
      if (xmax > MEM.xmax - MEM.cwid) {
        plan = mountplanner(MEM.xmax, MEM.xmax + MEM.cwid);
        MEM.xmax = MEM.xmax + MEM.cwid;
      } else {
        plan = mountplanner(MEM.xmin - MEM.cwid, MEM.xmin);
        MEM.xmin = MEM.xmin - MEM.cwid;
      }

      for (var i = 0; i < plan.length; i++) {
        if (plan[i].tag == "mount") {
          add({
            tag: plan[i].tag,
            x: plan[i].x,
            y: plan[i].y,
            canv: Mount.mountain(plan[i].x, plan[i].y, i * 2 * Math.random()),
            //{col:function(x){return "rgba(100,100,100,"+(0.5*Math.random()*plan[i].y/MEM.windy)+")"}}),
          });
          add({
            tag: plan[i].tag,
            x: plan[i].x,
            y: plan[i].y - 10000,
            canv: water(plan[i].x, plan[i].y, i * 2),
          });
        } else if (plan[i].tag == "flatmount") {
          add({
            tag: plan[i].tag,
            x: plan[i].x,
            y: plan[i].y,
            canv: Mount.flatMount(
              plan[i].x,
              plan[i].y,
              2 * Math.random() * Math.PI,
              {
                wid: 600 + Math.random() * 400,
                hei: 100,
                cho: 0.5 + Math.random() * 0.2,
              },
            ),
          });
        } else if (plan[i].tag == "distmount") {
          add({
            tag: plan[i].tag,
            x: plan[i].x,
            y: plan[i].y,
            canv: Mount.distMount(plan[i].x, plan[i].y, Math.random() * 100, {
              hei: 150,
              len: randChoice([500, 1000, 1500]),
            }),
          });
        } else if (plan[i].tag == "boat") {
          add({
            tag: plan[i].tag,
            x: plan[i].x,
            y: plan[i].y,
            canv: Arch.boat01(plan[i].x, plan[i].y, Math.random(), {
              sca: plan[i].y / 800,
              fli: randChoice([true, false]),
            }),
          });
        } else if (plan[i].tag == "redcirc") {
          add({
            tag: plan[i].tag,
            x: plan[i].x,
            y: plan[i].y,
            canv:
              "<circle cx='" +
              plan[i].x +
              "' cy='" +
              plan[i].y +
              "' r='20' stroke='black' fill='red' />",
          });
        } else if (plan[i].tag == "greencirc") {
          add({
            tag: plan[i].tag,
            x: plan[i].x,
            y: plan[i].y,
            canv:
              "<circle cx='" +
              plan[i].x +
              "' cy='" +
              plan[i].y +
              "' r='20' stroke='black' fill='green' />",
          });
        }
        // add ({
        //   x: plan[i].x,
        //   y: plan[i].y,
        //   canv:"<circle cx='"+plan[i].x+"' cy='"+plan[i].y+"' r='20' stroke='black' fill='red' />"
        // })
      }
    }
  }

  function chunkrender(xmin, xmax) {
    MEM.canv = "";

    for (var i = 0; i < MEM.chunks.length; i++) {
      if (
        xmin - MEM.cwid < MEM.chunks[i].x &&
        MEM.chunks[i].x < xmax + MEM.cwid
      ) {
        MEM.canv += MEM.chunks[i].canv;
      }
    }
  }

  document.addEventListener("mousemove", onMouseUpdate, false);
  document.addEventListener("mouseenter", onMouseUpdate, false);
  mouseX = 0;
  mouseY = 0;
  function onMouseUpdate(e) {
    mouseX = e.pageX;
    mouseY = e.pageY;
  }

  function calcViewBox() {
    var zoom = 1.142;
    return "" + MEM.cursx + " 0 " + MEM.windx / zoom + " " + MEM.windy / zoom;
  }

  function viewupdate() {
    try {
      document.getElementById("SVG").setAttribute("viewBox", calcViewBox());
    } catch (e) {
      console.log("not possible");
    }
    //setTimeout(viewupdate,100)
  }

  function needupdate() {
    return true;
    if (MEM.xmin < MEM.cursx && MEM.cursx < MEM.xmax - MEM.windx) {
      return false;
    }
    return true;
  }

  function update() {
    //console.log("update!")

    self.chunkloader(MEM.cursx, MEM.cursx + MEM.windx);
    self.chunkrender(MEM.cursx, MEM.cursx + MEM.windx);

    document.getElementById("BG").innerHTML =
      "<svg id='SVG' xmlns='http://www.w3.org/2000/svg' width='" +
      MEM.windx +
      "' height='" +
      MEM.windy +
      "' style='mix-blend-mode:multiply;'" +
      "viewBox = '" +
      calcViewBox() +
      "'" +
      "><g id='G' transform='translate(" +
      0 +
      ",0)'>" +
      MEM.canv +
      //+ "<circle cx='0' cy='0' r='50' stroke='black' fill='red' />"
      "</g></svg>";

    //setTimeout(update,1000);
  }
