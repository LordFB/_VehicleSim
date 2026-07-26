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

  it('starts onboard and cycles to nose without exposing chase', () => {
    const camera = new THREE.PerspectiveCamera(CAMERA.FOV, 16 / 9, CAMERA.NEAR, CAMERA.FAR);
    const controller = new CameraController(camera, () => undefined);

    expect(controller.getMode()).toBe('onboard');
    controller.update(snapshot({ position: [0, 1, 0] }), 1 / 60);
    expect(camera.position.z).toBeCloseTo(CAMERA.ONBOARD.EYE_OFFSET[2], 4);
    expect(controller.cycleMode()).toBe('nose');
    expect(controller.cycleMode()).toBe('onboard');
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
