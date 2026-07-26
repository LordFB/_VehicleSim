import * as THREE from 'three';
import { CAMERA } from '../core/Constants';
import { eventBus, Events } from '../core/EventBus';
import type { PhysicsSnapshot } from '../sim/types';
import { getRaceCameraPose, nextCameraMode, type CameraMode } from './RaceCamera';

export class CameraController {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly onModeChanged: (mode: CameraMode) => void;
  private readonly cameraPosition = new THREE.Vector3();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly desiredCameraPosition = new THREE.Vector3();
  private readonly desiredCameraTarget = new THREE.Vector3();
  private readonly unsubscribe: () => void;
  private initialized = false;
  private currentFov = CAMERA.FOV;
  private currentNear = CAMERA.NEAR;
  private mode: CameraMode = 'onboard';

  constructor(camera: THREE.PerspectiveCamera, onModeChanged: (mode: CameraMode) => void) {
    this.camera = camera;
    this.onModeChanged = onModeChanged;
    this.unsubscribe = eventBus.on(Events.CAMERA_MODE_CYCLE_REQUESTED, () => {
      this.cycleMode();
    });
  }

  getMode(): CameraMode {
    return this.mode;
  }

  setMode(mode: CameraMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.initialized = false;
    this.onModeChanged(mode);
  }

  cycleMode(): CameraMode {
    this.setMode(nextCameraMode(this.mode));
    return this.mode;
  }

  reset(): void {
    this.initialized = false;
  }

  update(snapshot: PhysicsSnapshot, delta: number): void {
    const pose = getRaceCameraPose(snapshot, this.mode);
    this.desiredCameraPosition.copy(pose.position);
    this.desiredCameraTarget.copy(pose.target);
    if (!this.initialized) {
      this.cameraPosition.copy(this.desiredCameraPosition);
      this.cameraTarget.copy(this.desiredCameraTarget);
      this.currentFov = pose.fov;
      this.currentNear = pose.near;
      this.initialized = true;
    }

    const positionAlpha = frameAlpha(pose.positionLerp, delta);
    const targetAlpha = frameAlpha(pose.targetLerp, delta);
    this.cameraPosition.lerp(this.desiredCameraPosition, positionAlpha);
    this.cameraTarget.lerp(this.desiredCameraTarget, targetAlpha);

    this.currentFov += (pose.fov - this.currentFov) * frameAlpha(pose.fovLerp, delta);
    if (Math.abs(this.camera.fov - this.currentFov) > 0.01) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }

    if (Math.abs(this.currentNear - pose.near) > 0.0001) {
      this.currentNear = pose.near;
      this.camera.near = pose.near;
      this.camera.updateProjectionMatrix();
    }

    this.camera.position.copy(this.cameraPosition);
    this.camera.lookAt(this.cameraTarget);
  }

  dispose(): void {
    this.unsubscribe();
  }
}

function frameAlpha(lerp: number, delta: number): number {
  return 1 - Math.pow(1 - lerp, delta * 60);
}
