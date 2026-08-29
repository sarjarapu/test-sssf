import { useMemo, useState } from 'react';
import GameLayout from '../../components/GameLayout';
import type { GameComponentProps } from '../../types/game';
import {
  applyMove,
  createEmptyBoard,
  getGameStatus,
  type Board,
  type GameStatus,
  type Player,
} from './logic';
import './ticTacToe.css';

interface Tally {
  X: number;
  O: number;
  draws: number;
}

const PLAYER_LABEL: Record<Player, string> = {
  X: 'Player 1 (X)',
  O: 'Player 2 (O)',
};

function statusText(status: GameStatus): string {
  switch (status.kind) {
    case 'playing':
      return `${PLAYER_LABEL[status.turn]}'s turn`;
    case 'won':
      return `${PLAYER_LABEL[status.winner]} wins!`;
    case 'draw':
      return "It's a draw!";
  }
}

function cellLabel(row: number, col: number, value: Board[number]): string {
  const occupant = value ? value : 'empty';
  return `Row ${row}, column ${col}, ${occupant}`;
}

export default function TicTacToeGame({ game }: GameComponentProps) {
  const [board, setBoard] = useState<Board>(createEmptyBoard);
  const [tally, setTally] = useState<Tally>({ X: 0, O: 0, draws: 0 });

  const status = useMemo(() => getGameStatus(board), [board]);
  const winningLine = status.kind === 'won' ? status.line : null;
  const gameOver = status.kind !== 'playing';

  function handleCellClick(index: number) {
    if (status.kind !== 'playing') return;
    const next = applyMove(board, index, status.turn);
    if (next === board) return;
    const nextStatus = getGameStatus(next);
    if (nextStatus.kind === 'won') {
      setTally((t) => ({ ...t, [nextStatus.winner]: t[nextStatus.winner] + 1 }));
    } else if (nextStatus.kind === 'draw') {
      setTally((t) => ({ ...t, draws: t.draws + 1 }));
    }
    setBoard(next);
  }

  function restart() {
    setBoard(createEmptyBoard());
  }

  return (
    <GameLayout game={game} status={statusText(status)} onRestart={restart}>
      <div className="ttt">
        <p className="ttt__tally">
          X wins: {tally.X} · O wins: {tally.O} · Draws: {tally.draws}
        </p>
        <div className="ttt__board" role="grid" aria-label="Tic-tac-toe board">
          {board.map((value, index) => {
            const row = Math.floor(index / 3) + 1;
            const col = (index % 3) + 1;
            const isWinning = winningLine?.includes(index) ?? false;
            return (
              <button
                key={index}
                type="button"
                role="gridcell"
                className={`ttt__cell${isWinning ? ' winning' : ''}`}
                aria-label={cellLabel(row, col, value)}
                disabled={value !== null || gameOver}
                onClick={() => handleCellClick(index)}
              >
                <span aria-hidden="true">{value}</span>
              </button>
            );
          })}
        </div>
      </div>
    </GameLayout>
  );
}
