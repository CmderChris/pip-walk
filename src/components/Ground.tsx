import React, { useMemo } from 'react'
import * as THREE from 'three'
import { useTexture } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { isLowEnd } from './perfTier';

const TILE_REPEAT = 100;

const TEXTURES = [
  '/textures/wispy-grass-meadow_albedo.png',
  '/textures/wispy-grass-meadow_normal-ogl.png',
  '/textures/wispy-grass-meadow_ao.png',
  '/textures/wispy-grass-meadow_roughness.png',
];

const Ground: React.FC = () => {
  const { gl } = useThree();
  const [albedo, normal, ao, roughness] = useTexture(TEXTURES);

  useMemo(() => {
    const maxAnisotropy = isLowEnd ? Math.min(4, gl.capabilities.getMaxAnisotropy()) : gl.capabilities.getMaxAnisotropy();
    [albedo, normal, ao, roughness].forEach((tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(TILE_REPEAT, TILE_REPEAT);
      tex.anisotropy = maxAnisotropy;
    });
  }, [albedo, normal, ao, roughness, gl]);

  return (
    <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
      <planeGeometry args={[1000, 1000]} />
      <meshStandardMaterial
        map={albedo}
        normalMap={normal}
        aoMap={ao}
        roughnessMap={roughness}
        roughness={1}
        metalness={0}
      />
    </mesh>
  );
};

export default Ground;
