import { isLowEnd } from './perfTier';

// Runtime density dial for instanced content (grass now, leaves later). It multiplies
// the generated instance counts: 1 = everything, MIN_SCALE = thinnest.
// Only the frame rate drives it: it steps down when the device can't hold its target,
// and creeps back up only after a long, steady stretch at target.

const TARGET_FPS = isLowEnd ? 30 : 60;
export const MIN_SCALE = 0.5;

export const qualityScale = { value: 1 };

const WARMUP = 4;            // s: ignore shader compiles and asset loading
const WINDOW = 1.5;          // s: frame-rate averaging window
const STEP_DOWN = 0.1;
const STEP_UP = 0.05;
const SLOW_FRACTION = 0.88;  // below this share of the target counts as struggling
const STEADY_FRACTION = 0.97;
const STEADY_FOR = 20;       // s at target before stepping back up

let elapsed = 0;
let windowTime = 0;
let windowFrames = 0;
let steadyTime = 0;
let sinceDecrease = Infinity;
let decreases = 0;

export function resetAdaptiveQuality() {
  qualityScale.value = 1;
  elapsed = 0;
  windowTime = 0;
  windowFrames = 0;
  steadyTime = 0;
  sinceDecrease = Infinity;
  decreases = 0;
}

/** Call once per frame. Returns true when qualityScale changed. */
export function updateAdaptiveQuality(delta: number): boolean {
  // A background tab or one-off hitch says nothing about sustained speed
  if (delta > 0.25) return false;

  elapsed += delta;
  sinceDecrease += delta;
  if (elapsed < WARMUP) return false;

  windowTime += delta;
  windowFrames++;
  if (windowTime < WINDOW) return false;

  const fps = windowFrames / windowTime;
  windowTime = 0;
  windowFrames = 0;

  if (fps < TARGET_FPS * SLOW_FRACTION) {
    steadyTime = 0;
    if (qualityScale.value > MIN_SCALE) {
      qualityScale.value = Math.max(MIN_SCALE, qualityScale.value - STEP_DOWN);
      sinceDecrease = 0;
      decreases++;
      return true;
    }
    return false;
  }

  if (fps >= TARGET_FPS * STEADY_FRACTION) steadyTime += WINDOW;
  else steadyTime = 0;

  // Each earlier decrease doubles how long we wait before trying more density again
  const cooldown = Math.min(300, 30 * 2 ** Math.max(0, decreases - 1));
  if (qualityScale.value < 1 && steadyTime >= STEADY_FOR && sinceDecrease >= cooldown) {
    qualityScale.value = Math.min(1, qualityScale.value + STEP_UP);
    steadyTime = 0;
    return true;
  }
  return false;
}
