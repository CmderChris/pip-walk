import { Suspense } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { Sky, Environment } from '@react-three/drei';
import { Physics } from '@react-three/cannon';
import { EffectComposer, Bloom, Vignette, N8AO } from '@react-three/postprocessing';

const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

import CameraController from './CameraController';
import Floor from './Floor';
import Ground from './Ground';
import Boundaries from './Boundaries';
import ModelController from './ModelController';

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
      <Canvas shadows={{ type: THREE.PCFSoftShadowMap }} resize={{ scroll: false, debounce: { scroll: 50, resize: 50 } }}>
        <fog attach="fog" args={['#c8d8b0', 80, 500]} />

        <CameraController />

        <ambientLight intensity={0.25} />

        <Physics>
          <Floor />
          <Boundaries />
        </Physics>

        <Suspense fallback={null}>
          <Ground />
          <ModelController />
          <EffectComposer>
            <Bloom luminanceThreshold={0.9} intensity={0.3} mipmapBlur />
            <Vignette offset={0.3} darkness={0.5} />
          </EffectComposer>
          {!isMobile && (
            <EffectComposer>
              <N8AO aoRadius={2} intensity={2} />
            </EffectComposer>
          )}
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

export default Scene;
