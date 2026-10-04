import * as THREE from 'three';

// Model world position: ModelController writes it each frame, Grass reads it.
export const modelWorldPos = new THREE.Vector3();

// 0 = walking/idle, 1 = sitting. ModelController writes it, Grass eases toward it.
export const modelSitAmountRef = { value: 0 };

// 1 = paws on the ground, 0 = airborne. Fades grass ground contact during jumps.
export const modelGroundedRef = { value: 1 };

// XZ forward direction, from the model's Y rotation.
export const modelForwardRef = { value: new THREE.Vector2(0, 1) };

// Front paw world positions (fL, fR). Back paws are covered by the body sit zone.
export const modelPawPositions = [
  new THREE.Vector3(9999, 0, 9999),
  new THREE.Vector3(9999, 0, 9999),
];
