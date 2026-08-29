# Prerequisites

System tools the app **and** the ADW factory assume are on your `PATH`. Versions
in the last column are what this repo has been run with — newer is generally fine.

## Required

| Tool | Used for | Verified |
|---|---|---|
| **git** | version control; `deploy.py` shells out to it | 2.50 |
| **Node.js + npm** | the React app: build, tests, lint, `tsc`, `vite`, and `release-it` (all via `npm` / `npx`) | node 22, npm 10 |
| **uv** | runs every `adws/adw_*.py` — the scripts declare their own Python deps inline, `uv` fetches them | 0.10 |
| **just** | the command runner for the `justfile` recipes (`just plan`, `just sdlc`, `just preview`, `just release`, `just obs`, …) | 1.58 |
| **gh** (GitHub CLI) | `deploy.py` polls the Vercel commit status; `release-it` gets its token from `gh auth token`; PRs. **Must be authenticated** — run `gh auth login` once | 2.98 |
| **claude** (Claude Code CLI) | the coding agent the ADW phases spawn (`coding_agent: claude_code` in `sssf.config.yaml`). **Must be logged in** — `claude login` (uses your subscription, not API billing) | 2.1 |

## Optional

| Tool | Used for | Verified |
|---|---|---|
| **bun** | the observability visualizer — `just obs` (API server + build). Nothing else needs it | 1.4 |
| **sqlite3** (CLI) | the quick trace peeks: `just sessions`, `just phases <id>`, `just tail <id>`, `just procs <id>`. The visualizer reads the db without it | 3.51 |
| **pi** | only if you switch a roster agent to `coding_agent: pi`. Needs `~/.pi/agent/models.json` and the matching provider key in `.env` (`OPENROUTER_API_KEY`, etc.). See pi's own docs to install | 0.84 |

## Install

### macOS (Homebrew)

```bash
brew install git node uv just gh sqlite
brew install oven-sh/bun/bun                      # optional: visualizer
npm install -g @anthropic-ai/claude-code          # claude CLI

gh auth login                                     # authenticate GitHub
claude login                                      # authenticate Claude Code
```

### Debian / Ubuntu (apt-get)

```bash
sudo apt-get update
sudo apt-get install -y git sqlite3 curl

# Node.js 22 (distro package is usually too old)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# GitHub CLI (official repo)
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt-get update && sudo apt-get install -y gh

# uv (no apt package)
curl -LsSf https://astral.sh/uv/install.sh | sh

# just — apt's version lags; use the official installer
curl -fsSL https://just.systems/install.sh | sudo bash -s -- --to /usr/local/bin

# bun (optional: visualizer — no apt package)
curl -fsSL https://bun.sh/install | bash

# claude CLI
npm install -g @anthropic-ai/claude-code

gh auth login
claude login
```

## Project dependencies (not system-wide)

Handled by the package managers, listed here so you know they're covered:

- **`npm install`** — `vite`, `vitest`, `typescript`, `eslint`, `release-it`,
  `@release-it/conventional-changelog`, React, etc. (`package.json`).
- **`uv`** — Python deps (`pydantic`, `python-dotenv`, `pyyaml`, `rich`) are in
  each ADW script's `# /// script` header; `uv run` installs them on first use.
- **`.env`** at the repo root — only needed for a `coding_agent: pi` roster
  (provider API keys) or to pin `GITHUB_TOKEN`. The default `claude_code` roster
  needs nothing here.

## Verify

```bash
for c in git node npm npx uv just gh claude bun sqlite3; do
  printf '%-9s ' "$c"; command -v "$c" >/dev/null && "$c" --version 2>/dev/null | head -1 || echo '(missing)'
done
gh auth status
```
