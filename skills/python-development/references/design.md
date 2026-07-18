# Design

Choose the simplest design that meets current requirements and leaves likely changes local.

## Boundaries

A component has a coherent reason to change. Separate delivery, domain behavior, and infrastructure when their change pressures differ. Keep business decisions testable without network, filesystem, framework, or database setup. Pass dependencies explicitly at composition boundaries.

Composition is the default when behavior varies independently. Inheritance is appropriate for a genuine substitutable relationship or framework contract. Protocols can describe consumed behavior without imposing a hierarchy.

Abstraction is justified by a stable shared concept, not a line count. The rule of three is a heuristic: tolerate small duplication while the concept is uncertain, but extract sooner when copies already diverge incorrectly or enforce a critical invariant.

Repositories and service layers are recommendations, not mandatory architecture. Add them when they isolate persistence or coordinate use cases; avoid pass-through layers that only rename calls. Constructors with many unrelated dependencies are evidence to examine responsibility, not a numerical failure by themselves.

Dependency direction should keep policy independent of adapters. Avoid leaking ORM, transport, or vendor types across public boundaries when doing so couples callers to replaceable infrastructure.

Completion criterion: each abstraction has a named responsibility and consumer, dependencies point toward stable policy, and tests can exercise domain behavior without unrelated I/O.
