import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { CAMERA } from '../../src/core/Constants';
import { eventBus } from '../../src/core/EventBus';
import { CameraController } from '../../src/render/CameraController';
import type { PhysicsSnapshot } from '../../src/sim/types';

describe('camera controller', () => {
  afterEach(() => {
    eventBus.clear();
  });

  it('keeps chase camera at the exact external follow distance after car motion', () => {
    const camera = new THREE.PerspectiveCamera(CAMERA.FOV, 16 / 9, CAMERA.NEAR, CAMERA.FAR);
    const controller = new CameraController(camera, () => undefined);

    controller.update(snapshot({ position: [0, 1, 0] }), 1 / 60);
    controller.update(snapshot({ position: [0, 1, 120] }), 1 / 60);

    const horizontalDistance = Math.hypot(camera.position.x - 0, camera.position.z - 120);
    expect(horizontalDistance).toBeCloseTo(CAMERA.FOLLOW_DISTANCE, 4);
    expect(camera.position.y).toBeCloseTo(1 + CAMERA.FOLLOW_HEIGHT, 4);
    controller.dispose();
  });
});

function snapshot(options: { position: [number, number, number] }): PhysicsSnapshot {
  return {
    sequence: 1,
    simTime: 0,
    alpha: 0,
    chassis: {
      position: options.position,
      orientation: [0, 0, 0, 1],
    },
    linearVelocity: [0, 0, 0],
    angularVelocity: [0, 0, 0],
    wheels: {} as PhysicsSnapshot['wheels'],
    telemetry: {
      time: 0,
      speedMps: 0,
      yawRate: 0,
      sideslipRad: 0,
      steeringAngleRad: 0,
      rpm: 0,
      gear: 0,
      throttle: 0,
      brake: 0,
      simFrameMs: 0,
      wheels: {} as PhysicsSnapshot['telemetry']['wheels'],
    },
  };
}
