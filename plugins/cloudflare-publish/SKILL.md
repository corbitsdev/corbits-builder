# Publish an app to Cloudflare Workers

This ready-made plan checks a built app is ready to publish on Cloudflare Workers through two cloudflare checks, in order: ready, then routes. Both steps are required and neither asks for the person's go-ahead.

Run cloudflare ready first. When it fails, its evidence says what the app lacks, such as a wrangler.toml; start coder change with that, then run ready again. Once ready passes, run cloudflare routes, which proves the Worker answers on the person's own domain rather than only its workers.dev address. The plan ends when routes passes.
