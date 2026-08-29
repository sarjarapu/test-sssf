#!/usr/bin/env -S uv run
# /// script
# dependencies = ["pydantic", "python-dotenv", "pyyaml", "rich"]
# ///
"""ADW Release — verify the committed tree, push it, watch Vercel ship it.

Usage:
    uv run adws/adw_release.py "<reason for the release>" [--no-verify-deploy] [--remote origin] [--config ...] [--adw-id ...]

Phases: engineer(request) -> code(quality) -> code(release)

No agents. A production build and a `git push` are both known commands, so each
is a kind="code" phase (SKILL hard rule 8). Quality runs first and a red build
stops the run before anything is pushed.

This ships a COMMIT, not a working copy: a dirty tree fails in the request
phase. Run a build/commit ADW first, then release what it landed. The Vercel
project is wired to GitHub, so pushing `main` is a production deploy and pushing
any other branch is a preview — adw_modules/deploy.py polls the commit status
the Vercel GitHub app writes back, so the phase only goes green when the host
build did too.
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
                               description="Capture why a release was requested and confirm the tree is shippable")) as ph:
        branch = git_helper.current_branch()
        ph.log(input=prompt, branch=branch,
               environment="production" if branch == "main" else "preview",
               head=git_helper.short_sha("HEAD"))
        if git_helper.is_dirty():
            raise RuntimeError(
                "working tree is dirty — a release ships a commit, not a working copy. "
                "Commit the change (or run a build ADW) first, then release.")

    with run.phase(PhaseParams(name="quality", kind="code", owner="quality",
                               description="Run lint, typecheck, test, and build; a red result must never ship")) as ph:
        result = quality.run_quality(run)
        passed = sum(1 for check in result.checks if check.passed)
        ph.log(passed=result.passed, checks=f"{passed}/{len(result.checks)}",
               artifacts=", ".join(result.artifacts))
        if not result.passed:
            raise RuntimeError("quality failed, nothing pushed: " + "; ".join(result.failures))

    with run.phase(PhaseParams(name="release", kind="code", owner="deploy",
                               description="Push the verified commit and wait for Vercel's deployment status")) as ph:
        shipped = deploy.release(run, remote=remote, verify=verify_deploy)
        ph.log(passed=shipped.passed, environment=shipped.environment, sha=shipped.sha[:7],
               url=shipped.url or "-", detail=shipped.detail, artifact=shipped.output_artifact)
        if not shipped.passed:
            raise RuntimeError(f"release did not succeed: {shipped.detail}\n{shipped.output_tail}")

    return run.finish(accepted=shipped.passed,
                      reason="the push landed but the host build never went green")


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
