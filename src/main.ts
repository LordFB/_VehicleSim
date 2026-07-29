import './styles.css';
import { Game } from './core/Game';
import { gameState } from './core/GameState';
import { getTrackDefinitionForBrowser } from './level/tracks';
import {
  TRACKPRINT_PACKAGE_EXTENSION,
  decodeTrackPrintPackage,
  isTrackPrintPackageBytes,
} from './level/trackprintPackage';
import { saveTrackPrintPreviewTrackForBrowser } from './level/trackprintPreviewStorage';

const container = document.getElementById('game-container');

if (!container) {
  throw new Error('Missing #game-container');
}

if (window.location.pathname === '/track-editor') {
  void import('./editor/trackprint/mount').then(({ mountTrackPrintEditor }) => {
    mountTrackPrintEditor(container);
  });
} else {
  void bootGame(container);
}

async function bootGame(container: HTMLElement): Promise<void> {
  const track = await getTrackDefinitionForBrowser(new URLSearchParams(window.location.search));
  const game = new Game(container, track);
  const disposePackageDrop = installTrackPrintPackageDrop();

  // Test/debug seam: expose live state + game for automated checks (opt-in only).
  if (new URLSearchParams(window.location.search).has('debug')) {
    (window as unknown as { __sim: typeof gameState; __game: Game }).__sim = gameState;
    (window as unknown as { __sim: typeof gameState; __game: Game }).__game = game;
  }

  window.addEventListener('beforeunload', () => {
    disposePackageDrop();
    game.dispose();
  });
}

function installTrackPrintPackageDrop(): () => void {
  const onDragOver = (event: DragEvent) => {
    if (hasFileDrag(event.dataTransfer)) {
      event.preventDefault();
    }
  };
  const onDrop = (event: DragEvent) => {
    const file = findTrackPrintPackageFile(event.dataTransfer?.files);
    if (!file) return;
    event.preventDefault();
    void loadDroppedTrackPrintPackage(file);
  };
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('drop', onDrop);
  return () => {
    window.removeEventListener('dragover', onDragOver);
    window.removeEventListener('drop', onDrop);
  };
}

async function loadDroppedTrackPrintPackage(file: File): Promise<void> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isTrackPrintPackageBytes(bytes)) {
      throw new Error(`${file.name} is not a TrackPrint .tp package.`);
    }
    const decoded = decodeTrackPrintPackage(bytes);
    await saveTrackPrintPreviewTrackForBrowser(decoded.track);
    const target = new URL(window.location.href);
    target.pathname = '/simulator.html';
    target.searchParams.set('track', 'trackprint');
    window.location.assign(target.toString());
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Dropped TrackPrint package could not be loaded.');
  }
}

function hasFileDrag(dataTransfer: DataTransfer | null): boolean {
  return Array.from(dataTransfer?.types ?? []).includes('Files');
}

function findTrackPrintPackageFile(files: FileList | undefined): File | null {
  if (!files) return null;
  return Array.from(files).find((file) => file.name.toLowerCase().endsWith(TRACKPRINT_PACKAGE_EXTENSION)) ?? null;
}
