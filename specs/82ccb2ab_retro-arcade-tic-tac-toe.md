# Plan: Retro Arcade — registry-driven game hub + Tic-Tac-Toe

## Context

The repo is currently **greenfield**: it holds only the SSSF harness (`adws/`,
`justfile`, `.claude/`, `requests/`). There is no `package.json`, no `src/`, no
build tooling. Everything below is new code.

Build the app **at the repo root** so that `npm install && npm run dev` from the
repo root serves the arcade (this is the stated done-criterion) and so Vercel's
zero-config Vite detection works without a root-directory override.

Toolchain is already live on PATH: node v22.22.1, npm 10.9.4. Call `npm` bare.

## Decisions already made (do not re-litigate)

- **Plain CSS**, no Tailwind. One `src/styles/global.css` plus per-component CSS
  files. Fewer moving parts, no config drift, and the UX bar is about tap-target
  size and contrast, not utility classes.
- **Do not run `npm create vite`** — it prompts when the directory is non-empty.
  Hand-write `package.json`, `index.html`, `vite.config.ts`, `tsconfig*.json`,
  then run `npm install`.
- Vitest config lives **inside `vite.config.ts`** (single config file).
- The shared chrome is a component the game renders (`<GameLayout>`), not a
  wrapper that tries to pull status out of the game. Rationale in
  "Architecture" below — this avoids the effect/state loop that a
  `setStatus(ReactNode)` context inevitably creates.

## Files to create

```
package.json
index.html
vite.config.ts                     # + vitest config block
tsconfig.json
tsconfig.node.json
vercel.json
.gitignore                         # UPDATE existing file
README.md
src/
  main.tsx                         # React root + BrowserRouter
  App.tsx                          # <Routes>
  vite-env.d.ts
  test/setup.ts                    # imports @testing-library/jest-dom
  styles/
    global.css                     # tokens, resets, focus ring, tap targets
  types/
    game.ts                        # Game, GameComponentProps, settings schema
  games/
    registry.ts                    # GAMES array + getGameById()
    tic-tac-toe/
      logic.ts                     # pure, no React
      logic.test.ts
      TicTacToeGame.tsx
      TicTacToeGame.test.tsx
      ticTacToe.css
  services/
    storage.ts                     # StorageService + localStorage/memory impls
    storage.test.ts
  hooks/
    useHighScore.ts
    useGameSettings.ts
  components/
    GameLayout.tsx  gameLayout.css # shared shell: back, restart, how-to, settings
    HowToPlayPanel.tsx             # collapsible <details>-based
    SettingsPanel.tsx              # schema-driven dialog
    GameTile.tsx    gameTile.css
  screens/
    HomeScreen.tsx  homeScreen.css
    GameScreen.tsx                 # registry lookup by :gameId
    NotFoundScreen.tsx
```

## Dependencies

`package.json` (caret ranges, let npm resolve latest compatible):

- deps: `react` ^19, `react-dom` ^19, `react-router-dom` ^7
- devDeps: `typescript` ~5.9, `vite` ^7, `@vitejs/plugin-react` ^5,
  `vitest` ^3, `jsdom` ^26, `@testing-library/react` ^16,
  `@testing-library/user-event` ^14, `@testing-library/jest-dom` ^6,
  `@types/react` ^19, `@types/react-dom` ^19

Scripts:

```json
"dev": "vite",
"build": "tsc -b && vite build",
"preview": "vite preview",
"test": "vitest run",
"test:watch": "vitest"
```

If any caret range fails to install on this Node, drop to the newest version npm
offers for that package rather than pinning something older across the board.

## Architecture: the game registry

`src/types/game.ts`:

```ts
export interface ControlHint {
  action: string;   // "Place your mark"
  how: string;      // "Click or tap an empty square"
}

export type SettingsField =
  | { key: string; label: string; type: 'boolean'; default: boolean }
  | { key: string; label: string; type: 'select'; default: string;
      options: { value: string; label: string }[] };

export type SettingsValues = Record<string, boolean | string>;

export interface GameComponentProps {
  game: Game;                 // passed by the route; avoids a circular import
}

export interface Game {
  id: string;                 // url segment + storage namespace
  title: string;
  description: string;        // one short sentence, shown on the home tile
  thumbnail: string;          // emoji or short glyph, rendered decoratively
  component: React.ComponentType<GameComponentProps>;
  controls: ControlHint[];    // 2-3 entries, shown in the how-to-play panel
  hasHighScore?: boolean;
  settings?: SettingsField[];
  formatHighScore?: (value: number) => string;  // tile display, default String()
}
```

`src/games/registry.ts` exports `export const GAMES: Game[] = [ticTacToe]` and
`getGameById(id)`. **Adding a game = new folder + one appended entry.** Nothing
in `HomeScreen`, `App`, or `GameLayout` may reference a specific game id.

The route passes the entry down:

```tsx
// GameScreen.tsx
const game = getGameById(params.gameId);
if (!game) return <NotFoundScreen />;
const GameComponent = game.component;
return <GameComponent game={game} />;
```

and the game renders the shared chrome itself:

```tsx
return (
  <GameLayout game={game} status={<TurnBanner .../>} onRestart={restart}>
    <Board ... />
  </GameLayout>
);
```

This is deliberate: the alternative (shell renders the game, game pushes its
status up through context) requires `useEffect(() => setStatus(<node/>))`, and a
fresh ReactNode per render makes that an infinite re-render loop. Passing `status`
down as a prop is loop-free and fully typed. Document the contract in the README
"Adding a game" section so future games follow it.

## `GameLayout` (shared shell)

Props: `{ game, status, onRestart, settings?: { values, setValue, reset }, children }`.

Renders, in order:

1. Header row: **`← Back to Home`** link (`react-router` `<Link to="/">`, min
   56px tall, always visible, text label not just an icon), game title,
   **`Restart`** button, and a **`Settings`** button rendered *only* when
   `game.settings?.length` — it opens `<SettingsPanel>`.
2. Status region: `<div role="status" aria-live="polite">{status}</div>`.
3. `{children}` — the game board.
4. `<HowToPlayPanel controls={game.controls} />` — a `<details>` element
   (collapsible for free, keyboard accessible for free), `<summary>` reads
   "How to play".

No game screen may lack the back link — it lives here, so every game gets it.

## Storage service

`src/services/storage.ts`:

```ts
export interface StorageService {
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
  remove(key: string): void;
  clearNamespace(): void;      // removes every retro-arcade:v1: key it can see
}
export const NAMESPACE = 'retro-arcade:v1';
export const gameKey = (gameId: string, field: string) =>
  `${NAMESPACE}:${gameId}:${field}`;   // -> retro-arcade:v1:tic-tac-toe:highScore
```

Behaviour:

- Stored envelope is `{ v: 1, value: T }`, JSON-stringified. `get` returns
  `fallback` unless the parsed object is a non-null object with `v === 1`.
- **Every** `localStorage` call is wrapped in try/catch — Safari private mode
  throws on `setItem`, and some environments throw on mere *access* to
  `window.localStorage`, so probe it inside a try/catch at module init too.
- On any throw, the service flips permanently to an in-memory `Map` backend for
  the rest of the session and keeps working. It must never rethrow.
- Corrupt/unparseable JSON or a version mismatch: discard (attempt `remove`) and
  return the fallback.
- Export a factory `createStorageService(backend?: StorageLike)` so tests can
  inject a throwing fake, plus a default singleton `storage` for app use.

`useHighScore(game)` reads/writes `gameKey(game.id, 'highScore')` and is used by
the home tile; `useGameSettings(game)` does the same for `'settings'`, seeded
from each field's `default`.

## Screens

**HomeScreen** — `<h1>Retro Arcade</h1>`, then a CSS-grid `<ul>` of `<GameTile>`
from `GAMES`: thumbnail, title, description, and the best result when
`hasHighScore` (otherwise render nothing for score, not "0"). Whole tile is one
`<Link>` (large tap target, focus-visible ring). Grid: 1 column ≤600px, 2
columns ≤900px, 3+ above — `repeat(auto-fill, minmax(260px, 1fr))`.

Footer: unobtrusive small **"Reset progress"** button → `window.confirm` →
`storage.clearNamespace()` → refresh displayed scores.

**GameScreen** — as above. Unknown `gameId` renders `NotFoundScreen`.

**NotFoundScreen** — friendly message + big "Back to Home" link. Also wired to
`path="*"`.

## Tic-Tac-Toe

`logic.ts` — pure, framework-free, the unit under test:

```ts
export type Player = 'X' | 'O';
export type Cell = Player | null;
export type Board = Cell[];               // always length 9
export type Line = readonly [number, number, number];
export const WINNING_LINES: readonly Line[];      // 3 rows, 3 cols, 2 diagonals
export function createEmptyBoard(): Board;
export function currentPlayer(board: Board): Player;   // X on even move count
export function getWinner(board: Board): { winner: Player; line: Line } | null;
export function isDraw(board: Board): boolean;         // full && no winner
export type GameStatus =
  | { kind: 'playing'; turn: Player }
  | { kind: 'won'; winner: Player; line: Line }
  | { kind: 'draw' };
export function getGameStatus(board: Board): GameStatus;
export function applyMove(board: Board, index: number, player: Player): Board;
// applyMove returns the SAME board reference if the cell is occupied,
// the index is out of range, or the game is already over.
```

`TicTacToeGame.tsx`:

- State: `board`, `tally: { X: number; O: number; draws: number }`.
  Tally is component state only — **never persisted**, so leaving the game and
  coming back clears it. `hasHighScore` is absent from the registry entry.
- Status text: "Player 1 (X)'s turn" / "Player 2 (O)'s turn" /
  "Player 1 (X) wins!" / "Player 2 (O) wins!" / "It's a draw!".
- Tally line sits above the board: "X wins: n · O wins: n · Draws: n". Increment
  exactly once per finished game (compute the new status inside the click
  handler and bump there — do **not** bump inside a `useEffect` keyed on board,
  which double-fires under StrictMode).
- Board: 3×3 of `<button>`s, `role="grid"` wrapper, each cell
  `aria-label="Row 2, column 3, empty"` or `"… , X"`, `disabled` when occupied
  **or when the game is over** (locked board requirement), min 72×72px.
- Winning cells get a `.winning` class (distinct background + border, not colour
  alone) driven by `status.line`.
- `Restart` (from `GameLayout`) resets `board` only; tally survives restarts and
  dies with the component.
- Registry entry: id `tic-tac-toe`, thumbnail `⭕`, controls e.g.
  `[{ action: 'Take your turn', how: 'Click or tap an empty square' },
    { action: 'Play again', how: 'Press Restart at the top' },
    { action: 'Leave the game', how: 'Press Back to Home' }]`.

## Tests (all must pass under `npm test`)

`logic.test.ts`
- each of the 8 winning lines detected, for X and for O, with the right `line`
- no winner on an empty board and on an in-progress board
- draw detection on a full board with no line; not a draw when the full board has a winner
- `currentPlayer` alternates X → O → X
- `applyMove` writes the mark; returns the same board for an occupied cell, an
  out-of-range index, and a move after the game is won

`storage.test.ts`
- roundtrip get/set/remove against a working fake backend
- **fallback path**: backend whose `setItem` throws → `set` does not throw, and
  a subsequent `get` returns the value from memory
- backend whose `getItem` throws → returns the fallback, no throw
- corrupt JSON stored → returns fallback
- wrong envelope version (`{ v: 0 }`) → returns fallback
- `clearNamespace` removes namespaced keys and leaves foreign keys alone

`TicTacToeGame.test.tsx` (render inside `<MemoryRouter>`)
- X wins across the top row: status announces Player 1 wins, three cells carry
  the winning class, **every** cell button is disabled
- clicking a disabled cell after game over does not change the board
- tally increments by one after that win
- Restart clears the board and re-enables cells while the tally persists
- a draw sequence announces "It's a draw!"

## Config files

`vite.config.ts` — `plugins: [react()]`, plus:

```ts
test: { environment: 'jsdom', globals: true, setupFiles: './src/test/setup.ts', css: false }
```

with `/// <reference types="vitest/config" />` at the top.

`vercel.json`:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

(Build command/output dir are left to Vercel's zero-config Vite detection —
`npm run build` → `dist`.)

`.gitignore` — **append** to the existing file, keep the SSSF entries:
`node_modules/`, `dist/`, `.vercel`, `coverage/`. (`node_modules/` is currently
missing, which is why the visualizer's is showing up untracked.)

## README

Sections: what this is; **Local development** (`npm install`, `npm run dev`,
`npm test`, `npm run build`); **Adding a new game** — a copy-pasteable walkthrough
naming the four steps (create `src/games/<id>/`, write the component taking
`GameComponentProps` and rendering `<GameLayout>`, append the entry to `GAMES`,
add tests) and stating explicitly that home, routing and nav need no edits;
**Persistence** (key format, versioned envelope, in-memory fallback, reset
progress); **Deploying to Vercel** (import repo → framework auto-detected as
Vite → build `npm run build`, output `dist` → `vercel.json` supplies the SPA
rewrite so deep links like `/game/tic-tac-toe` resolve).

## Accessibility / UX checklist (verify before reporting done)

- Visible `:focus-visible` outline on every interactive element; never
  `outline: none` without a replacement.
- Minimum 44×44px tap targets; board cells 72px+.
- Text labels on all primary actions, not icons alone.
- Status changes announced via the `aria-live="polite"` region in `GameLayout`.
- Full keyboard play: tab to a cell, Enter/Space places a mark.
- Every screen (home, game, not-found) has a visible route home.
- No colour-only signalling for the winning line.

## Verification

Run from the repo root; judge each by exit status:

1. `npm install`
2. `npm run build` — must typecheck and bundle clean
3. `npm test` — all suites pass
4. `npm run dev`, then confirm by hand: home tiles render from the registry,
   `/game/tic-tac-toe` plays hot-seat, X wins highlights the line and locks the
   board, Restart unlocks, tally counts, `/game/nope` shows not-found,
   reloading `/game/tic-tac-toe` in dev works.

## Out of scope

No backend, accounts, network multiplayer, sound, AI opponent, or additional
games. Do not add a second game "as an example" — the registry plus the README
walkthrough is the extension point.
