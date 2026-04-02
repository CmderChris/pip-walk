import { useEffect } from 'react'
import './App.css'

// import * as THREE from 'three'
// import { Canvas } from '@react-three/fiber'
// import { useGLTF } from '@react-three/drei'
// import { useSphere } from '@react-three/cannon'
// import { GLTFLoader } from 'three/examples/jsm/Addons.js'

// import Ground from './components/Ground'

import Scene from './components/Scene'
import { createJoystick } from './components/JoystickOverlay';
// import Controls from './components/Controls'

const App = () => {
  useEffect(() => {
    // Create the joystick and get cleanup function
    const cleanupJoystick = createJoystick();
    
    // Clean up on unmount
    return cleanupJoystick;
  }, []);

  return (
    <div className="w-full h-full absolute inset-0">
      <Scene />
    </div>
  );
}

export default App

declare global {
  interface Window {
    updateJoystick?: (x: number, y: number) => void;
  }
}

// GOOD SCENE
// const Scene: React.FC = () => {
//   return (
//     <Canvas style={{ width: '100%', height: '100vh', display: 'block' }}>
//       {/* Main Camera */}
//       <PerspectiveCamera makeDefault position={[0, 5, 10]} fov={60} />
      
//       {/* Environment */}
//       <ambientLight intensity={0.5} />
//       <directionalLight position={[10, 10, 5]} intensity={1} castShadow />
      
//       {/* Sky */}
//       <Sky 
//         distance={450000} 
//         sunPosition={[0, 1, 0]} 
//         inclination={0.5}
//         azimuth={0.25}
//       />
      
//       {/* Floor */}
//       <Grid
//         position={[0, -0.01, 0]}
//         args={[FLOOR_SIZE * 2, FLOOR_SIZE * 2]}
//         cellSize={1}
//         cellThickness={1}
//         cellColor="#6f6f6f"
//         sectionSize={3}
//         sectionThickness={1.5}
//         sectionColor="#9d4b4b"
//         fadeDistance={FLOOR_SIZE}
//         infiniteGrid
//         fadeStrength={1.5}
//       />
      
//       {/* Your 3D Model */}
//       <Model position={[0, 0, 0]} scale={1} />
      
//       {/* Controls - Limited to prevent going below the floor */}
//       <OrbitControls
//         minPolarAngle={Math.PI / 6}
//         maxPolarAngle={Math.PI / 2.5}
//         enablePan={false}
//         enableZoom={true}
//         target={[0, 1, 0]}
//       />
      
//       {/* Controls manager to disable orbit controls during movement */}
//       <ControlsManager />
//     </Canvas>
//   );
// };
