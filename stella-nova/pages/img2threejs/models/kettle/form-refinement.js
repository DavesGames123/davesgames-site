import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
function buildLatheGeometry(profile) {
    const points = profile.points.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x), y));
    return new THREE.LatheGeometry(points, profile.segments ?? 24);
}
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
// Generated from ObjectSculptSpec target: Copper Tea Kettle
// Sculpt build pass: form-refinement
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createCopperTeaKettleModel(options = {}) {
    const root = new THREE.Group();
    root.name = "Copper Tea Kettle";
    root.userData.reconstructionEvidence = { "itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": { "solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": { "yaw": 0.0, "pitch": 0.0, "roll": 0.0 }, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review." }, "approximationNotes": [] };
    root.userData.materialPipeline = {};
    root.userData.materialReferenceRegistry = null;
    const materialMap = {};
    materialMap["hammered-copper"] = createSculptMaterial("hammered-copper", { "id": "hammered-copper", "name": "Hammered copper", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#6A5040", "color": "#6A5040", "albedo": { "dominant": "#5D493C", "secondary": ["#6D5543", "#4E3F35", "#3E332D"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": { "path": "models/kettle/maps/hammered-copper_albedo.jpg", "url": "models/kettle/maps/hammered-copper_albedo.jpg", "channel": "albedo", "source": "reference-pixel-extraction" } }, "colorVariation": { "palette": ["#5D493C", "#6D5543", "#4E3F35", "#3E332D", "#846751"], "pattern": "reference-derived pixel palette", "amplitude": 0.091, "heightCorrelation": 0.42 }, "textureResolution": 1024, "textureProjection": { "mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale." }, "surfaceFrequencyBands": [{ "id": "macro", "frequency": 2.0, "amplitude": 0.355, "role": "reference-derived broad albedo and height breakup" }, { "id": "meso", "frequency": 14.0, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters" }, { "id": "micro", "frequency": 72.0, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light" }], "roughness": { "base": 0.77, "variation": 0.122, "map": { "path": "models/kettle/maps/hammered-copper_roughness.jpg", "url": "models/kettle/maps/hammered-copper_roughness.jpg", "channel": "roughness", "source": "reference-pixel-extraction" }, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother" }, "metalness": { "base": 0.9, "variation": 0.05 }, "normal": { "pattern": "reference-derived height-gradient normal map", "strength": 0.24, "map": { "path": "models/kettle/maps/hammered-copper_normal.jpg", "url": "models/kettle/maps/hammered-copper_normal.jpg", "channel": "normal", "source": "reference-pixel-extraction" }, "heightSource": { "path": "models/kettle/maps/hammered-copper_height.jpg", "url": "models/kettle/maps/hammered-copper_height.jpg", "channel": "height", "source": "reference-pixel-extraction" }, "space": "tangent" }, "bump": { "pattern": "reference-derived height field", "amplitude": 0.032, "map": { "path": "models/kettle/maps/hammered-copper_height.jpg", "url": "models/kettle/maps/hammered-copper_height.jpg", "channel": "height", "source": "reference-pixel-extraction" } }, "displacement": { "pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false }, "ambientOcclusion": { "cavityStrength": 0.38, "contactShadowBias": 0.35, "map": { "path": "models/kettle/maps/hammered-copper_ao.jpg", "url": "models/kettle/maps/hammered-copper_ao.jpg", "channel": "ao", "source": "reference-pixel-extraction" }, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot." }, "wear": { "edgeWear": 0.3, "scratches": ["fine radial scratches on the shoulder"], "chips": [] }, "dirt": { "amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22" }, "localOverrides": [{ "id": "oxidation-patches", "kind": "stain", "mask": "cavity of hammer-dent field", "color": "#2E2620", "roughness": 0.7 }, { "id": "shoulder-highlight", "kind": "gloss", "mask": "upper shoulder facing the light", "roughness": 0.25 }, { "id": "dent-cavities", "kind": "dirt", "mask": "dent centres", "color": "#3E332D" }, { "id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison." }], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "Warm copper with dark oxidised patches in the hammer dents; brighter on raised facets.", "referencePbr": { "version": "1.0", "sourceImage": "body.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.763, "estimatedFidelity": 0.763, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": { "albedo": { "path": "models/kettle/maps/hammered-copper_albedo.jpg", "url": "models/kettle/maps/hammered-copper_albedo.jpg", "channel": "albedo", "source": "reference-pixel-extraction" }, "roughness": { "path": "models/kettle/maps/hammered-copper_roughness.jpg", "url": "models/kettle/maps/hammered-copper_roughness.jpg", "channel": "roughness", "source": "reference-pixel-extraction" }, "height": { "path": "models/kettle/maps/hammered-copper_height.jpg", "url": "models/kettle/maps/hammered-copper_height.jpg", "channel": "height", "source": "reference-pixel-extraction" }, "normal": { "path": "models/kettle/maps/hammered-copper_normal.jpg", "url": "models/kettle/maps/hammered-copper_normal.jpg", "channel": "normal", "source": "reference-pixel-extraction" }, "ao": { "path": "models/kettle/maps/hammered-copper_ao.jpg", "url": "models/kettle/maps/hammered-copper_ao.jpg", "channel": "ao", "source": "reference-pixel-extraction" } }, "diagnostics": { "sourceWidth": 300, "sourceHeight": 180, "mapSize": 1024, "cropBBoxPixels": { "x": 0, "y": 0, "width": 300, "height": 180 }, "mask": { "backgroundColor": "#5A483D", "backgroundNoise": 22.825, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.976 }, "mapStats": { "valueRange": 0.2157, "heightP90Gradient": 0.07108, "roughnessBase": 0.77, "roughnessVariation": 0.122, "normalStrength": 0.24, "blurRadius": 21 }, "palette": ["#5D493C", "#6D5543", "#4E3F35", "#3E332D", "#846751"] }, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"] } }, options);
    materialMap["copper-smooth"] = createSculptMaterial("copper-smooth", { "id": "copper-smooth", "name": "Drawn copper", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#785F4C", "color": "#785F4C", "albedo": { "dominant": "#785F4C", "secondary": ["#5E4D41", "#443932", "#D4CDBB"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": { "path": "models/kettle/maps/copper-smooth_albedo.jpg", "url": "models/kettle/maps/copper-smooth_albedo.jpg", "channel": "albedo", "source": "reference-pixel-extraction" } }, "colorVariation": { "palette": ["#785F4C", "#5E4D41", "#443932", "#D4CDBB", "#90745E"], "pattern": "reference-derived pixel palette", "amplitude": 0.249, "heightCorrelation": 0.42 }, "textureResolution": 1024, "textureProjection": { "mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale." }, "surfaceFrequencyBands": [{ "id": "macro", "frequency": 2.0, "amplitude": 0.488, "role": "reference-derived broad albedo and height breakup" }, { "id": "meso", "frequency": 14.0, "amplitude": 0.261, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters" }, { "id": "micro", "frequency": 72.0, "amplitude": 0.118, "role": "reference-derived micro highlight breakup under grazing light" }], "roughness": { "base": 0.702, "variation": 0.05, "map": { "path": "models/kettle/maps/copper-smooth_roughness.jpg", "url": "models/kettle/maps/copper-smooth_roughness.jpg", "channel": "roughness", "source": "reference-pixel-extraction" }, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother" }, "metalness": { "base": 0.9, "variation": 0.05 }, "normal": { "pattern": "reference-derived height-gradient normal map", "strength": 0.187, "map": { "path": "models/kettle/maps/copper-smooth_normal.jpg", "url": "models/kettle/maps/copper-smooth_normal.jpg", "channel": "normal", "source": "reference-pixel-extraction" }, "heightSource": { "path": "models/kettle/maps/copper-smooth_height.jpg", "url": "models/kettle/maps/copper-smooth_height.jpg", "channel": "height", "source": "reference-pixel-extraction" }, "space": "tangent" }, "bump": { "pattern": "reference-derived height field", "amplitude": 0.012, "map": { "path": "models/kettle/maps/copper-smooth_height.jpg", "url": "models/kettle/maps/copper-smooth_height.jpg", "channel": "height", "source": "reference-pixel-extraction" } }, "displacement": { "pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false }, "ambientOcclusion": { "cavityStrength": 0.38, "contactShadowBias": 0.35, "map": { "path": "models/kettle/maps/copper-smooth_ao.jpg", "url": "models/kettle/maps/copper-smooth_ao.jpg", "channel": "ao", "source": "reference-pixel-extraction" }, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot." }, "wear": { "edgeWear": 0.0, "scratches": [], "chips": [] }, "dirt": { "amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22" }, "localOverrides": [{ "id": "spout-highlight", "kind": "gloss", "mask": "outer curve of the spout", "roughness": 0.22 }, { "id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison." }], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "Smoother drawn copper on the spout and knob; long soft highlight along the spout.", "referencePbr": { "version": "1.0", "sourceImage": "spout.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.829, "estimatedFidelity": 0.829, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": { "albedo": { "path": "models/kettle/maps/copper-smooth_albedo.jpg", "url": "models/kettle/maps/copper-smooth_albedo.jpg", "channel": "albedo", "source": "reference-pixel-extraction" }, "roughness": { "path": "models/kettle/maps/copper-smooth_roughness.jpg", "url": "models/kettle/maps/copper-smooth_roughness.jpg", "channel": "roughness", "source": "reference-pixel-extraction" }, "height": { "path": "models/kettle/maps/copper-smooth_height.jpg", "url": "models/kettle/maps/copper-smooth_height.jpg", "channel": "height", "source": "reference-pixel-extraction" }, "normal": { "path": "models/kettle/maps/copper-smooth_normal.jpg", "url": "models/kettle/maps/copper-smooth_normal.jpg", "channel": "normal", "source": "reference-pixel-extraction" }, "ao": { "path": "models/kettle/maps/copper-smooth_ao.jpg", "url": "models/kettle/maps/copper-smooth_ao.jpg", "channel": "ao", "source": "reference-pixel-extraction" } }, "diagnostics": { "sourceWidth": 40, "sourceHeight": 90, "mapSize": 1024, "cropBBoxPixels": { "x": 0, "y": 0, "width": 40, "height": 90 }, "mask": { "backgroundColor": "#6C5848", "backgroundNoise": 44.565, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.9964 }, "mapStats": { "valueRange": 0.593, "heightP90Gradient": 0.02641, "roughnessBase": 0.702, "roughnessVariation": 0.05, "normalStrength": 0.187, "blurRadius": 21 }, "palette": ["#785F4C", "#5E4D41", "#443932", "#D4CDBB", "#90745E"] }, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"] } }, options);
    materialMap["wrought-wire"] = createSculptMaterial("wrought-wire", { "id": "wrought-wire", "name": "Dark iron wire", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#453831", "color": "#453831", "albedo": { "dominant": "#453831", "secondary": ["#DFD8C6", "#5E4F44", "#77695C"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": { "path": "models/kettle/maps/wrought-wire_albedo.jpg", "url": "models/kettle/maps/wrought-wire_albedo.jpg", "channel": "albedo", "source": "reference-pixel-extraction" } }, "colorVariation": { "palette": ["#453831", "#DFD8C6", "#5E4F44", "#77695C", "#2D2219"], "pattern": "reference-derived pixel palette", "amplitude": 0.305, "heightCorrelation": 0.42 }, "textureResolution": 1024, "textureProjection": { "mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale." }, "surfaceFrequencyBands": [{ "id": "macro", "frequency": 2.0, "amplitude": 0.52, "role": "reference-derived broad albedo and height breakup" }, { "id": "meso", "frequency": 14.0, "amplitude": 0.273, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters" }, { "id": "micro", "frequency": 72.0, "amplitude": 0.125, "role": "reference-derived micro highlight breakup under grazing light" }], "roughness": { "base": 0.699, "variation": 0.05, "map": { "path": "models/kettle/maps/wrought-wire_roughness.jpg", "url": "models/kettle/maps/wrought-wire_roughness.jpg", "channel": "roughness", "source": "reference-pixel-extraction" }, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother" }, "metalness": { "base": 0.8, "variation": 0.05 }, "normal": { "pattern": "reference-derived height-gradient normal map", "strength": 0.191, "map": { "path": "models/kettle/maps/wrought-wire_normal.jpg", "url": "models/kettle/maps/wrought-wire_normal.jpg", "channel": "normal", "source": "reference-pixel-extraction" }, "heightSource": { "path": "models/kettle/maps/wrought-wire_height.jpg", "url": "models/kettle/maps/wrought-wire_height.jpg", "channel": "height", "source": "reference-pixel-extraction" }, "space": "tangent" }, "bump": { "pattern": "reference-derived height field", "amplitude": 0.013, "map": { "path": "models/kettle/maps/wrought-wire_height.jpg", "url": "models/kettle/maps/wrought-wire_height.jpg", "channel": "height", "source": "reference-pixel-extraction" } }, "displacement": { "pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false }, "ambientOcclusion": { "cavityStrength": 0.38, "contactShadowBias": 0.35, "map": { "path": "models/kettle/maps/wrought-wire_ao.jpg", "url": "models/kettle/maps/wrought-wire_ao.jpg", "channel": "ao", "source": "reference-pixel-extraction" }, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot." }, "wear": { "edgeWear": 0.0, "scratches": [], "chips": [] }, "dirt": { "amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22" }, "localOverrides": [{ "id": "wire-grime", "kind": "dirt", "mask": "bends and hook ends", "color": "#2D2218" }, { "id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison." }], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "Dark brown iron wire with a dull sheen.", "referencePbr": { "version": "1.0", "sourceImage": "handle.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.829, "estimatedFidelity": 0.829, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": { "albedo": { "path": "models/kettle/maps/wrought-wire_albedo.jpg", "url": "models/kettle/maps/wrought-wire_albedo.jpg", "channel": "albedo", "source": "reference-pixel-extraction" }, "roughness": { "path": "models/kettle/maps/wrought-wire_roughness.jpg", "url": "models/kettle/maps/wrought-wire_roughness.jpg", "channel": "roughness", "source": "reference-pixel-extraction" }, "height": { "path": "models/kettle/maps/wrought-wire_height.jpg", "url": "models/kettle/maps/wrought-wire_height.jpg", "channel": "height", "source": "reference-pixel-extraction" }, "normal": { "path": "models/kettle/maps/wrought-wire_normal.jpg", "url": "models/kettle/maps/wrought-wire_normal.jpg", "channel": "normal", "source": "reference-pixel-extraction" }, "ao": { "path": "models/kettle/maps/wrought-wire_ao.jpg", "url": "models/kettle/maps/wrought-wire_ao.jpg", "channel": "ao", "source": "reference-pixel-extraction" } }, "diagnostics": { "sourceWidth": 120, "sourceHeight": 14, "mapSize": 1024, "cropBBoxPixels": { "x": 0, "y": 0, "width": 120, "height": 14 }, "mask": { "backgroundColor": "#5A4A3F", "backgroundNoise": 90.344, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.9589 }, "mapStats": { "valueRange": 0.7258, "heightP90Gradient": 0.02927, "roughnessBase": 0.699, "roughnessVariation": 0.05, "normalStrength": 0.191, "blurRadius": 21 }, "palette": ["#453831", "#DFD8C6", "#5E4F44", "#77695C", "#2D2219"] }, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"] } }, options);
    const nodes = { root };
    const meshes = {};
    const sockets = {};
    const colliders = {};
    const destructionGroups = {};
    const endpoint_body_0 = makeAttachmentEndpoint(null);
    const node_body_0 = new THREE.Group();
    node_body_0.name = "Hammered body__pivot";
    node_body_0.scale.set(1, 1, 1);
    if (endpoint_body_0) {
        node_body_0.position.copy(endpoint_body_0.start);
        node_body_0.rotation.set(0.0, 3.141592653589793, 0.0);
    }
    else {
        node_body_0.position.set(0.0, 0.0, 0.0);
        node_body_0.rotation.set(0.0, 3.141592653589793, 0.0);
    }
    node_body_0.userData.sculptComponent = { "id": "body", "name": "Hammered body", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "One continuous raised-copper vessel wall; a revolved profile, not a box.", "geometryDescriptor": { "topologyIntent": "lathe built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": { "points": [[0.0, 0.0], [0.94, 0.0], [1.05, 0.04], [1.1, 0.16], [1.12, 0.5], [1.12, 0.92], [1.08, 1.1], [0.96, 1.22], [0.8, 1.3], [0.66, 1.34], [0.6, 1.33], [0.57, 1.3], [0.55, 0.22], [0.0, 0.2]], "segments": 64 } }, "parent": null, "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 3.141592653589793, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "root", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "hammered-copper", "materialLayers": ["hammered-copper"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "hammer-dents", "kind": "contour", "notes": "irregular raised-and-sunk facets 1-2 cm across over the whole wall" }, { "id": "bulged-wall", "kind": "contour", "notes": "the wall bulges out ~3% between foot and shoulder" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(106, 80, 64, 1.0)", "secondaryAlbedo": "rgba(62, 51, 45, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(62, 51, 45, 1.0)" }, { "pos": 1.0, "color": "rgba(106, 80, 64, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_body_0.userData.actionProfile = { "animationRole": "root", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["root"] ?? root).add(node_body_0);
    nodes["body"] = node_body_0;
    const mesh_body_0Geometry = endpoint_body_0
        ? new THREE.CylinderGeometry(endpoint_body_0.endRadius, endpoint_body_0.baseRadius, endpoint_body_0.length, 16, 6)
        : buildLatheGeometry({ "points": [[0.0, 0.0], [0.94, 0.0], [1.05, 0.04], [1.1, 0.16], [1.12, 0.5], [1.12, 0.92], [1.08, 1.1], [0.96, 1.22], [0.8, 1.3], [0.66, 1.34], [0.6, 1.33], [0.57, 1.3], [0.55, 0.22], [0.0, 0.2]], "segments": 64 });
    if (!endpoint_body_0) {
        mesh_body_0Geometry.scale(1.0, 1.0, 1.0);
    }
    const mesh_body_0 = new THREE.Mesh(mesh_body_0Geometry, materialMap["hammered-copper"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_body_0.name = "Hammered body";
    if (endpoint_body_0) {
        mesh_body_0.position.copy(endpoint_body_0.midpoint);
        mesh_body_0.quaternion.copy(endpoint_body_0.quaternion);
    }
    mesh_body_0.castShadow = options.castShadow ?? true;
    mesh_body_0.receiveShadow = options.receiveShadow ?? true;
    mesh_body_0.userData.sculptComponent = { "id": "body", "name": "Hammered body", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "One continuous raised-copper vessel wall; a revolved profile, not a box.", "geometryDescriptor": { "topologyIntent": "lathe built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": { "points": [[0.0, 0.0], [0.94, 0.0], [1.05, 0.04], [1.1, 0.16], [1.12, 0.5], [1.12, 0.92], [1.08, 1.1], [0.96, 1.22], [0.8, 1.3], [0.66, 1.34], [0.6, 1.33], [0.57, 1.3], [0.55, 0.22], [0.0, 0.2]], "segments": 64 } }, "parent": null, "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 3.141592653589793, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "root", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "hammered-copper", "materialLayers": ["hammered-copper"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "hammer-dents", "kind": "contour", "notes": "irregular raised-and-sunk facets 1-2 cm across over the whole wall" }, { "id": "bulged-wall", "kind": "contour", "notes": "the wall bulges out ~3% between foot and shoulder" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(106, 80, 64, 1.0)", "secondaryAlbedo": "rgba(62, 51, 45, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(62, 51, 45, 1.0)" }, { "pos": 1.0, "color": "rgba(106, 80, 64, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_body_0.add(mesh_body_0);
    meshes["body"] = mesh_body_0;
    colliders["body"] = { "type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["body"] ?? (destructionGroups["body"] = []);
    destructionGroups["body"].push(node_body_0);
    const endpoint_collar_1 = makeAttachmentEndpoint(null);
    const node_collar_1 = new THREE.Group();
    node_collar_1.name = "Rolled opening collar__pivot";
    node_collar_1.scale.set(1, 1, 1);
    if (endpoint_collar_1) {
        node_collar_1.position.copy(endpoint_collar_1.start);
        node_collar_1.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_collar_1.position.set(0.0, 0.0, 0.0);
        node_collar_1.rotation.set(0.0, 0.0, 0.0);
    }
    node_collar_1.userData.sculptComponent = { "id": "collar", "name": "Rolled opening collar", "level": "meso", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Rolled opening collar: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "lathe built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": { "points": [[0.56, 1.3], [0.66, 1.33], [0.68, 1.4], [0.64, 1.45], [0.58, 1.44], [0.56, 1.36]], "segments": 48 } }, "parent": "body", "attachment": { "parentId": "body", "parentSocket": "shoulder-opening", "localStart": [0, 1.3, 0], "localEnd": [0, 1.45, 0], "contactType": "butt", "embedDepth": 0.02, "gapTolerance": 0.01 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "collar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "hammered-copper", "materialLayers": ["hammered-copper"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "rolled-rim", "kind": "bevel", "notes": "rolled bead on the opening edge" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(112, 87, 68, 1.0)", "secondaryAlbedo": "rgba(78, 63, 53, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(78, 63, 53, 1.0)" }, { "pos": 1.0, "color": "rgba(112, 87, 68, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_collar_1.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "collar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["body"] ?? root).add(node_collar_1);
    nodes["collar"] = node_collar_1;
    const mesh_collar_1Geometry = endpoint_collar_1
        ? new THREE.CylinderGeometry(endpoint_collar_1.endRadius, endpoint_collar_1.baseRadius, endpoint_collar_1.length, 16, 6)
        : buildLatheGeometry({ "points": [[0.56, 1.3], [0.66, 1.33], [0.68, 1.4], [0.64, 1.45], [0.58, 1.44], [0.56, 1.36]], "segments": 48 });
    if (!endpoint_collar_1) {
        mesh_collar_1Geometry.scale(1.0, 1.0, 1.0);
    }
    const mesh_collar_1 = new THREE.Mesh(mesh_collar_1Geometry, materialMap["hammered-copper"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_collar_1.name = "Rolled opening collar";
    if (endpoint_collar_1) {
        mesh_collar_1.position.copy(endpoint_collar_1.midpoint);
        mesh_collar_1.quaternion.copy(endpoint_collar_1.quaternion);
    }
    mesh_collar_1.castShadow = options.castShadow ?? true;
    mesh_collar_1.receiveShadow = options.receiveShadow ?? true;
    mesh_collar_1.userData.sculptComponent = { "id": "collar", "name": "Rolled opening collar", "level": "meso", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Rolled opening collar: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "lathe built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": { "points": [[0.56, 1.3], [0.66, 1.33], [0.68, 1.4], [0.64, 1.45], [0.58, 1.44], [0.56, 1.36]], "segments": 48 } }, "parent": "body", "attachment": { "parentId": "body", "parentSocket": "shoulder-opening", "localStart": [0, 1.3, 0], "localEnd": [0, 1.45, 0], "contactType": "butt", "embedDepth": 0.02, "gapTolerance": 0.01 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "collar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "hammered-copper", "materialLayers": ["hammered-copper"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "rolled-rim", "kind": "bevel", "notes": "rolled bead on the opening edge" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(112, 87, 68, 1.0)", "secondaryAlbedo": "rgba(78, 63, 53, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(78, 63, 53, 1.0)" }, { "pos": 1.0, "color": "rgba(112, 87, 68, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_collar_1.add(mesh_collar_1);
    meshes["collar"] = mesh_collar_1;
    colliders["collar"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["collar"] ?? (destructionGroups["collar"] = []);
    destructionGroups["collar"].push(node_collar_1);
    const endpoint_lid_2 = makeAttachmentEndpoint(null);
    const node_lid_2 = new THREE.Group();
    node_lid_2.name = "Domed lid__pivot";
    node_lid_2.scale.set(1, 1, 1);
    if (endpoint_lid_2) {
        node_lid_2.position.copy(endpoint_lid_2.start);
        node_lid_2.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_lid_2.position.set(0.0, 0.0, 0.0);
        node_lid_2.rotation.set(0.0, 0.0, 0.0);
    }
    node_lid_2.userData.sculptComponent = { "id": "lid", "name": "Domed lid", "level": "meso", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Domed lid: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "lathe built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": { "points": [[0.55, 1.42], [0.63, 1.43], [0.62, 1.46], [0.48, 1.53], [0.25, 1.585], [0.0, 1.6]], "segments": 48 } }, "parent": "collar", "attachment": { "parentId": "collar", "parentSocket": "collar-seat", "localStart": [0, 1.42, 0], "localEnd": [0, 1.6, 0], "contactType": "overlap", "overlap": 0.02, "gapTolerance": 0.01 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "hinge", "pivot": { "mode": "custom", "localPosition": [0, 1.43, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "lid", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "hammered-copper", "materialLayers": ["hammered-copper"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "lid-patina", "kind": "stain", "notes": "dark oxidised blotches on the dome" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(119, 93, 72, 1.0)", "secondaryAlbedo": "rgba(64, 52, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(64, 52, 44, 1.0)" }, { "pos": 1.0, "color": "rgba(119, 93, 72, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_lid_2.userData.actionProfile = { "animationRole": "hinge", "pivot": { "mode": "custom", "localPosition": [0, 1.43, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "lid", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["collar"] ?? root).add(node_lid_2);
    nodes["lid"] = node_lid_2;
    const mesh_lid_2Geometry = endpoint_lid_2
        ? new THREE.CylinderGeometry(endpoint_lid_2.endRadius, endpoint_lid_2.baseRadius, endpoint_lid_2.length, 16, 6)
        : buildLatheGeometry({ "points": [[0.55, 1.42], [0.63, 1.43], [0.62, 1.46], [0.48, 1.53], [0.25, 1.585], [0.0, 1.6]], "segments": 48 });
    if (!endpoint_lid_2) {
        mesh_lid_2Geometry.scale(1.0, 1.0, 1.0);
    }
    const mesh_lid_2 = new THREE.Mesh(mesh_lid_2Geometry, materialMap["hammered-copper"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_lid_2.name = "Domed lid";
    if (endpoint_lid_2) {
        mesh_lid_2.position.copy(endpoint_lid_2.midpoint);
        mesh_lid_2.quaternion.copy(endpoint_lid_2.quaternion);
    }
    mesh_lid_2.castShadow = options.castShadow ?? true;
    mesh_lid_2.receiveShadow = options.receiveShadow ?? true;
    mesh_lid_2.userData.sculptComponent = { "id": "lid", "name": "Domed lid", "level": "meso", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Domed lid: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "lathe built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": { "points": [[0.55, 1.42], [0.63, 1.43], [0.62, 1.46], [0.48, 1.53], [0.25, 1.585], [0.0, 1.6]], "segments": 48 } }, "parent": "collar", "attachment": { "parentId": "collar", "parentSocket": "collar-seat", "localStart": [0, 1.42, 0], "localEnd": [0, 1.6, 0], "contactType": "overlap", "overlap": 0.02, "gapTolerance": 0.01 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "hinge", "pivot": { "mode": "custom", "localPosition": [0, 1.43, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "lid", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "hammered-copper", "materialLayers": ["hammered-copper"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "lid-patina", "kind": "stain", "notes": "dark oxidised blotches on the dome" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(119, 93, 72, 1.0)", "secondaryAlbedo": "rgba(64, 52, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(64, 52, 44, 1.0)" }, { "pos": 1.0, "color": "rgba(119, 93, 72, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_lid_2.add(mesh_lid_2);
    meshes["lid"] = mesh_lid_2;
    colliders["lid"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["lid"] ?? (destructionGroups["lid"] = []);
    destructionGroups["lid"].push(node_lid_2);
    const endpoint_knob_3 = makeAttachmentEndpoint(null);
    const node_knob_3 = new THREE.Group();
    node_knob_3.name = "Lid knob__pivot";
    node_knob_3.scale.set(1, 1, 1);
    if (endpoint_knob_3) {
        node_knob_3.position.copy(endpoint_knob_3.start);
        node_knob_3.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_knob_3.position.set(0.0, 0.0, 0.0);
        node_knob_3.rotation.set(0.0, 0.0, 0.0);
    }
    node_knob_3.userData.sculptComponent = { "id": "knob", "name": "Lid knob", "level": "micro", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Lid knob: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "lathe built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": { "points": [[0.0, 1.59], [0.05, 1.59], [0.035, 1.64], [0.075, 1.68], [0.06, 1.72], [0.0, 1.73]], "segments": 24 } }, "parent": "lid", "attachment": { "parentId": "lid", "parentSocket": "lid-crown", "localStart": [0, 1.59, 0], "localEnd": [0, 1.73, 0], "contactType": "embed", "embedDepth": 0.01, "gapTolerance": 0.005 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "knob", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "copper-smooth", "materialLayers": ["copper-smooth"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "knob-bead", "kind": "contour", "notes": "turned bead on a short stem" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(120, 95, 76, 1.0)", "secondaryAlbedo": "rgba(68, 57, 50, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(68, 57, 50, 1.0)" }, { "pos": 1.0, "color": "rgba(120, 95, 76, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_knob_3.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "knob", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["lid"] ?? root).add(node_knob_3);
    nodes["knob"] = node_knob_3;
    const mesh_knob_3Geometry = endpoint_knob_3
        ? new THREE.CylinderGeometry(endpoint_knob_3.endRadius, endpoint_knob_3.baseRadius, endpoint_knob_3.length, 16, 6)
        : buildLatheGeometry({ "points": [[0.0, 1.59], [0.05, 1.59], [0.035, 1.64], [0.075, 1.68], [0.06, 1.72], [0.0, 1.73]], "segments": 24 });
    if (!endpoint_knob_3) {
        mesh_knob_3Geometry.scale(1.0, 1.0, 1.0);
    }
    const mesh_knob_3 = new THREE.Mesh(mesh_knob_3Geometry, materialMap["copper-smooth"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_knob_3.name = "Lid knob";
    if (endpoint_knob_3) {
        mesh_knob_3.position.copy(endpoint_knob_3.midpoint);
        mesh_knob_3.quaternion.copy(endpoint_knob_3.quaternion);
    }
    mesh_knob_3.castShadow = options.castShadow ?? true;
    mesh_knob_3.receiveShadow = options.receiveShadow ?? true;
    mesh_knob_3.userData.sculptComponent = { "id": "knob", "name": "Lid knob", "level": "micro", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Lid knob: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "lathe built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": { "points": [[0.0, 1.59], [0.05, 1.59], [0.035, 1.64], [0.075, 1.68], [0.06, 1.72], [0.0, 1.73]], "segments": 24 } }, "parent": "lid", "attachment": { "parentId": "lid", "parentSocket": "lid-crown", "localStart": [0, 1.59, 0], "localEnd": [0, 1.73, 0], "contactType": "embed", "embedDepth": 0.01, "gapTolerance": 0.005 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "knob", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "copper-smooth", "materialLayers": ["copper-smooth"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "knob-bead", "kind": "contour", "notes": "turned bead on a short stem" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(120, 95, 76, 1.0)", "secondaryAlbedo": "rgba(68, 57, 50, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(68, 57, 50, 1.0)" }, { "pos": 1.0, "color": "rgba(120, 95, 76, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_knob_3.add(mesh_knob_3);
    meshes["knob"] = mesh_knob_3;
    colliders["knob"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["knob"] ?? (destructionGroups["knob"] = []);
    destructionGroups["knob"].push(node_knob_3);
    const endpoint_foot_ring_4 = makeAttachmentEndpoint(null);
    const node_foot_ring_4 = new THREE.Group();
    node_foot_ring_4.name = "Foot ring__pivot";
    node_foot_ring_4.scale.set(1, 1, 1);
    if (endpoint_foot_ring_4) {
        node_foot_ring_4.position.copy(endpoint_foot_ring_4.start);
        node_foot_ring_4.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_foot_ring_4.position.set(0.0, 0.0, 0.0);
        node_foot_ring_4.rotation.set(0.0, 0.0, 0.0);
    }
    node_foot_ring_4.userData.sculptComponent = { "id": "foot-ring", "name": "Foot ring", "level": "micro", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Foot ring: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "lathe built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": { "points": [[0.9, -0.02], [1.02, -0.02], [1.06, 0.04], [1.0, 0.06], [0.9, 0.04]], "segments": 64 } }, "parent": "body", "attachment": { "parentId": "body", "parentSocket": "base", "localStart": [0, -0.02, 0], "localEnd": [0, 0.06, 0], "contactType": "overlap", "overlap": 0.02, "gapTolerance": 0.01 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "foot-ring", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "hammered-copper", "materialLayers": ["hammered-copper"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "foot-seam", "kind": "seam", "notes": "lapped seam where the base meets the wall" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(78, 63, 53, 1.0)", "secondaryAlbedo": "rgba(62, 51, 45, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(62, 51, 45, 1.0)" }, { "pos": 1.0, "color": "rgba(78, 63, 53, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_foot_ring_4.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "foot-ring", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["body"] ?? root).add(node_foot_ring_4);
    nodes["foot-ring"] = node_foot_ring_4;
    const mesh_foot_ring_4Geometry = endpoint_foot_ring_4
        ? new THREE.CylinderGeometry(endpoint_foot_ring_4.endRadius, endpoint_foot_ring_4.baseRadius, endpoint_foot_ring_4.length, 16, 6)
        : buildLatheGeometry({ "points": [[0.9, -0.02], [1.02, -0.02], [1.06, 0.04], [1.0, 0.06], [0.9, 0.04]], "segments": 64 });
    if (!endpoint_foot_ring_4) {
        mesh_foot_ring_4Geometry.scale(1.0, 1.0, 1.0);
    }
    const mesh_foot_ring_4 = new THREE.Mesh(mesh_foot_ring_4Geometry, materialMap["hammered-copper"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_foot_ring_4.name = "Foot ring";
    if (endpoint_foot_ring_4) {
        mesh_foot_ring_4.position.copy(endpoint_foot_ring_4.midpoint);
        mesh_foot_ring_4.quaternion.copy(endpoint_foot_ring_4.quaternion);
    }
    mesh_foot_ring_4.castShadow = options.castShadow ?? true;
    mesh_foot_ring_4.receiveShadow = options.receiveShadow ?? true;
    mesh_foot_ring_4.userData.sculptComponent = { "id": "foot-ring", "name": "Foot ring", "level": "micro", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Foot ring: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "lathe built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": { "points": [[0.9, -0.02], [1.02, -0.02], [1.06, 0.04], [1.0, 0.06], [0.9, 0.04]], "segments": 64 } }, "parent": "body", "attachment": { "parentId": "body", "parentSocket": "base", "localStart": [0, -0.02, 0], "localEnd": [0, 0.06, 0], "contactType": "overlap", "overlap": 0.02, "gapTolerance": 0.01 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "foot-ring", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "hammered-copper", "materialLayers": ["hammered-copper"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "foot-seam", "kind": "seam", "notes": "lapped seam where the base meets the wall" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(78, 63, 53, 1.0)", "secondaryAlbedo": "rgba(62, 51, 45, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(62, 51, 45, 1.0)" }, { "pos": 1.0, "color": "rgba(78, 63, 53, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_foot_ring_4.add(mesh_foot_ring_4);
    meshes["foot-ring"] = mesh_foot_ring_4;
    colliders["foot-ring"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["foot-ring"] ?? (destructionGroups["foot-ring"] = []);
    destructionGroups["foot-ring"].push(node_foot_ring_4);
    const endpoint_spout_5 = makeAttachmentEndpoint(null);
    const node_spout_5 = new THREE.Group();
    node_spout_5.name = "Gooseneck spout__pivot";
    node_spout_5.scale.set(1, 1, 1);
    if (endpoint_spout_5) {
        node_spout_5.position.copy(endpoint_spout_5.start);
        node_spout_5.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_spout_5.position.set(0.0, 0.0, 0.0);
        node_spout_5.rotation.set(0.0, 0.0, 0.0);
    }
    node_spout_5.userData.sculptComponent = { "id": "spout", "name": "Gooseneck spout", "level": "meso", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "A drawn copper tube whose section tapers along an S-curved spine.", "geometryDescriptor": { "topologyIntent": "tapered-sweep built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "taperedSweep": { "stations": [{ "position": [-0.82, 0.36, 0.0], "rx": 0.25, "rz": 0.22, "twist": 0.0 }, { "position": [-0.8494, 0.3656, 0.0], "rx": 0.2417, "rz": 0.2133, "twist": 0.0 }, { "position": [-0.8911, 0.3726, 0.0], "rx": 0.2333, "rz": 0.2067, "twist": 0.0 }, { "position": [-0.94, 0.3813, 0.0], "rx": 0.225, "rz": 0.2, "twist": 0.0 }, { "position": [-0.9911, 0.3919, 0.0], "rx": 0.2167, "rz": 0.1933, "twist": 0.0 }, { "position": [-1.0394, 0.4047, 0.0], "rx": 0.2083, "rz": 0.1867, "twist": 0.0 }, { "position": [-1.08, 0.42, 0.0], "rx": 0.2, "rz": 0.18, "twist": 0.0 }, { "position": [-1.1134, 0.438, 0.0], "rx": 0.1925, "rz": 0.1742, "twist": 0.0 }, { "position": [-1.1437, 0.4585, 0.0], "rx": 0.185, "rz": 0.1683, "twist": 0.0 }, { "position": [-1.1712, 0.4812, 0.0], "rx": 0.1775, "rz": 0.1625, "twist": 0.0 }, { "position": [-1.1963, 0.5059, 0.0], "rx": 0.17, "rz": 0.1567, "twist": 0.0 }, { "position": [-1.2191, 0.5323, 0.0], "rx": 0.1625, "rz": 0.1508, "twist": 0.0 }, { "position": [-1.24, 0.56, 0.0], "rx": 0.155, "rz": 0.145, "twist": 0.0 }, { "position": [-1.2584, 0.5896, 0.0], "rx": 0.15, "rz": 0.1408, "twist": 0.0 }, { "position": [-1.2741, 0.6215, 0.0], "rx": 0.145, "rz": 0.1367, "twist": 0.0 }, { "position": [-1.2875, 0.655, 0.0], "rx": 0.14, "rz": 0.1325, "twist": 0.0 }, { "position": [-1.2993, 0.6896, 0.0], "rx": 0.135, "rz": 0.1283, "twist": 0.0 }, { "position": [-1.3099, 0.7248, 0.0], "rx": 0.13, "rz": 0.1242, "twist": 0.0 }, { "position": [-1.32, 0.76, 0.0], "rx": 0.125, "rz": 0.12, "twist": 0.0 }, { "position": [-1.3288, 0.7957, 0.0], "rx": 0.1217, "rz": 0.1167, "twist": 0.0 }, { "position": [-1.3356, 0.8326, 0.0], "rx": 0.1183, "rz": 0.1133, "twist": 0.0 }, { "position": [-1.3412, 0.87, 0.0], "rx": 0.115, "rz": 0.11, "twist": 0.0 }, { "position": [-1.3467, 0.9074, 0.0], "rx": 0.1117, "rz": 0.1067, "twist": 0.0 }, { "position": [-1.3526, 0.9443, 0.0], "rx": 0.1083, "rz": 0.1033, "twist": 0.0 }, { "position": [-1.36, 0.98, 0.0], "rx": 0.105, "rz": 0.1, "twist": 0.0 }, { "position": [-1.3686, 1.0152, 0.0], "rx": 0.1025, "rz": 0.098, "twist": 0.0 }, { "position": [-1.3778, 1.0504, 0.0], "rx": 0.1, "rz": 0.096, "twist": 0.0 }, { "position": [-1.3875, 1.085, 0.0], "rx": 0.0975, "rz": 0.094, "twist": 0.0 }, { "position": [-1.3978, 1.1185, 0.0], "rx": 0.095, "rz": 0.092, "twist": 0.0 }, { "position": [-1.4086, 1.1504, 0.0], "rx": 0.0925, "rz": 0.09, "twist": 0.0 }, { "position": [-1.42, 1.18, 0.0], "rx": 0.09, "rz": 0.088, "twist": 0.0 }, { "position": [-1.4319, 1.2075, 0.0], "rx": 0.0883, "rz": 0.0863, "twist": 0.0 }, { "position": [-1.4444, 1.2333, 0.0], "rx": 0.0867, "rz": 0.0847, "twist": 0.0 }, { "position": [-1.4575, 1.2575, 0.0], "rx": 0.085, "rz": 0.083, "twist": 0.0 }, { "position": [-1.4711, 1.28, 0.0], "rx": 0.0833, "rz": 0.0813, "twist": 0.0 }, { "position": [-1.4853, 1.3008, 0.0], "rx": 0.0817, "rz": 0.0797, "twist": 0.0 }, { "position": [-1.5, 1.32, 0.0], "rx": 0.08, "rz": 0.078, "twist": 0.0 }, { "position": [-1.5155, 1.3373, 0.0], "rx": 0.0792, "rz": 0.0767, "twist": 0.0 }, { "position": [-1.5319, 1.3526, 0.0], "rx": 0.0783, "rz": 0.0753, "twist": 0.0 }, { "position": [-1.5488, 1.3662, 0.0], "rx": 0.0775, "rz": 0.074, "twist": 0.0 }, { "position": [-1.5659, 1.3785, 0.0], "rx": 0.0767, "rz": 0.0727, "twist": 0.0 }, { "position": [-1.5831, 1.3897, 0.0], "rx": 0.0758, "rz": 0.0713, "twist": 0.0 }, { "position": [-1.6, 1.4, 0.0], "rx": 0.075, "rz": 0.07, "twist": 0.0 }, { "position": [-1.6169, 1.4092, 0.0], "rx": 0.0758, "rz": 0.0697, "twist": 0.0 }, { "position": [-1.6341, 1.417, 0.0], "rx": 0.0767, "rz": 0.0693, "twist": 0.0 }, { "position": [-1.6513, 1.4237, 0.0], "rx": 0.0775, "rz": 0.069, "twist": 0.0 }, { "position": [-1.6681, 1.4296, 0.0], "rx": 0.0783, "rz": 0.0687, "twist": 0.0 }, { "position": [-1.6845, 1.435, 0.0], "rx": 0.0792, "rz": 0.0683, "twist": 0.0 }, { "position": [-1.7, 1.44, 0.0], "rx": 0.08, "rz": 0.068, "twist": 0.0 }, { "position": [-1.7154, 1.4447, 0.0], "rx": 0.0833, "rz": 0.0683, "twist": 0.0 }, { "position": [-1.7311, 1.4489, 0.0], "rx": 0.0867, "rz": 0.0687, "twist": 0.0 }, { "position": [-1.7463, 1.4525, 0.0], "rx": 0.09, "rz": 0.069, "twist": 0.0 }, { "position": [-1.76, 1.4556, 0.0], "rx": 0.0933, "rz": 0.0693, "twist": 0.0 }, { "position": [-1.7715, 1.4581, 0.0], "rx": 0.0967, "rz": 0.0697, "twist": 0.0 }, { "position": [-1.78, 1.46, 0], "rx": 0.1, "rz": 0.07, "twist": 0.0 }], "radialSegments": 24, "capEnds": false } }, "parent": "body", "attachment": { "parentId": "body", "parentSocket": "lower-wall", "localStart": [-0.82, 0.36, 0], "localEnd": [-1.78, 1.46, 0], "contactType": "embed", "embedDepth": 0.15, "gapTolerance": 0.01 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "spout", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "copper-smooth", "materialLayers": ["copper-smooth"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "spout-flare", "kind": "contour", "notes": "the tip flares slightly and points up and out" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(120, 95, 76, 1.0)", "secondaryAlbedo": "rgba(68, 57, 50, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(68, 57, 50, 1.0)" }, { "pos": 1.0, "color": "rgba(120, 95, 76, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_spout_5.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "spout", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["body"] ?? root).add(node_spout_5);
    nodes["spout"] = node_spout_5;
    const mesh_spout_5Geometry = endpoint_spout_5
        ? new THREE.CylinderGeometry(endpoint_spout_5.endRadius, endpoint_spout_5.baseRadius, endpoint_spout_5.length, 16, 6)
        : buildTaperedSweepGeometry({ "stations": [{ "position": [-0.82, 0.36, 0.0], "rx": 0.25, "rz": 0.22, "twist": 0.0 }, { "position": [-0.8494, 0.3656, 0.0], "rx": 0.2417, "rz": 0.2133, "twist": 0.0 }, { "position": [-0.8911, 0.3726, 0.0], "rx": 0.2333, "rz": 0.2067, "twist": 0.0 }, { "position": [-0.94, 0.3813, 0.0], "rx": 0.225, "rz": 0.2, "twist": 0.0 }, { "position": [-0.9911, 0.3919, 0.0], "rx": 0.2167, "rz": 0.1933, "twist": 0.0 }, { "position": [-1.0394, 0.4047, 0.0], "rx": 0.2083, "rz": 0.1867, "twist": 0.0 }, { "position": [-1.08, 0.42, 0.0], "rx": 0.2, "rz": 0.18, "twist": 0.0 }, { "position": [-1.1134, 0.438, 0.0], "rx": 0.1925, "rz": 0.1742, "twist": 0.0 }, { "position": [-1.1437, 0.4585, 0.0], "rx": 0.185, "rz": 0.1683, "twist": 0.0 }, { "position": [-1.1712, 0.4812, 0.0], "rx": 0.1775, "rz": 0.1625, "twist": 0.0 }, { "position": [-1.1963, 0.5059, 0.0], "rx": 0.17, "rz": 0.1567, "twist": 0.0 }, { "position": [-1.2191, 0.5323, 0.0], "rx": 0.1625, "rz": 0.1508, "twist": 0.0 }, { "position": [-1.24, 0.56, 0.0], "rx": 0.155, "rz": 0.145, "twist": 0.0 }, { "position": [-1.2584, 0.5896, 0.0], "rx": 0.15, "rz": 0.1408, "twist": 0.0 }, { "position": [-1.2741, 0.6215, 0.0], "rx": 0.145, "rz": 0.1367, "twist": 0.0 }, { "position": [-1.2875, 0.655, 0.0], "rx": 0.14, "rz": 0.1325, "twist": 0.0 }, { "position": [-1.2993, 0.6896, 0.0], "rx": 0.135, "rz": 0.1283, "twist": 0.0 }, { "position": [-1.3099, 0.7248, 0.0], "rx": 0.13, "rz": 0.1242, "twist": 0.0 }, { "position": [-1.32, 0.76, 0.0], "rx": 0.125, "rz": 0.12, "twist": 0.0 }, { "position": [-1.3288, 0.7957, 0.0], "rx": 0.1217, "rz": 0.1167, "twist": 0.0 }, { "position": [-1.3356, 0.8326, 0.0], "rx": 0.1183, "rz": 0.1133, "twist": 0.0 }, { "position": [-1.3412, 0.87, 0.0], "rx": 0.115, "rz": 0.11, "twist": 0.0 }, { "position": [-1.3467, 0.9074, 0.0], "rx": 0.1117, "rz": 0.1067, "twist": 0.0 }, { "position": [-1.3526, 0.9443, 0.0], "rx": 0.1083, "rz": 0.1033, "twist": 0.0 }, { "position": [-1.36, 0.98, 0.0], "rx": 0.105, "rz": 0.1, "twist": 0.0 }, { "position": [-1.3686, 1.0152, 0.0], "rx": 0.1025, "rz": 0.098, "twist": 0.0 }, { "position": [-1.3778, 1.0504, 0.0], "rx": 0.1, "rz": 0.096, "twist": 0.0 }, { "position": [-1.3875, 1.085, 0.0], "rx": 0.0975, "rz": 0.094, "twist": 0.0 }, { "position": [-1.3978, 1.1185, 0.0], "rx": 0.095, "rz": 0.092, "twist": 0.0 }, { "position": [-1.4086, 1.1504, 0.0], "rx": 0.0925, "rz": 0.09, "twist": 0.0 }, { "position": [-1.42, 1.18, 0.0], "rx": 0.09, "rz": 0.088, "twist": 0.0 }, { "position": [-1.4319, 1.2075, 0.0], "rx": 0.0883, "rz": 0.0863, "twist": 0.0 }, { "position": [-1.4444, 1.2333, 0.0], "rx": 0.0867, "rz": 0.0847, "twist": 0.0 }, { "position": [-1.4575, 1.2575, 0.0], "rx": 0.085, "rz": 0.083, "twist": 0.0 }, { "position": [-1.4711, 1.28, 0.0], "rx": 0.0833, "rz": 0.0813, "twist": 0.0 }, { "position": [-1.4853, 1.3008, 0.0], "rx": 0.0817, "rz": 0.0797, "twist": 0.0 }, { "position": [-1.5, 1.32, 0.0], "rx": 0.08, "rz": 0.078, "twist": 0.0 }, { "position": [-1.5155, 1.3373, 0.0], "rx": 0.0792, "rz": 0.0767, "twist": 0.0 }, { "position": [-1.5319, 1.3526, 0.0], "rx": 0.0783, "rz": 0.0753, "twist": 0.0 }, { "position": [-1.5488, 1.3662, 0.0], "rx": 0.0775, "rz": 0.074, "twist": 0.0 }, { "position": [-1.5659, 1.3785, 0.0], "rx": 0.0767, "rz": 0.0727, "twist": 0.0 }, { "position": [-1.5831, 1.3897, 0.0], "rx": 0.0758, "rz": 0.0713, "twist": 0.0 }, { "position": [-1.6, 1.4, 0.0], "rx": 0.075, "rz": 0.07, "twist": 0.0 }, { "position": [-1.6169, 1.4092, 0.0], "rx": 0.0758, "rz": 0.0697, "twist": 0.0 }, { "position": [-1.6341, 1.417, 0.0], "rx": 0.0767, "rz": 0.0693, "twist": 0.0 }, { "position": [-1.6513, 1.4237, 0.0], "rx": 0.0775, "rz": 0.069, "twist": 0.0 }, { "position": [-1.6681, 1.4296, 0.0], "rx": 0.0783, "rz": 0.0687, "twist": 0.0 }, { "position": [-1.6845, 1.435, 0.0], "rx": 0.0792, "rz": 0.0683, "twist": 0.0 }, { "position": [-1.7, 1.44, 0.0], "rx": 0.08, "rz": 0.068, "twist": 0.0 }, { "position": [-1.7154, 1.4447, 0.0], "rx": 0.0833, "rz": 0.0683, "twist": 0.0 }, { "position": [-1.7311, 1.4489, 0.0], "rx": 0.0867, "rz": 0.0687, "twist": 0.0 }, { "position": [-1.7463, 1.4525, 0.0], "rx": 0.09, "rz": 0.069, "twist": 0.0 }, { "position": [-1.76, 1.4556, 0.0], "rx": 0.0933, "rz": 0.0693, "twist": 0.0 }, { "position": [-1.7715, 1.4581, 0.0], "rx": 0.0967, "rz": 0.0697, "twist": 0.0 }, { "position": [-1.78, 1.46, 0], "rx": 0.1, "rz": 0.07, "twist": 0.0 }], "radialSegments": 24, "capEnds": false });
    if (!endpoint_spout_5) {
        mesh_spout_5Geometry.scale(1.0, 1.0, 1.0);
    }
    const mesh_spout_5 = new THREE.Mesh(mesh_spout_5Geometry, materialMap["copper-smooth"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_spout_5.name = "Gooseneck spout";
    if (endpoint_spout_5) {
        mesh_spout_5.position.copy(endpoint_spout_5.midpoint);
        mesh_spout_5.quaternion.copy(endpoint_spout_5.quaternion);
    }
    mesh_spout_5.castShadow = options.castShadow ?? true;
    mesh_spout_5.receiveShadow = options.receiveShadow ?? true;
    mesh_spout_5.userData.sculptComponent = { "id": "spout", "name": "Gooseneck spout", "level": "meso", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "A drawn copper tube whose section tapers along an S-curved spine.", "geometryDescriptor": { "topologyIntent": "tapered-sweep built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "taperedSweep": { "stations": [{ "position": [-0.82, 0.36, 0.0], "rx": 0.25, "rz": 0.22, "twist": 0.0 }, { "position": [-0.8494, 0.3656, 0.0], "rx": 0.2417, "rz": 0.2133, "twist": 0.0 }, { "position": [-0.8911, 0.3726, 0.0], "rx": 0.2333, "rz": 0.2067, "twist": 0.0 }, { "position": [-0.94, 0.3813, 0.0], "rx": 0.225, "rz": 0.2, "twist": 0.0 }, { "position": [-0.9911, 0.3919, 0.0], "rx": 0.2167, "rz": 0.1933, "twist": 0.0 }, { "position": [-1.0394, 0.4047, 0.0], "rx": 0.2083, "rz": 0.1867, "twist": 0.0 }, { "position": [-1.08, 0.42, 0.0], "rx": 0.2, "rz": 0.18, "twist": 0.0 }, { "position": [-1.1134, 0.438, 0.0], "rx": 0.1925, "rz": 0.1742, "twist": 0.0 }, { "position": [-1.1437, 0.4585, 0.0], "rx": 0.185, "rz": 0.1683, "twist": 0.0 }, { "position": [-1.1712, 0.4812, 0.0], "rx": 0.1775, "rz": 0.1625, "twist": 0.0 }, { "position": [-1.1963, 0.5059, 0.0], "rx": 0.17, "rz": 0.1567, "twist": 0.0 }, { "position": [-1.2191, 0.5323, 0.0], "rx": 0.1625, "rz": 0.1508, "twist": 0.0 }, { "position": [-1.24, 0.56, 0.0], "rx": 0.155, "rz": 0.145, "twist": 0.0 }, { "position": [-1.2584, 0.5896, 0.0], "rx": 0.15, "rz": 0.1408, "twist": 0.0 }, { "position": [-1.2741, 0.6215, 0.0], "rx": 0.145, "rz": 0.1367, "twist": 0.0 }, { "position": [-1.2875, 0.655, 0.0], "rx": 0.14, "rz": 0.1325, "twist": 0.0 }, { "position": [-1.2993, 0.6896, 0.0], "rx": 0.135, "rz": 0.1283, "twist": 0.0 }, { "position": [-1.3099, 0.7248, 0.0], "rx": 0.13, "rz": 0.1242, "twist": 0.0 }, { "position": [-1.32, 0.76, 0.0], "rx": 0.125, "rz": 0.12, "twist": 0.0 }, { "position": [-1.3288, 0.7957, 0.0], "rx": 0.1217, "rz": 0.1167, "twist": 0.0 }, { "position": [-1.3356, 0.8326, 0.0], "rx": 0.1183, "rz": 0.1133, "twist": 0.0 }, { "position": [-1.3412, 0.87, 0.0], "rx": 0.115, "rz": 0.11, "twist": 0.0 }, { "position": [-1.3467, 0.9074, 0.0], "rx": 0.1117, "rz": 0.1067, "twist": 0.0 }, { "position": [-1.3526, 0.9443, 0.0], "rx": 0.1083, "rz": 0.1033, "twist": 0.0 }, { "position": [-1.36, 0.98, 0.0], "rx": 0.105, "rz": 0.1, "twist": 0.0 }, { "position": [-1.3686, 1.0152, 0.0], "rx": 0.1025, "rz": 0.098, "twist": 0.0 }, { "position": [-1.3778, 1.0504, 0.0], "rx": 0.1, "rz": 0.096, "twist": 0.0 }, { "position": [-1.3875, 1.085, 0.0], "rx": 0.0975, "rz": 0.094, "twist": 0.0 }, { "position": [-1.3978, 1.1185, 0.0], "rx": 0.095, "rz": 0.092, "twist": 0.0 }, { "position": [-1.4086, 1.1504, 0.0], "rx": 0.0925, "rz": 0.09, "twist": 0.0 }, { "position": [-1.42, 1.18, 0.0], "rx": 0.09, "rz": 0.088, "twist": 0.0 }, { "position": [-1.4319, 1.2075, 0.0], "rx": 0.0883, "rz": 0.0863, "twist": 0.0 }, { "position": [-1.4444, 1.2333, 0.0], "rx": 0.0867, "rz": 0.0847, "twist": 0.0 }, { "position": [-1.4575, 1.2575, 0.0], "rx": 0.085, "rz": 0.083, "twist": 0.0 }, { "position": [-1.4711, 1.28, 0.0], "rx": 0.0833, "rz": 0.0813, "twist": 0.0 }, { "position": [-1.4853, 1.3008, 0.0], "rx": 0.0817, "rz": 0.0797, "twist": 0.0 }, { "position": [-1.5, 1.32, 0.0], "rx": 0.08, "rz": 0.078, "twist": 0.0 }, { "position": [-1.5155, 1.3373, 0.0], "rx": 0.0792, "rz": 0.0767, "twist": 0.0 }, { "position": [-1.5319, 1.3526, 0.0], "rx": 0.0783, "rz": 0.0753, "twist": 0.0 }, { "position": [-1.5488, 1.3662, 0.0], "rx": 0.0775, "rz": 0.074, "twist": 0.0 }, { "position": [-1.5659, 1.3785, 0.0], "rx": 0.0767, "rz": 0.0727, "twist": 0.0 }, { "position": [-1.5831, 1.3897, 0.0], "rx": 0.0758, "rz": 0.0713, "twist": 0.0 }, { "position": [-1.6, 1.4, 0.0], "rx": 0.075, "rz": 0.07, "twist": 0.0 }, { "position": [-1.6169, 1.4092, 0.0], "rx": 0.0758, "rz": 0.0697, "twist": 0.0 }, { "position": [-1.6341, 1.417, 0.0], "rx": 0.0767, "rz": 0.0693, "twist": 0.0 }, { "position": [-1.6513, 1.4237, 0.0], "rx": 0.0775, "rz": 0.069, "twist": 0.0 }, { "position": [-1.6681, 1.4296, 0.0], "rx": 0.0783, "rz": 0.0687, "twist": 0.0 }, { "position": [-1.6845, 1.435, 0.0], "rx": 0.0792, "rz": 0.0683, "twist": 0.0 }, { "position": [-1.7, 1.44, 0.0], "rx": 0.08, "rz": 0.068, "twist": 0.0 }, { "position": [-1.7154, 1.4447, 0.0], "rx": 0.0833, "rz": 0.0683, "twist": 0.0 }, { "position": [-1.7311, 1.4489, 0.0], "rx": 0.0867, "rz": 0.0687, "twist": 0.0 }, { "position": [-1.7463, 1.4525, 0.0], "rx": 0.09, "rz": 0.069, "twist": 0.0 }, { "position": [-1.76, 1.4556, 0.0], "rx": 0.0933, "rz": 0.0693, "twist": 0.0 }, { "position": [-1.7715, 1.4581, 0.0], "rx": 0.0967, "rz": 0.0697, "twist": 0.0 }, { "position": [-1.78, 1.46, 0], "rx": 0.1, "rz": 0.07, "twist": 0.0 }], "radialSegments": 24, "capEnds": false } }, "parent": "body", "attachment": { "parentId": "body", "parentSocket": "lower-wall", "localStart": [-0.82, 0.36, 0], "localEnd": [-1.78, 1.46, 0], "contactType": "embed", "embedDepth": 0.15, "gapTolerance": 0.01 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "spout", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "copper-smooth", "materialLayers": ["copper-smooth"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "spout-flare", "kind": "contour", "notes": "the tip flares slightly and points up and out" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(120, 95, 76, 1.0)", "secondaryAlbedo": "rgba(68, 57, 50, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(68, 57, 50, 1.0)" }, { "pos": 1.0, "color": "rgba(120, 95, 76, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_spout_5.add(mesh_spout_5);
    meshes["spout"] = mesh_spout_5;
    colliders["spout"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["spout"] ?? (destructionGroups["spout"] = []);
    destructionGroups["spout"].push(node_spout_5);
    const endpoint_spout_socket_6 = makeAttachmentEndpoint(null);
    const node_spout_socket_6 = new THREE.Group();
    node_spout_socket_6.name = "Spout socket__pivot";
    node_spout_socket_6.scale.set(1, 1, 1);
    if (endpoint_spout_socket_6) {
        node_spout_socket_6.position.copy(endpoint_spout_socket_6.start);
        node_spout_socket_6.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_spout_socket_6.position.set(-1.05, 0.36, 0.0);
        node_spout_socket_6.rotation.set(0.0, 0.0, 0.0);
    }
    node_spout_socket_6.userData.sculptComponent = { "id": "spout-socket", "name": "Spout socket", "level": "micro", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Spout socket: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "ellipsoid built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "body", "attachment": { "parentId": "body", "parentSocket": "lower-wall", "localStart": [-1.0, 0.36, 0], "localEnd": [-1.14, 0.36, 0], "contactType": "embed", "embedDepth": 0.06, "gapTolerance": 0.01 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [-1.05, 0.36, 0], "rotation": [0, 0, 0], "scale": [0.2, 0.42, 0.42] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "spout-socket", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "copper-smooth", "materialLayers": ["copper-smooth"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "socket-seam", "kind": "seam", "notes": "soldered collar where the spout enters the wall" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 77, 66, 1.0)", "secondaryAlbedo": "rgba(68, 57, 50, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(68, 57, 50, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 77, 66, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_spout_socket_6.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "spout-socket", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["body"] ?? root).add(node_spout_socket_6);
    nodes["spout-socket"] = node_spout_socket_6;
    const mesh_spout_socket_6Geometry = endpoint_spout_socket_6
        ? new THREE.CylinderGeometry(endpoint_spout_socket_6.endRadius, endpoint_spout_socket_6.baseRadius, endpoint_spout_socket_6.length, 16, 6)
        : new THREE.SphereGeometry(0.5, 32, 20);
    if (!endpoint_spout_socket_6) {
        mesh_spout_socket_6Geometry.scale(0.2, 0.42, 0.42);
    }
    const mesh_spout_socket_6 = new THREE.Mesh(mesh_spout_socket_6Geometry, materialMap["copper-smooth"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_spout_socket_6.name = "Spout socket";
    if (endpoint_spout_socket_6) {
        mesh_spout_socket_6.position.copy(endpoint_spout_socket_6.midpoint);
        mesh_spout_socket_6.quaternion.copy(endpoint_spout_socket_6.quaternion);
    }
    mesh_spout_socket_6.castShadow = options.castShadow ?? true;
    mesh_spout_socket_6.receiveShadow = options.receiveShadow ?? true;
    mesh_spout_socket_6.userData.sculptComponent = { "id": "spout-socket", "name": "Spout socket", "level": "micro", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Spout socket: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "ellipsoid built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": "body", "attachment": { "parentId": "body", "parentSocket": "lower-wall", "localStart": [-1.0, 0.36, 0], "localEnd": [-1.14, 0.36, 0], "contactType": "embed", "embedDepth": 0.06, "gapTolerance": 0.01 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [-1.05, 0.36, 0], "rotation": [0, 0, 0], "scale": [0.2, 0.42, 0.42] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "spout-socket", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "copper-smooth", "materialLayers": ["copper-smooth"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "socket-seam", "kind": "seam", "notes": "soldered collar where the spout enters the wall" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(94, 77, 66, 1.0)", "secondaryAlbedo": "rgba(68, 57, 50, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(68, 57, 50, 1.0)" }, { "pos": 1.0, "color": "rgba(94, 77, 66, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_spout_socket_6.add(mesh_spout_socket_6);
    meshes["spout-socket"] = mesh_spout_socket_6;
    colliders["spout-socket"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["spout-socket"] ?? (destructionGroups["spout-socket"] = []);
    destructionGroups["spout-socket"].push(node_spout_socket_6);
    const endpoint_bail_7 = makeAttachmentEndpoint(null);
    const node_bail_7 = new THREE.Group();
    node_bail_7.name = "Swing bail handle__pivot";
    node_bail_7.scale.set(1, 1, 1);
    if (endpoint_bail_7) {
        node_bail_7.position.copy(endpoint_bail_7.start);
        node_bail_7.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_bail_7.position.set(0.0, 0.0, 0.0);
        node_bail_7.rotation.set(0.0, 0.0, 0.0);
    }
    node_bail_7.userData.sculptComponent = { "id": "bail", "name": "Swing bail handle", "level": "macro", "role": "handle", "importance": 0.8, "confidence": 0.8, "primitive": "tapered-sweep", "topologyClass": "assembled-solid", "topologyRationale": "A single bent wire with thinned ends hooked into two lugs.", "geometryDescriptor": { "topologyIntent": "tapered-sweep built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "taperedSweep": { "stations": [{ "position": [0.62, 1.36, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.6287, 1.3734, 0.0], "rx": 0.024, "rz": 0.024, "twist": 0.0 }, { "position": [0.6415, 1.3904, 0.0], "rx": 0.026, "rz": 0.026, "twist": 0.0 }, { "position": [0.6562, 1.4112, 0.0], "rx": 0.028, "rz": 0.028, "twist": 0.0 }, { "position": [0.6707, 1.4363, 0.0], "rx": 0.03, "rz": 0.03, "twist": 0.0 }, { "position": [0.6827, 1.4658, 0.0], "rx": 0.032, "rz": 0.032, "twist": 0.0 }, { "position": [0.69, 1.5, 0.0], "rx": 0.034, "rz": 0.034, "twist": 0.0 }, { "position": [0.6925, 1.5405, 0.0], "rx": 0.0355, "rz": 0.0355, "twist": 0.0 }, { "position": [0.6919, 1.5874, 0.0], "rx": 0.037, "rz": 0.037, "twist": 0.0 }, { "position": [0.6887, 1.6387, 0.0], "rx": 0.0385, "rz": 0.0385, "twist": 0.0 }, { "position": [0.6837, 1.6926, 0.0], "rx": 0.04, "rz": 0.04, "twist": 0.0 }, { "position": [0.6773, 1.747, 0.0], "rx": 0.0415, "rz": 0.0415, "twist": 0.0 }, { "position": [0.67, 1.8, 0.0], "rx": 0.043, "rz": 0.043, "twist": 0.0 }, { "position": [0.6618, 1.8538, 0.0], "rx": 0.0433, "rz": 0.0433, "twist": 0.0 }, { "position": [0.6522, 1.9104, 0.0], "rx": 0.0437, "rz": 0.0437, "twist": 0.0 }, { "position": [0.6413, 1.9675, 0.0], "rx": 0.044, "rz": 0.044, "twist": 0.0 }, { "position": [0.6289, 2.023, 0.0], "rx": 0.0443, "rz": 0.0443, "twist": 0.0 }, { "position": [0.6151, 2.0745, 0.0], "rx": 0.0447, "rz": 0.0447, "twist": 0.0 }, { "position": [0.6, 2.12, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.5841, 2.1594, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.5674, 2.1944, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.5494, 2.2256, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.5293, 2.2533, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.5064, 2.278, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.48, 2.3, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.4496, 2.3187, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.4156, 2.3335, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.3787, 2.3453, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.34, 2.3548, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.3001, 2.3628, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.26, 2.37, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.219, 2.376, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.1763, 2.3802, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.1325, 2.3828, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.0881, 2.3843, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.0438, 2.3849, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.0, 2.385, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.0438, 2.3849, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.0881, 2.3843, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.1325, 2.3828, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.1763, 2.3802, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.219, 2.376, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.26, 2.37, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.3001, 2.3628, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.34, 2.3548, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.3788, 2.3453, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.4156, 2.3335, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.4496, 2.3187, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.48, 2.3, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.5064, 2.278, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.5293, 2.2533, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.5494, 2.2256, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.5674, 2.1944, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.5841, 2.1594, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.6, 2.12, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.6151, 2.0745, 0.0], "rx": 0.0447, "rz": 0.0447, "twist": 0.0 }, { "position": [-0.6289, 2.023, 0.0], "rx": 0.0443, "rz": 0.0443, "twist": 0.0 }, { "position": [-0.6412, 1.9675, 0.0], "rx": 0.044, "rz": 0.044, "twist": 0.0 }, { "position": [-0.6522, 1.9104, 0.0], "rx": 0.0437, "rz": 0.0437, "twist": 0.0 }, { "position": [-0.6618, 1.8538, 0.0], "rx": 0.0433, "rz": 0.0433, "twist": 0.0 }, { "position": [-0.67, 1.8, 0.0], "rx": 0.043, "rz": 0.043, "twist": 0.0 }, { "position": [-0.6773, 1.747, 0.0], "rx": 0.0415, "rz": 0.0415, "twist": 0.0 }, { "position": [-0.6837, 1.6926, 0.0], "rx": 0.04, "rz": 0.04, "twist": 0.0 }, { "position": [-0.6887, 1.6388, 0.0], "rx": 0.0385, "rz": 0.0385, "twist": 0.0 }, { "position": [-0.6919, 1.5874, 0.0], "rx": 0.037, "rz": 0.037, "twist": 0.0 }, { "position": [-0.6925, 1.5405, 0.0], "rx": 0.0355, "rz": 0.0355, "twist": 0.0 }, { "position": [-0.69, 1.5, 0.0], "rx": 0.034, "rz": 0.034, "twist": 0.0 }, { "position": [-0.6827, 1.4658, 0.0], "rx": 0.032, "rz": 0.032, "twist": 0.0 }, { "position": [-0.6707, 1.4363, 0.0], "rx": 0.03, "rz": 0.03, "twist": 0.0 }, { "position": [-0.6563, 1.4113, 0.0], "rx": 0.028, "rz": 0.028, "twist": 0.0 }, { "position": [-0.6415, 1.3904, 0.0], "rx": 0.026, "rz": 0.026, "twist": 0.0 }, { "position": [-0.6287, 1.3734, 0.0], "rx": 0.024, "rz": 0.024, "twist": 0.0 }, { "position": [-0.62, 1.36, 0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }], "radialSegments": 14, "capEnds": true } }, "parent": "body", "attachment": { "parentId": "body", "parentSocket": "lugs", "localStart": [-0.62, 1.36, 0], "localEnd": [0.62, 1.36, 0], "contactType": "socket", "embedDepth": 0.02, "gapTolerance": 0.01 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "hinge", "pivot": { "mode": "custom", "localPosition": [0, 1.36, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "bail", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "wrought-wire", "materialLayers": ["wrought-wire"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "bail-bend", "kind": "contour", "notes": "shouldered bends near each end, flat top span" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(69, 56, 49, 1.0)", "secondaryAlbedo": "rgba(45, 34, 24, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(45, 34, 24, 1.0)" }, { "pos": 1.0, "color": "rgba(69, 56, 49, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_bail_7.userData.actionProfile = { "animationRole": "hinge", "pivot": { "mode": "custom", "localPosition": [0, 1.36, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "bail", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["body"] ?? root).add(node_bail_7);
    nodes["bail"] = node_bail_7;
    const mesh_bail_7Geometry = endpoint_bail_7
        ? new THREE.CylinderGeometry(endpoint_bail_7.endRadius, endpoint_bail_7.baseRadius, endpoint_bail_7.length, 16, 6)
        : buildTaperedSweepGeometry({ "stations": [{ "position": [0.62, 1.36, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.6287, 1.3734, 0.0], "rx": 0.024, "rz": 0.024, "twist": 0.0 }, { "position": [0.6415, 1.3904, 0.0], "rx": 0.026, "rz": 0.026, "twist": 0.0 }, { "position": [0.6562, 1.4112, 0.0], "rx": 0.028, "rz": 0.028, "twist": 0.0 }, { "position": [0.6707, 1.4363, 0.0], "rx": 0.03, "rz": 0.03, "twist": 0.0 }, { "position": [0.6827, 1.4658, 0.0], "rx": 0.032, "rz": 0.032, "twist": 0.0 }, { "position": [0.69, 1.5, 0.0], "rx": 0.034, "rz": 0.034, "twist": 0.0 }, { "position": [0.6925, 1.5405, 0.0], "rx": 0.0355, "rz": 0.0355, "twist": 0.0 }, { "position": [0.6919, 1.5874, 0.0], "rx": 0.037, "rz": 0.037, "twist": 0.0 }, { "position": [0.6887, 1.6387, 0.0], "rx": 0.0385, "rz": 0.0385, "twist": 0.0 }, { "position": [0.6837, 1.6926, 0.0], "rx": 0.04, "rz": 0.04, "twist": 0.0 }, { "position": [0.6773, 1.747, 0.0], "rx": 0.0415, "rz": 0.0415, "twist": 0.0 }, { "position": [0.67, 1.8, 0.0], "rx": 0.043, "rz": 0.043, "twist": 0.0 }, { "position": [0.6618, 1.8538, 0.0], "rx": 0.0433, "rz": 0.0433, "twist": 0.0 }, { "position": [0.6522, 1.9104, 0.0], "rx": 0.0437, "rz": 0.0437, "twist": 0.0 }, { "position": [0.6413, 1.9675, 0.0], "rx": 0.044, "rz": 0.044, "twist": 0.0 }, { "position": [0.6289, 2.023, 0.0], "rx": 0.0443, "rz": 0.0443, "twist": 0.0 }, { "position": [0.6151, 2.0745, 0.0], "rx": 0.0447, "rz": 0.0447, "twist": 0.0 }, { "position": [0.6, 2.12, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.5841, 2.1594, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.5674, 2.1944, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.5494, 2.2256, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.5293, 2.2533, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.5064, 2.278, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.48, 2.3, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.4496, 2.3187, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.4156, 2.3335, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.3787, 2.3453, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.34, 2.3548, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.3001, 2.3628, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.26, 2.37, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.219, 2.376, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.1763, 2.3802, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.1325, 2.3828, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.0881, 2.3843, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.0438, 2.3849, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.0, 2.385, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.0438, 2.3849, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.0881, 2.3843, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.1325, 2.3828, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.1763, 2.3802, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.219, 2.376, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.26, 2.37, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.3001, 2.3628, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.34, 2.3548, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.3788, 2.3453, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.4156, 2.3335, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.4496, 2.3187, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.48, 2.3, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.5064, 2.278, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.5293, 2.2533, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.5494, 2.2256, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.5674, 2.1944, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.5841, 2.1594, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.6, 2.12, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.6151, 2.0745, 0.0], "rx": 0.0447, "rz": 0.0447, "twist": 0.0 }, { "position": [-0.6289, 2.023, 0.0], "rx": 0.0443, "rz": 0.0443, "twist": 0.0 }, { "position": [-0.6412, 1.9675, 0.0], "rx": 0.044, "rz": 0.044, "twist": 0.0 }, { "position": [-0.6522, 1.9104, 0.0], "rx": 0.0437, "rz": 0.0437, "twist": 0.0 }, { "position": [-0.6618, 1.8538, 0.0], "rx": 0.0433, "rz": 0.0433, "twist": 0.0 }, { "position": [-0.67, 1.8, 0.0], "rx": 0.043, "rz": 0.043, "twist": 0.0 }, { "position": [-0.6773, 1.747, 0.0], "rx": 0.0415, "rz": 0.0415, "twist": 0.0 }, { "position": [-0.6837, 1.6926, 0.0], "rx": 0.04, "rz": 0.04, "twist": 0.0 }, { "position": [-0.6887, 1.6388, 0.0], "rx": 0.0385, "rz": 0.0385, "twist": 0.0 }, { "position": [-0.6919, 1.5874, 0.0], "rx": 0.037, "rz": 0.037, "twist": 0.0 }, { "position": [-0.6925, 1.5405, 0.0], "rx": 0.0355, "rz": 0.0355, "twist": 0.0 }, { "position": [-0.69, 1.5, 0.0], "rx": 0.034, "rz": 0.034, "twist": 0.0 }, { "position": [-0.6827, 1.4658, 0.0], "rx": 0.032, "rz": 0.032, "twist": 0.0 }, { "position": [-0.6707, 1.4363, 0.0], "rx": 0.03, "rz": 0.03, "twist": 0.0 }, { "position": [-0.6563, 1.4113, 0.0], "rx": 0.028, "rz": 0.028, "twist": 0.0 }, { "position": [-0.6415, 1.3904, 0.0], "rx": 0.026, "rz": 0.026, "twist": 0.0 }, { "position": [-0.6287, 1.3734, 0.0], "rx": 0.024, "rz": 0.024, "twist": 0.0 }, { "position": [-0.62, 1.36, 0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }], "radialSegments": 14, "capEnds": true });
    if (!endpoint_bail_7) {
        mesh_bail_7Geometry.scale(1.0, 1.0, 1.0);
    }
    const mesh_bail_7 = new THREE.Mesh(mesh_bail_7Geometry, materialMap["wrought-wire"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_bail_7.name = "Swing bail handle";
    if (endpoint_bail_7) {
        mesh_bail_7.position.copy(endpoint_bail_7.midpoint);
        mesh_bail_7.quaternion.copy(endpoint_bail_7.quaternion);
    }
    mesh_bail_7.castShadow = options.castShadow ?? true;
    mesh_bail_7.receiveShadow = options.receiveShadow ?? true;
    mesh_bail_7.userData.sculptComponent = { "id": "bail", "name": "Swing bail handle", "level": "macro", "role": "handle", "importance": 0.8, "confidence": 0.8, "primitive": "tapered-sweep", "topologyClass": "assembled-solid", "topologyRationale": "A single bent wire with thinned ends hooked into two lugs.", "geometryDescriptor": { "topologyIntent": "tapered-sweep built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "taperedSweep": { "stations": [{ "position": [0.62, 1.36, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.6287, 1.3734, 0.0], "rx": 0.024, "rz": 0.024, "twist": 0.0 }, { "position": [0.6415, 1.3904, 0.0], "rx": 0.026, "rz": 0.026, "twist": 0.0 }, { "position": [0.6562, 1.4112, 0.0], "rx": 0.028, "rz": 0.028, "twist": 0.0 }, { "position": [0.6707, 1.4363, 0.0], "rx": 0.03, "rz": 0.03, "twist": 0.0 }, { "position": [0.6827, 1.4658, 0.0], "rx": 0.032, "rz": 0.032, "twist": 0.0 }, { "position": [0.69, 1.5, 0.0], "rx": 0.034, "rz": 0.034, "twist": 0.0 }, { "position": [0.6925, 1.5405, 0.0], "rx": 0.0355, "rz": 0.0355, "twist": 0.0 }, { "position": [0.6919, 1.5874, 0.0], "rx": 0.037, "rz": 0.037, "twist": 0.0 }, { "position": [0.6887, 1.6387, 0.0], "rx": 0.0385, "rz": 0.0385, "twist": 0.0 }, { "position": [0.6837, 1.6926, 0.0], "rx": 0.04, "rz": 0.04, "twist": 0.0 }, { "position": [0.6773, 1.747, 0.0], "rx": 0.0415, "rz": 0.0415, "twist": 0.0 }, { "position": [0.67, 1.8, 0.0], "rx": 0.043, "rz": 0.043, "twist": 0.0 }, { "position": [0.6618, 1.8538, 0.0], "rx": 0.0433, "rz": 0.0433, "twist": 0.0 }, { "position": [0.6522, 1.9104, 0.0], "rx": 0.0437, "rz": 0.0437, "twist": 0.0 }, { "position": [0.6413, 1.9675, 0.0], "rx": 0.044, "rz": 0.044, "twist": 0.0 }, { "position": [0.6289, 2.023, 0.0], "rx": 0.0443, "rz": 0.0443, "twist": 0.0 }, { "position": [0.6151, 2.0745, 0.0], "rx": 0.0447, "rz": 0.0447, "twist": 0.0 }, { "position": [0.6, 2.12, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.5841, 2.1594, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.5674, 2.1944, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.5494, 2.2256, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.5293, 2.2533, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.5064, 2.278, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.48, 2.3, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.4496, 2.3187, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.4156, 2.3335, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.3787, 2.3453, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.34, 2.3548, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.3001, 2.3628, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.26, 2.37, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.219, 2.376, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.1763, 2.3802, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.1325, 2.3828, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.0881, 2.3843, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.0438, 2.3849, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [0.0, 2.385, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.0438, 2.3849, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.0881, 2.3843, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.1325, 2.3828, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.1763, 2.3802, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.219, 2.376, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.26, 2.37, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.3001, 2.3628, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.34, 2.3548, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.3788, 2.3453, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.4156, 2.3335, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.4496, 2.3187, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.48, 2.3, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.5064, 2.278, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.5293, 2.2533, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.5494, 2.2256, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.5674, 2.1944, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.5841, 2.1594, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.6, 2.12, 0.0], "rx": 0.045, "rz": 0.045, "twist": 0.0 }, { "position": [-0.6151, 2.0745, 0.0], "rx": 0.0447, "rz": 0.0447, "twist": 0.0 }, { "position": [-0.6289, 2.023, 0.0], "rx": 0.0443, "rz": 0.0443, "twist": 0.0 }, { "position": [-0.6412, 1.9675, 0.0], "rx": 0.044, "rz": 0.044, "twist": 0.0 }, { "position": [-0.6522, 1.9104, 0.0], "rx": 0.0437, "rz": 0.0437, "twist": 0.0 }, { "position": [-0.6618, 1.8538, 0.0], "rx": 0.0433, "rz": 0.0433, "twist": 0.0 }, { "position": [-0.67, 1.8, 0.0], "rx": 0.043, "rz": 0.043, "twist": 0.0 }, { "position": [-0.6773, 1.747, 0.0], "rx": 0.0415, "rz": 0.0415, "twist": 0.0 }, { "position": [-0.6837, 1.6926, 0.0], "rx": 0.04, "rz": 0.04, "twist": 0.0 }, { "position": [-0.6887, 1.6388, 0.0], "rx": 0.0385, "rz": 0.0385, "twist": 0.0 }, { "position": [-0.6919, 1.5874, 0.0], "rx": 0.037, "rz": 0.037, "twist": 0.0 }, { "position": [-0.6925, 1.5405, 0.0], "rx": 0.0355, "rz": 0.0355, "twist": 0.0 }, { "position": [-0.69, 1.5, 0.0], "rx": 0.034, "rz": 0.034, "twist": 0.0 }, { "position": [-0.6827, 1.4658, 0.0], "rx": 0.032, "rz": 0.032, "twist": 0.0 }, { "position": [-0.6707, 1.4363, 0.0], "rx": 0.03, "rz": 0.03, "twist": 0.0 }, { "position": [-0.6563, 1.4113, 0.0], "rx": 0.028, "rz": 0.028, "twist": 0.0 }, { "position": [-0.6415, 1.3904, 0.0], "rx": 0.026, "rz": 0.026, "twist": 0.0 }, { "position": [-0.6287, 1.3734, 0.0], "rx": 0.024, "rz": 0.024, "twist": 0.0 }, { "position": [-0.62, 1.36, 0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }], "radialSegments": 14, "capEnds": true } }, "parent": "body", "attachment": { "parentId": "body", "parentSocket": "lugs", "localStart": [-0.62, 1.36, 0], "localEnd": [0.62, 1.36, 0], "contactType": "socket", "embedDepth": 0.02, "gapTolerance": 0.01 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "hinge", "pivot": { "mode": "custom", "localPosition": [0, 1.36, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "bail", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "wrought-wire", "materialLayers": ["wrought-wire"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "bail-bend", "kind": "contour", "notes": "shouldered bends near each end, flat top span" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(69, 56, 49, 1.0)", "secondaryAlbedo": "rgba(45, 34, 24, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(45, 34, 24, 1.0)" }, { "pos": 1.0, "color": "rgba(69, 56, 49, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_bail_7.add(mesh_bail_7);
    meshes["bail"] = mesh_bail_7;
    colliders["bail"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["bail"] ?? (destructionGroups["bail"] = []);
    destructionGroups["bail"].push(node_bail_7);
    const endpoint_lug_a_8 = makeAttachmentEndpoint(null);
    const node_lug_a_8 = new THREE.Group();
    node_lug_a_8.name = "Bail lug a__pivot";
    node_lug_a_8.scale.set(1, 1, 1);
    if (endpoint_lug_a_8) {
        node_lug_a_8.position.copy(endpoint_lug_a_8.start);
        node_lug_a_8.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_lug_a_8.position.set(-0.63, 1.34, 0.0);
        node_lug_a_8.rotation.set(0.0, 0.0, 0.0);
    }
    node_lug_a_8.userData.sculptComponent = { "id": "lug-a", "name": "Bail lug a", "level": "micro", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Bail lug a: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "torus built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.25 }, "parent": "body", "attachment": { "parentId": "body", "parentSocket": "shoulder", "localStart": [-0.63, 1.28, 0], "localEnd": [-0.63, 1.4, 0], "contactType": "embed", "embedDepth": 0.02, "gapTolerance": 0.01 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [-0.63, 1.34, 0], "rotation": [0, 0, 0], "scale": [0.13, 0.13, 0.13] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "lug-a", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "wrought-wire", "materialLayers": ["wrought-wire"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "lug-loop-a", "kind": "fastener", "notes": "riveted loop the bail hooks through" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(69, 56, 49, 1.0)", "secondaryAlbedo": "rgba(45, 34, 24, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(45, 34, 24, 1.0)" }, { "pos": 1.0, "color": "rgba(69, 56, 49, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_lug_a_8.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "lug-a", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["body"] ?? root).add(node_lug_a_8);
    nodes["lug-a"] = node_lug_a_8;
    const mesh_lug_a_8Geometry = endpoint_lug_a_8
        ? new THREE.CylinderGeometry(endpoint_lug_a_8.endRadius, endpoint_lug_a_8.baseRadius, endpoint_lug_a_8.length, 16, 6)
        : new THREE.TorusGeometry(0.45, 0.1125, 12, 48);
    if (!endpoint_lug_a_8) {
        mesh_lug_a_8Geometry.scale(0.13, 0.13, 0.13);
    }
    const mesh_lug_a_8 = new THREE.Mesh(mesh_lug_a_8Geometry, materialMap["wrought-wire"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_lug_a_8.name = "Bail lug a";
    if (endpoint_lug_a_8) {
        mesh_lug_a_8.position.copy(endpoint_lug_a_8.midpoint);
        mesh_lug_a_8.quaternion.copy(endpoint_lug_a_8.quaternion);
    }
    mesh_lug_a_8.castShadow = options.castShadow ?? true;
    mesh_lug_a_8.receiveShadow = options.receiveShadow ?? true;
    mesh_lug_a_8.userData.sculptComponent = { "id": "lug-a", "name": "Bail lug a", "level": "micro", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Bail lug a: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "torus built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.25 }, "parent": "body", "attachment": { "parentId": "body", "parentSocket": "shoulder", "localStart": [-0.63, 1.28, 0], "localEnd": [-0.63, 1.4, 0], "contactType": "embed", "embedDepth": 0.02, "gapTolerance": 0.01 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [-0.63, 1.34, 0], "rotation": [0, 0, 0], "scale": [0.13, 0.13, 0.13] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "lug-a", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "wrought-wire", "materialLayers": ["wrought-wire"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "lug-loop-a", "kind": "fastener", "notes": "riveted loop the bail hooks through" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(69, 56, 49, 1.0)", "secondaryAlbedo": "rgba(45, 34, 24, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(45, 34, 24, 1.0)" }, { "pos": 1.0, "color": "rgba(69, 56, 49, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_lug_a_8.add(mesh_lug_a_8);
    meshes["lug-a"] = mesh_lug_a_8;
    colliders["lug-a"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["lug-a"] ?? (destructionGroups["lug-a"] = []);
    destructionGroups["lug-a"].push(node_lug_a_8);
    const endpoint_lug_b_9 = makeAttachmentEndpoint(null);
    const node_lug_b_9 = new THREE.Group();
    node_lug_b_9.name = "Bail lug b__pivot";
    node_lug_b_9.scale.set(1, 1, 1);
    if (endpoint_lug_b_9) {
        node_lug_b_9.position.copy(endpoint_lug_b_9.start);
        node_lug_b_9.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_lug_b_9.position.set(0.63, 1.34, 0.0);
        node_lug_b_9.rotation.set(0.0, 0.0, 0.0);
    }
    node_lug_b_9.userData.sculptComponent = { "id": "lug-b", "name": "Bail lug b", "level": "micro", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Bail lug b: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "torus built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.25 }, "parent": "body", "attachment": { "parentId": "body", "parentSocket": "shoulder", "localStart": [0.63, 1.28, 0], "localEnd": [0.63, 1.4, 0], "contactType": "embed", "embedDepth": 0.02, "gapTolerance": 0.01 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0.63, 1.34, 0], "rotation": [0, 0, 0], "scale": [0.13, 0.13, 0.13] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "lug-b", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "wrought-wire", "materialLayers": ["wrought-wire"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "lug-loop-b", "kind": "fastener", "notes": "riveted loop the bail hooks through" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(69, 56, 49, 1.0)", "secondaryAlbedo": "rgba(45, 34, 24, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(45, 34, 24, 1.0)" }, { "pos": 1.0, "color": "rgba(69, 56, 49, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_lug_b_9.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "lug-b", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["body"] ?? root).add(node_lug_b_9);
    nodes["lug-b"] = node_lug_b_9;
    const mesh_lug_b_9Geometry = endpoint_lug_b_9
        ? new THREE.CylinderGeometry(endpoint_lug_b_9.endRadius, endpoint_lug_b_9.baseRadius, endpoint_lug_b_9.length, 16, 6)
        : new THREE.TorusGeometry(0.45, 0.1125, 12, 48);
    if (!endpoint_lug_b_9) {
        mesh_lug_b_9Geometry.scale(0.13, 0.13, 0.13);
    }
    const mesh_lug_b_9 = new THREE.Mesh(mesh_lug_b_9Geometry, materialMap["wrought-wire"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_lug_b_9.name = "Bail lug b";
    if (endpoint_lug_b_9) {
        mesh_lug_b_9.position.copy(endpoint_lug_b_9.midpoint);
        mesh_lug_b_9.quaternion.copy(endpoint_lug_b_9.quaternion);
    }
    mesh_lug_b_9.castShadow = options.castShadow ?? true;
    mesh_lug_b_9.receiveShadow = options.receiveShadow ?? true;
    mesh_lug_b_9.userData.sculptComponent = { "id": "lug-b", "name": "Bail lug b", "level": "micro", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Bail lug b: assembled-solid chosen from the observed form in the reference.", "geometryDescriptor": { "topologyIntent": "torus built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.25 }, "parent": "body", "attachment": { "parentId": "body", "parentSocket": "shoulder", "localStart": [0.63, 1.28, 0], "localEnd": [0.63, 1.4, 0], "contactType": "embed", "embedDepth": 0.02, "gapTolerance": 0.01 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0.63, 1.34, 0], "rotation": [0, 0, 0], "scale": [0.13, 0.13, 0.13] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "lug-b", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "wrought-wire", "materialLayers": ["wrought-wire"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "lug-loop-b", "kind": "fastener", "notes": "riveted loop the bail hooks through" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(69, 56, 49, 1.0)", "secondaryAlbedo": "rgba(45, 34, 24, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(45, 34, 24, 1.0)" }, { "pos": 1.0, "color": "rgba(69, 56, 49, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_lug_b_9.add(mesh_lug_b_9);
    meshes["lug-b"] = mesh_lug_b_9;
    colliders["lug-b"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["lug-b"] ?? (destructionGroups["lug-b"] = []);
    destructionGroups["lug-b"].push(node_lug_b_9);
    root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups };
    root.userData.lookDevTargets = { "qualityPriority": "reference-fidelity", "materialPass": { "albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": { "requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry" }, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"] }, "lightingPass": { "requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"] }, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."] };
    root.userData.actionReadiness = {
        note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
    };
    return root;
}
export function createCopperTeaKettleLookDevLights(mode = 'neutral') {
    const lights = new THREE.Group();
    lights.name = "Copper Tea Kettle look-dev lights";
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
    lights.userData.lightingFromPhoto = ["Key: warm directional from upper left, about 45 degrees, matching the watercolour highlight on the shoulder.", "Fill: cool hemisphere light, low intensity, to keep the dark copper readable.", "Rim: soft back light to separate the bail and spout from the background.", "Exposure 1.0 with ACES filmic tone mapping; sRGB output.", "Contact shadow: soft ground shadow under the foot ring; ambient occlusion in the dent cavities."];
    lights.userData.lookDevTargets = { "qualityPriority": "reference-fidelity", "materialPass": { "albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": { "requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry" }, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"] }, "lightingPass": { "requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"] }, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."] };
    return lights;
}
// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createCopperTeaKettleEnvironment(renderer) {
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
export function frameCopperTeaKettleCamera(camera, object, options = {}) {
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
export function createCopperTeaKettlePresentationComposer(renderer, scene, camera, options = {}) {
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
export function configureCopperTeaKettleRenderer(renderer) {
    // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
    // the environment reflection reads flat/washed instead of a believable metal response.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
}
export function createCopperTeaKettleInspectControls(camera, domElement) {
    // View-dependent finishes only read correctly once the user orbits — their color
    // comes from the environment reflection, not albedo, so free rotation matters here.
    const controls = new OrbitControls(camera, domElement);
    controls.enableDamping = true;
    controls.minDistance = 1.0;
    controls.maxDistance = 8.0;
    controls.autoRotate = false;
    return controls;
}
