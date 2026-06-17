import type { Vector2 } from './vector';

export type TrackUnits = 'meters';

export interface WidthKey {
  readonly station: number;
  readonly value: number;
}

export interface TrackWidthSide {
  readonly constant: number;
  readonly keys?: WidthKey[];
}

export interface TrackWidth {
  readonly left: TrackWidthSide;
  readonly right: TrackWidthSide;
}

export interface TrackSector {
  readonly id: string;
  readonly name: string;
  readonly startStation: number;
  readonly endStation: number;
}

export type TrackSide = 'left' | 'right';

export type CurbProfileType = 'flat' | 'raised' | 'sawtooth' | 'custom';

export interface CurbInterval {
  readonly id: string;
  readonly side: TrackSide;
  readonly startStation: number;
  readonly endStation: number;
  readonly width: number;
  readonly height: number;
  readonly taperLength?: number;
  readonly profile: CurbProfileType;
  readonly materialId: string;
}

export interface RunoffInterval {
  readonly id: string;
  readonly side: TrackSide;
  readonly startStation: number;
  readonly endStation: number;
  readonly width: number;
  readonly taperLength?: number;
  readonly materialId: string;
}

export interface TunnelInterval {
  readonly id: string;
  // A skewed/angled portal mouth: the left and right walls may begin and end
  // at different stations, so each side carries its own start/end pair.
  readonly leftStartStation: number;
  readonly leftEndStation: number;
  readonly rightStartStation: number;
  readonly rightEndStation: number;
  readonly height: number; // clearance above the deck (Y, meters)
  readonly width: number; // bore inner width (total lateral span, meters)
  readonly materialId: string;
}

export type StructureKind = 'tunnel' | 'bridge';

// Tunnels and bridges both resolve into this single shape so terrain
// suppression and masking treat them identically — only the added geometry
// differs. `startStation`/`endStation` are the union (min/max) of the per-side
// ranges, used as the terrain-suppression coverage window.
export interface StructureSpan {
  readonly id: string;
  readonly kind: StructureKind;
  readonly startStation: number;
  readonly endStation: number;
  readonly left: { readonly start: number; readonly end: number };
  readonly right: { readonly start: number; readonly end: number };
}

export interface TrackLimits {
  readonly curbIsValid: boolean;
  readonly runoffIsValid: boolean;
}

export type WallStyle = 'armco' | 'solid' | 'tirewall';

// How a drawn wall treats the joints between its points.
//   'cornered' — sharp mitred joints; the wall kinks at each vertex.
//   'smooth'   — each interior corner is rounded with a fillet arc of
//                `cornerRadius` meters, so the run curves through turns.
export type WallCornerMode = 'cornered' | 'smooth';

// A free-drawn wall: a polyline of points the author clicks anywhere in the
// viewport (not tied to the track edge). It compiles to a run of short oriented
// barrier boxes laid along the polyline — optionally rounding interior corners
// with a fillet — so a single wall can block a chicane, line a pit lane, or
// edge an escape road.
export interface WallInterval {
  readonly id: string;
  // The drawn path, in world (x, z) coordinates. Two or more points form a wall.
  readonly points: readonly Vector2[];
  readonly cornerMode: WallCornerMode;
  // Fillet radius for 'smooth' corners, in meters. Ignored when 'cornered'.
  readonly cornerRadius: number;
  readonly height: number;
  // Length of each emitted barrier segment (meters). Smaller = smoother wall,
  // more barriers. ~1.6 matches the runtime Armco visual stride.
  readonly segmentLength: number;
  readonly style: WallStyle;
  readonly materialId: string;
}

// A single free-standing oriented barrier (bollard, block, shortcut blocker)
// placed by clicking, with its own rotation. Not tied to a station range.
export interface PointBarrier {
  readonly id: string;
  readonly position: Vector2;
  readonly yawRad: number;
  // Half-extents [x, y, z] in meters (x = thickness, y = half-height, z = half-length).
  readonly halfExtents: readonly [number, number, number];
  readonly style: WallStyle;
}

// Author-placed start/finish line. Stored as an offset along the centerline so
// it tracks spline edits. When absent, the exporter falls back to the legacy
// auto-placement (6 m ahead of centerline sample 0).
export interface StartFinishMarker {
  readonly id: string;
  readonly station: number;
  readonly lateralOffset?: number;
  readonly headingOffsetRad?: number;
}

// Start-grid layout, resolved to slot positions relative to the start/finish
// station. Visual + single pole spawn in v1 (the sim has one spawn point).
export interface GridLayout {
  readonly station: number;
  readonly rows: number;
  readonly columnGap: number;
  readonly rowGap: number;
}

export type AuxPathRole = 'pit' | 'runoff' | 'service';

// A side-road: an independent secondary track with its OWN document (spline,
// width, curbs, runoffs, walls). It compiles through the same compileTrackSurface
// as the main track via its own station lookup — no change to the single-spline
// stationing core. `entryStation`/`exitStation` pin it to the main track for
// placement. The lap is NOT auto-routed through it (see plan: that needs a
// stationing rewrite); it is real driveable, collidable surface only.
export interface AuxPath {
  readonly id: string;
  readonly role: AuxPathRole;
  readonly entryStation: number;
  readonly exitStation: number;
  readonly document: TrackDocument;
}

export interface StationValueKey {
  readonly station: number;
  readonly value: number;
}

export interface StationValueCurve {
  readonly keys: StationValueKey[];
}

export interface ControlPoint {
  readonly id: string;
  readonly position: Vector2;
  readonly elevation?: number;
}

export interface SegmentSample {
  readonly t: number;
  readonly position: Vector2;
}

export interface Segment {
  readonly id: string;
  readonly kind: string;
  evaluate(t: number): Vector2;
  tangent(t: number): Vector2;
  length(samples?: number): number;
  sample(count: number): SegmentSample[];
}

export interface CubicBezierSegmentDocument {
  readonly id: string;
  readonly kind: 'cubicBezier';
  readonly p0: ControlPoint;
  readonly p1: ControlPoint;
  readonly p2: ControlPoint;
  readonly p3: ControlPoint;
  // When true, this segment is carried as a bridge: a deck underside + pillars
  // render automatically and the terrain skirt is suppressed over its span.
  readonly bridge?: boolean;
}

export type TrackSegmentDocument = CubicBezierSegmentDocument;

export interface TrackDocument {
  readonly id: string;
  readonly version: 1;
  readonly units: TrackUnits;
  readonly closed: boolean;
  readonly width?: TrackWidth;
  readonly sectors?: TrackSector[];
  readonly elevation?: StationValueCurve;
  readonly banking?: StationValueCurve;
  readonly curbs?: CurbInterval[];
  readonly runoffs?: RunoffInterval[];
  readonly tunnels?: TunnelInterval[];
  readonly walls?: WallInterval[];
  readonly pointBarriers?: PointBarrier[];
  readonly startFinish?: StartFinishMarker;
  readonly grid?: GridLayout;
  readonly auxPaths?: AuxPath[];
  readonly limits?: TrackLimits;
  readonly segments: TrackSegmentDocument[];
}

export interface TrackValidationIssue {
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly segmentId?: string;
}
