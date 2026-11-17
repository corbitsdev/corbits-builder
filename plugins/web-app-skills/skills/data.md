# Data

- The server owns the data and validates every request; the client's checks are for the person's convenience only.
- Share one schema for a request or response between client and server where the stack allows, so both sides fail the same way.
- Load data where the page is defined, not deep inside components, so a page shows one loading state instead of many spinners.
- After a change succeeds, refresh or update the data the page shows; a person should never need to reload to see their own change.
- Never put secrets in client code or in anything the browser downloads. Read them on the server from the environment.
