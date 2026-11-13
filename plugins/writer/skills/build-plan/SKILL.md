---
name: build-plan
description: Use when writing or revising a build_plan for anything being built - the plan a builder executes without asking - a stack that fits, components and interfaces, data flow, ordered phases with files, requirement ids and checkable exits, install and run, test plan, risks with fallbacks, and the acceptance checklist the builder ticks off.
---

# Build plan

The build plan is written for whoever builds it, usually a coding agent,
specific enough that the build never has to reopen a decision. It fits
anything being built: an app, a command-line tool, an API or library, a
data pipeline. When the work starts from the person's request alone, it
says what it delivers in their terms.

## What the requirements already say

When requirements are filed, the plan adds how to build the thing and
repeats nothing they decided. It refers to them by the document's title and
the item's id (FR-1, NFR-2, IR-1, AC-3) wherever a phase, a component or a
check exists to meet one. The approach, each requirement's wording, the
list of screens or commands and what each acceptance criterion expects stay
in the requirements; the reader opens them by the id.

## The stack

- When the project already has code, the plan uses its language,
  frameworks and tools, and names them.
- When the person asked for a stack, the plan uses it.
- When neither says, propose a stack that fits the thing being built and
  where it runs, and say why in a sentence: few parts, widely used and well
  documented. For a web app, the task may suggest a web stack; use it
  unless the documents give a reason not to. A stack you chose yourself is
  a decision for the person to confirm, so the In short names it.

## Sections, in order

1. `## In short`: two to four one-line bullets: the stack, the number of
   phases, the riskiest part and its fallback. **Bold the words that carry
   the meaning.**
2. `## Stack`: the stack and why it fits the approach and the constraints.
   Name the approach by where the requirements chose it, in one clause;
   describe it only when no requirements are filed.
3. `## Components and interfaces`: each part, what it owns, and what passes
   between parts: routes and tables for a web app; modules and files for a
   command-line tool; endpoints and schemas for an API; stages and datasets
   for a pipeline. A screen or command the requirements list is named by
   its id, with the part that serves it.
4. `## Data flow`: where each piece of data comes from, how it moves
   between outside sources and the parts, and where it is kept.
5. `## Phases`: in order, each with its files, the requirement ids it
   delivers and a checkable exit. Order them so something real runs early
   and grows: for anything, the smallest end-to-end slice first, such as one
   command that runs, one endpoint that answers or one record through the
   pipeline. For a web app with a server and a live preview, the order lets
   the person watch it take shape: the shared schemas and the client's
   sample data first; then the theme, layout and routes; then the pages on
   sample data; then the server; then each page wired to the server; checks
   and the README last. The phases reach every must and name the
   nice-to-haves that ship.
6. `## Install and run`: how the person installs and runs it, with the
   project's own scripts or the stack's standard ones. Settings such as
   ports, keys and paths come from the environment.
7. `## Test plan`: what is checked and how. Each acceptance criterion is
   tried the way a person would use the thing: on its screens, at its
   command line, against its endpoints. Name the checks the project or its
   starter already has. For a web app on the coder's web starter, its
   check-app builds and starts the app and opens every page at desktop and
   phone widths, failing on errors, failed requests, blank pages and
   sideways scrolling, so the plan relies on it and the acceptance checks
   and adds no test files. Otherwise name the tests the build adds and the
   command that runs them, kept to what proves the acceptance criteria.
8. `## Risks and unknowns`: what could make a phase fail, what the
   documents leave open, and the fallback for each. Name here any
   requirement the plan does not reach or believes is wrong.
9. `## Acceptance checklist`: a Markdown task list, one unchecked `- [ ] `
   line per acceptance criterion, led by its AC id and saying only how to
   try it: on which screen, at which command or against which endpoint.
   What it must then show is the criterion's own wording in the
   requirements. When no requirements are filed, one line per thing the
   person asked for, saying what a person does and what they then see. The
   builder confirms each one and reports it by id.

## What makes it good

- Name concrete files and the routes, commands, tables, screens or
  endpoints the thing has; each phase is small enough that its exit is
  observable.
- Cite a requirement by its id and leave its wording to the requirements
  document. A sentence the requirements already hold is a sentence to cut.
- Use what the project, its starter and its stack already provide, and name
  it.
- The checklist covers every acceptance criterion, each line a short
  action a person can carry out.

`read_skill build-plan file reference/exemplar.md` shows the shape for a
web app, and `reference/exemplar-cli.md` for a command-line tool; follow
the one closer to what is being built.
