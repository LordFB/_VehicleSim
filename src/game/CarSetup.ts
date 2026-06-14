import { DEFAULT_PHYSICS_SETUP, type PhysicsSetup } from '../sim/types';

/**
 * The complete, player-editable car setup. Split into three groups matching the modal
 * tabs. `physics` is sent to the worker (live-applied as a multiplier overlay on the
 * validated spec); `input` is applied on the main thread by InputSystem; `transmission`
 * spans both (auto/manual is an input concern, final drive is physics).
 *
 * Everything defaults to the stock car, so a fresh setup changes nothing.
 */
export type InputSetup = {
  steerSensitivity: number; // 0.4..1.6 — scales max steering input
  steerExpo: number; // 0..1 — curve toward center (finer near-center control)
  throttleSmoothing: number; // 0..1 — 0 instant, 1 very smooth ramp
  brakeSmoothing: number; // 0..1
};

export type CarSetup = {
  physics: PhysicsSetup;
  input: InputSetup;
  autoShift: boolean;
};

export const DEFAULT_INPUT_SETUP: InputSetup = {
  steerSensitivity: 1,
  steerExpo: 0.4, // matches the existing INPUT.STEER_EXPO default
  throttleSmoothing: 0.15,
  brakeSmoothing: 0.1,
};

export function defaultCarSetup(): CarSetup {
  return {
    physics: { ...DEFAULT_PHYSICS_SETUP },
    input: { ...DEFAULT_INPUT_SETUP },
    autoShift: false, // manual — the sim-racing default
  };
}

const STORAGE_KEY = 'vehiclesim.carSetup.v1';

/** Persist a setup to localStorage (best-effort; ignores quota/availability errors). */
export function saveCarSetup(setup: CarSetup): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(setup));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/** Load a persisted setup, merged onto the defaults so missing fields stay valid. */
export function loadCarSetup(): CarSetup {
  const base = defaultCarSetup();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<CarSetup>;
    return {
      physics: { ...base.physics, ...(parsed.physics ?? {}) },
      input: { ...base.input, ...(parsed.input ?? {}) },
      autoShift: parsed.autoShift ?? base.autoShift,
    };
  } catch {
    return base;
  }
}
