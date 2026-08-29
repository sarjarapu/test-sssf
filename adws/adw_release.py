#!/usr/bin/env -S uv run
# /// script
# dependencies = ["pydantic", "python-dotenv", "pyyaml", "rich"]
# ///
"""ADW Release — on `main`: cut a version with release-it, then verify production.

Usage:
    uv run adws/adw_release.py "<why you are releasing>" [--redeploy] [--remote origin] [--config ...] [--adw-id ...]

Phases: engineer(request) -> code(quality) -> code(release) -> code(verify)

No agents. `release-it` and the commit-status poll are known commands, so each is
a kind="code" phase (SKILL hard rule 8).

In the GitHub-integration model "deploy" is not an imperative — it is the
consequence of the push release-it makes. The imperative acts are RELEASE (bump,
changelog, tag, GitHub release) and VERIFY (did production go green). This ADW
does both as one unit and is `accepted` only when the tagged commit is live.

Guards (request phase):
  - on `main` (refuses any other branch)
  - working tree clean
  - local `main` == `origin/main`
  - at least one feat/fix/BREAKING commit since the last tag

`--redeploy` skips release-it and just re-verifies the current tag's production
status — for when a release was cut but the deploy needs re-checking.
"""

import argparse
import sys

from adw_modules import agents, deploy, git_helper, quality, session, utils
from adw_modules.data_types import PhaseParams

REQUIRED_AGENTS: list[str] = []


def main(prompt: str, redeploy: bool = False, remote: str = "origin",
         config: str = "adws/adw_sssf_config/sssf.config.yaml", adw_id: str | None = None) -> int:
    cfg = agents.load_config(config)
    agents.validate(cfg, REQUIRED_AGENTS)
    run = session.ensure(cfg, adw_id)

    with run.phase(PhaseParams(name="request", kind="engineer", owner=run.engineer,
                               description="Check the release guards: on main, clean, synced, releasable commits")) as ph:
        deploy.assert_on_main(run)
        if git_helper.is_dirty():
            raise RuntimeError(
                "working tree is dirty — release-it needs a clean tree. Commit or stash first.")
        deploy.assert_synced(run, remote=remote, branch="main")
        commits = deploy.commits_since_last_tag(run)
        releasable = deploy.has_releasable_commits(run)
        ph.log(input=prompt, mode="redeploy" if redeploy else "release",
               last_tag=deploy.last_tag(run) or "(none)", commits_since_tag=len(commits),
               releasable=releasable)
        if not redeploy and not releasable:
            raise RuntimeError(
                "nothing to release — no feat/fix/BREAKING commit since the last tag. "
                "Use --redeploy to re-verify the current tag without bumping.")

    with run.phase(PhaseParams(name="quality", kind="code", owner="quality",
                               description="Run lint, typecheck, test, and build before anything is tagged")) as ph:
        result = quality.run_quality(run)
        passed = sum(1 for check in result.checks if check.passed)
        ph.log(passed=result.passed, checks=f"{passed}/{len(result.checks)}",
               artifacts=", ".join(result.artifacts))
        if not result.passed:
            raise RuntimeError("quality failed, nothing released: " + "; ".join(result.failures))

    release_sha = git_helper.rev("HEAD")
    tag = deploy.last_tag(run)

    if not redeploy:
        with run.phase(PhaseParams(name="release", kind="code", owner="deploy",
                                   description="Run release-it: bump, changelog, commit, tag, push, GitHub release")) as ph:
            cut = deploy.run_release_it(run)
            ph.log(passed=cut.passed, version=cut.version, tag=cut.tag, sha=cut.sha[:7],
                   github_release=cut.github_release_url or "-", detail=cut.detail,
                   artifact=cut.output_artifact)
            if not cut.passed:
                raise RuntimeError(f"release-it did not complete: {cut.detail}\n{cut.output_tail}")
            release_sha, tag = cut.sha, cut.tag

    with run.phase(PhaseParams(name="verify", kind="code", owner="deploy",
                               description="Poll Vercel's commit status for the tagged commit; production must go green")) as ph:
        shipped = deploy.verify_deploy(run, sha=release_sha, environment="production")
        ph.log(passed=shipped.passed, tag=tag or "-", sha=release_sha[:7],
               url=shipped.url or "-", detail=shipped.detail, artifact=shipped.output_artifact)
        if not shipped.passed:
            raise RuntimeError(
                f"{tag or release_sha[:7]} did not reach a green production deploy: "
                f"{shipped.detail}. The tag is NOT auto-deleted — rolling back is a "
                f"human decision (spec §9).\n{shipped.output_tail}")

    run.console.note(f"released {tag or release_sha[:7]} — production is live: {shipped.url or '(no url)'}")
    return run.finish(accepted=shipped.passed,
                      reason="release-it ran but the tagged commit never went green in production")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("prompt", help="inline text or a path to a prompt file")
    parser.add_argument("--redeploy", action="store_true",
                        help="skip release-it; only re-verify the current tag's production deploy")
    parser.add_argument("--remote", default="origin", help="git remote for the sync check")
    parser.add_argument("--config", default="adws/adw_sssf_config/sssf.config.yaml")
    parser.add_argument("--adw-id", default=None, help="join or pin an existing session")
    args = parser.parse_args()
    sys.exit(main(utils.resolve_prompt(args.prompt), args.redeploy,
                  args.remote, args.config, args.adw_id))
