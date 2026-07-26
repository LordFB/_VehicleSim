import type { SurfaceMaterialId } from '../sim/types';

export type LapInvalidReason = 'four_wheels_off_track' | 'reset';

export type WheelTrackContact = {
  contact: boolean;
  surfaceMaterialId: SurfaceMaterialId;
};

export type CompetitionLapState = {
  lapNumber: number;
  currentMs: number;
  lastMs: number | null;
  bestMs: number | null;
  valid: boolean;
  invalidReason: LapInvalidReason | null;
  justCompleted: boolean;
  justDiscarded: boolean;
};

export class CompetitionLapController {
  private state: CompetitionLapState;
  private previousStationM: number | null = null;
  private lapStartedAtMs: number;

  constructor(
    private readonly lapLengthM: number,
    private readonly minimumLapMs = 12_000,
    startMs = 0,
  ) {
    this.lapStartedAtMs = startMs;
    this.state = {
      lapNumber: 1,
      currentMs: 0,
      lastMs: null,
      bestMs: null,
      valid: true,
      invalidReason: null,
      justCompleted: false,
      justDiscarded: false,
    };
  }

  update(
    stationM: number,
    nowMs: number,
    wheels: readonly WheelTrackContact[] = [],
  ): CompetitionLapState {
    this.state.justCompleted = false;
    this.state.justDiscarded = false;

    if (allFourWheelsOffTrack(wheels)) {
      this.invalidate('four_wheels_off_track');
    }

    this.state.currentMs = Math.max(0, nowMs - this.lapStartedAtMs);
    const crossedLine =
      this.previousStationM !== null &&
      this.previousStationM > this.lapLengthM * 0.82 &&
      stationM < this.lapLengthM * 0.18;

    if (crossedLine && this.state.currentMs >= this.minimumLapMs) {
      if (this.state.valid) {
        this.state.lastMs = this.state.currentMs;
        if (this.state.bestMs === null || this.state.currentMs < this.state.bestMs) {
          this.state.bestMs = this.state.currentMs;
        }
        this.state.justCompleted = true;
      } else {
        this.state.justDiscarded = true;
      }

      this.state.lapNumber += 1;
      this.state.currentMs = 0;
      this.state.valid = true;
      this.state.invalidReason = null;
      this.lapStartedAtMs = nowMs;
    }

    this.previousStationM = stationM;
    return this.snapshot();
  }

  invalidate(reason: LapInvalidReason): CompetitionLapState {
    if (this.state.valid) {
      this.state.valid = false;
      this.state.invalidReason = reason;
    }
    return this.snapshot();
  }

  snapshot(): CompetitionLapState {
    return { ...this.state };
  }
}

const LEGAL_SURFACES: ReadonlySet<SurfaceMaterialId> = new Set([
  'asphalt_new',
  'painted_line',
  'kerb',
]);

export function allFourWheelsOffTrack(wheels: readonly WheelTrackContact[]): boolean {
  return wheels.length === 4 && wheels.every(
    (wheel) => wheel.contact && !LEGAL_SURFACES.has(wheel.surfaceMaterialId),
  );
}
