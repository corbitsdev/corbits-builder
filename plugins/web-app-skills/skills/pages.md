# Pages and navigation

- Every screen a person can reach has its own URL, so it can be bookmarked, shared and reloaded. A tab, filter or selected item that changes what the screen shows belongs in the path or query string, not only in component state.
- Navigation is a real link (`<a href>` or the framework's link component), not a click handler on a `div`, so it opens in a new tab and works with the keyboard and screen readers.
- Each page sets its document title, and a route that matches nothing shows a not-found page with a way back.
- Every page that loads data has three states the person can see: loading, failed with a way to retry, and empty with a next step. Design each before wiring the happy path.
- After the work, open each changed page at desktop and phone widths and follow its links.
