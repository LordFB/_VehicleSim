import type { RaceMode, RaceSessionSpec } from '../../../src/race/types';

export function createTestRaceSpec(mode: RaceMode): RaceSessionSpec {
  const lengthM = 1_000;
  const samples = Array.from({ length: 100 }, (_, index) => {
    const angle = index / 100 * Math.PI * 2;
    return {
      stationM: index * 10,
      position: [Math.sin(angle) * 150, 0, Math.cos(angle) * 150] as [number, number, number],
      tangent: [Math.cos(angle), -Math.sin(angle)] as [number, number],
      targetSpeedMps: 42,
      brakeTargetSpeedMps: 42,
      curvature: 1 / 150,
      cornerName: null,
      halfWidthM: 7,
      racingLineOffsetM: Math.sin(angle * 2) * 0.6,
    };
  });
  return {
    mode,
    lapCount: 3,
    countdownMs: 3_000,
    course: { lengthM, samples },
    playerVehicleId: mode === 'participate' ? 'car-6' : null,
    vehicles: Array.from({ length: 12 }, (_, index) => ({
      id: `car-${index + 1}`,
      driverName: `Driver ${index + 1}`,
      gridPosition: index + 1,
      ai: mode === 'watch' || index !== 5,
      pace: 0.96 + index * 0.004,
    })),
  };
}
