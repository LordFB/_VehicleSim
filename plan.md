You need a **custom vehicle-dynamics simulator plus a conventional rigid-body/contact engine**. The vehicle system must dominate the architecture; ThreeJS should be only a presentation layer and asset-authoring source.

For reference, mature vehicle simulation systems separate tire models into rigid, semi-empirical, and finite-element classes, with semi-empirical models such as Pacejka, TMeasy, and Fiala commonly used for handling simulation. Chrono’s docs also note that those handling tire models are mainly intended for flat-road handling, while deformable/off-road cases need different tire/terrain treatment. That is the split you should design around. ([api.projectchrono.org][1])

## 1. Core architecture

Build the engine as four layers:

```txt
Game / ThreeJS layer
  |
  |  visual objects, inputs, camera, particles, audio
  v
Physics facade / JS API
  |
  |  createBody(), createVehicle(), attachObject3D(), querySurface()
  v
Custom simulation runtime, ideally Rust/C++ -> WASM
  |
  |  fixed-step solver, vehicles, contacts, tire model, terrain queries
  v
Physics asset database
     collision meshes, heightfields, road surfaces, tire data, car setup data
```

Do **not** make ThreeJS objects the physics source of truth. Make physics own all transforms. ThreeJS receives interpolated transforms after each physics snapshot. ThreeJS already exposes core scene objects like `Object3D`, `BufferGeometry`, matrices, vectors, and quaternions, so integration should be through a transform/geometry adapter rather than by embedding physics inside ThreeJS objects. ([threejs.org][2])

Recommended runtime split:

```txt
Main thread:
  ThreeJS render, input sampling, UI

Worker thread / WASM:
  deterministic physics simulation

SharedArrayBuffer ring buffer:
  input frames -> physics
  physics snapshots -> renderer
```

Target simulation rates:

```txt
Render:             variable, 60–144 Hz
Physics world:      fixed 120–240 Hz
Vehicle dynamics:   300–1000 Hz substeps
Tire contact:       same as vehicle dynamics
Network state:      20–60 Hz snapshots
```

For hardcore feel, the important part is not raw frame rate; it is **stable fixed-step tire, suspension, drivetrain, and chassis integration**.

---

## 2. Physics engine foundation

You need a custom general physics layer, but it does not have to be as ambitious as the vehicle system.

Required pieces:

```txt
Math:
  Vec3, Quat, Mat3, Mat4
  spatial transforms
  inertia tensors
  SIMD-friendly SoA storage

Rigid bodies:
  position, orientation
  linear/angular velocity
  mass, inverse mass
  inertia tensor
  center of mass
  sleep/wake state

Collision:
  broadphase: dynamic AABB tree / sweep-and-prune / grid-BVH hybrid
  narrowphase: sphere, capsule, box, convex hull, triangle mesh, heightfield
  contact manifold generation
  continuous collision detection for fast vehicles
  material pairs: friction, restitution, roughness, wetness

Constraint solver:
  contacts
  joints
  springs/dampers
  motors
  suspension constraints
  optional soft constraints
```

Solver choice:

```txt
MVP:
  semi-implicit Euler + sequential impulse / projected Gauss-Seidel

Better:
  temporal Gauss-Seidel-style solver for stable contacts

For vehicle core:
  do not rely only on generic contact friction.
  calculate tire forces explicitly, then inject them into chassis/wheel bodies.
```

Generic rigid-body friction is not enough for sim racing. Tire friction is nonlinear, load-sensitive, temperature-sensitive, camber-sensitive, and slip-history-sensitive. The vehicle should not be “a rigid body with four friction cylinders.”

---

## 3. Vehicle model

Each vehicle should be a specialized multibody system:

```txt
Vehicle
  Chassis rigid body
  4+ wheel assemblies
  Suspension links / kinematic model
  Tires
  Brakes
  Steering
  Engine
  Clutch
  Gearbox
  Differentials
  Aero package
  Electronics
```

Use the chassis as a true 6DOF rigid body with correct:

```txt
mass
center of gravity
inertia tensor
aero center
fuel mass
driver mass
damage state
```

Do not fake weight transfer. It should emerge from forces, torques, suspension geometry, and chassis inertia.

---

## 4. Tire system: the most important part

This is the heart of the project.

You need a custom tire model that supports:

```txt
longitudinal slip ratio
lateral slip angle
camber angle
normal load
load sensitivity
combined slip
relaxation length / transient response
aligning torque
pneumatic trail
rolling resistance
tire pressure
temperature
wear
flat spots
surface material
wetness
rubbering-in
```

Baseline tire model options:

### Option A — custom brush model

Best for a custom hardcore sim if you want physical meaning and tunability.

Pros:

```txt
more physically interpretable
good transient behavior
easier to extend for temperature/wear
less dependent on opaque coefficient fitting
```

Cons:

```txt
harder to match real tire data perfectly
requires careful numerical implementation
```

Brush models remain active in current real-time tire-model research; recent work describes real-time brush models with carcass flexibility as a way to preserve physical parameter meaning while staying computationally practical. ([ResearchGate][3])

### Option B — Pacejka-like semi-empirical model

Good if you have tire test data.

Pros:

```txt
excellent for fitting measured tire curves
widely understood in vehicle dynamics
good for paved racing
```

Cons:

```txt
coefficient-heavy
easy to tune into nonsense
poor extrapolation outside fitted data
less natural for off-road/deformable terrain
```

Chrono lists Pacejka 89, Pacejka 2002, TMeasy, and Fiala as semi-empirical handling tire models, and notes that handling models commonly use single-point or four-point contact for road handling simulation. ([api.projectchrono.org][1])

### Best route

Use a **hybrid custom tire model**:

```txt
Core:
  physically based brush / contact-patch model

Calibration layer:
  fit output curves to real or desired tire data

Runtime modifiers:
  temperature, pressure, wear, surface, wetness, load history

Fallback:
  simpler Fiala/Pacejka-like curve for low-priority AI cars
```

Tire data should be authored as surfaces, not magic constants:

```json
{
  "name": "semi_slick_245_35_r19",
  "radius": 0.335,
  "width": 0.245,
  "mass": 11.2,
  "verticalStiffnessCurve": [[0,0], [0.01,1800], [0.03,7200]],
  "longitudinalStiffness": 190000,
  "corneringStiffness": 130000,
  "camberStiffness": 9000,
  "relaxationLengthLongitudinal": 0.35,
  "relaxationLengthLateral": 0.55,
  "optimalTempC": 92,
  "coldMuScale": 0.82,
  "overheatMuScale": 0.75,
  "wearRate": 1.0
}
```

---

## 5. Contact patch and road query

Do not use only one downward ray per wheel as the final model. That is acceptable for a first prototype, not for a hardcore simulator.

Use a layered tire-ground contact query:

```txt
Level 0:
  single raycast for prototype

Level 1:
  swept sphere/capsule along suspension axis

Level 2:
  multi-sample contact patch, 5–25 probes per tire

Level 3:
  tire envelope model over rough surfaces

Level 4:
  deformable terrain model for gravel, mud, snow, sand
```

For paved roads, the tire model can use a contact plane plus high-frequency road roughness. For off-road, the terrain model must contribute sinkage, bulldozing resistance, loose-surface slip, and changing effective friction.

Surface query result should look like:

```ts
type SurfaceContact = {
  point: Vec3;
  normal: Vec3;
  depth: number;
  materialId: SurfaceMaterialId;
  muLongitudinal: number;
  muLateral: number;
  roughness: number;
  wetness: number;
  temperatureC: number;
  rubberLevel: number;
  gravelDepth: number;
};
```

Surface material database:

```txt
asphalt_new
asphalt_worn
concrete
painted_line
kerb
grass
gravel
dirt
mud
snow
ice
standing_water
metal_grate
```

Each needs friction curves, not just one friction coefficient.

---

## 6. Suspension model

You need suspension geometry, not just “spring force at wheel.”

Minimum:

```txt
spring rate
damper bump/rebound curves
bump stop
droop limit
anti-roll bar
motion ratio
ride height
camber curve
toe curve
caster
kingpin inclination
scrub radius
mechanical trail
unsprung mass
```

Better:

```txt
double wishbone geometry
MacPherson strut geometry
multi-link approximation
bushing compliance
steering rack compliance
damper hysteresis
third springs / heave springs
active suspension if needed
```

Suspension force loop:

```txt
wheel position -> suspension compression
compression velocity -> damper force
compression -> spring force
anti-roll delta -> ARB force
geometry -> camber/toe/contact frame
tire model -> tire forces
forces -> chassis and wheel torques
```

This is where “sim” feel comes from. Bad suspension geometry with a good tire model still feels wrong.

---

## 7. Drivetrain and powertrain

Required:

```txt
engine torque curve
throttle response
idle controller
rev limiter
clutch torque capacity
gearbox ratios
final drive
open diff
locked diff
viscous LSD
clutch-pack LSD
torque-vectoring diff
driveshaft inertia
wheel rotational inertia
brake torque
engine braking
turbo/supercharger lag if applicable
hybrid/EV motor model if needed
```

Powertrain should be solved as a 1D rotational system:

```txt
engine inertia
  -> clutch
  -> gearbox
  -> differential
  -> axles
  -> wheels
  -> tire longitudinal force
```

Avoid directly setting wheel angular velocity from engine RPM. Torque flows through inertias and constraints.

---

## 8. Aerodynamics

Open-world cars still need real aero, especially at high speed.

Implement:

```txt
drag
lift/downforce
center of pressure
front/rear aero balance
ride-height sensitivity
yaw sensitivity
draft/slipstream
dirty air
active aero
DRS-like systems if needed
```

Aero forces should apply at physical points, not merely as scalar speed penalties.

```txt
F_drag      = -0.5 * rho * CdA * v² * forward
F_downforce =  0.5 * rho * ClA * v² * down
```

Then distribute aero by aero center and ride height.

---

## 9. Open-world streaming physics

This is where Forza-style scale fights sim accuracy.

You need **physics LOD**, but the player car must always run at full fidelity.

```txt
LOD 0: player vehicle
  full tire, suspension, drivetrain, aero, damage

LOD 1: nearby opponent vehicles
  same rigid body, simplified tire thermal/wear

LOD 2: traffic / distant vehicles
  bicycle model or simplified 4-wheel model

LOD 3: far traffic
  spline/path following with collision proxy

LOD 4: inactive
  despawn/sleep/state extrapolation
```

World physics assets should stream independently from render assets:

```txt
Render tile:
  high-poly meshes, textures, decals, vegetation

Physics tile:
  road collision mesh
  heightfield
  material map
  surface metadata
  barriers
  dynamic props
  checkpoints / splines
```

Use local-origin shifting. At open-world scale, floating-point precision will become visible in both rendering and physics. Keep physics near the origin using a floating origin or cell-local coordinate system.

---

## 10. ThreeJS integration

Treat ThreeJS as a **view**.

### Physics owns transforms

```ts
const body = physics.createRigidBody({
  mass: 1450,
  shape: compoundShape,
  transform: initialTransform
});

physics.bindObject3D(body, carMesh);
```

Each render frame:

```ts
const alpha = physics.getInterpolationAlpha();

for (const binding of physicsBindings) {
  const pose = physics.getInterpolatedPose(binding.body, alpha);

  binding.object.position.set(pose.p.x, pose.p.y, pose.p.z);
  binding.object.quaternion.set(pose.q.x, pose.q.y, pose.q.z, pose.q.w);
}
```

For wheels:

```ts
wheelMesh.position = wheelWorldPose.position
wheelMesh.quaternion = chassisRotation * steerRotation * spinRotation * camberRotation
```

### ThreeJS objects as input assets

Use ThreeJS meshes only to generate or reference physics assets:

```txt
Mesh -> convex hull
Mesh -> triangle static mesh
Mesh -> heightfield
Mesh -> compound primitives
Mesh -> road surface material map
```

Never simulate directly against arbitrary render meshes at runtime unless they are preprocessed into a physics acceleration structure.

### Required adapter API

```ts
physics.createShapeFromThreeGeometry(geometry, {
  type: "convex" | "trimesh" | "heightfield",
  simplify: true,
  maxVertices: 256,
  materialMap: roadMaterialTexture
});

physics.attachObject3D(object3D, bodyHandle, {
  mode: "readPhysicsWriteRender"
});

physics.extractStaticWorld(scene, {
  includeLayer: "physics",
  bakeTransforms: true,
  buildBVH: true
});
```

---

## 11. Collision for vehicles

Separate collision into two categories:

### Tire-road contact

Handled by the tire/contact-patch system.

### Body/world impact

Handled by rigid-body collision.

Vehicle body collision needs:

```txt
compound convex hulls
undertray collider
bumper colliders
wheel colliders for impacts, separate from tire force model
barrier collision
soft props
deformable crash approximation
```

Use convex decomposition for cars. Do not use the high-poly render mesh as the collision body.

---

## 12. Damage model

For a hardcore open-world sim, damage should affect physics.

Minimum:

```txt
body deformation cosmetic only
wheel alignment damage
suspension damage
tire puncture
aero damage
engine damage
gearbox damage
brake fade/damage
radiator/cooling damage
```

Better:

```txt
local impulse accumulation
bent suspension links
changed toe/camber
damper leakage
rim deformation
tire bead failure
aero part detachment
fluid leaks
```

Damage output should modify actual simulation parameters:

```txt
front_left.toe += impactToeOffset
front_left.camber += bentKnuckleOffset
front_left.tire.pressure -= leakRate * dt
aero.frontClA *= damagedSplitterScale
```

---

## 13. Input, controls, assists

Input must support both gamepad and wheel hardware.

Required:

```txt
raw steering wheel angle
force feedback output
pedal curves
clutch axis
H-pattern shifter
sequential shifter
handbrake
ABS
traction control
stability control
launch control
steering assist for gamepads
countersteer assist optional, not forced
```

Force feedback needs its own model:

```txt
aligning torque from tire model
caster trail effects
scrub radius effects
road texture
kerb strikes
suspension impacts
damping/friction/inertia filters
```

Do not generate FFB from visual shake. Generate it from steering rack physics.

---

## 14. Networking and replay

For open-world multiplayer, full deterministic lockstep is probably unrealistic in browser/WASM across machines. Use server-authoritative or host-authoritative snapshots.

You still want deterministic-ish physics for:

```txt
replays
ghosts
rollback windows
debugging
anti-cheat
AI training
```

Replay format:

```txt
initial world seed
vehicle setup hash
physics version hash
input stream
surface state deltas
random seeds
```

Snapshot format:

```txt
position
orientation
linear velocity
angular velocity
wheel angular velocities
suspension compression
tire temps/wear
gear/RPM/throttle/brake
damage state
```

---

## 15. Tooling you absolutely need

The tech is impossible to tune by hand without specialized tools.

Build these early:

```txt
Vehicle setup editor
Tire curve visualizer
Suspension geometry visualizer
Telemetry viewer
Contact patch debugger
Surface material painter
Physics profiler
Replay scrubber
Determinism checker
Scenario test runner
```

Telemetry channels:

```txt
speed
yaw rate
sideslip
steering angle
wheel load
slip ratio
slip angle
tire Fx/Fy/Fz/Mz
camber
toe
suspension travel
damper velocity
brake temperature
tire carcass/surface temperature
engine RPM
gear
diff lock
aero balance
```

You need MoTeC-style data export. Without telemetry, you are tuning blind.

---

## 16. Validation tests

Build tests before content production.

Vehicle dynamics tests:

```txt
constant-radius skidpad
straight-line braking
acceleration run
step steer
sine sweep
slalom
kerb strike
jump landing
split-mu braking
aquaplane/wet patch
hill climb
rough-road ride
```

Numerical tests:

```txt
energy stability
contact jitter
solver convergence
timestep invariance
replay determinism
floating-origin precision
network correction stability
```

Performance tests:

```txt
1 player full-fidelity vehicle
16 nearby full/simplified vehicles
100 traffic vehicles
large streamed road tile
dense prop collision
high-speed tunnel/barrier contact
```

---

## 17. Suggested implementation stack

Given ThreeJS target:

```txt
Language:
  Rust or C++ for physics core
  TypeScript for game/render integration

Runtime:
  WASM module in Web Worker
  SharedArrayBuffer for state transfer
  SIMD-enabled WASM where available

Data:
  JSON/TOML for vehicle setup
  binary blobs for collision BVHs
  compressed heightfields/material maps

Renderer:
  ThreeJS reads interpolated transforms only

Editor:
  browser-based tools using same physics module
```

Rust gives better safety and WASM ergonomics. C++ gives more existing numerical/physics precedent. Either is fine. Do not write the whole solver in TypeScript if the goal is iRacing/Assetto-level behavior.

---

## 18. Minimal vertical slice

Build in this order:

```txt
1. Fixed-step WASM physics loop
2. Chassis rigid body
3. Four-wheel suspension with simple spring/damper
4. Single-ray tire contact
5. Basic brush/Fiala tire model
6. Engine -> gearbox -> diff -> wheels
7. ThreeJS transform bridge
8. Telemetry viewer
9. Contact patch upgrade
10. Tire temperature/wear
11. Road material system
12. AI/traffic LOD
13. Multiplayer/replay
14. Damage
15. Open-world streaming
```

The first milestone should be one car on one test track, not an open world.

---

## 19. What not to do

Avoid these traps:

```txt
Do not use render meshes as physics meshes directly.
Do not use one global friction coefficient.
Do not rely on raycast-wheel arcade vehicle code long-term.
Do not tie physics timestep to render FPS.
Do not tune by “feel” without telemetry.
Do not fake weight transfer with arbitrary grip multipliers.
Do not make assists mandatory.
Do not build the open world before the tire model feels right.
Do not make traffic cars full-fidelity unless they are near the player.
```

---

## The core technology list

The custom tech you need is:

```txt
Custom fixed-step physics runtime
Custom rigid-body/contact solver
Custom terrain/contact query system
Custom high-fidelity tire model
Custom suspension kinematics system
Custom drivetrain solver
Custom aero model
Custom surface/material model
Custom vehicle damage model
Custom physics LOD system
Custom replay/determinism layer
Custom ThreeJS physics bridge
Custom telemetry/tuning tools
Custom physics asset pipeline
```

The project succeeds or fails on **tires, suspension, telemetry, and timestep discipline**. Rendering is secondary. ThreeJS integration is straightforward if physics owns state and ThreeJS only consumes clean transforms.

[1]: https://api.projectchrono.org/6.0.0/wheeled_tire.html "Project Chrono: Tire models"
[2]: https://threejs.org/docs/ "three.js docs"
[3]: https://www.researchgate.net/publication/380017189_A_physical_tire_model_for_real-time_simulations?utm_source=chatgpt.com "A physical tire model for real-time simulations"
