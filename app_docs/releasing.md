# Releasing

The full design is in [`specs/release-deploy-pipeline.md`](../specs/release-deploy-pipeline.md).
This is the runbook.

```
feature branch (local, tested)  →  vercel preview (optional)  →  vercel production (from main)
```

## The three commands

| Command | Runs on | Does |
|---|---|---|
| `just sdlc "…"` / `just simple-sdlc "…"` | feature branch | plan → build → test → review → commit |
| `just preview "…"` | feature branch (refuses `main`) | quality → push branch → verify the Vercel preview → print its URL |
| `just release "…"` | `main` only (refuses elsewhere) | quality → `release-it` (bump, changelog, tag, GitHub release, push) → verify production went green |

Merging the PR into `main` stays a human action in GitHub. `just release` runs
after the merge.

## Preview

```
git checkout -b feat/my-change
just sdlc "my change"          # or commit by hand
just preview "click-test the new board"
```

Guards: not on `main`; working tree clean; quality green. On success the preview
URL is in the console and the trace DB. Vercel also auto-previews every push —
`just preview` is for when you want a known-green, shareable link.

## Release

```
git checkout main && git pull
just release "ship the new board"
```

Guards, in order:

1. on `main`
2. working tree clean
3. local `main` == `origin/main` (no unpushed / un-pulled commits)
4. at least one `feat:` / `fix:` / `BREAKING CHANGE` commit since the last tag
5. quality (lint, typecheck, test, build) green — **before** `release-it` runs

Then `release-it --ci`:

- bumps `package.json` `version` (semver from the conventional commits)
- writes `CHANGELOG.md`
- commits `chore: release vX.Y.Z`, tags `vX.Y.Z`
- pushes the commit + tag, creates the GitHub release

Vercel builds the tagged `main` commit for production. The `verify` phase polls
the `"Vercel"` commit status for that SHA; the run is **accepted only if it
reaches `success`**.

If verify fails (timeout or red build): the run is not accepted, but **the tag
is not auto-deleted** — see Rollback. Re-check later with:

```
just release "re-verify vX.Y.Z" -- --redeploy
```

### Version on the site

Every build compiles in its own version. The badge (bottom-right) shows:

| Env | Badge |
|---|---|
| production | `vX.Y.Z` |
| preview | `vX.Y.Z · branch · sha` |
| local | `vX.Y.Z · local` |

`vX.Y.Z` is always the **last released** version. On a feature branch the work is
"post-X.Y.Z, unreleased" — that is honest, not a bug. Clicking the badge opens
the GitHub commit that is live.

## Rollback (spec §9)

- **Production regression**: Vercel dashboard → *Instant Rollback* (re-aliases
  the previous deployment, no rebuild). Then `git revert` the bad commit on
  `main` and `just release` a patch so git and the live site agree. Do **not**
  delete or move the tag.
- **Bad tag, not yet deployed** (caught immediately):
  `git tag -d vX.Y.Z && git push origin :vX.Y.Z`.

## Setup notes

- `release-it` needs a GitHub token for the release step. `adw_release` fills it
  from `gh auth token` automatically; set `GITHUB_TOKEN` in `.env` to pin one.
- No Vercel token is used. Push + the `gh` commit-status poll is the whole
  mechanism.
