---
name: product-requirements
description: Use when writing or revising product_requirements for anything being built - a web or mobile app, a command-line tool, an API or library, a data job - the testable requirements (FR, NFR, IR ids) a build plan and the build are checked against, each marked must or nice with its source, acceptance criteria (AC ids) that each prove a requirement, scope, non-goals and assumptions.
---

# Product requirements

The requirements say what is being built and how anyone will know it is
done. A build plan is written against them and what gets built is checked
against them. They fit anything being built: a web or mobile app, a
command-line tool, an API or library, a data pipeline, an integration. You
write them as the product owner: start from what the person asked for and
whatever the project already holds, such as a brief, constraints, a chosen
approach or existing code, and add what a person would expect on the first
day of using a finished product of this kind: the information, actions,
states, errors and details they would miss if absent.

## Sections, in order

1. `## In short`: two to four one-line bullets, written for the person
   deciding whether to approve, who may read nothing else: what they will
   be able to do with the first version, in their own terms; what it leaves
   out that they might expect; and each decision you made for them that
   they could disagree with. Every bullet is specific to this project: no
   counts of requirements or sections, nothing about the document itself,
   nothing that would be true of any project. **Bold the words that carry
   the meaning.**
2. `## Problem`: the problem in one tight paragraph in the person's words,
   what they do about it today and where that fails, and what a fix is
   worth to them, with their numbers where they gave any.
3. `## Users`: each group of people, or each system, that uses it, what
   they need from it, and roughly how many.
4. `## Success`: the few checks a person could run against the finished
   thing to say it solved the problem.
5. `## Bounds`: one line each for the form it takes and the forms left out,
   where it runs, where its real data comes from and is kept, who may see
   what, each outside service or account it needs from the person, and any
   budget or date they named.
6. `## Approach`: the way of building it you chose and why in two or three
   sentences, then each real alternative in one line with what it would
   have given up.
7. `## Scope`: what the first version covers and what waits for later.
8. `## Non-goals`: what it leaves out, each with its reason.
9. `## Functional requirements`: `FR-n`, what it does.
10. `## Non-functional requirements`: `NFR-n`, how well it does it: speed,
    reliability, privacy and security, compatibility with the platforms and
    versions it must run on, and accessibility where people use it directly.
11. `## Interface requirements`: `IR-n`, when the thing has an interface, as
    almost everything does: each screen a person uses when it has screens,
    each command, option and output when it runs at a command line, each
    endpoint or public function when other code calls it, and each outside
    service, file format or data source it reads or writes.
12. `## Acceptance criteria`: `AC-n`, each a check naming the requirement it
    proves: what someone does and what they then see or get.
13. `## Assumptions`: each gap you decided, one correctable line each. Every
    technical choice the person left open is settled here with your pick
    and its reason.
14. `## Open questions`: only when a must depends on an answer only the
    person can give, most important first, each with your recommendation.
    Each one here is also one of write_artifact's openQuestions.
15. `## Sources`: the documents and material you drew on, by title, or the
    person's request when nothing is filed.

Problem, Success, Bounds and Approach are what a brief, constraints and
approaches would have settled. A build goes wrong when nobody settled them,
so when the project holds none of those documents, settle them here in
full. When one is filed, give its conclusion in a line and name it; do not
repeat it.

## What makes it good

- Each requirement is one testable sentence that stands on its own, then
  `Must` or `Nice`, then its source in a short clause: the person's words,
  a filed document by its title, or your product judgement.
- Say what it does; the build plan says how.
- Use the words of the thing being built: screens and taps for an app with
  screens, commands, output and exit codes for a command-line tool,
  requests and responses for an API, inputs, outputs and schedules for a
  data job.
- Name real data sources and formats where they matter. It runs on real
  data, and getting that data in is a requirement.
- Give every must an acceptance criterion.
- A revision keeps the ids of what it keeps and gives anything new the next
  number.
- Bring new information: the reader has the documents you drew on, so each
  line adds something they do not say.

`read_skill product-requirements file reference/exemplar.md` shows the
shape for a web app, and `reference/exemplar-cli.md` for a command-line
tool; follow the one closer to what is being built.
