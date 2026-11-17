---
name: operate-corbits-builder
description: Drives a running Builder (Corbits Builder) through its HTTP API, from creating or resuming a project and talking with its coordinator to handing document approvals to the person and downloading the built app. Use whenever someone asks you to start a Builder project, check on one, answer its questions, read its documents, fetch its app from a Builder server or import a directory or git repository into Builder as a project, even if they only give a project link or name. To install Builder first, use corbits-builder-install.
---

# Operate Builder

## Reference

The hub serves its OpenAPI document at `GET /openapi.json`; read it for any
route below. `createProductApiClient` from `@corbits-builder/client` wraps the
operations the Builder interface uses, and
[DEV.md](https://github.com/corbitsdev/corbits-builder/blob/main/docs/DEV.md)
explains how the pieces fit.

Sign in with the account the person gives you:
`POST /api/auth/sign-in/email` with `{email, password}` returns a session
cookie. Send that cookie and `Origin: <hub origin>` on every call: the hub
checks that credentialed requests come from its own origin.

`P` below means `/api/tenants/:tenantId/projects/:projectId`.

Approvals belong to the person and are made from their own session.

## Procedure

1. **Inspect.** Read the signed-in identity and memberships, the project
   (`GET P`), its conversation (`GET P/conversation/events`), its documents
   (`GET P/artifacts`) and pending approvals, and decide whether this is new
   work or a resume. A 401 or 403 is an authority problem to report.
2. **Create when needed.** `POST P/mutations` for a new project id with
   command `create_project`, payload `{title, profile?, problemStatement?}`
   (`profile` is a model profile id, the creator's active profile when
   absent), and a saved `mutationId` and `idempotencyKey`. That call deploys
   the coordinator and mails it `problemStatement` as the first message. After
   a lost response, replay the same body with the same key.
3. **Send messages.** `GET P` returns the project's `tenantId` and
   `coordinatorRunId`. Send with
   `POST /api/tenants/:projectTenantId/workflows/runs/:coordinatorRunId/mail`
   and `{content, attachments?}`. A 202 means the mail is durably accepted, not
   that the coordinator has replied. Each send is a new message, so after a
   lost response read the conversation before sending again.
4. **Follow and answer.** Read the conversation events with bounded polling or
   the run stream, deduplicating by run and sequence. Its `questions` lists
   what the coordinator is waiting on, each by `signalName`: questions asked in
   words, or a plugin's screen (`asked.plugin` and `asked.action`), such as a
   font picker or a document approval. Answer one with
   `POST P/answers` and `{signalName, answer}`, where `answer` is the card's
   `{answers}`, a screen's `{output}`, or `{reply}` with the person's own
   words; the OpenAPI document gives each shape. A message mailed while a
   question is open waits until the coordinator's turn ends, so answer the
   question instead. `GET P/plan` shows the plan and where each step stands.
5. **Read documents.** Read each artifact at its exact version and content
   hash. Earlier versions stay readable; a missing source or grant means the
   document is unavailable to you.
6. **Hand off review.** A document approval, a design review or a choice
   between designs is a screen question that belongs to the person. Give them
   what it asks, the exact document version and hash it covers, and how to
   decide it in Builder, and let them answer from their own session. After
   they decide, read the recorded decision. The coordinator goes on by itself
   once the question is answered. If the person wants Builder to stop asking,
   that too is their answer, on the project plugin's `hand-over` screen.
7. **Let the coordinator work.** Ask the coordinator to continue; it starts
   each step of the plan once what the step waits for is true. Follow progress
   in the conversation, the plan and the live app status.
8. **Retrieve the app.** `GET P/app/archive?version=<n>` downloads the app's
   source as a zip (the latest when `version` is absent).
   `GET P/export/archive?sections=planning,design,build` exports the project:
   every document, the design and the app.

## Import a directory

When the person hands you a directory to import, most often a git repository,
import its code as the project's app, with any documents and design the
directory already keeps. Builder does not need a full set of documents: once
the project exists, the coordinator asks the person what they want and has
only the documents written that that work needs. The import route
(`POST /api/tenants/:tenantId/projects/import`, `importProject` in the client)
takes a `corbits-builder.project` file, files each document as version 1 and
records the importing person's approval of each one marked approved.

1. **Read the directory.** From the Builder checkout, run
   `bun run import:repo <directory>` (`scripts/import-repo.ts`). It writes
   `<name>.project.json` and reports the title it chose; each document it
   found and where (an unpacked export's `project.json` and `planning/`,
   `docs/<kind>.md`, a coder workspace's `.inputs/` and `.builder/`); the app
   (the directory's files, less dependencies, build output and whatever its
   `.gitignore` files leave out); and files you may want to leave out, those
   whose names suggest a secret and lockfiles of package managers Builder does
   not use. It also lists each kind of document it did not find, from
   `problem_brief`, `constraints`, `approaches`, `product_requirements`,
   `design`, `build_plan` and `app`, and exits with code 2 unless you pass
   `--allow-missing`. A kind on that list is only absent, not required.
   `--help` lists the options. Never run it from inside the directory you
   import, and never write into that directory.
2. **Learn the project before drafting.** Read what the directory says about
   itself: its README and docs, its manifest files, the code's layout, and
   `git log` for how it was built. What the code cannot tell you, such as who
   the app is for, its budget and bounds, and what done looks like, is the
   person's to say: ask them, in one round of questions, rather than invent it.
3. **Draft only the documents the person wants now.** Ask what they mean to do
   next. If it needs a document the directory lacks, such as requirements for a
   new feature, draft it the way Builder's own writers do: each kind has a
   skill describing its sections and shape in
   `plugins/writer/skills/<name>/SKILL.md` (`problem-brief`, `constraints`,
   `approaches`, `product-requirements`, `build-plan`), with finished examples
   under `test/seed/*/docs` and a design under `test/seed/*/designs`. Write
   from the project as it is: the build plan says what is built and what
   remains, the design describes the screens the app really has. Put the
   drafts in a directory of their own outside the repository:
   `<drafts>/<kind>.md`, an approaches comparison as `<drafts>/approaches.json`
   (an `ApproachesMeta` from `packages/schemas/src/approaches.ts`), a design as
   `<drafts>/design/DESIGN.md` and `<drafts>/design/designs/index.html` with
   its screens under `designs/screens/`, and files the app needs under
   `<drafts>/app/`. Anything you do not draft, the coordinator has written
   with the person later, when the work needs it.
4. **Get the person's approval of every draft.** Show each one by path with a
   short summary of what it claims, and the full text when they ask. For each,
   they choose: approve it as it stands, change it (then show it again), or
   leave it out. Mark approved only what they approved in so many words. Do not
   approve on their behalf.
5. **Write the file.** Run again with `--drafts <drafts>`, `--approve <kinds>`
   naming the kinds they approved, and `--allow-missing` (`--title` and
   `--exclude` as needed). Read the warnings back to them.
6. **Import on their word.** Tell them what the file holds: the title, each
   document and whether it is approved, the app's file count and size. On their
   go-ahead, send the file as the JSON body of the import route with the
   session cookie and `Origin` header; a 400 names the invalid field, a 413 the
   size. The receipt's `projectId` is the new project. The person can also pick
   the file themselves with **Import project** on the new-project page, or
   skip the drafting and pick the folder itself with **Import a folder**,
   which reads it the same way in the browser and leaves the missing
   documents to the coordinator to write with them. Then
   follow the procedure above from step 1: the coordinator's first message
   acknowledges the import and says what the documents establish.
