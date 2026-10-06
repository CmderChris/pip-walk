import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Library build: `npm run build:lib` bundles src/lib/index.ts into dist/.
// React, three and the R3F packages stay external (the host site provides them).
const externals = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  'three',
  /^three\//,
  '@react-three/fiber',
  '@react-three/drei',
  '@react-three/postprocessing',
]

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: {
    lib: {
      entry: 'src/lib/index.ts',
      formats: ['es'],
      fileName: 'pip-walk',
    },
    rollupOptions: { external: externals },
    sourcemap: true,
  },
})
