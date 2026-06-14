import type { PhysicsSnapshot } from '../sim/types';

class GameState {
  started = false;
  paused = false;
  latestSnapshot: PhysicsSnapshot | null = null;
  resetCount = 0;
  inputSequence = 0;

  reset(): void {
    this.started = true;
    this.paused = false;
    this.latestSnapshot = null;
    this.resetCount += 1;
    this.inputSequence = 0;
  }
}

export const gameState = new GameState();
