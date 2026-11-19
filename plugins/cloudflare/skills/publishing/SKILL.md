---
name: publishing
description: Use when reporting a publish to Cloudflare, a status or a take-down - the address people open, keeping an app published without an account, and what the person should know about data and later changes.
---

# Reporting a publish

A reply names what happened and the address people open, never a version, an account, an id, a time or a link. A successful `cloudflare_release` has already recorded the publish in the project.

- **The address.** People open the app at the `url` the release answers with, on Cloudflare's network, over HTTPS, such as `https://my-app.example.workers.dev/`. It is the app's own address; Builder does not set up a domain of the person's own. Always give it with `https://`, exactly as the release answers: Cloudflare answers the same address over plain `http://` with an error, not a redirect.
- **Without an account: keep it.** When the release answers with `keepWithinMinutes`, the app is in a temporary Cloudflare account. Say plainly that they keep it from the Publish tab within that many minutes, by signing in to Cloudflare or creating a free account there, or Cloudflare removes the app. The link that keeps it is in the Publish tab; you never have it.
- **Publishing changes later.** Once an app was published without an account, publishing changes to it needs their own Cloudflare account: they keep the app first, then save a token for that account on the Publish to Cloudflare screen. Publishing again without an account puts a new copy at a new address, and the earlier one can then no longer be kept from Builder.
- **What people entered stays.** Each publish keeps what people entered in the app, and applies only new changes to how it is stored.
- **A first publish of an app with sign-in.** Tell the person to open the address straight away and create their own account, before anyone else can.
- **Status.** `state` is `answering`, `not_answering` or `not_published`: say the address answers, does not answer right now, or that nothing was published to Cloudflare. A record says what was published, not that Cloudflare still serves it, and Builder cannot tell whether Cloudflare removed an app that was never kept, so never call an app live or up from a record alone.
- **Taken down.** After `cloudflare_unpublish` the address no longer answers and Builder no longer counts the app as published. With `databaseKept`, what people entered is kept in their Cloudflare account, and publishing again brings the app back with it.
