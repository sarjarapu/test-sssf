# Retro Arcade

A small, registry-driven game hub built with React + Vite. The home screen lists
every game from a single registry; each game renders a shared chrome
(`<GameLayout>`) that provides the back link, restart button, how-to-play panel
and optional settings dialog. The first game is hot-seat **Tic-Tac-Toe**.

## Local development

System tools this repo assumes (git, Node, uv, just, gh, the `claude` CLI, and
optionally bun/sqlite3) with macOS + Debian install commands are in
[`app_docs/prerequisites.md`](app_docs/prerequisites.md).

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # run the Vitest suites once
npm run build    # typecheck (tsc -b) + production bundle to dist/
```

## Adding a new game

Home, routing and navigation need **no edits** — the registry is the only
extension point.

1. **Create `src/games/<id>/`** — pick a URL-safe `id` (also used as the storage
   namespace, e.g. `tic-tac-toe`).
2. **Write the component.** It receives `GameComponentProps` (`{ game }`) and
   must render its UI inside `<GameLayout>`:

   ```tsx
   import GameLayout from '../../components/GameLayout';
   import type { GameComponentProps } from '../../types/game';

   export default function MyGame({ game }: GameComponentProps) {
     // ...game state...
     return (
       <GameLayout game={game} status={<>Your turn</>} onRestart={restart}>
         {/* board / playfield */}
       </GameLayout>
     );
   }
   ```

   `status` is passed **down** as a prop (a ReactNode). Do not try to push status
   up into the shell through context/effects — a fresh ReactNode per render turns
   that into an infinite re-render loop.
3. **Append the entry to `GAMES`** in `src/games/registry.ts`:

   ```ts
   export const GAMES: Game[] = [ticTacToe, myGame];
   ```

   Provide `controls` (2–3 `{ action, how }` hints). Set `hasHighScore: true`
   and optionally `formatHighScore` if the game keeps a score. Add a `settings`
   schema (`boolean` / `select` fields) to get a Settings button + dialog for
   free; read the values with `useGameSettings(game)`.
4. **Add tests** — a pure `logic.ts` with `logic.test.ts`, and a component test
   rendered inside `<MemoryRouter>`.

## Persistence

- Keys: `retro-arcade:v1:<gameId>:<field>` (see `gameKey()` in
  `src/services/storage.ts`).
- Every value is stored as a versioned envelope `{ v: 1, value }`. A missing key,
  corrupt JSON or a version mismatch returns the caller's fallback.
- All `localStorage` access is wrapped in try/catch. If the browser throws
  (Safari private mode, disabled storage), the service switches permanently to an
  in-memory backend for the session and never rethrows.
- The home screen footer's **Reset progress** button calls
  `storage.clearNamespace()`, which removes only `retro-arcade:v1:` keys.

## Deploying to Vercel

Import the repo — Vercel auto-detects the framework as **Vite** (build
`npm run build`, output `dist`). `vercel.json` adds the SPA rewrite so deep links
like `/game/tic-tac-toe` resolve to `index.html` instead of 404ing.

The release/preview pipeline (feature branch → preview → production) is
documented in [`app_docs/releasing.md`](app_docs/releasing.md); the per-feature
runbook is [`app_docs/adding-a-game.md`](app_docs/adding-a-game.md).

## Observing ADW runs (`just obs`)

The trace UI for the agent workflows (`just plan`, `just sdlc`, `just preview`,
`just release`, …) is served by **`just obs`** from the repo root:

```bash
just obs        # API on :4600, UI on http://localhost:4601  (needs bun)
```

This starts **two** processes — a JSON API over `adws/adw_data/sssf.db` and the
Vite UI that proxies `/api/*` to it. Running the visualizer's own `npm run dev`
starts **only the UI**, so every request fails with
`http proxy error: /api/sessions … ECONNREFUSED` — use `just obs` instead, or
start the API yourself:

```bash
cd .claude/skills/sssf/apps/visualizer
SSSF_DB="$(git rev-parse --show-toplevel)/adws/adw_data/sssf.db" bun run server/index.ts
```

**If the API exits with `unable to open database file`:** the tracer removes the
WAL sidecar files (`sssf.db-wal`, `sssf.db-shm`) when the last ADW finishes
cleanly, and `bun:sqlite` cannot open a WAL db read-only without them. Either run
`just obs` while a workflow is running, or recreate the sidecars once:

```bash
bun -e 'new (require("bun:sqlite").Database)("adws/adw_data/sssf.db",{readwrite:true}).close()'
```

Quick CLI peeks without the UI: `just sessions`, `just phases <adw_id>`,
`just tail <adw_id>`.
