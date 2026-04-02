import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { 
  Sky, Environment
} from '@react-three/drei';
import { Physics } from '@react-three/cannon';

import CameraController from './CameraController';
import Floor from './Floor';
import Boundaries from './Boundaries';
import ModelController from './ModelController';

// Main scene component
const Scene = () => {
  return (
    <div style={{ 
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      overflow: 'hidden'
    }}>
      <Canvas shadows resize={{ scroll: false, debounce: { scroll: 50, resize: 50 } }}>
        <CameraController />
        
        <ambientLight intensity={0.5} />
        <directionalLight 
          position={[10, 10, 5]} 
          intensity={1} 
          castShadow 
          shadow-mapSize={[2048, 2048]}
        />
        
        <Physics>
          <Floor />
          <Boundaries />
        </Physics>
        <Suspense fallback={null}>
          <ModelController />
        </Suspense>
        
        <Sky 
          distance={450000} 
          sunPosition={[0, 1, 0]} 
          inclination={0.5} 
          azimuth={0.25}
        />
        <Environment preset="park" />
      </Canvas>
    </div>
  );
};


export default Scene

