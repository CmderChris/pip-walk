import { useRef, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const SHADOW_LAYER = 11;
const MAP_SIZE = 512;
const CAPTURE_SIZE = 6; // world units captured from above — adjust to fit model

type Props = {
  modelRef: React.RefObject<THREE.Group | null>;
};

const ModelShadow = ({ modelRef }: Props) => {
  const { scene: threeScene, gl } = useThree();
  const shadowGroupRef = useRef<THREE.Group>(null!);
  const hasRendered = useRef(false);

  const renderTarget = useMemo(() =>
    new THREE.WebGLRenderTarget(MAP_SIZE, MAP_SIZE, {
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    }), []);

  const captureMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
  }), []);

  const shadowCam = useMemo(() => {
    const cam = new THREE.OrthographicCamera(
      -CAPTURE_SIZE / 2, CAPTURE_SIZE / 2,
       CAPTURE_SIZE / 2, -CAPTURE_SIZE / 2,
      0.1, 20,
    );
    cam.layers.set(SHADOW_LAYER);
    return cam;
  }, []);

  const shadowMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: 0x000000,
    alphaMap: renderTarget.texture,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  }), [renderTarget]);

  useEffect(() => {
    return () => {
      renderTarget.dispose();
      shadowMat.dispose();
      captureMaterial.dispose();
    };
  }, [renderTarget, shadowMat, captureMaterial]);

  useFrame(() => {
    if (!modelRef.current || !shadowGroupRef.current) return;

    const pos = modelRef.current.position;

    // Follow model position and rotation every frame
    shadowGroupRef.current.position.set(pos.x, 0.02, pos.z);
    shadowGroupRef.current.rotation.y = modelRef.current.rotation.y;

    // Render the model silhouette once on the first frame (rest/idle pose)
    if (!hasRendered.current) {
      shadowCam.position.set(pos.x, 10, pos.z);
      shadowCam.lookAt(pos.x, 0, pos.z);
      shadowCam.updateMatrixWorld();

      const prevTarget = gl.getRenderTarget();
      const prevOverride = threeScene.overrideMaterial;
      const prevClearColor = new THREE.Color();
      const prevClearAlpha = gl.getClearAlpha();
      gl.getClearColor(prevClearColor);

      threeScene.overrideMaterial = captureMaterial;
      gl.setRenderTarget(renderTarget);
      gl.setClearColor(0x000000, 0);
      gl.clear();
      gl.render(threeScene, shadowCam);

      gl.setRenderTarget(prevTarget);
      gl.setClearColor(prevClearColor, prevClearAlpha);
      threeScene.overrideMaterial = prevOverride;

      hasRendered.current = true;
    }
  });

  return (
    <group ref={shadowGroupRef}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
        <planeGeometry args={[CAPTURE_SIZE, CAPTURE_SIZE]} />
        <primitive object={shadowMat} attach="material" />
      </mesh>
    </group>
  );
};

export default ModelShadow;
