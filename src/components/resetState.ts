import { cameraFocus, cameraRig, modelWorldPos, modelSitAmountRef, modelGroundedRef, modelForwardRef, modelPawPositions } from './modelState';
import { resetWind } from './wind';
import { resetAdaptiveQuality } from './adaptiveQuality';
import { controlBus } from './controlBus';

// The scene keeps some state at module level (shared with shaders and between components).
// Reset it when the scene unmounts so a later visit starts from scratch.
export function resetSceneState() {
  cameraFocus.set(0, 0);
  cameraRig.height = 3;
  cameraRig.zOffset = 16;
  modelWorldPos.set(0, 0, 0);
  modelSitAmountRef.value = 0;
  modelGroundedRef.value = 1;
  modelForwardRef.value.set(0, 1);
  modelPawPositions.forEach((p) => p.set(9999, 0, 9999));
  controlBus.joystick = null;
  controlBus.jump = null;
  resetWind();
  resetAdaptiveQuality();
}
