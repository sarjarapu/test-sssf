#!/usr/bin/env -S uv run
# /// script
# dependencies = ["pydantic", "python-dotenv", "pyyaml", "rich"]
# ///
"""ADW Preview — push a feature branch and hand back its verified Vercel preview URL.

Usage:
    uv run adws/adw_preview.py "<why you want a preview>" [--no-verify-deploy] [--remote origin] [--config ...] [--adw-id ...]

Phases: engineer(request) -> code(quality) -> code(preview)

No agents. A build and a `git push` are known commands, so each is a kind="code"
phase (SKILL hard rule 8). This ships a COMMIT — a dirty tree fails in request.

Refuses to run on `main`: a preview deploys a feature branch. Vercel already
auto-previews every push; this ADW adds the verified + URL-in-the-trace step, so
run it when you want a shareable, known-green link — not on every commit.
"""

import argparse
import sys

from adw_modules import agents, deploy, git_helper, quality, session, utils
from adw_modules.data_types import PhaseParams

REQUIRED_AGENTS: list[str] = []


def main(prompt: str, verify_deploy: bool = True, remote: str = "origin",
         config: str = "adws/adw_sssf_config/sssf.config.yaml", adw_id: str | None = None) -> int:
    cfg = agents.load_config(config)
    agents.validate(cfg, REQUIRED_AGENTS)
    run = session.ensure(cfg, adw_id)

    with run.phase(PhaseParams(name="request", kind="engineer", owner=run.engineer,
                               description="Confirm we are on a feature branch with a shippable commit")) as ph:
        branch = git_helper.current_branch()
        ph.log(input=prompt, branch=branch, head=git_helper.short_sha("HEAD"))
        if branch == "main":
            raise RuntimeError(
                "preview refuses to run on main — it deploys a feature branch. "
                "Check out your branch and try again.")
        if git_helper.is_dirty():
            raise RuntimeError(
                "working tree is dirty — a preview deploys a commit, not a working copy. "
                "Run `just sdlc` (or commit) first, then preview what it landed.")

    with run.phase(PhaseParams(name="quality", kind="code", owner="quality",
                               description="Run lint, typecheck, test, and build; never publish a broken preview")) as ph:
        result = quality.run_quality(run)
        passed = sum(1 for check in result.checks if check.passed)
        ph.log(passed=result.passed, checks=f"{passed}/{len(result.checks)}",
               artifacts=", ".join(result.artifacts))
        if not result.passed:
            raise RuntimeError("quality failed, nothing pushed: " + "; ".join(result.failures))

    with run.phase(PhaseParams(name="preview", kind="code", owner="deploy",
                               description="Push the feature branch and wait for its Vercel preview")) as ph:
        shipped = deploy.preview(run, remote=remote, verify=verify_deploy)
        ph.log(passed=shipped.passed, environment=shipped.environment, sha=shipped.sha[:7],
               url=shipped.url or "-", detail=shipped.detail, artifact=shipped.output_artifact)
        if not shipped.passed:
            raise RuntimeError(f"preview did not go green: {shipped.detail}\n{shipped.output_tail}")

    run.console.note(f"preview ready: {shipped.url or '(no url reported)'}")
    return run.finish(accepted=shipped.passed,
                      reason="the branch pushed but the preview build never went green")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("prompt", help="inline text or a path to a prompt file")
    parser.add_argument("--no-verify-deploy", action="store_true",
                        help="push and stop — do not poll Vercel's commit status")
    parser.add_argument("--remote", default="origin", help="git remote to push to")
    parser.add_argument("--config", default="adws/adw_sssf_config/sssf.config.yaml")
    parser.add_argument("--adw-id", default=None, help="join or pin an existing session")
    args = parser.parse_args()
    sys.exit(main(utils.resolve_prompt(args.prompt), not args.no_verify_deploy,
                  args.remote, args.config, args.adw_id))
