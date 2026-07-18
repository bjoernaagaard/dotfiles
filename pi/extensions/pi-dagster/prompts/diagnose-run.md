Diagnose a Dagster run safely.

Ask for the run id and target profile if either is unclear. Then:

1. Load and run `dagster_evidence_pack`.
2. Verify the cause from the bounded redacted error chain, step events, log availability/tails, upstream checks/materializations, and location/collision evidence.
3. Use `dagster_compare_run` only when a strictly comparable successful baseline is available.
4. Classify the failure before recommending a change.
5. If useful, offer one explicit hypothesis branch with `/dagster-incident fork hypothesis="…"`.
6. Remediate only through existing policy-gated tools; do not mutate automatically or expose secrets.
7. Validate source/config changes with the allowlisted `dagster_dg_command` `dg check` form.
8. Relaunch or reexecute with existing tools, observe the result, and summarize run/audit ids without raw logs.
