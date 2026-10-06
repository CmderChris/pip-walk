import './App.css'

import Scene from './components/Scene'

// Standalone dev app: the scene fills the window.
const App = () => (
  <div style={{ position: 'fixed', inset: 0 }}>
    <Scene />
  </div>
);

export default App
