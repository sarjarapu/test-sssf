import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  enqueueDirection,
  freeCells,
  hitsBody,
  INITIAL_LENGTH,
  isOpposite,
  samePoint,
  spawnApple,
  step,
  type Direction,
  type Point,
  type SnakeState,
} from './logic';

const zeroRng = () => 0;

function stateWith(overrides: Partial<SnakeState>): SnakeState {
  return {
    snake: [
      { x: 10, y: 10 },
      { x: 9, y: 10 },
      { x: 8, y: 10 },
    ],
    direction: 'right',
    pending: [],
    apple: null,
    score: 0,
    status: 'playing',
    ...overrides,
  };
}

describe('createInitialState', () => {
  it('gives a snake of INITIAL_LENGTH, score 0, and an apple off the snake', () => {
    const state = createInitialState(zeroRng);
    expect(state.snake).toHaveLength(INITIAL_LENGTH);
    expect(state.score).toBe(0);
    expect(state.status).toBe('playing');
    expect(state.apple).not.toBeNull();
    expect(hitsBody(state.apple as Point, state.snake)).toBe(false);
  });
});

describe('step — movement', () => {
  it('moving right advances the head by one and keeps the length constant', () => {
    const state = stateWith({});
    const next = step(state, zeroRng);
    expect(next.snake[0]).toEqual({ x: 11, y: 10 });
    expect(next.snake).toHaveLength(INITIAL_LENGTH);
  });

  it('eating an apple grows the snake, bumps the score, and spawns a fresh apple', () => {
    const state = stateWith({ apple: { x: 11, y: 10 } });
    const next = step(state, zeroRng);
    expect(next.snake).toHaveLength(INITIAL_LENGTH + 1);
    expect(next.score).toBe(1);
    expect(next.apple).not.toBeNull();
    expect(hitsBody(next.apple as Point, next.snake)).toBe(false);
  });
});

describe('step — collisions', () => {
  it('dies on the right wall', () => {
    const state = stateWith({
      snake: [
        { x: 19, y: 10 },
        { x: 18, y: 10 },
        { x: 17, y: 10 },
      ],
      direction: 'right',
    });
    expect(step(state, zeroRng).status).toBe('over');
  });

  it('dies on the left wall', () => {
    const state = stateWith({
      snake: [
        { x: 0, y: 10 },
        { x: 1, y: 10 },
        { x: 2, y: 10 },
      ],
      direction: 'left',
    });
    expect(step(state, zeroRng).status).toBe('over');
  });

  it('dies on the top wall', () => {
    const state = stateWith({
      snake: [
        { x: 10, y: 0 },
        { x: 10, y: 1 },
        { x: 10, y: 2 },
      ],
      direction: 'up',
    });
    expect(step(state, zeroRng).status).toBe('over');
  });

  it('dies on the bottom wall', () => {
    const state = stateWith({
      snake: [
        { x: 10, y: 19 },
        { x: 10, y: 18 },
        { x: 10, y: 17 },
      ],
      direction: 'down',
    });
    expect(step(state, zeroRng).status).toBe('over');
  });

  it('dies when a coiled snake bites itself', () => {
    // Head at (11,10); turning right drives it into a mid-body segment (12,10).
    const state = stateWith({
      snake: [
        { x: 11, y: 10 },
        { x: 11, y: 11 },
        { x: 11, y: 12 },
        { x: 12, y: 12 },
        { x: 12, y: 11 },
        { x: 12, y: 10 },
        { x: 12, y: 9 },
      ],
      direction: 'up',
      pending: ['right'],
    });
    // head (11,10) moving right -> (12,10), a body cell (not the tail) -> over
    expect(step(state, zeroRng).status).toBe('over');
  });

  it('tail-follow does not kill', () => {
    // Head chases the cell the tail is leaving on a non-growing tick.
    const state = stateWith({
      snake: [
        { x: 11, y: 10 },
        { x: 11, y: 11 },
        { x: 10, y: 11 },
        { x: 10, y: 10 },
      ],
      direction: 'up',
      pending: ['left'],
      apple: null,
    });
    // moving left: head -> (10,10), tail (10,10) vacates first -> legal
    const next = step(state, zeroRng);
    expect(next.status).toBe('playing');
    expect(next.snake[0]).toEqual({ x: 10, y: 10 });
  });
});

describe('enqueueDirection', () => {
  it('isOpposite is true for all four pairs', () => {
    const pairs: [Direction, Direction][] = [
      ['up', 'down'],
      ['down', 'up'],
      ['left', 'right'],
      ['right', 'left'],
    ];
    for (const [a, b] of pairs) expect(isOpposite(a, b)).toBe(true);
    expect(isOpposite('up', 'left')).toBe(false);
  });

  it('ignores a direct reversal (same object reference back)', () => {
    const state = stateWith({ direction: 'right' });
    expect(enqueueDirection(state, 'left')).toBe(state);
  });

  it('ignores a no-op press of the current direction', () => {
    const state = stateWith({ direction: 'right' });
    expect(enqueueDirection(state, 'right')).toBe(state);
  });

  it('ignores any input after game over', () => {
    const state = stateWith({ status: 'over' });
    expect(enqueueDirection(state, 'up')).toBe(state);
  });

  it('rejects a queued-turn reversal against the last queued direction', () => {
    // Moving right, queue 'up'; a following 'down' would reverse the just-queued
    // turn, so it must be dropped even though 'down' is legal against 'right'.
    let state = stateWith({ direction: 'right' });
    state = enqueueDirection(state, 'up');
    state = enqueueDirection(state, 'down');
    expect(state.pending).toEqual(['up']);
  });

  it('queues two legal turns and caps there', () => {
    let state = stateWith({ direction: 'right' });
    state = enqueueDirection(state, 'up'); // ['up']
    state = enqueueDirection(state, 'left'); // ['up', 'left'] — a tight corner
    state = enqueueDirection(state, 'down'); // dropped: queue already full
    expect(state.pending).toEqual(['up', 'left']);
  });
});

describe('spawnApple / won', () => {
  it('returns a deterministic free cell with a stub rng', () => {
    const snake: Point[] = [{ x: 0, y: 0 }];
    const apple = spawnApple(snake, zeroRng);
    // first free cell in row-major order is (1,0)
    expect(apple).toEqual({ x: 1, y: 0 });
  });

  it('returns null when the snake covers every cell', () => {
    const full: Point[] = [];
    for (let y = 0; y < 20; y += 1) {
      for (let x = 0; x < 20; x += 1) full.push({ x, y });
    }
    expect(freeCells(full)).toHaveLength(0);
    expect(spawnApple(full, zeroRng)).toBeNull();
  });

  it('stepping into the last free cell sets status "won"', () => {
    // Snake fills every cell except (0,0); head at (1,0) moving left onto the
    // apple there fills the board.
    const head: Point = { x: 1, y: 0 };
    const rest: Point[] = [];
    for (let y = 0; y < 20; y += 1) {
      for (let x = 0; x < 20; x += 1) {
        if (x === 0 && y === 0) continue;
        if (x === 1 && y === 0) continue;
        rest.push({ x, y });
      }
    }
    const state = stateWith({
      snake: [head, ...rest],
      direction: 'left',
      apple: { x: 0, y: 0 },
    });
    const next = step(state, zeroRng);
    expect(next.status).toBe('won');
    expect(next.apple).toBeNull();
    expect(next.score).toBe(1);
  });
});

describe('step — inert states', () => {
  it('returns an "over" state unchanged', () => {
    const state = stateWith({ status: 'over' });
    expect(step(state, zeroRng)).toBe(state);
  });

  it('returns a "paused" state unchanged', () => {
    const state = stateWith({ status: 'paused' });
    expect(step(state, zeroRng)).toBe(state);
  });
});

describe('samePoint', () => {
  it('compares by value', () => {
    expect(samePoint({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
    expect(samePoint({ x: 1, y: 2 }, { x: 2, y: 1 })).toBe(false);
  });
});
