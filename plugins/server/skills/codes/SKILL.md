---
name: codes
description: Use when a server tool answers ok false - what each code means, which ones a second try can fix, and what to tell the person in plain words.
---

# What each code means

Every failed tool answer carries one `code`, and nothing else about the server reaches you, so explain only what the code says. Speak of "your server" and "your hosting provider", never of commands, SSH or systemd.

The person never works inside their server: no commands, files, paths or logs, and never fetching or pasting anything from it. Every reason you give points them to their hosting provider's control panel, Builder's "Connect your server" screen or asking Builder to change the app, or says they can try again later.

A publish is blocked when the code leaves the app unpublished and the second try this skill names, if any, does not fix it. A take-down is blocked when the code leaves the app up. Report either with report_blocked: the person reads its reason as the explanation, so write one or two sentences from what this skill says to tell them, without the code. In `tried`, say which tools you ran.

## Reaching the server

- **unreachable**: the server did not answer at the address the person gave. It may be switched off or still being set up by the provider, or the address may be wrong. Tell them to check in their provider's control panel that the server is running and that its IP address is the one they typed on "Connect your server"; if the address changed, they type the new one there.
- **server_timeout**: the server stopped answering part way, or was too slow to finish within the time a publish has. Run `server_status` once to see where things stand, then report what it says. If a release was under way, the app may still be on the version before. They can publish again; a server that was being readied the first time is faster the second.
- **auth_failed**: the server did not accept Builder's key. It did when the server was connected, so since then the key was removed or the server was rebuilt without it. Tell them to open "Connect your server" again, which shows the key for the server already saved, and add that key in their provider's control panel, then ask you to publish again. If the provider only takes keys when a server is created, that means rebuilding the server with the key, which erases what is on it.
- **host_key_changed**: the server at that address is not the one that was saved; it was rebuilt, replaced, or something sits in between. Builder refuses to send anything to it. If they rebuilt or replaced it, they save it again on "Connect your server"; if they did not, they ask their provider.
- **address_refused**: the address belongs to a private network, which Builder does not publish to. They need the server's public IP address from the provider, typed on "Connect your server".
- **key_invalid**: the saved key cannot be used. They save the server again on "Connect your server", which makes a new key to add at their provider.
- **busy**: Builder is already publishing to this server, or taking the app down, from another request, which can take some minutes. Do not try again yourself: tell them another publish to their server is still under way and to ask again in a few minutes.

## The server itself

- **unsupported_os**: the answer gives `os`, `version` and `arch`. Builder publishes to Debian 11 or later and Ubuntu 20.04 or later, on Intel/AMD (x86_64) or ARM (aarch64) processors, with systemd (which those systems have). Tell them what the server runs and that they can rebuild it with Ubuntu or Debian from the provider's control panel, which erases what is on it.
- **port_80_taken**: another program on the server already answers web visitors, such as a web server the provider installed. Builder will not replace it. They can rent a fresh server, or reinstall this one from the provider's control panel; reinstalling erases everything on it.
- **disk_full**: the server's disk is too full to publish; the answer may give `diskFreeMb`. Builder needs at least a gigabyte free, and room to keep a copy of what people entered. Nothing changed for visitors. They can choose a plan with a bigger disk in their provider's control panel, or rent a bigger server and save it on "Connect your server".
- **other_app_present**: this server already holds another Builder project's app, and one server holds only one project's app. They use a different server, or first take the other app down from that project.

## Publishing

- **runtime_download_failed**: what the app runs on could not be fetched for the server, or did not arrive intact. Run `server_release` once more, since a download can fail by chance. If it fails again, tell them publishing stopped because Builder could not fetch what the app runs on, and to try again later.
- **not_publishable**: the app does not say how it runs in production, so Builder cannot publish it. Say so plainly, and that Builder will make the app ready to publish before they publish again.
- **builder_unavailable**: Builder itself could not hand the app over or record the result; the person's server and its connection are fine. Run the same tool once more, since this can pass. If it keeps happening, say that publishing, or taking the app down, stopped because of a problem with Builder, not with their server, and that they can try again later.
- **app_not_saved**: the project has no saved app. It must be built first.
- **app_not_built**: `step` says whether the app's dependencies did not `install` or the app did not `build`, from a clean copy of the app. Either is almost always the app's own doing, not the server's, such as a dependency it uses but never declared or an error in its code. Nothing changed for visitors: whatever was published before still runs. Tell the person their app could not be built for publishing, and that Builder should check that it installs and builds from a clean copy and fix it; then they can publish again.
- **build_timed_out**: the `install` or `build` named by `step` was still running when the time a publish has ran out, and was stopped. Nothing changed for visitors. An install that waits on something, or a build far heavier than it should be, is the app's to fix; a very small server can also be too slow. Tell them the app took too long to get ready on their server, and that Builder should check it installs and builds quickly from a clean copy, or that a server with more memory and processors can help.
- **did_not_start**: the new version was put in place but did not start answering. `rolledBack` says what happened next: `yes`, the version before is back and answering, with what people entered as it was before; `no`, the version before was put back but did not answer either; `none`, this was the first publish, so nothing is published. Tell them the new version did not start, what is up now, and that Builder should find out why the app does not start when run for real and fix it; then they can publish again.
- **rollback_failed**: the new version did not start, and Builder could not put back what people entered as it was before. The app may be down (`rolledBack` says whether the version before answers: `yes`, `no` or `none`), and it needs attention. Nothing people entered was deleted; it is kept on the server. Tell them plainly that the app may be down, that what people entered is kept, and that Builder should fix why the new version does not start before they publish again.
- **unreachable_from_outside**: the app runs and answers on the server, but not from the internet at `url`. Almost always the server's firewall blocks web visitors: tell them to allow incoming traffic on port 80 (HTTP) in their provider's firewall settings, then to ask you to publish again. The app is recorded as published there, so it can be taken down from the Publish tab.
- **unexpected**: the server answered in a way Builder did not expect; `step` names where. Run `server_status` once and report what is up now, and that they can try again later.

## Taking it down

- **not_agreed**: the person has not agreed on the take-down screen to take down what is published on their server now: they were not asked, kept it, or the app was published again since. Nothing was taken down. Builder asks them on the take-down screen again.
