# Pi Fabric first-use onboarding

This adapter's persisted policy is [`../agents/profile.yaml`](../agents/profile.yaml). On first use, read it, then call `tools.models()` and validate that it is well-formed: `version` is `1`; `approvedModels` is a non-empty array of unique strings; and `scout`, `builder`, and `reviewer` each have a `thinking` value of `low`, `medium`, or `high`, a tool-list array, and boolean `extensions` and `recursive` fields. Also validate that at least one `approvedModels` key is currently available.

Treat these states as invalid: no profile, malformed profile, invalid profile content, or no available approved model. Do not inherit Main's model or select an unapproved one. Explain the problem and ask the user to correct or approve a replacement pool. Persist the approved correction only to `agents/profile.yaml`, then validate it again with `tools.models()` before dispatch.

A valid profile with a non-empty runtime intersection skips onboarding. Runtime discovery validates availability only; it does not define the approved pool. This is host-skill behavior, not a claim about Fabric persistence or prompting APIs.
