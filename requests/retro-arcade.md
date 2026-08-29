Build a responsive, kid-friendly, browser-based retro gaming arcade web app that
hosts multiple small games behind a single home screen. Ship one game
(Tic-Tac-Toe) now; the architecture must make adding future games trivial.

## Tech stack
- React + TypeScript (Vite)
- Plain CSS or Tailwind — no heavy UI framework
- Client-side routing (React Router): `/` for home, `/game/:gameId` per game
- Persistence: browser `localStorage`, wrapped behind a small storage service
  interface. If `localStorage` is unavailable or throws, fall back silently to
  an in-memory store so the app never crashes.
- Deploy target: Vercel. Include the config needed for a zero-config static
  build and SPA route rewrites.
- Vitest + React Testing Library for game-logic and component tests.

## Architecture requirement: game registry
Define a `Game` interface (id, title, description, thumbnail, component,
optional `hasHighScore`, optional settings schema, control descriptions) and a
registry array. The home screen renders from this registry, and routing is
driven by it. Adding a new game should mean writing the game component and
appending one registry entry — no changes to home, routing, or nav code.

## Screens

### Home screen
- Grid of tiles, one per registered game, showing title, short description, and
  the player's best result for that game if one is stored.
- Clicking a tile navigates to that game's screen.
- Responsive: single column on mobile, multi-column on larger viewports.

### Game screen
Every game screen shares a common layout shell providing:
- Back to Home (always visible, large, obvious)
- Restart / New Game
- A controls/how-to-play panel listing 2–3 controls, collapsible
- A settings button, rendered only if the game declares settings
- The game's current status (whose turn, score, result)

## Persistence
For games that declare `hasHighScore`, persist the best score under a
namespaced key (e.g. `retro-arcade:v1:<gameId>:highScore`) so it survives across
sessions. Validate and version the stored shape; corrupt or unparseable data
should be discarded rather than crashing the app. Include a "reset progress"
action somewhere unobtrusive.

## UX bar
Assume a child is the primary user. Large tap targets, clear labels over icons
alone, obvious visual feedback on every interaction, no dead ends — every screen
has a visible route back to home. Keyboard-navigable and screen-reader labelled.

## First game: Tic-Tac-Toe
- Two human players sharing one browser (hot-seat). No AI opponent.
- Player 1 is X and moves first; Player 2 is O.
- 3x3 board, click an empty cell to place your mark.
- Display whose turn it is at all times.
- Detect and clearly announce: Player 1 wins, Player 2 wins, or Draw.
  Highlight the winning line.
- No persistent high score. Do keep a session-only tally of X wins / O wins /
  draws, shown above the board and cleared on leaving the game.
- Board must be non-interactive once the game ends, until Restart is pressed.

## Deliverables
1. Working app runnable with `npm install && npm run dev`
2. README covering local dev, how to add a new game to the registry, and Vercel
   deploy steps
3. Unit tests for the Tic-Tac-Toe win/draw logic and the storage fallback path

## Out of scope
Backend, accounts, multiplayer over network, sound, additional games. More games
will be specified in a follow-up — optimize for that extension point.

Done means: `npm install && npm run dev` serves the arcade; home screen renders
tiles from the registry; Tic-Tac-Toe is fully playable hot-seat with win/draw
detection, winning-line highlight, session tally, and a locked board after game
over; the storage service falls back to in-memory when localStorage throws;
Vitest suite covers the win/draw logic and the storage fallback path and passes;
Vercel config for static build + SPA rewrites is present; README covers local
dev, adding a game, and Vercel deploy.
