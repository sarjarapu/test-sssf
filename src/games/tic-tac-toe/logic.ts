export type Player = 'X' | 'O';
export type Cell = Player | null;
export type Board = Cell[];
export type Line = readonly [number, number, number];

export const WINNING_LINES: readonly Line[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export function createEmptyBoard(): Board {
  return Array<Cell>(9).fill(null);
}

export function currentPlayer(board: Board): Player {
  const filled = board.filter((c) => c !== null).length;
  return filled % 2 === 0 ? 'X' : 'O';
}

export function getWinner(board: Board): { winner: Player; line: Line } | null {
  for (const line of WINNING_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a] as Player, line };
    }
  }
  return null;
}

export function isDraw(board: Board): boolean {
  return board.every((c) => c !== null) && getWinner(board) === null;
}

export type GameStatus =
  | { kind: 'playing'; turn: Player }
  | { kind: 'won'; winner: Player; line: Line }
  | { kind: 'draw' };

export function getGameStatus(board: Board): GameStatus {
  const win = getWinner(board);
  if (win) return { kind: 'won', winner: win.winner, line: win.line };
  if (isDraw(board)) return { kind: 'draw' };
  return { kind: 'playing', turn: currentPlayer(board) };
}

export function applyMove(board: Board, index: number, player: Player): Board {
  if (index < 0 || index >= board.length) return board;
  if (board[index] !== null) return board;
  if (getGameStatus(board).kind !== 'playing') return board;
  const next = board.slice();
  next[index] = player;
  return next;
}
