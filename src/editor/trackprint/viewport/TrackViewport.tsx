import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import {
  dot,
  evaluateStation,
  nearestStation,
  subtract,
  type ControlPoint,
  type StationLookup,
  type TrackDocument,
  type Vector2,
} from '@trackprint/track-core';
import {
  sampleTrackSurface,
  type AsphaltMeshData,
  type CompileResult,
  type SurfaceBandMeshData,
  type TrackCrossSection,
} from '@trackprint/track-compiler';
import {
  cellToWorld,
  sampleTerrainHeight,
  sampleTerrainHeightBilinear,
  worldToCell,
  type SkirtMeshData,
  type TerrainBrushSettings,
  type TerrainDocument,
  type TerrainMeshData,
  type TerrainPoint,
} from '@trackprint/terrain-core';
import { createCameraInteractionLocks } from './cameraInteraction';

const DEBUGENABLED = false;

export type EditorTool =
  | 'Select'
  | 'Spline'
  | 'Width'
  | 'Elevation'
  | 'Banking'
  | 'Curbs'
  | 'Sectors'
  | 'Terrain'
  | 'Paint'
  | 'References'
  | 'Drive';

interface TrackViewportProps {
  readonly activeTool: EditorTool;
  readonly authoringPoints: readonly ControlPoint[];
  readonly cameraMode: 'Orbit' | 'Top' | 'Chase';
  readonly display: TrackDisplayOptions;
  readonly document: TrackDocument;
  readonly isPlaying: boolean;
  readonly lookup: StationLookup;
  readonly selectedPoint: string | null;
  readonly selectedStation: number | null;
  readonly speed: number;
  readonly station: number;
  readonly surface: CompileResult;
  readonly terrain: TerrainDocument;
  readonly terrainBrush: TerrainBrushSettings & { readonly active: boolean };
  readonly terrainCursor: TerrainPoint | null;
  readonly terrainMesh: TerrainMeshData;
  readonly skirtMesh: SkirtMeshData;
  /** Bridge pillars (deck underside -> terrain) and tunnel portal fill. */
  readonly bridgePillars: TerrainMeshData | null;
  readonly portalFill: TerrainMeshData | null;
  /** Stitched satellite aerial draped over imported geo terrain, if any. */
  readonly imageryCanvas: HTMLCanvasElement | null;
  readonly selectedBand: BandRef | null;
  readonly onAddControlPoint: (position: Vector2) => void;
  readonly onHoverStationChange: (station: number | null) => void;
  readonly onMoveControlPoint: (pointId: string, position: Vector2, elevation?: number) => void;
  readonly onPreviewMoveControlPoint: (pointId: string, position: Vector2, elevation?: number) => void;
  readonly onSelectPoint: (pointId: string | null) => void;
  readonly onSelectBand: (band: BandRef | null) => void;
  readonly onBeginBandEndpointDrag: () => void;
  readonly onMoveBandEndpoint: (
    kind: 'curb' | 'runoff',
    id: string,
    endpoint: 'startStation' | 'endStation',
    station: number,
  ) => void;
  readonly onStationInspectionChange: (inspection: StationInspection | null) => void;
  readonly onStationChange: (station: number) => void;
  readonly onTerrainBrush: (point: TerrainPoint) => void;
  readonly onTerrainHover: (point: TerrainPoint | null) => void;
}

export interface StationInspection {
  readonly station: number;
  readonly lateralOffset: number;
}

export interface BandRef {
  readonly kind: 'curb' | 'runoff';
  readonly id: string;
}

export interface TrackDisplayOptions {
  readonly asphalt: boolean;
  readonly centerline: boolean;
  readonly edges: boolean;
  readonly wireframe: boolean;
  readonly terrain: boolean;
  readonly terrainWireframe: boolean;
  readonly terrainImagery: boolean;
  readonly corridorMask: boolean;
  readonly skirtMask: boolean;
  readonly seams: boolean;
  readonly structures: boolean;
}

interface ControlPointMesh extends THREE.Mesh {
  userData: {
    pointId: string;
  };
}

interface BandHandleRef {
  readonly kind: 'curb' | 'runoff';
  readonly id: string;
  readonly endpoint: 'startStation' | 'endStation';
}

interface BandPickMesh extends THREE.Mesh {
  userData: { band: BandRef };
}

interface BandHandleMesh extends THREE.Mesh {
  userData: { handle: BandHandleRef };
}

export function TrackViewport(props: TrackViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const transformControlsRef = useRef<TransformControls | null>(null);
  const transformTargetRef = useRef<THREE.Object3D | null>(null);
  const rootRef = useRef<THREE.Group | null>(null);
  const carRef = useRef<THREE.Group | null>(null);
  const brushCursorRef = useRef<THREE.Group | null>(null);
  const previewLineRef = useRef<THREE.Line | null>(null);
  const controlPointsRef = useRef<ControlPointMesh[]>([]);
  const bandMeshesRef = useRef<BandPickMesh[]>([]);
  const bandHandlesRef = useRef<BandHandleMesh[]>([]);
  const dragPointRef = useRef<string | null>(null);
  const bandEndpointDragRef = useRef<BandHandleRef | null>(null);
  const terrainBrushDragRef = useRef(false);
  const lastTerrainBrushCellRef = useRef<string | null>(null);
  const lastTerrainBrushTimeRef = useRef(0);
  const latestPropsRef = useRef(props);
  const cameraLocksRef = useRef(
    createCameraInteractionLocks((state) => {
      const controls = controlsRef.current;
      if (controls) {
        controls.enabled = !state.locked;
      }
    }),
  );

  latestPropsRef.current = props;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x051326);
    const camera = new THREE.PerspectiveCamera(42, host.clientWidth / host.clientHeight, 0.1, 2000);
    camera.position.set(0, 300, 350);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(12, 0, 0);
    controls.maxPolarAngle = Math.PI * 0.48;
    const transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.setMode('translate');
    transformControls.setSize(0.82);
    scene.add(getTransformControlsHelper(transformControls));

    const root = new THREE.Group();
    scene.add(root);
    addLights(scene);
    root.add(createBlueprintGrid());

    const car = createCarMesh();
    root.add(car);

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    controlsRef.current = controls;
    transformControlsRef.current = transformControls;
    rootRef.current = root;
    carRef.current = car;
    const cameraLocks = cameraLocksRef.current;
    let wasTransformDragging = false;
    transformControls.addEventListener('dragging-changed', (event) => {
      if (event.value) {
        wasTransformDragging = true;
        cameraLocks.lock('transform-controls');
      } else {
        cameraLocks.unlock('transform-controls');
        // Three.js fires dragging-changed:false on every canvas pointerup, not
        // only after an actual drag — guard with wasTransformDragging.
        if (wasTransformDragging) {
          wasTransformDragging = false;
          const selectedPoint = latestPropsRef.current.selectedPoint;
          const target = transformTargetRef.current;
          if (selectedPoint && target) {
            latestPropsRef.current.onMoveControlPoint(
              selectedPoint,
              { x: target.position.x, y: target.position.z },
              target.position.y,
            );
          }
        }
      }
    });
    transformControls.addEventListener('objectChange', () => {
      const selectedPoint = latestPropsRef.current.selectedPoint;
      const target = transformTargetRef.current;
      if (!selectedPoint || !target) {
        return;
      }
      // Live drag: cheap preview only (no surface/terrain recompile).
      latestPropsRef.current.onPreviewMoveControlPoint(
        selectedPoint,
        { x: target.position.x, y: target.position.z },
        target.position.y,
      );
    });

    let animationFrame = 0;
    let previousTime = performance.now();

    const resizeObserver = new ResizeObserver(() => resizeRenderer(host, renderer, camera));
    resizeObserver.observe(host);

    const animate = (time: number) => {
      const currentProps = latestPropsRef.current;
      const deltaSeconds = Math.min((time - previousTime) / 1000, 0.08);
      previousTime = time;

      if (currentProps.isPlaying && currentProps.lookup.totalLength > 0) {
        currentProps.onStationChange(currentProps.station + currentProps.speed * deltaSeconds);
      }

      updateCarMesh(car, currentProps.document, currentProps.lookup, currentProps.surface, currentProps.station);
      updateCameraMode(currentProps.cameraMode, camera, cameraLocks, car, controls);
      controls.update();
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      cameraLocks.clear();
      transformControls.detach();
      transformControls.dispose();
      controls.dispose();
      disposeObject(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    rebuildTrackObjects(
      props.document,
      props.surface,
      props.display,
      props.selectedPoint,
      props.selectedStation,
      props.activeTool,
      props.selectedBand,
      rootRef.current,
      controlPointsRef,
      bandMeshesRef,
      bandHandlesRef,
      transformControlsRef.current,
      transformTargetRef,
    );
  }, [
    props.activeTool,
    props.display.asphalt,
    props.display.centerline,
    props.display.edges,
    props.display.wireframe,
    props.display.structures,
    props.document,
    props.selectedPoint,
    props.selectedStation,
    props.selectedBand,
    props.surface,
  ]);

  // Lightweight effect: only updates the preview polyline through anchor
  // positions. This avoids a full Three.js rebuild on every drag frame.
  useEffect(() => {
    updateAuthoringPreview(rootRef.current, previewLineRef, props.authoringPoints, props.document.closed, props.activeTool);
  }, [props.activeTool, props.authoringPoints, props.document.closed]);

  useEffect(() => {
    rebuildTerrainObjects(
      rootRef.current,
      props.terrain,
      props.terrainMesh,
      props.skirtMesh,
      props.bridgePillars,
      props.portalFill,
      props.display,
      props.imageryCanvas,
    );
  }, [
    props.display.terrain,
    props.display.terrainWireframe,
    props.display.corridorMask,
    props.display.skirtMask,
    props.display.seams,
    props.display.terrainImagery,
    props.display.structures,
    props.terrain,
    props.terrainMesh,
    props.skirtMesh,
    props.bridgePillars,
    props.portalFill,
    props.imageryCanvas,
  ]);

  useEffect(() => {
    // Remove the Spline placement dot whenever we leave the Spline tool.
    if (props.activeTool !== 'Spline') {
      updateSplinePlacementDot(rootRef.current, null);
    }
  }, [props.activeTool]);

  useEffect(() => {
    updateBrushCursor(
      rootRef.current,
      brushCursorRef,
      props.terrain,
      props.terrainBrush,
      props.terrainCursor,
    );
  }, [props.terrain, props.terrainBrush, props.terrainCursor]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera) {
      return;
    }

    const element = renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    const setPointer = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      raycaster.setFromCamera(pointer, camera);
    };

    // Resolve the cursor to the point on the TERRAIN SURFACE, not the flat y=0
    // plane — otherwise clicks over raised/lowered terrain land offset
    // horizontally (the error grows with elevation). We start from the y=0 plane
    // hit, then iteratively walk the ray to where it meets the sampled terrain
    // height, re-sampling at each new XZ. A handful of iterations converges for
    // typical slopes; we fall back to the plane hit for near-horizontal rays.
    const pointerToGround = (): Vector2 | null => {
      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(ground, hit)) {
        return null;
      }
      const terrain = latestPropsRef.current.terrain;
      const origin = raycaster.ray.origin;
      const dir = raycaster.ray.direction;
      // Reusable point object for sampling at the current XZ guess.
      const probe = { x: hit.x, z: hit.z };
      for (let i = 0; i < 8; i += 1) {
        const surfaceY = sampleTerrainHeightBilinear(terrain, probe);
        // Where along the ray does y == surfaceY?  origin.y + t*dir.y = surfaceY
        if (Math.abs(dir.y) < 1e-6) {
          break; // Near-horizontal ray: keep the plane/last guess.
        }
        const t = (surfaceY - origin.y) / dir.y;
        if (t <= 0) {
          break; // Surface is behind the camera along this ray; keep last guess.
        }
        const nx = origin.x + dir.x * t;
        const nz = origin.z + dir.z * t;
        if (Math.abs(nx - probe.x) < 1e-3 && Math.abs(nz - probe.z) < 1e-3) {
          probe.x = nx;
          probe.z = nz;
          break;
        }
        probe.x = nx;
        probe.z = nz;
      }
      return { x: probe.x, y: probe.z };
    };

    const stopCameraGesture = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    const applyTerrainBrushAt = (point: TerrainPoint) => {
      const now = performance.now();
      if (now - lastTerrainBrushTimeRef.current < 12) {
        return;
      }

      const terrain = latestPropsRef.current.terrain;
      const cell = worldToCell(terrain, point);
      const cellKey = `${cell.column}:${cell.row}`;
      if (lastTerrainBrushCellRef.current === cellKey) {
        return;
      }

      lastTerrainBrushTimeRef.current = now;
      lastTerrainBrushCellRef.current = cellKey;
      latestPropsRef.current.onTerrainBrush(point);
    };

    const onPointerDown = (event: PointerEvent) => {
      setPointer(event);
      const groundPosition = pointerToGround();

      // Curbs tool: dragging an endpoint handle, then selecting a band, take
      // priority over the generic control-point / inspection handling.
      if (latestPropsRef.current.activeTool === 'Curbs') {
        const handleHit = raycaster.intersectObjects(bandHandlesRef.current, false)[0]?.object as
          | BandHandleMesh
          | undefined;
        if (handleHit) {
          stopCameraGesture(event);
          cameraLocksRef.current.lock('control-point-drag');
          bandEndpointDragRef.current = handleHit.userData.handle;
          latestPropsRef.current.onBeginBandEndpointDrag();
          element.setPointerCapture(event.pointerId);
          return;
        }
        const bandHit = raycaster.intersectObjects(bandMeshesRef.current, false)[0]?.object as
          | BandPickMesh
          | undefined;
        if (bandHit) {
          stopCameraGesture(event);
          latestPropsRef.current.onSelectBand(bandHit.userData.band);
          return;
        }
      }

      const controlPointHits = raycaster.intersectObjects(controlPointsRef.current, false);
      const hit = controlPointHits[0]?.object;
      if (hit && groundPosition) {
        const hitObject = hit as ControlPointMesh;
        const pointId = hitObject.userData.pointId;
        const startPosition = findControlPointPosition(latestPropsRef.current.document, pointId);
        if (!startPosition) {
          return;
        }
        stopCameraGesture(event);
        cameraLocksRef.current.lock('control-point-drag');
        dragPointRef.current = pointId;
        latestPropsRef.current.onSelectPoint(pointId);
        element.setPointerCapture(event.pointerId);
      } else if (groundPosition && latestPropsRef.current.activeTool === 'Spline') {
        stopCameraGesture(event);
        latestPropsRef.current.onAddControlPoint(groundPosition);
      } else if (groundPosition && latestPropsRef.current.terrainBrush.active) {
        stopCameraGesture(event);
        cameraLocksRef.current.lock('terrain-brush');
        terrainBrushDragRef.current = true;
        lastTerrainBrushCellRef.current = null;
        lastTerrainBrushTimeRef.current = 0;
        element.setPointerCapture(event.pointerId);
        const terrainPoint = trackPointToTerrainPoint(groundPosition);
        latestPropsRef.current.onTerrainHover(terrainPoint);
        applyTerrainBrushAt(terrainPoint);
      } else if (groundPosition) {
        if (latestPropsRef.current.lookup.samples.length === 0) {
          return;
        }
        const inspected = nearestStation(
          latestPropsRef.current.document,
          latestPropsRef.current.lookup,
          groundPosition,
        );
        latestPropsRef.current.onStationInspectionChange({
          station: inspected.station,
          lateralOffset: dot(subtract(groundPosition, inspected.position), inspected.normal),
        });
      }
    };

    let pendingDragMove: { pointId: string; position: Vector2 } | null = null;
    let pendingDragFrame: number | null = null;
    let lastDragPosition: { pointId: string; position: Vector2 } | null = null;
    const flushDragMove = () => {
      pendingDragFrame = null;
      if (!pendingDragMove) {
        return;
      }
      const { pointId, position } = pendingDragMove;
      pendingDragMove = null;
      lastDragPosition = { pointId, position };
      // Cheap preview during drag; commit happens on pointer-up.
      latestPropsRef.current.onPreviewMoveControlPoint(pointId, position);
    };

    // Band-endpoint drag: maps the cursor to the nearest station and previews
    // the moved endpoint each frame. The final station commits on pointer-up.
    let lastBandStation: number | null = null;
    const moveBandEndpointTo = (groundPosition: Vector2) => {
      const handle = bandEndpointDragRef.current;
      if (!handle) {
        return;
      }
      const inspected = nearestStation(
        latestPropsRef.current.document,
        latestPropsRef.current.lookup,
        groundPosition,
      );
      lastBandStation = inspected.station;
      latestPropsRef.current.onMoveBandEndpoint(handle.kind, handle.id, handle.endpoint, inspected.station);
    };

    const onPointerMove = (event: PointerEvent) => {
      setPointer(event);
      const groundPosition = pointerToGround();
      if (!groundPosition) {
        latestPropsRef.current.onHoverStationChange(null);
        latestPropsRef.current.onTerrainHover(null);
        updateSplinePlacementDot(rootRef.current, null);
        return;
      }

      if (bandEndpointDragRef.current) {
        stopCameraGesture(event);
        moveBandEndpointTo(groundPosition);
      } else if (dragPointRef.current) {
        stopCameraGesture(event);
        // Coalesce drag updates to one per animation frame. Mouse events
        // fire faster than React can re-render the track at high res, so
        // dispatching each event causes a backlog and laggy feel. With
        // rAF batching the most recent position always wins.
        pendingDragMove = { pointId: dragPointRef.current, position: groundPosition };
        if (pendingDragFrame === null) {
          pendingDragFrame = requestAnimationFrame(flushDragMove);
        }
      } else if (latestPropsRef.current.activeTool === 'Spline') {
        // Update the ghost dot preview for the next-point placement.
        updateSplinePlacementDot(rootRef.current, groundPosition);
        return;
      } else if (terrainBrushDragRef.current) {
        stopCameraGesture(event);
        const terrainPoint = trackPointToTerrainPoint(groundPosition);
        latestPropsRef.current.onTerrainHover(terrainPoint);
        applyTerrainBrushAt(terrainPoint);
      } else if (latestPropsRef.current.lookup.samples.length > 1) {
        latestPropsRef.current.onTerrainHover(trackPointToTerrainPoint(groundPosition));
        latestPropsRef.current.onHoverStationChange(
          nearestStation(
            latestPropsRef.current.document,
            latestPropsRef.current.lookup,
            groundPosition,
          ).station,
        );
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (bandEndpointDragRef.current) {
        stopCameraGesture(event);
        const handle = bandEndpointDragRef.current;
        // Re-apply the final station (history was snapshotted at drag start).
        if (lastBandStation !== null) {
          latestPropsRef.current.onMoveBandEndpoint(handle.kind, handle.id, handle.endpoint, lastBandStation);
        }
      } else if (dragPointRef.current) {
        stopCameraGesture(event);
        if (pendingDragFrame !== null) {
          cancelAnimationFrame(pendingDragFrame);
          pendingDragFrame = null;
        }
        flushDragMove();
        // Commit the final position to trigger a full surface +
        // terrain recompile, plus a single undo entry for the drag.
        if (lastDragPosition) {
          latestPropsRef.current.onMoveControlPoint(
            lastDragPosition.pointId,
            lastDragPosition.position,
          );
        }
      }
      lastDragPosition = null;
      lastBandStation = null;
      bandEndpointDragRef.current = null;
      dragPointRef.current = null;
      terrainBrushDragRef.current = false;
      lastTerrainBrushCellRef.current = null;
      lastTerrainBrushTimeRef.current = 0;
      cameraLocksRef.current.unlock('control-point-drag');
      cameraLocksRef.current.unlock('terrain-brush');
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
    };

    element.addEventListener('pointerdown', onPointerDown, { capture: true });
    element.addEventListener('pointermove', onPointerMove, { capture: true });
    element.addEventListener('pointerup', onPointerUp, { capture: true });
    element.addEventListener('pointercancel', onPointerUp, { capture: true });

    return () => {
      element.removeEventListener('pointerdown', onPointerDown, { capture: true });
      element.removeEventListener('pointermove', onPointerMove, { capture: true });
      element.removeEventListener('pointerup', onPointerUp, { capture: true });
      element.removeEventListener('pointercancel', onPointerUp, { capture: true });
    };
  }, []);

  return <div ref={hostRef} className="viewport" data-testid="track-viewport" />;
}

function trackPointToTerrainPoint(point: Vector2): TerrainPoint {
  return { x: point.x, z: point.y };
}

function rebuildTrackObjects(
  document: TrackDocument,
  surface: CompileResult,
  display: TrackDisplayOptions,
  selectedPoint: string | null,
  selectedStation: number | null,
  activeTool: EditorTool,
  selectedBand: BandRef | null,
  root: THREE.Group | null,
  controlPointsRef: React.MutableRefObject<ControlPointMesh[]>,
  bandMeshesRef: React.MutableRefObject<BandPickMesh[]>,
  bandHandlesRef: React.MutableRefObject<BandHandleMesh[]>,
  transformControls: TransformControls | null,
  transformTargetRef: React.MutableRefObject<THREE.Object3D | null>,
) {
  if (!root) {
    return;
  }

  const oldTrack = root.getObjectByName('track-root');
  if (oldTrack) {
    root.remove(oldTrack);
    disposeObject(oldTrack);
  }

  const selectActive = activeTool === 'Select';
  const curbsActive = activeTool === 'Curbs';

  const trackRoot = new THREE.Group();
  trackRoot.name = 'track-root';
  bandMeshesRef.current = [];
  bandHandlesRef.current = [];
  if (display.asphalt) {
    trackRoot.add(createAsphaltMesh(surface, display.wireframe));
    surface.curbs.forEach((curb) => {
      const mesh = createSurfaceBandMesh(curb, curb.side === 'left' ? 0xd9482e : 0x2e8bd9, display.wireframe);
      registerBandMesh(mesh, { kind: 'curb', id: curb.intervalId }, curbsActive, selectedBand, bandMeshesRef);
      trackRoot.add(mesh);
    });
    surface.runoffs.forEach((runoff) => {
      const mesh = createSurfaceBandMesh(runoff, runoff.side === 'left' ? 0x69747a : 0x556f8c, display.wireframe);
      registerBandMesh(mesh, { kind: 'runoff', id: runoff.intervalId }, curbsActive, selectedBand, bandMeshesRef);
      trackRoot.add(mesh);
    });
    if (selectActive) {
      trackRoot.add(createBandEndpointMarkers([...surface.curbs, ...surface.runoffs]));
    }
  }
  // Tunnel bores and bridge decks. The StructureMeshData buffers match the band
  // mesh shape, so createMeshFromBand renders them unchanged.
  if (display.structures) {
    surface.structures.forEach((structure) => {
      const color = structure.kind === 'tunnel' ? 0x8893a0 : 0x9aa0a8;
      const mesh = createMeshFromBand(structure, color, display.wireframe);
      mesh.name = `${structure.bandType}:${structure.structureId}`;
      trackRoot.add(mesh);
    });
    if (curbsActive && selectedBand) {
      const band = [...surface.curbs, ...surface.runoffs].find((entry) => entry.intervalId === selectedBand.id);
      if (band) {
        bandHandlesRef.current = createBandEndpointHandles(band, selectedBand);
        bandHandlesRef.current.forEach((handle) => trackRoot.add(handle));
      }
    }
  }
  if (display.centerline) {
    trackRoot.add(createCenterline(surface.crossSections));
  }
  if (display.edges) {
    trackRoot.add(createEdgeLines(surface.crossSections));
    if (selectActive) {
      trackRoot.add(createWidthHandlePlaceholders(surface.crossSections));
    }
  }
  trackRoot.add(createSampleDebug(surface.crossSections));
  trackRoot.add(createStationCutTicks(surface.crossSections));
  trackRoot.add(createSectorLabels(document, surface));
  trackRoot.add(createStationMarkers(surface));
  if (selectedStation !== null) {
    const highlighted = nearestCrossSection(surface.crossSections, selectedStation);
    if (highlighted) {
      trackRoot.add(createStationRowHighlight(highlighted));
    }
  }
  trackRoot.add(createControlPolygon(document));

  if (selectActive) {
    controlPointsRef.current = createControlPoints(document, selectedPoint);
    controlPointsRef.current.forEach((point) => trackRoot.add(point));
  } else {
    controlPointsRef.current = [];
  }

  const selectedPointPosition = selectedPoint ? findControlPointPosition(document, selectedPoint) : null;
  if (selectActive && selectedPointPosition && transformControls) {
    const target = transformTargetRef.current ?? new THREE.Object3D();
    target.position.set(
      selectedPointPosition.position.x,
      selectedPointPosition.elevation,
      selectedPointPosition.position.y,
    );
    transformTargetRef.current = target;
    trackRoot.add(target);
    transformControls.attach(target);
  } else {
    transformControls?.detach();
    transformTargetRef.current = null;
  }
  root.add(trackRoot);
}

function rebuildTerrainObjects(
  root: THREE.Group | null,
  terrain: TerrainDocument,
  terrainMesh: TerrainMeshData,
  skirtMesh: SkirtMeshData,
  bridgePillars: TerrainMeshData | null,
  portalFill: TerrainMeshData | null,
  display: TrackDisplayOptions,
  imageryCanvas: HTMLCanvasElement | null,
) {
  if (!root) {
    return;
  }

  const previous = root.getObjectByName('terrain-root');
  if (previous) {
    root.remove(previous);
    disposeObject(previous);
  }

  // Drape the satellite aerial only when imagery is present and enabled; the
  // terrain mesh's 0..1 grid UVs map straight onto the cropped canvas.
  const imageryTexture =
    imageryCanvas && display.terrainImagery ? new THREE.CanvasTexture(imageryCanvas) : null;
  if (imageryTexture) {
    imageryTexture.colorSpace = THREE.SRGBColorSpace;
    imageryTexture.flipY = false;
  }

  // World-space bounds of the imagery (matches the terrain extents). Used by the
  // satellite material to derive UVs from world XZ so terrain and skirt share
  // one seamless projection of the aerial — no per-mesh UV alignment needed.
  const imageryBounds: ImageryWorldBounds = {
    minX: terrain.origin.x,
    minZ: terrain.origin.z,
    width: terrain.size.width,
    depth: terrain.size.depth,
  };

  const terrainRoot = new THREE.Group();
  terrainRoot.name = 'terrain-root';
  if (display.terrain) {
    terrainRoot.add(
      createTerrainMesh(terrainMesh, display.terrainWireframe, imageryTexture, imageryBounds),
    );
    // The skirt is "everything but the asphalt" too, so it also takes the aerial
    // (via the same world-planar projection) when imagery is active.
    terrainRoot.add(createSkirtMesh(skirtMesh, display.terrainWireframe, imageryTexture, imageryBounds));
  }
  if (display.corridorMask || display.skirtMask) {
    terrainRoot.add(createMaskOverlay(terrain, display.corridorMask, display.skirtMask));
  }
  if (display.seams) {
    terrainRoot.add(createSeamOverlay(skirtMesh));
  }
  // Pillars and tunnel portal fill sit on the terrain side so they share the
  // terrain material family. Gated by the structures toggle.
  if (display.structures) {
    if (bridgePillars && bridgePillars.indices.length > 0) {
      terrainRoot.add(meshFromTerrainData(bridgePillars, 0x6b7079, display.terrainWireframe, 1, false, 0, 0));
    }
    if (portalFill && portalFill.indices.length > 0) {
      terrainRoot.add(meshFromTerrainData(portalFill, 0x5b5550, display.terrainWireframe, 1, false, 0, 0));
    }
  }
  root.add(terrainRoot);
}

const SPLINE_DOT_NAME = 'spline-placement-dot';

function updateSplinePlacementDot(root: THREE.Group | null, position: Vector2 | null) {
  if (!root) {
    return;
  }
  const previous = root.getObjectByName(SPLINE_DOT_NAME);
  if (previous) {
    root.remove(previous);
    disposeObject(previous);
  }
  if (!position) {
    return;
  }
  const dot = new THREE.Points(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(position.x, 1.2, position.y)]),
    new THREE.PointsMaterial({
      color: 0xfff06b,
      size: 7,
      sizeAttenuation: false,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.9,
    }),
  );
  dot.name = SPLINE_DOT_NAME;
  dot.renderOrder = 26;
  root.add(dot);
}

function updateBrushCursor(
  root: THREE.Group | null,
  brushCursorRef: React.MutableRefObject<THREE.Group | null>,
  terrain: TerrainDocument,
  terrainBrush: TerrainBrushSettings & { readonly active: boolean },
  terrainCursor: TerrainPoint | null,
) {
  if (!root) {
    return;
  }

  const previous = brushCursorRef.current;
  if (previous) {
    root.remove(previous);
    disposeObject(previous);
    brushCursorRef.current = null;
  }

  if (!terrainBrush.active || !terrainCursor) {
    return;
  }

  const cursor = createBrushCursor(terrain, terrainBrush, terrainCursor);
  cursor.name = 'terrain-brush-cursor';
  brushCursorRef.current = cursor;
  root.add(cursor);
}

// Lighter asphalt-blue tint with a printed white world-space grid on
// top — schematic / blueprint look. Lighting is quantised into three
// toon bands so the surface reads as a flat technical drawing instead
// of a photoreal landscape.
const TERRAIN_BASE_COLOR = new THREE.Color('#3d7dd1');
const TERRAIN_GRID_COLOR = new THREE.Color('#f4faff');
const TERRAIN_LIGHT_DIR = new THREE.Vector3(0.55, 0.85, 0.35).normalize();

function createTerrainShaderMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uBaseColor: { value: TERRAIN_BASE_COLOR.clone() },
      uGridColor: { value: TERRAIN_GRID_COLOR.clone() },
      uLightDir: { value: TERRAIN_LIGHT_DIR.clone() },
      // Spacing/thickness are in world units (meters).
      uMajorSpacing: { value: 20.0 },
      uMinorSpacing: { value: 5.0 },
      uMajorThickness: { value: 0.32 },
      uMinorThickness: { value: 0.14 },
      uMajorOpacity: { value: 0.6 },
      uMinorOpacity: { value: 0.22 },
      uToonSteps: { value: 3.0 },
      uShadowFloor: { value: 0.55 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      uniform vec3 uBaseColor;
      uniform vec3 uGridColor;
      uniform vec3 uLightDir;
      uniform float uMajorSpacing;
      uniform float uMinorSpacing;
      uniform float uMajorThickness;
      uniform float uMinorThickness;
      uniform float uMajorOpacity;
      uniform float uMinorOpacity;
      uniform float uToonSteps;
      uniform float uShadowFloor;

      // Distance from worldXZ to the nearest grid intersection axis, in
      // world units. fract() gives a 0..1 ramp inside each cell;
      // abs(fract-0.5)-0.5 turns it into a 0..0.5 ramp centered on the
      // grid line, then we multiply by spacing to put it back in meters.
      float gridMask(vec2 worldXZ, float spacing, float thickness) {
        vec2 cell = abs(fract(worldXZ / spacing - 0.5) - 0.5) * spacing;
        // Anti-alias the edge over a half-meter band so lines stay crisp
        // close to the camera and softly fall off far away without
        // needing screen-space derivatives.
        float aa = 0.35;
        vec2 line = smoothstep(thickness + aa, thickness - aa, cell);
        return max(line.x, line.y);
      }

      void main() {
        // Toon-stepped lighting: quantise n·l into uToonSteps bands so
        // shading reads like crosshatched diagram bands rather than a
        // smooth gradient.
        float ndotl = max(dot(normalize(vWorldNormal), uLightDir), 0.0);
        float bands = max(uToonSteps, 1.0);
        float stepped = floor(ndotl * bands) / bands;
        vec3 lit = uBaseColor * mix(uShadowFloor, 1.0, stepped);

        // Two grid frequencies: faint minor lines + bold major lines.
        float minorMask = gridMask(vWorldPosition.xz, uMinorSpacing, uMinorThickness);
        float majorMask = gridMask(vWorldPosition.xz, uMajorSpacing, uMajorThickness);
        vec3 withMinor = mix(lit, uGridColor, minorMask * uMinorOpacity);
        vec3 finalColor = mix(withMinor, uGridColor, majorMask * uMajorOpacity);

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
    side: THREE.FrontSide,
    transparent: false,
  });
}

interface ImageryWorldBounds {
  readonly minX: number;
  readonly minZ: number;
  readonly width: number;
  readonly depth: number;
}

function createTerrainMesh(
  mesh: TerrainMeshData,
  wireframe: boolean,
  imageryTexture: THREE.Texture | null,
  imageryBounds: ImageryWorldBounds,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'terrain';
  const solid = imageryTexture
    ? createSatelliteMesh(mesh, imageryTexture, imageryBounds, 2, 2)
    : createSchematicTerrainMesh(mesh, 2, 2);
  solid.renderOrder = -3;
  group.add(solid);
  if (wireframe) {
    const wire = meshFromTerrainData(mesh, 0x9fd5ff, true, 0.55, false, 0, 0);
    wire.renderOrder = -2;
    group.add(wire);
  }
  return group;
}

// Drape the satellite aerial over any terrain-like mesh (terrain OR skirt) using
// a world-XZ planar projection: UV is derived from world position against the
// imagery's world bounds, so adjacent meshes line up seamlessly regardless of
// their own UVs. This is how the skirt picks up the same photo as the terrain.
function createSatelliteMesh(
  mesh: TerrainMeshData,
  texture: THREE.Texture,
  bounds: ImageryWorldBounds,
  polygonOffsetFactor: number,
  polygonOffsetUnits: number,
): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  return new THREE.Mesh(
    geometry,
    createWorldPlanarSatelliteMaterial(texture, bounds, polygonOffsetFactor, polygonOffsetUnits),
  );
}

// A lightly-shaded textured material whose UVs come from world XZ. The aerial
// canvas is stored top-left origin (flipY=false) and its rows run north→south,
// matching terrain row 0 = north, so V maps directly from (z - minZ)/depth.
function createWorldPlanarSatelliteMaterial(
  texture: THREE.Texture,
  bounds: ImageryWorldBounds,
  polygonOffsetFactor: number,
  polygonOffsetUnits: number,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: texture },
      uMin: { value: new THREE.Vector2(bounds.minX, bounds.minZ) },
      uSize: { value: new THREE.Vector2(Math.max(bounds.width, 1e-6), Math.max(bounds.depth, 1e-6)) },
      uLightDir: { value: TERRAIN_LIGHT_DIR.clone() },
      uShadowFloor: { value: 0.72 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      uniform sampler2D uMap;
      uniform vec2 uMin;
      uniform vec2 uSize;
      uniform vec3 uLightDir;
      uniform float uShadowFloor;
      void main() {
        vec2 uv = (vWorldPosition.xz - uMin) / uSize;
        vec3 albedo = texture2D(uMap, uv).rgb;
        // Gentle directional shading so relief still reads under the photo,
        // floored so shadowed slopes don't go black.
        float ndotl = max(dot(normalize(vWorldNormal), uLightDir), 0.0);
        float shade = mix(uShadowFloor, 1.0, ndotl);
        gl_FragColor = vec4(albedo * shade, 1.0);
      }
    `,
    side: THREE.FrontSide,
    transparent: false,
    polygonOffset: true,
    polygonOffsetFactor,
    polygonOffsetUnits,
  });
}

function createSkirtMesh(
  mesh: SkirtMeshData,
  wireframe: boolean,
  imageryTexture: THREE.Texture | null,
  imageryBounds: ImageryWorldBounds,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'skirt';
  const skirt = imageryTexture
    ? createSatelliteMesh(mesh, imageryTexture, imageryBounds, -0.5, -0.5)
    : createSchematicTerrainMesh(mesh, -0.5, -0.5);
  skirt.renderOrder = -2;
  group.add(skirt);
  // The seam (skirt) is terrain-like geometry, so the "Terrain wire" toggle
  // should reveal its triangulation too — previously the flag was ignored here
  // and the wire stopped at the corridor edge. Match the terrain mesh's wire
  // overlay so the grid reads continuously across the seam.
  if (wireframe) {
    const wire = meshFromTerrainData(mesh, 0x9fd5ff, true, 0.55, false, 0, 0);
    wire.renderOrder = -1;
    group.add(wire);
  }
  return group;
}

function createSchematicTerrainMesh(
  mesh: TerrainMeshData,
  polygonOffsetFactor: number,
  polygonOffsetUnits: number,
): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  const material = createTerrainShaderMaterial();
  material.polygonOffset = true;
  material.polygonOffsetFactor = polygonOffsetFactor;
  material.polygonOffsetUnits = polygonOffsetUnits;
  return new THREE.Mesh(geometry, material);
}

function meshFromTerrainData(
  mesh: TerrainMeshData,
  color: number,
  wireframe: boolean,
  opacity: number,
  polygonOffset: boolean,
  polygonOffsetFactor: number,
  polygonOffsetUnits: number,
): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2));
  if (mesh.colors) {
    geometry.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3));
  }
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.14,
      roughness: 0.92,
      metalness: 0,
      side: THREE.FrontSide,
      transparent: opacity < 1,
      opacity,
      wireframe,
      vertexColors: Boolean(mesh.colors) && !wireframe,
      polygonOffset,
      polygonOffsetFactor,
      polygonOffsetUnits,
      depthWrite: !wireframe,
    }),
  );
}

function createMaskOverlay(
  terrain: TerrainDocument,
  showCorridor: boolean,
  showSkirt: boolean,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'mask-overlay';
  const corridorPoints: THREE.Vector3[] = [];
  const skirtPoints: THREE.Vector3[] = [];

  terrain.masks.forEach((mask, index) => {
    const column = index % terrain.resolution.columns;
    const row = Math.floor(index / terrain.resolution.columns);
    const world = cellToWorld(terrain, { column, row });
    const height = (terrain.heights[index] ?? 0) + 0.6;
    if (mask === 'locked' && showCorridor) {
      corridorPoints.push(new THREE.Vector3(world.x, height, world.z));
    } else if (mask === 'skirt' && showSkirt) {
      skirtPoints.push(new THREE.Vector3(world.x, height, world.z));
    }
  });

  if (corridorPoints.length > 0) {
    group.add(
      new THREE.Points(
        new THREE.BufferGeometry().setFromPoints(corridorPoints),
        new THREE.PointsMaterial({ color: 0xfff06b, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.8 }),
      ),
    );
  }
  if (skirtPoints.length > 0) {
    group.add(
      new THREE.Points(
        new THREE.BufferGeometry().setFromPoints(skirtPoints),
        new THREE.PointsMaterial({ color: 0x68f0ff, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.65 }),
      ),
    );
  }

  return group;
}

function createSeamOverlay(skirt: SkirtMeshData): THREE.LineSegments {
  const points: THREE.Vector3[] = [];
  for (const seam of skirt.seam) {
    const inner = seam.innerVertexIndex * 3;
    const outer = seam.outerVertexIndex * 3;
    points.push(
      new THREE.Vector3(skirt.positions[inner], skirt.positions[inner + 1] + 0.28, skirt.positions[inner + 2]),
      new THREE.Vector3(skirt.positions[outer], skirt.positions[outer + 1] + 0.28, skirt.positions[outer + 2]),
    );
  }
  return new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0x7df9ff, transparent: true, opacity: 0.55 }),
  );
}

function createBrushCursor(
  terrain: TerrainDocument,
  brush: TerrainBrushSettings,
  cursor: TerrainPoint,
): THREE.Group {
  const cell = worldToCell(terrain, cursor);
  const index = cell.row * terrain.resolution.columns + cell.column;
  const blocked = terrain.masks[index] !== 'free';
  const height = sampleTerrainHeight(terrain, cursor);
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(Math.max(brush.radius - 0.35, 0.1), brush.radius, 64),
    new THREE.MeshBasicMaterial({
      color: blocked ? 0xff5f57 : 0x7df9ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(cursor.x, height + 0.62, cursor.z);
  group.add(ring);
  group.add(
    new THREE.Points(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(cursor.x, height + 0.7, cursor.z)]),
      new THREE.PointsMaterial({
        color: blocked ? 0xff5f57 : 0xfff06b,
        size: 5,
        sizeAttenuation: false,
      }),
    ),
  );
  return group;
}

function createAsphaltMesh(surface: CompileResult, wireframe: boolean): THREE.Mesh {
  return createMeshFromBand(surface.asphalt, 0x1d7fff, wireframe, 0x0e5bd4);
}

function createSurfaceBandMesh(
  band: SurfaceBandMeshData,
  color: number,
  wireframe: boolean,
): THREE.Mesh {
  const mesh = createMeshFromBand(band, color, wireframe, color);
  mesh.name = `${band.bandType}:${band.intervalId}`;
  return mesh;
}

function createBandEndpointMarkers(bands: readonly SurfaceBandMeshData[]): THREE.Points {
  const points: THREE.Vector3[] = [];
  for (const band of bands) {
    if (band.rowCount === 0) {
      continue;
    }
    const rowStride = (band.columnCount ?? 2) * 3;
    const first = 0;
    const last = (band.rowCount - 1) * rowStride;
    points.push(
      new THREE.Vector3(band.positions[first], band.positions[first + 1] + 0.55, band.positions[first + 2]),
      new THREE.Vector3(band.positions[last], band.positions[last + 1] + 0.55, band.positions[last + 2]),
    );
  }

  const markers = new THREE.Points(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.PointsMaterial({
      color: 0xfff06b,
      size: 4,
      sizeAttenuation: false,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    }),
  );
  markers.renderOrder = 24;
  return markers;
}

// Tags a band mesh with its identity so the Curbs tool can raycast-select it,
// and brightens the emissive of the currently selected band so it stands out.
function registerBandMesh(
  mesh: THREE.Mesh,
  band: BandRef,
  curbsActive: boolean,
  selectedBand: BandRef | null,
  bandMeshesRef: React.MutableRefObject<BandPickMesh[]>,
) {
  if (!curbsActive) {
    return;
  }
  const pickMesh = mesh as BandPickMesh;
  pickMesh.userData.band = band;
  bandMeshesRef.current.push(pickMesh);

  if (selectedBand && selectedBand.kind === band.kind && selectedBand.id === band.id) {
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.emissive = new THREE.Color(0xfff06b);
    material.emissiveIntensity = 0.6;
  }
}

// World position at the center of a band's start/end row — where its draggable
// endpoint handle sits.
function bandEndpointPosition(band: SurfaceBandMeshData, endpoint: 'startStation' | 'endStation'): THREE.Vector3 {
  const columns = band.columnCount ?? 2;
  const rowStride = columns * 3;
  const rowStart = endpoint === 'startStation' ? 0 : (band.rowCount - 1) * rowStride;
  // Average the row's columns to land on the middle of the band edge.
  let x = 0;
  let y = 0;
  let z = 0;
  for (let column = 0; column < columns; column += 1) {
    const base = rowStart + column * 3;
    x += band.positions[base];
    y += band.positions[base + 1];
    z += band.positions[base + 2];
  }
  return new THREE.Vector3(x / columns, y / columns + 0.6, z / columns);
}

function createBandEndpointHandles(band: SurfaceBandMeshData, ref: BandRef): BandHandleMesh[] {
  if (band.rowCount === 0) {
    return [];
  }
  const handles: BandHandleMesh[] = [];
  for (const endpoint of ['startStation', 'endStation'] as const) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(2.6, 16, 12),
      new THREE.MeshStandardMaterial({
        color: 0xfff06b,
        emissive: 0x6a5300,
        emissiveIntensity: 0.6,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      }),
    ) as unknown as BandHandleMesh;
    mesh.position.copy(bandEndpointPosition(band, endpoint));
    mesh.renderOrder = 27;
    mesh.userData.handle = { kind: ref.kind, id: ref.id, endpoint };
    handles.push(mesh);
  }
  return handles;
}

function createMeshFromBand(
  band: AsphaltMeshData,
  color: number,
  wireframe: boolean,
  emissive = 0x000000,
): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(band.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(band.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(band.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(band.indices, 1));
  for (const group of band.materialGroups) {
    geometry.addGroup(group.start, group.count, group.materialIndex);
  }

  const material = new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: 0.24,
    metalness: 0,
    roughness: 0.68,
    side: THREE.DoubleSide,
    wireframe,
  });
  return new THREE.Mesh(geometry, material);
}

function createCenterline(crossSections: readonly TrackCrossSection[]): THREE.Line {
  const points = crossSections.map(
    (section) => new THREE.Vector3(section.center.x, section.centerHeight + 0.05, section.center.y),
  );
  if (crossSections.length > 2) {
    points.push(
      new THREE.Vector3(
        crossSections[0].center.x,
        crossSections[0].centerHeight + 0.05,
        crossSections[0].center.y,
      ),
    );
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({ color: 0x69f3ff, linewidth: 2 }),
  );
}

function createControlPolygon(document: TrackDocument): THREE.LineSegments {
  const points: THREE.Vector3[] = [];
  for (const segment of document.segments) {
    const controls = [segment.p0.position, segment.p1.position, segment.p2.position, segment.p3.position];
    for (let index = 0; index < controls.length - 1; index += 1) {
      const start = [segment.p0, segment.p1, segment.p2, segment.p3][index];
      const end = [segment.p0, segment.p1, segment.p2, segment.p3][index + 1];
      points.push(new THREE.Vector3(controls[index].x, (start.elevation ?? 0) + 0.12, controls[index].y));
      points.push(
        new THREE.Vector3(controls[index + 1].x, (end.elevation ?? 0) + 0.12, controls[index + 1].y),
      );
    }
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: 0x477179, transparent: true, opacity: 0.78 }),
  );
}

function createEdgeLines(crossSections: readonly TrackCrossSection[]): THREE.Group {
  const group = new THREE.Group();
  group.add(edgeLine(crossSections, 'left', 0xf2fbff));
  group.add(edgeLine(crossSections, 'right', 0xf2fbff));
  group.add(createDashedTrackMarkings(crossSections));
  return group;
}

function createDashedTrackMarkings(crossSections: readonly TrackCrossSection[]): THREE.LineSegments {
  const points: THREE.Vector3[] = [];
  const stride = 10;
  for (let index = 0; index < crossSections.length - 1; index += stride) {
    const start = crossSections[index];
    const end = crossSections[Math.min(index + Math.floor(stride / 2), crossSections.length - 1)];
    points.push(
      new THREE.Vector3(start.center.x, start.centerHeight + 0.18, start.center.y),
      new THREE.Vector3(end.center.x, end.centerHeight + 0.18, end.center.y),
    );
  }
  return new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0xdff8ff, transparent: true, opacity: 0.82 }),
  );
}

function createWidthHandlePlaceholders(crossSections: readonly TrackCrossSection[]): THREE.Points {
  const points: THREE.Vector3[] = [];
  const stride = Math.max(1, Math.floor(crossSections.length / 12));
  crossSections.forEach((section, index) => {
    if (index % stride !== 0) {
      return;
    }
    points.push(new THREE.Vector3(section.leftEdge.x, section.leftHeight + 0.28, section.leftEdge.y));
    points.push(new THREE.Vector3(section.rightEdge.x, section.rightHeight + 0.28, section.rightEdge.y));
  });

  return new THREE.Points(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.PointsMaterial({ color: 0xf2fdff, size: 3.2, sizeAttenuation: false }),
  );
}

function createSampleDebug(crossSections: readonly TrackCrossSection[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'sample-debug';
  if (!DEBUGENABLED) {
    return group;
  }

  const centerPoints = crossSections.map(
    (section) => new THREE.Vector3(section.center.x, section.centerHeight + 0.34, section.center.y),
  );
  group.add(
    new THREE.Points(
      new THREE.BufferGeometry().setFromPoints(centerPoints),
      new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false }),
    ),
  );

  const normalLines: THREE.Vector3[] = [];
  const tangentLines: THREE.Vector3[] = [];
  for (const section of crossSections) {
    const center = new THREE.Vector3(section.center.x, section.centerHeight + 0.32, section.center.y);
    normalLines.push(
      center,
      new THREE.Vector3(
        section.center.x + section.normal.x * 10,
        section.centerHeight + 0.32,
        section.center.y + section.normal.y * 10,
      ),
    );
    tangentLines.push(
      new THREE.Vector3(section.center.x, section.centerHeight + 0.26, section.center.y),
      new THREE.Vector3(
        section.center.x + section.tangent.x * 8,
        section.centerHeight + 0.26,
        section.center.y + section.tangent.y * 8,
      ),
    );
  }

  group.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(normalLines),
      new THREE.LineBasicMaterial({ color: 0xfff06b, transparent: true, opacity: 0.95 }),
    ),
  );
  group.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(tangentLines),
      new THREE.LineBasicMaterial({ color: 0x7df9ff, transparent: true, opacity: 0.75 }),
    ),
  );


  return group;
}

function createStationCutTicks(crossSections: readonly TrackCrossSection[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'station-cut-ticks';
  const optional: THREE.Vector3[] = [];
  const forced: THREE.Vector3[] = [];

  for (const section of crossSections) {
    const points = section.cut.optional ? optional : forced;
    points.push(
      new THREE.Vector3(section.leftEdge.x, section.leftHeight + 0.42, section.leftEdge.y),
      new THREE.Vector3(section.rightEdge.x, section.rightHeight + 0.42, section.rightEdge.y),
    );
  }

  group.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(optional),
      new THREE.LineBasicMaterial({ color: 0x315b63, transparent: true, opacity: 0.44 }),
    ),
  );
  group.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(forced),
      new THREE.LineBasicMaterial({ color: 0xf2fdff, transparent: true, opacity: 0.9 }),
    ),
  );
  return group;
}

function createSectorLabels(document: TrackDocument, surface: CompileResult): THREE.Group {
  const group = new THREE.Group();
  group.name = 'sector-labels';
  const sectors = document.sectors ?? [];
  if (sectors.length === 0 || surface.crossSections.length === 0) {
    return group;
  }

  for (const sector of sectors) {
    const midStation = (sector.startStation + sector.endStation) / 2;
    const section = nearestCrossSection(surface.crossSections, midStation);
    if (!section) {
      continue;
    }
    const sprite = createTextSprite((sector.name ?? sector.id).toUpperCase(), {
      fontSize: 30,
      color: '#0c1f33',
      backgroundColor: 'rgba(125, 245, 255, 0.94)',
      padding: 14,
    });
    sprite.position.set(section.center.x, section.centerHeight + 18, section.center.y);
    group.add(sprite);
  }

  return group;
}

function createStationMarkers(surface: CompileResult): THREE.Group {
  const group = new THREE.Group();
  group.name = 'station-markers';
  if (surface.crossSections.length === 0 || surface.totalLength <= 0) {
    return group;
  }

  const stepMeters = 50;
  const totalLength = surface.totalLength;
  for (let station = stepMeters; station < totalLength; station += stepMeters) {
    const section = nearestCrossSection(surface.crossSections, station);
    if (!section) {
      continue;
    }
    const meters = Math.round(station / 10) * 10;
    const label = `${Math.floor(meters / 100)}+${String(meters % 100).padStart(2, '0')}`;
    const sprite = createTextSprite(label, {
      fontSize: 22,
      color: '#9adcff',
      backgroundColor: 'rgba(6, 22, 44, 0.78)',
      padding: 6,
      borderColor: 'rgba(125, 245, 255, 0.7)',
    });
    const offset = 4;
    sprite.position.set(
      section.leftEdge.x + section.normal.x * offset,
      section.leftHeight + 6,
      section.leftEdge.y + section.normal.y * offset,
    );
    group.add(sprite);
  }

  return group;
}

interface TextSpriteOptions {
  readonly fontSize?: number;
  readonly color?: string;
  readonly backgroundColor?: string;
  readonly borderColor?: string;
  readonly padding?: number;
}

interface CachedSpriteTexture {
  readonly texture: THREE.CanvasTexture;
  readonly width: number;
  readonly height: number;
}

const TEXT_SPRITE_CACHE = new Map<string, CachedSpriteTexture>();
const TEXT_SPRITE_CACHE_LIMIT = 256;

function getSpriteTexture(text: string, options: TextSpriteOptions): CachedSpriteTexture {
  const key = `${text}|${options.fontSize ?? 28}|${options.padding ?? 10}|${options.color ?? ''}|${options.backgroundColor ?? ''}|${options.borderColor ?? ''}`;
  const cached = TEXT_SPRITE_CACHE.get(key);
  if (cached) {
    return cached;
  }

  const fontSize = options.fontSize ?? 28;
  const padding = options.padding ?? 10;
  const fontFamily = '"Inter", "Segoe UI", system-ui, sans-serif';
  const canvas = document.createElement('canvas');
  const measureCtx = canvas.getContext('2d');
  if (!measureCtx) {
    const fallback: CachedSpriteTexture = {
      texture: new THREE.CanvasTexture(canvas),
      width: 1,
      height: 1,
    };
    return fallback;
  }
  measureCtx.font = `700 ${fontSize}px ${fontFamily}`;
  const metrics = measureCtx.measureText(text);
  const width = Math.ceil(metrics.width + padding * 2);
  const height = Math.ceil(fontSize * 1.35 + padding * 2);
  const pixelRatio = Math.min(window.devicePixelRatio ?? 1, 2);
  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;

  const ctx = canvas.getContext('2d')!;
  ctx.scale(pixelRatio, pixelRatio);
  ctx.clearRect(0, 0, width, height);
  if (options.backgroundColor) {
    const radius = Math.min(8, height / 2);
    roundedRect(ctx, 0.5, 0.5, width - 1, height - 1, radius);
    ctx.fillStyle = options.backgroundColor;
    ctx.fill();
    if (options.borderColor) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = options.borderColor;
      ctx.stroke();
    }
  }
  ctx.font = `700 ${fontSize}px ${fontFamily}`;
  ctx.fillStyle = options.color ?? '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(text, padding, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;

  const entry: CachedSpriteTexture = { texture, width, height };
  if (TEXT_SPRITE_CACHE.size >= TEXT_SPRITE_CACHE_LIMIT) {
    // Evict the oldest entry — Map preserves insertion order.
    const firstKey = TEXT_SPRITE_CACHE.keys().next().value;
    if (firstKey !== undefined) {
      TEXT_SPRITE_CACHE.delete(firstKey);
    }
  }
  TEXT_SPRITE_CACHE.set(key, entry);
  return entry;
}

function createTextSprite(text: string, options: TextSpriteOptions = {}): THREE.Sprite {
  const { texture, width, height } = getSpriteTexture(text, options);
  // Each sprite gets its own material because polygonOffset / renderOrder
  // and per-instance state live on the material. The map (which is the
  // expensive part to upload) is shared via the texture cache.
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 30;
  const worldScale = 0.32;
  sprite.scale.set(width * worldScale, height * worldScale, 1);
  return sprite;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function createStationRowHighlight(section: TrackCrossSection): THREE.LineSegments {
  return new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(section.leftEdge.x, section.leftHeight + 1.05, section.leftEdge.y),
      new THREE.Vector3(section.rightEdge.x, section.rightHeight + 1.05, section.rightEdge.y),
    ]),
    new THREE.LineBasicMaterial({ color: 0xfff06b, transparent: true, opacity: 1 }),
  );
}

function nearestCrossSection(
  crossSections: readonly TrackCrossSection[],
  station: number,
): TrackCrossSection | null {
  if (crossSections.length === 0) {
    return null;
  }

  return crossSections.reduce((best, candidate) =>
    Math.abs(candidate.station - station) < Math.abs(best.station - station) ? candidate : best,
  );
}

function edgeLine(
  crossSections: readonly TrackCrossSection[],
  side: 'left' | 'right',
  color: number,
): THREE.Line {
  const points = crossSections.map((section) =>
    side === 'left'
      ? new THREE.Vector3(section.leftEdge.x, section.leftHeight + 0.1, section.leftEdge.y)
      : new THREE.Vector3(section.rightEdge.x, section.rightHeight + 0.1, section.rightEdge.y),
  );
  if (crossSections.length > 2) {
    const first = crossSections[0];
    points.push(
      side === 'left'
        ? new THREE.Vector3(first.leftEdge.x, first.leftHeight + 0.1, first.leftEdge.y)
        : new THREE.Vector3(first.rightEdge.x, first.rightHeight + 0.1, first.rightEdge.y),
    );
  }
  const geometry = new THREE.BufferGeometry().setFromPoints([
    ...points,
  ]);
  return new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }),
  );
}

function createControlPoints(
  document: TrackDocument,
  selectedPoint: string | null,
): ControlPointMesh[] {
  const seen = new Set<string>();
  const meshes: ControlPointMesh[] = [];

  for (const segment of document.segments) {
    for (const point of [segment.p0, segment.p1, segment.p2, segment.p3]) {
      if (seen.has(point.id)) {
        continue;
      }

      seen.add(point.id);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(point.id.startsWith('p-') ? 3.2 : 2.1, 16, 12),
        new THREE.MeshStandardMaterial({
          color: point.id === selectedPoint ? 0xfff06b : point.id.startsWith('p-') ? 0xbff8ff : 0x3ba8b6,
          emissive: point.id === selectedPoint ? 0x504000 : 0x000000,
          depthTest: false,
          depthWrite: false,
          transparent: true,
        }),
      ) as unknown as ControlPointMesh;
      mesh.position.set(point.position.x, (point.elevation ?? 0) + 1.4, point.position.y);
      mesh.renderOrder = 25;
      mesh.userData.pointId = point.id;
      meshes.push(mesh);
    }
  }

  return meshes;
}

const AUTHORING_PREVIEW_NAME = 'authoring-preview-line';

function updateAuthoringPreview(
  root: THREE.Group | null,
  previewLineRef: React.MutableRefObject<THREE.Line | null>,
  authoringPoints: readonly ControlPoint[],
  closed: boolean,
  activeTool: EditorTool,
) {
  if (!root) {
    return;
  }

  // Remove stale line.
  const previous = previewLineRef.current;
  if (previous) {
    root.remove(previous);
    previous.geometry.dispose();
    (previous.material as THREE.Material).dispose();
    previewLineRef.current = null;
  }

  const visible = activeTool === 'Select' || activeTool === 'Spline';
  if (!visible || authoringPoints.length < 2) {
    return;
  }

  const points = authoringPoints.map(
    (p) => new THREE.Vector3(p.position.x, (p.elevation ?? 0) + 0.6, p.position.y),
  );
  if (closed) {
    const first = authoringPoints[0];
    points.push(new THREE.Vector3(first.position.x, (first.elevation ?? 0) + 0.6, first.position.y));
  }

  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({
      color: 0xfff06b,
      transparent: true,
      opacity: 0.55,
      depthTest: false,
      depthWrite: false,
    }),
  );
  line.name = AUTHORING_PREVIEW_NAME;
  line.renderOrder = 24;
  previewLineRef.current = line;
  root.add(line);
}

function findControlPointPosition(
  document: TrackDocument,
  pointId: string,
): { readonly position: Vector2; readonly elevation: number } | null {
  for (const segment of document.segments) {
    for (const point of [segment.p0, segment.p1, segment.p2, segment.p3]) {
      if (point.id === pointId) {
        return { position: point.position, elevation: point.elevation ?? 0 };
      }
    }
  }

  return null;
}

function createBlueprintGrid(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'blueprint-grid';

  const minor = new THREE.GridHelper(800, 160, 0x0b2741, 0x0b2741);
  minor.position.y = -0.6;
  applyGridMaterial(minor, 0.34);
  group.add(minor);

  const major = new THREE.GridHelper(800, 16, 0x1f5a8a, 0x1f5a8a);
  major.position.y = -0.55;
  applyGridMaterial(major, 0.55);
  group.add(major);

  const xAxis = axisLine(new THREE.Vector3(-400, -0.5, 0), new THREE.Vector3(400, -0.5, 0), 0x22d7ff);
  const zAxis = axisLine(new THREE.Vector3(0, -0.5, -400), new THREE.Vector3(0, -0.5, 400), 0x4aa3ff);
  group.add(xAxis, zAxis);
  return group;
}

function applyGridMaterial(grid: THREE.GridHelper, opacity: number) {
  const material = grid.material as THREE.LineBasicMaterial | THREE.LineBasicMaterial[];
  const apply = (entry: THREE.LineBasicMaterial) => {
    entry.transparent = true;
    entry.opacity = opacity;
    entry.depthWrite = false;
  };
  if (Array.isArray(material)) {
    material.forEach(apply);
  } else {
    apply(material);
  }
}

function axisLine(start: THREE.Vector3, end: THREE.Vector3, color: number): THREE.Line {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([start, end]),
    new THREE.LineBasicMaterial({ color }),
  );
}

function createCarMesh(): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(8, 3, 14),
    new THREE.MeshStandardMaterial({ color: 0x37d7ff, emissive: 0x0b8ed7, emissiveIntensity: 0.45, roughness: 0.42 }),
  );
  body.position.y = 2;
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(3.2, 5, 4),
    new THREE.MeshStandardMaterial({ color: 0xdffaff, emissive: 0x37d7ff, emissiveIntensity: 0.35, roughness: 0.5 }),
  );
  nose.rotation.y = Math.PI / 4;
  nose.position.set(0, 2.1, -8.5);
  group.add(body, nose);
  return group;
}

function updateCarMesh(
  car: THREE.Group,
  document: TrackDocument,
  lookup: StationLookup,
  surface: CompileResult,
  station: number,
) {
  if (lookup.samples.length < 2) {
    return;
  }

  const sample = evaluateStation(document, lookup, station);
  const surfaceSample = sampleTrackSurface(surface, sample.station, 0);
  car.position.set(sample.position.x, surfaceSample.position.y + 0.18, sample.position.y);
  car.rotation.y = Math.atan2(sample.tangent.x, sample.tangent.y);
}

function updateCameraMode(
  cameraMode: 'Orbit' | 'Top' | 'Chase',
  camera: THREE.PerspectiveCamera,
  cameraLocks: ReturnType<typeof createCameraInteractionLocks>,
  car: THREE.Group,
  controls: OrbitControls,
) {
  if (cameraMode === 'Orbit') {
    cameraLocks.unlock('top-view');
    return;
  }

  cameraLocks.lock('top-view');
  if (cameraMode === 'Top') {
    camera.position.set(car.position.x, car.position.y + 280, car.position.z + 0.01);
    camera.lookAt(car.position.x, car.position.y, car.position.z);
    controls.target.copy(car.position);
    return;
  }

  const behind = new THREE.Vector3(Math.sin(car.rotation.y) * -34, 22, Math.cos(car.rotation.y) * -34);
  const desiredPosition = car.position.clone().add(behind);
  const lookTarget = car.position.clone().add(new THREE.Vector3(0, 5, 0));
  camera.position.lerp(desiredPosition, 0.16);
  camera.lookAt(lookTarget);
  controls.target.lerp(lookTarget, 0.16);
}

function addLights(scene: THREE.Scene) {
  scene.add(new THREE.AmbientLight(0x6ca7ff, 0.88));
  const light = new THREE.DirectionalLight(0xdffaff, 1.75);
  light.position.set(80, 190, 80);
  scene.add(light);
  const rim = new THREE.DirectionalLight(0x149cff, 0.8);
  rim.position.set(-140, 80, -120);
  scene.add(rim);
}

function getTransformControlsHelper(transformControls: TransformControls): THREE.Object3D {
  const controlsWithHelper = transformControls as TransformControls & {
    getHelper?: () => THREE.Object3D;
  };
  const helper = controlsWithHelper.getHelper?.() ?? transformControls;
  // Render the gizmo above all scene geometry but below text labels
  // (sprites use renderOrder = 30). depthTest is disabled on every
  // material so handles stay visible even when occluded by the track or
  // terrain.
  helper.renderOrder = 20;
  helper.traverse((child) => {
    child.renderOrder = 20;
    const mesh = child as THREE.Mesh;
    if (!mesh.material) {
      return;
    }
    const apply = (material: THREE.Material) => {
      material.depthTest = false;
      material.depthWrite = false;
      material.transparent = true;
      material.needsUpdate = true;
    };
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach(apply);
    } else {
      apply(mesh.material);
    }
  });
  return helper;
}

function resizeRenderer(
  host: HTMLElement,
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
) {
  const width = Math.max(host.clientWidth, 1);
  const height = Math.max(host.clientHeight, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if ((child as THREE.Sprite).isSprite) {
      // Sprites share a global geometry; texture comes from the sprite
      // cache. Only the material instance is per-sprite, so only that
      // gets disposed. Texture is left alive for cache reuse.
      const sprite = child as THREE.Sprite;
      sprite.material?.dispose();
      return;
    }
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();

    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose());
    } else {
      material?.dispose();
    }
  });
}
