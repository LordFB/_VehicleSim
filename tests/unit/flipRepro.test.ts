import { describe, expect, it } from 'vitest';
import defaultVehicleJson from '../../src/sim/data/defaultVehicle.json';
import { PhysicsRuntime } from '../../src/sim/runtime/PhysicsRuntime';
import { Quat } from '../../src/sim/math/Quat';
import { VEC3_UP } from '../../src/sim/math/Vec3';
import type { InputFrame, VehicleSpec, WorldSpec } from '../../src/sim/types';

function tiltDeg(orientation: [number, number, number, number]): number {
  const up = Quat.fromTuple(orientation).rotateVector(VEC3_UP);
  return (Math.acos(Math.min(1, Math.max(-1, up.dot(VEC3_UP)))) * 180) / Math.PI;
}

function input(seq: number, ms: number, over: Partial<InputFrame>): InputFrame {
  return {
    steering: 0, throttle: 0, brake: 0, clutch: 0, handbrake: 0,
    shiftUp: false, shiftDown: false, reset: false, timestamp: ms, sequence: seq, ...over,
  };
}

// A long flat world with a raised kerb strip running parallel to the +Z straight,
// so we can reach high speed and then climb / clip the kerb at an angle — the
// realistic flip trigger (asymmetric suspension loading + tripping).
function bigWorld(): WorldSpec {
  const base = JSON.parse(JSON.stringify(defaultWorldMaterials));
  return {
    gravity: 9.81,
    defaultMaterialId: 'asphalt_new',
    materials: base,
    spawn: { position: [0, 0.72, 0], yawRad: 0 },
    zones: [
      // Kerb strip at x in [5.5, 6.7], raised 8cm (typical sausage-ish step).
      { id: 'kerb', materialId: 'kerb', type: 'rect', center: [6.1, 600], size: [1.2, 1200], heightOffset: 0.08 },
      // Grass beyond it, dropped.
      { id: 'grass', materialId: 'grass', type: 'rect', center: [14, 600], size: [16, 1200], heightOffset: -0.04 },
    ],
    barriers: [],
  } as unknown as WorldSpec;
}

const defaultWorldMaterials = [
  { id: 'asphalt_new', muLongitudinal: 1.12, muLateral: 1.08, roughness: 0.28, wetness: 0, temperatureC: 28, rubberLevel: 0.55, rollingResistance: 0.012 },
  { id: 'kerb', muLongitudinal: 0.95, muLateral: 0.9, roughness: 0.75, wetness: 0, temperatureC: 26, rubberLevel: 0.1, rollingResistance: 0.018 },
  { id: 'grass', muLongitudinal: 0.42, muLateral: 0.36, roughness: 0.85, wetness: 0.12, temperatureC: 24, rubberLevel: 0, rollingResistance: 0.04 },
];

function run(label: string, drive: (i: number, speed: number) => Partial<InputFrame>, steps = 2600): { tilt: number; speed: number; flipped: boolean } {
  const runtime = new PhysicsRuntime(bigWorld());
  runtime.createVehicle(defaultVehicleJson as VehicleSpec);
  let ms = 0;
  let maxTilt = 0;
  let maxSpeed = 0;
  let flipped = false;
  for (let i = 0; i < steps; i += 1) {
    const snap0 = runtime.getSnapshot();
    const speed = snap0?.telemetry.speedMps ?? 0;
    runtime.submitInput(input(i, ms, drive(i, speed)));
    ms += 1000 / 120;
    const snap = runtime.step(ms);
    if (snap) {
      const t = tiltDeg(snap.chassis.orientation);
      maxTilt = Math.max(maxTilt, t);
      maxSpeed = Math.max(maxSpeed, snap.telemetry.speedMps);
      if (t > 80) flipped = true;
    }
  }
  // eslint-disable-next-line no-console
  console.log(`${label}: peak tilt ${maxTilt.toFixed(1)}deg, peak ${(maxSpeed * 3.6).toFixed(0)}km/h${flipped ? ' [FLIPPED]' : ''}`);
  return { tilt: maxTilt, speed: maxSpeed, flipped };
}

describe('flip diagnosis (high speed + kerb)', () => {
  it('reports peak tilt climbing a kerb at speed', () => {
    // Accelerate straight, then steer gently right to ride up onto the raised kerb at speed.
    run('drift onto kerb at speed', (i, _s) => ({ throttle: 1, steering: i > 1200 ? 0.12 : 0 }));
    // High-speed slalom that puts a wheel on/off the kerb repeatedly.
    run('high-speed kerb slalom', (i) => ({ throttle: 1, steering: i > 1000 ? 0.18 * Math.sin(i * 0.05) + 0.1 : 0 }));
    // Hard lift + full lock at top speed (snap-induced load transfer toward the kerb).
    run('top-speed snap into kerb', (i) => ({ throttle: i < 1400 ? 1 : 0, brake: i >= 1400 ? 0.6 : 0, steering: i >= 1400 ? 0.5 : 0 }));
    expect(true).toBe(true);
  });
});
