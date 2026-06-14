import { AUDIO } from '../core/Constants';
import { SampleEngine } from './SampleEngine';
import type { TelemetryFrame, WheelId } from '../sim/types';

const WHEEL_IDS: WheelId[] = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'];

/**
 * Procedural car audio, all stock Web Audio.
 *
 * The ENGINE voice is sample-based (see SampleEngine) — real Ferrari 458 loops
 * crossfaded and pitch-shifted by rpm/throttle, which sounds far more natural than
 * synthesis. The harmonic synthesizer below is kept as an instant fallback: it plays
 * from the first frame and crossfades out once the (async-loaded) samples are ready,
 * so there's never a silent gap, and the offline verification harness — which can't
 * fetch/decode WAVs — still has a deterministic engine to analyse.
 *
 * The fallback engine is a harmonic-plus-noise V8 model rather than a pitched oscillator: a
 * 4-stroke's firing frequency is rpm * cylinders / 120 (= rpm/15 for a V8), and the
 * note is built from partials at integer "orders" of that frequency, with the 4th
 * order emphasized (the V8 signature). Each order's level is morphed between an
 * on-power and an overrun spectral envelope by engine load, a combustion-noise bed
 * fills the gaps between harmonics, an exhaust resonator + soft drive give body and
 * warmth, and trailing the throttle at high rpm pops decel "crackle".
 *
 * Layered on top: pink-ish wind rising with speed (+ a high sealing hiss), tyre scrub
 * from combined slip, low road rumble, and per-wheel suspension "thumps" fired from
 * compression-rate spikes. Everything is driven by the existing TelemetryFrame and
 * glued by a master compressor. Lazy-starts on first gesture; toggleMuted() mutes.
 */
export class EngineAudio {
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private started = false;
  private lastGear = 1;

  // Sample-based engine (primary) + synth fallback.
  private sampleEngine: SampleEngine | null = null;
  private sampleBus: GainNode | null = null; // sample voice output, faded in when ready
  private engineFallbackGain = 1; // synth engine mix, faded out once samples take over

  // Engine harmonic bank (fallback synth).
  private orderOscs: OscillatorNode[] = [];
  private orderGains: GainNode[] = [];
  private engineBus: GainNode | null = null;
  private engineLP: BiquadFilterNode | null = null;
  private combustionGain: GainNode | null = null;
  private combustionBP: BiquadFilterNode | null = null;

  // Layers.
  private windGain: GainNode | null = null;
  private hissGain: GainNode | null = null;
  private scrubGain: GainNode | null = null;
  private scrubBP: BiquadFilterNode | null = null;
  private rumbleGain: GainNode | null = null;

  // Sample-based tire squeal (primary scrub) + synth scrub fallback.
  private scrubSampleSrc: AudioBufferSourceNode | null = null;
  private scrubSampleGain: GainNode | null = null;
  private scrubSampleReady = false;
  private scrubFallbackGain = 1; // synth scrub mix, faded out once the loop is ready
  private impactBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  // Per-wheel state for impact edge detection.
  private prevTravel: Record<WheelId, number> = { frontLeft: 0, frontRight: 0, rearLeft: 0, rearRight: 0 };
  private impactCooldown: Record<WheelId, number> = { frontLeft: 0, frontRight: 0, rearLeft: 0, rearRight: 0 };
  private prevThrottle = 0;
  private crackleCooldown = 0;

  toggleMuted(): void {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : AUDIO.MASTER_GAIN, this.ctx.currentTime, 0.05);
    }
  }

  update(t: TelemetryFrame, dt: number): void {
    if (!this.started) {
      this.tryStart();
      if (!this.started) return;
    }
    if (!this.ctx) return;
    if (isRealtime(this.ctx) && this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.muted) {
      this.lastGear = t.gear;
      this.prevThrottle = t.throttle;
      return;
    }

    const now = this.ctx.currentTime;
    const dtc = Math.min(Math.max(dt, 1 / 240), 0.1); // clamp for transient detection

    this.updateEngine(t, now);
    this.updateWind(t, now);
    this.updateScrub(t, now);
    this.updateImpacts(t, dtc, now);

    // Gear-change blip (kept; quick mechanical tick).
    if (t.gear !== this.lastGear) {
      this.blip(t.gear > this.lastGear);
      this.lastGear = t.gear;
    }
    this.prevThrottle = t.throttle;
    this.crackleCooldown = Math.max(0, this.crackleCooldown - dtc);
    for (const id of WHEEL_IDS) this.impactCooldown[id] = Math.max(0, this.impactCooldown[id] - dtc);
  }

  // ---------------------------------------------------------------- engine ----

  private updateEngine(t: TelemetryFrame, now: number): void {
    // Primary path: sample-based engine. Once its WAVs are decoded, drive it and
    // crossfade the synth fallback down to silence over ~0.4s (no audible seam).
    if (this.sampleEngine?.isReady()) {
      this.sampleEngine.update(t.rpm, t.throttle, now);
      if (this.engineFallbackGain > 0.001) {
        this.engineFallbackGain = Math.max(0, this.engineFallbackGain - 0.05);
        this.engineBus?.gain.setTargetAtTime(AUDIO.ENGINE_GAIN * this.engineFallbackGain, now, 0.08);
      }
      if (this.engineFallbackGain <= 0.001) return; // synth fully ducked; skip its work
    }

    const firingHz = Math.max(AUDIO.FIRING_MIN_HZ, (t.rpm * AUDIO.CYLINDERS) / 120);
    const rpmFrac = clamp01(t.rpm / 7600);

    // Engine load: on-power when throttle is applied, overrun (engine braking) when
    // trailing throttle at speed. 1 = full power timbre, 0 = full overrun timbre.
    const onPower = clamp01(t.throttle * 1.15);
    const tcSlow = AUDIO.SMOOTH_SLOW;

    for (let i = 0; i < AUDIO.ORDERS.length; i++) {
      const order = AUDIO.ORDERS[i];
      const freq = firingHz * order;
      this.orderOscs[i].frequency.setTargetAtTime(freq, now, AUDIO.SMOOTH_FAST);
      // Crossfade this order's level between overrun and power envelopes.
      const wPower = AUDIO.ORDER_WEIGHTS_POWER[i];
      const wOver = AUDIO.ORDER_WEIGHTS_OVERRUN[i];
      let level = wOver + (wPower - wOver) * onPower;
      // Roll off partials above Nyquist-ish and at very high orders to avoid fizz.
      if (freq > 9000) level *= Math.max(0, 1 - (freq - 9000) / 6000);
      // Overall engine presence rises a little with revs and load.
      level *= 0.5 + 0.5 * Math.max(onPower, rpmFrac * 0.6);
      this.orderGains[i].gain.setTargetAtTime(level, now, tcSlow);
    }

    // Combustion noise bed: tracks firing frequency, grows with load + revs.
    this.combustionBP!.frequency.setTargetAtTime(clamp(firingHz * 2, 60, 3500), now, AUDIO.SMOOTH_FAST);
    const combLevel = AUDIO.COMBUSTION_NOISE * (0.4 + 0.6 * onPower) * (0.5 + 0.5 * rpmFrac);
    this.combustionGain!.gain.setTargetAtTime(combLevel, now, tcSlow);

    // Exhaust lowpass opens with throttle (brighter on power).
    const cutoff = AUDIO.ENGINE_LP_BASE + AUDIO.ENGINE_LP_THROTTLE * onPower + firingHz * 1.5;
    this.engineLP!.frequency.setTargetAtTime(cutoff, now, AUDIO.SMOOTH_FAST);

    // Overrun decel crackle: throttle just dropped while spinning fast.
    const lifting = this.prevThrottle - t.throttle > 0.18;
    if (lifting && rpmFrac > AUDIO.CRACKLE_RPM_FRAC && this.crackleCooldown <= 0) {
      this.crackle(now, rpmFrac);
      this.crackleCooldown = 0.18;
    }
  }

  // ------------------------------------------------------------------ wind ----

  private updateWind(t: TelemetryFrame, now: number): void {
    const speedFrac = clamp01(t.speedMps / AUDIO.WIND_REF_MPS);
    // Broadband body rises ~speed^2; hiss layer rises faster and later.
    const windLevel = AUDIO.WIND_GAIN * speedFrac * speedFrac;
    const hissLevel = AUDIO.WIND_HISS_GAIN * Math.pow(speedFrac, 2.4);
    this.windGain!.gain.setTargetAtTime(windLevel, now, AUDIO.SMOOTH_SLOW);
    this.hissGain!.gain.setTargetAtTime(hissLevel, now, AUDIO.SMOOTH_SLOW);
    // Low road rumble grows with speed (tyre-on-tarmac floor).
    const rumble = AUDIO.RUMBLE_GAIN * clamp01(t.speedMps / 35);
    this.rumbleGain!.gain.setTargetAtTime(rumble, now, AUDIO.SMOOTH_SLOW);
  }

  // ------------------------------------------------------------------ scrub ----

  private updateScrub(t: TelemetryFrame, now: number): void {
    let slip = 0;
    for (const id of WHEEL_IDS) {
      const w = t.wheels[id];
      if (!w.contact) continue;
      slip = Math.max(slip, Math.hypot(w.slipRatio, w.slipAngleRad));
    }
    const over = Math.max(0, slip - AUDIO.SCRUB_SLIP);

    // Primary: real tire-squeal loop, gain driven by how far past the slip threshold
    // we are. Detune rises with slip so harder slides sound more strained. The loop
    // also quiets at very low speed (a stationary locked wheel shouldn't sing).
    if (this.scrubSampleReady && this.scrubSampleGain && this.scrubSampleSrc) {
      const speedGate = clamp01(t.speedMps / AUDIO.SCRUB_SAMPLE_SPEED_GATE);
      const level = Math.min(AUDIO.SCRUB_SAMPLE_GAIN, over * AUDIO.SCRUB_SAMPLE_SLIP_GAIN) * speedGate;
      this.scrubSampleGain.gain.setTargetAtTime(level, now, AUDIO.SMOOTH_FAST);
      this.scrubSampleSrc.detune.setTargetAtTime(clamp(over * AUDIO.SCRUB_SAMPLE_DETUNE, -200, 700), now, AUDIO.SMOOTH_FAST);

      // Crossfade the synth scrub out once the loop is carrying the sound.
      if (this.scrubFallbackGain > 0.001) {
        this.scrubFallbackGain = Math.max(0, this.scrubFallbackGain - 0.05);
      }
      this.scrubGain!.gain.setTargetAtTime(Math.min(AUDIO.SCRUB_GAIN, over * 0.9) * this.scrubFallbackGain, now, AUDIO.SMOOTH_FAST);
      this.scrubBP!.frequency.setTargetAtTime(clamp(1100 + over * 700, 900, 3200), now, AUDIO.SMOOTH_FAST);
      return;
    }

    // Fallback: synthesized bandpass-noise scrub (offline / before the loop loads).
    const level = Math.min(AUDIO.SCRUB_GAIN, over * 0.9);
    this.scrubGain!.gain.setTargetAtTime(level, now, AUDIO.SMOOTH_FAST);
    this.scrubBP!.frequency.setTargetAtTime(clamp(1100 + over * 700, 900, 3200), now, AUDIO.SMOOTH_FAST);
  }

  // --------------------------------------------------------------- impacts ----

  private updateImpacts(t: TelemetryFrame, dt: number, now: number): void {
    for (const id of WHEEL_IDS) {
      const w = t.wheels[id];
      const travel = w.suspensionTravel;
      const rate = (travel - this.prevTravel[id]) / dt; // compression rate, m/s
      this.prevTravel[id] = travel;
      if (this.impactCooldown[id] > 0) continue;
      // Fire on a sharp compression spike (landing / hitting a bump or kerb).
      if (Math.abs(rate) > AUDIO.IMPACT_RATE_THRESHOLD && w.contact) {
        const strength = clamp01((Math.abs(rate) - AUDIO.IMPACT_RATE_THRESHOLD) / 3);
        this.thump(now, strength);
        this.impactCooldown[id] = AUDIO.IMPACT_COOLDOWN_S;
      }
    }
  }

  // ----------------------------------------------------------------- setup ----

  private tryStart(): void {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.buildGraph(new Ctx());
    } catch {
      this.ctx = null;
    }
  }

  /**
   * Test/verification seam: build the full graph in a provided context (e.g. an
   * OfflineAudioContext) so the rendered signal can be analysed. Returns the master
   * node so a harness can also tap it.
   */
  startOffline(ctx: BaseAudioContext): GainNode {
    this.buildGraph(ctx);
    return this.master!;
  }

  private buildGraph(ctx: BaseAudioContext): void {
    this.ctx = ctx;
    this.noiseBuffer = this.makeNoiseBuffer(ctx, 2.5);

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : AUDIO.MASTER_GAIN;
    // Glue compressor so layers sit together and nothing clips.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 24;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    this.master.connect(comp).connect(ctx.destination);

    this.buildEngine(ctx);
    this.buildWind(ctx);
    this.buildScrub(ctx);
    this.buildRumble(ctx);
    this.impactBus = ctx.createGain();
    this.impactBus.gain.value = 1;
    this.impactBus.connect(this.master);

    // Sample-based engine voice (real recordings). Loaded async; until ready the synth
    // fallback carries the engine. Only attempted in a realtime context — the offline
    // verify harness can't fetch/decode WAVs, so it stays on the synth.
    if (isRealtime(ctx)) {
      this.sampleBus = ctx.createGain();
      this.sampleBus.gain.value = AUDIO.ENGINE_GAIN;
      this.sampleBus.connect(this.master);
      this.sampleEngine = new SampleEngine(ctx, this.sampleBus);
      void this.sampleEngine.load();
      void this.loadScrubSample(ctx);
    }

    this.started = true;
  }

  /**
   * Load the real tire-squeal loop for the scrub layer. Like the engine samples this
   * is async (decodeAudioData) and realtime-only; until ready the synth scrub carries
   * the sound and is then crossfaded out. The loop plays continuously at zero gain and
   * is mixed by gain automation in updateScrub (no clicks).
   */
  private async loadScrubSample(ctx: BaseAudioContext): Promise<void> {
    try {
      const res = await fetch(AUDIO.SCRUB_SAMPLE_URL);
      if (!res.ok) return;
      const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      if (!this.master) return;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(this.master);
      src.start();
      this.scrubSampleSrc = src;
      this.scrubSampleGain = gain;
      this.scrubSampleReady = true;
    } catch {
      // keep the synth scrub fallback
    }
  }

  private buildEngine(ctx: BaseAudioContext): void {
    // Engine bus: harmonics + combustion noise -> soft drive -> resonator -> lowpass.
    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = AUDIO.ENGINE_GAIN;

    const drive = ctx.createWaveShaper();
    drive.curve = makeDriveCurve(AUDIO.ENGINE_DRIVE);
    drive.oversample = '2x';

    const resonator = ctx.createBiquadFilter();
    resonator.type = 'peaking';
    resonator.frequency.value = AUDIO.RESONATOR_HZ;
    resonator.Q.value = AUDIO.RESONATOR_Q;
    resonator.gain.value = 6;

    this.engineLP = ctx.createBiquadFilter();
    this.engineLP.type = 'lowpass';
    this.engineLP.frequency.value = AUDIO.ENGINE_LP_BASE;
    this.engineLP.Q.value = 0.7;

    this.engineBus.connect(drive).connect(resonator).connect(this.engineLP).connect(this.master!);

    // Harmonic partials (one oscillator per order).
    for (let i = 0; i < AUDIO.ORDERS.length; i++) {
      const osc = ctx.createOscillator();
      // Sawtooth gives each partial its own mini-harmonic stack -> richer, less "pure".
      osc.type = i === 0 ? 'triangle' : 'sawtooth';
      osc.frequency.value = 60 * AUDIO.ORDERS[i];
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      osc.connect(g).connect(this.engineBus);
      osc.start();
      this.orderOscs.push(osc);
      this.orderGains.push(g);
    }

    // Combustion noise -> bandpass -> into the engine bus.
    const noise = this.makeNoiseSource(ctx);
    this.combustionBP = ctx.createBiquadFilter();
    this.combustionBP.type = 'bandpass';
    this.combustionBP.frequency.value = 200;
    this.combustionBP.Q.value = 0.8;
    this.combustionGain = ctx.createGain();
    this.combustionGain.gain.value = 0.0001;
    noise.connect(this.combustionBP).connect(this.combustionGain).connect(this.engineBus);
  }

  private buildWind(ctx: BaseAudioContext): void {
    // Pink-ish wind: white noise shaped down toward the highs (~-3 dB/oct).
    const noise = this.makeNoiseSource(ctx);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    lp.Q.value = 0.5;
    const tilt = ctx.createBiquadFilter();
    tilt.type = 'highshelf';
    tilt.frequency.value = 900;
    tilt.gain.value = -9; // roll the top down for the pink slope
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.0001;
    noise.connect(lp).connect(tilt).connect(this.windGain).connect(this.master!);

    // Sealing hiss: high-passed noise that comes in at speed.
    const hiss = this.makeNoiseSource(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2200;
    hp.Q.value = 0.6;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0.0001;
    hiss.connect(hp).connect(this.hissGain).connect(this.master!);
  }

  private buildScrub(ctx: BaseAudioContext): void {
    const noise = this.makeNoiseSource(ctx);
    this.scrubBP = ctx.createBiquadFilter();
    this.scrubBP.type = 'bandpass';
    this.scrubBP.frequency.value = 1200;
    this.scrubBP.Q.value = 0.9;
    // A little low-end "roar" under the band for rubber body.
    const low = ctx.createBiquadFilter();
    low.type = 'lowshelf';
    low.frequency.value = 500;
    low.gain.value = 4;
    this.scrubGain = ctx.createGain();
    this.scrubGain.gain.value = 0.0001;
    noise.connect(this.scrubBP).connect(low).connect(this.scrubGain).connect(this.master!);
  }

  private buildRumble(ctx: BaseAudioContext): void {
    const noise = this.makeNoiseSource(ctx);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    lp.Q.value = 0.7;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0.0001;
    noise.connect(lp).connect(this.rumbleGain).connect(this.master!);
  }

  // ---------------------------------------------------------------- voices ----

  /** Suspension thump: a low sine blip + a short filtered-noise knock. */
  private thump(now: number, strength: number): void {
    if (!this.ctx || !this.impactBus) return;
    const amp = AUDIO.IMPACT_GAIN * (0.4 + 0.6 * strength);

    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(AUDIO.IMPACT_THUMP_HZ * (1 + strength * 0.4), now);
    o.frequency.exponentialRampToValueAtTime(AUDIO.IMPACT_THUMP_HZ * 0.6, now + 0.12);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.0001, now);
    og.gain.exponentialRampToValueAtTime(amp, now + 0.006);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    o.connect(og).connect(this.impactBus);
    o.start(now);
    o.stop(now + 0.18);

    // Knock transient (filtered noise burst).
    const n = this.makeNoiseSource(this.ctx);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 180;
    bp.Q.value = 0.8;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(amp * 0.6, now);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    n.connect(bp).connect(ng).connect(this.impactBus);
    n.stop(now + 0.12);
  }

  /** Overrun crackle: a couple of short noisy pops. */
  private crackle(now: number, rpmFrac: number): void {
    if (!this.ctx || !this.impactBus) return;
    const pops = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < pops; i++) {
      const at = now + i * (0.02 + Math.random() * 0.03);
      const n = this.makeNoiseSource(this.ctx);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1200 + Math.random() * 2200;
      bp.Q.value = 2.5;
      const g = this.ctx.createGain();
      const amp = AUDIO.CRACKLE_GAIN * (0.25 + 0.4 * rpmFrac) * (0.6 + Math.random() * 0.4);
      g.gain.setValueAtTime(amp, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
      n.connect(bp).connect(g).connect(this.impactBus);
      n.stop(at + 0.06);
    }
  }

  private blip(up: boolean): void {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = up ? 520 : 360;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.08, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    o.connect(g).connect(this.master);
    o.start(now);
    o.stop(now + 0.12);
  }

  // ------------------------------------------------------------------ noise ----

  private makeNoiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** A looping noise source sharing the cached buffer (cheap, no per-call alloc of data). */
  private makeNoiseSource(ctx: BaseAudioContext): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer ?? this.makeNoiseBuffer(ctx, 2.5);
    src.loop = true;
    src.start();
    return src;
  }

  dispose(): void {
    try {
      this.sampleEngine?.dispose();
      this.scrubSampleSrc?.stop();
      for (const osc of this.orderOscs) osc.stop();
      if (this.ctx && isRealtime(this.ctx)) void this.ctx.close();
    } catch {
      // ignore
    }
    this.sampleEngine = null;
    this.scrubSampleSrc = null;
    this.scrubSampleReady = false;
    this.orderOscs = [];
    this.orderGains = [];
    this.ctx = null;
  }
}

function isRealtime(ctx: BaseAudioContext): ctx is AudioContext {
  // OfflineAudioContext also has resume()/state, so those don't discriminate. Only a
  // realtime AudioContext exposes baseLatency — using it avoids calling resume() on an
  // offline context (which throws "cannot resume an offline context that has not started").
  return 'baseLatency' in ctx;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

/** Soft-clip waveshaper curve for gentle harmonic saturation/warmth. */
function makeDriveCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const k = amount * 12 + 1;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}
