import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { modelWorldPos } from './modelState';

const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

const BLADE_COUNT      = isMobile ? 50_000 : 200_000;
const PLAYER_RADIUS    = 1.2;

const FIELD_X     = 120;
const FIELD_Z_MIN = -80;
const FIELD_Z_MAX =  20;

// Gust
const IDLE_MIN   = 3.0;
const IDLE_MAX   = 7.0;
const BUILD_TIME = 0.9;
const BLOW_MIN   = 1.5;
const BLOW_MAX   = 3.0;
const FADE_TIME  = 1.4;

// ─── Blade geometry ───────────────────────────────────────────────────────────
// Each blade is a multi-segment strip in the XY plane, curving forward (into +Z)
// using a quadratic Bézier arc so it looks naturally bent rather than a flat card.
const buildBladeGeo = (): THREE.BufferGeometry => {
  const SEGS = 5; // number of height divisions
  const positions: number[] = [];
  const uvs:       number[] = [];
  const indices:   number[] = [];

  // Blade profile: width narrows toward tip, height goes 0→1
  const widthAt  = (t: number) => 0.055 * (1 - t * 0.85);
  // Quadratic Bézier forward curve — control point pulls tip ~0.25 units forward
  const curveZ   = (t: number) => t * t * 0.28;

  for (let s = 0; s <= SEGS; s++) {
    const t = s / SEGS;
    const y = t;              // local height 0..1, scaled per-instance
    const z = curveZ(t);     // forward lean increases toward tip
    const w = widthAt(t);

    positions.push(-w, y, z);  uvs.push(0, t);
    positions.push( w, y, z);  uvs.push(1, t);
  }
  // Tip — single vertex at center (forms a point)
  const tipZ = curveZ(1) + 0.04; // slightly further forward
  positions.push(0, 1.05, tipZ);  uvs.push(0.5, 1);

  for (let s = 0; s < SEGS; s++) {
    const b = s * 2;
    indices.push(b, b + 1, b + 2);
    indices.push(b + 1, b + 3, b + 2);
  }
  // Final row → tip
  const last = SEGS * 2;
  const tip  = (SEGS + 1) * 2;
  indices.push(last, last + 1, tip);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs,       2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
};

// ─── Shaders (matching CodePen approach closely) ──────────────────────────────

const vertexShader = /* glsl */`
  uniform float uTime;
  uniform float uWindStrength;
  uniform vec3  uPlayerPos;
  uniform float uPlayerRadius;

  varying float vHeight;

  float rand(vec2 n) {
    return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
  }

  float noise(vec2 n) {
    vec2 d = vec2(0.0, 1.0);
    vec2 b = floor(n);
    vec2 f = smoothstep(vec2(0.0), vec2(1.0), fract(n));
    return mix(
      mix(rand(b), rand(b + d.yx), f.x),
      mix(rand(b + d.xy), rand(b + d.yy), f.x),
      f.y
    );
  }

  void main() {
    // World position via instance transform
    vec4 worldPos4 = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vec3 worldPos  = worldPos4.xyz;

    // position.y in local space is 0..1 (base to tip) — height factor for sway
    float distFromGround = max(0.0, position.y);
    vHeight = distFromGround;

    float n = noise(worldPos.xz * 0.4) * 0.6 + 0.4;

    // ── Wind: simple cos wave, blades sway together with noise variation ──
    vec3 sway = vec3(
      cos(uTime) * n * distFromGround * uWindStrength * 0.18,
      0.0,
      sin(uTime * 0.7) * n * distFromGround * uWindStrength * 0.06
    );

    // ── Player push — blades near model are pushed outward ────────────────
    float distXZ = length(worldPos.xz - uPlayerPos.xz);
    // Direction FROM player TO blade (away from player)
    vec3  pushDir = normalize(vec3(uPlayerPos.x, worldPos.y, uPlayerPos.z) - worldPos);
    float fOffset = uPlayerRadius - distXZ;
    // Negate so blade moves away; scale by height so base stays rooted
    vec3  playerOffset = -(pushDir * fOffset) * distFromGround;

    // Blend: sway when far, push when inside radius
    // Also scale sway down near player so it doesn't fight the push
    worldPos += mix(
      sway * min(1.0, distXZ / 4.0),
      playerOffset,
      float(distXZ < uPlayerRadius)
    );

    gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
  }
`;

const fragmentShader = /* glsl */`
  varying float vHeight;

  void main() {
    // Dark base, bright tip — matches CodePen colour scheme but warmer/greener
    vec3 dark   = vec3(0.04, 0.14, 0.02);
    vec3 bright = vec3(0.24, 0.56, 0.09);
    vec3 color  = mix(dark, bright, clamp(vHeight / 1.05, 0.0, 1.0));
    gl_FragColor = vec4(color, 1.0);
  }
`;

// ─── Gust state ───────────────────────────────────────────────────────────────

type GustState = 'idle' | 'building' | 'blowing' | 'fading';

const _dummy = new THREE.Object3D();

// ─── Component ────────────────────────────────────────────────────────────────

const Grass = () => {
  const meshRef = useRef<THREE.InstancedMesh>(null!);

  const gustState    = useRef<GustState>('idle');
  const gustTimer    = useRef(IDLE_MIN + Math.random() * (IDLE_MAX - IDLE_MIN));
  const windStrength = useRef(0);
  const windTime     = useRef(0);

  const geometry = useMemo(() => buildBladeGeo(), []);

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime:         { value: 0 },
      uWindStrength: { value: 0 },
      uPlayerPos:    { value: new THREE.Vector3(0, -999, 0) },
      uPlayerRadius: { value: PLAYER_RADIUS },
    },
    side: THREE.DoubleSide,
  }), []);

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material as THREE.ShaderMaterial;

    // ── Gust state machine ──────────────────────────────────────────────────
    gustTimer.current -= delta;
    switch (gustState.current) {
      case 'idle':
        windStrength.current = Math.max(0, windStrength.current - delta / FADE_TIME);
        if (gustTimer.current <= 0) { gustState.current = 'building'; gustTimer.current = BUILD_TIME; }
        break;
      case 'building':
        windStrength.current = Math.min(1, windStrength.current + delta / BUILD_TIME);
        if (gustTimer.current <= 0) { gustState.current = 'blowing'; gustTimer.current = BLOW_MIN + Math.random() * (BLOW_MAX - BLOW_MIN); }
        break;
      case 'blowing':
        windStrength.current = 1;
        if (gustTimer.current <= 0) { gustState.current = 'fading'; gustTimer.current = FADE_TIME; }
        break;
      case 'fading':
        windStrength.current = Math.max(0, gustTimer.current / FADE_TIME);
        if (gustTimer.current <= 0) { gustState.current = 'idle'; gustTimer.current = IDLE_MIN + Math.random() * (IDLE_MAX - IDLE_MIN); }
        break;
    }

    // Time only advances during gusts — still when calm
    windTime.current += delta * windStrength.current * 2.5;

    mat.uniforms.uTime.value         = windTime.current;
    mat.uniforms.uWindStrength.value  = windStrength.current;
    mat.uniforms.uPlayerPos.value.copy(modelWorldPos);
  });

  return (
    <instancedMesh
      ref={(node) => {
        if (!node) return;
        meshRef.current = node;

        for (let i = 0; i < BLADE_COUNT; i++) {
          const x = (Math.random() - 0.5) * FIELD_X;
          const z = FIELD_Z_MIN + Math.random() * (FIELD_Z_MAX - FIELD_Z_MIN);
          const h = 0.22 + Math.random() * 0.32;

          _dummy.position.set(x, 0.02, z);
          _dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
          _dummy.scale.set(1, h, 1);
          _dummy.updateMatrix();
          node.setMatrixAt(i, _dummy.matrix);
        }
        node.instanceMatrix.needsUpdate = true;
      }}
      args={[geometry, material, BLADE_COUNT]}
    />
  );
};

export default Grass;
