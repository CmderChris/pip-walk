import { useRef, useEffect } from 'react'

import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF, useAnimations } from '@react-three/drei'

const MODEL_PATH = '/models/shiba-test.glb'

const Model = ({ movementVector }: Props) => {
  const ref = useRef<THREE.Group>(null!)
  const { scene, animations } = useGLTF(MODEL_PATH)
  const { actions } = useAnimations(animations, ref)
  const { viewport } = useThree()

  const speed = 2

  useEffect(() => {
    actions?.Idle?.play()
  }, [actions])

  useFrame((_, delta) => {
    if (!ref.current) return

    const move = { x: movementVector.x, z: movementVector.z }
    const magnitude = Math.sqrt(move.x ** 2 + move.z ** 2)

    if (magnitude > 0.01) {
      const normX = move.x / magnitude
      const normZ = move.z / magnitude

      ref.current.position.x += normX * speed * delta
      ref.current.position.z += normZ * speed * delta

      const angle = Math.atan2(normX, normZ)
      ref.current.rotation.set(0, angle, 0)

      actions?.Idle?.fadeOut(0.2)
      actions?.Walk?.fadeIn(0.2)?.play()
    } else {
      actions?.Walk?.fadeOut(0.2)
      actions?.Idle?.fadeIn(0.2)?.play()
    }

    // Bounding box (optional)
    const halfW = viewport.width / 2 - 0.5
    const halfH = viewport.height / 2 - 0.5
    ref.current.position.x = Math.max(-halfW, Math.min(halfW, ref.current.position.x))
    ref.current.position.z = Math.max(-halfH, Math.min(halfH, ref.current.position.z))
  })

  return <primitive ref={ref} object={scene} scale={1} />
}

export default Model

type Props = {
  movementVector: { x: number; z: number }
}
