---
name: operate-corbits-builder
description: Drives a running Builder (Corbits Builder) through its HTTP API, from creating or resuming a project and talking with its coordinator to handing document approvals to the person and downloading the built app. Use whenever someone asks you to start a Builder project, check on one, answer its questions, read its documents or fetch its app from a Builder server, even if they only give a project link or name. To install Builder first, use corbits-builder-install.
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
