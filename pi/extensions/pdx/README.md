# pdx

`pdx` is a native Pi extension for pitchfork, mise, and fnox.

It does not start or speak MCP. It calls the installed CLIs directly and adds
Pi-native schemas, confirmation, cancellation, bounded output, and rendering.

At session start, pdx inspects mise's effective config list rather than looking
only for a project-local `mise.toml`. When it finds `[bootstrap.*]` tables, it
reports the active Bootstrap status to the agent on every turn and advises it
to use `pdx_mise_bootstrap` for machine setup work. This also covers the
official seed layout where `~/.config/mise/config.toml` points at a dotfiles
repository.

## Tools

- `pdx_pitchfork`: status, start, stop, restart, and logs
- `pdx_mise`: tools, tasks, environment, configuration, task execution, and installation
- `pdx_mise_bootstrap`: inspect status, preview a plan, or apply a targeted mise Bootstrap
- `pdx_fnox_exec`: execute an argument-array command through fnox
- `pdx_fnox_secret`: explicitly retrieve one named secret

## Configuration

Optional configuration is loaded from:

```text
~/.pi/agent/pdx.json
project/.pi/pdx.json
```

The extension has one global permission mode for every tool and operation.
It defaults to `ask`: mutating operations, mise environment values, fnox
execution, and raw secret retrieval ask once. Set the global
`permissionMode` to `yolo` to skip all pdx confirmation gates. There are no
per-tool or per-subset permission switches. Trusted project configuration may
narrow a global `yolo` mode back to `ask`, but cannot enable `yolo` globally.

```json
{
  "permissionMode": "ask"
}
```

`pdx_mise_bootstrap` supports `status`, `plan`, and `apply`. Applying can be
targeted with `only` or `skip`, and supports mise's `update` and
`forceDotfiles` flags. It always uses argv execution and never exposes an
arbitrary shell command.

Fnox output still uses a child-process redaction runner because normal
`fnox exec` injects environment-enabled secrets into the command. Under
`yolo`, pdx intentionally does not add extra confirmation or allowlist gates;
the normal execution and output-safety behavior remains.

## Commands

```text
/pdx doctor
/pdx status
```

`pdx_fnox_exec` uses a small child-process runner to redact inherited
environment values before returning command output to Pi. It fails closed if
the runner cannot produce a safe result. This is literal redaction only; a
command that transforms or encodes a secret may still expose the transformed
value.
