---
name: dagster
description: >
  Dagster project setup, configuration, and scaffolding with the dg CLI. Use when
  creating a Dagster project, adding assets/schedules/sensors/resources, wiring
  configuration (EnvVar, .env, ConfigurableResource), deploying to Dagster+, or
  answering any Dagster API/CLI question.
---

## Step 1: Scaffold the Project

**Completion criterion**: `src/<pkg>/definitions.py` and `pyproject.toml` with
`[tool.dg]` exist.

NEVER create a Dagster project by hand. Use the scaffolder:

```bash
uvx create-dagster@latest project <name> --uv-sync
```

For multi-project setups: `uvx create-dagster@latest workspace <name>`.

Produces: `src/<pkg>/definitions.py` (entry point), `src/<pkg>/defs/`
(definitions directory), `tests/`, `pyproject.toml`.

Read [create-dagster](./references/cli/create-dagster.md) for details.

## Step 2: Configure Resources and Environment

**Completion criterion**: `dg list envs` shows every env var the project
references, and `.env` (or `.env.example`) supplies them.

Resources subclass `dg.ConfigurableResource`. Secrets and environment-specific
values use `dg.EnvVar`, which resolves at runtime from `.env` or the deployment
environment:

```python
class DatabaseResource(dg.ConfigurableResource):
    connection_string: str = dg.EnvVar("DATABASE_URL")
    pool_size: int = 10
```

`.env` at the project root is auto-loaded by `dg`. Add `.env` to `.gitignore`
and commit `.env.example` as a template.

Read [Environment Variables](./references/env-vars.md) for the full pattern
(environment-specific files, `--env-file`, `dg list envs`).

## Step 3: Add Definitions

**Completion criterion**: `dg list defs` shows the new definitions.

Add assets, schedules, sensors, and components through `dg scaffold defs`, never
by hand:

```bash
dg scaffold defs dagster.asset defs/my_asset.py
dg scaffold defs dagster.schedule defs/daily.py
dg scaffold defs dagster.sensor defs/watcher.py
dg scaffold defs dagster_dbt.DbtProjectComponent defs/my_dbt --project-dir dbt_project
```

Read [dg scaffold defs](./references/cli/scaffold/defs.md) for the full
reference (components, inline components, JSON params, inspecting types).

## Step 4: Wire Definitions

**Completion criterion**: `dg check defs` passes without errors.

Dagster auto-discovers everything in `defs/`. Files scaffolded in Step 3 — bare
`@dg.asset`, `@dg.schedule`, `@dg.sensor` — require no additional wiring.

`definitions.py` serves as the entry point. Use `dg.load_from_defs_folder()` to
trigger auto-discovery:

```python
# src/my_pkg/definitions.py
from pathlib import Path
import dagster as dg

defs = dg.Definitions.merge(
    dg.load_from_defs_folder(path_within_project=Path(__file__).parent),
    dg.Definitions(
        resources={"db": DatabaseResource()},
    ),
)
```

For explicit wiring (lazy loading, `ComponentLoadContext`, custom Definitions
merging), use the `@dg.definitions` decorator on a function returning
`dg.Definitions(...)`. Files with this decorator are also auto-discovered:

```python
# src/my_pkg/defs/my_assets.py
import dagster as dg

@dg.definitions
def defs() -> dg.Definitions:
    return dg.Definitions(
        assets=[my_asset, daily_asset],
        resources={"db": DatabaseResource()},
    )
```

Validate: `dg check defs`. Also run `dg check yaml` if components use YAML.

## Step 5: Run and Validate

**Completion criterion**: `dg dev` serves the UI and `dg launch` materializes
the target assets.

```bash
dg dev                  # local webserver + daemon
dg launch --assets X    # materialize specific assets
dg list component-tree  # verify component hierarchy
```

Read [dg dev](./references/cli/dev.md), [dg launch](./references/cli/launch.md),
[dg check](./references/cli/check.md), [dg list defs](./references/cli/list-defs.md).

## Step 6: Deploy (Dagster+)

**Completion criterion**: `dg plus deploy configure` produces `build.yaml` and
`container_context.yaml`, and `dg plus pull env` fetches remote env vars.

```bash
dg plus deploy configure   # scaffold build.yaml, container_context.yaml
dg plus pull env           # pull env vars from Dagster+
```

Read [Deployment Configuration Files](./references/deployment/config-files.md)
and [Dagster Plus CLI](./references/cli/plus/INDEX.md).

## Reference Index

NEVER answer from memory. Identify the relevant reference file, read it, then answer.

- [Asset Selection Syntax](./references/asset-selection.md) — filtering assets by tag, group, kind, upstream, or downstream
- [Environment Variables](./references/env-vars.md) — .env files, dg.EnvVar, dg list envs, environment-specific config
- [Asset Patterns](./references/assets/INDEX.md) — defining assets, dependencies, metadata, partitions, multi-asset definitions
- [Choosing an Automation Approach](./references/automation/choosing-automation.md) — schedules vs sensors vs declarative automation
- [Schedules](./references/automation/schedules.md) — time-based automation with cron expressions
- [Declarative Automation](./references/automation/declarative-automation/INDEX.md) — asset-centric condition-based automation (AutomationCondition)
- [Asset Sensors](./references/automation/sensors/asset-sensors.md) — triggering on asset materialization events
- [Basic Sensors](./references/automation/sensors/basic-sensors.md) — event-driven automation with file watching or custom polling
- [Run Status Sensors](./references/automation/sensors/run-status-sensors.md) — reacting to run success, failure, or status changes
- [dg check](./references/cli/check.md) — validating project configuration or definitions
- [create-dagster](./references/cli/create-dagster.md) — scaffolding new projects and workspaces
- [dg dev](./references/cli/dev.md) — starting a local development instance
- [dg launch](./references/cli/launch.md) — materializing assets or executing jobs locally
- [dg list components](./references/cli/list-components.md) — available component types for scaffolding
- [dg list defs](./references/cli/list-defs.md) — listing or filtering registered definitions
- [Dagster Plus API](./references/cli/api/INDEX.md) — programmatic management of Dagster Plus resources
- [dg list](./references/cli/list/INDEX.md) — exploring project structure (component tree, env vars, projects)
- [Dagster Plus CLI](./references/cli/plus/INDEX.md) — authentication, configuration, deployment, env vars, dbt manifests
- [dg scaffold component](./references/cli/scaffold/component.md) — creating custom reusable component types
- [dg scaffold defs](./references/cli/scaffold/defs.md) — adding definitions to a project
- [dg utilities](./references/cli/utils/INDEX.md) — inspecting component types, integrations, refreshing state cache
- [Creating Components](./references/components/creating-components.md) — building custom components from scratch
- [Designing Component Integrations](./references/components/designing-component-integrations.md) — wrapping external services or tools
- [Resolved Framework](./references/components/resolved-framework.md) — custom YAML schema types (Resolver, Model, Resolvable)
- [Subclassing Components](./references/components/subclassing-components.md) — extending existing components
- [Template Variables](./references/components/template-variables.md) — Jinja2 variables in component YAML
- [Creating State-Backed Components](./references/components/state-backed/creating.md) — components that fetch and cache external state
- [Using State-Backed Components](./references/components/state-backed/using.md) — state-backed components in production, CI/CD
- [Deployment Configuration Files](./references/deployment/config-files.md) — build.yaml, container_context.yaml, dagster_cloud.yaml
- [Integration Libraries](./references/integrations/INDEX.md) — 40+ integration libraries (dbt, Fivetran, Snowflake, AWS, etc.)
- [Migration Guides](./references/migration/INDEX.md) — sensor migration to declarative automation
