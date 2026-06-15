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
  readonly limits?: TrackLimits;
  readonly segments: TrackSegmentDocument[];
}

export interface TrackValidationIssue {
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly segmentId?: string;
}
