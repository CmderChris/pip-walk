import { useFrame, useLoader } from '@react-three/fiber';
import React, { useCallback, useEffect, useRef } from 'react';
import { GLTFLoader } from 'three/examples/jsm/Addons.js'
// import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

import { Mesh } from 'three';

interface Animations {
  [name: string]: {
    clip: THREE.AnimationAction;
  };
}

interface CharacterProps {
  url: string
}
const Character: React.FC<CharacterProps> = ({ url }) => {
  console.log({ url })
  const character = useRef<Mesh>(null!);

  const activeAnimation: {
    forward: boolean;
    backward: boolean;
    left: boolean;
    right: boolean;
    run: boolean;
  } = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    run: false
  };

  const animations: Animations = {};


  // let mixer
  //   if (gltfModel.animations.length) {
  //       mixer = new THREE.AnimationMixer(gltfModel.scene)
  //       console.log({ animations: gltfModel.animations })
  //       gltfModel.animations.forEach(clip => {
  //           const action = mixer.clipAction(clip)
  //           action.play()
  //       })
  //   }

  //   useFrame((state, delta) => {
  //       mixer?.update(delta)
  //   })

  const c = useLoader(GLTFLoader, url);
  // animations, asset, cameras, materials, meshes, nodes, parser, scene, scenes, userData

  console.log({ c })

  c.scene.scale.setScalar(0.1);
  c.scene.traverse((f) => {
    f.castShadow = true;
    f.receiveShadow = true;
  });

  const mixer = new THREE.AnimationMixer(c.scene);

  useFrame((_state, delta) => {
    mixer?.update(delta)
  })

   useEffect(() => {
      if (c) {
        c.scene.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true
            child.receiveShadow = true
          }
        })
      }
  }, [c])

  // const idle = useGLTF('/models/Black-Shib-Inu.glb');

  // animations['idle'] = {
  //   clip: mixer.clipAction(idle.animations[0]),
  // };

  // const walk = useGLTF('./character/walking.fbx');

  animations['walk'] = {
    clip: mixer.clipAction(c.animations[0]),
  };

  // if (c.animations.length) {
  //   c.animations.forEach(clip => {
  //       const action = mixer.clipAction(clip)
  //       action.play()
  //   })

  //   animations['walk'] = {
  //     clip: mixer.clipAction(c.animations[0]),
  //   };
  // }

  // const run = useGLTF('./character/running.fbx');

  // animations['run'] = {
  //   clip: mixer.clipAction(run.animations[0]),
  // };

  // const dance = useGLTF('./character/dance.fbx');

  // animations['dance'] = {
  //   clip: mixer.clipAction(dance.animations[0]),
  // };

  // set current Action
  let currAction = animations['walk'].clip;
  // Control Input
  const handleKeyPress = useCallback((event: KeyboardEvent) => {
    switch (event.keyCode) {
      case 87: activeAnimation.forward = true; //w
        break;
      case 65: activeAnimation.left = true; //a
        break;
      case 83: activeAnimation.backward = true; //s
        break;
      case 68: activeAnimation.right = true; // d
        break;
    }
  }, []);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    switch (event.keyCode) {
      case 87: activeAnimation.forward = false; //w
        break;
      case 65: activeAnimation.left = false; //a
        break;
      case 83: activeAnimation.backward = false; //s
        break;
      case 68: activeAnimation.right = false; // d
        break;
    }
  }, []);

  // movement
  // const characterState = (delta: number) => {
  //   const newVelocity = velocity;
  //   const frameDecceleration = new THREE.Vector3(
  //     newVelocity.x * decceleration.x,
  //     newVelocity.y * decceleration.y,
  //     newVelocity.z * decceleration.z
  //   );
  //   frameDecceleration.multiplyScalar(delta);
  //   frameDecceleration.z =
  //     Math.sign(frameDecceleration.z) *
  //     Math.min(Math.abs(frameDecceleration.z), Math.abs(newVelocity.z));

  //   newVelocity.add(frameDecceleration);

  //   console.log({ character })

  //   const controlObject = character.current;
  //   const _Q = new THREE.Quaternion();
  //   const _A = new THREE.Vector3();
  //   const _R = controlObject.quaternion.clone();

  //   const acc = acceleration.clone();
  //   if (activeAnimation.run) {
  //     acc.multiplyScalar(2.0);
  //   }

  //   // if (currAction === animations['dance'].clip) {
  //   //   acc.multiplyScalar(0.0);
  //   // }

  //   if (activeAnimation.forward) {
  //     newVelocity.z += acc.z * delta;
  //   }
  //   if (activeAnimation.backward) {
  //     newVelocity.z -= acc.z * delta;
  //   }
  //   if (activeAnimation.left) {
  //     _A.set(0, 1, 0);
  //     _Q.setFromAxisAngle(_A, 4.0 * Math.PI * delta * acceleration.y);
  //     _R.multiply(_Q);
  //   }
  //   if (activeAnimation.right) {
  //     _A.set(0, 1, 0);
  //     _Q.setFromAxisAngle(_A, 4.0 * -Math.PI * delta * acceleration.y);
  //     _R.multiply(_Q);
  //   }

  //   controlObject.quaternion.copy(_R);

  //   const oldPosition = new THREE.Vector3();
  //   oldPosition.copy(controlObject.position);

  //   const forward = new THREE.Vector3(0, 0, 1);
  //   forward.applyQuaternion(controlObject.quaternion);
  //   forward.normalize();

  //   const sideways = new THREE.Vector3(1, 0, 0);
  //   sideways.applyQuaternion(controlObject.quaternion);
  //   sideways.normalize();

  //   sideways.multiplyScalar(newVelocity.x * delta);
  //   forward.multiplyScalar(newVelocity.z * delta);

  //   controlObject.position.add(forward);
  //   controlObject.position.add(sideways);

  //   character.current.position.copy(controlObject.position);
  //   updateCameraTarget(delta);
  // };

  // useFrame((state, delta) => {
  //   prevAction = currAction;

  //   if (activeAnimation.forward) {
  //     if (activeAnimation.run) {
  //       currAction = animations['walk'].clip;
  //     }
  //   } else if (activeAnimation.left) {
  //     if (activeAnimation.run) {
  //       currAction = animations['walk'].clip;
  //     }
  //   } else if (activeAnimation.right) {
  //     if (activeAnimation.run) {
  //       currAction = animations['walk'].clip;
  //     }
  //   } else if (activeAnimation.backward) {
  //     if (activeAnimation.run) {
  //       currAction = animations['walk'].clip;
  //     }
  //   } else {
  //     currAction = animations['walk'].clip;
  //   }

  //   if (prevAction !== currAction) {
  //     prevAction.fadeOut(0.2);

  //     if (prevAction === animations['walk'].clip) {
  //       const ratio =
  //         currAction.getClip().duration / prevAction.getClip().duration;
  //       currAction.time = prevAction.time * ratio;
  //     }

  //     currAction.reset().play();
  //   } else {
  //     currAction.play();
  //   }

  //   characterState(delta);
  //   const idealLookat = calculateIdealLookat();

  //   state.camera.lookAt(idealLookat);
  //   state.camera.updateProjectionMatrix();
  //   mixer?.update(delta);
  // });

  useEffect(() => {
    document.addEventListener('keydown', handleKeyPress);

    document.addEventListener('keyup', handleKeyUp);
    currAction.play();
    return () => {
      document.removeEventListener('keydown', handleKeyPress);

      document.removeEventListener('keyup', handleKeyUp);
    };
  });

  return <primitive object={c} ref={character} dispose={null} />;
};

export default Character;
