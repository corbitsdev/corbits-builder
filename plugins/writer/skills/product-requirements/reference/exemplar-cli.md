# Product requirements exemplar: a command-line tool

A compact excerpt of the shape and tone, for a tool that renames a folder of
photos by the date each was taken. A real document lists every requirement;
take every fact from the project's own documents.

```markdown
## In short

- The first version **renames every photo in a folder to the date it was
  taken**, and **shows the plan before changing anything**.
- **9 must requirements**, each with an acceptance criterion.
- I decided **photos with no date keep their name and are listed**; correct
  it if you would rather skip the folder.

## Purpose

Turn a camera's folder of IMG_0001 names into names you can sort and search
by date, without opening each photo.

## Users

- You, running it on a folder after each trip, on a Mac or Linux laptop.

## Scope

Renaming JPEG and HEIC photos in one folder by their capture date, a dry
run, and undo of the last run.

## Non-goals

- Editing the photos' own date data: renaming is all you asked for (your
  message).
- Subfolders: later, once one folder works well (my judgement).

## Functional requirements

- FR-1: Renames each photo to its capture date and time, as
  `2026-06-14_09-31-05.jpg`. Must. Your message.
- FR-2: Two photos taken in the same second get `-1`, `-2` suffixes rather
  than overwriting each other. Must. My judgement.
- FR-3: `--dry-run` prints every rename it would make and changes nothing.
  Must. My judgement: the first thing you would want before a bulk rename.
- FR-4: `undo` restores the names from the last run. Nice. My judgement.

## Non-functional requirements

- NFR-1: Renames 2,000 photos in under ten seconds on a laptop. Must. Your
  message: trips run to about 2,000 photos.
- NFR-2: Runs on macOS and Linux with no other install. Must. Your message.

## Interface requirements

- IR-1: `photo-dates <folder> [--dry-run]`; exit code 0 when every photo is
  handled, 1 when any is listed as skipped. Must. My judgement.
- IR-2: Reads the capture date from each photo's EXIF data. Must. Your
  message.

## Acceptance criteria

- AC-1 (FR-1): Run on a folder of dated photos, every file is renamed to
  its capture date and the count is printed.
- AC-2 (FR-2): Two photos from the same second end as `..._09-31-05.jpg`
  and `..._09-31-05-1.jpg`.
- AC-3 (FR-3): With `--dry-run`, the list of renames prints and every file
  keeps its name.

## Assumptions

- Photos with no capture date keep their name and are listed at the end.

## Sources

Your request in the conversation.
```
