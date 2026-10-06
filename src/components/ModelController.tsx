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
  MOVE_SPEED, MODEL_Y_OFFSET, ROTATION_SPEED, MIN_SPEED_FOR_WALK, WALK_ANIM_SPEED_SCALE,
  EDGE_MARGIN, PLAY_AREA_FAR_Z, DEAD_ZONE, START_NDC, DIRECTION_SMOOTHING,
  SUN_POSITION,
  type SitState,
} from './modelConfig';
import { setWeights, type AnimationActions } from './animationHelpers';

import { modelWorldPos, modelSitAmountRef, modelForwardRef, modelPawPositions, modelGroundedRef, cameraFocus, cameraRig } from './modelState';
import { curveDrop } from './worldCurve';
import { useAssetUrl } from './assets';
import { controlBus } from './controlBus';

// Pre-allocated — never created per frame
const _raycaster = new THREE.Raycaster();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _groundPoint = new THREE.Vector3();
const _probePoint = new THREE.Vector3();
const _tempVec3 = new THREE.Vector3();
const _ndcSample = new THREE.Vector2();
const _inputVec2 = new THREE.Vector2();

// inputEnabled = false (before Start, or while paused) ignores keys, joystick, jump and petting.
const ModelController = ({ inputEnabled = true }: { inputEnabled?: boolean }) => {
  const assetUrl = useAssetUrl();
  const { scene, animations } = useGLTF(assetUrl(MODEL_PATH), true);
  const modelRef = useRef<THREE.Group>(null);
  const shadowLightRef = useRef<THREE.DirectionalLight>(null!);
  const { camera, gl, scene: threeScene } = useThree();


  const [albedo, normal, roughness, ao] = useTexture([
    assetUrl(`${TEXTURE_BASE}/Spitz_Albedo3.png`),
    assetUrl(`${TEXTURE_BASE}/Spitz_Normal.png`),
    assetUrl(`${TEXTURE_BASE}/Spitz_Roughness.png`),
    assetUrl(`${TEXTURE_BASE}/Spitz_AO.png`),
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
  // Forces an initial shadow render (dog starts in 'sit_loop', which skips updates)
  const shadowInitializedRef = useRef(false);
  const idleTimeRef = useRef(0);
  const animationWeightRef = useRef(0);
  const sitLoop2TimerRef = useRef(
    SIT_LOOP2_INTERVAL_MIN + Math.random() * (SIT_LOOP2_INTERVAL_MAX - SIT_LOOP2_INTERVAL_MIN)
  );

  // ── Movement refs ──────────────────────────────────────────────────────────
  const ndcPosRef = useRef(new THREE.Vector2(START_NDC.x, START_NDC.y));
  const worldPosRef = useRef(new THREE.Vector3(0, 0, 0));
  const positionInitializedRef = useRef(false);
  const currentSpeedRef = useRef(0);
  const targetRotationRef = useRef(0);
  const moveSpeedRef = useRef(0);
  // Ground speed (world units/s) the walk clip was animated for; null if it couldn't be measured
  const walkNaturalSpeedRef = useRef<number | null>(null);
  // Current ground speed, used to scale the walk animation's playback rate
  const groundSpeedRef = useRef(0);
  const smoothDirRef = useRef(new THREE.Vector2());
  const smoothDirValidRef = useRef(false);
  const landingSpeedRef = useRef(1);

  // ── Front paw bones (back paws are covered by the body sit zone) ──
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
  const inputEnabledRef = useRef(inputEnabled);

  // Anything held when input turns off would otherwise stay held (key-ups are ignored too)
  useEffect(() => {
    inputEnabledRef.current = inputEnabled;
    if (!inputEnabled) {
      keysPressedRef.current = { w: false, a: false, s: false, d: false };
      joystickRef.current = { x: 0, y: 0 };
      jumpPressedRef.current = false;
    }
  }, [inputEnabled]);

  const jumpReturnBlendRef = useRef(0);
  const jumpVelocityRef = useRef(new THREE.Vector2(0, 0));
  const jumpAirTimeRef = useRef(0);
  const jumpTotalDurationRef = useRef(1);
  const jumpPhaseBlendRef = useRef(1);
  const jumpIsMovingRef = useRef(false);

  // ── Texture setup ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!scene) return;
    // Front foot bones, for grass paw interaction
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
      // Culling disabled so animated extremities (e.g. hind paws) are never
      // clipped, including in the shadow pass.
      obj.frustumCulled = false;
      obj.castShadow = true;
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
      // Match the runtime scene height so the curve is consistent across clips
      scene.position.set(0, MODEL_Y_OFFSET, 0);
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
      tmpMixer.uncacheRoot(scene);
      return curve;
    };
    jumpStartLiftCurveRef.current = buildLiftCurve(jumpStartClip);
    jumpStartMoveLiftCurveRef.current = buildLiftCurve(jumpStartMoveClip);

    // The walk clip is in place, so measure the ground speed it was animated for: how
    // fast the planted front feet slide backwards (world units/s at timeScale 1). The
    // frame loop scales playback by actual speed / this, so the feet track the ground.
    const measureWalkSpeed = (clip: THREE.AnimationClip): number | null => {
      const feet = ['foot_fL_028', 'foot_fR_034']
        .map((name) => scene.getObjectByName(name))
        .filter((obj): obj is THREE.Object3D => !!obj);
      if (feet.length === 0) return null;

      scene.position.set(0, MODEL_Y_OFFSET, 0);
      const tmpMixer = new THREE.AnimationMixer(scene);
      tmpMixer.clipAction(clip).play();
      const STEPS = 120;
      const dt = clip.duration / STEPS;
      const paths = feet.map(() => [] as THREE.Vector3[]);
      for (let i = 0; i <= STEPS; i++) {
        tmpMixer.setTime(i * dt);
        scene.updateMatrixWorld(true);
        feet.forEach((foot, k) => paths[k].push(foot.getWorldPosition(new THREE.Vector3())));
      }
      tmpMixer.stopAllAction();
      tmpMixer.uncacheRoot(scene);

      // Planted = the lowest fifth of the foot's height range. Median speed ignores
      // the slow frames at heel strike / toe off.
      const speeds: number[] = [];
      for (const path of paths) {
        const ys = path.map((p) => p.y);
        const lowY = Math.min(...ys);
        const plantedY = lowY + 0.2 * (Math.max(...ys) - lowY);
        for (let i = 0; i < STEPS; i++) {
          if (path[i].y <= plantedY && path[i + 1].y <= plantedY) {
            speeds.push(Math.hypot(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z) / dt);
          }
        }
      }
      if (speeds.length === 0) return null;
      speeds.sort((x, y) => x - y);
      return speeds[Math.floor(speeds.length / 2)];
    };
    walkNaturalSpeedRef.current = measureWalkSpeed(walkClip);
    if (import.meta.env.DEV) console.info('Walk clip natural ground speed:', walkNaturalSpeedRef.current);

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
      } else if ((e.action === a.jumpLand || e.action === a.jumpLandMove) && sitStateRef.current === 'jump_land') {
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
      mixer.uncacheRoot(scene);
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
    // Keys typed into a form field or editable area belong to the host page, not the dog
    const isTyping = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!inputEnabledRef.current || isTyping(e)) return;
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
    // Key-up events are lost when the window loses focus, which would leave keys stuck
    const handleBlur = () => {
      keysPressedRef.current = { w: false, a: false, s: false, d: false };
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  useEffect(() => {
    controlBus.joystick = (x: number, y: number) => {
      if (inputEnabledRef.current) joystickRef.current = { x, y };
    };
    controlBus.jump = () => {
      if (inputEnabledRef.current) jumpPressedRef.current = true;
    };
    return () => {
      controlBus.joystick = null;
      controlBus.jump = null;
    };
  }, []);

  // Click / tap to pet the model
  useEffect(() => {
    const pettableStates: SitState[] = ['idle', 'sit_loop'];
    const handleInteract = (clientX: number, clientY: number) => {
      if (!modelRef.current || !inputEnabledRef.current) return;
      const canvas = gl.domElement;
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
      _raycaster.setFromCamera(ndc, camera);
      const hits = _raycaster.intersectObject(modelRef.current, true);
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
    //    the on-screen position (otherwise the model teleports on the first move).
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

    // 2–6. Position. The boundary projection, perspective probes and unproject
    // are skipped while the model is stationary.
    if (canMove || (isAirborne && hasJumpVelocity)) {
      // NDC of the far limit: past it the view ray never meets the flat ground plane
      _tempVec3.set(cameraFocus.x, 0, cameraFocus.y + PLAY_AREA_FAR_Z);
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

      const prevNdcX = ndcPosRef.current.x;
      const prevNdcY = ndcPosRef.current.y;

      if (canMove) {
        _inputVec2.normalize();
        // Ease the direction so adding or dropping a key (e.g. left → up-left) bends
        // the path, and the scroll speed, over a few frames instead of in one step.
        // A standing start adopts the input directly (moveSpeedRef already ramps speed).
        if (!smoothDirValidRef.current) {
          smoothDirRef.current.copy(_inputVec2);
          smoothDirValidRef.current = true;
        } else {
          smoothDirRef.current.lerp(_inputVec2, 1 - Math.exp(-DIRECTION_SMOOTHING * delta));
        }
        const dir = smoothDirRef.current;
        moveSpeedRef.current = Math.min(1, moveSpeedRef.current + delta * 6);
        landingSpeedRef.current = Math.min(1, landingSpeedRef.current + delta * 8);
        const spd = MOVE_SPEED * delta * moveSpeedRef.current * landingSpeedRef.current;
        groundSpeedRef.current = MOVE_SPEED * moveSpeedRef.current * landingSpeedRef.current * dir.length();
        ndcPosRef.current.x += dir.x * (spd / Math.max(worldPerNdcX, 0.001));
        ndcPosRef.current.y += dir.y * (spd / Math.max(worldPerNdcY, 0.001));
        jumpVelocityRef.current.copy(dir);
      } else {
        const spd = MOVE_SPEED * delta * moveSpeedRef.current;
        ndcPosRef.current.x += jumpVelocityRef.current.x * (spd / Math.max(worldPerNdcX, 0.001));
        ndcPosRef.current.y += jumpVelocityRef.current.y * (spd / Math.max(worldPerNdcY, 0.001));
      }

      // Dead zone: the model stays inside it on screen. Whatever it moved past an
      // edge is converted to world units and applied to the camera instead, so the
      // world slides under the model. NDC +Y is world -Z.
      const boxYMax = Math.min(DEAD_ZONE.centerY + DEAD_ZONE.halfY, farNDCY - EDGE_MARGIN);
      const clampedX = Math.max(
        DEAD_ZONE.centerX - DEAD_ZONE.halfX,
        Math.min(DEAD_ZONE.centerX + DEAD_ZONE.halfX, ndcPosRef.current.x)
      );
      const clampedY = Math.max(DEAD_ZONE.centerY - DEAD_ZONE.halfY, Math.min(boxYMax, ndcPosRef.current.y));
      // Scroll only by what this frame's movement pushed past the edge, so any other
      // change in the clamp (e.g. the far limit) can't make the world jump.
      const scrollNdc = (excess: number, moved: number) =>
        excess * moved > 0 ? (Math.abs(excess) < Math.abs(moved) ? excess : moved) : 0;
      const scrollX = scrollNdc(ndcPosRef.current.x - clampedX, ndcPosRef.current.x - prevNdcX) * worldPerNdcX;
      const scrollZ = -scrollNdc(ndcPosRef.current.y - clampedY, ndcPosRef.current.y - prevNdcY) * worldPerNdcY;
      ndcPosRef.current.set(clampedX, clampedY);
      if (scrollX !== 0 || scrollZ !== 0) {
        cameraFocus.x += scrollX;
        cameraFocus.y += scrollZ;
        // Translation only; the orientation never changes, so unprojection stays valid.
        cam.position.set(cameraFocus.x, cameraRig.height, cameraFocus.y + cameraRig.zOffset);
        cam.updateMatrixWorld();
      }

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
      smoothDirValidRef.current = false;
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

    // 9. Animation state machine
    if (sitState === 'idle') {
      const targetWalk = canMove ? 1 : 0;
      animationWeightRef.current += (targetWalk - animationWeightRef.current) * (1 - Math.exp(-5 * delta));
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
      animationWeightRef.current += (targetWalk - animationWeightRef.current) * (1 - Math.exp(-5 * delta));
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

    // Match the walk cycle to the ground speed (kept as-is while standing, so it
    // doesn't change under the blend-out)
    const walkNatural = walkNaturalSpeedRef.current;
    if (a.walk && walkNatural && canMove) {
      a.walk.timeScale = THREE.MathUtils.clamp(
        (groundSpeedRef.current / walkNatural) * WALK_ANIM_SPEED_SCALE, 0.5, 1.5
      );
    }

    mixerRef.current?.update(delta);
    // Update front paw world positions for grass interaction
    for (let i = 0; i < 2; i++) {
      const bone = pawBonesRef.current[i];
      if (bone) bone.getWorldPosition(modelPawPositions[i]);
    }

    // 10. Cancel root motion XZ; apply sine arc lift during airborne phases
    const activeState = sitStateRef.current;
    let extraHeight = 0;
    if (activeState === 'jump_air' || activeState === 'jump_land') {
      const progress = Math.min(1, jumpAirTimeRef.current / jumpTotalDurationRef.current);
      const maxLift = jumpIsMovingRef.current ? 0.3 : 0.25;
      const arcLift = Math.max(0, maxLift * Math.sin(progress * Math.PI));
      // Exponentially decay residual lift from jump_start
      jumpLiftRef.current *= Math.exp(-delta * 15);
      extraHeight = arcLift + jumpLiftRef.current;
    } else if (activeState === 'jump_start') {
      const curve = jumpIsMovingRef.current ? jumpStartMoveLiftCurveRef.current : jumpStartLiftCurveRef.current;
      const action = jumpIsMovingRef.current ? actionsRef.current.jumpStartMove : actionsRef.current.jumpStart;
      if (curve && action) {
        const progress = Math.min(1, action.time / action.getClip().duration);
        const idx = Math.min(curve.length - 1, Math.floor(progress * curve.length));
        extraHeight = curve[idx];
      }
    } else {
      jumpLiftRef.current = 0;
    }
    scene.position.set(0, MODEL_Y_OFFSET + extraHeight, 0);

    // Fade grass ground contact out as the dog lifts off (smooth, so takeoff/landing don't pop).
    modelGroundedRef.value = 1 - THREE.MathUtils.smoothstep(extraHeight, 0.03, 0.16);

    // 11. Sun sits at a fixed offset from the camera focus (so it follows the scrolling
    //     world); shadow angle/length changes as the model moves on screen
    if (shadowLightRef.current) {
      shadowLightRef.current.position.set(
        cameraFocus.x + SUN_POSITION.x, SUN_POSITION.y, cameraFocus.y + SUN_POSITION.z
      );
      shadowLightRef.current.target.position.copy(worldPosRef.current);
      shadowLightRef.current.target.updateMatrixWorld();
      // Render once at start (it may mount straight into sit_loop), then only while the pose changes.
      shadowLightRef.current.shadow.needsUpdate =
        !shadowInitializedRef.current || sitStateRef.current !== 'sit_loop';
      shadowInitializedRef.current = true;
    }

    // 12. Apply world position and rotation to mesh
    if (modelRef.current) {
      // Sit on the curved ground; modelWorldPos stays flat (grass compares XZ only)
      modelRef.current.position.set(
        worldPosRef.current.x,
        -curveDrop(worldPosRef.current.x, worldPosRef.current.z),
        worldPosRef.current.z
      );
      modelWorldPos.copy(worldPosRef.current);
      const s = sitStateRef.current;
      modelSitAmountRef.value = (s === 'sit_loop' || s === 'sit_loop2' || s === 'sit_start' || s === 'scratch') ? 1 : 0;
      const ry = modelRef.current.rotation.y;
      modelForwardRef.value.set(Math.sin(ry), Math.cos(ry));

      if (currentSpeedRef.current > MIN_SPEED_FOR_WALK) {
        const currentRotation = modelRef.current.rotation.y;
        let shortest = ((targetRotationRef.current - currentRotation + Math.PI) % (Math.PI * 2)) - Math.PI;
        if (shortest < -Math.PI) shortest += Math.PI * 2;
        modelRef.current.rotation.y += shortest * (1 - Math.exp(-ROTATION_SPEED * delta));
      }

      // Tilt nose up during standing jump air phase to counteract forward lean
      modelRef.current.rotation.order = 'YXZ';
      if (!jumpIsMovingRef.current && activeState === 'jump_air') {
        modelRef.current.rotation.x += (-0.28 - modelRef.current.rotation.x) * (1 - Math.exp(-10 * delta));
      } else {
        modelRef.current.rotation.x += (0 - modelRef.current.rotation.x) * (1 - Math.exp(-20 * delta));
      }
    }
  });

  return (
    <>
      <directionalLight
        ref={shadowLightRef}
        intensity={1.5}
        castShadow
        // autoUpdate off so the needsUpdate toggle can skip shadow re-renders while sitting.
        shadow-autoUpdate={false}
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
