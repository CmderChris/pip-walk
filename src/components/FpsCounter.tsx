import { useRef, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { isLowEnd } from './perfTier';

const TARGET_FPS = isLowEnd ? 30 : 60;

// Written by FpsTracker (inside Canvas), read by FpsDisplay (outside).
export const fpsRef = { current: 0 };

// Inside <Canvas>; renders no DOM.
export const FpsTracker = () => {
  const frameCount = useRef(0);
  const elapsed = useRef(0);

  useFrame((_, delta) => {
    frameCount.current++;
    elapsed.current += delta;
    if (elapsed.current >= 1) {
      fpsRef.current = Math.round(frameCount.current / elapsed.current);
      frameCount.current = 0;
      elapsed.current = 0;
    }
  });

  return null;
};

// Outside <Canvas>; plain DOM.
export const FpsDisplay = () => {
  const [fps, setFps] = useState<number | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      setFps(fpsRef.current || null);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const color =
    fps === null             ? '#ffffff'
    : fps >= TARGET_FPS      ? '#00e676'
    : fps >= TARGET_FPS * 0.75 ? '#ffab40'
    : '#ff5252';

  return (
    <div style={{
      position: 'fixed',
      top: 10,
      right: 10,
      padding: '3px 8px',
      background: 'rgba(0,0,0,0.55)',
      borderRadius: 4,
      fontFamily: 'monospace',
      fontSize: 13,
      color,
      userSelect: 'none',
      pointerEvents: 'none',
      zIndex: 9999,
    }}>
      {fps === null ? '-- fps' : `${fps} / ${TARGET_FPS} fps`}
    </div>
  );
};
