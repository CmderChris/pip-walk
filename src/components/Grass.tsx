import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { isLowEnd } from './perfTier';
import { modelWorldPos, modelSitAmountRef, modelForwardRef, modelPawPositions, modelGroundedRef } from './modelState';
import { SUN_POSITION, FOG_FAR } from './modelConfig';

const PLAYER_RADIUS = 0.35;

// Just past the fog's far distance, so nothing renders where it can't be seen.
const FIELD_RADIUS = FOG_FAR + 20;

// Six distance bands with falling density, each split into `wedges` angular tiles.
// Every tile is its own InstancedMesh, so three.js can frustum-cull the ones out
// of view; a single full-ring mesh always straddles the view and is never culled.
const BANDS = [
  { r:  50, planes: 3, clusters: isLowEnd ?  4_500 : 16_000, perC: 14, cR: 0.5,  w: 0.52, hs: 1.0, wedges:  6, near: true  },
  { r:  90, planes: 3, clusters: isLowEnd ?  2_800 :  9_000, perC: 12, cR: 0.7,  w: 0.52, hs: 1.0, wedges:  8, near: true  },
  { r: 140, planes: 3, clusters: isLowEnd ?  3_000 : 10_000, perC:  8, cR: 1.0,  w: 0.52, hs: 1.0, wedges:  8, near: false },
  { r: 200, planes: 2, clusters: isLowEnd ?  6_000 : 22_000, perC:  6, cR: 1.4,  w: 0.6,  hs: 1.0, wedges: 10, near: false },
  { r: 300, planes: 2, clusters: isLowEnd ?  6_000 : 20_000, perC:  4, cR: 3.0,  w: 0.8,  hs: 1.2, wedges: 12, near: false },
  { r: FIELD_RADIUS, planes: 2, clusters: isLowEnd ? 2_400 : 7_700, perC: 3, cR: 6.0, w: 1.2, hs: 1.8, wedges: 12, near: false },
];

// ─── Grass blade alpha texture ────────────────────────────────────────────────
// Blade alpha: thin point at the base, widest about a third up, tapering to a tip.
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
    const midY   = size * 0.68;          // y of widest point, from the top

    ctx.beginPath();
    ctx.moveTo(bx, size);  // bottom — a thin point

    // Left edge up to the tip, then right edge back down
    ctx.bezierCurveTo(bx - bw * 0.10, size * 0.82, midX - bw, midY, tip, 0);
    ctx.bezierCurveTo(midX + bw, midY, bx + bw * 0.10, size * 0.82, bx, size);

    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// ─── Noise texture (colour variation only; wind uses GLSL noise) ──────────────
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
  // ClampToEdge avoids seams; LinearFilter because DataTexture defaults to Nearest.
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ─── Tuft geometry ────────────────────────────────────────────────────────────
function createTuftGeometry(numPlanes: number, width = 0.52, height = 1.0): THREE.BufferGeometry {
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

// ─── Clustered placement (annulus candidates, split into angular wedges) ──────
const _dummy = new THREE.Object3D();

// Jittered grid of cluster-centre candidates across a circular annulus.
function generateAnnulusCandidates(outerR: number, innerR: number, targetClusters: number): [number, number][] {
  const outerSq  = outerR * 2;
  const gridStep = Math.sqrt(outerSq * outerSq / (targetClusters * 3));
  const cols     = Math.ceil(outerSq / gridStep);
  const rows     = Math.ceil(outerSq / gridStep);
  const sx       = outerSq / cols, sz = outerSq / rows;

  const candidates: [number, number][] = [];
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
  return candidates;
}

// Splits candidates into angular wedges and shuffles each, so a per-wedge
// budget isn't biased by scan order.
function splitIntoWedges(candidates: [number, number][], wedgeCount: number): [number, number][][] {
  const wedges: [number, number][][] = Array.from({ length: wedgeCount }, () => []);
  for (const [cx, cz] of candidates) {
    const angle = Math.atan2(cz, cx) + Math.PI; // 0..2π
    const idx   = Math.min(wedgeCount - 1, Math.floor((angle / (Math.PI * 2)) * wedgeCount));
    wedges[idx].push([cx, cz]);
  }
  for (const group of wedges) {
    for (let i = group.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = group[i]; group[i] = group[j]; group[j] = tmp;
    }
  }
  return wedges;
}

// Scatters `perCluster` jittered blades around each cluster centre.
function fillWedge(
  node: THREE.InstancedMesh,
  centres: [number, number][],
  perCluster: number,
  clusterRadius: number,
  heightScale: number,
) {
  let idx = 0;
  for (const [cx, cz] of centres) {
    for (let t = 0; t < perCluster; t++) {
      const angle = Math.random() * Math.PI * 2;
      const dist  = Math.sqrt(Math.random()) * clusterRadius;
      const sy    = (0.13 + Math.random() * 0.10) * heightScale;
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
// Wind uses procedural GLSL noise, so it never tiles. The noise texture only
// drives slow colour variation in the fragment shader.

const vertexShader = /* glsl */`
  #include <fog_pars_vertex>

  uniform float uTime;
  uniform float uWindAmp;
  uniform vec3  uPlayerPos;
  uniform float uPlayerRadius;
  uniform float uSitAmount;
  uniform float uGroundedAmount; // 1 = paws on ground, 0 = fully airborne (mid-jump)
  uniform vec2  uPlayerForward;
#ifdef PAW_TRACKING
  uniform vec3  uPawPositions[2];
#endif

  varying vec2  vUv;
  varying vec2  vWorldXZ;

  // Procedural value noise (no texture, no tiling)
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

    // Player distance, used by wind suppression and push
    vec2  diff = modelPos.xz - uPlayerPos.xz;
    float dist = length(diff);

    // Wind suppression ellipse (always computed; the sit/paw zones need it too)
    vec2  windDir  = normalize(vec2(1.0, 0.5));
    float wsAlong  = dot(diff, uPlayerForward);
    float wsAcross = dot(diff, vec2(-uPlayerForward.y, uPlayerForward.x));
    float wsLen    = wsAlong < 0.0
                       ? mix(uPlayerRadius * 2.0, 1.2, uSitAmount)
                       : mix(uPlayerRadius * 2.0, 0.7, uSitAmount);
    float wsSide   = mix(uPlayerRadius * 2.0, 0.6, uSitAmount);
    float wsEll    = length(vec2(wsAcross / wsSide, wsAlong / wsLen));
    float windSuppress = mix(1.0, smoothstep(0.8, 1.0, wsEll), uSitAmount);

#ifdef PAW_TRACKING
    // Per-paw suppression — keeps grass near each leg still (skips when sitting/airborne)
    if (uSitAmount < 0.99) {
      for (int i = 0; i < 2; i++) {
        vec2  pd    = modelPos.xz - uPawPositions[i].xz;
        float pDist = length(pd);
        windSuppress = min(windSuppress, mix(1.0, smoothstep(0.0, 0.28, pDist), uGroundedAmount));
      }
    }
#endif

#ifdef ANIMATED
    // Wind: rolling sin wave + procedural turbulence
    float turbulence = fbm(modelPos.xz * 0.05 - uTime * 0.12 * windDir);
    float sway       = sin(0.35 * dot(windDir, modelPos.xz) + turbulence * 5.0 + uTime)
                       * uWindAmp * uv.y * windSuppress;
    modelPos.x += sway * windDir.x;
    modelPos.z += sway * windDir.y;
    modelPos.y += (turbulence - 0.5) * 0.08 * uv.y * windSuppress;
#endif

    // ── Walking push: gentle circular lean (fades out while airborne) ──────
    float walkFactor = (1.0 - smoothstep(0.0, uPlayerRadius, dist)) * (1.0 - uSitAmount) * uGroundedAmount;
    modelPos.xz     += normalize(diff + vec2(0.001)) * walkFactor * 0.26 * uv.y;

#ifdef PAW_TRACKING
    // ── Per-paw push at each front foot (skipped when sitting or airborne) ──
    if (uSitAmount < 0.99) {
      float pawStrength = 0.14 * (1.0 - uSitAmount) * uGroundedAmount;
      for (int i = 0; i < 2; i++) {
        vec2  pd    = modelPos.xz - uPawPositions[i].xz;
        float pDist = length(pd);
        float pPush = (1.0 - smoothstep(0.0, 0.2, pDist)) * pawStrength;
        modelPos.xz += normalize(pd + vec2(0.001)) * pPush * uv.y;
      }
    }
#endif

    // ── Sitting push: blades rotate flat without stretching ────────────────────
    // Each vertex moves outward by its pre-wind height and drops by the same amount.
    float sitAlong  = dot(diff, uPlayerForward);
    float sitAcross = dot(diff, vec2(-uPlayerForward.y, uPlayerForward.x));
    float sitLen    = sitAlong < 0.0 ? 1.1 : 0.65;
    float sitSide   = 0.55;
    float sitEll    = length(vec2(sitAcross / sitSide, sitAlong / sitLen));
    float sitFactor = (1.0 - smoothstep(0.0, 1.0, sitEll)) * uSitAmount;
    modelPos.xz    += normalize(diff + vec2(0.001)) * sitFactor * originalY;
    modelPos.y      = mix(modelPos.y, 0.0, sitFactor);

    vUv = uv;
    vec4 mvPosition = viewMatrix * modelPos;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */`
  #include <fog_pars_fragment>

  uniform sampler2D uGrassAlpha;
  uniform sampler2D uNoiseTexture;
  uniform vec3      uBaseColor;
  uniform vec3      uTipColor1;
  uniform vec3      uTipColor2;
  uniform vec3      uPlayerPos;
  uniform float     uSitAmount;
  uniform vec2      uShadowDir;  // normalized XZ direction light→model (shadow falls this way)
  uniform vec3      uSunPosition;

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

    // Subtly darken blade bases so they recede into the ground
    col *= mix(0.45, 1.0, smoothstep(0.0, 0.3, vUv.y));

    // Backlit translucency: blades glow when the sun is behind them (as seen from the camera)
    vec3  toCamera = normalize(cameraPosition - vec3(vWorldXZ.x, 0.5, vWorldXZ.y));
    vec3  sunDir   = normalize(uSunPosition); // matches scene directional light
    float backlit  = pow(max(0.0, dot(toCamera, -sunDir)), 2.0);
    col += mix(vec3(0.3, 0.7, 0.1), vec3(0.6, 1.0, 0.3), vUv.y) * (backlit * 0.4 * vUv.y);

    // Fake shadow: ellipse along the sun direction, long on the shadow side, short on the sun side.
    vec2  shadowPerp = vec2(-uShadowDir.y, uShadowDir.x);
    vec2  offset     = vWorldXZ - uPlayerPos.xz;
    float along      = dot(offset, uShadowDir);
    float perp       = dot(offset, shadowPerp);

    float halfLen    = along >= 0.0 ? mix(1.5, 2.2, uSitAmount)  // shadow side
                                    : mix(0.45, 0.65, uSitAmount); // sun side
    float halfWid    = mix(0.5, 0.75, uSitAmount);

    float ellDist    = length(vec2(perp / halfWid, along / halfLen));
    float shadow     = (1.0 - smoothstep(0.5, 1.0, ellDist)) * 0.36;
    col             *= 1.0 - shadow;

    gl_FragColor = vec4(col, 1.0);

    // ShaderMaterial skips these unless included; without them, low-end grass (no
    // composer) is untoned and unencoded. Fog goes last, as in built-in materials.
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

// ─── Component ────────────────────────────────────────────────────────────────

// Shadow direction = normalize(modelXZ - lightXZ), updated only when model moves.
const _lightXZ    = new THREE.Vector2(SUN_POSITION.x, SUN_POSITION.z);
const _shadowDir  = new THREE.Vector2();
const _prevModelXZ = new THREE.Vector2(9999, 9999);
const MOVE_EPS = 0.0001;

type WedgeMesh = {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  count: number;
  centres: [number, number][];
  perCluster: number;
  clusterRadius: number;
  heightScale: number;
};

const Grass = () => {
  const timeRef = useRef(0);

  const { wedgeMeshes, nearMaterial, disposables } = useMemo(() => {
    const alphaTexture = makeGrassAlphaTexture(512);
    const noiseTexture = makeNoiseTexture(256);

    // Both materials share these uniform objects, so updating one updates both.
    const sharedUniforms = {
      uTime:          { value: 0 },
      uWindAmp:       { value: 0.08 },
      uGrassAlpha:    { value: alphaTexture },
      uNoiseTexture:  { value: noiseTexture },
      // original ground-match green: #2e4414
      uBaseColor:     { value: new THREE.Color('#2d3d0e') },
      uTipColor1:     { value: new THREE.Color('#8ec97a') },
      uTipColor2:     { value: new THREE.Color('#4a7a32') },
      uPlayerPos:     { value: new THREE.Vector3(9999, 0, 9999) },
      uPlayerRadius:  { value: PLAYER_RADIUS },
      uSitAmount:     { value: 0 },
      uGroundedAmount:{ value: 1 },
      uShadowDir:     { value: new THREE.Vector2(0, 1) },
      uPlayerForward: { value: new THREE.Vector2(0, 1) },
      uSunPosition:   { value: SUN_POSITION.clone() },
    };

    // fog: true has the renderer fill the fog uniforms from Scene's <fog>. They're
    // written per material, so each material gets its own copy.
    const makeUniforms = (extra: Record<string, THREE.IUniform> = {}) => ({
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...sharedUniforms,
      ...extra,
    });

    const matBase = {
      vertexShader,
      fragmentShader,
      side: THREE.DoubleSide as THREE.Side,
      transparent: false,
      depthWrite:  true,
      fog: true,
    };

    // Near bands (0–1): full paw tracking + animation via PAW_TRACKING/ANIMATED defines
    const nearMaterial = new THREE.ShaderMaterial({
      ...matBase,
      uniforms: makeUniforms({
        uPawPositions: { value: [
          new THREE.Vector3(9999, 0, 9999),
          new THREE.Vector3(9999, 0, 9999),
        ]},
      }),
      defines: { PAW_TRACKING: '', ANIMATED: '' },
    });

    // Far bands: no paw tracking or animation — saves shader cost
    const farMaterial = new THREE.ShaderMaterial({
      ...matBase,
      uniforms: makeUniforms(),
    });

    // One shared geometry per band, one InstancedMesh per wedge.
    const wedgeMeshes: WedgeMesh[] = [];
    let prevR = 0;
    for (const band of BANDS) {
      const geometry = createTuftGeometry(band.planes, band.w);
      const material = band.near ? nearMaterial : farMaterial;
      const candidates = generateAnnulusCandidates(band.r, prevR, band.clusters);
      const wedgeGroups = splitIntoWedges(candidates, band.wedges);
      const perWedgeTarget = Math.ceil(band.clusters / band.wedges);

      for (const group of wedgeGroups) {
        const centres = group.slice(0, perWedgeTarget);
        if (centres.length === 0) continue;
        wedgeMeshes.push({
          geometry,
          material,
          count: centres.length * band.perC,
          centres,
          perCluster: band.perC,
          clusterRadius: band.cR,
          heightScale: band.hs,
        });
      }
      prevR = band.r;
    }

    const disposables = [
      alphaTexture, noiseTexture, nearMaterial, farMaterial,
      ...new Set(wedgeMeshes.map((wm) => wm.geometry)),
    ];

    return { wedgeMeshes, nearMaterial, disposables };
  }, []);

  useEffect(() => () => disposables.forEach((d) => d.dispose()), [disposables]);

  // Scatter once the meshes exist. A layout effect (not an inline ref) keeps
  // re-renders from re-randomising the field.
  const meshRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
  useLayoutEffect(() => {
    wedgeMeshes.forEach((wm, i) => {
      const node = meshRefs.current[i];
      if (node) fillWedge(node, wm.centres, wm.perCluster, wm.clusterRadius, wm.heightScale);
    });
  }, [wedgeMeshes]);

  const sitAmountRef = useRef(0);

  useFrame((_, delta) => {
    timeRef.current += delta;
    // Uniform objects are shared, so updating nearMaterial updates farMaterial too.
    nearMaterial.uniforms.uTime.value = timeRef.current;
    // Only update position-dependent uniforms when the model has actually moved
    const movedX = Math.abs(modelWorldPos.x - _prevModelXZ.x);
    const movedZ = Math.abs(modelWorldPos.z - _prevModelXZ.y);
    if (movedX > MOVE_EPS || movedZ > MOVE_EPS) {
      _prevModelXZ.set(modelWorldPos.x, modelWorldPos.z);
      nearMaterial.uniforms.uPlayerPos.value.copy(modelWorldPos);
      _shadowDir.set(modelWorldPos.x - _lightXZ.x, modelWorldPos.z - _lightXZ.y).normalize();
      nearMaterial.uniforms.uShadowDir.value.copy(_shadowDir);
    }
    nearMaterial.uniforms.uPlayerForward.value.copy(modelForwardRef.value);
    const pawUniforms = nearMaterial.uniforms.uPawPositions.value as THREE.Vector3[];
    for (let i = 0; i < 2; i++) pawUniforms[i].copy(modelPawPositions[i]);
    // Ease into/out of sitting; snap when close so it stops updating
    const sitTarget = modelSitAmountRef.value;
    const sitDiff = sitTarget - sitAmountRef.current;
    if (Math.abs(sitDiff) < 0.001) {
      sitAmountRef.current = sitTarget;
    } else {
      sitAmountRef.current += sitDiff * Math.min(1, delta * 4);
    }
    nearMaterial.uniforms.uSitAmount.value = sitAmountRef.current;
    nearMaterial.uniforms.uGroundedAmount.value = modelGroundedRef.value;
  });

  return (
    <>
      {wedgeMeshes.map((wm, i) => (
        <instancedMesh
          key={i}
          ref={(node) => { meshRefs.current[i] = node; }}
          args={[wm.geometry, wm.material, wm.count]}
        />
      ))}
    </>
  );
};

export default Grass;
