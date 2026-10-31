# Client

`@corbits-builder/client`: a typed client for the hub's authenticated HTTP API.
`createProductApiClient` returns one object with a method for each hub
operation, and failed calls throw `ProductApiError`.

## Where it fits

This package is a client boundary. It imports only
[`packages/schemas`][schemas] and arktype, and speaks HTTP to the
[hub][hub]; it never touches the database or Interchange. The
[interface][ui] uses it, and so do the end-to-end tests: the interface is never the only way to reach an operation.

## Layout

- `src/index.ts`: `createProductApiClient` and the exported types.
- `src/client/`: one module per area (auth, projects, artifacts,
  conversations, credentials, catalog, invitations, reviews, roles,
  settings); `shared.ts` holds the request plumbing and error type.

## Working on it

Add a method beside the area it belongs to and keep request and response
shapes in `packages/schemas`. `bun run check` typechecks this
workspace with the others; the API itself is proven against a running hub,
as [DEV.md][dev] describes.

[schemas]: https://github.com/corbitsdev/corbits-builder/tree/main/packages/schemas
[hub]: https://github.com/corbitsdev/corbits-builder/tree/main/apps/hub
[ui]: https://github.com/corbitsdev/corbits-builder/tree/main/apps/web
[dev]: https://github.com/corbitsdev/corbits-builder/blob/main/docs/DEV.md
