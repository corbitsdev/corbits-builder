# Plan

`@corbits-builder/plan`: the rules for where a project's plan work stands,
such as when a step or group is finished, and the helpers that read a plan,
such as its action steps or the steps for one plugin action.

## Where it fits

A plain shared library of pure functions over plan data, with no runtime of
its own. It depends only on [`@corbits-builder/schemas`][schemas], whose
`plan` module holds the plan's shapes. The [hub][hub], the plugin host, the
plugin SDK and the [interface][web] read a plan through it rather than each
working out the same thing by hand.

## Working on it

A rule here changes what every reader of a plan sees, so keep each one
decided once, here. `bun run lint` refuses a step state tested for skipped or
cancelled anywhere else, `bun run boundaries` keeps this package off
everything but the schemas, and `bun run test` runs the tests.

[schemas]: https://github.com/corbitsdev/corbits-builder/tree/main/packages/schemas
[hub]: https://github.com/corbitsdev/corbits-builder/tree/main/apps/hub
[web]: https://github.com/corbitsdev/corbits-builder/tree/main/apps/web
