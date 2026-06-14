export const SIM = {
  FIXED_HZ: 240,
  VEHICLE_SUBSTEPS: 3,
  RENDER_DELTA_CAP: 0.1,
  INITIAL_SEED: 42,
};

export const CAMERA = {
  FOV: 60,
  NEAR: 0.05,
  FAR: 1200,
  FOLLOW_OFFSET: { x: 0, y: 4.2, z: -8.5 },
  LOOK_AHEAD: { x: 0, y: 1.1, z: 5.5 },
  LERP: 0.12,
  // Speed-scaled FOV kick (Forza-style sense of speed) and slip/impact shake.
  FOV_SPEED_GAIN: 9, // extra degrees approached at high speed
  FOV_SPEED_REF_MPS: 75, // speed at which most of the FOV gain is reached
  FOV_LERP: 0.08,
  SHAKE_SLIP_THRESHOLD: 0.35, // |slip| above which micro-shake begins
  SHAKE_MAX: 0.12, // metres of positional jitter at peak
};

// Warm golden-hour lighting rig (Forza Horizon identity).
export const LIGHTING = {
  SUN_COLOR: 0xffd9a0, // low, warm key light
  SUN_INTENSITY: 3.1,
  SUN_POSITION: { x: -42, y: 34, z: -26 }, // low and to the side -> long shadows
  SUN_TARGET: { x: 0, y: 0, z: 14 },
  HEMI_SKY: 0xbfdcff, // cool sky fill
  HEMI_GROUND: 0xb08d5a, // warm bounce from the ground
  HEMI_INTENSITY: 1.05,
  FILL_COLOR: 0xfff0db,
  FILL_INTENSITY: 0.45,
  EXPOSURE: 1.18, // ACES filmic exposure — lift the foreground so paint reads
  SHADOW_MAP_SIZE: 2048,
  SHADOW_BOUNDS: 70, // ortho half-extent covering the playable area
  SHADOW_BIAS: -0.0004,
  SHADOW_RADIUS: 3, // PCF penumbra softening
};

// Tall vertical sky gradient (zenith -> horizon) + matching haze.
export const SKY = {
  ZENITH: 0x2f6fb0, // deep blue overhead
  HORIZON: 0xdfe7ec, // pale warm horizon band
  GROUND_TINT: 0xb7a988, // below-horizon wash
  HORIZON_BLEND: 0.52, // where the warm band sits (0 horizon .. 1 zenith)
  RADIUS: 800,
  FOG_COLOR: 0xe6dccb, // warm hazy horizon (golden-hour atmosphere)
  FOG_NEAR: 95,
  FOG_FAR: 540,
};

export const COLORS = {
  // legacy keys kept for any remaining references; sky/fog now come from SKY.*
  SKY: SKY.HORIZON,
  FOG: SKY.FOG_COLOR,
  AMBIENT: 0xffffff,
  SUN: LIGHTING.SUN_COLOR,
  ASPHALT: 0x24262b, // darker, richer tarmac that reads as road under warm light
  ASPHALT_EDGE: 0x1c1e22,
  PAINT: 0xeef0e6, // lane lines
  KERB_RED: 0xc0392b, // motorsport rumble-strip red
  KERB_WHITE: 0xeae7dc,
  GRASS: 0x3f7a34, // saturated, sunlit green
  GRASS_FAR: 0x4f8a3c, // surrounding ground plane
  GRAVEL: 0x9a8e72,
  ICE: 0x9fd3e2,
  CAR_BODY: 0x1f5fbf,
  CAR_BODY_ACCENT: 0x0e3f8c,
  CAR_GLASS: 0x0a0f16,
  CAR_RIM: 0xb9bfc6,
  CAR_DISC: 0x4a4d52,
  WHEEL: 0x16171a,
  BARRIER: 0x6b7480,
  BARRIER_STRIPE: 0xd24a3a,
  FORCE_LONGITUDINAL: 0x35d07f,
  FORCE_LATERAL: 0xffcc45,
  TIRE_COLD: 0x4da3ff,
  TIRE_READY: 0x34d47f,
  TIRE_HOT: 0xff5a3c,
  START_FINISH: 0xf4f6f8,
  SKID: 0x141414, // dark rubber laid on slip
};

// HUD / UI theme — Forza dial cluster + iRacing black box.
export const HUD = {
  ACCENT: '#3fb7ff', // primary cyan accent (sim-racing genre)
  ACCENT_WARM: '#ff9d2f', // shift / warning
  REDLINE: '#ff3b3b',
  TEXT: '#f2f6fb',
  TEXT_DIM: '#9fb0c0',
  PANEL_BG: 'rgba(8, 12, 18, 0.62)',
  PANEL_BORDER: 'rgba(120, 150, 180, 0.22)',
  DIAL_TRACK: 'rgba(255, 255, 255, 0.10)',
  DIAL_FILL: '#3fb7ff',
  GOOD: '#37d47f',
  DELTA_POS: '#ff5a4d', // slower than best (red)
  DELTA_NEG: '#37d47f', // faster than best (green)
};

export const DEBUG_VISUALS = {
  FORCE_VECTOR_SCALE: 0.00055,
  FORCE_VECTOR_MAX_LENGTH: 2.4,
  CONTACT_PATCH_RADIUS: 0.18,
  CONTACT_PATCH_LOAD_SCALE: 0.000035,
};

// Skid marks + tire smoke (juice). Thresholds tuned low enough that ordinary
// sliding/locking on grippy asphalt visibly lays rubber and kicks up smoke.
export const JUICE = {
  SKID_SLIP_RATIO: 0.1, // |slipRatio| above which rubber is laid
  SKID_SLIP_ANGLE_RAD: 0.12, // |slipAngle| above which rubber is laid
  SKID_MAX_QUADS: 2600, // pooled ring buffer of skid segments
  SKID_WIDTH: 0.24,
  SKID_MIN_STEP: 0.16, // metres between dropped segments
  SMOKE_MAX: 260, // pooled smoke particles
  SMOKE_SLIP: 0.28, // combined-slip magnitude that emits smoke
  SMOKE_LIFE: 1.2, // seconds
  SMOKE_RISE: 1.5, // m/s upward drift
};

// Procedural audio. Engine is a harmonic-plus-noise V8 model: firing frequency for a
// 4-stroke is rpm * cylinders / 120 (= rpm/15 for a V8). Partials sit at integer
// "orders" of that firing frequency; ORDER_WEIGHTS shape the spectral envelope with a
// deliberate bump at the 4th order (the V8 identity). Two envelopes (on-power vs
// overrun) are crossfaded by engine load.
export const AUDIO = {
  CYLINDERS: 8,
  MASTER_GAIN: 0.85,
  ENGINE_GAIN: 0.9,
  // Orders to synthesize and their relative levels on power vs on overrun (trailing
  // throttle). Index-aligned with ORDERS.
  ORDERS: [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8],
  ORDER_WEIGHTS_POWER: [0.32, 1.0, 0.28, 0.74, 0.18, 0.5, 0.85, 0.34, 0.22, 0.14],
  ORDER_WEIGHTS_OVERRUN: [0.5, 0.62, 0.74, 0.4, 0.22, 0.26, 0.34, 0.16, 0.1, 0.06],
  FIRING_MIN_HZ: 18, // floor so idle never clicks/drops out
  RESONATOR_HZ: 150, // exhaust body formant
  RESONATOR_Q: 1.1,
  ENGINE_LP_BASE: 700, // lowpass cutoff at closed throttle
  ENGINE_LP_THROTTLE: 5200, // extra cutoff opened by throttle
  ENGINE_DRIVE: 0.35, // waveshaper amount (harmonic warmth)
  COMBUSTION_NOISE: 0.16, // grit between harmonics, scaled by load
  // Overrun decel crackle.
  CRACKLE_RPM_FRAC: 0.45, // only above this rpm fraction
  CRACKLE_GAIN: 0.5,
  // Wind: pink-ish broadband rising ~speed^2, plus a high hiss layer.
  WIND_GAIN: 0.6,
  WIND_REF_MPS: 75, // speed at which wind is near full
  WIND_HISS_GAIN: 0.28,
  // Tire scrub from combined slip. The synth (bandpass-noise) scrub is the fallback;
  // the primary is a real tire-squeal loop (SCRUB_SAMPLE_*), faded in when it loads.
  SCRUB_GAIN: 0.5,
  SCRUB_SLIP: 0.22,
  SCRUB_SAMPLE_URL: 'audio/engine/tires_squal_loop.wav',
  SCRUB_SAMPLE_GAIN: 0.85, // max loop gain at full slip
  SCRUB_SAMPLE_SLIP_GAIN: 1.4, // gain per unit of slip past the threshold
  SCRUB_SAMPLE_SPEED_GATE: 4, // m/s at which the squeal reaches full volume (quiet when crawling)
  SCRUB_SAMPLE_DETUNE: 900, // cents of detune per unit slip (harder slides sound more strained)
  // Road rumble floor.
  RUMBLE_GAIN: 0.22,
  // Suspension impacts: a thump when |d(suspensionTravel)/dt| exceeds threshold.
  IMPACT_RATE_THRESHOLD: 0.9, // m/s of compression-rate to trigger
  IMPACT_GAIN: 0.7,
  IMPACT_THUMP_HZ: 72,
  IMPACT_COOLDOWN_S: 0.12, // per wheel, prevents machine-gunning
  SMOOTH_FAST: 0.04, // setTargetAtTime time-constants
  SMOOTH_SLOW: 0.12,
};

// Cosmetic environment scenery (instanced trees, hills, reflector posts) that fills
// the empty horizon. Deterministic via SEED so e2e screenshots stay stable.
export const SCENERY = {
  SEED: 1337,
  // Background hills ringing the arena, sitting in the haze band.
  HILL_COUNT: 26,
  HILL_RADIUS: 420,
  HILL_MIN_R: 40,
  HILL_MAX_R: 95,
  HILL_COLOR: 0x4a6a52, // hazy blue-green distance
  // Scattered conifer forest ring.
  TREE_COUNT: 320,
  TREE_INNER_R: 34, // clear arena radius around the playable strip
  TREE_OUTER_R: 240,
  TREE_CENTER_Z: 14, // bias scatter toward the road's centre
  TREE_CORRIDOR_HALF: 22, // keep trees off the road corridor in x
  TREE_MIN_H: 4.5,
  TREE_MAX_H: 11,
  TRUNK_COLOR: 0x4a3826,
  // Reflector posts down both verges.
  POST_COUNT: 26, // per side
  POST_X: 8.5,
  POST_HEIGHT: 1.05,
  POST_SPACING: 6,
  POST_START_Z: -42,
  POST_COLOR: 0xcfd4d8,
  REFLECTOR_COLOR: 0xff8a3c, // warm amber retroreflector
};

// Sample-based engine voice (Ferrari 458 loops from markeasting/engine-audio, MIT).
// Each loop is tagged with the rpm it was recorded at; SampleEngine crossfades the
// low/high and on/off pairs and pitch-shifts each loop by its rpm deviation. Served
// from public/audio/engine/*.wav (vite copies public/ to the web root). The `rpm`
// and `volume` values mirror the reference's 458 configuration.
export const ENGINE_SAMPLES = {
  on_low: { url: 'audio/engine/on_low.wav', rpm: 5300, volume: 1.5 },
  on_high: { url: 'audio/engine/on_high.wav', rpm: 7700, volume: 2.5 },
  off_low: { url: 'audio/engine/off_low.wav', rpm: 6900, volume: 1.4 },
  off_high: { url: 'audio/engine/off_high.wav', rpm: 7900, volume: 1.6 },
  limiter: { url: 'audio/engine/limiter.wav', rpm: 7600, volume: 1.8 },
};

export const RENDER = {
  PIXEL_RATIO_CAP: 2,
};

export const INPUT = {
  STEERING_DECAY: 7,
  TOUCH_SIZE_PX: 118,
  // Corrects the physics steering convention so "right" turns the car right.
  STEER_SIGN: -1,
  STICK_DEADZONE: 0.09,
  STEER_EXPO: 0.4, // 0 = linear, 1 = full cubic (finer control near center)
};
