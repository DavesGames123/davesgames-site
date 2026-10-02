import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
// Frames come from PARALLEL TRANSPORT, not from a Frenet frame. A Frenet frame is defined by
// the curve's normal, which flips sign wherever the path has an inflection or straightens out,
// and every flip twists the surface 180 degrees within one segment. Carrying the previous frame
// forward and removing only its along-path component keeps the twist continuous. THREE's own
// extrudePath and TubeGeometry do not expose this, which is why this is hand-built.
function buildTaperedSweepGeometry(sweep) {
    const stations = sweep.stations;
    if (stations.length < 2)
        throw new Error('tapered-sweep needs at least two stations');
    const radial = Math.max(3, sweep.radialSegments ?? 10);
    const centres = stations.map((s) => new THREE.Vector3(...s.position));
    const tangents = centres.map((_, i) => {
        const prev = centres[Math.max(0, i - 1)];
        const next = centres[Math.min(centres.length - 1, i + 1)];
        const t = next.clone().sub(prev);
        // Coincident neighbours would normalise to NaN and poison every downstream vertex.
        return t.lengthSq() < 1e-12 ? new THREE.Vector3(0, 1, 0) : t.normalize();
    });
    // Seed a reference axis that is not parallel to the first tangent, or the first cross
    // product is degenerate and the whole sweep collapses to a line.
    let ref = new THREE.Vector3(0, 0, 1);
    if (Math.abs(tangents[0].dot(ref)) > 0.9)
        ref = new THREE.Vector3(1, 0, 0);
    const normals = [];
    const binormals = [];
    let carried = ref.clone().sub(tangents[0].clone().multiplyScalar(ref.dot(tangents[0]))).normalize();
    for (let i = 0; i < tangents.length; i += 1) {
        const t = tangents[i];
        // Project the carried frame back onto the plane perpendicular to this tangent.
        const n = carried.clone().sub(t.clone().multiplyScalar(carried.dot(t)));
        if (n.lengthSq() < 1e-12) {
            const fallback = Math.abs(t.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
            n.copy(fallback.sub(t.clone().multiplyScalar(fallback.dot(t))));
        }
        n.normalize();
        normals.push(n);
        binormals.push(new THREE.Vector3().crossVectors(t, n).normalize());
        carried = n;
    }
    const positions = [];
    const uvs = [];
    const indices = [];
    const ringStart = [];
    const isPoint = [];
    for (let i = 0; i < stations.length; i += 1) {
        const st = stations[i];
        const v = i / (stations.length - 1);
        ringStart.push(positions.length / 3);
        // A station whose section has collapsed emits ONE vertex, not a ring of radius zero.
        // A degenerate ring still carries `radial` coincident vertices and `radial` zero-area
        // triangles, so the lock ends in a blunt cap the width of the floating-point noise
        // rather than at a point -- and a hair lock, a horn or a blade tip has to reach a point.
        if (st.rx <= 1e-6 && st.rz <= 1e-6) {
            isPoint.push(true);
            positions.push(centres[i].x, centres[i].y, centres[i].z);
            uvs.push(0.5, v);
            continue;
        }
        isPoint.push(false);
        const twist = ((st.twist ?? 0) * Math.PI) / 180;
        for (let j = 0; j <= radial; j += 1) {
            const theta = (j / radial) * Math.PI * 2 + twist;
            const offset = normals[i].clone().multiplyScalar(Math.cos(theta) * st.rx)
                .add(binormals[i].clone().multiplyScalar(Math.sin(theta) * st.rz));
            const p = centres[i].clone().add(offset);
            positions.push(p.x, p.y, p.z);
            uvs.push(j / radial, v);
        }
    }
    for (let i = 0; i < stations.length - 1; i += 1) {
        const a0 = ringStart[i];
        const b0 = ringStart[i + 1];
        if (isPoint[i] && isPoint[i + 1])
            continue; // two collapsed stations bound nothing
        for (let j = 0; j < radial; j += 1) {
            // Wound so the face normal points radially OUTWARD.
            //
            // Ring vertices advance from `normal` toward `binormal`, and binormal is
            // tangent x normal, so increasing theta runs counter-clockwise seen from the
            // far end of the segment. Taking the ring-to-ring edge first therefore puts
            // the cross product on the inside. Measured as signed volume on the built
            // mesh: every tapered-sweep came out negative -- a torso at -0.0674 and a
            // tail at -0.0044 against a positive ellipsoid head -- so every sweep this
            // generator has ever emitted rendered its back faces, with normals pointing
            // into the solid and every lighting judgement made on the wrong surface.
            if (isPoint[i])
                indices.push(a0, b0 + j + 1, b0 + j);
            else if (isPoint[i + 1])
                indices.push(a0 + j, a0 + j + 1, b0);
            else
                indices.push(a0 + j, a0 + j + 1, b0 + j, a0 + j + 1, b0 + j + 1, b0 + j);
        }
    }
    if (sweep.capEnds ?? true) {
        for (const end of [0, stations.length - 1]) {
            if (isPoint[end])
                continue; // a point end is already closed
            const centreIndex = positions.length / 3;
            positions.push(centres[end].x, centres[end].y, centres[end].z);
            uvs.push(0.5, end === 0 ? 0 : 1);
            const base = ringStart[end];
            for (let j = 0; j < radial; j += 1) {
                if (end === 0)
                    indices.push(centreIndex, base + j + 1, base + j);
                else
                    indices.push(centreIndex, base + j, base + j + 1);
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}
function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}
function readLayerNumber(value, keys, fallback) {
    if (typeof value === 'number')
        return value;
    if (value && typeof value === 'object') {
        const record = value;
        for (const key of keys) {
            if (typeof record[key] === 'number')
                return record[key];
        }
    }
    return fallback;
}
function hexToRgb(hex) {
    const normalized = /^#[0-9a-f]{3}$/i.test(hex)
        ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
        : hex;
    const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
    return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}
function materialPalette(spec) {
    const palette = spec.colorVariation?.palette;
    if (Array.isArray(palette) && palette.length > 0)
        return palette.filter((value) => typeof value === 'string');
    const secondary = spec.albedo?.secondary;
    const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
    return colors.filter((value) => typeof value === 'string' && value.startsWith('#'));
}
function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}
function clampAlbedoChannel(value) {
    return Math.max(30, Math.min(240, Math.round(value)));
}
function clampPbrF0(value) {
    return Math.max(0.02, Math.min(1, value));
}
function clampPbrIor(value) {
    return Math.max(1, Math.min(2.5, value));
}
function clampPbrMetalness(value) {
    return value >= 0.5 ? 1 : 0;
}
function clampedAlbedoColor(spec) {
    const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
    // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
    //
    // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
    // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
    // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
    // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
    // it matters most, because the transfer curve is steepest near black.
    return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}
function smoothCurve(value) {
    return value * value * (3 - 2 * value);
}
function periodicHash(x, y, seed, periodX, periodY) {
    const wrappedX = ((x % periodX) + periodX) % periodX;
    const wrappedY = ((y % periodY) + periodY) % periodY;
    let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}
function periodicValueNoise(u, v, seed, periodX, periodY) {
    const x = u * periodX;
    const y = v * periodY;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smoothCurve(x - x0);
    const ty = smoothCurve(y - y0);
    const a = periodicHash(x0, y0, seed, periodX, periodY);
    const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
    const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
    const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}
function surfaceBands(spec) {
    const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
    const parsed = source.flatMap((item) => {
        if (!item || typeof item !== 'object')
            return [];
        const band = item;
        const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
        const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
        if (frequency <= 0 || amplitude <= 0)
            return [];
        const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
        const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
        return [{
                frequency,
                amplitude,
                stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
                stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
                ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
            }];
    });
    return parsed.length > 0 ? parsed : [
        { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
        { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
        { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
    ];
}
function sampleSurface(u, v, bands, seed) {
    let value = 0;
    let weight = 0;
    for (let index = 0; index < bands.length; index += 1) {
        const band = bands[index];
        const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
        const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
        let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
        if (band.ridge)
            sample = 1 - Math.abs(sample * 2 - 1);
        value += sample * band.amplitude;
        weight += band.amplitude;
    }
    return weight > 0 ? clamp01(value / weight) : 0.5;
}
function mixPalette(colors, value) {
    if (colors.length === 1)
        return colors[0];
    const scaled = clamp01(value) * (colors.length - 1);
    const index = Math.min(colors.length - 2, Math.floor(scaled));
    const mix = scaled - index;
    const a = colors[index];
    const b = colors[index + 1];
    return [
        Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
        Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
        Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
    ];
}
function parseRgba(value) {
    const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
    if (!match)
        return [138, 122, 95];
    return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}
// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient, u, v) {
    const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
    let t;
    if (gradient.type === 'radial') {
        const [cx, cy] = gradient.axis;
        const dx = u - cx;
        const dy = v - cy;
        const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
        t = clamp01(Math.hypot(dx, dy) / maxRadius);
    }
    else {
        const [ax, ay] = gradient.axis;
        const projection = (u - 0.5) * ax + (v - 0.5) * ay;
        const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
        t = clamp01(projection / maxProjection + 0.5);
    }
    const scaled = t * (stops.length - 1);
    const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
    const mix = scaled - index;
    const a = parseRgba(stops[index].color);
    const b = parseRgba(stops[index + 1].color);
    return [
        THREE.MathUtils.lerp(a[0], b[0], mix),
        THREE.MathUtils.lerp(a[1], b[1], mix),
        THREE.MathUtils.lerp(a[2], b[2], mix),
    ];
}
function writePixel(data, offset, red, green, blue) {
    data[offset] = Math.max(0, Math.min(255, Math.round(red)));
    data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
    data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
    data[offset + 3] = 255;
}
function makeCanvas(size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    return canvas;
}
function createMapTexture(canvas, colorSpace, spec, options) {
    const texture = new THREE.CanvasTexture(canvas);
    const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
    const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
    texture.colorSpace = colorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(typeof repeat[0] === 'number' ? repeat[0] : 2, typeof repeat[1] === 'number' ? repeat[1] : 2);
    texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
    texture.needsUpdate = true;
    return texture;
}
function referenceMapUrl(spec, channel) {
    const reference = spec.referencePbr;
    if (!reference || typeof reference !== 'object')
        return null;
    if (reference.usable === false)
        return null;
    const confidence = typeof reference.confidence === 'number'
        ? reference.confidence
        : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
    const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
    if (confidence < threshold)
        return null;
    const maps = reference.maps;
    if (!maps || typeof maps !== 'object')
        return null;
    const map = maps[channel];
    if (!map || typeof map !== 'object')
        return null;
    const record = map;
    const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
    return typeof url === 'string' && url.trim() ? url : null;
}
function createLoadedMapTexture(url, colorSpace, spec, options) {
    const texture = new THREE.TextureLoader().load(url);
    const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
    const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
    texture.colorSpace = colorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(typeof repeat[0] === 'number' ? repeat[0] : 1, typeof repeat[1] === 'number' ? repeat[1] : 1);
    texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
    texture.needsUpdate = true;
    return texture;
}
function makeReferenceTextureSet(spec, options) {
    const albedo = referenceMapUrl(spec, 'albedo');
    const roughness = referenceMapUrl(spec, 'roughness');
    const height = referenceMapUrl(spec, 'height');
    const normal = referenceMapUrl(spec, 'normal');
    const ao = referenceMapUrl(spec, 'ao');
    if (!albedo || !roughness || !height || !normal || !ao)
        return null;
    return {
        albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
        roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
        height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
        normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
        ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
        source: 'reference-pixel-extraction',
    };
}
function makeProceduralTextureSet(id, spec, options) {
    if (typeof document === 'undefined')
        return null;
    const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
    const requested = options.textureSize ?? spec.textureResolution;
    const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
        ? requested
        : (qualityFirst ? 1024 : 512);
    const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
    const canvases = {
        albedo: makeCanvas(size),
        roughness: makeCanvas(size),
        height: makeCanvas(size),
        normal: makeCanvas(size),
        ao: makeCanvas(size),
    };
    const contexts = {
        albedo: canvases.albedo.getContext('2d'),
        roughness: canvases.roughness.getContext('2d'),
        height: canvases.height.getContext('2d'),
        normal: canvases.normal.getContext('2d'),
        ao: canvases.ao.getContext('2d'),
    };
    if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao)
        return null;
    const images = {
        albedo: contexts.albedo.createImageData(size, size),
        roughness: contexts.roughness.createImageData(size, size),
        height: contexts.height.createImageData(size, size),
        normal: contexts.normal.createImageData(size, size),
        ao: contexts.ao.createImageData(size, size),
    };
    const seed = hashString(id);
    const bands = surfaceBands(spec);
    const heightField = new Float32Array(size * size);
    const roughnessField = new Float32Array(size * size);
    const palette = materialPalette(spec);
    const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
    const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
    const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
    const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
    const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
    const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
    const colorGradient = spec.colorGradient;
    for (let y = 0; y < size; y += 1) {
        const v = y / size;
        for (let x = 0; x < size; x += 1) {
            const u = x / size;
            const index = y * size + x;
            const height = sampleSurface(u, v, bands, seed + 101);
            const roughNoise = sampleSurface(u, v, bands, seed + 7001);
            const colorNoise = sampleSurface(u, v, bands, seed + 15013);
            heightField[index] = height;
            roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
            let color;
            if (colorGradient) {
                // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
                // over the noise-based palette blend below — it is a measured trend, not a guess.
                color = sampleColorGradient(colorGradient, u, v);
            }
            else {
                const paletteValue = clamp01(0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation);
                color = mixPalette(colors, paletteValue);
            }
            writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
        }
    }
    const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
    const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
    for (let y = 0; y < size; y += 1) {
        const up = ((y - 1 + size) % size) * size;
        const down = ((y + 1) % size) * size;
        for (let x = 0; x < size; x += 1) {
            const left = (x - 1 + size) % size;
            const right = (x + 1) % size;
            const index = y * size + x;
            const center = heightField[index];
            const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
            const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
            const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
            const normalX = -dx * inverseLength;
            const normalY = -dy * inverseLength;
            const normalZ = inverseLength;
            const neighborAverage = (heightField[y * size + left] + heightField[y * size + right]
                + heightField[up + x] + heightField[down + x]) * 0.25;
            const cavity = Math.max(0, neighborAverage - center);
            const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
            const offset = index * 4;
            const heightByte = center * 255;
            const roughnessByte = roughnessField[index] * 255;
            writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
            writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
            writePixel(images.normal.data, offset, (normalX * 0.5 + 0.5) * 255, (normalY * 0.5 + 0.5) * 255, (normalZ * 0.5 + 0.5) * 255);
            writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
        }
    }
    contexts.albedo.putImageData(images.albedo, 0, 0);
    contexts.roughness.putImageData(images.roughness, 0, 0);
    contexts.height.putImageData(images.height, 0, 0);
    contexts.normal.putImageData(images.normal, 0, 0);
    contexts.ao.putImageData(images.ao, 0, 0);
    return {
        albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
        roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
        height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
        normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
        ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
        source: 'procedural',
    };
}
function createSculptMaterial(id, spec, options, denseComponent = false) {
    // A material that declares -- with evidence -- that its subject carries no texture
    // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
    // branch below then forces color to white and roughness to 1 and reads both from the
    // generated maps, so the authored albedo and the reference-derived roughness are both
    // discarded, and the model gains mottling the reference does not have. Measured on the
    // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
    // only ever described two flat regions.
    const textureless = spec.textureless?.declared === true;
    const textures = textureless
        ? null
        : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
    const material = new THREE.MeshPhysicalMaterial({
        color: textures ? 0xffffff : clampedAlbedoColor(spec),
        roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
        metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
        clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
        clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
        transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
        ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
        thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
        attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
        attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
        sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
        sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
        sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
        iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
        iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
        anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
        anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
        specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
        specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
        emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
        emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
        opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
        transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
        alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
        wireframe: options.wireframe ?? false,
        side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
        flatShading: spec.flatShading === true,
    });
    if (textures) {
        material.map = textures.albedo;
        material.roughnessMap = textures.roughness;
        material.normalMap = textures.normal;
        material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
        material.aoMap = textures.ao;
        material.aoMap.channel = 0;
        material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
        const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
        const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
        const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
        if (effectiveBumpScale > 0) {
            material.bumpMap = textures.height;
            material.bumpScale = effectiveBumpScale;
        }
        const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
        const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
        if (effectiveDisplacementScale > 0) {
            material.displacementMap = textures.height;
            material.displacementScale = effectiveDisplacementScale;
            material.displacementBias = -effectiveDisplacementScale * 0.5;
        }
    }
    material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
    material.userData.sculptMaterial = spec;
    material.userData.proceduralMapsIndependent = true;
    material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
    material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
    material.userData.referencePbr = spec.referencePbr ?? null;
    material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
    material.userData.materialEvidence = spec.materialEvidence ?? null;
    material.userData.validationViews = spec.materialReference?.validationViews ?? [];
    material.needsUpdate = true;
    return material;
}
function readVector3(value, fallback) {
    if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
        return new THREE.Vector3(value[0], value[1], value[2]);
    }
    return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}
function readNumber(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function makeAttachmentEndpoint(attachment) {
    if (!attachment || typeof attachment !== 'object')
        return null;
    const record = attachment;
    const start = readVector3(record.localStart, [0, 0, 0]);
    const end = readVector3(record.localEnd, [0, 1, 0]);
    const delta = end.clone().sub(start);
    const length = delta.length();
    if (length <= 0.0001)
        return null;
    const direction = delta.clone().normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
    const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
    return {
        start,
        midpoint: delta.multiplyScalar(0.5),
        quaternion,
        length,
        baseRadius,
        endRadius,
    };
}
// Generated from ObjectSculptSpec target: Painted Wooden Armchair
// Sculpt build pass: form-refinement
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createPaintedWoodenArmchairModel(options = {}) {
    const root = new THREE.Group();
    root.name = "Painted Wooden Armchair";
    root.userData.reconstructionEvidence = { "itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": { "solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": { "yaw": 0.0, "pitch": 0.0, "roll": 0.0 }, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review." }, "approximationNotes": [] };
    root.userData.materialPipeline = {};
    root.userData.materialReferenceRegistry = null;
    const materialMap = {};
    materialMap["painted-green"] = createSculptMaterial("painted-green", { "id": "painted-green", "name": "Green milk paint on wood", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#5E9C78", "color": "#5E9C78", "albedo": { "dominant": "#7EA078", "secondary": ["#84A880", "#77966E", "#8CB189"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": { "path": "models/chair/maps/painted-green_albedo.jpg", "url": "models/chair/maps/painted-green_albedo.jpg", "channel": "albedo", "source": "reference-pixel-extraction" } }, "colorVariation": { "palette": ["#7EA078", "#84A880", "#77966E", "#8CB189", "#6B8762"], "pattern": "reference-derived pixel palette", "amplitude": 0.08, "heightCorrelation": 0.42 }, "textureResolution": 1024, "textureProjection": { "mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale." }, "surfaceFrequencyBands": [{ "id": "macro", "frequency": 2.0, "amplitude": 0.331, "role": "reference-derived broad albedo and height breakup" }, { "id": "meso", "frequency": 14.0, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters" }, { "id": "micro", "frequency": 72.0, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light" }], "roughness": { "base": 0.762, "variation": 0.156, "map": { "path": "models/chair/maps/painted-green_roughness.jpg", "url": "models/chair/maps/painted-green_roughness.jpg", "channel": "roughness", "source": "reference-pixel-extraction" }, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother" }, "metalness": { "base": 0.0, "variation": 0.0 }, "normal": { "pattern": "reference-derived height-gradient normal map", "strength": 0.254, "map": { "path": "models/chair/maps/painted-green_normal.jpg", "url": "models/chair/maps/painted-green_normal.jpg", "channel": "normal", "source": "reference-pixel-extraction" }, "heightSource": { "path": "models/chair/maps/painted-green_height.jpg", "url": "models/chair/maps/painted-green_height.jpg", "channel": "height", "source": "reference-pixel-extraction" }, "space": "tangent" }, "bump": { "pattern": "reference-derived height field", "amplitude": 0.037, "map": { "path": "models/chair/maps/painted-green_height.jpg", "url": "models/chair/maps/painted-green_height.jpg", "channel": "height", "source": "reference-pixel-extraction" } }, "displacement": { "pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false }, "ambientOcclusion": { "cavityStrength": 0.38, "contactShadowBias": 0.35, "map": { "path": "models/chair/maps/painted-green_ao.jpg", "url": "models/chair/maps/painted-green_ao.jpg", "channel": "ao", "source": "reference-pixel-extraction" }, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot." }, "wear": { "edgeWear": 0.45, "scratches": ["vertical scuffs on the front posts"], "chips": ["paint chips on arm fronts"] }, "dirt": { "amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22" }, "localOverrides": [{ "id": "edge-wear", "kind": "chip", "mask": "arrises and lower legs", "color": "#6E5038", "roughness": 0.75 }, { "id": "joint-grime", "kind": "dirt", "mask": "joints and seat gaps", "color": "#2F4A3A" }, { "id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison." }], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "Opaque satin green paint with brush lines; worn to brown wood on edges.", "referencePbr": { "version": "1.0", "sourceImage": "slat.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.751, "estimatedFidelity": 0.751, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": { "albedo": { "path": "models/chair/maps/painted-green_albedo.jpg", "url": "models/chair/maps/painted-green_albedo.jpg", "channel": "albedo", "source": "reference-pixel-extraction" }, "roughness": { "path": "models/chair/maps/painted-green_roughness.jpg", "url": "models/chair/maps/painted-green_roughness.jpg", "channel": "roughness", "source": "reference-pixel-extraction" }, "height": { "path": "models/chair/maps/painted-green_height.jpg", "url": "models/chair/maps/painted-green_height.jpg", "channel": "height", "source": "reference-pixel-extraction" }, "normal": { "path": "models/chair/maps/painted-green_normal.jpg", "url": "models/chair/maps/painted-green_normal.jpg", "channel": "normal", "source": "reference-pixel-extraction" }, "ao": { "path": "models/chair/maps/painted-green_ao.jpg", "url": "models/chair/maps/painted-green_ao.jpg", "channel": "ao", "source": "reference-pixel-extraction" } }, "diagnostics": { "sourceWidth": 100, "sourceHeight": 30, "mapSize": 1024, "cropBBoxPixels": { "x": 0, "y": 0, "width": 100, "height": 30 }, "mask": { "backgroundColor": "#758A67", "backgroundNoise": 16.31, "transparentPixelFraction": 0.0, "foregroundCoverage": 1.0 }, "mapStats": { "valueRange": 0.1468, "heightP90Gradient": 0.08299, "roughnessBase": 0.762, "roughnessVariation": 0.156, "normalStrength": 0.254, "blurRadius": 21 }, "palette": ["#7EA078", "#84A880", "#77966E", "#8CB189", "#6B8762"] }, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"] } }, options);
    materialMap["painted-dark"] = createSculptMaterial("painted-dark", { "id": "painted-dark", "name": "Shadowed green paint", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#4F8A68", "color": "#4F8A68", "albedo": { "dominant": "#687350", "secondary": ["#717E5B", "#606846", "#565B3B"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": { "path": "models/chair/maps/painted-dark_albedo.jpg", "url": "models/chair/maps/painted-dark_albedo.jpg", "channel": "albedo", "source": "reference-pixel-extraction" } }, "colorVariation": { "palette": ["#687350", "#717E5B", "#606846", "#565B3B", "#7E906C"], "pattern": "reference-derived pixel palette", "amplitude": 0.08, "heightCorrelation": 0.42 }, "textureResolution": 1024, "textureProjection": { "mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale." }, "surfaceFrequencyBands": [{ "id": "macro", "frequency": 2.0, "amplitude": 0.343, "role": "reference-derived broad albedo and height breakup" }, { "id": "meso", "frequency": 14.0, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters" }, { "id": "micro", "frequency": 72.0, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light" }], "roughness": { "base": 0.774, "variation": 0.162, "map": { "path": "models/chair/maps/painted-dark_roughness.jpg", "url": "models/chair/maps/painted-dark_roughness.jpg", "channel": "roughness", "source": "reference-pixel-extraction" }, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother" }, "metalness": { "base": 0.0, "variation": 0.0 }, "normal": { "pattern": "reference-derived height-gradient normal map", "strength": 0.258, "map": { "path": "models/chair/maps/painted-dark_normal.jpg", "url": "models/chair/maps/painted-dark_normal.jpg", "channel": "normal", "source": "reference-pixel-extraction" }, "heightSource": { "path": "models/chair/maps/painted-dark_height.jpg", "url": "models/chair/maps/painted-dark_height.jpg", "channel": "height", "source": "reference-pixel-extraction" }, "space": "tangent" }, "bump": { "pattern": "reference-derived height field", "amplitude": 0.039, "map": { "path": "models/chair/maps/painted-dark_height.jpg", "url": "models/chair/maps/painted-dark_height.jpg", "channel": "height", "source": "reference-pixel-extraction" } }, "displacement": { "pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false }, "ambientOcclusion": { "cavityStrength": 0.38, "contactShadowBias": 0.35, "map": { "path": "models/chair/maps/painted-dark_ao.jpg", "url": "models/chair/maps/painted-dark_ao.jpg", "channel": "ao", "source": "reference-pixel-extraction" }, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot." }, "wear": { "edgeWear": 0.0, "scratches": [], "chips": [] }, "dirt": { "amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22" }, "localOverrides": [{ "id": "crest-handling", "kind": "stain", "mask": "top of the crest", "color": "#3A6650" }, { "id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison." }], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "Same paint on the rolled crest, darker from handling.", "referencePbr": { "version": "1.0", "sourceImage": "crest.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.755, "estimatedFidelity": 0.755, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": { "albedo": { "path": "models/chair/maps/painted-dark_albedo.jpg", "url": "models/chair/maps/painted-dark_albedo.jpg", "channel": "albedo", "source": "reference-pixel-extraction" }, "roughness": { "path": "models/chair/maps/painted-dark_roughness.jpg", "url": "models/chair/maps/painted-dark_roughness.jpg", "channel": "roughness", "source": "reference-pixel-extraction" }, "height": { "path": "models/chair/maps/painted-dark_height.jpg", "url": "models/chair/maps/painted-dark_height.jpg", "channel": "height", "source": "reference-pixel-extraction" }, "normal": { "path": "models/chair/maps/painted-dark_normal.jpg", "url": "models/chair/maps/painted-dark_normal.jpg", "channel": "normal", "source": "reference-pixel-extraction" }, "ao": { "path": "models/chair/maps/painted-dark_ao.jpg", "url": "models/chair/maps/painted-dark_ao.jpg", "channel": "ao", "source": "reference-pixel-extraction" } }, "diagnostics": { "sourceWidth": 120, "sourceHeight": 22, "mapSize": 1024, "cropBBoxPixels": { "x": 0, "y": 0, "width": 120, "height": 22 }, "mask": { "backgroundColor": "#667554", "backgroundNoise": 37.696, "transparentPixelFraction": 0.0, "foregroundCoverage": 1.0 }, "mapStats": { "valueRange": 0.1813, "heightP90Gradient": 0.08717, "roughnessBase": 0.774, "roughnessVariation": 0.162, "normalStrength": 0.258, "blurRadius": 21 }, "palette": ["#687350", "#717E5B", "#606846", "#565B3B", "#7E906C"] }, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"] } }, options);
    const nodes = { root };
    const meshes = {};
    const sockets = {};
    const colliders = {};
    const destructionGroups = {};
    const endpoint_seat_frame_0 = makeAttachmentEndpoint(null);
    const node_seat_frame_0 = new THREE.Group();
    node_seat_frame_0.name = "Front apron__pivot";
    node_seat_frame_0.scale.set(1, 1, 1);
    if (endpoint_seat_frame_0) {
        node_seat_frame_0.position.copy(endpoint_seat_frame_0.start);
        node_seat_frame_0.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_seat_frame_0.position.set(0.0, 1.62, 1.95);
        node_seat_frame_0.rotation.set(0.0, 0.0, 0.0);
    }
    node_seat_frame_0.userData.sculptComponent = { "id": "seat-frame", "name": "Front apron", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat sawn board; a box is the true primitive.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": null, "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0.0, 1.62, 1.95], "rotation": [0, 0, 0], "scale": [5.6, 0.7, 0.2] }, "actionProfile": { "animationRole": "root", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "seat-frame", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "apron-edge-wear", "kind": "chip", "notes": "paint worn off the lower edge" }], "surfaceDetail": { "macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.01, "normalPattern": "brush strokes along the grain", "displacementPattern": "", "occlusionPattern": "dark green in joints", "edgeWearPattern": "paint worn to brown wood on arrises and lower legs", "notes": "surface-pass: wear on edges, satin paint elsewhere" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_seat_frame_0.userData.actionProfile = { "animationRole": "root", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "seat-frame", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["root"] ?? root).add(node_seat_frame_0);
    nodes["seat-frame"] = node_seat_frame_0;
    const mesh_seat_frame_0Geometry = endpoint_seat_frame_0
        ? new THREE.CylinderGeometry(endpoint_seat_frame_0.endRadius, endpoint_seat_frame_0.baseRadius, endpoint_seat_frame_0.length, 16, 6)
        : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    if (!endpoint_seat_frame_0) {
        mesh_seat_frame_0Geometry.scale(5.6, 0.7, 0.2);
    }
    const mesh_seat_frame_0 = new THREE.Mesh(mesh_seat_frame_0Geometry, materialMap["painted-green"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_seat_frame_0.name = "Front apron";
    if (endpoint_seat_frame_0) {
        mesh_seat_frame_0.position.copy(endpoint_seat_frame_0.midpoint);
        mesh_seat_frame_0.quaternion.copy(endpoint_seat_frame_0.quaternion);
    }
    mesh_seat_frame_0.castShadow = options.castShadow ?? true;
    mesh_seat_frame_0.receiveShadow = options.receiveShadow ?? true;
    mesh_seat_frame_0.userData.sculptComponent = { "id": "seat-frame", "name": "Front apron", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat sawn board; a box is the true primitive.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": null, "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0.0, 1.62, 1.95], "rotation": [0, 0, 0], "scale": [5.6, 0.7, 0.2] }, "actionProfile": { "animationRole": "root", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "seat-frame", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "apron-edge-wear", "kind": "chip", "notes": "paint worn off the lower edge" }], "surfaceDetail": { "macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.01, "normalPattern": "brush strokes along the grain", "displacementPattern": "", "occlusionPattern": "dark green in joints", "edgeWearPattern": "paint worn to brown wood on arrises and lower legs", "notes": "surface-pass: wear on edges, satin paint elsewhere" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_seat_frame_0.add(mesh_seat_frame_0);
    meshes["seat-frame"] = mesh_seat_frame_0;
    colliders["seat-frame"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["seat-frame"] ?? (destructionGroups["seat-frame"] = []);
    destructionGroups["seat-frame"].push(node_seat_frame_0);
    const endpoint_side_apron_l_1 = makeAttachmentEndpoint(null);
    const node_side_apron_l_1 = new THREE.Group();
    node_side_apron_l_1.name = "Side apron l__pivot";
    node_side_apron_l_1.scale.set(1, 1, 1);
    if (endpoint_side_apron_l_1) {
        node_side_apron_l_1.position.copy(endpoint_side_apron_l_1.start);
        node_side_apron_l_1.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_side_apron_l_1.position.set(2.7, 0.0, -1.95);
        node_side_apron_l_1.rotation.set(0.0, 0.0, 0.0);
    }
    node_side_apron_l_1.userData.sculptComponent = { "id": "side-apron-l", "name": "Side apron l", "level": "meso", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Side apron l: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [2.7, 0.0, -1.95], "rotation": [0, 0, 0], "scale": [0.2, 0.7, 3.9] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "side-apron-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": { "macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.01, "normalPattern": "brush strokes along the grain", "displacementPattern": "", "occlusionPattern": "dark green in joints", "edgeWearPattern": "paint worn to brown wood on arrises and lower legs", "notes": "surface-pass: wear on edges, satin paint elsewhere" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_side_apron_l_1.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "side-apron-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["seat-frame"] ?? root).add(node_side_apron_l_1);
    nodes["side-apron-l"] = node_side_apron_l_1;
    const mesh_side_apron_l_1Geometry = endpoint_side_apron_l_1
        ? new THREE.CylinderGeometry(endpoint_side_apron_l_1.endRadius, endpoint_side_apron_l_1.baseRadius, endpoint_side_apron_l_1.length, 16, 6)
        : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    if (!endpoint_side_apron_l_1) {
        mesh_side_apron_l_1Geometry.scale(0.2, 0.7, 3.9);
    }
    const mesh_side_apron_l_1 = new THREE.Mesh(mesh_side_apron_l_1Geometry, materialMap["painted-green"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_side_apron_l_1.name = "Side apron l";
    if (endpoint_side_apron_l_1) {
        mesh_side_apron_l_1.position.copy(endpoint_side_apron_l_1.midpoint);
        mesh_side_apron_l_1.quaternion.copy(endpoint_side_apron_l_1.quaternion);
    }
    mesh_side_apron_l_1.castShadow = options.castShadow ?? true;
    mesh_side_apron_l_1.receiveShadow = options.receiveShadow ?? true;
    mesh_side_apron_l_1.userData.sculptComponent = { "id": "side-apron-l", "name": "Side apron l", "level": "meso", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Side apron l: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [2.7, 0.0, -1.95], "rotation": [0, 0, 0], "scale": [0.2, 0.7, 3.9] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "side-apron-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": { "macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.01, "normalPattern": "brush strokes along the grain", "displacementPattern": "", "occlusionPattern": "dark green in joints", "edgeWearPattern": "paint worn to brown wood on arrises and lower legs", "notes": "surface-pass: wear on edges, satin paint elsewhere" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_side_apron_l_1.add(mesh_side_apron_l_1);
    meshes["side-apron-l"] = mesh_side_apron_l_1;
    colliders["side-apron-l"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["side-apron-l"] ?? (destructionGroups["side-apron-l"] = []);
    destructionGroups["side-apron-l"].push(node_side_apron_l_1);
    const endpoint_side_apron_r_2 = makeAttachmentEndpoint(null);
    const node_side_apron_r_2 = new THREE.Group();
    node_side_apron_r_2.name = "Side apron r__pivot";
    node_side_apron_r_2.scale.set(1, 1, 1);
    if (endpoint_side_apron_r_2) {
        node_side_apron_r_2.position.copy(endpoint_side_apron_r_2.start);
        node_side_apron_r_2.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_side_apron_r_2.position.set(-2.7, 0.0, -1.95);
        node_side_apron_r_2.rotation.set(0.0, 0.0, 0.0);
    }
    node_side_apron_r_2.userData.sculptComponent = { "id": "side-apron-r", "name": "Side apron r", "level": "meso", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Side apron r: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [-2.7, 0.0, -1.95], "rotation": [0, 0, 0], "scale": [0.2, 0.7, 3.9] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "side-apron-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": { "macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.01, "normalPattern": "brush strokes along the grain", "displacementPattern": "", "occlusionPattern": "dark green in joints", "edgeWearPattern": "paint worn to brown wood on arrises and lower legs", "notes": "surface-pass: wear on edges, satin paint elsewhere" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_side_apron_r_2.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "side-apron-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["seat-frame"] ?? root).add(node_side_apron_r_2);
    nodes["side-apron-r"] = node_side_apron_r_2;
    const mesh_side_apron_r_2Geometry = endpoint_side_apron_r_2
        ? new THREE.CylinderGeometry(endpoint_side_apron_r_2.endRadius, endpoint_side_apron_r_2.baseRadius, endpoint_side_apron_r_2.length, 16, 6)
        : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    if (!endpoint_side_apron_r_2) {
        mesh_side_apron_r_2Geometry.scale(0.2, 0.7, 3.9);
    }
    const mesh_side_apron_r_2 = new THREE.Mesh(mesh_side_apron_r_2Geometry, materialMap["painted-green"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_side_apron_r_2.name = "Side apron r";
    if (endpoint_side_apron_r_2) {
        mesh_side_apron_r_2.position.copy(endpoint_side_apron_r_2.midpoint);
        mesh_side_apron_r_2.quaternion.copy(endpoint_side_apron_r_2.quaternion);
    }
    mesh_side_apron_r_2.castShadow = options.castShadow ?? true;
    mesh_side_apron_r_2.receiveShadow = options.receiveShadow ?? true;
    mesh_side_apron_r_2.userData.sculptComponent = { "id": "side-apron-r", "name": "Side apron r", "level": "meso", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Side apron r: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [-2.7, 0.0, -1.95], "rotation": [0, 0, 0], "scale": [0.2, 0.7, 3.9] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "side-apron-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": { "macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.01, "normalPattern": "brush strokes along the grain", "displacementPattern": "", "occlusionPattern": "dark green in joints", "edgeWearPattern": "paint worn to brown wood on arrises and lower legs", "notes": "surface-pass: wear on edges, satin paint elsewhere" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_side_apron_r_2.add(mesh_side_apron_r_2);
    meshes["side-apron-r"] = mesh_side_apron_r_2;
    colliders["side-apron-r"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["side-apron-r"] ?? (destructionGroups["side-apron-r"] = []);
    destructionGroups["side-apron-r"].push(node_side_apron_r_2);
    const endpoint_back_apron_3 = makeAttachmentEndpoint(null);
    const node_back_apron_3 = new THREE.Group();
    node_back_apron_3.name = "Back apron__pivot";
    node_back_apron_3.scale.set(1, 1, 1);
    if (endpoint_back_apron_3) {
        node_back_apron_3.position.copy(endpoint_back_apron_3.start);
        node_back_apron_3.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_back_apron_3.position.set(0.0, 0.0, -3.85);
        node_back_apron_3.rotation.set(0.0, 0.0, 0.0);
    }
    node_back_apron_3.userData.sculptComponent = { "id": "back-apron", "name": "Back apron", "level": "meso", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Back apron: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0.0, 0.0, -3.85], "rotation": [0, 0, 0], "scale": [5.6, 0.7, 0.2] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "back-apron", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_back_apron_3.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "back-apron", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["seat-frame"] ?? root).add(node_back_apron_3);
    nodes["back-apron"] = node_back_apron_3;
    const mesh_back_apron_3Geometry = endpoint_back_apron_3
        ? new THREE.CylinderGeometry(endpoint_back_apron_3.endRadius, endpoint_back_apron_3.baseRadius, endpoint_back_apron_3.length, 16, 6)
        : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    if (!endpoint_back_apron_3) {
        mesh_back_apron_3Geometry.scale(5.6, 0.7, 0.2);
    }
    const mesh_back_apron_3 = new THREE.Mesh(mesh_back_apron_3Geometry, materialMap["painted-green"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_back_apron_3.name = "Back apron";
    if (endpoint_back_apron_3) {
        mesh_back_apron_3.position.copy(endpoint_back_apron_3.midpoint);
        mesh_back_apron_3.quaternion.copy(endpoint_back_apron_3.quaternion);
    }
    mesh_back_apron_3.castShadow = options.castShadow ?? true;
    mesh_back_apron_3.receiveShadow = options.receiveShadow ?? true;
    mesh_back_apron_3.userData.sculptComponent = { "id": "back-apron", "name": "Back apron", "level": "meso", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Back apron: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0.0, 0.0, -3.85], "rotation": [0, 0, 0], "scale": [5.6, 0.7, 0.2] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "back-apron", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_back_apron_3.add(mesh_back_apron_3);
    meshes["back-apron"] = mesh_back_apron_3;
    colliders["back-apron"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["back-apron"] ?? (destructionGroups["back-apron"] = []);
    destructionGroups["back-apron"].push(node_back_apron_3);
    const endpoint_seat_slat_1_4 = makeAttachmentEndpoint(null);
    const node_seat_slat_1_4 = new THREE.Group();
    node_seat_slat_1_4.name = "Seat slat 1__pivot";
    node_seat_slat_1_4.scale.set(1, 1, 1);
    if (endpoint_seat_slat_1_4) {
        node_seat_slat_1_4.position.copy(endpoint_seat_slat_1_4.start);
        node_seat_slat_1_4.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_seat_slat_1_4.position.set(0.0, 0.4, -0.35);
        node_seat_slat_1_4.rotation.set(0.0, 0.0, 0.0);
    }
    node_seat_slat_1_4.userData.sculptComponent = { "id": "seat-slat-1", "name": "Seat slat 1", "level": "micro", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Seat slat 1: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0.0, 0.4, -0.35], "rotation": [0, 0, 0], "scale": [5.3, 0.14, 0.56] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "seat-slat-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "slat-gap-1", "kind": "groove", "notes": "dark gap to the next slat" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_seat_slat_1_4.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "seat-slat-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["seat-frame"] ?? root).add(node_seat_slat_1_4);
    nodes["seat-slat-1"] = node_seat_slat_1_4;
    const mesh_seat_slat_1_4Geometry = endpoint_seat_slat_1_4
        ? new THREE.CylinderGeometry(endpoint_seat_slat_1_4.endRadius, endpoint_seat_slat_1_4.baseRadius, endpoint_seat_slat_1_4.length, 16, 6)
        : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    if (!endpoint_seat_slat_1_4) {
        mesh_seat_slat_1_4Geometry.scale(5.3, 0.14, 0.56);
    }
    const mesh_seat_slat_1_4 = new THREE.Mesh(mesh_seat_slat_1_4Geometry, materialMap["painted-green"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_seat_slat_1_4.name = "Seat slat 1";
    if (endpoint_seat_slat_1_4) {
        mesh_seat_slat_1_4.position.copy(endpoint_seat_slat_1_4.midpoint);
        mesh_seat_slat_1_4.quaternion.copy(endpoint_seat_slat_1_4.quaternion);
    }
    mesh_seat_slat_1_4.castShadow = options.castShadow ?? true;
    mesh_seat_slat_1_4.receiveShadow = options.receiveShadow ?? true;
    mesh_seat_slat_1_4.userData.sculptComponent = { "id": "seat-slat-1", "name": "Seat slat 1", "level": "micro", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Seat slat 1: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0.0, 0.4, -0.35], "rotation": [0, 0, 0], "scale": [5.3, 0.14, 0.56] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "seat-slat-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "slat-gap-1", "kind": "groove", "notes": "dark gap to the next slat" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_seat_slat_1_4.add(mesh_seat_slat_1_4);
    meshes["seat-slat-1"] = mesh_seat_slat_1_4;
    colliders["seat-slat-1"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["seat-slat-1"] ?? (destructionGroups["seat-slat-1"] = []);
    destructionGroups["seat-slat-1"].push(node_seat_slat_1_4);
    const endpoint_seat_slat_2_5 = makeAttachmentEndpoint(null);
    const node_seat_slat_2_5 = new THREE.Group();
    node_seat_slat_2_5.name = "Seat slat 2__pivot";
    node_seat_slat_2_5.scale.set(1, 1, 1);
    if (endpoint_seat_slat_2_5) {
        node_seat_slat_2_5.position.copy(endpoint_seat_slat_2_5.start);
        node_seat_slat_2_5.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_seat_slat_2_5.position.set(0.0, 0.4, -0.99);
        node_seat_slat_2_5.rotation.set(0.0, 0.0, 0.0);
    }
    node_seat_slat_2_5.userData.sculptComponent = { "id": "seat-slat-2", "name": "Seat slat 2", "level": "micro", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Seat slat 2: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0.0, 0.4, -0.99], "rotation": [0, 0, 0], "scale": [5.3, 0.14, 0.56] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "seat-slat-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_seat_slat_2_5.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "seat-slat-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["seat-frame"] ?? root).add(node_seat_slat_2_5);
    nodes["seat-slat-2"] = node_seat_slat_2_5;
    const mesh_seat_slat_2_5Geometry = endpoint_seat_slat_2_5
        ? new THREE.CylinderGeometry(endpoint_seat_slat_2_5.endRadius, endpoint_seat_slat_2_5.baseRadius, endpoint_seat_slat_2_5.length, 16, 6)
        : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    if (!endpoint_seat_slat_2_5) {
        mesh_seat_slat_2_5Geometry.scale(5.3, 0.14, 0.56);
    }
    const mesh_seat_slat_2_5 = new THREE.Mesh(mesh_seat_slat_2_5Geometry, materialMap["painted-green"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_seat_slat_2_5.name = "Seat slat 2";
    if (endpoint_seat_slat_2_5) {
        mesh_seat_slat_2_5.position.copy(endpoint_seat_slat_2_5.midpoint);
        mesh_seat_slat_2_5.quaternion.copy(endpoint_seat_slat_2_5.quaternion);
    }
    mesh_seat_slat_2_5.castShadow = options.castShadow ?? true;
    mesh_seat_slat_2_5.receiveShadow = options.receiveShadow ?? true;
    mesh_seat_slat_2_5.userData.sculptComponent = { "id": "seat-slat-2", "name": "Seat slat 2", "level": "micro", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Seat slat 2: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0.0, 0.4, -0.99], "rotation": [0, 0, 0], "scale": [5.3, 0.14, 0.56] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "seat-slat-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_seat_slat_2_5.add(mesh_seat_slat_2_5);
    meshes["seat-slat-2"] = mesh_seat_slat_2_5;
    colliders["seat-slat-2"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["seat-slat-2"] ?? (destructionGroups["seat-slat-2"] = []);
    destructionGroups["seat-slat-2"].push(node_seat_slat_2_5);
    const endpoint_seat_slat_3_6 = makeAttachmentEndpoint(null);
    const node_seat_slat_3_6 = new THREE.Group();
    node_seat_slat_3_6.name = "Seat slat 3__pivot";
    node_seat_slat_3_6.scale.set(1, 1, 1);
    if (endpoint_seat_slat_3_6) {
        node_seat_slat_3_6.position.copy(endpoint_seat_slat_3_6.start);
        node_seat_slat_3_6.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_seat_slat_3_6.position.set(0.0, 0.4, -1.63);
        node_seat_slat_3_6.rotation.set(0.0, 0.0, 0.0);
    }
    node_seat_slat_3_6.userData.sculptComponent = { "id": "seat-slat-3", "name": "Seat slat 3", "level": "micro", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Seat slat 3: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0.0, 0.4, -1.63], "rotation": [0, 0, 0], "scale": [5.3, 0.14, 0.56] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "seat-slat-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_seat_slat_3_6.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "seat-slat-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["seat-frame"] ?? root).add(node_seat_slat_3_6);
    nodes["seat-slat-3"] = node_seat_slat_3_6;
    const mesh_seat_slat_3_6Geometry = endpoint_seat_slat_3_6
        ? new THREE.CylinderGeometry(endpoint_seat_slat_3_6.endRadius, endpoint_seat_slat_3_6.baseRadius, endpoint_seat_slat_3_6.length, 16, 6)
        : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    if (!endpoint_seat_slat_3_6) {
        mesh_seat_slat_3_6Geometry.scale(5.3, 0.14, 0.56);
    }
    const mesh_seat_slat_3_6 = new THREE.Mesh(mesh_seat_slat_3_6Geometry, materialMap["painted-green"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_seat_slat_3_6.name = "Seat slat 3";
    if (endpoint_seat_slat_3_6) {
        mesh_seat_slat_3_6.position.copy(endpoint_seat_slat_3_6.midpoint);
        mesh_seat_slat_3_6.quaternion.copy(endpoint_seat_slat_3_6.quaternion);
    }
    mesh_seat_slat_3_6.castShadow = options.castShadow ?? true;
    mesh_seat_slat_3_6.receiveShadow = options.receiveShadow ?? true;
    mesh_seat_slat_3_6.userData.sculptComponent = { "id": "seat-slat-3", "name": "Seat slat 3", "level": "micro", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Seat slat 3: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0.0, 0.4, -1.63], "rotation": [0, 0, 0], "scale": [5.3, 0.14, 0.56] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "seat-slat-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_seat_slat_3_6.add(mesh_seat_slat_3_6);
    meshes["seat-slat-3"] = mesh_seat_slat_3_6;
    colliders["seat-slat-3"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["seat-slat-3"] ?? (destructionGroups["seat-slat-3"] = []);
    destructionGroups["seat-slat-3"].push(node_seat_slat_3_6);
    const endpoint_seat_slat_4_7 = makeAttachmentEndpoint(null);
    const node_seat_slat_4_7 = new THREE.Group();
    node_seat_slat_4_7.name = "Seat slat 4__pivot";
    node_seat_slat_4_7.scale.set(1, 1, 1);
    if (endpoint_seat_slat_4_7) {
        node_seat_slat_4_7.position.copy(endpoint_seat_slat_4_7.start);
        node_seat_slat_4_7.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_seat_slat_4_7.position.set(0.0, 0.4, -2.27);
        node_seat_slat_4_7.rotation.set(0.0, 0.0, 0.0);
    }
    node_seat_slat_4_7.userData.sculptComponent = { "id": "seat-slat-4", "name": "Seat slat 4", "level": "micro", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Seat slat 4: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0.0, 0.4, -2.27], "rotation": [0, 0, 0], "scale": [5.3, 0.14, 0.56] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "seat-slat-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_seat_slat_4_7.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "seat-slat-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["seat-frame"] ?? root).add(node_seat_slat_4_7);
    nodes["seat-slat-4"] = node_seat_slat_4_7;
    const mesh_seat_slat_4_7Geometry = endpoint_seat_slat_4_7
        ? new THREE.CylinderGeometry(endpoint_seat_slat_4_7.endRadius, endpoint_seat_slat_4_7.baseRadius, endpoint_seat_slat_4_7.length, 16, 6)
        : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    if (!endpoint_seat_slat_4_7) {
        mesh_seat_slat_4_7Geometry.scale(5.3, 0.14, 0.56);
    }
    const mesh_seat_slat_4_7 = new THREE.Mesh(mesh_seat_slat_4_7Geometry, materialMap["painted-green"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_seat_slat_4_7.name = "Seat slat 4";
    if (endpoint_seat_slat_4_7) {
        mesh_seat_slat_4_7.position.copy(endpoint_seat_slat_4_7.midpoint);
        mesh_seat_slat_4_7.quaternion.copy(endpoint_seat_slat_4_7.quaternion);
    }
    mesh_seat_slat_4_7.castShadow = options.castShadow ?? true;
    mesh_seat_slat_4_7.receiveShadow = options.receiveShadow ?? true;
    mesh_seat_slat_4_7.userData.sculptComponent = { "id": "seat-slat-4", "name": "Seat slat 4", "level": "micro", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Seat slat 4: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0.0, 0.4, -2.27], "rotation": [0, 0, 0], "scale": [5.3, 0.14, 0.56] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "seat-slat-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_seat_slat_4_7.add(mesh_seat_slat_4_7);
    meshes["seat-slat-4"] = mesh_seat_slat_4_7;
    colliders["seat-slat-4"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["seat-slat-4"] ?? (destructionGroups["seat-slat-4"] = []);
    destructionGroups["seat-slat-4"].push(node_seat_slat_4_7);
    const endpoint_seat_slat_5_8 = makeAttachmentEndpoint(null);
    const node_seat_slat_5_8 = new THREE.Group();
    node_seat_slat_5_8.name = "Seat slat 5__pivot";
    node_seat_slat_5_8.scale.set(1, 1, 1);
    if (endpoint_seat_slat_5_8) {
        node_seat_slat_5_8.position.copy(endpoint_seat_slat_5_8.start);
        node_seat_slat_5_8.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_seat_slat_5_8.position.set(0.0, 0.4, -2.91);
        node_seat_slat_5_8.rotation.set(0.0, 0.0, 0.0);
    }
    node_seat_slat_5_8.userData.sculptComponent = { "id": "seat-slat-5", "name": "Seat slat 5", "level": "micro", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Seat slat 5: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0.0, 0.4, -2.91], "rotation": [0, 0, 0], "scale": [5.3, 0.14, 0.56] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "seat-slat-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_seat_slat_5_8.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "seat-slat-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["seat-frame"] ?? root).add(node_seat_slat_5_8);
    nodes["seat-slat-5"] = node_seat_slat_5_8;
    const mesh_seat_slat_5_8Geometry = endpoint_seat_slat_5_8
        ? new THREE.CylinderGeometry(endpoint_seat_slat_5_8.endRadius, endpoint_seat_slat_5_8.baseRadius, endpoint_seat_slat_5_8.length, 16, 6)
        : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    if (!endpoint_seat_slat_5_8) {
        mesh_seat_slat_5_8Geometry.scale(5.3, 0.14, 0.56);
    }
    const mesh_seat_slat_5_8 = new THREE.Mesh(mesh_seat_slat_5_8Geometry, materialMap["painted-green"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_seat_slat_5_8.name = "Seat slat 5";
    if (endpoint_seat_slat_5_8) {
        mesh_seat_slat_5_8.position.copy(endpoint_seat_slat_5_8.midpoint);
        mesh_seat_slat_5_8.quaternion.copy(endpoint_seat_slat_5_8.quaternion);
    }
    mesh_seat_slat_5_8.castShadow = options.castShadow ?? true;
    mesh_seat_slat_5_8.receiveShadow = options.receiveShadow ?? true;
    mesh_seat_slat_5_8.userData.sculptComponent = { "id": "seat-slat-5", "name": "Seat slat 5", "level": "micro", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Seat slat 5: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0.0, 0.4, -2.91], "rotation": [0, 0, 0], "scale": [5.3, 0.14, 0.56] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "seat-slat-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_seat_slat_5_8.add(mesh_seat_slat_5_8);
    meshes["seat-slat-5"] = mesh_seat_slat_5_8;
    colliders["seat-slat-5"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["seat-slat-5"] ?? (destructionGroups["seat-slat-5"] = []);
    destructionGroups["seat-slat-5"].push(node_seat_slat_5_8);
    const endpoint_seat_slat_6_9 = makeAttachmentEndpoint(null);
    const node_seat_slat_6_9 = new THREE.Group();
    node_seat_slat_6_9.name = "Seat slat 6__pivot";
    node_seat_slat_6_9.scale.set(1, 1, 1);
    if (endpoint_seat_slat_6_9) {
        node_seat_slat_6_9.position.copy(endpoint_seat_slat_6_9.start);
        node_seat_slat_6_9.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_seat_slat_6_9.position.set(0.0, 0.4, -3.55);
        node_seat_slat_6_9.rotation.set(0.0, 0.0, 0.0);
    }
    node_seat_slat_6_9.userData.sculptComponent = { "id": "seat-slat-6", "name": "Seat slat 6", "level": "micro", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Seat slat 6: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0.0, 0.4, -3.55], "rotation": [0, 0, 0], "scale": [5.3, 0.14, 0.56] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "seat-slat-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_seat_slat_6_9.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "seat-slat-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["seat-frame"] ?? root).add(node_seat_slat_6_9);
    nodes["seat-slat-6"] = node_seat_slat_6_9;
    const mesh_seat_slat_6_9Geometry = endpoint_seat_slat_6_9
        ? new THREE.CylinderGeometry(endpoint_seat_slat_6_9.endRadius, endpoint_seat_slat_6_9.baseRadius, endpoint_seat_slat_6_9.length, 16, 6)
        : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    if (!endpoint_seat_slat_6_9) {
        mesh_seat_slat_6_9Geometry.scale(5.3, 0.14, 0.56);
    }
    const mesh_seat_slat_6_9 = new THREE.Mesh(mesh_seat_slat_6_9Geometry, materialMap["painted-green"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_seat_slat_6_9.name = "Seat slat 6";
    if (endpoint_seat_slat_6_9) {
        mesh_seat_slat_6_9.position.copy(endpoint_seat_slat_6_9.midpoint);
        mesh_seat_slat_6_9.quaternion.copy(endpoint_seat_slat_6_9.quaternion);
    }
    mesh_seat_slat_6_9.castShadow = options.castShadow ?? true;
    mesh_seat_slat_6_9.receiveShadow = options.receiveShadow ?? true;
    mesh_seat_slat_6_9.userData.sculptComponent = { "id": "seat-slat-6", "name": "Seat slat 6", "level": "micro", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Seat slat 6: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0.0, 0.4, -3.55], "rotation": [0, 0, 0], "scale": [5.3, 0.14, 0.56] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "seat-slat-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_seat_slat_6_9.add(mesh_seat_slat_6_9);
    meshes["seat-slat-6"] = mesh_seat_slat_6_9;
    colliders["seat-slat-6"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["seat-slat-6"] ?? (destructionGroups["seat-slat-6"] = []);
    destructionGroups["seat-slat-6"].push(node_seat_slat_6_9);
    const endpoint_front_post_l_10 = makeAttachmentEndpoint(null);
    const node_front_post_l_10 = new THREE.Group();
    node_front_post_l_10.name = "Front post l__pivot";
    node_front_post_l_10.scale.set(1, 1, 1);
    if (endpoint_front_post_l_10) {
        node_front_post_l_10.position.copy(endpoint_front_post_l_10.start);
        node_front_post_l_10.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_front_post_l_10.position.set(2.55, 0.46, -0.17);
        node_front_post_l_10.rotation.set(0.0, 0.0, 0.0);
    }
    node_front_post_l_10.userData.sculptComponent = { "id": "front-post-l", "name": "Front post l", "level": "meso", "role": "leg", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Front post l: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": { "parentId": "seat-frame", "parentSocket": "seat-frame-joint", "localStart": [2.55, -1.62, -0.17], "localEnd": [2.55, 2.54, -0.17], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [2.55, 0.46, -0.17], "rotation": [0, 0, 0], "scale": [0.56, 4.16, 0.56] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "front-post-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "post-wear-l", "kind": "scratch", "notes": "brown wood through the paint on the lower post" }], "surfaceDetail": { "macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.01, "normalPattern": "brush strokes along the grain", "displacementPattern": "", "occlusionPattern": "dark green in joints", "edgeWearPattern": "paint worn to brown wood on arrises and lower legs", "notes": "surface-pass: wear on edges, satin paint elsewhere" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_front_post_l_10.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "front-post-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["seat-frame"] ?? root).add(node_front_post_l_10);
    nodes["front-post-l"] = node_front_post_l_10;
    const mesh_front_post_l_10Geometry = endpoint_front_post_l_10
        ? new THREE.CylinderGeometry(endpoint_front_post_l_10.endRadius, endpoint_front_post_l_10.baseRadius, endpoint_front_post_l_10.length, 16, 6)
        : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    if (!endpoint_front_post_l_10) {
        mesh_front_post_l_10Geometry.scale(0.56, 4.16, 0.56);
    }
    const mesh_front_post_l_10 = new THREE.Mesh(mesh_front_post_l_10Geometry, materialMap["painted-green"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_front_post_l_10.name = "Front post l";
    if (endpoint_front_post_l_10) {
        mesh_front_post_l_10.position.copy(endpoint_front_post_l_10.midpoint);
        mesh_front_post_l_10.quaternion.copy(endpoint_front_post_l_10.quaternion);
    }
    mesh_front_post_l_10.castShadow = options.castShadow ?? true;
    mesh_front_post_l_10.receiveShadow = options.receiveShadow ?? true;
    mesh_front_post_l_10.userData.sculptComponent = { "id": "front-post-l", "name": "Front post l", "level": "meso", "role": "leg", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Front post l: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": { "parentId": "seat-frame", "parentSocket": "seat-frame-joint", "localStart": [2.55, -1.62, -0.17], "localEnd": [2.55, 2.54, -0.17], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [2.55, 0.46, -0.17], "rotation": [0, 0, 0], "scale": [0.56, 4.16, 0.56] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "front-post-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "post-wear-l", "kind": "scratch", "notes": "brown wood through the paint on the lower post" }], "surfaceDetail": { "macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.01, "normalPattern": "brush strokes along the grain", "displacementPattern": "", "occlusionPattern": "dark green in joints", "edgeWearPattern": "paint worn to brown wood on arrises and lower legs", "notes": "surface-pass: wear on edges, satin paint elsewhere" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_front_post_l_10.add(mesh_front_post_l_10);
    meshes["front-post-l"] = mesh_front_post_l_10;
    colliders["front-post-l"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["front-post-l"] ?? (destructionGroups["front-post-l"] = []);
    destructionGroups["front-post-l"].push(node_front_post_l_10);
    const endpoint_back_stile_l_11 = makeAttachmentEndpoint(null);
    const node_back_stile_l_11 = new THREE.Group();
    node_back_stile_l_11.name = "Back stile l__pivot";
    node_back_stile_l_11.scale.set(1, 1, 1);
    if (endpoint_back_stile_l_11) {
        node_back_stile_l_11.position.copy(endpoint_back_stile_l_11.start);
        node_back_stile_l_11.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_back_stile_l_11.position.set(0.0, 0.0, 0.0);
        node_back_stile_l_11.rotation.set(0.0, 0.0, 0.0);
    }
    node_back_stile_l_11.userData.sculptComponent = { "id": "back-stile-l", "name": "Back stile l", "level": "macro", "role": "leg", "importance": 0.8, "confidence": 0.8, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "One bent post from floor to crest; a swept section follows the lean.", "geometryDescriptor": { "topologyIntent": "tapered-sweep built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "taperedSweep": { "stations": [{ "position": [2.55, -1.62, -3.7], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, -1.452, -3.6995], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, -1.212, -3.6986], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, -0.936, -3.6978], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, -0.66, -3.6981], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, -0.42, -3.7], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, -0.2272, -3.7018], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, -0.0576, -3.7031], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 0.1056, -3.7065], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 0.2792, -3.7146], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 0.48, -3.73], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 0.716, -3.7514], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 0.976, -3.7769], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 1.248, -3.8087], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 1.52, -3.849], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 1.78, -3.9], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 2.0232, -3.9677], "rx": 0.298, "rz": 0.298, "twist": 0.0 }, { "position": [2.55, 2.2576, -4.0506], "rx": 0.296, "rz": 0.296, "twist": 0.0 }, { "position": [2.55, 2.4904, -4.1398], "rx": 0.294, "rz": 0.294, "twist": 0.0 }, { "position": [2.55, 2.7288, -4.2259], "rx": 0.292, "rz": 0.292, "twist": 0.0 }, { "position": [2.55, 2.98, -4.3], "rx": 0.29, "rz": 0.29, "twist": 0.0 }, { "position": [2.55, 3.2488, -4.3601], "rx": 0.288, "rz": 0.288, "twist": 0.0 }, { "position": [2.55, 3.5304, -4.4122], "rx": 0.286, "rz": 0.286, "twist": 0.0 }, { "position": [2.55, 3.8176, -4.4594], "rx": 0.284, "rz": 0.284, "twist": 0.0 }, { "position": [2.55, 4.1032, -4.5043], "rx": 0.282, "rz": 0.282, "twist": 0.0 }, { "position": [2.55, 4.38, -4.55], "rx": 0.28, "rz": 0.28, "twist": 0.0 }, { "position": [2.55, 4.6504, -4.5958], "rx": 0.278, "rz": 0.278, "twist": 0.0 }, { "position": [2.55, 4.9192, -4.6397], "rx": 0.276, "rz": 0.276, "twist": 0.0 }, { "position": [2.55, 5.1828, -4.6827], "rx": 0.274, "rz": 0.274, "twist": 0.0 }, { "position": [2.55, 5.4376, -4.7258], "rx": 0.272, "rz": 0.272, "twist": 0.0 }, { "position": [2.55, 5.68, -4.77], "rx": 0.27, "rz": 0.27, "twist": 0.0 }, { "position": [2.55, 5.9228, -4.819], "rx": 0.246, "rz": 0.246, "twist": 0.0 }, { "position": [2.55, 6.1684, -4.8723], "rx": 0.222, "rz": 0.222, "twist": 0.0 }, { "position": [2.55, 6.3976, -4.9241], "rx": 0.198, "rz": 0.198, "twist": 0.0 }, { "position": [2.55, 6.5912, -4.9686], "rx": 0.174, "rz": 0.174, "twist": 0.0 }, { "position": [2.55, 6.73, -5.0], "rx": 0.15, "rz": 0.15, "twist": 0.0 }], "radialSegments": 4, "capEnds": true } }, "parent": "seat-frame", "attachment": { "parentId": "seat-frame", "parentSocket": "seat-frame-joint", "localStart": [2.55, -1.62, -3.7], "localEnd": [2.55, 6.73, -5.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "back-stile-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "stile-lean-l", "kind": "contour", "notes": "back lean ~15 deg above the seat" }], "surfaceDetail": { "macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.01, "normalPattern": "brush strokes along the grain", "displacementPattern": "", "occlusionPattern": "dark green in joints", "edgeWearPattern": "paint worn to brown wood on arrises and lower legs", "notes": "surface-pass: wear on edges, satin paint elsewhere" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_back_stile_l_11.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "back-stile-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["seat-frame"] ?? root).add(node_back_stile_l_11);
    nodes["back-stile-l"] = node_back_stile_l_11;
    const mesh_back_stile_l_11Geometry = endpoint_back_stile_l_11
        ? new THREE.CylinderGeometry(endpoint_back_stile_l_11.endRadius, endpoint_back_stile_l_11.baseRadius, endpoint_back_stile_l_11.length, 16, 6)
        : buildTaperedSweepGeometry({ "stations": [{ "position": [2.55, -1.62, -3.7], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, -1.452, -3.6995], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, -1.212, -3.6986], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, -0.936, -3.6978], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, -0.66, -3.6981], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, -0.42, -3.7], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, -0.2272, -3.7018], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, -0.0576, -3.7031], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 0.1056, -3.7065], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 0.2792, -3.7146], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 0.48, -3.73], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 0.716, -3.7514], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 0.976, -3.7769], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 1.248, -3.8087], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 1.52, -3.849], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 1.78, -3.9], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 2.0232, -3.9677], "rx": 0.298, "rz": 0.298, "twist": 0.0 }, { "position": [2.55, 2.2576, -4.0506], "rx": 0.296, "rz": 0.296, "twist": 0.0 }, { "position": [2.55, 2.4904, -4.1398], "rx": 0.294, "rz": 0.294, "twist": 0.0 }, { "position": [2.55, 2.7288, -4.2259], "rx": 0.292, "rz": 0.292, "twist": 0.0 }, { "position": [2.55, 2.98, -4.3], "rx": 0.29, "rz": 0.29, "twist": 0.0 }, { "position": [2.55, 3.2488, -4.3601], "rx": 0.288, "rz": 0.288, "twist": 0.0 }, { "position": [2.55, 3.5304, -4.4122], "rx": 0.286, "rz": 0.286, "twist": 0.0 }, { "position": [2.55, 3.8176, -4.4594], "rx": 0.284, "rz": 0.284, "twist": 0.0 }, { "position": [2.55, 4.1032, -4.5043], "rx": 0.282, "rz": 0.282, "twist": 0.0 }, { "position": [2.55, 4.38, -4.55], "rx": 0.28, "rz": 0.28, "twist": 0.0 }, { "position": [2.55, 4.6504, -4.5958], "rx": 0.278, "rz": 0.278, "twist": 0.0 }, { "position": [2.55, 4.9192, -4.6397], "rx": 0.276, "rz": 0.276, "twist": 0.0 }, { "position": [2.55, 5.1828, -4.6827], "rx": 0.274, "rz": 0.274, "twist": 0.0 }, { "position": [2.55, 5.4376, -4.7258], "rx": 0.272, "rz": 0.272, "twist": 0.0 }, { "position": [2.55, 5.68, -4.77], "rx": 0.27, "rz": 0.27, "twist": 0.0 }, { "position": [2.55, 5.9228, -4.819], "rx": 0.246, "rz": 0.246, "twist": 0.0 }, { "position": [2.55, 6.1684, -4.8723], "rx": 0.222, "rz": 0.222, "twist": 0.0 }, { "position": [2.55, 6.3976, -4.9241], "rx": 0.198, "rz": 0.198, "twist": 0.0 }, { "position": [2.55, 6.5912, -4.9686], "rx": 0.174, "rz": 0.174, "twist": 0.0 }, { "position": [2.55, 6.73, -5.0], "rx": 0.15, "rz": 0.15, "twist": 0.0 }], "radialSegments": 4, "capEnds": true });
    if (!endpoint_back_stile_l_11) {
        mesh_back_stile_l_11Geometry.scale(1.0, 1.0, 1.0);
    }
    const mesh_back_stile_l_11 = new THREE.Mesh(mesh_back_stile_l_11Geometry, materialMap["painted-green"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_back_stile_l_11.name = "Back stile l";
    if (endpoint_back_stile_l_11) {
        mesh_back_stile_l_11.position.copy(endpoint_back_stile_l_11.midpoint);
        mesh_back_stile_l_11.quaternion.copy(endpoint_back_stile_l_11.quaternion);
    }
    mesh_back_stile_l_11.castShadow = options.castShadow ?? true;
    mesh_back_stile_l_11.receiveShadow = options.receiveShadow ?? true;
    mesh_back_stile_l_11.userData.sculptComponent = { "id": "back-stile-l", "name": "Back stile l", "level": "macro", "role": "leg", "importance": 0.8, "confidence": 0.8, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "One bent post from floor to crest; a swept section follows the lean.", "geometryDescriptor": { "topologyIntent": "tapered-sweep built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "taperedSweep": { "stations": [{ "position": [2.55, -1.62, -3.7], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, -1.452, -3.6995], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, -1.212, -3.6986], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, -0.936, -3.6978], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, -0.66, -3.6981], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, -0.42, -3.7], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, -0.2272, -3.7018], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, -0.0576, -3.7031], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 0.1056, -3.7065], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 0.2792, -3.7146], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 0.48, -3.73], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 0.716, -3.7514], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 0.976, -3.7769], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 1.248, -3.8087], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 1.52, -3.849], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 1.78, -3.9], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.55, 2.0232, -3.9677], "rx": 0.298, "rz": 0.298, "twist": 0.0 }, { "position": [2.55, 2.2576, -4.0506], "rx": 0.296, "rz": 0.296, "twist": 0.0 }, { "position": [2.55, 2.4904, -4.1398], "rx": 0.294, "rz": 0.294, "twist": 0.0 }, { "position": [2.55, 2.7288, -4.2259], "rx": 0.292, "rz": 0.292, "twist": 0.0 }, { "position": [2.55, 2.98, -4.3], "rx": 0.29, "rz": 0.29, "twist": 0.0 }, { "position": [2.55, 3.2488, -4.3601], "rx": 0.288, "rz": 0.288, "twist": 0.0 }, { "position": [2.55, 3.5304, -4.4122], "rx": 0.286, "rz": 0.286, "twist": 0.0 }, { "position": [2.55, 3.8176, -4.4594], "rx": 0.284, "rz": 0.284, "twist": 0.0 }, { "position": [2.55, 4.1032, -4.5043], "rx": 0.282, "rz": 0.282, "twist": 0.0 }, { "position": [2.55, 4.38, -4.55], "rx": 0.28, "rz": 0.28, "twist": 0.0 }, { "position": [2.55, 4.6504, -4.5958], "rx": 0.278, "rz": 0.278, "twist": 0.0 }, { "position": [2.55, 4.9192, -4.6397], "rx": 0.276, "rz": 0.276, "twist": 0.0 }, { "position": [2.55, 5.1828, -4.6827], "rx": 0.274, "rz": 0.274, "twist": 0.0 }, { "position": [2.55, 5.4376, -4.7258], "rx": 0.272, "rz": 0.272, "twist": 0.0 }, { "position": [2.55, 5.68, -4.77], "rx": 0.27, "rz": 0.27, "twist": 0.0 }, { "position": [2.55, 5.9228, -4.819], "rx": 0.246, "rz": 0.246, "twist": 0.0 }, { "position": [2.55, 6.1684, -4.8723], "rx": 0.222, "rz": 0.222, "twist": 0.0 }, { "position": [2.55, 6.3976, -4.9241], "rx": 0.198, "rz": 0.198, "twist": 0.0 }, { "position": [2.55, 6.5912, -4.9686], "rx": 0.174, "rz": 0.174, "twist": 0.0 }, { "position": [2.55, 6.73, -5.0], "rx": 0.15, "rz": 0.15, "twist": 0.0 }], "radialSegments": 4, "capEnds": true } }, "parent": "seat-frame", "attachment": { "parentId": "seat-frame", "parentSocket": "seat-frame-joint", "localStart": [2.55, -1.62, -3.7], "localEnd": [2.55, 6.73, -5.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "back-stile-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "stile-lean-l", "kind": "contour", "notes": "back lean ~15 deg above the seat" }], "surfaceDetail": { "macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.01, "normalPattern": "brush strokes along the grain", "displacementPattern": "", "occlusionPattern": "dark green in joints", "edgeWearPattern": "paint worn to brown wood on arrises and lower legs", "notes": "surface-pass: wear on edges, satin paint elsewhere" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_back_stile_l_11.add(mesh_back_stile_l_11);
    meshes["back-stile-l"] = mesh_back_stile_l_11;
    colliders["back-stile-l"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["back-stile-l"] ?? (destructionGroups["back-stile-l"] = []);
    destructionGroups["back-stile-l"].push(node_back_stile_l_11);
    const endpoint_arm_l_12 = makeAttachmentEndpoint(null);
    const node_arm_l_12 = new THREE.Group();
    node_arm_l_12.name = "Arm l__pivot";
    node_arm_l_12.scale.set(1, 1, 1);
    if (endpoint_arm_l_12) {
        node_arm_l_12.position.copy(endpoint_arm_l_12.start);
        node_arm_l_12.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_arm_l_12.position.set(0.0, 0.0, 0.0);
        node_arm_l_12.rotation.set(0.0, 0.0, 0.0);
    }
    node_arm_l_12.userData.sculptComponent = { "id": "arm-l", "name": "Arm l", "level": "meso", "role": "arm", "importance": 0.8, "confidence": 0.8, "primitive": "tapered-sweep", "topologyClass": "assembled-solid", "topologyRationale": "Arm l: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "tapered-sweep built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "taperedSweep": { "stations": [{ "position": [2.805, 2.68, 0.4], "rx": 0.12, "rz": 0.17, "twist": 0.0 }, { "position": [2.7962, 2.6808, 0.2844], "rx": 0.18, "rz": 0.162, "twist": 0.0 }, { "position": [2.7848, 2.6824, 0.1292], "rx": 0.24, "rz": 0.154, "twist": 0.0 }, { "position": [2.7701, 2.6836, -0.0632], "rx": 0.3, "rz": 0.146, "twist": 0.0 }, { "position": [2.7516, 2.6832, -0.2904], "rx": 0.36, "rz": 0.138, "twist": 0.0 }, { "position": [2.7285, 2.68, -0.55], "rx": 0.42, "rz": 0.13, "twist": 0.0 }, { "position": [2.6965, 2.674, -0.8588], "rx": 0.416, "rz": 0.128, "twist": 0.0 }, { "position": [2.6559, 2.666, -1.2184], "rx": 0.412, "rz": 0.126, "twist": 0.0 }, { "position": [2.6134, 2.656, -1.6036], "rx": 0.408, "rz": 0.124, "twist": 0.0 }, { "position": [2.5759, 2.644, -1.9892], "rx": 0.404, "rz": 0.122, "twist": 0.0 }, { "position": [2.55, 2.63, -2.35], "rx": 0.4, "rz": 0.12, "twist": 0.0 }, { "position": [2.5386, 2.6116, -2.7084], "rx": 0.392, "rz": 0.12, "twist": 0.0 }, { "position": [2.5371, 2.5888, -3.0812], "rx": 0.384, "rz": 0.12, "twist": 0.0 }, { "position": [2.5414, 2.5652, -3.4348], "rx": 0.376, "rz": 0.12, "twist": 0.0 }, { "position": [2.5471, 2.5444, -3.7356], "rx": 0.368, "rz": 0.12, "twist": 0.0 }, { "position": [2.55, 2.53, -3.95], "rx": 0.36, "rz": 0.12, "twist": 0.0 }], "radialSegments": 12, "capEnds": true } }, "parent": "seat-frame", "attachment": { "parentId": "seat-frame", "parentSocket": "seat-frame-joint", "localStart": [2.55, 2.54, -0.17], "localEnd": [2.55, 2.53, -3.95], "contactType": "socket", "embedDepth": 0.05, "gapTolerance": 0.02 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "arm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "arm-roll-l", "kind": "contour", "notes": "rounded overhanging arm front" }], "surfaceDetail": { "macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.01, "normalPattern": "brush strokes along the grain", "displacementPattern": "", "occlusionPattern": "dark green in joints", "edgeWearPattern": "paint worn to brown wood on arrises and lower legs", "notes": "surface-pass: wear on edges, satin paint elsewhere" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_arm_l_12.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "arm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["seat-frame"] ?? root).add(node_arm_l_12);
    nodes["arm-l"] = node_arm_l_12;
    const mesh_arm_l_12Geometry = endpoint_arm_l_12
        ? new THREE.CylinderGeometry(endpoint_arm_l_12.endRadius, endpoint_arm_l_12.baseRadius, endpoint_arm_l_12.length, 16, 6)
        : buildTaperedSweepGeometry({ "stations": [{ "position": [2.805, 2.68, 0.4], "rx": 0.12, "rz": 0.17, "twist": 0.0 }, { "position": [2.7962, 2.6808, 0.2844], "rx": 0.18, "rz": 0.162, "twist": 0.0 }, { "position": [2.7848, 2.6824, 0.1292], "rx": 0.24, "rz": 0.154, "twist": 0.0 }, { "position": [2.7701, 2.6836, -0.0632], "rx": 0.3, "rz": 0.146, "twist": 0.0 }, { "position": [2.7516, 2.6832, -0.2904], "rx": 0.36, "rz": 0.138, "twist": 0.0 }, { "position": [2.7285, 2.68, -0.55], "rx": 0.42, "rz": 0.13, "twist": 0.0 }, { "position": [2.6965, 2.674, -0.8588], "rx": 0.416, "rz": 0.128, "twist": 0.0 }, { "position": [2.6559, 2.666, -1.2184], "rx": 0.412, "rz": 0.126, "twist": 0.0 }, { "position": [2.6134, 2.656, -1.6036], "rx": 0.408, "rz": 0.124, "twist": 0.0 }, { "position": [2.5759, 2.644, -1.9892], "rx": 0.404, "rz": 0.122, "twist": 0.0 }, { "position": [2.55, 2.63, -2.35], "rx": 0.4, "rz": 0.12, "twist": 0.0 }, { "position": [2.5386, 2.6116, -2.7084], "rx": 0.392, "rz": 0.12, "twist": 0.0 }, { "position": [2.5371, 2.5888, -3.0812], "rx": 0.384, "rz": 0.12, "twist": 0.0 }, { "position": [2.5414, 2.5652, -3.4348], "rx": 0.376, "rz": 0.12, "twist": 0.0 }, { "position": [2.5471, 2.5444, -3.7356], "rx": 0.368, "rz": 0.12, "twist": 0.0 }, { "position": [2.55, 2.53, -3.95], "rx": 0.36, "rz": 0.12, "twist": 0.0 }], "radialSegments": 12, "capEnds": true });
    if (!endpoint_arm_l_12) {
        mesh_arm_l_12Geometry.scale(1.0, 1.0, 1.0);
    }
    const mesh_arm_l_12 = new THREE.Mesh(mesh_arm_l_12Geometry, materialMap["painted-green"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_arm_l_12.name = "Arm l";
    if (endpoint_arm_l_12) {
        mesh_arm_l_12.position.copy(endpoint_arm_l_12.midpoint);
        mesh_arm_l_12.quaternion.copy(endpoint_arm_l_12.quaternion);
    }
    mesh_arm_l_12.castShadow = options.castShadow ?? true;
    mesh_arm_l_12.receiveShadow = options.receiveShadow ?? true;
    mesh_arm_l_12.userData.sculptComponent = { "id": "arm-l", "name": "Arm l", "level": "meso", "role": "arm", "importance": 0.8, "confidence": 0.8, "primitive": "tapered-sweep", "topologyClass": "assembled-solid", "topologyRationale": "Arm l: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "tapered-sweep built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "taperedSweep": { "stations": [{ "position": [2.805, 2.68, 0.4], "rx": 0.12, "rz": 0.17, "twist": 0.0 }, { "position": [2.7962, 2.6808, 0.2844], "rx": 0.18, "rz": 0.162, "twist": 0.0 }, { "position": [2.7848, 2.6824, 0.1292], "rx": 0.24, "rz": 0.154, "twist": 0.0 }, { "position": [2.7701, 2.6836, -0.0632], "rx": 0.3, "rz": 0.146, "twist": 0.0 }, { "position": [2.7516, 2.6832, -0.2904], "rx": 0.36, "rz": 0.138, "twist": 0.0 }, { "position": [2.7285, 2.68, -0.55], "rx": 0.42, "rz": 0.13, "twist": 0.0 }, { "position": [2.6965, 2.674, -0.8588], "rx": 0.416, "rz": 0.128, "twist": 0.0 }, { "position": [2.6559, 2.666, -1.2184], "rx": 0.412, "rz": 0.126, "twist": 0.0 }, { "position": [2.6134, 2.656, -1.6036], "rx": 0.408, "rz": 0.124, "twist": 0.0 }, { "position": [2.5759, 2.644, -1.9892], "rx": 0.404, "rz": 0.122, "twist": 0.0 }, { "position": [2.55, 2.63, -2.35], "rx": 0.4, "rz": 0.12, "twist": 0.0 }, { "position": [2.5386, 2.6116, -2.7084], "rx": 0.392, "rz": 0.12, "twist": 0.0 }, { "position": [2.5371, 2.5888, -3.0812], "rx": 0.384, "rz": 0.12, "twist": 0.0 }, { "position": [2.5414, 2.5652, -3.4348], "rx": 0.376, "rz": 0.12, "twist": 0.0 }, { "position": [2.5471, 2.5444, -3.7356], "rx": 0.368, "rz": 0.12, "twist": 0.0 }, { "position": [2.55, 2.53, -3.95], "rx": 0.36, "rz": 0.12, "twist": 0.0 }], "radialSegments": 12, "capEnds": true } }, "parent": "seat-frame", "attachment": { "parentId": "seat-frame", "parentSocket": "seat-frame-joint", "localStart": [2.55, 2.54, -0.17], "localEnd": [2.55, 2.53, -3.95], "contactType": "socket", "embedDepth": 0.05, "gapTolerance": 0.02 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "arm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "arm-roll-l", "kind": "contour", "notes": "rounded overhanging arm front" }], "surfaceDetail": { "macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.01, "normalPattern": "brush strokes along the grain", "displacementPattern": "", "occlusionPattern": "dark green in joints", "edgeWearPattern": "paint worn to brown wood on arrises and lower legs", "notes": "surface-pass: wear on edges, satin paint elsewhere" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_arm_l_12.add(mesh_arm_l_12);
    meshes["arm-l"] = mesh_arm_l_12;
    colliders["arm-l"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["arm-l"] ?? (destructionGroups["arm-l"] = []);
    destructionGroups["arm-l"].push(node_arm_l_12);
    const endpoint_front_post_r_13 = makeAttachmentEndpoint(null);
    const node_front_post_r_13 = new THREE.Group();
    node_front_post_r_13.name = "Front post r__pivot";
    node_front_post_r_13.scale.set(1, 1, 1);
    if (endpoint_front_post_r_13) {
        node_front_post_r_13.position.copy(endpoint_front_post_r_13.start);
        node_front_post_r_13.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_front_post_r_13.position.set(-2.55, 0.46, -0.17);
        node_front_post_r_13.rotation.set(0.0, 0.0, 0.0);
    }
    node_front_post_r_13.userData.sculptComponent = { "id": "front-post-r", "name": "Front post r", "level": "meso", "role": "leg", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Front post r: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": { "parentId": "seat-frame", "parentSocket": "seat-frame-joint", "localStart": [-2.55, -1.62, -0.17], "localEnd": [-2.55, 2.54, -0.17], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [-2.55, 0.46, -0.17], "rotation": [0, 0, 0], "scale": [0.56, 4.16, 0.56] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "front-post-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "post-wear-r", "kind": "scratch", "notes": "brown wood through the paint on the lower post" }], "surfaceDetail": { "macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.01, "normalPattern": "brush strokes along the grain", "displacementPattern": "", "occlusionPattern": "dark green in joints", "edgeWearPattern": "paint worn to brown wood on arrises and lower legs", "notes": "surface-pass: wear on edges, satin paint elsewhere" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_front_post_r_13.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "front-post-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["seat-frame"] ?? root).add(node_front_post_r_13);
    nodes["front-post-r"] = node_front_post_r_13;
    const mesh_front_post_r_13Geometry = endpoint_front_post_r_13
        ? new THREE.CylinderGeometry(endpoint_front_post_r_13.endRadius, endpoint_front_post_r_13.baseRadius, endpoint_front_post_r_13.length, 16, 6)
        : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    if (!endpoint_front_post_r_13) {
        mesh_front_post_r_13Geometry.scale(0.56, 4.16, 0.56);
    }
    const mesh_front_post_r_13 = new THREE.Mesh(mesh_front_post_r_13Geometry, materialMap["painted-green"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_front_post_r_13.name = "Front post r";
    if (endpoint_front_post_r_13) {
        mesh_front_post_r_13.position.copy(endpoint_front_post_r_13.midpoint);
        mesh_front_post_r_13.quaternion.copy(endpoint_front_post_r_13.quaternion);
    }
    mesh_front_post_r_13.castShadow = options.castShadow ?? true;
    mesh_front_post_r_13.receiveShadow = options.receiveShadow ?? true;
    mesh_front_post_r_13.userData.sculptComponent = { "id": "front-post-r", "name": "Front post r", "level": "meso", "role": "leg", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Front post r: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": { "parentId": "seat-frame", "parentSocket": "seat-frame-joint", "localStart": [-2.55, -1.62, -0.17], "localEnd": [-2.55, 2.54, -0.17], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [-2.55, 0.46, -0.17], "rotation": [0, 0, 0], "scale": [0.56, 4.16, 0.56] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "front-post-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "post-wear-r", "kind": "scratch", "notes": "brown wood through the paint on the lower post" }], "surfaceDetail": { "macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.01, "normalPattern": "brush strokes along the grain", "displacementPattern": "", "occlusionPattern": "dark green in joints", "edgeWearPattern": "paint worn to brown wood on arrises and lower legs", "notes": "surface-pass: wear on edges, satin paint elsewhere" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_front_post_r_13.add(mesh_front_post_r_13);
    meshes["front-post-r"] = mesh_front_post_r_13;
    colliders["front-post-r"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["front-post-r"] ?? (destructionGroups["front-post-r"] = []);
    destructionGroups["front-post-r"].push(node_front_post_r_13);
    const endpoint_back_stile_r_14 = makeAttachmentEndpoint(null);
    const node_back_stile_r_14 = new THREE.Group();
    node_back_stile_r_14.name = "Back stile r__pivot";
    node_back_stile_r_14.scale.set(1, 1, 1);
    if (endpoint_back_stile_r_14) {
        node_back_stile_r_14.position.copy(endpoint_back_stile_r_14.start);
        node_back_stile_r_14.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_back_stile_r_14.position.set(0.0, 0.0, 0.0);
        node_back_stile_r_14.rotation.set(0.0, 0.0, 0.0);
    }
    node_back_stile_r_14.userData.sculptComponent = { "id": "back-stile-r", "name": "Back stile r", "level": "macro", "role": "leg", "importance": 0.8, "confidence": 0.8, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "One bent post from floor to crest; a swept section follows the lean.", "geometryDescriptor": { "topologyIntent": "tapered-sweep built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "taperedSweep": { "stations": [{ "position": [-2.55, -1.62, -3.7], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, -1.452, -3.6995], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, -1.212, -3.6986], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, -0.936, -3.6978], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, -0.66, -3.6981], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, -0.42, -3.7], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, -0.2272, -3.7018], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, -0.0576, -3.7031], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 0.1056, -3.7065], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 0.2792, -3.7146], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 0.48, -3.73], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 0.716, -3.7514], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 0.976, -3.7769], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 1.248, -3.8087], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 1.52, -3.849], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 1.78, -3.9], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 2.0232, -3.9677], "rx": 0.298, "rz": 0.298, "twist": 0.0 }, { "position": [-2.55, 2.2576, -4.0506], "rx": 0.296, "rz": 0.296, "twist": 0.0 }, { "position": [-2.55, 2.4904, -4.1398], "rx": 0.294, "rz": 0.294, "twist": 0.0 }, { "position": [-2.55, 2.7288, -4.2259], "rx": 0.292, "rz": 0.292, "twist": 0.0 }, { "position": [-2.55, 2.98, -4.3], "rx": 0.29, "rz": 0.29, "twist": 0.0 }, { "position": [-2.55, 3.2488, -4.3601], "rx": 0.288, "rz": 0.288, "twist": 0.0 }, { "position": [-2.55, 3.5304, -4.4122], "rx": 0.286, "rz": 0.286, "twist": 0.0 }, { "position": [-2.55, 3.8176, -4.4594], "rx": 0.284, "rz": 0.284, "twist": 0.0 }, { "position": [-2.55, 4.1032, -4.5043], "rx": 0.282, "rz": 0.282, "twist": 0.0 }, { "position": [-2.55, 4.38, -4.55], "rx": 0.28, "rz": 0.28, "twist": 0.0 }, { "position": [-2.55, 4.6504, -4.5958], "rx": 0.278, "rz": 0.278, "twist": 0.0 }, { "position": [-2.55, 4.9192, -4.6397], "rx": 0.276, "rz": 0.276, "twist": 0.0 }, { "position": [-2.55, 5.1828, -4.6827], "rx": 0.274, "rz": 0.274, "twist": 0.0 }, { "position": [-2.55, 5.4376, -4.7258], "rx": 0.272, "rz": 0.272, "twist": 0.0 }, { "position": [-2.55, 5.68, -4.77], "rx": 0.27, "rz": 0.27, "twist": 0.0 }, { "position": [-2.55, 5.9228, -4.819], "rx": 0.246, "rz": 0.246, "twist": 0.0 }, { "position": [-2.55, 6.1684, -4.8723], "rx": 0.222, "rz": 0.222, "twist": 0.0 }, { "position": [-2.55, 6.3976, -4.9241], "rx": 0.198, "rz": 0.198, "twist": 0.0 }, { "position": [-2.55, 6.5912, -4.9686], "rx": 0.174, "rz": 0.174, "twist": 0.0 }, { "position": [-2.55, 6.73, -5.0], "rx": 0.15, "rz": 0.15, "twist": 0.0 }], "radialSegments": 4, "capEnds": true } }, "parent": "seat-frame", "attachment": { "parentId": "seat-frame", "parentSocket": "seat-frame-joint", "localStart": [-2.55, -1.62, -3.7], "localEnd": [-2.55, 6.73, -5.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "back-stile-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "stile-lean-r", "kind": "contour", "notes": "back lean ~15 deg above the seat" }], "surfaceDetail": { "macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.01, "normalPattern": "brush strokes along the grain", "displacementPattern": "", "occlusionPattern": "dark green in joints", "edgeWearPattern": "paint worn to brown wood on arrises and lower legs", "notes": "surface-pass: wear on edges, satin paint elsewhere" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_back_stile_r_14.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "back-stile-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["seat-frame"] ?? root).add(node_back_stile_r_14);
    nodes["back-stile-r"] = node_back_stile_r_14;
    const mesh_back_stile_r_14Geometry = endpoint_back_stile_r_14
        ? new THREE.CylinderGeometry(endpoint_back_stile_r_14.endRadius, endpoint_back_stile_r_14.baseRadius, endpoint_back_stile_r_14.length, 16, 6)
        : buildTaperedSweepGeometry({ "stations": [{ "position": [-2.55, -1.62, -3.7], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, -1.452, -3.6995], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, -1.212, -3.6986], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, -0.936, -3.6978], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, -0.66, -3.6981], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, -0.42, -3.7], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, -0.2272, -3.7018], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, -0.0576, -3.7031], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 0.1056, -3.7065], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 0.2792, -3.7146], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 0.48, -3.73], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 0.716, -3.7514], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 0.976, -3.7769], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 1.248, -3.8087], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 1.52, -3.849], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 1.78, -3.9], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 2.0232, -3.9677], "rx": 0.298, "rz": 0.298, "twist": 0.0 }, { "position": [-2.55, 2.2576, -4.0506], "rx": 0.296, "rz": 0.296, "twist": 0.0 }, { "position": [-2.55, 2.4904, -4.1398], "rx": 0.294, "rz": 0.294, "twist": 0.0 }, { "position": [-2.55, 2.7288, -4.2259], "rx": 0.292, "rz": 0.292, "twist": 0.0 }, { "position": [-2.55, 2.98, -4.3], "rx": 0.29, "rz": 0.29, "twist": 0.0 }, { "position": [-2.55, 3.2488, -4.3601], "rx": 0.288, "rz": 0.288, "twist": 0.0 }, { "position": [-2.55, 3.5304, -4.4122], "rx": 0.286, "rz": 0.286, "twist": 0.0 }, { "position": [-2.55, 3.8176, -4.4594], "rx": 0.284, "rz": 0.284, "twist": 0.0 }, { "position": [-2.55, 4.1032, -4.5043], "rx": 0.282, "rz": 0.282, "twist": 0.0 }, { "position": [-2.55, 4.38, -4.55], "rx": 0.28, "rz": 0.28, "twist": 0.0 }, { "position": [-2.55, 4.6504, -4.5958], "rx": 0.278, "rz": 0.278, "twist": 0.0 }, { "position": [-2.55, 4.9192, -4.6397], "rx": 0.276, "rz": 0.276, "twist": 0.0 }, { "position": [-2.55, 5.1828, -4.6827], "rx": 0.274, "rz": 0.274, "twist": 0.0 }, { "position": [-2.55, 5.4376, -4.7258], "rx": 0.272, "rz": 0.272, "twist": 0.0 }, { "position": [-2.55, 5.68, -4.77], "rx": 0.27, "rz": 0.27, "twist": 0.0 }, { "position": [-2.55, 5.9228, -4.819], "rx": 0.246, "rz": 0.246, "twist": 0.0 }, { "position": [-2.55, 6.1684, -4.8723], "rx": 0.222, "rz": 0.222, "twist": 0.0 }, { "position": [-2.55, 6.3976, -4.9241], "rx": 0.198, "rz": 0.198, "twist": 0.0 }, { "position": [-2.55, 6.5912, -4.9686], "rx": 0.174, "rz": 0.174, "twist": 0.0 }, { "position": [-2.55, 6.73, -5.0], "rx": 0.15, "rz": 0.15, "twist": 0.0 }], "radialSegments": 4, "capEnds": true });
    if (!endpoint_back_stile_r_14) {
        mesh_back_stile_r_14Geometry.scale(1.0, 1.0, 1.0);
    }
    const mesh_back_stile_r_14 = new THREE.Mesh(mesh_back_stile_r_14Geometry, materialMap["painted-green"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_back_stile_r_14.name = "Back stile r";
    if (endpoint_back_stile_r_14) {
        mesh_back_stile_r_14.position.copy(endpoint_back_stile_r_14.midpoint);
        mesh_back_stile_r_14.quaternion.copy(endpoint_back_stile_r_14.quaternion);
    }
    mesh_back_stile_r_14.castShadow = options.castShadow ?? true;
    mesh_back_stile_r_14.receiveShadow = options.receiveShadow ?? true;
    mesh_back_stile_r_14.userData.sculptComponent = { "id": "back-stile-r", "name": "Back stile r", "level": "macro", "role": "leg", "importance": 0.8, "confidence": 0.8, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "One bent post from floor to crest; a swept section follows the lean.", "geometryDescriptor": { "topologyIntent": "tapered-sweep built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "taperedSweep": { "stations": [{ "position": [-2.55, -1.62, -3.7], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, -1.452, -3.6995], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, -1.212, -3.6986], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, -0.936, -3.6978], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, -0.66, -3.6981], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, -0.42, -3.7], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, -0.2272, -3.7018], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, -0.0576, -3.7031], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 0.1056, -3.7065], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 0.2792, -3.7146], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 0.48, -3.73], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 0.716, -3.7514], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 0.976, -3.7769], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 1.248, -3.8087], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 1.52, -3.849], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 1.78, -3.9], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.55, 2.0232, -3.9677], "rx": 0.298, "rz": 0.298, "twist": 0.0 }, { "position": [-2.55, 2.2576, -4.0506], "rx": 0.296, "rz": 0.296, "twist": 0.0 }, { "position": [-2.55, 2.4904, -4.1398], "rx": 0.294, "rz": 0.294, "twist": 0.0 }, { "position": [-2.55, 2.7288, -4.2259], "rx": 0.292, "rz": 0.292, "twist": 0.0 }, { "position": [-2.55, 2.98, -4.3], "rx": 0.29, "rz": 0.29, "twist": 0.0 }, { "position": [-2.55, 3.2488, -4.3601], "rx": 0.288, "rz": 0.288, "twist": 0.0 }, { "position": [-2.55, 3.5304, -4.4122], "rx": 0.286, "rz": 0.286, "twist": 0.0 }, { "position": [-2.55, 3.8176, -4.4594], "rx": 0.284, "rz": 0.284, "twist": 0.0 }, { "position": [-2.55, 4.1032, -4.5043], "rx": 0.282, "rz": 0.282, "twist": 0.0 }, { "position": [-2.55, 4.38, -4.55], "rx": 0.28, "rz": 0.28, "twist": 0.0 }, { "position": [-2.55, 4.6504, -4.5958], "rx": 0.278, "rz": 0.278, "twist": 0.0 }, { "position": [-2.55, 4.9192, -4.6397], "rx": 0.276, "rz": 0.276, "twist": 0.0 }, { "position": [-2.55, 5.1828, -4.6827], "rx": 0.274, "rz": 0.274, "twist": 0.0 }, { "position": [-2.55, 5.4376, -4.7258], "rx": 0.272, "rz": 0.272, "twist": 0.0 }, { "position": [-2.55, 5.68, -4.77], "rx": 0.27, "rz": 0.27, "twist": 0.0 }, { "position": [-2.55, 5.9228, -4.819], "rx": 0.246, "rz": 0.246, "twist": 0.0 }, { "position": [-2.55, 6.1684, -4.8723], "rx": 0.222, "rz": 0.222, "twist": 0.0 }, { "position": [-2.55, 6.3976, -4.9241], "rx": 0.198, "rz": 0.198, "twist": 0.0 }, { "position": [-2.55, 6.5912, -4.9686], "rx": 0.174, "rz": 0.174, "twist": 0.0 }, { "position": [-2.55, 6.73, -5.0], "rx": 0.15, "rz": 0.15, "twist": 0.0 }], "radialSegments": 4, "capEnds": true } }, "parent": "seat-frame", "attachment": { "parentId": "seat-frame", "parentSocket": "seat-frame-joint", "localStart": [-2.55, -1.62, -3.7], "localEnd": [-2.55, 6.73, -5.0], "contactType": "butt", "embedDepth": 0.05, "gapTolerance": 0.02 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "back-stile-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "stile-lean-r", "kind": "contour", "notes": "back lean ~15 deg above the seat" }], "surfaceDetail": { "macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.01, "normalPattern": "brush strokes along the grain", "displacementPattern": "", "occlusionPattern": "dark green in joints", "edgeWearPattern": "paint worn to brown wood on arrises and lower legs", "notes": "surface-pass: wear on edges, satin paint elsewhere" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_back_stile_r_14.add(mesh_back_stile_r_14);
    meshes["back-stile-r"] = mesh_back_stile_r_14;
    colliders["back-stile-r"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["back-stile-r"] ?? (destructionGroups["back-stile-r"] = []);
    destructionGroups["back-stile-r"].push(node_back_stile_r_14);
    const endpoint_arm_r_15 = makeAttachmentEndpoint(null);
    const node_arm_r_15 = new THREE.Group();
    node_arm_r_15.name = "Arm r__pivot";
    node_arm_r_15.scale.set(1, 1, 1);
    if (endpoint_arm_r_15) {
        node_arm_r_15.position.copy(endpoint_arm_r_15.start);
        node_arm_r_15.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_arm_r_15.position.set(0.0, 0.0, 0.0);
        node_arm_r_15.rotation.set(0.0, 0.0, 0.0);
    }
    node_arm_r_15.userData.sculptComponent = { "id": "arm-r", "name": "Arm r", "level": "meso", "role": "arm", "importance": 0.8, "confidence": 0.8, "primitive": "tapered-sweep", "topologyClass": "assembled-solid", "topologyRationale": "Arm r: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "tapered-sweep built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "taperedSweep": { "stations": [{ "position": [-2.805, 2.68, 0.4], "rx": 0.12, "rz": 0.17, "twist": 0.0 }, { "position": [-2.7962, 2.6808, 0.2844], "rx": 0.18, "rz": 0.162, "twist": 0.0 }, { "position": [-2.7848, 2.6824, 0.1292], "rx": 0.24, "rz": 0.154, "twist": 0.0 }, { "position": [-2.7701, 2.6836, -0.0632], "rx": 0.3, "rz": 0.146, "twist": 0.0 }, { "position": [-2.7516, 2.6832, -0.2904], "rx": 0.36, "rz": 0.138, "twist": 0.0 }, { "position": [-2.7285, 2.68, -0.55], "rx": 0.42, "rz": 0.13, "twist": 0.0 }, { "position": [-2.6965, 2.674, -0.8588], "rx": 0.416, "rz": 0.128, "twist": 0.0 }, { "position": [-2.6559, 2.666, -1.2184], "rx": 0.412, "rz": 0.126, "twist": 0.0 }, { "position": [-2.6134, 2.656, -1.6036], "rx": 0.408, "rz": 0.124, "twist": 0.0 }, { "position": [-2.5759, 2.644, -1.9892], "rx": 0.404, "rz": 0.122, "twist": 0.0 }, { "position": [-2.55, 2.63, -2.35], "rx": 0.4, "rz": 0.12, "twist": 0.0 }, { "position": [-2.5386, 2.6116, -2.7084], "rx": 0.392, "rz": 0.12, "twist": 0.0 }, { "position": [-2.5371, 2.5888, -3.0812], "rx": 0.384, "rz": 0.12, "twist": 0.0 }, { "position": [-2.5414, 2.5652, -3.4348], "rx": 0.376, "rz": 0.12, "twist": 0.0 }, { "position": [-2.5471, 2.5444, -3.7356], "rx": 0.368, "rz": 0.12, "twist": 0.0 }, { "position": [-2.55, 2.53, -3.95], "rx": 0.36, "rz": 0.12, "twist": 0.0 }], "radialSegments": 12, "capEnds": true } }, "parent": "seat-frame", "attachment": { "parentId": "seat-frame", "parentSocket": "seat-frame-joint", "localStart": [-2.55, 2.54, -0.17], "localEnd": [-2.55, 2.53, -3.95], "contactType": "socket", "embedDepth": 0.05, "gapTolerance": 0.02 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "arm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "arm-roll-r", "kind": "contour", "notes": "rounded overhanging arm front" }], "surfaceDetail": { "macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.01, "normalPattern": "brush strokes along the grain", "displacementPattern": "", "occlusionPattern": "dark green in joints", "edgeWearPattern": "paint worn to brown wood on arrises and lower legs", "notes": "surface-pass: wear on edges, satin paint elsewhere" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_arm_r_15.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "arm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["seat-frame"] ?? root).add(node_arm_r_15);
    nodes["arm-r"] = node_arm_r_15;
    const mesh_arm_r_15Geometry = endpoint_arm_r_15
        ? new THREE.CylinderGeometry(endpoint_arm_r_15.endRadius, endpoint_arm_r_15.baseRadius, endpoint_arm_r_15.length, 16, 6)
        : buildTaperedSweepGeometry({ "stations": [{ "position": [-2.805, 2.68, 0.4], "rx": 0.12, "rz": 0.17, "twist": 0.0 }, { "position": [-2.7962, 2.6808, 0.2844], "rx": 0.18, "rz": 0.162, "twist": 0.0 }, { "position": [-2.7848, 2.6824, 0.1292], "rx": 0.24, "rz": 0.154, "twist": 0.0 }, { "position": [-2.7701, 2.6836, -0.0632], "rx": 0.3, "rz": 0.146, "twist": 0.0 }, { "position": [-2.7516, 2.6832, -0.2904], "rx": 0.36, "rz": 0.138, "twist": 0.0 }, { "position": [-2.7285, 2.68, -0.55], "rx": 0.42, "rz": 0.13, "twist": 0.0 }, { "position": [-2.6965, 2.674, -0.8588], "rx": 0.416, "rz": 0.128, "twist": 0.0 }, { "position": [-2.6559, 2.666, -1.2184], "rx": 0.412, "rz": 0.126, "twist": 0.0 }, { "position": [-2.6134, 2.656, -1.6036], "rx": 0.408, "rz": 0.124, "twist": 0.0 }, { "position": [-2.5759, 2.644, -1.9892], "rx": 0.404, "rz": 0.122, "twist": 0.0 }, { "position": [-2.55, 2.63, -2.35], "rx": 0.4, "rz": 0.12, "twist": 0.0 }, { "position": [-2.5386, 2.6116, -2.7084], "rx": 0.392, "rz": 0.12, "twist": 0.0 }, { "position": [-2.5371, 2.5888, -3.0812], "rx": 0.384, "rz": 0.12, "twist": 0.0 }, { "position": [-2.5414, 2.5652, -3.4348], "rx": 0.376, "rz": 0.12, "twist": 0.0 }, { "position": [-2.5471, 2.5444, -3.7356], "rx": 0.368, "rz": 0.12, "twist": 0.0 }, { "position": [-2.55, 2.53, -3.95], "rx": 0.36, "rz": 0.12, "twist": 0.0 }], "radialSegments": 12, "capEnds": true });
    if (!endpoint_arm_r_15) {
        mesh_arm_r_15Geometry.scale(1.0, 1.0, 1.0);
    }
    const mesh_arm_r_15 = new THREE.Mesh(mesh_arm_r_15Geometry, materialMap["painted-green"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_arm_r_15.name = "Arm r";
    if (endpoint_arm_r_15) {
        mesh_arm_r_15.position.copy(endpoint_arm_r_15.midpoint);
        mesh_arm_r_15.quaternion.copy(endpoint_arm_r_15.quaternion);
    }
    mesh_arm_r_15.castShadow = options.castShadow ?? true;
    mesh_arm_r_15.receiveShadow = options.receiveShadow ?? true;
    mesh_arm_r_15.userData.sculptComponent = { "id": "arm-r", "name": "Arm r", "level": "meso", "role": "arm", "importance": 0.8, "confidence": 0.8, "primitive": "tapered-sweep", "topologyClass": "assembled-solid", "topologyRationale": "Arm r: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "tapered-sweep built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "taperedSweep": { "stations": [{ "position": [-2.805, 2.68, 0.4], "rx": 0.12, "rz": 0.17, "twist": 0.0 }, { "position": [-2.7962, 2.6808, 0.2844], "rx": 0.18, "rz": 0.162, "twist": 0.0 }, { "position": [-2.7848, 2.6824, 0.1292], "rx": 0.24, "rz": 0.154, "twist": 0.0 }, { "position": [-2.7701, 2.6836, -0.0632], "rx": 0.3, "rz": 0.146, "twist": 0.0 }, { "position": [-2.7516, 2.6832, -0.2904], "rx": 0.36, "rz": 0.138, "twist": 0.0 }, { "position": [-2.7285, 2.68, -0.55], "rx": 0.42, "rz": 0.13, "twist": 0.0 }, { "position": [-2.6965, 2.674, -0.8588], "rx": 0.416, "rz": 0.128, "twist": 0.0 }, { "position": [-2.6559, 2.666, -1.2184], "rx": 0.412, "rz": 0.126, "twist": 0.0 }, { "position": [-2.6134, 2.656, -1.6036], "rx": 0.408, "rz": 0.124, "twist": 0.0 }, { "position": [-2.5759, 2.644, -1.9892], "rx": 0.404, "rz": 0.122, "twist": 0.0 }, { "position": [-2.55, 2.63, -2.35], "rx": 0.4, "rz": 0.12, "twist": 0.0 }, { "position": [-2.5386, 2.6116, -2.7084], "rx": 0.392, "rz": 0.12, "twist": 0.0 }, { "position": [-2.5371, 2.5888, -3.0812], "rx": 0.384, "rz": 0.12, "twist": 0.0 }, { "position": [-2.5414, 2.5652, -3.4348], "rx": 0.376, "rz": 0.12, "twist": 0.0 }, { "position": [-2.5471, 2.5444, -3.7356], "rx": 0.368, "rz": 0.12, "twist": 0.0 }, { "position": [-2.55, 2.53, -3.95], "rx": 0.36, "rz": 0.12, "twist": 0.0 }], "radialSegments": 12, "capEnds": true } }, "parent": "seat-frame", "attachment": { "parentId": "seat-frame", "parentSocket": "seat-frame-joint", "localStart": [-2.55, 2.54, -0.17], "localEnd": [-2.55, 2.53, -3.95], "contactType": "socket", "embedDepth": 0.05, "gapTolerance": 0.02 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "arm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "arm-roll-r", "kind": "contour", "notes": "rounded overhanging arm front" }], "surfaceDetail": { "macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.01, "normalPattern": "brush strokes along the grain", "displacementPattern": "", "occlusionPattern": "dark green in joints", "edgeWearPattern": "paint worn to brown wood on arrises and lower legs", "notes": "surface-pass: wear on edges, satin paint elsewhere" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_arm_r_15.add(mesh_arm_r_15);
    meshes["arm-r"] = mesh_arm_r_15;
    colliders["arm-r"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["arm-r"] ?? (destructionGroups["arm-r"] = []);
    destructionGroups["arm-r"].push(node_arm_r_15);
    const endpoint_crest_rail_16 = makeAttachmentEndpoint(null);
    const node_crest_rail_16 = new THREE.Group();
    node_crest_rail_16.name = "Rolled crest rail__pivot";
    node_crest_rail_16.scale.set(1, 1, 1);
    if (endpoint_crest_rail_16) {
        node_crest_rail_16.position.copy(endpoint_crest_rail_16.start);
        node_crest_rail_16.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_crest_rail_16.position.set(0.0, 0.0, 0.0);
        node_crest_rail_16.rotation.set(0.0, 0.0, 0.0);
    }
    node_crest_rail_16.userData.sculptComponent = { "id": "crest-rail", "name": "Rolled crest rail", "level": "meso", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "A rolled, bent rail; a swept oval section along a curved spine.", "geometryDescriptor": { "topologyIntent": "tapered-sweep built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "taperedSweep": { "stations": [{ "position": [-3.05, 6.78, -4.95], "rx": 0.18, "rz": 0.18, "twist": 0.0 }, { "position": [-2.894, 6.7917, -4.9709], "rx": 0.22, "rz": 0.22, "twist": 0.0 }, { "position": [-2.6796, 6.8085, -5.0007], "rx": 0.26, "rz": 0.26, "twist": 0.0 }, { "position": [-2.425, 6.8281, -5.0356], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.1481, 6.8481, -5.0715], "rx": 0.34, "rz": 0.34, "twist": 0.0 }, { "position": [-1.8671, 6.8662, -5.1043], "rx": 0.38, "rz": 0.38, "twist": 0.0 }, { "position": [-1.6, 6.88, -5.13], "rx": 0.42, "rz": 0.42, "twist": 0.0 }, { "position": [-1.342, 6.8897, -5.1497], "rx": 0.4233, "rz": 0.4233, "twist": 0.0 }, { "position": [-1.0778, 6.8974, -5.1667], "rx": 0.4267, "rz": 0.4267, "twist": 0.0 }, { "position": [-0.8094, 6.9031, -5.1806], "rx": 0.43, "rz": 0.43, "twist": 0.0 }, { "position": [-0.5389, 6.907, -5.1911], "rx": 0.4333, "rz": 0.4333, "twist": 0.0 }, { "position": [-0.2684, 6.9093, -5.1977], "rx": 0.4367, "rz": 0.4367, "twist": 0.0 }, { "position": [0.0, 6.91, -5.2], "rx": 0.44, "rz": 0.44, "twist": 0.0 }, { "position": [0.2684, 6.9093, -5.1977], "rx": 0.4367, "rz": 0.4367, "twist": 0.0 }, { "position": [0.5389, 6.907, -5.1911], "rx": 0.4333, "rz": 0.4333, "twist": 0.0 }, { "position": [0.8094, 6.9031, -5.1806], "rx": 0.43, "rz": 0.43, "twist": 0.0 }, { "position": [1.0778, 6.8974, -5.1667], "rx": 0.4267, "rz": 0.4267, "twist": 0.0 }, { "position": [1.342, 6.8897, -5.1497], "rx": 0.4233, "rz": 0.4233, "twist": 0.0 }, { "position": [1.6, 6.88, -5.13], "rx": 0.42, "rz": 0.42, "twist": 0.0 }, { "position": [1.8671, 6.8662, -5.1043], "rx": 0.38, "rz": 0.38, "twist": 0.0 }, { "position": [2.1481, 6.8481, -5.0715], "rx": 0.34, "rz": 0.34, "twist": 0.0 }, { "position": [2.425, 6.8281, -5.0356], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.6796, 6.8085, -5.0007], "rx": 0.26, "rz": 0.26, "twist": 0.0 }, { "position": [2.894, 6.7917, -4.9709], "rx": 0.22, "rz": 0.22, "twist": 0.0 }, { "position": [3.05, 6.78, -4.95], "rx": 0.18, "rz": 0.18, "twist": 0.0 }], "radialSegments": 16, "capEnds": true } }, "parent": "seat-frame", "attachment": { "parentId": "seat-frame", "parentSocket": "seat-frame-joint", "localStart": [-3.05, 6.78, -4.95], "localEnd": [3.05, 6.78, -4.95], "contactType": "overlap", "embedDepth": 0.05, "gapTolerance": 0.02 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "crest-rail", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-dark", "materialLayers": ["painted-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "crest-roll", "kind": "bevel", "notes": "thick rolled top rail, rounded section" }], "surfaceDetail": { "macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.01, "normalPattern": "brush strokes along the grain", "displacementPattern": "", "occlusionPattern": "dark green in joints", "edgeWearPattern": "paint worn to brown wood on arrises and lower legs", "notes": "surface-pass: wear on edges, satin paint elsewhere" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(79, 138, 104, 1.0)", "secondaryAlbedo": "rgba(51, 92, 71, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(51, 92, 71, 1.0)" }, { "pos": 1.0, "color": "rgba(79, 138, 104, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_crest_rail_16.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "crest-rail", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["seat-frame"] ?? root).add(node_crest_rail_16);
    nodes["crest-rail"] = node_crest_rail_16;
    const mesh_crest_rail_16Geometry = endpoint_crest_rail_16
        ? new THREE.CylinderGeometry(endpoint_crest_rail_16.endRadius, endpoint_crest_rail_16.baseRadius, endpoint_crest_rail_16.length, 16, 6)
        : buildTaperedSweepGeometry({ "stations": [{ "position": [-3.05, 6.78, -4.95], "rx": 0.18, "rz": 0.18, "twist": 0.0 }, { "position": [-2.894, 6.7917, -4.9709], "rx": 0.22, "rz": 0.22, "twist": 0.0 }, { "position": [-2.6796, 6.8085, -5.0007], "rx": 0.26, "rz": 0.26, "twist": 0.0 }, { "position": [-2.425, 6.8281, -5.0356], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.1481, 6.8481, -5.0715], "rx": 0.34, "rz": 0.34, "twist": 0.0 }, { "position": [-1.8671, 6.8662, -5.1043], "rx": 0.38, "rz": 0.38, "twist": 0.0 }, { "position": [-1.6, 6.88, -5.13], "rx": 0.42, "rz": 0.42, "twist": 0.0 }, { "position": [-1.342, 6.8897, -5.1497], "rx": 0.4233, "rz": 0.4233, "twist": 0.0 }, { "position": [-1.0778, 6.8974, -5.1667], "rx": 0.4267, "rz": 0.4267, "twist": 0.0 }, { "position": [-0.8094, 6.9031, -5.1806], "rx": 0.43, "rz": 0.43, "twist": 0.0 }, { "position": [-0.5389, 6.907, -5.1911], "rx": 0.4333, "rz": 0.4333, "twist": 0.0 }, { "position": [-0.2684, 6.9093, -5.1977], "rx": 0.4367, "rz": 0.4367, "twist": 0.0 }, { "position": [0.0, 6.91, -5.2], "rx": 0.44, "rz": 0.44, "twist": 0.0 }, { "position": [0.2684, 6.9093, -5.1977], "rx": 0.4367, "rz": 0.4367, "twist": 0.0 }, { "position": [0.5389, 6.907, -5.1911], "rx": 0.4333, "rz": 0.4333, "twist": 0.0 }, { "position": [0.8094, 6.9031, -5.1806], "rx": 0.43, "rz": 0.43, "twist": 0.0 }, { "position": [1.0778, 6.8974, -5.1667], "rx": 0.4267, "rz": 0.4267, "twist": 0.0 }, { "position": [1.342, 6.8897, -5.1497], "rx": 0.4233, "rz": 0.4233, "twist": 0.0 }, { "position": [1.6, 6.88, -5.13], "rx": 0.42, "rz": 0.42, "twist": 0.0 }, { "position": [1.8671, 6.8662, -5.1043], "rx": 0.38, "rz": 0.38, "twist": 0.0 }, { "position": [2.1481, 6.8481, -5.0715], "rx": 0.34, "rz": 0.34, "twist": 0.0 }, { "position": [2.425, 6.8281, -5.0356], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.6796, 6.8085, -5.0007], "rx": 0.26, "rz": 0.26, "twist": 0.0 }, { "position": [2.894, 6.7917, -4.9709], "rx": 0.22, "rz": 0.22, "twist": 0.0 }, { "position": [3.05, 6.78, -4.95], "rx": 0.18, "rz": 0.18, "twist": 0.0 }], "radialSegments": 16, "capEnds": true });
    if (!endpoint_crest_rail_16) {
        mesh_crest_rail_16Geometry.scale(1.0, 1.0, 1.0);
    }
    const mesh_crest_rail_16 = new THREE.Mesh(mesh_crest_rail_16Geometry, materialMap["painted-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_crest_rail_16.name = "Rolled crest rail";
    if (endpoint_crest_rail_16) {
        mesh_crest_rail_16.position.copy(endpoint_crest_rail_16.midpoint);
        mesh_crest_rail_16.quaternion.copy(endpoint_crest_rail_16.quaternion);
    }
    mesh_crest_rail_16.castShadow = options.castShadow ?? true;
    mesh_crest_rail_16.receiveShadow = options.receiveShadow ?? true;
    mesh_crest_rail_16.userData.sculptComponent = { "id": "crest-rail", "name": "Rolled crest rail", "level": "meso", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "A rolled, bent rail; a swept oval section along a curved spine.", "geometryDescriptor": { "topologyIntent": "tapered-sweep built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "taperedSweep": { "stations": [{ "position": [-3.05, 6.78, -4.95], "rx": 0.18, "rz": 0.18, "twist": 0.0 }, { "position": [-2.894, 6.7917, -4.9709], "rx": 0.22, "rz": 0.22, "twist": 0.0 }, { "position": [-2.6796, 6.8085, -5.0007], "rx": 0.26, "rz": 0.26, "twist": 0.0 }, { "position": [-2.425, 6.8281, -5.0356], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [-2.1481, 6.8481, -5.0715], "rx": 0.34, "rz": 0.34, "twist": 0.0 }, { "position": [-1.8671, 6.8662, -5.1043], "rx": 0.38, "rz": 0.38, "twist": 0.0 }, { "position": [-1.6, 6.88, -5.13], "rx": 0.42, "rz": 0.42, "twist": 0.0 }, { "position": [-1.342, 6.8897, -5.1497], "rx": 0.4233, "rz": 0.4233, "twist": 0.0 }, { "position": [-1.0778, 6.8974, -5.1667], "rx": 0.4267, "rz": 0.4267, "twist": 0.0 }, { "position": [-0.8094, 6.9031, -5.1806], "rx": 0.43, "rz": 0.43, "twist": 0.0 }, { "position": [-0.5389, 6.907, -5.1911], "rx": 0.4333, "rz": 0.4333, "twist": 0.0 }, { "position": [-0.2684, 6.9093, -5.1977], "rx": 0.4367, "rz": 0.4367, "twist": 0.0 }, { "position": [0.0, 6.91, -5.2], "rx": 0.44, "rz": 0.44, "twist": 0.0 }, { "position": [0.2684, 6.9093, -5.1977], "rx": 0.4367, "rz": 0.4367, "twist": 0.0 }, { "position": [0.5389, 6.907, -5.1911], "rx": 0.4333, "rz": 0.4333, "twist": 0.0 }, { "position": [0.8094, 6.9031, -5.1806], "rx": 0.43, "rz": 0.43, "twist": 0.0 }, { "position": [1.0778, 6.8974, -5.1667], "rx": 0.4267, "rz": 0.4267, "twist": 0.0 }, { "position": [1.342, 6.8897, -5.1497], "rx": 0.4233, "rz": 0.4233, "twist": 0.0 }, { "position": [1.6, 6.88, -5.13], "rx": 0.42, "rz": 0.42, "twist": 0.0 }, { "position": [1.8671, 6.8662, -5.1043], "rx": 0.38, "rz": 0.38, "twist": 0.0 }, { "position": [2.1481, 6.8481, -5.0715], "rx": 0.34, "rz": 0.34, "twist": 0.0 }, { "position": [2.425, 6.8281, -5.0356], "rx": 0.3, "rz": 0.3, "twist": 0.0 }, { "position": [2.6796, 6.8085, -5.0007], "rx": 0.26, "rz": 0.26, "twist": 0.0 }, { "position": [2.894, 6.7917, -4.9709], "rx": 0.22, "rz": 0.22, "twist": 0.0 }, { "position": [3.05, 6.78, -4.95], "rx": 0.18, "rz": 0.18, "twist": 0.0 }], "radialSegments": 16, "capEnds": true } }, "parent": "seat-frame", "attachment": { "parentId": "seat-frame", "parentSocket": "seat-frame-joint", "localStart": [-3.05, 6.78, -4.95], "localEnd": [3.05, 6.78, -4.95], "contactType": "overlap", "embedDepth": 0.05, "gapTolerance": 0.02 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "crest-rail", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-dark", "materialLayers": ["painted-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "crest-roll", "kind": "bevel", "notes": "thick rolled top rail, rounded section" }], "surfaceDetail": { "macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.01, "normalPattern": "brush strokes along the grain", "displacementPattern": "", "occlusionPattern": "dark green in joints", "edgeWearPattern": "paint worn to brown wood on arrises and lower legs", "notes": "surface-pass: wear on edges, satin paint elsewhere" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(79, 138, 104, 1.0)", "secondaryAlbedo": "rgba(51, 92, 71, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(51, 92, 71, 1.0)" }, { "pos": 1.0, "color": "rgba(79, 138, 104, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_crest_rail_16.add(mesh_crest_rail_16);
    meshes["crest-rail"] = mesh_crest_rail_16;
    colliders["crest-rail"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["crest-rail"] ?? (destructionGroups["crest-rail"] = []);
    destructionGroups["crest-rail"].push(node_crest_rail_16);
    const endpoint_back_slat_1_17 = makeAttachmentEndpoint(null);
    const node_back_slat_1_17 = new THREE.Group();
    node_back_slat_1_17.name = "Back slat 1__pivot";
    node_back_slat_1_17.scale.set(1, 1, 1);
    if (endpoint_back_slat_1_17) {
        node_back_slat_1_17.position.copy(endpoint_back_slat_1_17.start);
        node_back_slat_1_17.rotation.set(-0.24497866312686414, 0.0, 0.0);
    }
    else {
        node_back_slat_1_17.position.set(0.0, 4.48, -4.52);
        node_back_slat_1_17.rotation.set(-0.24497866312686414, 0.0, 0.0);
    }
    node_back_slat_1_17.userData.sculptComponent = { "id": "back-slat-1", "name": "Back slat 1", "level": "meso", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Back slat 1: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0.0, 4.48, -4.52], "rotation": [-0.24497866312686414, 0, 0], "scale": [5.1, 0.75, 0.14] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "back-slat-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "slat-brush-1", "kind": "linework", "notes": "brush lines along the slat" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_back_slat_1_17.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "back-slat-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["seat-frame"] ?? root).add(node_back_slat_1_17);
    nodes["back-slat-1"] = node_back_slat_1_17;
    const mesh_back_slat_1_17Geometry = endpoint_back_slat_1_17
        ? new THREE.CylinderGeometry(endpoint_back_slat_1_17.endRadius, endpoint_back_slat_1_17.baseRadius, endpoint_back_slat_1_17.length, 16, 6)
        : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    if (!endpoint_back_slat_1_17) {
        mesh_back_slat_1_17Geometry.scale(5.1, 0.75, 0.14);
    }
    const mesh_back_slat_1_17 = new THREE.Mesh(mesh_back_slat_1_17Geometry, materialMap["painted-green"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_back_slat_1_17.name = "Back slat 1";
    if (endpoint_back_slat_1_17) {
        mesh_back_slat_1_17.position.copy(endpoint_back_slat_1_17.midpoint);
        mesh_back_slat_1_17.quaternion.copy(endpoint_back_slat_1_17.quaternion);
    }
    mesh_back_slat_1_17.castShadow = options.castShadow ?? true;
    mesh_back_slat_1_17.receiveShadow = options.receiveShadow ?? true;
    mesh_back_slat_1_17.userData.sculptComponent = { "id": "back-slat-1", "name": "Back slat 1", "level": "meso", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Back slat 1: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0.0, 4.48, -4.52], "rotation": [-0.24497866312686414, 0, 0], "scale": [5.1, 0.75, 0.14] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "back-slat-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "slat-brush-1", "kind": "linework", "notes": "brush lines along the slat" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_back_slat_1_17.add(mesh_back_slat_1_17);
    meshes["back-slat-1"] = mesh_back_slat_1_17;
    colliders["back-slat-1"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["back-slat-1"] ?? (destructionGroups["back-slat-1"] = []);
    destructionGroups["back-slat-1"].push(node_back_slat_1_17);
    const endpoint_back_slat_2_18 = makeAttachmentEndpoint(null);
    const node_back_slat_2_18 = new THREE.Group();
    node_back_slat_2_18.name = "Back slat 2__pivot";
    node_back_slat_2_18.scale.set(1, 1, 1);
    if (endpoint_back_slat_2_18) {
        node_back_slat_2_18.position.copy(endpoint_back_slat_2_18.start);
        node_back_slat_2_18.rotation.set(-0.24497866312686414, 0.0, 0.0);
    }
    else {
        node_back_slat_2_18.position.set(0.0, 5.68, -4.82);
        node_back_slat_2_18.rotation.set(-0.24497866312686414, 0.0, 0.0);
    }
    node_back_slat_2_18.userData.sculptComponent = { "id": "back-slat-2", "name": "Back slat 2", "level": "meso", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Back slat 2: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0.0, 5.68, -4.82], "rotation": [-0.24497866312686414, 0, 0], "scale": [5.1, 0.75, 0.14] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "back-slat-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "slat-brush-2", "kind": "linework", "notes": "brush lines along the slat" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_back_slat_2_18.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "back-slat-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["seat-frame"] ?? root).add(node_back_slat_2_18);
    nodes["back-slat-2"] = node_back_slat_2_18;
    const mesh_back_slat_2_18Geometry = endpoint_back_slat_2_18
        ? new THREE.CylinderGeometry(endpoint_back_slat_2_18.endRadius, endpoint_back_slat_2_18.baseRadius, endpoint_back_slat_2_18.length, 16, 6)
        : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    if (!endpoint_back_slat_2_18) {
        mesh_back_slat_2_18Geometry.scale(5.1, 0.75, 0.14);
    }
    const mesh_back_slat_2_18 = new THREE.Mesh(mesh_back_slat_2_18Geometry, materialMap["painted-green"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_back_slat_2_18.name = "Back slat 2";
    if (endpoint_back_slat_2_18) {
        mesh_back_slat_2_18.position.copy(endpoint_back_slat_2_18.midpoint);
        mesh_back_slat_2_18.quaternion.copy(endpoint_back_slat_2_18.quaternion);
    }
    mesh_back_slat_2_18.castShadow = options.castShadow ?? true;
    mesh_back_slat_2_18.receiveShadow = options.receiveShadow ?? true;
    mesh_back_slat_2_18.userData.sculptComponent = { "id": "back-slat-2", "name": "Back slat 2", "level": "meso", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Back slat 2: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0.0, 5.68, -4.82], "rotation": [-0.24497866312686414, 0, 0], "scale": [5.1, 0.75, 0.14] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "back-slat-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "slat-brush-2", "kind": "linework", "notes": "brush lines along the slat" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_back_slat_2_18.add(mesh_back_slat_2_18);
    meshes["back-slat-2"] = mesh_back_slat_2_18;
    colliders["back-slat-2"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["back-slat-2"] ?? (destructionGroups["back-slat-2"] = []);
    destructionGroups["back-slat-2"].push(node_back_slat_2_18);
    const endpoint_lower_back_rail_19 = makeAttachmentEndpoint(null);
    const node_lower_back_rail_19 = new THREE.Group();
    node_lower_back_rail_19.name = "Lower back rail__pivot";
    node_lower_back_rail_19.scale.set(1, 1, 1);
    if (endpoint_lower_back_rail_19) {
        node_lower_back_rail_19.position.copy(endpoint_lower_back_rail_19.start);
        node_lower_back_rail_19.rotation.set(-0.15, 0.0, 0.0);
    }
    else {
        node_lower_back_rail_19.position.set(0.0, 1.23, -3.85);
        node_lower_back_rail_19.rotation.set(-0.15, 0.0, 0.0);
    }
    node_lower_back_rail_19.userData.sculptComponent = { "id": "lower-back-rail", "name": "Lower back rail", "level": "meso", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Lower back rail: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0.0, 1.23, -3.85], "rotation": [-0.15, 0, 0], "scale": [5.1, 0.4, 0.14] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "lower-back-rail", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_lower_back_rail_19.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "lower-back-rail", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["seat-frame"] ?? root).add(node_lower_back_rail_19);
    nodes["lower-back-rail"] = node_lower_back_rail_19;
    const mesh_lower_back_rail_19Geometry = endpoint_lower_back_rail_19
        ? new THREE.CylinderGeometry(endpoint_lower_back_rail_19.endRadius, endpoint_lower_back_rail_19.baseRadius, endpoint_lower_back_rail_19.length, 16, 6)
        : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    if (!endpoint_lower_back_rail_19) {
        mesh_lower_back_rail_19Geometry.scale(5.1, 0.4, 0.14);
    }
    const mesh_lower_back_rail_19 = new THREE.Mesh(mesh_lower_back_rail_19Geometry, materialMap["painted-green"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_lower_back_rail_19.name = "Lower back rail";
    if (endpoint_lower_back_rail_19) {
        mesh_lower_back_rail_19.position.copy(endpoint_lower_back_rail_19.midpoint);
        mesh_lower_back_rail_19.quaternion.copy(endpoint_lower_back_rail_19.quaternion);
    }
    mesh_lower_back_rail_19.castShadow = options.castShadow ?? true;
    mesh_lower_back_rail_19.receiveShadow = options.receiveShadow ?? true;
    mesh_lower_back_rail_19.userData.sculptComponent = { "id": "lower-back-rail", "name": "Lower back rail", "level": "meso", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Lower back rail: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "box built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "seat-frame", "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0.0, 1.23, -3.85], "rotation": [-0.15, 0, 0], "scale": [5.1, 0.4, 0.14] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "lower-back-rail", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "painted-green", "materialLayers": ["painted-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 156, 120, 1.0)", "secondaryAlbedo": "rgba(63, 110, 85, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(63, 110, 85, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 156, 120, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_lower_back_rail_19.add(mesh_lower_back_rail_19);
    meshes["lower-back-rail"] = mesh_lower_back_rail_19;
    colliders["lower-back-rail"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["lower-back-rail"] ?? (destructionGroups["lower-back-rail"] = []);
    destructionGroups["lower-back-rail"].push(node_lower_back_rail_19);
    // repetition system: seat-slats (InstancedMesh, radial, count=6, level=meso)
    {
        const parent = nodes["root"] ?? root;
        const geo = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
        const mat = materialMap["painted-green"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
        // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
        // local units -- it is never multiplied by the parent component's own declared
        // dimensional scale. This falls out of the same fix as componentTree: the pivot
        // Group this cluster is parented to always carries identity scale (dimensions are
        // baked into that component's OWN geometry, not exposed on the Group), so an
        // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
        // size regardless of how non-uniformly its host component is shaped, and a
        // `radial` ring's placement stays circular instead of being squashed into an
        // ellipse by a non-uniform host.
        const scl = [0.1, 0.1, 0.1];
        const axis = new THREE.Vector3(0.0, 0.0, 1.0).normalize();
        const radius = 0.0;
        const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
        const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
        // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
        // replacing the former per-instance Mesh clone loop (real-time perf principle).
        const cluster = new THREE.InstancedMesh(geo, mat, 6);
        const _m = new THREE.Matrix4();
        const _p = new THREE.Vector3();
        const _q = new THREE.Quaternion();
        const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
        for (let i = 0; i < 6; i++) {
            const ang = ((0.0) + (i * 360) / 6) * Math.PI / 180;
            const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
            _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
            _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
            _m.compose(_p, _q, _s);
            cluster.setMatrixAt(i, _m);
        }
        cluster.instanceMatrix.needsUpdate = true;
        cluster.castShadow = options.castShadow ?? true;
        cluster.receiveShadow = options.receiveShadow ?? true;
        cluster.name = "seat-slats";
        parent.add(cluster);
    }
    root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups };
    root.userData.lookDevTargets = { "qualityPriority": "reference-fidelity", "materialPass": { "albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": { "requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry" }, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"] }, "lightingPass": { "requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"] }, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."] };
    root.userData.actionReadiness = {
        note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
    };
    return root;
}
export function createPaintedWoodenArmchairLookDevLights(mode = 'neutral') {
    const lights = new THREE.Group();
    lights.name = "Painted Wooden Armchair look-dev lights";
    const hemi = new THREE.HemisphereLight(mode === 'reference' ? 0xfff0d6 : 0xf2f4ff, 0x363b42, mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85);
    lights.add(hemi);
    const key = new THREE.DirectionalLight(mode === 'reference' ? 0xffcf8a : 0xfff4e8, mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15);
    if (mode === 'grazing')
        key.position.set(7.5, 1.1, 4.0);
    else if (mode === 'reference')
        key.position.set(-4.5, 7.5, 5.0);
    else
        key.position.set(-4.0, 6.0, 5.5);
    key.castShadow = true;
    key.shadow.mapSize.set(4096, 4096);
    key.shadow.bias = -0.00025;
    key.shadow.normalBias = 0.018;
    key.shadow.radius = 7;
    key.shadow.blurSamples = 24;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 30;
    key.shadow.camera.left = -2.6;
    key.shadow.camera.right = 2.6;
    key.shadow.camera.top = 2.6;
    key.shadow.camera.bottom = -2.6;
    key.shadow.camera.updateProjectionMatrix();
    lights.add(key);
    const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
    fill.position.set(4.0, 3.0, 3.5);
    lights.add(fill);
    const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
    rim.position.set(0.5, 4.5, -6.0);
    lights.add(rim);
    lights.userData.reviewMode = mode;
    lights.userData.lightingFromPhoto = ["Key: soft daylight from upper left matching the watercolour, 40 degrees.", "Fill: hemisphere sky fill to keep the shadow side green, not black.", "Rim: faint back light along the crest.", "Exposure 1.0 with ACES filmic tone mapping; sRGB output.", "Contact shadow: soft ground shadow under the legs; ambient occlusion in joints and slat gaps."];
    lights.userData.lookDevTargets = { "qualityPriority": "reference-fidelity", "materialPass": { "albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": { "requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry" }, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"] }, "lightingPass": { "requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"] }, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."] };
    return lights;
}
// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createPaintedWoodenArmchairEnvironment(renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return texture;
}
// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function framePaintedWoodenArmchairCamera(camera, object, options = {}) {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty())
        return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const margin = options.margin ?? 1.15;
    const maxDim = Math.max(size.x, size.y, size.z) * margin;
    const fov = (camera.fov * Math.PI) / 180;
    // distance so the largest object dimension fits vertically in the frame
    const distance = (maxDim / 2) / Math.tan(fov / 2);
    const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
    const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    camera.position.copy(center).addScaledVector(dir, distance);
    camera.near = Math.max(0.01, distance - maxDim);
    camera.far = distance + maxDim * 2;
    camera.lookAt(center);
    camera.updateProjectionMatrix();
}
// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createPaintedWoodenArmchairPresentationComposer(renderer, scene, camera, options = {}) {
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    if (options.dof) {
        composer.addPass(new BokehPass(scene, camera, {
            focus: options.dofFocus ?? 10.0,
            aperture: options.dofAperture ?? 0.0002,
            maxblur: 0.01,
        }));
    }
    if (options.bloom) {
        const size = new THREE.Vector2();
        renderer.getSize(size);
        composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
    }
    return composer;
}
export function configurePaintedWoodenArmchairRenderer(renderer) {
    // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
    // the environment reflection reads flat/washed instead of a believable metal response.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
}
export function createPaintedWoodenArmchairInspectControls(camera, domElement) {
    // View-dependent finishes only read correctly once the user orbits — their color
    // comes from the environment reflection, not albedo, so free rotation matters here.
    const controls = new OrbitControls(camera, domElement);
    controls.enableDamping = true;
    controls.minDistance = 1.0;
    controls.maxDistance = 8.0;
    controls.autoRotate = false;
    return controls;
}
