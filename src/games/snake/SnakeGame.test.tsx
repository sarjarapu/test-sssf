import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SnakeGame from './SnakeGame';
import { snake } from './index';

// jsdom has no 2D context; a fake keeps the draw path executing in the test.
function fakeContext() {
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
}

function renderGame() {
  return render(
    <MemoryRouter>
      <SnakeGame game={snake} />
    </MemoryRouter>,
  );
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('SnakeGame', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      fakeContext(),
    );
    // Deterministic apple: freeCells()[0] is well away from the snake's path.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    window.localStorage.clear();
    vi.useFakeTimers();
  });

  const hud = () => document.querySelector('.snake__hud');

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders the board and a zeroed HUD', () => {
    renderGame();
    expect(
      screen.getByRole('img', { name: /snake board/i }),
    ).toBeInTheDocument();
    expect(hud()).toHaveTextContent('Score: 0');
  });

  it('advancing ticks does not change the score on its own or throw', () => {
    renderGame();
    advance(110 * 5);
    expect(hud()).toHaveTextContent('Score: 0');
  });

  it('driving into the top wall ends the run with a Play Again button', () => {
    renderGame();
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    advance(110 * 15);

    expect(screen.getByText('Game Over')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /play again/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/game over/i);
  });

  it('Play Again clears the overlay and resets the HUD', () => {
    renderGame();
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    advance(110 * 15);

    fireEvent.click(screen.getByRole('button', { name: /play again/i }));

    expect(screen.queryByText('Game Over')).not.toBeInTheDocument();
    expect(hud()).toHaveTextContent('Score: 0');
  });

  it('Space pauses the game and further ticks leave it unchanged', () => {
    renderGame();
    fireEvent.keyDown(window, { key: ' ' });

    expect(screen.getByRole('status')).toHaveTextContent(/paused/i);

    advance(110 * 10);
    expect(screen.getByRole('status')).toHaveTextContent(/paused/i);
  });
});
