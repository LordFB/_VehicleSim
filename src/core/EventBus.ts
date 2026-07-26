export const Events = {
  SIM_RESET_REQUESTED: 'sim:resetRequested',
  TELEMETRY_EXPORT_REQUESTED: 'telemetry:exportRequested',
  PHYSICS_ERROR: 'physics:error',
  TELEMETRY_TOGGLE_REQUESTED: 'telemetry:toggleRequested',
  AUDIO_TOGGLE_REQUESTED: 'audio:toggleRequested',
  CAMERA_MODE_CYCLE_REQUESTED: 'camera:modeCycleRequested',
  LAP_COMPLETED: 'lap:completed',
  LAP_TIMER_RESET: 'lap:reset',
  GAMEPAD_CONNECTED: 'input:gamepadConnected',
  SHIFT_MODE_CHANGED: 'input:shiftModeChanged',
} as const;

type EventName = (typeof Events)[keyof typeof Events];
type Listener<T = unknown> = (payload: T) => void;

class EventBus {
  private readonly listeners = new Map<EventName, Set<Listener>>();

  on<T>(event: EventName, callback: Listener<T>): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(callback as Listener);
    return () => this.off(event, callback);
  }

  once<T>(event: EventName, callback: Listener<T>): void {
    const wrapper = (payload: T) => {
      this.off(event, wrapper);
      callback(payload);
    };
    this.on(event, wrapper);
  }

  off<T>(event: EventName, callback: Listener<T>): void {
    const callbacks = this.listeners.get(event);
    if (!callbacks) return;
    callbacks.delete(callback as Listener);
    if (callbacks.size === 0) this.listeners.delete(event);
  }

  emit<T>(event: EventName, payload: T): void {
    const callbacks = this.listeners.get(event);
    if (!callbacks) return;
    for (const callback of callbacks) {
      try {
        callback(payload);
      } catch (error) {
        console.error(`EventBus listener failed for ${event}:`, error);
      }
    }
  }

  clear(event?: EventName): void {
    if (event) this.listeners.delete(event);
    else this.listeners.clear();
  }
}

export const eventBus = new EventBus();
