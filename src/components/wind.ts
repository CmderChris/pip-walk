// Occasional wind: a gust front sweeps across the world along WIND_DIR every so often.
// Grass.tsx reads windState each frame; the shader only does wind work for blades the
// front is passing over (and, if IDLE_WIND_AMP > 0, a faint constant sway).

export const WIND_DIR = { x: 0.894427, y: 0.447214 }; // normalised (1, 0.5) in world XZ
export const GUST_WIDTH = 14;        // world units; the lean peaks at the front and fades over this
export const GUST_LEAN = 0.16;       // peak sideways lean of a blade tip, in world units
export const IDLE_WIND_AMP = 0;      // sway between gusts; 0 = none (and no shader cost)

// Each gust lasts a random time, and its front always covers 2 × GUST_TRAVEL units in
// that time (so shorter gusts are faster). The duration is fixed when the gust starts,
// whichever way the player walks. The front starts and ends in the world, GUST_TRAVEL
// upwind/downwind of where the focus was when it triggered.
const GUST_DURATION_RANGE: [number, number] = [15, 35]; // seconds
const GUST_TRAVEL = 80;
const FIRST_GUST_DELAY: [number, number] = [5, 9];    // seconds
const GUST_INTERVAL: [number, number] = [25, 45];     // seconds between gusts

export const windState = {
  active: false,
  front: 0, // gust position along WIND_DIR (dot(WIND_DIR, worldXZ))
};

const rand = ([min, max]: [number, number]) => min + Math.random() * (max - min);
let countdown = rand(FIRST_GUST_DELAY);
let gustTimeLeft = 0;
let gustSpeed = 0; // world units/s

export function resetWind() {
  windState.active = false;
  windState.front = 0;
  countdown = rand(FIRST_GUST_DELAY);
  gustTimeLeft = 0;
  gustSpeed = 0;
}

export function updateWind(delta: number, focusX: number, focusZ: number) {
  const dt = Math.min(delta, 0.1);

  if (!windState.active) {
    countdown -= dt;
    if (countdown <= 0) {
      const duration = rand(GUST_DURATION_RANGE);
      windState.active = true;
      windState.front = WIND_DIR.x * focusX + WIND_DIR.y * focusZ - GUST_TRAVEL;
      gustTimeLeft = duration;
      gustSpeed = (2 * GUST_TRAVEL) / duration;
    }
    return;
  }

  windState.front += gustSpeed * dt;
  gustTimeLeft -= dt;
  if (gustTimeLeft <= 0) {
    windState.active = false;
    countdown = rand(GUST_INTERVAL);
  }
}
