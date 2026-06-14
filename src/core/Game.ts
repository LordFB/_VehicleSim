import * as THREE from 'three';
import { CAMERA, LIGHTING, RENDER, SIM, SKY } from './Constants';
import { eventBus, Events } from './EventBus';
import { gameState } from './GameState';
import { InputSystem } from '../systems/InputSystem';
import { WorkerPhysicsFacade } from '../systems/PhysicsSystem';
import { LevelBuilder } from '../level/LevelBuilder';
import { VehicleView } from '../render/VehicleView';
import { VehicleDebugView } from '../render/VehicleDebugView';
import { SkyDome } from '../render/SkyDome';
import { Scenery } from '../render/Scenery';
import { SkidMarks } from '../render/SkidMarks';
import { TireSmoke } from '../render/TireSmoke';
import { TelemetryOverlay } from '../ui/TelemetryOverlay';
import { Hud } from '../ui/Hud';
import { LapTimer } from '../game/LapTimer';
import { EngineAudio } from '../audio/EngineAudio';
import { buildMonzaWorld, monzaCheckpoints, monzaTrackPath } from '../level/MonzaWorld';
import { centerlineBounds } from '../level/MonzaTrack';
import defaultVehicleJson from '../sim/data/defaultVehicle.json';
import type { VehicleSpec, WorldSpec } from '../sim/types';

export class Game {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly input: InputSystem;
  private readonly physics = new WorkerPhysicsFacade();
  private readonly level: LevelBuilder;
  private readonly telemetry: TelemetryOverlay;
  private readonly hud: Hud;
  private readonly lapTimer: LapTimer;
  private readonly world: WorldSpec;
  private readonly audio = new EngineAudio();
  private readonly skyDome = new SkyDome();
  private readonly scenery: Scenery;
  private skidMarks: SkidMarks | null = null;
  private tireSmoke: TireSmoke | null = null;
  private readonly cameraPosition = new THREE.Vector3();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly desiredCameraPosition = new THREE.Vector3();
  private readonly desiredCameraTarget = new THREE.Vector3();
  private currentFov = CAMERA.FOV;
  private vehicleView: VehicleView | null = null;
  private vehicleDebugView: VehicleDebugView | null = null;
  private seed = SIM.INITIAL_SEED;
  private status: HTMLDivElement;
  private hasMoved = false;
  private paused = false; // debug-only render freeze (see captureTopDown)
  private statusTimeout = 0;
  private readonly unsubs: Array<() => void> = [];
  private lastFrameMs = performance.now();

  constructor(container: HTMLElement) {
    this.container = container;

    // Build the Autodromo Nazionale Monza layout once: the WorldSpec (physics surface
    // zones + barriers), the start/finish line and the circuit centerline that drives
    // the visual ribbon, the lap-timer checkpoints and the HUD mini-map silhouette.
    const monza = buildMonzaWorld();
    this.world = monza.world;
    this.lapTimer = new LapTimer(
      monzaCheckpoints(monza.centerline),
      monza.startFinish,
      monzaTrackPath(monza.centerline),
    );

    this.renderer = this.createRenderer();
    this.camera = this.createCamera();
    this.input = new InputSystem(container);
    this.telemetry = new TelemetryOverlay(container);
    this.hud = new Hud(container, defaultVehicleJson as VehicleSpec, this.lapTimer.trackPath());
    this.level = new LevelBuilder(this.scene, this.world, monza.startFinish, monza.centerline);
    this.scenery = new Scenery(centerlineBounds(monza.centerline), monzaTrackPath(monza.centerline));
    this.status = this.createStatus();
    this.init();
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.input.dispose();
    this.physics.dispose();
    this.level.dispose();
    this.telemetry.dispose();
    this.hud.dispose();
    this.audio.dispose();
    this.skyDome.dispose();
    this.scenery.dispose();
    this.skidMarks?.dispose();
    this.tireSmoke?.dispose();
    this.vehicleView?.dispose();
    this.vehicleDebugView?.dispose();
    for (const unsub of this.unsubs) unsub();
    this.renderer.dispose();
  }

  /**
   * Debug-only: render one frame from a top-down orthographic-ish camera framing the
   * whole circuit, so an automated check can photograph the layout. Not used in play.
   */
  captureTopDown(): void {
    this.paused = true;
    const b = centerlineBounds(buildMonzaWorld().centerline);
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    const cam = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 4000);
    cam.position.set(cx, span * 1.25, cz + 0.01);
    cam.up.set(0, 0, 1);
    cam.lookAt(cx, 0, cz);
    const prevFog = this.scene.fog;
    this.scene.fog = null;
    this.renderer.render(this.scene, cam);
    this.scene.fog = prevFog;
  }

  private init(): void {
    this.setupScene();
    this.level.build();
    this.setupEvents();
    void this.bootstrapPhysics();
    this.renderer.setAnimationLoop(() => this.animate());
  }

  private createRenderer(): THREE.WebGLRenderer {
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: new URLSearchParams(window.location.search).has('e2e'),
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.PIXEL_RATIO_CAP));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = LIGHTING.EXPOSURE;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.container.appendChild(renderer.domElement);
    window.addEventListener('resize', () => this.onResize());
    return renderer;
  }

  private createCamera(): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera(CAMERA.FOV, window.innerWidth / window.innerHeight, CAMERA.NEAR, CAMERA.FAR);
    camera.position.set(CAMERA.FOLLOW_OFFSET.x, CAMERA.FOLLOW_OFFSET.y, CAMERA.FOLLOW_OFFSET.z);
    camera.lookAt(0, 0.8, 0);
    return camera;
  }

  private setupScene(): void {
    // Tall gradient sky + PMREM environment built from the same gradient so paint reflects it.
    this.scene.environment = this.skyDome.buildEnvironment(this.renderer);
    this.scene.add(this.skyDome.mesh);
    this.scene.add(this.scenery.group);
    this.scene.fog = new THREE.Fog(SKY.FOG_COLOR, SKY.FOG_NEAR, SKY.FOG_FAR);

    // Cool sky / warm ground ambient fill.
    const hemi = new THREE.HemisphereLight(LIGHTING.HEMI_SKY, LIGHTING.HEMI_GROUND, LIGHTING.HEMI_INTENSITY);
    this.scene.add(hemi);
    const fill = new THREE.DirectionalLight(LIGHTING.FILL_COLOR, LIGHTING.FILL_INTENSITY);
    fill.position.set(30, 18, 40);
    this.scene.add(fill);

    // Low, warm golden-hour key light casting long soft shadows.
    const sun = new THREE.DirectionalLight(LIGHTING.SUN_COLOR, LIGHTING.SUN_INTENSITY);
    sun.position.set(LIGHTING.SUN_POSITION.x, LIGHTING.SUN_POSITION.y, LIGHTING.SUN_POSITION.z);
    sun.target.position.set(LIGHTING.SUN_TARGET.x, LIGHTING.SUN_TARGET.y, LIGHTING.SUN_TARGET.z);
    sun.castShadow = true;
    sun.shadow.mapSize.set(LIGHTING.SHADOW_MAP_SIZE, LIGHTING.SHADOW_MAP_SIZE);
    const b = LIGHTING.SHADOW_BOUNDS;
    sun.shadow.camera.left = -b;
    sun.shadow.camera.right = b;
    sun.shadow.camera.top = b;
    sun.shadow.camera.bottom = -b;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 260;
    sun.shadow.bias = LIGHTING.SHADOW_BIAS;
    sun.shadow.normalBias = 0.02;
    // Soft penumbra via PCF radius (VSM hangs the WebGL readback in headless e2e).
    sun.shadow.radius = LIGHTING.SHADOW_RADIUS;
    this.scene.add(sun);
    this.scene.add(sun.target);
  }

  private setupEvents(): void {
    this.unsubs.push(
      eventBus.on(Events.SIM_RESET_REQUESTED, () => this.reset()),
      eventBus.on(Events.TELEMETRY_TOGGLE_REQUESTED, () => this.telemetry.toggle()),
      eventBus.on(Events.AUDIO_TOGGLE_REQUESTED, () => this.audio.toggleMuted()),
      eventBus.on(Events.GAMEPAD_CONNECTED, () => this.flashStatus('Controller connected · LS steer · RT/LT throttle/brake · RB/LB shift · A handbrake · View toggles auto')),
      eventBus.on<{ autoShift: boolean }>(Events.SHIFT_MODE_CHANGED, ({ autoShift }) => this.flashStatus(`Transmission: ${autoShift ? 'AUTOMATIC' : 'MANUAL'}`)),
      eventBus.on<{ message: string }>(Events.PHYSICS_ERROR, ({ message }) => {
        this.status.textContent = `Physics error: ${message}`;
        this.status.classList.add('status--error');
      }),
    );
  }

  private flashStatus(message: string): void {
    this.status.textContent = message;
    this.status.classList.remove('status--hidden');
    window.clearTimeout(this.statusTimeout);
    this.statusTimeout = window.setTimeout(() => {
      if (this.hasMoved) this.status.classList.add('status--hidden');
    }, 2600);
  }

  private async bootstrapPhysics(): Promise<void> {
    this.status.textContent = 'Starting worker physics...';
    await this.physics.init(this.world);
    await this.physics.createVehicle(defaultVehicleJson as VehicleSpec);
    this.vehicleView = new VehicleView(defaultVehicleJson as VehicleSpec, this.scene.environment);
    this.vehicleDebugView = new VehicleDebugView();
    this.skidMarks = new SkidMarks();
    this.tireSmoke = new TireSmoke();
    this.scene.add(this.vehicleView.group);
    this.scene.add(this.vehicleDebugView.group);
    this.scene.add(this.skidMarks.mesh);
    this.scene.add(this.tireSmoke.points);
    gameState.started = true;
    const pad = this.input.hasGamepad();
    this.status.textContent = pad
      ? 'Controller: LS steer · RT/LT throttle/brake · RB/LB shift · A handbrake · View=auto/manual'
      : 'A/D steer · W/S throttle/brake · E/Q shift · G auto/manual · Space handbrake · R reset · T telemetry · M mute · (plug in a controller for the real feel)';
  }

  private animate(): void {
    if (this.paused) return; // debug-only freeze for stable overview capture
    const now = performance.now();
    const delta = Math.min((now - this.lastFrameMs) / 1000, SIM.RENDER_DELTA_CAP);
    this.lastFrameMs = now;
    const input = this.input.update(now);
    this.physics.submitInput(input);
    this.physics.step(now);
    const snapshot = this.physics.getSnapshot();
    if (snapshot && this.vehicleView) {
      gameState.latestSnapshot = snapshot;
      this.vehicleView.applySnapshot(snapshot);
      this.vehicleDebugView?.applySnapshot(snapshot);
      this.telemetry.update(snapshot.telemetry);
      this.skidMarks?.update(snapshot);
      this.tireSmoke?.update(snapshot, delta);
      this.audio.update(snapshot.telemetry, delta);
      const lap = this.lapTimer.update(snapshot, now);
      this.hud.update(snapshot, lap, this.input.isAutoShift());
      this.updateCamera(snapshot, delta);
      this.updateStartPrompt(snapshot);
    }
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(snapshot: NonNullable<typeof gameState.latestSnapshot>, delta: number): void {
    const position = snapshot.chassis.position;
    const orientation = new THREE.Quaternion(...snapshot.chassis.orientation);
    const localOffset = new THREE.Vector3(CAMERA.FOLLOW_OFFSET.x, CAMERA.FOLLOW_OFFSET.y, CAMERA.FOLLOW_OFFSET.z).applyQuaternion(orientation);
    const localTarget = new THREE.Vector3(CAMERA.LOOK_AHEAD.x, CAMERA.LOOK_AHEAD.y, CAMERA.LOOK_AHEAD.z).applyQuaternion(orientation);
    this.desiredCameraPosition.set(position[0], position[1], position[2]).add(localOffset);
    this.desiredCameraTarget.set(position[0], position[1], position[2]).add(localTarget);
    const lerpAlpha = 1 - Math.pow(1 - CAMERA.LERP, delta * 60);
    this.cameraPosition.lerp(this.desiredCameraPosition, lerpAlpha);
    this.cameraTarget.lerp(this.desiredCameraTarget, lerpAlpha);

    // Speed-scaled FOV kick + slip/impact micro-shake (juice).
    const speed = Math.hypot(snapshot.linearVelocity[0], snapshot.linearVelocity[2]);
    const speedT = Math.min(1, speed / CAMERA.FOV_SPEED_REF_MPS);
    const targetFov = CAMERA.FOV + CAMERA.FOV_SPEED_GAIN * speedT;
    this.currentFov += (targetFov - this.currentFov) * (1 - Math.pow(1 - CAMERA.FOV_LERP, delta * 60));
    if (Math.abs(this.camera.fov - this.currentFov) > 0.01) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }

    let peakSlip = 0;
    for (const id of ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'] as const) {
      const w = snapshot.telemetry.wheels[id];
      peakSlip = Math.max(peakSlip, Math.abs(w.slipRatio), Math.abs(w.slipAngleRad));
    }
    const shake = peakSlip > CAMERA.SHAKE_SLIP_THRESHOLD
      ? Math.min(CAMERA.SHAKE_MAX, (peakSlip - CAMERA.SHAKE_SLIP_THRESHOLD) * 0.18)
      : 0;

    this.camera.position.copy(this.cameraPosition);
    if (shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * shake;
      this.camera.position.y += (Math.random() - 0.5) * shake;
    }
    this.camera.lookAt(this.cameraTarget);
  }

  private updateStartPrompt(snapshot: NonNullable<typeof gameState.latestSnapshot>): void {
    if (this.hasMoved) return;
    const speed = Math.hypot(snapshot.linearVelocity[0], snapshot.linearVelocity[2]);
    if (speed > 1.2) {
      this.hasMoved = true;
      this.status.classList.add('status--hidden');
    }
  }

  private reset(): void {
    this.seed += 1;
    gameState.reset();
    this.physics.reset(this.seed);
    this.lapTimer.reset();
    this.skidMarks?.clear();
    this.hasMoved = false;
    this.status.classList.remove('status--hidden');
  }

  private createStatus(): HTMLDivElement {
    const element = document.createElement('div');
    element.className = 'status overlay';
    element.textContent = 'Loading...';
    this.container.appendChild(element);
    return element;
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
