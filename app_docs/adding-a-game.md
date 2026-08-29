# Adding a game — step by step

The repeatable loop for every new game feature: **branch → plan → build → validate
→ preview → merge → release**. Pairs with [`releasing.md`](./releasing.md).

> `just` not installed? Either `brew install just`, or replace every
> `just <recipe> "<text>"` below with
> `uv run adws/adw_<name>.py --config adws/adw_sssf_config/sssf.config.yaml "<text>"`
> (recipe `sdlc` → `adw_plan_build_test`, `simple-sdlc` → `adw_simple_sdlc`).

---

## TL;DR

```bash
git checkout main && git pull
git checkout -b feat/snake

just plan "add a Snake game: arrow-key movement, growing tail, wall/self collision ends the run, high score"
#  → read specs/*.md, edit if needed

just sdlc "build the Snake game from the plan in specs/<file>.md"
#  → plans, builds, tests, commits to the branch

npm run build && npm test          # local gate
# manually check src/games/<id>/index.ts is added to src/games/registry.ts GAMES[]

git add -A && git commit -m "feat: wire Snake into the game registry"   # only if you hand-edited

just preview "click-test Snake"     # → verified preview URL, open it, play the game

gh pr create --fill                 # open the PR
#  → review, squash-merge in GitHub (human step)

git checkout main && git pull
just release "ship Snake"            # → release-it bump + tag + GH release + production verify
```

---

## 1. Start clean

```bash
git checkout main && git pull
git checkout -b feat/<game-id>          # e.g. feat/snake
```

One branch per game. `main` is release-only.

## 2. Plan

```bash
just plan "add a <Game> game: <rules>, <controls>, <win/lose>, <high score?>"
```

Writes a plan to `specs/`. **Open it, sanity-check it, edit anything wrong** — the
build follows this file literally. Cheap to re-run if the plan is off.

Include in the prompt: the grid/board model, the controls, what ends a round, and
whether it has a high score (persisted via `src/services/storage`).

## 3. Build

```bash
just sdlc "build <Game> from the plan in specs/<plan-file>.md"
```

`sdlc` = plan → build → test → **commit to the branch**. Use `just simple-sdlc`
instead to also get a review pass + doc update.

A new game is these files (match `src/games/tic-tac-toe/`):

| File | Purpose |
|---|---|
| `src/games/<id>/logic.ts` | pure game rules, no React |
| `src/games/<id>/logic.test.ts` | unit tests for the rules |
| `src/games/<id>/<Game>.tsx` | the component (wraps `GameLayout`) |
| `src/games/<id>/<Game>.test.tsx` | render/interaction test |
| `src/games/<id>/<game>.css` | styles |
| `src/games/<id>/index.ts` | the `Game` object (id, title, thumbnail, controls, component) |

## 4. Wire it into the registry

The ADW usually does this; **verify by hand**:

```ts
// src/games/registry.ts
import { snake } from './snake';
export const GAMES: Game[] = [ticTacToe, snake];   // ← new game added
```

If you edited anything the ADW didn't commit:

```bash
git add -A && git commit -m "feat: wire <Game> into the game registry"
```

> Use a **`feat:`** prefix on at least one commit — that's what makes `release`
> cut a minor version. `fix:` → patch. Neither → `release` refuses ("nothing to
> release").

## 5. Validate locally

```bash
npm run lint && npx tsc -b && npm test && npm run build
npm run dev        # open http://localhost:5173, play the game, check the badge reads "· local"
```

All four must pass — `preview` and `release` run the same gate and stop on red.

## 6. Preview

```bash
just preview "click-test <Game>"
```

Guards: on a feature branch (not `main`), tree clean, quality green. Pushes the
branch, waits for Vercel, prints the live URL:

```
preview ready: https://ska-test-sssf-<hash>-sarjarapus-projects.vercel.app
```

Open it, play the game, confirm the badge shows `v<last> · <branch> · <sha>`.
Re-run after each fix — it's idempotent.

## 7. PR and merge

```bash
gh pr create --fill
```

Review the diff, then **squash-merge in GitHub**. Merging is always a human step —
no ADW does it.

## 8. Release

```bash
git checkout main && git pull        # pick up the merge
just release "ship <Game>"
```

Runs: guards (on `main`, clean, `main == origin/main`, releasable commits) →
quality → `release-it` (bump `package.json`, write `CHANGELOG.md`, commit
`chore: release vX.Y.Z`, tag, push, GitHub release) → verify the tagged commit's
production deploy on Vercel.

**Accepted only if production goes green.** On success:

```
released vX.Y.Z — production is live: https://ska-test-sssf.vercel.app
```

## 9. Confirm

```bash
git pull                                              # local main == the release commit
open https://ska-test-sssf.vercel.app                 # badge reads "vX.Y.Z", new game on the home screen
```

GitHub release + `CHANGELOG.md` list the `feat:` entries.

---

## Inspecting a run

```bash
just sessions                # last 10 ADW runs
just phases <adw_id>         # phase-by-phase status
just tail <adw_id>           # event tail
just obs                     # trace UI at http://localhost:4601 (needs bun)
```

## If something fails

| Where | Meaning | Do |
|---|---|---|
| `plan` looks wrong | prompt was thin | edit `specs/<file>.md` or re-run with a sharper prompt |
| `sdlc` build/test red | logic or wiring bug | read `adws/adw_data/sessions/<id>/context_handoff/`, fix, re-run `just sdlc` |
| `preview` quality red | lint/type/test/build broke | fix locally, commit, re-run `just preview` |
| `release` "nothing to release" | no `feat:`/`fix:` commit since last tag | fix commit messages, or `just release "..." -- --redeploy` to only re-verify |
| `release` verify red | production build failed | Vercel dashboard → Instant Rollback; `git revert`; `just release` a patch. **Tag is not auto-deleted** — see [`releasing.md`](./releasing.md#rollback-spec-9) |
