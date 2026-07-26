import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventBus, Events } from '../../src/core/EventBus';
import { InputSystem } from '../../src/systems/InputSystem';

type Listener = (event: any) => void;

const listeners = new Map<string, Set<Listener>>();
let pads: Array<Partial<Gamepad>> = [];

describe('input camera controls', () => {
  beforeEach(() => {
    listeners.clear();
    pads = [];
    installDomStubs();
  });

  afterEach(() => {
    eventBus.clear();
    listeners.clear();
  });

  it('emits camera-cycle when C is pressed', () => {
    const root = fakeElement();
    const input = new InputSystem(root as unknown as HTMLElement);
    let cycles = 0;
    eventBus.on(Events.CAMERA_MODE_CYCLE_REQUESTED, () => {
      cycles += 1;
    });

    dispatch('keydown', { code: 'KeyC', repeat: false });

    expect(cycles).toBe(1);
    input.dispose();
  });

  it('emits camera-cycle from gamepad d-pad up', () => {
    const root = fakeElement();
    const input = new InputSystem(root as unknown as HTMLElement);
    let cycles = 0;
    eventBus.on(Events.CAMERA_MODE_CYCLE_REQUESTED, () => {
      cycles += 1;
    });

    pads = [fakeGamepad({ 12: true })];
    input.update(16);

    expect(cycles).toBe(1);
    input.dispose();
  });

  it('keeps gamepad View mapped to transmission mode, not camera', () => {
    const root = fakeElement();
    const input = new InputSystem(root as unknown as HTMLElement);
    let cycles = 0;
    let shifts = 0;
    eventBus.on(Events.CAMERA_MODE_CYCLE_REQUESTED, () => {
      cycles += 1;
    });
    eventBus.on(Events.SHIFT_MODE_CHANGED, () => {
      shifts += 1;
    });

    pads = [fakeGamepad({ 8: true })];
    input.update(16);

    expect(cycles).toBe(0);
    expect(shifts).toBe(1);
    input.dispose();
  });
});

function installDomStubs(): void {
  const windowStub = {
    addEventListener(type: string, listener: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.get(type)?.delete(listener);
    },
  };
  Object.defineProperty(globalThis, 'window', { value: windowStub, configurable: true });
  Object.defineProperty(globalThis, 'document', {
    value: {
      createElement: () => fakeElement(),
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      getGamepads: () => pads,
    },
    configurable: true,
  });
}

function dispatch(type: string, event: Record<string, unknown>): void {
  for (const listener of listeners.get(type) ?? []) {
    listener(event);
  }
}

function fakeElement(): Record<string, unknown> {
  return {
    className: '',
    type: '',
    textContent: '',
    style: { setProperty: () => undefined },
    appendChild: () => undefined,
    append: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    setPointerCapture: () => undefined,
    getBoundingClientRect: () => ({ left: 0, width: 118 }),
  };
}

function fakeGamepad(pressed: Record<number, boolean>): Partial<Gamepad> {
  const buttons = Array.from({ length: 16 }, (_, index) => ({
    pressed: Boolean(pressed[index]),
    touched: false,
    value: pressed[index] ? 1 : 0,
  } as GamepadButton));
  return {
    axes: [0, 0, 0, 0, 0, 0],
    buttons,
  };
}
