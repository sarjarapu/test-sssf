"""Deterministic release blocks — push a verified tree and watch the host build.

This project's Vercel project is wired to GitHub: a push to the production
branch ships production, a push to any other branch ships a preview. So a
release is not `vercel deploy` — it is `git push`, followed by watching the
deployment status the Vercel GitHub app writes back onto the commit.

Nothing here needs a Vercel token. The push uses the operator's own git
credentials; the status poll uses `gh` (already the factory's GitHub CLI), which
reads `repos/{owner}/{repo}/commits/{sha}/status`. If `gh` is missing or
unauthenticated the block still succeeds at the push and reports "unverified" —
the deploy is a fact on GitHub either way, the poll is just the confirmation.

Layout (see specs/release-deploy-pipeline.md §7.3):
  push_current_branch  — push HEAD, classify production vs preview
  await_vercel         — poll the "Vercel" commit status to a terminal state
  preview / release    — push + await, wrapped as a typed DeployResult
  version + release-it  helpers — read_pkg_version, assert_on_main,
                         assert_synced, commits_since_last_tag, run_release_it

Shape matches adw_modules/quality.py: an argv list, a captured log under
context_handoff/, a typed result, a verbatim tail. A failure travels back to an
agent through `as_envelope`, exactly like a red test run.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import time
from pathlib import Path

from .data_types import DeployResult, EventRecord, ReleaseResult, VerifyOutput
from .utils import now_iso, operator_env

TAIL_CHARS = 4_000

# Vercel writes one commit status with this context; state is pending -> success|failure|error.
_VERCEL_CONTEXT = "Vercel"
_TERMINAL_STATES = {"success", "failure", "error"}


def _artifact_dir(run, name: str) -> Path:
    seq = run.phases[-1].seq if run.phases else 0
    path = run.context_handoff_dir / "deploy" / f"{seq:02d}_{name}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _run(argv: list[str], timeout: int, cwd: str | None = None) -> tuple[int, str, str]:
    """Run a child with the operator's environment. Never raises — returns (rc, out, err)."""
    try:
        done = subprocess.run(argv, capture_output=True, text=True, cwd=cwd,
                              env=operator_env(), timeout=timeout)
        return done.returncode, done.stdout, done.stderr
    except subprocess.TimeoutExpired as error:
        return 124, error.stdout or "", (error.stderr or "") + f"\nTimed out after {timeout}s."
    except OSError as error:
        return 127, "", str(error)


def _git(run, *args: str, timeout: int = 15) -> tuple[int, str, str]:
    return _run(["git", "-C", str(run.repo_root), *args], timeout=timeout)


def github_repo(run) -> str:
    """`owner/name` parsed from `origin`, for the `gh` status poll. "" when there is no match."""
    rc, out, _ = _git(run, "remote", "get-url", "origin", timeout=10)
    if rc != 0:
        return ""
    match = re.search(r"github\.com[:/]+([^/]+)/(.+?)(?:\.git)?/?$", out.strip())
    return f"{match.group(1)}/{match.group(2)}" if match else ""


# ── push ────────────────────────────────────────────────────────────────────

def push_current_branch(run, remote: str = "origin", branch: str | None = None,
                        production_branch: str = "main",
                        timeout_seconds: int = 600) -> tuple[str, str, str, tuple[int, str, str]]:
    """Push HEAD to `remote`. Returns (branch, sha, environment, (rc, out, err)).

    Pushing the production branch is a production deploy; anything else is a
    preview. The caller inspects `rc` — this never raises, so a failed push can
    still be reported as a DeployResult.
    """
    branch = branch or _git(run, "rev-parse", "--abbrev-ref", "HEAD")[1].strip()
    sha = _git(run, "rev-parse", "HEAD")[1].strip()
    environment = "production" if branch == production_branch else "preview"
    proc = _run(["git", "-C", str(run.repo_root), "push", remote, f"HEAD:{branch}"],
                timeout=timeout_seconds)
    return branch, sha, environment, proc


# ── verify ──────────────────────────────────────────────────────────────────

def _vercel_status(repo: str, sha: str) -> tuple[str, str, str]:
    """(state, target_url, raw) for the Vercel commit status. state "" means not posted yet."""
    rc, out, err = _run(
        ["gh", "api", f"repos/{repo}/commits/{sha}/status",
         "--jq", '{state: .state, statuses: [.statuses[] | {context, state, target_url}]}'],
        timeout=30,
    )
    if rc != 0:
        return "", "", (out + err).strip()
    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        return "", "", out.strip()
    for status in data.get("statuses", []):
        if status.get("context") == _VERCEL_CONTEXT:
            return status.get("state", ""), status.get("target_url", ""), out.strip()
    return "", "", out.strip()


def await_vercel(repo: str, sha: str, timeout_seconds: int = 600, poll_seconds: int = 10,
                 emit=lambda _text: None) -> tuple[str, str, str]:
    """Poll the "Vercel" commit status until it reaches a terminal state or times out.

    Returns (state, target_url, raw_json). `state` is "" when the status was
    never posted, one of success|failure|error when terminal, else the last
    non-terminal state seen before the deadline.
    """
    deadline = time.monotonic() + timeout_seconds
    state, target_url, raw = "", "", ""
    while time.monotonic() < deadline:
        state, target_url, raw = _vercel_status(repo, sha)
        if state in _TERMINAL_STATES:
            return state, target_url, raw
        emit(f"{_VERCEL_CONTEXT} {state or 'not posted yet'} — waiting {poll_seconds}s")
        time.sleep(poll_seconds)
    return state, target_url, raw


# ── preview / release: push + verify, wrapped as a DeployResult ──────────────

def _ship(run, kind: str, remote: str, branch: str | None, verify: bool,
          production_branch: str, timeout_seconds: int, poll_seconds: int) -> DeployResult:
    phase = run.phases[-1]
    out_dir = _artifact_dir(run, kind)
    log = out_dir / f"{kind}.log"
    lines: list[str] = []

    def emit(text: str) -> None:
        lines.append(text)
        run.console.note(f"{kind}: {text}")

    started_at = now_iso()
    clock = time.monotonic()

    branch, sha, environment, (rc, out, err) = push_current_branch(
        run, remote, branch, production_branch, timeout_seconds)
    command = f"git push {remote} HEAD:{branch}"
    emit(f"{command}  ({environment}, {sha[:7]})")
    emit((out + err).strip() or f"push exit {rc}")

    if rc != 0:
        return _finish(run, phase, log, lines, started_at, clock, DeployResult(
            passed=False, target="vercel", environment=environment, command=command,
            returncode=rc, sha=sha, detail=f"git push failed (exit {rc})",
            output_tail=(out + err)[-TAIL_CHARS:]))

    if not verify:
        return _finish(run, phase, log, lines, started_at, clock, DeployResult(
            passed=True, target="vercel", environment=environment, command=command,
            returncode=0, sha=sha, detail="pushed; deploy not verified",
            output_tail=(out + err)[-TAIL_CHARS:]))

    repo = github_repo(run)
    if not repo:
        return _finish(run, phase, log, lines, started_at, clock, DeployResult(
            passed=True, target="vercel", environment=environment, command=command,
            returncode=0, sha=sha, detail="pushed; no GitHub remote to poll",
            output_tail="\n".join(lines)[-TAIL_CHARS:]))

    emit(f"polling {repo}@{sha[:7]} for the {_VERCEL_CONTEXT} status "
         f"(every {poll_seconds}s, up to {timeout_seconds}s)")
    state, target_url, raw = await_vercel(repo, sha, timeout_seconds, poll_seconds, emit)

    passed = state == "success"
    if state in _TERMINAL_STATES:
        detail = f"{_VERCEL_CONTEXT}: {state}"
    elif state:
        detail = f"{_VERCEL_CONTEXT}: {state} — timed out after {timeout_seconds}s"
    else:
        detail = f"{_VERCEL_CONTEXT} status never posted — timed out after {timeout_seconds}s"
    emit(detail + (f"  {target_url}" if target_url else ""))

    return _finish(run, phase, log, lines, started_at, clock, DeployResult(
        passed=passed, target="vercel", environment=environment, command=command,
        returncode=0, sha=sha, url=target_url, detail=detail,
        output_tail=(raw or "\n".join(lines))[-TAIL_CHARS:]))


def preview(run, remote: str = "origin", branch: str | None = None, verify: bool = True,
            production_branch: str = "main", timeout_seconds: int = 600,
            poll_seconds: int = 10) -> DeployResult:
    """Push a feature branch and wait for its Vercel preview. Refuses the production branch."""
    current = branch or _git(run, "rev-parse", "--abbrev-ref", "HEAD")[1].strip()
    if current == production_branch:
        raise RuntimeError(
            f"preview refuses to run on {production_branch} — a preview deploys a "
            f"feature branch. Check out a branch first.")
    return _ship(run, "preview", remote, branch, verify, production_branch,
                 timeout_seconds, poll_seconds)


def release(run, remote: str = "origin", branch: str | None = None, verify: bool = True,
            production_branch: str = "main", timeout_seconds: int = 600,
            poll_seconds: int = 10) -> DeployResult:
    """Push the current branch and, when `verify`, wait for Vercel's commit status.

    The tree must already be committed — a release ships a commit, not a working
    copy. Pushing the production branch is a production deploy.
    """
    return _ship(run, "release", remote, branch, verify, production_branch,
                 timeout_seconds, poll_seconds)


def _finish(run, phase, log: Path, lines: list[str], started_at: str, clock: float,
            result: DeployResult) -> DeployResult:
    """Write the artifact, emit the trace event, stamp timing — shared tail for every path."""
    duration = time.monotonic() - clock
    result.duration_seconds = duration
    result.output_artifact = str(log)
    log.write_text(f"# release {result.target} ({result.environment})\n"
                   f"sha: {result.sha}\ncommand: {result.command}\n"
                   f"passed: {result.passed}\ndetail: {result.detail}\n"
                   f"duration_seconds: {duration:.3f}\n\n" + "\n".join(lines) + "\n")
    run.tracer.event(EventRecord(
        adw_id=run.adw_id, phase_id=phase.phase_id, type="tool_call", name="deploy:vercel",
        payload={"environment": result.environment, "command": result.command,
                 "sha": result.sha, "passed": result.passed, "url": result.url,
                 "detail": result.detail, "output_artifact": result.output_artifact},
        started_at=started_at, ended_at=now_iso()))
    run.console.note(f"deploy {result.target}: "
                     f"{'ok' if result.passed else 'failed'} ({duration:.1f}s) {result.detail}")
    return result


def as_envelope(result: DeployResult) -> VerifyOutput:
    """Wrap a release result so an agent can be handed it — the door every handoff uses."""
    return VerifyOutput(
        status="success" if result.passed else "fail",
        summary=(f"{result.environment} deploy of {result.sha[:7]} succeeded"
                 f"{' — ' + result.url if result.url else ''}" if result.passed
                 else f"{result.environment} deploy of {result.sha[:7]} did not succeed: {result.detail}"),
        artifacts=[result.output_artifact] if result.output_artifact else [],
        notes_for_next_agent=("" if result.passed else
                              "The push landed but the host build did not go green. Read the "
                              "artifact and the inspector URL; fix the build, commit, re-run."),
        passed=result.passed,
        failures=[] if result.passed else [f"{result.detail}\n{result.output_tail}".rstrip()],
    )


# ── version + release-it helpers (main only) ─────────────────────────────────

def read_pkg_version(run) -> str:
    """The `version` field of the repo-root package.json — the last released semver."""
    pkg = Path(run.repo_root) / "package.json"
    return json.loads(pkg.read_text())["version"]


def assert_on_main(run, production_branch: str = "main") -> str:
    """Raise unless HEAD is the production branch. Returns the branch name."""
    branch = _git(run, "rev-parse", "--abbrev-ref", "HEAD")[1].strip()
    if branch != production_branch:
        raise RuntimeError(
            f"adw_release runs on {production_branch} only — you are on '{branch}'. "
            f"Merge the feature branch first, then release from {production_branch}.")
    return branch


def assert_synced(run, remote: str = "origin", branch: str = "main") -> None:
    """Raise unless local `branch` exactly equals `remote/branch` (no unpushed/unpulled commits)."""
    rc, out, err = _git(run, "fetch", remote, branch, timeout=60)
    if rc != 0:
        raise RuntimeError(f"could not fetch {remote}/{branch}: {(out + err).strip()}")
    local = _git(run, "rev-parse", branch)[1].strip()
    upstream = _git(run, "rev-parse", f"{remote}/{branch}")[1].strip()
    if local != upstream:
        raise RuntimeError(
            f"local {branch} ({local[:7]}) != {remote}/{branch} ({upstream[:7]}) — "
            f"push or pull so they agree before releasing.")


def last_tag(run) -> str:
    """The most recent tag reachable from HEAD, or "" when the repo has no tags yet."""
    rc, out, _ = _git(run, "describe", "--tags", "--abbrev=0")
    return out.strip() if rc == 0 else ""


def commits_since_last_tag(run) -> list[str]:
    """Subject lines of commits since the last tag (all commits when there is no tag)."""
    tag = last_tag(run)
    span = f"{tag}..HEAD" if tag else "HEAD"
    rc, out, _ = _git(run, "log", span, "--format=%s")
    return [line for line in out.splitlines() if line.strip()] if rc == 0 else []


_RELEASABLE = re.compile(r"^(feat|fix)(\(.+\))?!?:|^\w+(\(.+\))?!:|BREAKING CHANGE", re.MULTILINE)


def has_releasable_commits(run) -> bool:
    """True when at least one commit since the last tag is a feat/fix/BREAKING change."""
    return any(_RELEASABLE.search(subject) for subject in commits_since_last_tag(run))


def _github_token() -> str:
    """A token for release-it's GitHub step: the env var if set, else `gh auth token`."""
    for key in ("GITHUB_TOKEN", "GH_TOKEN"):
        if os.environ.get(key):
            return os.environ[key]
    rc, out, _ = _run(["gh", "auth", "token"], timeout=15)
    return out.strip() if rc == 0 else ""


def run_release_it(run, timeout_seconds: int = 600) -> ReleaseResult:
    """Run `npx release-it --ci` at the repo root and record what it produced.

    Assumes the guards already passed (on main, synced, releasable commits,
    quality green). Reads the resulting version/tag/sha back from the repo.
    """
    phase = run.phases[-1]
    out_dir = _artifact_dir(run, "release-it")
    log = out_dir / "release-it.log"
    root = str(run.repo_root)
    started_at = now_iso()
    clock = time.monotonic()

    before_sha = _git(run, "rev-parse", "HEAD")[1].strip()
    env = dict(operator_env())
    token = _github_token()
    if token:
        env["GITHUB_TOKEN"] = token

    argv = ["npx", "release-it", "--ci"]
    command = shlex.join(argv)
    run.console.note(f"release-it: {command}")
    try:
        done = subprocess.run(argv, capture_output=True, text=True, cwd=root,
                              env=env, timeout=timeout_seconds)
        rc, out, err = done.returncode, done.stdout, done.stderr
    except subprocess.TimeoutExpired as error:
        rc, out, err = 124, error.stdout or "", (error.stderr or "") + f"\nTimed out after {timeout_seconds}s."
    except OSError as error:
        rc, out, err = 127, "", str(error)

    combined = (out + "\n" + err).strip()
    duration = time.monotonic() - clock

    version = read_pkg_version(run)
    tag = last_tag(run)
    sha = _git(run, "rev-parse", "HEAD")[1].strip()
    changelog = "CHANGELOG.md" if (Path(root) / "CHANGELOG.md").exists() else ""

    release_url = ""
    if rc == 0 and tag:
        rc_url, url_out, _ = _run(["gh", "release", "view", tag, "--json", "url",
                                   "--jq", ".url"], timeout=20, cwd=root)
        if rc_url == 0:
            release_url = url_out.strip()

    passed = rc == 0 and tag != "" and sha != before_sha
    detail = (f"released {tag}" if passed
              else f"release-it exited {rc}" if rc != 0
              else "release-it made no new commit/tag")

    result = ReleaseResult(
        passed=passed, command=command, returncode=rc, version=version, tag=tag, sha=sha,
        changelog_path=changelog, github_release_url=release_url, detail=detail,
        duration_seconds=duration, output_artifact=str(log),
        output_tail=combined[-TAIL_CHARS:])

    log.write_text(f"# release-it\ncommand: {command}\npassed: {passed}\n"
                   f"version: {version}\ntag: {tag}\nsha: {sha}\n"
                   f"github_release: {release_url or '-'}\ndetail: {detail}\n"
                   f"duration_seconds: {duration:.3f}\n\n{combined}\n")
    run.tracer.event(EventRecord(
        adw_id=run.adw_id, phase_id=phase.phase_id, type="tool_call", name="release-it",
        payload={"command": command, "passed": passed, "version": version, "tag": tag,
                 "sha": sha, "github_release_url": release_url, "detail": detail,
                 "output_artifact": str(log)},
        started_at=started_at, ended_at=now_iso()))
    run.console.note(f"release-it: {'ok' if passed else 'failed'} ({duration:.1f}s) {detail}")
    return result
