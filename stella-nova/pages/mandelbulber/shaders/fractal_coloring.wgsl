// fractal_coloring.wgsl - colour index from the orbit data of one fractal evaluation.
// Ported from Mandelbulber v2 opencl/engines/fractal_coloring.cl (CalculateColorIndex).
// Copyright (C) 2017-24 Mandelbulber Team. Authors: Krzysztof Marczak and Graeme McLaren.
// Mandelbulber is free software under the GNU General Public License v3 or later.
// This port is also GPL-3.0. See COPYING in the page folder.
//
// grep: CalculateColorIndex extraColorEnabledFalse hybridOrbitTrapScale1 clColoringFunctionABox

fn CalculateColorIndex(isHybrid: bool, r: f32, z: vec4f, colorMinIn: f32, extendedAux: Aux,
  coloringFunction: i32, defaultSlot: i32) -> f32 {
  let fractalColoring = P.material.fractalColoring;
  var colorIndex = 0.0;
  var colorMin = colorMinIn;

  if (fractalColoring.extraColorEnabledFalse != 0) {
    // color by numbers
    var colorValue = fractalColoring.initialColorValue;

    // colorValue initial condition components
    if (fractalColoring.initCondFalse != 0) {
      var initColorValue = 0.0;
      var xyzC = extendedAux.c.xyz;
      if (fractalColoring.icRadFalse != 0) { initColorValue = length(xyzC) * fractalColoring.icRadWeight; }
      if (fractalColoring.icXYZFalse != 0) {
        if (fractalColoring.icFabsFalse != 0) {
          xyzC = xyzC * fractalColoring.xyzC111;
        } else {
          xyzC = abs(xyzC) * fractalColoring.xyzC111;
        }
        initColorValue += xyzC.x + xyzC.y + xyzC.z;
      }
      colorValue += initColorValue;
    }

    // orbit trap component
    if (fractalColoring.orbitTrapTrue != 0) {
      colorValue += colorMin * fractalColoring.orbitTrapWeight;
    }
    // auxiliary color components
    if (fractalColoring.auxColorFalse != 0) {
      colorValue += extendedAux.color * fractalColoring.auxColorWeight
        + extendedAux.colorHybrid * fractalColoring.auxColorHybridWeight;
    }

    // radius components (historic)
    if (fractalColoring.radFalse != 0) {
      var rad = r;
      if (fractalColoring.radDiv1e13False != 0) { rad /= 1e13; }
      if (fractalColoring.radSquaredFalse != 0) { rad *= rad; }
      colorValue += rad * fractalColoring.radWeight;
    }

    // radius / DE components (historic)
    if (fractalColoring.radDivDeFalse != 0) {
      let distEst = extendedAux.DE;
      var radDE = r;
      if (fractalColoring.radDivDE1e13False != 0) { radDE /= 1e13; }
      if (fractalColoring.radDivDeSquaredFalse != 0) { radDE *= radDE; }
      radDE /= distEst;
      colorValue += radDE * fractalColoring.radDivDeWeight;
    }

    var addValue = 0.0;
    // XYZ bias
    var xyzValue = 0.0;
    if (fractalColoring.xyzBiasEnabledFalse != 0) {
      var xyzAxis = z.xyz;
      if (fractalColoring.xyzDiv1e13False != 0) { xyzAxis /= 1e13; }
      if (fractalColoring.xyzFabsFalse != 0) {
        xyzAxis = xyzAxis * fractalColoring.xyz000;
      } else {
        xyzAxis = abs(xyzAxis) * fractalColoring.xyz000;
      }
      if (fractalColoring.xyzXSqrdFalse != 0) { xyzAxis.x *= xyzAxis.x; }
      if (fractalColoring.xyzYSqrdFalse != 0) { xyzAxis.y *= xyzAxis.y; }
      if (fractalColoring.xyzZSqrdFalse != 0) { xyzAxis.z *= xyzAxis.z; }
      xyzValue = (xyzAxis.x + xyzAxis.y + xyzAxis.z)
        * (1.0 + (fractalColoring.xyzIterScale * f32(extendedAux.i)));
    }
    addValue += xyzValue;
    colorValue += addValue;

    // colorValue iteration components
    if (fractalColoring.iterGroupFalse != 0) {
      if (fractalColoring.iterAddScaleTrue != 0 && extendedAux.i > fractalColoring.iStartValue) {
        let iUse = extendedAux.i - fractalColoring.iStartValue;
        colorValue += fractalColoring.iterAddScale * f32(iUse);
      }
      if (fractalColoring.iterScaleFalse != 0 && extendedAux.i >= fractalColoring.iStartValue) {
        let iUse = extendedAux.i - fractalColoring.iStartValue;
        colorValue *= (f32(iUse) * fractalColoring.iterScale) + 1.0;
      }
    }

    // final colorValue controls
    if (fractalColoring.globalPaletteFalse != 0) {
      if (fractalColoring.addEnabledFalse != 0) {
        if (colorValue > fractalColoring.addStartValue) {
          colorValue += (1.0 - 1.0 / (1.0 + (colorValue - fractalColoring.addStartValue)
            / fractalColoring.addSpread)) * fractalColoring.addMax;
        }
      }
      if (fractalColoring.parabEnabledFalse != 0) {
        if (colorValue > fractalColoring.parabStartValue) {
          var parab = colorValue - fractalColoring.cosStartValue;
          parab = parab * parab * fractalColoring.parabScale;
          colorValue += parab;
        }
      }
      if (fractalColoring.cosEnabledFalse != 0) {
        if (colorValue > fractalColoring.cosStartValue) {
          let trig = (0.5 - 0.5 * cos((colorValue - fractalColoring.cosStartValue) * 3.14159265
            / (fractalColoring.cosPeriod * 2.0))) * fractalColoring.cosAdd;
          colorValue += trig;
        }
      }
      if (fractalColoring.roundEnabledFalse != 0) {
        let roundScale = fractalColoring.roundScale;
        colorValue /= roundScale;
        colorValue = round(colorValue) * roundScale;
      }
    }

    // palette max min controls
    let minCV = fractalColoring.minColorValue;
    let maxCV = fractalColoring.maxColorValue;
    if (colorValue < minCV) { colorValue = minCV; }
    if (colorValue > maxCV) { colorValue = maxCV; }

    colorIndex = colorValue * 256.0;
  } else if (isHybrid) {
    // Historic HYBRID MODE coloring
    colorMin = min(100.0, colorMin);
    let mboxColor = extendedAux.color;
    let r2 = min(r / abs(extendedAux.DE), 20.0);
    if (fractalColoring.extraColorOptionsEnabledFalse == 0) {
      colorIndex = (colorMin * 1000.0 + mboxColor * 100.0 + r2 * 5000.0);
    } else {
      colorIndex = (colorMin * 1000.0 * fractalColoring.hybridOrbitTrapScale1
        + mboxColor * 100.0 * fractalColoring.hybridAuxColorScale1
        + r2 * 5000.0 * fractalColoring.hybridRadDivDeScale1);
    }
  } else {
    // NORMAL MODE Coloring
    switch (coloringFunction) {
      case 1: { // clColoringFunctionABox
        var minPart = 0.0;
        if (fractalColoring.coloringAlgorithm != fractalColoringCl_Standard) { minPart = colorMin * 1000.0; }
        colorIndex = extendedAux.color * 100.0
          + r * FR[defaultSlot].mandelbox.color.factorR / 1e13
          + minPart;
      }
      case 2: { colorIndex = colorMin * 1000.0; }           // clColoringFunctionIFS
      case 3: { colorIndex = colorMin * 200.0; }            // clColoringFunctionAmazingSurf
      case 5: { colorIndex = extendedAux.color * 2000.0 / f32(extendedAux.i); } // Donut
      case 0: { colorIndex = colorMin * 5000.0; }           // clColoringFunctionDefault
      default: { colorIndex = 0.0; }                        // Undefined (ABox2 has no case upstream)
    }
  }

  return colorIndex;
}
