import { useEffect } from 'react'
import './App.css'

import Scene from './components/Scene'
import { createJoystick } from './components/JoystickOverlay';

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

