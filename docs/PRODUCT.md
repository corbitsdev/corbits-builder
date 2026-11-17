# Builder: product

What Builder is, who it is for and how a person uses it. How it is built is in
[ARCHITECTURE.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/ARCHITECTURE.md)
and
[IMPLEMENTATION.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/IMPLEMENTATION.md);
the screen-by-screen guide is the
[user manual](https://github.com/corbitsdev/corbits-builder/blob/main/docs/USER_MANUAL.md).

## What it is

Builder builds, writes or changes what a person asks for: a web app, a
command-line tool, a library, a document, a piece of research, an analysis, or
a small change to something that already exists. The person talks to one
assistant, the coordinator. It works out what they want, brings in the
specialists the work needs (a writer, a designer, a coder, a presenter, a
worker for research and questions, an analyst for numbers) and asks the person
for every decision that is theirs to make.

There is no fixed path. A rough idea for an app gets requirements, a design and
a build plan before anything is built; a request to change a font gets a font
picker and then the change. What happens depends on what was asked.

## Who it is for

Anyone who wants something built or written. Builder needs no technical
knowledge: a small business owner, a team lead or a hobbyist answers questions
about what they need, never about frameworks or hosting. Engineers use it too,
for a planned, designed first version with the reasoning written down, or to
hand off a change to code they already have.

Builder is installed and run by whoever operates it, on their own machine or
server. People sign in, work in shared workspaces and connect the model
provider of their choice.

## Why it is worth using

- The person stays in charge. Agents recommend; only the person approves.
  Each approval names the exact version of what it covers, so nothing changes
  under it afterwards. A person who would rather not be asked can hand their
  approvals over, and take them back at any time.
- The work fits the request. A small change stays small: nothing makes it pass
  through documents or a design it does not need.
- The thinking is kept. Requirements, plans and any other document are files
  the person can read, compare across versions, download and change.
- They see it as it is built. A web app runs live in the project from the
  coder's first change.
- It is theirs. Documents, the design and the code download at any time. A
  whole project exports to one file and imports again.
- No lock-in to one model vendor. Every role runs on any supported provider.

## How the work goes

The person types what they want, and may attach files. The coordinator asks
what it needs to know, matching depth to what they brought, and lays out a plan
beside the conversation: the steps it intends, each marked done, running,
waiting, needing them, failed or skipped as the work goes on. The plan is
worked out from what has actually happened, so it never says a step is done
when it is not.

For an idea for a web app, the usual plan is:

1. Requirements. A writer writes what the app does and for whom, from what
   the person said. The coordinator puts the open questions that are theirs to
   them and has the requirements revised with their answers.
2. Design. The person chooses whether to see one design or compare several
   looks. Each design is a clickable mockup of every screen, in light and dark,
   on desktop and phone, made from one of five themes or a look of the
   person's own. They review it full screen, pin comments to places in it and
   approve it or send it back, or choose one of several.
3. Build plan. Written from the requirements and the design: the stack, the
   order of work and the acceptance checklist.
4. Build. One coder builds the app. The project shows the running app and
   what each specialist is doing. The person tries it and asks for changes in
   plain words.
5. User manual, if the person wants one.

Anything else gets a plan the coordinator writes for it. A command-line tool
goes to the coder with the plan it needs; research goes to the worker; a
presentation to the presenter. A small, exactly stated change to something
built, such as a colour, a label or a bug fix, goes straight to the coder. A new
feature or a substantial change first gets revised requirements and a build
plan the person approves, then the change.

When a decision has a screen made for it, the person gets that screen: a font
or colour picker, a document to approve, a design to review, a choice between
designs, or how many looks to compare. Whatever is on screen, they can type a
sentence instead, and that is their answer.

## Approvals

- Only a person approves. An agent's recommendation is never an approval, and
  a reviewer agent's findings are advice to the coordinator.
- An approval covers exact versions. A document changed afterwards is put to
  the person again when the coordinator judges it needs it, and work that
  builds on a document uses the version they approved.
- By default the person approves documents before the work that builds on
  them, and the design by approving or choosing it. In the usual web app plan
  the design waits for the requirements, and the build waits for the build
  plan and the design.
- Saying "just build it" offers to hand approvals to Builder. With approvals
  handed over, each step starts as the one before it files its work, and the
  coordinator tells the person what was filed instead of asking. A step a plan
  marks as required still waits for the person's own approval.
- Unless the person turns it off, each package the coder wants to add that no
  approved build plan names asks first.

## Questions

- Open questions are asked as questions, never folded into an approval. A card
  holds up to five, each single or multiple choice, with room for the person's
  own answer.
- A document can list the open questions it leaves. By default it reaches the
  person for approval only once those are answered.
- Specialists never ask the person directly. A question only the person can
  answer goes to the coordinator, which asks it; the rest it settles with an
  assumption it states.

## Working the way the person wants

Preferences set how much Builder asks, how long and how technical its replies
are, how many design concepts to compare, what reviews raise, whether documents
need approval, whether open questions are answered before approval, whether
package installs ask, whether the build may reach the internet beyond the
package registry, and whether each project shows a next step line. What the
person says in the conversation wins over these. A project keeps the
preferences its creator had when it started.

## Models

The person connects a model provider with an API key or a subscription sign-in.
A profile assigns a model and effort to each of four tiers, and each role runs
on one tier. Ready-made profiles exist for each provider, and people can make
their own. A project keeps the profile it started with.

## Out of scope today

- Previewing anything that does not open in a browser. A command-line tool, a
  bot or a library is built and checked, but there is no way to try it inside
  Builder.
- Hosting or deploying what was built. Builder can check that an app is ready
  for Cloudflare Workers and routed to a domain; the person publishes it and
  downloads its source.
- Talking to a specialist directly; everything goes through the coordinator.
- Spend tracking and reviews of the built app.
