import React from 'react'

const Ground: React.FC = () => {
  return (
    <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
      <planeGeometry args={[5000, 5000]} />
      {/* original grass-match green: #2e4414 */}
      <meshBasicMaterial color="#2e2a14" />
    </mesh>
  );
};

export default Ground;
