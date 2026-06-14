import type { WorkerRequest, WorkerResponse } from './types';
import { PhysicsRuntime } from './runtime/PhysicsRuntime';

let runtime: PhysicsRuntime | null = null;

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const message = event.data;
    if (message.type === 'init') {
      runtime = new PhysicsRuntime(message.world);
      post({ type: 'ready' });
      return;
    }
    if (!runtime) throw new Error('Physics runtime is not initialized.');

    if (message.type === 'createVehicle') {
      post({ type: 'vehicleCreated', id: runtime.createVehicle(message.vehicle) });
      return;
    }
    if (message.type === 'input') {
      runtime.submitInput(message.input);
      return;
    }
    if (message.type === 'step') {
      const snapshot = runtime.step(message.renderTimeMs);
      if (snapshot) post({ type: 'snapshot', snapshot });
      return;
    }
    if (message.type === 'reset') {
      runtime.reset(message.seed);
      const snapshot = runtime.getSnapshot();
      if (snapshot) post({ type: 'snapshot', snapshot });
      return;
    }
    if (message.type === 'setup') {
      runtime.applySetup(message.setup);
      return;
    }
    if (message.type === 'querySurface') {
      post({ type: 'surface', id: message.id, contact: runtime.querySurface(message.point) });
    }
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

function post(message: WorkerResponse): void {
  self.postMessage(message);
}
