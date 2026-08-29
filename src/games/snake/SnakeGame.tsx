import { useCallback, useEffect, useRef, useState } from 'react';
import GameLayout from '../../components/GameLayout';
import { useGameSettings } from '../../hooks/useGameSettings';
import { useHighScore } from '../../hooks/useHighScore';
import type { GameComponentProps } from '../../types/game';
import {
  createInitialState,
  enqueueDirection,
  GRID_COLS,
  GRID_ROWS,
  step,
  togglePause,
  type Direction,
  type SnakeState,
  type SnakeStatus,
} from './logic';
import './snake.css';

const CELL = 22; // px per grid cell
const WIDTH = GRID_COLS * CELL; // 440
const HEIGHT = GRID_ROWS * CELL; // 440
const SPEEDS: Record<string, number> = { chill: 160, classic: 110, fast: 75 };

const BOARD_BG = '#0b0c1c';
const GRID_LINE = 'rgba(38, 42, 82, 0.9)';
const APPLE_COLOR = '#ef4444';
const SNAKE_BODY = '#4ade80';
const SNAKE_HEAD = '#16a34a';

interface View {
  score: number;
  status: SnakeStatus;
}

// Maps a lower-cased KeyboardEvent.key to a direction (arrows + WASD).
const KEY_DIRECTIONS: Record<string, Direction> = {
  arrowup: 'up',
  w: 'up',
  arrowdown: 'down',
  s: 'down',
  arrowleft: 'left',
  a: 'left',
  arrowright: 'right',
  d: 'right',
};

function statusText(view: View, highScore: number | null): string {
  switch (view.status) {
    case 'over':
      return `Game over — final score ${view.score}`;
    case 'won':
      return `You filled the board! Final score ${view.score}`;
    case 'paused':
      return 'Paused — press Space to resume';
    default:
      return `Score: ${view.score} · Best: ${highScore ?? 0}`;
  }
}

export default function SnakeGame({ game }: GameComponentProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<SnakeState>(createInitialState());
  const submittedRef = useRef(false);

  const [view, setView] = useState<View>(() => ({ score: 0, status: 'playing' }));

  const { values, setValue, reset } = useGameSettings(game);
  const { highScore, submitScore } = useHighScore(game);

  // Imperative canvas render. Guarded because jsdom has no real 2D context.
  const draw = useCallback(
    (state: SnakeState) => {
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;

      ctx.fillStyle = BOARD_BG;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      if (values.grid === true) {
        ctx.strokeStyle = GRID_LINE;
        ctx.lineWidth = 1;
        for (let x = 1; x < GRID_COLS; x += 1) {
          ctx.beginPath();
          ctx.moveTo(x * CELL, 0);
          ctx.lineTo(x * CELL, HEIGHT);
          ctx.stroke();
        }
        for (let y = 1; y < GRID_ROWS; y += 1) {
          ctx.beginPath();
          ctx.moveTo(0, y * CELL);
          ctx.lineTo(WIDTH, y * CELL);
          ctx.stroke();
        }
      }

      if (state.apple) {
        ctx.fillStyle = APPLE_COLOR;
        ctx.beginPath();
        ctx.arc(
          state.apple.x * CELL + CELL / 2,
          state.apple.y * CELL + CELL / 2,
          CELL / 2 - 2,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }

      state.snake.forEach((segment, index) => {
        // Darker head so the direction of travel reads at a glance.
        ctx.fillStyle = index === 0 ? SNAKE_HEAD : SNAKE_BODY;
        ctx.fillRect(segment.x * CELL + 1, segment.y * CELL + 1, CELL - 2, CELL - 2);
      });
    },
    [values.grid],
  );

  const restart = useCallback(() => {
    stateRef.current = createInitialState();
    submittedRef.current = false;
    setView({ score: 0, status: 'playing' });
    draw(stateRef.current);
  }, [draw]);

  // One tick of the loop: advance the pure state, redraw, and only touch React
  // state when the score or status actually changed.
  const tick = useCallback(() => {
    const next = step(stateRef.current);
    stateRef.current = next;
    draw(next);
    setView((prev) =>
      prev.score === next.score && prev.status === next.status
        ? prev
        : { score: next.score, status: next.status },
    );
    if (
      (next.status === 'over' || next.status === 'won') &&
      !submittedRef.current
    ) {
      submittedRef.current = true;
      submitScore(next.score);
    }
  }, [draw, submitScore]);

  // Fixed-interval game loop. Re-created only when the speed setting changes; a
  // paused or finished game is skipped rather than stepped.
  useEffect(() => {
    const speed = SPEEDS[values.speed as string] ?? 110;
    const id = window.setInterval(() => {
      if (stateRef.current.status !== 'playing') return;
      tick();
    }, speed);
    return () => window.clearInterval(id);
  }, [tick, values.speed]);

  // Redraw on mount and whenever the grid setting toggles (draw changes then).
  useEffect(() => {
    draw(stateRef.current);
  }, [draw]);

  // Pause a running game when the tab is hidden.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && stateRef.current.status === 'playing') {
        stateRef.current = togglePause(stateRef.current);
        setView({
          score: stateRef.current.score,
          status: stateRef.current.status,
        });
        draw(stateRef.current);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [draw]);

  // Input: attached once, reads/writes the live state through stateRef.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const direction = KEY_DIRECTIONS[key];

      if (direction) {
        event.preventDefault(); // arrows scroll the page otherwise
        const nextState = enqueueDirection(stateRef.current, direction);
        if (nextState !== stateRef.current) stateRef.current = nextState;
        return;
      }

      if (key === ' ' || key === 'spacebar' || key === 'p' || key === 'enter') {
        event.preventDefault(); // Space scrolls the page otherwise
        const current = stateRef.current;
        if (current.status === 'over' || current.status === 'won') {
          restart();
          return;
        }
        if (key === 'enter') return; // Enter only restarts a finished game
        stateRef.current = togglePause(current);
        setView({
          score: stateRef.current.score,
          status: stateRef.current.status,
        });
        draw(stateRef.current);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [draw, restart]);

  const isFinished = view.status === 'over' || view.status === 'won';

  return (
    <GameLayout
      game={game}
      status={statusText(view, highScore)}
      onRestart={restart}
      settings={{ values, setValue, reset }}
    >
      <div className="snake">
        <div className="snake__hud">
          Score: {view.score} · Best: {highScore ?? 0}
        </div>
        <div className="snake__stage">
          <canvas
            ref={canvasRef}
            width={WIDTH}
            height={HEIGHT}
            className="snake__canvas"
            role="img"
            aria-label={`Snake board, score ${view.score}`}
          />
          {isFinished && (
            <div className="snake__overlay">
              <p className="snake__overlay-title">
                {view.status === 'won' ? 'You filled the board!' : 'Game Over'}
              </p>
              <p className="snake__overlay-score">Final score: {view.score}</p>
              <button type="button" onClick={restart}>
                Play Again
              </button>
            </div>
          )}
          {view.status === 'paused' && (
            <div className="snake__overlay">Paused</div>
          )}
        </div>
      </div>
    </GameLayout>
  );
}
