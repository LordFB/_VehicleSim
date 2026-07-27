import { describe, expect, it } from 'vitest';
import { CAMERA, COCKPIT } from '../../src/core/Constants';
import { CockpitWheelView } from '../../src/render/CockpitWheelView';
import type { PhysicsSnapshot } from '../../src/sim/types';

describe('cockpit wheel view', () => {
  it('is only visible in onboard camera mode', () => {
    const view = new CockpitWheelView();

    view.setCameraMode('onboard');
    expect(view.group.visible).toBe(true);

    view.setCameraMode('nose');
    expect(view.group.visible).toBe(false);
    view.dispose();
  });

  it('builds a detailed halo-free onboard car around the driver', () => {
    const view = new CockpitWheelView();
    const names = new Set<string>();
    view.group.traverse((object) => names.add(object.name));

    for (const part of [
      'cockpit-nose',
      'cockpit-front-left-wheel',
      'cockpit-front-right-wheel',
      'cockpit-front-left-suspension',
      'cockpit-front-right-suspension',
      'cockpit-left-mirror',
      'cockpit-right-mirror',
      'cockpit-dashboard',
      'cockpit-steering-wheel',
    ]) {
      expect(names.has(part), part).toBe(true);
    }
    expect([...names].some((name) => name.toLowerCase().includes('halo'))).toBe(false);
    view.dispose();
  });

  it('follows chassis pose and rotates from steering telemetry', () => {
    const view = new CockpitWheelView();
    const steeringAngleRad = 0.25;

    view.applySnapshot(snapshot({ steeringAngleRad }));

    expect(view.group.position.x).toBe(3);
    expect(view.group.position.y).toBe(1);
    expect(view.group.position.z).toBe(7);
    // The rim spins inside the mount, which holds the fixed column rake.
    expect(view.steeringRotationRad).toBeCloseTo(-steeringAngleRad * COCKPIT.WHEEL_STEER_RATIO, 4);
    expect(view.steeringWheel.rotation.x).toBeCloseTo(COCKPIT.WHEEL_TILT_RAD, 4);
    expect(view.steeringWheel.position.y).toBeCloseTo(CAMERA.ONBOARD.WHEEL_OFFSET[1], 4);
    view.dispose();
  });
});

function snapshot(telemetryOverrides: Partial<PhysicsSnapshot['telemetry']> = {}): PhysicsSnapshot {
  return {
    sequence: 1,
    simTime: 0,
    alpha: 0,
    chassis: {
      position: [3, 1, 7],
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
      ...telemetryOverrides,
    },
  };
}
