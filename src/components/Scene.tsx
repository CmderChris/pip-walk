import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { Sky, Environment } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, N8AO } from '@react-three/postprocessing';
import { isLowEnd, canvasDpr } from './perfTier';
import { SUN_POSITION, FOG_NEAR, FOG_FAR, ENV_PATH } from './modelConfig';
import { AssetContext, joinAssetPath } from './assets';
import { createJoystick, createJumpButton } from './ButtonOverlay';
import { resetSceneState } from './resetState';

import CameraController from './CameraController';
import Ground from './Ground';
import Grass from './Grass';
import ModelController from './ModelController';
import StartScreen from './StartScreen';
import { FpsTracker, FpsDisplay } from './FpsCounter';

export interface SceneProps {
  /** Folder the model, textures and environment map are served from. Default "/". */
  assetBase?: string;
  /** "auto" shows the on-screen joystick and jump button on touch devices. */
  controls?: 'auto' | 'none';
  /** Stops rendering (keeps the scene mounted) while true. */
  paused?: boolean;
  /** Shows a Start button over the scene; input is ignored until it's clicked. Default true. */
  showStartButton?: boolean;
  /** Called once the scene has loaded and rendered its first frames. */
  onReady?: () => void;
  /** Called when the user clicks Start. */
  onStart?: () => void;
  showFps?: boolean;
  className?: string;
  style?: CSSProperties;
}

// Inside the Suspense boundary: React doesn't mount it until the model, textures and
// environment have loaded. Waits a few frames so shader compiles don't land after Start.
const READY_FRAMES = 3;
const ReadySignal = ({ onReady }: { onReady: () => void }) => {
  const frames = useRef(0);
  useFrame(() => {
    if (frames.current > READY_FRAMES) return;
    if (++frames.current === READY_FRAMES) onReady();
  });
  return null;
};

// Fills its parent (give the parent a size). Positioned, so the on-screen controls sit inside it.
const Scene = ({
  assetBase = '/',
  controls = 'auto',
  paused = false,
  showStartButton = true,
  onReady,
  onStart,
  showFps = import.meta.env.DEV,
  className,
  style,
}: SceneProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(!showStartButton);

  // Latest callbacks without re-creating handleReady (it's called from inside the Canvas)
  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  const handleReady = useCallback(() => {
    setReady(true);
    onReadyRef.current?.();
  }, []);

  const handleStart = () => {
    setStarted(true);
    onStart?.();
  };

  // Touch controls appear once the user has started
  useEffect(() => {
    const container = containerRef.current;
    if (!container || controls === 'none' || !started) return;
    const cleanupJoystick = createJoystick(container);
    const cleanupJumpButton = createJumpButton(container);
    return () => {
      cleanupJoystick();
      cleanupJumpButton();
    };
  }, [controls, started]);

  // Start fresh on the next visit instead of resuming mid-gust, mid-scroll, or at a thinned density
  useEffect(() => resetSceneState, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', ...style }}
    >
      <Canvas
        frameloop={paused ? 'never' : 'always'}
        shadows={isLowEnd ? false : { type: THREE.PCFShadowMap }}
        dpr={canvasDpr}
        resize={{ scroll: false, debounce: { scroll: 50, resize: 50 } }}
      >
        {/* Context doesn't cross R3F's reconciler, so provide it inside the Canvas */}
        <AssetContext.Provider value={assetBase}>
          <fog attach="fog" args={['#c8d8b0', FOG_NEAR, FOG_FAR]} />

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
            <Grass />
            <ModelController inputEnabled={started && !paused} />
            <ReadySignal onReady={handleReady} />
            {showFps && <FpsTracker />}
            <Environment files={joinAssetPath(assetBase, ENV_PATH)} />
          </Suspense>

          <Sky
            distance={450000}
            sunPosition={SUN_POSITION.toArray()}
            inclination={0.5}
            azimuth={0.25}
          />
        </AssetContext.Provider>
      </Canvas>
      {showFps && <FpsDisplay />}
      {!started && <StartScreen ready={ready} onStart={handleStart} />}
    </div>
  );
};

export default Scene;
