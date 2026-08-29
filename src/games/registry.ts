import type { Game } from '../types/game';
import { snake } from './snake';
import { ticTacToe } from './tic-tac-toe';

export const GAMES: Game[] = [ticTacToe, snake];

export function getGameById(id: string | undefined): Game | undefined {
  return GAMES.find((game) => game.id === id);
}
