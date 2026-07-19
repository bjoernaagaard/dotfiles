#!/usr/bin/env python3
"""Small deterministic Pi RPC stand-in used by integration tests."""

from __future__ import annotations

import argparse
import json
import sys
import time
from typing import Any, Dict


def send(payload: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def assistant(text: str) -> Dict[str, Any]:
    return {"role": "assistant", "content": [{"type": "text", "text": text}]}


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--scenario", default="success")
    args, _unknown = parser.parse_known_args()
    prompt_count = 0

    for raw in sys.stdin.buffer:
        request = json.loads(raw.decode("utf-8"))
        request_type = request.get("type")
        if request_type == "get_state":
            send(
                {
                    "type": "response",
                    "command": "get_state",
                    "id": request.get("id"),
                    "success": True,
                    "data": {"isStreaming": False},
                }
            )
            continue
        if request_type == "abort":
            send({"type": "response", "command": "abort", "success": True})
            continue
        if request_type != "prompt":
            continue

        prompt_count += 1
        send(
            {
                "type": "response",
                "command": "prompt",
                "id": request.get("id"),
                "success": True,
            }
        )
        send({"type": "agent_start"})

        if args.scenario == "hang":
            time.sleep(60)
            continue

        if args.scenario == "slow_success":
            time.sleep(2)

        if args.scenario == "structured" and prompt_count == 1:
            send(
                {
                    "type": "extension_ui_request",
                    "id": "question-1",
                    "method": "select",
                    "title": "Authentication approach",
                    "options": ["Bearer token", "JWT/OIDC"],
                }
            )
            response = json.loads(sys.stdin.buffer.readline().decode("utf-8"))
            selected = response.get("value", "cancelled")
            message = assistant(f"Implemented {selected}")
            send({"type": "message_end", "message": message})
            send({"type": "agent_end", "messages": [message], "willRetry": False})
            send({"type": "agent_settled"})
            continue

        if args.scenario == "plain" and prompt_count == 1:
            message = assistant("Which authentication approach should I use?")
            send({"type": "message_end", "message": message})
            send({"type": "agent_end", "messages": [message], "willRetry": False})
            send({"type": "agent_settled"})
            continue

        message = assistant("Completed successfully")
        send({"type": "message_end", "message": message})
        send({"type": "agent_end", "messages": [message], "willRetry": False})
        send({"type": "agent_settled"})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
