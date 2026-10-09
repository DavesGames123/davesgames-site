/*! mapgen.js: ProbableTrain/MapGenerator src/ts/impl and src/ts/vector.ts at
 * commit f487e4cee321d105d5b0e14258363fa8b4d004ef, transpiled and bundled
 * unchanged with their npm dependencies into one ES module.
 * MapGenerator (c) ProbableTrain and contributors, LGPL-3.0-only:
 * https://github.com/probabletrain/mapgenerator  (see COPYING.LESSER, COPYING)
 * Bundled: loglevel (MIT), simplex-noise 2.4.0 (MIT), polyk (MIT),
 * jsts 2.1.2 (EDL-1.0 or EPL-1.0), simplify-js (BSD-2-Clause), isect (MIT),
 * splaytree (MIT), d3-quadtree 1.0.7 (BSD-3-Clause). See THIRD-PARTY.txt.
 * Build command and how to replace this module: see CREDITS.md.
 */
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/loglevel/lib/loglevel.js
var require_loglevel = __commonJS({
  "node_modules/loglevel/lib/loglevel.js"(exports, module) {
    (function(root, definition) {
      "use strict";
      if (typeof define === "function" && define.amd) {
        define(definition);
      } else if (typeof module === "object" && module.exports) {
        module.exports = definition();
      } else {
        root.log = definition();
      }
    })(exports, function() {
      "use strict";
      var noop = function() {
      };
      var undefinedType = "undefined";
      var isIE = typeof window !== undefinedType && typeof window.navigator !== undefinedType && /Trident\/|MSIE /.test(window.navigator.userAgent);
      var logMethods = [
        "trace",
        "debug",
        "info",
        "warn",
        "error"
      ];
      function bindMethod(obj, methodName) {
        var method = obj[methodName];
        if (typeof method.bind === "function") {
          return method.bind(obj);
        } else {
          try {
            return Function.prototype.bind.call(method, obj);
          } catch (e) {
            return function() {
              return Function.prototype.apply.apply(method, [obj, arguments]);
            };
          }
        }
      }
      function traceForIE() {
        if (console.log) {
          if (console.log.apply) {
            console.log.apply(console, arguments);
          } else {
            Function.prototype.apply.apply(console.log, [console, arguments]);
          }
        }
        if (console.trace) console.trace();
      }
      function realMethod(methodName) {
        if (methodName === "debug") {
          methodName = "log";
        }
        if (typeof console === undefinedType) {
          return false;
        } else if (methodName === "trace" && isIE) {
          return traceForIE;
        } else if (console[methodName] !== void 0) {
          return bindMethod(console, methodName);
        } else if (console.log !== void 0) {
          return bindMethod(console, "log");
        } else {
          return noop;
        }
      }
      function replaceLoggingMethods(level, loggerName) {
        for (var i = 0; i < logMethods.length; i++) {
          var methodName = logMethods[i];
          this[methodName] = i < level ? noop : this.methodFactory(methodName, level, loggerName);
        }
        this.log = this.debug;
      }
      function enableLoggingWhenConsoleArrives(methodName, level, loggerName) {
        return function() {
          if (typeof console !== undefinedType) {
            replaceLoggingMethods.call(this, level, loggerName);
            this[methodName].apply(this, arguments);
          }
        };
      }
      function defaultMethodFactory(methodName, level, loggerName) {
        return realMethod(methodName) || enableLoggingWhenConsoleArrives.apply(this, arguments);
      }
      function Logger(name, defaultLevel, factory) {
        var self2 = this;
        var currentLevel;
        var storageKey = "loglevel";
        if (name) {
          storageKey += ":" + name;
        }
        function persistLevelIfPossible(levelNum) {
          var levelName = (logMethods[levelNum] || "silent").toUpperCase();
          if (typeof window === undefinedType) return;
          try {
            window.localStorage[storageKey] = levelName;
            return;
          } catch (ignore) {
          }
          try {
            window.document.cookie = encodeURIComponent(storageKey) + "=" + levelName + ";";
          } catch (ignore) {
          }
        }
        function getPersistedLevel() {
          var storedLevel;
          if (typeof window === undefinedType) return;
          try {
            storedLevel = window.localStorage[storageKey];
          } catch (ignore) {
          }
          if (typeof storedLevel === undefinedType) {
            try {
              var cookie = window.document.cookie;
              var location = cookie.indexOf(
                encodeURIComponent(storageKey) + "="
              );
              if (location !== -1) {
                storedLevel = /^([^;]+)/.exec(cookie.slice(location))[1];
              }
            } catch (ignore) {
            }
          }
          if (self2.levels[storedLevel] === void 0) {
            storedLevel = void 0;
          }
          return storedLevel;
        }
        self2.name = name;
        self2.levels = {
          "TRACE": 0,
          "DEBUG": 1,
          "INFO": 2,
          "WARN": 3,
          "ERROR": 4,
          "SILENT": 5
        };
        self2.methodFactory = factory || defaultMethodFactory;
        self2.getLevel = function() {
          return currentLevel;
        };
        self2.setLevel = function(level, persist) {
          if (typeof level === "string" && self2.levels[level.toUpperCase()] !== void 0) {
            level = self2.levels[level.toUpperCase()];
          }
          if (typeof level === "number" && level >= 0 && level <= self2.levels.SILENT) {
            currentLevel = level;
            if (persist !== false) {
              persistLevelIfPossible(level);
            }
            replaceLoggingMethods.call(self2, level, name);
            if (typeof console === undefinedType && level < self2.levels.SILENT) {
              return "No console available for logging";
            }
          } else {
            throw "log.setLevel() called with invalid level: " + level;
          }
        };
        self2.setDefaultLevel = function(level) {
          if (!getPersistedLevel()) {
            self2.setLevel(level, false);
          }
        };
        self2.enableAll = function(persist) {
          self2.setLevel(self2.levels.TRACE, persist);
        };
        self2.disableAll = function(persist) {
          self2.setLevel(self2.levels.SILENT, persist);
        };
        var initialLevel = getPersistedLevel();
        if (initialLevel == null) {
          initialLevel = defaultLevel == null ? "WARN" : defaultLevel;
        }
        self2.setLevel(initialLevel, false);
      }
      var defaultLogger = new Logger();
      var _loggersByName = {};
      defaultLogger.getLogger = function getLogger(name) {
        if (typeof name !== "string" || name === "") {
          throw new TypeError("You must supply a name when creating a logger.");
        }
        var logger = _loggersByName[name];
        if (!logger) {
          logger = _loggersByName[name] = new Logger(
            name,
            defaultLogger.getLevel(),
            defaultLogger.methodFactory
          );
        }
        return logger;
      };
      var _log = typeof window !== undefinedType ? window.log : void 0;
      defaultLogger.noConflict = function() {
        if (typeof window !== undefinedType && window.log === defaultLogger) {
          window.log = _log;
        }
        return defaultLogger;
      };
      defaultLogger.getLoggers = function getLoggers() {
        return _loggersByName;
      };
      return defaultLogger;
    });
  }
});

// cjs/vector.js
var require_vector = __commonJS({
  "cjs/vector.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var log = require_loglevel();
    var Vector2 = class _Vector {
      constructor(x, y) {
        this.x = x;
        this.y = y;
      }
      static zeroVector() {
        return new _Vector(0, 0);
      }
      static fromScalar(s) {
        return new _Vector(s, s);
      }
      /**
       * -pi to pi
       */
      static angleBetween(v1, v2) {
        let angleBetween = v1.angle() - v2.angle();
        if (angleBetween > Math.PI) {
          angleBetween -= 2 * Math.PI;
        } else if (angleBetween <= -Math.PI) {
          angleBetween += 2 * Math.PI;
        }
        return angleBetween;
      }
      /**
       * Tests whether a point lies to the left of a line
       * @param  {Vector} linePoint     Point on the line
       * @param  {Vector} lineDirection
       * @param  {Vector} point
       * @return {Vector}               true if left, false otherwise
       */
      static isLeft(linePoint, lineDirection, point) {
        const perpendicularVector = new _Vector(lineDirection.y, -lineDirection.x);
        return point.clone().sub(linePoint).dot(perpendicularVector) < 0;
      }
      add(v) {
        this.x += v.x;
        this.y += v.y;
        return this;
      }
      /**
       * Angle in radians to positive x-axis between -pi and pi
       */
      angle() {
        return Math.atan2(this.y, this.x);
      }
      clone() {
        return new _Vector(this.x, this.y);
      }
      copy(v) {
        this.x = v.x;
        this.y = v.y;
        return this;
      }
      cross(v) {
        return this.x * v.y - this.y * v.x;
      }
      distanceTo(v) {
        return Math.sqrt(this.distanceToSquared(v));
      }
      distanceToSquared(v) {
        const dx = this.x - v.x;
        const dy = this.y - v.y;
        return dx * dx + dy * dy;
      }
      divide(v) {
        if (v.x === 0 || v.y === 0) {
          log.warn("Division by zero");
          return this;
        }
        this.x /= v.x;
        this.y /= v.y;
        return this;
      }
      divideScalar(s) {
        if (s === 0) {
          log.warn("Division by zero");
          return this;
        }
        return this.multiplyScalar(1 / s);
      }
      dot(v) {
        return this.x * v.x + this.y * v.y;
      }
      equals(v) {
        return v.x === this.x && v.y === this.y;
      }
      length() {
        return Math.sqrt(this.lengthSq());
      }
      lengthSq() {
        return this.x * this.x + this.y * this.y;
      }
      multiply(v) {
        this.x *= v.x;
        this.y *= v.y;
        return this;
      }
      multiplyScalar(s) {
        this.x *= s;
        this.y *= s;
        return this;
      }
      negate() {
        return this.multiplyScalar(-1);
      }
      normalize() {
        const l = this.length();
        if (l === 0) {
          log.warn("Zero Vector");
          return this;
        }
        return this.divideScalar(this.length());
      }
      /**
       * Angle in radians
       */
      rotateAround(center, angle) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const x = this.x - center.x;
        const y = this.y - center.y;
        this.x = x * cos - y * sin + center.x;
        this.y = x * sin + y * cos + center.y;
        return this;
      }
      set(v) {
        this.x = v.x;
        this.y = v.y;
        return this;
      }
      setX(x) {
        this.x = x;
        return this;
      }
      setY(y) {
        this.y = y;
        return this;
      }
      setLength(length) {
        return this.normalize().multiplyScalar(length);
      }
      sub(v) {
        this.x -= v.x;
        this.y -= v.y;
        return this;
      }
    };
    exports.default = Vector2;
  }
});

// cjs/impl/tensor.js
var require_tensor = __commonJS({
  "cjs/impl/tensor.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var vector_1 = require_vector();
    var Tensor2 = class _Tensor {
      constructor(r, matrix) {
        this.r = r;
        this.matrix = matrix;
        this.oldTheta = false;
        this._theta = this.calculateTheta();
      }
      static fromAngle(angle) {
        return new _Tensor(1, [Math.cos(angle * 4), Math.sin(angle * 4)]);
      }
      static fromVector(vector2) {
        const t1 = vector2.x ** 2 - vector2.y ** 2;
        const t2 = 2 * vector2.x * vector2.y;
        const t3 = t1 ** 2 - t2 ** 2;
        const t4 = 2 * t1 * t2;
        return new _Tensor(1, [t3, t4]);
      }
      static get zero() {
        return new _Tensor(0, [0, 0]);
      }
      get theta() {
        if (this.oldTheta) {
          this._theta = this.calculateTheta();
          this.oldTheta = false;
        }
        return this._theta;
      }
      add(tensor2, smooth) {
        this.matrix = this.matrix.map((v, i) => v * this.r + tensor2.matrix[i] * tensor2.r);
        if (smooth) {
          this.r = Math.hypot(...this.matrix);
          this.matrix = this.matrix.map((v) => v / this.r);
        } else {
          this.r = 2;
        }
        this.oldTheta = true;
        return this;
      }
      scale(s) {
        this.r *= s;
        this.oldTheta = true;
        return this;
      }
      // Radians
      rotate(theta) {
        if (theta === 0) {
          return this;
        }
        let newTheta = this.theta + theta;
        if (newTheta < Math.PI) {
          newTheta += Math.PI;
        }
        if (newTheta >= Math.PI) {
          newTheta -= Math.PI;
        }
        this.matrix[0] = Math.cos(2 * newTheta) * this.r;
        this.matrix[1] = Math.sin(2 * newTheta) * this.r;
        this._theta = newTheta;
        return this;
      }
      getMajor() {
        if (this.r === 0) {
          return vector_1.default.zeroVector();
        }
        return new vector_1.default(Math.cos(this.theta), Math.sin(this.theta));
      }
      getMinor() {
        if (this.r === 0) {
          return vector_1.default.zeroVector();
        }
        const angle = this.theta + Math.PI / 2;
        return new vector_1.default(Math.cos(angle), Math.sin(angle));
      }
      calculateTheta() {
        if (this.r === 0) {
          return 0;
        }
        return Math.atan2(this.matrix[1] / this.r, this.matrix[0] / this.r) / 2;
      }
    };
    exports.default = Tensor2;
  }
});

// cjs/impl/basis_field.js
var require_basis_field = __commonJS({
  "cjs/impl/basis_field.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Radial = exports.Grid = exports.BasisField = exports.FIELD_TYPE = void 0;
    var tensor_1 = require_tensor();
    var FIELD_TYPE2;
    (function(FIELD_TYPE3) {
      FIELD_TYPE3[FIELD_TYPE3["Radial"] = 0] = "Radial";
      FIELD_TYPE3[FIELD_TYPE3["Grid"] = 1] = "Grid";
    })(FIELD_TYPE2 || (exports.FIELD_TYPE = FIELD_TYPE2 = {}));
    var BasisField2 = class {
      constructor(centre, _size, _decay) {
        this._size = _size;
        this._decay = _decay;
        this._centre = centre.clone();
      }
      set centre(centre) {
        this._centre.copy(centre);
      }
      get centre() {
        return this._centre.clone();
      }
      set decay(decay) {
        this._decay = decay;
      }
      set size(size) {
        this._size = size;
      }
      dragStartListener() {
        this.setFolder();
      }
      dragMoveListener(delta) {
        this._centre.add(delta);
      }
      getWeightedTensor(point, smooth) {
        return this.getTensor(point).scale(this.getTensorWeight(point, smooth));
      }
      setFolder() {
        if (this.parentFolder.__folders) {
          for (const folderName in this.parentFolder.__folders) {
            this.parentFolder.__folders[folderName].close();
          }
          this.folder.open();
        }
      }
      removeFolderFromParent() {
        if (this.parentFolder.__folders && Object.values(this.parentFolder.__folders).indexOf(this.folder) >= 0) {
          this.parentFolder.removeFolder(this.folder);
        }
      }
      /**
       * Creates a folder and adds it to the GUI to control params
       */
      setGui(parent, folder) {
        this.parentFolder = parent;
        this.folder = folder;
        folder.add(this._centre, "x");
        folder.add(this._centre, "y");
        folder.add(this, "_size");
        folder.add(this, "_decay", -50, 50);
      }
      /**
       * Interpolates between (0 and 1)^decay
       */
      getTensorWeight(point, smooth) {
        const normDistanceToCentre = point.clone().sub(this._centre).length() / this._size;
        if (smooth) {
          return normDistanceToCentre ** -this._decay;
        }
        if (this._decay === 0 && normDistanceToCentre >= 1) {
          return 0;
        }
        return Math.max(0, 1 - normDistanceToCentre) ** this._decay;
      }
    };
    exports.BasisField = BasisField2;
    BasisField2.folderNameIndex = 0;
    var Grid2 = class _Grid extends BasisField2 {
      constructor(centre, size, decay, _theta) {
        super(centre, size, decay);
        this._theta = _theta;
        this.FOLDER_NAME = `Grid ${_Grid.folderNameIndex++}`;
        this.FIELD_TYPE = FIELD_TYPE2.Grid;
      }
      set theta(theta) {
        this._theta = theta;
      }
      setGui(parent, folder) {
        super.setGui(parent, folder);
        const thetaProp = { theta: this._theta * 180 / Math.PI };
        const thetaController = folder.add(thetaProp, "theta", -90, 90);
        thetaController.onChange((theta) => this._theta = theta * (Math.PI / 180));
      }
      getTensor(point) {
        const cos = Math.cos(2 * this._theta);
        const sin = Math.sin(2 * this._theta);
        return new tensor_1.default(1, [cos, sin]);
      }
    };
    exports.Grid = Grid2;
    var Radial2 = class _Radial extends BasisField2 {
      constructor(centre, size, decay) {
        super(centre, size, decay);
        this.FOLDER_NAME = `Radial ${_Radial.folderNameIndex++}`;
        this.FIELD_TYPE = FIELD_TYPE2.Radial;
      }
      getTensor(point) {
        const t = point.clone().sub(this._centre);
        const t1 = t.y ** 2 - t.x ** 2;
        const t2 = -2 * t.x * t.y;
        return new tensor_1.default(1, [t1, t2]);
      }
    };
    exports.Radial = Radial2;
  }
});

// node_modules/simplex-noise/simplex-noise.js
var require_simplex_noise = __commonJS({
  "node_modules/simplex-noise/simplex-noise.js"(exports, module) {
    (function() {
      "use strict";
      var F2 = 0.5 * (Math.sqrt(3) - 1);
      var G2 = (3 - Math.sqrt(3)) / 6;
      var F3 = 1 / 3;
      var G3 = 1 / 6;
      var F4 = (Math.sqrt(5) - 1) / 4;
      var G4 = (5 - Math.sqrt(5)) / 20;
      function SimplexNoise(randomOrSeed) {
        var random;
        if (typeof randomOrSeed == "function") {
          random = randomOrSeed;
        } else if (randomOrSeed) {
          random = alea(randomOrSeed);
        } else {
          random = Math.random;
        }
        this.p = buildPermutationTable(random);
        this.perm = new Uint8Array(512);
        this.permMod12 = new Uint8Array(512);
        for (var i = 0; i < 512; i++) {
          this.perm[i] = this.p[i & 255];
          this.permMod12[i] = this.perm[i] % 12;
        }
      }
      SimplexNoise.prototype = {
        grad3: new Float32Array([
          1,
          1,
          0,
          -1,
          1,
          0,
          1,
          -1,
          0,
          -1,
          -1,
          0,
          1,
          0,
          1,
          -1,
          0,
          1,
          1,
          0,
          -1,
          -1,
          0,
          -1,
          0,
          1,
          1,
          0,
          -1,
          1,
          0,
          1,
          -1,
          0,
          -1,
          -1
        ]),
        grad4: new Float32Array([
          0,
          1,
          1,
          1,
          0,
          1,
          1,
          -1,
          0,
          1,
          -1,
          1,
          0,
          1,
          -1,
          -1,
          0,
          -1,
          1,
          1,
          0,
          -1,
          1,
          -1,
          0,
          -1,
          -1,
          1,
          0,
          -1,
          -1,
          -1,
          1,
          0,
          1,
          1,
          1,
          0,
          1,
          -1,
          1,
          0,
          -1,
          1,
          1,
          0,
          -1,
          -1,
          -1,
          0,
          1,
          1,
          -1,
          0,
          1,
          -1,
          -1,
          0,
          -1,
          1,
          -1,
          0,
          -1,
          -1,
          1,
          1,
          0,
          1,
          1,
          1,
          0,
          -1,
          1,
          -1,
          0,
          1,
          1,
          -1,
          0,
          -1,
          -1,
          1,
          0,
          1,
          -1,
          1,
          0,
          -1,
          -1,
          -1,
          0,
          1,
          -1,
          -1,
          0,
          -1,
          1,
          1,
          1,
          0,
          1,
          1,
          -1,
          0,
          1,
          -1,
          1,
          0,
          1,
          -1,
          -1,
          0,
          -1,
          1,
          1,
          0,
          -1,
          1,
          -1,
          0,
          -1,
          -1,
          1,
          0,
          -1,
          -1,
          -1,
          0
        ]),
        noise2D: function(xin, yin) {
          var permMod12 = this.permMod12;
          var perm = this.perm;
          var grad3 = this.grad3;
          var n0 = 0;
          var n1 = 0;
          var n2 = 0;
          var s = (xin + yin) * F2;
          var i = Math.floor(xin + s);
          var j = Math.floor(yin + s);
          var t = (i + j) * G2;
          var X0 = i - t;
          var Y0 = j - t;
          var x0 = xin - X0;
          var y0 = yin - Y0;
          var i1, j1;
          if (x0 > y0) {
            i1 = 1;
            j1 = 0;
          } else {
            i1 = 0;
            j1 = 1;
          }
          var x1 = x0 - i1 + G2;
          var y1 = y0 - j1 + G2;
          var x2 = x0 - 1 + 2 * G2;
          var y2 = y0 - 1 + 2 * G2;
          var ii = i & 255;
          var jj = j & 255;
          var t0 = 0.5 - x0 * x0 - y0 * y0;
          if (t0 >= 0) {
            var gi0 = permMod12[ii + perm[jj]] * 3;
            t0 *= t0;
            n0 = t0 * t0 * (grad3[gi0] * x0 + grad3[gi0 + 1] * y0);
          }
          var t1 = 0.5 - x1 * x1 - y1 * y1;
          if (t1 >= 0) {
            var gi1 = permMod12[ii + i1 + perm[jj + j1]] * 3;
            t1 *= t1;
            n1 = t1 * t1 * (grad3[gi1] * x1 + grad3[gi1 + 1] * y1);
          }
          var t2 = 0.5 - x2 * x2 - y2 * y2;
          if (t2 >= 0) {
            var gi2 = permMod12[ii + 1 + perm[jj + 1]] * 3;
            t2 *= t2;
            n2 = t2 * t2 * (grad3[gi2] * x2 + grad3[gi2 + 1] * y2);
          }
          return 70 * (n0 + n1 + n2);
        },
        // 3D simplex noise
        noise3D: function(xin, yin, zin) {
          var permMod12 = this.permMod12;
          var perm = this.perm;
          var grad3 = this.grad3;
          var n0, n1, n2, n3;
          var s = (xin + yin + zin) * F3;
          var i = Math.floor(xin + s);
          var j = Math.floor(yin + s);
          var k = Math.floor(zin + s);
          var t = (i + j + k) * G3;
          var X0 = i - t;
          var Y0 = j - t;
          var Z0 = k - t;
          var x0 = xin - X0;
          var y0 = yin - Y0;
          var z0 = zin - Z0;
          var i1, j1, k1;
          var i2, j2, k2;
          if (x0 >= y0) {
            if (y0 >= z0) {
              i1 = 1;
              j1 = 0;
              k1 = 0;
              i2 = 1;
              j2 = 1;
              k2 = 0;
            } else if (x0 >= z0) {
              i1 = 1;
              j1 = 0;
              k1 = 0;
              i2 = 1;
              j2 = 0;
              k2 = 1;
            } else {
              i1 = 0;
              j1 = 0;
              k1 = 1;
              i2 = 1;
              j2 = 0;
              k2 = 1;
            }
          } else {
            if (y0 < z0) {
              i1 = 0;
              j1 = 0;
              k1 = 1;
              i2 = 0;
              j2 = 1;
              k2 = 1;
            } else if (x0 < z0) {
              i1 = 0;
              j1 = 1;
              k1 = 0;
              i2 = 0;
              j2 = 1;
              k2 = 1;
            } else {
              i1 = 0;
              j1 = 1;
              k1 = 0;
              i2 = 1;
              j2 = 1;
              k2 = 0;
            }
          }
          var x1 = x0 - i1 + G3;
          var y1 = y0 - j1 + G3;
          var z1 = z0 - k1 + G3;
          var x2 = x0 - i2 + 2 * G3;
          var y2 = y0 - j2 + 2 * G3;
          var z2 = z0 - k2 + 2 * G3;
          var x3 = x0 - 1 + 3 * G3;
          var y3 = y0 - 1 + 3 * G3;
          var z3 = z0 - 1 + 3 * G3;
          var ii = i & 255;
          var jj = j & 255;
          var kk = k & 255;
          var t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
          if (t0 < 0) n0 = 0;
          else {
            var gi0 = permMod12[ii + perm[jj + perm[kk]]] * 3;
            t0 *= t0;
            n0 = t0 * t0 * (grad3[gi0] * x0 + grad3[gi0 + 1] * y0 + grad3[gi0 + 2] * z0);
          }
          var t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
          if (t1 < 0) n1 = 0;
          else {
            var gi1 = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3;
            t1 *= t1;
            n1 = t1 * t1 * (grad3[gi1] * x1 + grad3[gi1 + 1] * y1 + grad3[gi1 + 2] * z1);
          }
          var t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
          if (t2 < 0) n2 = 0;
          else {
            var gi2 = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3;
            t2 *= t2;
            n2 = t2 * t2 * (grad3[gi2] * x2 + grad3[gi2 + 1] * y2 + grad3[gi2 + 2] * z2);
          }
          var t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
          if (t3 < 0) n3 = 0;
          else {
            var gi3 = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3;
            t3 *= t3;
            n3 = t3 * t3 * (grad3[gi3] * x3 + grad3[gi3 + 1] * y3 + grad3[gi3 + 2] * z3);
          }
          return 32 * (n0 + n1 + n2 + n3);
        },
        // 4D simplex noise, better simplex rank ordering method 2012-03-09
        noise4D: function(x, y, z, w) {
          var perm = this.perm;
          var grad4 = this.grad4;
          var n0, n1, n2, n3, n4;
          var s = (x + y + z + w) * F4;
          var i = Math.floor(x + s);
          var j = Math.floor(y + s);
          var k = Math.floor(z + s);
          var l = Math.floor(w + s);
          var t = (i + j + k + l) * G4;
          var X0 = i - t;
          var Y0 = j - t;
          var Z0 = k - t;
          var W0 = l - t;
          var x0 = x - X0;
          var y0 = y - Y0;
          var z0 = z - Z0;
          var w0 = w - W0;
          var rankx = 0;
          var ranky = 0;
          var rankz = 0;
          var rankw = 0;
          if (x0 > y0) rankx++;
          else ranky++;
          if (x0 > z0) rankx++;
          else rankz++;
          if (x0 > w0) rankx++;
          else rankw++;
          if (y0 > z0) ranky++;
          else rankz++;
          if (y0 > w0) ranky++;
          else rankw++;
          if (z0 > w0) rankz++;
          else rankw++;
          var i1, j1, k1, l1;
          var i2, j2, k2, l2;
          var i3, j3, k3, l3;
          i1 = rankx >= 3 ? 1 : 0;
          j1 = ranky >= 3 ? 1 : 0;
          k1 = rankz >= 3 ? 1 : 0;
          l1 = rankw >= 3 ? 1 : 0;
          i2 = rankx >= 2 ? 1 : 0;
          j2 = ranky >= 2 ? 1 : 0;
          k2 = rankz >= 2 ? 1 : 0;
          l2 = rankw >= 2 ? 1 : 0;
          i3 = rankx >= 1 ? 1 : 0;
          j3 = ranky >= 1 ? 1 : 0;
          k3 = rankz >= 1 ? 1 : 0;
          l3 = rankw >= 1 ? 1 : 0;
          var x1 = x0 - i1 + G4;
          var y1 = y0 - j1 + G4;
          var z1 = z0 - k1 + G4;
          var w1 = w0 - l1 + G4;
          var x2 = x0 - i2 + 2 * G4;
          var y2 = y0 - j2 + 2 * G4;
          var z2 = z0 - k2 + 2 * G4;
          var w2 = w0 - l2 + 2 * G4;
          var x3 = x0 - i3 + 3 * G4;
          var y3 = y0 - j3 + 3 * G4;
          var z3 = z0 - k3 + 3 * G4;
          var w3 = w0 - l3 + 3 * G4;
          var x4 = x0 - 1 + 4 * G4;
          var y4 = y0 - 1 + 4 * G4;
          var z4 = z0 - 1 + 4 * G4;
          var w4 = w0 - 1 + 4 * G4;
          var ii = i & 255;
          var jj = j & 255;
          var kk = k & 255;
          var ll = l & 255;
          var t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0 - w0 * w0;
          if (t0 < 0) n0 = 0;
          else {
            var gi0 = perm[ii + perm[jj + perm[kk + perm[ll]]]] % 32 * 4;
            t0 *= t0;
            n0 = t0 * t0 * (grad4[gi0] * x0 + grad4[gi0 + 1] * y0 + grad4[gi0 + 2] * z0 + grad4[gi0 + 3] * w0);
          }
          var t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1 - w1 * w1;
          if (t1 < 0) n1 = 0;
          else {
            var gi1 = perm[ii + i1 + perm[jj + j1 + perm[kk + k1 + perm[ll + l1]]]] % 32 * 4;
            t1 *= t1;
            n1 = t1 * t1 * (grad4[gi1] * x1 + grad4[gi1 + 1] * y1 + grad4[gi1 + 2] * z1 + grad4[gi1 + 3] * w1);
          }
          var t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2 - w2 * w2;
          if (t2 < 0) n2 = 0;
          else {
            var gi2 = perm[ii + i2 + perm[jj + j2 + perm[kk + k2 + perm[ll + l2]]]] % 32 * 4;
            t2 *= t2;
            n2 = t2 * t2 * (grad4[gi2] * x2 + grad4[gi2 + 1] * y2 + grad4[gi2 + 2] * z2 + grad4[gi2 + 3] * w2);
          }
          var t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3 - w3 * w3;
          if (t3 < 0) n3 = 0;
          else {
            var gi3 = perm[ii + i3 + perm[jj + j3 + perm[kk + k3 + perm[ll + l3]]]] % 32 * 4;
            t3 *= t3;
            n3 = t3 * t3 * (grad4[gi3] * x3 + grad4[gi3 + 1] * y3 + grad4[gi3 + 2] * z3 + grad4[gi3 + 3] * w3);
          }
          var t4 = 0.6 - x4 * x4 - y4 * y4 - z4 * z4 - w4 * w4;
          if (t4 < 0) n4 = 0;
          else {
            var gi4 = perm[ii + 1 + perm[jj + 1 + perm[kk + 1 + perm[ll + 1]]]] % 32 * 4;
            t4 *= t4;
            n4 = t4 * t4 * (grad4[gi4] * x4 + grad4[gi4 + 1] * y4 + grad4[gi4 + 2] * z4 + grad4[gi4 + 3] * w4);
          }
          return 27 * (n0 + n1 + n2 + n3 + n4);
        }
      };
      function buildPermutationTable(random) {
        var i;
        var p = new Uint8Array(256);
        for (i = 0; i < 256; i++) {
          p[i] = i;
        }
        for (i = 0; i < 255; i++) {
          var r = i + ~~(random() * (256 - i));
          var aux = p[i];
          p[i] = p[r];
          p[r] = aux;
        }
        return p;
      }
      SimplexNoise._buildPermutationTable = buildPermutationTable;
      function alea() {
        var s0 = 0;
        var s1 = 0;
        var s2 = 0;
        var c = 1;
        var mash = masher();
        s0 = mash(" ");
        s1 = mash(" ");
        s2 = mash(" ");
        for (var i = 0; i < arguments.length; i++) {
          s0 -= mash(arguments[i]);
          if (s0 < 0) {
            s0 += 1;
          }
          s1 -= mash(arguments[i]);
          if (s1 < 0) {
            s1 += 1;
          }
          s2 -= mash(arguments[i]);
          if (s2 < 0) {
            s2 += 1;
          }
        }
        mash = null;
        return function() {
          var t = 2091639 * s0 + c * 23283064365386963e-26;
          s0 = s1;
          s1 = s2;
          return s2 = t - (c = t | 0);
        };
      }
      function masher() {
        var n = 4022871197;
        return function(data) {
          data = data.toString();
          for (var i = 0; i < data.length; i++) {
            n += data.charCodeAt(i);
            var h = 0.02519603282416938 * n;
            n = h >>> 0;
            h -= n;
            h *= n;
            n = h >>> 0;
            h -= n;
            n += h * 4294967296;
          }
          return (n >>> 0) * 23283064365386963e-26;
        };
      }
      if (typeof define !== "undefined" && define.amd) define(function() {
        return SimplexNoise;
      });
      if (typeof exports !== "undefined") exports.SimplexNoise = SimplexNoise;
      else if (typeof window !== "undefined") window.SimplexNoise = SimplexNoise;
      if (typeof module !== "undefined") {
        module.exports = SimplexNoise;
      }
    })();
  }
});

// node_modules/polyk/index.js
var require_polyk = __commonJS({
  "node_modules/polyk/index.js"(exports, module) {
    function IsSimple(polygon) {
      var p = polygon;
      var n = p.length >> 1;
      if (n < 4) return true;
      var a1 = Point();
      var a2 = Point();
      var b1 = Point();
      var b2 = Point();
      var c = Point();
      for (var i = 0; i < n; i++) {
        a1.x = p[2 * i];
        a1.y = p[2 * i + 1];
        if (i == n - 1) {
          a2.x = p[0];
          a2.y = p[1];
        } else {
          a2.x = p[2 * i + 2];
          a2.y = p[2 * i + 3];
        }
        for (var j = 0; j < n; j++) {
          if (Math.abs(i - j) < 2) continue;
          if (j == n - 1 && i == 0) continue;
          if (i == n - 1 && j == 0) continue;
          b1.x = p[2 * j];
          b1.y = p[2 * j + 1];
          if (j == n - 1) {
            b2.x = p[0];
            b2.y = p[1];
          } else {
            b2.x = p[2 * j + 2];
            b2.y = p[2 * j + 3];
          }
          if (GetLineIntersection(a1, a2, b1, b2, c) != null) return false;
        }
      }
      return true;
    }
    module.exports.IsSimple = IsSimple;
    function IsConvex(polygon) {
      var p = polygon;
      if (p.length < 6) return true;
      var l = p.length - 4;
      for (var i = 0; i < l; i += 2) {
        if (!convex(p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5])) return false;
      }
      if (!convex(p[l], p[l + 1], p[l + 2], p[l + 3], p[0], p[1])) return false;
      if (!convex(p[l + 2], p[l + 3], p[0], p[1], p[2], p[3])) return false;
      return true;
    }
    module.exports.IsConvex = IsConvex;
    function GetArea(polygon) {
      var p = polygon;
      if (p.length < 6) return 0;
      var l = p.length - 2;
      var sum = 0;
      for (var i = 0; i < l; i += 2) {
        sum += (p[i + 2] - p[i]) * (p[i + 1] + p[i + 3]);
      }
      sum += (p[0] - p[l]) * (p[l + 1] + p[1]);
      return -sum * 0.5;
    }
    module.exports.GetArea = GetArea;
    function GetAABB(polygon) {
      var p = polygon;
      var minx = Infinity;
      var miny = Infinity;
      var maxx = -minx;
      var maxy = -miny;
      for (var i = 0; i < p.length; i += 2) {
        minx = Math.min(minx, p[i]);
        maxx = Math.max(maxx, p[i]);
        miny = Math.min(miny, p[i + 1]);
        maxy = Math.max(maxy, p[i + 1]);
      }
      return { x: minx, y: miny, width: maxx - minx, height: maxy - miny };
    }
    module.exports.GetAABB = GetAABB;
    function Triangulate(polygon) {
      var p = polygon;
      var n = p.length >> 1;
      if (n < 3) return [];
      var tgs = [];
      var avl = [];
      for (var i = 0; i < n; i++) {
        avl.push(i);
      }
      var i = 0;
      var al = n;
      while (al > 3) {
        var i0 = avl[(i + 0) % al];
        var i1 = avl[(i + 1) % al];
        var i2 = avl[(i + 2) % al];
        var ax = p[2 * i0];
        var ay = p[2 * i0 + 1];
        var bx = p[2 * i1];
        var by = p[2 * i1 + 1];
        var cx = p[2 * i2];
        var cy = p[2 * i2 + 1];
        var earFound = false;
        if (convex(ax, ay, bx, by, cx, cy)) {
          earFound = true;
          for (var j = 0; j < al; j++) {
            var vi = avl[j];
            if (vi == i0 || vi == i1 || vi == i2) continue;
            if (PointInTriangle(p[2 * vi], p[2 * vi + 1], ax, ay, bx, by, cx, cy)) {
              earFound = false;
              break;
            }
          }
        }
        if (earFound) {
          tgs.push(i0, i1, i2);
          avl.splice((i + 1) % al, 1);
          al--;
          i = 0;
        } else if (i++ > 3 * al) break;
      }
      tgs.push(avl[0], avl[1], avl[2]);
      return tgs;
    }
    module.exports.Triangulate = Triangulate;
    function Slice(polygon, startX, startY, endX, endY) {
      var p = polygon;
      var ax = startX;
      var ay = startY;
      var bx = endX;
      var by = endY;
      if (ContainsPoint(p, ax, ay) || ContainsPoint(p, bx, by)) {
        return [p.slice(0)];
      }
      var a = Point(ax, ay);
      var b = Point(bx, by);
      var iscs = [];
      var ps = [];
      for (var i = 0; i < p.length; i += 2) {
        ps.push(Point(p[i], p[i + 1]));
      }
      for (var i = 0; i < ps.length; i++) {
        var isc = Point(0, 0);
        isc = GetLineIntersection(a, b, ps[i], ps[(i + 1) % ps.length], isc);
        var fisc = iscs[0];
        var lisc = iscs[iscs.length - 1];
        if (isc && (fisc == null || distance(isc, fisc) > 1e-10) && (lisc == null || distance(isc, lisc) > 1e-10)) {
          isc.flag = true;
          iscs.push(isc);
          ps.splice(i + 1, 0, isc);
          i++;
        }
      }
      if (iscs.length < 2) return [p.slice(0)];
      var comp = function(u, v) {
        return distance(a, u) - distance(a, v);
      };
      iscs.sort(comp);
      var pgs = [];
      var dir = 0;
      while (iscs.length > 0) {
        var i0 = iscs[0];
        var i1 = iscs[1];
        var index0 = ps.indexOf(i0);
        var index1 = ps.indexOf(i1);
        var solved = false;
        if (firstWithFlag(ps, index0) === index1) {
          solved = true;
        } else {
          i0 = iscs[1];
          i1 = iscs[0];
          index0 = ps.indexOf(i0);
          index1 = ps.indexOf(i1);
          if (firstWithFlag(ps, index0) === index1) solved = true;
        }
        if (solved) {
          dir--;
          var pgn = getPoints(ps, index0, index1);
          pgs.push(pgn);
          ps = getPoints(ps, index1, index0);
          i0.flag = i1.flag = false;
          iscs.splice(0, 2);
          if (iscs.length == 0) pgs.push(ps);
        } else {
          dir++;
          iscs.reverse();
        }
        if (dir > 1) break;
      }
      var result = [];
      for (var i = 0; i < pgs.length; i++) {
        var pg = pgs[i];
        var npg = [];
        for (var j = 0; j < pg.length; j++) {
          npg.push(pg[j].x, pg[j].y);
        }
        result.push(npg);
      }
      return result;
    }
    module.exports.Slice = Slice;
    function ContainsPoint(polygon, pointX, pointY) {
      var p = polygon;
      var px = pointX;
      var py = pointY;
      var n = p.length >> 1;
      var ax;
      var ay = p[2 * n - 3] - py;
      var bx = p[2 * n - 2] - px;
      var by = p[2 * n - 1] - py;
      for (var i = 0; i < n; i++) {
        ax = bx;
        ay = by;
        bx = p[2 * i] - px;
        by = p[2 * i + 1] - py;
        if (ay === by) continue;
        var lup = by > ay;
      }
      var depth = 0;
      for (var i = 0; i < n; i++) {
        ax = bx;
        ay = by;
        bx = p[2 * i] - px;
        by = p[2 * i + 1] - py;
        if (ay < 0 && by < 0) continue;
        if (ay > 0 && by > 0) continue;
        if (ax < 0 && bx < 0) continue;
        if (ay === by && Math.min(ax, bx) <= 0) return true;
        if (ay === by) continue;
        var lx = ax + (bx - ax) * -ay / (by - ay);
        if (lx === 0) return true;
        if (lx > 0) depth++;
        if (ay === 0 && lup && by > ay) depth--;
        if (ay === 0 && !lup && by < ay) depth--;
        lup = by > ay;
      }
      return (depth & 1) === 1;
    }
    module.exports.ContainsPoint = ContainsPoint;
    function Raycast(polygon, originX, originY, directionX, directionY, isc) {
      var p = polygon;
      var x = originX;
      var y = originY;
      var dx = directionX;
      var dy = directionY;
      var l = p.length - 2;
      var empty = emptyPoints();
      var a1 = empty[0];
      var a2 = empty[1];
      var b1 = empty[2];
      var b2 = empty[3];
      var c = empty[4];
      a1.x = x;
      a1.y = y;
      a2.x = x + dx;
      a2.y = y + dy;
      if (isc === null || isc === void 0) {
        isc = { dist: 0, edge: 0, norm: { x: 0, y: 0 }, refl: { x: 0, y: 0 } };
      }
      isc.dist = Infinity;
      var nisc;
      for (var i = 0; i < l; i += 2) {
        b1.x = p[i];
        b1.y = p[i + 1];
        b2.x = p[i + 2];
        b2.y = p[i + 3];
        nisc = RayLineIntersection(a1, a2, b1, b2, c);
        if (nisc) {
          isc = updateISC(dx, dy, a1, b1, b2, c, i / 2, isc);
        }
      }
      b1.x = b2.x;
      b1.y = b2.y;
      b2.x = p[0];
      b2.y = p[1];
      nisc = RayLineIntersection(a1, a2, b1, b2, c);
      if (nisc) {
        isc = updateISC(dx, dy, a1, b1, b2, c, p.length / 2 - 1, isc);
      }
      return isc.dist !== Infinity ? isc : null;
    }
    module.exports.Raycast = Raycast;
    function ClosestEdge(polygon, x, y, isc) {
      var p = polygon;
      var l = p.length - 2;
      var empty = emptyPoints();
      var a1 = empty[0];
      var b1 = empty[2];
      var b2 = empty[3];
      a1.x = x;
      a1.y = y;
      if (isc == null) {
        isc = { dist: 0, edge: 0, point: { x: 0, y: 0 }, norm: { x: 0, y: 0 } };
      }
      isc.dist = Infinity;
      for (var i = 0; i < l; i += 2) {
        b1.x = p[i];
        b1.y = p[i + 1];
        b2.x = p[i + 2];
        b2.y = p[i + 3];
        isc = pointLineDist(a1, b1, b2, i >> 1, isc);
      }
      b1.x = b2.x;
      b1.y = b2.y;
      b2.x = p[0];
      b2.y = p[1];
      isc = pointLineDist(a1, b1, b2, l >> 1, isc);
      var idst = 1 / isc.dist;
      isc.norm.x = (x - isc.point.x) * idst;
      isc.norm.y = (y - isc.point.y) * idst;
      return isc;
    }
    module.exports.ClosestEdge = ClosestEdge;
    function Reverse(polygon) {
      var p = polygon;
      var np = [];
      for (var j = p.length - 2; j >= 0; j -= 2) {
        np.push(p[j], p[j + 1]);
      }
      return np;
    }
    module.exports.Reverse = Reverse;
    function pointLineDist(p, a, b, edge, isc) {
      var x = p.x;
      var y = p.y;
      var x1 = a.x;
      var y1 = a.y;
      var x2 = b.x;
      var y2 = b.y;
      var A = x - x1;
      var B = y - y1;
      var C = x2 - x1;
      var D = y2 - y1;
      var dot = A * C + B * D;
      var lenSq = C * C + D * D;
      var param = dot / lenSq;
      var xx;
      var yy;
      if (param < 0 || x1 == x2 && y1 == y2) {
        xx = x1;
        yy = y1;
      } else if (param > 1) {
        xx = x2;
        yy = y2;
      } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
      }
      var dx = x - xx;
      var dy = y - yy;
      var dst = Math.sqrt(dx * dx + dy * dy);
      if (dst < isc.dist) {
        isc.dist = dst;
        isc.edge = edge;
        isc.point.x = xx;
        isc.point.y = yy;
      }
      return isc;
    }
    function updateISC(dx, dy, a1, b1, b2, c, edge, isc) {
      var nrl = distance(a1, c);
      if (nrl < isc.dist) {
        var ibl = 1 / distance(b1, b2);
        var nx = -(b2.y - b1.y) * ibl;
        var ny = (b2.x - b1.x) * ibl;
        var ddot = 2 * (dx * nx + dy * ny);
        isc.dist = nrl;
        isc.norm.x = nx;
        isc.norm.y = ny;
        isc.refl.x = -ddot * nx + dx;
        isc.refl.y = -ddot * ny + dy;
        isc.edge = edge;
      }
      return isc;
    }
    function getPoints(points, index0, index1) {
      var n = points.length;
      var result = [];
      if (index1 < index0) index1 += n;
      for (var i = index0; i <= index1; i++) {
        result.push(points[i % n]);
      }
      return result;
    }
    function firstWithFlag(points, index) {
      var n = points.length;
      while (true) {
        index = (index + 1) % n;
        if (points[index].flag) {
          return index;
        }
      }
    }
    function PointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
      var v0x = cx - ax;
      var v0y = cy - ay;
      var v1x = bx - ax;
      var v1y = by - ay;
      var v2x = px - ax;
      var v2y = py - ay;
      var dot00 = v0x * v0x + v0y * v0y;
      var dot01 = v0x * v1x + v0y * v1y;
      var dot02 = v0x * v2x + v0y * v2y;
      var dot11 = v1x * v1x + v1y * v1y;
      var dot12 = v1x * v2x + v1y * v2y;
      var invDenom = 1 / (dot00 * dot11 - dot01 * dot01);
      var u = (dot11 * dot02 - dot01 * dot12) * invDenom;
      var v = (dot00 * dot12 - dot01 * dot02) * invDenom;
      return u >= 0 && v >= 0 && u + v < 1;
    }
    function RayLineIntersection(a1, a2, b1, b2, c) {
      var dax = a1.x - a2.x;
      var dbx = b1.x - b2.x;
      var day = a1.y - a2.y;
      var dby = b1.y - b2.y;
      var Den = dax * dby - day * dbx;
      if (Den == 0) return null;
      var A = a1.x * a2.y - a1.y * a2.x;
      var B = b1.x * b2.y - b1.y * b2.x;
      var I = c;
      var iDen = 1 / Den;
      I.x = (A * dbx - dax * B) * iDen;
      I.y = (A * dby - day * B) * iDen;
      if (!InRectangle(I, b1, b2)) return null;
      if (day > 0 && I.y > a1.y || day < 0 && I.y < a1.y) return null;
      if (dax > 0 && I.x > a1.x || dax < 0 && I.x < a1.x) return null;
      return I;
    }
    function GetLineIntersection(a1, a2, b1, b2, c) {
      var dax = a1.x - a2.x;
      var dbx = b1.x - b2.x;
      var day = a1.y - a2.y;
      var dby = b1.y - b2.y;
      var Den = dax * dby - day * dbx;
      if (Den === 0) {
        return null;
      }
      var A = a1.x * a2.y - a1.y * a2.x;
      var B = b1.x * b2.y - b1.y * b2.x;
      var I = c;
      I.x = (A * dbx - dax * B) / Den;
      I.y = (A * dby - day * B) / Den;
      if (InRectangle(I, a1, a2) && InRectangle(I, b1, b2)) {
        return I;
      }
      return null;
    }
    function InRectangle(a, b, c) {
      var minx = Math.min(b.x, c.x);
      var maxx = Math.max(b.x, c.x);
      var miny = Math.min(b.y, c.y);
      var maxy = Math.max(b.y, c.y);
      if (minx === maxx) {
        return miny <= a.y && a.y <= maxy;
      }
      if (miny === maxy) {
        return minx <= a.x && a.x <= maxx;
      }
      return minx <= a.x + 1e-10 && a.x - 1e-10 <= maxx && miny <= a.y + 1e-10 && a.y - 1e-10 <= maxy;
    }
    function convex(ax, ay, bx, by, cx, cy) {
      return (ay - by) * (cx - bx) + (bx - ax) * (cy - by) >= 0;
    }
    function Point(x, y) {
      return {
        x,
        y,
        flag: false,
        toString: function() {
          return "Point [" + x + ", " + y + "]";
        }
      };
    }
    function distance(a, b) {
      var dx = b.x - a.x;
      var dy = b.y - a.y;
      return Math.sqrt(dx * dx + dy * dy);
    }
    function emptyPoints(num) {
      num = num || 10;
      var container = [];
      for (var i = 0; i < num; i++) {
        container.push(Point(0, 0));
      }
      return container;
    }
  }
});

// node_modules/jsts/dist/jsts.min.js
var require_jsts_min = __commonJS({
  "node_modules/jsts/dist/jsts.min.js"(exports, module) {
    /**
     * JSTS. See https://github.com/bjornharrtell/jsts
     * https://github.com/bjornharrtell/jsts/blob/master/LICENSE_EDLv1.txt
     * https://github.com/bjornharrtell/jsts/blob/master/LICENSE_EPLv1.txt
     * https://github.com/bjornharrtell/jsts/blob/master/LICENSE_LICENSE_ES6_COLLECTIONS.txt
     * @license
     */
    !function(t, e) {
      "object" == typeof exports && "undefined" != typeof module ? e(exports) : "function" == typeof define && define.amd ? define(["exports"], e) : e((t = t || self).jsts = {});
    }(exports, function(t) {
      "use strict";
      class e {
        constructor() {
          e.constructor_.apply(this, arguments);
        }
        static equalsWithTolerance(t2, e2, n2) {
          return Math.abs(t2 - e2) <= n2;
        }
        getClass() {
          return e;
        }
        get interfaces_() {
          return [];
        }
      }
      function n(t2) {
        this.message = t2;
      }
      function s(t2, e2) {
        this.low = 0 | e2, this.high = 0 | t2;
      }
      function i() {
      }
      function r() {
      }
      function o() {
      }
      function l() {
      }
      function a() {
      }
      function c(t2) {
        this.name = "RuntimeException", this.message = t2, this.stack = new Error().stack, Error.call(this, t2);
      }
      e.constructor_ = function() {
      }, s.toBinaryString = function(t2) {
        let e2, n2 = "";
        for (e2 = 2147483648; e2 > 0; e2 >>>= 1) n2 += (t2.high & e2) === e2 ? "1" : "0";
        for (e2 = 2147483648; e2 > 0; e2 >>>= 1) n2 += (t2.low & e2) === e2 ? "1" : "0";
        return n2;
      }, i.isNaN = (t2) => Number.isNaN(t2), i.isInfinite = (t2) => !Number.isFinite(t2), i.MAX_VALUE = Number.MAX_VALUE, "function" == typeof Float64Array && "function" == typeof Int32Array ? function() {
        const t2 = new Float64Array(1), e2 = new Int32Array(t2.buffer);
        i.doubleToLongBits = function(n2) {
          t2[0] = n2;
          let i2 = 0 | e2[0], r2 = 0 | e2[1];
          return 2146435072 == (2146435072 & r2) && 0 != (1048575 & r2) && 0 !== i2 && (i2 = 0, r2 = 2146959360), new s(r2, i2);
        }, i.longBitsToDouble = function(n2) {
          return e2[0] = n2.low, e2[1] = n2.high, t2[0];
        };
      }() : function() {
        const t2 = Math.log2, e2 = Math.floor, n2 = Math.pow, r2 = function() {
          for (let s2 = 53; s2 > 0; s2--) {
            const i2 = n2(2, s2) - 1;
            if (e2(t2(i2)) + 1 === s2) return i2;
          }
          return 0;
        }();
        i.doubleToLongBits = function(i2) {
          let o2, l2, a2, c2, h2, u2, g2, d2, _2;
          if (i2 < 0 || 1 / i2 === Number.NEGATIVE_INFINITY ? (u2 = 1 << 31, i2 = -i2) : u2 = 0, 0 === i2) return _2 = 0, d2 = u2, new s(d2, _2);
          if (i2 === 1 / 0) return _2 = 0, d2 = 2146435072 | u2, new s(d2, _2);
          if (i2 != i2) return _2 = 0, d2 = 2146959360, new s(d2, _2);
          if (c2 = 0, _2 = 0, o2 = e2(i2), o2 > 1) if (o2 <= r2) c2 = e2(t2(o2)), c2 <= 20 ? (_2 = 0, d2 = o2 << 20 - c2 & 1048575) : (a2 = c2 - 20, l2 = n2(2, a2), _2 = o2 % l2 << 32 - a2, d2 = o2 / l2 & 1048575);
          else for (a2 = o2, _2 = 0; l2 = a2 / 2, a2 = e2(l2), 0 !== a2; ) c2++, _2 >>>= 1, _2 |= (1 & d2) << 31, d2 >>>= 1, l2 !== a2 && (d2 |= 524288);
          if (g2 = c2 + 1023, h2 = 0 === o2, o2 = i2 - o2, c2 < 52 && 0 !== o2) for (a2 = 0; ; ) {
            if (l2 = 2 * o2, l2 >= 1 ? (o2 = l2 - 1, h2 ? (g2--, h2 = false) : (a2 <<= 1, a2 |= 1, c2++)) : (o2 = l2, h2 ? 0 == --g2 && (c2++, h2 = false) : (a2 <<= 1, c2++)), 20 === c2) d2 |= a2, a2 = 0;
            else if (52 === c2) {
              _2 |= a2;
              break;
            }
            if (1 === l2) {
              c2 < 20 ? d2 |= a2 << 20 - c2 : c2 < 52 && (_2 |= a2 << 52 - c2);
              break;
            }
          }
          return d2 |= g2 << 20, d2 |= u2, new s(d2, _2);
        }, i.longBitsToDouble = function(t3) {
          let e3, s2, i2, r3, o2;
          const l2 = t3.high, a2 = t3.low;
          for (i2 = l2 & 1 << 31 ? -1 : 1, r3 = ((2146435072 & l2) >> 20) - 1023, o2 = 0, s2 = 1 << 19, e3 = 1; e3 <= 20; e3++) l2 & s2 && (o2 += n2(2, -e3)), s2 >>>= 1;
          for (s2 = 1 << 31, e3 = 21; e3 <= 52; e3++) a2 & s2 && (o2 += n2(2, -e3)), s2 >>>= 1;
          if (-1023 === r3) {
            if (0 === o2) return 0 * i2;
            r3 = -1022;
          } else {
            if (1024 === r3) return 0 === o2 ? i2 / 0 : NaN;
            o2 += 1;
          }
          return i2 * o2 * n2(2, r3);
        };
      }(), c.prototype = Object.create(Error.prototype), c.prototype.constructor = Error;
      class h extends c {
        constructor() {
          super(), h.constructor_.apply(this, arguments);
        }
        getClass() {
          return h;
        }
        get interfaces_() {
          return [];
        }
      }
      h.constructor_ = function() {
        if (0 === arguments.length) c.constructor_.call(this);
        else if (1 === arguments.length) {
          const t2 = arguments[0];
          c.constructor_.call(this, t2);
        }
      };
      class u {
        constructor() {
          u.constructor_.apply(this, arguments);
        }
        static shouldNeverReachHere() {
          if (0 === arguments.length) u.shouldNeverReachHere(null);
          else if (1 === arguments.length) {
            const t2 = arguments[0];
            throw new h("Should never reach here" + (null !== t2 ? ": " + t2 : ""));
          }
        }
        static isTrue() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            u.isTrue(t2, null);
          } else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            if (!t2) throw null === e2 ? new h() : new h(e2);
          }
        }
        static equals() {
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            u.equals(t2, e2, null);
          } else if (3 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
            if (!e2.equals(t2)) throw new h("Expected " + t2 + " but encountered " + e2 + (null !== n2 ? ": " + n2 : ""));
          }
        }
        getClass() {
          return u;
        }
        get interfaces_() {
          return [];
        }
      }
      u.constructor_ = function() {
      };
      class g {
        constructor() {
          g.constructor_.apply(this, arguments);
        }
        static hashCode() {
          if (1 === arguments.length && "number" == typeof arguments[0]) {
            const t2 = arguments[0], e2 = i.doubleToLongBits(t2);
            return Math.trunc(e2 ^ e2 >>> 32);
          }
        }
        setOrdinate(t2, e2) {
          switch (t2) {
            case g.X:
              this.x = e2;
              break;
            case g.Y:
              this.y = e2;
              break;
            case g.Z:
              this.z = e2;
              break;
            default:
              throw new n("Invalid ordinate index: " + t2);
          }
        }
        equals2D() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return this.x === t2.x && this.y === t2.y;
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], n2 = arguments[1];
            return !!e.equalsWithTolerance(this.x, t2.x, n2) && !!e.equalsWithTolerance(this.y, t2.y, n2);
          }
        }
        getOrdinate(t2) {
          switch (t2) {
            case g.X:
              return this.x;
            case g.Y:
              return this.y;
            case g.Z:
              return this.z;
          }
          throw new n("Invalid ordinate index: " + t2);
        }
        equals3D(t2) {
          return this.x === t2.x && this.y === t2.y && (this.z === t2.z || i.isNaN(this.z) && i.isNaN(t2.z));
        }
        equals(t2) {
          return t2 instanceof g && this.equals2D(t2);
        }
        equalInZ(t2, n2) {
          return e.equalsWithTolerance(this.z, t2.z, n2);
        }
        compareTo(t2) {
          const e2 = t2;
          return this.x < e2.x ? -1 : this.x > e2.x ? 1 : this.y < e2.y ? -1 : this.y > e2.y ? 1 : 0;
        }
        clone() {
          try {
            return null;
          } catch (t2) {
            if (t2 instanceof CloneNotSupportedException) return u.shouldNeverReachHere("this shouldn't happen because this class is Cloneable"), null;
            throw t2;
          }
        }
        copy() {
          return new g(this);
        }
        toString() {
          return "(" + this.x + ", " + this.y + ", " + this.z + ")";
        }
        distance3D(t2) {
          const e2 = this.x - t2.x, n2 = this.y - t2.y, s2 = this.z - t2.z;
          return Math.sqrt(e2 * e2 + n2 * n2 + s2 * s2);
        }
        distance(t2) {
          const e2 = this.x - t2.x, n2 = this.y - t2.y;
          return Math.sqrt(e2 * e2 + n2 * n2);
        }
        hashCode() {
          let t2 = 17;
          return t2 = 37 * t2 + g.hashCode(this.x), t2 = 37 * t2 + g.hashCode(this.y), t2;
        }
        setCoordinate(t2) {
          this.x = t2.x, this.y = t2.y, this.z = t2.z;
        }
        getClass() {
          return g;
        }
        get interfaces_() {
          return [r, o, a];
        }
      }
      class d {
        constructor() {
          d.constructor_.apply(this, arguments);
        }
        static compare(t2, e2) {
          return t2 < e2 ? -1 : t2 > e2 ? 1 : i.isNaN(t2) ? i.isNaN(e2) ? 0 : -1 : i.isNaN(e2) ? 1 : 0;
        }
        compare(t2, e2) {
          const n2 = t2, s2 = e2, i2 = d.compare(n2.x, s2.x);
          if (0 !== i2) return i2;
          const r2 = d.compare(n2.y, s2.y);
          return 0 !== r2 ? r2 : this._dimensionsToTest <= 2 ? 0 : d.compare(n2.z, s2.z);
        }
        getClass() {
          return d;
        }
        get interfaces_() {
          return [l];
        }
      }
      function _(t2, e2) {
        return t2.interfaces_ && t2.interfaces_.indexOf(e2) > -1;
      }
      function f() {
      }
      function p(t2) {
        this.message = t2 || "";
      }
      function m() {
      }
      function y(t2) {
        this.message = t2 || "";
      }
      function x() {
        this.array_ = [], arguments[0] instanceof f && this.addAll(arguments[0]);
      }
      d.constructor_ = function() {
        if (this._dimensionsToTest = 2, 0 === arguments.length) d.constructor_.call(this, 2);
        else if (1 === arguments.length) {
          const t2 = arguments[0];
          if (2 !== t2 && 3 !== t2) throw new n("only 2 or 3 dimensions may be specified");
          this._dimensionsToTest = t2;
        }
      }, g.DimensionalComparator = d, g.constructor_ = function() {
        if (this.x = null, this.y = null, this.z = null, 0 === arguments.length) g.constructor_.call(this, 0, 0);
        else if (1 === arguments.length) {
          const t2 = arguments[0];
          g.constructor_.call(this, t2.x, t2.y, t2.z);
        } else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          g.constructor_.call(this, t2, e2, g.NULL_ORDINATE);
        } else if (3 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
          this.x = t2, this.y = e2, this.z = n2;
        }
      }, g.serialVersionUID = 6683108902428367e3, g.NULL_ORDINATE = i.NaN, g.X = 0, g.Y = 1, g.Z = 2, f.prototype.add = function() {
      }, f.prototype.addAll = function() {
      }, f.prototype.isEmpty = function() {
      }, f.prototype.iterator = function() {
      }, f.prototype.size = function() {
      }, f.prototype.toArray = function() {
      }, f.prototype.remove = function() {
      }, p.prototype = new Error(), p.prototype.name = "IndexOutOfBoundsException", m.prototype = Object.create(f.prototype), m.prototype.constructor = m, m.prototype.get = function() {
      }, m.prototype.set = function() {
      }, m.prototype.isEmpty = function() {
      }, y.prototype = new Error(), y.prototype.name = "NoSuchElementException", x.prototype = Object.create(m.prototype), x.prototype.constructor = x, x.prototype.ensureCapacity = function() {
      }, x.prototype.interfaces_ = [m, f], x.prototype.add = function(t2) {
        return 1 === arguments.length ? this.array_.push(t2) : this.array_.splice(arguments[0], 0, arguments[1]), true;
      }, x.prototype.clear = function() {
        this.array_ = [];
      }, x.prototype.addAll = function(t2) {
        for (let e2 = t2.iterator(); e2.hasNext(); ) this.add(e2.next());
        return true;
      }, x.prototype.set = function(t2, e2) {
        const n2 = this.array_[t2];
        return this.array_[t2] = e2, n2;
      }, x.prototype.iterator = function() {
        return new E(this);
      }, x.prototype.get = function(t2) {
        if (t2 < 0 || t2 >= this.size()) throw new p();
        return this.array_[t2];
      }, x.prototype.isEmpty = function() {
        return 0 === this.array_.length;
      }, x.prototype.size = function() {
        return this.array_.length;
      }, x.prototype.toArray = function() {
        const t2 = [];
        for (let e2 = 0, n2 = this.array_.length; e2 < n2; e2++) t2.push(this.array_[e2]);
        return t2;
      }, x.prototype.remove = function(t2) {
        let e2 = false;
        for (let n2 = 0, s2 = this.array_.length; n2 < s2; n2++) if (this.array_[n2] === t2) {
          this.array_.splice(n2, 1), e2 = true;
          break;
        }
        return e2;
      }, x.prototype.removeAll = function(t2) {
        for (let e2 = t2.iterator(); e2.hasNext(); ) this.remove(e2.next());
        return true;
      };
      const E = function(t2) {
        this.arrayList_ = t2, this.position_ = 0;
      };
      E.prototype.next = function() {
        if (this.position_ === this.arrayList_.size()) throw new y();
        return this.arrayList_.get(this.position_++);
      }, E.prototype.hasNext = function() {
        return this.position_ < this.arrayList_.size();
      }, E.prototype.set = function(t2) {
        return this.arrayList_.set(this.position_ - 1, t2);
      }, E.prototype.remove = function() {
        this.arrayList_.remove(this.arrayList_.get(this.position_));
      };
      class I extends x {
        constructor() {
          super(), I.constructor_.apply(this, arguments);
        }
        getCoordinate(t2) {
          return this.get(t2);
        }
        addAll() {
          if (2 === arguments.length && "boolean" == typeof arguments[1] && _(arguments[0], f)) {
            const t2 = arguments[0], e2 = arguments[1];
            let n2 = false;
            for (let s2 = t2.iterator(); s2.hasNext(); ) this.add(s2.next(), e2), n2 = true;
            return n2;
          }
          return super.addAll.apply(this, arguments);
        }
        clone() {
          const t2 = super.clone.call(this);
          for (let e2 = 0; e2 < this.size(); e2++) t2.add(e2, this.get(e2).clone());
          return t2;
        }
        toCoordinateArray() {
          return this.toArray(I.coordArrayType);
        }
        add() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            super.add.call(this, t2);
          } else if (2 === arguments.length) {
            if (arguments[0] instanceof Array && "boolean" == typeof arguments[1]) {
              const t2 = arguments[0], e2 = arguments[1];
              return this.add(t2, e2, true), true;
            }
            if (arguments[0] instanceof g && "boolean" == typeof arguments[1]) {
              const t2 = arguments[0];
              if (!arguments[1] && this.size() >= 1) {
                if (this.get(this.size() - 1).equals2D(t2)) return null;
              }
              super.add.call(this, t2);
            } else if (arguments[0] instanceof Object && "boolean" == typeof arguments[1]) {
              const t2 = arguments[0], e2 = arguments[1];
              return this.add(t2, e2), true;
            }
          } else if (3 === arguments.length) {
            if ("boolean" == typeof arguments[2] && arguments[0] instanceof Array && "boolean" == typeof arguments[1]) {
              const t2 = arguments[0], e2 = arguments[1];
              if (arguments[2]) for (let n2 = 0; n2 < t2.length; n2++) this.add(t2[n2], e2);
              else for (let n2 = t2.length - 1; n2 >= 0; n2--) this.add(t2[n2], e2);
              return true;
            }
            if ("boolean" == typeof arguments[2] && Number.isInteger(arguments[0]) && arguments[1] instanceof g) {
              const t2 = arguments[0], e2 = arguments[1];
              if (!arguments[2]) {
                const n2 = this.size();
                if (n2 > 0) {
                  if (t2 > 0) {
                    if (this.get(t2 - 1).equals2D(e2)) return null;
                  }
                  if (t2 < n2) {
                    if (this.get(t2).equals2D(e2)) return null;
                  }
                }
              }
              super.add.call(this, t2, e2);
            }
          } else if (4 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3];
            let i2 = 1;
            n2 > s2 && (i2 = -1);
            for (let r2 = n2; r2 !== s2; r2 += i2) this.add(t2[r2], e2);
            return true;
          }
        }
        closeRing() {
          this.size() > 0 && this.add(new g(this.get(0)), false);
        }
        getClass() {
          return I;
        }
        get interfaces_() {
          return [];
        }
      }
      I.constructor_ = function() {
        if (0 === arguments.length) ;
        else if (1 === arguments.length) {
          const t2 = arguments[0];
          this.ensureCapacity(t2.length), this.add(t2, true);
        } else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          this.ensureCapacity(t2.length), this.add(t2, e2);
        }
      }, I.coordArrayType = new Array(0).fill(null);
      class N {
        constructor() {
          N.constructor_.apply(this, arguments);
        }
        static intersects() {
          if (3 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
            return n2.x >= (t2.x < e2.x ? t2.x : e2.x) && n2.x <= (t2.x > e2.x ? t2.x : e2.x) && n2.y >= (t2.y < e2.y ? t2.y : e2.y) && n2.y <= (t2.y > e2.y ? t2.y : e2.y);
          }
          if (4 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3];
            let i2 = Math.min(n2.x, s2.x), r2 = Math.max(n2.x, s2.x), o2 = Math.min(t2.x, e2.x), l2 = Math.max(t2.x, e2.x);
            return !(o2 > r2) && (!(l2 < i2) && (i2 = Math.min(n2.y, s2.y), r2 = Math.max(n2.y, s2.y), o2 = Math.min(t2.y, e2.y), l2 = Math.max(t2.y, e2.y), !(o2 > r2) && !(l2 < i2)));
          }
        }
        getArea() {
          return this.getWidth() * this.getHeight();
        }
        equals(t2) {
          if (!(t2 instanceof N)) return false;
          const e2 = t2;
          return this.isNull() ? e2.isNull() : this._maxx === e2.getMaxX() && this._maxy === e2.getMaxY() && this._minx === e2.getMinX() && this._miny === e2.getMinY();
        }
        intersection(t2) {
          if (this.isNull() || t2.isNull() || !this.intersects(t2)) return new N();
          const e2 = this._minx > t2._minx ? this._minx : t2._minx, n2 = this._miny > t2._miny ? this._miny : t2._miny, s2 = this._maxx < t2._maxx ? this._maxx : t2._maxx, i2 = this._maxy < t2._maxy ? this._maxy : t2._maxy;
          return new N(e2, s2, n2, i2);
        }
        isNull() {
          return this._maxx < this._minx;
        }
        getMaxX() {
          return this._maxx;
        }
        covers() {
          if (1 === arguments.length) {
            if (arguments[0] instanceof g) {
              const t2 = arguments[0];
              return this.covers(t2.x, t2.y);
            }
            if (arguments[0] instanceof N) {
              const t2 = arguments[0];
              return !this.isNull() && !t2.isNull() && (t2.getMinX() >= this._minx && t2.getMaxX() <= this._maxx && t2.getMinY() >= this._miny && t2.getMaxY() <= this._maxy);
            }
          } else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return !this.isNull() && (t2 >= this._minx && t2 <= this._maxx && e2 >= this._miny && e2 <= this._maxy);
          }
        }
        intersects() {
          if (1 === arguments.length) {
            if (arguments[0] instanceof N) {
              const t2 = arguments[0];
              return !this.isNull() && !t2.isNull() && !(t2._minx > this._maxx || t2._maxx < this._minx || t2._miny > this._maxy || t2._maxy < this._miny);
            }
            if (arguments[0] instanceof g) {
              const t2 = arguments[0];
              return this.intersects(t2.x, t2.y);
            }
          } else if (2 === arguments.length) {
            if (arguments[0] instanceof g && arguments[1] instanceof g) {
              const t2 = arguments[0], e2 = arguments[1];
              return !this.isNull() && (!((t2.x < e2.x ? t2.x : e2.x) > this._maxx) && (!((t2.x > e2.x ? t2.x : e2.x) < this._minx) && (!((t2.y < e2.y ? t2.y : e2.y) > this._maxy) && !((t2.y > e2.y ? t2.y : e2.y) < this._miny))));
            }
            if ("number" == typeof arguments[0] && "number" == typeof arguments[1]) {
              const t2 = arguments[0], e2 = arguments[1];
              return !this.isNull() && !(t2 > this._maxx || t2 < this._minx || e2 > this._maxy || e2 < this._miny);
            }
          }
        }
        getMinY() {
          return this._miny;
        }
        getMinX() {
          return this._minx;
        }
        expandToInclude() {
          if (1 === arguments.length) {
            if (arguments[0] instanceof g) {
              const t2 = arguments[0];
              this.expandToInclude(t2.x, t2.y);
            } else if (arguments[0] instanceof N) {
              const t2 = arguments[0];
              if (t2.isNull()) return null;
              this.isNull() ? (this._minx = t2.getMinX(), this._maxx = t2.getMaxX(), this._miny = t2.getMinY(), this._maxy = t2.getMaxY()) : (t2._minx < this._minx && (this._minx = t2._minx), t2._maxx > this._maxx && (this._maxx = t2._maxx), t2._miny < this._miny && (this._miny = t2._miny), t2._maxy > this._maxy && (this._maxy = t2._maxy));
            }
          } else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            this.isNull() ? (this._minx = t2, this._maxx = t2, this._miny = e2, this._maxy = e2) : (t2 < this._minx && (this._minx = t2), t2 > this._maxx && (this._maxx = t2), e2 < this._miny && (this._miny = e2), e2 > this._maxy && (this._maxy = e2));
          }
        }
        minExtent() {
          if (this.isNull()) return 0;
          const t2 = this.getWidth(), e2 = this.getHeight();
          return t2 < e2 ? t2 : e2;
        }
        getWidth() {
          return this.isNull() ? 0 : this._maxx - this._minx;
        }
        compareTo(t2) {
          const e2 = t2;
          return this.isNull() ? e2.isNull() ? 0 : -1 : e2.isNull() ? 1 : this._minx < e2._minx ? -1 : this._minx > e2._minx ? 1 : this._miny < e2._miny ? -1 : this._miny > e2._miny ? 1 : this._maxx < e2._maxx ? -1 : this._maxx > e2._maxx ? 1 : this._maxy < e2._maxy ? -1 : this._maxy > e2._maxy ? 1 : 0;
        }
        translate(t2, e2) {
          if (this.isNull()) return null;
          this.init(this.getMinX() + t2, this.getMaxX() + t2, this.getMinY() + e2, this.getMaxY() + e2);
        }
        toString() {
          return "Env[" + this._minx + " : " + this._maxx + ", " + this._miny + " : " + this._maxy + "]";
        }
        setToNull() {
          this._minx = 0, this._maxx = -1, this._miny = 0, this._maxy = -1;
        }
        getHeight() {
          return this.isNull() ? 0 : this._maxy - this._miny;
        }
        maxExtent() {
          if (this.isNull()) return 0;
          const t2 = this.getWidth(), e2 = this.getHeight();
          return t2 > e2 ? t2 : e2;
        }
        expandBy() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            this.expandBy(t2, t2);
          } else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            if (this.isNull()) return null;
            this._minx -= t2, this._maxx += t2, this._miny -= e2, this._maxy += e2, (this._minx > this._maxx || this._miny > this._maxy) && this.setToNull();
          }
        }
        contains() {
          if (1 === arguments.length) {
            if (arguments[0] instanceof N) {
              const t2 = arguments[0];
              return this.covers(t2);
            }
            if (arguments[0] instanceof g) {
              const t2 = arguments[0];
              return this.covers(t2);
            }
          } else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return this.covers(t2, e2);
          }
        }
        centre() {
          return this.isNull() ? null : new g((this.getMinX() + this.getMaxX()) / 2, (this.getMinY() + this.getMaxY()) / 2);
        }
        init() {
          if (0 === arguments.length) this.setToNull();
          else if (1 === arguments.length) {
            if (arguments[0] instanceof g) {
              const t2 = arguments[0];
              this.init(t2.x, t2.x, t2.y, t2.y);
            } else if (arguments[0] instanceof N) {
              const t2 = arguments[0];
              this._minx = t2._minx, this._maxx = t2._maxx, this._miny = t2._miny, this._maxy = t2._maxy;
            }
          } else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            this.init(t2.x, e2.x, t2.y, e2.y);
          } else if (4 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3];
            t2 < e2 ? (this._minx = t2, this._maxx = e2) : (this._minx = e2, this._maxx = t2), n2 < s2 ? (this._miny = n2, this._maxy = s2) : (this._miny = s2, this._maxy = n2);
          }
        }
        getMaxY() {
          return this._maxy;
        }
        distance(t2) {
          if (this.intersects(t2)) return 0;
          let e2 = 0;
          this._maxx < t2._minx ? e2 = t2._minx - this._maxx : this._minx > t2._maxx && (e2 = this._minx - t2._maxx);
          let n2 = 0;
          return this._maxy < t2._miny ? n2 = t2._miny - this._maxy : this._miny > t2._maxy && (n2 = this._miny - t2._maxy), 0 === e2 ? n2 : 0 === n2 ? e2 : Math.sqrt(e2 * e2 + n2 * n2);
        }
        hashCode() {
          let t2 = 17;
          return t2 = 37 * t2 + g.hashCode(this._minx), t2 = 37 * t2 + g.hashCode(this._maxx), t2 = 37 * t2 + g.hashCode(this._miny), t2 = 37 * t2 + g.hashCode(this._maxy), t2;
        }
        getClass() {
          return N;
        }
        get interfaces_() {
          return [r, a];
        }
      }
      function C() {
      }
      N.constructor_ = function() {
        if (this._minx = null, this._maxx = null, this._miny = null, this._maxy = null, 0 === arguments.length) this.init();
        else if (1 === arguments.length) {
          if (arguments[0] instanceof g) {
            const t2 = arguments[0];
            this.init(t2.x, t2.x, t2.y, t2.y);
          } else if (arguments[0] instanceof N) {
            const t2 = arguments[0];
            this.init(t2);
          }
        } else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          this.init(t2.x, e2.x, t2.y, e2.y);
        } else if (4 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3];
          this.init(t2, e2, n2, s2);
        }
      }, N.serialVersionUID = 5873921885273102e3;
      class S extends C {
        constructor() {
          super(), S.constructor_.apply(this, arguments);
        }
        getClass() {
          return S;
        }
        get interfaces_() {
          return [];
        }
      }
      function w(t2) {
        this.str = t2;
      }
      function L(t2) {
        this.value = t2;
      }
      function T() {
      }
      S.constructor_ = function() {
        C.constructor_.call(this, "Projective point not representable on the Cartesian plane.");
      }, w.prototype.append = function(t2) {
        this.str += t2;
      }, w.prototype.setCharAt = function(t2, e2) {
        this.str = this.str.substr(0, t2) + e2 + this.str.substr(t2 + 1);
      }, w.prototype.toString = function(t2) {
        return this.str;
      }, L.prototype.intValue = function() {
        return this.value;
      }, L.prototype.compareTo = function(t2) {
        return this.value < t2 ? -1 : this.value > t2 ? 1 : 0;
      }, L.isNaN = (t2) => Number.isNaN(t2), T.isWhitespace = (t2) => t2 <= 32 && t2 >= 0 || 127 === t2, T.toUpperCase = (t2) => t2.toUpperCase();
      class R {
        constructor() {
          R.constructor_.apply(this, arguments);
        }
        static sqr(t2) {
          return R.valueOf(t2).selfMultiply(t2);
        }
        static valueOf() {
          if ("string" == typeof arguments[0]) {
            const t2 = arguments[0];
            return R.parse(t2);
          }
          if ("number" == typeof arguments[0]) {
            const t2 = arguments[0];
            return new R(t2);
          }
        }
        static sqrt(t2) {
          return R.valueOf(t2).sqrt();
        }
        static parse(t2) {
          let e2 = 0;
          const n2 = t2.length;
          for (; T.isWhitespace(t2.charAt(e2)); ) e2++;
          let s2 = false;
          if (e2 < n2) {
            const n3 = t2.charAt(e2);
            "-" !== n3 && "+" !== n3 || (e2++, "-" === n3 && (s2 = true));
          }
          const i2 = new R();
          let r2 = 0, o2 = 0, l2 = 0;
          for (; !(e2 >= n2); ) {
            const n3 = t2.charAt(e2);
            if (e2++, T.isDigit(n3)) {
              const t3 = n3 - "0";
              i2.selfMultiply(R.TEN), i2.selfAdd(t3), r2++;
            } else {
              if ("." !== n3) {
                if ("e" === n3 || "E" === n3) {
                  const n4 = t2.substring(e2);
                  try {
                    l2 = L.parseInt(n4);
                  } catch (e3) {
                    throw e3 instanceof NumberFormatException ? new NumberFormatException("Invalid exponent " + n4 + " in string " + t2) : e3;
                  }
                  break;
                }
                throw new NumberFormatException("Unexpected character '" + n3 + "' at position " + e2 + " in string " + t2);
              }
              o2 = r2;
            }
          }
          let a2 = i2;
          const c2 = r2 - o2 - l2;
          if (0 === c2) a2 = i2;
          else if (c2 > 0) {
            const t3 = R.TEN.pow(c2);
            a2 = i2.divide(t3);
          } else if (c2 < 0) {
            const t3 = R.TEN.pow(-c2);
            a2 = i2.multiply(t3);
          }
          return s2 ? a2.negate() : a2;
        }
        static createNaN() {
          return new R(i.NaN, i.NaN);
        }
        static copy(t2) {
          return new R(t2);
        }
        static magnitude(t2) {
          const e2 = Math.abs(t2), n2 = Math.log(e2) / Math.log(10);
          let s2 = Math.trunc(Math.floor(n2));
          return 10 * Math.pow(10, s2) <= e2 && (s2 += 1), s2;
        }
        static stringOfChar(t2, e2) {
          const n2 = new w();
          for (let s2 = 0; s2 < e2; s2++) n2.append(t2);
          return n2.toString();
        }
        le(t2) {
          return this._hi < t2._hi || this._hi === t2._hi && this._lo <= t2._lo;
        }
        extractSignificantDigits(t2, e2) {
          let n2 = this.abs(), s2 = R.magnitude(n2._hi);
          const i2 = R.TEN.pow(s2);
          n2 = n2.divide(i2), n2.gt(R.TEN) ? (n2 = n2.divide(R.TEN), s2 += 1) : n2.lt(R.ONE) && (n2 = n2.multiply(R.TEN), s2 -= 1);
          const r2 = s2 + 1, o2 = new w(), l2 = R.MAX_PRINT_DIGITS - 1;
          for (let e3 = 0; e3 <= l2; e3++) {
            t2 && e3 === r2 && o2.append(".");
            const s3 = Math.trunc(n2._hi);
            if (s3 < 0) break;
            let i3 = false, a2 = 0;
            s3 > 9 ? (i3 = true, a2 = "9") : a2 = "0" + s3, o2.append(a2), n2 = n2.subtract(R.valueOf(s3)).multiply(R.TEN), i3 && n2.selfAdd(R.TEN);
            let c2 = true;
            const h2 = R.magnitude(n2._hi);
            if (h2 < 0 && Math.abs(h2) >= l2 - e3 && (c2 = false), !c2) break;
          }
          return e2[0] = s2, o2.toString();
        }
        sqr() {
          return this.multiply(this);
        }
        doubleValue() {
          return this._hi + this._lo;
        }
        subtract() {
          if (arguments[0] instanceof R) {
            const t2 = arguments[0];
            return this.add(t2.negate());
          }
          if ("number" == typeof arguments[0]) {
            const t2 = arguments[0];
            return this.add(-t2);
          }
        }
        equals() {
          if (1 === arguments.length && arguments[0] instanceof R) {
            const t2 = arguments[0];
            return this._hi === t2._hi && this._lo === t2._lo;
          }
        }
        isZero() {
          return 0 === this._hi && 0 === this._lo;
        }
        selfSubtract() {
          if (arguments[0] instanceof R) {
            const t2 = arguments[0];
            return this.isNaN() ? this : this.selfAdd(-t2._hi, -t2._lo);
          }
          if ("number" == typeof arguments[0]) {
            const t2 = arguments[0];
            return this.isNaN() ? this : this.selfAdd(-t2, 0);
          }
        }
        getSpecialNumberString() {
          return this.isZero() ? "0.0" : this.isNaN() ? "NaN " : null;
        }
        min(t2) {
          return this.le(t2) ? this : t2;
        }
        selfDivide() {
          if (1 === arguments.length) {
            if (arguments[0] instanceof R) {
              const t2 = arguments[0];
              return this.selfDivide(t2._hi, t2._lo);
            }
            if ("number" == typeof arguments[0]) {
              const t2 = arguments[0];
              return this.selfDivide(t2, 0);
            }
          } else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            let n2 = null, s2 = null, i2 = null, r2 = null, o2 = null, l2 = null, a2 = null, c2 = null;
            return o2 = this._hi / t2, l2 = R.SPLIT * o2, n2 = l2 - o2, c2 = R.SPLIT * t2, n2 = l2 - n2, s2 = o2 - n2, i2 = c2 - t2, a2 = o2 * t2, i2 = c2 - i2, r2 = t2 - i2, c2 = n2 * i2 - a2 + n2 * r2 + s2 * i2 + s2 * r2, l2 = (this._hi - a2 - c2 + this._lo - o2 * e2) / t2, c2 = o2 + l2, this._hi = c2, this._lo = o2 - c2 + l2, this;
          }
        }
        dump() {
          return "DD<" + this._hi + ", " + this._lo + ">";
        }
        divide() {
          if (arguments[0] instanceof R) {
            const t2 = arguments[0];
            let e2 = null, n2 = null, s2 = null, i2 = null, r2 = null, o2 = null, l2 = null, a2 = null;
            return r2 = this._hi / t2._hi, o2 = R.SPLIT * r2, e2 = o2 - r2, a2 = R.SPLIT * t2._hi, e2 = o2 - e2, n2 = r2 - e2, s2 = a2 - t2._hi, l2 = r2 * t2._hi, s2 = a2 - s2, i2 = t2._hi - s2, a2 = e2 * s2 - l2 + e2 * i2 + n2 * s2 + n2 * i2, o2 = (this._hi - l2 - a2 + this._lo - r2 * t2._lo) / t2._hi, a2 = r2 + o2, new R(a2, r2 - a2 + o2);
          }
          if ("number" == typeof arguments[0]) {
            const t2 = arguments[0];
            return i.isNaN(t2) ? R.createNaN() : R.copy(this).selfDivide(t2, 0);
          }
        }
        ge(t2) {
          return this._hi > t2._hi || this._hi === t2._hi && this._lo >= t2._lo;
        }
        pow(t2) {
          if (0 === t2) return R.valueOf(1);
          let e2 = new R(this), n2 = R.valueOf(1), s2 = Math.abs(t2);
          if (s2 > 1) for (; s2 > 0; ) s2 % 2 == 1 && n2.selfMultiply(e2), s2 /= 2, s2 > 0 && (e2 = e2.sqr());
          else n2 = e2;
          return t2 < 0 ? n2.reciprocal() : n2;
        }
        ceil() {
          if (this.isNaN()) return R.NaN;
          const t2 = Math.ceil(this._hi);
          let e2 = 0;
          return t2 === this._hi && (e2 = Math.ceil(this._lo)), new R(t2, e2);
        }
        compareTo(t2) {
          const e2 = t2;
          return this._hi < e2._hi ? -1 : this._hi > e2._hi ? 1 : this._lo < e2._lo ? -1 : this._lo > e2._lo ? 1 : 0;
        }
        rint() {
          if (this.isNaN()) return this;
          return this.add(0.5).floor();
        }
        setValue() {
          if (arguments[0] instanceof R) {
            const t2 = arguments[0];
            return this.init(t2), this;
          }
          if ("number" == typeof arguments[0]) {
            const t2 = arguments[0];
            return this.init(t2), this;
          }
        }
        max(t2) {
          return this.ge(t2) ? this : t2;
        }
        sqrt() {
          if (this.isZero()) return R.valueOf(0);
          if (this.isNegative()) return R.NaN;
          const t2 = 1 / Math.sqrt(this._hi), e2 = this._hi * t2, n2 = R.valueOf(e2), s2 = this.subtract(n2.sqr())._hi * (0.5 * t2);
          return n2.add(s2);
        }
        selfAdd() {
          if (1 === arguments.length) {
            if (arguments[0] instanceof R) {
              const t2 = arguments[0];
              return this.selfAdd(t2._hi, t2._lo);
            }
            if ("number" == typeof arguments[0]) {
              const t2 = arguments[0];
              let e2 = null, n2 = null, s2 = null, i2 = null, r2 = null, o2 = null;
              return s2 = this._hi + t2, r2 = s2 - this._hi, i2 = s2 - r2, i2 = t2 - r2 + (this._hi - i2), o2 = i2 + this._lo, e2 = s2 + o2, n2 = o2 + (s2 - e2), this._hi = e2 + n2, this._lo = n2 + (e2 - this._hi), this;
            }
          } else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            let n2 = null, s2 = null, i2 = null, r2 = null, o2 = null, l2 = null, a2 = null, c2 = null;
            o2 = this._hi + t2, i2 = this._lo + e2, a2 = o2 - this._hi, c2 = i2 - this._lo, l2 = o2 - a2, r2 = i2 - c2, l2 = t2 - a2 + (this._hi - l2), r2 = e2 - c2 + (this._lo - r2), a2 = l2 + i2, n2 = o2 + a2, s2 = a2 + (o2 - n2), a2 = r2 + s2;
            const h2 = n2 + a2, u2 = a2 + (n2 - h2);
            return this._hi = h2, this._lo = u2, this;
          }
        }
        selfMultiply() {
          if (1 === arguments.length) {
            if (arguments[0] instanceof R) {
              const t2 = arguments[0];
              return this.selfMultiply(t2._hi, t2._lo);
            }
            if ("number" == typeof arguments[0]) {
              const t2 = arguments[0];
              return this.selfMultiply(t2, 0);
            }
          } else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            let n2 = null, s2 = null, i2 = null, r2 = null, o2 = null, l2 = null;
            o2 = R.SPLIT * this._hi, n2 = o2 - this._hi, l2 = R.SPLIT * t2, n2 = o2 - n2, s2 = this._hi - n2, i2 = l2 - t2, o2 = this._hi * t2, i2 = l2 - i2, r2 = t2 - i2, l2 = n2 * i2 - o2 + n2 * r2 + s2 * i2 + s2 * r2 + (this._hi * e2 + this._lo * t2);
            const a2 = o2 + l2;
            n2 = o2 - a2;
            const c2 = l2 + n2;
            return this._hi = a2, this._lo = c2, this;
          }
        }
        selfSqr() {
          return this.selfMultiply(this);
        }
        floor() {
          if (this.isNaN()) return R.NaN;
          const t2 = Math.floor(this._hi);
          let e2 = 0;
          return t2 === this._hi && (e2 = Math.floor(this._lo)), new R(t2, e2);
        }
        negate() {
          return this.isNaN() ? this : new R(-this._hi, -this._lo);
        }
        clone() {
          try {
            return null;
          } catch (t2) {
            if (t2 instanceof CloneNotSupportedException) return null;
            throw t2;
          }
        }
        multiply() {
          if (arguments[0] instanceof R) {
            const t2 = arguments[0];
            return t2.isNaN() ? R.createNaN() : R.copy(this).selfMultiply(t2);
          }
          if ("number" == typeof arguments[0]) {
            const t2 = arguments[0];
            return i.isNaN(t2) ? R.createNaN() : R.copy(this).selfMultiply(t2, 0);
          }
        }
        isNaN() {
          return i.isNaN(this._hi);
        }
        intValue() {
          return Math.trunc(this._hi);
        }
        toString() {
          const t2 = R.magnitude(this._hi);
          return t2 >= -3 && t2 <= 20 ? this.toStandardNotation() : this.toSciNotation();
        }
        toStandardNotation() {
          const t2 = this.getSpecialNumberString();
          if (null !== t2) return t2;
          const e2 = new Array(1).fill(null), n2 = this.extractSignificantDigits(true, e2), s2 = e2[0] + 1;
          let i2 = n2;
          if ("." === n2.charAt(0)) i2 = "0" + n2;
          else if (s2 < 0) i2 = "0." + R.stringOfChar("0", -s2) + n2;
          else if (-1 === n2.indexOf(".")) {
            const t3 = s2 - n2.length;
            i2 = n2 + R.stringOfChar("0", t3) + ".0";
          }
          return this.isNegative() ? "-" + i2 : i2;
        }
        reciprocal() {
          let t2 = null, e2 = null, n2 = null, s2 = null, i2 = null, r2 = null, o2 = null, l2 = null;
          i2 = 1 / this._hi, r2 = R.SPLIT * i2, t2 = r2 - i2, l2 = R.SPLIT * this._hi, t2 = r2 - t2, e2 = i2 - t2, n2 = l2 - this._hi, o2 = i2 * this._hi, n2 = l2 - n2, s2 = this._hi - n2, l2 = t2 * n2 - o2 + t2 * s2 + e2 * n2 + e2 * s2, r2 = (1 - o2 - l2 - i2 * this._lo) / this._hi;
          const a2 = i2 + r2;
          return new R(a2, i2 - a2 + r2);
        }
        toSciNotation() {
          if (this.isZero()) return R.SCI_NOT_ZERO;
          const t2 = this.getSpecialNumberString();
          if (null !== t2) return t2;
          const e2 = new Array(1).fill(null), n2 = this.extractSignificantDigits(false, e2), s2 = R.SCI_NOT_EXPONENT_CHAR + e2[0];
          if ("0" === n2.charAt(0)) throw new IllegalStateException("Found leading zero: " + n2);
          let i2 = "";
          n2.length > 1 && (i2 = n2.substring(1));
          const r2 = n2.charAt(0) + "." + i2;
          return this.isNegative() ? "-" + r2 + s2 : r2 + s2;
        }
        abs() {
          return this.isNaN() ? R.NaN : this.isNegative() ? this.negate() : new R(this);
        }
        isPositive() {
          return this._hi > 0 || 0 === this._hi && this._lo > 0;
        }
        lt(t2) {
          return this._hi < t2._hi || this._hi === t2._hi && this._lo < t2._lo;
        }
        add() {
          if (arguments[0] instanceof R) {
            const t2 = arguments[0];
            return R.copy(this).selfAdd(t2);
          }
          if ("number" == typeof arguments[0]) {
            const t2 = arguments[0];
            return R.copy(this).selfAdd(t2);
          }
        }
        init() {
          if (1 === arguments.length) {
            if ("number" == typeof arguments[0]) {
              const t2 = arguments[0];
              this._hi = t2, this._lo = 0;
            } else if (arguments[0] instanceof R) {
              const t2 = arguments[0];
              this._hi = t2._hi, this._lo = t2._lo;
            }
          } else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            this._hi = t2, this._lo = e2;
          }
        }
        gt(t2) {
          return this._hi > t2._hi || this._hi === t2._hi && this._lo > t2._lo;
        }
        isNegative() {
          return this._hi < 0 || 0 === this._hi && this._lo < 0;
        }
        trunc() {
          return this.isNaN() ? R.NaN : this.isPositive() ? this.floor() : this.ceil();
        }
        signum() {
          return this._hi > 0 ? 1 : this._hi < 0 ? -1 : this._lo > 0 ? 1 : this._lo < 0 ? -1 : 0;
        }
        getClass() {
          return R;
        }
        get interfaces_() {
          return [a, r, o];
        }
      }
      R.constructor_ = function() {
        if (this._hi = 0, this._lo = 0, 0 === arguments.length) this.init(0);
        else if (1 === arguments.length) {
          if ("number" == typeof arguments[0]) {
            const t2 = arguments[0];
            this.init(t2);
          } else if (arguments[0] instanceof R) {
            const t2 = arguments[0];
            this.init(t2);
          } else if ("string" == typeof arguments[0]) {
            const t2 = arguments[0];
            R.constructor_.call(this, R.parse(t2));
          }
        } else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          this.init(t2, e2);
        }
      }, R.PI = new R(3.141592653589793, 12246467991473532e-32), R.TWO_PI = new R(6.283185307179586, 24492935982947064e-32), R.PI_2 = new R(1.5707963267948966, 6123233995736766e-32), R.E = new R(2.718281828459045, 14456468917292502e-32), R.NaN = new R(i.NaN, i.NaN), R.EPS = 123259516440783e-46, R.SPLIT = 134217729, R.MAX_PRINT_DIGITS = 32, R.TEN = R.valueOf(10), R.ONE = R.valueOf(1), R.SCI_NOT_EXPONENT_CHAR = "E", R.SCI_NOT_ZERO = "0.0E0";
      class P {
        constructor() {
          P.constructor_.apply(this, arguments);
        }
        static orientationIndex(t2, e2, n2) {
          const s2 = P.orientationIndexFilter(t2, e2, n2);
          if (s2 <= 1) return s2;
          const i2 = R.valueOf(e2.x).selfAdd(-t2.x), r2 = R.valueOf(e2.y).selfAdd(-t2.y), o2 = R.valueOf(n2.x).selfAdd(-e2.x), l2 = R.valueOf(n2.y).selfAdd(-e2.y);
          return i2.selfMultiply(l2).selfSubtract(r2.selfMultiply(o2)).signum();
        }
        static signOfDet2x2() {
          if (arguments[3] instanceof R && arguments[2] instanceof R && arguments[0] instanceof R && arguments[1] instanceof R) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3];
            return t2.multiply(s2).selfSubtract(e2.multiply(n2)).signum();
          }
          if ("number" == typeof arguments[3] && "number" == typeof arguments[2] && "number" == typeof arguments[0] && "number" == typeof arguments[1]) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3], i2 = R.valueOf(t2), r2 = R.valueOf(e2), o2 = R.valueOf(n2), l2 = R.valueOf(s2);
            return i2.multiply(l2).selfSubtract(r2.multiply(o2)).signum();
          }
        }
        static intersection(t2, e2, n2, s2) {
          const i2 = R.valueOf(s2.y).selfSubtract(n2.y).selfMultiply(R.valueOf(e2.x).selfSubtract(t2.x)), r2 = R.valueOf(s2.x).selfSubtract(n2.x).selfMultiply(R.valueOf(e2.y).selfSubtract(t2.y)), o2 = i2.subtract(r2), l2 = R.valueOf(s2.x).selfSubtract(n2.x).selfMultiply(R.valueOf(t2.y).selfSubtract(n2.y)), a2 = R.valueOf(s2.y).selfSubtract(n2.y).selfMultiply(R.valueOf(t2.x).selfSubtract(n2.x)), c2 = l2.subtract(a2).selfDivide(o2).doubleValue(), h2 = R.valueOf(t2.x).selfAdd(R.valueOf(e2.x).selfSubtract(t2.x).selfMultiply(c2)).doubleValue(), u2 = R.valueOf(e2.x).selfSubtract(t2.x).selfMultiply(R.valueOf(t2.y).selfSubtract(n2.y)), d2 = R.valueOf(e2.y).selfSubtract(t2.y).selfMultiply(R.valueOf(t2.x).selfSubtract(n2.x)), _2 = u2.subtract(d2).selfDivide(o2).doubleValue(), f2 = R.valueOf(n2.y).selfAdd(R.valueOf(s2.y).selfSubtract(n2.y).selfMultiply(_2)).doubleValue();
          return new g(h2, f2);
        }
        static orientationIndexFilter(t2, e2, n2) {
          let s2 = null;
          const i2 = (t2.x - n2.x) * (e2.y - n2.y), r2 = (t2.y - n2.y) * (e2.x - n2.x), o2 = i2 - r2;
          if (i2 > 0) {
            if (r2 <= 0) return P.signum(o2);
            s2 = i2 + r2;
          } else {
            if (!(i2 < 0)) return P.signum(o2);
            if (r2 >= 0) return P.signum(o2);
            s2 = -i2 - r2;
          }
          const l2 = P.DP_SAFE_EPSILON * s2;
          return o2 >= l2 || -o2 >= l2 ? P.signum(o2) : 2;
        }
        static signum(t2) {
          return t2 > 0 ? 1 : t2 < 0 ? -1 : 0;
        }
        getClass() {
          return P;
        }
        get interfaces_() {
          return [];
        }
      }
      P.constructor_ = function() {
      }, P.DP_SAFE_EPSILON = 1e-15;
      class v {
        constructor() {
          v.constructor_.apply(this, arguments);
        }
        static index(t2, e2, n2) {
          return P.orientationIndex(t2, e2, n2);
        }
        static isCCW(t2) {
          const e2 = t2.length - 1;
          if (e2 < 3) throw new n("Ring has fewer than 4 points, so orientation cannot be determined");
          let s2 = t2[0], i2 = 0;
          for (let n2 = 1; n2 <= e2; n2++) {
            const e3 = t2[n2];
            e3.y > s2.y && (s2 = e3, i2 = n2);
          }
          let r2 = i2;
          do {
            r2 -= 1, r2 < 0 && (r2 = e2);
          } while (t2[r2].equals2D(s2) && r2 !== i2);
          let o2 = i2;
          do {
            o2 = (o2 + 1) % e2;
          } while (t2[o2].equals2D(s2) && o2 !== i2);
          const l2 = t2[r2], a2 = t2[o2];
          if (l2.equals2D(s2) || a2.equals2D(s2) || l2.equals2D(a2)) return false;
          const c2 = v.index(l2, s2, a2);
          let h2 = null;
          return h2 = 0 === c2 ? l2.x > a2.x : c2 > 0, h2;
        }
        getClass() {
          return v;
        }
        get interfaces_() {
          return [];
        }
      }
      function O() {
      }
      v.constructor_ = function() {
      }, v.CLOCKWISE = -1, v.RIGHT = v.CLOCKWISE, v.COUNTERCLOCKWISE = 1, v.LEFT = v.COUNTERCLOCKWISE, v.COLLINEAR = 0, v.STRAIGHT = v.COLLINEAR, O.arraycopy = (t2, e2, n2, s2, i2) => {
        let r2 = 0;
        for (let o2 = e2; o2 < e2 + i2; o2++) n2[s2 + r2] = t2[o2], r2++;
      }, O.getProperty = (t2) => ({ "line.separator": "\n" })[t2];
      class b {
        constructor() {
          b.constructor_.apply(this, arguments);
        }
        static intersection(t2, e2, n2, s2) {
          const r2 = t2.y - e2.y, o2 = e2.x - t2.x, l2 = t2.x * e2.y - e2.x * t2.y, a2 = n2.y - s2.y, c2 = s2.x - n2.x, h2 = n2.x * s2.y - s2.x * n2.y, u2 = r2 * c2 - a2 * o2, d2 = (o2 * h2 - c2 * l2) / u2, _2 = (a2 * l2 - r2 * h2) / u2;
          if (i.isNaN(d2) || i.isInfinite(d2) || i.isNaN(_2) || i.isInfinite(_2)) throw new S();
          return new g(d2, _2);
        }
        getY() {
          const t2 = this.y / this.w;
          if (i.isNaN(t2) || i.isInfinite(t2)) throw new S();
          return t2;
        }
        getX() {
          const t2 = this.x / this.w;
          if (i.isNaN(t2) || i.isInfinite(t2)) throw new S();
          return t2;
        }
        getCoordinate() {
          const t2 = new g();
          return t2.x = this.getX(), t2.y = this.getY(), t2;
        }
        getClass() {
          return b;
        }
        get interfaces_() {
          return [];
        }
      }
      b.constructor_ = function() {
        if (this.x = null, this.y = null, this.w = null, 0 === arguments.length) this.x = 0, this.y = 0, this.w = 1;
        else if (1 === arguments.length) {
          const t2 = arguments[0];
          this.x = t2.x, this.y = t2.y, this.w = 1;
        } else if (2 === arguments.length) {
          if ("number" == typeof arguments[0] && "number" == typeof arguments[1]) {
            const t2 = arguments[0], e2 = arguments[1];
            this.x = t2, this.y = e2, this.w = 1;
          } else if (arguments[0] instanceof b && arguments[1] instanceof b) {
            const t2 = arguments[0], e2 = arguments[1];
            this.x = t2.y * e2.w - e2.y * t2.w, this.y = e2.x * t2.w - t2.x * e2.w, this.w = t2.x * e2.y - e2.x * t2.y;
          } else if (arguments[0] instanceof g && arguments[1] instanceof g) {
            const t2 = arguments[0], e2 = arguments[1];
            this.x = t2.y - e2.y, this.y = e2.x - t2.x, this.w = t2.x * e2.y - e2.x * t2.y;
          }
        } else if (3 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
          this.x = t2, this.y = e2, this.w = n2;
        } else if (4 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3], i2 = t2.y - e2.y, r2 = e2.x - t2.x, o2 = t2.x * e2.y - e2.x * t2.y, l2 = n2.y - s2.y, a2 = s2.x - n2.x, c2 = n2.x * s2.y - s2.x * n2.y;
          this.x = r2 * c2 - a2 * o2, this.y = l2 * o2 - i2 * c2, this.w = i2 * a2 - l2 * r2;
        }
      };
      class M {
        constructor() {
          M.constructor_.apply(this, arguments);
        }
        static log10(t2) {
          const e2 = Math.log(t2);
          return i.isInfinite(e2) || i.isNaN(e2) ? e2 : e2 / M.LOG_10;
        }
        static min(t2, e2, n2, s2) {
          let i2 = t2;
          return e2 < i2 && (i2 = e2), n2 < i2 && (i2 = n2), s2 < i2 && (i2 = s2), i2;
        }
        static clamp() {
          if ("number" == typeof arguments[2] && "number" == typeof arguments[0] && "number" == typeof arguments[1]) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
            return t2 < e2 ? e2 : t2 > n2 ? n2 : t2;
          }
          if (Number.isInteger(arguments[2]) && Number.isInteger(arguments[0]) && Number.isInteger(arguments[1])) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
            return t2 < e2 ? e2 : t2 > n2 ? n2 : t2;
          }
        }
        static wrap(t2, e2) {
          return t2 < 0 ? e2 - -t2 % e2 : t2 % e2;
        }
        static max() {
          if (3 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
            let s2 = t2;
            return e2 > s2 && (s2 = e2), n2 > s2 && (s2 = n2), s2;
          }
          if (4 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3];
            let i2 = t2;
            return e2 > i2 && (i2 = e2), n2 > i2 && (i2 = n2), s2 > i2 && (i2 = s2), i2;
          }
        }
        static average(t2, e2) {
          return (t2 + e2) / 2;
        }
        getClass() {
          return M;
        }
        get interfaces_() {
          return [];
        }
      }
      M.constructor_ = function() {
      }, M.LOG_10 = Math.log(10);
      class D {
        constructor() {
          D.constructor_.apply(this, arguments);
        }
        static segmentToSegment(t2, e2, n2, s2) {
          if (t2.equals(e2)) return D.pointToSegment(t2, n2, s2);
          if (n2.equals(s2)) return D.pointToSegment(s2, t2, e2);
          let i2 = false;
          if (N.intersects(t2, e2, n2, s2)) {
            const r2 = (e2.x - t2.x) * (s2.y - n2.y) - (e2.y - t2.y) * (s2.x - n2.x);
            if (0 === r2) i2 = true;
            else {
              const o2 = (t2.y - n2.y) * (s2.x - n2.x) - (t2.x - n2.x) * (s2.y - n2.y), l2 = ((t2.y - n2.y) * (e2.x - t2.x) - (t2.x - n2.x) * (e2.y - t2.y)) / r2, a2 = o2 / r2;
              (a2 < 0 || a2 > 1 || l2 < 0 || l2 > 1) && (i2 = true);
            }
          } else i2 = true;
          return i2 ? M.min(D.pointToSegment(t2, n2, s2), D.pointToSegment(e2, n2, s2), D.pointToSegment(n2, t2, e2), D.pointToSegment(s2, t2, e2)) : 0;
        }
        static pointToSegment(t2, e2, n2) {
          if (e2.x === n2.x && e2.y === n2.y) return t2.distance(e2);
          const s2 = (n2.x - e2.x) * (n2.x - e2.x) + (n2.y - e2.y) * (n2.y - e2.y), i2 = ((t2.x - e2.x) * (n2.x - e2.x) + (t2.y - e2.y) * (n2.y - e2.y)) / s2;
          if (i2 <= 0) return t2.distance(e2);
          if (i2 >= 1) return t2.distance(n2);
          const r2 = ((e2.y - t2.y) * (n2.x - e2.x) - (e2.x - t2.x) * (n2.y - e2.y)) / s2;
          return Math.abs(r2) * Math.sqrt(s2);
        }
        static pointToLinePerpendicular(t2, e2, n2) {
          const s2 = (n2.x - e2.x) * (n2.x - e2.x) + (n2.y - e2.y) * (n2.y - e2.y), i2 = ((e2.y - t2.y) * (n2.x - e2.x) - (e2.x - t2.x) * (n2.y - e2.y)) / s2;
          return Math.abs(i2) * Math.sqrt(s2);
        }
        static pointToSegmentString(t2, e2) {
          if (0 === e2.length) throw new n("Line array must contain at least one vertex");
          let s2 = t2.distance(e2[0]);
          for (let n2 = 0; n2 < e2.length - 1; n2++) {
            const i2 = D.pointToSegment(t2, e2[n2], e2[n2 + 1]);
            i2 < s2 && (s2 = i2);
          }
          return s2;
        }
        getClass() {
          return D;
        }
        get interfaces_() {
          return [];
        }
      }
      D.constructor_ = function() {
      };
      class A {
        constructor() {
          A.constructor_.apply(this, arguments);
        }
        setOrdinate(t2, e2, n2) {
        }
        size() {
        }
        getOrdinate(t2, e2) {
        }
        getCoordinate() {
        }
        getCoordinateCopy(t2) {
        }
        getDimension() {
        }
        getX(t2) {
        }
        expandEnvelope(t2) {
        }
        copy() {
        }
        getY(t2) {
        }
        toCoordinateArray() {
        }
        getClass() {
          return A;
        }
        get interfaces_() {
          return [o];
        }
      }
      A.constructor_ = function() {
      }, A.X = 0, A.Y = 1, A.Z = 2, A.M = 3;
      class F {
        constructor() {
          F.constructor_.apply(this, arguments);
        }
        create() {
          1 === arguments.length && (arguments[0] instanceof Array || _(arguments[0], A));
        }
        getClass() {
          return F;
        }
        get interfaces_() {
          return [];
        }
      }
      F.constructor_ = function() {
      };
      class G {
        constructor() {
          G.constructor_.apply(this, arguments);
        }
        filter(t2) {
        }
        getClass() {
          return G;
        }
        get interfaces_() {
          return [];
        }
      }
      G.constructor_ = function() {
      };
      class q {
        constructor() {
          q.constructor_.apply(this, arguments);
        }
        isGeometryCollection() {
          return this.getTypeCode() === q.TYPECODE_GEOMETRYCOLLECTION;
        }
        getFactory() {
          return this._factory;
        }
        getGeometryN(t2) {
          return this;
        }
        getArea() {
          return 0;
        }
        isRectangle() {
          return false;
        }
        equals() {
          if (arguments[0] instanceof q) {
            const t2 = arguments[0];
            return null !== t2 && this.equalsTopo(t2);
          }
          if (arguments[0] instanceof Object) {
            const t2 = arguments[0];
            if (!(t2 instanceof q)) return false;
            const e2 = t2;
            return this.equalsExact(e2);
          }
        }
        equalsExact(t2) {
          return this === t2 || this.equalsExact(t2, 0);
        }
        geometryChanged() {
          this.apply(q.geometryChangedFilter);
        }
        geometryChangedAction() {
          this._envelope = null;
        }
        equalsNorm(t2) {
          return null !== t2 && this.norm().equalsExact(t2.norm());
        }
        getLength() {
          return 0;
        }
        getNumGeometries() {
          return 1;
        }
        compareTo() {
          let t2;
          if (1 === arguments.length) {
            const e2 = arguments[0];
            return t2 = e2, this.getTypeCode() !== t2.getTypeCode() ? this.getTypeCode() - t2.getTypeCode() : this.isEmpty() && t2.isEmpty() ? 0 : this.isEmpty() ? -1 : t2.isEmpty() ? 1 : this.compareToSameClass(e2);
          }
          if (2 === arguments.length) {
            const e2 = arguments[0], n2 = arguments[1];
            return t2 = e2, this.getTypeCode() !== t2.getTypeCode() ? this.getTypeCode() - t2.getTypeCode() : this.isEmpty() && t2.isEmpty() ? 0 : this.isEmpty() ? -1 : t2.isEmpty() ? 1 : this.compareToSameClass(e2, n2);
          }
        }
        getUserData() {
          return this._userData;
        }
        getSRID() {
          return this._SRID;
        }
        getEnvelope() {
          return this.getFactory().toGeometry(this.getEnvelopeInternal());
        }
        checkNotGeometryCollection(t2) {
          if (t2.getTypeCode() === q.TYPECODE_GEOMETRYCOLLECTION) throw new n("This method does not support GeometryCollection arguments");
        }
        equal(t2, e2, n2) {
          return 0 === n2 ? t2.equals(e2) : t2.distance(e2) <= n2;
        }
        norm() {
          const t2 = this.copy();
          return t2.normalize(), t2;
        }
        getPrecisionModel() {
          return this._factory.getPrecisionModel();
        }
        getEnvelopeInternal() {
          return null === this._envelope && (this._envelope = this.computeEnvelopeInternal()), new N(this._envelope);
        }
        setSRID(t2) {
          this._SRID = t2;
        }
        setUserData(t2) {
          this._userData = t2;
        }
        compare(t2, e2) {
          const n2 = t2.iterator(), s2 = e2.iterator();
          for (; n2.hasNext() && s2.hasNext(); ) {
            const t3 = n2.next(), e3 = s2.next(), i2 = t3.compareTo(e3);
            if (0 !== i2) return i2;
          }
          return n2.hasNext() ? 1 : s2.hasNext() ? -1 : 0;
        }
        hashCode() {
          return this.getEnvelopeInternal().hashCode();
        }
        isGeometryCollectionOrDerived() {
          return this.getTypeCode() === q.TYPECODE_GEOMETRYCOLLECTION || this.getTypeCode() === q.TYPECODE_MULTIPOINT || this.getTypeCode() === q.TYPECODE_MULTILINESTRING || this.getTypeCode() === q.TYPECODE_MULTIPOLYGON;
        }
        get interfaces_() {
          return [o, r, a];
        }
        getClass() {
          return q;
        }
        static hasNonEmptyElements(t2) {
          for (let e2 = 0; e2 < t2.length; e2++) if (!t2[e2].isEmpty()) return true;
          return false;
        }
        static hasNullElements(t2) {
          for (let e2 = 0; e2 < t2.length; e2++) if (null === t2[e2]) return true;
          return false;
        }
      }
      q.constructor_ = function(t2) {
        t2 && (this._envelope = null, this._userData = null, this._factory = t2, this._SRID = t2.getSRID());
      }, q.serialVersionUID = 8763622679187377e3, q.TYPECODE_POINT = 0, q.TYPECODE_MULTIPOINT = 1, q.TYPECODE_LINESTRING = 2, q.TYPECODE_LINEARRING = 3, q.TYPECODE_MULTILINESTRING = 4, q.TYPECODE_POLYGON = 5, q.TYPECODE_MULTIPOLYGON = 6, q.TYPECODE_GEOMETRYCOLLECTION = 7, q.TYPENAME_POINT = "Point", q.TYPENAME_MULTIPOINT = "MultiPoint", q.TYPENAME_LINESTRING = "LineString", q.TYPENAME_LINEARRING = "LinearRing", q.TYPENAME_MULTILINESTRING = "MultiLineString", q.TYPENAME_POLYGON = "Polygon", q.TYPENAME_MULTIPOLYGON = "MultiPolygon", q.TYPENAME_GEOMETRYCOLLECTION = "GeometryCollection", q.geometryChangedFilter = { get interfaces_() {
        return [G];
      }, filter(t2) {
        t2.geometryChangedAction();
      } };
      class B {
        constructor() {
          B.constructor_.apply(this, arguments);
        }
        filter(t2) {
        }
        getClass() {
          return B;
        }
        get interfaces_() {
          return [];
        }
      }
      B.constructor_ = function() {
      };
      class V {
        constructor() {
          V.constructor_.apply(this, arguments);
        }
        isInBoundary(t2) {
        }
        getClass() {
          return V;
        }
        get interfaces_() {
          return [];
        }
      }
      class z {
        constructor() {
          z.constructor_.apply(this, arguments);
        }
        isInBoundary(t2) {
          return t2 % 2 == 1;
        }
        getClass() {
          return z;
        }
        get interfaces_() {
          return [V];
        }
      }
      z.constructor_ = function() {
      };
      class Y {
        constructor() {
          Y.constructor_.apply(this, arguments);
        }
        isInBoundary(t2) {
          return t2 > 0;
        }
        getClass() {
          return Y;
        }
        get interfaces_() {
          return [V];
        }
      }
      Y.constructor_ = function() {
      };
      class U {
        constructor() {
          U.constructor_.apply(this, arguments);
        }
        isInBoundary(t2) {
          return t2 > 1;
        }
        getClass() {
          return U;
        }
        get interfaces_() {
          return [V];
        }
      }
      U.constructor_ = function() {
      };
      class k {
        constructor() {
          k.constructor_.apply(this, arguments);
        }
        isInBoundary(t2) {
          return 1 === t2;
        }
        getClass() {
          return k;
        }
        get interfaces_() {
          return [V];
        }
      }
      k.constructor_ = function() {
      }, V.Mod2BoundaryNodeRule = z, V.EndPointBoundaryNodeRule = Y, V.MultiValentEndPointBoundaryNodeRule = U, V.MonoValentEndPointBoundaryNodeRule = k, V.constructor_ = function() {
      }, V.MOD2_BOUNDARY_RULE = new z(), V.ENDPOINT_BOUNDARY_RULE = new Y(), V.MULTIVALENT_ENDPOINT_BOUNDARY_RULE = new U(), V.MONOVALENT_ENDPOINT_BOUNDARY_RULE = new k(), V.OGC_SFS_BOUNDARY_RULE = V.MOD2_BOUNDARY_RULE;
      class X {
        constructor() {
          X.constructor_.apply(this, arguments);
        }
        static isRing(t2) {
          return !(t2.length < 4) && !!t2[0].equals2D(t2[t2.length - 1]);
        }
        static ptNotInList(t2, e2) {
          for (let n2 = 0; n2 < t2.length; n2++) {
            const s2 = t2[n2];
            if (X.indexOf(s2, e2) < 0) return s2;
          }
          return null;
        }
        static scroll(t2, e2) {
          const n2 = X.indexOf(e2, t2);
          if (n2 < 0) return null;
          const s2 = new Array(t2.length).fill(null);
          O.arraycopy(t2, n2, s2, 0, t2.length - n2), O.arraycopy(t2, 0, s2, t2.length - n2, n2), O.arraycopy(s2, 0, t2, 0, t2.length);
        }
        static equals() {
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            if (t2 === e2) return true;
            if (null === t2 || null === e2) return false;
            if (t2.length !== e2.length) return false;
            for (let n2 = 0; n2 < t2.length; n2++) if (!t2[n2].equals(e2[n2])) return false;
            return true;
          }
          if (3 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
            if (t2 === e2) return true;
            if (null === t2 || null === e2) return false;
            if (t2.length !== e2.length) return false;
            for (let s2 = 0; s2 < t2.length; s2++) if (0 !== n2.compare(t2[s2], e2[s2])) return false;
            return true;
          }
        }
        static intersection(t2, e2) {
          const n2 = new I();
          for (let s2 = 0; s2 < t2.length; s2++) e2.intersects(t2[s2]) && n2.add(t2[s2], true);
          return n2.toCoordinateArray();
        }
        static hasRepeatedPoints(t2) {
          for (let e2 = 1; e2 < t2.length; e2++) if (t2[e2 - 1].equals(t2[e2])) return true;
          return false;
        }
        static removeRepeatedPoints(t2) {
          if (!X.hasRepeatedPoints(t2)) return t2;
          return new I(t2, false).toCoordinateArray();
        }
        static reverse(t2) {
          const e2 = t2.length - 1, n2 = Math.trunc(e2 / 2);
          for (let s2 = 0; s2 <= n2; s2++) {
            const n3 = t2[s2];
            t2[s2] = t2[e2 - s2], t2[e2 - s2] = n3;
          }
        }
        static removeNull(t2) {
          let e2 = 0;
          for (let n3 = 0; n3 < t2.length; n3++) null !== t2[n3] && e2++;
          const n2 = new Array(e2).fill(null);
          if (0 === e2) return n2;
          let s2 = 0;
          for (let e3 = 0; e3 < t2.length; e3++) null !== t2[e3] && (n2[s2++] = t2[e3]);
          return n2;
        }
        static copyDeep() {
          if (1 === arguments.length) {
            const t2 = arguments[0], e2 = new Array(t2.length).fill(null);
            for (let n2 = 0; n2 < t2.length; n2++) e2[n2] = new g(t2[n2]);
            return e2;
          }
          if (5 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3], i2 = arguments[4];
            for (let r2 = 0; r2 < i2; r2++) n2[s2 + r2] = new g(t2[e2 + r2]);
          }
        }
        static isEqualReversed(t2, e2) {
          for (let n2 = 0; n2 < t2.length; n2++) {
            const s2 = t2[n2], i2 = e2[t2.length - n2 - 1];
            if (0 !== s2.compareTo(i2)) return false;
          }
          return true;
        }
        static envelope(t2) {
          const e2 = new N();
          for (let n2 = 0; n2 < t2.length; n2++) e2.expandToInclude(t2[n2]);
          return e2;
        }
        static toCoordinateArray(t2) {
          return t2.toArray(X.coordArrayType);
        }
        static atLeastNCoordinatesOrNothing(t2, e2) {
          return e2.length >= t2 ? e2 : [];
        }
        static indexOf(t2, e2) {
          for (let n2 = 0; n2 < e2.length; n2++) if (t2.equals(e2[n2])) return n2;
          return -1;
        }
        static increasingDirection(t2) {
          for (let e2 = 0; e2 < Math.trunc(t2.length / 2); e2++) {
            const n2 = t2.length - 1 - e2, s2 = t2[e2].compareTo(t2[n2]);
            if (0 !== s2) return s2;
          }
          return 1;
        }
        static compare(t2, e2) {
          let n2 = 0;
          for (; n2 < t2.length && n2 < e2.length; ) {
            const s2 = t2[n2].compareTo(e2[n2]);
            if (0 !== s2) return s2;
            n2++;
          }
          return n2 < e2.length ? -1 : n2 < t2.length ? 1 : 0;
        }
        static minCoordinate(t2) {
          let e2 = null;
          for (let n2 = 0; n2 < t2.length; n2++) (null === e2 || e2.compareTo(t2[n2]) > 0) && (e2 = t2[n2]);
          return e2;
        }
        static extract(t2, e2, n2) {
          e2 = M.clamp(e2, 0, t2.length);
          let s2 = (n2 = M.clamp(n2, -1, t2.length)) - e2 + 1;
          n2 < 0 && (s2 = 0), e2 >= t2.length && (s2 = 0), n2 < e2 && (s2 = 0);
          const i2 = new Array(s2).fill(null);
          if (0 === s2) return i2;
          let r2 = 0;
          for (let s3 = e2; s3 <= n2; s3++) i2[r2++] = t2[s3];
          return i2;
        }
        getClass() {
          return X;
        }
        get interfaces_() {
          return [];
        }
      }
      class H {
        constructor() {
          H.constructor_.apply(this, arguments);
        }
        compare(t2, e2) {
          const n2 = t2, s2 = e2;
          return X.compare(n2, s2);
        }
        getClass() {
          return H;
        }
        get interfaces_() {
          return [l];
        }
      }
      H.constructor_ = function() {
      };
      class W {
        constructor() {
          W.constructor_.apply(this, arguments);
        }
        compare(t2, e2) {
          const n2 = t2, s2 = e2;
          if (n2.length < s2.length) return -1;
          if (n2.length > s2.length) return 1;
          if (0 === n2.length) return 0;
          const i2 = X.compare(n2, s2);
          return X.isEqualReversed(n2, s2) ? 0 : i2;
        }
        OLDcompare(t2, e2) {
          const n2 = t2, s2 = e2;
          if (n2.length < s2.length) return -1;
          if (n2.length > s2.length) return 1;
          if (0 === n2.length) return 0;
          const i2 = X.increasingDirection(n2), r2 = X.increasingDirection(s2);
          let o2 = i2 > 0 ? 0 : n2.length - 1, l2 = r2 > 0 ? 0 : n2.length - 1;
          for (let t3 = 0; t3 < n2.length; t3++) {
            const t4 = n2[o2].compareTo(s2[l2]);
            if (0 !== t4) return t4;
            o2 += i2, l2 += r2;
          }
          return 0;
        }
        getClass() {
          return W;
        }
        get interfaces_() {
          return [l];
        }
      }
      function j() {
      }
      function K() {
      }
      function Z(t2) {
        this.message = t2 || "";
      }
      function Q() {
      }
      function J() {
        this.array_ = [], arguments[0] instanceof f && this.addAll(arguments[0]);
      }
      W.constructor_ = function() {
      }, X.ForwardComparator = H, X.BidirectionalComparator = W, X.constructor_ = function() {
      }, X.coordArrayType = new Array(0).fill(null), j.prototype.get = function() {
      }, j.prototype.put = function() {
      }, j.prototype.size = function() {
      }, j.prototype.values = function() {
      }, j.prototype.entrySet = function() {
      }, K.prototype = new j(), Z.prototype = new Error(), Z.prototype.name = "OperationNotSupported", Q.prototype = new f(), Q.prototype.contains = function() {
      }, J.prototype = new Q(), J.prototype.contains = function(t2) {
        for (let e2 = 0, n2 = this.array_.length; e2 < n2; e2++) {
          if (this.array_[e2] === t2) return true;
        }
        return false;
      }, J.prototype.add = function(t2) {
        return !this.contains(t2) && (this.array_.push(t2), true);
      }, J.prototype.addAll = function(t2) {
        for (let e2 = t2.iterator(); e2.hasNext(); ) this.add(e2.next());
        return true;
      }, J.prototype.remove = function(t2) {
        throw new Z();
      }, J.prototype.size = function() {
        return this.array_.length;
      }, J.prototype.isEmpty = function() {
        return 0 === this.array_.length;
      }, J.prototype.toArray = function() {
        const t2 = [];
        for (let e2 = 0, n2 = this.array_.length; e2 < n2; e2++) t2.push(this.array_[e2]);
        return t2;
      }, J.prototype.iterator = function() {
        return new $(this);
      };
      const $ = function(t2) {
        this.hashSet_ = t2, this.position_ = 0;
      };
      $.prototype.next = function() {
        if (this.position_ === this.hashSet_.size()) throw new y();
        return this.hashSet_.array_[this.position_++];
      }, $.prototype.hasNext = function() {
        return this.position_ < this.hashSet_.size();
      }, $.prototype.remove = function() {
        throw new Z();
      };
      function tt(t2) {
        return null == t2 ? 0 : t2.color;
      }
      function et(t2) {
        return null == t2 ? null : t2.parent;
      }
      function nt(t2, e2) {
        null !== t2 && (t2.color = e2);
      }
      function st(t2) {
        return null == t2 ? null : t2.left;
      }
      function it(t2) {
        return null == t2 ? null : t2.right;
      }
      function rt() {
        this.root_ = null, this.size_ = 0;
      }
      rt.prototype = new K(), rt.prototype.get = function(t2) {
        for (var e2 = this.root_; null !== e2; ) {
          var n2 = t2.compareTo(e2.key);
          if (n2 < 0) e2 = e2.left;
          else {
            if (!(n2 > 0)) return e2.value;
            e2 = e2.right;
          }
        }
        return null;
      }, rt.prototype.put = function(t2, e2) {
        if (null === this.root_) return this.root_ = { key: t2, value: e2, left: null, right: null, parent: null, color: 0, getValue() {
          return this.value;
        }, getKey() {
          return this.key;
        } }, this.size_ = 1, null;
        var n2, s2, i2 = this.root_;
        do {
          if (n2 = i2, (s2 = t2.compareTo(i2.key)) < 0) i2 = i2.left;
          else {
            if (!(s2 > 0)) {
              var r2 = i2.value;
              return i2.value = e2, r2;
            }
            i2 = i2.right;
          }
        } while (null !== i2);
        var o2 = { key: t2, left: null, right: null, value: e2, parent: n2, color: 0, getValue() {
          return this.value;
        }, getKey() {
          return this.key;
        } };
        return s2 < 0 ? n2.left = o2 : n2.right = o2, this.fixAfterInsertion(o2), this.size_++, null;
      }, rt.prototype.fixAfterInsertion = function(t2) {
        let e2;
        for (t2.color = 1; null != t2 && t2 !== this.root_ && 1 === t2.parent.color; ) et(t2) === st(et(et(t2))) ? (e2 = it(et(et(t2))), 1 === tt(e2) ? (nt(et(t2), 0), nt(e2, 0), nt(et(et(t2)), 1), t2 = et(et(t2))) : (t2 === it(et(t2)) && (t2 = et(t2), this.rotateLeft(t2)), nt(et(t2), 0), nt(et(et(t2)), 1), this.rotateRight(et(et(t2))))) : (e2 = st(et(et(t2))), 1 === tt(e2) ? (nt(et(t2), 0), nt(e2, 0), nt(et(et(t2)), 1), t2 = et(et(t2))) : (t2 === st(et(t2)) && (t2 = et(t2), this.rotateRight(t2)), nt(et(t2), 0), nt(et(et(t2)), 1), this.rotateLeft(et(et(t2)))));
        this.root_.color = 0;
      }, rt.prototype.values = function() {
        var t2 = new x(), e2 = this.getFirstEntry();
        if (null !== e2) for (t2.add(e2.value); null !== (e2 = rt.successor(e2)); ) t2.add(e2.value);
        return t2;
      }, rt.prototype.entrySet = function() {
        var t2 = new J(), e2 = this.getFirstEntry();
        if (null !== e2) for (t2.add(e2); null !== (e2 = rt.successor(e2)); ) t2.add(e2);
        return t2;
      }, rt.prototype.rotateLeft = function(t2) {
        if (null != t2) {
          var e2 = t2.right;
          t2.right = e2.left, null != e2.left && (e2.left.parent = t2), e2.parent = t2.parent, null == t2.parent ? this.root_ = e2 : t2.parent.left === t2 ? t2.parent.left = e2 : t2.parent.right = e2, e2.left = t2, t2.parent = e2;
        }
      }, rt.prototype.rotateRight = function(t2) {
        if (null != t2) {
          var e2 = t2.left;
          t2.left = e2.right, null != e2.right && (e2.right.parent = t2), e2.parent = t2.parent, null == t2.parent ? this.root_ = e2 : t2.parent.right === t2 ? t2.parent.right = e2 : t2.parent.left = e2, e2.right = t2, t2.parent = e2;
        }
      }, rt.prototype.getFirstEntry = function() {
        var t2 = this.root_;
        if (null != t2) for (; null != t2.left; ) t2 = t2.left;
        return t2;
      }, rt.successor = function(t2) {
        let e2;
        if (null === t2) return null;
        if (null !== t2.right) {
          for (e2 = t2.right; null !== e2.left; ) e2 = e2.left;
          return e2;
        }
        e2 = t2.parent;
        for (var n2 = t2; null !== e2 && n2 === e2.right; ) n2 = e2, e2 = e2.parent;
        return e2;
      }, rt.prototype.size = function() {
        return this.size_;
      }, rt.prototype.containsKey = function(t2) {
        for (var e2 = this.root_; null !== e2; ) {
          var n2 = t2.compareTo(e2.key);
          if (n2 < 0) e2 = e2.left;
          else {
            if (!(n2 > 0)) return true;
            e2 = e2.right;
          }
        }
        return false;
      };
      class ot {
        constructor() {
          ot.constructor_.apply(this, arguments);
        }
        getClass() {
          return ot;
        }
        get interfaces_() {
          return [];
        }
      }
      function lt() {
      }
      function at() {
        this.array_ = [], arguments[0] instanceof f && this.addAll(arguments[0]);
      }
      ot.constructor_ = function() {
      }, lt.prototype = new Q(), at.prototype = new lt(), at.prototype.contains = function(t2) {
        for (let e2 = 0, n2 = this.array_.length; e2 < n2; e2++) {
          if (0 === this.array_[e2].compareTo(t2)) return true;
        }
        return false;
      }, at.prototype.add = function(t2) {
        if (this.contains(t2)) return false;
        for (let e2 = 0, n2 = this.array_.length; e2 < n2; e2++) {
          if (1 === this.array_[e2].compareTo(t2)) return this.array_.splice(e2, 0, t2), true;
        }
        return this.array_.push(t2), true;
      }, at.prototype.addAll = function(t2) {
        for (let e2 = t2.iterator(); e2.hasNext(); ) this.add(e2.next());
        return true;
      }, at.prototype.remove = function(t2) {
        throw new Z();
      }, at.prototype.size = function() {
        return this.array_.length;
      }, at.prototype.isEmpty = function() {
        return 0 === this.array_.length;
      }, at.prototype.toArray = function() {
        const t2 = [];
        for (let e2 = 0, n2 = this.array_.length; e2 < n2; e2++) t2.push(this.array_[e2]);
        return t2;
      }, at.prototype.iterator = function() {
        return new ct(this);
      };
      const ct = function(t2) {
        this.treeSet_ = t2, this.position_ = 0;
      };
      function ht() {
      }
      ct.prototype.next = function() {
        if (this.position_ === this.treeSet_.size()) throw new y();
        return this.treeSet_.array_[this.position_++];
      }, ct.prototype.hasNext = function() {
        return this.position_ < this.treeSet_.size();
      }, ct.prototype.remove = function() {
        throw new Z();
      }, ht.sort = function() {
        const t2 = arguments[0];
        let e2, n2, s2, i2;
        if (1 === arguments.length) i2 = function(t3, e3) {
          return t3.compareTo(e3);
        }, t2.sort(i2);
        else if (2 === arguments.length) s2 = arguments[1], i2 = function(t3, e3) {
          return s2.compare(t3, e3);
        }, t2.sort(i2);
        else if (3 === arguments.length) {
          n2 = t2.slice(arguments[1], arguments[2]), n2.sort();
          const s3 = t2.slice(0, arguments[1]).concat(n2, t2.slice(arguments[2], t2.length));
          for (t2.splice(0, t2.length), e2 = 0; e2 < s3.length; e2++) t2.push(s3[e2]);
        } else if (4 === arguments.length) {
          n2 = t2.slice(arguments[1], arguments[2]), s2 = arguments[3], i2 = function(t3, e3) {
            return s2.compare(t3, e3);
          }, n2.sort(i2);
          const r2 = t2.slice(0, arguments[1]).concat(n2, t2.slice(arguments[2], t2.length));
          for (t2.splice(0, t2.length), e2 = 0; e2 < r2.length; e2++) t2.push(r2[e2]);
        }
      }, ht.asList = function(t2) {
        const e2 = new x();
        for (let n2 = 0, s2 = t2.length; n2 < s2; n2++) e2.add(t2[n2]);
        return e2;
      };
      class ut {
        constructor() {
          ut.constructor_.apply(this, arguments);
        }
        static toDimensionSymbol(t2) {
          switch (t2) {
            case ut.FALSE:
              return ut.SYM_FALSE;
            case ut.TRUE:
              return ut.SYM_TRUE;
            case ut.DONTCARE:
              return ut.SYM_DONTCARE;
            case ut.P:
              return ut.SYM_P;
            case ut.L:
              return ut.SYM_L;
            case ut.A:
              return ut.SYM_A;
          }
          throw new n("Unknown dimension value: " + t2);
        }
        static toDimensionValue(t2) {
          switch (T.toUpperCase(t2)) {
            case ut.SYM_FALSE:
              return ut.FALSE;
            case ut.SYM_TRUE:
              return ut.TRUE;
            case ut.SYM_DONTCARE:
              return ut.DONTCARE;
            case ut.SYM_P:
              return ut.P;
            case ut.SYM_L:
              return ut.L;
            case ut.SYM_A:
              return ut.A;
          }
          throw new n("Unknown dimension symbol: " + t2);
        }
        getClass() {
          return ut;
        }
        get interfaces_() {
          return [];
        }
      }
      ut.constructor_ = function() {
      }, ut.P = 0, ut.L = 1, ut.A = 2, ut.FALSE = -1, ut.TRUE = -2, ut.DONTCARE = -3, ut.SYM_FALSE = "F", ut.SYM_TRUE = "T", ut.SYM_DONTCARE = "*", ut.SYM_P = "0", ut.SYM_L = "1", ut.SYM_A = "2";
      class gt {
        constructor() {
          gt.constructor_.apply(this, arguments);
        }
        filter(t2) {
        }
        getClass() {
          return gt;
        }
        get interfaces_() {
          return [];
        }
      }
      gt.constructor_ = function() {
      };
      class dt {
        constructor() {
          dt.constructor_.apply(this, arguments);
        }
        filter(t2, e2) {
        }
        isDone() {
        }
        isGeometryChanged() {
        }
        getClass() {
          return dt;
        }
        get interfaces_() {
          return [];
        }
      }
      dt.constructor_ = function() {
      };
      class _t extends q {
        constructor() {
          super(), _t.constructor_.apply(this, arguments);
        }
        computeEnvelopeInternal() {
          const t2 = new N();
          for (let e2 = 0; e2 < this._geometries.length; e2++) t2.expandToInclude(this._geometries[e2].getEnvelopeInternal());
          return t2;
        }
        getGeometryN(t2) {
          return this._geometries[t2];
        }
        getCoordinates() {
          const t2 = new Array(this.getNumPoints()).fill(null);
          let e2 = -1;
          for (let n2 = 0; n2 < this._geometries.length; n2++) {
            const s2 = this._geometries[n2].getCoordinates();
            for (let n3 = 0; n3 < s2.length; n3++) e2++, t2[e2] = s2[n3];
          }
          return t2;
        }
        getArea() {
          let t2 = 0;
          for (let e2 = 0; e2 < this._geometries.length; e2++) t2 += this._geometries[e2].getArea();
          return t2;
        }
        equalsExact() {
          if (2 === arguments.length && "number" == typeof arguments[1] && arguments[0] instanceof q) {
            const t2 = arguments[0], e2 = arguments[1];
            if (!this.isEquivalentClass(t2)) return false;
            const n2 = t2;
            if (this._geometries.length !== n2._geometries.length) return false;
            for (let t3 = 0; t3 < this._geometries.length; t3++) if (!this._geometries[t3].equalsExact(n2._geometries[t3], e2)) return false;
            return true;
          }
          return super.equalsExact.apply(this, arguments);
        }
        normalize() {
          for (let t2 = 0; t2 < this._geometries.length; t2++) this._geometries[t2].normalize();
          ht.sort(this._geometries);
        }
        getCoordinate() {
          return this.isEmpty() ? null : this._geometries[0].getCoordinate();
        }
        getBoundaryDimension() {
          let t2 = ut.FALSE;
          for (let e2 = 0; e2 < this._geometries.length; e2++) t2 = Math.max(t2, this._geometries[e2].getBoundaryDimension());
          return t2;
        }
        getTypeCode() {
          return q.TYPECODE_GEOMETRYCOLLECTION;
        }
        getDimension() {
          let t2 = ut.FALSE;
          for (let e2 = 0; e2 < this._geometries.length; e2++) t2 = Math.max(t2, this._geometries[e2].getDimension());
          return t2;
        }
        getLength() {
          let t2 = 0;
          for (let e2 = 0; e2 < this._geometries.length; e2++) t2 += this._geometries[e2].getLength();
          return t2;
        }
        getNumPoints() {
          let t2 = 0;
          for (let e2 = 0; e2 < this._geometries.length; e2++) t2 += this._geometries[e2].getNumPoints();
          return t2;
        }
        getNumGeometries() {
          return this._geometries.length;
        }
        reverse() {
          const t2 = this._geometries.length, e2 = new Array(t2).fill(null);
          for (let t3 = 0; t3 < this._geometries.length; t3++) e2[t3] = this._geometries[t3].reverse();
          return this.getFactory().createGeometryCollection(e2);
        }
        compareToSameClass() {
          if (1 === arguments.length) {
            const t2 = arguments[0], e2 = new at(ht.asList(this._geometries)), n2 = new at(ht.asList(t2._geometries));
            return this.compare(e2, n2);
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = t2, s2 = this.getNumGeometries(), i2 = n2.getNumGeometries();
            let r2 = 0;
            for (; r2 < s2 && r2 < i2; ) {
              const t3 = this.getGeometryN(r2), s3 = n2.getGeometryN(r2), i3 = t3.compareToSameClass(s3, e2);
              if (0 !== i3) return i3;
              r2++;
            }
            return r2 < s2 ? 1 : r2 < i2 ? -1 : 0;
          }
        }
        apply() {
          if (_(arguments[0], B)) {
            const t2 = arguments[0];
            for (let e2 = 0; e2 < this._geometries.length; e2++) this._geometries[e2].apply(t2);
          } else if (_(arguments[0], dt)) {
            const t2 = arguments[0];
            if (0 === this._geometries.length) return null;
            for (let e2 = 0; e2 < this._geometries.length && (this._geometries[e2].apply(t2), !t2.isDone()); e2++) ;
            t2.isGeometryChanged() && this.geometryChanged();
          } else if (_(arguments[0], gt)) {
            const t2 = arguments[0];
            t2.filter(this);
            for (let e2 = 0; e2 < this._geometries.length; e2++) this._geometries[e2].apply(t2);
          } else if (_(arguments[0], G)) {
            const t2 = arguments[0];
            t2.filter(this);
            for (let e2 = 0; e2 < this._geometries.length; e2++) this._geometries[e2].apply(t2);
          }
        }
        getBoundary() {
          return this.checkNotGeometryCollection(this), u.shouldNeverReachHere(), null;
        }
        getGeometryType() {
          return q.TYPENAME_GEOMETRYCOLLECTION;
        }
        copy() {
          const t2 = new Array(this._geometries.length).fill(null);
          for (let e2 = 0; e2 < t2.length; e2++) t2[e2] = this._geometries[e2].copy();
          return new _t(t2, this._factory);
        }
        isEmpty() {
          for (let t2 = 0; t2 < this._geometries.length; t2++) if (!this._geometries[t2].isEmpty()) return false;
          return true;
        }
        getClass() {
          return _t;
        }
        get interfaces_() {
          return [];
        }
      }
      _t.constructor_ = function() {
        if (this._geometries = null, 0 === arguments.length) ;
        else if (2 === arguments.length) {
          let t2 = arguments[0];
          const e2 = arguments[1];
          if (q.constructor_.call(this, e2), null === t2 && (t2 = []), q.hasNullElements(t2)) throw new n("geometries must not contain null elements");
          this._geometries = t2;
        }
      }, _t.serialVersionUID = -5694727726395021e3;
      class ft extends _t {
        constructor() {
          super(), ft.constructor_.apply(this, arguments);
        }
        equalsExact() {
          if (2 === arguments.length && "number" == typeof arguments[1] && arguments[0] instanceof q) {
            const t2 = arguments[0], e2 = arguments[1];
            return !!this.isEquivalentClass(t2) && super.equalsExact.call(this, t2, e2);
          }
          return super.equalsExact.apply(this, arguments);
        }
        getBoundaryDimension() {
          return this.isClosed() ? ut.FALSE : 0;
        }
        isClosed() {
          if (this.isEmpty()) return false;
          for (let t2 = 0; t2 < this._geometries.length; t2++) if (!this._geometries[t2].isClosed()) return false;
          return true;
        }
        getTypeCode() {
          return q.TYPECODE_MULTILINESTRING;
        }
        getDimension() {
          return 1;
        }
        reverse() {
          const t2 = this._geometries.length, e2 = new Array(t2).fill(null);
          for (let n2 = 0; n2 < this._geometries.length; n2++) e2[t2 - 1 - n2] = this._geometries[n2].reverse();
          return this.getFactory().createMultiLineString(e2);
        }
        getBoundary() {
          return new pt(this).getBoundary();
        }
        getGeometryType() {
          return q.TYPENAME_MULTILINESTRING;
        }
        copy() {
          const t2 = new Array(this._geometries.length).fill(null);
          for (let e2 = 0; e2 < t2.length; e2++) t2[e2] = this._geometries[e2].copy();
          return new ft(t2, this._factory);
        }
        getClass() {
          return ft;
        }
        get interfaces_() {
          return [ot];
        }
      }
      ft.constructor_ = function() {
        const t2 = arguments[0], e2 = arguments[1];
        _t.constructor_.call(this, t2, e2);
      }, ft.serialVersionUID = 8166665132445434e3;
      class pt {
        constructor() {
          pt.constructor_.apply(this, arguments);
        }
        static getBoundary() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return new pt(t2).getBoundary();
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return new pt(t2, e2).getBoundary();
          }
        }
        boundaryMultiLineString(t2) {
          if (this._geom.isEmpty()) return this.getEmptyMultiPoint();
          const e2 = this.computeBoundaryCoordinates(t2);
          return 1 === e2.length ? this._geomFact.createPoint(e2[0]) : this._geomFact.createMultiPointFromCoords(e2);
        }
        getBoundary() {
          return this._geom instanceof Tt ? this.boundaryLineString(this._geom) : this._geom instanceof ft ? this.boundaryMultiLineString(this._geom) : this._geom.getBoundary();
        }
        boundaryLineString(t2) {
          if (this._geom.isEmpty()) return this.getEmptyMultiPoint();
          if (t2.isClosed()) {
            return this._bnRule.isInBoundary(2) ? t2.getStartPoint() : this._geomFact.createMultiPoint();
          }
          return this._geomFact.createMultiPoint([t2.getStartPoint(), t2.getEndPoint()]);
        }
        getEmptyMultiPoint() {
          return this._geomFact.createMultiPoint();
        }
        computeBoundaryCoordinates(t2) {
          const e2 = new x();
          this._endpointMap = new rt();
          for (let e3 = 0; e3 < t2.getNumGeometries(); e3++) {
            const n2 = t2.getGeometryN(e3);
            0 !== n2.getNumPoints() && (this.addEndpoint(n2.getCoordinateN(0)), this.addEndpoint(n2.getCoordinateN(n2.getNumPoints() - 1)));
          }
          for (let t3 = this._endpointMap.entrySet().iterator(); t3.hasNext(); ) {
            const n2 = t3.next(), s2 = n2.getValue().count;
            this._bnRule.isInBoundary(s2) && e2.add(n2.getKey());
          }
          return X.toCoordinateArray(e2);
        }
        addEndpoint(t2) {
          let e2 = this._endpointMap.get(t2);
          null === e2 && (e2 = new mt(), this._endpointMap.put(t2, e2)), e2.count++;
        }
        getClass() {
          return pt;
        }
        get interfaces_() {
          return [];
        }
      }
      pt.constructor_ = function() {
        if (this._geom = null, this._geomFact = null, this._bnRule = null, this._endpointMap = null, 1 === arguments.length) {
          const t2 = arguments[0];
          pt.constructor_.call(this, t2, V.MOD2_BOUNDARY_RULE);
        } else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          this._geom = t2, this._geomFact = t2.getFactory(), this._bnRule = e2;
        }
      };
      class mt {
        constructor() {
          mt.constructor_.apply(this, arguments);
        }
        getClass() {
          return mt;
        }
        get interfaces_() {
          return [];
        }
      }
      mt.constructor_ = function() {
        this.count = null;
      };
      class yt {
        constructor() {
          yt.constructor_.apply(this, arguments);
        }
        static ofLine(t2) {
          const e2 = t2.size();
          if (e2 <= 1) return 0;
          let n2 = 0;
          const s2 = new g();
          t2.getCoordinate(0, s2);
          let i2 = s2.x, r2 = s2.y;
          for (let o2 = 1; o2 < e2; o2++) {
            t2.getCoordinate(o2, s2);
            const e3 = s2.x, l2 = s2.y, a2 = e3 - i2, c2 = l2 - r2;
            n2 += Math.sqrt(a2 * a2 + c2 * c2), i2 = e3, r2 = l2;
          }
          return n2;
        }
        getClass() {
          return yt;
        }
        get interfaces_() {
          return [];
        }
      }
      function xt() {
      }
      function Et() {
      }
      function It() {
      }
      function Nt() {
      }
      function Ct() {
      }
      yt.constructor_ = function() {
      };
      class St {
        constructor() {
          St.constructor_.apply(this, arguments);
        }
        static chars(t2, e2) {
          const n2 = new Array(e2).fill(null);
          for (let s2 = 0; s2 < e2; s2++) n2[s2] = t2;
          return new String(n2);
        }
        static getStackTrace() {
          if (1 === arguments.length) {
            const t2 = arguments[0], e2 = new It(), n2 = new xt(e2);
            return t2.printStackTrace(n2), e2.toString();
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            let n2 = "";
            const s2 = new Ct(new Et(St.getStackTrace(t2)));
            for (let t3 = 0; t3 < e2; t3++) try {
              n2 += s2.readLine() + St.NEWLINE;
            } catch (t4) {
              if (!(t4 instanceof Nt)) throw t4;
              u.shouldNeverReachHere();
            }
            return n2;
          }
        }
        static split(t2, e2) {
          const n2 = e2.length, s2 = new x();
          let i2 = "" + t2, r2 = i2.indexOf(e2);
          for (; r2 >= 0; ) {
            const t3 = i2.substring(0, r2);
            s2.add(t3), i2 = i2.substring(r2 + n2), r2 = i2.indexOf(e2);
          }
          i2.length > 0 && s2.add(i2);
          const o2 = new Array(s2.size()).fill(null);
          for (let t3 = 0; t3 < o2.length; t3++) o2[t3] = s2.get(t3);
          return o2;
        }
        static toString() {
          if (1 === arguments.length && "number" == typeof arguments[0]) {
            const t2 = arguments[0];
            return St.SIMPLE_ORDINATE_FORMAT.format(t2);
          }
        }
        static spaces(t2) {
          return St.chars(" ", t2);
        }
        getClass() {
          return St;
        }
        get interfaces_() {
          return [];
        }
      }
      function wt(t2) {
        this.str = t2;
      }
      St.constructor_ = function() {
      }, St.NEWLINE = O.getProperty("line.separator"), St.SIMPLE_ORDINATE_FORMAT = new function() {
      }("0.#"), wt.prototype.append = function(t2) {
        this.str += t2;
      }, wt.prototype.setCharAt = function(t2, e2) {
        this.str = this.str.substr(0, t2) + e2 + this.str.substr(t2 + 1);
      }, wt.prototype.toString = function(t2) {
        return this.str;
      };
      class Lt {
        constructor() {
          Lt.constructor_.apply(this, arguments);
        }
        static copyCoord(t2, e2, n2, s2) {
          const i2 = Math.min(t2.getDimension(), n2.getDimension());
          for (let r2 = 0; r2 < i2; r2++) n2.setOrdinate(s2, r2, t2.getOrdinate(e2, r2));
        }
        static isRing(t2) {
          const e2 = t2.size();
          return 0 === e2 || !(e2 <= 3) && (t2.getOrdinate(0, A.X) === t2.getOrdinate(e2 - 1, A.X) && t2.getOrdinate(0, A.Y) === t2.getOrdinate(e2 - 1, A.Y));
        }
        static isEqual(t2, e2) {
          const n2 = t2.size();
          if (n2 !== e2.size()) return false;
          const s2 = Math.min(t2.getDimension(), e2.getDimension());
          for (let r2 = 0; r2 < n2; r2++) for (let n3 = 0; n3 < s2; n3++) {
            const s3 = t2.getOrdinate(r2, n3), o2 = e2.getOrdinate(r2, n3);
            if (t2.getOrdinate(r2, n3) !== e2.getOrdinate(r2, n3) && (!i.isNaN(s3) || !i.isNaN(o2))) return false;
          }
          return true;
        }
        static extend(t2, e2, n2) {
          const s2 = t2.create(n2, e2.getDimension()), i2 = e2.size();
          if (Lt.copy(e2, 0, s2, 0, i2), i2 > 0) for (let t3 = i2; t3 < n2; t3++) Lt.copy(e2, i2 - 1, s2, t3, 1);
          return s2;
        }
        static reverse(t2) {
          const e2 = t2.size() - 1, n2 = Math.trunc(e2 / 2);
          for (let s2 = 0; s2 <= n2; s2++) Lt.swap(t2, s2, e2 - s2);
        }
        static swap(t2, e2, n2) {
          if (e2 === n2) return null;
          for (let s2 = 0; s2 < t2.getDimension(); s2++) {
            const i2 = t2.getOrdinate(e2, s2);
            t2.setOrdinate(e2, s2, t2.getOrdinate(n2, s2)), t2.setOrdinate(n2, s2, i2);
          }
        }
        static copy(t2, e2, n2, s2, i2) {
          for (let r2 = 0; r2 < i2; r2++) Lt.copyCoord(t2, e2 + r2, n2, s2 + r2);
        }
        static toString() {
          if (1 === arguments.length && _(arguments[0], A)) {
            const t2 = arguments[0], e2 = t2.size();
            if (0 === e2) return "()";
            const n2 = t2.getDimension(), s2 = new wt();
            s2.append("(");
            for (let i2 = 0; i2 < e2; i2++) {
              i2 > 0 && s2.append(" ");
              for (let e3 = 0; e3 < n2; e3++) e3 > 0 && s2.append(","), s2.append(St.toString(t2.getOrdinate(i2, e3)));
            }
            return s2.append(")"), s2.toString();
          }
        }
        static ensureValidRing(t2, e2) {
          const n2 = e2.size();
          return 0 === n2 ? e2 : n2 <= 3 ? Lt.createClosedRing(t2, e2, 4) : e2.getOrdinate(0, A.X) === e2.getOrdinate(n2 - 1, A.X) && e2.getOrdinate(0, A.Y) === e2.getOrdinate(n2 - 1, A.Y) ? e2 : Lt.createClosedRing(t2, e2, n2 + 1);
        }
        static createClosedRing(t2, e2, n2) {
          const s2 = t2.create(n2, e2.getDimension()), i2 = e2.size();
          Lt.copy(e2, 0, s2, 0, i2);
          for (let t3 = i2; t3 < n2; t3++) Lt.copy(e2, 0, s2, t3, 1);
          return s2;
        }
        getClass() {
          return Lt;
        }
        get interfaces_() {
          return [];
        }
      }
      Lt.constructor_ = function() {
      };
      class Tt extends q {
        constructor() {
          super(), Tt.constructor_.apply(this, arguments);
        }
        computeEnvelopeInternal() {
          return this.isEmpty() ? new N() : this._points.expandEnvelope(new N());
        }
        isRing() {
          return this.isClosed() && this.isSimple();
        }
        getCoordinates() {
          return this._points.toCoordinateArray();
        }
        equalsExact() {
          if (2 === arguments.length && "number" == typeof arguments[1] && arguments[0] instanceof q) {
            const t2 = arguments[0], e2 = arguments[1];
            if (!this.isEquivalentClass(t2)) return false;
            const n2 = t2;
            if (this._points.size() !== n2._points.size()) return false;
            for (let t3 = 0; t3 < this._points.size(); t3++) if (!this.equal(this._points.getCoordinate(t3), n2._points.getCoordinate(t3), e2)) return false;
            return true;
          }
          return super.equalsExact.apply(this, arguments);
        }
        normalize() {
          for (let t2 = 0; t2 < Math.trunc(this._points.size() / 2); t2++) {
            const e2 = this._points.size() - 1 - t2;
            if (!this._points.getCoordinate(t2).equals(this._points.getCoordinate(e2))) {
              if (this._points.getCoordinate(t2).compareTo(this._points.getCoordinate(e2)) > 0) {
                const t3 = this._points.copy();
                Lt.reverse(t3), this._points = t3;
              }
              return null;
            }
          }
        }
        getCoordinate() {
          return this.isEmpty() ? null : this._points.getCoordinate(0);
        }
        getBoundaryDimension() {
          return this.isClosed() ? ut.FALSE : 0;
        }
        isClosed() {
          return !this.isEmpty() && this.getCoordinateN(0).equals2D(this.getCoordinateN(this.getNumPoints() - 1));
        }
        getEndPoint() {
          return this.isEmpty() ? null : this.getPointN(this.getNumPoints() - 1);
        }
        getTypeCode() {
          return q.TYPECODE_LINESTRING;
        }
        getDimension() {
          return 1;
        }
        getLength() {
          return yt.ofLine(this._points);
        }
        getNumPoints() {
          return this._points.size();
        }
        reverse() {
          const t2 = this._points.copy();
          return Lt.reverse(t2), this.getFactory().createLineString(t2);
        }
        compareToSameClass() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            let e2 = 0, n2 = 0;
            for (; e2 < this._points.size() && n2 < t2._points.size(); ) {
              const s2 = this._points.getCoordinate(e2).compareTo(t2._points.getCoordinate(n2));
              if (0 !== s2) return s2;
              e2++, n2++;
            }
            return e2 < this._points.size() ? 1 : n2 < t2._points.size() ? -1 : 0;
          }
          if (2 === arguments.length) {
            const t2 = arguments[0];
            return arguments[1].compare(this._points, t2._points);
          }
        }
        apply() {
          if (_(arguments[0], B)) {
            const t2 = arguments[0];
            for (let e2 = 0; e2 < this._points.size(); e2++) t2.filter(this._points.getCoordinate(e2));
          } else if (_(arguments[0], dt)) {
            const t2 = arguments[0];
            if (0 === this._points.size()) return null;
            for (let e2 = 0; e2 < this._points.size() && (t2.filter(this._points, e2), !t2.isDone()); e2++) ;
            t2.isGeometryChanged() && this.geometryChanged();
          } else if (_(arguments[0], gt)) {
            arguments[0].filter(this);
          } else if (_(arguments[0], G)) {
            arguments[0].filter(this);
          }
        }
        getBoundary() {
          return new pt(this).getBoundary();
        }
        isEquivalentClass(t2) {
          return t2 instanceof Tt;
        }
        getCoordinateN(t2) {
          return this._points.getCoordinate(t2);
        }
        getGeometryType() {
          return q.TYPENAME_LINESTRING;
        }
        copy() {
          return new Tt(this._points.copy(), this._factory);
        }
        getCoordinateSequence() {
          return this._points;
        }
        isEmpty() {
          return 0 === this._points.size();
        }
        init(t2) {
          if (null === t2 && (t2 = this.getFactory().getCoordinateSequenceFactory().create([])), 1 === t2.size()) throw new n("Invalid number of points in LineString (found " + t2.size() + " - must be 0 or >= 2)");
          this._points = t2;
        }
        isCoordinate(t2) {
          for (let e2 = 0; e2 < this._points.size(); e2++) if (this._points.getCoordinate(e2).equals(t2)) return true;
          return false;
        }
        getStartPoint() {
          return this.isEmpty() ? null : this.getPointN(0);
        }
        getPointN(t2) {
          return this.getFactory().createPoint(this._points.getCoordinate(t2));
        }
        getClass() {
          return Tt;
        }
        get interfaces_() {
          return [ot];
        }
      }
      Tt.constructor_ = function() {
        if (this._points = null, 0 === arguments.length) ;
        else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          q.constructor_.call(this, e2), this.init(t2);
        }
      }, Tt.serialVersionUID = 3110669828065365500;
      class Rt {
        constructor() {
          Rt.constructor_.apply(this, arguments);
        }
        getClass() {
          return Rt;
        }
        get interfaces_() {
          return [];
        }
      }
      Rt.constructor_ = function() {
      };
      class Pt extends q {
        constructor() {
          super(), Pt.constructor_.apply(this, arguments);
        }
        computeEnvelopeInternal() {
          if (this.isEmpty()) return new N();
          const t2 = new N();
          return t2.expandToInclude(this._coordinates.getX(0), this._coordinates.getY(0)), t2;
        }
        getCoordinates() {
          return this.isEmpty() ? [] : [this.getCoordinate()];
        }
        equalsExact() {
          if (2 === arguments.length && "number" == typeof arguments[1] && arguments[0] instanceof q) {
            const t2 = arguments[0], e2 = arguments[1];
            return !!this.isEquivalentClass(t2) && (!(!this.isEmpty() || !t2.isEmpty()) || this.isEmpty() === t2.isEmpty() && this.equal(t2.getCoordinate(), this.getCoordinate(), e2));
          }
          return super.equalsExact.apply(this, arguments);
        }
        normalize() {
        }
        getCoordinate() {
          return 0 !== this._coordinates.size() ? this._coordinates.getCoordinate(0) : null;
        }
        getBoundaryDimension() {
          return ut.FALSE;
        }
        getTypeCode() {
          return q.TYPECODE_POINT;
        }
        getDimension() {
          return 0;
        }
        getNumPoints() {
          return this.isEmpty() ? 0 : 1;
        }
        reverse() {
          return this.copy();
        }
        getX() {
          if (null === this.getCoordinate()) throw new IllegalStateException("getX called on empty Point");
          return this.getCoordinate().x;
        }
        compareToSameClass() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return this.getCoordinate().compareTo(t2.getCoordinate());
          }
          if (2 === arguments.length) {
            const t2 = arguments[0];
            return arguments[1].compare(this._coordinates, t2._coordinates);
          }
        }
        apply() {
          if (_(arguments[0], B)) {
            const t2 = arguments[0];
            if (this.isEmpty()) return null;
            t2.filter(this.getCoordinate());
          } else if (_(arguments[0], dt)) {
            const t2 = arguments[0];
            if (this.isEmpty()) return null;
            t2.filter(this._coordinates, 0), t2.isGeometryChanged() && this.geometryChanged();
          } else if (_(arguments[0], gt)) {
            arguments[0].filter(this);
          } else if (_(arguments[0], G)) {
            arguments[0].filter(this);
          }
        }
        getBoundary() {
          return this.getFactory().createGeometryCollection();
        }
        getGeometryType() {
          return q.TYPENAME_POINT;
        }
        copy() {
          return new Pt(this._coordinates.copy(), this._factory);
        }
        getCoordinateSequence() {
          return this._coordinates;
        }
        getY() {
          if (null === this.getCoordinate()) throw new IllegalStateException("getY called on empty Point");
          return this.getCoordinate().y;
        }
        isEmpty() {
          return 0 === this._coordinates.size();
        }
        init(t2) {
          null === t2 && (t2 = this.getFactory().getCoordinateSequenceFactory().create([])), u.isTrue(t2.size() <= 1), this._coordinates = t2;
        }
        isSimple() {
          return true;
        }
        getClass() {
          return Pt;
        }
        get interfaces_() {
          return [Rt];
        }
      }
      Pt.constructor_ = function() {
        this._coordinates = null;
        const t2 = arguments[0], e2 = arguments[1];
        q.constructor_.call(this, e2), this.init(t2);
      }, Pt.serialVersionUID = 4902022702746615e3;
      class vt {
        constructor() {
          vt.constructor_.apply(this, arguments);
        }
        static ofRing() {
          if (arguments[0] instanceof Array) {
            const t2 = arguments[0];
            return Math.abs(vt.ofRingSigned(t2));
          }
          if (_(arguments[0], A)) {
            const t2 = arguments[0];
            return Math.abs(vt.ofRingSigned(t2));
          }
        }
        static ofRingSigned() {
          if (arguments[0] instanceof Array) {
            const t2 = arguments[0];
            if (t2.length < 3) return 0;
            let e2 = 0;
            const n2 = t2[0].x;
            for (let s2 = 1; s2 < t2.length - 1; s2++) {
              const i2 = t2[s2].x - n2, r2 = t2[s2 + 1].y;
              e2 += i2 * (t2[s2 - 1].y - r2);
            }
            return e2 / 2;
          }
          if (_(arguments[0], A)) {
            const t2 = arguments[0], e2 = t2.size();
            if (e2 < 3) return 0;
            const n2 = new g(), s2 = new g(), i2 = new g();
            t2.getCoordinate(0, s2), t2.getCoordinate(1, i2);
            const r2 = s2.x;
            i2.x -= r2;
            let o2 = 0;
            for (let l2 = 1; l2 < e2 - 1; l2++) n2.y = s2.y, s2.x = i2.x, s2.y = i2.y, t2.getCoordinate(l2 + 1, i2), i2.x -= r2, o2 += s2.x * (n2.y - i2.y);
            return o2 / 2;
          }
        }
        getClass() {
          return vt;
        }
        get interfaces_() {
          return [];
        }
      }
      vt.constructor_ = function() {
      };
      class Ot {
        constructor() {
          Ot.constructor_.apply(this, arguments);
        }
        getClass() {
          return Ot;
        }
        get interfaces_() {
          return [];
        }
      }
      Ot.constructor_ = function() {
      };
      class bt extends q {
        constructor() {
          super(), bt.constructor_.apply(this, arguments);
        }
        computeEnvelopeInternal() {
          return this._shell.getEnvelopeInternal();
        }
        getCoordinates() {
          if (this.isEmpty()) return [];
          const t2 = new Array(this.getNumPoints()).fill(null);
          let e2 = -1;
          const n2 = this._shell.getCoordinates();
          for (let s2 = 0; s2 < n2.length; s2++) e2++, t2[e2] = n2[s2];
          for (let n3 = 0; n3 < this._holes.length; n3++) {
            const s2 = this._holes[n3].getCoordinates();
            for (let n4 = 0; n4 < s2.length; n4++) e2++, t2[e2] = s2[n4];
          }
          return t2;
        }
        getArea() {
          let t2 = 0;
          t2 += vt.ofRing(this._shell.getCoordinateSequence());
          for (let e2 = 0; e2 < this._holes.length; e2++) t2 -= vt.ofRing(this._holes[e2].getCoordinateSequence());
          return t2;
        }
        isRectangle() {
          if (0 !== this.getNumInteriorRing()) return false;
          if (null === this._shell) return false;
          if (5 !== this._shell.getNumPoints()) return false;
          const t2 = this._shell.getCoordinateSequence(), e2 = this.getEnvelopeInternal();
          for (let n3 = 0; n3 < 5; n3++) {
            const s3 = t2.getX(n3);
            if (s3 !== e2.getMinX() && s3 !== e2.getMaxX()) return false;
            const i2 = t2.getY(n3);
            if (i2 !== e2.getMinY() && i2 !== e2.getMaxY()) return false;
          }
          let n2 = t2.getX(0), s2 = t2.getY(0);
          for (let e3 = 1; e3 <= 4; e3++) {
            const i2 = t2.getX(e3), r2 = t2.getY(e3);
            if (i2 !== n2 === (r2 !== s2)) return false;
            n2 = i2, s2 = r2;
          }
          return true;
        }
        equalsExact() {
          if (2 === arguments.length && "number" == typeof arguments[1] && arguments[0] instanceof q) {
            const t2 = arguments[0], e2 = arguments[1];
            if (!this.isEquivalentClass(t2)) return false;
            const n2 = t2, s2 = this._shell, i2 = n2._shell;
            if (!s2.equalsExact(i2, e2)) return false;
            if (this._holes.length !== n2._holes.length) return false;
            for (let t3 = 0; t3 < this._holes.length; t3++) if (!this._holes[t3].equalsExact(n2._holes[t3], e2)) return false;
            return true;
          }
          return super.equalsExact.apply(this, arguments);
        }
        normalize() {
          if (0 === arguments.length) {
            this.normalize(this._shell, true);
            for (let t2 = 0; t2 < this._holes.length; t2++) this.normalize(this._holes[t2], false);
            ht.sort(this._holes);
          } else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            if (t2.isEmpty()) return null;
            const n2 = new Array(t2.getCoordinates().length - 1).fill(null);
            O.arraycopy(t2.getCoordinates(), 0, n2, 0, n2.length);
            const s2 = X.minCoordinate(t2.getCoordinates());
            X.scroll(n2, s2), O.arraycopy(n2, 0, t2.getCoordinates(), 0, n2.length), t2.getCoordinates()[n2.length] = n2[0], v.isCCW(t2.getCoordinates()) === e2 && X.reverse(t2.getCoordinates());
          }
        }
        getCoordinate() {
          return this._shell.getCoordinate();
        }
        getNumInteriorRing() {
          return this._holes.length;
        }
        getBoundaryDimension() {
          return 1;
        }
        getTypeCode() {
          return q.TYPECODE_POLYGON;
        }
        getDimension() {
          return 2;
        }
        getLength() {
          let t2 = 0;
          t2 += this._shell.getLength();
          for (let e2 = 0; e2 < this._holes.length; e2++) t2 += this._holes[e2].getLength();
          return t2;
        }
        getNumPoints() {
          let t2 = this._shell.getNumPoints();
          for (let e2 = 0; e2 < this._holes.length; e2++) t2 += this._holes[e2].getNumPoints();
          return t2;
        }
        reverse() {
          const t2 = this.copy();
          t2._shell = this._shell.copy().reverse(), t2._holes = new Array(this._holes.length).fill(null);
          for (let e2 = 0; e2 < this._holes.length; e2++) t2._holes[e2] = this._holes[e2].copy().reverse();
          return t2;
        }
        convexHull() {
          return this.getExteriorRing().convexHull();
        }
        compareToSameClass() {
          if (1 === arguments.length) {
            const t2 = arguments[0], e2 = this._shell, n2 = t2._shell;
            return e2.compareToSameClass(n2);
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = t2, s2 = this._shell, i2 = n2._shell, r2 = s2.compareToSameClass(i2, e2);
            if (0 !== r2) return r2;
            const o2 = this.getNumInteriorRing(), l2 = n2.getNumInteriorRing();
            let a2 = 0;
            for (; a2 < o2 && a2 < l2; ) {
              const t3 = this.getInteriorRingN(a2), s3 = n2.getInteriorRingN(a2), i3 = t3.compareToSameClass(s3, e2);
              if (0 !== i3) return i3;
              a2++;
            }
            return a2 < o2 ? 1 : a2 < l2 ? -1 : 0;
          }
        }
        apply() {
          if (_(arguments[0], B)) {
            const t2 = arguments[0];
            this._shell.apply(t2);
            for (let e2 = 0; e2 < this._holes.length; e2++) this._holes[e2].apply(t2);
          } else if (_(arguments[0], dt)) {
            const t2 = arguments[0];
            if (this._shell.apply(t2), !t2.isDone()) for (let e2 = 0; e2 < this._holes.length && (this._holes[e2].apply(t2), !t2.isDone()); e2++) ;
            t2.isGeometryChanged() && this.geometryChanged();
          } else if (_(arguments[0], gt)) {
            arguments[0].filter(this);
          } else if (_(arguments[0], G)) {
            const t2 = arguments[0];
            t2.filter(this), this._shell.apply(t2);
            for (let e2 = 0; e2 < this._holes.length; e2++) this._holes[e2].apply(t2);
          }
        }
        getBoundary() {
          if (this.isEmpty()) return this.getFactory().createMultiLineString();
          const t2 = new Array(this._holes.length + 1).fill(null);
          t2[0] = this._shell;
          for (let e2 = 0; e2 < this._holes.length; e2++) t2[e2 + 1] = this._holes[e2];
          return t2.length <= 1 ? this.getFactory().createLinearRing(t2[0].getCoordinateSequence()) : this.getFactory().createMultiLineString(t2);
        }
        getGeometryType() {
          return q.TYPENAME_POLYGON;
        }
        copy() {
          const t2 = this._shell.copy(), e2 = new Array(this._holes.length).fill(null);
          for (let t3 = 0; t3 < this._holes.length; t3++) e2[t3] = this._holes[t3].copy();
          return new bt(t2, e2, this._factory);
        }
        getExteriorRing() {
          return this._shell;
        }
        isEmpty() {
          return this._shell.isEmpty();
        }
        getInteriorRingN(t2) {
          return this._holes[t2];
        }
        getClass() {
          return bt;
        }
        get interfaces_() {
          return [Ot];
        }
      }
      bt.constructor_ = function() {
        this._shell = null, this._holes = null;
        let t2 = arguments[0], e2 = arguments[1];
        const s2 = arguments[2];
        if (q.constructor_.call(this, s2), null === t2 && (t2 = this.getFactory().createLinearRing()), null === e2 && (e2 = []), q.hasNullElements(e2)) throw new n("holes must not contain null elements");
        if (t2.isEmpty() && q.hasNonEmptyElements(e2)) throw new n("shell is empty but holes are not");
        this._shell = t2, this._holes = e2;
      }, bt.serialVersionUID = -3494792200821764600;
      class Mt extends _t {
        constructor() {
          super(), Mt.constructor_.apply(this, arguments);
        }
        isValid() {
          return true;
        }
        equalsExact() {
          if (2 === arguments.length && "number" == typeof arguments[1] && arguments[0] instanceof q) {
            const t2 = arguments[0], e2 = arguments[1];
            return !!this.isEquivalentClass(t2) && super.equalsExact.call(this, t2, e2);
          }
          return super.equalsExact.apply(this, arguments);
        }
        getCoordinate() {
          if (1 === arguments.length && Number.isInteger(arguments[0])) {
            const t2 = arguments[0];
            return this._geometries[t2].getCoordinate();
          }
          return super.getCoordinate.apply(this, arguments);
        }
        getBoundaryDimension() {
          return ut.FALSE;
        }
        getTypeCode() {
          return q.TYPECODE_MULTIPOINT;
        }
        getDimension() {
          return 0;
        }
        getBoundary() {
          return this.getFactory().createGeometryCollection();
        }
        getGeometryType() {
          return q.TYPENAME_MULTIPOINT;
        }
        copy() {
          const t2 = new Array(this._geometries.length).fill(null);
          for (let e2 = 0; e2 < t2.length; e2++) t2[e2] = this._geometries[e2].copy();
          return new Mt(t2, this._factory);
        }
        getClass() {
          return Mt;
        }
        get interfaces_() {
          return [Rt];
        }
      }
      Mt.constructor_ = function() {
        const t2 = arguments[0], e2 = arguments[1];
        _t.constructor_.call(this, t2, e2);
      }, Mt.serialVersionUID = -8048474874175356e3;
      class Dt extends Tt {
        constructor() {
          super(), Dt.constructor_.apply(this, arguments);
        }
        getBoundaryDimension() {
          return ut.FALSE;
        }
        isClosed() {
          return !!this.isEmpty() || super.isClosed.call(this);
        }
        getTypeCode() {
          return q.TYPECODE_LINEARRING;
        }
        reverse() {
          const t2 = this._points.copy();
          return Lt.reverse(t2), this.getFactory().createLinearRing(t2);
        }
        validateConstruction() {
          if (!this.isEmpty() && !super.isClosed.call(this)) throw new n("Points of LinearRing do not form a closed linestring");
          if (this.getCoordinateSequence().size() >= 1 && this.getCoordinateSequence().size() < Dt.MINIMUM_VALID_SIZE) throw new n("Invalid number of points in LinearRing (found " + this.getCoordinateSequence().size() + " - must be 0 or >= 4)");
        }
        getGeometryType() {
          return q.TYPENAME_LINEARRING;
        }
        copy() {
          return new Dt(this._points.copy(), this._factory);
        }
        getClass() {
          return Dt;
        }
        get interfaces_() {
          return [];
        }
      }
      Dt.constructor_ = function() {
        if (arguments[0] instanceof Array && arguments[1] instanceof Ht) {
          const t2 = arguments[0], e2 = arguments[1];
          Dt.constructor_.call(this, e2.getCoordinateSequenceFactory().create(t2), e2);
        } else if (_(arguments[0], A) && arguments[1] instanceof Ht) {
          const t2 = arguments[0], e2 = arguments[1];
          Tt.constructor_.call(this, t2, e2), this.validateConstruction();
        }
      }, Dt.MINIMUM_VALID_SIZE = 4, Dt.serialVersionUID = -4261142084085851600;
      class At extends _t {
        constructor() {
          super(), At.constructor_.apply(this, arguments);
        }
        equalsExact() {
          if (2 === arguments.length && "number" == typeof arguments[1] && arguments[0] instanceof q) {
            const t2 = arguments[0], e2 = arguments[1];
            return !!this.isEquivalentClass(t2) && super.equalsExact.call(this, t2, e2);
          }
          return super.equalsExact.apply(this, arguments);
        }
        getBoundaryDimension() {
          return 1;
        }
        getTypeCode() {
          return q.TYPECODE_MULTIPOLYGON;
        }
        getDimension() {
          return 2;
        }
        reverse() {
          const t2 = this._geometries.length, e2 = new Array(t2).fill(null);
          for (let t3 = 0; t3 < this._geometries.length; t3++) e2[t3] = this._geometries[t3].reverse();
          return this.getFactory().createMultiPolygon(e2);
        }
        getBoundary() {
          if (this.isEmpty()) return this.getFactory().createMultiLineString();
          const t2 = new x();
          for (let e3 = 0; e3 < this._geometries.length; e3++) {
            const n2 = this._geometries[e3].getBoundary();
            for (let e4 = 0; e4 < n2.getNumGeometries(); e4++) t2.add(n2.getGeometryN(e4));
          }
          const e2 = new Array(t2.size()).fill(null);
          return this.getFactory().createMultiLineString(t2.toArray(e2));
        }
        getGeometryType() {
          return q.TYPENAME_MULTIPOLYGON;
        }
        copy() {
          const t2 = new Array(this._geometries.length).fill(null);
          for (let e2 = 0; e2 < t2.length; e2++) t2[e2] = this._geometries[e2].copy();
          return new At(t2, this._factory);
        }
        getClass() {
          return At;
        }
        get interfaces_() {
          return [Ot];
        }
      }
      At.constructor_ = function() {
        const t2 = arguments[0], e2 = arguments[1];
        _t.constructor_.call(this, t2, e2);
      }, At.serialVersionUID = -551033529766975900;
      class Ft {
        constructor() {
          Ft.constructor_.apply(this, arguments);
        }
        setCopyUserData(t2) {
          this._isUserDataCopied = t2;
        }
        edit(t2, e2) {
          if (null === t2) return null;
          const n2 = this.editInternal(t2, e2);
          return this._isUserDataCopied && n2.setUserData(t2.getUserData()), n2;
        }
        editInternal(t2, e2) {
          return null === this._factory && (this._factory = t2.getFactory()), t2 instanceof _t ? this.editGeometryCollection(t2, e2) : t2 instanceof bt ? this.editPolygon(t2, e2) : t2 instanceof Pt || t2 instanceof Tt ? e2.edit(t2, this._factory) : (u.shouldNeverReachHere("Unsupported Geometry class: " + t2.getClass().getName()), null);
        }
        editGeometryCollection(t2, e2) {
          const n2 = e2.edit(t2, this._factory), s2 = new x();
          for (let t3 = 0; t3 < n2.getNumGeometries(); t3++) {
            const i2 = this.edit(n2.getGeometryN(t3), e2);
            null === i2 || i2.isEmpty() || s2.add(i2);
          }
          return n2.getClass() === Mt ? this._factory.createMultiPoint(s2.toArray([])) : n2.getClass() === ft ? this._factory.createMultiLineString(s2.toArray([])) : n2.getClass() === At ? this._factory.createMultiPolygon(s2.toArray([])) : this._factory.createGeometryCollection(s2.toArray([]));
        }
        editPolygon(t2, e2) {
          let n2 = e2.edit(t2, this._factory);
          if (null === n2 && (n2 = this._factory.createPolygon()), n2.isEmpty()) return n2;
          const s2 = this.edit(n2.getExteriorRing(), e2);
          if (null === s2 || s2.isEmpty()) return this._factory.createPolygon();
          const i2 = new x();
          for (let t3 = 0; t3 < n2.getNumInteriorRing(); t3++) {
            const s3 = this.edit(n2.getInteriorRingN(t3), e2);
            null === s3 || s3.isEmpty() || i2.add(s3);
          }
          return this._factory.createPolygon(s2, i2.toArray([]));
        }
        getClass() {
          return Ft;
        }
        get interfaces_() {
          return [];
        }
      }
      function Gt() {
      }
      Ft.GeometryEditorOperation = Gt;
      class qt {
        constructor() {
          qt.constructor_.apply(this, arguments);
        }
        edit(t2, e2) {
          return t2;
        }
        getClass() {
          return qt;
        }
        get interfaces_() {
          return [Gt];
        }
      }
      qt.constructor_ = function() {
      };
      class Bt {
        constructor() {
          Bt.constructor_.apply(this, arguments);
        }
        edit(t2, e2) {
          const n2 = this.edit(t2.getCoordinates(), t2);
          return t2 instanceof Dt ? null === n2 ? e2.createLinearRing() : e2.createLinearRing(n2) : t2 instanceof Tt ? null === n2 ? e2.createLineString() : e2.createLineString(n2) : t2 instanceof Pt ? null === n2 || 0 === n2.length ? e2.createPoint() : e2.createPoint(n2[0]) : t2;
        }
        getClass() {
          return Bt;
        }
        get interfaces_() {
          return [Gt];
        }
      }
      Bt.constructor_ = function() {
      };
      class Vt {
        constructor() {
          Vt.constructor_.apply(this, arguments);
        }
        edit(t2, e2) {
          return t2 instanceof Dt ? e2.createLinearRing(this.edit(t2.getCoordinateSequence(), t2)) : t2 instanceof Tt ? e2.createLineString(this.edit(t2.getCoordinateSequence(), t2)) : t2 instanceof Pt ? e2.createPoint(this.edit(t2.getCoordinateSequence(), t2)) : t2;
        }
        getClass() {
          return Vt;
        }
        get interfaces_() {
          return [Gt];
        }
      }
      Vt.constructor_ = function() {
      }, Ft.NoOpGeometryOperation = qt, Ft.CoordinateOperation = Bt, Ft.CoordinateSequenceOperation = Vt, Ft.constructor_ = function() {
        if (this._factory = null, this._isUserDataCopied = false, 0 === arguments.length) ;
        else if (1 === arguments.length) {
          const t2 = arguments[0];
          this._factory = t2;
        }
      };
      class zt {
        constructor() {
          zt.constructor_.apply(this, arguments);
        }
        setOrdinate(t2, e2, s2) {
          switch (e2) {
            case A.X:
              this._coordinates[t2].x = s2;
              break;
            case A.Y:
              this._coordinates[t2].y = s2;
              break;
            case A.Z:
              this._coordinates[t2].z = s2;
              break;
            default:
              throw new n("invalid ordinateIndex");
          }
        }
        size() {
          return this._coordinates.length;
        }
        getOrdinate(t2, e2) {
          switch (e2) {
            case A.X:
              return this._coordinates[t2].x;
            case A.Y:
              return this._coordinates[t2].y;
            case A.Z:
              return this._coordinates[t2].z;
          }
          return i.NaN;
        }
        getCoordinate() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return this._coordinates[t2];
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            e2.x = this._coordinates[t2].x, e2.y = this._coordinates[t2].y, e2.z = this._coordinates[t2].z;
          }
        }
        getCoordinateCopy(t2) {
          return new g(this._coordinates[t2]);
        }
        getDimension() {
          return this._dimension;
        }
        getX(t2) {
          return this._coordinates[t2].x;
        }
        expandEnvelope(t2) {
          for (let e2 = 0; e2 < this._coordinates.length; e2++) t2.expandToInclude(this._coordinates[e2]);
          return t2;
        }
        copy() {
          const t2 = new Array(this.size()).fill(null);
          for (let e2 = 0; e2 < this._coordinates.length; e2++) t2[e2] = this._coordinates[e2].copy();
          return new zt(t2, this._dimension);
        }
        toString() {
          if (this._coordinates.length > 0) {
            const t2 = new wt(17 * this._coordinates.length);
            t2.append("("), t2.append(this._coordinates[0]);
            for (let e2 = 1; e2 < this._coordinates.length; e2++) t2.append(", "), t2.append(this._coordinates[e2]);
            return t2.append(")"), t2.toString();
          }
          return "()";
        }
        getY(t2) {
          return this._coordinates[t2].y;
        }
        toCoordinateArray() {
          return this._coordinates;
        }
        getClass() {
          return zt;
        }
        get interfaces_() {
          return [A, a];
        }
      }
      zt.constructor_ = function() {
        if (this._dimension = 3, this._coordinates = null, 1 === arguments.length) {
          if (arguments[0] instanceof Array) {
            const t2 = arguments[0];
            zt.constructor_.call(this, t2, 3);
          } else if (Number.isInteger(arguments[0])) {
            const t2 = arguments[0];
            this._coordinates = new Array(t2).fill(null);
            for (let e2 = 0; e2 < t2; e2++) this._coordinates[e2] = new g();
          } else if (_(arguments[0], A)) {
            const t2 = arguments[0];
            if (null === t2) return this._coordinates = new Array(0).fill(null), null;
            this._dimension = t2.getDimension(), this._coordinates = new Array(t2.size()).fill(null);
            for (let e2 = 0; e2 < this._coordinates.length; e2++) this._coordinates[e2] = t2.getCoordinateCopy(e2);
          }
        } else if (2 === arguments.length) {
          if (arguments[0] instanceof Array && Number.isInteger(arguments[1])) {
            const t2 = arguments[0], e2 = arguments[1];
            this._coordinates = t2, this._dimension = e2, null === t2 && (this._coordinates = new Array(0).fill(null));
          } else if (Number.isInteger(arguments[0]) && Number.isInteger(arguments[1])) {
            const t2 = arguments[0], e2 = arguments[1];
            this._coordinates = new Array(t2).fill(null), this._dimension = e2;
            for (let e3 = 0; e3 < t2; e3++) this._coordinates[e3] = new g();
          }
        }
      }, zt.serialVersionUID = -915438501601840600;
      class Yt {
        constructor() {
          Yt.constructor_.apply(this, arguments);
        }
        static instance() {
          return Yt.instanceObject;
        }
        readResolve() {
          return Yt.instance();
        }
        create() {
          if (1 === arguments.length) {
            if (arguments[0] instanceof Array) {
              const t2 = arguments[0];
              return new zt(t2);
            }
            if (_(arguments[0], A)) {
              const t2 = arguments[0];
              return new zt(t2);
            }
          } else if (2 === arguments.length) {
            const t2 = arguments[0];
            let e2 = arguments[1];
            return e2 > 3 && (e2 = 3), e2 < 2 ? new zt(t2) : new zt(t2, e2);
          }
        }
        getClass() {
          return Yt;
        }
        get interfaces_() {
          return [F, a];
        }
      }
      function Ut() {
        this.map_ = /* @__PURE__ */ new Map();
      }
      Yt.constructor_ = function() {
      }, Yt.serialVersionUID = -4099577099607551500, Yt.instanceObject = new Yt(), Ut.prototype = new j(), Ut.prototype.get = function(t2) {
        return this.map_.get(t2) || null;
      }, Ut.prototype.put = function(t2, e2) {
        return this.map_.set(t2, e2), e2;
      }, Ut.prototype.values = function() {
        const t2 = new x(), e2 = this.map_.values();
        let n2 = e2.next();
        for (; !n2.done; ) t2.add(n2.value), n2 = e2.next();
        return t2;
      }, Ut.prototype.entrySet = function() {
        const t2 = new J();
        return this.map_.entries().forEach((e2) => t2.add(e2)), t2;
      }, Ut.prototype.size = function() {
        return this.map_.size();
      };
      class kt {
        constructor() {
          kt.constructor_.apply(this, arguments);
        }
        static mostPrecise(t2, e2) {
          return t2.compareTo(e2) >= 0 ? t2 : e2;
        }
        equals(t2) {
          if (!(t2 instanceof kt)) return false;
          const e2 = t2;
          return this._modelType === e2._modelType && this._scale === e2._scale;
        }
        compareTo(t2) {
          const e2 = t2, n2 = this.getMaximumSignificantDigits(), s2 = e2.getMaximumSignificantDigits();
          return new L(n2).compareTo(new L(s2));
        }
        getScale() {
          return this._scale;
        }
        isFloating() {
          return this._modelType === kt.FLOATING || this._modelType === kt.FLOATING_SINGLE;
        }
        getType() {
          return this._modelType;
        }
        toString() {
          let t2 = "UNKNOWN";
          return this._modelType === kt.FLOATING ? t2 = "Floating" : this._modelType === kt.FLOATING_SINGLE ? t2 = "Floating-Single" : this._modelType === kt.FIXED && (t2 = "Fixed (Scale=" + this.getScale() + ")"), t2;
        }
        makePrecise() {
          if ("number" == typeof arguments[0]) {
            const t2 = arguments[0];
            if (i.isNaN(t2)) return t2;
            if (this._modelType === kt.FLOATING_SINGLE) {
              return t2;
            }
            return this._modelType === kt.FIXED ? Math.round(t2 * this._scale) / this._scale : t2;
          }
          if (arguments[0] instanceof g) {
            const t2 = arguments[0];
            if (this._modelType === kt.FLOATING) return null;
            t2.x = this.makePrecise(t2.x), t2.y = this.makePrecise(t2.y);
          }
        }
        getMaximumSignificantDigits() {
          let t2 = 16;
          return this._modelType === kt.FLOATING ? t2 = 16 : this._modelType === kt.FLOATING_SINGLE ? t2 = 6 : this._modelType === kt.FIXED && (t2 = 1 + Math.trunc(Math.ceil(Math.log(this.getScale()) / Math.log(10)))), t2;
        }
        setScale(t2) {
          this._scale = Math.abs(t2);
        }
        getClass() {
          return kt;
        }
        get interfaces_() {
          return [a, r];
        }
      }
      class Xt {
        constructor() {
          Xt.constructor_.apply(this, arguments);
        }
        readResolve() {
          return Xt.nameToTypeMap.get(this._name);
        }
        toString() {
          return this._name;
        }
        getClass() {
          return Xt;
        }
        get interfaces_() {
          return [a];
        }
      }
      Xt.constructor_ = function() {
        this._name = null;
        const t2 = arguments[0];
        this._name = t2, Xt.nameToTypeMap.put(t2, this);
      }, Xt.serialVersionUID = -552860263173159e4, Xt.nameToTypeMap = new Ut(), kt.Type = Xt, kt.constructor_ = function() {
        if (this._modelType = null, this._scale = null, 0 === arguments.length) this._modelType = kt.FLOATING;
        else if (1 === arguments.length) {
          if (arguments[0] instanceof Xt) {
            const t2 = arguments[0];
            this._modelType = t2, t2 === kt.FIXED && this.setScale(1);
          } else if ("number" == typeof arguments[0]) {
            const t2 = arguments[0];
            this._modelType = kt.FIXED, this.setScale(t2);
          } else if (arguments[0] instanceof kt) {
            const t2 = arguments[0];
            this._modelType = t2._modelType, this._scale = t2._scale;
          }
        }
      }, kt.serialVersionUID = 7777263578777804e3, kt.FIXED = new Xt("FIXED"), kt.FLOATING = new Xt("FLOATING"), kt.FLOATING_SINGLE = new Xt("FLOATING SINGLE"), kt.maximumPreciseValue = 9007199254740992;
      class Ht {
        constructor() {
          Ht.constructor_.apply(this, arguments);
        }
        static toMultiPolygonArray(t2) {
          const e2 = new Array(t2.size()).fill(null);
          return t2.toArray(e2);
        }
        static toGeometryArray(t2) {
          if (null === t2) return null;
          const e2 = new Array(t2.size()).fill(null);
          return t2.toArray(e2);
        }
        static getDefaultCoordinateSequenceFactory() {
          return Yt.instance();
        }
        static toMultiLineStringArray(t2) {
          const e2 = new Array(t2.size()).fill(null);
          return t2.toArray(e2);
        }
        static toLineStringArray(t2) {
          const e2 = new Array(t2.size()).fill(null);
          return t2.toArray(e2);
        }
        static toMultiPointArray(t2) {
          const e2 = new Array(t2.size()).fill(null);
          return t2.toArray(e2);
        }
        static toLinearRingArray(t2) {
          const e2 = new Array(t2.size()).fill(null);
          return t2.toArray(e2);
        }
        static toPointArray(t2) {
          const e2 = new Array(t2.size()).fill(null);
          return t2.toArray(e2);
        }
        static toPolygonArray(t2) {
          const e2 = new Array(t2.size()).fill(null);
          return t2.toArray(e2);
        }
        static createPointFromInternalCoord(t2, e2) {
          return e2.getPrecisionModel().makePrecise(t2), e2.getFactory().createPoint(t2);
        }
        toGeometry(t2) {
          return t2.isNull() ? this.createPoint() : t2.getMinX() === t2.getMaxX() && t2.getMinY() === t2.getMaxY() ? this.createPoint(new g(t2.getMinX(), t2.getMinY())) : t2.getMinX() === t2.getMaxX() || t2.getMinY() === t2.getMaxY() ? this.createLineString([new g(t2.getMinX(), t2.getMinY()), new g(t2.getMaxX(), t2.getMaxY())]) : this.createPolygon(this.createLinearRing([new g(t2.getMinX(), t2.getMinY()), new g(t2.getMinX(), t2.getMaxY()), new g(t2.getMaxX(), t2.getMaxY()), new g(t2.getMaxX(), t2.getMinY()), new g(t2.getMinX(), t2.getMinY())]), null);
        }
        createLineString() {
          if (0 === arguments.length) return this.createLineString(this.getCoordinateSequenceFactory().create([]));
          if (1 === arguments.length) {
            if (arguments[0] instanceof Array) {
              const t2 = arguments[0];
              return this.createLineString(null !== t2 ? this.getCoordinateSequenceFactory().create(t2) : null);
            }
            if (_(arguments[0], A)) {
              const t2 = arguments[0];
              return new Tt(t2, this);
            }
          }
        }
        createMultiLineString() {
          if (0 === arguments.length) return new ft(null, this);
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return new ft(t2, this);
          }
        }
        buildGeometry(t2) {
          let e2 = null, n2 = false, s2 = false;
          for (let i3 = t2.iterator(); i3.hasNext(); ) {
            const t3 = i3.next(), r2 = t3.getClass();
            null === e2 && (e2 = r2), r2 !== e2 && (n2 = true), t3 instanceof _t && (s2 = true);
          }
          if (null === e2) return this.createGeometryCollection();
          if (n2 || s2) return this.createGeometryCollection(Ht.toGeometryArray(t2));
          const i2 = t2.iterator().next();
          if (t2.size() > 1) {
            if (i2 instanceof bt) return this.createMultiPolygon(Ht.toPolygonArray(t2));
            if (i2 instanceof Tt) return this.createMultiLineString(Ht.toLineStringArray(t2));
            if (i2 instanceof Pt) return this.createMultiPoint(Ht.toPointArray(t2));
            u.shouldNeverReachHere("Unhandled class: " + i2.getClass().getName());
          }
          return i2;
        }
        createMultiPointFromCoords(t2) {
          return this.createMultiPoint(null !== t2 ? this.getCoordinateSequenceFactory().create(t2) : null);
        }
        createPoint() {
          if (0 === arguments.length) return this.createPoint(this.getCoordinateSequenceFactory().create([]));
          if (1 === arguments.length) {
            if (arguments[0] instanceof g) {
              const t2 = arguments[0];
              return this.createPoint(null !== t2 ? this.getCoordinateSequenceFactory().create([t2]) : null);
            }
            if (_(arguments[0], A)) {
              const t2 = arguments[0];
              return new Pt(t2, this);
            }
          }
        }
        getCoordinateSequenceFactory() {
          return this._coordinateSequenceFactory;
        }
        createPolygon() {
          if (0 === arguments.length) return this.createPolygon(null, null);
          if (1 === arguments.length) {
            if (_(arguments[0], A)) {
              const t2 = arguments[0];
              return this.createPolygon(this.createLinearRing(t2));
            }
            if (arguments[0] instanceof Array) {
              const t2 = arguments[0];
              return this.createPolygon(this.createLinearRing(t2));
            }
            if (arguments[0] instanceof Dt) {
              const t2 = arguments[0];
              return this.createPolygon(t2, null);
            }
          } else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return new bt(t2, e2, this);
          }
        }
        getSRID() {
          return this._SRID;
        }
        createGeometryCollection() {
          if (0 === arguments.length) return new _t(null, this);
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return new _t(t2, this);
          }
        }
        createGeometry(t2) {
          return new Ft(this).edit(t2, new Wt(this._coordinateSequenceFactory));
        }
        getPrecisionModel() {
          return this._precisionModel;
        }
        createLinearRing() {
          if (0 === arguments.length) return this.createLinearRing(this.getCoordinateSequenceFactory().create([]));
          if (1 === arguments.length) {
            if (arguments[0] instanceof Array) {
              const t2 = arguments[0];
              return this.createLinearRing(null !== t2 ? this.getCoordinateSequenceFactory().create(t2) : null);
            }
            if (_(arguments[0], A)) {
              const t2 = arguments[0];
              return new Dt(t2, this);
            }
          }
        }
        createMultiPolygon() {
          if (0 === arguments.length) return new At(null, this);
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return new At(t2, this);
          }
        }
        createMultiPoint() {
          if (0 === arguments.length) return new Mt(null, this);
          if (1 === arguments.length) {
            if (arguments[0] instanceof Array) {
              const t2 = arguments[0];
              return new Mt(t2, this);
            }
            if (_(arguments[0], A)) {
              const t2 = arguments[0];
              if (null === t2) return this.createMultiPoint(new Array(0).fill(null));
              const e2 = new Array(t2.size()).fill(null);
              for (let n2 = 0; n2 < t2.size(); n2++) {
                const s2 = this.getCoordinateSequenceFactory().create(1, t2.getDimension());
                Lt.copy(t2, n2, s2, 0, 1), e2[n2] = this.createPoint(s2);
              }
              return this.createMultiPoint(e2);
            }
          }
        }
        getClass() {
          return Ht;
        }
        get interfaces_() {
          return [a];
        }
      }
      class Wt extends Ft.CoordinateSequenceOperation {
        constructor() {
          super(), Wt.constructor_.apply(this, arguments);
        }
        edit() {
          if (2 === arguments.length && arguments[1] instanceof q && _(arguments[0], A)) {
            const t2 = arguments[0];
            return this.coordinateSequenceFactory.create(t2);
          }
          return super.edit.apply(this, arguments);
        }
        getClass() {
          return Wt;
        }
        get interfaces_() {
          return [];
        }
      }
      Wt.constructor_ = function() {
        this.coordinateSequenceFactory = null;
        const t2 = arguments[0];
        this.coordinateSequenceFactory = t2;
      }, Ht.CloneOp = Wt, Ht.constructor_ = function() {
        if (this._precisionModel = null, this._coordinateSequenceFactory = null, this._SRID = null, 0 === arguments.length) Ht.constructor_.call(this, new kt(), 0);
        else if (1 === arguments.length) {
          if (_(arguments[0], F)) {
            const t2 = arguments[0];
            Ht.constructor_.call(this, new kt(), 0, t2);
          } else if (arguments[0] instanceof kt) {
            const t2 = arguments[0];
            Ht.constructor_.call(this, t2, 0, Ht.getDefaultCoordinateSequenceFactory());
          }
        } else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          Ht.constructor_.call(this, t2, e2, Ht.getDefaultCoordinateSequenceFactory());
        } else if (3 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
          this._precisionModel = t2, this._coordinateSequenceFactory = n2, this._SRID = e2;
        }
      }, Ht.serialVersionUID = -6820524753094096e3;
      const jt = { typeStr: /^\s*(\w+)\s*\(\s*(.*)\s*\)\s*$/, emptyTypeStr: /^\s*(\w+)\s*EMPTY\s*$/, spaces: /\s+/, parenComma: /\)\s*,\s*\(/, doubleParenComma: /\)\s*\)\s*,\s*\(\s*\(/, trimParens: /^\s*\(?(.*?)\)?\s*$/ };
      class Kt {
        constructor(t2) {
          this.geometryFactory = t2 || new Ht(), this.precisionModel = this.geometryFactory.getPrecisionModel();
        }
        read(t2) {
          var e2, n2, s2;
          t2 = t2.replace(/[\n\r]/g, " ");
          var i2 = jt.typeStr.exec(t2);
          if (-1 !== t2.search("EMPTY") && ((i2 = jt.emptyTypeStr.exec(t2))[2] = void 0), i2 && (n2 = i2[1].toLowerCase(), s2 = i2[2], Qt[n2] && (e2 = Qt[n2].call(this, s2))), void 0 === e2) throw new Error("Could not parse WKT " + t2);
          return e2;
        }
        write(t2) {
          return this.extractGeometry(t2);
        }
        extractGeometry(t2) {
          var e2 = t2.getGeometryType().toLowerCase();
          if (!Zt[e2]) return null;
          var n2 = e2.toUpperCase();
          return t2.isEmpty() ? n2 + " EMPTY" : n2 + "(" + Zt[e2].call(this, t2) + ")";
        }
      }
      const Zt = { coordinate(t2) {
        return this.precisionModel.makePrecise(t2), t2.x + " " + t2.y;
      }, point(t2) {
        return Zt.coordinate.call(this, t2._coordinates._coordinates[0]);
      }, multipoint(t2) {
        var e2 = [];
        for (let n2 = 0, s2 = t2._geometries.length; n2 < s2; ++n2) e2.push("(" + Zt.point.call(this, t2._geometries[n2]) + ")");
        return e2.join(",");
      }, linestring(t2) {
        var e2 = [];
        for (let n2 = 0, s2 = t2._points._coordinates.length; n2 < s2; ++n2) e2.push(Zt.coordinate.call(this, t2._points._coordinates[n2]));
        return e2.join(",");
      }, linearring(t2) {
        var e2 = [];
        for (let n2 = 0, s2 = t2._points._coordinates.length; n2 < s2; ++n2) e2.push(Zt.coordinate.call(this, t2._points._coordinates[n2]));
        return e2.join(",");
      }, multilinestring(t2) {
        var e2 = [];
        for (let n2 = 0, s2 = t2._geometries.length; n2 < s2; ++n2) e2.push("(" + Zt.linestring.call(this, t2._geometries[n2]) + ")");
        return e2.join(",");
      }, polygon(t2) {
        var e2 = [];
        e2.push("(" + Zt.linestring.call(this, t2._shell) + ")");
        for (let n2 = 0, s2 = t2._holes.length; n2 < s2; ++n2) e2.push("(" + Zt.linestring.call(this, t2._holes[n2]) + ")");
        return e2.join(",");
      }, multipolygon(t2) {
        var e2 = [];
        for (let n2 = 0, s2 = t2._geometries.length; n2 < s2; ++n2) e2.push("(" + Zt.polygon.call(this, t2._geometries[n2]) + ")");
        return e2.join(",");
      }, geometrycollection(t2) {
        var e2 = [];
        for (let n2 = 0, s2 = t2._geometries.length; n2 < s2; ++n2) e2.push(this.extractGeometry(t2._geometries[n2]));
        return e2.join(",");
      } }, Qt = { coord(t2) {
        var e2 = t2.trim().split(jt.spaces), n2 = new g(Number.parseFloat(e2[0]), Number.parseFloat(e2[1]));
        return this.precisionModel.makePrecise(n2), n2;
      }, point(t2) {
        return void 0 === t2 ? this.geometryFactory.createPoint() : this.geometryFactory.createPoint(Qt.coord.call(this, t2));
      }, multipoint(t2) {
        if (void 0 === t2) return this.geometryFactory.createMultiPoint();
        var e2, n2 = t2.trim().split(","), s2 = [];
        for (let t3 = 0, i2 = n2.length; t3 < i2; ++t3) e2 = n2[t3].replace(jt.trimParens, "$1"), s2.push(Qt.point.call(this, e2));
        return this.geometryFactory.createMultiPoint(s2);
      }, linestring(t2) {
        if (void 0 === t2) return this.geometryFactory.createLineString();
        var e2 = t2.trim().split(","), n2 = [];
        for (let t3 = 0, s2 = e2.length; t3 < s2; ++t3) n2.push(Qt.coord.call(this, e2[t3]));
        return this.geometryFactory.createLineString(n2);
      }, linearring(t2) {
        if (void 0 === t2) return this.geometryFactory.createLinearRing();
        var e2 = t2.trim().split(","), n2 = [];
        for (let t3 = 0, s2 = e2.length; t3 < s2; ++t3) n2.push(Qt.coord.call(this, e2[t3]));
        return this.geometryFactory.createLinearRing(n2);
      }, multilinestring(t2) {
        if (void 0 === t2) return this.geometryFactory.createMultiLineString();
        var e2, n2 = t2.trim().split(jt.parenComma), s2 = [];
        for (let t3 = 0, i2 = n2.length; t3 < i2; ++t3) e2 = n2[t3].replace(jt.trimParens, "$1"), s2.push(Qt.linestring.call(this, e2));
        return this.geometryFactory.createMultiLineString(s2);
      }, polygon(t2) {
        if (void 0 === t2) return this.geometryFactory.createPolygon();
        var e2, n2, s2, i2, r2 = t2.trim().split(jt.parenComma), o2 = [];
        for (let t3 = 0, l2 = r2.length; t3 < l2; ++t3) e2 = r2[t3].replace(jt.trimParens, "$1"), n2 = Qt.linestring.call(this, e2), s2 = this.geometryFactory.createLinearRing(n2._points), 0 === t3 ? i2 = s2 : o2.push(s2);
        return this.geometryFactory.createPolygon(i2, o2);
      }, multipolygon(t2) {
        if (void 0 === t2) return this.geometryFactory.createMultiPolygon();
        var e2, n2 = t2.trim().split(jt.doubleParenComma), s2 = [];
        for (let t3 = 0, i2 = n2.length; t3 < i2; ++t3) e2 = n2[t3].replace(jt.trimParens, "$1"), s2.push(Qt.polygon.call(this, e2));
        return this.geometryFactory.createMultiPolygon(s2);
      }, geometrycollection(t2) {
        if (void 0 === t2) return this.geometryFactory.createGeometryCollection();
        var e2 = (t2 = t2.replace(/,\s*([A-Za-z])/g, "|$1")).trim().split("|"), n2 = [];
        for (let t3 = 0, s2 = e2.length; t3 < s2; ++t3) n2.push(this.read(e2[t3]));
        return this.geometryFactory.createGeometryCollection(n2);
      } };
      class Jt {
        constructor(t2) {
          this.parser = new Kt(t2);
        }
        write(t2) {
          return this.parser.write(t2);
        }
        static toLineString(t2, e2) {
          if (2 !== arguments.length) throw new Error("Not implemented");
          return "LINESTRING ( " + t2.x + " " + t2.y + ", " + e2.x + " " + e2.y + " )";
        }
      }
      class $t {
        constructor() {
          $t.constructor_.apply(this, arguments);
        }
        static computeEdgeDistance(t2, e2, n2) {
          const s2 = Math.abs(n2.x - e2.x), i2 = Math.abs(n2.y - e2.y);
          let r2 = -1;
          if (t2.equals(e2)) r2 = 0;
          else if (t2.equals(n2)) r2 = s2 > i2 ? s2 : i2;
          else {
            const n3 = Math.abs(t2.x - e2.x), o2 = Math.abs(t2.y - e2.y);
            r2 = s2 > i2 ? n3 : o2, 0 !== r2 || t2.equals(e2) || (r2 = Math.max(n3, o2));
          }
          return u.isTrue(!(0 === r2 && !t2.equals(e2)), "Bad distance calculation"), r2;
        }
        static nonRobustComputeEdgeDistance(t2, e2, n2) {
          const s2 = t2.x - e2.x, i2 = t2.y - e2.y, r2 = Math.sqrt(s2 * s2 + i2 * i2);
          return u.isTrue(!(0 === r2 && !t2.equals(e2)), "Invalid distance calculation"), r2;
        }
        getIndexAlongSegment(t2, e2) {
          return this.computeIntLineIndex(), this._intLineIndex[t2][e2];
        }
        getTopologySummary() {
          const t2 = new wt();
          return this.isEndPoint() && t2.append(" endpoint"), this._isProper && t2.append(" proper"), this.isCollinear() && t2.append(" collinear"), t2.toString();
        }
        computeIntersection(t2, e2, n2, s2) {
          this._inputLines[0][0] = t2, this._inputLines[0][1] = e2, this._inputLines[1][0] = n2, this._inputLines[1][1] = s2, this._result = this.computeIntersect(t2, e2, n2, s2);
        }
        getIntersectionNum() {
          return this._result;
        }
        computeIntLineIndex() {
          if (0 === arguments.length) null === this._intLineIndex && (this._intLineIndex = Array(2).fill().map(() => Array(2)), this.computeIntLineIndex(0), this.computeIntLineIndex(1));
          else if (1 === arguments.length) {
            const t2 = arguments[0];
            this.getEdgeDistance(t2, 0) > this.getEdgeDistance(t2, 1) ? (this._intLineIndex[t2][0] = 0, this._intLineIndex[t2][1] = 1) : (this._intLineIndex[t2][0] = 1, this._intLineIndex[t2][1] = 0);
          }
        }
        isProper() {
          return this.hasIntersection() && this._isProper;
        }
        setPrecisionModel(t2) {
          this._precisionModel = t2;
        }
        isInteriorIntersection() {
          if (0 === arguments.length) return !!this.isInteriorIntersection(0) || !!this.isInteriorIntersection(1);
          if (1 === arguments.length) {
            const t2 = arguments[0];
            for (let e2 = 0; e2 < this._result; e2++) if (!this._intPt[e2].equals2D(this._inputLines[t2][0]) && !this._intPt[e2].equals2D(this._inputLines[t2][1])) return true;
            return false;
          }
        }
        getIntersection(t2) {
          return this._intPt[t2];
        }
        isEndPoint() {
          return this.hasIntersection() && !this._isProper;
        }
        hasIntersection() {
          return this._result !== $t.NO_INTERSECTION;
        }
        getEdgeDistance(t2, e2) {
          return $t.computeEdgeDistance(this._intPt[e2], this._inputLines[t2][0], this._inputLines[t2][1]);
        }
        isCollinear() {
          return this._result === $t.COLLINEAR_INTERSECTION;
        }
        toString() {
          return Jt.toLineString(this._inputLines[0][0], this._inputLines[0][1]) + " - " + Jt.toLineString(this._inputLines[1][0], this._inputLines[1][1]) + this.getTopologySummary();
        }
        getEndpoint(t2, e2) {
          return this._inputLines[t2][e2];
        }
        isIntersection(t2) {
          for (let e2 = 0; e2 < this._result; e2++) if (this._intPt[e2].equals2D(t2)) return true;
          return false;
        }
        getIntersectionAlongSegment(t2, e2) {
          return this.computeIntLineIndex(), this._intPt[this._intLineIndex[t2][e2]];
        }
        getClass() {
          return $t;
        }
        get interfaces_() {
          return [];
        }
      }
      $t.constructor_ = function() {
        this._result = null, this._inputLines = Array(2).fill().map(() => Array(2)), this._intPt = new Array(2).fill(null), this._intLineIndex = null, this._isProper = null, this._pa = null, this._pb = null, this._precisionModel = null, this._intPt[0] = new g(), this._intPt[1] = new g(), this._pa = this._intPt[0], this._pb = this._intPt[1], this._result = 0;
      }, $t.DONT_INTERSECT = 0, $t.DO_INTERSECT = 1, $t.COLLINEAR = 2, $t.NO_INTERSECTION = 0, $t.POINT_INTERSECTION = 1, $t.COLLINEAR_INTERSECTION = 2;
      class te extends $t {
        constructor() {
          super(), te.constructor_.apply(this, arguments);
        }
        static nearestEndpoint(t2, e2, n2, s2) {
          let i2 = t2, r2 = D.pointToSegment(t2, n2, s2), o2 = D.pointToSegment(e2, n2, s2);
          return o2 < r2 && (r2 = o2, i2 = e2), o2 = D.pointToSegment(n2, t2, e2), o2 < r2 && (r2 = o2, i2 = n2), o2 = D.pointToSegment(s2, t2, e2), o2 < r2 && (r2 = o2, i2 = s2), i2;
        }
        isInSegmentEnvelopes(t2) {
          const e2 = new N(this._inputLines[0][0], this._inputLines[0][1]), n2 = new N(this._inputLines[1][0], this._inputLines[1][1]);
          return e2.contains(t2) && n2.contains(t2);
        }
        computeIntersection() {
          if (3 !== arguments.length) return super.computeIntersection.apply(this, arguments);
          {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
            if (this._isProper = false, N.intersects(e2, n2, t2) && 0 === v.index(e2, n2, t2) && 0 === v.index(n2, e2, t2)) return this._isProper = true, (t2.equals(e2) || t2.equals(n2)) && (this._isProper = false), this._result = $t.POINT_INTERSECTION, null;
            this._result = $t.NO_INTERSECTION;
          }
        }
        normalizeToMinimum(t2, e2, n2, s2, i2) {
          i2.x = this.smallestInAbsValue(t2.x, e2.x, n2.x, s2.x), i2.y = this.smallestInAbsValue(t2.y, e2.y, n2.y, s2.y), t2.x -= i2.x, t2.y -= i2.y, e2.x -= i2.x, e2.y -= i2.y, n2.x -= i2.x, n2.y -= i2.y, s2.x -= i2.x, s2.y -= i2.y;
        }
        safeHCoordinateIntersection(t2, e2, n2, s2) {
          let i2 = null;
          try {
            i2 = b.intersection(t2, e2, n2, s2);
          } catch (r2) {
            if (!(r2 instanceof S)) throw r2;
            i2 = te.nearestEndpoint(t2, e2, n2, s2);
          }
          return i2;
        }
        intersection(t2, e2, n2, s2) {
          let i2 = this.intersectionWithNormalization(t2, e2, n2, s2);
          return this.isInSegmentEnvelopes(i2) || (i2 = new g(te.nearestEndpoint(t2, e2, n2, s2))), null !== this._precisionModel && this._precisionModel.makePrecise(i2), i2;
        }
        smallestInAbsValue(t2, e2, n2, s2) {
          let i2 = t2, r2 = Math.abs(i2);
          return Math.abs(e2) < r2 && (i2 = e2, r2 = Math.abs(e2)), Math.abs(n2) < r2 && (i2 = n2, r2 = Math.abs(n2)), Math.abs(s2) < r2 && (i2 = s2), i2;
        }
        checkDD(t2, e2, n2, s2, i2) {
          const r2 = P.intersection(t2, e2, n2, s2), o2 = this.isInSegmentEnvelopes(r2);
          O.out.println("DD in env = " + o2 + "  --------------------- " + r2), i2.distance(r2) > 1e-4 && O.out.println("Distance = " + i2.distance(r2));
        }
        intersectionWithNormalization(t2, e2, n2, s2) {
          const i2 = new g(t2), r2 = new g(e2), o2 = new g(n2), l2 = new g(s2), a2 = new g();
          this.normalizeToEnvCentre(i2, r2, o2, l2, a2);
          const c2 = this.safeHCoordinateIntersection(i2, r2, o2, l2);
          return c2.x += a2.x, c2.y += a2.y, c2;
        }
        computeCollinearIntersection(t2, e2, n2, s2) {
          const i2 = N.intersects(t2, e2, n2), r2 = N.intersects(t2, e2, s2), o2 = N.intersects(n2, s2, t2), l2 = N.intersects(n2, s2, e2);
          return i2 && r2 ? (this._intPt[0] = n2, this._intPt[1] = s2, $t.COLLINEAR_INTERSECTION) : o2 && l2 ? (this._intPt[0] = t2, this._intPt[1] = e2, $t.COLLINEAR_INTERSECTION) : i2 && o2 ? (this._intPt[0] = n2, this._intPt[1] = t2, !n2.equals(t2) || r2 || l2 ? $t.COLLINEAR_INTERSECTION : $t.POINT_INTERSECTION) : i2 && l2 ? (this._intPt[0] = n2, this._intPt[1] = e2, !n2.equals(e2) || r2 || o2 ? $t.COLLINEAR_INTERSECTION : $t.POINT_INTERSECTION) : r2 && o2 ? (this._intPt[0] = s2, this._intPt[1] = t2, !s2.equals(t2) || i2 || l2 ? $t.COLLINEAR_INTERSECTION : $t.POINT_INTERSECTION) : r2 && l2 ? (this._intPt[0] = s2, this._intPt[1] = e2, !s2.equals(e2) || i2 || o2 ? $t.COLLINEAR_INTERSECTION : $t.POINT_INTERSECTION) : $t.NO_INTERSECTION;
        }
        normalizeToEnvCentre(t2, e2, n2, s2, i2) {
          const r2 = t2.x < e2.x ? t2.x : e2.x, o2 = t2.y < e2.y ? t2.y : e2.y, l2 = t2.x > e2.x ? t2.x : e2.x, a2 = t2.y > e2.y ? t2.y : e2.y, c2 = n2.x < s2.x ? n2.x : s2.x, h2 = n2.y < s2.y ? n2.y : s2.y, u2 = n2.x > s2.x ? n2.x : s2.x, g2 = n2.y > s2.y ? n2.y : s2.y, d2 = ((r2 > c2 ? r2 : c2) + (l2 < u2 ? l2 : u2)) / 2, _2 = ((o2 > h2 ? o2 : h2) + (a2 < g2 ? a2 : g2)) / 2;
          i2.x = d2, i2.y = _2, t2.x -= i2.x, t2.y -= i2.y, e2.x -= i2.x, e2.y -= i2.y, n2.x -= i2.x, n2.y -= i2.y, s2.x -= i2.x, s2.y -= i2.y;
        }
        computeIntersect(t2, e2, n2, s2) {
          if (this._isProper = false, !N.intersects(t2, e2, n2, s2)) return $t.NO_INTERSECTION;
          const i2 = v.index(t2, e2, n2), r2 = v.index(t2, e2, s2);
          if (i2 > 0 && r2 > 0 || i2 < 0 && r2 < 0) return $t.NO_INTERSECTION;
          const o2 = v.index(n2, s2, t2), l2 = v.index(n2, s2, e2);
          return o2 > 0 && l2 > 0 || o2 < 0 && l2 < 0 ? $t.NO_INTERSECTION : 0 === i2 && 0 === r2 && 0 === o2 && 0 === l2 ? this.computeCollinearIntersection(t2, e2, n2, s2) : (0 === i2 || 0 === r2 || 0 === o2 || 0 === l2 ? (this._isProper = false, t2.equals2D(n2) || t2.equals2D(s2) ? this._intPt[0] = t2 : e2.equals2D(n2) || e2.equals2D(s2) ? this._intPt[0] = e2 : 0 === i2 ? this._intPt[0] = new g(n2) : 0 === r2 ? this._intPt[0] = new g(s2) : 0 === o2 ? this._intPt[0] = new g(t2) : 0 === l2 && (this._intPt[0] = new g(e2))) : (this._isProper = true, this._intPt[0] = this.intersection(t2, e2, n2, s2)), $t.POINT_INTERSECTION);
        }
        getClass() {
          return te;
        }
        get interfaces_() {
          return [];
        }
      }
      te.constructor_ = function() {
      };
      class ee {
        constructor() {
          ee.constructor_.apply(this, arguments);
        }
        static midPoint(t2, e2) {
          return new g((t2.x + e2.x) / 2, (t2.y + e2.y) / 2);
        }
        minX() {
          return Math.min(this.p0.x, this.p1.x);
        }
        orientationIndex() {
          if (arguments[0] instanceof ee) {
            const t2 = arguments[0], e2 = v.index(this.p0, this.p1, t2.p0), n2 = v.index(this.p0, this.p1, t2.p1);
            return e2 >= 0 && n2 >= 0 || e2 <= 0 && n2 <= 0 ? Math.max(e2, n2) : 0;
          }
          if (arguments[0] instanceof g) {
            const t2 = arguments[0];
            return v.index(this.p0, this.p1, t2);
          }
        }
        toGeometry(t2) {
          return t2.createLineString([this.p0, this.p1]);
        }
        isVertical() {
          return this.p0.x === this.p1.x;
        }
        equals(t2) {
          if (!(t2 instanceof ee)) return false;
          const e2 = t2;
          return this.p0.equals(e2.p0) && this.p1.equals(e2.p1);
        }
        intersection(t2) {
          const e2 = new te();
          return e2.computeIntersection(this.p0, this.p1, t2.p0, t2.p1), e2.hasIntersection() ? e2.getIntersection(0) : null;
        }
        project() {
          if (arguments[0] instanceof g) {
            const t2 = arguments[0];
            if (t2.equals(this.p0) || t2.equals(this.p1)) return new g(t2);
            const e2 = this.projectionFactor(t2), n2 = new g();
            return n2.x = this.p0.x + e2 * (this.p1.x - this.p0.x), n2.y = this.p0.y + e2 * (this.p1.y - this.p0.y), n2;
          }
          if (arguments[0] instanceof ee) {
            const t2 = arguments[0], e2 = this.projectionFactor(t2.p0), n2 = this.projectionFactor(t2.p1);
            if (e2 >= 1 && n2 >= 1) return null;
            if (e2 <= 0 && n2 <= 0) return null;
            let s2 = this.project(t2.p0);
            e2 < 0 && (s2 = this.p0), e2 > 1 && (s2 = this.p1);
            let i2 = this.project(t2.p1);
            return n2 < 0 && (i2 = this.p0), n2 > 1 && (i2 = this.p1), new ee(s2, i2);
          }
        }
        normalize() {
          this.p1.compareTo(this.p0) < 0 && this.reverse();
        }
        angle() {
          return Math.atan2(this.p1.y - this.p0.y, this.p1.x - this.p0.x);
        }
        getCoordinate(t2) {
          return 0 === t2 ? this.p0 : this.p1;
        }
        distancePerpendicular(t2) {
          return D.pointToLinePerpendicular(t2, this.p0, this.p1);
        }
        minY() {
          return Math.min(this.p0.y, this.p1.y);
        }
        midPoint() {
          return ee.midPoint(this.p0, this.p1);
        }
        projectionFactor(t2) {
          if (t2.equals(this.p0)) return 0;
          if (t2.equals(this.p1)) return 1;
          const e2 = this.p1.x - this.p0.x, n2 = this.p1.y - this.p0.y, s2 = e2 * e2 + n2 * n2;
          return s2 <= 0 ? i.NaN : ((t2.x - this.p0.x) * e2 + (t2.y - this.p0.y) * n2) / s2;
        }
        closestPoints(t2) {
          const e2 = this.intersection(t2);
          if (null !== e2) return [e2, e2];
          const n2 = new Array(2).fill(null);
          let s2 = i.MAX_VALUE, r2 = null;
          const o2 = this.closestPoint(t2.p0);
          s2 = o2.distance(t2.p0), n2[0] = o2, n2[1] = t2.p0;
          const l2 = this.closestPoint(t2.p1);
          r2 = l2.distance(t2.p1), r2 < s2 && (s2 = r2, n2[0] = l2, n2[1] = t2.p1);
          const a2 = t2.closestPoint(this.p0);
          r2 = a2.distance(this.p0), r2 < s2 && (s2 = r2, n2[0] = this.p0, n2[1] = a2);
          const c2 = t2.closestPoint(this.p1);
          return r2 = c2.distance(this.p1), r2 < s2 && (s2 = r2, n2[0] = this.p1, n2[1] = c2), n2;
        }
        closestPoint(t2) {
          const e2 = this.projectionFactor(t2);
          return e2 > 0 && e2 < 1 ? this.project(t2) : this.p0.distance(t2) < this.p1.distance(t2) ? this.p0 : this.p1;
        }
        maxX() {
          return Math.max(this.p0.x, this.p1.x);
        }
        getLength() {
          return this.p0.distance(this.p1);
        }
        compareTo(t2) {
          const e2 = t2, n2 = this.p0.compareTo(e2.p0);
          return 0 !== n2 ? n2 : this.p1.compareTo(e2.p1);
        }
        reverse() {
          const t2 = this.p0;
          this.p0 = this.p1, this.p1 = t2;
        }
        equalsTopo(t2) {
          return this.p0.equals(t2.p0) && this.p1.equals(t2.p1) || this.p0.equals(t2.p1) && this.p1.equals(t2.p0);
        }
        lineIntersection(t2) {
          try {
            return b.intersection(this.p0, this.p1, t2.p0, t2.p1);
          } catch (t3) {
            if (!(t3 instanceof S)) throw t3;
          }
          return null;
        }
        maxY() {
          return Math.max(this.p0.y, this.p1.y);
        }
        pointAlongOffset(t2, e2) {
          const n2 = this.p0.x + t2 * (this.p1.x - this.p0.x), s2 = this.p0.y + t2 * (this.p1.y - this.p0.y), i2 = this.p1.x - this.p0.x, r2 = this.p1.y - this.p0.y, o2 = Math.sqrt(i2 * i2 + r2 * r2);
          let l2 = 0, a2 = 0;
          if (0 !== e2) {
            if (o2 <= 0) throw new IllegalStateException("Cannot compute offset from zero-length line segment");
            l2 = e2 * i2 / o2, a2 = e2 * r2 / o2;
          }
          return new g(n2 - a2, s2 + l2);
        }
        setCoordinates() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            this.setCoordinates(t2.p0, t2.p1);
          } else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            this.p0.x = t2.x, this.p0.y = t2.y, this.p1.x = e2.x, this.p1.y = e2.y;
          }
        }
        segmentFraction(t2) {
          let e2 = this.projectionFactor(t2);
          return e2 < 0 ? e2 = 0 : (e2 > 1 || i.isNaN(e2)) && (e2 = 1), e2;
        }
        toString() {
          return "LINESTRING( " + this.p0.x + " " + this.p0.y + ", " + this.p1.x + " " + this.p1.y + ")";
        }
        isHorizontal() {
          return this.p0.y === this.p1.y;
        }
        distance() {
          if (arguments[0] instanceof ee) {
            const t2 = arguments[0];
            return D.segmentToSegment(this.p0, this.p1, t2.p0, t2.p1);
          }
          if (arguments[0] instanceof g) {
            const t2 = arguments[0];
            return D.pointToSegment(t2, this.p0, this.p1);
          }
        }
        pointAlong(t2) {
          const e2 = new g();
          return e2.x = this.p0.x + t2 * (this.p1.x - this.p0.x), e2.y = this.p0.y + t2 * (this.p1.y - this.p0.y), e2;
        }
        hashCode() {
          let t2 = java.lang.Double.doubleToLongBits(this.p0.x);
          t2 ^= 31 * java.lang.Double.doubleToLongBits(this.p0.y);
          const e2 = Math.trunc(t2) ^ Math.trunc(t2 >> 32);
          let n2 = java.lang.Double.doubleToLongBits(this.p1.x);
          return n2 ^= 31 * java.lang.Double.doubleToLongBits(this.p1.y), e2 ^ (Math.trunc(n2) ^ Math.trunc(n2 >> 32));
        }
        getClass() {
          return ee;
        }
        get interfaces_() {
          return [r, a];
        }
      }
      ee.constructor_ = function() {
        if (this.p0 = null, this.p1 = null, 0 === arguments.length) ee.constructor_.call(this, new g(), new g());
        else if (1 === arguments.length) {
          const t2 = arguments[0];
          ee.constructor_.call(this, t2.p0, t2.p1);
        } else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          this.p0 = t2, this.p1 = e2;
        } else if (4 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3];
          ee.constructor_.call(this, new g(t2, e2), new g(n2, s2));
        }
      }, ee.serialVersionUID = 3252005833466256400;
      class ne {
        constructor() {
          ne.constructor_.apply(this, arguments);
        }
        static toLocationSymbol(t2) {
          switch (t2) {
            case ne.EXTERIOR:
              return "e";
            case ne.BOUNDARY:
              return "b";
            case ne.INTERIOR:
              return "i";
            case ne.NONE:
              return "-";
          }
          throw new n("Unknown location value: " + t2);
        }
        getClass() {
          return ne;
        }
        get interfaces_() {
          return [];
        }
      }
      ne.constructor_ = function() {
      }, ne.INTERIOR = 0, ne.BOUNDARY = 1, ne.EXTERIOR = 2, ne.NONE = -1;
      class se {
        constructor() {
          se.constructor_.apply(this, arguments);
        }
        static matches() {
          if (Number.isInteger(arguments[0]) && "string" == typeof arguments[1]) {
            const t2 = arguments[0], e2 = arguments[1];
            return e2 === ut.SYM_DONTCARE || (e2 === ut.SYM_TRUE && (t2 >= 0 || t2 === ut.TRUE) || (e2 === ut.SYM_FALSE && t2 === ut.FALSE || (e2 === ut.SYM_P && t2 === ut.P || (e2 === ut.SYM_L && t2 === ut.L || e2 === ut.SYM_A && t2 === ut.A))));
          }
          if ("string" == typeof arguments[0] && "string" == typeof arguments[1]) {
            const t2 = arguments[0], e2 = arguments[1];
            return new se(t2).matches(e2);
          }
        }
        static isTrue(t2) {
          return t2 >= 0 || t2 === ut.TRUE;
        }
        isIntersects() {
          return !this.isDisjoint();
        }
        isCovers() {
          return (se.isTrue(this._matrix[ne.INTERIOR][ne.INTERIOR]) || se.isTrue(this._matrix[ne.INTERIOR][ne.BOUNDARY]) || se.isTrue(this._matrix[ne.BOUNDARY][ne.INTERIOR]) || se.isTrue(this._matrix[ne.BOUNDARY][ne.BOUNDARY])) && this._matrix[ne.EXTERIOR][ne.INTERIOR] === ut.FALSE && this._matrix[ne.EXTERIOR][ne.BOUNDARY] === ut.FALSE;
        }
        isCoveredBy() {
          return (se.isTrue(this._matrix[ne.INTERIOR][ne.INTERIOR]) || se.isTrue(this._matrix[ne.INTERIOR][ne.BOUNDARY]) || se.isTrue(this._matrix[ne.BOUNDARY][ne.INTERIOR]) || se.isTrue(this._matrix[ne.BOUNDARY][ne.BOUNDARY])) && this._matrix[ne.INTERIOR][ne.EXTERIOR] === ut.FALSE && this._matrix[ne.BOUNDARY][ne.EXTERIOR] === ut.FALSE;
        }
        set() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            for (let e2 = 0; e2 < t2.length; e2++) {
              const n2 = Math.trunc(e2 / 3), s2 = e2 % 3;
              this._matrix[n2][s2] = ut.toDimensionValue(t2.charAt(e2));
            }
          } else if (3 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
            this._matrix[t2][e2] = n2;
          }
        }
        isContains() {
          return se.isTrue(this._matrix[ne.INTERIOR][ne.INTERIOR]) && this._matrix[ne.EXTERIOR][ne.INTERIOR] === ut.FALSE && this._matrix[ne.EXTERIOR][ne.BOUNDARY] === ut.FALSE;
        }
        setAtLeast() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            for (let e2 = 0; e2 < t2.length; e2++) {
              const n2 = Math.trunc(e2 / 3), s2 = e2 % 3;
              this.setAtLeast(n2, s2, ut.toDimensionValue(t2.charAt(e2)));
            }
          } else if (3 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
            this._matrix[t2][e2] < n2 && (this._matrix[t2][e2] = n2);
          }
        }
        setAtLeastIfValid(t2, e2, n2) {
          t2 >= 0 && e2 >= 0 && this.setAtLeast(t2, e2, n2);
        }
        isWithin() {
          return se.isTrue(this._matrix[ne.INTERIOR][ne.INTERIOR]) && this._matrix[ne.INTERIOR][ne.EXTERIOR] === ut.FALSE && this._matrix[ne.BOUNDARY][ne.EXTERIOR] === ut.FALSE;
        }
        isTouches(t2, e2) {
          return t2 > e2 ? this.isTouches(e2, t2) : (t2 === ut.A && e2 === ut.A || t2 === ut.L && e2 === ut.L || t2 === ut.L && e2 === ut.A || t2 === ut.P && e2 === ut.A || t2 === ut.P && e2 === ut.L) && (this._matrix[ne.INTERIOR][ne.INTERIOR] === ut.FALSE && (se.isTrue(this._matrix[ne.INTERIOR][ne.BOUNDARY]) || se.isTrue(this._matrix[ne.BOUNDARY][ne.INTERIOR]) || se.isTrue(this._matrix[ne.BOUNDARY][ne.BOUNDARY])));
        }
        isOverlaps(t2, e2) {
          return t2 === ut.P && e2 === ut.P || t2 === ut.A && e2 === ut.A ? se.isTrue(this._matrix[ne.INTERIOR][ne.INTERIOR]) && se.isTrue(this._matrix[ne.INTERIOR][ne.EXTERIOR]) && se.isTrue(this._matrix[ne.EXTERIOR][ne.INTERIOR]) : t2 === ut.L && e2 === ut.L && (1 === this._matrix[ne.INTERIOR][ne.INTERIOR] && se.isTrue(this._matrix[ne.INTERIOR][ne.EXTERIOR]) && se.isTrue(this._matrix[ne.EXTERIOR][ne.INTERIOR]));
        }
        isEquals(t2, e2) {
          return t2 === e2 && (se.isTrue(this._matrix[ne.INTERIOR][ne.INTERIOR]) && this._matrix[ne.INTERIOR][ne.EXTERIOR] === ut.FALSE && this._matrix[ne.BOUNDARY][ne.EXTERIOR] === ut.FALSE && this._matrix[ne.EXTERIOR][ne.INTERIOR] === ut.FALSE && this._matrix[ne.EXTERIOR][ne.BOUNDARY] === ut.FALSE);
        }
        toString() {
          const t2 = new wt("123456789");
          for (let e2 = 0; e2 < 3; e2++) for (let n2 = 0; n2 < 3; n2++) t2.setCharAt(3 * e2 + n2, ut.toDimensionSymbol(this._matrix[e2][n2]));
          return t2.toString();
        }
        setAll(t2) {
          for (let e2 = 0; e2 < 3; e2++) for (let n2 = 0; n2 < 3; n2++) this._matrix[e2][n2] = t2;
        }
        get(t2, e2) {
          return this._matrix[t2][e2];
        }
        transpose() {
          let t2 = this._matrix[1][0];
          return this._matrix[1][0] = this._matrix[0][1], this._matrix[0][1] = t2, t2 = this._matrix[2][0], this._matrix[2][0] = this._matrix[0][2], this._matrix[0][2] = t2, t2 = this._matrix[2][1], this._matrix[2][1] = this._matrix[1][2], this._matrix[1][2] = t2, this;
        }
        matches(t2) {
          if (9 !== t2.length) throw new n("Should be length 9: " + t2);
          for (let e2 = 0; e2 < 3; e2++) for (let n2 = 0; n2 < 3; n2++) if (!se.matches(this._matrix[e2][n2], t2.charAt(3 * e2 + n2))) return false;
          return true;
        }
        add(t2) {
          for (let e2 = 0; e2 < 3; e2++) for (let n2 = 0; n2 < 3; n2++) this.setAtLeast(e2, n2, t2.get(e2, n2));
        }
        isDisjoint() {
          return this._matrix[ne.INTERIOR][ne.INTERIOR] === ut.FALSE && this._matrix[ne.INTERIOR][ne.BOUNDARY] === ut.FALSE && this._matrix[ne.BOUNDARY][ne.INTERIOR] === ut.FALSE && this._matrix[ne.BOUNDARY][ne.BOUNDARY] === ut.FALSE;
        }
        isCrosses(t2, e2) {
          return t2 === ut.P && e2 === ut.L || t2 === ut.P && e2 === ut.A || t2 === ut.L && e2 === ut.A ? se.isTrue(this._matrix[ne.INTERIOR][ne.INTERIOR]) && se.isTrue(this._matrix[ne.INTERIOR][ne.EXTERIOR]) : t2 === ut.L && e2 === ut.P || t2 === ut.A && e2 === ut.P || t2 === ut.A && e2 === ut.L ? se.isTrue(this._matrix[ne.INTERIOR][ne.INTERIOR]) && se.isTrue(this._matrix[ne.EXTERIOR][ne.INTERIOR]) : t2 === ut.L && e2 === ut.L && 0 === this._matrix[ne.INTERIOR][ne.INTERIOR];
        }
        getClass() {
          return se;
        }
        get interfaces_() {
          return [o];
        }
      }
      se.constructor_ = function() {
        if (this._matrix = null, 0 === arguments.length) this._matrix = Array(3).fill().map(() => Array(3)), this.setAll(ut.FALSE);
        else if (1 === arguments.length) {
          if ("string" == typeof arguments[0]) {
            const t2 = arguments[0];
            se.constructor_.call(this), this.set(t2);
          } else if (arguments[0] instanceof se) {
            const t2 = arguments[0];
            se.constructor_.call(this), this._matrix[ne.INTERIOR][ne.INTERIOR] = t2._matrix[ne.INTERIOR][ne.INTERIOR], this._matrix[ne.INTERIOR][ne.BOUNDARY] = t2._matrix[ne.INTERIOR][ne.BOUNDARY], this._matrix[ne.INTERIOR][ne.EXTERIOR] = t2._matrix[ne.INTERIOR][ne.EXTERIOR], this._matrix[ne.BOUNDARY][ne.INTERIOR] = t2._matrix[ne.BOUNDARY][ne.INTERIOR], this._matrix[ne.BOUNDARY][ne.BOUNDARY] = t2._matrix[ne.BOUNDARY][ne.BOUNDARY], this._matrix[ne.BOUNDARY][ne.EXTERIOR] = t2._matrix[ne.BOUNDARY][ne.EXTERIOR], this._matrix[ne.EXTERIOR][ne.INTERIOR] = t2._matrix[ne.EXTERIOR][ne.INTERIOR], this._matrix[ne.EXTERIOR][ne.BOUNDARY] = t2._matrix[ne.EXTERIOR][ne.BOUNDARY], this._matrix[ne.EXTERIOR][ne.EXTERIOR] = t2._matrix[ne.EXTERIOR][ne.EXTERIOR];
          }
        }
      };
      class ie {
        constructor() {
          ie.constructor_.apply(this, arguments);
        }
        static toDegrees(t2) {
          return 180 * t2 / Math.PI;
        }
        static normalize(t2) {
          for (; t2 > Math.PI; ) t2 -= ie.PI_TIMES_2;
          for (; t2 <= -Math.PI; ) t2 += ie.PI_TIMES_2;
          return t2;
        }
        static angle() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return Math.atan2(t2.y, t2.x);
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = e2.x - t2.x, s2 = e2.y - t2.y;
            return Math.atan2(s2, n2);
          }
        }
        static isAcute(t2, e2, n2) {
          const s2 = t2.x - e2.x, i2 = t2.y - e2.y;
          return s2 * (n2.x - e2.x) + i2 * (n2.y - e2.y) > 0;
        }
        static isObtuse(t2, e2, n2) {
          const s2 = t2.x - e2.x, i2 = t2.y - e2.y;
          return s2 * (n2.x - e2.x) + i2 * (n2.y - e2.y) < 0;
        }
        static interiorAngle(t2, e2, n2) {
          const s2 = ie.angle(e2, t2), i2 = ie.angle(e2, n2);
          return Math.abs(i2 - s2);
        }
        static normalizePositive(t2) {
          if (t2 < 0) {
            for (; t2 < 0; ) t2 += ie.PI_TIMES_2;
            t2 >= ie.PI_TIMES_2 && (t2 = 0);
          } else {
            for (; t2 >= ie.PI_TIMES_2; ) t2 -= ie.PI_TIMES_2;
            t2 < 0 && (t2 = 0);
          }
          return t2;
        }
        static angleBetween(t2, e2, n2) {
          const s2 = ie.angle(e2, t2), i2 = ie.angle(e2, n2);
          return ie.diff(s2, i2);
        }
        static diff(t2, e2) {
          let n2 = null;
          return n2 = t2 < e2 ? e2 - t2 : t2 - e2, n2 > Math.PI && (n2 = 2 * Math.PI - n2), n2;
        }
        static toRadians(t2) {
          return t2 * Math.PI / 180;
        }
        static getTurn(t2, e2) {
          const n2 = Math.sin(e2 - t2);
          return n2 > 0 ? ie.COUNTERCLOCKWISE : n2 < 0 ? ie.CLOCKWISE : ie.NONE;
        }
        static angleBetweenOriented(t2, e2, n2) {
          const s2 = ie.angle(e2, t2), i2 = ie.angle(e2, n2) - s2;
          return i2 <= -Math.PI ? i2 + ie.PI_TIMES_2 : i2 > Math.PI ? i2 - ie.PI_TIMES_2 : i2;
        }
        getClass() {
          return ie;
        }
        get interfaces_() {
          return [];
        }
      }
      ie.constructor_ = function() {
      }, ie.PI_TIMES_2 = 2 * Math.PI, ie.PI_OVER_2 = Math.PI / 2, ie.PI_OVER_4 = Math.PI / 4, ie.COUNTERCLOCKWISE = v.COUNTERCLOCKWISE, ie.CLOCKWISE = v.CLOCKWISE, ie.NONE = v.COLLINEAR;
      class re {
        constructor() {
          re.constructor_.apply(this, arguments);
        }
        static area(t2, e2, n2) {
          return Math.abs(((n2.x - t2.x) * (e2.y - t2.y) - (e2.x - t2.x) * (n2.y - t2.y)) / 2);
        }
        static signedArea(t2, e2, n2) {
          return ((n2.x - t2.x) * (e2.y - t2.y) - (e2.x - t2.x) * (n2.y - t2.y)) / 2;
        }
        static det(t2, e2, n2, s2) {
          return t2 * s2 - e2 * n2;
        }
        static interpolateZ(t2, e2, n2, s2) {
          const i2 = e2.x, r2 = e2.y, o2 = n2.x - i2, l2 = s2.x - i2, a2 = n2.y - r2, c2 = s2.y - r2, h2 = o2 * c2 - l2 * a2, u2 = t2.x - i2, g2 = t2.y - r2, d2 = (c2 * u2 - l2 * g2) / h2, _2 = (-a2 * u2 + o2 * g2) / h2;
          return e2.z + d2 * (n2.z - e2.z) + _2 * (s2.z - e2.z);
        }
        static longestSideLength(t2, e2, n2) {
          const s2 = t2.distance(e2), i2 = e2.distance(n2), r2 = n2.distance(t2);
          let o2 = s2;
          return i2 > o2 && (o2 = i2), r2 > o2 && (o2 = r2), o2;
        }
        static isAcute(t2, e2, n2) {
          return !!ie.isAcute(t2, e2, n2) && (!!ie.isAcute(e2, n2, t2) && !!ie.isAcute(n2, t2, e2));
        }
        static circumcentre(t2, e2, n2) {
          const s2 = n2.x, i2 = n2.y, r2 = t2.x - s2, o2 = t2.y - i2, l2 = e2.x - s2, a2 = e2.y - i2, c2 = 2 * re.det(r2, o2, l2, a2), h2 = re.det(o2, r2 * r2 + o2 * o2, a2, l2 * l2 + a2 * a2), u2 = re.det(r2, r2 * r2 + o2 * o2, l2, l2 * l2 + a2 * a2);
          return new g(s2 - h2 / c2, i2 + u2 / c2);
        }
        static perpendicularBisector(t2, e2) {
          const n2 = e2.x - t2.x, s2 = e2.y - t2.y, i2 = new b(t2.x + n2 / 2, t2.y + s2 / 2, 1), r2 = new b(t2.x - s2 + n2 / 2, t2.y + n2 + s2 / 2, 1);
          return new b(i2, r2);
        }
        static angleBisector(t2, e2, n2) {
          const s2 = e2.distance(t2), i2 = s2 / (s2 + e2.distance(n2)), r2 = n2.x - t2.x, o2 = n2.y - t2.y;
          return new g(t2.x + i2 * r2, t2.y + i2 * o2);
        }
        static area3D(t2, e2, n2) {
          const s2 = e2.x - t2.x, i2 = e2.y - t2.y, r2 = e2.z - t2.z, o2 = n2.x - t2.x, l2 = n2.y - t2.y, a2 = n2.z - t2.z, c2 = i2 * a2 - r2 * l2, h2 = r2 * o2 - s2 * a2, u2 = s2 * l2 - i2 * o2, g2 = c2 * c2 + h2 * h2 + u2 * u2;
          return Math.sqrt(g2) / 2;
        }
        static centroid(t2, e2, n2) {
          const s2 = (t2.x + e2.x + n2.x) / 3, i2 = (t2.y + e2.y + n2.y) / 3;
          return new g(s2, i2);
        }
        static inCentre(t2, e2, n2) {
          const s2 = e2.distance(n2), i2 = t2.distance(n2), r2 = t2.distance(e2), o2 = s2 + i2 + r2, l2 = (s2 * t2.x + i2 * e2.x + r2 * n2.x) / o2, a2 = (s2 * t2.y + i2 * e2.y + r2 * n2.y) / o2;
          return new g(l2, a2);
        }
        area() {
          return re.area(this.p0, this.p1, this.p2);
        }
        signedArea() {
          return re.signedArea(this.p0, this.p1, this.p2);
        }
        interpolateZ(t2) {
          if (null === t2) throw new n("Supplied point is null.");
          return re.interpolateZ(t2, this.p0, this.p1, this.p2);
        }
        longestSideLength() {
          return re.longestSideLength(this.p0, this.p1, this.p2);
        }
        isAcute() {
          return re.isAcute(this.p0, this.p1, this.p2);
        }
        circumcentre() {
          return re.circumcentre(this.p0, this.p1, this.p2);
        }
        area3D() {
          return re.area3D(this.p0, this.p1, this.p2);
        }
        centroid() {
          return re.centroid(this.p0, this.p1, this.p2);
        }
        inCentre() {
          return re.inCentre(this.p0, this.p1, this.p2);
        }
        getClass() {
          return re;
        }
        get interfaces_() {
          return [];
        }
      }
      re.constructor_ = function() {
        this.p0 = null, this.p1 = null, this.p2 = null;
        const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
        this.p0 = t2, this.p1 = e2, this.p2 = n2;
      };
      class oe extends C {
        constructor() {
          super(), oe.constructor_.apply(this, arguments);
        }
        getClass() {
          return oe;
        }
        get interfaces_() {
          return [];
        }
      }
      oe.constructor_ = function() {
        if (0 === arguments.length) C.constructor_.call(this);
        else if (1 === arguments.length) {
          const t2 = arguments[0];
          C.constructor_.call(this, t2);
        }
      };
      class le {
        constructor() {
          le.constructor_.apply(this, arguments);
        }
        static translationInstance(t2, e2) {
          const n2 = new le();
          return n2.setToTranslation(t2, e2), n2;
        }
        static shearInstance(t2, e2) {
          const n2 = new le();
          return n2.setToShear(t2, e2), n2;
        }
        static reflectionInstance() {
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = new le();
            return n2.setToReflection(t2, e2), n2;
          }
          if (4 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3], i2 = new le();
            return i2.setToReflection(t2, e2, n2, s2), i2;
          }
        }
        static rotationInstance() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return le.rotationInstance(Math.sin(t2), Math.cos(t2));
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = new le();
            return n2.setToRotation(t2, e2), n2;
          }
          if (3 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
            return le.rotationInstance(Math.sin(t2), Math.cos(t2), e2, n2);
          }
          if (4 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3], i2 = new le();
            return i2.setToRotation(t2, e2, n2, s2), i2;
          }
        }
        static scaleInstance() {
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = new le();
            return n2.setToScale(t2, e2), n2;
          }
          if (4 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3], i2 = new le();
            return i2.translate(-n2, -s2), i2.scale(t2, e2), i2.translate(n2, s2), i2;
          }
        }
        setToReflectionBasic(t2, e2, s2, i2) {
          if (t2 === s2 && e2 === i2) throw new n("Reflection line points must be distinct");
          const r2 = s2 - t2, o2 = i2 - e2, l2 = Math.sqrt(r2 * r2 + o2 * o2), a2 = o2 / l2, c2 = r2 / l2, h2 = 2 * a2 * c2, u2 = c2 * c2 - a2 * a2;
          return this._m00 = u2, this._m01 = h2, this._m02 = 0, this._m10 = h2, this._m11 = -u2, this._m12 = 0, this;
        }
        getInverse() {
          const t2 = this.getDeterminant();
          if (0 === t2) throw new oe("Transformation is non-invertible");
          const e2 = this._m11 / t2, n2 = -this._m10 / t2, s2 = -this._m01 / t2, i2 = this._m00 / t2, r2 = (this._m01 * this._m12 - this._m02 * this._m11) / t2, o2 = (-this._m00 * this._m12 + this._m10 * this._m02) / t2;
          return new le(e2, s2, r2, n2, i2, o2);
        }
        compose(t2) {
          const e2 = t2._m00 * this._m00 + t2._m01 * this._m10, n2 = t2._m00 * this._m01 + t2._m01 * this._m11, s2 = t2._m00 * this._m02 + t2._m01 * this._m12 + t2._m02, i2 = t2._m10 * this._m00 + t2._m11 * this._m10, r2 = t2._m10 * this._m01 + t2._m11 * this._m11, o2 = t2._m10 * this._m02 + t2._m11 * this._m12 + t2._m12;
          return this._m00 = e2, this._m01 = n2, this._m02 = s2, this._m10 = i2, this._m11 = r2, this._m12 = o2, this;
        }
        equals(t2) {
          if (null === t2) return false;
          if (!(t2 instanceof le)) return false;
          const e2 = t2;
          return this._m00 === e2._m00 && this._m01 === e2._m01 && this._m02 === e2._m02 && this._m10 === e2._m10 && this._m11 === e2._m11 && this._m12 === e2._m12;
        }
        setToScale(t2, e2) {
          return this._m00 = t2, this._m01 = 0, this._m02 = 0, this._m10 = 0, this._m11 = e2, this._m12 = 0, this;
        }
        isIdentity() {
          return 1 === this._m00 && 0 === this._m01 && 0 === this._m02 && 0 === this._m10 && 1 === this._m11 && 0 === this._m12;
        }
        scale(t2, e2) {
          return this.compose(le.scaleInstance(t2, e2)), this;
        }
        setToIdentity() {
          return this._m00 = 1, this._m01 = 0, this._m02 = 0, this._m10 = 0, this._m11 = 1, this._m12 = 0, this;
        }
        isGeometryChanged() {
          return true;
        }
        setTransformation() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return this._m00 = t2._m00, this._m01 = t2._m01, this._m02 = t2._m02, this._m10 = t2._m10, this._m11 = t2._m11, this._m12 = t2._m12, this;
          }
          if (6 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3], i2 = arguments[4], r2 = arguments[5];
            return this._m00 = t2, this._m01 = e2, this._m02 = n2, this._m10 = s2, this._m11 = i2, this._m12 = r2, this;
          }
        }
        setToRotation() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return this.setToRotation(Math.sin(t2), Math.cos(t2)), this;
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return this._m00 = e2, this._m01 = -t2, this._m02 = 0, this._m10 = t2, this._m11 = e2, this._m12 = 0, this;
          }
          if (3 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
            return this.setToRotation(Math.sin(t2), Math.cos(t2), e2, n2), this;
          }
          if (4 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3];
            return this._m00 = e2, this._m01 = -t2, this._m02 = n2 - n2 * e2 + s2 * t2, this._m10 = t2, this._m11 = e2, this._m12 = s2 - n2 * t2 - s2 * e2, this;
          }
        }
        getMatrixEntries() {
          return [this._m00, this._m01, this._m02, this._m10, this._m11, this._m12];
        }
        filter(t2, e2) {
          this.transform(t2, e2);
        }
        rotate() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return this.compose(le.rotationInstance(t2)), this;
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return this.compose(le.rotationInstance(t2, e2)), this;
          }
          if (3 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
            return this.compose(le.rotationInstance(t2, e2, n2)), this;
          }
          if (4 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return this.compose(le.rotationInstance(t2, e2)), this;
          }
        }
        getDeterminant() {
          return this._m00 * this._m11 - this._m01 * this._m10;
        }
        composeBefore(t2) {
          const e2 = this._m00 * t2._m00 + this._m01 * t2._m10, n2 = this._m00 * t2._m01 + this._m01 * t2._m11, s2 = this._m00 * t2._m02 + this._m01 * t2._m12 + this._m02, i2 = this._m10 * t2._m00 + this._m11 * t2._m10, r2 = this._m10 * t2._m01 + this._m11 * t2._m11, o2 = this._m10 * t2._m02 + this._m11 * t2._m12 + this._m12;
          return this._m00 = e2, this._m01 = n2, this._m02 = s2, this._m10 = i2, this._m11 = r2, this._m12 = o2, this;
        }
        setToShear(t2, e2) {
          return this._m00 = 1, this._m01 = t2, this._m02 = 0, this._m10 = e2, this._m11 = 1, this._m12 = 0, this;
        }
        isDone() {
          return false;
        }
        clone() {
          try {
            return null;
          } catch (t2) {
            if (!(t2 instanceof C)) throw t2;
            u.shouldNeverReachHere();
          }
          return null;
        }
        translate(t2, e2) {
          return this.compose(le.translationInstance(t2, e2)), this;
        }
        setToReflection() {
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            if (0 === t2 && 0 === e2) throw new n("Reflection vector must be non-zero");
            if (t2 === e2) return this._m00 = 0, this._m01 = 1, this._m02 = 0, this._m10 = 1, this._m11 = 0, this._m12 = 0, this;
            const s2 = Math.sqrt(t2 * t2 + e2 * e2), i2 = e2 / s2, r2 = t2 / s2;
            return this.rotate(-i2, r2), this.scale(1, -1), this.rotate(i2, r2), this;
          }
          if (4 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], s2 = arguments[2], i2 = arguments[3];
            if (t2 === s2 && e2 === i2) throw new n("Reflection line points must be distinct");
            this.setToTranslation(-t2, -e2);
            const r2 = s2 - t2, o2 = i2 - e2, l2 = Math.sqrt(r2 * r2 + o2 * o2), a2 = o2 / l2, c2 = r2 / l2;
            return this.rotate(-a2, c2), this.scale(1, -1), this.rotate(a2, c2), this.translate(t2, e2), this;
          }
        }
        toString() {
          return "AffineTransformation[[" + this._m00 + ", " + this._m01 + ", " + this._m02 + "], [" + this._m10 + ", " + this._m11 + ", " + this._m12 + "]]";
        }
        setToTranslation(t2, e2) {
          return this._m00 = 1, this._m01 = 0, this._m02 = t2, this._m10 = 0, this._m11 = 1, this._m12 = e2, this;
        }
        shear(t2, e2) {
          return this.compose(le.shearInstance(t2, e2)), this;
        }
        transform() {
          if (1 === arguments.length) {
            const t2 = arguments[0].copy();
            return t2.apply(this), t2;
          }
          if (2 === arguments.length) {
            if (arguments[0] instanceof g && arguments[1] instanceof g) {
              const t2 = arguments[0], e2 = arguments[1], n2 = this._m00 * t2.x + this._m01 * t2.y + this._m02, s2 = this._m10 * t2.x + this._m11 * t2.y + this._m12;
              return e2.x = n2, e2.y = s2, e2;
            }
            if (_(arguments[0], A) && Number.isInteger(arguments[1])) {
              const t2 = arguments[0], e2 = arguments[1], n2 = this._m00 * t2.getOrdinate(e2, 0) + this._m01 * t2.getOrdinate(e2, 1) + this._m02, s2 = this._m10 * t2.getOrdinate(e2, 0) + this._m11 * t2.getOrdinate(e2, 1) + this._m12;
              t2.setOrdinate(e2, 0, n2), t2.setOrdinate(e2, 1, s2);
            }
          }
        }
        reflect() {
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return this.compose(le.reflectionInstance(t2, e2)), this;
          }
          if (4 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3];
            return this.compose(le.reflectionInstance(t2, e2, n2, s2)), this;
          }
        }
        getClass() {
          return le;
        }
        get interfaces_() {
          return [o, dt];
        }
      }
      le.constructor_ = function() {
        if (this._m00 = null, this._m01 = null, this._m02 = null, this._m10 = null, this._m11 = null, this._m12 = null, 0 === arguments.length) this.setToIdentity();
        else if (1 === arguments.length) {
          if (arguments[0] instanceof Array) {
            const t2 = arguments[0];
            this._m00 = t2[0], this._m01 = t2[1], this._m02 = t2[2], this._m10 = t2[3], this._m11 = t2[4], this._m12 = t2[5];
          } else if (arguments[0] instanceof le) {
            const t2 = arguments[0];
            this.setTransformation(t2);
          }
        } else if (6 === arguments.length && "number" == typeof arguments[5] && "number" == typeof arguments[4] && "number" == typeof arguments[3] && "number" == typeof arguments[2] && "number" == typeof arguments[0] && "number" == typeof arguments[1]) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3], i2 = arguments[4], r2 = arguments[5];
          this.setTransformation(t2, e2, n2, s2, i2, r2);
        }
      };
      class ae {
        constructor() {
          ae.constructor_.apply(this, arguments);
        }
        static solve(t2, e2) {
          const s2 = e2.length;
          if (t2.length !== s2 || t2[0].length !== s2) throw new n("Matrix A is incorrectly sized");
          for (let n2 = 0; n2 < s2; n2++) {
            let i3 = n2;
            for (let e3 = n2 + 1; e3 < s2; e3++) Math.abs(t2[e3][n2]) > Math.abs(t2[i3][n2]) && (i3 = e3);
            if (0 === t2[i3][n2]) return null;
            ae.swapRows(t2, n2, i3), ae.swapRows(e2, n2, i3);
            for (let i4 = n2 + 1; i4 < s2; i4++) {
              const r2 = t2[i4][n2] / t2[n2][n2];
              for (let e3 = s2 - 1; e3 >= n2; e3--) t2[i4][e3] -= t2[n2][e3] * r2;
              e2[i4] -= e2[n2] * r2;
            }
          }
          const i2 = new Array(s2).fill(null);
          for (let n2 = s2 - 1; n2 >= 0; n2--) {
            let r2 = 0;
            for (let e3 = n2 + 1; e3 < s2; e3++) r2 += t2[n2][e3] * i2[e3];
            i2[n2] = (e2[n2] - r2) / t2[n2][n2];
          }
          return i2;
        }
        static swapRows() {
          if (Number.isInteger(arguments[2]) && arguments[0] instanceof Array && Number.isInteger(arguments[1])) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
            if (e2 === n2) return null;
            for (let s2 = 0; s2 < t2[0].length; s2++) {
              const i2 = t2[e2][s2];
              t2[e2][s2] = t2[n2][s2], t2[n2][s2] = i2;
            }
          } else if (Number.isInteger(arguments[2]) && arguments[0] instanceof Array && Number.isInteger(arguments[1])) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
            if (e2 === n2) return null;
            const s2 = t2[e2];
            t2[e2] = t2[n2], t2[n2] = s2;
          }
        }
        getClass() {
          return ae;
        }
        get interfaces_() {
          return [];
        }
      }
      ae.constructor_ = function() {
      };
      class ce {
        constructor() {
          ce.constructor_.apply(this, arguments);
        }
        solve(t2) {
          const e2 = [[this._src0.x, this._src0.y, 1], [this._src1.x, this._src1.y, 1], [this._src2.x, this._src2.y, 1]];
          return ae.solve(e2, t2);
        }
        compute() {
          const t2 = [this._dest0.x, this._dest1.x, this._dest2.x], e2 = this.solve(t2);
          if (null === e2) return false;
          this._m00 = e2[0], this._m01 = e2[1], this._m02 = e2[2];
          const n2 = [this._dest0.y, this._dest1.y, this._dest2.y], s2 = this.solve(n2);
          return null !== s2 && (this._m10 = s2[0], this._m11 = s2[1], this._m12 = s2[2], true);
        }
        getTransformation() {
          return this.compute() ? new le(this._m00, this._m01, this._m02, this._m10, this._m11, this._m12) : null;
        }
        getClass() {
          return ce;
        }
        get interfaces_() {
          return [];
        }
      }
      ce.constructor_ = function() {
        this._src0 = null, this._src1 = null, this._src2 = null, this._dest0 = null, this._dest1 = null, this._dest2 = null, this._m00 = null, this._m01 = null, this._m02 = null, this._m10 = null, this._m11 = null, this._m12 = null;
        const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3], i2 = arguments[4], r2 = arguments[5];
        this._src0 = t2, this._src1 = e2, this._src2 = n2, this._dest0 = s2, this._dest1 = i2, this._dest2 = r2;
      };
      class he {
        constructor() {
          he.constructor_.apply(this, arguments);
        }
        static createFromBaseLines(t2, e2, n2, s2) {
          const i2 = new g(t2.x + s2.x - n2.x, t2.y + s2.y - n2.y), r2 = ie.angleBetweenOriented(e2, t2, i2), o2 = e2.distance(t2), l2 = s2.distance(n2);
          if (0 === o2) return new le();
          const a2 = l2 / o2, c2 = le.translationInstance(-t2.x, -t2.y);
          return c2.rotate(r2), c2.scale(a2, a2), c2.translate(n2.x, n2.y), c2;
        }
        static createFromControlVectors() {
          if (2 === arguments.length) {
            if (arguments[0] instanceof g && arguments[1] instanceof g) {
              const t2 = arguments[0], e2 = arguments[1], n2 = e2.x - t2.x, s2 = e2.y - t2.y;
              return le.translationInstance(n2, s2);
            }
            if (arguments[0] instanceof Array && arguments[1] instanceof Array) {
              const t2 = arguments[0], e2 = arguments[1];
              if (t2.length !== e2.length) throw new n("Src and Dest arrays are not the same length");
              if (t2.length <= 0) throw new n("Too few control points");
              if (t2.length > 3) throw new n("Too many control points");
              return 1 === t2.length ? he.createFromControlVectors(t2[0], e2[0]) : 2 === t2.length ? he.createFromControlVectors(t2[0], t2[1], e2[0], e2[1]) : he.createFromControlVectors(t2[0], t2[1], t2[2], e2[0], e2[1], e2[2]);
            }
          } else {
            if (4 === arguments.length) {
              const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3], i2 = new g(s2.x - n2.x, s2.y - n2.y), r2 = ie.angleBetweenOriented(e2, t2, i2), o2 = e2.distance(t2), l2 = s2.distance(n2);
              if (0 === o2) return null;
              const a2 = l2 / o2, c2 = le.translationInstance(-t2.x, -t2.y);
              return c2.rotate(r2), c2.scale(a2, a2), c2.translate(n2.x, n2.y), c2;
            }
            if (6 === arguments.length) {
              const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3], i2 = arguments[4], r2 = arguments[5];
              return new ce(t2, e2, n2, s2, i2, r2).getTransformation();
            }
          }
        }
        getClass() {
          return he;
        }
        get interfaces_() {
          return [];
        }
      }
      he.constructor_ = function() {
      };
      class ue {
        constructor() {
          ue.constructor_.apply(this, arguments);
        }
        static getCoordinates(t2) {
          const e2 = new x();
          return t2.apply(new ue(e2)), e2;
        }
        filter(t2) {
          (t2 instanceof Tt || t2 instanceof Pt) && this._coords.add(t2.getCoordinate());
        }
        getClass() {
          return ue;
        }
        get interfaces_() {
          return [G];
        }
      }
      ue.constructor_ = function() {
        this._coords = null;
        const t2 = arguments[0];
        this._coords = t2;
      };
      class ge {
        constructor() {
          ge.constructor_.apply(this, arguments);
        }
        static map(t2, e2) {
          return new ge(e2).map(t2);
        }
        map(t2) {
          const e2 = new x();
          for (let n2 = 0; n2 < t2.getNumGeometries(); n2++) {
            const s2 = this._mapOp.map(t2.getGeometryN(n2));
            s2.isEmpty() || e2.add(s2);
          }
          return t2.getFactory().createGeometryCollection(Ht.toGeometryArray(e2));
        }
        getClass() {
          return ge;
        }
        get interfaces_() {
          return [];
        }
      }
      ge.constructor_ = function() {
        this._mapOp = null;
        const t2 = arguments[0];
        this._mapOp = t2;
      };
      class de {
        constructor() {
          de.constructor_.apply(this, arguments);
        }
        static combine() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return new de(t2).combine();
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return new de(de.createList(t2, e2)).combine();
          }
          if (3 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
            return new de(de.createList(t2, e2, n2)).combine();
          }
        }
        static extractFactory(t2) {
          return t2.isEmpty() ? null : t2.iterator().next().getFactory();
        }
        static createList() {
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = new x();
            return n2.add(t2), n2.add(e2), n2;
          }
          if (3 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = new x();
            return s2.add(t2), s2.add(e2), s2.add(n2), s2;
          }
        }
        extractElements(t2, e2) {
          if (null === t2) return null;
          for (let n2 = 0; n2 < t2.getNumGeometries(); n2++) {
            const s2 = t2.getGeometryN(n2);
            this._skipEmpty && s2.isEmpty() || e2.add(s2);
          }
        }
        combine() {
          const t2 = new x();
          for (let e2 = this._inputGeoms.iterator(); e2.hasNext(); ) {
            const n2 = e2.next();
            this.extractElements(n2, t2);
          }
          return 0 === t2.size() ? null !== this._geomFactory ? this._geomFactory.createGeometryCollection() : null : this._geomFactory.buildGeometry(t2);
        }
        getClass() {
          return de;
        }
        get interfaces_() {
          return [];
        }
      }
      de.constructor_ = function() {
        this._geomFactory = null, this._skipEmpty = false, this._inputGeoms = null;
        const t2 = arguments[0];
        this._geomFactory = de.extractFactory(t2), this._inputGeoms = t2;
      };
      class _e {
        constructor() {
          _e.constructor_.apply(this, arguments);
        }
        static isOfType(t2, e2) {
          return t2.getGeometryType() === e2 || e2 === q.TYPENAME_LINESTRING && t2.getGeometryType() === q.TYPENAME_LINEARRING;
        }
        static extract() {
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return _e.extract(t2, e2, new x());
          }
          if (3 === arguments.length) {
            if (_(arguments[2], m) && arguments[0] instanceof q && "string" == typeof arguments[1]) {
              const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
              return t2.getGeometryType() === e2 ? n2.add(t2) : t2 instanceof _t && t2.apply(new _e(e2, n2)), n2;
            }
            if (_(arguments[2], m) && arguments[0] instanceof q && arguments[1] instanceof Class) {
              const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
              return _e.extract(t2, _e.toGeometryType(e2), n2);
            }
          }
        }
        filter(t2) {
          (null === this._geometryType || _e.isOfType(t2, this._geometryType)) && this._comps.add(t2);
        }
        getClass() {
          return _e;
        }
        get interfaces_() {
          return [gt];
        }
      }
      _e.constructor_ = function() {
        this._geometryType = null, this._comps = null;
        const t2 = arguments[0], e2 = arguments[1];
        this._geometryType = t2, this._comps = e2;
      };
      class fe {
        constructor() {
          fe.constructor_.apply(this, arguments);
        }
        map(t2) {
        }
        getClass() {
          return fe;
        }
        get interfaces_() {
          return [];
        }
      }
      fe.constructor_ = function() {
      };
      class pe {
        constructor() {
          pe.constructor_.apply(this, arguments);
        }
        static map() {
          if (arguments[0] instanceof q && _(arguments[1], fe)) {
            const t2 = arguments[0], e2 = arguments[1], n2 = new x();
            for (let s2 = 0; s2 < t2.getNumGeometries(); s2++) {
              const i2 = e2.map(t2.getGeometryN(s2));
              null !== i2 && n2.add(i2);
            }
            return t2.getFactory().buildGeometry(n2);
          }
          if (_(arguments[0], f) && _(arguments[1], fe)) {
            const t2 = arguments[0], e2 = arguments[1], n2 = new x();
            for (let s2 = t2.iterator(); s2.hasNext(); ) {
              const t3 = s2.next(), i2 = e2.map(t3);
              null !== i2 && n2.add(i2);
            }
            return n2;
          }
        }
        getClass() {
          return pe;
        }
        get interfaces_() {
          return [];
        }
      }
      pe.constructor_ = function() {
      };
      class me {
        constructor() {
          me.constructor_.apply(this, arguments);
        }
        transformPoint(t2, e2) {
          return this._factory.createPoint(this.transformCoordinates(t2.getCoordinateSequence(), t2));
        }
        transformPolygon(t2, e2) {
          let n2 = true;
          const s2 = this.transformLinearRing(t2.getExteriorRing(), t2);
          null !== s2 && s2 instanceof Dt && !s2.isEmpty() || (n2 = false);
          const i2 = new x();
          for (let e3 = 0; e3 < t2.getNumInteriorRing(); e3++) {
            const s3 = this.transformLinearRing(t2.getInteriorRingN(e3), t2);
            null === s3 || s3.isEmpty() || (s3 instanceof Dt || (n2 = false), i2.add(s3));
          }
          if (n2) return this._factory.createPolygon(s2, i2.toArray([]));
          {
            const t3 = new x();
            return null !== s2 && t3.add(s2), t3.addAll(i2), this._factory.buildGeometry(t3);
          }
        }
        createCoordinateSequence(t2) {
          return this._factory.getCoordinateSequenceFactory().create(t2);
        }
        getInputGeometry() {
          return this._inputGeom;
        }
        transformMultiLineString(t2, e2) {
          const n2 = new x();
          for (let e3 = 0; e3 < t2.getNumGeometries(); e3++) {
            const s2 = this.transformLineString(t2.getGeometryN(e3), t2);
            null !== s2 && (s2.isEmpty() || n2.add(s2));
          }
          return this._factory.buildGeometry(n2);
        }
        transformCoordinates(t2, e2) {
          return this.copy(t2);
        }
        transformLineString(t2, e2) {
          return this._factory.createLineString(this.transformCoordinates(t2.getCoordinateSequence(), t2));
        }
        transformMultiPoint(t2, e2) {
          const n2 = new x();
          for (let e3 = 0; e3 < t2.getNumGeometries(); e3++) {
            const s2 = this.transformPoint(t2.getGeometryN(e3), t2);
            null !== s2 && (s2.isEmpty() || n2.add(s2));
          }
          return this._factory.buildGeometry(n2);
        }
        transformMultiPolygon(t2, e2) {
          const n2 = new x();
          for (let e3 = 0; e3 < t2.getNumGeometries(); e3++) {
            const s2 = this.transformPolygon(t2.getGeometryN(e3), t2);
            null !== s2 && (s2.isEmpty() || n2.add(s2));
          }
          return this._factory.buildGeometry(n2);
        }
        copy(t2) {
          return t2.copy();
        }
        transformGeometryCollection(t2, e2) {
          const n2 = new x();
          for (let e3 = 0; e3 < t2.getNumGeometries(); e3++) {
            const s2 = this.transform(t2.getGeometryN(e3));
            null !== s2 && (this._pruneEmptyGeometry && s2.isEmpty() || n2.add(s2));
          }
          return this._preserveGeometryCollectionType ? this._factory.createGeometryCollection(Ht.toGeometryArray(n2)) : this._factory.buildGeometry(n2);
        }
        transform(t2) {
          if (this._inputGeom = t2, this._factory = t2.getFactory(), t2 instanceof Pt) return this.transformPoint(t2, null);
          if (t2 instanceof Mt) return this.transformMultiPoint(t2, null);
          if (t2 instanceof Dt) return this.transformLinearRing(t2, null);
          if (t2 instanceof Tt) return this.transformLineString(t2, null);
          if (t2 instanceof ft) return this.transformMultiLineString(t2, null);
          if (t2 instanceof bt) return this.transformPolygon(t2, null);
          if (t2 instanceof At) return this.transformMultiPolygon(t2, null);
          if (t2 instanceof _t) return this.transformGeometryCollection(t2, null);
          throw new n("Unknown Geometry subtype: " + t2.getClass().getName());
        }
        transformLinearRing(t2, e2) {
          const n2 = this.transformCoordinates(t2.getCoordinateSequence(), t2);
          if (null === n2) return this._factory.createLinearRing(null);
          const s2 = n2.size();
          return s2 > 0 && s2 < 4 && !this._preserveType ? this._factory.createLineString(n2) : this._factory.createLinearRing(n2);
        }
        getClass() {
          return me;
        }
        get interfaces_() {
          return [];
        }
      }
      me.constructor_ = function() {
        this._inputGeom = null, this._factory = null, this._pruneEmptyGeometry = true, this._preserveGeometryCollectionType = true, this._preserveCollections = false, this._preserveType = false;
      };
      class ye {
        constructor() {
          ye.constructor_.apply(this, arguments);
        }
        static getGeometry(t2) {
          return t2.getFactory().buildGeometry(ye.getLines(t2));
        }
        static getLines() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return ye.getLines(t2, new x());
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return t2 instanceof Tt ? e2.add(t2) : t2 instanceof _t && t2.apply(new ye(e2)), e2;
          }
        }
        filter(t2) {
          t2 instanceof Tt && this._comps.add(t2);
        }
        getClass() {
          return ye;
        }
        get interfaces_() {
          return [gt];
        }
      }
      ye.constructor_ = function() {
        this._comps = null;
        const t2 = arguments[0];
        this._comps = t2;
      };
      class xe {
        constructor() {
          xe.constructor_.apply(this, arguments);
        }
        static getGeometry() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return t2.getFactory().buildGeometry(xe.getLines(t2));
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return t2.getFactory().buildGeometry(xe.getLines(t2, e2));
          }
        }
        static getLines() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return xe.getLines(t2, false);
          }
          if (2 === arguments.length) {
            if (_(arguments[0], f) && _(arguments[1], f)) {
              const t2 = arguments[0], e2 = arguments[1];
              for (let n2 = t2.iterator(); n2.hasNext(); ) {
                const t3 = n2.next();
                xe.getLines(t3, e2);
              }
              return e2;
            }
            if (arguments[0] instanceof q && "boolean" == typeof arguments[1]) {
              const t2 = arguments[0], e2 = arguments[1], n2 = new x();
              return t2.apply(new xe(n2, e2)), n2;
            }
            if (arguments[0] instanceof q && _(arguments[1], f)) {
              const t2 = arguments[0], e2 = arguments[1];
              return t2 instanceof Tt ? e2.add(t2) : t2.apply(new xe(e2)), e2;
            }
          } else if (3 === arguments.length) {
            if ("boolean" == typeof arguments[2] && _(arguments[0], f) && _(arguments[1], f)) {
              const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
              for (let s2 = t2.iterator(); s2.hasNext(); ) {
                const t3 = s2.next();
                xe.getLines(t3, e2, n2);
              }
              return e2;
            }
            if ("boolean" == typeof arguments[2] && arguments[0] instanceof q && _(arguments[1], f)) {
              const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
              return t2.apply(new xe(e2, n2)), e2;
            }
          }
        }
        filter(t2) {
          if (this._isForcedToLineString && t2 instanceof Dt) {
            const e2 = t2.getFactory().createLineString(t2.getCoordinateSequence());
            return this._lines.add(e2), null;
          }
          t2 instanceof Tt && this._lines.add(t2);
        }
        setForceToLineString(t2) {
          this._isForcedToLineString = t2;
        }
        getClass() {
          return xe;
        }
        get interfaces_() {
          return [G];
        }
      }
      xe.constructor_ = function() {
        if (this._lines = null, this._isForcedToLineString = false, 1 === arguments.length) {
          const t2 = arguments[0];
          this._lines = t2;
        } else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          this._lines = t2, this._isForcedToLineString = e2;
        }
      };
      const Ee = { reverseOrder: function() {
        return { compare: (t2, e2) => e2.compareTo(t2) };
      }, min: function(t2) {
        return Ee.sort(t2), t2.get(0);
      }, sort: function(t2, e2) {
        const n2 = t2.toArray();
        e2 ? ht.sort(n2, e2) : ht.sort(n2);
        const s2 = t2.iterator();
        for (let t3 = 0, e3 = n2.length; t3 < e3; t3++) s2.next(), s2.set(n2[t3]);
      }, singletonList: function(t2) {
        const e2 = new x();
        return e2.add(t2), e2;
      } };
      class Ie {
        constructor() {
          Ie.constructor_.apply(this, arguments);
        }
        static getPoints() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return t2 instanceof Pt ? Ee.singletonList(t2) : Ie.getPoints(t2, new x());
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return t2 instanceof Pt ? e2.add(t2) : t2 instanceof _t && t2.apply(new Ie(e2)), e2;
          }
        }
        filter(t2) {
          t2 instanceof Pt && this._pts.add(t2);
        }
        getClass() {
          return Ie;
        }
        get interfaces_() {
          return [gt];
        }
      }
      Ie.constructor_ = function() {
        this._pts = null;
        const t2 = arguments[0];
        this._pts = t2;
      };
      class Ne {
        constructor() {
          Ne.constructor_.apply(this, arguments);
        }
        static getPolygons() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return Ne.getPolygons(t2, new x());
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return t2 instanceof bt ? e2.add(t2) : t2 instanceof _t && t2.apply(new Ne(e2)), e2;
          }
        }
        filter(t2) {
          t2 instanceof bt && this._comps.add(t2);
        }
        getClass() {
          return Ne;
        }
        get interfaces_() {
          return [gt];
        }
      }
      Ne.constructor_ = function() {
        this._comps = null;
        const t2 = arguments[0];
        this._comps = t2;
      };
      class Ce {
        constructor() {
          Ce.constructor_.apply(this, arguments);
        }
        applyTo(t2) {
          for (let e2 = 0; e2 < t2.getNumGeometries() && !this._isDone; e2++) {
            const n2 = t2.getGeometryN(e2);
            if (n2 instanceof _t) this.applyTo(n2);
            else if (this.visit(n2), this.isDone()) return this._isDone = true, null;
          }
        }
        getClass() {
          return Ce;
        }
        get interfaces_() {
          return [];
        }
      }
      Ce.constructor_ = function() {
        this._isDone = false;
      };
      class Se {
        constructor() {
          Se.constructor_.apply(this, arguments);
        }
        createSupercircle(t2) {
          const e2 = 1 / t2, n2 = this._dim.getMinSize() / 2, s2 = this._dim.getCentre(), i2 = Math.pow(n2, t2), r2 = n2, o2 = Math.pow(i2 / 2, e2), l2 = Math.trunc(this._nPts / 8), a2 = new Array(8 * l2 + 1).fill(null), c2 = o2 / l2;
          for (let n3 = 0; n3 <= l2; n3++) {
            let o3 = 0, h3 = r2;
            if (0 !== n3) {
              o3 = c2 * n3;
              const s3 = Math.pow(o3, t2);
              h3 = Math.pow(i2 - s3, e2);
            }
            a2[n3] = this.coordTrans(o3, h3, s2), a2[2 * l2 - n3] = this.coordTrans(h3, o3, s2), a2[2 * l2 + n3] = this.coordTrans(h3, -o3, s2), a2[4 * l2 - n3] = this.coordTrans(o3, -h3, s2), a2[4 * l2 + n3] = this.coordTrans(-o3, -h3, s2), a2[6 * l2 - n3] = this.coordTrans(-h3, -o3, s2), a2[6 * l2 + n3] = this.coordTrans(-h3, o3, s2), a2[8 * l2 - n3] = this.coordTrans(-o3, h3, s2);
          }
          a2[a2.length - 1] = new g(a2[0]);
          const h2 = this._geomFact.createLinearRing(a2), u2 = this._geomFact.createPolygon(h2);
          return this.rotate(u2);
        }
        setNumPoints(t2) {
          this._nPts = t2;
        }
        setBase(t2) {
          this._dim.setBase(t2);
        }
        setRotation(t2) {
          this._rotationAngle = t2;
        }
        setWidth(t2) {
          this._dim.setWidth(t2);
        }
        createEllipse() {
          const t2 = this._dim.getEnvelope(), e2 = t2.getWidth() / 2, n2 = t2.getHeight() / 2, s2 = t2.getMinX() + e2, i2 = t2.getMinY() + n2, r2 = new Array(this._nPts + 1).fill(null);
          let o2 = 0;
          for (let t3 = 0; t3 < this._nPts; t3++) {
            const l3 = t3 * (2 * Math.PI / this._nPts), a3 = e2 * Math.cos(l3) + s2, c2 = n2 * Math.sin(l3) + i2;
            r2[o2++] = this.coord(a3, c2);
          }
          r2[o2] = new g(r2[0]);
          const l2 = this._geomFact.createLinearRing(r2), a2 = this._geomFact.createPolygon(l2);
          return this.rotate(a2);
        }
        coordTrans(t2, e2, n2) {
          return this.coord(t2 + n2.x, e2 + n2.y);
        }
        createSquircle() {
          return this.createSupercircle(4);
        }
        setEnvelope(t2) {
          this._dim.setEnvelope(t2);
        }
        setCentre(t2) {
          this._dim.setCentre(t2);
        }
        createArc(t2, e2) {
          const n2 = this._dim.getEnvelope(), s2 = n2.getWidth() / 2, i2 = n2.getHeight() / 2, r2 = n2.getMinX() + s2, o2 = n2.getMinY() + i2;
          let l2 = e2;
          (l2 <= 0 || l2 > 2 * Math.PI) && (l2 = 2 * Math.PI);
          const a2 = l2 / (this._nPts - 1), c2 = new Array(this._nPts).fill(null);
          let h2 = 0;
          for (let e3 = 0; e3 < this._nPts; e3++) {
            const n3 = t2 + e3 * a2, l3 = s2 * Math.cos(n3) + r2, u3 = i2 * Math.sin(n3) + o2;
            c2[h2++] = this.coord(l3, u3);
          }
          const u2 = this._geomFact.createLineString(c2);
          return this.rotate(u2);
        }
        rotate(t2) {
          if (0 !== this._rotationAngle) {
            const e2 = le.rotationInstance(this._rotationAngle, this._dim.getCentre().x, this._dim.getCentre().y);
            t2.apply(e2);
          }
          return t2;
        }
        coord(t2, e2) {
          const n2 = new g(t2, e2);
          return this._precModel.makePrecise(n2), n2;
        }
        createArcPolygon(t2, e2) {
          const n2 = this._dim.getEnvelope(), s2 = n2.getWidth() / 2, i2 = n2.getHeight() / 2, r2 = n2.getMinX() + s2, o2 = n2.getMinY() + i2;
          let l2 = e2;
          (l2 <= 0 || l2 > 2 * Math.PI) && (l2 = 2 * Math.PI);
          const a2 = l2 / (this._nPts - 1), c2 = new Array(this._nPts + 2).fill(null);
          let h2 = 0;
          c2[h2++] = this.coord(r2, o2);
          for (let e3 = 0; e3 < this._nPts; e3++) {
            const n3 = t2 + a2 * e3, l3 = s2 * Math.cos(n3) + r2, u3 = i2 * Math.sin(n3) + o2;
            c2[h2++] = this.coord(l3, u3);
          }
          c2[h2++] = this.coord(r2, o2);
          const u2 = this._geomFact.createLinearRing(c2), g2 = this._geomFact.createPolygon(u2);
          return this.rotate(g2);
        }
        createRectangle() {
          let t2 = null, e2 = 0, n2 = Math.trunc(this._nPts / 4);
          n2 < 1 && (n2 = 1);
          const s2 = this._dim.getEnvelope().getWidth() / n2, i2 = this._dim.getEnvelope().getHeight() / n2, r2 = new Array(4 * n2 + 1).fill(null), o2 = this._dim.getEnvelope();
          for (t2 = 0; t2 < n2; t2++) {
            const n3 = o2.getMinX() + t2 * s2, i3 = o2.getMinY();
            r2[e2++] = this.coord(n3, i3);
          }
          for (t2 = 0; t2 < n2; t2++) {
            const n3 = o2.getMaxX(), s3 = o2.getMinY() + t2 * i2;
            r2[e2++] = this.coord(n3, s3);
          }
          for (t2 = 0; t2 < n2; t2++) {
            const n3 = o2.getMaxX() - t2 * s2, i3 = o2.getMaxY();
            r2[e2++] = this.coord(n3, i3);
          }
          for (t2 = 0; t2 < n2; t2++) {
            const n3 = o2.getMinX(), s3 = o2.getMaxY() - t2 * i2;
            r2[e2++] = this.coord(n3, s3);
          }
          r2[e2++] = new g(r2[0]);
          const l2 = this._geomFact.createLinearRing(r2), a2 = this._geomFact.createPolygon(l2);
          return this.rotate(a2);
        }
        createCircle() {
          return this.createEllipse();
        }
        setHeight(t2) {
          this._dim.setHeight(t2);
        }
        setSize(t2) {
          this._dim.setSize(t2);
        }
        getClass() {
          return Se;
        }
        get interfaces_() {
          return [];
        }
      }
      class we {
        constructor() {
          we.constructor_.apply(this, arguments);
        }
        setBase(t2) {
          this.base = t2;
        }
        setWidth(t2) {
          this.width = t2;
        }
        getBase() {
          return this.base;
        }
        getWidth() {
          return this.width;
        }
        setEnvelope(t2) {
          this.width = t2.getWidth(), this.height = t2.getHeight(), this.base = new g(t2.getMinX(), t2.getMinY()), this.centre = new g(t2.centre());
        }
        setCentre(t2) {
          this.centre = t2;
        }
        getMinSize() {
          return Math.min(this.width, this.height);
        }
        getEnvelope() {
          return null !== this.base ? new N(this.base.x, this.base.x + this.width, this.base.y, this.base.y + this.height) : null !== this.centre ? new N(this.centre.x - this.width / 2, this.centre.x + this.width / 2, this.centre.y - this.height / 2, this.centre.y + this.height / 2) : new N(0, this.width, 0, this.height);
        }
        getCentre() {
          return null === this.centre && (this.centre = new g(this.base.x + this.width / 2, this.base.y + this.height / 2)), this.centre;
        }
        getHeight() {
          return this.height;
        }
        setHeight(t2) {
          this.height = t2;
        }
        setSize(t2) {
          this.height = t2, this.width = t2;
        }
        getClass() {
          return we;
        }
        get interfaces_() {
          return [];
        }
      }
      we.constructor_ = function() {
        this.base = null, this.centre = null, this.width = null, this.height = null;
      }, Se.Dimensions = we, Se.constructor_ = function() {
        if (this._geomFact = null, this._precModel = null, this._dim = new we(), this._nPts = 100, this._rotationAngle = 0, 0 === arguments.length) Se.constructor_.call(this, new Ht());
        else if (1 === arguments.length) {
          const t2 = arguments[0];
          this._geomFact = t2, this._precModel = t2.getPrecisionModel();
        }
      };
      class Le extends Se {
        constructor() {
          super(), Le.constructor_.apply(this, arguments);
        }
        setNumArms(t2) {
          this._numArms = t2;
        }
        setArmLengthRatio(t2) {
          this._armLengthRatio = t2;
        }
        createSineStar() {
          const t2 = this._dim.getEnvelope(), e2 = t2.getWidth() / 2;
          let n2 = this._armLengthRatio;
          n2 < 0 && (n2 = 0), n2 > 1 && (n2 = 1);
          const s2 = n2 * e2, i2 = (1 - n2) * e2, r2 = t2.getMinX() + e2, o2 = t2.getMinY() + e2, l2 = new Array(this._nPts + 1).fill(null);
          let a2 = 0;
          for (let t3 = 0; t3 < this._nPts; t3++) {
            const e3 = t3 / this._nPts * this._numArms, n3 = e3 - Math.floor(e3), c3 = 2 * Math.PI * n3, h2 = i2 + s2 * ((Math.cos(c3) + 1) / 2), u2 = t3 * (2 * Math.PI / this._nPts), g2 = h2 * Math.cos(u2) + r2, d2 = h2 * Math.sin(u2) + o2;
            l2[a2++] = this.coord(g2, d2);
          }
          l2[a2] = new g(l2[0]);
          const c2 = this._geomFact.createLinearRing(l2);
          return this._geomFact.createPolygon(c2);
        }
        getClass() {
          return Le;
        }
        get interfaces_() {
          return [];
        }
      }
      Le.constructor_ = function() {
        if (this._numArms = 8, this._armLengthRatio = 0.5, 0 === arguments.length) Se.constructor_.call(this);
        else if (1 === arguments.length) {
          const t2 = arguments[0];
          Se.constructor_.call(this, t2);
        }
      };
      var Te = Object.freeze({ __proto__: null, AffineTransformation: le, AffineTransformationBuilder: ce, AffineTransformationFactory: he, ComponentCoordinateExtracter: ue, GeometryCollectionMapper: ge, GeometryCombiner: de, GeometryEditor: Ft, GeometryExtracter: _e, GeometryMapper: pe, GeometryTransformer: me, LineStringExtracter: ye, LinearComponentExtracter: xe, MapOp: fe, PointExtracter: Ie, PolygonExtracter: Ne, ShortCircuitedGeometryVisitor: Ce, SineStarFactory: Le }), Re = Object.freeze({ __proto__: null, Coordinate: g, CoordinateList: I, Envelope: N, LineSegment: ee, GeometryFactory: Ht, Geometry: q, Point: Pt, LineString: Tt, LinearRing: Dt, Polygon: bt, GeometryCollection: _t, MultiPoint: Mt, MultiLineString: ft, MultiPolygon: At, Dimension: ut, IntersectionMatrix: se, PrecisionModel: kt, Location: ne, Triangle: re, util: Te });
      class Pe {
        constructor() {
          Pe.constructor_.apply(this, arguments);
        }
        getCoordinates() {
          return this._pt;
        }
        getCoordinate(t2) {
          return this._pt[t2];
        }
        setMinimum() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            this.setMinimum(t2._pt[0], t2._pt[1]);
          } else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            if (this._isNull) return this.initialize(t2, e2), null;
            const n2 = t2.distance(e2);
            n2 < this._distance && this.initialize(t2, e2, n2);
          }
        }
        initialize() {
          if (0 === arguments.length) this._isNull = true;
          else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            this._pt[0].setCoordinate(t2), this._pt[1].setCoordinate(e2), this._distance = t2.distance(e2), this._isNull = false;
          } else if (3 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
            this._pt[0].setCoordinate(t2), this._pt[1].setCoordinate(e2), this._distance = n2, this._isNull = false;
          }
        }
        toString() {
          return Jt.toLineString(this._pt[0], this._pt[1]);
        }
        getDistance() {
          return this._distance;
        }
        setMaximum() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            this.setMaximum(t2._pt[0], t2._pt[1]);
          } else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            if (this._isNull) return this.initialize(t2, e2), null;
            const n2 = t2.distance(e2);
            n2 > this._distance && this.initialize(t2, e2, n2);
          }
        }
        getClass() {
          return Pe;
        }
        get interfaces_() {
          return [];
        }
      }
      Pe.constructor_ = function() {
        this._pt = [new g(), new g()], this._distance = i.NaN, this._isNull = true;
      };
      class ve {
        constructor() {
          ve.constructor_.apply(this, arguments);
        }
        static computeDistance() {
          if (arguments[2] instanceof Pe && arguments[0] instanceof Tt && arguments[1] instanceof g) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = new ee(), i2 = t2.getCoordinates();
            for (let t3 = 0; t3 < i2.length - 1; t3++) {
              s2.setCoordinates(i2[t3], i2[t3 + 1]);
              const r2 = s2.closestPoint(e2);
              n2.setMinimum(r2, e2);
            }
          } else if (arguments[2] instanceof Pe && arguments[0] instanceof bt && arguments[1] instanceof g) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
            ve.computeDistance(t2.getExteriorRing(), e2, n2);
            for (let s2 = 0; s2 < t2.getNumInteriorRing(); s2++) ve.computeDistance(t2.getInteriorRingN(s2), e2, n2);
          } else if (arguments[2] instanceof Pe && arguments[0] instanceof q && arguments[1] instanceof g) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
            if (t2 instanceof Tt) ve.computeDistance(t2, e2, n2);
            else if (t2 instanceof bt) ve.computeDistance(t2, e2, n2);
            else if (t2 instanceof _t) {
              const s2 = t2;
              for (let t3 = 0; t3 < s2.getNumGeometries(); t3++) {
                const i2 = s2.getGeometryN(t3);
                ve.computeDistance(i2, e2, n2);
              }
            } else n2.setMinimum(t2.getCoordinate(), e2);
          } else if (arguments[2] instanceof Pe && arguments[0] instanceof ee && arguments[1] instanceof g) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = t2.closestPoint(e2);
            n2.setMinimum(s2, e2);
          }
        }
        getClass() {
          return ve;
        }
        get interfaces_() {
          return [];
        }
      }
      ve.constructor_ = function() {
      };
      class Oe {
        constructor() {
          Oe.constructor_.apply(this, arguments);
        }
        static distance() {
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return new Oe(t2, e2).distance();
          }
          if (3 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = new Oe(t2, e2);
            return s2.setDensifyFraction(n2), s2.distance();
          }
        }
        getCoordinates() {
          return this._ptDist.getCoordinates();
        }
        setDensifyFraction(t2) {
          if (t2 > 1 || t2 <= 0) throw new n("Fraction is not in range (0.0 - 1.0]");
          this._densifyFrac = t2;
        }
        compute(t2, e2) {
          this.computeOrientedDistance(t2, e2, this._ptDist), this.computeOrientedDistance(e2, t2, this._ptDist);
        }
        distance() {
          return this.compute(this._g0, this._g1), this._ptDist.getDistance();
        }
        computeOrientedDistance(t2, e2, n2) {
          const s2 = new be(e2);
          if (t2.apply(s2), n2.setMaximum(s2.getMaxPointDistance()), this._densifyFrac > 0) {
            const s3 = new Me(e2, this._densifyFrac);
            t2.apply(s3), n2.setMaximum(s3.getMaxPointDistance());
          }
        }
        orientedDistance() {
          return this.computeOrientedDistance(this._g0, this._g1, this._ptDist), this._ptDist.getDistance();
        }
        getClass() {
          return Oe;
        }
        get interfaces_() {
          return [];
        }
      }
      class be {
        constructor() {
          be.constructor_.apply(this, arguments);
        }
        filter(t2) {
          this._minPtDist.initialize(), ve.computeDistance(this._geom, t2, this._minPtDist), this._maxPtDist.setMaximum(this._minPtDist);
        }
        getMaxPointDistance() {
          return this._maxPtDist;
        }
        getClass() {
          return be;
        }
        get interfaces_() {
          return [B];
        }
      }
      be.constructor_ = function() {
        this._maxPtDist = new Pe(), this._minPtDist = new Pe(), this._euclideanDist = new ve(), this._geom = null;
        const t2 = arguments[0];
        this._geom = t2;
      };
      class Me {
        constructor() {
          Me.constructor_.apply(this, arguments);
        }
        filter(t2, e2) {
          if (0 === e2) return null;
          const n2 = t2.getCoordinate(e2 - 1), s2 = t2.getCoordinate(e2), i2 = (s2.x - n2.x) / this._numSubSegs, r2 = (s2.y - n2.y) / this._numSubSegs;
          for (let t3 = 0; t3 < this._numSubSegs; t3++) {
            const e3 = n2.x + t3 * i2, s3 = n2.y + t3 * r2, o2 = new g(e3, s3);
            this._minPtDist.initialize(), ve.computeDistance(this._geom, o2, this._minPtDist), this._maxPtDist.setMaximum(this._minPtDist);
          }
        }
        isDone() {
          return false;
        }
        isGeometryChanged() {
          return false;
        }
        getMaxPointDistance() {
          return this._maxPtDist;
        }
        getClass() {
          return Me;
        }
        get interfaces_() {
          return [dt];
        }
      }
      Me.constructor_ = function() {
        this._maxPtDist = new Pe(), this._minPtDist = new Pe(), this._geom = null, this._numSubSegs = 0;
        const t2 = arguments[0], e2 = arguments[1];
        this._geom = t2, this._numSubSegs = Math.trunc(Math.round(1 / e2));
      }, Oe.MaxPointDistanceFilter = be, Oe.MaxDensifiedByFractionDistanceFilter = Me, Oe.constructor_ = function() {
        this._g0 = null, this._g1 = null, this._ptDist = new Pe(), this._densifyFrac = 0;
        const t2 = arguments[0], e2 = arguments[1];
        this._g0 = t2, this._g1 = e2;
      };
      var De = Object.freeze({ __proto__: null, DiscreteHausdorffDistance: Oe, DistanceToPoint: ve, PointPairDistance: Pe });
      class Ae {
        constructor() {
          Ae.constructor_.apply(this, arguments);
        }
        visitItem(t2) {
        }
        getClass() {
          return Ae;
        }
        get interfaces_() {
          return [];
        }
      }
      Ae.constructor_ = function() {
      };
      class Fe {
        constructor() {
          Fe.constructor_.apply(this, arguments);
        }
        locate(t2) {
        }
        getClass() {
          return Fe;
        }
        get interfaces_() {
          return [];
        }
      }
      Fe.constructor_ = function() {
      };
      class Ge {
        constructor() {
          Ge.constructor_.apply(this, arguments);
        }
        getMin() {
          return this._min;
        }
        intersects(t2, e2) {
          return !(this._min > e2 || this._max < t2);
        }
        getMax() {
          return this._max;
        }
        toString() {
          return Jt.toLineString(new g(this._min, 0), new g(this._max, 0));
        }
        getClass() {
          return Ge;
        }
        get interfaces_() {
          return [];
        }
      }
      class qe {
        constructor() {
          qe.constructor_.apply(this, arguments);
        }
        compare(t2, e2) {
          const n2 = t2, s2 = e2, i2 = (n2._min + n2._max) / 2, r2 = (s2._min + s2._max) / 2;
          return i2 < r2 ? -1 : i2 > r2 ? 1 : 0;
        }
        getClass() {
          return qe;
        }
        get interfaces_() {
          return [l];
        }
      }
      qe.constructor_ = function() {
      }, Ge.NodeComparator = qe, Ge.constructor_ = function() {
        this._min = i.POSITIVE_INFINITY, this._max = i.NEGATIVE_INFINITY;
      };
      class Be extends Ge {
        constructor() {
          super(), Be.constructor_.apply(this, arguments);
        }
        query(t2, e2, n2) {
          if (!this.intersects(t2, e2)) return null;
          n2.visitItem(this._item);
        }
        getClass() {
          return Be;
        }
        get interfaces_() {
          return [];
        }
      }
      Be.constructor_ = function() {
        this._item = null;
        const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
        this._min = t2, this._max = e2, this._item = n2;
      };
      class Ve extends Ge {
        constructor() {
          super(), Ve.constructor_.apply(this, arguments);
        }
        buildExtent(t2, e2) {
          this._min = Math.min(t2._min, e2._min), this._max = Math.max(t2._max, e2._max);
        }
        query(t2, e2, n2) {
          if (!this.intersects(t2, e2)) return null;
          null !== this._node1 && this._node1.query(t2, e2, n2), null !== this._node2 && this._node2.query(t2, e2, n2);
        }
        getClass() {
          return Ve;
        }
        get interfaces_() {
          return [];
        }
      }
      Ve.constructor_ = function() {
        this._node1 = null, this._node2 = null;
        const t2 = arguments[0], e2 = arguments[1];
        this._node1 = t2, this._node2 = e2, this.buildExtent(this._node1, this._node2);
      };
      class ze {
        constructor() {
          ze.constructor_.apply(this, arguments);
        }
        buildTree() {
          Ee.sort(this._leaves, new Ge.NodeComparator());
          let t2 = this._leaves, e2 = null, n2 = new x();
          for (; ; ) {
            if (this.buildLevel(t2, n2), 1 === n2.size()) return n2.get(0);
            e2 = t2, t2 = n2, n2 = e2;
          }
        }
        insert(t2, e2, n2) {
          if (null !== this._root) throw new IllegalStateException("Index cannot be added to once it has been queried");
          this._leaves.add(new Be(t2, e2, n2));
        }
        query(t2, e2, n2) {
          this.init(), this._root.query(t2, e2, n2);
        }
        buildRoot() {
          if (null !== this._root) return null;
          this._root = this.buildTree();
        }
        printNode(t2) {
          O.out.println(Jt.toLineString(new g(t2._min, this._level), new g(t2._max, this._level)));
        }
        init() {
          if (null !== this._root) return null;
          this.buildRoot();
        }
        buildLevel(t2, e2) {
          this._level++, e2.clear();
          for (let n2 = 0; n2 < t2.size(); n2 += 2) {
            const s2 = t2.get(n2);
            if (null === (n2 + 1 < t2.size() ? t2.get(n2) : null)) e2.add(s2);
            else {
              const s3 = new Ve(t2.get(n2), t2.get(n2 + 1));
              e2.add(s3);
            }
          }
        }
        getClass() {
          return ze;
        }
        get interfaces_() {
          return [];
        }
      }
      ze.constructor_ = function() {
        this._leaves = new x(), this._root = null, this._level = 0;
      };
      class Ye {
        constructor() {
          Ye.constructor_.apply(this, arguments);
        }
        visitItem(t2) {
          this._items.add(t2);
        }
        getItems() {
          return this._items;
        }
        getClass() {
          return Ye;
        }
        get interfaces_() {
          return [Ae];
        }
      }
      Ye.constructor_ = function() {
        this._items = new x();
      };
      class Ue {
        constructor() {
          Ue.constructor_.apply(this, arguments);
        }
        static locatePointInRing() {
          if (arguments[0] instanceof g && _(arguments[1], A)) {
            const t2 = arguments[0], e2 = arguments[1], n2 = new Ue(t2), s2 = new g(), i2 = new g();
            for (let t3 = 1; t3 < e2.size(); t3++) if (e2.getCoordinate(t3, s2), e2.getCoordinate(t3 - 1, i2), n2.countSegment(s2, i2), n2.isOnSegment()) return n2.getLocation();
            return n2.getLocation();
          }
          if (arguments[0] instanceof g && arguments[1] instanceof Array) {
            const t2 = arguments[0], e2 = arguments[1], n2 = new Ue(t2);
            for (let t3 = 1; t3 < e2.length; t3++) {
              const s2 = e2[t3], i2 = e2[t3 - 1];
              if (n2.countSegment(s2, i2), n2.isOnSegment()) return n2.getLocation();
            }
            return n2.getLocation();
          }
        }
        countSegment(t2, e2) {
          if (t2.x < this._p.x && e2.x < this._p.x) return null;
          if (this._p.x === e2.x && this._p.y === e2.y) return this._isPointOnSegment = true, null;
          if (t2.y === this._p.y && e2.y === this._p.y) {
            let n2 = t2.x, s2 = e2.x;
            return n2 > s2 && (n2 = e2.x, s2 = t2.x), this._p.x >= n2 && this._p.x <= s2 && (this._isPointOnSegment = true), null;
          }
          if (t2.y > this._p.y && e2.y <= this._p.y || e2.y > this._p.y && t2.y <= this._p.y) {
            let n2 = v.index(t2, e2, this._p);
            if (n2 === v.COLLINEAR) return this._isPointOnSegment = true, null;
            e2.y < t2.y && (n2 = -n2), n2 === v.LEFT && this._crossingCount++;
          }
        }
        isPointInPolygon() {
          return this.getLocation() !== ne.EXTERIOR;
        }
        getLocation() {
          return this._isPointOnSegment ? ne.BOUNDARY : this._crossingCount % 2 == 1 ? ne.INTERIOR : ne.EXTERIOR;
        }
        isOnSegment() {
          return this._isPointOnSegment;
        }
        getClass() {
          return Ue;
        }
        get interfaces_() {
          return [];
        }
      }
      Ue.constructor_ = function() {
        this._p = null, this._crossingCount = 0, this._isPointOnSegment = false;
        const t2 = arguments[0];
        this._p = t2;
      };
      class ke {
        constructor() {
          ke.constructor_.apply(this, arguments);
        }
        locate(t2) {
          const e2 = new Ue(t2), n2 = new Xe(e2);
          return this._index.query(t2.y, t2.y, n2), e2.getLocation();
        }
        getClass() {
          return ke;
        }
        get interfaces_() {
          return [Fe];
        }
      }
      class Xe {
        constructor() {
          Xe.constructor_.apply(this, arguments);
        }
        visitItem(t2) {
          const e2 = t2;
          this._counter.countSegment(e2.getCoordinate(0), e2.getCoordinate(1));
        }
        getClass() {
          return Xe;
        }
        get interfaces_() {
          return [Ae];
        }
      }
      Xe.constructor_ = function() {
        this._counter = null;
        const t2 = arguments[0];
        this._counter = t2;
      };
      class He {
        constructor() {
          He.constructor_.apply(this, arguments);
        }
        init(t2) {
          for (let e2 = xe.getLines(t2).iterator(); e2.hasNext(); ) {
            const t3 = e2.next().getCoordinates();
            this.addLine(t3);
          }
        }
        addLine(t2) {
          for (let e2 = 1; e2 < t2.length; e2++) {
            const n2 = new ee(t2[e2 - 1], t2[e2]), s2 = Math.min(n2.p0.y, n2.p1.y), i2 = Math.max(n2.p0.y, n2.p1.y);
            this._index.insert(s2, i2, n2);
          }
        }
        query() {
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = new Ye();
            return this._index.query(t2, e2, n2), n2.getItems();
          }
          if (3 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
            this._index.query(t2, e2, n2);
          }
        }
        getClass() {
          return He;
        }
        get interfaces_() {
          return [];
        }
      }
      He.constructor_ = function() {
        this._index = new ze();
        const t2 = arguments[0];
        this.init(t2);
      }, ke.SegmentVisitor = Xe, ke.IntervalIndexedGeometry = He, ke.constructor_ = function() {
        this._index = null;
        const t2 = arguments[0];
        if (!(_(t2, Ot) || t2 instanceof Dt)) throw new n("Argument must be Polygonal or LinearRing");
        this._index = new He(t2);
      };
      class We {
        constructor() {
          We.constructor_.apply(this, arguments);
        }
        static isOnLine() {
          if (arguments[0] instanceof g && _(arguments[1], A)) {
            const t2 = arguments[0], e2 = arguments[1], n2 = new te(), s2 = new g(), i2 = new g(), r2 = e2.size();
            for (let o2 = 1; o2 < r2; o2++) if (e2.getCoordinate(o2 - 1, s2), e2.getCoordinate(o2, i2), n2.computeIntersection(t2, s2, i2), n2.hasIntersection()) return true;
            return false;
          }
          if (arguments[0] instanceof g && arguments[1] instanceof Array) {
            const t2 = arguments[0], e2 = arguments[1], n2 = new te();
            for (let s2 = 1; s2 < e2.length; s2++) {
              const i2 = e2[s2 - 1], r2 = e2[s2];
              if (n2.computeIntersection(t2, i2, r2), n2.hasIntersection()) return true;
            }
            return false;
          }
        }
        static locateInRing(t2, e2) {
          return Ue.locatePointInRing(t2, e2);
        }
        static isInRing(t2, e2) {
          return We.locateInRing(t2, e2) !== ne.EXTERIOR;
        }
        getClass() {
          return We;
        }
        get interfaces_() {
          return [];
        }
      }
      function je() {
      }
      We.constructor_ = function() {
      }, je.prototype.hasNext = function() {
      }, je.prototype.next = function() {
      }, je.prototype.remove = function() {
      };
      class Ke {
        constructor() {
          Ke.constructor_.apply(this, arguments);
        }
        static isAtomic(t2) {
          return !(t2 instanceof _t);
        }
        next() {
          if (this._atStart) return this._atStart = false, Ke.isAtomic(this._parent) && this._index++, this._parent;
          if (null !== this._subcollectionIterator) {
            if (this._subcollectionIterator.hasNext()) return this._subcollectionIterator.next();
            this._subcollectionIterator = null;
          }
          if (this._index >= this._max) throw new y();
          const t2 = this._parent.getGeometryN(this._index++);
          return t2 instanceof _t ? (this._subcollectionIterator = new Ke(t2), this._subcollectionIterator.next()) : t2;
        }
        remove() {
          throw new Z(this.getClass().getName());
        }
        hasNext() {
          if (this._atStart) return true;
          if (null !== this._subcollectionIterator) {
            if (this._subcollectionIterator.hasNext()) return true;
            this._subcollectionIterator = null;
          }
          return !(this._index >= this._max);
        }
        getClass() {
          return Ke;
        }
        get interfaces_() {
          return [je];
        }
      }
      Ke.constructor_ = function() {
        this._parent = null, this._atStart = null, this._max = null, this._index = null, this._subcollectionIterator = null;
        const t2 = arguments[0];
        this._parent = t2, this._atStart = true, this._index = 0, this._max = t2.getNumGeometries();
      };
      class Ze {
        constructor() {
          Ze.constructor_.apply(this, arguments);
        }
        static locatePointInPolygon(t2, e2) {
          if (e2.isEmpty()) return ne.EXTERIOR;
          const n2 = e2.getExteriorRing(), s2 = Ze.locatePointInRing(t2, n2);
          if (s2 !== ne.INTERIOR) return s2;
          for (let n3 = 0; n3 < e2.getNumInteriorRing(); n3++) {
            const s3 = e2.getInteriorRingN(n3), i2 = Ze.locatePointInRing(t2, s3);
            if (i2 === ne.BOUNDARY) return ne.BOUNDARY;
            if (i2 === ne.INTERIOR) return ne.EXTERIOR;
          }
          return ne.INTERIOR;
        }
        static locatePointInRing(t2, e2) {
          return e2.getEnvelopeInternal().intersects(t2) ? We.locateInRing(t2, e2.getCoordinates()) : ne.EXTERIOR;
        }
        static containsPointInPolygon(t2, e2) {
          return ne.EXTERIOR !== Ze.locatePointInPolygon(t2, e2);
        }
        static locateInGeometry(t2, e2) {
          if (e2 instanceof bt) return Ze.locatePointInPolygon(t2, e2);
          if (e2 instanceof _t) {
            const n2 = new Ke(e2);
            for (; n2.hasNext(); ) {
              const s2 = n2.next();
              if (s2 !== e2) {
                const e3 = Ze.locateInGeometry(t2, s2);
                if (e3 !== ne.EXTERIOR) return e3;
              }
            }
          }
          return ne.EXTERIOR;
        }
        static locate(t2, e2) {
          return e2.isEmpty() ? ne.EXTERIOR : Ze.locateInGeometry(t2, e2);
        }
        locate(t2) {
          return Ze.locate(t2, this._geom);
        }
        getClass() {
          return Ze;
        }
        get interfaces_() {
          return [Fe];
        }
      }
      Ze.constructor_ = function() {
        this._geom = null;
        const t2 = arguments[0];
        this._geom = t2;
      };
      var Qe = Object.freeze({ __proto__: null, IndexedPointInAreaLocator: ke, PointOnGeometryLocator: Fe, SimplePointInAreaLocator: Ze });
      class Je {
        constructor() {
          Je.constructor_.apply(this, arguments);
        }
        measure(t2, e2) {
        }
        getClass() {
          return Je;
        }
        get interfaces_() {
          return [];
        }
      }
      Je.constructor_ = function() {
      };
      class $e {
        constructor() {
          $e.constructor_.apply(this, arguments);
        }
        measure(t2, e2) {
          return t2.intersection(e2).getArea() / t2.union(e2).getArea();
        }
        getClass() {
          return $e;
        }
        get interfaces_() {
          return [Je];
        }
      }
      $e.constructor_ = function() {
      };
      class tn {
        constructor() {
          tn.constructor_.apply(this, arguments);
        }
        static diagonalSize(t2) {
          if (t2.isNull()) return 0;
          const e2 = t2.getWidth(), n2 = t2.getHeight();
          return Math.sqrt(e2 * e2 + n2 * n2);
        }
        measure(t2, e2) {
          const n2 = Oe.distance(t2, e2, tn.DENSIFY_FRACTION), s2 = new N(t2.getEnvelopeInternal());
          return s2.expandToInclude(e2.getEnvelopeInternal()), 1 - n2 / tn.diagonalSize(s2);
        }
        getClass() {
          return tn;
        }
        get interfaces_() {
          return [Je];
        }
      }
      tn.constructor_ = function() {
      }, tn.DENSIFY_FRACTION = 0.25;
      class en {
        constructor() {
          en.constructor_.apply(this, arguments);
        }
        static combine(t2, e2) {
          return Math.min(t2, e2);
        }
        getClass() {
          return en;
        }
        get interfaces_() {
          return [];
        }
      }
      en.constructor_ = function() {
      };
      var nn = Object.freeze({ __proto__: null, AreaSimilarityMeasure: $e, HausdorffSimilarityMeasure: tn, SimilarityMeasure: Je, SimilarityMeasureCombiner: en });
      class sn {
        constructor() {
          sn.constructor_.apply(this, arguments);
        }
        static area2(t2, e2, n2) {
          return (e2.x - t2.x) * (n2.y - t2.y) - (n2.x - t2.x) * (e2.y - t2.y);
        }
        static centroid3(t2, e2, n2, s2) {
          return s2.x = t2.x + e2.x + n2.x, s2.y = t2.y + e2.y + n2.y, null;
        }
        static getCentroid(t2) {
          return new sn(t2).getCentroid();
        }
        setAreaBasePoint(t2) {
          this._areaBasePt = t2;
        }
        addPoint(t2) {
          this._ptCount += 1, this._ptCentSum.x += t2.x, this._ptCentSum.y += t2.y;
        }
        addLineSegments(t2) {
          let e2 = 0;
          for (let n2 = 0; n2 < t2.length - 1; n2++) {
            const s2 = t2[n2].distance(t2[n2 + 1]);
            if (0 === s2) continue;
            e2 += s2;
            const i2 = (t2[n2].x + t2[n2 + 1].x) / 2;
            this._lineCentSum.x += s2 * i2;
            const r2 = (t2[n2].y + t2[n2 + 1].y) / 2;
            this._lineCentSum.y += s2 * r2;
          }
          this._totalLength += e2, 0 === e2 && t2.length > 0 && this.addPoint(t2[0]);
        }
        addHole(t2) {
          const e2 = v.isCCW(t2);
          for (let n2 = 0; n2 < t2.length - 1; n2++) this.addTriangle(this._areaBasePt, t2[n2], t2[n2 + 1], e2);
          this.addLineSegments(t2);
        }
        getCentroid() {
          const t2 = new g();
          if (Math.abs(this._areasum2) > 0) t2.x = this._cg3.x / 3 / this._areasum2, t2.y = this._cg3.y / 3 / this._areasum2;
          else if (this._totalLength > 0) t2.x = this._lineCentSum.x / this._totalLength, t2.y = this._lineCentSum.y / this._totalLength;
          else {
            if (!(this._ptCount > 0)) return null;
            t2.x = this._ptCentSum.x / this._ptCount, t2.y = this._ptCentSum.y / this._ptCount;
          }
          return t2;
        }
        addShell(t2) {
          t2.length > 0 && this.setAreaBasePoint(t2[0]);
          const e2 = !v.isCCW(t2);
          for (let n2 = 0; n2 < t2.length - 1; n2++) this.addTriangle(this._areaBasePt, t2[n2], t2[n2 + 1], e2);
          this.addLineSegments(t2);
        }
        addTriangle(t2, e2, n2, s2) {
          const i2 = s2 ? 1 : -1;
          sn.centroid3(t2, e2, n2, this._triangleCent3);
          const r2 = sn.area2(t2, e2, n2);
          this._cg3.x += i2 * r2 * this._triangleCent3.x, this._cg3.y += i2 * r2 * this._triangleCent3.y, this._areasum2 += i2 * r2;
        }
        add() {
          if (arguments[0] instanceof bt) {
            const t2 = arguments[0];
            this.addShell(t2.getExteriorRing().getCoordinates());
            for (let e2 = 0; e2 < t2.getNumInteriorRing(); e2++) this.addHole(t2.getInteriorRingN(e2).getCoordinates());
          } else if (arguments[0] instanceof q) {
            const t2 = arguments[0];
            if (t2.isEmpty()) return null;
            if (t2 instanceof Pt) this.addPoint(t2.getCoordinate());
            else if (t2 instanceof Tt) this.addLineSegments(t2.getCoordinates());
            else if (t2 instanceof bt) {
              const e2 = t2;
              this.add(e2);
            } else if (t2 instanceof _t) {
              const e2 = t2;
              for (let t3 = 0; t3 < e2.getNumGeometries(); t3++) this.add(e2.getGeometryN(t3));
            }
          }
        }
        getClass() {
          return sn;
        }
        get interfaces_() {
          return [];
        }
      }
      function rn(t2) {
        this.message = t2 || "";
      }
      function on() {
        this.array_ = [];
      }
      sn.constructor_ = function() {
        this._areaBasePt = null, this._triangleCent3 = new g(), this._areasum2 = 0, this._cg3 = new g(), this._lineCentSum = new g(), this._totalLength = 0, this._ptCount = 0, this._ptCentSum = new g();
        const t2 = arguments[0];
        this._areaBasePt = null, this.add(t2);
      }, rn.prototype = new Error(), rn.prototype.name = "EmptyStackException", on.prototype = new m(), on.prototype.add = function(t2) {
        return this.array_.push(t2), true;
      }, on.prototype.get = function(t2) {
        if (t2 < 0 || t2 >= this.size()) throw new p();
        return this.array_[t2];
      }, on.prototype.push = function(t2) {
        return this.array_.push(t2), t2;
      }, on.prototype.pop = function(t2) {
        if (0 === this.array_.length) throw new rn();
        return this.array_.pop();
      }, on.prototype.peek = function() {
        if (0 === this.array_.length) throw new rn();
        return this.array_[this.array_.length - 1];
      }, on.prototype.empty = function() {
        return 0 === this.array_.length;
      }, on.prototype.isEmpty = function() {
        return this.empty();
      }, on.prototype.search = function(t2) {
        return this.array_.indexOf(t2);
      }, on.prototype.size = function() {
        return this.array_.length;
      }, on.prototype.toArray = function() {
        for (var t2 = [], e2 = 0, n2 = this.array_.length; e2 < n2; e2++) t2.push(this.array_[e2]);
        return t2;
      };
      class ln {
        constructor() {
          ln.constructor_.apply(this, arguments);
        }
        static filterCoordinates(t2) {
          const e2 = new ln();
          for (let n2 = 0; n2 < t2.length; n2++) e2.filter(t2[n2]);
          return e2.getCoordinates();
        }
        filter(t2) {
          this.treeSet.contains(t2) || (this.list.add(t2), this.treeSet.add(t2));
        }
        getCoordinates() {
          const t2 = new Array(this.list.size()).fill(null);
          return this.list.toArray(t2);
        }
        getClass() {
          return ln;
        }
        get interfaces_() {
          return [B];
        }
      }
      ln.constructor_ = function() {
        this.treeSet = new at(), this.list = new x();
      };
      class an {
        constructor() {
          an.constructor_.apply(this, arguments);
        }
        static extractCoordinates(t2) {
          const e2 = new ln();
          return t2.apply(e2), e2.getCoordinates();
        }
        preSort(t2) {
          let e2 = null;
          for (let n2 = 1; n2 < t2.length; n2++) (t2[n2].y < t2[0].y || t2[n2].y === t2[0].y && t2[n2].x < t2[0].x) && (e2 = t2[0], t2[0] = t2[n2], t2[n2] = e2);
          return ht.sort(t2, 1, t2.length, new cn(t2[0])), t2;
        }
        computeOctRing(t2) {
          const e2 = this.computeOctPts(t2), n2 = new I();
          return n2.add(e2, false), n2.size() < 3 ? null : (n2.closeRing(), n2.toCoordinateArray());
        }
        lineOrPolygon(t2) {
          if (3 === (t2 = this.cleanRing(t2)).length) return this._geomFactory.createLineString([t2[0], t2[1]]);
          const e2 = this._geomFactory.createLinearRing(t2);
          return this._geomFactory.createPolygon(e2);
        }
        cleanRing(t2) {
          u.equals(t2[0], t2[t2.length - 1]);
          const e2 = new x();
          let n2 = null;
          for (let s3 = 0; s3 <= t2.length - 2; s3++) {
            const i2 = t2[s3], r2 = t2[s3 + 1];
            i2.equals(r2) || (null !== n2 && this.isBetween(n2, i2, r2) || (e2.add(i2), n2 = i2));
          }
          e2.add(t2[t2.length - 1]);
          const s2 = new Array(e2.size()).fill(null);
          return e2.toArray(s2);
        }
        isBetween(t2, e2, n2) {
          if (0 !== v.index(t2, e2, n2)) return false;
          if (t2.x !== n2.x) {
            if (t2.x <= e2.x && e2.x <= n2.x) return true;
            if (n2.x <= e2.x && e2.x <= t2.x) return true;
          }
          if (t2.y !== n2.y) {
            if (t2.y <= e2.y && e2.y <= n2.y) return true;
            if (n2.y <= e2.y && e2.y <= t2.y) return true;
          }
          return false;
        }
        reduce(t2) {
          const e2 = this.computeOctRing(t2);
          if (null === e2) return t2;
          const n2 = new at();
          for (let t3 = 0; t3 < e2.length; t3++) n2.add(e2[t3]);
          for (let s3 = 0; s3 < t2.length; s3++) We.isInRing(t2[s3], e2) || n2.add(t2[s3]);
          const s2 = X.toCoordinateArray(n2);
          return s2.length < 3 ? this.padArray3(s2) : s2;
        }
        getConvexHull() {
          if (0 === this._inputPts.length) return this._geomFactory.createGeometryCollection();
          if (1 === this._inputPts.length) return this._geomFactory.createPoint(this._inputPts[0]);
          if (2 === this._inputPts.length) return this._geomFactory.createLineString(this._inputPts);
          let t2 = this._inputPts;
          this._inputPts.length > 50 && (t2 = this.reduce(this._inputPts));
          const e2 = this.preSort(t2), n2 = this.grahamScan(e2), s2 = this.toCoordinateArray(n2);
          return this.lineOrPolygon(s2);
        }
        padArray3(t2) {
          const e2 = new Array(3).fill(null);
          for (let n2 = 0; n2 < e2.length; n2++) n2 < t2.length ? e2[n2] = t2[n2] : e2[n2] = t2[0];
          return e2;
        }
        computeOctPts(t2) {
          const e2 = new Array(8).fill(null);
          for (let n2 = 0; n2 < e2.length; n2++) e2[n2] = t2[0];
          for (let n2 = 1; n2 < t2.length; n2++) t2[n2].x < e2[0].x && (e2[0] = t2[n2]), t2[n2].x - t2[n2].y < e2[1].x - e2[1].y && (e2[1] = t2[n2]), t2[n2].y > e2[2].y && (e2[2] = t2[n2]), t2[n2].x + t2[n2].y > e2[3].x + e2[3].y && (e2[3] = t2[n2]), t2[n2].x > e2[4].x && (e2[4] = t2[n2]), t2[n2].x - t2[n2].y > e2[5].x - e2[5].y && (e2[5] = t2[n2]), t2[n2].y < e2[6].y && (e2[6] = t2[n2]), t2[n2].x + t2[n2].y < e2[7].x + e2[7].y && (e2[7] = t2[n2]);
          return e2;
        }
        toCoordinateArray(t2) {
          const e2 = new Array(t2.size()).fill(null);
          for (let n2 = 0; n2 < t2.size(); n2++) {
            const s2 = t2.get(n2);
            e2[n2] = s2;
          }
          return e2;
        }
        grahamScan(t2) {
          let e2 = null;
          const n2 = new on();
          n2.push(t2[0]), n2.push(t2[1]), n2.push(t2[2]);
          for (let s2 = 3; s2 < t2.length; s2++) {
            for (e2 = n2.pop(); !n2.empty() && v.index(n2.peek(), e2, t2[s2]) > 0; ) e2 = n2.pop();
            n2.push(e2), n2.push(t2[s2]);
          }
          return n2.push(t2[0]), n2;
        }
        getClass() {
          return an;
        }
        get interfaces_() {
          return [];
        }
      }
      class cn {
        constructor() {
          cn.constructor_.apply(this, arguments);
        }
        static polarCompare(t2, e2, n2) {
          const s2 = e2.x - t2.x, i2 = e2.y - t2.y, r2 = n2.x - t2.x, o2 = n2.y - t2.y, l2 = v.index(t2, e2, n2);
          if (l2 === v.COUNTERCLOCKWISE) return 1;
          if (l2 === v.CLOCKWISE) return -1;
          const a2 = s2 * s2 + i2 * i2, c2 = r2 * r2 + o2 * o2;
          return a2 < c2 ? -1 : a2 > c2 ? 1 : 0;
        }
        compare(t2, e2) {
          const n2 = t2, s2 = e2;
          return cn.polarCompare(this._origin, n2, s2);
        }
        getClass() {
          return cn;
        }
        get interfaces_() {
          return [l];
        }
      }
      cn.constructor_ = function() {
        this._origin = null;
        const t2 = arguments[0];
        this._origin = t2;
      }, an.RadialComparator = cn, an.constructor_ = function() {
        if (this._geomFactory = null, this._inputPts = null, 1 === arguments.length) {
          const t2 = arguments[0];
          an.constructor_.call(this, an.extractCoordinates(t2), t2.getFactory());
        } else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          this._inputPts = ln.filterCoordinates(t2), this._geomFactory = e2;
        }
      };
      class hn {
        constructor() {
          hn.constructor_.apply(this, arguments);
        }
        static centre(t2) {
          return new g(hn.avg(t2.getMinX(), t2.getMaxX()), hn.avg(t2.getMinY(), t2.getMaxY()));
        }
        static avg(t2, e2) {
          return (t2 + e2) / 2;
        }
        addPolygon(t2) {
          if (t2.isEmpty()) return null;
          let e2 = null, n2 = null;
          const s2 = this.horizontalBisector(t2);
          if (0 === s2.getLength()) n2 = 0, e2 = s2.getCoordinate();
          else {
            const i2 = s2.intersection(t2), r2 = this.widestGeometry(i2);
            n2 = r2.getEnvelopeInternal().getWidth(), e2 = hn.centre(r2.getEnvelopeInternal());
          }
          (null === this._interiorPoint || n2 > this._maxWidth) && (this._interiorPoint = e2, this._maxWidth = n2);
        }
        getInteriorPoint() {
          return this._interiorPoint;
        }
        widestGeometry() {
          if (arguments[0] instanceof _t) {
            const t2 = arguments[0];
            if (t2.isEmpty()) return t2;
            let e2 = t2.getGeometryN(0);
            for (let n2 = 1; n2 < t2.getNumGeometries(); n2++) t2.getGeometryN(n2).getEnvelopeInternal().getWidth() > e2.getEnvelopeInternal().getWidth() && (e2 = t2.getGeometryN(n2));
            return e2;
          }
          if (arguments[0] instanceof q) {
            const t2 = arguments[0];
            return t2 instanceof _t ? this.widestGeometry(t2) : t2;
          }
        }
        horizontalBisector(t2) {
          const e2 = t2.getEnvelopeInternal(), n2 = un.getBisectorY(t2);
          return this._factory.createLineString([new g(e2.getMinX(), n2), new g(e2.getMaxX(), n2)]);
        }
        add(t2) {
          if (t2 instanceof bt) this.addPolygon(t2);
          else if (t2 instanceof _t) {
            const e2 = t2;
            for (let t3 = 0; t3 < e2.getNumGeometries(); t3++) this.add(e2.getGeometryN(t3));
          }
        }
        getClass() {
          return hn;
        }
        get interfaces_() {
          return [];
        }
      }
      class un {
        constructor() {
          un.constructor_.apply(this, arguments);
        }
        static getBisectorY(t2) {
          return new un(t2).getBisectorY();
        }
        updateInterval(t2) {
          t2 <= this._centreY ? t2 > this._loY && (this._loY = t2) : t2 > this._centreY && t2 < this._hiY && (this._hiY = t2);
        }
        getBisectorY() {
          this.process(this._poly.getExteriorRing());
          for (let t2 = 0; t2 < this._poly.getNumInteriorRing(); t2++) this.process(this._poly.getInteriorRingN(t2));
          return hn.avg(this._hiY, this._loY);
        }
        process(t2) {
          const e2 = t2.getCoordinateSequence();
          for (let t3 = 0; t3 < e2.size(); t3++) {
            const n2 = e2.getY(t3);
            this.updateInterval(n2);
          }
        }
        getClass() {
          return un;
        }
        get interfaces_() {
          return [];
        }
      }
      un.constructor_ = function() {
        this._poly = null, this._centreY = null, this._hiY = i.MAX_VALUE, this._loY = -i.MAX_VALUE;
        const t2 = arguments[0];
        this._poly = t2, this._hiY = t2.getEnvelopeInternal().getMaxY(), this._loY = t2.getEnvelopeInternal().getMinY(), this._centreY = hn.avg(this._loY, this._hiY);
      }, hn.SafeBisectorFinder = un, hn.constructor_ = function() {
        this._factory = null, this._interiorPoint = null, this._maxWidth = 0;
        const t2 = arguments[0];
        this._factory = t2.getFactory(), this.add(t2);
      };
      class gn {
        constructor() {
          gn.constructor_.apply(this, arguments);
        }
        addEndpoints() {
          if (arguments[0] instanceof q) {
            const t2 = arguments[0];
            if (t2 instanceof Tt) this.addEndpoints(t2.getCoordinates());
            else if (t2 instanceof _t) {
              const e2 = t2;
              for (let t3 = 0; t3 < e2.getNumGeometries(); t3++) this.addEndpoints(e2.getGeometryN(t3));
            }
          } else if (arguments[0] instanceof Array) {
            const t2 = arguments[0];
            this.add(t2[0]), this.add(t2[t2.length - 1]);
          }
        }
        getInteriorPoint() {
          return this._interiorPoint;
        }
        addInterior() {
          if (arguments[0] instanceof q) {
            const t2 = arguments[0];
            if (t2 instanceof Tt) this.addInterior(t2.getCoordinates());
            else if (t2 instanceof _t) {
              const e2 = t2;
              for (let t3 = 0; t3 < e2.getNumGeometries(); t3++) this.addInterior(e2.getGeometryN(t3));
            }
          } else if (arguments[0] instanceof Array) {
            const t2 = arguments[0];
            for (let e2 = 1; e2 < t2.length - 1; e2++) this.add(t2[e2]);
          }
        }
        add(t2) {
          const e2 = t2.distance(this._centroid);
          e2 < this._minDistance && (this._interiorPoint = new g(t2), this._minDistance = e2);
        }
        getClass() {
          return gn;
        }
        get interfaces_() {
          return [];
        }
      }
      gn.constructor_ = function() {
        this._centroid = null, this._minDistance = i.MAX_VALUE, this._interiorPoint = null;
        const t2 = arguments[0];
        t2.isEmpty() ? this._centroid = new g() : this._centroid = sn.getCentroid(t2), this.addInterior(t2), null === this._interiorPoint && this.addEndpoints(t2);
      };
      class dn {
        constructor() {
          dn.constructor_.apply(this, arguments);
        }
        getInteriorPoint() {
          return this._interiorPoint;
        }
        add() {
          if (arguments[0] instanceof q) {
            const t2 = arguments[0];
            if (t2 instanceof Pt) this.add(t2.getCoordinate());
            else if (t2 instanceof _t) {
              const e2 = t2;
              for (let t3 = 0; t3 < e2.getNumGeometries(); t3++) this.add(e2.getGeometryN(t3));
            }
          } else if (arguments[0] instanceof g) {
            const t2 = arguments[0], e2 = t2.distance(this._centroid);
            e2 < this._minDistance && (this._interiorPoint = new g(t2), this._minDistance = e2);
          }
        }
        getClass() {
          return dn;
        }
        get interfaces_() {
          return [];
        }
      }
      dn.constructor_ = function() {
        this._centroid = null, this._minDistance = i.MAX_VALUE, this._interiorPoint = null;
        const t2 = arguments[0];
        this._centroid = t2.getCentroid().getCoordinate(), this.add(t2);
      };
      class _n {
        constructor() {
          _n.constructor_.apply(this, arguments);
        }
        locateInPolygonRing(t2, e2) {
          return e2.getEnvelopeInternal().intersects(t2) ? We.locateInRing(t2, e2.getCoordinates()) : ne.EXTERIOR;
        }
        intersects(t2, e2) {
          return this.locate(t2, e2) !== ne.EXTERIOR;
        }
        updateLocationInfo(t2) {
          t2 === ne.INTERIOR && (this._isIn = true), t2 === ne.BOUNDARY && this._numBoundaries++;
        }
        computeLocation(t2, e2) {
          if (e2 instanceof Pt && this.updateLocationInfo(this.locateOnPoint(t2, e2)), e2 instanceof Tt) this.updateLocationInfo(this.locateOnLineString(t2, e2));
          else if (e2 instanceof bt) this.updateLocationInfo(this.locateInPolygon(t2, e2));
          else if (e2 instanceof ft) {
            const n2 = e2;
            for (let e3 = 0; e3 < n2.getNumGeometries(); e3++) {
              const s2 = n2.getGeometryN(e3);
              this.updateLocationInfo(this.locateOnLineString(t2, s2));
            }
          } else if (e2 instanceof At) {
            const n2 = e2;
            for (let e3 = 0; e3 < n2.getNumGeometries(); e3++) {
              const s2 = n2.getGeometryN(e3);
              this.updateLocationInfo(this.locateInPolygon(t2, s2));
            }
          } else if (e2 instanceof _t) {
            const n2 = new Ke(e2);
            for (; n2.hasNext(); ) {
              const s2 = n2.next();
              s2 !== e2 && this.computeLocation(t2, s2);
            }
          }
        }
        locateOnPoint(t2, e2) {
          return e2.getCoordinate().equals2D(t2) ? ne.INTERIOR : ne.EXTERIOR;
        }
        locateOnLineString(t2, e2) {
          if (!e2.getEnvelopeInternal().intersects(t2)) return ne.EXTERIOR;
          const n2 = e2.getCoordinateSequence();
          return e2.isClosed() || !t2.equals(n2.getCoordinate(0)) && !t2.equals(n2.getCoordinate(n2.size() - 1)) ? We.isOnLine(t2, n2) ? ne.INTERIOR : ne.EXTERIOR : ne.BOUNDARY;
        }
        locateInPolygon(t2, e2) {
          if (e2.isEmpty()) return ne.EXTERIOR;
          const n2 = e2.getExteriorRing(), s2 = this.locateInPolygonRing(t2, n2);
          if (s2 === ne.EXTERIOR) return ne.EXTERIOR;
          if (s2 === ne.BOUNDARY) return ne.BOUNDARY;
          for (let n3 = 0; n3 < e2.getNumInteriorRing(); n3++) {
            const s3 = e2.getInteriorRingN(n3), i2 = this.locateInPolygonRing(t2, s3);
            if (i2 === ne.INTERIOR) return ne.EXTERIOR;
            if (i2 === ne.BOUNDARY) return ne.BOUNDARY;
          }
          return ne.INTERIOR;
        }
        locate(t2, e2) {
          return e2.isEmpty() ? ne.EXTERIOR : e2 instanceof Tt ? this.locateOnLineString(t2, e2) : e2 instanceof bt ? this.locateInPolygon(t2, e2) : (this._isIn = false, this._numBoundaries = 0, this.computeLocation(t2, e2), this._boundaryRule.isInBoundary(this._numBoundaries) ? ne.BOUNDARY : this._numBoundaries > 0 || this._isIn ? ne.INTERIOR : ne.EXTERIOR);
        }
        getClass() {
          return _n;
        }
        get interfaces_() {
          return [];
        }
      }
      _n.constructor_ = function() {
        if (this._boundaryRule = V.OGC_SFS_BOUNDARY_RULE, this._isIn = null, this._numBoundaries = null, 0 === arguments.length) ;
        else if (1 === arguments.length) {
          const t2 = arguments[0];
          if (null === t2) throw new n("Rule must be non-null");
          this._boundaryRule = t2;
        }
      };
      class fn {
        constructor() {
          fn.constructor_.apply(this, arguments);
        }
        static pointWitMinAngleWithX(t2, e2) {
          let n2 = i.MAX_VALUE, s2 = null;
          for (let i2 = 0; i2 < t2.length; i2++) {
            const r2 = t2[i2];
            if (r2 === e2) continue;
            const o2 = r2.x - e2.x;
            let l2 = r2.y - e2.y;
            l2 < 0 && (l2 = -l2);
            const a2 = l2 / Math.sqrt(o2 * o2 + l2 * l2);
            a2 < n2 && (n2 = a2, s2 = r2);
          }
          return s2;
        }
        static lowestPoint(t2) {
          let e2 = t2[0];
          for (let n2 = 1; n2 < t2.length; n2++) t2[n2].y < e2.y && (e2 = t2[n2]);
          return e2;
        }
        static pointWithMinAngleWithSegment(t2, e2, n2) {
          let s2 = i.MAX_VALUE, r2 = null;
          for (let i2 = 0; i2 < t2.length; i2++) {
            const o2 = t2[i2];
            if (o2 === e2) continue;
            if (o2 === n2) continue;
            const l2 = ie.angleBetween(e2, o2, n2);
            l2 < s2 && (s2 = l2, r2 = o2);
          }
          return r2;
        }
        getRadius() {
          return this.compute(), this._radius;
        }
        getDiameter() {
          switch (this.compute(), this._extremalPts.length) {
            case 0:
              return this._input.getFactory().createLineString();
            case 1:
              return this._input.getFactory().createPoint(this._centre);
          }
          const t2 = this._extremalPts[0], e2 = this._extremalPts[1];
          return this._input.getFactory().createLineString([t2, e2]);
        }
        getExtremalPoints() {
          return this.compute(), this._extremalPts;
        }
        computeCirclePoints() {
          if (this._input.isEmpty()) return this._extremalPts = new Array(0).fill(null), null;
          if (1 === this._input.getNumPoints()) {
            const t3 = this._input.getCoordinates();
            return this._extremalPts = [new g(t3[0])], null;
          }
          const t2 = this._input.convexHull().getCoordinates();
          let e2 = t2;
          if (t2[0].equals2D(t2[t2.length - 1]) && (e2 = new Array(t2.length - 1).fill(null), X.copyDeep(t2, 0, e2, 0, t2.length - 1)), e2.length <= 2) return this._extremalPts = X.copyDeep(e2), null;
          let n2 = fn.lowestPoint(e2), s2 = fn.pointWitMinAngleWithX(e2, n2);
          for (let t3 = 0; t3 < e2.length; t3++) {
            const t4 = fn.pointWithMinAngleWithSegment(e2, n2, s2);
            if (ie.isObtuse(n2, t4, s2)) return this._extremalPts = [new g(n2), new g(s2)], null;
            if (ie.isObtuse(t4, n2, s2)) n2 = t4;
            else {
              if (!ie.isObtuse(t4, s2, n2)) return this._extremalPts = [new g(n2), new g(s2), new g(t4)], null;
              s2 = t4;
            }
          }
          u.shouldNeverReachHere("Logic failure in Minimum Bounding Circle algorithm!");
        }
        compute() {
          if (null !== this._extremalPts) return null;
          this.computeCirclePoints(), this.computeCentre(), null !== this._centre && (this._radius = this._centre.distance(this._extremalPts[0]));
        }
        getFarthestPoints() {
          switch (this.compute(), this._extremalPts.length) {
            case 0:
              return this._input.getFactory().createLineString();
            case 1:
              return this._input.getFactory().createPoint(this._centre);
          }
          const t2 = this._extremalPts[0], e2 = this._extremalPts[this._extremalPts.length - 1];
          return this._input.getFactory().createLineString([t2, e2]);
        }
        getCircle() {
          if (this.compute(), null === this._centre) return this._input.getFactory().createPolygon();
          const t2 = this._input.getFactory().createPoint(this._centre);
          return 0 === this._radius ? t2 : t2.buffer(this._radius);
        }
        getCentre() {
          return this.compute(), this._centre;
        }
        computeCentre() {
          switch (this._extremalPts.length) {
            case 0:
              this._centre = null;
              break;
            case 1:
              this._centre = this._extremalPts[0];
              break;
            case 2:
              this._centre = new g((this._extremalPts[0].x + this._extremalPts[1].x) / 2, (this._extremalPts[0].y + this._extremalPts[1].y) / 2);
              break;
            case 3:
              this._centre = re.circumcentre(this._extremalPts[0], this._extremalPts[1], this._extremalPts[2]);
          }
        }
        getClass() {
          return fn;
        }
        get interfaces_() {
          return [];
        }
      }
      fn.constructor_ = function() {
        this._input = null, this._extremalPts = null, this._centre = null, this._radius = 0;
        const t2 = arguments[0];
        this._input = t2;
      };
      class pn {
        constructor() {
          pn.constructor_.apply(this, arguments);
        }
        static nextIndex(t2, e2) {
          return ++e2 >= t2.length && (e2 = 0), e2;
        }
        static computeC(t2, e2, n2) {
          return t2 * n2.y - e2 * n2.x;
        }
        static getMinimumDiameter(t2) {
          return new pn(t2).getDiameter();
        }
        static getMinimumRectangle(t2) {
          return new pn(t2).getMinimumRectangle();
        }
        static computeSegmentForLine(t2, e2, n2) {
          let s2 = null, i2 = null;
          return Math.abs(e2) > Math.abs(t2) ? (s2 = new g(0, n2 / e2), i2 = new g(1, n2 / e2 - t2 / e2)) : (s2 = new g(n2 / t2, 0), i2 = new g(n2 / t2 - e2 / t2, 1)), new ee(s2, i2);
        }
        getWidthCoordinate() {
          return this.computeMinimumDiameter(), this._minWidthPt;
        }
        getSupportingSegment() {
          return this.computeMinimumDiameter(), this._inputGeom.getFactory().createLineString([this._minBaseSeg.p0, this._minBaseSeg.p1]);
        }
        getDiameter() {
          if (this.computeMinimumDiameter(), null === this._minWidthPt) return this._inputGeom.getFactory().createLineString();
          const t2 = this._minBaseSeg.project(this._minWidthPt);
          return this._inputGeom.getFactory().createLineString([t2, this._minWidthPt]);
        }
        computeWidthConvex(t2) {
          this._convexHullPts = t2 instanceof bt ? t2.getExteriorRing().getCoordinates() : t2.getCoordinates(), 0 === this._convexHullPts.length ? (this._minWidth = 0, this._minWidthPt = null, this._minBaseSeg = null) : 1 === this._convexHullPts.length ? (this._minWidth = 0, this._minWidthPt = this._convexHullPts[0], this._minBaseSeg.p0 = this._convexHullPts[0], this._minBaseSeg.p1 = this._convexHullPts[0]) : 2 === this._convexHullPts.length || 3 === this._convexHullPts.length ? (this._minWidth = 0, this._minWidthPt = this._convexHullPts[0], this._minBaseSeg.p0 = this._convexHullPts[0], this._minBaseSeg.p1 = this._convexHullPts[1]) : this.computeConvexRingMinDiameter(this._convexHullPts);
        }
        computeConvexRingMinDiameter(t2) {
          this._minWidth = i.MAX_VALUE;
          let e2 = 1;
          const n2 = new ee();
          for (let s2 = 0; s2 < t2.length - 1; s2++) n2.p0 = t2[s2], n2.p1 = t2[s2 + 1], e2 = this.findMaxPerpDistance(t2, n2, e2);
        }
        computeMinimumDiameter() {
          if (null !== this._minWidthPt) return null;
          if (this._isConvex) this.computeWidthConvex(this._inputGeom);
          else {
            const t2 = new an(this._inputGeom).getConvexHull();
            this.computeWidthConvex(t2);
          }
        }
        getLength() {
          return this.computeMinimumDiameter(), this._minWidth;
        }
        findMaxPerpDistance(t2, e2, n2) {
          let s2 = e2.distancePerpendicular(t2[n2]), i2 = s2, r2 = n2, o2 = r2;
          for (; i2 >= s2; ) s2 = i2, r2 = o2, o2 = pn.nextIndex(t2, r2), i2 = e2.distancePerpendicular(t2[o2]);
          return s2 < this._minWidth && (this._minPtIndex = r2, this._minWidth = s2, this._minWidthPt = t2[this._minPtIndex], this._minBaseSeg = new ee(e2)), r2;
        }
        getMinimumRectangle() {
          if (this.computeMinimumDiameter(), 0 === this._minWidth) return this._minBaseSeg.p0.equals2D(this._minBaseSeg.p1) ? this._inputGeom.getFactory().createPoint(this._minBaseSeg.p0) : this._minBaseSeg.toGeometry(this._inputGeom.getFactory());
          const t2 = this._minBaseSeg.p1.x - this._minBaseSeg.p0.x, e2 = this._minBaseSeg.p1.y - this._minBaseSeg.p0.y;
          let n2 = i.MAX_VALUE, s2 = -i.MAX_VALUE, r2 = i.MAX_VALUE, o2 = -i.MAX_VALUE;
          for (let i2 = 0; i2 < this._convexHullPts.length; i2++) {
            const l3 = pn.computeC(t2, e2, this._convexHullPts[i2]);
            l3 > s2 && (s2 = l3), l3 < n2 && (n2 = l3);
            const a3 = pn.computeC(-e2, t2, this._convexHullPts[i2]);
            a3 > o2 && (o2 = a3), a3 < r2 && (r2 = a3);
          }
          const l2 = pn.computeSegmentForLine(-t2, -e2, o2), a2 = pn.computeSegmentForLine(-t2, -e2, r2), c2 = pn.computeSegmentForLine(-e2, t2, s2), h2 = pn.computeSegmentForLine(-e2, t2, n2), u2 = c2.lineIntersection(l2), g2 = h2.lineIntersection(l2), d2 = h2.lineIntersection(a2), _2 = c2.lineIntersection(a2), f2 = this._inputGeom.getFactory().createLinearRing([u2, g2, d2, _2, u2]);
          return this._inputGeom.getFactory().createPolygon(f2);
        }
        getClass() {
          return pn;
        }
        get interfaces_() {
          return [];
        }
      }
      pn.constructor_ = function() {
        if (this._inputGeom = null, this._isConvex = null, this._convexHullPts = null, this._minBaseSeg = new ee(), this._minWidthPt = null, this._minPtIndex = null, this._minWidth = 0, 1 === arguments.length) {
          const t2 = arguments[0];
          pn.constructor_.call(this, t2, false);
        } else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          this._inputGeom = t2, this._isConvex = e2;
        }
      };
      var mn = Object.freeze({ __proto__: null, distance: De, locate: Qe, match: nn, Angle: ie, Area: vt, Centroid: sn, ConvexHull: an, Distance: D, InteriorPointArea: hn, InteriorPointLine: gn, InteriorPointPoint: dn, Length: yt, Orientation: v, PointLocation: We, PointLocator: _n, RobustLineIntersector: te, MinimumBoundingCircle: fn, MinimumDiameter: pn });
      class yn {
        constructor() {
          yn.constructor_.apply(this, arguments);
        }
        static densifyPoints(t2, e2, n2) {
          const s2 = new ee(), i2 = new I();
          for (let r2 = 0; r2 < t2.length - 1; r2++) {
            s2.p0 = t2[r2], s2.p1 = t2[r2 + 1], i2.add(s2.p0, false);
            const o2 = s2.getLength(), l2 = Math.trunc(o2 / e2) + 1;
            if (l2 > 1) {
              const t3 = o2 / l2;
              for (let e3 = 1; e3 < l2; e3++) {
                const r3 = e3 * t3 / o2, l3 = s2.pointAlong(r3);
                n2.makePrecise(l3), i2.add(l3, false);
              }
            }
          }
          return i2.add(t2[t2.length - 1], false), i2.toCoordinateArray();
        }
        static densify(t2, e2) {
          const n2 = new yn(t2);
          return n2.setDistanceTolerance(e2), n2.getResultGeometry();
        }
        getResultGeometry() {
          return new xn(this._distanceTolerance).transform(this._inputGeom);
        }
        setDistanceTolerance(t2) {
          if (t2 <= 0) throw new n("Tolerance must be positive");
          this._distanceTolerance = t2;
        }
        getClass() {
          return yn;
        }
        get interfaces_() {
          return [];
        }
      }
      class xn extends me {
        constructor() {
          super(), xn.constructor_.apply(this, arguments);
        }
        transformMultiPolygon(t2, e2) {
          const n2 = super.transformMultiPolygon.call(this, t2, e2);
          return this.createValidArea(n2);
        }
        transformPolygon(t2, e2) {
          const n2 = super.transformPolygon.call(this, t2, e2);
          return e2 instanceof At ? n2 : this.createValidArea(n2);
        }
        transformCoordinates(t2, e2) {
          const n2 = t2.toCoordinateArray();
          let s2 = yn.densifyPoints(n2, this.distanceTolerance, e2.getPrecisionModel());
          return e2 instanceof Tt && 1 === s2.length && (s2 = new Array(0).fill(null)), this._factory.getCoordinateSequenceFactory().create(s2);
        }
        createValidArea(t2) {
          return t2.buffer(0);
        }
        getClass() {
          return xn;
        }
        get interfaces_() {
          return [];
        }
      }
      xn.constructor_ = function() {
        this.distanceTolerance = null;
        const t2 = arguments[0];
        this.distanceTolerance = t2;
      }, yn.DensifyTransformer = xn, yn.constructor_ = function() {
        this._inputGeom = null, this._distanceTolerance = null;
        const t2 = arguments[0];
        this._inputGeom = t2;
      };
      var En = Object.freeze({ __proto__: null, Densifier: yn });
      class In {
        constructor() {
          In.constructor_.apply(this, arguments);
        }
        static isNorthern(t2) {
          return t2 === In.NE || t2 === In.NW;
        }
        static isOpposite(t2, e2) {
          if (t2 === e2) return false;
          return 2 === (t2 - e2 + 4) % 4;
        }
        static commonHalfPlane(t2, e2) {
          if (t2 === e2) return t2;
          if (2 === (t2 - e2 + 4) % 4) return -1;
          const n2 = t2 < e2 ? t2 : e2;
          return 0 === n2 && 3 === (t2 > e2 ? t2 : e2) ? 3 : n2;
        }
        static isInHalfPlane(t2, e2) {
          return e2 === In.SE ? t2 === In.SE || t2 === In.SW : t2 === e2 || t2 === e2 + 1;
        }
        static quadrant() {
          if ("number" == typeof arguments[0] && "number" == typeof arguments[1]) {
            const t2 = arguments[0], e2 = arguments[1];
            if (0 === t2 && 0 === e2) throw new n("Cannot compute the quadrant for point ( " + t2 + ", " + e2 + " )");
            return t2 >= 0 ? e2 >= 0 ? In.NE : In.SE : e2 >= 0 ? In.NW : In.SW;
          }
          if (arguments[0] instanceof g && arguments[1] instanceof g) {
            const t2 = arguments[0], e2 = arguments[1];
            if (e2.x === t2.x && e2.y === t2.y) throw new n("Cannot compute the quadrant for two identical points " + t2);
            return e2.x >= t2.x ? e2.y >= t2.y ? In.NE : In.SE : e2.y >= t2.y ? In.NW : In.SW;
          }
        }
        getClass() {
          return In;
        }
        get interfaces_() {
          return [];
        }
      }
      In.constructor_ = function() {
      }, In.NE = 0, In.NW = 1, In.SW = 2, In.SE = 3;
      class Nn {
        constructor() {
          Nn.constructor_.apply(this, arguments);
        }
        static init(t2, e2) {
          if (null !== t2._sym || null !== e2._sym || null !== t2._next || null !== e2._next) throw new IllegalStateException("Edges are already initialized");
          return t2.init(e2), t2;
        }
        static create(t2, e2) {
          const n2 = new Nn(t2), s2 = new Nn(e2);
          return n2.init(s2), n2;
        }
        find(t2) {
          let e2 = this;
          do {
            if (null === e2) return null;
            if (e2.dest().equals2D(t2)) return e2;
            e2 = e2.oNext();
          } while (e2 !== this);
          return null;
        }
        dest() {
          return this._sym._orig;
        }
        oNext() {
          return this._sym._next;
        }
        insert(t2) {
          if (this.oNext() === this) return this.insertAfter(t2), null;
          const e2 = this.compareTo(t2);
          let n2 = this;
          do {
            const s2 = n2.oNext();
            if (s2.compareTo(t2) !== e2 || s2 === this) return n2.insertAfter(t2), null;
            n2 = s2;
          } while (n2 !== this);
          u.shouldNeverReachHere();
        }
        insertAfter(t2) {
          u.equals(this._orig, t2.orig());
          const e2 = this.oNext();
          this._sym.setNext(t2), t2.sym().setNext(e2);
        }
        degree() {
          let t2 = 0, e2 = this;
          do {
            t2++, e2 = e2.oNext();
          } while (e2 !== this);
          return t2;
        }
        equals() {
          if (2 === arguments.length && arguments[1] instanceof g && arguments[0] instanceof g) {
            const t2 = arguments[0], e2 = arguments[1];
            return this._orig.equals2D(t2) && this._sym._orig.equals(e2);
          }
        }
        deltaY() {
          return this._sym._orig.y - this._orig.y;
        }
        sym() {
          return this._sym;
        }
        prev() {
          return this._sym.next()._sym;
        }
        compareAngularDirection(t2) {
          const e2 = this.deltaX(), n2 = this.deltaY(), s2 = t2.deltaX(), i2 = t2.deltaY();
          if (e2 === s2 && n2 === i2) return 0;
          const r2 = In.quadrant(e2, n2), o2 = In.quadrant(s2, i2);
          return r2 > o2 ? 1 : r2 < o2 ? -1 : v.index(t2._orig, t2.dest(), this.dest());
        }
        prevNode() {
          let t2 = this;
          for (; 2 === t2.degree(); ) if (t2 = t2.prev(), t2 === this) return null;
          return t2;
        }
        compareTo(t2) {
          const e2 = t2;
          return this.compareAngularDirection(e2);
        }
        next() {
          return this._next;
        }
        setSym(t2) {
          this._sym = t2;
        }
        orig() {
          return this._orig;
        }
        toString() {
          return "HE(" + this._orig.x + " " + this._orig.y + ", " + this._sym._orig.x + " " + this._sym._orig.y + ")";
        }
        setNext(t2) {
          this._next = t2;
        }
        init(t2) {
          this.setSym(t2), t2.setSym(this), this.setNext(t2), t2.setNext(this);
        }
        deltaX() {
          return this._sym._orig.x - this._orig.x;
        }
        getClass() {
          return Nn;
        }
        get interfaces_() {
          return [];
        }
      }
      Nn.constructor_ = function() {
        this._orig = null, this._sym = null, this._next = null;
        const t2 = arguments[0];
        this._orig = t2;
      };
      class Cn extends Nn {
        constructor() {
          super(), Cn.constructor_.apply(this, arguments);
        }
        static setMarkBoth(t2, e2) {
          t2.setMark(e2), t2.sym().setMark(e2);
        }
        static isMarked(t2) {
          return t2.isMarked();
        }
        static setMark(t2, e2) {
          t2.setMark(e2);
        }
        static markBoth(t2) {
          t2.mark(), t2.sym().mark();
        }
        static mark(t2) {
          t2.mark();
        }
        mark() {
          this._isMarked = true;
        }
        setMark(t2) {
          this._isMarked = t2;
        }
        isMarked() {
          return this._isMarked;
        }
        getClass() {
          return Cn;
        }
        get interfaces_() {
          return [];
        }
      }
      Cn.constructor_ = function() {
        this._isMarked = false;
        const t2 = arguments[0];
        Nn.constructor_.call(this, t2);
      };
      class Sn {
        constructor() {
          Sn.constructor_.apply(this, arguments);
        }
        static isValidEdge(t2, e2) {
          return 0 !== e2.compareTo(t2);
        }
        insert(t2, e2, n2) {
          const s2 = this.create(t2, e2);
          null !== n2 ? n2.insert(s2) : this._vertexMap.put(t2, s2);
          const i2 = this._vertexMap.get(e2);
          return null !== i2 ? i2.insert(s2.sym()) : this._vertexMap.put(e2, s2.sym()), s2;
        }
        create(t2, e2) {
          const n2 = this.createEdge(t2), s2 = this.createEdge(e2);
          return Nn.init(n2, s2), n2;
        }
        createEdge(t2) {
          return new Nn(t2);
        }
        addEdge(t2, e2) {
          if (!Sn.isValidEdge(t2, e2)) return null;
          const n2 = this._vertexMap.get(t2);
          let s2 = null;
          if (null !== n2 && (s2 = n2.find(e2)), null !== s2) return s2;
          return this.insert(t2, e2, n2);
        }
        getVertexEdges() {
          return this._vertexMap.values();
        }
        findEdge(t2, e2) {
          const n2 = this._vertexMap.get(t2);
          return null === n2 ? null : n2.find(e2);
        }
        getClass() {
          return Sn;
        }
        get interfaces_() {
          return [];
        }
      }
      Sn.constructor_ = function() {
        this._vertexMap = new Ut();
      };
      class wn extends Cn {
        constructor() {
          super(), wn.constructor_.apply(this, arguments);
        }
        setStart() {
          this._isStart = true;
        }
        isStart() {
          return this._isStart;
        }
        getClass() {
          return wn;
        }
        get interfaces_() {
          return [];
        }
      }
      wn.constructor_ = function() {
        this._isStart = false;
        const t2 = arguments[0];
        Cn.constructor_.call(this, t2);
      };
      class Ln extends Sn {
        constructor() {
          super(), Ln.constructor_.apply(this, arguments);
        }
        createEdge(t2) {
          return new wn(t2);
        }
        getClass() {
          return Ln;
        }
        get interfaces_() {
          return [];
        }
      }
      Ln.constructor_ = function() {
      };
      class Tn {
        constructor() {
          Tn.constructor_.apply(this, arguments);
        }
        static dissolve(t2) {
          const e2 = new Tn();
          return e2.add(t2), e2.getResult();
        }
        addLine(t2) {
          this._lines.add(this._factory.createLineString(t2.toCoordinateArray()));
        }
        updateRingStartEdge(t2) {
          return t2.isStart() || (t2 = t2.sym()).isStart() ? null === this._ringStartEdge ? (this._ringStartEdge = t2, null) : void (t2.orig().compareTo(this._ringStartEdge.orig()) < 0 && (this._ringStartEdge = t2)) : null;
        }
        getResult() {
          return null === this._result && this.computeResult(), this._result;
        }
        process(t2) {
          let e2 = t2.prevNode();
          null === e2 && (e2 = t2), this.stackEdges(e2), this.buildLines();
        }
        buildRing(t2) {
          const e2 = new I();
          let n2 = t2;
          for (e2.add(n2.orig().copy(), false); 2 === n2.sym().degree(); ) {
            const s2 = n2.next();
            if (s2 === t2) break;
            e2.add(s2.orig().copy(), false), n2 = s2;
          }
          e2.add(n2.dest().copy(), false), this.addLine(e2);
        }
        buildLine(t2) {
          const e2 = new I();
          let n2 = t2;
          for (this._ringStartEdge = null, Cn.markBoth(n2), e2.add(n2.orig().copy(), false); 2 === n2.sym().degree(); ) {
            this.updateRingStartEdge(n2);
            const s2 = n2.next();
            if (s2 === t2) return this.buildRing(this._ringStartEdge), null;
            e2.add(s2.orig().copy(), false), n2 = s2, Cn.markBoth(n2);
          }
          e2.add(n2.dest().clone(), false), this.stackEdges(n2.sym()), this.addLine(e2);
        }
        stackEdges(t2) {
          let e2 = t2;
          do {
            Cn.isMarked(e2) || this._nodeEdgeStack.add(e2), e2 = e2.oNext();
          } while (e2 !== t2);
        }
        computeResult() {
          for (let t2 = this._graph.getVertexEdges().iterator(); t2.hasNext(); ) {
            const e2 = t2.next();
            Cn.isMarked(e2) || this.process(e2);
          }
          this._result = this._factory.buildGeometry(this._lines);
        }
        buildLines() {
          for (; !this._nodeEdgeStack.empty(); ) {
            const t2 = this._nodeEdgeStack.pop();
            Cn.isMarked(t2) || this.buildLine(t2);
          }
        }
        add() {
          if (arguments[0] instanceof q) {
            arguments[0].apply(new class {
              get interfaces_() {
                return [G];
              }
              filter(t2) {
                t2 instanceof Tt && this.add(t2);
              }
            }());
          } else if (_(arguments[0], f)) {
            for (let t2 = arguments[0].iterator(); t2.hasNext(); ) {
              const e2 = t2.next();
              this.add(e2);
            }
          } else if (arguments[0] instanceof Tt) {
            const t2 = arguments[0];
            null === this._factory && (this._factory = t2.getFactory());
            const e2 = t2.getCoordinateSequence();
            let n2 = false;
            for (let t3 = 1; t3 < e2.size(); t3++) {
              const s2 = this._graph.addEdge(e2.getCoordinate(t3 - 1), e2.getCoordinate(t3));
              null !== s2 && (n2 || (s2.setStart(), n2 = true));
            }
          }
        }
        getClass() {
          return Tn;
        }
        get interfaces_() {
          return [];
        }
      }
      Tn.constructor_ = function() {
        this._result = null, this._factory = null, this._graph = null, this._lines = new x(), this._nodeEdgeStack = new on(), this._ringStartEdge = null, this._graph = new Ln();
      };
      var Rn = Object.freeze({ __proto__: null, LineDissolver: Tn });
      class Pn {
        constructor() {
          Pn.constructor_.apply(this, arguments);
        }
        static opposite(t2) {
          return t2 === Pn.LEFT ? Pn.RIGHT : t2 === Pn.RIGHT ? Pn.LEFT : t2;
        }
        getClass() {
          return Pn;
        }
        get interfaces_() {
          return [];
        }
      }
      Pn.constructor_ = function() {
      }, Pn.ON = 0, Pn.LEFT = 1, Pn.RIGHT = 2;
      class vn {
        constructor() {
          vn.constructor_.apply(this, arguments);
        }
        computeIntersections(t2, e2) {
          this.mce.computeIntersectsForChain(this.chainIndex, t2.mce, t2.chainIndex, e2);
        }
        getClass() {
          return vn;
        }
        get interfaces_() {
          return [];
        }
      }
      vn.constructor_ = function() {
        this.mce = null, this.chainIndex = null;
        const t2 = arguments[0], e2 = arguments[1];
        this.mce = t2, this.chainIndex = e2;
      };
      class On {
        constructor() {
          On.constructor_.apply(this, arguments);
        }
        isDelete() {
          return this._eventType === On.DELETE;
        }
        setDeleteEventIndex(t2) {
          this._deleteEventIndex = t2;
        }
        getObject() {
          return this._obj;
        }
        compareTo(t2) {
          const e2 = t2;
          return this._xValue < e2._xValue ? -1 : this._xValue > e2._xValue ? 1 : this._eventType < e2._eventType ? -1 : this._eventType > e2._eventType ? 1 : 0;
        }
        getInsertEvent() {
          return this._insertEvent;
        }
        isInsert() {
          return this._eventType === On.INSERT;
        }
        isSameLabel(t2) {
          return null !== this._label && this._label === t2._label;
        }
        getDeleteEventIndex() {
          return this._deleteEventIndex;
        }
        getClass() {
          return On;
        }
        get interfaces_() {
          return [r];
        }
      }
      On.constructor_ = function() {
        if (this._label = null, this._xValue = null, this._eventType = null, this._insertEvent = null, this._deleteEventIndex = null, this._obj = null, 2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          this._eventType = On.DELETE, this._xValue = t2, this._insertEvent = e2;
        } else if (3 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
          this._eventType = On.INSERT, this._label = t2, this._xValue = e2, this._obj = n2;
        }
      }, On.INSERT = 1, On.DELETE = 2;
      class bn {
        constructor() {
          bn.constructor_.apply(this, arguments);
        }
        getClass() {
          return bn;
        }
        get interfaces_() {
          return [];
        }
      }
      bn.constructor_ = function() {
      };
      class Mn {
        constructor() {
          Mn.constructor_.apply(this, arguments);
        }
        static isAdjacentSegments(t2, e2) {
          return 1 === Math.abs(t2 - e2);
        }
        isTrivialIntersection(t2, e2, n2, s2) {
          if (t2 === n2 && 1 === this._li.getIntersectionNum()) {
            if (Mn.isAdjacentSegments(e2, s2)) return true;
            if (t2.isClosed()) {
              const n3 = t2.getNumPoints() - 1;
              if (0 === e2 && s2 === n3 || 0 === s2 && e2 === n3) return true;
            }
          }
          return false;
        }
        getProperIntersectionPoint() {
          return this._properIntersectionPoint;
        }
        setIsDoneIfProperInt(t2) {
          this._isDoneWhenProperInt = t2;
        }
        hasProperInteriorIntersection() {
          return this._hasProperInterior;
        }
        isBoundaryPointInternal(t2, e2) {
          for (let n2 = e2.iterator(); n2.hasNext(); ) {
            const e3 = n2.next().getCoordinate();
            if (t2.isIntersection(e3)) return true;
          }
          return false;
        }
        hasProperIntersection() {
          return this._hasProper;
        }
        hasIntersection() {
          return this._hasIntersection;
        }
        isDone() {
          return this._isDone;
        }
        isBoundaryPoint(t2, e2) {
          return null !== e2 && (!!this.isBoundaryPointInternal(t2, e2[0]) || !!this.isBoundaryPointInternal(t2, e2[1]));
        }
        setBoundaryNodes(t2, e2) {
          this._bdyNodes = new Array(2).fill(null), this._bdyNodes[0] = t2, this._bdyNodes[1] = e2;
        }
        addIntersections(t2, e2, n2, s2) {
          if (t2 === n2 && e2 === s2) return null;
          this.numTests++;
          const i2 = t2.getCoordinates()[e2], r2 = t2.getCoordinates()[e2 + 1], o2 = n2.getCoordinates()[s2], l2 = n2.getCoordinates()[s2 + 1];
          this._li.computeIntersection(i2, r2, o2, l2), this._li.hasIntersection() && (this._recordIsolated && (t2.setIsolated(false), n2.setIsolated(false)), this._numIntersections++, this.isTrivialIntersection(t2, e2, n2, s2) || (this._hasIntersection = true, !this._includeProper && this._li.isProper() || (t2.addIntersections(this._li, e2, 0), n2.addIntersections(this._li, s2, 1)), this._li.isProper() && (this._properIntersectionPoint = this._li.getIntersection(0).copy(), this._hasProper = true, this._isDoneWhenProperInt && (this._isDone = true), this.isBoundaryPoint(this._li, this._bdyNodes) || (this._hasProperInterior = true))));
        }
        getClass() {
          return Mn;
        }
        get interfaces_() {
          return [];
        }
      }
      Mn.constructor_ = function() {
        this._hasIntersection = false, this._hasProper = false, this._hasProperInterior = false, this._properIntersectionPoint = null, this._li = null, this._includeProper = null, this._recordIsolated = null, this._isSelfIntersection = null, this._numIntersections = 0, this.numTests = 0, this._bdyNodes = null, this._isDone = false, this._isDoneWhenProperInt = false;
        const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
        this._li = t2, this._includeProper = e2, this._recordIsolated = n2;
      };
      class Dn extends bn {
        constructor() {
          super(), Dn.constructor_.apply(this, arguments);
        }
        prepareEvents() {
          Ee.sort(this.events);
          for (let t2 = 0; t2 < this.events.size(); t2++) {
            const e2 = this.events.get(t2);
            e2.isDelete() && e2.getInsertEvent().setDeleteEventIndex(t2);
          }
        }
        computeIntersections() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            this.nOverlaps = 0, this.prepareEvents();
            for (let e2 = 0; e2 < this.events.size(); e2++) {
              const n2 = this.events.get(e2);
              if (n2.isInsert() && this.processOverlaps(e2, n2.getDeleteEventIndex(), n2, t2), t2.isDone()) break;
            }
          } else if (3 === arguments.length) {
            if (arguments[2] instanceof Mn && _(arguments[0], m) && _(arguments[1], m)) {
              const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
              this.addEdges(t2, t2), this.addEdges(e2, e2), this.computeIntersections(n2);
            } else if ("boolean" == typeof arguments[2] && _(arguments[0], m) && arguments[1] instanceof Mn) {
              const t2 = arguments[0], e2 = arguments[1];
              arguments[2] ? this.addEdges(t2, null) : this.addEdges(t2), this.computeIntersections(e2);
            }
          }
        }
        addEdge(t2, e2) {
          const n2 = t2.getMonotoneChainEdge(), s2 = n2.getStartIndexes();
          for (let t3 = 0; t3 < s2.length - 1; t3++) {
            const s3 = new vn(n2, t3), i2 = new On(e2, n2.getMinX(t3), s3);
            this.events.add(i2), this.events.add(new On(n2.getMaxX(t3), i2));
          }
        }
        processOverlaps(t2, e2, n2, s2) {
          const i2 = n2.getObject();
          for (let r2 = t2; r2 < e2; r2++) {
            const t3 = this.events.get(r2);
            if (t3.isInsert()) {
              const e3 = t3.getObject();
              n2.isSameLabel(t3) || (i2.computeIntersections(e3, s2), this.nOverlaps++);
            }
          }
        }
        addEdges() {
          if (1 === arguments.length) {
            for (let t2 = arguments[0].iterator(); t2.hasNext(); ) {
              const e2 = t2.next();
              this.addEdge(e2, e2);
            }
          } else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            for (let n2 = t2.iterator(); n2.hasNext(); ) {
              const t3 = n2.next();
              this.addEdge(t3, e2);
            }
          }
        }
        getClass() {
          return Dn;
        }
        get interfaces_() {
          return [];
        }
      }
      Dn.constructor_ = function() {
        this.events = new x(), this.nOverlaps = null;
      };
      class An {
        constructor() {
          An.constructor_.apply(this, arguments);
        }
        setAllLocations(t2) {
          for (let e2 = 0; e2 < this.location.length; e2++) this.location[e2] = t2;
        }
        isNull() {
          for (let t2 = 0; t2 < this.location.length; t2++) if (this.location[t2] !== ne.NONE) return false;
          return true;
        }
        setAllLocationsIfNull(t2) {
          for (let e2 = 0; e2 < this.location.length; e2++) this.location[e2] === ne.NONE && (this.location[e2] = t2);
        }
        isLine() {
          return 1 === this.location.length;
        }
        merge(t2) {
          if (t2.location.length > this.location.length) {
            const t3 = new Array(3).fill(null);
            t3[Pn.ON] = this.location[Pn.ON], t3[Pn.LEFT] = ne.NONE, t3[Pn.RIGHT] = ne.NONE, this.location = t3;
          }
          for (let e2 = 0; e2 < this.location.length; e2++) this.location[e2] === ne.NONE && e2 < t2.location.length && (this.location[e2] = t2.location[e2]);
        }
        getLocations() {
          return this.location;
        }
        flip() {
          if (this.location.length <= 1) return null;
          const t2 = this.location[Pn.LEFT];
          this.location[Pn.LEFT] = this.location[Pn.RIGHT], this.location[Pn.RIGHT] = t2;
        }
        toString() {
          const t2 = new w();
          return this.location.length > 1 && t2.append(ne.toLocationSymbol(this.location[Pn.LEFT])), t2.append(ne.toLocationSymbol(this.location[Pn.ON])), this.location.length > 1 && t2.append(ne.toLocationSymbol(this.location[Pn.RIGHT])), t2.toString();
        }
        setLocations(t2, e2, n2) {
          this.location[Pn.ON] = t2, this.location[Pn.LEFT] = e2, this.location[Pn.RIGHT] = n2;
        }
        get(t2) {
          return t2 < this.location.length ? this.location[t2] : ne.NONE;
        }
        isArea() {
          return this.location.length > 1;
        }
        isAnyNull() {
          for (let t2 = 0; t2 < this.location.length; t2++) if (this.location[t2] === ne.NONE) return true;
          return false;
        }
        setLocation() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            this.setLocation(Pn.ON, t2);
          } else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            this.location[t2] = e2;
          }
        }
        init(t2) {
          this.location = new Array(t2).fill(null), this.setAllLocations(ne.NONE);
        }
        isEqualOnSide(t2, e2) {
          return this.location[e2] === t2.location[e2];
        }
        allPositionsEqual(t2) {
          for (let e2 = 0; e2 < this.location.length; e2++) if (this.location[e2] !== t2) return false;
          return true;
        }
        getClass() {
          return An;
        }
        get interfaces_() {
          return [];
        }
      }
      An.constructor_ = function() {
        if (this.location = null, 1 === arguments.length) {
          if (arguments[0] instanceof Array) {
            const t2 = arguments[0];
            this.init(t2.length);
          } else if (Number.isInteger(arguments[0])) {
            const t2 = arguments[0];
            this.init(1), this.location[Pn.ON] = t2;
          } else if (arguments[0] instanceof An) {
            const t2 = arguments[0];
            if (this.init(t2.location.length), null !== t2) for (let e2 = 0; e2 < this.location.length; e2++) this.location[e2] = t2.location[e2];
          }
        } else if (3 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
          this.init(3), this.location[Pn.ON] = t2, this.location[Pn.LEFT] = e2, this.location[Pn.RIGHT] = n2;
        }
      };
      class Fn {
        constructor() {
          Fn.constructor_.apply(this, arguments);
        }
        static toLineLabel(t2) {
          const e2 = new Fn(ne.NONE);
          for (let n2 = 0; n2 < 2; n2++) e2.setLocation(n2, t2.getLocation(n2));
          return e2;
        }
        getGeometryCount() {
          let t2 = 0;
          return this.elt[0].isNull() || t2++, this.elt[1].isNull() || t2++, t2;
        }
        setAllLocations(t2, e2) {
          this.elt[t2].setAllLocations(e2);
        }
        isNull(t2) {
          return this.elt[t2].isNull();
        }
        setAllLocationsIfNull() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            this.setAllLocationsIfNull(0, t2), this.setAllLocationsIfNull(1, t2);
          } else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            this.elt[t2].setAllLocationsIfNull(e2);
          }
        }
        isLine(t2) {
          return this.elt[t2].isLine();
        }
        merge(t2) {
          for (let e2 = 0; e2 < 2; e2++) null === this.elt[e2] && null !== t2.elt[e2] ? this.elt[e2] = new An(t2.elt[e2]) : this.elt[e2].merge(t2.elt[e2]);
        }
        flip() {
          this.elt[0].flip(), this.elt[1].flip();
        }
        getLocation() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return this.elt[t2].get(Pn.ON);
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return this.elt[t2].get(e2);
          }
        }
        toString() {
          const t2 = new w();
          return null !== this.elt[0] && (t2.append("A:"), t2.append(this.elt[0].toString())), null !== this.elt[1] && (t2.append(" B:"), t2.append(this.elt[1].toString())), t2.toString();
        }
        isArea() {
          if (0 === arguments.length) return this.elt[0].isArea() || this.elt[1].isArea();
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return this.elt[t2].isArea();
          }
        }
        isAnyNull(t2) {
          return this.elt[t2].isAnyNull();
        }
        setLocation() {
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            this.elt[t2].setLocation(Pn.ON, e2);
          } else if (3 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
            this.elt[t2].setLocation(e2, n2);
          }
        }
        isEqualOnSide(t2, e2) {
          return this.elt[0].isEqualOnSide(t2.elt[0], e2) && this.elt[1].isEqualOnSide(t2.elt[1], e2);
        }
        allPositionsEqual(t2, e2) {
          return this.elt[t2].allPositionsEqual(e2);
        }
        toLine(t2) {
          this.elt[t2].isArea() && (this.elt[t2] = new An(this.elt[t2].location[0]));
        }
        getClass() {
          return Fn;
        }
        get interfaces_() {
          return [];
        }
      }
      Fn.constructor_ = function() {
        if (this.elt = new Array(2).fill(null), 1 === arguments.length) {
          if (Number.isInteger(arguments[0])) {
            const t2 = arguments[0];
            this.elt[0] = new An(t2), this.elt[1] = new An(t2);
          } else if (arguments[0] instanceof Fn) {
            const t2 = arguments[0];
            this.elt[0] = new An(t2.elt[0]), this.elt[1] = new An(t2.elt[1]);
          }
        } else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          this.elt[0] = new An(ne.NONE), this.elt[1] = new An(ne.NONE), this.elt[t2].setLocation(e2);
        } else if (3 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
          this.elt[0] = new An(t2, e2, n2), this.elt[1] = new An(t2, e2, n2);
        } else if (4 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3];
          this.elt[0] = new An(ne.NONE, ne.NONE, ne.NONE), this.elt[1] = new An(ne.NONE, ne.NONE, ne.NONE), this.elt[t2].setLocations(e2, n2, s2);
        }
      };
      class Gn {
        constructor() {
          Gn.constructor_.apply(this, arguments);
        }
        getSegmentIndex() {
          return this.segmentIndex;
        }
        getCoordinate() {
          return this.coord;
        }
        print(t2) {
          t2.print(this.coord), t2.print(" seg # = " + this.segmentIndex), t2.println(" dist = " + this.dist);
        }
        compareTo(t2) {
          const e2 = t2;
          return this.compare(e2.segmentIndex, e2.dist);
        }
        isEndPoint(t2) {
          return 0 === this.segmentIndex && 0 === this.dist || this.segmentIndex === t2;
        }
        toString() {
          return this.coord + " seg # = " + this.segmentIndex + " dist = " + this.dist;
        }
        getDistance() {
          return this.dist;
        }
        compare(t2, e2) {
          return this.segmentIndex < t2 ? -1 : this.segmentIndex > t2 ? 1 : this.dist < e2 ? -1 : this.dist > e2 ? 1 : 0;
        }
        getClass() {
          return Gn;
        }
        get interfaces_() {
          return [r];
        }
      }
      Gn.constructor_ = function() {
        this.coord = null, this.segmentIndex = null, this.dist = null;
        const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
        this.coord = new g(t2), this.segmentIndex = e2, this.dist = n2;
      };
      class qn {
        constructor() {
          qn.constructor_.apply(this, arguments);
        }
        print(t2) {
          t2.println("Intersections:");
          for (let e2 = this.iterator(); e2.hasNext(); ) {
            e2.next().print(t2);
          }
        }
        iterator() {
          return this._nodeMap.values().iterator();
        }
        addSplitEdges(t2) {
          this.addEndpoints();
          const e2 = this.iterator();
          let n2 = e2.next();
          for (; e2.hasNext(); ) {
            const s2 = e2.next(), i2 = this.createSplitEdge(n2, s2);
            t2.add(i2), n2 = s2;
          }
        }
        addEndpoints() {
          const t2 = this.edge.pts.length - 1;
          this.add(this.edge.pts[0], 0, 0), this.add(this.edge.pts[t2], t2, 0);
        }
        createSplitEdge(t2, e2) {
          let n2 = e2.segmentIndex - t2.segmentIndex + 2;
          const s2 = this.edge.pts[e2.segmentIndex], i2 = e2.dist > 0 || !e2.coord.equals2D(s2);
          i2 || n2--;
          const r2 = new Array(n2).fill(null);
          let o2 = 0;
          r2[o2++] = new g(t2.coord);
          for (let n3 = t2.segmentIndex + 1; n3 <= e2.segmentIndex; n3++) r2[o2++] = this.edge.pts[n3];
          return i2 && (r2[o2] = e2.coord), new Un(r2, new Fn(this.edge._label));
        }
        add(t2, e2, n2) {
          const s2 = new Gn(t2, e2, n2), i2 = this._nodeMap.get(s2);
          return null !== i2 ? i2 : (this._nodeMap.put(s2, s2), s2);
        }
        isIntersection(t2) {
          for (let e2 = this.iterator(); e2.hasNext(); ) {
            if (e2.next().coord.equals(t2)) return true;
          }
          return false;
        }
        getClass() {
          return qn;
        }
        get interfaces_() {
          return [];
        }
      }
      qn.constructor_ = function() {
        this._nodeMap = new rt(), this.edge = null;
        const t2 = arguments[0];
        this.edge = t2;
      };
      class Bn {
        constructor() {
          Bn.constructor_.apply(this, arguments);
        }
        static toIntArray(t2) {
          const e2 = new Array(t2.size()).fill(null);
          for (let n2 = 0; n2 < e2.length; n2++) e2[n2] = t2.get(n2).intValue();
          return e2;
        }
        getChainStartIndices(t2) {
          let e2 = 0;
          const n2 = new x();
          n2.add(new L(e2));
          do {
            const s2 = this.findChainEnd(t2, e2);
            n2.add(new L(s2)), e2 = s2;
          } while (e2 < t2.length - 1);
          return Bn.toIntArray(n2);
        }
        findChainEnd(t2, e2) {
          const n2 = In.quadrant(t2[e2], t2[e2 + 1]);
          let s2 = e2 + 1;
          for (; s2 < t2.length; ) {
            if (In.quadrant(t2[s2 - 1], t2[s2]) !== n2) break;
            s2++;
          }
          return s2 - 1;
        }
        getClass() {
          return Bn;
        }
        get interfaces_() {
          return [];
        }
      }
      Bn.constructor_ = function() {
      };
      class Vn {
        constructor() {
          Vn.constructor_.apply(this, arguments);
        }
        getCoordinates() {
          return this.pts;
        }
        getMaxX(t2) {
          const e2 = this.pts[this.startIndex[t2]].x, n2 = this.pts[this.startIndex[t2 + 1]].x;
          return e2 > n2 ? e2 : n2;
        }
        getMinX(t2) {
          const e2 = this.pts[this.startIndex[t2]].x, n2 = this.pts[this.startIndex[t2 + 1]].x;
          return e2 < n2 ? e2 : n2;
        }
        computeIntersectsForChain() {
          if (4 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3];
            this.computeIntersectsForChain(this.startIndex[t2], this.startIndex[t2 + 1], e2, e2.startIndex[n2], e2.startIndex[n2 + 1], s2);
          } else if (6 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3], i2 = arguments[4], r2 = arguments[5];
            if (e2 - t2 == 1 && i2 - s2 == 1) return r2.addIntersections(this.e, t2, n2.e, s2), null;
            if (!this.overlaps(t2, e2, n2, s2, i2)) return null;
            const o2 = Math.trunc((t2 + e2) / 2), l2 = Math.trunc((s2 + i2) / 2);
            t2 < o2 && (s2 < l2 && this.computeIntersectsForChain(t2, o2, n2, s2, l2, r2), l2 < i2 && this.computeIntersectsForChain(t2, o2, n2, l2, i2, r2)), o2 < e2 && (s2 < l2 && this.computeIntersectsForChain(o2, e2, n2, s2, l2, r2), l2 < i2 && this.computeIntersectsForChain(o2, e2, n2, l2, i2, r2));
          }
        }
        overlaps(t2, e2, n2, s2, i2) {
          return N.intersects(this.pts[t2], this.pts[e2], n2.pts[s2], n2.pts[i2]);
        }
        getStartIndexes() {
          return this.startIndex;
        }
        computeIntersects(t2, e2) {
          for (let n2 = 0; n2 < this.startIndex.length - 1; n2++) for (let s2 = 0; s2 < t2.startIndex.length - 1; s2++) this.computeIntersectsForChain(n2, t2, s2, e2);
        }
        getClass() {
          return Vn;
        }
        get interfaces_() {
          return [];
        }
      }
      Vn.constructor_ = function() {
        this.e = null, this.pts = null, this.startIndex = null;
        const t2 = arguments[0];
        this.e = t2, this.pts = t2.getCoordinates();
        const e2 = new Bn();
        this.startIndex = e2.getChainStartIndices(this.pts);
      };
      class zn {
        constructor() {
          zn.constructor_.apply(this, arguments);
        }
        static depthAtLocation(t2) {
          return t2 === ne.EXTERIOR ? 0 : t2 === ne.INTERIOR ? 1 : zn.NULL_VALUE;
        }
        getDepth(t2, e2) {
          return this._depth[t2][e2];
        }
        setDepth(t2, e2, n2) {
          this._depth[t2][e2] = n2;
        }
        isNull() {
          if (0 === arguments.length) {
            for (let t2 = 0; t2 < 2; t2++) for (let e2 = 0; e2 < 3; e2++) if (this._depth[t2][e2] !== zn.NULL_VALUE) return false;
            return true;
          }
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return this._depth[t2][1] === zn.NULL_VALUE;
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return this._depth[t2][e2] === zn.NULL_VALUE;
          }
        }
        normalize() {
          for (let t2 = 0; t2 < 2; t2++) if (!this.isNull(t2)) {
            let e2 = this._depth[t2][1];
            this._depth[t2][2] < e2 && (e2 = this._depth[t2][2]), e2 < 0 && (e2 = 0);
            for (let n2 = 1; n2 < 3; n2++) {
              let s2 = 0;
              this._depth[t2][n2] > e2 && (s2 = 1), this._depth[t2][n2] = s2;
            }
          }
        }
        getDelta(t2) {
          return this._depth[t2][Pn.RIGHT] - this._depth[t2][Pn.LEFT];
        }
        getLocation(t2, e2) {
          return this._depth[t2][e2] <= 0 ? ne.EXTERIOR : ne.INTERIOR;
        }
        toString() {
          return "A: " + this._depth[0][1] + "," + this._depth[0][2] + " B: " + this._depth[1][1] + "," + this._depth[1][2];
        }
        add() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            for (let e2 = 0; e2 < 2; e2++) for (let n2 = 1; n2 < 3; n2++) {
              const s2 = t2.getLocation(e2, n2);
              s2 !== ne.EXTERIOR && s2 !== ne.INTERIOR || (this.isNull(e2, n2) ? this._depth[e2][n2] = zn.depthAtLocation(s2) : this._depth[e2][n2] += zn.depthAtLocation(s2));
            }
          } else if (3 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            arguments[2] === ne.INTERIOR && this._depth[t2][e2]++;
          }
        }
        getClass() {
          return zn;
        }
        get interfaces_() {
          return [];
        }
      }
      zn.constructor_ = function() {
        this._depth = Array(2).fill().map(() => Array(3));
        for (let t2 = 0; t2 < 2; t2++) for (let e2 = 0; e2 < 3; e2++) this._depth[t2][e2] = zn.NULL_VALUE;
      }, zn.NULL_VALUE = -1;
      class Yn {
        constructor() {
          Yn.constructor_.apply(this, arguments);
        }
        setVisited(t2) {
          this._isVisited = t2;
        }
        setInResult(t2) {
          this._isInResult = t2;
        }
        isCovered() {
          return this._isCovered;
        }
        isCoveredSet() {
          return this._isCoveredSet;
        }
        setLabel(t2) {
          this._label = t2;
        }
        getLabel() {
          return this._label;
        }
        setCovered(t2) {
          this._isCovered = t2, this._isCoveredSet = true;
        }
        updateIM(t2) {
          u.isTrue(this._label.getGeometryCount() >= 2, "found partial label"), this.computeIM(t2);
        }
        isInResult() {
          return this._isInResult;
        }
        isVisited() {
          return this._isVisited;
        }
        getClass() {
          return Yn;
        }
        get interfaces_() {
          return [];
        }
      }
      Yn.constructor_ = function() {
        if (this._label = null, this._isInResult = false, this._isCovered = false, this._isCoveredSet = false, this._isVisited = false, 0 === arguments.length) ;
        else if (1 === arguments.length) {
          const t2 = arguments[0];
          this._label = t2;
        }
      };
      class Un extends Yn {
        constructor() {
          super(), Un.constructor_.apply(this, arguments);
        }
        static updateIM() {
          if (!(2 === arguments.length && arguments[1] instanceof se && arguments[0] instanceof Fn)) return super.updateIM.apply(this, arguments);
          {
            const t2 = arguments[0], e2 = arguments[1];
            e2.setAtLeastIfValid(t2.getLocation(0, Pn.ON), t2.getLocation(1, Pn.ON), 1), t2.isArea() && (e2.setAtLeastIfValid(t2.getLocation(0, Pn.LEFT), t2.getLocation(1, Pn.LEFT), 2), e2.setAtLeastIfValid(t2.getLocation(0, Pn.RIGHT), t2.getLocation(1, Pn.RIGHT), 2));
          }
        }
        getDepth() {
          return this._depth;
        }
        getCollapsedEdge() {
          const t2 = new Array(2).fill(null);
          return t2[0] = this.pts[0], t2[1] = this.pts[1], new Un(t2, Fn.toLineLabel(this._label));
        }
        isIsolated() {
          return this._isIsolated;
        }
        getCoordinates() {
          return this.pts;
        }
        setIsolated(t2) {
          this._isIsolated = t2;
        }
        setName(t2) {
          this._name = t2;
        }
        equals(t2) {
          if (!(t2 instanceof Un)) return false;
          const e2 = t2;
          if (this.pts.length !== e2.pts.length) return false;
          let n2 = true, s2 = true, i2 = this.pts.length;
          for (let t3 = 0; t3 < this.pts.length; t3++) if (this.pts[t3].equals2D(e2.pts[t3]) || (n2 = false), this.pts[t3].equals2D(e2.pts[--i2]) || (s2 = false), !n2 && !s2) return false;
          return true;
        }
        getCoordinate() {
          if (0 === arguments.length) return this.pts.length > 0 ? this.pts[0] : null;
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return this.pts[t2];
          }
        }
        print(t2) {
          t2.print("edge " + this._name + ": "), t2.print("LINESTRING (");
          for (let e2 = 0; e2 < this.pts.length; e2++) e2 > 0 && t2.print(","), t2.print(this.pts[e2].x + " " + this.pts[e2].y);
          t2.print(")  " + this._label + " " + this._depthDelta);
        }
        computeIM(t2) {
          Un.updateIM(this._label, t2);
        }
        isCollapsed() {
          return !!this._label.isArea() && (3 === this.pts.length && !!this.pts[0].equals(this.pts[2]));
        }
        isClosed() {
          return this.pts[0].equals(this.pts[this.pts.length - 1]);
        }
        getMaximumSegmentIndex() {
          return this.pts.length - 1;
        }
        getDepthDelta() {
          return this._depthDelta;
        }
        getNumPoints() {
          return this.pts.length;
        }
        printReverse(t2) {
          t2.print("edge " + this._name + ": ");
          for (let e2 = this.pts.length - 1; e2 >= 0; e2--) t2.print(this.pts[e2] + " ");
          t2.println("");
        }
        getMonotoneChainEdge() {
          return null === this._mce && (this._mce = new Vn(this)), this._mce;
        }
        getEnvelope() {
          if (null === this._env) {
            this._env = new N();
            for (let t2 = 0; t2 < this.pts.length; t2++) this._env.expandToInclude(this.pts[t2]);
          }
          return this._env;
        }
        addIntersection(t2, e2, n2, s2) {
          const i2 = new g(t2.getIntersection(s2));
          let r2 = e2, o2 = t2.getEdgeDistance(n2, s2);
          const l2 = r2 + 1;
          if (l2 < this.pts.length) {
            const t3 = this.pts[l2];
            i2.equals2D(t3) && (r2 = l2, o2 = 0);
          }
          this.eiList.add(i2, r2, o2);
        }
        toString() {
          const t2 = new wt();
          t2.append("edge " + this._name + ": "), t2.append("LINESTRING (");
          for (let e2 = 0; e2 < this.pts.length; e2++) e2 > 0 && t2.append(","), t2.append(this.pts[e2].x + " " + this.pts[e2].y);
          return t2.append(")  " + this._label + " " + this._depthDelta), t2.toString();
        }
        isPointwiseEqual(t2) {
          if (this.pts.length !== t2.pts.length) return false;
          for (let e2 = 0; e2 < this.pts.length; e2++) if (!this.pts[e2].equals2D(t2.pts[e2])) return false;
          return true;
        }
        setDepthDelta(t2) {
          this._depthDelta = t2;
        }
        getEdgeIntersectionList() {
          return this.eiList;
        }
        addIntersections(t2, e2, n2) {
          for (let s2 = 0; s2 < t2.getIntersectionNum(); s2++) this.addIntersection(t2, e2, n2, s2);
        }
        getClass() {
          return Un;
        }
        get interfaces_() {
          return [];
        }
      }
      Un.constructor_ = function() {
        if (this.pts = null, this._env = null, this.eiList = new qn(this), this._name = null, this._mce = null, this._isIsolated = true, this._depth = new zn(), this._depthDelta = 0, 1 === arguments.length) {
          const t2 = arguments[0];
          Un.constructor_.call(this, t2, null);
        } else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          this.pts = t2, this._label = e2;
        }
      };
      class kn extends Yn {
        constructor() {
          super(), kn.constructor_.apply(this, arguments);
        }
        isIncidentEdgeInResult() {
          for (let t2 = this.getEdges().getEdges().iterator(); t2.hasNext(); ) {
            if (t2.next().getEdge().isInResult()) return true;
          }
          return false;
        }
        isIsolated() {
          return 1 === this._label.getGeometryCount();
        }
        getCoordinate() {
          return this._coord;
        }
        print(t2) {
          t2.println("node " + this._coord + " lbl: " + this._label);
        }
        computeIM(t2) {
        }
        computeMergedLocation(t2, e2) {
          let n2 = ne.NONE;
          if (n2 = this._label.getLocation(e2), !t2.isNull(e2)) {
            const s2 = t2.getLocation(e2);
            n2 !== ne.BOUNDARY && (n2 = s2);
          }
          return n2;
        }
        setLabel() {
          if (2 !== arguments.length || !Number.isInteger(arguments[1]) || !Number.isInteger(arguments[0])) return super.setLabel.apply(this, arguments);
          {
            const t2 = arguments[0], e2 = arguments[1];
            null === this._label ? this._label = new Fn(t2, e2) : this._label.setLocation(t2, e2);
          }
        }
        getEdges() {
          return this._edges;
        }
        mergeLabel() {
          if (arguments[0] instanceof kn) {
            const t2 = arguments[0];
            this.mergeLabel(t2._label);
          } else if (arguments[0] instanceof Fn) {
            const t2 = arguments[0];
            for (let e2 = 0; e2 < 2; e2++) {
              const n2 = this.computeMergedLocation(t2, e2);
              this._label.getLocation(e2) === ne.NONE && this._label.setLocation(e2, n2);
            }
          }
        }
        add(t2) {
          this._edges.insert(t2), t2.setNode(this);
        }
        setLabelBoundary(t2) {
          if (null === this._label) return null;
          let e2 = ne.NONE;
          null !== this._label && (e2 = this._label.getLocation(t2));
          let n2 = null;
          switch (e2) {
            case ne.BOUNDARY:
              n2 = ne.INTERIOR;
              break;
            case ne.INTERIOR:
            default:
              n2 = ne.BOUNDARY;
          }
          this._label.setLocation(t2, n2);
        }
        getClass() {
          return kn;
        }
        get interfaces_() {
          return [];
        }
      }
      kn.constructor_ = function() {
        this._coord = null, this._edges = null;
        const t2 = arguments[0], e2 = arguments[1];
        this._coord = t2, this._edges = e2, this._label = new Fn(0, ne.NONE);
      };
      class Xn {
        constructor() {
          Xn.constructor_.apply(this, arguments);
        }
        find(t2) {
          return this.nodeMap.get(t2);
        }
        addNode() {
          if (arguments[0] instanceof g) {
            const t2 = arguments[0];
            let e2 = this.nodeMap.get(t2);
            return null === e2 && (e2 = this.nodeFact.createNode(t2), this.nodeMap.put(t2, e2)), e2;
          }
          if (arguments[0] instanceof kn) {
            const t2 = arguments[0], e2 = this.nodeMap.get(t2.getCoordinate());
            return null === e2 ? (this.nodeMap.put(t2.getCoordinate(), t2), t2) : (e2.mergeLabel(t2), e2);
          }
        }
        print(t2) {
          for (let e2 = this.iterator(); e2.hasNext(); ) {
            e2.next().print(t2);
          }
        }
        iterator() {
          return this.nodeMap.values().iterator();
        }
        values() {
          return this.nodeMap.values();
        }
        getBoundaryNodes(t2) {
          const e2 = new x();
          for (let n2 = this.iterator(); n2.hasNext(); ) {
            const s2 = n2.next();
            s2.getLabel().getLocation(t2) === ne.BOUNDARY && e2.add(s2);
          }
          return e2;
        }
        add(t2) {
          const e2 = t2.getCoordinate();
          this.addNode(e2).add(t2);
        }
        getClass() {
          return Xn;
        }
        get interfaces_() {
          return [];
        }
      }
      Xn.constructor_ = function() {
        this.nodeMap = new rt(), this.nodeFact = null;
        const t2 = arguments[0];
        this.nodeFact = t2;
      };
      class Hn {
        constructor() {
          Hn.constructor_.apply(this, arguments);
        }
        compareDirection(t2) {
          return this._dx === t2._dx && this._dy === t2._dy ? 0 : this._quadrant > t2._quadrant ? 1 : this._quadrant < t2._quadrant ? -1 : v.index(t2._p0, t2._p1, this._p1);
        }
        getDy() {
          return this._dy;
        }
        getCoordinate() {
          return this._p0;
        }
        setNode(t2) {
          this._node = t2;
        }
        print(t2) {
          const e2 = Math.atan2(this._dy, this._dx), n2 = this.getClass().getName(), s2 = n2.lastIndexOf("."), i2 = n2.substring(s2 + 1);
          t2.print("  " + i2 + ": " + this._p0 + " - " + this._p1 + " " + this._quadrant + ":" + e2 + "   " + this._label);
        }
        compareTo(t2) {
          const e2 = t2;
          return this.compareDirection(e2);
        }
        getDirectedCoordinate() {
          return this._p1;
        }
        getDx() {
          return this._dx;
        }
        getLabel() {
          return this._label;
        }
        getEdge() {
          return this._edge;
        }
        getQuadrant() {
          return this._quadrant;
        }
        getNode() {
          return this._node;
        }
        toString() {
          const t2 = Math.atan2(this._dy, this._dx), e2 = this.getClass().getName(), n2 = e2.lastIndexOf(".");
          return "  " + e2.substring(n2 + 1) + ": " + this._p0 + " - " + this._p1 + " " + this._quadrant + ":" + t2 + "   " + this._label;
        }
        computeLabel(t2) {
        }
        init(t2, e2) {
          this._p0 = t2, this._p1 = e2, this._dx = e2.x - t2.x, this._dy = e2.y - t2.y, this._quadrant = In.quadrant(this._dx, this._dy), u.isTrue(!(0 === this._dx && 0 === this._dy), "EdgeEnd with identical endpoints found");
        }
        getClass() {
          return Hn;
        }
        get interfaces_() {
          return [r];
        }
      }
      Hn.constructor_ = function() {
        if (this._edge = null, this._label = null, this._node = null, this._p0 = null, this._p1 = null, this._dx = null, this._dy = null, this._quadrant = null, 1 === arguments.length) {
          const t2 = arguments[0];
          this._edge = t2;
        } else if (3 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
          Hn.constructor_.call(this, t2, e2, n2, null);
        } else if (4 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3];
          Hn.constructor_.call(this, t2), this.init(e2, n2), this._label = s2;
        }
      };
      class Wn extends c {
        constructor() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            super(t2), c.call(this, t2);
          } else {
            if (2 !== arguments.length) throw Error();
            {
              const t2 = arguments[0], e2 = arguments[1];
              super(Wn.msgWithCoord(t2, e2)), this.name = "TopologyException", this.pt = new g(e2);
            }
          }
        }
        getCoordinate() {
          return this.pt;
        }
        get interfaces_() {
          return [];
        }
        getClass() {
          return Wn;
        }
        static msgWithCoord(t2, e2) {
          return null !== e2 ? t2 + " [ " + e2 + " ]" : t2;
        }
      }
      class jn extends Hn {
        constructor() {
          super(), jn.constructor_.apply(this, arguments);
        }
        static depthFactor(t2, e2) {
          return t2 === ne.EXTERIOR && e2 === ne.INTERIOR ? 1 : t2 === ne.INTERIOR && e2 === ne.EXTERIOR ? -1 : 0;
        }
        getNextMin() {
          return this._nextMin;
        }
        getDepth(t2) {
          return this._depth[t2];
        }
        setVisited(t2) {
          this._isVisited = t2;
        }
        computeDirectedLabel() {
          this._label = new Fn(this._edge.getLabel()), this._isForward || this._label.flip();
        }
        getNext() {
          return this._next;
        }
        setDepth(t2, e2) {
          if (-999 !== this._depth[t2] && this._depth[t2] !== e2) throw new Wn("assigned depths do not match", this.getCoordinate());
          this._depth[t2] = e2;
        }
        isInteriorAreaEdge() {
          let t2 = true;
          for (let e2 = 0; e2 < 2; e2++) this._label.isArea(e2) && this._label.getLocation(e2, Pn.LEFT) === ne.INTERIOR && this._label.getLocation(e2, Pn.RIGHT) === ne.INTERIOR || (t2 = false);
          return t2;
        }
        setNextMin(t2) {
          this._nextMin = t2;
        }
        print(t2) {
          super.print.call(this, t2), t2.print(" " + this._depth[Pn.LEFT] + "/" + this._depth[Pn.RIGHT]), t2.print(" (" + this.getDepthDelta() + ")"), this._isInResult && t2.print(" inResult");
        }
        setMinEdgeRing(t2) {
          this._minEdgeRing = t2;
        }
        isLineEdge() {
          const t2 = this._label.isLine(0) || this._label.isLine(1), e2 = !this._label.isArea(0) || this._label.allPositionsEqual(0, ne.EXTERIOR), n2 = !this._label.isArea(1) || this._label.allPositionsEqual(1, ne.EXTERIOR);
          return t2 && e2 && n2;
        }
        setEdgeRing(t2) {
          this._edgeRing = t2;
        }
        getMinEdgeRing() {
          return this._minEdgeRing;
        }
        getDepthDelta() {
          let t2 = this._edge.getDepthDelta();
          return this._isForward || (t2 = -t2), t2;
        }
        setInResult(t2) {
          this._isInResult = t2;
        }
        getSym() {
          return this._sym;
        }
        isForward() {
          return this._isForward;
        }
        getEdge() {
          return this._edge;
        }
        printEdge(t2) {
          this.print(t2), t2.print(" "), this._isForward ? this._edge.print(t2) : this._edge.printReverse(t2);
        }
        setSym(t2) {
          this._sym = t2;
        }
        setVisitedEdge(t2) {
          this.setVisited(t2), this._sym.setVisited(t2);
        }
        setEdgeDepths(t2, e2) {
          let n2 = this.getEdge().getDepthDelta();
          this._isForward || (n2 = -n2);
          let s2 = 1;
          t2 === Pn.LEFT && (s2 = -1);
          const i2 = Pn.opposite(t2), r2 = e2 + n2 * s2;
          this.setDepth(t2, e2), this.setDepth(i2, r2);
        }
        getEdgeRing() {
          return this._edgeRing;
        }
        isInResult() {
          return this._isInResult;
        }
        setNext(t2) {
          this._next = t2;
        }
        isVisited() {
          return this._isVisited;
        }
        getClass() {
          return jn;
        }
        get interfaces_() {
          return [];
        }
      }
      jn.constructor_ = function() {
        this._isForward = null, this._isInResult = false, this._isVisited = false, this._sym = null, this._next = null, this._nextMin = null, this._edgeRing = null, this._minEdgeRing = null, this._depth = [0, -999, -999];
        const t2 = arguments[0], e2 = arguments[1];
        if (Hn.constructor_.call(this, t2), this._isForward = e2, e2) this.init(t2.getCoordinate(0), t2.getCoordinate(1));
        else {
          const e3 = t2.getNumPoints() - 1;
          this.init(t2.getCoordinate(e3), t2.getCoordinate(e3 - 1));
        }
        this.computeDirectedLabel();
      };
      class Kn {
        constructor() {
          Kn.constructor_.apply(this, arguments);
        }
        createNode(t2) {
          return new kn(t2, null);
        }
        getClass() {
          return Kn;
        }
        get interfaces_() {
          return [];
        }
      }
      Kn.constructor_ = function() {
      };
      class Zn {
        constructor() {
          Zn.constructor_.apply(this, arguments);
        }
        static linkResultDirectedEdges(t2) {
          for (let e2 = t2.iterator(); e2.hasNext(); ) {
            e2.next().getEdges().linkResultDirectedEdges();
          }
        }
        printEdges(t2) {
          t2.println("Edges:");
          for (let e2 = 0; e2 < this._edges.size(); e2++) {
            t2.println("edge " + e2 + ":");
            const n2 = this._edges.get(e2);
            n2.print(t2), n2.eiList.print(t2);
          }
        }
        find(t2) {
          return this._nodes.find(t2);
        }
        addNode() {
          if (arguments[0] instanceof kn) {
            const t2 = arguments[0];
            return this._nodes.addNode(t2);
          }
          if (arguments[0] instanceof g) {
            const t2 = arguments[0];
            return this._nodes.addNode(t2);
          }
        }
        getNodeIterator() {
          return this._nodes.iterator();
        }
        linkResultDirectedEdges() {
          for (let t2 = this._nodes.iterator(); t2.hasNext(); ) {
            t2.next().getEdges().linkResultDirectedEdges();
          }
        }
        debugPrintln(t2) {
          O.out.println(t2);
        }
        isBoundaryNode(t2, e2) {
          const n2 = this._nodes.find(e2);
          if (null === n2) return false;
          const s2 = n2.getLabel();
          return null !== s2 && s2.getLocation(t2) === ne.BOUNDARY;
        }
        linkAllDirectedEdges() {
          for (let t2 = this._nodes.iterator(); t2.hasNext(); ) {
            t2.next().getEdges().linkAllDirectedEdges();
          }
        }
        matchInSameDirection(t2, e2, n2, s2) {
          return !!t2.equals(n2) && (v.index(t2, e2, s2) === v.COLLINEAR && In.quadrant(t2, e2) === In.quadrant(n2, s2));
        }
        getEdgeEnds() {
          return this._edgeEndList;
        }
        debugPrint(t2) {
          O.out.print(t2);
        }
        getEdgeIterator() {
          return this._edges.iterator();
        }
        findEdgeInSameDirection(t2, e2) {
          for (let n2 = 0; n2 < this._edges.size(); n2++) {
            const s2 = this._edges.get(n2), i2 = s2.getCoordinates();
            if (this.matchInSameDirection(t2, e2, i2[0], i2[1])) return s2;
            if (this.matchInSameDirection(t2, e2, i2[i2.length - 1], i2[i2.length - 2])) return s2;
          }
          return null;
        }
        insertEdge(t2) {
          this._edges.add(t2);
        }
        findEdgeEnd(t2) {
          for (let e2 = this.getEdgeEnds().iterator(); e2.hasNext(); ) {
            const n2 = e2.next();
            if (n2.getEdge() === t2) return n2;
          }
          return null;
        }
        addEdges(t2) {
          for (let e2 = t2.iterator(); e2.hasNext(); ) {
            const t3 = e2.next();
            this._edges.add(t3);
            const n2 = new jn(t3, true), s2 = new jn(t3, false);
            n2.setSym(s2), s2.setSym(n2), this.add(n2), this.add(s2);
          }
        }
        add(t2) {
          this._nodes.add(t2), this._edgeEndList.add(t2);
        }
        getNodes() {
          return this._nodes.values();
        }
        findEdge(t2, e2) {
          for (let n2 = 0; n2 < this._edges.size(); n2++) {
            const s2 = this._edges.get(n2), i2 = s2.getCoordinates();
            if (t2.equals(i2[0]) && e2.equals(i2[1])) return s2;
          }
          return null;
        }
        getClass() {
          return Zn;
        }
        get interfaces_() {
          return [];
        }
      }
      Zn.constructor_ = function() {
        if (this._edges = new x(), this._nodes = null, this._edgeEndList = new x(), 0 === arguments.length) this._nodes = new Xn(new Kn());
        else if (1 === arguments.length) {
          const t2 = arguments[0];
          this._nodes = new Xn(t2);
        }
      };
      class Qn extends Zn {
        constructor() {
          super(), Qn.constructor_.apply(this, arguments);
        }
        static determineBoundary(t2, e2) {
          return t2.isInBoundary(e2) ? ne.BOUNDARY : ne.INTERIOR;
        }
        insertBoundaryPoint(t2, e2) {
          const n2 = this._nodes.addNode(e2).getLabel();
          let s2 = 1, i2 = ne.NONE;
          i2 = n2.getLocation(t2, Pn.ON), i2 === ne.BOUNDARY && s2++;
          const r2 = Qn.determineBoundary(this._boundaryNodeRule, s2);
          n2.setLocation(t2, r2);
        }
        computeSelfNodes() {
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return this.computeSelfNodes(t2, e2, false);
          }
          if (3 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = new Mn(t2, true, false);
            s2.setIsDoneIfProperInt(n2);
            const i2 = this.createEdgeSetIntersector(), r2 = this._parentGeom instanceof Dt || this._parentGeom instanceof bt || this._parentGeom instanceof At, o2 = e2 || !r2;
            return i2.computeIntersections(this._edges, s2, o2), this.addSelfIntersectionNodes(this._argIndex), s2;
          }
        }
        computeSplitEdges(t2) {
          for (let e2 = this._edges.iterator(); e2.hasNext(); ) {
            e2.next().eiList.addSplitEdges(t2);
          }
        }
        computeEdgeIntersections(t2, e2, n2) {
          const s2 = new Mn(e2, n2, true);
          return s2.setBoundaryNodes(this.getBoundaryNodes(), t2.getBoundaryNodes()), this.createEdgeSetIntersector().computeIntersections(this._edges, t2._edges, s2), s2;
        }
        getGeometry() {
          return this._parentGeom;
        }
        getBoundaryNodeRule() {
          return this._boundaryNodeRule;
        }
        hasTooFewPoints() {
          return this._hasTooFewPoints;
        }
        addPoint() {
          if (arguments[0] instanceof Pt) {
            const t2 = arguments[0].getCoordinate();
            this.insertPoint(this._argIndex, t2, ne.INTERIOR);
          } else if (arguments[0] instanceof g) {
            const t2 = arguments[0];
            this.insertPoint(this._argIndex, t2, ne.INTERIOR);
          }
        }
        addPolygon(t2) {
          this.addPolygonRing(t2.getExteriorRing(), ne.EXTERIOR, ne.INTERIOR);
          for (let e2 = 0; e2 < t2.getNumInteriorRing(); e2++) {
            const n2 = t2.getInteriorRingN(e2);
            this.addPolygonRing(n2, ne.INTERIOR, ne.EXTERIOR);
          }
        }
        addEdge(t2) {
          this.insertEdge(t2);
          const e2 = t2.getCoordinates();
          this.insertPoint(this._argIndex, e2[0], ne.BOUNDARY), this.insertPoint(this._argIndex, e2[e2.length - 1], ne.BOUNDARY);
        }
        addLineString(t2) {
          const e2 = X.removeRepeatedPoints(t2.getCoordinates());
          if (e2.length < 2) return this._hasTooFewPoints = true, this._invalidPoint = e2[0], null;
          const n2 = new Un(e2, new Fn(this._argIndex, ne.INTERIOR));
          this._lineEdgeMap.put(t2, n2), this.insertEdge(n2), u.isTrue(e2.length >= 2, "found LineString with single point"), this.insertBoundaryPoint(this._argIndex, e2[0]), this.insertBoundaryPoint(this._argIndex, e2[e2.length - 1]);
        }
        getInvalidPoint() {
          return this._invalidPoint;
        }
        getBoundaryPoints() {
          const t2 = this.getBoundaryNodes(), e2 = new Array(t2.size()).fill(null);
          let n2 = 0;
          for (let s2 = t2.iterator(); s2.hasNext(); ) {
            const t3 = s2.next();
            e2[n2++] = t3.getCoordinate().copy();
          }
          return e2;
        }
        getBoundaryNodes() {
          return null === this._boundaryNodes && (this._boundaryNodes = this._nodes.getBoundaryNodes(this._argIndex)), this._boundaryNodes;
        }
        addSelfIntersectionNode(t2, e2, n2) {
          if (this.isBoundaryNode(t2, e2)) return null;
          n2 === ne.BOUNDARY && this._useBoundaryDeterminationRule ? this.insertBoundaryPoint(t2, e2) : this.insertPoint(t2, e2, n2);
        }
        addPolygonRing(t2, e2, n2) {
          if (t2.isEmpty()) return null;
          const s2 = X.removeRepeatedPoints(t2.getCoordinates());
          if (s2.length < 4) return this._hasTooFewPoints = true, this._invalidPoint = s2[0], null;
          let i2 = e2, r2 = n2;
          v.isCCW(s2) && (i2 = n2, r2 = e2);
          const o2 = new Un(s2, new Fn(this._argIndex, ne.BOUNDARY, i2, r2));
          this._lineEdgeMap.put(t2, o2), this.insertEdge(o2), this.insertPoint(this._argIndex, s2[0], ne.BOUNDARY);
        }
        insertPoint(t2, e2, n2) {
          const s2 = this._nodes.addNode(e2), i2 = s2.getLabel();
          null === i2 ? s2._label = new Fn(t2, n2) : i2.setLocation(t2, n2);
        }
        createEdgeSetIntersector() {
          return new Dn();
        }
        addSelfIntersectionNodes(t2) {
          for (let e2 = this._edges.iterator(); e2.hasNext(); ) {
            const n2 = e2.next(), s2 = n2.getLabel().getLocation(t2);
            for (let e3 = n2.eiList.iterator(); e3.hasNext(); ) {
              const n3 = e3.next();
              this.addSelfIntersectionNode(t2, n3.coord, s2);
            }
          }
        }
        add() {
          if (!(1 === arguments.length && arguments[0] instanceof q)) return super.add.apply(this, arguments);
          {
            const t2 = arguments[0];
            if (t2.isEmpty()) return null;
            if (t2 instanceof At && (this._useBoundaryDeterminationRule = false), t2 instanceof bt) this.addPolygon(t2);
            else if (t2 instanceof Tt) this.addLineString(t2);
            else if (t2 instanceof Pt) this.addPoint(t2);
            else if (t2 instanceof Mt) this.addCollection(t2);
            else if (t2 instanceof ft) this.addCollection(t2);
            else if (t2 instanceof At) this.addCollection(t2);
            else {
              if (!(t2 instanceof _t)) throw new Z(t2.getClass().getName());
              this.addCollection(t2);
            }
          }
        }
        addCollection(t2) {
          for (let e2 = 0; e2 < t2.getNumGeometries(); e2++) {
            const n2 = t2.getGeometryN(e2);
            this.add(n2);
          }
        }
        locate(t2) {
          return _(this._parentGeom, Ot) && this._parentGeom.getNumGeometries() > 50 ? (null === this._areaPtLocator && (this._areaPtLocator = new ke(this._parentGeom)), this._areaPtLocator.locate(t2)) : this._ptLocator.locate(t2, this._parentGeom);
        }
        findEdge() {
          if (1 === arguments.length && arguments[0] instanceof Tt) {
            const t2 = arguments[0];
            return this._lineEdgeMap.get(t2);
          }
          return super.findEdge.apply(this, arguments);
        }
        getClass() {
          return Qn;
        }
        get interfaces_() {
          return [];
        }
      }
      Qn.constructor_ = function() {
        if (this._parentGeom = null, this._lineEdgeMap = new Ut(), this._boundaryNodeRule = null, this._useBoundaryDeterminationRule = true, this._argIndex = null, this._boundaryNodes = null, this._hasTooFewPoints = false, this._invalidPoint = null, this._areaPtLocator = null, this._ptLocator = new _n(), 2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          Qn.constructor_.call(this, t2, e2, V.OGC_SFS_BOUNDARY_RULE);
        } else if (3 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
          this._argIndex = t2, this._parentGeom = e2, this._boundaryNodeRule = n2, null !== e2 && this.add(e2);
        }
      };
      var Jn = Object.freeze({ __proto__: null, GeometryGraph: Qn });
      class $n {
        constructor() {
          $n.constructor_.apply(this, arguments);
        }
        visit(t2) {
        }
        getClass() {
          return $n;
        }
        get interfaces_() {
          return [];
        }
      }
      $n.constructor_ = function() {
      };
      class ts {
        constructor() {
          ts.constructor_.apply(this, arguments);
        }
        isRepeated() {
          return this._count > 1;
        }
        getRight() {
          return this._right;
        }
        getCoordinate() {
          return this._p;
        }
        setLeft(t2) {
          this._left = t2;
        }
        getX() {
          return this._p.x;
        }
        getData() {
          return this._data;
        }
        getCount() {
          return this._count;
        }
        getLeft() {
          return this._left;
        }
        getY() {
          return this._p.y;
        }
        increment() {
          this._count = this._count + 1;
        }
        setRight(t2) {
          this._right = t2;
        }
        getClass() {
          return ts;
        }
        get interfaces_() {
          return [];
        }
      }
      ts.constructor_ = function() {
        if (this._p = null, this._data = null, this._left = null, this._right = null, this._count = null, 2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          this._p = new g(t2), this._left = null, this._right = null, this._count = 1, this._data = e2;
        } else if (3 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
          this._p = new g(t2, e2), this._left = null, this._right = null, this._count = 1, this._data = n2;
        }
      };
      class es {
        constructor() {
          es.constructor_.apply(this, arguments);
        }
        static toCoordinates() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return es.toCoordinates(t2, false);
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = new I();
            for (let s2 = t2.iterator(); s2.hasNext(); ) {
              const t3 = s2.next(), i2 = e2 ? t3.getCount() : 1;
              for (let e3 = 0; e3 < i2; e3++) n2.add(t3.getCoordinate(), true);
            }
            return n2.toCoordinateArray();
          }
        }
        insert() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return this.insert(t2, null);
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            if (null === this._root) return this._root = new ts(t2, e2), this._root;
            if (this._tolerance > 0) {
              const e3 = this.findBestMatchNode(t2);
              if (null !== e3) return e3.increment(), e3;
            }
            return this.insertExact(t2, e2);
          }
        }
        query() {
          if (1 === arguments.length) {
            const t2 = arguments[0], e2 = new x();
            return this.query(t2, e2), e2;
          }
          if (2 === arguments.length) {
            if (arguments[0] instanceof N && _(arguments[1], m)) {
              const t2 = arguments[0], e2 = arguments[1];
              this.queryNode(this._root, t2, true, new class {
                get interfaces_() {
                  return [$n];
                }
                visit(t3) {
                  e2.add(t3);
                }
              }());
            } else if (arguments[0] instanceof N && _(arguments[1], $n)) {
              const t2 = arguments[0], e2 = arguments[1];
              this.queryNode(this._root, t2, true, e2);
            }
          }
        }
        queryNode(t2, e2, n2, s2) {
          if (null === t2) return null;
          let i2 = null, r2 = null, o2 = null;
          n2 ? (i2 = e2.getMinX(), r2 = e2.getMaxX(), o2 = t2.getX()) : (i2 = e2.getMinY(), r2 = e2.getMaxY(), o2 = t2.getY());
          const l2 = o2 <= r2;
          i2 < o2 && this.queryNode(t2.getLeft(), e2, !n2, s2), e2.contains(t2.getCoordinate()) && s2.visit(t2), l2 && this.queryNode(t2.getRight(), e2, !n2, s2);
        }
        findBestMatchNode(t2) {
          const e2 = new ns(t2, this._tolerance);
          return this.query(e2.queryEnvelope(), e2), e2.getNode();
        }
        isEmpty() {
          return null === this._root;
        }
        insertExact(t2, e2) {
          let n2 = this._root, s2 = this._root, i2 = true, r2 = true;
          for (; null !== n2; ) {
            if (null !== n2) {
              if (t2.distance(n2.getCoordinate()) <= this._tolerance) return n2.increment(), n2;
            }
            r2 = i2 ? t2.x < n2.getX() : t2.y < n2.getY(), s2 = n2, n2 = r2 ? n2.getLeft() : n2.getRight(), i2 = !i2;
          }
          this._numberOfNodes = this._numberOfNodes + 1;
          const o2 = new ts(t2, e2);
          return r2 ? s2.setLeft(o2) : s2.setRight(o2), o2;
        }
        getClass() {
          return es;
        }
        get interfaces_() {
          return [];
        }
      }
      class ns {
        constructor() {
          ns.constructor_.apply(this, arguments);
        }
        visit(t2) {
          const e2 = this._p.distance(t2.getCoordinate());
          if (!(e2 <= this._tolerance)) return null;
          let n2 = false;
          (null === this._matchNode || e2 < this._matchDist || null !== this._matchNode && e2 === this._matchDist && t2.getCoordinate().compareTo(this._matchNode.getCoordinate()) < 1) && (n2 = true), n2 && (this._matchNode = t2, this._matchDist = e2);
        }
        queryEnvelope() {
          const t2 = new N(this._p);
          return t2.expandBy(this._tolerance), t2;
        }
        getNode() {
          return this._matchNode;
        }
        getClass() {
          return ns;
        }
        get interfaces_() {
          return [$n];
        }
      }
      ns.constructor_ = function() {
        this._tolerance = null, this._matchNode = null, this._matchDist = 0, this._p = null;
        const t2 = arguments[0], e2 = arguments[1];
        this._p = t2, this._tolerance = e2;
      }, es.BestMatchVisitor = ns, es.constructor_ = function() {
        if (this._root = null, this._numberOfNodes = null, this._tolerance = null, 0 === arguments.length) es.constructor_.call(this, 0);
        else if (1 === arguments.length) {
          const t2 = arguments[0];
          this._tolerance = t2;
        }
      };
      var ss = Object.freeze({ __proto__: null, KdTree: es });
      class is {
        constructor() {
          is.constructor_.apply(this, arguments);
        }
        static getSubnodeIndex(t2, e2, n2) {
          let s2 = -1;
          return t2.getMinX() >= e2 && (t2.getMinY() >= n2 && (s2 = 3), t2.getMaxY() <= n2 && (s2 = 1)), t2.getMaxX() <= e2 && (t2.getMinY() >= n2 && (s2 = 2), t2.getMaxY() <= n2 && (s2 = 0)), s2;
        }
        hasChildren() {
          for (let t2 = 0; t2 < 4; t2++) if (null !== this._subnode[t2]) return true;
          return false;
        }
        isPrunable() {
          return !(this.hasChildren() || this.hasItems());
        }
        addAllItems(t2) {
          t2.addAll(this._items);
          for (let e2 = 0; e2 < 4; e2++) null !== this._subnode[e2] && this._subnode[e2].addAllItems(t2);
          return t2;
        }
        getNodeCount() {
          let t2 = 0;
          for (let e2 = 0; e2 < 4; e2++) null !== this._subnode[e2] && (t2 += this._subnode[e2].size());
          return t2 + 1;
        }
        size() {
          let t2 = 0;
          for (let e2 = 0; e2 < 4; e2++) null !== this._subnode[e2] && (t2 += this._subnode[e2].size());
          return t2 + this._items.size();
        }
        addAllItemsFromOverlapping(t2, e2) {
          if (!this.isSearchMatch(t2)) return null;
          e2.addAll(this._items);
          for (let n2 = 0; n2 < 4; n2++) null !== this._subnode[n2] && this._subnode[n2].addAllItemsFromOverlapping(t2, e2);
        }
        visitItems(t2, e2) {
          for (let t3 = this._items.iterator(); t3.hasNext(); ) e2.visitItem(t3.next());
        }
        hasItems() {
          return !this._items.isEmpty();
        }
        remove(t2, e2) {
          if (!this.isSearchMatch(t2)) return false;
          let n2 = false;
          for (let s2 = 0; s2 < 4; s2++) if (null !== this._subnode[s2] && (n2 = this._subnode[s2].remove(t2, e2), n2)) {
            this._subnode[s2].isPrunable() && (this._subnode[s2] = null);
            break;
          }
          return n2 || (n2 = this._items.remove(e2), n2);
        }
        visit(t2, e2) {
          if (!this.isSearchMatch(t2)) return null;
          this.visitItems(t2, e2);
          for (let n2 = 0; n2 < 4; n2++) null !== this._subnode[n2] && this._subnode[n2].visit(t2, e2);
        }
        getItems() {
          return this._items;
        }
        depth() {
          let t2 = 0;
          for (let e2 = 0; e2 < 4; e2++) if (null !== this._subnode[e2]) {
            const n2 = this._subnode[e2].depth();
            n2 > t2 && (t2 = n2);
          }
          return t2 + 1;
        }
        isEmpty() {
          let t2 = true;
          if (this._items.isEmpty()) {
            for (let e2 = 0; e2 < 4; e2++) if (null !== this._subnode[e2] && !this._subnode[e2].isEmpty()) {
              t2 = false;
              break;
            }
          } else t2 = false;
          return t2;
        }
        add(t2) {
          this._items.add(t2);
        }
        getClass() {
          return is;
        }
        get interfaces_() {
          return [a];
        }
      }
      function rs() {
      }
      is.constructor_ = function() {
        this._items = new x(), this._subnode = new Array(4).fill(null);
      }, rs.exponent = function(t2) {
        return function(t3, e2) {
          let n2, s2, i2, r2;
          const o2 = { 32: { d: 127, c: 128, b: 0, a: 0 }, 64: { d: 32752, c: 0, b: 0, a: 0 } }, l2 = { 32: 8, 64: 11 }[t3];
          r2 || (n2 = e2 < 0 || 1 / e2 < 0, isFinite(e2) || (r2 = o2[t3], n2 && (r2.d += 1 << t3 / 4 - 1), s2 = Math.pow(2, l2) - 1, i2 = 0));
          if (!r2) {
            for (s2 = { 32: 127, 64: 1023 }[t3], i2 = Math.abs(e2); i2 >= 2; ) s2++, i2 /= 2;
            for (; i2 < 1 && s2 > 0; ) s2--, i2 *= 2;
            s2 <= 0 && (i2 /= 2), 32 === t3 && s2 > 254 && (r2 = { d: n2 ? 255 : 127, c: 128, b: 0, a: 0 }, s2 = Math.pow(2, l2) - 1, i2 = 0);
          }
          return s2;
        }(64, t2) - 1023;
      }, rs.powerOf2 = function(t2) {
        return Math.pow(2, t2);
      };
      class os {
        constructor() {
          os.constructor_.apply(this, arguments);
        }
        static computeQuadLevel(t2) {
          const e2 = t2.getWidth(), n2 = t2.getHeight(), s2 = e2 > n2 ? e2 : n2;
          return rs.exponent(s2) + 1;
        }
        getLevel() {
          return this._level;
        }
        computeKey() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            for (this._level = os.computeQuadLevel(t2), this._env = new N(), this.computeKey(this._level, t2); !this._env.contains(t2); ) this._level += 1, this.computeKey(this._level, t2);
          } else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = rs.powerOf2(t2);
            this._pt.x = Math.floor(e2.getMinX() / n2) * n2, this._pt.y = Math.floor(e2.getMinY() / n2) * n2, this._env.init(this._pt.x, this._pt.x + n2, this._pt.y, this._pt.y + n2);
          }
        }
        getEnvelope() {
          return this._env;
        }
        getCentre() {
          return new g((this._env.getMinX() + this._env.getMaxX()) / 2, (this._env.getMinY() + this._env.getMaxY()) / 2);
        }
        getPoint() {
          return this._pt;
        }
        getClass() {
          return os;
        }
        get interfaces_() {
          return [];
        }
      }
      os.constructor_ = function() {
        this._pt = new g(), this._level = 0, this._env = null;
        const t2 = arguments[0];
        this.computeKey(t2);
      };
      class ls extends is {
        constructor() {
          super(), ls.constructor_.apply(this, arguments);
        }
        static createNode(t2) {
          const e2 = new os(t2);
          return new ls(e2.getEnvelope(), e2.getLevel());
        }
        static createExpanded(t2, e2) {
          const n2 = new N(e2);
          null !== t2 && n2.expandToInclude(t2._env);
          const s2 = ls.createNode(n2);
          return null !== t2 && s2.insertNode(t2), s2;
        }
        find(t2) {
          const e2 = is.getSubnodeIndex(t2, this._centrex, this._centrey);
          if (-1 === e2) return this;
          if (null !== this._subnode[e2]) {
            return this._subnode[e2].find(t2);
          }
          return this;
        }
        isSearchMatch(t2) {
          return null !== t2 && this._env.intersects(t2);
        }
        getSubnode(t2) {
          return null === this._subnode[t2] && (this._subnode[t2] = this.createSubnode(t2)), this._subnode[t2];
        }
        getEnvelope() {
          return this._env;
        }
        getNode(t2) {
          const e2 = is.getSubnodeIndex(t2, this._centrex, this._centrey);
          if (-1 !== e2) {
            return this.getSubnode(e2).getNode(t2);
          }
          return this;
        }
        createSubnode(t2) {
          let e2 = 0, n2 = 0, s2 = 0, i2 = 0;
          switch (t2) {
            case 0:
              e2 = this._env.getMinX(), n2 = this._centrex, s2 = this._env.getMinY(), i2 = this._centrey;
              break;
            case 1:
              e2 = this._centrex, n2 = this._env.getMaxX(), s2 = this._env.getMinY(), i2 = this._centrey;
              break;
            case 2:
              e2 = this._env.getMinX(), n2 = this._centrex, s2 = this._centrey, i2 = this._env.getMaxY();
              break;
            case 3:
              e2 = this._centrex, n2 = this._env.getMaxX(), s2 = this._centrey, i2 = this._env.getMaxY();
          }
          const r2 = new N(e2, n2, s2, i2);
          return new ls(r2, this._level - 1);
        }
        insertNode(t2) {
          u.isTrue(null === this._env || this._env.contains(t2._env));
          const e2 = is.getSubnodeIndex(t2._env, this._centrex, this._centrey);
          if (t2._level === this._level - 1) this._subnode[e2] = t2;
          else {
            const n2 = this.createSubnode(e2);
            n2.insertNode(t2), this._subnode[e2] = n2;
          }
        }
        getClass() {
          return ls;
        }
        get interfaces_() {
          return [];
        }
      }
      ls.constructor_ = function() {
        this._env = null, this._centrex = null, this._centrey = null, this._level = null;
        const t2 = arguments[0], e2 = arguments[1];
        this._env = t2, this._level = e2, this._centrex = (t2.getMinX() + t2.getMaxX()) / 2, this._centrey = (t2.getMinY() + t2.getMaxY()) / 2;
      };
      class as {
        constructor() {
          as.constructor_.apply(this, arguments);
        }
        static isZeroWidth(t2, e2) {
          const n2 = e2 - t2;
          if (0 === n2) return true;
          const s2 = n2 / Math.max(Math.abs(t2), Math.abs(e2));
          return rs.exponent(s2) <= as.MIN_BINARY_EXPONENT;
        }
        getClass() {
          return as;
        }
        get interfaces_() {
          return [];
        }
      }
      as.constructor_ = function() {
      }, as.MIN_BINARY_EXPONENT = -50;
      class cs extends is {
        constructor() {
          super(), cs.constructor_.apply(this, arguments);
        }
        insert(t2, e2) {
          const n2 = is.getSubnodeIndex(t2, cs.origin.x, cs.origin.y);
          if (-1 === n2) return this.add(e2), null;
          const s2 = this._subnode[n2];
          if (null === s2 || !s2.getEnvelope().contains(t2)) {
            const e3 = ls.createExpanded(s2, t2);
            this._subnode[n2] = e3;
          }
          this.insertContained(this._subnode[n2], t2, e2);
        }
        isSearchMatch(t2) {
          return true;
        }
        insertContained(t2, e2, n2) {
          u.isTrue(t2.getEnvelope().contains(e2));
          const s2 = as.isZeroWidth(e2.getMinX(), e2.getMaxX()), i2 = as.isZeroWidth(e2.getMinY(), e2.getMaxY());
          let r2 = null;
          r2 = s2 || i2 ? t2.find(e2) : t2.getNode(e2), r2.add(n2);
        }
        getClass() {
          return cs;
        }
        get interfaces_() {
          return [];
        }
      }
      cs.constructor_ = function() {
      }, cs.origin = new g(0, 0);
      class hs {
        constructor() {
          hs.constructor_.apply(this, arguments);
        }
        insert(t2, e2) {
        }
        remove(t2, e2) {
        }
        query() {
        }
        getClass() {
          return hs;
        }
        get interfaces_() {
          return [];
        }
      }
      hs.constructor_ = function() {
      };
      class us {
        constructor() {
          us.constructor_.apply(this, arguments);
        }
        static ensureExtent(t2, e2) {
          let n2 = t2.getMinX(), s2 = t2.getMaxX(), i2 = t2.getMinY(), r2 = t2.getMaxY();
          return n2 !== s2 && i2 !== r2 ? t2 : (n2 === s2 && (n2 -= e2 / 2, s2 = n2 + e2 / 2), i2 === r2 && (i2 -= e2 / 2, r2 = i2 + e2 / 2), new N(n2, s2, i2, r2));
        }
        size() {
          return null !== this._root ? this._root.size() : 0;
        }
        insert(t2, e2) {
          this.collectStats(t2);
          const n2 = us.ensureExtent(t2, this._minExtent);
          this._root.insert(n2, e2);
        }
        query() {
          if (1 === arguments.length) {
            const t2 = arguments[0], e2 = new Ye();
            return this.query(t2, e2), e2.getItems();
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            this._root.visit(t2, e2);
          }
        }
        queryAll() {
          const t2 = new x();
          return this._root.addAllItems(t2), t2;
        }
        remove(t2, e2) {
          const n2 = us.ensureExtent(t2, this._minExtent);
          return this._root.remove(n2, e2);
        }
        collectStats(t2) {
          const e2 = t2.getWidth();
          e2 < this._minExtent && e2 > 0 && (this._minExtent = e2);
          const n2 = t2.getHeight();
          n2 < this._minExtent && n2 > 0 && (this._minExtent = n2);
        }
        depth() {
          return null !== this._root ? this._root.depth() : 0;
        }
        isEmpty() {
          return null === this._root || this._root.isEmpty();
        }
        getClass() {
          return us;
        }
        get interfaces_() {
          return [hs, a];
        }
      }
      us.constructor_ = function() {
        this._root = null, this._minExtent = 1, this._root = new cs();
      }, us.serialVersionUID = -7461163625812743e3;
      var gs = Object.freeze({ __proto__: null, Quadtree: us });
      class ds {
        constructor() {
          ds.constructor_.apply(this, arguments);
        }
        getBounds() {
        }
        getClass() {
          return ds;
        }
        get interfaces_() {
          return [];
        }
      }
      ds.constructor_ = function() {
      };
      class _s {
        constructor() {
          _s.constructor_.apply(this, arguments);
        }
        getItem() {
          return this._item;
        }
        getBounds() {
          return this._bounds;
        }
        getClass() {
          return _s;
        }
        get interfaces_() {
          return [ds, a];
        }
      }
      _s.constructor_ = function() {
        this._bounds = null, this._item = null;
        const t2 = arguments[0], e2 = arguments[1];
        this._bounds = t2, this._item = e2;
      };
      class fs {
        constructor() {
          fs.constructor_.apply(this, arguments);
        }
        poll() {
          if (this.isEmpty()) return null;
          const t2 = this._items.get(1);
          return this._items.set(1, this._items.get(this._size)), this._size -= 1, this.reorder(1), t2;
        }
        size() {
          return this._size;
        }
        reorder(t2) {
          let e2 = null;
          const n2 = this._items.get(t2);
          for (; 2 * t2 <= this._size && (e2 = 2 * t2, e2 !== this._size && this._items.get(e2 + 1).compareTo(this._items.get(e2)) < 0 && e2++, this._items.get(e2).compareTo(n2) < 0); t2 = e2) this._items.set(t2, this._items.get(e2));
          this._items.set(t2, n2);
        }
        clear() {
          this._size = 0, this._items.clear();
        }
        peek() {
          if (this.isEmpty()) return null;
          return this._items.get(1);
        }
        isEmpty() {
          return 0 === this._size;
        }
        add(t2) {
          this._items.add(null), this._size += 1;
          let e2 = this._size;
          for (this._items.set(0, t2); t2.compareTo(this._items.get(Math.trunc(e2 / 2))) < 0; e2 /= 2) this._items.set(e2, this._items.get(Math.trunc(e2 / 2)));
          this._items.set(e2, t2);
        }
        getClass() {
          return fs;
        }
        get interfaces_() {
          return [];
        }
      }
      fs.constructor_ = function() {
        this._size = null, this._items = null, this._size = 0, this._items = new x(), this._items.add(null);
      };
      class ps {
        constructor() {
          ps.constructor_.apply(this, arguments);
        }
        getLevel() {
          return this._level;
        }
        size() {
          return this._childBoundables.size();
        }
        getChildBoundables() {
          return this._childBoundables;
        }
        addChildBoundable(t2) {
          u.isTrue(null === this._bounds), this._childBoundables.add(t2);
        }
        isEmpty() {
          return this._childBoundables.isEmpty();
        }
        getBounds() {
          return null === this._bounds && (this._bounds = this.computeBounds()), this._bounds;
        }
        getClass() {
          return ps;
        }
        get interfaces_() {
          return [ds, a];
        }
      }
      ps.constructor_ = function() {
        if (this._childBoundables = new x(), this._bounds = null, this._level = null, 0 === arguments.length) ;
        else if (1 === arguments.length) {
          const t2 = arguments[0];
          this._level = t2;
        }
      }, ps.serialVersionUID = 6493722185909574e3;
      class ms {
        constructor() {
          ms.constructor_.apply(this, arguments);
        }
        static area(t2) {
          return t2.getBounds().getArea();
        }
        static isComposite(t2) {
          return t2 instanceof ps;
        }
        expandToQueue(t2, e2) {
          const s2 = ms.isComposite(this._boundable1), i2 = ms.isComposite(this._boundable2);
          if (s2 && i2) return ms.area(this._boundable1) > ms.area(this._boundable2) ? (this.expand(this._boundable1, this._boundable2, t2, e2), null) : (this.expand(this._boundable2, this._boundable1, t2, e2), null);
          if (s2) return this.expand(this._boundable1, this._boundable2, t2, e2), null;
          if (i2) return this.expand(this._boundable2, this._boundable1, t2, e2), null;
          throw new n("neither boundable is composite");
        }
        isLeaves() {
          return !(ms.isComposite(this._boundable1) || ms.isComposite(this._boundable2));
        }
        compareTo(t2) {
          const e2 = t2;
          return this._distance < e2._distance ? -1 : this._distance > e2._distance ? 1 : 0;
        }
        expand(t2, e2, n2, s2) {
          for (let i2 = t2.getChildBoundables().iterator(); i2.hasNext(); ) {
            const t3 = i2.next(), r2 = new ms(t3, e2, this._itemDistance);
            r2.getDistance() < s2 && n2.add(r2);
          }
        }
        getBoundable(t2) {
          return 0 === t2 ? this._boundable1 : this._boundable2;
        }
        getDistance() {
          return this._distance;
        }
        distance() {
          return this.isLeaves() ? this._itemDistance.distance(this._boundable1, this._boundable2) : this._boundable1.getBounds().distance(this._boundable2.getBounds());
        }
        getClass() {
          return ms;
        }
        get interfaces_() {
          return [r];
        }
      }
      ms.constructor_ = function() {
        this._boundable1 = null, this._boundable2 = null, this._distance = null, this._itemDistance = null;
        const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
        this._boundable1 = t2, this._boundable2 = e2, this._itemDistance = n2, this._distance = this.distance();
      };
      class ys {
        constructor() {
          ys.constructor_.apply(this, arguments);
        }
        static compareDoubles(t2, e2) {
          return t2 > e2 ? 1 : t2 < e2 ? -1 : 0;
        }
        queryInternal() {
          if (_(arguments[2], Ae) && arguments[0] instanceof Object && arguments[1] instanceof ps) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = e2.getChildBoundables();
            for (let e3 = 0; e3 < s2.size(); e3++) {
              const i2 = s2.get(e3);
              this.getIntersectsOp().intersects(i2.getBounds(), t2) && (i2 instanceof ps ? this.queryInternal(t2, i2, n2) : i2 instanceof _s ? n2.visitItem(i2.getItem()) : u.shouldNeverReachHere());
            }
          } else if (_(arguments[2], m) && arguments[0] instanceof Object && arguments[1] instanceof ps) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = e2.getChildBoundables();
            for (let e3 = 0; e3 < s2.size(); e3++) {
              const i2 = s2.get(e3);
              this.getIntersectsOp().intersects(i2.getBounds(), t2) && (i2 instanceof ps ? this.queryInternal(t2, i2, n2) : i2 instanceof _s ? n2.add(i2.getItem()) : u.shouldNeverReachHere());
            }
          }
        }
        getNodeCapacity() {
          return this._nodeCapacity;
        }
        lastNode(t2) {
          return t2.get(t2.size() - 1);
        }
        size() {
          if (0 === arguments.length) return this.isEmpty() ? 0 : (this.build(), this.size(this._root));
          if (1 === arguments.length) {
            let t2 = 0;
            for (let e2 = arguments[0].getChildBoundables().iterator(); e2.hasNext(); ) {
              const n2 = e2.next();
              n2 instanceof ps ? t2 += this.size(n2) : n2 instanceof _s && (t2 += 1);
            }
            return t2;
          }
        }
        removeItem(t2, e2) {
          let n2 = null;
          for (let s2 = t2.getChildBoundables().iterator(); s2.hasNext(); ) {
            const t3 = s2.next();
            t3 instanceof _s && t3.getItem() === e2 && (n2 = t3);
          }
          return null !== n2 && (t2.getChildBoundables().remove(n2), true);
        }
        itemsTree() {
          if (0 === arguments.length) {
            this.build();
            const t2 = this.itemsTree(this._root);
            return null === t2 ? new x() : t2;
          }
          if (1 === arguments.length) {
            const t2 = arguments[0], e2 = new x();
            for (let n2 = t2.getChildBoundables().iterator(); n2.hasNext(); ) {
              const t3 = n2.next();
              if (t3 instanceof ps) {
                const n3 = this.itemsTree(t3);
                null !== n3 && e2.add(n3);
              } else t3 instanceof _s ? e2.add(t3.getItem()) : u.shouldNeverReachHere();
            }
            return e2.size() <= 0 ? null : e2;
          }
        }
        insert(t2, e2) {
          u.isTrue(!this._built, "Cannot insert items into an STR packed R-tree after it has been built."), this._itemBoundables.add(new _s(t2, e2));
        }
        boundablesAtLevel() {
          if (1 === arguments.length) {
            const t2 = arguments[0], e2 = new x();
            return this.boundablesAtLevel(t2, this._root, e2), e2;
          }
          if (3 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
            if (u.isTrue(t2 > -2), e2.getLevel() === t2) return n2.add(e2), null;
            for (let s2 = e2.getChildBoundables().iterator(); s2.hasNext(); ) {
              const e3 = s2.next();
              e3 instanceof ps ? this.boundablesAtLevel(t2, e3, n2) : (u.isTrue(e3 instanceof _s), -1 === t2 && n2.add(e3));
            }
            return null;
          }
        }
        query() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            this.build();
            const e2 = new x();
            return this.isEmpty() || this.getIntersectsOp().intersects(this._root.getBounds(), t2) && this.queryInternal(t2, this._root, e2), e2;
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            if (this.build(), this.isEmpty()) return null;
            this.getIntersectsOp().intersects(this._root.getBounds(), t2) && this.queryInternal(t2, this._root, e2);
          }
        }
        build() {
          if (this._built) return null;
          this._root = this._itemBoundables.isEmpty() ? this.createNode(0) : this.createHigherLevels(this._itemBoundables, -1), this._itemBoundables = null, this._built = true;
        }
        getRoot() {
          return this.build(), this._root;
        }
        remove() {
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return this.build(), !!this.getIntersectsOp().intersects(this._root.getBounds(), t2) && this.remove(t2, this._root, e2);
          }
          if (3 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
            let s2 = this.removeItem(e2, n2);
            if (s2) return true;
            let i2 = null;
            for (let r2 = e2.getChildBoundables().iterator(); r2.hasNext(); ) {
              const e3 = r2.next();
              if (this.getIntersectsOp().intersects(e3.getBounds(), t2) && (e3 instanceof ps && (s2 = this.remove(t2, e3, n2), s2))) {
                i2 = e3;
                break;
              }
            }
            return null !== i2 && i2.getChildBoundables().isEmpty() && e2.getChildBoundables().remove(i2), s2;
          }
        }
        createHigherLevels(t2, e2) {
          u.isTrue(!t2.isEmpty());
          const n2 = this.createParentBoundables(t2, e2 + 1);
          return 1 === n2.size() ? n2.get(0) : this.createHigherLevels(n2, e2 + 1);
        }
        depth() {
          if (0 === arguments.length) return this.isEmpty() ? 0 : (this.build(), this.depth(this._root));
          if (1 === arguments.length) {
            let t2 = 0;
            for (let e2 = arguments[0].getChildBoundables().iterator(); e2.hasNext(); ) {
              const n2 = e2.next();
              if (n2 instanceof ps) {
                const e3 = this.depth(n2);
                e3 > t2 && (t2 = e3);
              }
            }
            return t2 + 1;
          }
        }
        createParentBoundables(t2, e2) {
          u.isTrue(!t2.isEmpty());
          const n2 = new x();
          n2.add(this.createNode(e2));
          const s2 = new x(t2);
          Ee.sort(s2, this.getComparator());
          for (let t3 = s2.iterator(); t3.hasNext(); ) {
            const s3 = t3.next();
            this.lastNode(n2).getChildBoundables().size() === this.getNodeCapacity() && n2.add(this.createNode(e2)), this.lastNode(n2).addChildBoundable(s3);
          }
          return n2;
        }
        isEmpty() {
          return this._built ? this._root.isEmpty() : this._itemBoundables.isEmpty();
        }
        getClass() {
          return ys;
        }
        get interfaces_() {
          return [a];
        }
      }
      ys.IntersectsOp = function() {
      }, ys.constructor_ = function() {
        if (this._root = null, this._built = false, this._itemBoundables = new x(), this._nodeCapacity = null, 0 === arguments.length) ys.constructor_.call(this, ys.DEFAULT_NODE_CAPACITY);
        else if (1 === arguments.length) {
          const t2 = arguments[0];
          u.isTrue(t2 > 1, "Node capacity must be greater than 1"), this._nodeCapacity = t2;
        }
      }, ys.serialVersionUID = -3886435814360241e3, ys.DEFAULT_NODE_CAPACITY = 10;
      class xs {
        constructor() {
          xs.constructor_.apply(this, arguments);
        }
        distance(t2, e2) {
        }
        getClass() {
          return xs;
        }
        get interfaces_() {
          return [];
        }
      }
      xs.constructor_ = function() {
      };
      class Es extends ys {
        constructor() {
          super(), Es.constructor_.apply(this, arguments);
        }
        static centreX(t2) {
          return Es.avg(t2.getMinX(), t2.getMaxX());
        }
        static avg(t2, e2) {
          return (t2 + e2) / 2;
        }
        static getItems(t2) {
          const e2 = new Array(t2.size()).fill(null);
          let n2 = 0;
          for (; !t2.isEmpty(); ) {
            const s2 = t2.poll();
            e2[n2] = s2.getBoundable(0).getItem(), n2++;
          }
          return e2;
        }
        static centreY(t2) {
          return Es.avg(t2.getMinY(), t2.getMaxY());
        }
        createParentBoundablesFromVerticalSlices(t2, e2) {
          u.isTrue(t2.length > 0);
          const n2 = new x();
          for (let s2 = 0; s2 < t2.length; s2++) n2.addAll(this.createParentBoundablesFromVerticalSlice(t2[s2], e2));
          return n2;
        }
        createNode(t2) {
          return new Is(t2);
        }
        size() {
          return 0 === arguments.length ? super.size.call(this) : super.size.apply(this, arguments);
        }
        insert() {
          if (!(2 === arguments.length && arguments[1] instanceof Object && arguments[0] instanceof N)) return super.insert.apply(this, arguments);
          {
            const t2 = arguments[0], e2 = arguments[1];
            if (t2.isNull()) return null;
            super.insert.call(this, t2, e2);
          }
        }
        getIntersectsOp() {
          return Es.intersectsOp;
        }
        verticalSlices(t2, e2) {
          const n2 = Math.trunc(Math.ceil(t2.size() / e2)), s2 = new Array(e2).fill(null), i2 = t2.iterator();
          for (let t3 = 0; t3 < e2; t3++) {
            s2[t3] = new x();
            let e3 = 0;
            for (; i2.hasNext() && e3 < n2; ) {
              const n3 = i2.next();
              s2[t3].add(n3), e3++;
            }
          }
          return s2;
        }
        query() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return super.query.call(this, t2);
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            super.query.call(this, t2, e2);
          }
        }
        getComparator() {
          return Es.yComparator;
        }
        createParentBoundablesFromVerticalSlice(t2, e2) {
          return super.createParentBoundables.call(this, t2, e2);
        }
        remove() {
          if (2 === arguments.length && arguments[1] instanceof Object && arguments[0] instanceof N) {
            const t2 = arguments[0], e2 = arguments[1];
            return super.remove.call(this, t2, e2);
          }
          return super.remove.apply(this, arguments);
        }
        depth() {
          return 0 === arguments.length ? super.depth.call(this) : super.depth.apply(this, arguments);
        }
        createParentBoundables(t2, e2) {
          u.isTrue(!t2.isEmpty());
          const n2 = Math.trunc(Math.ceil(t2.size() / this.getNodeCapacity())), s2 = new x(t2);
          Ee.sort(s2, Es.xComparator);
          const i2 = this.verticalSlices(s2, Math.trunc(Math.ceil(Math.sqrt(n2))));
          return this.createParentBoundablesFromVerticalSlices(i2, e2);
        }
        nearestNeighbour() {
          if (1 === arguments.length) {
            if (_(arguments[0], xs)) {
              const t2 = arguments[0], e2 = new ms(this.getRoot(), this.getRoot(), t2);
              return this.nearestNeighbour(e2);
            }
            if (arguments[0] instanceof ms) {
              const t2 = arguments[0];
              return this.nearestNeighbour(t2, i.POSITIVE_INFINITY);
            }
          } else if (2 === arguments.length) {
            if (arguments[0] instanceof Es && _(arguments[1], xs)) {
              const t2 = arguments[0], e2 = arguments[1], n2 = new ms(this.getRoot(), t2.getRoot(), e2);
              return this.nearestNeighbour(n2);
            }
            if (arguments[0] instanceof ms && "number" == typeof arguments[1]) {
              const t2 = arguments[0];
              let e2 = arguments[1], n2 = null;
              const s2 = new fs();
              for (s2.add(t2); !s2.isEmpty() && e2 > 0; ) {
                const t3 = s2.poll(), i2 = t3.getDistance();
                if (i2 >= e2) break;
                t3.isLeaves() ? (e2 = i2, n2 = t3) : t3.expandToQueue(s2, e2);
              }
              return [n2.getBoundable(0).getItem(), n2.getBoundable(1).getItem()];
            }
            if (arguments[0] instanceof ms && Number.isInteger(arguments[1])) {
              const t2 = arguments[0], e2 = arguments[1];
              return this.nearestNeighbour(t2, i.POSITIVE_INFINITY, e2);
            }
          } else if (3 === arguments.length) {
            if (_(arguments[2], xs) && arguments[0] instanceof N && arguments[1] instanceof Object) {
              const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = new _s(t2, e2), i2 = new ms(this.getRoot(), s2, n2);
              return this.nearestNeighbour(i2)[0];
            }
            if (Number.isInteger(arguments[2]) && arguments[0] instanceof ms && "number" == typeof arguments[1]) {
              const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
              let s2 = e2;
              const i2 = new fs();
              i2.add(t2);
              const r2 = new fs();
              for (; !i2.isEmpty() && s2 >= 0; ) {
                const t3 = i2.poll(), e3 = t3.getDistance();
                if (e3 >= s2) break;
                if (t3.isLeaves()) if (r2.size() < n2) r2.add(t3);
                else {
                  r2.peek().getDistance() > e3 && (r2.poll(), r2.add(t3)), s2 = r2.peek().getDistance();
                }
                else t3.expandToQueue(i2, s2);
              }
              return Es.getItems(r2);
            }
          } else if (4 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3], i2 = new _s(t2, e2), r2 = new ms(this.getRoot(), i2, n2);
            return this.nearestNeighbour(r2, s2);
          }
        }
        getClass() {
          return Es;
        }
        get interfaces_() {
          return [hs, a];
        }
      }
      class Is extends ps {
        constructor() {
          super(), Is.constructor_.apply(this, arguments);
        }
        computeBounds() {
          let t2 = null;
          for (let e2 = this.getChildBoundables().iterator(); e2.hasNext(); ) {
            const n2 = e2.next();
            null === t2 ? t2 = new N(n2.getBounds()) : t2.expandToInclude(n2.getBounds());
          }
          return t2;
        }
        getClass() {
          return Is;
        }
        get interfaces_() {
          return [];
        }
      }
      Is.constructor_ = function() {
        const t2 = arguments[0];
        ps.constructor_.call(this, t2);
      }, Es.STRtreeNode = Is, Es.constructor_ = function() {
        if (0 === arguments.length) Es.constructor_.call(this, Es.DEFAULT_NODE_CAPACITY);
        else if (1 === arguments.length) {
          const t2 = arguments[0];
          ys.constructor_.call(this, t2);
        }
      }, Es.serialVersionUID = 259274702368956900, Es.xComparator = new class {
        get interfaces_() {
          return [l];
        }
        compare(t2, e2) {
          return ys.compareDoubles(Es.centreX(t2.getBounds()), Es.centreX(e2.getBounds()));
        }
      }(), Es.yComparator = new class {
        get interfaces_() {
          return [l];
        }
        compare(t2, e2) {
          return ys.compareDoubles(Es.centreY(t2.getBounds()), Es.centreY(e2.getBounds()));
        }
      }(), Es.intersectsOp = new class {
        get interfaces_() {
          return [IntersectsOp];
        }
        intersects(t2, e2) {
          return t2.intersects(e2);
        }
      }(), Es.DEFAULT_NODE_CAPACITY = 10;
      var Ns = Object.freeze({ __proto__: null, STRtree: Es }), Cs = Object.freeze({ __proto__: null, kdtree: ss, quadtree: gs, strtree: Ns });
      const Ss = ["Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon"];
      class ws {
        constructor(t2) {
          this.geometryFactory = t2 || new Ht();
        }
        read(t2) {
          let e2;
          e2 = "string" == typeof t2 ? JSON.parse(t2) : t2;
          const n2 = e2.type;
          if (!Ls[n2]) throw new Error("Unknown GeoJSON type: " + e2.type);
          return -1 !== Ss.indexOf(n2) ? Ls[n2].call(this, e2.coordinates) : "GeometryCollection" === n2 ? Ls[n2].call(this, e2.geometries) : Ls[n2].call(this, e2);
        }
        write(t2) {
          const e2 = t2.getGeometryType();
          if (!Ts[e2]) throw new Error("Geometry is not supported");
          return Ts[e2].call(this, t2);
        }
      }
      const Ls = { Feature: function(t2) {
        const e2 = {};
        for (const n2 in t2) e2[n2] = t2[n2];
        if (t2.geometry) {
          const n2 = t2.geometry.type;
          if (!Ls[n2]) throw new Error("Unknown GeoJSON type: " + t2.type);
          e2.geometry = this.read(t2.geometry);
        }
        return t2.bbox && (e2.bbox = Ls.bbox.call(this, t2.bbox)), e2;
      }, FeatureCollection: function(t2) {
        const e2 = {};
        if (t2.features) {
          e2.features = [];
          for (let n2 = 0; n2 < t2.features.length; ++n2) e2.features.push(this.read(t2.features[n2]));
        }
        return t2.bbox && (e2.bbox = this.parse.bbox.call(this, t2.bbox)), e2;
      }, coordinates: function(t2) {
        const e2 = [];
        for (let n2 = 0; n2 < t2.length; ++n2) {
          const s2 = t2[n2];
          e2.push(new g(s2[0], s2[1]));
        }
        return e2;
      }, bbox: function(t2) {
        return this.geometryFactory.createLinearRing([new g(t2[0], t2[1]), new g(t2[2], t2[1]), new g(t2[2], t2[3]), new g(t2[0], t2[3]), new g(t2[0], t2[1])]);
      }, Point: function(t2) {
        const e2 = new g(t2[0], t2[1]);
        return this.geometryFactory.createPoint(e2);
      }, MultiPoint: function(t2) {
        const e2 = [];
        for (let n2 = 0; n2 < t2.length; ++n2) e2.push(Ls.Point.call(this, t2[n2]));
        return this.geometryFactory.createMultiPoint(e2);
      }, LineString: function(t2) {
        const e2 = Ls.coordinates.call(this, t2);
        return this.geometryFactory.createLineString(e2);
      }, MultiLineString: function(t2) {
        const e2 = [];
        for (let n2 = 0; n2 < t2.length; ++n2) e2.push(Ls.LineString.call(this, t2[n2]));
        return this.geometryFactory.createMultiLineString(e2);
      }, Polygon: function(t2) {
        const e2 = Ls.coordinates.call(this, t2[0]), n2 = this.geometryFactory.createLinearRing(e2), s2 = [];
        for (let e3 = 1; e3 < t2.length; ++e3) {
          const n3 = t2[e3], i2 = Ls.coordinates.call(this, n3), r2 = this.geometryFactory.createLinearRing(i2);
          s2.push(r2);
        }
        return this.geometryFactory.createPolygon(n2, s2);
      }, MultiPolygon: function(t2) {
        const e2 = [];
        for (let n2 = 0; n2 < t2.length; ++n2) {
          const s2 = t2[n2];
          e2.push(Ls.Polygon.call(this, s2));
        }
        return this.geometryFactory.createMultiPolygon(e2);
      }, GeometryCollection: function(t2) {
        const e2 = [];
        for (let n2 = 0; n2 < t2.length; ++n2) {
          const s2 = t2[n2];
          e2.push(this.read(s2));
        }
        return this.geometryFactory.createGeometryCollection(e2);
      } }, Ts = { coordinate: function(t2) {
        return [t2.x, t2.y];
      }, Point: function(t2) {
        return { type: "Point", coordinates: Ts.coordinate.call(this, t2.getCoordinate()) };
      }, MultiPoint: function(t2) {
        const e2 = [];
        for (let n2 = 0; n2 < t2._geometries.length; ++n2) {
          const s2 = t2._geometries[n2], i2 = Ts.Point.call(this, s2);
          e2.push(i2.coordinates);
        }
        return { type: "MultiPoint", coordinates: e2 };
      }, LineString: function(t2) {
        const e2 = [], n2 = t2.getCoordinates();
        for (let t3 = 0; t3 < n2.length; ++t3) {
          const s2 = n2[t3];
          e2.push(Ts.coordinate.call(this, s2));
        }
        return { type: "LineString", coordinates: e2 };
      }, MultiLineString: function(t2) {
        const e2 = [];
        for (let n2 = 0; n2 < t2._geometries.length; ++n2) {
          const s2 = t2._geometries[n2], i2 = Ts.LineString.call(this, s2);
          e2.push(i2.coordinates);
        }
        return { type: "MultiLineString", coordinates: e2 };
      }, Polygon: function(t2) {
        const e2 = [], n2 = Ts.LineString.call(this, t2._shell);
        e2.push(n2.coordinates);
        for (let n3 = 0; n3 < t2._holes.length; ++n3) {
          const s2 = t2._holes[n3], i2 = Ts.LineString.call(this, s2);
          e2.push(i2.coordinates);
        }
        return { type: "Polygon", coordinates: e2 };
      }, MultiPolygon: function(t2) {
        const e2 = [];
        for (let n2 = 0; n2 < t2._geometries.length; ++n2) {
          const s2 = t2._geometries[n2], i2 = Ts.Polygon.call(this, s2);
          e2.push(i2.coordinates);
        }
        return { type: "MultiPolygon", coordinates: e2 };
      }, GeometryCollection: function(t2) {
        const e2 = [];
        for (let n2 = 0; n2 < t2._geometries.length; ++n2) {
          const s2 = t2._geometries[n2], i2 = s2.getGeometryType();
          e2.push(Ts[i2].call(this, s2));
        }
        return { type: "GeometryCollection", geometries: e2 };
      } };
      function Rs(t2) {
        return [t2.x, t2.y];
      }
      var Ps = Object.freeze({ __proto__: null, GeoJSONReader: class {
        constructor(t2) {
          this.parser = new ws(t2 || new Ht());
        }
        read(t2) {
          return this.parser.read(t2);
        }
      }, GeoJSONWriter: class {
        constructor() {
          this.parser = new ws(this.geometryFactory);
        }
        write(t2) {
          return this.parser.write(t2);
        }
      }, OL3Parser: class {
        constructor(t2, e2) {
          this.geometryFactory = t2 || new Ht(), this.ol = e2 || "undefined" != typeof ol && ol;
        }
        inject(t2, e2, n2, s2, i2, r2, o2, l2) {
          this.ol = { geom: { Point: t2, LineString: e2, LinearRing: n2, Polygon: s2, MultiPoint: i2, MultiLineString: r2, MultiPolygon: o2, GeometryCollection: l2 } };
        }
        read(t2) {
          const e2 = this.ol;
          return t2 instanceof e2.geom.Point ? this.convertFromPoint(t2) : t2 instanceof e2.geom.LineString ? this.convertFromLineString(t2) : t2 instanceof e2.geom.LinearRing ? this.convertFromLinearRing(t2) : t2 instanceof e2.geom.Polygon ? this.convertFromPolygon(t2) : t2 instanceof e2.geom.MultiPoint ? this.convertFromMultiPoint(t2) : t2 instanceof e2.geom.MultiLineString ? this.convertFromMultiLineString(t2) : t2 instanceof e2.geom.MultiPolygon ? this.convertFromMultiPolygon(t2) : t2 instanceof e2.geom.GeometryCollection ? this.convertFromCollection(t2) : void 0;
        }
        convertFromPoint(t2) {
          const e2 = t2.getCoordinates();
          return this.geometryFactory.createPoint(new g(e2[0], e2[1]));
        }
        convertFromLineString(t2) {
          return this.geometryFactory.createLineString(t2.getCoordinates().map(function(t3) {
            return new g(t3[0], t3[1]);
          }));
        }
        convertFromLinearRing(t2) {
          return this.geometryFactory.createLinearRing(t2.getCoordinates().map(function(t3) {
            return new g(t3[0], t3[1]);
          }));
        }
        convertFromPolygon(t2) {
          const e2 = t2.getLinearRings();
          let n2 = null;
          const s2 = [];
          for (let t3 = 0; t3 < e2.length; t3++) {
            const i2 = this.convertFromLinearRing(e2[t3]);
            0 === t3 ? n2 = i2 : s2.push(i2);
          }
          return this.geometryFactory.createPolygon(n2, s2);
        }
        convertFromMultiPoint(t2) {
          const e2 = t2.getPoints().map(function(t3) {
            return this.convertFromPoint(t3);
          }, this);
          return this.geometryFactory.createMultiPoint(e2);
        }
        convertFromMultiLineString(t2) {
          const e2 = t2.getLineStrings().map(function(t3) {
            return this.convertFromLineString(t3);
          }, this);
          return this.geometryFactory.createMultiLineString(e2);
        }
        convertFromMultiPolygon(t2) {
          const e2 = t2.getPolygons().map(function(t3) {
            return this.convertFromPolygon(t3);
          }, this);
          return this.geometryFactory.createMultiPolygon(e2);
        }
        convertFromCollection(t2) {
          const e2 = t2.getGeometries().map(function(t3) {
            return this.read(t3);
          }, this);
          return this.geometryFactory.createGeometryCollection(e2);
        }
        write(t2) {
          return "Point" === t2.getGeometryType() ? this.convertToPoint(t2.getCoordinate()) : "LineString" === t2.getGeometryType() ? this.convertToLineString(t2) : "LinearRing" === t2.getGeometryType() ? this.convertToLinearRing(t2) : "Polygon" === t2.getGeometryType() ? this.convertToPolygon(t2) : "MultiPoint" === t2.getGeometryType() ? this.convertToMultiPoint(t2) : "MultiLineString" === t2.getGeometryType() ? this.convertToMultiLineString(t2) : "MultiPolygon" === t2.getGeometryType() ? this.convertToMultiPolygon(t2) : "GeometryCollection" === t2.getGeometryType() ? this.convertToCollection(t2) : void 0;
        }
        convertToPoint(t2) {
          return new this.ol.geom.Point([t2.x, t2.y]);
        }
        convertToLineString(t2) {
          const e2 = t2._points._coordinates.map(Rs);
          return new this.ol.geom.LineString(e2);
        }
        convertToLinearRing(t2) {
          const e2 = t2._points._coordinates.map(Rs);
          return new this.ol.geom.LinearRing(e2);
        }
        convertToPolygon(t2) {
          const e2 = [t2._shell._points._coordinates.map(Rs)];
          for (let n2 = 0; n2 < t2._holes.length; n2++) e2.push(t2._holes[n2]._points._coordinates.map(Rs));
          return new this.ol.geom.Polygon(e2);
        }
        convertToMultiPoint(t2) {
          return new this.ol.geom.MultiPoint(t2.getCoordinates().map(Rs));
        }
        convertToMultiLineString(t2) {
          const e2 = [];
          for (let n2 = 0; n2 < t2._geometries.length; n2++) e2.push(this.convertToLineString(t2._geometries[n2]).getCoordinates());
          return new this.ol.geom.MultiLineString(e2);
        }
        convertToMultiPolygon(t2) {
          const e2 = [];
          for (let n2 = 0; n2 < t2._geometries.length; n2++) e2.push(this.convertToPolygon(t2._geometries[n2]).getCoordinates());
          return new this.ol.geom.MultiPolygon(e2);
        }
        convertToCollection(t2) {
          const e2 = [];
          for (let n2 = 0; n2 < t2._geometries.length; n2++) {
            const s2 = t2._geometries[n2];
            e2.push(this.write(s2));
          }
          return new this.ol.geom.GeometryCollection(e2);
        }
      }, WKTReader: class {
        constructor(t2) {
          this.parser = new Kt(t2 || new Ht());
        }
        read(t2) {
          return this.parser.read(t2);
        }
      }, WKTWriter: Jt });
      class vs {
        constructor() {
          vs.constructor_.apply(this, arguments);
        }
        static relativeSign(t2, e2) {
          return t2 < e2 ? -1 : t2 > e2 ? 1 : 0;
        }
        static compare(t2, e2, n2) {
          if (e2.equals2D(n2)) return 0;
          const s2 = vs.relativeSign(e2.x, n2.x), i2 = vs.relativeSign(e2.y, n2.y);
          switch (t2) {
            case 0:
              return vs.compareValue(s2, i2);
            case 1:
              return vs.compareValue(i2, s2);
            case 2:
              return vs.compareValue(i2, -s2);
            case 3:
              return vs.compareValue(-s2, i2);
            case 4:
              return vs.compareValue(-s2, -i2);
            case 5:
              return vs.compareValue(-i2, -s2);
            case 6:
              return vs.compareValue(-i2, s2);
            case 7:
              return vs.compareValue(s2, -i2);
          }
          return u.shouldNeverReachHere("invalid octant value"), 0;
        }
        static compareValue(t2, e2) {
          return t2 < 0 ? -1 : t2 > 0 ? 1 : e2 < 0 ? -1 : e2 > 0 ? 1 : 0;
        }
        getClass() {
          return vs;
        }
        get interfaces_() {
          return [];
        }
      }
      vs.constructor_ = function() {
      };
      class Os {
        constructor() {
          Os.constructor_.apply(this, arguments);
        }
        getCoordinate() {
          return this.coord;
        }
        print(t2) {
          t2.print(this.coord), t2.print(" seg # = " + this.segmentIndex);
        }
        compareTo(t2) {
          const e2 = t2;
          return this.segmentIndex < e2.segmentIndex ? -1 : this.segmentIndex > e2.segmentIndex ? 1 : this.coord.equals2D(e2.coord) ? 0 : vs.compare(this._segmentOctant, this.coord, e2.coord);
        }
        isEndPoint(t2) {
          return 0 === this.segmentIndex && !this._isInterior || this.segmentIndex === t2;
        }
        isInterior() {
          return this._isInterior;
        }
        getClass() {
          return Os;
        }
        get interfaces_() {
          return [r];
        }
      }
      Os.constructor_ = function() {
        this._segString = null, this.coord = null, this.segmentIndex = null, this._segmentOctant = null, this._isInterior = null;
        const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3];
        this._segString = t2, this.coord = new g(e2), this.segmentIndex = n2, this._segmentOctant = s2, this._isInterior = !e2.equals2D(t2.getCoordinate(n2));
      };
      class bs {
        constructor() {
          bs.constructor_.apply(this, arguments);
        }
        getSplitCoordinates() {
          const t2 = new I();
          this.addEndpoints();
          const e2 = this.iterator();
          let n2 = e2.next();
          for (; e2.hasNext(); ) {
            const s2 = e2.next();
            this.addEdgeCoordinates(n2, s2, t2), n2 = s2;
          }
          return t2.toCoordinateArray();
        }
        addCollapsedNodes() {
          const t2 = new x();
          this.findCollapsesFromInsertedNodes(t2), this.findCollapsesFromExistingVertices(t2);
          for (let e2 = t2.iterator(); e2.hasNext(); ) {
            const t3 = e2.next().intValue();
            this.add(this._edge.getCoordinate(t3), t3);
          }
        }
        print(t2) {
          t2.println("Intersections:");
          for (let e2 = this.iterator(); e2.hasNext(); ) {
            e2.next().print(t2);
          }
        }
        findCollapsesFromExistingVertices(t2) {
          for (let e2 = 0; e2 < this._edge.size() - 2; e2++) {
            const n2 = this._edge.getCoordinate(e2), s2 = (this._edge.getCoordinate(e2 + 1), this._edge.getCoordinate(e2 + 2));
            n2.equals2D(s2) && t2.add(new L(e2 + 1));
          }
        }
        addEdgeCoordinates(t2, e2, n2) {
          e2.segmentIndex, t2.segmentIndex;
          const s2 = this._edge.getCoordinate(e2.segmentIndex), i2 = e2.isInterior() || !e2.coord.equals2D(s2);
          n2.add(new g(t2.coord), false);
          for (let s3 = t2.segmentIndex + 1; s3 <= e2.segmentIndex; s3++) n2.add(this._edge.getCoordinate(s3));
          i2 && n2.add(new g(e2.coord));
        }
        iterator() {
          return this._nodeMap.values().iterator();
        }
        addSplitEdges(t2) {
          this.addEndpoints(), this.addCollapsedNodes();
          const e2 = this.iterator();
          let n2 = e2.next();
          for (; e2.hasNext(); ) {
            const s2 = e2.next(), i2 = this.createSplitEdge(n2, s2);
            t2.add(i2), n2 = s2;
          }
        }
        findCollapseIndex(t2, e2, n2) {
          if (!t2.coord.equals2D(e2.coord)) return false;
          let s2 = e2.segmentIndex - t2.segmentIndex;
          return e2.isInterior() || s2--, 1 === s2 && (n2[0] = t2.segmentIndex + 1, true);
        }
        findCollapsesFromInsertedNodes(t2) {
          const e2 = new Array(1).fill(null), n2 = this.iterator();
          let s2 = n2.next();
          for (; n2.hasNext(); ) {
            const i2 = n2.next();
            this.findCollapseIndex(s2, i2, e2) && t2.add(new L(e2[0])), s2 = i2;
          }
        }
        getEdge() {
          return this._edge;
        }
        addEndpoints() {
          const t2 = this._edge.size() - 1;
          this.add(this._edge.getCoordinate(0), 0), this.add(this._edge.getCoordinate(t2), t2);
        }
        createSplitEdge(t2, e2) {
          let n2 = e2.segmentIndex - t2.segmentIndex + 2;
          const s2 = this._edge.getCoordinate(e2.segmentIndex), i2 = e2.isInterior() || !e2.coord.equals2D(s2);
          i2 || n2--;
          const r2 = new Array(n2).fill(null);
          let o2 = 0;
          r2[o2++] = new g(t2.coord);
          for (let n3 = t2.segmentIndex + 1; n3 <= e2.segmentIndex; n3++) r2[o2++] = this._edge.getCoordinate(n3);
          return i2 && (r2[o2] = new g(e2.coord)), new Fs(r2, this._edge.getData());
        }
        add(t2, e2) {
          const n2 = new Os(this._edge, t2, e2, this._edge.getSegmentOctant(e2)), s2 = this._nodeMap.get(n2);
          return null !== s2 ? (u.isTrue(s2.coord.equals2D(t2), "Found equal nodes with different coordinates"), s2) : (this._nodeMap.put(n2, n2), n2);
        }
        checkSplitEdgesCorrectness(t2) {
          const e2 = this._edge.getCoordinates(), n2 = t2.get(0).getCoordinate(0);
          if (!n2.equals2D(e2[0])) throw new c("bad split edge start point at " + n2);
          const s2 = t2.get(t2.size() - 1).getCoordinates(), i2 = s2[s2.length - 1];
          if (!i2.equals2D(e2[e2.length - 1])) throw new c("bad split edge end point at " + i2);
        }
        getClass() {
          return bs;
        }
        get interfaces_() {
          return [];
        }
      }
      bs.constructor_ = function() {
        this._nodeMap = new rt(), this._edge = null;
        const t2 = arguments[0];
        this._edge = t2;
      };
      class Ms {
        constructor() {
          Ms.constructor_.apply(this, arguments);
        }
        static octant() {
          if ("number" == typeof arguments[0] && "number" == typeof arguments[1]) {
            const t2 = arguments[0], e2 = arguments[1];
            if (0 === t2 && 0 === e2) throw new n("Cannot compute the octant for point ( " + t2 + ", " + e2 + " )");
            const s2 = Math.abs(t2), i2 = Math.abs(e2);
            return t2 >= 0 ? e2 >= 0 ? s2 >= i2 ? 0 : 1 : s2 >= i2 ? 7 : 6 : e2 >= 0 ? s2 >= i2 ? 3 : 2 : s2 >= i2 ? 4 : 5;
          }
          if (arguments[0] instanceof g && arguments[1] instanceof g) {
            const t2 = arguments[0], e2 = arguments[1], s2 = e2.x - t2.x, i2 = e2.y - t2.y;
            if (0 === s2 && 0 === i2) throw new n("Cannot compute the octant for two identical points " + t2);
            return Ms.octant(s2, i2);
          }
        }
        getClass() {
          return Ms;
        }
        get interfaces_() {
          return [];
        }
      }
      Ms.constructor_ = function() {
      };
      class Ds {
        constructor() {
          Ds.constructor_.apply(this, arguments);
        }
        getCoordinates() {
        }
        size() {
        }
        getCoordinate(t2) {
        }
        isClosed() {
        }
        setData(t2) {
        }
        getData() {
        }
        getClass() {
          return Ds;
        }
        get interfaces_() {
          return [];
        }
      }
      Ds.constructor_ = function() {
      };
      class As {
        constructor() {
          As.constructor_.apply(this, arguments);
        }
        addIntersection(t2, e2) {
        }
        getClass() {
          return As;
        }
        get interfaces_() {
          return [Ds];
        }
      }
      As.constructor_ = function() {
      };
      class Fs {
        constructor() {
          Fs.constructor_.apply(this, arguments);
        }
        static getNodedSubstrings() {
          if (1 === arguments.length) {
            const t2 = arguments[0], e2 = new x();
            return Fs.getNodedSubstrings(t2, e2), e2;
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            for (let n2 = t2.iterator(); n2.hasNext(); ) {
              n2.next().getNodeList().addSplitEdges(e2);
            }
          }
        }
        getCoordinates() {
          return this._pts;
        }
        size() {
          return this._pts.length;
        }
        getCoordinate(t2) {
          return this._pts[t2];
        }
        isClosed() {
          return this._pts[0].equals(this._pts[this._pts.length - 1]);
        }
        getSegmentOctant(t2) {
          return t2 === this._pts.length - 1 ? -1 : this.safeOctant(this.getCoordinate(t2), this.getCoordinate(t2 + 1));
        }
        setData(t2) {
          this._data = t2;
        }
        safeOctant(t2, e2) {
          return t2.equals2D(e2) ? 0 : Ms.octant(t2, e2);
        }
        getData() {
          return this._data;
        }
        addIntersection() {
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            this.addIntersectionNode(t2, e2);
          } else if (4 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[3], s2 = new g(t2.getIntersection(n2));
            this.addIntersection(s2, e2);
          }
        }
        toString() {
          return Jt.toLineString(new zt(this._pts));
        }
        getNodeList() {
          return this._nodeList;
        }
        addIntersectionNode(t2, e2) {
          let n2 = e2;
          const s2 = n2 + 1;
          if (s2 < this._pts.length) {
            const e3 = this._pts[s2];
            t2.equals2D(e3) && (n2 = s2);
          }
          return this._nodeList.add(t2, n2);
        }
        addIntersections(t2, e2, n2) {
          for (let s2 = 0; s2 < t2.getIntersectionNum(); s2++) this.addIntersection(t2, e2, n2, s2);
        }
        getClass() {
          return Fs;
        }
        get interfaces_() {
          return [As];
        }
      }
      Fs.constructor_ = function() {
        this._nodeList = new bs(this), this._pts = null, this._data = null;
        const t2 = arguments[0], e2 = arguments[1];
        this._pts = t2, this._data = e2;
      };
      class Gs {
        constructor() {
          Gs.constructor_.apply(this, arguments);
        }
        overlap() {
          if (2 === arguments.length) ;
          else if (4 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3];
            t2.getLineSegment(e2, this._overlapSeg1), n2.getLineSegment(s2, this._overlapSeg2), this.overlap(this._overlapSeg1, this._overlapSeg2);
          }
        }
        getClass() {
          return Gs;
        }
        get interfaces_() {
          return [];
        }
      }
      Gs.constructor_ = function() {
        this._overlapSeg1 = new ee(), this._overlapSeg2 = new ee();
      };
      class qs {
        constructor() {
          qs.constructor_.apply(this, arguments);
        }
        getLineSegment(t2, e2) {
          e2.p0 = this._pts[t2], e2.p1 = this._pts[t2 + 1];
        }
        computeSelect(t2, e2, n2, s2) {
          const i2 = this._pts[e2], r2 = this._pts[n2];
          if (n2 - e2 == 1) return s2.select(this, e2), null;
          if (!t2.intersects(i2, r2)) return null;
          const o2 = Math.trunc((e2 + n2) / 2);
          e2 < o2 && this.computeSelect(t2, e2, o2, s2), o2 < n2 && this.computeSelect(t2, o2, n2, s2);
        }
        getCoordinates() {
          const t2 = new Array(this._end - this._start + 1).fill(null);
          let e2 = 0;
          for (let n2 = this._start; n2 <= this._end; n2++) t2[e2++] = this._pts[n2];
          return t2;
        }
        computeOverlaps() {
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            this.computeOverlaps(this._start, this._end, t2, t2._start, t2._end, e2);
          } else if (6 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3], i2 = arguments[4], r2 = arguments[5];
            if (e2 - t2 == 1 && i2 - s2 == 1) return r2.overlap(this, t2, n2, s2), null;
            if (!this.overlaps(t2, e2, n2, s2, i2)) return null;
            const o2 = Math.trunc((t2 + e2) / 2), l2 = Math.trunc((s2 + i2) / 2);
            t2 < o2 && (s2 < l2 && this.computeOverlaps(t2, o2, n2, s2, l2, r2), l2 < i2 && this.computeOverlaps(t2, o2, n2, l2, i2, r2)), o2 < e2 && (s2 < l2 && this.computeOverlaps(o2, e2, n2, s2, l2, r2), l2 < i2 && this.computeOverlaps(o2, e2, n2, l2, i2, r2));
          }
        }
        setId(t2) {
          this._id = t2;
        }
        select(t2, e2) {
          this.computeSelect(t2, this._start, this._end, e2);
        }
        getEnvelope() {
          if (null === this._env) {
            const t2 = this._pts[this._start], e2 = this._pts[this._end];
            this._env = new N(t2, e2);
          }
          return this._env;
        }
        overlaps(t2, e2, n2, s2, i2) {
          return N.intersects(this._pts[t2], this._pts[e2], n2._pts[s2], n2._pts[i2]);
        }
        getEndIndex() {
          return this._end;
        }
        getStartIndex() {
          return this._start;
        }
        getContext() {
          return this._context;
        }
        getId() {
          return this._id;
        }
        getClass() {
          return qs;
        }
        get interfaces_() {
          return [];
        }
      }
      qs.constructor_ = function() {
        this._pts = null, this._start = null, this._end = null, this._env = null, this._context = null, this._id = null;
        const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3];
        this._pts = t2, this._start = e2, this._end = n2, this._context = s2;
      };
      class Bs {
        constructor() {
          Bs.constructor_.apply(this, arguments);
        }
        static getChainStartIndices(t2) {
          let e2 = 0;
          const n2 = new x();
          n2.add(new L(e2));
          do {
            const s2 = Bs.findChainEnd(t2, e2);
            n2.add(new L(s2)), e2 = s2;
          } while (e2 < t2.length - 1);
          return Bs.toIntArray(n2);
        }
        static findChainEnd(t2, e2) {
          let n2 = e2;
          for (; n2 < t2.length - 1 && t2[n2].equals2D(t2[n2 + 1]); ) n2++;
          if (n2 >= t2.length - 1) return t2.length - 1;
          const s2 = In.quadrant(t2[n2], t2[n2 + 1]);
          let i2 = e2 + 1;
          for (; i2 < t2.length; ) {
            if (!t2[i2 - 1].equals2D(t2[i2])) {
              if (In.quadrant(t2[i2 - 1], t2[i2]) !== s2) break;
            }
            i2++;
          }
          return i2 - 1;
        }
        static getChains() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return Bs.getChains(t2, null);
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = new x(), s2 = Bs.getChainStartIndices(t2);
            for (let i2 = 0; i2 < s2.length - 1; i2++) {
              const r2 = new qs(t2, s2[i2], s2[i2 + 1], e2);
              n2.add(r2);
            }
            return n2;
          }
        }
        static toIntArray(t2) {
          const e2 = new Array(t2.size()).fill(null);
          for (let n2 = 0; n2 < e2.length; n2++) e2[n2] = t2.get(n2).intValue();
          return e2;
        }
        getClass() {
          return Bs;
        }
        get interfaces_() {
          return [];
        }
      }
      Bs.constructor_ = function() {
      };
      class Vs {
        constructor() {
          Vs.constructor_.apply(this, arguments);
        }
        computeNodes(t2) {
        }
        getNodedSubstrings() {
        }
        getClass() {
          return Vs;
        }
        get interfaces_() {
          return [];
        }
      }
      Vs.constructor_ = function() {
      };
      class zs {
        constructor() {
          zs.constructor_.apply(this, arguments);
        }
        setSegmentIntersector(t2) {
          this._segInt = t2;
        }
        getClass() {
          return zs;
        }
        get interfaces_() {
          return [Vs];
        }
      }
      zs.constructor_ = function() {
        if (this._segInt = null, 0 === arguments.length) ;
        else if (1 === arguments.length) {
          const t2 = arguments[0];
          this.setSegmentIntersector(t2);
        }
      };
      class Ys extends zs {
        constructor() {
          super(), Ys.constructor_.apply(this, arguments);
        }
        getMonotoneChains() {
          return this._monoChains;
        }
        getNodedSubstrings() {
          return Fs.getNodedSubstrings(this._nodedSegStrings);
        }
        getIndex() {
          return this._index;
        }
        add(t2) {
          for (let e2 = Bs.getChains(t2.getCoordinates(), t2).iterator(); e2.hasNext(); ) {
            const t3 = e2.next();
            t3.setId(this._idCounter++), this._index.insert(t3.getEnvelope(), t3), this._monoChains.add(t3);
          }
        }
        computeNodes(t2) {
          this._nodedSegStrings = t2;
          for (let e2 = t2.iterator(); e2.hasNext(); ) this.add(e2.next());
          this.intersectChains();
        }
        intersectChains() {
          const t2 = new Us(this._segInt);
          for (let e2 = this._monoChains.iterator(); e2.hasNext(); ) {
            const n2 = e2.next();
            for (let e3 = this._index.query(n2.getEnvelope()).iterator(); e3.hasNext(); ) {
              const s2 = e3.next();
              if (s2.getId() > n2.getId() && (n2.computeOverlaps(s2, t2), this._nOverlaps++), this._segInt.isDone()) return null;
            }
          }
        }
        getClass() {
          return Ys;
        }
        get interfaces_() {
          return [];
        }
      }
      class Us extends Gs {
        constructor() {
          super(), Us.constructor_.apply(this, arguments);
        }
        overlap() {
          if (4 !== arguments.length) return super.overlap.apply(this, arguments);
          {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3], i2 = t2.getContext(), r2 = n2.getContext();
            this._si.processIntersections(i2, e2, r2, s2);
          }
        }
        getClass() {
          return Us;
        }
        get interfaces_() {
          return [];
        }
      }
      Us.constructor_ = function() {
        this._si = null;
        const t2 = arguments[0];
        this._si = t2;
      }, Ys.SegmentOverlapAction = Us, Ys.constructor_ = function() {
        if (this._monoChains = new x(), this._index = new Es(), this._idCounter = 0, this._nodedSegStrings = null, this._nOverlaps = 0, 0 === arguments.length) ;
        else if (1 === arguments.length) {
          const t2 = arguments[0];
          zs.constructor_.call(this, t2);
        }
      };
      class ks {
        constructor() {
          ks.constructor_.apply(this, arguments);
        }
        rescale() {
          if (_(arguments[0], f)) {
            for (let t2 = arguments[0].iterator(); t2.hasNext(); ) {
              const e2 = t2.next();
              this.rescale(e2.getCoordinates());
            }
          } else if (arguments[0] instanceof Array) {
            const t2 = arguments[0];
            let e2 = null, n2 = null;
            2 === t2.length && (e2 = new g(t2[0]), n2 = new g(t2[1]));
            for (let e3 = 0; e3 < t2.length; e3++) t2[e3].x = t2[e3].x / this._scaleFactor + this._offsetX, t2[e3].y = t2[e3].y / this._scaleFactor + this._offsetY;
            2 === t2.length && t2[0].equals2D(t2[1]) && O.out.println(t2);
          }
        }
        scale() {
          if (_(arguments[0], f)) {
            const t2 = arguments[0], e2 = new x(t2.size());
            for (let n2 = t2.iterator(); n2.hasNext(); ) {
              const t3 = n2.next();
              e2.add(new Fs(this.scale(t3.getCoordinates()), t3.getData()));
            }
            return e2;
          }
          if (arguments[0] instanceof Array) {
            const t2 = arguments[0], e2 = new Array(t2.length).fill(null);
            for (let n2 = 0; n2 < t2.length; n2++) e2[n2] = new g(Math.round((t2[n2].x - this._offsetX) * this._scaleFactor), Math.round((t2[n2].y - this._offsetY) * this._scaleFactor), t2[n2].z);
            return X.removeRepeatedPoints(e2);
          }
        }
        isIntegerPrecision() {
          return 1 === this._scaleFactor;
        }
        getNodedSubstrings() {
          const t2 = this._noder.getNodedSubstrings();
          return this._isScaled && this.rescale(t2), t2;
        }
        computeNodes(t2) {
          let e2 = t2;
          this._isScaled && (e2 = this.scale(t2)), this._noder.computeNodes(e2);
        }
        getClass() {
          return ks;
        }
        get interfaces_() {
          return [Vs];
        }
      }
      ks.constructor_ = function() {
        if (this._noder = null, this._scaleFactor = null, this._offsetX = null, this._offsetY = null, this._isScaled = false, 2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          ks.constructor_.call(this, t2, e2, 0, 0);
        } else if (4 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          this._noder = t2, this._scaleFactor = e2, this._isScaled = !this.isIntegerPrecision();
        }
      };
      var Xs = Object.freeze({ __proto__: null, MCIndexNoder: Ys, ScaledNoder: ks, SegmentString: Ds });
      class Hs {
        constructor() {
          Hs.constructor_.apply(this, arguments);
        }
        static isSimple() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return new Hs(t2).isSimple();
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return new Hs(t2, e2).isSimple();
          }
        }
        isSimpleMultiPoint(t2) {
          if (t2.isEmpty()) return true;
          const e2 = new at();
          for (let n2 = 0; n2 < t2.getNumGeometries(); n2++) {
            const s2 = t2.getGeometryN(n2).getCoordinate();
            if (e2.contains(s2)) return this._nonSimpleLocation = s2, false;
            e2.add(s2);
          }
          return true;
        }
        isSimplePolygonal(t2) {
          for (let e2 = xe.getLines(t2).iterator(); e2.hasNext(); ) {
            const t3 = e2.next();
            if (!this.isSimpleLinearGeometry(t3)) return false;
          }
          return true;
        }
        hasClosedEndpointIntersection(t2) {
          const e2 = new rt();
          for (let n2 = t2.getEdgeIterator(); n2.hasNext(); ) {
            const t3 = n2.next(), s2 = (t3.getMaximumSegmentIndex(), t3.isClosed()), i2 = t3.getCoordinate(0);
            this.addEndpoint(e2, i2, s2);
            const r2 = t3.getCoordinate(t3.getNumPoints() - 1);
            this.addEndpoint(e2, r2, s2);
          }
          for (let t3 = e2.values().iterator(); t3.hasNext(); ) {
            const e3 = t3.next();
            if (e3.isClosed && 2 !== e3.degree) return this._nonSimpleLocation = e3.getCoordinate(), true;
          }
          return false;
        }
        getNonSimpleLocation() {
          return this._nonSimpleLocation;
        }
        isSimpleLinearGeometry(t2) {
          if (t2.isEmpty()) return true;
          const e2 = new Qn(0, t2), n2 = new te(), s2 = e2.computeSelfNodes(n2, true);
          return !s2.hasIntersection() || (s2.hasProperIntersection() ? (this._nonSimpleLocation = s2.getProperIntersectionPoint(), false) : !this.hasNonEndpointIntersection(e2) && (!this._isClosedEndpointsInInterior || !this.hasClosedEndpointIntersection(e2)));
        }
        hasNonEndpointIntersection(t2) {
          for (let e2 = t2.getEdgeIterator(); e2.hasNext(); ) {
            const t3 = e2.next(), n2 = t3.getMaximumSegmentIndex();
            for (let e3 = t3.getEdgeIntersectionList().iterator(); e3.hasNext(); ) {
              const t4 = e3.next();
              if (!t4.isEndPoint(n2)) return this._nonSimpleLocation = t4.getCoordinate(), true;
            }
          }
          return false;
        }
        addEndpoint(t2, e2, n2) {
          let s2 = t2.get(e2);
          null === s2 && (s2 = new Ws(e2), t2.put(e2, s2)), s2.addEndpoint(n2);
        }
        computeSimple(t2) {
          return this._nonSimpleLocation = null, !!t2.isEmpty() || (t2 instanceof Tt || t2 instanceof ft ? this.isSimpleLinearGeometry(t2) : t2 instanceof Mt ? this.isSimpleMultiPoint(t2) : _(t2, Ot) ? this.isSimplePolygonal(t2) : !(t2 instanceof _t) || this.isSimpleGeometryCollection(t2));
        }
        isSimple() {
          return this._nonSimpleLocation = null, this.computeSimple(this._inputGeom);
        }
        isSimpleGeometryCollection(t2) {
          for (let e2 = 0; e2 < t2.getNumGeometries(); e2++) {
            const n2 = t2.getGeometryN(e2);
            if (!this.computeSimple(n2)) return false;
          }
          return true;
        }
        getClass() {
          return Hs;
        }
        get interfaces_() {
          return [];
        }
      }
      class Ws {
        constructor() {
          Ws.constructor_.apply(this, arguments);
        }
        addEndpoint(t2) {
          this.degree++, this.isClosed |= t2;
        }
        getCoordinate() {
          return this.pt;
        }
        getClass() {
          return Ws;
        }
        get interfaces_() {
          return [];
        }
      }
      Ws.constructor_ = function() {
        this.pt = null, this.isClosed = null, this.degree = null;
        const t2 = arguments[0];
        this.pt = t2, this.isClosed = false, this.degree = 0;
      }, Hs.EndpointInfo = Ws, Hs.constructor_ = function() {
        if (this._inputGeom = null, this._isClosedEndpointsInInterior = true, this._nonSimpleLocation = null, 1 === arguments.length) {
          const t2 = arguments[0];
          this._inputGeom = t2;
        } else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          this._inputGeom = t2, this._isClosedEndpointsInInterior = !e2.isInBoundary(2);
        }
      };
      class js {
        constructor() {
          js.constructor_.apply(this, arguments);
        }
        static bufferDistanceError(t2) {
          const e2 = Math.PI / 2 / t2;
          return 1 - Math.cos(e2 / 2);
        }
        getEndCapStyle() {
          return this._endCapStyle;
        }
        isSingleSided() {
          return this._isSingleSided;
        }
        setQuadrantSegments(t2) {
          this._quadrantSegments = t2, 0 === this._quadrantSegments && (this._joinStyle = js.JOIN_BEVEL), this._quadrantSegments < 0 && (this._joinStyle = js.JOIN_MITRE, this._mitreLimit = Math.abs(this._quadrantSegments)), t2 <= 0 && (this._quadrantSegments = 1), this._joinStyle !== js.JOIN_ROUND && (this._quadrantSegments = js.DEFAULT_QUADRANT_SEGMENTS);
        }
        getJoinStyle() {
          return this._joinStyle;
        }
        setJoinStyle(t2) {
          this._joinStyle = t2;
        }
        setSimplifyFactor(t2) {
          this._simplifyFactor = t2 < 0 ? 0 : t2;
        }
        getSimplifyFactor() {
          return this._simplifyFactor;
        }
        getQuadrantSegments() {
          return this._quadrantSegments;
        }
        setEndCapStyle(t2) {
          this._endCapStyle = t2;
        }
        getMitreLimit() {
          return this._mitreLimit;
        }
        setMitreLimit(t2) {
          this._mitreLimit = t2;
        }
        setSingleSided(t2) {
          this._isSingleSided = t2;
        }
        getClass() {
          return js;
        }
        get interfaces_() {
          return [];
        }
      }
      js.constructor_ = function() {
        if (this._quadrantSegments = js.DEFAULT_QUADRANT_SEGMENTS, this._endCapStyle = js.CAP_ROUND, this._joinStyle = js.JOIN_ROUND, this._mitreLimit = js.DEFAULT_MITRE_LIMIT, this._isSingleSided = false, this._simplifyFactor = js.DEFAULT_SIMPLIFY_FACTOR, 0 === arguments.length) ;
        else if (1 === arguments.length) {
          const t2 = arguments[0];
          this.setQuadrantSegments(t2);
        } else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          this.setQuadrantSegments(t2), this.setEndCapStyle(e2);
        } else if (4 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3];
          this.setQuadrantSegments(t2), this.setEndCapStyle(e2), this.setJoinStyle(n2), this.setMitreLimit(s2);
        }
      }, js.CAP_ROUND = 1, js.CAP_FLAT = 2, js.CAP_SQUARE = 3, js.JOIN_ROUND = 1, js.JOIN_MITRE = 2, js.JOIN_BEVEL = 3, js.DEFAULT_QUADRANT_SEGMENTS = 8, js.DEFAULT_MITRE_LIMIT = 5, js.DEFAULT_SIMPLIFY_FACTOR = 0.01;
      class Ks {
        constructor() {
          Ks.constructor_.apply(this, arguments);
        }
        getCoordinate() {
          return this._minCoord;
        }
        getRightmostSide(t2, e2) {
          let n2 = this.getRightmostSideOfSegment(t2, e2);
          return n2 < 0 && (n2 = this.getRightmostSideOfSegment(t2, e2 - 1)), n2 < 0 && (this._minCoord = null, this.checkForRightmostCoordinate(t2)), n2;
        }
        findRightmostEdgeAtVertex() {
          const t2 = this._minDe.getEdge().getCoordinates();
          u.isTrue(this._minIndex > 0 && this._minIndex < t2.length, "rightmost point expected to be interior vertex of edge");
          const e2 = t2[this._minIndex - 1], n2 = t2[this._minIndex + 1], s2 = v.index(this._minCoord, n2, e2);
          let i2 = false;
          (e2.y < this._minCoord.y && n2.y < this._minCoord.y && s2 === v.COUNTERCLOCKWISE || e2.y > this._minCoord.y && n2.y > this._minCoord.y && s2 === v.CLOCKWISE) && (i2 = true), i2 && (this._minIndex = this._minIndex - 1);
        }
        getRightmostSideOfSegment(t2, e2) {
          const n2 = t2.getEdge().getCoordinates();
          if (e2 < 0 || e2 + 1 >= n2.length) return -1;
          if (n2[e2].y === n2[e2 + 1].y) return -1;
          let s2 = Pn.LEFT;
          return n2[e2].y < n2[e2 + 1].y && (s2 = Pn.RIGHT), s2;
        }
        getEdge() {
          return this._orientedDe;
        }
        checkForRightmostCoordinate(t2) {
          const e2 = t2.getEdge().getCoordinates();
          for (let n2 = 0; n2 < e2.length - 1; n2++) (null === this._minCoord || e2[n2].x > this._minCoord.x) && (this._minDe = t2, this._minIndex = n2, this._minCoord = e2[n2]);
        }
        findRightmostEdgeAtNode() {
          const t2 = this._minDe.getNode().getEdges();
          this._minDe = t2.getRightmostEdge(), this._minDe.isForward() || (this._minDe = this._minDe.getSym(), this._minIndex = this._minDe.getEdge().getCoordinates().length - 1);
        }
        findEdge(t2) {
          for (let e2 = t2.iterator(); e2.hasNext(); ) {
            const t3 = e2.next();
            t3.isForward() && this.checkForRightmostCoordinate(t3);
          }
          u.isTrue(0 !== this._minIndex || this._minCoord.equals(this._minDe.getCoordinate()), "inconsistency in rightmost processing"), 0 === this._minIndex ? this.findRightmostEdgeAtNode() : this.findRightmostEdgeAtVertex(), this._orientedDe = this._minDe, this.getRightmostSide(this._minDe, this._minIndex) === Pn.LEFT && (this._orientedDe = this._minDe.getSym());
        }
        getClass() {
          return Ks;
        }
        get interfaces_() {
          return [];
        }
      }
      function Zs() {
        this.array_ = [];
      }
      Ks.constructor_ = function() {
        this._minIndex = -1, this._minCoord = null, this._minDe = null, this._orientedDe = null;
      }, Zs.prototype.addLast = function(t2) {
        this.array_.push(t2);
      }, Zs.prototype.removeFirst = function() {
        return this.array_.shift();
      }, Zs.prototype.isEmpty = function() {
        return 0 === this.array_.length;
      };
      class Qs {
        constructor() {
          Qs.constructor_.apply(this, arguments);
        }
        clearVisitedEdges() {
          for (let t2 = this._dirEdgeList.iterator(); t2.hasNext(); ) {
            t2.next().setVisited(false);
          }
        }
        getRightmostCoordinate() {
          return this._rightMostCoord;
        }
        computeNodeDepth(t2) {
          let e2 = null;
          for (let n2 = t2.getEdges().iterator(); n2.hasNext(); ) {
            const t3 = n2.next();
            if (t3.isVisited() || t3.getSym().isVisited()) {
              e2 = t3;
              break;
            }
          }
          if (null === e2) throw new Wn("unable to find edge to compute depths at " + t2.getCoordinate());
          t2.getEdges().computeDepths(e2);
          for (let e3 = t2.getEdges().iterator(); e3.hasNext(); ) {
            const t3 = e3.next();
            t3.setVisited(true), this.copySymDepths(t3);
          }
        }
        computeDepth(t2) {
          this.clearVisitedEdges();
          const e2 = this._finder.getEdge();
          e2.getNode(), e2.getLabel();
          e2.setEdgeDepths(Pn.RIGHT, t2), this.copySymDepths(e2), this.computeDepths(e2);
        }
        create(t2) {
          this.addReachable(t2), this._finder.findEdge(this._dirEdgeList), this._rightMostCoord = this._finder.getCoordinate();
        }
        findResultEdges() {
          for (let t2 = this._dirEdgeList.iterator(); t2.hasNext(); ) {
            const e2 = t2.next();
            e2.getDepth(Pn.RIGHT) >= 1 && e2.getDepth(Pn.LEFT) <= 0 && !e2.isInteriorAreaEdge() && e2.setInResult(true);
          }
        }
        computeDepths(t2) {
          const e2 = new J(), n2 = new Zs(), s2 = t2.getNode();
          for (n2.addLast(s2), e2.add(s2), t2.setVisited(true); !n2.isEmpty(); ) {
            const t3 = n2.removeFirst();
            e2.add(t3), this.computeNodeDepth(t3);
            for (let s3 = t3.getEdges().iterator(); s3.hasNext(); ) {
              const t4 = s3.next().getSym();
              if (t4.isVisited()) continue;
              const i2 = t4.getNode();
              e2.contains(i2) || (n2.addLast(i2), e2.add(i2));
            }
          }
        }
        compareTo(t2) {
          const e2 = t2;
          return this._rightMostCoord.x < e2._rightMostCoord.x ? -1 : this._rightMostCoord.x > e2._rightMostCoord.x ? 1 : 0;
        }
        getEnvelope() {
          if (null === this._env) {
            const t2 = new N();
            for (let e2 = this._dirEdgeList.iterator(); e2.hasNext(); ) {
              const n2 = e2.next().getEdge().getCoordinates();
              for (let e3 = 0; e3 < n2.length - 1; e3++) t2.expandToInclude(n2[e3]);
            }
            this._env = t2;
          }
          return this._env;
        }
        addReachable(t2) {
          const e2 = new on();
          for (e2.add(t2); !e2.empty(); ) {
            const t3 = e2.pop();
            this.add(t3, e2);
          }
        }
        copySymDepths(t2) {
          const e2 = t2.getSym();
          e2.setDepth(Pn.LEFT, t2.getDepth(Pn.RIGHT)), e2.setDepth(Pn.RIGHT, t2.getDepth(Pn.LEFT));
        }
        add(t2, e2) {
          t2.setVisited(true), this._nodes.add(t2);
          for (let n2 = t2.getEdges().iterator(); n2.hasNext(); ) {
            const t3 = n2.next();
            this._dirEdgeList.add(t3);
            const s2 = t3.getSym().getNode();
            s2.isVisited() || e2.push(s2);
          }
        }
        getNodes() {
          return this._nodes;
        }
        getDirectedEdges() {
          return this._dirEdgeList;
        }
        getClass() {
          return Qs;
        }
        get interfaces_() {
          return [r];
        }
      }
      Qs.constructor_ = function() {
        this._finder = null, this._dirEdgeList = new x(), this._nodes = new x(), this._rightMostCoord = null, this._env = null, this._finder = new Ks();
      };
      class Js {
        constructor() {
          Js.constructor_.apply(this, arguments);
        }
        computeRing() {
          if (null !== this._ring) return null;
          const t2 = new Array(this._pts.size()).fill(null);
          for (let e2 = 0; e2 < this._pts.size(); e2++) t2[e2] = this._pts.get(e2);
          this._ring = this._geometryFactory.createLinearRing(t2), this._isHole = v.isCCW(this._ring.getCoordinates());
        }
        isIsolated() {
          return 1 === this._label.getGeometryCount();
        }
        computePoints(t2) {
          this._startDe = t2;
          let e2 = t2, n2 = true;
          do {
            if (null === e2) throw new Wn("Found null DirectedEdge");
            if (e2.getEdgeRing() === this) throw new Wn("Directed Edge visited twice during ring-building at " + e2.getCoordinate());
            this._edges.add(e2);
            const t3 = e2.getLabel();
            u.isTrue(t3.isArea()), this.mergeLabel(t3), this.addPoints(e2.getEdge(), e2.isForward(), n2), n2 = false, this.setEdgeRing(e2, this), e2 = this.getNext(e2);
          } while (e2 !== this._startDe);
        }
        getLinearRing() {
          return this._ring;
        }
        getCoordinate(t2) {
          return this._pts.get(t2);
        }
        computeMaxNodeDegree() {
          this._maxNodeDegree = 0;
          let t2 = this._startDe;
          do {
            const e2 = t2.getNode().getEdges().getOutgoingDegree(this);
            e2 > this._maxNodeDegree && (this._maxNodeDegree = e2), t2 = this.getNext(t2);
          } while (t2 !== this._startDe);
          this._maxNodeDegree *= 2;
        }
        addPoints(t2, e2, n2) {
          const s2 = t2.getCoordinates();
          if (e2) {
            let t3 = 1;
            n2 && (t3 = 0);
            for (let e3 = t3; e3 < s2.length; e3++) this._pts.add(s2[e3]);
          } else {
            let t3 = s2.length - 2;
            n2 && (t3 = s2.length - 1);
            for (let e3 = t3; e3 >= 0; e3--) this._pts.add(s2[e3]);
          }
        }
        isHole() {
          return this._isHole;
        }
        setInResult() {
          let t2 = this._startDe;
          do {
            t2.getEdge().setInResult(true), t2 = t2.getNext();
          } while (t2 !== this._startDe);
        }
        containsPoint(t2) {
          const e2 = this.getLinearRing();
          if (!e2.getEnvelopeInternal().contains(t2)) return false;
          if (!We.isInRing(t2, e2.getCoordinates())) return false;
          for (let e3 = this._holes.iterator(); e3.hasNext(); ) {
            if (e3.next().containsPoint(t2)) return false;
          }
          return true;
        }
        addHole(t2) {
          this._holes.add(t2);
        }
        isShell() {
          return null === this._shell;
        }
        getLabel() {
          return this._label;
        }
        getEdges() {
          return this._edges;
        }
        getMaxNodeDegree() {
          return this._maxNodeDegree < 0 && this.computeMaxNodeDegree(), this._maxNodeDegree;
        }
        getShell() {
          return this._shell;
        }
        mergeLabel() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            this.mergeLabel(t2, 0), this.mergeLabel(t2, 1);
          } else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = t2.getLocation(e2, Pn.RIGHT);
            if (n2 === ne.NONE) return null;
            if (this._label.getLocation(e2) === ne.NONE) return this._label.setLocation(e2, n2), null;
          }
        }
        setShell(t2) {
          this._shell = t2, null !== t2 && t2.addHole(this);
        }
        toPolygon(t2) {
          const e2 = new Array(this._holes.size()).fill(null);
          for (let t3 = 0; t3 < this._holes.size(); t3++) e2[t3] = this._holes.get(t3).getLinearRing();
          return t2.createPolygon(this.getLinearRing(), e2);
        }
        getClass() {
          return Js;
        }
        get interfaces_() {
          return [];
        }
      }
      Js.constructor_ = function() {
        if (this._startDe = null, this._maxNodeDegree = -1, this._edges = new x(), this._pts = new x(), this._label = new Fn(ne.NONE), this._ring = null, this._isHole = null, this._shell = null, this._holes = new x(), this._geometryFactory = null, 0 === arguments.length) ;
        else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          this._geometryFactory = e2, this.computePoints(t2), this.computeRing();
        }
      };
      class $s extends Js {
        constructor() {
          super(), $s.constructor_.apply(this, arguments);
        }
        setEdgeRing(t2, e2) {
          t2.setMinEdgeRing(e2);
        }
        getNext(t2) {
          return t2.getNextMin();
        }
        getClass() {
          return $s;
        }
        get interfaces_() {
          return [];
        }
      }
      $s.constructor_ = function() {
        const t2 = arguments[0], e2 = arguments[1];
        Js.constructor_.call(this, t2, e2);
      };
      class ti extends Js {
        constructor() {
          super(), ti.constructor_.apply(this, arguments);
        }
        buildMinimalRings() {
          const t2 = new x();
          let e2 = this._startDe;
          do {
            if (null === e2.getMinEdgeRing()) {
              const n2 = new $s(e2, this._geometryFactory);
              t2.add(n2);
            }
            e2 = e2.getNext();
          } while (e2 !== this._startDe);
          return t2;
        }
        setEdgeRing(t2, e2) {
          t2.setEdgeRing(e2);
        }
        linkDirectedEdgesForMinimalEdgeRings() {
          let t2 = this._startDe;
          do {
            t2.getNode().getEdges().linkMinimalDirectedEdges(this), t2 = t2.getNext();
          } while (t2 !== this._startDe);
        }
        getNext(t2) {
          return t2.getNext();
        }
        getClass() {
          return ti;
        }
        get interfaces_() {
          return [];
        }
      }
      ti.constructor_ = function() {
        const t2 = arguments[0], e2 = arguments[1];
        Js.constructor_.call(this, t2, e2);
      };
      class ei {
        constructor() {
          ei.constructor_.apply(this, arguments);
        }
        sortShellsAndHoles(t2, e2, n2) {
          for (let s2 = t2.iterator(); s2.hasNext(); ) {
            const t3 = s2.next();
            t3.isHole() ? n2.add(t3) : e2.add(t3);
          }
        }
        computePolygons(t2) {
          const e2 = new x();
          for (let n2 = t2.iterator(); n2.hasNext(); ) {
            const t3 = n2.next().toPolygon(this._geometryFactory);
            e2.add(t3);
          }
          return e2;
        }
        placeFreeHoles(t2, e2) {
          for (let n2 = e2.iterator(); n2.hasNext(); ) {
            const e3 = n2.next();
            if (null === e3.getShell()) {
              const n3 = this.findEdgeRingContaining(e3, t2);
              if (null === n3) throw new Wn("unable to assign hole to a shell", e3.getCoordinate(0));
              e3.setShell(n3);
            }
          }
        }
        buildMinimalEdgeRings(t2, e2, n2) {
          const s2 = new x();
          for (let i2 = t2.iterator(); i2.hasNext(); ) {
            const t3 = i2.next();
            if (t3.getMaxNodeDegree() > 2) {
              t3.linkDirectedEdgesForMinimalEdgeRings();
              const s3 = t3.buildMinimalRings(), i3 = this.findShell(s3);
              null !== i3 ? (this.placePolygonHoles(i3, s3), e2.add(i3)) : n2.addAll(s3);
            } else s2.add(t3);
          }
          return s2;
        }
        containsPoint(t2) {
          for (let e2 = this._shellList.iterator(); e2.hasNext(); ) {
            if (e2.next().containsPoint(t2)) return true;
          }
          return false;
        }
        buildMaximalEdgeRings(t2) {
          const e2 = new x();
          for (let n2 = t2.iterator(); n2.hasNext(); ) {
            const t3 = n2.next();
            if (t3.isInResult() && t3.getLabel().isArea() && null === t3.getEdgeRing()) {
              const n3 = new ti(t3, this._geometryFactory);
              e2.add(n3), n3.setInResult();
            }
          }
          return e2;
        }
        placePolygonHoles(t2, e2) {
          for (let n2 = e2.iterator(); n2.hasNext(); ) {
            const e3 = n2.next();
            e3.isHole() && e3.setShell(t2);
          }
        }
        getPolygons() {
          return this.computePolygons(this._shellList);
        }
        findEdgeRingContaining(t2, e2) {
          const n2 = t2.getLinearRing(), s2 = n2.getEnvelopeInternal(), i2 = n2.getCoordinateN(0);
          let r2 = null, o2 = null;
          for (let t3 = e2.iterator(); t3.hasNext(); ) {
            const e3 = t3.next(), n3 = e3.getLinearRing(), l2 = n3.getEnvelopeInternal();
            null !== r2 && (o2 = r2.getLinearRing().getEnvelopeInternal());
            let a2 = false;
            l2.contains(s2) && We.isInRing(i2, n3.getCoordinates()) && (a2 = true), a2 && (null === r2 || o2.contains(l2)) && (r2 = e3);
          }
          return r2;
        }
        findShell(t2) {
          let e2 = 0, n2 = null;
          for (let s2 = t2.iterator(); s2.hasNext(); ) {
            const t3 = s2.next();
            t3.isHole() || (n2 = t3, e2++);
          }
          return u.isTrue(e2 <= 1, "found two shells in MinimalEdgeRing list"), n2;
        }
        add() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            this.add(t2.getEdgeEnds(), t2.getNodes());
          } else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            Zn.linkResultDirectedEdges(e2);
            const n2 = this.buildMaximalEdgeRings(t2), s2 = new x(), i2 = this.buildMinimalEdgeRings(n2, this._shellList, s2);
            this.sortShellsAndHoles(i2, this._shellList, s2), this.placeFreeHoles(this._shellList, s2);
          }
        }
        getClass() {
          return ei;
        }
        get interfaces_() {
          return [];
        }
      }
      ei.constructor_ = function() {
        this._geometryFactory = null, this._shellList = new x();
        const t2 = arguments[0];
        this._geometryFactory = t2;
      };
      class ni {
        constructor() {
          ni.constructor_.apply(this, arguments);
        }
        static simplify(t2, e2) {
          return new ni(t2).simplify(e2);
        }
        isDeletable(t2, e2, n2, s2) {
          const i2 = this._inputLine[t2], r2 = this._inputLine[e2], o2 = this._inputLine[n2];
          return !!this.isConcave(i2, r2, o2) && (!!this.isShallow(i2, r2, o2, s2) && this.isShallowSampled(i2, r2, t2, n2, s2));
        }
        deleteShallowConcavities() {
          let t2 = 1;
          this._inputLine.length;
          let e2 = this.findNextNonDeletedIndex(t2), n2 = this.findNextNonDeletedIndex(e2), s2 = false;
          for (; n2 < this._inputLine.length; ) {
            let i2 = false;
            this.isDeletable(t2, e2, n2, this._distanceTol) && (this._isDeleted[e2] = ni.DELETE, i2 = true, s2 = true), t2 = i2 ? n2 : e2, e2 = this.findNextNonDeletedIndex(t2), n2 = this.findNextNonDeletedIndex(e2);
          }
          return s2;
        }
        isShallowConcavity(t2, e2, n2, s2) {
          return v.index(t2, e2, n2) === this._angleOrientation && D.pointToSegment(e2, t2, n2) < s2;
        }
        isShallowSampled(t2, e2, n2, s2, i2) {
          let r2 = Math.trunc((s2 - n2) / ni.NUM_PTS_TO_CHECK);
          r2 <= 0 && (r2 = 1);
          for (let o2 = n2; o2 < s2; o2 += r2) if (!this.isShallow(t2, e2, this._inputLine[o2], i2)) return false;
          return true;
        }
        isConcave(t2, e2, n2) {
          return v.index(t2, e2, n2) === this._angleOrientation;
        }
        simplify(t2) {
          this._distanceTol = Math.abs(t2), t2 < 0 && (this._angleOrientation = v.CLOCKWISE), this._isDeleted = new Array(this._inputLine.length).fill(null);
          let e2 = false;
          do {
            e2 = this.deleteShallowConcavities();
          } while (e2);
          return this.collapseLine();
        }
        findNextNonDeletedIndex(t2) {
          let e2 = t2 + 1;
          for (; e2 < this._inputLine.length && this._isDeleted[e2] === ni.DELETE; ) e2++;
          return e2;
        }
        isShallow(t2, e2, n2, s2) {
          return D.pointToSegment(e2, t2, n2) < s2;
        }
        collapseLine() {
          const t2 = new I();
          for (let e2 = 0; e2 < this._inputLine.length; e2++) this._isDeleted[e2] !== ni.DELETE && t2.add(this._inputLine[e2]);
          return t2.toCoordinateArray();
        }
        getClass() {
          return ni;
        }
        get interfaces_() {
          return [];
        }
      }
      ni.constructor_ = function() {
        this._inputLine = null, this._distanceTol = null, this._isDeleted = null, this._angleOrientation = v.COUNTERCLOCKWISE;
        const t2 = arguments[0];
        this._inputLine = t2;
      }, ni.INIT = 0, ni.DELETE = 1, ni.KEEP = 1, ni.NUM_PTS_TO_CHECK = 10;
      class si {
        constructor() {
          si.constructor_.apply(this, arguments);
        }
        getCoordinates() {
          return this._ptList.toArray(si.COORDINATE_ARRAY_TYPE);
        }
        setPrecisionModel(t2) {
          this._precisionModel = t2;
        }
        addPt(t2) {
          const e2 = new g(t2);
          if (this._precisionModel.makePrecise(e2), this.isRedundant(e2)) return null;
          this._ptList.add(e2);
        }
        reverse() {
        }
        addPts(t2, e2) {
          if (e2) for (let e3 = 0; e3 < t2.length; e3++) this.addPt(t2[e3]);
          else for (let e3 = t2.length - 1; e3 >= 0; e3--) this.addPt(t2[e3]);
        }
        isRedundant(t2) {
          if (this._ptList.size() < 1) return false;
          const e2 = this._ptList.get(this._ptList.size() - 1);
          return t2.distance(e2) < this._minimimVertexDistance;
        }
        toString() {
          return new Ht().createLineString(this.getCoordinates()).toString();
        }
        closeRing() {
          if (this._ptList.size() < 1) return null;
          const t2 = new g(this._ptList.get(0)), e2 = this._ptList.get(this._ptList.size() - 1);
          let n2 = null;
          if (this._ptList.size() >= 2 && this._ptList.get(this._ptList.size() - 2), t2.equals(e2)) return null;
          this._ptList.add(t2);
        }
        setMinimumVertexDistance(t2) {
          this._minimimVertexDistance = t2;
        }
        getClass() {
          return si;
        }
        get interfaces_() {
          return [];
        }
      }
      si.constructor_ = function() {
        this._ptList = null, this._precisionModel = null, this._minimimVertexDistance = 0, this._ptList = new x();
      }, si.COORDINATE_ARRAY_TYPE = new Array(0).fill(null);
      class ii {
        constructor() {
          ii.constructor_.apply(this, arguments);
        }
        addNextSegment(t2, e2) {
          if (this._s0 = this._s1, this._s1 = this._s2, this._s2 = t2, this._seg0.setCoordinates(this._s0, this._s1), this.computeOffsetSegment(this._seg0, this._side, this._distance, this._offset0), this._seg1.setCoordinates(this._s1, this._s2), this.computeOffsetSegment(this._seg1, this._side, this._distance, this._offset1), this._s1.equals(this._s2)) return null;
          const n2 = v.index(this._s0, this._s1, this._s2), s2 = n2 === v.CLOCKWISE && this._side === Pn.LEFT || n2 === v.COUNTERCLOCKWISE && this._side === Pn.RIGHT;
          0 === n2 ? this.addCollinear(e2) : s2 ? this.addOutsideTurn(n2, e2) : this.addInsideTurn(n2, e2);
        }
        addLineEndCap(t2, e2) {
          const n2 = new ee(t2, e2), s2 = new ee();
          this.computeOffsetSegment(n2, Pn.LEFT, this._distance, s2);
          const i2 = new ee();
          this.computeOffsetSegment(n2, Pn.RIGHT, this._distance, i2);
          const r2 = e2.x - t2.x, o2 = e2.y - t2.y, l2 = Math.atan2(o2, r2);
          switch (this._bufParams.getEndCapStyle()) {
            case js.CAP_ROUND:
              this._segList.addPt(s2.p1), this.addDirectedFillet(e2, l2 + Math.PI / 2, l2 - Math.PI / 2, v.CLOCKWISE, this._distance), this._segList.addPt(i2.p1);
              break;
            case js.CAP_FLAT:
              this._segList.addPt(s2.p1), this._segList.addPt(i2.p1);
              break;
            case js.CAP_SQUARE:
              const t3 = new g();
              t3.x = Math.abs(this._distance) * Math.cos(l2), t3.y = Math.abs(this._distance) * Math.sin(l2);
              const n3 = new g(s2.p1.x + t3.x, s2.p1.y + t3.y), r3 = new g(i2.p1.x + t3.x, i2.p1.y + t3.y);
              this._segList.addPt(n3), this._segList.addPt(r3);
          }
        }
        getCoordinates() {
          return this._segList.getCoordinates();
        }
        addMitreJoin(t2, e2, n2, s2) {
          let i2 = true, r2 = null;
          try {
            r2 = b.intersection(e2.p0, e2.p1, n2.p0, n2.p1), (s2 <= 0 ? 1 : r2.distance(t2) / Math.abs(s2)) > this._bufParams.getMitreLimit() && (i2 = false);
          } catch (t3) {
            if (!(t3 instanceof S)) throw t3;
            r2 = new g(0, 0), i2 = false;
          }
          i2 ? this._segList.addPt(r2) : this.addLimitedMitreJoin(e2, n2, s2, this._bufParams.getMitreLimit());
        }
        addOutsideTurn(t2, e2) {
          if (this._offset0.p1.distance(this._offset1.p0) < this._distance * ii.OFFSET_SEGMENT_SEPARATION_FACTOR) return this._segList.addPt(this._offset0.p1), null;
          this._bufParams.getJoinStyle() === js.JOIN_MITRE ? this.addMitreJoin(this._s1, this._offset0, this._offset1, this._distance) : this._bufParams.getJoinStyle() === js.JOIN_BEVEL ? this.addBevelJoin(this._offset0, this._offset1) : (e2 && this._segList.addPt(this._offset0.p1), this.addCornerFillet(this._s1, this._offset0.p1, this._offset1.p0, t2, this._distance), this._segList.addPt(this._offset1.p0));
        }
        createSquare(t2) {
          this._segList.addPt(new g(t2.x + this._distance, t2.y + this._distance)), this._segList.addPt(new g(t2.x + this._distance, t2.y - this._distance)), this._segList.addPt(new g(t2.x - this._distance, t2.y - this._distance)), this._segList.addPt(new g(t2.x - this._distance, t2.y + this._distance)), this._segList.closeRing();
        }
        addSegments(t2, e2) {
          this._segList.addPts(t2, e2);
        }
        addFirstSegment() {
          this._segList.addPt(this._offset1.p0);
        }
        addCornerFillet(t2, e2, n2, s2, i2) {
          const r2 = e2.x - t2.x, o2 = e2.y - t2.y;
          let l2 = Math.atan2(o2, r2);
          const a2 = n2.x - t2.x, c2 = n2.y - t2.y, h2 = Math.atan2(c2, a2);
          s2 === v.CLOCKWISE ? l2 <= h2 && (l2 += 2 * Math.PI) : l2 >= h2 && (l2 -= 2 * Math.PI), this._segList.addPt(e2), this.addDirectedFillet(t2, l2, h2, s2, i2), this._segList.addPt(n2);
        }
        addLastSegment() {
          this._segList.addPt(this._offset1.p1);
        }
        initSideSegments(t2, e2, n2) {
          this._s1 = t2, this._s2 = e2, this._side = n2, this._seg1.setCoordinates(t2, e2), this.computeOffsetSegment(this._seg1, n2, this._distance, this._offset1);
        }
        addLimitedMitreJoin(t2, e2, n2, s2) {
          const i2 = this._seg0.p1, r2 = ie.angle(i2, this._seg0.p0), o2 = (ie.angle(i2, this._seg1.p1), ie.angleBetweenOriented(this._seg0.p0, i2, this._seg1.p1) / 2), l2 = ie.normalize(r2 + o2), a2 = ie.normalize(l2 + Math.PI), c2 = s2 * n2, h2 = n2 - c2 * Math.abs(Math.sin(o2)), u2 = i2.x + c2 * Math.cos(a2), d2 = i2.y + c2 * Math.sin(a2), _2 = new g(u2, d2), f2 = new ee(i2, _2), p2 = f2.pointAlongOffset(1, h2), m2 = f2.pointAlongOffset(1, -h2);
          this._side === Pn.LEFT ? (this._segList.addPt(p2), this._segList.addPt(m2)) : (this._segList.addPt(m2), this._segList.addPt(p2));
        }
        addDirectedFillet(t2, e2, n2, s2, i2) {
          const r2 = s2 === v.CLOCKWISE ? -1 : 1, o2 = Math.abs(e2 - n2), l2 = Math.trunc(o2 / this._filletAngleQuantum + 0.5);
          if (l2 < 1) return null;
          let a2 = null, c2 = null;
          a2 = 0, c2 = o2 / l2;
          let h2 = 0;
          const u2 = new g();
          for (; h2 < o2; ) {
            const n3 = e2 + r2 * h2;
            u2.x = t2.x + i2 * Math.cos(n3), u2.y = t2.y + i2 * Math.sin(n3), this._segList.addPt(u2), h2 += c2;
          }
        }
        computeOffsetSegment(t2, e2, n2, s2) {
          const i2 = e2 === Pn.LEFT ? 1 : -1, r2 = t2.p1.x - t2.p0.x, o2 = t2.p1.y - t2.p0.y, l2 = Math.sqrt(r2 * r2 + o2 * o2), a2 = i2 * n2 * r2 / l2, c2 = i2 * n2 * o2 / l2;
          s2.p0.x = t2.p0.x - c2, s2.p0.y = t2.p0.y + a2, s2.p1.x = t2.p1.x - c2, s2.p1.y = t2.p1.y + a2;
        }
        addInsideTurn(t2, e2) {
          if (this._li.computeIntersection(this._offset0.p0, this._offset0.p1, this._offset1.p0, this._offset1.p1), this._li.hasIntersection()) this._segList.addPt(this._li.getIntersection(0));
          else if (this._hasNarrowConcaveAngle = true, this._offset0.p1.distance(this._offset1.p0) < this._distance * ii.INSIDE_TURN_VERTEX_SNAP_DISTANCE_FACTOR) this._segList.addPt(this._offset0.p1);
          else {
            if (this._segList.addPt(this._offset0.p1), this._closingSegLengthFactor > 0) {
              const t3 = new g((this._closingSegLengthFactor * this._offset0.p1.x + this._s1.x) / (this._closingSegLengthFactor + 1), (this._closingSegLengthFactor * this._offset0.p1.y + this._s1.y) / (this._closingSegLengthFactor + 1));
              this._segList.addPt(t3);
              const e3 = new g((this._closingSegLengthFactor * this._offset1.p0.x + this._s1.x) / (this._closingSegLengthFactor + 1), (this._closingSegLengthFactor * this._offset1.p0.y + this._s1.y) / (this._closingSegLengthFactor + 1));
              this._segList.addPt(e3);
            } else this._segList.addPt(this._s1);
            this._segList.addPt(this._offset1.p0);
          }
        }
        createCircle(t2) {
          const e2 = new g(t2.x + this._distance, t2.y);
          this._segList.addPt(e2), this.addDirectedFillet(t2, 0, 2 * Math.PI, -1, this._distance), this._segList.closeRing();
        }
        addBevelJoin(t2, e2) {
          this._segList.addPt(t2.p1), this._segList.addPt(e2.p0);
        }
        init(t2) {
          this._distance = t2, this._maxCurveSegmentError = t2 * (1 - Math.cos(this._filletAngleQuantum / 2)), this._segList = new si(), this._segList.setPrecisionModel(this._precisionModel), this._segList.setMinimumVertexDistance(t2 * ii.CURVE_VERTEX_SNAP_DISTANCE_FACTOR);
        }
        addCollinear(t2) {
          this._li.computeIntersection(this._s0, this._s1, this._s1, this._s2), this._li.getIntersectionNum() >= 2 && (this._bufParams.getJoinStyle() === js.JOIN_BEVEL || this._bufParams.getJoinStyle() === js.JOIN_MITRE ? (t2 && this._segList.addPt(this._offset0.p1), this._segList.addPt(this._offset1.p0)) : this.addCornerFillet(this._s1, this._offset0.p1, this._offset1.p0, v.CLOCKWISE, this._distance));
        }
        closeRing() {
          this._segList.closeRing();
        }
        hasNarrowConcaveAngle() {
          return this._hasNarrowConcaveAngle;
        }
        getClass() {
          return ii;
        }
        get interfaces_() {
          return [];
        }
      }
      ii.constructor_ = function() {
        this._maxCurveSegmentError = 0, this._filletAngleQuantum = null, this._closingSegLengthFactor = 1, this._segList = null, this._distance = 0, this._precisionModel = null, this._bufParams = null, this._li = null, this._s0 = null, this._s1 = null, this._s2 = null, this._seg0 = new ee(), this._seg1 = new ee(), this._offset0 = new ee(), this._offset1 = new ee(), this._side = 0, this._hasNarrowConcaveAngle = false;
        const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
        this._precisionModel = t2, this._bufParams = e2, this._li = new te(), this._filletAngleQuantum = Math.PI / 2 / e2.getQuadrantSegments(), e2.getQuadrantSegments() >= 8 && e2.getJoinStyle() === js.JOIN_ROUND && (this._closingSegLengthFactor = ii.MAX_CLOSING_SEG_LEN_FACTOR), this.init(n2);
      }, ii.OFFSET_SEGMENT_SEPARATION_FACTOR = 1e-3, ii.INSIDE_TURN_VERTEX_SNAP_DISTANCE_FACTOR = 1e-3, ii.CURVE_VERTEX_SNAP_DISTANCE_FACTOR = 1e-6, ii.MAX_CLOSING_SEG_LEN_FACTOR = 80;
      class ri {
        constructor() {
          ri.constructor_.apply(this, arguments);
        }
        static copyCoordinates(t2) {
          const e2 = new Array(t2.length).fill(null);
          for (let n2 = 0; n2 < e2.length; n2++) e2[n2] = new g(t2[n2]);
          return e2;
        }
        getOffsetCurve(t2, e2) {
          if (this._distance = e2, 0 === e2) return null;
          const n2 = e2 < 0, s2 = Math.abs(e2), i2 = this.getSegGen(s2);
          t2.length <= 1 ? this.computePointCurve(t2[0], i2) : this.computeOffsetCurve(t2, n2, i2);
          const r2 = i2.getCoordinates();
          return n2 && X.reverse(r2), r2;
        }
        computeSingleSidedBufferCurve(t2, e2, n2) {
          const s2 = this.simplifyTolerance(this._distance);
          if (e2) {
            n2.addSegments(t2, true);
            const e3 = ni.simplify(t2, -s2), i2 = e3.length - 1;
            n2.initSideSegments(e3[i2], e3[i2 - 1], Pn.LEFT), n2.addFirstSegment();
            for (let t3 = i2 - 2; t3 >= 0; t3--) n2.addNextSegment(e3[t3], true);
          } else {
            n2.addSegments(t2, false);
            const e3 = ni.simplify(t2, s2), i2 = e3.length - 1;
            n2.initSideSegments(e3[0], e3[1], Pn.LEFT), n2.addFirstSegment();
            for (let t3 = 2; t3 <= i2; t3++) n2.addNextSegment(e3[t3], true);
          }
          n2.addLastSegment(), n2.closeRing();
        }
        computeRingBufferCurve(t2, e2, n2) {
          let s2 = this.simplifyTolerance(this._distance);
          e2 === Pn.RIGHT && (s2 = -s2);
          const i2 = ni.simplify(t2, s2), r2 = i2.length - 1;
          n2.initSideSegments(i2[r2 - 1], i2[0], e2);
          for (let t3 = 1; t3 <= r2; t3++) {
            const e3 = 1 !== t3;
            n2.addNextSegment(i2[t3], e3);
          }
          n2.closeRing();
        }
        computeLineBufferCurve(t2, e2) {
          const n2 = this.simplifyTolerance(this._distance), s2 = ni.simplify(t2, n2), i2 = s2.length - 1;
          e2.initSideSegments(s2[0], s2[1], Pn.LEFT);
          for (let t3 = 2; t3 <= i2; t3++) e2.addNextSegment(s2[t3], true);
          e2.addLastSegment(), e2.addLineEndCap(s2[i2 - 1], s2[i2]);
          const r2 = ni.simplify(t2, -n2), o2 = r2.length - 1;
          e2.initSideSegments(r2[o2], r2[o2 - 1], Pn.LEFT);
          for (let t3 = o2 - 2; t3 >= 0; t3--) e2.addNextSegment(r2[t3], true);
          e2.addLastSegment(), e2.addLineEndCap(r2[1], r2[0]), e2.closeRing();
        }
        computePointCurve(t2, e2) {
          switch (this._bufParams.getEndCapStyle()) {
            case js.CAP_ROUND:
              e2.createCircle(t2);
              break;
            case js.CAP_SQUARE:
              e2.createSquare(t2);
          }
        }
        getLineCurve(t2, e2) {
          if (this._distance = e2, e2 < 0 && !this._bufParams.isSingleSided()) return null;
          if (0 === e2) return null;
          const n2 = Math.abs(e2), s2 = this.getSegGen(n2);
          if (t2.length <= 1) this.computePointCurve(t2[0], s2);
          else if (this._bufParams.isSingleSided()) {
            const n3 = e2 < 0;
            this.computeSingleSidedBufferCurve(t2, n3, s2);
          } else this.computeLineBufferCurve(t2, s2);
          return s2.getCoordinates();
        }
        getBufferParameters() {
          return this._bufParams;
        }
        simplifyTolerance(t2) {
          return t2 * this._bufParams.getSimplifyFactor();
        }
        getRingCurve(t2, e2, n2) {
          if (this._distance = n2, t2.length <= 2) return this.getLineCurve(t2, n2);
          if (0 === n2) return ri.copyCoordinates(t2);
          const s2 = this.getSegGen(n2);
          return this.computeRingBufferCurve(t2, e2, s2), s2.getCoordinates();
        }
        computeOffsetCurve(t2, e2, n2) {
          const s2 = this.simplifyTolerance(this._distance);
          if (e2) {
            const e3 = ni.simplify(t2, -s2), i2 = e3.length - 1;
            n2.initSideSegments(e3[i2], e3[i2 - 1], Pn.LEFT), n2.addFirstSegment();
            for (let t3 = i2 - 2; t3 >= 0; t3--) n2.addNextSegment(e3[t3], true);
          } else {
            const e3 = ni.simplify(t2, s2), i2 = e3.length - 1;
            n2.initSideSegments(e3[0], e3[1], Pn.LEFT), n2.addFirstSegment();
            for (let t3 = 2; t3 <= i2; t3++) n2.addNextSegment(e3[t3], true);
          }
          n2.addLastSegment();
        }
        getSegGen(t2) {
          return new ii(this._precisionModel, this._bufParams, t2);
        }
        getClass() {
          return ri;
        }
        get interfaces_() {
          return [];
        }
      }
      ri.constructor_ = function() {
        this._distance = 0, this._precisionModel = null, this._bufParams = null;
        const t2 = arguments[0], e2 = arguments[1];
        this._precisionModel = t2, this._bufParams = e2;
      };
      class oi {
        constructor() {
          oi.constructor_.apply(this, arguments);
        }
        findStabbedSegments() {
          if (1 === arguments.length) {
            const t2 = arguments[0], e2 = new x();
            for (let n2 = this._subgraphs.iterator(); n2.hasNext(); ) {
              const s2 = n2.next(), i2 = s2.getEnvelope();
              t2.y < i2.getMinY() || t2.y > i2.getMaxY() || this.findStabbedSegments(t2, s2.getDirectedEdges(), e2);
            }
            return e2;
          }
          if (3 === arguments.length) {
            if (_(arguments[2], m) && arguments[0] instanceof g && arguments[1] instanceof jn) {
              const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = e2.getEdge().getCoordinates();
              for (let i2 = 0; i2 < s2.length - 1; i2++) {
                if (this._seg.p0 = s2[i2], this._seg.p1 = s2[i2 + 1], this._seg.p0.y > this._seg.p1.y && this._seg.reverse(), Math.max(this._seg.p0.x, this._seg.p1.x) < t2.x) continue;
                if (this._seg.isHorizontal()) continue;
                if (t2.y < this._seg.p0.y || t2.y > this._seg.p1.y) continue;
                if (v.index(this._seg.p0, this._seg.p1, t2) === v.RIGHT) continue;
                let r2 = e2.getDepth(Pn.LEFT);
                this._seg.p0.equals(s2[i2]) || (r2 = e2.getDepth(Pn.RIGHT));
                const o2 = new li(this._seg, r2);
                n2.add(o2);
              }
            } else if (_(arguments[2], m) && arguments[0] instanceof g && _(arguments[1], m)) {
              const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
              for (let s2 = e2.iterator(); s2.hasNext(); ) {
                const e3 = s2.next();
                e3.isForward() && this.findStabbedSegments(t2, e3, n2);
              }
            }
          }
        }
        getDepth(t2) {
          const e2 = this.findStabbedSegments(t2);
          return 0 === e2.size() ? 0 : Ee.min(e2)._leftDepth;
        }
        getClass() {
          return oi;
        }
        get interfaces_() {
          return [];
        }
      }
      class li {
        constructor() {
          li.constructor_.apply(this, arguments);
        }
        compareTo(t2) {
          const e2 = t2;
          if (this._upwardSeg.minX() >= e2._upwardSeg.maxX()) return 1;
          if (this._upwardSeg.maxX() <= e2._upwardSeg.minX()) return -1;
          let n2 = this._upwardSeg.orientationIndex(e2._upwardSeg);
          return 0 !== n2 ? n2 : (n2 = -1 * e2._upwardSeg.orientationIndex(this._upwardSeg), 0 !== n2 ? n2 : this._upwardSeg.compareTo(e2._upwardSeg));
        }
        compareX(t2, e2) {
          const n2 = t2.p0.compareTo(e2.p0);
          return 0 !== n2 ? n2 : t2.p1.compareTo(e2.p1);
        }
        toString() {
          return this._upwardSeg.toString();
        }
        getClass() {
          return li;
        }
        get interfaces_() {
          return [r];
        }
      }
      li.constructor_ = function() {
        this._upwardSeg = null, this._leftDepth = null;
        const t2 = arguments[0], e2 = arguments[1];
        this._upwardSeg = new ee(t2), this._leftDepth = e2;
      }, oi.DepthSegment = li, oi.constructor_ = function() {
        this._subgraphs = null, this._seg = new ee();
        const t2 = arguments[0];
        this._subgraphs = t2;
      };
      class ai {
        constructor() {
          ai.constructor_.apply(this, arguments);
        }
        addPoint(t2) {
          if (this._distance <= 0) return null;
          const e2 = t2.getCoordinates(), n2 = this._curveBuilder.getLineCurve(e2, this._distance);
          this.addCurve(n2, ne.EXTERIOR, ne.INTERIOR);
        }
        addPolygon(t2) {
          let e2 = this._distance, n2 = Pn.LEFT;
          this._distance < 0 && (e2 = -this._distance, n2 = Pn.RIGHT);
          const s2 = t2.getExteriorRing(), i2 = X.removeRepeatedPoints(s2.getCoordinates());
          if (this._distance < 0 && this.isErodedCompletely(s2, this._distance)) return null;
          if (this._distance <= 0 && i2.length < 3) return null;
          this.addPolygonRing(i2, e2, n2, ne.EXTERIOR, ne.INTERIOR);
          for (let s3 = 0; s3 < t2.getNumInteriorRing(); s3++) {
            const i3 = t2.getInteriorRingN(s3), r2 = X.removeRepeatedPoints(i3.getCoordinates());
            this._distance > 0 && this.isErodedCompletely(i3, -this._distance) || this.addPolygonRing(r2, e2, Pn.opposite(n2), ne.INTERIOR, ne.EXTERIOR);
          }
        }
        isTriangleErodedCompletely(t2, e2) {
          const n2 = new re(t2[0], t2[1], t2[2]), s2 = n2.inCentre();
          return D.pointToSegment(s2, n2.p0, n2.p1) < Math.abs(e2);
        }
        addLineString(t2) {
          if (this._distance <= 0 && !this._curveBuilder.getBufferParameters().isSingleSided()) return null;
          const e2 = X.removeRepeatedPoints(t2.getCoordinates()), n2 = this._curveBuilder.getLineCurve(e2, this._distance);
          this.addCurve(n2, ne.EXTERIOR, ne.INTERIOR);
        }
        addCurve(t2, e2, n2) {
          if (null === t2 || t2.length < 2) return null;
          const s2 = new Fs(t2, new Fn(0, ne.BOUNDARY, e2, n2));
          this._curveList.add(s2);
        }
        getCurves() {
          return this.add(this._inputGeom), this._curveList;
        }
        addPolygonRing(t2, e2, n2, s2, i2) {
          if (0 === e2 && t2.length < Dt.MINIMUM_VALID_SIZE) return null;
          let r2 = s2, o2 = i2;
          t2.length >= Dt.MINIMUM_VALID_SIZE && v.isCCW(t2) && (r2 = i2, o2 = s2, n2 = Pn.opposite(n2));
          const l2 = this._curveBuilder.getRingCurve(t2, n2, e2);
          this.addCurve(l2, r2, o2);
        }
        add(t2) {
          if (t2.isEmpty()) return null;
          if (t2 instanceof bt) this.addPolygon(t2);
          else if (t2 instanceof Tt) this.addLineString(t2);
          else if (t2 instanceof Pt) this.addPoint(t2);
          else if (t2 instanceof Mt) this.addCollection(t2);
          else if (t2 instanceof ft) this.addCollection(t2);
          else if (t2 instanceof At) this.addCollection(t2);
          else {
            if (!(t2 instanceof _t)) throw new Z(t2.getClass().getName());
            this.addCollection(t2);
          }
        }
        isErodedCompletely(t2, e2) {
          const n2 = t2.getCoordinates();
          if (n2.length < 4) return e2 < 0;
          if (4 === n2.length) return this.isTriangleErodedCompletely(n2, e2);
          const s2 = t2.getEnvelopeInternal(), i2 = Math.min(s2.getHeight(), s2.getWidth());
          return e2 < 0 && 2 * Math.abs(e2) > i2;
        }
        addCollection(t2) {
          for (let e2 = 0; e2 < t2.getNumGeometries(); e2++) {
            const n2 = t2.getGeometryN(e2);
            this.add(n2);
          }
        }
        getClass() {
          return ai;
        }
        get interfaces_() {
          return [];
        }
      }
      ai.constructor_ = function() {
        this._inputGeom = null, this._distance = null, this._curveBuilder = null, this._curveList = new x();
        const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
        this._inputGeom = t2, this._distance = e2, this._curveBuilder = n2;
      };
      class ci {
        constructor() {
          ci.constructor_.apply(this, arguments);
        }
        getNextCW(t2) {
          this.getEdges();
          const e2 = this._edgeList.indexOf(t2);
          let n2 = e2 - 1;
          return 0 === e2 && (n2 = this._edgeList.size() - 1), this._edgeList.get(n2);
        }
        propagateSideLabels(t2) {
          let e2 = ne.NONE;
          for (let n3 = this.iterator(); n3.hasNext(); ) {
            const s2 = n3.next().getLabel();
            s2.isArea(t2) && s2.getLocation(t2, Pn.LEFT) !== ne.NONE && (e2 = s2.getLocation(t2, Pn.LEFT));
          }
          if (e2 === ne.NONE) return null;
          let n2 = e2;
          for (let e3 = this.iterator(); e3.hasNext(); ) {
            const s2 = e3.next(), i2 = s2.getLabel();
            if (i2.getLocation(t2, Pn.ON) === ne.NONE && i2.setLocation(t2, Pn.ON, n2), i2.isArea(t2)) {
              const e4 = i2.getLocation(t2, Pn.LEFT), r2 = i2.getLocation(t2, Pn.RIGHT);
              if (r2 !== ne.NONE) {
                if (r2 !== n2) throw new Wn("side location conflict", s2.getCoordinate());
                e4 === ne.NONE && u.shouldNeverReachHere("found single null side (at " + s2.getCoordinate() + ")"), n2 = e4;
              } else u.isTrue(i2.getLocation(t2, Pn.LEFT) === ne.NONE, "found single null side"), i2.setLocation(t2, Pn.RIGHT, n2), i2.setLocation(t2, Pn.LEFT, n2);
            }
          }
        }
        getCoordinate() {
          const t2 = this.iterator();
          return t2.hasNext() ? t2.next().getCoordinate() : null;
        }
        print(t2) {
          O.out.println("EdgeEndStar:   " + this.getCoordinate());
          for (let e2 = this.iterator(); e2.hasNext(); ) {
            e2.next().print(t2);
          }
        }
        isAreaLabelsConsistent(t2) {
          return this.computeEdgeEndLabels(t2.getBoundaryNodeRule()), this.checkAreaLabelsConsistent(0);
        }
        checkAreaLabelsConsistent(t2) {
          const e2 = this.getEdges();
          if (e2.size() <= 0) return true;
          const n2 = e2.size() - 1, s2 = e2.get(n2).getLabel().getLocation(t2, Pn.LEFT);
          u.isTrue(s2 !== ne.NONE, "Found unlabelled area edge");
          let i2 = s2;
          for (let e3 = this.iterator(); e3.hasNext(); ) {
            const n3 = e3.next().getLabel();
            u.isTrue(n3.isArea(t2), "Found non-area edge");
            const s3 = n3.getLocation(t2, Pn.LEFT), r2 = n3.getLocation(t2, Pn.RIGHT);
            if (s3 === r2) return false;
            if (r2 !== i2) return false;
            i2 = s3;
          }
          return true;
        }
        findIndex(t2) {
          this.iterator();
          for (let e2 = 0; e2 < this._edgeList.size(); e2++) {
            if (this._edgeList.get(e2) === t2) return e2;
          }
          return -1;
        }
        iterator() {
          return this.getEdges().iterator();
        }
        getEdges() {
          return null === this._edgeList && (this._edgeList = new x(this._edgeMap.values())), this._edgeList;
        }
        getLocation(t2, e2, n2) {
          return this._ptInAreaLocation[t2] === ne.NONE && (this._ptInAreaLocation[t2] = Ze.locate(e2, n2[t2].getGeometry())), this._ptInAreaLocation[t2];
        }
        toString() {
          const t2 = new w();
          t2.append("EdgeEndStar:   " + this.getCoordinate()), t2.append("\n");
          for (let e2 = this.iterator(); e2.hasNext(); ) {
            const n2 = e2.next();
            t2.append(n2), t2.append("\n");
          }
          return t2.toString();
        }
        computeEdgeEndLabels(t2) {
          for (let e2 = this.iterator(); e2.hasNext(); ) {
            e2.next().computeLabel(t2);
          }
        }
        computeLabelling(t2) {
          this.computeEdgeEndLabels(t2[0].getBoundaryNodeRule()), this.propagateSideLabels(0), this.propagateSideLabels(1);
          const e2 = [false, false];
          for (let t3 = this.iterator(); t3.hasNext(); ) {
            const n2 = t3.next().getLabel();
            for (let t4 = 0; t4 < 2; t4++) n2.isLine(t4) && n2.getLocation(t4) === ne.BOUNDARY && (e2[t4] = true);
          }
          for (let n2 = this.iterator(); n2.hasNext(); ) {
            const s2 = n2.next(), i2 = s2.getLabel();
            for (let n3 = 0; n3 < 2; n3++) if (i2.isAnyNull(n3)) {
              let r2 = ne.NONE;
              if (e2[n3]) r2 = ne.EXTERIOR;
              else {
                const e3 = s2.getCoordinate();
                r2 = this.getLocation(n3, e3, t2);
              }
              i2.setAllLocationsIfNull(n3, r2);
            }
          }
        }
        getDegree() {
          return this._edgeMap.size();
        }
        insertEdgeEnd(t2, e2) {
          this._edgeMap.put(t2, e2), this._edgeList = null;
        }
        getClass() {
          return ci;
        }
        get interfaces_() {
          return [];
        }
      }
      ci.constructor_ = function() {
        this._edgeMap = new rt(), this._edgeList = null, this._ptInAreaLocation = [ne.NONE, ne.NONE];
      };
      class hi extends ci {
        constructor() {
          super(), hi.constructor_.apply(this, arguments);
        }
        linkResultDirectedEdges() {
          this.getResultAreaEdges();
          let t2 = null, e2 = null, n2 = this._SCANNING_FOR_INCOMING;
          for (let s2 = 0; s2 < this._resultAreaEdgeList.size(); s2++) {
            const i2 = this._resultAreaEdgeList.get(s2), r2 = i2.getSym();
            if (i2.getLabel().isArea()) switch (null === t2 && i2.isInResult() && (t2 = i2), n2) {
              case this._SCANNING_FOR_INCOMING:
                if (!r2.isInResult()) continue;
                e2 = r2, n2 = this._LINKING_TO_OUTGOING;
                break;
              case this._LINKING_TO_OUTGOING:
                if (!i2.isInResult()) continue;
                e2.setNext(i2), n2 = this._SCANNING_FOR_INCOMING;
            }
          }
          if (n2 === this._LINKING_TO_OUTGOING) {
            if (null === t2) throw new Wn("no outgoing dirEdge found", this.getCoordinate());
            u.isTrue(t2.isInResult(), "unable to link last incoming dirEdge"), e2.setNext(t2);
          }
        }
        insert(t2) {
          const e2 = t2;
          this.insertEdgeEnd(e2, e2);
        }
        getRightmostEdge() {
          const t2 = this.getEdges(), e2 = t2.size();
          if (e2 < 1) return null;
          const n2 = t2.get(0);
          if (1 === e2) return n2;
          const s2 = t2.get(e2 - 1), i2 = n2.getQuadrant(), r2 = s2.getQuadrant();
          return In.isNorthern(i2) && In.isNorthern(r2) ? n2 : In.isNorthern(i2) || In.isNorthern(r2) ? 0 !== n2.getDy() ? n2 : 0 !== s2.getDy() ? s2 : (u.shouldNeverReachHere("found two horizontal edges incident on node"), null) : s2;
        }
        print(t2) {
          O.out.println("DirectedEdgeStar: " + this.getCoordinate());
          for (let e2 = this.iterator(); e2.hasNext(); ) {
            const n2 = e2.next();
            t2.print("out "), n2.print(t2), t2.println(), t2.print("in "), n2.getSym().print(t2), t2.println();
          }
        }
        getResultAreaEdges() {
          if (null !== this._resultAreaEdgeList) return this._resultAreaEdgeList;
          this._resultAreaEdgeList = new x();
          for (let t2 = this.iterator(); t2.hasNext(); ) {
            const e2 = t2.next();
            (e2.isInResult() || e2.getSym().isInResult()) && this._resultAreaEdgeList.add(e2);
          }
          return this._resultAreaEdgeList;
        }
        updateLabelling(t2) {
          for (let e2 = this.iterator(); e2.hasNext(); ) {
            const n2 = e2.next().getLabel();
            n2.setAllLocationsIfNull(0, t2.getLocation(0)), n2.setAllLocationsIfNull(1, t2.getLocation(1));
          }
        }
        linkAllDirectedEdges() {
          this.getEdges();
          let t2 = null, e2 = null;
          for (let n2 = this._edgeList.size() - 1; n2 >= 0; n2--) {
            const s2 = this._edgeList.get(n2), i2 = s2.getSym();
            null === e2 && (e2 = i2), null !== t2 && i2.setNext(t2), t2 = s2;
          }
          e2.setNext(t2);
        }
        computeDepths() {
          if (1 === arguments.length) {
            const t2 = arguments[0], e2 = this.findIndex(t2), n2 = t2.getDepth(Pn.LEFT), s2 = t2.getDepth(Pn.RIGHT), i2 = this.computeDepths(e2 + 1, this._edgeList.size(), n2);
            if (this.computeDepths(0, e2, i2) !== s2) throw new Wn("depth mismatch at " + t2.getCoordinate());
          } else if (3 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            let n2 = arguments[2];
            for (let s2 = t2; s2 < e2; s2++) {
              const t3 = this._edgeList.get(s2);
              t3.setEdgeDepths(Pn.RIGHT, n2), n2 = t3.getDepth(Pn.LEFT);
            }
            return n2;
          }
        }
        mergeSymLabels() {
          for (let t2 = this.iterator(); t2.hasNext(); ) {
            const e2 = t2.next();
            e2.getLabel().merge(e2.getSym().getLabel());
          }
        }
        linkMinimalDirectedEdges(t2) {
          let e2 = null, n2 = null, s2 = this._SCANNING_FOR_INCOMING;
          for (let i2 = this._resultAreaEdgeList.size() - 1; i2 >= 0; i2--) {
            const r2 = this._resultAreaEdgeList.get(i2), o2 = r2.getSym();
            switch (null === e2 && r2.getEdgeRing() === t2 && (e2 = r2), s2) {
              case this._SCANNING_FOR_INCOMING:
                if (o2.getEdgeRing() !== t2) continue;
                n2 = o2, s2 = this._LINKING_TO_OUTGOING;
                break;
              case this._LINKING_TO_OUTGOING:
                if (r2.getEdgeRing() !== t2) continue;
                n2.setNextMin(r2), s2 = this._SCANNING_FOR_INCOMING;
            }
          }
          s2 === this._LINKING_TO_OUTGOING && (u.isTrue(null !== e2, "found null for first outgoing dirEdge"), u.isTrue(e2.getEdgeRing() === t2, "unable to link last incoming dirEdge"), n2.setNextMin(e2));
        }
        getOutgoingDegree() {
          if (0 === arguments.length) {
            let t2 = 0;
            for (let e2 = this.iterator(); e2.hasNext(); ) {
              e2.next().isInResult() && t2++;
            }
            return t2;
          }
          if (1 === arguments.length) {
            const t2 = arguments[0];
            let e2 = 0;
            for (let n2 = this.iterator(); n2.hasNext(); ) {
              n2.next().getEdgeRing() === t2 && e2++;
            }
            return e2;
          }
        }
        getLabel() {
          return this._label;
        }
        findCoveredLineEdges() {
          let t2 = ne.NONE;
          for (let e3 = this.iterator(); e3.hasNext(); ) {
            const n2 = e3.next(), s2 = n2.getSym();
            if (!n2.isLineEdge()) {
              if (n2.isInResult()) {
                t2 = ne.INTERIOR;
                break;
              }
              if (s2.isInResult()) {
                t2 = ne.EXTERIOR;
                break;
              }
            }
          }
          if (t2 === ne.NONE) return null;
          let e2 = t2;
          for (let t3 = this.iterator(); t3.hasNext(); ) {
            const n2 = t3.next(), s2 = n2.getSym();
            n2.isLineEdge() ? n2.getEdge().setCovered(e2 === ne.INTERIOR) : (n2.isInResult() && (e2 = ne.EXTERIOR), s2.isInResult() && (e2 = ne.INTERIOR));
          }
        }
        computeLabelling(t2) {
          super.computeLabelling.call(this, t2), this._label = new Fn(ne.NONE);
          for (let t3 = this.iterator(); t3.hasNext(); ) {
            const e2 = t3.next().getEdge().getLabel();
            for (let t4 = 0; t4 < 2; t4++) {
              const n2 = e2.getLocation(t4);
              n2 !== ne.INTERIOR && n2 !== ne.BOUNDARY || this._label.setLocation(t4, ne.INTERIOR);
            }
          }
        }
        getClass() {
          return hi;
        }
        get interfaces_() {
          return [];
        }
      }
      hi.constructor_ = function() {
        this._resultAreaEdgeList = null, this._label = null, this._SCANNING_FOR_INCOMING = 1, this._LINKING_TO_OUTGOING = 2;
      };
      class ui extends Kn {
        constructor() {
          super(), ui.constructor_.apply(this, arguments);
        }
        createNode(t2) {
          return new kn(t2, new hi());
        }
        getClass() {
          return ui;
        }
        get interfaces_() {
          return [];
        }
      }
      ui.constructor_ = function() {
      };
      class gi {
        constructor() {
          gi.constructor_.apply(this, arguments);
        }
        static orientation(t2) {
          return 1 === X.increasingDirection(t2);
        }
        static compareOriented(t2, e2, n2, s2) {
          const i2 = e2 ? 1 : -1, r2 = s2 ? 1 : -1, o2 = e2 ? t2.length : -1, l2 = s2 ? n2.length : -1;
          let a2 = e2 ? 0 : t2.length - 1, c2 = s2 ? 0 : n2.length - 1;
          for (; ; ) {
            const e3 = t2[a2].compareTo(n2[c2]);
            if (0 !== e3) return e3;
            a2 += i2, c2 += r2;
            const s3 = a2 === o2, h2 = c2 === l2;
            if (s3 && !h2) return -1;
            if (!s3 && h2) return 1;
            if (s3 && h2) return 0;
          }
        }
        compareTo(t2) {
          const e2 = t2;
          return gi.compareOriented(this._pts, this._orientation, e2._pts, e2._orientation);
        }
        getClass() {
          return gi;
        }
        get interfaces_() {
          return [r];
        }
      }
      gi.constructor_ = function() {
        this._pts = null, this._orientation = null;
        const t2 = arguments[0];
        this._pts = t2, this._orientation = gi.orientation(t2);
      };
      class di {
        constructor() {
          di.constructor_.apply(this, arguments);
        }
        print(t2) {
          t2.print("MULTILINESTRING ( ");
          for (let e2 = 0; e2 < this._edges.size(); e2++) {
            const n2 = this._edges.get(e2);
            e2 > 0 && t2.print(","), t2.print("(");
            const s2 = n2.getCoordinates();
            for (let e3 = 0; e3 < s2.length; e3++) e3 > 0 && t2.print(","), t2.print(s2[e3].x + " " + s2[e3].y);
            t2.println(")");
          }
          t2.print(")  ");
        }
        addAll(t2) {
          for (let e2 = t2.iterator(); e2.hasNext(); ) this.add(e2.next());
        }
        findEdgeIndex(t2) {
          for (let e2 = 0; e2 < this._edges.size(); e2++) if (this._edges.get(e2).equals(t2)) return e2;
          return -1;
        }
        iterator() {
          return this._edges.iterator();
        }
        getEdges() {
          return this._edges;
        }
        get(t2) {
          return this._edges.get(t2);
        }
        findEqualEdge(t2) {
          const e2 = new gi(t2.getCoordinates());
          return this._ocaMap.get(e2);
        }
        add(t2) {
          this._edges.add(t2);
          const e2 = new gi(t2.getCoordinates());
          this._ocaMap.put(e2, t2);
        }
        getClass() {
          return di;
        }
        get interfaces_() {
          return [];
        }
      }
      di.constructor_ = function() {
        this._edges = new x(), this._ocaMap = new rt();
      };
      class _i {
        constructor() {
          _i.constructor_.apply(this, arguments);
        }
        processIntersections(t2, e2, n2, s2) {
        }
        isDone() {
        }
        getClass() {
          return _i;
        }
        get interfaces_() {
          return [];
        }
      }
      _i.constructor_ = function() {
      };
      class fi {
        constructor() {
          fi.constructor_.apply(this, arguments);
        }
        static isAdjacentSegments(t2, e2) {
          return 1 === Math.abs(t2 - e2);
        }
        isTrivialIntersection(t2, e2, n2, s2) {
          if (t2 === n2 && 1 === this._li.getIntersectionNum()) {
            if (fi.isAdjacentSegments(e2, s2)) return true;
            if (t2.isClosed()) {
              const n3 = t2.size() - 1;
              if (0 === e2 && s2 === n3 || 0 === s2 && e2 === n3) return true;
            }
          }
          return false;
        }
        getProperIntersectionPoint() {
          return this._properIntersectionPoint;
        }
        hasProperInteriorIntersection() {
          return this._hasProperInterior;
        }
        getLineIntersector() {
          return this._li;
        }
        hasProperIntersection() {
          return this._hasProper;
        }
        processIntersections(t2, e2, n2, s2) {
          if (t2 === n2 && e2 === s2) return null;
          this.numTests++;
          const i2 = t2.getCoordinates()[e2], r2 = t2.getCoordinates()[e2 + 1], o2 = n2.getCoordinates()[s2], l2 = n2.getCoordinates()[s2 + 1];
          this._li.computeIntersection(i2, r2, o2, l2), this._li.hasIntersection() && (this.numIntersections++, this._li.isInteriorIntersection() && (this.numInteriorIntersections++, this._hasInterior = true), this.isTrivialIntersection(t2, e2, n2, s2) || (this._hasIntersection = true, t2.addIntersections(this._li, e2, 0), n2.addIntersections(this._li, s2, 1), this._li.isProper() && (this.numProperIntersections++, this._hasProper = true, this._hasProperInterior = true)));
        }
        hasIntersection() {
          return this._hasIntersection;
        }
        isDone() {
          return false;
        }
        hasInteriorIntersection() {
          return this._hasInterior;
        }
        getClass() {
          return fi;
        }
        get interfaces_() {
          return [_i];
        }
      }
      fi.constructor_ = function() {
        this._hasIntersection = false, this._hasProper = false, this._hasProperInterior = false, this._hasInterior = false, this._properIntersectionPoint = null, this._li = null, this._isSelfIntersection = null, this.numIntersections = 0, this.numInteriorIntersections = 0, this.numProperIntersections = 0, this.numTests = 0;
        const t2 = arguments[0];
        this._li = t2;
      };
      class pi {
        constructor() {
          pi.constructor_.apply(this, arguments);
        }
        static depthDelta(t2) {
          const e2 = t2.getLocation(0, Pn.LEFT), n2 = t2.getLocation(0, Pn.RIGHT);
          return e2 === ne.INTERIOR && n2 === ne.EXTERIOR ? 1 : e2 === ne.EXTERIOR && n2 === ne.INTERIOR ? -1 : 0;
        }
        static convertSegStrings(t2) {
          const e2 = new Ht(), n2 = new x();
          for (; t2.hasNext(); ) {
            const s2 = t2.next(), i2 = e2.createLineString(s2.getCoordinates());
            n2.add(i2);
          }
          return e2.buildGeometry(n2);
        }
        setWorkingPrecisionModel(t2) {
          this._workingPrecisionModel = t2;
        }
        insertUniqueEdge(t2) {
          const e2 = this._edgeList.findEqualEdge(t2);
          if (null !== e2) {
            const n2 = e2.getLabel();
            let s2 = t2.getLabel();
            e2.isPointwiseEqual(t2) || (s2 = new Fn(t2.getLabel()), s2.flip()), n2.merge(s2);
            const i2 = pi.depthDelta(s2), r2 = e2.getDepthDelta() + i2;
            e2.setDepthDelta(r2);
          } else this._edgeList.add(t2), t2.setDepthDelta(pi.depthDelta(t2.getLabel()));
        }
        buildSubgraphs(t2, e2) {
          const n2 = new x();
          for (let s2 = t2.iterator(); s2.hasNext(); ) {
            const t3 = s2.next(), i2 = t3.getRightmostCoordinate(), r2 = new oi(n2).getDepth(i2);
            t3.computeDepth(r2), t3.findResultEdges(), n2.add(t3), e2.add(t3.getDirectedEdges(), t3.getNodes());
          }
        }
        createSubgraphs(t2) {
          const e2 = new x();
          for (let n2 = t2.getNodes().iterator(); n2.hasNext(); ) {
            const t3 = n2.next();
            if (!t3.isVisited()) {
              const n3 = new Qs();
              n3.create(t3), e2.add(n3);
            }
          }
          return Ee.sort(e2, Ee.reverseOrder()), e2;
        }
        createEmptyResultGeometry() {
          return this._geomFact.createPolygon();
        }
        getNoder(t2) {
          if (null !== this._workingNoder) return this._workingNoder;
          const e2 = new Ys(), n2 = new te();
          return n2.setPrecisionModel(t2), e2.setSegmentIntersector(new fi(n2)), e2;
        }
        buffer(t2, e2) {
          let n2 = this._workingPrecisionModel;
          null === n2 && (n2 = t2.getPrecisionModel()), this._geomFact = t2.getFactory();
          const s2 = new ri(n2, this._bufParams), i2 = new ai(t2, e2, s2).getCurves();
          if (i2.size() <= 0) return this.createEmptyResultGeometry();
          this.computeNodedEdges(i2, n2), this._graph = new Zn(new ui()), this._graph.addEdges(this._edgeList.getEdges());
          const r2 = this.createSubgraphs(this._graph), o2 = new ei(this._geomFact);
          this.buildSubgraphs(r2, o2);
          const l2 = o2.getPolygons();
          return l2.size() <= 0 ? this.createEmptyResultGeometry() : this._geomFact.buildGeometry(l2);
        }
        computeNodedEdges(t2, e2) {
          const n2 = this.getNoder(e2);
          n2.computeNodes(t2);
          for (let t3 = n2.getNodedSubstrings().iterator(); t3.hasNext(); ) {
            const e3 = t3.next(), n3 = e3.getCoordinates();
            if (2 === n3.length && n3[0].equals2D(n3[1])) continue;
            const s2 = e3.getData(), i2 = new Un(e3.getCoordinates(), new Fn(s2));
            this.insertUniqueEdge(i2);
          }
        }
        setNoder(t2) {
          this._workingNoder = t2;
        }
        getClass() {
          return pi;
        }
        get interfaces_() {
          return [];
        }
      }
      pi.constructor_ = function() {
        this._bufParams = null, this._workingPrecisionModel = null, this._workingNoder = null, this._geomFact = null, this._graph = null, this._edgeList = new di();
        const t2 = arguments[0];
        this._bufParams = t2;
      };
      class mi {
        constructor() {
          mi.constructor_.apply(this, arguments);
        }
        checkEndPtVertexIntersections() {
          if (0 === arguments.length) for (let t2 = this._segStrings.iterator(); t2.hasNext(); ) {
            const e2 = t2.next().getCoordinates();
            this.checkEndPtVertexIntersections(e2[0], this._segStrings), this.checkEndPtVertexIntersections(e2[e2.length - 1], this._segStrings);
          }
          else if (2 === arguments.length) {
            const t2 = arguments[0];
            for (let e2 = arguments[1].iterator(); e2.hasNext(); ) {
              const n2 = e2.next().getCoordinates();
              for (let e3 = 1; e3 < n2.length - 1; e3++) if (n2[e3].equals(t2)) throw new c("found endpt/interior pt intersection at index " + e3 + " :pt " + t2);
            }
          }
        }
        checkInteriorIntersections() {
          if (0 === arguments.length) for (let t2 = this._segStrings.iterator(); t2.hasNext(); ) {
            const e2 = t2.next();
            for (let t3 = this._segStrings.iterator(); t3.hasNext(); ) {
              const n2 = t3.next();
              this.checkInteriorIntersections(e2, n2);
            }
          }
          else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = t2.getCoordinates(), s2 = e2.getCoordinates();
            for (let i2 = 0; i2 < n2.length - 1; i2++) for (let n3 = 0; n3 < s2.length - 1; n3++) this.checkInteriorIntersections(t2, i2, e2, n3);
          } else if (4 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3];
            if (t2 === n2 && e2 === s2) return null;
            const i2 = t2.getCoordinates()[e2], r2 = t2.getCoordinates()[e2 + 1], o2 = n2.getCoordinates()[s2], l2 = n2.getCoordinates()[s2 + 1];
            if (this._li.computeIntersection(i2, r2, o2, l2), this._li.hasIntersection() && (this._li.isProper() || this.hasInteriorIntersection(this._li, i2, r2) || this.hasInteriorIntersection(this._li, o2, l2))) throw new c("found non-noded intersection at " + i2 + "-" + r2 + " and " + o2 + "-" + l2);
          }
        }
        checkValid() {
          this.checkEndPtVertexIntersections(), this.checkInteriorIntersections(), this.checkCollapses();
        }
        checkCollapses() {
          if (0 === arguments.length) for (let t2 = this._segStrings.iterator(); t2.hasNext(); ) {
            const e2 = t2.next();
            this.checkCollapses(e2);
          }
          else if (1 === arguments.length) {
            const t2 = arguments[0].getCoordinates();
            for (let e2 = 0; e2 < t2.length - 2; e2++) this.checkCollapse(t2[e2], t2[e2 + 1], t2[e2 + 2]);
          }
        }
        hasInteriorIntersection(t2, e2, n2) {
          for (let s2 = 0; s2 < t2.getIntersectionNum(); s2++) {
            const i2 = t2.getIntersection(s2);
            if (!i2.equals(e2) && !i2.equals(n2)) return true;
          }
          return false;
        }
        checkCollapse(t2, e2, n2) {
          if (t2.equals(n2)) throw new c("found non-noded collapse at " + mi.fact.createLineString([t2, e2, n2]));
        }
        getClass() {
          return mi;
        }
        get interfaces_() {
          return [];
        }
      }
      mi.constructor_ = function() {
        this._li = new te(), this._segStrings = null;
        const t2 = arguments[0];
        this._segStrings = t2;
      }, mi.fact = new Ht();
      class yi {
        constructor() {
          yi.constructor_.apply(this, arguments);
        }
        intersectsScaled(t2, e2) {
          const n2 = Math.min(t2.x, e2.x), s2 = Math.max(t2.x, e2.x), i2 = Math.min(t2.y, e2.y), r2 = Math.max(t2.y, e2.y), o2 = this._maxx < n2 || this._minx > s2 || this._maxy < i2 || this._miny > r2;
          if (o2) return false;
          const l2 = this.intersectsToleranceSquare(t2, e2);
          return u.isTrue(!(o2 && l2), "Found bad envelope test"), l2;
        }
        initCorners(t2) {
          this._minx = t2.x - 0.5, this._maxx = t2.x + 0.5, this._miny = t2.y - 0.5, this._maxy = t2.y + 0.5, this._corner[0] = new g(this._maxx, this._maxy), this._corner[1] = new g(this._minx, this._maxy), this._corner[2] = new g(this._minx, this._miny), this._corner[3] = new g(this._maxx, this._miny);
        }
        intersects(t2, e2) {
          return 1 === this._scaleFactor ? this.intersectsScaled(t2, e2) : (this.copyScaled(t2, this._p0Scaled), this.copyScaled(e2, this._p1Scaled), this.intersectsScaled(this._p0Scaled, this._p1Scaled));
        }
        scale(t2) {
          return Math.round(t2 * this._scaleFactor);
        }
        getCoordinate() {
          return this._originalPt;
        }
        copyScaled(t2, e2) {
          e2.x = this.scale(t2.x), e2.y = this.scale(t2.y);
        }
        getSafeEnvelope() {
          if (null === this._safeEnv) {
            const t2 = yi.SAFE_ENV_EXPANSION_FACTOR / this._scaleFactor;
            this._safeEnv = new N(this._originalPt.x - t2, this._originalPt.x + t2, this._originalPt.y - t2, this._originalPt.y + t2);
          }
          return this._safeEnv;
        }
        intersectsPixelClosure(t2, e2) {
          return this._li.computeIntersection(t2, e2, this._corner[0], this._corner[1]), !!this._li.hasIntersection() || (this._li.computeIntersection(t2, e2, this._corner[1], this._corner[2]), !!this._li.hasIntersection() || (this._li.computeIntersection(t2, e2, this._corner[2], this._corner[3]), !!this._li.hasIntersection() || (this._li.computeIntersection(t2, e2, this._corner[3], this._corner[0]), !!this._li.hasIntersection())));
        }
        intersectsToleranceSquare(t2, e2) {
          let n2 = false, s2 = false;
          return this._li.computeIntersection(t2, e2, this._corner[0], this._corner[1]), !!this._li.isProper() || (this._li.computeIntersection(t2, e2, this._corner[1], this._corner[2]), !!this._li.isProper() || (this._li.hasIntersection() && (n2 = true), this._li.computeIntersection(t2, e2, this._corner[2], this._corner[3]), !!this._li.isProper() || (this._li.hasIntersection() && (s2 = true), this._li.computeIntersection(t2, e2, this._corner[3], this._corner[0]), !!this._li.isProper() || (!(!n2 || !s2) || (!!t2.equals(this._pt) || !!e2.equals(this._pt))))));
        }
        addSnappedNode(t2, e2) {
          const n2 = t2.getCoordinate(e2), s2 = t2.getCoordinate(e2 + 1);
          return !!this.intersects(n2, s2) && (t2.addIntersection(this.getCoordinate(), e2), true);
        }
        getClass() {
          return yi;
        }
        get interfaces_() {
          return [];
        }
      }
      yi.constructor_ = function() {
        this._li = null, this._pt = null, this._originalPt = null, this._ptScaled = null, this._p0Scaled = null, this._p1Scaled = null, this._scaleFactor = null, this._minx = null, this._maxx = null, this._miny = null, this._maxy = null, this._corner = new Array(4).fill(null), this._safeEnv = null;
        const t2 = arguments[0], e2 = arguments[1], s2 = arguments[2];
        if (this._originalPt = t2, this._pt = t2, this._scaleFactor = e2, this._li = s2, e2 <= 0) throw new n("Scale factor must be non-zero");
        1 !== e2 && (this._pt = new g(this.scale(t2.x), this.scale(t2.y)), this._p0Scaled = new g(), this._p1Scaled = new g()), this.initCorners(this._pt);
      }, yi.SAFE_ENV_EXPANSION_FACTOR = 0.75;
      class xi {
        constructor() {
          xi.constructor_.apply(this, arguments);
        }
        select() {
          if (1 === arguments.length) ;
          else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            t2.getLineSegment(e2, this.selectedSegment), this.select(this.selectedSegment);
          }
        }
        getClass() {
          return xi;
        }
        get interfaces_() {
          return [];
        }
      }
      xi.constructor_ = function() {
        this.selectedSegment = new ee();
      };
      class Ei {
        constructor() {
          Ei.constructor_.apply(this, arguments);
        }
        snap() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return this.snap(t2, null, -1);
          }
          if (3 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = t2.getSafeEnvelope(), i2 = new Ii(t2, e2, n2);
            return this._index.query(s2, new class {
              get interfaces_() {
                return [Ae];
              }
              visitItem(t3) {
                t3.select(s2, i2);
              }
            }()), i2.isNodeAdded();
          }
        }
        getClass() {
          return Ei;
        }
        get interfaces_() {
          return [];
        }
      }
      class Ii extends xi {
        constructor() {
          super(), Ii.constructor_.apply(this, arguments);
        }
        isNodeAdded() {
          return this._isNodeAdded;
        }
        select() {
          if (!(2 === arguments.length && Number.isInteger(arguments[1]) && arguments[0] instanceof qs)) return super.select.apply(this, arguments);
          {
            const t2 = arguments[0], e2 = arguments[1], n2 = t2.getContext();
            if (null !== this._parentEdge && n2 === this._parentEdge && e2 === this._hotPixelVertexIndex) return null;
            this._isNodeAdded = this._hotPixel.addSnappedNode(n2, e2);
          }
        }
        getClass() {
          return Ii;
        }
        get interfaces_() {
          return [];
        }
      }
      Ii.constructor_ = function() {
        this._hotPixel = null, this._parentEdge = null, this._hotPixelVertexIndex = null, this._isNodeAdded = false;
        const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
        this._hotPixel = t2, this._parentEdge = e2, this._hotPixelVertexIndex = n2;
      }, Ei.HotPixelSnapAction = Ii, Ei.constructor_ = function() {
        this._index = null;
        const t2 = arguments[0];
        this._index = t2;
      };
      class Ni {
        constructor() {
          Ni.constructor_.apply(this, arguments);
        }
        processIntersections(t2, e2, n2, s2) {
          if (t2 === n2 && e2 === s2) return null;
          const i2 = t2.getCoordinates()[e2], r2 = t2.getCoordinates()[e2 + 1], o2 = n2.getCoordinates()[s2], l2 = n2.getCoordinates()[s2 + 1];
          if (this._li.computeIntersection(i2, r2, o2, l2), this._li.hasIntersection() && this._li.isInteriorIntersection()) {
            for (let t3 = 0; t3 < this._li.getIntersectionNum(); t3++) this._interiorIntersections.add(this._li.getIntersection(t3));
            t2.addIntersections(this._li, e2, 0), n2.addIntersections(this._li, s2, 1);
          }
        }
        isDone() {
          return false;
        }
        getInteriorIntersections() {
          return this._interiorIntersections;
        }
        getClass() {
          return Ni;
        }
        get interfaces_() {
          return [_i];
        }
      }
      Ni.constructor_ = function() {
        this._li = null, this._interiorIntersections = null;
        const t2 = arguments[0];
        this._li = t2, this._interiorIntersections = new x();
      };
      class Ci {
        constructor() {
          Ci.constructor_.apply(this, arguments);
        }
        checkCorrectness(t2) {
          const e2 = Fs.getNodedSubstrings(t2), n2 = new mi(e2);
          try {
            n2.checkValid();
          } catch (t3) {
            if (!(t3 instanceof C)) throw t3;
            t3.printStackTrace();
          }
        }
        getNodedSubstrings() {
          return Fs.getNodedSubstrings(this._nodedSegStrings);
        }
        snapRound(t2, e2) {
          const n2 = this.findInteriorIntersections(t2, e2);
          this.computeIntersectionSnaps(n2), this.computeVertexSnaps(t2);
        }
        findInteriorIntersections(t2, e2) {
          const n2 = new Ni(e2);
          return this._noder.setSegmentIntersector(n2), this._noder.computeNodes(t2), n2.getInteriorIntersections();
        }
        computeVertexSnaps() {
          if (_(arguments[0], f)) {
            for (let t2 = arguments[0].iterator(); t2.hasNext(); ) {
              const e2 = t2.next();
              this.computeVertexSnaps(e2);
            }
          } else if (arguments[0] instanceof Fs) {
            const t2 = arguments[0], e2 = t2.getCoordinates();
            for (let n2 = 0; n2 < e2.length; n2++) {
              const s2 = new yi(e2[n2], this._scaleFactor, this._li);
              this._pointSnapper.snap(s2, t2, n2) && t2.addIntersection(e2[n2], n2);
            }
          }
        }
        computeNodes(t2) {
          this._nodedSegStrings = t2, this._noder = new Ys(), this._pointSnapper = new Ei(this._noder.getIndex()), this.snapRound(t2, this._li);
        }
        computeIntersectionSnaps(t2) {
          for (let e2 = t2.iterator(); e2.hasNext(); ) {
            const t3 = e2.next(), n2 = new yi(t3, this._scaleFactor, this._li);
            this._pointSnapper.snap(n2);
          }
        }
        getClass() {
          return Ci;
        }
        get interfaces_() {
          return [Vs];
        }
      }
      Ci.constructor_ = function() {
        this._pm = null, this._li = null, this._scaleFactor = null, this._noder = null, this._pointSnapper = null, this._nodedSegStrings = null;
        const t2 = arguments[0];
        this._pm = t2, this._li = new te(), this._li.setPrecisionModel(t2), this._scaleFactor = t2.getScale();
      };
      class Si {
        constructor() {
          Si.constructor_.apply(this, arguments);
        }
        static bufferOp() {
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return new Si(t2).getResultGeometry(e2);
          }
          if (3 === arguments.length) {
            if (Number.isInteger(arguments[2]) && arguments[0] instanceof q && "number" == typeof arguments[1]) {
              const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = new Si(t2);
              return s2.setQuadrantSegments(n2), s2.getResultGeometry(e2);
            }
            if (arguments[2] instanceof js && arguments[0] instanceof q && "number" == typeof arguments[1]) {
              const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
              return new Si(t2, n2).getResultGeometry(e2);
            }
          } else if (4 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3], i2 = new Si(t2);
            return i2.setQuadrantSegments(n2), i2.setEndCapStyle(s2), i2.getResultGeometry(e2);
          }
        }
        static precisionScaleFactor(t2, e2, n2) {
          const s2 = t2.getEnvelopeInternal(), i2 = M.max(Math.abs(s2.getMaxX()), Math.abs(s2.getMaxY()), Math.abs(s2.getMinX()), Math.abs(s2.getMinY())) + 2 * (e2 > 0 ? e2 : 0), r2 = n2 - Math.trunc(Math.log(i2) / Math.log(10) + 1);
          return Math.pow(10, r2);
        }
        bufferFixedPrecision(t2) {
          const e2 = new ks(new Ci(new kt(1)), t2.getScale()), n2 = new pi(this._bufParams);
          n2.setWorkingPrecisionModel(t2), n2.setNoder(e2), this._resultGeometry = n2.buffer(this._argGeom, this._distance);
        }
        bufferReducedPrecision() {
          if (0 === arguments.length) {
            for (let t2 = Si.MAX_PRECISION_DIGITS; t2 >= 0; t2--) {
              try {
                this.bufferReducedPrecision(t2);
              } catch (t3) {
                if (!(t3 instanceof Wn)) throw t3;
                this._saveException = t3;
              }
              if (null !== this._resultGeometry) return null;
            }
            throw this._saveException;
          }
          if (1 === arguments.length) {
            const t2 = arguments[0], e2 = Si.precisionScaleFactor(this._argGeom, this._distance, t2), n2 = new kt(e2);
            this.bufferFixedPrecision(n2);
          }
        }
        computeGeometry() {
          if (this.bufferOriginalPrecision(), null !== this._resultGeometry) return null;
          const t2 = this._argGeom.getFactory().getPrecisionModel();
          t2.getType() === kt.FIXED ? this.bufferFixedPrecision(t2) : this.bufferReducedPrecision();
        }
        setQuadrantSegments(t2) {
          this._bufParams.setQuadrantSegments(t2);
        }
        bufferOriginalPrecision() {
          try {
            const t2 = new pi(this._bufParams);
            this._resultGeometry = t2.buffer(this._argGeom, this._distance);
          } catch (t2) {
            if (!(t2 instanceof c)) throw t2;
            this._saveException = t2;
          }
        }
        getResultGeometry(t2) {
          return this._distance = t2, this.computeGeometry(), this._resultGeometry;
        }
        setEndCapStyle(t2) {
          this._bufParams.setEndCapStyle(t2);
        }
        getClass() {
          return Si;
        }
        get interfaces_() {
          return [];
        }
      }
      Si.constructor_ = function() {
        if (this._argGeom = null, this._distance = null, this._bufParams = new js(), this._resultGeometry = null, this._saveException = null, 1 === arguments.length) {
          const t2 = arguments[0];
          this._argGeom = t2;
        } else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          this._argGeom = t2, this._bufParams = e2;
        }
      }, Si.CAP_ROUND = js.CAP_ROUND, Si.CAP_BUTT = js.CAP_FLAT, Si.CAP_FLAT = js.CAP_FLAT, Si.CAP_SQUARE = js.CAP_SQUARE, Si.MAX_PRECISION_DIGITS = 12;
      var wi = Object.freeze({ __proto__: null, BufferOp: Si, BufferParameters: js });
      class Li {
        constructor() {
          Li.constructor_.apply(this, arguments);
        }
        isInsideArea() {
          return this._segIndex === Li.INSIDE_AREA;
        }
        getCoordinate() {
          return this._pt;
        }
        getGeometryComponent() {
          return this._component;
        }
        getSegmentIndex() {
          return this._segIndex;
        }
        getClass() {
          return Li;
        }
        get interfaces_() {
          return [];
        }
      }
      Li.constructor_ = function() {
        if (this._component = null, this._segIndex = null, this._pt = null, 2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          Li.constructor_.call(this, t2, Li.INSIDE_AREA, e2);
        } else if (3 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
          this._component = t2, this._segIndex = e2, this._pt = n2;
        }
      }, Li.INSIDE_AREA = -1;
      class Ti {
        constructor() {
          Ti.constructor_.apply(this, arguments);
        }
        static getLocations(t2) {
          const e2 = new x();
          return t2.apply(new Ti(e2)), e2;
        }
        filter(t2) {
          (t2 instanceof Pt || t2 instanceof Tt || t2 instanceof bt) && this._locations.add(new Li(t2, 0, t2.getCoordinate()));
        }
        getClass() {
          return Ti;
        }
        get interfaces_() {
          return [gt];
        }
      }
      Ti.constructor_ = function() {
        this._locations = null;
        const t2 = arguments[0];
        this._locations = t2;
      };
      class Ri {
        constructor() {
          Ri.constructor_.apply(this, arguments);
        }
        static distance(t2, e2) {
          return new Ri(t2, e2).distance();
        }
        static isWithinDistance(t2, e2, n2) {
          return !(t2.getEnvelopeInternal().distance(e2.getEnvelopeInternal()) > n2) && new Ri(t2, e2, n2).distance() <= n2;
        }
        static nearestPoints(t2, e2) {
          return new Ri(t2, e2).nearestPoints();
        }
        computeContainmentDistance() {
          if (0 === arguments.length) {
            const t2 = new Array(2).fill(null);
            if (this.computeContainmentDistance(0, t2), this._minDistance <= this._terminateDistance) return null;
            this.computeContainmentDistance(1, t2);
          } else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = this._geom[t2];
            if (n2.getDimension() < 2) return null;
            const s2 = 1 - t2, i2 = Ne.getPolygons(n2);
            if (i2.size() > 0) {
              const n3 = Ti.getLocations(this._geom[s2]);
              if (this.computeContainmentDistance(n3, i2, e2), this._minDistance <= this._terminateDistance) return this._minDistanceLocation[s2] = e2[0], this._minDistanceLocation[t2] = e2[1], null;
            }
          } else if (3 === arguments.length) {
            if (arguments[2] instanceof Array && _(arguments[0], m) && _(arguments[1], m)) {
              const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
              for (let s2 = 0; s2 < t2.size(); s2++) {
                const i2 = t2.get(s2);
                for (let t3 = 0; t3 < e2.size(); t3++) if (this.computeContainmentDistance(i2, e2.get(t3), n2), this._minDistance <= this._terminateDistance) return null;
              }
            } else if (arguments[2] instanceof Array && arguments[0] instanceof Li && arguments[1] instanceof bt) {
              const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = t2.getCoordinate();
              if (ne.EXTERIOR !== this._ptLocator.locate(s2, e2)) return this._minDistance = 0, n2[0] = t2, n2[1] = new Li(e2, s2), null;
            }
          }
        }
        computeMinDistanceLinesPoints(t2, e2, n2) {
          for (let s2 = 0; s2 < t2.size(); s2++) {
            const i2 = t2.get(s2);
            for (let t3 = 0; t3 < e2.size(); t3++) {
              const s3 = e2.get(t3);
              if (this.computeMinDistance(i2, s3, n2), this._minDistance <= this._terminateDistance) return null;
            }
          }
        }
        computeFacetDistance() {
          const t2 = new Array(2).fill(null), e2 = xe.getLines(this._geom[0]), n2 = xe.getLines(this._geom[1]), s2 = Ie.getPoints(this._geom[0]), i2 = Ie.getPoints(this._geom[1]);
          return this.computeMinDistanceLines(e2, n2, t2), this.updateMinDistance(t2, false), this._minDistance <= this._terminateDistance ? null : (t2[0] = null, t2[1] = null, this.computeMinDistanceLinesPoints(e2, i2, t2), this.updateMinDistance(t2, false), this._minDistance <= this._terminateDistance ? null : (t2[0] = null, t2[1] = null, this.computeMinDistanceLinesPoints(n2, s2, t2), this.updateMinDistance(t2, true), this._minDistance <= this._terminateDistance ? null : (t2[0] = null, t2[1] = null, this.computeMinDistancePoints(s2, i2, t2), void this.updateMinDistance(t2, false))));
        }
        nearestLocations() {
          return this.computeMinDistance(), this._minDistanceLocation;
        }
        updateMinDistance(t2, e2) {
          if (null === t2[0]) return null;
          e2 ? (this._minDistanceLocation[0] = t2[1], this._minDistanceLocation[1] = t2[0]) : (this._minDistanceLocation[0] = t2[0], this._minDistanceLocation[1] = t2[1]);
        }
        nearestPoints() {
          return this.computeMinDistance(), [this._minDistanceLocation[0].getCoordinate(), this._minDistanceLocation[1].getCoordinate()];
        }
        computeMinDistance() {
          if (0 === arguments.length) {
            if (null !== this._minDistanceLocation) return null;
            if (this._minDistanceLocation = new Array(2).fill(null), this.computeContainmentDistance(), this._minDistance <= this._terminateDistance) return null;
            this.computeFacetDistance();
          } else if (3 === arguments.length) {
            if (arguments[2] instanceof Array && arguments[0] instanceof Tt && arguments[1] instanceof Pt) {
              const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
              if (t2.getEnvelopeInternal().distance(e2.getEnvelopeInternal()) > this._minDistance) return null;
              const s2 = t2.getCoordinates(), i2 = e2.getCoordinate();
              for (let r2 = 0; r2 < s2.length - 1; r2++) {
                const o2 = D.pointToSegment(i2, s2[r2], s2[r2 + 1]);
                if (o2 < this._minDistance) {
                  this._minDistance = o2;
                  const l2 = new ee(s2[r2], s2[r2 + 1]).closestPoint(i2);
                  n2[0] = new Li(t2, r2, l2), n2[1] = new Li(e2, 0, i2);
                }
                if (this._minDistance <= this._terminateDistance) return null;
              }
            } else if (arguments[2] instanceof Array && arguments[0] instanceof Tt && arguments[1] instanceof Tt) {
              const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
              if (t2.getEnvelopeInternal().distance(e2.getEnvelopeInternal()) > this._minDistance) return null;
              const s2 = t2.getCoordinates(), i2 = e2.getCoordinates();
              for (let r2 = 0; r2 < s2.length - 1; r2++) for (let o2 = 0; o2 < i2.length - 1; o2++) {
                const l2 = D.segmentToSegment(s2[r2], s2[r2 + 1], i2[o2], i2[o2 + 1]);
                if (l2 < this._minDistance) {
                  this._minDistance = l2;
                  const a2 = new ee(s2[r2], s2[r2 + 1]), c2 = new ee(i2[o2], i2[o2 + 1]), h2 = a2.closestPoints(c2);
                  n2[0] = new Li(t2, r2, h2[0]), n2[1] = new Li(e2, o2, h2[1]);
                }
                if (this._minDistance <= this._terminateDistance) return null;
              }
            }
          }
        }
        computeMinDistancePoints(t2, e2, n2) {
          for (let s2 = 0; s2 < t2.size(); s2++) {
            const i2 = t2.get(s2);
            for (let t3 = 0; t3 < e2.size(); t3++) {
              const s3 = e2.get(t3), r2 = i2.getCoordinate().distance(s3.getCoordinate());
              if (r2 < this._minDistance && (this._minDistance = r2, n2[0] = new Li(i2, 0, i2.getCoordinate()), n2[1] = new Li(s3, 0, s3.getCoordinate())), this._minDistance <= this._terminateDistance) return null;
            }
          }
        }
        distance() {
          if (null === this._geom[0] || null === this._geom[1]) throw new n("null geometries are not supported");
          return this._geom[0].isEmpty() || this._geom[1].isEmpty() ? 0 : (this.computeMinDistance(), this._minDistance);
        }
        computeMinDistanceLines(t2, e2, n2) {
          for (let s2 = 0; s2 < t2.size(); s2++) {
            const i2 = t2.get(s2);
            for (let t3 = 0; t3 < e2.size(); t3++) {
              const s3 = e2.get(t3);
              if (this.computeMinDistance(i2, s3, n2), this._minDistance <= this._terminateDistance) return null;
            }
          }
        }
        getClass() {
          return Ri;
        }
        get interfaces_() {
          return [];
        }
      }
      Ri.constructor_ = function() {
        if (this._geom = null, this._terminateDistance = 0, this._ptLocator = new _n(), this._minDistanceLocation = null, this._minDistance = i.MAX_VALUE, 2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          Ri.constructor_.call(this, t2, e2, 0);
        } else if (3 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
          this._geom = new Array(2).fill(null), this._geom[0] = t2, this._geom[1] = e2, this._terminateDistance = n2;
        }
      };
      var Pi = Object.freeze({ __proto__: null, DistanceOp: Ri });
      class vi {
        constructor() {
          vi.constructor_.apply(this, arguments);
        }
        getCoordinates() {
          if (null === this._coordinates) {
            let t2 = 0, e2 = 0;
            const n2 = new I();
            for (let s2 = this._directedEdges.iterator(); s2.hasNext(); ) {
              const i2 = s2.next();
              i2.getEdgeDirection() ? t2++ : e2++, n2.add(i2.getEdge().getLine().getCoordinates(), false, i2.getEdgeDirection());
            }
            this._coordinates = n2.toCoordinateArray(), e2 > t2 && X.reverse(this._coordinates);
          }
          return this._coordinates;
        }
        toLineString() {
          return this._factory.createLineString(this.getCoordinates());
        }
        add(t2) {
          this._directedEdges.add(t2);
        }
        getClass() {
          return vi;
        }
        get interfaces_() {
          return [];
        }
      }
      vi.constructor_ = function() {
        this._factory = null, this._directedEdges = new x(), this._coordinates = null;
        const t2 = arguments[0];
        this._factory = t2;
      };
      class Oi {
        constructor() {
          Oi.constructor_.apply(this, arguments);
        }
        static getComponentWithVisitedState(t2, e2) {
          for (; t2.hasNext(); ) {
            const n2 = t2.next();
            if (n2.isVisited() === e2) return n2;
          }
          return null;
        }
        static setVisited(t2, e2) {
          for (; t2.hasNext(); ) {
            t2.next().setVisited(e2);
          }
        }
        static setMarked(t2, e2) {
          for (; t2.hasNext(); ) {
            t2.next().setMarked(e2);
          }
        }
        setVisited(t2) {
          this._isVisited = t2;
        }
        isMarked() {
          return this._isMarked;
        }
        setData(t2) {
          this._data = t2;
        }
        getData() {
          return this._data;
        }
        setMarked(t2) {
          this._isMarked = t2;
        }
        getContext() {
          return this._data;
        }
        isVisited() {
          return this._isVisited;
        }
        setContext(t2) {
          this._data = t2;
        }
        getClass() {
          return Oi;
        }
        get interfaces_() {
          return [];
        }
      }
      Oi.constructor_ = function() {
        this._isMarked = false, this._isVisited = false, this._data = null;
      };
      class bi extends Oi {
        constructor() {
          super(), bi.constructor_.apply(this, arguments);
        }
        static toEdges(t2) {
          const e2 = new x();
          for (let n2 = t2.iterator(); n2.hasNext(); ) e2.add(n2.next()._parentEdge);
          return e2;
        }
        isRemoved() {
          return null === this._parentEdge;
        }
        compareDirection(t2) {
          return this._quadrant > t2._quadrant ? 1 : this._quadrant < t2._quadrant ? -1 : v.index(t2._p0, t2._p1, this._p1);
        }
        getCoordinate() {
          return this._from.getCoordinate();
        }
        print(t2) {
          const e2 = this.getClass().getName(), n2 = e2.lastIndexOf("."), s2 = e2.substring(n2 + 1);
          t2.print("  " + s2 + ": " + this._p0 + " - " + this._p1 + " " + this._quadrant + ":" + this._angle);
        }
        getDirectionPt() {
          return this._p1;
        }
        getAngle() {
          return this._angle;
        }
        compareTo(t2) {
          const e2 = t2;
          return this.compareDirection(e2);
        }
        getFromNode() {
          return this._from;
        }
        getSym() {
          return this._sym;
        }
        setEdge(t2) {
          this._parentEdge = t2;
        }
        remove() {
          this._sym = null, this._parentEdge = null;
        }
        getEdge() {
          return this._parentEdge;
        }
        getQuadrant() {
          return this._quadrant;
        }
        setSym(t2) {
          this._sym = t2;
        }
        getToNode() {
          return this._to;
        }
        getEdgeDirection() {
          return this._edgeDirection;
        }
        getClass() {
          return bi;
        }
        get interfaces_() {
          return [r];
        }
      }
      bi.constructor_ = function() {
        if (this._parentEdge = null, this._from = null, this._to = null, this._p0 = null, this._p1 = null, this._sym = null, this._edgeDirection = null, this._quadrant = null, this._angle = null, 0 === arguments.length) ;
        else if (4 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3];
          this._from = t2, this._to = e2, this._edgeDirection = s2, this._p0 = t2.getCoordinate(), this._p1 = n2;
          const i2 = this._p1.x - this._p0.x, r2 = this._p1.y - this._p0.y;
          this._quadrant = In.quadrant(i2, r2), this._angle = Math.atan2(r2, i2);
        }
      };
      class Mi extends bi {
        constructor() {
          super(), Mi.constructor_.apply(this, arguments);
        }
        getNext() {
          return 2 !== this.getToNode().getDegree() ? null : this.getToNode().getOutEdges().getEdges().get(0) === this.getSym() ? this.getToNode().getOutEdges().getEdges().get(1) : (u.isTrue(this.getToNode().getOutEdges().getEdges().get(1) === this.getSym()), this.getToNode().getOutEdges().getEdges().get(0));
        }
        getClass() {
          return Mi;
        }
        get interfaces_() {
          return [];
        }
      }
      Mi.constructor_ = function() {
        const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3];
        bi.constructor_.call(this, t2, e2, n2, s2);
      };
      class Di extends Oi {
        constructor() {
          super(), Di.constructor_.apply(this, arguments);
        }
        isRemoved() {
          return null === this._dirEdge;
        }
        setDirectedEdges(t2, e2) {
          this._dirEdge = [t2, e2], t2.setEdge(this), e2.setEdge(this), t2.setSym(e2), e2.setSym(t2), t2.getFromNode().addOutEdge(t2), e2.getFromNode().addOutEdge(e2);
        }
        getDirEdge() {
          if (Number.isInteger(arguments[0])) {
            const t2 = arguments[0];
            return this._dirEdge[t2];
          }
          if (arguments[0] instanceof Fi) {
            const t2 = arguments[0];
            return this._dirEdge[0].getFromNode() === t2 ? this._dirEdge[0] : this._dirEdge[1].getFromNode() === t2 ? this._dirEdge[1] : null;
          }
        }
        remove() {
          this._dirEdge = null;
        }
        getOppositeNode(t2) {
          return this._dirEdge[0].getFromNode() === t2 ? this._dirEdge[0].getToNode() : this._dirEdge[1].getFromNode() === t2 ? this._dirEdge[1].getToNode() : null;
        }
        getClass() {
          return Di;
        }
        get interfaces_() {
          return [];
        }
      }
      Di.constructor_ = function() {
        if (this._dirEdge = null, 0 === arguments.length) ;
        else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          this.setDirectedEdges(t2, e2);
        }
      };
      class Ai {
        constructor() {
          Ai.constructor_.apply(this, arguments);
        }
        getNextEdge(t2) {
          const e2 = this.getIndex(t2);
          return this._outEdges.get(this.getIndex(e2 + 1));
        }
        getCoordinate() {
          const t2 = this.iterator();
          return t2.hasNext() ? t2.next().getCoordinate() : null;
        }
        iterator() {
          return this.sortEdges(), this._outEdges.iterator();
        }
        sortEdges() {
          this._sorted || (Ee.sort(this._outEdges), this._sorted = true);
        }
        remove(t2) {
          this._outEdges.remove(t2);
        }
        getEdges() {
          return this.sortEdges(), this._outEdges;
        }
        getNextCWEdge(t2) {
          const e2 = this.getIndex(t2);
          return this._outEdges.get(this.getIndex(e2 - 1));
        }
        getIndex() {
          if (arguments[0] instanceof Di) {
            const t2 = arguments[0];
            this.sortEdges();
            for (let e2 = 0; e2 < this._outEdges.size(); e2++) {
              if (this._outEdges.get(e2).getEdge() === t2) return e2;
            }
            return -1;
          }
          if (arguments[0] instanceof bi) {
            const t2 = arguments[0];
            this.sortEdges();
            for (let e2 = 0; e2 < this._outEdges.size(); e2++) {
              if (this._outEdges.get(e2) === t2) return e2;
            }
            return -1;
          }
          if (Number.isInteger(arguments[0])) {
            let t2 = arguments[0] % this._outEdges.size();
            return t2 < 0 && (t2 += this._outEdges.size()), t2;
          }
        }
        add(t2) {
          this._outEdges.add(t2), this._sorted = false;
        }
        getDegree() {
          return this._outEdges.size();
        }
        getClass() {
          return Ai;
        }
        get interfaces_() {
          return [];
        }
      }
      Ai.constructor_ = function() {
        this._outEdges = new x(), this._sorted = false;
      };
      class Fi extends Oi {
        constructor() {
          super(), Fi.constructor_.apply(this, arguments);
        }
        static getEdgesBetween(t2, e2) {
          const n2 = new J(bi.toEdges(t2.getOutEdges().getEdges())), s2 = bi.toEdges(e2.getOutEdges().getEdges());
          return n2.retainAll(s2), n2;
        }
        isRemoved() {
          return null === this._pt;
        }
        addOutEdge(t2) {
          this._deStar.add(t2);
        }
        getCoordinate() {
          return this._pt;
        }
        getOutEdges() {
          return this._deStar;
        }
        remove() {
          if (0 === arguments.length) this._pt = null;
          else if (1 === arguments.length) {
            const t2 = arguments[0];
            this._deStar.remove(t2);
          }
        }
        getIndex(t2) {
          return this._deStar.getIndex(t2);
        }
        getDegree() {
          return this._deStar.getDegree();
        }
        getClass() {
          return Fi;
        }
        get interfaces_() {
          return [];
        }
      }
      Fi.constructor_ = function() {
        if (this._pt = null, this._deStar = null, 1 === arguments.length) {
          const t2 = arguments[0];
          Fi.constructor_.call(this, t2, new Ai());
        } else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          this._pt = t2, this._deStar = e2;
        }
      };
      class Gi extends Di {
        constructor() {
          super(), Gi.constructor_.apply(this, arguments);
        }
        getLine() {
          return this._line;
        }
        getClass() {
          return Gi;
        }
        get interfaces_() {
          return [];
        }
      }
      Gi.constructor_ = function() {
        this._line = null;
        const t2 = arguments[0];
        this._line = t2;
      };
      class qi {
        constructor() {
          qi.constructor_.apply(this, arguments);
        }
        find(t2) {
          return this._nodeMap.get(t2);
        }
        iterator() {
          return this._nodeMap.values().iterator();
        }
        remove(t2) {
          return this._nodeMap.remove(t2);
        }
        values() {
          return this._nodeMap.values();
        }
        add(t2) {
          return this._nodeMap.put(t2.getCoordinate(), t2), t2;
        }
        getClass() {
          return qi;
        }
        get interfaces_() {
          return [];
        }
      }
      qi.constructor_ = function() {
        this._nodeMap = new rt();
      };
      class Bi {
        constructor() {
          Bi.constructor_.apply(this, arguments);
        }
        findNodesOfDegree(t2) {
          const e2 = new x();
          for (let n2 = this.nodeIterator(); n2.hasNext(); ) {
            const s2 = n2.next();
            s2.getDegree() === t2 && e2.add(s2);
          }
          return e2;
        }
        dirEdgeIterator() {
          return this._dirEdges.iterator();
        }
        edgeIterator() {
          return this._edges.iterator();
        }
        remove() {
          if (arguments[0] instanceof Di) {
            const t2 = arguments[0];
            this.remove(t2.getDirEdge(0)), this.remove(t2.getDirEdge(1)), this._edges.remove(t2), t2.remove();
          } else if (arguments[0] instanceof bi) {
            const t2 = arguments[0], e2 = t2.getSym();
            null !== e2 && e2.setSym(null), t2.getFromNode().remove(t2), t2.remove(), this._dirEdges.remove(t2);
          } else if (arguments[0] instanceof Fi) {
            const t2 = arguments[0];
            for (let e2 = t2.getOutEdges().getEdges().iterator(); e2.hasNext(); ) {
              const t3 = e2.next(), n2 = t3.getSym();
              null !== n2 && this.remove(n2), this._dirEdges.remove(t3);
              const s2 = t3.getEdge();
              null !== s2 && this._edges.remove(s2);
            }
            this._nodeMap.remove(t2.getCoordinate()), t2.remove();
          }
        }
        findNode(t2) {
          return this._nodeMap.find(t2);
        }
        getEdges() {
          return this._edges;
        }
        nodeIterator() {
          return this._nodeMap.iterator();
        }
        contains() {
          if (arguments[0] instanceof Di) {
            const t2 = arguments[0];
            return this._edges.contains(t2);
          }
          if (arguments[0] instanceof bi) {
            const t2 = arguments[0];
            return this._dirEdges.contains(t2);
          }
        }
        add() {
          if (arguments[0] instanceof Fi) {
            const t2 = arguments[0];
            this._nodeMap.add(t2);
          } else if (arguments[0] instanceof Di) {
            const t2 = arguments[0];
            this._edges.add(t2), this.add(t2.getDirEdge(0)), this.add(t2.getDirEdge(1));
          } else if (arguments[0] instanceof bi) {
            const t2 = arguments[0];
            this._dirEdges.add(t2);
          }
        }
        getNodes() {
          return this._nodeMap.values();
        }
        getClass() {
          return Bi;
        }
        get interfaces_() {
          return [];
        }
      }
      Bi.constructor_ = function() {
        this._edges = new J(), this._dirEdges = new J(), this._nodeMap = new qi();
      };
      class Vi extends Bi {
        constructor() {
          super(), Vi.constructor_.apply(this, arguments);
        }
        addEdge(t2) {
          if (t2.isEmpty()) return null;
          const e2 = X.removeRepeatedPoints(t2.getCoordinates());
          if (e2.length <= 1) return null;
          const n2 = e2[0], s2 = e2[e2.length - 1], i2 = this.getNode(n2), r2 = this.getNode(s2), o2 = new Mi(i2, r2, e2[1], true), l2 = new Mi(r2, i2, e2[e2.length - 2], false), a2 = new Gi(t2);
          a2.setDirectedEdges(o2, l2), this.add(a2);
        }
        getNode(t2) {
          let e2 = this.findNode(t2);
          return null === e2 && (e2 = new Fi(t2), this.add(e2)), e2;
        }
        getClass() {
          return Vi;
        }
        get interfaces_() {
          return [];
        }
      }
      Vi.constructor_ = function() {
      };
      class zi {
        constructor() {
          zi.constructor_.apply(this, arguments);
        }
        buildEdgeStringsForUnprocessedNodes() {
          for (let t2 = this._graph.getNodes().iterator(); t2.hasNext(); ) {
            const e2 = t2.next();
            e2.isMarked() || (u.isTrue(2 === e2.getDegree()), this.buildEdgeStringsStartingAt(e2), e2.setMarked(true));
          }
        }
        buildEdgeStringsForNonDegree2Nodes() {
          for (let t2 = this._graph.getNodes().iterator(); t2.hasNext(); ) {
            const e2 = t2.next();
            2 !== e2.getDegree() && (this.buildEdgeStringsStartingAt(e2), e2.setMarked(true));
          }
        }
        buildEdgeStringsForObviousStartNodes() {
          this.buildEdgeStringsForNonDegree2Nodes();
        }
        getMergedLineStrings() {
          return this.merge(), this._mergedLineStrings;
        }
        buildEdgeStringsStartingAt(t2) {
          for (let e2 = t2.getOutEdges().iterator(); e2.hasNext(); ) {
            const t3 = e2.next();
            t3.getEdge().isMarked() || this._edgeStrings.add(this.buildEdgeStringStartingWith(t3));
          }
        }
        merge() {
          if (null !== this._mergedLineStrings) return null;
          Oi.setMarked(this._graph.nodeIterator(), false), Oi.setMarked(this._graph.edgeIterator(), false), this._edgeStrings = new x(), this.buildEdgeStringsForObviousStartNodes(), this.buildEdgeStringsForIsolatedLoops(), this._mergedLineStrings = new x();
          for (let t2 = this._edgeStrings.iterator(); t2.hasNext(); ) {
            const e2 = t2.next();
            this._mergedLineStrings.add(e2.toLineString());
          }
        }
        addLineString(t2) {
          null === this._factory && (this._factory = t2.getFactory()), this._graph.addEdge(t2);
        }
        buildEdgeStringStartingWith(t2) {
          const e2 = new vi(this._factory);
          let n2 = t2;
          do {
            e2.add(n2), n2.getEdge().setMarked(true), n2 = n2.getNext();
          } while (null !== n2 && n2 !== t2);
          return e2;
        }
        add() {
          if (arguments[0] instanceof q) {
            const t2 = arguments[0];
            for (let e2 = 0; e2 < t2.getNumGeometries(); e2++) {
              const n2 = t2.getGeometryN(e2);
              n2 instanceof Tt && this.addLineString(n2);
            }
          } else if (_(arguments[0], f)) {
            const t2 = arguments[0];
            this._mergedLineStrings = null;
            for (let e2 = t2.iterator(); e2.hasNext(); ) {
              const t3 = e2.next();
              this.add(t3);
            }
          }
        }
        buildEdgeStringsForIsolatedLoops() {
          this.buildEdgeStringsForUnprocessedNodes();
        }
        getClass() {
          return zi;
        }
        get interfaces_() {
          return [];
        }
      }
      zi.constructor_ = function() {
        this._graph = new Vi(), this._mergedLineStrings = null, this._factory = null, this._edgeStrings = null;
      };
      class Yi {
        constructor() {
          Yi.constructor_.apply(this, arguments);
        }
        dirEdgeIterator() {
          return this._dirEdges.iterator();
        }
        edgeIterator() {
          return this._edges.iterator();
        }
        getParent() {
          return this._parentGraph;
        }
        nodeIterator() {
          return this._nodeMap.iterator();
        }
        contains(t2) {
          return this._edges.contains(t2);
        }
        add(t2) {
          if (this._edges.contains(t2)) return null;
          this._edges.add(t2), this._dirEdges.add(t2.getDirEdge(0)), this._dirEdges.add(t2.getDirEdge(1)), this._nodeMap.add(t2.getDirEdge(0).getFromNode()), this._nodeMap.add(t2.getDirEdge(1).getFromNode());
        }
        getClass() {
          return Yi;
        }
        get interfaces_() {
          return [];
        }
      }
      Yi.constructor_ = function() {
        this._parentGraph = null, this._edges = new J(), this._dirEdges = new x(), this._nodeMap = new qi();
        const t2 = arguments[0];
        this._parentGraph = t2;
      };
      class Ui {
        constructor() {
          Ui.constructor_.apply(this, arguments);
        }
        addReachable(t2, e2) {
          const n2 = new on();
          for (n2.add(t2); !n2.empty(); ) {
            const t3 = n2.pop();
            this.addEdges(t3, n2, e2);
          }
        }
        findSubgraph(t2) {
          const e2 = new Yi(this._graph);
          return this.addReachable(t2, e2), e2;
        }
        getConnectedSubgraphs() {
          const t2 = new x();
          Oi.setVisited(this._graph.nodeIterator(), false);
          for (let e2 = this._graph.edgeIterator(); e2.hasNext(); ) {
            const n2 = e2.next().getDirEdge(0).getFromNode();
            n2.isVisited() || t2.add(this.findSubgraph(n2));
          }
          return t2;
        }
        addEdges(t2, e2, n2) {
          t2.setVisited(true);
          for (let s2 = t2.getOutEdges().iterator(); s2.hasNext(); ) {
            const t3 = s2.next();
            n2.add(t3.getEdge());
            const i2 = t3.getToNode();
            i2.isVisited() || e2.push(i2);
          }
        }
        getClass() {
          return Ui;
        }
        get interfaces_() {
          return [];
        }
      }
      Ui.constructor_ = function() {
        this._graph = null;
        const t2 = arguments[0];
        this._graph = t2;
      };
      class ki {
        constructor() {
          ki.constructor_.apply(this, arguments);
        }
        static findUnvisitedBestOrientedDE(t2) {
          let e2 = null, n2 = null;
          for (let s2 = t2.getOutEdges().iterator(); s2.hasNext(); ) {
            const t3 = s2.next();
            t3.getEdge().isVisited() || (n2 = t3, t3.getEdgeDirection() && (e2 = t3));
          }
          return null !== e2 ? e2 : n2;
        }
        static findLowestDegreeNode(t2) {
          let e2 = L.MAX_VALUE, n2 = null;
          for (let s2 = t2.nodeIterator(); s2.hasNext(); ) {
            const t3 = s2.next();
            (null === n2 || t3.getDegree() < e2) && (e2 = t3.getDegree(), n2 = t3);
          }
          return n2;
        }
        static isSequenced(t2) {
          if (!(t2 instanceof ft)) return true;
          const e2 = t2, n2 = new at();
          let s2 = null;
          const i2 = new x();
          for (let t3 = 0; t3 < e2.getNumGeometries(); t3++) {
            const r2 = e2.getGeometryN(t3), o2 = r2.getCoordinateN(0), l2 = r2.getCoordinateN(r2.getNumPoints() - 1);
            if (n2.contains(o2)) return false;
            if (n2.contains(l2)) return false;
            null !== s2 && (o2.equals(s2) || (n2.addAll(i2), i2.clear())), i2.add(o2), i2.add(l2), s2 = l2;
          }
          return true;
        }
        static reverse(t2) {
          const e2 = t2.getCoordinates(), n2 = new Array(e2.length).fill(null), s2 = e2.length;
          for (let t3 = 0; t3 < s2; t3++) n2[s2 - 1 - t3] = new g(e2[t3]);
          return t2.getFactory().createLineString(n2);
        }
        static sequence(t2) {
          const e2 = new ki();
          return e2.add(t2), e2.getSequencedLineStrings();
        }
        addLine(t2) {
          null === this._factory && (this._factory = t2.getFactory()), this._graph.addEdge(t2), this._lineCount++;
        }
        hasSequence(t2) {
          let e2 = 0;
          for (let n2 = t2.nodeIterator(); n2.hasNext(); ) {
            n2.next().getDegree() % 2 == 1 && e2++;
          }
          return e2 <= 2;
        }
        computeSequence() {
          if (this._isRun) return null;
          this._isRun = true;
          const t2 = this.findSequences();
          if (null === t2) return null;
          this._sequencedGeometry = this.buildSequencedGeometry(t2), this._isSequenceable = true;
          const e2 = this._sequencedGeometry.getNumGeometries();
          u.isTrue(this._lineCount === e2, "Lines were missing from result"), u.isTrue(this._sequencedGeometry instanceof Tt || this._sequencedGeometry instanceof ft, "Result is not lineal");
        }
        findSequences() {
          const t2 = new x();
          for (let e2 = new Ui(this._graph).getConnectedSubgraphs().iterator(); e2.hasNext(); ) {
            const n2 = e2.next();
            if (!this.hasSequence(n2)) return null;
            {
              const e3 = this.findSequence(n2);
              t2.add(e3);
            }
          }
          return t2;
        }
        addReverseSubpath(t2, e2, n2) {
          const s2 = t2.getToNode();
          let i2 = null;
          for (; ; ) {
            e2.add(t2.getSym()), t2.getEdge().setVisited(true), i2 = t2.getFromNode();
            const n3 = ki.findUnvisitedBestOrientedDE(i2);
            if (null === n3) break;
            t2 = n3.getSym();
          }
          n2 && u.isTrue(i2 === s2, "path not contiguous");
        }
        findSequence(t2) {
          Oi.setVisited(t2.edgeIterator(), false);
          const e2 = ki.findLowestDegreeNode(t2).getOutEdges().iterator().next().getSym(), n2 = new Zs(), s2 = n2.listIterator();
          for (this.addReverseSubpath(e2, s2, false); s2.hasPrevious(); ) {
            const t3 = s2.previous(), e3 = ki.findUnvisitedBestOrientedDE(t3.getFromNode());
            null !== e3 && this.addReverseSubpath(e3.getSym(), s2, true);
          }
          return this.orient(n2);
        }
        reverse(t2) {
          const e2 = new Zs();
          for (let n2 = t2.iterator(); n2.hasNext(); ) {
            const t3 = n2.next();
            e2.addFirst(t3.getSym());
          }
          return e2;
        }
        orient(t2) {
          const e2 = t2.get(0), n2 = t2.get(t2.size() - 1), s2 = e2.getFromNode(), i2 = n2.getToNode();
          let r2 = false;
          if (1 === s2.getDegree() || 1 === i2.getDegree()) {
            let t3 = false;
            1 === n2.getToNode().getDegree() && false === n2.getEdgeDirection() && (t3 = true, r2 = true), 1 === e2.getFromNode().getDegree() && true === e2.getEdgeDirection() && (t3 = true, r2 = false), t3 || 1 === e2.getFromNode().getDegree() && (r2 = true);
          }
          return r2 ? this.reverse(t2) : t2;
        }
        buildSequencedGeometry(t2) {
          const e2 = new x();
          for (let n2 = t2.iterator(); n2.hasNext(); ) {
            for (let t3 = n2.next().iterator(); t3.hasNext(); ) {
              const n3 = t3.next(), s2 = n3.getEdge().getLine();
              let i2 = s2;
              n3.getEdgeDirection() || s2.isClosed() || (i2 = ki.reverse(s2)), e2.add(i2);
            }
          }
          return 0 === e2.size() ? this._factory.createMultiLineString(new Array(0).fill(null)) : this._factory.buildGeometry(e2);
        }
        getSequencedLineStrings() {
          return this.computeSequence(), this._sequencedGeometry;
        }
        isSequenceable() {
          return this.computeSequence(), this._isSequenceable;
        }
        add() {
          if (_(arguments[0], f)) {
            for (let t2 = arguments[0].iterator(); t2.hasNext(); ) {
              const e2 = t2.next();
              this.add(e2);
            }
          } else if (arguments[0] instanceof q) {
            arguments[0].apply(new class {
              get interfaces_() {
                return [G];
              }
              filter(t2) {
                t2 instanceof Tt && this.addLine(t2);
              }
            }());
          }
        }
        getClass() {
          return ki;
        }
        get interfaces_() {
          return [];
        }
      }
      ki.constructor_ = function() {
        this._graph = new Vi(), this._factory = new Ht(), this._lineCount = 0, this._isRun = false, this._sequencedGeometry = null, this._isSequenceable = false;
      };
      var Xi = Object.freeze({ __proto__: null, LineMerger: zi, LineSequencer: ki });
      class Hi {
        constructor() {
          Hi.constructor_.apply(this, arguments);
        }
        static isClosed(t2) {
          return !(t2.length <= 1) && t2[0].equals2D(t2[t2.length - 1]);
        }
        snapVertices(t2, e2) {
          const n2 = this._isClosed ? t2.size() - 1 : t2.size();
          for (let s2 = 0; s2 < n2; s2++) {
            const n3 = t2.get(s2), i2 = this.findSnapForVertex(n3, e2);
            null !== i2 && (t2.set(s2, new g(i2)), 0 === s2 && this._isClosed && t2.set(t2.size() - 1, new g(i2)));
          }
        }
        findSnapForVertex(t2, e2) {
          for (let n2 = 0; n2 < e2.length; n2++) {
            if (t2.equals2D(e2[n2])) return null;
            if (t2.distance(e2[n2]) < this._snapTolerance) return e2[n2];
          }
          return null;
        }
        snapTo(t2) {
          const e2 = new I(this._srcPts);
          return this.snapVertices(e2, t2), this.snapSegments(e2, t2), e2.toCoordinateArray();
        }
        snapSegments(t2, e2) {
          if (0 === e2.length) return null;
          let n2 = e2.length;
          e2[0].equals2D(e2[e2.length - 1]) && (n2 = e2.length - 1);
          for (let s2 = 0; s2 < n2; s2++) {
            const n3 = e2[s2], i2 = this.findSegmentIndexToSnap(n3, t2);
            i2 >= 0 && t2.add(i2 + 1, new g(n3), false);
          }
        }
        findSegmentIndexToSnap(t2, e2) {
          let n2 = i.MAX_VALUE, s2 = -1;
          for (let i2 = 0; i2 < e2.size() - 1; i2++) {
            if (this._seg.p0 = e2.get(i2), this._seg.p1 = e2.get(i2 + 1), this._seg.p0.equals2D(t2) || this._seg.p1.equals2D(t2)) {
              if (this._allowSnappingToSourceVertices) continue;
              return -1;
            }
            const r2 = this._seg.distance(t2);
            r2 < this._snapTolerance && r2 < n2 && (n2 = r2, s2 = i2);
          }
          return s2;
        }
        setAllowSnappingToSourceVertices(t2) {
          this._allowSnappingToSourceVertices = t2;
        }
        getClass() {
          return Hi;
        }
        get interfaces_() {
          return [];
        }
      }
      Hi.constructor_ = function() {
        if (this._snapTolerance = 0, this._srcPts = null, this._seg = new ee(), this._allowSnappingToSourceVertices = false, this._isClosed = false, arguments[0] instanceof Tt && "number" == typeof arguments[1]) {
          const t2 = arguments[0], e2 = arguments[1];
          Hi.constructor_.call(this, t2.getCoordinates(), e2);
        } else if (arguments[0] instanceof Array && "number" == typeof arguments[1]) {
          const t2 = arguments[0], e2 = arguments[1];
          this._srcPts = t2, this._isClosed = Hi.isClosed(t2), this._snapTolerance = e2;
        }
      };
      class Wi {
        constructor() {
          Wi.constructor_.apply(this, arguments);
        }
        static snap(t2, e2, n2) {
          const s2 = new Array(2).fill(null), i2 = new Wi(t2);
          s2[0] = i2.snapTo(e2, n2);
          const r2 = new Wi(e2);
          return s2[1] = r2.snapTo(s2[0], n2), s2;
        }
        static computeOverlaySnapTolerance() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            let e2 = Wi.computeSizeBasedSnapTolerance(t2);
            const n2 = t2.getPrecisionModel();
            if (n2.getType() === kt.FIXED) {
              const t3 = 1 / n2.getScale() * 2 / 1.415;
              t3 > e2 && (e2 = t3);
            }
            return e2;
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return Math.min(Wi.computeOverlaySnapTolerance(t2), Wi.computeOverlaySnapTolerance(e2));
          }
        }
        static computeSizeBasedSnapTolerance(t2) {
          const e2 = t2.getEnvelopeInternal();
          return Math.min(e2.getHeight(), e2.getWidth()) * Wi.SNAP_PRECISION_FACTOR;
        }
        static snapToSelf(t2, e2, n2) {
          return new Wi(t2).snapToSelf(e2, n2);
        }
        snapTo(t2, e2) {
          const n2 = this.extractTargetCoordinates(t2);
          return new ji(e2, n2).transform(this._srcGeom);
        }
        snapToSelf(t2, e2) {
          const n2 = this.extractTargetCoordinates(this._srcGeom), s2 = new ji(t2, n2, true).transform(this._srcGeom);
          let i2 = s2;
          return e2 && _(i2, Ot) && (i2 = s2.buffer(0)), i2;
        }
        computeSnapTolerance(t2) {
          return this.computeMinimumSegmentLength(t2) / 10;
        }
        extractTargetCoordinates(t2) {
          const e2 = new at(), n2 = t2.getCoordinates();
          for (let t3 = 0; t3 < n2.length; t3++) e2.add(n2[t3]);
          return e2.toArray(new Array(0).fill(null));
        }
        computeMinimumSegmentLength(t2) {
          let e2 = i.MAX_VALUE;
          for (let n2 = 0; n2 < t2.length - 1; n2++) {
            const s2 = t2[n2].distance(t2[n2 + 1]);
            s2 < e2 && (e2 = s2);
          }
          return e2;
        }
        getClass() {
          return Wi;
        }
        get interfaces_() {
          return [];
        }
      }
      Wi.constructor_ = function() {
        this._srcGeom = null;
        const t2 = arguments[0];
        this._srcGeom = t2;
      }, Wi.SNAP_PRECISION_FACTOR = 1e-9;
      class ji extends me {
        constructor() {
          super(), ji.constructor_.apply(this, arguments);
        }
        snapLine(t2, e2) {
          const n2 = new Hi(t2, this._snapTolerance);
          return n2.setAllowSnappingToSourceVertices(this._isSelfSnap), n2.snapTo(e2);
        }
        transformCoordinates(t2, e2) {
          const n2 = t2.toCoordinateArray(), s2 = this.snapLine(n2, this._snapPts);
          return this._factory.getCoordinateSequenceFactory().create(s2);
        }
        getClass() {
          return ji;
        }
        get interfaces_() {
          return [];
        }
      }
      ji.constructor_ = function() {
        if (this._snapTolerance = null, this._snapPts = null, this._isSelfSnap = false, 2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          this._snapTolerance = t2, this._snapPts = e2;
        } else if (3 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
          this._snapTolerance = t2, this._snapPts = e2, this._isSelfSnap = n2;
        }
      };
      var Ki = Object.freeze({ __proto__: null, GeometrySnapper: Wi, LineStringSnapper: Hi });
      class Zi {
        constructor() {
          Zi.constructor_.apply(this, arguments);
        }
        getCoordinates() {
          return this._pts;
        }
        size() {
          return this._pts.length;
        }
        getCoordinate(t2) {
          return this._pts[t2];
        }
        isClosed() {
          return this._pts[0].equals(this._pts[this._pts.length - 1]);
        }
        getSegmentOctant(t2) {
          return t2 === this._pts.length - 1 ? -1 : Ms.octant(this.getCoordinate(t2), this.getCoordinate(t2 + 1));
        }
        setData(t2) {
          this._data = t2;
        }
        getData() {
          return this._data;
        }
        toString() {
          return Jt.toLineString(new zt(this._pts));
        }
        getClass() {
          return Zi;
        }
        get interfaces_() {
          return [Ds];
        }
      }
      Zi.constructor_ = function() {
        this._pts = null, this._data = null;
        const t2 = arguments[0], e2 = arguments[1];
        this._pts = t2, this._data = e2;
      };
      class Qi {
        constructor() {
          Qi.constructor_.apply(this, arguments);
        }
        static createAllIntersectionsFinder(t2) {
          const e2 = new Qi(t2);
          return e2.setFindAllIntersections(true), e2;
        }
        static createAnyIntersectionFinder(t2) {
          return new Qi(t2);
        }
        static createIntersectionCounter(t2) {
          const e2 = new Qi(t2);
          return e2.setFindAllIntersections(true), e2.setKeepIntersections(false), e2;
        }
        getInteriorIntersection() {
          return this._interiorIntersection;
        }
        setCheckEndSegmentsOnly(t2) {
          this._isCheckEndSegmentsOnly = t2;
        }
        getIntersectionSegments() {
          return this._intSegments;
        }
        count() {
          return this._intersectionCount;
        }
        getIntersections() {
          return this._intersections;
        }
        setFindAllIntersections(t2) {
          this._findAllIntersections = t2;
        }
        setKeepIntersections(t2) {
          this._keepIntersections = t2;
        }
        processIntersections(t2, e2, n2, s2) {
          if (!this._findAllIntersections && this.hasIntersection()) return null;
          if (t2 === n2 && e2 === s2) return null;
          if (this._isCheckEndSegmentsOnly) {
            if (!(this.isEndSegment(t2, e2) || this.isEndSegment(n2, s2))) return null;
          }
          const i2 = t2.getCoordinates()[e2], r2 = t2.getCoordinates()[e2 + 1], o2 = n2.getCoordinates()[s2], l2 = n2.getCoordinates()[s2 + 1];
          this._li.computeIntersection(i2, r2, o2, l2), this._li.hasIntersection() && this._li.isInteriorIntersection() && (this._intSegments = new Array(4).fill(null), this._intSegments[0] = i2, this._intSegments[1] = r2, this._intSegments[2] = o2, this._intSegments[3] = l2, this._interiorIntersection = this._li.getIntersection(0), this._keepIntersections && this._intersections.add(this._interiorIntersection), this._intersectionCount++);
        }
        isEndSegment(t2, e2) {
          return 0 === e2 || e2 >= t2.size() - 2;
        }
        hasIntersection() {
          return null !== this._interiorIntersection;
        }
        isDone() {
          return !this._findAllIntersections && null !== this._interiorIntersection;
        }
        getClass() {
          return Qi;
        }
        get interfaces_() {
          return [_i];
        }
      }
      Qi.constructor_ = function() {
        this._findAllIntersections = false, this._isCheckEndSegmentsOnly = false, this._li = null, this._interiorIntersection = null, this._intSegments = null, this._intersections = new x(), this._intersectionCount = 0, this._keepIntersections = true;
        const t2 = arguments[0];
        this._li = t2, this._interiorIntersection = null;
      };
      class Ji {
        constructor() {
          Ji.constructor_.apply(this, arguments);
        }
        static computeIntersections(t2) {
          const e2 = new Ji(t2);
          return e2.setFindAllIntersections(true), e2.isValid(), e2.getIntersections();
        }
        execute() {
          if (null !== this._segInt) return null;
          this.checkInteriorIntersections();
        }
        getIntersections() {
          return this._segInt.getIntersections();
        }
        isValid() {
          return this.execute(), this._isValid;
        }
        setFindAllIntersections(t2) {
          this._findAllIntersections = t2;
        }
        checkInteriorIntersections() {
          this._isValid = true, this._segInt = new Qi(this._li), this._segInt.setFindAllIntersections(this._findAllIntersections);
          const t2 = new Ys();
          if (t2.setSegmentIntersector(this._segInt), t2.computeNodes(this._segStrings), this._segInt.hasIntersection()) return this._isValid = false, null;
        }
        checkValid() {
          if (this.execute(), !this._isValid) throw new Wn(this.getErrorMessage(), this._segInt.getInteriorIntersection());
        }
        getErrorMessage() {
          if (this._isValid) return "no intersections found";
          const t2 = this._segInt.getIntersectionSegments();
          return "found non-noded intersection between " + Jt.toLineString(t2[0], t2[1]) + " and " + Jt.toLineString(t2[2], t2[3]);
        }
        getClass() {
          return Ji;
        }
        get interfaces_() {
          return [];
        }
      }
      Ji.constructor_ = function() {
        this._li = new te(), this._segStrings = null, this._findAllIntersections = false, this._segInt = null, this._isValid = true;
        const t2 = arguments[0];
        this._segStrings = t2;
      };
      class $i {
        constructor() {
          $i.constructor_.apply(this, arguments);
        }
        static toSegmentStrings(t2) {
          const e2 = new x();
          for (let n2 = t2.iterator(); n2.hasNext(); ) {
            const t3 = n2.next();
            e2.add(new Zi(t3.getCoordinates(), t3));
          }
          return e2;
        }
        static checkValid(t2) {
          new $i(t2).checkValid();
        }
        checkValid() {
          this._nv.checkValid();
        }
        getClass() {
          return $i;
        }
        get interfaces_() {
          return [];
        }
      }
      $i.constructor_ = function() {
        this._nv = null;
        const t2 = arguments[0];
        this._nv = new Ji($i.toSegmentStrings(t2));
      };
      class tr {
        constructor() {
          tr.constructor_.apply(this, arguments);
        }
        collectLines(t2) {
          for (let e2 = this._op.getGraph().getEdgeEnds().iterator(); e2.hasNext(); ) {
            const n2 = e2.next();
            this.collectLineEdge(n2, t2, this._lineEdgesList), this.collectBoundaryTouchEdge(n2, t2, this._lineEdgesList);
          }
        }
        labelIsolatedLine(t2, e2) {
          const n2 = this._ptLocator.locate(t2.getCoordinate(), this._op.getArgGeometry(e2));
          t2.getLabel().setLocation(e2, n2);
        }
        build(t2) {
          return this.findCoveredLineEdges(), this.collectLines(t2), this.buildLines(t2), this._resultLineList;
        }
        collectLineEdge(t2, e2, n2) {
          const s2 = t2.getLabel(), i2 = t2.getEdge();
          t2.isLineEdge() && (t2.isVisited() || !cr.isResultOfOp(s2, e2) || i2.isCovered() || (n2.add(i2), t2.setVisitedEdge(true)));
        }
        findCoveredLineEdges() {
          for (let t2 = this._op.getGraph().getNodes().iterator(); t2.hasNext(); ) {
            t2.next().getEdges().findCoveredLineEdges();
          }
          for (let t2 = this._op.getGraph().getEdgeEnds().iterator(); t2.hasNext(); ) {
            const e2 = t2.next(), n2 = e2.getEdge();
            if (e2.isLineEdge() && !n2.isCoveredSet()) {
              const t3 = this._op.isCoveredByA(e2.getCoordinate());
              n2.setCovered(t3);
            }
          }
        }
        labelIsolatedLines(t2) {
          for (let e2 = t2.iterator(); e2.hasNext(); ) {
            const t3 = e2.next(), n2 = t3.getLabel();
            t3.isIsolated() && (n2.isNull(0) ? this.labelIsolatedLine(t3, 0) : this.labelIsolatedLine(t3, 1));
          }
        }
        buildLines(t2) {
          for (let t3 = this._lineEdgesList.iterator(); t3.hasNext(); ) {
            const e2 = t3.next(), n2 = (e2.getLabel(), this._geometryFactory.createLineString(e2.getCoordinates()));
            this._resultLineList.add(n2), e2.setInResult(true);
          }
        }
        collectBoundaryTouchEdge(t2, e2, n2) {
          const s2 = t2.getLabel();
          return t2.isLineEdge() || t2.isVisited() || t2.isInteriorAreaEdge() || t2.getEdge().isInResult() ? null : (u.isTrue(!(t2.isInResult() || t2.getSym().isInResult()) || !t2.getEdge().isInResult()), void (cr.isResultOfOp(s2, e2) && e2 === cr.INTERSECTION && (n2.add(t2.getEdge()), t2.setVisitedEdge(true))));
        }
        getClass() {
          return tr;
        }
        get interfaces_() {
          return [];
        }
      }
      tr.constructor_ = function() {
        this._op = null, this._geometryFactory = null, this._ptLocator = null, this._lineEdgesList = new x(), this._resultLineList = new x();
        const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
        this._op = t2, this._geometryFactory = e2, this._ptLocator = n2;
      };
      class er {
        constructor() {
          er.constructor_.apply(this, arguments);
        }
        filterCoveredNodeToPoint(t2) {
          const e2 = t2.getCoordinate();
          if (!this._op.isCoveredByLA(e2)) {
            const t3 = this._geometryFactory.createPoint(e2);
            this._resultPointList.add(t3);
          }
        }
        extractNonCoveredResultNodes(t2) {
          for (let e2 = this._op.getGraph().getNodes().iterator(); e2.hasNext(); ) {
            const n2 = e2.next();
            if (!n2.isInResult() && (!n2.isIncidentEdgeInResult() && (0 === n2.getEdges().getDegree() || t2 === cr.INTERSECTION))) {
              const e3 = n2.getLabel();
              cr.isResultOfOp(e3, t2) && this.filterCoveredNodeToPoint(n2);
            }
          }
        }
        build(t2) {
          return this.extractNonCoveredResultNodes(t2), this._resultPointList;
        }
        getClass() {
          return er;
        }
        get interfaces_() {
          return [];
        }
      }
      er.constructor_ = function() {
        this._op = null, this._geometryFactory = null, this._resultPointList = new x();
        const t2 = arguments[0], e2 = arguments[1];
        this._op = t2, this._geometryFactory = e2;
      };
      class nr {
        constructor() {
          this._isFirst = true, this._commonMantissaBitsCount = 53, this._commonBits = new s(), this._commonSignExp = null;
        }
        getCommon() {
          return i.longBitsToDouble(this._commonBits);
        }
        add(t2) {
          const e2 = i.doubleToLongBits(t2);
          return this._isFirst ? (this._commonBits = e2, this._commonSignExp = nr.signExpBits(this._commonBits), this._isFirst = false, null) : nr.signExpBits(e2) !== this._commonSignExp ? (this._commonBits.high = 0, this._commonBits.low = 0, null) : (this._commonMantissaBitsCount = nr.numCommonMostSigMantissaBits(this._commonBits, e2), void (this._commonBits = nr.zeroLowerBits(this._commonBits, 64 - (12 + this._commonMantissaBitsCount))));
        }
        toString() {
          if (1 === arguments.length) {
            const t2 = arguments[0], e2 = i.longBitsToDouble(t2), n2 = "0000000000000000000000000000000000000000000000000000000000000000" + s.toBinaryString(t2), r2 = n2.substring(n2.length - 64);
            return r2.substring(0, 1) + "  " + r2.substring(1, 12) + "(exp) " + r2.substring(12) + " [ " + e2 + " ]";
          }
        }
        getClass() {
          return nr;
        }
        get interfaces_() {
          return [];
        }
        static getBit(t2, e2) {
          const n2 = 1 << e2 % 32;
          return e2 < 32 ? 0 != (t2.low & n2) ? 1 : 0 : 0 != (t2.high & n2) ? 1 : 0;
        }
        static signExpBits(t2) {
          return t2.high >>> 20;
        }
        static zeroLowerBits(t2, e2) {
          let n2 = "low";
          if (e2 > 32 && (t2.low = 0, e2 %= 32, n2 = "high"), e2 > 0) {
            const s2 = e2 < 32 ? ~((1 << e2) - 1) : 0;
            t2[n2] &= s2;
          }
          return t2;
        }
        static numCommonMostSigMantissaBits(t2, e2) {
          let n2 = 0;
          for (let s2 = 52; s2 >= 0; s2--) {
            if (nr.getBit(t2, s2) !== nr.getBit(e2, s2)) return n2;
            n2++;
          }
          return 52;
        }
      }
      class sr {
        constructor() {
          sr.constructor_.apply(this, arguments);
        }
        addCommonBits(t2) {
          const e2 = new rr(this._commonCoord);
          t2.apply(e2), t2.geometryChanged();
        }
        removeCommonBits(t2) {
          if (0 === this._commonCoord.x && 0 === this._commonCoord.y) return t2;
          const e2 = new g(this._commonCoord);
          e2.x = -e2.x, e2.y = -e2.y;
          const n2 = new rr(e2);
          return t2.apply(n2), t2.geometryChanged(), t2;
        }
        getCommonCoordinate() {
          return this._commonCoord;
        }
        add(t2) {
          t2.apply(this._ccFilter), this._commonCoord = this._ccFilter.getCommonCoordinate();
        }
        getClass() {
          return sr;
        }
        get interfaces_() {
          return [];
        }
      }
      class ir {
        constructor() {
          ir.constructor_.apply(this, arguments);
        }
        filter(t2) {
          this._commonBitsX.add(t2.x), this._commonBitsY.add(t2.y);
        }
        getCommonCoordinate() {
          return new g(this._commonBitsX.getCommon(), this._commonBitsY.getCommon());
        }
        getClass() {
          return ir;
        }
        get interfaces_() {
          return [B];
        }
      }
      ir.constructor_ = function() {
        this._commonBitsX = new nr(), this._commonBitsY = new nr();
      };
      class rr {
        constructor() {
          rr.constructor_.apply(this, arguments);
        }
        filter(t2, e2) {
          const n2 = t2.getOrdinate(e2, 0) + this.trans.x, s2 = t2.getOrdinate(e2, 1) + this.trans.y;
          t2.setOrdinate(e2, 0, n2), t2.setOrdinate(e2, 1, s2);
        }
        isDone() {
          return false;
        }
        isGeometryChanged() {
          return true;
        }
        getClass() {
          return rr;
        }
        get interfaces_() {
          return [dt];
        }
      }
      rr.constructor_ = function() {
        this.trans = null;
        const t2 = arguments[0];
        this.trans = t2;
      }, sr.CommonCoordinateFilter = ir, sr.Translater = rr, sr.constructor_ = function() {
        this._commonCoord = null, this._ccFilter = new ir();
      };
      class or {
        constructor() {
          or.constructor_.apply(this, arguments);
        }
        static overlayOp(t2, e2, n2) {
          return new or(t2, e2).getResultGeometry(n2);
        }
        static union(t2, e2) {
          return or.overlayOp(t2, e2, cr.UNION);
        }
        static intersection(t2, e2) {
          return or.overlayOp(t2, e2, cr.INTERSECTION);
        }
        static symDifference(t2, e2) {
          return or.overlayOp(t2, e2, cr.SYMDIFFERENCE);
        }
        static difference(t2, e2) {
          return or.overlayOp(t2, e2, cr.DIFFERENCE);
        }
        selfSnap(t2) {
          return new Wi(t2).snapTo(t2, this._snapTolerance);
        }
        removeCommonBits(t2) {
          this._cbr = new sr(), this._cbr.add(t2[0]), this._cbr.add(t2[1]);
          const e2 = new Array(2).fill(null);
          return e2[0] = this._cbr.removeCommonBits(t2[0].copy()), e2[1] = this._cbr.removeCommonBits(t2[1].copy()), e2;
        }
        prepareResult(t2) {
          return this._cbr.addCommonBits(t2), t2;
        }
        getResultGeometry(t2) {
          const e2 = this.snap(this._geom), n2 = cr.overlayOp(e2[0], e2[1], t2);
          return this.prepareResult(n2);
        }
        checkValid(t2) {
          t2.isValid() || O.out.println("Snapped geometry is invalid");
        }
        computeSnapTolerance() {
          this._snapTolerance = Wi.computeOverlaySnapTolerance(this._geom[0], this._geom[1]);
        }
        snap(t2) {
          const e2 = this.removeCommonBits(t2);
          return Wi.snap(e2[0], e2[1], this._snapTolerance);
        }
        getClass() {
          return or;
        }
        get interfaces_() {
          return [];
        }
      }
      or.constructor_ = function() {
        this._geom = new Array(2).fill(null), this._snapTolerance = null, this._cbr = null;
        const t2 = arguments[0], e2 = arguments[1];
        this._geom[0] = t2, this._geom[1] = e2, this.computeSnapTolerance();
      };
      class lr {
        constructor() {
          lr.constructor_.apply(this, arguments);
        }
        static overlayOp(t2, e2, n2) {
          return new lr(t2, e2).getResultGeometry(n2);
        }
        static union(t2, e2) {
          return lr.overlayOp(t2, e2, cr.UNION);
        }
        static intersection(t2, e2) {
          return lr.overlayOp(t2, e2, cr.INTERSECTION);
        }
        static symDifference(t2, e2) {
          return lr.overlayOp(t2, e2, cr.SYMDIFFERENCE);
        }
        static difference(t2, e2) {
          return lr.overlayOp(t2, e2, cr.DIFFERENCE);
        }
        getResultGeometry(t2) {
          let e2 = null, n2 = false, s2 = null;
          try {
            e2 = cr.overlayOp(this._geom[0], this._geom[1], t2), n2 = true;
          } catch (t3) {
            if (!(t3 instanceof c)) throw t3;
            s2 = t3;
          }
          if (!n2) try {
            e2 = or.overlayOp(this._geom[0], this._geom[1], t2);
          } catch (t3) {
            throw t3 instanceof c ? s2 : t3;
          }
          return e2;
        }
        getClass() {
          return lr;
        }
        get interfaces_() {
          return [];
        }
      }
      lr.constructor_ = function() {
        this._geom = new Array(2).fill(null);
        const t2 = arguments[0], e2 = arguments[1];
        this._geom[0] = t2, this._geom[1] = e2;
      };
      class ar {
        constructor() {
          ar.constructor_.apply(this, arguments);
        }
        getArgGeometry(t2) {
          return this._arg[t2].getGeometry();
        }
        setComputationPrecision(t2) {
          this._resultPrecisionModel = t2, this._li.setPrecisionModel(this._resultPrecisionModel);
        }
        getClass() {
          return ar;
        }
        get interfaces_() {
          return [];
        }
      }
      ar.constructor_ = function() {
        if (this._li = new te(), this._resultPrecisionModel = null, this._arg = null, 1 === arguments.length) {
          const t2 = arguments[0];
          this.setComputationPrecision(t2.getPrecisionModel()), this._arg = new Array(1).fill(null), this._arg[0] = new Qn(0, t2);
        } else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          ar.constructor_.call(this, t2, e2, V.OGC_SFS_BOUNDARY_RULE);
        } else if (3 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
          t2.getPrecisionModel().compareTo(e2.getPrecisionModel()) >= 0 ? this.setComputationPrecision(t2.getPrecisionModel()) : this.setComputationPrecision(e2.getPrecisionModel()), this._arg = new Array(2).fill(null), this._arg[0] = new Qn(0, t2, n2), this._arg[1] = new Qn(1, e2, n2);
        }
      };
      class cr extends ar {
        constructor() {
          super(), cr.constructor_.apply(this, arguments);
        }
        static overlayOp(t2, e2, n2) {
          return new cr(t2, e2).getResultGeometry(n2);
        }
        static union(t2, e2) {
          if (t2.isEmpty() || e2.isEmpty()) {
            if (t2.isEmpty() && e2.isEmpty()) return cr.createEmptyResult(cr.UNION, t2, e2, t2.getFactory());
            if (t2.isEmpty()) return e2.copy();
            if (e2.isEmpty()) return t2.copy();
          }
          if (t2.isGeometryCollection() || e2.isGeometryCollection()) throw new n("This method does not support GeometryCollection arguments");
          return lr.overlayOp(t2, e2, cr.UNION);
        }
        static intersection(t2, e2) {
          if (t2.isEmpty() || e2.isEmpty()) return cr.createEmptyResult(cr.INTERSECTION, t2, e2, t2.getFactory());
          if (t2.isGeometryCollection()) {
            const n2 = e2;
            return ge.map(t2, new class {
              get interfaces_() {
                return [fe];
              }
              map(t3) {
                return cr.intersection(t3, n2);
              }
            }());
          }
          return lr.overlayOp(t2, e2, cr.INTERSECTION);
        }
        static symDifference(t2, e2) {
          if (t2.isEmpty() || e2.isEmpty()) {
            if (t2.isEmpty() && e2.isEmpty()) return cr.createEmptyResult(cr.SYMDIFFERENCE, t2, e2, t2.getFactory());
            if (t2.isEmpty()) return e2.copy();
            if (e2.isEmpty()) return t2.copy();
          }
          if (t2.isGeometryCollection() || e2.isGeometryCollection()) throw new n("This method does not support GeometryCollection arguments");
          return lr.overlayOp(t2, e2, cr.SYMDIFFERENCE);
        }
        static resultDimension(t2, e2, n2) {
          const s2 = e2.getDimension(), i2 = n2.getDimension();
          let r2 = -1;
          switch (t2) {
            case cr.INTERSECTION:
              r2 = Math.min(s2, i2);
              break;
            case cr.UNION:
              r2 = Math.max(s2, i2);
              break;
            case cr.DIFFERENCE:
              r2 = s2;
              break;
            case cr.SYMDIFFERENCE:
              r2 = Math.max(s2, i2);
          }
          return r2;
        }
        static createEmptyResult(t2, e2, n2, s2) {
          let i2 = null;
          switch (cr.resultDimension(t2, e2, n2)) {
            case -1:
              i2 = s2.createGeometryCollection();
              break;
            case 0:
              i2 = s2.createPoint();
              break;
            case 1:
              i2 = s2.createLineString();
              break;
            case 2:
              i2 = s2.createPolygon();
          }
          return i2;
        }
        static difference(t2, e2) {
          if (t2.isEmpty()) return cr.createEmptyResult(cr.DIFFERENCE, t2, e2, t2.getFactory());
          if (e2.isEmpty()) return t2.copy();
          if (t2.isGeometryCollection() || e2.isGeometryCollection()) throw new n("This method does not support GeometryCollection arguments");
          return lr.overlayOp(t2, e2, cr.DIFFERENCE);
        }
        static isResultOfOp() {
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = t2.getLocation(0), s2 = t2.getLocation(1);
            return cr.isResultOfOp(n2, s2, e2);
          }
          if (3 === arguments.length) {
            let t2 = arguments[0], e2 = arguments[1];
            const n2 = arguments[2];
            switch (t2 === ne.BOUNDARY && (t2 = ne.INTERIOR), e2 === ne.BOUNDARY && (e2 = ne.INTERIOR), n2) {
              case cr.INTERSECTION:
                return t2 === ne.INTERIOR && e2 === ne.INTERIOR;
              case cr.UNION:
                return t2 === ne.INTERIOR || e2 === ne.INTERIOR;
              case cr.DIFFERENCE:
                return t2 === ne.INTERIOR && e2 !== ne.INTERIOR;
              case cr.SYMDIFFERENCE:
                return t2 === ne.INTERIOR && e2 !== ne.INTERIOR || t2 !== ne.INTERIOR && e2 === ne.INTERIOR;
            }
            return false;
          }
        }
        insertUniqueEdge(t2) {
          const e2 = this._edgeList.findEqualEdge(t2);
          if (null !== e2) {
            const n2 = e2.getLabel();
            let s2 = t2.getLabel();
            e2.isPointwiseEqual(t2) || (s2 = new Fn(t2.getLabel()), s2.flip());
            const i2 = e2.getDepth();
            i2.isNull() && i2.add(n2), i2.add(s2), n2.merge(s2);
          } else this._edgeList.add(t2);
        }
        getGraph() {
          return this._graph;
        }
        cancelDuplicateResultEdges() {
          for (let t2 = this._graph.getEdgeEnds().iterator(); t2.hasNext(); ) {
            const e2 = t2.next(), n2 = e2.getSym();
            e2.isInResult() && n2.isInResult() && (e2.setInResult(false), n2.setInResult(false));
          }
        }
        isCoveredByLA(t2) {
          return !!this.isCovered(t2, this._resultLineList) || !!this.isCovered(t2, this._resultPolyList);
        }
        computeGeometry(t2, e2, n2, s2) {
          const i2 = new x();
          return i2.addAll(t2), i2.addAll(e2), i2.addAll(n2), i2.isEmpty() ? cr.createEmptyResult(s2, this._arg[0].getGeometry(), this._arg[1].getGeometry(), this._geomFact) : this._geomFact.buildGeometry(i2);
        }
        mergeSymLabels() {
          for (let t2 = this._graph.getNodes().iterator(); t2.hasNext(); ) {
            t2.next().getEdges().mergeSymLabels();
          }
        }
        isCovered(t2, e2) {
          for (let n2 = e2.iterator(); n2.hasNext(); ) {
            const e3 = n2.next();
            if (this._ptLocator.locate(t2, e3) !== ne.EXTERIOR) return true;
          }
          return false;
        }
        replaceCollapsedEdges() {
          const t2 = new x();
          for (let e2 = this._edgeList.iterator(); e2.hasNext(); ) {
            const n2 = e2.next();
            n2.isCollapsed() && (e2.remove(), t2.add(n2.getCollapsedEdge()));
          }
          this._edgeList.addAll(t2);
        }
        updateNodeLabelling() {
          for (let t2 = this._graph.getNodes().iterator(); t2.hasNext(); ) {
            const e2 = t2.next(), n2 = e2.getEdges().getLabel();
            e2.getLabel().merge(n2);
          }
        }
        getResultGeometry(t2) {
          return this.computeOverlay(t2), this._resultGeom;
        }
        insertUniqueEdges(t2) {
          for (let e2 = t2.iterator(); e2.hasNext(); ) {
            const t3 = e2.next();
            this.insertUniqueEdge(t3);
          }
        }
        computeOverlay(t2) {
          this.copyPoints(0), this.copyPoints(1), this._arg[0].computeSelfNodes(this._li, false), this._arg[1].computeSelfNodes(this._li, false), this._arg[0].computeEdgeIntersections(this._arg[1], this._li, true);
          const e2 = new x();
          this._arg[0].computeSplitEdges(e2), this._arg[1].computeSplitEdges(e2), this.insertUniqueEdges(e2), this.computeLabelsFromDepths(), this.replaceCollapsedEdges(), $i.checkValid(this._edgeList.getEdges()), this._graph.addEdges(this._edgeList.getEdges()), this.computeLabelling(), this.labelIncompleteNodes(), this.findResultAreaEdges(t2), this.cancelDuplicateResultEdges();
          const n2 = new ei(this._geomFact);
          n2.add(this._graph), this._resultPolyList = n2.getPolygons();
          const s2 = new tr(this, this._geomFact, this._ptLocator);
          this._resultLineList = s2.build(t2);
          const i2 = new er(this, this._geomFact, this._ptLocator);
          this._resultPointList = i2.build(t2), this._resultGeom = this.computeGeometry(this._resultPointList, this._resultLineList, this._resultPolyList, t2);
        }
        labelIncompleteNode(t2, e2) {
          const n2 = this._ptLocator.locate(t2.getCoordinate(), this._arg[e2].getGeometry());
          t2.getLabel().setLocation(e2, n2);
        }
        copyPoints(t2) {
          for (let e2 = this._arg[t2].getNodeIterator(); e2.hasNext(); ) {
            const n2 = e2.next();
            this._graph.addNode(n2.getCoordinate()).setLabel(t2, n2.getLabel().getLocation(t2));
          }
        }
        findResultAreaEdges(t2) {
          for (let e2 = this._graph.getEdgeEnds().iterator(); e2.hasNext(); ) {
            const n2 = e2.next(), s2 = n2.getLabel();
            s2.isArea() && !n2.isInteriorAreaEdge() && cr.isResultOfOp(s2.getLocation(0, Pn.RIGHT), s2.getLocation(1, Pn.RIGHT), t2) && n2.setInResult(true);
          }
        }
        computeLabelsFromDepths() {
          for (let t2 = this._edgeList.iterator(); t2.hasNext(); ) {
            const e2 = t2.next(), n2 = e2.getLabel(), s2 = e2.getDepth();
            if (!s2.isNull()) {
              s2.normalize();
              for (let t3 = 0; t3 < 2; t3++) n2.isNull(t3) || !n2.isArea() || s2.isNull(t3) || (0 === s2.getDelta(t3) ? n2.toLine(t3) : (u.isTrue(!s2.isNull(t3, Pn.LEFT), "depth of LEFT side has not been initialized"), n2.setLocation(t3, Pn.LEFT, s2.getLocation(t3, Pn.LEFT)), u.isTrue(!s2.isNull(t3, Pn.RIGHT), "depth of RIGHT side has not been initialized"), n2.setLocation(t3, Pn.RIGHT, s2.getLocation(t3, Pn.RIGHT))));
            }
          }
        }
        computeLabelling() {
          for (let t2 = this._graph.getNodes().iterator(); t2.hasNext(); ) {
            t2.next().getEdges().computeLabelling(this._arg);
          }
          this.mergeSymLabels(), this.updateNodeLabelling();
        }
        labelIncompleteNodes() {
          for (let t2 = this._graph.getNodes().iterator(); t2.hasNext(); ) {
            const e2 = t2.next(), n2 = e2.getLabel();
            e2.isIsolated() && (n2.isNull(0) ? this.labelIncompleteNode(e2, 0) : this.labelIncompleteNode(e2, 1)), e2.getEdges().updateLabelling(n2);
          }
        }
        isCoveredByA(t2) {
          return !!this.isCovered(t2, this._resultPolyList);
        }
        getClass() {
          return cr;
        }
        get interfaces_() {
          return [];
        }
      }
      cr.constructor_ = function() {
        this._ptLocator = new _n(), this._geomFact = null, this._resultGeom = null, this._graph = null, this._edgeList = new di(), this._resultPolyList = new x(), this._resultLineList = new x(), this._resultPointList = new x();
        const t2 = arguments[0], e2 = arguments[1];
        ar.constructor_.call(this, t2, e2), this._graph = new Zn(new ui()), this._geomFact = t2.getFactory();
      }, cr.INTERSECTION = 1, cr.UNION = 2, cr.DIFFERENCE = 3, cr.SYMDIFFERENCE = 4;
      var hr = Object.freeze({ __proto__: null, snap: Ki, OverlayOp: cr });
      class ur extends bi {
        constructor() {
          super(), ur.constructor_.apply(this, arguments);
        }
        getNext() {
          return this._next;
        }
        isInRing() {
          return null !== this._edgeRing;
        }
        setRing(t2) {
          this._edgeRing = t2;
        }
        setLabel(t2) {
          this._label = t2;
        }
        getLabel() {
          return this._label;
        }
        setNext(t2) {
          this._next = t2;
        }
        getRing() {
          return this._edgeRing;
        }
        getClass() {
          return ur;
        }
        get interfaces_() {
          return [];
        }
      }
      ur.constructor_ = function() {
        this._edgeRing = null, this._next = null, this._label = -1;
        const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3];
        bi.constructor_.call(this, t2, e2, n2, s2);
      };
      class gr extends Di {
        constructor() {
          super(), gr.constructor_.apply(this, arguments);
        }
        getLine() {
          return this._line;
        }
        getClass() {
          return gr;
        }
        get interfaces_() {
          return [];
        }
      }
      gr.constructor_ = function() {
        this._line = null;
        const t2 = arguments[0];
        this._line = t2;
      };
      class dr {
        constructor() {
          dr.constructor_.apply(this, arguments);
        }
        static findDifferentPoint(t2, e2) {
          for (let n2 = 0; n2 < t2.length; n2++) if (!t2[n2].equals(e2)) return t2[n2];
          return null;
        }
        visitInteriorRing(t2, e2) {
          const n2 = t2.getCoordinates(), s2 = n2[0], i2 = dr.findDifferentPoint(n2, s2), r2 = e2.findEdgeInSameDirection(s2, i2), o2 = e2.findEdgeEnd(r2);
          let l2 = null;
          o2.getLabel().getLocation(0, Pn.RIGHT) === ne.INTERIOR ? l2 = o2 : o2.getSym().getLabel().getLocation(0, Pn.RIGHT) === ne.INTERIOR && (l2 = o2.getSym()), u.isTrue(null !== l2, "unable to find dirEdge with Interior on RHS"), this.visitLinkedDirectedEdges(l2);
        }
        visitShellInteriors(t2, e2) {
          if (t2 instanceof bt) {
            const n2 = t2;
            this.visitInteriorRing(n2.getExteriorRing(), e2);
          }
          if (t2 instanceof At) {
            const n2 = t2;
            for (let t3 = 0; t3 < n2.getNumGeometries(); t3++) {
              const s2 = n2.getGeometryN(t3);
              this.visitInteriorRing(s2.getExteriorRing(), e2);
            }
          }
        }
        getCoordinate() {
          return this._disconnectedRingcoord;
        }
        setInteriorEdgesInResult(t2) {
          for (let e2 = t2.getEdgeEnds().iterator(); e2.hasNext(); ) {
            const t3 = e2.next();
            t3.getLabel().getLocation(0, Pn.RIGHT) === ne.INTERIOR && t3.setInResult(true);
          }
        }
        visitLinkedDirectedEdges(t2) {
          const e2 = t2;
          let n2 = t2;
          do {
            u.isTrue(null !== n2, "found null Directed Edge"), n2.setVisited(true), n2 = n2.getNext();
          } while (n2 !== e2);
        }
        buildEdgeRings(t2) {
          const e2 = new x();
          for (let n2 = t2.iterator(); n2.hasNext(); ) {
            const t3 = n2.next();
            if (t3.isInResult() && null === t3.getEdgeRing()) {
              const n3 = new ti(t3, this._geometryFactory);
              n3.linkDirectedEdgesForMinimalEdgeRings();
              const s2 = n3.buildMinimalRings();
              e2.addAll(s2);
            }
          }
          return e2;
        }
        hasUnvisitedShellEdge(t2) {
          for (let e2 = 0; e2 < t2.size(); e2++) {
            const n2 = t2.get(e2);
            if (n2.isHole()) continue;
            const s2 = n2.getEdges();
            let i2 = s2.get(0);
            if (i2.getLabel().getLocation(0, Pn.RIGHT) === ne.INTERIOR) {
              for (let t3 = 0; t3 < s2.size(); t3++) if (i2 = s2.get(t3), !i2.isVisited()) return this._disconnectedRingcoord = i2.getCoordinate(), true;
            }
          }
          return false;
        }
        isInteriorsConnected() {
          const t2 = new x();
          this._geomGraph.computeSplitEdges(t2);
          const e2 = new Zn(new ui());
          e2.addEdges(t2), this.setInteriorEdgesInResult(e2), e2.linkResultDirectedEdges();
          const n2 = this.buildEdgeRings(e2.getEdgeEnds());
          return this.visitShellInteriors(this._geomGraph.getGeometry(), e2), !this.hasUnvisitedShellEdge(n2);
        }
        getClass() {
          return dr;
        }
        get interfaces_() {
          return [];
        }
      }
      dr.constructor_ = function() {
        this._geometryFactory = new Ht(), this._geomGraph = null, this._disconnectedRingcoord = null;
        const t2 = arguments[0];
        this._geomGraph = t2;
      };
      class _r {
        constructor() {
          _r.constructor_.apply(this, arguments);
        }
        createEdgeEndForNext(t2, e2, n2, s2) {
          const i2 = n2.segmentIndex + 1;
          if (i2 >= t2.getNumPoints() && null === s2) return null;
          let r2 = t2.getCoordinate(i2);
          null !== s2 && s2.segmentIndex === n2.segmentIndex && (r2 = s2.coord);
          const o2 = new Hn(t2, n2.coord, r2, new Fn(t2.getLabel()));
          e2.add(o2);
        }
        createEdgeEndForPrev(t2, e2, n2, s2) {
          let i2 = n2.segmentIndex;
          if (0 === n2.dist) {
            if (0 === i2) return null;
            i2--;
          }
          let r2 = t2.getCoordinate(i2);
          null !== s2 && s2.segmentIndex >= i2 && (r2 = s2.coord);
          const o2 = new Fn(t2.getLabel());
          o2.flip();
          const l2 = new Hn(t2, n2.coord, r2, o2);
          e2.add(l2);
        }
        computeEdgeEnds() {
          if (1 === arguments.length) {
            const t2 = arguments[0], e2 = new x();
            for (let n2 = t2; n2.hasNext(); ) {
              const t3 = n2.next();
              this.computeEdgeEnds(t3, e2);
            }
            return e2;
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = t2.getEdgeIntersectionList();
            n2.addEndpoints();
            const s2 = n2.iterator();
            let i2 = null, r2 = null;
            if (!s2.hasNext()) return null;
            let o2 = s2.next();
            do {
              i2 = r2, r2 = o2, o2 = null, s2.hasNext() && (o2 = s2.next()), null !== r2 && (this.createEdgeEndForPrev(t2, e2, r2, i2), this.createEdgeEndForNext(t2, e2, r2, o2));
            } while (null !== r2);
          }
        }
        getClass() {
          return _r;
        }
        get interfaces_() {
          return [];
        }
      }
      _r.constructor_ = function() {
      };
      class fr extends Hn {
        constructor() {
          super(), fr.constructor_.apply(this, arguments);
        }
        insert(t2) {
          this._edgeEnds.add(t2);
        }
        print(t2) {
          t2.println("EdgeEndBundle--> Label: " + this._label);
          for (let e2 = this.iterator(); e2.hasNext(); ) {
            e2.next().print(t2), t2.println();
          }
        }
        iterator() {
          return this._edgeEnds.iterator();
        }
        getEdgeEnds() {
          return this._edgeEnds;
        }
        computeLabelOn(t2, e2) {
          let n2 = 0, s2 = false;
          for (let e3 = this.iterator(); e3.hasNext(); ) {
            const i3 = e3.next().getLabel().getLocation(t2);
            i3 === ne.BOUNDARY && n2++, i3 === ne.INTERIOR && (s2 = true);
          }
          let i2 = ne.NONE;
          s2 && (i2 = ne.INTERIOR), n2 > 0 && (i2 = Qn.determineBoundary(e2, n2)), this._label.setLocation(t2, i2);
        }
        computeLabelSide(t2, e2) {
          for (let n2 = this.iterator(); n2.hasNext(); ) {
            const s2 = n2.next();
            if (s2.getLabel().isArea()) {
              const n3 = s2.getLabel().getLocation(t2, e2);
              if (n3 === ne.INTERIOR) return this._label.setLocation(t2, e2, ne.INTERIOR), null;
              n3 === ne.EXTERIOR && this._label.setLocation(t2, e2, ne.EXTERIOR);
            }
          }
        }
        getLabel() {
          return this._label;
        }
        computeLabelSides(t2) {
          this.computeLabelSide(t2, Pn.LEFT), this.computeLabelSide(t2, Pn.RIGHT);
        }
        updateIM(t2) {
          Un.updateIM(this._label, t2);
        }
        computeLabel(t2) {
          let e2 = false;
          for (let t3 = this.iterator(); t3.hasNext(); ) {
            t3.next().getLabel().isArea() && (e2 = true);
          }
          this._label = e2 ? new Fn(ne.NONE, ne.NONE, ne.NONE) : new Fn(ne.NONE);
          for (let n2 = 0; n2 < 2; n2++) this.computeLabelOn(n2, t2), e2 && this.computeLabelSides(n2);
        }
        getClass() {
          return fr;
        }
        get interfaces_() {
          return [];
        }
      }
      fr.constructor_ = function() {
        if (this._edgeEnds = new x(), 1 === arguments.length) {
          const t2 = arguments[0];
          fr.constructor_.call(this, null, t2);
        } else if (2 === arguments.length) {
          const t2 = arguments[1];
          Hn.constructor_.call(this, t2.getEdge(), t2.getCoordinate(), t2.getDirectedCoordinate(), new Fn(t2.getLabel())), this.insert(t2);
        }
      };
      class pr extends ci {
        constructor() {
          super(), pr.constructor_.apply(this, arguments);
        }
        updateIM(t2) {
          for (let e2 = this.iterator(); e2.hasNext(); ) {
            e2.next().updateIM(t2);
          }
        }
        insert(t2) {
          let e2 = this._edgeMap.get(t2);
          null === e2 ? (e2 = new fr(t2), this.insertEdgeEnd(t2, e2)) : e2.insert(t2);
        }
        getClass() {
          return pr;
        }
        get interfaces_() {
          return [];
        }
      }
      pr.constructor_ = function() {
      };
      class mr extends kn {
        constructor() {
          super(), mr.constructor_.apply(this, arguments);
        }
        updateIMFromEdges(t2) {
          this._edges.updateIM(t2);
        }
        computeIM(t2) {
          t2.setAtLeastIfValid(this._label.getLocation(0), this._label.getLocation(1), 0);
        }
        getClass() {
          return mr;
        }
        get interfaces_() {
          return [];
        }
      }
      mr.constructor_ = function() {
        const t2 = arguments[0], e2 = arguments[1];
        kn.constructor_.call(this, t2, e2);
      };
      class yr extends Kn {
        constructor() {
          super(), yr.constructor_.apply(this, arguments);
        }
        createNode(t2) {
          return new mr(t2, new pr());
        }
        getClass() {
          return yr;
        }
        get interfaces_() {
          return [];
        }
      }
      yr.constructor_ = function() {
      };
      class xr {
        constructor() {
          xr.constructor_.apply(this, arguments);
        }
        insertEdgeEnds(t2) {
          for (let e2 = t2.iterator(); e2.hasNext(); ) {
            const t3 = e2.next();
            this._nodes.add(t3);
          }
        }
        getNodeIterator() {
          return this._nodes.iterator();
        }
        copyNodesAndLabels(t2, e2) {
          for (let n2 = t2.getNodeIterator(); n2.hasNext(); ) {
            const t3 = n2.next();
            this._nodes.addNode(t3.getCoordinate()).setLabel(e2, t3.getLabel().getLocation(e2));
          }
        }
        build(t2) {
          this.computeIntersectionNodes(t2, 0), this.copyNodesAndLabels(t2, 0);
          const e2 = new _r().computeEdgeEnds(t2.getEdgeIterator());
          this.insertEdgeEnds(e2);
        }
        computeIntersectionNodes(t2, e2) {
          for (let n2 = t2.getEdgeIterator(); n2.hasNext(); ) {
            const t3 = n2.next(), s2 = t3.getLabel().getLocation(e2);
            for (let n3 = t3.getEdgeIntersectionList().iterator(); n3.hasNext(); ) {
              const t4 = n3.next(), i2 = this._nodes.addNode(t4.coord);
              s2 === ne.BOUNDARY ? i2.setLabelBoundary(e2) : i2.getLabel().isNull(e2) && i2.setLabel(e2, ne.INTERIOR);
            }
          }
        }
        getClass() {
          return xr;
        }
        get interfaces_() {
          return [];
        }
      }
      xr.constructor_ = function() {
        this._nodes = new Xn(new yr());
      };
      class Er {
        constructor() {
          Er.constructor_.apply(this, arguments);
        }
        isNodeEdgeAreaLabelsConsistent() {
          for (let t2 = this._nodeGraph.getNodeIterator(); t2.hasNext(); ) {
            const e2 = t2.next();
            if (!e2.getEdges().isAreaLabelsConsistent(this._geomGraph)) return this._invalidPoint = e2.getCoordinate().copy(), false;
          }
          return true;
        }
        getInvalidPoint() {
          return this._invalidPoint;
        }
        hasDuplicateRings() {
          for (let t2 = this._nodeGraph.getNodeIterator(); t2.hasNext(); ) {
            for (let e2 = t2.next().getEdges().iterator(); e2.hasNext(); ) {
              const t3 = e2.next();
              if (t3.getEdgeEnds().size() > 1) return this._invalidPoint = t3.getEdge().getCoordinate(0), true;
            }
          }
          return false;
        }
        isNodeConsistentArea() {
          const t2 = this._geomGraph.computeSelfNodes(this._li, true, true);
          return t2.hasProperIntersection() ? (this._invalidPoint = t2.getProperIntersectionPoint(), false) : (this._nodeGraph.build(this._geomGraph), this.isNodeEdgeAreaLabelsConsistent());
        }
        getClass() {
          return Er;
        }
        get interfaces_() {
          return [];
        }
      }
      Er.constructor_ = function() {
        this._li = new te(), this._geomGraph = null, this._nodeGraph = new xr(), this._invalidPoint = null;
        const t2 = arguments[0];
        this._geomGraph = t2;
      };
      class Ir {
        constructor() {
          Ir.constructor_.apply(this, arguments);
        }
        buildIndex() {
          this._index = new Es();
          for (let t2 = 0; t2 < this._rings.size(); t2++) {
            const e2 = this._rings.get(t2), n2 = e2.getEnvelopeInternal();
            this._index.insert(n2, e2);
          }
        }
        getNestedPoint() {
          return this._nestedPt;
        }
        isNonNested() {
          this.buildIndex();
          for (let t2 = 0; t2 < this._rings.size(); t2++) {
            const e2 = this._rings.get(t2), n2 = e2.getCoordinates(), s2 = this._index.query(e2.getEnvelopeInternal());
            for (let t3 = 0; t3 < s2.size(); t3++) {
              const i2 = s2.get(t3), r2 = i2.getCoordinates();
              if (e2 === i2) continue;
              if (!e2.getEnvelopeInternal().intersects(i2.getEnvelopeInternal())) continue;
              const o2 = Cr.findPtNotNode(n2, i2, this._graph);
              if (null !== o2 && We.isInRing(o2, r2)) return this._nestedPt = o2, false;
            }
          }
          return true;
        }
        add(t2) {
          this._rings.add(t2), this._totalEnv.expandToInclude(t2.getEnvelopeInternal());
        }
        getClass() {
          return Ir;
        }
        get interfaces_() {
          return [];
        }
      }
      Ir.constructor_ = function() {
        this._graph = null, this._rings = new x(), this._totalEnv = new N(), this._index = null, this._nestedPt = null;
        const t2 = arguments[0];
        this._graph = t2;
      };
      class Nr {
        constructor() {
          Nr.constructor_.apply(this, arguments);
        }
        getErrorType() {
          return this._errorType;
        }
        getMessage() {
          return Nr.errMsg[this._errorType];
        }
        getCoordinate() {
          return this._pt;
        }
        toString() {
          let t2 = "";
          return null !== this._pt && (t2 = " at or near point " + this._pt), this.getMessage() + t2;
        }
        getClass() {
          return Nr;
        }
        get interfaces_() {
          return [];
        }
      }
      Nr.constructor_ = function() {
        if (this._errorType = null, this._pt = null, 1 === arguments.length) {
          const t2 = arguments[0];
          Nr.constructor_.call(this, t2, null);
        } else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          this._errorType = t2, null !== e2 && (this._pt = e2.copy());
        }
      }, Nr.ERROR = 0, Nr.REPEATED_POINT = 1, Nr.HOLE_OUTSIDE_SHELL = 2, Nr.NESTED_HOLES = 3, Nr.DISCONNECTED_INTERIOR = 4, Nr.SELF_INTERSECTION = 5, Nr.RING_SELF_INTERSECTION = 6, Nr.NESTED_SHELLS = 7, Nr.DUPLICATE_RINGS = 8, Nr.TOO_FEW_POINTS = 9, Nr.INVALID_COORDINATE = 10, Nr.RING_NOT_CLOSED = 11, Nr.errMsg = ["Topology Validation Error", "Repeated Point", "Hole lies outside shell", "Holes are nested", "Interior is disconnected", "Self-intersection", "Ring Self-intersection", "Nested shells", "Duplicate Rings", "Too few distinct points in geometry component", "Invalid Coordinate", "Ring is not closed"];
      class Cr {
        constructor() {
          Cr.constructor_.apply(this, arguments);
        }
        static findPtNotNode(t2, e2, n2) {
          const s2 = n2.findEdge(e2).getEdgeIntersectionList();
          for (let e3 = 0; e3 < t2.length; e3++) {
            const n3 = t2[e3];
            if (!s2.isIntersection(n3)) return n3;
          }
          return null;
        }
        static isValid() {
          if (arguments[0] instanceof q) {
            const t2 = arguments[0];
            return new Cr(t2).isValid();
          }
          if (arguments[0] instanceof g) {
            const t2 = arguments[0];
            return !i.isNaN(t2.x) && (!i.isInfinite(t2.x) && (!i.isNaN(t2.y) && !i.isInfinite(t2.y)));
          }
        }
        checkInvalidCoordinates() {
          if (arguments[0] instanceof Array) {
            const t2 = arguments[0];
            for (let e2 = 0; e2 < t2.length; e2++) if (!Cr.isValid(t2[e2])) return this._validErr = new Nr(Nr.INVALID_COORDINATE, t2[e2]), null;
          } else if (arguments[0] instanceof bt) {
            const t2 = arguments[0];
            if (this.checkInvalidCoordinates(t2.getExteriorRing().getCoordinates()), null !== this._validErr) return null;
            for (let e2 = 0; e2 < t2.getNumInteriorRing(); e2++) if (this.checkInvalidCoordinates(t2.getInteriorRingN(e2).getCoordinates()), null !== this._validErr) return null;
          }
        }
        checkHolesNotNested(t2, e2) {
          const n2 = new Ir(e2);
          for (let e3 = 0; e3 < t2.getNumInteriorRing(); e3++) {
            const s2 = t2.getInteriorRingN(e3);
            n2.add(s2);
          }
          n2.isNonNested() || (this._validErr = new Nr(Nr.NESTED_HOLES, n2.getNestedPoint()));
        }
        checkConsistentArea(t2) {
          const e2 = new Er(t2);
          if (!e2.isNodeConsistentArea()) return this._validErr = new Nr(Nr.SELF_INTERSECTION, e2.getInvalidPoint()), null;
          e2.hasDuplicateRings() && (this._validErr = new Nr(Nr.DUPLICATE_RINGS, e2.getInvalidPoint()));
        }
        isValid() {
          return this.checkValid(this._parentGeometry), null === this._validErr;
        }
        checkShellInsideHole(t2, e2, n2) {
          const s2 = t2.getCoordinates(), i2 = e2.getCoordinates(), r2 = Cr.findPtNotNode(s2, e2, n2);
          if (null !== r2) {
            if (!We.isInRing(r2, i2)) return r2;
          }
          const o2 = Cr.findPtNotNode(i2, t2, n2);
          if (null !== o2) {
            return We.isInRing(o2, s2) ? o2 : null;
          }
          return u.shouldNeverReachHere("points in shell and hole appear to be equal"), null;
        }
        checkNoSelfIntersectingRings(t2) {
          for (let e2 = t2.getEdgeIterator(); e2.hasNext(); ) {
            const t3 = e2.next();
            if (this.checkNoSelfIntersectingRing(t3.getEdgeIntersectionList()), null !== this._validErr) return null;
          }
        }
        checkConnectedInteriors(t2) {
          const e2 = new dr(t2);
          e2.isInteriorsConnected() || (this._validErr = new Nr(Nr.DISCONNECTED_INTERIOR, e2.getCoordinate()));
        }
        checkNoSelfIntersectingRing(t2) {
          const e2 = new at();
          let n2 = true;
          for (let s2 = t2.iterator(); s2.hasNext(); ) {
            const t3 = s2.next();
            if (n2) n2 = false;
            else {
              if (e2.contains(t3.coord)) return this._validErr = new Nr(Nr.RING_SELF_INTERSECTION, t3.coord), null;
              e2.add(t3.coord);
            }
          }
        }
        checkHolesInShell(t2, e2) {
          const n2 = t2.getExteriorRing(), s2 = new ke(n2);
          for (let i2 = 0; i2 < t2.getNumInteriorRing(); i2++) {
            const r2 = t2.getInteriorRingN(i2), o2 = Cr.findPtNotNode(r2.getCoordinates(), n2, e2);
            if (null === o2) return null;
            if (ne.EXTERIOR === s2.locate(o2)) return this._validErr = new Nr(Nr.HOLE_OUTSIDE_SHELL, o2), null;
          }
        }
        checkTooFewPoints(t2) {
          if (t2.hasTooFewPoints()) return this._validErr = new Nr(Nr.TOO_FEW_POINTS, t2.getInvalidPoint()), null;
        }
        getValidationError() {
          return this.checkValid(this._parentGeometry), this._validErr;
        }
        checkValid() {
          if (arguments[0] instanceof Pt) {
            const t2 = arguments[0];
            this.checkInvalidCoordinates(t2.getCoordinates());
          } else if (arguments[0] instanceof Mt) {
            const t2 = arguments[0];
            this.checkInvalidCoordinates(t2.getCoordinates());
          } else if (arguments[0] instanceof Dt) {
            const t2 = arguments[0];
            if (this.checkInvalidCoordinates(t2.getCoordinates()), null !== this._validErr) return null;
            if (this.checkClosedRing(t2), null !== this._validErr) return null;
            const e2 = new Qn(0, t2);
            if (this.checkTooFewPoints(e2), null !== this._validErr) return null;
            const n2 = new te();
            e2.computeSelfNodes(n2, true, true), this.checkNoSelfIntersectingRings(e2);
          } else if (arguments[0] instanceof Tt) {
            const t2 = arguments[0];
            if (this.checkInvalidCoordinates(t2.getCoordinates()), null !== this._validErr) return null;
            const e2 = new Qn(0, t2);
            this.checkTooFewPoints(e2);
          } else if (arguments[0] instanceof bt) {
            const t2 = arguments[0];
            if (this.checkInvalidCoordinates(t2), null !== this._validErr) return null;
            if (this.checkClosedRings(t2), null !== this._validErr) return null;
            const e2 = new Qn(0, t2);
            if (this.checkTooFewPoints(e2), null !== this._validErr) return null;
            if (this.checkConsistentArea(e2), null !== this._validErr) return null;
            if (!this._isSelfTouchingRingFormingHoleValid && (this.checkNoSelfIntersectingRings(e2), null !== this._validErr)) return null;
            if (this.checkHolesInShell(t2, e2), null !== this._validErr) return null;
            if (this.checkHolesNotNested(t2, e2), null !== this._validErr) return null;
            this.checkConnectedInteriors(e2);
          } else if (arguments[0] instanceof At) {
            const t2 = arguments[0];
            for (let e3 = 0; e3 < t2.getNumGeometries(); e3++) {
              const n2 = t2.getGeometryN(e3);
              if (this.checkInvalidCoordinates(n2), null !== this._validErr) return null;
              if (this.checkClosedRings(n2), null !== this._validErr) return null;
            }
            const e2 = new Qn(0, t2);
            if (this.checkTooFewPoints(e2), null !== this._validErr) return null;
            if (this.checkConsistentArea(e2), null !== this._validErr) return null;
            if (!this._isSelfTouchingRingFormingHoleValid && (this.checkNoSelfIntersectingRings(e2), null !== this._validErr)) return null;
            for (let n2 = 0; n2 < t2.getNumGeometries(); n2++) {
              const s2 = t2.getGeometryN(n2);
              if (this.checkHolesInShell(s2, e2), null !== this._validErr) return null;
            }
            for (let n2 = 0; n2 < t2.getNumGeometries(); n2++) {
              const s2 = t2.getGeometryN(n2);
              if (this.checkHolesNotNested(s2, e2), null !== this._validErr) return null;
            }
            if (this.checkShellsNotNested(t2, e2), null !== this._validErr) return null;
            this.checkConnectedInteriors(e2);
          } else if (arguments[0] instanceof _t) {
            const t2 = arguments[0];
            for (let e2 = 0; e2 < t2.getNumGeometries(); e2++) {
              const n2 = t2.getGeometryN(e2);
              if (this.checkValid(n2), null !== this._validErr) return null;
            }
          } else if (arguments[0] instanceof q) {
            const t2 = arguments[0];
            if (this._validErr = null, t2.isEmpty()) return null;
            if (t2 instanceof Pt) this.checkValid(t2);
            else if (t2 instanceof Mt) this.checkValid(t2);
            else if (t2 instanceof Dt) this.checkValid(t2);
            else if (t2 instanceof Tt) this.checkValid(t2);
            else if (t2 instanceof bt) this.checkValid(t2);
            else if (t2 instanceof At) this.checkValid(t2);
            else {
              if (!(t2 instanceof _t)) throw new Z(t2.getClass().getName());
              this.checkValid(t2);
            }
          }
        }
        setSelfTouchingRingFormingHoleValid(t2) {
          this._isSelfTouchingRingFormingHoleValid = t2;
        }
        checkShellNotNested(t2, e2, n2) {
          const s2 = t2.getCoordinates(), i2 = e2.getExteriorRing(), r2 = i2.getCoordinates(), o2 = Cr.findPtNotNode(s2, i2, n2);
          if (null === o2) return null;
          if (!We.isInRing(o2, r2)) return null;
          if (e2.getNumInteriorRing() <= 0) return this._validErr = new Nr(Nr.NESTED_SHELLS, o2), null;
          let l2 = null;
          for (let s3 = 0; s3 < e2.getNumInteriorRing(); s3++) {
            const i3 = e2.getInteriorRingN(s3);
            if (l2 = this.checkShellInsideHole(t2, i3, n2), null === l2) return null;
          }
          this._validErr = new Nr(Nr.NESTED_SHELLS, l2);
        }
        checkClosedRings(t2) {
          if (this.checkClosedRing(t2.getExteriorRing()), null !== this._validErr) return null;
          for (let e2 = 0; e2 < t2.getNumInteriorRing(); e2++) if (this.checkClosedRing(t2.getInteriorRingN(e2)), null !== this._validErr) return null;
        }
        checkClosedRing(t2) {
          if (!t2.isClosed()) {
            let e2 = null;
            t2.getNumPoints() >= 1 && (e2 = t2.getCoordinateN(0)), this._validErr = new Nr(Nr.RING_NOT_CLOSED, e2);
          }
        }
        checkShellsNotNested(t2, e2) {
          for (let n2 = 0; n2 < t2.getNumGeometries(); n2++) {
            const s2 = t2.getGeometryN(n2).getExteriorRing();
            for (let i2 = 0; i2 < t2.getNumGeometries(); i2++) {
              if (n2 === i2) continue;
              const r2 = t2.getGeometryN(i2);
              if (this.checkShellNotNested(s2, r2, e2), null !== this._validErr) return null;
            }
          }
        }
        getClass() {
          return Cr;
        }
        get interfaces_() {
          return [];
        }
      }
      Cr.constructor_ = function() {
        this._parentGeometry = null, this._isSelfTouchingRingFormingHoleValid = false, this._validErr = null;
        const t2 = arguments[0];
        this._parentGeometry = t2;
      };
      class Sr {
        constructor() {
          Sr.constructor_.apply(this, arguments);
        }
        static findDirEdgesInRing(t2) {
          let e2 = t2;
          const n2 = new x();
          do {
            n2.add(e2), e2 = e2.getNext(), u.isTrue(null !== e2, "found null DE in ring"), u.isTrue(e2 === t2 || !e2.isInRing(), "found DE already in ring");
          } while (e2 !== t2);
          return n2;
        }
        static addEdge(t2, e2, n2) {
          if (e2) for (let e3 = 0; e3 < t2.length; e3++) n2.add(t2[e3], false);
          else for (let e3 = t2.length - 1; e3 >= 0; e3--) n2.add(t2[e3], false);
        }
        static findEdgeRingContaining(t2, e2) {
          const n2 = t2.getRing(), s2 = n2.getEnvelopeInternal();
          let i2 = n2.getCoordinateN(0), r2 = null, o2 = null;
          for (let t3 = e2.iterator(); t3.hasNext(); ) {
            const e3 = t3.next(), l2 = e3.getRing(), a2 = l2.getEnvelopeInternal();
            if (a2.equals(s2)) continue;
            if (!a2.contains(s2)) continue;
            i2 = X.ptNotInList(n2.getCoordinates(), l2.getCoordinates());
            let c2 = false;
            We.isInRing(i2, l2.getCoordinates()) && (c2 = true), c2 && (null === r2 || o2.contains(a2)) && (r2 = e3, o2 = r2.getRing().getEnvelopeInternal());
          }
          return r2;
        }
        isIncluded() {
          return this._isIncluded;
        }
        getCoordinates() {
          if (null === this._ringPts) {
            const t2 = new I();
            for (let e2 = this._deList.iterator(); e2.hasNext(); ) {
              const n2 = e2.next(), s2 = n2.getEdge();
              Sr.addEdge(s2.getLine().getCoordinates(), n2.getEdgeDirection(), t2);
            }
            this._ringPts = t2.toCoordinateArray();
          }
          return this._ringPts;
        }
        isIncludedSet() {
          return this._isIncludedSet;
        }
        isValid() {
          return this.getCoordinates(), !(this._ringPts.length <= 3) && (this.getRing(), Cr.isValid(this._ring));
        }
        build(t2) {
          let e2 = t2;
          do {
            this.add(e2), e2.setRing(this), e2 = e2.getNext(), u.isTrue(null !== e2, "found null DE in ring"), u.isTrue(e2 === t2 || !e2.isInRing(), "found DE already in ring");
          } while (e2 !== t2);
        }
        isOuterHole() {
          return !!this._isHole && !this.hasShell();
        }
        getPolygon() {
          let t2 = null;
          if (null !== this._holes) {
            t2 = new Array(this._holes.size()).fill(null);
            for (let e2 = 0; e2 < this._holes.size(); e2++) t2[e2] = this._holes.get(e2);
          }
          return this._factory.createPolygon(this._ring, t2);
        }
        isHole() {
          return this._isHole;
        }
        isProcessed() {
          return this._isProcessed;
        }
        addHole() {
          if (arguments[0] instanceof Dt) {
            const t2 = arguments[0];
            null === this._holes && (this._holes = new x()), this._holes.add(t2);
          } else if (arguments[0] instanceof Sr) {
            const t2 = arguments[0];
            t2.setShell(this);
            const e2 = t2.getRing();
            null === this._holes && (this._holes = new x()), this._holes.add(e2);
          }
        }
        setIncluded(t2) {
          this._isIncluded = t2, this._isIncludedSet = true;
        }
        getOuterHole() {
          if (this.isHole()) return null;
          for (let t2 = 0; t2 < this._deList.size(); t2++) {
            const e2 = this._deList.get(t2).getSym().getRing();
            if (e2.isOuterHole()) return e2;
          }
          return null;
        }
        computeHole() {
          const t2 = this.getRing();
          this._isHole = v.isCCW(t2.getCoordinates());
        }
        hasShell() {
          return null !== this._shell;
        }
        isOuterShell() {
          return null !== this.getOuterHole();
        }
        getLineString() {
          return this.getCoordinates(), this._factory.createLineString(this._ringPts);
        }
        toString() {
          return Jt.toLineString(new zt(this.getCoordinates()));
        }
        getShell() {
          return this.isHole() ? this._shell : this;
        }
        add(t2) {
          this._deList.add(t2);
        }
        getRing() {
          if (null !== this._ring) return this._ring;
          this.getCoordinates(), this._ringPts.length < 3 && O.out.println(this._ringPts);
          try {
            this._ring = this._factory.createLinearRing(this._ringPts);
          } catch (t2) {
            if (!(t2 instanceof C)) throw t2;
            O.out.println(this._ringPts);
          }
          return this._ring;
        }
        updateIncluded() {
          if (this.isHole()) return null;
          for (let t2 = 0; t2 < this._deList.size(); t2++) {
            const e2 = this._deList.get(t2).getSym().getRing().getShell();
            if (null !== e2 && e2.isIncludedSet()) return this.setIncluded(!e2.isIncluded()), null;
          }
        }
        setShell(t2) {
          this._shell = t2;
        }
        setProcessed(t2) {
          this._isProcessed = t2;
        }
        getClass() {
          return Sr;
        }
        get interfaces_() {
          return [];
        }
      }
      class wr {
        constructor() {
          wr.constructor_.apply(this, arguments);
        }
        compare(t2, e2) {
          const n2 = e2;
          return t2.getRing().getEnvelope().compareTo(n2.getRing().getEnvelope());
        }
        getClass() {
          return wr;
        }
        get interfaces_() {
          return [l];
        }
      }
      wr.constructor_ = function() {
      }, Sr.EnvelopeComparator = wr, Sr.constructor_ = function() {
        this._factory = null, this._deList = new x(), this._lowestEdge = null, this._ring = null, this._ringPts = null, this._holes = null, this._shell = null, this._isHole = null, this._isProcessed = false, this._isIncludedSet = false, this._isIncluded = false;
        const t2 = arguments[0];
        this._factory = t2;
      };
      class Lr extends Bi {
        constructor() {
          super(), Lr.constructor_.apply(this, arguments);
        }
        static findLabeledEdgeRings(t2) {
          const e2 = new x();
          let n2 = 1;
          for (let s2 = t2.iterator(); s2.hasNext(); ) {
            const t3 = s2.next();
            if (t3.isMarked()) continue;
            if (t3.getLabel() >= 0) continue;
            e2.add(t3);
            const i2 = Sr.findDirEdgesInRing(t3);
            Lr.label(i2, n2), n2++;
          }
          return e2;
        }
        static getDegreeNonDeleted(t2) {
          let e2 = 0;
          for (let n2 = t2.getOutEdges().getEdges().iterator(); n2.hasNext(); ) {
            n2.next().isMarked() || e2++;
          }
          return e2;
        }
        static deleteAllEdges(t2) {
          for (let e2 = t2.getOutEdges().getEdges().iterator(); e2.hasNext(); ) {
            const t3 = e2.next();
            t3.setMarked(true);
            const n2 = t3.getSym();
            null !== n2 && n2.setMarked(true);
          }
        }
        static label(t2, e2) {
          for (let n2 = t2.iterator(); n2.hasNext(); ) {
            n2.next().setLabel(e2);
          }
        }
        static computeNextCWEdges(t2) {
          let e2 = null, n2 = null;
          for (let s2 = t2.getOutEdges().getEdges().iterator(); s2.hasNext(); ) {
            const t3 = s2.next();
            if (!t3.isMarked()) {
              if (null === e2 && (e2 = t3), null !== n2) {
                n2.getSym().setNext(t3);
              }
              n2 = t3;
            }
          }
          if (null !== n2) {
            n2.getSym().setNext(e2);
          }
        }
        static computeNextCCWEdges(t2, e2) {
          let n2 = null, s2 = null;
          const i2 = t2.getOutEdges().getEdges();
          for (let t3 = i2.size() - 1; t3 >= 0; t3--) {
            const r2 = i2.get(t3), o2 = r2.getSym();
            let l2 = null;
            r2.getLabel() === e2 && (l2 = r2);
            let a2 = null;
            o2.getLabel() === e2 && (a2 = o2), null === l2 && null === a2 || (null !== a2 && (s2 = a2), null !== l2 && (null !== s2 && (s2.setNext(l2), s2 = null), null === n2 && (n2 = l2)));
          }
          null !== s2 && (u.isTrue(null !== n2), s2.setNext(n2));
        }
        static getDegree(t2, e2) {
          let n2 = 0;
          for (let s2 = t2.getOutEdges().getEdges().iterator(); s2.hasNext(); ) {
            s2.next().getLabel() === e2 && n2++;
          }
          return n2;
        }
        static findIntersectionNodes(t2, e2) {
          let n2 = t2, s2 = null;
          do {
            const i2 = n2.getFromNode();
            Lr.getDegree(i2, e2) > 1 && (null === s2 && (s2 = new x()), s2.add(i2)), n2 = n2.getNext(), u.isTrue(null !== n2, "found null DE in ring"), u.isTrue(n2 === t2 || !n2.isInRing(), "found DE already in ring");
          } while (n2 !== t2);
          return s2;
        }
        findEdgeRing(t2) {
          const e2 = new Sr(this._factory);
          return e2.build(t2), e2;
        }
        computeDepthParity() {
          if (0 === arguments.length) for (; ; ) return null;
        }
        computeNextCWEdges() {
          for (let t2 = this.nodeIterator(); t2.hasNext(); ) {
            const e2 = t2.next();
            Lr.computeNextCWEdges(e2);
          }
        }
        addEdge(t2) {
          if (t2.isEmpty()) return null;
          const e2 = X.removeRepeatedPoints(t2.getCoordinates());
          if (e2.length < 2) return null;
          const n2 = e2[0], s2 = e2[e2.length - 1], i2 = this.getNode(n2), r2 = this.getNode(s2), o2 = new ur(i2, r2, e2[1], true), l2 = new ur(r2, i2, e2[e2.length - 2], false), a2 = new gr(t2);
          a2.setDirectedEdges(o2, l2), this.add(a2);
        }
        deleteCutEdges() {
          this.computeNextCWEdges(), Lr.findLabeledEdgeRings(this._dirEdges);
          const t2 = new x();
          for (let e2 = this._dirEdges.iterator(); e2.hasNext(); ) {
            const n2 = e2.next();
            if (n2.isMarked()) continue;
            const s2 = n2.getSym();
            if (n2.getLabel() === s2.getLabel()) {
              n2.setMarked(true), s2.setMarked(true);
              const e3 = n2.getEdge();
              t2.add(e3.getLine());
            }
          }
          return t2;
        }
        getEdgeRings() {
          this.computeNextCWEdges(), Lr.label(this._dirEdges, -1);
          const t2 = Lr.findLabeledEdgeRings(this._dirEdges);
          this.convertMaximalToMinimalEdgeRings(t2);
          const e2 = new x();
          for (let t3 = this._dirEdges.iterator(); t3.hasNext(); ) {
            const n2 = t3.next();
            if (n2.isMarked()) continue;
            if (n2.isInRing()) continue;
            const s2 = this.findEdgeRing(n2);
            e2.add(s2);
          }
          return e2;
        }
        getNode(t2) {
          let e2 = this.findNode(t2);
          return null === e2 && (e2 = new Fi(t2), this.add(e2)), e2;
        }
        convertMaximalToMinimalEdgeRings(t2) {
          for (let e2 = t2.iterator(); e2.hasNext(); ) {
            const t3 = e2.next(), n2 = t3.getLabel(), s2 = Lr.findIntersectionNodes(t3, n2);
            if (null !== s2) for (let t4 = s2.iterator(); t4.hasNext(); ) {
              const e3 = t4.next();
              Lr.computeNextCCWEdges(e3, n2);
            }
          }
        }
        deleteDangles() {
          const t2 = this.findNodesOfDegree(1), e2 = new J(), n2 = new on();
          for (let e3 = t2.iterator(); e3.hasNext(); ) n2.push(e3.next());
          for (; !n2.isEmpty(); ) {
            const t3 = n2.pop();
            Lr.deleteAllEdges(t3);
            for (let s2 = t3.getOutEdges().getEdges().iterator(); s2.hasNext(); ) {
              const t4 = s2.next();
              t4.setMarked(true);
              const i2 = t4.getSym();
              null !== i2 && i2.setMarked(true);
              const r2 = t4.getEdge();
              e2.add(r2.getLine());
              const o2 = t4.getToNode();
              1 === Lr.getDegreeNonDeleted(o2) && n2.push(o2);
            }
          }
          return e2;
        }
        getClass() {
          return Lr;
        }
        get interfaces_() {
          return [];
        }
      }
      Lr.constructor_ = function() {
        this._factory = null;
        const t2 = arguments[0];
        this._factory = t2;
      };
      class Tr {
        constructor() {
          Tr.constructor_.apply(this, arguments);
        }
        static findOuterShells(t2) {
          for (let e2 = t2.iterator(); e2.hasNext(); ) {
            const t3 = e2.next(), n2 = t3.getOuterHole();
            null === n2 || n2.isProcessed() || (t3.setIncluded(true), n2.setProcessed(true));
          }
        }
        static extractPolygons(t2, e2) {
          const n2 = new x();
          for (let s2 = t2.iterator(); s2.hasNext(); ) {
            const t3 = s2.next();
            (e2 || t3.isIncluded()) && n2.add(t3.getPolygon());
          }
          return n2;
        }
        static assignHolesToShells(t2, e2) {
          for (let n2 = t2.iterator(); n2.hasNext(); ) {
            const t3 = n2.next();
            Tr.assignHoleToShell(t3, e2);
          }
        }
        static assignHoleToShell(t2, e2) {
          const n2 = Sr.findEdgeRingContaining(t2, e2);
          null !== n2 && n2.addHole(t2);
        }
        static findDisjointShells(t2) {
          Tr.findOuterShells(t2);
          let e2 = null;
          do {
            e2 = false;
            for (let n2 = t2.iterator(); n2.hasNext(); ) {
              const t3 = n2.next();
              t3.isIncludedSet() || (t3.updateIncluded(), t3.isIncludedSet() || (e2 = true));
            }
          } while (e2);
        }
        getGeometry() {
          return null === this._geomFactory && (this._geomFactory = new Ht()), this.polygonize(), this._extractOnlyPolygonal ? this._geomFactory.buildGeometry(this._polyList) : this._geomFactory.createGeometryCollection(Ht.toGeometryArray(this._polyList));
        }
        getInvalidRingLines() {
          return this.polygonize(), this._invalidRingLines;
        }
        findValidRings(t2, e2, n2) {
          for (let s2 = t2.iterator(); s2.hasNext(); ) {
            const t3 = s2.next();
            t3.isValid() ? e2.add(t3) : n2.add(t3.getLineString());
          }
        }
        polygonize() {
          if (null !== this._polyList) return null;
          if (this._polyList = new x(), null === this._graph) return null;
          this._dangles = this._graph.deleteDangles(), this._cutEdges = this._graph.deleteCutEdges();
          const t2 = this._graph.getEdgeRings();
          let e2 = new x();
          this._invalidRingLines = new x(), this._isCheckingRingsValid ? this.findValidRings(t2, e2, this._invalidRingLines) : e2 = t2, this.findShellsAndHoles(e2), Tr.assignHolesToShells(this._holeList, this._shellList), Ee.sort(this._shellList, new Sr.EnvelopeComparator());
          let n2 = true;
          this._extractOnlyPolygonal && (Tr.findDisjointShells(this._shellList), n2 = false), this._polyList = Tr.extractPolygons(this._shellList, n2);
        }
        getDangles() {
          return this.polygonize(), this._dangles;
        }
        getCutEdges() {
          return this.polygonize(), this._cutEdges;
        }
        getPolygons() {
          return this.polygonize(), this._polyList;
        }
        add() {
          if (_(arguments[0], f)) {
            for (let t2 = arguments[0].iterator(); t2.hasNext(); ) {
              const e2 = t2.next();
              this.add(e2);
            }
          } else if (arguments[0] instanceof Tt) {
            const t2 = arguments[0];
            this._geomFactory = t2.getFactory(), null === this._graph && (this._graph = new Lr(this._geomFactory)), this._graph.addEdge(t2);
          } else if (arguments[0] instanceof q) {
            arguments[0].apply(this._lineStringAdder);
          }
        }
        setCheckRingsValid(t2) {
          this._isCheckingRingsValid = t2;
        }
        findShellsAndHoles(t2) {
          this._holeList = new x(), this._shellList = new x();
          for (let e2 = t2.iterator(); e2.hasNext(); ) {
            const t3 = e2.next();
            t3.computeHole(), t3.isHole() ? this._holeList.add(t3) : this._shellList.add(t3);
          }
        }
        getClass() {
          return Tr;
        }
        get interfaces_() {
          return [];
        }
      }
      class Rr {
        constructor() {
          Rr.constructor_.apply(this, arguments);
        }
        filter(t2) {
          t2 instanceof Tt && this.p.add(t2);
        }
        getClass() {
          return Rr;
        }
        get interfaces_() {
          return [G];
        }
      }
      Rr.constructor_ = function() {
        this.p = null;
        const t2 = arguments[0];
        this.p = t2;
      }, Tr.LineStringAdder = Rr, Tr.constructor_ = function() {
        if (this._lineStringAdder = new Rr(this), this._graph = null, this._dangles = new x(), this._cutEdges = new x(), this._invalidRingLines = new x(), this._holeList = null, this._shellList = null, this._polyList = null, this._isCheckingRingsValid = true, this._extractOnlyPolygonal = null, this._geomFactory = null, 0 === arguments.length) Tr.constructor_.call(this, false);
        else if (1 === arguments.length) {
          const t2 = arguments[0];
          this._extractOnlyPolygonal = t2;
        }
      };
      var Pr = Object.freeze({ __proto__: null, Polygonizer: Tr });
      class vr {
        constructor() {
          vr.constructor_.apply(this, arguments);
        }
        insertEdgeEnds(t2) {
          for (let e2 = t2.iterator(); e2.hasNext(); ) {
            const t3 = e2.next();
            this._nodes.add(t3);
          }
        }
        computeProperIntersectionIM(t2, e2) {
          const n2 = this._arg[0].getGeometry().getDimension(), s2 = this._arg[1].getGeometry().getDimension(), i2 = t2.hasProperIntersection(), r2 = t2.hasProperInteriorIntersection();
          2 === n2 && 2 === s2 ? i2 && e2.setAtLeast("212101212") : 2 === n2 && 1 === s2 ? (i2 && e2.setAtLeast("FFF0FFFF2"), r2 && e2.setAtLeast("1FFFFF1FF")) : 1 === n2 && 2 === s2 ? (i2 && e2.setAtLeast("F0FFFFFF2"), r2 && e2.setAtLeast("1F1FFFFFF")) : 1 === n2 && 1 === s2 && r2 && e2.setAtLeast("0FFFFFFFF");
        }
        labelIsolatedEdges(t2, e2) {
          for (let n2 = this._arg[t2].getEdgeIterator(); n2.hasNext(); ) {
            const t3 = n2.next();
            t3.isIsolated() && (this.labelIsolatedEdge(t3, e2, this._arg[e2].getGeometry()), this._isolatedEdges.add(t3));
          }
        }
        labelIsolatedEdge(t2, e2, n2) {
          if (n2.getDimension() > 0) {
            const s2 = this._ptLocator.locate(t2.getCoordinate(), n2);
            t2.getLabel().setAllLocations(e2, s2);
          } else t2.getLabel().setAllLocations(e2, ne.EXTERIOR);
        }
        computeIM() {
          const t2 = new se();
          if (t2.set(ne.EXTERIOR, ne.EXTERIOR, 2), !this._arg[0].getGeometry().getEnvelopeInternal().intersects(this._arg[1].getGeometry().getEnvelopeInternal())) return this.computeDisjointIM(t2), t2;
          this._arg[0].computeSelfNodes(this._li, false), this._arg[1].computeSelfNodes(this._li, false);
          const e2 = this._arg[0].computeEdgeIntersections(this._arg[1], this._li, false);
          this.computeIntersectionNodes(0), this.computeIntersectionNodes(1), this.copyNodesAndLabels(0), this.copyNodesAndLabels(1), this.labelIsolatedNodes(), this.computeProperIntersectionIM(e2, t2);
          const n2 = new _r(), s2 = n2.computeEdgeEnds(this._arg[0].getEdgeIterator());
          this.insertEdgeEnds(s2);
          const i2 = n2.computeEdgeEnds(this._arg[1].getEdgeIterator());
          return this.insertEdgeEnds(i2), this.labelNodeEdges(), this.labelIsolatedEdges(0, 1), this.labelIsolatedEdges(1, 0), this.updateIM(t2), t2;
        }
        labelNodeEdges() {
          for (let t2 = this._nodes.iterator(); t2.hasNext(); ) {
            t2.next().getEdges().computeLabelling(this._arg);
          }
        }
        copyNodesAndLabels(t2) {
          for (let e2 = this._arg[t2].getNodeIterator(); e2.hasNext(); ) {
            const n2 = e2.next();
            this._nodes.addNode(n2.getCoordinate()).setLabel(t2, n2.getLabel().getLocation(t2));
          }
        }
        labelIntersectionNodes(t2) {
          for (let e2 = this._arg[t2].getEdgeIterator(); e2.hasNext(); ) {
            const n2 = e2.next(), s2 = n2.getLabel().getLocation(t2);
            for (let e3 = n2.getEdgeIntersectionList().iterator(); e3.hasNext(); ) {
              const n3 = e3.next(), i2 = this._nodes.find(n3.coord);
              i2.getLabel().isNull(t2) && (s2 === ne.BOUNDARY ? i2.setLabelBoundary(t2) : i2.setLabel(t2, ne.INTERIOR));
            }
          }
        }
        labelIsolatedNode(t2, e2) {
          const n2 = this._ptLocator.locate(t2.getCoordinate(), this._arg[e2].getGeometry());
          t2.getLabel().setAllLocations(e2, n2);
        }
        computeIntersectionNodes(t2) {
          for (let e2 = this._arg[t2].getEdgeIterator(); e2.hasNext(); ) {
            const n2 = e2.next(), s2 = n2.getLabel().getLocation(t2);
            for (let e3 = n2.getEdgeIntersectionList().iterator(); e3.hasNext(); ) {
              const n3 = e3.next(), i2 = this._nodes.addNode(n3.coord);
              s2 === ne.BOUNDARY ? i2.setLabelBoundary(t2) : i2.getLabel().isNull(t2) && i2.setLabel(t2, ne.INTERIOR);
            }
          }
        }
        labelIsolatedNodes() {
          for (let t2 = this._nodes.iterator(); t2.hasNext(); ) {
            const e2 = t2.next(), n2 = e2.getLabel();
            u.isTrue(n2.getGeometryCount() > 0, "node with empty label found"), e2.isIsolated() && (n2.isNull(0) ? this.labelIsolatedNode(e2, 0) : this.labelIsolatedNode(e2, 1));
          }
        }
        updateIM(t2) {
          for (let e2 = this._isolatedEdges.iterator(); e2.hasNext(); ) {
            e2.next().updateIM(t2);
          }
          for (let e2 = this._nodes.iterator(); e2.hasNext(); ) {
            const n2 = e2.next();
            n2.updateIM(t2), n2.updateIMFromEdges(t2);
          }
        }
        computeDisjointIM(t2) {
          const e2 = this._arg[0].getGeometry();
          e2.isEmpty() || (t2.set(ne.INTERIOR, ne.EXTERIOR, e2.getDimension()), t2.set(ne.BOUNDARY, ne.EXTERIOR, e2.getBoundaryDimension()));
          const n2 = this._arg[1].getGeometry();
          n2.isEmpty() || (t2.set(ne.EXTERIOR, ne.INTERIOR, n2.getDimension()), t2.set(ne.EXTERIOR, ne.BOUNDARY, n2.getBoundaryDimension()));
        }
        getClass() {
          return vr;
        }
        get interfaces_() {
          return [];
        }
      }
      vr.constructor_ = function() {
        this._li = new te(), this._ptLocator = new _n(), this._arg = null, this._nodes = new Xn(new yr()), this._im = null, this._isolatedEdges = new x(), this._invalidPoint = null;
        const t2 = arguments[0];
        this._arg = t2;
      };
      class Or {
        constructor() {
          Or.constructor_.apply(this, arguments);
        }
        static contains(t2, e2) {
          return new Or(t2).contains(e2);
        }
        isContainedInBoundary(t2) {
          if (t2 instanceof bt) return false;
          if (t2 instanceof Pt) return this.isPointContainedInBoundary(t2);
          if (t2 instanceof Tt) return this.isLineStringContainedInBoundary(t2);
          for (let e2 = 0; e2 < t2.getNumGeometries(); e2++) {
            const n2 = t2.getGeometryN(e2);
            if (!this.isContainedInBoundary(n2)) return false;
          }
          return true;
        }
        isLineSegmentContainedInBoundary(t2, e2) {
          if (t2.equals(e2)) return this.isPointContainedInBoundary(t2);
          if (t2.x === e2.x) {
            if (t2.x === this._rectEnv.getMinX() || t2.x === this._rectEnv.getMaxX()) return true;
          } else if (t2.y === e2.y && (t2.y === this._rectEnv.getMinY() || t2.y === this._rectEnv.getMaxY())) return true;
          return false;
        }
        isLineStringContainedInBoundary(t2) {
          const e2 = t2.getCoordinateSequence(), n2 = new g(), s2 = new g();
          for (let t3 = 0; t3 < e2.size() - 1; t3++) if (e2.getCoordinate(t3, n2), e2.getCoordinate(t3 + 1, s2), !this.isLineSegmentContainedInBoundary(n2, s2)) return false;
          return true;
        }
        isPointContainedInBoundary() {
          if (arguments[0] instanceof Pt) {
            const t2 = arguments[0];
            return this.isPointContainedInBoundary(t2.getCoordinate());
          }
          if (arguments[0] instanceof g) {
            const t2 = arguments[0];
            return t2.x === this._rectEnv.getMinX() || t2.x === this._rectEnv.getMaxX() || t2.y === this._rectEnv.getMinY() || t2.y === this._rectEnv.getMaxY();
          }
        }
        contains(t2) {
          return !!this._rectEnv.contains(t2.getEnvelopeInternal()) && !this.isContainedInBoundary(t2);
        }
        getClass() {
          return Or;
        }
        get interfaces_() {
          return [];
        }
      }
      Or.constructor_ = function() {
        this._rectEnv = null;
        const t2 = arguments[0];
        this._rectEnv = t2.getEnvelopeInternal();
      };
      class br {
        constructor() {
          br.constructor_.apply(this, arguments);
        }
        intersects(t2, e2) {
          const n2 = new N(t2, e2);
          if (!this._rectEnv.intersects(n2)) return false;
          if (this._rectEnv.intersects(t2)) return true;
          if (this._rectEnv.intersects(e2)) return true;
          if (t2.compareTo(e2) > 0) {
            const n3 = t2;
            t2 = e2, e2 = n3;
          }
          let s2 = false;
          return e2.y > t2.y && (s2 = true), s2 ? this._li.computeIntersection(t2, e2, this._diagDown0, this._diagDown1) : this._li.computeIntersection(t2, e2, this._diagUp0, this._diagUp1), !!this._li.hasIntersection();
        }
        getClass() {
          return br;
        }
        get interfaces_() {
          return [];
        }
      }
      br.constructor_ = function() {
        this._li = new te(), this._rectEnv = null, this._diagUp0 = null, this._diagUp1 = null, this._diagDown0 = null, this._diagDown1 = null;
        const t2 = arguments[0];
        this._rectEnv = t2, this._diagUp0 = new g(t2.getMinX(), t2.getMinY()), this._diagUp1 = new g(t2.getMaxX(), t2.getMaxY()), this._diagDown0 = new g(t2.getMinX(), t2.getMaxY()), this._diagDown1 = new g(t2.getMaxX(), t2.getMinY());
      };
      class Mr {
        constructor() {
          Mr.constructor_.apply(this, arguments);
        }
        static intersects(t2, e2) {
          return new Mr(t2).intersects(e2);
        }
        intersects(t2) {
          if (!this._rectEnv.intersects(t2.getEnvelopeInternal())) return false;
          const e2 = new Dr(this._rectEnv);
          if (e2.applyTo(t2), e2.intersects()) return true;
          const n2 = new Ar(this._rectangle);
          if (n2.applyTo(t2), n2.containsPoint()) return true;
          const s2 = new Fr(this._rectangle);
          return s2.applyTo(t2), !!s2.intersects();
        }
        getClass() {
          return Mr;
        }
        get interfaces_() {
          return [];
        }
      }
      Mr.constructor_ = function() {
        this._rectangle = null, this._rectEnv = null;
        const t2 = arguments[0];
        this._rectangle = t2, this._rectEnv = t2.getEnvelopeInternal();
      };
      class Dr extends Ce {
        constructor() {
          super(), Dr.constructor_.apply(this, arguments);
        }
        isDone() {
          return true === this._intersects;
        }
        visit(t2) {
          const e2 = t2.getEnvelopeInternal();
          return this._rectEnv.intersects(e2) ? this._rectEnv.contains(e2) || e2.getMinX() >= this._rectEnv.getMinX() && e2.getMaxX() <= this._rectEnv.getMaxX() || e2.getMinY() >= this._rectEnv.getMinY() && e2.getMaxY() <= this._rectEnv.getMaxY() ? (this._intersects = true, null) : void 0 : null;
        }
        intersects() {
          return this._intersects;
        }
        getClass() {
          return Dr;
        }
        get interfaces_() {
          return [];
        }
      }
      Dr.constructor_ = function() {
        this._rectEnv = null, this._intersects = false;
        const t2 = arguments[0];
        this._rectEnv = t2;
      };
      class Ar extends Ce {
        constructor() {
          super(), Ar.constructor_.apply(this, arguments);
        }
        isDone() {
          return true === this._containsPoint;
        }
        visit(t2) {
          if (!(t2 instanceof bt)) return null;
          const e2 = t2.getEnvelopeInternal();
          if (!this._rectEnv.intersects(e2)) return null;
          const n2 = new g();
          for (let s2 = 0; s2 < 4; s2++) if (this._rectSeq.getCoordinate(s2, n2), e2.contains(n2) && Ze.containsPointInPolygon(n2, t2)) return this._containsPoint = true, null;
        }
        containsPoint() {
          return this._containsPoint;
        }
        getClass() {
          return Ar;
        }
        get interfaces_() {
          return [];
        }
      }
      Ar.constructor_ = function() {
        this._rectSeq = null, this._rectEnv = null, this._containsPoint = false;
        const t2 = arguments[0];
        this._rectSeq = t2.getExteriorRing().getCoordinateSequence(), this._rectEnv = t2.getEnvelopeInternal();
      };
      class Fr extends Ce {
        constructor() {
          super(), Fr.constructor_.apply(this, arguments);
        }
        intersects() {
          return this._hasIntersection;
        }
        isDone() {
          return true === this._hasIntersection;
        }
        visit(t2) {
          const e2 = t2.getEnvelopeInternal();
          if (!this._rectEnv.intersects(e2)) return null;
          const n2 = xe.getLines(t2);
          this.checkIntersectionWithLineStrings(n2);
        }
        checkIntersectionWithLineStrings(t2) {
          for (let e2 = t2.iterator(); e2.hasNext(); ) {
            const t3 = e2.next();
            if (this.checkIntersectionWithSegments(t3), this._hasIntersection) return null;
          }
        }
        checkIntersectionWithSegments(t2) {
          const e2 = t2.getCoordinateSequence();
          for (let t3 = 1; t3 < e2.size(); t3++) if (e2.getCoordinate(t3 - 1, this._p0), e2.getCoordinate(t3, this._p1), this._rectIntersector.intersects(this._p0, this._p1)) return this._hasIntersection = true, null;
        }
        getClass() {
          return Fr;
        }
        get interfaces_() {
          return [];
        }
      }
      Fr.constructor_ = function() {
        this._rectEnv = null, this._rectIntersector = null, this._hasIntersection = false, this._p0 = new g(), this._p1 = new g();
        const t2 = arguments[0];
        this._rectEnv = t2.getEnvelopeInternal(), this._rectIntersector = new br(this._rectEnv);
      };
      class Gr extends ar {
        constructor() {
          super(), Gr.constructor_.apply(this, arguments);
        }
        static covers(t2, e2) {
          return !(2 === e2.getDimension() && t2.getDimension() < 2) && (!(1 === e2.getDimension() && t2.getDimension() < 1 && e2.getLength() > 0) && (!!t2.getEnvelopeInternal().covers(e2.getEnvelopeInternal()) && (!!t2.isRectangle() || new Gr(t2, e2).getIntersectionMatrix().isCovers())));
        }
        static intersects(t2, e2) {
          if (!t2.getEnvelopeInternal().intersects(e2.getEnvelopeInternal())) return false;
          if (t2.isRectangle()) return Mr.intersects(t2, e2);
          if (e2.isRectangle()) return Mr.intersects(e2, t2);
          if (t2.isGeometryCollection() || e2.isGeometryCollection()) {
            for (let n2 = 0; n2 < t2.getNumGeometries(); n2++) for (let s2 = 0; s2 < e2.getNumGeometries(); s2++) if (t2.getGeometryN(n2).intersects(e2.getGeometryN(s2))) return true;
            return false;
          }
          return new Gr(t2, e2).getIntersectionMatrix().isIntersects();
        }
        static touches(t2, e2) {
          return !!t2.getEnvelopeInternal().intersects(e2.getEnvelopeInternal()) && new Gr(t2, e2).getIntersectionMatrix().isTouches(t2.getDimension(), e2.getDimension());
        }
        static equalsTopo(t2, e2) {
          return !!t2.getEnvelopeInternal().equals(e2.getEnvelopeInternal()) && Gr.relate(t2, e2).isEquals(t2.getDimension(), e2.getDimension());
        }
        static relate() {
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return new Gr(t2, e2).getIntersectionMatrix();
          }
          if (3 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
            return new Gr(t2, e2, n2).getIntersectionMatrix();
          }
        }
        static overlaps(t2, e2) {
          return !!t2.getEnvelopeInternal().intersects(e2.getEnvelopeInternal()) && new Gr(t2, e2).getIntersectionMatrix().isOverlaps(t2.getDimension(), e2.getDimension());
        }
        static crosses(t2, e2) {
          return !!t2.getEnvelopeInternal().intersects(e2.getEnvelopeInternal()) && new Gr(t2, e2).getIntersectionMatrix().isCrosses(t2.getDimension(), e2.getDimension());
        }
        static contains(t2, e2) {
          return !(2 === e2.getDimension() && t2.getDimension() < 2) && (!(1 === e2.getDimension() && t2.getDimension() < 1 && e2.getLength() > 0) && (!!t2.getEnvelopeInternal().contains(e2.getEnvelopeInternal()) && (t2.isRectangle() ? Or.contains(t2, e2) : new Gr(t2, e2).getIntersectionMatrix().isContains())));
        }
        getIntersectionMatrix() {
          return this._relate.computeIM();
        }
        getClass() {
          return Gr;
        }
        get interfaces_() {
          return [];
        }
      }
      Gr.constructor_ = function() {
        if (this._relate = null, 2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          ar.constructor_.call(this, t2, e2), this._relate = new vr(this._arg);
        } else if (3 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
          ar.constructor_.call(this, t2, e2, n2), this._relate = new vr(this._arg);
        }
      };
      var qr = Object.freeze({ __proto__: null, RelateOp: Gr });
      class Br {
        constructor() {
          Br.constructor_.apply(this, arguments);
        }
        static union(t2, e2) {
          return new Br(t2, e2).union();
        }
        union() {
          const t2 = new _n(), e2 = new at();
          for (let n3 = 0; n3 < this._pointGeom.getNumGeometries(); n3++) {
            const s3 = this._pointGeom.getGeometryN(n3).getCoordinate();
            t2.locate(s3, this._otherGeom) === ne.EXTERIOR && e2.add(s3);
          }
          if (0 === e2.size()) return this._otherGeom;
          let n2 = null;
          const s2 = X.toCoordinateArray(e2);
          return n2 = 1 === s2.length ? this._geomFact.createPoint(s2[0]) : this._geomFact.createMultiPointFromCoords(s2), de.combine(n2, this._otherGeom);
        }
        getClass() {
          return Br;
        }
        get interfaces_() {
          return [];
        }
      }
      Br.constructor_ = function() {
        this._pointGeom = null, this._otherGeom = null, this._geomFact = null;
        const t2 = arguments[0], e2 = arguments[1];
        this._pointGeom = t2, this._otherGeom = e2, this._geomFact = e2.getFactory();
      };
      class Vr {
        constructor() {
          Vr.constructor_.apply(this, arguments);
        }
        static restrictToPolygons(t2) {
          if (_(t2, Ot)) return t2;
          const e2 = Ne.getPolygons(t2);
          return 1 === e2.size() ? e2.get(0) : t2.getFactory().createMultiPolygon(Ht.toPolygonArray(e2));
        }
        static getGeometry(t2, e2) {
          return e2 >= t2.size() ? null : t2.get(e2);
        }
        static union(t2) {
          return new Vr(t2).union();
        }
        reduceToGeometries(t2) {
          const e2 = new x();
          for (let n2 = t2.iterator(); n2.hasNext(); ) {
            const t3 = n2.next();
            let s2 = null;
            _(t3, m) ? s2 = this.unionTree(t3) : t3 instanceof q && (s2 = t3), e2.add(s2);
          }
          return e2;
        }
        extractByEnvelope(t2, e2, n2) {
          const s2 = new x();
          for (let i2 = 0; i2 < e2.getNumGeometries(); i2++) {
            const r2 = e2.getGeometryN(i2);
            r2.getEnvelopeInternal().intersects(t2) ? s2.add(r2) : n2.add(r2);
          }
          return this._geomFactory.buildGeometry(s2);
        }
        unionOptimized(t2, e2) {
          const n2 = t2.getEnvelopeInternal(), s2 = e2.getEnvelopeInternal();
          if (!n2.intersects(s2)) {
            return de.combine(t2, e2);
          }
          if (t2.getNumGeometries() <= 1 && e2.getNumGeometries() <= 1) return this.unionActual(t2, e2);
          const i2 = n2.intersection(s2);
          return this.unionUsingEnvelopeIntersection(t2, e2, i2);
        }
        union() {
          if (null === this._inputPolys) throw new IllegalStateException("union() method cannot be called twice");
          if (this._inputPolys.isEmpty()) return null;
          this._geomFactory = this._inputPolys.iterator().next().getFactory();
          const t2 = new Es(Vr.STRTREE_NODE_CAPACITY);
          for (let e3 = this._inputPolys.iterator(); e3.hasNext(); ) {
            const n2 = e3.next();
            t2.insert(n2.getEnvelopeInternal(), n2);
          }
          this._inputPolys = null;
          const e2 = t2.itemsTree();
          return this.unionTree(e2);
        }
        binaryUnion() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return this.binaryUnion(t2, 0, t2.size());
          }
          if (3 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
            if (n2 - e2 <= 1) {
              const n3 = Vr.getGeometry(t2, e2);
              return this.unionSafe(n3, null);
            }
            if (n2 - e2 == 2) return this.unionSafe(Vr.getGeometry(t2, e2), Vr.getGeometry(t2, e2 + 1));
            {
              const s2 = Math.trunc((n2 + e2) / 2), i2 = this.binaryUnion(t2, e2, s2), r2 = this.binaryUnion(t2, s2, n2);
              return this.unionSafe(i2, r2);
            }
          }
        }
        repeatedUnion(t2) {
          let e2 = null;
          for (let n2 = t2.iterator(); n2.hasNext(); ) {
            const t3 = n2.next();
            e2 = null === e2 ? t3.copy() : e2.union(t3);
          }
          return e2;
        }
        unionSafe(t2, e2) {
          return null === t2 && null === e2 ? null : null === t2 ? e2.copy() : null === e2 ? t2.copy() : this.unionOptimized(t2, e2);
        }
        unionActual(t2, e2) {
          return Vr.restrictToPolygons(t2.union(e2));
        }
        unionTree(t2) {
          const e2 = this.reduceToGeometries(t2);
          return this.binaryUnion(e2);
        }
        unionUsingEnvelopeIntersection(t2, e2, n2) {
          const s2 = new x(), i2 = this.extractByEnvelope(n2, t2, s2), r2 = this.extractByEnvelope(n2, e2, s2), o2 = this.unionActual(i2, r2);
          return s2.add(o2), de.combine(s2);
        }
        bufferUnion() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return t2.get(0).getFactory().buildGeometry(t2).buffer(0);
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return t2.getFactory().createGeometryCollection([t2, e2]).buffer(0);
          }
        }
        getClass() {
          return Vr;
        }
        get interfaces_() {
          return [];
        }
      }
      Vr.constructor_ = function() {
        this._inputPolys = null, this._geomFactory = null;
        const t2 = arguments[0];
        this._inputPolys = t2, null === this._inputPolys && (this._inputPolys = new x());
      }, Vr.STRTREE_NODE_CAPACITY = 4;
      class zr {
        constructor() {
          zr.constructor_.apply(this, arguments);
        }
        static union() {
          if (1 === arguments.length) {
            if (_(arguments[0], f)) {
              const t2 = arguments[0];
              return new zr(t2).union();
            }
            if (arguments[0] instanceof q) {
              const t2 = arguments[0];
              return new zr(t2).union();
            }
          } else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return new zr(t2, e2).union();
          }
        }
        unionNoOpt(t2) {
          const e2 = this._geomFact.createPoint();
          return lr.overlayOp(t2, e2, cr.UNION);
        }
        unionWithNull(t2, e2) {
          return null === t2 && null === e2 ? null : null === e2 ? t2 : null === t2 ? e2 : t2.union(e2);
        }
        extract() {
          if (_(arguments[0], f)) {
            for (let t2 = arguments[0].iterator(); t2.hasNext(); ) {
              const e2 = t2.next();
              this.extract(e2);
            }
          } else if (arguments[0] instanceof q) {
            const t2 = arguments[0];
            null === this._geomFact && (this._geomFact = t2.getFactory()), _e.extract(t2, q.TYPENAME_POLYGON, this._polygons), _e.extract(t2, q.TYPENAME_LINESTRING, this._lines), _e.extract(t2, q.TYPENAME_POINT, this._points);
          }
        }
        union() {
          if (null === this._geomFact) return null;
          let t2 = null;
          if (this._points.size() > 0) {
            const e3 = this._geomFact.buildGeometry(this._points);
            t2 = this.unionNoOpt(e3);
          }
          let e2 = null;
          if (this._lines.size() > 0) {
            const t3 = this._geomFact.buildGeometry(this._lines);
            e2 = this.unionNoOpt(t3);
          }
          let n2 = null;
          this._polygons.size() > 0 && (n2 = Vr.union(this._polygons));
          const s2 = this.unionWithNull(e2, n2);
          let i2 = null;
          return i2 = null === t2 ? s2 : null === s2 ? t2 : Br.union(t2, s2), null === i2 ? this._geomFact.createGeometryCollection() : i2;
        }
        getClass() {
          return zr;
        }
        get interfaces_() {
          return [];
        }
      }
      zr.constructor_ = function() {
        if (this._polygons = new x(), this._lines = new x(), this._points = new x(), this._geomFact = null, 1 === arguments.length) {
          if (_(arguments[0], f)) {
            const t2 = arguments[0];
            this.extract(t2);
          } else if (arguments[0] instanceof q) {
            const t2 = arguments[0];
            this.extract(t2);
          }
        } else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          this._geomFact = e2, this.extract(t2);
        }
      };
      var Yr = Object.freeze({ __proto__: null, UnaryUnionOp: zr }), Ur = Object.freeze({ __proto__: null, IsValidOp: Cr, ConsistentAreaTester: Er }), kr = Object.freeze({ __proto__: null, BoundaryOp: pt, IsSimpleOp: Hs, buffer: wi, distance: Pi, linemerge: Xi, overlay: hr, polygonize: Pr, relate: qr, union: Yr, valid: Ur });
      class Xr extends Ft.CoordinateOperation {
        constructor() {
          super(), Xr.constructor_.apply(this, arguments);
        }
        edit() {
          if (2 === arguments.length && arguments[1] instanceof q && arguments[0] instanceof Array) {
            const t2 = arguments[0], e2 = arguments[1];
            if (0 === t2.length) return null;
            const n2 = new Array(t2.length).fill(null);
            for (let e3 = 0; e3 < t2.length; e3++) {
              const s3 = new g(t2[e3]);
              this._targetPM.makePrecise(s3), n2[e3] = s3;
            }
            const s2 = new I(n2, false).toCoordinateArray();
            let i2 = 0;
            e2 instanceof Tt && (i2 = 2), e2 instanceof Dt && (i2 = 4);
            let r2 = n2;
            return this._removeCollapsed && (r2 = null), s2.length < i2 ? r2 : s2;
          }
          return super.edit.apply(this, arguments);
        }
        getClass() {
          return Xr;
        }
        get interfaces_() {
          return [];
        }
      }
      Xr.constructor_ = function() {
        this._targetPM = null, this._removeCollapsed = true;
        const t2 = arguments[0], e2 = arguments[1];
        this._targetPM = t2, this._removeCollapsed = e2;
      };
      class Hr {
        constructor() {
          Hr.constructor_.apply(this, arguments);
        }
        static reduce(t2, e2) {
          return new Hr(e2).reduce(t2);
        }
        static reducePointwise(t2, e2) {
          const n2 = new Hr(e2);
          return n2.setPointwise(true), n2.reduce(t2);
        }
        fixPolygonalTopology(t2) {
          let e2 = t2;
          this._changePrecisionModel || (e2 = this.changePM(t2, this._targetPM));
          const n2 = Si.bufferOp(e2, 0);
          let s2 = n2;
          return this._changePrecisionModel || (s2 = t2.getFactory().createGeometry(n2)), s2;
        }
        reducePointwise(t2) {
          let e2 = null;
          if (this._changePrecisionModel) {
            const n3 = this.createFactory(t2.getFactory(), this._targetPM);
            e2 = new Ft(n3);
          } else e2 = new Ft();
          let n2 = this._removeCollapsed;
          return t2.getDimension() >= 2 && (n2 = true), e2.edit(t2, new Xr(this._targetPM, n2));
        }
        changePM(t2, e2) {
          return this.createEditor(t2.getFactory(), e2).edit(t2, new Ft.NoOpGeometryOperation());
        }
        setRemoveCollapsedComponents(t2) {
          this._removeCollapsed = t2;
        }
        createFactory(t2, e2) {
          return new Ht(e2, t2.getSRID(), t2.getCoordinateSequenceFactory());
        }
        setChangePrecisionModel(t2) {
          this._changePrecisionModel = t2;
        }
        reduce(t2) {
          const e2 = this.reducePointwise(t2);
          return this._isPointwise ? e2 : _(e2, Ot) ? Cr.isValid(e2) ? e2 : this.fixPolygonalTopology(e2) : e2;
        }
        setPointwise(t2) {
          this._isPointwise = t2;
        }
        createEditor(t2, e2) {
          if (t2.getPrecisionModel() === e2) return new Ft();
          const n2 = this.createFactory(t2, e2);
          return new Ft(n2);
        }
        getClass() {
          return Hr;
        }
        get interfaces_() {
          return [];
        }
      }
      Hr.constructor_ = function() {
        this._targetPM = null, this._removeCollapsed = true, this._changePrecisionModel = false, this._isPointwise = false;
        const t2 = arguments[0];
        this._targetPM = t2;
      };
      var Wr = Object.freeze({ __proto__: null, GeometryPrecisionReducer: Hr });
      class jr {
        constructor() {
          jr.constructor_.apply(this, arguments);
        }
        static simplify(t2, e2) {
          const n2 = new jr(t2);
          return n2.setDistanceTolerance(e2), n2.simplify();
        }
        simplifySection(t2, e2) {
          if (t2 + 1 === e2) return null;
          this._seg.p0 = this._pts[t2], this._seg.p1 = this._pts[e2];
          let n2 = -1, s2 = t2;
          for (let i2 = t2 + 1; i2 < e2; i2++) {
            const t3 = this._seg.distance(this._pts[i2]);
            t3 > n2 && (n2 = t3, s2 = i2);
          }
          if (n2 <= this._distanceTolerance) for (let n3 = t2 + 1; n3 < e2; n3++) this._usePt[n3] = false;
          else this.simplifySection(t2, s2), this.simplifySection(s2, e2);
        }
        setDistanceTolerance(t2) {
          this._distanceTolerance = t2;
        }
        simplify() {
          this._usePt = new Array(this._pts.length).fill(null);
          for (let t3 = 0; t3 < this._pts.length; t3++) this._usePt[t3] = true;
          this.simplifySection(0, this._pts.length - 1);
          const t2 = new I();
          for (let e2 = 0; e2 < this._pts.length; e2++) this._usePt[e2] && t2.add(new g(this._pts[e2]));
          return t2.toCoordinateArray();
        }
        getClass() {
          return jr;
        }
        get interfaces_() {
          return [];
        }
      }
      jr.constructor_ = function() {
        this._pts = null, this._usePt = null, this._distanceTolerance = null, this._seg = new ee();
        const t2 = arguments[0];
        this._pts = t2;
      };
      class Kr {
        constructor() {
          Kr.constructor_.apply(this, arguments);
        }
        static simplify(t2, e2) {
          const n2 = new Kr(t2);
          return n2.setDistanceTolerance(e2), n2.getResultGeometry();
        }
        setEnsureValid(t2) {
          this._isEnsureValidTopology = t2;
        }
        getResultGeometry() {
          return this._inputGeom.isEmpty() ? this._inputGeom.copy() : new Zr(this._isEnsureValidTopology, this._distanceTolerance).transform(this._inputGeom);
        }
        setDistanceTolerance(t2) {
          if (t2 < 0) throw new n("Tolerance must be non-negative");
          this._distanceTolerance = t2;
        }
        getClass() {
          return Kr;
        }
        get interfaces_() {
          return [];
        }
      }
      class Zr extends me {
        constructor() {
          super(), Zr.constructor_.apply(this, arguments);
        }
        transformPolygon(t2, e2) {
          if (t2.isEmpty()) return null;
          const n2 = super.transformPolygon.call(this, t2, e2);
          return e2 instanceof At ? n2 : this.createValidArea(n2);
        }
        createValidArea(t2) {
          return this._isEnsureValidTopology ? t2.buffer(0) : t2;
        }
        transformCoordinates(t2, e2) {
          const n2 = t2.toCoordinateArray();
          let s2 = null;
          return s2 = 0 === n2.length ? new Array(0).fill(null) : jr.simplify(n2, this._distanceTolerance), this._factory.getCoordinateSequenceFactory().create(s2);
        }
        transformMultiPolygon(t2, e2) {
          const n2 = super.transformMultiPolygon.call(this, t2, e2);
          return this.createValidArea(n2);
        }
        transformLinearRing(t2, e2) {
          const n2 = e2 instanceof bt, s2 = super.transformLinearRing.call(this, t2, e2);
          return !n2 || s2 instanceof Dt ? s2 : null;
        }
        getClass() {
          return Zr;
        }
        get interfaces_() {
          return [];
        }
      }
      Zr.constructor_ = function() {
        this._isEnsureValidTopology = true, this._distanceTolerance = null;
        const t2 = arguments[0], e2 = arguments[1];
        this._isEnsureValidTopology = t2, this._distanceTolerance = e2;
      }, Kr.DPTransformer = Zr, Kr.constructor_ = function() {
        this._inputGeom = null, this._distanceTolerance = null, this._isEnsureValidTopology = true;
        const t2 = arguments[0];
        this._inputGeom = t2;
      };
      class Qr extends ee {
        constructor() {
          super(), Qr.constructor_.apply(this, arguments);
        }
        getIndex() {
          return this._index;
        }
        getParent() {
          return this._parent;
        }
        getClass() {
          return Qr;
        }
        get interfaces_() {
          return [];
        }
      }
      Qr.constructor_ = function() {
        if (this._parent = null, this._index = null, 2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          Qr.constructor_.call(this, t2, e2, null, -1);
        } else if (4 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3];
          ee.constructor_.call(this, t2, e2), this._parent = n2, this._index = s2;
        }
      };
      class Jr {
        constructor() {
          Jr.constructor_.apply(this, arguments);
        }
        static extractCoordinates(t2) {
          const e2 = new Array(t2.size() + 1).fill(null);
          let n2 = null;
          for (let s2 = 0; s2 < t2.size(); s2++) n2 = t2.get(s2), e2[s2] = n2.p0;
          return e2[e2.length - 1] = n2.p1, e2;
        }
        addToResult(t2) {
          this._resultSegs.add(t2);
        }
        asLineString() {
          return this._parentLine.getFactory().createLineString(Jr.extractCoordinates(this._resultSegs));
        }
        getResultSize() {
          const t2 = this._resultSegs.size();
          return 0 === t2 ? 0 : t2 + 1;
        }
        getParent() {
          return this._parentLine;
        }
        getSegment(t2) {
          return this._segs[t2];
        }
        getParentCoordinates() {
          return this._parentLine.getCoordinates();
        }
        getMinimumSize() {
          return this._minimumSize;
        }
        asLinearRing() {
          return this._parentLine.getFactory().createLinearRing(Jr.extractCoordinates(this._resultSegs));
        }
        getSegments() {
          return this._segs;
        }
        init() {
          const t2 = this._parentLine.getCoordinates();
          this._segs = new Array(t2.length - 1).fill(null);
          for (let e2 = 0; e2 < t2.length - 1; e2++) {
            const n2 = new Qr(t2[e2], t2[e2 + 1], this._parentLine, e2);
            this._segs[e2] = n2;
          }
        }
        getResultCoordinates() {
          return Jr.extractCoordinates(this._resultSegs);
        }
        getClass() {
          return Jr;
        }
        get interfaces_() {
          return [];
        }
      }
      Jr.constructor_ = function() {
        if (this._parentLine = null, this._segs = null, this._resultSegs = new x(), this._minimumSize = null, 1 === arguments.length) {
          const t2 = arguments[0];
          Jr.constructor_.call(this, t2, 2);
        } else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          this._parentLine = t2, this._minimumSize = e2, this.init();
        }
      };
      class $r {
        constructor() {
          $r.constructor_.apply(this, arguments);
        }
        remove(t2) {
          this._index.remove(new N(t2.p0, t2.p1), t2);
        }
        add() {
          if (arguments[0] instanceof Jr) {
            const t2 = arguments[0].getSegments();
            for (let e2 = 0; e2 < t2.length; e2++) {
              const n2 = t2[e2];
              this.add(n2);
            }
          } else if (arguments[0] instanceof ee) {
            const t2 = arguments[0];
            this._index.insert(new N(t2.p0, t2.p1), t2);
          }
        }
        query(t2) {
          const e2 = new N(t2.p0, t2.p1), n2 = new to(t2);
          return this._index.query(e2, n2), n2.getItems();
        }
        getClass() {
          return $r;
        }
        get interfaces_() {
          return [];
        }
      }
      $r.constructor_ = function() {
        this._index = new us();
      };
      class to {
        constructor() {
          to.constructor_.apply(this, arguments);
        }
        visitItem(t2) {
          const e2 = t2;
          N.intersects(e2.p0, e2.p1, this._querySeg.p0, this._querySeg.p1) && this._items.add(t2);
        }
        getItems() {
          return this._items;
        }
        getClass() {
          return to;
        }
        get interfaces_() {
          return [Ae];
        }
      }
      to.constructor_ = function() {
        this._querySeg = null, this._items = new x();
        const t2 = arguments[0];
        this._querySeg = t2;
      };
      class eo {
        constructor() {
          eo.constructor_.apply(this, arguments);
        }
        static isInLineSection(t2, e2, n2) {
          if (n2.getParent() !== t2.getParent()) return false;
          const s2 = n2.getIndex();
          return s2 >= e2[0] && s2 < e2[1];
        }
        flatten(t2, e2) {
          const n2 = this._linePts[t2], s2 = this._linePts[e2], i2 = new ee(n2, s2);
          return this.remove(this._line, t2, e2), this._outputIndex.add(i2), i2;
        }
        hasBadIntersection(t2, e2, n2) {
          return !!this.hasBadOutputIntersection(n2) || !!this.hasBadInputIntersection(t2, e2, n2);
        }
        setDistanceTolerance(t2) {
          this._distanceTolerance = t2;
        }
        simplifySection(t2, e2, n2) {
          n2 += 1;
          const s2 = new Array(2).fill(null);
          if (t2 + 1 === e2) {
            const e3 = this._line.getSegment(t2);
            return this._line.addToResult(e3), null;
          }
          let i2 = true;
          if (this._line.getResultSize() < this._line.getMinimumSize()) {
            n2 + 1 < this._line.getMinimumSize() && (i2 = false);
          }
          const r2 = new Array(1).fill(null), o2 = this.findFurthestPoint(this._linePts, t2, e2, r2);
          r2[0] > this._distanceTolerance && (i2 = false);
          const l2 = new ee();
          if (l2.p0 = this._linePts[t2], l2.p1 = this._linePts[e2], s2[0] = t2, s2[1] = e2, this.hasBadIntersection(this._line, s2, l2) && (i2 = false), i2) {
            const n3 = this.flatten(t2, e2);
            return this._line.addToResult(n3), null;
          }
          this.simplifySection(t2, o2, n2), this.simplifySection(o2, e2, n2);
        }
        hasBadOutputIntersection(t2) {
          for (let e2 = this._outputIndex.query(t2).iterator(); e2.hasNext(); ) {
            const n2 = e2.next();
            if (this.hasInteriorIntersection(n2, t2)) return true;
          }
          return false;
        }
        findFurthestPoint(t2, e2, n2, s2) {
          const i2 = new ee();
          i2.p0 = t2[e2], i2.p1 = t2[n2];
          let r2 = -1, o2 = e2;
          for (let s3 = e2 + 1; s3 < n2; s3++) {
            const e3 = t2[s3], n3 = i2.distance(e3);
            n3 > r2 && (r2 = n3, o2 = s3);
          }
          return s2[0] = r2, o2;
        }
        simplify(t2) {
          this._line = t2, this._linePts = t2.getParentCoordinates(), this.simplifySection(0, this._linePts.length - 1, 0);
        }
        remove(t2, e2, n2) {
          for (let s2 = e2; s2 < n2; s2++) {
            const e3 = t2.getSegment(s2);
            this._inputIndex.remove(e3);
          }
        }
        hasInteriorIntersection(t2, e2) {
          return this._li.computeIntersection(t2.p0, t2.p1, e2.p0, e2.p1), this._li.isInteriorIntersection();
        }
        hasBadInputIntersection(t2, e2, n2) {
          for (let s2 = this._inputIndex.query(n2).iterator(); s2.hasNext(); ) {
            const i2 = s2.next();
            if (this.hasInteriorIntersection(i2, n2)) {
              if (eo.isInLineSection(t2, e2, i2)) continue;
              return true;
            }
          }
          return false;
        }
        getClass() {
          return eo;
        }
        get interfaces_() {
          return [];
        }
      }
      eo.constructor_ = function() {
        this._li = new te(), this._inputIndex = new $r(), this._outputIndex = new $r(), this._line = null, this._linePts = null, this._distanceTolerance = 0;
        const t2 = arguments[0], e2 = arguments[1];
        this._inputIndex = t2, this._outputIndex = e2;
      };
      class no {
        constructor() {
          no.constructor_.apply(this, arguments);
        }
        setDistanceTolerance(t2) {
          this._distanceTolerance = t2;
        }
        simplify(t2) {
          for (let e2 = t2.iterator(); e2.hasNext(); ) this._inputIndex.add(e2.next());
          for (let e2 = t2.iterator(); e2.hasNext(); ) {
            const t3 = new eo(this._inputIndex, this._outputIndex);
            t3.setDistanceTolerance(this._distanceTolerance), t3.simplify(e2.next());
          }
        }
        getClass() {
          return no;
        }
        get interfaces_() {
          return [];
        }
      }
      no.constructor_ = function() {
        this._inputIndex = new $r(), this._outputIndex = new $r(), this._distanceTolerance = 0;
      };
      class so {
        constructor() {
          so.constructor_.apply(this, arguments);
        }
        static simplify(t2, e2) {
          const n2 = new so(t2);
          return n2.setDistanceTolerance(e2), n2.getResultGeometry();
        }
        getResultGeometry() {
          if (this._inputGeom.isEmpty()) return this._inputGeom.copy();
          return this._linestringMap = new Ut(), this._inputGeom.apply(new ro(this)), this._lineSimplifier.simplify(this._linestringMap.values()), new io(this._linestringMap).transform(this._inputGeom);
        }
        setDistanceTolerance(t2) {
          if (t2 < 0) throw new n("Tolerance must be non-negative");
          this._lineSimplifier.setDistanceTolerance(t2);
        }
        getClass() {
          return so;
        }
        get interfaces_() {
          return [];
        }
      }
      class io extends me {
        constructor() {
          super(), io.constructor_.apply(this, arguments);
        }
        transformCoordinates(t2, e2) {
          if (0 === t2.size()) return null;
          if (e2 instanceof Tt) {
            const t3 = this._linestringMap.get(e2);
            return this.createCoordinateSequence(t3.getResultCoordinates());
          }
          return super.transformCoordinates.call(this, t2, e2);
        }
        getClass() {
          return io;
        }
        get interfaces_() {
          return [];
        }
      }
      io.constructor_ = function() {
        this._linestringMap = null;
        const t2 = arguments[0];
        this._linestringMap = t2;
      };
      class ro {
        constructor() {
          ro.constructor_.apply(this, arguments);
        }
        filter(t2) {
          if (t2 instanceof Tt) {
            const e2 = t2;
            if (e2.isEmpty()) return null;
            const n2 = e2.isClosed() ? 4 : 2, s2 = new Jr(e2, n2);
            this.tps._linestringMap.put(e2, s2);
          }
        }
        getClass() {
          return ro;
        }
        get interfaces_() {
          return [G];
        }
      }
      ro.constructor_ = function() {
        this.tps = null;
        const t2 = arguments[0];
        this.tps = t2;
      }, so.LineStringTransformer = io, so.LineStringMapBuilderFilter = ro, so.constructor_ = function() {
        this._inputGeom = null, this._lineSimplifier = new no(), this._linestringMap = null;
        const t2 = arguments[0];
        this._inputGeom = t2;
      };
      class oo {
        constructor() {
          oo.constructor_.apply(this, arguments);
        }
        static simplify(t2, e2) {
          return new oo(t2, e2).simplify();
        }
        simplifyVertex(t2) {
          let e2 = t2, n2 = e2.getArea(), s2 = null;
          for (; null !== e2; ) {
            const t3 = e2.getArea();
            t3 < n2 && (n2 = t3, s2 = e2), e2 = e2._next;
          }
          return null !== s2 && n2 < this._tolerance && s2.remove(), t2.isLive() ? n2 : -1;
        }
        simplify() {
          const t2 = lo.buildLine(this._pts);
          let e2 = this._tolerance;
          do {
            e2 = this.simplifyVertex(t2);
          } while (e2 < this._tolerance);
          const n2 = t2.getCoordinates();
          return n2.length < 2 ? [n2[0], new g(n2[0])] : n2;
        }
        getClass() {
          return oo;
        }
        get interfaces_() {
          return [];
        }
      }
      class lo {
        constructor() {
          lo.constructor_.apply(this, arguments);
        }
        static buildLine(t2) {
          let e2 = null, n2 = null;
          for (let s2 = 0; s2 < t2.length; s2++) {
            const i2 = new lo(t2[s2]);
            null === e2 && (e2 = i2), i2.setPrev(n2), null !== n2 && (n2.setNext(i2), n2.updateArea()), n2 = i2;
          }
          return e2;
        }
        getCoordinates() {
          const t2 = new I();
          let e2 = this;
          do {
            t2.add(e2._pt, false), e2 = e2._next;
          } while (null !== e2);
          return t2.toCoordinateArray();
        }
        getArea() {
          return this._area;
        }
        updateArea() {
          if (null === this._prev || null === this._next) return this._area = lo.MAX_AREA, null;
          this._area = Math.abs(re.area(this._prev._pt, this._pt, this._next._pt));
        }
        remove() {
          const t2 = this._prev, e2 = this._next;
          let n2 = null;
          return null !== this._prev && (this._prev.setNext(e2), this._prev.updateArea(), n2 = this._prev), null !== this._next && (this._next.setPrev(t2), this._next.updateArea(), null === n2 && (n2 = this._next)), this._isLive = false, n2;
        }
        isLive() {
          return this._isLive;
        }
        setPrev(t2) {
          this._prev = t2;
        }
        setNext(t2) {
          this._next = t2;
        }
        getClass() {
          return lo;
        }
        get interfaces_() {
          return [];
        }
      }
      lo.constructor_ = function() {
        this._pt = null, this._prev = null, this._next = null, this._area = lo.MAX_AREA, this._isLive = true;
        const t2 = arguments[0];
        this._pt = t2;
      }, lo.MAX_AREA = i.MAX_VALUE, oo.VWVertex = lo, oo.constructor_ = function() {
        this._pts = null, this._tolerance = null;
        const t2 = arguments[0], e2 = arguments[1];
        this._pts = t2, this._tolerance = e2 * e2;
      };
      class ao {
        constructor() {
          ao.constructor_.apply(this, arguments);
        }
        static simplify(t2, e2) {
          const n2 = new ao(t2);
          return n2.setDistanceTolerance(e2), n2.getResultGeometry();
        }
        setEnsureValid(t2) {
          this._isEnsureValidTopology = t2;
        }
        getResultGeometry() {
          return this._inputGeom.isEmpty() ? this._inputGeom.copy() : new co(this._isEnsureValidTopology, this._distanceTolerance).transform(this._inputGeom);
        }
        setDistanceTolerance(t2) {
          if (t2 < 0) throw new n("Tolerance must be non-negative");
          this._distanceTolerance = t2;
        }
        getClass() {
          return ao;
        }
        get interfaces_() {
          return [];
        }
      }
      class co extends me {
        constructor() {
          super(), co.constructor_.apply(this, arguments);
        }
        transformPolygon(t2, e2) {
          if (t2.isEmpty()) return null;
          const n2 = super.transformPolygon.call(this, t2, e2);
          return e2 instanceof At ? n2 : this.createValidArea(n2);
        }
        createValidArea(t2) {
          return this._isEnsureValidTopology ? t2.buffer(0) : t2;
        }
        transformCoordinates(t2, e2) {
          const n2 = t2.toCoordinateArray();
          let s2 = null;
          return s2 = 0 === n2.length ? new Array(0).fill(null) : oo.simplify(n2, this._distanceTolerance), this._factory.getCoordinateSequenceFactory().create(s2);
        }
        transformMultiPolygon(t2, e2) {
          const n2 = super.transformMultiPolygon.call(this, t2, e2);
          return this.createValidArea(n2);
        }
        transformLinearRing(t2, e2) {
          const n2 = e2 instanceof bt, s2 = super.transformLinearRing.call(this, t2, e2);
          return !n2 || s2 instanceof Dt ? s2 : null;
        }
        getClass() {
          return co;
        }
        get interfaces_() {
          return [];
        }
      }
      co.constructor_ = function() {
        this._isEnsureValidTopology = true, this._distanceTolerance = null;
        const t2 = arguments[0], e2 = arguments[1];
        this._isEnsureValidTopology = t2, this._distanceTolerance = e2;
      }, ao.VWTransformer = co, ao.constructor_ = function() {
        this._inputGeom = null, this._distanceTolerance = null, this._isEnsureValidTopology = true;
        const t2 = arguments[0];
        this._inputGeom = t2;
      };
      var ho = Object.freeze({ __proto__: null, DouglasPeuckerSimplifier: Kr, TopologyPreservingSimplifier: so, VWSimplifier: ao });
      class uo {
        constructor() {
          uo.constructor_.apply(this, arguments);
        }
        static pointAlongReverse(t2, e2) {
          const n2 = new g();
          return n2.x = t2.p1.x - e2 * (t2.p1.x - t2.p0.x), n2.y = t2.p1.y - e2 * (t2.p1.y - t2.p0.y), n2;
        }
        splitAt() {
          if (1 === arguments.length) {
            const t2 = arguments[0], e2 = this._minimumLen / this._segLen;
            if (t2.distance(this._seg.p0) < this._minimumLen) return this._splitPt = this._seg.pointAlong(e2), null;
            if (t2.distance(this._seg.p1) < this._minimumLen) return this._splitPt = uo.pointAlongReverse(this._seg, e2), null;
            this._splitPt = t2;
          } else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = this.getConstrainedLength(t2) / this._segLen;
            e2.equals2D(this._seg.p0) ? this._splitPt = this._seg.pointAlong(n2) : this._splitPt = uo.pointAlongReverse(this._seg, n2);
          }
        }
        setMinimumLength(t2) {
          this._minimumLen = t2;
        }
        getConstrainedLength(t2) {
          return t2 < this._minimumLen ? this._minimumLen : t2;
        }
        getSplitPoint() {
          return this._splitPt;
        }
        getClass() {
          return uo;
        }
        get interfaces_() {
          return [];
        }
      }
      uo.constructor_ = function() {
        this._seg = null, this._segLen = null, this._splitPt = null, this._minimumLen = 0;
        const t2 = arguments[0];
        this._seg = t2, this._segLen = t2.getLength();
      };
      class go {
        constructor() {
          go.constructor_.apply(this, arguments);
        }
        findSplitPoint(t2, e2) {
        }
        getClass() {
          return go;
        }
        get interfaces_() {
          return [];
        }
      }
      go.constructor_ = function() {
      };
      class _o {
        constructor() {
          _o.constructor_.apply(this, arguments);
        }
        static projectedSplitPoint(t2, e2) {
          return t2.getLineSegment().project(e2);
        }
        findSplitPoint(t2, e2) {
          const n2 = t2.getLineSegment(), s2 = n2.getLength() / 2, i2 = new uo(n2), r2 = _o.projectedSplitPoint(t2, e2);
          let o2 = 2 * r2.distance(e2) * 0.8;
          return o2 > s2 && (o2 = s2), i2.setMinimumLength(o2), i2.splitAt(r2), i2.getSplitPoint();
        }
        getClass() {
          return _o;
        }
        get interfaces_() {
          return [go];
        }
      }
      _o.constructor_ = function() {
      };
      class fo {
        constructor() {
          fo.constructor_.apply(this, arguments);
        }
        static triArea(t2, e2, n2) {
          return (e2.x - t2.x) * (n2.y - t2.y) - (e2.y - t2.y) * (n2.x - t2.x);
        }
        static isInCircleDDNormalized(t2, e2, n2, s2) {
          const i2 = R.valueOf(t2.x).selfSubtract(s2.x), r2 = R.valueOf(t2.y).selfSubtract(s2.y), o2 = R.valueOf(e2.x).selfSubtract(s2.x), l2 = R.valueOf(e2.y).selfSubtract(s2.y), a2 = R.valueOf(n2.x).selfSubtract(s2.x), c2 = R.valueOf(n2.y).selfSubtract(s2.y), h2 = i2.multiply(l2).selfSubtract(o2.multiply(r2)), u2 = o2.multiply(c2).selfSubtract(a2.multiply(l2)), g2 = a2.multiply(r2).selfSubtract(i2.multiply(c2)), d2 = i2.multiply(i2).selfAdd(r2.multiply(r2)), _2 = o2.multiply(o2).selfAdd(l2.multiply(l2)), f2 = a2.multiply(a2).selfAdd(c2.multiply(c2));
          return d2.selfMultiply(u2).selfAdd(_2.selfMultiply(g2)).selfAdd(f2.selfMultiply(h2)).doubleValue() > 0;
        }
        static checkRobustInCircle(t2, e2, n2, s2) {
          const i2 = fo.isInCircleNonRobust(t2, e2, n2, s2), r2 = fo.isInCircleDDSlow(t2, e2, n2, s2), o2 = fo.isInCircleCC(t2, e2, n2, s2), l2 = re.circumcentre(t2, e2, n2);
          O.out.println("p radius diff a = " + Math.abs(s2.distance(l2) - t2.distance(l2)) / t2.distance(l2)), i2 === r2 && i2 === o2 || (O.out.println("inCircle robustness failure (double result = " + i2 + ", DD result = " + r2 + ", CC result = " + o2 + ")"), O.out.println(Jt.toLineString(new zt([t2, e2, n2, s2]))), O.out.println("Circumcentre = " + Jt.toPoint(l2) + " radius = " + t2.distance(l2)), O.out.println("p radius diff a = " + Math.abs(s2.distance(l2) / t2.distance(l2) - 1)), O.out.println("p radius diff b = " + Math.abs(s2.distance(l2) / e2.distance(l2) - 1)), O.out.println("p radius diff c = " + Math.abs(s2.distance(l2) / n2.distance(l2) - 1)), O.out.println());
        }
        static isInCircleDDFast(t2, e2, n2, s2) {
          const i2 = R.sqr(t2.x).selfAdd(R.sqr(t2.y)).selfMultiply(fo.triAreaDDFast(e2, n2, s2)), r2 = R.sqr(e2.x).selfAdd(R.sqr(e2.y)).selfMultiply(fo.triAreaDDFast(t2, n2, s2)), o2 = R.sqr(n2.x).selfAdd(R.sqr(n2.y)).selfMultiply(fo.triAreaDDFast(t2, e2, s2)), l2 = R.sqr(s2.x).selfAdd(R.sqr(s2.y)).selfMultiply(fo.triAreaDDFast(t2, e2, n2));
          return i2.selfSubtract(r2).selfAdd(o2).selfSubtract(l2).doubleValue() > 0;
        }
        static isInCircleCC(t2, e2, n2, s2) {
          const i2 = re.circumcentre(t2, e2, n2), r2 = t2.distance(i2);
          return s2.distance(i2) - r2 <= 0;
        }
        static isInCircleNormalized(t2, e2, n2, s2) {
          const i2 = t2.x - s2.x, r2 = t2.y - s2.y, o2 = e2.x - s2.x, l2 = e2.y - s2.y, a2 = n2.x - s2.x, c2 = n2.y - s2.y;
          return (i2 * i2 + r2 * r2) * (o2 * c2 - a2 * l2) + (o2 * o2 + l2 * l2) * (a2 * r2 - i2 * c2) + (a2 * a2 + c2 * c2) * (i2 * l2 - o2 * r2) > 0;
        }
        static isInCircleDDSlow(t2, e2, n2, s2) {
          const i2 = R.valueOf(s2.x), r2 = R.valueOf(s2.y), o2 = R.valueOf(t2.x), l2 = R.valueOf(t2.y), a2 = R.valueOf(e2.x), c2 = R.valueOf(e2.y), h2 = R.valueOf(n2.x), u2 = R.valueOf(n2.y), g2 = o2.multiply(o2).add(l2.multiply(l2)).multiply(fo.triAreaDDSlow(a2, c2, h2, u2, i2, r2)), d2 = a2.multiply(a2).add(c2.multiply(c2)).multiply(fo.triAreaDDSlow(o2, l2, h2, u2, i2, r2)), _2 = h2.multiply(h2).add(u2.multiply(u2)).multiply(fo.triAreaDDSlow(o2, l2, a2, c2, i2, r2)), f2 = i2.multiply(i2).add(r2.multiply(r2)).multiply(fo.triAreaDDSlow(o2, l2, a2, c2, h2, u2));
          return g2.subtract(d2).add(_2).subtract(f2).doubleValue() > 0;
        }
        static isInCircleNonRobust(t2, e2, n2, s2) {
          return (t2.x * t2.x + t2.y * t2.y) * fo.triArea(e2, n2, s2) - (e2.x * e2.x + e2.y * e2.y) * fo.triArea(t2, n2, s2) + (n2.x * n2.x + n2.y * n2.y) * fo.triArea(t2, e2, s2) - (s2.x * s2.x + s2.y * s2.y) * fo.triArea(t2, e2, n2) > 0;
        }
        static isInCircleRobust(t2, e2, n2, s2) {
          return fo.isInCircleNormalized(t2, e2, n2, s2);
        }
        static triAreaDDSlow(t2, e2, n2, s2, i2, r2) {
          return n2.subtract(t2).multiply(r2.subtract(e2)).subtract(s2.subtract(e2).multiply(i2.subtract(t2)));
        }
        static triAreaDDFast(t2, e2, n2) {
          const s2 = R.valueOf(e2.x).selfSubtract(t2.x).selfMultiply(R.valueOf(n2.y).selfSubtract(t2.y)), i2 = R.valueOf(e2.y).selfSubtract(t2.y).selfMultiply(R.valueOf(n2.x).selfSubtract(t2.x));
          return s2.selfSubtract(i2);
        }
        getClass() {
          return fo;
        }
        get interfaces_() {
          return [];
        }
      }
      fo.constructor_ = function() {
      };
      class po {
        constructor() {
          po.constructor_.apply(this, arguments);
        }
        static interpolateZ() {
          if (3 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = e2.distance(n2), i2 = t2.distance(e2), r2 = n2.z - e2.z;
            return e2.z + r2 * (i2 / s2);
          }
          if (4 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3], i2 = e2.x, r2 = e2.y, o2 = n2.x - i2, l2 = s2.x - i2, a2 = n2.y - r2, c2 = s2.y - r2, h2 = o2 * c2 - l2 * a2, u2 = t2.x - i2, g2 = t2.y - r2, d2 = (c2 * u2 - l2 * g2) / h2, _2 = (-a2 * u2 + o2 * g2) / h2;
            return e2.z + d2 * (n2.z - e2.z) + _2 * (s2.z - e2.z);
          }
        }
        circleCenter(t2, e2) {
          const n2 = new po(this.getX(), this.getY()), s2 = this.bisector(n2, t2), i2 = this.bisector(t2, e2), r2 = new b(s2, i2);
          let o2 = null;
          try {
            o2 = new po(r2.getX(), r2.getY());
          } catch (s3) {
            if (!(s3 instanceof S)) throw s3;
            O.err.println("a: " + n2 + "  b: " + t2 + "  c: " + e2), O.err.println(s3);
          }
          return o2;
        }
        dot(t2) {
          return this._p.x * t2.getX() + this._p.y * t2.getY();
        }
        magn() {
          return Math.sqrt(this._p.x * this._p.x + this._p.y * this._p.y);
        }
        getZ() {
          return this._p.z;
        }
        bisector(t2, e2) {
          const n2 = e2.getX() - t2.getX(), s2 = e2.getY() - t2.getY(), i2 = new b(t2.getX() + n2 / 2, t2.getY() + s2 / 2, 1), r2 = new b(t2.getX() - s2 + n2 / 2, t2.getY() + n2 + s2 / 2, 1);
          return new b(i2, r2);
        }
        equals() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return this._p.x === t2.getX() && this._p.y === t2.getY();
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return this._p.distance(t2.getCoordinate()) < e2;
          }
        }
        getCoordinate() {
          return this._p;
        }
        isInCircle(t2, e2, n2) {
          return fo.isInCircleRobust(t2._p, e2._p, n2._p, this._p);
        }
        interpolateZValue(t2, e2, n2) {
          const s2 = t2.getX(), i2 = t2.getY(), r2 = e2.getX() - s2, o2 = n2.getX() - s2, l2 = e2.getY() - i2, a2 = n2.getY() - i2, c2 = r2 * a2 - o2 * l2, h2 = this.getX() - s2, u2 = this.getY() - i2, g2 = (a2 * h2 - o2 * u2) / c2, d2 = (-l2 * h2 + r2 * u2) / c2;
          return t2.getZ() + g2 * (e2.getZ() - t2.getZ()) + d2 * (n2.getZ() - t2.getZ());
        }
        midPoint(t2) {
          const e2 = (this._p.x + t2.getX()) / 2, n2 = (this._p.y + t2.getY()) / 2, s2 = (this._p.z + t2.getZ()) / 2;
          return new po(e2, n2, s2);
        }
        rightOf(t2) {
          return this.isCCW(t2.dest(), t2.orig());
        }
        isCCW(t2, e2) {
          return (t2._p.x - this._p.x) * (e2._p.y - this._p.y) - (t2._p.y - this._p.y) * (e2._p.x - this._p.x) > 0;
        }
        getX() {
          return this._p.x;
        }
        crossProduct(t2) {
          return this._p.x * t2.getY() - this._p.y * t2.getX();
        }
        setZ(t2) {
          this._p.z = t2;
        }
        times(t2) {
          return new po(t2 * this._p.x, t2 * this._p.y);
        }
        cross() {
          return new po(this._p.y, -this._p.x);
        }
        leftOf(t2) {
          return this.isCCW(t2.orig(), t2.dest());
        }
        toString() {
          return "POINT (" + this._p.x + " " + this._p.y + ")";
        }
        sub(t2) {
          return new po(this._p.x - t2.getX(), this._p.y - t2.getY());
        }
        getY() {
          return this._p.y;
        }
        classify(t2, e2) {
          const n2 = e2.sub(t2), s2 = this.sub(t2), i2 = n2.crossProduct(s2);
          return i2 > 0 ? po.LEFT : i2 < 0 ? po.RIGHT : n2.getX() * s2.getX() < 0 || n2.getY() * s2.getY() < 0 ? po.BEHIND : n2.magn() < s2.magn() ? po.BEYOND : t2.equals(this) ? po.ORIGIN : e2.equals(this) ? po.DESTINATION : po.BETWEEN;
        }
        sum(t2) {
          return new po(this._p.x + t2.getX(), this._p.y + t2.getY());
        }
        distance(t2, e2) {
          return Math.sqrt(Math.pow(e2.getX() - t2.getX(), 2) + Math.pow(e2.getY() - t2.getY(), 2));
        }
        circumRadiusRatio(t2, e2) {
          const n2 = this.circleCenter(t2, e2), s2 = this.distance(n2, t2);
          let i2 = this.distance(this, t2), r2 = this.distance(t2, e2);
          return r2 < i2 && (i2 = r2), r2 = this.distance(e2, this), r2 < i2 && (i2 = r2), s2 / i2;
        }
        getClass() {
          return po;
        }
        get interfaces_() {
          return [];
        }
      }
      po.constructor_ = function() {
        if (this._p = null, 1 === arguments.length) {
          const t2 = arguments[0];
          this._p = new g(t2);
        } else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          this._p = new g(t2, e2);
        } else if (3 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
          this._p = new g(t2, e2, n2);
        }
      }, po.LEFT = 0, po.RIGHT = 1, po.BEYOND = 2, po.BEHIND = 3, po.BETWEEN = 4, po.ORIGIN = 5, po.DESTINATION = 6;
      class mo extends po {
        constructor() {
          super(), mo.constructor_.apply(this, arguments);
        }
        getConstraint() {
          return this._constraint;
        }
        setOnConstraint(t2) {
          this._isOnConstraint = t2;
        }
        merge(t2) {
          t2._isOnConstraint && (this._isOnConstraint = true, this._constraint = t2._constraint);
        }
        isOnConstraint() {
          return this._isOnConstraint;
        }
        setConstraint(t2) {
          this._isOnConstraint = true, this._constraint = t2;
        }
        getClass() {
          return mo;
        }
        get interfaces_() {
          return [];
        }
      }
      mo.constructor_ = function() {
        this._isOnConstraint = null, this._constraint = null;
        const t2 = arguments[0];
        po.constructor_.call(this, t2);
      };
      class yo {
        constructor() {
          yo.constructor_.apply(this, arguments);
        }
        static makeEdge(t2, e2) {
          const n2 = new yo(), s2 = new yo(), i2 = new yo(), r2 = new yo();
          n2._rot = s2, s2._rot = i2, i2._rot = r2, r2._rot = n2, n2.setNext(n2), s2.setNext(r2), i2.setNext(i2), r2.setNext(s2);
          const o2 = n2;
          return o2.setOrig(t2), o2.setDest(e2), o2;
        }
        static swap(t2) {
          const e2 = t2.oPrev(), n2 = t2.sym().oPrev();
          yo.splice(t2, e2), yo.splice(t2.sym(), n2), yo.splice(t2, e2.lNext()), yo.splice(t2.sym(), n2.lNext()), t2.setOrig(e2.dest()), t2.setDest(n2.dest());
        }
        static splice(t2, e2) {
          const n2 = t2.oNext().rot(), s2 = e2.oNext().rot(), i2 = e2.oNext(), r2 = t2.oNext(), o2 = s2.oNext(), l2 = n2.oNext();
          t2.setNext(i2), e2.setNext(r2), n2.setNext(o2), s2.setNext(l2);
        }
        static connect(t2, e2) {
          const n2 = yo.makeEdge(t2.dest(), e2.orig());
          return yo.splice(n2, t2.lNext()), yo.splice(n2.sym(), e2), n2;
        }
        equalsNonOriented(t2) {
          return !!this.equalsOriented(t2) || !!this.equalsOriented(t2.sym());
        }
        toLineSegment() {
          return new ee(this._vertex.getCoordinate(), this.dest().getCoordinate());
        }
        dest() {
          return this.sym().orig();
        }
        oNext() {
          return this._next;
        }
        equalsOriented(t2) {
          return !(!this.orig().getCoordinate().equals2D(t2.orig().getCoordinate()) || !this.dest().getCoordinate().equals2D(t2.dest().getCoordinate()));
        }
        dNext() {
          return this.sym().oNext().sym();
        }
        lPrev() {
          return this._next.sym();
        }
        rPrev() {
          return this.sym().oNext();
        }
        rot() {
          return this._rot;
        }
        oPrev() {
          return this._rot._next._rot;
        }
        sym() {
          return this._rot._rot;
        }
        setOrig(t2) {
          this._vertex = t2;
        }
        lNext() {
          return this.invRot().oNext().rot();
        }
        getLength() {
          return this.orig().getCoordinate().distance(this.dest().getCoordinate());
        }
        invRot() {
          return this._rot.sym();
        }
        setDest(t2) {
          this.sym().setOrig(t2);
        }
        setData(t2) {
          this._data = t2;
        }
        getData() {
          return this._data;
        }
        delete() {
          this._rot = null;
        }
        orig() {
          return this._vertex;
        }
        rNext() {
          return this._rot._next.invRot();
        }
        toString() {
          const t2 = this._vertex.getCoordinate(), e2 = this.dest().getCoordinate();
          return Jt.toLineString(t2, e2);
        }
        isLive() {
          return null !== this._rot;
        }
        getPrimary() {
          return this.orig().getCoordinate().compareTo(this.dest().getCoordinate()) <= 0 ? this : this.sym();
        }
        dPrev() {
          return this.invRot().oNext().invRot();
        }
        setNext(t2) {
          this._next = t2;
        }
        getClass() {
          return yo;
        }
        get interfaces_() {
          return [];
        }
      }
      yo.constructor_ = function() {
        this._rot = null, this._vertex = null, this._next = null, this._data = null;
      };
      class xo {
        constructor() {
          xo.constructor_.apply(this, arguments);
        }
        insertSite(t2) {
          let e2 = this._subdiv.locate(t2);
          if (this._subdiv.isVertexOfEdge(e2, t2)) return e2;
          this._subdiv.isOnEdge(e2, t2.getCoordinate()) && (e2 = e2.oPrev(), this._subdiv.delete(e2.oNext()));
          let n2 = this._subdiv.makeEdge(e2.orig(), t2);
          yo.splice(n2, e2);
          const s2 = n2;
          do {
            n2 = this._subdiv.connect(e2, n2.sym()), e2 = n2.oPrev();
          } while (e2.lNext() !== s2);
          for (; ; ) {
            const i2 = e2.oPrev();
            if (i2.dest().rightOf(e2) && t2.isInCircle(e2.orig(), i2.dest(), e2.dest())) yo.swap(e2), e2 = e2.oPrev();
            else {
              if (e2.oNext() === s2) return n2;
              e2 = e2.oNext().lPrev();
            }
          }
        }
        insertSites(t2) {
          for (let e2 = t2.iterator(); e2.hasNext(); ) {
            const t3 = e2.next();
            this.insertSite(t3);
          }
        }
        getClass() {
          return xo;
        }
        get interfaces_() {
          return [];
        }
      }
      xo.constructor_ = function() {
        this._subdiv = null, this._isUsingTolerance = false;
        const t2 = arguments[0];
        this._subdiv = t2, this._isUsingTolerance = t2.getTolerance() > 0;
      };
      class Eo {
        constructor() {
          Eo.constructor_.apply(this, arguments);
        }
        locate(t2) {
        }
        getClass() {
          return Eo;
        }
        get interfaces_() {
          return [];
        }
      }
      Eo.constructor_ = function() {
      };
      class Io {
        constructor() {
          Io.constructor_.apply(this, arguments);
        }
        init() {
          this._lastEdge = this.findEdge();
        }
        locate(t2) {
          this._lastEdge.isLive() || this.init();
          const e2 = this._subdiv.locateFromEdge(t2, this._lastEdge);
          return this._lastEdge = e2, e2;
        }
        findEdge() {
          return this._subdiv.getEdges().iterator().next();
        }
        getClass() {
          return Io;
        }
        get interfaces_() {
          return [Eo];
        }
      }
      Io.constructor_ = function() {
        this._subdiv = null, this._lastEdge = null;
        const t2 = arguments[0];
        this._subdiv = t2, this.init();
      };
      class No extends c {
        constructor() {
          super(), No.constructor_.apply(this, arguments);
        }
        static msgWithSpatial(t2, e2) {
          return null !== e2 ? t2 + " [ " + e2 + " ]" : t2;
        }
        getSegment() {
          return this._seg;
        }
        getClass() {
          return No;
        }
        get interfaces_() {
          return [];
        }
      }
      No.constructor_ = function() {
        if (this._seg = null, 1 === arguments.length) {
          if ("string" == typeof arguments[0]) {
            const t2 = arguments[0];
            c.constructor_.call(this, t2);
          } else if (arguments[0] instanceof ee) {
            const t2 = arguments[0];
            c.constructor_.call(this, "Locate failed to converge (at edge: " + t2 + ").  Possible causes include invalid Subdivision topology or very close sites"), this._seg = new ee(t2);
          }
        } else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          c.constructor_.call(this, No.msgWithSpatial(t2, e2)), this._seg = new ee(e2);
        }
      };
      class Co {
        constructor() {
          Co.constructor_.apply(this, arguments);
        }
        visit(t2) {
        }
        getClass() {
          return Co;
        }
        get interfaces_() {
          return [];
        }
      }
      Co.constructor_ = function() {
      };
      class So {
        constructor() {
          So.constructor_.apply(this, arguments);
        }
        static getTriangleEdges(t2, e2) {
          if (e2[0] = t2, e2[1] = e2[0].lNext(), e2[2] = e2[1].lNext(), e2[2].lNext() !== e2[0]) throw new n("Edges do not form a triangle");
        }
        getTriangleVertices(t2) {
          const e2 = new To();
          return this.visitTriangles(e2, t2), e2.getTriangleVertices();
        }
        isFrameVertex(t2) {
          return !!t2.equals(this._frameVertex[0]) || (!!t2.equals(this._frameVertex[1]) || !!t2.equals(this._frameVertex[2]));
        }
        isVertexOfEdge(t2, e2) {
          return !(!e2.equals(t2.orig(), this._tolerance) && !e2.equals(t2.dest(), this._tolerance));
        }
        connect(t2, e2) {
          const n2 = yo.connect(t2, e2);
          return this._quadEdges.add(n2), n2;
        }
        getVoronoiCellPolygon(t2, e2) {
          const n2 = new x(), s2 = t2;
          do {
            const e3 = t2.rot().orig().getCoordinate();
            n2.add(e3), t2 = t2.oPrev();
          } while (t2 !== s2);
          const i2 = new I();
          i2.addAll(n2, false), i2.closeRing(), i2.size() < 4 && (O.out.println(i2), i2.add(i2.get(i2.size() - 1), true));
          const r2 = i2.toCoordinateArray(), o2 = e2.createPolygon(e2.createLinearRing(r2)), l2 = s2.orig();
          return o2.setUserData(l2.getCoordinate()), o2;
        }
        setLocator(t2) {
          this._locator = t2;
        }
        initSubdiv() {
          const t2 = this.makeEdge(this._frameVertex[0], this._frameVertex[1]), e2 = this.makeEdge(this._frameVertex[1], this._frameVertex[2]);
          yo.splice(t2.sym(), e2);
          const n2 = this.makeEdge(this._frameVertex[2], this._frameVertex[0]);
          return yo.splice(e2.sym(), n2), yo.splice(n2.sym(), t2), t2;
        }
        isFrameBorderEdge(t2) {
          const e2 = new Array(3).fill(null);
          So.getTriangleEdges(t2, e2);
          const n2 = new Array(3).fill(null);
          So.getTriangleEdges(t2.sym(), n2);
          const s2 = t2.lNext().dest();
          if (this.isFrameVertex(s2)) return true;
          const i2 = t2.sym().lNext().dest();
          return !!this.isFrameVertex(i2);
        }
        makeEdge(t2, e2) {
          const n2 = yo.makeEdge(t2, e2);
          return this._quadEdges.add(n2), n2;
        }
        visitTriangles(t2, e2) {
          this._visitedKey++;
          const n2 = new on();
          n2.push(this._startingEdge);
          const s2 = new J();
          for (; !n2.empty(); ) {
            const i2 = n2.pop();
            if (!s2.contains(i2)) {
              const r2 = this.fetchTriangleToVisit(i2, n2, e2, s2);
              null !== r2 && t2.visit(r2);
            }
          }
        }
        isFrameEdge(t2) {
          return !(!this.isFrameVertex(t2.orig()) && !this.isFrameVertex(t2.dest()));
        }
        isOnEdge(t2, e2) {
          return this._seg.setCoordinates(t2.orig().getCoordinate(), t2.dest().getCoordinate()), this._seg.distance(e2) < this._edgeCoincidenceTolerance;
        }
        getEnvelope() {
          return new N(this._frameEnv);
        }
        createFrame(t2) {
          const e2 = t2.getWidth(), n2 = t2.getHeight();
          let s2 = 0;
          s2 = e2 > n2 ? 10 * e2 : 10 * n2, this._frameVertex[0] = new po((t2.getMaxX() + t2.getMinX()) / 2, t2.getMaxY() + s2), this._frameVertex[1] = new po(t2.getMinX() - s2, t2.getMinY() - s2), this._frameVertex[2] = new po(t2.getMaxX() + s2, t2.getMinY() - s2), this._frameEnv = new N(this._frameVertex[0].getCoordinate(), this._frameVertex[1].getCoordinate()), this._frameEnv.expandToInclude(this._frameVertex[2].getCoordinate());
        }
        getTriangleCoordinates(t2) {
          const e2 = new Ro();
          return this.visitTriangles(e2, t2), e2.getTriangles();
        }
        getVertices(t2) {
          const e2 = new J();
          for (let n2 = this._quadEdges.iterator(); n2.hasNext(); ) {
            const s2 = n2.next(), i2 = s2.orig();
            !t2 && this.isFrameVertex(i2) || e2.add(i2);
            const r2 = s2.dest();
            !t2 && this.isFrameVertex(r2) || e2.add(r2);
          }
          return e2;
        }
        fetchTriangleToVisit(t2, e2, n2, s2) {
          let i2 = t2, r2 = 0, o2 = false;
          do {
            this._triEdges[r2] = i2, this.isFrameEdge(i2) && (o2 = true);
            const t3 = i2.sym();
            s2.contains(t3) || e2.push(t3), s2.add(i2), r2++, i2 = i2.lNext();
          } while (i2 !== t2);
          return o2 && !n2 ? null : this._triEdges;
        }
        getEdges() {
          if (0 === arguments.length) return this._quadEdges;
          if (1 === arguments.length) {
            const t2 = arguments[0], e2 = this.getPrimaryEdges(false), n2 = new Array(e2.size()).fill(null);
            let s2 = 0;
            for (let i2 = e2.iterator(); i2.hasNext(); ) {
              const e3 = i2.next();
              n2[s2++] = t2.createLineString([e3.orig().getCoordinate(), e3.dest().getCoordinate()]);
            }
            return t2.createMultiLineString(n2);
          }
        }
        getVertexUniqueEdges(t2) {
          const e2 = new x(), n2 = new J();
          for (let s2 = this._quadEdges.iterator(); s2.hasNext(); ) {
            const i2 = s2.next(), r2 = i2.orig();
            n2.contains(r2) || (n2.add(r2), !t2 && this.isFrameVertex(r2) || e2.add(i2));
            const o2 = i2.sym(), l2 = o2.orig();
            n2.contains(l2) || (n2.add(l2), !t2 && this.isFrameVertex(l2) || e2.add(o2));
          }
          return e2;
        }
        getTriangleEdges(t2) {
          const e2 = new Lo();
          return this.visitTriangles(e2, t2), e2.getTriangleEdges();
        }
        getPrimaryEdges(t2) {
          this._visitedKey++;
          const e2 = new x(), n2 = new on();
          n2.push(this._startingEdge);
          const s2 = new J();
          for (; !n2.empty(); ) {
            const i2 = n2.pop();
            if (!s2.contains(i2)) {
              const r2 = i2.getPrimary();
              !t2 && this.isFrameEdge(r2) || e2.add(r2), n2.push(i2.oNext()), n2.push(i2.sym().oNext()), s2.add(i2), s2.add(i2.sym());
            }
          }
          return e2;
        }
        delete(t2) {
          yo.splice(t2, t2.oPrev()), yo.splice(t2.sym(), t2.sym().oPrev());
          const e2 = t2.sym(), n2 = t2.rot(), s2 = t2.rot().sym();
          this._quadEdges.remove(t2), this._quadEdges.remove(e2), this._quadEdges.remove(n2), this._quadEdges.remove(s2), t2.delete(), e2.delete(), n2.delete(), s2.delete();
        }
        locateFromEdge(t2, e2) {
          let n2 = 0;
          const s2 = this._quadEdges.size();
          let i2 = e2;
          for (; ; ) {
            if (n2++, n2 > s2) throw new No(i2.toLineSegment());
            if (t2.equals(i2.orig()) || t2.equals(i2.dest())) break;
            if (t2.rightOf(i2)) i2 = i2.sym();
            else if (t2.rightOf(i2.oNext())) {
              if (t2.rightOf(i2.dPrev())) break;
              i2 = i2.dPrev();
            } else i2 = i2.oNext();
          }
          return i2;
        }
        getTolerance() {
          return this._tolerance;
        }
        getVoronoiCellPolygons(t2) {
          this.visitTriangles(new wo(), true);
          const e2 = new x();
          for (let n2 = this.getVertexUniqueEdges(false).iterator(); n2.hasNext(); ) {
            const s2 = n2.next();
            e2.add(this.getVoronoiCellPolygon(s2, t2));
          }
          return e2;
        }
        getVoronoiDiagram(t2) {
          const e2 = this.getVoronoiCellPolygons(t2);
          return t2.createGeometryCollection(Ht.toGeometryArray(e2));
        }
        getTriangles(t2) {
          const e2 = this.getTriangleCoordinates(false), n2 = new Array(e2.size()).fill(null);
          let s2 = 0;
          for (let i2 = e2.iterator(); i2.hasNext(); ) {
            const e3 = i2.next();
            n2[s2++] = t2.createPolygon(t2.createLinearRing(e3));
          }
          return t2.createGeometryCollection(n2);
        }
        insertSite(t2) {
          let e2 = this.locate(t2);
          if (t2.equals(e2.orig(), this._tolerance) || t2.equals(e2.dest(), this._tolerance)) return e2;
          let n2 = this.makeEdge(e2.orig(), t2);
          yo.splice(n2, e2);
          const s2 = n2;
          do {
            n2 = this.connect(e2, n2.sym()), e2 = n2.oPrev();
          } while (e2.lNext() !== s2);
          return s2;
        }
        locate() {
          if (1 === arguments.length) {
            if (arguments[0] instanceof po) {
              const t2 = arguments[0];
              return this._locator.locate(t2);
            }
            if (arguments[0] instanceof g) {
              const t2 = arguments[0];
              return this._locator.locate(new po(t2));
            }
          } else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = this._locator.locate(new po(t2));
            if (null === n2) return null;
            let s2 = n2;
            n2.dest().getCoordinate().equals2D(t2) && (s2 = n2.sym());
            let i2 = s2;
            do {
              if (i2.dest().getCoordinate().equals2D(e2)) return i2;
              i2 = i2.oNext();
            } while (i2 !== s2);
            return null;
          }
        }
        getClass() {
          return So;
        }
        get interfaces_() {
          return [];
        }
      }
      class wo {
        constructor() {
          wo.constructor_.apply(this, arguments);
        }
        visit(t2) {
          const e2 = t2[0].orig().getCoordinate(), n2 = t2[1].orig().getCoordinate(), s2 = t2[2].orig().getCoordinate(), i2 = re.circumcentre(e2, n2, s2), r2 = new po(i2);
          for (let e3 = 0; e3 < 3; e3++) t2[e3].rot().setOrig(r2);
        }
        getClass() {
          return wo;
        }
        get interfaces_() {
          return [Co];
        }
      }
      wo.constructor_ = function() {
      };
      class Lo {
        constructor() {
          Lo.constructor_.apply(this, arguments);
        }
        getTriangleEdges() {
          return this._triList;
        }
        visit(t2) {
          this._triList.add(t2);
        }
        getClass() {
          return Lo;
        }
        get interfaces_() {
          return [Co];
        }
      }
      Lo.constructor_ = function() {
        this._triList = new x();
      };
      class To {
        constructor() {
          To.constructor_.apply(this, arguments);
        }
        visit(t2) {
          this._triList.add([t2[0].orig(), t2[1].orig(), t2[2].orig()]);
        }
        getTriangleVertices() {
          return this._triList;
        }
        getClass() {
          return To;
        }
        get interfaces_() {
          return [Co];
        }
      }
      To.constructor_ = function() {
        this._triList = new x();
      };
      class Ro {
        constructor() {
          Ro.constructor_.apply(this, arguments);
        }
        checkTriangleSize(t2) {
          let e2 = "";
          t2.length >= 2 ? e2 = Jt.toLineString(t2[0], t2[1]) : t2.length >= 1 && (e2 = Jt.toPoint(t2[0]));
        }
        visit(t2) {
          this._coordList.clear();
          for (let e2 = 0; e2 < 3; e2++) {
            const n2 = t2[e2].orig();
            this._coordList.add(n2.getCoordinate());
          }
          if (this._coordList.size() > 0) {
            this._coordList.closeRing();
            const t3 = this._coordList.toCoordinateArray();
            if (4 !== t3.length) return null;
            this._triCoords.add(t3);
          }
        }
        getTriangles() {
          return this._triCoords;
        }
        getClass() {
          return Ro;
        }
        get interfaces_() {
          return [Co];
        }
      }
      Ro.constructor_ = function() {
        this._coordList = new I(), this._triCoords = new x();
      }, So.TriangleCircumcentreVisitor = wo, So.TriangleEdgesListVisitor = Lo, So.TriangleVertexListVisitor = To, So.TriangleCoordinatesVisitor = Ro, So.constructor_ = function() {
        this._visitedKey = 0, this._quadEdges = new x(), this._startingEdge = null, this._tolerance = null, this._edgeCoincidenceTolerance = null, this._frameVertex = new Array(3).fill(null), this._frameEnv = null, this._locator = null, this._seg = new ee(), this._triEdges = new Array(3).fill(null);
        const t2 = arguments[0], e2 = arguments[1];
        this._tolerance = e2, this._edgeCoincidenceTolerance = e2 / So.EDGE_COINCIDENCE_TOL_FACTOR, this.createFrame(t2), this._startingEdge = this.initSubdiv(), this._locator = new Io(this);
      }, So.EDGE_COINCIDENCE_TOL_FACTOR = 1e3;
      class Po {
        constructor() {
          Po.constructor_.apply(this, arguments);
        }
        getLineSegment() {
          return this._ls;
        }
        getEndZ() {
          return this._ls.getCoordinate(1).z;
        }
        getStartZ() {
          return this._ls.getCoordinate(0).z;
        }
        intersection(t2) {
          return this._ls.intersection(t2.getLineSegment());
        }
        getStart() {
          return this._ls.getCoordinate(0);
        }
        getEnd() {
          return this._ls.getCoordinate(1);
        }
        getEndY() {
          return this._ls.getCoordinate(1).y;
        }
        getStartX() {
          return this._ls.getCoordinate(0).x;
        }
        equalsTopo(t2) {
          return this._ls.equalsTopo(t2.getLineSegment());
        }
        getStartY() {
          return this._ls.getCoordinate(0).y;
        }
        setData(t2) {
          this._data = t2;
        }
        getData() {
          return this._data;
        }
        getEndX() {
          return this._ls.getCoordinate(1).x;
        }
        toString() {
          return this._ls.toString();
        }
        getClass() {
          return Po;
        }
        get interfaces_() {
          return [];
        }
      }
      Po.constructor_ = function() {
        if (this._ls = null, this._data = null, 2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          this._ls = new ee(t2, e2);
        } else if (3 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
          this._ls = new ee(t2, e2), this._data = n2;
        } else if (6 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3], i2 = arguments[4], r2 = arguments[5];
          Po.constructor_.call(this, new g(t2, e2, n2), new g(s2, i2, r2));
        } else if (7 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3], i2 = arguments[4], r2 = arguments[5], o2 = arguments[6];
          Po.constructor_.call(this, new g(t2, e2, n2), new g(s2, i2, r2), o2);
        }
      };
      class vo {
        constructor() {
          vo.constructor_.apply(this, arguments);
        }
        static computeVertexEnvelope(t2) {
          const e2 = new N();
          for (let n2 = t2.iterator(); n2.hasNext(); ) {
            const t3 = n2.next();
            e2.expandToInclude(t3.getCoordinate());
          }
          return e2;
        }
        getInitialVertices() {
          return this._initialVertices;
        }
        getKDT() {
          return this._kdt;
        }
        enforceConstraints() {
          this.addConstraintVertices();
          let t2 = 0, e2 = 0;
          do {
            e2 = this.enforceGabriel(this._segments), t2++;
          } while (e2 > 0 && t2 < vo.MAX_SPLIT_ITER);
        }
        insertSites(t2) {
          for (let e2 = t2.iterator(); e2.hasNext(); ) {
            const t3 = e2.next();
            this.insertSite(t3);
          }
        }
        getVertexFactory() {
          return this._vertexFactory;
        }
        getPointArray() {
          const t2 = new Array(this._initialVertices.size() + this._segVertices.size()).fill(null);
          let e2 = 0;
          for (let n2 = this._initialVertices.iterator(); n2.hasNext(); ) {
            const s2 = n2.next();
            t2[e2++] = s2.getCoordinate();
          }
          for (let n2 = this._segVertices.iterator(); n2.hasNext(); ) {
            const s2 = n2.next();
            t2[e2++] = s2.getCoordinate();
          }
          return t2;
        }
        setConstraints(t2, e2) {
          this._segments = t2, this._segVertices = e2;
        }
        computeConvexHull() {
          const t2 = new Ht(), e2 = this.getPointArray(), n2 = new an(e2, t2);
          this._convexHull = n2.getConvexHull();
        }
        addConstraintVertices() {
          this.computeConvexHull(), this.insertSites(this._segVertices);
        }
        findNonGabrielPoint(t2) {
          const e2 = t2.getStart(), n2 = t2.getEnd(), s2 = new g((e2.x + n2.x) / 2, (e2.y + n2.y) / 2), r2 = e2.distance(s2), o2 = new N(s2);
          o2.expandBy(r2);
          const l2 = this._kdt.query(o2);
          let a2 = null, c2 = i.MAX_VALUE;
          for (let t3 = l2.iterator(); t3.hasNext(); ) {
            const i2 = t3.next().getCoordinate();
            if (i2.equals2D(e2) || i2.equals2D(n2)) continue;
            const o3 = s2.distance(i2);
            if (o3 < r2) {
              const t4 = o3;
              (null === a2 || t4 < c2) && (a2 = i2, c2 = t4);
            }
          }
          return a2;
        }
        getConstraintSegments() {
          return this._segments;
        }
        setSplitPointFinder(t2) {
          this._splitFinder = t2;
        }
        getConvexHull() {
          return this._convexHull;
        }
        getTolerance() {
          return this._tolerance;
        }
        enforceGabriel(t2) {
          const e2 = new x();
          let n2 = 0;
          const s2 = new x();
          for (let i2 = t2.iterator(); i2.hasNext(); ) {
            const t3 = i2.next(), r2 = this.findNonGabrielPoint(t3);
            if (null === r2) continue;
            this._splitPt = this._splitFinder.findSplitPoint(t3, r2);
            const o2 = this.createVertex(this._splitPt, t3);
            this.insertSite(o2).getCoordinate().equals2D(this._splitPt);
            const l2 = new Po(t3.getStartX(), t3.getStartY(), t3.getStartZ(), o2.getX(), o2.getY(), o2.getZ(), t3.getData()), a2 = new Po(o2.getX(), o2.getY(), o2.getZ(), t3.getEndX(), t3.getEndY(), t3.getEndZ(), t3.getData());
            e2.add(l2), e2.add(a2), s2.add(t3), n2 += 1;
          }
          return t2.removeAll(s2), t2.addAll(e2), n2;
        }
        createVertex() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            let e2 = null;
            return e2 = null !== this._vertexFactory ? this._vertexFactory.createVertex(t2, null) : new mo(t2), e2;
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            let n2 = null;
            return n2 = null !== this._vertexFactory ? this._vertexFactory.createVertex(t2, e2) : new mo(t2), n2.setOnConstraint(true), n2;
          }
        }
        getSubdivision() {
          return this._subdiv;
        }
        computeBoundingBox() {
          const t2 = vo.computeVertexEnvelope(this._initialVertices), e2 = vo.computeVertexEnvelope(this._segVertices), n2 = new N(t2);
          n2.expandToInclude(e2);
          const s2 = 0.2 * n2.getWidth(), i2 = 0.2 * n2.getHeight(), r2 = Math.max(s2, i2);
          this._computeAreaEnv = new N(n2), this._computeAreaEnv.expandBy(r2);
        }
        setVertexFactory(t2) {
          this._vertexFactory = t2;
        }
        formInitialDelaunay() {
          this.computeBoundingBox(), this._subdiv = new So(this._computeAreaEnv, this._tolerance), this._subdiv.setLocator(new Io(this._subdiv)), this._incDel = new xo(this._subdiv), this.insertSites(this._initialVertices);
        }
        insertSite() {
          if (arguments[0] instanceof mo) {
            const t2 = arguments[0], e2 = this._kdt.insert(t2.getCoordinate(), t2);
            if (e2.isRepeated()) {
              const n2 = e2.getData();
              return n2.merge(t2), n2;
            }
            return this._incDel.insertSite(t2), t2;
          }
          if (arguments[0] instanceof g) {
            const t2 = arguments[0];
            this.insertSite(this.createVertex(t2));
          }
        }
        getClass() {
          return vo;
        }
        get interfaces_() {
          return [];
        }
      }
      vo.constructor_ = function() {
        this._initialVertices = null, this._segVertices = null, this._segments = new x(), this._subdiv = null, this._incDel = null, this._convexHull = null, this._splitFinder = new _o(), this._kdt = null, this._vertexFactory = null, this._computeAreaEnv = null, this._splitPt = null, this._tolerance = null;
        const t2 = arguments[0], e2 = arguments[1];
        this._initialVertices = new x(t2), this._tolerance = e2, this._kdt = new es(e2);
      }, vo.MAX_SPLIT_ITER = 99;
      class Oo {
        constructor() {
          Oo.constructor_.apply(this, arguments);
        }
        static extractUniqueCoordinates(t2) {
          if (null === t2) return new I();
          const e2 = t2.getCoordinates();
          return Oo.unique(e2);
        }
        static envelope(t2) {
          const e2 = new N();
          for (let n2 = t2.iterator(); n2.hasNext(); ) {
            const t3 = n2.next();
            e2.expandToInclude(t3);
          }
          return e2;
        }
        static unique(t2) {
          const e2 = X.copyDeep(t2);
          return ht.sort(e2), new I(e2, false);
        }
        static toVertices(t2) {
          const e2 = new x();
          for (let n2 = t2.iterator(); n2.hasNext(); ) {
            const t3 = n2.next();
            e2.add(new po(t3));
          }
          return e2;
        }
        create() {
          if (null !== this._subdiv) return null;
          const t2 = Oo.envelope(this._siteCoords), e2 = Oo.toVertices(this._siteCoords);
          this._subdiv = new So(t2, this._tolerance), new xo(this._subdiv).insertSites(e2);
        }
        setTolerance(t2) {
          this._tolerance = t2;
        }
        setSites() {
          if (arguments[0] instanceof q) {
            const t2 = arguments[0];
            this._siteCoords = Oo.extractUniqueCoordinates(t2);
          } else if (_(arguments[0], f)) {
            const t2 = arguments[0];
            this._siteCoords = Oo.unique(X.toCoordinateArray(t2));
          }
        }
        getEdges(t2) {
          return this.create(), this._subdiv.getEdges(t2);
        }
        getSubdivision() {
          return this.create(), this._subdiv;
        }
        getTriangles(t2) {
          return this.create(), this._subdiv.getTriangles(t2);
        }
        getClass() {
          return Oo;
        }
        get interfaces_() {
          return [];
        }
      }
      Oo.constructor_ = function() {
        this._siteCoords = null, this._tolerance = 0, this._subdiv = null;
      };
      class bo {
        constructor() {
          bo.constructor_.apply(this, arguments);
        }
        static createConstraintSegments() {
          if (1 === arguments.length) {
            const t2 = arguments[0], e2 = xe.getLines(t2), n2 = new x();
            for (let t3 = e2.iterator(); t3.hasNext(); ) {
              const e3 = t3.next();
              bo.createConstraintSegments(e3, n2);
            }
            return n2;
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = t2.getCoordinates();
            for (let t3 = 1; t3 < n2.length; t3++) e2.add(new Po(n2[t3 - 1], n2[t3]));
          }
        }
        createSiteVertices(t2) {
          const e2 = new x();
          for (let n2 = t2.iterator(); n2.hasNext(); ) {
            const t3 = n2.next();
            this._constraintVertexMap.containsKey(t3) || e2.add(new mo(t3));
          }
          return e2;
        }
        create() {
          if (null !== this._subdiv) return null;
          const t2 = Oo.envelope(this._siteCoords);
          let e2 = new x();
          null !== this._constraintLines && (t2.expandToInclude(this._constraintLines.getEnvelopeInternal()), this.createVertices(this._constraintLines), e2 = bo.createConstraintSegments(this._constraintLines));
          const n2 = this.createSiteVertices(this._siteCoords), s2 = new vo(n2, this._tolerance);
          s2.setConstraints(e2, new x(this._constraintVertexMap.values())), s2.formInitialDelaunay(), s2.enforceConstraints(), this._subdiv = s2.getSubdivision();
        }
        setTolerance(t2) {
          this._tolerance = t2;
        }
        setConstraints(t2) {
          this._constraintLines = t2;
        }
        setSites(t2) {
          this._siteCoords = Oo.extractUniqueCoordinates(t2);
        }
        getEdges(t2) {
          return this.create(), this._subdiv.getEdges(t2);
        }
        getSubdivision() {
          return this.create(), this._subdiv;
        }
        getTriangles(t2) {
          return this.create(), this._subdiv.getTriangles(t2);
        }
        createVertices(t2) {
          const e2 = t2.getCoordinates();
          for (let t3 = 0; t3 < e2.length; t3++) {
            const n2 = new mo(e2[t3]);
            this._constraintVertexMap.put(e2[t3], n2);
          }
        }
        getClass() {
          return bo;
        }
        get interfaces_() {
          return [];
        }
      }
      bo.constructor_ = function() {
        this._siteCoords = null, this._constraintLines = null, this._tolerance = 0, this._subdiv = null, this._constraintVertexMap = new rt();
      };
      class Mo {
        constructor() {
          Mo.constructor_.apply(this, arguments);
        }
        static clipGeometryCollection(t2, e2) {
          const n2 = t2.getFactory().toGeometry(e2), s2 = new x();
          for (let i2 = 0; i2 < t2.getNumGeometries(); i2++) {
            const r2 = t2.getGeometryN(i2);
            let o2 = null;
            e2.contains(r2.getEnvelopeInternal()) ? o2 = r2 : e2.intersects(r2.getEnvelopeInternal()) && (o2 = n2.intersection(r2), o2.setUserData(r2.getUserData())), null === o2 || o2.isEmpty() || s2.add(o2);
          }
          return t2.getFactory().createGeometryCollection(Ht.toGeometryArray(s2));
        }
        create() {
          if (null !== this._subdiv) return null;
          const t2 = Oo.envelope(this._siteCoords);
          this._diagramEnv = t2;
          const e2 = Math.max(this._diagramEnv.getWidth(), this._diagramEnv.getHeight());
          this._diagramEnv.expandBy(e2), null !== this._clipEnv && this._diagramEnv.expandToInclude(this._clipEnv);
          const n2 = Oo.toVertices(this._siteCoords);
          this._subdiv = new So(t2, this._tolerance), new xo(this._subdiv).insertSites(n2);
        }
        getDiagram(t2) {
          this.create();
          const e2 = this._subdiv.getVoronoiDiagram(t2);
          return Mo.clipGeometryCollection(e2, this._diagramEnv);
        }
        setTolerance(t2) {
          this._tolerance = t2;
        }
        setSites() {
          if (arguments[0] instanceof q) {
            const t2 = arguments[0];
            this._siteCoords = Oo.extractUniqueCoordinates(t2);
          } else if (_(arguments[0], f)) {
            const t2 = arguments[0];
            this._siteCoords = Oo.unique(X.toCoordinateArray(t2));
          }
        }
        setClipEnvelope(t2) {
          this._clipEnv = t2;
        }
        getSubdivision() {
          return this.create(), this._subdiv;
        }
        getClass() {
          return Mo;
        }
        get interfaces_() {
          return [];
        }
      }
      Mo.constructor_ = function() {
        this._siteCoords = null, this._tolerance = 0, this._subdiv = null, this._clipEnv = null, this._diagramEnv = null;
      };
      var Do = Object.freeze({ __proto__: null, Vertex: po }), Ao = Object.freeze({ __proto__: null, ConformingDelaunayTriangulationBuilder: bo, DelaunayTriangulationBuilder: Oo, VoronoiDiagramBuilder: Mo, quadedge: Do });
      class Fo {
        constructor() {
          Fo.constructor_.apply(this, arguments);
        }
        static getEndLocation(t2) {
          const e2 = new Fo();
          return e2.setToEnd(t2), e2;
        }
        static pointAlongSegmentByFraction(t2, e2, n2) {
          if (n2 <= 0) return t2;
          if (n2 >= 1) return e2;
          const s2 = (e2.x - t2.x) * n2 + t2.x, i2 = (e2.y - t2.y) * n2 + t2.y, r2 = (e2.z - t2.z) * n2 + t2.z;
          return new g(s2, i2, r2);
        }
        static compareLocationValues(t2, e2, n2, s2, i2, r2) {
          return t2 < s2 ? -1 : t2 > s2 ? 1 : e2 < i2 ? -1 : e2 > i2 ? 1 : n2 < r2 ? -1 : n2 > r2 ? 1 : 0;
        }
        getSegmentIndex() {
          return this._segmentIndex;
        }
        getComponentIndex() {
          return this._componentIndex;
        }
        isEndpoint(t2) {
          const e2 = t2.getGeometryN(this._componentIndex).getNumPoints() - 1;
          return this._segmentIndex >= e2 || this._segmentIndex === e2 && this._segmentFraction >= 1;
        }
        isValid(t2) {
          if (this._componentIndex < 0 || this._componentIndex >= t2.getNumGeometries()) return false;
          const e2 = t2.getGeometryN(this._componentIndex);
          return !(this._segmentIndex < 0 || this._segmentIndex > e2.getNumPoints()) && ((this._segmentIndex !== e2.getNumPoints() || 0 === this._segmentFraction) && !(this._segmentFraction < 0 || this._segmentFraction > 1));
        }
        normalize() {
          this._segmentFraction < 0 && (this._segmentFraction = 0), this._segmentFraction > 1 && (this._segmentFraction = 1), this._componentIndex < 0 && (this._componentIndex = 0, this._segmentIndex = 0, this._segmentFraction = 0), this._segmentIndex < 0 && (this._segmentIndex = 0, this._segmentFraction = 0), 1 === this._segmentFraction && (this._segmentFraction = 0, this._segmentIndex += 1);
        }
        toLowest(t2) {
          const e2 = t2.getGeometryN(this._componentIndex).getNumPoints() - 1;
          return this._segmentIndex < e2 ? this : new Fo(this._componentIndex, e2, 1, false);
        }
        getCoordinate(t2) {
          const e2 = t2.getGeometryN(this._componentIndex), n2 = e2.getCoordinateN(this._segmentIndex);
          if (this._segmentIndex >= e2.getNumPoints() - 1) return n2;
          const s2 = e2.getCoordinateN(this._segmentIndex + 1);
          return Fo.pointAlongSegmentByFraction(n2, s2, this._segmentFraction);
        }
        getSegmentFraction() {
          return this._segmentFraction;
        }
        getSegment(t2) {
          const e2 = t2.getGeometryN(this._componentIndex), n2 = e2.getCoordinateN(this._segmentIndex);
          if (this._segmentIndex >= e2.getNumPoints() - 1) {
            const t3 = e2.getCoordinateN(e2.getNumPoints() - 2);
            return new ee(t3, n2);
          }
          const s2 = e2.getCoordinateN(this._segmentIndex + 1);
          return new ee(n2, s2);
        }
        clamp(t2) {
          if (this._componentIndex >= t2.getNumGeometries()) return this.setToEnd(t2), null;
          if (this._segmentIndex >= t2.getNumPoints()) {
            const e2 = t2.getGeometryN(this._componentIndex);
            this._segmentIndex = e2.getNumPoints() - 1, this._segmentFraction = 1;
          }
        }
        setToEnd(t2) {
          this._componentIndex = t2.getNumGeometries() - 1;
          const e2 = t2.getGeometryN(this._componentIndex);
          this._segmentIndex = e2.getNumPoints() - 1, this._segmentFraction = 1;
        }
        compareTo(t2) {
          const e2 = t2;
          return this._componentIndex < e2._componentIndex ? -1 : this._componentIndex > e2._componentIndex ? 1 : this._segmentIndex < e2._segmentIndex ? -1 : this._segmentIndex > e2._segmentIndex ? 1 : this._segmentFraction < e2._segmentFraction ? -1 : this._segmentFraction > e2._segmentFraction ? 1 : 0;
        }
        copy() {
          return new Fo(this._componentIndex, this._segmentIndex, this._segmentFraction);
        }
        toString() {
          return "LinearLoc[" + this._componentIndex + ", " + this._segmentIndex + ", " + this._segmentFraction + "]";
        }
        isOnSameSegment(t2) {
          return this._componentIndex === t2._componentIndex && (this._segmentIndex === t2._segmentIndex || (t2._segmentIndex - this._segmentIndex == 1 && 0 === t2._segmentFraction || this._segmentIndex - t2._segmentIndex == 1 && 0 === this._segmentFraction));
        }
        snapToVertex(t2, e2) {
          if (this._segmentFraction <= 0 || this._segmentFraction >= 1) return null;
          const n2 = this.getSegmentLength(t2), s2 = this._segmentFraction * n2, i2 = n2 - s2;
          s2 <= i2 && s2 < e2 ? this._segmentFraction = 0 : i2 <= s2 && i2 < e2 && (this._segmentFraction = 1);
        }
        compareLocationValues(t2, e2, n2) {
          return this._componentIndex < t2 ? -1 : this._componentIndex > t2 ? 1 : this._segmentIndex < e2 ? -1 : this._segmentIndex > e2 ? 1 : this._segmentFraction < n2 ? -1 : this._segmentFraction > n2 ? 1 : 0;
        }
        getSegmentLength(t2) {
          const e2 = t2.getGeometryN(this._componentIndex);
          let n2 = this._segmentIndex;
          this._segmentIndex >= e2.getNumPoints() - 1 && (n2 = e2.getNumPoints() - 2);
          const s2 = e2.getCoordinateN(n2), i2 = e2.getCoordinateN(n2 + 1);
          return s2.distance(i2);
        }
        isVertex() {
          return this._segmentFraction <= 0 || this._segmentFraction >= 1;
        }
        getClass() {
          return Fo;
        }
        get interfaces_() {
          return [r];
        }
      }
      Fo.constructor_ = function() {
        if (this._componentIndex = 0, this._segmentIndex = 0, this._segmentFraction = 0, 0 === arguments.length) ;
        else if (1 === arguments.length) {
          const t2 = arguments[0];
          this._componentIndex = t2._componentIndex, this._segmentIndex = t2._segmentIndex, this._segmentFraction = t2._segmentFraction;
        } else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          Fo.constructor_.call(this, 0, t2, e2);
        } else if (3 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
          this._componentIndex = t2, this._segmentIndex = e2, this._segmentFraction = n2, this.normalize();
        } else if (4 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2], s2 = arguments[3];
          this._componentIndex = t2, this._segmentIndex = e2, this._segmentFraction = n2, s2 && this.normalize();
        }
      };
      class Go {
        constructor() {
          Go.constructor_.apply(this, arguments);
        }
        static segmentEndVertexIndex(t2) {
          return t2.getSegmentFraction() > 0 ? t2.getSegmentIndex() + 1 : t2.getSegmentIndex();
        }
        getComponentIndex() {
          return this._componentIndex;
        }
        getLine() {
          return this._currentLine;
        }
        getVertexIndex() {
          return this._vertexIndex;
        }
        getSegmentEnd() {
          return this._vertexIndex < this.getLine().getNumPoints() - 1 ? this._currentLine.getCoordinateN(this._vertexIndex + 1) : null;
        }
        next() {
          if (!this.hasNext()) return null;
          this._vertexIndex++, this._vertexIndex >= this._currentLine.getNumPoints() && (this._componentIndex++, this.loadCurrentLine(), this._vertexIndex = 0);
        }
        loadCurrentLine() {
          if (this._componentIndex >= this._numLines) return this._currentLine = null, null;
          this._currentLine = this._linearGeom.getGeometryN(this._componentIndex);
        }
        getSegmentStart() {
          return this._currentLine.getCoordinateN(this._vertexIndex);
        }
        isEndOfLine() {
          return !(this._componentIndex >= this._numLines) && !(this._vertexIndex < this._currentLine.getNumPoints() - 1);
        }
        hasNext() {
          return !(this._componentIndex >= this._numLines) && !(this._componentIndex === this._numLines - 1 && this._vertexIndex >= this._currentLine.getNumPoints());
        }
        getClass() {
          return Go;
        }
        get interfaces_() {
          return [];
        }
      }
      Go.constructor_ = function() {
        if (this._linearGeom = null, this._numLines = null, this._currentLine = null, this._componentIndex = 0, this._vertexIndex = 0, 1 === arguments.length) {
          const t2 = arguments[0];
          Go.constructor_.call(this, t2, 0, 0);
        } else if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          Go.constructor_.call(this, t2, e2.getComponentIndex(), Go.segmentEndVertexIndex(e2));
        } else if (3 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], s2 = arguments[2];
          if (!_(t2, ot)) throw new n("Lineal geometry is required");
          this._linearGeom = t2, this._numLines = t2.getNumGeometries(), this._componentIndex = e2, this._vertexIndex = s2, this.loadCurrentLine();
        }
      };
      class qo {
        constructor() {
          qo.constructor_.apply(this, arguments);
        }
        static indexOf(t2, e2) {
          return new qo(t2).indexOf(e2);
        }
        static indexOfAfter(t2, e2, n2) {
          return new qo(t2).indexOfAfter(e2, n2);
        }
        indexOf(t2) {
          return this.indexOfFromStart(t2, null);
        }
        indexOfFromStart(t2, e2) {
          let n2 = i.MAX_VALUE, s2 = 0, r2 = 0, o2 = -1;
          const l2 = new ee();
          for (let i2 = new Go(this._linearGeom); i2.hasNext(); i2.next()) if (!i2.isEndOfLine()) {
            l2.p0 = i2.getSegmentStart(), l2.p1 = i2.getSegmentEnd();
            const a2 = l2.distance(t2), c2 = l2.segmentFraction(t2), h2 = i2.getComponentIndex(), u2 = i2.getVertexIndex();
            a2 < n2 && (null === e2 || e2.compareLocationValues(h2, u2, c2) < 0) && (s2 = h2, r2 = u2, o2 = c2, n2 = a2);
          }
          return n2 === i.MAX_VALUE ? new Fo(e2) : new Fo(s2, r2, o2);
        }
        indexOfAfter(t2, e2) {
          if (null === e2) return this.indexOf(t2);
          const n2 = Fo.getEndLocation(this._linearGeom);
          if (n2.compareTo(e2) <= 0) return n2;
          const s2 = this.indexOfFromStart(t2, e2);
          return u.isTrue(s2.compareTo(e2) >= 0, "computed location is before specified minimum location"), s2;
        }
        getClass() {
          return qo;
        }
        get interfaces_() {
          return [];
        }
      }
      qo.constructor_ = function() {
        this._linearGeom = null;
        const t2 = arguments[0];
        this._linearGeom = t2;
      };
      class Bo {
        constructor() {
          Bo.constructor_.apply(this, arguments);
        }
        static indicesOf(t2, e2) {
          return new Bo(t2).indicesOf(e2);
        }
        indicesOf(t2) {
          const e2 = t2.getGeometryN(0).getCoordinateN(0), n2 = t2.getGeometryN(t2.getNumGeometries() - 1), s2 = n2.getCoordinateN(n2.getNumPoints() - 1), i2 = new qo(this._linearGeom), r2 = new Array(2).fill(null);
          return r2[0] = i2.indexOf(e2), 0 === t2.getLength() ? r2[1] = r2[0].copy() : r2[1] = i2.indexOfAfter(s2, r2[0]), r2;
        }
        getClass() {
          return Bo;
        }
        get interfaces_() {
          return [];
        }
      }
      Bo.constructor_ = function() {
        this._linearGeom = null;
        const t2 = arguments[0];
        this._linearGeom = t2;
      };
      class Vo {
        constructor() {
          Vo.constructor_.apply(this, arguments);
        }
        getGeometry() {
          return this.endLine(), this._geomFact.buildGeometry(this._lines);
        }
        getLastCoordinate() {
          return this._lastPt;
        }
        endLine() {
          if (null === this._coordList) return null;
          if (this._ignoreInvalidLines && this._coordList.size() < 2) return this._coordList = null, null;
          const t2 = this._coordList.toCoordinateArray();
          let e2 = t2;
          this._fixInvalidLines && (e2 = this.validCoordinateSequence(t2)), this._coordList = null;
          let s2 = null;
          try {
            s2 = this._geomFact.createLineString(e2);
          } catch (t3) {
            if (!(t3 instanceof n)) throw t3;
            if (!this._ignoreInvalidLines) throw t3;
          }
          null !== s2 && this._lines.add(s2);
        }
        setFixInvalidLines(t2) {
          this._fixInvalidLines = t2;
        }
        add() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            this.add(t2, true);
          } else if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            null === this._coordList && (this._coordList = new I()), this._coordList.add(t2, e2), this._lastPt = t2;
          }
        }
        setIgnoreInvalidLines(t2) {
          this._ignoreInvalidLines = t2;
        }
        validCoordinateSequence(t2) {
          if (t2.length >= 2) return t2;
          return [t2[0], t2[0]];
        }
        getClass() {
          return Vo;
        }
        get interfaces_() {
          return [];
        }
      }
      Vo.constructor_ = function() {
        this._geomFact = null, this._lines = new x(), this._coordList = null, this._ignoreInvalidLines = false, this._fixInvalidLines = false, this._lastPt = null;
        const t2 = arguments[0];
        this._geomFact = t2;
      };
      class zo {
        constructor() {
          zo.constructor_.apply(this, arguments);
        }
        static extract(t2, e2, n2) {
          return new zo(t2).extract(e2, n2);
        }
        computeLinear(t2, e2) {
          const n2 = new Vo(this._line.getFactory());
          n2.setFixInvalidLines(true), t2.isVertex() || n2.add(t2.getCoordinate(this._line));
          for (let s2 = new Go(this._line, t2); s2.hasNext() && !(e2.compareLocationValues(s2.getComponentIndex(), s2.getVertexIndex(), 0) < 0); s2.next()) {
            const t3 = s2.getSegmentStart();
            n2.add(t3), s2.isEndOfLine() && n2.endLine();
          }
          return e2.isVertex() || n2.add(e2.getCoordinate(this._line)), n2.getGeometry();
        }
        computeLine(t2, e2) {
          const n2 = this._line.getCoordinates(), s2 = new I();
          let i2 = t2.getSegmentIndex();
          t2.getSegmentFraction() > 0 && (i2 += 1);
          let r2 = e2.getSegmentIndex();
          1 === e2.getSegmentFraction() && (r2 += 1), r2 >= n2.length && (r2 = n2.length - 1), t2.isVertex() || s2.add(t2.getCoordinate(this._line));
          for (let t3 = i2; t3 <= r2; t3++) s2.add(n2[t3]);
          e2.isVertex() || s2.add(e2.getCoordinate(this._line)), s2.size() <= 0 && s2.add(t2.getCoordinate(this._line));
          let o2 = s2.toCoordinateArray();
          return o2.length <= 1 && (o2 = [o2[0], o2[0]]), this._line.getFactory().createLineString(o2);
        }
        extract(t2, e2) {
          return e2.compareTo(t2) < 0 ? this.reverse(this.computeLinear(e2, t2)) : this.computeLinear(t2, e2);
        }
        reverse(t2) {
          return t2 instanceof Tt || t2 instanceof ft ? t2.reverse() : (u.shouldNeverReachHere("non-linear geometry encountered"), null);
        }
        getClass() {
          return zo;
        }
        get interfaces_() {
          return [];
        }
      }
      zo.constructor_ = function() {
        this._line = null;
        const t2 = arguments[0];
        this._line = t2;
      };
      class Yo {
        constructor() {
          Yo.constructor_.apply(this, arguments);
        }
        clampIndex(t2) {
          const e2 = t2.copy();
          return e2.clamp(this._linearGeom), e2;
        }
        project(t2) {
          return qo.indexOf(this._linearGeom, t2);
        }
        checkGeometryType() {
          if (!(this._linearGeom instanceof Tt || this._linearGeom instanceof ft)) throw new n("Input geometry must be linear");
        }
        extractPoint() {
          if (1 === arguments.length) {
            return arguments[0].getCoordinate(this._linearGeom);
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = t2.toLowest(this._linearGeom);
            return n2.getSegment(this._linearGeom).pointAlongOffset(n2.getSegmentFraction(), e2);
          }
        }
        isValidIndex(t2) {
          return t2.isValid(this._linearGeom);
        }
        getEndIndex() {
          return Fo.getEndLocation(this._linearGeom);
        }
        getStartIndex() {
          return new Fo();
        }
        indexOfAfter(t2, e2) {
          return qo.indexOfAfter(this._linearGeom, t2, e2);
        }
        extractLine(t2, e2) {
          return zo.extract(this._linearGeom, t2, e2);
        }
        indexOf(t2) {
          return qo.indexOf(this._linearGeom, t2);
        }
        indicesOf(t2) {
          return Bo.indicesOf(this._linearGeom, t2);
        }
        getClass() {
          return Yo;
        }
        get interfaces_() {
          return [];
        }
      }
      Yo.constructor_ = function() {
        this._linearGeom = null;
        const t2 = arguments[0];
        this._linearGeom = t2, this.checkGeometryType();
      };
      class Uo {
        constructor() {
          Uo.constructor_.apply(this, arguments);
        }
        static indexOf(t2, e2) {
          return new Uo(t2).indexOf(e2);
        }
        static indexOfAfter(t2, e2, n2) {
          return new Uo(t2).indexOfAfter(e2, n2);
        }
        indexOf(t2) {
          return this.indexOfFromStart(t2, -1);
        }
        indexOfFromStart(t2, e2) {
          let n2 = i.MAX_VALUE, s2 = e2, r2 = 0;
          const o2 = new ee(), l2 = new Go(this._linearGeom);
          for (; l2.hasNext(); ) {
            if (!l2.isEndOfLine()) {
              o2.p0 = l2.getSegmentStart(), o2.p1 = l2.getSegmentEnd();
              const i2 = o2.distance(t2), a2 = this.segmentNearestMeasure(o2, t2, r2);
              i2 < n2 && a2 > e2 && (s2 = a2, n2 = i2), r2 += o2.getLength();
            }
            l2.next();
          }
          return s2;
        }
        indexOfAfter(t2, e2) {
          if (e2 < 0) return this.indexOf(t2);
          const n2 = this._linearGeom.getLength();
          if (n2 < e2) return n2;
          const s2 = this.indexOfFromStart(t2, e2);
          return u.isTrue(s2 >= e2, "computed index is before specified minimum index"), s2;
        }
        segmentNearestMeasure(t2, e2, n2) {
          const s2 = t2.projectionFactor(e2);
          return s2 <= 0 ? n2 : s2 <= 1 ? n2 + s2 * t2.getLength() : n2 + t2.getLength();
        }
        getClass() {
          return Uo;
        }
        get interfaces_() {
          return [];
        }
      }
      Uo.constructor_ = function() {
        this._linearGeom = null;
        const t2 = arguments[0];
        this._linearGeom = t2;
      };
      class ko {
        constructor() {
          ko.constructor_.apply(this, arguments);
        }
        static getLength(t2, e2) {
          return new ko(t2).getLength(e2);
        }
        static getLocation() {
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return new ko(t2).getLocation(e2);
          }
          if (3 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
            return new ko(t2).getLocation(e2, n2);
          }
        }
        getLength(t2) {
          let e2 = 0;
          const n2 = new Go(this._linearGeom);
          for (; n2.hasNext(); ) {
            if (!n2.isEndOfLine()) {
              const s2 = n2.getSegmentStart(), i2 = n2.getSegmentEnd().distance(s2);
              if (t2.getComponentIndex() === n2.getComponentIndex() && t2.getSegmentIndex() === n2.getVertexIndex()) return e2 + i2 * t2.getSegmentFraction();
              e2 += i2;
            }
            n2.next();
          }
          return e2;
        }
        resolveHigher(t2) {
          if (!t2.isEndpoint(this._linearGeom)) return t2;
          let e2 = t2.getComponentIndex();
          if (e2 >= this._linearGeom.getNumGeometries() - 1) return t2;
          do {
            e2++;
          } while (e2 < this._linearGeom.getNumGeometries() - 1 && 0 === this._linearGeom.getGeometryN(e2).getLength());
          return new Fo(e2, 0, 0);
        }
        getLocation() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return this.getLocation(t2, true);
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            let n2 = t2;
            if (t2 < 0) {
              n2 = this._linearGeom.getLength() + t2;
            }
            const s2 = this.getLocationForward(n2);
            return e2 ? s2 : this.resolveHigher(s2);
          }
        }
        getLocationForward(t2) {
          if (t2 <= 0) return new Fo();
          let e2 = 0;
          const n2 = new Go(this._linearGeom);
          for (; n2.hasNext(); ) {
            if (n2.isEndOfLine()) {
              if (e2 === t2) {
                const t3 = n2.getComponentIndex(), e3 = n2.getVertexIndex();
                return new Fo(t3, e3, 0);
              }
            } else {
              const s2 = n2.getSegmentStart(), i2 = n2.getSegmentEnd().distance(s2);
              if (e2 + i2 > t2) {
                const s3 = (t2 - e2) / i2, r2 = n2.getComponentIndex(), o2 = n2.getVertexIndex();
                return new Fo(r2, o2, s3);
              }
              e2 += i2;
            }
            n2.next();
          }
          return Fo.getEndLocation(this._linearGeom);
        }
        getClass() {
          return ko;
        }
        get interfaces_() {
          return [];
        }
      }
      ko.constructor_ = function() {
        this._linearGeom = null;
        const t2 = arguments[0];
        this._linearGeom = t2;
      };
      class Xo {
        constructor() {
          Xo.constructor_.apply(this, arguments);
        }
        clampIndex(t2) {
          const e2 = this.positiveIndex(t2), n2 = this.getStartIndex();
          if (e2 < n2) return n2;
          const s2 = this.getEndIndex();
          return e2 > s2 ? s2 : e2;
        }
        locationOf() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return ko.getLocation(this._linearGeom, t2);
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1];
            return ko.getLocation(this._linearGeom, t2, e2);
          }
        }
        project(t2) {
          return Uo.indexOf(this._linearGeom, t2);
        }
        positiveIndex(t2) {
          return t2 >= 0 ? t2 : this._linearGeom.getLength() + t2;
        }
        extractPoint() {
          if (1 === arguments.length) {
            const t2 = arguments[0];
            return ko.getLocation(this._linearGeom, t2).getCoordinate(this._linearGeom);
          }
          if (2 === arguments.length) {
            const t2 = arguments[0], e2 = arguments[1], n2 = ko.getLocation(this._linearGeom, t2).toLowest(this._linearGeom);
            return n2.getSegment(this._linearGeom).pointAlongOffset(n2.getSegmentFraction(), e2);
          }
        }
        isValidIndex(t2) {
          return t2 >= this.getStartIndex() && t2 <= this.getEndIndex();
        }
        getEndIndex() {
          return this._linearGeom.getLength();
        }
        getStartIndex() {
          return 0;
        }
        indexOfAfter(t2, e2) {
          return Uo.indexOfAfter(this._linearGeom, t2, e2);
        }
        extractLine(t2, e2) {
          new Yo(this._linearGeom);
          const n2 = this.clampIndex(t2), s2 = this.clampIndex(e2), i2 = n2 === s2, r2 = this.locationOf(n2, i2), o2 = this.locationOf(s2);
          return zo.extract(this._linearGeom, r2, o2);
        }
        indexOf(t2) {
          return Uo.indexOf(this._linearGeom, t2);
        }
        indicesOf(t2) {
          const e2 = Bo.indicesOf(this._linearGeom, t2);
          return [ko.getLength(this._linearGeom, e2[0]), ko.getLength(this._linearGeom, e2[1])];
        }
        getClass() {
          return Xo;
        }
        get interfaces_() {
          return [];
        }
      }
      Xo.constructor_ = function() {
        this._linearGeom = null;
        const t2 = arguments[0];
        this._linearGeom = t2;
      };
      var Ho = Object.freeze({ __proto__: null, LengthIndexedLine: Xo, LengthLocationMap: ko, LinearGeometryBuilder: Vo, LinearIterator: Go, LinearLocation: Fo, LocationIndexedLine: Yo });
      class Wo {
        constructor() {
          Wo.constructor_.apply(this, arguments);
        }
        static transform(t2, e2) {
          const n2 = new x();
          for (let s2 = t2.iterator(); s2.hasNext(); ) n2.add(e2.execute(s2.next()));
          return n2;
        }
        static select(t2, e2) {
          const n2 = new x();
          for (let s2 = t2.iterator(); s2.hasNext(); ) {
            const t3 = s2.next();
            Boolean.TRUE.equals(e2.execute(t3)) && n2.add(t3);
          }
          return n2;
        }
        static apply(t2, e2) {
          for (let n2 = t2.iterator(); n2.hasNext(); ) e2.execute(n2.next());
        }
        getClass() {
          return Wo;
        }
        get interfaces_() {
          return [];
        }
      }
      Wo.Function = function() {
      }, Wo.constructor_ = function() {
      };
      class jo {
        constructor() {
          jo.constructor_.apply(this, arguments);
        }
        filter(t2) {
          this.pts[this.n++] = t2;
        }
        getCoordinates() {
          return this.pts;
        }
        getClass() {
          return jo;
        }
        get interfaces_() {
          return [B];
        }
      }
      jo.constructor_ = function() {
        this.pts = null, this.n = 0;
        const t2 = arguments[0];
        this.pts = new Array(t2).fill(null);
      };
      class Ko {
        constructor() {
          Ko.constructor_.apply(this, arguments);
        }
        filter(t2) {
          this._n++;
        }
        getCount() {
          return this._n;
        }
        getClass() {
          return Ko;
        }
        get interfaces_() {
          return [B];
        }
      }
      Ko.constructor_ = function() {
        this._n = 0;
      };
      class Zo {
        constructor() {
          Zo.constructor_.apply(this, arguments);
        }
        count(t2) {
          const e2 = this._counts.get(t2);
          return null === e2 ? 0 : e2.count();
        }
        add(t2) {
          const e2 = this._counts.get(t2);
          null === e2 ? this._counts.put(t2, new Qo(1)) : e2.increment();
        }
        getClass() {
          return Zo;
        }
        get interfaces_() {
          return [];
        }
      }
      class Qo {
        constructor() {
          Qo.constructor_.apply(this, arguments);
        }
        count() {
          return this.count;
        }
        increment() {
          this.count++;
        }
        getClass() {
          return Qo;
        }
        get interfaces_() {
          return [];
        }
      }
      Qo.constructor_ = function() {
        if (this.count = 0, 0 === arguments.length) ;
        else if (1 === arguments.length) {
          const t2 = arguments[0];
          this.count = t2;
        }
      }, Zo.Counter = Qo, Zo.constructor_ = function() {
        this._counts = new Ut();
      };
      var Jo = Object.freeze({ __proto__: null, CollectionUtil: Wo, CoordinateArrayFilter: jo, CoordinateCountFilter: Ko, GeometricShapeFactory: Se, NumberUtil: e, ObjectCounter: Zo, PriorityQueue: fs, StringUtil: St, UniqueCoordinateArrayFilter: ln });
      class $o {
        get interfaces_() {
          return [];
        }
        getClass() {
          return $o;
        }
        static union(t2, e2) {
          if (t2.isEmpty() || e2.isEmpty()) {
            if (t2.isEmpty() && e2.isEmpty()) return cr.createEmptyResult(cr.UNION, t2, e2, t2.getFactory());
            if (t2.isEmpty()) return e2.copy();
            if (e2.isEmpty()) return t2.copy();
          }
          return t2.checkNotGeometryCollection(t2), t2.checkNotGeometryCollection(e2), lr.overlayOp(t2, e2, cr.UNION);
        }
      }
      q.prototype.equalsTopo = function(t2) {
        return !!this.getEnvelopeInternal().equals(t2.getEnvelopeInternal()) && Gr.relate(this, t2).isEquals(this.getDimension(), t2.getDimension());
      }, q.prototype.union = function() {
        if (0 === arguments.length) return zr.union(this);
        if (1 === arguments.length) {
          const t2 = arguments[0];
          return $o.union(this, t2);
        }
      }, q.prototype.isValid = function() {
        return Cr.isValid(this);
      }, q.prototype.intersection = function(t2) {
        return cr.intersection(this, t2);
      }, q.prototype.covers = function(t2) {
        return Gr.covers(this, t2);
      }, q.prototype.coveredBy = function(t2) {
        return Gr.covers(t2, this);
      }, q.prototype.touches = function(t2) {
        return Gr.touches(this, t2);
      }, q.prototype.intersects = function(t2) {
        return Gr.intersects(this, t2);
      }, q.prototype.within = function(t2) {
        return Gr.contains(t2, this);
      }, q.prototype.overlaps = function(t2) {
        return Gr.overlaps(this, t2);
      }, q.prototype.disjoint = function(t2) {
        return Gr.disjoint(this, t2);
      }, q.prototype.crosses = function(t2) {
        return Gr.crosses(this, t2);
      }, q.prototype.buffer = function() {
        if (1 === arguments.length) {
          const t2 = arguments[0];
          return Si.bufferOp(this, t2);
        }
        if (2 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1];
          return Si.bufferOp(this, t2, e2);
        }
        if (3 === arguments.length) {
          const t2 = arguments[0], e2 = arguments[1], n2 = arguments[2];
          return Si.bufferOp(this, t2, e2, n2);
        }
      }, q.prototype.convexHull = function() {
        return new an(this).getConvexHull();
      }, q.prototype.relate = function(...t2) {
        if (1 === arguments.length) {
          const t3 = arguments[0];
          return Gr.relate(this, t3);
        }
        if (2 === arguments.length) {
          const t3 = arguments[0], e2 = arguments[1];
          return Gr.relate(this, t3).matches(e2);
        }
      }, q.prototype.getCentroid = function() {
        if (this.isEmpty()) return this._factory.createPoint();
        const t2 = sn.getCentroid(this);
        return this.createPointFromInternalCoord(t2, this);
      }, q.prototype.getInteriorPoint = function() {
        if (this.isEmpty()) return this._factory.createPoint();
        let t2 = null;
        const e2 = this.getDimension();
        t2 = 0 === e2 ? new dn(this) : 1 === e2 ? new gn(this) : new hn(this);
        const n2 = t2.getInteriorPoint();
        return this.createPointFromInternalCoord(n2, this);
      }, q.prototype.symDifference = function(t2) {
        return cr.symDifference(this, t2);
      }, q.prototype.createPointFromInternalCoord = function(t2, e2) {
        return e2.getPrecisionModel().makePrecise(t2), e2.getFactory().createPoint(t2);
      }, q.prototype.toText = function() {
        return new Jt().write(this);
      }, q.prototype.toString = function() {
        this.toText();
      }, q.prototype.contains = function(t2) {
        return Gr.contains(this, t2);
      }, q.prototype.difference = function(t2) {
        return cr.difference(this, t2);
      }, q.prototype.isSimple = function() {
        return new Hs(this).isSimple();
      }, q.prototype.isWithinDistance = function(t2, e2) {
        return !(this.getEnvelopeInternal().distance(t2.getEnvelopeInternal()) > e2) && Ri.isWithinDistance(this, t2, e2);
      }, q.prototype.distance = function(t2) {
        return Ri.distance(this, t2);
      }, q.prototype.isEquivalentClass = function(t2) {
        return this.getClass() === t2.getClass();
      };
      t.algorithm = mn, t.densify = En, t.dissolve = Rn, t.geom = Re, t.geomgraph = Jn, t.index = Cs, t.io = Ps, t.linearref = Ho, t.noding = Xs, t.operation = kr, t.precision = Wr, t.simplify = ho, t.triangulate = Ao, t.util = Jo, t.version = "2.1.2 (83b5aee)", Object.defineProperty(t, "__esModule", { value: true });
    });
  }
});

// cjs/impl/polygon_util.js
var require_polygon_util = __commonJS({
  "cjs/impl/polygon_util.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var log = require_loglevel();
    var PolyK = require_polyk();
    var vector_1 = require_vector();
    var jsts = require_jsts_min();
    var PolygonUtil2 = class _PolygonUtil {
      /**
       * Slices rectangle by line, returning smallest polygon
       */
      static sliceRectangle(origin, worldDimensions, p1, p2) {
        const rectangle = [
          origin.x,
          origin.y,
          origin.x + worldDimensions.x,
          origin.y,
          origin.x + worldDimensions.x,
          origin.y + worldDimensions.y,
          origin.x,
          origin.y + worldDimensions.y
        ];
        const sliced = PolyK.Slice(rectangle, p1.x, p1.y, p2.x, p2.y).map((p) => _PolygonUtil.polygonArrayToPolygon(p));
        const minArea = _PolygonUtil.calcPolygonArea(sliced[0]);
        if (sliced.length > 1 && _PolygonUtil.calcPolygonArea(sliced[1]) < minArea) {
          return sliced[1];
        }
        return sliced[0];
      }
      /**
       * Used to create sea polygon
       */
      static lineRectanglePolygonIntersection(origin, worldDimensions, line) {
        const jstsLine = _PolygonUtil.lineToJts(line);
        const bounds = [
          origin,
          new vector_1.default(origin.x + worldDimensions.x, origin.y),
          new vector_1.default(origin.x + worldDimensions.x, origin.y + worldDimensions.y),
          new vector_1.default(origin.x, origin.y + worldDimensions.y)
        ];
        const boundingPoly = _PolygonUtil.polygonToJts(bounds);
        const union = boundingPoly.getExteriorRing().union(jstsLine);
        const polygonizer = new jsts.operation.polygonize.Polygonizer();
        polygonizer.add(union);
        const polygons = polygonizer.getPolygons();
        let smallestArea = Infinity;
        let smallestPoly;
        for (let i = polygons.iterator(); i.hasNext(); ) {
          const polygon = i.next();
          const area = polygon.getArea();
          if (area < smallestArea) {
            smallestArea = area;
            smallestPoly = polygon;
          }
        }
        if (!smallestPoly)
          return [];
        return smallestPoly.getCoordinates().map((c) => new vector_1.default(c.x, c.y));
      }
      static calcPolygonArea(polygon) {
        let total = 0;
        for (let i = 0; i < polygon.length; i++) {
          const addX = polygon[i].x;
          const addY = polygon[i == polygon.length - 1 ? 0 : i + 1].y;
          const subX = polygon[i == polygon.length - 1 ? 0 : i + 1].x;
          const subY = polygon[i].y;
          total += addX * addY * 0.5;
          total -= subX * subY * 0.5;
        }
        return Math.abs(total);
      }
      /**
       * Recursively divide a polygon by its longest side until the minArea stopping condition is met
       */
      static subdividePolygon(p, minArea) {
        const area = _PolygonUtil.calcPolygonArea(p);
        if (area < 0.5 * minArea) {
          return [];
        }
        const divided = [];
        let longestSideLength = 0;
        let longestSide = [p[0], p[1]];
        let perimeter = 0;
        for (let i = 0; i < p.length; i++) {
          const sideLength = p[i].clone().sub(p[(i + 1) % p.length]).length();
          perimeter += sideLength;
          if (sideLength > longestSideLength) {
            longestSideLength = sideLength;
            longestSide = [p[i], p[(i + 1) % p.length]];
          }
        }
        if (area / (perimeter * perimeter) < 0.04) {
          return [];
        }
        if (area < 2 * minArea) {
          return [p];
        }
        const deviation = Math.random() * 0.2 + 0.4;
        const averagePoint = longestSide[0].clone().add(longestSide[1]).multiplyScalar(deviation);
        const differenceVector = longestSide[0].clone().sub(longestSide[1]);
        const perpVector = new vector_1.default(differenceVector.y, -1 * differenceVector.x).normalize().multiplyScalar(100);
        const bisect = [averagePoint.clone().add(perpVector), averagePoint.clone().sub(perpVector)];
        try {
          const sliced = PolyK.Slice(_PolygonUtil.polygonToPolygonArray(p), bisect[0].x, bisect[0].y, bisect[1].x, bisect[1].y);
          for (const s of sliced) {
            divided.push(..._PolygonUtil.subdividePolygon(_PolygonUtil.polygonArrayToPolygon(s), minArea));
          }
          return divided;
        } catch (error) {
          log.error(error);
          return [];
        }
      }
      /**
       * Shrink or expand polygon
       */
      static resizeGeometry(geometry, spacing, isPolygon = true) {
        try {
          const jstsGeometry = isPolygon ? _PolygonUtil.polygonToJts(geometry) : _PolygonUtil.lineToJts(geometry);
          const resized = jstsGeometry.buffer(spacing, void 0, jsts.operation.buffer.BufferParameters.CAP_FLAT);
          if (!resized.isSimple()) {
            return [];
          }
          return resized.getCoordinates().map((c) => new vector_1.default(c.x, c.y));
        } catch (error) {
          log.error(error);
          return [];
        }
      }
      static averagePoint(polygon) {
        if (polygon.length === 0)
          return vector_1.default.zeroVector();
        const sum = vector_1.default.zeroVector();
        for (const v of polygon) {
          sum.add(v);
        }
        return sum.divideScalar(polygon.length);
      }
      static insidePolygon(point, polygon) {
        if (polygon.length === 0) {
          return false;
        }
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
          const xi = polygon[i].x, yi = polygon[i].y;
          const xj = polygon[j].x, yj = polygon[j].y;
          const intersect = yi > point.y != yj > point.y && point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi;
          if (intersect)
            inside = !inside;
        }
        return inside;
      }
      static pointInRectangle(point, origin, dimensions) {
        return point.x >= origin.x && point.y >= origin.y && point.x <= dimensions.x && point.y <= dimensions.y;
      }
      static lineToJts(line) {
        const coords = line.map((v) => new jsts.geom.Coordinate(v.x, v.y));
        return _PolygonUtil.geometryFactory.createLineString(coords);
      }
      static polygonToJts(polygon) {
        const geoInput = polygon.map((v) => new jsts.geom.Coordinate(v.x, v.y));
        geoInput.push(geoInput[0]);
        return _PolygonUtil.geometryFactory.createPolygon(_PolygonUtil.geometryFactory.createLinearRing(geoInput), []);
      }
      /**
       * [ v.x, v.y, v.x, v.y ]...
       */
      static polygonToPolygonArray(p) {
        const outP = [];
        for (const v of p) {
          outP.push(v.x);
          outP.push(v.y);
        }
        return outP;
      }
      /**
       * [ v.x, v.y, v.x, v.y ]...
       */
      static polygonArrayToPolygon(p) {
        const outP = [];
        for (let i = 0; i < p.length / 2; i++) {
          outP.push(new vector_1.default(p[2 * i], p[2 * i + 1]));
        }
        return outP;
      }
    };
    PolygonUtil2.geometryFactory = new jsts.geom.GeometryFactory();
    exports.default = PolygonUtil2;
  }
});

// cjs/impl/tensor_field.js
var require_tensor_field = __commonJS({
  "cjs/impl/tensor_field.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var SimplexNoise = require_simplex_noise();
    var tensor_1 = require_tensor();
    var basis_field_1 = require_basis_field();
    var polygon_util_1 = require_polygon_util();
    var TensorField2 = class {
      constructor(noiseParams) {
        this.noiseParams = noiseParams;
        this.basisFields = [];
        this.parks = [];
        this.sea = [];
        this.river = [];
        this.ignoreRiver = false;
        this.smooth = false;
        this.noise = new SimplexNoise();
      }
      /**
       * Used when integrating coastline and river
       */
      enableGlobalNoise(angle, size) {
        this.noiseParams.globalNoise = true;
        this.noiseParams.noiseAngleGlobal = angle;
        this.noiseParams.noiseSizeGlobal = size;
      }
      disableGlobalNoise() {
        this.noiseParams.globalNoise = false;
      }
      addGrid(centre, size, decay, theta) {
        const grid = new basis_field_1.Grid(centre, size, decay, theta);
        this.addField(grid);
      }
      addRadial(centre, size, decay) {
        const radial = new basis_field_1.Radial(centre, size, decay);
        this.addField(radial);
      }
      addField(field) {
        this.basisFields.push(field);
      }
      removeField(field) {
        const index = this.basisFields.indexOf(field);
        if (index > -1) {
          this.basisFields.splice(index, 1);
        }
      }
      reset() {
        this.basisFields = [];
        this.parks = [];
        this.sea = [];
        this.river = [];
      }
      getCentrePoints() {
        return this.basisFields.map((field) => field.centre);
      }
      getBasisFields() {
        return this.basisFields;
      }
      samplePoint(point) {
        if (!this.onLand(point)) {
          return tensor_1.default.zero;
        }
        if (this.basisFields.length === 0) {
          return new tensor_1.default(1, [0, 0]);
        }
        const tensorAcc = tensor_1.default.zero;
        this.basisFields.forEach((field) => tensorAcc.add(field.getWeightedTensor(point, this.smooth), this.smooth));
        if (this.parks.some((p) => polygon_util_1.default.insidePolygon(point, p))) {
          tensorAcc.rotate(this.getRotationalNoise(point, this.noiseParams.noiseSizePark, this.noiseParams.noiseAnglePark));
        }
        if (this.noiseParams.globalNoise) {
          tensorAcc.rotate(this.getRotationalNoise(point, this.noiseParams.noiseSizeGlobal, this.noiseParams.noiseAngleGlobal));
        }
        return tensorAcc;
      }
      /**
       * Noise Angle is in degrees
       */
      getRotationalNoise(point, noiseSize, noiseAngle) {
        return this.noise.noise2D(point.x / noiseSize, point.y / noiseSize) * noiseAngle * Math.PI / 180;
      }
      onLand(point) {
        const inSea = polygon_util_1.default.insidePolygon(point, this.sea);
        if (this.ignoreRiver) {
          return !inSea;
        }
        return !inSea && !polygon_util_1.default.insidePolygon(point, this.river);
      }
      inParks(point) {
        for (const p of this.parks) {
          if (polygon_util_1.default.insidePolygon(point, p))
            return true;
        }
        return false;
      }
    };
    exports.default = TensorField2;
  }
});

// cjs/impl/integrator.js
var require_integrator = __commonJS({
  "cjs/impl/integrator.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.RK4Integrator = exports.EulerIntegrator = void 0;
    var vector_1 = require_vector();
    var FieldIntegrator2 = class {
      constructor(field) {
        this.field = field;
      }
      sampleFieldVector(point, major) {
        const tensor2 = this.field.samplePoint(point);
        if (major)
          return tensor2.getMajor();
        return tensor2.getMinor();
      }
      onLand(point) {
        return this.field.onLand(point);
      }
    };
    exports.default = FieldIntegrator2;
    var EulerIntegrator2 = class extends FieldIntegrator2 {
      constructor(field, params) {
        super(field);
        this.params = params;
      }
      integrate(point, major) {
        return this.sampleFieldVector(point, major).multiplyScalar(this.params.dstep);
      }
    };
    exports.EulerIntegrator = EulerIntegrator2;
    var RK4Integrator2 = class extends FieldIntegrator2 {
      constructor(field, params) {
        super(field);
        this.params = params;
      }
      integrate(point, major) {
        const k1 = this.sampleFieldVector(point, major);
        const k23 = this.sampleFieldVector(point.clone().add(vector_1.default.fromScalar(this.params.dstep / 2)), major);
        const k4 = this.sampleFieldVector(point.clone().add(vector_1.default.fromScalar(this.params.dstep)), major);
        return k1.add(k23.multiplyScalar(4)).add(k4).multiplyScalar(this.params.dstep / 6);
      }
    };
    exports.RK4Integrator = RK4Integrator2;
  }
});

// node_modules/simplify-js/simplify.js
var require_simplify = __commonJS({
  "node_modules/simplify-js/simplify.js"(exports, module) {
    (function() {
      "use strict";
      function getSqDist(p1, p2) {
        var dx = p1.x - p2.x, dy = p1.y - p2.y;
        return dx * dx + dy * dy;
      }
      function getSqSegDist(p, p1, p2) {
        var x = p1.x, y = p1.y, dx = p2.x - x, dy = p2.y - y;
        if (dx !== 0 || dy !== 0) {
          var t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
          if (t > 1) {
            x = p2.x;
            y = p2.y;
          } else if (t > 0) {
            x += dx * t;
            y += dy * t;
          }
        }
        dx = p.x - x;
        dy = p.y - y;
        return dx * dx + dy * dy;
      }
      function simplifyRadialDist(points, sqTolerance) {
        var prevPoint = points[0], newPoints = [prevPoint], point;
        for (var i = 1, len = points.length; i < len; i++) {
          point = points[i];
          if (getSqDist(point, prevPoint) > sqTolerance) {
            newPoints.push(point);
            prevPoint = point;
          }
        }
        if (prevPoint !== point) newPoints.push(point);
        return newPoints;
      }
      function simplifyDPStep(points, first, last, sqTolerance, simplified) {
        var maxSqDist = sqTolerance, index;
        for (var i = first + 1; i < last; i++) {
          var sqDist = getSqSegDist(points[i], points[first], points[last]);
          if (sqDist > maxSqDist) {
            index = i;
            maxSqDist = sqDist;
          }
        }
        if (maxSqDist > sqTolerance) {
          if (index - first > 1) simplifyDPStep(points, first, index, sqTolerance, simplified);
          simplified.push(points[index]);
          if (last - index > 1) simplifyDPStep(points, index, last, sqTolerance, simplified);
        }
      }
      function simplifyDouglasPeucker(points, sqTolerance) {
        var last = points.length - 1;
        var simplified = [points[0]];
        simplifyDPStep(points, 0, last, sqTolerance, simplified);
        simplified.push(points[last]);
        return simplified;
      }
      function simplify(points, tolerance, highestQuality) {
        if (points.length <= 2) return points;
        var sqTolerance = tolerance !== void 0 ? tolerance * tolerance : 1;
        points = highestQuality ? points : simplifyRadialDist(points, sqTolerance);
        points = simplifyDouglasPeucker(points, sqTolerance);
        return points;
      }
      if (typeof define === "function" && define.amd) define(function() {
        return simplify;
      });
      else if (typeof module !== "undefined") {
        module.exports = simplify;
        module.exports.default = simplify;
      } else if (typeof self !== "undefined") self.simplify = simplify;
      else window.simplify = simplify;
    })();
  }
});

// cjs/impl/grid_storage.js
var require_grid_storage = __commonJS({
  "cjs/impl/grid_storage.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var vector_1 = require_vector();
    var GridStorage2 = class {
      /**
       * worldDimensions assumes origin of 0,0
       * @param {number} dsep Separation distance between samples
       */
      constructor(worldDimensions, origin, dsep) {
        this.worldDimensions = worldDimensions;
        this.origin = origin;
        this.dsep = dsep;
        this.dsepSq = this.dsep * this.dsep;
        this.gridDimensions = worldDimensions.clone().divideScalar(this.dsep);
        this.grid = [];
        for (let x = 0; x < this.gridDimensions.x; x++) {
          this.grid.push([]);
          for (let y = 0; y < this.gridDimensions.y; y++) {
            this.grid[x].push([]);
          }
        }
      }
      /**
       * Add all samples from another grid to this one
       */
      addAll(gridStorage2) {
        for (const row of gridStorage2.grid) {
          for (const cell of row) {
            for (const sample of cell) {
              this.addSample(sample);
            }
          }
        }
      }
      addPolyline(line) {
        for (const v of line) {
          this.addSample(v);
        }
      }
      /**
       * Does not enforce separation
       * Does not clone
       */
      addSample(v, coords) {
        if (!coords) {
          coords = this.getSampleCoords(v);
        }
        this.grid[coords.x][coords.y].push(v);
      }
      /**
       * Tests whether v is at least d away from samples
       * Performance very important - this is called at every integration step
       * @param dSq=this.dsepSq squared test distance
       * Could be dtest if we are integrating a streamline
       */
      isValidSample(v, dSq = this.dsepSq) {
        const coords = this.getSampleCoords(v);
        for (let x = -1; x <= 1; x++) {
          for (let y = -1; y <= 1; y++) {
            const cell = coords.clone().add(new vector_1.default(x, y));
            if (!this.vectorOutOfBounds(cell, this.gridDimensions)) {
              if (!this.vectorFarFromVectors(v, this.grid[cell.x][cell.y], dSq)) {
                return false;
              }
            }
          }
        }
        return true;
      }
      /**
       * Test whether v is at least d away from vectors
       * Performance very important - this is called at every integration step
       * @param {number}   dSq     squared test distance
       */
      vectorFarFromVectors(v, vectors, dSq) {
        for (const sample of vectors) {
          if (sample !== v) {
            const distanceSq = sample.distanceToSquared(v);
            if (distanceSq < dSq) {
              return false;
            }
          }
        }
        return true;
      }
      /**
       * Returns points in cells surrounding v
       * Results include v, if it exists in the grid
       * @param {number} returns samples (kind of) closer than distance - returns all samples in
       * cells so approximation (square to approximate circle)
       */
      getNearbyPoints(v, distance) {
        const radius = Math.ceil(distance / this.dsep - 0.5);
        const coords = this.getSampleCoords(v);
        const out = [];
        for (let x = -1 * radius; x <= 1 * radius; x++) {
          for (let y = -1 * radius; y <= 1 * radius; y++) {
            const cell = coords.clone().add(new vector_1.default(x, y));
            if (!this.vectorOutOfBounds(cell, this.gridDimensions)) {
              for (const v2 of this.grid[cell.x][cell.y]) {
                out.push(v2);
              }
            }
          }
        }
        return out;
      }
      worldToGrid(v) {
        return v.clone().sub(this.origin);
      }
      gridToWorld(v) {
        return v.clone().add(this.origin);
      }
      vectorOutOfBounds(gridV, bounds) {
        return gridV.x < 0 || gridV.y < 0 || gridV.x >= bounds.x || gridV.y >= bounds.y;
      }
      /**
       * @return {Vector}   Cell coords corresponding to vector
       * Performance important - called at every integration step
       */
      getSampleCoords(worldV) {
        const v = this.worldToGrid(worldV);
        if (this.vectorOutOfBounds(v, this.worldDimensions)) {
          return vector_1.default.zeroVector();
        }
        return new vector_1.default(Math.floor(v.x / this.dsep), Math.floor(v.y / this.dsep));
      }
    };
    exports.default = GridStorage2;
  }
});

// cjs/impl/streamlines.js
var require_streamlines = __commonJS({
  "cjs/impl/streamlines.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var log = require_loglevel();
    var simplify = require_simplify();
    var vector_1 = require_vector();
    var grid_storage_1 = require_grid_storage();
    var StreamlineGenerator2 = class {
      /**
       * Uses world-space coordinates
       */
      constructor(integrator2, origin, worldDimensions, params) {
        this.integrator = integrator2;
        this.origin = origin;
        this.worldDimensions = worldDimensions;
        this.params = params;
        this.SEED_AT_ENDPOINTS = false;
        this.NEAR_EDGE = 3;
        this.candidateSeedsMajor = [];
        this.candidateSeedsMinor = [];
        this.streamlinesDone = true;
        this.lastStreamlineMajor = true;
        this.allStreamlines = [];
        this.streamlinesMajor = [];
        this.streamlinesMinor = [];
        this.allStreamlinesSimple = [];
        if (params.dstep > params.dsep) {
          log.error("STREAMLINE SAMPLE DISTANCE BIGGER THAN DSEP");
        }
        params.dtest = Math.min(params.dtest, params.dsep);
        this.dcollideselfSq = (params.dcirclejoin / 2) ** 2;
        this.nStreamlineStep = Math.floor(params.dcirclejoin / params.dstep);
        this.nStreamlineLookBack = 2 * this.nStreamlineStep;
        this.majorGrid = new grid_storage_1.default(this.worldDimensions, this.origin, params.dsep);
        this.minorGrid = new grid_storage_1.default(this.worldDimensions, this.origin, params.dsep);
        this.setParamsSq();
      }
      clearStreamlines() {
        this.allStreamlinesSimple = [];
        this.streamlinesMajor = [];
        this.streamlinesMinor = [];
        this.allStreamlines = [];
      }
      /**
       * Edits streamlines
       */
      joinDanglingStreamlines() {
        for (const major of [true, false]) {
          for (const streamline of this.streamlines(major)) {
            if (streamline[0].equals(streamline[streamline.length - 1])) {
              continue;
            }
            const newStart = this.getBestNextPoint(streamline[0], streamline[4], streamline);
            if (newStart !== null) {
              for (const p of this.pointsBetween(streamline[0], newStart, this.params.dstep)) {
                streamline.unshift(p);
                this.grid(major).addSample(p);
              }
            }
            const newEnd = this.getBestNextPoint(streamline[streamline.length - 1], streamline[streamline.length - 4], streamline);
            if (newEnd !== null) {
              for (const p of this.pointsBetween(streamline[streamline.length - 1], newEnd, this.params.dstep)) {
                streamline.push(p);
                this.grid(major).addSample(p);
              }
            }
          }
        }
        this.allStreamlinesSimple = [];
        for (const s of this.allStreamlines) {
          this.allStreamlinesSimple.push(this.simplifyStreamline(s));
        }
      }
      /**
       * Returns array of points from v1 to v2 such that they are separated by at most dsep
       * not including v1
       */
      pointsBetween(v1, v2, dstep) {
        const d = v1.distanceTo(v2);
        const nPoints = Math.floor(d / dstep);
        if (nPoints === 0)
          return [];
        const stepVector = v2.clone().sub(v1);
        const out = [];
        let i = 1;
        let next = v1.clone().add(stepVector.clone().multiplyScalar(i / nPoints));
        for (i = 1; i <= nPoints; i++) {
          if (this.integrator.integrate(next, true).lengthSq() > 1e-3) {
            out.push(next);
          } else {
            return out;
          }
          next = v1.clone().add(stepVector.clone().multiplyScalar(i / nPoints));
        }
        return out;
      }
      /**
       * Gets next best point to join streamline
       * returns null if there are no good candidates
       */
      getBestNextPoint(point, previousPoint, streamline) {
        const nearbyPoints = this.majorGrid.getNearbyPoints(point, this.params.dlookahead);
        nearbyPoints.push(...this.minorGrid.getNearbyPoints(point, this.params.dlookahead));
        const direction = point.clone().sub(previousPoint);
        let closestSample = null;
        let closestDistance = Infinity;
        for (const sample of nearbyPoints) {
          if (!sample.equals(point) && !sample.equals(previousPoint)) {
            const differenceVector = sample.clone().sub(point);
            if (differenceVector.dot(direction) < 0) {
              continue;
            }
            const distanceToSample = point.distanceToSquared(sample);
            if (distanceToSample < 2 * this.paramsSq.dstep) {
              closestSample = sample;
              break;
            }
            const angleBetween = Math.abs(vector_1.default.angleBetween(direction, differenceVector));
            if (angleBetween < this.params.joinangle && distanceToSample < closestDistance) {
              closestDistance = distanceToSample;
              closestSample = sample;
            }
          }
        }
        if (closestSample !== null) {
          closestSample = closestSample.clone().add(direction.setLength(this.params.simplifyTolerance * 4));
        }
        return closestSample;
      }
      /**
       * Assumes s has already generated
       */
      addExistingStreamlines(s) {
        this.majorGrid.addAll(s.majorGrid);
        this.minorGrid.addAll(s.minorGrid);
      }
      setGrid(s) {
        this.majorGrid = s.majorGrid;
        this.minorGrid = s.minorGrid;
      }
      /**
       * returns true if state updates
       */
      update() {
        if (!this.streamlinesDone) {
          this.lastStreamlineMajor = !this.lastStreamlineMajor;
          if (!this.createStreamline(this.lastStreamlineMajor)) {
            this.streamlinesDone = true;
            this.resolve();
          }
          return true;
        }
        return false;
      }
      /**
       * All at once - will freeze if dsep small
       */
      async createAllStreamlines(animate = false) {
        return new Promise((resolve) => {
          this.resolve = resolve;
          this.streamlinesDone = false;
          if (!animate) {
            let major = true;
            while (this.createStreamline(major)) {
              major = !major;
            }
          }
        }).then(() => this.joinDanglingStreamlines());
      }
      simplifyStreamline(streamline) {
        const simplified = [];
        for (const point of simplify(streamline, this.params.simplifyTolerance)) {
          simplified.push(new vector_1.default(point.x, point.y));
        }
        return simplified;
      }
      /**
       * Finds seed and creates a streamline from that point
       * Pushes new candidate seeds to queue
       * @return {Vector[]} returns false if seed isn't found within params.seedTries
       */
      createStreamline(major) {
        const seed = this.getSeed(major);
        if (seed === null) {
          return false;
        }
        const streamline = this.integrateStreamline(seed, major);
        if (this.validStreamline(streamline)) {
          this.grid(major).addPolyline(streamline);
          this.streamlines(major).push(streamline);
          this.allStreamlines.push(streamline);
          this.allStreamlinesSimple.push(this.simplifyStreamline(streamline));
          if (!streamline[0].equals(streamline[streamline.length - 1])) {
            this.candidateSeeds(!major).push(streamline[0]);
            this.candidateSeeds(!major).push(streamline[streamline.length - 1]);
          }
        }
        return true;
      }
      validStreamline(s) {
        return s.length > 5;
      }
      setParamsSq() {
        this.paramsSq = Object.assign({}, this.params);
        for (const p in this.paramsSq) {
          if (typeof this.paramsSq[p] === "number") {
            this.paramsSq[p] *= this.paramsSq[p];
          }
        }
      }
      samplePoint() {
        return new vector_1.default(Math.random() * this.worldDimensions.x, Math.random() * this.worldDimensions.y).add(this.origin);
      }
      /**
       * Tries this.candidateSeeds first, then samples using this.samplePoint
       */
      getSeed(major) {
        if (this.SEED_AT_ENDPOINTS && this.candidateSeeds(major).length > 0) {
          while (this.candidateSeeds(major).length > 0) {
            const seed2 = this.candidateSeeds(major).pop();
            if (this.isValidSample(major, seed2, this.paramsSq.dsep)) {
              return seed2;
            }
          }
        }
        let seed = this.samplePoint();
        let i = 0;
        while (!this.isValidSample(major, seed, this.paramsSq.dsep)) {
          if (i >= this.params.seedTries) {
            return null;
          }
          seed = this.samplePoint();
          i++;
        }
        return seed;
      }
      isValidSample(major, point, dSq, bothGrids = false) {
        let gridValid = this.grid(major).isValidSample(point, dSq);
        if (bothGrids) {
          gridValid = gridValid && this.grid(!major).isValidSample(point, dSq);
        }
        return this.integrator.onLand(point) && gridValid;
      }
      candidateSeeds(major) {
        return major ? this.candidateSeedsMajor : this.candidateSeedsMinor;
      }
      streamlines(major) {
        return major ? this.streamlinesMajor : this.streamlinesMinor;
      }
      grid(major) {
        return major ? this.majorGrid : this.minorGrid;
      }
      pointInBounds(v) {
        return v.x >= this.origin.x && v.y >= this.origin.y && v.x < this.worldDimensions.x + this.origin.x && v.y < this.worldDimensions.y + this.origin.y;
      }
      /**
       * Didn't end up using - bit expensive, used streamlineTurned instead
       * Stops spirals from forming
       * uses 0.5 dcirclejoin so that circles are still joined up
       * testSample is candidate to pushed on end of streamlineForwards
       * returns true if streamline collides with itself
       */
      doesStreamlineCollideSelf(testSample, streamlineForwards, streamlineBackwards) {
        if (streamlineForwards.length > this.nStreamlineLookBack) {
          for (let i = 0; i < streamlineForwards.length - this.nStreamlineLookBack; i += this.nStreamlineStep) {
            if (testSample.distanceToSquared(streamlineForwards[i]) < this.dcollideselfSq) {
              return true;
            }
          }
          for (let i = 0; i < streamlineBackwards.length; i += this.nStreamlineStep) {
            if (testSample.distanceToSquared(streamlineBackwards[i]) < this.dcollideselfSq) {
              return true;
            }
          }
        }
        return false;
      }
      /**
       * Tests whether streamline has turned through greater than 180 degrees
       */
      streamlineTurned(seed, originalDir, point, direction) {
        if (originalDir.dot(direction) < 0) {
          const perpendicularVector = new vector_1.default(originalDir.y, -originalDir.x);
          const isLeft = point.clone().sub(seed).dot(perpendicularVector) < 0;
          const directionUp = direction.dot(perpendicularVector) > 0;
          return isLeft === directionUp;
        }
        return false;
      }
      /**
       * // TODO this doesn't work well - consider something disallowing one direction (F/B) to turn more than 180 deg
       * One step of the streamline integration process
       */
      streamlineIntegrationStep(params, major, collideBoth) {
        if (params.valid) {
          params.streamline.push(params.previousPoint);
          const nextDirection = this.integrator.integrate(params.previousPoint, major);
          if (nextDirection.lengthSq() < 0.01) {
            params.valid = false;
            return;
          }
          if (nextDirection.dot(params.previousDirection) < 0) {
            nextDirection.negate();
          }
          const nextPoint = params.previousPoint.clone().add(nextDirection);
          if (this.pointInBounds(nextPoint) && this.isValidSample(major, nextPoint, this.paramsSq.dtest, collideBoth) && !this.streamlineTurned(params.seed, params.originalDir, nextPoint, nextDirection)) {
            params.previousPoint = nextPoint;
            params.previousDirection = nextDirection;
          } else {
            params.streamline.push(nextPoint);
            params.valid = false;
          }
        }
      }
      /**
       * By simultaneously integrating in both directions we reduce the impact of circles not joining
       * up as the error matches at the join
       */
      integrateStreamline(seed, major) {
        let count = 0;
        let pointsEscaped = false;
        const collideBoth = Math.random() < this.params.collideEarly;
        const d = this.integrator.integrate(seed, major);
        const forwardParams = {
          seed,
          originalDir: d,
          streamline: [seed],
          previousDirection: d,
          previousPoint: seed.clone().add(d),
          valid: true
        };
        forwardParams.valid = this.pointInBounds(forwardParams.previousPoint);
        const negD = d.clone().negate();
        const backwardParams = {
          seed,
          originalDir: negD,
          streamline: [],
          previousDirection: negD,
          previousPoint: seed.clone().add(negD),
          valid: true
        };
        backwardParams.valid = this.pointInBounds(backwardParams.previousPoint);
        while (count < this.params.pathIterations && (forwardParams.valid || backwardParams.valid)) {
          this.streamlineIntegrationStep(forwardParams, major, collideBoth);
          this.streamlineIntegrationStep(backwardParams, major, collideBoth);
          const sqDistanceBetweenPoints = forwardParams.previousPoint.distanceToSquared(backwardParams.previousPoint);
          if (!pointsEscaped && sqDistanceBetweenPoints > this.paramsSq.dcirclejoin) {
            pointsEscaped = true;
          }
          if (pointsEscaped && sqDistanceBetweenPoints <= this.paramsSq.dcirclejoin) {
            forwardParams.streamline.push(forwardParams.previousPoint);
            forwardParams.streamline.push(backwardParams.previousPoint);
            backwardParams.streamline.push(backwardParams.previousPoint);
            break;
          }
          count++;
        }
        backwardParams.streamline.reverse().push(...forwardParams.streamline);
        return backwardParams.streamline;
      }
    };
    exports.default = StreamlineGenerator2;
  }
});

// cjs/impl/water_generator.js
var require_water_generator = __commonJS({
  "cjs/impl/water_generator.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var log = require_loglevel();
    var streamlines_1 = require_streamlines();
    var polygon_util_1 = require_polygon_util();
    var WaterGenerator2 = class extends streamlines_1.default {
      constructor(integrator2, origin, worldDimensions, params, tensorField2) {
        super(integrator2, origin, worldDimensions, params);
        this.params = params;
        this.tensorField = tensorField2;
        this.TRIES = 100;
        this.coastlineMajor = true;
        this._coastline = [];
        this._seaPolygon = [];
        this._riverPolygon = [];
        this._riverSecondaryRoad = [];
      }
      get coastline() {
        return this._coastline;
      }
      get seaPolygon() {
        return this._seaPolygon;
      }
      get riverPolygon() {
        return this._riverPolygon;
      }
      get riverSecondaryRoad() {
        return this._riverSecondaryRoad;
      }
      createCoast() {
        let coastStreamline;
        let seed;
        let major;
        if (this.params.coastNoise.noiseEnabled) {
          this.tensorField.enableGlobalNoise(this.params.coastNoise.noiseAngle, this.params.coastNoise.noiseSize);
        }
        for (let i = 0; i < this.TRIES; i++) {
          major = Math.random() < 0.5;
          seed = this.getSeed(major);
          coastStreamline = this.extendStreamline(this.integrateStreamline(seed, major));
          if (this.reachesEdges(coastStreamline)) {
            break;
          }
        }
        this.tensorField.disableGlobalNoise();
        this._coastline = coastStreamline;
        this.coastlineMajor = major;
        const road = this.simplifyStreamline(coastStreamline);
        this._seaPolygon = this.getSeaPolygon(road);
        this.allStreamlinesSimple.push(road);
        this.tensorField.sea = this._seaPolygon;
        const complex = this.complexifyStreamline(road);
        this.grid(major).addPolyline(complex);
        this.streamlines(major).push(complex);
        this.allStreamlines.push(complex);
      }
      createRiver() {
        let riverStreamline;
        let seed;
        const oldSea = this.tensorField.sea;
        this.tensorField.sea = [];
        if (this.params.riverNoise.noiseEnabled) {
          this.tensorField.enableGlobalNoise(this.params.riverNoise.noiseAngle, this.params.riverNoise.noiseSize);
        }
        for (let i = 0; i < this.TRIES; i++) {
          seed = this.getSeed(!this.coastlineMajor);
          riverStreamline = this.extendStreamline(this.integrateStreamline(seed, !this.coastlineMajor));
          if (this.reachesEdges(riverStreamline)) {
            break;
          } else if (i === this.TRIES - 1) {
            log.error("Failed to find river reaching edge");
          }
        }
        this.tensorField.sea = oldSea;
        this.tensorField.disableGlobalNoise();
        const expandedNoisy = this.complexifyStreamline(polygon_util_1.default.resizeGeometry(riverStreamline, this.params.riverSize, false));
        this._riverPolygon = polygon_util_1.default.resizeGeometry(riverStreamline, this.params.riverSize - this.params.riverBankSize, false);
        const firstOffScreen = expandedNoisy.findIndex((v) => this.vectorOffScreen(v));
        for (let i = 0; i < firstOffScreen; i++) {
          expandedNoisy.push(expandedNoisy.shift());
        }
        const riverSplitPoly = this.getSeaPolygon(riverStreamline);
        const road1 = expandedNoisy.filter((v) => !polygon_util_1.default.insidePolygon(v, this._seaPolygon) && !this.vectorOffScreen(v) && polygon_util_1.default.insidePolygon(v, riverSplitPoly));
        const road1Simple = this.simplifyStreamline(road1);
        const road2 = expandedNoisy.filter((v) => !polygon_util_1.default.insidePolygon(v, this._seaPolygon) && !this.vectorOffScreen(v) && !polygon_util_1.default.insidePolygon(v, riverSplitPoly));
        const road2Simple = this.simplifyStreamline(road2);
        if (road1.length === 0 || road2.length === 0)
          return;
        if (road1[0].distanceToSquared(road2[0]) < road1[0].distanceToSquared(road2[road2.length - 1])) {
          road2Simple.reverse();
        }
        this.tensorField.river = road1Simple.concat(road2Simple);
        this.allStreamlinesSimple.push(road1Simple);
        this._riverSecondaryRoad = road2Simple;
        this.grid(!this.coastlineMajor).addPolyline(road1);
        this.grid(!this.coastlineMajor).addPolyline(road2);
        this.streamlines(!this.coastlineMajor).push(road1);
        this.streamlines(!this.coastlineMajor).push(road2);
        this.allStreamlines.push(road1);
        this.allStreamlines.push(road2);
      }
      /**
       * Assumes simplified
       * Used for adding river roads
       */
      manuallyAddStreamline(s, major) {
        this.allStreamlinesSimple.push(s);
        const complex = this.complexifyStreamline(s);
        this.grid(major).addPolyline(complex);
        this.streamlines(major).push(complex);
        this.allStreamlines.push(complex);
      }
      /**
       * Might reverse input array
       */
      getSeaPolygon(polyline) {
        return polygon_util_1.default.lineRectanglePolygonIntersection(this.origin, this.worldDimensions, polyline);
      }
      /**
       * Insert samples in streamline until separated by dstep
       */
      complexifyStreamline(s) {
        const out = [];
        for (let i = 0; i < s.length - 1; i++) {
          out.push(...this.complexifyStreamlineRecursive(s[i], s[i + 1]));
        }
        return out;
      }
      complexifyStreamlineRecursive(v1, v2) {
        if (v1.distanceToSquared(v2) <= this.paramsSq.dstep) {
          return [v1, v2];
        }
        const d = v2.clone().sub(v1);
        const halfway = v1.clone().add(d.multiplyScalar(0.5));
        const complex = this.complexifyStreamlineRecursive(v1, halfway);
        complex.push(...this.complexifyStreamlineRecursive(halfway, v2));
        return complex;
      }
      /**
       * Mutates streamline
       */
      extendStreamline(streamline) {
        streamline.unshift(streamline[0].clone().add(streamline[0].clone().sub(streamline[1]).setLength(this.params.dstep * 5)));
        streamline.push(streamline[streamline.length - 1].clone().add(streamline[streamline.length - 1].clone().sub(streamline[streamline.length - 2]).setLength(this.params.dstep * 5)));
        return streamline;
      }
      reachesEdges(streamline) {
        return this.vectorOffScreen(streamline[0]) && this.vectorOffScreen(streamline[streamline.length - 1]);
      }
      vectorOffScreen(v) {
        const toOrigin = v.clone().sub(this.origin);
        return toOrigin.x <= 0 || toOrigin.y <= 0 || toOrigin.x >= this.worldDimensions.x || toOrigin.y >= this.worldDimensions.y;
      }
    };
    exports.default = WaterGenerator2;
  }
});

// node_modules/isect/build/isect.js
var require_isect = __commonJS({
  "node_modules/isect/build/isect.js"(exports, module) {
    /*!
     * isect v3.0.0
     * (c) 2018 Andrei Kashcha.
     * Released under the MIT License.
     */
    (function(global, factory) {
      typeof exports === "object" && typeof module !== "undefined" ? factory(exports) : typeof define === "function" && define.amd ? define(["exports"], factory) : factory(global.isect = {});
    })(exports, function(exports2) {
      "use strict";
      var Node2 = function Node3(key, data) {
        this.key = key;
        this.data = data;
        this.left = null;
        this.right = null;
      };
      function DEFAULT_COMPARE(a, b) {
        return a > b ? 1 : a < b ? -1 : 0;
      }
      function splay(i, t, comparator) {
        if (t === null) {
          return t;
        }
        var l, r, y;
        var N = new Node2();
        l = r = N;
        while (true) {
          var cmp = comparator(i, t.key);
          if (cmp < 0) {
            if (t.left === null) {
              break;
            }
            if (comparator(i, t.left.key) < 0) {
              y = t.left;
              t.left = y.right;
              y.right = t;
              t = y;
              if (t.left === null) {
                break;
              }
            }
            r.left = t;
            r = t;
            t = t.left;
          } else if (cmp > 0) {
            if (t.right === null) {
              break;
            }
            if (comparator(i, t.right.key) > 0) {
              y = t.right;
              t.right = y.left;
              y.left = t;
              t = y;
              if (t.right === null) {
                break;
              }
            }
            l.right = t;
            l = t;
            t = t.right;
          } else {
            break;
          }
        }
        l.right = t.left;
        r.left = t.right;
        t.left = N.right;
        t.right = N.left;
        return t;
      }
      function insert(i, data, t, comparator, tree) {
        var node = new Node2(i, data);
        tree._size++;
        if (t === null) {
          node.left = node.right = null;
          return node;
        }
        t = splay(i, t, comparator);
        var cmp = comparator(i, t.key);
        if (cmp < 0) {
          node.left = t.left;
          node.right = t;
          t.left = null;
        } else if (cmp >= 0) {
          node.right = t.right;
          node.left = t;
          t.right = null;
        }
        return node;
      }
      function add2(i, data, t, comparator, tree) {
        var node = new Node2(i, data);
        if (t === null) {
          node.left = node.right = null;
          tree._size++;
          return node;
        }
        t = splay(i, t, comparator);
        var cmp = comparator(i, t.key);
        if (cmp === 0) {
          return t;
        } else {
          if (cmp < 0) {
            node.left = t.left;
            node.right = t;
            t.left = null;
          } else if (cmp > 0) {
            node.right = t.right;
            node.left = t;
            t.right = null;
          }
          tree._size++;
          return node;
        }
      }
      function remove(i, t, comparator, tree) {
        var x;
        if (t === null) {
          return null;
        }
        t = splay(i, t, comparator);
        var cmp = comparator(i, t.key);
        if (cmp === 0) {
          if (t.left === null) {
            x = t.right;
          } else {
            x = splay(i, t.left, comparator);
            x.right = t.right;
          }
          tree._size--;
          return x;
        }
        return t;
      }
      function split(key, v, comparator) {
        var left, right;
        if (v === null) {
          left = right = null;
        } else {
          v = splay(key, v, comparator);
          var cmp = comparator(v.key, key);
          if (cmp === 0) {
            left = v.left;
            right = v.right;
          } else if (cmp < 0) {
            right = v.right;
            v.right = null;
            left = v;
          } else {
            left = v.left;
            v.left = null;
            right = v;
          }
        }
        return { left, right };
      }
      function merge(left, right, comparator) {
        if (right === null) {
          return left;
        }
        if (left === null) {
          return right;
        }
        right = splay(left.key, right, comparator);
        right.left = left;
        return right;
      }
      function printRow(root, prefix, isTail, out, printNode) {
        if (root) {
          out("" + prefix + (isTail ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ") + printNode(root) + "\n");
          var indent = prefix + (isTail ? "    " : "\u2502   ");
          if (root.left) {
            printRow(root.left, indent, false, out, printNode);
          }
          if (root.right) {
            printRow(root.right, indent, true, out, printNode);
          }
        }
      }
      var Tree = function Tree2(comparator) {
        if (comparator === void 0) comparator = DEFAULT_COMPARE;
        this._comparator = comparator;
        this._root = null;
        this._size = 0;
      };
      var prototypeAccessors = { size: { configurable: true } };
      Tree.prototype.insert = function insert$1(key, data) {
        return this._root = insert(key, data, this._root, this._comparator, this);
      };
      Tree.prototype.add = function add$1(key, data) {
        return this._root = add2(key, data, this._root, this._comparator, this);
      };
      Tree.prototype.remove = function remove$1(key) {
        this._root = remove(key, this._root, this._comparator, this);
      };
      Tree.prototype.pop = function pop() {
        var node = this._root;
        if (node) {
          while (node.left) {
            node = node.left;
          }
          this._root = splay(node.key, this._root, this._comparator);
          this._root = remove(node.key, this._root, this._comparator, this);
          return { key: node.key, data: node.data };
        }
        return null;
      };
      Tree.prototype.findStatic = function findStatic(key) {
        var current = this._root;
        var compare = this._comparator;
        while (current) {
          var cmp = compare(key, current.key);
          if (cmp === 0) {
            return current;
          } else if (cmp < 0) {
            current = current.left;
          } else {
            current = current.right;
          }
        }
        return null;
      };
      Tree.prototype.find = function find(key) {
        if (this._root) {
          this._root = splay(key, this._root, this._comparator);
          if (this._comparator(key, this._root.key) !== 0) {
            return null;
          }
        }
        return this._root;
      };
      Tree.prototype.contains = function contains(key) {
        var current = this._root;
        var compare = this._comparator;
        while (current) {
          var cmp = compare(key, current.key);
          if (cmp === 0) {
            return true;
          } else if (cmp < 0) {
            current = current.left;
          } else {
            current = current.right;
          }
        }
        return false;
      };
      Tree.prototype.forEach = function forEach(visitor, ctx) {
        var current = this._root;
        var Q = [];
        var done = false;
        while (!done) {
          if (current !== null) {
            Q.push(current);
            current = current.left;
          } else {
            if (Q.length !== 0) {
              current = Q.pop();
              visitor.call(ctx, current);
              current = current.right;
            } else {
              done = true;
            }
          }
        }
        return this;
      };
      Tree.prototype.range = function range(low, high, fn, ctx) {
        var this$1 = this;
        var Q = [];
        var compare = this._comparator;
        var node = this._root, cmp;
        while (Q.length !== 0 || node) {
          if (node) {
            Q.push(node);
            node = node.left;
          } else {
            node = Q.pop();
            cmp = compare(node.key, high);
            if (cmp > 0) {
              break;
            } else if (compare(node.key, low) >= 0) {
              if (fn.call(ctx, node)) {
                return this$1;
              }
            }
            node = node.right;
          }
        }
        return this;
      };
      Tree.prototype.keys = function keys() {
        var keys2 = [];
        this.forEach(function(ref) {
          var key = ref.key;
          return keys2.push(key);
        });
        return keys2;
      };
      Tree.prototype.values = function values() {
        var values2 = [];
        this.forEach(function(ref) {
          var data = ref.data;
          return values2.push(data);
        });
        return values2;
      };
      Tree.prototype.min = function min() {
        if (this._root) {
          return this.minNode(this._root).key;
        }
        return null;
      };
      Tree.prototype.max = function max() {
        if (this._root) {
          return this.maxNode(this._root).key;
        }
        return null;
      };
      Tree.prototype.minNode = function minNode(t) {
        if (t === void 0) t = this._root;
        if (t) {
          while (t.left) {
            t = t.left;
          }
        }
        return t;
      };
      Tree.prototype.maxNode = function maxNode(t) {
        if (t === void 0) t = this._root;
        if (t) {
          while (t.right) {
            t = t.right;
          }
        }
        return t;
      };
      Tree.prototype.at = function at(index) {
        var current = this._root, done = false, i = 0;
        var Q = [];
        while (!done) {
          if (current) {
            Q.push(current);
            current = current.left;
          } else {
            if (Q.length > 0) {
              current = Q.pop();
              if (i === index) {
                return current;
              }
              i++;
              current = current.right;
            } else {
              done = true;
            }
          }
        }
        return null;
      };
      Tree.prototype.next = function next(d) {
        var root = this._root;
        var successor = null;
        if (d.right) {
          successor = d.right;
          while (successor.left) {
            successor = successor.left;
          }
          return successor;
        }
        var comparator = this._comparator;
        while (root) {
          var cmp = comparator(d.key, root.key);
          if (cmp === 0) {
            break;
          } else if (cmp < 0) {
            successor = root;
            root = root.left;
          } else {
            root = root.right;
          }
        }
        return successor;
      };
      Tree.prototype.prev = function prev(d) {
        var root = this._root;
        var predecessor = null;
        if (d.left !== null) {
          predecessor = d.left;
          while (predecessor.right) {
            predecessor = predecessor.right;
          }
          return predecessor;
        }
        var comparator = this._comparator;
        while (root) {
          var cmp = comparator(d.key, root.key);
          if (cmp === 0) {
            break;
          } else if (cmp < 0) {
            root = root.left;
          } else {
            predecessor = root;
            root = root.right;
          }
        }
        return predecessor;
      };
      Tree.prototype.clear = function clear() {
        this._root = null;
        this._size = 0;
        return this;
      };
      Tree.prototype.toList = function toList$1() {
        return toList(this._root);
      };
      Tree.prototype.load = function load(keys, values, presort) {
        if (keys === void 0) keys = [];
        if (values === void 0) values = [];
        if (presort === void 0) presort = false;
        var size = keys.length;
        var comparator = this._comparator;
        if (presort) {
          sort(keys, values, 0, size - 1, comparator);
        }
        if (this._root === null) {
          this._root = loadRecursive(this._root, keys, values, 0, size);
          this._size = size;
        } else {
          var mergedList = mergeLists(this.toList(), createList(keys, values), comparator);
          size = this._size + size;
          this._root = sortedListToBST({ head: mergedList }, 0, size);
        }
        return this;
      };
      Tree.prototype.isEmpty = function isEmpty() {
        return this._root === null;
      };
      prototypeAccessors.size.get = function() {
        return this._size;
      };
      Tree.prototype.toString = function toString(printNode) {
        if (printNode === void 0) printNode = function(n) {
          return n.key;
        };
        var out = [];
        printRow(this._root, "", true, function(v) {
          return out.push(v);
        }, printNode);
        return out.join("");
      };
      Tree.prototype.update = function update(key, newKey, newData) {
        var comparator = this._comparator;
        var ref = split(key, this._root, comparator);
        var left = ref.left;
        var right = ref.right;
        this._size--;
        if (comparator(key, newKey) < 0) {
          right = insert(newKey, newData, right, comparator, this);
        } else {
          left = insert(newKey, newData, left, comparator, this);
        }
        this._root = merge(left, right, comparator);
      };
      Tree.prototype.split = function split$1(key) {
        return split(key, this._root, this._comparator);
      };
      Object.defineProperties(Tree.prototype, prototypeAccessors);
      function loadRecursive(parent, keys, values, start, end) {
        var size = end - start;
        if (size > 0) {
          var middle = start + Math.floor(size / 2);
          var key = keys[middle];
          var data = values[middle];
          var node = { key, data, parent };
          node.left = loadRecursive(node, keys, values, start, middle);
          node.right = loadRecursive(node, keys, values, middle + 1, end);
          return node;
        }
        return null;
      }
      function createList(keys, values) {
        var head = { next: null };
        var p = head;
        for (var i = 0; i < keys.length; i++) {
          p = p.next = { key: keys[i], data: values[i] };
        }
        p.next = null;
        return head.next;
      }
      function toList(root) {
        var current = root;
        var Q = [], done = false;
        var head = { next: null };
        var p = head;
        while (!done) {
          if (current) {
            Q.push(current);
            current = current.left;
          } else {
            if (Q.length > 0) {
              current = p = p.next = Q.pop();
              current = current.right;
            } else {
              done = true;
            }
          }
        }
        p.next = null;
        return head.next;
      }
      function sortedListToBST(list, start, end) {
        var size = end - start;
        if (size > 0) {
          var middle = start + Math.floor(size / 2);
          var left = sortedListToBST(list, start, middle);
          var root = list.head;
          root.left = left;
          list.head = list.head.next;
          root.right = sortedListToBST(list, middle + 1, end);
          return root;
        }
        return null;
      }
      function mergeLists(l1, l2, compare) {
        if (compare === void 0) compare = function(a, b) {
          return a - b;
        };
        var head = {};
        var p = head;
        var p1 = l1;
        var p2 = l2;
        while (p1 !== null && p2 !== null) {
          if (compare(p1.key, p2.key) < 0) {
            p.next = p1;
            p1 = p1.next;
          } else {
            p.next = p2;
            p2 = p2.next;
          }
          p = p.next;
        }
        if (p1 !== null) {
          p.next = p1;
        } else if (p2 !== null) {
          p.next = p2;
        }
        return head.next;
      }
      function sort(keys, values, left, right, compare) {
        if (left >= right) {
          return;
        }
        var pivot = keys[left + right >> 1];
        var i = left - 1;
        var j = right + 1;
        while (true) {
          do {
            i++;
          } while (compare(keys[i], pivot) < 0);
          do {
            j--;
          } while (compare(keys[j], pivot) > 0);
          if (i >= j) {
            break;
          }
          var tmp = keys[i];
          keys[i] = keys[j];
          keys[j] = tmp;
          tmp = values[i];
          values[i] = values[j];
          values[j] = tmp;
        }
        sort(keys, values, left, j, compare);
        sort(keys, values, j + 1, right, compare);
      }
      function createEventQueue(byY2) {
        var q = new Tree(byY2);
        return {
          isEmpty,
          size,
          pop,
          find,
          insert: insert2
        };
        function find(p) {
          return q.find(p);
        }
        function size() {
          return q.size;
        }
        function isEmpty() {
          return q.isEmpty();
        }
        function insert2(event) {
          q.add(event.point, event);
        }
        function pop() {
          var node = q.pop();
          return node && node.data;
        }
      }
      var EPS = 1e-9;
      function getIntersectionXPoint(segment, xPos, yPos) {
        var dy1 = segment.from.y - yPos;
        var dy2 = yPos - segment.to.y;
        var dy = segment.to.y - segment.from.y;
        if (Math.abs(dy1) < EPS) {
          if (Math.abs(dy) < EPS) {
            if (xPos <= segment.from.x) {
              return segment.from.x;
            }
            if (xPos > segment.to.x) {
              return segment.to.x;
            }
            return xPos;
          }
          return segment.from.x;
        }
        var dx = segment.to.x - segment.from.x;
        var xOffset;
        if (dy1 >= dy2) {
          xOffset = dy1 * (dx / dy);
          return segment.from.x - xOffset;
        }
        xOffset = dy2 * (dx / dy);
        return segment.to.x + xOffset;
      }
      function angle(dx, dy) {
        var p = dx / (Math.abs(dx) + Math.abs(dy));
        if (dy < 0) {
          return p - 1;
        }
        return 1 - p;
      }
      function intersectSegments(a, b) {
        var aStart = a.from, bStart = b.from;
        var p0_x = aStart.x, p0_y = aStart.y, p2_x = bStart.x, p2_y = bStart.y;
        var s1_x = a.dx, s1_y = a.dy, s2_x = b.dx, s2_y = b.dy;
        var div = s1_x * s2_y - s2_x * s1_y;
        var s = (s1_y * (p0_x - p2_x) - s1_x * (p0_y - p2_y)) / div;
        if (s < 0 || s > 1) {
          return;
        }
        var t = (s2_x * (p2_y - p0_y) + s2_y * (p0_x - p2_x)) / div;
        if (t >= 0 && t <= 1) {
          return {
            x: p0_x - t * s1_x,
            y: p0_y - t * s1_y
          };
        }
      }
      function samePoint(a, b) {
        return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
      }
      function createSweepStatus(onError, EPS$$1) {
        var lastPointY, prevY;
        var lastPointX, prevX;
        var useBelow = false;
        var status = new Tree(compareSegments);
        var currentBoundary = {
          beforeLeft: null,
          left: null,
          right: null,
          afterRight: null
        };
        var currentLeftRight = { left: null, right: null };
        return {
          /**
           * Add new segments into the status tree.
           */
          insertSegments,
          /**
           * Remove segments from the status tree.
           */
          deleteSegments,
          /**
           * Returns segments that are to the left and right from a given point.
           */
          getLeftRightPoint,
          /**
           * For a given collections of segments finds the most left and the most right
           * segments. Also returns segments immediately before left, and after right segments.
           */
          getBoundarySegments,
          findSegmentsWithPoint,
          /**
           * Current binary search tree with segments
           */
          status,
          /**
           * Introspection method that verifies if there are duplicates in the segment tree.
           * If there are - `onError()` is called.
           */
          checkDuplicate,
          /**
           * Prints current segments in order of their intersection with sweep line. Introspection method.
           */
          printStatus,
          /**
           * Returns current position of the sweep line.
           */
          getLastPoint: function getLastPoint() {
            return { x: lastPointX, y: lastPointY };
          }
        };
        function compareSegments(a, b) {
          if (a === b) {
            return 0;
          }
          var ak = getIntersectionXPoint(a, lastPointX, lastPointY);
          var bk = getIntersectionXPoint(b, lastPointX, lastPointY);
          var res = ak - bk;
          if (Math.abs(res) >= EPS$$1) {
            return res;
          }
          var aIsHorizontal = Math.abs(a.dy) < EPS$$1;
          var bIsHorizontal = Math.abs(b.dy) < EPS$$1;
          if (aIsHorizontal && bIsHorizontal) {
            return b.to.x - a.to.x;
          }
          if (aIsHorizontal) {
            return useBelow ? -1 : 1;
          }
          if (bIsHorizontal) {
            if (useBelow) {
              return b.from.x >= lastPointX ? -1 : 1;
            }
            return -1;
          }
          var pa = a.angle;
          var pb = b.angle;
          if (Math.abs(pa - pb) >= EPS$$1) {
            return useBelow ? pa - pb : pb - pa;
          }
          var segDist = a.from.y - b.from.y;
          if (Math.abs(segDist) >= EPS$$1) {
            return -segDist;
          }
          segDist = a.to.y - b.to.y;
          if (Math.abs(segDist) >= EPS$$1) {
            return -segDist;
          }
          return 0;
        }
        function getBoundarySegments(upper, interior) {
          var leftMost, rightMost, i;
          var uLength = upper.length;
          if (uLength > 0) {
            leftMost = rightMost = upper[0];
          } else {
            leftMost = rightMost = interior[0];
          }
          for (i = 1; i < uLength; ++i) {
            var s = upper[i];
            var cmp = compareSegments(leftMost, s);
            if (cmp > 0) {
              leftMost = s;
            }
            cmp = compareSegments(rightMost, s);
            if (cmp < 0) {
              rightMost = s;
            }
          }
          var startFrom = uLength > 0 ? 0 : 1;
          for (i = startFrom; i < interior.length; ++i) {
            s = interior[i];
            cmp = compareSegments(leftMost, s);
            if (cmp > 0) {
              leftMost = s;
            }
            cmp = compareSegments(rightMost, s);
            if (cmp < 0) {
              rightMost = s;
            }
          }
          var left = status.find(leftMost);
          if (!left) {
            onError("Left is missing. Precision error?");
          }
          var right = status.find(rightMost);
          if (!right) {
            onError("Right is missing. Precision error?");
          }
          var beforeLeft = left && status.prev(left);
          var afterRight = right && status.next(right);
          while (afterRight && right.key.dy === 0 && afterRight.key.dy === 0) {
            afterRight = status.next(afterRight);
          }
          currentBoundary.beforeLeft = beforeLeft && beforeLeft.key;
          currentBoundary.left = left && left.key;
          currentBoundary.right = right && right.key;
          currentBoundary.afterRight = afterRight && afterRight.key;
          return currentBoundary;
        }
        function getLeftRightPoint(p) {
          var lastLeft;
          var current = status._root;
          var minX = Number.POSITIVE_INFINITY;
          while (current) {
            var x = getIntersectionXPoint(current.key, p.x, p.y);
            var dx = p.x - x;
            if (dx >= 0) {
              if (dx < minX) {
                minX = dx;
                lastLeft = current;
                current = current.left;
              } else {
                break;
              }
            } else {
              if (-dx < minX) {
                minX = -dx;
                lastLeft = current;
                current = current.right;
              } else {
                break;
              }
            }
          }
          currentLeftRight.left = lastLeft && lastLeft.key;
          var next = lastLeft && status.next(lastLeft);
          currentLeftRight.right = next && next.key;
          return currentLeftRight;
        }
        function findSegmentsWithPoint(p, onFound) {
          var current = status._root;
          while (current) {
            var x = getIntersectionXPoint(current.key, p.x, p.y);
            var dx = p.x - x;
            if (Math.abs(dx) < EPS$$1) {
              collectAdjacentNodes(current, p, onFound);
              break;
            } else if (dx < 0) {
              current = current.left;
            } else {
              current = current.right;
            }
          }
        }
        function collectAdjacentNodes(root, p, onFound) {
          onFound(root.key);
          goOverPredecessors(root.left, p, onFound);
          goOverSuccessors(root.right, p, onFound);
        }
        function goOverPredecessors(root, p, res) {
          if (!root) {
            return;
          }
          var x = getIntersectionXPoint(root.key, p.x, p.y);
          var dx = p.x - x;
          if (Math.abs(dx) < EPS$$1) {
            collectAdjacentNodes(root, p, res);
          } else {
            goOverPredecessors(root.right, p, res);
          }
        }
        function goOverSuccessors(root, p, res) {
          if (!root) {
            return;
          }
          var x = getIntersectionXPoint(root.key, p.x, p.y);
          var dx = p.x - x;
          if (Math.abs(dx) < EPS$$1) {
            collectAdjacentNodes(root, p, res);
          } else {
            goOverSuccessors(root.left, p, res);
          }
        }
        function checkDuplicate() {
          var prev;
          status.forEach(function(node) {
            var current = node.key;
            if (prev) {
              if (samePoint(prev.from, current.from) && samePoint(prev.to, current.to)) {
                onError("Duplicate key in the status! This may be caused by Floating Point rounding error");
              }
            }
            prev = current;
          });
        }
        function printStatus(prefix) {
          if (prefix === void 0) prefix = "";
          console.log(prefix, "status line: ", lastPointX, lastPointY);
          status.forEach(function(node) {
            var x = getIntersectionXPoint(node.key, lastPointX, lastPointY);
            console.log(x + " " + node.key.name);
          });
        }
        function insertSegments(interior, upper, sweepLinePos) {
          lastPointY = sweepLinePos.y;
          lastPointX = sweepLinePos.x;
          var key;
          for (var i = 0; i < interior.length; ++i) {
            key = interior[i];
            status.add(key);
          }
          for (i = 0; i < upper.length; ++i) {
            key = upper[i];
            status.add(key);
          }
        }
        function deleteSegments(lower, interior, sweepLinePos) {
          var i;
          var prevCount = status._size;
          prevX = lastPointX;
          prevY = lastPointY;
          lastPointY = sweepLinePos.y;
          lastPointX = sweepLinePos.x;
          useBelow = true;
          for (i = 0; i < lower.length; ++i) {
            removeSegment(lower[i], sweepLinePos);
          }
          for (i = 0; i < interior.length; ++i) {
            removeSegment(interior[i], sweepLinePos);
          }
          useBelow = false;
          if (status._size !== prevCount - interior.length - lower.length) {
            onError("Segments were not removed from a tree properly. Precision error?");
          }
        }
        function removeSegment(key, sweepLinePos) {
          if (status.find(key)) {
            status.remove(key);
          } else {
            lastPointX = prevX;
            lastPointY = prevY;
            if (status.find(key)) {
              status.remove(key);
            }
            lastPointY = sweepLinePos.y;
            lastPointX = sweepLinePos.x;
          }
        }
      }
      var SweepEvent = function SweepEvent2(point, segment) {
        this.point = point;
        if (segment) {
          this.from = [segment];
        }
      };
      var EMPTY = [];
      function isect(segments, options) {
        var results = [];
        var reportIntersection = options && options.onFound || defaultIntersectionReporter;
        var onError = options && options.onError || defaultErrorReporter;
        var eventQueue = createEventQueue(byY);
        var sweepStatus = createSweepStatus(onError, EPS);
        var lower, interior, lastPoint;
        segments.forEach(addSegment);
        return {
          /**
           * Find all intersections synchronously.
           * 
           * @returns array of found intersections.
           */
          run,
          /**
           * Performs a single step in the sweep line algorithm
           * 
           * @returns true if there was something to process; False if no more work to do
           */
          step,
          // Methods below are low level API for fine-grained control.
          // Don't use it unless you understand this code thoroughly
          /**
           * Add segment into the 
           */
          addSegment,
          /**
           * Direct access to event queue. Queue contains segment endpoints and
           * pending detected intersections.
           */
          eventQueue,
          /**
           * Direct access to sweep line status. "Status" holds information about
           * all intersected segments.
           */
          sweepStatus,
          /**
           * Access to results array. Works only when you use default onFound() handler
           */
          results
        };
        function run() {
          while (!eventQueue.isEmpty()) {
            var eventPoint = eventQueue.pop();
            if (handleEventPoint(eventPoint)) {
              return;
            }
          }
          return results;
        }
        function step() {
          if (!eventQueue.isEmpty()) {
            var eventPoint = eventQueue.pop();
            handleEventPoint(eventPoint);
            return true;
          }
          return false;
        }
        function handleEventPoint(p) {
          lastPoint = p.point;
          var upper = p.from || EMPTY;
          lower = interior = void 0;
          sweepStatus.findSegmentsWithPoint(lastPoint, addLowerOrInterior);
          if (!lower) {
            lower = EMPTY;
          }
          if (!interior) {
            interior = EMPTY;
          }
          var uLength = upper.length;
          var iLength = interior.length;
          var lLength = lower.length;
          var hasIntersection = uLength + iLength + lLength > 1;
          var hasPointIntersection = !hasIntersection && (uLength === 0 && lLength === 0 && iLength > 0);
          if (hasIntersection || hasPointIntersection) {
            p.isReported = true;
            if (reportIntersection(lastPoint, union(interior, union(lower, upper)))) {
              return true;
            }
          }
          sweepStatus.deleteSegments(lower, interior, lastPoint);
          sweepStatus.insertSegments(interior, upper, lastPoint);
          var sLeft, sRight;
          var hasNoCrossing = uLength + iLength === 0;
          if (hasNoCrossing) {
            var leftRight = sweepStatus.getLeftRightPoint(lastPoint);
            sLeft = leftRight.left;
            if (!sLeft) {
              return;
            }
            sRight = leftRight.right;
            if (!sRight) {
              return;
            }
            findNewEvent(sLeft, sRight, p);
          } else {
            var boundarySegments = sweepStatus.getBoundarySegments(upper, interior);
            findNewEvent(boundarySegments.beforeLeft, boundarySegments.left, p);
            findNewEvent(boundarySegments.right, boundarySegments.afterRight, p);
          }
          return false;
        }
        function addLowerOrInterior(s) {
          if (samePoint(s.to, lastPoint)) {
            if (!lower) {
              lower = [s];
            } else {
              lower.push(s);
            }
          } else if (!samePoint(s.from, lastPoint)) {
            if (!interior) {
              interior = [s];
            } else {
              interior.push(s);
            }
          }
        }
        function findNewEvent(left, right, p) {
          if (!left || !right) {
            return;
          }
          var intersection = intersectSegments(left, right);
          if (!intersection) {
            return;
          }
          var dy = p.point.y - intersection.y;
          if (dy < -EPS) {
            return;
          }
          if (Math.abs(dy) < EPS && intersection.x <= p.point.x) {
            return;
          }
          roundNearZero(intersection);
          var current = eventQueue.find(intersection);
          if (current && current.isReported) {
            onError("We already reported this event.");
            return;
          }
          if (!current) {
            var event = new SweepEvent(intersection);
            eventQueue.insert(event);
          }
        }
        function defaultIntersectionReporter(p, segments2) {
          results.push({
            point: p,
            segments: segments2
          });
        }
        function addSegment(segment) {
          var from = segment.from;
          var to = segment.to;
          roundNearZero(from);
          roundNearZero(to);
          var dy = from.y - to.y;
          if (Math.abs(dy) < 1e-5) {
            from.y = to.y;
            segment.dy = 0;
          }
          if (from.y < to.y || from.y === to.y && from.x > to.x) {
            var temp = from;
            from = segment.from = to;
            to = segment.to = temp;
          }
          segment.dy = from.y - to.y;
          segment.dx = from.x - to.x;
          segment.angle = angle(segment.dy, segment.dx);
          var isPoint = segment.dy === segment.dx && segment.dy === 0;
          var prev = eventQueue.find(from);
          if (prev && !isPoint) {
            var prevFrom = prev.data.from;
            if (prevFrom) {
              for (var i = 0; i < prevFrom.length; ++i) {
                var s = prevFrom[i];
                if (samePoint(s.to, to)) {
                  reportIntersection(s.from, [s.from, s.to]);
                  reportIntersection(s.to, [s.from, s.to]);
                  return;
                }
              }
            }
          }
          if (!isPoint) {
            if (prev) {
              if (prev.data.from) {
                prev.data.from.push(segment);
              } else {
                prev.data.from = [segment];
              }
            } else {
              var e = new SweepEvent(from, segment);
              eventQueue.insert(e);
            }
            var event = new SweepEvent(to);
            eventQueue.insert(event);
          } else {
            var event = new SweepEvent(to);
            eventQueue.insert(event);
          }
        }
      }
      function roundNearZero(point) {
        if (Math.abs(point.x) < EPS) {
          point.x = 0;
        }
        if (Math.abs(point.y) < EPS) {
          point.y = 0;
        }
      }
      function defaultErrorReporter(errorMessage) {
        throw new Error(errorMessage);
      }
      function union(a, b) {
        if (!a) {
          return b;
        }
        if (!b) {
          return a;
        }
        return a.concat(b);
      }
      function byY(a, b) {
        var res = b.y - a.y;
        if (Math.abs(res) < EPS) {
          res = a.x - b.x;
          if (Math.abs(res) < EPS) {
            res = 0;
          }
        }
        return res;
      }
      function intersectSegments$1(a, b) {
        var aStart = a.from, bStart = b.from;
        var p0_x = aStart.x, p0_y = aStart.y, p2_x = bStart.x, p2_y = bStart.y;
        var s1_x = a.from.x - a.to.x, s1_y = a.from.y - a.to.y, s2_x = b.from.x - b.to.x, s2_y = b.from.y - b.to.y;
        var div = s1_x * s2_y - s2_x * s1_y;
        var s = (s1_y * (p0_x - p2_x) - s1_x * (p0_y - p2_y)) / div;
        if (s < 0 || s > 1) {
          return;
        }
        var t = (s2_x * (p2_y - p0_y) + s2_y * (p0_x - p2_x)) / div;
        if (t >= 0 && t <= 1) {
          return {
            x: p0_x - t * s1_x,
            y: p0_y - t * s1_y
          };
        }
      }
      function brute(lines, options) {
        var results = [];
        var reportIntersection = options && options.onFound || defaultIntersectionReporter;
        var asyncState;
        return {
          /**
           * Execute brute force of the segment intersection search
           */
          run,
          /**
           * Access to results array. Works only when you use default onFound() handler
           */
          results,
          /**
           * Performs a single step in the brute force algorithm ()
           */
          step
        };
        function step() {
          if (!asyncState) {
            asyncState = {
              i: 0
            };
          }
          var test = lines[asyncState.i];
          for (var j = asyncState.i + 1; j < lines.length; ++j) {
            var other = lines[j];
            var pt = intersectSegments$1(test, other);
            if (pt) {
              if (reportIntersection(pt, [test, other])) {
                return;
              }
            }
          }
          asyncState.i += 1;
          return asyncState.i < lines.length;
        }
        function run() {
          for (var i = 0; i < lines.length; ++i) {
            var test = lines[i];
            for (var j = i + 1; j < lines.length; ++j) {
              var other = lines[j];
              var pt = intersectSegments$1(test, other);
              if (pt) {
                if (reportIntersection(pt, [test, other])) {
                  return;
                }
              }
            }
          }
          return results;
        }
        function defaultIntersectionReporter(p, interior) {
          results.push({
            point: p,
            segments: interior
          });
        }
      }
      var ARRAY_TYPES = [
        Int8Array,
        Uint8Array,
        Uint8ClampedArray,
        Int16Array,
        Uint16Array,
        Int32Array,
        Uint32Array,
        Float32Array,
        Float64Array
      ];
      var VERSION = 3;
      var Flatbush = function Flatbush2(numItems, nodeSize, ArrayType, data) {
        var this$1 = this;
        if (numItems === void 0) {
          throw new Error("Missing required argument: numItems.");
        }
        if (isNaN(numItems) || numItems <= 0) {
          throw new Error("Unpexpected numItems value: " + numItems + ".");
        }
        this.numItems = +numItems;
        this.nodeSize = Math.min(Math.max(+nodeSize || 16, 2), 65535);
        var n = numItems;
        var numNodes = n;
        this._levelBounds = [n * 4];
        do {
          n = Math.ceil(n / this$1.nodeSize);
          numNodes += n;
          this$1._levelBounds.push(numNodes * 4);
        } while (n !== 1);
        this.ArrayType = ArrayType || Float64Array;
        this.IndexArrayType = numNodes < 16384 ? Uint16Array : Uint32Array;
        var arrayTypeIndex = ARRAY_TYPES.indexOf(this.ArrayType);
        var nodesByteSize = numNodes * 4 * this.ArrayType.BYTES_PER_ELEMENT;
        if (arrayTypeIndex < 0) {
          throw new Error("Unexpected typed array class: " + ArrayType + ".");
        }
        if (data && data instanceof ArrayBuffer) {
          this.data = data;
          this._boxes = new this.ArrayType(this.data, 8, numNodes * 4);
          this._indices = new this.IndexArrayType(this.data, 8 + nodesByteSize, numNodes);
          this._pos = numNodes * 4;
          this.minX = this._boxes[this._pos - 4];
          this.minY = this._boxes[this._pos - 3];
          this.maxX = this._boxes[this._pos - 2];
          this.maxY = this._boxes[this._pos - 1];
        } else {
          this.data = new ArrayBuffer(8 + nodesByteSize + numNodes * this.IndexArrayType.BYTES_PER_ELEMENT);
          this._boxes = new this.ArrayType(this.data, 8, numNodes * 4);
          this._indices = new this.IndexArrayType(this.data, 8 + nodesByteSize, numNodes);
          this._pos = 0;
          this.minX = Infinity;
          this.minY = Infinity;
          this.maxX = -Infinity;
          this.maxY = -Infinity;
          new Uint8Array(this.data, 0, 2).set([251, (VERSION << 4) + arrayTypeIndex]);
          new Uint16Array(this.data, 2, 1)[0] = nodeSize;
          new Uint32Array(this.data, 4, 1)[0] = numItems;
        }
      };
      Flatbush.from = function from(data) {
        if (!(data instanceof ArrayBuffer)) {
          throw new Error("Data must be an instance of ArrayBuffer.");
        }
        var ref = new Uint8Array(data, 0, 2);
        var magic = ref[0];
        var versionAndType = ref[1];
        if (magic !== 251) {
          throw new Error("Data does not appear to be in a Flatbush format.");
        }
        if (versionAndType >> 4 !== VERSION) {
          throw new Error("Got v" + (versionAndType >> 4) + " data when expected v" + VERSION + ".");
        }
        var ref$1 = new Uint16Array(data, 2, 1);
        var nodeSize = ref$1[0];
        var ref$2 = new Uint32Array(data, 4, 1);
        var numItems = ref$2[0];
        return new Flatbush(numItems, nodeSize, ARRAY_TYPES[versionAndType & 15], data);
      };
      Flatbush.prototype.add = function add3(minX, minY, maxX, maxY) {
        var index = this._pos >> 2;
        this._indices[index] = index;
        this._boxes[this._pos++] = minX;
        this._boxes[this._pos++] = minY;
        this._boxes[this._pos++] = maxX;
        this._boxes[this._pos++] = maxY;
        if (minX < this.minX) {
          this.minX = minX;
        }
        if (minY < this.minY) {
          this.minY = minY;
        }
        if (maxX > this.maxX) {
          this.maxX = maxX;
        }
        if (maxY > this.maxY) {
          this.maxY = maxY;
        }
      };
      Flatbush.prototype.finish = function finish() {
        var this$1 = this;
        if (this._pos >> 2 !== this.numItems) {
          throw new Error("Added " + (this._pos >> 2) + " items when expected " + this.numItems + ".");
        }
        var width = this.maxX - this.minX;
        var height = this.maxY - this.minY;
        var hilbertValues = new Uint32Array(this.numItems);
        var hilbertMax = (1 << 16) - 1;
        for (var i = 0; i < this.numItems; i++) {
          var pos = 4 * i;
          var minX = this$1._boxes[pos++];
          var minY = this$1._boxes[pos++];
          var maxX = this$1._boxes[pos++];
          var maxY = this$1._boxes[pos++];
          var x = Math.floor(hilbertMax * ((minX + maxX) / 2 - this$1.minX) / width);
          var y = Math.floor(hilbertMax * ((minY + maxY) / 2 - this$1.minY) / height);
          hilbertValues[i] = hilbert(x, y);
        }
        sort$1(hilbertValues, this._boxes, this._indices, 0, this.numItems - 1);
        for (var i$1 = 0, pos$1 = 0; i$1 < this._levelBounds.length - 1; i$1++) {
          var end = this$1._levelBounds[i$1];
          while (pos$1 < end) {
            var nodeMinX = Infinity;
            var nodeMinY = Infinity;
            var nodeMaxX = -Infinity;
            var nodeMaxY = -Infinity;
            var nodeIndex = pos$1;
            for (var i$2 = 0; i$2 < this.nodeSize && pos$1 < end; i$2++) {
              var minX$1 = this$1._boxes[pos$1++];
              var minY$1 = this$1._boxes[pos$1++];
              var maxX$1 = this$1._boxes[pos$1++];
              var maxY$1 = this$1._boxes[pos$1++];
              if (minX$1 < nodeMinX) {
                nodeMinX = minX$1;
              }
              if (minY$1 < nodeMinY) {
                nodeMinY = minY$1;
              }
              if (maxX$1 > nodeMaxX) {
                nodeMaxX = maxX$1;
              }
              if (maxY$1 > nodeMaxY) {
                nodeMaxY = maxY$1;
              }
            }
            this$1._indices[this$1._pos >> 2] = nodeIndex;
            this$1._boxes[this$1._pos++] = nodeMinX;
            this$1._boxes[this$1._pos++] = nodeMinY;
            this$1._boxes[this$1._pos++] = nodeMaxX;
            this$1._boxes[this$1._pos++] = nodeMaxY;
          }
        }
      };
      Flatbush.prototype.search = function search(minX, minY, maxX, maxY, filterFn) {
        var this$1 = this;
        if (this._pos !== this._boxes.length) {
          throw new Error("Data not yet indexed - call index.finish().");
        }
        var nodeIndex = this._boxes.length - 4;
        var level = this._levelBounds.length - 1;
        var queue = [];
        var results = [];
        while (nodeIndex !== void 0) {
          var end = Math.min(nodeIndex + this$1.nodeSize * 4, this$1._levelBounds[level]);
          for (var pos = nodeIndex; pos < end; pos += 4) {
            var index = this$1._indices[pos >> 2];
            if (maxX < this$1._boxes[pos]) {
              continue;
            }
            if (maxY < this$1._boxes[pos + 1]) {
              continue;
            }
            if (minX > this$1._boxes[pos + 2]) {
              continue;
            }
            if (minY > this$1._boxes[pos + 3]) {
              continue;
            }
            if (nodeIndex < this$1.numItems * 4) {
              if (filterFn === void 0 || filterFn(index)) {
                results.push(index);
              }
            } else {
              queue.push(index);
              queue.push(level - 1);
            }
          }
          level = queue.pop();
          nodeIndex = queue.pop();
        }
        return results;
      };
      function sort$1(values, boxes, indices, left, right) {
        if (left >= right) {
          return;
        }
        var pivot = values[left + right >> 1];
        var i = left - 1;
        var j = right + 1;
        while (true) {
          do {
            i++;
          } while (values[i] < pivot);
          do {
            j--;
          } while (values[j] > pivot);
          if (i >= j) {
            break;
          }
          swap(values, boxes, indices, i, j);
        }
        sort$1(values, boxes, indices, left, j);
        sort$1(values, boxes, indices, j + 1, right);
      }
      function swap(values, boxes, indices, i, j) {
        var temp = values[i];
        values[i] = values[j];
        values[j] = temp;
        var k = 4 * i;
        var m = 4 * j;
        var a = boxes[k];
        var b = boxes[k + 1];
        var c = boxes[k + 2];
        var d = boxes[k + 3];
        boxes[k] = boxes[m];
        boxes[k + 1] = boxes[m + 1];
        boxes[k + 2] = boxes[m + 2];
        boxes[k + 3] = boxes[m + 3];
        boxes[m] = a;
        boxes[m + 1] = b;
        boxes[m + 2] = c;
        boxes[m + 3] = d;
        var e = indices[i];
        indices[i] = indices[j];
        indices[j] = e;
      }
      function hilbert(x, y) {
        var a = x ^ y;
        var b = 65535 ^ a;
        var c = 65535 ^ (x | y);
        var d = x & (y ^ 65535);
        var A = a | b >> 1;
        var B = a >> 1 ^ a;
        var C = c >> 1 ^ b & d >> 1 ^ c;
        var D = a & c >> 1 ^ d >> 1 ^ d;
        a = A;
        b = B;
        c = C;
        d = D;
        A = a & a >> 2 ^ b & b >> 2;
        B = a & b >> 2 ^ b & (a ^ b) >> 2;
        C ^= a & c >> 2 ^ b & d >> 2;
        D ^= b & c >> 2 ^ (a ^ b) & d >> 2;
        a = A;
        b = B;
        c = C;
        d = D;
        A = a & a >> 4 ^ b & b >> 4;
        B = a & b >> 4 ^ b & (a ^ b) >> 4;
        C ^= a & c >> 4 ^ b & d >> 4;
        D ^= b & c >> 4 ^ (a ^ b) & d >> 4;
        a = A;
        b = B;
        c = C;
        d = D;
        C ^= a & c >> 8 ^ b & d >> 8;
        D ^= b & c >> 8 ^ (a ^ b) & d >> 8;
        a = C ^ C >> 1;
        b = D ^ D >> 1;
        var i0 = x ^ y;
        var i1 = b | 65535 ^ (i0 | a);
        i0 = (i0 | i0 << 8) & 16711935;
        i0 = (i0 | i0 << 4) & 252645135;
        i0 = (i0 | i0 << 2) & 858993459;
        i0 = (i0 | i0 << 1) & 1431655765;
        i1 = (i1 | i1 << 8) & 16711935;
        i1 = (i1 | i1 << 4) & 252645135;
        i1 = (i1 | i1 << 2) & 858993459;
        i1 = (i1 | i1 << 1) & 1431655765;
        return (i1 << 1 | i0) >>> 0;
      }
      function bush(lines, options) {
        var results = [];
        var reportIntersection = options && options.onFound || defaultIntersectionReporter;
        var asyncState;
        var index = new Flatbush(lines.length);
        lines.forEach(addToIndex);
        index.finish();
        return {
          run,
          step,
          results,
          // undocumented, don't use unless you know what you are doing:
          checkIntersection
        };
        function run() {
          for (var i = 0; i < lines.length; ++i) {
            if (checkIntersection(lines[i], i)) {
              return;
            }
          }
          return results;
        }
        function checkIntersection(currentSegment, currentId) {
          var minX = currentSegment.from.x;
          var maxX = currentSegment.to.x;
          var minY = currentSegment.from.y;
          var maxY = currentSegment.to.y;
          var t;
          if (minX > maxX) {
            t = minX;
            minX = maxX;
            maxX = t;
          }
          if (minY > maxY) {
            t = minY;
            minY = maxY;
            maxY = t;
          }
          var ids = index.search(minX, minY, maxX, maxY);
          for (var i = 0; i < ids.length; ++i) {
            var segmentIndex = ids[i];
            if (segmentIndex <= currentId) {
              continue;
            }
            var otherSegment = lines[segmentIndex];
            var point = intersectSegments$1(otherSegment, currentSegment);
            if (point) {
              if (reportIntersection(point, [currentSegment, otherSegment])) {
                return true;
              }
            }
          }
        }
        function step() {
          if (!asyncState) {
            asyncState = { i: 0 };
          }
          var test = lines[asyncState.i];
          checkIntersection(test, asyncState.i);
          asyncState.i += 1;
          return asyncState.i < lines.length;
        }
        function addToIndex(line) {
          var minX = line.from.x;
          var maxX = line.to.x;
          var minY = line.from.y;
          var maxY = line.to.y;
          var t;
          if (minX > maxX) {
            t = minX;
            minX = maxX;
            maxX = t;
          }
          if (minY > maxY) {
            t = minY;
            minY = maxY;
            maxY = t;
          }
          index.add(minX, minY, maxX, maxY);
        }
        function defaultIntersectionReporter(p, interior) {
          results.push({
            point: p,
            segments: interior
          });
        }
      }
      exports2.sweep = isect;
      exports2.brute = brute;
      exports2.bush = bush;
      Object.defineProperty(exports2, "__esModule", { value: true });
    });
  }
});

// node_modules/d3-quadtree/src/add.js
function add_default(d) {
  var x = +this._x.call(null, d), y = +this._y.call(null, d);
  return add(this.cover(x, y), x, y, d);
}
function add(tree, x, y, d) {
  if (isNaN(x) || isNaN(y)) return tree;
  var parent, node = tree._root, leaf = { data: d }, x0 = tree._x0, y0 = tree._y0, x1 = tree._x1, y1 = tree._y1, xm, ym, xp, yp, right, bottom, i, j;
  if (!node) return tree._root = leaf, tree;
  while (node.length) {
    if (right = x >= (xm = (x0 + x1) / 2)) x0 = xm;
    else x1 = xm;
    if (bottom = y >= (ym = (y0 + y1) / 2)) y0 = ym;
    else y1 = ym;
    if (parent = node, !(node = node[i = bottom << 1 | right])) return parent[i] = leaf, tree;
  }
  xp = +tree._x.call(null, node.data);
  yp = +tree._y.call(null, node.data);
  if (x === xp && y === yp) return leaf.next = node, parent ? parent[i] = leaf : tree._root = leaf, tree;
  do {
    parent = parent ? parent[i] = new Array(4) : tree._root = new Array(4);
    if (right = x >= (xm = (x0 + x1) / 2)) x0 = xm;
    else x1 = xm;
    if (bottom = y >= (ym = (y0 + y1) / 2)) y0 = ym;
    else y1 = ym;
  } while ((i = bottom << 1 | right) === (j = (yp >= ym) << 1 | xp >= xm));
  return parent[j] = node, parent[i] = leaf, tree;
}
function addAll(data) {
  var d, i, n = data.length, x, y, xz = new Array(n), yz = new Array(n), x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (i = 0; i < n; ++i) {
    if (isNaN(x = +this._x.call(null, d = data[i])) || isNaN(y = +this._y.call(null, d))) continue;
    xz[i] = x;
    yz[i] = y;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x0 > x1 || y0 > y1) return this;
  this.cover(x0, y0).cover(x1, y1);
  for (i = 0; i < n; ++i) {
    add(this, xz[i], yz[i], data[i]);
  }
  return this;
}
var init_add = __esm({
  "node_modules/d3-quadtree/src/add.js"() {
  }
});

// node_modules/d3-quadtree/src/cover.js
function cover_default(x, y) {
  if (isNaN(x = +x) || isNaN(y = +y)) return this;
  var x0 = this._x0, y0 = this._y0, x1 = this._x1, y1 = this._y1;
  if (isNaN(x0)) {
    x1 = (x0 = Math.floor(x)) + 1;
    y1 = (y0 = Math.floor(y)) + 1;
  } else {
    var z = x1 - x0, node = this._root, parent, i;
    while (x0 > x || x >= x1 || y0 > y || y >= y1) {
      i = (y < y0) << 1 | x < x0;
      parent = new Array(4), parent[i] = node, node = parent, z *= 2;
      switch (i) {
        case 0:
          x1 = x0 + z, y1 = y0 + z;
          break;
        case 1:
          x0 = x1 - z, y1 = y0 + z;
          break;
        case 2:
          x1 = x0 + z, y0 = y1 - z;
          break;
        case 3:
          x0 = x1 - z, y0 = y1 - z;
          break;
      }
    }
    if (this._root && this._root.length) this._root = node;
  }
  this._x0 = x0;
  this._y0 = y0;
  this._x1 = x1;
  this._y1 = y1;
  return this;
}
var init_cover = __esm({
  "node_modules/d3-quadtree/src/cover.js"() {
  }
});

// node_modules/d3-quadtree/src/data.js
function data_default() {
  var data = [];
  this.visit(function(node) {
    if (!node.length) do
      data.push(node.data);
    while (node = node.next);
  });
  return data;
}
var init_data = __esm({
  "node_modules/d3-quadtree/src/data.js"() {
  }
});

// node_modules/d3-quadtree/src/extent.js
function extent_default(_) {
  return arguments.length ? this.cover(+_[0][0], +_[0][1]).cover(+_[1][0], +_[1][1]) : isNaN(this._x0) ? void 0 : [[this._x0, this._y0], [this._x1, this._y1]];
}
var init_extent = __esm({
  "node_modules/d3-quadtree/src/extent.js"() {
  }
});

// node_modules/d3-quadtree/src/quad.js
function quad_default(node, x0, y0, x1, y1) {
  this.node = node;
  this.x0 = x0;
  this.y0 = y0;
  this.x1 = x1;
  this.y1 = y1;
}
var init_quad = __esm({
  "node_modules/d3-quadtree/src/quad.js"() {
  }
});

// node_modules/d3-quadtree/src/find.js
function find_default(x, y, radius) {
  var data, x0 = this._x0, y0 = this._y0, x1, y1, x2, y2, x3 = this._x1, y3 = this._y1, quads = [], node = this._root, q, i;
  if (node) quads.push(new quad_default(node, x0, y0, x3, y3));
  if (radius == null) radius = Infinity;
  else {
    x0 = x - radius, y0 = y - radius;
    x3 = x + radius, y3 = y + radius;
    radius *= radius;
  }
  while (q = quads.pop()) {
    if (!(node = q.node) || (x1 = q.x0) > x3 || (y1 = q.y0) > y3 || (x2 = q.x1) < x0 || (y2 = q.y1) < y0) continue;
    if (node.length) {
      var xm = (x1 + x2) / 2, ym = (y1 + y2) / 2;
      quads.push(
        new quad_default(node[3], xm, ym, x2, y2),
        new quad_default(node[2], x1, ym, xm, y2),
        new quad_default(node[1], xm, y1, x2, ym),
        new quad_default(node[0], x1, y1, xm, ym)
      );
      if (i = (y >= ym) << 1 | x >= xm) {
        q = quads[quads.length - 1];
        quads[quads.length - 1] = quads[quads.length - 1 - i];
        quads[quads.length - 1 - i] = q;
      }
    } else {
      var dx = x - +this._x.call(null, node.data), dy = y - +this._y.call(null, node.data), d2 = dx * dx + dy * dy;
      if (d2 < radius) {
        var d = Math.sqrt(radius = d2);
        x0 = x - d, y0 = y - d;
        x3 = x + d, y3 = y + d;
        data = node.data;
      }
    }
  }
  return data;
}
var init_find = __esm({
  "node_modules/d3-quadtree/src/find.js"() {
    init_quad();
  }
});

// node_modules/d3-quadtree/src/remove.js
function remove_default(d) {
  if (isNaN(x = +this._x.call(null, d)) || isNaN(y = +this._y.call(null, d))) return this;
  var parent, node = this._root, retainer, previous, next, x0 = this._x0, y0 = this._y0, x1 = this._x1, y1 = this._y1, x, y, xm, ym, right, bottom, i, j;
  if (!node) return this;
  if (node.length) while (true) {
    if (right = x >= (xm = (x0 + x1) / 2)) x0 = xm;
    else x1 = xm;
    if (bottom = y >= (ym = (y0 + y1) / 2)) y0 = ym;
    else y1 = ym;
    if (!(parent = node, node = node[i = bottom << 1 | right])) return this;
    if (!node.length) break;
    if (parent[i + 1 & 3] || parent[i + 2 & 3] || parent[i + 3 & 3]) retainer = parent, j = i;
  }
  while (node.data !== d) if (!(previous = node, node = node.next)) return this;
  if (next = node.next) delete node.next;
  if (previous) return next ? previous.next = next : delete previous.next, this;
  if (!parent) return this._root = next, this;
  next ? parent[i] = next : delete parent[i];
  if ((node = parent[0] || parent[1] || parent[2] || parent[3]) && node === (parent[3] || parent[2] || parent[1] || parent[0]) && !node.length) {
    if (retainer) retainer[j] = node;
    else this._root = node;
  }
  return this;
}
function removeAll(data) {
  for (var i = 0, n = data.length; i < n; ++i) this.remove(data[i]);
  return this;
}
var init_remove = __esm({
  "node_modules/d3-quadtree/src/remove.js"() {
  }
});

// node_modules/d3-quadtree/src/root.js
function root_default() {
  return this._root;
}
var init_root = __esm({
  "node_modules/d3-quadtree/src/root.js"() {
  }
});

// node_modules/d3-quadtree/src/size.js
function size_default() {
  var size = 0;
  this.visit(function(node) {
    if (!node.length) do
      ++size;
    while (node = node.next);
  });
  return size;
}
var init_size = __esm({
  "node_modules/d3-quadtree/src/size.js"() {
  }
});

// node_modules/d3-quadtree/src/visit.js
function visit_default(callback) {
  var quads = [], q, node = this._root, child, x0, y0, x1, y1;
  if (node) quads.push(new quad_default(node, this._x0, this._y0, this._x1, this._y1));
  while (q = quads.pop()) {
    if (!callback(node = q.node, x0 = q.x0, y0 = q.y0, x1 = q.x1, y1 = q.y1) && node.length) {
      var xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
      if (child = node[3]) quads.push(new quad_default(child, xm, ym, x1, y1));
      if (child = node[2]) quads.push(new quad_default(child, x0, ym, xm, y1));
      if (child = node[1]) quads.push(new quad_default(child, xm, y0, x1, ym));
      if (child = node[0]) quads.push(new quad_default(child, x0, y0, xm, ym));
    }
  }
  return this;
}
var init_visit = __esm({
  "node_modules/d3-quadtree/src/visit.js"() {
    init_quad();
  }
});

// node_modules/d3-quadtree/src/visitAfter.js
function visitAfter_default(callback) {
  var quads = [], next = [], q;
  if (this._root) quads.push(new quad_default(this._root, this._x0, this._y0, this._x1, this._y1));
  while (q = quads.pop()) {
    var node = q.node;
    if (node.length) {
      var child, x0 = q.x0, y0 = q.y0, x1 = q.x1, y1 = q.y1, xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
      if (child = node[0]) quads.push(new quad_default(child, x0, y0, xm, ym));
      if (child = node[1]) quads.push(new quad_default(child, xm, y0, x1, ym));
      if (child = node[2]) quads.push(new quad_default(child, x0, ym, xm, y1));
      if (child = node[3]) quads.push(new quad_default(child, xm, ym, x1, y1));
    }
    next.push(q);
  }
  while (q = next.pop()) {
    callback(q.node, q.x0, q.y0, q.x1, q.y1);
  }
  return this;
}
var init_visitAfter = __esm({
  "node_modules/d3-quadtree/src/visitAfter.js"() {
    init_quad();
  }
});

// node_modules/d3-quadtree/src/x.js
function defaultX(d) {
  return d[0];
}
function x_default(_) {
  return arguments.length ? (this._x = _, this) : this._x;
}
var init_x = __esm({
  "node_modules/d3-quadtree/src/x.js"() {
  }
});

// node_modules/d3-quadtree/src/y.js
function defaultY(d) {
  return d[1];
}
function y_default(_) {
  return arguments.length ? (this._y = _, this) : this._y;
}
var init_y = __esm({
  "node_modules/d3-quadtree/src/y.js"() {
  }
});

// node_modules/d3-quadtree/src/quadtree.js
function quadtree(nodes, x, y) {
  var tree = new Quadtree(x == null ? defaultX : x, y == null ? defaultY : y, NaN, NaN, NaN, NaN);
  return nodes == null ? tree : tree.addAll(nodes);
}
function Quadtree(x, y, x0, y0, x1, y1) {
  this._x = x;
  this._y = y;
  this._x0 = x0;
  this._y0 = y0;
  this._x1 = x1;
  this._y1 = y1;
  this._root = void 0;
}
function leaf_copy(leaf) {
  var copy = { data: leaf.data }, next = copy;
  while (leaf = leaf.next) next = next.next = { data: leaf.data };
  return copy;
}
var treeProto;
var init_quadtree = __esm({
  "node_modules/d3-quadtree/src/quadtree.js"() {
    init_add();
    init_cover();
    init_data();
    init_extent();
    init_find();
    init_remove();
    init_root();
    init_size();
    init_visit();
    init_visitAfter();
    init_x();
    init_y();
    treeProto = quadtree.prototype = Quadtree.prototype;
    treeProto.copy = function() {
      var copy = new Quadtree(this._x, this._y, this._x0, this._y0, this._x1, this._y1), node = this._root, nodes, child;
      if (!node) return copy;
      if (!node.length) return copy._root = leaf_copy(node), copy;
      nodes = [{ source: node, target: copy._root = new Array(4) }];
      while (node = nodes.pop()) {
        for (var i = 0; i < 4; ++i) {
          if (child = node.source[i]) {
            if (child.length) nodes.push({ source: child, target: node.target[i] = new Array(4) });
            else node.target[i] = leaf_copy(child);
          }
        }
      }
      return copy;
    };
    treeProto.add = add_default;
    treeProto.addAll = addAll;
    treeProto.cover = cover_default;
    treeProto.data = data_default;
    treeProto.extent = extent_default;
    treeProto.find = find_default;
    treeProto.remove = remove_default;
    treeProto.removeAll = removeAll;
    treeProto.root = root_default;
    treeProto.size = size_default;
    treeProto.visit = visit_default;
    treeProto.visitAfter = visitAfter_default;
    treeProto.x = x_default;
    treeProto.y = y_default;
  }
});

// node_modules/d3-quadtree/src/index.js
var src_exports = {};
__export(src_exports, {
  quadtree: () => quadtree
});
var init_src = __esm({
  "node_modules/d3-quadtree/src/index.js"() {
    init_quadtree();
  }
});

// cjs/impl/graph.js
var require_graph = __commonJS({
  "cjs/impl/graph.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Node = void 0;
    var log = require_loglevel();
    var isect = require_isect();
    var d3 = (init_src(), __toCommonJS(src_exports));
    var vector_1 = require_vector();
    var Node2 = class {
      constructor(value, neighbors = /* @__PURE__ */ new Set()) {
        this.value = value;
        this.neighbors = neighbors;
        this.segments = /* @__PURE__ */ new Set();
      }
      addSegment(segment) {
        this.segments.add(segment);
      }
      addNeighbor(node) {
        if (node !== this) {
          this.neighbors.add(node);
          node.neighbors.add(this);
        }
      }
    };
    exports.Node = Node2;
    var Graph2 = class {
      /**
       * Create a graph from a set of streamlines
       * Finds all intersections, and creates a list of Nodes
       */
      constructor(streamlines2, dstep, deleteDangling = false) {
        const intersections = isect.bush(this.streamlinesToSegment(streamlines2)).run();
        const quadtree2 = d3.quadtree().x((n) => n.value.x).y((n) => n.value.y);
        const nodeAddRadius = 1e-3;
        for (const streamline of streamlines2) {
          for (let i = 0; i < streamline.length; i++) {
            const node = new Node2(streamline[i]);
            if (i > 0) {
              node.addSegment(this.vectorsToSegment(streamline[i - 1], streamline[i]));
            }
            if (i < streamline.length - 1) {
              node.addSegment(this.vectorsToSegment(streamline[i], streamline[i + 1]));
            }
            this.fuzzyAddToQuadtree(quadtree2, node, nodeAddRadius);
          }
        }
        for (const intersection of intersections) {
          const node = new Node2(new vector_1.default(intersection.point.x, intersection.point.y));
          for (const s of intersection.segments)
            node.addSegment(s);
          this.fuzzyAddToQuadtree(quadtree2, node, nodeAddRadius);
        }
        for (const streamline of streamlines2) {
          for (let i = 0; i < streamline.length - 1; i++) {
            const nodesAlongSegment = this.getNodesAlongSegment(this.vectorsToSegment(streamline[i], streamline[i + 1]), quadtree2, nodeAddRadius, dstep);
            if (nodesAlongSegment.length > 1) {
              for (let j = 0; j < nodesAlongSegment.length - 1; j++) {
                nodesAlongSegment[j].addNeighbor(nodesAlongSegment[j + 1]);
              }
            } else {
              log.error("Error Graph.js: segment with less than 2 nodes");
            }
          }
        }
        for (const n of quadtree2.data()) {
          if (deleteDangling) {
            this.deleteDanglingNodes(n, quadtree2);
          }
          n.adj = Array.from(n.neighbors);
        }
        this.nodes = quadtree2.data();
        this.intersections = [];
        for (const i of intersections)
          this.intersections.push(new vector_1.default(i.point.x, i.point.y));
      }
      /**
       * Remove dangling edges from graph to facilitate polygon finding
       */
      deleteDanglingNodes(n, quadtree2) {
        if (n.neighbors.size === 1) {
          quadtree2.remove(n);
          for (let neighbor of n.neighbors) {
            neighbor.neighbors.delete(n);
            this.deleteDanglingNodes(neighbor, quadtree2);
          }
        }
      }
      /**
       * Given a segment, step along segment and find all nodes along it
       */
      getNodesAlongSegment(segment, quadtree2, radius, step) {
        const foundNodes = [];
        const nodesAlongSegment = [];
        const start = new vector_1.default(segment.from.x, segment.from.y);
        const end = new vector_1.default(segment.to.x, segment.to.y);
        const differenceVector = end.clone().sub(start);
        step = Math.min(step, differenceVector.length() / 2);
        const steps = Math.ceil(differenceVector.length() / step);
        const differenceVectorLength = differenceVector.length();
        for (let i = 0; i <= steps; i++) {
          let currentPoint = start.clone().add(differenceVector.clone().multiplyScalar(i / steps));
          let nodesToAdd = [];
          let closestNode = quadtree2.find(currentPoint.x, currentPoint.y, radius + step / 2);
          while (closestNode !== void 0) {
            quadtree2.remove(closestNode);
            foundNodes.push(closestNode);
            let nodeOnSegment = false;
            for (let s of closestNode.segments) {
              if (this.fuzzySegmentsEqual(s, segment)) {
                nodeOnSegment = true;
                break;
              }
            }
            if (nodeOnSegment) {
              nodesToAdd.push(closestNode);
            }
            closestNode = quadtree2.find(currentPoint.x, currentPoint.y, radius + step / 2);
          }
          nodesToAdd.sort((first, second) => this.dotProductToSegment(first, start, differenceVector) - this.dotProductToSegment(second, start, differenceVector));
          nodesAlongSegment.push(...nodesToAdd);
        }
        quadtree2.addAll(foundNodes);
        return nodesAlongSegment;
      }
      fuzzySegmentsEqual(s1, s2, tolerance = 1e-4) {
        if (s1.from.x - s2.from.x > tolerance) {
          return false;
        }
        if (s1.from.y - s2.from.y > tolerance) {
          return false;
        }
        if (s1.to.x - s2.to.x > tolerance) {
          return false;
        }
        if (s1.to.y - s2.to.y > tolerance) {
          return false;
        }
        return true;
      }
      dotProductToSegment(node, start, differenceVector) {
        const dotVector = node.value.clone().sub(start);
        return differenceVector.dot(dotVector);
      }
      fuzzyAddToQuadtree(quadtree2, node, radius) {
        const existingNode = quadtree2.find(node.value.x, node.value.y, radius);
        if (existingNode === void 0) {
          quadtree2.add(node);
        } else {
          for (const neighbor of node.neighbors)
            existingNode.addNeighbor(neighbor);
          for (const segment of node.segments)
            existingNode.addSegment(segment);
        }
      }
      streamlinesToSegment(streamlines2) {
        const out = [];
        for (const s of streamlines2) {
          for (let i = 0; i < s.length - 1; i++) {
            out.push(this.vectorsToSegment(s[i], s[i + 1]));
          }
        }
        return out;
      }
      vectorsToSegment(v1, v2) {
        return {
          from: v1,
          to: v2
        };
      }
    };
    exports.default = Graph2;
  }
});

// cjs/impl/polygon_finder.js
var require_polygon_finder = __commonJS({
  "cjs/impl/polygon_finder.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var log = require_loglevel();
    var polygon_util_1 = require_polygon_util();
    var PolygonFinder2 = class {
      constructor(nodes, params, tensorField2) {
        this.nodes = nodes;
        this.params = params;
        this.tensorField = tensorField2;
        this._polygons = [];
        this._shrunkPolygons = [];
        this._dividedPolygons = [];
        this.toShrink = [];
        this.toDivide = [];
      }
      get polygons() {
        if (this._dividedPolygons.length > 0) {
          return this._dividedPolygons;
        }
        if (this._shrunkPolygons.length > 0) {
          return this._shrunkPolygons;
        }
        return this._polygons;
      }
      reset() {
        this.toShrink = [];
        this.toDivide = [];
        this._polygons = [];
        this._shrunkPolygons = [];
        this._dividedPolygons = [];
      }
      update() {
        let change = false;
        if (this.toShrink.length > 0) {
          const resolve = this.toShrink.length === 1;
          if (this.stepShrink(this.toShrink.pop())) {
            change = true;
          }
          if (resolve)
            this.resolveShrink();
        }
        if (this.toDivide.length > 0) {
          const resolve = this.toDivide.length === 1;
          if (this.stepDivide(this.toDivide.pop())) {
            change = true;
          }
          if (resolve)
            this.resolveDivide();
        }
        return change;
      }
      /**
       * Properly shrink polygon so the edges are all the same distance from the road
       */
      async shrink(animate = false) {
        return new Promise((resolve) => {
          if (this._polygons.length === 0) {
            this.findPolygons();
          }
          if (animate) {
            if (this._polygons.length === 0) {
              resolve();
              return;
            }
            this.toShrink = this._polygons.slice();
            this.resolveShrink = resolve;
          } else {
            this._shrunkPolygons = [];
            for (const p of this._polygons) {
              this.stepShrink(p);
            }
            resolve();
          }
        });
      }
      stepShrink(polygon) {
        const shrunk = polygon_util_1.default.resizeGeometry(polygon, -this.params.shrinkSpacing);
        if (shrunk.length > 0) {
          this._shrunkPolygons.push(shrunk);
          return true;
        }
        return false;
      }
      async divide(animate = false) {
        return new Promise((resolve) => {
          if (this._polygons.length === 0) {
            this.findPolygons();
          }
          let polygons = this._polygons;
          if (this._shrunkPolygons.length > 0) {
            polygons = this._shrunkPolygons;
          }
          if (animate) {
            if (polygons.length === 0) {
              resolve();
              return;
            }
            this.toDivide = polygons.slice();
            this.resolveDivide = resolve;
          } else {
            this._dividedPolygons = [];
            for (const p of polygons) {
              this.stepDivide(p);
            }
            resolve();
          }
        });
      }
      stepDivide(polygon) {
        if (this.params.chanceNoDivide > 0 && Math.random() < this.params.chanceNoDivide) {
          this._dividedPolygons.push(polygon);
          return true;
        }
        const divided = polygon_util_1.default.subdividePolygon(polygon, this.params.minArea);
        if (divided.length > 0) {
          this._dividedPolygons.push(...divided);
          return true;
        }
        return false;
      }
      findPolygons() {
        this._shrunkPolygons = [];
        this._dividedPolygons = [];
        const polygons = [];
        for (const node of this.nodes) {
          if (node.adj.length < 2)
            continue;
          for (const nextNode of node.adj) {
            const polygon = this.recursiveWalk([node, nextNode]);
            if (polygon !== null && polygon.length < this.params.maxLength) {
              this.removePolygonAdjacencies(polygon);
              polygons.push(polygon.map((n) => n.value.clone()));
            }
          }
        }
        this._polygons = this.filterPolygonsByWater(polygons);
      }
      filterPolygonsByWater(polygons) {
        const out = [];
        for (const p of polygons) {
          const averagePoint = polygon_util_1.default.averagePoint(p);
          if (this.tensorField.onLand(averagePoint) && !this.tensorField.inParks(averagePoint))
            out.push(p);
        }
        return out;
      }
      removePolygonAdjacencies(polygon) {
        for (let i = 0; i < polygon.length; i++) {
          const current = polygon[i];
          const next = polygon[(i + 1) % polygon.length];
          const index = current.adj.indexOf(next);
          if (index >= 0) {
            current.adj.splice(index, 1);
          } else {
            log.error("PolygonFinder - node not in adj");
          }
        }
      }
      recursiveWalk(visited, count = 0) {
        if (count >= this.params.maxLength)
          return null;
        const nextNode = this.getRightmostNode(visited[visited.length - 2], visited[visited.length - 1]);
        if (nextNode === null) {
          return null;
        }
        const visitedIndex = visited.indexOf(nextNode);
        if (visitedIndex >= 0) {
          return visited.slice(visitedIndex);
        } else {
          visited.push(nextNode);
          return this.recursiveWalk(visited, count++);
        }
      }
      getRightmostNode(nodeFrom, nodeTo) {
        if (nodeTo.adj.length === 0)
          return null;
        const backwardsDifferenceVector = nodeFrom.value.clone().sub(nodeTo.value);
        const transformAngle = Math.atan2(backwardsDifferenceVector.y, backwardsDifferenceVector.x);
        let rightmostNode = null;
        let smallestTheta = Math.PI * 2;
        for (const nextNode of nodeTo.adj) {
          if (nextNode !== nodeFrom) {
            const nextVector = nextNode.value.clone().sub(nodeTo.value);
            let nextAngle = Math.atan2(nextVector.y, nextVector.x) - transformAngle;
            if (nextAngle < 0) {
              nextAngle += Math.PI * 2;
            }
            if (nextAngle < smallestTheta) {
              smallestTheta = nextAngle;
              rightmostNode = nextNode;
            }
          }
        }
        return rightmostNode;
      }
    };
    exports.default = PolygonFinder2;
  }
});

// entry.mjs
var import_vector = __toESM(require_vector(), 1);
var import_tensor = __toESM(require_tensor(), 1);
var import_basis_field = __toESM(require_basis_field(), 1);
var import_tensor_field = __toESM(require_tensor_field(), 1);
var import_integrator = __toESM(require_integrator(), 1);
var import_streamlines = __toESM(require_streamlines(), 1);
var import_water_generator = __toESM(require_water_generator(), 1);
var import_graph = __toESM(require_graph(), 1);
var import_polygon_finder = __toESM(require_polygon_finder(), 1);
var import_polygon_util = __toESM(require_polygon_util(), 1);
var import_grid_storage = __toESM(require_grid_storage(), 1);
var Vector = import_vector.default.default;
var Tensor = import_tensor.default.default;
var Grid = import_basis_field.default.Grid;
var Radial = import_basis_field.default.Radial;
var BasisField = import_basis_field.default.BasisField;
var FIELD_TYPE = import_basis_field.default.FIELD_TYPE;
var TensorField = import_tensor_field.default.default;
var FieldIntegrator = import_integrator.default.default;
var RK4Integrator = import_integrator.default.RK4Integrator;
var EulerIntegrator = import_integrator.default.EulerIntegrator;
var StreamlineGenerator = import_streamlines.default.default;
var WaterGenerator = import_water_generator.default.default;
var Graph = import_graph.default.default;
var Node = import_graph.default.Node;
var PolygonFinder = import_polygon_finder.default.default;
var PolygonUtil = import_polygon_util.default.default;
var GridStorage = import_grid_storage.default.default;
export {
  BasisField,
  EulerIntegrator,
  FIELD_TYPE,
  FieldIntegrator,
  Graph,
  Grid,
  GridStorage,
  Node,
  PolygonFinder,
  PolygonUtil,
  RK4Integrator,
  Radial,
  StreamlineGenerator,
  Tensor,
  TensorField,
  Vector,
  WaterGenerator
};
