import { CURVE_STRENGTH, CURVE_X_WEIGHT } from './modelConfig';
import { cameraFocus } from './modelState';

// How far the world surface has dropped at (x, z), measured from the camera focus.
// Must match the GLSL below, which bends the ground and grass.
export function curveDrop(x: number, z: number): number {
  const dx = x - cameraFocus.x;
  const dz = z - cameraFocus.y;
  return CURVE_STRENGTH * (CURVE_X_WEIGHT * dx * dx + dz * dz);
}

// Shared uniform objects; uCurveFocus is cameraFocus itself, so it never needs copying.
export const curveUniforms = {
  uCurveFocus:    { value: cameraFocus },
  uCurveStrength: { value: CURVE_STRENGTH },
  uCurveXWeight:  { value: CURVE_X_WEIGHT },
};

export const curveDropGLSL = /* glsl */`
  uniform vec2  uCurveFocus;
  uniform float uCurveStrength;
  uniform float uCurveXWeight;

  float curveDrop(vec2 xz) {
    vec2 d = xz - uCurveFocus;
    return uCurveStrength * (uCurveXWeight * d.x * d.x + d.y * d.y);
  }
`;
