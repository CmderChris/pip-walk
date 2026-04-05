import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useTexture } from '@react-three/drei';
import * as THREE from 'three';

const TEXTURE_BASE = '/models/pomeranian_model/spitz_textures/texture';

const MODEL_PATH = '/models/pomeranian_model/spitz_fbx.glb';

const WALK_ANIM = 'Arm_SpitzWalk_F_IP';
const IDLE_ANIM = 'Arm_SpitzIdle_1';
const SIT_START_ANIM = 'Arm_SpitzSitting_start';
const SIT_LOOP_ANIM = 'Arm_SpitzSitting_loop_1';
const SIT_END_ANIM = 'Arm_SpitzSitting_end';

const SIT_DELAY = 5; // seconds of stillness before sitting
const BLEND_TIME = 0.3; // crossfade duration in seconds

type SitState = 'idle' | 'sit_start' | 'sit_loop' | 'sit_end';

const MOVE_SPEED = 4;        // world units/second — constant across the whole field
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
  const { scene, animations } = useGLTF(MODEL_PATH, true);
  const modelRef = useRef<THREE.Group>(null);

  const [albedo, normal, roughness, ao] = useTexture([
    `${TEXTURE_BASE}/Spitz_Albedo3.png`,
    `${TEXTURE_BASE}/Spitz_Normal.png`,
    `${TEXTURE_BASE}/Spitz_Roughness.png`,
    `${TEXTURE_BASE}/Spitz_AO.png`,
  ]);

  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const walkActionRef = useRef<THREE.AnimationAction | null>(null);
  const idleActionRef = useRef<THREE.AnimationAction | null>(null);
  const sitStartActionRef = useRef<THREE.AnimationAction | null>(null);
  const sitLoopActionRef = useRef<THREE.AnimationAction | null>(null);
  const sitEndActionRef = useRef<THREE.AnimationAction | null>(null);
  const sitStateRef = useRef<SitState>('sit_loop');
  const idleTimeRef = useRef(0);

  // Screen-space (NDC) position is the source of truth.
  // This guarantees that pressing W/S only moves up/down the screen and
  // pressing A/D only moves left/right — no cross-axis drift from perspective.
  const ndcPosRef = useRef(new THREE.Vector2(0, -0.5));
  const worldPosRef = useRef(new THREE.Vector3(0, 0, 0));
  const currentSpeedRef = useRef(0);
  const targetRotationRef = useRef(0);
  const animationWeightRef = useRef(0);
  const moveSpeedRef = useRef(0);

  const keysPressedRef = useRef({ w: false, a: false, s: false, d: false });
  const joystickRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!scene) return;
    albedo.colorSpace = THREE.SRGBColorSpace;
    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mat = obj.material as THREE.MeshStandardMaterial;
      mat.map = albedo;
      mat.normalMap = normal;
      mat.roughnessMap = roughness;
      mat.aoMap = ao;
      mat.needsUpdate = true;
    });
  }, [scene, albedo, normal, roughness, ao]);

  useEffect(() => {
    if (!scene || animations.length === 0) return;

    const walkClip = THREE.AnimationClip.findByName(animations, WALK_ANIM);
    const idleClip = THREE.AnimationClip.findByName(animations, IDLE_ANIM);
    const sitStartClip = THREE.AnimationClip.findByName(animations, SIT_START_ANIM);
    const sitLoopClip = THREE.AnimationClip.findByName(animations, SIT_LOOP_ANIM);
    const sitEndClip = THREE.AnimationClip.findByName(animations, SIT_END_ANIM);
    if (!walkClip || !idleClip || !sitStartClip || !sitLoopClip || !sitEndClip) return;

    const mixer = new THREE.AnimationMixer(scene);

    // Walk and idle run continuously; weights are managed in useFrame
    const idleAction = mixer.clipAction(idleClip);
    idleAction.setEffectiveWeight(0);
    idleAction.play();

    const walkAction = mixer.clipAction(walkClip);
    walkAction.setEffectiveWeight(0);
    walkAction.play();

    // Sit actions are NOT pre-played — they're started/stopped explicitly on transition
    const sitStartAction = mixer.clipAction(sitStartClip);
    sitStartAction.setLoop(THREE.LoopOnce, 1);
    sitStartAction.clampWhenFinished = true;

    // Start in sitting state
    const sitLoopAction = mixer.clipAction(sitLoopClip);
    sitLoopAction.setEffectiveWeight(1);
    sitLoopAction.play();

    const sitEndAction = mixer.clipAction(sitEndClip);
    sitEndAction.setLoop(THREE.LoopOnce, 1);
    sitEndAction.clampWhenFinished = true;
    sitEndAction.timeScale = 1.5;

    // Finished event only advances state — no stop() calls, weights managed in useFrame
    const onFinished = (e: { action: THREE.AnimationAction }) => {
      if (e.action === sitStartAction && sitStateRef.current === 'sit_start') {
        sitStateRef.current = 'sit_loop';
      } else if (e.action === sitEndAction && sitStateRef.current === 'sit_end') {
        sitStateRef.current = 'idle';
        animationWeightRef.current = 0;
        idleTimeRef.current = 0;
      }
    };
    mixer.addEventListener('finished', onFinished);

    mixerRef.current = mixer;
    walkActionRef.current = walkAction;
    idleActionRef.current = idleAction;
    sitStartActionRef.current = sitStartAction;
    sitLoopActionRef.current = sitLoopAction;
    sitEndActionRef.current = sitEndAction;

    return () => {
      mixer.removeEventListener('finished', onFinished);
      mixer.stopAllAction();
      mixerRef.current = null;
      walkActionRef.current = null;
      idleActionRef.current = null;
      sitStartActionRef.current = null;
      sitLoopActionRef.current = null;
      sitEndActionRef.current = null;
      sitStateRef.current = 'idle';
      idleTimeRef.current = 0;
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
    const canMove = hasInput && sitStateRef.current === 'idle';

    if (canMove) {
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

      // Ramp momentum up from 0 on movement start for a natural feel
      moveSpeedRef.current = Math.min(1, moveSpeedRef.current + delta * 6);

      // NDC deltas that produce exactly MOVE_SPEED world units/sec
      const ndcDX = _inputVec2.x * (MOVE_SPEED / Math.max(worldPerNdcX, 0.001)) * delta * moveSpeedRef.current;
      const ndcDY = _inputVec2.y * (MOVE_SPEED / Math.max(worldPerNdcY, 0.001)) * delta * moveSpeedRef.current;

      ndcPosRef.current.x += ndcDX;
      ndcPosRef.current.y += ndcDY;
    } else {
      moveSpeedRef.current = 0;
    }

    // ── 3. Clamp NDC — axes are independent, no cross-axis interference ───
    ndcPosRef.current.x = Math.max(-1 + EDGE_MARGIN, Math.min(1 - EDGE_MARGIN, ndcPosRef.current.x));
    ndcPosRef.current.y = Math.max(-1 + EDGE_MARGIN, Math.min(farNDCY - EDGE_MARGIN, ndcPosRef.current.y));

    // ── 4. Unproject NDC → world position on the ground plane ─────────────
    _raycaster.setFromCamera(ndcPosRef.current, cam);
    if (_raycaster.ray.intersectPlane(_groundPlane, _groundPoint)) {
      _groundPoint.y = 0;

      // Derive rotation from actual world-space movement direction
      if (canMove) {
        const dx = _groundPoint.x - worldPosRef.current.x;
        const dz = _groundPoint.z - worldPosRef.current.z;
        if (Math.abs(dx) > 0.0001 || Math.abs(dz) > 0.0001) {
          targetRotationRef.current = Math.atan2(dx, dz);
        }
      }

      worldPosRef.current.copy(_groundPoint);
    }

    // ── 5. Animation ───────────────────────────────────────────────────────
    currentSpeedRef.current = canMove ? MOVE_SPEED : 0;
    const sitState = sitStateRef.current;

    if (sitState === 'idle') {
      // Explicitly zero sit actions — stop() + reset() leaves them enabled with weight=1
      sitStartActionRef.current?.setEffectiveWeight(0);
      sitLoopActionRef.current?.setEffectiveWeight(0);
      sitEndActionRef.current?.setEffectiveWeight(0);

      // Normal walk/idle blend
      const targetWalk = canMove ? 1 : 0;
      animationWeightRef.current += (targetWalk - animationWeightRef.current) * 5 * delta;
      animationWeightRef.current = Math.max(0, Math.min(1, animationWeightRef.current));
      walkActionRef.current?.setEffectiveWeight(animationWeightRef.current);
      idleActionRef.current?.setEffectiveWeight(1 - animationWeightRef.current);

      if (!hasInput) {
        idleTimeRef.current += delta;
        if (idleTimeRef.current >= SIT_DELAY) {
          sitStateRef.current = 'sit_start';
          idleTimeRef.current = 0;
          sitStartActionRef.current!.reset().play();
        }
      } else {
        idleTimeRef.current = 0;
      }
    } else if (sitState === 'sit_start') {
      // Blend idle out, sitStart in
      animationWeightRef.current = Math.min(1, animationWeightRef.current + delta / BLEND_TIME);
      walkActionRef.current?.setEffectiveWeight(0);
      idleActionRef.current?.setEffectiveWeight(1 - animationWeightRef.current);
      sitStartActionRef.current?.setEffectiveWeight(animationWeightRef.current);
      sitLoopActionRef.current?.setEffectiveWeight(0);
      sitEndActionRef.current?.setEffectiveWeight(0);

      if (hasInput) {
        sitStateRef.current = 'sit_end';
        sitEndActionRef.current!.reset().play();
        animationWeightRef.current = 0;
      }
      // → sit_loop via finished event
    } else if (sitState === 'sit_loop') {
      if (!sitLoopActionRef.current!.isRunning()) {
        sitLoopActionRef.current!.reset().play();
      }
      walkActionRef.current?.setEffectiveWeight(0);
      idleActionRef.current?.setEffectiveWeight(0);
      sitStartActionRef.current?.setEffectiveWeight(0);
      sitLoopActionRef.current?.setEffectiveWeight(1);
      sitEndActionRef.current?.setEffectiveWeight(0);

      if (hasInput) {
        sitStateRef.current = 'sit_end';
        sitEndActionRef.current!.reset().play();
      }
    } else if (sitState === 'sit_end') {
      walkActionRef.current?.setEffectiveWeight(0);
      idleActionRef.current?.setEffectiveWeight(0);
      sitStartActionRef.current?.setEffectiveWeight(0);
      sitLoopActionRef.current?.setEffectiveWeight(0);
      sitEndActionRef.current?.setEffectiveWeight(1);
      // → idle via finished event, which resets animationWeightRef to 0
    }

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
      <primitive object={scene} scale={4.0} />
    </group>
  );
};

export default ModelController;
