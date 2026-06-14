import { ENGINE_SAMPLES } from '../core/Constants';

/** One looping engine recording, with the rpm it was captured at and a trim gain. */
export type SampleSpec = {
  url: string;
  rpm: number; // reference rpm the loop was recorded at
  volume: number;
};

type Voice = {
  src: AudioBufferSourceNode;
  gain: GainNode;
  spec: SampleSpec;
};

/**
 * Sample-based engine voice, ported from markeasting/engine-audio (MIT).
 *
 * Pure additive synthesis sounds artificial and thin at speed because a firing-
 * frequency oscillator stack is dominated by high partials. Real engine audio is
 * granular and noisy in a way that's hard to synthesize; the natural-sounding
 * reference instead loops a handful of real recordings (Ferrari 458 here) and:
 *
 *  1. crossfades a LOW vs HIGH rpm pair (equal-power) by engine rpm,
 *  2. crossfades the ON-power vs OFF-overrun pair by throttle,
 *  3. pitch-shifts each loop via `detune` (cents) proportional to how far actual
 *     rpm is from the rpm that loop was recorded at — so pitch tracks revs without
 *     ever sounding like a pure tone.
 *
 * A separate limiter loop fades in near the rev limit. All loops play continuously
 * at zero gain and are mixed purely by gain automation, so there are no clicks.
 *
 * Loading is async (decodeAudioData); until the buffers resolve, isReady() is false
 * and the caller can keep a quiet fallback running.
 */
export class SampleEngine {
  private readonly voices = new Map<string, Voice>();
  private ready = false;
  private loading = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly out: AudioNode,
  ) {}

  isReady(): boolean {
    return this.ready;
  }

  /** Kick off async load + wiring of all sample loops. Safe to call once. */
  async load(): Promise<void> {
    if (this.loading || this.ready) return;
    this.loading = true;
    const specs = ENGINE_SAMPLES as Record<string, SampleSpec>;
    const entries = Object.entries(specs);
    await Promise.all(
      entries.map(async ([key, spec]) => {
        const buffer = await this.fetchBuffer(spec.url);
        if (!buffer) return;
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        const gain = this.ctx.createGain();
        gain.gain.value = 0;
        src.connect(gain).connect(this.out);
        src.start();
        this.voices.set(key, { src, gain, spec });
      }),
    );
    this.ready = this.voices.size > 0;
    this.loading = false;
  }

  /**
   * Drive the mix from the current rpm/throttle. `pitchFactor` is cents-per-rpm of
   * deviation from each loop's reference rpm (reference uses ~0.2).
   */
  update(rpm: number, throttle: number, now: number): void {
    if (!this.ready) return;

    // Equal-power crossfades: low<->high by rpm, on<->off by throttle.
    const { lo, hi } = crossFade(rpm, ENGINE_SAMPLES_BLEND.RPM_LO, ENGINE_SAMPLES_BLEND.RPM_HI);
    const { lo: on, hi: off } = crossFade(throttle, 0, 1);
    const limiterGain = ratio(rpm, ENGINE_SAMPLES_BLEND.LIMITER_START, ENGINE_SAMPLES_BLEND.LIMITER_END);

    this.apply('on_low', on * lo, rpm, now);
    this.apply('off_low', off * lo, rpm, now);
    this.apply('on_high', on * hi, rpm, now);
    this.apply('off_high', off * hi, rpm, now);
    this.apply('limiter', limiterGain, rpm, now, false);
  }

  private apply(key: string, gain: number, rpm: number, now: number, pitch = true): void {
    const voice = this.voices.get(key);
    if (!voice) return;
    if (pitch) {
      const detune = (rpm - voice.spec.rpm) * ENGINE_SAMPLES_BLEND.PITCH_FACTOR;
      voice.src.detune.setTargetAtTime(detune, now, 0.03);
    }
    voice.gain.gain.setTargetAtTime(gain * voice.spec.volume, now, 0.04);
  }

  dispose(): void {
    for (const { src } of this.voices.values()) {
      try {
        src.stop();
      } catch {
        // already stopped
      }
    }
    this.voices.clear();
    this.ready = false;
  }

  private async fetchBuffer(url: string): Promise<AudioBuffer | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const arrayBuffer = await res.arrayBuffer();
      return await this.ctx.decodeAudioData(arrayBuffer);
    } catch {
      return null;
    }
  }
}

// Crossfade / limiter bounds. Kept here (not in Constants) since they're meaningless
// without the crossFade math right above them; the sample SET lives in Constants.
const ENGINE_SAMPLES_BLEND = {
  RPM_LO: 3000,
  RPM_HI: 6500,
  LIMITER_START: 7300,
  LIMITER_END: 7600,
  PITCH_FACTOR: 0.2, // cents of detune per rpm of deviation from a loop's reference rpm
};

/** Equal-power crossfade: returns gains summing in power to 1 across [start,end]. */
function crossFade(value: number, start: number, end: number): { lo: number; hi: number } {
  const x = clamp((value - start) / (end - start), 0, 1);
  return {
    lo: Math.cos(x * 0.5 * Math.PI), // dominant at low end
    hi: Math.cos((1 - x) * 0.5 * Math.PI), // dominant at high end
  };
}

/** Linear 0..1 ramp of value across [start,end]. */
function ratio(value: number, start: number, end: number): number {
  return clamp((value - start) / (end - start), 0, 1);
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
