import { RaceRuntime } from './RaceRuntime';
import { FullRaceRuntime } from './FullRaceRuntime';
import type { RaceWorkerRequest, RaceWorkerResponse } from './types';

type Runtime = Pick<RaceRuntime, 'step' | 'snapshot' | 'setSpectatorFocus'>;
let runtime: Runtime | null = null;

self.onmessage = (event: MessageEvent<RaceWorkerRequest>) => {
  try {
    const request = event.data;
    if (request.type === 'init') {
      runtime = request.spec.world && request.spec.vehicle
        ? new FullRaceRuntime({
            ...request.spec,
            world: request.spec.world,
            vehicle: request.spec.vehicle,
          })
        : new RaceRuntime(request.spec);
      post({ type: 'ready', snapshot: runtime.snapshot() });
      return;
    }
    if (!runtime) throw new Error('Race runtime is not initialized.');
    if (request.type === 'step') {
      post({ type: 'snapshot', snapshot: runtime.step(request.deltaMs, request.inputs) });
      return;
    }
    runtime.setSpectatorFocus(request.vehicleId);
    post({ type: 'snapshot', snapshot: runtime.snapshot() });
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

function post(message: RaceWorkerResponse): void {
  self.postMessage(message);
}
