---
name: publishing
description: Use when reporting a publish, a status or a take-down - the address people open, what a first publish of an app with sign-in needs, and what the person should know about data and earlier versions.
---

# Reporting a publish

A reply names what happened and the address people open, never a version, a commit, an id or a time. A successful `server_release` has already recorded the publish in the project.

- **The address.** People open the app at the `url` the release answers with: plain HTTP on the server's IP address, such as `http://203.0.113.7/`. There is no domain name or HTTPS yet. If the person asks, say so, and that browsers may call the page "not secure" because of it.
- **What people entered stays.** Each publish replaces only the app itself and keeps what people entered in it. The server keeps the three latest versions and a copy of the data from just before each one went out. The app pauses for a few moments while each publish copies that data and starts the new version.
- **A first publish of an app with sign-in.** Tell the person to open the address straight away and create their own account before anyone else can, and to sign in with it from then on. Some apps still hold the demo account used while building them: tell the person to sign in with its email, if they know it, and change its password, or to ask Builder to remove it.
- **Taken down.** After `server_unpublish` the app no longer answers and Builder no longer counts it as published. What people entered is kept on the server, so publishing again brings the app back with it. The server itself is still theirs, and still costs what their hosting provider charges, until they cancel it there.
- **Status.** `state` is `running` (with `answersFromOutside` saying whether the internet reaches it), `stopped`, `not_answering` or `not_published`. Put it to the person in plain words.
