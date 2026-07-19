#!/usr/bin/env python3
"""Run durable, unattended Pi policy benchmarks over the RPC protocol."""

from __future__ import annotations

import argparse
import concurrent.futures
import contextlib
import copy
import datetime as dt
import fcntl
import hashlib
import json
import os
import queue
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import (
    Any,
    BinaryIO,
    Dict,
    Iterable,
    List,
    Mapping,
    MutableMapping,
    Optional,
    Sequence,
    Set,
    Tuple,
)


SCHEMA_VERSION = 1
TERMINAL_STATES = {
    "passed",
    "failed",
    "timed_out",
    "process_error",
    "unresolved_question",
}
RETRYABLE_STATES = {"failed", "timed_out", "process_error"}
INTERRUPTED_STATE = "interrupted"
RUN_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
QUESTION_PATTERN = re.compile(
    r"(?:\?|\b(?:choose|clarify|provide|specify|which|what)\b)", re.IGNORECASE
)


class BenchmarkError(RuntimeError):
    """Raised for invalid manifests or benchmark infrastructure failures."""


@dataclass(frozen=True)
class RunOutcome:
    """Terminal outcome for one manifest run."""

    status: str
    attempt: int
    error: Optional[str]
    final_text: str
    question_count: int
    validator_results: List[Dict[str, Any]]


def utc_now() -> str:
    """Return a stable UTC timestamp for state and event records."""

    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def expand_path(value: str, base: Path) -> Path:
    """Expand a manifest path relative to its containing directory."""

    expanded = Path(os.path.expandvars(os.path.expanduser(value)))
    if not expanded.is_absolute():
        expanded = base / expanded
    return expanded.resolve(strict=False)


def atomic_write_json(path: Path, value: Mapping[str, Any]) -> None:
    """Atomically replace a UTF-8 JSON state file and fsync its directory."""

    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(
        f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp"
    )
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, sort_keys=True)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    directory_fd = os.open(str(path.parent), os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def append_jsonl(path: Path, value: Mapping[str, Any], lock: threading.Lock) -> None:
    """Append one durable event record without interleaving worker writes."""

    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(value, sort_keys=True, ensure_ascii=False) + "\n"
    with lock:
        with path.open("a", encoding="utf-8") as stream:
            stream.write(line)
            stream.flush()
            os.fsync(stream.fileno())


def bounded_text(data: bytes, limit: int = 200_000) -> str:
    """Decode bounded subprocess output while retaining a truncation marker."""

    if len(data) <= limit:
        return data.decode("utf-8", errors="replace")
    return (
        data[:limit].decode("utf-8", errors="replace")
        + f"\n[truncated at {limit} bytes]\n"
    )


def message_text(message: Mapping[str, Any]) -> str:
    """Extract visible text blocks from an RPC assistant message."""

    blocks = message.get("content")
    if isinstance(blocks, str):
        return blocks
    if not isinstance(blocks, list):
        return ""
    return "\n".join(
        block.get("text", "")
        for block in blocks
        if isinstance(block, dict) and block.get("type") == "text"
    ).strip()


def looks_like_question(text: str) -> bool:
    """Conservatively identify final responses that still require an answer."""

    return bool(text.strip() and QUESTION_PATTERN.search(text))


class StateStore:
    """Thread-safe durable state and event journal for one benchmark job."""

    def __init__(self, root: Path, state: MutableMapping[str, Any]) -> None:
        self.root = root
        self.state = state
        self._lock = threading.Lock()
        self._event_lock = threading.Lock()

    @property
    def state_path(self) -> Path:
        return self.root / "state.json"

    def save(self) -> None:
        with self._lock:
            atomic_write_json(self.state_path, self.state)

    def update_run(self, run_id: str, **changes: Any) -> Dict[str, Any]:
        with self._lock:
            record = self.state["runs"][run_id]
            record.update(changes)
            record["updated_at"] = utc_now()
            atomic_write_json(self.state_path, self.state)
            return copy.deepcopy(record)

    def run_record(self, run_id: str) -> Dict[str, Any]:
        with self._lock:
            return copy.deepcopy(self.state["runs"][run_id])

    def event(self, event: str, **fields: Any) -> None:
        append_jsonl(
            self.root / "events.jsonl",
            {"timestamp": utc_now(), "event": event, **fields},
            self._event_lock,
        )


class JobLock:
    """Prevent two controllers from mutating the same benchmark job."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._stream: Optional[Any] = None

    def __enter__(self) -> "JobLock":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._stream = self.path.open("a+", encoding="utf-8")
        try:
            fcntl.flock(self._stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            self._stream.close()
            raise BenchmarkError(
                f"benchmark is already running: {self.path.parent}"
            ) from exc
        self._stream.seek(0)
        self._stream.truncate()
        self._stream.write(f"pid={os.getpid()} started={utc_now()}\n")
        self._stream.flush()
        return self

    def __exit__(self, _exc_type: Any, _exc: Any, _tb: Any) -> None:
        if self._stream is not None:
            fcntl.flock(self._stream.fileno(), fcntl.LOCK_UN)
            self._stream.close()


class RpcChild:
    """One Pi RPC subprocess with strict LF JSONL framing and bounded cleanup."""

    def __init__(
        self,
        command: Sequence[str],
        cwd: Path,
        env: Mapping[str, str],
        stderr_path: Path,
        rpc_path: Path,
    ) -> None:
        self._stderr_stream = stderr_path.open("wb")
        self._rpc_stream = rpc_path.open("wb")
        self._queue: "queue.Queue[Tuple[str, Any]]" = queue.Queue()
        self._write_lock = threading.Lock()
        self.process = subprocess.Popen(
            list(command),
            cwd=str(cwd),
            env=dict(env),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
        assert self.process.stdout is not None
        assert self.process.stderr is not None
        self._stdout_thread = threading.Thread(
            target=self._read_stdout,
            args=(self.process.stdout,),
            name="pi-rpc-stdout",
            daemon=True,
        )
        self._stderr_thread = threading.Thread(
            target=self._copy_stderr,
            args=(self.process.stderr,),
            name="pi-rpc-stderr",
            daemon=True,
        )
        self._stdout_thread.start()
        self._stderr_thread.start()

    def _read_stdout(self, stream: BinaryIO) -> None:
        buffer = b""
        try:
            while True:
                chunk = os.read(stream.fileno(), 4096)
                if not chunk:
                    break
                buffer += chunk
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    if line.endswith(b"\r"):
                        line = line[:-1]
                    self._rpc_stream.write(line + b"\n")
                    self._rpc_stream.flush()
                    if not line:
                        continue
                    try:
                        self._queue.put(("event", json.loads(line.decode("utf-8"))))
                    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                        self._queue.put(("protocol_error", f"{exc}: {line[:500]!r}"))
            if buffer:
                self._queue.put(("protocol_error", "unterminated final RPC record"))
        finally:
            self._queue.put(("eof", self.process.poll()))

    def _copy_stderr(self, stream: BinaryIO) -> None:
        while True:
            chunk = os.read(stream.fileno(), 4096)
            if not chunk:
                break
            self._stderr_stream.write(chunk)
            self._stderr_stream.flush()

    def send(self, payload: Mapping[str, Any]) -> None:
        data = (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")
        with self._write_lock:
            if self.process.stdin is None or self.process.poll() is not None:
                raise BenchmarkError("Pi RPC process is not writable")
            self.process.stdin.write(data)
            self.process.stdin.flush()

    def next(self, timeout: float) -> Tuple[str, Any]:
        return self._queue.get(timeout=max(timeout, 0.001))

    def close(self, grace_seconds: float = 3.0) -> None:
        if self.process.stdin is not None:
            with contextlib.suppress(BrokenPipeError, OSError):
                self.process.stdin.close()
        if self.process.poll() is None:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(self.process.pid, signal.SIGTERM)
            try:
                self.process.wait(timeout=grace_seconds)
            except subprocess.TimeoutExpired:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(self.process.pid, signal.SIGKILL)
                self.process.wait(timeout=grace_seconds)
        self._stdout_thread.join(timeout=1)
        self._stderr_thread.join(timeout=1)
        if self.process.stdout is not None:
            self.process.stdout.close()
        if self.process.stderr is not None:
            self.process.stderr.close()
        self._rpc_stream.close()
        self._stderr_stream.close()


def load_manifest(path: Path) -> Tuple[Dict[str, Any], str]:
    """Load and validate the stable subset of the JSON manifest schema."""

    raw = path.read_bytes()
    try:
        manifest = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BenchmarkError(f"invalid JSON manifest {path}: {exc}") from exc
    if not isinstance(manifest, dict):
        raise BenchmarkError("manifest root must be an object")
    if not isinstance(manifest.get("id"), str) or not RUN_ID_PATTERN.fullmatch(
        manifest["id"]
    ):
        raise BenchmarkError("manifest id must be a safe 1-128 character identifier")
    if not isinstance(manifest.get("output_dir"), str):
        raise BenchmarkError("manifest output_dir must be a string")
    runs = manifest.get("runs")
    if not isinstance(runs, list) or not runs:
        raise BenchmarkError("manifest runs must be a non-empty array")
    seen: Set[str] = set()
    for run in runs:
        if not isinstance(run, dict):
            raise BenchmarkError("every run must be an object")
        run_id = run.get("id")
        if not isinstance(run_id, str) or not RUN_ID_PATTERN.fullmatch(run_id):
            raise BenchmarkError(f"invalid run id: {run_id!r}")
        if run_id in seen:
            raise BenchmarkError(f"duplicate run id: {run_id}")
        seen.add(run_id)
        for field in ("template", "model", "thinking", "prompt"):
            if not isinstance(run.get(field), str) or not run[field]:
                raise BenchmarkError(
                    f"run {run_id}: {field} must be a non-empty string"
                )
    canonical = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )
    return manifest, hashlib.sha256(canonical).hexdigest()


def manifest_defaults(manifest: Mapping[str, Any]) -> Dict[str, Any]:
    defaults = dict(manifest.get("defaults") or {})
    defaults.setdefault("max_parallel", 1)
    defaults.setdefault("max_retries", 1)
    defaults.setdefault("startup_timeout_seconds", 45)
    defaults.setdefault("run_timeout_seconds", 600)
    defaults.setdefault("validator_timeout_seconds", 120)
    defaults.setdefault("max_question_rounds", 3)
    defaults.setdefault("unknown_question_policy", "cancel_and_record")
    defaults.setdefault("pi_command", ["pi"])
    defaults.setdefault("notify", True)
    return defaults


def resolve_run(
    run: Mapping[str, Any], defaults: Mapping[str, Any], manifest_dir: Path
) -> Dict[str, Any]:
    resolved = dict(defaults)
    resolved.update(run)
    resolved["template"] = str(expand_path(str(run["template"]), manifest_dir))
    if run.get("agent_dir"):
        resolved["agent_dir"] = str(expand_path(str(run["agent_dir"]), manifest_dir))
    command = resolved.get("pi_command")
    if (
        not isinstance(command, list)
        or not command
        or not all(isinstance(item, str) and item for item in command)
    ):
        raise BenchmarkError(
            f"run {run['id']}: pi_command must be a non-empty string array"
        )
    if resolved.get("unknown_question_policy") not in {
        "cancel_and_record",
        "first_option",
    }:
        raise BenchmarkError(f"run {run['id']}: unsupported unknown_question_policy")
    return resolved


def select_rule(
    rules: Iterable[Mapping[str, Any]], method: str, context: str
) -> Optional[Mapping[str, Any]]:
    for rule in rules:
        expected_method = rule.get("method", "*")
        pattern = rule.get("match")
        if expected_method not in {"*", method} or not isinstance(pattern, str):
            continue
        try:
            if re.search(pattern, context, re.IGNORECASE | re.DOTALL):
                return rule
        except re.error as exc:
            raise BenchmarkError(
                f"invalid question rule regex {pattern!r}: {exc}"
            ) from exc
    return None


def extension_ui_response(
    request: Mapping[str, Any],
    policy: Mapping[str, Any],
) -> Tuple[Dict[str, Any], bool, str]:
    """Return an RPC response, whether fallback was unresolved, and decision text."""

    request_id = request.get("id")
    method = str(request.get("method", ""))
    options = request.get("options") if isinstance(request.get("options"), list) else []
    context = "\n".join(
        str(value)
        for value in (
            request.get("title"),
            request.get("message"),
            "\n".join(map(str, options)),
        )
        if value
    )
    rule = select_rule(policy.get("rules") or [], method, context)
    unresolved = False

    if method == "select":
        value: Optional[str] = None
        if rule is not None:
            if isinstance(rule.get("value"), str) and rule["value"] in options:
                value = str(rule["value"])
            elif isinstance(rule.get("value_match"), str):
                value = next(
                    (
                        str(option)
                        for option in options
                        if re.search(
                            str(rule["value_match"]), str(option), re.IGNORECASE
                        )
                    ),
                    None,
                )
        if (
            value is None
            and policy.get("unknown", "cancel_and_record") == "first_option"
            and options
        ):
            value = str(options[0])
        if value is None:
            unresolved = True
            return (
                {"type": "extension_ui_response", "id": request_id, "cancelled": True},
                unresolved,
                "cancelled",
            )
        return (
            {"type": "extension_ui_response", "id": request_id, "value": value},
            unresolved,
            value,
        )

    if method == "confirm":
        if (
            rule is None
            and policy.get("unknown", "cancel_and_record") == "cancel_and_record"
        ):
            unresolved = True
        confirmed = bool(rule.get("confirmed")) if rule is not None else False
        return (
            {"type": "extension_ui_response", "id": request_id, "confirmed": confirmed},
            unresolved,
            str(confirmed),
        )

    if method in {"input", "editor"}:
        if rule is not None and isinstance(rule.get("value"), str):
            value = str(rule["value"])
            return (
                {"type": "extension_ui_response", "id": request_id, "value": value},
                False,
                value,
            )
        return (
            {"type": "extension_ui_response", "id": request_id, "cancelled": True},
            True,
            "cancelled",
        )

    return {}, False, "ignored"


def plain_followup(
    text: str, rules: Sequence[Mapping[str, Any]], used: Set[int]
) -> Optional[Tuple[int, str]]:
    for index, rule in enumerate(rules):
        if (
            index in used
            or not isinstance(rule.get("match"), str)
            or not isinstance(rule.get("response"), str)
        ):
            continue
        try:
            if re.search(str(rule["match"]), text, re.IGNORECASE | re.DOTALL):
                return index, str(rule["response"])
        except re.error as exc:
            raise BenchmarkError(
                f"invalid plain follow-up regex {rule['match']!r}: {exc}"
            ) from exc
    return None


def prepare_workspace(template: Path, attempt_dir: Path) -> Path:
    if not template.is_dir():
        raise BenchmarkError(f"template directory does not exist: {template}")
    workspace = attempt_dir / "workspace"
    if workspace.exists():
        shutil.rmtree(workspace)
    shutil.copytree(template, workspace, symlinks=False)
    return workspace


def run_validators(
    validators: Sequence[Mapping[str, Any]],
    workspace: Path,
    attempt_dir: Path,
    default_timeout: float,
) -> Tuple[bool, List[Dict[str, Any]]]:
    results: List[Dict[str, Any]] = []
    all_passed = True
    for index, validator in enumerate(validators):
        kind = validator.get("type", "command")
        result: Dict[str, Any] = {"index": index, "type": kind}
        if kind == "command":
            command = validator.get("command")
            if (
                not isinstance(command, list)
                or not command
                or not all(isinstance(item, str) for item in command)
            ):
                raise BenchmarkError(
                    "command validator requires a non-empty string array"
                )
            timeout = float(validator.get("timeout_seconds", default_timeout))
            expected = int(validator.get("expected_exit", 0))
            try:
                completed = subprocess.run(
                    command,
                    cwd=str(workspace),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=timeout,
                    check=False,
                )
                result.update(
                    command=command,
                    exit_code=completed.returncode,
                    expected_exit=expected,
                    stdout=bounded_text(completed.stdout),
                    stderr=bounded_text(completed.stderr),
                    passed=completed.returncode == expected,
                )
            except subprocess.TimeoutExpired as exc:
                result.update(
                    command=command,
                    passed=False,
                    error=f"validator timed out after {timeout}s",
                    stdout=bounded_text(exc.stdout or b""),
                    stderr=bounded_text(exc.stderr or b""),
                )
        elif kind in {"file_contains", "file_not_contains"}:
            relative = Path(str(validator.get("path", "")))
            candidate = (workspace / relative).resolve(strict=False)
            if not candidate.is_relative_to(workspace.resolve()):
                raise BenchmarkError(f"validator path escapes workspace: {relative}")
            needle = str(validator.get("text", ""))
            content = (
                candidate.read_text(encoding="utf-8") if candidate.is_file() else ""
            )
            contains = needle in content
            passed = contains if kind == "file_contains" else not contains
            result.update(path=str(relative), text=needle, passed=passed)
        elif kind == "changed_files":
            expected_files = sorted(map(str, validator.get("expected") or []))
            completed = subprocess.run(
                ["git", "status", "--short"],
                cwd=str(workspace),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            changed = sorted(
                line[3:].strip()
                for line in completed.stdout.decode(
                    "utf-8", errors="replace"
                ).splitlines()
                if len(line) >= 4 and not line[3:].strip().startswith(".codegraph/")
            )
            result.update(
                expected=expected_files,
                actual=changed,
                passed=completed.returncode == 0 and changed == expected_files,
            )
        else:
            raise BenchmarkError(f"unsupported validator type: {kind}")
        all_passed = all_passed and bool(result.get("passed"))
        results.append(result)
    atomic_write_json(
        attempt_dir / "validators.json", {"passed": all_passed, "results": results}
    )
    return all_passed, results


def notify(title: str, body: str, enabled: bool) -> None:
    if not enabled or shutil.which("herdr") is None:
        return
    with contextlib.suppress(OSError, subprocess.SubprocessError):
        subprocess.run(
            ["herdr", "notification", "show", title, "--body", body, "--sound", "done"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=False,
        )


def execute_attempt(
    run: Mapping[str, Any],
    attempt: int,
    job_root: Path,
    stop_event: threading.Event,
    store: StateStore,
) -> RunOutcome:
    run_id = str(run["id"])
    attempt_dir = job_root / "runs" / run_id / f"attempt-{attempt}"
    attempt_dir.mkdir(parents=True, exist_ok=True)
    workspace = prepare_workspace(Path(str(run["template"])), attempt_dir)
    session_dir = attempt_dir / "sessions"
    session_dir.mkdir()
    question_path = attempt_dir / "questions.jsonl"
    question_lock = threading.Lock()

    command = list(run["pi_command"]) + [
        "--mode",
        "rpc",
        "--model",
        str(run["model"]),
        "--thinking",
        str(run["thinking"]),
        "--session-dir",
        str(session_dir),
        "--name",
        f"benchmark:{run_id}:attempt-{attempt}",
    ]
    environment = dict(os.environ)
    if run.get("agent_dir"):
        environment["PI_CODING_AGENT_DIR"] = str(run["agent_dir"])
    for key, value in (run.get("env") or {}).items():
        if not isinstance(key, str) or not isinstance(value, str):
            raise BenchmarkError(f"run {run_id}: env must map strings to strings")
        environment[key] = value

    started = time.monotonic()
    deadline = started + float(run["run_timeout_seconds"])
    startup_deadline = started + float(run["startup_timeout_seconds"])
    question_policy = dict(run.get("question_policy") or {})
    question_policy.setdefault(
        "unknown", run.get("unknown_question_policy", "cancel_and_record")
    )
    plain_rules = list(question_policy.get("plain_followups") or [])
    used_plain_rules: Set[int] = set()
    used_plain_fallback = False
    question_count = 0
    unresolved = False
    final_text = ""
    child: Optional[RpcChild] = None

    try:
        child = RpcChild(
            command,
            workspace,
            environment,
            attempt_dir / "stderr.log",
            attempt_dir / "rpc.jsonl",
        )
        child.send({"id": "startup", "type": "get_state"})
        while True:
            if stop_event.is_set():
                return RunOutcome(
                    INTERRUPTED_STATE,
                    attempt,
                    "benchmark controller stopping",
                    final_text,
                    question_count,
                    [],
                )
            if time.monotonic() >= startup_deadline:
                return RunOutcome(
                    "timed_out",
                    attempt,
                    "RPC startup timeout",
                    final_text,
                    question_count,
                    [],
                )
            try:
                kind, payload = child.next(
                    min(0.5, startup_deadline - time.monotonic())
                )
            except queue.Empty:
                continue
            if kind == "protocol_error":
                return RunOutcome(
                    "process_error",
                    attempt,
                    str(payload),
                    final_text,
                    question_count,
                    [],
                )
            if kind == "eof":
                return RunOutcome(
                    "process_error",
                    attempt,
                    f"Pi exited during startup: {payload}",
                    final_text,
                    question_count,
                    [],
                )
            if payload.get("type") == "response" and payload.get("id") == "startup":
                if not payload.get("success"):
                    return RunOutcome(
                        "process_error",
                        attempt,
                        str(payload.get("error")),
                        final_text,
                        question_count,
                        [],
                    )
                break

        child.send(
            {"id": "initial-prompt", "type": "prompt", "message": str(run["prompt"])}
        )
        while True:
            if stop_event.is_set():
                return RunOutcome(
                    INTERRUPTED_STATE,
                    attempt,
                    "benchmark controller stopping",
                    final_text,
                    question_count,
                    [],
                )
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return RunOutcome(
                    "timed_out",
                    attempt,
                    "run deadline exceeded",
                    final_text,
                    question_count,
                    [],
                )
            try:
                kind, payload = child.next(min(0.5, remaining))
            except queue.Empty:
                if child.process.poll() is not None:
                    return RunOutcome(
                        "process_error",
                        attempt,
                        f"Pi exited with {child.process.returncode}",
                        final_text,
                        question_count,
                        [],
                    )
                continue
            if kind == "protocol_error":
                return RunOutcome(
                    "process_error",
                    attempt,
                    str(payload),
                    final_text,
                    question_count,
                    [],
                )
            if kind == "eof":
                return RunOutcome(
                    "process_error",
                    attempt,
                    f"Pi exited before settling: {payload}",
                    final_text,
                    question_count,
                    [],
                )

            event_type = payload.get("type")
            if event_type == "extension_ui_request":
                method = payload.get("method")
                if method not in {"select", "confirm", "input", "editor"}:
                    continue
                question_count += 1
                response, unknown, decision = extension_ui_response(
                    payload, question_policy
                )
                unresolved = unresolved or unknown
                append_jsonl(
                    question_path,
                    {
                        "timestamp": utc_now(),
                        "kind": "extension_ui",
                        "request": payload,
                        "response": response,
                        "decision": decision,
                        "unresolved": unknown,
                    },
                    question_lock,
                )
                if question_count > int(run["max_question_rounds"]):
                    child.send({"type": "abort"})
                    return RunOutcome(
                        "unresolved_question",
                        attempt,
                        "question budget exceeded",
                        final_text,
                        question_count,
                        [],
                    )
                if response:
                    child.send(response)
                continue

            if event_type == "message_end":
                message = payload.get("message")
                if isinstance(message, dict) and message.get("role") == "assistant":
                    text = message_text(message)
                    if text:
                        final_text = text
                continue

            if event_type == "agent_settled":
                match = plain_followup(final_text, plain_rules, used_plain_rules)
                if match is not None and question_count < int(
                    run["max_question_rounds"]
                ):
                    index, response_text = match
                    used_plain_rules.add(index)
                    question_count += 1
                    append_jsonl(
                        question_path,
                        {
                            "timestamp": utc_now(),
                            "kind": "plain_text",
                            "question": final_text,
                            "response": response_text,
                            "rule_index": index,
                        },
                        question_lock,
                    )
                    final_text = ""
                    child.send({"type": "prompt", "message": response_text})
                    continue
                fallback = question_policy.get("plain_unknown_response")
                if (
                    looks_like_question(final_text)
                    and isinstance(fallback, str)
                    and fallback
                    and not used_plain_fallback
                    and question_count < int(run["max_question_rounds"])
                ):
                    used_plain_fallback = True
                    question_count += 1
                    append_jsonl(
                        question_path,
                        {
                            "timestamp": utc_now(),
                            "kind": "plain_text_fallback",
                            "question": final_text,
                            "response": fallback,
                        },
                        question_lock,
                    )
                    final_text = ""
                    child.send({"type": "prompt", "message": fallback})
                    continue
                if looks_like_question(final_text):
                    question_count += 1
                    unresolved = True
                    append_jsonl(
                        question_path,
                        {
                            "timestamp": utc_now(),
                            "kind": "plain_text",
                            "question": final_text,
                            "response": None,
                            "unresolved": True,
                        },
                        question_lock,
                    )
                break

        validators_ok, validator_results = run_validators(
            run.get("validators") or [],
            workspace,
            attempt_dir,
            float(run["validator_timeout_seconds"]),
        )
        atomic_write_json(
            attempt_dir / "result.json",
            {
                "run_id": run_id,
                "attempt": attempt,
                "model": run["model"],
                "thinking": run["thinking"],
                "question_count": question_count,
                "unresolved_question": unresolved,
                "validators_passed": validators_ok,
                "final_text": final_text,
                "finished_at": utc_now(),
                "active_seconds": round(time.monotonic() - started, 3),
            },
        )
        if unresolved:
            return RunOutcome(
                "unresolved_question",
                attempt,
                None,
                final_text,
                question_count,
                validator_results,
            )
        if not validators_ok:
            return RunOutcome(
                "failed",
                attempt,
                "validator failure",
                final_text,
                question_count,
                validator_results,
            )
        return RunOutcome(
            "passed", attempt, None, final_text, question_count, validator_results
        )
    except BenchmarkError as exc:
        return RunOutcome(
            "process_error", attempt, str(exc), final_text, question_count, []
        )
    except (
        Exception
    ) as exc:  # process boundary: preserve the run and continue the suite
        return RunOutcome(
            "process_error",
            attempt,
            f"{type(exc).__name__}: {exc}",
            final_text,
            question_count,
            [],
        )
    finally:
        if child is not None:
            child.close()
        store.event(
            "attempt_finished",
            run_id=run_id,
            attempt=attempt,
            elapsed_seconds=round(time.monotonic() - started, 3),
        )


def execute_run(
    run: Mapping[str, Any],
    job_root: Path,
    stop_event: threading.Event,
    store: StateStore,
) -> RunOutcome:
    run_id = str(run["id"])
    while True:
        record = store.run_record(run_id)
        attempt = int(record.get("attempts", 0)) + 1
        store.update_run(
            run_id, status="running", attempts=attempt, error=None, started_at=utc_now()
        )
        store.event("attempt_started", run_id=run_id, attempt=attempt)
        outcome = execute_attempt(run, attempt, job_root, stop_event, store)
        store.update_run(
            run_id,
            status=outcome.status,
            error=outcome.error,
            final_text=outcome.final_text,
            question_count=outcome.question_count,
            finished_at=utc_now(),
        )
        store.event(
            "run_outcome",
            run_id=run_id,
            attempt=attempt,
            status=outcome.status,
            error=outcome.error,
        )
        if outcome.status == INTERRUPTED_STATE or stop_event.is_set():
            interruptions = int(record.get("interruptions", 0)) + 1
            store.update_run(
                run_id,
                status="pending",
                interruptions=interruptions,
                error="interrupted; safe to resume",
            )
            store.event("run_interrupted", run_id=run_id, attempt=attempt)
            return outcome
        if outcome.status not in RETRYABLE_STATES:
            return outcome
        failures = int(record.get("failures", 0)) + 1
        store.update_run(run_id, failures=failures)
        if failures > int(run["max_retries"]):
            return outcome
        store.update_run(run_id, status="pending")
        store.event("retry_scheduled", run_id=run_id, next_attempt=attempt + 1)


def initial_state(manifest: Mapping[str, Any], digest: str) -> Dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "benchmark_id": manifest["id"],
        "manifest_sha256": digest,
        "created_at": utc_now(),
        "updated_at": utc_now(),
        "runs": {
            run["id"]: {
                "status": "pending",
                "attempts": 0,
                "failures": 0,
                "interruptions": 0,
                "error": None,
                "updated_at": utc_now(),
            }
            for run in manifest["runs"]
        },
    }


def load_or_create_state(
    job_root: Path, manifest: Mapping[str, Any], digest: str
) -> Dict[str, Any]:
    state_path = job_root / "state.json"
    if not state_path.exists():
        state = initial_state(manifest, digest)
        atomic_write_json(state_path, state)
        atomic_write_json(job_root / "manifest.json", manifest)
        return state
    state = json.loads(state_path.read_text(encoding="utf-8"))
    if state.get("schema_version") != SCHEMA_VERSION:
        raise BenchmarkError("unsupported state schema version")
    if state.get("manifest_sha256") != digest:
        raise BenchmarkError("manifest changed since this job was created")
    for record in state["runs"].values():
        if record.get("status") == "running":
            record["status"] = "pending"
            record["error"] = "recovered after interrupted controller"
            record["interruptions"] = int(record.get("interruptions", 0)) + 1
    atomic_write_json(state_path, state)
    return state


def summarize_state(state: Mapping[str, Any]) -> Dict[str, Any]:
    counts: Dict[str, int] = {}
    attempts = 0
    failures = 0
    interruptions = 0
    questions = 0
    for record in state["runs"].values():
        status = str(record.get("status", "unknown"))
        counts[status] = counts.get(status, 0) + 1
        attempts += int(record.get("attempts", 0))
        failures += int(record.get("failures", 0))
        interruptions += int(record.get("interruptions", 0))
        questions += int(record.get("question_count", 0))
    return {
        "benchmark_id": state["benchmark_id"],
        "total_runs": len(state["runs"]),
        "counts": counts,
        "attempts": attempts,
        "failures": failures,
        "interruptions": interruptions,
        "questions": questions,
        "complete": all(
            record.get("status") in TERMINAL_STATES for record in state["runs"].values()
        ),
    }


def run_benchmark(manifest_path: Path) -> int:
    manifest_path = manifest_path.resolve(strict=True)
    manifest, digest = load_manifest(manifest_path)
    defaults = manifest_defaults(manifest)
    job_root = expand_path(str(manifest["output_dir"]), manifest_path.parent)
    job_root.mkdir(parents=True, exist_ok=True)
    notify_enabled = bool(defaults["notify"])

    with JobLock(job_root / ".controller.lock"):
        state = load_or_create_state(job_root, manifest, digest)
        store = StateStore(job_root, state)
        runs = {
            run["id"]: resolve_run(run, defaults, manifest_path.parent)
            for run in manifest["runs"]
        }
        stop_event = threading.Event()

        def stop(_signum: int, _frame: Any) -> None:
            stop_event.set()
            store.event("controller_stop_requested")

        previous_sigint = signal.signal(signal.SIGINT, stop)
        previous_sigterm = signal.signal(signal.SIGTERM, stop)
        try:
            pending = []
            for run_id, run in runs.items():
                record = store.run_record(run_id)
                status = record.get("status")
                maximum_attempts = 1 + int(run["max_retries"])
                if status == "passed" or status == "unresolved_question":
                    continue
                if (
                    status in RETRYABLE_STATES
                    and int(record.get("failures", 0)) >= maximum_attempts
                ):
                    continue
                pending.append(run)

            store.event("controller_started", pending_runs=len(pending))
            notify(
                "Agent-policy benchmark started",
                f"{manifest['id']}: {len(pending)} pending runs",
                notify_enabled,
            )
            max_parallel = max(1, int(defaults["max_parallel"]))
            with concurrent.futures.ThreadPoolExecutor(
                max_workers=max_parallel
            ) as executor:
                future_map = {
                    executor.submit(execute_run, run, job_root, stop_event, store): run[
                        "id"
                    ]
                    for run in pending
                }
                for future in concurrent.futures.as_completed(future_map):
                    run_id = future_map[future]
                    try:
                        future.result()
                    except Exception as exc:  # defensive worker boundary
                        store.update_run(
                            run_id,
                            status="process_error",
                            error=f"worker crashed: {exc}",
                        )
                        store.event("worker_crashed", run_id=run_id, error=str(exc))
            summary = summarize_state(store.state)
            atomic_write_json(job_root / "summary.json", summary)
            store.event("controller_finished", summary=summary)
            if summary["complete"]:
                notify(
                    "Agent-policy benchmark complete",
                    f"{manifest['id']}: {summary['counts']}",
                    notify_enabled,
                )
            else:
                notify(
                    "Agent-policy benchmark paused",
                    f"{manifest['id']}: {summary['counts']}",
                    notify_enabled,
                )
            failures = sum(summary["counts"].get(name, 0) for name in RETRYABLE_STATES)
            if stop_event.is_set():
                return 130
            return 1 if failures else 0
        finally:
            signal.signal(signal.SIGINT, previous_sigint)
            signal.signal(signal.SIGTERM, previous_sigterm)


def read_job_state(job_root: Path) -> Dict[str, Any]:
    state_path = job_root.expanduser().resolve(strict=True) / "state.json"
    return json.loads(state_path.read_text(encoding="utf-8"))


def status_command(job_root: Path, as_json: bool) -> int:
    summary = summarize_state(read_job_state(job_root))
    if as_json:
        print(json.dumps(summary, indent=2, sort_keys=True))
    else:
        counts = ", ".join(
            f"{key}={value}" for key, value in sorted(summary["counts"].items())
        )
        print(
            f"{summary['benchmark_id']}: {counts}; attempts={summary['attempts']}; questions={summary['questions']}"
        )
    return 0


def report_command(job_root: Path) -> int:
    resolved = job_root.expanduser().resolve(strict=True)
    state = read_job_state(resolved)
    summary = summarize_state(state)
    report = {
        "generated_at": utc_now(),
        "summary": summary,
        "runs": state["runs"],
    }
    atomic_write_json(resolved / "report.json", report)
    print(resolved / "report.json")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name in ("run", "resume"):
        command = subparsers.add_parser(name, help=f"{name} a benchmark manifest")
        command.add_argument("manifest", type=Path)
    status = subparsers.add_parser("status", help="show durable job status")
    status.add_argument("job_root", type=Path)
    status.add_argument("--json", action="store_true")
    report = subparsers.add_parser("report", help="write a durable aggregate report")
    report.add_argument("job_root", type=Path)
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command in {"run", "resume"}:
            return run_benchmark(args.manifest)
        if args.command == "status":
            return status_command(args.job_root, args.json)
        if args.command == "report":
            return report_command(args.job_root)
    except (
        BenchmarkError,
        FileNotFoundError,
        PermissionError,
        OSError,
        ValueError,
    ) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    raise AssertionError(f"unhandled command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
