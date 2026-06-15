import * as THREE from 'three';
import { CAMERA } from '../core/Constants';
import type { PhysicsSnapshot } from '../sim/types';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);

export type RaceCameraPose = {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
};

export function getRaceCameraPose(snapshot: PhysicsSnapshot): RaceCameraPose {
  const carPosition = new THREE.Vector3(...snapshot.chassis.position);
  const orientation = new THREE.Quaternion(...snapshot.chassis.orientation);
  const forward = FORWARD.clone().applyQuaternion(orientation);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
  forward.normalize();

  const speed = Math.hypot(snapshot.linearVelocity[0], snapshot.linearVelocity[2]);
  const speedT = Math.min(1, speed / CAMERA.FOV_SPEED_REF_MPS);
  const lookAhead = CAMERA.LOOK_AHEAD_DISTANCE + CAMERA.LOOK_AHEAD_SPEED_GAIN * speedT;

  return {
    position: carPosition
      .clone()
      .add(forward.clone().multiplyScalar(-CAMERA.FOLLOW_DISTANCE))
      .add(WORLD_UP.clone().multiplyScalar(CAMERA.FOLLOW_HEIGHT)),
    target: carPosition
      .clone()
      .add(forward.clone().multiplyScalar(lookAhead))
      .add(WORLD_UP.clone().multiplyScalar(CAMERA.LOOK_HEIGHT)),
    fov: CAMERA.FOV + CAMERA.FOV_SPEED_GAIN * speedT,
  };
}
