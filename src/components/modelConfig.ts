// ── Animation clip names ───────────────────────────────────────────────────
export const MODEL_PATH = '/models/pomeranian_model/spitz_fbx.glb';
export const TEXTURE_BASE = '/models/pomeranian_model/spitz_textures/texture';

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
export const SCRATCH_INTERVAL_MIN = 15;
export const SCRATCH_INTERVAL_MAX = 35;
export const SIT_LOOP2_INTERVAL_MIN = 15;
export const SIT_LOOP2_INTERVAL_MAX = 20;
export const MOVE_SPEED = 7;           // world units/second
export const MODEL_Y_OFFSET = 0.04;    // lifts model so feet don't clip ground
export const ROTATION_SPEED = 10;
export const MIN_SPEED_FOR_WALK = 0.5;
export const EDGE_MARGIN = 0.02;       // NDC margin inside each screen edge
export const PLAY_AREA_FAR_Z = -25;    // world Z of the back boundary

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
