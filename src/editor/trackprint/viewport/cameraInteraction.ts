export type CameraInteractionLockReason = 'top-view' | 'control-point-drag' | 'transform-controls' | 'terrain-brush';

export interface CameraInteractionLockState {
  readonly locked: boolean;
  readonly reasons: readonly CameraInteractionLockReason[];
}

export function createCameraInteractionLocks(
  onChange: (state: CameraInteractionLockState) => void,
) {
  const reasons = new Set<CameraInteractionLockReason>();

  const emit = () => {
    onChange({
      locked: reasons.size > 0,
      reasons: Array.from(reasons).sort(),
    });
  };

  return {
    lock(reason: CameraInteractionLockReason) {
      const before = reasons.size;
      reasons.add(reason);
      if (reasons.size !== before) {
        emit();
      }
    },
    unlock(reason: CameraInteractionLockReason) {
      const changed = reasons.delete(reason);
      if (changed) {
        emit();
      }
    },
    clear() {
      if (reasons.size > 0) {
        reasons.clear();
        emit();
      }
    },
    snapshot(): CameraInteractionLockState {
      return {
        locked: reasons.size > 0,
        reasons: Array.from(reasons).sort(),
      };
    },
  };
}
