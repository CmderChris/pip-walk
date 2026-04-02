import { useEffect, useState, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { 
  useGLTF, 
  useAnimations
} from '@react-three/drei';
import * as THREE from 'three';

const MODEL_PATH = '/models/shiba-test.glb';
const ANIMATIONS_PATH = '/models/walking.glb';

// Movement constants
const MOVE_SPEED = 4; // Fixed movement speed
const ROTATION_SPEED = 8;
const MIN_SPEED_FOR_WALK = 0.5;

const ModelController = () => {
  // Model loading
  const { scene } = useGLTF(MODEL_PATH, true);
  const modelRef = useRef<THREE.Group>(null);
  
  // Animation setup
  const { animations } = useGLTF(ANIMATIONS_PATH, true);
  const { ref: animRef, actions } = useAnimations(animations, modelRef);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  
  // Position and movement
  const positionRef = useRef(new THREE.Vector3(0, 0, 0));
  const currentSpeedRef = useRef(0);
  const targetRotationRef = useRef(0);
  const animationWeightRef = useRef(0); // 0 = idle, 1 = walk
  
  // Mixer initialization
  useEffect(() => {
    if (scene && animations.length) {
      mixerRef.current = new THREE.AnimationMixer(scene);
      const action = mixerRef.current.clipAction(animations[0]);
      action.play();
    }
  }, [animations, scene]);
  
  // Animation mixer update
  useFrame((_, delta) => {
    mixerRef.current?.update(delta);
  });
  
  // Input states
  const [keysPressed, setKeysPressed] = useState({
    w: false,
    a: false,
    s: false,
    d: false
  });
  const [joystickState, setJoystickState] = useState({ x: 0, y: 0 });
  
  // WASD key handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd'].includes(key)) {
        setKeysPressed(prev => ({ ...prev, [key]: true }));
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd'].includes(key)) {
        setKeysPressed(prev => ({ ...prev, [key]: false }));
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);
  
  // Joystick controls for mobile
  useEffect(() => {
    window.updateJoystick = (x: number, y: number) => {
      setJoystickState({ x, y });
    };
    
    return () => {
      window.updateJoystick = undefined;
    };
  }, []);

  // Animation blending function
  const updateAnimationWeights = (delta: number, speed: number) => {
    if (!actions) return;
    
    // Calculate target weight based on speed
    const targetWeight = speed > MIN_SPEED_FOR_WALK ? 1 : 0;
    
    // Smoothly interpolate weight
    const weightDelta = (targetWeight - animationWeightRef.current) * 5 * delta;
    animationWeightRef.current = Math.max(0, Math.min(1, animationWeightRef.current + weightDelta));
    
    // Apply weights to animations
    if (actions.idle && actions.walk) {
      actions.idle.setEffectiveWeight(1 - animationWeightRef.current);
      actions.walk.setEffectiveWeight(animationWeightRef.current);
      
      // Ensure both animations are playing
      if (!actions.idle.isRunning()) actions.idle.play();
      if (!actions.walk.isRunning()) actions.walk.play();
    }
  };
  
  // Initialize animations
  useEffect(() => {
    if (actions) {
      // Start with idle animation
      if (actions.idle) {
        actions.idle.play();
      }
      
      // Also load walking animation but set weight to 0
      if (actions.walk) {
        actions.walk.setEffectiveWeight(0);
        actions.walk.play();
      }
    }
    
    return () => {
      if (actions) {
        Object.values(actions).forEach(action => action?.stop());
      }
    };
  }, [actions]);

  // Direct kinematic movement - no physics, just direct position updates
  useFrame((_, delta) => {
    // Get raw input values and combine keyboard + joystick inputs
    const inputX = (keysPressed.d ? 1 : 0) - (keysPressed.a ? 1 : 0) + joystickState.x;
    const inputZ = (keysPressed.s ? 1 : 0) - (keysPressed.w ? 1 : 0) + joystickState.y;
    
    // Create input vector and check if there's any input
    const inputVector = new THREE.Vector3(inputX, 0, inputZ);
    const hasInput = inputVector.lengthSq() > 0.01;
    
    // Handle movement
    if (hasInput) {
      // Normalize input vector to ensure consistent direction
      const moveDirection = inputVector.clone().normalize();
      
      // Set current speed immediately to full speed when there's input
      currentSpeedRef.current = MOVE_SPEED;
      
      // Apply movement directly - this guarantees uniform speed in all directions
      const moveX = moveDirection.x * MOVE_SPEED * delta;
      const moveZ = moveDirection.z * MOVE_SPEED * delta;
      
      // Update position directly
      positionRef.current.x += moveX;
      positionRef.current.z += moveZ;
      
      // Update target rotation based on movement direction
      targetRotationRef.current = Math.atan2(moveDirection.x, moveDirection.z);
    } else {
      // No input - stop moving
      currentSpeedRef.current = 0;
    }
    
    // Update animation based on current speed
    updateAnimationWeights(delta, currentSpeedRef.current);
    
    // Apply position and rotation to model
    if (modelRef.current) {
      // Update model position
      modelRef.current.position.copy(positionRef.current);
      modelRef.current.position.y = 0; // Keep at ground level
      
      // Smoothly rotate model to face movement direction
      if (currentSpeedRef.current > MIN_SPEED_FOR_WALK) {
        const currentRotation = modelRef.current.rotation.y;
        const rotationDelta = targetRotationRef.current - currentRotation;
        
        // Handle angle wrapping for shortest rotation path
        let shortestRotation = ((rotationDelta + Math.PI) % (Math.PI * 2)) - Math.PI;
        if (shortestRotation < -Math.PI) shortestRotation += Math.PI * 2;
        
        // Apply smooth rotation
        modelRef.current.rotation.y += shortestRotation * ROTATION_SPEED * delta;
      }
    }
  });
  
  return (
    <group ref={modelRef}>
      <primitive 
        object={scene} 
        scale={1} 
        ref={animRef}
      />
    </group>
  );
};

export default ModelController;