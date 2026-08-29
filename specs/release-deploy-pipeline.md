# Spec: Release & Deploy Pipeline (feature branch → preview → production)

Status: **draft for review** · Owner: Shyam · Date: 2026-08-29

This document is self-contained. It is written to survive a context reset — an
engineer or ADW should be able to act on it without the conversation that
produced it.

---

## 1. Goal

Build ADW modules that make day-to-day shipping feel like an enterprise release
train, for a solo/small-team repo:

```
local dev  →  vercel preview (optional)  →  vercel production
```

- Work happens on **feature branches**.
- Validate locally (build + test + review) using the existing SDLC ADWs.
- **Preview** deploys a feature branch to a throwaway Vercel URL for a human to
  click through. Optional per change.
- **Release** is a deliberate act on `main` only: bump the version, tag, write a
  changelog, cut a GitHub release, and let that tagged commit deploy to
  production.
- The running site shows its version number, and that number is provably the
  code that is live.

## 2. Non-goals

- Multi-region / blue-green / canary infra. Vercel's atomic deploys + instant
  rollback are enough at this scale.
- A custom deployment dashboard. The trace DB + Vercel dashboard + GitHub
  releases are the surfaces.
- Automating the PR *merge*. Merging stays a human action in GitHub.
- "Build once, promote the exact artifact" (Vercel `promote`/alias swap). Noted
  as a future option in §8; not v1.

## 3. Current state (2026-08-29)

- App: React 19 + TS + Vite at repo root, deployed at
  `https://ska-test-sssf.vercel.app/`.
- Vercel project is wired to the GitHub repo `sarjarapu/test-sssf`:
  - push to `main` → **production** deploy
  - push to any other branch → **preview** deploy
  - Vercel writes a commit status (context `"Vercel"`, `target_url` = build
    inspector) back onto every pushed SHA.
- ADWs today: `adw_prompt`, `adw_scout`, `adw_plan*`, `adw_plan_build*`,
  `adw_plan_build_test*`, `adw_simple_sdlc`, `adw_quality`, `adw_document`.
  All commit to the **current branch**; none push or deploy.
- Just added (this thread, uncommitted):
  - `adws/adw_modules/deploy.py` — `release()` pushes current branch + polls the
    `"Vercel"` commit status via `gh`. No Vercel token needed.
  - `adws/adw_modules/data_types.py` — `DeployResult` type.
  - `adws/adw_release.py` + `just release` — engineer(request) → code(quality) →
    code(release). Currently pushes *whatever branch you are on*.
  - **This spec supersedes that script's behavior** — see §6.
- `release-it` is *not* installed yet.

## 4. Concepts

### 4.1 Environments

| Env | URL shape | Source | Lifetime | Purpose |
|---|---|---|---|---|
| **local** | `localhost:5173` | working tree | — | the dev loop (`npm run dev` / `npm run preview`) |
| **preview** | `ska-test-sssf-git-<branch>-<scope>.vercel.app` | any non-`main` branch push | until branch deleted / superseded | click-test a change, share a link, PR review |
| **production** | `ska-test-sssf.vercel.app` | `main` push (tagged commits only, by policy) | until next production deploy | real users |

### 4.2 Version namespaces — and the one source of truth

There are three independent identifiers for "which version is this". They must
never be reconciled by hand; they are tied together **at build time**.

| Namespace | Example | Set by | Role |
|---|---|---|---|
| **Semver** | `0.2.0` | `release-it`, writing `package.json` `version` on `main` | the human-facing release number |
| **Git** | tag `v0.2.0`, SHA `da51bd3` | `release-it` tags; git provides the SHA | the exact commit the semver names |
| **Vercel** | deployment ID `dpl_…`, deployment URL, `VERCEL_ENV` | Vercel, per build | the exact artifact currently served |

**Source of truth: `package.json` `version`.** It is bumped *only* by
`release-it`, *only* on `main`, *never* by hand, *never* on a feature branch. It
always reflects the **last released** version.

**The join key is the git SHA.** From a SHA you can find the tag, the GitHub
release, and the Vercel deployment. So every build compiles the SHA in.

**Consistency is structural, not enforced.** Vercel builds one specific commit;
`release-it` already wrote `version: 0.2.0` into that commit; therefore reading
`pkg.version` during `vite build` *is* the version for that SHA. They cannot
drift because the string is derived from the artifact's own commit.

### 4.3 What the badge shows

| Env | Badge | Built from |
|---|---|---|
| production | `v0.2.0` | tagged `main` commit |
| preview | `v0.2.0 · feat/foo · abc1234` | feature branch HEAD (v0.2.0 = last release; work is "post-0.2.0, unreleased") |
| local | `v0.2.0 · local` | working tree |

Clicking the badge opens the GitHub commit for that SHA.

## 5. Proposed pipeline

Staged, each stage its own ADW, each with an explicit guard. No stage silently
runs the next.

```
┌─ feature branch ────────────────────────────────────────────────┐
│  just sdlc / just simple-sdlc   (plan → build → test → review →  │
│                                  commit to the feature branch)   │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                    just preview │  (OPTIONAL)
                                ▼
┌─ adw_preview.py ────────────────────────────────────────────────┐
│  guard:  NOT on main; tree clean (or run sdlc first)             │
│  code:   quality (lint, typecheck, test, build)                  │
│  code:   git push origin <feature-branch>                        │
│  code:   poll "Vercel" status for HEAD → capture preview URL     │
│  out:    preview URL in the trace + console                      │
└───────────────────────────────┬─────────────────────────────────┘
                                │   human clicks the preview, validates
                                │   open PR → review → squash-merge to main
                                ▼
┌─ adw_release.py  (on main) ────────────────────────────────────┐
│  guard:  ON main; tree clean; up to date with origin/main;      │
│          conventional commits exist since the last tag          │
│  code:   quality (lint, typecheck, test, build)                 │
│  code:   npx release-it --ci                                    │
│            → bump package.json, update CHANGELOG.md,            │
│              commit "chore: release vX.Y.Z", tag vX.Y.Z,       │
│              push commit+tag, create GitHub release            │
│  code:   poll "Vercel" status for the release SHA → production  │
│          URL; assert state == success                          │
│  finish: accepted only if production went green                 │
└────────────────────────────────────────────────────────────────┘
```

### Why release and deploy are one ADW, not two

In the GitHub-integration model, "deploy" is not an imperative you issue — it is
the *consequence* of a push. The only imperative acts are **release** (tag +
changelog) and **verify** (did the resulting deploy go green). Splitting them
into separate ADWs would create a two-command dance with nothing meaningful in
between. `adw_release.py` does release → push → verify as one unit and is
`accepted` only if production is live.

Preview is genuinely separate: different branch, different trigger, optional,
and it must *not* touch versioning.

## 6. ADW inventory — target state

| ADW | Runs on | Does | Ends at |
|---|---|---|---|
| `adw_simple_sdlc.py` *(exists)* | feature branch | plan→build→test→review→docs, commits | local, committed |
| **`adw_preview.py`** *(new)* | feature branch (refuses `main`) | quality → push branch → verify preview | preview URL |
| **`adw_release.py`** *(revise)* | `main` only (refuses elsewhere) | quality → `release-it` → verify production | production, tagged |

`adw_release.py` as written this thread (pushes any branch) is **replaced** by
the main-only + `release-it` version above. The generic "push current branch and
watch Vercel" logic moves into `deploy.py` and is reused by both `adw_preview`
(preview URL) and `adw_release` (production URL).

### Guards (the "enterprise" part)

**`adw_preview`**
- current branch ≠ `main` (fail fast with a clear message)
- working tree clean — a preview deploys a commit; run `just sdlc` first
- quality green — never publish a broken preview
- branch pushed; `"Vercel"` status reaches a terminal state; preview URL captured

**`adw_release`**
- current branch == `main`
- working tree clean
- local `main` == `origin/main` (no unpushed or un-pulled commits)
- at least one `feat:` / `fix:` / `BREAKING CHANGE` commit since the last tag —
  otherwise there is nothing to release (`--redeploy` overrides to re-verify the
  current tag without bumping)
- quality green **before** `release-it` runs
- after `release-it`: the `"Vercel"` status for the new tag's SHA must reach
  `success`; a timeout or `failure` → run **not accepted**, but the tag is **not
  auto-deleted** (rolling back a tag is a human decision; see §9)

## 7. Implementation plan (phased)

### Phase 1 — version on the site (independent, do first)

1. `vite.config.ts`: add a `define` block injecting
   `__APP_VERSION__` (from `package.json`), `__GIT_SHA__`
   (`process.env.VERCEL_GIT_COMMIT_SHA` ?? `git rev-parse HEAD`, 7 chars),
   `__GIT_REF__` (`VERCEL_GIT_COMMIT_REF` ?? current branch),
   `__BUILD_ENV__` (`VERCEL_ENV` ?? `"local"`).
2. `src/vite-env.d.ts`: `declare const __APP_VERSION__: string;` etc.
3. `src/components/VersionBadge.tsx` + CSS: renders `v{__APP_VERSION__}`, appends
   `· {ref} · {sha}` off production, links to the GitHub commit, `title` carries
   full build metadata. Mount it in the app footer / `GameLayout` chrome.
4. Confirm `resolveJsonModule` in `tsconfig.node.json` (compiles `vite.config.ts`).
5. Test: `define` is shared with vitest, so a smoke test can assert the globals
   are strings.

### Phase 2 — release-it

1. `npm i -D release-it @release-it/conventional-changelog`
2. `.release-it.json`:
   ```json
   {
     "git": {
       "commitMessage": "chore: release v${version}",
       "tagName": "v${version}",
       "requireCleanWorkingDir": true,
       "push": true
     },
     "github": { "release": true },
     "npm": { "publish": false },
     "plugins": {
       "@release-it/conventional-changelog": { "preset": "angular", "infile": "CHANGELOG.md" }
     }
   }
   ```
3. `package.json` scripts: `"release": "release-it"`.
4. `GITHUB_TOKEN` (or `gh auth token`) in `.env` for the GitHub release step.
5. One manual `npx release-it` to establish `v0.1.0` as the baseline tag.

### Phase 3 — deploy.py refactor

Split the current `release()` into reusable pieces:
- `push_current_branch(run, remote) -> (branch, sha, env)` — env = production if
  branch == `main` else preview.
- `await_vercel(run, repo, sha, timeout, interval) -> DeployStatus` — the `gh`
  commit-status poll already written.
- `preview(run) -> DeployResult` — push + await, `environment="preview"`.
- `release(run) -> DeployResult` — push + await, `environment="production"`.
- `read_pkg_version(run) -> str`, `assert_on_main(run)`, `assert_synced(run)`,
  `commits_since_last_tag(run) -> list[str]`, `run_release_it(run) -> ReleaseResult`.

Add `ReleaseResult` to `data_types.py` (version, tag, changelog_path,
github_release_url) or extend `DeployResult`.

### Phase 4 — the two ADWs

- `adws/adw_preview.py` — phases: `request` (guard: not main, tree clean) →
  `quality` → `preview` (push + verify). `REQUIRED_AGENTS = []`.
- `adws/adw_release.py` — rewrite per §6. Phases: `request` (guards) →
  `quality` → `release` (`release-it`) → `verify` (production status). `--redeploy`
  flag. `REQUIRED_AGENTS = []`. `run.finish(accepted = production_is_green)`.

### Phase 5 — justfile + docs

```make
# push a feature branch and get its Vercel preview URL: just preview "try the new board"
preview *ARGS:
    uv run adws/adw_preview.py --config {{config}} "$@"

# on main: cut a version, tag, changelog, GH release, deploy to production
release *ARGS:
    uv run adws/adw_release.py --config {{config}} "$@"
```

`app_docs/releasing.md`: the human runbook — the three commands, what each guard
means, how to roll back.

## 8. Design decisions & rationale

- **Rebuild-from-main for production, not artifact promotion.** Vercel's GitHub
  integration rebuilds the merged `main` commit for production. Promoting the
  exact preview artifact (`vercel promote`) is the stricter "build once" ideal
  but needs a `VERCEL_TOKEN`, a linked `.vercel/`, and it decouples "what's live"
  from "what's tagged on main". At this scale, deterministic rebuilds of a tagged
  commit are simpler and git stays the single source of truth. Revisit if build
  flakiness or env drift ever bites.
- **`package.json` = last released version.** The alternative ("next target")
  makes every preview badge a lie about a version that does not exist yet.
  "Post-0.2.0, unreleased" is honest and needs no coordination.
- **release-it only on `main`.** Version bumps on feature branches create merge
  conflicts in `package.json` and race the tag counter. One writer, one branch.
- **Verify is part of release.** A tag with a red production deploy is worse than
  no tag — it looks done and isn't. The ADW is `accepted` only when the site is
  actually serving the new version.
- **`gh` commit-status poll, not the Vercel API.** No new secret, and the status
  the Vercel GitHub app writes is the same signal a human watches on the PR.

## 9. Rollback

- **Production regression**: `vercel rollback` (dashboard: "Instant Rollback") —
  re-aliases the previous production deployment, no rebuild. Then `git revert`
  the bad commit on `main` and `just release` a patch so git and the live site
  agree again. Do **not** delete or move the tag.
- **Bad tag, not yet deployed**: `git tag -d vX.Y.Z && git push origin :vX.Y.Z`
  before Vercel finishes — only if caught immediately.
- A future `just rollback` ADW can wrap the `vercel rollback` + revert + patch
  sequence.

## 10. Open questions (resolve before Phase 3)

1. **PR required, or may `adw_release` run on a `main` that received a direct
   push?** Recommendation: require PRs; `adw_release` runs post-merge. It only
   checks `main == origin/main`, not *how* commits got there, so this is policy,
   not code.
2. **Preview cadence**: `just preview` on every feature push, or only when a
   human wants a shareable link? Recommendation: only on demand — Vercel already
   auto-previews every push; `adw_preview` adds the *verified* + *URL-in-trace*
   step, which is not needed for every commit.
3. **`VERCEL_TOKEN` in `.env`?** Needed for `vercel promote` / `vercel rollback`
   / richer deploy metadata. Recommendation: not for v1; add when Phase 8-style
   artifact promotion or a `just rollback` ADW is built.
4. **Changelog preset**: `angular` vs `conventionalcommits`. Recommendation:
   `angular` (stable, well-understood sections).
5. **Monorepo-ish future**: if more apps land in this repo, versioning goes
   per-package and this whole spec needs a `workspace` pass. Out of scope now.

## 11. Appendix — Vercel build-time env vars (no config needed)

| Var | Example | Use |
|---|---|---|
| `VERCEL_ENV` | `production` \| `preview` \| `development` | badge suffix, feature flags |
| `VERCEL_GIT_COMMIT_SHA` | `da51bd3…` | `__GIT_SHA__`, the join key |
| `VERCEL_GIT_COMMIT_REF` | `main` / `feat/foo` | `__GIT_REF__` |
| `VERCEL_GIT_COMMIT_MESSAGE` | `chore: release v0.2.0` | optional badge tooltip |
| `VERCEL_PROJECT_PRODUCTION_URL` | `ska-test-sssf.vercel.app` | canonical prod link |
| `VERCEL_URL` | `ska-test-sssf-git-…vercel.app` | this deployment's own URL |
