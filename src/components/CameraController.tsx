import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { cameraFocus, cameraRig } from './modelState';

// Sets the camera's orientation, fov and offset. ModelController translates the
// camera with cameraFocus to scroll the world; the orientation never changes.
const CameraController = () => {
  const camera = useThree((state) => state.camera);
  // R3F's debounced size, so this stays in step with its camera.aspect update.
  const size = useThree((state) => state.size);

  useEffect(() => {
    const aspect = size.width / size.height;
    // Portrait shows a tall slice: pull the camera back so the model isn't oversized.
    cameraRig.zOffset = aspect < 1 ? 16 + (1 - aspect) * 10 : 16;
    camera.position.set(cameraFocus.x, cameraRig.height, cameraFocus.y + cameraRig.zOffset);
    camera.lookAt(cameraFocus.x, 0, cameraFocus.y);
    // 50° FOV (default 75°) avoids wide-angle stretching near the screen edges.
    (camera as THREE.PerspectiveCamera).fov = 50;
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
  }, [camera, size]);

  return null;
};

export default CameraController;
