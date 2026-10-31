# Contributing to Builder

Builder turns an idea into approved documents, a design and a working web app:
a coordinator agent talks with the person and hands work to specialist agents,
on a hub built on vendored Interchange. What it is and why is in
[PRODUCT.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/PRODUCT.md),
how it is structured in
[ARCHITECTURE.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/ARCHITECTURE.md),
and the concrete choices, layout and Interchange docs map in
[IMPLEMENTATION.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/IMPLEMENTATION.md).
Running it is in
[DEV.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/DEV.md),
and sending a change in
[CONTRIBUTING.md](https://github.com/corbitsdev/corbits-builder/blob/main/CONTRIBUTING.md).
These conventions apply to every change, whoever or whatever writes it.

- Every dependency is pinned to an exact version: no `^`, `~`, ranges or
  `latest`.
- Interchange's packages (`@intx/*`) are meant to be used. Import them by
  package name wherever they fit; the interface talks to the hub through
  `@corbits-builder/client`. Build on Interchange's agent loop, retries, waits, timeouts, mail,
  approvals and failure handling rather than reimplementing them, and read the
  area's Interchange doc first.
- A change to `vendor/interchange` is its own `(vendor)` commit that also
  updates `vendor/interchange.manifest.json`; `bun run vendor:verify` fails on
  anything unrecorded.
- User-visible wording lives in configuration: `apps/hub/src/config/` for the
  hub and agents, `apps/web/src/config.ts` for the interface.
- Secrets stay out of responses, logs, documents and prompts; the interface
  shows only whether a secret is set.
- Comments explain why, not what the code already says.
- `bun run check` is the gate: lint (oxlint), format (`bun fmt`), typecheck and
  tests. Run it before saying the tree passes.
- Conventional Commits (`<type>(<scope>): <description>`), one logical change
  per commit and per pull request.
- Prompts describe the task and the domain. Turn order, reply termination and
  loop detection are the inference loop's job.
