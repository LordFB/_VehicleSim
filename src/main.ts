import './styles.css';
import { Game } from './core/Game';
import { gameState } from './core/GameState';
import { getTrackDefinitionForBrowser } from './level/tracks';

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

  // Test/debug seam: expose live state + game for automated checks (opt-in only).
  if (new URLSearchParams(window.location.search).has('debug')) {
    (window as unknown as { __sim: typeof gameState; __game: Game }).__sim = gameState;
    (window as unknown as { __sim: typeof gameState; __game: Game }).__game = game;
  }

  window.addEventListener('beforeunload', () => game.dispose());
}
