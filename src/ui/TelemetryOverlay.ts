import { eventBus, Events } from '../core/EventBus';
import type { TelemetryFrame, WheelId } from '../sim/types';

const WHEEL_IDS: WheelId[] = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'];

export class TelemetryOverlay {
  private readonly root: HTMLDivElement;
  private readonly readout: HTMLPreElement;
  private readonly samples: TelemetryFrame[] = [];
  private maxSamples = 3600;
  private visible = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'telemetry overlay telemetry--hidden';
    const heading = document.createElement('div');
    heading.className = 'telemetry__heading';
    heading.textContent = 'Vehicle Telemetry';
    this.readout = document.createElement('pre');
    this.readout.textContent = 'Waiting for physics...';

    const controls = document.createElement('div');
    controls.className = 'telemetry__controls';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Reset';
    reset.addEventListener('click', () => eventBus.emit(Events.SIM_RESET_REQUESTED, {}));
    const csv = document.createElement('button');
    csv.type = 'button';
    csv.textContent = 'CSV';
    csv.addEventListener('click', () => eventBus.emit(Events.TELEMETRY_EXPORT_REQUESTED, {}));
    controls.append(reset, csv);

    this.root.append(heading, this.readout, controls);
    parent.appendChild(this.root);
    eventBus.on(Events.TELEMETRY_EXPORT_REQUESTED, () => this.exportCsv());
  }

  update(frame: TelemetryFrame): void {
    this.samples.push(frame);
    if (this.samples.length > this.maxSamples) this.samples.shift();
    const frontLoads = `${Math.round(frame.wheels.frontLeft.loadN)} / ${Math.round(frame.wheels.frontRight.loadN)}`;
    const rearLoads = `${Math.round(frame.wheels.rearLeft.loadN)} / ${Math.round(frame.wheels.rearRight.loadN)}`;
    const frontTemps = `${Math.round(frame.wheels.frontLeft.tireSurfaceTempC)} / ${Math.round(frame.wheels.frontRight.tireSurfaceTempC)}`;
    const rearTemps = `${Math.round(frame.wheels.rearLeft.tireSurfaceTempC)} / ${Math.round(frame.wheels.rearRight.tireSurfaceTempC)}`;
    const brakeTemps = `${Math.round(frame.wheels.frontLeft.brakeTempC)} ${Math.round(frame.wheels.frontRight.brakeTempC)} ${Math.round(frame.wheels.rearLeft.brakeTempC)} ${Math.round(frame.wheels.rearRight.brakeTempC)}`;
    this.readout.textContent = [
      `speed      ${(frame.speedMps * 3.6).toFixed(1)} km/h`,
      `yaw rate   ${frame.yawRate.toFixed(3)} rad/s`,
      `sideslip   ${(frame.sideslipRad * 180 / Math.PI).toFixed(2)} deg`,
      `steer      ${(frame.steeringAngleRad * 180 / Math.PI).toFixed(1)} deg`,
      `engine     ${Math.round(frame.rpm)} rpm  G${frame.gear}`,
      `input      T${frame.throttle.toFixed(2)} B${frame.brake.toFixed(2)}`,
      `load F     ${frontLoads} N`,
      `load R     ${rearLoads} N`,
      `tire C F   ${frontTemps}`,
      `tire C R   ${rearTemps}`,
      `brake C    ${brakeTemps}`,
      `sim frame  ${frame.simFrameMs.toFixed(3)} ms`,
      '',
      ...WHEEL_IDS.map((id) => {
        const wheel = frame.wheels[id];
        return `${shortWheel(id)} slip ${wheel.slipRatio.toFixed(2)} / ${(wheel.slipAngleRad * 180 / Math.PI).toFixed(1)} deg  mu ${wheel.tireMuScale.toFixed(2)} wear ${(wheel.tireWear * 100).toFixed(1)}%  Fx ${Math.round(wheel.fx)} Fy ${Math.round(wheel.fy)} ${wheel.surfaceMaterialId}`;
      }),
    ].join('\n');
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.classList.toggle('telemetry--hidden', !this.visible);
  }

  dispose(): void {
    this.root.remove();
  }

  private exportCsv(): void {
    const header = [
      'time',
      'speedMps',
      'yawRate',
      'sideslipRad',
      'steeringAngleRad',
      'rpm',
      'gear',
      'throttle',
      'brake',
      ...WHEEL_IDS.flatMap((id) => [
        `${id}.loadN`,
        `${id}.slipRatio`,
        `${id}.slipAngleRad`,
        `${id}.fx`,
        `${id}.fy`,
        `${id}.travel`,
        `${id}.tireSurfaceTempC`,
        `${id}.tireCarcassTempC`,
        `${id}.tireWear`,
        `${id}.tireMuScale`,
        `${id}.brakeTempC`,
        `${id}.brakeFade`,
      ]),
    ];
    const rows = this.samples.map((frame) => [
      frame.time,
      frame.speedMps,
      frame.yawRate,
      frame.sideslipRad,
      frame.steeringAngleRad,
      frame.rpm,
      frame.gear,
      frame.throttle,
      frame.brake,
      ...WHEEL_IDS.flatMap((id) => {
        const wheel = frame.wheels[id];
        return [
          wheel.loadN,
          wheel.slipRatio,
          wheel.slipAngleRad,
          wheel.fx,
          wheel.fy,
          wheel.suspensionTravel,
          wheel.tireSurfaceTempC,
          wheel.tireCarcassTempC,
          wheel.tireWear,
          wheel.tireMuScale,
          wheel.brakeTempC,
          wheel.brakeFade,
        ];
      }),
    ].join(','));
    const blob = new Blob([[header.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'vehicle-telemetry.csv';
    link.click();
    URL.revokeObjectURL(url);
  }
}

function shortWheel(id: WheelId): string {
  if (id === 'frontLeft') return 'FL';
  if (id === 'frontRight') return 'FR';
  if (id === 'rearLeft') return 'RL';
  return 'RR';
}
