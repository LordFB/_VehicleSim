import {
  BrickWall,
  Brush,
  Flag,
  Gauge,
  Library,
  Map as MapIcon,
  Maximize2,
  MousePointer2,
  Mountain,
  Paintbrush,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Scan,
  Spline,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type {
  ControlPoint,
  CurbInterval,
  CurbProfileType,
  RunoffInterval,
  TrackDocument,
  TrackSide,
  WallInterval,
  WallStyle,
} from '@trackprint/track-core';

export interface BandRef {
  readonly kind: 'curb' | 'runoff';
  readonly id: string;
}
import type { TerrainBrushFalloff, TerrainBrushSettings, TerrainBrushType } from '@trackprint/terrain-core';
import type { AnalysisOverlayMode } from './analysis';
import type { EditorTool } from './viewport/TrackViewport';
import { ReferencesPanel } from './ReferencesPanel';
import type { ReferenceItem } from './references';

type CurbDraft = {
  readonly side: TrackSide;
  readonly startStation: number;
  readonly endStation: number;
  readonly width: number;
  readonly height: number;
  readonly taperLength: number;
  readonly profile: CurbProfileType;
  readonly materialId: string;
};

interface ToolInspectorProps {
  readonly activeTool: EditorTool;
  readonly document: TrackDocument;
  readonly authoringPoints: readonly ControlPoint[];
  readonly totalLength: number;
  readonly selectedPoint: string | null;
  readonly controlPoints: readonly ControlPoint[];
  readonly selectedControlPoint: ControlPoint | null;
  readonly selectedControlStation: number | null;
  readonly selectedLeftWidth: number;
  readonly selectedRightWidth: number;
  readonly selectedBankingDegrees: number;
  readonly leftWidth: number;
  readonly rightWidth: number;
  readonly inspectedStation: number | null;
  readonly inspectedLeftWidth: number;
  readonly inspectedRightWidth: number;
  readonly widthFalloff: number;
  readonly elevationKey: number;
  readonly elevationStats: { readonly min: number; readonly max: number; readonly delta: number };
  readonly bankingKeyDegrees: number;
  readonly bankingPeakDegrees: number;
  readonly inspectedBankingDegrees: number;
  readonly bankingFalloff: number;
  readonly walls: readonly WallInterval[];
  readonly selectedWallId: string | null;
  readonly isDrawingWall: boolean;
  readonly onSelectWall: (id: string | null) => void;
  readonly onStartWall: () => void;
  readonly onFinishWall: () => void;
  readonly onUpdateWall: (id: string, patch: Partial<Omit<WallInterval, 'id'>>) => void;
  readonly onRemoveWall: (id: string) => void;
  readonly curbDraft: CurbDraft;
  readonly curbCount: number;
  readonly runoffCount: number;
  readonly curbs: readonly CurbInterval[];
  readonly runoffs: readonly RunoffInterval[];
  readonly selectedBand: BandRef | null;
  readonly analysis: { readonly curvatureRange: readonly number[]; readonly gradeRange: readonly number[] };
  readonly analysisOverlay: AnalysisOverlayMode;
  readonly overlayOpacity: number;
  readonly currentSector: { readonly name?: string; readonly id: string } | null;
  readonly terrainBrush: TerrainBrushSettings & { readonly active: boolean };
  readonly isPlaying: boolean;
  readonly speed: number;
  readonly cameraMode: 'Orbit' | 'Top' | 'Chase';
  readonly onCreateNewTrack: () => void;
  readonly onAddControlPoint: () => void;
  readonly onUpdateLooping: (looping: boolean) => void;
  readonly onSelectPoint: (pointId: string | null) => void;
  readonly onUpdateSelectedControlPoint: (axis: 'x' | 'y' | 'elevation', value: number) => void;
  readonly onUpdateWidthAtSelectedPoint: (side: 'left' | 'right', value: number) => void;
  readonly onUpdateBankingAtSelectedPoint: (valueDegrees: number) => void;
  readonly onUpdateBankingWithFalloff: (valueDegrees: number) => void;
  readonly onSetBankingFalloff: (value: number) => void;
  readonly onBeginBandCreation: (kind: 'curb' | 'runoff') => void;
  readonly onUpdateWidth: (side: 'left' | 'right', value: number) => void;
  readonly onUpdateWidthWithFalloff: (side: 'left' | 'right', value: number) => void;
  readonly onSetWidthFalloff: (value: number) => void;
  readonly onUpdateElevation: (value: number) => void;
  readonly onUpdateBankingDegrees: (value: number) => void;
  readonly onUpdateCurbDraft: Dispatch<SetStateAction<CurbDraft>>;
  readonly onAddDefaultCurb: () => void;
  readonly onSelectBand: (band: BandRef | null) => void;
  readonly onUpdateCurb: (id: string, patch: Partial<Omit<CurbInterval, 'id'>>) => void;
  readonly onUpdateRunoff: (id: string, patch: Partial<Omit<RunoffInterval, 'id'>>) => void;
  readonly onRemoveBand: (kind: 'curb' | 'runoff', id: string) => void;
  readonly onSetAnalysisOverlay: (mode: AnalysisOverlayMode) => void;
  readonly onSetOverlayOpacity: (value: number) => void;
  readonly onUpdateTerrainBrush: <K extends keyof TerrainBrushSettings>(key: K, value: TerrainBrushSettings[K]) => void;
  readonly onSetTerrainBrushActive: (active: boolean) => void;
  readonly onStrokeTerrain: () => void;
  readonly references: readonly ReferenceItem[];
  readonly referenceError: string;
  readonly onFetchRealWorldReference: () => void;
  readonly onAddReferenceFiles: (files: FileList | null) => void;
  readonly onAddReferenceLink: (url: string, name?: string) => void;
  readonly onAddReferenceNote: (body: string, name?: string) => void;
  readonly onRemoveReference: (id: string) => void;
  readonly onTogglePlaying: () => void;
  readonly onResetCar: () => void;
  readonly onSetSpeed: (value: number) => void;
  readonly onCycleCamera: () => void;
}

const TOOL_META: Record<EditorTool, { readonly Icon: LucideIcon; readonly hint: string }> = {
  Select: { Icon: MousePointer2, hint: 'Pick a control point in the viewport to edit its geometry.' },
  Spline: { Icon: Spline, hint: 'Click the viewport to place anchor points.' },
  Width: { Icon: Maximize2, hint: 'Click a station, then set left / right width — the change falls off over the radius around it.' },
  Elevation: { Icon: Mountain, hint: 'Raise or lower the start-of-track elevation key.' },
  Banking: { Icon: RotateCw, hint: 'Click a station, then set banking — the change falls off over the radius around it.' },
  Curbs: { Icon: Flag, hint: 'Configure the curb draft, then drop it on the active side.' },
  Walls: { Icon: BrickWall, hint: 'Click two points on the track to span a wall, then tune its height, standoff and style.' },
  Sectors: { Icon: MapIcon, hint: 'Pick an analysis overlay to inspect the racing line.' },
  Terrain: { Icon: Brush, hint: 'Sculpt terrain heights with the brush.' },
  Paint: { Icon: Paintbrush, hint: 'Paint surface materials onto free terrain.' },
  References: { Icon: Library, hint: 'Attach reference material to guide track creation.' },
  Drive: { Icon: Gauge, hint: 'Drive the car and frame it with the camera.' },
};

export function ToolInspector(props: ToolInspectorProps) {
  const meta = TOOL_META[props.activeTool];
  const Icon = meta.Icon;
  return (
    <aside className="tool-inspector" aria-label={`${props.activeTool} inspector`}>
      <div className="tool-inspector-head">
        <span className="tool-inspector-glyph"><Icon size={15} /></span>
        <strong>{props.activeTool}</strong>
        <span>Tool</span>
      </div>
      <div className="tool-inspector-body">
        <p className="tool-hint">{meta.hint}</p>
        <ToolFields {...props} />
      </div>
    </aside>
  );
}

function ToolFields(props: ToolInspectorProps) {
  switch (props.activeTool) {
    case 'Select':
      return <SelectFields {...props} />;
    case 'Spline':
      return <SplineFields {...props} />;
    case 'Width':
      return <WidthFields {...props} />;
    case 'Elevation':
      return <ElevationFields {...props} />;
    case 'Banking':
      return <BankingFields {...props} />;
    case 'Curbs':
      return <CurbsFields {...props} />;
    case 'Walls':
      return <WallsFields {...props} />;
    case 'Sectors':
      return <SectorsFields {...props} />;
    case 'Terrain':
    case 'Paint':
      return <TerrainFields {...props} />;
    case 'References':
      return (
        <ReferencesPanel
          references={props.references}
          error={props.referenceError}
          onFetchRealWorld={props.onFetchRealWorldReference}
          onAddFiles={props.onAddReferenceFiles}
          onAddLink={props.onAddReferenceLink}
          onAddNote={props.onAddReferenceNote}
          onRemove={props.onRemoveReference}
        />
      );
    case 'Drive':
      return <DriveFields {...props} />;
    default:
      return null;
  }
}

function SplineFields(props: ToolInspectorProps) {
  return (
    <>
      <button type="button" onClick={props.onCreateNewTrack}>Create</button>
      <label>
        <span>Looping</span>
        <input
          type="checkbox"
          checked={props.document.closed}
          onChange={(event) => props.onUpdateLooping(event.currentTarget.checked)}
        />
      </label>
      <div className="tool-row">
        <span>Points</span>
        <strong>{props.authoringPoints.length}</strong>
      </div>
      <div className="tool-row">
        <span>Length</span>
        <strong>{props.totalLength.toFixed(1)} m</strong>
      </div>
    </>
  );
}

function SelectFields(props: ToolInspectorProps) {
  const point = props.selectedControlPoint;
  return (
    <>
      <button type="button" onClick={props.onAddControlPoint}>Add control point</button>
      <label>
        <span>Point</span>
        <select
          value={props.selectedPoint ?? ''}
          onChange={(event) => props.onSelectPoint(event.currentTarget.value || null)}
        >
          <option value="">select</option>
          {props.controlPoints.map((p) => (
            <option key={p.id} value={p.id}>{p.id}</option>
          ))}
        </select>
      </label>
      {point ? (
        <>
          <label>
            <span>X</span>
            <input
              type="number"
              step="1"
              value={Number(point.position.x.toFixed(2))}
              onChange={(event) => props.onUpdateSelectedControlPoint('x', Number(event.currentTarget.value))}
            />
          </label>
          <label>
            <span>Y</span>
            <input
              type="number"
              step="1"
              value={Number(point.position.y.toFixed(2))}
              onChange={(event) => props.onUpdateSelectedControlPoint('y', Number(event.currentTarget.value))}
            />
          </label>
          <label>
            <span>Elevation</span>
            <input
              type="number"
              step="0.5"
              value={Number((point.elevation ?? 0).toFixed(2))}
              onChange={(event) => props.onUpdateSelectedControlPoint('elevation', Number(event.currentTarget.value))}
            />
          </label>
          <div className="tool-row">
            <span>Station</span>
            <strong>{props.selectedControlStation === null ? '-' : `${props.selectedControlStation.toFixed(1)} m`}</strong>
          </div>
          <label>
            <span>Left width</span>
            <input
              type="number"
              min="0"
              step="0.5"
              value={Number(props.selectedLeftWidth.toFixed(2))}
              onChange={(event) => props.onUpdateWidthAtSelectedPoint('left', Number(event.currentTarget.value))}
            />
          </label>
          <label>
            <span>Right width</span>
            <input
              type="number"
              min="0"
              step="0.5"
              value={Number(props.selectedRightWidth.toFixed(2))}
              onChange={(event) => props.onUpdateWidthAtSelectedPoint('right', Number(event.currentTarget.value))}
            />
          </label>
          <label>
            <span>Banking</span>
            <input
              type="number"
              step="1"
              value={Number(props.selectedBankingDegrees.toFixed(2))}
              onChange={(event) => props.onUpdateBankingAtSelectedPoint(Number(event.currentTarget.value))}
            />
          </label>
        </>
      ) : (
        <p className="tool-hint">Pick a point in the viewport or select one above.</p>
      )}
      <div className="tool-inspector-divider" />
      <button type="button" onClick={() => props.onBeginBandCreation('curb')}>Create curb</button>
      <button type="button" onClick={() => props.onBeginBandCreation('runoff')}>Create runoff</button>
      <div className="tool-row">
        <span>Curbs</span>
        <strong>{props.curbCount}</strong>
      </div>
      <div className="tool-row">
        <span>Runoffs</span>
        <strong>{props.runoffCount}</strong>
      </div>
    </>
  );
}

function WidthFields(props: ToolInspectorProps) {
  const hasStation = props.inspectedStation !== null;
  return (
    <>
      <div className="tool-row">
        <span>Station</span>
        <strong>{hasStation ? `${props.inspectedStation!.toFixed(1)} m` : '-'}</strong>
      </div>
      <label>
        <span>Falloff</span>
        <input
          type="range"
          min="2"
          max="120"
          step="1"
          value={props.widthFalloff}
          onChange={(event) => props.onSetWidthFalloff(Number(event.currentTarget.value))}
        />
      </label>
      <div className="tool-row">
        <span>Falloff m</span>
        <strong>{props.widthFalloff.toFixed(0)} m</strong>
      </div>
      <div className="tool-inspector-divider" />
      <label>
        <span>Left</span>
        <input
          type="number"
          min="0"
          step="0.5"
          disabled={!hasStation}
          value={Number(props.inspectedLeftWidth.toFixed(2))}
          onChange={(event) => props.onUpdateWidthWithFalloff('left', Number(event.currentTarget.value))}
        />
      </label>
      <label>
        <span>Right</span>
        <input
          type="number"
          min="0"
          step="0.5"
          disabled={!hasStation}
          value={Number(props.inspectedRightWidth.toFixed(2))}
          onChange={(event) => props.onUpdateWidthWithFalloff('right', Number(event.currentTarget.value))}
        />
      </label>
      <div className="tool-row">
        <span>Total</span>
        <strong>{(props.inspectedLeftWidth + props.inspectedRightWidth).toFixed(1)} m</strong>
      </div>
      {hasStation ? null : (
        <p className="tool-hint">Click a station on the track to set the falloff center.</p>
      )}
    </>
  );
}

function ElevationFields(props: ToolInspectorProps) {
  return (
    <>
      <label>
        <span>Elevation</span>
        <input
          type="number"
          step="0.5"
          value={props.elevationKey}
          onChange={(event) => props.onUpdateElevation(Number(event.currentTarget.value))}
        />
      </label>
      <div className="tool-row">
        <span>Min</span>
        <strong>{props.elevationStats.min.toFixed(2)} m</strong>
      </div>
      <div className="tool-row">
        <span>Max</span>
        <strong>{props.elevationStats.max.toFixed(2)} m</strong>
      </div>
      <div className="tool-row">
        <span>Delta</span>
        <strong>{props.elevationStats.delta.toFixed(2)} m</strong>
      </div>
    </>
  );
}

function BankingFields(props: ToolInspectorProps) {
  const hasStation = props.inspectedStation !== null;
  return (
    <>
      <div className="tool-row">
        <span>Station</span>
        <strong>{hasStation ? `${props.inspectedStation!.toFixed(1)} m` : '-'}</strong>
      </div>
      <label>
        <span>Falloff</span>
        <input
          type="range"
          min="2"
          max="120"
          step="1"
          value={props.bankingFalloff}
          onChange={(event) => props.onSetBankingFalloff(Number(event.currentTarget.value))}
        />
      </label>
      <div className="tool-row">
        <span>Falloff m</span>
        <strong>{props.bankingFalloff.toFixed(0)} m</strong>
      </div>
      <div className="tool-inspector-divider" />
      <label>
        <span>Banking</span>
        <input
          type="number"
          step="1"
          disabled={!hasStation}
          value={Number(props.inspectedBankingDegrees.toFixed(2))}
          onChange={(event) => props.onUpdateBankingWithFalloff(Number(event.currentTarget.value))}
        />
      </label>
      <div className="tool-row">
        <span>Peak</span>
        <strong>{props.bankingPeakDegrees.toFixed(2)}°</strong>
      </div>
      {hasStation ? null : (
        <p className="tool-hint">Click a station on the track to set the falloff center.</p>
      )}
    </>
  );
}

function CurbsFields(props: ToolInspectorProps) {
  const { curbs, runoffs, selectedBand } = props;
  const selectedCurb =
    selectedBand?.kind === 'curb' ? curbs.find((band) => band.id === selectedBand.id) ?? null : null;
  const selectedRunoff =
    selectedBand?.kind === 'runoff' ? runoffs.find((band) => band.id === selectedBand.id) ?? null : null;

  return (
    <>
      <p className="tool-hint">Select a band to edit it, or drag its endpoints along the track edge.</p>
      <div className="band-list" role="list">
        {curbs.length === 0 && runoffs.length === 0 ? (
          <p className="tool-hint">No curbs or runoffs yet. Create one below.</p>
        ) : (
          <>
            {curbs.map((band) => (
              <BandRow
                key={band.id}
                label={`Curb ${band.id}`}
                detail={`${band.side} · ${band.startStation.toFixed(0)}–${band.endStation.toFixed(0)}m`}
                active={selectedBand?.kind === 'curb' && selectedBand.id === band.id}
                onSelect={() => props.onSelectBand({ kind: 'curb', id: band.id })}
                onRemove={() => props.onRemoveBand('curb', band.id)}
              />
            ))}
            {runoffs.map((band) => (
              <BandRow
                key={band.id}
                label={`Runoff ${band.id}`}
                detail={`${band.side} · ${band.startStation.toFixed(0)}–${band.endStation.toFixed(0)}m`}
                active={selectedBand?.kind === 'runoff' && selectedBand.id === band.id}
                onSelect={() => props.onSelectBand({ kind: 'runoff', id: band.id })}
                onRemove={() => props.onRemoveBand('runoff', band.id)}
              />
            ))}
          </>
        )}
      </div>

      {selectedCurb ? (
        <>
          <div className="tool-inspector-divider" />
          <strong className="band-editor-title">Edit {selectedCurb.id}</strong>
          <BandSideField value={selectedCurb.side} onChange={(side) => props.onUpdateCurb(selectedCurb.id, { side })} />
          <BandNumberField label="Start" value={selectedCurb.startStation} step={1}
            onChange={(startStation) => props.onUpdateCurb(selectedCurb.id, { startStation })} />
          <BandNumberField label="End" value={selectedCurb.endStation} step={1}
            onChange={(endStation) => props.onUpdateCurb(selectedCurb.id, { endStation })} />
          <BandNumberField label="Width" value={selectedCurb.width} step={0.1}
            onChange={(width) => props.onUpdateCurb(selectedCurb.id, { width })} />
          <BandNumberField label="Height" value={selectedCurb.height} step={0.05}
            onChange={(height) => props.onUpdateCurb(selectedCurb.id, { height })} />
          <BandNumberField label="Taper" value={selectedCurb.taperLength ?? 0} step={1}
            onChange={(taperLength) => props.onUpdateCurb(selectedCurb.id, { taperLength })} />
          <label>
            <span>Profile</span>
            <select
              value={selectedCurb.profile}
              onChange={(event) => props.onUpdateCurb(selectedCurb.id, { profile: event.currentTarget.value as CurbProfileType })}
            >
              <option value="flat">flat</option>
              <option value="raised">raised</option>
              <option value="sawtooth">sawtooth</option>
              <option value="custom">custom</option>
            </select>
          </label>
          <BandTextField label="Material" value={selectedCurb.materialId}
            onChange={(materialId) => props.onUpdateCurb(selectedCurb.id, { materialId })} />
        </>
      ) : null}

      {selectedRunoff ? (
        <>
          <div className="tool-inspector-divider" />
          <strong className="band-editor-title">Edit {selectedRunoff.id}</strong>
          <BandSideField value={selectedRunoff.side} onChange={(side) => props.onUpdateRunoff(selectedRunoff.id, { side })} />
          <BandNumberField label="Start" value={selectedRunoff.startStation} step={1}
            onChange={(startStation) => props.onUpdateRunoff(selectedRunoff.id, { startStation })} />
          <BandNumberField label="End" value={selectedRunoff.endStation} step={1}
            onChange={(endStation) => props.onUpdateRunoff(selectedRunoff.id, { endStation })} />
          <BandNumberField label="Width" value={selectedRunoff.width} step={0.5}
            onChange={(width) => props.onUpdateRunoff(selectedRunoff.id, { width })} />
          <BandNumberField label="Taper" value={selectedRunoff.taperLength ?? 0} step={1}
            onChange={(taperLength) => props.onUpdateRunoff(selectedRunoff.id, { taperLength })} />
          <BandTextField label="Material" value={selectedRunoff.materialId}
            onChange={(materialId) => props.onUpdateRunoff(selectedRunoff.id, { materialId })} />
        </>
      ) : null}

      <div className="tool-inspector-divider" />
      <strong className="band-editor-title">New band</strong>
      <button type="button" onClick={() => props.onBeginBandCreation('curb')}>Create curb</button>
      <button type="button" onClick={() => props.onBeginBandCreation('runoff')}>Create runoff</button>
    </>
  );
}

function WallsFields(props: ToolInspectorProps) {
  const { walls, selectedWallId, isDrawingWall } = props;
  const selectedWall = selectedWallId ? walls.find((wall) => wall.id === selectedWallId) ?? null : null;

  return (
    <>
      {isDrawingWall ? (
        <div className="wall-draw-banner" role="status">
          <p className="tool-hint">Drawing — click in the viewport to drop wall points. Finish when done.</p>
          <button type="button" className="wall-finish" onClick={props.onFinishWall}>Finish wall</button>
        </div>
      ) : (
        <p className="tool-hint">
          Draw a free-form wall: click "New wall", then click points in the viewport to trace it. Toggle Smooth to round
          its corners.
        </p>
      )}

      <div className="band-list" role="list">
        {walls.length === 0 ? (
          <p className="tool-hint">No walls yet. Draw one below.</p>
        ) : (
          walls.map((wall) => (
            <BandRow
              key={wall.id}
              label={`Wall ${wall.id}`}
              detail={`${wall.points.length} pts · ${wall.cornerMode} · ${wall.style}`}
              active={selectedWallId === wall.id}
              onSelect={() => props.onSelectWall(wall.id)}
              onRemove={() => props.onRemoveWall(wall.id)}
            />
          ))
        )}
      </div>

      {selectedWall ? (
        <>
          <div className="tool-inspector-divider" />
          <strong className="band-editor-title">Edit {selectedWall.id}</strong>
          <p className="tool-hint">{selectedWall.points.length} points</p>
          <div className="wall-corner-toggle" role="group" aria-label="Corner mode">
            <button
              type="button"
              data-active={selectedWall.cornerMode === 'cornered'}
              onClick={() => props.onUpdateWall(selectedWall.id, { cornerMode: 'cornered' })}
            >
              Cornered
            </button>
            <button
              type="button"
              data-active={selectedWall.cornerMode === 'smooth'}
              onClick={() => props.onUpdateWall(selectedWall.id, { cornerMode: 'smooth' })}
            >
              Smooth
            </button>
          </div>
          {selectedWall.cornerMode === 'smooth' ? (
            <BandNumberField label="Corner radius" value={selectedWall.cornerRadius} step={0.5}
              onChange={(cornerRadius) => props.onUpdateWall(selectedWall.id, { cornerRadius })} />
          ) : null}
          <BandNumberField label="Height" value={selectedWall.height} step={0.1}
            onChange={(height) => props.onUpdateWall(selectedWall.id, { height })} />
          <BandNumberField label="Segment" value={selectedWall.segmentLength} step={0.5}
            onChange={(segmentLength) => props.onUpdateWall(selectedWall.id, { segmentLength })} />
          <label>
            <span>Style</span>
            <select
              value={selectedWall.style}
              onChange={(event) => props.onUpdateWall(selectedWall.id, { style: event.currentTarget.value as WallStyle })}
            >
              <option value="armco">armco</option>
              <option value="solid">solid</option>
              <option value="tirewall">tire wall</option>
            </select>
          </label>
          <BandTextField label="Material" value={selectedWall.materialId}
            onChange={(materialId) => props.onUpdateWall(selectedWall.id, { materialId })} />
        </>
      ) : null}

      {!isDrawingWall ? (
        <>
          <div className="tool-inspector-divider" />
          <button type="button" onClick={props.onStartWall}>New wall</button>
        </>
      ) : null}
    </>
  );
}

function BandRow(props: {
  readonly label: string;
  readonly detail: string;
  readonly active: boolean;
  readonly onSelect: () => void;
  readonly onRemove: () => void;
}) {
  return (
    <div className="band-row" role="listitem" data-active={props.active}>
      <button type="button" className="band-row-select" aria-label={`Select ${props.label}`} onClick={props.onSelect}>
        <span className="band-row-name">{props.label}</span>
        <span className="band-row-detail">{props.detail}</span>
      </button>
      <button type="button" className="band-row-remove" aria-label={`Remove ${props.label}`} onClick={props.onRemove}>
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function BandSideField(props: { readonly value: TrackSide; readonly onChange: (side: TrackSide) => void }) {
  return (
    <label>
      <span>Side</span>
      <select value={props.value} onChange={(event) => props.onChange(event.currentTarget.value as TrackSide)}>
        <option value="left">left</option>
        <option value="right">right</option>
      </select>
    </label>
  );
}

function BandNumberField(props: {
  readonly label: string;
  readonly value: number;
  readonly step: number;
  readonly onChange: (value: number) => void;
}) {
  return (
    <label>
      <span>{props.label}</span>
      <input
        type="number"
        step={props.step}
        value={Number(props.value.toFixed(2))}
        onChange={(event) => props.onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

function BandTextField(props: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void }) {
  return (
    <label>
      <span>{props.label}</span>
      <input value={props.value} onChange={(event) => props.onChange(event.currentTarget.value)} />
    </label>
  );
}

function SectorsFields(props: ToolInspectorProps) {
  return (
    <>
      <label>
        <span>Overlay</span>
        <select
          value={props.analysisOverlay}
          onChange={(event) => props.onSetAnalysisOverlay(event.currentTarget.value as AnalysisOverlayMode)}
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
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={props.overlayOpacity}
          onChange={(event) => props.onSetOverlayOpacity(Number(event.currentTarget.value))}
        />
      </label>
      <div className="tool-row">
        <span>Curvature</span>
        <strong>{props.analysis.curvatureRange.map((value) => value.toFixed(3)).join('..')}</strong>
      </div>
      <div className="tool-row">
        <span>Grade</span>
        <strong>{props.analysis.gradeRange.map((value) => value.toFixed(1)).join('..')}%</strong>
      </div>
      <div className="tool-row">
        <span>Sector</span>
        <strong>{props.currentSector?.name ?? '-'}</strong>
      </div>
    </>
  );
}

function TerrainFields(props: ToolInspectorProps) {
  const paint = props.activeTool === 'Paint';
  const { terrainBrush } = props;
  return (
    <>
      <label>
        <span>Brush</span>
        <input
          type="checkbox"
          checked={terrainBrush.active}
          onChange={(event) => props.onSetTerrainBrushActive(event.currentTarget.checked)}
        />
      </label>
      <label>
        <span>Type</span>
        <select
          value={terrainBrush.type}
          onChange={(event) => props.onUpdateTerrainBrush('type', event.currentTarget.value as TerrainBrushType)}
        >
          {paint ? (
            <option value="material">material</option>
          ) : (
            <>
              <option value="raise">raise</option>
              <option value="lower">lower</option>
              <option value="smooth">smooth</option>
              <option value="flatten">flatten</option>
            </>
          )}
        </select>
      </label>
      <label>
        <span>Radius</span>
        <input
          type="range"
          min="2"
          max="60"
          step="1"
          value={terrainBrush.radius}
          onChange={(event) => props.onUpdateTerrainBrush('radius', Number(event.currentTarget.value))}
        />
      </label>
      <label>
        <span>Strength</span>
        <input
          type="number"
          min="0"
          step="0.1"
          value={terrainBrush.strength}
          onChange={(event) => props.onUpdateTerrainBrush('strength', Number(event.currentTarget.value))}
        />
      </label>
      <label>
        <span>Falloff</span>
        <select
          value={terrainBrush.falloff}
          onChange={(event) => props.onUpdateTerrainBrush('falloff', event.currentTarget.value as TerrainBrushFalloff)}
        >
          <option value="smooth">smooth</option>
          <option value="linear">linear</option>
          <option value="constant">constant</option>
        </select>
      </label>
      {paint ? (
        <label>
          <span>Material</span>
          <select
            value={terrainBrush.targetMaterial ?? 'gravel'}
            onChange={(event) => props.onUpdateTerrainBrush('targetMaterial', event.currentTarget.value)}
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
            type="number"
            step="0.5"
            value={terrainBrush.targetHeight ?? 0}
            onChange={(event) => props.onUpdateTerrainBrush('targetHeight', Number(event.currentTarget.value))}
          />
        </label>
      )}
      <button type="button" onClick={props.onStrokeTerrain}>Stroke terrain</button>
    </>
  );
}

function DriveFields(props: ToolInspectorProps) {
  return (
    <>
      <div className="tool-row">
        <button type="button" onClick={props.onTogglePlaying}>
          {props.isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button type="button" onClick={props.onResetCar}>
          <RotateCcw size={14} />
        </button>
        <button type="button" onClick={props.onCycleCamera}>
          <Scan size={14} />
        </button>
      </div>
      <label>
        <span>Speed</span>
        <input
          type="range"
          min="2"
          max="80"
          value={props.speed}
          onChange={(event) => props.onSetSpeed(Number(event.currentTarget.value))}
        />
      </label>
      <div className="tool-row">
        <span>Camera</span>
        <strong>{props.cameraMode}</strong>
      </div>
    </>
  );
}
