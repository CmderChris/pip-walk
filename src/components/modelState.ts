import * as THREE from 'three';

// Shared model world position — written by ModelController each frame,
// read by Grass to drive the grass depression effect.
export const modelWorldPos = new THREE.Vector3();
