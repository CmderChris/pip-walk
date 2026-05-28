import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import {
  MODEL_PATH, TEXTURE_BASE,
  WALK_ANIM, IDLE_ANIM,
  SIT_START_ANIM, SIT_IDLE_ANIM, SIT_LOOP2_ANIM, SIT_END_ANIM, SCRATCH_ANIM, PET_STAND_ANIM,
  JUMP_START_ANIM, JUMP_AIR_ANIM, JUMP_LAND_ANIM,
  JUMP_START_MOVE_ANIM, JUMP_AIR_MOVE_ANIM, JUMP_LAND_MOVE_ANIM,
  SIT_DELAY, BLEND_TIME, JUMP_BLEND_TIME,
  SIT_LOOP2_INTERVAL_MIN, SIT_LOOP2_INTERVAL_MAX,
  MOVE_SPEED, MODEL_Y_OFFSET, ROTATION_SPEED, MIN_SPEED_FOR_WALK,
  EDGE_MARGIN, PLAY_AREA_FAR_Z,
  type SitState,
} from './modelConfig';
import { setWeights, type AnimationActions } from './animationHelpers';

import { modelWorldPos, modelSitAmountRef, modelForwardRef, modelPawPositions } from './modelState';

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
  const shadowLightRef = useRef<THREE.DirectionalLight>(null!);
  const { camera, gl, scene: threeScene } = useThree();


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
    sitStart: null, sitIdle: null, sitEnd: null,
    jumpStart: null, jumpAir: null, jumpLand: null,
    jumpStartMove: null, jumpAirMove: null, jumpLandMove: null,
    scratch: null, sitLoop2: null, petStand: null,
  });

  // ── State refs ─────────────────────────────────────────────────────────────
  const sitStateRef = useRef<SitState>('sit_loop');
  const idleTimeRef = useRef(0);
  const animationWeightRef = useRef(0);
  const sitLoop2TimerRef = useRef(
    SIT_LOOP2_INTERVAL_MIN + Math.random() * (SIT_LOOP2_INTERVAL_MAX - SIT_LOOP2_INTERVAL_MIN)
  );

  // ── Movement refs ──────────────────────────────────────────────────────────
  const ndcPosRef = useRef(new THREE.Vector2(0, -0.3));
  const worldPosRef = useRef(new THREE.Vector3(0, 0, 0));
  const positionInitializedRef = useRef(false);
  const currentSpeedRef = useRef(0);
  const targetRotationRef = useRef(0);
  const moveSpeedRef = useRef(0);
  const landingSpeedRef = useRef(1);

  // ── Paw bone refs (front-left, front-right only — back paws handled by body sit zone) ──
  const pawBonesRef = useRef<(THREE.Bone | null)[]>([null, null]);

  // ── Input refs ─────────────────────────────────────────────────────────────
  const keysPressedRef = useRef({ w: false, a: false, s: false, d: false });
  const joystickRef = useRef({ x: 0, y: 0 });
  const jumpPressedRef = useRef(false);

  const jumpLiftRef = useRef(0);
  const jumpStartLiftCurveRef = useRef<Float32Array | null>(null);
  const jumpStartMoveLiftCurveRef = useRef<Float32Array | null>(null);

  // ── Jump refs ──────────────────────────────────────────────────────────────
  const petTriggeredRef = useRef(false);

  const jumpReturnBlendRef = useRef(0);
  const jumpVelocityRef = useRef(new THREE.Vector2(0, 0));
  const jumpAirTimeRef = useRef(0);
  const jumpTotalDurationRef = useRef(1);
  const jumpPhaseBlendRef = useRef(1);
  const jumpIsMovingRef = useRef(false);

  // ── Texture setup ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!scene) return;
    // Find the front two foot bones for grass paw interaction (back paws covered by body zone)
    const pawNames = ['foot_fL_028', 'foot_fR_034'];
    scene.traverse((obj) => {
      if (obj instanceof THREE.Bone) {
        const idx = pawNames.indexOf(obj.name);
        if (idx !== -1) pawBonesRef.current[idx] = obj;
      }
    });
    albedo.colorSpace = THREE.SRGBColorSpace;
    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      obj.frustumCulled = false; // required for skinned mesh raycasting
      obj.castShadow = true;
      // Expand bounding sphere to cover all animation poses so shadow-pass
      // frustum culling never clips animated extremities (e.g. hind paws).
      obj.geometry.computeBoundingSphere();
      if (obj.geometry.boundingSphere) {
        obj.geometry.boundingSphere.radius *= 2.0;
      }
      const mat = obj.material as THREE.MeshStandardMaterial;
      mat.map = albedo;
      mat.normalMap = normal;
      mat.roughnessMap = roughness;
      mat.aoMap = ao;
      mat.needsUpdate = true;
    });
  }, [scene, albedo, normal, roughness, ao]);

  // ── Add shadow light target to scene graph ────────────────────────────────
  useEffect(() => {
    const light = shadowLightRef.current;
    if (!light) return;
    threeScene.add(light.target);
    return () => { threeScene.remove(light.target); };
  }, [threeScene]);

  // ── Animation setup ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!scene || animations.length === 0) return;

    const find = (name: string) => THREE.AnimationClip.findByName(animations, name);
    const walkClip       = find(WALK_ANIM);
    const idleClip       = find(IDLE_ANIM);
    const sitStartClip   = find(SIT_START_ANIM);
    const sitIdleClip    = find(SIT_IDLE_ANIM);
    const sitEndClip     = find(SIT_END_ANIM);
    const jumpStartClip  = find(JUMP_START_ANIM);
    const jumpAirClip    = find(JUMP_AIR_ANIM);
    const jumpLandClip   = find(JUMP_LAND_ANIM);
    const jumpStartMoveClip = find(JUMP_START_MOVE_ANIM);
    const jumpAirMoveClip   = find(JUMP_AIR_MOVE_ANIM);
    const jumpLandMoveClip  = find(JUMP_LAND_MOVE_ANIM);
    const scratchClip    = find(SCRATCH_ANIM);
    const sitLoop2Clip   = find(SIT_LOOP2_ANIM);
    const petStandClip   = find(PET_STAND_ANIM);

    if (!walkClip || !idleClip || !sitStartClip || !sitIdleClip || !sitEndClip ||
        !jumpStartClip || !jumpAirClip || !jumpLandClip ||
        !jumpStartMoveClip || !jumpAirMoveClip || !jumpLandMoveClip ||
        !scratchClip || !sitLoop2Clip || !petStandClip) return;

    // Pre-sample jump start clips to build a per-frame lift correction curve
    const TOE_OFFSET = 0.08;
    const SAMPLES = 60;
    const buildLiftCurve = (clip: THREE.AnimationClip): Float32Array => {
      const tmpMixer = new THREE.AnimationMixer(scene);
      const action = tmpMixer.clipAction(clip);
      action.play();
      const curve = new Float32Array(SAMPLES);
      for (let i = 0; i < SAMPLES; i++) {
        const t = (i / (SAMPLES - 1)) * clip.duration;
        tmpMixer.setTime(t);
        scene.updateMatrixWorld(true);
        let minY = Infinity;
        scene.traverse((obj) => {
          if (obj instanceof THREE.Bone) {
            _tempVec3.setFromMatrixPosition(obj.matrixWorld);
            if (_tempVec3.y < minY) minY = _tempVec3.y;
          }
        });
        curve[i] = minY < TOE_OFFSET ? TOE_OFFSET - minY : 0;
      }
      tmpMixer.stopAllAction();
      // Reset scene position after sampling
      scene.position.set(0, MODEL_Y_OFFSET, 0);
      return curve;
    };
    jumpStartLiftCurveRef.current = buildLiftCurve(jumpStartClip);
    jumpStartMoveLiftCurveRef.current = buildLiftCurve(jumpStartMoveClip);

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

    const sitIdleAction = mixer.clipAction(sitIdleClip);
    sitIdleAction.setEffectiveWeight(1);
    sitIdleAction.play();

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

    const sitLoop2Action = mixer.clipAction(sitLoop2Clip);
    sitLoop2Action.setLoop(THREE.LoopOnce, 1);
    sitLoop2Action.clampWhenFinished = true;

    const petStandAction = mixer.clipAction(petStandClip);
    petStandAction.setLoop(THREE.LoopOnce, 1);
    petStandAction.clampWhenFinished = true;
    petStandAction.timeScale = 1.5;

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
      } else if (e.action === a.sitLoop2 && sitStateRef.current === 'sit_loop2') {
        sitStateRef.current = 'sit_loop';
        sitLoop2TimerRef.current = SIT_LOOP2_INTERVAL_MIN + Math.random() * (SIT_LOOP2_INTERVAL_MAX - SIT_LOOP2_INTERVAL_MIN);
      } else if (e.action === a.petStand && sitStateRef.current === 'pet') {
        sitStateRef.current = 'idle';
        animationWeightRef.current = 0;
        idleTimeRef.current = 0;
      }
    };
    mixer.addEventListener('finished', onFinished);

    mixerRef.current = mixer;
    actionsRef.current = {
      walk: walkAction, idle: idleAction,
      sitStart: sitStartAction, sitIdle: sitIdleAction, sitEnd: sitEndAction,
      jumpStart: jumpStartAction, jumpAir: jumpAirAction, jumpLand: jumpLandAction,
      jumpStartMove: jumpStartMoveAction, jumpAirMove: jumpAirMoveAction, jumpLandMove: jumpLandMoveAction,
      scratch: scratchAction, sitLoop2: sitLoop2Action, petStand: petStandAction,
    };

    return () => {
      mixer.removeEventListener('finished', onFinished);
      mixer.stopAllAction();
      mixerRef.current = null;
      actionsRef.current = {
        walk: null, idle: null,
        sitStart: null, sitIdle: null, sitEnd: null,
        jumpStart: null, jumpAir: null, jumpLand: null,
        jumpStartMove: null, jumpAirMove: null, jumpLandMove: null,
        scratch: null, sitLoop2: null, petStand: null,
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

  // Click / tap to pet the model
  useEffect(() => {
    const pettableStates: SitState[] = ['idle', 'sit_loop'];
    const handleInteract = (clientX: number, clientY: number) => {
      if (!modelRef.current) return;
      const canvas = gl.domElement;
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObject(modelRef.current, true);
      if (hits.length > 0 && pettableStates.includes(sitStateRef.current)) {
        petTriggeredRef.current = true;
      }
    };
    const onMouseUp = (e: MouseEvent) => handleInteract(e.clientX, e.clientY);
    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (t) handleInteract(t.clientX, t.clientY);
    };
    gl.domElement.addEventListener('mouseup', onMouseUp);
    gl.domElement.addEventListener('touchend', onTouchEnd);
    return () => {
      gl.domElement.removeEventListener('mouseup', onMouseUp);
      gl.domElement.removeEventListener('touchend', onTouchEnd);
    };
  }, [camera, gl]);

  // ── Frame loop ─────────────────────────────────────────────────────────────
  useFrame((state, delta) => {
    const cam = state.camera as THREE.PerspectiveCamera;
    const a = actionsRef.current;

    // 0. One-time sync: unproject the initial NDC position so worldPosRef matches
    //    where the model actually appears on screen from frame one.
    //    Without this, worldPosRef starts at (0,0,0) while ndcPosRef is (0,-0.3),
    //    causing a teleport on the first move.
    if (!positionInitializedRef.current) {
      positionInitializedRef.current = true;
      _raycaster.setFromCamera(ndcPosRef.current, cam);
      if (_raycaster.ray.intersectPlane(_groundPlane, _groundPoint)) {
        _groundPoint.y = 0;
        worldPosRef.current.copy(_groundPoint);
      }
    }

    // 1. Input
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
    const hasJumpVelocity = jumpVelocityRef.current.lengthSq() > 0.00001;

    // 2–6. Position — all raycasts skipped when model is stationary.
    // The NDC boundary projection, 3 perspective probes, and world unproject
    // are only needed when the model is actually moving.
    if (canMove || (isAirborne && hasJumpVelocity)) {
      // NDC boundary for far edge (only needed for clamping)
      _tempVec3.set(0, 0, PLAY_AREA_FAR_Z);
      _tempVec3.project(cam);
      const farNDCY = _tempVec3.y;

      // Perspective probes — world-units-per-NDC at current position
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
        const spd = MOVE_SPEED * delta * moveSpeedRef.current * landingSpeedRef.current;
        ndcPosRef.current.x += _inputVec2.x * (spd / Math.max(worldPerNdcX, 0.001));
        ndcPosRef.current.y += _inputVec2.y * (spd / Math.max(worldPerNdcY, 0.001));
        jumpVelocityRef.current.copy(_inputVec2);
      } else {
        const spd = MOVE_SPEED * delta * moveSpeedRef.current;
        ndcPosRef.current.x += jumpVelocityRef.current.x * (spd / Math.max(worldPerNdcX, 0.001));
        ndcPosRef.current.y += jumpVelocityRef.current.y * (spd / Math.max(worldPerNdcY, 0.001));
      }

      // Clamp NDC to play area
      ndcPosRef.current.x = Math.max(-1 + EDGE_MARGIN, Math.min(1 - EDGE_MARGIN, ndcPosRef.current.x));
      ndcPosRef.current.y = Math.max(-1 + EDGE_MARGIN, Math.min(farNDCY - EDGE_MARGIN, ndcPosRef.current.y));

      // Unproject NDC → world position
      _raycaster.setFromCamera(ndcPosRef.current, cam);
      if (_raycaster.ray.intersectPlane(_groundPlane, _groundPoint)) {
        _groundPoint.y = 0;
        const dx = _groundPoint.x - worldPosRef.current.x;
        const dz = _groundPoint.z - worldPosRef.current.z;
        if (Math.abs(dx) > 0.0001 || Math.abs(dz) > 0.0001) {
          targetRotationRef.current = Math.atan2(dx, dz);
        }
        worldPosRef.current.copy(_groundPoint);
      }
    } else if (!isAirborne && !isLanding) {
      moveSpeedRef.current = 0;
      jumpVelocityRef.current.set(0, 0);
    }

    // 7. Pet / scratch trigger
    if (petTriggeredRef.current) {
      petTriggeredRef.current = false;
      if (sitStateRef.current === 'idle') {
        sitStateRef.current = 'pet';
        animationWeightRef.current = 0;
        idleTimeRef.current = 0;
        a.petStand?.reset().play();
      } else if (sitStateRef.current === 'sit_loop') {
        sitStateRef.current = 'scratch';
        animationWeightRef.current = 0;
        a.scratch?.reset().play();
      }
    }

    // 8. Jump trigger
    if (jumpPressedRef.current) {
      jumpPressedRef.current = false;
      if (sitStateRef.current === 'idle') {
        sitStateRef.current = 'jump_start';
        jumpLiftRef.current = 0.4;
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
      setWeights(a, { sitIdle: 1 });
      if (hasInput) {
        sitStateRef.current = 'sit_end';
        a.sitEnd?.reset().play();
      } else {
        sitLoop2TimerRef.current -= delta;
        if (sitLoop2TimerRef.current <= 0) {
          sitStateRef.current = 'sit_loop2';
          animationWeightRef.current = 0;
          a.sitLoop2?.reset().play();
        }
      }
    } else if (sitState === 'sit_loop2') {
      const clipDuration = a.sitLoop2 ? a.sitLoop2.getClip().duration : 1;
      const progress = a.sitLoop2 ? a.sitLoop2.time / clipDuration : 0;
      const BLEND_OUT_START = 0.55;
      let w: number;
      if (progress < BLEND_OUT_START) {
        animationWeightRef.current = Math.min(1, animationWeightRef.current + delta / BLEND_TIME);
        w = animationWeightRef.current;
      } else {
        w = Math.max(0, 1 - (progress - BLEND_OUT_START) / (1 - BLEND_OUT_START));
      }
      setWeights(a, { sitIdle: 1 - w, sitLoop2: w });
      if (hasInput) {
        sitStateRef.current = 'sit_end';
        a.sitEnd?.reset().play();
        sitLoop2TimerRef.current = SIT_LOOP2_INTERVAL_MIN + Math.random() * (SIT_LOOP2_INTERVAL_MAX - SIT_LOOP2_INTERVAL_MIN);
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
      setWeights(a, { sitIdle: 1 - scratchWeight, scratch: scratchWeight });
      if (hasInput) {
        sitStateRef.current = 'sit_end';
        a.sitEnd?.reset().play();
      }
    } else if (sitState === 'pet') {
      animationWeightRef.current = Math.min(1, animationWeightRef.current + delta / BLEND_TIME);
      setWeights(a, { idle: 1 - animationWeightRef.current, petStand: animationWeightRef.current });
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
    // Update front paw world positions for grass interaction
    for (let i = 0; i < 2; i++) {
      const bone = pawBonesRef.current[i];
      if (bone) bone.getWorldPosition(modelPawPositions[i]);
    }

    // 9. Cancel root motion XZ; apply sine arc lift during airborne phases
    const activeState = sitStateRef.current;
    if (activeState === 'jump_air' || activeState === 'jump_land') {
      const progress = Math.min(1, jumpAirTimeRef.current / jumpTotalDurationRef.current);
      const maxLift = jumpIsMovingRef.current ? 0.3 : 0.25;
      const arcLift = Math.max(0, maxLift * Math.sin(progress * Math.PI));
      // Exponentially decay residual lift from jump_start
      jumpLiftRef.current *= Math.exp(-delta * 15);
      scene.position.set(0, MODEL_Y_OFFSET + arcLift + jumpLiftRef.current, 0);
    } else if (activeState === 'jump_start') {
      const curve = jumpIsMovingRef.current ? jumpStartMoveLiftCurveRef.current : jumpStartLiftCurveRef.current;
      const action = jumpIsMovingRef.current ? actionsRef.current.jumpStartMove : actionsRef.current.jumpStart;
      if (curve && action) {
        const progress = Math.min(1, action.time / action.getClip().duration);
        const idx = Math.min(curve.length - 1, Math.floor(progress * curve.length));
        scene.position.set(0, MODEL_Y_OFFSET + curve[idx], 0);
      } else {
        scene.position.set(0, MODEL_Y_OFFSET, 0);
      }
    } else {
      jumpLiftRef.current = 0;
      scene.position.set(0, MODEL_Y_OFFSET, 0);
    }

    // 10. Fixed sun position — shadow angle/length changes as model moves
    if (shadowLightRef.current) {
      shadowLightRef.current.position.set(0, 35, -60);
      shadowLightRef.current.target.position.copy(worldPosRef.current);
      shadowLightRef.current.target.updateMatrixWorld();
      shadowLightRef.current.shadow.needsUpdate = sitStateRef.current !== 'sit_loop';
    }

    // 11. Apply world position and rotation to mesh
    if (modelRef.current) {
      modelRef.current.position.copy(worldPosRef.current);
      modelWorldPos.copy(worldPosRef.current);
      const s = sitStateRef.current;
      modelSitAmountRef.value = (s === 'sit_loop' || s === 'sit_loop2' || s === 'sit_start' || s === 'scratch') ? 1 : 0;
      const ry = modelRef.current.rotation.y;
      modelForwardRef.value.set(Math.sin(ry), Math.cos(ry));

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
    <>
      <directionalLight
        ref={shadowLightRef}
        intensity={1.5}
        castShadow={false} /* disabled — nothing visible receives this shadow; re-enable when needed */
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={1}
        shadow-camera-far={120}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-bias={-0.0005}
        shadow-normalBias={0.05}
      />
      <group ref={modelRef}>
        <primitive object={scene} scale={4.0} />
      </group>
    </>
  );
};

export default ModelController;

declare global {
  interface Window {
    triggerJump?: () => void;
  }
}
