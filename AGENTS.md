# Contributing to Builder

Builder turns an idea into approved documents, a design and a working web app,
on a hub built on vendored Interchange. Start with
[ARCHITECTURE.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/ARCHITECTURE.md)
and
[IMPLEMENTATION.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/IMPLEMENTATION.md);
running it is in
[DEV.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/DEV.md)
and sending a change in
[CONTRIBUTING.md](https://github.com/corbitsdev/corbits-builder/blob/main/CONTRIBUTING.md).

The scripts in
[CONTRIBUTING.md](https://github.com/corbitsdev/corbits-builder/blob/main/CONTRIBUTING.md#making-a-change)
and the
[Corbits Triage policy](https://github.com/corbitsdev/corbits-builder/blob/main/.corbits-triage.yml)
enforce most code conventions; run them before saying the tree passes.
These are the ones no check catches:

- Build on Interchange for anything it owns (agents, workflows, tools,
  compaction, mail, approvals, credentials, isolation) rather than
  reimplementing it, and raise what falls between Interchange, Corbits packages
  and Builder before building it
  ([who owns what](https://github.com/corbitsdev/corbits-builder/blob/main/docs/IMPLEMENTATION.md#who-owns-what)).
- The interface talks to the hub through `@corbits-builder/client`.
- A change to `vendor/interchange` is its own `(vendor)` commit that also
  updates `vendor/interchange.manifest.json`.
- User-visible wording lives in configuration: `apps/hub/src/config/` for the
  hub and agents, `apps/web/src/config.ts` for the interface.
- Secrets stay out of responses, logs, documents and prompts; the interface
  shows only whether a secret is set.
- Conventional Commits (`<type>(<scope>): <description>`), one logical change
  per commit and per pull request.
- Comments explain why, not what the code already says.
- Prompts describe the task and the domain. Turn order, reply termination and
  loop detection are the inference loop's job.
