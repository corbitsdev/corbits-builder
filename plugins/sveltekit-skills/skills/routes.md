# Routes in SvelteKit

- A page is a folder under `src/routes` with a `+page.svelte`; `[id]` in a folder name is a parameter. `+layout.svelte` wraps every page below it and renders the page with its children snippet (`{@render children()}` in Svelte 5, `<slot />` before it).
- Data for a page comes from its `load` function: `+page.server.ts` for code that needs secrets or the database (runs only on the server), `+page.ts` for code that may also run in the browser. The page reads the result from its `data` prop.
- Forms post to actions in `+page.server.ts` (`export const actions = { default: async ({ request }) => { ... } }`). Add `use:enhance` from `$app/forms` to the `<form>` so it submits without a full reload but still works without JavaScript. Return `fail(400, { ... })` to send errors and the typed values back to the form.
- Server-only modules go in `src/lib/server`; SvelteKit refuses to bundle them into the client. Read secrets from `$env/static/private` or `$env/dynamic/private`.
- Throw `error(404, "Not found")` or `redirect(303, "/path")` from `@sveltejs/kit` inside `load` or an action; `+error.svelte` shows errors for the routes below it.
- Navigate with plain `<a href>`; SvelteKit makes in-app links client-side on its own. Use `goto` from `$app/navigation` only from code.
