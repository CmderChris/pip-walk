import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import {
  MODEL_PATH, TEXTURE_BASE,
  WALK_ANIM, IDLE_ANIM,
  SIT_START_ANIM, SIT_LOOP_ANIM, SIT_END_ANIM, SCRATCH_ANIM,
  JUMP_START_ANIM, JUMP_AIR_ANIM, JUMP_LAND_ANIM,
  JUMP_START_MOVE_ANIM, JUMP_AIR_MOVE_ANIM, JUMP_LAND_MOVE_ANIM,
  SIT_DELAY, BLEND_TIME, JUMP_BLEND_TIME,
  SCRATCH_INTERVAL_MIN, SCRATCH_INTERVAL_MAX,
  MOVE_SPEED, MODEL_Y_OFFSET, ROTATION_SPEED, MIN_SPEED_FOR_WALK,
  EDGE_MARGIN, PLAY_AREA_FAR_Z,
  type SitState,
} from './modelConfig';
import { setWeights, type AnimationActions } from './animationHelpers';

// Pre-allocated — never created per frame
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

  // ── Action refs ────────────────────────────────────────────────────────────
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<AnimationActions>({
    walk: null, idle: null,
    sitStart: null, sitLoop: null, sitEnd: null,
    jumpStart: null, jumpAir: null, jumpLand: null,
    jumpStartMove: null, jumpAirMove: null, jumpLandMove: null,
    scratch: null,
  });

  // ── State refs ─────────────────────────────────────────────────────────────
  const sitStateRef = useRef<SitState>('sit_loop');
  const idleTimeRef = useRef(0);
  const animationWeightRef = useRef(0);
  const scratchTimerRef = useRef(
    SCRATCH_INTERVAL_MIN + Math.random() * (SCRATCH_INTERVAL_MAX - SCRATCH_INTERVAL_MIN)
  );

  // ── Movement refs ──────────────────────────────────────────────────────────
  const ndcPosRef = useRef(new THREE.Vector2(0, -0.5));
  const worldPosRef = useRef(new THREE.Vector3(0, 0, 0));
  const currentSpeedRef = useRef(0);
  const targetRotationRef = useRef(0);
  const moveSpeedRef = useRef(0);
  const landingSpeedRef = useRef(1);

  // ── Input refs ─────────────────────────────────────────────────────────────
  const keysPressedRef = useRef({ w: false, a: false, s: false, d: false });
  const joystickRef = useRef({ x: 0, y: 0 });
  const jumpPressedRef = useRef(false);

  // ── Jump refs ──────────────────────────────────────────────────────────────
  const jumpReturnBlendRef = useRef(0);
  const jumpVelocityRef = useRef(new THREE.Vector2(0, 0));
  const jumpAirTimeRef = useRef(0);
  const jumpTotalDurationRef = useRef(1);
  const jumpPhaseBlendRef = useRef(1);
  const jumpIsMovingRef = useRef(false);

  // ── Texture setup ──────────────────────────────────────────────────────────
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

  // ── Animation setup ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!scene || animations.length === 0) return;

    const find = (name: string) => THREE.AnimationClip.findByName(animations, name);
    const walkClip       = find(WALK_ANIM);
    const idleClip       = find(IDLE_ANIM);
    const sitStartClip   = find(SIT_START_ANIM);
    const sitLoopClip    = find(SIT_LOOP_ANIM);
    const sitEndClip     = find(SIT_END_ANIM);
    const jumpStartClip  = find(JUMP_START_ANIM);
    const jumpAirClip    = find(JUMP_AIR_ANIM);
    const jumpLandClip   = find(JUMP_LAND_ANIM);
    const jumpStartMoveClip = find(JUMP_START_MOVE_ANIM);
    const jumpAirMoveClip   = find(JUMP_AIR_MOVE_ANIM);
    const jumpLandMoveClip  = find(JUMP_LAND_MOVE_ANIM);
    const scratchClip    = find(SCRATCH_ANIM);

    if (!walkClip || !idleClip || !sitStartClip || !sitLoopClip || !sitEndClip ||
        !jumpStartClip || !jumpAirClip || !jumpLandClip ||
        !jumpStartMoveClip || !jumpAirMoveClip || !jumpLandMoveClip || !scratchClip) return;

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

    const scratchAction = mixer.clipAction(scratchClip);
    scratchAction.setLoop(THREE.LoopOnce, 1);
    scratchAction.clampWhenFinished = true;

    const onFinished = (e: { action: THREE.AnimationAction }) => {
      const a = actionsRef.current;
      if (e.action === a.sitStart && sitStateRef.current === 'sit_start') {
        sitStateRef.current = 'sit_loop';
      } else if (e.action === a.sitEnd && sitStateRef.current === 'sit_end') {
        sitStateRef.current = 'idle';
        animationWeightRef.current = 0;
        idleTimeRef.current = 0;
      } else if ((e.action === a.jumpStart || e.action === a.jumpStartMove) && sitStateRef.current === 'jump_start') {
        sitStateRef.current = 'jump_air';
        jumpPhaseBlendRef.current = 0;
        jumpAirTimeRef.current = 0;
        if (jumpIsMovingRef.current) {
          a.jumpAirMove?.reset().play();
        } else {
          a.jumpAir?.reset().play();
        }
      } else if (e.action === a.jumpLand && sitStateRef.current === 'jump_land') {
        landingSpeedRef.current = 0.4;
      } else if (e.action === a.scratch && sitStateRef.current === 'scratch') {
        sitStateRef.current = 'sit_loop';
        scratchTimerRef.current = SCRATCH_INTERVAL_MIN + Math.random() * (SCRATCH_INTERVAL_MAX - SCRATCH_INTERVAL_MIN);
      }
    };
    mixer.addEventListener('finished', onFinished);

    mixerRef.current = mixer;
    actionsRef.current = {
      walk: walkAction, idle: idleAction,
      sitStart: sitStartAction, sitLoop: sitLoopAction, sitEnd: sitEndAction,
      jumpStart: jumpStartAction, jumpAir: jumpAirAction, jumpLand: jumpLandAction,
      jumpStartMove: jumpStartMoveAction, jumpAirMove: jumpAirMoveAction, jumpLandMove: jumpLandMoveAction,
      scratch: scratchAction,
    };

    return () => {
      mixer.removeEventListener('finished', onFinished);
      mixer.stopAllAction();
      mixerRef.current = null;
      actionsRef.current = {
        walk: null, idle: null,
        sitStart: null, sitLoop: null, sitEnd: null,
        jumpStart: null, jumpAir: null, jumpLand: null,
        jumpStartMove: null, jumpAirMove: null, jumpLandMove: null,
        scratch: null,
      };
      sitStateRef.current = 'idle';
      idleTimeRef.current = 0;
    };
  }, [scene, animations]);

  // ── Input listeners ────────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w' || key === 'arrowup')    keysPressedRef.current.w = true;
      if (key === 'a' || key === 'arrowleft')  keysPressedRef.current.a = true;
      if (key === 's' || key === 'arrowdown')  keysPressedRef.current.s = true;
      if (key === 'd' || key === 'arrowright') keysPressedRef.current.d = true;
      if (e.key === ' ') { e.preventDefault(); jumpPressedRef.current = true; }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w' || key === 'arrowup')    keysPressedRef.current.w = false;
      if (key === 'a' || key === 'arrowleft')  keysPressedRef.current.a = false;
      if (key === 's' || key === 'arrowdown')  keysPressedRef.current.s = false;
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
    window.updateJoystick = (x: number, y: number) => { joystickRef.current = { x, y }; };
    return () => { window.updateJoystick = undefined; };
  }, []);

  useEffect(() => {
    window.triggerJump = () => { jumpPressedRef.current = true; };
    return () => { window.triggerJump = undefined; };
  }, []);

  // ── Frame loop ─────────────────────────────────────────────────────────────
  useFrame((state, delta) => {
    const cam = state.camera as THREE.PerspectiveCamera;
    const a = actionsRef.current;

    // 1. NDC boundary for far edge of play area
    _tempVec3.set(0, 0, PLAY_AREA_FAR_Z);
    _tempVec3.project(cam);
    const farNDCY = _tempVec3.y;

    // 2. Input
    const keys = keysPressedRef.current;
    const joystick = joystickRef.current;
    _inputVec2.set(
      (keys.d ? 1 : 0) - (keys.a ? 1 : 0) + joystick.x,
      -((keys.s ? 1 : 0) - (keys.w ? 1 : 0) + joystick.y)
    );
    const hasInput = _inputVec2.lengthSq() > 0.01;
    const isAirborne = sitStateRef.current === 'jump_start' || sitStateRef.current === 'jump_air';
    const isLanding = sitStateRef.current === 'jump_land';
    const canMove = hasInput && (sitStateRef.current === 'idle' || isLanding);

    // 3. Perspective probes — world-units-per-NDC at current position
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

    // 4. Movement
    if (canMove) {
      _inputVec2.normalize();
      moveSpeedRef.current = Math.min(1, moveSpeedRef.current + delta * 6);
      landingSpeedRef.current = Math.min(1, landingSpeedRef.current + delta * 8);
      const spd = MOVE_SPEED * delta * moveSpeedRef.current * landingSpeedRef.current;
      ndcPosRef.current.x += _inputVec2.x * (spd / Math.max(worldPerNdcX, 0.001));
      ndcPosRef.current.y += _inputVec2.y * (spd / Math.max(worldPerNdcY, 0.001));
      jumpVelocityRef.current.copy(_inputVec2);
    } else if (isAirborne && jumpVelocityRef.current.lengthSq() > 0.00001) {
      const spd = MOVE_SPEED * delta * moveSpeedRef.current;
      ndcPosRef.current.x += jumpVelocityRef.current.x * (spd / Math.max(worldPerNdcX, 0.001));
      ndcPosRef.current.y += jumpVelocityRef.current.y * (spd / Math.max(worldPerNdcY, 0.001));
    } else if (!isAirborne && !isLanding) {
      moveSpeedRef.current = 0;
      jumpVelocityRef.current.set(0, 0);
    }

    // 5. Clamp NDC to play area
    ndcPosRef.current.x = Math.max(-1 + EDGE_MARGIN, Math.min(1 - EDGE_MARGIN, ndcPosRef.current.x));
    ndcPosRef.current.y = Math.max(-1 + EDGE_MARGIN, Math.min(farNDCY - EDGE_MARGIN, ndcPosRef.current.y));

    // 6. Unproject NDC → world position
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

    // 7. Jump trigger
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
        if (hasInput) {
          _inputVec2.normalize();
          jumpVelocityRef.current.copy(_inputVec2);
          a.jumpStartMove?.reset().play();
        } else {
          a.jumpStart?.reset().play();
        }
      }
    }

    currentSpeedRef.current = (canMove || (isAirborne && jumpVelocityRef.current.lengthSq() > 0.00001))
      ? MOVE_SPEED : 0;

    const sitState = sitStateRef.current;
    const isMovingJump = jumpIsMovingRef.current;
    const activeLand  = isMovingJump ? a.jumpLandMove  : a.jumpLand;

    // 8. Animation state machine
    if (sitState === 'idle') {
      const targetWalk = canMove ? 1 : 0;
      animationWeightRef.current += (targetWalk - animationWeightRef.current) * 5 * delta;
      animationWeightRef.current = Math.max(0, Math.min(1, animationWeightRef.current));
      setWeights(a, { walk: animationWeightRef.current, idle: 1 - animationWeightRef.current });

      if (!hasInput) {
        idleTimeRef.current += delta;
        if (idleTimeRef.current >= SIT_DELAY) {
          sitStateRef.current = 'sit_start';
          idleTimeRef.current = 0;
          a.sitStart?.reset().play();
        }
      } else {
        idleTimeRef.current = 0;
      }
    } else if (sitState === 'sit_start') {
      animationWeightRef.current = Math.min(1, animationWeightRef.current + delta / BLEND_TIME);
      setWeights(a, { idle: 1 - animationWeightRef.current, sitStart: animationWeightRef.current });
      if (hasInput) {
        sitStateRef.current = 'sit_end';
        a.sitEnd?.reset().play();
        animationWeightRef.current = 0;
      }
    } else if (sitState === 'sit_loop') {
      if (a.sitLoop && !a.sitLoop.isRunning()) a.sitLoop.reset().play();
      setWeights(a, { sitLoop: 1 });
      if (hasInput) {
        sitStateRef.current = 'sit_end';
        a.sitEnd?.reset().play();
      } else {
        scratchTimerRef.current -= delta;
        if (scratchTimerRef.current <= 0) {
          sitStateRef.current = 'scratch';
          animationWeightRef.current = 0;
          a.scratch?.reset().play();
        }
      }
    } else if (sitState === 'sit_end') {
      setWeights(a, { sitEnd: 1 });
    } else if (sitState === 'scratch') {
      const clipDuration = a.scratch ? a.scratch.getClip().duration : 1;
      const scratchProgress = a.scratch ? a.scratch.time / clipDuration : 0;
      const BLEND_OUT_START = 0.55;
      let scratchWeight: number;
      if (scratchProgress < BLEND_OUT_START) {
        animationWeightRef.current = Math.min(1, animationWeightRef.current + delta / BLEND_TIME);
        scratchWeight = animationWeightRef.current;
      } else {
        scratchWeight = Math.max(0, 1 - (scratchProgress - BLEND_OUT_START) / (1 - BLEND_OUT_START));
      }
      setWeights(a, { sitLoop: 1 - scratchWeight, scratch: scratchWeight });
      if (hasInput) {
        sitStateRef.current = 'sit_end';
        a.sitEnd?.reset().play();
        scratchTimerRef.current = SCRATCH_INTERVAL_MIN + Math.random() * (SCRATCH_INTERVAL_MAX - SCRATCH_INTERVAL_MIN);
      }
    } else if (sitState === 'jump_start') {
      animationWeightRef.current = Math.min(1, animationWeightRef.current + delta / JUMP_BLEND_TIME);
      setWeights(a, {
        idle: 1 - animationWeightRef.current,
        [isMovingJump ? 'jumpStartMove' : 'jumpStart']: animationWeightRef.current,
      });
    } else if (sitState === 'jump_air') {
      jumpAirTimeRef.current += delta;
      jumpPhaseBlendRef.current = Math.min(1, jumpPhaseBlendRef.current + delta / 0.2);
      const airPhase = jumpPhaseBlendRef.current;
      if (jumpAirTimeRef.current >= jumpTotalDurationRef.current) {
        sitStateRef.current = 'jump_land';
        jumpReturnBlendRef.current = 0;
        animationWeightRef.current = 0;
        jumpPhaseBlendRef.current = 0;
        landingSpeedRef.current = 0.3;
        activeLand?.reset().play();
      }
      setWeights(a, {
        [isMovingJump ? 'jumpStartMove' : 'jumpStart']: 1 - airPhase,
        [isMovingJump ? 'jumpAirMove'   : 'jumpAir']:   airPhase,
      });
    } else if (sitState === 'jump_land') {
      jumpAirTimeRef.current += delta;
      jumpPhaseBlendRef.current = Math.min(1, jumpPhaseBlendRef.current + delta / 0.2);
      const landPhase = jumpPhaseBlendRef.current;
      if (landPhase >= 0.7) {
        jumpReturnBlendRef.current = Math.min(1, jumpReturnBlendRef.current + delta / JUMP_BLEND_TIME);
      }
      const targetWalk = hasInput ? 1 : 0;
      animationWeightRef.current += (targetWalk - animationWeightRef.current) * 5 * delta;
      animationWeightRef.current = Math.max(0, Math.min(1, animationWeightRef.current));
      const returnBlend = jumpReturnBlendRef.current;
      setWeights(a, {
        walk: returnBlend * animationWeightRef.current,
        idle: returnBlend * (1 - animationWeightRef.current),
        [isMovingJump ? 'jumpAirMove'  : 'jumpAir']:  1 - landPhase,
        [isMovingJump ? 'jumpLandMove' : 'jumpLand']: landPhase * (1 - returnBlend),
      });
      if (jumpReturnBlendRef.current >= 1) {
        sitStateRef.current = 'idle';
        idleTimeRef.current = 0;
      }
    }

    mixerRef.current?.update(delta);

    // 9. Cancel root motion XZ; apply sine arc lift during airborne phases
    const activeState = sitStateRef.current;
    if (activeState === 'jump_air' || activeState === 'jump_land') {
      const progress = Math.min(1, jumpAirTimeRef.current / jumpTotalDurationRef.current);
      const maxLift = jumpIsMovingRef.current ? 0.3 : 0.25;
      scene.position.set(0, MODEL_Y_OFFSET + Math.max(0, maxLift * Math.sin(progress * Math.PI)), 0);
    } else {
      scene.position.set(0, MODEL_Y_OFFSET, 0);
    }

    // 10. Apply world position and rotation to mesh
    if (modelRef.current) {
      modelRef.current.position.copy(worldPosRef.current);

      if (currentSpeedRef.current > MIN_SPEED_FOR_WALK) {
        const currentRotation = modelRef.current.rotation.y;
        let shortest = ((targetRotationRef.current - currentRotation + Math.PI) % (Math.PI * 2)) - Math.PI;
        if (shortest < -Math.PI) shortest += Math.PI * 2;
        modelRef.current.rotation.y += shortest * ROTATION_SPEED * delta;
      }

      // Tilt nose up during standing jump air phase to counteract forward lean
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
