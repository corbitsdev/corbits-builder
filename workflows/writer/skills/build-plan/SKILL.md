---
name: build-plan
description: Use when writing or revising a build_plan - the plan a coder executes without asking - the chosen approach and stack, components, data flow, ordered phases with files, requirement ids and checkable exits, install and run, test plan, risks with fallbacks, and the acceptance checklist the coder ticks off.
---

# Build plan

The build plan is written for the coder, specific enough that the build
never has to reopen an earlier decision. It cites the requirements by id
(FR-1, NFR-2, AC-3) wherever a phase, a component or a check exists to meet
one, and carries each requirement by its id.

## Sections, in order

1. `## In short`: two to four one-line bullets: the approach and stack, the
   number of phases, the riskiest part and its fallback. **Bold the words
   that carry the meaning.**
2. `## Approach and stack`: the chosen approach from the approaches
   document, the stack, and why both fit the constraints.
3. `## Components and interfaces`: each part of the app, what it owns, and
   the routes, tables and screens between parts.
4. `## Data flow`: where each piece of data comes from, how it moves
   between outside sources, the server and the screens, and where it is
   kept.
5. `## Phases`: in order, each with its files, the requirement ids it
   delivers and a checkable exit. The phases reach every must and name the
   nice-to-haves that ship.
6. `## Install and run`: how the person installs and runs the app with the
   starter's standard scripts. The port comes from the environment.
7. `## Test plan`: what is checked and how. The starter's check-app builds
   and starts the app and opens every page at desktop and phone widths,
   failing on errors, failed requests, blank pages and sideways scrolling.
   Features are checked by trying each acceptance criterion in the running
   app as a person would, so the plan relies on those two checks and adds
   no test files.
8. `## Risks and unknowns`: what could make a phase fail, what the
   documents leave open, and the fallback for each. Name here any
   requirement the plan does not reach or believes is wrong.
9. `## Acceptance checklist`: a Markdown task list, one unchecked `- [ ] `
   line per acceptance criterion, led by its AC id, saying what a person
   does on which screen and what they then see. The coder confirms each
   one and reports it by id.

## What makes it good

- Name concrete files, routes, tables and screens; each phase is small
  enough that its exit is observable.
- Cite a requirement by its id and leave its wording to the requirements
  document.
- Use what the starter and the default stack already provide, and name it.
- The checklist covers every acceptance criterion, each line a short
  action and a visible result.

`read_skill build-plan file reference/exemplar.md` shows the shape.
