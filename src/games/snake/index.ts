import type { Game } from '../../types/game';
import SnakeGame from './SnakeGame';

export const snake: Game = {
  id: 'snake',
  title: 'Snake',
  description: 'Eat apples, grow the tail, and never hit a wall.',
  thumbnail: '🐍',
  component: SnakeGame,
  hasHighScore: true,
  formatHighScore: (value) => `${value} apples`,
  controls: [
    { action: 'Move', how: 'Arrow keys or W A S D' },
    { action: 'Pause / resume', how: 'Press Space' },
    { action: 'Play again', how: 'Press Enter or the Play Again button' },
  ],
  settings: [
    {
      key: 'speed',
      label: 'Speed',
      type: 'select',
      default: 'classic',
      options: [
        { value: 'chill', label: 'Chill' },
        { value: 'classic', label: 'Classic' },
        { value: 'fast', label: 'Fast' },
      ],
    },
    { key: 'grid', label: 'Show grid lines', type: 'boolean', default: true },
  ],
};
