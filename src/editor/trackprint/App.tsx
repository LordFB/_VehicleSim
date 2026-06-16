import {
  Brush,
  ChevronDown,
  CircleCheck,
  Download,
  Eye,
  EyeOff,
  Flag,
  FolderOpen,
  Gauge,
  HelpCircle,
  Layers,
  Library,
  Map as MapIcon,
  Maximize2,
  MousePointer2,
  Mountain,
  Paintbrush,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Scan,
  Send,
  Settings,
  Spline,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyStationValueFalloff,
  applyWidthFalloff,
  createStationLookup,
  evaluateStation,
  evaluateStationValueCurve,
  evaluateTrackWidth,
  findSectorAtStation,
  getDocumentLength,
  nearestStation,
  repairTrackContinuity,
  resolveStructureSpans,
  validateBridges,
  validateCurbs,
  validateRunoffs,
  validateStationValueCurve,
  validateSectors,
  validateTrackWidth,
  validateTunnels,
  type StructureSpan,
  type TrackDocument,
  type TrackWidthSide,
  type CurbInterval,
  type CurbProfileType,
  type ControlPoint,
  type RunoffInterval,
  type StationValueCurve,
  type TrackSide,
  type TunnelInterval,
  type Vector2,
} from '@trackprint/track-core';
import { compileTrackSurface, getSurfaceRegion, sampleTrackSurface, type CompileResult } from '@trackprint/track-compiler';
import {
  applyTerrainBrush,
  applyTerrainMasks,
  appendTerrainBrushStroke,
  createTerrainDocument,
  deriveCorridorBoundary,
  generateBridgePillars,
  generatePortalFill,
  sampleTerrainHeight,
  sampleTerrainHeightBilinear,
  sampleTerrainMaterial,
  validateTerrainBoundary,
  worldToCell,
  type StationRange,
  type StationRangeSet,
  type TerrainBrushFalloff,
  type TerrainBrushSettings,
  type TerrainBrushType,
  type TerrainMeshData,
  type TerrainPoint,
} from '@trackprint/terrain-core';
import { useTerrainMeshWorker } from './useTerrainMeshWorker';
import { ImportLocationDialog, type ImportLocationResult } from './ImportLocationDialog';
import {
  createDataReference,
  createImageReference,
  createLinkReference,
  createNoteReference,
  readFileReference,
  type ReferenceItem,
} from './references';
import { analyzeTrack, initialTelemetry, updateTelemetry, type AnalysisOverlayMode } from './analysis';
import { defaultExportSettings, exportProject, reloadExportPreview, type ExportPreviewStats } from './exportProject';
import {
  compileProjectHash,
  createExampleProject,
  createProject,
  loadProject,
  serializeProject,
  type EditorMode,
} from './project';
import { moveTrackControlPoint } from './trackEditing';
import {
  createVehicleSimTrackFromTrackPrint,
  serializeTrackPrintCollisionSurface,
  serializeTrackPrintSurface,
  serializeTrackPrintTerrainMesh,
} from './vehicleSimExport';
import { saveTrackPrintPreviewTrackForBrowser } from '../../level/trackprintPreviewStorage';
import {
  TRACKPRINT_PACKAGE_EXTENSION,
  TRACKPRINT_PACKAGE_MIME,
  decodeTrackPrintPackage,
  encodeTrackPrintPackage,
  isTrackPrintPackageBytes,
  type TrackPrintPackageAsset,
} from '../../level/trackprintPackage';
import type { TrackDefinition } from '../../level/TrackDefinition';
import { ToolInspector } from './ToolInspector';
import { TrackViewport, type EditorTool, type StationInspection, type TrackDisplayOptions } from './viewport/TrackViewport';

const TOOL_TO_MODE: Record<EditorTool, EditorMode> = {
  Select: 'track',
  Spline: 'track',
  Width: 'track',
  Elevation: 'track',
  Banking: 'track',
  Curbs: 'track',
  Sectors: 'analysis',
  Terrain: 'terrain',
  Paint: 'terrain',
  References: 'track',
  Drive: 'drive',
};

interface EditorSnapshot {
  readonly document: TrackDocument;
  readonly authoringPoints: readonly ControlPoint[];
  readonly terrainSource: ReturnType<typeof createTerrainDocument>;
  readonly selectedPoint: string | null;
}

type BandDraftKind = 'curb' | 'runoff';

interface BandCreationDraft {
  readonly kind: BandDraftKind;
  readonly side: TrackSide;
  readonly startStation: number | null;
  readonly endStation: number | null;
  readonly width: number;
  readonly height: number;
  readonly taperLength: number;
  readonly profile: CurbProfileType;
  readonly materialId: string;
}

function emptyCompileResult(): CompileResult {
  return {
    generatedAtVersion: 1,
    totalLength: 0,
    closed: false,
    stationCuts: [],
    crossSections: [],
    asphalt: {
      positions: new Float32Array(),
      normals: new Float32Array(),
      uvs: new Float32Array(),
      indices: new Uint32Array(),
      materialGroups: [],
      rowMetadata: [],
      rowCount: 0,
    },
    curbs: [],
    runoffs: [],
    structures: [],
  };
}

// Split resolved structure spans into the station-range sets terrain-core
// needs: per-side ranges for skirt suppression (the skewed tunnel mouth means
// left and right walls differ) and a unioned set for terrain carve suppression.
function deriveStructureSuppression(
  spans: readonly StructureSpan[],
  closed: boolean,
  totalLength: number,
): { readonly left: StationRangeSet; readonly right: StationRangeSet; readonly union: StationRangeSet } {
  const left: StationRange[] = [];
  const right: StationRange[] = [];
  const union: StationRange[] = [];
  for (const span of spans) {
    left.push({ start: span.left.start, end: span.left.end });
    right.push({ start: span.right.start, end: span.right.end });
    union.push({ start: span.startStation, end: span.endStation });
  }
  return {
    left: { ranges: left, closed, totalLength },
    right: { ranges: right, closed, totalLength },
    union: { ranges: union, closed, totalLength },
  };
}

function emptyAnalysis() {
  return {
    samples: [],
    curvatureRange: [0, 0] as const,
    gradeRange: [0, 0] as const,
    bankingRange: [0, 0] as const,
    peakStations: [],
    straightStations: [],
  };
}

export function App() {
  const [document, setDocument] = useState<TrackDocument>(() => createConceptTrackDocument());
  const [authoringPoints, setAuthoringPoints] = useState<ControlPoint[]>(() =>
    anchorPointsFromDocument(createConceptTrackDocument()),
  );
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState(28);
  const [station, setStation] = useState(0);
  const [hoverStation, setHoverStation] = useState<number | null>(null);
  const [stationInspection, setStationInspection] = useState<StationInspection | null>(null);
  const [cameraMode, setCameraMode] = useState<'Orbit' | 'Top' | 'Chase'>('Orbit');
  const [terrainSource, setTerrainSource] = useState(() =>
    createTerrainDocument({
      origin: { x: -400, z: -400 },
      size: { width: 800, depth: 800 },
      resolution: { columns: 201, rows: 201 },
      defaultMaterial: 'grass',
    }),
  );
  // Terrain sculpting (height) and material painting are two distinct tools, so
  // they carry independent brush settings. Sharing one state previously let a
  // height brush type (e.g. 'raise') leak into the Paint tool and vice versa,
  // so the type displayed and the brush actually applied could disagree.
  // Keeping a brush per discipline guarantees the type always matches the work.
  const [modifyBrush, setModifyBrush] = useState<TerrainBrushSettings & { readonly active: boolean }>({
    active: false,
    type: 'raise',
    radius: 18,
    strength: 0.8,
    falloff: 'smooth',
    targetHeight: 0,
  });
  const [paintBrush, setPaintBrush] = useState<TerrainBrushSettings & { readonly active: boolean }>({
    active: false,
    type: 'material',
    radius: 18,
    strength: 1,
    falloff: 'constant',
    targetMaterial: 'gravel',
  });
  // The standalone Terrain sidebar can drive either brush; this tracks which
  // discipline its Type dropdown currently targets ('material' → paint brush,
  // any height type → modify brush).
  const [sidebarBrushType, setSidebarBrushType] = useState<TerrainBrushType>('raise');
  const [terrainCursor, setTerrainCursor] = useState<TerrainPoint | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  // Live satellite imagery draped over imported terrain. Held in editor state
  // (not serialized in the saved document) — the canvas can be large.
  const [imageryCanvas, setImageryCanvas] = useState<HTMLCanvasElement | null>(null);
  // Reference material the author attaches to guide track creation (image
  // files, data/links, notes). Authoring aid only; not part of the compiled
  // track/terrain.
  const [references, setReferences] = useState<readonly ReferenceItem[]>([]);
  const [referenceError, setReferenceError] = useState('');
  const [curbDraft, setCurbDraft] = useState({
    side: 'left' as TrackSide,
    startStation: 0,
    endStation: 140,
    width: 1.2,
    height: 0.15,
    taperLength: 8,
    profile: 'raised' as CurbProfileType,
    materialId: 'curb-red-white',
  });
  const [runoffDraft, setRunoffDraft] = useState({
    side: 'left' as TrackSide,
    startStation: 0,
    endStation: 140,
    width: 4,
    taperLength: 8,
    materialId: 'painted-runoff',
  });
  const [display, setDisplay] = useState<TrackDisplayOptions>({
    asphalt: true,
    centerline: true,
    edges: true,
    wireframe: false,
    terrain: true,
    terrainWireframe: false,
    terrainImagery: true,
    corridorMask: false,
    skirtMask: false,
    seams: true,
    structures: true,
  });
  const [mode, setMode] = useState<EditorMode>('track');
  const [activeTool, setActiveTool] = useState<EditorTool>('Select');
  // Painting and sculpting are separate disciplines with separate brushes. The
  // ToolInspector picks the brush from the active tool (Paint → material brush,
  // anything else → height brush). The standalone Terrain sidebar instead picks
  // by the brush *type* the user has selected, so choosing "material" there
  // edits and applies the paint brush even outside the Paint tool. Either way
  // the type shown and the brush applied stay in lockstep — the old tangle.
  const isPaintTool = activeTool === 'Paint';
  const terrainBrush = isPaintTool ? paintBrush : modifyBrush;
  const setTerrainBrush = isPaintTool ? setPaintBrush : setModifyBrush;
  // Type-driven selection for the standalone sidebar panel.
  const sidebarBrush = sidebarBrushType === 'material' ? paintBrush : modifyBrush;
  const setSidebarBrush = sidebarBrushType === 'material' ? setPaintBrush : setModifyBrush;

  function selectTool(tool: EditorTool) {
    setActiveTool(tool);
    setMode(TOOL_TO_MODE[tool]);
    if (tool !== 'Curbs') {
      setSelectedBand(null);
    }
  }
  const [analysisOverlay, setAnalysisOverlay] = useState<AnalysisOverlayMode>('solid');
  const [overlayOpacity, setOverlayOpacity] = useState(0.65);
  const [widthFalloff, setWidthFalloff] = useState(40);
  const [bankingFalloff, setBankingFalloff] = useState(40);
  const [telemetry, setTelemetry] = useState(() => initialTelemetry());
  const [undoStack, setUndoStack] = useState<EditorSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<EditorSnapshot[]>([]);
  const [projectJson, setProjectJson] = useState('');
  const [saveStatus, setSaveStatus] = useState('Unsaved');
  const [loadError, setLoadError] = useState('');
  const [exportPreview, setExportPreview] = useState<ExportPreviewStats | null>(null);
  const [bandCreationDraft, setBandCreationDraft] = useState<BandCreationDraft | null>(null);
  const [bandPickTarget, setBandPickTarget] = useState<'startStation' | 'endStation' | null>(null);
  const projectFileInputRef = useRef<HTMLInputElement | null>(null);
  // The curb/runoff currently selected for editing in the Curbs tool. `kind`
  // disambiguates because curb and runoff ids live in separate arrays.
  const [selectedBand, setSelectedBand] = useState<{ readonly kind: BandDraftKind; readonly id: string } | null>(null);
  const isBandPicking = bandCreationDraft !== null && bandPickTarget !== null;

  const lookup = useMemo(() => createStationLookup(document, 128), [document]);
  const displayDocument = useMemo(() => repairTrackContinuity(document), [document]);
  const surface = useMemo(
    () => (lookup.samples.length === 0 ? emptyCompileResult() : compileTrackSurface(displayDocument, lookup, 384)),
    [displayDocument, lookup],
  );
  const corridorBoundary = useMemo(() => deriveCorridorBoundary(surface), [surface]);
  // Bridges/tunnels: resolve authored spans, then derive the per-side skirt
  // suppression and the unioned terrain-carve suppression. The terrain mesh and
  // skirt must NOT carve/ramp over a structure span — the valley shows under a
  // bridge and the mountain stays closed over a tunnel bore.
  const structureSpans = useMemo(() => resolveStructureSpans(displayDocument, lookup), [displayDocument, lookup]);
  const structureSuppress = useMemo(
    () => deriveStructureSuppression(structureSpans, lookup.closed, lookup.totalLength),
    [structureSpans, lookup.closed, lookup.totalLength],
  );
  const terrainOriginX = terrainSource.origin.x;
  const terrainOriginZ = terrainSource.origin.z;
  const terrainWidth = terrainSource.size.width;
  const terrainDepth = terrainSource.size.depth;
  const terrainColumns = terrainSource.resolution.columns;
  const terrainRows = terrainSource.resolution.rows;
  const terrainMasks = useMemo(
    () =>
      applyTerrainMasks(
        {
          id: terrainSource.id,
          version: 1,
          origin: { x: terrainOriginX, z: terrainOriginZ },
          size: { width: terrainWidth, depth: terrainDepth },
          resolution: { columns: terrainColumns, rows: terrainRows },
          heights: [],
          materials: [],
          masks: [],
          brushStrokes: [],
        },
        corridorBoundary,
        { blendWidth: 26 },
        structureSuppress.union,
      ).masks,
    [corridorBoundary, structureSuppress.union, terrainColumns, terrainDepth, terrainOriginX, terrainOriginZ, terrainRows, terrainSource.id, terrainWidth],
  );
  const terrain = useMemo(
    () => ({ ...terrainSource, masks: terrainMasks }),
    [terrainMasks, terrainSource],
  );
  const { terrainMesh, skirtMesh } = useTerrainMeshWorker(terrain, corridorBoundary, {
    blendWidth: 26,
    skirtSubdivisions: 10,
    suppressLeft: structureSuppress.left,
    suppressRight: structureSuppress.right,
  });
  // Pillars and portal-to-terrain fill need the heightfield, so they are
  // resolved here (App holds both terrain and surface.structures). Coarse and
  // cheap; kept synchronous per the plan, move into the worker only if slow.
  const bridgePillars = useMemo<TerrainMeshData | null>(
    () => (surface.structures.length > 0 ? generateBridgePillars(terrain, surface.structures) : null),
    [surface.structures, terrain],
  );
  const portalFill = useMemo<TerrainMeshData | null>(
    () => (surface.structures.length > 0 ? generatePortalFill(terrain, surface.structures) : null),
    [surface.structures, terrain],
  );
  const hasCompiledTrack = lookup.samples.length >= 2;
  const widthIssues = useMemo(() => (hasCompiledTrack ? validateTrackWidth(displayDocument, lookup) : []), [displayDocument, hasCompiledTrack, lookup]);
  const sectorIssues = useMemo(() => (hasCompiledTrack ? validateSectors(displayDocument, lookup) : []), [displayDocument, hasCompiledTrack, lookup]);
  const curbIssues = useMemo(() => (hasCompiledTrack ? validateCurbs(displayDocument, lookup) : []), [displayDocument, hasCompiledTrack, lookup]);
  const runoffIssues = useMemo(() => (hasCompiledTrack ? validateRunoffs(displayDocument, lookup) : []), [displayDocument, hasCompiledTrack, lookup]);
  const tunnelIssues = useMemo(() => (hasCompiledTrack ? validateTunnels(displayDocument, lookup) : []), [displayDocument, hasCompiledTrack, lookup]);
  const bridgeIssues = useMemo(() => (hasCompiledTrack ? validateBridges(displayDocument, lookup) : []), [displayDocument, hasCompiledTrack, lookup]);
  const terrainIssues = useMemo(
    () =>
      validateTerrainBoundary(
        {
          id: terrainSource.id,
          version: 1,
          origin: { x: terrainOriginX, z: terrainOriginZ },
          size: { width: terrainWidth, depth: terrainDepth },
          resolution: { columns: terrainColumns, rows: terrainRows },
          heights: [],
          materials: [],
          masks: [],
          brushStrokes: [],
        },
        corridorBoundary,
        { blendWidth: 26 },
      ),
    [
      corridorBoundary,
      terrainColumns,
      terrainDepth,
      terrainOriginX,
      terrainOriginZ,
      terrainRows,
      terrainSource.id,
      terrainWidth,
    ],
  );
  const surfaceIssues = useMemo(
    () => hasCompiledTrack ? [
      ...validateStationValueCurve('Elevation', displayDocument.elevation, lookup),
      ...validateStationValueCurve('Banking', displayDocument.banking, lookup, {
        maxAbsValue: Math.PI / 3,
        unitLabel: ' rad',
      }),
    ] : [],
    [displayDocument, hasCompiledTrack, lookup],
  );
  const totalLength = getDocumentLength(lookup);
  const carSample = hasCompiledTrack
    ? evaluateStation(displayDocument, lookup, station)
    : {
        station: 0,
        segmentIndex: 0,
        segmentId: '',
        t: 0,
        position: { x: 0, y: 0 },
        tangent: { x: 1, y: 0 },
        normal: { x: 0, y: 1 },
      };
  const carSurface = hasCompiledTrack
    ? sampleTrackSurface(surface, carSample.station, 0)
    : { station: 0, lateralOffset: 0, position: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } };
  const carRegion = hasCompiledTrack
    ? getSurfaceRegion(displayDocument, lookup, carSample.position)
    : { region: 'outside' as const, validLap: false };
  const inspectedRegion = stationInspection
    ? getSurfaceRegion(
        displayDocument,
        lookup,
        pointAtStationOffset(displayDocument, lookup, stationInspection.station, stationInspection.lateralOffset),
      )
    : null;
  const currentSector = hasCompiledTrack ? findSectorAtStation(displayDocument, lookup, station) : null;
  const analysis = useMemo(() => (hasCompiledTrack ? analyzeTrack(displayDocument, lookup, 128) : emptyAnalysis()), [displayDocument, hasCompiledTrack, lookup]);
  const activeDelta = currentSector ? telemetry.currentSectorDeltas[currentSector.id] : undefined;
  // Hash is a stringify of the whole project including the terrain heights
  // grid (~40k cells), which is expensive. Deferring its inputs marks the
  // recompute as a low-priority render so it can't block direct
  // manipulation (control-point drag, brush stroke).
  const deferredDoc = useDeferredValue(displayDocument);
  const deferredTerrain = useDeferredValue(terrainSource);
  const projectHash = useMemo(
    () => (hasCompiledTrack ? compileProjectHash(createProject(deferredDoc, deferredTerrain, { selectedPoint, mode })) : 'blank'),
    [deferredDoc, hasCompiledTrack, mode, selectedPoint, deferredTerrain],
  );
  const leftWidth = document.width?.left.constant ?? 6;
  const rightWidth = document.width?.right.constant ?? 6;
  // Width sampled at the inspected station — what the Width tool's falloff
  // edit is centered on, so the sliders show the value being changed.
  const inspectedWidth = useMemo(
    () =>
      hasCompiledTrack && stationInspection
        ? evaluateTrackWidth(displayDocument, lookup, stationInspection.station)
        : { left: leftWidth, right: rightWidth, total: leftWidth + rightWidth, station: 0 },
    [displayDocument, hasCompiledTrack, leftWidth, lookup, rightWidth, stationInspection],
  );
  const elevationKey = document.elevation?.keys[0]?.value ?? 0;
  const bankingKeyDegrees = ((document.banking?.keys[0]?.value ?? 0) * 180) / Math.PI;
  const inspectedBankingDegrees = useMemo(
    () =>
      hasCompiledTrack && stationInspection
        ? (evaluateStationValueCurve(displayDocument.banking, lookup, stationInspection.station) * 180) / Math.PI
        : bankingKeyDegrees,
    [bankingKeyDegrees, displayDocument.banking, hasCompiledTrack, lookup, stationInspection],
  );
  const curbCount = document.curbs?.length ?? 0;
  const runoffCount = document.runoffs?.length ?? 0;
  const tunnels = document.tunnels ?? [];
  const projectDisplayName = formatProjectName(document.id);
  const elevationStats = useMemo(() => summarizeElevation(document.elevation?.keys ?? []), [document.elevation]);
  const bankingDegrees = useMemo(
    () => (document.banking?.keys ?? []).map((key) => (key.value * 180) / Math.PI),
    [document.banking],
  );
  const bankingPeakDegrees = bankingDegrees.length === 0 ? 0 : Math.max(...bankingDegrees.map(Math.abs));
  const totalIssueCount =
    widthIssues.length +
    sectorIssues.length +
    surfaceIssues.length +
    curbIssues.length +
    runoffIssues.length +
    tunnelIssues.length +
    bridgeIssues.length +
    terrainIssues.length;
  const compileStatus: 'ok' | 'warn' = totalIssueCount === 0 ? 'ok' : 'warn';
  const headingDegrees = ((Math.atan2(carSample.tangent.x, carSample.tangent.y) * 180) / Math.PI + 360) % 360;
  const lapTimeLabel = formatLapTime(telemetry.samples.length / 60);
  const hoveredTerrainCell = terrainCursor ? worldToCell(terrain, terrainCursor) : null;
  const hoveredTerrainIndex = hoveredTerrainCell
    ? hoveredTerrainCell.row * terrain.resolution.columns + hoveredTerrainCell.column
    : -1;
  const hoveredTerrainMask = hoveredTerrainIndex >= 0 ? terrain.masks[hoveredTerrainIndex] : null;
  const hoveredTerrainHeight = terrainCursor ? sampleTerrainHeight(terrain, terrainCursor) : null;
  const hoveredTerrainMaterial = terrainCursor ? sampleTerrainMaterial(terrain, terrainCursor) : null;
  const controlPoints = authoringPoints;
  const selectedControlPoint = selectedPoint
    ? controlPoints.find((point) => point.id === selectedPoint) ?? null
    : null;
  const selectedControlStation = selectedControlPoint
    ? nearestStationIfAvailable(displayDocument, lookup, selectedControlPoint.position)
    : null;
  const selectedLeftWidth = selectedControlStation === null
    ? leftWidth
    : widthAtStation(document.width?.left, selectedControlStation, leftWidth);
  const selectedRightWidth = selectedControlStation === null
    ? rightWidth
    : widthAtStation(document.width?.right, selectedControlStation, rightWidth);
  const selectedBankingDegrees = selectedControlStation === null
    ? bankingKeyDegrees
    : valueAtStation(document.banking, selectedControlStation, 0) * 180 / Math.PI;

  function snapshot(): EditorSnapshot {
    return { document, authoringPoints, terrainSource, selectedPoint };
  }

  function commitHistory() {
    setUndoStack((current) => [...current.slice(-31), snapshot()]);
    setRedoStack([]);
    setSaveStatus('Unsaved changes');
  }

  function restoreSnapshot(editorSnapshot: EditorSnapshot) {
    setDocument(editorSnapshot.document);
    setAuthoringPoints([...editorSnapshot.authoringPoints]);
    setTerrainSource(editorSnapshot.terrainSource);
    setSelectedPoint(editorSnapshot.selectedPoint);
    // Imagery isn't part of the serialized snapshot; drop it when the restored
    // terrain is no longer geo-anchored so a stale aerial doesn't linger.
    if (!editorSnapshot.terrainSource.geo) {
      setImageryCanvas(null);
    }
  }

  function undoLastEdit() {
    const previous = undoStack.at(-1);
    if (!previous) {
      return;
    }
    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => [...current.slice(-31), snapshot()]);
    restoreSnapshot(previous);
    setSaveStatus('Undo');
  }

  function redoLastEdit() {
    const next = redoStack.at(-1);
    if (!next) {
      return;
    }
    setRedoStack((current) => current.slice(0, -1));
    setUndoStack((current) => [...current.slice(-31), snapshot()]);
    restoreSnapshot(next);
    setSaveStatus('Redo');
  }

  function createNewTrack() {
    commitHistory();
    setAuthoringPoints([]);
    setDocument(createBlankTrackDocument(false));
    setTerrainSource(createTerrainDocument({
      origin: { x: -160, z: -160 },
      size: { width: 320, depth: 320 },
      resolution: { columns: 65, rows: 65 },
      defaultMaterial: 'grass',
    }));
    setImageryCanvas(null);
    setSelectedPoint(null);
    setStation(0);
    setStationInspection(null);
    setSaveStatus('New track');
  }

  function addControlPoint() {
    const index = authoringPoints.length + 1;
    const last = authoringPoints.at(-1);
    const point = {
      id: `p-${index}`,
      position: last ? { x: last.position.x + 42, y: last.position.y } : { x: -80, y: 0 },
      elevation: last?.elevation ?? 0,
    };
    const nextPoints = [...authoringPoints, point];
    commitHistory();
    setAuthoringPoints(nextPoints);
    setDocument(rebuildTrackFromAnchors(document, nextPoints, document.closed));
    setSelectedPoint(point.id);
  }

  function addControlPointAtPosition(position: Vector2) {
    const index = authoringPoints.length + 1;
    // Snap the new anchor to the terrain surface under it so spline points placed
    // over real-world (or sculpted) terrain sit on the ground, not at y=0.
    const elevation = sampleTerrainHeightBilinear(terrain, { x: position.x, z: position.y });
    const point = { id: `p-${index}`, position, elevation };
    const nextPoints = [...authoringPoints, point];
    commitHistory();
    setAuthoringPoints(nextPoints);
    setDocument(rebuildTrackFromAnchors(document, nextPoints, document.closed));
    setSelectedPoint(point.id);
  }

  function updateLooping(looping: boolean) {
    commitHistory();
    // Rebuild from the latest anchors (read inside the setter) so the closing
    // segment is added/removed correctly even when looping is toggled right
    // after a point was placed — avoids rebuilding from a stale anchor list.
    setAuthoringPoints((current) => {
      setDocument((doc) => rebuildTrackFromAnchors(doc, current, looping));
      return current;
    });
  }

  function moveControlPoint(pointId: string, position: Vector2, elevation?: number) {
    commitHistory();
    setAuthoringPoints((current) =>
      current.map((point) =>
        point.id === pointId
          ? { ...point, position, elevation: elevation ?? point.elevation }
          : point,
      ),
    );
    setDocument((current) => moveTrackControlPoint(current, pointId, position, elevation));
  }

  // Live drag updates the anchor positions only — the heavy surface +
  // terrain recompile runs once on pointer-up via moveControlPoint.
  function previewMoveControlPoint(pointId: string, position: Vector2, elevation?: number) {
    setAuthoringPoints((current) =>
      current.map((point) =>
        point.id === pointId
          ? { ...point, position, elevation: elevation ?? point.elevation }
          : point,
      ),
    );
  }

  function updateSelectedControlPoint(axis: 'x' | 'y' | 'elevation', value: number) {
    if (!selectedControlPoint) {
      return;
    }

    const nextPosition =
      axis === 'x'
        ? { ...selectedControlPoint.position, x: value }
        : axis === 'y'
          ? { ...selectedControlPoint.position, y: value }
          : selectedControlPoint.position;
    const nextPoints = authoringPoints.map((point) =>
      point.id === selectedControlPoint.id
        ? { ...point, position: nextPosition, elevation: axis === 'elevation' ? value : selectedControlPoint.elevation }
        : point,
    );
    commitHistory();
    setAuthoringPoints(nextPoints);
    setDocument(rebuildTrackFromAnchors(document, nextPoints, document.closed));
  }

  function updateWidth(side: 'left' | 'right', value: number) {
    commitHistory();
    setDocument((current) => ({
      ...current,
      width: {
        left: current.width?.left ?? { constant: 6 },
        right: current.width?.right ?? { constant: 6 },
        [side]: { constant: value },
      },
    }));
  }

  // Width tool: edit a side over a station window centered on the inspected
  // station, easing back to the prior width at `widthFalloff` meters either
  // side. No-op until the user has inspected a station in the viewport.
  function updateWidthWithFalloff(side: 'left' | 'right', value: number) {
    const center = stationInspection?.station ?? null;
    if (center === null) {
      return;
    }
    commitHistory();
    setDocument((current) => {
      const currentWidth = current.width ?? { left: { constant: 6 }, right: { constant: 6 } };
      return {
        ...current,
        width: {
          ...currentWidth,
          [side]: applyWidthFalloff(currentWidth[side], lookup, center, value, widthFalloff),
        },
      };
    });
  }

  function toggleDisplay(key: keyof TrackDisplayOptions) {
    setDisplay((current) => ({ ...current, [key]: !current[key] }));
  }

  function updateElevation(value: number) {
    commitHistory();
    setDocument((current) => ({
      ...current,
      elevation: { keys: [{ station: 0, value }] },
    }));
  }

  function updateBankingDegrees(value: number) {
    commitHistory();
    setDocument((current) => ({
      ...current,
      banking: { keys: [{ station: 0, value: (value * Math.PI) / 180 }] },
    }));
  }

  // Banking tool: edit banking over a station window centered on the inspected
  // station, easing back to the prior banking at `bankingFalloff` meters either
  // side. No-op until a station is inspected. Value is in degrees.
  function updateBankingWithFalloff(valueDegrees: number) {
    const center = stationInspection?.station ?? null;
    if (center === null) {
      return;
    }
    commitHistory();
    setDocument((current) => ({
      ...current,
      banking: applyStationValueFalloff(
        current.banking,
        lookup,
        center,
        (valueDegrees * Math.PI) / 180,
        bankingFalloff,
      ),
    }));
  }

  function updateWidthAtSelectedPoint(side: 'left' | 'right', value: number) {
    if (selectedControlStation === null) {
      updateWidth(side, value);
      return;
    }

    commitHistory();
    setDocument((current) => {
      const currentWidth = current.width ?? { left: { constant: 6 }, right: { constant: 6 } };
      return {
        ...current,
        width: {
          ...currentWidth,
          [side]: upsertStationKey(currentWidth[side], selectedControlStation, value),
        },
      };
    });
  }

  function updateBankingAtSelectedPoint(valueDegrees: number) {
    if (selectedControlStation === null) {
      updateBankingDegrees(valueDegrees);
      return;
    }

    commitHistory();
    setDocument((current) => ({
      ...current,
      banking: upsertStationValueKey(current.banking, selectedControlStation, (valueDegrees * Math.PI) / 180),
    }));
  }

  function cycleCameraMode() {
    setCameraMode((mode) => (mode === 'Orbit' ? 'Top' : mode === 'Top' ? 'Chase' : 'Orbit'));
  }

  function addDefaultCurb() {
    commitHistory();
    setDocument((current) => ({
      ...current,
      curbs: [
        ...(current.curbs ?? []),
        {
          id: `curb-${(current.curbs?.length ?? 0) + 1}`,
          ...curbDraft,
        },
      ],
    }));
  }

  function addDefaultRunoff() {
    commitHistory();
    setDocument((current) => ({
      ...current,
      runoffs: [
        ...(current.runoffs ?? []),
        {
          id: `runoff-${(current.runoffs?.length ?? 0) + 1}`,
          ...runoffDraft,
        },
      ],
    }));
  }

  function beginBandCreation(kind: BandDraftKind) {
    const source = kind === 'curb' ? curbDraft : runoffDraft;
    const startStation = stationInspection?.station ?? station;
    setBandPickTarget(null);
    setBandCreationDraft({
      kind,
      side: source.side,
      startStation,
      endStation: Math.min(startStation + 80, totalLength),
      width: source.width,
      height: kind === 'curb' ? curbDraft.height : 0,
      taperLength: source.taperLength,
      profile: kind === 'curb' ? curbDraft.profile : 'flat',
      materialId: source.materialId,
    });
  }

  function cancelBandCreation() {
    setBandPickTarget(null);
    setBandCreationDraft(null);
  }

  function handleStationInspectionChange(inspection: StationInspection | null) {
    setStationInspection(inspection);
    if (!inspection || !bandPickTarget) {
      return;
    }

    setBandCreationDraft((current) =>
      current
        ? {
            ...current,
            [bandPickTarget]: inspection.station,
            side: inspection.lateralOffset >= 0 ? 'left' : 'right',
          }
        : current,
    );
    setBandPickTarget(null);
  }

  function saveBandCreation() {
    if (!bandCreationDraft || bandCreationDraft.startStation === null || bandCreationDraft.endStation === null) {
      return;
    }

    const startStation = Math.min(bandCreationDraft.startStation, bandCreationDraft.endStation);
    const endStation = Math.max(bandCreationDraft.startStation, bandCreationDraft.endStation);
    commitHistory();
    if (bandCreationDraft.kind === 'curb') {
      setDocument((current) => ({
        ...current,
        curbs: [
          ...(current.curbs ?? []),
          {
            id: `curb-${(current.curbs?.length ?? 0) + 1}`,
            side: bandCreationDraft.side,
            startStation,
            endStation,
            width: bandCreationDraft.width,
            height: bandCreationDraft.height,
            taperLength: bandCreationDraft.taperLength,
            profile: bandCreationDraft.profile,
            materialId: bandCreationDraft.materialId,
          },
        ],
      }));
    } else {
      setDocument((current) => ({
        ...current,
        runoffs: [
          ...(current.runoffs ?? []),
          {
            id: `runoff-${(current.runoffs?.length ?? 0) + 1}`,
            side: bandCreationDraft.side,
            startStation,
            endStation,
            width: bandCreationDraft.width,
            taperLength: bandCreationDraft.taperLength,
            materialId: bandCreationDraft.materialId,
          },
        ],
      }));
    }
    setBandCreationDraft(null);
  }

  function updateCurb(id: string, patch: Partial<Omit<CurbInterval, 'id'>>) {
    commitHistory();
    setDocument((current) => ({
      ...current,
      curbs: (current.curbs ?? []).map((curb) => (curb.id === id ? { ...curb, ...patch } : curb)),
    }));
  }

  function updateRunoff(id: string, patch: Partial<Omit<RunoffInterval, 'id'>>) {
    commitHistory();
    setDocument((current) => ({
      ...current,
      runoffs: (current.runoffs ?? []).map((runoff) => (runoff.id === id ? { ...runoff, ...patch } : runoff)),
    }));
  }

  function removeBand(kind: BandDraftKind, id: string) {
    commitHistory();
    setDocument((current) =>
      kind === 'curb'
        ? { ...current, curbs: (current.curbs ?? []).filter((curb) => curb.id !== id) }
        : { ...current, runoffs: (current.runoffs ?? []).filter((runoff) => runoff.id !== id) },
    );
    setSelectedBand((selected) => (selected?.kind === kind && selected.id === id ? null : selected));
  }

  // Add a tunnel over a default window centered on the current station. Both
  // walls start aligned; the per-side stations can then be edited to skew the
  // portal mouth.
  function addTunnel() {
    commitHistory();
    const length = getDocumentLength(lookup);
    const half = Math.min(Math.max(length * 0.1, 10), Math.max(length / 2 - 1, 1));
    const center = station;
    const start = Math.max(center - half, 0);
    const end = Math.min(center + half, length);
    setDocument((current) => ({
      ...current,
      tunnels: [
        ...(current.tunnels ?? []),
        {
          id: `tunnel-${(current.tunnels?.length ?? 0) + 1}`,
          leftStartStation: start,
          leftEndStation: end,
          rightStartStation: start,
          rightEndStation: end,
          width: 12,
          height: 6,
          materialId: 'concrete',
        },
      ],
    }));
  }

  function updateTunnel(id: string, patch: Partial<Omit<TunnelInterval, 'id'>>) {
    commitHistory();
    setDocument((current) => ({
      ...current,
      tunnels: (current.tunnels ?? []).map((tunnel) => (tunnel.id === id ? { ...tunnel, ...patch } : tunnel)),
    }));
  }

  function removeTunnel(id: string) {
    commitHistory();
    setDocument((current) => ({
      ...current,
      tunnels: (current.tunnels ?? []).filter((tunnel) => tunnel.id !== id),
    }));
  }

  // Toggle a segment's bridge flag. The bridged segment's station range carries
  // a deck underside + pillars and suppresses the terrain skirt automatically.
  function toggleSegmentBridge(segmentId: string) {
    commitHistory();
    setDocument((current) => ({
      ...current,
      segments: current.segments.map((segment) =>
        segment.id === segmentId ? { ...segment, bridge: !segment.bridge } : segment,
      ),
    }));
  }

  // Snapshot history once at the start of an endpoint drag, so the whole drag
  // collapses into a single undo entry and the pre-drag band positions are
  // preserved (the live preview below mutates the document directly).
  function beginBandEndpointDrag() {
    commitHistory();
  }

  // Endpoint drag: clamp the moved end to the track and keep it from crossing
  // the other end. Called per drag frame and once more on release; history was
  // already snapshotted at drag start via beginBandEndpointDrag.
  function moveBandEndpoint(
    kind: BandDraftKind,
    id: string,
    endpoint: 'startStation' | 'endStation',
    station: number,
  ) {
    const clamped = Math.min(Math.max(station, 0), totalLength);
    const minGap = 0.5;
    const apply = <T extends CurbInterval | RunoffInterval>(band: T): T => {
      if (band.id !== id) {
        return band;
      }
      // Don't let the dragged end pass the other; keep a small minimum span.
      const value =
        endpoint === 'startStation'
          ? Math.min(clamped, band.endStation - minGap)
          : Math.max(clamped, band.startStation + minGap);
      return { ...band, [endpoint]: value };
    };
    setDocument((current) =>
      kind === 'curb'
        ? { ...current, curbs: (current.curbs ?? []).map(apply) }
        : { ...current, runoffs: (current.runoffs ?? []).map(apply) },
    );
  }

  function updateTrackLimit(key: 'curbIsValid' | 'runoffIsValid', value: boolean) {
    commitHistory();
    setDocument((current) => ({
      ...current,
      limits: {
        curbIsValid: current.limits?.curbIsValid ?? true,
        runoffIsValid: current.limits?.runoffIsValid ?? false,
        [key]: value,
      },
    }));
  }

  function importRealWorldLocation(result: ImportLocationResult) {
    // One undo entry for the whole import; replaces the terrain document and
    // captures the satellite canvas so the viewport can drape it.
    commitHistory();
    setTerrainSource(result.terrain);
    setImageryCanvas(result.imagery.canvas);

    // Also keep the fetched data as reference material: the satellite image and
    // the elevation grid (with its geo anchor) so the author can re-consult or
    // re-trace the source even after editing the terrain.
    const geo = result.terrain.geo;
    const label = geo
      ? `Location ${geo.centerLat.toFixed(4)}, ${geo.centerLon.toFixed(4)}`
      : 'Imported location';
    const newReferences: ReferenceItem[] = [];
    try {
      newReferences.push(
        createImageReference(result.imagery.canvas.toDataURL('image/png'), `${label} — satellite`),
      );
    } catch {
      // toDataURL can throw if the imagery tiles tainted the canvas (CORS);
      // skip the image reference but still keep the elevation data below.
    }
    newReferences.push(
      createDataReference(
        JSON.stringify({
          geo,
          resolution: result.terrain.resolution,
          size: result.terrain.size,
          heights: result.terrain.heights,
        }),
        `${label} — elevation grid`,
        'Real-world elevation height grid (meters, lowest point ≈ 0).',
      ),
    );
    setReferences((current) => [...current, ...newReferences]);

    setImportDialogOpen(false);
  }

  async function addReferenceFiles(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }
    setReferenceError('');
    try {
      const loaded = await Promise.all(Array.from(files).map(readFileReference));
      setReferences((current) => [...current, ...loaded]);
    } catch (error) {
      setReferenceError(error instanceof Error ? error.message : 'Could not add file.');
    }
  }

  function addReferenceLink(url: string, name?: string) {
    if (!url.trim()) {
      return;
    }
    setReferences((current) => [...current, createLinkReference(url, name)]);
  }

  function addReferenceNote(body: string, name?: string) {
    if (!body.trim()) {
      return;
    }
    setReferences((current) => [...current, createNoteReference(body, name)]);
  }

  function removeReference(id: string) {
    setReferences((current) => current.filter((reference) => reference.id !== id));
  }

  function applyBrushStroke(point: TerrainPoint, brush: TerrainBrushSettings = terrainBrush) {
    commitHistory();
    setTerrainSource((current) => {
      const edited = applyTerrainBrush({ ...current, masks: terrainMasks }, point, brush);
      return appendTerrainBrushStroke(edited, {
        id: `brush-${edited.brushStrokes.length + 1}`,
        type: brush.type,
        points: [point],
        radius: brush.radius,
        strength: brush.strength,
        falloff: brush.falloff,
        targetHeight: brush.targetHeight,
        targetMaterial: brush.targetMaterial,
        timestamp: Date.now(),
      });
    });
  }

  function updateTerrainBrush<K extends keyof TerrainBrushSettings>(key: K, value: TerrainBrushSettings[K]) {
    setTerrainBrush((current) => ({ ...current, [key]: value }));
  }

  // The sidebar's Type dropdown both records which discipline it targets and
  // writes the type onto that brush, so picking "material" switches the sidebar
  // to the paint brush and stamps its type in one step.
  function updateSidebarBrush<K extends keyof TerrainBrushSettings>(key: K, value: TerrainBrushSettings[K]) {
    if (key === 'type') {
      const nextType = value as TerrainBrushType;
      setSidebarBrushType(nextType);
      const setter = nextType === 'material' ? setPaintBrush : setModifyBrush;
      setter((current) => ({ ...current, type: nextType }));
      return;
    }
    setSidebarBrush((current) => ({ ...current, [key]: value }));
  }

  function saveProject() {
    const project = createProject(document, terrainSource, { selectedPoint, mode });
    const serialized = serializeProject(project);
    setProjectJson(serialized);
    setSaveStatus(`Saved ${compileProjectHash(project)}`);
  }

  async function downloadProject() {
    const project = createProject(document, terrainSource, { selectedPoint, mode });
    const asset = await terrainTextureAssetFromCanvas(imageryCanvas);
    const bytes = encodeTrackPrintPackage({
      project,
      track: createCompiledVehicleSimTrack(formatProjectName(document.id)),
      assets: asset ? [asset] : [],
    });
    setProjectJson(serializeProject(project));
    const url = URL.createObjectURL(new Blob([arrayBufferFromBytes(bytes)], { type: TRACKPRINT_PACKAGE_MIME }));
    const link = window.document.createElement('a');
    link.href = url;
    link.download = `${document.id || 'trackprint'}${TRACKPRINT_PACKAGE_EXTENSION}`;
    link.click();
    URL.revokeObjectURL(url);
    setSaveStatus(`Downloaded ${compileProjectHash(project)}${asset ? ' with texture' : ''}`);
  }

  function openProject() {
    projectFileInputRef.current?.click();
  }

  function loadSerializedProject(serialized: string) {
    const loaded = loadProject(serialized);
    if (!loaded.project) {
      setLoadError(loaded.issues.map((issue) => issue.message).join(' '));
      return;
    }
    applyLoadedProject(loaded.project, null);
    setLoadError(loaded.issues.map((issue) => issue.message).join(' '));
    setSaveStatus(`Loaded ${compileProjectHash(loaded.project)}`);
  }

  async function loadProjectFile(file: File) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (isTrackPrintPackageBytes(bytes) || file.name.toLowerCase().endsWith(TRACKPRINT_PACKAGE_EXTENSION)) {
        const decoded = decodeTrackPrintPackage(bytes);
        const textureAsset = decoded.assets.find((asset) => asset.role === 'terrain-texture') ?? null;
        const canvas = textureAsset ? await canvasFromPackageAsset(textureAsset) : null;
        applyLoadedProject(decoded.project, canvas);
        setProjectJson(serializeProject(decoded.project));
        setLoadError('');
        setSaveStatus(`Loaded ${decoded.project.metadata.name} package`);
        return;
      }
      loadSerializedProject(new TextDecoder().decode(bytes));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Project file could not be loaded.');
    }
  }

  function applyLoadedProject(
    project: ReturnType<typeof createProject>,
    textureCanvas: HTMLCanvasElement | null,
  ) {
    commitHistory();
    setDocument(project.track);
    setAuthoringPoints(anchorPointsFromDocument(project.track));
    setTerrainSource(project.terrain);
    setImageryCanvas(textureCanvas);
    setSelectedPoint(project.editorState.selectedPoint);
    setMode(project.editorState.mode);
  }

  function loadExample(kind: 'flat' | 'elevation' | 'curbs' | 'terrain') {
    const example = createExampleProject(kind);
    commitHistory();
    setDocument(example.track);
    setAuthoringPoints(anchorPointsFromDocument(example.track));
    setTerrainSource(example.terrain);
    setImageryCanvas(null);
    setSelectedPoint(example.editorState.selectedPoint);
    setMode(example.editorState.mode);
    setProjectJson(serializeProject(example));
    setSaveStatus(`Loaded ${example.metadata.name}`);
  }

  function exportCurrentProject() {
    const exported = exportProject(document, surface, terrainMesh, skirtMesh, defaultExportSettings);
    setExportPreview(reloadExportPreview(exported.glbBytes));
    setSaveStatus(`Exported ${exported.manifest.project.sourceHash}`);
  }

  function exportVehicleSimTrack() {
    const exported = createCompiledVehicleSimTrack(formatProjectName(document.id));
    const serialized = JSON.stringify(exported, null, 2);
    const url = URL.createObjectURL(new Blob([serialized], { type: 'application/json' }));
    const link = window.document.createElement('a');
    link.href = url;
    link.download = `${document.id || 'trackprint'}-vehicle-sim-track.json`;
    link.click();
    URL.revokeObjectURL(url);
    setSaveStatus(`Exported Vehicle Sim track (${exported.centerline.length} samples)`);
  }

  async function raceEditedTrack() {
    const exported = createCompiledVehicleSimTrack(`TrackPrint - ${formatProjectName(document.id)}`);
    try {
      await saveTrackPrintPreviewTrackForBrowser(exported);
    } catch (error) {
      setSaveStatus(`Could not launch sim: ${error instanceof Error ? error.message : 'preview storage failed'}`);
      return;
    }
    const target = new URL('/', window.location.href);
    target.searchParams.set('track', 'trackprint');
    if (new URLSearchParams(window.location.search).has('e2e')) target.searchParams.set('e2e', '1');
    if (new URLSearchParams(window.location.search).has('debug')) target.searchParams.set('debug', '1');
    window.location.assign(target.toString());
  }

  function createCompiledVehicleSimTrack(displayName: string): TrackDefinition {
    const exported = createVehicleSimTrackFromTrackPrint(document, {
      displayName,
    });
    exported.features.trackPrintTerrain = serializeTrackPrintTerrainMesh(terrainMesh);
    exported.features.trackPrintSkirt = serializeTrackPrintTerrainMesh(skirtMesh);
    exported.features.trackPrintSurface = serializeTrackPrintSurface(surface);
    exported.world.meshSurface = serializeTrackPrintCollisionSurface(surface, terrainMesh, skirtMesh);
    const dataUrl = terrainTextureDataUrlFromCanvas(imageryCanvas);
    if (dataUrl) {
      exported.features.trackPrintTerrainTexture = {
        mimeType: 'image/png',
        dataUrl,
        width: imageryCanvas?.width,
        height: imageryCanvas?.height,
      };
    }
    return exported;
  }

  function recordTelemetrySample() {
    setTelemetry((current) =>
      updateTelemetry(
        current,
        { time: current.samples.length + 1, station, speed, offTrack: !carRegion.validLap },
        currentSector?.id ?? null,
      ),
    );
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        setIsPlaying((value) => !value);
      } else if (event.key.toLowerCase() === 'r') {
        setStation(0);
      } else if (event.key.toLowerCase() === 'c') {
        cycleCameraMode();
      } else if (event.key.toLowerCase() === 's' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        saveProject();
      } else if (event.key.toLowerCase() === 'z' && (event.ctrlKey || event.metaKey) && event.shiftKey) {
        event.preventDefault();
        redoLastEdit();
      } else if (event.key.toLowerCase() === 'z' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        undoLastEdit();
      } else if (event.key.toLowerCase() === 'o') {
        setAnalysisOverlay((value) => (value === 'solid' ? 'curvature' : 'solid'));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <main className="app-shell trackprint-editor">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">TP</div>
          <div>
            <h1>TrackPrint · Apex Circuit Editor</h1>
            <p>v13.0 — {projectDisplayName}</p>
          </div>
        </div>
        <div className="project-pill" aria-label="Active project">
          <span>Project</span>
          <strong>{projectDisplayName}</strong>
          <ChevronDown size={14} aria-hidden="true" />
        </div>
        <div className="toolbar" role="toolbar" aria-label="Editor toolbar">
          <div className="toolbar-group" aria-label="File">
            <span className="toolbar-group-label">File</span>
            <button aria-label="New project" title="New" onClick={createNewTrack}>
              <FolderOpen size={16} />
            </button>
            <button aria-label="Load project" title="Open .tp or JSON" onClick={openProject}>
              <Upload size={16} />
            </button>
            <button aria-label="Save project" title="Save" onClick={saveProject}>
              <Save size={16} />
            </button>
            <button aria-label="Download project" title="Download" onClick={downloadProject}>
              <Download size={16} />
            </button>
          </div>
          <div className="toolbar-group" aria-label="Edit">
            <span className="toolbar-group-label">Edit</span>
            <button aria-label="Undo edit" title="Undo" onClick={undoLastEdit} disabled={undoStack.length === 0}>
              <Undo2 size={16} />
            </button>
            <button aria-label="Redo edit" title="Redo" onClick={redoLastEdit} disabled={redoStack.length === 0}>
              <Redo2 size={16} />
            </button>
            <button aria-label="Clear selection" title="Clear selection" onClick={() => setSelectedPoint(null)}>
              <X size={16} />
            </button>
          </div>
          <div className="toolbar-group" aria-label="Playback">
            <span className="toolbar-group-label">Drive</span>
            <button
              className="race-sim-button"
              aria-label="Race edited track in simulator"
              title="Race edited track in simulator"
              onClick={raceEditedTrack}
            >
              <Gauge size={16} />
              <span>Race in sim</span>
            </button>
            <button
              aria-label={isPlaying ? 'Pause car' : 'Play car'}
              title={isPlaying ? 'Pause' : 'Play'}
              data-active={isPlaying}
              onClick={() => setIsPlaying((value) => !value)}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button
              aria-label="Reset car"
              title="Reset car"
              onClick={() => {
                setStation(0);
                setIsPlaying(false);
              }}
            >
              <RotateCcw size={16} />
            </button>
            <label className="speed-control">
              <span>Speed</span>
              <input
                aria-label="Car speed"
                type="range"
                min="2"
                max="80"
                value={speed}
                onChange={(event) => setSpeed(Number(event.currentTarget.value))}
              />
            </label>
          </div>
          <div className="toolbar-group" aria-label="Camera">
            <span className="toolbar-group-label">View</span>
            <button
              aria-label="Camera mode"
              title={`Camera: ${cameraMode}`}
              onClick={cycleCameraMode}
              data-active={cameraMode !== 'Orbit'}
            >
              <Scan size={16} />
            </button>
          </div>
        </div>
        <div className="topbar-right">
          <button aria-label="Publish project" title="Publish" onClick={exportCurrentProject}>
            <Send size={16} />
          </button>
          <button aria-label="Settings" title="Settings" onClick={() => undefined}>
            <Settings size={16} />
          </button>
          <button aria-label="Help" title="Help" onClick={() => undefined}>
            <HelpCircle size={16} />
          </button>
        </div>
        <input
          ref={projectFileInputRef}
          type="file"
          accept=".tp,.json,application/json,application/x-trackprint-package"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0] ?? null;
            event.currentTarget.value = '';
            if (file) void loadProjectFile(file);
          }}
        />
      </header>

      <section className="workspace">
        <aside className="tool-rail" aria-label="Editor tools">
          {(
            [
              { tool: 'Select', Icon: MousePointer2 },
              { tool: 'Spline', Icon: Spline },
              { tool: 'Width', Icon: Maximize2 },
              { tool: 'Elevation', Icon: Mountain },
              { tool: 'Banking', Icon: RotateCw },
              { tool: 'Curbs', Icon: Flag },
              { tool: 'Sectors', Icon: MapIcon },
              { tool: 'Terrain', Icon: Brush },
              { tool: 'Paint', Icon: Paintbrush },
              { tool: 'References', Icon: Library },
              { tool: 'Drive', Icon: Gauge },
            ] as const
          ).map(({ tool, Icon }) => (
            <button
              key={tool}
              aria-label={`Tool ${tool}`}
              type="button"
              data-active={activeTool === tool}
              onClick={() => selectTool(tool)}
            >
              <span className="tool-glyph"><Icon size={18} /></span>
              <span>{tool}</span>
            </button>
          ))}
        </aside>
        <div className="layers-card" aria-label="View layers">
          <div className="layers-card-head">
            <span><Layers size={12} style={{ marginRight: 6, verticalAlign: '-2px' }} />View Layers</span>
            <span>{Object.values(display).filter(Boolean).length}/{Object.keys(display).length}</span>
          </div>
          <button
            type="button"
            className="layers-import-button"
            onClick={() => setImportDialogOpen(true)}
          >
            <MapIcon size={12} />
            <span>Import real-world location</span>
          </button>
          <div className="layers-list">
            {(
              [
                ['asphalt', 'Asphalt'],
                ['centerline', 'Centerline'],
                ['edges', 'Edges'],
                ['wireframe', 'Wireframe'],
                ['terrain', 'Terrain'],
                ['terrainWireframe', 'Terrain wire'],
                ['terrainImagery', 'Satellite'],
                ['corridorMask', 'Corridor'],
                ['skirtMask', 'Skirt'],
                ['seams', 'Seams'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                aria-label={`Layer ${key}`}
                type="button"
                data-active={display[key]}
                onClick={() => toggleDisplay(key)}
              >
                <span className="layer-dot" aria-hidden="true" />
                <span>{label}</span>
                {display[key] ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
            ))}
          </div>
        </div>
        <TrackViewport
          activeTool={activeTool}
          authoringPoints={authoringPoints}
          cameraMode={cameraMode}
          display={display}
          document={displayDocument}
          isPlaying={isPlaying}
          lookup={lookup}
          selectedPoint={selectedPoint}
          selectedStation={stationInspection?.station ?? null}
          speed={speed}
          station={station}
          surface={surface}
          terrain={terrain}
          terrainMesh={terrainMesh}
          skirtMesh={skirtMesh}
          bridgePillars={bridgePillars}
          portalFill={portalFill}
          imageryCanvas={imageryCanvas}
          terrainBrush={terrainBrush}
          terrainCursor={terrainCursor}
          selectedBand={selectedBand}
          onAddControlPoint={addControlPointAtPosition}
          onHoverStationChange={setHoverStation}
          onMoveControlPoint={moveControlPoint}
          onPreviewMoveControlPoint={previewMoveControlPoint}
          onSelectPoint={setSelectedPoint}
          onSelectBand={setSelectedBand}
          onBeginBandEndpointDrag={beginBandEndpointDrag}
          onMoveBandEndpoint={moveBandEndpoint}
          onStationInspectionChange={handleStationInspectionChange}
          onStationChange={setStation}
          onTerrainBrush={applyBrushStroke}
          onTerrainHover={setTerrainCursor}
        />
        <ToolInspector
          activeTool={activeTool}
          document={document}
          authoringPoints={authoringPoints}
          totalLength={totalLength}
          selectedPoint={selectedPoint}
          controlPoints={controlPoints}
          selectedControlPoint={selectedControlPoint}
          selectedControlStation={selectedControlStation}
          selectedLeftWidth={selectedLeftWidth}
          selectedRightWidth={selectedRightWidth}
          selectedBankingDegrees={selectedBankingDegrees}
          leftWidth={leftWidth}
          rightWidth={rightWidth}
          inspectedStation={stationInspection?.station ?? null}
          inspectedLeftWidth={inspectedWidth.left}
          inspectedRightWidth={inspectedWidth.right}
          widthFalloff={widthFalloff}
          elevationKey={elevationKey}
          elevationStats={elevationStats}
          bankingKeyDegrees={bankingKeyDegrees}
          bankingPeakDegrees={bankingPeakDegrees}
          inspectedBankingDegrees={inspectedBankingDegrees}
          bankingFalloff={bankingFalloff}
          curbDraft={curbDraft}
          curbCount={curbCount}
          runoffCount={runoffCount}
          curbs={document.curbs ?? []}
          runoffs={document.runoffs ?? []}
          selectedBand={selectedBand}
          analysis={analysis}
          analysisOverlay={analysisOverlay}
          overlayOpacity={overlayOpacity}
          currentSector={currentSector}
          terrainBrush={terrainBrush}
          isPlaying={isPlaying}
          speed={speed}
          cameraMode={cameraMode}
          onCreateNewTrack={createNewTrack}
          onAddControlPoint={addControlPoint}
          onUpdateLooping={updateLooping}
          onSelectPoint={setSelectedPoint}
          onUpdateSelectedControlPoint={updateSelectedControlPoint}
          onUpdateWidthAtSelectedPoint={updateWidthAtSelectedPoint}
          onUpdateBankingAtSelectedPoint={updateBankingAtSelectedPoint}
          onBeginBandCreation={beginBandCreation}
          onUpdateWidth={updateWidth}
          onUpdateWidthWithFalloff={updateWidthWithFalloff}
          onSetWidthFalloff={setWidthFalloff}
          onUpdateElevation={updateElevation}
          onUpdateBankingDegrees={updateBankingDegrees}
          onUpdateBankingWithFalloff={updateBankingWithFalloff}
          onSetBankingFalloff={setBankingFalloff}
          onUpdateCurbDraft={setCurbDraft}
          onAddDefaultCurb={addDefaultCurb}
          onSelectBand={setSelectedBand}
          onUpdateCurb={updateCurb}
          onUpdateRunoff={updateRunoff}
          onRemoveBand={removeBand}
          onSetAnalysisOverlay={setAnalysisOverlay}
          onSetOverlayOpacity={setOverlayOpacity}
          onUpdateTerrainBrush={updateTerrainBrush}
          onSetTerrainBrushActive={(active) => setTerrainBrush((current) => ({ ...current, active }))}
          onStrokeTerrain={() => {
            const point = { x: -140, z: -140 };
            setTerrainCursor(point);
            applyBrushStroke(point);
          }}
          references={references}
          referenceError={referenceError}
          onFetchRealWorldReference={() => setImportDialogOpen(true)}
          onAddReferenceFiles={addReferenceFiles}
          onAddReferenceLink={addReferenceLink}
          onAddReferenceNote={addReferenceNote}
          onRemoveReference={removeReference}
          onTogglePlaying={() => setIsPlaying((value) => !value)}
          onResetCar={() => {
            setStation(0);
            setIsPlaying(false);
          }}
          onSetSpeed={setSpeed}
          onCycleCamera={cycleCameraMode}
        />
        <aside className="offscreen-host" aria-hidden="true">
          <div className="inspector-body">
          {activeTool === 'Spline' ? (
            <section className="workflow-panel" aria-label="Spline authoring">
              <h2>Spline</h2>
              <p className="tool-hint">Click the viewport to place anchor points.</p>
              <button aria-label="Create new track" type="button" onClick={createNewTrack}>
                Create
              </button>
              <label>
                <span>Looping</span>
                <input
                  aria-label="Looping track"
                  type="checkbox"
                  checked={document.closed}
                  onChange={(event) => updateLooping(event.currentTarget.checked)}
                />
              </label>
              <div>
                <span>Points</span>
                <strong>{authoringPoints.length}</strong>
              </div>
              <div>
                <span>Length</span>
                <strong>{totalLength.toFixed(1)} m</strong>
              </div>
            </section>
          ) : activeTool === 'Select' ? (
            <section className="workflow-panel" aria-label="Track authoring">
              <h2>Select</h2>
              <button aria-label="Create new track" type="button" onClick={createNewTrack}>
                New track
              </button>
              <button aria-label="Add control point" type="button" onClick={addControlPoint}>
                Add control point
              </button>
              <label>
                <span>Looping</span>
                <input
                  aria-label="Looping track"
                  type="checkbox"
                  checked={document.closed}
                  onChange={(event) => updateLooping(event.currentTarget.checked)}
                />
              </label>
              <label>
                <span>Point</span>
                <select
                  aria-label="Selected control point"
                  value={selectedPoint ?? ''}
                  onChange={(event) => setSelectedPoint(event.currentTarget.value || null)}
                >
                  <option value="">select</option>
                  {controlPoints.map((point) => (
                    <option key={point.id} value={point.id}>
                      {point.id}
                    </option>
                  ))}
                </select>
              </label>
              {selectedControlPoint ? (
                <>
                  <label>
                    <span>X</span>
                    <input
                      aria-label="Selected point x"
                      type="number"
                      step="1"
                      value={Number(selectedControlPoint.position.x.toFixed(2))}
                      onChange={(event) => updateSelectedControlPoint('x', Number(event.currentTarget.value))}
                    />
                  </label>
                  <label>
                    <span>Y</span>
                    <input
                      aria-label="Selected point y"
                      type="number"
                      step="1"
                      value={Number(selectedControlPoint.position.y.toFixed(2))}
                      onChange={(event) => updateSelectedControlPoint('y', Number(event.currentTarget.value))}
                    />
                  </label>
                  <label>
                    <span>Elevation</span>
                    <input
                      aria-label="Selected point elevation"
                      type="number"
                      step="0.5"
                      value={Number((selectedControlPoint.elevation ?? 0).toFixed(2))}
                      onChange={(event) => updateSelectedControlPoint('elevation', Number(event.currentTarget.value))}
                    />
                  </label>
                  <div>
                    <span>Station</span>
                    <strong data-testid="selected-point-station">
                      {selectedControlStation === null ? '-' : `${selectedControlStation.toFixed(1)} m`}
                    </strong>
                  </div>
                  <label>
                    <span>Left width</span>
                    <input
                      aria-label="Selected point left width"
                      type="number"
                      min="0"
                      step="0.5"
                      value={Number(selectedLeftWidth.toFixed(2))}
                      onChange={(event) => updateWidthAtSelectedPoint('left', Number(event.currentTarget.value))}
                    />
                  </label>
                  <label>
                    <span>Right width</span>
                    <input
                      aria-label="Selected point right width"
                      type="number"
                      min="0"
                      step="0.5"
                      value={Number(selectedRightWidth.toFixed(2))}
                      onChange={(event) => updateWidthAtSelectedPoint('right', Number(event.currentTarget.value))}
                    />
                  </label>
                  <label>
                    <span>Banking</span>
                    <input
                      aria-label="Selected point banking"
                      type="number"
                      step="1"
                      value={Number(selectedBankingDegrees.toFixed(2))}
                      onChange={(event) => updateBankingAtSelectedPoint(Number(event.currentTarget.value))}
                    />
                  </label>
                </>
              ) : (
                <div className="validation">Pick a point in the viewport or select one here.</div>
              )}
              <h2>Bands</h2>
              <button aria-label="Create curb" type="button" onClick={() => beginBandCreation('curb')}>
                Create curb
              </button>
              <button aria-label="Create runoff" type="button" onClick={() => beginBandCreation('runoff')}>
                Create runoff
              </button>
              <div>
                <span>Curbs</span>
                <strong data-testid="curb-count">{curbCount}</strong>
              </div>
              <div>
                <span>Runoffs</span>
                <strong data-testid="runoff-count">{runoffCount}</strong>
              </div>
              <h2>Structures</h2>
              <button aria-label="Add tunnel" type="button" onClick={addTunnel}>
                Add tunnel
              </button>
              <div>
                <span>Tunnels</span>
                <strong data-testid="tunnel-count">{tunnels.length}</strong>
              </div>
              {tunnels.map((tunnel) => (
                <div key={tunnel.id} className="tunnel-editor" data-testid={`tunnel-${tunnel.id}`}>
                  <strong>{tunnel.id}</strong>
                  <label>
                    <span>Left start</span>
                    <input
                      aria-label={`${tunnel.id} left start`}
                      type="number"
                      step="1"
                      value={Number(tunnel.leftStartStation.toFixed(1))}
                      onChange={(event) => updateTunnel(tunnel.id, { leftStartStation: Number(event.currentTarget.value) })}
                    />
                  </label>
                  <label>
                    <span>Left end</span>
                    <input
                      aria-label={`${tunnel.id} left end`}
                      type="number"
                      step="1"
                      value={Number(tunnel.leftEndStation.toFixed(1))}
                      onChange={(event) => updateTunnel(tunnel.id, { leftEndStation: Number(event.currentTarget.value) })}
                    />
                  </label>
                  <label>
                    <span>Right start</span>
                    <input
                      aria-label={`${tunnel.id} right start`}
                      type="number"
                      step="1"
                      value={Number(tunnel.rightStartStation.toFixed(1))}
                      onChange={(event) => updateTunnel(tunnel.id, { rightStartStation: Number(event.currentTarget.value) })}
                    />
                  </label>
                  <label>
                    <span>Right end</span>
                    <input
                      aria-label={`${tunnel.id} right end`}
                      type="number"
                      step="1"
                      value={Number(tunnel.rightEndStation.toFixed(1))}
                      onChange={(event) => updateTunnel(tunnel.id, { rightEndStation: Number(event.currentTarget.value) })}
                    />
                  </label>
                  <label>
                    <span>Width</span>
                    <input
                      aria-label={`${tunnel.id} width`}
                      type="number"
                      min="0"
                      step="0.5"
                      value={tunnel.width}
                      onChange={(event) => updateTunnel(tunnel.id, { width: Number(event.currentTarget.value) })}
                    />
                  </label>
                  <label>
                    <span>Height</span>
                    <input
                      aria-label={`${tunnel.id} height`}
                      type="number"
                      min="0"
                      step="0.5"
                      value={tunnel.height}
                      onChange={(event) => updateTunnel(tunnel.id, { height: Number(event.currentTarget.value) })}
                    />
                  </label>
                  <button aria-label={`Remove ${tunnel.id}`} type="button" onClick={() => removeTunnel(tunnel.id)}>
                    Remove
                  </button>
                </div>
              ))}
              <h2>Bridges</h2>
              <div className="bridge-toggles">
                {document.segments.map((segment, index) => (
                  <label key={segment.id}>
                    <input
                      aria-label={`Bridge segment ${index + 1}`}
                      type="checkbox"
                      checked={Boolean(segment.bridge)}
                      onChange={() => toggleSegmentBridge(segment.id)}
                    />
                    <span>Segment {index + 1}</span>
                  </label>
                ))}
              </div>
            </section>
          ) : null}
          <h2>Width</h2>
          <label>
            <span>Left</span>
            <input
              aria-label="Left width"
              type="number"
              min="0"
              step="0.5"
              value={leftWidth}
              onChange={(event) => updateWidth('left', Number(event.currentTarget.value))}
            />
          </label>
          <label>
            <span>Right</span>
            <input
              aria-label="Right width"
              type="number"
              min="0"
              step="0.5"
              value={rightWidth}
              onChange={(event) => updateWidth('right', Number(event.currentTarget.value))}
            />
          </label>
          <div>
            <span>Total</span>
            <strong data-testid="total-width">{(leftWidth + rightWidth).toFixed(1)} m</strong>
          </div>
          <div className="toggle-grid">
            {(
              [
                'asphalt',
                'centerline',
                'edges',
                'wireframe',
                'terrain',
                'terrainWireframe',
                'corridorMask',
                'skirtMask',
                'seams',
              ] as const
            ).map((key) => (
              <button
                key={key}
                aria-label={`Toggle ${key}`}
                title={key}
                type="button"
                data-active={display[key]}
                onClick={() => toggleDisplay(key)}
              >
                <Eye size={15} />
                <span>{key}</span>
              </button>
            ))}
          </div>
          <div className="validation" aria-live="polite">
            {[...widthIssues, ...sectorIssues, ...surfaceIssues, ...curbIssues, ...runoffIssues, ...tunnelIssues, ...bridgeIssues, ...terrainIssues].length === 0
              ? 'Track valid'
              : [...widthIssues, ...sectorIssues, ...surfaceIssues, ...curbIssues, ...runoffIssues, ...tunnelIssues, ...bridgeIssues, ...terrainIssues]
                  .map((issue) => issue.message)
                  .join(' ')}
          </div>
          <h2>Mode</h2>
          <div className="toggle-grid">
            {(['track', 'terrain', 'drive', 'analysis', 'export'] as const).map((value) => (
              <button
                key={value}
                aria-label={`Mode ${value}`}
                type="button"
                data-active={mode === value}
                onClick={() => setMode(value)}
              >
                <span>{value}</span>
              </button>
            ))}
          </div>
          <h2>Project</h2>
          <div>
            <span>Status</span>
            <strong data-testid="save-status">{saveStatus}</strong>
          </div>
          <div>
            <span>Hash</span>
            <strong data-testid="project-hash">{projectHash}</strong>
          </div>
          <select
            aria-label="Example project"
            value=""
            onChange={(event) => {
              const value = event.currentTarget.value as 'flat' | 'elevation' | 'curbs' | 'terrain' | '';
              if (value) {
                loadExample(value);
              }
            }}
          >
            <option value="">examples</option>
            <option value="flat">flat oval</option>
            <option value="elevation">elevation</option>
            <option value="curbs">curbs</option>
            <option value="terrain">terrain</option>
          </select>
          <textarea
            aria-label="Project JSON"
            value={projectJson}
            onChange={(event) => setProjectJson(event.currentTarget.value)}
          />
          {loadError ? <div className="validation">{loadError}</div> : null}
          <h2>Analysis</h2>
          <label>
            <span>Overlay</span>
            <select
              aria-label="Analysis overlay"
              value={analysisOverlay}
              onChange={(event) => setAnalysisOverlay(event.currentTarget.value as AnalysisOverlayMode)}
            >
              <option value="solid">solid</option>
              <option value="curvature">curvature</option>
              <option value="slope">slope</option>
              <option value="banking">banking</option>
              <option value="severity">severity</option>
            </select>
          </label>
          <label>
            <span>Opacity</span>
            <input
              aria-label="Overlay opacity"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={overlayOpacity}
              onChange={(event) => setOverlayOpacity(Number(event.currentTarget.value))}
            />
          </label>
          <div>
            <span>Curvature</span>
            <strong data-testid="curvature-range">{analysis.curvatureRange.map((value) => value.toFixed(3)).join('..')}</strong>
          </div>
          <div>
            <span>Grade</span>
            <strong>{analysis.gradeRange.map((value) => value.toFixed(1)).join('..')}%</strong>
          </div>
          <div>
            <span>Braking</span>
            <strong data-testid="braking-count">{analysis.samples.filter((sample) => sample.braking).length}</strong>
          </div>
          <button aria-label="Record telemetry" type="button" onClick={recordTelemetrySample}>
            Record telemetry
          </button>
          <h2>Export</h2>
          <button aria-label="Export GLB" type="button" onClick={exportCurrentProject}>
            Export GLB
          </button>
          <button aria-label="Export Vehicle Sim track" type="button" onClick={exportVehicleSimTrack}>
            Export Vehicle Sim JSON
          </button>
          <div>
            <span>Meshes</span>
            <strong data-testid="export-mesh-count">{exportPreview?.meshCount ?? '-'}</strong>
          </div>
          <div>
            <span>Vertices</span>
            <strong data-testid="export-vertex-count">{exportPreview?.vertexCount ?? '-'}</strong>
          </div>
          <h2>Terrain</h2>
          <label>
            <span>Brush</span>
            <input
              aria-label="Enable terrain brush"
              type="checkbox"
              checked={sidebarBrush.active}
              onChange={(event) => {
                const active = event.currentTarget.checked;
                setSidebarBrush((current) => ({ ...current, active }));
              }}
            />
          </label>
          <label>
            <span>Type</span>
            <select
              aria-label="Terrain brush type"
              value={sidebarBrushType}
              onChange={(event) => updateSidebarBrush('type', event.currentTarget.value as TerrainBrushType)}
            >
              <option value="raise">raise</option>
              <option value="lower">lower</option>
              <option value="smooth">smooth</option>
              <option value="flatten">flatten</option>
              <option value="material">material</option>
            </select>
          </label>
          <label>
            <span>Radius</span>
            <input
              aria-label="Terrain brush radius"
              type="range"
              min="2"
              max="60"
              step="1"
              value={sidebarBrush.radius}
              onChange={(event) => updateSidebarBrush('radius', Number(event.currentTarget.value))}
            />
          </label>
          <label>
            <span>Strength</span>
            <input
              aria-label="Terrain brush strength"
              type="number"
              min="0"
              step="0.1"
              value={sidebarBrush.strength}
              onChange={(event) => updateSidebarBrush('strength', Number(event.currentTarget.value))}
            />
          </label>
          <label>
            <span>Falloff</span>
            <select
              aria-label="Terrain brush falloff"
              value={sidebarBrush.falloff}
              onChange={(event) => updateSidebarBrush('falloff', event.currentTarget.value as TerrainBrushFalloff)}
            >
              <option value="smooth">smooth</option>
              <option value="linear">linear</option>
              <option value="constant">constant</option>
            </select>
          </label>
          {sidebarBrushType === 'material' ? (
            <label>
              <span>Material</span>
              <select
                aria-label="Terrain target material"
                value={sidebarBrush.targetMaterial ?? 'gravel'}
                onChange={(event) => updateSidebarBrush('targetMaterial', event.currentTarget.value)}
              >
                <option value="grass">grass</option>
                <option value="gravel">gravel</option>
                <option value="dirt">dirt</option>
                <option value="debug">debug</option>
              </select>
            </label>
          ) : (
            <label>
              <span>Target h</span>
              <input
                aria-label="Terrain target height"
                type="number"
                step="0.5"
                value={sidebarBrush.targetHeight ?? 0}
                onChange={(event) => updateSidebarBrush('targetHeight', Number(event.currentTarget.value))}
              />
            </label>
          )}
          <button
            aria-label="Test terrain brush stroke"
            data-testid="test-terrain-brush"
            type="button"
            onClick={() => {
              const point = { x: -140, z: -140 };
              setTerrainCursor(point);
              applyBrushStroke(point, sidebarBrush);
            }}
          >
            Stroke terrain
          </button>
          <h2>Surface</h2>
          <div>
            <span>Elevation min</span>
            <strong data-testid="elevation-min">{`${elevationStats.min.toFixed(2)} m`}</strong>
          </div>
          <div>
            <span>Elevation max</span>
            <strong data-testid="elevation-max">{`${elevationStats.max.toFixed(2)} m`}</strong>
          </div>
          <div>
            <span>Elevation delta</span>
            <strong data-testid="elevation-delta">{`${elevationStats.delta.toFixed(2)} m`}</strong>
          </div>
          <div>
            <span>Banking peak</span>
            <strong data-testid="banking-peak">{`${bankingPeakDegrees.toFixed(2)}°`}</strong>
          </div>
          <label>
            <span>Elevation</span>
            <input
              aria-label="Elevation height"
              type="number"
              step="0.5"
              value={elevationKey}
              onChange={(event) => updateElevation(Number(event.currentTarget.value))}
            />
          </label>
          <label>
            <span>Banking</span>
            <input
              aria-label="Banking angle"
              type="number"
              step="1"
              value={Number(bankingKeyDegrees.toFixed(2))}
              onChange={(event) => updateBankingDegrees(Number(event.currentTarget.value))}
            />
          </label>
          <h2>Bands</h2>
          <label>
            <span>Curb side</span>
            <select
              aria-label="Curb side"
              value={curbDraft.side}
              onChange={(event) => {
                const value = event.currentTarget.value as TrackSide;
                setCurbDraft((current) => ({ ...current, side: value }));
              }}
            >
              <option value="left">left</option>
              <option value="right">right</option>
            </select>
          </label>
          <label>
            <span>Curb start</span>
            <input
              aria-label="Curb start station"
              type="number"
              step="1"
              value={curbDraft.startStation}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                setCurbDraft((current) => ({ ...current, startStation: value }));
              }}
            />
          </label>
          <label>
            <span>Curb end</span>
            <input
              aria-label="Curb end station"
              type="number"
              step="1"
              value={curbDraft.endStation}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                setCurbDraft((current) => ({ ...current, endStation: value }));
              }}
            />
          </label>
          <label>
            <span>Curb width</span>
            <input
              aria-label="Curb width"
              type="number"
              step="0.1"
              value={curbDraft.width}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                setCurbDraft((current) => ({ ...current, width: value }));
              }}
            />
          </label>
          <label>
            <span>Curb height</span>
            <input
              aria-label="Curb height"
              type="number"
              step="0.05"
              value={curbDraft.height}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                setCurbDraft((current) => ({ ...current, height: value }));
              }}
            />
          </label>
          <label>
            <span>Curb taper</span>
            <input
              aria-label="Curb taper length"
              type="range"
              min="0"
              max="40"
              step="1"
              value={curbDraft.taperLength}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                setCurbDraft((current) => ({ ...current, taperLength: value }));
              }}
            />
          </label>
          <label>
            <span>Taper m</span>
            <input
              aria-label="Curb taper meters"
              type="number"
              min="0"
              step="1"
              value={curbDraft.taperLength}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                setCurbDraft((current) => ({ ...current, taperLength: value }));
              }}
            />
          </label>
          <label>
            <span>Curb profile</span>
            <select
              aria-label="Curb profile"
              value={curbDraft.profile}
              onChange={(event) => {
                const value = event.currentTarget.value as CurbProfileType;
                setCurbDraft((current) => ({
                  ...current,
                  profile: value,
                }));
              }}
            >
              <option value="flat">flat</option>
              <option value="raised">raised</option>
              <option value="sawtooth">sawtooth</option>
              <option value="custom">custom</option>
            </select>
          </label>
          <label>
            <span>Curb material</span>
            <input
              aria-label="Curb material"
              value={curbDraft.materialId}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setCurbDraft((current) => ({ ...current, materialId: value }));
              }}
            />
          </label>
          <button aria-label="Add curb" type="button" onClick={addDefaultCurb}>
            Add curb
          </button>
          <label>
            <span>Runoff side</span>
            <select
              aria-label="Runoff side"
              value={runoffDraft.side}
              onChange={(event) => {
                const value = event.currentTarget.value as TrackSide;
                setRunoffDraft((current) => ({ ...current, side: value }));
              }}
            >
              <option value="left">left</option>
              <option value="right">right</option>
            </select>
          </label>
          <label>
            <span>Runoff start</span>
            <input
              aria-label="Runoff start station"
              type="number"
              step="1"
              value={runoffDraft.startStation}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                setRunoffDraft((current) => ({ ...current, startStation: value }));
              }}
            />
          </label>
          <label>
            <span>Runoff end</span>
            <input
              aria-label="Runoff end station"
              type="number"
              step="1"
              value={runoffDraft.endStation}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                setRunoffDraft((current) => ({ ...current, endStation: value }));
              }}
            />
          </label>
          <label>
            <span>Runoff width</span>
            <input
              aria-label="Runoff width"
              type="number"
              step="0.5"
              value={runoffDraft.width}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                setRunoffDraft((current) => ({ ...current, width: value }));
              }}
            />
          </label>
          <label>
            <span>Runoff taper</span>
            <input
              aria-label="Runoff taper length"
              type="range"
              min="0"
              max="40"
              step="1"
              value={runoffDraft.taperLength}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                setRunoffDraft((current) => ({ ...current, taperLength: value }));
              }}
            />
          </label>
          <label>
            <span>Runoff taper m</span>
            <input
              aria-label="Runoff taper meters"
              type="number"
              min="0"
              step="1"
              value={runoffDraft.taperLength}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                setRunoffDraft((current) => ({ ...current, taperLength: value }));
              }}
            />
          </label>
          <label>
            <span>Runoff material</span>
            <input
              aria-label="Runoff material"
              value={runoffDraft.materialId}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setRunoffDraft((current) => ({ ...current, materialId: value }));
              }}
            />
          </label>
          <button aria-label="Add runoff" type="button" onClick={addDefaultRunoff}>
            Add runoff
          </button>
          <div>
            <span>Curbs</span>
            <strong data-testid="legacy-curb-count">{curbCount}</strong>
          </div>
          <div>
            <span>Runoffs</span>
            <strong data-testid="legacy-runoff-count">{runoffCount}</strong>
          </div>
          <label>
            <span>Curb valid</span>
            <input
              aria-label="Curb is valid"
              type="checkbox"
              checked={document.limits?.curbIsValid ?? true}
              onChange={(event) => updateTrackLimit('curbIsValid', event.currentTarget.checked)}
            />
          </label>
          <label>
            <span>Runoff valid</span>
            <input
              aria-label="Runoff is valid"
              type="checkbox"
              checked={document.limits?.runoffIsValid ?? false}
              onChange={(event) => updateTrackLimit('runoffIsValid', event.currentTarget.checked)}
            />
          </label>
          <h2>Validation</h2>
          <div className="validation-list" aria-live="polite">
            {(
              [
                ['Track integrity', widthIssues.length === 0],
                ['Width', widthIssues.length === 0],
                ['Sectors', sectorIssues.length === 0],
                ['Surface', surfaceIssues.length === 0],
                ['Curbs', curbIssues.length === 0],
                ['Runoff', runoffIssues.length === 0],
                ['Terrain', terrainIssues.length === 0],
              ] as const
            ).map(([label, ok]) => (
              <div key={label} className="validation-row">
                <span>{label}</span>
                <span className="status-chip" data-state={ok ? 'ok' : 'warn'}>
                  <CircleCheck size={11} />
                  {ok ? 'OK' : 'Check'}
                </span>
              </div>
            ))}
          </div>
          </div>
        </aside>
        <aside className="readout" aria-label="Station readout">
          <div>
            <span>Total length</span>
            <strong>{totalLength.toFixed(1)} m</strong>
          </div>
          <div data-emphasis="primary">
            <span>Position</span>
            <strong data-testid="car-position">
              {`${carSample.position.x.toFixed(1)}, ${carSurface.position.y.toFixed(1)}, ${carSample.position.y.toFixed(1)}`}
            </strong>
          </div>
          <div>
            <span>Heading</span>
            <strong data-testid="car-heading">{headingDegrees.toFixed(1)}°</strong>
          </div>
          <div>
            <span>Lap / time</span>
            <strong data-testid="lap-time">
              {`Lap 1 · ${currentSector?.name ?? 'Sector 1'} · ${lapTimeLabel}`}
            </strong>
          </div>
          <div>
            <span>Speed</span>
            <strong data-testid="car-speed">{`${speed.toFixed(1)} m/s`}</strong>
          </div>
          <div data-emphasis={compileStatus === 'ok' ? 'ok' : 'warn'}>
            <span>Compile</span>
            <strong data-testid="compile-status">
              {compileStatus === 'ok' ? 'Up to date' : `${totalIssueCount} warning${totalIssueCount === 1 ? '' : 's'}`}
            </strong>
          </div>
          <div>
            <span>Car station</span>
            <strong data-testid="car-station">{wrapDisplay(station, totalLength).toFixed(1)} m</strong>
          </div>
          <div>
            <span>Hovered station</span>
            <strong>{hoverStation === null ? '-' : `${hoverStation.toFixed(1)} m`}</strong>
          </div>
          <div>
            <span>Selected station</span>
            <strong data-testid="selected-station">
              {stationInspection === null ? '-' : `${stationInspection.station.toFixed(1)} m`}
            </strong>
          </div>
          <div>
            <span>Selected u</span>
            <strong data-testid="selected-lateral">
              {stationInspection === null ? '-' : `${stationInspection.lateralOffset.toFixed(1)} m`}
            </strong>
          </div>
          <div>
            <span>Current sector</span>
            <strong data-testid="current-sector">{currentSector?.name ?? '-'}</strong>
          </div>
          <div>
            <span>Sector delta</span>
            <strong data-testid="sector-delta">{activeDelta === undefined ? '-' : activeDelta.toFixed(2)}</strong>
          </div>
          <div>
            <span>Analysis</span>
            <strong data-testid="analysis-overlay">{analysisOverlay}@{overlayOpacity.toFixed(2)}</strong>
          </div>
          <div>
            <span>Camera</span>
            <strong>{cameraMode}</strong>
          </div>
          <div>
            <span>Surface height</span>
            <strong data-testid="car-height">{carSurface.position.y.toFixed(2)} m</strong>
          </div>
          <div>
            <span>Lap state</span>
            <strong data-testid="track-validity">{carRegion.validLap ? 'Valid' : 'Invalid'}</strong>
          </div>
          <div>
            <span>Car region</span>
            <strong data-testid="car-region">{carRegion.region}</strong>
          </div>
          <div>
            <span>Selected region</span>
            <strong data-testid="selected-region">{inspectedRegion?.region ?? '-'}</strong>
          </div>
          <div>
            <span>Selected point</span>
            <strong data-testid="selected-point">{selectedPoint ?? '-'}</strong>
          </div>
          <div>
            <span>Terrain mask</span>
            <strong data-testid="terrain-mask">{hoveredTerrainMask ?? '-'}</strong>
          </div>
          <div>
            <span>Terrain height</span>
            <strong data-testid="terrain-height">
              {hoveredTerrainHeight === null ? '-' : `${hoveredTerrainHeight.toFixed(2)} m`}
            </strong>
          </div>
          <div>
            <span>Terrain material</span>
            <strong data-testid="terrain-material">{hoveredTerrainMaterial ?? '-'}</strong>
          </div>
          <div>
            <span>Heading</span>
            <strong>{Math.atan2(carSample.tangent.y, carSample.tangent.x).toFixed(2)} rad</strong>
          </div>
        </aside>
        <button
          className="test-edit-button"
          data-testid="test-move-control-point"
          type="button"
          onClick={() => {
            setSelectedPoint('p-east');
            moveControlPoint('p-east', { x: 105, y: 18 });
          }}
        >
          Move point
        </button>
        <button
          className="test-edit-button"
          data-testid="test-probe-outside"
          type="button"
          onClick={() => setStationInspection({ station: 0, lateralOffset: 999 })}
        >
          Probe outside
        </button>
      </section>
      {isBandPicking ? (
        <div className="track-pick-banner" role="status">
          <strong>{bandPickTarget === 'startStation' ? 'Pick start point' : 'Pick end point'}</strong>
          <span>Click the inner or outer track edge.</span>
          <button aria-label="Cancel track pick" type="button" onClick={() => setBandPickTarget(null)}>
            Cancel
          </button>
        </div>
      ) : null}
      {bandCreationDraft && !isBandPicking ? (
        <div className="modal-backdrop" role="presentation">
          <section className="band-modal" role="dialog" aria-modal="true" aria-label={`${bandCreationDraft.kind} setup`}>
            <header>
              <h2>{bandCreationDraft.kind === 'curb' ? 'Create Curb' : 'Create Runoff'}</h2>
              <button aria-label="Cancel band creation" type="button" onClick={cancelBandCreation}>
                Cancel
              </button>
            </header>
            <div className="band-picks">
              <button
                aria-label="Pick band start"
                type="button"
                data-active={bandPickTarget === 'startStation'}
                onClick={() => setBandPickTarget('startStation')}
              >
                Pick start
              </button>
              <strong>{bandCreationDraft.startStation === null ? '-' : `${bandCreationDraft.startStation.toFixed(1)} m`}</strong>
              <button
                aria-label="Pick band end"
                type="button"
                data-active={bandPickTarget === 'endStation'}
                onClick={() => setBandPickTarget('endStation')}
              >
                Pick end
              </button>
              <strong>{bandCreationDraft.endStation === null ? '-' : `${bandCreationDraft.endStation.toFixed(1)} m`}</strong>
            </div>
            <label>
              <span>Side</span>
              <select
                aria-label="Band side"
                value={bandCreationDraft.side}
                onChange={(event) => {
                  const value = event.currentTarget.value as TrackSide;
                  setBandCreationDraft((current) =>
                    current ? { ...current, side: value } : current,
                  );
                }}
              >
                <option value="left">left</option>
                <option value="right">right</option>
              </select>
            </label>
            <label>
              <span>Width</span>
              <input
                aria-label="Band width"
                type="number"
                min="0"
                step="0.1"
                value={bandCreationDraft.width}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  setBandCreationDraft((current) =>
                    current ? { ...current, width: value } : current,
                  );
                }}
              />
            </label>
            {bandCreationDraft.kind === 'curb' ? (
              <>
                <label>
                  <span>Height</span>
                  <input
                    aria-label="Band height"
                    type="number"
                    min="0"
                    step="0.05"
                    value={bandCreationDraft.height}
                    onChange={(event) => {
                      const value = Number(event.currentTarget.value);
                      setBandCreationDraft((current) =>
                        current ? { ...current, height: value } : current,
                      );
                    }}
                  />
                </label>
                <label>
                  <span>Profile</span>
                  <select
                    aria-label="Band profile"
                    value={bandCreationDraft.profile}
                    onChange={(event) => {
                      const value = event.currentTarget.value as CurbProfileType;
                      setBandCreationDraft((current) =>
                        current ? { ...current, profile: value } : current,
                      );
                    }}
                  >
                    <option value="flat">flat</option>
                    <option value="raised">raised</option>
                    <option value="sawtooth">sawtooth</option>
                    <option value="custom">custom</option>
                  </select>
                </label>
              </>
            ) : null}
            <label>
              <span>Taper</span>
              <input
                aria-label="Band taper"
                type="number"
                min="0"
                step="1"
                value={bandCreationDraft.taperLength}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  setBandCreationDraft((current) =>
                    current ? { ...current, taperLength: value } : current,
                  );
                }}
              />
            </label>
            <label>
              <span>Material</span>
              <input
                aria-label="Band material"
                value={bandCreationDraft.materialId}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setBandCreationDraft((current) =>
                    current ? { ...current, materialId: value } : current,
                  );
                }}
              />
            </label>
            <footer>
              <button
                aria-label="Save band"
                type="button"
                disabled={
                  bandCreationDraft.startStation === null ||
                  bandCreationDraft.endStation === null ||
                  Math.abs(bandCreationDraft.endStation - bandCreationDraft.startStation) <= 0.01
                }
                onClick={saveBandCreation}
              >
                Save
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      {importDialogOpen ? (
        <ImportLocationDialog
          defaultCenter={{
            x: terrainSource.origin.x + terrainSource.size.width / 2,
            z: terrainSource.origin.z + terrainSource.size.depth / 2,
          }}
          onImport={importRealWorldLocation}
          onClose={() => setImportDialogOpen(false)}
        />
      ) : null}
    </main>
  );
}

function pointAtStationOffset(
  document: TrackDocument,
  lookup: ReturnType<typeof createStationLookup>,
  station: number,
  lateralOffset: number,
): Vector2 {
  const sample = evaluateStation(document, lookup, station);
  return {
    x: sample.position.x + sample.normal.x * lateralOffset,
    y: sample.position.y + sample.normal.y * lateralOffset,
  };
}

function terrainTextureDataUrlFromCanvas(canvas: HTMLCanvasElement | null): string | null {
  if (!canvas) return null;
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

async function terrainTextureAssetFromCanvas(canvas: HTMLCanvasElement | null): Promise<TrackPrintPackageAsset | null> {
  if (!canvas) return null;
  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob(resolve, 'image/png');
    } catch {
      resolve(null);
    }
  });
  if (!blob) return null;
  return {
    id: 'terrain-texture',
    role: 'terrain-texture',
    mimeType: 'image/png',
    name: 'terrain-texture.png',
    bytes: new Uint8Array(await blob.arrayBuffer()),
    width: canvas.width,
    height: canvas.height,
  };
}

async function canvasFromPackageAsset(asset: TrackPrintPackageAsset): Promise<HTMLCanvasElement | null> {
  if (!asset.mimeType.startsWith('image/')) return null;
  const url = URL.createObjectURL(new Blob([arrayBufferFromBytes(asset.bytes)], { type: asset.mimeType }));
  try {
    const image = await loadImage(url);
    const canvas = window.document.createElement('canvas');
    canvas.width = image.naturalWidth || asset.width || 1;
    canvas.height = image.naturalHeight || asset.height || 1;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Terrain texture image could not be decoded.'));
    image.src = url;
  });
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function anchorPointsFromDocument(document: TrackDocument): ControlPoint[] {
  const anchors: ControlPoint[] = [];
  const seen = new Set<string>();
  for (const segment of document.segments) {
    for (const point of [segment.p0, segment.p3]) {
      if (!seen.has(point.id)) {
        anchors.push(point);
        seen.add(point.id);
      }
    }
  }
  return anchors;
}

function nearestStationIfAvailable(
  document: TrackDocument,
  lookup: ReturnType<typeof createStationLookup>,
  point: Vector2,
): number | null {
  return lookup.samples.length === 0 ? null : nearestStation(document, lookup, point).station;
}

function widthAtStation(widthSide: TrackWidthSide | undefined, station: number, fallback: number): number {
  const keys = widthSide?.keys ?? [];
  const exact = keys.find((key) => Math.abs(key.station - station) <= 0.01);
  return exact?.value ?? widthSide?.constant ?? fallback;
}

function valueAtStation(curve: StationValueCurve | undefined, station: number, fallback: number): number {
  const exact = curve?.keys.find((key) => Math.abs(key.station - station) <= 0.01);
  return exact?.value ?? curve?.keys[0]?.value ?? fallback;
}

function upsertStationKey(widthSide: TrackWidthSide, station: number, value: number): TrackWidthSide {
  const keys = upsertNumericKey(widthSide.keys ?? [], station, value);
  return { ...widthSide, keys };
}

function upsertStationValueKey(
  curve: StationValueCurve | undefined,
  station: number,
  value: number,
): StationValueCurve {
  return { keys: upsertNumericKey(curve?.keys ?? [], station, value) };
}

function upsertNumericKey<T extends { readonly station: number; readonly value: number }>(
  keys: readonly T[],
  station: number,
  value: number,
): T[] {
  const nextKey = { station, value } as T;
  const replaced = keys.some((key) => Math.abs(key.station - station) <= 0.01);
  return (replaced
    ? keys.map((key) => (Math.abs(key.station - station) <= 0.01 ? nextKey : key))
    : [...keys, nextKey]
  ).sort((a, b) => a.station - b.station);
}

function createBlankTrackDocument(looping: boolean): TrackDocument {
  return {
    id: 'new-track',
    version: 1,
    units: 'meters',
    closed: looping,
    width: {
      left: { constant: 6 },
      right: { constant: 6 },
    },
    sectors: [],
    segments: [],
  };
}

function rebuildTrackFromAnchors(
  current: TrackDocument,
  points: readonly ControlPoint[],
  looping: boolean,
): TrackDocument {
  if (points.length < 2) {
    return { ...current, closed: looping, segments: [], sectors: [] };
  }

  const segments = points
    .slice(0, looping ? points.length : points.length - 1)
    .map((start, index) => {
      const end = points[(index + 1) % points.length];
      const previous = points[(index - 1 + points.length) % points.length] ?? start;
      const next = points[(index + 2) % points.length] ?? end;
      const handleScale = 1 / 6;
      return {
        id: `segment-${index + 1}`,
        kind: 'cubicBezier' as const,
        p0: start,
        p1: {
          id: `h-${index + 1}-a`,
          position: {
            x: start.position.x + (end.position.x - previous.position.x) * handleScale,
            y: start.position.y + (end.position.y - previous.position.y) * handleScale,
          },
          elevation: start.elevation,
        },
        p2: {
          id: `h-${index + 1}-b`,
          position: {
            x: end.position.x - (next.position.x - start.position.x) * handleScale,
            y: end.position.y - (next.position.y - start.position.y) * handleScale,
          },
          elevation: end.elevation,
        },
        p3: end,
      };
    });

  return {
    ...current,
    closed: looping,
    sectors: current.sectors?.length ? current.sectors : [{ id: 'sector-1', name: 'Sector 1', startStation: 0, endStation: 9999 }],
    segments,
  };
}

function createConceptTrackDocument(): TrackDocument {
  return {
    id: 'summit-peak-raceway',
    version: 1,
    units: 'meters',
    closed: true,
    width: {
      left: { constant: 7 },
      right: { constant: 6 },
    },
    sectors: [
      { id: 'sector-1', name: 'Sector 1', startStation: 0, endStation: 185 },
      { id: 'sector-2', name: 'Sector 2', startStation: 185, endStation: 370 },
      { id: 'sector-3', name: 'Sector 3', startStation: 370, endStation: 700 },
    ],
    elevation: {
      keys: [
        { station: 0, value: 0 },
        { station: 190, value: 8 },
        { station: 360, value: 2 },
        { station: 520, value: 15 },
      ],
    },
    banking: {
      keys: [
        { station: 0, value: 0.04 },
        { station: 180, value: -0.08 },
        { station: 360, value: 0.1 },
        { station: 540, value: -0.06 },
      ],
    },
    segments: [
      {
        id: 'summit-front',
        kind: 'cubicBezier',
        p0: { id: 'p-east', position: { x: 88, y: -92 }, elevation: 0 },
        p1: { id: 'h-east-front', position: { x: 34, y: -118 }, elevation: 0 },
        p2: { id: 'h-south-front', position: { x: -98, y: -104 }, elevation: 1 },
        p3: { id: 'p-southwest', position: { x: -112, y: -46 }, elevation: 2 },
      },
      {
        id: 'summit-hairpin',
        kind: 'cubicBezier',
        p0: { id: 'p-southwest', position: { x: -112, y: -46 }, elevation: 2 },
        p1: { id: 'h-sw-entry', position: { x: -132, y: 12 }, elevation: 4 },
        p2: { id: 'h-mid-left', position: { x: -40, y: -8 }, elevation: 7 },
        p3: { id: 'p-mid', position: { x: -52, y: 52 }, elevation: 8 },
      },
      {
        id: 'summit-esses-a',
        kind: 'cubicBezier',
        p0: { id: 'p-mid', position: { x: -52, y: 52 }, elevation: 8 },
        p1: { id: 'h-mid-rise', position: { x: -70, y: 118 }, elevation: 10 },
        p2: { id: 'h-north-left', position: { x: 40, y: 98 }, elevation: 8 },
        p3: { id: 'p-north', position: { x: 12, y: 42 }, elevation: 5 },
      },
      {
        id: 'summit-esses-b',
        kind: 'cubicBezier',
        p0: { id: 'p-north', position: { x: 12, y: 42 }, elevation: 5 },
        p1: { id: 'h-north-right', position: { x: -18, y: -18 }, elevation: 2 },
        p2: { id: 'h-east-climb', position: { x: 134, y: 16 }, elevation: 12 },
        p3: { id: 'p-east-loop', position: { x: 110, y: 76 }, elevation: 14 },
      },
      {
        id: 'summit-back',
        kind: 'cubicBezier',
        p0: { id: 'p-east-loop', position: { x: 110, y: 76 }, elevation: 14 },
        p1: { id: 'h-back-top', position: { x: 84, y: 136 }, elevation: 15 },
        p2: { id: 'h-back-descent', position: { x: 164, y: 88 }, elevation: 7 },
        p3: { id: 'p-far-east', position: { x: 148, y: 20 }, elevation: 4 },
      },
      {
        id: 'summit-return',
        kind: 'cubicBezier',
        p0: { id: 'p-far-east', position: { x: 148, y: 20 }, elevation: 4 },
        p1: { id: 'h-return-a', position: { x: 132, y: -36 }, elevation: 2 },
        p2: { id: 'h-return-b', position: { x: 156, y: -72 }, elevation: 1 },
        p3: { id: 'p-east', position: { x: 88, y: -92 }, elevation: 0 },
      },
    ],
  };
}

function wrapDisplay(station: number, length: number): number {
  if (length <= 0) {
    return 0;
  }

  return ((station % length) + length) % length;
}

function formatProjectName(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function summarizeElevation(keys: readonly { readonly value: number }[]): { min: number; max: number; delta: number } {
  if (keys.length === 0) {
    return { min: 0, max: 0, delta: 0 };
  }
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const key of keys) {
    if (key.value < min) min = key.value;
    if (key.value > max) max = key.value;
  }
  return { min, max, delta: max - min };
}

function formatLapTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '0:00.000';
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`;
}
