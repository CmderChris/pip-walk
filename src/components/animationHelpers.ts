import * as THREE from 'three';

export type AnimationActions = {
  walk: THREE.AnimationAction | null;
  idle: THREE.AnimationAction | null;
  sitStart: THREE.AnimationAction | null;
  sitIdle: THREE.AnimationAction | null;
  sitEnd: THREE.AnimationAction | null;
  jumpStart: THREE.AnimationAction | null;
  jumpAir: THREE.AnimationAction | null;
  jumpLand: THREE.AnimationAction | null;
  jumpStartMove: THREE.AnimationAction | null;
  jumpAirMove: THREE.AnimationAction | null;
  jumpLandMove: THREE.AnimationAction | null;
  scratch: THREE.AnimationAction | null;
  petStand: THREE.AnimationAction | null;
};

/**
 * Sets effective weights on all actions. Any key not present in `weights`
 * is zeroed out automatically.
 */
export function setWeights(
  actions: AnimationActions,
  weights: Partial<Record<keyof AnimationActions, number>>
): void {
  for (const key of Object.keys(actions) as (keyof AnimationActions)[]) {
    actions[key]?.setEffectiveWeight(weights[key] ?? 0);
  }
}
