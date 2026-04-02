import { useBox } from '@react-three/cannon';

const Boundaries = () => {
  const distance = 20;
  const wallThickness = 1;
  const wallHeight = 5;
  
  const [northRef] = useBox(() => ({
    args: [distance * 2, wallHeight, wallThickness],
    position: [0, wallHeight / 2, -distance],
    type: 'Static'
  }));
  
  const [southRef] = useBox(() => ({
    args: [distance * 2, wallHeight, wallThickness],
    position: [0, wallHeight / 2, distance],
    type: 'Static'
  }));
  
  const [westRef] = useBox(() => ({
    args: [wallThickness, wallHeight, distance * 2],
    position: [-distance, wallHeight / 2, 0],
    type: 'Static'
  }));
  
  const [eastRef] = useBox(() => ({
    args: [wallThickness, wallHeight, distance * 2],
    position: [distance, wallHeight / 2, 0],
    type: 'Static'
  }));
  
  return (
    <>
      <mesh ref={northRef} visible={false}>
        <boxGeometry args={[distance * 2, wallHeight, wallThickness]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      <mesh ref={southRef} visible={false}>
        <boxGeometry args={[distance * 2, wallHeight, wallThickness]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      <mesh ref={westRef} visible={false}>
        <boxGeometry args={[wallThickness, wallHeight, distance * 2]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      <mesh ref={eastRef} visible={false}>
        <boxGeometry args={[wallThickness, wallHeight, distance * 2]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </>
  );
};

export default Boundaries
