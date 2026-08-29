"""Claude Code interface — runs agent turns through the real `claude` CLI.

`claude -p --output-format stream-json --verbose` IS Claude Code, so it
authenticates first-party. With `claude_code_auth: subscription` the child's
ANTHROPIC_API_KEY is stripped and the CLI falls back to its cached `claude login`
session, drawing the operator's Claude plan window instead of per-token API
credits — something a third-party harness like `pi` cannot do (Anthropic
classifies a non-Claude-Code client as pay-per-token "extra usage").

ONE `claude` process stays alive for a whole agent phase (`Session.open()` ->
`send()` x N -> `close()`). The first prompt, every JSON-fix retry and every
gate correction are turns on that same process, so the ~14k Claude Code system
prefix is a cache WRITE once and a cache READ (~0.1x weight against the plan
window) thereafter, and conversation history accumulates in-process instead of
being rebuilt each turn. `--resume <session_id>` is used only when a LATER phase
re-owns the agent (the CLI mints the id on the first turn; `agents.execute()`
stores it and feeds it back).

`run(request, ...)` is kept as a one-shot (open/send/close) for callers that
want the pi-style single call. Same `-> AgentResult` contract as agent_pi, plus
resolve_model() and ToolCallTracker, so agents.execute() never sees the
difference.
"""

from __future__ import annotations

import json
import logging
import os
import select
import shutil
import subprocess
import time
from pathlib import Path
from typing import Callable, Optional

from .agent_pi import (ARG_VALUE_CHARS, RESULT_SNIPPET_CHARS, _clip, _label)
from .data_types import AgentRequest, AgentResult
from .utils import now_iso, operator_env

log = logging.getLogger("sssf.agent_cc")

CLAUDE_PATH = os.environ.get("SSSF_CLAUDE_PATH", "claude")

# Which Claude settings layers the subprocess loads. The operator's personal
# `user` layer — where SessionStart hooks and personal MCP servers live — is
# excluded by default so it cannot fire on every agent turn. Override with
# SSSF_CLAUDE_SETTING_SOURCES once verification step 0 confirms the right value
# for the installed CLI ("" for none, "project,local", etc.).
SETTING_SOURCES = os.environ.get("SSSF_CLAUDE_SETTING_SOURCES", "project,local")

# Extra flags appended verbatim, space-split. Escape hatch for per-site tuning
# (a settings file, a permission mode) without a code change.
EXTRA_ARGS = os.environ.get("SSSF_CLAUDE_EXTRA_ARGS", "").split()

# CI override of the config's `claude_code_system` (append|replace). Empty = use
# the request value.
SYSTEM_MODE_OVERRIDE = os.environ.get("SSSF_CLAUDE_SYSTEM", "").strip()

# model id -> context window (tokens). `claude` reports the real ceiling in the
# result event's modelUsage; this is the validate() allowlist + a pre-run
# fallback for the visualizer's context bar.
_CLAUDE_MODELS = {
    "claude-sonnet-5": 1_000_000,
    "claude-opus-5": 1_000_000,
    "claude-haiku-4-5": 200_000,
    "claude-opus-4-8": 1_000_000,
    "claude-opus-4-7": 1_000_000,
}
_ALIASES = {"sonnet": "claude-sonnet-5", "opus": "claude-opus-5", "haiku": "claude-haiku-4-5"}

# List price, $ per 1M tokens — for the per-component cost split only. The
# authoritative total is the result event's total_cost_usd (a list-price
# estimate on subscription, not an actual charge).
_PRICES = {
    "claude-sonnet-5": {"input": 2.0, "output": 10.0, "cache_read": 0.20, "cache_write": 2.50},
    "claude-opus-5": {"input": 5.0, "output": 25.0, "cache_read": 0.50, "cache_write": 6.25},
    "claude-haiku-4-5": {"input": 1.0, "output": 5.0, "cache_read": 0.10, "cache_write": 1.25},
    "claude-opus-4-8": {"input": 5.0, "output": 25.0, "cache_read": 0.50, "cache_write": 6.25},
    "claude-opus-4-7": {"input": 5.0, "output": 25.0, "cache_read": 0.50, "cache_write": 6.25},
}

# pi builtin tool name -> claude --allowedTools entry
_TOOL_MAP = {
    "read": "Read", "write": "Write", "edit": "Edit", "bash": "Bash",
    "grep": "Grep", "find": "Glob", "ls": "Read",
}

# pi's 7-level thinking ladder -> claude's 3 effort levels
_THINKING_EFFORT = {
    "off": "low", "minimal": "low", "low": "low",
    "medium": "medium",
    "high": "high", "xhigh": "high", "max": "high",
}


class RateLimited(RuntimeError):
    """The Claude plan window (5h / 7d) is exhausted — not retryable right now.

    Overage is often org-disabled, so an exhausted window hard-rejects rather
    than falling back to per-token. The ADW surfaces this as a clean phase
    failure with the reset time; a joined rerun after the reset resumes.
    """

    def __init__(self, message: str, resets_at: Optional[int] = None):
        super().__init__(message)
        self.resets_at = resets_at


# ── validation ───────────────────────────────────────────────────────────────

def resolve_model(pattern: str) -> tuple[str, int]:
    """(model_id, context_window). Accepts `anthropic/<id>`, a bare id, or an alias."""
    name = pattern.split("/", 1)[1] if "/" in pattern else pattern
    name = _ALIASES.get(name, name)
    if name in _CLAUDE_MODELS:
        return name, _CLAUDE_MODELS[name]
    raise ValueError(
        f"claude model {pattern!r} not in the known set {sorted(_CLAUDE_MODELS)} — "
        f"add it to agent_cc._CLAUDE_MODELS or fix the config")


def check_auth(mode: str) -> None:
    """Fail fast if the credential for the chosen billing path is missing."""
    if shutil.which(CLAUDE_PATH) is None:
        raise ValueError(
            f"claude_code needs the {CLAUDE_PATH!r} CLI on PATH — install it and "
            f"run `claude login` (subscription) or set ANTHROPIC_API_KEY (api_key)")
    if mode == "api_key" and not os.environ.get("ANTHROPIC_API_KEY"):
        raise ValueError("claude_code_auth: api_key requires ANTHROPIC_API_KEY in the environment")


# ── internals ────────────────────────────────────────────────────────────────

def _auth_env(mode: str) -> dict:
    env = operator_env()
    if mode == "subscription":
        for key in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"):
            env.pop(key, None)
    return env


def _allowed_tools(tools: Optional[list[str]]) -> Optional[list[str]]:
    """Translate the config's pi tool names to `claude --allowedTools` entries.
    None/empty -> None (claude's default tool set)."""
    if not tools:
        return None
    out: list[str] = []
    for name in tools:
        if name.startswith("subagent_"):
            log.warning("agent_cc: tool %r has no claude equivalent — dropped", name)
            continue
        mapped = _TOOL_MAP.get(name, name)   # pass unknowns through verbatim
        if mapped not in out:
            out.append(mapped)
    return out or None


def _system_prompt_args(request: AgentRequest) -> list[str]:
    """Build the --system-prompt / --append-system-prompt flags.

    append  (default, supported): keep Claude Code's ~14k default and add the
            agent's system.md via --append-system-prompt; optionally lift the
            per-machine sections out of the cached prefix.
    replace (opt-in escape hatch): the ONLY system text is the configured core
            markdown + the agent's system.md, via --system-prompt. Nothing of
            Claude's default operating guidance carries over.
    """
    mode = SYSTEM_MODE_OVERRIDE or request.claude_code_system or "append"
    persona = request.system_prompt or ""
    if mode == "replace":
        core = request.core_system_prompt or ""
        combined = "\n\n".join(p for p in (core, persona) if p) or persona
        return ["--system-prompt", combined]
    args = ["--append-system-prompt", persona]
    if request.claude_code_exclude_dynamic_sections:
        args.append("--exclude-dynamic-system-prompt-sections")
    return args


def _result_text(content) -> str:
    """A tool_result's content is a string or a list of blocks."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(b.get("text", "") for b in content
                       if isinstance(b, dict) and b.get("type") == "text")
    return ""


class ToolCallTracker:
    """Folds claude's tool_use (assistant msg) + tool_result (later user msg)
    into normalized records — the same record shape agent_pi.ToolCallTracker
    emits, so agents._event_forwarder stays engine-agnostic.

    observe() returns a LIST (one user message can carry several parallel
    tool_result blocks), or None. The forwarder normalizes dict|list|None.
    """

    def __init__(self) -> None:
        self._open: dict[str, dict] = {}

    def observe(self, event: dict):
        etype = event.get("type")
        if etype == "assistant":
            for block in (event.get("message", {}) or {}).get("content") or []:
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    cid = str(block.get("id") or "")
                    if cid:
                        self._open[cid] = {
                            "tool": block.get("name") or "tool",
                            "args": block.get("input") or {},
                            "started_at": now_iso(),
                            "clock": time.monotonic(),
                        }
            return None
        if etype != "user":
            return None

        records = []
        for block in (event.get("message", {}) or {}).get("content") or []:
            if not isinstance(block, dict) or block.get("type") != "tool_result":
                continue
            cid = str(block.get("tool_use_id") or "")
            opened = self._open.pop(cid, {})
            tool = opened.get("tool", "tool")
            args = opened.get("args", {}) or {}
            record = {
                "tool": tool,
                "tool_call_id": cid,
                "args": {k: _clip(v, ARG_VALUE_CHARS) if isinstance(v, str) else v
                         for k, v in args.items()},
                "ok": not block.get("is_error", False),
                "label": _label(tool, args),
                "ended_at": now_iso(),
            }
            text = _result_text(block.get("content"))
            if text:
                record["result_snippet"] = _clip(text, RESULT_SNIPPET_CHARS)
            if opened.get("started_at"):
                record["started_at"] = opened["started_at"]
            if opened.get("clock"):
                record["duration_ms"] = int((time.monotonic() - opened["clock"]) * 1000)
            records.append(record)
        return records or None


# ── session (persistent process, one per agent phase) ────────────────────────

# A hung `claude` child would otherwise block the phase forever on a stdout
# read. If no line arrives for this many seconds the child is killed and the
# phase fails cleanly. 0 disables the watchdog.
READ_TIMEOUT = float(os.environ.get("SSSF_CLAUDE_READ_TIMEOUT", "900"))


def _user_line(prompt: str) -> str:
    """One NDJSON stdin line for a user turn in --input-format stream-json."""
    return json.dumps({"type": "user",
                       "message": {"role": "user", "content": prompt}}) + "\n"


class Session:
    """One long-lived `claude -p --input-format stream-json` process.

    open() -> send() x N -> close(). Each send() is one turn on the SAME
    process, so the fixed ~14k system prefix is cache-written once then
    cache-read, and history accumulates in-cache instead of being rebuilt.
    resume_session_id on the base request applies --resume ONCE at open (a later
    phase re-owning this agent); turns within a phase never resume.
    """

    def __init__(self, request: AgentRequest,
                 on_event: Optional[Callable[[dict], None]] = None,
                 on_spawn: Optional[Callable[[int], None]] = None,
                 on_exit: Optional[Callable[[int], None]] = None) -> None:
        self.request = request
        self.on_event = on_event
        self.on_spawn = on_spawn
        self.on_exit = on_exit
        self.model_id, self.ctx_window = resolve_model(request.model)
        self.session_id = request.resume_session_id or ""
        self.returncode = 0
        self._proc: Optional[subprocess.Popen] = None
        self._raw = None

    def open(self) -> None:
        cmd = [
            CLAUDE_PATH, "-p",
            "--input-format", "stream-json",
            "--output-format", "stream-json", "--verbose",
            "--model", self.model_id,
            "--permission-mode", "acceptEdits",
            "--mcp-config", '{"mcpServers":{}}', "--strict-mcp-config",
        ]
        cmd += _system_prompt_args(self.request)
        if SETTING_SOURCES != "*":
            cmd += ["--setting-sources", SETTING_SOURCES]
        effort = _THINKING_EFFORT.get(self.request.thinking)
        if effort:
            cmd += ["--effort", effort]
        allowed = _allowed_tools(self.request.tools)
        if allowed:
            # --allowedTools pre-approves (no permission prompt); --tools drops
            # the schemas of every builtin NOT listed — that is the real
            # token-bloat cut. An agent with tools: null keeps the full set.
            cmd += ["--allowedTools", ",".join(allowed)]
            cmd += ["--tools", ",".join(allowed)]
        if self.request.resume_session_id:
            cmd += ["--resume", self.request.resume_session_id]
        cmd += EXTRA_ARGS

        if os.environ.get("SSSF_CLAUDE_DEBUG"):
            log.warning("agent_cc cmd: %s", " ".join(
                a if len(a) < 120 else a[:117] + "..." for a in cmd))

        raw_path = Path(self.request.raw_output_path)
        raw_path.parent.mkdir(parents=True, exist_ok=True)
        self._raw = raw_path.open("a")

        self._proc = subprocess.Popen(
            cmd, stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, bufsize=1, cwd=self.request.cwd,
            env=_auth_env(self.request.claude_code_auth))
        if self.on_spawn:
            self.on_spawn(self._proc.pid)

    def send(self, prompt: str) -> AgentResult:
        """Write one user turn, stream events until that turn's `result`."""
        proc = self._proc
        assert proc is not None and proc.stdin is not None
        try:
            proc.stdin.write(_user_line(prompt))
            proc.stdin.flush()
        except (BrokenPipeError, ValueError):
            err = proc.stderr.read() if proc.stderr else ""
            self.returncode = proc.poll() or 1
            raise RuntimeError(f"claude stdin closed early (rc={self.returncode}): "
                               f"{err.strip()[-800:]}")

        result = AgentResult(session_id=self.session_id,
                             context_window=self.ctx_window)
        prices = _PRICES.get(self.model_id)
        subtype: Optional[str] = None
        rate_blocked = False
        rate_reset: Optional[int] = None
        saw_result = False

        for line in self._lines_until_result(proc):
            self._raw.write(line if line.endswith("\n") else line + "\n")
            self._raw.flush()
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            etype = event.get("type")

            if etype == "system" and event.get("subtype") == "init":
                self.session_id = event.get("session_id") or self.session_id
                result.session_id = self.session_id
                src = event.get("apiKeySource")
                if self.request.claude_code_auth == "subscription" and src not in (None, "none"):
                    log.warning("agent_cc: claude_code_auth=subscription but "
                                "apiKeySource=%r — check for a leaked key/helper", src)

            elif etype == "assistant":
                msg = event.get("message", {}) or {}
                for block in msg.get("content") or []:
                    if isinstance(block, dict) and block.get("type") == "text" and block.get("text"):
                        result.text = block["text"]          # last assistant text wins
                usage = msg.get("usage") or {}
                if usage:
                    result.usage.add_claude_turn(usage, prices)
                    occ = ((usage.get("input_tokens") or 0)
                           + (usage.get("cache_read_input_tokens") or 0)
                           + (usage.get("cache_creation_input_tokens") or 0))
                    if occ:
                        result.context_tokens = occ           # window occupancy, last turn

            elif etype == "rate_limit_event":
                info = event.get("rate_limit_info") or {}
                if info.get("status") and info["status"] != "allowed":
                    rate_blocked = True
                    windows = info.get("unifiedWindows") or {}
                    rate_reset = (windows.get(info.get("rateLimitType") or "") or {}).get("resetsAt")

            elif etype == "result":
                saw_result = True
                self.session_id = event.get("session_id") or self.session_id
                result.session_id = self.session_id
                result.cost = float(event.get("total_cost_usd") or 0.0)
                subtype = event.get("subtype")
                mu = (event.get("modelUsage") or {}).get(self.model_id) or {}
                if mu.get("contextWindow"):
                    result.context_window = int(mu["contextWindow"])
                agg = event.get("usage") or {}
                result.tokens = ((agg.get("input_tokens") or 0)
                                 + (agg.get("output_tokens") or 0)
                                 + (agg.get("cache_read_input_tokens") or 0)
                                 + (agg.get("cache_creation_input_tokens") or 0))
                if event.get("is_error") and event.get("api_error_status") == 429:
                    rate_blocked = True

            if self.on_event:
                self.on_event(event)

        if rate_blocked:
            raise RateLimited(
                f"claude plan window exhausted for {self.request.model} "
                f"(resets_at epoch {rate_reset}); rerun after it resets or switch "
                f"that agent to claude_code_auth: api_key", resets_at=rate_reset)
        if not saw_result:
            err = proc.stderr.read() if proc.stderr else ""
            self.returncode = proc.poll() or 1
            raise RuntimeError(f"claude ended mid-turn (rc={self.returncode}): "
                               f"{err.strip()[-800:]}")
        if subtype and subtype != "success" and not result.text:
            raise RuntimeError(f"claude ended subtype={subtype!r}")
        return result

    def close(self) -> int:
        proc = self._proc
        if proc is None:
            return self.returncode
        try:
            if proc.stdin and not proc.stdin.closed:
                proc.stdin.close()
        except (BrokenPipeError, ValueError):
            pass
        try:
            self.returncode = proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            proc.kill()
            self.returncode = proc.wait()
        if self._raw:
            self._raw.close()
            self._raw = None
        if self.on_exit:
            self.on_exit(proc.pid)
        return self.returncode

    def _lines_until_result(self, proc: subprocess.Popen):
        """Yield stdout lines up to and including this turn's `result` event.
        A no-output stall past READ_TIMEOUT kills the child (watchdog)."""
        stdout = proc.stdout
        assert stdout is not None
        while True:
            if READ_TIMEOUT > 0:
                ready, _, _ = select.select([stdout], [], [], READ_TIMEOUT)
                if not ready:
                    proc.kill()
                    self.returncode = proc.wait()
                    raise RuntimeError(
                        f"claude produced no output for {READ_TIMEOUT:.0f}s — killed")
            line = stdout.readline()
            if not line:
                return
            yield line
            try:
                if json.loads(line.strip()).get("type") == "result":
                    return
            except (json.JSONDecodeError, AttributeError):
                continue


# ── run (one-shot: open + one send + close) ──────────────────────────────────

def run(request: AgentRequest,
        on_event: Optional[Callable[[dict], None]] = None,
        on_spawn: Optional[Callable[[int], None]] = None,
        on_exit: Optional[Callable[[int], None]] = None) -> AgentResult:
    """One non-interactive `claude` turn. agents.execute() uses `Session`
    directly so a phase's retries share one process; this stays for single
    callers and keeps the agent_pi.run() signature."""
    session = Session(request, on_event=on_event, on_spawn=on_spawn, on_exit=on_exit)
    session.open()
    try:
        result = session.send(request.prompt)
    finally:
        rc = session.close()
    result.returncode = rc
    if rc != 0 and not result.text:
        raise RuntimeError(f"claude exited {rc}")
    return result
