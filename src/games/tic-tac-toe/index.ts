import type { Game } from '../../types/game';
import TicTacToeGame from './TicTacToeGame';

export const ticTacToe: Game = {
  id: 'tic-tac-toe',
  title: 'Tic-Tac-Toe',
  description: 'Classic hot-seat three-in-a-row for two players.',
  thumbnail: '⭕',
  component: TicTacToeGame,
  controls: [
    { action: 'Take your turn', how: 'Click or tap an empty square' },
    { action: 'Play again', how: 'Press Restart at the top' },
    { action: 'Leave the game', how: 'Press Back to Home' },
  ],
};
