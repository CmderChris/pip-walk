import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';

const CameraController = () => {
  const { camera } = useThree();

  useEffect(() => {
    const updateCamera = () => {
      const aspect = window.innerWidth / window.innerHeight;
      // On portrait screens the camera sees a tall vertical slice — pull it back
      // so the model doesn't appear disproportionately large and the play area
      // feels consistent. On landscape the standard position is used.
      const z = aspect < 1 ? 16 + (1 - aspect) * 10 : 16;
      camera.position.set(0, 3, z);
      camera.lookAt(0, 0, 0);
    };

    updateCamera();
    window.addEventListener('resize', updateCamera);
    return () => window.removeEventListener('resize', updateCamera);
  }, [camera]);

  return null;
};

export default CameraController;
