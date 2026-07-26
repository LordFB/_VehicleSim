export const SIM = {
  FIXED_HZ: 240,
  VEHICLE_SUBSTEPS: 3,
  RENDER_DELTA_CAP: 0.1,
  INITIAL_SEED: 42,
};

export const CAMERA = {
  FOV: 54,
  NEAR: 0.05,
  FAR: 1200,
  FOLLOW_DISTANCE: 6.8,
  FOLLOW_HEIGHT: 2.35,
  LOOK_AHEAD_DISTANCE: 15,
  LOOK_AHEAD_SPEED_GAIN: 6,
  LOOK_HEIGHT: 1.15,
  LERP: 0.16,
  TARGET_LERP: 0.22,
  // Restrained speed FOV for racing distance judgment instead of arcade zoom.
  FOV_SPEED_GAIN: 3,
  FOV_SPEED_REF_MPS: 90,
  FOV_LERP: 0.08,
  CHASE_YAW_LOOK_GAIN: 1.15,
  CHASE_SIDESLIP_LOOK_GAIN: 2.6,
  ONBOARD: {
    FOV: 63,
    NEAR: 0.025,
    EYE_OFFSET: [0, 0.54, 0.56] as [number, number, number],
    LOOK_OFFSET: [0, 0.42, 18] as [number, number, number],
    WHEEL_OFFSET: [0, 0.22, 0.94] as [number, number, number],
    POSITION_LERP: 0.48,
    TARGET_LERP: 0.42,
    FOV_LERP: 0.22,
    SPEED_REF_MPS: 70,
    SPEED_HEAVE: 0.025,
    BRAKE_DIVE: 0.018,
    SIDESLIP_HEAD_GAIN: 0.08,
    YAW_HEAD_GAIN: 0.025,
  },
  NOSE: {
    FOV: 60,
    NEAR: 0.025,
    EYE_OFFSET: [0, 0.1, 1.92] as [number, number, number],
    LOOK_OFFSET: [0, 0.14, 22] as [number, number, number],
    POSITION_LERP: 0.38,
    TARGET_LERP: 0.36,
    FOV_LERP: 0.18,
  },
};

export const COCKPIT = {
  WHEEL_STEER_RATIO: 5.2,
  WHEEL_TILT_RAD: -0.42,
  SHIFT_LED_COUNT: 9,
  LED_RPM_START_FRAC: 0.72,
};

export const VEHICLE_VIEW = {
  CHASSIS_ORIENTATION_LERP: 0.32,
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

// Atmospheric sky (Preetham scattering) + matching haze.
export const SKY = {
  ZENITH: 0x2f6fb0, // deep blue overhead (legacy; used for fog/ambient fallbacks)
  HORIZON: 0xdfe7ec, // pale warm horizon band (legacy)
  GROUND_TINT: 0xb7a988, // below-horizon wash (legacy)
  HORIZON_BLEND: 0.52, // where the warm band sits (0 horizon .. 1 zenith) (legacy)
  RADIUS: 800,
  FOG_COLOR: 0xe6dccb, // warm hazy horizon (golden-hour atmosphere)
  FOG_NEAR: 95,
  FOG_FAR: 540,
  // Preetham atmospheric-scattering parameters (three's Sky shader). The shader
  // outputs linear HDR radiance that the renderer's ACES tone-map then maps; the
  // values are tuned so the sky lands in ACES's mid-range at the scene exposure
  // (1.18) rather than clipping to white. Golden-hour read: modest haze, a warm
  // low-sun Mie glow, a clear blue zenith.
  TURBIDITY: 3.4,
  RAYLEIGH: 1.5,
  MIE_COEFFICIENT: 0.008,
  MIE_DIRECTIONAL_G: 0.86,
  // Extra output scale on the sky shader, applied via the material so the sky can
  // be balanced against the foreground exposure without darkening the scene.
  EXPOSURE: 0.42,
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
  CAR_BODY: 0x202733, // dark carbon-fibre tub
  CAR_BODY_ACCENT: 0xe23232, // livery accent (hot red racing stripe)
  CAR_ACCENT_2: 0xf2c200, // secondary livery (amber/gold flashes)
  CAR_GLASS: 0x0a0f16,
  CAR_RIM: 0xc8cdd4, // machined alloy
  CAR_DISC: 0x2b2d31, // carbon brake disc
  CAR_HALO: 0x16181d, // matte titanium halo
  CAR_WING: 0x15171c, // carbon aero surfaces
  CAR_DRIVER: 0x101216, // helmet / cockpit shadow
  WHEEL: 0x121316, // slick tyre
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
  ACCENT: '#22c8ff', // TrackPrint cyan signal color
  ACCENT_WARM: '#ffcf5a', // shift / warning
  REDLINE: '#ff5f72',
  TEXT: '#f7fcff',
  TEXT_DIM: '#7f9bb5',
  PANEL_BG: 'rgba(4, 16, 31, 0.86)',
  PANEL_BORDER: 'rgba(55, 183, 255, 0.26)',
  DIAL_TRACK: 'rgba(55, 183, 255, 0.18)',
  DIAL_FILL: '#22c8ff',
  GOOD: '#45e59d',
  DELTA_POS: '#ff5f72', // slower than best (red)
  DELTA_NEG: '#45e59d', // faster than best (green)
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
  // Background hills ringing the circuit, sitting in the haze band.
  HILL_COUNT: 30,
  HILL_RADIUS: 620,
  HILL_MIN_R: 50,
  HILL_MAX_R: 120,
  HILL_COLOR: 0x4a6a52, // hazy blue-green distance
  // Conifer forest of the royal park: scattered across the whole footprint, kept off
  // the racing surface (see Scenery.buildForest). Dense enough to fill infield + ring.
  TREE_COUNT: 2400,
  TREE_INNER_R: 34, // (legacy) unused by the footprint scatter
  TREE_OUTER_R: 90, // margin of forest beyond the circuit bounding box
  TREE_CENTER_Z: 14, // (legacy)
  TREE_CORRIDOR_HALF: 10, // clearance kept off the ribbon edge (scaled metres)
  TREE_MIN_H: 4.5,
  TREE_MAX_H: 12,
  TRUNK_COLOR: 0x4a3826,
  // Reflector posts down both verges, marching along the track line.
  POST_COUNT: 26, // (legacy) used only by the fallback straight
  POST_X: 2.6, // lateral offset from centerline to the post (just outside the verge)
  POST_HEIGHT: 1.05,
  POST_SPACING: 14, // metres of arc length between post pairs
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
