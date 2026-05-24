import { useRef, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { isLowEnd } from './perfTier';

const TARGET_FPS = isLowEnd ? 30 : 60;

// Shared ref — the inner tracker (inside Canvas) writes here,
// the outer display (outside Canvas) reads it.
export const fpsRef = { current: 0 };

// Rendered inside <Canvas> — uses useFrame, produces no DOM.
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

// Rendered outside <Canvas> — plain DOM, no R3F involvement.
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
