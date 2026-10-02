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
// Generated from ObjectSculptSpec target: Pierced Tin Lantern
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createPiercedTinLanternModel(options = {}) {
    const root = new THREE.Group();
    root.name = "Pierced Tin Lantern";
    root.userData.reconstructionEvidence = { "itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": { "solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": { "yaw": 0.0, "pitch": 0.0, "roll": 0.0 }, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review." }, "approximationNotes": [] };
    root.userData.materialPipeline = {};
    root.userData.materialReferenceRegistry = null;
    const materialMap = {};
    materialMap["pierced-tin"] = createSculptMaterial("pierced-tin", { "id": "pierced-tin", "name": "Pierced tinplate", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#9A968A", "color": "#9A968A", "albedo": { "dominant": "#9A968A", "secondary": ["#9A968A", "#9A968A"], "samplingNotes": "sampled from the reference tin" }, "colorVariation": { "palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3 }, "roughness": { "base": 0.52, "variation": 0.05, "map": "none: flat finish", "localResponse": "uniform" }, "metalness": { "base": 0.85, "variation": 0.0 }, "ambientOcclusion": { "cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features." }, "wear": { "edgeWear": 0.0, "scratches": [], "chips": [] }, "dirt": { "amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22" }, "localOverrides": [{ "id": "rim-gloss", "kind": "gloss", "mask": "rolled rims", "roughness": 0.25 }], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Grey tinplate; the piercings are built as star geometry.", "textureless": { "declared": true, "evidence": ["The drawn tin shows only lighting gradients and rolled-rim highlights; no grain or print at the reference scale.", "A crop of the flange tiled into plank-like bands that the reference does not have (material-pass review)."] }, "envMapIntensity": 1.8 }, options);
    materialMap["plain-tin"] = createSculptMaterial("plain-tin", { "id": "plain-tin", "name": "Plain tinplate", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#A09C90", "color": "#A09C90", "albedo": { "dominant": "#A09C90", "secondary": ["#A09C90", "#A09C90"], "samplingNotes": "sampled from the reference tin" }, "colorVariation": { "palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3 }, "roughness": { "base": 0.48, "variation": 0.05, "map": "none: flat finish", "localResponse": "uniform" }, "metalness": { "base": 0.85, "variation": 0.0 }, "ambientOcclusion": { "cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features." }, "wear": { "edgeWear": 0.0, "scratches": [], "chips": [] }, "dirt": { "amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22" }, "localOverrides": [{ "id": "tin-dulling", "kind": "stain", "mask": "lower foot", "color": "#6A665A" }], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Spun tinplate, smooth grey.", "textureless": { "declared": true, "evidence": ["The drawn tin shows only lighting gradients and rolled-rim highlights; no grain or print at the reference scale.", "A crop of the flange tiled into plank-like bands that the reference does not have (material-pass review)."] }, "envMapIntensity": 1.8 }, options);
    materialMap["globe-glass"] = createSculptMaterial("globe-glass", { "id": "globe-glass", "name": "Clear globe glass", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#F2EEE4", "color": "#F2EEE4", "albedo": { "dominant": "#F2EEE4", "secondary": ["#F2EEE4", "#F2EEE4"], "samplingNotes": "clear glass tinted by the paper behind it" }, "colorVariation": { "palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3 }, "roughness": { "base": 0.06, "variation": 0.02, "map": "none: clear glass", "localResponse": "uniform" }, "metalness": { "base": 0.0, "variation": 0.0 }, "ambientOcclusion": { "cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features." }, "wear": { "edgeWear": 0.0, "scratches": [], "chips": [] }, "dirt": { "amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22" }, "localOverrides": [{ "id": "globe-reflection", "kind": "gloss", "mask": "vertical highlight on the globe", "roughness": 0.03 }], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Clear blown glass; the paper shows through.", "textureless": { "declared": true, "evidence": ["The reference globe shows the background paper through it with no grain, print or bubbles.", "Only a vertical highlight band and edge darkening are visible; both are lighting, not texture."] }, "transmission": { "base": 0.92 }, "ior": { "base": 1.5 }, "thickness": { "base": 0.02 }, "doubleSided": true }, options);
    materialMap["iron-wire"] = createSculptMaterial("iron-wire", { "id": "iron-wire", "name": "Dark iron wire", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#3A3632", "color": "#3A3632", "albedo": { "dominant": "#362B24", "secondary": ["#746559", "#23150A", "#514439"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": { "path": "models/lantern/maps/iron-wire_albedo.jpg", "url": "models/lantern/maps/iron-wire_albedo.jpg", "channel": "albedo", "source": "reference-pixel-extraction" } }, "colorVariation": { "palette": ["#362B24", "#746559", "#23150A", "#514439", "#C5B59A"], "pattern": "reference-derived pixel palette", "amplitude": 0.212, "heightCorrelation": 0.42 }, "textureResolution": 1024, "textureProjection": { "mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale." }, "surfaceFrequencyBands": [{ "id": "macro", "frequency": 2.0, "amplitude": 0.456, "role": "reference-derived broad albedo and height breakup" }, { "id": "meso", "frequency": 14.0, "amplitude": 0.192, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters" }, { "id": "micro", "frequency": 72.0, "amplitude": 0.079, "role": "reference-derived micro highlight breakup under grazing light" }], "roughness": { "base": 0.688, "variation": 0.05, "map": { "path": "models/lantern/maps/iron-wire_roughness.jpg", "url": "models/lantern/maps/iron-wire_roughness.jpg", "channel": "roughness", "source": "reference-pixel-extraction" }, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother" }, "metalness": { "base": 0.8, "variation": 0.05 }, "normal": { "pattern": "reference-derived height-gradient normal map", "strength": 0.168, "map": { "path": "models/lantern/maps/iron-wire_normal.jpg", "url": "models/lantern/maps/iron-wire_normal.jpg", "channel": "normal", "source": "reference-pixel-extraction" }, "heightSource": { "path": "models/lantern/maps/iron-wire_height.jpg", "url": "models/lantern/maps/iron-wire_height.jpg", "channel": "height", "source": "reference-pixel-extraction" }, "space": "tangent" }, "bump": { "pattern": "reference-derived height field", "amplitude": 0.01, "map": { "path": "models/lantern/maps/iron-wire_height.jpg", "url": "models/lantern/maps/iron-wire_height.jpg", "channel": "height", "source": "reference-pixel-extraction" } }, "displacement": { "pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false }, "ambientOcclusion": { "cavityStrength": 0.38, "contactShadowBias": 0.35, "map": { "path": "models/lantern/maps/iron-wire_ao.jpg", "url": "models/lantern/maps/iron-wire_ao.jpg", "channel": "ao", "source": "reference-pixel-extraction" }, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot." }, "wear": { "edgeWear": 0.0, "scratches": [], "chips": [] }, "dirt": { "amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22" }, "localOverrides": [{ "id": "wire-grime", "kind": "dirt", "mask": "joints", "color": "#24211E" }, { "id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison." }], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "Dark wire with a dull sheen.", "referencePbr": { "version": "1.0", "sourceImage": "wire.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.752, "estimatedFidelity": 0.752, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": { "albedo": { "path": "models/lantern/maps/iron-wire_albedo.jpg", "url": "models/lantern/maps/iron-wire_albedo.jpg", "channel": "albedo", "source": "reference-pixel-extraction" }, "roughness": { "path": "models/lantern/maps/iron-wire_roughness.jpg", "url": "models/lantern/maps/iron-wire_roughness.jpg", "channel": "roughness", "source": "reference-pixel-extraction" }, "height": { "path": "models/lantern/maps/iron-wire_height.jpg", "url": "models/lantern/maps/iron-wire_height.jpg", "channel": "height", "source": "reference-pixel-extraction" }, "normal": { "path": "models/lantern/maps/iron-wire_normal.jpg", "url": "models/lantern/maps/iron-wire_normal.jpg", "channel": "normal", "source": "reference-pixel-extraction" }, "ao": { "path": "models/lantern/maps/iron-wire_ao.jpg", "url": "models/lantern/maps/iron-wire_ao.jpg", "channel": "ao", "source": "reference-pixel-extraction" } }, "diagnostics": { "sourceWidth": 64, "sourceHeight": 70, "mapSize": 1024, "cropBBoxPixels": { "x": 0, "y": 0, "width": 64, "height": 70 }, "mask": { "backgroundColor": "#332B28", "backgroundNoise": 71.624, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.9991 }, "mapStats": { "valueRange": 0.5038, "heightP90Gradient": 0.00999, "roughnessBase": 0.688, "roughnessVariation": 0.05, "normalStrength": 0.168, "blurRadius": 21 }, "palette": ["#362B24", "#746559", "#23150A", "#514439", "#C5B59A"] }, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"] } }, options);
    materialMap["grip-wood"] = createSculptMaterial("grip-wood", { "id": "grip-wood", "name": "Turned grey grip", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#77705F", "color": "#77705F", "albedo": { "dominant": "#806F58", "secondary": ["#887760", "#72614C", "#907F68"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": { "path": "models/lantern/maps/grip-wood_albedo.jpg", "url": "models/lantern/maps/grip-wood_albedo.jpg", "channel": "albedo", "source": "reference-pixel-extraction" } }, "colorVariation": { "palette": ["#806F58", "#887760", "#72614C", "#907F68", "#5D4D37"], "pattern": "reference-derived pixel palette", "amplitude": 0.08, "heightCorrelation": 0.42 }, "textureResolution": 1024, "textureProjection": { "mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale." }, "surfaceFrequencyBands": [{ "id": "macro", "frequency": 2.0, "amplitude": 0.342, "role": "reference-derived broad albedo and height breakup" }, { "id": "meso", "frequency": 14.0, "amplitude": 0.348, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters" }, { "id": "micro", "frequency": 72.0, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light" }], "roughness": { "base": 0.713, "variation": 0.083, "map": { "path": "models/lantern/maps/grip-wood_roughness.jpg", "url": "models/lantern/maps/grip-wood_roughness.jpg", "channel": "roughness", "source": "reference-pixel-extraction" }, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother" }, "metalness": { "base": 0.0, "variation": 0.0 }, "normal": { "pattern": "reference-derived height-gradient normal map", "strength": 0.212, "map": { "path": "models/lantern/maps/grip-wood_normal.jpg", "url": "models/lantern/maps/grip-wood_normal.jpg", "channel": "normal", "source": "reference-pixel-extraction" }, "heightSource": { "path": "models/lantern/maps/grip-wood_height.jpg", "url": "models/lantern/maps/grip-wood_height.jpg", "channel": "height", "source": "reference-pixel-extraction" }, "space": "tangent" }, "bump": { "pattern": "reference-derived height field", "amplitude": 0.021, "map": { "path": "models/lantern/maps/grip-wood_height.jpg", "url": "models/lantern/maps/grip-wood_height.jpg", "channel": "height", "source": "reference-pixel-extraction" } }, "displacement": { "pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false }, "ambientOcclusion": { "cavityStrength": 0.38, "contactShadowBias": 0.35, "map": { "path": "models/lantern/maps/grip-wood_ao.jpg", "url": "models/lantern/maps/grip-wood_ao.jpg", "channel": "ao", "source": "reference-pixel-extraction" }, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot." }, "wear": { "edgeWear": 0.0, "scratches": [], "chips": [] }, "dirt": { "amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22" }, "localOverrides": [{ "id": "grip-handling", "kind": "stain", "mask": "middle of the grip", "color": "#5E5848" }, { "id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison." }], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "Turned wooden grip, weathered grey.", "referencePbr": { "version": "1.0", "sourceImage": "wood.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.754, "estimatedFidelity": 0.754, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": { "albedo": { "path": "models/lantern/maps/grip-wood_albedo.jpg", "url": "models/lantern/maps/grip-wood_albedo.jpg", "channel": "albedo", "source": "reference-pixel-extraction" }, "roughness": { "path": "models/lantern/maps/grip-wood_roughness.jpg", "url": "models/lantern/maps/grip-wood_roughness.jpg", "channel": "roughness", "source": "reference-pixel-extraction" }, "height": { "path": "models/lantern/maps/grip-wood_height.jpg", "url": "models/lantern/maps/grip-wood_height.jpg", "channel": "height", "source": "reference-pixel-extraction" }, "normal": { "path": "models/lantern/maps/grip-wood_normal.jpg", "url": "models/lantern/maps/grip-wood_normal.jpg", "channel": "normal", "source": "reference-pixel-extraction" }, "ao": { "path": "models/lantern/maps/grip-wood_ao.jpg", "url": "models/lantern/maps/grip-wood_ao.jpg", "channel": "ao", "source": "reference-pixel-extraction" } }, "diagnostics": { "sourceWidth": 34, "sourceHeight": 26, "mapSize": 1024, "cropBBoxPixels": { "x": 0, "y": 0, "width": 34, "height": 26 }, "mask": { "backgroundColor": "#766451", "backgroundNoise": 23.452, "transparentPixelFraction": 0.0, "foregroundCoverage": 1.0 }, "mapStats": { "valueRange": 0.1776, "heightP90Gradient": 0.04726, "roughnessBase": 0.713, "roughnessVariation": 0.083, "normalStrength": 0.212, "blurRadius": 21 }, "palette": ["#806F58", "#887760", "#72614C", "#907F68", "#5D4D37"] }, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"] } }, options);
    const nodes = { root };
    const meshes = {};
    const sockets = {};
    const colliders = {};
    const destructionGroups = {};
    const endpoint_fount_0 = makeAttachmentEndpoint(null);
    const node_fount_0 = new THREE.Group();
    node_fount_0.name = "Pierced drum fount__pivot";
    node_fount_0.scale.set(1, 1, 1);
    if (endpoint_fount_0) {
        node_fount_0.position.copy(endpoint_fount_0.start);
        node_fount_0.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_fount_0.position.set(0.0, 0.0, 0.0);
        node_fount_0.rotation.set(0.0, 0.0, 0.0);
    }
    node_fount_0.userData.sculptComponent = { "id": "fount", "name": "Pierced drum fount", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Pierced tinplate drum, revolved.", "geometryDescriptor": { "topologyIntent": "lathe built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": { "points": [[0.5, 0.2], [0.52, 0.22], [0.52, 0.9], [0.56, 0.93], [0.56, 0.97], [0.5, 0.98], [0.0, 0.99]], "segments": 72 } }, "parent": null, "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "root", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "fount", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "pierced-tin", "materialLayers": ["pierced-tin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "star-piercings", "kind": "hole", "notes": "two rows of five-point stars pierced through the drum" }], "surfaceDetail": { "macroRoughness": 0.45, "microRoughness": 0.25, "bumpAmplitude": 0.004, "normalPattern": "spun-tin rings", "displacementPattern": "", "occlusionPattern": "dark inside the star piercings", "edgeWearPattern": "bright rolled rims", "notes": "surface-pass" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(140, 136, 124, 1.0)", "secondaryAlbedo": "rgba(94, 90, 80, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(94, 90, 80, 1.0)" }, { "pos": 1.0, "color": "rgba(140, 136, 124, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_fount_0.userData.actionProfile = { "animationRole": "root", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "fount", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["root"] ?? root).add(node_fount_0);
    nodes["fount"] = node_fount_0;
    const mesh_fount_0Geometry = endpoint_fount_0
        ? new THREE.CylinderGeometry(endpoint_fount_0.endRadius, endpoint_fount_0.baseRadius, endpoint_fount_0.length, 16, 6)
        : buildLatheGeometry({ "points": [[0.5, 0.2], [0.52, 0.22], [0.52, 0.9], [0.56, 0.93], [0.56, 0.97], [0.5, 0.98], [0.0, 0.99]], "segments": 72 });
    if (!endpoint_fount_0) {
        mesh_fount_0Geometry.scale(1.0, 1.0, 1.0);
    }
    const mesh_fount_0 = new THREE.Mesh(mesh_fount_0Geometry, materialMap["pierced-tin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_fount_0.name = "Pierced drum fount";
    if (endpoint_fount_0) {
        mesh_fount_0.position.copy(endpoint_fount_0.midpoint);
        mesh_fount_0.quaternion.copy(endpoint_fount_0.quaternion);
    }
    mesh_fount_0.castShadow = options.castShadow ?? true;
    mesh_fount_0.receiveShadow = options.receiveShadow ?? true;
    mesh_fount_0.userData.sculptComponent = { "id": "fount", "name": "Pierced drum fount", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Pierced tinplate drum, revolved.", "geometryDescriptor": { "topologyIntent": "lathe built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": { "points": [[0.5, 0.2], [0.52, 0.22], [0.52, 0.9], [0.56, 0.93], [0.56, 0.97], [0.5, 0.98], [0.0, 0.99]], "segments": 72 } }, "parent": null, "attachment": null, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "root", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "fount", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "pierced-tin", "materialLayers": ["pierced-tin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "star-piercings", "kind": "hole", "notes": "two rows of five-point stars pierced through the drum" }], "surfaceDetail": { "macroRoughness": 0.45, "microRoughness": 0.25, "bumpAmplitude": 0.004, "normalPattern": "spun-tin rings", "displacementPattern": "", "occlusionPattern": "dark inside the star piercings", "edgeWearPattern": "bright rolled rims", "notes": "surface-pass" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(140, 136, 124, 1.0)", "secondaryAlbedo": "rgba(94, 90, 80, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(94, 90, 80, 1.0)" }, { "pos": 1.0, "color": "rgba(140, 136, 124, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_fount_0.add(mesh_fount_0);
    meshes["fount"] = mesh_fount_0;
    colliders["fount"] = { "type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["fount"] ?? (destructionGroups["fount"] = []);
    destructionGroups["fount"].push(node_fount_0);
    const endpoint_foot_1 = makeAttachmentEndpoint(null);
    const node_foot_1 = new THREE.Group();
    node_foot_1.name = "Flanged foot__pivot";
    node_foot_1.scale.set(1, 1, 1);
    if (endpoint_foot_1) {
        node_foot_1.position.copy(endpoint_foot_1.start);
        node_foot_1.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_foot_1.position.set(0.0, 0.0, 0.0);
        node_foot_1.rotation.set(0.0, 0.0, 0.0);
    }
    node_foot_1.userData.sculptComponent = { "id": "foot", "name": "Flanged foot", "level": "meso", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Flanged foot: turned or spun tinplate, revolved about the lantern axis.", "geometryDescriptor": { "topologyIntent": "lathe built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": { "points": [[0.0, 0.0], [0.75, 0.0], [0.77, 0.03], [0.72, 0.09], [0.6, 0.17], [0.51, 0.21], [0.5, 0.22]], "segments": 64 } }, "parent": "fount", "attachment": { "parentId": "fount", "parentSocket": "fount-axis", "localStart": [0, 0, 0], "localEnd": [0, 0.22, 0], "contactType": "overlap", "embedDepth": 0.01, "gapTolerance": 0.01 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "foot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "plain-tin", "materialLayers": ["plain-tin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "foot-roll", "kind": "bevel", "notes": "rolled flange edge" }], "surfaceDetail": { "macroRoughness": 0.45, "microRoughness": 0.25, "bumpAmplitude": 0.004, "normalPattern": "spun-tin rings", "displacementPattern": "", "occlusionPattern": "dark inside the star piercings", "edgeWearPattern": "bright rolled rims", "notes": "surface-pass" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(140, 136, 124, 1.0)", "secondaryAlbedo": "rgba(94, 90, 80, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(94, 90, 80, 1.0)" }, { "pos": 1.0, "color": "rgba(140, 136, 124, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_foot_1.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "foot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["fount"] ?? root).add(node_foot_1);
    nodes["foot"] = node_foot_1;
    const mesh_foot_1Geometry = endpoint_foot_1
        ? new THREE.CylinderGeometry(endpoint_foot_1.endRadius, endpoint_foot_1.baseRadius, endpoint_foot_1.length, 16, 6)
        : buildLatheGeometry({ "points": [[0.0, 0.0], [0.75, 0.0], [0.77, 0.03], [0.72, 0.09], [0.6, 0.17], [0.51, 0.21], [0.5, 0.22]], "segments": 64 });
    if (!endpoint_foot_1) {
        mesh_foot_1Geometry.scale(1.0, 1.0, 1.0);
    }
    const mesh_foot_1 = new THREE.Mesh(mesh_foot_1Geometry, materialMap["plain-tin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_foot_1.name = "Flanged foot";
    if (endpoint_foot_1) {
        mesh_foot_1.position.copy(endpoint_foot_1.midpoint);
        mesh_foot_1.quaternion.copy(endpoint_foot_1.quaternion);
    }
    mesh_foot_1.castShadow = options.castShadow ?? true;
    mesh_foot_1.receiveShadow = options.receiveShadow ?? true;
    mesh_foot_1.userData.sculptComponent = { "id": "foot", "name": "Flanged foot", "level": "meso", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Flanged foot: turned or spun tinplate, revolved about the lantern axis.", "geometryDescriptor": { "topologyIntent": "lathe built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": { "points": [[0.0, 0.0], [0.75, 0.0], [0.77, 0.03], [0.72, 0.09], [0.6, 0.17], [0.51, 0.21], [0.5, 0.22]], "segments": 64 } }, "parent": "fount", "attachment": { "parentId": "fount", "parentSocket": "fount-axis", "localStart": [0, 0, 0], "localEnd": [0, 0.22, 0], "contactType": "overlap", "embedDepth": 0.01, "gapTolerance": 0.01 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "foot", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "plain-tin", "materialLayers": ["plain-tin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "foot-roll", "kind": "bevel", "notes": "rolled flange edge" }], "surfaceDetail": { "macroRoughness": 0.45, "microRoughness": 0.25, "bumpAmplitude": 0.004, "normalPattern": "spun-tin rings", "displacementPattern": "", "occlusionPattern": "dark inside the star piercings", "edgeWearPattern": "bright rolled rims", "notes": "surface-pass" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(140, 136, 124, 1.0)", "secondaryAlbedo": "rgba(94, 90, 80, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(94, 90, 80, 1.0)" }, { "pos": 1.0, "color": "rgba(140, 136, 124, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_foot_1.add(mesh_foot_1);
    meshes["foot"] = mesh_foot_1;
    colliders["foot"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["foot"] ?? (destructionGroups["foot"] = []);
    destructionGroups["foot"].push(node_foot_1);
    const endpoint_globe_2 = makeAttachmentEndpoint(null);
    const node_globe_2 = new THREE.Group();
    node_globe_2.name = "Glass globe__pivot";
    node_globe_2.scale.set(1, 1, 1);
    if (endpoint_globe_2) {
        node_globe_2.position.copy(endpoint_globe_2.start);
        node_globe_2.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_globe_2.position.set(0.0, 0.0, 0.0);
        node_globe_2.rotation.set(0.0, 0.0, 0.0);
    }
    node_globe_2.userData.sculptComponent = { "id": "globe", "name": "Glass globe", "level": "macro", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Glass globe: turned or spun tinplate, revolved about the lantern axis.", "geometryDescriptor": { "topologyIntent": "lathe built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": { "points": [[0.47, 0.97], [0.53, 1.12], [0.6, 1.38], [0.62, 1.68], [0.58, 2.02], [0.48, 2.3], [0.38, 2.48], [0.33, 2.55]], "segments": 64 } }, "parent": "fount", "attachment": { "parentId": "fount", "parentSocket": "fount-axis", "localStart": [0, 0.97, 0], "localEnd": [0, 2.55, 0], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.01 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "globe", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "globe-glass", "materialLayers": ["globe-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "globe-highlight", "kind": "gloss", "notes": "long vertical highlight on the globe" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(216, 210, 194, 1.0)", "secondaryAlbedo": "rgba(184, 178, 162, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(184, 178, 162, 1.0)" }, { "pos": 1.0, "color": "rgba(216, 210, 194, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_globe_2.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "globe", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["fount"] ?? root).add(node_globe_2);
    nodes["globe"] = node_globe_2;
    const mesh_globe_2Geometry = endpoint_globe_2
        ? new THREE.CylinderGeometry(endpoint_globe_2.endRadius, endpoint_globe_2.baseRadius, endpoint_globe_2.length, 16, 6)
        : buildLatheGeometry({ "points": [[0.47, 0.97], [0.53, 1.12], [0.6, 1.38], [0.62, 1.68], [0.58, 2.02], [0.48, 2.3], [0.38, 2.48], [0.33, 2.55]], "segments": 64 });
    if (!endpoint_globe_2) {
        mesh_globe_2Geometry.scale(1.0, 1.0, 1.0);
    }
    const mesh_globe_2 = new THREE.Mesh(mesh_globe_2Geometry, materialMap["globe-glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_globe_2.name = "Glass globe";
    if (endpoint_globe_2) {
        mesh_globe_2.position.copy(endpoint_globe_2.midpoint);
        mesh_globe_2.quaternion.copy(endpoint_globe_2.quaternion);
    }
    mesh_globe_2.castShadow = options.castShadow ?? true;
    mesh_globe_2.receiveShadow = options.receiveShadow ?? true;
    mesh_globe_2.userData.sculptComponent = { "id": "globe", "name": "Glass globe", "level": "macro", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Glass globe: turned or spun tinplate, revolved about the lantern axis.", "geometryDescriptor": { "topologyIntent": "lathe built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": { "points": [[0.47, 0.97], [0.53, 1.12], [0.6, 1.38], [0.62, 1.68], [0.58, 2.02], [0.48, 2.3], [0.38, 2.48], [0.33, 2.55]], "segments": 64 } }, "parent": "fount", "attachment": { "parentId": "fount", "parentSocket": "fount-axis", "localStart": [0, 0.97, 0], "localEnd": [0, 2.55, 0], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.01 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "globe", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "globe-glass", "materialLayers": ["globe-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "globe-highlight", "kind": "gloss", "notes": "long vertical highlight on the globe" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(216, 210, 194, 1.0)", "secondaryAlbedo": "rgba(184, 178, 162, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(184, 178, 162, 1.0)" }, { "pos": 1.0, "color": "rgba(216, 210, 194, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_globe_2.add(mesh_globe_2);
    meshes["globe"] = mesh_globe_2;
    colliders["globe"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["globe"] ?? (destructionGroups["globe"] = []);
    destructionGroups["globe"].push(node_globe_2);
    const endpoint_cap_3 = makeAttachmentEndpoint(null);
    const node_cap_3 = new THREE.Group();
    node_cap_3.name = "Pierced cap and vent__pivot";
    node_cap_3.scale.set(1, 1, 1);
    if (endpoint_cap_3) {
        node_cap_3.position.copy(endpoint_cap_3.start);
        node_cap_3.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_cap_3.position.set(0.0, 0.0, 0.0);
        node_cap_3.rotation.set(0.0, 0.0, 0.0);
    }
    node_cap_3.userData.sculptComponent = { "id": "cap", "name": "Pierced cap and vent", "level": "meso", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Pierced cap and vent: turned or spun tinplate, revolved about the lantern axis.", "geometryDescriptor": { "topologyIntent": "lathe built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": { "points": [[0.31, 2.5], [0.36, 2.53], [0.36, 2.78], [0.4, 2.8], [0.4, 2.84], [0.25, 2.9], [0.13, 2.93], [0.11, 3.04], [0.14, 3.06], [0.14, 3.09], [0.0, 3.1]], "segments": 56 } }, "parent": "fount", "attachment": { "parentId": "fount", "parentSocket": "fount-axis", "localStart": [0, 2.5, 0], "localEnd": [0, 3.1, 0], "contactType": "overlap", "embedDepth": 0.01, "gapTolerance": 0.01 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "cap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "pierced-tin", "materialLayers": ["pierced-tin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "cap-stars", "kind": "hole", "notes": "one row of stars round the cap" }], "surfaceDetail": { "macroRoughness": 0.45, "microRoughness": 0.25, "bumpAmplitude": 0.004, "normalPattern": "spun-tin rings", "displacementPattern": "", "occlusionPattern": "dark inside the star piercings", "edgeWearPattern": "bright rolled rims", "notes": "surface-pass" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(140, 136, 124, 1.0)", "secondaryAlbedo": "rgba(94, 90, 80, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(94, 90, 80, 1.0)" }, { "pos": 1.0, "color": "rgba(140, 136, 124, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_cap_3.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "cap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["fount"] ?? root).add(node_cap_3);
    nodes["cap"] = node_cap_3;
    const mesh_cap_3Geometry = endpoint_cap_3
        ? new THREE.CylinderGeometry(endpoint_cap_3.endRadius, endpoint_cap_3.baseRadius, endpoint_cap_3.length, 16, 6)
        : buildLatheGeometry({ "points": [[0.31, 2.5], [0.36, 2.53], [0.36, 2.78], [0.4, 2.8], [0.4, 2.84], [0.25, 2.9], [0.13, 2.93], [0.11, 3.04], [0.14, 3.06], [0.14, 3.09], [0.0, 3.1]], "segments": 56 });
    if (!endpoint_cap_3) {
        mesh_cap_3Geometry.scale(1.0, 1.0, 1.0);
    }
    const mesh_cap_3 = new THREE.Mesh(mesh_cap_3Geometry, materialMap["pierced-tin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_cap_3.name = "Pierced cap and vent";
    if (endpoint_cap_3) {
        mesh_cap_3.position.copy(endpoint_cap_3.midpoint);
        mesh_cap_3.quaternion.copy(endpoint_cap_3.quaternion);
    }
    mesh_cap_3.castShadow = options.castShadow ?? true;
    mesh_cap_3.receiveShadow = options.receiveShadow ?? true;
    mesh_cap_3.userData.sculptComponent = { "id": "cap", "name": "Pierced cap and vent", "level": "meso", "role": "part", "importance": 0.8, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Pierced cap and vent: turned or spun tinplate, revolved about the lantern axis.", "geometryDescriptor": { "topologyIntent": "lathe built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": { "points": [[0.31, 2.5], [0.36, 2.53], [0.36, 2.78], [0.4, 2.8], [0.4, 2.84], [0.25, 2.9], [0.13, 2.93], [0.11, 3.04], [0.14, 3.06], [0.14, 3.09], [0.0, 3.1]], "segments": 56 } }, "parent": "fount", "attachment": { "parentId": "fount", "parentSocket": "fount-axis", "localStart": [0, 2.5, 0], "localEnd": [0, 3.1, 0], "contactType": "overlap", "embedDepth": 0.01, "gapTolerance": 0.01 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "cap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "pierced-tin", "materialLayers": ["pierced-tin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "cap-stars", "kind": "hole", "notes": "one row of stars round the cap" }], "surfaceDetail": { "macroRoughness": 0.45, "microRoughness": 0.25, "bumpAmplitude": 0.004, "normalPattern": "spun-tin rings", "displacementPattern": "", "occlusionPattern": "dark inside the star piercings", "edgeWearPattern": "bright rolled rims", "notes": "surface-pass" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(140, 136, 124, 1.0)", "secondaryAlbedo": "rgba(94, 90, 80, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(94, 90, 80, 1.0)" }, { "pos": 1.0, "color": "rgba(140, 136, 124, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_cap_3.add(mesh_cap_3);
    meshes["cap"] = mesh_cap_3;
    colliders["cap"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["cap"] ?? (destructionGroups["cap"] = []);
    destructionGroups["cap"].push(node_cap_3);
    const endpoint_bail_4 = makeAttachmentEndpoint(null);
    const node_bail_4 = new THREE.Group();
    node_bail_4.name = "Wire bail__pivot";
    node_bail_4.scale.set(1, 1, 1);
    if (endpoint_bail_4) {
        node_bail_4.position.copy(endpoint_bail_4.start);
        node_bail_4.rotation.set(0.0, 0.0, 0.0);
    }
    else {
        node_bail_4.position.set(0.0, 0.0, 0.0);
        node_bail_4.rotation.set(0.0, 0.0, 0.0);
    }
    node_bail_4.userData.sculptComponent = { "id": "bail", "name": "Wire bail", "level": "meso", "role": "handle", "importance": 0.8, "confidence": 0.8, "primitive": "tapered-sweep", "topologyClass": "assembled-solid", "topologyRationale": "Bent bail wire, swept round section.", "geometryDescriptor": { "topologyIntent": "tapered-sweep built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "taperedSweep": { "stations": [{ "position": [-0.38, 2.62, 0.0], "rx": 0.012, "rz": 0.012, "twist": 0.0 }, { "position": [-0.3882, 2.6436, 0.0], "rx": 0.0137, "rz": 0.0137, "twist": 0.0 }, { "position": [-0.4, 2.6752, 0.0], "rx": 0.0153, "rz": 0.0153, "twist": 0.0 }, { "position": [-0.4138, 2.7131, 0.0], "rx": 0.017, "rz": 0.017, "twist": 0.0 }, { "position": [-0.4278, 2.7559, 0.0], "rx": 0.0187, "rz": 0.0187, "twist": 0.0 }, { "position": [-0.4404, 2.8021, 0.0], "rx": 0.0203, "rz": 0.0203, "twist": 0.0 }, { "position": [-0.45, 2.85, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.457, 2.9014, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.463, 2.9578, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4675, 3.0175, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4704, 3.0789, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4713, 3.1403, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.47, 3.2, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4665, 3.2595, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4611, 3.3204, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4537, 3.3813, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4444, 3.4407, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4332, 3.4975, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.42, 3.55, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4038, 3.5994, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.3844, 3.647, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.3631, 3.6919, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.3411, 3.733, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.3197, 3.7693, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.3, 3.8, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.2833, 3.8239, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.2689, 3.8415, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.255, 3.8544, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.24, 3.8641, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.2222, 3.8721, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.2, 3.88, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.1725, 3.8873, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.1407, 3.8926, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.1063, 3.8963, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.0704, 3.8985, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.0345, 3.8997, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.0, 3.9, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.0345, 3.8997, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.0704, 3.8985, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.1063, 3.8962, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.1407, 3.8926, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.1725, 3.8873, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.2, 3.88, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.2222, 3.8721, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.24, 3.8641, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.255, 3.8544, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.2689, 3.8415, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.2833, 3.8239, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.3, 3.8, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.3197, 3.7693, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.3411, 3.733, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.3631, 3.6919, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.3844, 3.647, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4038, 3.5994, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.42, 3.55, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4332, 3.4975, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4444, 3.4407, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4537, 3.3812, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4611, 3.3204, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4665, 3.2595, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.47, 3.2, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4713, 3.1403, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4704, 3.0789, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4675, 3.0175, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.463, 2.9578, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.457, 2.9014, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.45, 2.85, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4404, 2.8021, 0.0], "rx": 0.0203, "rz": 0.0203, "twist": 0.0 }, { "position": [0.4278, 2.7559, 0.0], "rx": 0.0187, "rz": 0.0187, "twist": 0.0 }, { "position": [0.4138, 2.7131, 0.0], "rx": 0.017, "rz": 0.017, "twist": 0.0 }, { "position": [0.4, 2.6752, 0.0], "rx": 0.0153, "rz": 0.0153, "twist": 0.0 }, { "position": [0.3882, 2.6436, 0.0], "rx": 0.0137, "rz": 0.0137, "twist": 0.0 }, { "position": [0.38, 2.62, 0], "rx": 0.012, "rz": 0.012, "twist": 0.0 }], "radialSegments": 8, "capEnds": true } }, "parent": "fount", "attachment": { "parentId": "fount", "parentSocket": "fount-axis", "localStart": [-0.38, 2.62, 0], "localEnd": [0.38, 2.62, 0], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.01 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "hinge", "pivot": { "mode": "custom", "localPosition": [0, 2.62, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "bail", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "iron-wire", "materialLayers": ["iron-wire"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "bail-arc", "kind": "contour", "notes": "tall arc above the cap" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(58, 54, 50, 1.0)", "secondaryAlbedo": "rgba(36, 33, 30, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(36, 33, 30, 1.0)" }, { "pos": 1.0, "color": "rgba(58, 54, 50, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_bail_4.userData.actionProfile = { "animationRole": "hinge", "pivot": { "mode": "custom", "localPosition": [0, 2.62, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "bail", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } };
    (nodes["fount"] ?? root).add(node_bail_4);
    nodes["bail"] = node_bail_4;
    const mesh_bail_4Geometry = endpoint_bail_4
        ? new THREE.CylinderGeometry(endpoint_bail_4.endRadius, endpoint_bail_4.baseRadius, endpoint_bail_4.length, 16, 6)
        : buildTaperedSweepGeometry({ "stations": [{ "position": [-0.38, 2.62, 0.0], "rx": 0.012, "rz": 0.012, "twist": 0.0 }, { "position": [-0.3882, 2.6436, 0.0], "rx": 0.0137, "rz": 0.0137, "twist": 0.0 }, { "position": [-0.4, 2.6752, 0.0], "rx": 0.0153, "rz": 0.0153, "twist": 0.0 }, { "position": [-0.4138, 2.7131, 0.0], "rx": 0.017, "rz": 0.017, "twist": 0.0 }, { "position": [-0.4278, 2.7559, 0.0], "rx": 0.0187, "rz": 0.0187, "twist": 0.0 }, { "position": [-0.4404, 2.8021, 0.0], "rx": 0.0203, "rz": 0.0203, "twist": 0.0 }, { "position": [-0.45, 2.85, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.457, 2.9014, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.463, 2.9578, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4675, 3.0175, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4704, 3.0789, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4713, 3.1403, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.47, 3.2, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4665, 3.2595, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4611, 3.3204, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4537, 3.3813, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4444, 3.4407, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4332, 3.4975, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.42, 3.55, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4038, 3.5994, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.3844, 3.647, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.3631, 3.6919, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.3411, 3.733, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.3197, 3.7693, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.3, 3.8, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.2833, 3.8239, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.2689, 3.8415, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.255, 3.8544, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.24, 3.8641, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.2222, 3.8721, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.2, 3.88, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.1725, 3.8873, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.1407, 3.8926, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.1063, 3.8963, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.0704, 3.8985, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.0345, 3.8997, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.0, 3.9, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.0345, 3.8997, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.0704, 3.8985, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.1063, 3.8962, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.1407, 3.8926, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.1725, 3.8873, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.2, 3.88, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.2222, 3.8721, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.24, 3.8641, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.255, 3.8544, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.2689, 3.8415, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.2833, 3.8239, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.3, 3.8, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.3197, 3.7693, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.3411, 3.733, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.3631, 3.6919, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.3844, 3.647, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4038, 3.5994, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.42, 3.55, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4332, 3.4975, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4444, 3.4407, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4537, 3.3812, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4611, 3.3204, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4665, 3.2595, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.47, 3.2, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4713, 3.1403, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4704, 3.0789, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4675, 3.0175, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.463, 2.9578, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.457, 2.9014, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.45, 2.85, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4404, 2.8021, 0.0], "rx": 0.0203, "rz": 0.0203, "twist": 0.0 }, { "position": [0.4278, 2.7559, 0.0], "rx": 0.0187, "rz": 0.0187, "twist": 0.0 }, { "position": [0.4138, 2.7131, 0.0], "rx": 0.017, "rz": 0.017, "twist": 0.0 }, { "position": [0.4, 2.6752, 0.0], "rx": 0.0153, "rz": 0.0153, "twist": 0.0 }, { "position": [0.3882, 2.6436, 0.0], "rx": 0.0137, "rz": 0.0137, "twist": 0.0 }, { "position": [0.38, 2.62, 0], "rx": 0.012, "rz": 0.012, "twist": 0.0 }], "radialSegments": 8, "capEnds": true });
    if (!endpoint_bail_4) {
        mesh_bail_4Geometry.scale(1.0, 1.0, 1.0);
    }
    const mesh_bail_4 = new THREE.Mesh(mesh_bail_4Geometry, materialMap["iron-wire"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
    mesh_bail_4.name = "Wire bail";
    if (endpoint_bail_4) {
        mesh_bail_4.position.copy(endpoint_bail_4.midpoint);
        mesh_bail_4.quaternion.copy(endpoint_bail_4.quaternion);
    }
    mesh_bail_4.castShadow = options.castShadow ?? true;
    mesh_bail_4.receiveShadow = options.receiveShadow ?? true;
    mesh_bail_4.userData.sculptComponent = { "id": "bail", "name": "Wire bail", "level": "meso", "role": "handle", "importance": 0.8, "confidence": 0.8, "primitive": "tapered-sweep", "topologyClass": "assembled-solid", "topologyRationale": "Bent bail wire, swept round section.", "geometryDescriptor": { "topologyIntent": "tapered-sweep built from measured reference proportions", "edgeTreatment": { "type": "none", "bevelRadius": 0.0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "taperedSweep": { "stations": [{ "position": [-0.38, 2.62, 0.0], "rx": 0.012, "rz": 0.012, "twist": 0.0 }, { "position": [-0.3882, 2.6436, 0.0], "rx": 0.0137, "rz": 0.0137, "twist": 0.0 }, { "position": [-0.4, 2.6752, 0.0], "rx": 0.0153, "rz": 0.0153, "twist": 0.0 }, { "position": [-0.4138, 2.7131, 0.0], "rx": 0.017, "rz": 0.017, "twist": 0.0 }, { "position": [-0.4278, 2.7559, 0.0], "rx": 0.0187, "rz": 0.0187, "twist": 0.0 }, { "position": [-0.4404, 2.8021, 0.0], "rx": 0.0203, "rz": 0.0203, "twist": 0.0 }, { "position": [-0.45, 2.85, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.457, 2.9014, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.463, 2.9578, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4675, 3.0175, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4704, 3.0789, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4713, 3.1403, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.47, 3.2, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4665, 3.2595, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4611, 3.3204, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4537, 3.3813, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4444, 3.4407, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4332, 3.4975, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.42, 3.55, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.4038, 3.5994, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.3844, 3.647, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.3631, 3.6919, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.3411, 3.733, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.3197, 3.7693, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.3, 3.8, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.2833, 3.8239, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.2689, 3.8415, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.255, 3.8544, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.24, 3.8641, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.2222, 3.8721, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.2, 3.88, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.1725, 3.8873, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.1407, 3.8926, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.1063, 3.8963, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.0704, 3.8985, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [-0.0345, 3.8997, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.0, 3.9, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.0345, 3.8997, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.0704, 3.8985, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.1063, 3.8962, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.1407, 3.8926, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.1725, 3.8873, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.2, 3.88, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.2222, 3.8721, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.24, 3.8641, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.255, 3.8544, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.2689, 3.8415, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.2833, 3.8239, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.3, 3.8, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.3197, 3.7693, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.3411, 3.733, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.3631, 3.6919, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.3844, 3.647, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4038, 3.5994, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.42, 3.55, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4332, 3.4975, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4444, 3.4407, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4537, 3.3812, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4611, 3.3204, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4665, 3.2595, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.47, 3.2, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4713, 3.1403, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4704, 3.0789, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4675, 3.0175, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.463, 2.9578, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.457, 2.9014, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.45, 2.85, 0.0], "rx": 0.022, "rz": 0.022, "twist": 0.0 }, { "position": [0.4404, 2.8021, 0.0], "rx": 0.0203, "rz": 0.0203, "twist": 0.0 }, { "position": [0.4278, 2.7559, 0.0], "rx": 0.0187, "rz": 0.0187, "twist": 0.0 }, { "position": [0.4138, 2.7131, 0.0], "rx": 0.017, "rz": 0.017, "twist": 0.0 }, { "position": [0.4, 2.6752, 0.0], "rx": 0.0153, "rz": 0.0153, "twist": 0.0 }, { "position": [0.3882, 2.6436, 0.0], "rx": 0.0137, "rz": 0.0137, "twist": 0.0 }, { "position": [0.38, 2.62, 0], "rx": 0.012, "rz": 0.012, "twist": 0.0 }], "radialSegments": 8, "capEnds": true } }, "parent": "fount", "attachment": { "parentId": "fount", "parentSocket": "fount-axis", "localStart": [-0.38, 2.62, 0], "localEnd": [0.38, 2.62, 0], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.01 }, "dimensions": { "width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.5 }, "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "hinge", "pivot": { "mode": "custom", "localPosition": [0, 2.62, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "bail", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base" } }, "material": "iron-wire", "materialLayers": ["iron-wire"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "bail-arc", "kind": "contour", "notes": "tall arc above the cap" }], "surfaceDetail": { "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": { "dominantAlbedo": "rgba(58, 54, 50, 1.0)", "secondaryAlbedo": "rgba(36, 33, 30, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "colorGradient": { "type": "linear", "stops": [{ "pos": 0.0, "color": "rgba(36, 33, 30, 1.0)" }, { "pos": 1.0, "color": "rgba(58, 54, 50, 1.0)" }] }, "evidence": "palette sampled from the reference crop by extract_pbr_evidence.py" } };
    node_bail_4.add(mesh_bail_4);
    meshes["bail"] = mesh_bail_4;
    colliders["bail"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
    destructionGroups["bail"] ?? (destructionGroups["bail"] = []);
    destructionGroups["bail"].push(node_bail_4);
    // repetition system "pierced-stars" describes 34 parts that are already built individually; not instanced.
    root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups };
    root.userData.lookDevTargets = { "qualityPriority": "reference-fidelity", "materialPass": { "albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": { "requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry" }, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"] }, "lightingPass": { "requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"] }, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."] };
    root.userData.actionReadiness = {
        note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
    };
    return root;
}
export function createPiercedTinLanternLookDevLights(mode = 'neutral') {
    const lights = new THREE.Group();
    lights.name = "Pierced Tin Lantern look-dev lights";
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
    lights.userData.lightingFromPhoto = ["Key: soft daylight from upper left like the drawing.", "Fill: hemisphere fill so the dark wire stays readable against the paper.", "Rim: back light to show the globe edge and transmission.", "Exposure 1.0 with ACES filmic tone mapping; sRGB output.", "Contact shadow: soft ground shadow under the foot; ambient occlusion inside the piercings."];
    lights.userData.lookDevTargets = { "qualityPriority": "reference-fidelity", "materialPass": { "albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": { "requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry" }, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"] }, "lightingPass": { "requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"] }, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."] };
    return lights;
}
// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createPiercedTinLanternEnvironment(renderer) {
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
export function framePiercedTinLanternCamera(camera, object, options = {}) {
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
export function createPiercedTinLanternPresentationComposer(renderer, scene, camera, options = {}) {
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
export function configurePiercedTinLanternRenderer(renderer) {
    // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
    // the environment reflection reads flat/washed instead of a believable metal response.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
}
export function createPiercedTinLanternInspectControls(camera, domElement) {
    // View-dependent finishes only read correctly once the user orbits — their color
    // comes from the environment reflection, not albedo, so free rotation matters here.
    const controls = new OrbitControls(camera, domElement);
    controls.enableDamping = true;
    controls.minDistance = 1.0;
    controls.maxDistance = 8.0;
    controls.autoRotate = false;
    return controls;
}
