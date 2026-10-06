import * as THREE from 'three';
import { CURVE_STRENGTH, CAMERA_FOV } from './modelConfig';
import { cameraRig } from './modelState';

// What part of the ground can actually be on screen, in coordinates relative to the
// camera focus. Grass uses it to skip tiles and blades nobody can see.
export type ViewLimits = {
  ahead: number;    // distance ahead of the focus (-Z) where the curved horizon hides the ground
  rear: number;     // distance behind the focus (+Z) where the screen's bottom edge meets the ground
  tanHalfH: number; // tan(half horizontal fov): visible half-width per unit of depth
  camZ: number;     // how far behind the focus the camera sits
};

// Grass blades poke up this far above the ground, so they clear the horizon a bit later
const BLADE_HEIGHT_MARGIN = 0.5;

export function computeViewLimits(aspect: number, out: ViewLimits): ViewLimits {
  const k = CURVE_STRENGTH;
  const zo = cameraRig.zOffset;
  const h = cameraRig.height;

  // The ground drops by k*z² ahead of the focus. The line of sight from the camera
  // (height h, zo behind the focus) with slope m grazes that parabola when
  // m² + 4·k·zo·m - 4·k·h = 0, at z = -m / 2k.
  const eye = h + BLADE_HEIGHT_MARGIN;
  const slope = -2 * k * zo + 2 * Math.sqrt(k * k * zo * zo + k * eye);
  out.ahead = slope / (2 * k);

  // The camera looks at the focus, pitched down by atan(h / zo); the bottom of the view is half a vertical fov further down
  const halfV = THREE.MathUtils.degToRad(CAMERA_FOV / 2);
  const pitch = Math.atan2(h, zo);
  out.rear = zo - h / Math.tan(pitch + halfV) + 2;

  out.tanHalfH = Math.tan(halfV) * aspect;
  out.camZ = zo;
  return out;
}
