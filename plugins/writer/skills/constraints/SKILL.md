---
name: constraints
description: Use when writing or revising a constraints document - the bounds every later document and the build stay inside - solution form, platforms, people and scale, data sources, privacy and accessibility, outside services, budget and timeline, what the first version includes, with reasons for each exclusion.
---

# Constraints

Constraints draw the fence the app is built inside, not the building. Every
later document and the build stay within them, so each bound is concrete
enough to check a design or a plan against.

## Sections, in order

1. `## In short`: two to four one-line bullets with the bounds that shape
   the app most: its form, its audience and scale, its hardest limit.
   **Bold the words that carry the meaning.**
2. `## Solution form`: the form the app takes (hosted web, mobile, desktop,
   command line, an API) and, for each form left out, the reason.
3. `## Platforms and devices`: where it runs and what people use it on.
4. `## People and scale`: who uses it, how many, and the tools they already
   have.
5. `## Data sources`: where the real data comes from, how it arrives, and
   where it is kept. The app runs on real data, so name each source.
6. `## Privacy and accessibility`: who may see what, what stays private,
   and the accessibility level it meets.
7. `## Outside services and accounts`: each service it connects to and the
   account or credential the person provides.
8. `## Budget and timeline`: the agent's time and cost to build, the
   running cost, and any date the person named.
9. `## First version and later`: what the first version includes and what
   waits, each with its reason.
10. `## Assumptions`: each bound you set where the documents left it open,
    one correctable line each. Every technical choice is settled here with
    your pick and its reason: standards such as the accessibility level,
    libraries, data providers, location services, hosting.
11. `## Open questions`: the person's own answers still missing: their
    budget, the devices they use, their dates, who may see what, how it
    should feel. Most important first, each with your recommendation;
    "None" when the documents already answer these. A choice settled under
    Assumptions stays there alone. Each one here is also one of
    write_artifact's openQuestions.

## What makes it good

- State each bound as a fact with its number or name: "fewer than 50
  members", "phones and desktop browsers", "Stripe, through your account".
- Give each bound its reason and source in the same sentence, in passing:
  "(your message)", "(the brief)", "(the uploaded price list)". A bound you
  set yourself goes under Assumptions.
- Write a section as one tight paragraph or a few bullets, to the person as
  "you", and only the sentences that change what they think or decide.
- Draw the fence and leave the architecture to the approaches document.

`read_skill constraints file reference/exemplar.md` shows the shape.
