import { Suspense } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { Sky, Environment } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, N8AO } from '@react-three/postprocessing';
import { isLowEnd } from './perfTier';

import CameraController from './CameraController';
import Ground from './Ground';
// import Grass from './Grass';
import ModelController from './ModelController';
import { FpsTracker, FpsDisplay } from './FpsCounter';

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
      <Canvas
        shadows={isLowEnd ? false : { type: THREE.PCFSoftShadowMap }}
        dpr={isLowEnd ? 1 : [1, 2]}
        resize={{ scroll: false, debounce: { scroll: 50, resize: 50 } }}
      >
        <fog attach="fog" args={['#c8d8b0', 80, 360]} />

        <CameraController />

        <ambientLight intensity={isLowEnd ? 0.6 : 0.25} />

        {!isLowEnd && (
          <EffectComposer multisampling={0}>
            <N8AO aoRadius={2} intensity={2} />
            <Bloom luminanceThreshold={0.9} intensity={0.3} mipmapBlur />
            <Vignette offset={0.3} darkness={0.5} />
          </EffectComposer>
        )}

        <Suspense fallback={null}>
          <Ground />
          {/* <Grass /> */}
          <ModelController />
          {import.meta.env.DEV && <FpsTracker />}
          <Environment files="/env/park.hdr" />
        </Suspense>

        <Sky
          distance={450000}
          sunPosition={[0, 1, 0]}
          inclination={0.5}
          azimuth={0.25}
        />
      </Canvas>
      {import.meta.env.DEV && <FpsDisplay />}
    </div>
  );
};

export default Scene;
