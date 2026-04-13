import { useEffect } from 'react'
import './App.css'

import Scene from './components/Scene'
import { createJoystick, createJumpButton } from './components/ButtonOverlay';

const App = () => {
  useEffect(() => {
    const cleanupJoystick = createJoystick();
    const cleanupJumpButton = createJumpButton();
    return () => {
      cleanupJoystick();
      cleanupJumpButton();
    };
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
    triggerJump?: () => void;
  }
}

