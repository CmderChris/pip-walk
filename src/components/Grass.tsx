import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { isLowEnd } from './perfTier';
import { modelWorldPos, modelSitAmountRef, modelForwardRef } from './modelState';

const PLAYER_RADIUS = 0.35;

// Seven concentric rings, each roughly 2× sparser than the one inside it.
// Boundaries are circular (distance-based) so no square corners read as diagonal lines.
// The outermost ring (r < 700) extends well past fog far=500 so its edge never shows.
// Near rings are intentionally much denser than far rings so the foreground
// looks lush while the horizon thins out naturally without a hard boundary.
const RINGS = [
  { r:  50, planes: 4, clusters: isLowEnd ? 3_800 : 13_000, perC: 14, cR: 0.5 },
  { r:  90, planes: 4, clusters: isLowEnd ? 2_800 : 9_000,  perC: 12, cR: 0.7 },
  { r: 140, planes: 3, clusters: isLowEnd ? 1_100 : 3_400,  perC:  6, cR: 1.0 },
  { r: 200, planes: 3, clusters: isLowEnd ?   650 : 2_000,  perC:  5, cR: 1.4 },
  { r: 300, planes: 2, clusters: isLowEnd ?   500 : 1_500,  perC:  4, cR: 4.0 },
  { r: 450, planes: 2, clusters: isLowEnd ?   350 :   900,  perC:  3, cR: 7.0 },
  { r: 700, planes: 2, clusters: isLowEnd ?   200 :   550,  perC:  3, cR: 12.0 },
];

// ─── Grass blade alpha texture ────────────────────────────────────────────────
// Each blade: pointed at the base, widens to a peak around 45% up, tapers to a tip.
function makeGrassAlphaTexture(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = 'white';

  // [center_x (0-1), lean (-1..1), half_width (0-1)]
  const blades: Array<[number, number, number]> = [
    [0.10, -0.06, 0.038],
    [0.28,  0.05, 0.044],
    [0.48, -0.03, 0.046],
    [0.68,  0.06, 0.044],
    [0.88, -0.05, 0.036],
  ];

  for (const [cx, lean, hw] of blades) {
    const bx     = cx * size;
    const bw     = hw * size;
    const leanPx = lean * size;
    const tip    = bx + leanPx;          // x at the very top
    const midX   = bx + leanPx * 0.45;  // x at the widest point
    const midY   = size * 0.55;          // y of widest point (55% down from top — longer taper to tip)

    ctx.beginPath();
    ctx.moveTo(bx, size);  // bottom — a thin point

    // Left edge: barely widen near base, swell to max width at midY, taper to tip
    ctx.bezierCurveTo(
      bx - bw * 0.10, size * 0.82,  // just starting to widen near the base
      midX - bw,      midY,          // left edge at widest
      tip,            0              // top tip
    );

    // Right edge: from top tip back down to bottom point
    ctx.bezierCurveTo(
      midX + bw,      midY,          // right edge at widest
      bx + bw * 0.10, size * 0.82,  // narrowing back near the base
      bx,             size           // back to bottom tip
    );

    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// ─── Noise texture (colour variation only — NOT used for wind) ────────────────
function makeNoiseTexture(size = 256): THREE.DataTexture {
  function hash(x: number, y: number) {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  }
  function smooth(t: number) { return t * t * (3 - 2 * t); }
  function vnoise(x: number, y: number) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = smooth(x - ix), fy = smooth(y - iy);
    return (
      hash(ix,     iy)     * (1 - fx) * (1 - fy) +
      hash(ix + 1, iy)     *      fx  * (1 - fy) +
      hash(ix,     iy + 1) * (1 - fx) *      fy  +
      hash(ix + 1, iy + 1) *      fx  *      fy
    );
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x / size) * 4, ny = (y / size) * 4;
      let v = vnoise(nx, ny) * 0.5 + vnoise(nx * 2.1, ny * 2.1) * 0.25 + vnoise(nx * 4.3, ny * 4.3) * 0.125;
      v = Math.min(v / 0.875, 1);
      const b = Math.floor(v * 255), i = (y * size + x) * 4;
      data[i] = b; data[i+1] = b; data[i+2] = b; data[i+3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  // ClampToEdge: no wrapping seams for the colour variation map
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

// ─── Tuft geometry ────────────────────────────────────────────────────────────
function createTuftGeometry(numPlanes: number, width = 0.7, height = 1.0): THREE.BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let p = 0; p < numPlanes; p++) {
    const angle = (p / numPlanes) * Math.PI;
    const ca = Math.cos(angle), sa = Math.sin(angle), hw = width * 0.5;
    const base = positions.length / 3;
    positions.push(-hw*ca, 0, -hw*sa); uvs.push(0, 0);
    positions.push( hw*ca, 0,  hw*sa); uvs.push(1, 0);
    positions.push(-hw*ca, height, -hw*sa); uvs.push(0, 1);
    positions.push( hw*ca, height,  hw*sa); uvs.push(1, 1);
    indices.push(base, base+1, base+2, base+1, base+3, base+2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs,       2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ─── Clustered placement (circular ring bounds) ───────────────────────────────
const _dummy = new THREE.Object3D();

function fillRing(
  node: THREE.InstancedMesh,
  totalCount: number,
  outerR: number,
  innerR: number,
  perCluster: number,
  clusterRadius: number,
) {
  const numClusters = Math.ceil(totalCount / perCluster);
  const annulusArea = Math.PI * (outerR * outerR - innerR * innerR);
  const outerSq     = outerR * 2;
  const gridStep    = Math.sqrt(outerSq * outerSq / (numClusters * 3));
  const cols        = Math.ceil(outerSq / gridStep);
  const rows        = Math.ceil(outerSq / gridStep);
  const sx          = outerSq / cols, sz = outerSq / rows;
  void annulusArea;

  // Collect ALL valid positions first, then randomly sample — ensures uniform
  // coverage across the full ring, not just one half of it.
  const candidates: Array<[number, number]> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = -outerR + (c + 0.1 + Math.random() * 0.8) * sx;
      const cz = -outerR + (r + 0.1 + Math.random() * 0.8) * sz;
      const d2 = cx * cx + cz * cz;
      // Both inner AND outer bounds are circular — no square corners
      if (d2 < innerR * innerR) continue;
      if (d2 > outerR * outerR) continue;
      candidates.push([cx, cz]);
    }
  }
  // Fisher–Yates shuffle then slice — avoids row-order bias
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = candidates[i]; candidates[i] = candidates[j]; candidates[j] = tmp;
  }
  const centres = candidates.slice(0, numClusters);

  let idx = 0;
  for (const [cx, cz] of centres) {
    for (let t = 0; t < perCluster && idx < totalCount; t++) {
      const angle = Math.random() * Math.PI * 2;
      const dist  = Math.sqrt(Math.random()) * clusterRadius;
      const sy    = 0.18 + Math.random() * 0.16;
      const scale = 0.7  + Math.random() * 0.4;
      _dummy.position.set(cx + Math.cos(angle) * dist, 0, cz + Math.sin(angle) * dist);
      _dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
      _dummy.scale.set(scale, sy, scale);
      _dummy.updateMatrix();
      node.setMatrixAt(idx++, _dummy.matrix);
    }
  }
  node.instanceMatrix.needsUpdate = true;
}

// ─── Shaders ──────────────────────────────────────────────────────────────────
// Wind uses PROCEDURAL GLSL noise — zero tiling seams regardless of field size.
// The noise texture is only used in the fragment shader for slow colour variation
// and is sampled with ClampToEdge so its edges never tile.

const vertexShader = /* glsl */`
  uniform float uTime;
  uniform float uWindAmp;
  uniform vec3  uPlayerPos;
  uniform float uPlayerRadius;
  uniform float uSitAmount;
  uniform vec2  uPlayerForward;

  varying vec2  vUv;
  varying vec2  vWorldXZ;

  // Procedural value noise — no texture, no tiling, no seams
  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1,0)), f.x),
               mix(hash21(i + vec2(0,1)), hash21(i + vec2(1,1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    return vnoise(p) * 0.5 + vnoise(p * 2.1) * 0.25 + vnoise(p * 4.3) * 0.125;
  }

  void main() {
    vec4 modelPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorldXZ = modelPos.xz;
    float originalY = modelPos.y; // pre-wind blade height — used for sit rotation

    // Pre-calculate player distance — needed for both wind suppression and push
    vec2  diff = modelPos.xz - uPlayerPos.xz;
    float dist = length(diff);

    // Wind: rolling sin wave + procedural turbulence (no texture seams)
    // When sitting, suppress wind in an orientation-aware ellipse that extends
    // further behind the model to cover the tail.
    vec2  windDir    = normalize(vec2(1.0, 0.5));
    float turbulence = fbm(modelPos.xz * 0.05 - uTime * 0.12 * windDir);

    float wsAlong  = dot(diff, uPlayerForward);
    float wsAcross = dot(diff, vec2(-uPlayerForward.y, uPlayerForward.x));
    float wsLen    = wsAlong < 0.0
                       ? mix(uPlayerRadius * 2.0, 1.2, uSitAmount)   // behind — covers tail
                       : mix(uPlayerRadius * 2.0, 0.7, uSitAmount);  // in front — covers paws
    float wsSide   = mix(uPlayerRadius * 2.0, 0.8, uSitAmount);
    float wsEll    = sqrt(pow(wsAcross / wsSide, 2.0) + pow(wsAlong / wsLen, 2.0));
    // Flat suppression across most of the ellipse interior, quick fade only at the edge
    float windSuppress = mix(1.0, smoothstep(0.8, 1.0, wsEll), uSitAmount);

    float sway       = sin(0.35 * dot(windDir, modelPos.xz) + turbulence * 5.0 + uTime)
                       * uWindAmp * uv.y * windSuppress;

    modelPos.x += sway * windDir.x;
    modelPos.z += sway * windDir.y;
    // Subtle vertical lift from turbulence — tips nod up and down
    modelPos.y += (turbulence - 0.5) * 0.08 * uv.y * windSuppress;

    // ── Walking push: gentle circular lean ──────────────────────────────────
    float walkFactor = smoothstep(uPlayerRadius, 0.0, dist) * (1.0 - uSitAmount);
    modelPos.xz     += normalize(diff + vec2(0.001)) * walkFactor * 0.26 * uv.y;

    // ── Sitting push: length-preserving rotation — no stretching ───────────────
    // Each vertex moves outward by its own pre-wind height and loses that same
    // height, so the blade rotates from upright to flat without changing length.
    float sitAlong  = dot(diff, uPlayerForward);
    float sitAcross = dot(diff, vec2(-uPlayerForward.y, uPlayerForward.x));
    float sitLen    = sitAlong < 0.0 ? 1.1 : 0.65;
    float sitSide   = 0.7;
    float sitEll    = sqrt(pow(sitAcross / sitSide, 2.0) + pow(sitAlong / sitLen, 2.0));
    float sitFactor = smoothstep(1.0, 0.0, sitEll) * uSitAmount;
    modelPos.xz    += normalize(diff + vec2(0.001)) * sitFactor * originalY;
    modelPos.y     -= sitFactor * originalY;

    vUv         = uv;
    gl_Position = projectionMatrix * viewMatrix * modelPos;
  }
`;

const fragmentShader = /* glsl */`
  uniform sampler2D uGrassAlpha;
  uniform sampler2D uNoiseTexture;
  uniform vec3      uBaseColor;
  uniform vec3      uTipColor1;
  uniform vec3      uTipColor2;
  uniform vec3      fogColor;
  uniform float     fogNear;
  uniform float     fogFar;
  uniform vec3      uPlayerPos;
  uniform float     uSitAmount;
  uniform vec2      uShadowDir;  // normalized XZ direction light→model (shadow falls this way)

  varying vec2  vUv;
  varying vec2  vWorldXZ;

  void main() {
    float alpha = texture2D(uGrassAlpha, vUv).r;
    if (alpha < 0.08) discard;

    // Colour variation sampled at low frequency (~200-unit patches).
    vec2 colorUV = vWorldXZ / 400.0 + 0.5;
    vec3 tipColor = mix(uTipColor1, uTipColor2,
                        texture2D(uNoiseTexture, colorUV).r);
    vec3 col = mix(uBaseColor, tipColor, vUv.y);

    // Fake directional shadow — asymmetric ellipse aligned with sun angle.
    // Long axis stretches in the shadow direction, short on the sun-facing side.
    vec2  shadowPerp = vec2(-uShadowDir.y, uShadowDir.x);
    vec2  offset     = vWorldXZ - uPlayerPos.xz;
    float along      = dot(offset, uShadowDir);
    float perp       = dot(offset, shadowPerp);

    // Asymmetric half-lengths: long shadow tail, short sun-side stub
    float halfLen    = along >= 0.0 ? mix(1.5, 2.2, uSitAmount)  // shadow side
                                    : mix(0.45, 0.65, uSitAmount); // sun side
    float halfWid    = mix(0.5, 0.75, uSitAmount);

    float ellDist    = sqrt(pow(perp / halfWid, 2.0) + pow(along / halfLen, 2.0));
    float shadow     = (1.0 - smoothstep(0.5, 1.0, ellDist)) * 0.36;
    col             *= 1.0 - shadow;

    float depth     = gl_FragCoord.z / gl_FragCoord.w;
    float fogFactor = clamp((fogFar - depth) / (fogFar - fogNear), 0.0, 1.0);
    col = mix(fogColor, col, fogFactor);

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ─── Component ────────────────────────────────────────────────────────────────

// Shadow light is fixed at world (0, 35, -60) — its XZ is (0, -60).
// Shadow direction = normalize(modelXZ - lightXZ), updated only when model moves.
const _lightXZ    = new THREE.Vector2(0, -60);
const _shadowDir  = new THREE.Vector2();
const _prevModelXZ = new THREE.Vector2(9999, 9999);
const MOVE_EPS = 0.0001;

const Grass = () => {
  const timeRef = useRef(0);

  const { geometries, material } = useMemo(() => {
    const alphaTexture = makeGrassAlphaTexture(512);
    const noiseTexture = makeNoiseTexture(256);
    const geometries   = RINGS.map(r => createTuftGeometry(r.planes));

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime:         { value: 0 },
        uWindAmp:      { value: 0.08 },
        uGrassAlpha:   { value: alphaTexture },
        uNoiseTexture: { value: noiseTexture },
        // original ground-match green: #2e4414
        uBaseColor:    { value: new THREE.Color('#28240f') },
        uTipColor1:    { value: new THREE.Color('#8ec97a') },
        uTipColor2:    { value: new THREE.Color('#4a7a32') },
        uPlayerPos:    { value: new THREE.Vector3(9999, 0, 9999) },
        uPlayerRadius: { value: PLAYER_RADIUS },
        uSitAmount:    { value: 0 },
        uShadowDir:    { value: new THREE.Vector2(0, 1) },
        uPlayerForward: { value: new THREE.Vector2(0, 1) },
        fogColor:      { value: new THREE.Color('#c8d8b0') },
        fogNear:       { value: 80 },
        fogFar:        { value: 360 },
      },
      side: THREE.DoubleSide,
      transparent: false,
      depthWrite:  true,
    });

    return { geometries, material };
  }, []);

  const sitAmountRef = useRef(0);

  useFrame((_, delta) => {
    timeRef.current += delta;
    const mat = material as THREE.ShaderMaterial;
    mat.uniforms.uTime.value = timeRef.current;
    // Only update position-dependent uniforms when the model has actually moved
    const movedX = Math.abs(modelWorldPos.x - _prevModelXZ.x);
    const movedZ = Math.abs(modelWorldPos.z - _prevModelXZ.y);
    if (movedX > MOVE_EPS || movedZ > MOVE_EPS) {
      _prevModelXZ.set(modelWorldPos.x, modelWorldPos.z);
      mat.uniforms.uPlayerPos.value.copy(modelWorldPos);
      _shadowDir.set(modelWorldPos.x - _lightXZ.x, modelWorldPos.z - _lightXZ.y).normalize();
      mat.uniforms.uShadowDir.value.copy(_shadowDir);
    }
    mat.uniforms.uPlayerForward.value.copy(modelForwardRef.value);
    // Smooth transition into/out of sitting — snap when close to avoid infinite ticking
    const sitTarget = modelSitAmountRef.value;
    const sitDiff = sitTarget - sitAmountRef.current;
    if (Math.abs(sitDiff) < 0.001) {
      sitAmountRef.current = sitTarget;
    } else {
      sitAmountRef.current += sitDiff * Math.min(1, delta * 4);
    }
    mat.uniforms.uSitAmount.value = sitAmountRef.current;
  });

  return (
    <>
      {RINGS.map((ring, i) => {
        const prevR = i === 0 ? 0 : RINGS[i - 1].r;
        const total = ring.clusters * ring.perC;
        return (
          <instancedMesh
            key={i}
            ref={(node) => {
              if (!node) return;
              fillRing(node, total, ring.r, prevR, ring.perC, ring.cR);
            }}
            args={[geometries[i], material, total]}
            frustumCulled={false}
          />
        );
      })}
    </>
  );
};

export default Grass;
