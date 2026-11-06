---
name: operate-corbits-builder
description: Drives a running Builder (Corbits Builder) through its HTTP API, from creating or resuming a project and talking with its coordinator to handing document approvals to the person and downloading the built app. Use whenever someone asks you to start a Builder project, check on one, answer its questions, read its documents, fetch its app from a Builder server or import a directory or git repository into Builder as a project, even if they only give a project link or name. To install Builder first, use corbits-builder-install.
---

# Operate Builder

## Reference

The hub serves its OpenAPI document at `GET /openapi.json`; read it for any
route below. `createProductApiClient` from `@corbits-builder/client` wraps every
operation, and
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
   the run stream, deduplicating by run and sequence. Answer the coordinator's
   questions with the same mail route.
5. **Read documents.** Read each artifact at its exact version and content
   hash. Earlier versions stay readable; a missing source or grant means the
   document is unavailable to you.
6. **Hand off review.** Give the person the approval, the exact document
   version and hash it covers, and how to decide it. After they decide, read
   the recorded decision. A changed version needs a fresh review; the
   workflow resumes on its own once the approval is decided.
7. **Let the coordinator build.** Ask the coordinator to continue; it starts
   the coder after the build plan is approved. Follow progress in the
   conversation and the live app status.
8. **Retrieve the app.** `GET P/app/archive?version=<n>` downloads the app's
   source as a zip (the latest when `version` is absent).
   `GET P/export/archive?sections=planning,design,build` exports the project:
   every document, the design and the app.

## Import a directory

When the person hands you a directory to import, most often a git repository,
import it as if Builder had made the project itself: the code as the app and
each of Builder's documents in place, so the coordinator and the coder pick it
up where Builder would have left it. Builder's documents, in order:
`problem_brief`, `constraints`, `approaches`, `product_requirements`, `design`,
`build_plan`, then `app`. The import route
(`POST /api/tenants/:tenantId/projects/import`, `importProject` in the client)
takes a `corbits-builder.project` file, files each document as
version 1 and records the importing person's approval of each one marked
approved.

1. **Read the directory.** From the Builder checkout, run
   `bun run import:repo <directory>` (`scripts/import-repo.ts`). It writes
   `<name>.project.json` and reports: the title it chose, each document it
   found and where (an unpacked export's `project.json` and `planning/`,
   `docs/<kind>.md`, a coder workspace's `.inputs/` and `.builder/`), the app
   (the files git holds under the first directory with a `package.json`, less
   secrets, dependencies and build output),
   the documents still missing, and what the app lacks that Builder's own apps
   have (the `dev`, `build` and `typecheck` scripts, a `bun.lock`). Exit code 2
   means something is missing; `--help` lists the options. Never run it from
   inside the directory you import, and never write into that directory.
2. **Learn the project before drafting.** Read what the directory says about
   itself: its README and docs, `package.json`, the code's layout, and
   `git log` for how it was built. What the code cannot tell you, such as who
   the app is for, its budget and bounds, and what done looks like, is the
   person's to say: ask them, in one round of questions, rather than invent it.
3. **Draft each missing document the way Builder's own writers do.** Each
   kind has a skill describing its sections and shape in
   `workflows/writer/skills/<name>/SKILL.md` (`problem-brief`, `constraints`,
   `approaches`, `product-requirements`, `build-plan`), with finished examples
   under `test/seed/*/docs` and a design under `test/seed/*/designs`. Write
   them from the project as it is: the approaches document records the way it
   was actually built as the recommended approach beside the alternatives set
   aside, the build plan says what is built and what remains, the design
   describes the screens the app really has. Put the drafts in a directory of
   their own outside the repository: `<drafts>/<kind>.md`, the approaches'
   comparison as `<drafts>/approaches.json` (an `ApproachesMeta` from
   `packages/schemas/src/approaches.ts`), the design as
   `<drafts>/design/DESIGN.md` and `<drafts>/design/designs/index.html` with
   its screens under `designs/screens/`, and files the app needs under
   `<drafts>/app/` (a `package.json` for an app with none, a `bun.lock` made
   with `bun install` in a copy). Draft a design only for an app with screens
   you can describe; otherwise leave it out and say that Builder's designer can
   make one later. An app that is not a Bun or Node project cannot run in
   Builder's sandbox: say so, and ask whether to import the documents without
   it.
4. **Get the person's approval of every draft.** Show each one by path with a
   short summary of what it claims, and the full text when they ask. For each,
   they choose: approve it as it stands, change it (then show it again), or
   leave it out. Mark approved only what they approved in so many words; a
   document they left out is Builder's to write later. Do not approve on their
   behalf.
5. **Write the file.** Run again with `--drafts <drafts>` and
   `--approve <kinds>` naming the kinds they approved (`--title`, `--exclude`
   and `--allow-missing` as needed) until the report lists nothing missing but
   what they chose to leave out. Read the warnings back to them: without a
   `bun.lock` the coder's `bun install --frozen-lockfile` fails.
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
