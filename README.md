# Pip Walk

A small interactive 3D scene: Walk a Pomeranian around a grass field. Built with React, TypeScript, Vite and react-three-fiber.

## Features

- Walk, idle, sit, scratch and jump animations, blended by a state machine in `ModelController`
- Custom instanced-grass shader with wind, plus bending around the dog's paws and body
- Real-time shadows, environment lighting, fog and post-processing (AO, bloom, vignette)
- Keyboard, mouse and touch controls
- Performance tiers: low-end and mobile devices get a lighter scene

## Getting started

Requires Node 24.14.1 or newer.

```bash
npm install
npm run dev      # dev server, exposed on the local network (--host)
npm run build    # type-check and production build
npm run preview  # serve the production build
npm run lint
```

## Using it in another site

The scene is also a package. `npm run build:lib` bundles `src/lib/index.ts` into `dist/` (React, three and the R3F packages are peer dependencies). Install it from git (it builds on install through `prepare`), or use `npm link` while developing.

```tsx
import { lazy, Suspense } from 'react';
const PipWalk = lazy(() => import('pip-walk').then((m) => ({ default: m.PipWalk })));

// The component fills its parent, so give the parent a size
<div style={{ height: '100vh' }}>
  <Suspense fallback={null}>
    <PipWalk assetBase="/pip-walk/" />
  </Suspense>
</div>
```

The model, textures and environment map are not bundled. Copy `node_modules/pip-walk/public/*` into the host's `public/pip-walk/` and pass that folder as `assetBase` (default `/`).

| Prop | Default | Purpose |
| --- | --- | --- |
| `assetBase` | `/` | Folder the assets are served from |
| `controls` | `'auto'` | `'none'` hides the on-screen joystick and jump button |
| `paused` | `false` | Stops rendering and ignores input while the scene stays mounted |
| `showStartButton` | `true` | Shows a Start button over the scene (click or Enter once loaded); it loads in the background and input (including the touch controls) is ignored until Start is clicked |
| `onReady` | | Called once the scene has loaded and rendered its first frames |
| `onStart` | | Called when Start is clicked |
| `showFps` | `false` in the package | FPS readout |
| `className`, `style` | | Applied to the wrapper |

Set `resolve.dedupe: ['three', 'react', 'react-dom']` in the host's Vite config so there is only one copy of three.

## Controls

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Move | WASD or arrow keys | Joystick (bottom left) |
| Jump | Space | Jump button (bottom right) |
| Pet | Click the dog | Tap the dog |

The dog sits after about 10 seconds of standing still. Clicking it while it stands plays the petting animation, and clicking it while it sits makes it scratch.

## Project structure

```
src/
  main.tsx                 Dev app entry point
  App.tsx                  Dev app: the scene filling the window
  lib/index.ts             Package entry (exports PipWalk)
  components/
    Scene.tsx              Canvas, lights, fog, sky, post-processing
    ModelController.tsx    Dog model: input, movement, animation state machine, shadow light
    Grass.tsx              Instanced grass field and its shaders
    Ground.tsx             Ground plane
    CameraController.tsx   Camera position and FOV
    StartScreen.tsx        Start button shown over the scene until it's clicked
    ButtonOverlay.tsx      On-screen joystick and jump button (touch devices)
    FpsCounter.tsx         FPS readout (dev builds only)
    modelConfig.ts         Animation names, tuning values, sun position, fog distances
    modelState.ts          Values the dog shares with the grass each frame
    animationHelpers.ts    Animation weight helper
    perfTier.ts            Low-end device detection
public/
  models/                  Dog model and textures
  textures/                Ground textures
  env/                     HDR environment map
```

## How it fits together

- `ModelController` writes the dog's position, facing, sit amount, paw positions and ground contact to the objects in `modelState.ts`. `Grass` reads them each frame and feeds them to its shaders as uniforms.
- Grass is split into distance bands, and each band into angular wedges. Every wedge is its own instanced mesh so Three.js can cull the ones that are out of view.
- `modelConfig.ts` is the place to tune speeds, blend times, the sun position and the fog distances. The sun and fog values are shared by the lighting, the grass shaders and the scene fog.

## Performance tiers

`perfTier.ts` treats a device as low-end if it has a mobile user agent (including iPadOS) or four or fewer CPU threads. Low-end devices render at a device pixel ratio of 1, with no real-time shadows, no post-processing and fewer grass blades.

## Tech

React 19, TypeScript, Vite, Three.js, `@react-three/fiber`, `@react-three/drei` and `@react-three/postprocessing`. See `package.json` for exact versions.
