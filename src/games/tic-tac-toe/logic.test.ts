import { describe, it, expect } from 'vitest';
import {
  applyMove,
  createEmptyBoard,
  currentPlayer,
  getWinner,
  isDraw,
  WINNING_LINES,
  type Board,
  type Player,
} from './logic';

function boardFromLine(line: readonly number[], player: Player): Board {
  const board = createEmptyBoard();
  for (const i of line) board[i] = player;
  return board;
}

describe('getWinner', () => {
  for (const player of ['X', 'O'] as Player[]) {
    WINNING_LINES.forEach((line) => {
      it(`detects ${player} winning on line ${line.join('')}`, () => {
        const result = getWinner(boardFromLine(line, player));
        expect(result).not.toBeNull();
        expect(result?.winner).toBe(player);
        expect(result?.line).toEqual(line);
      });
    });
  }

  it('no winner on an empty board', () => {
    expect(getWinner(createEmptyBoard())).toBeNull();
  });

  it('no winner on an in-progress board', () => {
    const board: Board = ['X', 'O', 'X', null, 'O', null, null, null, null];
    expect(getWinner(board)).toBeNull();
  });
});

describe('isDraw', () => {
  it('detects a draw on a full board with no line', () => {
    const board: Board = ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'];
    expect(isDraw(board)).toBe(true);
  });

  it('is not a draw when the full board has a winner', () => {
    const board: Board = ['X', 'X', 'X', 'O', 'O', 'X', 'O', 'X', 'O'];
    expect(isDraw(board)).toBe(false);
  });
});

describe('currentPlayer', () => {
  it('alternates X -> O -> X', () => {
    let board = createEmptyBoard();
    expect(currentPlayer(board)).toBe('X');
    board = applyMove(board, 0, 'X');
    expect(currentPlayer(board)).toBe('O');
    board = applyMove(board, 1, 'O');
    expect(currentPlayer(board)).toBe('X');
  });
});

describe('applyMove', () => {
  it('writes the mark', () => {
    const board = createEmptyBoard();
    const next = applyMove(board, 4, 'X');
    expect(next[4]).toBe('X');
    expect(next).not.toBe(board);
  });

  it('returns the same board for an occupied cell', () => {
    const board = applyMove(createEmptyBoard(), 4, 'X');
    expect(applyMove(board, 4, 'O')).toBe(board);
  });

  it('returns the same board for an out-of-range index', () => {
    const board = createEmptyBoard();
    expect(applyMove(board, 9, 'X')).toBe(board);
    expect(applyMove(board, -1, 'X')).toBe(board);
  });

  it('returns the same board for a move after the game is won', () => {
    const board = boardFromLine([0, 1, 2], 'X');
    expect(applyMove(board, 5, 'O')).toBe(board);
  });
});
