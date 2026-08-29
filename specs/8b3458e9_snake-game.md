# Plan: Snake — canvas game for the Retro Arcade registry

## Context

The request (`requests/snake-game.md`) is a generic "write a browser Snake game"
prompt. It is being run inside **this** repo — a React + Vite arcade whose home
screen is driven by `src/games/registry.ts` — on branch `feat/snake`, which is
the exact scenario `app_docs/adding-a-game.md` documents ("add a Snake game:
arrow-key movement, growing tail, wall/self collision ends the run, high score").

**One deliberate deviation from the prompt.** The prompt asks for a single
self-contained `.html` file with inline `<style>`/`<script>`. That form cannot be
reached from this codebase: there is no route that serves a loose HTML file, a
second copy of the game logic would drift from the registry version, and the
home screen would not list it. So Snake ships as a **registry game** in
`src/games/snake/`, matching `src/games/tic-tac-toe/`. **Every gameplay,
rendering and UI requirement from the prompt is honoured** — HTML5 canvas
rendering, arrows + WASD, no 180° turns, apples that never spawn on the snake,
growth + score, wall and self collision ending the run, a Game Over message with
the final score and a restart affordance, a centered board with a distinct wall
border, green snake with a darker head, red apple, and comments on the loop,
collision detection and input handling. Do not build a standalone HTML file.

Toolchain is already live: call `npm` / `npx` bare.

## Decisions already made (do not re-litigate)

- **`setInterval` for the game loop, not `requestAnimationFrame`.** The prompt
  allows either. Snake is a discrete grid game with no interpolation between
  ticks, so a fixed-interval tick *is* the model, and it makes the component test
  deterministic under `vi.useFakeTimers()`. An rAF accumulator would buy nothing
  and make tests timing-flaky.
- **All game rules live in a pure `logic.ts`** with no React and no `Math.random`
  baked in (rng is an injectable parameter). This is the repo's convention and
  the only way to test spawn/collision behaviour deterministically.
- **The board renders to `<canvas>`**, but React state holds only `score`,
  `status` and `highScore` — the per-tick snake state lives in a `useRef` and is
  drawn imperatively. Do not `setState` the snake body every tick.
- **Plain CSS** in `src/games/snake/snake.css` using the existing tokens in
  `src/styles/global.css` (`--surface`, `--surface-2`, `--text-dim`, `--accent`,
  `--radius`, `--tap`). No new global tokens, no Tailwind.
- **No "walls wrap" setting.** Requirement 6 makes walls lethal; a wrap toggle
  would contradict it.

## Files

| File | Status | Purpose |
|---|---|---|
| `src/games/snake/logic.ts` | new | pure rules: state, step, collisions, apple spawn |
| `src/games/snake/logic.test.ts` | new | unit tests for the rules |
| `src/games/snake/SnakeGame.tsx` | new | component: canvas, loop, input, overlay |
| `src/games/snake/SnakeGame.test.tsx` | new | render/interaction test |
| `src/games/snake/snake.css` | new | board, canvas, overlay, HUD styles |
| `src/games/snake/index.ts` | new | the `Game` object |
| `src/games/registry.ts` | **edit** | add `snake` to `GAMES` |
| `README.md` | **edit** | one line: the arcade now ships two games |

Routing, home screen and navigation need **no edits** — the registry is the only
extension point (`src/screens/GameScreen.tsx` resolves by id).

---

## 1. `src/games/snake/logic.ts`

Pure module, no React import. Export exactly this surface:

```ts
export const GRID_COLS = 20;
export const GRID_ROWS = 20;

export type Direction = 'up' | 'down' | 'left' | 'right';
export interface Point { x: number; y: number }

export type SnakeStatus = 'playing' | 'paused' | 'over' | 'won';

export interface SnakeState {
  snake: Point[];        // head first, tail last
  direction: Direction;  // the direction the last step actually moved
  pending: Direction[];  // queued turns, max 2
  apple: Point | null;   // null only when the board is full ('won')
  score: number;         // apples eaten; also snake.length - INITIAL_LENGTH
  status: SnakeStatus;
}

export const DIRECTION_VECTORS: Record<Direction, Point>;
export const INITIAL_LENGTH = 3;

export function samePoint(a: Point, b: Point): boolean;
export function isOpposite(a: Direction, b: Direction): boolean;
export function hitsWall(p: Point): boolean;
export function hitsBody(p: Point, body: Point[]): boolean;
export function freeCells(snake: Point[]): Point[];
export function spawnApple(snake: Point[], rng?: () => number): Point | null;
export function createInitialState(rng?: () => number): SnakeState;
export function enqueueDirection(state: SnakeState, dir: Direction): SnakeState;
export function togglePause(state: SnakeState): SnakeState;
export function step(state: SnakeState, rng?: () => number): SnakeState;
```

Every function that randomises takes `rng: () => number = Math.random` as its
last parameter so tests can pass a stub.

### Initial state

Snake of length 3 lying horizontally at the vertical centre, head to the right,
so the opening direction is safe: `[{x:10,y:10},{x:9,y:10},{x:8,y:10}]`,
`direction: 'right'`, `pending: []`, `score: 0`, `status: 'playing'`, apple from
`spawnApple`.

### `enqueueDirection` — input handling (no 180° turns)

Pure and non-mutating; returns the same object reference when the input is
ignored so the caller can cheaply skip work.

- Ignore entirely when `status` is `'over'` or `'won'`.
- Compare against **the last queued direction if the queue is non-empty,
  otherwise `state.direction`.** This is the subtle part: comparing only against
  `state.direction` lets a player press Up-then-Left within one tick while moving
  right and reverse into themselves. Queue-aware comparison prevents it.
- Ignore if it equals that reference direction, or `isOpposite` of it.
- Cap `pending` at 2 entries (drop extras).

### `spawnApple` — never on the snake

Build the list of cells not occupied by the snake (`freeCells`) and pick one
uniformly: `free[Math.floor(rng() * free.length)]`. Return `null` when `free` is
empty. Do **not** use retry-until-free sampling — it degenerates near a full
board.

### `step` — one tick of the game loop

```
if status !== 'playing' -> return state unchanged
direction = pending.length ? pending[0] : state.direction
pending   = pending.slice(1)
head      = snake[0] + DIRECTION_VECTORS[direction]

if hitsWall(head)        -> { ...state, direction, pending, status: 'over' }

grow = apple !== null && samePoint(head, apple)
body = grow ? snake : snake.slice(0, -1)      // tail vacates its cell first

if hitsBody(head, body)  -> { ...state, direction, pending, status: 'over' }

nextSnake = [head, ...body]
if grow:  score + 1, apple = spawnApple(nextSnake, rng)
          if apple === null -> status 'won'
else:     score, apple unchanged
```

Two things the builder must get right and must be covered by tests:

1. **Tail-follow is legal.** The tail cell is removed *before* the self-collision
   check on a non-growing tick, so moving the head into the square the tail is
   leaving is not a crash. Checking against the un-popped body is the classic
   off-by-one bug here.
2. **Wall check precedes self check**, and neither runs when the game is already
   over — `step` on a finished state is a no-op.

## 2. `src/games/snake/logic.test.ts`

Vitest, mirroring `src/games/tic-tac-toe/logic.test.ts` in style. Cover:

- `createInitialState` gives length `INITIAL_LENGTH`, `score: 0`, an apple that
  is not on the snake.
- Moving right advances the head by one and keeps the length constant.
- Eating an apple: length +1, `score` +1, a new apple appears that is not on the
  snake body.
- Wall death on each of the four edges (walk the snake into each wall, or build a
  state with the head adjacent to the edge).
- Self collision: a coiled snake long enough to bite itself sets `status: 'over'`.
- **Tail-follow does not kill** — the regression test for the subtlety above.
- `isOpposite` for all four pairs; `enqueueDirection` ignores the reversal, the
  no-op same-direction press, and any input after game over.
- **Queued-turn reversal is rejected**: from `direction: 'right'`, enqueue `'up'`
  then `'left'` — `pending` must be `['up']` only.
- `spawnApple` with a stub rng returns a deterministic free cell; with a snake
  covering every cell it returns `null` and `step` into the last free cell sets
  `status: 'won'`.
- `step` on an `'over'` or `'paused'` state returns it unchanged.

## 3. `src/games/snake/SnakeGame.tsx`

Default-exported component taking `GameComponentProps`, rendering inside
`<GameLayout>` (status passed **down** as a prop — never push status up through
context/effects; see the README warning about the re-render loop).

### Constants

```ts
const CELL = 22;                       // px per grid cell
const WIDTH  = GRID_COLS * CELL;       // 440
const HEIGHT = GRID_ROWS * CELL;       // 440
const SPEEDS: Record<string, number> = { chill: 160, classic: 110, fast: 75 };
```

### State model

- `const stateRef = useRef<SnakeState>(createInitialState())` — the live game.
- React state mirrors only what the UI shows: `const [view, setView] =
  useState(() => ({ score: 0, status: 'playing' as SnakeStatus }))`. Update it
  from the tick **only when score or status actually changed**, so a normal tick
  causes zero React renders.
- `const { values, setValue, reset } = useGameSettings(game)` for speed / grid
  lines; `const { highScore, submitScore } = useHighScore(game)`.

### The game loop (`useEffect`)

`setInterval(tick, SPEEDS[values.speed as string] ?? 110)`, cleared on unmount
and re-created when the speed setting changes. `tick`:

1. `const next = step(stateRef.current); stateRef.current = next;`
2. `draw(next)`.
3. If `next.score !== view.score || next.status !== view.status`, `setView`.
4. On the transition into `'over'` / `'won'`, call `submitScore(next.score)`
   once. Guard with a ref flag so a re-render cannot double-submit.

Skip the interval entirely (or return early in `tick`) when `status` is not
`'playing'` — a paused or finished game must not keep stepping. Also add a
`visibilitychange` listener that pauses a running game when the tab is hidden.

### Input handling (`useEffect`, `window` keydown)

Attach once, read/write through `stateRef` so the handler never needs to
re-bind:

- `ArrowUp`/`w`/`W` → `'up'`, and the equivalents for down/left/right (`s`, `a`,
  `d`, case-insensitive).
- `Space` or `p`/`P`: toggle pause while playing; **when the game is over,
  restart** (also `Enter`).
- Call `preventDefault()` for every key handled — arrows and Space scroll the
  page otherwise.
- Direction keys go through `enqueueDirection`; if it returns the same reference,
  do nothing.

### Rendering (`draw(state)`) — canvas

Guard `const ctx = canvasRef.current?.getContext('2d'); if (!ctx) return;` —
jsdom has no real 2D context, and this guard is what keeps the component test
from throwing.

- Clear to the board background.
- Optional 1px grid lines when the `grid` setting is on (`--surface-2`-ish).
- Apple: red (`#ef4444`) circle (or filled rounded square) inset ~2px in its cell.
- Snake body: green `#4ade80`; **head a darker green `#16a34a`** (prompt
  requirement), each segment inset 1px so the blocks read as connected but
  distinct.
- The wall border is CSS on the canvas element, not a drawn rect.

Set the canvas `width`/`height` **attributes** to `WIDTH`/`HEIGHT` (backing
store) and let CSS size it responsively — do not set only CSS size, or the board
renders blurry/stretched.

### Markup

```tsx
<GameLayout
  game={game}
  status={statusText(view, highScore)}
  onRestart={restart}
  settings={{ values, setValue, reset }}
>
  <div className="snake">
    <div className="snake__hud">Score: {view.score} · Best: {highScore ?? 0}</div>
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
          <button type="button" onClick={restart}>Play Again</button>
        </div>
      )}
      {view.status === 'paused' && <div className="snake__overlay">Paused</div>}
    </div>
  </div>
</GameLayout>
```

`statusText` returns e.g. `Score: 3 · Best: 9`, `Paused — press Space to
resume`, `Game over — final score 7`. `restart()` sets
`stateRef.current = createInitialState()`, resets the submit-guard ref, sets
`view` back to `{score: 0, status: 'playing'}` and redraws. `GameLayout`'s own
Restart button and the overlay button both call it.

Accessibility: the overlay is plain markup — `GameLayout` already wraps the
status line in `role="status" aria-live="polite"`, so the game-over text is
announced from there. Do not add a second live region.

## 4. `src/games/snake/SnakeGame.test.tsx`

Render inside `<MemoryRouter>` like `TicTacToeGame.test.tsx`. Two setup details
make this deterministic:

- **Stub the 2D context** so the draw path executes instead of bailing:
  `vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx)`
  where `fakeCtx` is an object with `clearRect, fillRect, strokeRect, beginPath,
  moveTo, lineTo, stroke, arc, fill` as `vi.fn()` plus writable `fillStyle`,
  `strokeStyle`, `lineWidth`, cast
  `as unknown as CanvasRenderingContext2D`. Keep the fake's method list in sync
  with whatever `draw` actually calls.
- **Fake timers**: `vi.useFakeTimers()` in `beforeEach`, `vi.useRealTimers()` in
  `afterEach`. Advance with
  `act(() => { vi.advanceTimersByTime(ms); })`. Use `fireEvent.keyDown(window,
  { key: 'ArrowUp' })` for input — `userEvent` plus fake timers needs extra
  wiring and buys nothing here.

Assert:

1. Renders a canvas (`getByRole('img', { name: /snake board/i })`) and the HUD
   shows `Score: 0`.
2. Advancing several ticks does not change the score on its own and does not
   throw.
3. Driving the snake into the left wall (press `ArrowLeft`… it starts moving
   right, so instead press `ArrowUp` then advance ~10 ticks into the top wall)
   shows **Game Over** and a **Play Again** button.
4. **Play Again** clears the overlay and resets the HUD to `Score: 0`.
5. Space pauses: after `fireEvent.keyDown(window, { key: ' ' })` the status line
   reads paused, and further tick advancement leaves the board unchanged.

Prefer status/HUD text assertions over canvas-call assertions — the canvas is a
stub, and asserting on draw calls tests the stub, not the game.

## 5. `src/games/snake/index.ts`

```ts
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
```

## 6. `src/games/registry.ts`

```ts
import { snake } from './snake';
export const GAMES: Game[] = [ticTacToe, snake];
```

High score and settings persist automatically under
`retro-arcade:v1:snake:highScore` / `:settings` via `src/services/storage.ts`;
the home tile picks up `Best: N apples` with no further wiring.

## 7. `src/games/snake/snake.css`

- `.snake` — column flex, centered, `gap: 1rem`.
- `.snake__hud` — `var(--text-dim)`, `font-weight: 600`, tabular numerals.
- `.snake__stage` — `position: relative`, `width: fit-content`, `margin: 0 auto`
  (this is what centres the board).
- `.snake__canvas` — `display: block`, `background: #0b0c1c`,
  **`border: 4px solid var(--accent)`** (the "distinct wall border"),
  `border-radius: var(--radius)`, `max-width: 100%`, `height: auto`,
  `touch-action: none`.
- `.snake__overlay` — absolutely positioned over the stage, centered flex column,
  translucent dark backdrop (`rgba(15, 16, 32, 0.82)`), `border-radius` matching
  the canvas, `gap: .75rem`.

## Verification

```bash
npm run lint && npx tsc -b && npm test && npm run build
```

All four must be green — `just preview` and `just release` run the same gate.
Judge each by its exit status, not by words in its output.

Then manually:

```bash
npm run dev     # http://localhost:5173
```

- Home screen lists **two** tiles; Snake opens at `/game/snake`.
- Arrows and WASD both steer; while moving right, pressing Left does nothing,
  and Up-then-Left in quick succession does **not** reverse into the body.
- Eating an apple grows the tail by one, bumps the score, and spawns a new apple
  that is never under the snake.
- Hitting a wall and biting the body both end the run with **Game Over** plus the
  final score; **Play Again** (and Enter, and `GameLayout`'s Restart) start a
  fresh run.
- Best score survives a reload; **Settings → Speed** changes the tick rate
  immediately; **Reset progress** on the home screen clears the best score.
- Arrow keys and Space do not scroll the page while playing.

## Commit

Use a **`feat:`** prefix on at least one commit (`feat: add Snake game`) —
that is what makes `just release` cut a minor version.

---

# Addendum — verified against HEAD (2026-08-29, branch `feat/snake`)

The plan above is the **plan of record** and is unchanged. Everything below is
confirmation that its assumptions still hold against the current tree, plus the
small details a builder would otherwise have to rediscover. Nothing here
redesigns the plan; where this section and the plan appear to differ, the plan
wins.

## Interfaces the plan depends on — all confirmed present

- `src/types/game.ts` — `GameComponentProps` is exactly `{ game: Game }`.
  `Game` has `id, title, description, thumbnail, component, controls` required
  and `hasHighScore?, settings?, formatHighScore?` optional. The `snake` object
  in §5 type-checks against this as written.
- `SettingsField` is a discriminated union of `{type:'boolean', default:boolean}`
  and `{type:'select', default:string, options:{value,label}[]}` — the `speed`
  select and `grid` boolean in §5 match both arms.
- `SettingsValues` is `Record<string, boolean | string>`. This is why §3's
  `SPEEDS[values.speed as string] ?? 110` needs the cast — `values.speed` is not
  narrowed to `string` by the type. Keep the cast and keep the `?? 110` fallback.
- `src/components/GameLayout.tsx` — props are
  `{ game, status: ReactNode, onRestart: () => void, settings?: {values, setValue, reset}, children }`.
  The §3 markup matches. `GameLayout` renders `<div className="game-layout__status"
  role="status" aria-live="polite">{status}</div>` itself, which is exactly why
  the plan says not to add a second live region.
- `GameLayout` only shows the Settings button when `game.settings?.length` is
  truthy **and** the `settings` prop was passed. Snake passes both, so it is the
  first game in the repo to exercise the settings dialog. Tic-tac-toe does not
  pass `settings`, so there is no prior example to copy — wire
  `settings={{ values, setValue, reset }}` straight from `useGameSettings(game)`,
  whose return shape is `{ values, setValue, reset }` and matches the prop
  one-for-one.
- `src/hooks/useHighScore.ts` returns `{ highScore, submitScore, refresh }` with
  `highScore: number | null`. `submitScore` already ignores a value that is not
  better than the stored one, so the ref guard in §3 step 4 is about not calling
  it repeatedly per render, not about correctness of the max.
  `highScore ?? 0` in the HUD is correct — do not use `||`.
- `src/games/registry.ts` currently reads `export const GAMES: Game[] = [ticTacToe];`
  and also exports `getGameById`. The §6 edit is the import line plus appending
  `snake` to that array; leave `getGameById` alone.
- `src/styles/global.css` defines every token §7 uses: `--surface: #1b1d3a`,
  `--surface-2: #262a52`, `--text-dim: #b9bce0`, `--accent: #ff5d8f`,
  `--radius: 12px`, `--tap: 44px`. Note `--accent` is pink — that is the intended
  "distinct wall border" colour. Do not introduce new tokens.

## Test-harness facts

- `src/test/setup.ts` is only `import '@testing-library/jest-dom'`. There is **no**
  `canvas` package installed, so jsdom's `HTMLCanvasElement.prototype.getContext`
  returns `null` and logs a "Not implemented" console error. Both halves of §4's
  approach matter: the `getContext` spy makes `draw` actually run in the test, and
  the `if (!ctx) return;` guard in §3 keeps the component safe if a future test
  renders it without the spy.
- Restore the spy in `afterEach` (`vi.restoreAllMocks()`) so it does not leak into
  other files.
- `src/games/tic-tac-toe/TicTacToeGame.test.tsx` is the style reference: render
  helper wrapping in `<MemoryRouter>`, `describe`/`it`, explicit
  `import { describe, it, expect } from 'vitest'`. Snake diverges on input only —
  `fireEvent.keyDown(window, …)` under fake timers instead of `userEvent`, as §4
  specifies.
- `GameLayout`'s Restart button is `getByRole('button', { name: 'Restart' })`;
  the overlay button is `name: /play again/i`. Query them separately so test 4
  cannot accidentally assert on the wrong one.
- Tests run with `npm test` (`vitest run`). There is no `--coverage` gate.

## Toolchain

`package.json` scripts: `dev`, `build` (`tsc -b && vite build`), `lint`
(`eslint .`), `test` (`vitest run`). React 19, Vite 7, Vitest 3, TypeScript 5.9,
`eslint-plugin-react-hooks` and `eslint-plugin-react-refresh` are both active:

- react-refresh: keep `SnakeGame.tsx` exporting the component only, and keep the
  `snake` `Game` object in `index.ts`. Do not co-locate them.
- react-hooks: the `useEffect` for the loop must list every value it reads in its
  dependency array. Reading live game state through `stateRef` (per §3) is what
  keeps that array down to the speed setting and the stable callbacks, and is
  what stops the interval from being torn down every tick.

## README edit

The line to update is README.md:6 — "The first game is hot-seat **Tic-Tac-Toe**."
Change it to say the arcade ships two games, Tic-Tac-Toe and Snake. The "Adding a
new game" section below it is generic and needs no change.

## Verification (unchanged from the plan)

```bash
npm run lint && npx tsc -b && npm test && npm run build
```

Judge each command by its exit status, not by words in its output — a passing
run can still print the jsdom "Not implemented: HTMLCanvasElement.prototype.getContext"
line, and that is not a failure.
