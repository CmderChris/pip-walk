import * as THREE from 'three';

// Shared model world position — written by ModelController each frame,
// read by Grass to drive the grass depression effect.
export const modelWorldPos = new THREE.Vector3();

// 0 = walking/idle, 1 = fully sitting. ModelController writes, Grass lerps toward it.
export const modelSitAmountRef = { value: 0 };

// 1 = paws on the ground, 0 = fully airborne. ModelController writes it from
// jump height; Grass uses it to fade out ground-contact effects while jumping.
export const modelGroundedRef = { value: 1 };

// XZ forward direction of the model, updated each frame from its Y rotation.
export const modelForwardRef = { value: new THREE.Vector2(0, 1) };

// Front paw world positions (fL, fR) — written by ModelController each frame.
// Back paws omitted: they're near the body sit zone which already handles them.
export const modelPawPositions = [
  new THREE.Vector3(9999, 0, 9999),
  new THREE.Vector3(9999, 0, 9999),
];
