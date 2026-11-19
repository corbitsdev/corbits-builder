---
name: codes
description: Use when a Cloudflare tool answers ok false - what each code means, which ones you may act on, and what to tell the person in plain words.
---

# What each code means

Every failed tool answer carries one `code`, and nothing else about Cloudflare reaches you, so explain only what the code says. Speak of "Cloudflare", "your Cloudflare account" and "your app's address", never of workers, scripts, APIs or databases by their technical names.

The person never does anything technical. Every reason you give points them to their Cloudflare dashboard, Builder's Publish to Cloudflare screen, the Publish tab or asking Builder to change the app, or says they can try again later.

A publish is blocked when the code leaves the app unpublished; a take-down is blocked when the code leaves the app up. Report either with report_blocked: the person reads its reason as the explanation, so write it in one or two sentences, without the code. Suggest the Publish to Cloudflare screen only where this skill says it is the fix. In `tried`, say which tools you ran.

Retry `cloudflare_release` at most once. Each acceptance of Cloudflare's terms makes at most one temporary account: once one is made, the acceptance is used up, and `cloudflare_release` answers `no_account_chosen` until the person accepts again on the Publish to Cloudflare screen or saves a token.

## A temporary account the app did not reach

When a release fails after Builder made a temporary Cloudflare account, the answer carries `emptyTemporaryAccount`, and the person's acceptance of Cloudflare's terms is used up: to publish again without an account, they accept the terms again on the Publish to Cloudflare screen. Say so plainly, after the cause.

- `emptyTemporaryAccount: "keepable"`: the account is in the project and the Publish tab shows how to keep it, but nothing is published in it. They can keep it from the Publish tab and then add a token for it on the Publish to Cloudflare screen, so the next publish goes there, or leave it for Cloudflare to remove.
- `emptyTemporaryAccount: "unreachable"`: not even the link to keep the account reached the project, so it is out of their reach and Cloudflare removes it. There is nothing for them to do.

## The app

- **not_publishable**: the app does not say how it is built for production. Builder can add that to the app before they publish again.
- **app_not_saved**: the project has no saved app. It must be built first.
- **not_fitted**: the app is not made to run on Cloudflare yet, its settings for Cloudflare ask for something Builder does not set up, or its build did not make the files those settings name. Builder changes the app to run on Cloudflare, then they publish again.
- **app_changed**: the app was saved again while it was being published, so nothing went out. Publishing again picks up the version saved now.
- **install_failed**, **build_failed**: the app's packages did not install, or the app did not build, from a clean copy. That is the app's own doing; Builder should fix the app so it installs and builds, then they publish again. Nothing changed for visitors.
- **build_timed_out**: building the app took longer than Builder allows. Builder should check why the build is slow; trying again later may also pass.
- **too_large**: the app is too big for Cloudflare. `limit` says which bound: `files`, more than `maxFiles` files; `file_size`, a file over `maxMb` MB; `worker_size`, the app's own code over what the account takes (`maxMb` MB compressed, when given); `build_size`, more than Builder hands over from one build. Builder should make the app smaller, for instance by taking out large images or videos, then they publish again.
- **migration_misnamed**: a file among the app's database changes has a name publishing does not take: only letters, digits, dashes, underscores and dots, ending in .sql, as the Workers skills say. Nothing was published. Builder renames the file, then they publish again. The ready check could not see this, so give this as the cause; do not say the app is not ready.
- **migration_failed**: a change to the app's stored data, the file `migration`, did not apply. Nothing visitors see changed. The app is Builder's to fix, then they publish again.
- **worker_refused**: Cloudflare would not start the app's code. The app is Builder's to fix so it runs on Cloudflare; nothing visitors see changed.

## Builder

- **builder_unavailable**: Builder itself could not hand the app over or record the result; nothing is wrong with Cloudflare. `cloudflare_status` and `cloudflare_unpublish` may be tried once more, and `cloudflare_release` as the retry above allows. If it keeps happening, say that publishing, or taking the app down, stopped because of a problem with Builder and that they can try again later.
- **builder_busy**: Builder is already building or checking this app. Say that publishing can start again in a few minutes.

## The account

- **no_account_chosen**: there is neither a saved Cloudflare token nor an acceptance of Cloudflare's terms from the last hour. The fix is the Publish to Cloudflare screen, where they choose.
- **key_refused**: Cloudflare refused the saved token. With `permission`, the token lacks that permission; without it, the token no longer works, for instance because it expired or was deleted. Either way, tell them to make a token in their Cloudflare dashboard with Workers Scripts Edit, D1 Edit and Account Settings Read, and save it on the Publish to Cloudflare screen. This is the one code where saving a token again is the fix.
- **several_accounts**: the saved token reaches more than one Cloudflare account, and Builder does not choose for them. Tell them to make a token for just the account the app should go in and save it on the Publish to Cloudflare screen.
- **no_subdomain**: their Cloudflare account has no workers.dev address yet. Tell them to open Workers & Pages in their Cloudflare dashboard once, which sets one up, then to ask to publish again.
- **name_taken**: their Cloudflare account already has another app under this app's name, which Builder will not replace. Builder can change the app's name at Cloudflare, or they can delete the other app in their dashboard.
- **account_not_created**: Cloudflare refused to make a temporary account just now, most often because it limits how many it makes. Nothing was made, and the person's acceptance of Cloudflare's terms still stands until an hour after they gave it. Say they can try again later, when they may be asked to accept Cloudflare's terms again, or use their own Cloudflare account on the Publish to Cloudflare screen.
- **database_not_created**: Cloudflare would not make the app's database.
  - Without `emptyTemporaryAccount`, in their own account: their account may already hold a database of the same name, or as many databases as their plan allows. They can delete one they no longer need in their Cloudflare dashboard, or Builder can rename the app's database; then they publish again.
  - With `emptyTemporaryAccount`, in the temporary account Builder just made: that account is new and empty, so neither cause above applies, and Builder already waits for a new account to be ready. The refusal is Cloudflare's doing, not the app's, and nothing Builder or the person changes fixes it. Say they can try again later, accepting Cloudflare's terms again, or publish with their own Cloudflare account on the Publish to Cloudflare screen.
- **cloudflare_unavailable**: Cloudflare could not be reached, answered in a way Builder did not expect, or refused a step of the publish, such as the upload of the app's files or, in a temporary account, access to the new account. Say publishing did not finish and that they can try again later.

## After the upload

- **not_answering_yet**: the app is published at `url` and the publish is recorded, but its address did not answer within two minutes; Cloudflare can take a little longer to start serving an app. This is not blocked, so never report it with report_blocked. Finish with your reply: it is published at that address, it may take a little longer to start answering, and they can ask to check again shortly. You may run `cloudflare_status` once to see whether it answers now. With `keepWithinMinutes`, the app is in a temporary account: they still keep it from the Publish tab within that many minutes, or Cloudflare removes it.

## Taking it down

- **needs_own_account**: taking the app down needs their own Cloudflare account and a saved token. If `temporary` is true and they never kept the app, Cloudflare removes it by itself once the time to keep it runs out, so there may be nothing to do; if they kept it, they delete it in their Cloudflare dashboard, under Workers & Pages, or save a token for that account and ask again.
- **other_account**: the saved token reaches a different Cloudflare account from the one the app is in. They delete it in the dashboard of the account that holds it, or save a token for that account on the Publish to Cloudflare screen.
- **not_published**: nothing was published to Cloudflare from this project.
- **not_agreed**: the person has not agreed on the take-down screen to take down what is published on Cloudflare now: they were not asked, kept it, or the app was published again since. Nothing was taken down. Builder asks them on the take-down screen again.
- If the person says Cloudflare already removed the app with a temporary account they never kept, the Publish tab lets them say it is gone, which clears what Builder recorded.
