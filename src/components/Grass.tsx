import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { isLowEnd } from './perfTier';
import { modelWorldPos, modelSitAmountRef, modelForwardRef, modelPawPositions, modelGroundedRef, cameraFocus } from './modelState';
import { SUN_POSITION, FOG_FAR } from './modelConfig';
import { curveDropGLSL, curveUniforms } from './worldCurve';

const PLAYER_RADIUS = 0.35;

// Just past the fog's far distance, so nothing renders where it can't be seen.
const FIELD_RADIUS = FOG_FAR + 20;

// Two distance bands around the camera focus: a dense inner disc and a sparser
// ring out to FIELD_RADIUS. `clusters` is the count over the band's own area.
//
// The world scrolls forever, so each band is a periodic grid of TILES_PER_SIDE²
// small InstancedMeshes. Each frame every tile is moved to its periodic image
// nearest the camera focus, and the vertex shader hides blades outside the band's
// distance range. Tiles stay separate meshes so three.js can frustum-cull them.
const BANDS = [
  { r:              50, planes: 3, clusters: isLowEnd ? 4_500 : 16_000, perC: 14, cR: 0.5, w: 0.52, hs: 1.0, near: true },
  { r: FIELD_RADIUS, planes: 3, clusters: isLowEnd ? 3_700 : 12_000, perC: 12, cR: 0.7, w: 0.52, hs: 1.0, near: true },
];

// A tile jumps by one period when its centre passes period/2 from the focus. With
// period = 2r + tileSize its nearest edge is then already r away, so the jump is
// never seen. That fixes tileSize = 2r / (TILES_PER_SIDE - 1).
const TILES_PER_SIDE = 8;

// Blades shrink to nothing over this distance at each band edge, cross-fading
// the bands (and hiding the boundary as it sweeps across the world).
const BAND_FADE = 10;

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
// Tileable: lattice coordinates wrap at `period`, so RepeatWrapping has no seam
// and the colour patches continue however far the world scrolls.
function makeNoiseTexture(size = 256): THREE.DataTexture {
  function hash(x: number, y: number) {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  }
  function smooth(t: number) { return t * t * (3 - 2 * t); }
  function vnoise(x: number, y: number, period: number) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = smooth(x - ix), fy = smooth(y - iy);
    const x0 = ((ix % period) + period) % period, x1 = (x0 + 1) % period;
    const y0 = ((iy % period) + period) % period, y1 = (y0 + 1) % period;
    return (
      hash(x0, y0) * (1 - fx) * (1 - fy) +
      hash(x1, y0) *      fx  * (1 - fy) +
      hash(x0, y1) * (1 - fx) *      fy  +
      hash(x1, y1) *      fx  *      fy
    );
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Octave frequencies are whole numbers (4, 8, 16 cells) so each tiles exactly
      const nx = (x / size) * 4, ny = (y / size) * 4;
      let v = vnoise(nx, ny, 4) * 0.5 + vnoise(nx * 2, ny * 2, 8) * 0.25 + vnoise(nx * 4, ny * 4, 16) * 0.125;
      v = Math.min(v / 0.875, 1);
      const b = Math.floor(v * 255), i = (y * size + x) * 4;
      data[i] = b; data[i+1] = b; data[i+2] = b; data[i+3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  // Repeat (the noise tiles); LinearFilter because DataTexture defaults to Nearest.
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
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

// ─── Clustered placement (periodic square tiles) ──────────────────────────────
const _dummy = new THREE.Object3D();

// `count` cluster centres over a size×size tile centred on the origin: a jittered
// grid with a random subset of its cells, for even coverage.
function generateTileClusters(size: number, count: number): [number, number][] {
  const g    = Math.max(1, Math.ceil(Math.sqrt(count)));
  const cell = size / g;
  const order = Array.from({ length: g * g }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
  }
  const centres: [number, number][] = [];
  for (let k = 0; k < count; k++) {
    const col = order[k] % g, row = Math.floor(order[k] / g);
    centres.push([
      -size / 2 + (col + 0.1 + Math.random() * 0.8) * cell,
      -size / 2 + (row + 0.1 + Math.random() * 0.8) * cell,
    ]);
  }
  return centres;
}

// Scatters `perCluster` jittered blades around each cluster centre.
function fillTile(
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
  ${curveDropGLSL}

  uniform vec2  uBandRange;      // this band's (inner, outer) distance from the camera focus
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

    // Band mask: tiles are periodic images, so each blade is shown only inside this
    // band's distance range from the camera focus. Heights fade over BAND_FADE at
    // both edges to cross-fade neighbouring bands. The innermost band has no inner edge.
    float focusDist = length(modelPos.xz - uCurveFocus);
    bool  hasInner  = uBandRange.x > 0.0;
    if (focusDist >= uBandRange.y || (hasInner && focusDist <= uBandRange.x - ${BAND_FADE.toFixed(1)})) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside clip space: culled
      return;
    }
    float bandFade = 1.0 - smoothstep(uBandRange.y - ${BAND_FADE.toFixed(1)}, uBandRange.y, focusDist);
    if (hasInner) bandFade *= smoothstep(uBandRange.x - ${BAND_FADE.toFixed(1)}, uBandRange.x, focusDist);
    modelPos.y *= bandFade;

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

    // Follow the curved ground (same drop as Ground.tsx, from the blade's base position)
    modelPos.y -= curveDrop(vWorldXZ);

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
    vec2 colorUV = vWorldXZ / 150.0;
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

// Shadow direction = normalize(modelXZ - lightXZ). The sun sits at a fixed offset
// from the camera focus (as in ModelController), so it's recomputed when either moves.
const _lightXZ     = new THREE.Vector2();
const _shadowDir   = new THREE.Vector2();
const _prevModelXZ = new THREE.Vector2(9999, 9999);
const _prevFocus   = new THREE.Vector2(9999, 9999);
const MOVE_EPS = 0.0001;

type TileMesh = {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  count: number;
  centres: [number, number][];
  perCluster: number;
  clusterRadius: number;
  heightScale: number;
  cx: number;      // tile centre within the periodic grid
  cz: number;
  period: number;  // grid period (TILES_PER_SIDE tiles)
};

// Moves a tile to its periodic image nearest the camera focus.
function placeTile(node: THREE.Object3D, t: TileMesh) {
  node.position.set(
    t.cx + t.period * Math.round((cameraFocus.x - t.cx) / t.period),
    0,
    t.cz + t.period * Math.round((cameraFocus.y - t.cz) / t.period),
  );
}

const Grass = () => {
  const timeRef = useRef(0);

  const { tiles, uniforms, disposables } = useMemo(() => {
    const alphaTexture = makeGrassAlphaTexture(512);
    const noiseTexture = makeNoiseTexture(256);

    // Every band's material shares these uniform objects, so updating one updates all.
    const sharedUniforms = {
      ...curveUniforms,
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
      // Only read by materials with PAW_TRACKING
      uPawPositions:  { value: [
        new THREE.Vector3(9999, 0, 9999),
        new THREE.Vector3(9999, 0, 9999),
      ]},
    };

    // fog: true has the renderer fill the fog uniforms from Scene's <fog>. They're
    // written per material, so each material gets its own copy.
    const makeUniforms = (extra: Record<string, THREE.IUniform> = {}) => ({
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...sharedUniforms,
      ...extra,
    });

    // One material per band (each has its own distance range). Near bands get full
    // paw tracking + animation via PAW_TRACKING/ANIMATED; far bands skip both.
    const makeMaterial = (band: typeof BANDS[number], innerR: number) => new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      side: THREE.DoubleSide,
      transparent: false,
      depthWrite:  true,
      fog: true,
      uniforms: makeUniforms({ uBandRange: { value: new THREE.Vector2(innerR, band.r) } }),
      defines: band.near ? { PAW_TRACKING: '', ANIMATED: '' } : {},
    });

    // One shared geometry and material per band, one InstancedMesh per tile.
    const tiles: TileMesh[] = [];
    const materials: THREE.ShaderMaterial[] = [];
    let prevR = 0;
    for (const band of BANDS) {
      const geometry = createTuftGeometry(band.planes, band.w);
      const material = makeMaterial(band, prevR);
      materials.push(material);

      const tileSize = (2 * band.r) / (TILES_PER_SIDE - 1);
      const period   = tileSize * TILES_PER_SIDE;
      const density  = band.clusters / (Math.PI * (band.r * band.r - prevR * prevR));
      const perTile  = Math.max(1, Math.round(density * tileSize * tileSize));

      for (let row = 0; row < TILES_PER_SIDE; row++) {
        for (let col = 0; col < TILES_PER_SIDE; col++) {
          tiles.push({
            geometry,
            material,
            count: perTile * band.perC,
            centres: generateTileClusters(tileSize, perTile),
            perCluster: band.perC,
            clusterRadius: band.cR,
            heightScale: band.hs,
            cx: -period / 2 + (col + 0.5) * tileSize,
            cz: -period / 2 + (row + 0.5) * tileSize,
            period,
          });
        }
      }
      prevR = band.r;
    }

    const disposables = [
      alphaTexture, noiseTexture, ...materials,
      ...new Set(tiles.map((t) => t.geometry)),
    ];

    return { tiles, uniforms: sharedUniforms, disposables };
  }, []);

  useEffect(() => () => disposables.forEach((d) => d.dispose()), [disposables]);

  // Scatter once the meshes exist. A layout effect (not an inline ref) keeps
  // re-renders from re-randomising the field.
  const meshRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
  useLayoutEffect(() => {
    tiles.forEach((t, i) => {
      const node = meshRefs.current[i];
      if (!node) return;
      fillTile(node, t.centres, t.perCluster, t.clusterRadius, t.heightScale);
      placeTile(node, t);
    });
  }, [tiles]);

  const sitAmountRef = useRef(0);

  useFrame((_, delta) => {
    timeRef.current += delta;
    uniforms.uTime.value = timeRef.current;

    // Re-place tiles and the sun only when the world has scrolled
    const focusMoved = Math.abs(cameraFocus.x - _prevFocus.x) > MOVE_EPS
      || Math.abs(cameraFocus.y - _prevFocus.y) > MOVE_EPS;
    if (focusMoved) {
      _prevFocus.copy(cameraFocus);
      tiles.forEach((t, i) => {
        const node = meshRefs.current[i];
        if (node) placeTile(node, t);
      });
    }

    // Only update position-dependent uniforms when the model (or the sun) has moved
    const movedX = Math.abs(modelWorldPos.x - _prevModelXZ.x);
    const movedZ = Math.abs(modelWorldPos.z - _prevModelXZ.y);
    if (movedX > MOVE_EPS || movedZ > MOVE_EPS || focusMoved) {
      _prevModelXZ.set(modelWorldPos.x, modelWorldPos.z);
      uniforms.uPlayerPos.value.copy(modelWorldPos);
      _lightXZ.set(cameraFocus.x + SUN_POSITION.x, cameraFocus.y + SUN_POSITION.z);
      _shadowDir.set(modelWorldPos.x - _lightXZ.x, modelWorldPos.z - _lightXZ.y).normalize();
      uniforms.uShadowDir.value.copy(_shadowDir);
    }
    uniforms.uPlayerForward.value.copy(modelForwardRef.value);
    for (let i = 0; i < 2; i++) uniforms.uPawPositions.value[i].copy(modelPawPositions[i]);
    // Ease into/out of sitting; snap when close so it stops updating
    const sitTarget = modelSitAmountRef.value;
    const sitDiff = sitTarget - sitAmountRef.current;
    if (Math.abs(sitDiff) < 0.001) {
      sitAmountRef.current = sitTarget;
    } else {
      sitAmountRef.current += sitDiff * Math.min(1, delta * 4);
    }
    uniforms.uSitAmount.value = sitAmountRef.current;
    uniforms.uGroundedAmount.value = modelGroundedRef.value;
  });

  return (
    <>
      {tiles.map((t, i) => (
        <instancedMesh
          key={i}
          ref={(node) => { meshRefs.current[i] = node; }}
          args={[t.geometry, t.material, t.count]}
        />
      ))}
    </>
  );
};

export default Grass;
