import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Silence two harmless third-party warnings:
// - THREE.Clock: deprecated in Three r183 but still used internally by R3F.
// - X4122: Windows-only ANGLE/HLSL float-precision warning from Three's built-in
//   Sky and Environment shaders; they compile and run fine.
const _warn = console.warn.bind(console);
console.warn = (...args) => {
  // Three logs the program log as a later argument, so check them all.
  const str = args.map(a => (typeof a === 'string' ? a : '')).join(' ');
  if (str.includes('THREE.Clock') || str.includes('X4122')) return;
  _warn(...args);
};

createRoot(document.getElementById('root')!).render(<App />)
