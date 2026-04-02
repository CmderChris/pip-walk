import { usePlane } from '@react-three/cannon'

const FLOOR_SIZE = 200;

const Floor = () => {
  const [ref] = usePlane(() => ({
    rotation: [-Math.PI / 2, 0, 0],
    position: [0, 0, 0],
    type: 'Static'
  }));

  return (
    <mesh ref={ref} receiveShadow>
      <planeGeometry args={[FLOOR_SIZE, FLOOR_SIZE]} />
      <meshStandardMaterial 
        color="#3a7e4d"
        roughness={0.8}
        metalness={0.1}
      />
    </mesh>
  );
};

export default Floor

