import type { InputFrame } from '../sim/types';
import { INPUT } from '../core/Constants';
import { eventBus, Events } from '../core/EventBus';
import { DEFAULT_INPUT_SETUP, type InputSetup } from '../game/CarSetup';

type TouchButton = {
  element: HTMLButtonElement;
  active: boolean;
};

// Standard-mapping gamepad button indices (Xbox layout).
const PAD = {
  A: 0,
  B: 1,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  VIEW: 8, // back / view
  MENU: 9, // start / menu
  DPAD_UP: 12,
  DPAD_DOWN: 13,
} as const;

/**
 * Input for a driving game: full Xbox/standard-gamepad support (sticks, analog
 * triggers, bumper paddle-shifts) plus keyboard parity. Steering sign is corrected
 * at this boundary so the physics is never touched. Shifts are edge-triggered so one
 * press = one gear, and an auto/manual transmission toggle is exposed on the input
 * frame (default manual — the sim-racing expectation).
 */
export class InputSystem {
  private readonly keys = new Set<string>();
  private readonly root: HTMLElement;
  private sequence = 0;
  private touchSteering = 0;
  private touchThrottle = false;
  private touchBrake = false;
  private touchHandbrake = false;
  private shiftUpLatch = false;
  private shiftDownLatch = false;
  private autoShift = false; // default to manual transmission
  private setup: InputSetup = { ...DEFAULT_INPUT_SETUP };
  private throttleState = 0; // smoothed throttle (for assist ramp)
  private brakeState = 0; // smoothed brake
  private lastUpdateMs = 0;
  private joystickPointerId: number | null = null;
  private joystickCenter = { x: 0, y: 0 };
  private joystickKnob: HTMLDivElement | null = null;
  // Edge-detection state for gamepad buttons (press -> single action).
  private padPrev = { shiftUp: false, shiftDown: false, reset: false, mode: false };
  private gamepadSeen = false;

  constructor(root: HTMLElement) {
    this.root = root;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('gamepadconnected', this.onGamepadConnected);
    this.createTouchControls();
  }

  /** Current transmission mode, for the HUD. */
  isAutoShift(): boolean {
    return this.autoShift;
  }

  /** Apply assist/input setup (steering sensitivity & expo, throttle/brake smoothing). */
  applyInputSetup(setup: InputSetup): void {
    this.setup = { ...setup };
  }

  /** Set the transmission mode from the setup modal (keeps the HUD/event in sync). */
  setAutoShift(auto: boolean): void {
    if (this.autoShift === auto) return;
    this.autoShift = auto;
    eventBus.emit(Events.SHIFT_MODE_CHANGED, { autoShift: this.autoShift });
  }

  hasGamepad(): boolean {
    return Boolean(navigator.getGamepads?.().find((p) => p));
  }

  update(timestamp: number): InputFrame {
    const gamepad = navigator.getGamepads?.().find((pad) => pad) ?? null;

    const dt = this.lastUpdateMs ? Math.min(0.1, Math.max(0, (timestamp - this.lastUpdateMs) / 1000)) : 0;
    this.lastUpdateMs = timestamp;

    // --- Steering -------------------------------------------------------------
    // Expo and sensitivity come from the setup (assists tab); expo defaults to the
    // INPUT constant. Sensitivity scales the final command (clamped to ±1).
    const padSteerRaw = gamepad ? deadzone(gamepad.axes[0] ?? 0, INPUT.STICK_DEADZONE) : 0;
    const padSteer = expo(padSteerRaw, this.setup.steerExpo);
    const keyboardSteer =
      (this.keys.has('ArrowLeft') || this.keys.has('KeyA') ? -1 : 0) +
      (this.keys.has('ArrowRight') || this.keys.has('KeyD') ? 1 : 0);
    // Right input must turn the car right; STEER_SIGN corrects the physics convention.
    const steeringRaw = INPUT.STEER_SIGN * (keyboardSteer || padSteer || this.touchSteering);
    const steering = clamp(steeringRaw * this.setup.steerSensitivity, -1, 1);

    // --- Throttle / brake (analog triggers preferred) -------------------------
    const padThrottle = gamepad ? triggerValue(gamepad, PAD.RT, 5) : 0;
    const padBrake = gamepad ? triggerValue(gamepad, PAD.LT, 4) : 0;
    const throttleTarget = clamp01(Math.max(
      this.keys.has('ArrowUp') || this.keys.has('KeyW') ? 1 : 0,
      padThrottle,
      this.touchThrottle ? 1 : 0,
    ));
    const brakeTarget = clamp01(Math.max(
      this.keys.has('ArrowDown') || this.keys.has('KeyS') ? 1 : 0,
      padBrake,
      this.touchBrake ? 1 : 0,
    ));
    // Assist smoothing: ramp the pedals toward their target. 0 = instant (raw), 1 = very
    // soft. A press always responds faster than a release for a connected feel.
    const throttle = this.ramp(this.throttleState, throttleTarget, this.setup.throttleSmoothing, dt);
    const brake = this.ramp(this.brakeState, brakeTarget, this.setup.brakeSmoothing, dt);
    this.throttleState = throttle;
    this.brakeState = brake;

    // --- Buttons (edge-triggered where one press = one action) ----------------
    const padShiftUp = buttonPressed(gamepad, PAD.RB);
    const padShiftDown = buttonPressed(gamepad, PAD.LB);
    const padReset = buttonPressed(gamepad, PAD.MENU);
    const padMode = buttonPressed(gamepad, PAD.VIEW);

    const shiftUp = this.consumeShiftUp() || edge(padShiftUp, this.padPrev.shiftUp);
    const shiftDown = this.consumeShiftDown() || edge(padShiftDown, this.padPrev.shiftDown);
    if (edge(padReset, this.padPrev.reset)) eventBus.emit(Events.SIM_RESET_REQUESTED, {});
    if (edge(padMode, this.padPrev.mode)) this.toggleAutoShift();
    this.padPrev = { shiftUp: padShiftUp, shiftDown: padShiftDown, reset: padReset, mode: padMode };

    const handbrake =
      this.keys.has('Space') || this.touchHandbrake || buttonPressed(gamepad, PAD.A) ? 1 : 0;

    const frame: InputFrame = {
      steering,
      throttle,
      brake,
      clutch: 0,
      handbrake,
      shiftUp,
      shiftDown,
      reset: false,
      autoShift: this.autoShift,
      timestamp,
      sequence: this.sequence,
    };
    this.sequence += 1;
    return frame;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('gamepadconnected', this.onGamepadConnected);
  }

  private readonly onGamepadConnected = (): void => {
    if (this.gamepadSeen) return;
    this.gamepadSeen = true;
    eventBus.emit(Events.GAMEPAD_CONNECTED, {});
  };

  private toggleAutoShift(): void {
    this.autoShift = !this.autoShift;
    eventBus.emit(Events.SHIFT_MODE_CHANGED, { autoShift: this.autoShift });
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return; // edge-trigger keyboard shifts too
    this.keys.add(event.code);
    if (event.code === 'KeyE' || event.code === 'ShiftRight') this.shiftUpLatch = true;
    if (event.code === 'KeyQ' || event.code === 'ControlRight') this.shiftDownLatch = true;
    if (event.code === 'KeyG') this.toggleAutoShift();
    // Reset is owned by Game (resets physics + lap timer + skid marks) via the event bus.
    if (event.code === 'KeyR') eventBus.emit(Events.SIM_RESET_REQUESTED, {});
    if (event.code === 'KeyT') eventBus.emit(Events.TELEMETRY_TOGGLE_REQUESTED, {});
    if (event.code === 'KeyM') eventBus.emit(Events.AUDIO_TOGGLE_REQUESTED, {});
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  /**
   * Ramp a pedal value toward its target. `smoothing` 0 → instant; 1 → very soft. The
   * time-constant is derived so the feel is frame-rate independent. Releasing is allowed
   * to be a touch quicker than pressing so lifting off never feels laggy.
   */
  private ramp(current: number, target: number, smoothing: number, dt: number): number {
    if (smoothing <= 0.001 || dt <= 0) return target;
    const pressing = target > current;
    const tau = smoothing * (pressing ? 0.28 : 0.18); // seconds to ~63%
    const alpha = 1 - Math.exp(-dt / Math.max(0.001, tau));
    return current + (target - current) * alpha;
  }

  private consumeShiftUp(): boolean {
    const value = this.shiftUpLatch;
    this.shiftUpLatch = false;
    return value;
  }

  private consumeShiftDown(): boolean {
    const value = this.shiftDownLatch;
    this.shiftDownLatch = false;
    return value;
  }

  private createTouchControls(): void {
    const joystick = document.createElement('div');
    joystick.className = 'touch-joystick';
    const knob = document.createElement('div');
    knob.className = 'touch-joystick__knob';
    joystick.appendChild(knob);
    this.joystickKnob = knob;
    this.root.appendChild(joystick);

    joystick.addEventListener('pointerdown', (event) => {
      this.joystickPointerId = event.pointerId;
      joystick.setPointerCapture(event.pointerId);
      const rect = joystick.getBoundingClientRect();
      this.joystickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      this.updateJoystick(event.clientX);
    });
    joystick.addEventListener('pointermove', (event) => {
      if (event.pointerId === this.joystickPointerId) this.updateJoystick(event.clientX);
    });
    const release = (event: PointerEvent) => {
      if (event.pointerId !== this.joystickPointerId) return;
      this.joystickPointerId = null;
      this.touchSteering = 0;
      this.joystickKnob?.style.setProperty('transform', 'translate(-50%, -50%)');
    };
    joystick.addEventListener('pointerup', release);
    joystick.addEventListener('pointercancel', release);

    const buttons = document.createElement('div');
    buttons.className = 'touch-buttons';
    const throttle = this.createTouchButton('THR');
    const brake = this.createTouchButton('BRK');
    const handbrake = this.createTouchButton('HB');
    buttons.append(throttle.element, brake.element, handbrake.element);
    this.root.appendChild(buttons);
    bindTouchButton(throttle, (active) => {
      this.touchThrottle = active;
    });
    bindTouchButton(brake, (active) => {
      this.touchBrake = active;
    });
    bindTouchButton(handbrake, (active) => {
      this.touchHandbrake = active;
    });
  }

  private createTouchButton(label: string): TouchButton {
    const element = document.createElement('button');
    element.className = 'touch-button';
    element.type = 'button';
    element.textContent = label;
    return { element, active: false };
  }

  private updateJoystick(clientX: number): void {
    const radius = INPUT.TOUCH_SIZE_PX * 0.5;
    const delta = clamp(clientX - this.joystickCenter.x, -radius, radius);
    this.touchSteering = delta / radius;
    this.joystickKnob?.style.setProperty('transform', `translate(calc(-50% + ${delta}px), -50%)`);
  }
}

function bindTouchButton(button: TouchButton, setActive: (active: boolean) => void): void {
  const down = (event: PointerEvent) => {
    button.active = true;
    setActive(true);
    button.element.setPointerCapture(event.pointerId);
  };
  const up = () => {
    button.active = false;
    setActive(false);
  };
  button.element.addEventListener('pointerdown', down);
  button.element.addEventListener('pointerup', up);
  button.element.addEventListener('pointercancel', up);
  button.element.addEventListener('pointerleave', up);
}

function deadzone(value: number, zone: number): number {
  if (Math.abs(value) < zone) return 0;
  // Rescale so motion starts smoothly from the edge of the deadzone.
  const sign = Math.sign(value);
  return sign * ((Math.abs(value) - zone) / (1 - zone));
}

function expo(value: number, amount: number): number {
  // Blend linear with a cubic for finer control near center.
  return (1 - amount) * value + amount * value * value * value;
}

function buttonPressed(gamepad: Gamepad | null, index: number): boolean {
  return Boolean(gamepad?.buttons[index]?.pressed);
}

/** Analog trigger: prefer button.value (standard mapping), fall back to an axis. */
function triggerValue(gamepad: Gamepad, buttonIndex: number, axisIndex: number): number {
  const byButton = gamepad.buttons[buttonIndex]?.value ?? 0;
  if (byButton > 0.001) return clamp01(byButton);
  const axis = gamepad.axes[axisIndex];
  if (axis === undefined) return 0;
  // Some drivers report idle triggers at -1 and full at +1.
  return clamp01((axis + 1) / 2);
}

function edge(now: boolean, prev: boolean): boolean {
  return now && !prev;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
