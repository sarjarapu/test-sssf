# Request: Release & Deploy Pipeline

Full design and rationale: **`specs/release-deploy-pipeline.md`** — read it first.

## Ask

Build ADW modules for a staged shipping pipeline:

```
feature branch (local, tested)  →  vercel preview (optional)  →  vercel production (from main)
```

- Feature-branch workflow. Existing SDLC ADWs do local plan/build/test/review.
- `just preview` — push a feature branch, verify the Vercel preview, print its URL.
  Refuses to run on `main`.
- `just release` — **on `main` only**: run `release-it` (bump `package.json`,
  update `CHANGELOG.md`, tag `vX.Y.Z`, GitHub release, push), then confirm the
  tagged commit's production deploy on Vercel goes green. Accepted only if it does.
- The website shows its version (`vX.Y.Z` in prod; `vX.Y.Z · branch · sha` in
  preview), compiled in at build time so it always matches the live code.

## Build order (see spec §7)

1. **Version badge** — `vite.config.ts` `define` block + `src/vite-env.d.ts` +
   `src/components/VersionBadge.tsx`, mounted in the layout chrome.
2. **release-it** — `npm i -D release-it @release-it/conventional-changelog`,
   `.release-it.json` (angular preset), baseline tag `v0.1.0`.
3. **`deploy.py` refactor** — split `release()` into `push_current_branch`,
   `await_vercel`, `preview()`, `release()`, plus `release-it` + version helpers.
4. **`adw_preview.py`** (new) and **`adw_release.py`** (rewrite: main-only + release-it).
5. **justfile** recipes + `app_docs/releasing.md` runbook.

## Constraints

- No Vercel token / no `.vercel/` link in v1 — use `git push` + the `gh` commit-status
  poll that `deploy.py` already does.
- `package.json` `version` is written only by `release-it`, only on `main`.
- Hard rules in `.claude/skills/sssf/SKILL.md` apply — deploy/release steps are
  `kind="code"` phases, no agents; every ADW ends in `run.finish(accepted=…)`.

## Open questions to confirm with the requester (spec §10)

1. Require PRs into `main` (recommended) vs allow direct push?
2. `just preview` on demand only (recommended) vs every feature push?
3. Add `VERCEL_TOKEN` now for `vercel promote`/`rollback`? (recommended: not yet)
