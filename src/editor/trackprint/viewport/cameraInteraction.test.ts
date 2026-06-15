import { describe, expect, it } from 'vitest';
import { createCameraInteractionLocks, type CameraInteractionLockState } from './cameraInteraction';

describe('camera interaction locks', () => {
  it('keeps camera controls disabled until every lock reason is released', () => {
    const states: CameraInteractionLockState[] = [];
    const locks = createCameraInteractionLocks((state) => states.push(state));

    locks.lock('control-point-drag');
    locks.lock('top-view');
    locks.unlock('control-point-drag');

    expect(states).toEqual([
      { locked: true, reasons: ['control-point-drag'] },
      { locked: true, reasons: ['control-point-drag', 'top-view'] },
      { locked: true, reasons: ['top-view'] },
    ]);
    expect(locks.snapshot()).toEqual({ locked: true, reasons: ['top-view'] });

    locks.unlock('top-view');
    expect(locks.snapshot()).toEqual({ locked: false, reasons: [] });
  });
});
