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
// Standing jump
const JUMP_START_ANIM = 'Arm_SpitzJumpStart_Place';
const JUMP_AIR_ANIM = 'Arm_SpitzJumpAir_Up';
const JUMP_LAND_ANIM = 'Arm_SpitzJumpLand_Place';
// Moving jump
const JUMP_START_MOVE_ANIM = 'Arm_SpitzJumpStart_F_IP';
const JUMP_AIR_MOVE_ANIM = 'Arm_SpitzJumpAir_Horiz';
const JUMP_LAND_MOVE_ANIM = 'Arm_SpitzJumpLand_F_IP';
const SCRATCH_ANIM = 'Arm_SpitzScratching';

const SIT_DELAY = 10; // seconds of stillness before sitting
const BLEND_TIME = 0.3; // crossfade duration in seconds
const JUMP_BLEND_TIME = 0.35; // blend duration for jump landing → idle/walk

type SitState = 'idle' | 'sit_start' | 'sit_loop' | 'sit_end' | 'jump_start' | 'jump_air' | 'jump_land' | 'scratch';

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
  const jumpStartActionRef = useRef<THREE.AnimationAction | null>(null);
  const jumpAirActionRef = useRef<THREE.AnimationAction | null>(null);
  const jumpLandActionRef = useRef<THREE.AnimationAction | null>(null);
  const jumpStartMoveActionRef = useRef<THREE.AnimationAction | null>(null);
  const jumpAirMoveActionRef = useRef<THREE.AnimationAction | null>(null);
  const jumpLandMoveActionRef = useRef<THREE.AnimationAction | null>(null);
  const jumpIsMovingRef = useRef(false); // which set is active this jump
  const scratchActionRef = useRef<THREE.AnimationAction | null>(null);
  const sitStateRef = useRef<SitState>('sit_loop');
  const idleTimeRef = useRef(0);
  const scratchTimerRef = useRef(SCRATCH_INTERVAL_MIN + Math.random() * (SCRATCH_INTERVAL_MAX - SCRATCH_INTERVAL_MIN));
  const scratchReturnStateRef = useRef<'idle' | 'sit_loop'>('idle');

  // Screen-space (NDC) position is the source of truth.
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
  const jumpAirTimeRef = useRef(0); // time since entering jump_air, drives the sine arc
  const jumpTotalDurationRef = useRef(1); // air duration for sine arc
  const landingSpeedRef = useRef(1);
  const jumpPhaseBlendRef = useRef(1); // 0→1 crossfade when entering a new jump phase

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
    const jumpStartClip = THREE.AnimationClip.findByName(animations, JUMP_START_ANIM);
    const jumpAirClip = THREE.AnimationClip.findByName(animations, JUMP_AIR_ANIM);
    const jumpLandClip = THREE.AnimationClip.findByName(animations, JUMP_LAND_ANIM);
    const jumpStartMoveClip = THREE.AnimationClip.findByName(animations, JUMP_START_MOVE_ANIM);
    const jumpAirMoveClip = THREE.AnimationClip.findByName(animations, JUMP_AIR_MOVE_ANIM);
    const jumpLandMoveClip = THREE.AnimationClip.findByName(animations, JUMP_LAND_MOVE_ANIM);
    const scratchClip = THREE.AnimationClip.findByName(animations, SCRATCH_ANIM);
    if (!walkClip || !idleClip || !sitStartClip || !sitLoopClip || !sitEndClip || !jumpStartClip || !jumpAirClip || !jumpLandClip || !jumpStartMoveClip || !jumpAirMoveClip || !jumpLandMoveClip || !scratchClip) return;

    const mixer = new THREE.AnimationMixer(scene);

    const idleAction = mixer.clipAction(idleClip);
    idleAction.setEffectiveWeight(0);
    idleAction.play();

    const walkAction = mixer.clipAction(walkClip);
    walkAction.setEffectiveWeight(0);
    walkAction.play();

    const sitStartAction = mixer.clipAction(sitStartClip);
    sitStartAction.setLoop(THREE.LoopOnce, 1);
    sitStartAction.clampWhenFinished = true;

    const sitLoopAction = mixer.clipAction(sitLoopClip);
    sitLoopAction.setEffectiveWeight(1);
    sitLoopAction.play();

    const sitEndAction = mixer.clipAction(sitEndClip);
    sitEndAction.setLoop(THREE.LoopOnce, 1);
    sitEndAction.clampWhenFinished = true;
    sitEndAction.timeScale = 1.5;

    const jumpStartAction = mixer.clipAction(jumpStartClip);
    jumpStartAction.setLoop(THREE.LoopOnce, 1);
    jumpStartAction.clampWhenFinished = true;
    jumpStartAction.timeScale = 1.2;

    const jumpAirAction = mixer.clipAction(jumpAirClip);
    jumpAirAction.setLoop(THREE.LoopRepeat, Infinity);

    const jumpLandAction = mixer.clipAction(jumpLandClip);
    jumpLandAction.setLoop(THREE.LoopOnce, 1);
    jumpLandAction.clampWhenFinished = true;
    jumpLandAction.timeScale = 1.2;

    const jumpStartMoveAction = mixer.clipAction(jumpStartMoveClip);
    jumpStartMoveAction.setLoop(THREE.LoopOnce, 1);
    jumpStartMoveAction.clampWhenFinished = true;
    jumpStartMoveAction.timeScale = 1.2;

    const jumpAirMoveAction = mixer.clipAction(jumpAirMoveClip);
    jumpAirMoveAction.setLoop(THREE.LoopRepeat, Infinity);

    const jumpLandMoveAction = mixer.clipAction(jumpLandMoveClip);
    jumpLandMoveAction.setLoop(THREE.LoopOnce, 1);
    jumpLandMoveAction.clampWhenFinished = true;
    jumpLandMoveAction.timeScale = 1.2;

    // Arc durations set at jump trigger based on standing vs moving

    const scratchAction = mixer.clipAction(scratchClip);
    scratchAction.setLoop(THREE.LoopOnce, 1);
    scratchAction.clampWhenFinished = true;

    const onFinished = (e: { action: THREE.AnimationAction }) => {
      if (e.action === sitStartAction && sitStateRef.current === 'sit_start') {
        sitStateRef.current = 'sit_loop';
      } else if (e.action === sitEndAction && sitStateRef.current === 'sit_end') {
        sitStateRef.current = 'idle';
        animationWeightRef.current = 0;
        idleTimeRef.current = 0;
      } else if ((e.action === jumpStartAction || e.action === jumpStartMoveAction) && sitStateRef.current === 'jump_start') {
        // Takeoff done — switch to airborne
        sitStateRef.current = 'jump_air';
        jumpPhaseBlendRef.current = 0;
        jumpAirTimeRef.current = 0;
        if (jumpIsMovingRef.current) {
          jumpAirMoveAction.reset().play();
        } else {
          jumpAirAction.reset().play();
        }
      } else if (e.action === jumpLandAction && sitStateRef.current === 'jump_land') {
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
    jumpStartActionRef.current = jumpStartAction;
    jumpAirActionRef.current = jumpAirAction;
    jumpLandActionRef.current = jumpLandAction;
    jumpStartMoveActionRef.current = jumpStartMoveAction;
    jumpAirMoveActionRef.current = jumpAirMoveAction;
    jumpLandMoveActionRef.current = jumpLandMoveAction;
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
      jumpStartActionRef.current = null;
      jumpAirActionRef.current = null;
      jumpLandActionRef.current = null;
      jumpStartMoveActionRef.current = null;
      jumpAirMoveActionRef.current = null;
      jumpLandMoveActionRef.current = null;
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
    return () => { window.updateJoystick = undefined; };
  }, []);

  useEffect(() => {
    window.triggerJump = () => { jumpPressedRef.current = true; };
    return () => { window.triggerJump = undefined; };
  }, []);

  useFrame((state, delta) => {
    const cam = state.camera as THREE.PerspectiveCamera;

    // ── 1. Compute NDC boundaries ──────────────────────────────────────────
    _tempVec3.set(0, 0, PLAY_AREA_FAR_Z);
    _tempVec3.project(cam);
    const farNDCY = _tempVec3.y;

    // ── 2. Input ───────────────────────────────────────────────────────────
    const keys = keysPressedRef.current;
    const joystick = joystickRef.current;
    const rawX = (keys.d ? 1 : 0) - (keys.a ? 1 : 0) + joystick.x;
    const rawZ = (keys.s ? 1 : 0) - (keys.w ? 1 : 0) + joystick.y;

    _inputVec2.set(rawX, -rawZ);
    const hasInput = _inputVec2.lengthSq() > 0.01;
    const isAirborne = sitStateRef.current === 'jump_start' || sitStateRef.current === 'jump_air';
    const isLanding = sitStateRef.current === 'jump_land';
    const canMove = hasInput && (sitStateRef.current === 'idle' || isLanding);

    // ── Perspective probes ─────────────────────────────────────────────────
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
      moveSpeedRef.current = Math.min(1, moveSpeedRef.current + delta * 6);
      landingSpeedRef.current = Math.min(1, landingSpeedRef.current + delta * 8);
      const ndcDX = _inputVec2.x * (MOVE_SPEED / Math.max(worldPerNdcX, 0.001)) * delta * moveSpeedRef.current * landingSpeedRef.current;
      const ndcDY = _inputVec2.y * (MOVE_SPEED / Math.max(worldPerNdcY, 0.001)) * delta * moveSpeedRef.current * landingSpeedRef.current;
      ndcPosRef.current.x += ndcDX;
      ndcPosRef.current.y += ndcDY;
      // Update stored direction so airborne momentum reflects latest input
      if (hasInput) _inputVec2.normalize();
      jumpVelocityRef.current.copy(_inputVec2);
    } else if (isAirborne && jumpVelocityRef.current.lengthSq() > 0.00001) {
      // Carry momentum through air at full speed
      landingSpeedRef.current = Math.min(1, landingSpeedRef.current + delta * 8);
      const ndcDX = jumpVelocityRef.current.x * (MOVE_SPEED / Math.max(worldPerNdcX, 0.001)) * delta * moveSpeedRef.current;
      const ndcDY = jumpVelocityRef.current.y * (MOVE_SPEED / Math.max(worldPerNdcY, 0.001)) * delta * moveSpeedRef.current;
      ndcPosRef.current.x += ndcDX;
      ndcPosRef.current.y += ndcDY;
    } else if (!isAirborne && !isLanding) {
      moveSpeedRef.current = 0;
      jumpVelocityRef.current.set(0, 0);
    }

    // ── 3. Clamp NDC ───────────────────────────────────────────────────────
    ndcPosRef.current.x = Math.max(-1 + EDGE_MARGIN, Math.min(1 - EDGE_MARGIN, ndcPosRef.current.x));
    ndcPosRef.current.y = Math.max(-1 + EDGE_MARGIN, Math.min(farNDCY - EDGE_MARGIN, ndcPosRef.current.y));

    // ── 4. Unproject NDC → world ───────────────────────────────────────────
    _raycaster.setFromCamera(ndcPosRef.current, cam);
    if (_raycaster.ray.intersectPlane(_groundPlane, _groundPoint)) {
      _groundPoint.y = 0;
      if (canMove || (isAirborne && jumpVelocityRef.current.lengthSq() > 0.00001)) {
        const dx = _groundPoint.x - worldPosRef.current.x;
        const dz = _groundPoint.z - worldPosRef.current.z;
        if (Math.abs(dx) > 0.0001 || Math.abs(dz) > 0.0001) {
          targetRotationRef.current = Math.atan2(dx, dz);
        }
      }
      worldPosRef.current.copy(_groundPoint);
    }

    // ── 5. Animation ───────────────────────────────────────────────────────
    if (jumpPressedRef.current) {
      jumpPressedRef.current = false;
      if (sitStateRef.current === 'idle') {
        sitStateRef.current = 'jump_start';
        animationWeightRef.current = 0;
        idleTimeRef.current = 0;
        jumpAirTimeRef.current = 0;
        jumpPhaseBlendRef.current = 0;
        jumpIsMovingRef.current = hasInput;
        jumpTotalDurationRef.current = hasInput ? 0.7 : 0.55;
        // Snapshot current input direction as airborne momentum
        if (hasInput) {
          _inputVec2.normalize();
          jumpVelocityRef.current.copy(_inputVec2);
        }
        if (hasInput) {
          jumpStartMoveActionRef.current!.reset().play();
        } else {
          jumpStartActionRef.current!.reset().play();
        }
      }
    }

    currentSpeedRef.current = (canMove || (isAirborne && jumpVelocityRef.current.lengthSq() > 0.00001)) ? MOVE_SPEED : 0;
    const sitState = sitStateRef.current;

    const zeroJumpWeights = () => {
      jumpStartActionRef.current?.setEffectiveWeight(0);
      jumpAirActionRef.current?.setEffectiveWeight(0);
      jumpLandActionRef.current?.setEffectiveWeight(0);
      jumpStartMoveActionRef.current?.setEffectiveWeight(0);
      jumpAirMoveActionRef.current?.setEffectiveWeight(0);
      jumpLandMoveActionRef.current?.setEffectiveWeight(0);
    };
    const isMovingJump = jumpIsMovingRef.current;
    const activeJumpStartRef = isMovingJump ? jumpStartMoveActionRef : jumpStartActionRef;
    const activeJumpAirRef = isMovingJump ? jumpAirMoveActionRef : jumpAirActionRef;
    const activeJumpLandRef = isMovingJump ? jumpLandMoveActionRef : jumpLandActionRef;

    if (sitState === 'idle') {
      sitStartActionRef.current?.setEffectiveWeight(0);
      sitLoopActionRef.current?.setEffectiveWeight(0);
      sitEndActionRef.current?.setEffectiveWeight(0);
      scratchActionRef.current?.setEffectiveWeight(0);
      zeroJumpWeights();

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
      animationWeightRef.current = Math.min(1, animationWeightRef.current + delta / BLEND_TIME);
      walkActionRef.current?.setEffectiveWeight(0);
      idleActionRef.current?.setEffectiveWeight(1 - animationWeightRef.current);
      sitStartActionRef.current?.setEffectiveWeight(animationWeightRef.current);
      sitLoopActionRef.current?.setEffectiveWeight(0);
      sitEndActionRef.current?.setEffectiveWeight(0);
      scratchActionRef.current?.setEffectiveWeight(0);
      zeroJumpWeights();
      if (hasInput) {
        sitStateRef.current = 'sit_end';
        sitEndActionRef.current!.reset().play();
        animationWeightRef.current = 0;
      }
    } else if (sitState === 'sit_loop') {
      if (sitLoopActionRef.current && !sitLoopActionRef.current.isRunning()) {
        sitLoopActionRef.current.reset().play();
      }
      walkActionRef.current?.setEffectiveWeight(0);
      idleActionRef.current?.setEffectiveWeight(0);
      sitStartActionRef.current?.setEffectiveWeight(0);
      sitLoopActionRef.current?.setEffectiveWeight(1);
      sitEndActionRef.current?.setEffectiveWeight(0);
      scratchActionRef.current?.setEffectiveWeight(0);
      zeroJumpWeights();
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
      scratchActionRef.current?.setEffectiveWeight(0);
      zeroJumpWeights();
    } else if (sitState === 'scratch') {
      const scratchAction = scratchActionRef.current;
      const clipDuration = scratchAction ? scratchAction.getClip().duration : 1;
      const scratchProgress = scratchAction ? scratchAction.time / clipDuration : 0;
      const BLEND_OUT_START = 0.55;

      let scratchWeight: number;
      if (scratchProgress < BLEND_OUT_START) {
        animationWeightRef.current = Math.min(1, animationWeightRef.current + delta / BLEND_TIME);
        scratchWeight = animationWeightRef.current;
      } else {
        scratchWeight = 1 - (scratchProgress - BLEND_OUT_START) / (1 - BLEND_OUT_START);
        scratchWeight = Math.max(0, scratchWeight);
      }

      walkActionRef.current?.setEffectiveWeight(0);
      idleActionRef.current?.setEffectiveWeight(0);
      sitStartActionRef.current?.setEffectiveWeight(0);
      sitLoopActionRef.current?.setEffectiveWeight(1 - scratchWeight);
      sitEndActionRef.current?.setEffectiveWeight(0);
      scratchActionRef.current?.setEffectiveWeight(scratchWeight);
      zeroJumpWeights();

      if (hasInput) {
        sitStateRef.current = 'sit_end';
        sitEndActionRef.current!.reset().play();
        scratchTimerRef.current = SCRATCH_INTERVAL_MIN + Math.random() * (SCRATCH_INTERVAL_MAX - SCRATCH_INTERVAL_MIN);
      }
    } else if (sitState === 'jump_start') {
      animationWeightRef.current = Math.min(1, animationWeightRef.current + delta / JUMP_BLEND_TIME);
      walkActionRef.current?.setEffectiveWeight(0);
      idleActionRef.current?.setEffectiveWeight(1 - animationWeightRef.current);
      sitStartActionRef.current?.setEffectiveWeight(0);
      sitLoopActionRef.current?.setEffectiveWeight(0);
      sitEndActionRef.current?.setEffectiveWeight(0);
      scratchActionRef.current?.setEffectiveWeight(0);
      activeJumpStartRef.current?.setEffectiveWeight(animationWeightRef.current);
      activeJumpAirRef.current?.setEffectiveWeight(0);
      activeJumpLandRef.current?.setEffectiveWeight(0);
      // Zero inactive set
      (isMovingJump ? jumpStartActionRef : jumpStartMoveActionRef).current?.setEffectiveWeight(0);
      (isMovingJump ? jumpAirActionRef : jumpAirMoveActionRef).current?.setEffectiveWeight(0);
      (isMovingJump ? jumpLandActionRef : jumpLandMoveActionRef).current?.setEffectiveWeight(0);
      // → jump_air via finished event
    } else if (sitState === 'jump_air') {
      jumpAirTimeRef.current += delta;
      jumpPhaseBlendRef.current = Math.min(1, jumpPhaseBlendRef.current + delta / 0.2);
      const airPhase = jumpPhaseBlendRef.current;
      // Transition to landing after arc completes
      if (jumpAirTimeRef.current >= jumpTotalDurationRef.current) {
        sitStateRef.current = 'jump_land';
        jumpReturnBlendRef.current = 0;
        animationWeightRef.current = 0;
        jumpPhaseBlendRef.current = 0;
        landingSpeedRef.current = 0.3;
        activeJumpLandRef.current!.reset().play();
      }
      walkActionRef.current?.setEffectiveWeight(0);
      idleActionRef.current?.setEffectiveWeight(0);
      sitStartActionRef.current?.setEffectiveWeight(0);
      sitLoopActionRef.current?.setEffectiveWeight(0);
      sitEndActionRef.current?.setEffectiveWeight(0);
      scratchActionRef.current?.setEffectiveWeight(0);
      activeJumpStartRef.current?.setEffectiveWeight(1 - airPhase);
      activeJumpAirRef.current?.setEffectiveWeight(airPhase);
      activeJumpLandRef.current?.setEffectiveWeight(0);
    } else if (sitState === 'jump_land') {
      jumpAirTimeRef.current += delta;
      // Phase blend: air fades out, land fades in
      jumpPhaseBlendRef.current = Math.min(1, jumpPhaseBlendRef.current + delta / 0.2);
      const landPhase = jumpPhaseBlendRef.current;
      // Return blend starts after land clip is mostly visible (70%)
      if (landPhase >= 0.7) {
        jumpReturnBlendRef.current = Math.min(1, jumpReturnBlendRef.current + delta / JUMP_BLEND_TIME);
      }
      const targetWalk = hasInput ? 1 : 0;
      animationWeightRef.current += (targetWalk - animationWeightRef.current) * 5 * delta;
      animationWeightRef.current = Math.max(0, Math.min(1, animationWeightRef.current));
      const returnBlend = jumpReturnBlendRef.current;
      walkActionRef.current?.setEffectiveWeight(returnBlend * animationWeightRef.current);
      idleActionRef.current?.setEffectiveWeight(returnBlend * (1 - animationWeightRef.current));
      sitStartActionRef.current?.setEffectiveWeight(0);
      sitLoopActionRef.current?.setEffectiveWeight(0);
      sitEndActionRef.current?.setEffectiveWeight(0);
      scratchActionRef.current?.setEffectiveWeight(0);
      activeJumpStartRef.current?.setEffectiveWeight(0);
      activeJumpAirRef.current?.setEffectiveWeight(1 - landPhase);
      activeJumpLandRef.current?.setEffectiveWeight(landPhase * (1 - returnBlend));

      if (jumpReturnBlendRef.current >= 1) {
        sitStateRef.current = 'idle';
        idleTimeRef.current = 0;
      }
    }

    mixerRef.current?.update(delta);

    // Cancel XZ root motion. Apply sine arc lift during airborne phases.
    const activeState = sitStateRef.current;
    if (activeState === 'jump_air' || activeState === 'jump_land') {
      const progress = Math.min(1, jumpAirTimeRef.current / jumpTotalDurationRef.current);
      const maxLift = jumpIsMovingRef.current ? 0.3 : 0.25;
      const liftY = maxLift * Math.sin(progress * Math.PI);
      scene.position.x = 0;
      scene.position.z = 0;
      scene.position.y = MODEL_Y_OFFSET + Math.max(0, liftY);
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

      // Tilt nose up during standing jump start to counteract forward lean in animation
      modelRef.current.rotation.order = 'YXZ';
      if (!jumpIsMovingRef.current && activeState === 'jump_air') {
        modelRef.current.rotation.x += (-0.28 - modelRef.current.rotation.x) * 10 * delta;
      } else {
        modelRef.current.rotation.x += (0 - modelRef.current.rotation.x) * 20 * delta;
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
