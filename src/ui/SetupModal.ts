import {
  defaultCarSetup,
  loadCarSetup,
  saveCarSetup,
  type CarSetup,
} from '../game/CarSetup';

type ApplyFn = (setup: CarSetup) => void;

type Field = {
  group: 'physics' | 'input';
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** Render value (e.g. show ×, %, or front/rear split). */
  format?: (v: number) => string;
};

/**
 * The car setup modal: a Forza/iRacing-style garage panel with three tabs — Tuning,
 * Transmission, Assists. Sliders live-apply to the running car on every change (via the
 * {@link ApplyFn} the Game wires to physics + input), and the result is persisted so it
 * survives a reload. Opening pauses nothing — you can tweak and feel the change while
 * rolling. Toggle with the "Setup" button or the `P` key; Esc closes.
 */
export class SetupModal {
  private readonly root: HTMLDivElement;
  private readonly openButton: HTMLButtonElement;
  private readonly body: HTMLDivElement;
  private readonly tabs: HTMLDivElement;
  private setup: CarSetup;
  private tab: 'tuning' | 'transmission' | 'assists' = 'tuning';
  private open = false;

  constructor(parent: HTMLElement, private readonly apply: ApplyFn) {
    this.setup = loadCarSetup();

    this.openButton = document.createElement('button');
    this.openButton.className = 'setup-open overlay';
    this.openButton.type = 'button';
    this.openButton.textContent = '⚙ Setup';
    this.openButton.addEventListener('click', () => this.toggle());
    parent.appendChild(this.openButton);

    this.root = document.createElement('div');
    this.root.className = 'setup-modal overlay';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="setup-backdrop"></div>
      <div class="setup-panel" role="dialog" aria-label="Car setup">
        <header class="setup-head">
          <h2>Car Setup</h2>
          <button class="setup-close" type="button" aria-label="Close">✕</button>
        </header>
        <div class="setup-tabs"></div>
        <div class="setup-body"></div>
        <footer class="setup-foot">
          <button class="setup-reset" type="button">Reset to default</button>
          <span class="setup-hint">Changes apply live · saved automatically</span>
        </footer>
      </div>`;
    parent.appendChild(this.root);

    this.tabs = this.root.querySelector('.setup-tabs')!;
    this.body = this.root.querySelector('.setup-body')!;
    this.root.querySelector('.setup-backdrop')!.addEventListener('click', () => this.close());
    this.root.querySelector('.setup-close')!.addEventListener('click', () => this.close());
    this.root.querySelector('.setup-reset')!.addEventListener('click', () => this.reset());

    this.buildTabs();
    this.renderTab();

    window.addEventListener('keydown', this.onKey);

    // Push the loaded setup to the car immediately so persisted tweaks take effect.
    this.apply(this.setup);
  }

  /** Current setup (used by Game to seed input/physics at startup). */
  current(): CarSetup {
    return this.setup;
  }

  toggle(): void {
    this.open ? this.close() : this.show();
  }

  show(): void {
    this.open = true;
    this.root.hidden = false;
    this.renderTab();
  }

  close(): void {
    this.open = false;
    this.root.hidden = true;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.root.remove();
    this.openButton.remove();
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    // Don't steal keys while typing in an input.
    if (e.code === 'KeyP') { this.toggle(); }
    else if (e.code === 'Escape' && this.open) { this.close(); }
  };

  private buildTabs(): void {
    const defs: Array<[typeof this.tab, string]> = [
      ['tuning', 'Tuning'],
      ['transmission', 'Transmission'],
      ['assists', 'Assists'],
    ];
    for (const [id, label] of defs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.dataset.tab = id;
      b.addEventListener('click', () => { this.tab = id; this.renderTab(); });
      this.tabs.appendChild(b);
    }
  }

  private renderTab(): void {
    for (const b of Array.from(this.tabs.children) as HTMLButtonElement[]) {
      b.classList.toggle('is-active', b.dataset.tab === this.tab);
    }
    this.body.replaceChildren();
    if (this.tab === 'tuning') this.renderFields(TUNING_FIELDS);
    else if (this.tab === 'transmission') this.renderTransmission();
    else this.renderFields(ASSIST_FIELDS);
  }

  private renderFields(fields: Field[]): void {
    for (const f of fields) {
      const value = (this.setup[f.group] as Record<string, number>)[f.key];
      const row = document.createElement('label');
      row.className = 'setup-row';
      const name = document.createElement('span');
      name.className = 'setup-row__label';
      name.textContent = f.label;
      const out = document.createElement('span');
      out.className = 'setup-row__value';
      out.textContent = (f.format ?? defaultFormat(f))(value);
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = String(f.min);
      slider.max = String(f.max);
      slider.step = String(f.step);
      slider.value = String(value);
      slider.addEventListener('input', () => {
        const v = Number(slider.value);
        (this.setup[f.group] as Record<string, number>)[f.key] = v;
        out.textContent = (f.format ?? defaultFormat(f))(v);
        this.commit();
      });
      row.append(name, slider, out);
      this.body.appendChild(row);
    }
  }

  private renderTransmission(): void {
    // Auto/manual toggle.
    const row = document.createElement('div');
    row.className = 'setup-row setup-row--toggle';
    const name = document.createElement('span');
    name.className = 'setup-row__label';
    name.textContent = 'Transmission';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'setup-toggle';
    const paint = () => { toggle.textContent = this.setup.autoShift ? 'Automatic' : 'Manual'; toggle.classList.toggle('is-on', this.setup.autoShift); };
    paint();
    toggle.addEventListener('click', () => { this.setup.autoShift = !this.setup.autoShift; paint(); this.commit(); });
    row.append(name, toggle);
    this.body.appendChild(row);
    // Final drive (physics).
    this.renderFields([{ group: 'physics', key: 'finalDriveScale', label: 'Final drive', min: 0.8, max: 1.25, step: 0.01, format: (v) => `${v.toFixed(2)}×` }]);
  }

  private commit(): void {
    saveCarSetup(this.setup);
    this.apply(this.setup);
  }

  private reset(): void {
    this.setup = defaultCarSetup();
    this.renderTab();
    this.commit();
  }
}

function defaultFormat(f: Field): (v: number) => string {
  return (v) => `${v.toFixed(2)}${f.unit ?? ''}`;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const mult = (v: number) => `${v.toFixed(2)}×`;

const TUNING_FIELDS: Field[] = [
  { group: 'physics', key: 'gripScale', label: 'Tire grip', min: 0.7, max: 1.3, step: 0.01, format: mult },
  { group: 'physics', key: 'brakeForceScale', label: 'Brake force', min: 0.6, max: 1.5, step: 0.01, format: mult },
  { group: 'physics', key: 'brakeBias', label: 'Brake bias (front)', min: 0.3, max: 0.8, step: 0.01, format: (v) => `${Math.round(v * 100)}% F` },
  { group: 'physics', key: 'downforceScale', label: 'Downforce', min: 0.4, max: 2.0, step: 0.05, format: mult },
  { group: 'physics', key: 'dragScale', label: 'Drag', min: 0.6, max: 1.6, step: 0.05, format: mult },
];

const ASSIST_FIELDS: Field[] = [
  { group: 'input', key: 'steerSensitivity', label: 'Steering sensitivity', min: 0.4, max: 1.6, step: 0.05, format: mult },
  { group: 'input', key: 'steerExpo', label: 'Steering linearity', min: 0, max: 1, step: 0.05, format: pct },
  { group: 'input', key: 'throttleSmoothing', label: 'Throttle smoothing', min: 0, max: 1, step: 0.05, format: pct },
  { group: 'input', key: 'brakeSmoothing', label: 'Brake smoothing', min: 0, max: 1, step: 0.05, format: pct },
];
