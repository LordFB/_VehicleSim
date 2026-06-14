import './styles.css';
import { Game } from './core/Game';
import { gameState } from './core/GameState';

const container = document.getElementById('game-container');

if (!container) {
  throw new Error('Missing #game-container');
}

const game = new Game(container);

// Test/debug seam: expose live state + game for automated checks (opt-in only).
if (new URLSearchParams(window.location.search).has('debug')) {
  (window as unknown as { __sim: typeof gameState; __game: Game }).__sim = gameState;
  (window as unknown as { __sim: typeof gameState; __game: Game }).__game = game;
}

window.addEventListener('beforeunload', () => game.dispose());
