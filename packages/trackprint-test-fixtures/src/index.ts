import type { TrackDocument } from '@trackprint/track-core';

export function createDefaultTrackDocument(): TrackDocument {
  const r = 90;
  const c = r * 0.5522847498;

  return {
    id: 'default-oval',
    version: 1,
    units: 'meters',
    closed: true,
    width: {
      left: { constant: 7 },
      right: { constant: 6 },
    },
    sectors: [
      { id: 'sector-1', name: 'Sector 1', startStation: 0, endStation: 188 },
      { id: 'sector-2', name: 'Sector 2', startStation: 188, endStation: 376 },
      { id: 'sector-3', name: 'Sector 3', startStation: 376, endStation: 565 },
    ],
    segments: [
      {
        id: 'curve-east',
        kind: 'cubicBezier',
        p0: { id: 'p-east', position: { x: r, y: 0 } },
        p1: { id: 'h-east-north', position: { x: r, y: c } },
        p2: { id: 'h-north-east', position: { x: c, y: r } },
        p3: { id: 'p-north', position: { x: 0, y: r } },
      },
      {
        id: 'curve-north',
        kind: 'cubicBezier',
        p0: { id: 'p-north', position: { x: 0, y: r } },
        p1: { id: 'h-north-west', position: { x: -c, y: r } },
        p2: { id: 'h-west-north', position: { x: -r, y: c } },
        p3: { id: 'p-west', position: { x: -r, y: 0 } },
      },
      {
        id: 'curve-west',
        kind: 'cubicBezier',
        p0: { id: 'p-west', position: { x: -r, y: 0 } },
        p1: { id: 'h-west-south', position: { x: -r, y: -c } },
        p2: { id: 'h-south-west', position: { x: -c, y: -r } },
        p3: { id: 'p-south', position: { x: 0, y: -r } },
      },
      {
        id: 'curve-south',
        kind: 'cubicBezier',
        p0: { id: 'p-south', position: { x: 0, y: -r } },
        p1: { id: 'h-south-east', position: { x: c, y: -r } },
        p2: { id: 'h-east-south', position: { x: r, y: -c } },
        p3: { id: 'p-east', position: { x: r, y: 0 } },
      },
    ],
  };
}

export function createStraightTrackDocument(): TrackDocument {
  return {
    id: 'straight-fixture',
    version: 1,
    units: 'meters',
    closed: false,
    width: {
      left: { constant: 5 },
      right: { constant: 5 },
    },
    segments: [
      {
        id: 'straight',
        kind: 'cubicBezier',
        p0: { id: 'straight-p0', position: { x: 0, y: 0 } },
        p1: { id: 'straight-p1', position: { x: 16.6667, y: 0 } },
        p2: { id: 'straight-p2', position: { x: 33.3333, y: 0 } },
        p3: { id: 'straight-p3', position: { x: 50, y: 0 } },
      },
    ],
  };
}
