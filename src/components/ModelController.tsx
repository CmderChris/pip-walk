import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

const MODEL_PATH = '/models/shiba-test.glb';
const ANIMATIONS_PATH = '/models/walking.glb';

const MOVE_SPEED = 6;        // world units/second — constant across the whole field
const ROTATION_SPEED = 10;
const MIN_SPEED_FOR_WALK = 0.5;
const EDGE_MARGIN = 0.02;    // NDC margin inside each screen edge
const PLAY_AREA_FAR_Z = -25; // world Z of the back boundary (grass meets horizon)

// Pre-allocated scratch — never created per frame
const _raycaster = new THREE.Raycaster();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _groundPoint = new THREE.Vector3();
const _probePoint = new THREE.Vector3();
const _tempVec3 = new THREE.Vector3();
const _ndcSample = new THREE.Vector2();
const _inputVec2 = new THREE.Vector2();

const ModelController = () => {
  const { scene } = useGLTF(MODEL_PATH, true);
  const { animations } = useGLTF(ANIMATIONS_PATH, true);
  const modelRef = useRef<THREE.Group>(null);

  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const walkActionRef = useRef<THREE.AnimationAction | null>(null);

  // Screen-space (NDC) position is the source of truth.
  // This guarantees that pressing W/S only moves up/down the screen and
  // pressing A/D only moves left/right — no cross-axis drift from perspective.
  const ndcPosRef = useRef(new THREE.Vector2(0, -0.5));
  const worldPosRef = useRef(new THREE.Vector3(0, 0, 0));
  const currentSpeedRef = useRef(0);
  const targetRotationRef = useRef(0);
  const animationWeightRef = useRef(0);

  const keysPressedRef = useRef({ w: false, a: false, s: false, d: false });
  const joystickRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!scene || animations.length === 0) return;

    const mixer = new THREE.AnimationMixer(scene);
    const action = mixer.clipAction(animations[0]);
    action.setEffectiveWeight(0);
    action.play();
    mixerRef.current = mixer;
    walkActionRef.current = action;
    return () => {
      mixer.stopAllAction();
      mixerRef.current = null;
      walkActionRef.current = null;
    };
  }, [scene, animations]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w') keysPressedRef.current.w = true;
      if (key === 'a') keysPressedRef.current.a = true;
      if (key === 's') keysPressedRef.current.s = true;
      if (key === 'd') keysPressedRef.current.d = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w') keysPressedRef.current.w = false;
      if (key === 'a') keysPressedRef.current.a = false;
      if (key === 's') keysPressedRef.current.s = false;
      if (key === 'd') keysPressedRef.current.d = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    window.updateJoystick = (x: number, y: number) => {
      joystickRef.current = { x, y };
    };
    return () => {
      window.updateJoystick = undefined;
    };
  }, []);

  useFrame((state, delta) => {
    const cam = state.camera as THREE.PerspectiveCamera;

    // ── 1. Compute NDC boundaries ──────────────────────────────────────────
    // Far boundary: project the back-wall world Z to NDC Y every frame so it
    // is always accurate even if the camera hasn't settled on frame 0.
    _tempVec3.set(0, 0, PLAY_AREA_FAR_Z);
    _tempVec3.project(cam);
    const farNDCY = _tempVec3.y;

    // ── 2. Input ───────────────────────────────────────────────────────────
    const keys = keysPressedRef.current;
    const joystick = joystickRef.current;
    const rawX = (keys.d ? 1 : 0) - (keys.a ? 1 : 0) + joystick.x;
    const rawZ = (keys.s ? 1 : 0) - (keys.w ? 1 : 0) + joystick.y;

    // Map to screen axes: right=+ndcX, up=+ndcY (W goes up → rawZ=-1 → +ndcY)
    _inputVec2.set(rawX, -rawZ);
    const hasInput = _inputVec2.lengthSq() > 0.01;

    if (hasInput) {
      _inputVec2.normalize();

      // Measure how many world units correspond to 1 NDC unit in each screen
      // direction at the current position. This lets us express MOVE_SPEED in
      // world units/sec while still moving along screen axes — so speed is
      // constant everywhere on the field (no acceleration near the horizon).
      const PROBE = 0.001;
      const cx = ndcPosRef.current.x;
      const cy = ndcPosRef.current.y;

      _raycaster.setFromCamera(ndcPosRef.current, cam);
      _raycaster.ray.intersectPlane(_groundPlane, _groundPoint);

      _ndcSample.set(cx + PROBE, cy);
      _raycaster.setFromCamera(_ndcSample, cam);
      _raycaster.ray.intersectPlane(_groundPlane, _probePoint);
      const worldPerNdcX = _probePoint.distanceTo(_groundPoint) / PROBE;

      _ndcSample.set(cx, cy + PROBE);
      _raycaster.setFromCamera(_ndcSample, cam);
      _raycaster.ray.intersectPlane(_groundPlane, _probePoint);
      const worldPerNdcY = _probePoint.distanceTo(_groundPoint) / PROBE;

      // NDC deltas that produce exactly MOVE_SPEED world units/sec
      const ndcDX = _inputVec2.x * (MOVE_SPEED / Math.max(worldPerNdcX, 0.001)) * delta;
      const ndcDY = _inputVec2.y * (MOVE_SPEED / Math.max(worldPerNdcY, 0.001)) * delta;

      ndcPosRef.current.x += ndcDX;
      ndcPosRef.current.y += ndcDY;
    }

    // ── 3. Clamp NDC — axes are independent, no cross-axis interference ───
    ndcPosRef.current.x = Math.max(-1 + EDGE_MARGIN, Math.min(1 - EDGE_MARGIN, ndcPosRef.current.x));
    ndcPosRef.current.y = Math.max(-1 + EDGE_MARGIN, Math.min(farNDCY - EDGE_MARGIN, ndcPosRef.current.y));

    // ── 4. Unproject NDC → world position on the ground plane ─────────────
    _raycaster.setFromCamera(ndcPosRef.current, cam);
    if (_raycaster.ray.intersectPlane(_groundPlane, _groundPoint)) {
      _groundPoint.y = 0;

      // Derive rotation from actual world-space movement direction
      if (hasInput) {
        const dx = _groundPoint.x - worldPosRef.current.x;
        const dz = _groundPoint.z - worldPosRef.current.z;
        if (Math.abs(dx) > 0.0001 || Math.abs(dz) > 0.0001) {
          targetRotationRef.current = Math.atan2(dx, dz);
        }
      }

      worldPosRef.current.copy(_groundPoint);
    }

    // ── 5. Animation ───────────────────────────────────────────────────────
    currentSpeedRef.current = hasInput ? MOVE_SPEED : 0;
    const targetWeight = currentSpeedRef.current > MIN_SPEED_FOR_WALK ? 1 : 0;
    animationWeightRef.current += (targetWeight - animationWeightRef.current) * 5 * delta;
    animationWeightRef.current = Math.max(0, Math.min(1, animationWeightRef.current));
    walkActionRef.current?.setEffectiveWeight(animationWeightRef.current);
    mixerRef.current?.update(delta);
    scene.position.set(0, 0, 0); // cancel root motion

    // ── 6. Apply to mesh ───────────────────────────────────────────────────
    if (modelRef.current) {
      modelRef.current.position.copy(worldPosRef.current);

      if (currentSpeedRef.current > MIN_SPEED_FOR_WALK) {
        const currentRotation = modelRef.current.rotation.y;
        const rotDelta = targetRotationRef.current - currentRotation;
        let shortest = ((rotDelta + Math.PI) % (Math.PI * 2)) - Math.PI;
        if (shortest < -Math.PI) shortest += Math.PI * 2;
        modelRef.current.rotation.y += shortest * ROTATION_SPEED * delta;
      }
    }
  });

  return (
    <group ref={modelRef}>
      <primitive object={scene} scale={1.5} />
    </group>
  );
};

export default ModelController;
