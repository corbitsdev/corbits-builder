---
name: publishing
description: Use when reporting a server made, a publish, a status or a deletion - the address people open, what the server costs, and what the person should know about what people entered.
---

# Reporting

A reply names what happened and the address people open, never a version, a commit, an id, a size's code name or a time. A successful `digitalocean_release` has already recorded the publish in the project.

- **What it costs.** The server is in the person's own DigitalOcean account, and DigitalOcean bills them for it every month, at the price they agreed to, until the app is taken down from the Publish tab, which deletes it. The Publish tab shows that it is running and what it costs.
- **The address.** People open the app at the `url` the release answers with: plain HTTP on the server's IP address, such as `http://203.0.113.7/`. There is no domain name or HTTPS yet. If the person asks, say so, and that browsers may call the page "not secure" because of it, so it is not for passwords or payments yet.
- **What people entered stays, while the server does.** Each publish replaces only the app itself and keeps what people entered in it. The server keeps the three latest versions and a copy of the data from just before each one went out. The app pauses for a few moments while each publish copies that data and starts the new version.
- **A first publish of an app with sign-in.** Tell the person to open the address straight away and create their own account before anyone else can, and to sign in with it from then on. Some apps still hold the demo account used while building them: tell the person to sign in with its email, if they know it, and change its password, or to ask Builder to remove it.
- **Deleted.** After `digitalocean_destroy` the server is gone, with the app and everything people entered in it, for good, and DigitalOcean stops charging for it. Builder no longer counts the app as published, and forgets the server the person chose. Publishing again has them choose a server and agree to its price on the "Publish to DigitalOcean" screen, and makes a new, empty one.
- **Status.** `digitalocean_status` answers `state` as `running` (with `answersFromOutside` saying whether the internet reaches it), `stopped`, `not_answering` or `not_published`. `digitalocean_server_status` answers whether DigitalOcean has the server: `none`, `starting`, `running` or `off`. Put it to the person in plain words.
