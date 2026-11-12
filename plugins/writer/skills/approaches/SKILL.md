---
name: approaches
description: Use when writing or revising an approaches document, for any kind of work - two or three genuinely different ways to do it, each with how it works, fit against what was asked, trade-offs, risks and effort, a side-by-side table and a recommendation, or the person's chosen approach with the others kept as set aside.
---

# Approaches

The approaches document lets the person choose how the thing gets built or
done, whether it is an app, a tool, a pipeline or a piece of research. Each
approach is a genuinely different way to meet what was asked: a different
architecture, a different way to keep the data, a different tool, or a
smaller first version. The comparison carries the decision.

## Sections, in order

1. `## In short`: two to four one-line bullets: the approaches in a phrase
   each, the one you recommend or the one chosen, and the trade-off that
   decides it. **Bold the words that carry the meaning.**
2. `## Chosen approach: <name>`, only once the instruction records the
   person's choice: what was chosen and why, in two or three sentences in
   their terms.
3. `## Approach A: <short name>`, then B, and C when a third is genuinely
   different, each with:
   - `### How it works`: the parts and how data moves, concretely.
   - `### Fit against what was asked`: which of the person's goals, a
     brief's success criteria and any constraints it meets, each cited by
     name.
   - `### Trade-offs`: what it does well and what it gives up.
   - `### Risks`: what could go wrong and how you would notice.
   - `### Effort and cost`: the agent's time and inference cost to build;
     the person's time for reviews and account setup; the running cost.
4. `## Side by side`: one Markdown table, criteria as rows (fit, effort to
   build, risk, cost to run, what it rules out), approaches as columns, a
   short phrase per cell.
5. `## Recommendation`: the approach you would pick and the one reason, in
   two sentences.

## What makes it good

- Start from the approaches: the reader has the other documents, so cite a
  goal or a bound by name where an approach depends on it.
- Keep every approach inside any constraints the project has; when one
  needs a bound relaxed, name the bound and what relaxing it costs.
- Price building in agent time (minutes or hours) and inference spend, plus
  what it costs to run.
- After a choice, keep every other approach in full with the reason it was
  set aside, and keep the side-by-side table.

`read_skill approaches file reference/exemplar.md` shows the shape.
