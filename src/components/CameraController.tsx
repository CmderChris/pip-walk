import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';

const CameraController = () => {
  const { camera } = useThree();

  useEffect(() => {
    // Fixed overhead-angled camera looking down at the play area from the front.
    // Adjust Y (height) and Z (distance) to frame the 40x40 unit play area as needed.
    camera.position.set(0, 4, 16);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  return null;
};

export default CameraController;
