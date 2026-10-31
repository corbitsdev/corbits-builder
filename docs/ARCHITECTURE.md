# Builder: architecture

How Builder is structured and why. What it does for a person is in
[PRODUCT.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/PRODUCT.md);
the concrete technology and layout are in
[IMPLEMENTATION.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/IMPLEMENTATION.md).

## Overview

Builder is a control plane (the hub) on top of an agent runtime (Interchange).
The runtime owns agents, workflows, mail between them, approvals, credentials,
sandboxed workers and run lifecycles. The hub adds what is specific to
Builder: projects, versioned documents, the tools agents use to file and hand
off work, the app repository and live preview, preferences, and an API for the
interface.

```
person -> interface -> client API -> hub -> runtime (workflows, mail, approvals)
                                      |        |
                                      |        +-> sidecars running the agents
                                      |
                                      +-> documents, app repository, live app
```

## Components

### The hub

The hub is the server and the system of record. It:

- signs people in and holds tenancy: an install has workspaces, and each
  project is a tenant of its own under its workspace, holding the project's
  principals, documents, approvals and runs;
- creates projects and starts each project's coordinator;
- stores documents and their versions, and records which versions an approval
  covered;
- provides the tools agents call to read and file documents, hand off work and
  ask the person things;
- hosts each project's app repository and runs its live preview;
- answers the interface's API and streams run progress to it.

It embeds the runtime's control plane in the same process and composes it
directly. There is no separate embedding layer.

### Agents and roles

Each role is a workflow package: an agent definition (prompt, tools,
capabilities, model tier) and a workflow definition (trigger, steps, lifetime).

- **Coordinator**: one per project, long-lived. Talks to the person, writes the
  problem brief, hands off work and asks for decisions.
- **Writer**: one bounded write of one document of a named kind.
- **Reviewer**: one bounded review of one document; its findings are advice
  mailed to the coordinator.
- **Designer**: long-lived, one per design concept. Builds a clickable HTML
  and CSS mockup in its workspace.
- **Coder**: long-lived, one per project. Builds the whole app in its
  workspace and takes later changes there.

All roles are triggered by mail. The writer and reviewer take exactly one
message and end. The coordinator, designers and coder keep their warm agent
and workspace and take each later message as another turn on the same state.

Only the coordinator talks to the person. Specialists put questions in their
mail to it, and it decides whether to ask the person.

### Documents and versions

A document has a kind, a title and a sequence of versions. Each version has
content and a content hash, and may carry open questions for the person and,
for the approaches, structured options for side-by-side comparison. The kinds
are the problem brief, constraints, approaches, product requirements, build
plan, design options, the design and the app.

- Text documents are written whole by the coordinator or a writer.
- A design option is filed from a designer's workspace once the design check
  passes; the design is filed when the person chooses an option.
- The app is filed from the coder's workspace each time the app check passes.

The hub assigns each version's id, number and hash. Writing a version is never
an approval. A writer gets the documents it builds on in full inside its
assignment and has no read tool, so it works only from what it was given.

### Approvals

Approvals are the runtime's own human approvals. A tool that needs a person's
go-ahead (`request_approval`, `design_app`, `instruct_coder`, adding a package)
is declared as asking, so the runtime parks the call until a person resolves
it. After it resolves, the hub records the exact document versions and hashes
it covered, and only those whose hash still matches storage.

- Versions and hashes come from the hub, never from model input, so an
  approval cannot be pointed at a version the person did not see.
- Choosing a design option and importing a project as approved are the
  person's own acts; the hub records that person as the approver.
- Hand-off tools check approvals before they start the next writer.

### Questions

`ask_questions` puts a structured card (up to five questions with options and a
recommended answer) in front of the person and returns at once. The answers
reach the coordinator as the person's next message. A document's open
questions carry over into such a card. Questions are never modelled as
approvals.

### The app repository and live preview

Each project has one git repository for its app. A coder run gets push access
to its main branch, scoped to that run and revoked when the run ends. A new
coder workspace starts from main when main holds a version, else from the last
filed app, else from the app starter.

The live preview runs the project's app in its own sandboxed process per
project. While a coder works, it follows the coder's workspace; afterwards it
runs the latest filed app. It installs packages when they change, restarts on
file changes, restarts a crash once and then waits for the next change, and
stops when no one has had the project open for a short while. Each project's
app is served from its own origin, and a request reaches it only when the hub
would show that person the project; the hub's cookies never reach the app.

### Sandboxes

The designer and coder run on sidecars that offer a POSIX runtime. Their shell,
file and browser tools run inside a sandbox with a file policy (the workspace
is writable, filed inputs and the design are read-only) and a network policy
(the package registry only, or the public internet when the person allows it).
Browser tools reach only the app running in the same sandbox.

### Models and profiles

A **provider** is a connected source of models: an API key (Anthropic, OpenAI,
Google Gemini, xAI) or a subscription login (ChatGPT, xAI). A **profile** maps
four **tiers** (Low, Medium, High, Max) to one model and reasoning effort each.
Each role runs on a fixed tier, set in configuration:

| Role        | Tier   |
| ----------- | ------ |
| Coordinator | Medium |
| Writer      | Medium |
| Designer    | High   |
| App builder | High   |
| Reviewer    | Low    |

Every provider ships a ready-made profile, and a person can make their own. A
person chooses only a profile, never a model per role. A project resolves its
profile when its coordinator starts and keeps it for its whole life
([how it resolves](https://github.com/corbitsdev/corbits-builder/blob/main/docs/DEV.md#model-profile-choice)).

### Preferences

Preferences are a registry of named choices, each with options and a default,
and the roles it guides. A person's choices live in their settings; a project
freezes its creator's choices and model profile when it starts. The coordinator
reads the resolved preferences as guidance; the hub reads them where they
change behaviour (approval gating, package installs, network access, design
concept count).

### The client API and interface

The client API is a typed library over the hub's HTTP API. The interface uses
only that library and the shared contract types; it never imports server code
or the database. Every action in the interface is an authenticated API call
that other clients can make too.

## Control flow and data flow

1. The person creates a project. The hub creates its tenant, installs the role
   packages on the project's model bindings and deploys the coordinator.
2. The person's messages are mail to the coordinator. Its replies are mail
   back, shown as the conversation.
3. The coordinator files the brief itself, then hands work off with hub tools:
   `deploy_writer` and `review_artifact` for documents, `design_app` for design
   concepts, `deploy_coder` once for the app and `instruct_coder` for later
   changes.
4. The hub builds each assignment from its own templates: the task, the
   documents it builds on in full and pinned by version and hash, and the kind
   to write. The tool checks prerequisites first: earlier documents exist and
   are approved, and no coder is already running.
5. The specialist works, files its result as a document version and mails a
   short summary back on the assignment's thread.
6. The coordinator reads the filed document, judges it and either has it
   revised, asks the person, or asks for approval.
7. The interface reads documents, approvals, run state and the live app
   through the API, and progress through a run event stream.

Work is handed off by mail and results are filed as documents. Mail carries
the conversation; documents carry the work.

## Design decisions

- **No fixed stages.** The coordinator decides the order of work from the
  document list and the conversation. The order documents build on each other
  is enforced as prerequisites in the hand-off tools, not as a stage machine.
- **Agent behaviour lives in agent definitions and tools.** Prompts describe
  the task and the domain. Turn order, reply termination and loop detection are
  the runtime's job. Hub code covers human decisions and tenant state.
- **Use the runtime's machinery.** Loops, retries, waits, timeouts, mail,
  approvals and failure records come from the runtime rather than being
  rebuilt in the hub.
- **Native state over model output.** Progress, the person's next step,
  in-flight specialists and decisions are read from run status, run events and
  approval records, never from parsing what a model wrote.
- **Deterministic code over model turns.** Anything code can do, code does:
  assignment messages, design and app checks, starting the app, filing
  snapshots, notices when a specialist ends.
- **Exact versions everywhere.** Assignments pin documents by version and
  hash; approvals bind to the hash the hub computed.
- **Model-agnostic.** Roles are bound to tiers, and a profile maps tiers to a
  provider's models, so any connected provider can run any role.
- **Configuration holds wording.** User-visible names and text live in
  configuration, so a rename is a configuration change.

## Failure handling

- **Refusals are results.** A tool that cannot act returns the reason and what
  to do instead (a missing or unapproved document, a coder already running),
  and the underlying error code passes through unchanged.
- **Run outcomes come from the run.** A failed run's cause is read from its
  own terminal events.
- **A specialist that ends without answering** is noticed by a reconciler,
  which mails the coordinator once with the reason so it can start the work
  again.
- **A coordinator that ended** is replaced with a fresh run when the project is
  next opened; the earlier runs and filed documents are carried to it as
  context with the person's next message.
- **Coordinator upgrades** wait for a safe point (parked on input, nothing
  pending, no specialist at work) before replacing the run.
- **Runaway model output** that repeats one passage is cut off, and long
  histories are compacted to fit the model's context.
- **Unavailable is a state.** A project with no usable model provider says
  why and waits; nothing falls back silently to another provider.
- **Capacity.** Work is placed on a sidecar with room; a placement refused for
  room is retried by the runtime.
