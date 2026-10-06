import * as THREE from 'three';

// ── Animation clip names ───────────────────────────────────────────────────
// Asset paths are relative to the asset base (see assets.ts)
export const MODEL_PATH = 'models/new_dog4.glb';
export const TEXTURE_BASE = 'models/pomeranian_model/spitz_textures/texture';
export const GROUND_NORMAL_PATH = 'textures/Ground103_1K-PNG_NormalGL.png';
export const ENV_PATH = 'env/park.hdr';

export const WALK_ANIM = 'Arm_SpitzWalk_F_IP';
export const IDLE_ANIM = 'Arm_SpitzIdle_1';
export const SIT_START_ANIM = 'Arm_SpitzSitting_start';
export const SIT_END_ANIM = 'Arm_SpitzSitting_end';
export const SIT_IDLE_ANIM = 'Arm_SpitzSitting_loop_1';  // base sitting loop
export const SIT_LOOP2_ANIM = 'Arm_SpitzSitting_loop_2'; // plays on random interval
export const SCRATCH_ANIM = 'Arm_SpitzScratching';
export const PET_STAND_ANIM = 'Arm_SpitzIdle_3';

// Standing jump
export const JUMP_START_ANIM = 'Arm_SpitzJumpStart_Place';
export const JUMP_AIR_ANIM = 'Arm_SpitzJumpAir_Up';
export const JUMP_LAND_ANIM = 'Arm_SpitzJumpLand_Place';

// Moving jump
export const JUMP_START_MOVE_ANIM = 'Arm_SpitzJumpStart_F_IP';
export const JUMP_AIR_MOVE_ANIM = 'Arm_SpitzJumpAir_Horiz';
export const JUMP_LAND_MOVE_ANIM = 'Arm_SpitzJumpLand_F_IP';

// ── Timing / tuning ────────────────────────────────────────────────────────
export const SIT_DELAY = 10;           // seconds of stillness before sitting
export const BLEND_TIME = 0.3;         // standard crossfade duration in seconds
export const JUMP_BLEND_TIME = 0.35;   // jump landing → idle/walk blend duration
export const SIT_LOOP2_INTERVAL_MIN = 15;
export const SIT_LOOP2_INTERVAL_MAX = 20;
export const MOVE_SPEED = 4.8;        // world units/second (also the world's scroll speed)
export const MODEL_Y_OFFSET = 0.04;    // lifts model so feet don't clip ground
export const ROTATION_SPEED = 10;
export const MIN_SPEED_FOR_WALK = 0.5;
// Fine-tunes the walk cycle against the ground speed it's matched to (1 = exact match).
// Below 1 slows the legs down; above 1 speeds them up.
export const WALK_ANIM_SPEED_SCALE = 0.88;
export const EDGE_MARGIN = 0.02;       // NDC margin inside each screen edge
export const PLAY_AREA_FAR_Z = -25;    // Z (relative to the camera focus) beyond which the ground can't be unprojected

// ── World scrolling ────────────────────────────────────────────────────────
// The model stays near the screen centre. It can move freely inside this small
// dead zone (NDC units); pushing past an edge scrolls the world (moves the camera)
// at the model's speed instead of moving the model on screen. Widen halfX/halfY
// for a looser feel, shrink them to pin the model closer to the centre.
export const DEAD_ZONE = { centerX: 0, centerY: -0.3, halfX: 0.11, halfY: 0.09 };
// Where the model starts on screen: the dead zone's centre.
export const START_NDC = { x: DEAD_ZONE.centerX, y: DEAD_ZONE.centerY };
// How quickly the movement direction follows the input (1/s). Higher = snappier turns.
export const DIRECTION_SMOOTHING = 14;

// ── Camera ─────────────────────────────────────────────────────────────────
// 50° vertical FOV (the default 75° stretches things near the screen edges).
export const CAMERA_FOV = 50;

// ── World curvature ────────────────────────────────────────────────────────
// Ground and grass drop by CURVE_STRENGTH * (CURVE_X_WEIGHT * dx² + dz²) with
// distance from the camera focus. The horizon sits roughly 47 units beyond the
// focus at 0.0008 (a sphere of radius 1 / (2 * strength) = 625).
export const CURVE_STRENGTH = 0.0008;
export const CURVE_X_WEIGHT = 0.6;     // < 1: bends less sideways than toward the horizon

// ── Lighting ───────────────────────────────────────────────────────────────
// Sun offset from the camera focus, shared by the shadow-casting light and Grass's
// shadow/backlight shaders. The light follows the focus, so shadows stay put while scrolling.
export const SUN_POSITION = new THREE.Vector3(0, 35, -60);

// ── Fog ────────────────────────────────────────────────────────────────────
// Shared by Scene's <fog> and Grass's field radius. The curved horizon hides
// anything past ~65 units from the camera, so fog fades the world edge out.
export const FOG_NEAR = 25;
export const FOG_FAR = 80;

// ── Types ──────────────────────────────────────────────────────────────────
export type SitState =
  | 'idle'
  | 'sit_start'
  | 'sit_loop'
  | 'sit_end'
  | 'jump_start'
  | 'jump_air'
  | 'jump_land'
  | 'scratch'
  | 'sit_loop2'
  | 'pet';
