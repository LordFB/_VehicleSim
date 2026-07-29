import type { VehicleDamageEffects, WheelId } from '../sim/types';
import type { DamageComponentId, RaceDamageState } from './types';

export type RaceImpact = {
  source: 'barrier' | 'vehicle';
  deltaSpeedMps: number;
  localX: number;
  localZ: number;
  timeMs: number;
};

const COMPONENTS: DamageComponentId[] = [
  'frontWing', 'rearWing',
  'frontLeftSuspension', 'frontRightSuspension',
  'rearLeftSuspension', 'rearRightSuspension',
  'frontLeftTire', 'frontRightTire', 'rearLeftTire', 'rearRightTire',
  'engine', 'gearbox', 'chassis',
];

export function createPristineDamageState(): RaceDamageState {
  return {
    health: Object.fromEntries(COMPONENTS.map((component) => [component, 1])) as Record<DamageComponentId, number>,
    totalDamage: 0,
    punctures: [],
    retired: false,
    lastImpact: null,
  };
}

export function applyRaceImpact(state: RaceDamageState, impact: RaceImpact): RaceDamageState {
  const severity = clamp((impact.deltaSpeedMps - 3.5) / 28, 0, 1) ** 1.25;
  if (severity <= 0) return cloneState(state);

  const next = cloneState(state);
  let primary: DamageComponentId;
  if (Math.abs(impact.localZ) >= Math.abs(impact.localX)) {
    if (impact.localZ >= 0) {
      primary = 'frontWing';
      damage(next, 'frontWing', severity * 0.8);
      damage(next, 'frontLeftSuspension', severity * 0.22);
      damage(next, 'frontRightSuspension', severity * 0.22);
      damage(next, 'frontLeftTire', severity * 0.16);
      damage(next, 'frontRightTire', severity * 0.16);
    } else {
      primary = 'rearWing';
      damage(next, 'rearWing', severity * 0.72);
      damage(next, 'rearLeftSuspension', severity * 0.2);
      damage(next, 'rearRightSuspension', severity * 0.2);
      damage(next, 'rearLeftTire', severity * 0.14);
      damage(next, 'rearRightTire', severity * 0.14);
      damage(next, 'engine', severity * 0.42);
      damage(next, 'gearbox', severity * 0.36);
    }
  } else {
    const right = impact.localX >= 0;
    const frontSuspension: DamageComponentId = right ? 'frontRightSuspension' : 'frontLeftSuspension';
    const rearSuspension: DamageComponentId = right ? 'rearRightSuspension' : 'rearLeftSuspension';
    const frontTire: DamageComponentId = right ? 'frontRightTire' : 'frontLeftTire';
    const rearTire: DamageComponentId = right ? 'rearRightTire' : 'rearLeftTire';
    primary = frontSuspension;
    damage(next, frontSuspension, severity * 0.68);
    damage(next, rearSuspension, severity * 0.62);
    damage(next, frontTire, severity * 0.55);
    damage(next, rearTire, severity * 0.5);
    damage(next, 'frontWing', severity * 0.08);
    damage(next, 'rearWing', severity * 0.08);
  }
  damage(next, 'chassis', severity * 0.24);
  if (severity > 0.72) {
    damage(next, 'engine', severity * 0.08);
    damage(next, 'gearbox', severity * 0.06);
  }

  next.punctures = wheelEntries()
    .filter(([, tire]) => next.health[tire] <= 0.22)
    .map(([wheel]) => wheel);
  next.totalDamage = round(1 - COMPONENTS.reduce((sum, component) => sum + next.health[component], 0) / COMPONENTS.length);
  next.retired =
    next.health.chassis <= 0.15
    || next.health.engine <= 0.12
    || next.punctures.length >= 2;
  next.lastImpact = {
    source: impact.source,
    deltaSpeedMps: round(impact.deltaSpeedMps),
    severity: round(severity),
    component: primary,
    timeMs: impact.timeMs,
  };
  return next;
}

export function damageEffects(state: RaceDamageState): VehicleDamageEffects {
  const wheelGripScale = Object.fromEntries(wheelEntries().map(([wheel, tire, suspension]) => {
    const punctured = state.health[tire] <= 0.22;
    const tireScale = punctured ? 0.12 : 0.35 + state.health[tire] * 0.65;
    const suspensionScale = 0.45 + state.health[suspension] * 0.55;
    return [wheel, round(tireScale * suspensionScale)];
  })) as Record<WheelId, number>;
  const frontSuspension = Math.min(state.health.frontLeftSuspension, state.health.frontRightSuspension);
  return {
    powerScale: round((0.2 + state.health.engine * 0.8) * (0.55 + state.health.gearbox * 0.45)),
    downforceScale: round(0.2 + 0.8 * (state.health.frontWing * 0.55 + state.health.rearWing * 0.45)),
    dragScale: round(1 + (2 - state.health.frontWing - state.health.rearWing) * 0.35),
    steeringScale: round(0.4 + frontSuspension * 0.6),
    steeringBias: round(
      ((state.health.frontRightSuspension + state.health.rearRightSuspension)
      - (state.health.frontLeftSuspension + state.health.rearLeftSuspension)) * 0.08,
    ),
    wheelGripScale,
    punctured: Object.fromEntries(wheelEntries().map(([wheel]) => [
      wheel,
      state.punctures.includes(wheel),
    ])) as Record<WheelId, boolean>,
    retired: state.retired,
  };
}

function damage(state: RaceDamageState, component: DamageComponentId, amount: number): void {
  state.health[component] = round(clamp(state.health[component] - amount, 0, 1));
}

function cloneState(state: RaceDamageState): RaceDamageState {
  return {
    health: { ...state.health },
    totalDamage: state.totalDamage,
    punctures: [...state.punctures],
    retired: state.retired,
    lastImpact: state.lastImpact ? { ...state.lastImpact } : null,
  };
}

function wheelEntries(): Array<[WheelId, DamageComponentId, DamageComponentId]> {
  return [
    ['frontLeft', 'frontLeftTire', 'frontLeftSuspension'],
    ['frontRight', 'frontRightTire', 'frontRightSuspension'],
    ['rearLeft', 'rearLeftTire', 'rearLeftSuspension'],
    ['rearRight', 'rearRightTire', 'rearRightSuspension'],
  ];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
