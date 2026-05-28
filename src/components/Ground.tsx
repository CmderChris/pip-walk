import React from 'react'
import * as THREE from 'three'
import { useTexture } from '@react-three/drei'

const Ground: React.FC = () => {
  const normalMap = useTexture('/textures/Ground103_1K-PNG_NormalGL.png')
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping
  normalMap.repeat.set(750, 750)

  return (
    <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
      <planeGeometry args={[5000, 5000]} />
      {/* original: #2e4414 | dark dirt: #2e2a14 | warm brown: #6b4423 */}
      <meshStandardMaterial
        color="#2a2a10"
        normalMap={normalMap}
        normalScale={new THREE.Vector2(1.2, 1.2)}
        roughness={1}
        metalness={0}
      />
    </mesh>
  )
}

export default Ground
