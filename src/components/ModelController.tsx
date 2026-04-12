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
const JUMP_ANIM = 'Arm_SpitzJump_Place_IP';
const SCRATCH_ANIM = 'Arm_SpitzScratching';

const SIT_DELAY = 10; // seconds of stillness before sitting
const BLEND_TIME = 0.3; // crossfade duration in seconds
const JUMP_BLEND_TIME = 0.2; // faster blend for jump entry/exit

type SitState = 'idle' | 'sit_start' | 'sit_loop' | 'sit_end' | 'jump' | 'jump_return' | 'scratch';

const SCRATCH_INTERVAL_MIN = 15; // seconds min between scratches
const SCRATCH_INTERVAL_MAX = 35; // seconds max between scratches

const MOVE_SPEED = 7;        // world units/second — constant across the whole field
const MODEL_Y_OFFSET = 0.25; // lifts model so feet don't clip ground on landing
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
  const jumpActionRef = useRef<THREE.AnimationAction | null>(null);
  const scratchActionRef = useRef<THREE.AnimationAction | null>(null);
  const sitStateRef = useRef<SitState>('sit_loop');
  const idleTimeRef = useRef(0);
  const scratchTimerRef = useRef(SCRATCH_INTERVAL_MIN + Math.random() * (SCRATCH_INTERVAL_MAX - SCRATCH_INTERVAL_MIN));
  const scratchReturnStateRef = useRef<'idle' | 'sit_loop'>('idle');

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
  const jumpPressedRef = useRef(false);
  const jumpReturnBlendRef = useRef(0);
  const jumpVelocityRef = useRef(new THREE.Vector2(0, 0));
  const jumpTimeRef = useRef(0);
  const jumpDurationRef = useRef(1);
  const walkPreChargeRef = useRef(0); // walk blend pre-charged during jump descent
  const landingSpeedRef = useRef(1);  // brief speed multiplier dip on landing

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
    const jumpClip = THREE.AnimationClip.findByName(animations, JUMP_ANIM);
    const scratchClip = THREE.AnimationClip.findByName(animations, SCRATCH_ANIM);
    if (!walkClip || !idleClip || !sitStartClip || !sitLoopClip || !sitEndClip || !jumpClip || !scratchClip) return;

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

    jumpClip.duration *= 0.85; // trim end frames where feet are down but root still moves forward
    const jumpAction = mixer.clipAction(jumpClip);
    jumpAction.setLoop(THREE.LoopOnce, 1);
    jumpAction.clampWhenFinished = true;
    jumpAction.timeScale = 1.4;
    jumpDurationRef.current = jumpClip.duration / 1.4;

    const scratchAction = mixer.clipAction(scratchClip);
    scratchAction.setLoop(THREE.LoopOnce, 1);
    scratchAction.clampWhenFinished = true;

    // Finished event only advances state — no stop() calls, weights managed in useFrame
    const onFinished = (e: { action: THREE.AnimationAction }) => {
      if (e.action === sitStartAction && sitStateRef.current === 'sit_start') {
        sitStateRef.current = 'sit_loop';
      } else if (e.action === sitEndAction && sitStateRef.current === 'sit_end') {
        sitStateRef.current = 'idle';
        animationWeightRef.current = 0;
        idleTimeRef.current = 0;
      } else if (e.action === jumpAction && sitStateRef.current === 'jump') {
        sitStateRef.current = 'jump_return';
        jumpReturnBlendRef.current = walkPreChargeRef.current;
        animationWeightRef.current = walkPreChargeRef.current;
        jumpVelocityRef.current.set(0, 0);
        landingSpeedRef.current = 0.4;
      } else if (e.action === scratchAction && sitStateRef.current === 'scratch') {
        sitStateRef.current = 'sit_loop';
        scratchTimerRef.current = SCRATCH_INTERVAL_MIN + Math.random() * (SCRATCH_INTERVAL_MAX - SCRATCH_INTERVAL_MIN);
      }
    };
    mixer.addEventListener('finished', onFinished);

    mixerRef.current = mixer;
    walkActionRef.current = walkAction;
    idleActionRef.current = idleAction;
    sitStartActionRef.current = sitStartAction;
    sitLoopActionRef.current = sitLoopAction;
    sitEndActionRef.current = sitEndAction;
    jumpActionRef.current = jumpAction;
    scratchActionRef.current = scratchAction;

    return () => {
      mixer.removeEventListener('finished', onFinished);
      mixer.stopAllAction();
      mixerRef.current = null;
      walkActionRef.current = null;
      idleActionRef.current = null;
      sitStartActionRef.current = null;
      sitLoopActionRef.current = null;
      sitEndActionRef.current = null;
      jumpActionRef.current = null;
      scratchActionRef.current = null;
      sitStateRef.current = 'idle';
      idleTimeRef.current = 0;
    };
  }, [scene, animations]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w' || key === 'arrowup') keysPressedRef.current.w = true;
      if (key === 'a' || key === 'arrowleft') keysPressedRef.current.a = true;
      if (key === 's' || key === 'arrowdown') keysPressedRef.current.s = true;
      if (key === 'd' || key === 'arrowright') keysPressedRef.current.d = true;
      if (e.key === ' ') { e.preventDefault(); jumpPressedRef.current = true; }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w' || key === 'arrowup') keysPressedRef.current.w = false;
      if (key === 'a' || key === 'arrowleft') keysPressedRef.current.a = false;
      if (key === 's' || key === 'arrowdown') keysPressedRef.current.s = false;
      if (key === 'd' || key === 'arrowright') keysPressedRef.current.d = false;
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

  useEffect(() => {
    window.triggerJump = () => { jumpPressedRef.current = true; };
    return () => { window.triggerJump = undefined; };
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
    const inJumpReturn = sitStateRef.current === 'jump_return';
    // Allow movement during jump_return once walk is visibly blended in (pre-charge may already satisfy this)
    const canMove = hasInput && (sitStateRef.current === 'idle' || (inJumpReturn && animationWeightRef.current > 0.35));

    // Measure how many world units correspond to 1 NDC unit at the current position.
    // Computed unconditionally so jump momentum can reuse it each frame.
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

    if (canMove) {
      _inputVec2.normalize();

      // Ramp momentum up from 0 on movement start for a natural feel
      moveSpeedRef.current = Math.min(1, moveSpeedRef.current + delta * 6);

      // Recover landing speed dip quickly (takes ~0.3s to reach full speed)
      landingSpeedRef.current = Math.min(1, landingSpeedRef.current + delta * 8);

      // NDC deltas that produce exactly MOVE_SPEED world units/sec
      const ndcDX = _inputVec2.x * (MOVE_SPEED / Math.max(worldPerNdcX, 0.001)) * delta * moveSpeedRef.current * landingSpeedRef.current;
      const ndcDY = _inputVec2.y * (MOVE_SPEED / Math.max(worldPerNdcY, 0.001)) * delta * moveSpeedRef.current * landingSpeedRef.current;

      ndcPosRef.current.x += ndcDX;
      ndcPosRef.current.y += ndcDY;
      // Store normalised direction so jump can re-apply perspective correction each frame
      jumpVelocityRef.current.copy(_inputVec2);
    } else {
      const isJumping = sitStateRef.current === 'jump' || sitStateRef.current === 'jump_return';
      if (sitStateRef.current === 'jump' && jumpVelocityRef.current.lengthSq() > 0.00001) {
        // Re-apply perspective correction at current position each frame so speed
        // stays constant even as the character approaches the horizon
        const ndcDX = jumpVelocityRef.current.x * (MOVE_SPEED / Math.max(worldPerNdcX, 0.001)) * delta;
        const ndcDY = jumpVelocityRef.current.y * (MOVE_SPEED / Math.max(worldPerNdcY, 0.001)) * delta;
        ndcPosRef.current.x += ndcDX;
        ndcPosRef.current.y += ndcDY;
      } else if (!isJumping) {
        moveSpeedRef.current = 0;
        jumpVelocityRef.current.set(0, 0);
      }
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
    // Consume jump input — only valid from idle
    if (jumpPressedRef.current) {
      jumpPressedRef.current = false;
      if (sitStateRef.current === 'idle') {
        sitStateRef.current = 'jump';
        animationWeightRef.current = 0;
        idleTimeRef.current = 0;
        jumpTimeRef.current = 0;
        walkPreChargeRef.current = 0;
        jumpActionRef.current!.reset().play();
      }
    }

    currentSpeedRef.current = canMove ? MOVE_SPEED : 0;
    const sitState = sitStateRef.current;

    if (sitState === 'idle') {
      // Explicitly zero sit/jump actions
      sitStartActionRef.current?.setEffectiveWeight(0);
      sitLoopActionRef.current?.setEffectiveWeight(0);
      sitEndActionRef.current?.setEffectiveWeight(0);
      jumpActionRef.current?.setEffectiveWeight(0);

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
      jumpActionRef.current?.setEffectiveWeight(0);

      if (hasInput) {
        sitStateRef.current = 'sit_end';
        sitEndActionRef.current!.reset().play();
        animationWeightRef.current = 0;
      }
      // → sit_loop via finished event
    } else if (sitState === 'sit_loop') {
      if (sitLoopActionRef.current && !sitLoopActionRef.current.isRunning()) {
        sitLoopActionRef.current!.reset().play();
      }
      walkActionRef.current?.setEffectiveWeight(0);
      idleActionRef.current?.setEffectiveWeight(0);
      sitStartActionRef.current?.setEffectiveWeight(0);
      sitLoopActionRef.current?.setEffectiveWeight(1);
      sitEndActionRef.current?.setEffectiveWeight(0);
      jumpActionRef.current?.setEffectiveWeight(0);
      scratchActionRef.current?.setEffectiveWeight(0);

      if (hasInput) {
        sitStateRef.current = 'sit_end';
        sitEndActionRef.current!.reset().play();
      } else {
        scratchTimerRef.current -= delta;
        if (scratchTimerRef.current <= 0) {
          sitStateRef.current = 'scratch';
          scratchReturnStateRef.current = 'sit_loop';
          animationWeightRef.current = 0;
          scratchActionRef.current!.reset().play();
        }
      }
    } else if (sitState === 'sit_end') {
      walkActionRef.current?.setEffectiveWeight(0);
      idleActionRef.current?.setEffectiveWeight(0);
      sitStartActionRef.current?.setEffectiveWeight(0);
      sitLoopActionRef.current?.setEffectiveWeight(0);
      sitEndActionRef.current?.setEffectiveWeight(1);
      jumpActionRef.current?.setEffectiveWeight(0);
      scratchActionRef.current?.setEffectiveWeight(0);
      // → idle via finished event, which resets animationWeightRef to 0
    } else if (sitState === 'scratch') {
      // Blend scratch in over BLEND_TIME, then blend sit_loop back in during the last 45% of the clip
      const scratchAction = scratchActionRef.current;
      const clipDuration = scratchAction ? scratchAction.getClip().duration : 1;
      const scratchProgress = scratchAction ? scratchAction.time / clipDuration : 0;
      const BLEND_OUT_START = 0.55; // start blending back to sit at this point in the clip

      let scratchWeight: number;
      if (scratchProgress < BLEND_OUT_START) {
        // Blend in
        animationWeightRef.current = Math.min(1, animationWeightRef.current + delta / BLEND_TIME);
        scratchWeight = animationWeightRef.current;
      } else {
        // Blend out — map BLEND_OUT_START..1 → 1..0
        scratchWeight = 1 - (scratchProgress - BLEND_OUT_START) / (1 - BLEND_OUT_START);
        scratchWeight = Math.max(0, scratchWeight);
      }

      walkActionRef.current?.setEffectiveWeight(0);
      idleActionRef.current?.setEffectiveWeight(0);
      sitStartActionRef.current?.setEffectiveWeight(0);
      sitLoopActionRef.current?.setEffectiveWeight(1 - scratchWeight);
      sitEndActionRef.current?.setEffectiveWeight(0);
      jumpActionRef.current?.setEffectiveWeight(0);
      scratchActionRef.current?.setEffectiveWeight(scratchWeight);

      if (hasInput) {
        sitStateRef.current = 'sit_end';
        sitEndActionRef.current!.reset().play();
        scratchTimerRef.current = SCRATCH_INTERVAL_MIN + Math.random() * (SCRATCH_INTERVAL_MAX - SCRATCH_INTERVAL_MIN);
      }
      // → sit_loop via finished event
    } else if (sitState === 'jump') {
      jumpTimeRef.current += delta;
      // Blend idle out, jump in
      animationWeightRef.current = Math.min(1, animationWeightRef.current + delta / JUMP_BLEND_TIME);
      // Pre-charge walk during descent (second half) if input is held
      const jumpProgress = jumpTimeRef.current / jumpDurationRef.current;
      if (hasInput && jumpProgress > 0.85) {
        walkPreChargeRef.current = Math.min(1, walkPreChargeRef.current + delta * 6);
      }
      const preCharge = walkPreChargeRef.current;
      const jumpWeight = animationWeightRef.current * (1 - preCharge);
      walkActionRef.current?.setEffectiveWeight(preCharge);
      idleActionRef.current?.setEffectiveWeight((1 - animationWeightRef.current) * (1 - preCharge));
      sitStartActionRef.current?.setEffectiveWeight(0);
      sitLoopActionRef.current?.setEffectiveWeight(0);
      sitEndActionRef.current?.setEffectiveWeight(0);
      jumpActionRef.current?.setEffectiveWeight(jumpWeight);
      // → jump_return via finished event
    } else if (sitState === 'jump_return') {
      // Blend jump out; simultaneously pre-charge walk/idle blend based on current input
      jumpReturnBlendRef.current = Math.min(1, jumpReturnBlendRef.current + delta / JUMP_BLEND_TIME);
      // Smoothly ramp walk weight toward target so it's already blended when idle resumes
      const targetWalk = hasInput ? 1 : 0;
      animationWeightRef.current += (targetWalk - animationWeightRef.current) * 5 * delta;
      animationWeightRef.current = Math.max(0, Math.min(1, animationWeightRef.current));
      const landBlend = jumpReturnBlendRef.current;
      walkActionRef.current?.setEffectiveWeight(landBlend * animationWeightRef.current);
      idleActionRef.current?.setEffectiveWeight(landBlend * (1 - animationWeightRef.current));
      sitStartActionRef.current?.setEffectiveWeight(0);
      sitLoopActionRef.current?.setEffectiveWeight(0);
      sitEndActionRef.current?.setEffectiveWeight(0);
      jumpActionRef.current?.setEffectiveWeight(1 - landBlend);

      if (jumpReturnBlendRef.current >= 1) {
        sitStateRef.current = 'idle';
        // Do NOT reset animationWeightRef — carry pre-charged walk blend into idle
        idleTimeRef.current = 0;
      }
    }

    mixerRef.current?.update(delta);
    // Cancel XZ root motion every frame. During jump add a small sine lift on top
    // of the animation's own Y so the dog visibly leaves the ground.
    const activeState = sitStateRef.current;
    if (activeState === 'jump' || activeState === 'jump_return') {
      const progress = Math.min(1, jumpTimeRef.current / jumpDurationRef.current);
      const liftY = 0.4 * Math.sin(progress * Math.PI); // max 0.4 units off ground
      scene.position.x = 0;
      scene.position.z = 0;
      scene.position.y = MODEL_Y_OFFSET + liftY;
    } else {
      scene.position.set(0, MODEL_Y_OFFSET, 0);
    }

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

      // Subtle pitch tilt during jump: nose up on ascent, nose down on descent.
      // Use YXZ order so pitch applies in the model's local frame, not world space.
      modelRef.current.rotation.order = 'YXZ';
      const MAX_PITCH = 0.18; // radians (~10°)
      if (sitState === 'jump') {
        const progress = Math.min(1, jumpTimeRef.current / jumpDurationRef.current);
        const tilt = MAX_PITCH * Math.cos(progress * Math.PI);
        modelRef.current.rotation.x += (tilt - modelRef.current.rotation.x) * 12 * delta;
      } else {
        // jump_return and idle: smooth tilt back to 0
        modelRef.current.rotation.x += (0 - modelRef.current.rotation.x) * 12 * delta;
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

declare global {
  interface Window {
    triggerJump?: () => void;
  }
}
