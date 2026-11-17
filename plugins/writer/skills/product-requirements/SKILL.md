---
name: product-requirements
description: Use when writing or revising a product_requirements document - the testable requirements (FR, NFR, IR ids) the build plan and the build are checked against, each marked must or nice with its source, acceptance criteria (AC ids) that each prove a requirement, scope, non-goals and assumptions.
---

# Product requirements

The requirements say what is being built and how anyone will know it is
done. The build plan is written against them and the built app is checked
against them. You write them as the product owner: start from what the
brief asks, built the chosen approach's way inside the constraints, and add
what a person would expect on the first day of using a shipped product in
this category: the information, actions, states and details they would
miss if absent.

## Sections, in order

1. `## In short`: two to four one-line bullets: what the first version does,
   the count of must requirements, the decisions you made that the person
   should check. **Bold the words that carry the meaning.**
2. `## Purpose`: one paragraph on what the app is for, in new words.
3. `## Users`: each group and what they need from the app.
4. `## Scope`: what the first version covers.
5. `## Non-goals`: what it leaves out, each with its reason.
6. `## Functional requirements`: `FR-n`, what the app does.
7. `## Non-functional requirements`: `NFR-n`, how well it does it: speed,
   privacy, accessibility, reliability.
8. `## Interface requirements`: `IR-n`, each screen a person uses and each
   outside service or data source the app talks to.
9. `## Acceptance criteria`: `AC-n`, each a check naming the requirement it
   proves.
10. `## Assumptions`: each gap you decided, one correctable line each.
11. `## Sources`: the documents you drew on, by title.

## What makes it good

- Each requirement is one testable sentence that stands on its own, then
  `Must` or `Nice`, then its source in a short clause: the person's words,
  the brief, the constraints, the chosen approach, or your product
  judgement.
- Say what the app does; the build plan says how.
- Name real data sources and formats where they matter. The app runs on
  real data, and loading it is a requirement.
- Give every must an acceptance criterion.
- A revision keeps the ids of what it keeps and gives anything new the next
  number.
- Bring new information: the reader has the brief, so each line adds
  something it does not say.

`read_skill product-requirements file reference/exemplar.md` shows the
shape.
