# Builder: product

What Builder is, who it is for and how a person uses it. How it is built is in
[ARCHITECTURE.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/ARCHITECTURE.md)
and
[IMPLEMENTATION.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/IMPLEMENTATION.md);
the screen-by-screen guide is the
[user manual](https://github.com/corbitsdev/corbits-builder/blob/main/docs/USER_MANUAL.md).

## What it is

Builder turns an idea into a working web app. A person describes what they
want in plain words. A coordinator agent talks it through with them, has
specialist agents write a short set of planning documents, design the screens
and build the app, and asks the person for every decision that is theirs to
make. The person ends with approved documents, a design they chose and the
app's source, which runs in the browser while it is being built.

## Who it is for

Anyone who wants to build an app. Builder needs no technical knowledge: a
small business owner, a team lead or a hobbyist answers questions about what
they need, never about frameworks or hosting. Engineers use it too, for a
planned, designed first version with the reasoning written down.

Builder is installed and run by whoever operates it, on their own machine or
server. People sign in, work in shared workspaces and connect the model
provider of their choice.

## Why it is worth using

- **The person stays in charge.** Agents recommend; only the person approves.
  Each approval names the exact version of what it covers, so nothing changes
  under it afterwards.
- **The thinking is kept.** The brief, the limits, the options weighed, the
  requirements and the plan are documents the person can read, compare across
  versions, download and change.
- **They see the app as it is built.** The app runs live in the workspace
  from the coder's first change, and its acceptance checklist shows how much
  is done.
- **It is theirs.** Documents, the design and the app's code download at any
  time. A whole project exports to one file and imports again.
- **No lock-in to one model vendor.** Every role runs on any supported
  provider.

## The flow

The coordinator decides the order of work from what exists and what the person
says; there is no fixed sequence of screens. A typical project goes:

1. **Idea.** The person types or dictates what they want built, and may attach
   files for the coordinator to read.
2. **Questions.** The coordinator interviews them, matching depth to what they
   brought: a bare idea gets brainstorming, a detailed request gets its limits
   confirmed. Several decisions at once arrive as a question card with options
   and a recommended answer preselected.
3. **Documents.** Each builds on the ones before it:
   - the **problem brief**: who it is for, what it must do and what done looks
     like, written by the coordinator;
   - the **constraints**: budget, devices, data and privacy, timeline, outside
     services and what the first version includes;
   - the **approaches**: two or three ways to build it, with trade-offs and one
     recommended;
   - the **product requirements**: what the app does for whom, built the chosen
     way.
4. **Approaches.** The person compares the approaches side by side and picks
   one. A pick that differs from the recommendation is recorded in the
   document.
5. **Requirements.** Written once the approach is chosen.
6. **Design.** The coordinator asks whether they want one suggested design or
   several looks to compare, and whether they have a look in mind. Ready-made
   themes can be clicked through before any design exists. Each concept is a
   clickable mockup of every screen, with light and dark modes, desktop and
   phone views, and simple tweaks (colour, background, corners, font). The
   person confirms one concept, and that choice is the design approval.
7. **Build plan.** Written from the chosen approach and design: the stack, the
   order of work and the acceptance checklist.
8. **Live build.** One coder builds the whole app. The workspace shows the
   running app, its progress against the checklist and what each agent is
   doing. The person tries the app and asks for changes in the conversation;
   each change goes to the coder only after they approve it.
9. **Download.** The app's source as a zip, each document as Markdown or PDF,
   the design, or the whole project as an export.

## Approvals

- Only a person approves. An agent's recommendation is never an approval, and
  a reviewer agent's findings are advice to the coordinator.
- An approval covers exact versions. A document changed afterwards needs
  approval again, and the next document's writer starts only from approved
  versions.
- The person approves each planning document, the start of design work (or
  every later start in that project, once they say so), the design (by
  choosing it), every change sent to the coder and, unless they turn this off,
  each new package the coder wants to add.
- One approval card can cover several documents at once.
- A person may let documents go ahead once written; the coordinator then tells
  them about each one instead. Starting the design, choosing it and sending
  changes to the coder still ask.

## Questions

- Open questions are asked as questions, never folded into an approval. A card
  holds up to five, each single or multiple choice, with room for the person's
  own answer.
- A document can list the open questions it leaves. By default it reaches the
  person for approval only once those are answered.
- Specialists never ask the person directly. A question only the person can
  answer goes to the coordinator, which asks it.

## Working the way the person wants

Preferences set how much Builder asks, how long and how technical its replies
are, how many design concepts to compare, how picky reviews are, whether
documents need approval, whether package installs ask, whether the build may
reach the internet beyond the package registry, and whether each project shows
a "what's next" line. What the person says in the conversation wins over these.
A project keeps the preferences its creator had when it started.

## Models

The person connects a model provider with an API key or a subscription sign-in.
A profile assigns a model and effort to each of four tiers, and each role runs
on one tier. Ready-made profiles exist for each provider, and people can make
their own. A project keeps the profile it started with.

## Out of scope today

- Apps other than browser web apps: native phone apps, desktop apps and browser
  extensions. The coordinator says what it can make instead.
- Hosting or deploying the built app. The person downloads its source.
- Talking to a specialist directly; everything goes through the coordinator.
  Direct conversations with the designer and app builder are planned.
- Spend tracking, stakeholder sign-off and reviews of the built app are
  planned, not built.
