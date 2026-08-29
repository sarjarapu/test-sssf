// Pure Snake rules — no React, no baked-in randomness. Every function that
// randomises takes `rng` as its last parameter so tests can pass a stub.

export const GRID_COLS = 20;
export const GRID_ROWS = 20;

export type Direction = 'up' | 'down' | 'left' | 'right';
export interface Point {
  x: number;
  y: number;
}

export type SnakeStatus = 'playing' | 'paused' | 'over' | 'won';

export interface SnakeState {
  snake: Point[]; // head first, tail last
  direction: Direction; // the direction the last step actually moved
  pending: Direction[]; // queued turns, max 2
  apple: Point | null; // null only when the board is full ('won')
  score: number; // apples eaten; also snake.length - INITIAL_LENGTH
  status: SnakeStatus;
}

export const DIRECTION_VECTORS: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export const INITIAL_LENGTH = 3;

export function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

export function isOpposite(a: Direction, b: Direction): boolean {
  const va = DIRECTION_VECTORS[a];
  const vb = DIRECTION_VECTORS[b];
  return va.x === -vb.x && va.y === -vb.y;
}

export function hitsWall(p: Point): boolean {
  return p.x < 0 || p.y < 0 || p.x >= GRID_COLS || p.y >= GRID_ROWS;
}

export function hitsBody(p: Point, body: Point[]): boolean {
  return body.some((segment) => samePoint(segment, p));
}

// Every cell not currently occupied by the snake.
export function freeCells(snake: Point[]): Point[] {
  const occupied = new Set(snake.map((p) => `${p.x},${p.y}`));
  const free: Point[] = [];
  for (let y = 0; y < GRID_ROWS; y += 1) {
    for (let x = 0; x < GRID_COLS; x += 1) {
      if (!occupied.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  return free;
}

// Uniformly pick a free cell. Returns null when the board is full. No
// retry-until-free sampling — it degenerates near a full board.
export function spawnApple(
  snake: Point[],
  rng: () => number = Math.random,
): Point | null {
  const free = freeCells(snake);
  if (free.length === 0) return null;
  return free[Math.floor(rng() * free.length)];
}

export function createInitialState(rng: () => number = Math.random): SnakeState {
  // Length-3 snake lying horizontally at the vertical centre, head to the
  // right, so the opening direction is safe.
  const snake: Point[] = [
    { x: 10, y: 10 },
    { x: 9, y: 10 },
    { x: 8, y: 10 },
  ];
  return {
    snake,
    direction: 'right',
    pending: [],
    apple: spawnApple(snake, rng),
    score: 0,
    status: 'playing',
  };
}

// Input handling with no 180° turns. Non-mutating; returns the same object
// reference when the input is ignored so the caller can cheaply skip work.
export function enqueueDirection(state: SnakeState, dir: Direction): SnakeState {
  if (state.status === 'over' || state.status === 'won') return state;

  // Compare against the last queued direction if the queue is non-empty,
  // otherwise the direction the snake is actually moving. Comparing only
  // against state.direction would let Up-then-Left within one tick reverse the
  // snake into its own neck.
  const reference =
    state.pending.length > 0
      ? state.pending[state.pending.length - 1]
      : state.direction;

  if (dir === reference || isOpposite(dir, reference)) return state;

  const pending = [...state.pending, dir].slice(0, 2);
  return { ...state, pending };
}

export function togglePause(state: SnakeState): SnakeState {
  if (state.status === 'playing') return { ...state, status: 'paused' };
  if (state.status === 'paused') return { ...state, status: 'playing' };
  return state;
}

// One tick of the game loop.
export function step(
  state: SnakeState,
  rng: () => number = Math.random,
): SnakeState {
  if (state.status !== 'playing') return state;

  const direction = state.pending.length ? state.pending[0] : state.direction;
  const pending = state.pending.slice(1);

  const vector = DIRECTION_VECTORS[direction];
  const head: Point = {
    x: state.snake[0].x + vector.x,
    y: state.snake[0].y + vector.y,
  };

  // Wall check precedes the self check.
  if (hitsWall(head)) {
    return { ...state, direction, pending, status: 'over' };
  }

  const grow = state.apple !== null && samePoint(head, state.apple);
  // On a non-growing tick the tail vacates its cell *before* the self-collision
  // check, so following your own tail is legal.
  const body = grow ? state.snake : state.snake.slice(0, -1);

  if (hitsBody(head, body)) {
    return { ...state, direction, pending, status: 'over' };
  }

  const nextSnake = [head, ...body];

  if (grow) {
    const apple = spawnApple(nextSnake, rng);
    return {
      ...state,
      snake: nextSnake,
      direction,
      pending,
      apple,
      score: state.score + 1,
      status: apple === null ? 'won' : 'playing',
    };
  }

  return { ...state, snake: nextSnake, direction, pending };
}
