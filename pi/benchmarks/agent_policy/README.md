# Agent-policy benchmark runner

This runner executes Pi benchmarks without an interactive terminal. It uses
Pi's JSONL RPC protocol, journals every state transition, answers known
questions from the manifest, and never waits indefinitely for user input.

## Guarantees

- Every attempt gets a fresh copy of its fixture.
- State is atomically persisted after each transition.
- Interrupted `running` records become resumable `pending` records.
- Structured RPC dialogs are answered from explicit rules.
- Plain-text questions can receive deterministic follow-up messages.
- Unknown questions are recorded as `unresolved_question` and do not stop the
  remaining suite.
- Timeouts and process failures retry within a bounded attempt budget.
- First attempts and retries remain separate directories.
- Herdr notifications are best-effort and never control job completion.

## Commands

From the dotfiles repository:

```bash
python3 pi/benchmarks/agent_policy/runner.py run manifest.json
python3 pi/benchmarks/agent_policy/runner.py resume manifest.json
python3 pi/benchmarks/agent_policy/runner.py status ~/.pi/agent/evals/example
python3 pi/benchmarks/agent_policy/runner.py report ~/.pi/agent/evals/example
```

For an unattended macOS run in a dedicated Herdr pane:

```bash
caffeinate -dimsu python3 \
  ~/.dotfiles/pi/benchmarks/agent_policy/runner.py run \
  ~/.dotfiles/pi/benchmarks/agent_policy/examples/smoke-manifest.json
```

`caffeinate` prevents ordinary idle sleep while the process is running. Closing
a laptop lid can still suspend macOS depending on its power and clamshell
configuration. A reboot stops the process, but `resume` continues from the
durable state journal.

## Manifest

Manifests are JSON. Paths are expanded for `~` and environment variables, then
resolved relative to the manifest file.

```json
{
  "id": "policy-smoke",
  "output_dir": "~/.pi/agent/evals/global-agents/policy-smoke",
  "defaults": {
    "max_parallel": 2,
    "max_retries": 1,
    "startup_timeout_seconds": 45,
    "run_timeout_seconds": 600,
    "validator_timeout_seconds": 120,
    "max_question_rounds": 3,
    "unknown_question_policy": "cancel_and_record",
    "notify": true
  },
  "runs": [
    {
      "id": "luna-medium-auth",
      "template": "../fixtures/auth",
      "model": "openai-codex/gpt-5.6-luna",
      "thinking": "medium",
      "prompt": "Add authentication to this service.",
      "question_policy": {
        "unknown": "cancel_and_record",
        "plain_unknown_response": "Use an environment-configured bearer token, preserve compatibility, add no dependency, and protect /inventory.",
        "rules": [
          {
            "method": "select",
            "match": "authentication|credential",
            "value_match": "bearer|api key"
          }
        ],
        "plain_followups": [
          {
            "match": "authentication requirements|which authentication",
            "response": "Use an environment-configured bearer token, preserve compatibility, add no dependency, and protect /inventory."
          }
        ]
      },
      "validators": [
        {
          "type": "command",
          "command": ["python3", "-m", "unittest", "-v"]
        }
      ]
    }
  ]
}
```

### Question policies

Dialog rules match the request title, message, and options. `select` rules may
use an exact `value` or a `value_match` regular expression. `confirm` rules use
`confirmed`; `input` and `editor` rules use `value`.

Unknown dialogs default to `cancel_and_record`: the runner responds immediately
so Pi cannot remain blocked, records the unresolved decision, and allows the
agent to settle. `first_option` is available for synthetic fixtures but should
not be used for consequential real work.

Plain follow-ups are matched against a settled assistant response. Each rule is
used at most once per attempt. An unmatched final question becomes a terminal
`unresolved_question` result while other runs continue. Set
`plain_unknown_response` when a fixture has one safe, predetermined response
that should be used once regardless of the question's wording.

## Status and artifacts

Each job contains:

```text
manifest.json
state.json
events.jsonl
summary.json
report.json
runs/<run-id>/attempt-<n>/
  workspace/
  sessions/
  rpc.jsonl
  stderr.log
  questions.jsonl
  result.json
  validators.json
```

Terminal run states are `passed`, `failed`, `timed_out`, `process_error`, and
`unresolved_question`. The last state is a benchmark observation, not an
infrastructure failure.

## Validation

```bash
python3 -m unittest discover -s pi/benchmarks/agent_policy/tests -v
ruff check pi/benchmarks/agent_policy
ruff format --check pi/benchmarks/agent_policy
```
