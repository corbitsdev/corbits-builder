# Build plan exemplar: a command-line tool

A compact excerpt of the shape and tone, for a tool that renames a folder of
photos by the date each was taken, with no stack named by the project or the
person. A real plan covers every requirement; take every fact from the
project's own documents.

```markdown
## In short

- **One Go binary**, chosen because it runs on macOS and Linux with nothing
  else installed (NFR-2); confirm it if you would rather have Python.
- **Four phases**; a dry run on a real folder works from phase 1.
- The riskiest part is **reading dates from HEIC photos**; the fallback is
  listing those photos as skipped.

## Approach and stack

A single Go program using the standard library and one EXIF reader. One
file to copy onto either laptop meets NFR-2, and Go renames 2,000 files in
well under the ten seconds NFR-1 allows.

## Components and interfaces

- `main.go`: parses `photo-dates <folder> [--dry-run]` and `undo` (IR-1).
- `dates.go`: reads each photo's capture date from its EXIF data (IR-2).
- `plan.go`: turns dates into new names, adding suffixes on clashes (FR-2).
- `.photo-dates-undo.json` in the folder: the last run's old and new names.

## Data flow

The folder's photos are read once for their dates; the rename plan is built
in memory, printed, then applied, and the old names are written to the undo
file before any rename.

## Phases

1. Dry run: `main.go`, `dates.go`, `plan.go` for JPEG. Delivers FR-1 in dry
   run, FR-3. Exit: `photo-dates ~/trip --dry-run` lists every rename.
2. Renaming and clashes: apply the plan, suffix clashes. Delivers FR-1,
   FR-2, IR-1. Exit: a test folder is renamed and two same-second photos
   both survive.
3. HEIC and skipped photos: Delivers IR-2. Exit: HEIC photos rename; a photo
   with no date is listed and exit code is 1.
4. Undo and README: Delivers FR-4. Exit: `photo-dates undo ~/trip` restores
   every name.

## Install and run

`go build -o photo-dates .`, then copy the binary onto your path.

## Test plan

`go test ./...` runs table tests for `plan.go`'s naming and clash rules over
a folder of sample photos kept in `testdata/`. Each acceptance criterion is
then tried at the command line on that folder.

## Risks and unknowns

- Some phones write HEIC dates the EXIF reader misses. Fallback: those
  photos are listed as skipped and keep their names.

## Acceptance checklist

- [ ] AC-1: Run `photo-dates testdata/trip`; every file is renamed to its
      capture date and the count is printed.
- [ ] AC-2: The two same-second photos end as `..._09-31-05.jpg` and
      `..._09-31-05-1.jpg`.
- [ ] AC-3: Run with `--dry-run`; the renames print and every file keeps its
      name.
```
