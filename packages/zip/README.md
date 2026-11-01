# Zip

`@corbits/zip`: Builder's ZIP writer and reader. `zip(entries)` writes
entries to archive bytes and `unzip(bytes)` reads them back, checking each
entry's name, bounds, size and CRC.

```ts
import { unzip, zip } from "@corbits/zip";

const archive = await zip([{ path: "hello.txt", data: "hello" }]);
const entries = await unzip(archive, { maxTotalBytes: 1024 * 1024 });
```

## Where it fits

A plain shared library with no dependencies and no `node:` imports. It
compresses with the platform's `CompressionStream("deflate-raw")`, so the
same code runs in the [hub][hub], in agents and in the [interface][web].
The [slide deck writer][slidedeck] packages its parts with it.

## API

- `zip(entries)`: archive bytes. A `ZipEntry` is `{ path, data }`, where
  `data` is bytes or a string written as UTF-8. Entries keep the order given
  and carry a fixed 1980-01-01 timestamp; each is deflated unless that would
  make it larger.
- `unzip(bytes, { maxTotalBytes }?)`: every `UnzippedEntry` (`{ path, data }`)
  in central directory order. `maxTotalBytes` defaults to 256 MiB.
- `ZipError`: thrown for anything either side refuses.

## Limits

- No ZIP64: at most 65,535 entries, and entries and archives under 4 GiB.
- No encryption; only stored and deflated entries are read.
- Names must be relative and unique: absolute paths, drive letters,
  backslashes, NUL and `..` segments are refused on both sides.
- Equal input gives equal bytes under one deflate implementation; Bun and
  browsers can compress differently.

## Layout

- `src/zip.ts`: the writer.
- `src/unzip.ts`: the reader, from the central directory.
- `src/format.ts`: record signatures and sizes, and the name check.
- `src/crc32.ts`, `src/streams.ts`: the checksum and the deflate streams.

## Working on it

`bun run test` feeds hostile archives to the reader here, and round-trips a
full archive through the [slide deck writer's][slidedeck] fixture.

[hub]: https://github.com/corbitsdev/corbits-builder/tree/main/apps/hub
[web]: https://github.com/corbitsdev/corbits-builder/tree/main/apps/web
[slidedeck]: https://github.com/corbitsdev/corbits-builder/tree/main/packages/slidedeck
