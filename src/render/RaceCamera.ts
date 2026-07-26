import * as THREE from 'three';
import { CAMERA } from '../core/Constants';
import type { PhysicsSnapshot } from '../sim/types';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const FALLBACK_FORWARD = new THREE.Vector3(0, 0, 1);
const FORWARD = new THREE.Vector3(0, 0, 1);

export const CAMERA_MODES = ['onboard', 'nose'] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

export type RaceCameraPose = {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
  positionLerp: number;
  targetLerp: number;
  fovLerp: number;
  near: number;
};

export function nextCameraMode(mode: CameraMode): CameraMode {
  const index = CAMERA_MODES.indexOf(mode);
  return CAMERA_MODES[(index + 1) % CAMERA_MODES.length];
}

export function getRaceCameraPose(snapshot: PhysicsSnapshot, mode: CameraMode = 'onboard'): RaceCameraPose {
  return mode === 'nose' ? nosePose(snapshot) : onboardPose(snapshot);
}

function onboardPose(snapshot: PhysicsSnapshot): RaceCameraPose {
  const speedT = Math.min(1, horizontalSpeed(snapshot) / CAMERA.ONBOARD.SPEED_REF_MPS);
  const lateralHead = clamp(
    -(snapshot.telemetry?.sideslipRad ?? 0) * CAMERA.ONBOARD.SIDESLIP_HEAD_GAIN -
      snapshot.angularVelocity[1] * CAMERA.ONBOARD.YAW_HEAD_GAIN,
    -0.07,
    0.07,
  );
  const heave = speedT * CAMERA.ONBOARD.SPEED_HEAVE - (snapshot.telemetry?.brake ?? 0) * CAMERA.ONBOARD.BRAKE_DIVE;
  const eye = localYawOffset(snapshot, [
    CAMERA.ONBOARD.EYE_OFFSET[0] + lateralHead,
    CAMERA.ONBOARD.EYE_OFFSET[1] + heave,
    CAMERA.ONBOARD.EYE_OFFSET[2],
  ]);
  const target = localYawOffset(snapshot, CAMERA.ONBOARD.LOOK_OFFSET);

  return {
    position: eye,
    target,
    fov: CAMERA.ONBOARD.FOV,
    positionLerp: CAMERA.ONBOARD.POSITION_LERP,
    targetLerp: CAMERA.ONBOARD.TARGET_LERP,
    fovLerp: CAMERA.ONBOARD.FOV_LERP,
    near: CAMERA.ONBOARD.NEAR,
  };
}

function nosePose(snapshot: PhysicsSnapshot): RaceCameraPose {
  return {
    position: localYawOffset(snapshot, CAMERA.NOSE.EYE_OFFSET),
    target: localYawOffset(snapshot, CAMERA.NOSE.LOOK_OFFSET),
    fov: CAMERA.NOSE.FOV,
    positionLerp: CAMERA.NOSE.POSITION_LERP,
    targetLerp: CAMERA.NOSE.TARGET_LERP,
    fovLerp: CAMERA.NOSE.FOV_LERP,
    near: CAMERA.NOSE.NEAR,
  };
}

function localYawOffset(snapshot: PhysicsSnapshot, offset: [number, number, number]): THREE.Vector3 {
  const origin = new THREE.Vector3(...snapshot.chassis.position);
  const forward = stableForward(snapshot);
  const right = stableRight(forward);
  return origin
    .add(right.multiplyScalar(offset[0]))
    .add(WORLD_UP.clone().multiplyScalar(offset[1]))
    .add(forward.multiplyScalar(offset[2]));
}

function stableForward(snapshot: PhysicsSnapshot): THREE.Vector3 {
  const orientation = new THREE.Quaternion(...snapshot.chassis.orientation);
  const forward = FORWARD.clone().applyQuaternion(orientation);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) return FALLBACK_FORWARD.clone();
  return forward.normalize();
}

function stableRight(forward: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(forward.z, 0, -forward.x).normalize();
}

function horizontalSpeed(snapshot: PhysicsSnapshot): number {
  return Math.hypot(snapshot.linearVelocity[0], snapshot.linearVelocity[2]);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
