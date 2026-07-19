from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any, Dict

from pi.benchmarks.agent_policy import runner


HERE = Path(__file__).parent
FAKE_AGENT = HERE / "fake_rpc_agent.py"


class QuestionPolicyTests(unittest.TestCase):
    def test_select_rule_uses_matching_option(self) -> None:
        request = {
            "id": "q1",
            "method": "select",
            "title": "Authentication approach",
            "options": ["JWT/OIDC", "Bearer token"],
        }
        response, unresolved, decision = runner.extension_ui_response(
            request,
            {
                "unknown": "cancel_and_record",
                "rules": [
                    {
                        "method": "select",
                        "match": "authentication",
                        "value_match": "bearer",
                    }
                ],
            },
        )
        self.assertFalse(unresolved)
        self.assertEqual(decision, "Bearer token")
        self.assertEqual(response["value"], "Bearer token")

    def test_unknown_select_is_cancelled_and_recorded(self) -> None:
        response, unresolved, decision = runner.extension_ui_response(
            {"id": "q1", "method": "select", "title": "Unknown", "options": ["A"]},
            {"unknown": "cancel_and_record", "rules": []},
        )
        self.assertTrue(unresolved)
        self.assertEqual(decision, "cancelled")
        self.assertTrue(response["cancelled"])


class RunnerIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.template = self.root / "template"
        self.template.mkdir()
        (self.template / "README.md").write_text("fixture\n", encoding="utf-8")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def manifest(
        self,
        scenario: str,
        question_policy: Dict[str, Any] | None = None,
        run_timeout: float = 5,
        max_retries: int = 0,
    ) -> Path:
        output = self.root / f"job-{scenario}"
        run: Dict[str, Any] = {
            "id": f"run-{scenario}",
            "template": str(self.template),
            "model": "fake/model",
            "thinking": "off",
            "prompt": "Perform the fixture task",
            "pi_command": [sys.executable, str(FAKE_AGENT), "--scenario", scenario],
            "validators": [
                {
                    "type": "command",
                    "command": [sys.executable, "-c", "print('validated')"],
                }
            ],
        }
        if question_policy is not None:
            run["question_policy"] = question_policy
        manifest = {
            "id": f"test-{scenario}",
            "output_dir": str(output),
            "defaults": {
                "notify": False,
                "run_timeout_seconds": run_timeout,
                "startup_timeout_seconds": 2,
                "max_retries": max_retries,
            },
            "runs": [run],
        }
        path = self.root / f"{scenario}.json"
        path.write_text(json.dumps(manifest), encoding="utf-8")
        return path

    def state(self, scenario: str) -> Dict[str, Any]:
        return json.loads(
            (self.root / f"job-{scenario}" / "state.json").read_text(encoding="utf-8")
        )

    def test_successful_rpc_run_and_resume_are_idempotent(self) -> None:
        manifest = self.manifest("success")
        self.assertEqual(runner.main(["run", str(manifest)]), 0)
        first = self.state("success")
        self.assertEqual(first["runs"]["run-success"]["status"], "passed")
        self.assertEqual(first["runs"]["run-success"]["attempts"], 1)

        self.assertEqual(runner.main(["resume", str(manifest)]), 0)
        second = self.state("success")
        self.assertEqual(second["runs"]["run-success"]["attempts"], 1)

    def test_structured_question_is_answered(self) -> None:
        manifest = self.manifest(
            "structured",
            {
                "unknown": "cancel_and_record",
                "rules": [
                    {
                        "method": "select",
                        "match": "authentication",
                        "value_match": "bearer",
                    }
                ],
            },
        )
        self.assertEqual(runner.main(["run", str(manifest)]), 0)
        record = self.state("structured")["runs"]["run-structured"]
        self.assertEqual(record["status"], "passed")
        self.assertEqual(record["question_count"], 1)
        question_log = (
            self.root
            / "job-structured"
            / "runs"
            / "run-structured"
            / "attempt-1"
            / "questions.jsonl"
        )
        self.assertIn("Bearer token", question_log.read_text(encoding="utf-8"))

    def test_plain_question_gets_manifest_followup(self) -> None:
        manifest = self.manifest(
            "plain",
            {
                "plain_followups": [
                    {
                        "match": "authentication approach",
                        "response": "Use an environment-configured bearer token.",
                    }
                ]
            },
        )
        self.assertEqual(runner.main(["run", str(manifest)]), 0)
        record = self.state("plain")["runs"]["run-plain"]
        self.assertEqual(record["status"], "passed")
        self.assertEqual(record["question_count"], 1)

    def test_unknown_plain_question_is_terminal_without_blocking(self) -> None:
        manifest = self.manifest("plain", {})
        self.assertEqual(runner.main(["run", str(manifest)]), 0)
        record = self.state("plain")["runs"]["run-plain"]
        self.assertEqual(record["status"], "unresolved_question")

    def test_plain_question_can_use_a_deterministic_fallback(self) -> None:
        manifest = self.manifest(
            "plain",
            {"plain_unknown_response": "Use a bearer token."},
        )
        self.assertEqual(runner.main(["run", str(manifest)]), 0)
        record = self.state("plain")["runs"]["run-plain"]
        self.assertEqual(record["status"], "passed")
        self.assertEqual(record["question_count"], 1)

    def test_timeout_retries_from_fresh_attempt(self) -> None:
        manifest = self.manifest("hang", run_timeout=0.25, max_retries=1)
        self.assertEqual(runner.main(["run", str(manifest)]), 1)
        record = self.state("hang")["runs"]["run-hang"]
        self.assertEqual(record["status"], "timed_out")
        self.assertEqual(record["attempts"], 2)
        attempts = self.root / "job-hang" / "runs" / "run-hang"
        self.assertTrue((attempts / "attempt-1" / "workspace").is_dir())
        self.assertTrue((attempts / "attempt-2" / "workspace").is_dir())

    def test_interrupted_state_recovers_as_pending(self) -> None:
        manifest_path = self.manifest("success")
        manifest, digest = runner.load_manifest(manifest_path)
        job = self.root / "job-success"
        state = runner.initial_state(manifest, digest)
        state["runs"]["run-success"].update(status="running", attempts=1)
        runner.atomic_write_json(job / "state.json", state)

        recovered = runner.load_or_create_state(job, manifest, digest)
        record = recovered["runs"]["run-success"]
        self.assertEqual(record["status"], "pending")
        self.assertEqual(record["interruptions"], 1)

    def test_graceful_controller_stop_resumes_without_using_retry_budget(self) -> None:
        manifest = self.manifest("slow_success", run_timeout=5, max_retries=0)
        process = subprocess.Popen(
            [sys.executable, str(Path(runner.__file__)), "run", str(manifest)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        state_path = self.root / "job-slow_success" / "state.json"
        for _ in range(100):
            if state_path.exists():
                state = json.loads(state_path.read_text(encoding="utf-8"))
                if state["runs"]["run-slow_success"]["status"] == "running":
                    break
            time.sleep(0.02)
        else:
            process.kill()
            self.fail("runner never entered running state")

        process.terminate()
        stdout, stderr = process.communicate(timeout=5)
        self.assertEqual(process.returncode, 130, (stdout + stderr).decode())
        interrupted = self.state("slow_success")["runs"]["run-slow_success"]
        self.assertEqual(interrupted["status"], "pending")
        self.assertEqual(interrupted["failures"], 0)

        self.assertEqual(runner.main(["resume", str(manifest)]), 0)
        resumed = self.state("slow_success")["runs"]["run-slow_success"]
        self.assertEqual(resumed["status"], "passed")
        self.assertEqual(resumed["attempts"], 2)
        self.assertEqual(resumed["interruptions"], 1)

    def test_cli_status_and_report(self) -> None:
        manifest = self.manifest("success")
        self.assertEqual(runner.main(["run", str(manifest)]), 0)
        job = self.root / "job-success"
        completed = subprocess.run(
            [sys.executable, str(Path(runner.__file__)), "status", str(job), "--json"],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr.decode())
        self.assertTrue(json.loads(completed.stdout)["complete"])
        self.assertEqual(runner.main(["report", str(job)]), 0)
        self.assertTrue((job / "report.json").is_file())


if __name__ == "__main__":
    unittest.main()
