import React, { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import { cameraFocus } from './modelState'
import { useAssetUrl } from './assets'
import { GROUND_NORMAL_PATH } from './modelConfig'
import { curveDropGLSL, curveUniforms } from './worldCurve'

// The plane only needs to reach past the fog (80 from the camera, which sits ~16 behind
// the focus) and the curved horizon. It follows the camera focus in whole texture tiles,
// so the world-space texture pattern never shifts. 200/30 keeps the original 6.67-unit tile.
const GROUND_SIZE = 200
const GROUND_REPEAT = 30
const TILE = GROUND_SIZE / GROUND_REPEAT
// Enough vertices (5 units apart) to follow the curve smoothly (a flat quad can't bend).
const GROUND_SEGMENTS = 40

const Ground: React.FC = () => {
  const assetUrl = useAssetUrl()
  const normalMap = useTexture(assetUrl(GROUND_NORMAL_PATH))
  const maxAnisotropy = useThree((state) => state.gl.capabilities.getMaxAnisotropy())
  const normalScale = useMemo(() => new THREE.Vector2(1.2, 1.2), [])
  const meshRef = useRef<THREE.Mesh>(null)

  // needsUpdate pushes sampler changes to the GPU; anisotropy keeps the tiled
  // normal map sharp at grazing angles.
  useLayoutEffect(() => {
    normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping
    normalMap.repeat.set(GROUND_REPEAT, GROUND_REPEAT)
    normalMap.anisotropy = maxAnisotropy
    normalMap.needsUpdate = true
  }, [normalMap, maxAnisotropy])

  // The plane is rotated flat, so its local +Z is world up: dropping local Z bends
  // the ground. Done in begin_vertex so shadow lookups see the bent position too.
  const onBeforeCompile = useMemo(() => (shader: THREE.WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, curveUniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${curveDropGLSL}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vec4 curveWorld = modelMatrix * vec4(transformed, 1.0);
         transformed.z -= curveDrop(curveWorld.xz);`
      )
  }, [])

  useFrame(() => {
    const mesh = meshRef.current
    if (!mesh) return
    mesh.position.x = Math.round(cameraFocus.x / TILE) * TILE
    mesh.position.z = Math.round(cameraFocus.y / TILE) * TILE
  })

  return (
    <mesh ref={meshRef} receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
      <planeGeometry args={[GROUND_SIZE, GROUND_SIZE, GROUND_SEGMENTS, GROUND_SEGMENTS]} />
      {/* original: #2e4414 | dark dirt: #2e2a14 | warm brown: #6b4423 */}
      <meshStandardMaterial
        color="#2a2a10"
        normalMap={normalMap}
        normalScale={normalScale}
        roughness={1}
        metalness={0}
        onBeforeCompile={onBeforeCompile}
      />
    </mesh>
  )
}

export default Ground
