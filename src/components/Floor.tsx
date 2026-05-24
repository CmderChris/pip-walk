import { usePlane } from '@react-three/cannon'

const FLOOR_SIZE = 200;

const Floor = () => {
  const [ref] = usePlane(() => ({
    rotation: [-Math.PI / 2, 0, 0],
    position: [0, 0, 0],
    type: 'Static'
  }));

  return (
    <mesh ref={ref} visible={false}>
      <planeGeometry args={[FLOOR_SIZE, FLOOR_SIZE]} />
      <meshBasicMaterial />
    </mesh>
  );
};

export default Floor

