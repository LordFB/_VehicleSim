import { HUD } from '../core/Constants';
import type { LapState } from '../game/LapTimer';
import type { PhysicsSnapshot, VehicleSpec } from '../sim/types';

/**
 * Forza-style corner HUD: an analog tachometer dial with a sweeping needle, a bold
 * digital speed readout and gear, plus a mini-map drawn from the track path. A
 * separate DOM strip shows iRacing-style lap timing (current / last / best / delta).
 * Everything is driven by the existing TelemetryFrame + LapState — no physics ties.
 */
export class Hud {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly timing: HTMLDivElement;
  private readonly tCur: HTMLSpanElement;
  private readonly tLast: HTMLSpanElement;
  private readonly tBest: HTMLSpanElement;
  private readonly tDelta: HTMLSpanElement;
  private readonly tLap: HTMLSpanElement;
  private readonly redlineRpm: number;
  private readonly idleRpm: number;
  private readonly trackPath: Array<[number, number]>;
  private readonly trackBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  private dpr = Math.min(window.devicePixelRatio || 1, 2);

  constructor(parent: HTMLElement, spec: VehicleSpec, trackPath: Array<[number, number]>) {
    this.redlineRpm = spec.engine.redlineRpm;
    this.idleRpm = spec.engine.idleRpm;
    this.trackPath = trackPath;
    this.trackBounds = boundsOf(trackPath);

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'hud-canvas';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', this.resize);

    // iRacing-style timing black box (DOM for crisp text + easy theming).
    this.timing = document.createElement('div');
    this.timing.className = 'timing overlay';
    this.timing.innerHTML = `
      <div class="timing__row timing__row--lap"><span class="timing__k">LAP</span><span class="timing__v" data-lap>0</span></div>
      <div class="timing__row"><span class="timing__k">CUR</span><span class="timing__v timing__v--big" data-cur>--:--.---</span></div>
      <div class="timing__row"><span class="timing__k">DELTA</span><span class="timing__v" data-delta>--.---</span></div>
      <div class="timing__row"><span class="timing__k">LAST</span><span class="timing__v" data-last>--:--.---</span></div>
      <div class="timing__row"><span class="timing__k">BEST</span><span class="timing__v timing__v--best" data-best>--:--.---</span></div>
    `;
    parent.appendChild(this.timing);
    this.tCur = this.timing.querySelector('[data-cur]')!;
    this.tLast = this.timing.querySelector('[data-last]')!;
    this.tBest = this.timing.querySelector('[data-best]')!;
    this.tDelta = this.timing.querySelector('[data-delta]')!;
    this.tLap = this.timing.querySelector('[data-lap]')!;
  }

  update(snapshot: PhysicsSnapshot, lap: LapState, autoShift: boolean): void {
    const t = snapshot.telemetry;
    this.drawCluster(t.rpm, t.speedMps * 3.6, t.gear, t.throttle, t.brake, autoShift);
    this.drawMiniMap(snapshot.chassis.position[0], snapshot.chassis.position[2], headingFromQuat(snapshot.chassis.orientation));
    this.updateTiming(lap);
  }

  private updateTiming(lap: LapState): void {
    this.tLap.textContent = String(lap.lapCount);
    this.tCur.textContent = lap.running ? formatLap(lap.currentMs) : '--:--.---';
    this.tLast.textContent = lap.lastMs !== null ? formatLap(lap.lastMs) : '--:--.---';
    this.tBest.textContent = lap.bestMs !== null ? formatLap(lap.bestMs) : '--:--.---';
    if (lap.deltaMs !== null && lap.bestMs !== null) {
      const ahead = lap.deltaMs <= 0;
      this.tDelta.textContent = `${ahead ? '-' : '+'}${(Math.abs(lap.deltaMs) / 1000).toFixed(3)}`;
      this.tDelta.style.color = ahead ? HUD.DELTA_NEG : HUD.DELTA_POS;
    } else {
      this.tDelta.textContent = '--.---';
      this.tDelta.style.color = HUD.TEXT_DIM;
    }
  }

  private drawCluster(rpm: number, kmh: number, gear: number, throttle: number, brake: number, autoShift: boolean): void {
    const ctx = this.ctx;
    const W = this.canvas.width / this.dpr;
    const H = this.canvas.height / this.dpr;
    ctx.clearRect(0, 0, W, H);

    // Bottom-right anchored dial (Forza placement). Keep the full backing circle
    // (radius + 14) and the gear badge above it inside the viewport.
    const radius = Math.max(70, Math.min(104, H * 0.15));
    const margin = 30;
    const cx = W - radius - margin - 14;
    const cy = H - radius - margin - 14;
    const start = Math.PI * 0.75; // sweep from lower-left
    const end = Math.PI * 2.25; // to lower-right (270deg)
    const sweep = end - start;

    // Dial backing.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 14, 0, Math.PI * 2);
    ctx.fillStyle = HUD.PANEL_BG;
    ctx.fill();

    // Track arc.
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.strokeStyle = HUD.DIAL_TRACK;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, end);
    ctx.stroke();

    // Filled rev arc, turning warm then red toward the limiter.
    const rpmFrac = clamp01((rpm - this.idleRpm) / (this.redlineRpm - this.idleRpm));
    const near = rpmFrac > 0.86;
    ctx.strokeStyle = near ? HUD.REDLINE : rpmFrac > 0.7 ? HUD.ACCENT_WARM : HUD.DIAL_FILL;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, start + sweep * rpmFrac);
    ctx.stroke();

    // Redline tick band.
    ctx.strokeStyle = HUD.REDLINE;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start + sweep * 0.86, end);
    ctx.stroke();

    // Needle.
    const ang = start + sweep * rpmFrac;
    ctx.strokeStyle = near ? HUD.REDLINE : '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * radius * 0.28, cy + Math.sin(ang) * radius * 0.28);
    ctx.lineTo(cx + Math.cos(ang) * radius * 0.92, cy + Math.sin(ang) * radius * 0.92);
    ctx.stroke();

    // Digital speed + unit.
    ctx.textAlign = 'center';
    ctx.fillStyle = HUD.TEXT;
    ctx.font = `700 ${Math.round(radius * 0.62)}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(String(Math.max(0, Math.round(kmh))), cx, cy + radius * 0.06);
    ctx.fillStyle = HUD.TEXT_DIM;
    ctx.font = `600 ${Math.round(radius * 0.16)}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillText('KM/H', cx, cy + radius * 0.3);

    // Gear badge.
    const gx = cx;
    const gy = cy - radius * 0.42;
    ctx.fillStyle = near ? HUD.REDLINE : HUD.ACCENT;
    ctx.font = `800 ${Math.round(radius * 0.34)}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(gearLabel(gear), gx, gy);

    // Transmission mode tag (M / A) beside the gear.
    ctx.fillStyle = HUD.TEXT_DIM;
    ctx.font = `700 ${Math.round(radius * 0.13)}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(autoShift ? 'AUTO' : 'MANUAL', cx, cy - radius * 0.66);
    ctx.restore();

    // Throttle / brake mini-bars to the left of the dial (iRacing input read).
    this.drawInputBar(cx - radius - 30, cy + radius * 0.55, throttle, HUD.GOOD);
    this.drawInputBar(cx - radius - 18, cy + radius * 0.55, brake, HUD.DELTA_POS);
  }

  private drawInputBar(x: number, yBottom: number, value: number, color: string): void {
    const ctx = this.ctx;
    const h = 74;
    const w = 7;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x, yBottom - h, w, h);
    ctx.fillStyle = color;
    const vh = h * clamp01(value);
    ctx.fillRect(x, yBottom - vh, w, vh);
  }

  private drawMiniMap(carX: number, carZ: number, headingRad: number): void {
    const ctx = this.ctx;
    const W = this.canvas.width / this.dpr;
    const size = 150;
    const pad = 22;
    const ox = W - size - pad;
    const oy = pad;

    ctx.save();
    // Panel.
    roundRect(ctx, ox - 10, oy - 10, size + 20, size + 20, 10);
    ctx.fillStyle = HUD.PANEL_BG;
    ctx.fill();

    const b = this.trackBounds;
    const spanX = Math.max(1, b.maxX - b.minX);
    const spanZ = Math.max(1, b.maxZ - b.minZ);
    const scale = (size * 0.86) / Math.max(spanX, spanZ);
    // World x is mirrored (negated) so the chase-cam handedness matches the real
    // circuit (see gen-monza-centerline.mjs); flip the map's x back so the silhouette
    // still reads with the first corner to the right, as on the real track map.
    const mapX = (x: number) => ox + size / 2 - (x - (b.minX + b.maxX) / 2) * scale;
    const mapY = (z: number) => oy + size / 2 - (z - (b.minZ + b.maxZ) / 2) * scale;

    // Track outline.
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    this.trackPath.forEach(([x, z], i) => {
      const px = mapX(x); const py = mapY(z);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();

    // Start/finish dot.
    ctx.fillStyle = HUD.TEXT;
    ctx.beginPath();
    ctx.arc(mapX(this.trackPath[0][0]), mapY(this.trackPath[0][1]), 3, 0, Math.PI * 2);
    ctx.fill();

    // Car arrow. The map's x-axis is mirrored (see mapX), so the heading rotation flips
    // sign to keep the arrow pointing the way the car actually travels.
    const px = mapX(carX); const py = mapY(carZ);
    ctx.translate(px, py);
    ctx.rotate(headingRad);
    ctx.fillStyle = HUD.ACCENT;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private resize = (): void => {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * this.dpr);
    this.canvas.height = Math.floor(window.innerHeight * this.dpr);
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  };

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.canvas.remove();
    this.timing.remove();
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function gearLabel(gear: number): string {
  if (gear < 0) return 'R';
  if (gear === 0) return 'N';
  return String(gear);
}

function formatLap(ms: number): string {
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  const millis = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function headingFromQuat(q: [number, number, number, number]): number {
  // Heading of local +Z forward axis projected on the XZ plane.
  const [x, y, z, w] = q;
  const fx = 2 * (x * z + w * y);
  const fz = 1 - 2 * (x * x + y * y);
  return Math.atan2(fx, fz);
}

function boundsOf(path: Array<[number, number]>): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of path) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  return { minX, maxX, minZ, maxZ };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
