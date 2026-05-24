import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Suppress known third-party warnings that don't affect correctness:
//
// 1. THREE.Clock — deprecated in Three.js r183, used internally by R3F which hasn't updated yet.
//    Track: https://github.com/pmndrs/react-three-fiber/issues
//
// 2. X4122 — Windows-only ANGLE/HLSL compile-time precision warning. ANGLE translates WebGL
//    GLSL to DirectX HLSL and the D3D compiler warns when float constants can't be represented
//    exactly in double precision. The shader compiles and runs correctly; this is pure noise on
//    Windows. Originates from Three.js built-in shaders (Sky, Environment).
const _warn = console.warn.bind(console);
console.warn = (...args) => {
  // Three.js passes the program log as a second argument:
  // console.warn('THREE.WebGLProgram: Program Info Log:', programLog)
  // so X4122 appears in args[1], not args[0]. Check all args.
  const str = args.map(a => (typeof a === 'string' ? a : '')).join(' ');
  if (str.includes('THREE.Clock') || str.includes('X4122')) return;
  _warn(...args);
};

createRoot(document.getElementById('root')!).render(<App />)
