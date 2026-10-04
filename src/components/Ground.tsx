import React, { useLayoutEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'

const Ground: React.FC = () => {
  const normalMap = useTexture('/textures/Ground103_1K-PNG_NormalGL.png')
  const maxAnisotropy = useThree((state) => state.gl.capabilities.getMaxAnisotropy())
  const normalScale = useMemo(() => new THREE.Vector2(1.2, 1.2), [])

  // needsUpdate pushes sampler changes to the GPU; anisotropy keeps the tiled
  // normal map sharp at grazing angles.
  useLayoutEffect(() => {
    normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping
    normalMap.repeat.set(750, 750)
    normalMap.anisotropy = maxAnisotropy
    normalMap.needsUpdate = true
  }, [normalMap, maxAnisotropy])

  return (
    <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
      <planeGeometry args={[5000, 5000]} />
      {/* original: #2e4414 | dark dirt: #2e2a14 | warm brown: #6b4423 */}
      <meshStandardMaterial
        color="#2a2a10"
        normalMap={normalMap}
        normalScale={normalScale}
        roughness={1}
        metalness={0}
      />
    </mesh>
  )
}

export default Ground
